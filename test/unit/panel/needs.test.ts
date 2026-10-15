import { describe, expect, it } from 'vitest';
import { eligibleEpics, KEEP_MS, needsSections, whyLine, type NeedsInput } from '../../../src/panel/needs';
import type { Bead, ChangeEvent, ExplainResult, Gate, StatusDef } from '../../../src/shared/types';
import { snapshot } from './helpers';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const DAY = 86_400_000;
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

const bead = (id: string, over: Partial<Bead> = {}): Bead => ({
  id, title: `Title ${id}`, status: 'open', priority: 2, type: 'task', assignee: null, labels: [], parentId: null, description: '', design: '', acceptance: '', notes: '',
  createdAt: ago(30 * DAY), createdBy: null, updatedAt: ago(DAY), closedAt: null, closeReason: null, dependencies: [], comments: [], extra: {}, ...over,
});
const gate = (id: string, blocks: string[], over: Partial<Gate> = {}): Gate => ({ id, kind: 'human', reason: 'Please review', blocks, createdBy: null, createdAt: ago(DAY), timeoutMs: null, planApproval: false, ...over });
const STATUSES: StatusDef[] = [];

const input = (over: Partial<Parameters<typeof snapshot>[0]> = {}, extra: Partial<NeedsInput> = {}): NeedsInput => ({ snapshot: snapshot({ statuses: STATUSES, ...over }), staleDays: 3, keep: {}, ...extra });

describe('needs: waiting', () => {
  it('a bead with an open human gate waits, with the gate reason', () => {
    const s = needsSections(input({ beads: [bead('x-1')], gates: [gate('g-1', ['x-1'], { reason: 'Approve the plan' })] }), NOW);
    expect(s.waiting).toHaveLength(1);
    expect(s.waiting[0]).toMatchObject({ reason: 'Approve the plan' });
    expect(s.waiting[0]!.gates.map((g) => g.id)).toEqual(['g-1']);
  });

  it('a resolved gate is not waiting: only open gates are in the snapshot, so a bead with none is not listed', () => {
    const s = needsSections(input({ beads: [bead('x-1', { dependencies: [{ from: 'x-1', to: 'g-1', kind: 'blocks', createdBy: null, createdAt: null }] })], gates: [], gateIds: ['g-1'] }), NOW);
    expect(s.waiting).toEqual([]);
  });

  it('a timer gate is not for a person, and a closed bead does not wait', () => {
    const s = needsSections(input({ beads: [bead('x-1'), bead('x-2', { status: 'closed' })], gates: [gate('g-1', ['x-1'], { kind: 'timer' }), gate('g-2', ['x-2'])] }), NOW);
    expect(s.waiting).toEqual([]);
  });

  it('two gates on one bead are one row', () => {
    const s = needsSections(input({ beads: [bead('x-1')], gates: [gate('g-1', ['x-1'], { reason: null }), gate('g-2', ['x-1'])] }), NOW);
    expect(s.waiting).toHaveLength(1);
    expect(s.waiting[0]!.reason).toBe('Please review');
  });
});

describe('needs: asked', () => {
  it('a closed human bead is not asked', () => {
    const s = needsSections(input({ beads: [bead('x-1', { labels: ['human'], status: 'closed' }), bead('x-2', { labels: ['human'], description: 'Which colour?' })] }), NOW);
    expect(s.asked.map((r) => [r.bead.id, r.text])).toEqual([['x-2', 'Which colour?']]);
  });

  it('the text is the description, else the title', () => {
    const s = needsSections(input({ beads: [bead('x-1', { labels: ['human'] })] }), NOW);
    expect(s.asked[0]!.text).toBe('Title x-1');
  });

  it('a request that also waits on a review is one row, in Waiting', () => {
    const s = needsSections(input({ beads: [bead('x-1', { labels: ['human'] })], gates: [gate('g-1', ['x-1'])] }), NOW);
    expect(s.waiting.map((r) => r.bead.id)).toEqual(['x-1']);
    expect(s.asked).toEqual([]);
    expect(s.count).toBe(1);
  });

  it('a request that cannot be closed yet carries what stops it', () => {
    const open = bead('x-1', { labels: ['human'] });
    const child = bead('x-1.1', { parentId: 'x-1' });
    const s = needsSections(input({ beads: [open, child] }), NOW);
    expect(s.asked[0]!.blockers).toEqual(['x-1.1']);
    expect(needsSections(input({ beads: [open] }), NOW).asked[0]!.blockers).toEqual([]);
  });
});

describe('needs: asked rows and gates', () => {
  const edge = (from: string, to: string, kind: string) => ({ from, to, kind, createdBy: null, createdAt: ago(DAY) });
  const timer = (id: string, blocks: string[]) => gate(id, blocks, { kind: 'timer', reason: null, timeoutMs: 7_200_000 });

  it('a help request held by an open timer gate is blocked by it', () => {
    const ask = bead('x-1', { labels: ['human'], dependencies: [edge('x-1', 'g-1', 'blocks')] });
    const s = needsSections(input({ beads: [ask], gates: [timer('g-1', ['x-1'])] }), NOW);
    expect(s.asked.map((r) => r.bead.id)).toEqual(['x-1']);
    expect(s.asked[0]!.blockers).toEqual(['g-1']);
  });

  it('a gate that is no longer open does not block the request', () => {
    const ask = bead('x-1', { labels: ['human'], dependencies: [edge('x-1', 'g-1', 'blocks')] });
    expect(needsSections(input({ beads: [ask], gates: [] }), NOW).asked[0]!.blockers).toEqual([]);
  });

  it('a request blocked through an open gate on its parent is blocked (bd names its live waits-for target)', () => {
    const parent = bead('x-1', { dependencies: [edge('x-1', 'g-1', 'blocks')] });
    const ask = bead('x-1.1', { labels: ['human'], parentId: 'x-1', dependencies: [edge('x-1.1', 'x-2', 'waits-for')] });
    const target = bead('x-2');
    const open = needsSections(input({ beads: [parent, ask, target], gates: [timer('g-1', ['x-1'])] }), NOW);
    expect(open.asked.find((r) => r.bead.id === 'x-1.1')?.blockers).toEqual(['x-2']);
    const closed = needsSections(input({ beads: [parent, ask, target], gates: [] }), NOW);
    expect(closed.asked.find((r) => r.bead.id === 'x-1.1')?.blockers).toEqual([]);
  });
});

describe('needs: stuck', () => {
  it('stuck uses staleDays and excludes kept beads, keep expires after 7 days', () => {
    const beads = [bead('x-1', { status: 'in_progress', updatedAt: ago(4 * DAY) }), bead('x-2', { status: 'in_progress', updatedAt: ago(2 * DAY) }), bead('x-3', { status: 'open', updatedAt: ago(9 * DAY) })];
    expect(needsSections(input({ beads }), NOW).stuck.map((r) => r.bead.id)).toEqual(['x-1']);
    expect(needsSections(input({ beads }, { staleDays: 1 }), NOW).stuck.map((r) => r.bead.id)).toEqual(['x-1', 'x-2']);
    expect(needsSections(input({ beads }, { staleDays: 1 }), NOW).stuck[0]).toMatchObject({ kind: 'quiet', why: 'No update in 4 days' });
    const only = [beads[0]!];
    const kept = { 'x-1': NOW + KEEP_MS };
    expect(needsSections(input({ beads: only }, { keep: kept }), NOW).stuck).toEqual([]);
    expect(needsSections(input({ beads: only }, { keep: kept }), NOW + KEEP_MS - 1).stuck).toEqual([]);
    expect(needsSections(input({ beads: only }, { keep: kept }), NOW + KEEP_MS).stuck.map((r) => r.bead.id)).toEqual(['x-1']);
  });

  it('the oldest quiet bead comes first', () => {
    const beads = [bead('x-1', { status: 'in_progress', updatedAt: ago(4 * DAY) }), bead('x-2', { status: 'in_progress', updatedAt: ago(8 * DAY) })];
    expect(needsSections(input({ beads }), NOW).stuck.map((r) => r.bead.id)).toEqual(['x-2', 'x-1']);
  });

  it('lease expired adds a lease reason on a bead that is not otherwise stuck', () => {
    const beads = [bead('x-1', { status: 'in_progress', updatedAt: ago(60_000) })];
    const leases = [{ beadId: 'x-1', holder: 'Claude Code', expiresAt: ago(2 * 3_600_000) }];
    const row = needsSections(input({ beads, leases }), NOW).stuck[0]!;
    expect(row).toMatchObject({ kind: 'lease', why: "Claude Code's claim ran out 2 hours ago" });
  });

  it('a lease still running, or on a closed bead, is nothing; on a quiet bead it adds to the reason', () => {
    const leases = [{ beadId: 'x-1', holder: 'A', expiresAt: new Date(NOW + 60_000).toISOString() }, { beadId: 'x-2', holder: 'B', expiresAt: ago(DAY) }];
    expect(needsSections(input({ beads: [bead('x-1', { status: 'in_progress' }), bead('x-2', { status: 'closed' })], leases }), NOW).stuck).toEqual([]);
    const both = needsSections(input({ beads: [bead('x-3', { status: 'in_progress', updatedAt: ago(5 * DAY) })], leases: [{ beadId: 'x-3', holder: 'A', expiresAt: ago(DAY) }] }), NOW).stuck[0]!;
    expect(both.kind).toBe('quiet');
    expect(both.why).toBe("No update in 5 days. A's claim ran out 1 day ago");
  });

  it('an expired claim on a bead that is not in progress (open, blocked, deferred) is not Stuck', () => {
    const beads = ['open', 'blocked', 'deferred'].map((status, i) => bead(`x-${i}`, { status, updatedAt: ago(60_000) }));
    const leases = beads.map((b) => ({ beadId: b.id, holder: 'Claude Code', expiresAt: ago(3 * DAY) }));
    expect(needsSections(input({ beads, leases }), NOW).stuck).toEqual([]);
  });

  it('a kept bead hides its lease row too', () => {
    const beads = [bead('x-1', { status: 'in_progress' })];
    const leases = [{ beadId: 'x-1', holder: 'A', expiresAt: ago(DAY) }];
    expect(needsSections(input({ beads, leases }, { keep: { 'x-1': NOW + 1 } }), NOW).stuck).toEqual([]);
  });
});

describe('needs: changed', () => {
  const event = (id: string, beadId: string, over: Partial<ChangeEvent> = {}): ChangeEvent & { unseen: boolean } => ({
    id, beadId, kind: 'field', field: 'priority', from: 1, to: 0, actor: 'Claude Code', byPanel: false, observedAt: ago(3_600_000), unseen: true, ...over,
  });

  it('groups the unseen set by bead, newest first, in the words of the detail banner', () => {
    const beads = [bead('x-1'), bead('x-2')];
    const s = needsSections(input({ beads, unseenIds: ['x-1', 'x-2'], activity: [event('e1', 'x-2'), event('e2', 'x-1', { kind: 'comment', field: undefined }), event('e3', 'x-2', { field: 'status', from: 'open', to: 'in_progress' })] }), NOW);
    expect(s.changed.map((r) => r.bead.id)).toEqual(['x-2', 'x-1']);
    expect(s.changed[0]!.summary).toBe('Changed 1h ago by Claude Code: priority P1 → P0');
    expect(s.changed[1]!.summary).toBe('New comment 1h ago by Claude Code');
  });

  it('keeps the event whole, so a gate that ended without a resolve can be worded by the row', () => {
    const e = event('e1', 'x-1', { kind: 'gate_resolved', gateId: 'g-1', gateKind: 'timer', ended: 'deleted', field: undefined });
    const s = needsSections(input({ beads: [bead('x-1')], unseenIds: ['x-1'], activity: [e] }), NOW);
    expect(s.changed[0]!.event).toMatchObject({ ended: 'deleted', gateKind: 'timer' });
  });

  it('a deleted bead has no row, and an unseen bead with no recorded change still has one', () => {
    const s = needsSections(input({ beads: [bead('x-1')], unseenIds: ['x-gone', 'x-1'] }), NOW);
    expect(s.changed).toEqual([expect.objectContaining({ summary: 'Changed since you last looked', event: null })]);
  });
});

describe('needs: count', () => {
  it('is the sum of the rows shown, and zero without a snapshot', () => {
    expect(needsSections({ snapshot: null, staleDays: 3, keep: {} }, NOW).count).toBe(0);
    const beads = [bead('x-1', { status: 'in_progress', updatedAt: ago(9 * DAY), labels: ['human'] }), bead('x-2'), bead('x-3')];
    const s = needsSections(input({ beads, gates: [gate('g-1', ['x-2'])], unseenIds: ['x-3'] }), NOW);
    expect([s.waiting.length, s.asked.length, s.stuck.length, s.changed.length, s.count]).toEqual([1, 1, 1, 1, 4]);
  });
});

describe('eligibleEpics matches the contract rule', () => {
  const epic = (id: string, over: Partial<Bead> = {}) => bead(id, { type: 'epic', ...over });
  it('every child done, at least one child, the epic itself not done', () => {
    const beads = [
      epic('e-1'), bead('e-1.1', { parentId: 'e-1', status: 'closed' }), bead('e-1.2', { parentId: 'e-1', status: 'closed' }),
      epic('e-2'), bead('e-2.1', { parentId: 'e-2', status: 'closed' }), bead('e-2.2', { parentId: 'e-2', status: 'open' }),
      epic('e-3'),
      epic('e-4', { status: 'closed' }), bead('e-4.1', { parentId: 'e-4', status: 'closed' }),
      bead('t-1'), bead('t-1.1', { parentId: 't-1', status: 'closed' }),
    ];
    expect(eligibleEpics(beads, STATUSES).map((b) => b.id)).toEqual(['e-1']);
  });

  it('an epic held by an open gate is left out when the gates are given (Beads itself does not look at them)', () => {
    const beads = [epic('e-1'), bead('e-1.1', { parentId: 'e-1', status: 'closed' }), epic('e-2'), bead('e-2.1', { parentId: 'e-2', status: 'closed' })];
    expect(eligibleEpics(beads, STATUSES).map((b) => b.id)).toEqual(['e-1', 'e-2']);
    expect(eligibleEpics(beads, STATUSES, [gate('g-1', ['e-1'])]).map((b) => b.id)).toEqual(['e-2']);
  });

  it('a custom done status counts as done', () => {
    const statuses: StatusDef[] = [{ name: 'shipped', category: 'done', icon: null }];
    expect(eligibleEpics([epic('e-1'), bead('e-1.1', { parentId: 'e-1', status: 'shipped' })], statuses).map((b) => b.id)).toEqual(['e-1']);
  });
});

describe('whyLine', () => {
  const g = gate('g-1', ['x-1'], { reason: 'Approve the plan\nmore text' });
  const plan = gate('g-2', ['x-1'], { reason: 'Approve the plan before work starts', planApproval: true });
  const timer = gate('g-3', ['x-1'], { kind: 'timer' });

  it('blocked by a bead', () => {
    expect(whyLine(bead('x-1'), { state: 'blocked', blockers: [{ id: 'demo-x2', title: 'Build it', status: 'open' }] }, [], NOW)).toBe('Waiting on x2 Build it');
    expect(whyLine(bead('x-1'), { state: 'blocked', blockers: ['a', 'b', 'c', 'd'].map((id) => ({ id, title: id, status: 'open' })) }, [], NOW)).toBe('Waiting on a a, b b and 2 more');
  });

  it('blocked by a gate (the blocker is an open gate), worded by its kind and never by its id', () => {
    expect(whyLine(bead('x-1'), { state: 'blocked', blockers: [{ id: 'g-1', title: 'Gate', status: 'open' }] }, [g], NOW)).toBe('Waiting on a review');
    expect(whyLine(bead('x-1'), { state: 'blocked', blockers: [{ id: 'g-2', title: 'Gate', status: 'open' }] }, [plan], NOW)).toBe('Waiting on plan approval');
    expect(whyLine(bead('x-1'), { state: 'blocked', blockers: [{ id: 'g-3', title: 'Gate', status: 'open' }, { id: 'demo-x2', title: 'Build it', status: 'open' }] }, [timer], NOW)).toBe('Waiting on a timer and x2 Build it');
  });

  it('gated while bd has not answered yet', () => {
    expect(whyLine(bead('x-1'), null, [g], NOW)).toBe('Waiting on a review');
    expect(whyLine(bead('x-1'), null, [timer], NOW)).toBe('Waiting on a timer');
  });

  it('snoozed until a date, or with none', () => {
    expect(whyLine(bead('x-1', { extra: { defer_until: '2026-10-20T09:00:00Z' } }), { state: 'other', blockers: [] }, [], NOW)).toBe('Snoozed until 2026-10-20');
    expect(whyLine(bead('x-1', { status: 'deferred' }), { state: 'other', blockers: [] }, [], NOW)).toBe('Snoozed with no date');
  });

  describe('the snooze date is the calendar day where the person is', () => {
    const snoozed = (until: string) => bead('x-1', { extra: { defer_until: until } });
    const other: ExplainResult = { state: 'other', blockers: [] };

    it('west of UTC, an evening instant that is already tomorrow in UTC stays that evening\'s day', () => {
      // 20:00 on the 19th in Chicago (CDT) is 01:00Z on the 20th.
      expect(whyLine(snoozed('2026-10-20T01:00:00Z'), other, [], NOW, 'America/Chicago')).toBe('Snoozed until 2026-10-19');
      expect(whyLine(snoozed('2026-10-20T01:00:00Z'), other, [], NOW, 'UTC')).toBe('Snoozed until 2026-10-20');
    });

    it('east of UTC, a date typed as YYYY-MM-DD (local midnight) stays that day', () => {
      // 2026-10-20 at local midnight in Auckland (NZDT, +13) is 11:00Z on the 19th.
      expect(whyLine(snoozed('2026-10-19T11:00:00Z'), other, [], NOW, 'Pacific/Auckland')).toBe('Snoozed until 2026-10-20');
      expect(whyLine(snoozed('2026-10-19T11:00:00Z'), other, [], NOW, 'UTC')).toBe('Snoozed until 2026-10-19');
    });

    it('with no zone given it uses the machine zone, whatever TZ is', () => {
      const was = process.env.TZ;
      process.env.TZ = 'America/Los_Angeles';
      try {
        expect(whyLine(snoozed('2026-10-20T03:00:00Z'), other, [], NOW)).toBe('Snoozed until 2026-10-19');
      } finally {
        process.env.TZ = was;
      }
    });
  });

  it('ready, and nothing to say when not known or not startable for another reason', () => {
    expect(whyLine(bead('x-1'), { state: 'ready', blockers: [] }, [], NOW)).toBe('Ready to start');
    expect(whyLine(bead('x-1', { extra: { defer_until: '2026-10-01T09:00:00Z' } }), { state: 'ready', blockers: [] }, [], NOW)).toBe('Ready to start');
    expect(whyLine(bead('x-1'), { state: 'other', blockers: [] }, [], NOW)).toBeNull();
    expect(whyLine(bead('x-1'), null, [], NOW)).toBeNull();
  });
});
