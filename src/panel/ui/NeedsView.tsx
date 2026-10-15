import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Bead, Gate } from '../../shared/types';
import { parseDateInput, localZone } from '../dates';
import { writesPaused } from '../edit';
import { sentence, waitsText } from '../gates';
import { ago, shortAgo } from '../format';
import { composing, isEnterInInput, isSubmitKey, listKey, saveKey } from '../keyboard';
import { looker, markerOf, shortId, type Look } from '../list';
import { needsOf, type AskedRow, type ChangedRow, type StuckRow, type WaitingRow } from '../needs';
import { useNow, useStore, useStoreApi, type State, type WriteOutcome } from '../store';
import { DateInput } from './DateInput';
import { EmptyState, NoBeads } from './EmptyState';
import { describeFreshness } from './Header';
import { IconChat, IconClock, IconWait, IconX } from './icons';
import { focusOf, SEARCH } from './List';
import { StatusDot } from './Row';
import { feedbackOf, PausedNote, WriteMessage, type Feedback } from './writes';

export type Section = 'waiting' | 'asked' | 'stuck' | 'changed';

export const SECTION_TITLES: Record<Section, string> = {
  waiting: 'Waiting for your review',
  asked: 'Asked for help',
  stuck: 'Stuck',
  changed: 'Changed since you looked',
};

const ORDER: readonly Section[] = ['waiting', 'asked', 'stuck', 'changed'];

/** One row of the view: a bead in a section. A bead can sit in two sections (Stuck and Changed), so the key carries both. */
type Item =
  | { section: 'waiting'; key: string; bead: Bead; row: WaitingRow }
  | { section: 'asked'; key: string; bead: Bead; row: AskedRow }
  | { section: 'stuck'; key: string; bead: Bead; row: StuckRow }
  | { section: 'changed'; key: string; bead: Bead; row: ChangedRow };

export const needDomId = (key: string) => `bd-need-${key.replace(/[^\w.-]/g, '_')}`;

const firstLine = (text: string): string => text.trim().split('\n')[0]!.trim();

/** What a help request waits on before it can be answered, in the shared wording: gates by kind, beads by id and title. */
export function blockerText(ids: string[], beads: Bead[], gates: Gate[]): string {
  const held = gates.filter((g) => ids.includes(g.id));
  const named = ids.flatMap((id) => (held.some((g) => g.id === id) ? [] : beads.filter((b) => b.id === id).map((b) => ({ id: b.id, title: b.title }))));
  return sentence(waitsText({ gates: held, beads: named }));
}

/** The gate a Resolve acts on: the one whose reason the row shows. */
const targetGate = (row: WaitingRow): Gate => row.gates.find((g) => g.reason) ?? row.gates[0]!;

/** A gate that blocks two beads is two Waiting rows; while one resolves it, both are busy. */
const gateLock = (gateId: string) => `gate:${gateId}`;

/** A note at the top of the view about something that changed under the person (an agent got there first). */
type Notice = { id: number; text: string };

function itemsOf(state: State, now: number): Record<Section, Item[]> {
  const needs = needsOf(state, now);
  return {
    waiting: needs.waiting.map((row) => ({ section: 'waiting', key: `waiting:${row.bead.id}`, bead: row.bead, row })),
    asked: needs.asked.map((row) => ({ section: 'asked', key: `asked:${row.bead.id}`, bead: row.bead, row })),
    stuck: needs.stuck.map((row) => ({ section: 'stuck', key: `stuck:${row.bead.id}`, bead: row.bead, row })),
    changed: needs.changed.map((row) => ({ section: 'changed', key: `changed:${row.bead.id}`, bead: row.bead, row })),
  };
}

/** The words a row is listed for, searched along with its id and title. */
function whyOf(item: Item): string {
  switch (item.section) {
    case 'waiting':
      return item.row.gates.map((g) => g.reason ?? '').join(' ');
    case 'asked':
      return item.row.text;
    case 'stuck':
      return item.row.why;
    case 'changed':
      return item.row.summary;
  }
}

const matches = (item: Item, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.bead.id, item.bead.title, whyOf(item)].some((text) => text.toLowerCase().includes(q));
};

/** When the row's reason began: the review asked for, the request made, the last update, the change seen. */
function sinceOf(item: Item): string {
  switch (item.section) {
    case 'waiting':
      return targetGate(item.row).createdAt;
    case 'asked':
      return item.bead.createdAt;
    case 'stuck':
      return item.bead.updatedAt;
    case 'changed':
      return item.row.event?.changedAt ?? item.row.event?.observedAt ?? item.bead.updatedAt;
  }
}

function SectionIcon({ section }: { section: Section }) {
  if (section === 'waiting') return <IconWait size={13} />;
  if (section === 'asked') return <IconChat size={13} />;
  if (section === 'stuck') return <IconClock size={13} />;
  return <span class="bd-nsec-dot" />;
}

/** Which inline step is open on a row, with what has been typed. Kept per row, so one row's write never touches another's. */
type Step = { mode: 'resolve' | 'respond' | 'dismiss' | 'defer'; text: string };

const without = <T,>(map: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in map)) return map;
  const { [key]: _gone, ...rest } = map;
  return rest;
};

/** Notes kept at the top at most; the oldest goes first. */
const MAX_NOTICES = 3;

/**
 * The Needs me view: what waits on a person, in four sections (a review, a help request, stuck work, changes not seen yet),
 * each row saying why it is here, with its actions right there. Sections with nothing in them are left out.
 *
 * Structure: a section is a heading and a plain list. Each row is a list item holding a focusable part (the bead and why it is
 * here; Enter or a click opens it) and, beside it, the row's buttons and steps, so no control sits inside another. j and k move
 * real focus from row to row (one row is in the tab order at a time).
 */
export function NeedsView() {
  const state = useStore();
  const store = useStoreApi();
  const now = useNow(30_000);
  const minute = Math.floor(now / 60_000) * 60_000;
  const [cursor, setCursor] = useState<string | null>(null);
  /** The row last opened, marked selected while its bead stays the selected one. */
  const [opened, setOpened] = useState<string | null>(null);
  const [steps, setSteps] = useState<Record<string, Step>>({});
  /** Rows with a write on its way. The ref is the guard (a second click in the same tick); the state redraws. */
  const inflight = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  /** A refused or uncertain write, on the row it was for. */
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  /**
   * Rows already acted on whose bead or gate has not left the list yet, by gate id or bead version, with what they say until the
   * next answer takes them away. They show no actions, so nothing is sent twice.
   */
  const [settled, setSettled] = useState<Record<string, string>>({});
  const [notices, setNotices] = useState<Notice[]>([]);
  const noticeId = useRef(0);
  const snapshot = state.snapshot;

  const sections = useMemo(() => itemsOf(state, minute), [state.snapshot, state.settings, state.keep, minute]);
  const shownSections = ORDER.map((section) => ({ section, items: sections[section].filter((item) => matches(item, state.query)) })).filter((s) => s.items.length > 0);
  const total = ORDER.reduce((n, s) => n + sections[s].length, 0);
  const ids = shownSections.flatMap((s) => s.items.map((i) => i.key));
  const shown = cursor !== null && ids.includes(cursor) ? cursor : null;
  /** The one row in the tab order. */
  const tabStop = shown ?? ids[0] ?? null;
  const items = shownSections.flatMap((s) => s.items);

  const paused = writesPaused(snapshot);
  const look = looker(snapshot?.statuses ?? []);

  const open = (item: Item) => {
    setCursor(item.key);
    setOpened(item.key);
    store.select(item.bead.id);
  };

  /**
   * Puts focus on the first of `keys` still listed (else on the row in the tab order), never scrolling: focus comes back after a
   * write or on Back, and the list stays where the person left it.
   */
  const focusRow = (...keys: Array<string | null>) => {
    const listed = keys.map((key) => key && document.getElementById(needDomId(key))).find(Boolean);
    const target = listed || document.querySelector<HTMLElement>('.bd-nmain[tabindex="0"]');
    target?.focus({ preventScroll: true });
  };

  /**
   * Where focus goes once the next render is on screen (rows that leave are gone by then): the first of these rows still listed.
   * Set by a finished write, Keep, or a closed step; applied after the render, so it never races the render that removes a row.
   */
  const refocus = useRef<Array<string | null> | null>(null);
  useLayoutEffect(() => {
    const keys = refocus.current;
    if (!keys) return;
    refocus.current = null;
    focusRow(...keys);
  });

  /** The row that takes this one's place when it leaves: the next one, else the one before. */
  const neighbourOf = (key: string): string | null => {
    const at = ids.indexOf(key);
    return at < 0 ? null : (ids[at + 1] ?? ids[at - 1] ?? null);
  };

  // Latest values for the document key handler, which is attached once.
  const live = useRef({ ids, cursor: shown, items, state, open });
  live.current = { ids, cursor: shown, items, state, open };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { ids: order, cursor: at, items: list, state: s, open: go } = live.current;
      // Under a bead's detail the view keeps still; the detail has its own keys.
      if (s.detail || s.page !== 'list' || s.overlays.length > 0 || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const focus = focusOf(e.target);
      const action = listKey({ key: e.key, ids: order, cursor: at, focus });
      // No row menu here: every row's actions are on the row.
      if (!action || action.type === 'menu') return;
      e.preventDefault();
      switch (action.type) {
        case 'move': {
          setCursor(action.id);
          const row = document.getElementById(needDomId(action.id));
          row?.focus({ preventScroll: true });
          row?.scrollIntoView?.({ block: 'nearest' });
          break;
        }
        case 'open': {
          const item = list.find((x) => x.key === action.id);
          if (item) go(item);
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

  // Back from a detail: focus returns to the row, unless the person already put it somewhere.
  const hadDetail = useRef(state.detail !== null);
  useEffect(() => {
    const back = hadDetail.current && state.detail === null;
    hadDetail.current = state.detail !== null;
    const active = document.activeElement;
    if (back && (!active || active === document.body)) focusRow(live.current.cursor);
  }, [state.detail]);

  if (!snapshot) return null;
  if (snapshot.beads.length === 0) return <NoBeads />;

  const notice = (text: string) => setNotices((list) => [...list, { id: ++noticeId.current, text }].slice(-MAX_NOTICES));
  const settle = (key: string, text: string) => setSettled((s) => ({ ...s, [key]: text }));
  const setStep = (key: string, step: Step | null) => setSteps((all) => (step ? { ...all, [key]: step } : without(all, key)));
  /** Closes a row's step and puts focus back on the row, so Tab goes on from there. */
  const closeStep = (key: string) => {
    refocus.current = [key];
    setStep(key, null);
  };

  /**
   * Runs one write for a row: busy while it runs (that row only, plus anything else holding one of `locks`, such as a gate two rows
   * share), its failure shown on the row, its step closed when it went through.
   */
  async function run<T>(item: Item, send: () => Promise<WriteOutcome<T>>, done: (value: T) => void, locks: string[] = []) {
    const { key } = item;
    const held = [key, ...locks];
    if (held.some((k) => inflight.current.has(k))) return;
    for (const k of held) inflight.current.add(k);
    setBusy(new Set(inflight.current));
    setFeedback((f) => without(f, key));
    // Chosen now, while the row is still listed: where focus goes if the write takes the row away.
    const neighbour = neighbourOf(key);
    const outcome = await send();
    for (const k of held) inflight.current.delete(k);
    setBusy(new Set(inflight.current));
    if (outcome.kind === 'dropped') return;
    if (outcome.kind === 'ok') {
      done(outcome.value);
      const inRow = document.activeElement?.closest<HTMLElement>('[data-row]')?.dataset.row === key;
      setStep(key, null);
      // Focus was in this row (or fell to the page when the row or its button went): put it on the row, or on the row that took
      // its place. Focus the person moved elsewhere stays there.
      if (inRow || document.activeElement === document.body) refocus.current = [key, neighbour];
      return;
    }
    if (outcome.kind === 'conflict') {
      setFeedback((f) => ({ ...f, [key]: { kind: 'error', error: { code: 'conflict', message: 'This bead changed since it was shown. Check it, then try again.' } } }));
      return;
    }
    setFeedback((f) => ({ ...f, [key]: feedbackOf(outcome) }));
  }

  const resolve = (item: Extract<Item, { section: 'waiting' }>, reason: string) => {
    const gate = targetGate(item.row);
    void run(item, () => store.resolveReview(gate.id, reason.trim() || undefined), (result) => {
      if (result.ok) {
        settle(gate.id, gate.planApproval ? 'Approved. Updating the list.' : 'Resolved. Updating the list.');
        store.notify(gate.planApproval ? `Plan approved for ${shortId(item.bead.id)}.` : `Review resolved for ${shortId(item.bead.id)}.`);
        return;
      }
      const at = result.at === null ? NaN : Date.parse(result.at);
      const who = result.resolvedBy ?? 'someone else';
      settle(gate.id, 'Updating the list.');
      notice(`The ${gate.planApproval ? 'plan approval' : 'review'} on ${shortId(item.bead.id)} was already resolved by ${who}${Number.isFinite(at) ? ` ${ago(Date.now() - at)}` : ''}.`);
    }, [gateLock(gate.id)]);
  };

  const answer = (item: Extract<Item, { section: 'asked' }>, mode: 'respond' | 'dismiss', text: string) => {
    const version = `${item.bead.id}@${item.bead.updatedAt}`;
    const send = () => (mode === 'respond' ? store.respond(item.bead.id, text.trim()) : store.dismissRequest(item.bead.id, text.trim() || undefined));
    void run(item, send, (result) => {
      if (result.ok) {
        store.notify(mode === 'respond' ? `Answer sent to ${shortId(item.bead.id)}.` : `Request ${shortId(item.bead.id)} dismissed.`);
        return;
      }
      settle(version, 'Updating the list.');
      notice(`The request ${shortId(item.bead.id)} was already answered or closed.`);
    });
  };

  const defer = (item: Extract<Item, { section: 'stuck' }>, until: string) => {
    const read = parseDateInput(until, Date.now(), localZone());
    void run(item, () => store.defer(item.bead.id, item.bead.updatedAt, until.trim()), () => {
      store.notify(read.kind === 'ok' ? `${shortId(item.bead.id)} deferred until ${read.label}.` : `${shortId(item.bead.id)} deferred.`);
    });
  };

  const keep = (item: Item) => {
    // The row leaves: focus goes on to the row that takes its place.
    refocus.current = [neighbourOf(item.key)];
    store.keepStuck(item.bead.id);
    store.notify(`${shortId(item.bead.id)} is hidden from Stuck for 7 days.`);
  };

  const stale = describeFreshness(state, now)?.stale ?? false;

  return (
    <div class="bd-list bd-needs" data-stale={stale || undefined}>
      {notices.length > 0 && (
        <div class="bd-nnotes">
          {notices.map((n) => (
            <div key={n.id} class="bd-nnote" role="status">
              <span>{n.text}</span>
              <button type="button" class="bd-nnote-x" aria-label="Hide this note" onClick={() => setNotices((list) => list.filter((x) => x.id !== n.id))}>
                <IconX />
              </button>
            </div>
          ))}
        </div>
      )}
      {paused && total > 0 && <PausedNote reason={paused} />}
      {total === 0 ? (
        <p class="bd-nquiet">Nothing needs you right now.</p>
      ) : shownSections.length === 0 ? (
        <EmptyState tone="neutral" title="Nothing here matches." body="No bead in Needs me has that id, title or reason.">
          <button type="button" class="bd-btn" onClick={() => store.setQuery('')}>
            Clear search
          </button>
        </EmptyState>
      ) : (
        shownSections.map(({ section, items: rows }) => (
          <section key={section} class="bd-nsec" data-section={section} aria-labelledby={`bd-nsec-${section}`}>
            <div class="bd-nsec-h">
              <span class="bd-nsec-ic" data-section={section} aria-hidden="true">
                <SectionIcon section={section} />
              </span>
              <h2 class="bd-nsec-title" id={`bd-nsec-${section}`}>
                {SECTION_TITLES[section]} <span class="bd-n">{rows.length}</span>
              </h2>
              {section === 'changed' && <SeenAll />}
            </div>
            {/* role="list": Safari drops a styled list's semantics without it. */}
            <ul class="bd-nlist" role="list" aria-labelledby={`bd-nsec-${section}`}>
              {rows.map((item) => (
                <NeedRow
                  key={item.key}
                  item={item}
                  now={minute}
                  look={look}
                  cursor={shown === item.key}
                  tabStop={tabStop === item.key}
                  selected={opened === item.key && state.selectedId === item.bead.id}
                  pick={open}
                  onFocus={() => setCursor(item.key)}
                >
                  <RowActions
                    item={item}
                    state={state}
                    step={steps[item.key] ?? null}
                    setStep={(step) => setStep(item.key, step)}
                    closeStep={() => closeStep(item.key)}
                    busy={busy.has(item.key) || (item.section === 'waiting' && busy.has(gateLock(targetGate(item.row).id)))}
                    paused={paused}
                    settled={settledText(item, settled)}
                    feedback={feedback[item.key] ?? null}
                    resolve={resolve}
                    answer={answer}
                    defer={defer}
                    keep={keep}
                  />
                </NeedRow>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

/** What a row says once acted on, while it is still listed. */
function settledText(item: Item, settled: Record<string, string>): string | null {
  if (item.section === 'waiting') return settled[targetGate(item.row).id] ?? null;
  if (item.section === 'asked') return settled[`${item.bead.id}@${item.bead.updatedAt}`] ?? null;
  return null;
}

/** "Mark all seen" for the Changed section: every change, as in Activity. */
function SeenAll() {
  const store = useStoreApi();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      class="bd-link bd-nsec-act"
      disabled={busy}
      aria-busy={busy}
      onClick={() => {
        setBusy(true);
        void store.markAllSeen().finally(() => setBusy(false));
      }}
    >
      Mark all seen
    </button>
  );
}

type NeedRowProps = {
  item: Item;
  now: number;
  look: (status: string) => Look;
  cursor: boolean;
  tabStop: boolean;
  selected: boolean;
  pick(item: Item): void;
  onFocus(): void;
  children: ComponentChildren;
};

/** A list item: the bead and why it is here (focusable; Enter, Space or a click opens it), then its actions beside it. */
function NeedRow({ item, now, look, cursor, tabStop, selected, pick, onFocus, children }: NeedRowProps) {
  const { bead } = item;
  const since = Date.parse(sinceOf(item));
  const id = needDomId(item.key);
  return (
    <li
      class="bd-row bd-nrow"
      data-row={item.key}
      data-section={item.section}
      data-cursor={cursor || undefined}
      data-selected={selected || undefined}
      data-unseen={item.section === 'changed' || undefined}
      onFocusCapture={onFocus}
    >
      <div
        id={id}
        class="bd-nmain"
        role="button"
        tabIndex={tabStop ? 0 : -1}
        aria-labelledby={`${id}-id ${id}-t`}
        aria-describedby={`${id}-why`}
        aria-current={selected || undefined}
        onClick={() => pick(item)}
        onKeyDown={(e) => {
          if ((e.key === ' ' || (e.key === 'Enter' && !composing(e))) && e.target === e.currentTarget) {
            e.preventDefault();
            pick(item);
          }
        }}
      >
        <div class="bd-nrow-top">
          <StatusDot look={look(bead.status)} marker={markerOf(bead.status)} />
          <span class="bd-id" id={`${id}-id`} title={bead.id}>
            {shortId(bead.id)}
          </span>
          <span class="bd-title" id={`${id}-t`} title={bead.title}>
            {bead.title}
          </span>
          {Number.isFinite(since) && (
            <time class="bd-age" dateTime={sinceOf(item)}>
              {shortAgo(now - since)}
            </time>
          )}
        </div>
        <div id={`${id}-why`} class="bd-nwhy">
          <Why item={item} />
        </div>
      </div>
      {children}
    </li>
  );
}

/** Why the row is in its section, in words. */
function Why({ item }: { item: Item }) {
  const state = useStore();
  switch (item.section) {
    case 'waiting': {
      const gate = targetGate(item.row);
      const more = item.row.gates.length - 1;
      return (
        <p class="bd-why" data-section="waiting">
          <span class="bd-tag" data-kind={gate.planApproval ? 'plan' : 'review'}>
            {gate.planApproval ? 'Plan' : 'Review'}
          </span>
          <span class="bd-why-text">
            {gate.reason ? firstLine(gate.reason) : 'No reason given'}
            {gate.createdBy && <span class="bd-why-by">{` from ${gate.createdBy}`}</span>}
          </span>
          {more > 0 && <span class="bd-why-more">{`and ${more} more`}</span>}
        </p>
      );
    }
    case 'asked': {
      const { row, bead } = item;
      const own = row.text.trim() !== bead.title.trim();
      return (
        <>
          {own ? (
            <p class="bd-quote" title={row.text}>
              {row.text}
            </p>
          ) : (
            <p class="bd-why" data-section="asked">
              {bead.createdBy ? `Asked by ${bead.createdBy}` : 'Asked for help'}
            </p>
          )}
          {row.blockers.length > 0 && (
            <p class="bd-why" data-tone="hold">
              <IconWait size={12} />
              <span class="bd-why-text">{`${blockerText(row.blockers, state.snapshot?.beads ?? [], state.gates)}. You can answer once that is done.`}</span>
            </p>
          )}
        </>
      );
    }
    case 'stuck':
      return (
        <p class="bd-why" data-section="stuck">
          <span class="bd-why-text">{item.row.why}</span>
        </p>
      );
    case 'changed':
      return (
        <p class="bd-why" data-section="changed">
          <span class="bd-why-text">{item.row.summary}</span>
        </p>
      );
  }
}

type Mode = Step['mode'];

type RowActionsProps = {
  item: Item;
  state: State;
  step: Step | null;
  setStep(step: Step | null): void;
  closeStep(): void;
  busy: boolean;
  paused: string | null;
  settled: string | null;
  feedback: Feedback;
  resolve(item: Extract<Item, { section: 'waiting' }>, reason: string): void;
  answer(item: Extract<Item, { section: 'asked' }>, mode: 'respond' | 'dismiss', text: string): void;
  defer(item: Extract<Item, { section: 'stuck' }>, until: string): void;
  keep(item: Item): void;
};

/**
 * The row's buttons, or the step one of them opened, and what the last write said. Resolve, Approve and Dismiss act on the first
 * click (the reason is optional); "Add a reason" or "Dismiss with a reason" opens the step that takes one.
 */
function RowActions(props: RowActionsProps) {
  const { item, state, step, setStep, closeStep, busy, paused, settled, feedback } = props;
  if (item.section === 'changed') return null;
  if (settled) {
    return (
      <p class="bd-why bd-nsettled" data-tone="done" role="status">
        {settled}
      </p>
    );
  }
  const message = feedback && (
    <div class="bd-nmsg">
      <WriteMessage feedback={feedback} />
    </div>
  );

  if (step) {
    // While its write runs, the step stays: closing it would bring back buttons that send the same write again.
    const common = { text: step.text, set: (text: string) => setStep({ ...step, text }), cancel: () => !busy && closeStep(), busy, paused, message };
    if (step.mode === 'respond' && item.section === 'asked') return <AnswerStep {...common} send={(text) => props.answer(item, 'respond', text)} />;
    if (step.mode === 'defer' && item.section === 'stuck') return <DeferStep {...common} send={(text) => props.defer(item, text)} />;
    if (step.mode === 'resolve' && item.section === 'waiting') {
      const plan = targetGate(item.row).planApproval;
      return <ReasonStep {...common} action={plan ? 'Approve plan' : 'Resolve review'} hint={plan ? 'Approving lets work on the plan start.' : 'Resolving lets the bead close.'} send={(text) => props.resolve(item, text)} />;
    }
    if (step.mode === 'dismiss' && item.section === 'asked') return <ReasonStep {...common} action="Dismiss request" hint="Closes the request without an answer." send={(text) => props.answer(item, 'dismiss', text)} />;
  }

  const openStep = (mode: Mode) => () => setStep({ mode, text: '' });
  const off = paused !== null || busy;
  const title = paused ?? undefined;
  const buttons: ComponentChildren[] = [];
  if (item.section === 'waiting' && !state.unsupported.has('gates')) {
    const plan = targetGate(item.row).planApproval;
    buttons.push(
      <button key="resolve" type="button" class="bd-btn bd-btn-sm bd-btn-primary" disabled={off} aria-busy={busy || undefined} title={title} onClick={() => props.resolve(item, '')}>
        {plan ? 'Approve' : 'Resolve'}
      </button>,
      <button key="reason" type="button" class="bd-link bd-nreason" disabled={off} title={title} onClick={openStep('resolve')}>
        Add a reason
      </button>,
    );
  }
  // A request that waits on something cannot be closed by answering it, so neither is offered; the reason is on the row.
  if (item.section === 'asked' && item.row.blockers.length === 0 && !state.unsupported.has('human')) {
    buttons.push(
      <button key="respond" type="button" class="bd-btn bd-btn-sm bd-btn-primary" disabled={off} title={title} onClick={openStep('respond')}>
        Respond
      </button>,
      <button key="dismiss" type="button" class="bd-btn bd-btn-sm" disabled={off} aria-busy={busy || undefined} title={title} onClick={() => props.answer(item, 'dismiss', '')}>
        Dismiss
      </button>,
      <button key="reason" type="button" class="bd-link bd-nreason" disabled={off} title={title} onClick={openStep('dismiss')}>
        Dismiss with a reason
      </button>,
    );
  }
  if (item.section === 'stuck') {
    buttons.push(
      <button key="keep" type="button" class="bd-btn bd-btn-sm" disabled={busy} title="Hide it from Stuck for 7 days. Nothing changes in Beads." onClick={() => props.keep(item)}>
        Keep
      </button>,
    );
    if (!state.unsupported.has('defer')) {
      buttons.push(
        <button key="defer" type="button" class="bd-btn bd-btn-sm" disabled={off} title={title} onClick={openStep('defer')}>
          Defer
        </button>,
      );
    }
  }
  if (buttons.length === 0 && !message) return null;
  return (
    <div class="bd-nacts">
      {buttons.length > 0 && <div class="bd-nacts-row">{buttons}</div>}
      {message}
    </div>
  );
}

type StepProps = { text: string; set(text: string): void; cancel(): void; send(text: string): void; busy: boolean; paused: string | null; message: ComponentChildren };

/** Focus on the step's field when it opens. */
function useFirstFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => ref.current?.focus(), []);
  return ref;
}

/** Escape in a step's field closes the step (the list's Escape is for the list). */
const escapeCloses = (cancel: () => void) => (e: KeyboardEvent) => {
  if (e.key !== 'Escape' || composing(e)) return;
  e.preventDefault();
  e.stopPropagation();
  cancel();
};

/** A small step under a row: its field, a line saying what happens, then its buttons. Clicks stay inside the row. */
function StepBox({ children, go, action, primaryOff, busy, paused, cancel, message }: { children: ComponentChildren; go(): void; action: string; primaryOff: boolean; busy: boolean; paused: string | null; cancel(): void; message: ComponentChildren }) {
  return (
    <div class="bd-nstep">
      {children}
      <div class="bd-nstep-acts">
        <button type="button" class="bd-btn bd-btn-sm bd-btn-primary" disabled={primaryOff || busy || paused !== null} aria-busy={busy} title={paused ?? undefined} onClick={go}>
          {action}
        </button>
        <button type="button" class="bd-btn bd-btn-sm" disabled={busy} onClick={cancel}>
          Cancel
        </button>
      </div>
      {message}
    </div>
  );
}

/** Respond: the answer is required; Cmd/Ctrl+Enter sends it. */
function AnswerStep({ text, set, cancel, send, busy, paused, message }: StepProps) {
  const field = useFirstFocus<HTMLTextAreaElement>();
  const go = () => {
    if (text.trim() && !busy && paused === null) send(text);
  };
  return (
    <StepBox go={go} action="Send" primaryOff={!text.trim()} busy={busy} paused={paused} cancel={cancel} message={message}>
      <textarea
        ref={field}
        class="bd-input bd-ntext"
        aria-label="Your answer"
        placeholder="Your answer"
        rows={3}
        value={text}
        disabled={busy}
        onInput={(e) => set(e.currentTarget.value)}
        onKeyDown={(e) => {
          escapeCloses(cancel)(e);
          if (isSubmitKey(e)) {
            e.preventDefault();
            go();
          }
        }}
      />
      <p class="bd-nstep-hint">{`Added as a comment, then the request closes. ${saveKey()} sends.`}</p>
    </StepBox>
  );
}

/** Resolve or Dismiss: an optional reason; Enter goes. */
function ReasonStep({ text, set, cancel, send, busy, paused, message, action, hint }: StepProps & { action: string; hint: string }) {
  const field = useFirstFocus<HTMLInputElement>();
  const go = () => {
    if (!busy && paused === null) send(text);
  };
  return (
    <StepBox go={go} action={action} primaryOff={false} busy={busy} paused={paused} cancel={cancel} message={message}>
      <input
        ref={field}
        type="text"
        class="bd-input"
        aria-label="Reason (optional)"
        placeholder="Reason (optional)"
        value={text}
        disabled={busy}
        onInput={(e) => set(e.currentTarget.value)}
        onKeyDown={(e) => {
          escapeCloses(cancel)(e);
          if (isEnterInInput(e)) {
            e.preventDefault();
            go();
          }
        }}
      />
      <p class="bd-nstep-hint">{hint}</p>
    </StepBox>
  );
}

/** Defer: a date as Beads reads it, with the preview of what it will store. */
function DeferStep({ text, set, cancel, send, busy, paused, message }: StepProps) {
  const go = () => {
    if (text.trim() && !busy && paused === null) send(text);
  };
  return (
    <StepBox go={go} action="Defer" primaryOff={!text.trim()} busy={busy} paused={paused} cancel={cancel} message={message}>
      <div onKeyDown={escapeCloses(cancel)}>
        <DateInput label="Defer until" lead="Until" value={text} onInput={set} onEnter={go} disabled={busy} autoFocus />
      </div>
    </StepBox>
  );
}
