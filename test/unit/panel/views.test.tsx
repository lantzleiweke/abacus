// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { createClient } from '../../../src/panel/client';
import { createStore, DEFAULT_COLLAPSED, DEFAULT_FILTERS, StoreContext, uiKey, type Filters, type Store } from '../../../src/panel/store';
import { epicView, humanize, matchesWithAll, rowOrder, shortId, statusLabel, statusLook, statusView, totals, type ListInput } from '../../../src/panel/list';
import { listKey, type KeyFocus } from '../../../src/panel/keyboard';
import { ago, shortAgo } from '../../../src/panel/format';
import { App } from '../../../src/panel/ui/App';
import type { Bead, StatusDef } from '../../../src/shared/types';
import { fakeHost, flush, freshness, json, snapshot, type Answer, type Call } from './helpers';

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
