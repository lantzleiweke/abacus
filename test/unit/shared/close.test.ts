import { describe, expect, it } from 'vitest';
import { closeBlockers } from '../../../src/shared/close';
import type { Bead } from '../../../src/shared/types';

const bead = (id: string, over: Partial<Bead> = {}): Bead => ({
  id, title: id, status: 'open', priority: 2, type: 'task', assignee: null, labels: [], parentId: null, description: '', design: '', acceptance: '', notes: '',
  createdAt: '2026-10-01T00:00:00Z', createdBy: null, updatedAt: '2026-10-01T00:00:00Z', closedAt: null, closeReason: null, dependencies: [], comments: [], extra: {}, ...over,
});
const blocks = (from: string, to: string, kind = 'blocks') => ({ from, to, kind, createdBy: null, createdAt: null });

describe('closeBlockers (shared by the service and the panel)', () => {
  it('names an open blocks target and an open child', () => {
    const rows = [bead('a', { dependencies: [blocks('a', 'g')] }), bead('g', { type: 'gate' }), bead('c', { parentId: 'a' })];
    expect(closeBlockers(rows, 'a')).toEqual(['g', 'c']);
  });

  it('is empty once the target is closed or pinned, and for a bead nobody holds', () => {
    const rows = [bead('a', { dependencies: [blocks('a', 'g'), blocks('a', 'p')] }), bead('g', { status: 'closed' }), bead('p', { status: 'pinned' })];
    expect(closeBlockers(rows, 'a')).toEqual([]);
    expect(closeBlockers(rows, 'missing')).toEqual([]);
  });

  it('counts a done category that is not literally closed as still open (bd closes by the literal status)', () => {
    const rows = [bead('a', { dependencies: [blocks('a', 'b')] }), bead('b', { status: 'shipped' })];
    expect(closeBlockers(rows, 'a')).toEqual(['b']);
  });

  it('a bead under a blocked parent is blocked, and names only its own direct targets', () => {
    const rows = [bead('p', { dependencies: [blocks('p', 'g')] }), bead('g'), bead('k', { parentId: 'p', dependencies: [blocks('k', 'x')] }), bead('x')];
    expect(closeBlockers(rows, 'k')).toEqual(['x']);
  });
});
