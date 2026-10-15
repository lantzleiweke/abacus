import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BdProvider } from '../../src/service/bd/adapter';
import { resetAuditSchemaCache } from '../../src/service/bd/audit';
import { childEnv, runBd, runBdJson } from '../../src/service/bd/exec';
import { getSnapshot, projectStore, resetSnapshotState, setClock, setStorageDir } from '../../src/service/snapshot';
import type { SnapshotResponse } from '../../src/shared/types';

const run = promisify(execFile);

function full(res: SnapshotResponse): Extract<SnapshotResponse, { unchanged: false }> {
  if (res.unchanged) throw new Error('expected a full snapshot');
  return res;
}

// Real bd and dolt, in a scratch project under the OS temp dir. Never a real project.
describe.skipIf(process.env.BD_INTEGRATION !== '1')('refresh loop (embedded bd)', () => {
  let tmp: string;
  let root: string;
  let now: number;

  async function bd(args: string[]): Promise<void> {
    const result = await runBd(root, args);
    if (result.code !== 0) throw new Error(`bd ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(join(tmpdir(), 'oc-beads-refresh-int-')));
    root = join(tmp, 'proj');
    await run('mkdir', [root]);
    await run('git', ['init', '-q'], { cwd: root, env: childEnv() });
    await run('git', ['config', 'user.name', 'Scratch User'], { cwd: root, env: childEnv() });
    await bd(['init', '--prefix', 'ref', '--non-interactive', '--quiet']);
    setStorageDir(join(tmp, 'state'));
    // Real bd, fake time: the 4 s throttle is stepped over without waiting.
    now = Date.now();
    setClock(() => now);
  }, 60_000);

  afterAll(async () => {
    setClock(null);
    setStorageDir(null);
    resetSnapshotState();
    resetAuditSchemaCache();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('reads a change signal that moves with a write', async () => {
    const provider = new BdProvider(root, 'embedded');
    const before = await provider.changeSignal();
    expect(before).toMatch(/^\w+:\w+$/);
    expect(await provider.changeSignal()).toBe(before);
    await bd(['create', 'Signal probe', '-t', 'task', '-p', '2', '--actor', 'Scratch User (panel)']);
    expect(await provider.changeSignal()).not.toBe(before);
  });

  it('shows a bead created through bd on the next snapshot, with a created change', async () => {
    const first = full(await getSnapshot(root));
    expect(first.workspace.kind).toBe('ok');
    const known = first.beads.map((b) => b.id);
    expect(first.unseenIds).toEqual([]);
    expect(first.freshness.localError).toBeNull();
    expect(first.statuses.map((s) => s.name)).toContain('open');
    expect(first.types).toContain('task');

    const created = await runBdJson<{ id: string }>(root, ['create', 'Made after the baseline', '-t', 'task', '-p', '1', '--actor', 'Teammate', '--json']);
    now += 5_000;
    const next = full(await getSnapshot(root, first.cursor));
    expect(next.beads.map((b) => b.id)).toEqual(expect.arrayContaining([...known, created.id]));
    expect(next.beads.find((b) => b.id === created.id)).toMatchObject({ title: 'Made after the baseline', priority: 1 });
    expect(next.readyIds).toContain(created.id);
    expect(next.unseenIds).toEqual([created.id]);
    const change = next.activity.find((e) => e.beadId === created.id && !e.historical);
    expect(change).toMatchObject({ kind: 'created', unseen: true, byPanel: false });
    expect(next.cursor).not.toBe(first.cursor);
    expect(next.freshness.localError).toBeNull();
  }, 60_000);

  it('answers unchanged while nothing moves, and shows an edit as a field change', async () => {
    (await projectStore(root)).markSeen('all');
    const base = full(await getSnapshot(root));
    now += 5_000;
    const still = await getSnapshot(root, base.cursor);
    expect(still.unchanged).toBe(true);

    const target = base.beads[0]!;
    await bd(['update', target.id, '--priority', target.priority === 0 ? '3' : '0', '--actor', 'Scratch User (panel)']);
    now += 5_000;
    const after = full(await getSnapshot(root, base.cursor));
    const edit = after.activity.find((e) => e.beadId === target.id && e.kind === 'field' && e.field === 'priority');
    expect(edit).toBeDefined();
    // The panel's own write is attributed to the panel and does not light up as unseen.
    expect(edit).toMatchObject({ byPanel: true, actor: 'Scratch User (panel)', unseen: false });
  }, 60_000);
});
