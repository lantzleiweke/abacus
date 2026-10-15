import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { listKey, type KeyFocus } from '../keyboard';
import { writesPaused } from '../edit';
import { epicView, matchesWithAll, rowOrder, statusView, type ListInput } from '../list';
import { eligibleEpics } from '../needs';
import { filtersActive, useNow, useStore, useStoreApi, DEFAULT_FILTERS } from '../store';
import { EmptyState, NoBeads } from './EmptyState';
import { EpicView, type BoxAttrs } from './EpicView';
import { describeFreshness } from './Header';
import { useRowActions } from './AttachFooter';
import { menuFor, rowDomId, RowMenu, type MenuAt, type MenuClose } from './Row';
import { StatusView } from './StatusView';

export const SEARCH = '.bd-search input';

/** Where a key landed: the search box, another field (which keeps every key), a control (which keeps Enter), or the list. */
export function focusOf(target: EventTarget | null): KeyFocus {
  if (!(target instanceof HTMLElement)) return 'list';
  if (target.matches(SEARCH)) return 'search';
  if (target.isContentEditable || target.closest('input, textarea, select')) return 'field';
  // A refusal that took focus (Restore): Enter there must not open the cursor row and lose what it says.
  if (target.closest('button, a, [role="menuitem"], [data-refused]')) return 'control';
  return 'list';
}

/** The Epic and Status views: rows, keyboard movement, selection, and the row menu. */
export function List() {
  const state = useStore();
  const store = useStoreApi();
  // The stale tint and the ages move slowly; recomputing every second buys nothing.
  const now = useNow(5_000);
  const [cursor, setCursor] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  /** Status sections showing every row; for this visit only. */
  const [expanded, setExpanded] = useState<string[]>([]);
  const scrollTo = useRef(false);
  const actions = useRowActions();
  const snapshot = state.snapshot;
  const minute = Math.floor(now / 60_000) * 60_000;
  const { beads, statuses, readyIds, unseenIds } = snapshot ?? {};

  // Keyed on the parts that change the rows, not the snapshot object, which a freshness-only answer replaces.
  const model = useMemo(() => {
    if (!beads || !statuses || !readyIds || !unseenIds) return null;
    const input: ListInput = { beads, statuses, readyIds, unseenIds, filters: state.filters, query: state.query, collapsed: state.collapsed, expanded, now: minute };
    if (state.view === 'status') {
      const sections = statusView(input);
      return { kind: 'status' as const, sections, keyed: sections.map((s) => ({ key: s.key, ids: rowOrder([s]) })), ids: rowOrder(sections), input };
    }
    const groups = epicView(input);
    return { kind: 'epic' as const, groups, keyed: groups.map((g) => ({ key: g.key, ids: rowOrder([g]) })), ids: rowOrder(groups), input };
  }, [beads, statuses, readyIds, unseenIds, state.filters, state.query, state.collapsed, state.view, expanded, minute]);

  const gates = state.gates;
  const ready = useMemo(() => new Set(beads && statuses ? eligibleEpics(beads, statuses, gates).map((b) => b.id) : []), [beads, statuses, gates]);

  // The cursor counts only while its row is on screen.
  const shown = cursor !== null && (model?.ids.includes(cursor) ?? false) ? cursor : null;
  // A new bead goes under the epic the cursor is in.
  useEffect(() => {
    store.setListCursor(shown);
    return () => store.setListCursor(null);
  }, [shown, store]);
  // One listbox per section takes focus: the one holding the cursor, else the first.
  const holder = model?.keyed.find((k) => shown !== null && k.ids.includes(shown))?.key ?? model?.keyed.find((k) => k.ids.length > 0)?.key;

  // Latest values for the document key handler, which is attached once.
  const live = useRef({ ids: [] as string[], cursor: shown, menu, state });
  live.current = { ids: model?.ids ?? [], cursor: shown, menu, state };

  const focusRow = () => {
    const at = live.current.cursor;
    const row = at ? document.getElementById(rowDomId(at)) : null;
    row?.closest<HTMLElement>('[role="listbox"]')?.focus();
  };

  const closeMenu = useCallback((why: MenuClose) => {
    setMenu(null);
    if (why !== 'outside') queueMicrotask(focusRow);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { ids, cursor: at, menu: open, state: s } = live.current;
      // Under a bead's detail or the memories the list keeps still; they have their own keys.
      if (s.detail || s.page !== 'list' || s.overlays.length > 0 || open || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key === 'F10' && e.shiftKey ? 'ContextMenu' : e.key;
      const focus = focusOf(e.target);
      const action = listKey({ key, ids, cursor: at, focus });
      if (!action) return;
      e.preventDefault();
      switch (action.type) {
        case 'move':
          scrollTo.current = true;
          setCursor(action.id);
          break;
        case 'open':
          setCursor(action.id);
          store.select(action.id);
          break;
        case 'menu': {
          const row = document.getElementById(rowDomId(action.id));
          if (row) setMenu(menuFor(action.id, row, row.querySelector('.bd-rowmore') ?? row));
          break;
        }
        case 'search':
          document.querySelector<HTMLInputElement>(SEARCH)?.focus();
          break;
        case 'escape':
          if (focus === 'search') {
            if (s.query) store.setQuery('');
            else (e.target as HTMLElement).blur();
          } else if (s.selectedId !== null) store.select(null);
          else setCursor(null);
          break;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [store]);

  useEffect(() => {
    if (shown === null) return;
    const row = document.getElementById(rowDomId(shown));
    // Focus follows the cursor into another section's listbox, so the active descendant stays where focus is.
    const box = row?.closest<HTMLElement>('[role="listbox"]');
    const active = document.activeElement;
    if (box && active instanceof HTMLElement && active !== box && active.matches('.bd-list [role="listbox"]')) box.focus({ preventScroll: true });
    if (!scrollTo.current) return;
    scrollTo.current = false;
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [shown, holder]);

  if (!snapshot || !model) return null;
  if (snapshot.beads.length === 0) return <NoBeads />;

  const events = {
    cursor: shown,
    selectedId: state.selectedId,
    now: minute,
    pick: (id: string) => {
      setCursor(id);
      store.select(id);
    },
    menu: (at: MenuAt) => {
      setCursor(at.id);
      setMenu(at);
    },
  };
  const box: BoxAttrs = (key) => (key === holder ? { tabIndex: 0, ...(shown ? { 'aria-activedescendant': rowDomId(shown) } : {}) } : { tabIndex: -1 });
  const stale = describeFreshness(state, now)?.stale ?? false;

  if (model.kind === 'epic' ? model.groups.length === 0 : model.sections.length === 0) {
    const filtered = filtersActive(state.filters);
    if (state.query && state.filters.status === 'open' && matchesWithAll(model.input)) {
      return (
        <EmptyState tone="neutral" title="Only older closed beads match." body="They closed more than 7 days ago.">
          <button type="button" class="bd-btn" onClick={() => store.setFilters({ ...state.filters, status: 'all' })}>
            Show all
          </button>
        </EmptyState>
      );
    }
    return (
      <EmptyState tone="neutral" title="No beads match." body={state.query ? 'Nothing has that id or title.' : 'Nothing fits these filters.'}>
        {state.query && (
          <button type="button" class="bd-btn" onClick={() => store.setQuery('')}>
            Clear search
          </button>
        )}
        {filtered && (
          <button type="button" class="bd-btn" onClick={() => store.setFilters(DEFAULT_FILTERS)}>
            Reset filters
          </button>
        )}
      </EmptyState>
    );
  }

  return (
    <div class="bd-list" role="group" aria-label={model.kind === 'epic' ? 'Beads by epic' : 'Beads by status'} data-stale={stale || undefined} data-view={model.kind}>
      {model.kind === 'epic' ? (
        <EpicView groups={model.groups} toggle={(key) => store.toggleCollapsed(key)} box={box} ready={ready} paused={writesPaused(snapshot)} {...events} />
      ) : (
        <StatusView sections={model.sections} toggle={(key) => store.toggleCollapsed(key)} expand={(key) => setExpanded((list) => [...list, key])} box={box} {...events} />
      )}
      {menu && <RowMenu at={menu} actions={actions} onClose={closeMenu} />}
    </div>
  );
}
