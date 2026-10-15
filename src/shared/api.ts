import type {
  Bead,
  BeadPatch,
  Comment,
  ExpectedFields,
  ExplainResult,
  GateCreateResult,
  GateResolveResult,
  HistoryResult,
  HumanResult,
  LiveState,
  NewBead,
  Related,
  SnapshotResponse,
  SyncState,
  UnpublishedChange,
  WorkspaceState,
  WriteResult,
} from './types';

/** Result of a route handler: HTTP status plus a JSON-serializable body. */
export type RouteResult = { status: number; json: unknown };

/** Route table keyed by route name; each route is served as `POST /api/<name>`. */
export type RouteTable = Record<string, (body: unknown) => Promise<RouteResult>>;

// ---------------------------------------------------------------------------------------------------------------------
// Errors: one definition, in types.ts, so the HTTP layer and the panel cannot drift.

export type { ApiError, ApiErrorCode, ErrorEnvelope as ApiErrorEnvelope, NewBead } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Requests. Every body carries `directory`: an absolute path of an existing folder. Unknown fields are ignored.
// Bead ids match /^[A-Za-z0-9._-]{1,128}$/.

export type DirectoryRequest = { directory: string };

export type WorkspaceRequest = DirectoryRequest & {
  /** The user agreed to let this version of Beads touch the project. Only valid while the state is `needs-first-contact`. */
  confirmFirstContact?: boolean;
};

export type SnapshotRequest = DirectoryRequest & {
  /** The `cursor` of the last answer; the service answers `unchanged: true` when nothing moved. */
  cursor?: string;
  /** Detect the workspace again (after the user installed Beads, fixed the project, or started its server). */
  refreshWorkspace?: boolean;
};

export type BeadRequest = DirectoryRequest & { id: string };

export type UpdateRequest = DirectoryRequest & {
  id: string;
  /** The bead's `updatedAt` as the panel last saw it; a different value on disk is a conflict and nothing is written. */
  expectedUpdatedAt: string;
  patch: BeadPatch;
  /** What the panel showed for the fields `patch` changes; any that differ now is a conflict and nothing is written. */
  expected?: ExpectedFields;
};

export type CreateRequest = DirectoryRequest & { input: NewBead };

export type CommentRequest = DirectoryRequest & { id: string; text: string };

/** `from` depends on `to`. `kind` is bd's dependency type, needed to add; removing names the pair and ignores it. */
export type DependencyRequest = DirectoryRequest & { from: string; to: string } & ({ op: 'add'; kind: string } | { op: 'remove'; kind?: string });

/**
 * Ask for a review of a bead: a human gate that blocks it. `reason` is 1 to 500 characters on one line; absent means `REVIEW_REASON`
 * (plan approval sends `PLAN_APPROVAL_REASON`). `kind` is only ever `human`.
 */
export type GateCreateRequest = DirectoryRequest & { id: string; reason?: string; kind?: 'human' };

/** Resolve a review gate. `reason` is the optional note, under the same limits as when asking. */
export type GateResolveRequest = DirectoryRequest & { gateId: string; reason?: string };

/** Snooze a bead until `until` (date text as typed; Beads reads it), or with `null` until someone brings it back. Answers like `update`. */
export type DeferRequest = DirectoryRequest & { id: string; expectedUpdatedAt: string; until: string | null; reason?: string };

/** Bring a snoozed bead back. */
export type UndeferRequest = DirectoryRequest & { id: string; expectedUpdatedAt: string };

/** Close a bead as replaced by `with`. */
export type SupersedeRequest = DirectoryRequest & { id: string; with: string; expectedUpdatedAt: string };

/** Close a bead as a duplicate of `of`. */
export type DuplicateRequest = DirectoryRequest & { id: string; of: string; expectedUpdatedAt: string };

export type ExplainRequest = DirectoryRequest & { id: string };

/** Answer a help request; the bead is closed with the answer as a comment. `response` is 1 to 16,000 characters once trimmed. */
export type HumanRespondRequest = DirectoryRequest & { id: string; response: string };

/** Dismiss a help request. `reason` is at most 500 characters on one line; absent or blank means none. */
export type HumanDismissRequest = DirectoryRequest & { id: string; reason?: string };

/**
 * A bead's past versions, read when the History section opens (never polled). `before` is the `id` of the last entry already shown,
 * for the next page; `limit` is 1 to 50 entries, default 20. A restore is the `update` route, not a route of its own.
 */
export type HistoryRequest = DirectoryRequest & { id: string; before?: string; limit?: number };

/** A project memory: a note every agent session in the project starts with. `changedAt` and `changedBy` are the last change; null when unknown. */
export type Memory = { key: string; text: string; changedAt: string | null; changedBy: string | null };

/** `query` keeps the memories whose key or text contains it (case does not matter). */
export type MemoriesRequest = DirectoryRequest & { query?: string };

/**
 * Save a memory. `text` is 1 to 4,000 characters (longer is refused, never cut). Without `expectedText` it is a new memory under `key`
 * (made from the text when absent) and an existing key is refused as `changed`. With `expectedText` it edits `key`, and any stored text
 * other than `expectedText` is refused as `changed`.
 */
export type RememberRequest = DirectoryRequest & { text: string; key?: string; expectedText?: string };

/** Forget a memory; refused as `changed` unless its stored text is still `expectedText`. */
export type ForgetRequest = DirectoryRequest & { key: string; expectedText: string };

/**
 * Turn live updates on for the project. Refused unless `confirm` is literally `true`: this is the one request that changes a
 * project setting, and it edits the project's own `.beads/config.yaml`, which is shared with the team if that file is committed.
 */
export type EnableEventsRequest = DirectoryRequest & { confirm: true };

/**
 * Update the project's store to the schema the installed Beads expects, for a project the panel cannot read (`freshness.schemaUpdate`
 * is set, or a read failed as `needs-schema-update`). Refused unless `confirm` is literally `true`: it rewrites the project's database,
 * and the panel never does it by itself. Refused while a sync runs or the team merge is half done, like any write.
 */
export type MigrateSchemaRequest = DirectoryRequest & { confirm: true };

/** `all: true` marks every bead seen; otherwise `ids` (which may name deleted beads, to dismiss their deletion). */
export type SeenRequest = DirectoryRequest & { ids?: string[]; all?: boolean };

/**
 * `expectedHead`: the `head` of the preview the person confirmed. When the local head is another commit now, nothing is
 * published and the answer is `preview-stale`, so what goes is always what was shown.
 */
export type PublishRequest = DirectoryRequest & { expectedHead: string };

// ---------------------------------------------------------------------------------------------------------------------
// Responses

export type BeadResponse = { bead: Bead; related: Related };
export type CreateResponse = { bead: Bead };
export type CommentResponse = { comment: Comment };
export type DependencyResponse = { ok: true };
export type SeenResponse = { unseenIds: string[] };

/** Newest change first. `fingerprint` covers every key and text (not the search), so a page can tell it went stale. */
export type MemoriesResult = { memories: Memory[]; fingerprint: string };
/** `changed`: the memory is not as the person saw it; `current` is what is stored now, null when it is gone. Nothing was written. */
export type MemoryWriteResult = { ok: true; memory: Memory | null } | { ok: false; code: 'changed'; current: Memory | null };

/**
 * Live updates for a project. `available`: the installed Beads can do it (1.3 or newer); false hides the whole feature, and `journal`
 * is then `off`. `journal`: whether the project has it switched on (`unknown` when Beads could not say). `live`: what the follower is doing.
 */
export type EventsStatusResult = { available: boolean; journal: 'on' | 'off' | 'unknown'; live: LiveState };
/** Switched on. A refusal (too old, a sync running, the setting not taking) is an error envelope, never a body. `status` is read after the change. */
export type EnableEventsResult = { ok: true; status: EventsStatusResult };

/**
 * The update was started (it runs as a background job, so this answers at once). How it stands, and how it ends, is `freshness.schemaUpdateJob`
 * in the snapshot: running, or failed with the code and words an error envelope would carry (`update-blocked-shared`, `uncertain` with `saved`, ...).
 * Once it worked, the next snapshot shows the beads.
 */
export type MigrateSchemaResult = { ok: true };

/** What the panel hands to OpenChamber as an attachment: `text` is at most 16,000 characters, `title` at most 200. */
export type ContextResponse = { id: string; title: string; text: string; url: string };

/**
 * `noRemote: true` when the project has no shared copy with the team (`changes` is then empty). `head` is the local
 * commit the list was read from (read before the list), to send back as `expectedHead` with Publish. `total` is how
 * many changes there are in all, read in the same turn; `changes` stops at 1,000. `teamEmpty: true` when the team's
 * shared copy has no branch yet: Publish cannot set it up, so the panel offers no Confirm. `teamUnseen: true` when this
 * computer has never fetched the team's copy, so whether it is empty is not known: Sync first, again with no Confirm.
 */
export type SyncPreviewResponse = { changes: UnpublishedChange[]; noRemote?: true; head?: string; total?: number; teamEmpty?: true; teamUnseen?: true };
export type SyncResponse = { sync: SyncState };

/** Route name to what the panel sends and what comes back on a 2xx. */
export type ApiRoutes = {
  workspace: { request: WorkspaceRequest; response: WorkspaceState };
  snapshot: { request: SnapshotRequest; response: SnapshotResponse };
  bead: { request: BeadRequest; response: BeadResponse };
  update: { request: UpdateRequest; response: WriteResult };
  deferBead: { request: DeferRequest; response: WriteResult };
  undeferBead: { request: UndeferRequest; response: WriteResult };
  supersede: { request: SupersedeRequest; response: WriteResult };
  duplicate: { request: DuplicateRequest; response: WriteResult };
  explain: { request: ExplainRequest; response: ExplainResult };
  create: { request: CreateRequest; response: CreateResponse };
  comment: { request: CommentRequest; response: CommentResponse };
  dependency: { request: DependencyRequest; response: DependencyResponse };
  gateCreate: { request: GateCreateRequest; response: GateCreateResult };
  gateResolve: { request: GateResolveRequest; response: GateResolveResult };
  humanRespond: { request: HumanRespondRequest; response: HumanResult };
  humanDismiss: { request: HumanDismissRequest; response: HumanResult };
  history: { request: HistoryRequest; response: HistoryResult };
  memories: { request: MemoriesRequest; response: MemoriesResult };
  memoryRemember: { request: RememberRequest; response: MemoryWriteResult };
  memoryForget: { request: ForgetRequest; response: MemoryWriteResult };
  seen: { request: SeenRequest; response: SeenResponse };
  eventsStatus: { request: DirectoryRequest; response: EventsStatusResult };
  enableEvents: { request: EnableEventsRequest; response: EnableEventsResult };
  migrateSchema: { request: MigrateSchemaRequest; response: MigrateSchemaResult };
  context: { request: BeadRequest; response: ContextResponse };
  'sync-preview': { request: DirectoryRequest; response: SyncPreviewResponse };
  'sync-pull': { request: DirectoryRequest; response: SyncResponse };
  'sync-publish': { request: PublishRequest; response: SyncResponse };
  'conflict-context': { request: DirectoryRequest; response: ContextResponse };
};

export type ApiRouteName = keyof ApiRoutes;
export type ApiRequest<N extends ApiRouteName> = ApiRoutes[N]['request'];
export type ApiResponse<N extends ApiRouteName> = ApiRoutes[N]['response'];
