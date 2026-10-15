import type { Bead, ConflictInfo, JsonValue, Related, SyncState } from '../shared/types';
import { runGit } from './bd/exec';

// What the panel attaches to a chat: one bead (same shape as OpenChamber's Linear issue context) or a sync problem.
// OpenChamber limits an attachment's text to 16,000 characters, so everything here is cut down to fit, never past it.

const CAP = 16_000;
const MARK = ' [truncated]';
/** A long text field is cut to this much (plus the marker) before anything more important is touched. */
const FIELD_FLOOR = 500;
const TITLE_MAX = 200;
const RULES_MAX = 4_000;
const TRIMMED_LOG = '[earlier output trimmed]\n';

const ISSUE_PREFIX = 'Beads issue context (JSON)\n';
const CONFLICT_PREFIX = 'Beads sync needs attention (JSON)\n';

/** Largest n in [0, max] with `ok(n)`, assuming `ok` only gets harder as n grows. 0 when nothing fits. */
function largest(max: number, ok: (n: number) => boolean): number {
  let lo = 0;
  let hi = max;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ok(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The first `keep` characters of `text`, never ending inside a surrogate pair. */
function plainSlice(text: string, keep: number): string {
  let end = Math.min(keep, text.length);
  if (end > 0 && end < text.length) {
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  }
  return text.slice(0, end);
}

/** The first `keep` characters of `text`, then the marker. */
function cutStart(text: string, keep: number): string {
  return plainSlice(text, keep) + MARK;
}

/** `text` cut to `keep` characters and marked, but never marked when empty or when the cut would not make it shorter. */
function cutField(text: string, keep: number): string {
  if (keep <= 0) return '';
  if (keep + MARK.length >= text.length) return text;
  return cutStart(text, keep);
}

const clampText = (text: string): string => cutField(text, FIELD_FLOOR);

const clampTitle = (title: string): string => (title.length > TITLE_MAX ? `${plainSlice(title, TITLE_MAX - 1)}…` : title);

/** Long strings cut to the floor; anything else that serializes longer than the floor becomes a cut string of its JSON. */
function clampValue(value: JsonValue): JsonValue {
  if (typeof value === 'string') return clampText(value);
  if (value === null || typeof value !== 'object') return value;
  const json = JSON.stringify(value);
  return json.length > FIELD_FLOOR ? cutStart(json, FIELD_FLOOR) : value;
}

/** `clampValue` on each value of an object (one level), or on the value itself when it is not an object. */
function clampFields(value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return clampValue(value);
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, clampValue(inner)]));
}

/** The last `keep` characters of `text`, never starting inside a surrogate pair. */
function cutEnd(text: string, keep: number): string {
  let start = Math.max(0, text.length - keep);
  if (start > 0 && start < text.length) {
    const code = text.charCodeAt(start);
    if (code >= 0xdc00 && code <= 0xdfff) start += 1;
  }
  return text.slice(start);
}

// ---------------------------------------------------------------------------------------------------------------------
// Related beads

export { relatedFor } from '../shared/related';

// ---------------------------------------------------------------------------------------------------------------------
// Bead URL

type RemoteLocation = { host: string; hostname: string; segments: string[] };

const SEGMENT = /^[A-Za-z0-9._~-]+$/;

/** Understands https, `ssh://` and the scp-like `git@host:owner/repo` forms. Credentials and ports of ssh are dropped. */
function parseRemote(remote: string): RemoteLocation | null {
  const text = remote.trim();
  let host: string;
  let hostname: string;
  let path: string;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text)) {
    const url = new URL(text);
    if (!['http:', 'https:', 'ssh:', 'git:'].includes(url.protocol)) return null;
    hostname = url.hostname.toLowerCase();
    host = url.protocol === 'http:' || url.protocol === 'https:' ? url.host.toLowerCase() : hostname;
    path = url.pathname;
  } else {
    const match = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(text);
    if (!match) return null;
    hostname = match[1]!.toLowerCase();
    host = hostname;
    path = match[2]!;
  }
  const segments = path.split('/').filter((segment) => segment !== '');
  if (segments.length < 2 || !segments.every((segment) => SEGMENT.test(segment))) return null;
  const last = segments[segments.length - 1]!;
  if (last.endsWith('.git')) segments[segments.length - 1] = last.slice(0, -'.git'.length);
  if (segments.some((segment) => segment === '')) return null;
  return { host, hostname, segments };
}

/** Where a chip's browser link goes when the project has no web page. Says the bead is local and how to open it in Abacus. */
export const NO_WEB_PAGE_URL = 'https://github.com/lantzleiweke/abacus/blob/main/docs/user-guide.md#beads-with-no-web-page';

const isForgeHost = (hostname: string): boolean => hostname === 'github.com' || hostname === 'gitlab.com' || hostname.includes('gitlab');

/**
 * The address OpenChamber links a bead to. An http(s) URL is required, and a project is not always on the web: a GitHub or
 * GitLab `origin` gives `<repo page>?bead=<id>`. Anything else gives the user guide's section on beads with no web page,
 * because OpenChamber always shows an "Open in the browser" link on the chip and a made-up address would go nowhere.
 * Never throws.
 */
export async function beadUrl(root: string, _projectName: string, id: string): Promise<string> {
  const fallback = NO_WEB_PAGE_URL;
  try {
    const result = await runGit(root, ['remote', 'get-url', 'origin']);
    if (result.code !== 0) return fallback;
    const location = parseRemote(result.stdout);
    if (!location || !isForgeHost(location.hostname)) return fallback;
    return `https://${location.host}/${location.segments.join('/')}?bead=${encodeURIComponent(id)}`;
  } catch {
    return fallback;
  }
}


// ---------------------------------------------------------------------------------------------------------------------
// Bead context

type Ref = { id: string; title: string; status: string };
type DepRef = { kind: string; direction: 'out' | 'in'; id: string; title: string | null; status: string | null };
type CommentOut = { author: string | null; createdAt: string; text: string };

const refOf = (bead: Bead): Ref => ({ id: bead.id, title: bead.title, status: bead.status });

/** What the budget can change. Everything else in the issue is fixed. */
type Draft = {
  title: string;
  labels: string[];
  labelsOmitted: number;
  children: Ref[];
  childrenOmitted: number;
  dependencies: DepRef[];
  dependenciesOmitted: number;
  description: string;
  acceptance: string;
  design: string;
  notes: string;
  closeReason: string | null;
  extra: Record<string, JsonValue>;
  extraOmitted: number;
  comments: CommentOut[];
};

type TextField = 'description' | 'design' | 'notes';
/** The brief's order: description is cut first. */
const TEXT_FIELDS: TextField[] = ['description', 'design', 'notes'];
/** While the text fields are cut below their floor, acceptance is held to this much, then grown back with what is left. */
const ACCEPTANCE_RESERVE = 2_000;

const omittedKey = (count: number, key: string): Record<string, number> => (count > 0 ? { [key]: count } : {});

/**
 * The text and chip title to attach for one bead. The text is always a complete JSON document of at most 16,000 characters.
 * Over the cap, in this order (each step only as far as needed, and only if the text still does not fit):
 *  1. `extra` values and `closeReason` are cut to 500 characters;
 *  2. children and dependencies are listed in part (a count of the rest is added), sized so the essentials still fit;
 *  3. the oldest comments are dropped;
 *  4. description, design and notes are cut, each to 500 characters at the least;
 *  5. extra entries (the clamped ones) and then labels are dropped, with acceptance whole: it outranks them. Only if that is
 *     not enough is acceptance held to 2,000 characters while the three text fields go below their floor and an enormous
 *     title is cut; acceptance then grows back as far as it fits, so it is cut only when that is the only way to fit;
 *  6. if nothing makes it fit (an enormous status or type), a small document with just the identity of the bead is sent.
 * An empty field is never marked as truncated.
 */
export function buildContext(bead: Bead, related: Related, stale?: { readAt: string | null }): { text: string; title: string } {
  /** Said first, when the latest read failed: the bead is as last read, at `readAt`. */
  const staleKeys: Record<string, JsonValue> = stale ? { stale: true, readAt: stale.readAt } : {};
  const children = related.children.map(refOf);
  const dependencies: DepRef[] = related.deps.map(({ dep, other, direction }) => ({
    kind: dep.kind,
    direction,
    id: direction === 'out' ? dep.to : dep.from,
    title: other?.title ?? null,
    status: other?.status ?? null,
  }));
  const comments: CommentOut[] = bead.comments
    .map((comment, index) => ({ comment, index }))
    .sort((a, b) => (a.comment.createdAt < b.comment.createdAt ? -1 : a.comment.createdAt > b.comment.createdAt ? 1 : a.index - b.index))
    .map(({ comment }) => ({ author: comment.author, createdAt: comment.createdAt, text: comment.text }));

  const d: Draft = {
    title: bead.title,
    labels: bead.labels,
    labelsOmitted: 0,
    children,
    childrenOmitted: 0,
    dependencies,
    dependenciesOmitted: 0,
    description: bead.description,
    acceptance: bead.acceptance,
    design: bead.design,
    notes: bead.notes,
    closeReason: bead.closeReason,
    extra: bead.extra,
    extraOmitted: 0,
    comments,
  };

  const issueOf = (): Record<string, JsonValue> => ({
    id: bead.id,
    title: d.title,
    type: bead.type,
    status: bead.status,
    priority: bead.priority,
    assignee: bead.assignee,
    labels: d.labels,
    ...omittedKey(d.labelsOmitted, 'labelsOmitted'),
    parent: related.parent ? refOf(related.parent) : null,
    children: d.children,
    ...omittedKey(d.childrenOmitted, 'childrenOmitted'),
    dependencies: d.dependencies,
    ...omittedKey(d.dependenciesOmitted, 'dependenciesOmitted'),
    description: d.description,
    acceptance: d.acceptance,
    design: d.design,
    notes: d.notes,
    createdAt: bead.createdAt,
    createdBy: bead.createdBy,
    updatedAt: bead.updatedAt,
    closedAt: bead.closedAt,
    closeReason: d.closeReason,
    extra: d.extra,
    ...omittedKey(d.extraOmitted, 'extraOmitted'),
  });
  const render = (): string => ISSUE_PREFIX + JSON.stringify({ ...staleKeys, issue: issueOf(), comments: d.comments }, null, 2);
  const fits = (): boolean => render().length <= CAP;

  const setComments = (n: number): void => {
    d.comments = comments.slice(comments.length - n);
  };
  const setRelations = (n: number): void => {
    d.children = children.slice(0, n);
    d.childrenOmitted = children.length - d.children.length;
    d.dependencies = dependencies.slice(0, n);
    d.dependenciesOmitted = dependencies.length - d.dependencies.length;
  };
  const setField = (field: TextField, n: number): void => {
    d[field] = cutField(bead[field], n);
  };
  const setAcceptance = (n: number): void => {
    d.acceptance = cutField(bead.acceptance, n);
  };

  // 1. Agent-written extras.
  if (!fits()) {
    d.closeReason = bead.closeReason === null ? null : clampText(bead.closeReason);
    d.extra = clampFields(bead.extra) as Record<string, JsonValue>;
  }

  // 2. Links, sized with no comments and the text fields at their floor, so a long list never crowds out what matters more.
  if (!fits()) {
    d.comments = [];
    for (const field of TEXT_FIELDS) d[field] = clampText(bead[field]);
    const n = largest(Math.max(children.length, dependencies.length), (count) => {
      setRelations(count);
      return fits();
    });
    setRelations(n);
    for (const field of TEXT_FIELDS) d[field] = bead[field];
    d.comments = comments;
  }

  // 3. Comments, oldest first out.
  if (!fits()) {
    const n = largest(comments.length, (count) => {
      setComments(count);
      return fits();
    });
    setComments(n);
  }

  // 4. Long text, as little as needed, each to its floor at the least.
  for (const field of TEXT_FIELDS) {
    if (fits()) break;
    const full = bead[field];
    if (full.length <= FIELD_FLOOR + MARK.length) continue;
    const extra = largest(full.length - MARK.length - 1 - FIELD_FLOOR, (more) => {
      setField(field, FIELD_FLOOR + more);
      return fits();
    });
    setField(field, FIELD_FLOOR + extra);
  }

  // 5. Everything left that can give, in this order: extras and labels go first, with acceptance whole (it outranks them); then the
  // text fields drop below their floor and the title is cut, with acceptance held to a reserve; then acceptance grows back into what is free.
  if (!fits()) {
    // Extras and labels go first, with acceptance whole: it outranks them. Entries come from the clamped extras of step 1.
    const entries = Object.entries(d.extra);
    if (entries.length > 0) {
      const keep = largest(entries.length, (n) => {
        d.extra = Object.fromEntries(entries.slice(0, n));
        d.extraOmitted = entries.length - n;
        return fits();
      });
      d.extra = Object.fromEntries(entries.slice(0, keep));
      d.extraOmitted = entries.length - keep;
    }
    if (!fits() && bead.labels.length > 0) {
      const keep = largest(bead.labels.length, (n) => {
        d.labels = bead.labels.slice(0, n);
        d.labelsOmitted = bead.labels.length - n;
        return fits();
      });
      d.labels = bead.labels.slice(0, keep);
      d.labelsOmitted = bead.labels.length - keep;
    }
  }
  if (!fits()) {
    // Only now is acceptance in play: held to the reserve while the text fields go below their floor and the title is cut.
    setAcceptance(ACCEPTANCE_RESERVE);
    for (const field of TEXT_FIELDS) {
      if (fits()) break;
      if (d[field] === '') continue;
      const keep = largest(FIELD_FLOOR, (n) => {
        setField(field, n);
        return fits();
      });
      setField(field, keep);
    }
    if (!fits()) d.title = clampTitle(bead.title);
    const keep = largest(bead.acceptance.length, (n) => {
      setAcceptance(n);
      return fits();
    });
    setAcceptance(keep);
  }

  const title = clampTitle(bead.title);
  if (fits()) return { text: render(), title };

  // 6. Nothing fit (an enormous status, type or assignee): the bead's identity only, still a complete document.
  const minimal = {
    ...staleKeys,
    issue: { id: plainSlice(bead.id, 128), title, status: plainSlice(bead.status, 100), priority: bead.priority, contextTruncated: true },
    comments: [],
  };
  return { text: ISSUE_PREFIX + JSON.stringify(minimal, null, 2), title };
}

// ---------------------------------------------------------------------------------------------------------------------
// Sync conflict context

/** Where the last `$ bd` command block of a job log starts (the log's length when it has none). */
function lastCommandStart(log: string): number {
  let at = -1;
  for (const match of log.matchAll(/^\$ bd /gm)) at = match.index;
  return at < 0 ? log.length : at;
}

type ConflictBead = { id: string; title: string | null; ours: JsonValue; theirs: JsonValue };

/**
 * The text to attach so the agent can sort out a sync that stopped. `log` is the sync job's own log, which already prints each
 * command shell-quoted. The text is always a complete JSON document of at most 16,000 characters. Over the cap, in this order:
 * long values inside each side of a bead are cut to 500 characters; the log loses its start, down to its last `$ bd` command;
 * beads go from the end (with a count); then the rules, then that last command's start.
 */
export function buildConflictContext(directory: string, state: Extract<SyncState, { kind: 'conflict' | 'error' | 'paused-upgrade' }>, rules: string | null): string {
  const source = state.kind === 'conflict' ? state.beads : [];
  const whole = (info: ConflictInfo): ConflictBead => ({ id: info.beadId, title: info.title, ours: info.ours, theirs: info.theirs });
  const clamped = (info: ConflictInfo): ConflictBead => ({ id: info.beadId, title: info.title === null ? null : clampText(info.title), ours: clampFields(info.ours), theirs: clampFields(info.theirs) });

  let beads = source.map(whole);
  let omitted = 0;
  let log = state.log;
  let projectRules = rules !== null && rules.length > RULES_MAX ? cutStart(rules, RULES_MAX) : rules;

  const render = (): string => {
    const payload: Record<string, JsonValue> = { project: directory };
    if (state.kind === 'conflict') payload.mode = state.mode;
    payload.problem = state.kind;
    if (state.kind === 'conflict') payload.halfMerged = state.halfMerged;
    else payload.message = state.message;
    payload.beads = beads;
    if (omitted > 0) payload.beadsOmitted = omitted;
    payload.log = log;
    payload.projectRules = projectRules;
    return CONFLICT_PREFIX + JSON.stringify(payload, null, 2);
  };
  const fits = (): boolean => render().length <= CAP;

  const full = state.log;
  const setLog = (n: number): void => {
    log = n <= 0 ? '' : n >= full.length ? full : TRIMMED_LOG + cutEnd(full, n);
  };
  const setBeads = (n: number): void => {
    beads = source.slice(0, n).map(clamped);
    omitted = source.length - n;
  };

  if (!fits()) beads = source.map(clamped);

  if (!fits()) {
    const floor = full.length - lastCommandStart(full);
    const more = largest(full.length - floor, (extra) => {
      setLog(floor + extra);
      return fits();
    });
    setLog(floor + more);
  }

  if (!fits()) {
    const keep = largest(source.length, (n) => {
      setBeads(n);
      return fits();
    });
    setBeads(keep);
  }

  if (!fits() && rules !== null) {
    const base = projectRules ?? '';
    const keep = largest(base.length, (n) => {
      projectRules = cutField(base, n);
      return fits();
    });
    projectRules = cutField(base, keep);
  }

  if (!fits()) {
    const keep = largest(full.length, (n) => {
      setLog(n);
      return fits();
    });
    setLog(keep);
  }

  return render();
}
