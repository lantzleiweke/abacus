import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BdProvider } from '../../src/service/bd/adapter';
import { resetAuditSchemaCache } from '../../src/service/bd/audit';
import { childEnv, runBd } from '../../src/service/bd/exec';
import { resetSnapshotState, setStorageDir } from '../../src/service/snapshot';
import { lastTeamSync, localHead, publishPreview, startPublish, startPull, syncSettled, syncState, unpublished, writesBlocked } from '../../src/service/sync';
import type { Bead } from '../../src/shared/types';

const run = promisify(execFile);
const ACTOR = 'Scratch User (panel)';

// Real bd and dolt. Two scratch clones of one project share a local `file://` Dolt remote, all under the OS temp dir.
// Never a real project, never a network remote. Setting up the remote is scratch-only: the product code never adds one.
describe.skipIf(process.env.BD_INTEGRATION !== '1')('sync (two embedded clones, one local remote)', () => {
  let tmp: string;
  let rootA: string;
  let rootB: string;
  let providerA: BdProvider;
  let providerB: BdProvider;
  let sharedId: string;

  async function bd(root: string, args: string[]): Promise<void> {
    const result = await runBd(root, args, { timeoutMs: 60_000, deadlineMs: 60_000 });
    if (result.code !== 0) throw new Error(`bd ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }

  async function exported(provider: BdProvider, id: string): Promise<Bead> {
    const bead = (await provider.export()).find((b) => b.id === id);
    if (!bead) throw new Error(`${id} is not in the export`);
    return bead;
  }

  async function retitle(provider: BdProvider, id: string, title: string): Promise<void> {
    const bead = await exported(provider, id);
    const result = await provider.update(id, bead.updatedAt, { title }, ACTOR);
    if (!result.ok) throw new Error(`expected the write to go in: ${JSON.stringify(result)}`);
  }

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(join(tmpdir(), 'oc-beads-sync-int-')));
    rootA = join(tmp, 'a');
    rootB = join(tmp, 'b');
    const remote = join(tmp, 'remote');
    await mkdir(rootA);
    await mkdir(remote);
    await run('git', ['init', '-q'], { cwd: rootA, env: childEnv() });
    await run('git', ['config', 'user.name', 'Scratch User'], { cwd: rootA, env: childEnv() });
    await bd(rootA, ['init', '--prefix', 'sx', '--non-interactive', '--quiet']);
    setStorageDir(join(tmp, 'state'));
    providerA = new BdProvider(rootA, 'embedded');
    const shared = await providerA.create({ title: 'Shared bead', type: 'task', priority: 2, parentId: null, description: '' }, ACTOR);
    sharedId = shared.id;

    // Two clones that share history.
    await cp(rootA, rootB, { recursive: true });
    providerB = new BdProvider(rootB, 'embedded');
    for (const root of [rootA, rootB]) await bd(root, ['dolt', 'remote', 'add', 'origin', `file://${remote}`]);
    await bd(rootA, ['dolt', 'push']);
    await bd(rootB, ['dolt', 'pull']);
  }, 180_000);

  afterAll(async () => {
    setStorageDir(null);
    resetSnapshotState();
    resetAuditSchemaCache();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('publishes nothing when a commit landed after the preview: the head it was read from has moved', async () => {
    await providerA.create({ title: 'Shown in the preview', type: 'task', priority: 2, parentId: null, description: '' }, ACTOR);
    const head = await localHead(rootA, 'embedded');
    expect(head).toMatch(/^[a-z0-9]{8,64}$/);
    const shown = await unpublished(rootA, 'embedded');
    expect(shown!.some((change) => change.commit === head)).toBe(true);
    await providerA.create({ title: 'Landed after the preview', type: 'task', priority: 2, parentId: null, description: '' }, ACTOR);
    expect(await localHead(rootA, 'embedded')).not.toBe(head);

    startPublish(rootA, 'embedded', head);
    await syncSettled(rootA);
    expect(syncState(rootA)).toMatchObject({ kind: 'error', code: 'preview-stale', message: 'New changes arrived since you looked. Review them again.' });
    expect((await unpublished(rootA, 'embedded'))!.length).toBe(shown!.length + 1);
  }, 180_000);

  it('publishes one clone and the other pulls it; the unpublished list empties and the sync time is set', async () => {
    const made = await providerA.create({ title: 'From A', type: 'task', priority: 2, parentId: null, description: '' }, ACTOR);

    // As the panel does: the head first, then the list it confirms.
    const head = await localHead(rootA, 'embedded');
    const before = await unpublished(rootA, 'embedded');
    expect(before).not.toBeNull();
    expect(before!.length).toBeGreaterThan(0);
    expect(before!.some((change) => change.beadIds.includes(made.id))).toBe(true);
    expect(before!.some((change) => change.commit === head)).toBe(true);

    startPublish(rootA, 'embedded', head);
    await syncSettled(rootA);
    expect(syncState(rootA)).toEqual({ kind: 'idle' });
    expect(await unpublished(rootA, 'embedded')).toEqual([]);
    expect(lastTeamSync(rootA)).not.toBeNull();

    startPull(rootB, 'embedded');
    await syncSettled(rootB);
    expect(syncState(rootB)).toEqual({ kind: 'idle' });
    expect((await exported(providerB, made.id)).title).toBe('From A');
  }, 180_000);

  it('publishes a previewed change that its own pull had to merge with the team\'s: the merge commit is allowed', async () => {
    await providerB.create({ title: 'From B, first', type: 'task', priority: 2, parentId: null, description: '' }, ACTOR);
    startPublish(rootB, 'embedded', await localHead(rootB, 'embedded'));
    await syncSettled(rootB);
    expect(syncState(rootB)).toEqual({ kind: 'idle' });

    const mine = await providerA.create({ title: 'From A, behind the team', type: 'task', priority: 2, parentId: null, description: '' }, ACTOR);
    const head = await localHead(rootA, 'embedded');
    startPublish(rootA, 'embedded', head);
    await syncSettled(rootA);
    expect(syncState(rootA)).toEqual({ kind: 'idle' });
    expect(await unpublished(rootA, 'embedded')).toEqual([]);

    startPull(rootB, 'embedded');
    await syncSettled(rootB);
    expect((await exported(providerB, mine.id)).title).toBe('From A, behind the team');
  }, 180_000);

  it('a same-field edit on both sides is a backed-out conflict: both sides listed, local edit intact, nothing pushed', async () => {
    await retitle(providerA, sharedId, 'A title');
    startPublish(rootA, 'embedded', await localHead(rootA, 'embedded'));
    await syncSettled(rootA);
    expect(syncState(rootA)).toEqual({ kind: 'idle' });

    await retitle(providerB, sharedId, 'B title');
    startPull(rootB, 'embedded');
    await syncSettled(rootB);
    const state = syncState(rootB);
    expect(state).toMatchObject({ kind: 'conflict', mode: 'embedded', halfMerged: false });
    if (state.kind !== 'conflict') throw new Error('unreachable');
    expect(state.beads.map((b) => b.beadId)).toContain(sharedId);
    expect(state.log).toContain('dolt pull');
    expect(writesBlocked(rootB)).toBe(false);
    expect((await exported(providerB, sharedId)).title).toBe('B title');

    // Publishing from the conflicted clone stops at the pull: nothing reaches the remote.
    startPublish(rootB, 'embedded', await localHead(rootB, 'embedded'));
    await syncSettled(rootB);
    const again = syncState(rootB);
    expect(again).toMatchObject({ kind: 'conflict', halfMerged: false });
    if (again.kind !== 'conflict') throw new Error('unreachable');
    expect(again.log).not.toContain('dolt push');
    startPull(rootA, 'embedded');
    await syncSettled(rootA);
    expect(syncState(rootA)).toEqual({ kind: 'idle' });
    expect((await exported(providerA, sharedId)).title).toBe('A title');
  }, 180_000);
});

// A team copy that has never been pushed to: there is no remote branch to compare with yet.
describe.skipIf(process.env.BD_INTEGRATION !== '1')('sync (a remote that has no branch yet)', () => {
  let tmp: string;
  let root: string;
  let provider: BdProvider;

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(join(tmpdir(), 'oc-beads-sync-empty-')));
    root = join(tmp, 'a');
    const remote = join(tmp, 'remote');
    await mkdir(root);
    await mkdir(remote);
    await run('git', ['init', '-q'], { cwd: root, env: childEnv() });
    await run('git', ['config', 'user.name', 'Scratch User'], { cwd: root, env: childEnv() });
    const init = await runBd(root, ['init', '--prefix', 'se', '--non-interactive', '--quiet'], { timeoutMs: 60_000, deadlineMs: 60_000 });
    if (init.code !== 0) throw new Error(`bd init failed: ${init.stderr || init.stdout}`);
    const add = await runBd(root, ['dolt', 'remote', 'add', 'origin', `file://${remote}`], { timeoutMs: 60_000, deadlineMs: 60_000 });
    if (add.code !== 0) throw new Error(`bd dolt remote add failed: ${add.stderr || add.stdout}`);
    setStorageDir(join(tmp, 'state'));
    provider = new BdProvider(root, 'embedded');
  }, 180_000);

  afterAll(async () => {
    setStorageDir(null);
    resetSnapshotState();
    resetAuditSchemaCache();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('lists the first changes from every local commit; publishing to a remote with no branch stops at the pull, before any push', async () => {
    await provider.create({ title: 'First for the team', type: 'task', priority: 2, parentId: null, description: '' }, ACTOR);
    const head = await localHead(root, 'embedded');
    expect((await unpublished(root, 'embedded'))!.some((change) => change.commit === head)).toBe(true);

    // bd refuses to pull from a remote with no branches (exit 1), so the publish ends there and nothing is pushed.
    startPublish(root, 'embedded', head);
    await syncSettled(root);
    const state = syncState(root);
    expect(state).toMatchObject({ kind: 'error', message: expect.stringMatching(/^The team's shared copy is empty, so there is nothing to publish into yet./) });
    if (state.kind !== 'error') throw new Error('unreachable');
    expect(state.code).not.toBe('preview-stale');
    expect((await publishPreview(root, 'embedded'))!.teamEmpty).toBe(true);
    expect(state.log).toContain('no branches found in remote');
    expect(state.log).not.toContain('dolt push');
    expect((await unpublished(root, 'embedded'))!.some((change) => change.commit === head)).toBe(true);
  }, 180_000);
});
