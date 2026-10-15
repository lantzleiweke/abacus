import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetAuditSchemaCache } from '../../src/service/bd/audit';
import { childEnv } from '../../src/service/bd/exec';
import { createRoutes } from '../../src/service/routes';
import { updateJob, whenUpdateSettled } from '../../src/service/schema-update';
import { getSnapshot, resetSnapshotState, setStorageDir } from '../../src/service/snapshot';
import type { SnapshotResponse } from '../../src/shared/types';

const run = promisify(execFile);

/** A project made by bd before 1.3 (schema v32), copied from the pre-1.3 backup. Never a server-mode backup, and never a real project. */
const BACKUP = join(homedir(), '.cache', 'beads-backup-2026-10-14-pre-1.3', 'Documents__projects__test.tgz');
const haveBackup = await access(BACKUP).then(() => true, () => false);

function full(res: SnapshotResponse): Extract<SnapshotResponse, { unchanged: false }> {
  if (res.unchanged) throw new Error('expected a full snapshot');
  return res;
}

// The explicit store update on real bd 1.3.x: the read-only open refuses the older store, the snapshot says so, the route updates it, reads work.
describe.skipIf(process.env.BD_INTEGRATION !== '1' || !haveBackup)('updating an older project store (embedded bd 1.3)', () => {
  let tmp: string;
  let root: string;
  const routes = createRoutes();

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(join(tmpdir(), 'oc-beads-schema-int-')));
    root = join(tmp, 'proj');
    await run('mkdir', [root]);
    await run('tar', ['-xzf', BACKUP, '-C', root]);
    const meta = JSON.parse(await readFile(join(root, '.beads', 'metadata.json'), 'utf8')) as { dolt_mode?: string };
    // A server-mode copy would be updated on the live server, not in this scratch directory.
    if (meta.dolt_mode === 'server') throw new Error('the backup is a server-mode project; refusing to run');
    await run('git', ['init', '-q'], { cwd: root, env: childEnv() });
    await run('git', ['config', 'user.name', 'Scratch User'], { cwd: root, env: childEnv() });
    setStorageDir(join(tmp, 'state'));
    // The store was last opened with an older bd, so the person confirms first contact before anything else, as the panel asks.
    const before = await routes.workspace({ directory: root });
    expect(before.json).toMatchObject({ kind: 'needs-first-contact', lastOpenedWith: expect.any(String) });
    expect(await routes.workspace({ directory: root, confirmFirstContact: true })).toMatchObject({ status: 200, json: { kind: 'ok' } });
  }, 60_000);

  afterAll(async () => {
    resetSnapshotState();
    setStorageDir(null);
    resetAuditSchemaCache();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('reads as needing an update, with both versions and the plain copy, and no beads', async () => {
    const snap = full(await getSnapshot(root));
    expect(snap.freshness.schemaUpdate).toEqual({ from: 32, to: expect.any(Number) });
    expect(snap.freshness.localError).toBe('This project needs a one-time update for the newer Beads.');
    expect(snap.freshness.localErrorDetail).toContain('schema version mismatch');
    expect(snap.beads).toEqual([]);
  });

  it('refuses the update without the literal confirm, and the project stays old', async () => {
    for (const body of [{}, { confirm: 'true' }, { confirm: 1 }]) {
      const res = await routes.migrateSchema({ directory: root, ...body });
      expect(res.status).toBe(400);
    }
    expect(full(await getSnapshot(root)).freshness.schemaUpdate).not.toBeNull();
  });

  it('updates with confirm as a background job: answers at once, polls meanwhile are answered, and it reads normally afterwards', async () => {
    const started = Date.now();
    const res = await routes.migrateSchema({ directory: root, confirm: true });
    // Answered at once, not after the update: the host cuts a request off at 20 s.
    expect(res).toMatchObject({ status: 200, json: { ok: true } });
    expect(Date.now() - started).toBeLessThan(2_000);
    // Polls while it runs are answered from what is held, with the job in freshness (or, when it is quick, already the new state).
    const meanwhile = full(await getSnapshot(root, undefined, true));
    if (updateJob(root)?.kind === 'running') expect(meanwhile.freshness.schemaUpdateJob).toMatchObject({ kind: 'running' });
    await whenUpdateSettled(root);
    expect(updateJob(root)).toBeNull();
    // The update itself stays inside its own budget (120 s); on this small store it takes a few seconds.
    expect(Date.now() - started).toBeLessThan(60_000);

    const snap = full(await getSnapshot(root));
    expect(snap.freshness.schemaUpdate ?? null).toBeNull();
    expect(snap.freshness.schemaUpdateJob ?? null).toBeNull();
    expect(snap.freshness.localError).toBeNull();
    expect(snap.workspace.kind).toBe('ok');
    expect(snap.beads).toEqual([]);
  }, 90_000);

  it('a second update on the current store is a no-op that still answers ok', async () => {
    expect(await routes.migrateSchema({ directory: root, confirm: true })).toMatchObject({ status: 200, json: { ok: true } });
    await whenUpdateSettled(root);
    expect(updateJob(root)).toBeNull();
  }, 60_000);
});
