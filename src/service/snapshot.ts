import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { Bead, ChangeEvent, ChangeKind, Dependency, Freshness, JsonValue, SnapshotResponse, StatusDef, SyncState, WorkspaceState } from '../shared/types';
import { BdProvider, onPanelWrite, panelActor, withRootQueue, type PanelWrite } from './bd/adapter';
import { AUDIT_BEAD_IDS_MAX, AUDIT_LIMIT_MAX, eventTimeMs, readAuditEvents, type AuditEvent } from './bd/audit';
import { BdError, resolveExecutable } from './bd/exec';
import { DETAIL_MAX, capText, errorDetail, readErrorText } from './errors';
import { checkBackedOut, checkHalfMerge, lastTeamSync, onSyncChange, onTeamSynced, resetSyncState, seedLastTeamSync, syncSignature, syncState, unpublishedCount, writesBlocked } from './sync';
import { detectWorkspace } from './workspace';

const ACTIVITY_MAX = 500;
const USED_AUDIT_IDS_MAX = 2000;
const BACKFILL_MAX = 50;
const COMMENT_TEXT_MAX = 500;
const FIELD_TEXT_MAX = 2000;
const FILE_VERSION = 1;
const DELETED_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** Where the per-project state files live: `$XDG_DATA_HOME/openchamber-beads`, else `~/.local/share/openchamber-beads`. */
export function defaultStorageDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_DATA_HOME;
  // The XDG spec says a relative path here is invalid and must be ignored.
  return join(xdg !== undefined && isAbsolute(xdg) ? xdg : join(homedir(), '.local', 'share'), 'openchamber-beads');
}

function capValue(value: JsonValue | undefined): JsonValue | undefined {
  return typeof value === 'string' ? capText(value, FIELD_TEXT_MAX) : value;
}

/** Bead fields reported as `field` events, in report order. */
const FIELDS = ['title', 'status', 'priority', 'type', 'assignee', 'labels', 'description', 'design', 'acceptance', 'notes', 'parentId'] as const;
type FieldName = (typeof FIELDS)[number];

/** Where beads' audit log files each field under (the `updated` event's JSON keys). */
const AUDIT_KEYS: Record<FieldName, string[]> = {
  title: ['title'],
  status: ['status'],
  priority: ['priority'],
  type: ['issue_type', 'type'],
  assignee: ['assignee'],
  labels: ['labels'],
  description: ['description'],
  design: ['design'],
  acceptance: ['acceptance_criteria', 'acceptance'],
  notes: ['notes'],
  parentId: ['parent', 'parent_id', 'parentId'],
};

const DEFAULT_DONE: ReadonlySet<string> = new Set(['closed']);

/** Only this user's own panel writes count: another person's " (panel)" name is a teammate. */
function isPanelActor(actor: string | null, panelActor: string): boolean {
  return actor !== null && actor === panelActor;
}

/** `byPanel` starts false; `attributeChanges` (which knows the panel actor) sets it. */
function makeEvent(beadId: string, kind: ChangeKind, observedAt: string, actor: string | null, rest: { field?: string; from?: JsonValue; to?: JsonValue } = {}): ChangeEvent {
  return { id: randomUUID(), beadId, kind, ...rest, actor, byPanel: false, observedAt };
}

const depKey = (d: Dependency): string => `${d.from}|${d.kind}|${d.to}`;

/** Changes whenever bd would say the bead changed: its update time, comment count, or dependencies. */
export function beadVersion(b: Bead): string {
  return `${b.updatedAt}|${b.comments.length}|${b.dependencies.map(depKey).sort().join(',')}`;
}

function sameField(name: FieldName, a: Bead, b: Bead): boolean {
  if (name === 'labels') return [...a.labels].sort().join('\u0000') === [...b.labels].sort().join('\u0000');
  return a[name] === b[name];
}

/** Counts bd keeps up to date by itself; what they count is reported on its own. */
const isCount = (key: string): boolean => key.endsWith('_count');
const sameJson = (a: JsonValue | undefined, b: JsonValue | undefined): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function diffBead(prev: Bead, next: Bead, observedAt: string, done: ReadonlySet<string>, out: ChangeEvent[]): void {
  let movedDone = false;
  let movedStatus = false;
  for (const name of FIELDS) {
    if (sameField(name, prev, next)) continue;
    const rest = { field: name, from: capValue(prev[name]), to: capValue(next[name]) };
    if (name === 'status') {
      movedStatus = true;
      const wasDone = done.has(prev.status);
      const isDone = done.has(next.status);
      if (!wasDone && isDone) {
        movedDone = true;
        out.push(makeEvent(next.id, 'closed', observedAt, null, rest));
        continue;
      }
      if (wasDone && !isDone) {
        movedDone = true;
        out.push(makeEvent(next.id, 'reopened', observedAt, null, rest));
        continue;
      }
    }
    out.push(makeEvent(next.id, 'field', observedAt, null, rest));
  }

  // The close reason and the "More" fields, so a change that moved nothing above still shows. A reason that came with the
  // close or reopen itself is part of that row, as is the `started_at` that came with a status change. Saved snapshots from older versions may lack either.
  const reasonBefore = prev.closeReason ?? null;
  const reasonAfter = next.closeReason ?? null;
  if (reasonBefore !== reasonAfter && !movedDone) {
    out.push(makeEvent(next.id, 'field', observedAt, null, { field: 'closeReason', from: capValue(reasonBefore), to: capValue(reasonAfter) }));
  }
  const extraBefore = prev.extra ?? {};
  const extraAfter = next.extra ?? {};
  for (const key of new Set([...Object.keys(extraBefore), ...Object.keys(extraAfter)])) {
    if (isCount(key) || sameJson(extraBefore[key], extraAfter[key])) continue;
    // Beads stamps `started_at` when a bead first moves on, so one set with the status change is part of that row.
    if (key === 'started_at' && movedStatus && isBlank(extraBefore[key])) continue;
    out.push(makeEvent(next.id, 'field', observedAt, null, { field: key, from: capValue(extraBefore[key] ?? null), to: capValue(extraAfter[key] ?? null) }));
  }

  const knownComments = new Set(prev.comments.map((c) => c.id));
  for (const c of next.comments) {
    if (!knownComments.has(c.id)) out.push(makeEvent(next.id, 'comment', observedAt, c.author, { to: capText(c.text, COMMENT_TEXT_MAX) }));
  }

  // A parent-child link is the parentId field, which is already reported above.
  const before = new Map(prev.dependencies.filter((d) => d.kind !== 'parent-child').map((d) => [depKey(d), d]));
  const after = new Map(next.dependencies.filter((d) => d.kind !== 'parent-child').map((d) => [depKey(d), d]));
  for (const [key, d] of after) {
    if (!before.has(key)) out.push(makeEvent(next.id, 'dep_added', observedAt, d.createdBy, { field: d.kind, to: d.to }));
  }
  for (const [key, d] of before) {
    if (!after.has(key)) out.push(makeEvent(next.id, 'dep_removed', observedAt, null, { field: d.kind, from: d.to }));
  }
}

/**
 * What changed between two reads of all beads. `done` is the set of done-category status names:
 * moving into one is `closed`, out of one is `reopened`.
 */
export function diffSnapshots(prev: Bead[], next: Bead[], observedAt: string, done: ReadonlySet<string> = DEFAULT_DONE): ChangeEvent[] {
  const out: ChangeEvent[] = [];
  const before = new Map(prev.map((b) => [b.id, b]));
  const present = new Set<string>();
  for (const b of next) {
    present.add(b.id);
    const old = before.get(b.id);
    if (old) diffBead(old, b, observedAt, done, out);
    else out.push(makeEvent(b.id, 'created', observedAt, b.createdBy));
  }
  for (const b of prev) {
    // The bead is gone after this, so its deletion carries the title to name it by.
    if (!present.has(b.id)) out.push({ ...makeEvent(b.id, 'deleted', observedAt, null), ...(typeof b.title === 'string' ? { title: capText(b.title, FIELD_TEXT_MAX) } : {}) });
  }
  return out;
}

type Fields = Record<string, JsonValue>;
type ParsedAudit = { event: AuditEvent; fields: Fields | null };

function parseFields(text: string | null): Fields | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : null;
  } catch {
    return null;
  }
}

const isBlank = (v: unknown): boolean => v === null || v === undefined || v === '';

/** `to` is already capped (see `capValue`), so the audit value is capped the same way before comparing. */
function sameValue(audited: unknown, to: unknown): boolean {
  const a = typeof audited === 'string' ? capText(audited, FIELD_TEXT_MAX) : audited;
  if (isBlank(a) && isBlank(to)) return true;
  if (Array.isArray(a) && Array.isArray(to)) return JSON.stringify([...a].sort()) === JSON.stringify([...to].sort());
  return JSON.stringify(a) === JSON.stringify(to);
}

/**
 * Does this audit event record a change to `field` that ended at `to`? `updated`, `status_changed` and
 * `claimed` carry the changed fields as JSON in `newValue` (one event can carry several), so they match
 * by key and value. When a status or claim event has no values, it matches by field alone, as label
 * events do (their label is in a column we do not read).
 */
function matchesField(p: ParsedAudit, field: string, to: JsonValue | undefined): boolean {
  switch (p.event.type) {
    case 'updated':
    case 'status_changed':
    case 'claimed': {
      if (p.fields !== null) {
        const keys = AUDIT_KEYS[field as FieldName] ?? (field === 'closeReason' ? ['close_reason'] : [field]);
        const key = keys.find((k) => p.fields !== null && k in p.fields);
        return key !== undefined && sameValue(p.fields[key], to);
      }
      if (p.event.type === 'status_changed') return field === 'status';
      if (p.event.type === 'claimed') return field === 'assignee' || field === 'status';
      return false;
    }
    case 'renamed':
      return field === 'title';
    case 'label_added':
    case 'label_removed':
      return field === 'labels';
    default:
      return false;
  }
}

function matches(c: ChangeEvent, p: ParsedAudit): boolean {
  switch (c.kind) {
    case 'created':
      return p.event.type === 'created';
    case 'deleted':
      return p.event.type === 'deleted';
    case 'closed':
    case 'reopened':
      // A claim also moves status, but it is never what closed or reopened a bead.
      if (p.event.type === c.kind) return true;
      return p.event.type !== 'claimed' && matchesField(p, 'status', c.to);
    case 'field':
      return c.field !== undefined && matchesField(p, c.field, c.to);
    default:
      // bd writes no audit events for comments or dependencies; their actors come from the bead data.
      return false;
  }
}

/** What a change fills in the audit event: its field, or for a close, a reopen, a creation or a deletion, that kind. */
function slotOf(c: ChangeEvent): string {
  if (c.kind === 'closed' || c.kind === 'reopened') return 'status';
  return c.kind === 'field' ? (c.field ?? '') : c.kind;
}

function eventIso(e: AuditEvent): string | null {
  const ms = eventTimeMs(e);
  return ms !== null ? new Date(ms).toISOString() : null;
}

/**
 * Fills in who made each change from the audit log: for each change, the newest audit event of the
 * same bead that records the same field (and value, when the event has it). Events are expected
 * newest first. One event can attribute one change per field it contains (bd writes several fields
 * in one event), never two changes to the same field. Events used are added to `usedAuditIds` after
 * the pass, so they cannot attribute anything in a later call. A matched event with a real time
 * (UUIDv7) also gives the change its `changedAt` (`observedAt` stays the service clock). Without audit events, actors stay as the bead
 * data gave them. `byPanel` is true only for `panelActor` itself.
 */
export function attributeChanges(changes: ChangeEvent[], audit: AuditEvent[] | null, panelActor: string, usedAuditIds: Set<string> = new Set()): ChangeEvent[] {
  const byBead = new Map<string, ParsedAudit[]>();
  for (const event of audit ?? []) {
    if (usedAuditIds.has(event.id)) continue;
    const list = byBead.get(event.beadId) ?? [];
    list.push({ event, fields: parseFields(event.newValue) });
    byBead.set(event.beadId, list);
  }

  const filled = new Map<string, Set<string>>();
  const out = changes.map((c) => {
    let { actor, changedAt } = c;
    let reason: string | undefined;
    const slot = slotOf(c);
    const hit = (byBead.get(c.beadId) ?? []).find((p) => !filled.get(p.event.id)?.has(slot) && matches(c, p));
    if (hit) {
      filled.set(hit.event.id, (filled.get(hit.event.id) ?? new Set()).add(slot));
      // A created bead's own recorded creator beats the audit log's.
      if (!(c.kind === 'created' && actor !== null)) actor = hit.event.actor ?? actor;
      changedAt = eventIso(hit.event) ?? changedAt;
      // The audit `closed` event is the only place a close reason survives for a custom done status.
      if (hit.event.type === 'closed' && hit.event.newValue !== null) reason = capText(hit.event.newValue, FIELD_TEXT_MAX);
    }
    return { ...c, actor, ...(changedAt !== undefined ? { changedAt } : {}), ...(reason !== undefined ? { reason } : {}), byPanel: isPanelActor(actor, panelActor) };
  });
  for (const id of filled.keys()) usedAuditIds.add(id);
  return out;
}

/** Whether a change is one the panel's write made: a field it set, a link it added or removed, its comment, its creation. */
function panelWrote(wrote: PanelWrite, e: ChangeEvent): boolean {
  const linked = (other: JsonValue | undefined) => typeof other === 'string' && (wrote.deps ?? []).some(([from, to]) => from === e.beadId && to === other);
  switch (e.kind) {
    case 'field':
    case 'closed':
    case 'reopened':
      // A removed parent link shows as the parent field.
      if (e.field === 'parentId' && (linked(e.from) || linked(e.to))) return true;
      return (wrote.fields ?? []).includes(e.kind === 'field' ? (e.field ?? '') : 'status');
    case 'dep_added':
      return linked(e.to);
    case 'dep_removed':
      return linked(e.from);
    case 'comment':
      return wrote.comment === true;
    case 'created':
      return wrote.created === true;
    default:
      return false;
  }
}

function historicalTime(e: AuditEvent): string {
  return eventIso(e) ?? e.rawCreatedAt.slice(0, 10);
}

/** Past audit events as activity rows. One `updated`, `status_changed` or `claimed` event can change several fields, so it can give several rows. */
function historicalEvents(e: AuditEvent, panelActor: string): ChangeEvent[] {
  const base = (kind: ChangeKind, suffix: string, rest: { field?: string; from?: JsonValue; to?: JsonValue } = {}): ChangeEvent => ({
    id: `audit:${e.id}${suffix}`,
    beadId: e.beadId,
    kind,
    ...rest,
    actor: e.actor,
    byPanel: isPanelActor(e.actor, panelActor),
    observedAt: historicalTime(e),
    historical: true,
  });
  const fields = parseFields(e.newValue);
  const before = parseFields(e.oldValue);
  switch (e.type) {
    case 'created':
      return [base('created', '')];
    case 'closed':
      return [{ ...base('closed', '', { field: 'status' }), ...(e.newValue !== null ? { reason: capText(e.newValue, FIELD_TEXT_MAX) } : {}) }];
    case 'reopened':
      return [base('reopened', '', { field: 'status' })];
    case 'deleted':
      return [base('deleted', '')];
    case 'commented':
      return [base('comment', '')];
    case 'renamed':
      return [base('field', '', { field: 'title' })];
    case 'label_added':
    case 'label_removed':
      return [base('field', '', { field: 'labels' })];
    case 'claimed':
    case 'updated':
    case 'status_changed': {
      if (fields === null) return e.type === 'claimed' ? [base('field', '', { field: 'assignee' })] : [];
      return Object.keys(fields).map((key) => {
        const name = FIELDS.find((f) => AUDIT_KEYS[f].includes(key)) ?? key;
        const rest: { field: string; from?: JsonValue; to?: JsonValue } = { field: name, to: capValue(fields[key]) };
        if (before !== null && key in before) rest.from = capValue(before[key]);
        return base('field', `#${key}`, rest);
      });
    }
    default:
      return [];
  }
}

/** Statuses a bead is still being worked in, used to tell a move into a done status when the status list is not known. */
const NOT_DONE_STATUSES: ReadonlySet<string> = new Set(['open', 'in_progress', 'blocked', 'deferred']);

/**
 * Ids of `reopened` audit events (newest first) that are the second half of a move into a custom done status: bd records that as
 * a `closed` event and then a `reopened` event whose new status is a done one. Such an event directly follows a `closed` event of
 * the same bead (nothing else of that bead between them) and lands in a done status, so it is not a real reopen. With `statuses`,
 * done means a status of category done; without, any status that is not open, in progress, blocked or deferred. An event with no
 * readable target status is never collapsed.
 */
function reopenedAfterClose(audit: AuditEvent[], statuses: StatusDef[] | undefined): Set<string> {
  const done = (status: string): boolean => (statuses ? statuses.some((s) => s.name === status && s.category === 'done') : !NOT_DONE_STATUSES.has(status));
  const out = new Set<string>();
  // Oldest first, so the event before each one (of its bead) is the one seen last.
  const before = new Map<string, AuditEvent>();
  for (const e of [...audit].reverse()) {
    if (e.type === 'reopened' && before.get(e.beadId)?.type === 'closed') {
      const target = parseFields(e.newValue)?.status;
      if (typeof target === 'string' && done(target)) out.add(e.id);
    }
    before.set(e.beadId, e);
  }
  return out;
}

type Persisted = {
  v: typeof FILE_VERSION;
  /** The last read of all beads given to `apply`; null until the first one (and when the file has none we can trust). */
  snapshot: Bead[] | null;
  seen: Record<string, string>;
  /** ISO time each bead was last marked seen. */
  seenAt: Record<string, string>;
  activity: ChangeEvent[];
  usedAuditIds: string[];
  firstContactConfirmedFor: string | null;
  /** When the last pull from the team remote finished (ISO). Absent in files from before sync existed. */
  lastTeamSyncAt: string | null;
};

const CHANGE_KINDS: ReadonlySet<string> = new Set<ChangeKind>(['created', 'field', 'closed', 'reopened', 'deleted', 'dep_added', 'dep_removed', 'comment']);

function isChangeEvent(v: unknown): v is ChangeEvent {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.beadId === 'string' &&
    typeof e.kind === 'string' &&
    CHANGE_KINDS.has(e.kind) &&
    (e.actor === null || typeof e.actor === 'string') &&
    typeof e.byPanel === 'boolean' &&
    typeof e.observedAt === 'string' &&
    (e.title === undefined || typeof e.title === 'string')
  );
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Just enough shape for `diffBead` and `beadVersion` to run on it without throwing. */
function isSnapshotBead(v: unknown): v is Bead {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === 'string' &&
    typeof v.updatedAt === 'string' &&
    Array.isArray(v.labels) &&
    v.labels.every((l) => typeof l === 'string') &&
    Array.isArray(v.comments) &&
    v.comments.every((c) => isRecord(c) && typeof c.id === 'string' && typeof c.text === 'string') &&
    Array.isArray(v.dependencies) &&
    v.dependencies.every((d) => isRecord(d) && typeof d.from === 'string' && typeof d.to === 'string' && typeof d.kind === 'string')
  );
}

function stringMap(v: unknown): Record<string, string> {
  return isRecord(v) ? Object.fromEntries(Object.entries(v).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {};
}

/** Null for anything unparseable or of another version: the caller starts over. A snapshot that fails its shape check is dropped alone (a baseline is taken again). */
function parsePersisted(text: string): Persisted | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== FILE_VERSION) return null;
  if (!isRecord(raw.seen) || !Array.isArray(raw.activity) || !Array.isArray(raw.usedAuditIds)) return null;
  return {
    v: FILE_VERSION,
    snapshot: Array.isArray(raw.snapshot) && raw.snapshot.every(isSnapshotBead) ? raw.snapshot : null,
    seen: stringMap(raw.seen),
    seenAt: stringMap(raw.seenAt),
    activity: raw.activity.filter(isChangeEvent).slice(-ACTIVITY_MAX),
    usedAuditIds: raw.usedAuditIds.filter((id): id is string => typeof id === 'string').slice(-USED_AUDIT_IDS_MAX),
    firstContactConfirmedFor: typeof raw.firstContactConfirmedFor === 'string' ? raw.firstContactConfirmedFor : null,
    lastTeamSyncAt: typeof raw.lastTeamSyncAt === 'string' && !Number.isNaN(Date.parse(raw.lastTeamSyncAt)) ? raw.lastTeamSyncAt : null,
  };
}

/**
 * One project's change history and seen state. Keeps the last snapshot of all beads, which is also
 * persisted, so changes made while the service was down are diffed on the next read like any others.
 */
export class ProjectStore {
  private readonly path: string;
  private snapshot: Bead[] | null = null;
  private index = new Map<string, Bead>();
  private seen = new Map<string, string>();
  private seenAt = new Map<string, string>();
  /** Oldest first. */
  private ring: ChangeEvent[] = [];
  private usedAuditIds = new Set<string>();
  private confirmedFor: string | null = null;
  private teamSyncedAt: string | null = null;
  private saving: Promise<void> = Promise.resolve();
  private rev = 0;
  /** What the panel wrote to each bead since the last apply. In memory only. */
  private panelWrites = new Map<string, PanelWrite[]>();

  constructor(
    readonly root: string,
    private readonly storageDir: string,
  ) {
    this.path = join(storageDir, `${createHash('sha1').update(root).digest('hex')}.json`);
  }

  /**
   * Reads the persisted state. No file, bad JSON, another version, or the wrong shape is the same as
   * none. Any other read error (permissions, too many open files) is thrown: the caller must not
   * go on and overwrite a file that may be fine.
   */
  async load(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const persisted = parsePersisted(text);
    if (!persisted) return;
    this.setSnapshot(persisted.snapshot);
    this.seen = new Map(Object.entries(persisted.seen));
    this.seenAt = new Map(Object.entries(persisted.seenAt));
    this.ring = persisted.activity;
    this.usedAuditIds = new Set(persisted.usedAuditIds);
    this.confirmedFor = persisted.firstContactConfirmedFor;
    this.teamSyncedAt = persisted.lastTeamSyncAt;
    seedLastTeamSync(this.root, persisted.lastTeamSyncAt);
  }

  /** When the last pull from the team remote finished (ISO), or null. */
  lastTeamSyncAt(): string | null {
    return this.teamSyncedAt;
  }

  /** Remembers a finished pull. Not part of `revision()`: the panel gets it through the freshness block. Call `save()` to keep it. */
  recordTeamSync(iso: string): void {
    this.teamSyncedAt = iso;
  }

  private setSnapshot(snapshot: Bead[] | null): void {
    this.snapshot = snapshot;
    this.index = new Map((snapshot ?? []).map((b) => [b.id, b]));
  }

  /**
   * The panel has written (or may have written) `wrote` on this bead. The next apply credits the changes that match it
   * and that nothing else names to the panel, so the user's own edit does not show up as unseen news; any other change
   * to the bead keeps no name. The mark lasts for one apply.
   */
  recordPanelWrite(beadId: string, wrote: PanelWrite): void {
    this.panelWrites.set(beadId, [...(this.panelWrites.get(beadId) ?? []), wrote]);
  }

  /** Moves whenever something a snapshot shows changes: new events, new history rows, or seen state. */
  revision(): number {
    return this.rev;
  }

  /** True once a snapshot exists, taken in this run or restored from a saved one. */
  hasBaseline(): boolean {
    return this.snapshot !== null;
  }

  /** How many beads the current snapshot holds; 0 before the first one. */
  beadCount(): number {
    return this.snapshot?.length ?? 0;
  }

  /** Ids of beads that differ from the current snapshot (new, changed, or gone), without changing anything. Empty before the first snapshot. */
  changedBeadIds(next: Bead[]): string[] {
    if (!this.snapshot) return [];
    return [...new Set(diffSnapshots(this.snapshot, next, '').map((c) => c.beadId))];
  }

  /**
   * Takes a fresh read of all beads. With no snapshot yet it only sets the baseline: every bead is
   * seen and there are no change events. Otherwise it diffs against the previous read, attributes
   * the changes, and adds them to the activity ring. Returns the new change events.
   */
  apply(next: Bead[], audit: AuditEvent[] | null, panelActor: string, now: string, statuses: StatusDef[]): ChangeEvent[] {
    const prev = this.snapshot;
    // The marks cover this apply only, including a baseline one: they never reach a later refresh.
    const panelWrites = this.panelWrites;
    this.panelWrites = new Map();
    this.setSnapshot(next);
    for (const id of [...this.seen.keys()]) if (!this.index.has(id)) this.seen.delete(id);

    if (prev === null) {
      // Only ids with no saved state are seeded, so unseen flags restored from a file stay.
      for (const b of next) {
        if (this.seen.has(b.id)) continue;
        this.seen.set(b.id, beadVersion(b));
        this.seenAt.set(b.id, now);
      }
      this.pruneSeenAt(now);
      this.rev += 1;
      return [];
    }

    const done = new Set(statuses.filter((s) => s.category === 'done').map((s) => s.name));
    const events = attributeChanges(diffSnapshots(prev, next, now, done.size > 0 ? done : DEFAULT_DONE), audit, panelActor, this.usedAuditIds);
    // The panel just wrote these. A change the audit log did not name (a dependency removal, or a log that could not be
    // read) is the panel's when it is what the panel wrote; a change the log credits to someone else keeps its actor.
    for (const e of events) {
      if (e.actor === null && (panelWrites.get(e.beadId) ?? []).some((wrote) => panelWrote(wrote, e))) {
        e.actor = panelActor;
        e.byPanel = true;
      }
    }
    this.autoSeePanelChanges(prev, next, events, now);
    // A bead that goes without ever having been marked seen gets an empty mark, so its deletion counts as unseen (any real time is later than '').
    for (const b of prev) if (!this.index.has(b.id) && !this.seenAt.has(b.id)) this.seenAt.set(b.id, '');
    if (events.length > 0) this.rev += 1;
    this.ring.push(...events);
    if (this.ring.length > ACTIVITY_MAX) this.ring = this.ring.slice(-ACTIVITY_MAX);
    this.trimUsedAuditIds();
    this.pruneSeenAt(now);
    return events;
  }

  /** A gone bead keeps its `seenAt` while its deletion is in the feed and under 30 days old, so the deletion can still show as unseen; anything else for a gone bead goes. */
  private pruneSeenAt(now: string): void {
    const cutoff = Date.parse(now) - DELETED_KEEP_MS;
    const recentlyDeleted = new Set(this.ring.filter((e) => e.kind === 'deleted' && !(Date.parse(e.observedAt) < cutoff)).map((e) => e.beadId));
    for (const id of [...this.seenAt.keys()]) if (!this.index.has(id) && !recentlyDeleted.has(id)) this.seenAt.delete(id);
  }

  /** A bead whose every change this refresh came from the panel stays seen, unless an earlier change by someone else was still unseen. */
  private autoSeePanelChanges(prev: Bead[], next: Bead[], events: ChangeEvent[], now: string): void {
    const before = new Map(prev.map((b) => [b.id, b]));
    const byBead = new Map<string, ChangeEvent[]>();
    for (const e of events) byBead.set(e.beadId, [...(byBead.get(e.beadId) ?? []), e]);
    for (const b of next) {
      const list = byBead.get(b.id);
      if (!list || !list.every((e) => e.byPanel)) continue;
      const old = before.get(b.id);
      const wasSeen = old === undefined || this.seen.get(b.id) === beadVersion(old);
      if (!wasSeen) continue;
      this.seen.set(b.id, beadVersion(b));
      this.seenAt.set(b.id, now);
    }
  }

  private trimUsedAuditIds(): void {
    const excess = this.usedAuditIds.size - USED_AUDIT_IDS_MAX;
    if (excess <= 0) return;
    for (const id of [...this.usedAuditIds].slice(0, excess)) this.usedAuditIds.delete(id);
  }

  /**
   * First load only: seeds the activity feed from the newest audit events (newest first), marked
   * historical and dated coarsely. Does nothing once a snapshot exists. Returns the rows added. A move into a custom done status that
   * bd recorded as `closed` then `reopened` shows as the close alone (see `reopenedAfterClose`).
   */
  backfill(audit: AuditEvent[], panelActor: string, statuses?: StatusDef[]): ChangeEvent[] {
    if (this.snapshot !== null) return [];
    const collapsed = reopenedAfterClose(audit, statuses);
    const fresh = audit.slice(0, BACKFILL_MAX).filter((e) => !this.usedAuditIds.has(e.id));
    const rows: ChangeEvent[] = [];
    for (const e of fresh) {
      // A collapsed event is still used up, so it cannot attribute a later change.
      this.usedAuditIds.add(e.id);
      if (!collapsed.has(e.id)) rows.push(...historicalEvents(e, panelActor));
    }
    // Rows are chronological in the ring; the audit log hands them over newest first.
    this.ring.push(...rows.reverse());
    if (this.ring.length > ACTIVITY_MAX) this.ring = this.ring.slice(-ACTIVITY_MAX);
    this.trimUsedAuditIds();
    if (rows.length > 0) this.rev += 1;
    return rows;
  }

  private isUnseen(b: Bead): boolean {
    return this.seen.get(b.id) !== beadVersion(b);
  }

  /** Beads that are new or changed since they were last marked seen. */
  unseenIds(): string[] {
    return (this.snapshot ?? []).filter((b) => this.isUnseen(b)).map((b) => b.id);
  }

  /** Ids of gone beads whose deletion has not been marked seen. */
  unseenDeletionIds(): string[] {
    const ids = new Set<string>();
    for (const e of this.ring) if (e.kind === 'deleted' && !this.index.has(e.beadId) && this.isEventUnseen(e)) ids.add(e.beadId);
    return [...ids];
  }

  /** Marks beads seen as of `now` (ISO). Beads that are gone but have a deletion in the feed are marked too, which dismisses the deletion. */
  markSeen(ids: string[] | 'all', now: string = new Date().toISOString()): void {
    if (!this.snapshot) return;
    this.rev += 1;
    const wanted = ids === 'all' ? null : new Set(ids);
    for (const b of this.snapshot) {
      if (wanted !== null && !wanted.has(b.id)) continue;
      this.seen.set(b.id, beadVersion(b));
      this.seenAt.set(b.id, now);
    }
    for (const e of this.ring) {
      if (e.kind !== 'deleted' || this.index.has(e.beadId)) continue;
      if (wanted === null || wanted.has(e.beadId)) this.seenAt.set(e.beadId, now);
    }
  }

  /**
   * For the activity feed: the event is newer (service clock) than when its bead was last marked
   * seen, and the bead is unseen now. A deleted bead has no seen state; its deletion is unseen
   * until the bead's mark is newer, and never once that mark is forgotten. Backfilled history is never unseen.
   */
  isEventUnseen(e: ChangeEvent): boolean {
    if (e.historical) return false;
    const at = this.seenAt.get(e.beadId);
    const b = this.index.get(e.beadId);
    if (!b) return e.kind === 'deleted' && at !== undefined && e.observedAt > at;
    if (!this.isUnseen(b)) return false;
    return at === undefined || e.observedAt > at;
  }

  /** Newest first. */
  activity(limit: number): ChangeEvent[] {
    if (!Number.isFinite(limit) || limit < 1) return [];
    return this.ring.slice(-Math.floor(limit)).reverse();
  }

  /** The bd version the user confirmed first contact for, if any. */
  firstContactConfirmedFor(): string | null {
    return this.confirmedFor;
  }

  confirmFirstContact(bdVersion: string): void {
    this.confirmedFor = bdVersion;
    this.rev += 1;
  }

  /** Puts the consent back as it was (`previous` is what `firstContactConfirmedFor()` returned before), when saving a new one failed. */
  restoreFirstContact(previous: string | null): void {
    this.confirmedFor = previous;
    this.rev += 1;
  }

  /** Writes the state. Saves run one at a time; each is a temp file renamed into place. */
  save(): Promise<void> {
    const run = this.saving.then(() => this.write());
    this.saving = run.catch(() => undefined);
    return run;
  }

  private async write(): Promise<void> {
    const body: Persisted = {
      v: FILE_VERSION,
      snapshot: this.snapshot,
      seen: Object.fromEntries(this.seen),
      seenAt: Object.fromEntries(this.seenAt),
      activity: this.ring,
      usedAuditIds: [...this.usedAuditIds],
      firstContactConfirmedFor: this.confirmedFor,
      lastTeamSyncAt: this.teamSyncedAt,
    };
    await mkdir(this.storageDir, { recursive: true });
    const tmp = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(body), 'utf8');
      await rename(tmp, this.path);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Refresh loop: one cache per project root, filled only while a panel is asking.
// ---------------------------------------------------------------------------------------------

/** A refresh does work (reads the signal, and exports when due) at most this often per root, however often the panel polls and whether or not the last attempt worked. */
const SIGNAL_THROTTLE_MS = 4_000;
/** Even with an unmoved signal the beads are exported this often, to catch what the signal cannot see (a deferral coming due). */
const FORCE_EXPORT_MS = 60_000;
/** Part of every cursor: a cursor from an earlier service process is never "unchanged". */
const PROCESS_ID = randomUUID().slice(0, 8);
const ACTIVITY_LIMIT = 200;

type Clock = () => number;
let clock: Clock = Date.now;
let storageDirOverride: string | null = null;

/** Replaces the time source (ms since epoch). Pass null to restore the real clock. For tests. */
export function setClock(fn: Clock | null): void {
  clock = fn ?? Date.now;
}

/** Replaces where state files go. Pass null to restore the default. For tests. */
export function setStorageDir(dir: string | null): void {
  storageDirOverride = dir;
}

const isoOf = (ms: number): string => new Date(ms).toISOString();

type RootCache = {
  root: string;
  /** The panel's own actor, as of the last export. */
  panelActor: string;
  provider: BdProvider;
  store: ProjectStore | null;
  beads: Bead[];
  statuses: StatusDef[] | null;
  types: string[] | null;
  readyIds: string[];
  /** Short digest of the data held (beads, ready ids, statuses, types), so a cursor says what the panel has, not what was last read. */
  dataKey: string;
  /** True once an export has been applied. */
  loaded: boolean;
  localRefreshedAt: string | null;
  localError: string | null;
  localErrorDetail: string | null;
  /** Why the last save of the panel state failed; kept until a save works. */
  saveError: string | null;
  /** Why the panel could not note its own last write (so it may show as news); kept until a later note works. */
  writeNoteError: string | null;
  /** True while no change signal can be had (the minute pass is all that exports). */
  noSignal: boolean;
  /** Clock time of the last refresh that did work, whether or not it worked out. */
  attemptAt: number | null;
  /** Clock time of the last half-merge check, held to the same 4 s window as the change signal. */
  halfMergeAt: number | null;
  /** The same for the check that a backed-out conflict was resolved elsewhere. */
  conflictCheckAt: number | null;
  /** The signal the applied export was taken under; unchanged by a failed export, so the next window retries. */
  exportedSignal: string | null;
  exportedAt: number | null;
  inflight: Promise<void> | null;
  /** How many local commits the team remote has not seen. Null with no remote or before the first count; kept when a count fails. */
  unpublishedCount: number | null;
  /** Why the last count failed, for the details; null once one works. */
  unpublishedError: string | null;
  /** Clock time of the last count attempt, whether or not it worked out. */
  unpublishedAt: number | null;
  /** Moves whenever the count is known to be out of date (a write, or a sync job ending). */
  unpublishedGen: number;
  unpublishedCountedGen: number;
  unpublishedInflight: Promise<void> | null;
  /** The last export found no beads while some are held, and was not applied: the next window reads again, and a second empty read is believed. */
  emptyExportPending: boolean;
  /**
   * Moves on every panel write. The next refresh exports however recent the last attempt (once per move), and whatever the
   * signal says, so the panel's next poll shows its own change instead of a copy from before it.
   */
  writeGen: number;
  /** `writeGen` as of the start of the last applied export: the panel writes the held data includes. */
  exportedGen: number;
  /** `writeGen` as of the start of the last refresh attempt, so a failing read after a write is not retried on every poll. */
  attemptedGen: number;
};

const roots = new Map<string, RootCache>();
const stores = new Map<string, Promise<ProjectStore>>();
/** A detected workspace and the `bd` it was detected with: a different `bd` (an upgrade) makes the answer stale. */
type KnownWorkspace = { workspace: WorkspaceState; bdKey: string | null };
const workspaces = new Map<string, KnownWorkspace>();
const detections = new Map<string, Promise<KnownWorkspace>>();

/** Forget every cache and workspace answer (state files stay). For tests. */
export function resetSnapshotState(): void {
  roots.clear();
  stores.clear();
  workspaces.clear();
  detections.clear();
  resetSyncState();
}

/** Identity of the installed `bd`: its real path and modification time (an upgrade replaces the file). Null when there is none. */
async function bdIdentity(): Promise<string | null> {
  try {
    const exe = await resolveExecutable('bd');
    if (!exe) return null;
    const real = await realpath(exe);
    return `${real}:${(await stat(real)).mtimeMs}`;
  } catch {
    return null;
  }
}

/** The one loaded store per root, shared by the refresh loop and the routes that mark things seen or confirm first contact. A failed load is not remembered. */
export function projectStore(root: string): Promise<ProjectStore> {
  const known = stores.get(root);
  if (known) return known;
  const store = new ProjectStore(root, storageDirOverride ?? defaultStorageDir());
  const loading = store.load().then(() => store);
  stores.set(root, loading);
  loading.catch(() => {
    if (stores.get(root) === loading) stores.delete(root);
  });
  return loading;
}

// The panel's own writes (adapter.ts) mark their bead, so the next refresh does not show them as news.
// A failure is also kept in the project's error detail, because a create, comment or link that succeeded has no result to carry it.
onPanelWrite(async (root, beadId, wrote) => {
  // Whatever happens to the note, the held data is out of date now.
  const held = roots.get(root);
  if (held) held.writeGen += 1;
  try {
    (await projectStore(root)).recordPanelWrite(beadId, wrote);
    const known = roots.get(root);
    if (known) {
      known.writeNoteError = null;
      known.unpublishedGen += 1;
    }
  } catch (error) {
    const known = roots.get(root);
    if (known) known.writeNoteError = capText(`Could not note the panel's change to ${beadId}: ${error instanceof Error ? error.message : String(error)}`, DETAIL_MAX);
    throw error;
  }
});

// A finished pull is saved with the project's state. A job or state change makes the unpublished count and the throttle stale.
onTeamSynced((root, at) => {
  void projectStore(root)
    .then((store) => {
      store.recordTeamSync(at);
      return store.save();
    })
    .then(() => {
      const known = roots.get(root);
      if (known?.saveError?.startsWith('Could not save panel state')) known.saveError = null;
    })
    .catch((error: unknown) => {
      const known = roots.get(root);
      if (known) known.saveError = capText(`Could not save panel state: ${error instanceof Error ? error.message : String(error)}`, DETAIL_MAX);
    });
});
onSyncChange((root) => {
  const known = roots.get(root);
  if (!known) return;
  known.attemptAt = null;
  known.unpublishedGen += 1;
});

/** The mode belongs to the root's cache. It is set when the cache is made and changed only by a detection that just finished (`storeDetection`), so a caller holding an old cached workspace (another worktree of the project) cannot flip it back. */
function cacheFor(root: string, mode: 'embedded' | 'server'): RootCache {
  const known = roots.get(root);
  if (known) return known;
  const created: RootCache = {
    root,
    panelActor: '',
    provider: new BdProvider(root, mode),
    store: null,
    beads: [],
    statuses: null,
    types: null,
    readyIds: [],
    dataKey: '',
    loaded: false,
    localRefreshedAt: null,
    localError: null,
    localErrorDetail: null,
    saveError: null,
    writeNoteError: null,
    noSignal: false,
    attemptAt: null,
    halfMergeAt: null,
    conflictCheckAt: null,
    exportedSignal: null,
    exportedAt: null,
    inflight: null,
    unpublishedCount: null,
    unpublishedError: null,
    unpublishedAt: null,
    unpublishedGen: 1,
    unpublishedCountedGen: 0,
    unpublishedInflight: null,
    emptyExportPending: false,
    writeGen: 0,
    exportedGen: 0,
    attemptedGen: 0,
  };
  roots.set(root, created);
  return created;
}

/** Detection, with first-contact consent read from the project's store (which needs the root, so a first answer of "needs first contact" decides it). */
async function detectWithConsent(directory: string): Promise<WorkspaceState> {
  const first = await detectWorkspace(directory, {});
  if (first.kind !== 'needs-first-contact') return first;
  let confirmed = false;
  try {
    confirmed = (await projectStore(first.root)).firstContactConfirmedFor() === first.bdVersion;
  } catch {
    // An unreadable state file means no recorded consent.
  }
  return confirmed ? detectWorkspace(directory, { confirmedFirstContact: true }) : first;
}

/**
 * The workspace for a directory: detected once and kept, detected again when `refresh` is set or when the
 * installed `bd` is no longer the one it was detected with (a newer `bd` may need first-contact consent before
 * it touches the project, so nothing may run on the old answer). A failed detection rethrows when nothing usable
 * is known, and otherwise hands back the known state with the error.
 */
async function lookupWorkspace(directory: string, refresh: boolean): Promise<{ workspace: WorkspaceState; error?: unknown }> {
  const bdKey = await bdIdentity();
  // Read after the await: a caller that waited here must see what a concurrent one detected meanwhile.
  const known = workspaces.get(directory);
  const stale = known !== undefined && known.bdKey !== bdKey;
  if (known && !refresh && !stale) return { workspace: known.workspace };
  let detecting = detections.get(directory);
  if (!detecting) {
    detecting = detectWithConsent(directory)
      .then((workspace) => {
        // Stored here, before the shared promise is dropped, so a caller that arrives just after finds the answer.
        const detected = { workspace, bdKey };
        workspaces.set(directory, detected);
        // A finished detection is the only thing that may change the mode of a root's cache.
        if (workspace.kind === 'ok') {
          const cache = roots.get(workspace.root);
          if (cache && cache.provider.mode !== workspace.mode) cache.provider = new BdProvider(workspace.root, workspace.mode);
        }
        return detected;
      })
      .finally(() => detections.delete(directory));
    detections.set(directory, detecting);
  }
  try {
    return { workspace: (await detecting).workspace };
  } catch (error) {
    if (known && !stale) return { workspace: known.workspace, error };
    throw error;
  }
}

/**
 * The identity-checked workspace answer for a directory, for every route that acts on a project (reads, writes, detail).
 * Same cache and same bd-upgrade check as `getSnapshot`: after a `bd` upgrade it detects again (consent included) before
 * returning, and a failed re-detection rejects (also when `refreshWorkspace` asked for it: the old answer is not handed back).
 * `root` is set only for a usable project (`workspace.kind === 'ok'`); every other state, including first contact
 * still waiting for consent, has `root: null`, so a caller cannot act on a project before that is settled.
 */
export async function resolveWorkspace(directory: string, opts: { refreshWorkspace?: boolean } = {}): Promise<{ workspace: WorkspaceState; root: string | null }> {
  const { workspace, error } = await lookupWorkspace(directory, opts.refreshWorkspace ?? false);
  if (error !== undefined) throw error;
  return { workspace, root: workspace.kind === 'ok' ? workspace.root : null };
}

/**
 * The root's own provider, so a route's writes go through the same cache the snapshot reads (the mode is the root's, set by
 * its detection; `mode` only seeds a cache that does not exist yet).
 */
export function providerFor(root: string, mode: 'embedded' | 'server'): BdProvider {
  return cacheFor(root, mode).provider;
}

/** The beads the root's cache holds as of its last applied export, or null before the first one. */
export function cachedBeads(root: string): Bead[] | null {
  const known = roots.get(root);
  return known?.loaded ? known.beads : null;
}

function recordError(c: RootCache, error: unknown): void {
  c.localError = readErrorText(error, true);
  c.localErrorDetail = errorDetail(error);
}

function clearError(c: RootCache): void {
  c.localError = null;
  c.localErrorDetail = null;
}

const EMPTY_EXPORT_NOTE = 'Beads returned no issues. Checking again.';

const NO_SIGNAL_NOTE = 'Change detection unavailable; checking every minute.';

/** The read error, a failed save, a write the panel could not note, and the no-signal note, one per line; null when there is nothing to say. */
function detailOf(c: RootCache): string | null {
  const lines = [c.localErrorDetail, c.saveError, c.writeNoteError, c.unpublishedError, c.noSignal ? NO_SIGNAL_NOTE : null].filter((line): line is string => line !== null);
  return lines.length > 0 ? lines.join('\n') : null;
}

/** Audit events for the changed beads, a batch of ids at a time. A batch that cannot be read adds nothing; all failing is null. */
async function readAuditFor(c: RootCache, ids: string[]): Promise<AuditEvent[] | null> {
  if (ids.length === 0) return null;
  const events: AuditEvent[] = [];
  let anyRead = false;
  for (let i = 0; i < ids.length; i += AUDIT_BEAD_IDS_MAX) {
    const batch = await withRootQueue(c.root, () => readAuditEvents(c.root, c.provider.mode, { beadIds: ids.slice(i, i + AUDIT_BEAD_IDS_MAX), limit: AUDIT_LIMIT_MAX }));
    if (batch === null) continue;
    anyRead = true;
    events.push(...batch);
  }
  return anyRead ? events : null;
}

/** One export, applied whole or not at all. Throws on any read failure; the caller keeps the last good data. */
async function exportAndApply(c: RootCache, signal: string | null, startedAt: number, forced: boolean, gen: number): Promise<void> {
  const next = await c.provider.export();
  const store = c.store!;
  // An export with no beads while some are held is more likely a passing bad read than every bead deleted at once (that would show
  // as a deletion of each). Hold the old data and read again at the next window; a second empty read in a row is believed.
  if (next.length === 0 && store.beadCount() > 0 && !c.emptyExportPending) {
    c.emptyExportPending = true;
    c.localError = EMPTY_EXPORT_NOTE;
    c.localErrorDetail = null;
    return;
  }
  const refetchVocabulary = c.statuses === null || c.types === null || forced;
  const statuses = refetchVocabulary ? await c.provider.statuses() : c.statuses!;
  const types = refetchVocabulary ? await c.provider.types() : c.types!;
  const readyIds = await c.provider.ready();

  const actor = await panelActor(c.root);
  c.panelActor = actor;
  // The feed starts from the audit log on the very first read; `backfill` does nothing once a baseline exists, so it goes before the baseline.
  if (!store.hasBaseline()) store.backfill((await withRootQueue(c.root, () => readAuditEvents(c.root, c.provider.mode, { limit: BACKFILL_MAX }))) ?? [], actor, statuses);
  const audit = await readAuditFor(c, store.changedBeadIds(next));
  store.apply(next, audit, actor, isoOf(clock()), statuses);

  c.beads = next;
  c.statuses = statuses;
  c.types = types;
  c.readyIds = readyIds;
  c.dataKey = createHash('sha1').update(JSON.stringify([next, readyIds, statuses, types])).digest('hex').slice(0, 12);
  c.exportedSignal = signal;
  c.exportedAt = startedAt;
  c.exportedGen = gen;
  c.loaded = true;
  c.emptyExportPending = false;
  c.localRefreshedAt = isoOf(startedAt);
  clearError(c);
  try {
    await store.save();
    c.saveError = null;
  } catch (error) {
    // The data is current in memory; a failed save only loses seen state if the service restarts before the next refresh saves again.
    // Not a read problem, so `localError` stays empty; the cause stays in the detail until a save works.
    c.saveError = capText(`Could not save panel state: ${error instanceof Error ? error.message : String(error)}`, DETAIL_MAX);
  }
}

async function refresh(c: RootCache): Promise<void> {
  const startedAt = clock();
  const gen = c.writeGen;
  // The panel wrote since the held data was read: export now, past the window and the signal, once per write.
  const written = gen !== c.exportedGen;
  const catchUp = written && gen !== c.attemptedGen;
  // One gate for everything below, so a failing read is retried once per window, never on every poll.
  // A negative elapsed time means the wall clock went back: that counts as due, not as "just now".
  if (!catchUp && c.attemptAt !== null && startedAt >= c.attemptAt && startedAt - c.attemptAt < SIGNAL_THROTTLE_MS) return;
  c.attemptAt = startedAt;
  c.attemptedGen = gen;
  // Forced only means "export even though the signal did not move". An empty read that was held back is read again the same way.
  const forced = c.emptyExportPending || c.exportedAt === null || startedAt < c.exportedAt || startedAt - c.exportedAt >= FORCE_EXPORT_MS;

  try {
    c.store ??= await projectStore(c.root);
    let signal: string | null = null;
    let noSignalAtAll = false;
    try {
      signal = await c.provider.changeSignal();
      c.noSignal = false;
    } catch (error) {
      // A busy or failing read just means no signal this window: the beads are read anyway, as if it had moved.
      // A missing tool (not-found) will not fix itself in a few seconds: then only the minute pass exports.
      noSignalAtAll = error instanceof BdError && error.kind === 'not-found';
      c.noSignal = noSignalAtAll;
    }
    if (noSignalAtAll && !forced && !written) return;
    if (signal !== null && signal === c.exportedSignal && !forced && !written) {
      c.localRefreshedAt = isoOf(startedAt);
      clearError(c);
      return;
    }
    await exportAndApply(c, signal, startedAt, forced, gen);
  } catch (error) {
    // A failed read breaks the "two empty reads in a row" run: the next empty read is held again.
    c.emptyExportPending = false;
    recordError(c, error);
  }
}

/** The unpublished count and the backed-out conflict check run at most this often (the count also at once after a write or a sync job). */
const UNPUBLISHED_TTL_MS = 30_000;

/** Whether a sync check may run now (a clock that went back counts as due); notes the attempt when it may. */
function checkDue(c: RootCache, key: 'halfMergeAt' | 'conflictCheckAt', intervalMs: number): boolean {
  const now = clock();
  const last = c[key];
  if (last !== null && now >= last && now - last < intervalMs) return false;
  c[key] = now;
  return true;
}

/** Counts local commits the team remote lacks. Only for a project with a remote. A failed count keeps the old number and retries after the interval. */
async function refreshUnpublished(c: RootCache, workspace: Extract<WorkspaceState, { kind: 'ok' }>): Promise<void> {
  if (!workspace.hasRemote) {
    c.unpublishedCount = null;
    c.unpublishedError = null;
    return;
  }
  const now = clock();
  const fresh = c.unpublishedAt !== null && now >= c.unpublishedAt && now - c.unpublishedAt < UNPUBLISHED_TTL_MS;
  if (fresh && c.unpublishedCountedGen === c.unpublishedGen) return;
  if (!c.unpublishedInflight) {
    const generation = c.unpublishedGen;
    c.unpublishedInflight = (async () => {
      try {
        c.unpublishedCount = await unpublishedCount(c.root, workspace.mode);
        c.unpublishedError = null;
      } catch (error) {
        // Keep the last count; why it failed goes in the details.
        c.unpublishedError = capText(`Could not count unpublished changes: ${errorDetail(error)}`, DETAIL_MAX);
      } finally {
        // Whether it worked or not: a failed count waits out the interval like any other, unless something makes it stale again.
        c.unpublishedCountedGen = generation;
        c.unpublishedAt = clock();
        c.unpublishedInflight = null;
      }
    })();
  }
  await c.unpublishedInflight;
}

function emptyFreshness(): Freshness {
  return { localRefreshedAt: null, localError: null, localErrorDetail: null, teamSyncedAt: null, unpublished: null };
}

const IDLE: SyncState = { kind: 'idle' };

/** Short digest of the workspace answer, so a cursor taken under another answer (a mode or version change) is never "unchanged". */
function workspaceDigest(workspace: WorkspaceState): string {
  return createHash('sha1').update(JSON.stringify(workspace)).digest('hex').slice(0, 8);
}

function respond(c: RootCache, workspace: WorkspaceState, cursor: string | undefined): SnapshotResponse {
  const store = c.store;
  const freshness: Freshness = {
    localRefreshedAt: c.localRefreshedAt,
    localError: c.localError,
    localErrorDetail: detailOf(c),
    teamSyncedAt: lastTeamSync(c.root),
    unpublished: workspace.kind === 'ok' && workspace.hasRemote ? c.unpublishedCount : null,
  };
  const sync = syncState(c.root);
  // What the panel would hold: the data as applied (not what was last read), the seen/history state, the workspace answer, the sync
  // state, and the panel's actor name. `syncSignature` carries the writes-blocked flag, so the cursor moves with `writesBlocked`.
  const actor = createHash('sha1').update(c.panelActor).digest('hex').slice(0, 8);
  const current = `${PROCESS_ID}:${workspaceDigest(workspace)}:${store?.revision() ?? 0}:${c.dataKey}:${syncSignature(c.root)}:${actor}`;
  if (c.loaded && cursor === current) return { unchanged: true, cursor: current, freshness, sync };
  return {
    unchanged: false,
    cursor: current,
    workspace,
    beads: c.beads,
    statuses: c.statuses ?? [],
    types: c.types ?? [],
    readyIds: c.readyIds,
    unseenIds: store ? [...store.unseenIds(), ...store.unseenDeletionIds()] : [],
    activity: store ? store.activity(ACTIVITY_LIMIT).map((e) => ({ ...e, unseen: store.isEventUnseen(e) })) : [],
    freshness,
    sync,
    writesBlocked: writesBlocked(c.root),
    panelActor: c.panelActor,
  };
}

/**
 * What the panel polls. Detects the workspace once per directory (again only with `refreshWorkspace`).
 * For a usable project it brings the root's cache up to date when due (one refresh at a time per root, shared
 * by every caller; the change signal at most every 4 s; a full export when the signal moved or a minute has
 * passed) and answers with everything the panel shows, or `unchanged: true` when `cursor` is still current.
 * A failed refresh keeps the last good data and reports `localError`. Only runs while called: no timers.
 */
export async function getSnapshot(directory: string, cursor?: string, refreshWorkspace = false): Promise<SnapshotResponse> {
  const { workspace, error } = await lookupWorkspace(directory, refreshWorkspace);
  if (workspace.kind !== 'ok') {
    return {
      unchanged: false,
      cursor: `${PROCESS_ID}:workspace:${workspaceDigest(workspace)}`,
      workspace,
      beads: [],
      statuses: [],
      types: [],
      readyIds: [],
      unseenIds: [],
      activity: [],
      freshness: emptyFreshness(),
      sync: IDLE,
      writesBlocked: false,
      panelActor: '',
    };
  }
  const c = cacheFor(workspace.root, workspace.mode);
  if (error !== undefined) recordError(c, error);
  // Callers that arrive while a refresh runs wait for that one instead of starting another.
  // A refresh already running when `bd` is upgraded keeps going: its queued calls may run the new binary before the
  // next call here detects the change. Accepted window, one refresh long.
  // While a sync job runs it holds the project's queue for up to minutes: answer from what is held (with the running state)
  // instead of making every poll wait behind it. The first read still has to happen.
  if (syncState(c.root).kind === 'running' && c.loaded) return respond(c, workspace, cursor);
  const refreshOnce = async () => {
    c.inflight ??= refresh(c).finally(() => {
      c.inflight = null;
    });
    await c.inflight;
  };
  await refreshOnce();
  // A panel write that landed while that refresh was reading may not be in what it read: one more, now.
  if (c.writeGen !== c.exportedGen && c.writeGen !== c.attemptedGen) await refreshOnce();
  // A job may have started while this poll was waiting: each step below would queue behind it, so answer from what is held.
  const syncing = () => syncState(c.root).kind === 'running';
  if (syncing()) return respond(c, workspace, cursor);
  // A database left halfway through a merge keeps writes blocked until it is seen to be clear.
  if (writesBlocked(c.root) && checkDue(c, 'halfMergeAt', SIGNAL_THROTTLE_MS)) await checkHalfMerge(c.root, workspace.mode);
  // A conflict that was backed out clears once it is resolved elsewhere.
  const shown = syncState(c.root);
  if (shown.kind === 'conflict' && !shown.halfMerged && checkDue(c, 'conflictCheckAt', UNPUBLISHED_TTL_MS)) await checkBackedOut(c.root, workspace.mode);
  if (syncing()) return respond(c, workspace, cursor);
  await refreshUnpublished(c, workspace);
  return respond(c, workspace, cursor);
}
