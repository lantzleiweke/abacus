import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BACKOFF_MS,
  GIVE_UP_AFTER,
  IDLE_STOP_MS,
  JOURNAL_CHECK_TTL_MS,
  RETRY_FAILED_MS,
  createFollower,
  truncatedHead,
  type Follower,
  type LiveChild,
  type LiveDeps,
} from '../../../src/service/live';

class FakeChild implements LiveChild {
  killed: NodeJS.Signals[] = [];
  private out: Array<(chunk: string) => void> = [];
  private err: Array<(chunk: string) => void> = [];
  private exit: Array<(code: number | null) => void> = [];
  constructor(
    readonly pid: number,
    readonly since: number,
  ) {}
  onStdout(listener: (chunk: string) => void): void {
    this.out.push(listener);
  }
  onStderr(listener: (chunk: string) => void): void {
    this.err.push(listener);
  }
  onExit(listener: (code: number | null) => void): void {
    this.exit.push(listener);
  }
  kill(signal: NodeJS.Signals): void {
    this.killed.push(signal);
  }
  emit(text: string): void {
    for (const l of this.out) l(text);
  }
  emitErr(text: string): void {
    for (const l of this.err) l(text);
  }
  end(code: number | null = 1): void {
    for (const l of this.exit) l(code);
  }
}

const ROOT = '/work/a';
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const record = (seq: number) => `{"seq":${seq},"ts":"2026-10-15T05:39:52Z","op":"update","issue_id":"x-1","issue":{"id":"x-1"}}\n`;

let dir: string;
let t: number;
let journal: boolean | Error;
let journalReads: number;
let spawned: FakeChild[];
let spawnFails: boolean;
let probe: number | null | Error;
let probes: number;
let nextPid: number;
let intervals: { fn: () => void; ms: number; cancelled: boolean }[];
let alive: Set<number>;
let commands: Map<number, string>;
let groupKills: Array<[number, NodeJS.Signals]>;
let follower: Follower;

function deps(overrides: Partial<LiveDeps> = {}): LiveDeps {
  return {
    now: () => t,
    journalOn: async () => {
      journalReads += 1;
      if (journal instanceof Error) throw journal;
      return journal;
    },
    journalHead: async () => {
      probes += 1;
      if (probe instanceof Error) throw probe;
      return probe;
    },
    spawnChild: async (_root, since) => {
      if (spawnFails) return null;
      const child = new FakeChild(nextPid++, since);
      spawned.push(child);
      return child;
    },
    storageDir: () => dir,
    ownerPid: 1000,
    isAlive: (pid) => alive.has(pid),
    commandOf: (pid) => commands.get(pid) ?? null,
    killGroup: (pid, signal) => {
      groupKills.push([pid, signal]);
    },
    every: (fn, ms) => {
      const handle = { fn, ms, cancelled: false };
      intervals.push(handle);
      return () => {
        handle.cancelled = true;
      };
    },
    ...overrides,
  };
}

/** Two requests inside the idle window: the panel has been asking, so a follower may start. */
async function warm(root = ROOT, capable = true): Promise<void> {
  follower.ensure(root, capable);
  t += 1_000;
  follower.ensure(root, capable);
  await flush();
}

/** The panel keeps polling while time passes: a request every 2 s, so the idle rule never applies. */
async function pollFor(ms: number, capable = true): Promise<void> {
  const end = t + ms;
  while (t < end) {
    t = Math.min(t + 2_000, end);
    follower.ensure(ROOT, capable);
    await flush();
  }
}

const liveIntervals = () => intervals.filter((i) => !i.cancelled);
const last = () => spawned[spawned.length - 1]!;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'oc-beads-live-'));
  t = 1_000_000;
  journal = true;
  journalReads = 0;
  spawned = [];
  spawnFails = false;
  probe = null;
  probes = 0;
  nextPid = 5000;
  intervals = [];
  alive = new Set();
  commands = new Map();
  groupKills = [];
  follower = createFollower(deps());
});

afterEach(async () => {
  follower.stopAll();
  await rm(dir, { recursive: true, force: true });
});

describe('follower start', () => {
  it('starts only with the capability and the journal on', async () => {
    await warm(ROOT, false);
    expect(spawned).toHaveLength(0);
    expect(follower.state(ROOT).state).toBe('off');

    journal = false;
    await warm(ROOT, true);
    expect(spawned).toHaveLength(0);
    expect(follower.state(ROOT).state).toBe('off');

    // The setting is kept for a minute; once stale it is read again and a turned-on journal starts a child.
    journal = true;
    await pollFor(JOURNAL_CHECK_TTL_MS + 2_000);
    expect(spawned).toHaveLength(1);
    expect(follower.state(ROOT).state).toBe('following');
  });

  it('reads the journal setting once per minute, not per request', async () => {
    journal = false;
    for (let i = 0; i < 5; i += 1) {
      follower.ensure(ROOT, true);
      t += 1_000;
      await flush();
    }
    expect(journalReads).toBe(1);
  });

  it('does not start on the first request, so a closed panel polling once a minute spawns nothing', async () => {
    for (let i = 0; i < 4; i += 1) {
      follower.ensure(ROOT, true);
      t += 60_000;
      await flush();
    }
    expect(spawned).toHaveLength(0);
    expect(journalReads).toBe(0);
  });

  it('one child per root', async () => {
    await warm(ROOT);
    follower.ensure(ROOT, true);
    follower.ensure(ROOT, true);
    await flush();
    expect(spawned).toHaveLength(1);
    await warm('/work/b');
    expect(spawned).toHaveLength(2);
    expect(spawned[0]!.pid).not.toBe(spawned[1]!.pid);
  });

  it('survives a journal read that fails: polling carries on and the read is tried again soon', async () => {
    journal = new Error('bd is busy');
    await warm();
    expect(spawned).toHaveLength(0);
    journal = true;
    t += 16_000;
    follower.ensure(ROOT, true);
    await flush();
    expect(spawned).toHaveLength(1);
  });

  it('a child that cannot be started counts as a failure', async () => {
    spawnFails = true;
    await warm();
    expect(follower.state(ROOT).state).toBe('backoff');
  });
});

describe('journalChanged', () => {
  it('forgets a cached "off" so the next request after enabling starts the child', async () => {
    journal = false;
    await warm();
    expect(spawned).toHaveLength(0);
    expect(follower.state(ROOT).state).toBe('off');
    // The person turned it on well inside the minute the old answer is kept for.
    journal = true;
    follower.journalChanged(ROOT);
    t += 1_000;
    follower.ensure(ROOT, true);
    await flush();
    expect(spawned).toHaveLength(1);
    expect(follower.state(ROOT).state).toBe('following');
  });

  it('does nothing for a root it has never seen, and leaves a running child alone', async () => {
    follower.journalChanged('/work/never');
    await warm();
    expect(spawned).toHaveLength(1);
    follower.journalChanged(ROOT);
    follower.ensure(ROOT, true);
    await flush();
    expect(spawned).toHaveLength(1);
    expect(last().killed).toEqual([]);
  });
});

describe('events', () => {
  it('an event marks dirty, tracks the highest seq, and take clears the nudge', async () => {
    await warm();
    expect(follower.dirty(ROOT)).toBe(false);
    last().emit(record(7));
    expect(follower.dirty(ROOT)).toBe(true);
    follower.take(ROOT);
    expect(follower.dirty(ROOT)).toBe(false);
    last().emit(record(9) + record(8).slice(0, 20));
    expect(follower.dirty(ROOT)).toBe(true);
    // The half line completes in the next chunk.
    last().emit(record(8).slice(20));
    last().end();
    t += BACKOFF_MS[0]!;
    follower.ensure(ROOT, true);
    await flush();
    expect(spawned[1]!.since).toBe(9);
  });

  it('a line that is not a journal record is ignored', async () => {
    await warm();
    last().emit('note: the events journal is disabled\n');
    expect(follower.dirty(ROOT)).toBe(false);
  });

  it('nudge marks dirty without an event (a sync job ended)', () => {
    follower.nudge(ROOT);
    expect(follower.dirty(ROOT)).toBe(true);
  });
});

describe('fallback and backoff', () => {
  it('falls back to polling when the follower exits', async () => {
    await warm();
    expect(follower.state(ROOT).state).toBe('following');
    last().end(1);
    expect(follower.state(ROOT).state).toBe('backoff');
    // Not following any more, so the refresh reads the change signal again; and it exports once for what was missed.
    expect(follower.dirty(ROOT)).toBe(true);
  });

  it('backs off 2s, 5s, 15s, 60s between restarts', async () => {
    await warm();
    for (const wait of BACKOFF_MS) {
      const count = spawned.length;
      last().end(1);
      await pollFor(wait - 1_000);
      expect(spawned).toHaveLength(count);
      await pollFor(1_000);
      expect(spawned).toHaveLength(count + 1);
    }
  });

  it('backs off and gives up after repeated failures, then retries later', async () => {
    await warm();
    for (let i = 0; i < GIVE_UP_AFTER - 1; i += 1) {
      last().end(1);
      await pollFor(BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)]!);
    }
    expect(spawned).toHaveLength(GIVE_UP_AFTER);
    last().end(1);
    expect(follower.state(ROOT).state).toBe('failed');

    // However long the panel keeps asking, nothing starts until the retry time.
    await pollFor(RETRY_FAILED_MS - 2_000);
    expect(spawned).toHaveLength(GIVE_UP_AFTER);
    expect(follower.state(ROOT).state).toBe('failed');

    await pollFor(2_000);
    expect(spawned).toHaveLength(GIVE_UP_AFTER + 1);
    expect(follower.state(ROOT).state).toBe('following');
  });

  it('an event between failures starts the count again', async () => {
    await warm();
    for (let i = 0; i < GIVE_UP_AFTER + 3; i += 1) {
      last().emit(record(i + 1));
      last().end(1);
      expect(follower.state(ROOT).state).toBe('backoff');
      t += BACKOFF_MS[0]!;
      follower.ensure(ROOT, true);
      await flush();
    }
    // Every failure was the first of its run, so the wait never grew.
    expect(follower.state(ROOT).state).toBe('following');
    expect(spawned).toHaveLength(GIVE_UP_AFTER + 4);
  });

  it('restart resumes from the last seq', async () => {
    await warm();
    expect(last().since).toBe(0);
    last().emit(record(41) + record(42));
    last().end(1);
    t += BACKOFF_MS[0]!;
    follower.ensure(ROOT, true);
    await flush();
    expect(last().since).toBe(42);
  });

  const fixture = (name: string) => readFile(join(__dirname, '../../fixtures/bd13', name), 'utf8');

  it('journal truncated re-baselines (the real plain-text error from bd 1.3.1)', async () => {
    await warm();
    last().emit(record(3));
    follower.take(ROOT);
    last().emitErr(await fixture('events-tail-truncated.stderr'));
    last().end(1);
    // A full export is wanted, and the next child starts at once from the journal head (6 in the capture); the failure is not counted.
    expect(follower.dirty(ROOT)).toBe(true);
    expect(probes).toBe(0);
    follower.ensure(ROOT, true);
    await flush();
    expect(spawned).toHaveLength(2);
    expect(last().since).toBe(6);
    expect(follower.state(ROOT).state).toBe('following');
  });

  it('parses both real forms, and says nothing for other text', async () => {
    expect(truncatedHead(await fixture('events-tail-truncated.stderr'))).toEqual({ head: 6 });
    expect(truncatedHead(await fixture('events-tail-truncated.json'))).toEqual({ head: 6 });
    // The token with no head in it.
    expect(truncatedHead('Error: events journal truncated\n')).toEqual({ head: null });
    expect(truncatedHead('events_journal_truncated\n')).toEqual({ head: null });
    expect(truncatedHead('Error: something else\n')).toBeNull();
  });

  it('a truncation message without the head is probed once, then the follower resumes from the probed head', async () => {
    probe = 120;
    await warm();
    last().emitErr('Error: events journal truncated\n');
    last().end(1);
    expect(follower.dirty(ROOT)).toBe(true);
    // No restart while the probe runs.
    follower.ensure(ROOT, true);
    await flush();
    expect(probes).toBe(1);
    expect(spawned).toHaveLength(1);
    follower.ensure(ROOT, true);
    await flush();
    expect(spawned).toHaveLength(2);
    expect(last().since).toBe(120);
    expect(follower.state(ROOT).state).toBe('following');
  });

  it('a truncation message the probe cannot resolve is a counted failure', async () => {
    probe = null;
    await warm();
    last().emitErr('events_journal_truncated\n');
    last().end(1);
    expect(follower.dirty(ROOT)).toBe(true);
    await flush();
    expect(probes).toBe(1);
    expect(follower.state(ROOT).state).toBe('backoff');
    // Not restarted before the backoff is over.
    follower.ensure(ROOT, true);
    await flush();
    expect(spawned).toHaveLength(1);
    t += BACKOFF_MS[0]!;
    follower.ensure(ROOT, true);
    await flush();
    expect(spawned).toHaveLength(2);
  });

  it('a probe that throws is a counted failure too', async () => {
    probe = new Error('boom');
    await warm();
    last().emitErr('events_journal_truncated\n');
    last().end(1);
    await flush();
    expect(follower.state(ROOT).state).toBe('backoff');
  });
});

describe('lifecycle', () => {
  it('stops after the panel goes quiet', async () => {
    await warm();
    const child = last();
    child.emit(record(5));
    expect(liveIntervals()).toHaveLength(1);
    expect(liveIntervals()[0]!.ms).toBe(5_000);

    t += IDLE_STOP_MS - 1_000;
    follower.tick();
    expect(child.killed).toEqual([]);

    t += 1_000;
    follower.tick();
    expect(child.killed).toEqual(['SIGTERM']);
    child.end(null);
    expect(follower.state(ROOT).state).toBe('off');
    // Stopping on purpose is not a failure, and the interval goes away with the last child.
    expect(liveIntervals()).toHaveLength(0);

    // The panel comes back: the first request alone does not spawn, the next one does, and it resumes from the stored seq.
    follower.ensure(ROOT, true);
    await flush();
    expect(spawned).toHaveLength(1);
    t += 1_000;
    follower.ensure(ROOT, true);
    await flush();
    expect(spawned).toHaveLength(2);
    expect(last().since).toBe(5);
  });

  it('keeps following while the panel keeps asking', async () => {
    await warm();
    for (let i = 0; i < 20; i += 1) {
      t += 5_000;
      follower.ensure(ROOT, true);
      follower.tick();
    }
    expect(last().killed).toEqual([]);
    expect(spawned).toHaveLength(1);
  });

  it('a child that ignores SIGTERM is killed at the next check', async () => {
    await warm();
    const child = last();
    t += IDLE_STOP_MS;
    follower.tick();
    expect(child.killed).toEqual(['SIGTERM']);
    t += 2_000;
    follower.tick();
    expect(child.killed).toEqual(['SIGTERM', 'SIGKILL']);
    expect(liveIntervals()).toHaveLength(0);
  });

  it('has no timer until a child exists', async () => {
    follower.ensure(ROOT, true);
    expect(intervals).toHaveLength(0);
    journal = false;
    await warm();
    expect(intervals).toHaveLength(0);
  });

  it('losing the capability stops the child at once', async () => {
    await warm();
    const child = last();
    follower.ensure(ROOT, false);
    expect(child.killed).toEqual(['SIGKILL']);
    expect(follower.state(ROOT).state).toBe('off');
    expect(liveIntervals()).toHaveLength(0);
  });

  it('kills the child on service shutdown', async () => {
    await warm();
    await warm('/work/b');
    expect(await readdir(dir)).toHaveLength(2);
    follower.stopAll();
    expect(spawned.map((c) => c.killed)).toEqual([['SIGKILL'], ['SIGKILL']]);
    expect(await readdir(dir)).toEqual([]);
    expect(liveIntervals()).toHaveLength(0);
    // A late exit event from a killed child changes nothing.
    spawned[0]!.end(null);
    expect(follower.state(ROOT).state).toBe('off');
  });

  it('a child still being started when the service shuts down is not left behind', async () => {
    follower.ensure(ROOT, true);
    t += 1_000;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    follower = createFollower(
      deps({
        spawnChild: async (_root, since) => {
          await gate;
          const child = new FakeChild(nextPid++, since);
          spawned.push(child);
          return child;
        },
      }),
    );
    follower.ensure(ROOT, true);
    t += 1_000;
    follower.ensure(ROOT, true);
    await flush();
    follower.stopAll();
    release();
    await flush();
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.killed).toEqual(['SIGKILL']);
  });
});

describe('stale followers', () => {
  const pidfile = (name: string, body: unknown) => writeFile(join(dir, name), JSON.stringify(body), 'utf8');

  it('kills stale followers on start', async () => {
    alive.add(7001);
    commands.set(7001, '/opt/homebrew/bin/bd events tail --since 4 --follow --readonly');
    await pidfile('live-aaaa.pid', { pid: 7001, owner: 999, root: '/work/old' });
    follower.reapStale();
    expect(groupKills).toEqual([[7001, 'SIGKILL']]);
    expect(await readdir(dir)).toEqual([]);
  });

  it('leaves a follower whose owner is still running (another service)', async () => {
    alive.add(7001);
    alive.add(999);
    commands.set(7001, 'bd events tail --follow');
    await pidfile('live-aaaa.pid', { pid: 7001, owner: 999, root: '/work/old' });
    follower.reapStale();
    expect(groupKills).toEqual([]);
    expect(await readdir(dir)).toEqual(['live-aaaa.pid']);
  });

  it('does not kill a reused pid whose command is something else', async () => {
    alive.add(7001);
    commands.set(7001, '/usr/bin/vim notes.md');
    await pidfile('live-aaaa.pid', { pid: 7001, owner: 999, root: '/work/old' });
    follower.reapStale();
    expect(groupKills).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it('ignores a pidfile it cannot read and files that are not pidfiles', async () => {
    await writeFile(join(dir, 'live-bbbb.pid'), 'not json', 'utf8');
    await writeFile(join(dir, 'abcdef.json'), '{}', 'utf8');
    follower.reapStale();
    expect(groupKills).toEqual([]);
    expect((await readdir(dir)).sort()).toEqual(['abcdef.json', 'live-bbbb.pid']);
  });

  it('runs on the first request, and a pidfile is written for each child with the owner pid', async () => {
    alive.add(7001);
    commands.set(7001, 'bd events tail --follow');
    await pidfile('live-aaaa.pid', { pid: 7001, owner: 999, root: '/work/old' });
    await warm();
    expect(groupKills).toEqual([[7001, 'SIGKILL']]);
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    const { readFile } = await import('node:fs/promises');
    expect(JSON.parse(await readFile(join(dir, files[0]!), 'utf8'))).toEqual({ pid: spawned[0]!.pid, owner: 1000, root: ROOT });
  });
});
