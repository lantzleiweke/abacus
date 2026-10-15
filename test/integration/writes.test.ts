import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BdProvider, WriteError } from '../../src/service/bd/adapter';
import { readAuditEvents, resetAuditSchemaCache } from '../../src/service/bd/audit';
import { childEnv, runBd, runBdJson } from '../../src/service/bd/exec';
import { parseList } from '../../src/service/bd/parse';
import { explainBead, resetExplainCache } from '../../src/service/explain';
import { resetSnapshotState, setStorageDir } from '../../src/service/snapshot';
import type { Bead } from '../../src/shared/types';

const run = promisify(execFile);
const ACTOR = 'Scratch User (panel)';

// Real bd and dolt, in a scratch project under the OS temp dir. Never a real project.
describe.skipIf(process.env.BD_INTEGRATION !== '1')('writes (embedded bd)', () => {
  let tmp: string;
  let root: string;
  let provider: BdProvider;

  async function bd(args: string[]): Promise<void> {
    const result = await runBd(root, args);
    if (result.code !== 0) throw new Error(`bd ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }

  const make = (title: string, extra: Partial<Parameters<BdProvider['create']>[0]> = {}) =>
    provider.create({ title, type: 'task', priority: 2, parentId: null, description: '', ...extra }, ACTOR);

  /** What `bd export` (the panel's source of truth) says about one bead. */
  async function exported(id: string): Promise<Bead> {
    const bead = (await provider.export()).find((b) => b.id === id);
    if (!bead) throw new Error(`${id} is not in the export`);
    return bead;
  }

  /** The reasons on the `closed` events of one bead, from the events table: it keeps the reason even where the bead's own record drops it. */
  async function closeReasons(id: string): Promise<Array<string | null>> {
    const events = await readAuditEvents(root, 'embedded', { limit: 200, beadIds: [id] });
    if (events === null) throw new Error('the audit log could not be read');
    return events.filter((event) => event.type === 'closed').map((event) => event.newValue);
  }

  async function update(bead: Bead, patch: Parameters<BdProvider['update']>[2]): Promise<Bead> {
    const result = await provider.update(bead.id, bead.updatedAt, patch, ACTOR);
    if (!result.ok) throw new Error(`expected the write to go in: ${JSON.stringify(result)}`);
    return result.bead;
  }

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(join(tmpdir(), 'oc-beads-writes-int-')));
    root = join(tmp, 'proj');
    await run('mkdir', [root]);
    await run('git', ['init', '-q'], { cwd: root, env: childEnv() });
    await run('git', ['config', 'user.name', 'Scratch User'], { cwd: root, env: childEnv() });
    await bd(['init', '--prefix', 'wr', '--non-interactive', '--quiet']);
    await bd(['config', 'set', 'status.custom', 'shipped:done']);
    setStorageDir(join(tmp, 'state'));
    provider = new BdProvider(root, 'embedded');
  }, 90_000);

  afterAll(async () => {
    setStorageDir(null);
    resetSnapshotState();
    resetAuditSchemaCache();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('creates top level and under a parent, which brings the parent labels', async () => {
    const parent = await make('Parent', { type: 'epic', priority: 1, description: 'About the parent' });
    expect(parent).toMatchObject({ title: 'Parent', type: 'epic', priority: 1, description: 'About the parent', parentId: null, createdBy: ACTOR });
    const labelled = await update(parent, { labels: ['alpha', 'beta'] });
    expect(labelled.labels.sort()).toEqual(['alpha', 'beta']);

    const child = await make('--looks like a flag', { parentId: parent.id });
    expect(child.title).toBe('--looks like a flag');
    expect(child.parentId).toBe(parent.id);
    expect(child.labels.sort()).toEqual(['alpha', 'beta']);
    expect((await exported(child.id)).parentId).toBe(parent.id);
  }, 120_000);

  it('round-trips every field, and the bead it returns carries the same updatedAt as the export', async () => {
    const start = await make('Round trip');
    const next = await update(start, {
      title: 'Round trip, renamed',
      priority: 0,
      assignee: 'Dana',
      description: 'line one\nline two\n\n- **bold**',
      design: 'a design',
      acceptance: 'accepted when it works',
      notes: '-f is only text here',
      labels: ['one', 'two'],
      status: 'in_progress',
    });
    expect(next).toMatchObject({
      title: 'Round trip, renamed', priority: 0, assignee: 'Dana', description: 'line one\nline two\n\n- **bold**',
      design: 'a design', acceptance: 'accepted when it works', notes: '-f is only text here', status: 'in_progress',
    });
    expect([...next.labels].sort()).toEqual(['one', 'two']);
    const fromExport = await exported(start.id);
    expect(fromExport).toMatchObject({ title: next.title, status: 'in_progress', assignee: 'Dana', notes: next.notes });
    expect(fromExport.updatedAt).toBe(next.updatedAt);

    // bd 1.3 refuses to clear the assignee of a bead someone holds in progress, so the same edit moves it out of In progress
    // (the adapter runs that status move first). bd 1.2.2 accepts both in one call either way.
    const swapped = await update(next, { labels: ['two', 'three'], assignee: null, design: '', description: '', status: 'open' });
    expect([...swapped.labels].sort()).toEqual(['three', 'two']);
    expect(swapped).toMatchObject({ assignee: null, design: '', description: '', status: 'open', title: 'Round trip, renamed' });
    expect(await exported(start.id)).toMatchObject({ assignee: null, design: '', description: '' });
  }, 120_000);

  it('returns a conflict and writes nothing when the bead moved', async () => {
    const start = await make('Conflict');
    const moved = await update(start, { title: 'Someone else was here' });
    const result = await provider.update(start.id, start.updatedAt, { title: 'Mine' }, ACTOR);
    expect(result).toMatchObject({ ok: false, conflict: true, current: { title: 'Someone else was here', updatedAt: moved.updatedAt } });
    expect((await exported(start.id)).title).toBe('Someone else was here');
  }, 60_000);

  it('does not write when nothing differs', async () => {
    const start = await make('Same');
    const result = await provider.update(start.id, start.updatedAt, { title: 'Same', priority: 2, labels: [] }, ACTOR);
    expect(result).toMatchObject({ ok: true, bead: { id: start.id, updatedAt: start.updatedAt } });
    expect((await exported(start.id)).updatedAt).toBe(start.updatedAt);
  }, 60_000);

  it('closes with a reason and reopens', async () => {
    const start = await make('Close me');
    const closed = await update(start, { status: 'closed', closeReason: 'Shipped it' });
    expect(closed).toMatchObject({ status: 'closed', closeReason: 'Shipped it' });
    expect(closed.closedAt).not.toBeNull();
    expect(await closeReasons(start.id)).toEqual(['Shipped it']);
    const reopened = await update(closed, { status: 'open' });
    expect(reopened).toMatchObject({ status: 'open', closedAt: null });
    expect(await exported(start.id)).toMatchObject({ status: 'open', closedAt: null });
  }, 90_000);

  it('moves into and out of a custom done status', async () => {
    const start = await make('Ship me');
    const shipped = await update(start, { status: 'shipped', closeReason: 'Out the door' });
    expect(shipped.status).toBe('shipped');
    expect((await exported(start.id)).status).toBe('shipped');
    // Beads drops the bead's own close reason on the status update, but the close itself, with its reason, is in the log.
    expect(await closeReasons(start.id)).toEqual(['Out the door']);
    const back = await update(shipped, { status: 'in_progress' });
    expect(back).toMatchObject({ status: 'in_progress', closedAt: null });
    // From the built-in closed to a custom done status: one plain update.
    const closed = await update(back, { status: 'closed' });
    const reshipped = await update(closed, { status: 'shipped' });
    expect(reshipped.status).toBe('shipped');
    // From a custom done status to closed: a real close, so the reason is kept on the bead.
    const closedAgain = await update(reshipped, { status: 'closed', closeReason: 'Final answer' });
    expect(closedAgain).toMatchObject({ status: 'closed', closeReason: 'Final answer' });
    expect(await exported(start.id)).toMatchObject({ status: 'closed', closeReason: 'Final answer' });
  }, 120_000);

  it('refuses an unknown status before writing', async () => {
    const start = await make('Status check');
    await expect(provider.update(start.id, start.updatedAt, { status: 'nonsense' }, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    expect((await exported(start.id)).updatedAt).toBe(start.updatedAt);
  }, 60_000);

  it('names the blockers when a close is refused, and never forces it', async () => {
    const blocker = await make('Blocker');
    const blocked = await make('Blocked');
    await provider.dependency('add', blocked.id, blocker.id, 'blocks', ACTOR);
    const error = await provider.update(blocked.id, blocked.updatedAt, { status: 'closed' }, ACTOR).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WriteError);
    expect(error).toMatchObject({ code: 'blocked' });
    expect((error as WriteError).message).toContain(blocker.id);
    expect((error as WriteError).message).not.toMatch(/--force/);
    expect((await exported(blocked.id)).status).toBe('open');
  }, 90_000);

  it('does not move a blocked bead to a custom done status, and writes nothing', async () => {
    const blocker = await make('Blocker 2');
    const blocked = await make('Blocked 2');
    await provider.dependency('add', blocked.id, blocker.id, 'blocks', ACTOR);
    const error = await provider.update(blocked.id, blocked.updatedAt, { status: 'shipped', title: 'Never applied' }, ACTOR).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'WriteError', code: 'blocked' });
    expect((error as WriteError).message).toContain(blocker.id);
    expect(await exported(blocked.id)).toMatchObject({ status: 'open', title: 'Blocked 2' });
    expect(await closeReasons(blocked.id)).toEqual([]);
  }, 90_000);

  it('returns the comments of the bead it re-reads', async () => {
    const bead = await make('Has comments');
    await provider.comment(bead.id, 'first', ACTOR);
    await provider.comment(bead.id, 'second', ACTOR);
    const next = await update(await exported(bead.id), { title: 'Has comments, renamed' });
    expect(next.comments.map((c) => c.text)).toEqual(['first', 'second']);
    const conflict = await provider.update(bead.id, bead.updatedAt, { title: 'Late' }, ACTOR);
    expect(conflict).toMatchObject({ ok: false, conflict: true, current: { comments: [{ text: 'first' }, { text: 'second' }] } });
  }, 90_000);

  it('adds a comment as the panel and says so in the author', async () => {
    const bead = await make('Talk');
    const comment = await provider.comment(bead.id, '-f is fine\nsecond line', ACTOR);
    expect(comment).toMatchObject({ author: ACTOR, text: '-f is fine\nsecond line' });
    const listed = await runBdJson<unknown[]>(root, ['--readonly', 'comments', bead.id, '--json']);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ author: ACTOR, text: '-f is fine\nsecond line' });
  }, 60_000);

  it('keeps comment text that starts with a dash, a list item or a flag-like word, whole', async () => {
    const bead = await make('Dashes');
    const texts = ['- item', '- one\n- two', '--foo bar', '-'];
    for (const text of texts) expect(await provider.comment(bead.id, text, ACTOR)).toMatchObject({ author: ACTOR, text });
    const listed = await runBdJson<Array<{ text: string }>>(root, ['--readonly', 'comments', bead.id, '--json']);
    expect(listed.map((c) => c.text)).toEqual(texts);
  }, 60_000);

  it('adds and removes dependencies, and records the actor as their creator', async () => {
    const a = await make('Dep from');
    const b = await make('Dep to');
    await provider.dependency('add', a.id, b.id, 'discovered-from', ACTOR);
    const withDep = await exported(a.id);
    expect(withDep.dependencies).toEqual([expect.objectContaining({ from: a.id, to: b.id, kind: 'discovered-from', createdBy: ACTOR })]);

    const clash = await provider.dependency('add', a.id, b.id, 'related', ACTOR).catch((e: unknown) => e);
    expect(clash).toMatchObject({ code: 'dep-exists' });
    expect((clash as WriteError).message).toContain('discovered-from');

    await provider.dependency('remove', a.id, b.id, 'discovered-from', ACTOR);
    expect((await exported(a.id)).dependencies).toEqual([]);
  }, 90_000);

  it('says plainly when the bead is gone', async () => {
    await expect(provider.update('wr-nope', '2026-01-01T00:00:00Z', { title: 'x' }, ACTOR)).rejects.toMatchObject({ code: 'not-found' });
    await expect(provider.comment('wr-nope', 'hi', ACTOR)).rejects.toMatchObject({ code: 'not-found' });
  }, 60_000);

  it('lists a bead by id the way the re-read does', async () => {
    const bead = await make('Listed');
    const rows = await runBdJson<unknown>(root, ['--readonly', 'list', '--all', '--id', bead.id, '--json']);
    expect(parseList(rows).map((b) => b.id)).toEqual([bead.id]);
  }, 60_000);

  describe('help requests (bd human)', () => {
    const humanIds = async (): Promise<string[]> => ((await runBdJson<Array<{ id: string }> | null>(root, ['--readonly', 'human', 'list', '--json'])) ?? []).map((row) => row.id);
    const ask = async (title: string): Promise<Bead> => update(await make(title), { labels: ['human'] });

    it('respond keeps the answer as the panel and closes; the request leaves bd human list', async () => {
      const request = await ask('Which TTL?');
      expect(await humanIds()).toContain(request.id);
      const text = '- 60s\n--force is only text here';
      const result = await provider.humanRespond(request.id, text, ACTOR);
      expect(result).toMatchObject({ ok: true, bead: { id: request.id, status: 'closed', closeReason: 'Responded', comments: [{ author: ACTOR, text: `Response: ${text}` }] } });
      expect(await exported(request.id)).toMatchObject({ status: 'closed', closeReason: 'Responded' });
      expect(await humanIds()).not.toContain(request.id);
    }, 120_000);

    it('dismiss closes with and without a reason, and makes no comment', async () => {
      const first = await ask('Dismiss me');
      expect(await provider.humanDismiss(first.id, 'Not needed', ACTOR)).toMatchObject({ ok: true, bead: { status: 'closed', closeReason: 'Dismissed: Not needed', comments: [] } });
      const second = await ask('Dismiss me too');
      expect(await provider.humanDismiss(second.id, undefined, ACTOR)).toMatchObject({ ok: true, bead: { status: 'closed', closeReason: 'Dismissed' } });
      expect(await humanIds()).not.toEqual(expect.arrayContaining([first.id]));
    }, 120_000);

    it('a closed human bead and a bead without the label are not open: nothing is written', async () => {
      const done = await ask('Already answered');
      await provider.humanRespond(done.id, 'First answer', ACTOR);
      const closed = await exported(done.id);
      const again = await provider.humanRespond(done.id, 'Second answer', ACTOR);
      expect(again).toMatchObject({ ok: false, code: 'not-open', current: { id: done.id, status: 'closed', comments: [{ text: 'Response: First answer' }] } });
      expect(await provider.humanDismiss(done.id, 'Late', ACTOR)).toMatchObject({ ok: false, code: 'not-open' });
      expect(await exported(done.id)).toMatchObject({ updatedAt: closed.updatedAt, closeReason: 'Responded' });
      expect(await humanIds()).not.toContain(done.id);

      // Beads would close this one too; the panel does not.
      const plain = await make('Not a request');
      expect(await provider.humanRespond(plain.id, 'Hello', ACTOR)).toMatchObject({ ok: false, code: 'not-open', current: { id: plain.id, status: 'open' } });
      expect(await exported(plain.id)).toMatchObject({ status: 'open', updatedAt: plain.updatedAt });
    }, 120_000);

    it('a request that waits on an open review or an open task is refused with blocked, writes nothing, and answers once it is free', async () => {
      const request = await ask('Gated question');
      const asked = await provider.gateCreate(request.id, 'Check it', ACTOR);
      if (!asked.ok) throw new Error('expected a new gate');
      const before = await exported(request.id);
      for (const run of [() => provider.humanRespond(request.id, 'Answer', ACTOR), () => provider.humanDismiss(request.id, 'No', ACTOR)]) {
        const error = await run().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(WriteError);
        expect(error).toMatchObject({ code: 'blocked' });
        expect((error as WriteError).message).toContain(asked.gate.id);
        expect((error as WriteError).message).not.toMatch(/--force/);
      }
      expect(await exported(request.id)).toMatchObject({ status: 'open', updatedAt: before.updatedAt, comments: [] });
      expect(await humanIds()).toContain(request.id);

      await provider.gateResolve(asked.gate.id, 'Reviewed', ACTOR);
      const task = await make('Unfinished task');
      await provider.dependency('add', request.id, task.id, 'blocks', ACTOR);
      const stillBlocked = await provider.humanRespond(request.id, 'Answer', ACTOR).catch((e: unknown) => e);
      expect(stillBlocked).toMatchObject({ code: 'blocked' });
      expect((stillBlocked as WriteError).message).toContain(task.id);
      expect((stillBlocked as WriteError).message).not.toContain(asked.gate.id);
      expect(await exported(request.id)).toMatchObject({ status: 'open' });

      await update(await exported(task.id), { status: 'closed' });
      expect(await provider.humanRespond(request.id, 'Answer', ACTOR)).toMatchObject({ ok: true, bead: { status: 'closed', closeReason: 'Responded' } });
    }, 180_000);

    it('matches what bd close refuses: open and custom-done children, live targets, waits-for with an open child', async () => {
      const refusedBy = async (run: () => Promise<unknown>, id: string): Promise<void> => {
        const error = await run().catch((e: unknown) => e);
        expect(error).toMatchObject({ code: 'blocked' });
        expect((error as WriteError).message).toContain(id);
      };
      const finish = async (id: string, status: string): Promise<void> => void (await update(await exported(id), { status }));

      // A child blocks until it is literally closed: a custom done status does not release it.
      const request = await ask('Has a sub-task');
      const child = await make('Sub-task', { parentId: request.id });
      const before = await exported(request.id);
      await refusedBy(() => provider.humanRespond(request.id, 'Answer', ACTOR), child.id);
      expect(await exported(request.id)).toMatchObject({ status: 'open', updatedAt: before.updatedAt, comments: [] });
      await finish(child.id, 'shipped');
      await refusedBy(() => provider.humanRespond(request.id, 'Answer', ACTOR), child.id);
      await finish(child.id, 'closed');
      expect(await provider.humanRespond(request.id, 'Answer', ACTOR)).toMatchObject({ ok: true, bead: { status: 'closed', closeReason: 'Responded' } });

      // A blocks or conditional-blocks target blocks unless it is closed or pinned: a custom done status still blocks.
      for (const kind of ['blocks', 'conditional-blocks']) {
        const held = await ask(`Held by a ${kind} link`);
        const target = await make('The target');
        await provider.dependency('add', held.id, target.id, kind, ACTOR);
        await refusedBy(() => provider.humanDismiss(held.id, 'No', ACTOR), target.id);
        await finish(target.id, 'shipped');
        await refusedBy(() => provider.humanDismiss(held.id, 'No', ACTOR), target.id);
        await finish(target.id, 'pinned');
        expect(await provider.humanDismiss(held.id, 'No', ACTOR)).toMatchObject({ ok: true, bead: { status: 'closed', closeReason: 'Dismissed: No' } });
      }

      // waits-for: no children means nothing to wait for; an open child holds it, and the target is named.
      const idle = await ask('Waits for nothing');
      await provider.dependency('add', idle.id, (await make('Target without children')).id, 'waits-for', ACTOR);
      expect(await provider.humanDismiss(idle.id, 'No', ACTOR)).toMatchObject({ ok: true });

      const waiting = await ask('Waits for a group');
      const group = await make('Group');
      const member = await make('Group member', { parentId: group.id });
      await provider.dependency('add', waiting.id, group.id, 'waits-for', ACTOR);
      await refusedBy(() => provider.humanDismiss(waiting.id, 'No', ACTOR), group.id);
      await finish(member.id, 'closed');
      expect(await provider.humanDismiss(waiting.id, 'No', ACTOR)).toMatchObject({ ok: true });
    }, 360_000);

    it('matches bd close on a waits-for link when bd has blocked the request another way (blocked parent, pinned target with an open child)', async () => {
      const refusedBy = async (request: Bead, id: string): Promise<WriteError> => {
        const before = await exported(request.id);
        const error = await provider.humanRespond(request.id, 'Answer', ACTOR).catch((e: unknown) => e);
        expect(error).toMatchObject({ code: 'blocked' });
        expect((error as WriteError).message).toContain(id);
        expect(await exported(request.id)).toMatchObject({ status: 'open', updatedAt: before.updatedAt });
        return error as WriteError;
      };
      const asRequest = async (title: string, parentId: string | null = null): Promise<Bead> => update(await make(title, { parentId }), { labels: ['human'] });

      // A: the request is a child of a blocked parent and waits for a live target with no children.
      const parent = await make('Blocked parent', { type: 'epic' });
      const holdup = await make('Holds the parent up');
      await provider.dependency('add', parent.id, holdup.id, 'blocks', ACTOR);
      const child = await asRequest('Child request', parent.id);
      const idleTarget = await make('Live target without children');
      await provider.dependency('add', child.id, idleTarget.id, 'waits-for', ACTOR);
      await refusedBy(child, idleTarget.id);
      // Blocked through the parent, but nothing live to name: bd lets a plain child close.
      const plainChild = await asRequest('Plain child request', parent.id);
      expect(await provider.humanRespond(plainChild.id, 'Answer', ACTOR)).toMatchObject({ ok: true });
      // Free the parent and the same link closes.
      await update(await exported(holdup.id), { status: 'closed' });
      expect(await provider.humanRespond(child.id, 'Answer', ACTOR)).toMatchObject({ ok: true });

      // B: a pinned target that holds an open child blocks the request, and a live target with no children is then named.
      const pinned = await make('Pinned group');
      await make('Open member', { parentId: pinned.id });
      await update(await exported(pinned.id), { status: 'pinned' });
      const live = await make('Live target');
      const alone = await asRequest('Waits for the pinned group only');
      await provider.dependency('add', alone.id, pinned.id, 'waits-for', ACTOR);
      expect(await provider.humanRespond(alone.id, 'Answer', ACTOR)).toMatchObject({ ok: true });
      const both = await asRequest('Waits for the pinned group and a live target');
      await provider.dependency('add', both.id, pinned.id, 'waits-for', ACTOR);
      await provider.dependency('add', both.id, live.id, 'waits-for', ACTOR);
      expect((await refusedBy(both, live.id)).message).not.toContain(pinned.id);
    }, 480_000);

    it('a request in a custom done status is not open', async () => {
      const request = await ask('Shipped already');
      const shipped = await update(request, { status: 'shipped' });
      expect(await provider.humanRespond(request.id, 'Late', ACTOR)).toMatchObject({ ok: false, code: 'not-open', current: { status: 'shipped' } });
      expect(await exported(request.id)).toMatchObject({ status: 'shipped', updatedAt: shipped.updatedAt });
    }, 120_000);

    it('says plainly when the bead is gone', async () => {
      await expect(provider.humanRespond('wr-nope', 'x', ACTOR)).rejects.toMatchObject({ code: 'not-found' });
    }, 60_000);
  });

  describe('editing gaps (bd 1.3)', () => {
    const parentOf = async (id: string) => (await exported(id)).parentId;

    it('moves a bead under an epic and back out, and the shown parent does not conflict', async () => {
      const epic = await make('Move target', { type: 'epic' });
      const start = await make('Mover');
      const moved = await update(start, { parent: epic.id });
      expect(moved.parentId).toBe(epic.id);
      expect(await parentOf(start.id)).toBe(epic.id);
      // The panel sends the parent it showed; it matches what the export holds, so no conflict.
      const again = await provider.update(start.id, start.updatedAt, { parent: null }, ACTOR, { parentId: epic.id });
      expect(again).toMatchObject({ ok: true });
      expect(await parentOf(start.id)).toBeNull();
      const stale = await provider.update(start.id, (await exported(start.id)).updatedAt, { title: 'x' }, ACTOR, { parentId: epic.id });
      expect(stale).toMatchObject({ ok: false, conflict: true });
    }, 120_000);

    it('refuses a move into itself or its own child, and writes nothing', async () => {
      const top = await make('Top', { type: 'epic' });
      const child = await make('Child', { type: 'epic', parentId: top.id });
      await expect(provider.update(top.id, top.updatedAt, { parent: top.id }, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
      await expect(provider.update(top.id, top.updatedAt, { parent: child.id }, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
      expect(await parentOf(top.id)).toBeNull();
    }, 90_000);

    it('sets, keeps and clears a due date; the shown date does not conflict', async () => {
      const start = await make('Dated');
      const dated = await update(start, { due: '2026-12-01' });
      const stored = dated.extra.due_at;
      expect(typeof stored).toBe('string');
      expect(String(stored)).toContain('2026-12-01');
      const exportedDue = (await exported(start.id)).extra.due_at;
      expect(exportedDue).toBe(stored);
      const cleared = await provider.update(start.id, dated.updatedAt, { due: null }, ACTOR, { due: String(stored) });
      expect(cleared).toMatchObject({ ok: true });
      expect((await exported(start.id)).extra.due_at ?? null).toBeNull();
      // Clearing a date that is not there writes nothing.
      const now = await exported(start.id);
      expect(await provider.update(start.id, now.updatedAt, { due: null }, ACTOR)).toMatchObject({ ok: true });
      expect((await exported(start.id)).updatedAt).toBe(now.updatedAt);
    }, 120_000);

    it('says plainly when the date is not one Beads understands', async () => {
      const start = await make('Bad date');
      await expect(provider.update(start.id, start.updatedAt, { due: 'blorp-blorp' }, ACTOR)).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('blorp-blorp') });
      expect((await exported(start.id)).updatedAt).toBe(start.updatedAt);
    }, 60_000);

    it('says plainly when the type is not one of the project', async () => {
      const start = await make('Bad type');
      await expect(provider.update(start.id, start.updatedAt, { type: 'nonsense' }, ACTOR)).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('nonsense') });
      const retyped = await update(start, { type: 'bug' });
      expect(retyped.type).toBe('bug');
    }, 90_000);

    it('defers until a date, undefers, and defers with no date', async () => {
      const start = await make('Defer me');
      const deferred = await provider.deferBead(start.id, start.updatedAt, '2026-12-01', 'waiting', ACTOR);
      if (!deferred.ok) throw new Error(JSON.stringify(deferred));
      expect(deferred.bead.status).toBe('deferred');
      expect(String((await exported(start.id)).extra.defer_until)).toContain('2026-12-01');
      const undeferred = await provider.undeferBead(start.id, deferred.bead.updatedAt, ACTOR);
      if (!undeferred.ok) throw new Error(JSON.stringify(undeferred));
      expect(undeferred.bead.status).toBe('open');
      // A second undefer is a no-op, not an error.
      expect(await provider.undeferBead(start.id, undeferred.bead.updatedAt, ACTOR)).toMatchObject({ ok: true });
      const indefinite = await provider.deferBead(start.id, undeferred.bead.updatedAt, null, undefined, ACTOR);
      if (!indefinite.ok) throw new Error(JSON.stringify(indefinite));
      expect(indefinite.bead.status).toBe('deferred');
      expect((await exported(start.id)).extra.defer_until ?? null).toBeNull();
    }, 240_000);

    it('defers indefinitely a bead that is already deferred until a date, and the date goes (the clear-first step)', async () => {
      const start = await make('Date then no date');
      const dated = await provider.deferBead(start.id, start.updatedAt, '2026-12-02', undefined, ACTOR);
      if (!dated.ok) throw new Error(JSON.stringify(dated));
      expect(String((await exported(start.id)).extra.defer_until)).toContain('2026-12-02');
      // No undefer in between: a plain `bd defer` would keep the old date, so only the clear-first step can drop it.
      const indefinite = await provider.deferBead(start.id, dated.bead.updatedAt, null, undefined, ACTOR);
      if (!indefinite.ok) throw new Error(JSON.stringify(indefinite));
      expect(indefinite.bead.status).toBe('deferred');
      const after = await exported(start.id);
      expect(after.status).toBe('deferred');
      expect(after.extra.defer_until ?? null).toBeNull();
    }, 180_000);

    it('undefer clears a date left on a bead that is no longer deferred, and keeps its status', async () => {
      const start = await make('Open with a date');
      const dated = await provider.deferBead(start.id, start.updatedAt, '2026-12-03', undefined, ACTOR);
      if (!dated.ok) throw new Error(JSON.stringify(dated));
      // Moved back to open without an undefer: the date stays behind.
      const reopened = await update(dated.bead, { status: 'open' });
      const before = await exported(start.id);
      expect(before.status).toBe('open');
      expect(String(before.extra.defer_until)).toContain('2026-12-03');
      const undeferred = await provider.undeferBead(start.id, reopened.updatedAt, ACTOR);
      if (!undeferred.ok) throw new Error(JSON.stringify(undeferred));
      const after = await exported(start.id);
      expect(after.status).toBe('open');
      expect(after.extra.defer_until ?? null).toBeNull();
    }, 180_000);

    it('says plainly when the defer date is not understood', async () => {
      const start = await make('Bad defer');
      await expect(provider.deferBead(start.id, start.updatedAt, 'blorp-blorp', undefined, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
      expect((await exported(start.id)).status).toBe('open');
    }, 60_000);

    it('closes as superseded or as a duplicate, and keeps the link', async () => {
      const old = await make('Old way');
      const replacement = await make('New way');
      const superseded = await provider.supersede(old.id, replacement.id, old.updatedAt, ACTOR);
      if (!superseded.ok) throw new Error(JSON.stringify(superseded));
      expect(superseded.bead.status).toBe('closed');
      expect((await exported(old.id)).dependencies.some((d) => d.to === replacement.id && d.kind === 'supersedes')).toBe(true);
      const copy = await make('Same thing');
      const dup = await provider.duplicate(copy.id, replacement.id, copy.updatedAt, ACTOR);
      if (!dup.ok) throw new Error(JSON.stringify(dup));
      expect(dup.bead.status).toBe('closed');
      expect((await exported(copy.id)).dependencies.some((d) => d.to === replacement.id && d.kind === 'duplicates')).toBe(true);
      // A closed bead is not closed again.
      await expect(provider.supersede(old.id, replacement.id, superseded.bead.updatedAt, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    }, 180_000);

    it('adds the comment, then closes; a refused close says the comment went in', async () => {
      const start = await make('Close with words');
      const closed = await update(start, { status: 'closed', closeReason: 'Done', closeComment: 'Final note' });
      expect(closed.status).toBe('closed');
      expect((await exported(start.id)).comments.map((c) => c.text)).toContain('Final note');
      const blocker = await make('Still open');
      const blocked = await make('Blocked one');
      await provider.dependency('add', blocked.id, blocker.id, 'blocks', ACTOR);
      const refused = await provider.update(blocked.id, blocked.updatedAt, { status: 'closed', closeComment: 'Trying' }, ACTOR).catch((error: unknown) => error);
      expect(refused).toMatchObject({ saved: true });
      expect((await exported(blocked.id)).comments.map((c) => c.text)).toContain('Trying');
      expect((await exported(blocked.id)).status).not.toBe('closed');
    }, 240_000);

    it('reads what keeps a bead from being ready', async () => {
      const blocker = await make('Blocks the next');
      const waiting = await make('Waits');
      await provider.dependency('add', waiting.id, blocker.id, 'blocks', ACTOR);
      resetExplainCache();
      // `--limit 0` is "no limit" on real bd, so both beads are in the answer.
      expect(await explainBead(provider, root, waiting.id)).toMatchObject({ state: 'blocked', blockers: [{ id: blocker.id, title: 'Blocks the next', status: 'open' }] });
      expect(await explainBead(provider, root, blocker.id)).toEqual({ state: 'ready', blockers: [] });
    }, 90_000);

    it('words a close that a review blocks as a review, on real bd', async () => {
      const target = await make('Needs a look');
      const gate = await provider.gateCreate(target.id, 'Look at it', ACTOR);
      if (!gate.ok) throw new Error(JSON.stringify(gate));
      const refused = await provider.update(target.id, (await exported(target.id)).updatedAt, { status: 'closed', closeComment: 'Done' }, ACTOR).catch((error: unknown) => error);
      expect(refused).toMatchObject({ code: 'blocked', saved: true, message: 'Your comment was added, but the bead could not be closed. This bead is waiting on a review. Resolve it first.' });
      expect((refused as WriteError).message).not.toContain(gate.gate.id);
    }, 120_000);
  });
});
