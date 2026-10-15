import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import { GUEST_BADGE_MAX, type HostClient } from '@openchamber/sdk';
import type { BeadResponse } from '../shared/api';
import type { Bead, BeadPatch, ChangeEvent, Comment, ExpectedFields, JsonValue, NewBead, SnapshotResponse, SyncState, WorkspaceState } from '../shared/types';
import { relatedFor } from '../shared/related';
import { ANSWER_LOST, asRequestError, COPY_MAX, TOAST_MAX, type BeadsClient } from './client';
import { beadSignature, latestUnseenChange, newerBead } from './detail';
import { defaultParent } from './edit';
import { shortId } from './list';

export type View = 'epic' | 'status' | 'activity';
const VIEWS: readonly View[] = ['epic', 'status', 'activity'];

/**
 * `open` (the default, "Current"): everything not done, plus beads closed in the last 7 days. `all`: everything, however
 * long ago it closed. `only`: exactly these statuses.
 */
export type StatusFilter = 'open' | 'all' | { only: string[] };
export type AssigneeFilter = 'any' | 'unassigned' | { name: string };
export type Filters = { status: StatusFilter; assignee: AssigneeFilter; priorities: number[]; ready: boolean };

export const DEFAULT_FILTERS: Filters = { status: 'open', assignee: 'any', priorities: [], ready: false };

/** Deferred and Closed start folded away, as in the approved mockup. */
export const DEFAULT_COLLAPSED: readonly string[] = ['status:deferred', 'status:closed'];

export const filtersActive = (f: Filters): boolean => f.status !== 'open' || f.assignee !== 'any' || f.priorities.length > 0 || f.ready;

export type FullSnapshot = Extract<SnapshotResponse, { unchanged: false }>;

/** A failure as the UI shows it: plain `message`, raw `detail` only for "Copy details". */
export type PanelError = { code: string; message: string; detail?: string };

/** One bead in the detail's history: its id, and the unseen change it had when opened (kept for this visit). */
export type DetailEntry = { id: string; change: ChangeEvent | null };

/**
 * The open detail. `stack` is the path through relationships (the last entry shows; Back pops). `data` is the bead as
 * last read for the shown entry; until it arrives the list's copy shows. `error` is why the last read failed.
 */
export type DetailState = { stack: DetailEntry[]; data: BeadResponse | null; loading: boolean; error: PanelError | null };

/** The "New bead" form is open, starting with this parent. */
export type CreateState = { parentId: string | null };

/**
 * How a write ended. `conflict`: the bead changed since it was shown and nothing was written; `current` is it now.
 * `uncertain`: it may or may not be in (`saved`: it is, only reading it back failed); the panel is refreshing and never
 * sends it again by itself. `dropped`: the project changed while it ran, so nothing here is about the shown project.
 */
export type WriteOutcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'conflict'; current: Bead }
  | { kind: 'uncertain'; current: Bead | null; saved: boolean }
  | { kind: 'error'; error: PanelError }
  | { kind: 'dropped' };

/**
 * Unsaved text, kept in the store so it outlives the part of the screen that holds it (the detail goes away while the
 * project cannot be used, for example). A text editor's also keeps what it started from: the text and the bead's time.
 */
export type Draft = { text: string; original?: string; base?: string };

export type LinkChange = { op: 'add'; from: string; to: string; kind: string } | { op: 'remove'; from: string; to: string };

export type State = {
  directory: string | null;
  /** Bumped on every directory change; answers started under an older generation are dropped. */
  generation: number;
  /** Null until the first answer for this directory. */
  workspace: WorkspaceState | null;
  /** The last full answer, with freshness and sync from later `unchanged` answers merged in. */
  snapshot: FullSnapshot | null;
  view: View;
  filters: Filters;
  /** Collapsed group keys, for example `epic:<id>` or `status:closed`. */
  collapsed: string[];
  /** Search text; kept for the session, not persisted. */
  query: string;
  /** The list row last opened; it stays selected after Back. */
  selectedId: string | null;
  /** The bead detail shown in place of the list, or null for the list. */
  detail: DetailState | null;
  /** The last poll failed with this (cleared by the next success). */
  error: PanelError | null;
  /**
   * Panel clock (ms) when the panel last started watching this directory: opened, or shown again after being hidden.
   * The freshness age never counts from before this, so a panel shown after a long time hidden does not flash stale.
   */
  watchedSince: number;
  /** First-contact consent in flight, and why it failed. */
  confirming: boolean;
  confirmError: PanelError | null;
  /** The "New bead" form, when open. */
  create: CreateState | null;
  /**
   * What covers the panel now, by name: `create`, `worktree` and `publish` sheets, the `leave` confirmation. While any is
   * open the list and activity keys rest and what is behind it is inert.
   */
  overlays: string[];
};

/**
 * `isVisible`: the panel can be seen. `isDocumentHidden`: the whole window is hidden (minimized, another tab); then
 * nothing polls. A panel that is merely closed in the rail keeps a slow poll so the badge can still rise.
 */
export type Visibility = { isVisible(): boolean; isDocumentHidden?(): boolean; onChange(listener: () => void): () => void };

export type StoreDeps = {
  client: BeadsClient;
  host: Pick<HostClient, 'storage' | 'toast' | 'setBadge' | 'writeClipboard' | 'openUrl'>;
  visibility?: Visibility;
  now?: () => number;
};

export type Store = {
  get(): State;
  subscribe(listener: () => void): () => void;
  setDirectory(directory: string | null): void;
  /** Poll now, asking the service to detect the workspace again. */
  retry(): void;
  confirmFirstContact(): Promise<void>;
  setView(view: View): void;
  setFilters(filters: Filters): void;
  toggleCollapsed(key: string): void;
  setQuery(query: string): void;
  /** Selects a list row and opens its detail; null clears both. */
  select(id: string | null): void;
  /** Opens another bead's detail on top of the current one (Back returns). */
  openRelated(id: string): void;
  /** Leaves the shown detail: to the previous bead, or to the list with the row still selected. */
  back(): void;
  /** Reads the shown bead again. */
  reloadDetail(): void;
  /** Hides the shown bead's change banner. */
  dismissChange(): void;
  /** Marks every change seen ("Mark all seen"); says so in a toast when the service refuses, and the highlights stay. */
  markAllSeen(): Promise<void>;
  /** Opens an http(s) or mailto link outside the panel. */
  openUrl(url: string): void;
  /** Shows `message` in a toast whose Copy action copies `detail`. */
  copyDetails(error: PanelError): void;
  /** Copies text (a bead id or a `/bd` command) to the clipboard, or offers it in a toast with Copy when the clipboard refuses. */
  copyText(text: string): void;
  /**
   * Changes a bead if it is still as it was at `expectedUpdatedAt`. What Beads answers shows at once (the list catches
   * up on its own poll, which this starts).
   */
  update(id: string, expectedUpdatedAt: string, patch: BeadPatch, expected?: ExpectedFields): Promise<WriteOutcome<Bead>>;
  /** Makes a bead and opens it. */
  create(input: NewBead): Promise<WriteOutcome<Bead>>;
  comment(id: string, text: string): Promise<WriteOutcome<Comment>>;
  /** Adds or removes a link (`from` depends on `to`). */
  link(change: LinkChange): Promise<WriteOutcome<null>>;
  /** A short success note in OpenChamber's toasts. */
  notify(message: string): void;
  /** The list's keyboard cursor (the row it is on, or null), for where a new bead goes. */
  setListCursor(id: string | null): void;
  /**
   * Opens the "New bead" form, its parent defaulting to the epic in view: the bead shown (or its epic), else in Epic view
   * the epic under the list's cursor (or the cursor row's epic); none otherwise.
   */
  openCreate(): void;
  closeCreate(): void;
  /**
   * While set, leaving the shown bead (Back, opening another, opening a new one) asks it first; it calls `go` to leave.
   * The detail sets it while a draft is unsaved.
   */
  setLeaveGuard(guard: ((go: () => void, stay?: () => void) => void) | null): void;
  /** Notes an overlay as open or closed (see `State.overlays`). */
  setOverlay(name: string, open: boolean): void;
  /** Runs `go` once the shown bead's unsaved drafts may go: at once when there are none, else when the person agrees. */
  confirmLeave(go: () => void): void;
  /** The shown project's draft for a bead's field (`comment` for the comment box), or null. */
  draft(id: string, field: string): Draft | null;
  /** Keeps a draft, or with null lets it go. */
  setDraft(id: string, field: string, draft: Draft | null): void;
  /** Lets go of every draft of a bead in the shown project. */
  dropDrafts(id: string): void;
  /**
   * A sync job was asked for: shows the state the service answered at once (null when the answer was lost) and reads
   * the project again. Polls already on their way are dropped, so none from before the job can paint over it.
   */
  syncStarted(sync: SyncState | null): void;
  dispose(): void;
};

export const POLL_MS = 2_000;
export const MAX_BACKOFF_MS = 30_000;
/** Poll interval while the panel is closed in the rail but the window is up: enough to keep the badge honest. */
export const HIDDEN_POLL_MS = 60_000;

/** FNV-1a, 32 bits, from a given seed. */
function fnv(text: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Storage key for a project's UI state. Storage is per extension, not per project, so the key carries a digest of the directory. */
export const uiKey = (directory: string): string => `ui:${fnv(directory, 0x811c9dc5)}${fnv(directory, 0x01000193)}`;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

function readFilters(value: unknown): Filters {
  if (!isObject(value)) return DEFAULT_FILTERS;
  const { status, assignee, priorities, ready } = value;
  return {
    status: status === 'open' || status === 'all' ? status : isObject(status) && isStrings(status.only) ? { only: status.only } : 'open',
    assignee: assignee === 'any' || assignee === 'unassigned' ? assignee : isObject(assignee) && typeof assignee.name === 'string' ? { name: assignee.name } : 'any',
    priorities: Array.isArray(priorities) ? priorities.filter((p): p is number => Number.isInteger(p) && p >= 0 && p <= 4) : [],
    ready: ready === true,
  };
}

/** Stored UI state, or the defaults for anything missing or not understood. */
function readUi(value: unknown): Pick<State, 'view' | 'filters' | 'collapsed'> {
  const v = isObject(value) ? value : {};
  return {
    view: VIEWS.includes(v.view as View) ? (v.view as View) : 'epic',
    filters: readFilters(v.filters),
    collapsed: isStrings(v.collapsed) ? v.collapsed : [...DEFAULT_COLLAPSED],
  };
}

/** The parts of `window` that say whether the panel can be seen. */
export type VisibilityWindow = Pick<Window, 'innerWidth' | 'innerHeight' | 'addEventListener' | 'removeEventListener'> & {
  document: Pick<Document, 'visibilityState' | 'documentElement' | 'addEventListener' | 'removeEventListener'>;
  IntersectionObserver?: typeof IntersectionObserver;
};

/**
 * Whether the panel can be seen. OpenChamber hides an inactive rail pane with `display: none`, which does not fire
 * `visibilitychange`; the frame then has a zero-size viewport (a `resize`) and its root stops intersecting. All three count.
 */
export function pageVisibility(win: VisibilityWindow): Visibility {
  let intersecting = true;
  return {
    isVisible: () => win.document.visibilityState !== 'hidden' && win.innerWidth > 0 && win.innerHeight > 0 && intersecting,
    isDocumentHidden: () => win.document.visibilityState === 'hidden',
    onChange(listener) {
      win.document.addEventListener('visibilitychange', listener);
      win.addEventListener('resize', listener);
      let observer: IntersectionObserver | null = null;
      if (win.IntersectionObserver) {
        observer = new win.IntersectionObserver((entries) => {
          const last = entries[entries.length - 1];
          if (!last) return;
          intersecting = last.isIntersecting;
          listener();
        });
        observer.observe(win.document.documentElement);
      }
      return () => {
        win.document.removeEventListener('visibilitychange', listener);
        win.removeEventListener('resize', listener);
        observer?.disconnect();
      };
    },
  };
}

const alwaysVisible: Visibility = { isVisible: () => true, onChange: () => () => {} };
const defaultVisibility = (): Visibility => (typeof window === 'undefined' ? alwaysVisible : pageVisibility(window));

function toPanelError(error: unknown): PanelError {
  const e = asRequestError(error);
  return e.detail ? { code: e.code, message: e.message, detail: e.detail } : { code: e.code, message: e.message };
}

export function createStore({ client, host, visibility = defaultVisibility(), now = Date.now }: StoreDeps): Store {
  let state: State = {
    directory: null,
    generation: 0,
    workspace: null,
    snapshot: null,
    view: 'epic',
    filters: DEFAULT_FILTERS,
    collapsed: [...DEFAULT_COLLAPSED],
    query: '',
    selectedId: null,
    detail: null,
    error: null,
    watchedSince: now(),
    confirming: false,
    confirmError: null,
    create: null,
    overlays: [],
  };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Each poll gets a number; only the newest one's answer is applied. */
  let latest = 0;
  let failures = 0;
  /** The user changed UI state before the stored state for this directory loaded: keep theirs. */
  let touched = false;
  let disposed = false;
  /** The newest poll has not answered yet. A Retry may still overtake it; becoming visible does not. */
  let inFlight = false;
  let wasVisible = visibility.isVisible();
  /** The rail badge as last sent; undefined until the first send. */
  let badge: number | null | undefined;
  /** Each detail read gets a number; only the newest one's answer is applied. */
  let detailSeq = 0;
  /** The shown bead as the list had it when its last read began; a different one in a later answer means read again. */
  let detailSig: string | null = null;
  let leaveGuard: ((go: () => void, stay?: () => void) => void) | null = null;
  /** The list's keyboard cursor; not state, as nothing draws from it here. */
  let listCursor: string | null = null;
  /** Changes already shown in a banner, so one the user dismissed does not come back. */
  const bannered = new Set<string>();
  /** Unsaved text by project, bead and field. Kept across project switches, so going back finds it. */
  const drafts = new Map<string, Draft>();
  const draftKey = (id: string, field: string) => `${state.directory ?? ''}\n${id}\n${field}`;

  /** Sends the unseen count to the rail badge when it changed, or always when `force` (the host clears it on open). */
  const sendBadge = (force = false) => {
    const count = Math.min(state.snapshot?.unseenIds.length ?? 0, GUEST_BADGE_MAX);
    const next = count > 0 ? count : null;
    if (!force && next === badge) return;
    badge = next;
    host.setBadge(next).catch(() => {});
  };

  const set = (patch: Partial<State>) => {
    state = { ...state, ...patch };
    if ('snapshot' in patch) sendBadge();
    listeners.forEach((l) => l());
  };

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const usable = () => state.workspace === null || state.workspace.kind === 'ok';

  const schedule = (ms: number) => {
    clearTimer();
    if (disposed || !usable()) return;
    if (visibility.isVisible()) timer = setTimeout(() => void poll(), ms);
    else if (!visibility.isDocumentHidden?.()) timer = setTimeout(() => void poll(), Math.max(ms, HIDDEN_POLL_MS));
  };

  async function poll(refreshWorkspace = false): Promise<void> {
    clearTimer();
    const { directory, generation } = state;
    if (directory === null || disposed) return;
    const seq = ++latest;
    inFlight = true;
    const current = () => {
      if (seq !== latest || generation !== state.generation || disposed) return false;
      inFlight = false;
      return true;
    };
    const cursor = state.snapshot?.cursor;
    try {
      const answer = await client.snapshot({ directory, ...(cursor ? { cursor } : {}), ...(refreshWorkspace ? { refreshWorkspace: true } : {}) });
      if (!current()) return;
      failures = 0;
      if (!answer.unchanged) {
        listedBeads = answer.beads;
        set({ snapshot: { ...answer, beads: holding(answer.beads, answer.freshness) }, workspace: answer.workspace, error: null });
        followDetail();
      } else if (state.snapshot) {
        const held = answered.size;
        const beads = holding(listedBeads, answer.freshness);
        set({ snapshot: { ...state.snapshot, cursor: answer.cursor, freshness: answer.freshness, sync: answer.sync, ...(answered.size !== held ? { beads } : {}) }, error: null });
      }
      schedule(POLL_MS);
    } catch (thrown) {
      if (!current()) return;
      const error = asRequestError(thrown);
      if (error.workspace) {
        set({ workspace: error.workspace, snapshot: null, error: null });
        return;
      }
      failures++;
      set({ error: toPanelError(error) });
      schedule(Math.min(POLL_MS * 2 ** failures, MAX_BACKOFF_MS));
    }
  }

  // ----------------------------------------------------------------------------------------------- written beads

  /**
   * Beads as a write answered them, and when (panel clock). Each is shown in place of the listed copy until the service
   * has read the project after that time (`freshness.localRefreshedAt`), so a failed or late export never flips it back.
   */
  const answered = new Map<string, { bead: Bead; at: number }>();
  /** The beads of the last full answer, as the service listed them. */
  let listedBeads: Bead[] = [];

  /** `beads` with the answered copies the service has not read past yet; the others are let go. */
  function holding(beads: Bead[], freshness: FullSnapshot['freshness']): Bead[] {
    if (answered.size === 0) return beads;
    const read = freshness.localRefreshedAt === null ? NaN : Date.parse(freshness.localRefreshedAt);
    for (const [id, copy] of [...answered]) if (read > copy.at) answered.delete(id);
    if (answered.size === 0) return beads;
    const out = beads.map((b) => answered.get(b.id)?.bead ?? b);
    for (const [id, copy] of answered) if (!beads.some((b) => b.id === id)) out.push(copy.bead);
    return out;
  }

  /**
   * Shows `bead` as Beads answered a write, at once: in the list, and in the detail when it is the one shown. The service
   * reads the project again for the next poll (a panel write skips its usual wait), which then takes over.
   */
  function applyWritten(bead: Bead) {
    const snapshot = state.snapshot;
    if (!snapshot) return;
    answered.set(bead.id, { bead, at: now() });
    const listed = snapshot.beads.find((b) => b.id === bead.id);
    const beads = listed ? snapshot.beads.map((b) => (b.id === bead.id ? bead : b)) : [...snapshot.beads, bead];
    set({ snapshot: { ...snapshot, beads } });
    const shown = shownEntry();
    if (state.detail && shown?.id === bead.id) {
      // A read already on its way may have started before the write: what the write answered is newer.
      detailSeq++;
      detailSig = beadSignature(bead);
      const related = state.detail.data?.bead.id === bead.id ? state.detail.data.related : relatedFor(bead, beads);
      set({ detail: { ...state.detail, data: { bead, related }, loading: false, error: null } });
    }
  }

  // ----------------------------------------------------------------------------------------------- detail

  const shownEntry = (): DetailEntry | null => state.detail?.stack[state.detail.stack.length - 1] ?? null;
  const listed = (id: string) => state.snapshot?.beads.find((b) => b.id === id);
  const entryFor = (id: string): DetailEntry => ({ id, change: state.snapshot ? latestUnseenChange(id, state.snapshot.activity) : null });

  async function loadDetail(): Promise<void> {
    const entry = shownEntry();
    const { directory, generation } = state;
    if (!entry || directory === null || !state.detail) return;
    const seq = ++detailSeq;
    const copy = listed(entry.id);
    detailSig = copy ? beadSignature(copy) : null;
    set({ detail: { ...state.detail, loading: true, error: null } });
    const current = () => seq === detailSeq && generation === state.generation && !disposed && state.detail !== null && shownEntry()?.id === entry.id;
    try {
      const data = await client.bead({ directory, id: entry.id });
      if (!current()) return;
      // An answer without the bead is treated as a failed read: the list's copy stays on screen.
      if (!isObject(data) || !isObject(data.bead) || data.bead.id !== entry.id || !isObject(data.related)) throw new Error('The bead answer had no bead.');
      set({ detail: { ...state.detail!, data, loading: false, error: null } });
    } catch (thrown) {
      if (current()) set({ detail: { ...state.detail!, loading: false, error: toPanelError(thrown) } });
    }
  }

  /** Takes the service's new unseen list: changes to beads no longer on it lose their highlight. */
  function applySeen(unseenIds: string[]) {
    const snapshot = state.snapshot;
    if (!snapshot) return;
    const unseen = new Set(unseenIds);
    const activity = snapshot.activity.map((e) => (e.unseen && !unseen.has(e.beadId) ? { ...e, unseen: false } : e));
    set({ snapshot: { ...snapshot, unseenIds, activity } });
  }

  /** Marks one bead seen and takes the service's new unseen list; on failure it simply stays unseen. */
  async function markSeen(id: string): Promise<void> {
    const { directory, generation } = state;
    if (directory === null || !state.snapshot?.unseenIds.includes(id)) return;
    try {
      const { unseenIds } = await client.seen({ directory, ids: [id] });
      if (generation !== state.generation || disposed || !isStrings(unseenIds)) return;
      applySeen(unseenIds);
    } catch {
      // Nothing to show: the row keeps its highlight and the next open tries again.
    }
  }

  const show = (stack: DetailEntry[]) => {
    const entry = stack[stack.length - 1]!;
    if (entry.change) bannered.add(entry.change.id);
    set({ detail: { stack, data: null, loading: true, error: null } });
    void loadDetail();
    void markSeen(entry.id);
  };

  const replaceShown = (entry: DetailEntry) => {
    if (!state.detail) return;
    set({ detail: { ...state.detail, stack: [...state.detail.stack.slice(0, -1), entry] } });
  };

  /**
   * After a full answer, and when the panel is shown again: read the shown bead again if it changed, and keep it seen
   * while it is on screen. A hidden pane is not on screen: its change stays unseen, with no banner, until it is shown.
   */
  function followDetail() {
    const entry = shownEntry();
    const snapshot = state.snapshot;
    if (!entry || !snapshot) return;
    const copy = listed(entry.id);
    if (copy && beadSignature(copy) !== detailSig) void loadDetail();
    if (!visibility.isVisible() || !snapshot.unseenIds.includes(entry.id)) return;
    const change = latestUnseenChange(entry.id, snapshot.activity);
    if (change && !bannered.has(change.id)) {
      bannered.add(change.id);
      replaceShown({ ...entry, change });
    }
    void markSeen(entry.id);
  }

  function select(id: string | null) {
    if (id === null) {
      detailSeq++;
      set({ selectedId: null, detail: null });
      return;
    }
    set({ selectedId: id });
    show([entryFor(id)]);
  }

  /** Moves off the shown bead, through the guard when one is set (an unsaved draft on screen). */
  /** `stay` runs when the person keeps their draft instead. */
  const leaving = (go: () => void, stay?: () => void) => (leaveGuard ? leaveGuard(go, stay) : go());

  /** Opens a bead already in hand (just made) without reading it: the service may not list it yet. */
  function showMade(bead: Bead) {
    // Kept on a draft instead: the new bead is in the list, and a toast says it was made.
    if (state.detail) leaving(() => openMade(bead), () => host.toast({ kind: 'success', message: `Created ${shortId(bead.id)}.` }).catch(() => {}));
    else openMade(bead);
  }

  function openMade(bead: Bead) {
    const entry: DetailEntry = { id: bead.id, change: null };
    const stack = state.detail ? [...state.detail.stack, entry] : [entry];
    detailSeq++;
    detailSig = beadSignature(bead);
    const data = { bead, related: relatedFor(bead, state.snapshot?.beads ?? []) };
    set({ selectedId: state.detail ? state.selectedId : bead.id, detail: { stack, data, loading: false, error: null } });
  }

  // ----------------------------------------------------------------------------------------------- writes

  /** After a write that may or may not be in: read the project again, and the shown bead unless the answer brought it. */
  function refreshAfterWrite(readBead: boolean) {
    void poll();
    if (readBead && state.detail) void loadDetail();
  }

  function refused(thrown: unknown): WriteOutcome<never> {
    const error = asRequestError(thrown);
    // A write whose answer was lost on the way back (the host gave up, the helper stopped) may still have gone in.
    if (error.code === 'uncertain' || ANSWER_LOST.has(error.code)) {
      refreshAfterWrite(true);
      return { kind: 'uncertain', current: null, saved: error.saved === true };
    }
    // Part of it went in before it was refused: read the bead again, so it is not shown as it was.
    if (error.saved) refreshAfterWrite(true);
    // The project may have stopped taking writes (a sync, a half merge) or become unusable: the next poll shows that.
    else if (error.code === 'writes-blocked' || error.code === 'sync-running' || error.code === 'merge-conflict' || error.workspace) void poll();
    return { kind: 'error', error: toPanelError(error) };
  }

  /** One write for the shown project. Its answer is dropped when the project changed while it ran. */
  async function writing<T, R>(send: (directory: string) => Promise<R>, done: (answer: R) => WriteOutcome<T>): Promise<WriteOutcome<T>> {
    const { directory, generation } = state;
    if (directory === null || disposed) return { kind: 'dropped' };
    const here = () => generation === state.generation && !disposed;
    try {
      const answer = await send(directory);
      return here() ? done(answer) : { kind: 'dropped' };
    } catch (thrown) {
      return here() ? refused(thrown) : { kind: 'dropped' };
    }
  }

  /** The freshest copy of a bead the panel holds: the detail's read one or the list's. */
  const known = (id: string): Bead | null => newerBead(state.detail?.data?.bead.id === id ? state.detail.data.bead : null, listed(id) ?? null);

  const persist = () => {
    const { directory, view, filters, collapsed } = state;
    if (directory === null) return;
    touched = true;
    const value = { view, filters, collapsed } as unknown as JsonValue;
    host.storage.set(uiKey(directory), value).catch(() => {});
  };

  const stopVisibility = visibility.onChange(() => {
    const visible = visibility.isVisible();
    const shown = visible && !wasVisible;
    wasVisible = visible;
    if (!visible) {
      if (!inFlight) schedule(HIDDEN_POLL_MS);
    } else if (shown && state.directory !== null) {
      set({ watchedSince: now() });
      sendBadge(true);
      followDetail();
      if (usable() && !inFlight) void poll();
    }
  });

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setDirectory(directory) {
      if (directory === state.directory) return;
      clearTimer();
      failures = 0;
      touched = false;
      inFlight = false;
      detailSeq++;
      detailSig = null;
      bannered.clear();
      answered.clear();
      listedBeads = [];
      const generation = state.generation + 1;
      set({
        directory,
        generation,
        workspace: null,
        snapshot: null,
        error: null,
        selectedId: null,
        detail: null,
        query: '',
        watchedSince: now(),
        confirming: false,
        confirmError: null,
        create: null,
        ...readUi(undefined),
      });
      if (directory === null) return;
      host.storage
        .get(uiKey(directory))
        .then((stored) => {
          if (!disposed && generation === state.generation && !touched && stored !== undefined) set(readUi(stored));
        })
        .catch(() => {});
      void poll();
    },
    retry() {
      failures = 0;
      void poll(true);
    },
    async confirmFirstContact() {
      const { directory, generation } = state;
      if (directory === null || state.confirming) return;
      set({ confirming: true, confirmError: null });
      try {
        const workspace = await client.workspace({ directory, confirmFirstContact: true });
        if (generation !== state.generation || disposed) return;
        // Take the answer as the workspace now, so a failing first poll backs off and retries instead of stopping.
        set({ confirming: false, workspace, snapshot: null });
        await poll(true);
      } catch (thrown) {
        if (generation !== state.generation || disposed) return;
        const error = asRequestError(thrown);
        if (!error.workspace) {
          set({ confirming: false, confirmError: toPanelError(error) });
          return;
        }
        // The service says what the project is now (for example already confirmed elsewhere): show that, and read it if usable.
        const ready = error.workspace.kind === 'ok';
        set({ confirming: false, workspace: error.workspace, snapshot: null, confirmError: ready ? null : toPanelError(error) });
        if (ready) void poll(true);
      }
    },
    setView(view) {
      set({ view });
      persist();
    },
    setFilters(filters) {
      set({ filters });
      persist();
    },
    toggleCollapsed(key) {
      set({ collapsed: state.collapsed.includes(key) ? state.collapsed.filter((k) => k !== key) : [...state.collapsed, key] });
      persist();
    },
    setQuery(query) {
      set({ query });
    },
    select,
    openRelated(id) {
      if (!state.detail) return select(id);
      if (shownEntry()?.id === id) return;
      leaving(() => {
        if (state.detail) show([...state.detail.stack, entryFor(id)]);
      });
    },
    back() {
      if (!state.detail) return;
      leaving(() => {
        if (!state.detail) return;
        const stack = state.detail.stack.slice(0, -1);
        if (stack.length > 0) {
          show(stack);
          return;
        }
        detailSeq++;
        set({ detail: null });
      });
    },
    setLeaveGuard(guard) {
      leaveGuard = guard;
    },
    confirmLeave(go) {
      leaving(go);
    },
    setOverlay(name, open) {
      if (open === state.overlays.includes(name)) return;
      set({ overlays: open ? [...state.overlays, name] : state.overlays.filter((n) => n !== name) });
    },
    draft(id, field) {
      return drafts.get(draftKey(id, field)) ?? null;
    },
    setDraft(id, field, draft) {
      if (draft) drafts.set(draftKey(id, field), draft);
      else drafts.delete(draftKey(id, field));
    },
    dropDrafts(id) {
      const prefix = draftKey(id, '');
      for (const key of [...drafts.keys()]) if (key.startsWith(prefix)) drafts.delete(key);
    },
    reloadDetail() {
      void loadDetail();
    },
    dismissChange() {
      const entry = shownEntry();
      if (entry?.change) replaceShown({ ...entry, change: null });
    },
    async markAllSeen() {
      const { directory, generation } = state;
      if (directory === null || !state.snapshot) return;
      try {
        const { unseenIds } = await client.seen({ directory, all: true });
        if (generation !== state.generation || disposed || !isStrings(unseenIds)) return;
        applySeen(unseenIds);
      } catch (thrown) {
        if (generation !== state.generation || disposed) return;
        const error = toPanelError(thrown);
        host.toast({ kind: 'error', message: `Couldn't mark the changes seen. ${error.message}`.slice(0, TOAST_MAX), ...(error.detail ? { copy: { text: error.detail.slice(0, COPY_MAX) } } : {}) }).catch(() => {});
      }
    },
    openUrl(url) {
      const offerCopy = () => host.toast({ kind: 'info', message: `The panel can't open this link: ${url}`.slice(0, TOAST_MAX), copy: { text: url } }).catch(() => {});
      // Relative and file links have nowhere to go from the panel: offer the text instead of doing nothing.
      if (!/^(https?:|mailto:)/i.test(url)) {
        void offerCopy();
        return;
      }
      host.openUrl(url).catch(offerCopy);
    },
    copyDetails(error) {
      host.toast({ kind: 'error', message: error.message.slice(0, TOAST_MAX), copy: { text: (error.detail ?? error.message).slice(0, COPY_MAX) } }).catch(() => {});
    },
    copyText(text) {
      host
        .writeClipboard(text)
        .then(
          () => host.toast({ kind: 'success', message: `Copied ${text}` }),
          () => host.toast({ kind: 'info', message: text, copy: { text } }),
        )
        .catch(() => {});
    },
    update(id, expectedUpdatedAt, patch, expected) {
      return writing(
        (directory) => client.update({ directory, id, expectedUpdatedAt, patch, ...(expected ? { expected } : {}) }),
        (result): WriteOutcome<Bead> => {
          if (result.ok) {
            applyWritten(result.bead);
            void poll();
            // In, but the panel could not note it as its own, so it may show as someone else's change.
            if (result.detail) {
              host.toast({ kind: 'info', message: 'Saved. It may show as a change from someone else.', copy: { text: result.detail.slice(0, COPY_MAX) } }).catch(() => {});
            }
            return { kind: 'ok', value: result.bead };
          }
          if ('conflict' in result) {
            applyWritten(result.current);
            return { kind: 'conflict', current: result.current };
          }
          if (result.current) applyWritten(result.current);
          refreshAfterWrite(result.current === null);
          return { kind: 'uncertain', current: result.current, saved: result.saved === true };
        },
      );
    },
    create(input) {
      return writing(
        (directory) => client.create({ directory, input }),
        ({ bead }): WriteOutcome<Bead> => {
          applyWritten(bead);
          set({ create: null });
          showMade(bead);
          void poll();
          return { kind: 'ok', value: bead };
        },
      );
    },
    comment(id, text) {
      return writing(
        (directory) => client.comment({ directory, id, text }),
        ({ comment }): WriteOutcome<Comment> => {
          const bead = known(id);
          if (bead && !bead.comments.some((c) => c.id === comment.id)) applyWritten({ ...bead, comments: [...bead.comments, comment] });
          void poll();
          return { kind: 'ok', value: comment };
        },
      );
    },
    link(change) {
      return writing(
        (directory) => client.dependency({ directory, ...change }),
        (): WriteOutcome<null> => {
          const holder = known(change.from);
          if (holder) {
            // Beads keeps one link per ordered pair, so the pair names it.
            const others = holder.dependencies.filter((d) => d.to !== change.to);
            const createdBy = state.snapshot?.panelActor || null;
            const dependencies = change.op === 'add' ? [...others, { from: change.from, to: change.to, kind: change.kind, createdBy, createdAt: null }] : others;
            applyWritten({ ...holder, dependencies });
          }
          void poll();
          return { kind: 'ok', value: null };
        },
      );
    },
    notify(message) {
      host.toast({ kind: 'success', message }).catch(() => {});
    },
    setListCursor(id) {
      listCursor = id;
    },
    openCreate() {
      if (!state.snapshot) return;
      const from = shownEntry()?.id ?? (state.view === 'epic' ? listCursor : null);
      set({ create: { parentId: defaultParent(state.snapshot.beads, from) } });
    },
    closeCreate() {
      if (state.create) set({ create: null });
    },
    syncStarted(sync) {
      if (sync && state.snapshot) set({ snapshot: { ...state.snapshot, sync } });
      void poll();
    },
    dispose() {
      disposed = true;
      clearTimer();
      stopVisibility();
      listeners.clear();
    },
  };
}

/**
 * Why there is nothing to show yet, when the first load failed: the poll itself failed before any answer, or the
 * service answered for a usable project but has never managed a local read. Null otherwise.
 */
export function firstLoadError(state: State): PanelError | null {
  const { snapshot } = state;
  if (!snapshot) return state.error;
  if (snapshot.workspace.kind !== 'ok') return null;
  const f = snapshot.freshness;
  if (f.localRefreshedAt !== null || f.localError === null) return null;
  return { code: 'local', message: f.localError, ...(f.localErrorDetail ? { detail: f.localErrorDetail } : {}) };
}

export const StoreContext = createContext<Store | null>(null);

/** The panel store from context. */
export function useStoreApi(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StoreContext is missing');
  return store;
}

/** The current state; re-renders on every change. */
export function useStore(): State {
  const store = useStoreApi();
  const [, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const stop = store.subscribe(bump);
    // A change between the first render and this effect would otherwise be missed.
    bump();
    return stop;
  }, [store]);
  return store.get();
}

/** The project directory the panel shows, or null when none is open. */
export const useDirectory = (): string | null => useStore().directory;

/** Panel clock in ms, re-rendering every `everyMs`. */
export function useNow(everyMs = 1_000): number {
  const [time, setTime] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setTime(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return time;
}

/** Keeps `name` in the store's open overlays while `open` holds (and while the caller is mounted). */
export function useOverlay(name: string, open: boolean): void {
  const store = useStoreApi();
  useEffect(() => {
    store.setOverlay(name, open);
    return () => store.setOverlay(name, false);
  }, [store, name, open]);
}
