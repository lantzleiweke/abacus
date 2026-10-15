import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseExportWithWarnings } from '../../../src/service/bd/parse';
import { deriveGates, parseLeaseRows, splitGates } from '../../../src/service/gates';
import { PLAN_APPROVAL_REASON, REVIEW_REASON } from '../../../src/shared/gates';
import type { Bead, Dependency } from '../../../src/shared/types';

const fixture = (name: string): string => readFileSync(join(__dirname, '../../fixtures/bd13', name), 'utf8');

function bead(id: string, over: Partial<Bead> = {}): Bead {
  return {
    id,
    title: id,
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
    createdAt: '2026-10-15T05:00:00Z',
    createdBy: 'tester',
    updatedAt: '2026-10-15T05:00:00Z',
    closedAt: null,
    closeReason: null,
    dependencies: [],
    comments: [],
    extra: {},
    ...over,
  };
}

const edge = (from: string, to: string, kind = 'blocks'): Dependency => ({ from, to, kind, createdBy: null, createdAt: null });

function gate(id: string, over: Partial<Bead> = {}, await_type: string | null = 'human'): Bead {
  return bead(id, { type: 'gate', title: `Gate: ${await_type}`, createdBy: 'Tester (panel)', extra: await_type === null ? {} : { await_type }, ...over });
}

describe('splitGates', () => {
  it('gate rows never reach beads: they are separated before anything else sees them', () => {
    const { beads: exported } = parseExportWithWarnings(fixture('export-with-gate.txt'));
    expect(exported.map((b) => b.id)).toEqual(['pl-b9p', 'pl-ox2', 'pl-2n0', 'pl-sex']);
    const { beads, gateRows } = splitGates(exported);
    expect(beads.map((b) => b.id)).toEqual(['pl-b9p', 'pl-2n0', 'pl-sex']);
    expect(gateRows.map((b) => b.id)).toEqual(['pl-ox2']);
  });

  it('keeps the blocked bead\'s edge to the gate as exported', () => {
    const { beads: exported } = parseExportWithWarnings(fixture('export-with-gate.txt'));
    const { beads } = splitGates(exported);
    expect(beads.find((b) => b.id === 'pl-sex')?.dependencies).toEqual([expect.objectContaining({ from: 'pl-sex', to: 'pl-ox2', kind: 'blocks' })]);
  });

  it('returns the same array when there is no gate', () => {
    const list = [bead('a'), bead('b')];
    expect(splitGates(list)).toEqual({ beads: list, gateRows: [] });
  });
});

describe('deriveGates', () => {
  it('gates lists only open gates with their blocked beads', () => {
    const { beads: exported } = parseExportWithWarnings(fixture('export-with-gate.txt'));
    const { beads, gateRows } = splitGates(exported);
    const { gates, gateIds } = deriveGates(gateRows, beads);
    expect(gateIds).toEqual(['pl-ox2']);
    expect(gates).toEqual([
      {
        id: 'pl-ox2',
        kind: 'human',
        reason: REVIEW_REASON,
        blocks: ['pl-sex'],
        createdBy: 'Tester (panel)',
        createdAt: '2026-10-15T05:36:30Z',
        timeoutMs: null,
        planApproval: false,
      },
    ]);
  });

  it('lists blocked beads in export order and ignores edges of another kind', () => {
    const rows = [gate('g1')];
    const beads = [bead('a', { dependencies: [edge('a', 'g1')] }), bead('b', { dependencies: [edge('b', 'g1', 'related')] }), bead('c', { dependencies: [edge('c', 'g1')] })];
    expect(deriveGates(rows, beads).gates[0]?.blocks).toEqual(['a', 'c']);
  });

  it('resolved gate leaves the gates list, but its id stays known (its edge persists on the bead)', () => {
    const rows = [gate('g-open'), gate('g-done', { status: 'closed', closedAt: '2026-10-15T06:00:00Z', closeReason: 'Looks good' })];
    const beads = [bead('a', { dependencies: [edge('a', 'g-done')] }), bead('b', { dependencies: [edge('b', 'g-open')] })];
    const { gates, gateIds } = deriveGates(rows, beads);
    expect(gates.map((g) => g.id)).toEqual(['g-open']);
    expect(gateIds).toEqual(['g-open', 'g-done']);
  });

  it('reason is read after the Reason marker, null when absent', () => {
    const rows = [
      gate('g1', { description: `Ad-hoc gate blocking a\n\nReason: ${REVIEW_REASON}` }),
      gate('g2', { description: 'Ad-hoc gate blocking b' }),
      gate('g3', { description: '' }),
      gate('g4', { description: 'Ad-hoc gate blocking c\n\nReason:   spaced out  \n' }),
    ];
    const reasons = deriveGates(rows, []).gates.map((g) => g.reason);
    expect(reasons).toEqual([REVIEW_REASON, null, null, 'spaced out']);
  });

  it('plan approval is a human gate with the known reason', () => {
    const rows = [
      gate('plan', { description: `Ad-hoc gate blocking a\n\nReason: ${PLAN_APPROVAL_REASON}` }),
      gate('review', { description: `Ad-hoc gate blocking a\n\nReason: ${REVIEW_REASON}` }),
      gate('timer-with-plan-reason', { description: `x\n\nReason: ${PLAN_APPROVAL_REASON}` }, 'timer'),
    ];
    const byId = Object.fromEntries(deriveGates(rows, []).gates.map((g) => [g.id, g.planApproval]));
    expect(byId).toEqual({ plan: true, review: false, 'timer-with-plan-reason': false });
  });

  it('a timer gate carries its timeout in milliseconds', () => {
    const rows = [gate('t', { extra: { await_type: 'timer', timeout: 7_200_000_000_000 } })];
    const [g] = deriveGates(rows, []).gates;
    expect(g?.kind).toBe('timer');
    expect(g?.timeoutMs).toBe(7_200_000);
  });

  it('keeps an unknown kind verbatim and names a gate with no kind "unknown"', () => {
    const rows = [gate('x', {}, 'gh:run'), gate('y', {}, null)];
    expect(deriveGates(rows, []).gates.map((g) => g.kind)).toEqual(['gh:run', 'unknown']);
  });
});

describe('parseLeaseRows', () => {
  it('turns bd\'s UTC datetime into ISO UTC', () => {
    const rows = JSON.parse(fixture('leases-after-claim.json')).rows as Array<Record<string, unknown>>;
    expect(parseLeaseRows(rows)).toEqual([{ beadId: 'pl-8nm', holder: 'tester', expiresAt: '2026-10-15T05:46:36.000Z' }]);
  });

  it('skips a row with no id, holder or readable expiry, and sorts by bead id', () => {
    const rows = [
      { issue_id: 'b', holder: 'h', lease_expires_at: '2026-10-15 05:46:36' },
      { issue_id: 'a', holder: 'h', lease_expires_at: '2026-10-15T05:46:36Z' },
      { issue_id: '', holder: 'h', lease_expires_at: '2026-10-15 05:46:36' },
      { issue_id: 'c', holder: '', lease_expires_at: '2026-10-15 05:46:36' },
      { issue_id: 'd', holder: 'h', lease_expires_at: 'soon' },
    ];
    expect(parseLeaseRows(rows).map((l) => l.beadId)).toEqual(['a', 'b']);
  });
});
