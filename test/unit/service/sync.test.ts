import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/service/bd/exec', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/service/bd/exec')>()),
  runBd: vi.fn(),
  runBdJson: vi.fn(),
  runDolt: vi.fn(),
  runGit: vi.fn(),
}));
vi.mock('../../../src/service/bd/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/service/bd/audit')>()),
  runSql: vi.fn(),
}));

import { resetPanelActorCache, withRootQueue } from '../../../src/service/bd/adapter';
import { runSql } from '../../../src/service/bd/audit';
import { BdError, runBd, runGit, type RunResult } from '../../../src/service/bd/exec';
import {
  checkBackedOut,
  checkHalfMerge,
  lastTeamSync,
  localHead,
  publishPreview,
  onTeamSynced,
  resetSyncState,
  seedLastTeamSync,
  startPublish,
  startPull,
  syncSettled,
  syncState,
  unpublished,
  unpublishedCount,
  writesBlocked,
} from '../../../src/service/sync';

const bd = vi.mocked(runBd);
const sql = vi.mocked(runSql);
const git = vi.mocked(runGit);

const ROOT = '/projects/demo';
const OTHER_ROOT = '/projects/other';

const ok = (stdout = '', stderr = ''): RunResult => ({ stdout, stderr, code: 0 });
const fail = (stderr: string, code = 1): RunResult => ({ stdout: '', stderr, code });

const PULL_OK = ok('Pulling from Dolt remote...\nPull complete.\n');
const PUSH_OK = ok('Pushing to Dolt remote...\nPush complete.\n');
const EMBEDDED_CONFLICT = fail('Error: merge origin/main: merge conflicts in issues require operator resolution; merge aborted and working set restored\n');
const SERVER_CONFLICT = fail('Error: failed to pull from origin/main: merge conflicts in issues require operator resolution; merge aborted and working set restored\n');
const SERVER_HALF = fail('Error: failed to commit pending changes before pull: failed to commit: Error 1105 (HY000): error: the table(s) issues are in conflict\n');
const REJECTED = fail("Error: push to origin/main: Error 1105: To file:///x\n ! [rejected]            main -> main (non-fast-forward)\nerror: failed to push some refs to 'file:///x'\n");
const DIRTY_CONFIG = fail(
  "Error: failed to commit pending changes before pull: refusing to auto-commit 3 dirty internal config key(s) before pull: issue_prefix, status.custom, types.custom; only user kv.* keys auto-commit before a pull (GH#2455) — commit or revert these explicitly with `bd dolt commit` first\n",
);

type Row = Record<string, unknown>;

type Fake = {
  remotes: Array<{ name: string; url: string }>;
  pulls: RunResult[];
  pushes: RunResult[];
  /** Hold the next pull until released. */
  holdPull: Promise<void> | null;
  branch: string;
  log: Row[] | Error;
  conflicts: Row[] | Error;
  mergeStatus: Row[] | Error;
  /** Whether the remote tracking branch exists yet (false before the first fetch). */
  trackingRef: boolean;
  calls: string[][];
  sqlCalls: string[];
  /** The local branch's newest commit. */
  head: string;
  /** What the team lacks up to the local head (`..HEAD`), and up to the previewed head; null reads `log`. */
  outgoing: Row[] | null;
  previewed: Row[] | null;
  /** Commits with a second parent: merges. */
  merges: string[];
  /** Pending, uncommitted changes. */
  status: Row[];
  /** The local head once a pull has run (a pull that merges moves it); null leaves it. */
  headAfterPull: string | null;
};
let fake: Fake;

/** Drops the leading `--actor <name>` the panel passes. */
const plain = (args: string[]): string[] => (args[0] === '--actor' ? args.slice(2) : args);

function install(): void {
  git.mockResolvedValue(ok('Ann\n'));
  bd.mockImplementation(async (_dir, args) => {
    fake.calls.push(args);
    const rest = plain(args);
    const words = rest.filter((a) => !a.startsWith('-'));
    if (words[0] === 'dolt' && words[1] === 'remote') return ok(JSON.stringify(fake.remotes.map((r) => ({ ...r, sql_url: r.url, status: 'ok' }))));
    if (words[0] === 'dolt' && (words[1] === 'pull' || words[1] === 'push')) {
      // Like bd: with no --remote it uses the remote named origin.
      const named = rest.includes('--remote') ? rest[rest.indexOf('--remote') + 1]! : 'origin';
      if (!fake.remotes.some((r) => r.name === named)) return fail(`Error: fatal: remote '${named}' not found.\nPlease make sure the remote exists.\n`);
      if (words[1] === 'pull') {
        if (fake.holdPull) await fake.holdPull;
        const result = fake.pulls.shift() ?? PULL_OK;
        if (result.code === 0 && fake.headAfterPull) fake.head = fake.headAfterPull;
        return result;
      }
      return fake.pushes.shift() ?? PUSH_OK;
    }
    throw new Error(`unexpected bd call: ${args.join(' ')}`);
  });
  sql.mockImplementation(async (_root, _mode, query) => {
    fake.sqlCalls.push(query);
    if (/active_branch/i.test(query)) return [{ branch: fake.branch }];
    if (/HASHOF\('HEAD'\)/i.test(query)) return [{ head: fake.head }];
    if (/FROM dolt_status/i.test(query)) return /COUNT\(\*\)/i.test(query) ? [{ n: fake.status.length }] : fake.status;
    if (/dolt_commit_ancestors/i.test(query)) return fake.merges.filter((h) => query.includes(`'${h}'`)).map((commit_hash) => ({ commit_hash }));
    // Like dolt: a range that names a tracking ref that does not exist yet is an error.
    if (!fake.trackingRef && /dolt_log\('remotes\//i.test(query)) throw new Error('branch not found: remotes/origin/main');
    if (/dolt_log\('(?:[^']*\.\.)?HEAD'\)/i.test(query)) return fake.outgoing ?? (fake.log instanceof Error ? [] : fake.log);
    if (/dolt_log\('(?:[^']*\.\.)?[a-z0-9]{8,}'\)/i.test(query)) return fake.previewed ?? (fake.log instanceof Error ? [] : fake.log);
    if (/dolt_remote_branches/i.test(query)) return [{ n: fake.trackingRef ? 1 : 0 }];
    if (/dolt_log\('remotes\//i.test(query) || /dolt_log\('[^']+'\)/i.test(query)) {
      if (fake.log instanceof Error) throw fake.log;
      return /COUNT\(\*\)/i.test(query) ? [{ n: fake.log.length }] : fake.log;
    }
    if (/DOLT_PREVIEW_MERGE_CONFLICTS|dolt_conflicts_issues/i.test(query)) {
      if (fake.conflicts instanceof Error) throw fake.conflicts;
      return fake.conflicts;
    }
    if (/dolt_merge_status/i.test(query)) {
      if (fake.mergeStatus instanceof Error) throw fake.mergeStatus;
      return fake.mergeStatus;
    }
    throw new Error(`unexpected sql: ${query}`);
  });
}

const commitRow = (commit_hash: string): Row => ({ commit_hash, committer: 'root', date: '2026-10-14 12:00:00', message: 'bd: update (auto-commit) by x [a-1]' });

const forcedArgs = () => fake.calls.filter((args) => args.some((a) => a === '--force' || a === '-f' || a.startsWith('--force=')));
const pulls = () => fake.calls.map(plain).filter((a) => a.includes('pull'));
const pushes = () => fake.calls.map(plain).filter((a) => a.includes('push'));
const verbs = () => fake.calls.map(plain).filter((a) => a[0] === 'dolt' && (a[1] === 'pull' || a[1] === 'push')).map((a) => a[1]);

beforeEach(() => {
  resetSyncState();
  resetPanelActorCache();
  fake = {
    remotes: [{ name: 'origin', url: 'file:///remote' }],
    pulls: [],
    pushes: [],
    holdPull: null,
    branch: 'main',
    log: [],
    conflicts: [],
    mergeStatus: [{ is_merging: 0 }],
    trackingRef: true,
    calls: [],
    sqlCalls: [],
    head: 'aaaa1111',
    outgoing: null,
    previewed: null,
    merges: [],
    status: [],
    headAfterPull: null,
  };
  install();
});

afterEach(() => {
  vi.clearAllMocks();
});

async function finish(root = ROOT): Promise<void> {
  await syncSettled(root);
}

describe('unpublished', () => {
  it('is null when the project has no remote, without touching the database', async () => {
    fake.remotes = [];
    expect(await unpublished(ROOT, 'embedded')).toBeNull();
    expect(fake.sqlCalls).toEqual([]);
  });

  it('lists local commits that are not on the remote, newest first, with beads and actor from embedded messages', async () => {
    fake.log = [
      { commit_hash: 'c2', committer: 'root', date: '2026-10-14 12:30:45.152', message: 'bd: update (auto-commit) by Ann (panel) [sx-k5y]' },
      { commit_hash: 'c1', committer: 'root', date: '2026-10-14 12:30:40', message: 'bd: create (auto-commit) by claude [sx-a1, sx-a2]' },
    ];
    const list = await unpublished(ROOT, 'embedded');
    expect(list).toHaveLength(2);
    expect(list![0]).toMatchObject({ commit: 'c2', beadIds: ['sx-k5y'], actor: 'Ann (panel)', at: '2026-10-14T12:30:45.152Z' });
    expect(list![0]!.summary).toMatch(/updated/i);
    expect(list![1]).toMatchObject({ commit: 'c1', beadIds: ['sx-a1', 'sx-a2'], actor: 'claude' });
    expect(fake.sqlCalls.some((q) => /remotes\/origin\/main\.\.main/.test(q))).toBe(true);
  });

  it('reads two-word embedded verbs (comments add, dep add/remove) with their actor', async () => {
    fake.log = [
      { commit_hash: 'c3', committer: 'root', date: '2026-10-14 12:30:47', message: 'bd: dep remove (auto-commit) by claude [sx-a1]' },
      { commit_hash: 'c2', committer: 'root', date: '2026-10-14 12:30:46', message: 'bd: dep add (auto-commit) by claude [sx-a1]' },
      { commit_hash: 'c1', committer: 'root', date: '2026-10-14 12:30:45', message: 'bd: comments add (auto-commit) by Ann Lee [sx-k5y]' },
    ];
    const list = await unpublished(ROOT, 'embedded');
    expect(list![0]).toMatchObject({ beadIds: ['sx-a1'], summary: 'Unlinked sx-a1', actor: 'claude' });
    expect(list![1]).toMatchObject({ beadIds: ['sx-a1'], summary: 'Linked sx-a1', actor: 'claude' });
    expect(list![2]).toMatchObject({ beadIds: ['sx-k5y'], summary: 'Commented on sx-k5y', actor: 'Ann Lee' });
  });

  it('reads server messages: ids from the message, no actor, ISO time kept', async () => {
    fake.log = [
      { commit_hash: 'h3', committer: 'beads', date: '2026-10-14T08:31:03.505Z', message: 'bd: update scr-m0h' },
      { commit_hash: 'h2', committer: 'beads', date: '2026-10-14T08:31:02Z', message: 'dependency: add blocks scr-a -> scr-b' },
      { commit_hash: 'h1', committer: 'beads', date: '2026-10-14T08:31:01Z', message: "Merge branch 'origin/main' into main" },
    ];
    const list = (await unpublished(ROOT, 'server'))!;
    expect(list[0]).toMatchObject({ commit: 'h3', beadIds: ['scr-m0h'], actor: null, at: '2026-10-14T08:31:03.505Z' });
    expect(list[1]!.beadIds).toEqual(['scr-a', 'scr-b']);
    expect(list[2]).toMatchObject({ beadIds: [], actor: null });
    expect(list[2]!.summary).toMatch(/team/i);
  });

  it('is an empty list when everything is published', async () => {
    fake.log = [];
    expect(await unpublished(ROOT, 'embedded')).toEqual([]);
  });

  it('prefers the remote named origin and uses the current branch name', async () => {
    fake.remotes = [
      { name: 'gitorigin', url: 'git+file:///g' },
      { name: 'origin', url: 'file:///o' },
    ];
    fake.branch = 'trunk';
    await unpublished(ROOT, 'server');
    expect(fake.sqlCalls.some((q) => q.includes("remotes/origin/trunk..trunk"))).toBe(true);
  });

  it('falls back to every local commit only when the remote branch has never been fetched', async () => {
    fake.trackingRef = false;
    fake.log = [{ commit_hash: 'only', committer: 'root', date: '2026-10-14 12:00:00', message: 'bd: update (auto-commit) by x [a-1]' }];
    const list = (await unpublished(ROOT, 'embedded'))!;
    expect(list.map((c) => c.commit)).toEqual(['only']);
    expect(fake.sqlCalls.some((q) => /dolt_remote_branches[^;]*remotes\/origin\/main/.test(q))).toBe(true);
    expect(fake.sqlCalls.some((q) => /dolt_log\('main'\)/.test(q))).toBe(true);
    expect(fake.sqlCalls.some((q) => /remotes\/origin\/main\.\.main/.test(q))).toBe(false);
  });

  it('does not read a failed query as "never fetched": the error is thrown and nothing is counted from the whole history', async () => {
    fake.trackingRef = true;
    fake.log = new BdError('exit', 'dolt sql failed with exit code 1', { code: 1, stderr: 'database is locked by another process' });
    await expect(unpublished(ROOT, 'embedded')).rejects.toThrow(/dolt sql failed/);
    await expect(unpublishedCount(ROOT, 'embedded')).rejects.toThrow(/dolt sql failed/);
    expect(fake.sqlCalls.some((q) => /dolt_log\('main'\)/.test(q))).toBe(false);
  });

  it('cannot tell whether the branch was fetched when that check fails: the error is thrown', async () => {
    sql.mockImplementation(async (_r, _m, query) => {
      if (/active_branch/i.test(query)) return [{ branch: 'main' }];
      throw new BdError('timeout', 'timed out');
    });
    await expect(unpublishedCount(ROOT, 'embedded')).rejects.toThrow(/timed out/);
  });

  it('refuses names that are not safe to put in a query', async () => {
    fake.branch = "main'); DROP TABLE issues; --";
    await expect(unpublished(ROOT, 'embedded')).rejects.toThrow();
    expect(fake.sqlCalls.every((q) => !/DROP/i.test(q))).toBe(true);
  });
});

describe('unpublishedCount', () => {
  it('counts without listing the commits', async () => {
    fake.log = [commitRow('c1'), commitRow('c2'), commitRow('c3')];
    expect(await unpublishedCount(ROOT, 'embedded')).toBe(3);
    expect(fake.sqlCalls.some((q) => /SELECT COUNT\(\*\) AS n FROM dolt_log\('remotes\/origin\/main\.\.main'\)/.test(q))).toBe(true);
    expect(fake.sqlCalls.some((q) => /commit_hash/.test(q))).toBe(false);
  });

  it('is null with no remote, and counts the whole history before the first fetch', async () => {
    fake.remotes = [];
    expect(await unpublishedCount(ROOT, 'embedded')).toBeNull();
    fake.remotes = [{ name: 'origin', url: 'file:///r' }];
    fake.trackingRef = false;
    fake.log = [commitRow('c1'), commitRow('c2')];
    expect(await unpublishedCount(ROOT, 'embedded')).toBe(2);
    expect(fake.sqlCalls.some((q) => /COUNT\(\*\) AS n FROM dolt_log\('main'\)/.test(q))).toBe(true);
  });

  it('looks up the remote with the default time limits, not the long ones a job gets', async () => {
    await unpublishedCount(ROOT, 'embedded');
    await unpublished(ROOT, 'embedded');
    const lookups = bd.mock.calls.filter(([, args]) => args.includes('remote'));
    expect(lookups).toHaveLength(2);
    for (const [, , opts] of lookups) {
      expect(opts?.timeoutMs).toBeUndefined();
      expect(opts?.deadlineMs).toBeUndefined();
    }
  });
});

describe('pull', () => {
  it('pulls once, ends idle, records the time and tells the listener; never pushes', async () => {
    const heard: Array<[string, string]> = [];
    onTeamSynced((root, at) => void heard.push([root, at]));
    const started = startPull(ROOT, 'embedded');
    expect(started).toMatchObject({ kind: 'running', op: 'pull' });
    expect(syncState(ROOT)).toMatchObject({ kind: 'running', op: 'pull' });
    await finish();
    expect(syncState(ROOT)).toEqual({ kind: 'idle' });
    expect(pulls()).toHaveLength(1);
    expect(pushes()).toHaveLength(0);
    expect(lastTeamSync(ROOT)).toEqual(expect.stringMatching(/^\d{4}-\d\d-\d\dT/));
    expect(heard).toEqual([[ROOT, lastTeamSync(ROOT)!]]);
  });

  it('runs one job per root: starting another while one runs returns the running state', async () => {
    let release = () => {};
    fake.holdPull = new Promise<void>((resolve) => (release = resolve));
    startPull(ROOT, 'embedded');
    const again = startPull(ROOT, 'embedded');
    const publish = startPublish(ROOT, 'embedded', 'aaaa1111');
    expect(again).toMatchObject({ kind: 'running', op: 'pull' });
    expect(publish).toMatchObject({ kind: 'running', op: 'pull' });
    release();
    await finish();
    expect(pulls()).toHaveLength(1);
    expect(pushes()).toHaveLength(0);
  });

  it('keeps roots apart', async () => {
    let release = () => {};
    fake.holdPull = new Promise<void>((resolve) => (release = resolve));
    startPull(ROOT, 'embedded');
    expect(syncState(OTHER_ROOT)).toEqual({ kind: 'idle' });
    expect(lastTeamSync(OTHER_ROOT)).toBeNull();
    expect(writesBlocked(OTHER_ROOT)).toBe(false);
    release();
    await finish();
  });

  it('runs inside the root queue, so it never overlaps a read or write', async () => {
    let release = () => {};
    const blocker = withRootQueue(ROOT, () => new Promise<void>((resolve) => (release = resolve)));
    startPull(ROOT, 'embedded');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pulls()).toHaveLength(0);
    expect(syncState(ROOT)).toMatchObject({ kind: 'running' });
    release();
    await blocker;
    await finish();
    expect(pulls()).toHaveLength(1);
  });

  it('gives the pull time to run (well over the 15 s default) and retries a busy lock', async () => {
    startPull(ROOT, 'embedded');
    await finish();
    const [, , opts] = bd.mock.calls.find(([, args]) => args.includes('pull'))!;
    expect(opts?.timeoutMs).toBeGreaterThanOrEqual(60_000);
    expect(opts?.timeoutMs).toBeLessThanOrEqual(120_000);
    expect(opts?.deadlineMs).toBeGreaterThanOrEqual(opts?.timeoutMs ?? 0);
  });

  it('names no remote when it is origin, because bd uses origin by default', async () => {
    startPull(ROOT, 'embedded');
    await finish();
    expect(pulls()[0]).toEqual(['dolt', 'pull']);
    expect(syncState(ROOT)).toEqual({ kind: 'idle' });

    fake.remotes = [
      { name: 'gitorigin', url: 'git+file:///g' },
      { name: 'origin', url: 'file:///o' },
    ];
    fake.calls = [];
    startPull(ROOT, 'embedded');
    await finish();
    expect(pulls()[0]).toEqual(['dolt', 'pull']);
    expect(syncState(ROOT)).toEqual({ kind: 'idle' });
  });

  it('names the remote when it is a single one that is not origin, for pull and for push', async () => {
    fake.remotes = [{ name: 'upstream', url: 'file:///u' }];
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await finish();
    expect(pulls()[0]).toEqual(['dolt', 'pull', '--remote', 'upstream']);
    expect(pushes()[0]).toEqual(['dolt', 'push', '--remote', 'upstream']);
    expect(syncState(ROOT)).toEqual({ kind: 'idle' });
  });

  it('names the first remote when there are several and none is origin', async () => {
    fake.remotes = [
      { name: 'upstream', url: 'file:///u' },
      { name: 'backup', url: 'file:///b' },
    ];
    startPull(ROOT, 'embedded');
    await finish();
    expect(pulls()[0]).toEqual(['dolt', 'pull', '--remote', 'upstream']);
    expect(syncState(ROOT)).toEqual({ kind: 'idle' });
  });

  it('is recorded as the panel: pull and push both carry the panel actor', async () => {
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await finish();
    const sync = fake.calls.filter((a) => plain(a)[0] === 'dolt' && (plain(a)[1] === 'pull' || plain(a)[1] === 'push'));
    expect(sync).toHaveLength(2);
    for (const args of sync) expect(args.slice(0, 2)).toEqual(['--actor', 'Ann (panel)']);
    // Looking up the remote changes nothing, so it carries no actor.
    expect(fake.calls[0]![0]).toBe('--readonly');
  });

  it('logs each command shell-quoted, so a line can be pasted into a terminal', async () => {
    fake.pulls = [EMBEDDED_CONFLICT];
    startPull(ROOT, 'embedded');
    await finish();
    const state = syncState(ROOT);
    if (state.kind !== 'conflict') throw new Error('expected a conflict');
    expect(state.log).toContain("$ bd --actor 'Ann (panel)' dolt pull");
  });

  it('with no remote, ends in a plain error and never runs pull', async () => {
    fake.remotes = [];
    startPull(ROOT, 'embedded');
    await finish();
    expect(pulls()).toHaveLength(0);
    expect(syncState(ROOT)).toMatchObject({ kind: 'error', message: expect.stringMatching(/team/i) });
  });
});

describe('conflicts', () => {
  it('embedded: a backed-out merge is a conflict that is not half merged, with both sides of the beads listed', async () => {
    fake.pulls = [EMBEDDED_CONFLICT];
    fake.conflicts = [
      { base_id: 'sx-k5y', base_title: 'one', our_title: 'B title', their_title: 'A title', base_priority: 2, our_priority: 2, their_priority: 2, our_updated_at: '2026-10-14 12:31:00', their_updated_at: '2026-10-14 12:30:50', our_diff_type: 'modified', their_diff_type: 'modified' },
    ];
    startPull(ROOT, 'embedded');
    await finish();
    const state = syncState(ROOT);
    expect(state).toMatchObject({ kind: 'conflict', mode: 'embedded', halfMerged: false });
    if (state.kind !== 'conflict') throw new Error('unreachable');
    expect(state.beads).toEqual([{ beadId: 'sx-k5y', title: 'B title', ours: { title: 'B title' }, theirs: { title: 'A title' } }]);
    expect(state.log).toContain('dolt pull');
    expect(state.log).toContain('merge aborted and working set restored');
    expect(writesBlocked(ROOT)).toBe(false);
    expect(lastTeamSync(ROOT)).toBeNull();
    expect(fake.sqlCalls.some((q) => /DOLT_PREVIEW_MERGE_CONFLICTS\('main',\s*'remotes\/origin\/main',\s*'issues'\)/i.test(q))).toBe(true);
    expect(fake.sqlCalls.some((q) => /dolt_merge_status/i.test(q))).toBe(false);
  });

  it('a conflict still shows when the sides cannot be read: ids only, or none', async () => {
    fake.pulls = [EMBEDDED_CONFLICT];
    fake.conflicts = new BdError('exit', 'dolt sql failed', { code: 1, stderr: 'no such function' });
    startPull(ROOT, 'embedded');
    await finish();
    const state = syncState(ROOT);
    expect(state).toMatchObject({ kind: 'conflict', halfMerged: false, beads: [] });
    if (state.kind !== 'conflict') throw new Error('unreachable');
    expect(state.log).toContain('Could not read which beads conflict');
    expect(state.log).toContain('no such function');
  });

  it('lists only the id when a conflicting row carries no readable fields', async () => {
    fake.pulls = [EMBEDDED_CONFLICT];
    fake.conflicts = [{ base_id: 'sx-1' }];
    startPull(ROOT, 'embedded');
    await finish();
    const state = syncState(ROOT);
    if (state.kind !== 'conflict') throw new Error('expected a conflict');
    expect(state.beads).toEqual([{ beadId: 'sx-1', title: null, ours: {}, theirs: {} }]);
  });

  it('server: an aborted merge is a conflict that is not half merged and blocks nothing', async () => {
    fake.pulls = [SERVER_CONFLICT];
    startPull(ROOT, 'server');
    await finish();
    expect(syncState(ROOT)).toMatchObject({ kind: 'conflict', mode: 'server', halfMerged: false });
    expect(writesBlocked(ROOT)).toBe(false);
  });

  it('server: a half-merged database is a conflict that blocks writes until a later check finds none', async () => {
    fake.pulls = [SERVER_HALF];
    fake.mergeStatus = [{ is_merging: 1, unmerged_tables: 'issues' }];
    fake.conflicts = [{ base_id: 'scr-fum', base_priority: 0, our_priority: 2, their_priority: 1, base_title: 'Docs', our_title: 'Docs', their_title: 'Docs' }];
    startPull(ROOT, 'server');
    await finish();
    const state = syncState(ROOT);
    expect(state).toMatchObject({ kind: 'conflict', mode: 'server', halfMerged: true });
    if (state.kind !== 'conflict') throw new Error('unreachable');
    expect(state.beads[0]).toMatchObject({ beadId: 'scr-fum', ours: { priority: 2 }, theirs: { priority: 1 } });
    expect(writesBlocked(ROOT)).toBe(true);
    expect(fake.sqlCalls.some((q) => /dolt_conflicts_issues/i.test(q))).toBe(true);

    // Still merging: stays blocked.
    await checkHalfMerge(ROOT, 'server');
    expect(writesBlocked(ROOT)).toBe(true);
    expect(syncState(ROOT)).toMatchObject({ kind: 'conflict', halfMerged: true });

    // Resolved elsewhere (the agent aborted the merge): the next check clears it.
    fake.mergeStatus = [{ is_merging: 0 }];
    await checkHalfMerge(ROOT, 'server');
    expect(writesBlocked(ROOT)).toBe(false);
    expect(syncState(ROOT)).toEqual({ kind: 'idle' });
  });

  it('server: a check that finds a merge in progress (a write was refused) raises the conflict without a job', async () => {
    fake.mergeStatus = [{ is_merging: 1 }];
    fake.conflicts = [{ base_id: 'scr-1', base_title: 't', our_title: 'a', their_title: 'b' }];
    await checkHalfMerge(ROOT, 'server');
    expect(syncState(ROOT)).toMatchObject({ kind: 'conflict', halfMerged: true });
    expect(writesBlocked(ROOT)).toBe(true);
  });

  it('server: a check on a clean database changes nothing, and embedded is never checked', async () => {
    await checkHalfMerge(ROOT, 'server');
    expect(syncState(ROOT)).toEqual({ kind: 'idle' });
    fake.sqlCalls = [];
    await checkHalfMerge(ROOT, 'embedded');
    expect(fake.sqlCalls).toEqual([]);
  });

  it('a failed check keeps the blocked state rather than guessing it is clear', async () => {
    fake.pulls = [SERVER_HALF];
    fake.mergeStatus = [{ is_merging: 1 }];
    startPull(ROOT, 'server');
    await finish();
    sql.mockRejectedValueOnce(new BdError('timeout', 'bd timed out'));
    await checkHalfMerge(ROOT, 'server');
    expect(writesBlocked(ROOT)).toBe(true);
  });

  it('server: a pull that exits 0 but leaves the database mid-merge is a half-merged conflict, not a success', async () => {
    fake.mergeStatus = [{ is_merging: 1 }];
    fake.conflicts = [{ base_id: 'scr-1', base_title: 't', our_title: 'a', their_title: 'b' }];
    startPull(ROOT, 'server');
    await finish();
    expect(syncState(ROOT)).toMatchObject({ kind: 'conflict', mode: 'server', halfMerged: true });
    expect(writesBlocked(ROOT)).toBe(true);
    expect(lastTeamSync(ROOT)).toBeNull();
  });

  it('server: publish stops before the push when the pull left the database mid-merge', async () => {
    fake.mergeStatus = [{ is_merging: 1 }];
    startPublish(ROOT, 'server', 'aaaa1111');
    await finish();
    expect(pushes()).toHaveLength(0);
    expect(syncState(ROOT)).toMatchObject({ kind: 'conflict', halfMerged: true });
  });

  it('server: when the merge status cannot be read after a pull, writes stay blocked until a later check shows it clear', async () => {
    fake.mergeStatus = new BdError('timeout', 'bd timed out');
    startPull(ROOT, 'server');
    await finish();
    expect(syncState(ROOT)).toEqual({ kind: 'idle' });
    expect(writesBlocked(ROOT)).toBe(true);

    await checkHalfMerge(ROOT, 'server');
    expect(writesBlocked(ROOT)).toBe(true);

    fake.mergeStatus = [{ is_merging: 0 }];
    await checkHalfMerge(ROOT, 'server');
    expect(writesBlocked(ROOT)).toBe(false);
  });

  it('server: publish does not push on top of a merge status that cannot be read', async () => {
    fake.mergeStatus = new BdError('timeout', 'bd timed out');
    startPublish(ROOT, 'server', 'aaaa1111');
    await finish();
    expect(pushes()).toHaveLength(0);
    expect(syncState(ROOT)).toMatchObject({ kind: 'error' });
    expect(writesBlocked(ROOT)).toBe(true);
  });

  it('server: a failed pull with conflict text and an unreadable merge status is never called backed out', async () => {
    fake.pulls = [fail('Error: failed to pull: merge conflicts in issues\n')];
    fake.mergeStatus = new BdError('timeout', 'bd timed out');
    startPull(ROOT, 'server');
    await finish();
    expect(syncState(ROOT)).toMatchObject({ kind: 'conflict', halfMerged: true });
    expect(writesBlocked(ROOT)).toBe(true);
  });

  it('a backed-out conflict clears once the team copy has nothing this one lacks (resolved elsewhere), and not before', async () => {
    fake.pulls = [EMBEDDED_CONFLICT];
    startPull(ROOT, 'embedded');
    await finish();
    expect(syncState(ROOT)).toMatchObject({ kind: 'conflict', halfMerged: false });
    fake.log = [commitRow('cccc3333')];
    await checkBackedOut(ROOT, 'embedded');
    expect(syncState(ROOT)).toMatchObject({ kind: 'conflict', halfMerged: false });
    expect(fake.sqlCalls.some((q) => /dolt_log\('HEAD\.\.remotes\/origin\/main'\)/.test(q))).toBe(true);
    // The agent merged the team's changes: nothing left to bring in.
    fake.log = [];
    await checkBackedOut(ROOT, 'embedded');
    expect(syncState(ROOT)).toEqual({ kind: 'idle' });
  });

  it('keeps the conflict when that check cannot be read, and never touches a half merge', async () => {
    fake.pulls = [EMBEDDED_CONFLICT];
    startPull(ROOT, 'embedded');
    await finish();
    fake.log = new BdError('timeout', 'timed out');
    await checkBackedOut(ROOT, 'embedded');
    expect(syncState(ROOT)).toMatchObject({ kind: 'conflict' });

    fake.log = [];
    fake.pulls = [SERVER_HALF];
    fake.mergeStatus = [{ is_merging: 1 }];
    startPull(ROOT, 'server');
    await finish();
    await checkBackedOut(ROOT, 'server');
    expect(syncState(ROOT)).toMatchObject({ kind: 'conflict', halfMerged: true });
  });

  it('a later successful pull clears an earlier conflict', async () => {
    fake.pulls = [EMBEDDED_CONFLICT, PULL_OK];
    startPull(ROOT, 'embedded');
    await finish();
    expect(syncState(ROOT).kind).toBe('conflict');
    startPull(ROOT, 'embedded');
    await finish();
    expect(syncState(ROOT)).toEqual({ kind: 'idle' });
  });
});

describe('errors and upgrades', () => {
  it('dirty config rows that block the pull become a plain error with the raw text only in the log', async () => {
    fake.pulls = [DIRTY_CONFIG];
    startPull(ROOT, 'server');
    await finish();
    const state = syncState(ROOT);
    expect(state).toMatchObject({ kind: 'error' });
    if (state.kind !== 'error') throw new Error('unreachable');
    expect(state.message).not.toMatch(/\bbd\b|dolt|GH#|kv\./i);
    expect(state.message).toMatch(/settings|configuration/i);
    expect(state.log).toContain('refusing to auto-commit 3 dirty internal config key(s)');
  });

  it('a format or version refusal pauses for an upgrade', async () => {
    fake.pulls = [fail('Error: unsupported storage format version 9: this database was written by a newer version of bd; please upgrade bd\n')];
    startPull(ROOT, 'embedded');
    await finish();
    const state = syncState(ROOT);
    expect(state).toMatchObject({ kind: 'paused-upgrade' });
    if (state.kind !== 'paused-upgrade') throw new Error('unreachable');
    expect(state.message).not.toMatch(/\bbd\b|dolt/i);
  });

  it('a paused upgrade carries the job log and says honestly what to do', async () => {
    fake.pulls = [fail('Error: unsupported storage format version 9: this database was written by a newer version of bd; please upgrade bd\n')];
    startPull(ROOT, 'embedded');
    await finish();
    const state = syncState(ROOT);
    if (state.kind !== 'paused-upgrade') throw new Error('expected paused-upgrade');
    expect(state.message).toBe("This project's beads data needs a different Beads version. Hand it to your agent to check.");
    expect(state.log).toContain('unsupported storage format version 9');
  });

  it('bd 1.2.2 refusing a database from a newer version pauses for an upgrade', async () => {
    const refusal = 'Error: schema version mismatch: database is at v65, binary knows up to v53 (12 migrations ahead)\n';
    fake.pulls = [fail(refusal)];
    startPull(ROOT, 'embedded');
    await finish();
    expect(syncState(ROOT)).toMatchObject({ kind: 'paused-upgrade' });

    // bd usually refuses already when it lists the remotes.
    bd.mockImplementationOnce(async () => fail(refusal));
    startPull(ROOT, 'embedded');
    await finish();
    expect(syncState(ROOT)).toMatchObject({ kind: 'paused-upgrade' });
  });

  it('an unreachable remote is explained in plain language', async () => {
    fake.pulls = [fail("Error: failed to pull from origin/main: fatal: unable to access 'https://example.test/x.git/': Could not resolve host: example.test\n")];
    startPull(ROOT, 'server');
    await finish();
    expect(syncState(ROOT)).toMatchObject({ kind: 'error', message: expect.stringMatching(/reach|connect|connection/i) });
  });

  it('a sign-in problem is explained in plain language', async () => {
    fake.pulls = [fail('Error: failed to pull from origin/main: fatal: Authentication failed for https://example.test/x.git/\n')];
    startPull(ROOT, 'server');
    await finish();
    expect(syncState(ROOT)).toMatchObject({ kind: 'error', message: expect.stringMatching(/sign|credential|access/i) });
  });

  it('any other failure says Sync did not finish and keeps the raw text in the log', async () => {
    fake.pulls = [fail('Error: something odd happened in dolt\n', 2)];
    startPull(ROOT, 'embedded');
    await finish();
    const state = syncState(ROOT);
    if (state.kind !== 'error') throw new Error('expected an error');
    expect(state.message).toMatch(/did not finish/i);
    expect(state.message).not.toMatch(/dolt/i);
    expect(state.log).toContain('exit 2');
    expect(state.log).toContain('something odd happened in dolt');
  });

  it('a timeout, a missing tool and a busy database are each worded plainly', async () => {
    bd.mockImplementationOnce(async () => ok(JSON.stringify([{ name: 'origin', url: 'file:///r' }])));
    bd.mockRejectedValueOnce(new BdError('timeout', 'bd timed out after 120000 ms'));
    startPull(ROOT, 'embedded');
    await finish();
    expect(syncState(ROOT)).toMatchObject({ kind: 'error', message: expect.stringMatching(/did not answer|in time/i) });

    bd.mockImplementationOnce(async () => ok(JSON.stringify([{ name: 'origin', url: 'file:///r' }])));
    bd.mockRejectedValueOnce(new BdError('not-found', 'bd could not be started'));
    startPull(ROOT, 'embedded');
    await finish();
    expect(syncState(ROOT)).toMatchObject({ kind: 'error', message: expect.stringMatching(/could not be found/i) });

    bd.mockImplementationOnce(async () => ok(JSON.stringify([{ name: 'origin', url: 'file:///r' }])));
    bd.mockRejectedValueOnce(new BdError('lock', 'bd is busy: lock timeout exceeded'));
    startPull(ROOT, 'embedded');
    await finish();
    expect(syncState(ROOT)).toMatchObject({ kind: 'error', message: expect.stringMatching(/busy/i) });
  });

  it('says the team copy is empty when it has no branch to bring in or publish into', async () => {
    const empty = fail("Error: failed to pull from origin/main: no branches found in remote 'origin'\n");
    fake.pulls = [empty];
    startPull(ROOT, 'embedded');
    await finish();
    expect(syncState(ROOT)).toMatchObject({ kind: 'error', message: "The team's shared copy is empty, so there is nothing to bring in yet." });
    fake.pulls = [empty];
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await finish();
    expect(syncState(ROOT)).toMatchObject({
      kind: 'error',
      message: "The team's shared copy is empty, so there is nothing to publish into yet. Setting it up the first time is a one-time step: hand it to your agent. Nothing was published.",
    });
    expect(pushes()).toHaveLength(0);
  });

  it('says Publish needs the Dolt tool when it is not installed', async () => {
    sql.mockRejectedValue(new BdError('not-found', 'dolt was not found on PATH or in the usual install folders'));
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await finish();
    expect(syncState(ROOT)).toMatchObject({ kind: 'error', message: "Publishing needs the Dolt tool, which isn't installed." });
    expect(pushes()).toHaveLength(0);
  });

  it('a failed remote lookup is an error, not a crash', async () => {
    bd.mockImplementationOnce(async () => fail('Error: dolt is broken\n'));
    startPull(ROOT, 'embedded');
    await finish();
    expect(syncState(ROOT)).toMatchObject({ kind: 'error' });
    expect(pulls()).toHaveLength(0);
  });
});

describe('wording', () => {
  const TECHNICAL = /\b(pull|push|remote|dolt|bd|merge|commit)\b/i;

  it('never uses technical words in what the user sees', async () => {
    const messages: string[] = [];
    const record = () => {
      const state = syncState(ROOT);
      if (state.kind === 'error' || state.kind === 'paused-upgrade') messages.push(state.message);
    };
    const run = async (setup: () => void, mode: 'embedded' | 'server' = 'embedded') => {
      setup();
      startPublish(ROOT, mode, 'aaaa1111');
      await finish();
      record();
    };
    await run(() => (fake.remotes = []));
    fake.remotes = [{ name: 'origin', url: 'file:///r' }];
    await run(() => (fake.pulls = [DIRTY_CONFIG]), 'server');
    await run(() => (fake.pulls = [fail('Error: schema version mismatch: database is at v65, binary knows up to v53 (12 migrations ahead)\n')]));
    await run(() => (fake.pulls = [fail('Error: fatal: Authentication failed for https://x.test/\n')]));
    await run(() => (fake.pulls = [fail('Error: Could not resolve host: x.test\n')]));
    await run(() => (fake.pulls = [fail('Error: odd\n')]));
    await run(() => (fake.pushes = [REJECTED, REJECTED, REJECTED]));
    bd.mockImplementationOnce(async () => ok(JSON.stringify([{ name: 'origin' }])));
    await run(() => bd.mockRejectedValueOnce(new BdError('timeout', 'x')));
    expect(messages).toHaveLength(8);
    for (const message of messages) expect(message).not.toMatch(TECHNICAL);
  });
});

describe('publish what was previewed', () => {
  it('reads the preview in one turn: the head first, then the list and the full count', async () => {
    fake.log = [commitRow('aaaa1111'), commitRow('bbbb0000')];
    const preview = await publishPreview(ROOT, 'embedded');
    expect(preview).toEqual({ head: 'aaaa1111', changes: expect.any(Array), total: 2 });
    expect(preview!.changes.map((c) => c.commit)).toEqual(['aaaa1111', 'bbbb0000']);
    const head = fake.sqlCalls.findIndex((q) => /HASHOF/.test(q));
    const list = fake.sqlCalls.findIndex((q) => /SELECT commit_hash, committer/.test(q));
    const count = fake.sqlCalls.findIndex((q) => /COUNT\(\*\) AS n FROM dolt_log/.test(q));
    expect(head).toBeGreaterThanOrEqual(0);
    expect(head).toBeLessThan(list);
    expect(list).toBeLessThan(count);
  });

  it('says the team copy was never fetched when there is no branch of it here and no fetch has happened', async () => {
    fake.log = [commitRow('aaaa1111')];
    const known = await publishPreview(ROOT, 'embedded');
    expect(known!.teamEmpty).toBeUndefined();
    expect(known!.teamUnseen).toBeUndefined();
    fake.trackingRef = false;
    const unseen = await publishPreview(ROOT, 'embedded');
    expect(unseen).toMatchObject({ head: 'aaaa1111', total: 1, teamUnseen: true });
    expect(unseen!.teamEmpty).toBeUndefined();
  });

  it('says the team copy is empty only once a fetch has shown it empty', async () => {
    fake.log = [commitRow('aaaa1111')];
    fake.trackingRef = false;
    fake.pulls = [fail("Error: failed to pull from origin/main: no branches found in remote 'origin'\n")];
    startPull(ROOT, 'embedded');
    await finish();
    const empty = await publishPreview(ROOT, 'embedded');
    expect(empty).toMatchObject({ teamEmpty: true });
    expect(empty!.teamUnseen).toBeUndefined();
  });

  it('says the team copy is empty when a pull went through and still left no branch of it', async () => {
    fake.log = [commitRow('aaaa1111')];
    fake.trackingRef = false;
    startPull(ROOT, 'embedded');
    await finish();
    expect(lastTeamSync(ROOT)).not.toBeNull();
    const preview = await publishPreview(ROOT, 'embedded');
    expect(preview).toMatchObject({ teamEmpty: true });
    expect(preview!.teamUnseen).toBeUndefined();
  });

  it('reads the remote list once for a whole preview', async () => {
    fake.log = [commitRow('aaaa1111')];
    const before = fake.calls.filter((args) => args.includes('remote')).length;
    await publishPreview(ROOT, 'embedded');
    expect(fake.calls.filter((args) => args.includes('remote')).length - before).toBe(1);
  });

  it('a preview with no remote is null', async () => {
    fake.remotes = [];
    expect(await publishPreview(ROOT, 'embedded')).toBeNull();
  });

  it('reads the local head', async () => {
    expect(await localHead(ROOT, 'embedded')).toBe('aaaa1111');
  });

  it('pushes when the head is still the one the preview showed', async () => {
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await finish();
    expect(verbs()).toEqual(['pull', 'push']);
    expect(syncState(ROOT)).toEqual({ kind: 'idle' });
  });

  it('stops before the pull, and pushes nothing, when a commit landed after the preview', async () => {
    fake.head = 'bbbb2222';
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await finish();
    expect(verbs()).toEqual([]);
    expect(syncState(ROOT)).toMatchObject({ kind: 'error', code: 'preview-stale', message: 'New changes arrived since you looked. Review them again.' });
  });

  it('pushes nothing when a commit lands while the pull runs: the outgoing set is checked right before the push', async () => {
    fake.previewed = [commitRow('aaaa1111')];
    fake.outgoing = [commitRow('aaaa1111')];
    let release!: () => void;
    fake.holdPull = new Promise<void>((resolve) => (release = resolve));
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await new Promise((r) => setTimeout(r, 10));
    // The agent commits while the pull is held.
    fake.outgoing = [commitRow('cccc3333'), commitRow('aaaa1111')];
    release();
    await finish();
    expect(pushes()).toEqual([]);
    expect(syncState(ROOT)).toMatchObject({ kind: 'error', code: 'preview-stale' });
  });

  it('allows the merge commit its own pull made, and pushes', async () => {
    fake.previewed = [commitRow('aaaa1111')];
    fake.outgoing = [commitRow('mmmm9999'), commitRow('aaaa1111')];
    fake.merges = ['mmmm9999'];
    fake.headAfterPull = 'mmmm9999';
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await finish();
    expect(verbs()).toEqual(['pull', 'push']);
    expect(syncState(ROOT)).toEqual({ kind: 'idle' });
  });

  it('refuses an outgoing merge that is not the head a pull of this job left', async () => {
    fake.previewed = [commitRow('aaaa1111')];
    fake.outgoing = [commitRow('nnnn7777'), commitRow('mmmm9999'), commitRow('aaaa1111')];
    // Both have a second parent, but only mmmm9999 was this job's pull; nnnn7777 came from somewhere else.
    fake.merges = ['mmmm9999', 'nnnn7777'];
    fake.headAfterPull = 'mmmm9999';
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await finish();
    expect(pushes()).toEqual([]);
    expect(syncState(ROOT)).toMatchObject({ kind: 'error', code: 'preview-stale' });
  });

  it('checks a team copy that has no branch yet against the local commits alone', async () => {
    fake.trackingRef = false;
    fake.previewed = [commitRow('aaaa1111')];
    fake.outgoing = [commitRow('aaaa1111')];
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await finish();
    expect(verbs()).toEqual(['pull', 'push']);
    expect(syncState(ROOT)).toEqual({ kind: 'idle' });
  });

  it('still refuses an unpreviewed commit when the team copy has no branch yet', async () => {
    fake.trackingRef = false;
    fake.previewed = [commitRow('aaaa1111')];
    fake.outgoing = [commitRow('cccc3333'), commitRow('aaaa1111')];
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await finish();
    expect(pushes()).toEqual([]);
    expect(syncState(ROOT)).toMatchObject({ kind: 'error', code: 'preview-stale' });
  });

  it('pushes nothing when the database names a commit in a form that cannot be read', async () => {
    fake.previewed = [commitRow('aaaa1111')];
    fake.outgoing = [commitRow('aaaa1111'), { commit_hash: 'NOT A HASH!' }];
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await finish();
    expect(pushes()).toEqual([]);
    expect(syncState(ROOT)).toMatchObject({ kind: 'error' });
    expect(syncState(ROOT)).not.toEqual({ kind: 'idle' });
  });

  it('pushes nothing while changes are pending, which the push would not carry as previewed', async () => {
    fake.previewed = [commitRow('aaaa1111')];
    fake.outgoing = [commitRow('aaaa1111')];
    fake.status = [{ table_name: 'issues', staged: 0, status: 'modified' }];
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await finish();
    expect(pushes()).toEqual([]);
    // Not "new changes arrived": nothing new is listed yet, so the preview would show the same. Waiting is the answer.
    const state = syncState(ROOT);
    expect(state).toMatchObject({ kind: 'error', message: 'Some changes on this computer are still being saved. Try again in a moment.' });
    expect(state.kind === 'error' && state.code).toBeUndefined();
  });

  it('checks again before the retry push after a rejection', async () => {
    fake.previewed = [commitRow('aaaa1111')];
    fake.outgoing = [commitRow('aaaa1111')];
    fake.pushes = [REJECTED];
    const pushed: number[] = [];
    const real = bd.getMockImplementation()!;
    bd.mockImplementation(async (dir, args, opts) => {
      if (plain(args).includes('push')) {
        pushed.push(1);
        // Between the rejected push and the retry, the agent commits.
        fake.outgoing = [commitRow('dddd4444'), commitRow('aaaa1111')];
      }
      return real(dir, args, opts);
    });
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await finish();
    expect(pushed).toHaveLength(1);
    expect(syncState(ROOT)).toMatchObject({ kind: 'error', code: 'preview-stale' });
  });
});

describe('publish', () => {
  it('pulls, then pushes, and records the time', async () => {
    startPublish(ROOT, 'embedded', 'aaaa1111');
    expect(syncState(ROOT)).toMatchObject({ kind: 'running', op: 'publish' });
    await finish();
    expect(verbs()).toEqual(['pull', 'push']);
    expect(syncState(ROOT)).toEqual({ kind: 'idle' });
    expect(lastTeamSync(ROOT)).not.toBeNull();
  });

  it('when the push is rejected it pulls again and retries, then succeeds', async () => {
    fake.pushes = [REJECTED, PUSH_OK];
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await finish();
    expect(verbs()).toEqual(['pull', 'push', 'pull', 'push']);
    expect(syncState(ROOT)).toEqual({ kind: 'idle' });
  });

  it('gives up after three attempts when the team keeps getting ahead', async () => {
    fake.pushes = [REJECTED, REJECTED, REJECTED, REJECTED];
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await finish();
    expect(pushes()).toHaveLength(3);
    expect(pulls()).toHaveLength(3);
    const state = syncState(ROOT);
    expect(state).toMatchObject({ kind: 'error', message: expect.stringMatching(/try again/i) });
    if (state.kind !== 'error') throw new Error('unreachable');
    expect(state.log).toContain('non-fast-forward');
  });

  it('a push that fails for another reason is an error and is not retried', async () => {
    fake.pushes = [fail('Error: push to origin/main: permission denied\n')];
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await finish();
    expect(pushes()).toHaveLength(1);
    expect(syncState(ROOT)).toMatchObject({ kind: 'error' });
  });

  it('a conflict in the pull stops before any push and keeps the conflict', async () => {
    fake.pulls = [EMBEDDED_CONFLICT];
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await finish();
    expect(pushes()).toHaveLength(0);
    expect(syncState(ROOT)).toMatchObject({ kind: 'conflict', halfMerged: false });
  });

  it('a conflict found when retrying after a rejection also stops there', async () => {
    fake.pushes = [REJECTED];
    fake.pulls = [PULL_OK, SERVER_CONFLICT];
    startPublish(ROOT, 'server', 'aaaa1111');
    await finish();
    expect(pushes()).toHaveLength(1);
    expect(syncState(ROOT)).toMatchObject({ kind: 'conflict', mode: 'server' });
  });

  it('never passes --force or -f to anything', async () => {
    fake.pushes = [REJECTED, REJECTED, REJECTED];
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await finish();
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await finish();
    startPull(ROOT, 'embedded');
    await finish();
    expect(fake.calls.length).toBeGreaterThan(6);
    expect(forcedArgs()).toEqual([]);
  });

  it('only ever pushes from an explicit publish: a pull, a conflict and an error never push', async () => {
    fake.pulls = [PULL_OK, EMBEDDED_CONFLICT, DIRTY_CONFIG];
    for (let i = 0; i < 3; i += 1) {
      startPull(ROOT, 'embedded');
      await finish();
    }
    expect(pushes()).toHaveLength(0);
  });
});

describe('log', () => {
  it('records the exact commands, exit codes and stderr', async () => {
    fake.pushes = [REJECTED];
    fake.pulls = [PULL_OK, EMBEDDED_CONFLICT];
    startPublish(ROOT, 'embedded', 'aaaa1111');
    await finish();
    const state = syncState(ROOT);
    if (state.kind !== 'conflict') throw new Error('expected a conflict');
    expect(state.log).toContain('dolt pull\nexit 0');
    expect(state.log).toContain('dolt push\nexit 1');
    expect(state.log).toContain('! [rejected]');
    expect(state.log).toContain('dolt pull\nexit 1');
  });

  it('is cut to 8,000 characters, keeping the end', async () => {
    fake.pulls = [fail(`${'x'.repeat(30_000)}\nfinal line: merge conflicts in issues; merge aborted and working set restored\n`)];
    startPull(ROOT, 'embedded');
    await finish();
    const state = syncState(ROOT);
    if (state.kind !== 'conflict') throw new Error('expected a conflict');
    expect(state.log.length).toBeLessThanOrEqual(8_000);
    expect(state.log).toContain('final line');
  });

  it('hides credentials in remote addresses', async () => {
    fake.pulls = [fail('Error: failed to pull: fatal: unable to access https://ann:s3cr3tToken@example.test/x.git/: The requested URL returned error: 403\n')];
    startPull(ROOT, 'server');
    await finish();
    const state = syncState(ROOT);
    if (state.kind !== 'error') throw new Error('expected an error');
    expect(state.log).not.toContain('s3cr3tToken');
    expect(state.log).toContain('example.test');
  });
});

describe('last team sync', () => {
  it('can be seeded from saved state, but never moves back in time', async () => {
    seedLastTeamSync(ROOT, '2026-10-01T00:00:00.000Z');
    expect(lastTeamSync(ROOT)).toBe('2026-10-01T00:00:00.000Z');
    startPull(ROOT, 'embedded');
    await finish();
    const after = lastTeamSync(ROOT)!;
    expect(Date.parse(after)).toBeGreaterThan(Date.parse('2026-10-01T00:00:00.000Z'));
    seedLastTeamSync(ROOT, '2026-10-01T00:00:00.000Z');
    expect(lastTeamSync(ROOT)).toBe(after);
  });

  it('is not moved by a failed pull', async () => {
    seedLastTeamSync(ROOT, '2026-10-01T00:00:00.000Z');
    fake.pulls = [EMBEDDED_CONFLICT];
    startPull(ROOT, 'embedded');
    await finish();
    expect(lastTeamSync(ROOT)).toBe('2026-10-01T00:00:00.000Z');
  });

  it('survives a listener that throws', async () => {
    onTeamSynced(() => {
      throw new Error('disk full');
    });
    startPull(ROOT, 'embedded');
    await finish();
    expect(syncState(ROOT)).toEqual({ kind: 'idle' });
    expect(lastTeamSync(ROOT)).not.toBeNull();
  });
});
