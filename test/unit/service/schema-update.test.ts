import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

import { BdProvider, resetPanelActorCache, WriteError } from '../../../src/service/bd/adapter';
import { readAuditEvents, runSql } from '../../../src/service/bd/audit';
import { BdError, runBd, runBdJson, runDolt, runGit } from '../../../src/service/bd/exec';
import { isRemoteMigrateGate, readErrorText, schemaSkewOf, SCHEMA_UPDATE_TEXT } from '../../../src/service/errors';
import { createRoutes } from '../../../src/service/routes';
import { startUpdate, whenUpdateSettled } from '../../../src/service/schema-update';
import { cachedSchemaSkew, getSnapshot, readFailureDropped, resetSnapshotState, setClock, setStorageDir } from '../../../src/service/snapshot';
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
const fixture = (name: string): string => readFileSync(join(__dirname, '../../fixtures/bd13', name), 'utf8');
/** What bd 1.3.1 printed for `bd --readonly list --json` on a store still at schema v32. */
const SKEW_STDERR = fixture('schema-skew.stderr').trim();
const skewError = (): BdError => new BdError('exit', SKEW_STDERR.replace(/^Error: /, ''), { code: 1, stderr: SKEW_STDERR });
const STATUSES = JSON.stringify({ built_in_statuses: [{ name: 'open', category: 'active', icon: 'o' }] });
const TYPES = JSON.stringify({ core_types: [{ name: 'task', description: '' }] });
const ROOT = '/work/proj';

describe('schemaSkewOf (the real bd 1.3.1 refusal)', () => {
  it('reads the two versions from the saved stderr', () => {
    expect(SKEW_STDERR).toContain('schema version mismatch: database is at v32, binary expects v66, and the read-only open cannot migrate it');
    expect(schemaSkewOf(skewError())).toEqual({ from: 32, to: 66 });
    // The versions are read, not hard-coded.
    const other = new BdError('exit', 'x', { code: 1, stderr: 'Error: failed to open database: schema version mismatch: database is at v53, binary expects v70, and the read-only open cannot migrate it; run any bd write command' });
    expect(schemaSkewOf(other)).toEqual({ from: 53, to: 70 });
  });

  it('is not tripped by other failures, or by half of the refusal', () => {
    expect(schemaSkewOf(new BdError('exit', 'Error: no beads database found', { code: 1, stderr: 'Error: no beads database found' }))).toBeNull();
    expect(schemaSkewOf(new BdError('lock', 'bd is busy: database is locked', { code: 1 }))).toBeNull();
    // A newer store than the binary is a different problem: nothing here would fix it.
    expect(schemaSkewOf(new BdError('exit', 'x', { code: 1, stderr: 'Error: schema version mismatch: database is at v70, binary expects v66' }))).toBeNull();
    expect(schemaSkewOf(new Error(SKEW_STDERR))).toBeNull();
    expect(schemaSkewOf('schema version mismatch')).toBeNull();
  });

  it('is plain copy, with no raw text, and the same on the poll path and the try-again path', () => {
    expect(readErrorText(skewError(), true)).toBe(SCHEMA_UPDATE_TEXT);
    expect(readErrorText(skewError(), false)).toBe(SCHEMA_UPDATE_TEXT);
    expect(SCHEMA_UPDATE_TEXT).not.toMatch(/schema|v\d+|stderr/i);
  });

  it('is never answered by setting BD_IGNORE_SCHEMA_SKEW or --ignore-schema-skew anywhere in src (stripping it from the child env is the one mention)', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const SRC = join(__dirname, '../../../src');
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && /BD_IGNORE_SCHEMA_SKEW|ignore-schema-skew/i.test(readFileSync(path, 'utf8').replace(/`BD_IGNORE_SCHEMA_SKEW`/g, '').replace(/^\s*'BD_IGNORE_SCHEMA_SKEW',\s*$/m, ''))) hits.push(path);
      }
    };
    walk(SRC);
    expect(hits).toEqual([]);
  });
});

describe('the snapshot of a project on an older schema', () => {
  let tmp: string;
  let root: string;
  let now: number;
  let skewed: boolean;
  const T0 = Date.parse('2026-10-15T10:00:00.000Z');
  const workspace = (): WorkspaceState => ({ kind: 'ok', root, mode: 'embedded', bdVersion: '1.3.1', hasRemote: false, projectName: 'demo' });
  const full = (res: SnapshotResponse): Extract<SnapshotResponse, { unchanged: false }> => {
    if (res.unchanged) throw new Error('expected a full snapshot');
    return res;
  };

  beforeEach(async () => {
    for (const mock of [bd, bdJson, dolt, git, detect, auditRead, sql]) mock.mockReset();
    resetPanelActorCache();
    resetSnapshotState();
    tmp = await mkdtemp(join(tmpdir(), 'oc-beads-schema-'));
    root = join(tmp, 'proj');
    await mkdir(join(root, '.beads'), { recursive: true });
    await writeFile(join(root, '.beads', 'metadata.json'), JSON.stringify({ dolt_mode: 'embedded', dolt_database: 'testdb' }));
    setStorageDir(join(tmp, 'state'));
    now = T0;
    setClock(() => now);
    skewed = true;
    auditRead.mockResolvedValue([]);
    bdJson.mockImplementation(async (dir, args, opts) => JSON.parse((await bd(dir, args, opts)).stdout) as never);
    bd.mockImplementation(async (_dir, args) => {
      const name = args.find((a) => !a.startsWith('-'));
      if (skewed) throw skewError();
      if (name === 'export') return ok('');
      if (name === 'statuses') return ok(STATUSES);
      if (name === 'types') return ok(TYPES);
      if (name === 'ready') return ok('[]');
      throw new Error(`unexpected bd call: ${args.join(' ')}`);
    });
    git.mockResolvedValue(ok('Ann\n'));
    dolt.mockResolvedValue(ok('{}'));
    sql.mockRejectedValue(new Error('no signal'));
    detect.mockImplementation(async () => workspace());
  });

  afterEach(async () => {
    setClock(null);
    setStorageDir(null);
    resetSnapshotState();
    await rm(tmp, { recursive: true, force: true });
  });

  it('reports needs-schema-update with the two versions, in plain copy, and keeps the raw text for Copy details', async () => {
    const res = full(await getSnapshot(root));
    expect(res.workspace.kind).toBe('ok');
    expect(res.beads).toEqual([]);
    expect(res.freshness.schemaUpdate).toEqual({ from: 32, to: 66 });
    expect(res.freshness.localError).toBe(SCHEMA_UPDATE_TEXT);
    expect(res.freshness.localErrorDetail).toContain('schema version mismatch: database is at v32, binary expects v66');
  });

  it('every read the snapshot makes is --readonly, and none ignores the skew', async () => {
    await getSnapshot(root);
    expect(bd.mock.calls.length).toBeGreaterThan(0);
    for (const [, args] of bd.mock.calls) {
      expect(args).toContain('--readonly');
      expect(args.join(' ')).not.toMatch(/ignore-schema-skew/i);
    }
  });

  it('is empty for a project that reads normally', async () => {
    skewed = false;
    const res = full(await getSnapshot(root));
    expect(res.freshness.schemaUpdate ?? null).toBeNull();
    expect(res.freshness.localError).toBeNull();
  });

  it('readFailureDropped makes the very next snapshot read again, inside the 4 s throttle, and clears the state', async () => {
    const first = full(await getSnapshot(root));
    expect(first.freshness.schemaUpdate).toEqual({ from: 32, to: 66 });
    const exports = () => bd.mock.calls.filter(([, args]) => args.includes('export')).length;
    const readsBefore = exports();

    // Without it, a poll right after (inside the throttle window) answers from what is held: still the old failure.
    now += 500;
    expect(full(await getSnapshot(root)).freshness.schemaUpdate).toEqual({ from: 32, to: 66 });
    expect(exports()).toBe(readsBefore);

    skewed = false;
    readFailureDropped(root);
    now += 500;
    const next = full(await getSnapshot(root));
    expect(exports()).toBeGreaterThan(readsBefore);
    expect(next.freshness.schemaUpdate ?? null).toBeNull();
    expect(next.freshness.localError).toBeNull();
    expect(next.statuses.map((s) => s.name)).toEqual(['open']);
  });

  it('readFailureDropped also drops the detected workspace, so the remote is looked up again on the updated store', async () => {
    await getSnapshot(root);
    await getSnapshot(root);
    const detections = detect.mock.calls.length;
    skewed = false;
    readFailureDropped(root);
    await getSnapshot(root);
    expect(detect.mock.calls.length).toBe(detections + 1);
  });

  it('readFailureDropped for a root nothing is known about does nothing', () => {
    expect(() => readFailureDropped('/no/such/root')).not.toThrow();
  });

  describe('while the update runs as a background job', () => {
    it('a poll answers from what is held with the job in freshness: no bd call, no detection, even with refreshWorkspace and never loaded', async () => {
      expect(full(await getSnapshot(root)).freshness.schemaUpdate).toEqual({ from: 32, to: 66 });
      let finish: () => void = () => undefined;
      startUpdate(root, () => new Promise((resolve) => (finish = () => resolve(null))));
      bd.mockClear();
      sql.mockClear();
      detect.mockClear();
      now += 30_000;
      const res = full(await getSnapshot(root, undefined, true));
      expect(res.freshness.schemaUpdate).toEqual({ from: 32, to: 66 });
      expect(res.freshness.schemaUpdateJob).toMatchObject({ kind: 'running' });
      expect(bd).not.toHaveBeenCalled();
      expect(sql).not.toHaveBeenCalled();
      expect(detect).not.toHaveBeenCalled();
      finish();
      await whenUpdateSettled(root);
      expect(full(await getSnapshot(root)).freshness.schemaUpdateJob ?? null).toBeNull();
    });

    it('an unchanged answer still carries the job, so "Check again" shows it is still running', async () => {
      const first = full(await getSnapshot(root));
      let finish: () => void = () => undefined;
      startUpdate(root, () => new Promise((resolve) => (finish = () => resolve(null))));
      const again = await getSnapshot(root, first.cursor);
      const freshness = 'freshness' in again ? again.freshness : null;
      expect(freshness?.schemaUpdateJob).toMatchObject({ kind: 'running' });
      finish();
      await whenUpdateSettled(root);
    });

    it('a failed job stays in freshness through polls and goes only when a read worked', async () => {
      await getSnapshot(root);
      startUpdate(root, async () => ({ kind: 'failed', code: 'update-blocked-shared', message: 'This project shares its beads with your team.' }));
      await whenUpdateSettled(root);
      for (let i = 0; i < 3; i += 1) {
        now += 5_000;
        expect(full(await getSnapshot(root)).freshness.schemaUpdateJob).toMatchObject({ kind: 'failed', code: 'update-blocked-shared' });
      }
      // Updated by someone else: the next window reads for real.
      skewed = false;
      now += 5_000;
      expect(full(await getSnapshot(root)).freshness.schemaUpdateJob ?? null).toBeNull();
    });
  });

  describe('the flag survives everything but a read that worked', () => {
    const SIGNAL = [{ working: 'w1', head: 'h1' }];
    const writeCalls = () => bd.mock.calls.filter(([, args]) => !args.includes('--readonly'));
    const comment = async () => createRoutes().comment({ directory: root, id: 'a', text: 'hi' });

    beforeEach(() => {
      skewed = false;
      // The change signal comes from `dolt sql`, which does not check bd's schema: it answers, unchanged, on an old store.
      sql.mockResolvedValue(SIGNAL);
    });

    it('a write inside the 60 s window after the last good export, on a store that turned old, is refused 409 and runs no bd', async () => {
      expect(full(await getSnapshot(root)).freshness.schemaUpdate ?? null).toBeNull();
      expect(cachedSchemaSkew(root)).toBeNull();
      const exportedAt = now;
      // bd is upgraded under the running service: the same signal, but the store now reads as old.
      skewed = true;
      detect.mockImplementation(async () => ({ ...workspace(), bdVersion: '1.3.2' }) as WorkspaceState);
      now += 5_000;
      expect(now - exportedAt).toBeLessThan(60_000);
      expect(full(await getSnapshot(root, undefined, true)).freshness.schemaUpdate).toEqual({ from: 32, to: 66 });
      expect(cachedSchemaSkew(root)).toEqual({ from: 32, to: 66 });

      for (let i = 0; i < 3; i += 1) {
        now += 5_000;
        // The signal is unchanged each time: none of these polls may say the store is fine.
        expect(full(await getSnapshot(root)).freshness.schemaUpdate).toEqual({ from: 32, to: 66 });
        expect(cachedSchemaSkew(root)).toEqual({ from: 32, to: 66 });
      }
      bd.mockClear();
      const res = await comment();
      expect(res.status).toBe(409);
      expect(res.json).toMatchObject({ error: { code: 'needs-schema-update', schemaUpdate: { from: 32, to: 66 } } });
      expect(writeCalls()).toEqual([]);
    });

    it('polls with an unchanged signal keep the flag, and a read that worked clears it', async () => {
      await getSnapshot(root);
      skewed = true;
      now += 61_000;
      expect(full(await getSnapshot(root)).freshness.schemaUpdate).toEqual({ from: 32, to: 66 });
      now += 5_000;
      expect(full(await getSnapshot(root)).freshness.schemaUpdate).toEqual({ from: 32, to: 66 });
      // Updated elsewhere (the person ran bd themselves): the next window reads for real, and says so.
      skewed = false;
      now += 5_000;
      const res = full(await getSnapshot(root));
      expect(res.freshness.schemaUpdate ?? null).toBeNull();
      expect(cachedSchemaSkew(root)).toBeNull();
    });

    it('a lock or a timeout while old does not say the store is fine', async () => {
      await getSnapshot(root);
      skewed = true;
      now += 61_000;
      await getSnapshot(root);
      expect(cachedSchemaSkew(root)).toEqual({ from: 32, to: 66 });
      bd.mockImplementation(async () => {
        throw new BdError('timeout', 'bd timed out after 15000 ms');
      });
      now += 5_000;
      const res = full(await getSnapshot(root));
      expect(res.freshness.schemaUpdate).toEqual({ from: 32, to: 66 });
      expect(cachedSchemaSkew(root)).toEqual({ from: 32, to: 66 });
    });
  });
});

describe('BdProvider.migrateSchema (the one explicit update)', () => {
  let after: 'ok' | 'skew' | 'busy';

  beforeEach(() => {
    after = 'ok';
    bd.mockReset();
    bdJson.mockReset();
    bd.mockImplementation(async () => ok('✓ Schema already at v66\n'));
    bdJson.mockImplementation(async () => {
      if (after === 'skew') throw skewError();
      if (after === 'busy') throw new BdError('timeout', 'bd timed out after 15000 ms');
      return JSON.parse(STATUSES) as never;
    });
  });

  it('runs exactly one write, with the panel actor and no --force, then re-reads read-only', async () => {
    await new BdProvider(ROOT, 'embedded').migrateSchema('Ann (panel)');
    expect(bd).toHaveBeenCalledTimes(1);
    expect(bd.mock.calls[0]![1]).toEqual(['--actor', 'Ann (panel)', 'migrate', 'schema']);
    expect(bd.mock.calls[0]![1]).not.toContain('--force');
    expect(bdJson).toHaveBeenCalledTimes(1);
    expect(bdJson.mock.calls[0]![1].slice(0, 1)).toEqual(['--readonly']);
  });

  it('a project that still reads as old after the update is a failure, not a success', async () => {
    after = 'skew';
    const error = await new BdProvider(ROOT, 'embedded').migrateSchema('Ann (panel)').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WriteError);
    expect(error).toMatchObject({ code: 'failed' });
    expect((error as WriteError).detail).toContain('schema version mismatch');
  });

  it('an update that ran but cannot be read back is uncertain and saved', async () => {
    after = 'busy';
    const error = await new BdProvider(ROOT, 'embedded').migrateSchema('Ann (panel)').catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'WriteError', code: 'uncertain', saved: true });
  });

  it('a refused update is a WriteError, and nothing is read back', async () => {
    bd.mockResolvedValue({ stdout: '', stderr: 'Error: something else went wrong', code: 1 });
    const error = await new BdProvider(ROOT, 'embedded').migrateSchema('Ann (panel)').catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'WriteError', code: 'failed' });
    expect((error as WriteError).detail).toContain('something else went wrong');
    expect(bdJson).not.toHaveBeenCalled();
  });

  it("a store that syncs with a team remote: bd's real refusal is its own code with the plain who-can-do-it copy, never forced, not retried", async () => {
    const stderr = fixture('migrate-schema-remote-refused.stderr');
    expect(stderr).toContain('remote-backed database');
    bd.mockResolvedValue({ stdout: '', stderr, code: 1 });
    const error = await new BdProvider(ROOT, 'embedded').migrateSchema('Ann (panel)').catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'WriteError', code: 'update-blocked-shared', saved: false });
    expect((error as WriteError).message).toBe(
      "This project shares its beads with your team, so Beads won't update it from here. Ask whoever set up the team copy to update it, or update it on the computer that hosts it.",
    );
    expect((error as WriteError).message).not.toMatch(/\b(bd|migrat\w*|schema|dolt|force)\b|—/i);
    // bd's raw words stay in the detail for the Details disclosure.
    expect((error as WriteError).detail).toContain('refusing to auto-apply 34 pending schema migrations');
    expect(bd).toHaveBeenCalledTimes(1);
    expect(bd.mock.calls[0]![1]).not.toContain('--force');
    expect(bdJson).not.toHaveBeenCalled();
  });

  it.each(['migrate-schema-remote-adopt.stderr', 'migrate-schema-remote-diverged.stderr', 'migrate-schema-shared-server.stderr'])(
    "bd's other refusals for a shared store (%s) give the same shared-project result, never forced, never retried",
    async (name) => {
      const stderr = fixture(name);
      expect(isRemoteMigrateGate(stderr)).toBe(true);
      bd.mockResolvedValue({ stdout: '', stderr, code: 1 });
      const error = await new BdProvider(ROOT, 'embedded').migrateSchema('Ann (panel)').catch((e: unknown) => e);
      expect(error).toMatchObject({ name: 'WriteError', code: 'update-blocked-shared', saved: false });
      expect((error as WriteError).message).toMatch(/^This project shares its beads with your team/);
      expect((error as WriteError).detail).toContain('refusing to');
      expect(bd).toHaveBeenCalledTimes(1);
      expect(bd.mock.calls[0]![1]).not.toContain('--force');
      expect(bdJson).not.toHaveBeenCalled();
    },
  );

  it('a refusal whose words read as a lock still ends as the shared-project result, not as busy', async () => {
    bd.mockRejectedValue(new BdError('lock', `bd is busy: ${fixture('migrate-schema-shared-server.stderr').trim()}`, { code: 1, stderr: fixture('migrate-schema-shared-server.stderr') }));
    expect(await new BdProvider(ROOT, 'embedded').migrateSchema('Ann (panel)').catch((e: unknown) => e)).toMatchObject({ code: 'update-blocked-shared' });
  });

  it('a real lock on the update stays busy', async () => {
    bd.mockRejectedValue(new BdError('lock', 'bd is busy: database is locked', { code: 1, stderr: 'database is locked' }));
    expect(await new BdProvider(ROOT, 'embedded').migrateSchema('Ann (panel)').catch((e: unknown) => e)).toMatchObject({ code: 'busy' });
  });

  it('only the gate text counts: another failure that mentions a remote stays a plain failure', async () => {
    bd.mockResolvedValue({ stdout: '', stderr: 'Error: remote origin is not reachable', code: 1 });
    expect(await new BdProvider(ROOT, 'embedded').migrateSchema('Ann (panel)').catch((e: unknown) => e)).toMatchObject({ code: 'failed' });
  });

  it('a timeout of the update itself is uncertain (it may have run), never retried', async () => {
    bd.mockRejectedValue(new BdError('timeout', 'bd timed out after 15000 ms'));
    const error = await new BdProvider(ROOT, 'embedded').migrateSchema('Ann (panel)').catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'WriteError', code: 'uncertain' });
    expect(bd).toHaveBeenCalledTimes(1);
  });
});
