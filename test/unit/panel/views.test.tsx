// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { createClient } from '../../../src/panel/client';
import { createStore, DEFAULT_COLLAPSED, DEFAULT_FILTERS, filtersActive, projectKey, StoreContext, uiKey, type Filters, type Store } from '../../../src/panel/store';
import { KEEP_MS } from '../../../src/panel/needs';
import { BEADS_READS, DateInput } from '../../../src/panel/ui/DateInput';
import { epicView, humanize, matchesWithAll, rowOrder, shortId, statusLabel, statusLook, statusView, totals, type ListInput } from '../../../src/panel/list';
import { listKey, type KeyFocus } from '../../../src/panel/keyboard';
import { ago, shortAgo } from '../../../src/panel/format';
import { App } from '../../../src/panel/ui/App';
import type { Bead, ChangeEvent, Gate, StatusDef } from '../../../src/shared/types';
import { deferred, envelope, fakeHost, flush, freshness, json, snapshot, type Answer, type Call } from './helpers';

const NOW = new Date('2026-10-14T12:00:00Z').getTime();
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
  { name: 'pinned', category: 'frozen', icon: null },
  { name: 'qa_wait', category: 'active', icon: null },
  { name: 'in_review', category: 'wip', icon: null },
  { name: 'shipped', category: 'done', icon: null },
];

/** Every open bead is ready unless a test says otherwise. */
const openIds = (beads: Bead[]) => beads.filter((b) => b.status === 'open').map((b) => b.id);

function input(beads: Bead[], over: Partial<ListInput> = {}): ListInput {
  return { beads, statuses: STATUSES, readyIds: openIds(beads), unseenIds: [], filters: DEFAULT_FILTERS, query: '', collapsed: [...DEFAULT_COLLAPSED], expanded: [], now: NOW, ...over };
}

const EPIC_BEADS = [
  bead('p-e1', { type: 'epic', priority: 1, title: 'Offline playback' }),
  bead('p-e1.1', { parentId: 'p-e1', status: 'closed', closedAt: iso(DAY) }),
  bead('p-e1.2', { parentId: 'p-e1', status: 'in_progress' }),
  bead('p-e1.3', { parentId: 'p-e1', status: 'blocked' }),
  bead('p-e1.3.1', { parentId: 'p-e1.3' }),
  bead('p-e1.4', { parentId: 'p-e1', status: 'closed', closedAt: iso(30 * DAY) }),
  bead('p-e2', { type: 'epic', priority: 2, title: 'Waveform' }),
  bead('p-o2', { priority: 4 }),
  bead('p-o1', { priority: 0 }),
];

describe('list helpers', () => {
  it('shortens ids by dropping the project prefix', () => {
    expect(shortId('demo-k3f2.4')).toBe('k3f2.4');
    expect(shortId('scr-8nw')).toBe('8nw');
    expect(shortId('my-proj-x1.2')).toBe('x1.2');
    expect(shortId('plain')).toBe('plain');
  });

  it('maps statuses to looks by category, with a neutral fallback for unknown ones', () => {
    const look = (s: string) => statusLook(s, STATUSES);
    expect(['open', 'in_progress', 'blocked', 'deferred', 'closed'].map(look)).toEqual(['open', 'progress', 'blocked', 'deferred', 'done']);
    expect(['qa_wait', 'in_review', 'pinned', 'shipped'].map(look)).toEqual(['open', 'progress', 'deferred', 'done']);
    expect(look('mystery')).toBe('other');
  });

  it('writes short relative times', () => {
    expect([0, 59_000, 4 * 60_000, 3 * 3_600_000, 2 * DAY, 15 * DAY].map(shortAgo)).toEqual(['now', 'now', '4m', '3h', '2d', '2w']);
  });

  it('totals open, in progress, blocked and closed this week over every bead', () => {
    expect(totals(input(EPIC_BEADS))).toEqual({ open: 7, inProgress: 1, blocked: 1, closedThisWeek: 1 });
  });

  it('says "just now" for freshness under 5 s', () => {
    expect([0, 4_999, 5_000].map(ago)).toEqual(['just now', 'just now', '5s ago']);
  });

  it('humanizes custom statuses and keeps unknown ones raw', () => {
    expect(['in_review', 'qa_wait', 'needs-design'].map(humanize)).toEqual(['In review', 'QA wait', 'Needs design']);
    expect(statusLabel('in_review', STATUSES)).toBe('In review');
    expect(statusLabel('pinned', STATUSES)).toBe('Pinned');
    expect(statusLabel('mystery', STATUSES)).toBe('mystery');
  });
});

describe('epic view', () => {
  it('nests children under epics with short hierarchical ids, and puts orphans last', () => {
    const groups = epicView(input(EPIC_BEADS));
    expect(groups.map((g) => g.key)).toEqual(['epic:p-e1', 'epic:p-e2', 'epic:none']);
    const [e1, e2, orphans] = groups;
    expect(e1.rows.map((r) => [r.id, r.depth])).toEqual([
      ['.1', 1],
      ['.2', 1],
      ['.3', 1],
      ['.3.1', 2],
    ]);
    expect(e2.rows).toEqual([]);
    expect(orphans.epic).toBeNull();
    expect(orphans.rows.map((r) => [r.id, r.depth])).toEqual([
      ['o1', 0],
      ['o2', 0],
    ]);
  });

  it('counts done, in progress and blocked over every descendant, even ones the filter hides', () => {
    const [e1, e2] = epicView(input(EPIC_BEADS));
    expect(e1.progress).toEqual({ total: 5, done: 2, inProgress: 1, blocked: 1 });
    expect(e2.progress).toEqual({ total: 0, done: 0, inProgress: 0, blocked: 0 });
  });

  it('shows everything closed, however old, under the "all" status filter', () => {
    const [e1] = epicView(input(EPIC_BEADS, { filters: { ...DEFAULT_FILTERS, status: 'all' } }));
    expect(e1.rows.map((r) => r.id)).toEqual(['.1', '.2', '.3', '.3.1', '.4']);
  });

  it('hides a collapsed epic\'s rows, but opens every group while searching', () => {
    const collapsed = [...DEFAULT_COLLAPSED, 'epic:p-e1'];
    expect(epicView(input(EPIC_BEADS, { collapsed }))[0]).toMatchObject({ collapsed: true, rows: [] });
    const searched = epicView(input(EPIC_BEADS, { collapsed, query: 'E1.3.1' }));
    expect(searched.map((g) => g.key)).toEqual(['epic:p-e1']);
    // The match keeps its parent as dimmed context.
    expect(searched[0].rows.map((r) => [r.id, r.context])).toEqual([
      ['.3', true],
      ['.3.1', false],
    ]);
  });

  it('flags unseen rows and counts changes per epic', () => {
    const [e1] = epicView(input(EPIC_BEADS, { unseenIds: ['p-e1.2', 'p-e1.3.1'] }));
    expect(e1.rows.filter((r) => r.unseen).map((r) => r.id)).toEqual(['.2', '.3.1']);
    expect(e1.changed).toBe(2);
  });

  it('orders keyboard movement through epics and their visible rows', () => {
    const groups = epicView(input(EPIC_BEADS, { collapsed: ['epic:p-e2'] }));
    expect(rowOrder(groups)).toEqual(['p-e1', 'p-e1.1', 'p-e1.2', 'p-e1.3', 'p-e1.3.1', 'p-e2', 'p-o1', 'p-o2']);
  });
});

const STATUS_BEADS = [
  bead('p-r2', { priority: 3 }),
  bead('p-r1', { priority: 0 }),
  bead('p-wait', { title: 'Waiting on another bead' }),
  bead('p-ip', { status: 'in_progress', parentId: 'p-ep' }),
  bead('p-ep', { type: 'epic', title: 'Offline playback' }),
  bead('p-bl', { status: 'blocked' }),
  bead('p-df', { status: 'deferred' }),
  bead('p-cl', { status: 'closed', closedAt: iso(2 * DAY) }),
  bead('p-old', { status: 'closed', closedAt: iso(20 * DAY) }),
  bead('p-mys', { status: 'mystery' }),
  bead('p-qa', { status: 'qa_wait' }),
  bead('p-rv', { status: 'in_review' }),
];
const READY = ['p-r1', 'p-r2', 'p-ep'];

describe('status view', () => {
  it('orders built-in sections, then custom statuses by category, unknown last', () => {
    const sections = statusView(input(STATUS_BEADS, { readyIds: READY }));
    expect(sections.map((s) => [s.title, s.look])).toEqual([
      ['In progress', 'progress'],
      ['Blocked', 'blocked'],
      ['Ready', 'open'],
      ['Deferred', 'deferred'],
      ['Closed (last 7 days)', 'done'],
      ['In review', 'progress'],
      ['QA wait', 'open'],
      ['mystery', 'other'],
    ]);
  });

  it('puts open beads that are not ready under Blocked, sorts by priority, and tags the epic', () => {
    const sections = statusView(input(STATUS_BEADS, { readyIds: READY, collapsed: [] }));
    const byTitle = Object.fromEntries(sections.map((s) => [s.title, s]));
    expect(byTitle.Blocked.rows.map((r) => r.bead.id)).toEqual(['p-bl', 'p-wait']);
    expect(byTitle.Ready.rows.map((r) => r.bead.id)).toEqual(['p-r1', 'p-ep', 'p-r2']);
    expect(byTitle['In progress'].rows[0].epic?.title).toBe('Offline playback');
    expect(byTitle['Closed (last 7 days)'].rows.map((r) => r.bead.id)).toEqual(['p-cl']);
  });

  it('starts Deferred and Closed collapsed, with their counts', () => {
    const sections = statusView(input(STATUS_BEADS, { readyIds: READY }));
    const closed = sections.find((s) => s.key === 'status:closed')!;
    expect(closed).toMatchObject({ collapsed: true, count: 1, rows: [] });
    expect(sections.find((s) => s.key === 'status:deferred')).toMatchObject({ collapsed: true, count: 1 });
  });

  it('caps long sections with "show more" until expanded', () => {
    const many = Array.from({ length: 10 }, (_, i) => bead(`p-m${i}`));
    const ids = many.map((b) => b.id);
    const capped = statusView(input(many, { readyIds: ids }))[0];
    expect(capped).toMatchObject({ count: 10, more: 4 });
    expect(capped.rows).toHaveLength(6);
    const open = statusView(input(many, { readyIds: ids, expanded: ['status:ready'] }))[0];
    expect(open).toMatchObject({ more: 0 });
    expect(open.rows).toHaveLength(10);
  });

  it('shows all closed beads under the "all" filter', () => {
    const sections = statusView(input(STATUS_BEADS, { readyIds: READY, filters: { ...DEFAULT_FILTERS, status: 'all' }, collapsed: [] }));
    expect(sections.find((s) => s.key === 'status:closed')).toMatchObject({ title: 'Closed', count: 2 });
  });
});

describe('filters and search', () => {
  const beads = [
    bead('p-a', { assignee: 'Bob Builder', priority: 0, title: 'Crash on login' }),
    bead('p-b', { assignee: null, priority: 1 }),
    bead('p-c', { assignee: 'Alice', priority: 2, status: 'in_progress' }),
    bead('p-d', { status: 'closed', closedAt: iso(DAY), priority: 3 }),
  ];
  const ids = (f: Partial<Filters>, query = '') =>
    statusView(input(beads, { readyIds: ['p-a', 'p-b'], filters: { ...DEFAULT_FILTERS, ...f }, query, collapsed: [] })).flatMap((s) => s.rows.map((r) => r.bead.id));

  it('filters by assignee', () => {
    expect(ids({ assignee: 'unassigned' })).toEqual(['p-b', 'p-d']);
    expect(ids({ assignee: { name: 'Alice' } })).toEqual(['p-c']);
  });

  it('filters by priority, Ready, and exact statuses', () => {
    expect(ids({ priorities: [0, 2] })).toEqual(['p-c', 'p-a']);
    expect(ids({ ready: true })).toEqual(['p-a', 'p-b']);
    expect(ids({ status: { only: ['in_progress', 'closed'] } })).toEqual(['p-c', 'p-d']);
  });

  it('overdue and due-this-week filter', () => {
    const at = (ms: number) => new Date(NOW + ms).toISOString();
    const dated = [
      bead('p-a', { extra: { due_at: at(-DAY) } }),
      bead('p-b', { extra: { due_at: at(2 * DAY) }, status: 'in_progress' }),
      bead('p-c', { extra: { due_at: at(9 * DAY) } }),
      // Done beads are never overdue or coming due, whatever their date says.
      bead('p-d', { extra: { due_at: at(-2 * DAY) }, status: 'closed', closedAt: iso(DAY) }),
      bead('p-e', { extra: { due_at: at(DAY) }, status: 'shipped', closedAt: iso(DAY) }),
      bead('p-f'),
      bead('p-g', { extra: { due_at: at(7 * DAY) } }),
      // A date Beads stored that cannot be read is not counted either way.
      bead('p-h', { extra: { due_at: 'soon' } }),
    ];
    const due = (filter: Filters['due']) =>
      statusView(input(dated, { filters: { ...DEFAULT_FILTERS, due: filter }, collapsed: [] }))
        .flatMap((s) => s.rows.map((r) => r.bead.id))
        .sort();
    expect(due('overdue')).toEqual(['p-a']);
    expect(due('week')).toEqual(['p-b', 'p-g']);
    expect(due('any')).toEqual(['p-a', 'p-b', 'p-c', 'p-d', 'p-e', 'p-f', 'p-g', 'p-h']);
    expect(filtersActive({ ...DEFAULT_FILTERS, due: 'week' })).toBe(true);
    expect(filtersActive(DEFAULT_FILTERS)).toBe(false);
  });

  it('searches ids and titles, ignoring case', () => {
    expect(ids({}, 'crash')).toEqual(['p-a']);
    expect(ids({}, 'P-C')).toEqual(['p-c']);
    expect(ids({}, 'nothing like this')).toEqual([]);
  });
});

describe('one meaning of blocked and in progress', () => {
  const future = new Date(NOW + 3 * DAY).toISOString();
  const beads = [
    bead('p-e', { type: 'epic' }),
    bead('p-e.1', { parentId: 'p-e', status: 'blocked' }),
    bead('p-e.2', { parentId: 'p-e', title: 'Waiting' }),
    bead('p-e.3', { parentId: 'p-e', extra: { defer_until: future } }),
    bead('p-e.4', { parentId: 'p-e', status: 'in_progress' }),
    bead('p-e.5', { parentId: 'p-e', status: 'in_review' }),
    bead('p-e.6', { parentId: 'p-e', extra: { defer_until: iso(DAY) } }),
  ];
  const at = input(beads, { readyIds: ['p-e', 'p-e.6'], collapsed: [] });
  const section = (title: string) => statusView(at).find((s) => s.title === title)!;

  it('puts waiting beads under Blocked and beads set aside until later under Deferred', () => {
    expect(section('Blocked').rows.map((r) => r.bead.id)).toEqual(['p-e.1', 'p-e.2']);
    expect(section('Deferred').rows.map((r) => r.bead.id)).toEqual(['p-e.3']);
    expect(section('Ready').rows.map((r) => r.bead.id)).toEqual(['p-e', 'p-e.6']);
    expect(section('Blocked').rows[1]).toMatchObject({ look: 'blocked', label: 'Waiting on another bead' });
  });

  it('counts the waiting bead in the epic and the footer, which match the sections', () => {
    expect(epicView(at)[0].progress).toMatchObject({ blocked: 2 });
    expect(epicView(at)[0].rows.find((r) => r.bead.id === 'p-e.2')?.look).toBe('blocked');
    const t = totals(at);
    expect(t.blocked).toBe(section('Blocked').count);
    expect(t.inProgress).toBe(section('In progress').count);
    expect(t.inProgress).toBe(1);
  });

  it('marks custom statuses so they never share a built-in icon, and Beads\' own extras differently again', () => {
    expect(section('In review')).toMatchObject({ marker: 'custom', look: 'progress', status: 'in_review' });
    expect(section('In progress')).toMatchObject({ marker: 'builtin' });
    const pinned = statusView(input([bead('p-p', { status: 'pinned' }), bead('p-q', { status: 'qa_wait' })]));
    expect(pinned.map((s) => [s.title, s.marker])).toEqual([
      ['QA wait', 'custom'],
      ['Pinned', 'beads'],
    ]);
  });

  it('filters by status the same way the sections group', () => {
    const only = (names: string[]) => statusView({ ...at, filters: { ...DEFAULT_FILTERS, status: { only: names } } }).flatMap((s) => s.rows.map((r) => r.bead.id));
    expect(only(['blocked'])).toEqual(['p-e.1', 'p-e.2']);
    expect(only(['open'])).toEqual(['p-e', 'p-e.6']);
    expect(only(['deferred'])).toEqual(['p-e.3']);
  });
});

describe('rows carry sub-issue counts', () => {
  it('counts direct children done of total, in both views', () => {
    const at = input(EPIC_BEADS, { collapsed: [] });
    const three = epicView(at)[0].rows.find((r) => r.bead.id === 'p-e1.3')!;
    expect(three.sub).toEqual({ done: 0, total: 1 });
    expect(epicView(at)[0].rows.find((r) => r.bead.id === 'p-e1.2')!.sub).toBeNull();
    const blocked = statusView(at).find((s) => s.title === 'Blocked')!;
    expect(blocked.rows[0].sub).toEqual({ done: 0, total: 1 });
  });
});

describe('odd trees', () => {
  it('keeps beads in a parent loop, under "Not in an epic"', () => {
    const groups = epicView(input([bead('p-a', { parentId: 'p-b' }), bead('p-b', { parentId: 'p-a' })]));
    expect(groups.map((g) => g.key)).toEqual(['epic:none']);
    expect(groups[0].rows.map((r) => r.bead.id).sort()).toEqual(['p-a', 'p-b']);
  });

  it('treats a bead whose parent is missing as top level', () => {
    const groups = epicView(input([bead('p-c', { parentId: 'p-gone' })]));
    expect(groups[0].rows.map((r) => [r.id, r.depth])).toEqual([['c', 0]]);
  });

  it('shows a short id for a child not named after its epic', () => {
    const groups = epicView(input([bead('p-e2', { type: 'epic' }), bead('p-x.1', { parentId: 'p-e2' })]));
    expect(groups[0].rows.map((r) => r.id)).toEqual(['x.1']);
  });
});

describe('custom done sections', () => {
  const beads = [bead('p-s', { status: 'shipped', closedAt: iso(DAY) })];
  it('say "(last 7 days)" when limited to recent', () => {
    expect(statusView(input(beads)).map((s) => s.title)).toEqual(['Shipped (last 7 days)']);
    expect(statusView(input(beads, { filters: { ...DEFAULT_FILTERS, status: 'all' } })).map((s) => s.title)).toEqual(['Shipped']);
  });

  it('knows when only older closed beads match a search', () => {
    const old = [bead('p-o', { status: 'closed', closedAt: iso(30 * DAY), title: 'Ancient fix' })];
    expect(statusView(input(old, { query: 'ancient' }))).toEqual([]);
    expect(matchesWithAll(input(old, { query: 'ancient' }))).toBe(true);
    expect(matchesWithAll(input(old, { query: 'zzz' }))).toBe(false);
  });
});

describe('keyboard', () => {
  const ids = ['a', 'b', 'c'];
  const key = (k: string, cursor: string | null, focus: KeyFocus = 'list') => listKey({ key: k, ids, cursor, focus });

  it('moves with j and k (and arrows), staying at the ends', () => {
    expect(key('j', null)).toEqual({ type: 'move', id: 'a' });
    expect(key('j', 'a')).toEqual({ type: 'move', id: 'b' });
    expect(key('j', 'c')).toEqual({ type: 'move', id: 'c' });
    expect(key('k', 'b')).toEqual({ type: 'move', id: 'a' });
    expect(key('k', 'a')).toEqual({ type: 'move', id: 'a' });
    expect(key('ArrowDown', 'a')).toEqual({ type: 'move', id: 'b' });
    expect(key('k', 'gone')).toEqual({ type: 'move', id: 'a' });
  });

  it('opens with Enter, focuses search with /, and passes Escape on', () => {
    expect(key('Enter', 'b')).toEqual({ type: 'open', id: 'b' });
    expect(key('Enter', null)).toBeNull();
    expect(key('/', null)).toEqual({ type: 'search' });
    expect(key('Escape', 'b')).toEqual({ type: 'escape' });
    expect(key('ContextMenu', 'b')).toEqual({ type: 'menu', id: 'b' });
  });

  it('in the search box: letters are text, arrows move, Enter opens the cursor row', () => {
    expect(key('j', 'a', 'search')).toBeNull();
    expect(key('/', 'a', 'search')).toBeNull();
    expect(key('ArrowDown', 'a', 'search')).toEqual({ type: 'move', id: 'b' });
    expect(key('Enter', 'a', 'search')).toEqual({ type: 'open', id: 'a' });
    expect(key('Escape', 'a', 'search')).toEqual({ type: 'escape' });
  });

  it('leaves Enter and the menu key to buttons and links, which still move with j and k', () => {
    expect(key('Enter', 'a', 'control')).toBeNull();
    expect(key('ContextMenu', 'a', 'control')).toBeNull();
    expect(key('j', 'a', 'control')).toEqual({ type: 'move', id: 'b' });
  });

  it('leaves every key to other fields', () => {
    for (const k of ['j', 'k', 'ArrowDown', 'ArrowUp', 'Enter', '/', 'ContextMenu', 'Escape']) expect(key(k, 'a', 'field')).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------- rendered panel

function visibility() {
  let visible = true;
  let documentHidden = false;
  const listeners = new Set<() => void>();
  return {
    isVisible: () => visible,
    isDocumentHidden: () => documentHidden,
    onChange: (l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    set(next: boolean) {
      visible = next;
      listeners.forEach((l) => l());
    },
    /** The whole window is hidden (minimized, another tab): the pane is hidden too. */
    hideDocument() {
      documentHidden = true;
      visible = false;
      listeners.forEach((l) => l());
    },
  };
}

function setup(answer: (call: Call) => Answer | Promise<Answer>) {
  const fake = fakeHost(answer);
  const toast = vi.fn(async () => {});
  const setBadge = vi.fn(async () => {});
  const writeClipboard = vi.fn(async () => {});
  Object.assign(fake.host, { toast, setBadge, writeClipboard });
  const vis = visibility();
  const store = createStore({ client: createClient(fake.host), host: fake.host, visibility: vis });
  const view = render(
    <StoreContext.Provider value={store}>
      <App />
    </StoreContext.Provider>,
  );
  return { ...fake, store, toast, setBadge, writeClipboard, vis, view };
}

async function open(store: Store, directory = '/p/a') {
  await act(async () => {
    store.setDirectory(directory);
    await flush();
  });
}

const press = (key: string, target: Element | Document = document) =>
  act(async () => {
    fireEvent.keyDown(target, { key });
    await flush();
  });

const liveSnapshot = (over: Parameters<typeof snapshot>[0] = {}) =>
  snapshot({ statuses: STATUSES, readyIds: openIds(over.beads ?? []), freshness: freshness({ localRefreshedAt: iso(0) }), ...over });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('list views', () => {
  it('renders the epic view with progress, short ids and the orphans group', async () => {
    const { store } = setup(() => json(liveSnapshot({ beads: EPIC_BEADS })));
    await open(store);
    expect(screen.getByText('Offline playback')).toBeTruthy();
    expect(screen.getByText('2/5 done')).toBeTruthy();
    expect(screen.getByText('1 blocked', { selector: '.bd-prog *' })).toBeTruthy();
    expect(screen.getByText('.3.1')).toBeTruthy();
    expect(screen.getByText(/Not in an epic/)).toBeTruthy();
  });

  it('renders unknown status with fallback', async () => {
    const { store } = setup(() => json(liveSnapshot({ beads: [bead('p-x', { status: 'mystery', title: 'Strange one' })] })));
    await open(store);
    await act(async () => {
      store.setView('status');
      await flush();
    });
    const header = screen.getByRole('button', { name: /mystery/ });
    expect(header.querySelector('.bd-sd')?.getAttribute('data-look')).toBe('other');
    expect(screen.getByText('Strange one')).toBeTruthy();
  });

  it('shows a custom status in its own section', async () => {
    const { store } = setup(() => json(liveSnapshot({ beads: [bead('p-x', { status: 'in_review', title: 'Needs eyes' })] })));
    await open(store);
    await act(async () => {
      store.setView('status');
      await flush();
    });
    const section = screen.getByRole('listbox', { name: 'In review' });
    expect(within(section).getByText('Needs eyes')).toBeTruthy();
    const header = screen.getByRole('button', { name: /In review/ });
    expect(header.getAttribute('title')).toBe('in_review');
    expect(header.querySelector('.bd-sd')?.getAttribute('data-marker')).toBe('custom');
  });

  it('collapses a section and remembers it for the project', async () => {
    const { store, stored } = setup(() => json(liveSnapshot({ beads: EPIC_BEADS })));
    await open(store);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Offline playback/ }));
      await flush();
    });
    expect(screen.queryByText('.3.1')).toBeNull();
    expect((stored.get(uiKey('/p/a')) as { collapsed: string[] }).collapsed).toContain('epic:p-e1');
  });

  it('narrows rows with search and offers a way back when nothing matches', async () => {
    const { store } = setup(() => json(liveSnapshot({ beads: EPIC_BEADS })));
    await open(store);
    await act(async () => {
      fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'o1' } });
      await flush();
    });
    expect(screen.getByText('o1')).toBeTruthy();
    expect(screen.queryByText('Offline playback')).toBeNull();
    await act(async () => {
      fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
      await flush();
    });
    expect(screen.getByText('No beads match.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
      await flush();
    });
    expect(store.get().query).toBe('');
  });

  it('filters from the filter sheet and remembers the choice', async () => {
    const beads = [bead('p-a', { assignee: 'Bob Builder', title: 'Assigned one' }), bead('p-b', { title: 'Nobody has this' })];
    const { store, stored } = setup(() => json(liveSnapshot({ beads })));
    await open(store);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
      await flush();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unassigned' }));
      await flush();
    });
    expect(screen.queryByText('Assigned one')).toBeNull();
    expect(screen.getByText('Nobody has this')).toBeTruthy();
    expect(stored.get(uiKey('/p/a'))).toMatchObject({ filters: { assignee: 'unassigned' } });
  });

  it('offers Overdue and Due this week as one choice, kept with the other filters', async () => {
    const at = (ms: number) => new Date(NOW + ms).toISOString();
    const beads = [bead('p-a', { title: 'Late one', extra: { due_at: at(-DAY) } }), bead('p-b', { title: 'Soon one', extra: { due_at: at(3 * DAY) } }), bead('p-c', { title: 'Undated one' })];
    const { store, stored } = setup(() => json(liveSnapshot({ beads })));
    await open(store);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
      await flush();
    });
    const line = screen.getByRole('group', { name: 'Due' });
    await act(async () => {
      fireEvent.click(within(line).getByRole('button', { name: 'Overdue' }));
      await flush();
    });
    expect(screen.getByText('Late one')).toBeTruthy();
    expect(screen.queryByText('Soon one')).toBeNull();
    expect(screen.queryByText('Undated one')).toBeNull();
    expect(stored.get(uiKey('/p/a'))).toMatchObject({ filters: { due: 'overdue' } });
    // The other one replaces it; pressing it again lets every date through.
    await act(async () => {
      fireEvent.click(within(line).getByRole('button', { name: 'Due this week' }));
      await flush();
    });
    expect(within(line).getByRole('button', { name: 'Overdue' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText('Late one')).toBeNull();
    expect(screen.getByText('Soon one')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(line).getByRole('button', { name: 'Due this week' }));
      await flush();
    });
    expect(screen.getByText('Undated one')).toBeTruthy();
    expect(stored.get(uiKey('/p/a'))).toMatchObject({ filters: { due: 'any' } });
  });

  it('moves with j and k, opens with Enter, focuses search with /, and clears with Escape', async () => {
    const { store } = setup(() => json(liveSnapshot({ beads: EPIC_BEADS })));
    await open(store);
    await press('j');
    await press('j');
    expect(document.querySelector('[data-cursor]')?.textContent).toContain('.1');
    await press('Enter');
    expect(store.get().selectedId).toBe('p-e1.1');
    // Enter opens the detail; Escape comes back to the list with the row still selected.
    expect(screen.getByRole('heading', { name: 'Title p-e1.1' })).toBeTruthy();
    await press('Escape');
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('.1');
    await press('k');
    expect(document.querySelector('[data-cursor]')?.textContent).toContain('Offline playback');
    await press('Escape');
    expect(store.get().selectedId).toBeNull();
    await press('/');
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  });

  it('selects a row on click', async () => {
    const { store } = setup(() => json(liveSnapshot({ beads: EPIC_BEADS })));
    await open(store);
    await act(async () => {
      fireEvent.click(screen.getByText('Title p-o2'));
      await flush();
    });
    expect(store.get().selectedId).toBe('p-o2');
  });

  it('opens the row menu and copies the id', async () => {
    const { store, writeClipboard, toast } = setup(() => json(liveSnapshot({ beads: EPIC_BEADS })));
    await open(store);
    await act(async () => {
      fireEvent.contextMenu(screen.getByText('Title p-o2'));
      await flush();
    });
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.querySelector('span')?.textContent)).toEqual(['Add to current chat', 'Start session', 'Start in worktree…', 'Copy ID']);
    await act(async () => {
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy ID' }));
      await flush();
    });
    expect(writeClipboard).toHaveBeenCalledWith('p-o2');
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('falls back to a toast with Copy when the clipboard fails', async () => {
    const { store, writeClipboard, toast } = setup(() => json(liveSnapshot({ beads: EPIC_BEADS })));
    writeClipboard.mockRejectedValueOnce(new Error('denied'));
    await open(store);
    await act(async () => {
      store.copyText('p-o2');
      await flush();
    });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ copy: { text: 'p-o2' } }));
  });

  it('leaves Enter to a focused button instead of opening the row', async () => {
    const { store } = setup(() => json(liveSnapshot({ beads: EPIC_BEADS })));
    await open(store);
    await press('j');
    const filters = screen.getByRole('button', { name: 'Filters' });
    filters.focus();
    let notPrevented = true;
    await act(async () => {
      notPrevented = fireEvent.keyDown(filters, { key: 'Enter' });
      await flush();
    });
    expect(notPrevented).toBe(true);
    expect(store.get().selectedId).toBeNull();
    // The browser's own Enter on a button is a click.
    await act(async () => {
      fireEvent.click(filters);
      await flush();
    });
    expect(screen.getByRole('region', { name: 'Filters' })).toBeTruthy();
  });

  it('marks unseen rows and shows sub-issue counts', async () => {
    const { store } = setup(() => json(liveSnapshot({ beads: EPIC_BEADS, unseenIds: ['p-e1.2'] })));
    await open(store);
    // An unseen bead is in Needs me, which then opens first; the epic list is a click away.
    expect(store.get().view).toBe('needs');
    await act(async () => {
      store.setView('epic');
      await flush();
    });
    expect(document.getElementById('bd-row-p-e1.2')?.hasAttribute('data-unseen')).toBe(true);
    expect(document.getElementById('bd-row-p-e1.1')?.hasAttribute('data-unseen')).toBe(false);
    expect(document.getElementById('bd-row-p-e1.3')?.querySelector('.bd-sub')?.textContent).toBe('0/1');
  });

  it('names a row status in words', async () => {
    const { store } = setup(() => json(liveSnapshot({ beads: [bead('p-x', { status: 'in_progress', title: 'Doing it' })] })));
    await open(store);
    expect(screen.getByRole('img', { name: 'In progress' })).toBeTruthy();
  });

  it('returns focus to the row after the menu closes from the keyboard', async () => {
    const { store } = setup(() => json(liveSnapshot({ beads: EPIC_BEADS })));
    await open(store);
    await press('j');
    await press('ContextMenu');
    const menu = screen.getByRole('menu');
    await press('Escape', menu);
    expect(screen.queryByRole('menu')).toBeNull();
    const focused = document.activeElement as HTMLElement;
    expect(focused.getAttribute('role')).toBe('listbox');
    expect(focused.getAttribute('aria-activedescendant')).toBe('bd-row-p-e1');
  });

  it('points the active descendant only at a rendered row', async () => {
    const { store } = setup(() => json(liveSnapshot({ beads: EPIC_BEADS })));
    await open(store);
    await press('j');
    await press('j');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Collapse Offline playback/ }));
      await flush();
    });
    for (const box of screen.getAllByRole('listbox')) {
      const id = box.getAttribute('aria-activedescendant');
      if (id) expect(document.getElementById(id)).toBeTruthy();
    }
    expect(document.getElementById('bd-row-p-e1.1')).toBeNull();
  });

  it('offers "Show all" when only older closed beads match the search', async () => {
    const beads = [bead('p-o', { status: 'closed', closedAt: iso(30 * DAY), title: 'Ancient fix' }), bead('p-n')];
    const { store } = setup(() => json(liveSnapshot({ beads })));
    await open(store);
    await act(async () => {
      store.setQuery('ancient');
      await flush();
    });
    expect(screen.getByText('Only older closed beads match.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
      await flush();
    });
    expect(store.get().filters.status).toBe('all');
    expect(screen.getByText('Ancient fix')).toBeTruthy();
  });

  it('opens the cursor row with Enter from the search box', async () => {
    const { store } = setup(() => json(liveSnapshot({ beads: EPIC_BEADS })));
    await open(store);
    await press('/');
    const search = screen.getByRole('searchbox');
    expect(document.activeElement).toBe(search);
    await act(async () => {
      fireEvent.input(search, { target: { value: 'o2' } });
      await flush();
    });
    await press('ArrowDown', search);
    await press('Enter', search);
    expect(store.get().selectedId).toBe('p-o2');
  });

  it('moves focus with the cursor from one section to the next', async () => {
    const { store } = setup(() => json(liveSnapshot({ beads: EPIC_BEADS })));
    await open(store);
    const first = screen.getAllByRole('listbox')[0]!;
    first.focus();
    for (let i = 0; i < 6; i++) await press('j', document.activeElement ?? document);
    const focused = document.activeElement as HTMLElement;
    expect(focused.getAttribute('role')).toBe('listbox');
    expect(focused).not.toBe(first);
    expect(focused.getAttribute('aria-activedescendant')).toBe('bd-row-p-e2');
  });

  it('leaves list keys alone in another field', async () => {
    const { store } = setup(() => json(liveSnapshot({ beads: EPIC_BEADS })));
    await open(store);
    const other = document.createElement('input');
    document.body.append(other);
    other.focus();
    await press('j', other);
    await press('ArrowDown', other);
    expect(document.querySelector('[data-cursor]')).toBeNull();
    other.remove();
  });

  it('keeps listboxes to options only', async () => {
    const { store, view } = setup(() => json(liveSnapshot({ beads: EPIC_BEADS })));
    await open(store);
    for (const box of screen.getAllByRole('listbox')) {
      expect(Array.from(box.children).every((c) => c.getAttribute('role') === 'option')).toBe(true);
    }
    expect(screen.getAllByRole('option').some((o) => o.hasAttribute('aria-expanded'))).toBe(false);
    expect(view.container.querySelector('.bd-list')?.getAttribute('role')).toBe('group');
  });

  it('explains both progress counts on hover', async () => {
    const { store } = setup(() => json(liveSnapshot({ beads: EPIC_BEADS })));
    await open(store);
    expect(document.getElementById('bd-row-p-e1.3')?.querySelector('.bd-sub')?.getAttribute('title')).toBe('0 of 1 direct sub-issues done');
    expect(screen.getByText('2/5 done').getAttribute('title')).toBe('2 of 5 beads in this epic done');
  });

  it('shows totals in the footer', async () => {
    const { store } = setup(() => json(liveSnapshot({ beads: EPIC_BEADS })));
    await open(store);
    const footer = screen.getByRole('contentinfo');
    expect(footer.textContent).toBe('7 open1 in progress1 blocked1 closed this week');
  });
});

describe('badge', () => {
  it('shows the unseen count, follows changes, and is set again when the panel is shown', async () => {
    let unseenIds = ['p-o1', 'p-o2'];
    let n = 0;
    const { store, setBadge, vis } = setup(() => json(liveSnapshot({ beads: EPIC_BEADS, unseenIds, cursor: `c${++n}` })));
    await open(store);
    expect(setBadge).toHaveBeenLastCalledWith(2);
    const calls = setBadge.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(setBadge.mock.calls.length).toBe(calls);
    unseenIds = [];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(setBadge).toHaveBeenLastCalledWith(null);
    unseenIds = ['p-o1'];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(setBadge).toHaveBeenLastCalledWith(1);
    setBadge.mockClear();
    await act(async () => {
      vis.set(false);
      vis.set(true);
      await flush();
    });
    expect(setBadge).toHaveBeenCalledWith(1);
  });

  it('keeps a slow poll while the pane is hidden so the badge can rise, and pauses when the window is hidden', async () => {
    let unseenIds: string[] = [];
    let n = 0;
    const { store, setBadge, vis, calls } = setup(() => json(liveSnapshot({ beads: EPIC_BEADS, unseenIds, cursor: `c${++n}` })));
    await open(store);
    await act(async () => {
      vis.set(false);
      await flush();
    });
    const before = calls.length;
    unseenIds = ['p-o1'];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(calls.length).toBe(before);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50_000);
    });
    expect(calls.length).toBe(before + 1);
    expect(setBadge).toHaveBeenLastCalledWith(1);
    await act(async () => {
      vis.hideDocument();
      await flush();
    });
    const paused = calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000);
    });
    expect(calls.length).toBe(paused);
  });
});

// ------------------------------------------------------------------------------------------------- Needs me

function gate(id: string, blocks: string[], over: Partial<Gate> = {}): Gate {
  return { id, kind: 'human', reason: 'Review before closing', blocks, createdBy: 'Claude Code', createdAt: iso(3_600_000), timeoutMs: null, planApproval: false, ...over };
}

function change(id: string, beadId: string, over: Partial<ChangeEvent> = {}): ChangeEvent & { unseen: boolean } {
  return { id, beadId, kind: 'field', field: 'priority', from: 1, to: 0, actor: 'Claude Code', byPanel: false, observedAt: iso(7_200_000), unseen: true, ...over };
}

const REVIEW = bead('p-rev', { title: 'Ship the session store' });
const ASK = bead('p-ask', { title: 'Which region?', labels: ['human'], description: 'eu-west or us-east for staging?', createdBy: 'Claude Code' });
const STUCK = bead('p-stk', { title: 'Rewrite the retry policy', status: 'in_progress', updatedAt: iso(5 * DAY) });
const CHANGED = bead('p-chg', { title: 'Cut over DNS' });

/** A project with one row in each section. */
function needsProject(over: Parameters<typeof snapshot>[0] = {}) {
  return liveSnapshot({
    beads: [REVIEW, ASK, STUCK, CHANGED],
    gates: [gate('p-g1', ['p-rev'])],
    gateIds: ['p-g1'],
    unseenIds: ['p-chg'],
    activity: [change('e1', 'p-chg')],
    ...over,
  });
}

/** Section headings as worded, without their counts. */
const headings = () => Array.from(document.querySelectorAll('.bd-nsec-title')).map((h) => h.firstChild!.textContent!.trim());
/** The focusable part of a row (the bead and why it is here). */
const rowMain = (id: string, section: string) => document.getElementById(`bd-need-${section}_${id}`)!;
/** A whole row: the list item with its actions. */
const rowOf = (id: string, section: string) => rowMain(id, section).closest<HTMLElement>('li')!;
const routes = (calls: Call[]) => calls.map((c) => c.route).filter((r) => r !== 'snapshot');
const click = (el: Element) =>
  act(async () => {
    fireEvent.click(el);
    await flush();
  });
const type = (el: Element, value: string) =>
  act(async () => {
    fireEvent.input(el, { target: { value } });
    await flush();
  });

describe('Needs me view', () => {
  it('sections render in order and empty ones are not shown', async () => {
    const { store } = setup(() => json(needsProject()));
    await open(store);
    expect(store.get().view).toBe('needs');
    expect(headings()).toEqual(['Waiting for your review', 'Asked for help', 'Stuck', 'Changed since you looked']);

    cleanup();
    const again = setup(() => json(needsProject({ beads: [REVIEW, STUCK], unseenIds: [], activity: [] })));
    await open(again.store);
    expect(headings()).toEqual(['Waiting for your review', 'Stuck']);
    expect(screen.queryByText('Nothing needs you right now.')).toBeNull();
  });

  it('says so in one quiet line when nothing needs the person', async () => {
    const { store } = setup(() => json(liveSnapshot({ beads: [bead('p-1')] })));
    await open(store);
    await act(async () => {
      store.setView('needs');
      await flush();
    });
    expect(headings()).toEqual([]);
    expect(screen.getByText('Nothing needs you right now.')).toBeTruthy();
  });

  it('is headings and plain lists: no listbox, no option, no control inside the focusable part of a row', async () => {
    const { store } = setup(() => json(needsProject()));
    await open(store);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.id)).toEqual(['bd-nsec-waiting', 'bd-nsec-asked', 'bd-nsec-stuck', 'bd-nsec-changed']);
    const waiting = screen.getByRole('list', { name: /Waiting for your review/ });
    expect(within(waiting).getAllByRole('listitem')).toHaveLength(1);
    // Mark all seen sits beside the heading, outside the list.
    expect(screen.getByRole('button', { name: 'Mark all seen' }).closest('ul')).toBeNull();
    for (const main of Array.from(document.querySelectorAll('.bd-nmain'))) {
      expect(main.querySelector('button, input, textarea, select, a, [tabindex]')).toBeNull();
    }
    // The focusable part is named by the bead and described by why it is here.
    const rev = rowMain('p-rev', 'waiting');
    expect(rev.getAttribute('role')).toBe('button');
    expect(rev.getAttribute('aria-labelledby')!.split(' ').map((id) => document.getElementById(id)!.textContent).join(' ')).toBe('rev Ship the session store');
    expect(document.getElementById(rev.getAttribute('aria-describedby')!)!.textContent).toMatch(/Review before closing/);
  });

  it('every row shows its reason', async () => {
    const { store } = setup(() => json(needsProject()));
    await open(store);
    expect(rowOf('p-rev', 'waiting').querySelector('.bd-why')!.textContent).toMatch(/Review before closing from Claude Code/);
    expect(within(rowOf('p-ask', 'asked')).getByText('eu-west or us-east for staging?')).toBeTruthy();
    expect(within(rowOf('p-stk', 'stuck')).getByText('No update in 5 days')).toBeTruthy();
    expect(rowOf('p-chg', 'changed').querySelector('.bd-why')!.textContent).toMatch(/priority P1 → P0/);
    expect(rowOf('p-chg', 'changed').querySelector('.bd-why')!.textContent).toMatch(/Claude Code/);
  });

  it('a closed human bead never appears', async () => {
    const { store } = setup(() => json(needsProject({ beads: [REVIEW, { ...ASK, status: 'closed', closedAt: iso(0) }, STUCK, CHANGED] })));
    await open(store);
    expect(document.querySelector('.bd-nsec[data-section="asked"]')).toBeNull();
    expect(screen.queryByText('Which region?')).toBeNull();
  });

  it('Resolve acts on the first click, and the row says so until the review leaves the list', async () => {
    const { store, calls, toast } = setup((call) => (call.route === 'gateResolve' ? json({ ok: true, gateId: 'p-g1' }) : json(needsProject())));
    await open(store);
    await click(within(rowOf('p-rev', 'waiting')).getByRole('button', { name: 'Resolve' }));
    expect(calls.filter((c) => c.route === 'gateResolve').map((c) => c.body)).toEqual([{ directory: '/p/a', gateId: 'p-g1' }]);
    expect(within(rowOf('p-rev', 'waiting')).getByText('Resolved. Updating the list.')).toBeTruthy();
    expect(rowOf('p-rev', 'waiting').querySelector('button')).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Review resolved for rev.' }));
  });

  it('Add a reason opens the step; the reason is sent with Enter', async () => {
    const { store, calls } = setup((call) => (call.route === 'gateResolve' ? json({ ok: true, gateId: 'p-g1' }) : json(needsProject())));
    await open(store);
    const row = rowOf('p-rev', 'waiting');
    await click(within(row).getByRole('button', { name: 'Add a reason' }));
    expect(calls.some((c) => c.route === 'gateResolve')).toBe(false);
    const reason = within(row).getByRole('textbox', { name: 'Reason (optional)' });
    expect(document.activeElement).toBe(reason);
    await type(reason, 'Looks right');
    await act(async () => {
      fireEvent.keyDown(reason, { key: 'Enter' });
      await flush();
    });
    expect(calls.find((c) => c.route === 'gateResolve')?.body).toEqual({ directory: '/p/a', gateId: 'p-g1', reason: 'Looks right' });
  });

  it('a plan approval reads as a plan and is approved in one click', async () => {
    const { store, calls, toast } = setup((call) =>
      call.route === 'gateResolve' ? json({ ok: true, gateId: 'p-g1' }) : json(needsProject({ gates: [gate('p-g1', ['p-rev'], { reason: 'Approve the plan before work starts', planApproval: true })] })),
    );
    await open(store);
    const row = rowOf('p-rev', 'waiting');
    expect(within(row).getByText('Plan')).toBeTruthy();
    await click(within(row).getByRole('button', { name: 'Approve' }));
    expect(calls.filter((c) => c.route === 'gateResolve')).toHaveLength(1);
    expect(within(rowOf('p-rev', 'waiting')).getByText('Approved. Updating the list.')).toBeTruthy();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Plan approved for rev.' }));
  });

  it('row disappears when the gate resolves (an answer without it removes it, no stale button)', async () => {
    let gates = [gate('p-g1', ['p-rev'])];
    let n = 0;
    const { store } = setup(() => json(needsProject({ gates, cursor: `c${++n}` })));
    await open(store);
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeTruthy();
    gates = [];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(document.querySelector('.bd-nsec[data-section="waiting"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
  });

  it('already-resolved shows who resolved it, and offers nothing to send again', async () => {
    const { store } = setup((call) =>
      call.route === 'gateResolve' ? json({ ok: false, code: 'already-resolved', resolvedBy: 'Claude Code', at: iso(120_000) }) : json(needsProject()),
    );
    await open(store);
    await click(within(rowOf('p-rev', 'waiting')).getByRole('button', { name: 'Resolve' }));
    expect(screen.getByText('The review on rev was already resolved by Claude Code 2m ago.')).toBeTruthy();
    expect(rowOf('p-rev', 'waiting').querySelector('button')).toBeNull();
    await click(screen.getByRole('button', { name: 'Hide this note' }));
    expect(screen.queryByText(/already resolved by/)).toBeNull();
  });

  it('respond sends the text and the row goes when the bead closes', async () => {
    let beads = [REVIEW, ASK, STUCK, CHANGED];
    const closed = { ...ASK, status: 'closed', closedAt: iso(0) };
    const { store, calls, toast } = setup((call) => {
      if (call.route === 'humanRespond') {
        beads = [REVIEW, closed, STUCK, CHANGED];
        return json({ ok: true, bead: closed });
      }
      return json(needsProject({ beads }));
    });
    await open(store);
    const row = rowOf('p-ask', 'asked');
    await click(within(row).getByRole('button', { name: 'Respond' }));
    const send = within(row).getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await type(within(row).getByRole('textbox', { name: 'Your answer' }), 'eu-west, please.');
    expect(send.disabled).toBe(false);
    await click(send);
    expect(calls.find((c) => c.route === 'humanRespond')?.body).toEqual({ directory: '/p/a', id: 'p-ask', response: 'eu-west, please.' });
    expect(document.querySelector('.bd-nsec[data-section="asked"]')).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Answer sent to ask.' }));
  });

  it('dismiss acts on the first click; Dismiss with a reason sends the reason', async () => {
    const { store, calls } = setup((call) => (call.route === 'humanDismiss' ? json({ ok: true, bead: { ...ASK, status: 'closed' } }) : json(needsProject())));
    await open(store);
    await click(within(rowOf('p-ask', 'asked')).getByRole('button', { name: 'Dismiss' }));
    expect(calls.filter((c) => c.route === 'humanDismiss').map((c) => c.body)).toEqual([{ directory: '/p/a', id: 'p-ask' }]);

    cleanup();
    const again = setup((call) => (call.route === 'humanDismiss' ? json({ ok: true, bead: { ...ASK, status: 'closed' } }) : json(needsProject())));
    await open(again.store);
    await click(within(rowOf('p-ask', 'asked')).getByRole('button', { name: 'Dismiss with a reason' }));
    expect(again.calls.some((c) => c.route === 'humanDismiss')).toBe(false);
    await type(screen.getByRole('textbox', { name: 'Reason (optional)' }), 'Answered in chat');
    await click(screen.getByRole('button', { name: 'Dismiss request' }));
    expect(again.calls.filter((c) => c.route === 'humanDismiss').map((c) => c.body)).toEqual([{ directory: '/p/a', id: 'p-ask', reason: 'Answered in chat' }]);
  });

  it('a request someone already answered says so, without a name', async () => {
    const { store } = setup((call) => (call.route === 'humanDismiss' ? json({ ok: false, code: 'not-open', current: null }) : json(needsProject())));
    await open(store);
    await click(within(rowOf('p-ask', 'asked')).getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByText('The request ask was already answered or closed.')).toBeTruthy();
    expect(rowOf('p-ask', 'asked').querySelector('button')).toBeNull();
  });

  it('a failed answer stays on the row with the text kept', async () => {
    const { store } = setup((call) => (call.route === 'humanRespond' ? envelope(500, { code: 'bd-failed', message: "Beads couldn't save this." }) : json(needsProject())));
    await open(store);
    const row = rowOf('p-ask', 'asked');
    await click(within(row).getByRole('button', { name: 'Respond' }));
    await type(within(row).getByRole('textbox', { name: 'Your answer' }), 'eu-west');
    await click(within(row).getByRole('button', { name: 'Send' }));
    expect(within(row).getByRole('alert').textContent).toMatch(/Beads couldn't save this\./);
    expect((within(row).getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value).toBe('eu-west');
  });

  it("one row's write leaves another row's open step, its typed answer and its buttons alone", async () => {
    const resolving = deferred<Answer>();
    const responding = deferred<Answer>();
    const { store, calls } = setup((call) => {
      if (call.route === 'gateResolve') return resolving.promise;
      if (call.route === 'humanRespond') return responding.promise;
      return json(needsProject());
    });
    await open(store);
    // Row B: an answer typed and on its way.
    await click(within(rowOf('p-ask', 'asked')).getByRole('button', { name: 'Respond' }));
    await type(within(rowOf('p-ask', 'asked')).getByRole('textbox', { name: 'Your answer' }), 'eu-west');
    await click(within(rowOf('p-ask', 'asked')).getByRole('button', { name: 'Send' }));
    // Row A: resolved while B's answer is still out; a second click sends nothing more.
    const resolveA = within(rowOf('p-rev', 'waiting')).getByRole('button', { name: 'Resolve' }) as HTMLButtonElement;
    await click(resolveA);
    await click(resolveA);
    expect(calls.filter((c) => c.route === 'gateResolve')).toHaveLength(1);
    expect(resolveA.disabled).toBe(true);
    // A answers: B's step, text and busy buttons are untouched.
    await act(async () => {
      resolving.resolve(json({ ok: true, gateId: 'p-g1' }));
      await flush();
    });
    const b = rowOf('p-ask', 'asked');
    expect((within(b).getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value).toBe('eu-west');
    expect((within(b).getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(b).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    await click(within(b).getByRole('button', { name: 'Send' }));
    expect(calls.filter((c) => c.route === 'humanRespond')).toHaveLength(1);
    await act(async () => {
      responding.resolve(json({ ok: true, bead: { ...ASK, status: 'closed' } }));
      await flush();
    });
    expect(document.querySelector('.bd-nsec[data-section="asked"]')).toBeNull();
  });

  it('two rows can hold open steps at once, each with its own text', async () => {
    const { store } = setup(() => json(needsProject()));
    await open(store);
    await click(within(rowOf('p-ask', 'asked')).getByRole('button', { name: 'Respond' }));
    await type(within(rowOf('p-ask', 'asked')).getByRole('textbox', { name: 'Your answer' }), 'eu-west');
    await click(within(rowOf('p-stk', 'stuck')).getByRole('button', { name: 'Defer' }));
    await type(within(rowOf('p-stk', 'stuck')).getByRole('textbox', { name: 'Defer until' }), '+2d');
    expect((within(rowOf('p-ask', 'asked')).getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value).toBe('eu-west');
  });

  it('respond and dismiss are hidden while the request waits on something, and the reason names it in words', async () => {
    const timer = gate('p-tg', [], { kind: 'timer', reason: null });
    const held = { ...ASK, dependencies: [{ from: 'p-ask', to: 'p-tg', kind: 'blocks' }] } as Bead;
    const { store } = setup(() => json(needsProject({ beads: [REVIEW, held, STUCK, CHANGED], gates: [gate('p-g1', ['p-rev']), timer], gateIds: ['p-g1', 'p-tg'] })));
    await open(store);
    const row = rowOf('p-ask', 'asked');
    expect(within(row).queryByRole('button', { name: 'Respond' })).toBeNull();
    expect(within(row).queryByRole('button', { name: /Dismiss/ })).toBeNull();
    expect(row.textContent).toMatch(/Waiting on a timer\. You can answer once that is done\./);
    expect(row.textContent).not.toMatch(/p-tg/);
  });

  it('Keep hides for 7 days and writes nothing to Beads', async () => {
    const { store, calls, stored } = setup(() => json(needsProject()));
    await open(store);
    await click(within(rowOf('p-stk', 'stuck')).getByRole('button', { name: 'Keep' }));
    expect(document.querySelector('.bd-nsec[data-section="stuck"]')).toBeNull();
    expect(routes(calls)).toEqual([]);
    expect((stored.get(projectKey('/p/a')) as { keep: Record<string, number> }).keep).toEqual({ 'p-stk': NOW + KEEP_MS });
  });

  it('defer uses the date box with its preview and sends what was typed', async () => {
    const { store, calls } = setup((call) => (call.route === 'deferBead' ? json({ ok: true, bead: { ...STUCK, status: 'deferred' } }) : json(needsProject())));
    await open(store);
    const row = rowOf('p-stk', 'stuck');
    await click(within(row).getByRole('button', { name: 'Defer' }));
    const box = within(row).getByRole('textbox', { name: 'Defer until' });
    expect(document.activeElement).toBe(box);
    await type(box, '+2d');
    expect(row.querySelector('.bd-date-preview')!.textContent).toBe('Until Fri, Oct 16, 12:00 PM');
    await type(box, 'in a fortnight');
    expect(row.querySelector('.bd-date-preview')!.textContent).toBe(BEADS_READS);
    await type(box, '+2d');
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
      await flush();
    });
    expect(calls.find((c) => c.route === 'deferBead')?.body).toEqual({ directory: '/p/a', id: 'p-stk', expectedUpdatedAt: STUCK.updatedAt, until: '+2d' });
  });

  it('Escape closes an open step, keeps the row, and puts focus back on it', async () => {
    const { store } = setup(() => json(needsProject()));
    await open(store);
    await click(within(rowOf('p-stk', 'stuck')).getByRole('button', { name: 'Defer' }));
    await press('Escape', screen.getByRole('textbox', { name: 'Defer until' }));
    expect(screen.queryByRole('textbox', { name: 'Defer until' })).toBeNull();
    expect(within(rowOf('p-stk', 'stuck')).getByRole('button', { name: 'Defer' })).toBeTruthy();
    expect(document.activeElement).toBe(rowMain('p-stk', 'stuck'));
  });

  it('opening a changed row opens the bead and marks it seen; Mark all seen marks every change', async () => {
    const { store, calls } = setup((call) => (call.route === 'seen' ? json({ unseenIds: [] }) : call.route === 'bead' ? json({ bead: CHANGED, related: { parent: null, children: [], deps: [] } }) : json(needsProject())));
    await open(store);
    await click(within(rowOf('p-chg', 'changed')).getByText('Cut over DNS'));
    expect(store.get().detail?.stack[0]?.id).toBe('p-chg');
    expect(calls.find((c) => c.route === 'seen')?.body).toEqual({ directory: '/p/a', ids: ['p-chg'] });

    cleanup();
    const again = setup((call) => (call.route === 'seen' ? json({ unseenIds: [] }) : json(needsProject())));
    await open(again.store);
    await click(screen.getByRole('button', { name: 'Mark all seen' }));
    expect(again.calls.find((c) => c.route === 'seen')?.body).toEqual({ directory: '/p/a', all: true });
    expect(document.querySelector('.bd-nsec[data-section="changed"]')).toBeNull();
  });

  it('one row is in the tab order; j and k move real focus across sections, Enter and Space open', async () => {
    const { store } = setup((call) => (call.route === 'bead' ? json({ bead: ASK, related: { parent: null, children: [], deps: [] } }) : json(needsProject())));
    await open(store);
    const stops = () => Array.from(document.querySelectorAll('.bd-nmain[tabindex="0"]'));
    expect(stops()).toEqual([rowMain('p-rev', 'waiting')]);
    await press('j');
    expect(document.activeElement).toBe(rowMain('p-rev', 'waiting'));
    await press('j', document.activeElement!);
    expect(document.activeElement).toBe(rowMain('p-ask', 'asked'));
    expect(rowOf('p-ask', 'asked').hasAttribute('data-cursor')).toBe(true);
    expect(stops()).toEqual([rowMain('p-ask', 'asked')]);
    await press('k', document.activeElement!);
    expect(document.activeElement).toBe(rowMain('p-rev', 'waiting'));
    await press('j', document.activeElement!);
    await press('Enter', document.activeElement!);
    expect(store.get().detail?.stack[0]?.id).toBe('p-ask');

    cleanup();
    const again = setup((call) => (call.route === 'bead' ? json({ bead: STUCK, related: { parent: null, children: [], deps: [] } }) : json(needsProject())));
    await open(again.store);
    await act(async () => {
      rowMain('p-stk', 'stuck').focus();
      fireEvent.keyDown(rowMain('p-stk', 'stuck'), { key: ' ' });
      await flush();
    });
    expect(again.store.get().detail?.stack[0]?.id).toBe('p-stk');
  });

  it('j on a row button moves focus to the next row; Enter on the button does not open the bead', async () => {
    const { store, calls } = setup((call) => (call.route === 'gateResolve' ? json({ ok: true, gateId: 'p-g1' }) : json(needsProject())));
    await open(store);
    const resolve = within(rowOf('p-rev', 'waiting')).getByRole('button', { name: 'Resolve' });
    await act(async () => {
      resolve.focus();
      await flush();
    });
    await press('Enter', resolve);
    expect(store.get().detail).toBeNull();
    expect(calls.some((c) => c.route === 'bead')).toBe(false);
    await press('j', resolve);
    expect(document.activeElement).toBe(rowMain('p-ask', 'asked'));
  });

  it('Enter on a focused row opens it, also after Escape cleared the cursor', async () => {
    const { store } = setup((call) => (call.route === 'bead' ? json({ bead: ASK, related: { parent: null, children: [], deps: [] } }) : json(needsProject())));
    await open(store);
    await press('j');
    await press('j', document.activeElement!);
    const ask = rowMain('p-ask', 'asked');
    expect(document.activeElement).toBe(ask);
    await press('Escape', ask);
    expect(rowOf('p-ask', 'asked').hasAttribute('data-cursor')).toBe(false);
    await press('Enter', ask);
    expect(store.get().detail?.stack[0]?.id).toBe('p-ask');
  });

  describe('focus after a write', () => {
    const STUCK2 = bead('p-stk2', { title: 'Second stuck', status: 'in_progress', updatedAt: iso(4 * DAY) });
    const STUCK3 = bead('p-stk3', { title: 'Third stuck', status: 'in_progress', updatedAt: iso(4 * DAY) });
    let scrolled: ReturnType<typeof vi.fn>;
    let focused: { mock: { calls: unknown[]; contexts: unknown[] }; mockRestore(): void };
    beforeEach(() => {
      scrolled = vi.fn();
      (HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrolled;
      focused = vi.spyOn(HTMLElement.prototype, 'focus') as unknown as typeof focused;
    });
    afterEach(() => {
      delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
      focused.mockRestore();
    });
    /** Every focus the view gave a row since `from` was without scrolling, and nothing was scrolled into view. */
    const noScroll = (from: number) => {
      const calls = focused.mock.calls as unknown as Array<[FocusOptions | undefined]>;
      const targets = focused.mock.contexts as unknown as HTMLElement[];
      const rows = calls.slice(from).filter((_call, i) => targets[from + i]!.classList.contains('bd-nmain'));
      expect(rows.length).toBeGreaterThan(0);
      for (const [options] of rows) expect(options).toEqual({ preventScroll: true });
      expect(scrolled).not.toHaveBeenCalled();
    };

    it('Defer: focus goes to the next row, chosen before the write, without scrolling', async () => {
      let stuckBeads = [STUCK, STUCK2, STUCK3];
      const { store } = setup((call) => {
        if (call.route === 'deferBead') {
          const done = { ...STUCK2, status: 'deferred' };
          stuckBeads = [STUCK, done, STUCK3];
          return json({ ok: true, bead: done });
        }
        return json(needsProject({ beads: [REVIEW, ASK, ...stuckBeads, CHANGED] }));
      });
      await open(store);
      await click(within(rowOf('p-stk2', 'stuck')).getByRole('button', { name: 'Defer' }));
      const box = within(rowOf('p-stk2', 'stuck')).getByRole('textbox', { name: 'Defer until' });
      await type(box, '+2d');
      const from = focused.mock.calls.length;
      await act(async () => {
        fireEvent.keyDown(box, { key: 'Enter' });
        await flush();
      });
      expect(document.querySelector('[data-row="stuck:p-stk2"]')).toBeNull();
      expect(document.activeElement).toBe(rowMain('p-stk3', 'stuck'));
      noScroll(from);
    });

    it('Dismiss: focus goes to the row after the request, without scrolling', async () => {
      const { store } = setup((call) => (call.route === 'humanDismiss' ? json({ ok: true, bead: { ...ASK, status: 'closed' } }) : json(needsProject())));
      await open(store);
      const dismiss = within(rowOf('p-ask', 'asked')).getByRole('button', { name: 'Dismiss' });
      await act(async () => {
        dismiss.focus();
        await flush();
      });
      const from = focused.mock.calls.length;
      await click(dismiss);
      expect(document.activeElement).toBe(rowMain('p-stk', 'stuck'));
      noScroll(from);
    });

    it('Respond: focus goes to the row after the request, without scrolling', async () => {
      const { store } = setup((call) => (call.route === 'humanRespond' ? json({ ok: true, bead: { ...ASK, status: 'closed' } }) : json(needsProject())));
      await open(store);
      await click(within(rowOf('p-ask', 'asked')).getByRole('button', { name: 'Respond' }));
      await type(within(rowOf('p-ask', 'asked')).getByRole('textbox', { name: 'Your answer' }), 'eu-west');
      const from = focused.mock.calls.length;
      await click(within(rowOf('p-ask', 'asked')).getByRole('button', { name: 'Send' }));
      expect(document.activeElement).toBe(rowMain('p-stk', 'stuck'));
      noScroll(from);
    });

    it('Resolve: the row stays and keeps focus, without scrolling', async () => {
      const { store } = setup((call) => (call.route === 'gateResolve' ? json({ ok: true, gateId: 'p-g1' }) : json(needsProject())));
      await open(store);
      const resolve = within(rowOf('p-rev', 'waiting')).getByRole('button', { name: 'Resolve' });
      await act(async () => {
        resolve.focus();
        await flush();
      });
      const from = focused.mock.calls.length;
      await click(resolve);
      expect(document.activeElement).toBe(rowMain('p-rev', 'waiting'));
      noScroll(from);
    });

    it('Resolve: focus the person moved elsewhere during the write stays there', async () => {
      const answer = deferred<Answer>();
      const { store } = setup((call) => (call.route === 'gateResolve' ? answer.promise : json(needsProject())));
      await open(store);
      await click(within(rowOf('p-rev', 'waiting')).getByRole('button', { name: 'Resolve' }));
      const elsewhere = within(rowOf('p-stk', 'stuck')).getByRole('button', { name: 'Keep' });
      await act(async () => {
        elsewhere.focus();
        await flush();
      });
      const from = focused.mock.calls.length;
      await act(async () => {
        answer.resolve(json({ ok: true, gateId: 'p-g1' }));
        await flush();
      });
      expect(document.activeElement).toBe(elsewhere);
      expect(focused.mock.calls.length).toBe(from);
      expect(scrolled).not.toHaveBeenCalled();
    });

    it('Back from a bead opened with the mouse: focus returns to its row without scrolling', async () => {
      const { store } = setup((call) => (call.route === 'bead' ? json({ bead: STUCK, related: { parent: null, children: [], deps: [] } }) : json(needsProject())));
      await open(store);
      await click(within(rowOf('p-stk', 'stuck')).getByText('Rewrite the retry policy'));
      expect(store.get().detail).not.toBeNull();
      const from = focused.mock.calls.length;
      await act(async () => {
        store.back();
        await flush();
      });
      expect(document.activeElement).toBe(rowMain('p-stk', 'stuck'));
      noScroll(from);
    });
  });

  it('a gate that blocks two beads: while one row resolves it, the other row cannot send it again', async () => {
    const other = bead('p-rev2', { title: 'Second bead under the same review' });
    const answer = deferred<Answer>();
    const { store, calls } = setup((call) =>
      call.route === 'gateResolve' ? answer.promise : json(needsProject({ beads: [REVIEW, other, ASK, STUCK, CHANGED], gates: [gate('p-g1', ['p-rev', 'p-rev2'])] })),
    );
    await open(store);
    await click(within(rowOf('p-rev', 'waiting')).getByRole('button', { name: 'Resolve' }));
    const second = within(rowOf('p-rev2', 'waiting')).getByRole('button', { name: 'Resolve' }) as HTMLButtonElement;
    expect(second.disabled).toBe(true);
    await click(second);
    expect(calls.filter((c) => c.route === 'gateResolve')).toHaveLength(1);
    await act(async () => {
      answer.resolve(json({ ok: true, gateId: 'p-g1' }));
      await flush();
    });
    // Both rows hold the resolved gate: both say so, neither offers Resolve.
    expect(within(rowOf('p-rev2', 'waiting')).getByText('Resolved. Updating the list.')).toBeTruthy();
    expect(rowOf('p-rev2', 'waiting').querySelector('button')).toBeNull();
  });

  it('opens Needs me by default only with items', async () => {
    const { store } = setup(() => json(needsProject()));
    await open(store);
    expect(screen.getByRole('heading', { name: /Waiting for your review/ })).toBeTruthy();

    cleanup();
    const again = setup(() => json(liveSnapshot({ beads: EPIC_BEADS })));
    await open(again.store);
    expect(document.querySelector('.bd-needs')).toBeNull();
    expect(screen.getByText('Offline playback')).toBeTruthy();
  });

  it('search narrows the rows and offers a way back when nothing matches', async () => {
    const { store } = setup(() => json(needsProject()));
    await open(store);
    await type(screen.getByRole('searchbox'), 'staging');
    expect(headings()).toEqual(['Asked for help']);
    await type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('Nothing here matches.')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Clear search' }));
    expect(headings()).toHaveLength(4);
  });

  it('write buttons are off while writes are paused; Keep still works', async () => {
    const { store } = setup(() => json(needsProject({ writesBlocked: true })));
    await open(store);
    expect((screen.getByRole('button', { name: 'Resolve' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Respond' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Keep' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('DateInput', () => {
  it('shows the date Beads will store, or says Beads will read it', async () => {
    const seen: string[] = [];
    const view = render(<DateInput label="Due" value="2026-10-20" onInput={(t) => seen.push(t)} now={NOW} zone="UTC" />);
    expect(view.container.querySelector('.bd-date-preview')!.textContent).toBe('Tue, Oct 20');
    view.rerender(<DateInput label="Due" value="soonish" onInput={() => {}} now={NOW} zone="UTC" />);
    expect(view.container.querySelector('.bd-date-preview')!.textContent).toBe(BEADS_READS);
    view.rerender(<DateInput label="Due" value="" onInput={(t) => seen.push(t)} now={NOW} zone="UTC" />);
    expect(view.container.querySelector('.bd-date-preview')!.getAttribute('data-kind')).toBe('hint');
    fireEvent.input(screen.getByRole('textbox', { name: 'Due' }), { target: { value: '+1w' } });
    expect(seen).toEqual(['+1w']);
  });
});

describe('Memories page', () => {
  type Mem = { key: string; text: string; changedAt: string | null; changedBy: string | null };
  const TESTS: Mem = { key: 'tests-before-merge', text: 'Run the full test suite before asking for a review.', changedAt: iso(2 * 3_600_000), changedBy: 'Alice Tester' };
  const REGION: Mem = { key: 'staging-region', text: 'Staging lives in eu-west.', changedAt: iso(3 * DAY), changedBy: null };
  const WINDOW: Mem = { key: 'release-window', text: 'Releases go out Tuesday and Thursday.', changedAt: null, changedBy: null };
  const MEMS = [TESTS, REGION, WINDOW];

  /** Answers the snapshot and the memories; `on` answers the memory writes. */
  function memSetup(on: (call: Call) => Answer | Promise<Answer> | undefined = () => undefined, list: () => Mem[] = () => MEMS) {
    return setup((call) => {
      const own = on(call);
      if (own) return own;
      if (call.route === 'memories') return json({ memories: list(), fingerprint: 'f1' });
      return json(liveSnapshot({ beads: [bead('p-1')] }));
    });
  }

  /** A write and the read after it are several answers deep, and the page reads in an effect: let all of it land. */
  const settled = async () => {
    for (let i = 0; i < 6; i++) await flush();
  };
  const click = (el: Element) =>
    act(async () => {
      fireEvent.click(el);
      await settled();
    });
  const type = (el: Element, value: string) =>
    act(async () => {
      fireEvent.input(el, { target: { value } });
      await settled();
    });
  /** A key to `target`; `mod` holds Ctrl (the save key off a Mac). */
  const press = (key: string, target: Element, mod = false) =>
    act(async () => {
      fireEvent.keyDown(target, { key, ctrlKey: mod });
      await settled();
    });

  async function openMemories(store: Store) {
    await open(store);
    await click(screen.getByRole('button', { name: 'demo' }));
    await click(screen.getByRole('button', { name: /^Memories/ }));
    await act(settled);
  }

  const itemOf = (key: string) => document.getElementById(`bd-memkey-${key}`)!.closest<HTMLElement>('li')!;
  const memoryReads = (calls: Call[]) => calls.filter((c) => c.route === 'memories');
  const writesOf = (calls: Call[]) => calls.filter((c) => c.route === 'memoryRemember' || c.route === 'memoryForget');

  it('opens from the project menu with its line, reads the memories once, and Back returns to the list', async () => {
    const { store, calls } = memSetup();
    await openMemories(store);
    expect(store.get().page).toBe('memories');
    expect(screen.getByText('Every agent session in this project starts with these.')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Memories' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    // The list tools are for beads; the page has its own search.
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull();
    // Read on open, then never again by itself.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(memoryReads(calls)).toHaveLength(1);
    await click(screen.getByRole('button', { name: 'Back' }));
    expect(store.get().page).toBe('list');
    expect(screen.queryByText('Every agent session in this project starts with these.')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'demo' }));
  });

  it('is plain lists: no listbox and no option', async () => {
    const { store } = memSetup();
    await openMemories(store);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('newest first with unknown dates last, and no date said when none is known', async () => {
    // Out of order on purpose: the page does not trust the order it was given.
    const { store } = memSetup(undefined, () => [WINDOW, REGION, TESTS]);
    await openMemories(store);
    const keys = within(screen.getByRole('list', { name: 'Memories' }))
      .getAllByRole('listitem')
      .map((li) => li.querySelector('.bd-mem-key')!.textContent);
    expect(keys).toEqual(['tests-before-merge', 'staging-region', 'release-window']);
    expect(itemOf('tests-before-merge').querySelector('.bd-mem-meta')!.textContent).toBe('Changed 2h ago by Alice Tester');
    expect(itemOf('staging-region').querySelector('.bd-mem-meta')!.textContent).toBe('Changed 3d ago');
    expect(itemOf('release-window').querySelector('.bd-mem-meta')).toBeNull();
  });

  it('an empty project says so plainly', async () => {
    const { store } = memSetup(undefined, () => []);
    await openMemories(store);
    expect(screen.getByText('No memories yet.')).toBeTruthy();
  });

  it('search sends the query', async () => {
    const { store, calls } = memSetup();
    await openMemories(store);
    await type(screen.getByRole('searchbox', { name: 'Search memories' }), 'staging');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(memoryReads(calls).map((c) => c.body)).toEqual([{ directory: '/p/a' }, { directory: '/p/a', query: 'staging' }]);
  });

  it('forget needs the confirm step with the text shown', async () => {
    const { store, calls } = memSetup((call) => (call.route === 'memoryForget' ? json({ ok: true, memory: null }) : undefined));
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Forget' }));
    expect(writesOf(calls)).toEqual([]);
    const step = within(itemOf('staging-region')).getByRole('group', { name: 'Forget staging-region?' });
    expect(within(step).getByText('Staging lives in eu-west.')).toBeTruthy();
    expect(within(step).getByText('Every agent session in this project will stop seeing this.')).toBeTruthy();
    // Cancel leaves it, and sends nothing.
    await click(within(step).getByRole('button', { name: 'Cancel' }));
    expect(writesOf(calls)).toEqual([]);
    expect(within(itemOf('staging-region')).getByRole('button', { name: 'Forget' })).toBeTruthy();
    // Only the distinct second button forgets.
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Forget' }));
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Forget memory' }));
    expect(writesOf(calls)).toHaveLength(1);
  });

  it('forget sends expectedText', async () => {
    const { store, calls } = memSetup((call) => (call.route === 'memoryForget' ? json({ ok: true, memory: null }) : undefined));
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Forget' }));
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Forget memory' }));
    expect(writesOf(calls).map((c) => [c.route, c.body])).toEqual([['memoryForget', { directory: '/p/a', key: 'staging-region', expectedText: 'Staging lives in eu-west.' }]]);
  });

  it('a read that changes a memory under an open forget step shows the new text and forgets nothing until asked again', async () => {
    const THEIRS = 'Staging moved to eu-central.';
    let list = MEMS;
    const { store, calls } = memSetup((call) => (call.route === 'memoryForget' ? json({ ok: true, memory: null }) : undefined), () => list);
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Forget' }));
    // Someone changes it; the page reads again (here, for a search) while the step is open.
    list = [TESTS, { ...REGION, text: THEIRS }, WINDOW];
    await type(screen.getByRole('searchbox', { name: 'Search memories' }), 'e');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    const step = within(itemOf('staging-region')).getByRole('group', { name: 'Forget staging-region?' });
    expect(within(step).getByRole('alert').textContent).toMatch(/changed since you opened this step/);
    expect(within(step).getByText(THEIRS)).toBeTruthy();
    expect(within(step).queryByText('Staging lives in eu-west.')).toBeNull();
    expect(document.activeElement).toBe(within(step).getByRole('button', { name: 'Cancel' }));
    expect(writesOf(calls)).toEqual([]);
    await click(within(step).getByRole('button', { name: 'Forget memory' }));
    expect(writesOf(calls).map((c) => c.body.expectedText)).toEqual([THEIRS]);
  });

  it('a forget refused for newer text asks again with that text; one already gone just leaves', async () => {
    const THEIRS = 'Staging moved to eu-central.';
    let n = 0;
    const { store, calls } = memSetup((call) => {
      if (call.route !== 'memoryForget') return undefined;
      if (call.body.key === 'release-window') return json({ ok: false, code: 'changed', current: null });
      n += 1;
      return n === 1 ? json({ ok: false, code: 'changed', current: { ...REGION, text: THEIRS } }) : json({ ok: true, memory: null });
    });
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Forget' }));
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Forget memory' }));
    const step = within(itemOf('staging-region')).getByRole('group', { name: 'Forget staging-region?' });
    expect(within(step).getByText(THEIRS)).toBeTruthy();
    expect(document.activeElement).toBe(within(step).getByRole('button', { name: 'Cancel' }));
    await click(within(step).getByRole('button', { name: 'Forget memory' }));
    expect(writesOf(calls).map((c) => c.body.expectedText)).toEqual(['Staging lives in eu-west.', THEIRS]);

    await click(within(itemOf('release-window')).getByRole('button', { name: 'Forget' }));
    await click(within(itemOf('release-window')).getByRole('button', { name: 'Forget memory' }));
    expect(screen.queryByText('Forgot release-window.')).toBeNull();
  });

  it('after a forget, Undo brings back the same name and text', async () => {
    let list = MEMS;
    const { store, calls } = memSetup(
      (call) => {
        if (call.route === 'memoryForget') {
          list = [TESTS, WINDOW];
          return json({ ok: true, memory: null });
        }
        if (call.route === 'memoryRemember') {
          list = MEMS;
          return json({ ok: true, memory: REGION });
        }
        return undefined;
      },
      () => list,
    );
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Forget' }));
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Forget memory' }));
    // The list is read again after the write.
    expect(document.getElementById('bd-memkey-staging-region')).toBeNull();
    expect(screen.getByText('Forgot staging-region.').closest('[role="status"]')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Undo' }));
    expect(writesOf(calls).map((c) => [c.route, c.body])).toEqual([
      ['memoryForget', { directory: '/p/a', key: 'staging-region', expectedText: 'Staging lives in eu-west.' }],
      ['memoryRemember', { directory: '/p/a', key: 'staging-region', text: 'Staging lives in eu-west.' }],
    ]);
    expect(document.getElementById('bd-memkey-staging-region')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('edit keeps the old text visible until saved', async () => {
    let list = MEMS;
    const NEW = 'Staging lives in eu-west-2.';
    const { store, calls } = memSetup(
      (call) => {
        if (call.route !== 'memoryRemember') return undefined;
        const memory = { ...REGION, text: NEW, changedAt: iso(0), changedBy: 'Alice Tester (panel)' };
        list = [memory, TESTS, WINDOW];
        return json({ ok: true, memory });
      },
      () => list,
    );
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Edit' }));
    const field = within(itemOf('staging-region')).getByRole('textbox', { name: 'New text' }) as HTMLTextAreaElement;
    expect(field.value).toBe('Staging lives in eu-west.');
    expect(document.activeElement).toBe(field);
    await type(field, NEW);
    // The text as it is stays on screen while the new one is typed.
    expect(within(itemOf('staging-region')).getByText('Staging lives in eu-west.')).toBeTruthy();
    expect(writesOf(calls)).toEqual([]);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Save' }));
    expect(writesOf(calls).map((c) => c.body)).toEqual([{ directory: '/p/a', key: 'staging-region', text: NEW, expectedText: 'Staging lives in eu-west.' }]);
    expect(within(itemOf('staging-region')).queryByRole('textbox')).toBeNull();
    expect(within(itemOf('staging-region')).getByText(NEW)).toBeTruthy();
    expect(within(itemOf('staging-region')).queryByText('Staging lives in eu-west.')).toBeNull();
    expect(memoryReads(calls)).toHaveLength(2);
    // The saved memory moved to the top; focus stayed on its Edit button.
    expect(itemOf('staging-region').parentElement!.firstElementChild).toBe(itemOf('staging-region'));
    expect(document.activeElement).toBe(within(itemOf('staging-region')).getByRole('button', { name: 'Edit' }));
  });

  it('a changed answer shows the current text and writes nothing more', async () => {
    const THEIRS = 'Staging moved to eu-central.';
    const { store, calls } = memSetup((call) =>
      call.route === 'memoryRemember' ? json({ ok: false, code: 'changed', current: { ...REGION, text: THEIRS, changedBy: 'Claude Code' } }) : undefined,
    );
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Edit' }));
    await type(within(itemOf('staging-region')).getByRole('textbox', { name: 'New text' }), 'Staging lives in eu-west-2.');
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Save' }));
    const item = itemOf('staging-region');
    expect(within(item).getByRole('alert').textContent).toMatch(/changed elsewhere while you were editing\. Nothing was saved\./);
    // Both texts, side by side: what is stored now and what the person typed (kept).
    expect(within(item).getByText(THEIRS)).toBeTruthy();
    expect((within(item).getByRole('textbox', { name: 'New text' }) as HTMLTextAreaElement).value).toBe('Staging lives in eu-west-2.');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(writesOf(calls)).toHaveLength(1);
    // Keep current drops the edit and reads the memories again; nothing is written.
    await click(within(item).getByRole('button', { name: 'Keep current' }));
    expect(writesOf(calls)).toHaveLength(1);
    expect(memoryReads(calls)).toHaveLength(2);
    expect(within(itemOf('staging-region')).queryByRole('textbox')).toBeNull();
  });

  it('after a changed answer, Save mine anyway is a deliberate second send against the current text', async () => {
    const THEIRS = 'Staging moved to eu-central.';
    let n = 0;
    const { store, calls } = memSetup((call) => {
      if (call.route !== 'memoryRemember') return undefined;
      n += 1;
      return n === 1 ? json({ ok: false, code: 'changed', current: { ...REGION, text: THEIRS } }) : json({ ok: true, memory: { ...REGION, text: 'Mine' } });
    });
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Edit' }));
    await type(within(itemOf('staging-region')).getByRole('textbox', { name: 'New text' }), 'Mine');
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Save' }));
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Save mine anyway' }));
    expect(writesOf(calls).map((c) => c.body.expectedText)).toEqual(['Staging lives in eu-west.', THEIRS]);
  });

  it('an edit of a memory forgotten elsewhere says so and offers to add it again', async () => {
    const { store, calls } = memSetup((call) => (call.route === 'memoryRemember' && call.body.expectedText !== undefined ? json({ ok: false, code: 'changed', current: null }) : call.route === 'memoryRemember' ? json({ ok: true, memory: REGION }) : undefined));
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Edit' }));
    await type(within(itemOf('staging-region')).getByRole('textbox', { name: 'New text' }), 'Mine');
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Save' }));
    expect(within(itemOf('staging-region')).getByRole('alert').textContent).toMatch(/This memory was removed elsewhere\. Nothing was saved\./);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Add it again' }));
    expect(writesOf(calls).map((c) => c.body)).toEqual([
      { directory: '/p/a', key: 'staging-region', text: 'Mine', expectedText: 'Staging lives in eu-west.' },
      { directory: '/p/a', key: 'staging-region', text: 'Mine' },
    ]);
  });

  it('Discard lets a memory removed elsewhere go, writing nothing', async () => {
    let list = MEMS;
    const { store, calls } = memSetup(
      (call) => {
        if (call.route !== 'memoryRemember') return undefined;
        list = [TESTS, WINDOW];
        return json({ ok: false, code: 'changed', current: null });
      },
      () => list,
    );
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Edit' }));
    await type(within(itemOf('staging-region')).getByRole('textbox', { name: 'New text' }), 'Mine');
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Save' }));
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Discard' }));
    expect(document.getElementById('bd-memkey-staging-region')).toBeNull();
    expect(writesOf(calls)).toHaveLength(1);
    // Focus goes on to the memory that took its place.
    expect(document.activeElement).toBe(within(itemOf('release-window')).getByRole('button', { name: 'Edit' }));
  });

  it('an open edit stays on screen with its typed text when a read no longer lists the memory', async () => {
    let list = MEMS;
    const { store, calls } = memSetup(
      (call) => (call.route === 'memoryForget' ? ((list = list.filter((m) => m.key !== call.body.key)), json({ ok: true, memory: null })) : call.route === 'memoryRemember' ? json({ ok: true, memory: REGION }) : undefined),
      () => list,
    );
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Edit' }));
    await type(within(itemOf('staging-region')).getByRole('textbox', { name: 'New text' }), 'Mine, half typed');
    // Removed elsewhere, then the page reads again (after a forget of another memory).
    list = [TESTS, WINDOW];
    await click(within(itemOf('tests-before-merge')).getByRole('button', { name: 'Forget' }));
    await click(within(itemOf('tests-before-merge')).getByRole('button', { name: 'Forget memory' }));
    const item = itemOf('staging-region');
    expect(within(item).getByRole('alert').textContent).toBe('This memory was removed elsewhere. Nothing was saved. Add it again with your text, or discard it.');
    expect((within(item).getByRole('textbox', { name: 'New text' }) as HTMLTextAreaElement).value).toBe('Mine, half typed');
    expect(within(item).getByText('Staging lives in eu-west.')).toBeTruthy();
    await click(within(item).getByRole('button', { name: 'Add it again' }));
    expect(writesOf(calls).at(-1)?.body).toEqual({ directory: '/p/a', key: 'staging-region', text: 'Mine, half typed' });
  });

  it('a search that leaves out an open edit keeps it on screen; a failed read keeps the list', async () => {
    let fail = false;
    const { store } = setup((call) => {
      if (call.route === 'memories') {
        if (fail) return envelope(503, { code: 'busy', message: 'Beads is busy.' });
        const q = typeof call.body.query === 'string' ? call.body.query : '';
        return json({ memories: MEMS.filter((m) => m.text.includes(q)), fingerprint: 'f1' });
      }
      return json(liveSnapshot({ beads: [bead('p-1')] }));
    });
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Edit' }));
    await type(within(itemOf('staging-region')).getByRole('textbox', { name: 'New text' }), 'Mine');
    await type(screen.getByRole('searchbox', { name: 'Search memories' }), 'Releases');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(document.getElementById('bd-memkey-tests-before-merge')).toBeNull();
    expect((within(itemOf('staging-region')).getByRole('textbox', { name: 'New text' }) as HTMLTextAreaElement).value).toBe('Mine');
    expect(within(itemOf('staging-region')).queryByRole('alert')).toBeNull();
    expect(within(itemOf('staging-region')).getByText('Shown while you edit it, though the search leaves it out.')).toBeTruthy();
    fail = true;
    await type(screen.getByRole('searchbox', { name: 'Search memories' }), '');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(screen.getByText(/Could not read the memories again: Beads is busy\./)).toBeTruthy();
    expect((within(itemOf('staging-region')).getByRole('textbox', { name: 'New text' }) as HTMLTextAreaElement).value).toBe('Mine');
    expect(document.getElementById('bd-memkey-release-window')).toBeTruthy();
  });

  it('a read that shows an open edit changed elsewhere turns it into the changed choice', async () => {
    const THEIRS = 'Staging moved to eu-central.';
    let list = MEMS;
    const { store, calls } = memSetup(undefined, () => list);
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Edit' }));
    await type(within(itemOf('staging-region')).getByRole('textbox', { name: 'New text' }), 'Mine');
    list = [TESTS, { ...REGION, text: THEIRS }, WINDOW];
    await type(screen.getByRole('searchbox', { name: 'Search memories' }), 'e');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    const item = itemOf('staging-region');
    expect(within(item).getByRole('alert').textContent).toMatch(/changed elsewhere while you were editing/);
    expect(within(item).getByText(THEIRS)).toBeTruthy();
    expect(within(item).getByRole('button', { name: 'Save mine anyway' })).toBeTruthy();
    expect(writesOf(calls)).toEqual([]);
  });

  it('Escape in a step closes the step; Escape elsewhere on the page is Back', async () => {
    const { store } = memSetup();
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Edit' }));
    const field = within(itemOf('staging-region')).getByRole('textbox', { name: 'New text' });
    await press('Escape', field);
    expect(store.get().page).toBe('memories');
    expect(within(itemOf('staging-region')).queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(within(itemOf('staging-region')).getByRole('button', { name: 'Edit' }));
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Forget' }));
    await press('Escape', within(itemOf('staging-region')).getByRole('button', { name: 'Cancel' }));
    expect(store.get().page).toBe('memories');
    expect(document.activeElement).toBe(within(itemOf('staging-region')).getByRole('button', { name: 'Forget' }));
    await press('Escape', document.activeElement!);
    expect(store.get().page).toBe('list');
  });

  it('Cancel or Escape with typed text asks first; Keep editing keeps it, Discard lets it go', async () => {
    const { store, calls } = memSetup();
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Edit' }));
    const field = within(itemOf('staging-region')).getByRole('textbox', { name: 'New text' }) as HTMLTextAreaElement;
    await type(field, 'Mine');
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Cancel' }));
    const ask = within(itemOf('staging-region')).getByRole('alertdialog', { name: 'Discard your changes?' });
    expect(document.activeElement).toBe(ask);
    await click(within(ask).getByRole('button', { name: 'Keep editing' }));
    expect(field.value).toBe('Mine');
    expect(document.activeElement).toBe(field);
    await press('Escape', field);
    expect(store.get().page).toBe('memories');
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Discard' }));
    expect(within(itemOf('staging-region')).queryByRole('textbox')).toBeNull();
    expect(writesOf(calls)).toEqual([]);

    // The new memory asks the same way.
    await click(screen.getByRole('button', { name: 'Add' }));
    await type(screen.getByRole('textbox', { name: 'Memory' }), 'Half a thought');
    await press('Escape', screen.getByRole('textbox', { name: 'Memory' }));
    const askNew = screen.getByRole('alertdialog', { name: 'Discard this memory?' });
    await press('Escape', askNew);
    expect((screen.getByRole('textbox', { name: 'Memory' }) as HTMLTextAreaElement).value).toBe('Half a thought');
  });

  it('Escape in a refused edit asks and makes no choice for the person', async () => {
    const { store, calls } = memSetup((call) => (call.route === 'memoryRemember' ? json({ ok: false, code: 'changed', current: { ...REGION, text: 'Theirs' } }) : undefined));
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Edit' }));
    const field = within(itemOf('staging-region')).getByRole('textbox', { name: 'New text' });
    await type(field, 'Mine');
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Save' }));
    await press('Escape', field);
    expect(within(itemOf('staging-region')).getByRole('alertdialog', { name: 'Discard your changes?' })).toBeTruthy();
    expect((field as HTMLTextAreaElement).value).toBe('Mine');
    expect(within(itemOf('staging-region')).getByText('Theirs')).toBeTruthy();
    expect(memoryReads(calls)).toHaveLength(1);
    expect(writesOf(calls)).toHaveLength(1);
    expect(store.get().page).toBe('memories');
  });

  it('Back with typed text asks first; Discard leaves, Keep editing stays', async () => {
    const { store } = memSetup();
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Edit' }));
    await type(within(itemOf('staging-region')).getByRole('textbox', { name: 'New text' }), 'Mine');
    await click(screen.getByRole('button', { name: 'Back' }));
    expect(store.get().page).toBe('memories');
    const ask = screen.getByRole('alertdialog', { name: 'Discard your unsaved text?' });
    await click(within(ask).getByRole('button', { name: 'Keep editing' }));
    expect(document.activeElement).toBe(within(itemOf('staging-region')).getByRole('textbox', { name: 'New text' }));
    // The page's own Escape (from a button) asks too.
    await press('Escape', screen.getByRole('button', { name: 'Back' }));
    await click(within(screen.getByRole('alertdialog', { name: 'Discard your unsaved text?' })).getByRole('button', { name: 'Discard' }));
    expect(store.get().page).toBe('list');
    // Nothing is kept after a discard.
    await click(screen.getByRole('button', { name: 'demo' }));
    await click(screen.getByRole('button', { name: /^Memories/ }));
    await act(settled);
    expect(within(itemOf('staging-region')).queryByRole('textbox')).toBeNull();
  });

  it('typed text survives a switch to another project and back', async () => {
    const { store } = memSetup();
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Edit' }));
    await type(within(itemOf('staging-region')).getByRole('textbox', { name: 'New text' }), 'Mine');
    await click(screen.getByRole('button', { name: 'Add' }));
    await type(screen.getByRole('textbox', { name: 'Memory' }), 'A new rule');
    await type(screen.getByRole('textbox', { name: 'Name (optional)' }), 'new-rule');
    await open(store, '/p/b');
    expect(store.get().page).toBe('list');
    await openMemories(store);
    expect((within(itemOf('staging-region')).getByRole('textbox', { name: 'New text' }) as HTMLTextAreaElement).value).toBe('Mine');
    expect(within(itemOf('staging-region')).getByText('Staging lives in eu-west.')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Memory' }) as HTMLTextAreaElement).value).toBe('A new rule');
    expect((screen.getByRole('textbox', { name: 'Name (optional)' }) as HTMLInputElement).value).toBe('new-rule');
  });

  it('a field stays focused and read-only, not disabled, while it saves', async () => {
    const saving = deferred<Answer>();
    const { store } = memSetup((call) => (call.route === 'memoryRemember' ? saving.promise : undefined));
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Edit' }));
    const field = within(itemOf('staging-region')).getByRole('textbox', { name: 'New text' }) as HTMLTextAreaElement;
    await type(field, 'Mine');
    await press('Enter', field, true);
    expect(field.readOnly).toBe(true);
    expect(field.disabled).toBe(false);
    expect(document.activeElement).toBe(field);
    await act(async () => {
      saving.resolve(json({ ok: true, memory: { ...REGION, text: 'Mine' } }));
      await settled();
    });
  });

  it('Undo refused because the name is taken keeps the forgotten text on screen', async () => {
    let list = MEMS;
    const { store } = memSetup(
      (call) => {
        if (call.route === 'memoryForget') {
          list = [TESTS, WINDOW];
          return json({ ok: true, memory: null });
        }
        return call.route === 'memoryRemember' ? json({ ok: false, code: 'changed', current: { ...REGION, text: 'Other' } }) : undefined;
      },
      () => list,
    );
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Forget' }));
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Forget memory' }));
    await click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText(/Could not bring back staging-region/)).toBeTruthy();
    expect(screen.getByText('Staging lives in eu-west.')).toBeTruthy();
  });

  it('add sends the text and the name when given; Cmd/Ctrl+Enter adds', async () => {
    let list = MEMS;
    const NEW: Mem = { key: 'deploy-from-main', text: 'Deploy only from main.', changedAt: iso(0), changedBy: 'Alice Tester (panel)' };
    const { store, calls } = memSetup(
      (call) => {
        if (call.route !== 'memoryRemember') return undefined;
        list = [NEW, ...MEMS];
        return json({ ok: true, memory: NEW });
      },
      () => list,
    );
    await openMemories(store);
    await click(screen.getByRole('button', { name: 'Add' }));
    const text = screen.getByRole('textbox', { name: 'Memory' });
    expect(document.activeElement).toBe(text);
    expect(screen.getByText(/Beads makes one from the text/)).toBeTruthy();
    await type(text, 'Deploy only from main.');
    await act(async () => {
      fireEvent.keyDown(text, { key: 'Enter', ctrlKey: true });
      await settled();
    });
    expect(writesOf(calls).map((c) => c.body)).toEqual([{ directory: '/p/a', text: 'Deploy only from main.' }]);
    expect(document.getElementById('bd-memkey-deploy-from-main')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Memory' })).toBeNull();

    cleanup();
    const again = memSetup((call) => (call.route === 'memoryRemember' ? json({ ok: true, memory: NEW }) : undefined));
    await openMemories(again.store);
    await click(screen.getByRole('button', { name: 'Add' }));
    await type(screen.getByRole('textbox', { name: 'Memory' }), 'Deploy only from main.');
    await type(screen.getByRole('textbox', { name: 'Name (optional)' }), 'deploy-rule');
    await click(screen.getByRole('button', { name: 'Add memory' }));
    expect(writesOf(again.calls).map((c) => c.body)).toEqual([{ directory: '/p/a', text: 'Deploy only from main.', key: 'deploy-rule' }]);
  });

  it('a plain Enter in a memory field is a new line and sends nothing', async () => {
    const { store, calls } = memSetup();
    await openMemories(store);
    await click(screen.getByRole('button', { name: 'Add' }));
    const text = screen.getByRole('textbox', { name: 'Memory' });
    await type(text, 'Half a thought');
    await press('Enter', text);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Edit' }));
    const field = within(itemOf('staging-region')).getByRole('textbox', { name: 'New text' });
    await type(field, 'Staging lives in');
    await press('Enter', field);
    expect(writesOf(calls)).toEqual([]);
    expect(screen.getByText(/⌘↵ adds|Ctrl\+Enter adds/)).toBeTruthy();
  });

  it('after a refusal the save key sends nothing: overriding takes a button', async () => {
    const THEIRS = 'Staging moved to eu-central.';
    const { store, calls } = memSetup((call) =>
      call.route === 'memoryRemember' && call.body.key === 'staging-region'
        ? json({ ok: false, code: 'changed', current: { ...REGION, text: THEIRS } })
        : call.route === 'memoryRemember'
          ? json({ ok: false, code: 'changed', current: null })
          : undefined,
    );
    await openMemories(store);
    for (const key of ['staging-region', 'release-window']) {
      await click(within(itemOf(key)).getByRole('button', { name: 'Edit' }));
      const field = within(itemOf(key)).getByRole('textbox', { name: 'New text' });
      await type(field, 'Mine');
      await press('Enter', field, true);
      expect(within(itemOf(key)).getByRole('alert')).toBeTruthy();
      await press('Enter', field, true);
    }
    expect(writesOf(calls)).toHaveLength(2);
  });

  it('add with an existing key is refused with the current memory', async () => {
    const { store, calls } = memSetup((call) => (call.route === 'memoryRemember' ? json({ ok: false, code: 'changed', current: REGION }) : undefined));
    await openMemories(store);
    await click(screen.getByRole('button', { name: 'Add' }));
    await type(screen.getByRole('textbox', { name: 'Memory' }), 'Staging is in us-east.');
    await type(screen.getByRole('textbox', { name: 'Name (optional)' }), 'staging-region');
    await click(screen.getByRole('button', { name: 'Add memory' }));
    const box = screen.getByRole('group', { name: 'New memory' });
    expect(within(box).getByRole('alert').textContent).toMatch(/A memory named staging-region already exists\. Nothing was saved\./);
    expect(within(box).getByText('Staging lives in eu-west.')).toBeTruthy();
    // What was typed is kept, to rename or to drop.
    expect((within(box).getByRole('textbox', { name: 'Memory' }) as HTMLTextAreaElement).value).toBe('Staging is in us-east.');
    expect(writesOf(calls)).toHaveLength(1);
  });

  it('reserved key message', async () => {
    const message = '"schema_version" is a name Beads keeps for itself. Pick another name.';
    const { store } = memSetup((call) => (call.route === 'memoryRemember' ? envelope(400, { code: 'invalid', message }) : undefined));
    await openMemories(store);
    await click(screen.getByRole('button', { name: 'Add' }));
    await type(screen.getByRole('textbox', { name: 'Memory' }), 'Anything');
    await type(screen.getByRole('textbox', { name: 'Name (optional)' }), 'schema_version');
    await click(screen.getByRole('button', { name: 'Add memory' }));
    expect(within(screen.getByRole('group', { name: 'New memory' })).getByRole('alert').textContent).toBe(message);
  });

  it("one memory's write leaves another memory's controls alone", async () => {
    const forgetting = deferred<Answer>();
    const { store, calls } = memSetup((call) => (call.route === 'memoryForget' ? forgetting.promise : undefined));
    await openMemories(store);
    await click(within(itemOf('staging-region')).getByRole('button', { name: 'Forget' }));
    const go = within(itemOf('staging-region')).getByRole('button', { name: 'Forget memory' }) as HTMLButtonElement;
    await click(go);
    expect(go.disabled).toBe(true);
    await click(go);
    expect(writesOf(calls)).toHaveLength(1);
    expect((within(itemOf('tests-before-merge')).getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(itemOf('tests-before-merge')).getByRole('button', { name: 'Forget' }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      forgetting.resolve(json({ ok: true, memory: null }));
      await flush();
    });
  });

  it('the menu has no Memories entry when this Beads cannot list them', async () => {
    const { store } = memSetup();
    await open(store);
    act(() => store.markUnsupported('memories'));
    await click(screen.getByRole('button', { name: 'demo' }));
    expect(screen.queryByRole('button', { name: /^Memories/ })).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------- task 16

describe('epics ready to close', () => {
  const epic = (id: string, over: Partial<Bead> = {}) => bead(id, { type: 'epic', title: `Epic ${id}`, ...over });
  const doneChild = (id: string, parentId: string) => bead(id, { parentId, status: 'closed', closedAt: iso(DAY) });
  const section = (id: string) => document.getElementById(`bd-row-${id}`)!.closest<HTMLElement>('section')!;
  async function epics(over: Parameters<typeof snapshot>[0], routes: Partial<Record<string, (call: Call) => Answer>> = {}) {
    const t = setup((call) => routes[call.route]?.(call) ?? (call.route === 'snapshot' ? json(liveSnapshot(over)) : json({ unseenIds: [] })));
    await open(t.store);
    await act(async () => {
      t.store.setView('epic');
      await flush();
    });
    return t;
  }

  it('epic with all children done shows Close epic', async () => {
    const beads = [epic('p-e'), doneChild('p-e.1', 'p-e'), doneChild('p-e.2', 'p-e')];
    const t = await epics({ beads }, { update: (call) => json({ ok: true, bead: { ...beads[0]!, status: (call.body.patch as { status: string }).status, updatedAt: iso(0) } }) });
    const group = section('p-e');
    expect(within(group).getByText('All children done')).toBeTruthy();
    const close = within(group).getByRole('button', { name: 'Close epic' });
    // Never inside the epic's option: a listbox holds options only.
    expect(close.closest('[role="option"], [role="listbox"]')).toBeNull();
    await click(close);
    expect(t.calls.filter((c) => c.route === 'update').map((c) => c.body)).toEqual([{ directory: '/p/a', id: 'p-e', expectedUpdatedAt: iso(DAY), patch: { status: 'closed' }, expected: { status: 'open' } }]);
  });

  it('Add a reason opens the close dialog, with the comment sent first', async () => {
    const beads = [epic('p-e'), doneChild('p-e.1', 'p-e')];
    const t = await epics({ beads }, { update: () => envelope(409, { code: 'blocked', message: "Your comment was added, but the bead could not be closed. This bead can't be closed yet. It is still waiting on p-x." }) });
    await click(within(section('p-e')).getByRole('button', { name: 'Add a reason' }));
    const dialog = within(section('p-e')).getByRole('group', { name: 'Why is it closed?' });
    await type(within(dialog).getByRole('textbox', { name: 'Close reason (optional)' }), 'Shipped');
    await type(within(dialog).getByRole('textbox', { name: 'Comment (optional)' }), 'All three landed.');
    await click(within(dialog).getByRole('button', { name: 'Close epic' }));
    expect(t.calls.filter((c) => c.route === 'update')[0]?.body).toMatchObject({ patch: { status: 'closed', closeReason: 'Shipped', closeComment: 'All three landed.' } });
    expect(screen.getByText(/^Your comment was added, but the bead could not be closed\./)).toBeTruthy();
  });

  it('an uncertain epic close whose comment went in never posts it twice', async () => {
    const child = doneChild('p-e.1', 'p-e');
    let shown = epic('p-e');
    const sent: Array<Record<string, unknown>> = [];
    const t = setup((call) => {
      if (call.route === 'snapshot') return json(liveSnapshot({ beads: [shown, child], panelActor: 'Ann (panel)', freshness: freshness({ localRefreshedAt: new Date().toISOString() }) }));
      if (call.route === 'update') {
        sent.push(call.body.patch as Record<string, unknown>);
        if (sent.length === 1) {
          shown = { ...shown, comments: [{ id: 'c1', author: 'Ann (panel)', text: 'All three landed.', createdAt: iso(0) }] };
          return json({ ok: false, uncertain: true, current: null });
        }
        return json({ ok: true, bead: { ...shown, status: 'closed', updatedAt: iso(0) } });
      }
      return json({ unseenIds: [] });
    });
    await open(t.store);
    await act(async () => {
      t.store.setView('epic');
      await flush();
    });
    await click(within(section('p-e')).getByRole('button', { name: 'Add a reason' }));
    await type(within(section('p-e')).getByRole('textbox', { name: 'Comment (optional)' }), 'All three landed.');
    await click(within(section('p-e')).getByRole('button', { name: 'Close epic' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
      await flush();
    });
    expect((within(section('p-e')).getByRole('textbox', { name: 'Comment (optional)' }) as HTMLTextAreaElement).value).toBe('');
    await click(within(section('p-e')).getByRole('button', { name: 'Close epic' }));
    expect(sent).toEqual([{ status: 'closed', closeComment: 'All three landed.' }, { status: 'closed' }]);
  });

  it('an epic close that did not answer says "It did not save." once the project was read and the epic is still open', async () => {
    const beads = [epic('p-e'), doneChild('p-e.1', 'p-e')];
    const t = setup((call) =>
      call.route === 'snapshot'
        ? json(liveSnapshot({ beads, freshness: freshness({ localRefreshedAt: new Date().toISOString() }) }))
        : call.route === 'update'
          ? json({ ok: false, uncertain: true, current: null })
          : json({ unseenIds: [] }),
    );
    await open(t.store);
    await act(async () => {
      t.store.setView('epic');
      await flush();
    });
    await click(within(section('p-e')).getByRole('button', { name: 'Close epic' }));
    expect(within(section('p-e')).getByText('This may have saved. Refreshing.')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
      await flush();
    });
    expect(within(section('p-e')).getByText('It did not save.')).toBeTruthy();
    expect(within(section('p-e')).getByRole('button', { name: 'Close epic' })).toBeTruthy();
  });

  it('childless epic does not', async () => {
    await epics({ beads: [epic('p-e'), epic('p-f'), bead('p-f.1', { parentId: 'p-f' })] });
    expect(screen.queryByText('All children done')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close epic' })).toBeNull();
  });

  it('gated epic shows no Close epic', async () => {
    const t = await epics({ beads: [epic('p-e'), doneChild('p-e.1', 'p-e')], gates: [gate('p-g1', ['p-e'])], gateIds: ['p-g1'] });
    expect(screen.queryByRole('button', { name: 'Close epic' })).toBeNull();
    // Its detail says what it waits on instead.
    await act(async () => {
      t.store.select('p-e');
      await flush();
    });
    expect(screen.queryByRole('button', { name: 'Close epic' })).toBeNull();
    expect(document.querySelector('.bd-dhint[data-tone="blocked"]')?.textContent).toContain('Waiting on a review');
  });

  it('the epic detail shows All children done with Close epic', async () => {
    const beads = [epic('p-e'), doneChild('p-e.1', 'p-e')];
    const t = await epics({ beads }, { update: (call) => json({ ok: true, bead: { ...beads[0]!, status: (call.body.patch as { status: string }).status, updatedAt: iso(0) } }), bead: () => json({ bead: beads[0], related: { parent: null, children: [beads[1]], deps: [] } }) });
    await act(async () => {
      t.store.select('p-e');
      await flush();
    });
    const detail = document.querySelector<HTMLElement>('.bd-detail')!;
    expect(within(detail).getByText('All children done')).toBeTruthy();
    await click(within(detail).getByRole('button', { name: 'Close epic' }));
    expect(t.calls.filter((c) => c.route === 'update')[0]?.body).toMatchObject({ id: 'p-e', patch: { status: 'closed' } });
    expect(within(detail).queryByText('All children done')).toBeNull();
  });
});
