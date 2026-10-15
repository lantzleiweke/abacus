import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { activityFeed, whenOf, type EntryMark, type FeedEntry } from '../activity';
import { listKey } from '../keyboard';
import { useNow, useStore, useStoreApi } from '../store';
import { EmptyState, NoBeads } from './EmptyState';
import { describeFreshness } from './Header';
import { useRowActions } from './AttachFooter';
import { IconChat, IconEdit, IconLink, IconMore, IconPlus, IconTrash } from './icons';
import { focusOf, SEARCH } from './List';
import { menuFor, RowMenu, StatusDot, type MenuAt, type MenuClose } from './Row';

export const entryDomId = (eventId: string) => `bd-act-${eventId}`;

function Mark({ mark }: { mark: EntryMark }) {
  if (mark.kind === 'status') return <StatusDot look={mark.look} marker={mark.marker} />;
  const Icon = { created: IconPlus, deleted: IconTrash, comment: IconChat, link: IconLink, edit: IconEdit }[mark.kind];
  return (
    <span class="bd-act-ic" data-kind={mark.kind}>
      <Icon size={13} />
    </span>
  );
}

type EntryProps = { entry: FeedEntry; now: number; cursor: boolean; selected: boolean; pick(entry: FeedEntry): void; menu(entry: FeedEntry, at: MenuAt): void };

/** One change: what changed and when, then which bead and who. A deleted bead's entry names it but opens nothing, and has no menu. */
function Entry({ entry, now, cursor, selected, pick, menu }: EntryProps) {
  const { event } = entry;
  return (
    <div
      role="option"
      id={entryDomId(event.id)}
      class="bd-row bd-act-row"
      aria-selected={selected}
      aria-disabled={entry.gone || undefined}
      data-selected={selected || undefined}
      data-cursor={cursor || undefined}
      data-unseen={event.unseen || undefined}
      data-gone={entry.gone || undefined}
      data-kind={event.kind}
      onClick={() => pick(entry)}
      onContextMenu={(e) => {
        if (entry.gone) return;
        e.preventDefault();
        menu(entry, { ...menuFor(event.beadId, e.currentTarget), x: e.clientX });
      }}
    >
      <span class="bd-act-mark">
        <Mark mark={entry.mark} />
      </span>
      <span class="bd-act-what" title={entry.what}>
        {entry.what}
      </span>
      <time class="bd-act-when" dateTime={event.changedAt ?? event.observedAt} title={entry.whenTitle}>
        {whenOf(event, now)}
      </time>
      <span class="bd-act-bead">
        <span class="bd-id" title={event.beadId}>
          {entry.short}
        </span>
        {entry.title !== null ? <span class="bd-title">{entry.title}</span> : entry.gone && <span class="bd-act-notitle">(title not recorded)</span>}
        {/* The deletion's own entry already says so. */}
        {entry.gone && event.kind !== 'deleted' && <span class="bd-act-gone">deleted</span>}
      </span>
      <span class="bd-act-who" title={entry.who}>
        {entry.who}
      </span>
      {!entry.gone && (
        <button
          type="button"
          class="bd-rowmore"
          aria-label="More actions"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            const button = e.currentTarget;
            menu(entry, menuFor(event.beadId, button.closest('.bd-row') ?? button, button));
          }}
        >
          <IconMore />
        </button>
      )}
    </div>
  );
}

/** "Mark all seen" with how many entries are still unseen. */
function SeenBar({ total, unseen, beadsUnseen }: { total: number; unseen: number; beadsUnseen: number }) {
  const store = useStoreApi();
  const [busy, setBusy] = useState(false);
  return (
    <div class="bd-act-bar">
      <span class="bd-act-count">{total === 1 ? '1 change' : `${total} changes`}</span>
      {unseen > 0 && <span class="bd-act-unseen">{`${unseen} unseen`}</span>}
      {(unseen > 0 || beadsUnseen > 0) && (
        <button
          type="button"
          class="bd-link bd-act-seen"
          disabled={busy}
          aria-busy={busy}
          onClick={() => {
            setBusy(true);
            void store.markAllSeen().finally(() => setBusy(false));
          }}
        >
          Mark all seen
        </button>
      )}
    </div>
  );
}

/**
 * The Activity view: every change the service saw or Beads' history recorded, newest first and grouped by day, with
 * unseen ones highlighted. Search narrows it; the list's filters do not apply. Keys work as in the list.
 */
export function ActivityView() {
  const state = useStore();
  const store = useStoreApi();
  const now = useNow(5_000);
  const [cursor, setCursor] = useState<string | null>(null);
  /** The entry last opened, marked selected while its bead stays the selected one. */
  const [opened, setOpened] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const actions = useRowActions();
  const scrollTo = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const snapshot = state.snapshot;
  const { activity, beads, statuses } = snapshot ?? {};

  // The feed changes with the data and the search, and with the day (for "Today"); the ages are worked out per row.
  const today = new Date(now).setHours(0, 0, 0, 0);
  const days = useMemo(
    () => (activity && beads && statuses ? activityFeed({ activity, beads, statuses, query: state.query, now: today }) : []),
    [activity, beads, statuses, state.query, today],
  );
  const entries = useMemo(() => days.flatMap((d) => d.entries), [days]);
  const ids = entries.map((e) => e.event.id);
  const shown = cursor !== null && ids.includes(cursor) ? cursor : null;

  const open = (entry: FeedEntry) => {
    setCursor(entry.event.id);
    if (entry.gone) return;
    setOpened(entry.event.id);
    store.select(entry.event.beadId);
  };

  const showMenu = (entry: FeedEntry, at: MenuAt) => {
    setCursor(entry.event.id);
    setMenu(at);
  };
  const closeMenu = useCallback((why: MenuClose) => {
    setMenu(null);
    if (why !== 'outside') queueMicrotask(() => box.current?.focus({ preventScroll: true }));
  }, []);

  // Latest values for the document key handler, which is attached once.
  const live = useRef({ ids, cursor: shown, entries, state, open, menu, showMenu });
  live.current = { ids, cursor: shown, entries, state, open, menu, showMenu };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { ids: order, cursor: at, entries: list, state: s, open: go, menu: opened, showMenu: openMenu } = live.current;
      // Under a bead's detail the feed keeps still; the detail has its own keys.
      if (s.detail || s.overlays.length > 0 || opened || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const focus = focusOf(e.target);
      const key = e.key === 'F10' && e.shiftKey ? 'ContextMenu' : e.key;
      const action = listKey({ key, ids: order, cursor: at, focus });
      if (!action) return;
      if (action.type === 'menu') {
        const entry = list.find((x) => x.event.id === action.id);
        const row = document.getElementById(entryDomId(action.id));
        if (!entry || entry.gone || !row) return;
        e.preventDefault();
        openMenu(entry, menuFor(entry.event.beadId, row, row.querySelector('.bd-rowmore') ?? row));
        return;
      }
      e.preventDefault();
      switch (action.type) {
        case 'move':
          scrollTo.current = true;
          setCursor(action.id);
          break;
        case 'open': {
          const entry = list.find((x) => x.event.id === action.id);
          if (entry) go(entry);
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
    if (shown === null || !scrollTo.current) return;
    scrollTo.current = false;
    document.getElementById(entryDomId(shown))?.scrollIntoView?.({ block: 'nearest' });
  }, [shown]);

  // Back from a detail: focus returns to the feed, unless the person already put it somewhere.
  const hadDetail = useRef(state.detail !== null);
  useEffect(() => {
    const back = hadDetail.current && state.detail === null;
    hadDetail.current = state.detail !== null;
    const active = document.activeElement;
    if (back && (!active || active === document.body)) box.current?.focus({ preventScroll: true });
  }, [state.detail]);

  if (!snapshot || !activity) return null;
  if (activity.length === 0) {
    if (snapshot.beads.length === 0) return <NoBeads />;
    return <EmptyState tone="neutral" title="Nothing has changed yet." body="Changes your agent makes show up here." />;
  }
  if (entries.length === 0) {
    return (
      <EmptyState tone="neutral" title="No changes match." body="Nothing in the activity has that id, title, name or change.">
        <button type="button" class="bd-btn" onClick={() => store.setQuery('')}>
          Clear search
        </button>
      </EmptyState>
    );
  }

  const stale = describeFreshness(state, now)?.stale ?? false;
  const unseen = entries.filter((e) => e.event.unseen).length;
  return (
    <div class="bd-list bd-act" data-stale={stale || undefined}>
      <SeenBar total={entries.length} unseen={unseen} beadsUnseen={snapshot.unseenIds.length} />
      <div role="listbox" aria-label="Activity" tabIndex={0} ref={box} {...(shown ? { 'aria-activedescendant': entryDomId(shown) } : {})}>
        {days.map((day) => (
          <div key={day.key} role="group" class="bd-day-grp" aria-labelledby={`bd-day-${day.key}`}>
            <div class="bd-day" id={`bd-day-${day.key}`} role="presentation">
              {day.label}
            </div>
            {day.entries.map((entry) => (
              <Entry
                key={entry.event.id}
                entry={entry}
                now={now}
                cursor={shown === entry.event.id}
                selected={opened === entry.event.id && state.selectedId === entry.event.beadId}
                pick={open}
                menu={showMenu}
              />
            ))}
          </div>
        ))}
      </div>
      {menu && <RowMenu at={menu} actions={actions} onClose={closeMenu} />}
    </div>
  );
}
