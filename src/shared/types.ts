/**
 * Every code a route can answer with outside 2xx.
 *  - `BAD_REQUEST`, `BODY_TOO_LARGE`, `UNAUTHORIZED`, `NOT_FOUND`, `INTERNAL`: the HTTP layer (`INTERNAL`: something unexpected broke).
 *  - `workspace`: the project cannot be used; `workspace` on the error says why.
 *  - `busy`: Beads is locked or did not answer in time. `beads-error`: Beads failed some other way (raw text only in `detail`).
 *  - `writes-blocked`: the database is stuck halfway through a team merge. `sync-running`: a sync job holds the project.
 *  - `preview-stale`: Publish was refused because local changes landed after the preview the person confirmed.
 *  - `unsupported`: the installed Beads is too old for what was asked (it needs 1.3 or newer).
 *  - `needs-schema-update`: the project's store is on an older schema than the installed Beads expects, so it cannot be read until the
 *    person updates it (the `migrateSchema` route); `schemaUpdate` on the error carries the two versions. Every write route answers it
 *    too (409) while the project waits, because any write would update the store by itself.
 *  - `update-blocked-shared`: `migrateSchema` was refused because the project syncs with a team remote; Beads will not update such a
 *    store in place, and Abacus never forces it. The message says who can. Not offered again.
 *  - The rest are a refused write.
 */
export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'BODY_TOO_LARGE'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'INTERNAL'
  | 'workspace'
  | 'busy'
  | 'beads-error'
  | 'writes-blocked'
  | 'sync-running'
  | 'invalid'
  | 'not-found'
  | 'blocked'
  | 'claimed'
  | 'dep-exists'
  | 'merge-conflict'
  | 'uncertain'
  | 'no-bd'
  | 'failed'
  | 'preview-stale'
  | 'unsupported'
  | 'needs-schema-update'
  | 'update-blocked-shared';

/** The schema versions of a store that is older than the installed Beads expects: it is at `from`, the binary expects `to`. */
export type SchemaSkew = { from: number; to: number };

/**
 * The one-time project update as a job. `failed` carries what a refused write carries: the code, the plain message, the raw detail, and
 * `saved` when part of it went in; `at` is when it ended (ISO), so a panel can tell one failure from the next.
 */
export type UpdateFailed = { kind: 'failed'; at: string; code: ApiErrorCode; message: string; detail?: string; saved?: true };
export type UpdateJob = { kind: 'running'; startedAt: string } | UpdateFailed;

/**
 * What the service says when a request fails. `message` is plain language; `detail` is the raw text for "Copy details";
 * `workspace` is set with code `workspace` (the project cannot be used, and why); `saved` is set when a failed write is
 * known to be in and only reading it back failed (the panel refreshes); `schemaUpdate` is set with code `needs-schema-update`.
 */
export type ApiError = { code: ApiErrorCode; message: string; detail?: string; workspace?: WorkspaceState; saved?: true; schemaUpdate?: SchemaSkew };

/** The body of every non-2xx response. */
export type ErrorEnvelope = { error: ApiError };

/** What the service found for a project directory. Only `ok` means beads data can be read. */
export type WorkspaceState =
  | { kind: 'ok'; root: string; mode: 'embedded' | 'server'; bdVersion: string; hasRemote: boolean; projectName: string }
  | { kind: 'no-bd' }
  /** Older than the panel supports, or (`lastOpenedWith` set) older than the Beads that last opened the project. */
  | { kind: 'bd-too-old'; bdVersion: string; lastOpenedWith?: string }
  | { kind: 'no-workspace' }
  | { kind: 'pre-dolt'; root: string }
  | { kind: 'needs-first-contact'; root: string; lastOpenedWith: string; bdVersion: string }
  | { kind: 'server-down'; root: string; port: number };

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** `from` depends on `to`. `kind` is bd's dependency type, kept verbatim (unknown kinds pass through). */
export type Dependency = {
  from: string;
  to: string;
  kind: string;
  createdBy: string | null;
  /** Raw bd string. Local time without a zone, so it is never converted. */
  createdAt: string | null;
};

export type Comment = { id: string; author: string | null; text: string; createdAt: string };

export type Bead = {
  id: string;
  title: string;
  /** Verbatim: custom statuses are legal. */
  status: string;
  priority: number | null;
  /** Verbatim: custom types are legal. */
  type: string;
  assignee: string | null;
  labels: string[];
  parentId: string | null;
  description: string;
  design: string;
  acceptance: string;
  notes: string;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  closedAt: string | null;
  closeReason: string | null;
  dependencies: Dependency[];
  comments: Comment[];
  /** Every other populated field, for the "More" block. */
  extra: Record<string, JsonValue>;
};

/** The fields the panel can change on a bead. A missing key means "leave as is"; `assignee: null` clears it. */
export type BeadPatch = Partial<{
  title: string;
  status: string;
  priority: number;
  assignee: string | null;
  labels: string[];
  description: string;
  design: string;
  acceptance: string;
  notes: string;
  /**
   * The reason for the close, used only when `status` moves the bead into a done category (it goes with the `close`).
   * Beads keeps it as the bead's close reason only for "closed"; for a custom done status it stays in the audit log.
   */
  closeReason: string;
  type: string;
  /** The epic to move the bead under; `null` takes it out of its epic. */
  parent: string | null;
  /** A due date as the person typed it (Beads reads it); `null` clears it. Snoozing is `deferBead`, not a patch field. */
  due: string | null;
  /** A comment to leave with a close: added first, then the bead closes. Ignored when the patch does not close the bead. */
  closeComment: string;
}>;

/**
 * The panel's values, as it showed them, for the fields a change touches. Beads stamps `updatedAt` to the second, so two
 * changes in one second share it; a field that no longer holds what the panel showed is a conflict all the same.
 * Named as the Bead stores them: `parentId`, and `due` is the stored due date (`extra.due_at`), not the text a patch types.
 */
export type ExpectedFields = Partial<{
  title: string;
  status: string;
  priority: number | null;
  assignee: string | null;
  labels: string[];
  description: string;
  design: string;
  acceptance: string;
  notes: string;
  type: string;
  parentId: string | null;
  due: string | null;
}>;

/**
 * `conflict`: the bead changed since the panel read it, nothing was written. `uncertain`: Beads did not answer in time,
 * so the change may or may not have been saved, or (`saved: true`) it was saved and only reading the result back failed,
 * so the panel should refresh; `current` is the bead as re-read, or null when that failed. `detail` is raw text for
 * "Copy details", set when something around the write went wrong that did not undo it (the panel could not note its own change).
 */
export type WriteResult =
  | { ok: true; bead: Bead; detail?: string }
  | { ok: false; conflict: true; current: Bead }
  | { ok: false; uncertain: true; current: Bead | null; saved?: true; detail?: string };

/**
 * Asking for a review. `already-open`: the bead already waits on a review of the same kind, so no second gate was made; `gate` is that one.
 * A write that failed is an error envelope, never a body here.
 */
export type GateCreateResult = { ok: true; gate: Gate; detail?: string } | { ok: false; code: 'already-open'; gate: Gate };

/**
 * Resolving a review. `already-resolved`: someone resolved it first; `resolvedBy` is who (null when the audit log names nobody)
 * and `at` when (the gate's close time, null when unknown).
 */
export type GateResolveResult = { ok: true; gateId: string; detail?: string } | { ok: false; code: 'already-resolved'; resolvedBy: string | null; at: string | null };

/**
 * Answering or dismissing a help request (a bead labelled `human`). `not-open`: the bead is no longer an open request (an agent
 * got there first, it was already answered, or the label is gone); `current` is the bead as it is now, null when it could not be
 * read. Nothing was written then. A write that failed is an error envelope, never a body here.
 */
export type HumanResult = { ok: true; bead: Bead; detail?: string } | { ok: false; code: 'not-open'; current: Bead | null };

/**
 * Where a bead stands on "can it start": `ready`, `blocked` (`blockers` are what it waits on, a review among them) or `other`
 * (not in Beads' answer: closed, snoozed, or not startable for another reason). The panel words it from this and the bead.
 */
export type ExplainResult = { state: 'ready' | 'blocked' | 'other'; blockers: Array<{ id: string; title: string; status: string }> };

/** What a new bead is made from. */
export type NewBead = { title: string; type: string; priority: number; parentId: string | null; description: string };

/** The beads around one bead: its parent, its children, and what it depends on or what depends on it (parent-child excluded). */
export type Related = {
  parent: Bead | null;
  children: Bead[];
  deps: Array<{ dep: Dependency; other: Bead | null; direction: 'out' | 'in' }>;
};

export type StatusDef = { name: string; category: string; icon: string | null };

export type ChangeKind = 'created' | 'field' | 'closed' | 'reopened' | 'deleted' | 'dep_added' | 'dep_removed' | 'comment' | 'gate_opened' | 'gate_resolved';

/** One thing that changed on a bead, as the service saw it (or as the audit log recorded it, when `historical`). */
export type ChangeEvent = {
  id: string;
  beadId: string;
  kind: ChangeKind;
  field?: string;
  from?: JsonValue;
  to?: JsonValue;
  /** Recorded name as-is; null when nothing recorded one. */
  actor: string | null;
  /** The change was written by this panel's own actor (an exact match, not any name ending in " (panel)"). */
  byPanel: boolean;
  /** When the service saw it (ISO, service clock; seen state is compared against this). For `historical` events: the audit log's time, or just its date. */
  observedAt: string;
  /** When the change was made, from the matching audit event's time, when one was found. Show `changedAt ?? observedAt`. */
  changedAt?: string;
  /** Backfilled from the audit log; the time is coarse. */
  historical?: boolean;
  /**
   * Why a bead was closed, on `closed` changes only, when the audit log's `closed` event recorded one. bd keeps no close reason on
   * a bead moved to a custom done status; this is the only place it survives.
   */
  reason?: string;
  /** The bead's title when it was last seen, on `deleted` changes the service saw (absent on history and on older saved ones). */
  title?: string;
  /** On `gate_opened` and `gate_resolved`: the gate's id. `beadId` is the bead the gate blocks, and the gate's reason rides in `reason`. */
  gateId?: string;
  /** On `gate_opened` and `gate_resolved`: the gate's kind (human, timer, ...) when the service knew it. Absent on older saved rows; read it as unknown. */
  gateKind?: string;
  /**
   * On `gate_resolved` only: how the review ended when it was not a resolve. `deleted`: the gate was removed (the audit log names no one).
   * `unlinked`: the gate is still open but no longer blocks this bead. Absent means resolved, which is also what older saved rows mean.
   */
  ended?: 'deleted' | 'unlinked';
};

/**
 * One field of a bead as a history entry changed it. `field` is the panel's own name (a `BeadPatch` key for the fields that can be
 * put back: `title`, `status`, `priority`, `assignee`, `description`, `design`, `acceptance`, `notes`, `labels`), so a restore is
 * `patch: { [field]: from }` with `expected: { [field]: to }`. Text fields use '' for none, an unset assignee is null. `text` is
 * true for the long text fields (the panel shows a compact diff). `truncated` is set when a long text was cut for transport, `from`
 * and `to` are then not the whole value and the field is never `restorable`.
 */
export type HistoryChange = { field: string; from: JsonValue; to: JsonValue; text: boolean; truncated?: true };

/**
 * A review gate as it shows in a bead's history. `what`: `requested` (the gate was made), `resolved`, `deleted` (the gate was removed,
 * nobody is named) or `unlinked` (it no longer blocks this bead). `byPanel` is false for a resolve by someone else (the audit flag).
 */
export type HistoryGate = { gateId: string; what: 'requested' | 'resolved' | 'deleted' | 'unlinked'; gateKind: string | null; reason: string | null; byPanel: boolean };

/**
 * One past version of a bead, newest first. `id` is the paging cursor. `at` is ISO. `actor` is null when nothing recorded who (bd
 * 1.3 keeps its audit log on this computer only, so a change made elsewhere has no name). A gate entry has `gate` set and no
 * `changes`; `created` marks the oldest version. `restorable` lists the fields among `changes` that can be put back.
 */
export type HistoryEntry = { id: string; at: string; actor: string | null; changes: HistoryChange[]; restorable: string[]; created?: true; gate?: HistoryGate };

/** `labelsKnown` is false when label changes could not be read (they come only from the audit log), so none are listed. */
export type HistoryResult = { entries: HistoryEntry[]; more: boolean; labelsKnown: boolean };

/** One local commit that has not reached the team remote yet. Filled by the sync service. */
export type UnpublishedChange = { commit: string; message: string; beadIds: string[]; summary: string; actor: string | null; at: string | null };

/** A bead both sides changed in the same field. `ours` and `theirs` are the two values. */
export type ConflictInfo = { beadId: string; title: string | null; ours: JsonValue; theirs: JsonValue };

/** A bead whose edit was replaced by a newer edit to the same fields, when a sync merged both sides (bd 1.3 settles that on its own). `fields` are plain words; empty when bd named none. */
export type SupersededEdit = { beadId: string; fields: string[] };

/** What a sync job is doing or ended with. The snapshot carries it so the panel needs only one poll. */
export type SyncState =
  /** `superseded` and `log` are set only when the job that just ended merged edits to the same fields (`log` is the raw text for "Copy details"). */
  | { kind: 'idle'; superseded?: SupersededEdit[]; log?: string }
  | { kind: 'running'; op: 'pull' | 'publish'; startedAt: string }
  | { kind: 'conflict'; mode: 'embedded' | 'server'; halfMerged: boolean; beads: ConflictInfo[]; log: string }
  /** `code: 'preview-stale'`: Publish stopped, nothing pushed, because what would go is no longer what was previewed. */
  | { kind: 'error'; message: string; log: string; code?: 'preview-stale' }
  | { kind: 'paused-upgrade'; message: string; log: string };

/** How current the shown data is. `localError` is plain language; `localErrorDetail` is the raw cause for "Copy details". */
export type Freshness = {
  /** Last time the service confirmed the local data matches the database (ISO). */
  localRefreshedAt: string | null;
  localError: string | null;
  localErrorDetail: string | null;
  /**
   * Set while the project cannot be read because its store is on an older schema than the installed Beads expects (`localError` then
   * says so in plain language). The panel offers the explicit update (`migrateSchema`); absent or null otherwise.
   */
  schemaUpdate?: SchemaSkew | null;
  /**
   * The one-time update as a background job (`migrateSchema` starts it and answers at once): `running` while it holds the project,
   * `failed` with the error it ended in, kept until the next try or until a read shows the store is no longer old. Absent or null otherwise.
   */
  schemaUpdateJob?: UpdateJob | null;
  /** Null until the sync service fills these in. */
  teamSyncedAt: string | null;
  unpublished: number | null;
};

/** What the events follower is doing for a project. `off`: not running (no capability, journal off, or the panel idle). `backoff` and `failed`: it stopped and the panel falls back to polling. */
export type LiveState = 'off' | 'starting' | 'following' | 'backoff' | 'failed';

/** What the installed Beads can do. Both are on for 1.3.0 and newer, off below. */
export type Capabilities = {
  /** `bd events` and the opt-in events journal. */
  eventsJournal: boolean;
  /** Claim leases (the `leases` table). */
  leases: boolean;
};

/** The gate's `await_type`, verbatim. Known: `human`, `timer`, `gh:run`, `gh:pr`, `bead`; anything else passes through, `unknown` when bd gave none. */
export type GateKind = string;

/** A gate: a bead-like blocker that waits for a person, a timer or an outside event. Only open gates are listed in a snapshot. */
export type Gate = {
  id: string;
  kind: GateKind;
  /** The text after "\n\nReason: " in the gate's description; null when there is none. */
  reason: string | null;
  /** Ids of beads with a `blocks` edge to this gate (only beads still in the export). */
  blocks: string[];
  createdBy: string | null;
  createdAt: string;
  /** Timer gates: bd's nanoseconds divided by 1e6. */
  timeoutMs: number | null;
  /** A plan approval: kind human and a reason that starts with `PLAN_APPROVAL_REASON`. */
  planApproval: boolean;
};

/** A claim lease: `bd update --claim` holds the bead for the holder until `expiresAt` unless it is renewed. */
export type Lease = { beadId: string; holder: string; /** ISO, UTC. */ expiresAt: string };

export type SnapshotResponse =
  | { unchanged: true; cursor: string; freshness: Freshness; sync: SyncState; following?: boolean }
  | {
      unchanged: false;
      cursor: string;
      /**
       * The events follower is running for this project, so a change reaches the service within moments and the panel may ask
       * more often. Not part of the cursor. Absent means false.
       */
      following?: boolean;
      workspace: WorkspaceState;
      beads: Bead[];
      statuses: StatusDef[];
      types: string[];
      readyIds: string[];
      /** Unseen beads and unseen deletions. */
      unseenIds: string[];
      /** Newest first. */
      activity: Array<ChangeEvent & { unseen: boolean }>;
      freshness: Freshness;
      sync: SyncState;
      /** A half-merged database blocks writes until it is seen to be clear. False for a workspace that is not usable. */
      writesBlocked: boolean;
      /** The name the panel's own writes are recorded under (shown as "you (panel)"); empty until the project is first read. */
      panelActor: string;
      /** Both off for a workspace that is not usable. */
      capabilities: Capabilities;
      /** Open gates only. Gate rows are never in `beads`. */
      gates: Gate[];
      /** Every gate id, open or closed: a closed gate's edge stays on the bead it blocked, and the panel hides edges to any gate. */
      gateIds: string[];
      /** Claim leases as of the last minute pass; empty below bd 1.3 and when they cannot be read. */
      leases: Lease[];
    };
