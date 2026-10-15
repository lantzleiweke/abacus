import { userInfo } from 'node:os';
import type { Bead, BeadPatch, Comment, ExpectedFields, Gate, GateCreateResult, GateResolveResult, HumanResult, NewBead, StatusDef, WriteResult } from '../../shared/types';
import { closeBlockers, notClosedChildren } from '../../shared/close';
import { deriveGates, PLAN_APPROVAL_REASON, splitGates } from '../gates';
import { readAuditEvents, readUtcSince, runSql, type AuditEvent, type AuditMode } from './audit';
import { errorDetail, isRemoteMigrateGate, schemaSkewOf } from '../errors';
import { BdError, runBd, runBdJson, runGit } from './exec';
import { parseComments, parseExportWithWarnings, parseList, parseReady, parseStatuses, parseTypes } from './parse';

/** Reads wait out a short lock: two retries after the first attempt. */
const READ_OPTS = { retries: 2 } as const;

/** Longest piece of an unreadable export line quoted in an error. */
const BAD_LINE_MAX = 200;

const SIGNAL_QUERY = "SELECT DOLT_HASHOF_DB() AS working, DOLT_HASHOF('HEAD') AS head";

// One queue per project root. `bd` already serializes itself (embedded Dolt), but it does so by making
// callers wait with a timer running; queueing here means our own reads and writes never compete with
// each other and a slow call is a wait, not a timeout for the call behind it.
const queueTails = new Map<string, Promise<void>>();

/**
 * Runs `fn` after every earlier call for `root` has finished, whether it succeeded or failed. Every
 * `bd` or `dolt` call for one root goes through here. Never call it from inside `fn` for the same root: that waits on itself.
 */
export function withRootQueue<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const previous = queueTails.get(root) ?? Promise.resolve();
  const run = previous.then(fn);
  // The tail never rejects, so one failed call does not stop the ones behind it.
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  queueTails.set(root, tail);
  void tail.then(() => {
    if (queueTails.get(root) === tail) queueTails.delete(root);
  });
  return run;
}

const actors = new Map<string, Promise<string>>();

/** Forget cached panel actors. For tests. */
export function resetPanelActorCache(): void {
  actors.clear();
}

function osUserName(): string {
  try {
    return userInfo().username;
  } catch {
    return process.env.USER ?? 'user';
  }
}

/** Who the panel's writes are recorded as: `<git user.name, else the OS user> (panel)`. Asked once per root. */
export function panelActor(root: string): Promise<string> {
  const cached = actors.get(root);
  if (cached) return cached;
  const lookup = (async () => {
    let name = '';
    try {
      const result = await runGit(root, ['config', 'user.name']);
      if (result.code === 0) name = result.stdout.trim();
    } catch {
      // No git, or it failed: the OS user name stands in.
    }
    return `${name || osUserName()} (panel)`;
  })();
  actors.set(root, lookup);
  return lookup;
}

// ---- Writes ----

export type WriteErrorCode = 'invalid' | 'not-found' | 'blocked' | 'claimed' | 'dep-exists' | 'merge-conflict' | 'busy' | 'uncertain' | 'no-bd' | 'unsupported' | 'update-blocked-shared' | 'failed';

/**
 * A write Beads refused or could not finish. `message` is plain language for the user; `detail` is the raw text, for "Copy details".
 * `saved` is true when the change is known to be in and only reading the result back failed (the panel refreshes);
 * with `code: 'uncertain'` and `saved` false, the change may or may not be in.
 */
export class WriteError extends Error {
  readonly code: WriteErrorCode;
  readonly detail: string;
  readonly saved: boolean;

  constructor(code: WriteErrorCode, message: string, detail: string = message, saved = false) {
    super(message);
    this.name = 'WriteError';
    this.code = code;
    this.detail = detail;
    this.saved = saved;
  }
}

const LIVE_UNCONFIRMED = "Live updates may be on now, but Beads didn't confirm it.";
const LIVE_STILL_OFF = 'Beads accepted the change but still reports live updates as off. The project settings file may have been changed.';
export const SAVED_UNREAD = "Saved, but couldn't load the result. Refreshing.";
const SCHEMA_UNCONFIRMED = "The project may be updated now, but Beads didn't confirm it.";
/** The project syncs with the team, and Beads will not update a shared store in place: one person does it, then the others follow. No command words. */
export const SHARED_STORE_TEXT = "This project shares its beads with your team, so Beads won't update it from here. Ask whoever set up the team copy to update it, or update it on the computer that hosts it.";
const SCHEMA_STILL_OLD = 'Beads ran the update but the project still reads as out of date.';
const BUSY_NOT_SAVED = 'Beads is busy. Nothing was saved. Try again in a moment.';

/** One write call (re-read, write commands, re-read) must finish inside this, under the host's 20 s RPC limit. */
export const WRITE_BUDGET_MS = 18_000;
/**
 * The one-time update of an older store rewrites the project's data and is not a quick write: it gets its own budget, and its own
 * per-call limit, so the usual 15 s write limit never kills it partway (a killed update leaves the store half way, and bd cannot be asked again blindly).
 */
export const MIGRATE_BUDGET_MS = 120_000;
/** Kept back for the re-read, so a write that times out can still be checked. */
const WRITE_RESERVE_MS = 3_000;
/** A write is not started with less than this left. */
const MIN_WRITE_MS = 1_000;
/** The deadline is set when the call is made, so time spent waiting in the queue counts. Less than this left at the front of the queue: not started. */
const MIN_START_MS = WRITE_RESERVE_MS + MIN_WRITE_MS;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const ID_MAX = 128;
const KIND_PATTERN = /^[a-z][a-z0-9-]*$/i;
const OPEN = 'open';
const CLOSED = 'closed';
const IN_PROGRESS = 'in_progress';
const DEFERRED = 'deferred';
const OWN_CHILD = 'An epic cannot go inside its own child.';

function invalid(message: string): WriteError {
  return new WriteError('invalid', message);
}

function checkId(id: string): void {
  if (id.length > ID_MAX || !ID_PATTERN.test(id)) throw invalid('That bead id is not valid.');
}

function checkPriority(priority: number): void {
  if (!Number.isInteger(priority) || priority < 0 || priority > 4) throw invalid('Priority must be a whole number from 0 to 4.');
}

function checkTitle(title: string): void {
  if (title.trim() === '') throw invalid('A bead needs a title.');
}

const DATE_TEXT_MAX = 100;

/** Date text is passed to Beads as typed (it decides what it means), so the only rules are the ones that keep it one argument: trimmed, 1 to 100 characters, one line. */
function checkDateText(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.length > DATE_TEXT_MAX || /[\r\n]/.test(trimmed)) throw invalid(`A date is one line of 1 to ${DATE_TEXT_MAX} characters.`);
  return trimmed;
}

function checkPatch(patch: BeadPatch): void {
  if (patch.title !== undefined) checkTitle(patch.title);
  // The type is not checked against the project's: Beads refuses an unknown one itself, and `writeFailure` words that.
  if (patch.type !== undefined && patch.type.trim() === '') throw invalid('Pick a type.');
  if (typeof patch.parent === 'string') checkId(patch.parent);
  if (typeof patch.due === 'string') checkDateText(patch.due);
  if (patch.priority !== undefined) checkPriority(patch.priority);
  if (patch.status !== undefined && patch.status.trim() === '') throw invalid('Pick a status.');
  // Beads reads a label flag as CSV, so a comma splits the label and a double quote starts a quoted field.
  for (const label of patch.labels ?? []) {
    if (label.trim() === '') throw invalid('A label cannot be empty.');
    if (/[\r\n]/.test(label)) throw invalid('A label cannot contain a line break.');
    if (label.includes(',') || label.includes('"')) throw invalid('A label cannot contain a comma or a double quote.');
  }
}

/** The beads a refused close says it waits on, or null when the text is not that refusal. 1.2.2: `blocked by open issues [a, b]`; 1.3.x: `cannot close blocked issue: x is blocked by [a, b]`. */
function blockerIds(text: string): string[] | null {
  const blocked = /(?:blocked by open issues|is blocked by)\s*\[([^\]]*)\]/i.exec(text);
  if (!blocked) return null;
  // 1.3.x prints a blocker that is not a plain `blocks` link with its kind: `b (conditional-blocks)`.
  return blocked[1]!.replace(/\([^)]*\)/g, '').split(/[\s,]+/).filter((id) => id !== '');
}

/** Plain-language errors for what bd is known to refuse. Anything else is "failed", with the raw text kept as detail. */
export function writeFailure(error: unknown, partial = false): WriteError {
  const saved = partial ? ' Part of your change was saved.' : '';
  if (error instanceof WriteError) return error;
  if (!(error instanceof BdError)) return new WriteError('failed', `The change could not be saved.${saved}`, String(error));
  if (error.kind === 'not-found') return new WriteError('no-bd', 'Beads could not be found on this computer, so nothing was saved.', error.message);
  if (error.kind === 'lock') return new WriteError('busy', `Beads is busy.${partial ? saved : ' Nothing was saved.'} Try again in a moment.`, error.message);
  const text = `${error.message}\n${error.stderr}`;
  // An older bd does not have the command or the flag the write used.
  if (/Error: unknown (?:command|flag|shorthand flag)/i.test(text)) return new WriteError('unsupported', 'This version of Beads does not support that.', text);
  const ids = blockerIds(text);
  if (ids) return new WriteError('blocked', `This bead can't be closed yet. It is still blocked by ${ids.join(', ')}. Close those first.${saved}`, text);
  // bd 1.3: a bead held in progress cannot be reassigned by someone else. Never retried with --force.
  if (/cannot reassign/i.test(text) || /\bheld by\b/i.test(text)) {
    const holder = /held by "([^"]+)"/i.exec(text)?.[1]?.trim();
    return new WriteError('claimed', `${holder ? `${holder} is` : 'Someone is'} working on this bead. Move it out of In progress first, or ask them.${saved}`, text);
  }
  if (/no issue found matching|Error resolving/i.test(text)) {
    return new WriteError('not-found', `That bead no longer exists.${saved}`, text);
  }
  // A date Beads cannot read: its message ends with a list of example forms, which is for a terminal, not for this panel.
  const date = /invalid --(?:due|until|defer) format "([^"]*)"/i.exec(text);
  if (date) return new WriteError('invalid', `That date isn't one Beads understands: "${date[1]}".${saved}`, text);
  const type = /invalid issue type\s+(\S+)/i.exec(text);
  if (type) return new WriteError('invalid', `"${type[1]}" is not a type in this project.${saved}`, text);
  const existing = /already exists with type "([^"]+)"/i.exec(text);
  if (existing) {
    return new WriteError('dep-exists', `These two beads are already linked as "${existing[1]}". Remove that link first, then add the new one.${saved}`, text);
  }
  if (/in conflict|Merge conflict detected/i.test(text)) {
    return new WriteError('merge-conflict', `The team sync has changes that need sorting out first. Resolve them, then try again.${saved}`, text);
  }
  if (/tasks can only block other tasks/i.test(text)) return new WriteError('invalid', 'Only tasks can block other tasks.', text);
  return new WriteError('failed', `The change could not be saved.${saved}`, text);
}

/** A failed read before any write: nothing was changed. */
export function readFailure(error: unknown): WriteError {
  if (error instanceof BdError && (error.kind === 'timeout' || error.kind === 'lock')) {
    return new WriteError('busy', BUSY_NOT_SAVED, error.message);
  }
  return writeFailure(error);
}

/**
 * The project's statuses and the set that counts as done: `closed` plus every status in a done category, custom ones included.
 * Read inside the caller's queue turn (not through `statuses()`, which waits in that same queue), under its deadline.
 * A failed read is `readFailure`: nothing was changed.
 */
async function readStatuses(root: string, deadlineAt: number): Promise<{ statuses: StatusDef[]; done: Set<string> }> {
  try {
    const statuses = parseStatuses(await runBdJson<unknown>(root, ['--readonly', 'statuses', '--json'], { ...READ_OPTS, deadlineAt }));
    return { statuses, done: new Set([CLOSED, ...statuses.filter((s) => s.category === 'done').map((s) => s.name)]) };
  } catch (error) {
    throw readFailure(error);
  }
}

/** bd 1.3.1 `bd close` refuses `cannot close X: N open child issue(s); close children first ...`. */
const OPEN_CHILDREN = /cannot close [^:\n]+: \d+ open child issue/i;

/** A move that would put a bead under itself or one of its own descendants, or under a bead that is gone, is refused here: nothing was sent to Beads. */
function checkMove(rows: Bead[], id: string, parent: string): void {
  if (parent === id) throw invalid('A bead cannot go inside itself.');
  const byId = new Map(rows.map((b) => [b.id, b]));
  if (!byId.has(parent)) throw invalid('That epic no longer exists.');
  // Walk up from the new parent: reaching the bead means the parent is one of its descendants.
  const seen = new Set<string>();
  for (let at: string | null = parent; at !== null && !seen.has(at); at = byId.get(at)?.parentId ?? null) {
    if (at === id) throw invalid(OWN_CHILD);
    seen.add(at);
  }
}

/** A close refused before bd was asked: it waits on `ids` (a review gate is named as one, not by its id). Nothing was written. */
function closeBlocked(what: 'bead' | 'request', rows: Bead[], ids: string[]): WriteError {
  const gates = new Set(rows.filter((b) => b.type === 'gate').map((b) => b.id));
  const names = [...new Set(ids.map((blocker) => (gates.has(blocker) ? 'a review' : blocker)))];
  return new WriteError('blocked', `This ${what} can't be closed yet. It is still waiting on ${names.join(', ')}.`, `blocked by open ${ids.join(', ')}; nothing was sent to Beads`);
}

/** Thrown by `runWrite` when the deadline left no room to start: nothing was sent to Beads. */
class NotStarted extends Error {}

/** The write did not start in time, and nothing was saved. `partial`: an earlier step of the same change was. */
function notStartedError(partial: boolean): WriteError {
  return partial
    ? new WriteError('busy', 'Beads is busy. Part of your change was saved. Try again in a moment.', 'ran out of time before the last step')
    : new WriteError('busy', BUSY_NOT_SAVED, 'ran out of time before the write started');
}

/** Before anything is sent: less than the minimum left on the call's deadline (it waited in the queue) means busy, nothing saved. */
export function ensureCanStart(overall: number): void {
  if (overall - Date.now() < MIN_START_MS) throw notStartedError(false);
}

/**
 * What a panel write touched on its bead: the fields it set (as change events name them), the links it added or removed
 * (`[from, to]`), a comment, or the bead's creation. Only these are credited to the panel when the audit log names nobody.
 */
export type PanelWrite = { fields?: string[]; deps?: Array<[string, string]>; comment?: true; created?: true };

export type PanelWriteListener = (root: string, beadId: string, wrote: PanelWrite) => void | Promise<void>;
const panelWriteListeners = new Set<PanelWriteListener>();

/** Called after every write the panel made (or may have made) to a bead, inside the root's queue and before the next call runs. Returns a function that removes it. */
export function onPanelWrite(listener: PanelWriteListener): () => void {
  panelWriteListeners.add(listener);
  return () => panelWriteListeners.delete(listener);
}

/** Tells the listeners. A listener that throws never fails the write: its error text comes back, for the result's `detail`. */
export async function notePanelWrite(root: string, beadId: string, wrote: PanelWrite): Promise<string | undefined> {
  return notifyPanelWrite(root, beadId, wrote);
}

/** Patch keys that change events name differently, or not at all (the comment rides with the `status` change; the close reason keeps its name, as the diff emits it when a reason changes without a move into or out of done). */
const FIELD_NAMES: Partial<Record<keyof BeadPatch, string | null>> = { parent: 'parentId', due: 'due_at', closeComment: null };

/** The fields a patch sets, named as change events name them (a move into or out of done is the `status` field). */
const patchFields = (patch: BeadPatch): string[] =>
  (Object.keys(patch) as Array<keyof BeadPatch>).filter((key) => patch[key] !== undefined).flatMap((key) => {
    const name = key in FIELD_NAMES ? FIELD_NAMES[key] : key;
    return name === null || name === undefined ? [] : [name];
  });

async function notifyPanelWrite(root: string, beadId: string, wrote: PanelWrite): Promise<string | undefined> {
  const problems: string[] = [];
  for (const listener of [...panelWriteListeners]) {
    try {
      await listener(root, beadId, wrote);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  return problems.length > 0 ? `Could not note the change to ${beadId}: ${problems.join('; ')}` : undefined;
}

/** One bead as Beads lists it, or null when there is none. The listing has only a count of comments, so `comments` is empty until `withComments` fills it. */
async function readBeadRow(root: string, id: string, deadlineAt: number): Promise<{ bead: Bead; commentCount: number } | null> {
  const rows = await runBdJson<unknown>(root, ['--readonly', 'list', '--all', '--id', id, '--json'], { ...READ_OPTS, deadlineAt });
  const bead = parseList(rows).find((b) => b.id === id);
  if (!bead) return null;
  const raw = (Array.isArray(rows) ? rows : []).find((row: unknown) => (row as { id?: unknown } | null)?.id === id) as { comment_count?: unknown } | undefined;
  return { bead, commentCount: typeof raw?.comment_count === 'number' ? raw.comment_count : 0 };
}

/** Fills in the comments of a bead that has any (one more call, under the same deadline). */
async function withComments(root: string, row: { bead: Bead; commentCount: number }, deadlineAt: number): Promise<Bead> {
  if (row.commentCount > 0) {
    row.bead.comments = parseComments(await runBdJson<unknown>(root, ['--readonly', 'comments', row.bead.id, '--json'], { ...READ_OPTS, deadlineAt }));
  }
  return row.bead;
}

/** One bead as Beads lists it, with its comments, or null when there is none. */
async function readBead(root: string, id: string, deadlineAt: number): Promise<Bead | null> {
  const row = await readBeadRow(root, id, deadlineAt);
  return row === null ? null : withComments(root, row, deadlineAt);
}

/** A write command. Never retried: a timeout may have saved. The deadline leaves room for the re-read. */
function runWrite(root: string, actor: string, args: string[], overall: number, text = false, timeoutMs?: number): Promise<unknown> {
  const deadlineAt = overall - WRITE_RESERVE_MS;
  if (deadlineAt - Date.now() < MIN_WRITE_MS) return Promise.reject(new NotStarted());
  // `timeoutMs` lifts the per-call limit (default 15 s) for the one write that is long by nature; the deadline still bounds it.
  const limits = { retries: 0, deadlineAt, ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
  if (!text) return runBdJson<unknown>(root, ['--actor', actor, ...args], limits);
  // A command that prints plain text (`gate resolve`): only the exit code says whether it worked, and the caller reads the result back.
  return runBd(root, ['--actor', actor, ...args], limits).then((result) => {
    if (result.code !== 0) throw new BdError('exit', result.stderr.trim() || result.stdout.trim() || `bd exited with code ${result.code}`, { code: result.code, stderr: result.stderr });
    return result.stdout;
  });
}

/** A write of one thing (create, comment, link): a timeout is "may have saved", anything else is mapped. `text`: the command prints text, not JSON. */
export async function writeOne(root: string, actor: string, args: string[], overall: number, owner: { id: string; wrote: PanelWrite } | null, what: string, text = false, timeoutMs?: number): Promise<unknown> {
  try {
    return await runWrite(root, actor, args, overall, text, timeoutMs);
  } catch (error) {
    if (error instanceof NotStarted) throw notStartedError(false);
    if (error instanceof BdError && error.kind === 'timeout') {
      const noted = owner !== null ? await notifyPanelWrite(root, owner.id, owner.wrote) : undefined;
      throw new WriteError('uncertain', `Beads did not answer in time. The ${what} may or may not have been saved. Check before trying again.`, [error.message, noted].filter(Boolean).join('\n'));
    }
    throw writeFailure(error);
  }
}

const sameLabels = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;

/** Whether every shown value still holds: titles trimmed, labels as sets, an empty assignee as none. */
export function stillAsShown(expected: ExpectedFields, current: Bead): boolean {
  for (const [key, value] of Object.entries(expected) as Array<[keyof ExpectedFields, ExpectedFields[keyof ExpectedFields]]>) {
    if (value === undefined) continue;
    // The due date is stored in `extra`, under bd's own name.
    const now = key === 'due' ? current.extra.due_at ?? null : current[key];
    if (key === 'title' ? String(value).trim() !== String(now).trim()
      : key === 'labels' ? !sameLabels(value as string[], now as string[])
      : key === 'assignee' ? ((value as string | null) || null) !== ((now as string | null) || null)
      : key === 'due' ? ((value as string | null) || null) !== ((now as string | null) || null)
      : value !== now) return false;
  }
  return true;
}

/** The bd calls that turn `current` into `patch`, as `[command args]` without `--actor`. Empty when nothing differs. */
function planUpdate(id: string, current: Bead, patch: BeadPatch, done: Set<string>): string[][] {
  const flags: string[] = [];
  const title = patch.title?.trim();
  if (title !== undefined && title !== current.title) flags.push(`--title=${title}`);
  if (patch.priority !== undefined && patch.priority !== current.priority) flags.push(`--priority=${patch.priority}`);
  if (patch.assignee !== undefined) {
    const assignee = patch.assignee === '' ? null : patch.assignee;
    if (assignee !== current.assignee) flags.push(`--assignee=${assignee ?? ''}`);
  }
  if (patch.description !== undefined && patch.description !== current.description) flags.push(`--description=${patch.description}`);
  if (patch.design !== undefined && patch.design !== current.design) flags.push(`--design=${patch.design}`);
  if (patch.acceptance !== undefined && patch.acceptance !== current.acceptance) flags.push(`--acceptance=${patch.acceptance}`);
  if (patch.notes !== undefined && patch.notes !== current.notes) flags.push(`--notes=${patch.notes}`);
  if (patch.labels !== undefined) {
    const wanted = new Set(patch.labels);
    const have = new Set(current.labels);
    for (const label of wanted) if (!have.has(label)) flags.push(`--add-label=${label}`);
    for (const label of have) if (!wanted.has(label)) flags.push(`--remove-label=${label}`);
  }
  if (patch.type !== undefined && patch.type !== current.type) flags.push(`--type=${patch.type}`);
  // Date text goes in as typed: Beads reads it, and what it stored will not match the text, so a date is always sent.
  if (typeof patch.due === 'string') flags.push(`--due=${patch.due.trim()}`);
  else if (patch.due === null && current.extra.due_at !== undefined) flags.push('--due=');
  if (patch.parent !== undefined && patch.parent !== current.parentId) flags.push(`--parent=${patch.parent ?? ''}`);

  // Into a done category, or from a custom done status to "closed": `close` first, so the blocker guard and the close
  // reason apply. A custom done status then needs an `update --status` on top (which makes bd drop the bead's close time and reason; the close stays in the
  // audit log). Out of "closed": `reopen`. Anything else is a plain update.
  const steps: string[][] = [];
  const target = patch.status;
  if (target !== undefined && target !== current.status) {
    const toDone = done.has(target);
    const fromDone = done.has(current.status);
    if (toDone && (!fromDone || target === CLOSED)) {
      const reason = patch.closeReason?.trim();
      steps.push(['close', '--json', ...(reason ? [`--reason=${reason}`] : []), '--', id]);
      if (target !== CLOSED) flags.push(`--status=${target}`);
    } else if (!toDone && current.status === CLOSED) {
      steps.push(['reopen', '--json', '--', id]);
      if (target !== OPEN) flags.push(`--status=${target}`);
    } else if (flags.some((flag) => flag.startsWith('--assignee=')) && current.status === IN_PROGRESS) {
      // bd 1.3 refuses to reassign a bead held in progress, even in the same call that moves it out: status first, then the rest.
      steps.push(['update', '--json', `--status=${target}`, '--', id]);
    } else {
      flags.push(`--status=${target}`);
    }
  }
  if (flags.length > 0) steps.push(['update', '--json', ...flags, '--', id]);
  return steps;
}

function rowString(row: Record<string, unknown> | undefined, key: string): string | null {
  const value = row?.[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** `bd export`, read whole or not at all: a bead missing from a half-read export would show as deleted. Never queues; callers hold the queue. */
async function readExport(root: string, opts: { deadlineAt?: number } = {}): Promise<Bead[]> {
  const result = await runBd(root, ['--readonly', 'export'], { ...READ_OPTS, ...opts });
  if (result.code !== 0) {
    throw new BdError('exit', `bd export failed with exit code ${result.code}`, { code: result.code, stderr: result.stderr });
  }
  const { beads, skipped, firstSkipped } = parseExportWithWarnings(result.stdout);
  if (skipped > 0) {
    const line = firstSkipped ?? '';
    const first = line.length > BAD_LINE_MAX ? `${line.slice(0, BAD_LINE_MAX)}…` : line;
    throw new BdError('parse', `bd export printed ${skipped} line${skipped === 1 ? '' : 's'} that could not be read; the first was: ${first}`, {
      stderr: result.stderr,
    });
  }
  return beads;
}

/** The export split into beads and gates, as a write needs to check them (inside the queue, under the call's deadline). */
async function readGates(root: string, deadlineAt: number): Promise<{ beads: Bead[]; gateRows: Bead[]; gates: Gate[] }> {
  const { beads, gateRows } = splitGates(await readExport(root, { deadlineAt }));
  return { beads, gateRows, gates: deriveGates(gateRows, beads).gates };
}

const GATE_REASON_MAX = 500;
const REVIEW_GATE_ONLY = 'Only review gates can be resolved here.';

/** A reason is one line of 1 to 500 characters once trimmed; it travels as one argument and is never shell text. */
function checkGateReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed === '' || trimmed.length > GATE_REASON_MAX || /[\r\n]/.test(trimmed)) {
    throw invalid(`A reason is one line of 1 to ${GATE_REASON_MAX} characters.`);
  }
  return trimmed;
}

const HUMAN_LABEL = 'human';
const REASON_NOT_SAVED = 'The request was closed, but the reason was not saved.';
const RECORDED_DIFFERENTLY = 'The request was closed, but Beads recorded it differently.';
const HUMAN_RESPONSE_MAX = 16_000;

/** An answer to a help request: 1 to 16,000 characters once trimmed, line breaks kept. It travels as one argument. */
function checkHumanResponse(response: string): string {
  const trimmed = response.trim();
  if (trimmed === '' || trimmed.length > HUMAN_RESPONSE_MAX) throw invalid(`An answer is 1 to ${HUMAN_RESPONSE_MAX.toLocaleString('en-US')} characters.`);
  return trimmed;
}

/** `bd config get events-journal`: `true` or `false`. Anything else, or a read that fails, is `unknown`. Never queues; callers hold the queue. */
async function readJournalSetting(root: string, deadlineAt?: number): Promise<'on' | 'off' | 'unknown'> {
  try {
    const result = await runBd(root, ['--readonly', 'config', 'get', 'events-journal'], deadlineAt === undefined ? READ_OPTS : { ...READ_OPTS, deadlineAt });
    if (result.code !== 0) return 'unknown';
    const text = result.stdout.trim();
    return text === 'true' ? 'on' : text === 'false' ? 'off' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The read side of beads for one project root. Every call is queued behind the root's other calls. */
export class BdProvider {
  constructor(
    readonly root: string,
    readonly mode: AuditMode,
  ) {}

  /**
   * A string that differs whenever the database does (working set and last commit). Cheap: about 0.15 s embedded, 0.25 s server.
   * When the query cannot run because a tool is missing (embedded mode without the dolt CLI), the last commit hash from
   * `bd vc status` stands in. When that cannot be read either, this throws a `not-found` BdError.
   */
  changeSignal(): Promise<string> {
    return withRootQueue(this.root, async () => {
      try {
        const [row] = await runSql(this.root, this.mode, SIGNAL_QUERY, undefined);
        const working = rowString(row, 'working');
        const head = rowString(row, 'head');
        if (working === null || head === null) throw new BdError('parse', 'the database did not answer with a change signal');
        return `${working}:${head}`;
      } catch (error) {
        if (!(error instanceof BdError) || error.kind !== 'not-found') throw error;
        return this.vcStatusSignal(error);
      }
    });
  }

  /**
   * Whether the events journal (bd 1.3) is on for this project: `on`, `off`, or `unknown` when Beads could not say.
   * Read-only; never starts anything.
   */
  eventsJournal(): Promise<'on' | 'off' | 'unknown'> {
    return withRootQueue(this.root, () => readJournalSetting(this.root));
  }

  /**
   * Turns the events journal on. This is the one place in the service that writes a project setting, and only the Settings button
   * reaches it. It edits the tracked `.beads/config.yaml`, so the file changes in the person's working tree. Never `--force`.
   * The answer is what a read afterwards shows, not what was printed. Throws WriteError; a timeout is `uncertain`.
   */
  async enableEventsJournal(actor: string): Promise<void> {
    const overall = Date.now() + WRITE_BUDGET_MS;
    return withRootQueue(this.root, async () => {
      ensureCanStart(overall);
      await writeOne(this.root, actor, ['config', 'set', 'events-journal', 'true'], overall, null, 'setting', true);
      const after = await readJournalSetting(this.root, overall);
      // Beads said it set it, so the project file has most likely changed. A read that cannot say is "saved, not confirmed", never "didn't happen".
      if (after === 'unknown') throw new WriteError('uncertain', LIVE_UNCONFIRMED, 'the setting could not be read back after it was set', true);
      if (after !== 'on') throw new WriteError('failed', LIVE_STILL_OFF, 'the setting reads back as off after it was set');
    });
  }

  /**
   * Updates the project's store to the schema the installed Beads expects: the one explicit way out of a refused read-only open
   * (`schemaSkewOf`), and only the Update button reaches it. Never `--force`, never `BD_IGNORE_SCHEMA_SKEW`. `--json` prints text on
   * 1.3.1, so only the exit code counts, and the answer is what a read-only read shows afterwards. Throws WriteError; a timeout is `uncertain`.
   * It runs under its own long budget (`MIGRATE_BUDGET_MS`), never the usual write limit, and is never killed before that.
   */
  async migrateSchema(actor: string): Promise<void> {
    const overall = Date.now() + MIGRATE_BUDGET_MS;
    return withRootQueue(this.root, async () => {
      ensureCanStart(overall);
      try {
        await writeOne(this.root, actor, ['migrate', 'schema'], overall, null, 'update', true, MIGRATE_BUDGET_MS);
      } catch (error) {
        // Beads' own gate for a store shared with a team (a remote, or a shared server). Not retried and never forced: the person is told
        // who can do it. Checked for `busy` too, so a refusal whose words happen to read as a lock is still the refusal.
        if (error instanceof WriteError && (error.code === 'failed' || error.code === 'busy') && isRemoteMigrateGate(error.detail)) throw new WriteError('update-blocked-shared', SHARED_STORE_TEXT, error.detail);
        throw error;
      }
      try {
        await runBdJson<unknown>(this.root, ['--readonly', 'statuses', '--json'], { ...READ_OPTS, deadlineAt: overall });
      } catch (error) {
        // Still refused: the update did not take. Anything else (busy, a timeout): it ran, and the read could not say.
        if (schemaSkewOf(error)) throw new WriteError('failed', SCHEMA_STILL_OLD, errorDetail(error));
        throw new WriteError('uncertain', SCHEMA_UNCONFIRMED, errorDetail(error), true);
      }
    });
  }

  private async vcStatusSignal(primary: BdError): Promise<string> {
    try {
      const status = await runBdJson<unknown>(this.root, ['--readonly', 'vc', 'status', '--json'], READ_OPTS);
      const commit = typeof status === 'object' && status !== null ? (status as { commit?: unknown }).commit : undefined;
      if (typeof commit !== 'string' || commit === '') throw new BdError('parse', 'bd vc status did not print a commit');
      return `vc:${commit}`;
    } catch (error) {
      // A busy database is a passing problem and reads as one; anything else means there is no signal to be had.
      if (error instanceof BdError && (error.kind === 'lock' || error.kind === 'timeout')) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new BdError('not-found', `no change signal is available (${primary.message}; ${reason})`);
    }
  }

  /**
   * Every bead. Throws when bd fails, or when any line of the output could not be read: an export is
   * applied whole or not at all, never with beads missing (a missing bead would show as deleted).
   */
  export(): Promise<Bead[]> {
    return withRootQueue(this.root, () => readExport(this.root));
  }

  statuses(): Promise<StatusDef[]> {
    return withRootQueue(this.root, async () => parseStatuses(await runBdJson<unknown>(this.root, ['--readonly', 'statuses', '--json'], READ_OPTS)));
  }

  types(): Promise<string[]> {
    return withRootQueue(this.root, async () => parseTypes(await runBdJson<unknown>(this.root, ['--readonly', 'types', '--json'], READ_OPTS)));
  }

  /**
   * The newest `limit` database versions of a bead (`rows`, newest first; null for an id bd does not know) and, when `events`
   * is asked for (bd 1.3 and later), its audit events as a second read in the same turn. Events that cannot be read come back
   * as null: the versions are still worth showing. The raw output goes to `buildHistory`. `utcSince`: from when the store's event
   * stamps are real UTC (null when unknown).
   */
  history(id: string, options: { limit: number; events: boolean }): Promise<{ rows: unknown; events: unknown | null; utcSince?: number | null }> {
    checkId(id);
    const limit = String(Math.max(1, Math.floor(options.limit)));
    return withRootQueue(this.root, async () => {
      const rows = await runBdJson<unknown>(this.root, ['--readonly', 'history', '--json', '--limit', limit, '--', id], READ_OPTS);
      if (!options.events || rows === null) return { rows, events: null };
      try {
        const events = await runBdJson<unknown>(this.root, ['--readonly', 'history', '--events', '--json', '--limit', limit, '--', id], READ_OPTS);
        // Inside the queue: the read is a direct call. It says which event stamps are UTC (a 1.2.x row's is local time).
        return { rows, events, utcSince: await readUtcSince(this.root, this.mode) };
      } catch {
        return { rows, events: null };
      }
    });
  }

  /**
   * The gate rows among `gateIds` (open and closed; gate rows are not in `list` without `--type gate`) and their audit events,
   * for a bead's History: a gate's own `created` and `closed` events say who and when, whatever the service happened to see.
   * `events` is null when the audit log cannot be read. `utc`: bd is 1.3 or later, so the rows since the store's migration are dated (`readUtcSince`).
   */
  gateHistory(gateIds: string[], options: { utc: boolean }): Promise<{ rows: Bead[]; events: AuditEvent[] | null }> {
    for (const gateId of gateIds) checkId(gateId);
    if (gateIds.length === 0) return Promise.resolve({ rows: [], events: [] });
    const wanted = new Set(gateIds);
    return withRootQueue(this.root, async () => {
      const listed = await runBdJson<unknown>(this.root, ['--readonly', 'list', '--all', '--type', 'gate', '--limit', '0', '--json'], READ_OPTS);
      const rows = parseList(listed).filter((row) => wanted.has(row.id));
      if (rows.length === 0) return { rows, events: [] };
      // Inside the queue: the audit read is a direct call, not a queued one.
      return { rows, events: await readAuditEvents(this.root, this.mode, { beadIds: rows.map((row) => row.id), limit: 500, utcCreatedAt: options.utc }) };
    });
  }

  /** Ids of ready beads. `--limit 0`: bd's default stops at 100. */
  ready(): Promise<string[]> {
    return withRootQueue(this.root, async () => parseReady(await runBdJson<unknown>(this.root, ['--readonly', 'ready', '--json', '--limit', '0'], READ_OPTS)));
  }

  /**
   * Changes a bead if it is still as the panel last saw it (`expectedUpdatedAt`): the bead is read again first, and a
   * different `updatedAt` returns `conflict` with the current bead and writes nothing. Fields that already have the
   * wanted value are left out. A status change into a done category closes first (with `closeReason`; a refused close
   * stops everything), and a custom done status is then set with an update. Away from "closed" it reopens.
   * Beads not answering in time returns `uncertain` (never retried); the write saved but could not be read back returns
   * `uncertain` with `saved: true`. Throws WriteError for a refusal, and `busy` when the queue wait used up the 18 s.
   */
  async update(id: string, expectedUpdatedAt: string, patch: BeadPatch, actor: string, expected: ExpectedFields = {}): Promise<WriteResult> {
    checkId(id);
    checkPatch(patch);
    const overall = Date.now() + WRITE_BUDGET_MS;
    return withRootQueue(this.root, async () => {
      ensureCanStart(overall);
      const row = await this.readRowToWrite(id, overall);
      const current = row.bead;
      // `updatedAt` is to the second: a change in the same second leaves it, so the shown values are checked too.
      if (current.updatedAt !== expectedUpdatedAt || !stillAsShown(expected, current)) return { ok: false, conflict: true, current: await this.currentOf(row, overall) };

      if (typeof patch.parent === 'string' && patch.parent !== current.parentId) checkMove(await this.readRows(overall), id, patch.parent);

      let done = new Set([CLOSED]);
      if (patch.status !== undefined && patch.status !== current.status) {
        const read = await readStatuses(this.root, overall);
        if (read.statuses.length > 0 && !read.statuses.some((s) => s.name === patch.status)) throw invalid(`"${patch.status}" is not a status in this project.`);
        done = read.done;
      }

      const steps = planUpdate(id, current, patch, done);
      if (steps.length === 0) return { ok: true, bead: await this.currentOf(row, overall) };

      // A comment that goes with a close is added first, and stays when the close is refused. It is left out when nothing closes.
      const comment = patch.closeComment?.trim();
      let commentAdded = false;
      if (comment && steps[0]![0] === 'close') {
        await writeOne(this.root, actor, ['comments', 'add', '--json', `--author=${actor}`, '--', id, comment], overall, { id, wrote: { comment: true } }, 'comment');
        await notifyPanelWrite(this.root, id, { comment: true });
        commentAdded = true;
      }
      return this.runSteps(id, steps, actor, overall, { fields: patchFields(patch) }, commentAdded);
    });
  }

  /** The bead as the list has it (no comments yet), or `not-found`. Call inside the queue. */
  private async readRowToWrite(id: string, overall: number): Promise<{ bead: Bead; commentCount: number }> {
    let row: { bead: Bead; commentCount: number } | null;
    try {
      row = await readBeadRow(this.root, id, overall);
    } catch (error) {
      throw readFailure(error);
    }
    if (row === null) throw new WriteError('not-found', 'That bead no longer exists.');
    return row;
  }

  /** The bead with its comments, for an answer that hands it back (a conflict, or nothing to change). Call inside the queue. */
  private async currentOf(row: { bead: Bead; commentCount: number }, overall: number): Promise<Bead> {
    try {
      return await withComments(this.root, row, overall);
    } catch (error) {
      throw readFailure(error);
    }
  }

  /** Every row of the project, read whole, for a check a write needs. A failed read is `readFailure`: nothing was changed. Call inside the queue. */
  private async readRows(overall: number): Promise<Bead[]> {
    try {
      return await readExport(this.root, { deadlineAt: overall });
    } catch (error) {
      throw readFailure(error);
    }
  }

  /**
   * Runs the write steps of one change, then notes it and reads the bead again. A timeout is `uncertain` (never retried). A refusal
   * throws; `commentAdded` (an earlier step that stays) makes it say so and carry `saved`, like a step of the same change that went in.
   */
  private async runSteps(id: string, steps: string[][], actor: string, overall: number, wrote: PanelWrite, commentAdded = false): Promise<WriteResult> {
    let stepped = false;
    try {
      for (const step of steps) {
        await runWrite(this.root, actor, step, overall);
        stepped = true;
      }
    } catch (error) {
      const timedOut = error instanceof BdError && error.kind === 'timeout';
      // The change may have gone in even when Beads did not answer, so the next refresh still counts as the panel's.
      const noted = stepped || timedOut ? await notifyPanelWrite(this.root, id, wrote) : undefined;
      if (timedOut) {
        const detail = [noted, (error as BdError).message].filter(Boolean).join('\n');
        return { ok: false, uncertain: true, current: await this.readAgain(id, overall), detail };
      }
      // The reason is worded for what this change did (`stepped`); a comment that went in before a refused close is said once, in front of it.
      let failure = error instanceof NotStarted ? notStartedError(stepped) : writeFailure(error, stepped);
      if (failure.code === 'failed' && error instanceof BdError && OPEN_CHILDREN.test(`${error.message}\n${error.stderr}`)) {
        failure = await this.openChildrenFailure(id, overall, stepped, failure.detail);
      } else if (failure.code === 'blocked' && error instanceof BdError) {
        failure = await this.gateAwareBlocked(failure, `${error.message}\n${error.stderr}`, overall, stepped);
      }
      let message = failure.message;
      if (commentAdded && !stepped) message = `Your comment was added, but the bead could not be closed. ${message.replace(/\s*Nothing was saved\./, '')}`;
      // An earlier step went in: `saved`, so the panel reads the bead again instead of showing it as it was.
      throw new WriteError(failure.code, message, noted ? `${failure.detail}\n${noted}` : failure.detail, failure.saved || stepped || commentAdded);
    }
    const noted = await notifyPanelWrite(this.root, id, wrote);
    const bead = await this.readAgain(id, overall);
    if (bead === null) return { ok: false, uncertain: true, current: null, saved: true, ...(noted ? { detail: noted } : {}) };
    return { ok: true, bead, ...(noted ? { detail: noted } : {}) };
  }

  /**
   * Snoozes a bead until `until` (date text as typed; Beads decides what it means), or with `null` until it is brought back.
   * Refused as a conflict when the bead changed since `expectedUpdatedAt`, and for a finished bead. A plain defer keeps an old
   * date, so an indefinite snooze of a bead that has one clears it first.
   */
  async deferBead(id: string, expectedUpdatedAt: string, until: string | null, reason: string | undefined, actor: string): Promise<WriteResult> {
    checkId(id);
    const when = until === null ? null : checkDateText(until);
    const why = reason === undefined ? undefined : checkGateReason(reason);
    const overall = Date.now() + WRITE_BUDGET_MS;
    return withRootQueue(this.root, async () => {
      ensureCanStart(overall);
      const row = await this.readRowToWrite(id, overall);
      const current = row.bead;
      if (current.updatedAt !== expectedUpdatedAt) return { ok: false, conflict: true, current: await this.currentOf(row, overall) };
      const { done } = await readStatuses(this.root, overall);
      if (done.has(current.status)) throw invalid("A finished bead can't be snoozed.");
      const steps: string[][] = [];
      if (when === null && current.extra.defer_until !== undefined) steps.push(['update', '--json', '--defer=', '--', id]);
      steps.push(['defer', '--json', ...(when !== null ? [`--until=${when}`] : []), ...(why !== undefined ? [`--reason=${why}`] : []), '--', id]);
      return this.runSteps(id, steps, actor, overall, { fields: ['status', 'defer_until'] });
    });
  }

  /**
   * Brings a snoozed bead back. A bead not in the deferred status that still carries a defer date (its status was changed
   * without clearing it) has only the date cleared, with the same internal step an indefinite defer uses; its status stays.
   * A bead with neither is handed back as it is, nothing written.
   */
  async undeferBead(id: string, expectedUpdatedAt: string, actor: string): Promise<WriteResult> {
    checkId(id);
    const overall = Date.now() + WRITE_BUDGET_MS;
    return withRootQueue(this.root, async () => {
      ensureCanStart(overall);
      const row = await this.readRowToWrite(id, overall);
      const current = row.bead;
      if (current.updatedAt !== expectedUpdatedAt) return { ok: false, conflict: true, current: await this.currentOf(row, overall) };
      if (current.status !== DEFERRED && current.extra.defer_until !== undefined) {
        return this.runSteps(id, [['update', '--json', '--defer=', '--', id]], actor, overall, { fields: ['defer_until'] });
      }
      if (current.status !== DEFERRED) return { ok: true, bead: await this.currentOf(row, overall) };
      return this.runSteps(id, [['undefer', '--json', '--', id]], actor, overall, { fields: ['status', 'defer_until'] });
    });
  }

  /** Closes a bead as replaced by `other`, with a `supersedes` link to it. Same rules as a plain close (see `closeAs`). */
  supersede(id: string, other: string, expectedUpdatedAt: string, actor: string): Promise<WriteResult> {
    return this.closeAs('supersede', id, other, expectedUpdatedAt, actor);
  }

  /** Closes a bead as a duplicate of `other`, with a `duplicates` link to it. Same rules as a plain close (see `closeAs`). */
  duplicate(id: string, other: string, expectedUpdatedAt: string, actor: string): Promise<WriteResult> {
    return this.closeAs('duplicate', id, other, expectedUpdatedAt, actor);
  }

  /**
   * `bd supersede` and `bd duplicate` close a bead, and (like `bd human`) not by the rules of `bd close`, so those are applied here
   * (`closeBlockers`): a bead that still waits on something is `blocked`, nothing written. The other bead must exist and not be this one.
   */
  private async closeAs(command: 'supersede' | 'duplicate', id: string, other: string, expectedUpdatedAt: string, actor: string): Promise<WriteResult> {
    checkId(id);
    checkId(other);
    if (other === id) throw invalid(command === 'supersede' ? "A bead can't replace itself." : "A bead can't be a duplicate of itself.");
    const overall = Date.now() + WRITE_BUDGET_MS;
    return withRootQueue(this.root, async () => {
      ensureCanStart(overall);
      const row = await this.readRowToWrite(id, overall);
      const current = row.bead;
      if (current.updatedAt !== expectedUpdatedAt) return { ok: false, conflict: true, current: await this.currentOf(row, overall) };
      if (current.status === CLOSED) throw invalid('That bead is already closed.');
      const rows = await this.readRows(overall);
      if (!rows.some((b) => b.id === other)) throw invalid(command === 'supersede' ? 'The bead to replace it with does not exist.' : 'The bead it duplicates does not exist.');
      const waitingOn = closeBlockers(rows, id);
      if (waitingOn.length > 0) throw closeBlocked('bead', rows, waitingOn);
      const flag = command === 'supersede' ? 'with' : 'of';
      return this.runSteps(id, [[command, '--json', `--${flag}=${other}`, '--', id]], actor, overall, { fields: ['status'], deps: [[id, other]] });
    });
  }

  /** `bd ready --explain`: one answer for the whole project (ready beads, and blocked ones with what they wait on), as printed. */
  readyExplain(): Promise<unknown> {
    return withRootQueue(this.root, () => runBdJson<unknown>(this.root, ['--readonly', 'ready', '--explain', '--json', '--limit', '0'], READ_OPTS));
  }

  /**
   * A close refused for a blocker: when what blocks it is a review gate, it is worded as a review, never by the gate's id (the raw
   * text stays in `detail`). A read that fails keeps the plain wording. Call inside the queue.
   */
  private async gateAwareBlocked(failure: WriteError, text: string, overall: number, partial: boolean): Promise<WriteError> {
    const ids = blockerIds(text);
    if (!ids) return failure;
    let gates: Set<string>;
    try {
      gates = new Set((await readExport(this.root, { deadlineAt: overall })).filter((b) => b.type === 'gate').map((b) => b.id));
    } catch {
      return failure;
    }
    if (!ids.some((id) => gates.has(id))) return failure;
    const saved = partial ? ' Part of your change was saved.' : '';
    if (ids.every((id) => gates.has(id))) return new WriteError('blocked', `This bead is waiting on a review. Resolve it first.${saved}`, failure.detail);
    const names = [...new Set(ids.map((id) => (gates.has(id) ? 'a review' : id)))];
    return new WriteError('blocked', `This bead can't be closed yet. It is still blocked by ${names.join(', ')}. Close those first.${saved}`, failure.detail);
  }

  /** A close refused for open children: `blocked`, naming the children when they can be read (bd does not name them). Call inside the queue. */
  private async openChildrenFailure(id: string, overall: number, partial: boolean, detail: string): Promise<WriteError> {
    let ids: string[] = [];
    try {
      ids = notClosedChildren(await readExport(this.root, { deadlineAt: overall }), id);
    } catch {
      // No names, still the right answer.
    }
    const which = ids.length > 0 ? ` has sub-tasks that are not closed yet: ${ids.join(', ')}.` : ' has sub-tasks that are not closed yet.';
    return new WriteError('blocked', `This bead can't be closed yet. It${which} Close those first.${partial ? ' Part of your change was saved.' : ''}`, detail);
  }

  /** A re-read that gives up quietly: null when there is no time, no answer, or no such bead. Call inside the queue. */
  private async readAgain(id: string, overall: number): Promise<Bead | null> {
    try {
      return await readBead(this.root, id, overall);
    } catch {
      return null;
    }
  }

  /**
   * Makes a bead and returns it as Beads lists it. Throws WriteError. A timeout is `uncertain` (it may exist, look before
   * trying again); a bead that was made but could not be read back is `uncertain` with `saved: true`.
   */
  async create(input: NewBead, actor: string): Promise<Bead> {
    checkTitle(input.title);
    checkPriority(input.priority);
    if (input.type.trim() === '') throw invalid('Pick a type.');
    if (input.parentId !== null) checkId(input.parentId);
    const overall = Date.now() + WRITE_BUDGET_MS;
    return withRootQueue(this.root, async () => {
      ensureCanStart(overall);
      // Beads refuses a positional title that starts with "-" even after `--`, so the title goes in as a flag.
      const args = [
        'create', '--json', `--title=${input.title.trim()}`, `--type=${input.type}`, `--priority=${input.priority}`,
        ...(input.parentId !== null ? [`--parent=${input.parentId}`] : []),
        ...(input.description !== '' ? [`--description=${input.description}`] : []),
      ];
      const created = await writeOne(this.root, actor, args, overall, null, 'bead');
      const id = typeof (created as { id?: unknown } | null)?.id === 'string' ? (created as { id: string }).id : '';
      if (id === '') throw new WriteError('uncertain', SAVED_UNREAD, `create did not print an id: ${JSON.stringify(created)}`, true);
      const noted = await notifyPanelWrite(this.root, id, { created: true });
      const bead = await this.readAgain(id, overall);
      if (bead === null) throw new WriteError('uncertain', SAVED_UNREAD, [`${id} was created but could not be read back`, noted].filter(Boolean).join('\n'), true);
      return bead;
    });
  }

  /** Adds a comment written by the panel's actor. Throws WriteError; a timeout is `uncertain` (it may have been added). */
  async comment(id: string, text: string, actor: string): Promise<Comment> {
    checkId(id);
    if (text.trim() === '') throw invalid('A comment cannot be empty.');
    const overall = Date.now() + WRITE_BUDGET_MS;
    return withRootQueue(this.root, async () => {
      ensureCanStart(overall);
      const added = await writeOne(this.root, actor, ['comments', 'add', '--json', `--author=${actor}`, '--', id, text], overall, { id, wrote: { comment: true } }, 'comment');
      const noted = await notifyPanelWrite(this.root, id, { comment: true });
      const [comment] = parseComments([added]);
      if (!comment) throw new WriteError('uncertain', SAVED_UNREAD, [`comments add printed: ${JSON.stringify(added)}`, noted].filter(Boolean).join('\n'), true);
      return comment;
    });
  }

  /**
   * Asks for a review of a bead: a human gate that blocks it. The bead must exist and not be closed (read from the export,
   * never `show`). When it already waits on a review of the same kind (a plan approval counts as its own kind) no second gate
   * is made and the answer is `already-open` with that gate. Throws WriteError; a timeout is `uncertain`.
   */
  async gateCreate(beadId: string, reason: string, actor: string): Promise<GateCreateResult> {
    checkId(beadId);
    const why = checkGateReason(reason);
    const planApproval = why.startsWith(PLAN_APPROVAL_REASON);
    const overall = Date.now() + WRITE_BUDGET_MS;
    return withRootQueue(this.root, async () => {
      ensureCanStart(overall);
      let before: Awaited<ReturnType<typeof readGates>>;
      try {
        before = await readGates(this.root, overall);
      } catch (error) {
        throw readFailure(error);
      }
      const target = before.beads.find((b) => b.id === beadId);
      if (!target) throw new WriteError('not-found', 'That bead no longer exists.');
      if (target.status === CLOSED) throw invalid("A closed bead can't be sent for review.");
      const open = before.gates.find((g) => g.kind === 'human' && g.planApproval === planApproval && g.blocks.includes(beadId));
      if (open) return { ok: false, code: 'already-open', gate: open };

      const created = await writeOne(this.root, actor, ['gate', 'create', '--type=human', `--blocks=${beadId}`, `--reason=${why}`, '--json'], overall, null, 'review request');
      const id = typeof (created as { id?: unknown } | null)?.id === 'string' ? (created as { id: string }).id : '';
      if (id === '') throw new WriteError('uncertain', SAVED_UNREAD, `gate create did not print an id: ${JSON.stringify(created)}`, true);
      const noted = await notifyPanelWrite(this.root, beadId, { deps: [[beadId, id]] });
      let gate: Gate | undefined;
      try {
        gate = (await readGates(this.root, overall)).gates.find((g) => g.id === id);
      } catch {
        gate = undefined;
      }
      if (!gate) throw new WriteError('uncertain', SAVED_UNREAD, [`${id} was created but could not be read back`, noted].filter(Boolean).join('\n'), true);
      return { ok: true, gate, ...(noted ? { detail: noted } : {}) };
    });
  }

  /**
   * Resolves a review gate (only `human` gates). Beads prints text and exits 0 even for a gate that is already closed, so the
   * gate is read first (a closed one is `already-resolved`, naming who from the audit log) and again afterwards: the result is
   * what the re-read shows, never what was printed. Throws WriteError; a timeout is `uncertain`.
   */
  async gateResolve(gateId: string, reason: string | undefined, actor: string): Promise<GateResolveResult> {
    checkId(gateId);
    const why = reason === undefined ? undefined : checkGateReason(reason);
    const overall = Date.now() + WRITE_BUDGET_MS;
    return withRootQueue(this.root, async () => {
      ensureCanStart(overall);
      let before: Awaited<ReturnType<typeof readGates>>;
      try {
        before = await readGates(this.root, overall);
      } catch (error) {
        throw readFailure(error);
      }
      const row = before.gateRows.find((g) => g.id === gateId);
      if (!row) throw new WriteError('not-found', 'That review no longer exists.');
      if (row.extra.await_type !== 'human') throw invalid(REVIEW_GATE_ONLY);
      if (row.status === CLOSED) {
        // Inside the queue: the audit read is a direct call, not a queued one.
        const events = await readAuditEvents(this.root, this.mode, { beadIds: [gateId], limit: 50 });
        const resolvedBy = events?.find((e) => e.type === 'closed')?.actor ?? null;
        return { ok: false, code: 'already-resolved', resolvedBy, at: row.closedAt };
      }

      const blocked = before.gates.find((g) => g.id === gateId)?.blocks ?? [];
      const owner = blocked[0] !== undefined ? { id: blocked[0], wrote: { deps: [[blocked[0], gateId]] as Array<[string, string]> } } : null;
      await writeOne(this.root, actor, ['gate', 'resolve', ...(why !== undefined ? [`--reason=${why}`] : []), '--', gateId], overall, owner, 'review', true);
      const problems: string[] = [];
      for (const beadId of blocked) {
        const noted = await notifyPanelWrite(this.root, beadId, { deps: [[beadId, gateId]] });
        if (noted) problems.push(noted);
      }
      let after: Gate[] | null;
      try {
        after = (await readGates(this.root, overall)).gates;
      } catch {
        after = null;
      }
      const detail = problems.length > 0 ? problems.join('\n') : undefined;
      if (after === null) throw new WriteError('uncertain', SAVED_UNREAD, ['the review was resolved but could not be read back', detail].filter(Boolean).join('\n'), true);
      if (after.some((g) => g.id === gateId)) throw new WriteError('failed', "The review couldn't be resolved.", 'gate resolve exited 0 but the gate is still open');
      return { ok: true, gateId, ...(detail ? { detail } : {}) };
    });
  }

  /**
   * Answers a help request (an open bead labelled `human`): the answer becomes a comment and the bead closes. The bead is read
   * first; one that is closed, or no longer has the label, is `not-open` with the bead as it is now, and nothing is written
   * (Beads would close it anyway, labelled or not), as does one in a done status. An open blocker (a review gate or an unfinished
   * task it waits on) refuses with `blocked` and writes nothing. Beads prints text, so the result is what the re-read shows: closed, with
   * the answer among the comments. Throws WriteError; a timeout is `uncertain`.
   */
  async humanRespond(id: string, response: string, actor: string): Promise<HumanResult> {
    checkId(id);
    const text = checkHumanResponse(response);
    return this.closeHumanRequest(id, ['human', 'respond', `--response=${text}`, '--', id], { comment: true, fields: ['status'] }, 'answer', actor, (after) => {
      if (!after.comments.some((c) => c.text === `Response: ${text}`)) return 'The request was closed, but the answer was not saved.';
      return after.closeReason === 'Responded' ? null : RECORDED_DIFFERENTLY;
    });
  }

  /** Closes a help request without an answer, with an optional one-line reason. Same rules as `humanRespond`. */
  async humanDismiss(id: string, reason: string | undefined, actor: string): Promise<HumanResult> {
    checkId(id);
    const why = reason === undefined || reason.trim() === '' ? undefined : checkGateReason(reason);
    return this.closeHumanRequest(id, ['human', 'dismiss', ...(why !== undefined ? [`--reason=${why}`] : []), '--', id], { fields: ['status'] }, 'dismissal', actor, (after) =>
      after.closeReason === (why !== undefined ? `Dismissed: ${why}` : 'Dismissed') ? null : why !== undefined ? REASON_NOT_SAVED : RECORDED_DIFFERENTLY,
    );
  }

  /** The shared path of respond and dismiss. `unkept` names what is missing from the re-read after a close, or null when all is there. */
  private async closeHumanRequest(id: string, command: string[], wrote: PanelWrite, what: string, actor: string, unkept: (after: Bead) => string | null): Promise<HumanResult> {
    const overall = Date.now() + WRITE_BUDGET_MS;
    return withRootQueue(this.root, async () => {
      ensureCanStart(overall);
      let row: { bead: Bead; commentCount: number } | null;
      try {
        row = await readBeadRow(this.root, id, overall);
      } catch (error) {
        throw readFailure(error);
      }
      if (row === null) throw new WriteError('not-found', 'That bead no longer exists.');
      const { done } = await readStatuses(this.root, overall);
      if (done.has(row.bead.status) || !row.bead.labels.includes(HUMAN_LABEL)) {
        try {
          return { ok: false, code: 'not-open', current: await withComments(this.root, row, overall) };
        } catch (error) {
          throw readFailure(error);
        }
      }
      // `bd human` closes a request even when something still blocks it, so the rule of a plain `bd close` is applied here
      // (its literal rules, see `closeBlockers`; the done set above is only for the request's own status). Nothing is written.
      let rows: Bead[];
      try {
        rows = await readExport(this.root, { deadlineAt: overall });
      } catch (error) {
        throw readFailure(error);
      }
      const waitingOn = closeBlockers(rows, id);
      if (waitingOn.length > 0) {
        throw new WriteError('blocked', `This request can't be closed yet. It is still waiting on ${waitingOn.join(', ')}.`, `blocked by open ${waitingOn.join(', ')}; nothing was sent to Beads`);
      }

      await writeOne(this.root, actor, command, overall, { id, wrote }, what, true);
      const noted = await notifyPanelWrite(this.root, id, wrote);
      const after = await this.readAgain(id, overall);
      if (after === null) throw new WriteError('uncertain', SAVED_UNREAD, [`the ${what} went in but the bead could not be read back`, noted].filter(Boolean).join('\n'), true);
      if (after.status !== CLOSED) throw new WriteError('failed', "The request couldn't be closed.", [`${command[1]} exited 0 but the bead is still ${after.status}`, noted].filter(Boolean).join('\n'));
      const missing = unkept(after);
      if (missing !== null) throw new WriteError('failed', missing, [`${command[1]} exited 0 but the re-read does not show the ${what}`, noted].filter(Boolean).join('\n'), true);
      return { ok: true, bead: after, ...(noted ? { detail: noted } : {}) };
    });
  }

  /**
   * `from` depends on `to`. Removing needs no kind: Beads keeps one dependency per ordered pair, so the pair names it
   * (`kind` is ignored then). Throws WriteError; a timeout is `uncertain`.
   */
  async dependency(op: 'add' | 'remove', from: string, to: string, kind: string, actor: string): Promise<void> {
    checkId(from);
    checkId(to);
    if (op === 'add' && !KIND_PATTERN.test(kind)) throw invalid('That is not a kind of link.');
    const overall = Date.now() + WRITE_BUDGET_MS;
    return withRootQueue(this.root, async () => {
      ensureCanStart(overall);
      const args = op === 'add' ? ['dep', 'add', '--json', `--type=${kind}`, '--', from, to] : ['dep', 'remove', '--json', '--', from, to];
      const wrote: PanelWrite = { deps: [[from, to]] };
      await writeOne(this.root, actor, args, overall, { id: from, wrote }, 'link');
      await notifyPanelWrite(this.root, from, wrote);
    });
  }
}
