import { join } from 'node:path';
import { readMetadata } from '../workspace';
import { BdError, runBd, runDolt, type RunOptions } from './exec';

export type AuditMode = 'embedded' | 'server';

/** One row of beads' `events` table. */
export type AuditEvent = {
  /** UUID string. UUIDv7 for events bd 1.2 wrote, UUIDv5 for imported ones and for every event bd 1.3 writes. */
  id: string;
  beadId: string;
  type: string;
  actor: string | null;
  /** Raw column. For `updated` and `status_changed` it is the whole previous issue as JSON. */
  oldValue: string | null;
  /** Raw column. For `updated` it is the changed fields as JSON; for `closed` the reason. */
  newValue: string | null;
  /** As bd stored it: real UTC from bd 1.3 on, but local time labeled as UTC (or with no zone) for a row bd 1.2.x wrote. Never read directly; see `eventTimeMs`. */
  rawCreatedAt: string;
  /** Set when this row's `created_at` is known to be real UTC (written by bd 1.3 on, after the 0062 migration; see `readUtcSince`), so `eventTimeMs` can date an event whose id carries no time. */
  utcCreatedAt?: true;
};

export type ReadAuditOptions = {
  /** 1 to AUDIT_LIMIT_MAX. A full page (`events.length === limit`) may mean older events were skipped. */
  limit: number;
  /** The store is bd 1.3 or later (`storeWritesUtc`): the events written since its 0062 migration come back marked as UTC, so they can be dated. */
  utcCreatedAt?: boolean;
  /** Only events of these beads (at most AUDIT_BEAD_IDS_MAX). Omit for the newest events across the project. */
  beadIds?: string[];
  /** Where to look for `bd` and `dolt`. For tests. */
  searchDirs?: string[];
};

export type SchemaOptions = { searchDirs?: string[] };

const REQUIRED_COLUMNS = ['issue_id', 'event_type', 'actor', 'old_value', 'new_value', 'created_at', 'id'] as const;
const EVENT_COLUMNS = 'id, issue_id, event_type, actor, old_value, new_value, created_at';
/** Most events one read returns. */
export const AUDIT_LIMIT_MAX = 1000;
/** Most beads one read can be scoped to. */
export const AUDIT_BEAD_IDS_MAX = 200;

const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/i;

// Only reads, only a single statement. `dolt sql` has no read-only switch, so this is the guard for embedded mode.
const READ_ONLY_SQL = /^(SELECT|DESCRIBE)\s[^;]*$/i;

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeDatabaseName(name: unknown): name is string {
  return typeof name === 'string' && SAFE_ID.test(name) && name !== '.' && name !== '..';
}

/** Server: `bd sql --json` prints an array of rows. Embedded: `dolt sql -r json` prints `{"rows": [...]}`. Both end up as rows. */
function rowsFrom(parsed: unknown): Row[] {
  // `bd sql --json` may print null, and `dolt sql -r json` prints `{}` (no `rows` key), for no rows.
  if (parsed === null || (isRow(parsed) && Object.keys(parsed).length === 0)) return [];
  const list = Array.isArray(parsed) ? parsed : isRow(parsed) && Array.isArray(parsed.rows) ? parsed.rows : null;
  if (!list) throw new BdError('parse', 'the database printed rows in a shape that was not expected');
  return list.filter(isRow);
}

function parseOutput(stdout: string): unknown {
  if (stdout.trim() === '') return [];
  try {
    return JSON.parse(stdout);
  } catch (cause) {
    throw new BdError('parse', `the database printed output that is not valid JSON: ${(cause as Error).message}`);
  }
}

/** Runs one read-only query. Throws BdError on any failure. */
export async function runSql(root: string, mode: AuditMode, query: string, searchDirs: string[] | undefined): Promise<Row[]> {
  if (!READ_ONLY_SQL.test(query)) throw new BdError('exit', 'refused: only a single SELECT or DESCRIBE is run');
  const run: RunOptions = { retries: 2, searchDirs };

  if (mode === 'server') {
    const result = await runBd(root, ['--readonly', 'sql', '--json', query], run);
    if (result.code !== 0) throw new BdError('exit', `bd sql failed with exit code ${result.code}`, { code: result.code, stderr: result.stderr });
    return rowsFrom(parseOutput(result.stdout));
  }

  // `bd sql` is not supported in embedded mode: read the database with dolt, from inside its folder.
  const database = (await readMetadata(root))?.dolt_database;
  if (!isSafeDatabaseName(database)) throw new BdError('exit', 'the project has no usable embedded database name');
  const cwd = join(root, '.beads', 'embeddeddolt', database);
  const result = await runDolt(cwd, ['sql', '-r', 'json', '-q', query], run);
  if (result.code !== 0) throw new BdError('exit', `dolt sql failed with exit code ${result.code}`, { code: result.code, stderr: result.stderr });
  return rowsFrom(parseOutput(result.stdout));
}

// Per root, for the process lifetime. Only a finished answer is kept: a lock or timeout must not pin the panel to "no history".
const schemaCache = new Map<string, Promise<boolean>>();

/** Forget cached schema answers. For tests. */
export function resetAuditSchemaCache(): void {
  schemaCache.clear();
  utcSinceCache.clear();
  seenVersion.clear();
}

async function describeEvents(root: string, mode: AuditMode, searchDirs: string[] | undefined): Promise<boolean> {
  const rows = await runSql(root, mode, 'DESCRIBE events', searchDirs);
  const fields = new Set(rows.map((row) => row.Field).filter((field): field is string => typeof field === 'string'));
  return REQUIRED_COLUMNS.every((column) => fields.has(column));
}

/**
 * True only when the `events` table has every column the reader needs (checked once per
 * root and kept for the process). A failed check is false and is tried again next time.
 */
export function checkAuditSchema(root: string, mode: AuditMode, opts: SchemaOptions = {}): Promise<boolean> {
  const cached = schemaCache.get(root);
  if (cached) return cached;
  // The cached promise never rejects: every caller sharing it gets `false` for a failed lookup.
  const check: Promise<boolean> = describeEvents(root, mode, opts.searchDirs).catch(() => {
    // Failures are not remembered.
    if (schemaCache.get(root) === check) schemaCache.delete(root);
    return false;
  });
  schemaCache.set(root, check);
  return check;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optStr(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function toEvent(row: Row, utcSince: number | null): AuditEvent | null {
  const id = str(row.id);
  const beadId = str(row.issue_id);
  const type = str(row.event_type);
  const rawCreatedAt = str(row.created_at);
  if (id === '' || beadId === '' || type === '' || rawCreatedAt === '') return null;
  return {
    id,
    beadId,
    type,
    actor: optStr(row.actor),
    oldValue: optStr(row.old_value),
    newValue: optStr(row.new_value),
    rawCreatedAt,
    ...(isUtcStamp(rawCreatedAt, utcSince) ? { utcCreatedAt: true as const } : {}),
  };
}

/** Null when any id is unsafe to put in SQL. */
function buildQuery(limit: number, beadIds: string[] | undefined): string | null {
  let where = '';
  if (beadIds) {
    if (!beadIds.every((id) => typeof id === 'string' && SAFE_ID.test(id))) return null;
    where = ` WHERE issue_id IN (${[...new Set(beadIds)].map((id) => `'${id}'`).join(', ')})`;
  }
  // Not `ORDER BY id`: imported events have UUIDv5 ids that sort after every UUIDv7 id.
  return `SELECT ${EVENT_COLUMNS} FROM events${where} ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
}

/**
 * Newest events first, at most `limit`, optionally only those of `beadIds`. A full page
 * (`length === limit`) may mean older events were skipped. Null when the table does not
 * have the expected columns, the limit is not an integer from 1 to AUDIT_LIMIT_MAX, there
 * are more than AUDIT_BEAD_IDS_MAX distinct ids or an unsafe bead id, or the query fails; never throws.
 * An empty `beadIds` list is an empty result without a query.
 */
export async function readAuditEvents(root: string, mode: AuditMode, opts: ReadAuditOptions): Promise<AuditEvent[] | null> {
  try {
    if (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > AUDIT_LIMIT_MAX) return null;
    if (opts.beadIds !== undefined) {
      // The cap counts distinct ids: the query lists each id once, so duplicates cost nothing.
      if (!Array.isArray(opts.beadIds) || new Set(opts.beadIds).size > AUDIT_BEAD_IDS_MAX) return null;
      if (opts.beadIds.length === 0) return [];
    }
    const query = buildQuery(opts.limit, opts.beadIds);
    if (query === null) return null;
    if (!(await checkAuditSchema(root, mode, { searchDirs: opts.searchDirs }))) return null;
    const utcSince = opts.utcCreatedAt === true ? await readUtcSince(root, mode, opts.searchDirs) : null;
    const rows = await runSql(root, mode, query, opts.searchDirs);
    return rows.map((row) => toEvent(row, utcSince)).filter((event): event is AuditEvent => event !== null);
  } catch {
    return null;
  }
}

/**
 * bd 1.3 writes `events.created_at` in real UTC; 1.2.x wrote local time labeled as UTC, and a store 1.2.x made keeps those rows
 * when 1.3 opens it. Only the 1.3 version says nothing about a row: `readUtcSince` says from when on the store writes UTC.
 */
export function storeWritesUtc(bdVersion: string): boolean {
  const match = /(\d+)\.(\d+)\.\d+/.exec(bdVersion);
  if (!match) return false;
  const major = Number(match[1]);
  return major > 1 || (major === 1 && Number(match[2]) >= 3);
}

/** More than this ahead of the clock cannot be a real event time: it is a local-time stamp that was read as UTC. */
const FUTURE_SLACK_MS = 5 * 60_000;
const CREATED_AT = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(?:Z)?$/;
/** `created_at` has whole seconds; the migration commit has milliseconds. An event in the migration's own second still counts as after it. */
const STAMP_SLACK_MS = 1000;
/**
 * The commit bd's 0062 migration (`events_dolt_ignore`) makes, dated in UTC by Dolt: a store bd 1.3 created has it from the start,
 * one bd 1.2.x made gets it when 1.3 first opens it. The newest one: a history merged from clones upgraded on different days holds
 * several, and this clone's own 1.2.x rows end at the last of them (`events` is local to each clone). A store whose history was
 * squashed (`bd flatten`, `bd compact`) has none.
 */
const MIGRATION_QUERY = "SELECT MAX(date) AS date FROM dolt_log WHERE message LIKE 'schema: apply migration 0062%'";

/** A stamp as written (`2026-10-14 08:31:03`, `...T...Z`, fraction allowed), taken at face value as UTC. Null when it is not one. */
function stampMs(text: string): number | null {
  const match = CREATED_AT.exec(text.trim());
  if (!match) return null;
  const ms = Date.parse(`${match[1]}T${match[2]}${match[3] ?? ''}Z`);
  return Number.isNaN(ms) ? null : ms;
}

// Per root: the answer, "not found" (null) included, so a store without the commit does not cost a query per read. It is dropped when
// the service sees a different bd version for the root (`noteBdVersion`) and when the service restarts. A failed read is not kept.
const utcSinceCache = new Map<string, number | null>();
const seenVersion = new Map<string, string>();

/** Tells the audit reader which bd version a root runs under; a change (an upgrade, a downgrade) drops what it knows of the root's migration date. */
export function noteBdVersion(root: string, bdVersion: string): void {
  if (seenVersion.get(root) === bdVersion) return;
  seenVersion.set(root, bdVersion);
  utcSinceCache.delete(root);
}

/**
 * When bd 1.3 began writing `events.created_at` in real UTC in this store: the date of its last 0062 migration commit (see
 * `MIGRATION_QUERY`). A stamp from then on is UTC, with two known exceptions: a 1.2.x row written east of UTC within its offset
 * before the migration, and a 1.2.x writer that keeps writing after it (another clone on the old version). Older stamps are 1.2.x
 * local time with no zone to say which. Null when the commit is not there (a flattened store) or cannot be read: no stamp can then
 * be trusted, and every non-v7 event stays untimed rather than wrong.
 */
export async function readUtcSince(root: string, mode: AuditMode, searchDirs?: string[]): Promise<number | null> {
  if (utcSinceCache.has(root)) return utcSinceCache.get(root)!;
  try {
    const rows = await runSql(root, mode, MIGRATION_QUERY, searchDirs);
    const ms = stampMs(str(rows[0]?.date));
    utcSinceCache.set(root, ms);
    return ms;
  } catch {
    return null;
  }
}

/** True when `rawCreatedAt` was written by a store that writes UTC: it is not before the store's migration (`readUtcSince`). */
export function isUtcStamp(rawCreatedAt: string, utcSince: number | null): boolean {
  if (utcSince === null) return false;
  const ms = stampMs(rawCreatedAt);
  return ms !== null && ms >= utcSince - STAMP_SLACK_MS;
}

/**
 * Real UTC time of the event in ms; the one place `events.created_at` becomes a time. A UUIDv7 id carries it (first 12 hex
 * digits). Otherwise, when the row is marked UTC (`utcCreatedAt`: written after the store's migration), `created_at` is it, unless
 * that lies in the future. Anything else (1.2.x local time, or a store not known) is null: no time beats a time hours off.
 */
export function eventTimeMs(event: Pick<AuditEvent, 'id' | 'rawCreatedAt' | 'utcCreatedAt'>): number | null {
  if (UUID_V7.test(event.id)) return parseInt(event.id.replace(/-/g, '').slice(0, 12), 16);
  if (event.utcCreatedAt !== true) return null;
  const ms = stampMs(event.rawCreatedAt);
  return ms === null || ms > Date.now() + FUTURE_SLACK_MS ? null : ms;
}
