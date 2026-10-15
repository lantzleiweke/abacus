// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { createClient } from '../../../src/panel/client';
import { createStore, StoreContext, type Store } from '../../../src/panel/store';
import { activityFeed, changeWhat, rowChange, whenOf, whoOf, type FeedInput } from '../../../src/panel/activity';
import { App } from '../../../src/panel/ui/App';
import type { Bead, ChangeEvent, StatusDef, WriteResult } from '../../../src/shared/types';
import { fakeHost, flush, freshness, json, snapshot, type Answer, type Call } from './helpers';

const NOW = new Date('2026-10-14T17:00:00Z').getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
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
  { name: 'closed', category: 'done', icon: null },
  { name: 'in_review', category: 'wip', icon: null },
  { name: 'shipped', category: 'done', icon: null },
];

type Activity = ChangeEvent & { unseen: boolean };
let n = 0;
const event = (over: Partial<Activity> & Pick<Activity, 'beadId' | 'kind'>): Activity => ({
  id: `e${++n}`,
  actor: 'Claude Code',
  byPanel: false,
  observedAt: iso(5 * MIN),
  unseen: false,
  ...over,
});

const what = (over: Partial<Activity> & Pick<Activity, 'kind'>) => changeWhat(event({ beadId: 'p-a', ...over }), STATUSES);

describe('activity entry text', () => {
  it('says what changed for every kind', () => {
    expect(what({ kind: 'created' })).toBe('Created');
    expect(what({ kind: 'closed', field: 'status', from: 'open', to: 'closed' })).toBe('Closed');
    expect(what({ kind: 'closed', reason: 'Fixed in 2.1' })).toBe('Closed · Fixed in 2.1');
    expect(what({ kind: 'closed', field: 'status', from: 'in_review', to: 'shipped', reason: 'Released' })).toBe('Closed as Shipped · Released');
    expect(what({ kind: 'reopened', field: 'status', from: 'closed', to: 'open' })).toBe('Reopened');
    expect(what({ kind: 'deleted' })).toBe('Deleted');
    expect(what({ kind: 'comment', to: 'Looks good to me' })).toBe('Commented: Looks good to me');
    expect(what({ kind: 'comment' })).toBe('Commented');
    expect(what({ kind: 'dep_added', field: 'blocks', to: 'p-x9' })).toBe('Link added: blocked by x9');
    expect(what({ kind: 'dep_removed', field: 'related', from: 'p-x9' })).toBe('Link removed: related to x9');
    expect(what({ kind: 'dep_added', field: 'discovered-from', to: 'p-x9' })).toBe('Link added: discovered from x9');
    expect(what({ kind: 'dep_added', field: 'needs-review', to: 'p-x9' })).toBe('Link added: needs-review x9');
    expect(what({ kind: 'dep_added', field: 'constructor', to: 'p-x9' })).toBe('Link added: constructor x9');
    expect(what({ kind: 'dep_removed', field: '', from: 'p-x9' })).toBe('Link removed: x9');
    expect(what({ kind: 'dep_added', field: 'relates-to', to: 'p-x9' })).toBe('Link added: related to x9');
    expect(what({ kind: 'dep_added', field: 'tracks', to: 'p-x9' })).toBe('Link added: tracks x9');
  });

  it('says what changed in each field, in plain words', () => {
    expect(what({ kind: 'field', field: 'status', from: 'open', to: 'blocked' })).toBe('Status: Open → Blocked');
    expect(what({ kind: 'field', field: 'status', from: 'in_progress', to: 'in_review' })).toBe('Status: In progress → In review');
    expect(what({ kind: 'field', field: 'status', from: 'open', to: 'mystery' })).toBe('Status: Open → mystery');
    expect(what({ kind: 'field', field: 'status', to: 'blocked' })).toBe('Status: Blocked');
    expect(what({ kind: 'field', field: 'priority', from: 2, to: 0 })).toBe('Priority: P2 → P0');
    expect(what({ kind: 'field', field: 'title', from: 'Old', to: 'New' })).toBe('Title changed');
    expect(what({ kind: 'field', field: 'assignee', from: null, to: 'Ann' })).toBe('Assigned to Ann');
    expect(what({ kind: 'field', field: 'assignee', from: 'Ann', to: null })).toBe('Unassigned');
    expect(what({ kind: 'field', field: 'assignee' })).toBe('Assignee changed');
    expect(what({ kind: 'field', field: 'labels', from: ['old', 'keep'], to: ['keep', 'urgent'] })).toBe('Labels: added urgent, removed old');
    expect(what({ kind: 'field', field: 'labels', from: [], to: ['a', 'b'] })).toBe('Labels: added a and b');
    expect(what({ kind: 'field', field: 'labels', from: ['a', 'b', 'c'], to: [] })).toBe('Labels: removed a, b and c');
    expect(what({ kind: 'field', field: 'labels' })).toBe('Labels changed');
    expect(what({ kind: 'field', field: 'type', from: 'task', to: 'bug' })).toBe('Type: Task → Bug');
    expect(what({ kind: 'field', field: 'parentId', from: null, to: 'p-e1' })).toBe('Moved under e1');
    expect(what({ kind: 'field', field: 'parentId', from: 'p-e1', to: null })).toBe('Removed from its parent');
    expect(what({ kind: 'field', field: 'estimated_minutes', to: 30 })).toBe('Estimated minutes changed');
    expect(what({ kind: 'field', field: 'closeReason', from: null, to: 'Shipped in 1.4' })).toBe('Close reason: Shipped in 1.4');
    expect(what({ kind: 'field', field: 'closeReason', from: 'x', to: null })).toBe('Close reason cleared');
  });

  it('shows one line of a long text change, never the whole text', () => {
    const long = 'Sessions still come from the legacy monolith.\n\nMove token issue and refresh to the new auth service so the monolith can be turned off.';
    const text = what({ kind: 'field', field: 'description', from: '', to: long });
    expect(text.startsWith('Description edited: Sessions still come from the legacy monolith. Move')).toBe(true);
    expect(text.endsWith('…')).toBe(true);
    expect(text.length).toBeLessThan(110);
    expect(what({ kind: 'field', field: 'acceptance', to: 'Works' })).toBe('Acceptance criteria edited: Works');
    expect(what({ kind: 'field', field: 'notes', from: 'x', to: '' })).toBe('Notes cleared');
    expect(what({ kind: 'field', field: 'design' })).toBe('Design edited');
    expect(what({ kind: 'comment', to: 'x'.repeat(300) }).length).toBeLessThan(110);
  });

  it('gives every kind of change and every field a headline, whatever values are missing', () => {
    const kinds: Activity['kind'][] = ['created', 'field', 'closed', 'reopened', 'deleted', 'dep_added', 'dep_removed', 'comment'];
    const fields = [undefined, '', 'title', 'status', 'priority', 'type', 'assignee', 'labels', 'description', 'design', 'acceptance', 'notes', 'parentId', 'estimated_minutes', 'blocks', 'mystery'];
    const values: Array<Partial<Activity>> = [{}, { from: null, to: null }, { from: '', to: '' }, { from: 'open', to: 'closed' }, { from: 1, to: 2 }, { from: ['a'], to: [] }, { to: 'p-x9' }];
    for (const kind of kinds) {
      for (const field of fields) {
        for (const v of values) {
          const headline = what({ kind, ...(field === undefined ? {} : { field }), ...v });
          expect(headline.trim(), `${kind} ${field} ${JSON.stringify(v)}`).not.toBe('');
        }
      }
    }
  });

  it('words gate rows by kind and how they ended, naming who resolved only when it was not this panel', () => {
    const g = (over: Partial<Activity>) => what({ kind: 'gate_resolved', gateId: 'p-g1', gateKind: 'human', reason: 'Review before closing', ...over });
    expect(what({ kind: 'gate_opened', gateId: 'p-g1', gateKind: 'human', reason: 'Review before closing' })).toBe('Review requested');
    expect(what({ kind: 'gate_opened', gateId: 'p-g1', gateKind: 'human', reason: 'Approve the plan before work starts' })).toBe('Plan approval requested');
    expect(what({ kind: 'gate_opened', gateId: 'p-g1', gateKind: 'timer' })).toBe('Timer set');
    expect(g({})).toBe('Review resolved by Claude Code');
    expect(g({ actor: null })).toBe('Review resolved by someone else');
    expect(g({ actor: 'Alice (panel)', byPanel: true })).toBe('Review resolved');
    expect(g({ ended: 'deleted', actor: null })).toBe('Review deleted');
    expect(g({ ended: 'unlinked' })).toBe('Review removed from this bead');
    expect(g({ reason: 'Approve the plan before work starts' })).toBe('Plan approved by Claude Code');
    // Not people's gates: never called a review, and nobody is said to have resolved them.
    expect(g({ gateKind: 'timer', actor: null })).toBe('Timer ended');
    expect(g({ gateKind: 'gh:pr', actor: null, ended: 'deleted' })).toBe('GitHub check deleted');
    expect(g({ gateKind: undefined, actor: null })).toBe('Check cleared');
  });

  it('offers a row for restore only for a whole short field value (long text goes through History)', () => {
    const row = (over: Partial<Activity>) => rowChange(event({ beadId: 'p-a', kind: 'field', ...over }));
    expect(row({ field: 'priority', from: 2, to: 0 })).toEqual({ field: 'priority', from: 2, to: 0, text: false });
    expect(row({ field: 'assignee', from: null, to: 'Bob' })).toEqual({ field: 'assignee', from: null, to: 'Bob', text: false });
    expect(row({ field: 'labels', from: ['a'], to: ['a', 'b'] })).not.toBeNull();
    // Labels a history row could not name, long text, a cut value, fields the panel does not write, and non-field rows.
    expect(row({ field: 'labels' })).toBeNull();
    expect(row({ field: 'description', from: 'a', to: 'b' })).toBeNull();
    expect(row({ field: 'title', from: `${'x'.repeat(2000)}…`, to: 'Short' })).toBeNull();
    expect(row({ field: 'title', from: 'x'.repeat(2000), to: 'Short' })).not.toBeNull();
    expect(row({ field: 'parentId', from: null, to: 'p-b' })).toBeNull();
    expect(row({ field: 'estimated_minutes', from: 1, to: 2 })).toBeNull();
    expect(rowChange(event({ beadId: 'p-a', kind: 'closed', field: 'status', from: 'open', to: 'closed' }))).toBeNull();
  });

  it('names who made it: you (panel), the recorded name, or unknown', () => {
    expect(whoOf(event({ beadId: 'p-a', kind: 'created', actor: 'Alice (panel)', byPanel: true }))).toBe('you (panel)');
    expect(whoOf(event({ beadId: 'p-a', kind: 'created', actor: 'Bob (panel)' }))).toBe('Bob (panel)');
    expect(whoOf(event({ beadId: 'p-a', kind: 'created', actor: null }))).toBe('unknown');
  });

  it('says when relative to now, preferring the time it was made, and only the date for history', () => {
    expect(whenOf(event({ beadId: 'p-a', kind: 'created', observedAt: iso(5 * MIN) }), NOW)).toBe('5m ago');
    expect(whenOf(event({ beadId: 'p-a', kind: 'created', observedAt: iso(MIN), changedAt: iso(3 * HOUR) }), NOW)).toBe('3h ago');
    expect(whenOf(event({ beadId: 'p-a', kind: 'created', observedAt: '2026-10-02', historical: true }), NOW)).toBe('Oct 2');
    // A history row with a real time is an instant: its day is the local one, not the digits it starts with.
    expect(whenOf(event({ beadId: 'p-a', kind: 'created', observedAt: '2026-10-02T23:30:00-05:00', historical: true }), NOW)).toBe('Oct 3');
    expect(whenOf(event({ beadId: 'p-a', kind: 'created', observedAt: '2025-12-30', historical: true }), NOW)).toBe('Dec 30, 2025');
  });
});

function feedInput(activity: Activity[], over: Partial<FeedInput> = {}): FeedInput {
  return { activity, beads: [bead('p-a', { title: 'Fix login' }), bead('p-b', { title: 'Cut over DNS' })], statuses: STATUSES, query: '', now: NOW, ...over };
}

describe('activity feed', () => {
  it('keeps the newest-first order and groups entries by day', () => {
    const feed = activityFeed(
      feedInput([
        event({ id: 'a', beadId: 'p-a', kind: 'created', observedAt: iso(5 * MIN) }),
        event({ id: 'b', beadId: 'p-b', kind: 'comment', observedAt: iso(2 * HOUR) }),
        event({ id: 'c', beadId: 'p-a', kind: 'closed', observedAt: iso(DAY) }),
        event({ id: 'd', beadId: 'p-b', kind: 'created', observedAt: '2026-10-02', historical: true }),
      ]),
    );
    expect(feed.map((d) => d.label)).toEqual(['Today', 'Yesterday', 'Oct 2']);
    expect(feed.flatMap((d) => d.entries.map((e) => e.event.id))).toEqual(['a', 'b', 'c', 'd']);
    expect(feed[0]!.entries[0]).toMatchObject({ short: 'a', title: 'Fix login', gone: false, who: 'Claude Code' });
  });

  it('does not depend on the clock within a day: only "5m ago" moves, and it is worked out when drawn', () => {
    const activity = [event({ beadId: 'p-a', kind: 'created', observedAt: iso(5 * MIN) }), event({ beadId: 'p-b', kind: 'closed', observedAt: iso(DAY) })];
    expect(activityFeed(feedInput(activity, { now: NOW + 3 * MIN }))).toEqual(activityFeed(feedInput(activity)));
  });

  it('orders a batch that arrived out of order by when each change was made, one header per day', () => {
    // A catch-up or a Sync brings changes in the order they were found, not made; this batch crosses midnight.
    const feed = activityFeed(
      feedInput([
        event({ id: 'a', beadId: 'p-a', kind: 'created', observedAt: iso(MIN), changedAt: '2026-10-14T01:00:00.000Z' }),
        event({ id: 'b', beadId: 'p-b', kind: 'comment', observedAt: iso(MIN), changedAt: '2026-10-13T23:00:00.000Z' }),
        event({ id: 'c', beadId: 'p-a', kind: 'closed', observedAt: iso(MIN), changedAt: '2026-10-14T16:00:00.000Z' }),
        event({ id: 'd', beadId: 'p-b', kind: 'created', observedAt: '2026-10-13', historical: true }),
        event({ id: 'e', beadId: 'p-b', kind: 'comment', observedAt: 'not a time' }),
        event({ id: 'f', beadId: 'p-a', kind: 'comment', observedAt: iso(MIN), changedAt: '2026-10-13T08:00:00.000Z' }),
      ]),
    );
    expect(feed.map((d) => d.label)).toEqual(['Today', 'Yesterday', 'Unknown day']);
    expect(feed.map((d) => d.entries.map((e) => e.event.id))).toEqual([['c', 'a'], ['b', 'f', 'd'], ['e']]);
  });

  it('reads timed history in the local zone and bare dates as written, with a tooltip that says which', () => {
    const zone = process.env.TZ;
    process.env.TZ = 'America/Chicago';
    try {
      const feed = activityFeed(
        feedInput([
          // 03:30 UTC on Oct 3 is the evening of Oct 2 in Chicago.
          event({ id: 'timed', beadId: 'p-a', kind: 'created', observedAt: '2026-10-03T03:30:00.000Z', historical: true }),
          event({ id: 'bare', beadId: 'p-b', kind: 'created', observedAt: '2026-10-02', historical: true }),
        ]),
      );
      expect(feed.map((d) => d.label)).toEqual(['Oct 2']);
      const [timed, bare] = feed[0]!.entries;
      expect(whenOf(timed!.event, NOW)).toBe('Oct 2');
      expect(timed!.whenTitle).toBe('Oct 2, 2026, 10:30 PM');
      expect(whenOf(bare!.event, NOW)).toBe('Oct 2');
      expect(bare!.whenTitle).toBe("From Beads' history. Only the day is known.");
    } finally {
      process.env.TZ = zone;
    }
  });

  it('names a gone bead by the title on its deletion, on every entry of that bead', () => {
    const feed = activityFeed(
      feedInput([
        event({ beadId: 'p-z', kind: 'deleted', actor: null, title: 'Old login flow' }),
        // A deletion saved before titles were recorded: no guessing from an earlier rename.
        event({ beadId: 'p-y', kind: 'deleted', actor: null }),
        event({ beadId: 'p-y', kind: 'field', field: 'title', from: 'Old name', to: 'Spare branch cleanup', observedAt: iso(HOUR) }),
        event({ beadId: 'p-z', kind: 'field', field: 'priority', from: 2, to: 1, observedAt: iso(2 * HOUR) }),
      ]),
    );
    const [z, y, yOlder, zOlder] = feed[0]!.entries;
    expect(z).toMatchObject({ short: 'z', title: 'Old login flow', gone: true, who: 'unknown' });
    expect(zOlder).toMatchObject({ title: 'Old login flow', gone: true });
    expect(y).toMatchObject({ short: 'y', title: null, gone: true });
    expect(yOlder).toMatchObject({ title: null, gone: true });
  });

  it('searches ids, titles, names and what changed', () => {
    const activity = [
      event({ id: 'a', beadId: 'p-a', kind: 'field', field: 'status', from: 'open', to: 'blocked' }),
      event({ id: 'b', beadId: 'p-b', kind: 'comment', to: 'ship it', actor: 'Bob Builder' }),
      event({ id: 'c', beadId: 'p-a', kind: 'created', actor: 'Ann (panel)', byPanel: true }),
    ];
    const ids = (query: string) => activityFeed(feedInput(activity, { query })).flatMap((d) => d.entries.map((e) => e.event.id));
    expect(ids('dns')).toEqual(['b']);
    expect(ids('p-a')).toEqual(['a', 'c']);
    expect(ids('bob')).toEqual(['b']);
    expect(ids('blocked')).toEqual(['a']);
    expect(ids('you (panel)')).toEqual(['c']);
    expect(ids('nothing like it')).toEqual([]);
  });
});

describe('activity search', () => {
  it('reaches the whole text of a change and the name as recorded, not just what the line shows', () => {
    const long = `Sessions still come from the legacy monolith. ${'Filler words. '.repeat(10)}Watch the zebra-cutover flag.`;
    const activity = [
      event({ id: 'desc', beadId: 'p-a', kind: 'field', field: 'description', from: 'was about the walrus', to: long }),
      event({ id: 'closed', beadId: 'p-b', kind: 'closed', reason: `${'Done. '.repeat(20)}Verified on the okapi cluster.` }),
      event({ id: 'panel', beadId: 'p-a', kind: 'created', actor: 'Ann Tester (panel)', byPanel: true }),
      event({ id: 'title', beadId: 'p-b', kind: 'field', field: 'title', from: 'Old heron name', to: 'Cut over DNS' }),
      event({ id: 'comment', beadId: 'p-b', kind: 'comment', to: `${'Long note. '.repeat(10)}Mentions the ibis.` }),
    ];
    const ids = (query: string) => activityFeed(feedInput(activity, { query })).flatMap((d) => d.entries.map((e) => e.event.id));
    expect(ids('zebra-cutover')).toEqual(['desc']);
    expect(ids('walrus')).toEqual(['desc']);
    expect(ids('okapi')).toEqual(['closed']);
    expect(ids('ann tester')).toEqual(['panel']);
    expect(ids('heron')).toEqual(['title']);
    expect(ids('ibis')).toEqual(['comment']);
  });
});

// ------------------------------------------------------------------------------------------------- the view

function setup(answer: (call: Call) => Answer | Promise<Answer>) {
  const fake = fakeHost(answer);
  const toast = vi.fn(async () => {});
  const setBadge = vi.fn(async () => {});
  Object.assign(fake.host, { toast, setBadge });
  const visibility = { isVisible: () => true, onChange: () => () => {} };
  const store = createStore({ client: createClient(fake.host), host: fake.host, visibility });
  render(
    <StoreContext.Provider value={store}>
      <App />
    </StoreContext.Provider>,
  );
  return { ...fake, store, toast, setBadge };
}

async function openActivity(store: Store) {
  await act(async () => {
    store.setDirectory('/p/a');
    await flush();
  });
  await act(async () => {
    store.setView('activity');
    await flush();
  });
}

const press = (key: string) =>
  act(async () => {
    fireEvent.keyDown(document, { key });
    await flush();
  });

const BEADS = [bead('p-a', { title: 'Fix login' }), bead('p-b', { title: 'Cut over DNS' })];

/** A service whose seen state follows the `seen` route. */
function service(activity: Activity[], beads = BEADS) {
  let unseen = [...new Set(activity.filter((e) => e.unseen).map((e) => e.beadId))];
  let cursor = 0;
  return (call: Call): Answer => {
    if (call.route === 'seen') {
      unseen = call.body.all === true ? [] : unseen.filter((id) => !(call.body.ids as string[]).includes(id));
      cursor++;
      return json({ unseenIds: unseen });
    }
    if (call.route === 'bead') {
      const b = beads.find((x) => x.id === call.body.id)!;
      return json({ bead: b, related: { parent: null, children: [], deps: [] } });
    }
    return json(
      snapshot({
        cursor: `c${cursor}`,
        beads,
        statuses: STATUSES,
        unseenIds: unseen,
        activity: activity.map((e) => ({ ...e, unseen: e.unseen && unseen.includes(e.beadId) })),
        freshness: freshness({ localRefreshedAt: iso(0) }),
        panelActor: 'Ann (panel)',
      }),
    );
  };
}

const FEED: Activity[] = [
  event({ id: 'a', beadId: 'p-a', kind: 'field', field: 'status', from: 'open', to: 'blocked', unseen: true, observedAt: iso(5 * MIN) }),
  event({ id: 'b', beadId: 'p-b', kind: 'comment', to: 'ship it', actor: 'Bob Builder', observedAt: iso(30 * MIN) }),
  event({ id: 'c', beadId: 'p-gone', kind: 'deleted', actor: null, unseen: true, observedAt: iso(40 * MIN) }),
  event({ id: 'd', beadId: 'p-b', kind: 'created', actor: 'Ann (panel)', byPanel: true, observedAt: '2026-10-02', historical: true }),
];

const entries = () => screen.getAllByRole('option');

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('activity view', () => {
  it('lists every change newest first, with what, which bead, who and when', async () => {
    const { store } = setup(service(FEED));
    await openActivity(store);
    const feed = screen.getByRole('listbox', { name: 'Activity' });
    expect(within(feed).getByText('Today')).toBeTruthy();
    expect(within(feed).getByText('Oct 2', { selector: '.bd-day *, .bd-day' })).toBeTruthy();
    const [a, b, c, d] = entries();
    expect(a!.textContent).toContain('Status: Open → Blocked');
    expect(a!.textContent).toContain('Fix login');
    expect(a!.textContent).toContain('Claude Code');
    expect(a!.textContent).toContain('5m ago');
    expect(b!.textContent).toContain('Commented: ship it');
    expect(b!.textContent).toContain('Bob Builder');
    expect(c!.textContent).toContain('Deleted');
    expect(c!.getAttribute('aria-disabled')).toBe('true');
    expect(c!.textContent).toContain('unknown');
    expect(d!.textContent).toContain('you (panel)');
    expect(d!.querySelector('time')?.textContent).toBe('Oct 2');
  });

  it('highlights unseen entries, and Mark all seen clears them through the service', async () => {
    const { store, calls, setBadge } = setup(service(FEED));
    await openActivity(store);
    expect(setBadge).toHaveBeenLastCalledWith(2);
    expect(entries().map((e) => e.hasAttribute('data-unseen'))).toEqual([true, false, true, false]);
    expect(screen.getByText('2 unseen')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark all seen' }));
      await flush();
    });
    expect(calls.find((c) => c.route === 'seen')?.body).toEqual({ directory: '/p/a', all: true });
    expect(entries().some((e) => e.hasAttribute('data-unseen'))).toBe(false);
    expect(store.get().snapshot?.unseenIds).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Mark all seen' })).toBeNull();
    expect(screen.queryByRole('button', { name: /changed since you last looked/ })).toBeNull();
    // The rail badge clears too.
    expect(setBadge).toHaveBeenLastCalledWith(null);
  });

  it('says so when Mark all seen fails, and keeps the highlights', async () => {
    const answer = service(FEED);
    const { store, toast } = setup((call) => (call.route === 'seen' ? json({ error: { code: 'busy', message: 'Beads is busy.' } }, 503) : answer(call)));
    await openActivity(store);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark all seen' }));
      await flush();
    });
    expect(entries()[0]!.hasAttribute('data-unseen')).toBe(true);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', message: expect.stringContaining("Couldn't mark") }));
  });

  it("opens an entry's bead and marks that bead seen; a deleted bead's entry opens nothing", async () => {
    const { store, calls } = setup(service(FEED));
    await openActivity(store);
    await act(async () => {
      fireEvent.click(entries()[2]!);
      await flush();
    });
    expect(store.get().detail).toBeNull();
    expect(entries()[2]!.getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      fireEvent.click(entries()[0]!);
      await flush();
    });
    expect(store.get().detail?.stack[0]?.id).toBe('p-a');
    expect(calls.find((c) => c.route === 'seen')?.body).toEqual({ directory: '/p/a', ids: ['p-a'] });
  });

  it('moves with j and k and opens with Enter, like the list', async () => {
    const { store } = setup(service(FEED));
    await openActivity(store);
    await press('j');
    await press('j');
    expect(entries()[1]!.hasAttribute('data-cursor')).toBe(true);
    await press('k');
    expect(entries()[0]!.hasAttribute('data-cursor')).toBe(true);
    expect(screen.getByRole('listbox', { name: 'Activity' }).getAttribute('aria-activedescendant')).toBe(entries()[0]!.id);
    await press('j');
    await press('Enter');
    expect(store.get().detail?.stack[0]?.id).toBe('p-b');
    await act(async () => {
      store.back();
      await flush();
    });
    expect(entries()[1]!.hasAttribute('data-selected')).toBe(true);
    // As in the list: Escape lets go of the selection first, then of the cursor.
    await press('Escape');
    expect(entries()[1]!.hasAttribute('data-selected')).toBe(false);
    expect(entries()[1]!.hasAttribute('data-cursor')).toBe(true);
    await press('Escape');
    expect(entries().some((e) => e.hasAttribute('data-cursor'))).toBe(false);
  });

  it('narrows the feed with search', async () => {
    const { store } = setup(service(FEED));
    await openActivity(store);
    await act(async () => {
      fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'bob' } });
      await flush();
    });
    expect(entries()).toHaveLength(1);
    await act(async () => {
      fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
      await flush();
    });
    expect(screen.getByText('No changes match.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
      await flush();
    });
    expect(entries()).toHaveLength(4);
  });

  it('explains an empty feed', async () => {
    const { store } = setup(service([]));
    await openActivity(store);
    expect(screen.getByText('Nothing has changed yet.')).toBeTruthy();
    expect(screen.getByText('Changes your agent makes show up here.')).toBeTruthy();
  });

  it('says the filters do not apply to the feed', async () => {
    const { store } = setup(service(FEED));
    await openActivity(store);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
      await flush();
    });
    const sheet = screen.getByRole('region', { name: 'Filters' });
    expect(sheet.textContent).toContain('Filters apply to the Epic and Status views');
    expect(within(sheet).queryByRole('button', { name: 'Current' })).toBeNull();
  });

  it('shows a deleted bead as its id and title struck through, or says the title was not recorded', async () => {
    const { store } = setup(
      service([
        event({ beadId: 'p-old', kind: 'deleted', actor: null, unseen: true, title: 'Fix login' }),
        event({ beadId: 'p-old', kind: 'field', field: 'priority', from: 2, to: 1, observedAt: iso(HOUR) }),
        event({ beadId: 'p-older', kind: 'deleted', actor: null, observedAt: iso(2 * HOUR) }),
      ]),
    );
    await openActivity(store);
    const [deletion, earlier, untitled] = entries();
    expect(deletion!.querySelector('.bd-act-bead')?.textContent).toBe('oldFix login');
    expect(deletion!.querySelector('.bd-title')?.textContent).toBe('Fix login');
    expect(deletion!.querySelector('.bd-act-gone')).toBeNull();
    // An older change to the bead that is now gone says so, under the same title.
    expect(earlier!.querySelector('.bd-title')?.textContent).toBe('Fix login');
    expect(earlier!.querySelector('.bd-act-gone')?.textContent).toBe('deleted');
    expect(earlier!.getAttribute('aria-disabled')).toBe('true');
    expect(untitled!.querySelector('.bd-act-notitle')?.textContent).toBe('(title not recorded)');
  });
});

describe('restore from an activity row', () => {
  const shown = bead('p-a', { title: 'Fix login', priority: 0, updatedAt: iso(2 * MIN) });
  const feed = [
    event({ id: 'r1', beadId: 'p-a', kind: 'field', field: 'priority', from: 2, to: 0, observedAt: iso(5 * MIN) }),
    event({ id: 'r2', beadId: 'p-a', kind: 'field', field: 'description', from: 'Old text', to: 'New text', observedAt: iso(9 * MIN) }),
  ];
  const updates = (calls: Call[]) => calls.filter((c) => c.route === 'update');
  const withUpdate = (update: (call: Call) => Answer, beads = [shown, BEADS[1]!]) => {
    const base = service(feed, beads);
    return (call: Call) => (call.route === 'update' ? update(call) : base(call));
  };
  const openMenu = async (row: HTMLElement) => {
    await act(async () => {
      fireEvent.click(row.querySelector('.bd-rowmore')!);
      await flush();
    });
  };
  const choose = async (name: string) => {
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name }));
      await flush();
    });
  };
  const bar = () => screen.getByRole('group', { name: /^Restore / });

  it("activity row restore uses the row's values", async () => {
    const { store, calls } = setup(withUpdate(() => json({ ok: true, bead: { ...shown, priority: 2, updatedAt: iso(0) } } satisfies WriteResult)));
    await openActivity(store);
    await openMenu(entries()[0]!);
    await choose('Restore previous value');
    expect(updates(calls)).toHaveLength(1);
    expect(updates(calls)[0]!.body).toEqual({ directory: '/p/a', id: 'p-a', expectedUpdatedAt: shown.updatedAt, patch: { priority: 2 }, expected: { priority: 0 } });
    expect(within(bar()).getByRole('status').textContent).toBe('Restored the earlier priority.');
    // The bar sits outside the feed's options: nothing pressable is inside a row.
    expect(screen.getByRole('listbox', { name: 'Activity' }).contains(bar())).toBe(false);
  });

  it('a long text row has no Restore: History carries the whole value', async () => {
    const { store } = setup(withUpdate(() => json({})));
    await openActivity(store);
    await openMenu(entries()[1]!);
    expect(screen.queryByRole('menuitem', { name: 'Restore previous value' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Copy ID' })).toBeTruthy();
  });

  it('a refused row restore shows the current value and writes nothing more', async () => {
    const current = { ...shown, priority: 1, updatedAt: iso(MIN) };
    const { store, calls } = setup(withUpdate(() => json({ ok: false, conflict: true, current } satisfies WriteResult)));
    await openActivity(store);
    await openMenu(entries()[0]!);
    await choose('Restore previous value');
    const alert = within(bar()).getByRole('alert');
    expect(alert.textContent).toContain('Now: P1.');
    expect(alert.textContent).toContain('Nothing was changed.');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      await flush();
    });
    expect(updates(calls)).toHaveLength(1);
    // Focus leaves the feed for the refusal's message, never the button that overwrites; a double Enter writes nothing.
    const focused = document.activeElement as HTMLElement;
    expect(focused.hasAttribute('data-refused')).toBe(true);
    expect(bar().contains(focused)).toBe(true);
    for (let i = 0; i < 2; i++) {
      fireEvent.keyDown(focused, { key: 'Enter' });
      if (focused.tagName === 'BUTTON') fireEvent.click(focused);
    }
    await flush();
    expect(updates(calls)).toHaveLength(1);
    await act(async () => {
      fireEvent.click(within(bar()).getByRole('button', { name: 'Restore anyway' }));
      await flush();
    });
    expect(updates(calls)[1]!.body).toMatchObject({ expectedUpdatedAt: current.updatedAt, patch: { priority: 2 }, expected: { priority: 1 } });
  });

  it('a row the bead has moved past asks first in the bar, with focus on its message; Keep current closes it and sends nothing', async () => {
    const { store, calls } = setup(withUpdate(() => json({}), [{ ...shown, priority: 1 }, BEADS[1]!]));
    await openActivity(store);
    await openMenu(entries()[0]!);
    await choose('Restore previous value');
    expect(updates(calls)).toHaveLength(0);
    expect(within(bar()).getByRole('alert').textContent).toContain('Now: P1.');
    expect((document.activeElement as HTMLElement).hasAttribute('data-refused')).toBe(true);
    await act(async () => {
      fireEvent.click(within(bar()).getByRole('button', { name: 'Keep current' }));
      await flush();
    });
    expect(screen.queryByRole('group', { name: /^Restore / })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('listbox', { name: 'Activity' }));
    expect(updates(calls)).toHaveLength(0);
  });

  it('a row whose bead already holds the earlier value offers nothing to send', async () => {
    const { store } = setup(withUpdate(() => json({}), [{ ...shown, priority: 2 }, BEADS[1]!]));
    await openActivity(store);
    await openMenu(entries()[0]!);
    const item = screen.getByRole('menuitem', { name: /Restore previous value/ }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(item.textContent).toContain('Already the earlier value');
  });
});
