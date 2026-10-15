// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { createClient } from '../../../src/panel/client';
import { createStore, StoreContext } from '../../../src/panel/store';
import {
  acceptanceBlocks,
  acceptanceItems,
  acceptanceLines,
  toggleLine,
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
import type { Bead, ChangeEvent, Dependency, ExplainResult, Gate, GateCreateResult, GateResolveResult, HistoryChange, HistoryEntry, HistoryResult, Related, StatusDef, WriteResult } from '../../../src/shared/types';
import { PLAN_APPROVAL_REASON, REVIEW_REASON } from '../../../src/shared/gates';
import { deferred, envelope, fakeHost, flush, freshness, json, snapshot, type Answer, type Call } from './helpers';

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

  it('reads a change a few seconds ahead of the panel clock as just now, like the age in the row corner (L5)', () => {
    const ahead = event({ beadId: 'p-a', kind: 'comment', changedAt: new Date(NOW + 20_000).toISOString() });
    expect(changeText(changeLine(ahead, STATUSES, NOW))).toBe('New comment just now by Claude Code');
    // Far ahead is not skew: it keeps the date.
    const far = event({ beadId: 'p-a', kind: 'comment', changedAt: new Date(NOW + 3 * 3_600_000).toISOString() });
    expect(changeText(changeLine(far, STATUSES, NOW))).toMatch(/^New comment Oct 14, /);
    // A day or more old keeps the date too.
    const old = event({ beadId: 'p-a', kind: 'comment', changedAt: iso(2 * DAY) });
    expect(changeText(changeLine(old, STATUSES, NOW))).toMatch(/^New comment Oct 12, /);
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

  it('words a gate that was asked for, resolved, deleted or unlinked, by its kind', () => {
    const g = (over: Partial<Activity>) => changeText(changeLine(event({ beadId: 'p-a', kind: 'gate_resolved', gateId: 'p-g1', gateKind: 'human', reason: 'Review before closing', ...over }), STATUSES, NOW));
    expect(g({ kind: 'gate_opened' })).toBe('Review requested 9m ago by Claude Code: Review before closing');
    expect(g({})).toBe('Review resolved 9m ago by Claude Code: Review before closing');
    expect(g({ actor: null })).toBe('Review resolved 9m ago by someone else: Review before closing');
    expect(g({ actor: 'Alice (panel)', byPanel: true })).toBe('Review resolved 9m ago by you (panel): Review before closing');
    expect(g({ ended: 'deleted', actor: null })).toBe('Review deleted 9m ago: Review before closing');
    expect(g({ ended: 'unlinked', actor: null })).toBe('Review removed from this bead 9m ago: Review before closing');
    expect(g({ gateKind: 'timer', actor: null, reason: 'Soak for a day' })).toBe('Timer ended 9m ago: Soak for a day');
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

  const MIXED = 'Intro **bold**\n\n- [ ] First  \n- [x] Second\n  - plain sub\n1. [X] Numbered\r\n\n```\n- [ ] in code\n```\nTail';

  it('reads every line: boxes, bullets and text, never a box inside a code block', () => {
    const lines = acceptanceLines(MIXED);
    expect(lines.filter((l) => l.kind === 'box').map((l) => [l.index, l.text, l.done])).toEqual([
      [2, 'First', false],
      [3, 'Second', true],
      [5, 'Numbered', true],
    ]);
    expect(lines.find((l) => l.text === 'plain sub')).toMatchObject({ kind: 'bullet', depth: 1 });
    expect(lines.find((l) => l.text.includes('in code'))?.kind).toBe('text');
    expect(acceptanceBlocks(MIXED).map((b) => b.kind)).toEqual(['text', 'list', 'text']);
  });

  it('a rule is not a bullet, and only the fence that opened a code block closes it', () => {
    const text = '- [ ] Before\n* * *\n- - -\n~~~\n```\n- [ ] still code\n~~~\n- [ ] After';
    const lines = acceptanceLines(text);
    expect(lines.filter((l) => l.kind === 'box').map((l) => l.text)).toEqual(['Before', 'After']);
    expect(lines.filter((l) => l.kind === 'bullet')).toEqual([]);
  });

  it('a tick flips only the box on that line, every other byte as it was', () => {
    expect(toggleLine(MIXED, 2)).toBe(MIXED.replace('- [ ] First  ', '- [x] First  '));
    expect(toggleLine(MIXED, 5)).toBe(MIXED.replace('1. [X] Numbered\r', '1. [ ] Numbered\r'));
    // No box, no tick: a bullet, prose, a box in code, a line that is not there.
    for (const index of [0, 4, 8, 99]) expect(toggleLine(MIXED, index)).toBeNull();
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

// ------------------------------------------------------------------------------------------------- gates

const HOUR = 3_600_000;
const gate = (id: string, over: Partial<Gate> = {}): Gate => ({
  id, kind: 'human', reason: REVIEW_REASON, blocks: ['p-a'], createdBy: 'Claude Code', createdAt: iso(2 * HOUR), timeoutMs: null, planApproval: false, ...over,
});
const planGate = (id: string, over: Partial<Gate> = {}) => gate(id, { reason: PLAN_APPROVAL_REASON, planApproval: true, ...over });

type Routes = Partial<Record<string, (call: Call) => Answer | Promise<Answer>>>;

/** A project whose snapshot is read from `snap()` each time, with extra routes answered by `routes`. */
function gated(snap: () => ReturnType<typeof live>, routes: Routes = {}) {
  const base = service(snap);
  return setup((call) => routes[call.route]?.(call) ?? (call.route === 'explain' ? envelope(500, { code: 'failed', message: 'No answer' }) : base(call)));
}

const block = () => document.querySelector<HTMLElement>('.bd-gates');
const gateItems = () => Array.from(document.querySelectorAll<HTMLElement>('.bd-gate'));
const press = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
    await flush();
  });
};
const keyIn = async (el: Element, key: string) => {
  await act(async () => {
    fireEvent.keyDown(el, { key });
    await flush();
  });
};
const typeIn = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    fireEvent.input(el, { target: { value } });
    await flush();
  });
};
const poll = async (store: ReturnType<typeof setup>['store']) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
    await flush();
  });
  void store;
};

describe('gates on the detail', () => {
  it('waiting on lists open gates only, with kind, reason, who and when, and never a gate id', async () => {
    const gates = [gate('p-g1'), gate('p-g2', { kind: 'timer', reason: 'Cool down', timeoutMs: 5 * HOUR }), gate('p-g3', { blocks: ['p-b'] })];
    const beads = [bead('p-a', { dependencies: [dep('p-a', 'p-g0', 'blocks'), dep('p-a', 'p-g1', 'blocks'), dep('p-a', 'p-g2', 'blocks')] }), bead('p-b'), bead('p-c')];
    const { store } = gated(() => live({ beads, gates, gateIds: ['p-g0', 'p-g1', 'p-g2', 'p-g3'], readyIds: ['p-c'] }));
    await openProject(store);
    await select(store, 'p-a');
    expect(within(block()!).getByRole('heading', { name: /Waiting on/ })).toBeTruthy();
    expect(within(block()!).getByRole('list')).toBeTruthy();
    const items = gateItems();
    expect(items.map((li) => li.querySelector('.bd-tag')?.textContent)).toEqual(['Review', 'Timer']);
    expect(items[0]!.textContent).toContain(REVIEW_REASON);
    expect(items[0]!.textContent).toContain('Asked by Claude Code, 2h ago');
    expect(items[1]!.textContent).toContain('Cool down');
    expect(items[1]!.textContent).toContain('Ends in 3h');
    expect(document.querySelector('.bd-detail')!.textContent).not.toMatch(/p-g\d|g0|g1|g2/);
    // A bead with no open gate has no block.
    await select(store, 'p-c');
    expect(block()).toBeNull();
  });

  it('resolve is offered for human gates only; a plan approval is approved', async () => {
    const gates = [gate('p-g1'), planGate('p-g2'), gate('p-g3', { kind: 'gh:pr', reason: null }), gate('p-g4', { kind: 'timer' })];
    const { store } = gated(() => live({ beads: [bead('p-a')], gates, gateIds: gates.map((g) => g.id), readyIds: [] }));
    await openProject(store);
    await select(store, 'p-a');
    const [review, plan, pr, timer] = gateItems();
    expect(within(review!).getByRole('button', { name: 'Resolve' })).toBeTruthy();
    expect(within(review!).getByRole('button', { name: 'Add a reason' })).toBeTruthy();
    expect(plan!.querySelector('.bd-tag')?.textContent).toBe('Plan approval');
    expect(within(plan!).getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(within(pr!).queryAllByRole('button')).toHaveLength(0);
    expect(pr!.textContent).toContain('GitHub pull request');
    expect(pr!.textContent).toContain('No reason given');
    expect(pr!.textContent).toContain('Beads checks GitHub for it');
    expect(within(timer!).queryAllByRole('button')).toHaveLength(0);
  });

  it('resolve sends on one click, once, while busy; then says so and focus moves on without scrolling', async () => {
    let gates = [gate('p-g1'), planGate('p-g2')];
    const answer = deferred<Answer>();
    const { store, calls, toast } = gated(() => live({ beads: [bead('p-a')], gates, gateIds: ['p-g1', 'p-g2'], readyIds: [] }), { gateResolve: () => answer.promise });
    await openProject(store);
    await select(store, 'p-a');
    const resolve = within(gateItems()[0]!).getByRole('button', { name: 'Resolve' }) as HTMLButtonElement;
    resolve.focus();
    await press(resolve);
    await press(resolve);
    expect(calls.filter((c) => c.route === 'gateResolve')).toHaveLength(1);
    expect(calls.find((c) => c.route === 'gateResolve')?.body).toEqual({ directory: '/p/a', gateId: 'p-g1' });
    expect(resolve.disabled).toBe(true);
    expect(resolve.getAttribute('aria-busy')).toBe('true');
    // The other gate is not held by this one's write.
    expect((within(gateItems()[1]!).getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(false);
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    await act(async () => {
      answer.resolve(json({ ok: true, gateId: 'p-g1' } satisfies GateResolveResult));
      await flush();
    });
    expect(within(gateItems()[0]!).getByRole('status').textContent).toBe('Resolved. Updating.');
    expect(within(gateItems()[0]!).queryByRole('button', { name: 'Resolve' })).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Review resolved for a.' }));
    expect(document.activeElement).toBe(gateItems()[0]);
    gates = [gates[1]!];
    await poll(store);
    expect(gateItems()).toHaveLength(1);
    expect(document.activeElement).toBe(gateItems()[0]);
    for (const call of focusSpy.mock.calls) expect(call[0]).toEqual({ preventScroll: true });
    focusSpy.mockRestore();
  });

  it('resolve with a reason: Enter sends it, Escape cancels and goes back to Add a reason', async () => {
    const { store, calls } = gated(() => live({ beads: [bead('p-a')], gates: [gate('p-g1')], gateIds: ['p-g1'], readyIds: [] }), {
      gateResolve: () => json({ ok: true, gateId: 'p-g1' } satisfies GateResolveResult),
    });
    await openProject(store);
    await select(store, 'p-a');
    await press(within(gateItems()[0]!).getByRole('button', { name: 'Add a reason' }));
    const field = screen.getByRole('textbox', { name: 'Reason for resolving' }) as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    await keyIn(field, 'Escape');
    expect(screen.queryByRole('textbox', { name: 'Reason for resolving' })).toBeNull();
    // Escape in the step does not leave the bead.
    expect(store.get().detail).not.toBeNull();
    expect(document.activeElement?.textContent).toBe('Add a reason');
    await press(within(gateItems()[0]!).getByRole('button', { name: 'Add a reason' }));
    await typeIn(screen.getByRole('textbox', { name: 'Reason for resolving' }) as HTMLInputElement, 'Looks right');
    await keyIn(screen.getByRole('textbox', { name: 'Reason for resolving' }), 'Enter');
    expect(calls.find((c) => c.route === 'gateResolve')?.body).toEqual({ directory: '/p/a', gateId: 'p-g1', reason: 'Looks right' });
    expect(document.querySelector('form')).toBeNull();
  });

  it('a gate someone else resolved first says who, with no error', async () => {
    const { store } = gated(() => live({ beads: [bead('p-a')], gates: [gate('p-g1')], gateIds: ['p-g1'], readyIds: [] }), {
      gateResolve: () => json({ ok: false, code: 'already-resolved', resolvedBy: 'Claude Code', at: iso(5 * MIN) } satisfies GateResolveResult),
    });
    await openProject(store);
    await select(store, 'p-a');
    await press(within(gateItems()[0]!).getByRole('button', { name: 'Resolve' }));
    expect(within(gateItems()[0]!).getByRole('status').textContent).toBe('This review was already resolved by Claude Code 5m ago. Updating.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('review before closing: one click from the bead menu asks with the default reason and shows the gate', async () => {
    const made = gate('p-g9', { createdBy: 'Ann (panel)', createdAt: iso(0) });
    const { store, calls, toast } = gated(() => live({ beads: [bead('p-a')], panelActor: 'Ann (panel)' }), {
      gateCreate: () => json({ ok: true, gate: made } satisfies GateCreateResult),
    });
    await openProject(store);
    await select(store, 'p-a');
    expect(block()).toBeNull();
    await press(screen.getByRole('button', { name: 'Bead actions' }));
    await press(screen.getByRole('menuitem', { name: 'Ask for a review' }));
    expect(calls.filter((c) => c.route === 'gateCreate').map((c) => c.body)).toEqual([{ directory: '/p/a', id: 'p-a' }]);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Review asked for on a.' }));
    // Shown from the answer, before the list catches up.
    expect(gateItems()).toHaveLength(1);
    expect(gateItems()[0]!.textContent).toContain('Asked by you (panel)');
    expect(document.activeElement).toBe(gateItems()[0]);
  });

  it('request review creates a gate with the typed reason', async () => {
    const { store, calls } = gated(() => live({ beads: [bead('p-a')] }), { gateCreate: (call) => json({ ok: true, gate: gate('p-g9', { reason: call.body.reason as string }) } satisfies GateCreateResult) });
    await openProject(store);
    await select(store, 'p-a');
    await press(screen.getByRole('button', { name: 'Bead actions' }));
    await press(screen.getByRole('menuitem', { name: 'Ask with a reason…' }));
    const field = screen.getByRole('textbox', { name: 'Reason for the review' }) as HTMLInputElement;
    expect(field.value).toBe(REVIEW_REASON);
    expect(document.activeElement).toBe(field);
    await typeIn(field, 'Check the copy on the empty state');
    await keyIn(field, 'Enter');
    expect(calls.find((c) => c.route === 'gateCreate')?.body).toEqual({ directory: '/p/a', id: 'p-a', reason: 'Check the copy on the empty state' });
    expect(screen.queryByRole('textbox', { name: 'Reason for the review' })).toBeNull();
    expect(gateItems()[0]!.textContent).toContain('Check the copy on the empty state');
  });

  it('approve plan creates the known reason, from beside Design or with a reason of its own', async () => {
    const first = deferred<Answer>();
    const { store, calls } = gated(() => live({ beads: [bead('p-a', { design: 'The plan' })] }), {
      gateCreate: (call) => (calls.filter((c) => c.route === 'gateCreate').length === 1 ? first.promise : json({ ok: true, gate: planGate('p-g2', { reason: call.body.reason as string }) } satisfies GateCreateResult)),
    });
    await openProject(store);
    await select(store, 'p-a');
    const design = document.querySelector<HTMLElement>('[data-section="design"]')!;
    const ask = within(design).getByRole('button', { name: 'Ask for plan approval' }) as HTMLButtonElement;
    await press(ask);
    await press(ask);
    expect(ask.disabled).toBe(true);
    await act(async () => {
      first.resolve(json({ ok: true, gate: planGate('p-g1') } satisfies GateCreateResult));
      await flush();
    });
    expect(calls.filter((c) => c.route === 'gateCreate').map((c) => c.body)).toEqual([{ directory: '/p/a', id: 'p-a', reason: PLAN_APPROVAL_REASON }]);
    // While one is open, the action beside Design steps aside.
    expect(within(design).queryByRole('button', { name: 'Ask for plan approval' })).toBeNull();
    expect(gateItems()[0]!.querySelector('.bd-tag')?.textContent).toBe('Plan approval');

    await press(screen.getByRole('button', { name: 'Bead actions' }));
    await press(screen.getByRole('menuitem', { name: 'Ask with a reason…' }));
    await press(screen.getByRole('button', { name: 'Plan approval' }));
    const field = screen.getByRole('textbox', { name: 'Reason for the plan approval' }) as HTMLInputElement;
    expect(field.value).toBe(PLAN_APPROVAL_REASON);
    await typeIn(field, 'Second pass on the data model');
    await press(screen.getByRole('button', { name: 'Ask for plan approval' }));
    expect(calls.filter((c) => c.route === 'gateCreate')[1]?.body).toEqual({ directory: '/p/a', id: 'p-a', reason: `${PLAN_APPROVAL_REASON}: Second pass on the data model` });
  });

  it('already-open shows the existing gate instead of an error', async () => {
    const open = gate('p-g1', { reason: 'Look at the copy' });
    const { store } = gated(() => live({ beads: [bead('p-a')], gates: [open], gateIds: ['p-g1'], readyIds: [] }), {
      gateCreate: () => json({ ok: false, code: 'already-open', gate: open } satisfies GateCreateResult),
    });
    await openProject(store);
    await select(store, 'p-a');
    await press(screen.getByRole('button', { name: 'Bead actions' }));
    await press(screen.getByRole('menuitem', { name: 'Ask for a review' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(gateItems()).toHaveLength(1);
    expect(gateItems()[0]!.hasAttribute('data-found')).toBe(true);
    expect(within(gateItems()[0]!).getByRole('status').textContent).toBe('This bead already waits on a review.');
  });

  it('a refused ask is said in plain words where the block goes', async () => {
    const { store } = gated(() => live({ beads: [bead('p-a')] }), { gateCreate: () => envelope(503, { code: 'busy', message: 'Beads is busy. Nothing was saved. Try again in a moment.' }) });
    await openProject(store);
    await select(store, 'p-a');
    await press(screen.getByRole('button', { name: 'Bead actions' }));
    await press(screen.getByRole('menuitem', { name: 'Ask for a review' }));
    expect(screen.getByRole('alert').textContent).toContain('Beads is busy. Nothing was saved.');
  });

  it('gate edges are not listed as relationships', async () => {
    const beads = [bead('p-a', { dependencies: [dep('p-a', 'p-g0', 'blocks'), dep('p-a', 'p-g1', 'blocks'), dep('p-a', 'p-b', 'blocks')] }), bead('p-b', { title: 'Real blocker' })];
    const { store } = gated(() => live({ beads, gates: [gate('p-g1')], gateIds: ['p-g0', 'p-g1'], readyIds: ['p-b'] }));
    await openProject(store);
    await select(store, 'p-a');
    const rels = document.querySelector<HTMLElement>('[data-section="relationships"]')!;
    expect(rels.querySelectorAll('.bd-rel')).toHaveLength(1);
    expect(rels.textContent).toContain('Real blocker');
    expect(rels.textContent).not.toContain('Not in this project');
    // Only gate edges: no Relationships section at all.
    const only = [bead('p-c', { dependencies: [dep('p-c', 'p-g0', 'blocks')] })];
    cleanup();
    const second = gated(() => live({ beads: only, gateIds: ['p-g0'] }));
    await openProject(second.store);
    await select(second.store, 'p-c');
    expect(document.querySelector('[data-section="relationships"]')).toBeNull();
  });

  it('why line for blocked, gated, snoozed', async () => {
    const beads = [
      bead('p-a', { dependencies: [dep('p-a', 'p-blk', 'blocks')] }),
      bead('p-blk', { status: 'in_progress', title: 'The blocker' }),
      bead('p-gt'),
      bead('p-sn', { extra: { defer_until: iso(-3 * DAY) } }),
    ];
    const gates = [gate('p-g1', { blocks: ['p-gt'] }), gate('p-g2', { kind: 'timer', blocks: ['p-gt'] })];
    const { store, calls } = gated(() => live({ beads, gates, gateIds: ['p-g1', 'p-g2'], readyIds: ['p-blk'] }));
    await openProject(store);
    await select(store, 'p-a');
    expect(document.querySelector('.bd-dhint')?.textContent).toBe('Waiting on blk The blocker');
    await select(store, 'p-gt');
    expect(document.querySelector('.bd-dhint')?.textContent).toBe('Waiting on a review and a timer');
    await select(store, 'p-sn');
    expect(document.querySelector('.bd-dhint')?.textContent).toMatch(/^Deferred until /);
    // Asked once per bead and snapshot, only for open beads that are not ready.
    expect(calls.filter((c) => c.route === 'explain').map((c) => c.body.id)).toEqual(['p-a', 'p-gt', 'p-sn']);
  });

  it('the why line takes Beads\' own answer when it names more than the list shows', async () => {
    const beads = [bead('p-a')];
    const explain: ExplainResult = { state: 'blocked', blockers: [{ id: 'p-far', title: 'Far away', status: 'open' }, { id: 'p-g1', title: 'gate', status: 'open' }] };
    const { store } = gated(() => live({ beads, gates: [gate('p-g1')], gateIds: ['p-g1'], readyIds: [] }), { explain: () => json(explain) });
    await openProject(store);
    await select(store, 'p-a');
    // Before Beads answers, the list's words; then Beads' own.
    expect(document.querySelector('.bd-dhint')?.textContent).toBe('Waiting on a review');
    await act(flush);
    const hint = document.querySelector<HTMLElement>('.bd-dhint')!;
    expect(hint.textContent).toBe('Waiting on a review and far Far away');
    // Not in this project's list: named, not a link.
    expect(within(hint).queryByRole('button')).toBeNull();
  });

  it('explain failure leaves no line and no error', async () => {
    const { store, calls } = gated(() => live({ beads: [bead('p-a', { extra: { defer_until: iso(-DAY) } })], readyIds: [] }));
    await openProject(store);
    await select(store, 'p-a');
    expect(calls.some((c) => c.route === 'explain')).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('.bd-dhint[data-tone="blocked"]')).toBeNull();
    expect(document.querySelector('.bd-derr')).toBeNull();
  });

  it('closing a gated bead names the gate, keeping "Your comment was added"', async () => {
    let n = 0;
    const { store } = gated(() => live({ beads: [bead('p-a')], gates: [gate('p-g1')], gateIds: ['p-g1'], readyIds: [] }), {
      update: () =>
        ++n === 1
          ? envelope(409, { code: 'blocked', message: "This bead can't be closed yet. It is still blocked by p-g1. Close those first." })
          : envelope(409, { code: 'blocked', message: 'Your comment was added, but the bead could not be closed. This bead is waiting on a review. Resolve it first.' }),
    });
    await openProject(store);
    await select(store, 'p-a');
    for (let i = 0; i < 2; i++) {
      await press(screen.getByRole('button', { name: 'Status: Open' }));
      await press(screen.getByRole('menuitemradio', { name: 'Closed' }));
      await press(screen.getByRole('button', { name: 'Mark closed' }));
    }
    expect(screen.queryByText(/Close those first/)).toBeNull();
    expect(screen.queryByText(/p-g1/)).toBeNull();
    expect(screen.getByText("Your comment was added, but the bead could not be closed. This bead can't be closed yet. It is waiting on a review. Resolve the review first.")).toBeTruthy();
  });
});

describe('gates on the detail: state across reads and beads', () => {
  it('R1: after the last gate is resolved and the bead turns ready, the why line neither waits nor names the gate', async () => {
    let s = { gates: [gate('p-g1')], ready: [] as string[], cursor: 'c1' };
    const explain: ExplainResult = { state: 'blocked', blockers: [{ id: 'p-g1', title: 'Review before closing', status: 'open' }] };
    const { store } = gated(() => live({ beads: [bead('p-a')], gates: s.gates, gateIds: ['p-g1'], readyIds: s.ready, cursor: s.cursor }), {
      explain: () => json(explain),
      gateResolve: () => json({ ok: true, gateId: 'p-g1' } satisfies GateResolveResult),
    });
    await openProject(store);
    await select(store, 'p-a');
    await act(flush);
    await press(within(gateItems()[0]!).getByRole('button', { name: 'Resolve' }));
    s = { gates: [], ready: ['p-a'], cursor: 'c2' };
    await poll(store);
    expect(document.querySelector('.bd-dhint')?.textContent ?? null).toBeNull();
  });

  it('R2: an ask that lands after another bead is shown does not put its gate on that bead', async () => {
    const answer = deferred<Answer>();
    const { store } = gated(() => live({ beads: [bead('p-a'), bead('p-b')] }), { gateCreate: () => answer.promise });
    await openProject(store);
    await select(store, 'p-a');
    await press(screen.getByRole('button', { name: 'Bead actions' }));
    await press(screen.getByRole('menuitem', { name: 'Ask for a review' }));
    await select(store, 'p-b');
    await act(async () => {
      answer.resolve(json({ ok: true, gate: gate('p-g9', { blocks: ['p-a'], reason: 'Gate made on a' }) } satisfies GateCreateResult));
      await flush();
    });
    expect(gateItems()).toHaveLength(0);
  });

  it('R3: a gate found already open, then resolved elsewhere, leaves Waiting on', async () => {
    let s = { gates: [gate('p-g1', { reason: 'Look at the copy' })], cursor: 'c1' };
    const snap = () => live({ beads: [bead('p-a')], gates: s.gates, gateIds: ['p-g1'], readyIds: [], cursor: s.cursor });
    const { store } = gated(snap, {
      // Like the service: unchanged while the cursor is current.
      snapshot: (call) => {
        const now = snap();
        return call.body.cursor === now.cursor ? json({ unchanged: true, cursor: now.cursor, freshness: now.freshness, sync: now.sync }) : json(now);
      },
      gateCreate: () => json({ ok: false, code: 'already-open', gate: gate('p-g1', { reason: 'Look at the copy' }) } satisfies GateCreateResult),
    });
    await openProject(store);
    await select(store, 'p-a');
    await press(screen.getByRole('button', { name: 'Bead actions' }));
    await press(screen.getByRole('menuitem', { name: 'Ask for a review' }));
    await poll(store);
    s = { gates: [], cursor: 'c2' };
    await poll(store);
    expect(gateItems()).toHaveLength(0);
  });

  it('a bead whose blocker was closed stops waiting once the list says it is ready', async () => {
    let s = { ready: [] as string[], cursor: 'c1', blk: 'open' };
    const beads = () => [bead('p-a', { dependencies: [dep('p-a', 'p-b', 'blocks')] }), bead('p-b', { status: s.blk })];
    const { store, calls } = gated(() => live({ beads: beads(), readyIds: s.ready, cursor: s.cursor }), {
      explain: () => json({ state: 'blocked', blockers: [{ id: 'p-b', title: 'Title p-b', status: 'open' }] } satisfies ExplainResult),
    });
    await openProject(store);
    await select(store, 'p-a');
    await act(flush);
    expect(document.querySelector('.bd-dhint')?.textContent).toBe('Waiting on b Title p-b');
    s = { ready: ['p-a', 'p-b'], cursor: 'c2', blk: 'closed' };
    await poll(store);
    expect(document.querySelector('.bd-dhint[data-tone="blocked"]')).toBeNull();
    expect(calls.filter((c) => c.route === 'explain')).toHaveLength(1);
  });

  it('explain is asked again on a new snapshot while the bead still waits', async () => {
    let cursor = 'c1';
    const { store, calls } = gated(() => live({ beads: [bead('p-a')], gates: [gate('p-g1')], gateIds: ['p-g1'], readyIds: [], cursor }), {
      explain: () => json({ state: 'blocked', blockers: [{ id: 'p-g1', title: 'Review', status: 'open' }] } satisfies ExplainResult),
    });
    await openProject(store);
    await select(store, 'p-a');
    await act(flush);
    cursor = 'c2';
    await poll(store);
    expect(calls.filter((c) => c.route === 'explain')).toHaveLength(2);
    expect(document.querySelector('.bd-dhint')?.textContent).toBe('Waiting on a review');
  });

  it('asks on one bead do not hold the asks on another', async () => {
    const answer = deferred<Answer>();
    const { store } = gated(() => live({ beads: [bead('p-a'), bead('p-b', { design: 'Plan' })] }), { gateCreate: () => answer.promise });
    await openProject(store);
    await select(store, 'p-a');
    await press(screen.getByRole('button', { name: 'Bead actions' }));
    await press(screen.getByRole('menuitem', { name: 'Ask for a review' }));
    await select(store, 'p-b');
    const ask = within(document.querySelector<HTMLElement>('[data-section="design"]')!).getByRole('button', { name: 'Ask for plan approval' }) as HTMLButtonElement;
    expect(ask.disabled).toBe(false);
  });

  it('explain failure on a gated bead keeps the list\'s own words, with no error', async () => {
    const { store } = gated(() => live({ beads: [bead('p-a')], gates: [gate('p-g1', { kind: 'timer' })], gateIds: ['p-g1'], readyIds: [] }));
    await openProject(store);
    await select(store, 'p-a');
    await act(flush);
    expect(document.querySelector('.bd-dhint')?.textContent).toBe('Waiting on a timer');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Escape in the ask step goes back to the bead menu button', async () => {
    const { store } = gated(() => live({ beads: [bead('p-a')] }));
    await openProject(store);
    await select(store, 'p-a');
    await press(screen.getByRole('button', { name: 'Bead actions' }));
    await press(screen.getByRole('menuitem', { name: 'Ask with a reason…' }));
    await keyIn(screen.getByRole('textbox', { name: 'Reason for the review' }), 'Escape');
    expect(screen.queryByRole('textbox', { name: 'Reason for the review' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Bead actions' }));
    expect(store.get().detail).not.toBeNull();
  });

  it('arrow keys move through the bead menu', async () => {
    const { store } = gated(() => live({ beads: [bead('p-a')] }));
    await openProject(store);
    await select(store, 'p-a');
    await press(screen.getByRole('button', { name: 'Bead actions' }));
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    await keyIn(items[0]!, 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    await keyIn(items[1]!, 'ArrowUp');
    await keyIn(items[0]!, 'ArrowUp');
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('a refused resolve puts focus back on its button', async () => {
    const answer = deferred<Answer>();
    const { store } = gated(() => live({ beads: [bead('p-a')], gates: [gate('p-g1')], gateIds: ['p-g1'], readyIds: [] }), { gateResolve: () => answer.promise });
    await openProject(store);
    await select(store, 'p-a');
    const resolve = within(gateItems()[0]!).getByRole('button', { name: 'Resolve' }) as HTMLButtonElement;
    // In a browser, focus falls to the page when the pressed button turns disabled. jsdom keeps it on a disabled button (and
    // will not blur one), so the press starts from the page instead, which is where a browser leaves it.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    await press(resolve);
    expect(resolve.disabled).toBe(true);
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      answer.resolve(envelope(503, { code: 'busy', message: 'Beads is busy. Nothing was saved. Try again in a moment.' }));
      await flush();
    });
    expect(screen.getByRole('alert').textContent).toContain('Beads is busy');
    expect(document.activeElement).toBe(within(gateItems()[0]!).getByRole('button', { name: 'Resolve' }));
  });

  it('the plan action beside Design is named by the words it shows', async () => {
    const { store } = gated(() => live({ beads: [bead('p-a', { design: 'The plan' })] }));
    await openProject(store);
    await select(store, 'p-a');
    const ask = within(document.querySelector<HTMLElement>('[data-section="design"]')!).getByRole('button', { name: /plan approval/ });
    // Label in name: what voice control users say (the visible text) is in the accessible name.
    const name = ask.getAttribute('aria-label') ?? ask.textContent ?? '';
    expect(name.toLowerCase()).toContain(ask.textContent!.trim().toLowerCase());
    expect(ask.textContent).toBe('Ask for plan approval');
  });
});

// ------------------------------------------------------------------------------------------------- history

const hentry = (id: string, over: Partial<HistoryEntry> = {}): HistoryEntry => ({ id, at: iso(2 * HOUR), actor: 'Claude Code', changes: [], restorable: [], ...over });
const hchange = (field: string, from: HistoryChange['from'], to: HistoryChange['to'], over: Partial<HistoryChange> = {}): HistoryChange => ({ field, from, to, text: false, ...over });
const page = (entries: HistoryEntry[], more = false, labelsKnown = true): HistoryResult => ({ entries, more, labelsKnown });

const historySection = () => document.querySelector<HTMLElement>('[data-section="history"]');
const historyToggle = () => within(historySection()!).getByRole('button', { name: /^History/ });
/** Opens (or folds) History. The read starts once the section has drawn open, so its answer lands one turn later. */
const openHistory = async () => {
  await press(historyToggle());
  await act(async () => {
    await flush();
  });
};
const historyCalls = (calls: Call[]) => calls.filter((c) => c.route === 'history');
const updates = (calls: Call[]) => calls.filter((c) => c.route === 'update');
const changeRow = (field: string, n = 0) => Array.from(historySection()!.querySelectorAll<HTMLElement>(`.bd-hc[data-field="${field}"]`))[n]!;

describe('history on the detail', () => {
  const shown = bead('p-a', { priority: 1, updatedAt: iso(HOUR) });
  const priority = hentry('h1', { changes: [hchange('priority', 3, 1)], restorable: ['priority'] });

  it('history is not requested until opened', async () => {
    const { store, calls } = gated(() => live({ beads: [shown] }), { history: () => json(page([priority])) });
    await openProject(store);
    await select(store, 'p-a');
    expect(historySection()).not.toBeNull();
    expect(historyToggle().getAttribute('aria-expanded')).toBe('false');
    await poll(store);
    expect(historyCalls(calls)).toHaveLength(0);
    await openHistory();
    expect(historyCalls(calls)).toHaveLength(1);
    expect(historyCalls(calls)[0]!.body).toEqual({ directory: '/p/a', id: 'p-a' });
    // Folding and opening again, or the list refreshing, reads nothing more: it is never polled.
    await openHistory();
    await openHistory();
    await poll(store);
    expect(historyCalls(calls)).toHaveLength(1);
  });

  it('opening a related bead while History is open reads nothing for it', async () => {
    const other = bead('p-b');
    const beads = [{ ...shown, dependencies: [dep('p-a', 'p-b', 'related')] }, other];
    const { store, calls } = gated(() => live({ beads }), { history: () => json(page([priority])) });
    await openProject(store);
    await select(store, 'p-a');
    await openHistory();
    expect(historyCalls(calls).map((c) => c.body.id)).toEqual(['p-a']);
    await act(async () => {
      store.openRelated('p-b');
      await flush();
    });
    await act(async () => {
      await flush();
    });
    expect(store.get().detail?.stack.at(-1)?.id).toBe('p-b');
    expect(historyToggle().getAttribute('aria-expanded')).toBe('false');
    expect(historyCalls(calls).map((c) => c.body.id)).toEqual(['p-a']);
    // Opening it there reads that bead's history, once.
    await openHistory();
    expect(historyCalls(calls).map((c) => c.body.id)).toEqual(['p-a', 'p-b']);
  });

  it('entries show actor, or the explanation when unknown', async () => {
    const entries = [
      priority,
      hentry('h2', { actor: null, changes: [hchange('title', 'Old title', 'Title p-a')], restorable: ['title'] }),
      // A close: Beads cannot tie it to a person here, so nobody is named and nobody is blamed.
      hentry('h3', { actor: null, changes: [hchange('status', 'in_progress', 'closed')], restorable: ['status'] }),
      hentry('h4', { at: iso(3 * DAY), actor: 'Bob Builder', created: true }),
    ];
    const { store } = gated(() => live({ beads: [shown] }), { history: () => json(page(entries)) });
    await openProject(store);
    await select(store, 'p-a');
    await openHistory();
    const items = Array.from(historySection()!.querySelectorAll<HTMLElement>('.bd-he'));
    expect(items.map((li) => li.querySelector('.bd-he-who')?.textContent ?? null)).toEqual(['Claude Code', 'someone else or another computer', null, 'Bob Builder']);
    expect(items[1]!.querySelector('.bd-he-who')!.getAttribute('title')).toMatch(/only on the computer where it was made/);
    expect(items[0]!.textContent).toContain('Priority');
    expect(items[0]!.textContent).toMatch(/P3.*P1/);
    expect(items[3]!.textContent).toContain('Created');
    // Grouped by day, under plain day names.
    expect(Array.from(historySection()!.querySelectorAll('.bd-hday-h')).map((h) => h.textContent)).toEqual(['Today', 'Oct 11']);
  });

  it('restore sends expected = the produced value', async () => {
    const { store, calls } = gated(() => live({ beads: [shown] }), {
      history: () => json(page([priority])),
      update: () => json({ ok: true, bead: { ...shown, priority: 3, updatedAt: iso(0) } } satisfies WriteResult),
    });
    await openProject(store);
    await select(store, 'p-a');
    await openHistory();
    const restore = within(changeRow('priority')).getByRole('button', { name: 'Restore previous priority' });
    await press(restore);
    expect(updates(calls)).toHaveLength(1);
    expect(updates(calls)[0]!.body).toEqual({ directory: '/p/a', id: 'p-a', expectedUpdatedAt: shown.updatedAt, patch: { priority: 3 }, expected: { priority: 1 } });
    expect(within(changeRow('priority')).getByRole('status').textContent).toBe('Restored the earlier priority.');
    // The history is not read again on its own; the person is told it is behind and can refresh.
    expect(historySection()!.textContent).toContain('This bead changed since its history was read.');
  });

  it('refused restore shows the current value and writes nothing', async () => {
    const current = { ...shown, priority: 0, updatedAt: iso(MIN) };
    const { store, calls } = gated(() => live({ beads: [shown] }), {
      history: () => json(page([priority])),
      update: () => json({ ok: false, conflict: true, current } satisfies WriteResult),
    });
    await openProject(store);
    await select(store, 'p-a');
    await openHistory();
    await press(within(changeRow('priority')).getByRole('button', { name: 'Restore previous priority' }));
    const row = changeRow('priority');
    const alert = within(row).getByRole('alert');
    expect(alert.textContent).toContain('The priority was changed again since.');
    expect(alert.textContent).toContain('Now: P0.');
    expect(alert.textContent).toContain('Nothing was changed.');
    // The person decides: both choices are there, and nothing more is sent, now or later.
    expect(within(row).getByRole('button', { name: 'Restore anyway' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Keep current' })).toBeTruthy();
    await poll(store);
    await poll(store);
    expect(updates(calls)).toHaveLength(1);
    // Keep current leaves it as it is, still writing nothing.
    await press(within(changeRow('priority')).getByRole('button', { name: 'Keep current' }));
    expect(updates(calls)).toHaveLength(1);
  });

  it('a second restore after a refusal uses the new current value as expected', async () => {
    const current = { ...shown, priority: 0, updatedAt: iso(MIN) };
    let answers = 0;
    const { store, calls } = gated(() => live({ beads: [shown] }), {
      history: () => json(page([priority])),
      update: () => (answers++ === 0 ? json({ ok: false, conflict: true, current } satisfies WriteResult) : json({ ok: true, bead: { ...current, priority: 3, updatedAt: iso(0) } } satisfies WriteResult)),
    });
    await openProject(store);
    await select(store, 'p-a');
    await openHistory();
    await press(within(changeRow('priority')).getByRole('button', { name: 'Restore previous priority' }));
    await press(within(changeRow('priority')).getByRole('button', { name: 'Restore anyway' }));
    expect(updates(calls)).toHaveLength(2);
    expect(updates(calls)[1]!.body).toEqual({ directory: '/p/a', id: 'p-a', expectedUpdatedAt: current.updatedAt, patch: { priority: 3 }, expected: { priority: 0 } });
    expect(within(changeRow('priority')).getByRole('status').textContent).toBe('Restored the earlier priority.');
  });

  it('a change the bead has already moved past asks first, with the current value, before anything is sent', async () => {
    const { store, calls } = gated(() => live({ beads: [{ ...shown, priority: 0 }] }), { history: () => json(page([priority])) });
    await openProject(store);
    await select(store, 'p-a');
    await openHistory();
    const restore = within(changeRow('priority')).getByRole('button', { name: 'Restore previous priority' });
    restore.focus();
    await press(restore);
    expect(updates(calls)).toHaveLength(0);
    expect(within(changeRow('priority')).getByRole('alert').textContent).toContain('Now: P0.');
    // Focus moves to the refusal's message, never to the button that overwrites.
    const focused = document.activeElement as HTMLElement;
    expect(focused.hasAttribute('data-refused')).toBe(true);
    expect(focused.tagName).not.toBe('BUTTON');
    // A double Enter on the focused element presses nothing: the newer value is kept.
    for (let i = 0; i < 2; i++) {
      fireEvent.keyDown(focused, { key: 'Enter' });
      if (focused.tagName === 'BUTTON') fireEvent.click(focused);
    }
    await act(async () => void (await flush()));
    expect(updates(calls)).toHaveLength(0);
  });

  it('a refused text restore shows what would be replaced', async () => {
    const produced = ['## Plan', '', '1. Dual-write.', '2. Switch reads.'].join('\n');
    const earlier = ['## Plan', '', '1. Dual-write.'].join('\n');
    // Someone rewrote the plan since: the long line far below the first would be lost by "Restore anyway".
    const now = ['## Plan', '', '1. Dual-write.', '2. Switch reads.', '3. Keep both stores for a week, then drop the old one after the audit signs off on the migration.'].join('\n');
    const shownBead = bead('p-a', { design: produced, updatedAt: iso(HOUR) });
    const current = { ...shownBead, design: now, updatedAt: iso(MIN) };
    const change = hentry('h1', { changes: [hchange('design', earlier, produced, { text: true })], restorable: ['design'] });
    const { store, calls } = gated(() => live({ beads: [shownBead] }), {
      history: () => json(page([change])),
      update: () => json({ ok: false, conflict: true, current } satisfies WriteResult),
    });
    await openProject(store);
    await select(store, 'p-a');
    await openHistory();
    await press(within(changeRow('design')).getByRole('button', { name: 'Restore previous design' }));
    const card = changeRow('design').querySelector<HTMLElement>('.bd-rs[data-refused]')!;
    expect(within(card).getByRole('alert').textContent).toContain('The design was changed again since.');
    expect(card.textContent).toContain('Restoring would change it like this:');
    // Every line that would go is shown whole, not a first-line excerpt.
    const removed = Array.from(card.querySelectorAll('.bd-diff-line[data-kind="del"] .bd-diff-t')).map((l) => l.textContent);
    expect(removed).toEqual(['2. Switch reads.', '3. Keep both stores for a week, then drop the old one after the audit signs off on the migration.']);
    expect(card.querySelectorAll('.bd-diff-line[data-kind="add"]')).toHaveLength(0);
    expect(updates(calls)).toHaveLength(1);
    await press(within(card).getByRole('button', { name: 'Restore anyway' }));
    expect(updates(calls)[1]!.body).toMatchObject({ patch: { design: earlier }, expected: { design: now }, expectedUpdatedAt: current.updatedAt });
  });

  it('restoring a done status goes through the close rules: a bead held by a review says so, in the review words', async () => {
    const reopened = hentry('h1', { changes: [hchange('status', 'closed', 'open')], restorable: ['status'] });
    const blocked = envelope(409, { code: 'blocked', message: "This bead can't be closed yet. It is still blocked by p-g1. Close those first." });
    const { store, calls } = gated(() => live({ beads: [shown], gates: [gate('p-g1')], gateIds: ['p-g1'], readyIds: [] }), { history: () => json(page([reopened])), update: () => blocked });
    await openProject(store);
    await select(store, 'p-a');
    await openHistory();
    await press(within(changeRow('status')).getByRole('button', { name: 'Restore previous status' }));
    expect(updates(calls)[0]!.body).toMatchObject({ patch: { status: 'closed' }, expected: { status: 'open' } });
    const alert = within(changeRow('status')).getByRole('alert');
    expect(alert.textContent).toBe("This bead can't be closed yet. It is waiting on a review. Resolve the review first.");
    // Still offered: the person can try again once the review is resolved.
    expect(within(changeRow('status')).getByRole('button', { name: 'Restore previous status' })).toBeTruthy();
  });

  it('long text field shows a collapsed diff', async () => {
    const before = ['# Plan', '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'].join('\n');
    const after = ['# Plan', '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven (changed)'].join('\n');
    const entries = [
      hentry('h1', { changes: [hchange('design', before, after, { text: true })], restorable: ['design'] }),
      hentry('h2', { changes: [hchange('description', 'Start of a long…', 'Start of a longer…', { text: true, truncated: true })], restorable: [] }),
    ];
    const { store } = gated(() => live({ beads: [bead('p-a', { design: after })] }), { history: () => json(page(entries)) });
    await openProject(store);
    await select(store, 'p-a');
    await openHistory();
    const design = changeRow('design');
    // Unchanged lines fold into a count, with one line of context kept beside the change.
    expect(design.querySelector('.bd-diff-skip')?.textContent).toBe('7 unchanged lines');
    expect(Array.from(design.querySelectorAll('.bd-diff-line')).map((l) => [l.getAttribute('data-kind'), l.querySelector('.bd-diff-t')!.textContent])).toEqual([
      ['same', 'Six'],
      ['del', 'Seven'],
      ['add', 'Seven (changed)'],
    ]);
    expect(within(design).getByRole('button', { name: 'Restore previous design' })).toBeTruthy();
    // A text cut for transport is shown, flagged, and never offered for restore.
    const cut = changeRow('description');
    expect(within(cut).queryByRole('button', { name: /Restore/ })).toBeNull();
    expect(cut.textContent).toContain('Too long to restore here');
    expect(cut.textContent).toContain('Only the start of this text is shown.');
  });

  it('gate rows read "Review resolved by <actor>" only when the actor is not the panel, and never say "gate"', async () => {
    const gateEntry = (id: string, what: HistoryEntry['gate'] extends infer G ? (G extends { what: infer W } ? W : never) : never, over: Partial<HistoryEntry> = {}, gateKind = 'human', byPanel = false) =>
      hentry(id, { gate: { gateId: 'p-g1', what, gateKind, reason: REVIEW_REASON, byPanel }, ...over });
    const entries = [
      gateEntry('g1', 'resolved', { actor: 'Claude Code' }),
      gateEntry('g2', 'resolved', { actor: 'Alice Tester (panel)' }, 'human', true),
      gateEntry('g3', 'resolved', { actor: null }),
      gateEntry('g4', 'deleted', { actor: null }),
      gateEntry('g5', 'unlinked', { actor: null }),
      gateEntry('g6', 'resolved', { actor: null }, 'timer'),
      gateEntry('g7', 'requested', { actor: 'Claude Code' }),
    ];
    const { store } = gated(() => live({ beads: [shown], panelActor: 'Alice Tester (panel)' }), { history: () => json(page(entries)) });
    await openProject(store);
    await select(store, 'p-a');
    await openHistory();
    const items = Array.from(historySection()!.querySelectorAll<HTMLElement>('.bd-he'));
    expect(items.map((li) => li.querySelector('.bd-he-gate')!.textContent)).toEqual([
      'Review resolved by Claude Code',
      'Review resolved',
      'Review resolved by someone else',
      'Review deleted',
      'Review removed from this bead',
      'Timer ended',
      'Review requested',
    ]);
    expect(items.map((li) => li.querySelector('.bd-he-who')?.textContent ?? null)).toEqual([null, 'you (panel)', null, null, null, null, 'Claude Code']);
    expect(items[0]!.textContent).toContain(REVIEW_REASON);
    expect(historySection()!.textContent).not.toMatch(/\bgates?\b/i);
    expect(historySection()!.querySelectorAll('button[aria-label^="Restore"]')).toHaveLength(0);
  });

  it('load older pages without duplicating', async () => {
    const first = [priority, hentry('h2', { changes: [hchange('assignee', null, 'Bob')], restorable: ['assignee'] })];
    // The next page starts with an entry already shown (a newer version moved the cursor).
    const second = [first[1]!, hentry('h3', { changes: [hchange('title', 'First title', 'Old title')], restorable: ['title'] })];
    const { store, calls } = gated(() => live({ beads: [shown] }), {
      history: (call) => json(call.body.before ? page(second, false) : page(first, true)),
    });
    await openProject(store);
    await select(store, 'p-a');
    await openHistory();
    await press(within(historySection()!).getByRole('button', { name: 'Load older' }));
    expect(historyCalls(calls).map((c) => c.body.before ?? null)).toEqual([null, 'h2']);
    expect(Array.from(historySection()!.querySelectorAll('.bd-hc')).map((c) => c.getAttribute('data-field'))).toEqual(['priority', 'assignee', 'title']);
    expect(within(historySection()!).queryByRole('button', { name: 'Load older' })).toBeNull();
  });

  it('says when label changes could not be read', async () => {
    const { store } = gated(() => live({ beads: [shown] }), { history: () => json(page([priority], false, false)) });
    await openProject(store);
    await select(store, 'p-a');
    await openHistory();
    expect(historySection()!.textContent).toContain('Label changes are not listed');
  });

  it('says why a read failed with a way to try again, and goes away when the installed Beads cannot read history', async () => {
    let answer: Answer = envelope(503, { code: 'busy', message: 'Beads is busy. Try again in a moment.' });
    const { store, calls } = gated(() => live({ beads: [shown] }), { history: () => answer });
    await openProject(store);
    await select(store, 'p-a');
    await openHistory();
    expect(within(historySection()!).getByRole('alert').textContent).toContain('Beads is busy');
    answer = envelope(400, { code: 'unsupported', message: 'Needs a newer Beads.' });
    await press(within(historySection()!).getByRole('button', { name: 'Try again' }));
    await act(async () => {
      await flush();
    });
    expect(historyCalls(calls)).toHaveLength(2);
    expect(historySection()).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------- task 16

describe('acceptance checklist', () => {
  const TEXT = 'Intro **bold**\n\n- [ ] First  \n- [x] Second\n- plain\n1. [ ] Numbered\n\n```\n- [ ] in code\n```\n';
  const acceptance = () => document.querySelector<HTMLElement>('[data-section="acceptance"]')!;
  const box = (name: string) => within(acceptance()).getByRole('checkbox', { name });

  it('a tick rewrites only that line', async () => {
    let beads = [bead('p-a', { acceptance: TEXT })];
    const { store, calls } = gated(() => live({ beads }), {
      update: (call) => {
        const next = bead('p-a', { acceptance: (call.body.patch as { acceptance: string }).acceptance, updatedAt: iso(0) });
        beads = [next];
        return json({ ok: true, bead: next } satisfies WriteResult);
      },
    });
    await openProject(store);
    await select(store, 'p-a');
    // Only lines written with a box can be ticked: not the bullet, not the line in code. The text around them still reads.
    expect(within(acceptance()).getAllByRole('checkbox')).toHaveLength(3);
    for (const name of ['First', 'Second', 'Numbered']) expect(box(name)).toBeTruthy();
    expect(within(acceptance()).getByText('bold').tagName).toBe('STRONG');
    expect(within(acceptance()).getByText('plain')).toBeTruthy();
    expect(box('Second').getAttribute('aria-checked')).toBe('true');
    expect(box('First').getAttribute('aria-checked')).toBe('false');
    await press(box('First'));
    const sent = calls.filter((c) => c.route === 'update');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({ directory: '/p/a', id: 'p-a', expectedUpdatedAt: iso(DAY), patch: { acceptance: TEXT.replace('- [ ] First  ', '- [x] First  ') }, expected: { acceptance: TEXT } });
    expect(box('First').getAttribute('aria-checked')).toBe('true');
    // And back: only that line again, from the text now shown.
    await press(box('Second'));
    expect(calls.filter((c) => c.route === 'update')[1]!.body).toMatchObject({ patch: { acceptance: TEXT.replace('- [ ] First  ', '- [x] First  ').replace('- [x] Second', '- [ ] Second') } });
  });

  it('ticking when the text changed is a conflict', async () => {
    const theirs = bead('p-a', { acceptance: '- [ ] First\n- [ ] Added by an agent', updatedAt: iso(MIN) });
    const { store, calls } = gated(() => live({ beads: [bead('p-a', { acceptance: '- [ ] First' })] }), {
      update: () => json({ ok: false, conflict: true, current: theirs } satisfies WriteResult),
    });
    await openProject(store);
    await select(store, 'p-a');
    await press(box('First'));
    expect(calls.filter((c) => c.route === 'update')).toHaveLength(1);
    const note = within(acceptance()).getByRole('status');
    expect(note.textContent).toContain('changed before your tick was saved');
    expect(note.textContent).toContain('Nothing was saved');
    // The criteria show as they are now; the tick did not go in.
    expect(box('Added by an agent')).toBeTruthy();
    expect(box('First').getAttribute('aria-checked')).toBe('false');
  });

  it('a tick that meets a change elsewhere on the bead asks to tick again, quietly', async () => {
    const theirs = bead('p-a', { acceptance: '- [ ] First', priority: 0, updatedAt: iso(MIN) });
    const { store, calls } = gated(() => live({ beads: [bead('p-a', { acceptance: '- [ ] First' })] }), {
      update: () => json({ ok: false, conflict: true, current: theirs } satisfies WriteResult),
    });
    await openProject(store);
    await select(store, 'p-a');
    await press(box('First'));
    expect(calls.filter((c) => c.route === 'update')).toHaveLength(1);
    const note = within(acceptance()).getByRole('status');
    expect(note.textContent).toBe('Something else on this bead changed first. Nothing was saved. Tick it again to save it.');
    expect(note.getAttribute('data-tone')).toBe('note');
    expect(box('First').getAttribute('aria-checked')).toBe('false');
  });

  it('no acceptance criteria shows a hint on the detail only', async () => {
    const { store } = gated(() => live({ beads: [bead('p-a'), bead('p-b', { acceptance: '- [ ] Done right' })] }));
    await openProject(store);
    expect(screen.queryByText('No acceptance criteria')).toBeNull();
    await select(store, 'p-a');
    const hint = screen.getByText('No acceptance criteria');
    expect(hint.closest('.bd-noac')?.querySelector('button')?.getAttribute('aria-label')).toBe('Add acceptance criteria');
    // The hint carries the add action, so the Add row does not repeat it.
    expect(document.querySelector('.bd-addrow')?.textContent ?? '').not.toContain('Acceptance');
    await select(store, 'p-b');
    expect(screen.queryByText('No acceptance criteria')).toBeNull();
  });
});

describe('supersede and duplicate', () => {
  const two = () => [bead('p-a', { title: 'Old idea' }), bead('p-b', { title: 'Better idea' })];
  const choose = async (item: string, query: string, option: RegExp) => {
    await press(screen.getByRole('button', { name: 'Bead actions' }));
    await press(screen.getByRole('menuitem', { name: item }));
    await typeIn(screen.getByRole('combobox') as HTMLInputElement, query);
    await press(screen.getByRole('option', { name: option }));
  };

  it('supersede confirmation says it closes the bead', async () => {
    const { store, calls } = gated(() => live({ beads: two() }), {
      supersede: () => json({ ok: true, bead: bead('p-a', { title: 'Old idea', status: 'closed', updatedAt: iso(0) }) } satisfies WriteResult),
    });
    await openProject(store);
    await select(store, 'p-a');
    await choose('Superseded by…', 'better', /Better idea/);
    expect(screen.getByText(/This closes p-a\./)).toBeTruthy();
    expect(calls.some((c) => c.route === 'supersede')).toBe(false);
    await press(screen.getByRole('button', { name: 'Close as superseded' }));
    expect(calls.filter((c) => c.route === 'supersede').map((c) => c.body)).toEqual([{ directory: '/p/a', id: 'p-a', with: 'p-b', expectedUpdatedAt: iso(DAY) }]);
    expect(screen.queryByRole('button', { name: 'Close as superseded' })).toBeNull();
  });

  it('duplicate sends of', async () => {
    const { store, calls } = gated(() => live({ beads: two() }), {
      duplicate: () => json({ ok: true, bead: bead('p-a', { status: 'closed', updatedAt: iso(0) }) } satisfies WriteResult),
    });
    await openProject(store);
    await select(store, 'p-a');
    await choose('Duplicate of…', 'p-b', /Better idea/);
    expect(screen.getByText(/This closes p-a\./)).toBeTruthy();
    await press(screen.getByRole('button', { name: 'Close as duplicate' }));
    expect(calls.filter((c) => c.route === 'duplicate').map((c) => c.body)).toEqual([{ directory: '/p/a', id: 'p-a', of: 'p-b', expectedUpdatedAt: iso(DAY) }]);
  });

  it('Escape clears the search first, then leaves the step with focus back on the bead menu', async () => {
    const { store, calls } = gated(() => live({ beads: two() }));
    await openProject(store);
    await select(store, 'p-a');
    await press(screen.getByRole('button', { name: 'Bead actions' }));
    await press(screen.getByRole('menuitem', { name: 'Duplicate of…' }));
    const field = screen.getByRole('combobox', { name: 'Which bead does this one repeat?' }) as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    await typeIn(field, 'better');
    await keyIn(field, 'Escape');
    expect(field.value).toBe('');
    // Still on this bead: the step's Escape is not Back.
    expect(screen.getByRole('heading', { name: 'Old idea' })).toBeTruthy();
    await keyIn(field, 'Escape');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Bead actions' }));
    expect(calls.some((c) => c.route === 'duplicate')).toBe(false);
  });

  it('a refused supersede names the review, never the gate, and keeps the choice', async () => {
    const { store } = gated(() => live({ beads: two(), gates: [gate('p-g1')], gateIds: ['p-g1'], readyIds: ['p-b'] }), {
      supersede: () => envelope(409, { code: 'blocked', message: "This bead can't be closed yet. It is still waiting on p-g1." }),
    });
    await openProject(store);
    await select(store, 'p-a');
    await choose('Superseded by…', 'better', /Better idea/);
    await press(screen.getByRole('button', { name: 'Close as superseded' }));
    expect(screen.getByText("This bead can't be closed yet. It is waiting on a review. Resolve the review first.")).toBeTruthy();
    expect(screen.queryByText(/p-g1/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Close as superseded' })).toBeTruthy();
  });
});
