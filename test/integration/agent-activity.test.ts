import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BdProvider } from '../../src/service/bd/adapter';
import { resetAuditSchemaCache } from '../../src/service/bd/audit';
import { childEnv, runBd, runBdJson } from '../../src/service/bd/exec';
import { getSnapshot, resetSnapshotState, setClock, setStorageDir } from '../../src/service/snapshot';
import { needsSections } from '../../src/panel/needs';
import type { SnapshotResponse } from '../../src/shared/types';

const run = promisify(execFile);

function full(res: SnapshotResponse): Extract<SnapshotResponse, { unchanged: false }> {
  if (res.unchanged) throw new Error('expected a full snapshot');
  return res;
}

// Real bd and dolt, in a scratch project under the OS temp dir. Never a real project.
// The live sequence of the Task 18 check: the service is already running when another actor (an agent) opens and resolves gates,
// claims a bead and keeps its claim alive between two reads.
describe.skipIf(process.env.BD_INTEGRATION !== '1')('what an agent does between two reads (embedded bd 1.3)', () => {
  let tmp: string;
  let root: string;
  let now: number;
  let taskA: string;
  let taskB: string;
  let taskC: string;

  async function bd(args: string[]): Promise<void> {
    const result = await runBd(root, args);
    if (result.code !== 0) throw new Error(`bd ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }

  async function create(title: string): Promise<string> {
    return (await runBdJson<{ id: string }>(root, ['create', title, '-t', 'task', '-p', '2', '--actor', 'Scratch User (panel)', '--json'])).id;
  }

  async function gateIdOf(beadId: string): Promise<string> {
    const rows = (await runBdJson<Array<{ id: string; description?: string }> | null>(root, ['--readonly', 'gate', 'list', '--all', '--json'])) ?? [];
    const gate = rows.find((r) => (r.description ?? '').includes(`blocking ${beadId}`));
    if (!gate) throw new Error(`no gate for ${beadId}`);
    return gate.id;
  }

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(join(tmpdir(), 'oc-beads-agent-int-')));
    root = join(tmp, 'proj');
    await run('mkdir', [root]);
    await run('git', ['init', '-q'], { cwd: root, env: childEnv() });
    await run('git', ['config', 'user.name', 'Scratch User'], { cwd: root, env: childEnv() });
    await bd(['init', '--prefix', 'ag', '--non-interactive', '--quiet']);
    taskA = await create('Task A');
    taskB = await create('Task B');
    taskC = await create('Task C');
    setStorageDir(join(tmp, 'state'));
    now = Date.now();
    setClock(() => now);
  }, 90_000);

  afterAll(async () => {
    setClock(null);
    setStorageDir(null);
    resetSnapshotState();
    resetAuditSchemaCache();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('shows a gate opened and resolved by an agent, an open one, and no row for claim heartbeats', async () => {
    const first = full(await getSnapshot(root));
    // The service has been running a while: a second poll after the window.
    now += 61_000;
    await getSnapshot(root, first.cursor);
    const base = full(await getSnapshot(root));

    await bd(['gate', 'create', '--type=human', '--blocks', taskA, '--reason', 'Review before closing', '--actor', 'Claude Code']);
    await bd(['gate', 'resolve', await gateIdOf(taskA), '--reason', 'Looked fine', '--actor', 'Claude Code']);
    await bd(['gate', 'create', '--type=human', '--blocks', taskB, '--reason', 'Review before closing', '--actor', 'Claude Code']);
    await bd(['update', taskC, '--claim', '--actor', 'Claude Code']);
    now += 61_000;
    const mid = full(await getSnapshot(root, base.cursor));
    await bd(['heartbeat', taskC, '--actor', 'Claude Code']);
    now += 61_000;
    const after = full(await getSnapshot(root, mid.cursor));

    const rows = (id: string) => after.activity.filter((e) => !e.historical && e.beadId === id);
    const forA = rows(taskA);
    expect(forA.map((e) => e.kind).sort()).toEqual(['gate_opened', 'gate_resolved']);
    expect(forA.every((e) => e.actor === 'Claude Code' && !e.byPanel && e.unseen === true)).toBe(true);
    expect(rows(taskB).map((e) => e.kind)).toEqual(['gate_opened']);

    // Lease bookkeeping is not news: no row names it, whatever the claim did.
    const fields = after.activity.filter((e) => e.beadId === taskC).map((e) => e.field);
    expect(fields).not.toContain('heartbeat_at');
    expect(fields).not.toContain('lease_expires_at');

    // And Needs me words the gate rows, not the fallback.
    const needs = needsSections({ snapshot: after, staleDays: 3, keep: {} }, now);
    const changedA = needs.changed.find((r) => r.bead.id === taskA);
    expect(changedA?.event?.kind).toBe('gate_resolved');
  }, 120_000);

  it('an upgrade from 0.1: gates and heartbeats between the last 0.1 read and the first 0.2 read show, and comments made before it are not announced again', async () => {
    const d = await create('Task D');
    const e = await create('Task E');
    const f = await create('Task F');
    await bd(['comments', 'add', d, 'Before the upgrade', '--actor', 'Ann Lee']);
    now += 61_000;
    await getSnapshot(root);
    // What 0.1 left behind: no gate list, the gate rows among the beads, and the ids bd 1.2.2 gave comments (UUIDv7, not today's UUIDv5).
    resetSnapshotState();
    const path = join(tmp, 'state', `${createHash('sha1').update(root).digest('hex')}.json`);
    const saved = JSON.parse(await readFile(path, 'utf8')) as { openGates?: unknown; snapshot: Array<{ comments: Array<{ id: string }> }> };
    delete saved.openGates;
    saved.snapshot = (await new BdProvider(root, 'embedded').export()) as unknown as typeof saved.snapshot;
    for (const b of saved.snapshot) b.comments.forEach((c, i) => (c.id = `01a1397f-4355-7ef4-878f-6c30961b95${i}${i}`));
    await writeFile(path, JSON.stringify(saved));

    // Then, before the first 0.2 read: an agent opens a gate and leaves it, opens another and resolves it, and claims a bead.
    await bd(['gate', 'create', '--type=human', '--blocks', d, '--reason', 'Review before closing', '--actor', 'Claude Code']);
    await bd(['gate', 'create', '--type=human', '--blocks', e, '--reason', 'Review before closing', '--actor', 'Claude Code']);
    await bd(['gate', 'resolve', await gateIdOf(e), '--reason', 'Looked fine', '--actor', 'Claude Code']);
    await bd(['update', f, '--claim', '--actor', 'Claude Code']);
    now += 61_000;
    const res = full(await getSnapshot(root));

    const mine = res.activity.filter((ev) => !ev.historical && ev.kind !== 'created');
    expect(mine.filter((ev) => ev.beadId === d).map((ev) => [ev.kind, ev.actor])).toEqual([['gate_opened', 'Claude Code']]);
    expect(mine.filter((ev) => ev.beadId === e).map((ev) => ev.kind).sort()).toEqual(['gate_opened', 'gate_resolved']);
    expect(mine.some((ev) => ev.kind === 'comment')).toBe(false);
    expect(mine.some((ev) => ev.field === 'heartbeat_at' || ev.field === 'lease_expires_at')).toBe(false);
    const needs = needsSections({ snapshot: res, staleDays: 3, keep: {} }, now);
    expect(needs.changed.find((r) => r.bead.id === e)?.event?.kind).toBe('gate_resolved');
    expect(needs.changed.find((r) => r.bead.id === d)?.summary).toMatch(/^Review requested .* by Claude Code/);
    expect(needs.waiting.map((r) => r.bead.id)).toContain(d);
  }, 120_000);
});
