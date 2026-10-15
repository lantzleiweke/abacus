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

    const swapped = await update(next, { labels: ['two', 'three'], assignee: null, design: '', description: '' });
    expect([...swapped.labels].sort()).toEqual(['three', 'two']);
    expect(swapped).toMatchObject({ assignee: null, design: '', description: '', title: 'Round trip, renamed' });
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
});
