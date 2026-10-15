import type {
  Bead,
  BeadPatch,
  Comment,
  ExpectedFields,
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
  create: { request: CreateRequest; response: CreateResponse };
  comment: { request: CommentRequest; response: CommentResponse };
  dependency: { request: DependencyRequest; response: DependencyResponse };
  seen: { request: SeenRequest; response: SeenResponse };
  context: { request: BeadRequest; response: ContextResponse };
  'sync-preview': { request: DirectoryRequest; response: SyncPreviewResponse };
  'sync-pull': { request: DirectoryRequest; response: SyncResponse };
  'sync-publish': { request: PublishRequest; response: SyncResponse };
  'conflict-context': { request: DirectoryRequest; response: ContextResponse };
};

export type ApiRouteName = keyof ApiRoutes;
export type ApiRequest<N extends ApiRouteName> = ApiRoutes[N]['request'];
export type ApiResponse<N extends ApiRouteName> = ApiRoutes[N]['response'];
