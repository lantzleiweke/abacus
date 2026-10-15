import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BdProvider } from '../../src/service/bd/adapter';
import { resetAuditSchemaCache } from '../../src/service/bd/audit';
import { childEnv, runBd, runBdJson } from '../../src/service/bd/exec';
import { follower } from '../../src/service/live';
import { createRoutes } from '../../src/service/routes';
import { getSnapshot, resetSnapshotState, setClock, setStorageDir } from '../../src/service/snapshot';
import type { SnapshotResponse } from '../../src/shared/types';

const run = promisify(execFile);

function full(res: SnapshotResponse): Extract<SnapshotResponse, { unchanged: false }> {
  if (res.unchanged) throw new Error('expected a full snapshot');
  return res;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Pids of `bd events tail` processes whose command line carries this marker (the scratch project's own cwd is not in argv, so match any and compare counts). */
async function tailPids(): Promise<number[]> {
  try {
    const { stdout } = await run('pgrep', ['-f', 'bd events tail --since']);
    return stdout.split('\n').filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

// Real bd 1.3.x and dolt, in a scratch project under the OS temp dir. Never a real project.
// The journal is turned on here, in the scratch project, the way the Task 9 button will do it for a user.
describe.skipIf(process.env.BD_INTEGRATION !== '1')('events follower (embedded bd 1.3)', () => {
  let tmp: string;
  let root: string;
  let now: number;
  let before: number[];

  async function bd(args: string[]): Promise<void> {
    const result = await runBd(root, args);
    if (result.code !== 0) throw new Error(`bd ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }

  /** Polls with the real clock until `until` says so; the fake service clock stays put, so only the follower's nudge can pass the throttle. */
  async function pollUntil(cursor: string, until: (res: SnapshotResponse) => boolean, withinMs: number): Promise<{ res: SnapshotResponse; ms: number }> {
    const started = Date.now();
    for (;;) {
      const res = await getSnapshot(root, cursor);
      if (until(res)) return { res, ms: Date.now() - started };
      if (Date.now() - started > withinMs) throw new Error(`no change after ${withinMs} ms (follower ${JSON.stringify(follower().state(root))})`);
      await sleep(100);
    }
  }

  beforeAll(async () => {
    before = await tailPids();
    tmp = await realpath(await mkdtemp(join(tmpdir(), 'oc-beads-live-int-')));
    root = join(tmp, 'proj');
    await run('mkdir', [root]);
    await run('git', ['init', '-q'], { cwd: root, env: childEnv() });
    await run('git', ['config', 'user.name', 'Scratch User'], { cwd: root, env: childEnv() });
    await bd(['init', '--prefix', 'liv', '--non-interactive', '--quiet']);
    await bd(['config', 'set', 'events-journal', 'true']);
    setStorageDir(join(tmp, 'state'));
    now = Date.now();
    setClock(() => now);
  }, 60_000);

  afterAll(async () => {
    setClock(null);
    // Stops the follower's child the way the service does at shutdown.
    resetSnapshotState();
    setStorageDir(null);
    resetAuditSchemaCache();
    await sleep(300);
    expect((await tailPids()).filter((pid) => !before.includes(pid))).toEqual([]);
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('follows the journal: a change made by another bd moves the cursor within 5 s, without a signal read', async () => {
    const signal = vi.spyOn(BdProvider.prototype, 'changeSignal');
    const first = full(await getSnapshot(root));
    expect(first.capabilities.eventsJournal).toBe(true);
    // A second request inside the window: the panel is open, so the follower may start.
    await getSnapshot(root, first.cursor);
    await vi.waitFor(() => expect(follower().state(root).state).toBe('following'), { timeout: 10_000, interval: 100 });
    // The child replays the journal from the start; that one nudge is exported and consumed.
    await sleep(500);
    const base = full(await getSnapshot(root));
    signal.mockClear();

    const created = await runBdJson<{ id: string }>(root, ['create', 'Seen by the follower', '-t', 'task', '-p', '1', '--actor', 'Teammate', '--json']);
    // About 0.7 s when the file runs alone. The bound is looser because the suite runs files in parallel and a loaded machine
    // stretches the export itself (2.8 s seen); the service clock never moves here, so only the nudge can get past the 4 s window.
    const { res, ms } = await pollUntil(base.cursor, (r) => !r.unchanged, 5_000);
    expect(ms).toBeLessThan(5_000);
    expect(full(res).beads.map((b) => b.id)).toContain(created.id);
    expect(signal).not.toHaveBeenCalled();
    signal.mockRestore();
    expect(follower().state(root).state).toBe('following');
  }, 60_000);

  it('only one child runs for the project', async () => {
    const mine = (await tailPids()).filter((pid) => !before.includes(pid));
    expect(mine).toHaveLength(1);
  });

  it('polling still shows the change after the child is killed', async () => {
    const [pid] = (await tailPids()).filter((p) => !before.includes(p));
    expect(pid).toBeDefined();
    const base = full(await getSnapshot(root));
    process.kill(pid!, 'SIGKILL');
    await vi.waitFor(() => expect(follower().state(root).state).toBe('backoff'), { timeout: 5_000, interval: 50 });

    const created = await runBdJson<{ id: string }>(root, ['create', 'Made while the follower was down', '-t', 'task', '-p', '2', '--actor', 'Teammate', '--json']);
    // The child's exit left a nudge behind; spend it, so only polling (the change signal after the window) can show the new bead.
    // The 2 s backoff is on the real clock and the test is well inside it, so no new child is started meanwhile.
    follower().take(root);
    expect(follower().dirty(root)).toBe(false);
    now += 5_000;
    const after = full(await getSnapshot(root, base.cursor));
    expect(after.beads.map((b) => b.id)).toContain(created.id);
    expect(after.freshness.localError).toBeNull();
  }, 60_000);

  it('shutdown leaves no child and no pidfile', async () => {
    // The idle rule needs minutes of real time and is covered in the unit test; here the shutdown path.
    follower().stopAll();
    await sleep(300);
    expect((await tailPids()).filter((pid) => !before.includes(pid))).toEqual([]);
    const files = await readdir(join(tmp, 'state')).catch(() => [] as string[]);
    expect(files.filter((f) => f.startsWith('live-'))).toEqual([]);
  });
});

// The explicit enable on real bd 1.3.x: the journal starts off, the route turns it on, the tracked config.yaml changes, and the follower
// starts on the panel's next requests. Scratch project only.
describe.skipIf(process.env.BD_INTEGRATION !== '1')('enabling live updates (embedded bd 1.3)', () => {
  let tmp: string;
  let root: string;
  let before: number[];
  const routes = createRoutes();

  async function bd(args: string[]): Promise<void> {
    const result = await runBd(root, args);
    if (result.code !== 0) throw new Error(`bd ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }

  beforeAll(async () => {
    before = await tailPids();
    tmp = await realpath(await mkdtemp(join(tmpdir(), 'oc-beads-enable-int-')));
    root = join(tmp, 'proj');
    await run('mkdir', [root]);
    await run('git', ['init', '-q'], { cwd: root, env: childEnv() });
    await run('git', ['config', 'user.name', 'Scratch User'], { cwd: root, env: childEnv() });
    await bd(['init', '--prefix', 'ena', '--non-interactive', '--quiet']);
    setStorageDir(join(tmp, 'state'));
  }, 60_000);

  afterAll(async () => {
    resetSnapshotState();
    setStorageDir(null);
    resetAuditSchemaCache();
    await sleep(300);
    expect((await tailPids()).filter((pid) => !before.includes(pid))).toEqual([]);
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('refuses without confirm, reports the journal off, and starts no follower while it is off', async () => {
    const status = await routes.eventsStatus({ directory: root });
    expect(status).toMatchObject({ status: 200, json: { available: true, journal: 'off', live: 'off' } });
    const refused = await routes.enableEvents({ directory: root });
    expect(refused.status).toBe(400);
    const first = full(await getSnapshot(root));
    await getSnapshot(root, first.cursor);
    await sleep(500);
    expect(follower().state(root).state).toBe('off');
    expect((await tailPids()).filter((pid) => !before.includes(pid))).toEqual([]);
    expect(await readFile(join(root, '.beads', 'config.yaml'), 'utf8')).not.toMatch(/events-journal/);
  }, 60_000);

  it('enables it: config.yaml changes, the answer says on, and the follower starts on the next requests', async () => {
    const file = join(root, '.beads', 'config.yaml');
    const beforeText = await readFile(file, 'utf8');
    const res = await routes.enableEvents({ directory: root, confirm: true });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, status: { available: true, journal: 'on' } });
    const afterText = await readFile(file, 'utf8');
    expect(afterText).not.toBe(beforeText);
    expect(afterText).toMatch(/events-journal:\s*true/);
    // The next panel requests (two inside the window: a panel that is open) start the child; no wait for the cached "off" to expire.
    const cursor = full(await getSnapshot(root)).cursor;
    await getSnapshot(root, cursor);
    await vi.waitFor(() => expect(follower().state(root).state).toBe('following'), { timeout: 10_000, interval: 100 });
    const mine = (await tailPids()).filter((pid) => !before.includes(pid));
    expect(mine).toHaveLength(1);
    expect(await routes.eventsStatus({ directory: root })).toMatchObject({ status: 200, json: { journal: 'on', live: 'following' } });
    follower().stopAll();
  }, 60_000);
});
