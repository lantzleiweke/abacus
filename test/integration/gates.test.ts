import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetAuditSchemaCache } from '../../src/service/bd/audit';
import { BdProvider, WriteError } from '../../src/service/bd/adapter';
import { childEnv, runBd, runBdJson } from '../../src/service/bd/exec';
import { getSnapshot, resetSnapshotState, setClock, setStorageDir } from '../../src/service/snapshot';
import { eligibleEpics, needsSections } from '../../src/panel/needs';
import { PLAN_APPROVAL_REASON, REVIEW_REASON } from '../../src/shared/gates';
import type { Gate, SnapshotResponse } from '../../src/shared/types';

const run = promisify(execFile);

function full(res: SnapshotResponse): Extract<SnapshotResponse, { unchanged: false }> {
  if (res.unchanged) throw new Error('expected a full snapshot');
  return res;
}

type ListedGate = { id: string; description?: string; await_type?: string; timeout?: number; created_by?: string; created_at: string };

// Real bd and dolt, in a scratch project under the OS temp dir. Never a real project.
describe.skipIf(process.env.BD_INTEGRATION !== '1')('gates and leases in the snapshot (embedded bd)', () => {
  let tmp: string;
  let root: string;
  let now: number;
  let taskA: string;
  let taskB: string;
  let epic: string;

  async function bd(args: string[]): Promise<void> {
    const result = await runBd(root, args);
    if (result.code !== 0) throw new Error(`bd ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }

  async function create(title: string, type: string): Promise<string> {
    return (await runBdJson<{ id: string }>(root, ['create', title, '-t', type, '-p', '2', '--actor', 'Scratch User (panel)', '--json'])).id;
  }

  /** What `bd gate list --json` says, in the shape of a snapshot gate (without `blocks`, which bd does not list). */
  async function listed(): Promise<Array<Omit<Gate, 'blocks'>>> {
    const rows = (await runBdJson<ListedGate[] | null>(root, ['--readonly', 'gate', 'list', '--json'])) ?? [];
    return rows.map((row) => {
      const at = (row.description ?? '').indexOf('\n\nReason: ');
      const reason = at < 0 ? null : (row.description ?? '').slice(at + '\n\nReason: '.length).trim();
      return {
        id: row.id,
        kind: row.await_type ?? 'unknown',
        reason,
        createdBy: row.created_by ?? null,
        createdAt: row.created_at,
        timeoutMs: typeof row.timeout === 'number' ? row.timeout / 1e6 : null,
        planApproval: row.await_type === 'human' && reason !== null && reason.startsWith(PLAN_APPROVAL_REASON),
      };
    });
  }

  const withoutBlocks = (gates: Gate[]): Array<Omit<Gate, 'blocks'>> => gates.map(({ blocks: _blocks, ...rest }) => rest);
  const byId = <T extends { id: string }>(list: T[]): T[] => [...list].sort((a, b) => (a.id < b.id ? -1 : 1));

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(join(tmpdir(), 'oc-beads-gates-int-')));
    root = join(tmp, 'proj');
    await run('mkdir', [root]);
    await run('git', ['init', '-q'], { cwd: root, env: childEnv() });
    await run('git', ['config', 'user.name', 'Scratch User'], { cwd: root, env: childEnv() });
    await bd(['init', '--prefix', 'gt', '--non-interactive', '--quiet']);
    taskA = await create('Task A', 'task');
    taskB = await create('Task B', 'task');
    epic = await create('Epic one', 'epic');
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

  it('derives the same open gates as bd gate list, and keeps gate rows out of beads', async () => {
    const none = full(await getSnapshot(root));
    expect(none.capabilities).toEqual({ eventsJournal: true, leases: true });
    expect(none.gates).toEqual([]);
    expect(await listed()).toEqual([]);

    await bd(['gate', 'create', '--type=human', '--blocks', taskA, '--reason', REVIEW_REASON, '--actor', 'Scratch User (panel)']);
    await bd(['gate', 'create', '--type=timer', '--timeout=2h', '--blocks', taskB, '--actor', 'Scratch User (panel)']);
    await bd(['gate', 'create', '--type=human', '--blocks', epic, '--reason', PLAN_APPROVAL_REASON, '--actor', 'Scratch User (panel)']);
    now += 61_000;
    const res = full(await getSnapshot(root, none.cursor));

    expect(res.gates).toHaveLength(3);
    expect(byId(withoutBlocks(res.gates))).toEqual(byId(await listed()));
    expect(res.gateIds.sort()).toEqual(res.gates.map((g) => g.id).sort());
    const blocked = Object.fromEntries(res.gates.map((g) => [g.reason ?? g.kind, g.blocks]));
    expect(blocked).toEqual({ [REVIEW_REASON]: [taskA], timer: [taskB], [PLAN_APPROVAL_REASON]: [epic] });
    expect(res.gates.find((g) => g.kind === 'timer')?.timeoutMs).toBe(7_200_000);
    expect(res.gates.find((g) => g.planApproval)?.blocks).toEqual([epic]);

    // No gate row reached the beads, the unseen set or the feed.
    expect(res.beads.map((b) => b.id).sort()).toEqual([taskA, taskB, epic].sort());
    for (const g of res.gates) {
      expect(res.readyIds).not.toContain(g.id);
      expect(res.unseenIds).not.toContain(g.id);
      expect(res.activity.map((e) => e.beadId)).not.toContain(g.id);
    }
    expect(res.freshness.localError).toBeNull();
  }, 90_000);

  it('a gate resolved through bd drops out of gates, and its id stays known', async () => {
    const before = full(await getSnapshot(root));
    const review = before.gates.find((g) => g.reason === REVIEW_REASON)!;
    await bd(['gate', 'resolve', review.id, '--reason', 'Looks good', '--actor', 'Scratch User (panel)']);
    now += 61_000;
    const after = full(await getSnapshot(root, before.cursor));

    expect(after.gates.map((g) => g.id)).not.toContain(review.id);
    expect(after.gateIds).toContain(review.id);
    expect(byId(withoutBlocks(after.gates))).toEqual(byId(await listed()));
    // The edge persists on the bead it blocked.
    expect(after.beads.find((b) => b.id === taskA)?.dependencies.map((d) => d.to)).toContain(review.id);
    expect(after.beads.map((b) => b.id)).not.toContain(review.id);
    expect(after.activity.filter((e) => !e.historical && e.beadId === review.id)).toEqual([]);
  }, 90_000);

  it('lists a claim lease, and an unclaimed project lists none', async () => {
    const before = full(await getSnapshot(root));
    expect(before.leases).toEqual([]);
    await bd(['update', taskB, '--claim', '--actor', 'agent-one']);
    now += 61_000;
    const after = full(await getSnapshot(root, before.cursor));
    expect(after.leases).toEqual([{ beadId: taskB, holder: 'agent-one', expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/) }]);
    expect(after.cursor).not.toBe(before.cursor);
  }, 90_000);

  it('a review blocks close until it is resolved, and the panel and an agent leave different marks in Activity', async () => {
    const provider = new BdProvider(root, 'embedded');
    const task = await create('Gated task', 'task');
    const before = full(await getSnapshot(root));

    // The panel asks for a review: a gate opens, the bead cannot be closed, and asking again names the open one.
    const asked = await provider.gateCreate(task, REVIEW_REASON, 'Scratch User (panel)');
    if (!asked.ok) throw new Error('expected a new gate');
    expect(asked.gate).toMatchObject({ kind: 'human', reason: REVIEW_REASON, blocks: [task], planApproval: false });
    const again = await provider.gateCreate(task, REVIEW_REASON, 'Scratch User (panel)');
    expect(again).toMatchObject({ ok: false, code: 'already-open', gate: { id: asked.gate.id } });

    const bead = (await provider.export()).find((b) => b.id === task)!;
    const refused = await provider.update(task, bead.updatedAt, { status: 'closed' }, 'Scratch User (panel)').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(WriteError);
    expect((refused as WriteError).code).toBe('blocked');

    now += 61_000;
    const opened = full(await getSnapshot(root, before.cursor));
    const openRows = opened.activity.filter((e) => !e.historical && e.gateId === asked.gate.id);
    expect(openRows.map((e) => [e.kind, e.beadId, e.byPanel])).toEqual([['gate_opened', task, true]]);
    expect(opened.activity.filter((e) => !e.historical && e.beadId === task && e.kind === 'dep_added')).toEqual([]);

    // An agent resolves it with bd: its own name is on the row, and it is not the panel's.
    await bd(['gate', 'resolve', asked.gate.id, '--reason', 'Reviewed', '--actor', 'Claude Code']);
    now += 61_000;
    const resolved = full(await getSnapshot(root, opened.cursor));
    expect(resolved.gates.map((g) => g.id)).not.toContain(asked.gate.id);
    const closedRows = resolved.activity.filter((e) => !e.historical && e.kind === 'gate_resolved' && e.gateId === asked.gate.id);
    expect(closedRows).toHaveLength(1);
    expect(closedRows[0]).toMatchObject({ beadId: task, actor: 'Claude Code', byPanel: false, reason: REVIEW_REASON });

    // Now the bead closes.
    const free = (await provider.export()).find((b) => b.id === task)!;
    const done = await provider.update(task, free.updatedAt, { status: 'closed' }, 'Scratch User (panel)');
    expect(done).toMatchObject({ ok: true, bead: { status: 'closed' } });
  }, 180_000);

  it('a panel resolve is credited to the panel, and resolving twice reports the first resolve', async () => {
    const provider = new BdProvider(root, 'embedded');
    const task = await create('Panel gated', 'task');
    const asked = await provider.gateCreate(task, REVIEW_REASON, 'Scratch User (panel)');
    if (!asked.ok) throw new Error('expected a new gate');
    const before = full(await getSnapshot(root));
    expect(before.gates.map((g) => g.id)).toContain(asked.gate.id);

    expect(await provider.gateResolve(asked.gate.id, 'Fine', 'Scratch User (panel)')).toMatchObject({ ok: true, gateId: asked.gate.id });
    now += 61_000;
    const after = full(await getSnapshot(root, before.cursor));
    const row = after.activity.find((e) => !e.historical && e.kind === 'gate_resolved' && e.gateId === asked.gate.id);
    expect(row).toMatchObject({ beadId: task, actor: 'Scratch User (panel)', byPanel: true, unseen: false });

    expect(await provider.gateResolve(asked.gate.id, undefined, 'Someone Else (panel)')).toMatchObject({ ok: false, code: 'already-resolved', resolvedBy: 'Scratch User (panel)' });
  }, 180_000);

  it('the Asked set is the set bd human list prints, and eligible epics are the ones bd epic status --eligible-only prints', async () => {
    const askOne = await create('Which region?', 'task');
    const askTwo = await create('Keep the legacy token?', 'task');
    const askDone = await create('Already answered', 'task');
    const askParent = await create('Can I remove the old format?', 'task');
    await runBdJson(root, ['create', 'Count old requests', '-t', 'task', '-p', '2', '--parent', askParent, '--actor', 'Scratch User (panel)', '--json']);
    for (const id of [askOne, askTwo, askDone, askParent]) await bd(['update', id, '--add-label', 'human', '--actor', 'Scratch User (panel)']);
    await bd(['human', 'respond', askDone, '--response', 'Yes', '--actor', 'Scratch User (panel)']);

    const doneEpic = await create('Finished epic', 'epic');
    const openEpic = await create('Unfinished epic', 'epic');
    const closedEpic = await create('Closed epic', 'epic');
    const child = async (parent: string, title: string): Promise<string> =>
      (await runBdJson<{ id: string }>(root, ['create', title, '-t', 'task', '-p', '2', '--parent', parent, '--actor', 'Scratch User (panel)', '--json'])).id;
    for (const id of [await child(doneEpic, 'Done one'), await child(doneEpic, 'Done two'), await child(closedEpic, 'Closed one')]) await bd(['close', id, '--actor', 'Scratch User (panel)']);
    await child(openEpic, 'Still open');
    await bd(['close', closedEpic, '--actor', 'Scratch User (panel)']);

    const before = full(await getSnapshot(root));
    now += 61_000;
    const snap = full(await getSnapshot(root, before.cursor));

    const listedHuman = (await runBdJson<Array<{ id: string }> | null>(root, ['--readonly', 'human', 'list', '--json'])) ?? [];
    const sections = needsSections({ snapshot: snap, staleDays: 3, keep: {} }, now);
    // A human request that is also waiting on a gate belongs to Waiting, so none here is gated.
    expect(snap.gates.flatMap((g) => g.blocks).filter((id) => listedHuman.some((h) => h.id === id))).toEqual([]);
    expect(sections.asked.map((r) => r.bead.id).sort()).toEqual(listedHuman.map((h) => h.id).sort());
    expect(sections.asked.map((r) => r.bead.id)).not.toContain(askDone);
    // The request with an open child is asked, and cannot be closed by answering.
    expect(sections.asked.find((r) => r.bead.id === askParent)?.blockers.length).toBeGreaterThan(0);
    expect(sections.asked.find((r) => r.bead.id === askOne)?.blockers).toEqual([]);

    const eligible = (await runBdJson<Array<{ epic: { id: string }; total_children: number; closed_children: number; eligible_for_close: boolean }> | null>(root, ['--readonly', 'epic', 'status', '--eligible-only', '--json'])) ?? [];
    expect(eligible.every((e) => e.eligible_for_close && e.total_children === e.closed_children)).toBe(true);
    expect(eligibleEpics(snap.beads, snap.statuses).map((b) => b.id).sort()).toEqual(eligible.map((e) => e.epic.id).sort());
    expect(eligible.map((e) => e.epic.id)).toContain(doneEpic);
    expect(eligible.map((e) => e.epic.id)).not.toContain(openEpic);
    expect(eligible.map((e) => e.epic.id)).not.toContain(closedEpic);
  }, 180_000);
});
