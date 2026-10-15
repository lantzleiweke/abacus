import type { Bead, Comment, Dependency, JsonValue, StatusDef } from '../../shared/types';

type Obj = Record<string, unknown>;

/** Fields copied into named Bead fields. Everything else populated lands in `extra`. */
const MAPPED_KEYS = new Set([
  'id', 'title', 'status', 'priority', 'issue_type', 'assignee', 'labels', 'parent',
  'description', 'design', 'acceptance_criteria', 'notes',
  'created_at', 'created_by', 'updated_at', 'closed_at', 'close_reason',
  'dependencies', 'comments',
]);

/** Fields that carry no information for the "More" block. */
const BOOKKEEPING_KEYS = new Set([
  '_type', 'schema_version', 'comment_count', 'dependency_count', 'dependent_count',
]);

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Empty or missing strings become null. */
function optStr(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return isObj(value) && Object.keys(value).length === 0;
}

function parseDependency(raw: unknown, ownerId: string): Dependency | null {
  if (!isObj(raw)) return null;
  const to = str(raw.depends_on_id);
  if (to === '') return null;
  return {
    from: optStr(raw.issue_id) ?? ownerId,
    to,
    kind: str(raw.type),
    createdBy: optStr(raw.created_by),
    createdAt: optStr(raw.created_at),
  };
}

function parseComment(raw: unknown): Comment | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || raw.id === '') return null;
  return {
    id: raw.id,
    author: optStr(raw.author),
    text: str(raw.text),
    createdAt: str(raw.created_at),
  };
}

function mapArray<T>(value: unknown, map: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(map).filter((item): item is T => item !== null);
}

/**
 * A bead's parent. `bd list --id` provides a `parent` field. `bd export` does not: there the
 * parent is the target of a `parent-child` dependency owned by the child (`issue_id` is the
 * child, `depends_on_id` the parent), as in the committed server fixtures.
 */
function parentOf(row: Obj, id: string, dependencies: Dependency[]): string | null {
  const direct = optStr(row.parent);
  if (direct !== null) return direct;
  return dependencies.find((dep) => dep.kind === 'parent-child' && dep.from === id)?.to ?? null;
}

/** One issue object (export line, list row, ready row) to a Bead, or null when it has no id. */
function parseIssue(row: unknown): Bead | null {
  if (!isObj(row) || typeof row.id !== 'string' || row.id === '') return null;
  const id = row.id;
  const dependencies = mapArray(row.dependencies, (dep) => parseDependency(dep, id));
  const extra: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(row)) {
    if (MAPPED_KEYS.has(key) || BOOKKEEPING_KEYS.has(key) || isEmpty(value)) continue;
    extra[key] = value as JsonValue;
  }
  return {
    id,
    title: str(row.title),
    status: str(row.status),
    priority: typeof row.priority === 'number' && Number.isInteger(row.priority) && row.priority >= 0 && row.priority <= 4
      ? row.priority
      : null,
    type: str(row.issue_type),
    assignee: optStr(row.assignee),
    labels: Array.isArray(row.labels) ? row.labels.filter((label): label is string => typeof label === 'string') : [],
    parentId: parentOf(row, id, dependencies),
    description: str(row.description),
    design: str(row.design),
    acceptance: str(row.acceptance_criteria),
    notes: str(row.notes),
    createdAt: str(row.created_at),
    createdBy: optStr(row.created_by),
    updatedAt: str(row.updated_at),
    closedAt: optStr(row.closed_at),
    closeReason: optStr(row.close_reason),
    dependencies,
    // bd omits `comments` when the bead has none; only `comment_count` remains.
    comments: mapArray(row.comments, parseComment),
    extra,
  };
}

/**
 * Parses `bd export` JSONL. A line that is not JSON, not an issue object, or has no id is
 * skipped and counted. Lines with a `_type` other than "issue" are ignored without counting.
 */
export function parseExportWithWarnings(jsonl: string): { beads: Bead[]; skipped: number; firstSkipped: string | null } {
  const beads: Bead[] = [];
  let skipped = 0;
  let firstSkipped: string | null = null;
  const skip = (line: string) => {
    skipped += 1;
    firstSkipped ??= line;
  };
  for (const line of jsonl.split('\n')) {
    if (line.trim() === '') continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      skip(line);
      continue;
    }
    if (isObj(row) && typeof row._type === 'string' && row._type !== 'issue') continue;
    const bead = parseIssue(row);
    if (bead) beads.push(bead);
    else skip(line);
  }
  return { beads, skipped, firstSkipped };
}

export function parseExport(jsonl: string): Bead[] {
  return parseExportWithWarnings(jsonl).beads;
}

/** `bd list --json` and `bd list --all --id <id> --json`: an array of issues. */
export function parseList(json: unknown): Bead[] {
  return mapArray(json, parseIssue);
}

/** `bd comments <id> --json`. */
export function parseComments(json: unknown): Comment[] {
  return mapArray(json, parseComment);
}

/** `bd statuses --json`: built-ins first, then custom statuses (which have no icon). */
export function parseStatuses(json: unknown): StatusDef[] {
  if (!isObj(json)) return [];
  const toDef = (raw: unknown): StatusDef | null => {
    if (!isObj(raw) || typeof raw.name !== 'string' || raw.name === '') return null;
    return { name: raw.name, category: str(raw.category), icon: optStr(raw.icon) };
  };
  return [...mapArray(json.built_in_statuses, toDef), ...mapArray(json.custom_statuses, toDef)];
}

/** `bd types --json`: core type names, then custom types (plain strings). */
export function parseTypes(json: unknown): string[] {
  if (!isObj(json)) return [];
  const core = mapArray(json.core_types, (raw) => (isObj(raw) && typeof raw.name === 'string' && raw.name !== '' ? raw.name : null));
  const custom = mapArray(json.custom_types, (raw) => (typeof raw === 'string' && raw !== '' ? raw : null));
  return [...core, ...custom];
}

/** `bd ready --json`: ids only. */
export function parseReady(json: unknown): string[] {
  return mapArray(json, (raw) => (isObj(raw) && typeof raw.id === 'string' && raw.id !== '' ? raw.id : null));
}
