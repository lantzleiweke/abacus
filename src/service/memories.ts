import { createHash } from 'node:crypto';
import type { ForgetRequest, Memory, MemoriesResult, MemoryWriteResult, RememberRequest } from '../shared/api';
import { ensureCanStart, readFailure, SAVED_UNREAD, WRITE_BUDGET_MS, WriteError, withRootQueue, writeOne } from './bd/adapter';
import { runSql, type AuditMode } from './bd/audit';
import { runBdJson } from './bd/exec';

// Project memories (`bd remember`): text that Beads hands to every agent session in the project, so a wrong write is costly.
// Nothing is cut, guessed or overwritten: a memory is changed or forgotten only when the text on disk is still the text the person saw.

/** Longest memory text. Longer is rejected, never cut. */
export const MEMORY_TEXT_MAX = 4000;
/** What a new key looks like. A memory Beads already holds under another spelling can still be edited or forgotten. */
const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const GENERATED_KEY_MAX = 60;
/** The metadata field every `--json` answer carries; a memory under this name would collide with it. */
const RESERVED_KEY = 'schema_version';
const READ_OPTS = { retries: 2 } as const;
/** The part of a stored memory key that is the person's key. */
const CONFIG_PREFIX = 'kv.memory.';
/** Most change rows read. The newest row per key is the last change; a key older than all of them just has no date. */
const HISTORY_ROWS = 2000;

// The last change per key and who made it. One read: `dolt_diff_config` has one row per change to a config value (a history table has
// one per commit per key), joined to the commit message, which names the actor (`bd: remember|forget (auto-commit) by <actor>`).
const CHANGES_QUERY =
  `SELECT d.to_key, d.diff_type, d.to_commit_date, l.message FROM dolt_diff_config d LEFT JOIN dolt_log l ON l.commit_hash = d.to_commit ` +
  `WHERE d.to_key LIKE '${CONFIG_PREFIX}%' ORDER BY d.to_commit_date DESC LIMIT ${HISTORY_ROWS}`;
const COMMIT_MESSAGE = /^bd: (?:remember|forget) \(auto-commit\) by (.+)$/;

type Stored = Map<string, string>;
type Change = { changedAt: string; changedBy: string | null };

const invalid = (message: string): WriteError => new WriteError('invalid', message);

/** Dolt prints commit dates in UTC without a zone (`2026-10-15 09:30:40.568000`); a zone, when there is one, is kept. */
function isoOf(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const text = value.trim().replace(' ', 'T');
  const ms = Date.parse(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(text) ? text : `${text}Z`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** `bd memories --json` as a map of key to text: `schema_version` dropped, anything that is not text skipped. */
function storedFrom(raw: unknown): Stored {
  const stored: Stored = new Map();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return stored;
  for (const [key, value] of Object.entries(raw)) {
    if (key !== RESERVED_KEY && typeof value === 'string') stored.set(key, value);
  }
  return stored;
}

async function readStored(root: string, deadlineAt?: number): Promise<Stored> {
  return storedFrom(await runBdJson<unknown>(root, ['--readonly', 'memories', '--json'], deadlineAt === undefined ? READ_OPTS : { ...READ_OPTS, deadlineAt }));
}

/** The newest change per key. A failed read is no dates, never a failed list. */
async function readChanges(root: string, mode: AuditMode): Promise<Map<string, Change>> {
  const changes = new Map<string, Change>();
  try {
    for (const row of await runSql(root, mode, CHANGES_QUERY, undefined)) {
      const toKey = row.to_key;
      if (typeof toKey !== 'string' || !toKey.startsWith(CONFIG_PREFIX)) continue;
      const key = toKey.slice(CONFIG_PREFIX.length);
      const changedAt = isoOf(row.to_commit_date);
      // Newest first: the first row for a key is its last change.
      if (changedAt === null || changes.has(key)) continue;
      const message = typeof row.message === 'string' ? COMMIT_MESSAGE.exec(row.message.trim()) : null;
      changes.set(key, { changedAt, changedBy: message?.[1]?.trim() || null });
    }
  } catch {
    return new Map();
  }
  return changes;
}

const memoryOf = (key: string, text: string, change?: Change): Memory => ({ key, text, changedAt: change?.changedAt ?? null, changedBy: change?.changedBy ?? null });

/** A string that differs whenever any key or text does. */
function fingerprintOf(stored: Stored): string {
  const hash = createHash('sha256');
  for (const [key, text] of [...stored].sort(([a], [b]) => (a < b ? -1 : 1))) hash.update(`${key.length}:${key}${text.length}:${text}`);
  return hash.digest('hex').slice(0, 16);
}

/** Every memory, newest change first (a key with no known change last, alphabetically), filtered by `query` in its key or text. */
export function listMemories(root: string, mode: AuditMode, query?: string): Promise<MemoriesResult> {
  return withRootQueue(root, async () => {
    const stored = await readStored(root);
    // Inside the queue: the SQL read is a direct call, not a queued one.
    const changes = await readChanges(root, mode);
    const needle = query?.trim().toLowerCase() ?? '';
    const memories = [...stored]
      .filter(([key, text]) => needle === '' || key.toLowerCase().includes(needle) || text.toLowerCase().includes(needle))
      .map(([key, text]) => memoryOf(key, text, changes.get(key)))
      .sort((a, b) => {
        if (a.changedAt !== b.changedAt) return a.changedAt === null ? 1 : b.changedAt === null ? -1 : a.changedAt < b.changedAt ? 1 : -1;
        return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      });
    return { memories, fingerprint: fingerprintOf(stored) };
  });
}

/** A key from the text: lowercase words joined by `-`, at most 60 characters, `-2`, `-3` when taken. */
export function generateKey(text: string, taken: ReadonlySet<string>): string {
  const words = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const base = words.slice(0, GENERATED_KEY_MAX).replace(/-+$/, '') || 'memory';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const key = `${base}-${n}`;
    if (!taken.has(key)) return key;
  }
}

function checkText(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') throw invalid('A memory needs some text.');
  if (trimmed.length > MEMORY_TEXT_MAX) throw invalid(`A memory is at most ${MEMORY_TEXT_MAX.toLocaleString('en-US')} characters. Shorten it; nothing was saved.`);
  return trimmed;
}

function checkNewKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed === RESERVED_KEY) throw invalid(`"${RESERVED_KEY}" is a name Beads keeps for itself. Pick another name.`);
  if (!KEY_PATTERN.test(trimmed)) throw invalid('A name is lowercase letters, digits, dots, dashes and underscores, up to 80 characters, starting with a letter or digit.');
  return trimmed;
}

/** Reading before a write: nothing was changed, so a lock or timeout says nothing was saved. */
async function readBefore(root: string, deadlineAt: number): Promise<Stored> {
  try {
    return await readStored(root, deadlineAt);
  } catch (error) {
    throw readFailure(error);
  }
}

/** Reading after a write: the change is in; only the check failed. */
async function readAfter(root: string, deadlineAt: number, what: string): Promise<Stored> {
  try {
    return await readStored(root, deadlineAt);
  } catch (error) {
    throw new WriteError('uncertain', SAVED_UNREAD, `${what} went in but the memories could not be read back: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

/**
 * Saves a memory. No `expectedText`: a new memory (the key is given, or made from the text), refused with `changed` when the key is
 * taken. With `expectedText`: an edit of `key`, refused with `changed` unless the stored text is still `expectedText`. Throws WriteError.
 * `--key` is always passed: without it Beads recalls instead of storing when the text equals an existing key.
 */
export async function rememberMemory(root: string, request: Pick<RememberRequest, 'text' | 'key' | 'expectedText'>, actor: string): Promise<MemoryWriteResult> {
  const text = checkText(request.text);
  const editing = request.expectedText !== undefined;
  if (editing && (request.key === undefined || request.key.trim() === '')) throw invalid('Say which memory to change.');
  if (editing && request.key!.trim() === RESERVED_KEY) throw invalid(`"${RESERVED_KEY}" is a name Beads keeps for itself.`);
  const given = !editing && request.key !== undefined ? checkNewKey(request.key) : null;
  const overall = Date.now() + WRITE_BUDGET_MS;
  return withRootQueue(root, async () => {
    ensureCanStart(overall);
    const before = await readBefore(root, overall);
    // Beads would recall the memory named like this text instead of storing anything. Even with a key it is not a memory worth keeping.
    if (before.has(text)) throw invalid('That text is the name of another memory. Reword it so it reads as an instruction.');
    const key = editing ? request.key!.trim() : (given ?? generateKey(text, new Set(before.keys())));
    const stored = before.get(key);
    if (editing) {
      if (stored === undefined) return { ok: false, code: 'changed', current: null };
      if (stored !== request.expectedText) return { ok: false, code: 'changed', current: memoryOf(key, stored) };
      if (stored === text) return { ok: true, memory: memoryOf(key, stored) };
    } else if (stored !== undefined) {
      return { ok: false, code: 'changed', current: memoryOf(key, stored) };
    }

    const answer = await writeOne(root, actor, ['remember', '--json', '--key', key, '--', text], overall, null, 'memory');
    const action = typeof answer === 'object' && answer !== null ? (answer as { action?: unknown }).action : undefined;
    if (action === 'recalled') throw new WriteError('failed', 'Beads did not save that', `bd remember answered "recalled" for key ${key}: ${JSON.stringify(answer)}`);
    const after = await readAfter(root, overall, 'the memory');
    if (after.get(key) !== text) throw new WriteError('failed', 'Beads did not save that', `bd remember exited 0 (${JSON.stringify(answer)}) but ${key} reads back as ${JSON.stringify(after.get(key) ?? null)}`);
    return { ok: true, memory: memoryOf(key, text, { changedAt: new Date().toISOString(), changedBy: actor }) };
  });
}

/** Forgets a memory, only when its stored text is still `expectedText`; one already gone is `changed` with no current text. Throws WriteError. */
export async function forgetMemory(root: string, request: Pick<ForgetRequest, 'key' | 'expectedText'>, actor: string): Promise<MemoryWriteResult> {
  const key = request.key.trim();
  if (key === '' || key === RESERVED_KEY) throw invalid('Say which memory to forget.');
  const overall = Date.now() + WRITE_BUDGET_MS;
  return withRootQueue(root, async () => {
    ensureCanStart(overall);
    const stored = (await readBefore(root, overall)).get(key);
    if (stored === undefined) return { ok: false, code: 'changed', current: null };
    if (stored !== request.expectedText) return { ok: false, code: 'changed', current: memoryOf(key, stored) };

    const answer = await writeOne(root, actor, ['forget', '--json', '--', key], overall, null, 'change');
    const deleted = typeof answer === 'object' && answer !== null ? (answer as { deleted?: unknown }).deleted : undefined;
    if (deleted !== 'true' && deleted !== true) throw new WriteError('failed', 'Beads did not forget that', `bd forget answered ${JSON.stringify(answer)}`);
    const after = await readAfter(root, overall, 'the forget');
    if (after.has(key)) throw new WriteError('failed', 'Beads did not forget that', `bd forget exited 0 but ${key} is still stored`);
    return { ok: true, memory: null };
  });
}
