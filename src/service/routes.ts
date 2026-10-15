import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import type { ApiError, ApiErrorCode, ApiResponse, ApiRouteName, EventsStatusResult, NewBead, RouteResult, RouteTable } from '../shared/api';
import type { Bead, BeadPatch, ExpectedFields, LiveState, SchemaSkew, SyncState, WorkspaceState } from '../shared/types';
import { WriteError, panelActor, type BdProvider } from './bd/adapter';
import { capText, DETAIL_MAX, errorDetail, isBusyError, isNoDolt, NO_DOLT_TEXT, readErrorText, SCHEMA_UPDATE_TEXT, schemaSkewOf } from './errors';
import { noteBdVersion, storeWritesUtc } from './bd/audit';
import { capabilitiesFor } from './capabilities';
import { beadUrl, buildConflictContext, buildContext, relatedFor } from './context';
import { REVIEW_REASON } from './gates';
import { readHistory } from './history';
import { follower } from './live';
import { forgetMemory, listMemories, rememberMemory } from './memories';
import { explainBead } from './explain';
import { cachedBeads, cachedSchemaSkew, getSnapshot, projectStore, providerFor, readFailureDropped, resolveWorkspace, type ProjectStore } from './snapshot';
import { startUpdate, updateJob } from './schema-update';
import { checkHalfMerge, localHead, PREVIEW_STALE_TEXT, publishPreview, startPublish, startPull, syncState, writesBlocked } from './sync';

// The HTTP API the panel calls (`POST /api/<name>`, see `ApiRoutes` in shared/api.ts). Every route that acts on a project
// resolves the request's `directory` through `resolveWorkspace` and uses only the root it returns, so it is always the same
// root string the snapshot cache is keyed by. Nothing here talks to `bd` or `git` directly; it only wires the other modules.

/** The service modules the routes use. Tests hand in fakes; the real ones are `defaultDeps`. */
export type RouteDeps = {
  resolveWorkspace: typeof resolveWorkspace;
  getSnapshot: typeof getSnapshot;
  projectStore: (root: string) => Promise<Pick<ProjectStore, 'markSeen' | 'save' | 'allUnseenIds' | 'confirmFirstContact' | 'firstContactConfirmedFor' | 'restoreFirstContact'>>;
  providerFor: (root: string, mode: 'embedded' | 'server') => Pick<BdProvider, 'update' | 'create' | 'comment' | 'dependency' | 'gateCreate' | 'gateResolve' | 'humanRespond' | 'humanDismiss' | 'history' | 'gateHistory' | 'deferBead' | 'undeferBead' | 'supersede' | 'duplicate' | 'readyExplain' | 'eventsJournal' | 'enableEventsJournal' | 'migrateSchema'>;
  /** Project memories. Tests hand in fakes. */
  memories: { list: typeof listMemories; remember: typeof rememberMemory; forget: typeof forgetMemory };
  cachedBeads: typeof cachedBeads;
  /** The two schema versions while the root's last read was refused for an older store, else null. Writes are refused meanwhile. */
  schemaSkew: typeof cachedSchemaSkew;
  /** Drops a cached read failure after the project's schema was updated, so the next snapshot reads normally. */
  readFailureDropped: typeof readFailureDropped;
  /** The one-time update as a background job: start it, and how it stands. */
  startUpdate: typeof startUpdate;
  updateJob: typeof updateJob;
  explain: typeof explainBead;
  panelActor: typeof panelActor;
  preview: typeof publishPreview;
  localHead: typeof localHead;
  startPull: typeof startPull;
  startPublish: typeof startPublish;
  syncState: typeof syncState;
  writesBlocked: typeof writesBlocked;
  checkHalfMerge: typeof checkHalfMerge;
  /** The events follower: what it is doing, and the note that the journal setting just changed. */
  live: { state: (root: string) => LiveState; journalChanged: (root: string) => void };
  beadUrl: typeof beadUrl;
};

const defaultDeps: RouteDeps = {
  resolveWorkspace, getSnapshot, projectStore, providerFor, memories: { list: listMemories, remember: rememberMemory, forget: forgetMemory }, cachedBeads, schemaSkew: cachedSchemaSkew, readFailureDropped, startUpdate, updateJob, explain: explainBead, panelActor, preview: publishPreview, localHead, startPull, startPublish,
  syncState, writesBlocked, checkHalfMerge, beadUrl,
  live: { state: (root) => follower().state(root).state, journalChanged: (root) => follower().journalChanged(root) },
};

/** Most gates one History read looks up. */
const MAX_HISTORY_GATES = 50;
const ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const HEAD_PATTERN = /^[a-z0-9]{8,64}$/;
/** What the plain-language errors say; the raw text goes only in `detail`. */
const SYNC_RUNNING_TEXT = 'Sync in progress. Try again when it finishes.';
const UNEXPECTED_TEXT = 'Something went wrong.';
const LIVE_UNSUPPORTED_TEXT = 'Live updates need a newer version of Beads.';
/** The first heading word that names a sync problem wins by this rank; a lower number is a better match. */
const HEADING_RANKS: Array<[RegExp, number]> = [[/\bsync\b/i, 0], [/\bdolt\b/i, 1], [/\bbeads?\b/i, 2]];

// ---------------------------------------------------------------------------------------------------------------------
// Results and rejections

/** A 2xx answer; the route's name ties its body to `ApiRoutes`, so a body that drifts from the wire type does not compile. */
const ok = <N extends ApiRouteName>(_route: N, json: ApiResponse<N>): RouteResult => ({ status: 200, json });

type Extra = { detail?: string; workspace?: WorkspaceState; saved?: true; schemaUpdate?: SchemaSkew };

function fail(status: number, code: ApiErrorCode, message: string, extra: Extra = {}): RouteResult {
  const error: ApiError = { code, message };
  if (extra.detail !== undefined) error.detail = capText(extra.detail, DETAIL_MAX);
  if (extra.workspace !== undefined) error.workspace = extra.workspace;
  if (extra.saved) error.saved = true;
  if (extra.schemaUpdate !== undefined) error.schemaUpdate = extra.schemaUpdate;
  return { status, json: { error } };
}

/** Thrown to answer a request early with an error envelope. */
class Reject extends Error {
  constructor(readonly result: RouteResult) {
    super('rejected');
  }
}

const reject = (status: number, code: ApiErrorCode, message: string, extra?: Extra): Reject => new Reject(fail(status, code, message, extra));
const badRequest = (message: string): Reject => reject(400, 'BAD_REQUEST', message);

/**
 * A failed read of the project: a lock or timeout is "busy", anything else "couldn't read". Raw text only in `detail`.
 * `retrying` is for the poll, which asks again by itself: either answer then says so instead of telling the person to try again.
 */
function readFailure(error: unknown, retrying: boolean): Reject {
  const skew = schemaSkewOf(error);
  if (skew) return reject(409, 'needs-schema-update', readErrorText(error, retrying), { detail: errorDetail(error), schemaUpdate: skew });
  const busy = isBusyError(error);
  return reject(busy ? 503 : 500, busy ? 'busy' : 'beads-error', readErrorText(error, retrying), { detail: errorDetail(error) });
}

/** Runs a read and turns any failure into a rejection with plain copy. */
async function reading<T>(run: () => Promise<T>, retrying = false): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw readFailure(error, retrying);
  }
}

/** A read for Sync or Publish: like `reading`, but a missing Dolt tool says what Publish needs. */
async function syncReading<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isNoDolt(error)) throw reject(500, 'beads-error', NO_DOLT_TEXT, { detail: errorDetail(error) });
    throw readFailure(error, false);
  }
}

const WORKSPACE_TEXT: Record<WorkspaceState['kind'], string> = {
  ok: 'This project is ready.',
  'no-bd': "Beads isn't installed on this computer.",
  'bd-too-old': "This panel can't use the installed Beads version with this project.",
  'no-workspace': "This folder doesn't use Beads.",
  'pre-dolt': "This project uses an older Beads format that this panel can't read.",
  'needs-first-contact': 'Confirm that Beads may open this project first.',
  'server-down': "This project's Beads server isn't running.",
};

const workspaceReject = (workspace: WorkspaceState, message: string = WORKSPACE_TEXT[workspace.kind]): Reject => reject(409, 'workspace', message, { workspace });

const WRITE_STATUS: Record<WriteError['code'], number> = {
  invalid: 400,
  'not-found': 404,
  blocked: 409,
  claimed: 409,
  'dep-exists': 409,
  'merge-conflict': 409,
  busy: 503,
  uncertain: 504,
  'no-bd': 500,
  unsupported: 501,
  'update-blocked-shared': 409,
  failed: 500,
};

// ---------------------------------------------------------------------------------------------------------------------
// Validation. Unknown fields are ignored.

type Body = Record<string, unknown>;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

async function validDirectory(body: Body): Promise<string> {
  const { directory } = body;
  const bad = badRequest('directory must be the absolute path of an existing folder.');
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw bad;
  try {
    if (!(await stat(directory)).isDirectory()) throw bad;
  } catch {
    throw bad;
  }
  return directory;
}

function idOf(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw badRequest(`${field} is not a valid bead id.`);
  return value;
}

/** A history cursor is an entry id the service made: short, no spaces. */
function cursorOf(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(value)) throw badRequest('before is not a history entry id.');
  return value;
}

function pageSizeOf(value: unknown): number {
  if (value === undefined) return 20;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 50) throw badRequest('limit must be a whole number from 1 to 50.');
  return value;
}

function stringOf(value: unknown, field: string): string {
  if (typeof value !== 'string') throw badRequest(`${field} must be text.`);
  return value;
}

function optionalBoolean(body: Body, field: string): boolean {
  const value = body[field];
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw badRequest(`${field} must be true or false.`);
  return value;
}

/** Longest memory key or search the routes accept; the memory rules are checked where the memory is saved. */
const MEMORY_KEY_MAX = 200;

/** A key to find or change a memory: 1 to 200 characters, no control characters. */
function memoryKeyOf(value: unknown, field: string): string {
  const key = stringOf(value, field).trim();
  if (key === '' || key.length > MEMORY_KEY_MAX || /[\u0000-\u001f\u007f]/.test(key)) throw badRequest(`${field} must be 1 to ${MEMORY_KEY_MAX} characters on one line.`);
  return key;
}

/** What the person saw of a memory's text, or absent. Never null: absent is how a new memory is asked for. */
function optionalMemoryText(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : stringOf(value, field);
}

const REASON_MAX = 500;

/** A reason, trimmed: 1 to 500 characters on one line. Absent is `undefined`. */
function reasonOf(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const text = stringOf(value, 'reason').trim();
  if (text === '' || text.length > REASON_MAX || /[\r\n]/.test(text)) throw badRequest(`reason must be one line of 1 to ${REASON_MAX} characters.`);
  return text;
}

const RESPONSE_MAX = 16_000;

/** An answer to a help request, trimmed: 1 to 16,000 characters, line breaks kept. */
function responseOf(value: unknown): string {
  const text = stringOf(value, 'response').trim();
  if (text === '' || text.length > RESPONSE_MAX) throw badRequest(`response must be 1 to ${RESPONSE_MAX} characters.`);
  return text;
}

const PATCH_STRINGS = ['title', 'status', 'description', 'design', 'acceptance', 'notes', 'closeReason', 'closeComment', 'type'] as const;

/** Only known fields with the right types are kept, so the adapter never sees a shape it does not expect. */
function patchOf(value: unknown): BeadPatch {
  if (!isObject(value)) throw badRequest('patch must be an object.');
  const patch: BeadPatch = {};
  for (const key of PATCH_STRINGS) {
    if (value[key] === undefined) continue;
    patch[key] = stringOf(value[key], `patch.${key}`);
  }
  if (value.priority !== undefined) {
    if (typeof value.priority !== 'number' || !Number.isFinite(value.priority)) throw badRequest('patch.priority must be a number.');
    patch.priority = value.priority;
  }
  if (value.assignee !== undefined) {
    if (value.assignee !== null && typeof value.assignee !== 'string') throw badRequest('patch.assignee must be text or null.');
    patch.assignee = value.assignee;
  }
  if (value.labels !== undefined) {
    if (!Array.isArray(value.labels) || !value.labels.every((label) => typeof label === 'string')) throw badRequest('patch.labels must be a list of text.');
    patch.labels = value.labels as string[];
  }
  if (value.parent !== undefined) patch.parent = value.parent === null ? null : idOf(value.parent, 'patch.parent');
  if (value.due !== undefined) {
    if (value.due !== null && typeof value.due !== 'string') throw badRequest('patch.due must be text or null.');
    patch.due = value.due;
  }
  return patch;
}

const EXPECTED_STRINGS = ['title', 'status', 'description', 'design', 'acceptance', 'notes', 'type'] as const;

/** The shown values for a change, checked like the patch. Absent is none. */
function expectedOf(value: unknown): ExpectedFields {
  if (value === undefined) return {};
  if (!isObject(value)) throw badRequest('expected must be an object.');
  const expected: ExpectedFields = {};
  for (const key of EXPECTED_STRINGS) {
    if (value[key] === undefined) continue;
    expected[key] = stringOf(value[key], `expected.${key}`);
  }
  if (value.priority !== undefined) {
    if (value.priority !== null && (typeof value.priority !== 'number' || !Number.isFinite(value.priority))) throw badRequest('expected.priority must be a number or null.');
    expected.priority = value.priority;
  }
  if (value.assignee !== undefined) {
    if (value.assignee !== null && typeof value.assignee !== 'string') throw badRequest('expected.assignee must be text or null.');
    expected.assignee = value.assignee;
  }
  if (value.labels !== undefined) {
    if (!Array.isArray(value.labels) || !value.labels.every((label) => typeof label === 'string')) throw badRequest('expected.labels must be a list of text.');
    expected.labels = value.labels as string[];
  }
  if (value.parentId !== undefined) expected.parentId = value.parentId === null ? null : idOf(value.parentId, 'expected.parentId');
  if (value.due !== undefined) {
    if (value.due !== null && typeof value.due !== 'string') throw badRequest('expected.due must be text or null.');
    expected.due = value.due;
  }
  return expected;
}

function newBeadOf(value: unknown): NewBead {
  if (!isObject(value)) throw badRequest('input must be an object.');
  if (typeof value.priority !== 'number' || !Number.isFinite(value.priority)) throw badRequest('input.priority must be a number.');
  const parentId = value.parentId === undefined || value.parentId === null ? null : idOf(value.parentId, 'input.parentId');
  const description = value.description === undefined ? '' : stringOf(value.description, 'input.description');
  return { title: stringOf(value.title, 'input.title'), type: stringOf(value.type, 'input.type'), priority: value.priority, parentId, description };
}

// ---------------------------------------------------------------------------------------------------------------------
// AGENTS.md rules for a sync problem

/** How well a heading names a sync problem: 0 for "sync", 1 for "dolt", 2 for "beads"; null when it names none. */
function headingRank(title: string): number | null {
  for (const [pattern, rank] of HEADING_RANKS) if (pattern.test(title)) return rank;
  return null;
}

/**
 * The part of the project's AGENTS.md about a sync problem: the best heading that names sync, then dolt, then beads (the
 * shallowest below H1, then the first, among equals; an H1 only when nothing deeper has that rank), down to the next
 * heading of the same or a higher level. With no such heading, the whole text (the context builder cuts it). Null when
 * there is no file or it is empty. Lines inside code fences are never headings.
 */
export function rulesFrom(text: string): string | null {
  if (text.trim() === '') return null;
  const lines = text.split(/\r\n|\r|\n/);
  const headings: Array<{ index: number; level: number; rank: number | null }> = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) headings.push({ index, level: heading[1]!.length, rank: headingRank(heading[2]!) });
  });
  const named = headings.filter((h) => h.rank !== null);
  if (named.length === 0) return lines.join('\n');
  const bestRank = Math.min(...named.map((h) => h.rank!));
  const ofRank = named.filter((h) => h.rank === bestRank);
  // Among equals the shallowest heading below H1 wins (its section keeps its children); an H1 only when nothing deeper has the rank.
  const pool = ofRank.some((h) => h.level > 1) ? ofRank.filter((h) => h.level > 1) : ofRank;
  const best = pool.reduce((a, b) => (b.level < a.level ? b : a));
  const next = headings.find((h) => h.index > best.index && h.level <= best.level);
  return lines.slice(best.index, next?.index ?? lines.length).join('\n').trim();
}

async function readRules(root: string): Promise<string | null> {
  try {
    return rulesFrom(await readFile(join(root, 'AGENTS.md'), 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export function createRoutes(deps: RouteDeps = defaultDeps): Record<ApiRouteName, RouteTable[string]> {
  /** The project for a directory, or a rejection that carries why it cannot be used. */
  async function project(directory: string): Promise<{ root: string; workspace: Extract<WorkspaceState, { kind: 'ok' }> }> {
    const resolved = await reading(() => deps.resolveWorkspace(directory));
    const { workspace, root } = resolved;
    if (root === null || workspace.kind !== 'ok') throw workspaceReject(workspace);
    return { root, workspace };
  }

  /** The cached beads of a root; one snapshot read fills a cache that has not loaded yet. */
  async function beadsOf(directory: string, root: string): Promise<Bead[]> {
    let all = deps.cachedBeads(root);
    if (all === null) {
      const snapshot = await reading(() => deps.getSnapshot(directory));
      all = deps.cachedBeads(root);
      if (all === null) throw reject(500, 'beads-error', readErrorText(undefined, false), { detail: snapshot.freshness?.localErrorDetail ?? undefined });
    }
    return all;
  }

  async function findBead(directory: string, root: string, id: string): Promise<{ bead: Bead; all: Bead[] }> {
    const all = await beadsOf(directory, root);
    const bead = all.find((b) => b.id === id);
    if (!bead) throw reject(404, 'not-found', 'That bead no longer exists.');
    return { bead, all };
  }

  /** A sync job holds the project's queue, so anything that would wait behind it is refused instead of timing out. */
  function refuseWhileSyncing(root: string, updating = false): void {
    if (deps.syncState(root).kind === 'running') throw reject(409, 'sync-running', SYNC_RUNNING_TEXT);
    // The one-time update holds the queue the same way, and nothing can be read until it ends.
    // (The update's own write is the one thing that runs meanwhile.)
    const skew = deps.schemaSkew(root);
    if (!updating && deps.updateJob(root)?.kind === 'running' && skew) throw reject(409, 'needs-schema-update', SCHEMA_UPDATE_TEXT, { schemaUpdate: skew });
  }

  function refuseWrites(root: string, updating = false): void {
    if (deps.writesBlocked(root)) throw reject(409, 'writes-blocked', 'The team sync left this project half merged. Resolve the sync problem first.');
    refuseWhileSyncing(root, updating);
  }

  /** Live updates as Settings shows them. Reads the setting only with the capability; a failed read is `unknown`, never an error. Never starts the follower. */
  async function eventsStatusOf(root: string, mode: 'embedded' | 'server', bdVersion: string): Promise<EventsStatusResult> {
    const live = deps.live.state(root);
    if (!capabilitiesFor(bdVersion).eventsJournal) return { available: false, journal: 'off', live };
    // The read queues behind the project's other calls, and a sync holds that queue for minutes.
    refuseWhileSyncing(root);
    const journal = await deps.providerFor(root, mode).eventsJournal().catch(() => 'unknown' as const);
    return { available: true, journal, live };
  }

  /** A write against the root's own provider (so panel-write marks and error detail land in the live cache). WriteError becomes the envelope. */
  async function write<T>(root: string, mode: 'embedded' | 'server', run: (provider: ReturnType<RouteDeps['providerFor']>, actor: string) => Promise<T>, opts: { updatingSchema?: true } = {}): Promise<T> {
    refuseWrites(root, opts.updatingSchema === true);
    // bd 1.3 migrates an older store the moment any write opens it, so while the project waits for the person's confirm, no write may run. Only the update itself passes.
    const skew = opts.updatingSchema ? null : deps.schemaSkew(root);
    if (skew) throw reject(409, 'needs-schema-update', SCHEMA_UPDATE_TEXT, { schemaUpdate: skew });
    try {
      return await run(deps.providerFor(root, mode), await deps.panelActor(root));
    } catch (error) {
      if (error instanceof Reject) throw error;
      if (!(error instanceof WriteError)) throw reject(500, 'failed', 'The change could not be saved.', { detail: errorDetail(error) });
      // The team merge may have been left half done: look, so writes stop and the panel shows the conflict. The user needs the
      // write's own error now, so the check runs on its own (it keeps what is known when it fails, and never throws).
      if (error.code === 'merge-conflict' || /in conflict/i.test(`${error.message}\n${error.detail}`)) void deps.checkHalfMerge(root, mode);
      throw reject(WRITE_STATUS[error.code], error.code, error.message, { detail: error.detail, ...(error.saved ? { saved: true as const } : {}) });
    }
  }

  const handle =
    (run: (body: Body, directory: string) => Promise<RouteResult>) =>
    async (raw: unknown): Promise<RouteResult> => {
      try {
        const body = (isObject(raw) ? raw : {}) as Body;
        return await run(body, await validDirectory(body));
      } catch (error) {
        if (error instanceof Reject) return error.result;
        // Anything not meant as an answer: plain copy for the user, the raw text only in `detail`.
        return fail(500, 'INTERNAL', UNEXPECTED_TEXT, { detail: errorDetail(error) });
      }
    };

  return {
    workspace: handle(async (body, directory) => {
      const confirm = optionalBoolean(body, 'confirmFirstContact');
      const { workspace } = await reading(() => deps.resolveWorkspace(directory));
      if (!confirm) return ok('workspace', workspace);
      if (workspace.kind !== 'needs-first-contact') throw workspaceReject(workspace, 'This project is not waiting for confirmation.');
      // Consent is kept per bd version in the project's own state file, which needs the root the state carries.
      const store = await deps.projectStore(workspace.root).catch((error: unknown) => {
        throw reject(500, 'beads-error', "Couldn't save your confirmation.", { detail: errorDetail(error) });
      });
      const before = store.firstContactConfirmedFor();
      store.confirmFirstContact(workspace.bdVersion);
      try {
        await store.save();
      } catch (error) {
        // Unsaved consent would last only until the service restarts, and the panel would be told it is in.
        store.restoreFirstContact(before);
        throw reject(500, 'beads-error', "Couldn't save your confirmation.", { detail: errorDetail(error) });
      }
      const next = await reading(() => deps.resolveWorkspace(directory, { refreshWorkspace: true }));
      return ok('workspace', next.workspace);
    }),

    snapshot: handle(async (body, directory) => {
      const { cursor } = body;
      if (cursor !== undefined && typeof cursor !== 'string') throw badRequest('cursor must be text.');
      const refresh = optionalBoolean(body, 'refreshWorkspace');
      // The snapshot is the poll: the panel asks again by itself, so a busy first detection says it is retrying.
      return ok('snapshot', await reading(() => deps.getSnapshot(directory, cursor, refresh), true));
    }),

    bead: handle(async (body, directory) => {
      const id = idOf(body.id, 'id');
      const { root } = await project(directory);
      const { bead, all } = await findBead(directory, root, id);
      return ok('bead', { bead, related: relatedFor(bead, all) });
    }),

    history: handle(async (body, directory) => {
      const id = idOf(body.id, 'id');
      const before = cursorOf(body.before);
      const pageSize = pageSizeOf(body.limit);
      const { root, workspace } = await project(directory);
      // The reads queue behind the project's other calls, and a sync holds that queue for minutes.
      refuseWhileSyncing(root);
      const { bead, all } = await findBead(directory, root, id);
      const provider = deps.providerFor(root, workspace.mode);
      // A review gate is not a bead, and its link to this bead stays after it closes: a `blocks` link to something the bead cache
      // does not hold is a gate (or one that was deleted, which then has no row and is not found). The gates' own records name who and when.
      const known = new Set(all.map((b) => b.id));
      const gateIds = [...new Set(bead.dependencies.filter((d) => d.kind === 'blocks' && !known.has(d.to) && ID_PATTERN.test(d.to)).map((d) => d.to))].slice(0, MAX_HISTORY_GATES);
      noteBdVersion(root, workspace.bdVersion);
      const gateRead = await provider.gateHistory(gateIds, { utc: storeWritesUtc(workspace.bdVersion) }).catch(() => null);
      // What the audit log cannot say (a gate deleted, a link removed) is what the service saw, from the activity it keeps.
      const snapshot = await reading(() => deps.getSnapshot(directory)).catch(() => null);
      const activity = snapshot && !snapshot.unchanged ? snapshot.activity : [];
      const events = capabilitiesFor(workspace.bdVersion).eventsJournal;
      const panel = await deps.panelActor(root);
      return ok('history', await reading(() => readHistory((limit) => provider.history(id, { limit, events }), { before, pageSize, currentLabels: bead.labels, activity, beadId: id, gateRead, panelActor: panel })));
    }),

    memories: handle(async (body, directory) => {
      const query = body.query === undefined ? undefined : stringOf(body.query, 'query');
      if (query !== undefined && query.length > MEMORY_KEY_MAX) throw badRequest(`query must be at most ${MEMORY_KEY_MAX} characters.`);
      const { root, workspace } = await project(directory);
      // The read queues behind the project's other calls, and a sync holds that queue for minutes.
      refuseWhileSyncing(root);
      return ok('memories', await reading(() => deps.memories.list(root, workspace.mode, query)));
    }),

    memoryRemember: handle(async (body, directory) => {
      const text = stringOf(body.text, 'text');
      const key = body.key === undefined || (typeof body.key === 'string' && body.key.trim() === '') ? undefined : memoryKeyOf(body.key, 'key');
      const expectedText = optionalMemoryText(body.expectedText, 'expectedText');
      const { root, workspace } = await project(directory);
      return ok('memoryRemember', await write(root, workspace.mode, (_provider, actor) => deps.memories.remember(root, { text, key, expectedText }, actor)));
    }),

    memoryForget: handle(async (body, directory) => {
      const key = memoryKeyOf(body.key, 'key');
      const expectedText = stringOf(body.expectedText, 'expectedText');
      const { root, workspace } = await project(directory);
      return ok('memoryForget', await write(root, workspace.mode, (_provider, actor) => deps.memories.forget(root, { key, expectedText }, actor)));
    }),

    eventsStatus: handle(async (_body, directory) => {
      const { root, workspace } = await project(directory);
      return ok('eventsStatus', await eventsStatusOf(root, workspace.mode, workspace.bdVersion));
    }),

    enableEvents: handle(async (body, directory) => {
      // Only the literal true: the person pressed a button that says what it will do.
      if (body.confirm !== true) throw badRequest('confirm must be true.');
      const { root, workspace } = await project(directory);
      if (!capabilitiesFor(workspace.bdVersion).eventsJournal) throw reject(501, 'unsupported', LIVE_UNSUPPORTED_TEXT);
      try {
        await write(root, workspace.mode, (provider, actor) => provider.enableEventsJournal(actor));
      } catch (error) {
        // Saved but not confirmed: the setting is probably on, so the follower must read it again.
        if (error instanceof Reject && error.result.status === 504) deps.live.journalChanged(root);
        throw error;
      }
      // The follower keeps its reading of the setting for a minute: tell it, so the next panel request starts it.
      deps.live.journalChanged(root);
      // The adapter resolves only after it read the setting back as on, so there is nothing to ask again (a Sync pressed meanwhile must not undo a finished enable).
      return ok('enableEvents', { ok: true, status: { available: true, journal: 'on', live: deps.live.state(root) } });
    }),

    migrateSchema: handle(async (body, directory) => {
      // Only the literal true: the person pressed a button that says what it will do.
      if (body.confirm !== true) throw badRequest('confirm must be true.');
      const { root, workspace } = await project(directory);
      // Already running (another panel pressed it): that one's state is the answer, nothing is started twice.
      if (deps.updateJob(root)?.kind !== 'running') refuseWrites(root, true);
      // Started and answered at once: the update can outlast the host's limit for a request. How it ends is read from the snapshot.
      deps.startUpdate(root, async () => {
        try {
          await write(root, workspace.mode, (provider, actor) => provider.migrateSchema(actor), { updatingSchema: true });
        } catch (error) {
          if (!(error instanceof Reject)) throw error;
          // Saved but not confirmed, or timed out: the store may have changed, so the next snapshot must read it again.
          if (error.result.status === 504) deps.readFailureDropped(root);
          const { code, message, detail, saved } = (error.result.json as { error: ApiError }).error;
          return { kind: 'failed', code, message, ...(detail !== undefined ? { detail } : {}), ...(saved ? { saved: true as const } : {}) };
        }
        deps.readFailureDropped(root);
        return null;
      });
      return ok('migrateSchema', { ok: true });
    }),

    update: handle(async (body, directory) => {
      const id = idOf(body.id, 'id');
      const expectedUpdatedAt = stringOf(body.expectedUpdatedAt, 'expectedUpdatedAt');
      const patch = patchOf(body.patch);
      const expected = expectedOf(body.expected);
      const { root, workspace } = await project(directory);
      return ok('update', await write(root, workspace.mode, (provider, actor) => provider.update(id, expectedUpdatedAt, patch, actor, expected)));
    }),

    deferBead: handle(async (body, directory) => {
      const id = idOf(body.id, 'id');
      const expectedUpdatedAt = stringOf(body.expectedUpdatedAt, 'expectedUpdatedAt');
      if (body.until !== null && typeof body.until !== 'string') throw badRequest('until must be text or null.');
      const until = body.until as string | null;
      const reason = reasonOf(body.reason);
      const { root, workspace } = await project(directory);
      return ok('deferBead', await write(root, workspace.mode, (provider, actor) => provider.deferBead(id, expectedUpdatedAt, until, reason, actor)));
    }),

    undeferBead: handle(async (body, directory) => {
      const id = idOf(body.id, 'id');
      const expectedUpdatedAt = stringOf(body.expectedUpdatedAt, 'expectedUpdatedAt');
      const { root, workspace } = await project(directory);
      return ok('undeferBead', await write(root, workspace.mode, (provider, actor) => provider.undeferBead(id, expectedUpdatedAt, actor)));
    }),

    supersede: handle(async (body, directory) => {
      const id = idOf(body.id, 'id');
      const other = idOf(body.with, 'with');
      const expectedUpdatedAt = stringOf(body.expectedUpdatedAt, 'expectedUpdatedAt');
      const { root, workspace } = await project(directory);
      return ok('supersede', await write(root, workspace.mode, (provider, actor) => provider.supersede(id, other, expectedUpdatedAt, actor)));
    }),

    duplicate: handle(async (body, directory) => {
      const id = idOf(body.id, 'id');
      const other = idOf(body.of, 'of');
      const expectedUpdatedAt = stringOf(body.expectedUpdatedAt, 'expectedUpdatedAt');
      const { root, workspace } = await project(directory);
      return ok('duplicate', await write(root, workspace.mode, (provider, actor) => provider.duplicate(id, other, expectedUpdatedAt, actor)));
    }),

    explain: handle(async (body, directory) => {
      const id = idOf(body.id, 'id');
      const { root, workspace } = await project(directory);
      // The read queues behind the project's other calls, and a sync holds that queue for minutes.
      refuseWhileSyncing(root);
      await findBead(directory, root, id);
      return ok('explain', await reading(() => deps.explain(deps.providerFor(root, workspace.mode), root, id)));
    }),

    create: handle(async (body, directory) => {
      const input = newBeadOf(body.input);
      const { root, workspace } = await project(directory);
      return ok('create', { bead: await write(root, workspace.mode, (provider, actor) => provider.create(input, actor)) });
    }),

    comment: handle(async (body, directory) => {
      const id = idOf(body.id, 'id');
      const text = stringOf(body.text, 'text');
      const { root, workspace } = await project(directory);
      return ok('comment', { comment: await write(root, workspace.mode, (provider, actor) => provider.comment(id, text, actor)) });
    }),

    dependency: handle(async (body, directory) => {
      const { op } = body;
      if (op !== 'add' && op !== 'remove') throw badRequest('op must be "add" or "remove".');
      const from = idOf(body.from, 'from');
      const to = idOf(body.to, 'to');
      // Removing names the pair; the kind matters only when adding.
      const kind = op === 'add' ? stringOf(body.kind, 'kind') : typeof body.kind === 'string' ? body.kind : '';
      const { root, workspace } = await project(directory);
      await write(root, workspace.mode, (provider, actor) => provider.dependency(op, from, to, kind, actor));
      return ok('dependency', { ok: true });
    }),

    gateCreate: handle(async (body, directory) => {
      const id = idOf(body.id, 'id');
      const reason = reasonOf(body.reason) ?? REVIEW_REASON;
      if (body.kind !== undefined && body.kind !== 'human') throw badRequest('kind must be "human".');
      const { root, workspace } = await project(directory);
      return ok('gateCreate', await write(root, workspace.mode, (provider, actor) => provider.gateCreate(id, reason, actor)));
    }),

    gateResolve: handle(async (body, directory) => {
      const gateId = idOf(body.gateId, 'gateId');
      const reason = reasonOf(body.reason);
      const { root, workspace } = await project(directory);
      return ok('gateResolve', await write(root, workspace.mode, (provider, actor) => provider.gateResolve(gateId, reason, actor)));
    }),

    humanRespond: handle(async (body, directory) => {
      const id = idOf(body.id, 'id');
      const response = responseOf(body.response);
      const { root, workspace } = await project(directory);
      return ok('humanRespond', await write(root, workspace.mode, (provider, actor) => provider.humanRespond(id, response, actor)));
    }),

    humanDismiss: handle(async (body, directory) => {
      const id = idOf(body.id, 'id');
      // A blank reason is no reason: the person left the box empty.
      const blank = typeof body.reason === 'string' && body.reason.trim() === '';
      const reason = blank ? undefined : reasonOf(body.reason);
      const { root, workspace } = await project(directory);
      return ok('humanDismiss', await write(root, workspace.mode, (provider, actor) => provider.humanDismiss(id, reason, actor)));
    }),

    seen: handle(async (body, directory) => {
      const all = optionalBoolean(body, 'all');
      const { ids } = body;
      if (ids !== undefined && !Array.isArray(ids)) throw badRequest('ids must be a list of bead ids.');
      if (!all && ids === undefined) throw badRequest('Send ids or all.');
      const wanted = all ? 'all' : (ids as unknown[]).map((id) => idOf(id, 'ids'));
      const { root } = await project(directory);
      try {
        const store = await deps.projectStore(root);
        store.markSeen(wanted);
        await store.save();
        return ok('seen', { unseenIds: store.allUnseenIds() });
      } catch (error) {
        throw reject(500, 'beads-error', "Couldn't save what you've seen.", { detail: errorDetail(error) });
      }
    }),

    context: handle(async (body, directory) => {
      const id = idOf(body.id, 'id');
      const { root, workspace } = await project(directory);
      // The agent works from this, so the project is read now rather than as the last poll left it. A read that failed
      // still attaches the last copy, marked as such with when it was read.
      const snapshot = await reading(() => deps.getSnapshot(directory));
      const { bead, all } = await findBead(directory, root, id);
      const freshness = snapshot.freshness;
      const stale = freshness?.localError ? { readAt: freshness.localRefreshedAt } : undefined;
      const { text, title } = buildContext(bead, relatedFor(bead, all), stale);
      return ok('context', { id: bead.id, title, text, url: await deps.beadUrl(root, workspace.projectName, bead.id) });
    }),

    'sync-preview': handle(async (_body, directory) => {
      const { root, workspace } = await project(directory);
      refuseWhileSyncing(root);
      const preview = await syncReading(() => deps.preview(root, workspace.mode));
      return ok('sync-preview', preview === null ? { changes: [], noRemote: true } : preview);
    }),

    'sync-pull': handle(async (_body, directory) => {
      const { root, workspace } = await project(directory);
      return ok('sync-pull', { sync: deps.startPull(root, workspace.mode) });
    }),

    'sync-publish': handle(async (body, directory) => {
      // Publish sends only what the person previewed, so the preview's head is required.
      const expected = body.expectedHead;
      if (typeof expected !== 'string' || !HEAD_PATTERN.test(expected)) throw badRequest('expectedHead must be the head commit of the preview.');
      const { root, workspace } = await project(directory);
      // A confirmed preview is for a job not yet running: another one now would not be the one the person confirmed.
      if (deps.syncState(root).kind === 'running') throw reject(409, 'sync-running', SYNC_RUNNING_TEXT);
      const head = await syncReading(() => deps.localHead(root, workspace.mode));
      if (head !== expected) throw reject(409, 'preview-stale', PREVIEW_STALE_TEXT);
      return ok('sync-publish', { sync: deps.startPublish(root, workspace.mode, expected) });
    }),

    'conflict-context': handle(async (_body, directory) => {
      const { root, workspace } = await project(directory);
      const state: SyncState = deps.syncState(root);
      if (state.kind !== 'conflict' && state.kind !== 'error' && state.kind !== 'paused-upgrade') throw badRequest('There is no sync problem to attach.');
      const text = buildConflictContext(root, state, await readRules(root));
      const id = `sync-${basename(root)}`.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 128);
      return ok('conflict-context', { id, title: 'Beads sync needs attention', text, url: await deps.beadUrl(root, workspace.projectName, 'sync') });
    }),
  };
}
