import type { Bead, ChangeEvent, HistoryChange, HistoryEntry, HistoryGate, HistoryResult, JsonValue } from '../shared/types';
import { eventTimeMs, isUtcStamp, type AuditEvent as StoredAuditEvent } from './bd/audit';
import { BdError } from './bd/exec';
import { toGate } from './gates';

/** What one read of a bead's past gives: the versions (`bd history`) and, from bd 1.3, the audit events. `rows` is null for an unknown id; `events` is null when not read or unreadable. */
export type HistoryRead = { rows: unknown; events: unknown | null; /** From when the store's event stamps are real UTC (`readUtcSince`); absent or null when unknown, and then no stamp is dated. */ utcSince?: number | null };

/** The first read asks for this many versions; a page that needs older ones widens it (doubling) up to `MAX_READ`. */
export const FIRST_READ = 200;
export const MAX_READ = 1000;
/** A long text is cut to this many characters for transport, flagged, and never offered for restore. */
export const TEXT_MAX = 20_000;

type Obj = Record<string, unknown>;
type Version = { hash: string; index: number; at: string; issue: Obj };
/** `at` is the event's real UTC time in ms, or null when the row has none to give (a 1.2.x row's stamp is local time with no zone). */
type AuditEvent = { id: string; type: string; actor: string | null; at: number | null; atText: string; oldValue: Obj | null; newValue: Obj | null; oldRaw: unknown; newRaw: unknown; comment: string };
type Timed = { entry: HistoryEntry; time: number };

const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const timeOf = (text: string | undefined): number => {
  const ms = text === undefined ? NaN : Date.parse(text);
  return Number.isNaN(ms) ? -Infinity : ms;
};
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** Mapped to the panel's own names: a `BeadPatch` key for the fields that can be put back. */
const MAPPED: Record<string, string> = {
  title: 'title', status: 'status', priority: 'priority', assignee: 'assignee', description: 'description', design: 'design',
  acceptance_criteria: 'acceptance', notes: 'notes', issue_type: 'type',
};
const FIELD_ORDER = ['title', 'status', 'priority', 'type', 'assignee', 'description', 'design', 'acceptance', 'notes'];
const TEXT_FIELDS: ReadonlySet<string> = new Set(['description', 'design', 'acceptance', 'notes']);
const RESTORABLE: ReadonlySet<string> = new Set(['title', 'status', 'priority', 'assignee', 'description', 'design', 'acceptance', 'notes', 'labels']);
/** Bookkeeping that moves with every change, and fields filed elsewhere (labels come from the audit log, links from their own routes). */
const IGNORED: ReadonlySet<string> = new Set([
  'id', 'created_at', 'created_by', 'updated_at', 'started_at', 'closed_at', 'owner', 'labels', 'dependencies', 'dependents', 'comments',
  '_type', 'schema_version',
]);

function normalized(field: string, issue: Obj, key: string): JsonValue {
  const raw = issue[key];
  if (TEXT_FIELDS.has(field)) return typeof raw === 'string' ? raw : '';
  if (field === 'assignee') return str(raw);
  if (field === 'priority') return typeof raw === 'number' ? raw : null;
  if (field === 'title' || field === 'status' || field === 'type') return typeof raw === 'string' ? raw : '';
  return (raw ?? null) as JsonValue;
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a as Obj);
  const keysB = Object.keys(b as Obj);
  return keysA.length === keysB.length && keysA.every((key) => key in (b as Obj) && sameJson((a as Obj)[key], (b as Obj)[key]));
}

const cut = (value: JsonValue): JsonValue => (typeof value === 'string' && value.length > TEXT_MAX ? value.slice(0, TEXT_MAX) : value);
const tooLong = (value: JsonValue): boolean => typeof value === 'string' && value.length > TEXT_MAX;

/** The visible changes from `previous` to `issue`, in the panel's field order, plus the raw keys that moved. */
function diff(issue: Obj, previous: Obj): { changes: HistoryChange[]; keys: Set<string> } {
  const keys = new Set<string>();
  const found: HistoryChange[] = [];
  const allKeys = [...new Set([...Object.keys(issue), ...Object.keys(previous)])].sort();
  const statusChanged = normalized('status', issue, 'status') !== normalized('status', previous, 'status');
  for (const key of allKeys) {
    if (key !== 'updated_at' && !sameJson(issue[key], previous[key])) keys.add(key);
    if (IGNORED.has(key) || key.endsWith('_count')) continue;
    const field = MAPPED[key];
    if (field !== undefined) {
      const from = normalized(field, previous, key);
      const to = normalized(field, issue, key);
      if (from === to) continue;
      const text = TEXT_FIELDS.has(field);
      if (text && (tooLong(from) || tooLong(to))) found.push({ field, from: cut(from), to: cut(to), text, truncated: true });
      else found.push({ field, from, to, text });
    } else if (key === 'close_reason') {
      const from = str(previous[key]) ?? '';
      const to = str(issue[key]) ?? '';
      if (from !== to && !statusChanged) found.push({ field: 'closeReason', from, to, text: false });
    } else if (!sameJson(issue[key], previous[key])) {
      found.push({ field: key, from: (previous[key] ?? null) as JsonValue, to: (issue[key] ?? null) as JsonValue, text: false });
    }
  }
  const rank = (field: string) => (FIELD_ORDER.includes(field) ? FIELD_ORDER.indexOf(field) : FIELD_ORDER.length);
  found.sort((a, b) => rank(a.field) - rank(b.field)); // stable: the others stay alphabetical
  return { changes: found, keys };
}

/** A change that can be put back: a field the panel can write, not cut, and (for priority) with a value to go back to. */
const canRestore = (change: HistoryChange): boolean => RESTORABLE.has(change.field) && change.truncated !== true && !(change.field === 'priority' && change.from === null);

function parseRows(rows: unknown): Version[] {
  if (!Array.isArray(rows)) throw new BdError('parse', 'history: expected a list of versions');
  const versions: Version[] = [];
  rows.forEach((row, index) => {
    if (!isObj(row) || typeof row.CommitHash !== 'string' || !isObj(row.Issue)) return;
    const issue = row.Issue;
    versions.push({ hash: row.CommitHash, index, at: str(issue.updated_at) ?? str(row.CommitDate) ?? '', issue });
  });
  return versions;
}

function parseJsonObject(value: unknown): Obj | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isObj(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseEvents(events: unknown, utcSince: number | null): AuditEvent[] | null {
  if (!Array.isArray(events)) return null;
  const parsed: AuditEvent[] = [];
  for (const row of events) {
    if (!isObj(row) || typeof row.id !== 'string' || typeof row.event_type !== 'string') continue;
    const atText = str(row.created_at) ?? '';
    const at = eventTimeMs({ id: row.id, rawCreatedAt: atText, ...(isUtcStamp(atText, utcSince) ? { utcCreatedAt: true as const } : {}) });
    parsed.push({
      id: row.id, type: row.event_type, actor: str(row.actor), at, atText,
      oldValue: parseJsonObject(row.old_value), newValue: parseJsonObject(row.new_value), oldRaw: row.old_value, newRaw: row.new_value, comment: typeof row.comment === 'string' ? row.comment : '',
    });
  }
  return parsed;
}

/** The label a label event names: bd 1.3 writes it into the comment ("Added label: beta"). */
function labelOf(event: AuditEvent): string | null {
  const fromComment = /^(?:added|removed) label:\s*(.+)$/i.exec(event.comment.trim());
  if (fromComment) return fromComment[1]!.trim();
  return str(event.type === 'label_added' ? event.newRaw : event.oldRaw);
}

const sorted = (labels: Iterable<string>): string[] => [...new Set(labels)].sort();

/**
 * Label changes, newest first. Events inside one second by one actor are one change (bd does not order them reliably within the
 * second): its net effect, where a label both added and removed in the group is left out. The before and after sets are
 * replayed backward from the labels the bead has now.
 */
function labelEntries(events: AuditEvent[], currentLabels: string[], created: { raw: string; at: string; time: number } | null): Timed[] {
  const groups = new Map<string, { first: AuditEvent; added: Set<string>; removed: Set<string> }>();
  for (const event of events) {
    if (event.type !== 'label_added' && event.type !== 'label_removed') continue;
    const label = labelOf(event);
    if (label === null) continue;
    const key = `${event.at === null ? event.atText : Math.floor(event.at / 1000)}|${event.actor ?? ''}`;
    const group = groups.get(key) ?? { first: event, added: new Set<string>(), removed: new Set<string>() };
    (event.type === 'label_added' ? group.added : group.removed).add(label);
    groups.set(key, group);
  }
  const entries: Timed[] = [];
  let state = sorted(currentLabels);
  for (const { first, added, removed } of groups.values()) {
    const netAdded = [...added].filter((label) => !removed.has(label));
    const netRemoved = [...removed].filter((label) => !added.has(label));
    if (netAdded.length === 0 && netRemoved.length === 0) continue;
    const to = state;
    const from = sorted([...to.filter((label) => !netAdded.includes(label)), ...netRemoved]);
    state = from;
    // Without a time of its own, a label change recorded in the same second as the creation was made with it; any other has no time.
    const anchored = first.at === null && created !== null && first.atText === created.raw ? created : null;
    const at = first.at !== null ? new Date(first.at).toISOString().replace('.000Z', 'Z') : anchored?.at ?? '';
    entries.push({
      time: first.at ?? anchored?.time ?? created?.time ?? -Infinity,
      entry: { id: `labels:${first.id}`, at, actor: first.actor, changes: [{ field: 'labels', from, to, text: false }], restorable: ['labels'] },
    });
  }
  return entries;
}

/** Empty and absent read alike: bd leaves empty fields out of a version but may write them as '' or null in an event. */
const emptyish = (value: unknown): boolean => value === undefined || value === null || value === '';
const sameValue = (a: unknown, b: unknown): boolean => (emptyish(a) && emptyish(b)) || sameJson(a, b);

/**
 * The audit event that made `version` (the change from `previous`), never guessed: it is joined on time (stamped at the version's
 * `updated_at`, or, for the panel's own write, carrying the version it replaced), and everything it wrote must be what the
 * version holds. Another computer's edit that happens to share a second is therefore not named.
 */
function actorFor(version: Version, previous: Version, keys: Set<string>, events: AuditEvent[], used: Set<string>): string | null {
  const fits = (event: AuditEvent): boolean => {
    if (used.has(event.id) || !event.newValue) return false;
    if (event.type === 'created' || event.type === 'label_added' || event.type === 'label_removed') return false;
    if ((event.type === 'closed' || event.type === 'reopened') && !keys.has('status')) return false;
    const written = Object.entries(event.newValue);
    return written.some(([key]) => keys.has(key)) && written.every(([key, value]) => sameValue(value, version.issue[key]));
  };
  const at = timeOf(version.issue.updated_at as string | undefined);
  // The panel's own write is stamped a second before the new updated_at; its event carries the version it replaced.
  const was = timeOf(previous.issue.updated_at as string | undefined);
  const sameSecond = (event: AuditEvent): boolean => event.at !== null && Math.floor(event.at / 1000) === Math.floor(at / 1000);
  const found = events.find((event) => fits(event) && sameSecond(event))
    ?? events.find((event) => fits(event) && timeOf(event.oldValue?.updated_at as string | undefined) === was);
  if (!found) return null;
  used.add(found.id);
  return found.actor;
}

export type BuiltHistory = { entries: Timed[]; truncated: boolean; labelsKnown: boolean; cutAt: number };

/**
 * Turns one read into entries, newest first: every distinct version shown at the commit that first carried it (identical commits
 * collapse), each against the version before it, plus label changes from the audit log. Gates are merged by `readHistory`.
 */
export function buildHistory(read: HistoryRead, options: { readLimit: number; currentLabels: string[] | null }): BuiltHistory {
  if (read.rows === null) return { entries: [], truncated: false, labelsKnown: true, cutAt: -Infinity };
  const rows = parseRows(read.rows);
  const rowsFull = Array.isArray(read.rows) && read.rows.length >= options.readLimit;
  const events = parseEvents(read.events, read.utcSince ?? null);
  const eventsFull = Array.isArray(read.events) && read.events.length >= options.readLimit;

  // Keep the oldest commit of each run of identical versions.
  const distinct: Version[] = [];
  for (const version of rows) {
    const newer = distinct.at(-1);
    if (newer && sameJson(newer.issue, version.issue)) distinct[distinct.length - 1] = version;
    else distinct.push(version);
  }

  const used = new Set<string>();
  const entries: Timed[] = [];
  distinct.forEach((version, k) => {
    const previous = distinct[k + 1];
    const id = `${version.hash}:${version.index}`;
    if (!previous) {
      if (rowsFull) return; // the read was cut here: this is the oldest it holds, not the creation
      const created = events?.find((event) => event.type === 'created');
      const at = str(version.issue.created_at) ?? version.at;
      entries.push({ time: timeOf(at), entry: { id, at, actor: created?.actor ?? str(version.issue.created_by), changes: [], restorable: [], created: true } });
      return;
    }
    const { changes, keys } = diff(version.issue, previous.issue);
    const actor = events ? actorFor(version, previous, keys, events, used) : null;
    if (changes.length === 0) return;
    entries.push({
      time: timeOf(version.at),
      entry: { id, at: version.at, actor, changes, restorable: changes.filter(canRestore).map((c) => c.field) },
    });
  });

  const oldest = distinct.at(-1);
  const cutAt = rowsFull && oldest ? timeOf(oldest.at) : -Infinity;
  const labelsKnown = events !== null && options.currentLabels !== null;
  let labels: Timed[] = [];
  if (labelsKnown && events) {
    const oldestEvent = events.reduce((least, event) => (event.at === null ? least : Math.min(least, event.at)), Infinity);
    const createdEvent = events.filter((event) => event.type === 'created').at(-1);
    const creation = oldest ? str(oldest.issue.created_at) ?? oldest.at : '';
    const created = createdEvent && creation !== '' && Number.isFinite(timeOf(creation)) ? { raw: createdEvent.atText, at: creation, time: timeOf(creation) } : null;
    labels = labelEntries(events, options.currentLabels!, created).filter((l) => l.time >= cutAt && (!eventsFull || oldestEvent === Infinity || l.time > oldestEvent));
  }
  return { entries: mergeByTime(entries, labels), truncated: rowsFull || eventsFull, labelsKnown, cutAt };
}

/** Both lists are newest first. At the same time the extra goes first (a gate resolved the moment a version landed reads as after it). */
function mergeByTime(base: Timed[], extras: Timed[]): Timed[] {
  const ordered = [...extras].sort((a, b) => b.time - a.time);
  const merged: Timed[] = [];
  let i = 0;
  let j = 0;
  while (i < base.length || j < ordered.length) {
    if (j < ordered.length && (i >= base.length || ordered[j]!.time >= base[i]!.time)) merged.push(ordered[j++]!);
    else merged.push(base[i++]!);
  }
  return merged;
}

/** The gate rows of the review gates that block (or blocked) a bead, and their audit events (null when those could not be read). */
export type GateAuditRead = { rows: Bead[]; events: StoredAuditEvent[] | null };

const isoOf = (event: StoredAuditEvent | undefined): string | null => {
  const ms = event === undefined ? null : eventTimeMs(event);
  return ms === null ? null : new Date(ms).toISOString();
};

/**
 * Requested and resolved entries from the gates' own records: the audit `created` and `closed` events (who and when), else the
 * gate row's own created and closed times (no one named for a resolve). The time is when it happened, not when the service
 * noticed. `covered` is every gate found, so its observed rows are not shown a second time.
 */
export function gateAuditEntries(read: GateAuditRead, panelActor: string): { entries: HistoryEntry[]; covered: Set<string> } {
  const entries: HistoryEntry[] = [];
  const covered = new Set<string>();
  for (const row of read.rows) {
    covered.add(row.id);
    const gate = toGate(row, []);
    const events = (read.events ?? []).filter((event) => event.beadId === row.id);
    const make = (what: HistoryGate['what'], at: string, actor: string | null): HistoryEntry => ({
      id: `gate:${row.id}:${what}`, at, actor, changes: [], restorable: [],
      gate: { gateId: row.id, what, gateKind: gate.kind === 'unknown' ? null : gate.kind, reason: gate.reason, byPanel: actor !== null && actor === panelActor },
    });
    const created = events.filter((event) => event.type === 'created').at(-1); // newest first: the oldest is the creation
    entries.push(make('requested', isoOf(created) ?? row.createdAt, created?.actor ?? row.createdBy));
    if (row.status === 'closed') {
      const closed = events.find((event) => event.type === 'closed');
      entries.push(make('resolved', isoOf(closed) ?? row.closedAt ?? row.updatedAt, closed?.actor ?? null));
    }
  }
  return { entries: entries.sort((a, b) => timeOf(b.at) - timeOf(a.at)), covered };
}

/**
 * The review-gate rows of one bead's observed activity as history entries, in the order given. These carry the time the service
 * saw the change, so they are used for what the audit log cannot report (a gate deleted, or its link removed), and for gates it
 * knows nothing of.
 */
export function gateEntries(activity: ChangeEvent[], beadId: string): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const row of activity) {
    if (row.beadId !== beadId || (row.kind !== 'gate_opened' && row.kind !== 'gate_resolved') || row.gateId === undefined) continue;
    const what: HistoryGate['what'] = row.kind === 'gate_opened' ? 'requested' : row.ended ?? 'resolved';
    entries.push({
      id: `gate:${row.id}`,
      at: row.changedAt ?? row.observedAt,
      actor: row.actor,
      changes: [],
      restorable: [],
      gate: { gateId: row.gateId, what, gateKind: row.gateKind ?? null, reason: row.reason ?? null, byPanel: row.byPanel },
    });
  }
  return entries;
}

function locate(entries: HistoryEntry[], before: string): number {
  const exact = entries.findIndex((entry) => entry.id === before);
  if (exact >= 0 || before.startsWith('gate:') || before.startsWith('labels:')) return exact;
  // The index in a version's id moves when newer commits arrive; the hash does not.
  const hash = before.slice(0, before.lastIndexOf(':'));
  return hash === '' ? -1 : entries.findIndex((entry) => !entry.gate && !entry.id.startsWith('labels:') && entry.id.slice(0, entry.id.lastIndexOf(':')) === hash);
}

/**
 * One page of a bead's history. `read(limit)` fetches the newest `limit` versions; a page that needs older ones than the read
 * holds (the cursor is not in it, or the page reaches its end) reads again with a larger limit, up to `MAX_READ`, after which
 * the history simply ends there.
 */
export async function readHistory(
  read: (limit: number) => Promise<HistoryRead>,
  options: { before?: string; pageSize: number; currentLabels: string[] | null; activity: ChangeEvent[]; beadId: string; gateRead?: GateAuditRead | null; panelActor?: string },
): Promise<HistoryResult> {
  const audited = options.gateRead ? gateAuditEntries(options.gateRead, options.panelActor ?? '') : { entries: [], covered: new Set<string>() };
  const observed = gateEntries(options.activity, options.beadId).filter((entry) => entry.gate!.what === 'deleted' || entry.gate!.what === 'unlinked' || !audited.covered.has(entry.gate!.gateId));
  const gateRows: HistoryEntry[] = [...audited.entries, ...observed];
  let limit = FIRST_READ;
  for (;;) {
    const raw = await read(limit);
    if (raw.rows === null) return { entries: [], more: false, labelsKnown: true };
    const built = buildHistory(raw, { readLimit: limit, currentLabels: options.currentLabels });
    const gates: Timed[] = gateRows
      .map((entry) => ({ entry, time: timeOf(entry.at) }))
      .filter((gate) => gate.time >= built.cutAt);
    const held = mergeByTime(built.entries, gates).map((timed) => timed.entry);
    const widen = built.truncated && limit < MAX_READ;
    const start = options.before === undefined ? 0 : locate(held, options.before) + 1;
    if (options.before !== undefined && start === 0) {
      if (widen) { limit = Math.min(limit * 2, MAX_READ); continue; }
      return { entries: [], more: false, labelsKnown: built.labelsKnown };
    }
    const end = start + options.pageSize;
    if (end >= held.length && widen) { limit = Math.min(limit * 2, MAX_READ); continue; }
    return { entries: held.slice(start, end), more: end < held.length, labelsKnown: built.labelsKnown };
  }
}
