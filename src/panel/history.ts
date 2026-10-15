import type { Bead, BeadPatch, ExpectedFields, HistoryChange, HistoryEntry, JsonValue } from '../shared/types';
import { dayText } from './format';

/** The fields a history change can put back: the panel's own names, which are also `BeadPatch` and `ExpectedFields` keys. */
export const RESTORABLE_FIELDS = ['title', 'status', 'priority', 'assignee', 'labels', 'description', 'design', 'acceptance', 'notes'] as const;
type Restorable = (typeof RESTORABLE_FIELDS)[number];

const isRestorable = (field: string): field is Restorable => (RESTORABLE_FIELDS as readonly string[]).includes(field);

/** What the `update` route takes for a restore: the bead, the time the panel saw it, the old value, and the value the change left. */
export type RestoreRequest = { id: string; expectedUpdatedAt: string; patch: BeadPatch; expected: ExpectedFields };

const isStrings = (value: JsonValue): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

/** A history value in the type the field takes, or undefined when it is not one (never sent). */
function typed(field: Restorable, value: JsonValue): BeadPatch[Restorable] | undefined {
  switch (field) {
    case 'priority':
      return typeof value === 'number' ? value : undefined;
    case 'assignee':
      return value === null || typeof value === 'string' ? value : undefined;
    case 'labels':
      return isStrings(value) ? value : undefined;
    default:
      return typeof value === 'string' ? value : undefined;
  }
}

/**
 * The write that puts a change's old value back, or null when the change can never be restored (a long text cut for transport, a
 * field the panel does not write, a value of the wrong kind). `expected` is the value the change produced: if the field changed
 * again since, the service refuses it as a conflict and nothing is overwritten. `bead` is the copy the panel holds now, so its
 * `updatedAt` is the time the person is looking at (never the history entry's).
 */
export function restoreRequest(bead: Bead, change: HistoryChange): RestoreRequest | null {
  if (change.truncated || !isRestorable(change.field)) return null;
  const from = typed(change.field, change.from);
  const to = typed(change.field, change.to);
  if (from === undefined || to === undefined) return null;
  return { id: bead.id, expectedUpdatedAt: bead.updatedAt, patch: { [change.field]: from } as BeadPatch, expected: { [change.field]: to } as ExpectedFields };
}

/**
 * Where a restore stands against the bead as the panel holds it now:
 *  - `ready`: the field still holds what the change produced, so putting the old value back is safe.
 *  - `changed`: it was changed again since; a restore would be refused, and the current value is what to show.
 *  - `unchanged`: it already holds the old value.
 *  - `never`: this change cannot be restored.
 */
export type RestoreState = 'ready' | 'changed' | 'unchanged' | 'never';

const same = (field: Restorable, a: unknown, b: JsonValue): boolean => {
  if (field === 'labels') return Array.isArray(a) && isStrings(b) && [...(a as string[])].sort().join('\n') === [...b].sort().join('\n') && a.length === b.length;
  return a === b;
};

export function restoreState(bead: Bead, change: HistoryChange): RestoreState {
  if (restoreRequest(bead, change) === null) return 'never';
  const field = change.field as Restorable;
  const current = bead[field];
  if (same(field, current, change.from)) return 'unchanged';
  return same(field, current, change.to) ? 'ready' : 'changed';
}

/**
 * The same change, as it stands against `current`: it would put the old value back over the value the bead holds now. A restore
 * built from it expects exactly what the person was shown, so it can never overwrite something they have not seen.
 */
export function freshChange(current: Bead, change: HistoryChange): HistoryChange {
  const value = current[change.field as Restorable] as JsonValue | undefined;
  return value === undefined ? change : { ...change, to: value };
}

// ------------------------------------------------------------------------------------------------- text diff

/** One row of a compact diff: a line kept, added or removed, or a run of unchanged lines folded into a count. */
export type DiffRow = { kind: 'same' | 'add' | 'del'; text: string } | { kind: 'skip'; count: number };

/** Past this many line pairs, the changed middle is shown as removed then added instead of matched line by line. */
const DIFF_CELLS = 40_000;

/**
 * The lines of `to` against `from`: common lines at the start and end are matched first, then the middle line by line (when it
 * is small enough). Unchanged runs keep `context` lines next to each change; the rest fold into one "N unchanged lines" row.
 */
export function lineDiff(from: string, to: string, context = 1): DiffRow[] {
  const a = from === '' ? [] : from.split('\n');
  const b = to === '' ? [] : to.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const rows: Array<{ kind: 'same' | 'add' | 'del'; text: string }> = a.slice(0, head).map((text) => ({ kind: 'same', text }));
  if (midA.length * midB.length > DIFF_CELLS) {
    rows.push(...midA.map((text) => ({ kind: 'del' as const, text })), ...midB.map((text) => ({ kind: 'add' as const, text })));
  } else {
    // Longest common subsequence, read forward.
    const n = midA.length;
    const m = midB.length;
    const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = midA[i] === midB[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        rows.push({ kind: 'same', text: midA[i]! });
        i++;
        j++;
      } else if (i < n && (j >= m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) rows.push({ kind: 'del', text: midA[i++]! });
      else rows.push({ kind: 'add', text: midB[j++]! });
    }
  }
  rows.push(...a.slice(a.length - tail).map((text) => ({ kind: 'same' as const, text })));

  // Fold unchanged runs, keeping `context` lines beside each change.
  const out: DiffRow[] = [];
  let k = 0;
  while (k < rows.length) {
    if (rows[k]!.kind !== 'same') {
      out.push(rows[k++]!);
      continue;
    }
    let end = k;
    while (end < rows.length && rows[end]!.kind === 'same') end++;
    const keepBefore = k === 0 ? 0 : context;
    const keepAfter = end === rows.length ? 0 : context;
    if (end - k <= keepBefore + keepAfter + 1) out.push(...rows.slice(k, end));
    else out.push(...rows.slice(k, k + keepBefore), { kind: 'skip', count: end - k - keepBefore - keepAfter }, ...rows.slice(end - keepAfter, end));
    k = end;
  }
  return out;
}

export type DayGroup = { key: string; label: string; entries: HistoryEntry[] };

const DAY_MS = 86_400_000;
const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * Entries (newest first, as the service lists them) grouped by their local day, in the order given: "Today", "Yesterday", then
 * "Oct 2" (with the year when it is not this one). An entry whose time is not a time joins the group before it.
 */
export function groupByDay(entries: HistoryEntry[], now: number): DayGroup[] {
  const groups: DayGroup[] = [];
  const today = startOfDay(new Date(now));
  for (const entry of entries) {
    const at = new Date(entry.at);
    const valid = Number.isFinite(at.getTime());
    const last = groups[groups.length - 1];
    if (!valid && last) {
      last.entries.push(entry);
      continue;
    }
    const day = valid ? startOfDay(at) : NaN;
    const key = valid ? `${at.getFullYear()}-${at.getMonth() + 1}-${at.getDate()}` : 'unknown';
    if (last && last.key === key) {
      last.entries.push(entry);
      continue;
    }
    const label = !valid ? 'Earlier' : day === today ? 'Today' : day === today - DAY_MS ? 'Yesterday' : dayText(at, now);
    groups.push({ key, label, entries: [entry] });
  }
  return groups;
}
