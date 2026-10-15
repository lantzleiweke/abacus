/**
 * Every code a route can answer with outside 2xx.
 *  - `BAD_REQUEST`, `BODY_TOO_LARGE`, `UNAUTHORIZED`, `NOT_FOUND`, `INTERNAL`: the HTTP layer (`INTERNAL`: something unexpected broke).
 *  - `workspace`: the project cannot be used; `workspace` on the error says why.
 *  - `busy`: Beads is locked or did not answer in time. `beads-error`: Beads failed some other way (raw text only in `detail`).
 *  - `writes-blocked`: the database is stuck halfway through a team merge. `sync-running`: a sync job holds the project.
 *  - `preview-stale`: Publish was refused because local changes landed after the preview the person confirmed.
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
  | 'dep-exists'
  | 'merge-conflict'
  | 'uncertain'
  | 'no-bd'
  | 'failed'
  | 'preview-stale';

/**
 * What the service says when a request fails. `message` is plain language; `detail` is the raw text for "Copy details";
 * `workspace` is set with code `workspace` (the project cannot be used, and why); `saved` is set when a failed write is
 * known to be in and only reading it back failed (the panel refreshes).
 */
export type ApiError = { code: ApiErrorCode; message: string; detail?: string; workspace?: WorkspaceState; saved?: true };

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
}>;

/**
 * The panel's values, as it showed them, for the fields a change touches. Beads stamps `updatedAt` to the second, so two
 * changes in one second share it; a field that no longer holds what the panel showed is a conflict all the same.
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

/** What a new bead is made from. */
export type NewBead = { title: string; type: string; priority: number; parentId: string | null; description: string };

/** The beads around one bead: its parent, its children, and what it depends on or what depends on it (parent-child excluded). */
export type Related = {
  parent: Bead | null;
  children: Bead[];
  deps: Array<{ dep: Dependency; other: Bead | null; direction: 'out' | 'in' }>;
};

export type StatusDef = { name: string; category: string; icon: string | null };

export type ChangeKind = 'created' | 'field' | 'closed' | 'reopened' | 'deleted' | 'dep_added' | 'dep_removed' | 'comment';

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
};

/** One local commit that has not reached the team remote yet. Filled by the sync service. */
export type UnpublishedChange = { commit: string; message: string; beadIds: string[]; summary: string; actor: string | null; at: string | null };

/** A bead both sides changed in the same field. `ours` and `theirs` are the two values. */
export type ConflictInfo = { beadId: string; title: string | null; ours: JsonValue; theirs: JsonValue };

/** What a sync job is doing or ended with. The snapshot carries it so the panel needs only one poll. */
export type SyncState =
  | { kind: 'idle' }
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
  /** Null until the sync service fills these in. */
  teamSyncedAt: string | null;
  unpublished: number | null;
};

export type SnapshotResponse =
  | { unchanged: true; cursor: string; freshness: Freshness; sync: SyncState }
  | {
      unchanged: false;
      cursor: string;
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
    };
