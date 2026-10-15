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
  return { kind: 'ok', root, mode: 'embedded', bdVersion: '1.2.2', hasRemote: true, projectName: 'demo', ...over };
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

describe('snapshot sync fields', () => {
  it('names the panel\'s own actor, so the panel can show "you (panel)"', async () => {
    expect(full(await getSnapshot(root)).panelActor).toBe('Ann (panel)');
  });

  it('moves the cursor when the panel\'s actor name changes, so the panel learns the new one', async () => {
    const first = full(await getSnapshot(root));
    resetPanelActorCache();
    git.mockResolvedValue(ok('Ann Lee\n'));
    now += 61_000;
    const next = await getSnapshot(root, first.cursor);
    expect(next.unchanged).toBe(false);
    expect(full(next).panelActor).toBe('Ann Lee (panel)');
  });

  it('counts unpublished changes for a project with a remote', async () => {
    const res = full(await getSnapshot(root));
    expect(res.freshness.unpublished).toBe(2);
    expect(res.freshness.teamSyncedAt).toBeNull();
    expect(res.sync).toEqual({ kind: 'idle' });
  });

  it('is null, and asks nothing, when the project has no remote', async () => {
    detect.mockResolvedValue(workspace({ hasRemote: false }));
    const res = full(await getSnapshot(root));
    expect(res.freshness.unpublished).toBeNull();
    expect(fake.logQueries).toBe(0);
  });

  it('counts at most every 30 seconds', async () => {
    await getSnapshot(root);
    now += 10_000;
    await getSnapshot(root);
    now += 10_000;
    await getSnapshot(root);
    expect(fake.logQueries).toBe(1);
    fake.logRows = [commit(1)];
    now += 11_000;
    expect(full(await getSnapshot(root)).freshness.unpublished).toBe(1);
    expect(fake.logQueries).toBe(2);
  });

  it('keeps the last count when a later count fails, and tries again after the interval', async () => {
    await getSnapshot(root);
    fake.logRows = new BdError('timeout', 'timed out');
    now += 31_000;
    expect(full(await getSnapshot(root)).freshness.unpublished).toBe(2);
    expect(fake.logQueries).toBe(2);
    now += 5_000;
    await getSnapshot(root);
    expect(fake.logQueries).toBe(2);
    fake.logRows = [commit(1), commit(2), commit(3)];
    now += 31_000;
    expect(full(await getSnapshot(root)).freshness.unpublished).toBe(3);
  });

  it('puts why a count failed in the details (a missing Dolt tool), and takes it out once a count works', async () => {
    fake.logRows = new BdError('not-found', 'dolt was not found on PATH or in the usual install folders');
    const res = full(await getSnapshot(root));
    expect(res.freshness.unpublished).toBeNull();
    expect(res.freshness.localError).toBeNull();
    expect(res.freshness.localErrorDetail).toContain('dolt was not found');
    fake.logRows = [commit(1)];
    now += 31_000;
    const later = full(await getSnapshot(root));
    expect(later.freshness.unpublished).toBe(1);
    expect(later.freshness.localErrorDetail ?? '').not.toContain('dolt was not found');
  });

  it('a count that fails right after a sync job waits out the interval too', async () => {
    await getSnapshot(root);
    startPull(root, 'embedded');
    await syncSettled(root);
    fake.logRows = new BdError('timeout', 'timed out');
    const before = fake.logQueries;
    await getSnapshot(root);
    expect(fake.logQueries).toBe(before + 1);
    now += 5_000;
    await getSnapshot(root);
    now += 5_000;
    await getSnapshot(root);
    expect(fake.logQueries).toBe(before + 1);
  });

  it('a poll already past its first check when Sync starts answers from what it holds, without counting or checking for a half-merge', async () => {
    detect.mockResolvedValue(workspace({ mode: 'server' }));
    fake.signal = true;
    await getSnapshot(root);
    // A half-merged database keeps writes blocked, which is what makes a poll check the merge state.
    fake.pulls = [SERVER_HALF];
    fake.mergeStatus = [{ is_merging: 1 }];
    startPull(root, 'server');
    await syncSettled(root);
    expect(writesBlocked(root)).toBe(true);
    const logBefore = fake.logQueries;
    const mergeBefore = fake.mergeQueries;

    // The refresh is due (past the 30 second count interval, short of the forced export) and its signal read is held open.
    now += 31_000;
    let releaseSignal = () => {};
    fake.holdSignal = new Promise<void>((resolve) => (releaseSignal = resolve));
    let releasePull = () => {};
    fake.holdPull = new Promise<void>((resolve) => (releasePull = resolve));
    const reads = fake.signalReads;
    const poll = getSnapshot(root);
    await vi.waitFor(() => expect(fake.signalReads).toBe(reads + 1));

    // Sync starts only now: the poll is already inside the refresh, past the early answer for a running job.
    startPublish(root, 'server', 'aaaa1111');
    releaseSignal();
    const res = full(await poll);
    expect(res.sync).toMatchObject({ kind: 'running', op: 'publish' });
    expect(fake.logQueries).toBe(logBefore);
    expect(fake.mergeQueries).toBe(mergeBefore);
    releasePull();
    await syncSettled(root);
  });

  it('says whether writes are blocked, and the cursor moves when that changes', async () => {
    detect.mockResolvedValue(workspace({ mode: 'server' }));
    const first = full(await getSnapshot(root));
    expect(first.writesBlocked).toBe(false);

    fake.pulls = [SERVER_HALF];
    fake.mergeStatus = [{ is_merging: 1 }];
    startPull(root, 'server');
    await syncSettled(root);
    const blocked = await getSnapshot(root, first.cursor);
    expect(blocked.unchanged).toBe(false);
    expect(full(blocked).writesBlocked).toBe(true);

    fake.mergeStatus = [{ is_merging: 0 }];
    now += 4_000;
    const clear = await getSnapshot(root, blocked.cursor);
    expect(clear.unchanged).toBe(false);
    expect(full(clear).writesBlocked).toBe(false);
  });

  it('clears a backed-out conflict on a poll once the team copy has nothing new, checking at most every 30 seconds', async () => {
    const first = full(await getSnapshot(root));
    fake.pulls = [fail('Error: merge origin/main: merge conflicts in issues require operator resolution; merge aborted and working set restored\n')];
    startPull(root, 'embedded');
    await syncSettled(root);
    // The team copy still has commits this one lacks.
    expect(full(await getSnapshot(root, first.cursor)).sync).toMatchObject({ kind: 'conflict', halfMerged: false });
    fake.logRows = [];
    now += 1_000;
    expect((await getSnapshot(root)).sync).toMatchObject({ kind: 'conflict' });
    now += 4_000;
    expect((await getSnapshot(root)).sync).toMatchObject({ kind: 'conflict' });
    now += 25_000;
    expect((await getSnapshot(root)).sync).toEqual({ kind: 'idle' });
  });

  it('looks at a half merge at most every 4 seconds, like the change signal', async () => {
    detect.mockResolvedValue(workspace({ mode: 'server' }));
    await getSnapshot(root);
    fake.pulls = [SERVER_HALF];
    fake.mergeStatus = [{ is_merging: 1 }];
    startPull(root, 'server');
    await syncSettled(root);
    const before = fake.mergeQueries;
    await getSnapshot(root);
    now += 1_000;
    await getSnapshot(root);
    now += 1_000;
    await getSnapshot(root);
    expect(fake.mergeQueries).toBe(before + 1);
    now += 4_000;
    await getSnapshot(root);
    expect(fake.mergeQueries).toBe(before + 2);
  });

  it('says writes are not blocked for a workspace that is not usable', async () => {
    detect.mockResolvedValue({ kind: 'no-workspace' } as WorkspaceState);
    expect(full(await getSnapshot(root)).writesBlocked).toBe(false);
  });

  it('counts again right after a sync job, and carries the new sync time', async () => {
    await getSnapshot(root);
    fake.logRows = [];
    startPull(root, 'embedded');
    await syncSettled(root);
    const res = full(await getSnapshot(root));
    expect(res.freshness.unpublished).toBe(0);
    expect(res.freshness.teamSyncedAt).toEqual(expect.stringMatching(/^\d{4}-\d\d-\d\dT/));
    expect(res.sync).toEqual({ kind: 'idle' });
  });

  it('answers from what it holds while a job runs, with the running state, and sees the job end', async () => {
    const first = full(await getSnapshot(root));
    let release = () => {};
    fake.holdPull = new Promise<void>((resolve) => (release = resolve));
    startPublish(root, 'embedded', 'aaaa1111');
    now += 10_000;
    const exportsBefore = fake.exportCalls;
    const during = full(await getSnapshot(root, first.cursor));
    expect(during.sync).toMatchObject({ kind: 'running', op: 'publish' });
    expect(during.beads.map((b) => b.id)).toEqual(['a']);
    expect(fake.exportCalls).toBe(exportsBefore);
    expect(during.cursor).not.toBe(first.cursor);

    release();
    await syncSettled(root);
    const after = await getSnapshot(root, during.cursor);
    expect(after.unchanged).toBe(false);
    expect(full(after).sync).toEqual({ kind: 'idle' });
  });

  it('puts a conflict in the snapshot and in the cursor', async () => {
    const first = full(await getSnapshot(root));
    fake.pulls = [fail('Error: merge origin/main: merge conflicts in issues require operator resolution; merge aborted and working set restored\n')];
    startPull(root, 'embedded');
    await syncSettled(root);
    const res = await getSnapshot(root, first.cursor);
    expect(res.unchanged).toBe(false);
    expect(full(res).sync).toMatchObject({ kind: 'conflict', halfMerged: false });
    expect((await getSnapshot(root, res.cursor)).unchanged).toBe(true);
  });

  it('a half-merged server database keeps being checked, a window at a time, until it is clear', async () => {
    detect.mockResolvedValue(workspace({ mode: 'server' }));
    await getSnapshot(root);
    fake.pulls = [SERVER_HALF];
    fake.mergeStatus = [{ is_merging: 1 }];
    startPull(root, 'server');
    await syncSettled(root);
    expect(writesBlocked(root)).toBe(true);

    const still = full(await getSnapshot(root));
    expect(still.sync).toMatchObject({ kind: 'conflict', halfMerged: true });
    expect(writesBlocked(root)).toBe(true);

    fake.mergeStatus = [{ is_merging: 0 }];
    now += 4_000;
    const clear = full(await getSnapshot(root));
    expect(clear.sync).toEqual({ kind: 'idle' });
    expect(writesBlocked(root)).toBe(false);
  });

  it('never asks whether a merge is stuck when nothing is blocked', async () => {
    detect.mockResolvedValue(workspace({ mode: 'server' }));
    await getSnapshot(root);
    await getSnapshot(root);
    expect(fake.mergeQueries).toBe(0);
  });
});

describe('catching up after a panel write', () => {
  it('reads the project again on the next poll after a panel write, inside the 4 s window', async () => {
    await getSnapshot(root);
    now += 1_000;
    await getSnapshot(root);
    const exports = fake.exportCalls;
    await new BdProvider(root, 'embedded').comment('a', 'hi', 'Ann (panel)');
    now += 500;
    await getSnapshot(root);
    expect(fake.exportCalls).toBe(exports + 1);
    // Once caught up, the window holds again.
    now += 500;
    await getSnapshot(root);
    expect(fake.exportCalls).toBe(exports + 1);
  });

  it('exports after a panel write even when the change signal has not moved', async () => {
    fake.signal = true;
    await getSnapshot(root);
    const exports = fake.exportCalls;
    await notePanelWrite(root, 'a', { fields: ['title'] });
    now += 500;
    await getSnapshot(root);
    expect(fake.exportCalls).toBe(exports + 1);
  });

  it('runs one more refresh when a panel write lands while a refresh is reading', async () => {
    await getSnapshot(root);
    now += 5_000;
    let release = () => {};
    fake.holdExport = new Promise<void>((resolve) => (release = resolve));
    const exports = fake.exportCalls;
    const poll = getSnapshot(root);
    await vi.waitFor(() => expect(fake.exportCalls).toBe(exports + 1));
    // The write lands while that export is being read: it may not be in it.
    await notePanelWrite(root, 'a', { fields: ['title'] });
    fake.holdExport = null;
    release();
    await poll;
    expect(fake.exportCalls).toBe(exports + 2);
  });
});

describe('persisted team sync time', () => {
  it('is saved after a pull and restored in a new service process', async () => {
    await getSnapshot(root);
    startPull(root, 'embedded');
    await syncSettled(root);
    const store = await projectStore(root);
    await vi.waitFor(() => expect(store.lastTeamSyncAt()).not.toBeNull());
    await store.save();
    const saved = store.lastTeamSyncAt()!;

    resetSnapshotState();
    const res = full(await getSnapshot(root));
    expect(res.freshness.teamSyncedAt).toBe(saved);
  });

  it('is null for a state file from before sync existed, and is written back as null', async () => {
    const dir = join(tmp, 'legacy');
    const store = new ProjectStore(root, dir);
    await store.save();
    const [name] = await readdir(dir);
    const path = join(dir, name!);
    const body = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    expect(body.lastTeamSyncAt).toBeNull();
    delete body.lastTeamSyncAt;
    await writeFile(path, JSON.stringify(body));

    const reloaded = new ProjectStore(root, dir);
    await reloaded.load();
    expect(reloaded.lastTeamSyncAt()).toBeNull();
  });

  it('round-trips a saved time through the file', async () => {
    const dir = join(tmp, 'round');
    const store = new ProjectStore(root, dir);
    store.recordTeamSync('2026-10-13T08:00:00.000Z');
    await store.save();
    const reloaded = new ProjectStore(root, dir);
    await reloaded.load();
    expect(reloaded.lastTeamSyncAt()).toBe('2026-10-13T08:00:00.000Z');
  });

  it('ignores a saved time that is not a date', async () => {
    const dir = join(tmp, 'bad');
    const store = new ProjectStore(root, dir);
    await store.save();
    const [name] = await readdir(dir);
    const path = join(dir, name!);
    const body = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    body.lastTeamSyncAt = 'yesterday-ish';
    await writeFile(path, JSON.stringify(body));
    const reloaded = new ProjectStore(root, dir);
    await reloaded.load();
    expect(reloaded.lastTeamSyncAt()).toBeNull();
  });
});
