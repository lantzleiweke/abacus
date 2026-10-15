import type { Bead, ChangeEvent, Dependency, JsonValue, Related, StatusDef } from '../shared/types';
import { ago, dayText, recordedDate, timeText } from './format';
import { compareIds, humanize, looker, statusLabel, type Look } from './list';

const DAY_MS = 86_400_000;

// ------------------------------------------------------------------------------------------------- time

/**
 * A real timestamp (ISO with zone) for reading: "9m ago" within the past day, otherwise "Oct 13, 5:02 PM". Text that is
 * not a timestamp comes back as it is.
 */
export function when(text: string, now: number): string {
  const at = Date.parse(text);
  if (!Number.isFinite(at)) return text;
  if (at <= now && now - at < DAY_MS) return ago(now - at);
  const date = new Date(at);
  return `${dayText(date, now)}, ${timeText(date)}`;
}

/** The day of a recorded time: a bare date as written, a real time by its local day. Text that is not a time comes back as it is. */
export function recordedDay(text: string, now: number): string {
  const date = recordedDate(text);
  return date ? dayText(date, now) : text;
}

/** A link's recorded time. Beads writes local time marked as UTC, so it is shown as written, never converted. */
export function depTime(text: string | null): string | null {
  if (!text) return null;
  return text.replace('T', ' ').replace(/(\.\d+)?Z$/, '');
}

// ------------------------------------------------------------------------------------------------- people

/** A recorded name as shown: "you (panel)" for the panel's own, "unknown" when none was recorded. */
export function personName(name: string | null, panel: string | null): string {
  if (!name) return 'unknown';
  return panel !== null && name === panel ? 'you (panel)' : name;
}

const changeActor = (e: ChangeEvent): string => (e.byPanel ? 'you (panel)' : (e.actor ?? 'unknown'));

// ------------------------------------------------------------------------------------------------- changes

/** The newest change to this bead the user has not seen (activity is newest first). */
export function latestUnseenChange<E extends ChangeEvent & { unseen: boolean }>(id: string, activity: E[]): E | null {
  return activity.find((e) => e.beadId === id && e.unseen) ?? null;
}

/** A status as a word inside a sentence: "in progress", "in review", "QA wait", unknown ones raw. */
function statusWord(status: string, statuses: StatusDef[]): string {
  const label = statusLabel(status, statuses);
  return /^[A-Z][a-z]/.test(label) ? label[0]!.toLowerCase() + label.slice(1) : label;
}

const priorityText = (value: JsonValue | undefined): string => (typeof value === 'number' ? `P${value}` : 'none');
const nameText = (value: JsonValue | undefined): string => (typeof value === 'string' && value ? value : 'nobody');

/** Dependency kinds and how each reads from the bead that holds the link (`out`) and from the other side (`in`). */
const KINDS: Record<string, { out: string; in: string; tone?: 'blocked' }> = {
  blocks: { out: 'Blocked by', in: 'Blocks', tone: 'blocked' },
  related: { out: 'Related', in: 'Related' },
  'relates-to': { out: 'Related', in: 'Related' },
  'discovered-from': { out: 'Discovered from', in: 'Led to' },
  tracks: { out: 'Tracks', in: 'Tracked by' },
  'caused-by': { out: 'Caused by', in: 'Caused' },
  validates: { out: 'Validates', in: 'Validated by' },
  supersedes: { out: 'Supersedes', in: 'Superseded by' },
};

/** Whether the detail view names this link kind. Own keys only, so "constructor" is not known. */
export const isKnownLinkKind = (kind: string): boolean => Object.hasOwn(KINDS, kind);

/** A link kind as a heading, from the side `direction` says. Unknown kinds keep their name. */
export function kindLabel(kind: string, direction: 'out' | 'in'): string {
  const known = KINDS[kind];
  if (known) return known[direction];
  const name = humanize(kind || 'link');
  return direction === 'out' ? name : `${name} (incoming)`;
}

/** What the banner says: who and when (`lead`), then what, with the new status set apart. */
export type ChangeLine = { lead: string; what: string | null; from?: string; to?: string; toLook?: Look };

/** One change in words, for the "changed since you last looked" banner. */
export function changeLine(e: ChangeEvent, statuses: StatusDef[], now: number): ChangeLine {
  const at = e.changedAt ?? e.observedAt;
  const time = e.historical ? `on ${recordedDay(at, now)}` : when(at, now);
  const by = `${time} by ${changeActor(e)}`;
  switch (e.kind) {
    case 'created':
      return { lead: `Created ${by}`, what: null };
    case 'closed':
      return { lead: `Closed ${by}`, what: e.reason ?? null };
    case 'reopened':
      return { lead: `Reopened ${by}`, what: null, ...(typeof e.to === 'string' ? { from: statusWord(String(e.from ?? ''), statuses), to: statusWord(e.to, statuses), toLook: looker(statuses)(e.to) } : {}) };
    case 'comment':
      return { lead: `New comment ${by}`, what: null };
    case 'deleted':
      return { lead: `Deleted ${by}`, what: null };
    case 'dep_added':
      return { lead: `Link added ${by}`, what: `${kindLabel(e.field ?? '', 'out').toLowerCase()} ${String(e.to ?? '')}`.trim() };
    case 'dep_removed':
      return { lead: `Link removed ${by}`, what: `${kindLabel(e.field ?? '', 'out').toLowerCase()} ${String(e.from ?? '')}`.trim() };
    case 'field':
      break;
  }
  const lead = `Changed ${by}`;
  switch (e.field) {
    case 'status': {
      const to = String(e.to ?? '');
      return { lead, what: null, from: statusWord(String(e.from ?? ''), statuses), to: statusWord(to, statuses), toLook: looker(statuses)(to) };
    }
    case 'priority':
      return { lead, what: `priority ${priorityText(e.from)} → ${priorityText(e.to)}` };
    case 'assignee':
      return { lead, what: `assignee ${nameText(e.from)} → ${nameText(e.to)}` };
    case 'closeReason':
      return { lead, what: 'close reason edited' };
    default:
      return { lead, what: e.field ? `${humanize(e.field).toLowerCase()} edited` : null };
  }
}

/** The banner as one line of text. */
export function changeText(line: ChangeLine): string {
  if (line.to !== undefined) return `${line.lead}: ${line.from} → ${line.to}`;
  return line.what ? `${line.lead}: ${line.what}` : line.lead;
}

// ------------------------------------------------------------------------------------------------- closing

/** The newest `closed` change for this bead. */
const lastClose = (id: string, activity: ChangeEvent[]) => activity.find((e) => e.beadId === id && e.kind === 'closed');

/**
 * Why a done bead was closed: its own close reason, or for a custom done status (where Beads keeps none on the bead)
 * the reason on the newest `closed` change. Null for a bead that is not done.
 */
export function closeReason(bead: Bead, activity: ChangeEvent[], statuses: StatusDef[]): string | null {
  if (looker(statuses)(bead.status) !== 'done') return null;
  return bead.closeReason ?? lastClose(bead.id, activity)?.reason ?? null;
}

/**
 * When a done bead closed: its own close time, or the newest `closed` change's time. `historical` means the time came
 * from the audit log, where it is local time marked as UTC (or just a date): show its day as written, nothing finer.
 */
export function closedAt(bead: Bead, activity: ChangeEvent[], statuses: StatusDef[]): { at: string; historical: boolean } | null {
  if (looker(statuses)(bead.status) !== 'done') return null;
  if (bead.closedAt) return { at: bead.closedAt, historical: false };
  const e = lastClose(bead.id, activity);
  return e ? { at: e.changedAt ?? e.observedAt, historical: e.historical === true } : null;
}

// ------------------------------------------------------------------------------------------------- relationships

export type RelItem = { id: string; bead: Bead | null; dep: Dependency | null };
export type RelGroup = { key: string; label: string; tone?: 'blocked'; items: RelItem[] };

/** Fixed order for the kinds the panel names; other kinds follow by name. */
const GROUP_ORDER = ['blocks-out', 'blocks-in', 'related', 'discovered-from-out', 'discovered-from-in', 'tracks-out', 'tracks-in'];

/**
 * Parent, children, then each kind of link in each direction (related links both ways in one group). `parentId` keeps a
 * parent the project no longer has, by its id.
 */
export function relationGroups(related: Related, parentId: string | null = null): RelGroup[] {
  const groups: RelGroup[] = [];
  if (related.parent) groups.push({ key: 'parent', label: 'Parent', items: [{ id: related.parent.id, bead: related.parent, dep: null }] });
  else if (parentId) groups.push({ key: 'parent', label: 'Parent', items: [{ id: parentId, bead: null, dep: null }] });
  if (related.children.length) {
    const children = [...related.children].sort((a, b) => compareIds(a.id, b.id));
    groups.push({ key: 'children', label: 'Children', items: children.map((b) => ({ id: b.id, bead: b, dep: null })) });
  }

  const byKey = new Map<string, RelGroup>();
  for (const { dep, other, direction } of related.deps) {
    const known = KINDS[dep.kind];
    const label = kindLabel(dep.kind, direction);
    const key = label === 'Related' ? 'related' : `${dep.kind}-${direction}`;
    let group = byKey.get(key);
    if (!group) {
      group = { key, label, ...(known?.tone && direction === 'out' ? { tone: known.tone } : {}), items: [] };
      byKey.set(key, group);
    }
    const id = direction === 'out' ? dep.to : dep.from;
    // A related link is often recorded on both beads; it is one relationship.
    if (key === 'related' && group.items.some((i) => i.id === id)) continue;
    group.items.push({ id, bead: other, dep });
  }
  const rank = (key: string) => {
    const i = GROUP_ORDER.indexOf(key);
    return i < 0 ? GROUP_ORDER.length : i;
  };
  const deps = [...byKey.values()].sort((a, b) => rank(a.key) - rank(b.key) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return [...groups, ...deps];
}

/** Of a read copy and the list's copy, the one Beads updated last (the read one on a tie: it has fresh comments). */
export function newerBead(read: Bead | null, listed: Bead | null): Bead | null {
  if (!read || !listed) return read ?? listed;
  return Date.parse(listed.updatedAt) > Date.parse(read.updatedAt) ? listed : read;
}

/**
 * Changes whenever what the detail shows of a bead changes: its update time, its fields (Beads stamps the time to the
 * second, so a change in the same second keeps it), comments, or links.
 */
export function beadSignature(b: Bead): string {
  const fields = JSON.stringify([b.title, b.status, b.priority, b.assignee, b.labels, b.parentId, b.description, b.design, b.acceptance, b.notes, b.closeReason, b.extra]);
  return `${b.updatedAt}|${fields}|${b.comments.map((c) => c.id).join(',')}|${b.dependencies.map((d) => `${d.kind}>${d.to}`).sort().join(',')}`;
}

// ------------------------------------------------------------------------------------------------- more

/** `group`: an object field's own row, heading the rows of its keys; `sub`: one of those keys (listed under it). */
export type MoreField = { key: string; label: string; value: string; title?: string; code?: boolean; group?: boolean; sub?: boolean };

const FIELD_LABELS: Record<string, string> = {
  estimated_minutes: 'Estimate',
  external_ref: 'External ref',
  due_at: 'Due',
  started_at: 'Started',
  defer_until: 'Defer until',
};

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function minutesText(n: number): string {
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const isScalar = (v: JsonValue): v is string | number | boolean => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const scalarText = (v: string | number | boolean) => (v === true ? 'Yes' : v === false ? 'No' : String(v));

/** One value for reading: times formatted (raw in the tooltip), lists joined, anything nested as compact JSON. */
function valueField(key: string, label: string, value: JsonValue, now: number): MoreField {
  if (typeof value === 'string' && ISO_TIME.test(value)) return { key, label, value: when(value, now), title: value };
  if (value !== null && isScalar(value)) return { key, label, value: scalarText(value) };
  if (Array.isArray(value) && value.every((v) => v !== null && isScalar(v))) return { key, label, value: value.map((v) => scalarText(v as string | number | boolean)).join(', ') };
  return { key, label, value: JSON.stringify(value), code: true };
}

/**
 * Every field Beads keeps that has no place of its own, named and written for reading. An object field (custom
 * metadata) gets a row of its own followed by one row per key, under the key's own name. Nothing is dropped.
 */
export function moreFields(extra: Record<string, JsonValue>, now: number = Date.now()): MoreField[] {
  return Object.entries(extra).flatMap(([key, value]): MoreField[] => {
    const label = FIELD_LABELS[key] ?? humanize(key);
    if (key === 'estimated_minutes' && typeof value === 'number' && Number.isInteger(value) && value >= 0) return [{ key, label, value: minutesText(value), title: `${value} minutes` }];
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0) {
      return [{ key, label, value: '', group: true }, ...Object.entries(value).map(([k, v]) => ({ ...valueField(`${key}.${k}`, k, v, now), sub: true }))];
    }
    return [valueField(key, label, value, now)];
  });
}

// ------------------------------------------------------------------------------------------------- acceptance

const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;

/** Acceptance criteria written as a markdown list, as items (checked ones `done`); null when it is not just a list. */
export function acceptanceItems(text: string): Array<{ text: string; done: boolean }> | null {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return null;
  const items: Array<{ text: string; done: boolean }> = [];
  for (const line of lines) {
    const m = ITEM.exec(line);
    if (!m) return null;
    items.push({ text: m[2]!.trim(), done: m[1] === 'x' || m[1] === 'X' });
  }
  return items;
}
