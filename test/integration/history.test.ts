import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BdProvider } from '../../src/service/bd/adapter';
import { childEnv, runBd, runBdJson } from '../../src/service/bd/exec';
import { readHistory } from '../../src/service/history';
import { REVIEW_REASON } from '../../src/shared/gates';
import type { Bead, BeadPatch, ExpectedFields, HistoryChange, HistoryEntry } from '../../src/shared/types';

const run = promisify(execFile);
const ACTOR = 'Scratch User (panel)';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Real bd and dolt, in a scratch project under the OS temp dir. Never a real project.
describe.skipIf(process.env.BD_INTEGRATION !== '1')('bead history and restore (embedded bd)', () => {
  let tmp: string;
  let root: string;
  let id: string;
  let provider: BdProvider;

  async function current(): Promise<Bead> {
    return (await provider.export()).find((b) => b.id === id)!;
  }

  /** A change as the panel makes it: against the updatedAt it last saw. A second apart, so bd's second-resolution times tell the changes apart. */
  async function change(patch: BeadPatch, expected: ExpectedFields = {}) {
    await wait(1100);
    return provider.update(id, (await current()).updatedAt, patch, ACTOR, expected);
  }

  async function history(beadId = id, gateIds: string[] = []): Promise<HistoryEntry[]> {
    const bead = (await provider.export()).find((b) => b.id === beadId)!;
    const gateRead = await provider.gateHistory(gateIds, { utc: true });
    const result = await readHistory((limit) => provider.history(beadId, { limit, events: true }), { pageSize: 50, currentLabels: bead.labels, activity: [], beadId, gateRead, panelActor: ACTOR });
    expect(result.labelsKnown).toBe(true);
    return result.entries;
  }

  const changeOf = (entries: HistoryEntry[], field: string): { entry: HistoryEntry; change: HistoryChange } => {
    const entry = entries.find((e) => e.changes.some((c) => c.field === field))!;
    return { entry, change: entry.changes.find((c) => c.field === field)! };
  };

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(join(tmpdir(), 'oc-beads-history-int-')));
    root = join(tmp, 'proj');
    await run('mkdir', [root]);
    await run('git', ['init', '-q'], { cwd: root, env: childEnv() });
    await run('git', ['config', 'user.name', 'Scratch User'], { cwd: root, env: childEnv() });
    const init = await runBd(root, ['init', '--prefix', 'hs', '--non-interactive', '--quiet']);
    if (init.code !== 0) throw new Error(`bd init failed: ${init.stderr || init.stdout}`);
    id = (await runBdJson<{ id: string }>(root, ['create', 'History bead', '-t', 'task', '-p', '2', '--actor', 'Creator', '--json'])).id;
    provider = new BdProvider(root, 'embedded');
  }, 90_000);

  afterAll(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('lists four changes newest first, restores the oldest priority, and refuses once it moved again', async () => {
    expect((await change({ priority: 1 })).ok).toBe(true);
    expect((await change({ title: 'History bead, renamed', notes: 'first note' })).ok).toBe(true);
    expect((await change({ labels: ['beta'] })).ok).toBe(true);
    expect((await change({ acceptance: '- [ ] one\n- [ ] two' })).ok).toBe(true);

    const entries = await history();
    // Newest first, the creation last; each change by the panel's own name.
    expect(entries.map((e) => e.changes.map((c) => c.field))).toEqual([['acceptance'], ['labels'], ['title', 'notes'], ['priority'], []]);
    expect(entries.map((e) => e.actor)).toEqual([ACTOR, ACTOR, ACTOR, ACTOR, 'Creator']);
    expect(entries.map((e) => e.created === true)).toEqual([false, false, false, false, true]);
    const times = entries.map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(changeOf(entries, 'labels').change).toMatchObject({ from: [], to: ['beta'] });
    expect(changeOf(entries, 'acceptance').change).toMatchObject({ from: '', to: '- [ ] one\n- [ ] two', text: true });

    // Restore the oldest priority change: the value it replaced, expected to still be what it set.
    const oldest = changeOf(entries, 'priority');
    expect(oldest.change).toMatchObject({ from: 2, to: 1 });
    expect(oldest.entry.restorable).toEqual(['priority']);
    const restore = async () => provider.update(id, (await current()).updatedAt, { priority: oldest.change.from as number }, ACTOR, { priority: oldest.change.to as number });
    await wait(1100);
    expect(await restore()).toMatchObject({ ok: true });
    expect((await current()).priority).toBe(2);

    // The same change again, after priority moved on: the entry no longer shows what it was.
    expect((await change({ priority: 3 })).ok).toBe(true);
    await wait(1100);
    expect(await restore()).toMatchObject({ ok: false, conflict: true });
    expect((await current()).priority).toBe(3);
  }, 120_000);

  it('restores a text field: the older value goes back, and once the field moved again it is refused', async () => {
    expect((await change({ acceptance: '- [ ] one' })).ok).toBe(true);
    expect((await change({ acceptance: '- [ ] one\n- [ ] two' })).ok).toBe(true);
    const { entry, change: newest } = changeOf(await history(), 'acceptance');
    expect(newest).toMatchObject({ from: '- [ ] one', to: '- [ ] one\n- [ ] two', text: true });
    expect(entry.restorable).toContain('acceptance');
    const restore = async () => provider.update(id, (await current()).updatedAt, { acceptance: newest.from as string }, ACTOR, { acceptance: newest.to as string });
    await wait(1100);
    expect(await restore()).toMatchObject({ ok: true, bead: { acceptance: '- [ ] one' } });
    expect((await current()).acceptance).toBe('- [ ] one');

    expect((await change({ acceptance: '- [ ] three' })).ok).toBe(true);
    await wait(1100);
    expect(await restore()).toMatchObject({ ok: false, conflict: true });
    expect((await current()).acceptance).toBe('- [ ] three');
  }, 120_000);

  it('a review an agent resolved stays in History with its actor and its own time, with nothing else watching', async () => {
    const task = (await runBdJson<{ id: string }>(root, ['create', 'Gated for history', '-t', 'task', '-p', '2', '--actor', 'Creator', '--json'])).id;
    await wait(1100);
    const asked = await provider.gateCreate(task, REVIEW_REASON, ACTOR);
    if (!asked.ok) throw new Error('expected a new gate');
    const askedAt = Date.now();
    await wait(1500);
    const resolve = await runBd(root, ['gate', 'resolve', asked.gate.id, '--reason', 'Reviewed', '--actor', 'Claude Code']);
    expect(resolve.code).toBe(0);
    const resolvedAt = Date.now();
    // Edits after it, and no activity ring to remember any of this: the gate's own records carry it.
    await wait(1100);
    expect((await provider.update(task, (await provider.export()).find((b) => b.id === task)!.updatedAt, { title: 'Gated, renamed' }, ACTOR)).ok).toBe(true);
    await wait(1100);
    expect((await provider.update(task, (await provider.export()).find((b) => b.id === task)!.updatedAt, { notes: 'later' }, ACTOR)).ok).toBe(true);

    const entries = await history(task, [asked.gate.id]);
    expect(entries.map((e) => e.gate?.what ?? e.changes.map((c) => c.field).join('+') ?? '')).toEqual(['notes', 'title', 'resolved', 'requested', '']);
    const resolved = entries.find((e) => e.gate?.what === 'resolved')!;
    expect(resolved).toMatchObject({ actor: 'Claude Code', gate: { gateId: asked.gate.id, gateKind: 'human', reason: REVIEW_REASON, byPanel: false } });
    expect(Date.parse(resolved.at)).toBeGreaterThanOrEqual(resolvedAt - 5000);
    expect(Date.parse(resolved.at)).toBeLessThanOrEqual(resolvedAt + 1000);
    const requested = entries.find((e) => e.gate?.what === 'requested')!;
    expect(requested).toMatchObject({ actor: ACTOR, gate: { byPanel: true } });
    expect(Math.abs(Date.parse(requested.at) - askedAt)).toBeLessThan(5000);
    expect(Date.parse(requested.at)).toBeLessThan(Date.parse(resolved.at));
  }, 120_000);

  it('an id bd does not know has no history', async () => {
    expect(await readHistory((limit) => provider.history('hs-nope', { limit, events: true }), { pageSize: 20, currentLabels: [], activity: [], beadId: 'hs-nope' })).toEqual({ entries: [], more: false, labelsKnown: true });
  });
});
