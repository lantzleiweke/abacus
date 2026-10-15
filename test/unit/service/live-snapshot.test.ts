import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/service/bd/exec', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/service/bd/exec')>()),
  runBd: vi.fn(),
  runBdJson: vi.fn(),
  runDolt: vi.fn(),
  runGit: vi.fn(),
}));
vi.mock('../../../src/service/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/service/workspace')>()),
  detectWorkspace: vi.fn(),
}));
vi.mock('../../../src/service/bd/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/service/bd/audit')>()),
  readAuditEvents: vi.fn(),
  runSql: vi.fn(),
}));

import { BdProvider, notePanelWrite, resetPanelActorCache } from '../../../src/service/bd/adapter';
import { readAuditEvents, runSql } from '../../../src/service/bd/audit';
import { BdError, runBd, runBdJson, runDolt, runGit } from '../../../src/service/bd/exec';
import { setFollower, type Follower, type LiveState } from '../../../src/service/live';
import { ProjectStore, getSnapshot, projectStore, resetSnapshotState, setClock, setStorageDir } from '../../../src/service/snapshot';
import { startPublish, startPull, syncSettled, writesBlocked } from '../../../src/service/sync';
import { detectWorkspace } from '../../../src/service/workspace';
import type { SnapshotResponse, WorkspaceState } from '../../../src/shared/types';

const bd = vi.mocked(runBd);
const bdJson = vi.mocked(runBdJson);
const dolt = vi.mocked(runDolt);
const git = vi.mocked(runGit);
const detect = vi.mocked(detectWorkspace);
const auditRead = vi.mocked(readAuditEvents);
const sql = vi.mocked(runSql);

const ok = (stdout: string) => ({ stdout, stderr: '', code: 0 });
const fail = (stderr: string) => ({ stdout: '', stderr, code: 1 });

const STATUSES = JSON.stringify({ built_in_statuses: [{ name: 'open', category: 'active', icon: 'o' }] });
const TYPES = JSON.stringify({ core_types: [{ name: 'task', description: '' }] });
const ISSUE = JSON.stringify({ _type: 'issue', id: 'a', title: 'A', status: 'open', priority: 2, issue_type: 'task', created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:00Z' });
const SERVER_HALF = fail('Error: failed to commit pending changes before pull: Error 1105 (HY000): error: the table(s) issues are in conflict\n');

type Row = Record<string, unknown>;
type Fake = {
  exportCalls: number;
  logRows: Row[] | Error;
  logQueries: number;
  mergeStatus: Row[];
  mergeQueries: number;
  pulls: Array<ReturnType<typeof ok>>;
  holdPull: Promise<void> | null;
  /** When true the change-signal query answers (a steady signal); otherwise it fails, as most of these tests want no signal. */
  signal: boolean;
  /** Holds the signal read open until it resolves. */
  holdSignal: Promise<void> | null;
  /** Holds the export open until it resolves. */
  holdExport: Promise<void> | null;
  /** Makes every export fail. */
  exportFails?: boolean;
  signalReads: number;
};
let fake: Fake;

function install(): void {
  bdJson.mockImplementation(async (dir, args, opts) => JSON.parse((await bd(dir, args, opts)).stdout) as never);
  bd.mockImplementation(async (_dir, args) => {
    const plain = args[0] === '--actor' ? args.slice(2) : args;
    const name = plain.find((a) => !a.startsWith('-'));
    if (name === 'export') {
      fake.exportCalls += 1;
      if (fake.holdExport) await fake.holdExport;
      if (fake.exportFails) throw new BdError('exit', 'export failed');
      return ok(ISSUE);
    }
    if (name === 'comments') return ok(JSON.stringify({ id: 'c1', issue_id: 'a', author: 'Ann (panel)', text: 'hi', created_at: '2026-10-14T10:00:00Z' }));
    if (name === 'statuses') return ok(STATUSES);
    if (name === 'types') return ok(TYPES);
    if (name === 'ready') return ok('[]');
    if (name === 'vc') return ok(JSON.stringify({ branch: 'main', commit: 'c1', schema_version: 1 }));
    if (name === 'sql') return ok(JSON.stringify([{ working: 's1', head: 'h' }]));
    if (name === 'dolt' && args.includes('remote')) return ok(JSON.stringify([{ name: 'origin', url: 'file:///remote' }]));
    if (name === 'dolt' && args.includes('pull')) {
      if (fake.holdPull) await fake.holdPull;
      return fake.pulls.shift() ?? ok('Pull complete.');
    }
    if (name === 'dolt' && args.includes('push')) return ok('Push complete.');
    throw new Error(`unexpected bd call: ${args.join(' ')}`);
  });
  dolt.mockImplementation(async () => ok(JSON.stringify({ rows: [{ working: 's1', head: 'h' }] })));
  git.mockResolvedValue(ok('Ann\n'));
  sql.mockImplementation(async (_root, _mode, query) => {
    if (/DOLT_HASHOF/i.test(query) && fake.signal) {
      fake.signalReads += 1;
      if (fake.holdSignal) await fake.holdSignal;
      return [{ working: 's1', head: 'h' }];
    }
    // The local head a publish checks against its preview (not the change signal above, which uses DOLT_HASHOF).
    if (/^SELECT HASHOF\('HEAD'\)/i.test(query)) return [{ head: 'aaaa1111' }];
    if (/dolt_status/i.test(query)) return [{ n: 0 }];
    if (/active_branch/i.test(query)) return [{ branch: 'main' }];
    if (/dolt_remote_branches/i.test(query)) return [{ n: 1 }];
    if (/dolt_log/i.test(query)) {
      fake.logQueries += 1;
      if (fake.logRows instanceof Error) throw fake.logRows;
      return /COUNT\(\*\)/i.test(query) ? [{ n: fake.logRows.length }] : fake.logRows;
    }
    if (/dolt_merge_status/i.test(query)) {
      fake.mergeQueries += 1;
      return fake.mergeStatus;
    }
    if (/dolt_conflicts_issues|DOLT_PREVIEW_MERGE_CONFLICTS/i.test(query)) return [];
    throw new Error(`unexpected sql: ${query}`);
  });
}

const commit = (n: number): Row => ({ commit_hash: `c${n}`.padEnd(8, '0'), committer: 'root', date: '2026-10-14 12:00:00', message: `bd: update (auto-commit) by x [a-${n}]` });

let tmp: string;
let root: string;
let now: number;
const T0 = Date.parse('2026-10-14T10:00:00.000Z');

function workspace(over: Partial<Extract<WorkspaceState, { kind: 'ok' }>> = {}): WorkspaceState {
  return { kind: 'ok', root, mode: 'embedded', bdVersion: '1.3.1', hasRemote: true, projectName: 'demo', ...over };
}

function full(res: SnapshotResponse): Extract<SnapshotResponse, { unchanged: false }> {
  if (res.unchanged) throw new Error('expected a full snapshot');
  return res;
}

beforeEach(async () => {
  for (const mock of [bd, bdJson, dolt, git, detect, auditRead, sql]) mock.mockReset();
  auditRead.mockResolvedValue([]);
  resetPanelActorCache();
  resetSnapshotState();
  tmp = await mkdtemp(join(tmpdir(), 'oc-beads-snapsync-'));
  root = join(tmp, 'proj');
  await mkdir(join(root, '.beads'), { recursive: true });
  await writeFile(join(root, '.beads', 'metadata.json'), JSON.stringify({ dolt_mode: 'embedded', dolt_database: 'testdb' }));
  setStorageDir(join(tmp, 'state'));
  now = T0;
  setClock(() => now);
  fake = { exportCalls: 0, logRows: [commit(1), commit(2)], logQueries: 0, mergeStatus: [{ is_merging: 0 }], mergeQueries: 0, pulls: [], holdPull: null, signal: false, holdSignal: null, holdExport: null, signalReads: 0 };
  install();
  detect.mockResolvedValue(workspace());
});

afterEach(async () => {
  setClock(null);
  setStorageDir(null);
  resetSnapshotState();
  await rm(tmp, { recursive: true, force: true });
});


type FakeFollower = Follower & { liveState: LiveState; nudged: boolean; ensured: Array<[string, boolean]>; takes: number; nudges: number };
let live: FakeFollower;

function fakeFollower(): FakeFollower {
  const f: FakeFollower = {
    liveState: 'following',
    nudged: false,
    ensured: [],
    takes: 0,
    nudges: 0,
    ensure(r, capable) {
      f.ensured.push([r, capable]);
    },
    state: () => ({ state: f.liveState, since: null }),
    dirty: () => f.nudged,
    take() {
      f.takes += 1;
      f.nudged = false;
    },
    nudge() {
      f.nudges += 1;
      f.nudged = true;
    },
    journalChanged() {},
    tick() {},
    stopAll() {},
    reapStale() {},
  };
  return f;
}

beforeEach(() => {
  live = fakeFollower();
  setFollower(live);
  fake.signal = true;
});

afterEach(() => {
  setFollower(null);
});

describe('snapshot with the events follower', () => {
  it('asks the follower on every request, with the capability of the installed bd', async () => {
    await getSnapshot(root);
    detect.mockResolvedValue(workspace({ bdVersion: '1.2.2' }));
    await getSnapshot(root, undefined, true);
    expect(live.ensured).toEqual([
      [root, true],
      [root, false],
    ]);
  });

  it('an event marks dirty and the refresh exports without reading the signal', async () => {
    await getSnapshot(root);
    expect(fake.exportCalls).toBe(1);
    now += 1_000;
    live.nudged = true;
    const res = await getSnapshot(root);
    expect(res.unchanged).toBe(false);
    expect(fake.exportCalls).toBe(2);
    expect(fake.signalReads).toBe(0);
    expect(live.takes).toBe(1);
    expect(live.nudged).toBe(false);
  });

  it('a nudge bypasses the 4 s throttle once, and no further', async () => {
    await getSnapshot(root);
    now += 500;
    live.nudged = true;
    await getSnapshot(root);
    now += 500;
    await getSnapshot(root);
    expect(fake.exportCalls).toBe(2);
  });

  it('while following, polls between minute passes read no signal and export nothing', async () => {
    await getSnapshot(root);
    for (let i = 0; i < 10; i += 1) {
      now += 5_000;
      await getSnapshot(root);
    }
    expect(fake.exportCalls).toBe(1);
    expect(fake.signalReads).toBe(0);
  });

  it('a pull does not rely on the journal: the minute export still runs while following', async () => {
    await getSnapshot(root);
    now += 61_000;
    await getSnapshot(root);
    expect(fake.exportCalls).toBe(2);
  });

  it('a finished sync job nudges the follower, because a pull is not journaled', async () => {
    await getSnapshot(root);
    startPull(root, 'embedded');
    await syncSettled(root);
    expect(live.nudges).toBeGreaterThan(0);
    now += 5_000;
    await getSnapshot(root);
    expect(fake.exportCalls).toBeGreaterThan(1);
  });

  it('tells the panel whether the follower is following, on full and unchanged answers alike, with no bd call (L6)', async () => {
    const full = await getSnapshot(root);
    expect(full).toMatchObject({ unchanged: false, following: true });
    const exports = fake.exportCalls;
    const again = await getSnapshot(root, full.cursor);
    expect(again).toMatchObject({ unchanged: true, following: true });
    live.liveState = 'backoff';
    expect(await getSnapshot(root, full.cursor)).toMatchObject({ unchanged: true, following: false });
    expect(fake.exportCalls).toBe(exports);
  });

  it('reads the signal as before when the follower is not following', async () => {
    live.liveState = 'backoff';
    await getSnapshot(root);
    now += 5_000;
    await getSnapshot(root);
    expect(fake.signalReads).toBe(2);
    expect(fake.exportCalls).toBe(1);
  });

  it('a failed nudged export is owed at the next window: the bypass happens once per nudge', async () => {
    await getSnapshot(root);
    expect(fake.exportCalls).toBe(1);
    now += 1_000;
    live.nudged = true;
    fake.exportFails = true;
    const failed = await getSnapshot(root);
    expect(full(failed).freshness.localErrorDetail).toContain('export failed');
    expect(fake.exportCalls).toBe(2);
    // The nudge was spent by the attempt; the follower does not report it again.
    expect(live.nudged).toBe(false);

    // Polls inside the window do not retry, however many come.
    for (let i = 0; i < 5; i += 1) {
      now += 500;
      await getSnapshot(root);
    }
    expect(fake.exportCalls).toBe(2);

    // The next window retries the owed export, once, and it succeeds.
    fake.exportFails = false;
    now += 4_000;
    const res = await getSnapshot(root);
    expect(fake.exportCalls).toBe(3);
    expect(full(res).freshness.localError).toBeNull();
    expect(fake.signalReads).toBe(0);

    // Nothing is owed any more: back to no exports between minute passes.
    now += 10_000;
    await getSnapshot(root);
    expect(fake.exportCalls).toBe(3);
  });
});
