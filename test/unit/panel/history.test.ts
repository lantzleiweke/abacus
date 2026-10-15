import { describe, expect, it } from 'vitest';
import { freshChange, groupByDay, lineDiff, restoreRequest, restoreState } from '../../../src/panel/history';
import type { Bead, HistoryChange, HistoryEntry } from '../../../src/shared/types';

const bead = (over: Partial<Bead> = {}): Bead => ({
  id: 'x-1', title: 'New title', status: 'in_progress', priority: 0, type: 'task', assignee: 'Bob', labels: ['a', 'b'], parentId: null, description: 'now', design: '', acceptance: '', notes: '',
  createdAt: '2026-10-01T00:00:00Z', createdBy: null, updatedAt: '2026-10-14T10:00:00Z', closedAt: null, closeReason: null, dependencies: [], comments: [], extra: {}, ...over,
});
const change = (field: string, from: HistoryChange['from'], to: HistoryChange['to'], over: Partial<HistoryChange> = {}): HistoryChange => ({ field, from, to, text: false, ...over });

describe('history: restoreRequest sets expected to the produced value', () => {
  it('puts the old value back, expecting the value the change produced, at the bead the panel holds now', () => {
    expect(restoreRequest(bead(), change('title', 'Old title', 'New title'))).toEqual({
      id: 'x-1',
      expectedUpdatedAt: '2026-10-14T10:00:00Z',
      patch: { title: 'Old title' },
      expected: { title: 'New title' },
    });
  });

  it('takes the time from the bead it is given, never from the entry', () => {
    expect(restoreRequest(bead({ updatedAt: '2026-10-15T09:00:00Z' }), change('priority', 2, 0))?.expectedUpdatedAt).toBe('2026-10-15T09:00:00Z');
  });

  it('handles priority, assignee (a name and none), labels, status and long text', () => {
    expect(restoreRequest(bead(), change('priority', 2, 0))).toMatchObject({ patch: { priority: 2 }, expected: { priority: 0 } });
    expect(restoreRequest(bead(), change('assignee', null, 'Bob'))).toMatchObject({ patch: { assignee: null }, expected: { assignee: 'Bob' } });
    expect(restoreRequest(bead({ assignee: null }), change('assignee', 'Bob', null))).toMatchObject({ patch: { assignee: 'Bob' }, expected: { assignee: null } });
    expect(restoreRequest(bead(), change('labels', ['a'], ['a', 'b']))).toMatchObject({ patch: { labels: ['a'] }, expected: { labels: ['a', 'b'] } });
    expect(restoreRequest(bead(), change('status', 'open', 'in_progress'))).toMatchObject({ patch: { status: 'open' }, expected: { status: 'in_progress' } });
    expect(restoreRequest(bead(), change('description', '', 'now', { text: true }))).toMatchObject({ patch: { description: '' }, expected: { description: 'now' } });
  });

  it('a truncated change is never restorable', () => {
    expect(restoreRequest(bead(), change('description', 'a…', 'b…', { text: true, truncated: true }))).toBeNull();
    expect(restoreState(bead(), change('description', 'a…', 'b…', { text: true, truncated: true }))).toBe('never');
  });

  it('a field the panel cannot put back, or a value it cannot send, is not restorable', () => {
    expect(restoreRequest(bead(), change('due', null, '2026-10-20'))).toBeNull();
    expect(restoreRequest(bead(), change('priority', null, 0))).toBeNull();
    expect(restoreRequest(bead(), change('title', 3, 'x'))).toBeNull();
    expect(restoreRequest(bead(), change('labels', ['a', 1], ['a']))).toBeNull();
  });
});

describe('history: restoreState tells whether a restore would run', () => {
  it('ready while the bead still holds what the change produced', () => {
    expect(restoreState(bead(), change('title', 'Old', 'New title'))).toBe('ready');
  });
  it('changed once someone changed the field again (a restore would be refused: it must not overwrite newer work)', () => {
    expect(restoreState(bead({ title: 'Newer' }), change('title', 'Old', 'New title'))).toBe('changed');
  });
  it('unchanged when the bead already holds the old value', () => {
    expect(restoreState(bead({ title: 'Old' }), change('title', 'Old', 'New title'))).toBe('unchanged');
  });
  it('compares labels without regard to order', () => {
    expect(restoreState(bead({ labels: ['b', 'a'] }), change('labels', ['a'], ['a', 'b']))).toBe('ready');
  });
});

describe('history: a fresh restore is built from the current value', () => {
  it('expects what the bead holds now, and still puts the change\'s old value back', () => {
    const fresh = freshChange(bead({ priority: 1 }), change('priority', 3, 0));
    expect(fresh).toEqual(change('priority', 3, 1));
    expect(restoreRequest(bead({ priority: 1, updatedAt: '2026-10-15T00:00:00Z' }), fresh)).toMatchObject({ expectedUpdatedAt: '2026-10-15T00:00:00Z', patch: { priority: 3 }, expected: { priority: 1 } });
  });
});

describe('history: compact line diff', () => {
  it('marks removed and added lines and folds long unchanged runs, keeping a line of context', () => {
    const from = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n');
    const to = ['a', 'b', 'c', 'D', 'e', 'f', 'g', 'h', 'i'].join('\n');
    expect(lineDiff(from, to)).toEqual([
      { kind: 'skip', count: 2 },
      { kind: 'same', text: 'c' },
      { kind: 'del', text: 'd' },
      { kind: 'add', text: 'D' },
      { kind: 'same', text: 'e' },
      { kind: 'skip', count: 2 },
      { kind: 'same', text: 'h' },
      { kind: 'add', text: 'i' },
    ]);
    // A single unchanged line between two changes is shown, never folded into "1 unchanged line".
    expect(lineDiff('a\nb\nc', 'A\nb\nC')).toEqual([
      { kind: 'del', text: 'a' },
      { kind: 'add', text: 'A' },
      { kind: 'same', text: 'b' },
      { kind: 'del', text: 'c' },
      { kind: 'add', text: 'C' },
    ]);
  });

  it('handles empty sides and identical text', () => {
    expect(lineDiff('', 'x\ny')).toEqual([{ kind: 'add', text: 'x' }, { kind: 'add', text: 'y' }]);
    expect(lineDiff('x', '')).toEqual([{ kind: 'del', text: 'x' }]);
    expect(lineDiff('x\ny\nz', 'x\ny\nz')).toEqual([{ kind: 'skip', count: 3 }]);
  });

  it('stays bounded on very long text: the changed middle is shown removed, then added', () => {
    const many = (p: string) => Array.from({ length: 300 }, (_, i) => `${p}${i}`).join('\n');
    const rows = lineDiff(many('a'), many('b'));
    expect(rows.filter((r) => r.kind === 'del')).toHaveLength(300);
    expect(rows.findIndex((r) => r.kind === 'add')).toBe(300);
  });
});

describe('history: groups entries by day', () => {
  const entry = (id: string, at: string): HistoryEntry => ({ id, at, actor: null, changes: [], restorable: [] });
  const now = Date.parse('2026-10-15T12:00:00Z');

  it('keeps the order given and groups by local day, with Today and Yesterday named', () => {
    const groups = groupByDay([entry('a', '2026-10-15T09:00:00Z'), entry('b', '2026-10-15T01:00:00Z'), entry('c', '2026-10-14T23:00:00Z'), entry('d', '2026-10-02T10:00:00Z'), entry('e', '2025-12-31T10:00:00Z')], now);
    expect(groups.map((g) => [g.label, g.entries.map((e) => e.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['Oct 2', ['d']],
      ['Dec 31, 2025', ['e']],
    ]);
  });

  it('an empty list has no groups, and a time that is not a time stays in the group before it', () => {
    expect(groupByDay([], now)).toEqual([]);
    const groups = groupByDay([entry('a', '2026-10-15T09:00:00Z'), entry('b', 'not a time')], now);
    expect(groups.map((g) => g.entries.map((e) => e.id))).toEqual([['a', 'b']]);
  });
});
