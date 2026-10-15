import type { ConflictInfo, JsonValue, SyncState, UnpublishedChange } from '../shared/types';
import { panelActor, withRootQueue } from './bd/adapter';
import { runSql, type AuditMode } from './bd/audit';
import { BdError, runBd, type RunOptions, type RunResult } from './bd/exec';
import { isNoDolt, NO_DOLT_TEXT } from './errors';
import { shellQuote } from './shell';

// Sync with the team remote. One job per project at a time, run inside the project's queue so it never overlaps a read or a write.
// Pull and publish are the only things that talk to the remote. Nothing here ever forces anything, adds or changes a remote, or
// pushes unless the caller asked to publish.

type Row = Record<string, unknown>;

/** A pull or push can take a while on a large project or a slow link. */
const JOB_RUN: RunOptions = { timeoutMs: 120_000, deadlineMs: 120_000, retries: 2 };
/** Inside a job, finding the remote can take a moment. */
const LOOKUP_RUN: RunOptions = { timeoutMs: 20_000, deadlineMs: 20_000, retries: 2 };
/** Outside a job (the poll path) the default timeout and deadline stand, so a poll never waits longer than any other read. */
const POLL_RUN: RunOptions = { retries: 2 };
const MAX_PUSH_ATTEMPTS = 3;
const LOG_MAX = 8_000;
const OUTPUT_MAX = 3_000;
const UNPUBLISHED_LIMIT = 1_000;
const UNPUBLISHED_FALLBACK_LIMIT = 500;
const CONFLICT_LIMIT = 100;

const SAFE_REMOTE = /^[A-Za-z0-9._-]{1,64}$/;
const SAFE_BRANCH = /^[A-Za-z0-9._/-]{1,128}$/;

const ABORTED = /merge aborted and working set restored/i;
const CONFLICT_TEXT = /merge conflicts? in/i;
const DIRTY_CONFIG = /refusing to auto-commit[^\n]*dirty[^\n]*config/i;
// bd refuses to pull from a team copy nobody has published into yet.
const EMPTY_REMOTE = /no branches found in remote/i;
// Best effort: no version or format refusal has been seen from a real pull yet.
const FORMAT_REFUSAL = /unsupported (?:storage |database |dolt )?format|format version|newer version of bd|please upgrade|(?:schema|storage) version[^\n]*(?:newer|unsupported|mismatch)/i;
const REJECTED = /non-fast-forward|\[rejected\]/i;
const AUTH = /authentication failed|permission denied|access denied|could not read username|invalid credentials|\b40[13]\b|not authorized|publickey/i;
const NETWORK = /could not resolve host|unable to access|connection (?:refused|timed out|reset)|network is unreachable|no route to host|timed out|dial tcp|name resolution|unexpected eof/i;

const MESSAGES = {
  noRemote: "This project has no shared copy with the team, so there is nothing to sync with.",
  dirtyConfig: 'Some project settings changed on this computer and have not been saved, so Sync cannot start. Ask your agent to save or undo them, then try again.',
  upgrade: "This project's beads data needs a different Beads version. Hand it to your agent to check.",
  auth: "The team's shared copy did not accept your sign-in. Check your access, then try again.",
  network: "Could not reach the team's shared copy. Check your connection, then try again.",
  generic: 'Sync did not finish. Try again, or copy the details.',
  timeout: 'Beads did not answer in time. Try again.',
  notFound: 'Beads could not be found on this computer.',
  busy: 'Beads is busy with another task. Try again in a moment.',
  churn: "The team keeps changing the shared copy while you publish. Try again.",
  stale: 'New changes arrived since you looked. Review them again.',
  pending: 'Some changes on this computer are still being saved. Try again in a moment.',
  emptyPull: "The team's shared copy is empty, so there is nothing to bring in yet.",
  emptyPublish:
    "The team's shared copy is empty, so there is nothing to publish into yet. Setting it up the first time is a one-time step: hand it to your agent. Nothing was published.",
} as const;

/** What Publish says when the local head moved after the preview the person confirmed. Nothing was published. */
export const PREVIEW_STALE_TEXT = MESSAGES.stale;

type RootSync = {
  state: SyncState;
  /** A server database stuck mid-merge. Writes must wait. Plain errors leave it as it was. */
  blocked: boolean;
  lastTeamSyncAt: string | null;
  /** A pull or publish was told the team's copy has no branch: a fetch has shown it empty. Not saved. */
  teamSeenEmpty: boolean;
  job: Promise<void> | null;
  revision: number;
};

const roots = new Map<string, RootSync>();
const syncedListeners = new Set<(root: string, at: string) => void>();
const changeListeners = new Set<(root: string) => void>();

function rootSync(root: string): RootSync {
  let entry = roots.get(root);
  if (!entry) {
    entry = { state: { kind: 'idle' }, blocked: false, lastTeamSyncAt: null, teamSeenEmpty: false, job: null, revision: 0 };
    roots.set(root, entry);
  }
  return entry;
}

/** Forget everything. For tests. Listeners stay. */
export function resetSyncState(): void {
  roots.clear();
}

/** Called with the time of each successful pull, so it can be saved. A listener that throws is ignored. */
export function onTeamSynced(listener: (root: string, at: string) => void): () => void {
  syncedListeners.add(listener);
  return () => syncedListeners.delete(listener);
}

/** Called whenever a project's sync state changes, so cached counts and the cursor can be refreshed. */
export function onSyncChange(listener: (root: string) => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function notifyChange(root: string): void {
  for (const listener of changeListeners) {
    try {
      listener(root);
    } catch {
      // a listener must not break a sync
    }
  }
}

function setState(root: string, state: SyncState): void {
  const entry = rootSync(root);
  entry.state = state;
  entry.revision += 1;
  notifyChange(root);
}

export function syncState(root: string): SyncState {
  return rootSync(root).state;
}

/** Changes whenever the sync state does, for the snapshot cursor. */
export function syncSignature(root: string): string {
  const entry = rootSync(root);
  return `${entry.revision}${entry.blocked ? 'b' : ''}`;
}

/** When the last successful pull finished (ISO), or null. */
export function lastTeamSync(root: string): string | null {
  return rootSync(root).lastTeamSyncAt;
}

/** Restores a saved time. Never moves the time back. */
export function seedLastTeamSync(root: string, iso: string | null): void {
  if (!iso || Number.isNaN(Date.parse(iso))) return;
  const entry = rootSync(root);
  if (entry.lastTeamSyncAt === null || Date.parse(iso) > Date.parse(entry.lastTeamSyncAt)) entry.lastTeamSyncAt = iso;
}

function markSynced(root: string): void {
  const entry = rootSync(root);
  let at = Date.now();
  if (entry.lastTeamSyncAt !== null) at = Math.max(at, Date.parse(entry.lastTeamSyncAt) + 1);
  const iso = new Date(at).toISOString();
  entry.lastTeamSyncAt = iso;
  for (const listener of syncedListeners) {
    try {
      listener(root, iso);
    } catch {
      // saving the time is best effort
    }
  }
}

/** True while a server database is stuck mid-merge and writes must wait. */
export function writesBlocked(root: string): boolean {
  return rootSync(root).blocked;
}

/** Resolves when the job now running for this project has ended (at once if none). */
export function syncSettled(root: string): Promise<void> {
  return rootSync(root).job ?? Promise.resolve();
}

// ---------------------------------------------------------------------------------------------------------------------
// Job log

const tail = (text: string, max: number): string => (text.length > max ? text.slice(text.length - max) : text);
const redact = (text: string): string => text.replace(/([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/\s@]+@/g, '$1***@');

/** Quoted like a shell would need it, because the log is handed to an agent that may copy the line. */
const commandLine = (args: string[]): string => `$ bd ${args.map(shellQuote).join(' ')}`;

class JobLog {
  private readonly parts: string[] = [];

  command(args: string[], result: RunResult): void {
    const lines = [commandLine(args), `exit ${result.code}`];
    for (const output of [result.stdout, result.stderr]) if (output.trim() !== '') lines.push(tail(output.trim(), OUTPUT_MAX));
    this.parts.push(lines.join('\n'));
  }

  failure(args: string[], error: unknown): void {
    this.parts.push(`${commandLine(args)}\nfailed: ${error instanceof Error ? error.message : String(error)}`);
  }

  note(text: string): void {
    this.parts.push(text);
  }

  text(): string {
    return tail(redact(this.parts.join('\n\n')), LOG_MAX);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Remote and branch

type RemoteChoice = { name: string };

function parseRemotes(stdout: string): Array<{ name: string }> {
  const text = stdout.trim();
  if (text === '' || text === 'null') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BdError('parse', 'the remote list was not valid JSON');
  }
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as Row).remotes) ? ((parsed as Row).remotes as unknown[]) : null;
  if (!list) throw new BdError('parse', 'the remote list was not in the expected shape');
  return list.filter((item): item is { name: string } => !!item && typeof item === 'object' && typeof (item as Row).name === 'string');
}

const REMOTE_LIST = ['--readonly', 'dolt', 'remote', 'list', '--json'];

/** `origin` if there is one, else the first remote. Looked up fresh each time. Null when the project has none. */
async function chooseRemote(root: string, log: JobLog | undefined, run: RunOptions): Promise<RemoteChoice | null> {
  let result: RunResult;
  try {
    result = await runBd(root, REMOTE_LIST, run);
  } catch (error) {
    log?.failure(REMOTE_LIST, error);
    throw error;
  }
  log?.command(REMOTE_LIST, result);
  if (result.code !== 0) throw new BdError('exit', `listing the remotes failed with exit code ${result.code}`, { code: result.code, stderr: result.stderr });
  const remotes = parseRemotes(result.stdout);
  if (remotes.length === 0) return null;
  const chosen = remotes.find((r) => r.name === 'origin') ?? remotes[0]!;
  if (!SAFE_REMOTE.test(chosen.name)) throw new BdError('parse', 'the remote has a name that is not safe to use');
  return { name: chosen.name };
}

/** bd and dolt use `origin` when no remote is named, so any other single remote must be named. */
const remoteSelector = (remote: RemoteChoice): string[] => (remote.name === 'origin' ? [] : ['--remote', remote.name]);

async function activeBranch(root: string, mode: AuditMode): Promise<string> {
  const rows = await runSql(root, mode, 'SELECT active_branch() AS branch', undefined);
  const branch = rows[0]?.branch;
  if (typeof branch !== 'string' || !SAFE_BRANCH.test(branch)) throw new BdError('parse', 'the current branch has a name that is not safe to use');
  return branch;
}

// ---------------------------------------------------------------------------------------------------------------------
// Unpublished changes

const VERBS: Record<string, string> = {
  update: 'Updated',
  create: 'Created',
  close: 'Closed',
  delete: 'Deleted',
  reopen: 'Reopened',
  comment: 'Commented on',
  'comments add': 'Commented on',
  'dep add': 'Linked',
  'dep remove': 'Unlinked',
  'label add': 'Labeled',
  'label remove': 'Unlabeled',
};

function summaryOf(verb: string, ids: string[]): string {
  const word = VERBS[verb] ?? 'Changed';
  return ids.length > 0 ? `${word} ${ids.join(', ')}` : `${word} beads`;
}

function describeCommit(message: string): Pick<UnpublishedChange, 'beadIds' | 'summary' | 'actor'> {
  const first = message.split('\n')[0] ?? '';
  // The verb can be two words: `comments add`, `dep add`, `label remove`.
  const embedded = /^bd: ([a-z-]+(?: [a-z-]+)?)(?: \(auto-commit\))? by (.+?) \[([^\]]*)\]\s*$/.exec(first);
  if (embedded) {
    const ids = embedded[3]!.split(',').map((id) => id.trim()).filter(Boolean);
    return { beadIds: ids, summary: summaryOf(embedded[1]!, ids), actor: embedded[2]!.trim() };
  }
  const server = /^bd: (\S+) (\S+)\s*$/.exec(first);
  if (server) return { beadIds: [server[2]!], summary: summaryOf(server[1]!, [server[2]!]), actor: null };
  const dependency = /^dependency: (add|remove) (\S+) (\S+) -> (\S+)/.exec(first);
  if (dependency) {
    const ids = [dependency[3]!, dependency[4]!];
    return { beadIds: ids, summary: `${dependency[1] === 'add' ? 'Linked' : 'Unlinked'} ${ids[0]} and ${ids[1]}`, actor: null };
  }
  if (/^Merge /i.test(first)) return { beadIds: [], summary: 'Merged changes from the team', actor: null };
  return { beadIds: [], summary: 'Saved a change', actor: null };
}

/** Dolt prints commit times in UTC with no zone. */
function isoOf(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const text = value.trim();
  const zoned = /(?:Z|[+-]\d\d:?\d\d)$/.test(text);
  const candidate = zoned ? text : `${text.replace(' ', 'T')}Z`;
  const ms = Date.parse(candidate);
  if (Number.isNaN(ms)) return null;
  return zoned ? text : new Date(ms).toISOString();
}

type Tracking = { remote: string; branch: string };

async function trackingOf(root: string, mode: AuditMode): Promise<Tracking | null> {
  const remote = await chooseRemote(root, undefined, POLL_RUN);
  if (!remote) return null;
  return { remote: remote.name, branch: await activeBranch(root, mode) };
}

/**
 * The commits the remote lacks, as a dolt_log range. Before the first fetch there is no tracking ref and every local commit counts.
 * Only a ref that is genuinely absent falls back; any other failure is thrown, so the last good count is kept.
 */
async function rangeOf(root: string, mode: AuditMode, tracking: Tracking): Promise<string> {
  return (await rangeTo(root, mode, tracking, tracking.branch)).range;
}

/** The commits up to `to` that the remote lacks; with no tracking ref yet (`tracked` false), every commit up to `to`. */
async function rangeTo(root: string, mode: AuditMode, { remote, branch }: Tracking, to: string): Promise<{ range: string; tracked: boolean }> {
  const ref = `remotes/${remote}/${branch}`;
  const rows = await runSql(root, mode, `SELECT COUNT(*) AS n FROM dolt_remote_branches WHERE name = '${ref}'`, undefined);
  const tracked = Number(rows[0]?.n) > 0;
  return { range: tracked ? `${ref}..${to}` : to, tracked };
}

/** Where the local branch stands against the team's: the range of commits the remote lacks, and whether a tracking ref exists at all. */
type Outgoing = { range: string; tracked: boolean };

async function outgoingOf(root: string, mode: AuditMode): Promise<Outgoing | null> {
  const tracking = await trackingOf(root, mode);
  return tracking ? rangeTo(root, mode, tracking, tracking.branch) : null;
}

async function listOutgoing(root: string, mode: AuditMode, outgoing: Outgoing): Promise<UnpublishedChange[]> {
  const limit = outgoing.tracked ? UNPUBLISHED_LIMIT : UNPUBLISHED_FALLBACK_LIMIT;
  const rows = await runSql(root, mode, `SELECT commit_hash, committer, date, message FROM dolt_log('${outgoing.range}') ORDER BY date DESC LIMIT ${limit}`, undefined);
  return rows.map((row) => {
    const message = String(row.message ?? '');
    return { commit: String(row.commit_hash ?? ''), message, at: isoOf(row.date), ...describeCommit(message) };
  });
}

async function readUnpublished(root: string, mode: AuditMode): Promise<UnpublishedChange[] | null> {
  const outgoing = await outgoingOf(root, mode);
  return outgoing ? listOutgoing(root, mode, outgoing) : null;
}

async function countOutgoing(root: string, mode: AuditMode, outgoing: Outgoing): Promise<number> {
  const rows = await runSql(root, mode, `SELECT COUNT(*) AS n FROM dolt_log('${outgoing.range}')`, undefined);
  const n = Number(rows[0]?.n);
  if (!Number.isInteger(n) || n < 0) throw new BdError('parse', 'the database printed a count that was not expected');
  return n;
}

async function readUnpublishedCount(root: string, mode: AuditMode): Promise<number | null> {
  const outgoing = await outgoingOf(root, mode);
  return outgoing ? countOutgoing(root, mode, outgoing) : null;
}

/** Local commits that are not on the team remote yet, newest first. Null when the project has no remote. */
export function unpublished(root: string, mode: AuditMode): Promise<UnpublishedChange[] | null> {
  return withRootQueue(root, () => readUnpublished(root, mode));
}

const HEAD_PATTERN = /^[a-z0-9]{8,64}$/;

async function readHead(root: string, mode: AuditMode): Promise<string> {
  const rows = await runSql(root, mode, "SELECT HASHOF('HEAD') AS head", undefined);
  const head = rows[0]?.head;
  if (typeof head !== 'string' || !HEAD_PATTERN.test(head)) throw new BdError('parse', 'the database printed a head commit that was not expected');
  return head;
}

const staleError = (log: JobLog): SyncState => ({ kind: 'error', code: 'preview-stale', message: MESSAGES.stale, log: log.text() });

/** Commit hashes from rows. A row that does not hold one is not skipped: a guard built on a short list would pass too much. */
function hashesOf(rows: Row[]): string[] {
  return rows.map((row) => {
    const hash = String(row.commit_hash ?? '');
    if (!HEAD_PATTERN.test(hash)) throw new BdError('parse', 'the database printed a commit that was not expected');
    return hash;
  });
}

/** Changes not yet saved as a commit, which the next pull or push could commit and carry along. */
async function pendingChanges(root: string, mode: AuditMode): Promise<boolean> {
  const status = await runSql(root, mode, 'SELECT COUNT(*) AS n FROM dolt_status', undefined);
  return Number(status[0]?.n) !== 0;
}

/**
 * Right before a push: would it send what the person previewed and nothing else? The local commits the team lacks must be
 * the previewed ones plus only merge commits this job's own pulls left as the head (`pulled`: the head right after each
 * successful pull). Returns why not, or null when it would. Changes still pending are checked apart (`pendingChanges`).
 */
async function unpreviewed(root: string, mode: AuditMode, expectedHead: string, before: ReadonlySet<string>, pulled: ReadonlySet<string>): Promise<string | null> {
  const tracking = await trackingOf(root, mode);
  if (!tracking) return 'The project has no remote.';
  // Same fallback as the list: before the team copy has a branch, every local commit counts.
  const { range: outgoingRange } = await rangeTo(root, mode, tracking, 'HEAD');
  const { range: previewedRange } = await rangeTo(root, mode, tracking, expectedHead);
  const outgoing = hashesOf(await runSql(root, mode, `SELECT commit_hash FROM dolt_log('${outgoingRange}')`, undefined));
  const previewed = new Set(hashesOf(await runSql(root, mode, `SELECT commit_hash FROM dolt_log('${previewedRange}')`, undefined)));
  const extra = outgoing.filter((hash) => !previewed.has(hash));
  if (extra.length === 0) return null;
  if (extra.some((hash) => before.has(hash))) return 'A commit not in the preview was already there.';
  const list = extra.map((hash) => `'${hash}'`).join(', ');
  const merges = new Set(hashesOf(await runSql(root, mode, `SELECT DISTINCT commit_hash FROM dolt_commit_ancestors WHERE parent_index = 1 AND commit_hash IN (${list})`, undefined)));
  const plain = extra.filter((hash) => !(merges.has(hash) && pulled.has(hash)));
  return plain.length === 0 ? null : `New commits that were not in the preview: ${plain.join(', ')}.`;
}

/** The local branch's newest commit: what a Publish preview was read from. */
export function localHead(root: string, mode: AuditMode): Promise<string> {
  return withRootQueue(root, () => readHead(root, mode));
}

/**
 * What Publish would send, in one turn of the project's queue: the local head first (so a commit landing meanwhile shows
 * as a moved head, never as an unlisted change), then the list (capped) and how many there are in all. Null with no remote.
 * With no branch of the team's copy known here, `teamEmpty` says a fetch has shown it empty (or went through and left no
 * branch), and `teamUnseen` says no fetch has happened on this computer yet.
 */
export function publishPreview(
  root: string,
  mode: AuditMode,
): Promise<{ head: string; changes: UnpublishedChange[]; total: number; teamEmpty?: true; teamUnseen?: true } | null> {
  return withRootQueue(root, async () => {
    const head = await readHead(root, mode);
    // The remote and branch are read once and handed down.
    const outgoing = await outgoingOf(root, mode);
    if (outgoing === null) return null;
    const changes = await listOutgoing(root, mode, outgoing);
    const total = await countOutgoing(root, mode, outgoing);
    const entry = rootSync(root);
    const fetched = entry.lastTeamSyncAt !== null || entry.teamSeenEmpty;
    const noTeamBranch = !outgoing.tracked;
    return {
      head,
      changes,
      total: Math.max(total, changes.length),
      ...(noTeamBranch && fetched ? { teamEmpty: true as const } : {}),
      ...(noTeamBranch && !fetched ? { teamUnseen: true as const } : {}),
    };
  });
}

/** How many local commits are not on the team remote yet, for the header. Null when the project has no remote. */
export function unpublishedCount(root: string, mode: AuditMode): Promise<number | null> {
  return withRootQueue(root, () => readUnpublishedCount(root, mode));
}

// ---------------------------------------------------------------------------------------------------------------------
// Conflicts

const NOISE_FIELDS = new Set(['id', 'updated_at', 'content_hash', 'diff_type']);

function jsonOf(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return JSON.stringify(value);
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function conflictOf(row: Row): ConflictInfo | null {
  const beadId = textOf(row.base_id) ?? textOf(row.our_id) ?? textOf(row.their_id);
  if (!beadId) return null;
  const fields = new Set<string>();
  for (const key of Object.keys(row)) {
    const match = /^(?:base|our|their)_(.+)$/.exec(key);
    if (match && !NOISE_FIELDS.has(match[1]!)) fields.add(match[1]!);
  }
  const ours: Record<string, JsonValue> = {};
  const theirs: Record<string, JsonValue> = {};
  for (const field of fields) {
    const our = jsonOf(row[`our_${field}`]);
    const their = jsonOf(row[`their_${field}`]);
    if (our === their || (our === undefined && their === undefined)) continue;
    ours[field] = our ?? null;
    theirs[field] = their ?? null;
  }
  const title = textOf(row.our_title) ?? textOf(row.their_title) ?? textOf(row.base_title);
  return { beadId, title, ours, theirs };
}

/** The beads both sides changed, where readable. A read failure gives an empty list (and a line in the log): the conflict still shows. */
async function readConflictBeads(root: string, mode: AuditMode, halfMerged: boolean, remote: string | null, log: JobLog): Promise<ConflictInfo[]> {
  try {
    let query: string;
    if (halfMerged) {
      query = `SELECT * FROM dolt_conflicts_issues LIMIT ${CONFLICT_LIMIT}`;
    } else {
      if (!remote) return [];
      const branch = await activeBranch(root, mode);
      query = `SELECT * FROM DOLT_PREVIEW_MERGE_CONFLICTS('${branch}', 'remotes/${remote}/${branch}', 'issues') LIMIT ${CONFLICT_LIMIT}`;
    }
    const rows = await runSql(root, mode, query, undefined);
    return rows.map(conflictOf).filter((info): info is ConflictInfo => info !== null);
  } catch (error) {
    const detail = error instanceof BdError && error.stderr.trim() !== '' ? ` ${tail(error.stderr.trim(), OUTPUT_MAX)}` : '';
    log.note(`Could not read which beads conflict: ${error instanceof Error ? error.message : String(error)}${detail}`);
    return [];
  }
}

const truthy = (value: unknown): boolean => value === true || value === 1 || value === '1' || value === 'true';

async function isMerging(root: string, mode: AuditMode): Promise<boolean> {
  const rows = await runSql(root, mode, 'SELECT is_merging FROM dolt_merge_status', undefined);
  return rows.some((row) => truthy(row.is_merging));
}

type MergeStatus = 'merging' | 'clear' | 'unknown';

/** Server mode only. A failed read is "unknown", never "clear". */
async function mergeStatusOf(root: string, mode: AuditMode): Promise<MergeStatus> {
  try {
    return (await isMerging(root, mode)) ? 'merging' : 'clear';
  } catch {
    return 'unknown';
  }
}

/**
 * Server mode only: is the database stuck halfway through a merge? Raises the conflict (and blocks writes) when it is, clears
 * both once it no longer is. Does nothing while a job runs or when the check itself fails, so a failure never reads as "clear".
 */
export async function checkHalfMerge(root: string, mode: AuditMode): Promise<void> {
  if (mode !== 'server') return;
  const entry = rootSync(root);
  if (entry.job) return;
  try {
    await withRootQueue(root, async () => {
      if (entry.job) return;
      const merging = await isMerging(root, mode);
      const state = entry.state;
      const alreadyHalf = state.kind === 'conflict' && state.halfMerged;
      if (merging) {
        entry.blocked = true;
        if (alreadyHalf) return;
        const log = new JobLog();
        const beads = await readConflictBeads(root, mode, true, null, log);
        setState(root, { kind: 'conflict', mode, halfMerged: true, beads, log: log.text() });
        return;
      }
      if (!entry.blocked && !alreadyHalf) return;
      entry.blocked = false;
      setState(root, alreadyHalf ? { kind: 'idle' } : state);
    });
  } catch {
    // keep what is known
  }
}

/**
 * A backed-out conflict (nothing half merged) stays on screen until it is resolved somewhere else, usually by the agent
 * merging the team's changes. Resolved means the team's copy, as last fetched, has no commit the local branch lacks:
 * then the card clears. Does nothing while a job runs, for any other state, or when the check cannot be read.
 */
export async function checkBackedOut(root: string, mode: AuditMode): Promise<void> {
  const entry = rootSync(root);
  const shown = entry.state;
  if (entry.job || shown.kind !== 'conflict' || shown.halfMerged) return;
  try {
    await withRootQueue(root, async () => {
      if (entry.job || entry.state !== shown) return;
      const tracking = await trackingOf(root, mode);
      if (!tracking) return;
      const ref = `remotes/${tracking.remote}/${tracking.branch}`;
      const { tracked } = await rangeTo(root, mode, tracking, 'HEAD');
      if (!tracked) return;
      const rows = await runSql(root, mode, `SELECT COUNT(*) AS n FROM dolt_log('HEAD..${ref}')`, undefined);
      const n = Number(rows[0]?.n);
      if (Number.isInteger(n) && n === 0 && entry.state === shown) setState(root, { kind: 'idle' });
    });
  } catch {
    // keep what is known
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Jobs

type Job = {
  root: string;
  mode: AuditMode;
  op: 'pull' | 'publish';
  log: JobLog;
  remote: RemoteChoice;
};

/** What a job ended with. `hold` keeps writes blocked after a server pull whose merge status could not be read, until a later check shows it clear. */
type Outcome = { state: SyncState; hold?: boolean };

function plainError(message: string, log: JobLog): SyncState {
  return { kind: 'error', message, log: log.text() };
}

function messageForText(text: string): string {
  if (AUTH.test(text)) return MESSAGES.auth;
  if (NETWORK.test(text)) return MESSAGES.network;
  return MESSAGES.generic;
}

function stateForThrown(error: unknown, log: JobLog): SyncState {
  if (isNoDolt(error)) return plainError(NO_DOLT_TEXT, log);
  if (error instanceof BdError) {
    if (error.kind === 'timeout') return plainError(MESSAGES.timeout, log);
    if (error.kind === 'not-found') return plainError(MESSAGES.notFound, log);
    if (error.kind === 'lock') return plainError(MESSAGES.busy, log);
    if (error.kind === 'exit' && FORMAT_REFUSAL.test(error.stderr)) return { kind: 'paused-upgrade', message: MESSAGES.upgrade, log: log.text() };
  }
  return plainError(MESSAGES.generic, log);
}

async function step(job: Job, args: string[]): Promise<RunResult> {
  try {
    const result = await runBd(job.root, args, JOB_RUN);
    job.log.command(args, result);
    return result;
  } catch (error) {
    job.log.failure(args, error);
    throw error;
  }
}

async function conflictState(job: Job, halfMerged: boolean): Promise<SyncState> {
  const beads = await readConflictBeads(job.root, job.mode, halfMerged, job.remote.name, job.log);
  return { kind: 'conflict', mode: job.mode, halfMerged, beads, log: job.log.text() };
}

/** Classifies a pull that did not succeed. */
async function pullFailed(job: Job, result: RunResult): Promise<Outcome> {
  const text = `${result.stderr}\n${result.stdout}`;
  if (DIRTY_CONFIG.test(text)) return { state: plainError(MESSAGES.dirtyConfig, job.log) };
  if (EMPTY_REMOTE.test(text)) {
    rootSync(job.root).teamSeenEmpty = true;
    return { state: plainError(job.op === 'pull' ? MESSAGES.emptyPull : MESSAGES.emptyPublish, job.log) };
  }
  if (FORMAT_REFUSAL.test(text)) return { state: { kind: 'paused-upgrade', message: MESSAGES.upgrade, log: job.log.text() } };
  if (ABORTED.test(text)) return { state: await conflictState(job, false) };
  let status: MergeStatus = 'clear';
  if (job.mode === 'server') {
    status = await mergeStatusOf(job.root, job.mode);
    if (status === 'merging') return { state: await conflictState(job, true) };
  }
  if (CONFLICT_TEXT.test(text)) {
    // A conflict whose merge status could not be read may be half merged: never call it backed out.
    return { state: await conflictState(job, status === 'unknown') };
  }
  return { state: plainError(messageForText(text), job.log), hold: status === 'unknown' };
}

/** `expectedHead` is set for a publish (the head of the confirmed preview) and absent for a pull. */
async function runJob(root: string, mode: AuditMode, op: 'pull' | 'publish', expectedHead?: string): Promise<Outcome> {
  const log = new JobLog();
  try {
    // The route checked too; this closes the gap until the job's turn in the queue. Nothing runs if the head moved.
    /** What the team lacked when the job began: anything outside the preview that was already there is never a merge of ours. */
    let before: ReadonlySet<string> = new Set();
    /** The head right after each of this job's successful pulls: the only merge commits the job may push besides the preview. */
    const pulled = new Set<string>();
    if (expectedHead !== undefined) {
      const head = await readHead(root, mode);
      if (head !== expectedHead) {
        log.note(`The local head is ${head}, not ${expectedHead} as previewed. Nothing was published.`);
        return { state: staleError(log) };
      }
      const tracking = await trackingOf(root, mode);
      if (tracking) before = new Set(hashesOf(await runSql(root, mode, `SELECT commit_hash FROM dolt_log('${await rangeOf(root, mode, tracking)}')`, undefined)));
    }
    const remote = await chooseRemote(root, log, LOOKUP_RUN);
    if (!remote) return { state: plainError(MESSAGES.noRemote, log) };
    const job: Job = { root, mode, op, log, remote };
    // Panel-initiated: recorded as the panel's actor, like every other write the panel makes.
    const as = ['--actor', await panelActor(root)];
    const selector = remoteSelector(remote);
    let hold = false;

    for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt += 1) {
      const pull = await step(job, [...as, 'dolt', 'pull', ...selector]);
      if (pull.code !== 0) return await pullFailed(job, pull);
      if (mode === 'server') {
        // A pull can exit 0 and still leave the database halfway through a merge.
        const status = await mergeStatusOf(root, mode);
        if (status === 'merging') return { state: await conflictState(job, true) };
        if (status === 'unknown') {
          log.note('Could not tell whether the database was left halfway through a merge.');
          // Do not push on top of a state that cannot be read.
          if (op === 'publish') return { state: plainError(MESSAGES.generic, log), hold: true };
          hold = true;
        }
      }
      if (expectedHead !== undefined) pulled.add(await readHead(root, mode));
      markSynced(root);
      if (op === 'pull') return { state: { kind: 'idle' }, hold };

      if (expectedHead !== undefined) {
        // Checked before every push, retries included. What is left is the few milliseconds between this read and the
        // push itself: a commit landing in exactly that moment would go too (the sheet says so). Dolt has no push that
        // names its last commit, and the agent writes outside this queue, so it cannot be closed from here.
        // Changes still being saved are no new list to review: the person waits and tries again.
        if (await pendingChanges(root, mode)) {
          log.note('There are changes not yet saved as a commit. Nothing was published.');
          return { state: plainError(MESSAGES.pending, log) };
        }
        const why = await unpreviewed(root, mode, expectedHead, before, pulled);
        if (why !== null) {
          log.note(`${why} Nothing was published.`);
          return { state: staleError(log) };
        }
      }
      const push = await step(job, [...as, 'dolt', 'push', ...selector]);
      if (push.code === 0) return { state: { kind: 'idle' } };
      const text = `${push.stderr}\n${push.stdout}`;
      if (!REJECTED.test(text)) return { state: plainError(messageForText(text), log) };
      // The team got ahead between the pull and the push: pull again and retry.
    }
    return { state: plainError(MESSAGES.churn, log) };
  } catch (error) {
    return { state: stateForThrown(error, log) };
  }
}

function settle(root: string, { state, hold }: Outcome): void {
  const entry = rootSync(root);
  if (state.kind === 'conflict') entry.blocked = state.halfMerged;
  else if (state.kind === 'idle') entry.blocked = false;
  if (hold) entry.blocked = true;
  setState(root, state);
}

function start(root: string, mode: AuditMode, op: 'pull' | 'publish', expectedHead?: string): SyncState {
  const entry = rootSync(root);
  if (entry.job) return entry.state;
  setState(root, { kind: 'running', op, startedAt: new Date().toISOString() });
  const running = entry.state;
  entry.job = withRootQueue(root, () => runJob(root, mode, op, expectedHead))
    .then(
      (outcome) => settle(root, outcome),
      () => settle(root, { state: { kind: 'error', message: MESSAGES.generic, log: '' } }),
    )
    .finally(() => {
      entry.job = null;
    });
  return running;
}

/** Fetches and merges the team's changes. Never pushes. Returns the state at once; the job runs on. */
export function startPull(root: string, mode: AuditMode): SyncState {
  return start(root, mode, 'pull');
}

/**
 * Pulls, then pushes. If the team got ahead, pulls again and retries, at most three attempts in all. It first checks the
 * local head is still `expectedHead` (what the person previewed) and publishes nothing when it moved.
 */
export function startPublish(root: string, mode: AuditMode, expectedHead: string): SyncState {
  return start(root, mode, 'publish', expectedHead);
}
