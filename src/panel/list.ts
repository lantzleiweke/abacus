import type { Bead, StatusDef } from '../shared/types';
import type { Filters } from './store';

/**
 * How a status draws, following Linear's mapping by category: unstarted (`open`), started (`progress`), completed
 * (`done`), with blocked and deferred drawn apart. Statuses Beads does not describe get the neutral `other`.
 */
export type Look = 'open' | 'progress' | 'blocked' | 'deferred' | 'done' | 'other';

const BUILT_IN = new Map<string, Look>([
  ['open', 'open'],
  ['in_progress', 'progress'],
  ['blocked', 'blocked'],
  ['deferred', 'deferred'],
  ['closed', 'done'],
]);
const BY_CATEGORY = new Map<string, Look>([
  ['active', 'open'],
  ['wip', 'progress'],
  ['frozen', 'deferred'],
  ['done', 'done'],
]);

/** One of the five statuses with an icon of their own. */
export const isBuiltIn = (status: string): boolean => BUILT_IN.has(status);

/** Statuses Beads ships beyond the five, which get their own marker too. */
const BEADS_EXTRA = new Set(['pinned', 'hooked']);

/**
 * How a status icon is drawn: `builtin` for the five, `beads` (a square) for Beads' own extras such as pinned, and
 * `custom` (a diamond) for the project's statuses and unknown ones, each in its category's color.
 */
export type Marker = 'builtin' | 'beads' | 'custom';

export const markerOf = (status: string): Marker => (isBuiltIn(status) ? 'builtin' : BEADS_EXTRA.has(status) ? 'beads' : 'custom');

/** A status-to-look function for one project's statuses. */
export function looker(statuses: StatusDef[]): (status: string) => Look {
  const categories = new Map(statuses.map((s) => [s.name, s.category]));
  return (status) => BUILT_IN.get(status) ?? BY_CATEGORY.get(categories.get(status) ?? '') ?? 'other';
}

export const statusLook = (status: string, statuses: StatusDef[]): Look => looker(statuses)(status);

/** Statuses Beads ships, in plain words. */
const STATUS_WORDS = new Map([
  ['open', 'Open'],
  ['in_progress', 'In progress'],
  ['blocked', 'Blocked'],
  ['deferred', 'Deferred'],
  ['closed', 'Closed'],
  ['pinned', 'Pinned'],
  ['hooked', 'Hooked'],
]);

/** Short words people write in capitals. */
const ACRONYMS = new Set(['qa', 'ui', 'ux', 'pr', 'api', 'ci', 'cd', 'sla', 'mvp', 'uat']);

/** `in_review` is "In review", `qa_wait` is "QA wait". */
export function humanize(name: string): string {
  const words = name.split(/[_-]+/).filter(Boolean);
  if (words.length === 0) return name;
  return words
    .map((w, i) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : i === 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** A status in words: built-ins plainly, the project's custom statuses humanized, unknown ones as their raw name. */
export function statusLabel(status: string, statuses: StatusDef[]): string {
  const word = STATUS_WORDS.get(status);
  if (word) return word;
  return statuses.some((s) => s.name === status) ? humanize(status) : status;
}

/** The id without its project prefix: `demo-k3f2.4` is `k3f2.4`. */
export function shortId(id: string): string {
  const dot = id.indexOf('.');
  const base = dot < 0 ? id : id.slice(0, dot);
  const dash = base.lastIndexOf('-');
  return dash > 0 && dash < base.length - 1 ? id.slice(dash + 1) : id;
}

/** A descendant's id relative to its group's root (`.4.2`), or the short id when it was not named after the root. */
export const childId = (id: string, rootId: string): string => (id.startsWith(`${rootId}.`) ? id.slice(rootId.length) : shortId(id));

/** Hierarchical ids in reading order: `x.2` before `x.10`, a parent before its children. */
export function compareIds(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] === pb[i]) continue;
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    if (pa[i] !== '' && pb[i] !== '' && Number.isInteger(na) && Number.isInteger(nb)) return na - nb;
    return pa[i]! < pb[i]! ? -1 : 1;
  }
  return pa.length - pb.length;
}

const rank = (b: Bead) => b.priority ?? 5;
const byPriority = (a: Bead, b: Bead) => rank(a) - rank(b) || compareIds(a.id, b.id);

export const WEEK_MS = 7 * 86_400_000;

/** Closed (or last touched, when Beads kept no close time) within the past week of the panel clock. */
function recent(b: Bead, now: number): boolean {
  const at = Date.parse(b.closedAt ?? b.updatedAt);
  return Number.isFinite(at) && now - at <= WEEK_MS;
}

const closedAt = (b: Bead) => Date.parse(b.closedAt ?? b.updatedAt) || 0;
const byNewestClose = (a: Bead, b: Bead) => closedAt(b) - closedAt(a) || compareIds(a.id, b.id);

/** An open bead set aside until a date still to come (`defer_until`, kept in `extra`). */
function deferredUntilLater(b: Bead, now: number): boolean {
  const until = b.extra.defer_until;
  if (typeof until !== 'string') return false;
  const at = Date.parse(until);
  return Number.isFinite(at) && at > now;
}

/** The section a bead belongs to in the status view: a built-in section, or `other:<status>`. */
export type Bucket = 'in_progress' | 'blocked' | 'ready' | 'deferred' | 'closed' | `other:${string}`;

/** Built-in statuses with a section of their own (`open` splits into Ready, Blocked and Deferred). */
const OWN_SECTION = new Set(['in_progress', 'blocked', 'deferred', 'closed']);

export type Classified = {
  bucket: Bucket;
  look: Look;
  /** The status in words, saying when an open bead is waiting or set aside. */
  label: string;
  marker: Marker;
  /**
   * The status as filters see it: the raw status, except that an open bead counts as `blocked` when waiting and
   * `deferred` when set aside, so the Open, Blocked and Deferred filters match the sections.
   */
  filterAs: string;
};

/**
 * Where a bead stands, the same everywhere: blocked means status `blocked`, or `open` with something still in the way
 * (not ready, and not merely set aside until a later date); an open bead set aside until later counts as deferred.
 */
export function classifier({ statuses, readyIds, now }: { statuses: StatusDef[]; readyIds: string[]; now: number }): (b: Bead) => Classified {
  const look = looker(statuses);
  const ready = new Set(readyIds);
  return (b) => {
    if (b.status === 'open') {
      if (deferredUntilLater(b, now)) return { bucket: 'deferred', look: 'deferred', label: 'Deferred until later', marker: 'builtin', filterAs: 'deferred' };
      if (!ready.has(b.id)) return { bucket: 'blocked', look: 'blocked', label: 'Waiting on another bead', marker: 'builtin', filterAs: 'blocked' };
      return { bucket: 'ready', look: 'open', label: 'Open', marker: 'builtin', filterAs: 'open' };
    }
    const bucket: Bucket = OWN_SECTION.has(b.status) ? (b.status as Bucket) : `other:${b.status}`;
    return { bucket, look: look(b.status), label: statusLabel(b.status, statuses), marker: markerOf(b.status), filterAs: b.status };
  };
}

export type ListInput = {
  beads: Bead[];
  statuses: StatusDef[];
  readyIds: string[];
  unseenIds: string[];
  filters: Filters;
  query: string;
  /** Collapsed group keys (`epic:<id>`, `epic:none`, `status:<section>`). Ignored while searching. */
  collapsed: string[];
  /** Status sections showing all their rows instead of the first few. */
  expanded?: string[];
  /** Panel clock, for "closed in the last 7 days" and deferral dates. */
  now: number;
};

export type Sub = { done: number; total: number };

export type Row = {
  bead: Bead;
  /** The id as the row shows it. */
  id: string;
  depth: number;
  look: Look;
  /** The status in words, for the icon's tooltip and label. */
  label: string;
  marker: Marker;
  unseen: boolean;
  /** Shown only because something under it matches the filters or search. */
  context: boolean;
  /** The nearest epic above it (status view tag). */
  epic: Bead | null;
  /** Direct children done of total, or null without children. */
  sub: Sub | null;
};

type Prepared = {
  input: ListInput;
  classify: (b: Bead) => Classified;
  passes: (b: Bead) => boolean;
  unseen: Set<string>;
  searching: boolean;
  byId: Map<string, Bead>;
  /** Children by parent id, in id order. */
  kids: Map<string, Bead[]>;
};

/** Whether a bead not done is due before now (`overdue`) or in the next 7 days (`week`). A done bead or an unreadable date never is. */
function dueMatches(b: Bead, filter: 'overdue' | 'week', done: boolean, now: number): boolean {
  const due = typeof b.extra.due_at === 'string' ? Date.parse(b.extra.due_at) : NaN;
  if (done || !Number.isFinite(due)) return false;
  return filter === 'overdue' ? due < now : due >= now && due <= now + WEEK_MS;
}

function prepare(input: ListInput): Prepared {
  const classify = classifier(input);
  const ready = new Set(input.readyIds);
  const q = input.query.trim().toLowerCase();
  const { status, assignee, priorities } = input.filters;
  const passes = (b: Bead) => {
    if (status === 'open' ? classify(b).look === 'done' && !recent(b, input.now) : status !== 'all' && !status.only.includes(classify(b).filterAs)) return false;
    if (assignee === 'unassigned' ? !!b.assignee : assignee !== 'any' && b.assignee !== assignee.name) return false;
    if (priorities.length > 0 && (b.priority === null || !priorities.includes(b.priority))) return false;
    if (input.filters.ready && !ready.has(b.id)) return false;
    if (input.filters.due !== 'any' && !dueMatches(b, input.filters.due, classify(b).look === 'done', input.now)) return false;
    return q === '' || b.id.toLowerCase().includes(q) || b.title.toLowerCase().includes(q);
  };
  const byId = new Map(input.beads.map((b) => [b.id, b]));
  const kids = new Map<string, Bead[]>();
  for (const b of input.beads) {
    if (!b.parentId || b.parentId === b.id || !byId.has(b.parentId)) continue;
    const list = kids.get(b.parentId);
    if (list) list.push(b);
    else kids.set(b.parentId, [b]);
  }
  for (const list of kids.values()) list.sort((a, b) => compareIds(a.id, b.id));
  return { input, classify, passes, unseen: new Set(input.unseenIds), searching: q !== '', byId, kids };
}

/** The nearest epic above a bead, following parents. */
export function nearestEpic(b: Bead, byId: Map<string, Bead>): Bead | null {
  let parent = b.parentId ? byId.get(b.parentId) : undefined;
  for (let hops = 0; parent && hops < 64; hops++) {
    if (parent.type === 'epic') return parent;
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return null;
}

function row(p: Prepared, bead: Bead, id: string, depth: number, context: boolean): Row {
  const c = p.classify(bead);
  const children = p.kids.get(bead.id) ?? [];
  return {
    bead,
    id,
    depth,
    look: c.look,
    label: c.label,
    marker: c.marker,
    unseen: p.unseen.has(bead.id),
    context,
    epic: null,
    sub: children.length ? { done: children.filter((k) => p.classify(k).look === 'done').length, total: children.length } : null,
  };
}

// ------------------------------------------------------------------------------------------------- epic view

export type Progress = { total: number; done: number; inProgress: number; blocked: number };

export type EpicGroup = {
  key: string;
  /** Null for "Not in an epic". */
  epic: Bead | null;
  /** The epic's own status look (`open` for "Not in an epic"). */
  look: Look;
  /** The epic itself does not match; it heads the group because something under it does. */
  context: boolean;
  unseen: boolean;
  /** Over every descendant, whatever the filters hide. Null for "Not in an epic". */
  progress: Progress | null;
  /** Unseen beads under the epic (or in the group). */
  changed: number;
  /** Matching rows, counted before collapsing. */
  count: number;
  collapsed: boolean;
  rows: Row[];
};

/** Epics with their children nested by parent, then a trailing "Not in an epic" group. */
export function epicView(input: ListInput): EpicGroup[] {
  const p = prepare(input);
  const { kids } = p;
  const roots = input.beads.filter((b) => !b.parentId || b.parentId === b.id || !p.byId.has(b.parentId));

  const below = (id: string, seen = new Set<string>([id])): Bead[] => {
    const out: Bead[] = [];
    for (const child of kids.get(id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child, ...below(child.id, seen));
    }
    return out;
  };

  // A parent loop has no root: its beads join the orphans rather than vanish.
  const reached = new Set<string>();
  for (const r of roots) {
    reached.add(r.id);
    for (const d of below(r.id)) reached.add(d.id);
  }
  for (const b of input.beads) {
    if (reached.has(b.id)) continue;
    roots.push(b);
    reached.add(b.id);
    for (const d of below(b.id)) reached.add(d.id);
  }

  const subtree = (parent: Bead, depth: number, rootId: string, seen: Set<string>): Row[] => {
    const out: Row[] = [];
    for (const child of kids.get(parent.id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      const rows = subtree(child, depth + 1, rootId, seen);
      const ok = p.passes(child);
      if (ok || rows.length) out.push(row(p, child, childId(child.id, rootId), depth, !ok), ...rows);
    }
    return out;
  };

  const isCollapsed = (key: string) => !p.searching && input.collapsed.includes(key);
  const done = (b: Bead) => p.classify(b).look === 'done';
  const doneLast = (a: Bead, b: Bead) => Number(done(a)) - Number(done(b)) || byPriority(a, b);
  const groups: EpicGroup[] = [];

  for (const epic of roots.filter((b) => b.type === 'epic').sort(doneLast)) {
    const rows = subtree(epic, 1, epic.id, new Set([epic.id]));
    const ok = p.passes(epic);
    if (!ok && rows.length === 0) continue;
    const all = below(epic.id);
    const progress: Progress = { total: all.length, done: 0, inProgress: 0, blocked: 0 };
    for (const b of all) {
      const look = p.classify(b).look;
      if (look === 'done') progress.done++;
      else if (look === 'progress') progress.inProgress++;
      else if (look === 'blocked') progress.blocked++;
    }
    const key = `epic:${epic.id}`;
    const collapsed = isCollapsed(key);
    groups.push({
      key,
      epic,
      look: p.classify(epic).look,
      context: !ok,
      unseen: p.unseen.has(epic.id),
      progress,
      changed: all.filter((b) => p.unseen.has(b.id)).length,
      count: rows.filter((r) => !r.context).length,
      collapsed,
      rows: collapsed ? [] : rows,
    });
  }

  const orphanRows: Row[] = [];
  for (const root of roots.filter((b) => b.type !== 'epic').sort(doneLast)) {
    const rows = subtree(root, 1, root.id, new Set([root.id]));
    const ok = p.passes(root);
    if (ok || rows.length) orphanRows.push(row(p, root, shortId(root.id), 0, !ok), ...rows);
  }
  if (orphanRows.length > 0) {
    const collapsed = isCollapsed('epic:none');
    groups.push({
      key: 'epic:none',
      epic: null,
      look: 'open',
      context: false,
      unseen: false,
      progress: null,
      changed: orphanRows.filter((r) => r.unseen).length,
      count: orphanRows.filter((r) => !r.context).length,
      collapsed,
      rows: collapsed ? [] : orphanRows,
    });
  }
  return groups;
}

// ------------------------------------------------------------------------------------------------- status view

export type Section = {
  key: string;
  title: string;
  /** The raw status name, for the header's tooltip; set for custom and unknown statuses. */
  status: string | null;
  look: Look;
  marker: Marker;
  /** Matching rows, before collapsing or capping. */
  count: number;
  changed: number;
  collapsed: boolean;
  rows: Row[];
  /** Rows held back behind "Show N more". */
  more: number;
};

/** Long sections show their first SHOW rows until expanded. */
export const CAP = 8;
export const SHOW = 6;

const BUCKETS: Array<{ id: Bucket; title: string; look: Look }> = [
  { id: 'in_progress', title: 'In progress', look: 'progress' },
  { id: 'blocked', title: 'Blocked', look: 'blocked' },
  { id: 'ready', title: 'Ready', look: 'open' },
  { id: 'deferred', title: 'Deferred', look: 'deferred' },
  { id: 'closed', title: 'Closed', look: 'done' },
];

/** Custom statuses follow the built-in flow: started, then unstarted, then on ice, then done; unknown last. */
const CATEGORY_ORDER = ['wip', 'active', 'frozen', 'done'];

/**
 * Sections In progress, Blocked, Ready, Deferred, Closed (the last 7 days under the default filter), then one section
 * per other status, ordered by category. Empty sections are left out.
 */
export function statusView(input: ListInput): Section[] {
  const p = prepare(input);
  const limited = input.filters.status === 'open';
  const members = new Map<Bucket, Bead[]>();
  for (const b of input.beads) {
    if (!p.passes(b)) continue;
    const id = p.classify(b).bucket;
    const list = members.get(id);
    if (list) list.push(b);
    else members.set(id, [b]);
  }

  const order = new Map(input.statuses.map((s, i) => [s.name, i]));
  const categories = new Map(input.statuses.map((s) => [s.name, s.category]));
  const categoryRank = (name: string) => {
    const i = CATEGORY_ORDER.indexOf(categories.get(name) ?? '');
    return i < 0 ? CATEGORY_ORDER.length : i;
  };
  const custom = [...members.keys()]
    .filter((id) => id.startsWith('other:'))
    .map((id) => id.slice('other:'.length))
    .sort((a, b) => categoryRank(a) - categoryRank(b) || (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || (a < b ? -1 : 1));
  const look = looker(input.statuses);

  const defs: Array<{ id: Bucket; title: string; look: Look; status: string | null; marker: Marker }> = [
    ...BUCKETS.map((b) => ({ ...b, title: b.id === 'closed' && limited ? 'Closed (last 7 days)' : b.title, status: null, marker: 'builtin' as const })),
    ...custom.map((name) => {
      const l = look(name);
      const label = statusLabel(name, input.statuses);
      return { id: `other:${name}` as Bucket, title: l === 'done' && limited ? `${label} (last 7 days)` : label, look: l, status: name, marker: markerOf(name) };
    }),
  ];

  const sections: Section[] = [];
  for (const def of defs) {
    const beads = members.get(def.id);
    if (!beads) continue;
    beads.sort(def.look === 'done' ? byNewestClose : byPriority);
    const key = `status:${def.id}`;
    const collapsed = !p.searching && input.collapsed.includes(key);
    const capped = !p.searching && beads.length > CAP && !(input.expanded ?? []).includes(key);
    const shown = collapsed ? [] : capped ? beads.slice(0, SHOW) : beads;
    sections.push({
      key,
      title: def.title,
      status: def.status,
      look: def.look,
      marker: def.marker,
      count: beads.length,
      changed: beads.filter((b) => p.unseen.has(b.id)).length,
      collapsed,
      rows: shown.map((b) => ({ ...row(p, b, shortId(b.id), 0, false), epic: nearestEpic(b, p.byId) })),
      more: collapsed || !capped ? 0 : beads.length - SHOW,
    });
  }
  return sections;
}

// ------------------------------------------------------------------------------------------------- shared

/** Ids in the order j and k move through them: each epic, then its visible rows. */
export const rowOrder = (groups: Array<{ epic?: Bead | null; rows: Row[] }>): string[] =>
  groups.flatMap((g) => [...(g.epic ? [g.epic.id] : []), ...g.rows.map((r) => r.bead.id)]);

export type Totals = { open: number; inProgress: number; blocked: number; closedThisWeek: number };

/**
 * Project totals for the footer, over every bead whatever the filters. Open means not done; in progress and blocked
 * count exactly what the status view's In progress and Blocked sections hold; closed this week is every done bead
 * closed in the last 7 days.
 */
export function totals(input: Pick<ListInput, 'beads' | 'statuses' | 'readyIds' | 'now'>): Totals {
  const classify = classifier(input);
  const t: Totals = { open: 0, inProgress: 0, blocked: 0, closedThisWeek: 0 };
  for (const b of input.beads) {
    const c = classify(b);
    if (c.look === 'done') {
      if (recent(b, input.now)) t.closedThisWeek++;
      continue;
    }
    t.open++;
    if (c.bucket === 'in_progress') t.inProgress++;
    if (c.bucket === 'blocked') t.blocked++;
  }
  return t;
}

/** Whether any bead matches the search once the status filter allows everything (for "Only older closed beads match."). */
export function matchesWithAll(input: ListInput): boolean {
  const p = prepare({ ...input, filters: { ...input.filters, status: 'all' } });
  return input.beads.some(p.passes);
}
