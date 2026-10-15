// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { HostRequestError } from '@openchamber/sdk';
import { createClient } from '../../../src/panel/client';
import { createStore, StoreContext, type FullSnapshot } from '../../../src/panel/store';
import { BEADS_READS } from '../../../src/panel/ui/DateInput';
import { assigneeOptions, defaultParent, labelProblem, LINK_KINDS, linkRequest, linkTargets, writesPaused } from '../../../src/panel/edit';
import { App } from '../../../src/panel/ui/App';
import { relatedFor } from '../../../src/shared/related';
import type { Bead, StatusDef, WriteResult } from '../../../src/shared/types';
import { deferred, envelope, fakeHost, flush, freshness, json, snapshot, type Answer, type Call } from './helpers';

const NOW = new Date('2026-10-14T12:00:00Z').getTime();
const MIN = 60_000;
const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function bead(id: string, over: Partial<Bead> = {}): Bead {
  return {
    id,
    title: `Title ${id}`,
    status: 'open',
    priority: 2,
    type: 'task',
    assignee: null,
    labels: [],
    parentId: null,
    description: '',
    design: '',
    acceptance: '',
    notes: '',
    createdAt: iso(10 * DAY),
    createdBy: null,
    updatedAt: iso(DAY),
    closedAt: null,
    closeReason: null,
    dependencies: [],
    comments: [],
    extra: {},
    ...over,
  };
}

const STATUSES: StatusDef[] = [
  { name: 'open', category: 'active', icon: null },
  { name: 'in_progress', category: 'wip', icon: null },
  { name: 'blocked', category: 'wip', icon: null },
  { name: 'deferred', category: 'frozen', icon: null },
  { name: 'closed', category: 'done', icon: null },
  { name: 'in_review', category: 'wip', icon: null },
  { name: 'shipped', category: 'done', icon: null },
];

const TYPES = ['task', 'bug', 'feature', 'epic', 'chore'];

// ------------------------------------------------------------------------------------------------- logic

describe('label rules', () => {
  it('refuses what Beads would split or mangle, blanks, and repeats', () => {
    expect(labelProblem('ios', [])).toBeNull();
    expect(labelProblem('a,b', [])).toMatch(/comma/);
    expect(labelProblem('say "hi"', [])).toMatch(/double quote/);
    expect(labelProblem('two\nlines', [])).toMatch(/line break/);
    expect(labelProblem('   ', [])).toMatch(/empty/);
    expect(labelProblem('ios', ['ios'])).toMatch(/already/);
  });
});

describe('when writes pause', () => {
  it('says why for a half-merged project and while a sync runs, and nothing otherwise', () => {
    expect(writesPaused(null)).toBeNull();
    expect(writesPaused(snapshot())).toBeNull();
    expect(writesPaused(snapshot({ freshness: freshness({ schemaUpdate: { from: 32, to: 66 } }) }))).toBe('Editing is paused until the project is updated.');
    expect(writesPaused(snapshot({ writesBlocked: true }))).toBe('Editing is paused until the sync problem is resolved.');
    expect(writesPaused(snapshot({ sync: { kind: 'running', op: 'pull', startedAt: iso(0) } }))).toMatch(/Sync runs/);
    expect(writesPaused(snapshot({ sync: { kind: 'running', op: 'publish', startedAt: iso(0) } }))).toMatch(/Publish runs/);
  });
});

describe('link picker', () => {
  const beads = [bead('p-a', { title: 'Main' }), bead('p-b', { title: 'Fix login' }), bead('p-c', { title: 'Login copy', status: 'closed' }), bead('p-log', { title: 'Other' })];

  it('finds beads by id or title, never the bead itself, ids first and open beads before done ones', () => {
    expect(linkTargets('login', beads, 'p-a', STATUSES).map((b) => b.id)).toEqual(['p-b', 'p-c']);
    expect(linkTargets('log', beads, 'p-a', STATUSES).map((b) => b.id)).toEqual(['p-log', 'p-b', 'p-c']);
    expect(linkTargets('p-a', beads, 'p-a', STATUSES)).toEqual([]);
    expect(linkTargets('  ', beads, 'p-a', STATUSES)).toEqual([]);
  });

  it('records "blocks" the other way round, so the other bead waits on this one', () => {
    expect(linkRequest('blocked-by', 'p-a', 'p-b')).toEqual({ from: 'p-a', to: 'p-b', kind: 'blocks' });
    expect(linkRequest('blocks', 'p-a', 'p-b')).toEqual({ from: 'p-b', to: 'p-a', kind: 'blocks' });
    expect(linkRequest('related', 'p-a', 'p-b')).toEqual({ from: 'p-a', to: 'p-b', kind: 'related' });
    expect(LINK_KINDS[0]?.label).toBe('Blocked by');
  });
});

describe('assignee suggestions', () => {
  it('offers you first, then everyone already assigned, once each', () => {
    const beads = [bead('p-a', { assignee: 'Bob' }), bead('p-b', { assignee: 'alice' }), bead('p-c', { assignee: 'Bob' }), bead('p-d'), bead('p-e', { assignee: 'Ann' })];
    expect(assigneeOptions(beads, 'Ann (panel)')).toEqual(['Ann', 'alice', 'Bob']);
    expect(assigneeOptions(beads, '')).toEqual(['alice', 'Ann', 'Bob']);
  });
});

describe('new bead parent', () => {
  it('defaults to the epic in view: the epic itself, or the one above the bead shown', () => {
    const beads = [bead('p-e', { type: 'epic' }), bead('p-e.1', { parentId: 'p-e' }), bead('p-e.1.1', { parentId: 'p-e.1' }), bead('p-x')];
    expect(defaultParent(beads, 'p-e')).toBe('p-e');
    expect(defaultParent(beads, 'p-e.1.1')).toBe('p-e');
    expect(defaultParent(beads, 'p-x')).toBeNull();
    expect(defaultParent(beads, null)).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------- rendered

type Route = Call['route'];

/**
 * A project the fake service answers for. Writes answer from `handlers`. Like the service, which reads the project again
 * after a panel write, what a write answered is in `db` for the next read (`persist: false` keeps `db` as the test set it).
 */
function world(initial: Bead[], snapOver: () => Partial<FullSnapshot> = () => ({})) {
  const db = { beads: initial, cursor: 1, persist: true };
  const handlers: Partial<Record<Route, (call: Call) => Answer | Promise<Answer>>> = {};
  const upsert = (b: Bead) => {
    db.beads = db.beads.some((x) => x.id === b.id) ? db.beads.map((x) => (x.id === b.id ? b : x)) : [...db.beads, b];
    db.cursor++;
  };
  /** Puts what a write answered into `db`, as Beads now holds it. */
  const keep = (call: Call, a: Answer): Answer => {
    if (!db.persist || a.status !== 200) return a;
    const body = JSON.parse(a.body) as Record<string, unknown>;
    if (call.route === 'update' || call.route === 'deferBead' || call.route === 'undeferBead') {
      const r = body as WriteResult;
      if (r.ok) upsert(r.bead);
      else if ('conflict' in r) upsert(r.current);
      else if (r.current) upsert(r.current);
    } else if (call.route === 'create') upsert(body.bead as Bead);
    else if (call.route === 'comment') {
      const b = db.beads.find((x) => x.id === call.body.id);
      if (b) upsert({ ...b, comments: [...b.comments, body.comment as Bead['comments'][number]] });
    } else if (call.route === 'dependency') {
      const { op, from, to, kind } = call.body as { op: string; from: string; to: string; kind?: string };
      const b = db.beads.find((x) => x.id === from);
      if (b) {
        const others = b.dependencies.filter((d) => d.to !== to);
        upsert({ ...b, dependencies: op === 'add' ? [...others, { from, to, kind: kind!, createdBy: 'Ann (panel)', createdAt: null }] : others });
      }
    }
    return a;
  };
  const answer = (call: Call): Answer | Promise<Answer> => {
    const custom = handlers[call.route];
    if (custom) {
      const a = custom(call);
      return a instanceof Promise ? a.then((x) => keep(call, x)) : keep(call, a);
    }
    if (call.route === 'snapshot') {
      return json(
        snapshot({
          statuses: STATUSES,
          types: TYPES,
          readyIds: db.beads.map((b) => b.id),
          // The service read the project just now, on every answer.
          freshness: freshness({ localRefreshedAt: new Date().toISOString() }),
          panelActor: 'Ann (panel)',
          beads: db.beads,
          cursor: `c${db.cursor}`,
          ...snapOver(),
        }),
      );
    }
    if (call.route === 'seen') return json({ unseenIds: [] });
    if (call.route === 'bead') {
      const b = db.beads.find((x) => x.id === call.body.id);
      return b ? json({ bead: b, related: relatedFor(b, db.beads) }) : envelope(404, { code: 'not-found', message: "That bead doesn't exist." });
    }
    return envelope(404, { code: 'NOT_FOUND', message: 'Not here.' });
  };
  return { db, handlers, answer };
}

function setup(answer: (call: Call) => Answer | Promise<Answer>) {
  const fake = fakeHost(answer);
  const toast = vi.fn(async () => {});
  Object.assign(fake.host, { openUrl: vi.fn(async () => {}), toast });
  const store = createStore({ client: createClient(fake.host), host: fake.host, visibility: { isVisible: () => true, onChange: () => () => {} } });
  render(
    <StoreContext.Provider value={store}>
      <App />
    </StoreContext.Provider>,
  );
  return { ...fake, store, toast };
}

const run = async (fn: () => unknown) => {
  await act(async () => {
    fn();
    await flush();
  });
};

/** Opens the project and, when `id` is given, that bead's detail. */
async function opened(beads: Bead[], id: string | null, snapOver?: () => Partial<FullSnapshot>) {
  const w = world(beads, snapOver);
  const ctx = setup(w.answer);
  await run(() => ctx.store.setDirectory('/p/a'));
  if (id) await run(() => ctx.store.select(id));
  const routed = (route: Route) => ctx.calls.filter((c) => c.route === route);
  return { ...ctx, w, routed };
}

const click = (el: Element) => run(() => fireEvent.click(el));
const type = (el: Element, value: string) => run(() => fireEvent.input(el, { target: { value } }));
const key = (el: Element, k: string, over: Record<string, unknown> = {}) => run(() => fireEvent.keyDown(el, { key: k, ...over }));
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const textbox = (name: string | RegExp) => screen.getByRole('textbox', { name }) as HTMLTextAreaElement;
const later = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await flush();
  });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('text sections', () => {
  it('only edits after Edit, and saves with the time the bead was shown at', async () => {
    const t = await opened([bead('p-a', { description: 'Old words' })], 'p-a');
    t.w.handlers.update = (call) => json({ ok: true, bead: bead('p-a', { description: (call.body.patch as { description: string }).description, updatedAt: iso(0) }) } satisfies WriteResult);
    // Reading never opens an editor, even when the text is clicked.
    await click(screen.getByText('Old words'));
    expect(document.querySelector('[data-section="description"] textarea')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull();
    await click(button('Edit description'));
    const box = textbox('Description');
    expect(box.value).toBe('Old words');
    await type(box, 'New words');
    const polls = t.routed('snapshot').length;
    await click(button('Save'));
    expect(t.routed('update')[0]?.body).toEqual({ directory: '/p/a', id: 'p-a', expectedUpdatedAt: iso(DAY), patch: { description: 'New words' }, expected: { description: 'Old words' } });
    // The answer shows at once, and the list is asked again.
    expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull();
    expect(document.querySelector('[data-section="description"] .bd-md')?.textContent).toContain('New words');
    expect(t.routed('snapshot').length).toBeGreaterThan(polls);
    // A poll that has not caught up yet does not put the old text back.
    await later(2_000);
    expect(document.querySelector('[data-section="description"] .bd-md')?.textContent).toContain('New words');
  });

  it('takes the next poll as the truth after a save: the service reads the project again for it', async () => {
    const t = await opened([bead('p-a', { priority: 2 })], 'p-a');
    // The answer says P0, but the service's fresh read says the bead is as it was (the write did not stick). The read
    // the service made for this poll is newer than the answer, so it wins, even though it looks like the old copy.
    t.w.db.persist = false;
    t.w.handlers.update = () => json({ ok: true, bead: bead('p-a', { priority: 0, updatedAt: iso(0) }) } satisfies WriteResult);
    await click(button('Priority: P2'));
    await click(screen.getByRole('menuitemradio', { name: /P0/ }));
    t.w.db.cursor = 3;
    await later(2_000);
    expect(store(t).snapshot?.beads.find((b) => b.id === 'p-a')?.priority).toBe(2);
  });

  it('keeps what a save answered while the service has not read the project since (a failed export)', async () => {
    let refreshedAt = iso(0);
    const t = await opened([bead('p-a', { priority: 2 })], 'p-a', () => ({ freshness: freshness({ localRefreshedAt: refreshedAt }) }));
    t.w.db.persist = false;
    t.w.handlers.update = () => json({ ok: true, bead: bead('p-a', { priority: 0, updatedAt: iso(0) }) } satisfies WriteResult);
    await click(button('Priority: P2'));
    await click(screen.getByRole('menuitemradio', { name: /P0/ }));
    // The export after the write failed: the service still holds its copy from before, with its old refresh time.
    t.w.db.cursor = 5;
    await later(2_000);
    expect(store(t).snapshot?.beads.find((b) => b.id === 'p-a')?.priority).toBe(0);
    // Once it reads the project again, its copy is the truth.
    refreshedAt = new Date().toISOString();
    t.w.db.cursor = 6;
    await later(2_000);
    expect(store(t).snapshot?.beads.find((b) => b.id === 'p-a')?.priority).toBe(2);
  });

  it('keeps the draft on a conflict, shows the current text, and saves again only on Re-apply', async () => {
    const shown = bead('p-a', { description: 'Old words' });
    const t = await opened([shown], 'p-a');
    const theirs = { ...shown, description: 'Agent words', updatedAt: iso(MIN) };
    t.w.handlers.update = (call) =>
      t.routed('update').length === 1
        ? json({ ok: false, conflict: true, current: theirs } satisfies WriteResult)
        : json({ ok: true, bead: { ...theirs, description: (call.body.patch as { description: string }).description, updatedAt: iso(0) } } satisfies WriteResult);
    await click(button('Edit description'));
    await type(textbox('Description'), 'My words');
    await click(button('Save'));
    expect(screen.getByText('Changed while you were editing')).toBeTruthy();
    expect(screen.getByText('Agent words')).toBeTruthy();
    // Their text and the draft are each named, so it is clear which is which.
    expect(screen.getByText('Now')).toBeTruthy();
    expect(screen.getByText('Your draft')).toBeTruthy();
    expect(textbox('Description').value).toBe('My words');
    await later(10_000);
    expect(t.routed('update')).toHaveLength(1);
    await click(button('Re-apply'));
    expect(t.routed('update')[1]?.body).toMatchObject({ expectedUpdatedAt: iso(MIN), patch: { description: 'My words' }, expected: { description: 'Agent words' } });
    expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull();
    expect(document.querySelector('[data-section="description"] .bd-md')?.textContent).toContain('My words');
  });

  it('Discard after a conflict drops the draft and shows what is there now', async () => {
    const shown = bead('p-a', { description: 'Old words' });
    const t = await opened([shown], 'p-a');
    const theirs = { ...shown, description: 'Agent words', updatedAt: iso(MIN) };
    t.w.handlers.update = () => json({ ok: false, conflict: true, current: theirs } satisfies WriteResult);
    await click(button('Edit description'));
    await type(textbox('Description'), 'My words');
    await click(button('Save'));
    await click(button('Discard'));
    expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull();
    expect(document.querySelector('[data-section="description"] .bd-md')?.textContent).toContain('Agent words');
    expect(t.routed('update')).toHaveLength(1);
  });

  it('warns as soon as someone else changes the section being edited', async () => {
    const t = await opened([bead('p-a', { description: 'Old words' })], 'p-a');
    await click(button('Edit description'));
    await type(textbox('Description'), 'My words');
    t.w.db.beads = [bead('p-a', { description: 'Agent words', updatedAt: iso(MIN) })];
    t.w.db.cursor = 2;
    await later(2_000);
    expect(screen.getByText('Changed while you were editing')).toBeTruthy();
    expect(screen.getByText('Agent words')).toBeTruthy();
    expect(textbox('Description').value).toBe('My words');
  });

  it('an editor nobody typed in follows the agent\'s new text instead of offering to overwrite it', async () => {
    const t = await opened([bead('p-a', { description: 'Old words' })], 'p-a');
    t.w.handlers.update = (call) => json({ ok: true, bead: bead('p-a', { description: (call.body.patch as { description: string }).description, updatedAt: iso(0) }) } satisfies WriteResult);
    await click(button('Edit description'));
    t.w.db.beads = [bead('p-a', { description: 'Agent words', updatedAt: iso(MIN) })];
    t.w.db.cursor = 2;
    await later(2_000);
    expect(screen.queryByText('Changed while you were editing')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Re-apply' })).toBeNull();
    expect(textbox('Description').value).toBe('Agent words');
    // Typing from there and saving builds on their text, with their time.
    await type(textbox('Description'), 'Agent words, and mine');
    await click(button('Save'));
    expect(t.routed('update')[0]?.body).toMatchObject({ expectedUpdatedAt: iso(MIN), patch: { description: 'Agent words, and mine' } });
  });

  it('keeps the draft good to save when only another part of the bead changed meanwhile', async () => {
    const t = await opened([bead('p-a', { description: 'Old words' })], 'p-a');
    t.w.handlers.update = (call) => json({ ok: true, bead: bead('p-a', { title: 'Renamed', description: (call.body.patch as { description: string }).description, updatedAt: iso(0) }) } satisfies WriteResult);
    await click(button('Edit description'));
    await type(textbox('Description'), 'My words');
    t.w.db.beads = [bead('p-a', { title: 'Renamed', description: 'Old words', updatedAt: iso(MIN) })];
    t.w.db.cursor = 2;
    await later(2_000);
    expect(screen.queryByText('Changed while you were editing')).toBeNull();
    await click(button('Save'));
    expect(t.routed('update')[0]?.body).toMatchObject({ expectedUpdatedAt: iso(MIN) });
  });

  it('says the change may have saved and refreshes, never sending it again by itself', async () => {
    const t = await opened([bead('p-a', { notes: 'Old notes' })], 'p-a');
    t.w.handlers.update = () => json({ ok: false, uncertain: true, current: null } satisfies WriteResult);
    await click(button('Edit notes'));
    await type(textbox('Notes'), 'New notes');
    // The re-read is slow, so the note stays while it runs.
    const reread = deferred<Answer>();
    t.w.handlers.bead = () => reread.promise;
    const reads = t.routed('bead').length;
    const polls = t.routed('snapshot').length;
    await click(button('Save'));
    expect(screen.getByText('This may have saved. Refreshing.')).toBeTruthy();
    expect(t.routed('bead').length).toBeGreaterThan(reads);
    expect(t.routed('snapshot').length).toBeGreaterThan(polls);
    await later(10_000);
    expect(t.routed('update')).toHaveLength(1);
    expect(textbox('Notes').value).toBe('New notes');
  });

  it('closes the editor when the re-read after an uncertain save shows the draft is in', async () => {
    const t = await opened([bead('p-a', { notes: 'Old notes' })], 'p-a');
    t.w.handlers.update = () => json({ ok: false, uncertain: true, current: bead('p-a', { notes: 'New notes', updatedAt: iso(0) }) } satisfies WriteResult);
    await click(button('Edit notes'));
    await type(textbox('Notes'), 'New notes');
    await click(button('Save'));
    expect(screen.queryByRole('textbox', { name: 'Notes' })).toBeNull();
    expect(document.querySelector('[data-section="notes"]')?.textContent).toContain('New notes');
  });

  it('shows a refused save in plain words and keeps the draft', async () => {
    const t = await opened([bead('p-a', { description: 'Old words' })], 'p-a');
    t.w.handlers.update = () => envelope(503, { code: 'busy', message: 'Beads is busy. Nothing was saved. Try again in a moment.', detail: 'database is locked' });
    await click(button('Edit description'));
    await type(textbox('Description'), 'My words');
    await click(button('Save'));
    expect(screen.getByText('Beads is busy. Nothing was saved. Try again in a moment.')).toBeTruthy();
    expect(textbox('Description').value).toBe('My words');
    await click(button('Copy details'));
    expect(t.toast).toHaveBeenCalledWith(expect.objectContaining({ copy: { text: 'database is locked' } }));
  });

  it('saves with Cmd+Enter, and Escape asks before throwing away changes', async () => {
    const t = await opened([bead('p-a', { description: 'Old words' })], 'p-a');
    t.w.handlers.update = (call) => json({ ok: true, bead: bead('p-a', { description: (call.body.patch as { description: string }).description, updatedAt: iso(0) }) } satisfies WriteResult);
    await click(button('Edit description'));
    await type(textbox('Description'), 'Half typed');
    await key(textbox('Description'), 'Escape');
    // Still editing, still on this bead.
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
    expect(textbox('Description').value).toBe('Half typed');
    expect(store(t).detail).not.toBeNull();
    await click(button('Keep editing'));
    expect(screen.queryByText('Discard your changes?')).toBeNull();
    await key(textbox('Description'), 'Escape');
    await key(textbox('Description'), 'Escape');
    expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull();
    expect(store(t).detail).not.toBeNull();
    expect(t.routed('update')).toHaveLength(0);
    // Unchanged: Escape just closes.
    await click(button('Edit description'));
    await key(textbox('Description'), 'Escape');
    expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull();
    await click(button('Edit description'));
    await type(textbox('Description'), 'Typed in full');
    await key(textbox('Description'), 'Enter', { metaKey: true });
    expect(t.routed('update')[0]?.body).toMatchObject({ patch: { description: 'Typed in full' } });
  });

  it('offers to add an empty section, and edits the title', async () => {
    const t = await opened([bead('p-a', { title: 'First title' })], 'p-a');
    t.w.handlers.update = (call) => json({ ok: true, bead: bead('p-a', { ...(call.body.patch as Partial<Bead>), updatedAt: iso(0) }) } satisfies WriteResult);
    await click(button('Add acceptance criteria'));
    await type(textbox('Acceptance criteria'), '- Works offline');
    await click(button('Save'));
    expect(t.routed('update')[0]?.body).toMatchObject({ patch: { acceptance: '- Works offline' } });
    expect(document.querySelector('[data-section="acceptance"]')?.textContent).toContain('Works offline');
    await click(button('Edit title'));
    const title = textbox('Title');
    await type(title, '   ');
    expect((button('Save') as HTMLButtonElement).disabled).toBe(true);
    await type(title, 'Second title');
    await key(title, 'Enter');
    expect(t.routed('update')[1]?.body).toMatchObject({ patch: { title: 'Second title' } });
    expect(screen.getByRole('heading', { name: 'Second title' })).toBeTruthy();
  });
});

const store = (t: { store: ReturnType<typeof createStore> }) => t.store.get();

describe('inline fields', () => {
  it('changes the status from a menu of every project status, asking for a reason when it closes the bead', async () => {
    const t = await opened([bead('p-a', { status: 'in_progress' })], 'p-a');
    let n = 0;
    t.w.handlers.update = (call) => {
      n++;
      if (n === 2) return envelope(409, { code: 'blocked', message: "This bead can't be closed yet. It is still blocked by p-b, p-c. Close those first." });
      return json({ ok: true, bead: bead('p-a', { status: (call.body.patch as { status: string }).status, updatedAt: iso(0) }) } satisfies WriteResult);
    };
    await click(button('Status: In progress'));
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['Open', 'In progress', 'Blocked', 'Deferred', 'Closed', 'In review', 'Shipped']);
    expect(screen.getByRole('menuitemradio', { name: 'In review' }).getAttribute('title')).toBe('in_review');
    await click(screen.getByRole('menuitemradio', { name: 'In review' }));
    expect(t.routed('update')[0]?.body).toEqual({ directory: '/p/a', id: 'p-a', expectedUpdatedAt: iso(DAY), patch: { status: 'in_review' }, expected: { status: 'in_progress' } });
    expect(button('Status: In review')).toBeTruthy();
    expect(t.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success', message: 'Status set to In review.' }));

    await click(button('Status: In review'));
    await click(screen.getByRole('menuitemradio', { name: 'Closed' }));
    expect(t.routed('update')).toHaveLength(1);
    await type(textbox('Close reason (optional)'), 'Done in abc123');
    await click(button('Mark closed'));
    expect(t.routed('update')[1]?.body).toEqual({ directory: '/p/a', id: 'p-a', expectedUpdatedAt: iso(0), patch: { status: 'closed', closeReason: 'Done in abc123' }, expected: { status: 'in_review' } });
    expect(screen.getByText("This bead can't be closed yet. It is still blocked by p-b, p-c. Close those first.")).toBeTruthy();
  });

  it('shows a conflict on an inline change with what is there now, and re-applies it on request', async () => {
    const t = await opened([bead('p-a', { priority: 2 })], 'p-a');
    const theirs = bead('p-a', { priority: 1, updatedAt: iso(MIN) });
    t.w.handlers.update = (call) =>
      t.routed('update').length === 1 ? json({ ok: false, conflict: true, current: theirs } satisfies WriteResult) : json({ ok: true, bead: { ...theirs, priority: 0, updatedAt: iso(0) } } satisfies WriteResult);
    await click(button('Priority: P2'));
    await click(screen.getByRole('menuitemradio', { name: /P0/ }));
    expect(t.routed('update')[0]?.body).toMatchObject({ patch: { priority: 0 } });
    const notice = screen.getByText('Changed while you were editing').closest<HTMLElement>('.bd-wnote')!;
    expect(notice.textContent).toContain('P1');
    await click(within(notice).getByRole('button', { name: 'Re-apply' }));
    expect(t.routed('update')[1]?.body).toMatchObject({ expectedUpdatedAt: iso(MIN), patch: { priority: 0 } });
    expect(button('Priority: P0')).toBeTruthy();
  });

  it('Re-apply adds the label to the bead as it is now, keeping a label the agent added meanwhile', async () => {
    const t = await opened([bead('p-a', { labels: ['old'] })], 'p-a');
    const theirs = bead('p-a', { labels: ['old', 'agent'], updatedAt: iso(MIN) });
    t.w.handlers.update = (call) =>
      t.routed('update').length === 1
        ? json({ ok: false, conflict: true, current: theirs } satisfies WriteResult)
        : json({ ok: true, bead: { ...theirs, labels: (call.body.patch as { labels: string[] }).labels, updatedAt: iso(0) } } satisfies WriteResult);
    await click(button('Edit labels'));
    await type(textbox('Add a label'), 'ios');
    await key(textbox('Add a label'), 'Enter');
    expect(t.routed('update')[0]?.body).toMatchObject({ patch: { labels: ['old', 'ios'] } });
    const notice = screen.getByText('Changed while you were editing').closest<HTMLElement>('.bd-wnote')!;
    await click(within(notice).getByRole('button', { name: 'Re-apply' }));
    expect(t.routed('update')[1]?.body).toMatchObject({ expectedUpdatedAt: iso(MIN), patch: { labels: ['old', 'agent', 'ios'] }, expected: { labels: ['old', 'agent'] } });
  });

  it('keeps an inline answer with the bead it was for, not the one open when it lands', async () => {
    const t = await opened([bead('p-a', { title: 'First' }), bead('p-b', { title: 'Second' })], 'p-a');
    const pending = deferred<Answer>();
    t.w.handlers.update = () => pending.promise;
    await click(button('Priority: P2'));
    await click(screen.getByRole('menuitemradio', { name: /P0/ }));
    // Busy holds only the first bead's controls.
    await run(() => t.store.openRelated('p-b'));
    expect(screen.getByRole('heading', { name: 'Second' })).toBeTruthy();
    expect((button('Priority: P2') as HTMLButtonElement).disabled).toBe(false);
    await run(() => pending.resolve(json({ ok: false, conflict: true, current: bead('p-a', { title: 'First', priority: 1, updatedAt: iso(MIN) }) } satisfies WriteResult)));
    expect(screen.queryByText('Changed while you were editing')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Re-apply' })).toBeNull();
  });

  it('assigns from suggestions, and unassigns', async () => {
    const t = await opened([bead('p-a'), bead('p-b', { assignee: 'Bob' })], 'p-a');
    t.w.handlers.update = (call) => json({ ok: true, bead: bead('p-a', { assignee: (call.body.patch as { assignee: string | null }).assignee, updatedAt: iso(t.routed('update').length) }) } satisfies WriteResult);
    await click(button('Assignee: unassigned'));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Ann', 'Bob']);
    await type(textbox('Assignee'), 'bo');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Bob']);
    await click(screen.getByRole('option', { name: 'Bob' }));
    expect(t.routed('update')[0]?.body).toMatchObject({ patch: { assignee: 'Bob' } });
    await click(button('Assignee: Bob'));
    await click(button('Unassign'));
    expect(t.routed('update')[1]?.body).toMatchObject({ patch: { assignee: null } });
    expect(button('Assignee: unassigned')).toBeTruthy();
  });

  it('adds and removes labels, refusing ones Beads would split', async () => {
    const t = await opened([bead('p-a', { labels: ['old'] })], 'p-a');
    t.w.handlers.update = (call) => json({ ok: true, bead: bead('p-a', { labels: (call.body.patch as { labels: string[] }).labels, updatedAt: iso(t.routed('update').length) }) } satisfies WriteResult);
    await click(button('Edit labels'));
    const input = textbox('Add a label');
    await type(input, 'a,b');
    expect(screen.getByText('A label cannot contain a comma or a double quote.')).toBeTruthy();
    await key(input, 'Enter');
    expect(t.routed('update')).toHaveLength(0);
    await type(input, 'ios');
    await key(input, 'Enter');
    expect(t.routed('update')[0]?.body).toMatchObject({ patch: { labels: ['old', 'ios'] } });
    await click(button('Remove label old'));
    expect(t.routed('update')[1]?.body).toMatchObject({ patch: { labels: ['ios'] } });
  });
});

describe('links', () => {
  it('shows relationships, with Add link, on a bead whose every text section is filled', async () => {
    const full = { description: 'D', acceptance: '- A', design: 'G', notes: 'N' };
    await opened([bead('p-a', { ...full, dependencies: [{ from: 'p-a', to: 'p-b', kind: 'blocks', createdBy: null, createdAt: null }] }), bead('p-b', { title: 'Fix login' })], 'p-a');
    expect(document.querySelector('.bd-addrow')).toBeNull();
    const rels = document.querySelector<HTMLElement>('[data-section="relationships"]')!;
    expect(within(rels).getByRole('button', { name: /Fix login/ })).toBeTruthy();
    expect(within(rels).getByRole('button', { name: 'Add link' })).toBeTruthy();
  });

  it('adds a link by searching titles, shows it at once, and removes it', async () => {
    const t = await opened([bead('p-a', { title: 'Main' }), bead('p-b', { title: 'Fix login' })], 'p-a');
    t.w.handlers.dependency = () => json({ ok: true });
    await click(button('Add link'));
    expect((screen.getByRole('combobox', { name: 'Kind of link' }) as HTMLSelectElement).value).toBe('blocked-by');
    await type(screen.getByRole('combobox', { name: 'Find a bead by id or title' }), 'login');
    await click(screen.getByRole('option', { name: /Fix login/ }));
    expect(t.routed('dependency')[0]?.body).toEqual({ directory: '/p/a', op: 'add', from: 'p-a', to: 'p-b', kind: 'blocks' });
    const row = screen.getByRole('button', { name: /Fix login/ });
    expect(row.closest('[data-group]')?.getAttribute('data-group')).toBe('blocks-out');
    await click(button('Remove link to p-b'));
    expect(t.routed('dependency')[1]?.body).toEqual({ directory: '/p/a', op: 'remove', from: 'p-a', to: 'p-b' });
    expect(screen.queryByRole('button', { name: /Fix login/ })).toBeNull();
  });

  it('says a link may have saved and refreshes instead of trying again', async () => {
    const t = await opened([bead('p-a', { title: 'Main' }), bead('p-b', { title: 'Fix login' })], 'p-a');
    t.w.handlers.dependency = () => envelope(504, { code: 'uncertain', message: 'Beads did not answer in time. The link may or may not have been saved. Check before trying again.' });
    await click(button('Add link'));
    await type(screen.getByRole('combobox', { name: 'Find a bead by id or title' }), 'b');
    await click(screen.getByRole('option', { name: /Fix login/ }));
    expect(screen.getByText('This may have saved. Refreshing.')).toBeTruthy();
    await later(10_000);
    expect(t.routed('dependency')).toHaveLength(1);
  });
});

describe('comments', () => {
  it('posts with Cmd+Enter and shows the comment at once', async () => {
    const t = await opened([bead('p-a')], 'p-a');
    t.w.handlers.comment = (call) => json({ comment: { id: 'c9', author: 'Ann (panel)', text: call.body.text, createdAt: iso(0) } });
    const box = textbox('Add a comment');
    await type(box, 'Looks good');
    await key(box, 'Enter', { metaKey: true });
    expect(t.routed('comment')[0]?.body).toEqual({ directory: '/p/a', id: 'p-a', text: 'Looks good' });
    expect(screen.getByRole('article', { name: 'Comment by you (panel)' }).textContent).toContain('Looks good');
    expect(textbox('Add a comment').value).toBe('');
  });

  it('keeps an uncertain comment for an explicit second try only', async () => {
    // The service has not read the project again, so it stays "may have saved".
    const t = await opened([bead('p-a')], 'p-a', () => ({ freshness: freshness({ localRefreshedAt: iso(MIN) }) }));
    t.w.handlers.comment = () => envelope(504, { code: 'uncertain', message: 'Beads did not answer in time. The comment may or may not have been saved. Check before trying again.' });
    await type(textbox('Add a comment'), 'Looks good');
    await click(button('Post'));
    expect(screen.getByText('This may have saved. Refreshing.')).toBeTruthy();
    expect(textbox('Add a comment').value).toBe('Looks good');
    await later(10_000);
    expect(t.routed('comment')).toHaveLength(1);
    // Cmd+Enter does not resend it blindly either; only the button that says so does.
    await key(textbox('Add a comment'), 'Enter', { metaKey: true });
    expect(t.routed('comment')).toHaveLength(1);
    await click(button('Post again'));
    expect(t.routed('comment')).toHaveLength(2);
  });
});

/** A key press, and whether the page let it go on (false: something called preventDefault). */
const press = async (el: Element, k: string, over: Record<string, unknown> = {}) => {
  let allowed = true;
  await run(() => {
    allowed = fireEvent.keyDown(el, { key: k, ...over });
  });
  return allowed;
};

// Ruling: Enter affirms a confirm question (Discard), unless a button has focus.
describe('Enter on a confirm question', () => {
  const ENTERS: Array<[string, Record<string, unknown>]> = [
    ['Enter', {}],
    ['Cmd+Enter', { metaKey: true }],
    ['Ctrl+Enter', { ctrlKey: true }],
  ];

  describe('"Discard this bead?" in the New bead form', () => {
    /** The form with a typed title and its question showing. */
    async function asked() {
      const t = await opened([bead('p-e', { type: 'epic' })], null);
      t.w.handlers.create = () => json({ bead: bead('p-e.2', { parentId: 'p-e', title: 'Retry', updatedAt: iso(0) }) });
      const closeCreate = vi.spyOn(t.store, 'closeCreate');
      await click(button('New bead'));
      const form = screen.getByRole('dialog', { name: 'New bead' });
      const title = within(form).getByRole('textbox', { name: 'Title' });
      await type(title, 'Retry');
      await type(within(form).getByRole('textbox', { name: 'Description' }), 'Some words');
      await key(title, 'Escape');
      const ask = screen.getByRole('alertdialog', { name: 'Discard this bead?' });
      return { t, form, title, ask, closeCreate };
    }

    it.each(ENTERS)('%s in a field discards once and never creates', async (_name, over) => {
      const { t, form, title, closeCreate } = await asked();
      expect(await press(title, 'Enter', over)).toBe(false);
      expect(closeCreate).toHaveBeenCalledTimes(1);
      expect(t.routed('create')).toHaveLength(0);
      expect(screen.queryByRole('dialog', { name: 'New bead' })).toBeNull();
      expect(form.isConnected).toBe(false);
    });

    it('also discards from the description, where a plain Enter would be a new line', async () => {
      const { t, form, closeCreate } = await asked();
      expect(await press(within(form).getByRole('textbox', { name: 'Description' }), 'Enter')).toBe(false);
      expect(closeCreate).toHaveBeenCalledTimes(1);
      expect(t.routed('create')).toHaveLength(0);
    });

    it('leaves Enter on a focused Keep editing to the button, so it keeps editing', async () => {
      const { t, ask, closeCreate } = await asked();
      const keep = within(ask).getByRole('button', { name: 'Keep editing' });
      keep.focus();
      expect(await press(keep, 'Enter')).toBe(true);
      expect(await press(keep, 'Enter', { metaKey: true })).toBe(true);
      expect(closeCreate).not.toHaveBeenCalled();
      expect(t.routed('create')).toHaveLength(0);
      // The browser's own activation of that button, which the test stands in for with the click it makes.
      await click(keep);
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(screen.getByRole('dialog', { name: 'New bead' })).toBeTruthy();
    });

    it('does nothing for an Enter that picks a character in an input method', async () => {
      const { t, title, closeCreate } = await asked();
      expect(await press(title, 'Enter', { isComposing: true })).toBe(true);
      expect(await press(title, 'Enter', { keyCode: 229 })).toBe(true);
      expect(closeCreate).not.toHaveBeenCalled();
      expect(t.routed('create')).toHaveLength(0);
      expect(screen.getByRole('alertdialog', { name: 'Discard this bead?' })).toBeTruthy();
    });

    it('puts focus back in the title when Cancel brings the question up, and when Keep editing takes it away', async () => {
      const t = await opened([bead('p-e', { type: 'epic' })], null);
      await click(button('New bead'));
      const form = screen.getByRole('dialog', { name: 'New bead' });
      const title = within(form).getByRole('textbox', { name: 'Title' });
      await type(title, 'Retry');
      await click(within(form).getByRole('button', { name: 'Cancel' }));
      expect(screen.getByRole('alertdialog', { name: 'Discard this bead?' })).toBeTruthy();
      expect(document.activeElement).toBe(title);
      await click(within(form).getByRole('button', { name: 'Keep editing' }));
      expect(document.activeElement).toBe(title);
      expect(t.routed('create')).toHaveLength(0);
    });
  });

  describe('"Discard your changes?" in a text editor', () => {
    async function asked(field: 'Description' | 'Title' = 'Description') {
      const t = await opened([bead('p-a', { description: 'Old words' })], 'p-a');
      t.w.handlers.update = (call) => json({ ok: true, bead: bead('p-a', { ...(call.body.patch as object), updatedAt: iso(0) }) } satisfies WriteResult);
      await click(button(`Edit ${field.toLowerCase()}`));
      const box = textbox(field);
      await type(box, 'Half typed');
      await key(box, 'Escape');
      const ask = screen.getByRole('alertdialog', { name: 'Discard your changes?' });
      return { t, box, ask };
    }

    it.each(ENTERS)('%s in the box discards once and never saves', async (_name, over) => {
      const { t, box } = await asked();
      expect(await press(box, 'Enter', over)).toBe(false);
      expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull();
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(t.routed('update')).toHaveLength(0);
      expect(store(t).detail).not.toBeNull();
      expect(document.querySelector('[data-section="description"] .bd-md')?.textContent).toContain('Old words');
    });

    it('discards from the title box too, where a plain Enter saves', async () => {
      const { t, box } = await asked('Title');
      expect(await press(box, 'Enter')).toBe(false);
      expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
      expect(t.routed('update')).toHaveLength(0);
    });

    it('leaves Enter on a focused Keep editing to the button, so it keeps editing', async () => {
      const { t, box, ask } = await asked();
      const keep = within(ask).getByRole('button', { name: 'Keep editing' });
      keep.focus();
      expect(await press(keep, 'Enter')).toBe(true);
      expect(await press(keep, 'Enter', { ctrlKey: true })).toBe(true);
      expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeTruthy();
      expect(t.routed('update')).toHaveLength(0);
      await click(keep);
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(box.value).toBe('Half typed');
    });

    it('does nothing for an Enter that picks a character in an input method', async () => {
      const { t, box } = await asked();
      expect(await press(box, 'Enter', { isComposing: true })).toBe(true);
      expect(await press(box, 'Enter', { keyCode: 229, metaKey: true })).toBe(true);
      expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeTruthy();
      expect(box.value).toBe('Half typed');
      expect(t.routed('update')).toHaveLength(0);
    });

    it('puts focus back in the box when Cancel brings the question up, and when Keep editing takes it away', async () => {
      const t = await opened([bead('p-a', { description: 'Old words' })], 'p-a');
      await click(button('Edit description'));
      const box = textbox('Description');
      await type(box, 'Half typed');
      await click(button('Cancel'));
      expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeTruthy();
      expect(document.activeElement).toBe(box);
      await click(button('Keep editing'));
      expect(document.activeElement).toBe(box);
      expect(t.routed('update')).toHaveLength(0);
    });
  });

  describe('"Discard your changes?" when leaving a bead', () => {
    /** An open description draft, and Back pressed: the question shows and takes focus itself. */
    async function asked() {
      const t = await opened([bead('p-a', { description: 'Old words' })], 'p-a');
      t.w.handlers.update = (call) => json({ ok: true, bead: bead('p-a', { ...(call.body.patch as object), updatedAt: iso(0) }) } satisfies WriteResult);
      const dropDrafts = vi.spyOn(t.store, 'dropDrafts');
      await click(button('Edit description'));
      const box = textbox('Description');
      await type(box, 'Half typed');
      await click(button('Back'));
      const ask = screen.getByRole('alertdialog', { name: 'Discard your changes?' });
      return { t, box, ask, dropDrafts };
    }

    it.each(ENTERS)('%s in the open editor discards once and never saves', async (_name, over) => {
      const { t, box, dropDrafts } = await asked();
      expect(await press(box, 'Enter', over)).toBe(false);
      expect(dropDrafts).toHaveBeenCalledTimes(1);
      expect(store(t).detail).toBeNull();
      expect(t.routed('update')).toHaveLength(0);
    });

    it('also stops a typed comment from being posted by the same key', async () => {
      const t = await opened([bead('p-a', { description: 'Old words' })], 'p-a');
      const dropDrafts = vi.spyOn(t.store, 'dropDrafts');
      await type(textbox('Add a comment'), 'Not sent');
      await click(button('Back'));
      expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeTruthy();
      expect(await press(textbox('Add a comment'), 'Enter', { metaKey: true })).toBe(false);
      expect(t.routed('comment')).toHaveLength(0);
      expect(dropDrafts).toHaveBeenCalledTimes(1);
      expect(store(t).detail).toBeNull();
    });

    it('takes focus on the question itself, so a plain Enter answers yes and discards once', async () => {
      const { t, ask, dropDrafts } = await asked();
      expect(document.activeElement).toBe(ask);
      expect(await press(ask, 'Enter')).toBe(false);
      expect(dropDrafts).toHaveBeenCalledTimes(1);
      expect(store(t).detail).toBeNull();
      expect(t.routed('update')).toHaveLength(0);
    });

    it('leaves Enter on a focused Keep editing to the button, so it keeps editing', async () => {
      const { t, ask, dropDrafts } = await asked();
      const keep = within(ask).getByRole('button', { name: 'Keep editing' });
      keep.focus();
      expect(await press(keep, 'Enter')).toBe(true);
      expect(await press(keep, 'Enter', { metaKey: true })).toBe(true);
      expect(dropDrafts).not.toHaveBeenCalled();
      expect(store(t).detail).not.toBeNull();
      await click(keep);
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(textbox('Description').value).toBe('Half typed');
    });

    it('leaves Enter on a focused Discard to the button, which discards', async () => {
      const { ask, t } = await asked();
      const discard = within(ask).getByRole('button', { name: 'Discard' });
      expect(await press(discard, 'Enter')).toBe(true);
      await click(discard);
      expect(store(t).detail).toBeNull();
    });

    it('does nothing for an Enter that picks a character in an input method', async () => {
      const { t, box, dropDrafts } = await asked();
      expect(await press(box, 'Enter', { isComposing: true })).toBe(true);
      expect(await press(box, 'Enter', { keyCode: 229, ctrlKey: true })).toBe(true);
      expect(dropDrafts).not.toHaveBeenCalled();
      expect(store(t).detail).not.toBeNull();
      expect(t.routed('update')).toHaveLength(0);
      expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeTruthy();
    });
  });
});

describe('drafts', () => {
  it('asks before Back drops a draft, and keeps it on Keep editing', async () => {
    const t = await opened([bead('p-a', { description: 'Old words' })], 'p-a');
    await click(button('Edit description'));
    await type(textbox('Description'), 'Half typed');
    await click(button('Back'));
    expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeTruthy();
    expect(store(t).detail).not.toBeNull();
    await click(button('Keep editing'));
    expect(textbox('Description').value).toBe('Half typed');
    // Escape outside the field goes back too, and asks the same.
    await run(() => fireEvent.keyDown(document, { key: 'Escape' }));
    expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeTruthy();
    await click(within(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).getByRole('button', { name: 'Discard' }));
    expect(store(t).detail).toBeNull();
  });

  it('asks before opening another bead over a typed comment, or another section over a draft', async () => {
    const t = await opened([bead('p-a', { title: 'Main', notes: 'N', dependencies: [{ from: 'p-a', to: 'p-b', kind: 'blocks', createdBy: null, createdAt: null }] }), bead('p-b', { title: 'Fix login' })], 'p-a');
    await type(textbox('Add a comment'), 'Not sent yet');
    await click(screen.getByRole('button', { name: /Fix login/ }));
    expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Main' })).toBeTruthy();
    await click(button('Keep editing'));
    expect(textbox('Add a comment').value).toBe('Not sent yet');
    await type(textbox('Add a comment'), '');
    await click(button('Edit notes'));
    await type(textbox('Notes'), 'Changed notes');
    await click(button('Add description'));
    expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeTruthy();
    await click(within(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('textbox', { name: 'Notes' })).toBeNull();
    expect(textbox('Description')).toBeTruthy();
  });

  it('says the new bead was made when the person stays on their draft instead of opening it', async () => {
    const t = await opened([bead('p-e', { type: 'epic', title: 'Offline playback', description: 'Words' })], 'p-e');
    t.w.handlers.create = () => json({ bead: bead('p-e.2', { parentId: 'p-e', title: 'Retry downloads', updatedAt: iso(0) }) });
    await click(button('Edit description'));
    await type(textbox('Description'), 'Half typed');
    await click(button('New bead'));
    const form = screen.getByRole('dialog', { name: 'New bead' });
    await type(within(form).getByRole('textbox', { name: 'Title' }), 'Retry downloads');
    await click(within(form).getByRole('button', { name: 'Create' }));
    expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeTruthy();
    await click(button('Keep editing'));
    expect(t.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success', message: 'Created e.2.' }));
    expect(textbox('Description').value).toBe('Half typed');
    expect(screen.getByRole('heading', { name: 'Offline playback' })).toBeTruthy();
  });

  it('discarding a section draft to switch sections keeps the typed comment guarded', async () => {
    const t = await opened([bead('p-a', { notes: 'N' })], 'p-a');
    await type(textbox('Add a comment'), 'Not sent yet');
    await click(button('Edit notes'));
    await type(textbox('Notes'), 'Changed notes');
    await click(button('Add description'));
    await click(within(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).getByRole('button', { name: 'Discard' }));
    expect(textbox('Description')).toBeTruthy();
    await click(button('Cancel'));
    await click(button('Back'));
    expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeTruthy();
    expect(store(t).detail).not.toBeNull();
    expect(textbox('Add a comment').value).toBe('Not sent yet');
  });

  it('Escape on the editor\'s own discard question keeps editing, and asks nothing more', async () => {
    const t = await opened([bead('p-a', { description: 'Old words' })], 'p-a');
    await click(button('Edit description'));
    await type(textbox('Description'), 'Half typed');
    await key(textbox('Description'), 'Escape');
    const ask = screen.getByRole('alertdialog', { name: 'Discard your changes?' });
    const keep = within(ask).getByRole('button', { name: 'Keep editing' });
    keep.focus();
    await key(keep, 'Escape');
    expect(screen.queryAllByRole('alertdialog')).toHaveLength(0);
    expect(textbox('Description').value).toBe('Half typed');
    expect(store(t).detail).not.toBeNull();
  });

  it('keeps the drafts when the project stops being usable and comes back: the editor reopens with them, still guarded', async () => {
    const t = await opened([bead('p-a', { description: 'Old words' })], 'p-a');
    await click(button('Edit description'));
    await type(textbox('Description'), 'Half typed');
    await type(textbox('Add a comment'), 'Not sent yet');
    t.w.handlers.snapshot = () => envelope(409, { code: 'workspace', message: "This project's Beads server isn't running.", workspace: { kind: 'server-down', root: '/p/a', port: 3307 } });
    await run(() => t.store.retry());
    expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Add a comment' })).toBeNull();

    delete t.w.handlers.snapshot;
    await run(() => t.store.retry());
    expect(textbox('Description').value).toBe('Half typed');
    expect(textbox('Add a comment').value).toBe('Not sent yet');
    await click(button('Back'));
    expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeTruthy();
    // Let go on purpose: opening the bead again starts clean.
    await click(within(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).getByRole('button', { name: 'Discard' }));
    await run(() => t.store.select('p-a'));
    expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull();
    expect(textbox('Add a comment').value).toBe('');
  });

  it('keeps the field focused and readable, not disabled, while it saves', async () => {
    const t = await opened([bead('p-a', { description: 'Old words' })], 'p-a');
    const pending = deferred<Answer>();
    t.w.handlers.update = () => pending.promise;
    await click(button('Edit description'));
    await type(textbox('Description'), 'My words');
    textbox('Description').focus();
    await key(textbox('Description'), 'Enter', { metaKey: true });
    const box = textbox('Description');
    expect(box.disabled).toBe(false);
    expect(box.readOnly).toBe(true);
    expect(document.activeElement).toBe(box);
  });
});

describe('known or possible saves', () => {
  it('clears a comment Beads saved but could not read back, and sends it once', async () => {
    const t = await opened([bead('p-a')], 'p-a');
    t.w.handlers.comment = () => envelope(504, { code: 'uncertain', message: "Saved, but couldn't load the result. Refreshing.", saved: true });
    await type(textbox('Add a comment'), 'Looks good');
    await click(button('Post'));
    expect(textbox('Add a comment').value).toBe('');
    expect(screen.queryByRole('button', { name: 'Post again' })).toBeNull();
    await later(10_000);
    expect(t.routed('comment')).toHaveLength(1);
  });

  it('treats a lost answer to a create as maybe saved, with only "Create again" to send it again', async () => {
    const t = await opened([bead('p-e', { type: 'epic' })], null);
    t.w.handlers.create = () => {
      throw new HostRequestError('HOST_TIMEOUT', 'request timed out after 20s');
    };
    const reads = t.routed('snapshot').length;
    await click(button('New bead'));
    const form = screen.getByRole('dialog', { name: 'New bead' });
    await type(within(form).getByRole('textbox', { name: 'Title' }), 'Something');
    await click(within(form).getByRole('button', { name: 'Create' }));
    expect(within(form).getByText('This may have saved. Refreshing.')).toBeTruthy();
    expect(t.routed('snapshot').length).toBeGreaterThan(reads);
    // The plain Create is off; Cmd+Enter does nothing; only the button that says so sends again.
    expect((within(form).getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
    await key(within(form).getByRole('textbox', { name: 'Title' }), 'Enter', { metaKey: true });
    expect(t.routed('create')).toHaveLength(1);
    await click(within(form).getByRole('button', { name: 'Create again' }));
    expect(t.routed('create')).toHaveLength(2);
  });

  it('closes the create form when the bead is known to be made, and says it will show soon', async () => {
    const t = await opened([bead('p-e', { type: 'epic' })], null);
    t.w.handlers.create = () => envelope(504, { code: 'uncertain', message: "Saved, but couldn't load the result. Refreshing.", saved: true });
    await click(button('New bead'));
    await type(within(screen.getByRole('dialog', { name: 'New bead' })).getByRole('textbox', { name: 'Title' }), 'Something');
    await click(within(screen.getByRole('dialog', { name: 'New bead' })).getByRole('button', { name: 'Create' }));
    expect(screen.queryByRole('dialog', { name: 'New bead' })).toBeNull();
    expect(t.toast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Created. It will show in the list in a moment.' }));
  });

  it('closes a text editor when Beads saved the text but could not read it back', async () => {
    const t = await opened([bead('p-a', { notes: 'Old notes' })], 'p-a');
    t.w.handlers.update = () => json({ ok: false, uncertain: true, current: null, saved: true } satisfies WriteResult);
    await click(button('Edit notes'));
    await type(textbox('Notes'), 'New notes');
    await click(button('Save'));
    expect(screen.queryByRole('textbox', { name: 'Notes' })).toBeNull();
  });

  it('once the refresh after an uncertain save lands, says it saved, with no false conflict', async () => {
    const t = await opened([bead('p-a', { notes: 'Old notes' })], 'p-a');
    t.w.handlers.update = () => {
      // It did go in; the answer just did not come back.
      t.w.db.beads = [bead('p-a', { notes: 'New notes', updatedAt: iso(0) })];
      t.w.db.cursor = 2;
      return json({ ok: false, uncertain: true, current: null } satisfies WriteResult);
    };
    await click(button('Edit notes'));
    await type(textbox('Notes'), 'New notes');
    await click(button('Save'));
    await later(100);
    expect(screen.queryByText('Changed while you were editing')).toBeNull();
    expect(screen.getByText('Saved.')).toBeTruthy();
    expect(screen.queryByText('This may have saved. Refreshing.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save again' })).toBeNull();
  });

  it('once the refresh after an uncertain save lands, says it did not save and keeps the draft', async () => {
    const t = await opened([bead('p-a', { notes: 'Old notes' })], 'p-a');
    t.w.handlers.update = () => {
      t.w.db.cursor = 2;
      return json({ ok: false, uncertain: true, current: null } satisfies WriteResult);
    };
    await click(button('Edit notes'));
    await type(textbox('Notes'), 'New notes');
    await click(button('Save'));
    // A copy the service held from before the save proves nothing: the note stays until it reads the project again.
    expect(screen.getByText('This may have saved. Refreshing.')).toBeTruthy();
    await later(2_000);
    expect(screen.getByText('It did not save. Your draft is still here.')).toBeTruthy();
    expect(textbox('Notes').value).toBe('New notes');
    expect((button('Save') as HTMLButtonElement).disabled).toBe(false);
    await click(button('Save'));
    expect(t.routed('update')).toHaveLength(2);
  });

  it('after an uncertain save, only "Save again" sends the draft', async () => {
    const t = await opened([bead('p-a', { notes: 'Old notes' })], 'p-a');
    t.w.handlers.update = () => json({ ok: false, uncertain: true, current: null } satisfies WriteResult);
    t.w.handlers.bead = () => new Promise<Answer>(() => {});
    await click(button('Edit notes'));
    await type(textbox('Notes'), 'New notes');
    await click(button('Save'));
    expect((button('Save') as HTMLButtonElement).disabled).toBe(true);
    await key(textbox('Notes'), 'Enter', { metaKey: true });
    expect(t.routed('update')).toHaveLength(1);
    await click(button('Save again'));
    expect(t.routed('update')).toHaveLength(2);
  });
});

describe('answers with more to say', () => {
  it('reads the bead again when a refused change partly went in', async () => {
    const t = await opened([bead('p-a', { status: 'open' })], 'p-a');
    t.w.handlers.update = () => envelope(503, { code: 'busy', message: 'Beads is busy. Part of your change was saved. Try again in a moment.', saved: true });
    const reads = t.routed('bead').length;
    const polls = t.routed('snapshot').length;
    await click(button('Priority: P2'));
    await click(screen.getByRole('menuitemradio', { name: /P1/ }));
    expect(screen.getByText('Beads is busy. Part of your change was saved. Try again in a moment.')).toBeTruthy();
    expect(t.routed('bead').length).toBeGreaterThan(reads);
    expect(t.routed('snapshot').length).toBeGreaterThan(polls);
  });

  it('a save that went in but could not be noted as the panel\'s says so quietly, with Copy details', async () => {
    const t = await opened([bead('p-a')], 'p-a');
    t.w.handlers.update = () => json({ ok: true, bead: bead('p-a', { priority: 1, updatedAt: iso(0) }), detail: 'Could not note the change to p-a: disk full' } satisfies WriteResult);
    await click(button('Priority: P2'));
    await click(screen.getByRole('menuitemradio', { name: /P1/ }));
    expect(t.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'info', copy: { text: 'Could not note the change to p-a: disk full' } }));
  });
});

describe('keyboard', () => {
  const setPlatform = (platform: string) => Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
  afterEach(() => setPlatform(''));

  it('names the save key for the platform: Cmd+Enter on a Mac, Ctrl+Enter elsewhere', async () => {
    setPlatform('Win32');
    await opened([bead('p-a', { description: 'Words' })], 'p-a');
    await click(button('Edit description'));
    expect(document.querySelector('.bd-editor .bd-edhint')?.textContent).toContain('Ctrl+Enter');
    cleanup();
    setPlatform('MacIntel');
    await opened([bead('p-a', { description: 'Words' })], 'p-a');
    await click(button('Edit description'));
    expect(document.querySelector('.bd-editor .bd-edhint')?.textContent).toContain('⌘↵');
  });

  it('ignores Enter while an input method is composing', async () => {
    const t = await opened([bead('p-a', { title: 'Old' })], 'p-a');
    await click(button('Edit title'));
    await type(textbox('Title'), 'New');
    await key(textbox('Title'), 'Enter', { isComposing: true });
    expect(t.routed('update')).toHaveLength(0);
    await key(textbox('Title'), 'Enter');
    expect(t.routed('update')).toHaveLength(1);
  });

  it('sends focus back to the Edit button when an editor closes', async () => {
    await opened([bead('p-a', { description: 'Words' })], 'p-a');
    await click(button('Edit description'));
    await click(button('Cancel'));
    expect(document.activeElement).toBe(button('Edit description'));
  });

  it('keeps Tab inside the New bead form, and gives focus back on close', async () => {
    await opened([bead('p-e', { type: 'epic' })], null);
    const opener = button('New bead');
    opener.focus();
    await click(opener);
    const form = screen.getByRole('dialog', { name: 'New bead' });
    const focusables = Array.from(form.querySelectorAll<HTMLElement>('input, select, textarea, button:not([disabled])'));
    focusables[focusables.length - 1]!.focus();
    await key(focusables[focusables.length - 1]!, 'Tab');
    expect(document.activeElement).toBe(focusables[0]);
    await key(focusables[0]!, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(focusables[focusables.length - 1]);
    await click(within(form).getByRole('button', { name: 'Cancel' }));
    await later(50);
    expect(document.activeElement).toBe(button('New bead'));
  });

  it('gives the New bead button focus only once nothing covers it any more, since an inert element ignores focus', async () => {
    await opened([bead('p-e', { type: 'epic' })], null);
    const opener = button('New bead');
    opener.focus();
    await click(opener);
    const covered: boolean[] = [];
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (this: HTMLElement, ...args: Parameters<HTMLElement['focus']>) {
      if (this === opener) covered.push(this.closest('[inert]') !== null);
      return focus.apply(this, args);
    };
    try {
      await click(within(screen.getByRole('dialog', { name: 'New bead' })).getByRole('button', { name: 'Cancel' }));
      await later(50);
    } finally {
      HTMLElement.prototype.focus = focus;
    }
    expect(covered.length).toBeGreaterThan(0);
    expect(covered.every((c) => !c)).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  it('points the link search at the highlighted result', async () => {
    await opened([bead('p-a', { title: 'Main' }), bead('p-b', { title: 'Fix login' })], 'p-a');
    await click(button('Add link'));
    const search = screen.getByRole('combobox', { name: 'Find a bead by id or title' });
    await type(search, 'login');
    expect(search.getAttribute('aria-activedescendant')).toBeNull();
    await key(search, 'ArrowDown');
    const option = screen.getByRole('option', { name: /Fix login/ });
    expect(search.getAttribute('aria-activedescendant')).toBe(option.id);
    expect(option.id).not.toBe('');
  });
});

describe('settling "may have saved"', () => {
  it('an inline change: "Saved." once it shows, or "It did not save." with Try again once the service read the project', async () => {
    const t = await opened([bead('p-a', { priority: 2 }), bead('p-b', { priority: 2 })], 'p-a');
    t.w.handlers.update = (call) => {
      if (call.body.id === 'p-b') {
        // It went in; the answer just never came back.
        t.w.db.beads = t.w.db.beads.map((b) => (b.id === 'p-b' ? { ...b, priority: 1, updatedAt: iso(0) } : b));
        t.w.db.cursor++;
      }
      return json({ ok: false, uncertain: true, current: null } satisfies WriteResult);
    };
    await click(button('Priority: P2'));
    await click(screen.getByRole('menuitemradio', { name: /P1/ }));
    expect(screen.getByText('This may have saved. Refreshing.')).toBeTruthy();
    await later(2_000);
    expect(screen.getByText('It did not save.')).toBeTruthy();
    await click(button('Try again'));
    expect(t.routed('update')).toHaveLength(2);

    await run(() => t.store.openRelated('p-b'));
    await click(button('Priority: P2'));
    await click(screen.getByRole('menuitemradio', { name: /P1/ }));
    await later(2_000);
    expect(screen.getByText('Saved.')).toBeTruthy();
  });

  it('a comment: "Saved." and an empty box once it shows, or "It did not save." with Post back on', async () => {
    const t = await opened([bead('p-a')], 'p-a');
    let lands = true;
    t.w.handlers.comment = (call) => {
      if (lands) {
        const b = t.w.db.beads[0]!;
        t.w.db.beads = [{ ...b, comments: [...b.comments, { id: 'c1', author: 'Ann (panel)', text: String(call.body.text), createdAt: iso(0) }] }];
        t.w.db.cursor++;
      }
      return envelope(504, { code: 'uncertain', message: 'Beads did not answer in time. The comment may or may not have been saved. Check before trying again.' });
    };
    await type(textbox('Add a comment'), 'First');
    await click(button('Post'));
    await later(2_000);
    expect(screen.getByText('Saved.')).toBeTruthy();
    expect(textbox('Add a comment').value).toBe('');
    lands = false;
    await type(textbox('Add a comment'), 'Second');
    await click(button('Post'));
    expect((button('Post') as HTMLButtonElement).disabled).toBe(true);
    await later(2_000);
    expect(screen.getByText('It did not save. Your comment is still here.')).toBeTruthy();
    expect(textbox('Add a comment').value).toBe('Second');
    expect((button('Post') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a comment the list already shows settles as saved even while the bead read is slow', async () => {
    const t = await opened([bead('p-a')], 'p-a');
    t.w.handlers.comment = (call) => {
      const b = t.w.db.beads[0]!;
      t.w.db.beads = [{ ...b, comments: [...b.comments, { id: 'c1', author: 'Ann (panel)', text: String(call.body.text), createdAt: iso(0) }] }];
      t.w.db.cursor++;
      return envelope(504, { code: 'uncertain', message: 'Beads did not answer in time. The comment may or may not have been saved. Check before trying again.' });
    };
    // The bead read hangs, so the detail's own copy stays the one from before the comment (same updatedAt: comments do not move it).
    t.w.handlers.bead = () => new Promise<Answer>(() => {});
    await type(textbox('Add a comment'), 'Looks good');
    await click(button('Post'));
    await later(2_000);
    expect(screen.getByText('Saved.')).toBeTruthy();
    expect(screen.queryByText(/It did not save/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Post again' })).toBeNull();
    expect((button('Post') as HTMLButtonElement).disabled).toBe(true);
    expect(t.routed('comment')).toHaveLength(1);
  });

  it('an inline change and a text save the list already shows settle as saved even while the bead read is slow', async () => {
    const t = await opened([bead('p-a', { priority: 2, notes: 'Old notes' })], 'p-a');
    t.w.handlers.update = (call) => {
      const patch = call.body.patch as Partial<Bead>;
      // In, with the same second's stamp, so the detail's older read copy still wins a tie.
      t.w.db.beads = [{ ...t.w.db.beads[0]!, ...patch }];
      t.w.db.cursor++;
      return json({ ok: false, uncertain: true, current: null } satisfies WriteResult);
    };
    t.w.handlers.bead = () => new Promise<Answer>(() => {});
    await click(button('Priority: P2'));
    await click(screen.getByRole('menuitemradio', { name: /P1/ }));
    await later(2_000);
    expect(screen.getByText('Saved.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    await click(button('Edit notes'));
    await type(textbox('Notes'), 'New notes');
    await click(button('Save'));
    await later(2_000);
    expect(screen.queryByText(/It did not save/)).toBeNull();
    expect(screen.queryByText('Changed while you were editing')).toBeNull();
  });

  it('a text editor keeps the saved text while the list shows it and the detail re-read still lags', async () => {
    const t = await opened([bead('p-a', { notes: 'Old notes' })], 'p-a');
    t.w.handlers.update = (call) => {
      const patch = call.body.patch as Partial<Bead>;
      t.w.db.beads = [{ ...t.w.db.beads[0]!, ...patch }];
      t.w.db.cursor++;
      return json({ ok: false, uncertain: true, current: null } satisfies WriteResult);
    };
    // The detail read hangs: the shown copy keeps the old notes while the list copy has the new ones.
    t.w.handlers.bead = () => new Promise<Answer>(() => {});
    await click(button('Edit notes'));
    await type(textbox('Notes'), 'New notes');
    await click(button('Save'));
    await later(2_000);
    expect(screen.getByText('Saved.')).toBeTruthy();
    // The editor still holds the saved text; it did not follow the lagging copy back to the old one.
    expect(textbox('Notes').value).toBe('New notes');
    expect(screen.queryByText('Changed while you were editing')).toBeNull();
    await later(2_000);
    expect(textbox('Notes').value).toBe('New notes');
    // Typing on from here saves over the saved text, not over the old one.
    await type(textbox('Notes'), 'Newer notes');
    await click(button('Save'));
    expect(t.routed('update').at(-1)?.body).toMatchObject({ patch: { notes: 'Newer notes' }, expected: { notes: 'New notes' } });
  });

  it('a same-title bead an agent made meanwhile is not taken for the panel\'s own', async () => {
    const t = await opened([bead('p-e', { type: 'epic' })], null);
    t.w.handlers.create = () => {
      t.w.db.beads = [...t.w.db.beads, bead('p-ag', { title: 'Something', createdBy: 'Claude Code', updatedAt: iso(0) })];
      t.w.db.cursor++;
      return envelope(504, { code: 'uncertain', message: 'Beads did not answer in time. The bead may or may not have been saved. Check before trying again.' });
    };
    await click(button('New bead'));
    const form = screen.getByRole('dialog', { name: 'New bead' });
    await type(within(form).getByRole('textbox', { name: 'Title' }), 'Something');
    await click(within(form).getByRole('button', { name: 'Create' }));
    await later(2_000);
    expect(screen.getByRole('dialog', { name: 'New bead' })).toBeTruthy();
    expect(within(form).getByText('It did not save.')).toBeTruthy();
    expect(t.toast).not.toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/^Created/) }));
  });

  it('a new bead: closes with "Created" once it shows, or "It did not save." with Create back on', async () => {
    const t = await opened([bead('p-e', { type: 'epic' })], null);
    let lands = false;
    t.w.handlers.create = () => {
      if (lands) {
        t.w.db.beads = [...t.w.db.beads, bead('p-n1', { title: 'Something', createdBy: 'Ann (panel)', updatedAt: iso(0) })];
        t.w.db.cursor++;
      }
      return envelope(504, { code: 'uncertain', message: 'Beads did not answer in time. The bead may or may not have been saved. Check before trying again.' });
    };
    await click(button('New bead'));
    const form = screen.getByRole('dialog', { name: 'New bead' });
    await type(within(form).getByRole('textbox', { name: 'Title' }), 'Something');
    await click(within(form).getByRole('button', { name: 'Create' }));
    await later(2_000);
    expect(within(form).getByText('It did not save.')).toBeTruthy();
    expect((within(form).getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(false);
    lands = true;
    await click(within(form).getByRole('button', { name: 'Create' }));
    await later(2_000);
    expect(screen.queryByRole('dialog', { name: 'New bead' })).toBeNull();
    expect(t.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success', message: 'Created n1.' }));
  });
});

describe('when writes are paused', () => {
  it('writes-blocked disables every control and says why', async () => {
    await opened([bead('p-a', { description: 'Words' })], 'p-a', () => ({ writesBlocked: true }));
    expect(screen.getByRole('note').textContent).toMatch(/sync problem/);
    for (const name of ['Status: Open', 'Priority: P2', 'Assignee: unassigned', 'Edit labels', 'Edit description', 'Edit title', 'Add link', 'Post', 'New bead']) {
      expect((button(name) as HTMLButtonElement).disabled, name).toBe(true);
    }
    expect(textbox('Add a comment').disabled).toBe(true);
  });

  it('a running sync disables controls too, and they come back when it ends', async () => {
    let running = true;
    const t = await opened([bead('p-a', { description: 'Words' })], 'p-a', () => (running ? { sync: { kind: 'running', op: 'pull', startedAt: iso(0) } } : {}));
    expect(screen.getByRole('note').textContent).toMatch(/Sync runs/);
    expect((button('Edit description') as HTMLButtonElement).disabled).toBe(true);
    running = false;
    t.w.db.cursor = 2;
    await later(2_000);
    expect((button('Edit description') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a pause that starts after a conflict turns Re-apply off', async () => {
    let blocked = false;
    const t = await opened([bead('p-a')], 'p-a', () => ({ writesBlocked: blocked }));
    t.w.handlers.update = () => json({ ok: false, conflict: true, current: bead('p-a', { priority: 1, updatedAt: iso(MIN) }) } satisfies WriteResult);
    await click(button('Priority: P2'));
    await click(screen.getByRole('menuitemradio', { name: /P0/ }));
    blocked = true;
    t.w.db.cursor = 9;
    await later(2_000);
    const reapply = within(screen.getByText('Changed while you were editing').closest<HTMLElement>('.bd-wnote')!).getByRole('button', { name: 'Re-apply' }) as HTMLButtonElement;
    expect(reapply.disabled).toBe(true);
    await click(reapply);
    expect(t.routed('update')).toHaveLength(1);
  });

  it('a pause that starts while link results show keeps them from being picked', async () => {
    let blocked = false;
    const t = await opened([bead('p-a', { title: 'Main' }), bead('p-b', { title: 'Fix login' })], 'p-a', () => ({ writesBlocked: blocked }));
    await click(button('Add link'));
    await type(screen.getByRole('combobox', { name: 'Find a bead by id or title' }), 'login');
    blocked = true;
    t.w.db.cursor = 9;
    await later(2_000);
    // The result is still on screen, marked off, and picking it sends nothing.
    const option = screen.getByRole('option', { name: /Fix login/ });
    expect(option.getAttribute('aria-disabled')).toBe('true');
    await click(option);
    expect(t.routed('dependency')).toHaveLength(0);
  });

  it('removes a link once however fast the button is pressed', async () => {
    const t = await opened([bead('p-a', { title: 'Main', dependencies: [{ from: 'p-a', to: 'p-b', kind: 'blocks', createdBy: null, createdAt: null }] }), bead('p-b', { title: 'Fix login' })], 'p-a');
    const pending = deferred<Answer>();
    t.w.handlers.dependency = () => pending.promise;
    const x = button('Remove link to p-b');
    await click(x);
    await click(x);
    expect(t.routed('dependency')).toHaveLength(1);
    expect((button('Remove link to p-b') as HTMLButtonElement).disabled).toBe(true);
    await run(() => pending.resolve(json({ ok: true })));
    expect(screen.queryByRole('button', { name: /Fix login/ })).toBeNull();
  });

  it('a write refused because writes are blocked says so and reads the project again', async () => {
    const t = await opened([bead('p-a')], 'p-a');
    t.w.handlers.update = () => envelope(409, { code: 'writes-blocked', message: 'The team sync left this project half merged. Resolve the sync problem first.' });
    const polls = t.routed('snapshot').length;
    await click(button('Priority: P2'));
    await click(screen.getByRole('menuitemradio', { name: /P1/ }));
    expect(screen.getByText('The team sync left this project half merged. Resolve the sync problem first.')).toBeTruthy();
    expect(t.routed('snapshot').length).toBeGreaterThan(polls);
  });
});

describe('new bead', () => {
  it('create defaults parent to the epic in view and opens the new bead', async () => {
    const epic = bead('p-e', { type: 'epic', title: 'Offline playback' });
    const t = await opened([epic, bead('p-e.1', { parentId: 'p-e', title: 'Background fetch' }), bead('p-x', { type: 'epic', title: 'Other epic' })], 'p-e.1');
    const made = bead('p-e.2', { parentId: 'p-e', title: 'Retry downloads', createdBy: 'Ann (panel)', updatedAt: iso(0) });
    t.w.handlers.create = () => json({ bead: made });
    await click(button('New bead'));
    const form = screen.getByRole('dialog', { name: 'New bead' });
    expect((within(form).getByRole('combobox', { name: 'Parent' }) as HTMLSelectElement).value).toBe('p-e');
    expect((within(form).getByRole('combobox', { name: 'Type' }) as HTMLSelectElement).value).toBe('task');
    expect((within(form).getByRole('combobox', { name: 'Priority' }) as HTMLSelectElement).value).toBe('2');
    expect((within(form).getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
    await type(within(form).getByRole('textbox', { name: 'Title' }), 'Retry downloads');
    await type(within(form).getByRole('textbox', { name: 'Description' }), 'Back off on failures.');
    await click(within(form).getByRole('button', { name: 'Create' }));
    expect(t.routed('create')[0]?.body).toEqual({
      directory: '/p/a',
      input: { title: 'Retry downloads', type: 'task', priority: 2, parentId: 'p-e', description: 'Back off on failures.' },
    });
    expect(screen.queryByRole('dialog', { name: 'New bead' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Retry downloads' })).toBeTruthy();
    // The project has not caught up yet; the new bead is not taken for a deleted one.
    expect(screen.queryByText(/no longer in the project/)).toBeNull();
    await later(2_000);
    expect(screen.getByRole('heading', { name: 'Retry downloads' })).toBeTruthy();
    expect(screen.queryByText(/no longer in the project/)).toBeNull();
  });

  it('from the list, defaults to the epic under the cursor in Epic view, and to none in Status view', async () => {
    const t = await opened([bead('p-e', { type: 'epic', title: 'Offline playback' }), bead('p-e.1', { parentId: 'p-e', title: 'Background fetch' }), bead('p-x', { title: 'Loose' })], null);
    // j: the epic's row, j again: its child.
    await run(() => fireEvent.keyDown(document, { key: 'j' }));
    await run(() => fireEvent.keyDown(document, { key: 'j' }));
    expect(document.querySelector('[data-cursor]')?.id).toBe('bd-row-p-e.1');
    await click(button('New bead'));
    expect((within(screen.getByRole('dialog', { name: 'New bead' })).getByRole('combobox', { name: 'Parent' }) as HTMLSelectElement).value).toBe('p-e');
    await click(within(screen.getByRole('dialog', { name: 'New bead' })).getByRole('button', { name: 'Cancel' }));
    await run(() => t.store.setView('status'));
    await click(button('New bead'));
    expect((within(screen.getByRole('dialog', { name: 'New bead' })).getByRole('combobox', { name: 'Parent' }) as HTMLSelectElement).value).toBe('');
  });

  it('has no parent by default from the list, and keeps the form when creating may have saved', async () => {
    // The service has not read the project again, so it stays "may have saved".
    const t = await opened([bead('p-e', { type: 'epic' })], null, () => ({ freshness: freshness({ localRefreshedAt: iso(MIN) }) }));
    t.w.handlers.create = () => envelope(504, { code: 'uncertain', message: 'Beads did not answer in time. The bead may or may not have been saved. Check before trying again.' });
    await click(button('New bead'));
    const form = screen.getByRole('dialog', { name: 'New bead' });
    expect((within(form).getByRole('combobox', { name: 'Parent' }) as HTMLSelectElement).value).toBe('');
    await type(within(form).getByRole('textbox', { name: 'Title' }), 'Something');
    await click(within(form).getByRole('button', { name: 'Create' }));
    expect(within(form).getByText('This may have saved. Refreshing.')).toBeTruthy();
    await later(10_000);
    expect(t.routed('create')).toHaveLength(1);
    expect(within(form).getByRole('button', { name: 'Create again' })).toBeTruthy();
  });
});

// The host loads the panel in a frame sandboxed with allow-scripts only, so a form never submits there. Each flow runs on
// its button's click and on a plain Enter in its input, exactly once. jsdom has no sandbox, so these keep the wiring honest.
describe('no form submission', () => {
  const made = () => bead('p-e.2', { parentId: 'p-e', title: 'Retry downloads', createdBy: 'Ann (panel)', updatedAt: iso(0) });

  async function newBeadForm() {
    const t = await opened([bead('p-e', { type: 'epic' })], null);
    t.w.handlers.create = () => json({ bead: made() });
    await click(button('New bead'));
    const form = screen.getByRole('dialog', { name: 'New bead' });
    const title = within(form).getByRole('textbox', { name: 'Title' });
    await type(title, 'Retry downloads');
    return { t, form, title };
  }

  it('New bead: Create button sends the create once', async () => {
    const { t, form } = await newBeadForm();
    expect(form.tagName).not.toBe('FORM');
    await click(within(form).getByRole('button', { name: 'Create' }));
    expect(t.routed('create')).toHaveLength(1);
  });

  it('New bead: Enter in Title sends the create once, and not while composing', async () => {
    const { t, title } = await newBeadForm();
    await key(title, 'Enter', { isComposing: true });
    expect(t.routed('create')).toHaveLength(0);
    await key(title, 'Enter');
    expect(t.routed('create')).toHaveLength(1);
  });

  it('New bead: Enter in the description is a new line, not a create', async () => {
    const { t, form } = await newBeadForm();
    await key(within(form).getByRole('textbox', { name: 'Description' }), 'Enter');
    expect(t.routed('create')).toHaveLength(0);
  });

  async function closeReason() {
    const t = await opened([bead('p-a', { status: 'in_progress' })], 'p-a');
    t.w.handlers.update = (call) => json({ ok: true, bead: bead('p-a', { status: (call.body.patch as { status: string }).status, updatedAt: iso(0) }) } satisfies WriteResult);
    await click(button('Status: In progress'));
    await click(screen.getByRole('menuitemradio', { name: 'Closed' }));
    const why = textbox('Close reason (optional)');
    await type(why, 'Done in abc123');
    return { t, why };
  }

  it('Status close reason: the Mark button moves the status once', async () => {
    const { t } = await closeReason();
    expect(document.querySelector('.bd-popform')?.tagName).not.toBe('FORM');
    await click(button('Mark closed'));
    expect(t.routed('update')).toHaveLength(1);
    expect(t.routed('update')[0]?.body).toMatchObject({ patch: { status: 'closed', closeReason: 'Done in abc123' } });
  });

  it('Status close reason: Enter in the reason moves the status once, and not while composing', async () => {
    const { t, why } = await closeReason();
    await key(why, 'Enter', { isComposing: true });
    expect(t.routed('update')).toHaveLength(0);
    await key(why, 'Enter');
    expect(t.routed('update')).toHaveLength(1);
    expect(t.routed('update')[0]?.body).toMatchObject({ patch: { status: 'closed', closeReason: 'Done in abc123' } });
  });
});

describe('project changes', () => {
  it('drops a write answer that arrives after the project changed', async () => {
    const t = await opened([bead('p-a', { description: 'Old words' })], 'p-a');
    const pending = deferred<Answer>();
    // One fake database stands in for both projects here: the write's answer must not reach the second one.
    t.w.db.persist = false;
    t.w.handlers.update = () => pending.promise;
    await click(button('Edit description'));
    await type(textbox('Description'), 'My words');
    await click(button('Save'));
    await run(() => t.store.setDirectory('/p/b'));
    await run(() => t.store.select('p-a'));
    await run(() => pending.resolve(json({ ok: true, bead: bead('p-a', { description: 'My words', updatedAt: iso(0) }) } satisfies WriteResult)));
    await later(2_000);
    expect(store(t).snapshot?.beads.find((b) => b.id === 'p-a')?.description).toBe('Old words');
    expect(document.querySelector('[data-section="description"] .bd-md')?.textContent).toContain('Old words');
  });
});

describe('move and retype', () => {
  const menuItems = () => within(screen.getByRole('menu')).getAllByRole('menuitemradio');

  it("type menu lists the project's types", async () => {
    const t = await opened([bead('p-a', { type: 'incident' })], 'p-a', () => ({ types: [...TYPES, 'incident'] }));
    t.w.handlers.update = (call) => json({ ok: true, bead: bead('p-a', { type: (call.body.patch as { type: string }).type, updatedAt: iso(0) }) } satisfies WriteResult);
    await click(button('Type: Incident'));
    expect(menuItems().map((m) => m.textContent)).toEqual(['Task', 'Bug', 'Feature', 'Epic', 'Chore', 'Incident']);
    expect(screen.getByRole('menuitemradio', { name: 'Incident' }).getAttribute('aria-checked')).toBe('true');
    await click(screen.getByRole('menuitemradio', { name: 'Bug' }));
    // Sent with the type as shown, so a type changed in the same second still counts as changed.
    expect(t.routed('update')[0]?.body).toEqual({ directory: '/p/a', id: 'p-a', expectedUpdatedAt: iso(DAY), patch: { type: 'bug' }, expected: { type: 'incident' } });
    expect(button('Type: Bug')).toBeTruthy();
    // Focus goes back to the button that opened the menu, once it is on again.
    await later(50);
    expect(document.activeElement).toBe(button('Type: Bug'));
  });

  it('a refused type change says why in Beads\' words', async () => {
    const t = await opened([bead('p-a')], 'p-a');
    t.w.handlers.update = () => envelope(400, { code: 'invalid', message: 'Beads does not know the type "chore" in this project.' });
    await click(button('Type: Task'));
    await click(screen.getByRole('menuitemradio', { name: 'Chore' }));
    expect(t.routed('update')).toHaveLength(1);
    expect(screen.getByText('Beads does not know the type "chore" in this project.')).toBeTruthy();
    expect(button('Type: Task')).toBeTruthy();
  });

  it('move sends parent null for No parent', async () => {
    const beads = [bead('p-e', { type: 'epic', title: 'Billing' }), bead('p-f', { type: 'epic', title: 'Payments' }), bead('p-a', { parentId: 'p-e' })];
    const t = await opened(beads, 'p-a');
    t.w.handlers.update = (call) => json({ ok: true, bead: bead('p-a', { parentId: (call.body.patch as { parent: string | null }).parent, updatedAt: iso(0) }) } satisfies WriteResult);
    await click(button('Parent: Billing'));
    // No parent first, then the epics; the current one is checked.
    expect(menuItems().map((m) => m.textContent)).toEqual(['No parent', 'Billinge', 'Paymentsf']);
    expect(screen.getByRole('menuitemradio', { name: /Billing/ }).getAttribute('aria-checked')).toBe('true');
    await click(screen.getByRole('menuitemradio', { name: 'No parent' }));
    expect(t.routed('update')[0]?.body).toEqual({ directory: '/p/a', id: 'p-a', expectedUpdatedAt: iso(DAY), patch: { parent: null }, expected: { parentId: 'p-e' } });
    expect(button('Parent: No parent')).toBeTruthy();
    expect(t.toast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Moved out of Billing.' }));
    await click(button('Parent: No parent'));
    await click(screen.getByRole('menuitemradio', { name: /Payments/ }));
    expect(t.routed('update')[1]?.body).toMatchObject({ patch: { parent: 'p-f' }, expected: { parentId: null } });
    expect(button('Parent: Payments')).toBeTruthy();
  });

  it('never offers the bead itself or anything inside it', async () => {
    const beads = [bead('p-e', { type: 'epic', title: 'Billing' }), bead('p-e.1', { type: 'epic', parentId: 'p-e', title: 'Invoices' }), bead('p-e.1.1', { type: 'epic', parentId: 'p-e.1', title: 'Deep' }), bead('p-f', { type: 'epic', title: 'Payments' })];
    await opened(beads, 'p-e');
    await click(button('Parent: No parent'));
    expect(menuItems().map((m) => m.textContent)).toEqual(['No parent', 'Paymentsf']);
  });

  it('move refuses its own child with the service message', async () => {
    // The list has not caught up: Payments was moved inside this epic since it was read. Beads refuses; nothing changes here.
    const beads = [bead('p-e', { type: 'epic', title: 'Billing' }), bead('p-f', { type: 'epic', title: 'Payments' })];
    const t = await opened(beads, 'p-e');
    t.w.handlers.update = () => envelope(400, { code: 'invalid', message: 'An epic cannot go inside its own child.' });
    await click(button('Parent: No parent'));
    await click(screen.getByRole('menuitemradio', { name: /Payments/ }));
    expect(t.routed('update')[0]?.body).toMatchObject({ patch: { parent: 'p-f' }, expected: { parentId: null } });
    expect(screen.getByRole('alert').textContent).toContain('An epic cannot go inside its own child.');
    expect(button('Parent: No parent')).toBeTruthy();
  });

  it('a stale parent is a conflict shown with where the bead is now, sent again only on Re-apply', async () => {
    const beads = [bead('p-e', { type: 'epic', title: 'Billing' }), bead('p-f', { type: 'epic', title: 'Payments' }), bead('p-g', { type: 'epic', title: 'Growth' }), bead('p-a', { parentId: 'p-e' })];
    const t = await opened(beads, 'p-a');
    const theirs = bead('p-a', { parentId: 'p-g', updatedAt: iso(MIN) });
    t.w.handlers.update = (call) =>
      t.routed('update').length === 1 ? json({ ok: false, conflict: true, current: theirs } satisfies WriteResult) : json({ ok: true, bead: { ...theirs, parentId: 'p-f', updatedAt: iso(0) } } satisfies WriteResult);
    await click(button('Parent: Billing'));
    await click(screen.getByRole('menuitemradio', { name: /Payments/ }));
    expect(screen.getByText('Changed while you were editing')).toBeTruthy();
    expect(screen.getByText('Now in Growth.')).toBeTruthy();
    await later(5_000);
    expect(t.routed('update')).toHaveLength(1);
    await click(button('Re-apply'));
    expect(t.routed('update')[1]?.body).toMatchObject({ expectedUpdatedAt: iso(MIN), patch: { parent: 'p-f' }, expected: { parentId: 'p-g' } });
  });
});

describe('due and defer dates', () => {
  const at = (ms: number) => new Date(NOW + ms).toISOString();
  const dates = () => document.querySelector<HTMLElement>('[data-section="more"] .bd-dates')!;
  const row = (kind: 'due' | 'defer') => document.querySelector<HTMLElement>(`[data-date="${kind}"]`)!;
  const preview = () => document.querySelector('.bd-date-preview')!.textContent;

  it('preview shows the parsed date in the local zone', async () => {
    await opened([bead('p-a')], 'p-a');
    expect(within(dates()).getByText('No due date')).toBeTruthy();
    await click(button('Set due date'));
    const box = textbox('Due date');
    expect(document.activeElement).toBe(box);
    await type(box, 'tomorrow');
    expect(preview()).toBe('Due Thu, Oct 15, 12:00 PM');
    await type(box, '2026-10-20');
    expect(preview()).toBe('Due Tue, Oct 20');
  });

  it('unknown input says Beads will read it on save', async () => {
    const t = await opened([bead('p-a')], 'p-a');
    t.w.handlers.update = () => json({ ok: true, bead: bead('p-a', { extra: { due_at: at(DAY - 3 * 3_600_000) }, updatedAt: iso(0) }) } satisfies WriteResult);
    await click(button('Set due date'));
    // A clock time, and a phrase the panel does not read: no date is claimed for either.
    await type(textbox('Due date'), '9:00');
    expect(preview()).toBe(BEADS_READS);
    await type(textbox('Due date'), 'end of next sprint');
    expect(preview()).toBe(BEADS_READS);
    await type(textbox('Due date'), '9:00');
    await click(button('Save'));
    // Sent as typed, with the due date as shown (none), and what Beads stored is what shows.
    expect(t.routed('update')[0]?.body).toEqual({ directory: '/p/a', id: 'p-a', expectedUpdatedAt: iso(DAY), patch: { due: '9:00' }, expected: { due: null } });
    expect(screen.queryByRole('textbox', { name: 'Due date' })).toBeNull();
    expect(row('due').textContent).toContain('Thu, Oct 15, 9:00 AM');
    expect(t.toast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Due Thu, Oct 15, 9:00 AM.' }));
    await later(50);
    expect(document.activeElement).toBe(button('Change due date'));
  });

  it('clearing a due date is a plain Clear, sent with the date as shown', async () => {
    const t = await opened([bead('p-a', { extra: { due_at: at(-DAY) } })], 'p-a');
    t.w.handlers.update = () => json({ ok: true, bead: bead('p-a', { updatedAt: iso(0) }) } satisfies WriteResult);
    // Past due on a bead not done says so.
    expect(row('due').textContent).toContain('Overdue');
    const clear = button('Clear due date');
    expect(clear.textContent).toBe('Clear');
    await click(clear);
    expect(t.routed('update')[0]?.body).toEqual({ directory: '/p/a', id: 'p-a', expectedUpdatedAt: iso(DAY), patch: { due: null }, expected: { due: at(-DAY) } });
    expect(row('due').textContent).toContain('No due date');
    await later(50);
    expect(document.activeElement).toBe(button('Set due date'));
  });

  it('a stale due date is a conflict, not an overwrite', async () => {
    const shown = bead('p-a', { extra: { due_at: at(2 * DAY) } });
    const t = await opened([shown], 'p-a');
    const theirs = { ...shown, extra: { due_at: at(5 * DAY) }, updatedAt: iso(MIN) };
    t.w.handlers.update = (call) =>
      t.routed('update').length === 1
        ? json({ ok: false, conflict: true, current: theirs } satisfies WriteResult)
        : json({ ok: true, bead: { ...theirs, extra: { due_at: at(3 * DAY) }, updatedAt: iso(0) } } satisfies WriteResult);
    await click(button('Change due date'));
    await type(textbox('Due date'), '+3d');
    await click(button('Save'));
    expect(t.routed('update')[0]?.body).toMatchObject({ patch: { due: '+3d' }, expected: { due: at(2 * DAY) } });
    const note = within(row('due')).getByRole('alert');
    expect(note.textContent).toContain('Changed while you were editing');
    expect(note.textContent).toContain('Now due Mon, Oct 19, 12:00 PM.');
    // What was typed stays; nothing is sent again until Re-apply.
    expect(textbox('Due date').value).toBe('+3d');
    await later(5_000);
    expect(t.routed('update')).toHaveLength(1);
    await click(within(row('due')).getByRole('button', { name: 'Re-apply' }));
    expect(t.routed('update')[1]?.body).toMatchObject({ expectedUpdatedAt: iso(MIN), patch: { due: '+3d' }, expected: { due: at(5 * DAY) } });
    expect(screen.queryByRole('textbox', { name: 'Due date' })).toBeNull();
  });

  it('a due date changed elsewhere while typing is a conflict before anything is sent', async () => {
    const t = await opened([bead('p-a', { extra: { due_at: at(2 * DAY) } })], 'p-a');
    await click(button('Change due date'));
    await type(textbox('Due date'), '+3d');
    // Another change to the bead that leaves the due date alone is followed quietly.
    t.w.db.beads = [bead('p-a', { title: 'Renamed', extra: { due_at: at(2 * DAY) }, updatedAt: iso(2 * MIN) })];
    t.w.db.cursor = 2;
    await later(2_000);
    expect(within(row('due')).queryByRole('alert')).toBeNull();
    t.w.db.beads = [bead('p-a', { title: 'Renamed', extra: { due_at: at(6 * DAY) }, updatedAt: iso(MIN) })];
    t.w.db.cursor = 3;
    await later(2_000);
    expect(within(row('due')).getByRole('alert').textContent).toContain('Now due Tue, Oct 20, 12:00 PM.');
    expect(t.routed('update')).toHaveLength(0);
  });

  it('defer with a date calls deferBead', async () => {
    const t = await opened([bead('p-a')], 'p-a');
    t.w.handlers.deferBead = () => json({ ok: true, bead: bead('p-a', { status: 'deferred', extra: { defer_until: at(5 * DAY) }, updatedAt: iso(0) }) } satisfies WriteResult);
    expect(within(row('defer')).getByText('Not deferred')).toBeTruthy();
    await click(button('Defer until a date'));
    await type(textbox('Defer until'), 'next monday');
    expect(preview()).toBe('Until Mon, Oct 19, 12:00 PM');
    await click(within(row('defer')).getByRole('button', { name: 'Defer' }));
    expect(t.routed('deferBead')[0]?.body).toEqual({ directory: '/p/a', id: 'p-a', expectedUpdatedAt: iso(DAY), until: 'next monday' });
    expect(t.routed('update')).toHaveLength(0);
    expect(row('defer').textContent).toContain('Until Mon, Oct 19, 12:00 PM');
    expect(t.toast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Deferred until Mon, Oct 19, 12:00 PM.' }));
  });

  it('indefinitely and undefer are separate actions', async () => {
    const t = await opened([bead('p-a')], 'p-a');
    t.w.handlers.deferBead = () => json({ ok: true, bead: bead('p-a', { status: 'deferred', updatedAt: iso(MIN) }) } satisfies WriteResult);
    t.w.handlers.undeferBead = () => json({ ok: true, bead: bead('p-a', { updatedAt: iso(0) }) } satisfies WriteResult);
    // Undefer is not offered for a bead that is not deferred.
    expect(within(row('defer')).queryByRole('button', { name: 'Undefer' })).toBeNull();
    await click(button('Defer indefinitely'));
    expect(t.routed('deferBead')[0]?.body).toEqual({ directory: '/p/a', id: 'p-a', expectedUpdatedAt: iso(DAY), until: null });
    expect(row('defer').textContent).toContain('Until someone brings it back');
    expect(within(row('defer')).queryByRole('button', { name: 'Defer indefinitely' })).toBeNull();
    await later(50);
    expect(document.activeElement).toBe(within(row('defer')).getAllByRole('button')[0]);
    await click(button('Undefer'));
    expect(t.routed('undeferBead')[0]?.body).toEqual({ directory: '/p/a', id: 'p-a', expectedUpdatedAt: iso(MIN) });
    expect(row('defer').textContent).toContain('Not deferred');
    expect(t.routed('update')).toHaveLength(0);
  });

  it('a defer that met a newer bead shows it and sends again only on Re-apply', async () => {
    const shown = bead('p-a');
    const t = await opened([shown], 'p-a');
    const theirs = { ...shown, status: 'deferred', extra: { defer_until: at(9 * DAY) }, updatedAt: iso(MIN) };
    t.w.handlers.deferBead = () => (t.routed('deferBead').length === 1 ? json({ ok: false, conflict: true, current: theirs } satisfies WriteResult) : json({ ok: true, bead: { ...theirs, extra: {}, updatedAt: iso(0) } } satisfies WriteResult));
    await click(button('Defer indefinitely'));
    const note = within(row('defer')).getByRole('alert');
    expect(note.textContent).toContain('Now deferred until Fri, Oct 23, 12:00 PM.');
    await click(within(row('defer')).getByRole('button', { name: 'Re-apply' }));
    expect(t.routed('deferBead')[1]?.body).toMatchObject({ expectedUpdatedAt: iso(MIN), until: null });
  });

  it('asks before typed text goes, and keeps it on Keep editing', async () => {
    await opened([bead('p-a')], 'p-a');
    await click(button('Set due date'));
    await type(textbox('Due date'), 'next friday');
    await click(within(row('due')).getByRole('button', { name: 'Cancel' }));
    expect(within(row('due')).getByRole('alertdialog', { name: 'Discard your changes?' })).toBeTruthy();
    await click(button('Keep editing'));
    expect(textbox('Due date').value).toBe('next friday');
    await key(textbox('Due date'), 'Escape');
    await click(within(row('due')).getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('textbox', { name: 'Due date' })).toBeNull();
    await later(50);
    expect(document.activeElement).toBe(button('Set due date'));
    // Nothing typed: Cancel just closes.
    await click(button('Set due date'));
    await key(textbox('Due date'), 'Escape');
    expect(screen.queryByRole('textbox', { name: 'Due date' })).toBeNull();
  });

  it('leaving the bead with a typed date asks first', async () => {
    const t = await opened([bead('p-a'), bead('p-b')], 'p-a');
    await click(button('Defer until a date'));
    await type(textbox('Defer until'), '+2d');
    await click(button('Back'));
    expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeTruthy();
    expect(store(t).detail).not.toBeNull();
  });

  it('holds the box read-only while saving, with only that row busy', async () => {
    const t = await opened([bead('p-a')], 'p-a');
    const pending = deferred<Answer>();
    t.w.handlers.update = () => pending.promise;
    await click(button('Set due date'));
    await type(textbox('Due date'), '+2d');
    await click(button('Save'));
    expect(textbox('Due date').readOnly).toBe(true);
    expect(within(row('due')).getByRole('button', { name: 'Saving…' })).toBeTruthy();
    expect((button('Defer indefinitely') as HTMLButtonElement).disabled).toBe(false);
    await run(() => pending.resolve(json({ ok: true, bead: bead('p-a', { extra: { due_at: at(2 * DAY) }, updatedAt: iso(0) }) } satisfies WriteResult)));
    expect(screen.queryByRole('textbox', { name: 'Due date' })).toBeNull();
  });

  it('offers no snooze for a finished bead', async () => {
    await opened([bead('p-a', { status: 'closed', closedAt: iso(DAY), extra: { due_at: at(-DAY) } })], 'p-a');
    expect(document.querySelector('[data-date="defer"]')).toBeNull();
    expect(row('due').textContent).not.toContain('Overdue');
  });

  it('a refusal shows in plain words with a gate worded as a review', async () => {
    const gate = { id: 'p-gate1', kind: 'human' as const, reason: null, blocks: ['p-a'], createdBy: 'Bob', createdAt: iso(DAY), timeoutMs: null, planApproval: false };
    const t = await opened([bead('p-a', { status: 'deferred' })], 'p-a', () => ({ gates: [gate], gateIds: ['p-gate1'] }));
    t.w.handlers.undeferBead = () => envelope(409, { code: 'blocked', message: "This bead can't be closed yet. It is still waiting on a review." });
    await click(button('Undefer'));
    const alert = within(row('defer')).getByRole('alert');
    expect(alert.textContent).toContain('Resolve the review first.');
    expect(alert.textContent).not.toMatch(/p-gate1|\bgate\b/);
  });
});

describe('date actions sent once', () => {
  it('two presses of Undefer in one frame send one undefer', async () => {
    const t = await opened([bead('p-a', { status: 'deferred' })], 'p-a');
    const pending = deferred<Answer>();
    t.w.handlers.undeferBead = () => pending.promise;
    await run(() => {
      const undo = button('Undefer');
      fireEvent.click(undo);
      fireEvent.click(undo);
    });
    expect(t.routed('undeferBead')).toHaveLength(1);
    await run(() => pending.resolve(json({ ok: true, bead: bead('p-a', { updatedAt: iso(0) }) } satisfies WriteResult)));
  });
});

describe('date rows, fix round 1', () => {
  const at = (ms: number) => new Date(NOW + ms).toISOString();
  const row = (kind: 'due' | 'defer') => document.querySelector<HTMLElement>(`[data-date="${kind}"]`)!;

  it('holds the typed date while a conflict shows, so Re-apply sends what the preview says', async () => {
    const shown = bead('p-a', { extra: { due_at: at(2 * DAY) } });
    const t = await opened([shown], 'p-a');
    const theirs = { ...shown, extra: { due_at: at(5 * DAY) }, updatedAt: iso(MIN) };
    t.w.handlers.update = () => (t.routed('update').length === 1 ? json({ ok: false, conflict: true, current: theirs } satisfies WriteResult) : json({ ok: true, bead: { ...theirs, updatedAt: iso(0) } } satisfies WriteResult));
    await click(button('Change due date'));
    await type(textbox('Due date'), '+3d');
    await click(button('Save'));
    expect(textbox('Due date').readOnly).toBe(true);
    const preview = document.querySelector('.bd-date-preview')!.textContent;
    expect(preview).toBe('Due Sat, Oct 17, 12:00 PM');
    await click(within(row('due')).getByRole('button', { name: 'Re-apply' }));
    expect(t.routed('update')[1]?.body).toMatchObject({ patch: { due: '+3d' } });
  });

  it('a conflict found while typing also holds the box', async () => {
    const t = await opened([bead('p-a', { extra: { due_at: at(2 * DAY) } })], 'p-a');
    await click(button('Change due date'));
    await type(textbox('Due date'), '+3d');
    t.w.db.beads = [bead('p-a', { extra: { due_at: at(6 * DAY) }, updatedAt: iso(MIN) })];
    t.w.db.cursor = 2;
    await later(2_000);
    expect(within(row('due')).getByRole('alert')).toBeTruthy();
    expect(textbox('Due date').readOnly).toBe(true);
  });

  it('Escape after a date action goes back to the list', async () => {
    const t = await opened([bead('p-a', { extra: { due_at: at(-DAY) } })], 'p-a');
    t.w.handlers.update = () => json({ ok: true, bead: bead('p-a', { updatedAt: iso(0) }) } satisfies WriteResult);
    await click(button('Clear due date'));
    await later(50);
    expect(row('due').contains(document.activeElement)).toBe(true);
    await key(document.activeElement!, 'Escape');
    expect(document.querySelector('[data-date="due"]')).toBeNull();
    expect(store(t).detail).toBeNull();
  });

  it('a refused one-click date action leaves focus on the note, never Re-apply, and says when only something else changed', async () => {
    const shown = bead('p-a', { status: 'deferred' });
    const t = await opened([shown], 'p-a');
    // A comment or title changed: the defer state is as shown.
    t.w.handlers.undeferBead = () => json({ ok: false, conflict: true, current: { ...shown, title: 'Renamed', updatedAt: iso(MIN) } } satisfies WriteResult);
    await click(button('Undefer'));
    await later(50);
    const note = within(row('defer')).getByRole('alert');
    expect(note.textContent).toContain('Something else on this bead changed; this date did not.');
    const focused = document.activeElement as HTMLElement;
    expect(focused).toBe(note);
    // A double Enter presses nothing, so the older date is not written over the newer one.
    const sent = () => t.routed('undeferBead').length;
    const before = sent();
    for (let i = 0; i < 2; i++) {
      fireEvent.keyDown(focused, { key: 'Enter' });
      if (focused.tagName === 'BUTTON') fireEvent.click(focused);
    }
    await later(50);
    expect(sent()).toBe(before);
  });
});

describe('names hold what is shown', () => {
  const at = (ms: number) => new Date(NOW + ms).toISOString();
  const named = (el: HTMLElement) => el.getAttribute('aria-label') ?? el.textContent ?? '';
  const visible = (el: HTMLElement) => (el.textContent ?? '').replace('…', '').trim();

  it('every date, type and parent control is named with its visible words first', async () => {
    const t = await opened([bead('p-e', { type: 'epic', title: 'Billing' }), bead('p-a', { status: 'deferred' }), bead('p-b', { parentId: 'p-e', extra: { due_at: at(DAY) } }), bead('p-c')], 'p-a');
    const check = () => {
      const controls = Array.from(document.querySelectorAll<HTMLElement>('.bd-datebtn, .bd-didrow .bd-chipbtn'));
      expect(controls.length).toBeGreaterThan(3);
      for (const el of controls) expect(named(el).toLowerCase()).toContain(visible(el).toLowerCase());
    };
    check();
    expect(button('Set a date to defer until')).toBeTruthy();
    expect(button('Parent: No parent')).toBeTruthy();
    for (const id of ['p-b', 'p-c']) {
      await run(() => t.store.select(id));
      check();
    }
    expect(button('Set due date').textContent).toBe('Set due date');
  });

  it('a parent that is not an epic is not shown as one', async () => {
    const beads = [bead('p-t', { title: 'Parent task' }), bead('p-a', { parentId: 'p-t' }), bead('p-e', { type: 'epic', title: 'Billing' })];
    await opened(beads, 'p-a');
    const trigger = button('Parent: Parent task');
    expect(trigger.getAttribute('title')).toBe('Move to an epic');
    // Only the chevron: no epic mark beside a task.
    expect(trigger.querySelectorAll('svg')).toHaveLength(1);
    await click(trigger);
    expect(within(screen.getByRole('menu')).getAllByRole('menuitemradio').filter((m) => m.getAttribute('aria-checked') === 'true')).toHaveLength(0);
  });

  it('says so inside the menu when there is no other epic, as an item that cannot be chosen', async () => {
    await opened([bead('p-a')], 'p-a');
    await click(button('Parent: No parent'));
    const note = within(screen.getByRole('menu')).getByRole('menuitem', { name: 'No other open epics in this project.' }) as HTMLButtonElement;
    expect(note.disabled).toBe(true);
    expect(screen.getByRole('menu').querySelector('p')).toBeNull();
  });
});

describe('undefer for any date still ahead', () => {
  const at = (ms: number) => new Date(NOW + ms).toISOString();
  const row = () => document.querySelector<HTMLElement>('[data-date="defer"]')!;

  it('an open bead that still carries a future date offers Undefer, and it calls undeferBead', async () => {
    const t = await opened([bead('p-a', { extra: { defer_until: at(3 * DAY) } })], 'p-a');
    t.w.handlers.undeferBead = () => json({ ok: true, bead: bead('p-a', { updatedAt: iso(0) }) } satisfies WriteResult);
    expect(row().textContent).toContain('Until Sat, Oct 17, 12:00 PM');
    expect(within(row()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Change', 'Defer indefinitely', 'Undefer']);
    await click(within(row()).getByRole('button', { name: 'Undefer' }));
    expect(t.routed('undeferBead')[0]?.body).toEqual({ directory: '/p/a', id: 'p-a', expectedUpdatedAt: iso(DAY) });
    expect(row().textContent).toContain('Not deferred');
  });

  it('a bead deferred until a date can be deferred indefinitely in one step', async () => {
    await opened([bead('p-a', { status: 'deferred', extra: { defer_until: at(3 * DAY) } })], 'p-a');
    expect(within(row()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Change', 'Defer indefinitely', 'Undefer']);
  });

  it('a date that already came due on an open bead is not shown as deferred', async () => {
    await opened([bead('p-a', { extra: { defer_until: at(-DAY) } })], 'p-a');
    expect(row().textContent).toContain('Not deferred');
    expect(within(row()).queryByRole('button', { name: 'Undefer' })).toBeNull();
  });
});

describe('date preview in the person\'s zone', () => {
  it('shows the parsed date in the local zone, not UTC', async () => {
    const zone = process.env.TZ;
    process.env.TZ = 'America/Chicago';
    try {
      await opened([bead('p-a')], 'p-a');
      await click(button('Set due date'));
      await type(textbox('Due date'), 'tomorrow');
      // 12:00 UTC is 7:00 in Chicago (daylight time in October).
      expect(document.querySelector('.bd-date-preview')!.textContent).toBe('Due Thu, Oct 15, 7:00 AM');
      await type(textbox('Due date'), '2026-10-20');
      expect(document.querySelector('.bd-date-preview')!.textContent).toBe('Due Tue, Oct 20');
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
});

// ------------------------------------------------------------------------------------------------- task 16

describe('comment and close', () => {
  const COMMENT_REFUSED = "Your comment was added, but the bead could not be closed. This bead can't be closed yet. It has sub-tasks that are not closed yet: p-c. Close those first.";
  async function closing(answer: (call: Call) => Answer) {
    const t = await opened([bead('p-a', { status: 'in_progress' })], 'p-a');
    t.w.handlers.update = answer;
    await click(button('Status: In progress'));
    await click(screen.getByRole('menuitemradio', { name: 'Closed' }));
    await type(textbox('Close reason (optional)'), 'Done');
    await type(textbox('Comment (optional)'), 'All merged.');
    return t;
  }
  const reopen = async () => {
    await click(button('Status: In progress'));
    await click(screen.getByRole('menuitemradio', { name: 'Closed' }));
  };

  it('close dialog sends closeComment', async () => {
    const t = await closing((call) => json({ ok: true, bead: bead('p-a', { status: (call.body.patch as { status: string }).status, updatedAt: iso(0) }) } satisfies WriteResult));
    await click(button('Mark closed'));
    expect(t.routed('update').map((c) => c.body)).toEqual([
      { directory: '/p/a', id: 'p-a', expectedUpdatedAt: iso(DAY), patch: { status: 'closed', closeReason: 'Done', closeComment: 'All merged.' }, expected: { status: 'in_progress' } },
    ]);
    expect(button('Status: Closed')).toBeTruthy();
  });

  it('Cmd/Ctrl+Enter in the comment closes; plain Enter is a new line', async () => {
    const t = await closing((call) => json({ ok: true, bead: bead('p-a', { status: (call.body.patch as { status: string }).status, updatedAt: iso(0) }) } satisfies WriteResult));
    await key(textbox('Comment (optional)'), 'Enter');
    expect(t.routed('update')).toHaveLength(0);
    await key(textbox('Comment (optional)'), 'Enter', { metaKey: true });
    expect(t.routed('update')).toHaveLength(1);
  });

  it('comment added but close refused is shown as such', async () => {
    const t = await closing(() => envelope(409, { code: 'blocked', message: COMMENT_REFUSED }));
    await click(button('Mark closed'));
    expect(t.routed('update')).toHaveLength(1);
    expect(screen.getByText(COMMENT_REFUSED)).toBeTruthy();
    // The comment is in: it is not offered again. The reason, which did not go anywhere, is.
    await reopen();
    expect(textbox('Comment (optional)').value).toBe('');
    expect((textbox('Close reason (optional)') as unknown as HTMLInputElement).value).toBe('Done');
  });

  it('a comment typed after a "comment was added" refusal survives leaving the bead and coming back', async () => {
    const t = await opened([bead('p-a', { status: 'in_progress' }), bead('p-b')], 'p-a');
    t.w.handlers.update = () => envelope(409, { code: 'blocked', message: COMMENT_REFUSED });
    await click(button('Status: In progress'));
    await click(screen.getByRole('menuitemradio', { name: 'Closed' }));
    await type(textbox('Comment (optional)'), 'All merged.');
    await click(button('Mark closed'));
    expect(screen.getByText(COMMENT_REFUSED)).toBeTruthy();
    await reopen();
    await type(textbox('Comment (optional)'), 'A second thought.');
    // Away and back: the old answer shows again, and must not take the new comment with it.
    await run(() => t.store.select('p-b'));
    await run(() => t.store.select('p-a'));
    if (!screen.queryByRole('textbox', { name: 'Comment (optional)' })) await reopen();
    expect(textbox('Comment (optional)').value).toBe('A second thought.');
  });

  it('a refused close that added nothing keeps the comment', async () => {
    await closing(() => envelope(503, { code: 'busy', message: 'Beads is busy. Nothing was saved. Try again in a moment.' }));
    await click(button('Mark closed'));
    expect(screen.getByText('Beads is busy. Nothing was saved. Try again in a moment.')).toBeTruthy();
    await reopen();
    expect(textbox('Comment (optional)').value).toBe('All merged.');
  });

  /** The comment goes in, the close does not answer: what the service does when `bd close` times out after the comment. */
  const commentLands = (t: Awaited<ReturnType<typeof opened>>) => {
    const b = t.w.db.beads[0]!;
    t.w.db.beads = [{ ...b, comments: [...b.comments, { id: `c${b.comments.length + 1}`, author: 'Ann (panel)', text: 'All merged.', createdAt: iso(0) }] }];
    t.w.db.cursor++;
  };
  const closed = (t: Awaited<ReturnType<typeof opened>>) => json({ ok: true, bead: { ...t.w.db.beads[0]!, status: 'closed', updatedAt: iso(0) } } satisfies WriteResult);

  it('an uncertain close whose comment went in: Try again closes without posting the comment again', async () => {
    let t!: Awaited<ReturnType<typeof opened>>;
    t = await closing(() => {
      if (t.routed('update').length > 1) return closed(t);
      commentLands(t);
      return json({ ok: false, uncertain: true, current: null } satisfies WriteResult);
    });
    await click(button('Mark closed'));
    await later(2_000);
    expect(screen.getByText('It did not save.')).toBeTruthy();
    await click(button('Try again'));
    const sent = t.routed('update').map((c) => c.body.patch);
    expect(sent[0]).toEqual({ status: 'closed', closeReason: 'Done', closeComment: 'All merged.' });
    expect(sent[1]).toEqual({ status: 'closed', closeReason: 'Done' });
  });

  it('after an uncertain close whose comment went in, the dialog no longer holds the comment and sends none', async () => {
    let t!: Awaited<ReturnType<typeof opened>>;
    t = await closing(() => {
      if (t.routed('update').length > 1) return closed(t);
      commentLands(t);
      return json({ ok: false, uncertain: true, current: null } satisfies WriteResult);
    });
    await click(button('Mark closed'));
    await later(2_000);
    await reopen();
    expect(textbox('Comment (optional)').value).toBe('');
    await click(button('Mark closed'));
    expect(t.routed('update')[1]?.body.patch).toEqual({ status: 'closed', closeReason: 'Done' });
  });

  it('an uncertain close whose comment did not go in sends it again, once the project was read', async () => {
    let t!: Awaited<ReturnType<typeof opened>>;
    t = await closing(() => (t.routed('update').length > 1 ? closed(t) : json({ ok: false, uncertain: true, current: null } satisfies WriteResult)));
    await click(button('Mark closed'));
    // Before the project is read again nobody knows whether it went in: the dialog waits rather than guess.
    await reopen();
    expect(button('Mark closed').getAttribute('aria-disabled')).toBe('true');
    await key(textbox('Close reason (optional)'), 'Enter');
    expect(t.routed('update')).toHaveLength(1);
    await later(2_000);
    expect(textbox('Comment (optional)').value).toBe('All merged.');
    await click(button('Mark closed'));
    expect(t.routed('update')[1]?.body.patch).toEqual({ status: 'closed', closeReason: 'Done', closeComment: 'All merged.' });
  });

  for (const retried of ['uncertain', 'comment added'] as const) {
    it(`Try again that answers ${retried}, then the dialog reopened before the next read: no second comment`, async () => {
      let t!: Awaited<ReturnType<typeof opened>>;
      /** The reads after Try again (the list's and the bead's own), held so the dialog is reopened before they land. */
      const held = deferred<void>();
      t = await closing(() => {
        const n = t.routed('update').length;
        if (n === 1) return json({ ok: false, uncertain: true, current: null } satisfies WriteResult);
        if (n === 2) {
          commentLands(t);
          const base = t.w.answer;
          t.w.handlers.snapshot = (call) => held.promise.then(() => base(call));
          t.w.handlers.bead = (call) => held.promise.then(() => base(call));
          return retried === 'uncertain'
            ? json({ ok: false, uncertain: true, current: null } satisfies WriteResult)
            : envelope(409, { code: 'blocked', message: "Your comment was added, but the bead could not be closed. This bead can't be closed yet. It is still blocked by p-b. Close those first." });
        }
        return closed(t);
      });
      await click(button('Mark closed'));
      await later(2_000);
      await click(button('Try again'));
      expect(t.routed('update')[1]?.body.patch).toEqual({ status: 'closed', closeReason: 'Done', closeComment: 'All merged.' });
      await reopen();
      const release = async () => {
        delete t.w.handlers.snapshot;
        delete t.w.handlers.bead;
        await run(() => held.resolve());
        await later(2_000);
      };
      if (retried === 'uncertain') {
        // Not known yet whether it went in: nothing is sent until the project is read, which then shows the comment.
        expect(button('Mark closed').getAttribute('aria-disabled')).toBe('true');
        await click(button('Mark closed'));
        expect(t.routed('update')).toHaveLength(2);
        await release();
      }
      // A comment added before a refused close is in at once, before any read.
      expect(textbox('Comment (optional)').value).toBe('');
      await click(button('Mark closed'));
      expect(t.routed('update')[2]?.body.patch).toEqual({ status: 'closed', closeReason: 'Done' });
      if (retried !== 'uncertain') await release();
    });
  }

  it('a bead closed elsewhere while the dialog is open keeps what is being typed', async () => {
    const t = await closing(() => json({}));
    t.w.db.beads = [{ ...t.w.db.beads[0]!, status: 'closed', closedAt: iso(0), updatedAt: iso(0) }];
    t.w.db.cursor++;
    await later(2_000);
    expect(textbox('Comment (optional)').value).toBe('All merged.');
  });

  it('Cancel asks before letting typed text go', async () => {
    const t = await closing(() => json({}));
    await click(button('Cancel'));
    const ask = screen.getByRole('alertdialog', { name: 'Discard what you typed?' });
    await click(within(ask).getByRole('button', { name: 'Keep editing' }));
    expect(textbox('Comment (optional)').value).toBe('All merged.');
    await click(button('Cancel'));
    await click(within(screen.getByRole('alertdialog', { name: 'Discard what you typed?' })).getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('textbox', { name: 'Comment (optional)' })).toBeNull();
    await reopen();
    expect(textbox('Comment (optional)').value).toBe('');
    expect(t.routed('update')).toHaveLength(0);
  });
});
