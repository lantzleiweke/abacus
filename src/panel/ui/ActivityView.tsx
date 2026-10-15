import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Bead, HistoryChange, StatusDef } from '../../shared/types';
import { activityFeed, rowChange, whenOf, type EntryMark, type FeedEntry } from '../activity';
import { writesPaused } from '../edit';
import { blockedMessage } from '../gates';
import { restoreRequest, restoreState } from '../history';
import { shortId } from '../list';
import { listKey } from '../keyboard';
import { useNow, useStore, useStoreApi } from '../store';
import { EmptyState, NoBeads } from './EmptyState';
import { describeFreshness } from './Header';
import { useRowActions } from './AttachFooter';
import { fieldWord, RestoreControl, useRestore, type RestoreKit } from './History';
import { IconChat, IconEdit, IconLink, IconMore, IconPlus, IconRestore, IconTrash, IconWait, IconX } from './icons';
import { focusOf, SEARCH } from './List';
import { menuFor, RowMenu, StatusDot, type MenuAt, type MenuClose, type MenuExtra } from './Row';

export const entryDomId = (eventId: string) => `bd-act-${eventId}`;

function Mark({ mark }: { mark: EntryMark }) {
  if (mark.kind === 'status') return <StatusDot look={mark.look} marker={mark.marker} />;
  const Icon = { created: IconPlus, deleted: IconTrash, comment: IconChat, link: IconLink, edit: IconEdit, gate: IconWait }[mark.kind];
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

/** A restore started from a row: which change, on which bead. Its key is the row's event id. */
type Restoring = { key: string; beadId: string; change: HistoryChange };

type RestoreBarProps = { target: Restoring; bead: Bead | null; kit: RestoreKit; statuses: StatusDef[]; paused: string | null; reword(message: string): string; onClose(): void };

/**
 * Above the feed (the rows are options, so nothing is pressed inside them): how a restore chosen from a row's menu went, and the
 * person's choice when the field holds something else by now.
 */
function RestoreBar({ target, bead, kit, statuses, paused, reword, onClose }: RestoreBarProps) {
  const label = `${fieldWord(target.change.field)} on ${shortId(target.beadId)}`;
  return (
    <div class="bd-act-rs" role="group" aria-label={`Restore ${label}`}>
      <div class="bd-act-rs-top">
        <IconRestore size={13} />
        <span class="bd-act-rs-what">
          {`Restore ${fieldWord(target.change.field)} on `}
          <span class="bd-id">{shortId(target.beadId)}</span>
          {bead && <span class="bd-title">{` ${bead.title}`}</span>}
        </span>
        <button type="button" class="bd-banner-x" aria-label="Close" disabled={kit.busy(target.key)} onClick={onClose}>
          <IconX />
        </button>
      </div>
      {bead ? (
        <RestoreControl kit={kit} scope="a" rkey={target.key} bead={bead} change={target.change} statuses={statuses} paused={paused} reword={reword} grouped onKeep={onClose} />
      ) : (
        <p class="bd-rs-msg">This bead is no longer in the project.</p>
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
  const [menu, setMenu] = useState<{ at: MenuAt; eventId: string } | null>(null);
  const actions = useRowActions();
  const kit = useRestore('a', { focusChoice: true });
  const [restoring, setRestoring] = useState<Restoring | null>(null);
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
    setMenu({ at, eventId: entry.event.id });
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
      if (s.detail || s.page !== 'list' || s.overlays.length > 0 || opened || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
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
  const paused = writesPaused(snapshot);
  const beadOf = (id: string) => beads?.find((b) => b.id === id) ?? null;
  const reword = (message: string) => (restoring ? blockedMessage(message, { id: restoring.beadId }, state.gates) : message);

  /** A row's Restore, when it has one: a whole short field value, on a bead the project still has. */
  const restoreItem = (entry: FeedEntry | undefined): MenuExtra[] => {
    const change = entry && !entry.gone ? rowChange(entry.event) : null;
    const bead = entry ? beadOf(entry.event.beadId) : null;
    if (!entry || !change || !bead || !restoreRequest(bead, change)) return [];
    const where = restoreState(bead, change);
    const key = entry.event.id;
    const run = () => {
      setRestoring({ key, beadId: bead.id, change });
      // Moved on since: the bar shows what it holds now and the person decides; nothing is sent.
      if (where === 'changed') kit.hold(key, bead);
      else kit.restore(key, bead, change);
    };
    const off = paused ?? (where === 'unchanged' ? 'Already the earlier value' : kit.busy(key) ? 'Restoring' : undefined);
    return [{ label: 'Restore previous value', icon: <IconRestore />, run, ...(off ? { off } : {}) }];
  };
  return (
    <div class="bd-list bd-act" data-stale={stale || undefined}>
      <SeenBar total={entries.length} unseen={unseen} beadsUnseen={snapshot.unseenIds.length} />
      {restoring && (
        <RestoreBar
          key={restoring.key}
          target={restoring}
          bead={beadOf(restoring.beadId)}
          kit={kit}
          statuses={snapshot.statuses}
          paused={paused}
          reword={reword}
          onClose={() => {
            kit.dismiss(restoring.key);
            setRestoring(null);
            box.current?.focus({ preventScroll: true });
          }}
        />
      )}
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
      {menu && <RowMenu at={menu.at} actions={actions} extra={restoreItem(entries.find((e) => e.event.id === menu.eventId))} onClose={closeMenu} />}
    </div>
  );
}
