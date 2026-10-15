import { describe, expect, it } from 'vitest';
import { blockedMessage, blockedText, gateLabel, gatesOn, gateState, gateWord, waitItems, waitsOf, waitsText, whyLine } from '../../../src/panel/gates';
import { blockerText } from '../../../src/panel/ui/NeedsView';
import { PLAN_APPROVAL_REASON, REVIEW_REASON } from '../../../src/shared/gates';
import type { Bead, Gate } from '../../../src/shared/types';

const NOW = new Date('2026-10-14T12:00:00Z').getTime();
const HOUR = 3_600_000;

const bead = (id: string, over: Partial<Bead> = {}): Bead => ({
  id, title: `Title ${id}`, status: 'open', priority: 2, type: 'task', assignee: null, labels: [], parentId: null, description: '', design: '', acceptance: '', notes: '',
  createdAt: '2026-10-01T00:00:00Z', createdBy: null, updatedAt: '2026-10-01T00:00:00Z', closedAt: null, closeReason: null, dependencies: [], comments: [], extra: {}, ...over,
});

const gate = (id: string, over: Partial<Gate> = {}): Gate => ({
  id, kind: 'human', reason: REVIEW_REASON, blocks: ['p-a'], createdBy: 'Claude Code', createdAt: new Date(NOW - 2 * HOUR).toISOString(), timeoutMs: null, planApproval: false, ...over,
});

describe('gate words', () => {
  it('names each kind in words, never by id', () => {
    expect(gateWord(gate('g-1'))).toBe('a review');
    expect(gateWord(gate('g-1', { reason: PLAN_APPROVAL_REASON, planApproval: true }))).toBe('plan approval');
    expect(gateWord(gate('g-1', { kind: 'timer' }))).toBe('a timer');
    expect(gateWord(gate('g-1', { kind: 'gh:run' }))).toBe('a GitHub check');
    expect(gateWord(gate('g-1', { kind: 'gh:pr' }))).toBe('a GitHub PR');
    expect(gateWord(gate('g-1', { kind: 'bead' }))).toBe('another bead');
    expect(gateWord(gate('g-1', { kind: 'unknown' }))).toBe('an outside check');
  });

  it('labels each kind for its tag', () => {
    expect(gateLabel(gate('g-1'))).toBe('Review');
    expect(gateLabel(gate('g-1', { planApproval: true }))).toBe('Plan approval');
    expect(gateLabel(gate('g-1', { kind: 'timer' }))).toBe('Timer');
    expect(gateLabel(gate('g-1', { kind: 'gh:run' }))).toBe('GitHub run');
    expect(gateLabel(gate('g-1', { kind: 'gh:pr' }))).toBe('GitHub pull request');
    expect(gateLabel(gate('g-1', { kind: 'bead' }))).toBe('Bead');
    expect(gateLabel(gate('g-1', { kind: 'mystery' }))).toBe('Check');
  });

  it('lists only the open gates that hold this bead', () => {
    const gates = [gate('g-1'), gate('g-2', { blocks: ['p-b'] }), gate('g-3', { kind: 'timer', blocks: ['p-a', 'p-b'] })];
    expect(gatesOn(bead('p-a'), gates).map((g) => g.id)).toEqual(['g-1', 'g-3']);
    expect(gatesOn(bead('p-c'), gates)).toEqual([]);
  });
});

describe('blockedText', () => {
  it('words gate blockers by kind', () => {
    expect(blockedText(bead('p-a'), [gate('g-1')])).toBe('waiting on a review');
    expect(blockedText(bead('p-a'), [gate('g-1', { reason: `${PLAN_APPROVAL_REASON}: v2`, planApproval: true })])).toBe('waiting on plan approval');
    expect(blockedText(bead('p-a'), [gate('g-1', { kind: 'timer' })])).toBe('waiting on a timer');
    expect(blockedText(bead('p-a'), [gate('g-1', { kind: 'gh:run' })])).toBe('waiting on a GitHub check');
    expect(blockedText(bead('p-a'), [gate('g-1', { kind: 'gh:pr' })])).toBe('waiting on a GitHub PR');
  });

  it('names a bead blocker by id and title, after the gates, and counts gates of one kind', () => {
    const gates = [gate('g-1'), gate('g-2'), gate('g-3', { kind: 'timer' })];
    expect(blockedText(bead('p-a'), gates, [{ id: 'demo-k3f2', title: 'Fix login' }])).toBe('waiting on 2 reviews, a timer and k3f2 Fix login');
    expect(blockedText(bead('p-a'), [gate('g-1', { planApproval: true }), gate('g-2', { planApproval: true })])).toBe('waiting on 2 plan approvals');
    expect(blockedText(bead('p-a'), [], [{ id: 'demo-k3f2', title: 'Fix login' }])).toBe('waiting on k3f2 Fix login');
  });

  it('keeps it short: two names, then a count', () => {
    const more = ['a', 'b', 'c'].map((id) => ({ id: `demo-${id}`, title: id.toUpperCase() }));
    expect(blockedText(bead('p-a'), [gate('g-1')], more)).toBe('waiting on a review, a A and 2 more');
  });

  it('never shows a gate id, and has words for nothing known', () => {
    const text = blockedText(bead('p-a'), [gate('demo-wisp-9x')]);
    expect(text).not.toContain('wisp');
    expect(blockedText(bead('p-a'), [])).toBe('waiting on something that is not done');
  });
});

describe('blockedMessage', () => {
  const plain = "This bead can't be closed yet. It is still blocked by demo-g1. Close those first.";

  it('tells a review apart from a bead, and never says "Close those first" for one', () => {
    expect(blockedMessage(plain, bead('p-a'), [gate('demo-g1')])).toBe("This bead can't be closed yet. It is waiting on a review. Resolve the review first.");
    expect(blockedMessage('This bead is waiting on a review. Resolve it first.', bead('p-a'), [gate('demo-g1', { planApproval: true })])).toBe(
      "This bead can't be closed yet. It is waiting on plan approval. Approve the plan first.",
    );
  });

  it('words a timer or GitHub gate as itself, with no advice to close or resolve it', () => {
    expect(blockedMessage('This bead is waiting on a review. Resolve it first.', bead('p-a'), [gate('demo-g1', { kind: 'timer' })])).toBe("This bead can't be closed yet. It is waiting on a timer.");
    expect(blockedMessage(plain, bead('p-a'), [gate('demo-g1', { kind: 'gh:pr' })])).toBe("This bead can't be closed yet. It is waiting on a GitHub PR.");
  });

  it('names the bead blockers next to the gate', () => {
    const mixed = "This bead can't be closed yet. It is still blocked by a review, demo-k3f2. Close those first.";
    expect(blockedMessage(mixed, bead('p-a'), [gate('demo-g1')], [{ id: 'demo-k3f2', title: 'Fix login' }])).toBe("This bead can't be closed yet. It is waiting on a review and k3f2 Fix login.");
  });

  it('keeps "Your comment was added" and "Part of your change was saved"', () => {
    const comment = "Your comment was added, but the bead could not be closed. This bead is waiting on a review. Resolve it first.";
    expect(blockedMessage(comment, bead('p-a'), [gate('demo-g1')])).toBe("Your comment was added, but the bead could not be closed. This bead can't be closed yet. It is waiting on a review. Resolve the review first.");
    const partial = "This bead is waiting on a review. Resolve it first. Part of your change was saved.";
    expect(blockedMessage(partial, bead('p-a'), [gate('demo-g1')])).toBe("This bead can't be closed yet. It is waiting on a review. Resolve the review first. Part of your change was saved.");
  });

  it('says "request" for a help request', () => {
    const request = "This request can't be closed yet. It is still waiting on demo-g1.";
    expect(blockedMessage(request, bead('p-a'), [gate('demo-g1')])).toBe("This request can't be closed yet. It is waiting on a review. Resolve the review first.");
  });

  it('leaves a message about beads only as the service wrote it', () => {
    const beads = "This bead can't be closed yet. It is still blocked by demo-k3f2. Close those first.";
    expect(blockedMessage(beads, bead('p-a'), [gate('demo-g1', { blocks: ['p-z'] })])).toBe(beads);
    expect(blockedMessage("This bead can't be closed yet. It has sub-tasks that are not closed yet. Close those first.", bead('p-a'), [gate('demo-g1')])).toBe(
      "This bead can't be closed yet. It has sub-tasks that are not closed yet. Close those first.",
    );
  });
});

describe('gate state', () => {
  it('says who opened a gate and when', () => {
    expect(gateState(gate('g-1'), NOW, null)).toBe('Asked by Claude Code, 2h ago');
    expect(gateState(gate('g-1', { createdBy: 'Ann (panel)' }), NOW, 'Ann (panel)')).toBe('Asked by you (panel), 2h ago');
    expect(gateState(gate('g-1', { createdBy: null }), NOW, null)).toBe('Asked 2h ago');
  });

  it('gives a timer its time left, or says the time is up', () => {
    expect(gateState(gate('g-1', { kind: 'timer', timeoutMs: 5 * HOUR }), NOW, null)).toBe('Ends in 3h. Set by Claude Code, 2h ago');
    expect(gateState(gate('g-1', { kind: 'timer', timeoutMs: HOUR }), NOW, null)).toBe('Time is up. Beads clears it on its next check');
    expect(gateState(gate('g-1', { kind: 'timer', timeoutMs: null, createdBy: null }), NOW, null)).toBe('Set 2h ago');
  });

  it('says a GitHub gate is checked by Beads', () => {
    expect(gateState(gate('g-1', { kind: 'gh:run' }), NOW, null)).toBe('Beads checks GitHub for it. Set by Claude Code, 2h ago');
    expect(gateState(gate('g-1', { kind: 'gh:pr' }), NOW, null)).toBe('Beads checks GitHub for it. Set by Claude Code, 2h ago');
  });
});

describe('one wording for "waiting on"', () => {
  it('lists up to three names with "and" before the last, then two and a count', () => {
    const b = (id: string) => ({ id: `demo-${id}`, title: id.toUpperCase() });
    expect(waitsText({ gates: [gate('g-1')], beads: [] })).toBe('waiting on a review');
    expect(waitsText({ gates: [gate('g-1'), gate('g-2', { kind: 'timer' })], beads: [] })).toBe('waiting on a review and a timer');
    expect(waitsText({ gates: [gate('g-1')], beads: [b('x'), b('y')] })).toBe('waiting on a review, x X and y Y');
    expect(waitsText({ gates: [gate('g-1')], beads: [b('x'), b('y'), b('z')] })).toBe('waiting on a review, x X and 2 more');
    const { items, more } = waitItems({ gates: [gate('g-1')], beads: [b('x'), b('y'), b('z')] });
    expect(items.map((i) => i.sep)).toEqual(['', ', ']);
    expect(more).toBe(' and 2 more');
  });

  it('Needs me uses the same words and the same "and"', () => {
    const beads = [bead('demo-k3f2', { title: 'Fix login' })];
    expect(blockerText(['g-1', 'g-2'], beads, [gate('g-1'), gate('g-2', { kind: 'timer' })])).toBe('Waiting on a review and a timer');
    expect(blockerText(['g-1', 'demo-k3f2'], beads, [gate('g-1')])).toBe('Waiting on a review and k3f2 Fix login');
    expect(blockerText(['gone'], beads, [])).toBe('Waiting on something that is not done');
  });

  it('treats every gate id as a gate, open or closed, and never names one as a bead', () => {
    const explain = { state: 'blocked' as const, blockers: [{ id: 'demo-g1', title: 'Review before closing', status: 'open' }, { id: 'demo-k3f2', title: 'Fix login', status: 'open' }] };
    // The gate closed since Beads answered: it is not listed open any more, and is not a bead either.
    expect(waitsOf(bead('p-a'), explain, [], ['demo-g1'])).toEqual({ gates: [], beads: [{ id: 'demo-k3f2', title: 'Fix login', status: 'open' }] });
    expect(waitsOf(bead('p-a'), { state: 'blocked', blockers: [explain.blockers[0]!] }, [], ['demo-g1'])).toBeNull();
    expect(whyLine(bead('p-a'), { state: 'blocked', blockers: [explain.blockers[0]!] }, [], NOW, 'UTC', ['demo-g1'])).toBeNull();
    expect(whyLine(bead('p-a'), explain, [], NOW, 'UTC', ['demo-g1'])).toBe('Waiting on k3f2 Fix login');
    // Links from the list are used while Beads has not answered.
    expect(waitsOf(bead('p-a'), null, [gate('demo-g1')], ['demo-g1'], [{ id: 'demo-b', title: 'B' }])).toEqual({ gates: [gate('demo-g1')], beads: [{ id: 'demo-b', title: 'B' }] });
  });

  it('two reviews ask to resolve them, not "the review"', () => {
    const msg = 'This bead is waiting on a review. Resolve it first.';
    expect(blockedMessage(msg, bead('p-a'), [gate('g-1'), gate('g-2')])).toBe("This bead can't be closed yet. It is waiting on 2 reviews. Resolve them first.");
  });
});
