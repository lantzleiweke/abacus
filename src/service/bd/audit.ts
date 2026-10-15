import { join } from 'node:path';
import { readMetadata } from '../workspace';
import { BdError, runBd, runDolt, type RunOptions } from './exec';

export type AuditMode = 'embedded' | 'server';

/** One row of beads' `events` table. */
export type AuditEvent = {
  /** UUID string. UUIDv7 for events bd 1.x wrote, UUIDv5 for imported ones. */
  id: string;
  beadId: string;
  type: string;
  actor: string | null;
  /** Raw column. For `updated` and `status_changed` it is the whole previous issue as JSON. */
  oldValue: string | null;
  /** Raw column. For `updated` it is the changed fields as JSON; for `closed` the reason. */
  newValue: string | null;
  /** As bd stored it. Local time labeled as UTC (or no zone), so never trusted for ordering across machines; see `eventTimeMs`. */
  rawCreatedAt: string;
};

export type ReadAuditOptions = {
  /** 1 to AUDIT_LIMIT_MAX. A full page (`events.length === limit`) may mean older events were skipped. */
  limit: number;
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

function toEvent(row: Row): AuditEvent | null {
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
    const rows = await runSql(root, mode, query, opts.searchDirs);
    return rows.map(toEvent).filter((event): event is AuditEvent => event !== null);
  } catch {
    return null;
  }
}

/** Real UTC time of the event in ms. Only UUIDv7 ids carry it (first 12 hex digits); anything else is null. */
export function eventTimeMs(event: AuditEvent): number | null {
  if (!UUID_V7.test(event.id)) return null;
  return parseInt(event.id.replace(/-/g, '').slice(0, 12), 16);
}
