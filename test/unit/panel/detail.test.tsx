// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { createClient } from '../../../src/panel/client';
import { createStore, StoreContext } from '../../../src/panel/store';
import {
  acceptanceItems,
  changeLine,
  changeText,
  closedAt,
  closeReason,
  depTime,
  latestUnseenChange,
  moreFields,
  personName,
  relationGroups,
} from '../../../src/panel/detail';
import { relatedFor } from '../../../src/shared/related';
import { App } from '../../../src/panel/ui/App';
import type { BeadResponse } from '../../../src/shared/api';
import type { Bead, ChangeEvent, Dependency, Related, StatusDef } from '../../../src/shared/types';
import { deferred, fakeHost, flush, freshness, json, snapshot, type Answer, type Call } from './helpers';

// A US zone, so anything that shifts a date-only time by zone shows up as the wrong day.
process.env.TZ = 'America/Los_Angeles';

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

type Activity = ChangeEvent & { unseen: boolean };
const event = (over: Partial<Activity> & Pick<Activity, 'beadId' | 'kind'>): Activity => ({
  id: `e-${Math.random()}`,
  actor: 'Claude Code',
  byPanel: false,
  observedAt: iso(9 * MIN),
  unseen: true,
  ...over,
});

const dep = (from: string, to: string, kind: string, over: Partial<Dependency> = {}): Dependency => ({ from, to, kind, createdBy: null, createdAt: null, ...over });

// ------------------------------------------------------------------------------------------------- logic

describe('change banner', () => {
  it('says when, who and what for a status change', () => {
    const e = event({ beadId: 'p-a', kind: 'field', field: 'status', from: 'open', to: 'blocked' });
    const line = changeLine(e, STATUSES, NOW);
    expect(changeText(line)).toBe('Changed 9m ago by Claude Code: open → blocked');
    expect(line.toLook).toBe('blocked');
  });

  it('shows "you (panel)" for the panel\'s own change and "unknown" when nobody was recorded', () => {
    const mine = event({ beadId: 'p-a', kind: 'field', field: 'status', from: 'open', to: 'in_review', actor: 'Alice (panel)', byPanel: true });
    expect(changeText(changeLine(mine, STATUSES, NOW))).toBe('Changed 9m ago by you (panel): open → in review');
    const nobody = event({ beadId: 'p-a', kind: 'field', field: 'priority', from: 2, to: 0, actor: null });
    expect(changeText(changeLine(nobody, STATUSES, NOW))).toBe('Changed 9m ago by unknown: priority P2 → P0');
    // A name that merely ends in " (panel)" is somebody else's panel, shown as recorded.
    const theirs = event({ beadId: 'p-a', kind: 'comment', actor: 'Bob (panel)' });
    expect(changeText(changeLine(theirs, STATUSES, NOW))).toBe('New comment 9m ago by Bob (panel)');
  });

  it('names a close reason or a "More" field that changed on its own', () => {
    const reason = event({ beadId: 'p-a', kind: 'field', field: 'closeReason', from: null, to: 'Shipped' });
    expect(changeText(changeLine(reason, STATUSES, NOW))).toBe('Changed 9m ago by Claude Code: close reason edited');
    const more = event({ beadId: 'p-a', kind: 'field', field: 'external_ref', from: null, to: 'gh-12' });
    expect(changeText(changeLine(more, STATUSES, NOW))).toBe('Changed 9m ago by Claude Code: external ref edited');
  });

  it('dates the change from changedAt when known, and only by day for history from the audit log', () => {
    const e = event({ beadId: 'p-a', kind: 'closed', observedAt: iso(MIN), changedAt: iso(3 * 3_600_000), reason: 'Done in abc123' });
    expect(changeText(changeLine(e, STATUSES, NOW))).toBe('Closed 3h ago by Claude Code: Done in abc123');
    const old = event({ beadId: 'p-a', kind: 'field', field: 'title', historical: true, observedAt: '2026-10-02T23:30:00Z' });
    expect(changeText(changeLine(old, STATUSES, NOW))).toBe('Changed on Oct 2 by Claude Code: title edited');
  });

  it('dates timed history by the local day, and a bare date as written', () => {
    const zone = process.env.TZ;
    process.env.TZ = 'America/Chicago';
    try {
      const timed = event({ beadId: 'p-a', kind: 'field', field: 'title', historical: true, observedAt: '2026-10-03T03:30:00Z' });
      expect(changeText(changeLine(timed, STATUSES, NOW))).toBe('Changed on Oct 2 by Claude Code: title edited');
      const bare = event({ beadId: 'p-a', kind: 'field', field: 'title', historical: true, observedAt: '2026-10-03' });
      expect(changeText(changeLine(bare, STATUSES, NOW))).toBe('Changed on Oct 3 by Claude Code: title edited');
    } finally {
      process.env.TZ = zone;
    }
  });

  it('picks the newest unseen change for the bead', () => {
    const activity = [
      event({ beadId: 'p-b', kind: 'comment' }),
      event({ beadId: 'p-a', kind: 'comment', unseen: false }),
      event({ beadId: 'p-a', kind: 'field', field: 'status', from: 'open', to: 'blocked', id: 'want' }),
      event({ beadId: 'p-a', kind: 'created', id: 'older' }),
    ];
    expect(latestUnseenChange('p-a', activity)?.id).toBe('want');
    expect(latestUnseenChange('p-c', activity)).toBeNull();
  });
});

describe('people', () => {
  it('names the panel\'s own actor "you (panel)", keeps other names, and says "unknown" for none', () => {
    expect(personName('Alice (panel)', 'Alice (panel)')).toBe('you (panel)');
    expect(personName('Claude Code', 'Alice (panel)')).toBe('Claude Code');
    expect(personName('Alice (panel)', null)).toBe('Alice (panel)');
    expect(personName(null, 'Alice (panel)')).toBe('unknown');
  });
});

describe('close reason', () => {
  it('uses the bead\'s own reason', () => {
    expect(closeReason(bead('p-a', { status: 'closed', closeReason: 'Fixed' }), [], STATUSES)).toBe('Fixed');
  });

  it('falls back to the newest closed change for a custom done status', () => {
    const activity = [
      event({ beadId: 'p-x', kind: 'closed', reason: 'Not this one' }),
      event({ beadId: 'p-a', kind: 'closed', reason: 'Shipped in 1.4', unseen: false }),
      event({ beadId: 'p-a', kind: 'closed', reason: 'Older reason' }),
    ];
    expect(closeReason(bead('p-a', { status: 'shipped' }), activity, STATUSES)).toBe('Shipped in 1.4');
  });

  it('gives a close time from the audit log as a day only, flagged historical', () => {
    const activity = [event({ beadId: 'p-a', kind: 'closed', historical: true, observedAt: '2026-10-02' })];
    expect(closedAt(bead('p-a', { status: 'shipped' }), activity, STATUSES)).toEqual({ at: '2026-10-02', historical: true });
    expect(closedAt(bead('p-a', { status: 'closed', closedAt: iso(DAY) }), activity, STATUSES)).toEqual({ at: iso(DAY), historical: false });
  });

  it('shows none for a bead that is not done', () => {
    const activity = [event({ beadId: 'p-a', kind: 'closed', reason: 'Stale' })];
    expect(closeReason(bead('p-a', { status: 'open', closeReason: 'Stale' }), activity, STATUSES)).toBeNull();
  });
});

describe('relationships', () => {
  const related: Related = {
    parent: bead('p-e', { type: 'epic' }),
    children: [bead('p-a.1', { status: 'closed' }), bead('p-a.2')],
    deps: [
      { dep: dep('p-a', 'p-r', 'related'), other: bead('p-r'), direction: 'out' },
      { dep: dep('p-a', 'p-b1', 'blocks'), other: bead('p-b1'), direction: 'out' },
      { dep: dep('p-x', 'p-a', 'blocks'), other: bead('p-x'), direction: 'in' },
      { dep: dep('p-a', 'p-d', 'discovered-from'), other: bead('p-d'), direction: 'out' },
      { dep: dep('p-q', 'p-a', 'relates-to'), other: bead('p-q'), direction: 'in' },
      { dep: dep('p-a', 'p-z', 'zany-link'), other: null, direction: 'out' },
      { dep: dep('p-w', 'p-a', 'zany-link'), other: bead('p-w'), direction: 'in' },
    ],
  };

  it('groups parent, children, blocked by, blocks, related, discovered from, then other kinds by name', () => {
    const groups = relationGroups(related);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Parent', ['p-e']],
      ['Children', ['p-a.1', 'p-a.2']],
      ['Blocked by', ['p-b1']],
      ['Blocks', ['p-x']],
      ['Related', ['p-r', 'p-q']],
      ['Discovered from', ['p-d']],
      ['Zany link', ['p-z']],
      ['Zany link (incoming)', ['p-w']],
    ]);
    // A bead that is gone keeps its id.
    expect(groups.find((g) => g.label === 'Zany link')?.items[0]?.bead).toBeNull();
  });

  it('shows a related bead once when the link is recorded both ways, and children in id order', () => {
    const groups = relationGroups({
      parent: null,
      children: [bead('p-a.10'), bead('p-a.2'), bead('p-a.1')],
      deps: [
        { dep: dep('p-a', 'p-r', 'related'), other: bead('p-r'), direction: 'out' },
        { dep: dep('p-r', 'p-a', 'related'), other: bead('p-r'), direction: 'in' },
      ],
    });
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Children', ['p-a.1', 'p-a.2', 'p-a.10']],
      ['Related', ['p-r']],
    ]);
  });

  it('keeps a parent the project no longer has, by its id', () => {
    const groups = relationGroups({ parent: null, children: [], deps: [] }, 'p-gone');
    expect(groups.map((g) => [g.label, g.items.map((i) => [i.id, i.bead])])).toEqual([['Parent', [['p-gone', null]]]]);
  });

  it('leaves out groups with nothing in them', () => {
    expect(relationGroups({ parent: null, children: [], deps: [] })).toEqual([]);
  });

  it('builds the same picture from the list while the bead loads', () => {
    const beads = [
      bead('p-e', { type: 'epic' }),
      bead('p-a', { parentId: 'p-e', dependencies: [dep('p-a', 'p-e', 'parent-child'), dep('p-a', 'p-b1', 'blocks')] }),
      bead('p-a.1', { parentId: 'p-a' }),
      bead('p-b1'),
      bead('p-x', { dependencies: [dep('p-x', 'p-a', 'blocks')] }),
    ];
    const r = relatedFor(beads[1]!, beads);
    expect(r.parent?.id).toBe('p-e');
    expect(r.children.map((c) => c.id)).toEqual(['p-a.1']);
    expect(r.deps.map((d) => [d.dep.kind, d.direction, d.other?.id])).toEqual([
      ['blocks', 'out', 'p-b1'],
      ['blocks', 'in', 'p-x'],
    ]);
  });

  it('shows a link\'s recorded time as written, never converted', () => {
    expect(depTime('2026-10-14T01:20:03Z')).toBe('2026-10-14 01:20:03');
    expect(depTime(null)).toBeNull();
  });
});

describe('more fields', () => {
  it('lists every extra field with a readable name and value', () => {
    const fields = moreFields({
      defer_until: '2026-11-13T09:19:52Z',
      owner: 'alice@example.invalid',
      estimated_minutes: 90,
      external_ref: 'gh-12',
      pinned: true,
      tags: ['a', 'b'],
      metadata: { team: 'core', size: 3 },
    });
    expect(fields.map((f) => [f.label, f.value])).toEqual([
      ['Defer until', expect.stringMatching(/Nov 1[23]/)],
      ['Owner', 'alice@example.invalid'],
      ['Estimate', '1h 30m'],
      ['External ref', 'gh-12'],
      ['Pinned', 'Yes'],
      ['Tags', 'a, b'],
      ['Metadata', ''],
      ['team', 'core'],
      ['size', '3'],
    ]);
    // An object's keys are rows of their own under its name, which is marked as their group.
    expect(fields.filter((f) => f.sub).map((f) => f.label)).toEqual(['team', 'size']);
    expect(fields.filter((f) => f.group).map((f) => f.label)).toEqual(['Metadata']);
    expect(fields.find((f) => f.label === 'Defer until')?.title).toBe('2026-11-13T09:19:52Z');
  });
});

describe('acceptance criteria', () => {
  it('reads a markdown list as items, with checked ones marked', () => {
    expect(acceptanceItems('- Works offline\n- [x] Respects Wi-Fi only\n* [ ] Resumes\n1. Numbered')).toEqual([
      { text: 'Works offline', done: false },
      { text: 'Respects Wi-Fi only', done: true },
      { text: 'Resumes', done: false },
      { text: 'Numbered', done: false },
    ]);
  });

  it('leaves prose alone', () => {
    expect(acceptanceItems('All services run on the new stack.')).toBeNull();
    expect(acceptanceItems('Intro line\n- item')).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------- rendered

function setup(answer: (call: Call) => Answer | Promise<Answer>) {
  const fake = fakeHost(answer);
  const openUrl = vi.fn(async () => {});
  const writeClipboard = vi.fn(async () => {});
  const toast = vi.fn(async () => {});
  Object.assign(fake.host, { openUrl, writeClipboard, toast });
  const store = createStore({ client: createClient(fake.host), host: fake.host, visibility: { isVisible: () => true, onChange: () => () => {} } });
  render(
    <StoreContext.Provider value={store}>
      <App />
    </StoreContext.Provider>,
  );
  return { ...fake, store, openUrl, writeClipboard, toast };
}

const live = (over: Parameters<typeof snapshot>[0] = {}) =>
  snapshot({ statuses: STATUSES, readyIds: (over.beads ?? []).map((b) => b.id), freshness: freshness({ localRefreshedAt: iso(0) }), ...over });

/** Answers snapshot with `snap()` and bead with that bead from the snapshot (or `beadAnswer`). */
function service(snap: () => ReturnType<typeof live>, beadAnswer?: (id: string) => Answer | Promise<Answer>) {
  return (call: Call): Answer | Promise<Answer> => {
    if (call.route === 'snapshot') return json(snap());
    if (call.route === 'seen') return json({ unseenIds: snap().unseenIds.filter((id) => !(call.body.ids as string[]).includes(id)) });
    if (call.route === 'bead') {
      const id = call.body.id as string;
      if (beadAnswer) return beadAnswer(id);
      const s = snap();
      const b = s.beads.find((x) => x.id === id)!;
      return json({ bead: b, related: relatedFor(b, s.beads) } satisfies BeadResponse);
    }
    return json({});
  };
}

async function openProject(store: ReturnType<typeof setup>['store']) {
  await act(async () => {
    store.setDirectory('/p/a');
    await flush();
  });
}

async function select(store: ReturnType<typeof setup>['store'], id: string) {
  await act(async () => {
    store.select(id);
    await flush();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('detail view', () => {
  it('sanitizes html in description', async () => {
    const evil =
      'Hello <script>window.__pwned = 1</script><img src="x" onerror="window.__pwned = 2"> <iframe src="https://example.com"></iframe><style>body{display:none}</style> **bold** <a href="https://example.com/x" onclick="alert(1)">site</a> <a href="javascript:alert(1)">bad</a>';
    const beads = [bead('p-a', { description: evil })];
    const { store, openUrl, toast } = setup(service(() => live({ beads })));
    await openProject(store);
    await select(store, 'p-a');
    const text = document.querySelector('[data-section="description"] .bd-md')!;
    expect(text.querySelector('script')).toBeNull();
    expect(text.querySelector('[onerror]')).toBeNull();
    expect(text.querySelector('[onclick]')).toBeNull();
    expect(text.querySelector('a[href^="javascript"]')).toBeNull();
    expect(text.querySelector('img, iframe, style')).toBeNull();
    await act(async () => {
      fireEvent.click(within(text as HTMLElement).getByText('bad'));
      await flush();
    });
    expect(openUrl).not.toHaveBeenCalled();
    // The stripped link's text is still offered to copy, never opened.
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ copy: { text: 'javascript:alert(1)' } }));
    expect(text.querySelector('strong')?.textContent).toBe('bold');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    await act(async () => {
      fireEvent.click(within(text as HTMLElement).getByText('site'));
      await flush();
    });
    expect(openUrl).toHaveBeenCalledWith('https://example.com/x');
  });

  it('shows the header, hides empty text sections, and starts long ones folded', async () => {
    const beads = [
      bead('p-e', { type: 'epic', title: 'Offline playback' }),
      bead('p-e.4', {
        parentId: 'p-e',
        title: 'Background fetch',
        status: 'blocked',
        priority: 1,
        labels: ['ios', 'downloads', 'battery'],
        description: 'Queue keeps draining.',
        acceptance: '- Works for 30 minutes\n- Respects Wi-Fi only',
        notes: 'Wait for the session work first.',
      }),
    ];
    const { store } = setup(service(() => live({ beads })));
    await openProject(store);
    await select(store, 'p-e.4');
    const detail = screen.getByRole('region', { name: 'Background fetch' });
    expect(within(detail).getByRole('heading', { name: 'Background fetch' })).toBeTruthy();
    expect(within(detail).getByText('p-e.4')).toBeTruthy();
    expect(within(detail).getByText('unassigned')).toBeTruthy();
    for (const label of ['ios', 'downloads', 'battery']) expect(within(detail).getByText(label)).toBeTruthy();
    expect(within(detail).getByText('Offline playback', { selector: '.bd-crumb *' })).toBeTruthy();
    expect(document.querySelector('[data-section="description"]')).toBeTruthy();
    expect(document.querySelector('[data-section="acceptance"]')?.textContent).toContain('Respects Wi-Fi only');
    expect(document.querySelector('[data-section="design"]')).toBeNull();
    // Notes start folded, with a one-line preview, and open on click.
    const notes = document.querySelector<HTMLElement>('[data-section="notes"]')!;
    const toggle = within(notes).getByRole('button', { name: /Notes/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(notes.querySelector('.bd-peek')?.textContent).toContain('Wait for the session work');
    await act(async () => {
      fireEvent.click(toggle);
      await flush();
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // The list's search and view switcher step aside.
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('renders unknown status with fallback', async () => {
    const beads = [bead('p-a', { status: 'mystery' })];
    const { store } = setup(service(() => live({ beads })));
    await openProject(store);
    await select(store, 'p-a');
    const pill = document.querySelector('.bd-pill')!;
    expect(pill.textContent).toContain('mystery');
    expect(pill.querySelector('.bd-sd')?.getAttribute('data-look')).toBe('other');
  });

  it('shows extra fields in More', async () => {
    const beads = [bead('p-a', { extra: { external_ref: 'gh-12', estimated_minutes: 45, metadata: { team: 'core' } } })];
    const { store } = setup(service(() => live({ beads })));
    await openProject(store);
    await select(store, 'p-a');
    const more = document.querySelector<HTMLElement>('[data-section="more"]')!;
    // The count is of fields, not of rows: metadata's key is a row of its own.
    expect(more.querySelector('.bd-sh .bd-n')?.textContent).toBe('3');
    expect(more.querySelectorAll('.bd-more-row')).toHaveLength(4);
    expect(within(more).getByText('External ref')).toBeTruthy();
    expect(within(more).getByText('gh-12')).toBeTruthy();
    expect(within(more).getByText('45m')).toBeTruthy();
    expect(within(more).getByText('team')).toBeTruthy();
    expect(within(more).getByText('core')).toBeTruthy();
    expect(within(more).queryByText('{"team":"core"}')).toBeNull();
  });

  it('shows the change banner from the unseen change, marks the bead seen, and keeps the banner for this visit', async () => {
    const beads = [bead('p-a', { status: 'blocked' })];
    let unseenIds = ['p-a'];
    const activity = [event({ beadId: 'p-a', kind: 'field', field: 'status', from: 'open', to: 'blocked' })];
    const { store, calls } = setup((call) => {
      if (call.route === 'seen') {
        unseenIds = [];
        return json({ unseenIds });
      }
      return service(() => live({ beads, unseenIds, activity: activity.map((e) => ({ ...e, unseen: unseenIds.includes(e.beadId) })) }))(call);
    });
    await openProject(store);
    expect(store.get().snapshot?.unseenIds).toEqual(['p-a']);
    await select(store, 'p-a');
    expect(calls.find((c) => c.route === 'seen')?.body).toEqual({ directory: '/p/a', ids: ['p-a'] });
    expect(store.get().snapshot?.unseenIds).toEqual([]);
    expect(store.get().snapshot?.activity[0]?.unseen).toBe(false);
    const banner = screen.getByRole('status', { name: 'Change since you last looked' });
    expect(banner.textContent).toContain('Changed 9m ago by Claude Code: open');
    // The arrow is drawn for the eye; screen readers hear "open to blocked".
    const arrow = Array.from(banner.querySelectorAll('[aria-hidden="true"]')).find((el) => el.textContent === '→');
    expect(arrow).toBeTruthy();
    expect(banner.querySelector('.bd-vh')?.textContent?.trim()).toBe('to');
    expect(banner.querySelector('.bd-banner-to')?.textContent).toBe('blocked');
    await act(async () => {
      fireEvent.click(within(banner).getByRole('button', { name: 'Dismiss' }));
      await flush();
    });
    expect(screen.queryByRole('status', { name: 'Change since you last looked' })).toBeNull();
  });

  it('shows the list\'s copy of the bead at once while the full one loads', async () => {
    const beads = [bead('p-a', { title: 'Quick title', description: 'Old text' })];
    const pending = deferred<Answer>();
    const { store } = setup(service(() => live({ beads }), () => pending.promise));
    await openProject(store);
    await select(store, 'p-a');
    expect(screen.getByRole('heading', { name: 'Quick title' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Quick title' }).getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      pending.resolve(json({ bead: { ...beads[0]!, description: 'Fresh text', comments: [{ id: 'c1', author: 'Bob', text: 'Fresh comment', createdAt: iso(5 * MIN) }] }, related: { parent: null, children: [], deps: [] } }));
      await flush();
    });
    expect(screen.getByText('Fresh text')).toBeTruthy();
    expect(screen.getByText('Fresh comment')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Quick title' }).getAttribute('aria-busy')).toBe('false');
  });

  it('reads the bead again when the list shows it changed', async () => {
    let beads = [bead('p-a', { title: 'Before' })];
    let cursor = 1;
    const { store, calls } = setup(service(() => live({ beads, cursor: `c${cursor}` })));
    await openProject(store);
    await select(store, 'p-a');
    const reads = () => calls.filter((c) => c.route === 'bead').length;
    expect(reads()).toBe(1);
    // A poll that changes nothing about this bead does not read it again.
    cursor = 2;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await flush();
    });
    expect(reads()).toBe(1);
    beads = [bead('p-a', { title: 'After', updatedAt: iso(0) })];
    cursor = 3;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await flush();
    });
    expect(reads()).toBe(2);
    expect(screen.getByRole('heading', { name: 'After' })).toBeTruthy();
  });

  it('reads the bead again when a shown field changed within the same second (same updatedAt)', async () => {
    let beads = [bead('p-a', { priority: 2 })];
    let cursor = 1;
    const { store, calls } = setup(service(() => live({ beads, cursor: `c${cursor}` })));
    await openProject(store);
    await select(store, 'p-a');
    const reads = () => calls.filter((c) => c.route === 'bead').length;
    expect(reads()).toBe(1);
    beads = [bead('p-a', { priority: 0 })];
    cursor = 2;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await flush();
    });
    expect(reads()).toBe(2);
  });

  it('navigates relationships, and Back returns through them to the list with the row still selected', async () => {
    const beads = [
      bead('p-e', { type: 'epic', title: 'The epic' }),
      bead('p-a', { parentId: 'p-e', title: 'Main bead', dependencies: [dep('p-a', 'p-e', 'parent-child'), dep('p-a', 'p-b', 'blocks')] }),
      bead('p-b', { title: 'Blocker bead', status: 'in_progress' }),
    ];
    const { store } = setup(service(() => live({ beads })));
    await openProject(store);
    await select(store, 'p-a');
    const blockedBy = screen.getByRole('button', { name: /Blocker bead/ });
    expect(blockedBy.closest('[data-group]')?.getAttribute('data-group')).toBe('blocks-out');
    await act(async () => {
      fireEvent.click(blockedBy);
      await flush();
    });
    expect(screen.getByRole('heading', { name: 'Blocker bead' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      await flush();
    });
    expect(screen.getByRole('heading', { name: 'Main bead' })).toBeTruthy();
    // Escape goes back too.
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
      await flush();
    });
    expect(screen.queryByRole('heading', { name: 'Main bead' })).toBeNull();
    expect(store.get().selectedId).toBe('p-a');
    expect(document.getElementById('bd-row-p-a')?.getAttribute('aria-selected')).toBe('true');
  });

  it('shows comments, who wrote them, and when the bead was created, updated and closed with its reason', async () => {
    const panelActor = 'Alice (panel)';
    const beads = [
      bead('p-a', {
        status: 'closed',
        createdBy: 'Claude Code',
        closedAt: iso(2 * 3_600_000),
        closeReason: 'Fixed in abc123',
        comments: [
          { id: 'c1', author: 'Bob Builder', text: 'First **look**', createdAt: iso(40 * MIN) },
          { id: 'c2', author: panelActor, text: 'From the panel', createdAt: iso(20 * MIN) },
          { id: 'c3', author: null, text: 'No name', createdAt: iso(10 * MIN) },
        ],
      }),
    ];
    const { store } = setup(service(() => live({ beads, panelActor })));
    await openProject(store);
    await select(store, 'p-a');
    const comments = screen.getAllByRole('article');
    expect(comments.map((c) => c.querySelector('.bd-cm-who b')?.textContent)).toEqual(['Bob Builder', 'you (panel)', 'unknown']);
    expect(comments[0]!.querySelector('strong')?.textContent).toBe('look');
    const stamp = document.querySelector('.bd-stamp')!.textContent!;
    expect(stamp).toContain('Created');
    expect(stamp).toContain('by Claude Code');
    expect(stamp).toContain('Closed 2h ago');
    expect(stamp).toContain('Fixed in abc123');
  });

  it('shows the close reason from the activity for a custom done status', async () => {
    const beads = [bead('p-a', { status: 'shipped' })];
    const activity = [event({ beadId: 'p-a', kind: 'closed', reason: 'Released in 1.4', unseen: false, observedAt: iso(30 * MIN) })];
    const { store } = setup(service(() => live({ beads, activity })));
    await openProject(store);
    await select(store, 'p-a');
    const stamp = document.querySelector('.bd-stamp')!.textContent!;
    expect(stamp).toContain('Closed 30m ago');
    expect(stamp).toContain('Released in 1.4');
  });

  it('keeps showing the bead when reading it fails, with a way to try again', async () => {
    const beads = [bead('p-a', { title: 'Still here' })];
    let fail = true;
    const { store } = setup(service(() => live({ beads }), (id) => (fail ? json({ error: { code: 'busy', message: 'Beads is busy.' } }, 503) : json({ bead: beads.find((b) => b.id === id), related: { parent: null, children: [], deps: [] } }))));
    await openProject(store);
    await select(store, 'p-a');
    expect(screen.getByRole('heading', { name: 'Still here' })).toBeTruthy();
    expect(screen.getByText('Beads is busy.')).toBeTruthy();
    fail = false;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await flush();
    });
    expect(screen.queryByText('Beads is busy.')).toBeNull();
  });

  it('shows a close time from the audit log as the day it was written, in any time zone', async () => {
    const beads = [bead('p-a', { status: 'shipped' })];
    const activity = [event({ beadId: 'p-a', kind: 'closed', historical: true, observedAt: '2026-10-02', unseen: false })];
    const { store } = setup(service(() => live({ beads, activity })));
    await openProject(store);
    await select(store, 'p-a');
    const stamp = document.querySelector('.bd-stamp')!.textContent!;
    expect(stamp).toMatch(/Closed Oct 2\b/);
    expect(stamp).not.toMatch(/Closed Oct 1\b/);
  });

  it('keeps relationships live: a new child and a new incoming link appear, a deleted child goes', async () => {
    const epic = bead('p-e', { type: 'epic', title: 'The epic' });
    let beads = [epic, bead('p-e.1', { parentId: 'p-e', title: 'First child' }), bead('p-e.2', { parentId: 'p-e', title: 'Doomed child' })];
    let cursor = 1;
    const { store } = setup(service(() => live({ beads, cursor: `c${cursor}` })));
    await openProject(store);
    await select(store, 'p-e');
    const childCount = () => document.querySelector('[data-group="children"] .bd-rlab .bd-n')?.textContent;
    expect(childCount()).toBe('0/2 done');
    // The epic itself does not change, so it is not read again; its relationships still follow the list.
    beads = [
      epic,
      bead('p-e.1', { parentId: 'p-e', title: 'First child', status: 'closed', closedAt: iso(MIN) }),
      bead('p-e.3', { parentId: 'p-e', title: 'New child' }),
      bead('p-x', { title: 'Waits on the epic', dependencies: [dep('p-x', 'p-e', 'blocks')] }),
    ];
    cursor = 2;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await flush();
    });
    expect(screen.getByRole('button', { name: /New child/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Doomed child/ })).toBeNull();
    expect(childCount()).toBe('1/2 done');
    expect(screen.getByRole('button', { name: /Waits on the epic/ }).closest('[data-group]')?.getAttribute('data-group')).toBe('blocks-in');
  });

  it('shows a parent the project no longer has as a row that can still be reached for its details', async () => {
    const beads = [bead('p-a', { parentId: 'p-gone' })];
    const { store } = setup(service(() => live({ beads })));
    await openProject(store);
    await select(store, 'p-a');
    const row = document.querySelector<HTMLElement>('[data-group="parent"] .bd-rel[data-missing]')!;
    expect(row.textContent).toContain('p-gone');
    expect(row.getAttribute('tabindex')).toBe('0');
  });

  it('drops a bead answer that arrives after the project changed, even for a bead of the same id', async () => {
    const old = bead('p-a', { title: 'From the old project' });
    const fresh = bead('p-a', { title: 'From the new project' });
    const pending = deferred<Answer>();
    const { store } = setup((call) => {
      const b = call.body.directory === '/p/a' ? old : fresh;
      if (call.route === 'bead') return call.body.directory === '/p/a' ? pending.promise : json({ bead: fresh, related: { parent: null, children: [], deps: [] } });
      return service(() => live({ beads: [b] }))(call);
    });
    await openProject(store);
    await select(store, 'p-a');
    await act(async () => {
      store.setDirectory('/p/b');
      await flush();
    });
    expect(store.get().detail).toBeNull();
    // The new project has a bead with the same id; open it before the old answer lands.
    await select(store, 'p-a');
    expect(screen.getByRole('heading', { name: 'From the new project' })).toBeTruthy();
    await act(async () => {
      pending.resolve(json({ bead: { ...old, updatedAt: iso(0) }, related: { parent: null, children: [], deps: [] } }));
      await flush();
    });
    expect(store.get().detail?.data?.bead.title).toBe('From the new project');
    expect(screen.getByRole('heading', { name: 'From the new project' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'From the old project' })).toBeNull();
  });

  it('offers to copy a link the panel cannot open, instead of doing nothing', async () => {
    const beads = [bead('p-a', { description: 'See [the notes](docs/notes.md) and [a file](file:///etc/hosts).' })];
    const { store, openUrl, toast } = setup(service(() => live({ beads })));
    await openProject(store);
    await select(store, 'p-a');
    await act(async () => {
      fireEvent.click(screen.getByText('the notes'));
      await flush();
    });
    expect(openUrl).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ copy: { text: 'docs/notes.md' } }));
  });

  it('says what an open bead waits on, by id, and opens it', async () => {
    const beads = [bead('p-a', { dependencies: [dep('p-a', 'p-blk', 'blocks')] }), bead('p-blk', { status: 'in_progress', title: 'The blocker' })];
    const { store } = setup(service(() => live({ beads, readyIds: ['p-blk'] })));
    await openProject(store);
    await select(store, 'p-a');
    const hint = document.querySelector<HTMLElement>('.bd-dhint')!;
    expect(hint.textContent).toContain('Waiting on');
    await act(async () => {
      fireEvent.click(within(hint).getByRole('button', { name: 'blk' }));
      await flush();
    });
    expect(screen.getByRole('heading', { name: 'The blocker' })).toBeTruthy();
  });

  it('says what each done count covers', async () => {
    const beads = [bead('p-e', { type: 'epic' }), bead('p-a', { parentId: 'p-e' }), bead('p-a.1', { parentId: 'p-a' })];
    const { store } = setup(service(() => live({ beads })));
    await openProject(store);
    await select(store, 'p-a');
    expect(document.querySelector('[data-group="parent"] .bd-sub')?.getAttribute('title')).toMatch(/parent/);
    expect(document.querySelector('[data-group="children"] .bd-rlab .bd-n')?.getAttribute('title')).toMatch(/this bead/);
  });
});
