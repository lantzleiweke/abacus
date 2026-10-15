import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { stillAsShown } from '../../../src/service/bd/adapter';
import { parseList } from '../../../src/service/bd/parse';
import type { AuditEvent } from '../../../src/service/bd/audit';
import { buildHistory, gateAuditEntries, gateEntries, readHistory, type GateAuditRead, type HistoryRead } from '../../../src/service/history';
import type { Bead, ChangeEvent, ExpectedFields, HistoryEntry } from '../../../src/shared/types';

const fixture = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, '../../fixtures/bd13', name), 'utf8'));

type Row = { CommitHash: string; Committer: string; CommitDate: string; Issue: Record<string, unknown> };
type RawEvent = { id: string; issue_id: string; event_type: string; actor: string | null; old_value?: string | null; new_value?: string | null; comment?: string; created_at: string };

const FIXTURE_ROWS = fixture('history.json') as Row[];
const FIXTURE_EVENTS = fixture('history-events.json') as RawEvent[];

/** What `bd history` would print for the first `limit` rows: a read that honors `--limit`. */
function readFrom(rows: Row[] | null, events: RawEvent[] | null, utcSince: number | null = 0): (limit: number) => Promise<HistoryRead> {
  // `utcSince` 0: a store that wrote UTC stamps from the start (the bd 1.3 fixtures); a number or null overrides it.
  return async (limit) => ({ rows: rows === null ? null : rows.slice(0, limit), events: events === null ? null : events.slice(0, limit), utcSince });
}

const BASE = { before: undefined, pageSize: 20, currentLabels: [] as string[], activity: [] as ChangeEvent[], beadId: 'pl-2n0' };

async function entriesOf(rows: Row[] | null, events: RawEvent[] | null, over: Partial<typeof BASE> = {}): Promise<HistoryEntry[]> {
  return (await readHistory(readFrom(rows, events), { ...BASE, ...over })).entries;
}

describe('history entries', () => {
  it('consecutive identical snapshots collapse', async () => {
    const entries = await entriesOf(FIXTURE_ROWS, FIXTURE_EVENTS);
    // 12 commits for 4 real changes: the change is shown at the first commit that carried it.
    expect(entries.map((e) => e.id.split(':')[0]!.slice(0, 8))).toEqual(['7qigkt99', '2pr5afof', 'e3idem82', 'icns64h8']);
  });

  it('entries are newest first with from and to', async () => {
    const entries = await entriesOf(FIXTURE_ROWS, FIXTURE_EVENTS);
    expect(entries.map((e) => e.changes.map((c) => [c.field, c.from, c.to, c.text]))).toEqual([
      [['description', '', 'Now with a description', true]],
      [['priority', 2, 0, false], ['notes', '', 'first note', true]],
      [['status', 'open', 'in_progress', false], ['assignee', null, 'agent', false]],
      [],
    ]);
    expect(entries.map((e) => e.restorable)).toEqual([['description'], ['priority', 'notes'], ['status', 'assignee'], []]);
    // The oldest has no predecessor: it is the creation, not a diff.
    expect(entries.map((e) => e.created === true)).toEqual([false, false, false, true]);
    const times = entries.map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(entries[3]!.at).toBe('2026-10-15T05:36:24Z');
  });

  it('actor joined on updated_at, null when unmatched', async () => {
    const entries = await entriesOf(FIXTURE_ROWS, FIXTURE_EVENTS);
    // The panel's own write (the event is stamped a second before the new updated_at: it is joined through the version it replaced).
    expect(entries.map((e) => e.actor)).toEqual(['agent', 'Tester (panel)', 'agent', 'tester']);
    const withoutPanel = FIXTURE_EVENTS.filter((e) => e.actor !== 'Tester (panel)');
    expect((await entriesOf(FIXTURE_ROWS, withoutPanel)).map((e) => e.actor)).toEqual(['agent', null, 'agent', 'tester']);
  });

  it('an event for another change is not borrowed for an unrelated snapshot', async () => {
    // Only the description event exists: the two older changes must stay unnamed (no guessing).
    const entries = await entriesOf(FIXTURE_ROWS, FIXTURE_EVENTS.filter((e) => e.new_value === '{"description":"Now with a description"}'));
    expect(entries.map((e) => e.actor)).toEqual(['agent', null, null, 'tester']); // the creator is the one the snapshot itself records
  });

  it('an event at the right time but with other values is not borrowed', async () => {
    // The agent event is stamped for the description version, but it wrote a different description: another computer's edit.
    const events = FIXTURE_EVENTS.map((e) => (e.actor === 'agent' && e.new_value?.includes('description') ? { ...e, new_value: '{"description":"Something else"}' } : e));
    expect((await entriesOf(FIXTURE_ROWS, events)).map((e) => e.actor)).toEqual([null, 'Tester (panel)', 'agent', 'tester']);
  });

  it('the older-version join also needs the written values to match', async () => {
    // The panel event is joined through the version it replaced (updated_at :02), but it wrote priority 3 where the version has 0.
    const events = FIXTURE_EVENTS.map((e) => (e.actor === 'Tester (panel)' ? { ...e, new_value: '{"notes":"first note","priority":3}' } : e));
    expect((await entriesOf(FIXTURE_ROWS, events)).map((e) => e.actor)).toEqual(['agent', null, 'agent', 'tester']);
    // An event that wrote only some of the changed fields still counts when what it wrote matches.
    const partial = FIXTURE_EVENTS.map((e) => (e.actor === 'Tester (panel)' ? { ...e, new_value: '{"priority":0}' } : e));
    expect((await entriesOf(FIXTURE_ROWS, partial)).map((e) => e.actor)).toEqual(['agent', 'Tester (panel)', 'agent', 'tester']);
  });

  it('a cleared field written as an empty string matches a version that omits it', async () => {
    const rows = rowsOf([issue({ assignee: 'agent' }), issue({})]);
    const events: RawEvent[] = [{ id: 'x1', issue_id: 'pl-x', event_type: 'updated', actor: 'Ann', old_value: null, new_value: '{"assignee":""}', created_at: String(rows[0]!.Issue.updated_at) }];
    expect((await entriesOf(rows, events, { beadId: 'pl-x' })).map((e) => e.actor)).toEqual(['Ann', 'me']);
  });

  it('events unreadable gives labelsKnown false', async () => {
    const result = await readHistory(readFrom(FIXTURE_ROWS, null), { ...BASE, currentLabels: ['x'] });
    expect(result.labelsKnown).toBe(false);
    expect(result.entries.map((e) => e.actor)).toEqual([null, null, null, 'tester']); // only the creator the snapshot itself records
    expect(result.entries.flatMap((e) => e.changes).some((c) => c.field === 'labels')).toBe(false);
  });

  it('missing id gives an empty list', async () => {
    expect(await readHistory(readFrom(fixture('history-missing.json') as null, null), BASE)).toEqual({ entries: [], more: false, labelsKnown: true });
  });
});

const labelEvent = (id: string, type: 'label_added' | 'label_removed', label: string, at: string, actor = 'Ann'): RawEvent => ({
  id, issue_id: 'pl-2n0', event_type: type, actor, comment: `${type === 'label_added' ? 'Added' : 'Removed'} label: ${label}`, created_at: at,
});

describe('label changes', () => {
  it('label changes come from events only', async () => {
    // Newest first, as bd prints them. Current labels are the end state: ['b', 'c'].
    const events = [
      labelEvent('e3', 'label_added', 'c', '2026-10-15T05:37:30Z'),
      labelEvent('e2', 'label_removed', 'a', '2026-10-15T05:37:20Z', 'agent'),
      labelEvent('e1', 'label_added', 'b', '2026-10-15T05:37:05Z'),
      ...FIXTURE_EVENTS,
    ];
    const result = await readHistory(readFrom(FIXTURE_ROWS, events), { ...BASE, currentLabels: ['b', 'c'] });
    expect(result.labelsKnown).toBe(true);
    const labels = result.entries.filter((e) => e.changes.some((c) => c.field === 'labels'));
    expect(labels.map((e) => [e.actor, e.at, e.changes[0]!.from, e.changes[0]!.to, e.restorable])).toEqual([
      ['Ann', '2026-10-15T05:37:30Z', ['b'], ['b', 'c'], ['labels']],
      ['agent', '2026-10-15T05:37:20Z', ['a', 'b'], ['b'], ['labels']],
      ['Ann', '2026-10-15T05:37:05Z', ['a'], ['a', 'b'], ['labels']],
    ]);
    // Merged in time order with the snapshot entries around them.
    const times = result.entries.map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('labels in the same second by the same actor are one change with the net effect', async () => {
    const events = [
      labelEvent('e3', 'label_added', 'gamma', '2026-10-15T05:37:30Z'),
      labelEvent('e2', 'label_removed', 'beta', '2026-10-15T05:37:30Z'),
      labelEvent('e1', 'label_added', 'beta', '2026-10-15T05:37:30Z'),
    ];
    const result = await readHistory(readFrom(FIXTURE_ROWS, events), { ...BASE, currentLabels: ['gamma'] });
    const changes = result.entries.flatMap((e) => e.changes).filter((c) => c.field === 'labels');
    // beta was added and removed inside the second: nothing to say about it.
    expect(changes).toEqual([{ field: 'labels', from: [], to: ['gamma'], text: false }]);
  });

  it('a project that cannot say its current labels lists no label changes', async () => {
    const events = [labelEvent('e1', 'label_added', 'b', '2026-10-15T05:37:05Z')];
    const result = await readHistory(readFrom(FIXTURE_ROWS, events), { ...BASE, currentLabels: null });
    expect(result.labelsKnown).toBe(false);
    expect(result.entries.flatMap((e) => e.changes).some((c) => c.field === 'labels')).toBe(false);
  });
});

describe('event times in a store bd 1.2.2 wrote and bd 1.3.1 now opens (L7)', () => {
  // The pantry shape: the bead was made 2026-10-15T03:45:00Z; its 1.2.2 events carry that moment as PDT labeled Z (the day before,
  // 20:45); the 1.3.1 migration ran 18:24:10Z and every row after it is real UTC.
  const MIGRATED = Date.parse('2026-10-15T18:24:10.785Z');
  const v5 = (n: number) => `6bc9f132-e343-521e-9d84-b07ce7f2${String(n).padStart(4, '0')}`;
  const v7 = '01a13989-534f-7288-bce3-267994d4b2ae'; // 2026-10-14T08:31:03.503Z
  const ev = (id: string, type: RawEvent['event_type'], at: string, label?: string, actor = 'Ann Lee'): RawEvent => ({
    id, issue_id: 'pl-x', event_type: type, actor, ...(label ? { comment: `Added label: ${label}` } : {}), created_at: at,
  });
  const rows = rowsOf([issue({ id: 'pl-x', created_at: '2026-10-15T03:45:00Z' })]);
  const labelEntries = async (events: RawEvent[], utcSince: number | null = MIGRATED, currentLabels = ['search', 'beta']) => {
    const result = await readHistory(readFrom(rows, events, utcSince), { ...BASE, beadId: 'pl-x', currentLabels });
    return result.entries;
  };
  const labelsOf = (entries: HistoryEntry[]) => entries.filter((e) => e.changes.some((c) => c.field === 'labels'));

  it('a 1.2.2 label event no longer shows 7 hours before the creation', async () => {
    const entries = await labelEntries([
      ev(v5(1), 'label_added', '2026-10-15T18:30:00Z', 'beta', 'Claude Code'),
      ev(v5(2), 'created', '2026-10-14T20:45:00Z'),
      ev(v5(3), 'label_added', '2026-10-14T20:45:00Z', 'search'),
    ]);
    const created = entries.find((e) => e.created)!;
    expect(created.at).toBe('2026-10-15T03:45:00Z');
    const times = labelsOf(entries).map((e) => e.at);
    // Made with the bead (the same recorded second as its creation): the creation's time. Never 2026-10-14T20:45:00Z.
    expect(times).toEqual(['2026-10-15T18:30:00Z', '2026-10-15T03:45:00Z']);
    expect(entries.every((e) => e.at === '' || Date.parse(e.at) >= Date.parse(created.at))).toBe(true);
  });

  it('a label change of a 1.2.2 row with no way to date it is listed without a time, not with a wrong one', async () => {
    const entries = await labelEntries([
      ev(v5(1), 'created', '2026-10-14T20:45:00Z'),
      ev(v5(2), 'label_added', '2026-10-14T22:10:00Z', 'search'),
    ], MIGRATED, ['search']);
    expect(labelsOf(entries).map((e) => e.at)).toEqual(['']);
    expect(entries.map((e) => e.at).filter((at) => at.startsWith('2026-10-14'))).toEqual([]);
  });

  it('a 1.3.1 event keeps its real UTC time', async () => {
    const entries = await labelEntries([ev(v5(1), 'label_added', '2026-10-15T18:30:00Z', 'beta', 'Claude Code')], MIGRATED, ['beta']);
    expect(labelsOf(entries).map((e) => e.at)).toEqual(['2026-10-15T18:30:00Z']);
  });

  it('a UUIDv7 id gives the id time, whatever created_at says', async () => {
    const entries = await labelEntries([ev(v7, 'label_added', '2026-10-14T01:00:00Z', 'search')], MIGRATED, ['search']);
    expect(labelsOf(entries).map((e) => e.at)).toEqual(['2026-10-14T08:31:03.503Z']);
  });

  it('with no migration date known, only a UUIDv7 id dates an event', async () => {
    const entries = await labelEntries([ev(v5(1), 'label_added', '2026-10-15T18:30:00Z', 'beta'), ev(v7, 'label_added', '2026-10-14T01:00:00Z', 'search')], null);
    // The undated change goes last: nothing places it.
    expect(labelsOf(entries).map((e) => e.at)).toEqual(['2026-10-14T08:31:03.503Z', '']);
  });
});

function issue(over: Record<string, unknown>): Record<string, unknown> {
  return { id: 'pl-x', title: 'T', status: 'open', priority: 2, issue_type: 'task', owner: 'o', created_at: '2026-10-15T05:00:00Z', created_by: 'me', updated_at: '2026-10-15T05:00:00Z', ...over };
}

/** Rows newest first for the issues given oldest first, one second apart. */
function rowsOf(issues: Array<Record<string, unknown>>): Row[] {
  return issues
    .map((i, n) => ({ ...i, updated_at: new Date(Date.parse('2026-10-15T05:00:00Z') + n * 1000).toISOString().replace('.000', '') }))
    .map((i, n) => ({ CommitHash: `h${String(n).padStart(4, '0')}`, Committer: 'beads', CommitDate: String(i.updated_at), Issue: i }))
    .reverse();
}

describe('paging', () => {
  it('paging does not split an entry', async () => {
    const first = await readHistory(readFrom(FIXTURE_ROWS, FIXTURE_EVENTS), { ...BASE, pageSize: 3 });
    // The priority and notes of one change share one entry: a page of 3 holds three whole entries.
    expect(first.entries.map((e) => e.changes.length)).toEqual([1, 2, 2]);
    expect(first.more).toBe(true);
    const second = await readHistory(readFrom(FIXTURE_ROWS, FIXTURE_EVENTS), { ...BASE, pageSize: 3, before: first.entries.at(-1)!.id });
    expect(second.entries.map((e) => e.created)).toEqual([true]);
    expect(second.more).toBe(false);
    const sizes = [1, 2].map(async (pageSize) => (await entriesOf(FIXTURE_ROWS, FIXTURE_EVENTS, { pageSize })).length);
    expect(await Promise.all(sizes)).toEqual([1, 2]);
  });

  it('an unknown cursor gives an empty page', async () => {
    expect(await readHistory(readFrom(FIXTURE_ROWS, FIXTURE_EVENTS), { ...BASE, before: 'nope:3' })).toMatchObject({ entries: [], more: false });
  });

  it('a cursor still finds its entry after newer commits arrived (the index moved, the hash did not)', async () => {
    const stale = await readHistory(readFrom(FIXTURE_ROWS, FIXTURE_EVENTS), { ...BASE, pageSize: 1 });
    const later: Row = { ...FIXTURE_ROWS[0]!, CommitHash: 'zzzznew', Issue: { ...FIXTURE_ROWS[0]!.Issue, title: 'Renamed', updated_at: '2026-10-15T05:40:00Z' } };
    const next = await readHistory(readFrom([later, ...FIXTURE_ROWS], FIXTURE_EVENTS), { ...BASE, pageSize: 1, before: stale.entries[0]!.id });
    expect(next.entries[0]!.id.startsWith('2pr5afof')).toBe(true);
  });

  it('paging past the first read re-reads with a larger limit, up to 1000', async () => {
    // 1500 distinct versions. Page 20 at a time, from the first page, until it stops.
    const issues = Array.from({ length: 1500 }, (_, n) => issue({ title: `T${n}` }));
    const rows = rowsOf(issues);
    const limits: number[] = [];
    const read = vi.fn(async (limit: number) => {
      limits.push(limit);
      return { rows: rows.slice(0, limit), events: null } satisfies HistoryRead;
    });
    let before: string | undefined;
    let shown = 0;
    let more = true;
    for (let guard = 0; more && guard < 100; guard += 1) {
      const page = await readHistory(read, { ...BASE, before, pageSize: 50, beadId: 'pl-x' });
      shown += page.entries.length;
      before = page.entries.at(-1)?.id;
      more = page.more;
    }
    expect(Math.max(...limits)).toBe(1000);
    expect(limits).toContain(400);
    // Entries come from the 1000 newest commits; the oldest of those has nothing older to compare with, so it is not shown.
    expect(shown).toBe(999);
    expect(more).toBe(false);
  });

  it('the oldest version of a cut read is not shown as a creation', async () => {
    const rows = rowsOf(Array.from({ length: 250 }, (_, n) => issue({ title: `T${n}` })));
    const page = await readHistory(readFrom(rows, null), { ...BASE, pageSize: 50, beadId: 'pl-x' });
    expect(page.entries.some((e) => e.created)).toBe(false);
    expect(page.more).toBe(true);
    // A read that holds everything shows the creation.
    const all = await readHistory(readFrom(rows.slice(0, 40), null), { ...BASE, pageSize: 50, beadId: 'pl-x' });
    expect(all.entries.at(-1)!.created).toBe(true);
    expect(all.more).toBe(false);
  });
});

describe('what a change carries', () => {
  it('acceptance criteria is the acceptance field, issue_type is type', async () => {
    const rows = rowsOf([issue({}), issue({ acceptance_criteria: '- [ ] one', issue_type: 'bug' })]);
    const [entry] = await entriesOf(rows, null, { beadId: 'pl-x' });
    expect(entry!.changes.map((c) => [c.field, c.from, c.to, c.text])).toEqual([['type', 'task', 'bug', false], ['acceptance', '', '- [ ] one', true]]);
    expect(entry!.restorable).toEqual(['acceptance']);
  });

  it('a field that was cleared reads as none, not as undefined', async () => {
    const rows = rowsOf([issue({ assignee: 'agent', description: 'text' }), issue({})]);
    const [entry] = await entriesOf(rows, null, { beadId: 'pl-x' });
    expect(entry!.changes.map((c) => [c.field, c.from, c.to])).toEqual([['assignee', 'agent', null], ['description', 'text', '']]);
  });

  it('bookkeeping that moves with every change is not a change', async () => {
    const rows = rowsOf([issue({}), issue({ status: 'closed', closed_at: '2026-10-15T05:00:09Z', close_reason: 'done', started_at: '2026-10-15T05:00:01Z' })]);
    const [entry] = await entriesOf(rows, null, { beadId: 'pl-x' });
    expect(entry!.changes.map((c) => c.field)).toEqual(['status']);
  });

  it('a long text is cut, flagged, and never offered for restore', async () => {
    const long = 'x'.repeat(30_000);
    const rows = rowsOf([issue({ description: long }), issue({ description: `${long}y`, notes: 'short' })]);
    const [entry] = await entriesOf(rows, null, { beadId: 'pl-x' });
    const description = entry!.changes.find((c) => c.field === 'description')!;
    expect(description.truncated).toBe(true);
    expect(String(description.to).length).toBeLessThan(30_000);
    expect(entry!.restorable).toEqual(['notes']);
    expect(entry!.changes.find((c) => c.field === 'notes')!.truncated).toBeUndefined();
  });

  it('a priority that was unset cannot be restored: there is nothing to put back', async () => {
    const rows = rowsOf([issue({ priority: undefined }), issue({ priority: 1, notes: 'n' })]);
    const [entry] = await entriesOf(rows, null, { beadId: 'pl-x' });
    expect(entry!.changes.find((c) => c.field === 'priority')).toMatchObject({ from: null, to: 1 });
    expect(entry!.restorable).toEqual(['notes']);
  });

  it('a version with no visible change is not listed', async () => {
    const rows = rowsOf([issue({}), issue({ started_at: '2026-10-15T05:00:01Z' }), issue({ title: 'Renamed' })]);
    const entries = await entriesOf(rows, null, { beadId: 'pl-x' });
    expect(entries.map((e) => e.changes.map((c) => c.field))).toEqual([['title'], []]);
    expect(entries[1]!.created).toBe(true);
  });
});

describe('restorable changes', () => {
  /** The bead a version of `Issue` produced, as the panel's own parser reads it. */
  const beadOf = (row: Row) => parseList([row.Issue])[0]!;

  it('every restorable change satisfies stillAsShown on the version it produced', async () => {
    const rows = [
      ...FIXTURE_ROWS,
      ...rowsOf([
        issue({ id: 'pl-x' }),
        issue({ id: 'pl-x', acceptance_criteria: '- [ ] one', design: 'd', assignee: 'agent', title: '  Padded title ' }),
        issue({ id: 'pl-x', acceptance_criteria: '- [x] one', design: '', assignee: '', title: 'Back', priority: 0, status: 'in_progress' }),
      ]),
    ];
    for (const group of [FIXTURE_ROWS, rows.slice(FIXTURE_ROWS.length)]) {
      const entries = await entriesOf(group, null, { beadId: String(group[0]!.Issue.id) });
      let checked = 0;
      for (const entry of entries) {
        const produced = group.find((r) => r.CommitHash === entry.id.split(':')[0]);
        expect(produced).toBeDefined();
        for (const change of entry.changes.filter((c) => entry.restorable.includes(c.field))) {
          const shown = { [change.field]: change.to } as ExpectedFields;
          expect(stillAsShown(shown, beadOf(produced!)), `${entry.id} ${change.field}`).toBe(true);
          // And the value it replaced does not: restoring is a real change, not a no-op.
          expect(stillAsShown({ [change.field]: change.from } as ExpectedFields, beadOf(produced!)), `${entry.id} ${change.field} from`).toBe(false);
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(0);
    }
  });

  it('a field that moved on no longer matches what the entry shows', async () => {
    const entries = await entriesOf(FIXTURE_ROWS, null);
    const priority = entries[1]!.changes.find((c) => c.field === 'priority')!;
    const newer = beadOf(FIXTURE_ROWS[0]!);
    expect(stillAsShown({ priority: priority.to as number }, newer)).toBe(true); // nothing moved it yet
    expect(stillAsShown({ priority: priority.to as number }, { ...newer, priority: 3 })).toBe(false);
    // A text field is the unit: an edit anywhere in it no longer matches as a whole.
    const notes = entries[1]!.changes.find((c) => c.field === 'notes')!;
    expect(stillAsShown({ notes: String(notes.to) }, { ...newer, notes: `${String(notes.to)} and more` })).toBe(false);
  });
});

describe('gate entries', () => {
  const gate = (over: Partial<ChangeEvent>): ChangeEvent => ({
    id: 'g1', beadId: 'pl-2n0', kind: 'gate_opened', gateId: 'pl-gate', gateKind: 'human', reason: 'Review before closing', actor: 'Ann (panel)', byPanel: true, observedAt: '2026-10-15T05:37:06Z', ...over,
  });

  it('turns the activity rows of one bead into entries', () => {
    const rows: ChangeEvent[] = [
      gate({ id: 'a', kind: 'gate_resolved', actor: 'Claude Code', byPanel: false, observedAt: '2026-10-15T05:37:09Z', changedAt: '2026-10-15T05:37:08Z' }),
      gate({ id: 'b', kind: 'gate_resolved', gateId: 'pl-g2', actor: null, byPanel: false, ended: 'deleted' }),
      gate({ id: 'c', kind: 'gate_resolved', gateId: 'pl-g3', ended: 'unlinked' }),
      gate({ id: 'd' }),
      gate({ id: 'e', beadId: 'other' }),
      { id: 'f', beadId: 'pl-2n0', kind: 'field', field: 'title', actor: null, byPanel: false, observedAt: '2026-10-15T05:37:10Z' },
      gate({ id: 'h', gateKind: undefined, reason: undefined }),
    ];
    const entries = gateEntries(rows, 'pl-2n0');
    expect(entries.map((e) => [e.id, e.at, e.actor, e.gate])).toEqual([
      ['gate:a', '2026-10-15T05:37:08Z', 'Claude Code', { gateId: 'pl-gate', what: 'resolved', gateKind: 'human', reason: 'Review before closing', byPanel: false }],
      ['gate:b', '2026-10-15T05:37:06Z', null, { gateId: 'pl-g2', what: 'deleted', gateKind: 'human', reason: 'Review before closing', byPanel: false }],
      ['gate:c', '2026-10-15T05:37:06Z', 'Ann (panel)', { gateId: 'pl-g3', what: 'unlinked', gateKind: 'human', reason: 'Review before closing', byPanel: true }],
      ['gate:d', '2026-10-15T05:37:06Z', 'Ann (panel)', { gateId: 'pl-gate', what: 'requested', gateKind: 'human', reason: 'Review before closing', byPanel: true }],
      ['gate:h', '2026-10-15T05:37:06Z', 'Ann (panel)', { gateId: 'pl-gate', what: 'requested', gateKind: null, reason: null, byPanel: true }],
    ]);
    expect(entries.every((e) => e.changes.length === 0 && e.restorable.length === 0)).toBe(true);
  });

  it('merges into the versions in time order and shows who resolved a review', async () => {
    const activity = [
      gate({ id: 'res', kind: 'gate_resolved', actor: 'Claude Code', byPanel: false, observedAt: '2026-10-15T05:37:11Z' }),
      gate({ id: 'req', observedAt: '2026-10-15T05:37:03Z' }),
    ];
    const entries = await entriesOf(FIXTURE_ROWS, FIXTURE_EVENTS, { activity });
    expect(entries.map((e) => e.gate?.what ?? e.changes.map((c) => c.field).join('+') ?? 'created')).toEqual(['description', 'resolved', 'priority+notes', 'requested', 'status+assignee', '']);
    const resolved = entries.find((e) => e.gate?.what === 'resolved')!;
    expect(resolved).toMatchObject({ actor: 'Claude Code', gate: { byPanel: false } });
  });

  it('a gate entry is a whole entry for paging', async () => {
    const activity = [gate({ id: 'req', observedAt: '2026-10-15T05:37:03Z' })];
    const first = await readHistory(readFrom(FIXTURE_ROWS, FIXTURE_EVENTS), { ...BASE, activity, pageSize: 3 });
    expect(first.entries.map((e) => e.id.slice(0, 8))).toEqual(['7qigkt99', '2pr5afof', 'gate:req']);
    const second = await readHistory(readFrom(FIXTURE_ROWS, FIXTURE_EVENTS), { ...BASE, activity, pageSize: 3, before: 'gate:req' });
    expect(second.entries.map((e) => e.id.slice(0, 8))).toEqual(['e3idem82', 'icns64h8']);
  });
});

describe('gate entries from the gates own audit events', () => {
  const gateRow = (over: Partial<Bead> = {}): Bead => ({
    id: 'pl-gate', title: 'Gate: human', status: 'closed', priority: 2, type: 'gate', assignee: null, labels: [], parentId: null,
    description: 'Ad-hoc gate blocking pl-2n0\n\nReason: Review before closing', design: '', acceptance: '', notes: '',
    createdAt: '2026-10-15T05:37:05Z', createdBy: 'Ann (panel)', updatedAt: '2026-10-15T05:37:11Z', closedAt: '2026-10-15T05:37:11Z', closeReason: 'Reviewed',
    dependencies: [], comments: [], extra: { await_type: 'human' }, ...over,
  });
  const audit = (over: Partial<AuditEvent>): AuditEvent => ({
    id: 'u1', beadId: 'pl-gate', type: 'created', actor: 'Ann (panel)', oldValue: '', newValue: '', rawCreatedAt: '2026-10-15T05:37:05Z', utcCreatedAt: true, ...over,
  });
  const read = (over: Partial<GateAuditRead> = {}): GateAuditRead => ({
    rows: [gateRow()],
    events: [audit({ id: 'u2', type: 'closed', actor: 'Claude Code', newValue: 'Reviewed', rawCreatedAt: '2026-10-15 05:37:11' }), audit({})],
    ...over,
  });

  it('names who asked and who resolved, at the time the audit log recorded', () => {
    const { entries, covered } = gateAuditEntries(read(), 'Ann (panel)');
    expect(entries.map((e) => [e.id, e.at, e.actor, e.gate])).toEqual([
      ['gate:pl-gate:resolved', '2026-10-15T05:37:11.000Z', 'Claude Code', { gateId: 'pl-gate', what: 'resolved', gateKind: 'human', reason: 'Review before closing', byPanel: false }],
      ['gate:pl-gate:requested', '2026-10-15T05:37:05.000Z', 'Ann (panel)', { gateId: 'pl-gate', what: 'requested', gateKind: 'human', reason: 'Review before closing', byPanel: true }],
    ]);
    expect([...covered]).toEqual(['pl-gate']);
  });

  it('a gate event from 1.2.2 (local time, not marked UTC) is not dated 7 hours early: the gate row gives the time', () => {
    const stale = (over: Partial<AuditEvent>) => audit({ id: '2eed598c-6d7e-551f-929a-1a116d4fe4d4', rawCreatedAt: '2026-10-14T22:37:05Z', utcCreatedAt: undefined, ...over });
    const { entries } = gateAuditEntries(read({ events: [stale({ id: 'a1b2c3d4-6d7e-551f-929a-1a116d4fe4d4', type: 'closed', actor: 'Claude Code', rawCreatedAt: '2026-10-14T22:37:11Z' }), stale({})] }), 'Ann (panel)');
    expect(entries.map((e) => [e.gate?.what, e.at, e.actor])).toEqual([['resolved', '2026-10-15T05:37:11Z', 'Claude Code'], ['requested', '2026-10-15T05:37:05Z', 'Ann (panel)']]);
  });

  it('an open gate has only its request; unreadable audit events fall back to the gate row', () => {
    expect(gateAuditEntries(read({ rows: [gateRow({ status: 'open', closedAt: null })] }), 'Ann (panel)').entries.map((e) => e.gate?.what)).toEqual(['requested']);
    const { entries } = gateAuditEntries(read({ events: null }), 'Ann (panel)');
    expect(entries.map((e) => [e.gate?.what, e.at, e.actor])).toEqual([['resolved', '2026-10-15T05:37:11Z', null], ['requested', '2026-10-15T05:37:05Z', 'Ann (panel)']]);
  });

  it('shows a resolved review with its actor when the activity ring no longer holds it, in time order among the versions', async () => {
    // Requested before the priority change (:05 < :10), resolved after the description change (:12 < :13).
    const gateRead = read({
      events: [audit({ id: 'u2', type: 'closed', actor: 'Claude Code', rawCreatedAt: '2026-10-15 05:37:13' }), audit({ rawCreatedAt: '2026-10-15 05:37:05' })],
      rows: [gateRow({ closedAt: '2026-10-15T05:37:13Z' })],
    });
    const result = await readHistory(readFrom(FIXTURE_ROWS, FIXTURE_EVENTS), { ...BASE, activity: [], gateRead, panelActor: 'Tester (panel)' });
    expect(result.entries.map((e) => e.gate?.what ?? e.changes.map((c) => c.field).join('+'))).toEqual(['resolved', 'description', 'priority+notes', 'requested', 'status+assignee', '']);
    expect(result.entries[0]).toMatchObject({ actor: 'Claude Code', gate: { byPanel: false } });
  });

  it('an activity row for a gate the audit log covers is not shown twice; an unlinked or deleted one still is', async () => {
    const row = (over: Partial<ChangeEvent>): ChangeEvent => ({ id: 'r', beadId: 'pl-2n0', kind: 'gate_opened', gateId: 'pl-gate', actor: 'x', byPanel: false, observedAt: '2026-10-15T05:37:20Z', ...over });
    const activity = [row({ id: 'dup1' }), row({ id: 'dup2', kind: 'gate_resolved' }), row({ id: 'gone', kind: 'gate_resolved', ended: 'unlinked' }), row({ id: 'other', gateId: 'pl-other' })];
    const result = await readHistory(readFrom(FIXTURE_ROWS, FIXTURE_EVENTS), { ...BASE, activity, gateRead: read(), panelActor: '' });
    const ids = result.entries.filter((e) => e.gate).map((e) => e.id);
    expect(ids.filter((id) => id.startsWith('gate:pl-gate'))).toHaveLength(2);
    expect(ids).toContain('gate:gone');
    expect(ids).toContain('gate:other'); // a gate the audit log knows nothing of keeps its observed row
    expect(ids).not.toContain('gate:dup1');
    expect(ids).not.toContain('gate:dup2');
  });
});

describe('buildHistory', () => {
  it('rejects output that is not a list of versions', () => {
    expect(() => buildHistory({ rows: { oops: true }, events: null }, { readLimit: 200, currentLabels: [] })).toThrow(/history/i);
  });
});
