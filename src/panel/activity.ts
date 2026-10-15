import type { Bead, ChangeEvent, JsonValue, StatusDef } from '../shared/types';
import { isKnownLinkKind, kindLabel, recordedDay } from './detail';
import { ago, dayText, fullText, isDateOnly, recordedDate } from './format';
import { humanize, looker, markerOf, shortId, statusLabel, type Look, type Marker } from './list';

export type ActivityEvent = ChangeEvent & { unseen: boolean };

/** What the entry's leading mark draws: a status dot for status moves, otherwise an icon for the kind of change. */
export type EntryMark = { kind: 'status'; look: Look; marker: Marker } | { kind: 'created' | 'deleted' | 'comment' | 'link' | 'edit' };

/** One line of the feed, ready to draw. `gone`: the bead is no longer in the project, so there is no detail to open. */
export type FeedEntry = {
  event: ActivityEvent;
  what: string;
  mark: EntryMark;
  short: string;
  title: string | null;
  gone: boolean;
  who: string;
  /** The full time, or why only the day is known. */
  whenTitle: string;
};

export type FeedDay = { key: string; label: string; entries: FeedEntry[] };

export type FeedInput = {
  /** Newest first, as the service sends it. */
  activity: ActivityEvent[];
  beads: Bead[];
  statuses: StatusDef[];
  query: string;
  /** Only the day of it counts (for "Today" and "Yesterday"): the feed does not change within a day. */
  now: number;
};

// ------------------------------------------------------------------------------------------------- words

const EXCERPT_MAX = 56;

/** The start of a text on one line, cut at a word and marked with "…" when there is more. */
function excerpt(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line.length <= EXCERPT_MAX) return line;
  const cut = line.slice(0, EXCERPT_MAX);
  const space = cut.lastIndexOf(' ');
  return `${(space > EXCERPT_MAX * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** "a", "a and b", "a, b and c". */
const listWords = (items: string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

const TEXT_FIELDS: Record<string, string> = { description: 'Description', design: 'Design', acceptance: 'Acceptance criteria', notes: 'Notes' };

const isText = (v: JsonValue | undefined): v is string => typeof v === 'string';
const strings = (v: JsonValue | undefined): string[] | null => (Array.isArray(v) && v.every(isText) ? (v as string[]) : null);
const priorityWord = (v: JsonValue | undefined) => (typeof v === 'number' ? `P${v}` : 'none');

function fieldWhat(e: ChangeEvent, statuses: StatusDef[]): string {
  const { field = '', from, to } = e;
  const text = TEXT_FIELDS[field];
  if (text) {
    if (to === '') return `${text} cleared`;
    return isText(to) && to.trim() ? `${text} edited: ${excerpt(to)}` : `${text} edited`;
  }
  switch (field) {
    case 'status': {
      if (!isText(to)) return 'Status changed';
      const label = (s: string) => statusLabel(s, statuses);
      return isText(from) && from ? `Status: ${label(from)} → ${label(to)}` : `Status: ${label(to)}`;
    }
    case 'priority':
      if (to === undefined) return 'Priority changed';
      return typeof from === 'number' ? `Priority: ${priorityWord(from)} → ${priorityWord(to)}` : `Priority: ${priorityWord(to)}`;
    case 'title':
      return 'Title changed';
    case 'assignee':
      if (to === undefined) return 'Assignee changed';
      return isText(to) && to ? `Assigned to ${to}` : 'Unassigned';
    case 'labels': {
      const before = strings(from);
      const after = strings(to);
      if (!before || !after) return 'Labels changed';
      const added = after.filter((l) => !before.includes(l));
      const removed = before.filter((l) => !after.includes(l));
      const parts = [added.length ? `added ${listWords(added)}` : '', removed.length ? `removed ${listWords(removed)}` : ''].filter(Boolean);
      return parts.length ? `Labels: ${parts.join(', ')}` : 'Labels changed';
    }
    case 'type':
      if (!isText(to)) return 'Type changed';
      return isText(from) && from ? `Type: ${humanize(from)} → ${humanize(to)}` : `Type: ${humanize(to)}`;
    case 'parentId':
      if (isText(to) && to) return `Moved under ${shortId(to)}`;
      return to === undefined ? 'Parent changed' : 'Removed from its parent';
    case 'closeReason':
      if (isText(to) && to.trim()) return `Close reason: ${excerpt(to)}`;
      return to === undefined ? 'Close reason changed' : 'Close reason cleared';
    case '':
      return 'Changed';
    default:
      return `${humanize(field)} changed`;
  }
}

/**
 * A link kind in words, read from the bead that holds the link (it depends on the other one): "blocked by",
 * "related to", "discovered from". Kinds the panel does not know keep their raw name.
 */
function linkWords(kind: string): string {
  if (kind === 'related' || kind === 'relates-to') return 'related to';
  return isKnownLinkKind(kind) ? kindLabel(kind, 'out').toLowerCase() : kind;
}

/** One change in words: "Status: Open → Blocked", "Labels: added urgent, removed old", "Commented: <first words>", "Link added: blocked by x9". */
export function changeWhat(e: ChangeEvent, statuses: StatusDef[]): string {
  switch (e.kind) {
    case 'created':
      return 'Created';
    case 'deleted':
      return 'Deleted';
    case 'reopened':
      return 'Reopened';
    case 'closed': {
      // A project's own done status says which one; plain "closed" needs no more.
      const as = isText(e.to) && e.to && e.to !== 'closed' ? ` as ${statusLabel(e.to, statuses)}` : '';
      return `Closed${as}${e.reason ? ` · ${excerpt(e.reason)}` : ''}`;
    }
    case 'comment':
      return isText(e.to) && e.to.trim() ? `Commented: ${excerpt(e.to)}` : 'Commented';
    case 'dep_added':
    case 'dep_removed': {
      const other = e.kind === 'dep_added' ? e.to : e.from;
      const id = isText(other) && other ? shortId(other) : '';
      const head = e.kind === 'dep_added' ? 'Link added' : 'Link removed';
      const words = e.field ? linkWords(e.field) : '';
      return `${head}: ${[words, id].filter(Boolean).join(' ') || 'unknown link'}`;
    }
    case 'field':
      return fieldWhat(e, statuses);
  }
  return humanize(String(e.kind));
}

/** Who made it: "you (panel)" for this panel's own writes, the recorded name, or "unknown". */
export const whoOf = (e: ChangeEvent): string => (e.byPanel ? 'you (panel)' : (e.actor ?? 'unknown'));

const atOf = (e: ChangeEvent): string => e.changedAt ?? e.observedAt;

/** "5m ago" from when it was made (or seen); for history, only the day (a bare date as written, a real time's local day). */
export function whenOf(e: ChangeEvent, now: number): string {
  const at = atOf(e);
  if (e.historical) return recordedDay(at, now);
  const t = Date.parse(at);
  return Number.isFinite(t) ? ago(now - t) : at;
}

function whenTitle(e: ChangeEvent): string {
  const at = atOf(e);
  if (e.historical && isDateOnly(at)) return "From Beads' history. Only the day is known.";
  const date = recordedDate(at);
  if (!date) return at;
  const full = fullText(date);
  return e.changedAt || e.historical ? full : `${full}, when the panel saw it`;
}

function markOf(e: ChangeEvent, look: (status: string) => Look): EntryMark {
  switch (e.kind) {
    case 'created':
    case 'deleted':
    case 'comment':
      return { kind: e.kind };
    case 'dep_added':
    case 'dep_removed':
      return { kind: 'link' };
    case 'closed':
      return { kind: 'status', look: 'done', marker: isText(e.to) ? markerOf(e.to) : 'builtin' };
    case 'reopened':
      return isText(e.to) ? { kind: 'status', look: look(e.to), marker: markerOf(e.to) } : { kind: 'status', look: 'open', marker: 'builtin' };
    default:
      return e.field === 'status' && isText(e.to) ? { kind: 'status', look: look(e.to), marker: markerOf(e.to) } : { kind: 'edit' };
  }
}

// ------------------------------------------------------------------------------------------------- days

const pad = (n: number) => String(n).padStart(2, '0');
const localKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The day an entry belongs to, as a sortable key and its date: a bare date as written, a real time by its local day. */
function dayOf(e: ChangeEvent): { key: string; date: Date } | null {
  const date = recordedDate(atOf(e));
  return date ? { key: localKey(date), date } : null;
}

function dayLabel(key: string, date: Date, now: number): string {
  const today = new Date(now);
  if (key === localKey(today)) return 'Today';
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (key === localKey(yesterday)) return 'Yesterday';
  return dayText(date, now);
}

// ------------------------------------------------------------------------------------------------- feed

const valueText = (v: JsonValue | undefined): string => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Everything search looks through: what the entry shows, and the whole of what it shortens (values, reason, the name as recorded). */
function searchText({ event, title, who, what }: FeedEntry): string {
  return [event.beadId, title ?? '', who, event.actor ?? '', what, event.field ?? '', valueText(event.from), valueText(event.to), event.reason ?? '', event.title ?? '']
    .join('\n')
    .toLowerCase();
}

/**
 * The Activity feed: every change, newest first by when it was made, consecutive ones grouped by day, narrowed by search
 * over the bead's id and title, who made it, and what changed. A bead no longer in the project goes by the title its
 * deletion recorded (null when that deletion predates recorded titles).
 */
export function activityFeed({ activity, beads, statuses, query, now }: FeedInput): FeedDay[] {
  const byId = new Map(beads.map((b) => [b.id, b]));
  const deletedTitles = new Map<string, string>();
  for (const e of activity) if (e.kind === 'deleted' && typeof e.title === 'string' && !deletedTitles.has(e.beadId)) deletedTitles.set(e.beadId, e.title);
  const look = looker(statuses);
  const q = query.trim().toLowerCase();
  const days: FeedDay[] = [];
  // A catch-up or a Sync brings changes in the order they were found: put them in the order they were made (the sort is
  // stable, so the service's order breaks ties), with anything that has no readable time last.
  const timed = activity.map((event) => ({ event, at: recordedDate(atOf(event))?.getTime() ?? -Infinity }));
  timed.sort((a, b) => (a.at === b.at ? 0 : b.at - a.at));
  for (const { event } of timed) {
    const bead = byId.get(event.beadId);
    const entry: FeedEntry = {
      event,
      what: changeWhat(event, statuses),
      mark: markOf(event, look),
      short: shortId(event.beadId),
      title: bead ? bead.title : (deletedTitles.get(event.beadId) ?? null),
      gone: !bead,
      who: whoOf(event),
      whenTitle: whenTitle(event),
    };
    if (q && !searchText(entry).includes(q)) continue;
    const day = dayOf(event);
    const key = day?.key ?? 'unknown';
    const last = days[days.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else days.push({ key, label: day ? dayLabel(key, day.date, now) : 'Unknown day', entries: [entry] });
  }
  return days;
}
