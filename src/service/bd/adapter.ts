import { userInfo } from 'node:os';
import type { Bead, BeadPatch, Comment, ExpectedFields, NewBead, StatusDef, WriteResult } from '../../shared/types';
import { runSql, type AuditMode } from './audit';
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

export type WriteErrorCode = 'invalid' | 'not-found' | 'blocked' | 'dep-exists' | 'merge-conflict' | 'busy' | 'uncertain' | 'no-bd' | 'failed';

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

const SAVED_UNREAD = "Saved, but couldn't load the result. Refreshing.";
const BUSY_NOT_SAVED = 'Beads is busy. Nothing was saved. Try again in a moment.';

/** One write call (re-read, write commands, re-read) must finish inside this, under the host's 20 s RPC limit. */
const WRITE_BUDGET_MS = 18_000;
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

function checkPatch(patch: BeadPatch): void {
  if (patch.title !== undefined) checkTitle(patch.title);
  if (patch.priority !== undefined) checkPriority(patch.priority);
  if (patch.status !== undefined && patch.status.trim() === '') throw invalid('Pick a status.');
  // Beads reads a label flag as CSV, so a comma splits the label and a double quote starts a quoted field.
  for (const label of patch.labels ?? []) {
    if (label.trim() === '') throw invalid('A label cannot be empty.');
    if (/[\r\n]/.test(label)) throw invalid('A label cannot contain a line break.');
    if (label.includes(',') || label.includes('"')) throw invalid('A label cannot contain a comma or a double quote.');
  }
}

/** Plain-language errors for what bd is known to refuse. Anything else is "failed", with the raw text kept as detail. */
function writeFailure(error: unknown, partial = false): WriteError {
  const saved = partial ? ' Part of your change was saved.' : '';
  if (error instanceof WriteError) return error;
  if (!(error instanceof BdError)) return new WriteError('failed', `The change could not be saved.${saved}`, String(error));
  if (error.kind === 'not-found') return new WriteError('no-bd', 'Beads could not be found on this computer, so nothing was saved.', error.message);
  if (error.kind === 'lock') return new WriteError('busy', `Beads is busy.${partial ? saved : ' Nothing was saved.'} Try again in a moment.`, error.message);
  const text = `${error.message}\n${error.stderr}`;
  const blocked = /blocked by open issues\s*\[([^\]]*)\]/i.exec(text);
  if (blocked) {
    const ids = blocked[1]!.split(/[\s,]+/).filter((id) => id !== '');
    return new WriteError('blocked', `This bead can't be closed yet. It is still blocked by ${ids.join(', ')}. Close those first.${saved}`, text);
  }
  if (/no issue found matching|Error resolving/i.test(text)) {
    return new WriteError('not-found', `That bead no longer exists.${saved}`, text);
  }
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
function readFailure(error: unknown): WriteError {
  if (error instanceof BdError && (error.kind === 'timeout' || error.kind === 'lock')) {
    return new WriteError('busy', BUSY_NOT_SAVED, error.message);
  }
  return writeFailure(error);
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
function ensureCanStart(overall: number): void {
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

/** The fields a patch sets, named as change events name them (a move into or out of done is the `status` field). */
const patchFields = (patch: BeadPatch): string[] => Object.keys(patch).filter((key) => patch[key as keyof BeadPatch] !== undefined);

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
function runWrite(root: string, actor: string, args: string[], overall: number): Promise<unknown> {
  const deadlineAt = overall - WRITE_RESERVE_MS;
  if (deadlineAt - Date.now() < MIN_WRITE_MS) return Promise.reject(new NotStarted());
  return runBdJson<unknown>(root, ['--actor', actor, ...args], { retries: 0, deadlineAt });
}

/** A write of one thing (create, comment, link): a timeout is "may have saved", anything else is mapped. */
async function writeOne(root: string, actor: string, args: string[], overall: number, owner: { id: string; wrote: PanelWrite } | null, what: string): Promise<unknown> {
  try {
    return await runWrite(root, actor, args, overall);
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
    const now = current[key];
    if (key === 'title' ? String(value).trim() !== String(now).trim()
      : key === 'labels' ? !sameLabels(value as string[], now as string[])
      : key === 'assignee' ? ((value as string | null) || null) !== ((now as string | null) || null)
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
    return withRootQueue(this.root, async () => {
      const result = await runBd(this.root, ['--readonly', 'export'], READ_OPTS);
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
    });
  }

  statuses(): Promise<StatusDef[]> {
    return withRootQueue(this.root, async () => parseStatuses(await runBdJson<unknown>(this.root, ['--readonly', 'statuses', '--json'], READ_OPTS)));
  }

  types(): Promise<string[]> {
    return withRootQueue(this.root, async () => parseTypes(await runBdJson<unknown>(this.root, ['--readonly', 'types', '--json'], READ_OPTS)));
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
      // Comments are fetched only for a bead this call hands back (a conflict, or nothing to change); the write path re-reads it afterwards anyway.
      let row: { bead: Bead; commentCount: number } | null;
      try {
        row = await readBeadRow(this.root, id, overall);
      } catch (error) {
        throw readFailure(error);
      }
      if (row === null) throw new WriteError('not-found', 'That bead no longer exists.');
      const current = row.bead;
      const returnCurrent = async (): Promise<Bead> => {
        try {
          return await withComments(this.root, row, overall);
        } catch (error) {
          throw readFailure(error);
        }
      };
      // `updatedAt` is to the second: a change in the same second leaves it, so the shown values are checked too.
      if (current.updatedAt !== expectedUpdatedAt || !stillAsShown(expected, current)) return { ok: false, conflict: true, current: await returnCurrent() };

      // Not `this.statuses()`: that waits in this same queue.
      let done = new Set([CLOSED]);
      if (patch.status !== undefined && patch.status !== current.status) {
        try {
          const statuses = parseStatuses(await runBdJson<unknown>(this.root, ['--readonly', 'statuses', '--json'], { ...READ_OPTS, deadlineAt: overall }));
          if (statuses.length > 0 && !statuses.some((s) => s.name === patch.status)) throw invalid(`"${patch.status}" is not a status in this project.`);
          done = new Set([CLOSED, ...statuses.filter((s) => s.category === 'done').map((s) => s.name)]);
        } catch (error) {
          throw readFailure(error);
        }
      }

      const steps = planUpdate(id, current, patch, done);
      if (steps.length === 0) return { ok: true, bead: await returnCurrent() };

      let wrote = false;
      try {
        for (const step of steps) {
          await runWrite(this.root, actor, step, overall);
          wrote = true;
        }
      } catch (error) {
        const timedOut = error instanceof BdError && error.kind === 'timeout';
        // The change may have gone in even when Beads did not answer, so the next refresh still counts as the panel's.
        const noted = wrote || timedOut ? await notifyPanelWrite(this.root, id, { fields: patchFields(patch) }) : undefined;
        if (timedOut) {
          const detail = [noted, (error as BdError).message].filter(Boolean).join('\n');
          return { ok: false, uncertain: true, current: await this.readAgain(id, overall), detail };
        }
        const failure = error instanceof NotStarted ? notStartedError(wrote) : writeFailure(error, wrote);
        // An earlier step went in: `saved`, so the panel reads the bead again instead of showing it as it was.
        throw new WriteError(failure.code, failure.message, noted ? `${failure.detail}\n${noted}` : failure.detail, failure.saved || wrote);
      }
      const noted = await notifyPanelWrite(this.root, id, { fields: patchFields(patch) });
      const bead = await this.readAgain(id, overall);
      if (bead === null) return { ok: false, uncertain: true, current: null, saved: true, ...(noted ? { detail: noted } : {}) };
      return { ok: true, bead, ...(noted ? { detail: noted } : {}) };
    });
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
