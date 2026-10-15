import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LiveState } from '../shared/types';
import { childEnv, resolveExecutable, runBd } from './bd/exec';

// The events journal follower (bd 1.3): `bd events tail --since <seq> --follow`, one child per project root.
// It is a nudge, not the data source: an event marks the root dirty and the snapshot refresh exports on its next poll.
// The minute export and the change-signal polling stay as the fallback (pull, merge, other clones and `bd sql` writes are not journaled).

export type { LiveState };

export interface Follower {
  /** Called by every snapshot request. Starts the child when `capable`, the journal is on, the panel has been asking and the follower is not failed. */
  ensure(root: string, capable: boolean): void;
  state(root: string): { state: LiveState; since: number | null };
  /** The journal setting was just changed (the person turned it on): forget the kept reading, so the next request reads it again. */
  journalChanged(root: string): void;
  /** An event arrived (or a sync finished) since the refresh last took the nudge. */
  dirty(root: string): boolean;
  /** The refresh consumed the nudge. */
  take(root: string): void;
  /** Something other than the journal says the data moved (a sync job): refresh on the next poll. */
  nudge(root: string): void;
  /** Idle stop and kill escalation. Run by the one interval that exists while a child does; public for tests. */
  tick(): void;
  /** Kills every child and removes every pidfile. Service shutdown. */
  stopAll(): void;
  /** Kills followers left by an earlier service process whose owner is gone and whose command line still reads `bd events tail`. */
  reapStale(): void;
}

/** No snapshot request for this long: stop the child (a hidden panel polls once a minute). */
export const IDLE_STOP_MS = 30_000;
export const BACKOFF_MS = [2_000, 5_000, 15_000, 60_000];
/** Consecutive failures with no event in between, then `failed` (polling only). */
export const GIVE_UP_AFTER = 5;
export const RETRY_FAILED_MS = 300_000;
/** `bd config get events-journal` is read once per start and kept this long. */
export const JOURNAL_CHECK_TTL_MS = 60_000;
/** A failed read of the setting is tried again after this long. */
const JOURNAL_CHECK_FAIL_TTL_MS = 15_000;
/** A child asked to stop with SIGTERM that is still there after this long gets SIGKILL. */
const KILL_ESCALATE_MS = 2_000;
const IDLE_CHECK_MS = 5_000;
const LINE_BUFFER_MAX = 4 * 1024 * 1024;
const STDERR_KEEP = 8_192;

/** A running `bd events tail`: what the follower needs from a child process, so tests can fake it. */
export interface LiveChild {
  pid: number | undefined;
  onStdout(listener: (chunk: string) => void): void;
  onStderr(listener: (chunk: string) => void): void;
  /** Once, with the exit code (null when killed by a signal). */
  onExit(listener: (code: number | null) => void): void;
  /** Signals the child's whole process group. */
  kill(signal: NodeJS.Signals): void;
}

export interface LiveDeps {
  now(): number;
  /** Whether the project's events journal is on. Rejects when that cannot be read. */
  journalOn(root: string): Promise<boolean>;
  /** The journal head, read with a non-follow `bd events tail --since 0 --limit 1 --json` when a truncation message did not carry it. Null when unknown. */
  journalHead(root: string): Promise<number | null>;
  /** Starts `bd events tail --since <since> --follow --readonly` in `root`. Null when it cannot be started. */
  spawnChild(root: string, since: number): Promise<LiveChild | null>;
  storageDir(): string;
  ownerPid: number;
  isAlive(pid: number): boolean;
  commandOf(pid: number): string | null;
  /** Signals the process group `pid` leads. */
  killGroup(pid: number, signal: NodeJS.Signals): void;
  /** Runs `fn` every `ms` until the returned function is called. Must not keep the process alive. */
  every(fn: () => void, ms: number): () => void;
}

type Entry = {
  root: string;
  state: LiveState;
  since: number | null;
  /** Highest journal seq seen; the next child resumes from it. Null before any. */
  seq: number | null;
  dirty: boolean;
  /** The last request, and the one before it (a start needs a panel that has been asking). */
  lastRequestAt: number | null;
  child: LiveChild | null;
  /** Set when the follower itself ends the child, so its exit is not a failure. */
  stopping: boolean;
  stopRequestedAt: number | null;
  failures: number;
  /** When a backed-off or failed follower may start again. */
  retryAt: number | null;
  journal: { on: boolean; at: number } | null;
  /** A start in progress (journal read, executable lookup, spawn). */
  starting: Promise<void> | null;
  /** Bumped when a start is abandoned, so its late result is dropped. */
  startToken: number;
};

function pidfilePath(dir: string, root: string): string {
  return join(dir, `live-${createHash('sha1').update(root).digest('hex').slice(0, 16)}.pid`);
}

const SEQ_AT_START = /^\{"seq":(\d+)[,}]/;

function seqOf(line: string): number | null {
  const quick = SEQ_AT_START.exec(line);
  if (quick) return Number(quick[1]);
  try {
    const value = JSON.parse(line) as { seq?: unknown };
    return typeof value.seq === 'number' && Number.isFinite(value.seq) ? value.seq : null;
  } catch {
    return null;
  }
}

/**
 * A refused read below the retention floor, in either form bd prints (real captures in test/fixtures/bd13):
 * plain `Error: events journal truncated: checkpoint 0 is below the retained window [5..6]; ...` (head is the second number),
 * or `{"code":"events_journal_truncated",...,"head":6}`. Null when the text is neither; `head` is null when the text does not carry it.
 */
export function truncatedHead(text: string): { head: number | null } | null {
  if (!text.includes('events_journal_truncated') && !/events journal truncated/i.test(text)) return null;
  const json = /"head"\s*:\s*(\d+)/.exec(text);
  if (json) return { head: Number(json[1]) };
  const window = /retained window \[(\d+)\.\.(\d+)\]/.exec(text);
  return { head: window ? Number(window[2]) : null };
}

export function createFollower(deps: LiveDeps): Follower {
  const entries = new Map<string, Entry>();
  let cancelInterval: (() => void) | null = null;
  let reaped = false;

  const entryFor = (root: string): Entry => {
    let entry = entries.get(root);
    if (!entry) {
      entry = {
        root,
        state: 'off',
        since: null,
        seq: null,
        dirty: false,
        lastRequestAt: null,
        child: null,
        stopping: false,
        stopRequestedAt: null,
        failures: 0,
        retryAt: null,
        journal: null,
        starting: null,
        startToken: 0,
      };
      entries.set(root, entry);
    }
    return entry;
  };

  const anyChild = (): boolean => [...entries.values()].some((e) => e.child !== null);

  const syncInterval = (): void => {
    if (anyChild() && !cancelInterval) cancelInterval = deps.every(tick, IDLE_CHECK_MS);
    else if (!anyChild() && cancelInterval) {
      cancelInterval();
      cancelInterval = null;
    }
  };

  const removePidfile = (entry: Entry, pid: number | undefined): void => {
    try {
      const path = pidfilePath(deps.storageDir(), entry.root);
      const held = JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown };
      // A sibling service may have taken the file over; only remove our own.
      if (held.pid === pid) rmSync(path, { force: true });
    } catch {
      // No file, or one that is not ours to judge.
    }
  };

  const writePidfile = (entry: Entry, pid: number): void => {
    try {
      mkdirSync(deps.storageDir(), { recursive: true });
      writeFileSync(pidfilePath(deps.storageDir(), entry.root), JSON.stringify({ pid, owner: deps.ownerPid, root: entry.root }), 'utf8');
    } catch {
      // Without a pidfile a later service cannot reap this child; it still ends when the owner stops it.
    }
  };

  /** Ask the child to end; its exit is not a failure. `hard` skips the grace. */
  const stopChild = (entry: Entry, hard: boolean): void => {
    const child = entry.child;
    if (!child) return;
    entry.stopping = true;
    entry.stopRequestedAt ??= deps.now();
    try {
      child.kill(hard ? 'SIGKILL' : 'SIGTERM');
    } catch {
      // Already gone.
    }
    if (hard) {
      removePidfile(entry, child.pid);
      entry.child = null;
      entry.stopping = false;
      entry.stopRequestedAt = null;
    }
  };

  const markStopped = (entry: Entry): void => {
    entry.state = 'off';
    entry.since = deps.now();
  };

  const fail = (entry: Entry, counted: boolean): void => {
    const now = deps.now();
    if (counted) entry.failures += 1;
    if (entry.failures >= GIVE_UP_AFTER) {
      entry.state = 'failed';
      entry.retryAt = now + RETRY_FAILED_MS;
    } else {
      entry.state = 'backoff';
      const wait = counted ? BACKOFF_MS[Math.min(entry.failures - 1, BACKOFF_MS.length - 1)]! : 0;
      entry.retryAt = now + wait;
    }
    entry.since = now;
  };

  const finishProbe = (entry: Entry, token: number, head: number | null): void => {
    // Abandoned (idle stop, shutdown) while the probe ran: the entry is not ours to move.
    if (entry.startToken !== token || entry.child || entry.retryAt !== Number.POSITIVE_INFINITY) return;
    if (head !== null) {
      entry.seq = head;
      fail(entry, false);
    } else fail(entry, true);
  };

  const attach = (entry: Entry, child: LiveChild): void => {
    let buffer = '';
    let errText = '';
    let truncated: { head: number | null } | null = null;
    const noteTruncated = (text: string): void => {
      truncated ??= truncatedHead(text);
    };
    child.onStdout((chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (line.length === 0) continue;
        const seq = seqOf(line);
        if (seq !== null) {
          entry.seq = entry.seq === null ? seq : Math.max(entry.seq, seq);
          entry.dirty = true;
          // An event means the follower works: the run of failures is over.
          entry.failures = 0;
        } else noteTruncated(line);
      }
      if (buffer.length > LINE_BUFFER_MAX) {
        // A line that never ends is not a journal record; end this child and let the backoff decide.
        buffer = '';
        stopChild(entry, true);
        fail(entry, true);
      }
    });
    child.onStderr((chunk) => {
      errText = (errText + chunk).slice(-STDERR_KEEP);
      noteTruncated(errText);
    });
    child.onExit(() => {
      noteTruncated(buffer);
      if (entry.child !== child) return;
      removePidfile(entry, child.pid);
      entry.child = null;
      const wasStopping = entry.stopping;
      entry.stopping = false;
      entry.stopRequestedAt = null;
      syncInterval();
      if (wasStopping) {
        markStopped(entry);
        return;
      }
      if (truncated) {
        // The retained journal no longer reaches back to `since`: read everything again, then follow from the head.
        entry.dirty = true;
        if (truncated.head !== null) {
          entry.seq = truncated.head;
          fail(entry, false);
          return;
        }
        // The message did not carry the head: ask for it. Until it answers, no restart (it would be refused the same way).
        entry.state = 'backoff';
        entry.retryAt = Number.POSITIVE_INFINITY;
        entry.since = deps.now();
        const token = entry.startToken;
        void deps.journalHead(entry.root).then(
          (head) => finishProbe(entry, token, head),
          () => finishProbe(entry, token, null),
        );
        return;
      }
      // Any other exit (the follower is meant to run until stopped) falls back to polling and tries again after the backoff.
      entry.dirty = true;
      fail(entry, true);
    });
  };

  const start = (entry: Entry): void => {
    if (entry.starting || entry.child) return;
    entry.state = 'starting';
    entry.since = deps.now();
    const token = ++entry.startToken;
    const starting = (async () => {
      const now = deps.now();
      const known = entry.journal;
      const fresh = known !== null && now >= known.at && now - known.at < JOURNAL_CHECK_TTL_MS;
      let on: boolean;
      if (fresh) on = known!.on;
      else {
        try {
          on = await deps.journalOn(entry.root);
          entry.journal = { on, at: deps.now() };
        } catch {
          // Could not read the setting: polling carries on, and the read is tried again soon.
          entry.journal = { on: false, at: deps.now() - (JOURNAL_CHECK_TTL_MS - JOURNAL_CHECK_FAIL_TTL_MS) };
          on = false;
        }
      }
      if (token !== entry.startToken) return;
      if (!on) {
        markStopped(entry);
        return;
      }
      let child: LiveChild | null = null;
      try {
        child = await deps.spawnChild(entry.root, entry.seq ?? 0);
      } catch {
        child = null;
      }
      if (token !== entry.startToken) {
        // Abandoned while spawning (capability lost, shutdown): do not leave the child behind.
        child?.kill('SIGKILL');
        return;
      }
      if (!child || child.pid === undefined) {
        fail(entry, true);
        return;
      }
      entry.child = child;
      entry.stopping = false;
      entry.state = 'following';
      entry.since = deps.now();
      writePidfile(entry, child.pid);
      attach(entry, child);
      syncInterval();
    })();
    entry.starting = starting;
    // Cleared after the assignment, so a start that finishes without waiting does not leave itself behind.
    void starting.finally(() => {
      if (entry.starting === starting) entry.starting = null;
    });
  };

  function tick(): void {
    const now = deps.now();
    for (const entry of entries.values()) {
      if (!entry.child) continue;
      if (entry.stopping) {
        if (entry.stopRequestedAt !== null && now - entry.stopRequestedAt >= KILL_ESCALATE_MS) {
          stopChild(entry, true);
          markStopped(entry);
        }
        continue;
      }
      if (entry.lastRequestAt === null || now < entry.lastRequestAt || now - entry.lastRequestAt >= IDLE_STOP_MS) stopChild(entry, false);
    }
    syncInterval();
  }

  function reapStale(): void {
    reaped = true;
    let names: string[];
    try {
      names = readdirSync(deps.storageDir()).filter((name) => /^live-[0-9a-f]+\.pid$/.test(name));
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(deps.storageDir(), name);
      try {
        const held = JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown; owner?: unknown };
        const pid = held.pid;
        const owner = held.owner;
        if (typeof pid !== 'number' || typeof owner !== 'number') continue;
        // A live owner is a sibling service's follower: not ours to kill.
        if (owner === deps.ownerPid || deps.isAlive(owner)) continue;
        if (deps.isAlive(pid)) {
          const command = deps.commandOf(pid);
          // The pid may have been reused by something else: only a `bd events tail` is killed.
          if (command !== null && /\bbd\b.*\bevents\b.*\btail\b/.test(command)) deps.killGroup(pid, 'SIGKILL');
        }
        rmSync(path, { force: true });
      } catch {
        // An unreadable file is left alone.
      }
    }
  }

  return {
    ensure(root, capable) {
      const entry = entryFor(root);
      const now = deps.now();
      const previous = entry.lastRequestAt;
      entry.lastRequestAt = now;
      if (!reaped) reapStale();
      if (!capable) {
        entry.startToken += 1;
        entry.starting = null;
        if (entry.child) stopChild(entry, true);
        entry.state = 'off';
        entry.dirty = false;
        syncInterval();
        return;
      }
      if (entry.child || entry.starting) return;
      // A panel that has just opened (or woken up) is not followed yet: one request has to come first, so a closed panel's
      // minute poll never starts a process.
      if (previous === null || now < previous || now - previous >= IDLE_STOP_MS) {
        if (entry.state === 'starting') entry.state = 'off';
        return;
      }
      if (entry.state === 'failed') {
        if (entry.retryAt === null || now < entry.retryAt) return;
        entry.failures = 0;
      } else if (entry.state === 'backoff') {
        if (entry.retryAt !== null && now < entry.retryAt) return;
      }
      start(entry);
    },
    state(root) {
      const entry = entries.get(root);
      return entry ? { state: entry.state, since: entry.since } : { state: 'off', since: null };
    },
    journalChanged(root) {
      const entry = entries.get(root);
      if (entry) entry.journal = null;
    },
    dirty: (root) => entries.get(root)?.dirty ?? false,
    take(root) {
      const entry = entries.get(root);
      if (entry) entry.dirty = false;
    },
    nudge(root) {
      entryFor(root).dirty = true;
    },
    tick,
    stopAll() {
      for (const entry of entries.values()) {
        entry.startToken += 1;
        entry.starting = null;
        stopChild(entry, true);
        entry.state = 'off';
        entry.dirty = false;
      }
      syncInterval();
    },
    reapStale,
  };
}

// ---------------------------------------------------------------------------------------------
// The real thing
// ---------------------------------------------------------------------------------------------

function realChild(child: ReturnType<typeof spawn>): LiveChild {
  return {
    pid: child.pid,
    onStdout: (listener) => {
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', listener);
    },
    onStderr: (listener) => {
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', listener);
    },
    onExit: (listener) => {
      let done = false;
      const once = (code: number | null) => {
        if (done) return;
        done = true;
        listener(code);
      };
      child.on('close', (code) => once(code));
      child.on('error', () => once(null));
    },
    kill: (signal) => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // Already gone.
        }
      }
    },
  };
}

function realDeps(): LiveDeps {
  return {
    now: Date.now,
    async journalOn(root) {
      const result = await runBd(root, ['--readonly', 'config', 'get', 'events-journal'], { timeoutMs: 8_000, deadlineMs: 9_000 });
      if (result.code !== 0) throw new Error(result.stderr || `bd exited with code ${result.code}`);
      return result.stdout.trim() === 'true';
    },
    async journalHead(root) {
      const result = await runBd(root, ['--readonly', 'events', 'tail', '--since', '0', '--limit', '1', '--json'], { timeoutMs: 8_000, deadlineMs: 9_000 });
      // Refused with the head in the error object; or, when nothing was pruned after all, the first record (no head to use).
      return truncatedHead(`${result.stdout}\n${result.stderr}`)?.head ?? null;
    },
    async spawnChild(root, since) {
      const exe = await resolveExecutable('bd');
      if (!exe) return null;
      try {
        // Own process group, so the whole group can be killed. No shell. No --json: followed output is JSON lines only without it.
        const child = spawn(exe, ['events', 'tail', '--since', String(since), '--follow', '--readonly'], {
          cwd: root,
          env: childEnv(),
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.on('error', () => {});
        // Never keep the service alive for a follower.
        child.unref();
        return realChild(child);
      } catch {
        return null;
      }
    },
    storageDir: () => join(tmpdir(), 'openchamber-beads'),
    ownerPid: process.pid,
    isAlive(pid) {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
      }
    },
    commandOf(pid) {
      try {
        return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', timeout: 2_000 }).trim() || null;
      } catch {
        return null;
      }
    },
    killGroup(pid, signal) {
      try {
        process.kill(-pid, signal);
      } catch {
        try {
          process.kill(pid, signal);
        } catch {
          // Already gone.
        }
      }
    },
    every(fn, ms) {
      const timer = setInterval(fn, ms);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}

let current: Follower | null = null;
let storageDirForLive: (() => string) | null = null;

/** Where pidfiles go; follows the snapshot's storage override. Set by snapshot.ts. */
export function setLiveStorageDir(fn: (() => string) | null): void {
  storageDirForLive = fn;
}

/** The service's one follower. */
export function follower(): Follower {
  current ??= createFollower({ ...realDeps(), storageDir: () => (storageDirForLive ? storageDirForLive() : join(tmpdir(), 'openchamber-beads')) });
  return current;
}

/** Replaces the follower (null restores the real one). Stops the one being replaced. For tests. */
export function setFollower(next: Follower | null): void {
  current?.stopAll();
  current = next;
}
