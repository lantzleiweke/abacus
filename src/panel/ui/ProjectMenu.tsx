import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { EventsStatusResult } from '../../shared/api';
import type { LiveState } from '../../shared/types';
import { isEnterInInput } from '../keyboard';
import { MAX_STALE_DAYS, useStore, useStoreApi, type PanelError } from '../store';
import { IconChevron, IconFolder } from './icons';
import { Popover, usePopover } from './popover';

/** Whole days from 1 to the most the panel keeps, or null for anything else. */
export function readDays(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_STALE_DAYS ? n : null;
}

/** How long work in progress may go without an update before Needs me lists it under Stuck. Saved as it is typed, when it reads. */
function StuckDays() {
  const store = useStoreApi();
  const saved = useStore().settings.staleDays;
  const [text, setText] = useState(String(saved));
  const bad = readDays(text) === null;
  const take = (next: string) => {
    setText(next);
    const days = readDays(next);
    if (days !== null) store.setStaleDays(days);
  };
  return (
    <div class="bd-pm-set">
      <div class="bd-pm-row">
        <label class="bd-pm-label" for="bd-pm-days">
          Stuck after
        </label>
        <input
          id="bd-pm-days"
          type="text"
          inputMode="numeric"
          role="spinbutton"
          aria-valuemin={1}
          aria-valuemax={MAX_STALE_DAYS}
          aria-valuenow={readDays(text) ?? saved}
          class="bd-input bd-pm-days"
          value={text}
          aria-invalid={bad || undefined}
          aria-describedby="bd-pm-days-hint"
          onInput={(e) => take(e.currentTarget.value)}
          onKeyDown={(e) => {
            const days = readDays(text) ?? saved;
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              take(String(Math.min(MAX_STALE_DAYS, Math.max(1, days + (e.key === 'ArrowUp' ? 1 : -1)))));
            } else if (isEnterInInput(e) && bad) {
              e.preventDefault();
              setText(String(saved));
            }
          }}
          onBlur={() => {
            if (bad) setText(String(saved));
          }}
        />
        <span class="bd-pm-unit">{readDays(text) === 1 ? 'day' : 'days'}</span>
      </div>
      {bad ? (
        <p class="bd-fieldmsg" id="bd-pm-days-hint" role="alert">{`Enter a whole number of days from 1 to ${MAX_STALE_DAYS}.`}</p>
      ) : (
        <p class="bd-fieldmsg" data-tone="quiet" id="bd-pm-days-hint">
          Work in progress with no update for this long shows under Stuck in Needs me. Kept on this computer, for this project.
        </p>
      )}
    </div>
  );
}

const SYNC_WAIT = 'Wait for the sync to finish, then try again.';
const REGULAR = 'the panel checks for changes every few seconds';

/** What Settings knows about live updates: being read, read, or not readable (`error` is why, null when Beads could not say). */
type LiveRead = { kind: 'reading' } | { kind: 'status'; status: EventsStatusResult } | { kind: 'unknown'; error: PanelError | null };

const readOf = (status: EventsStatusResult): LiveRead => (status.journal === 'unknown' ? { kind: 'unknown', error: null } : { kind: 'status', status });

/** The line under "On": what the follower is doing, in plain words. */
function onLine(live: LiveState): { tone: 'ok' | 'warn' | 'err'; text: string } {
  if (live === 'following') return { tone: 'ok', text: 'Following changes as they happen.' };
  if (live === 'backoff') return { tone: 'warn', text: `Reconnecting. Until then, ${REGULAR}.` };
  if (live === 'failed') return { tone: 'err', text: `Not working right now, so ${REGULAR}.` };
  return { tone: 'warn', text: `Starting. Until then, ${REGULAR}.` };
}

type Note = { tone: 'error' | 'info'; text: string };

/**
 * An answer to Turn on that arrived after the menu closed (an outside click, Escape from another field): kept per store and
 * shown the next time the menu opens on the same project, so a refusal or an unconfirmed change is never lost without a word.
 */
const carried = new WeakMap<object, { directory: string; note: Note }>();

/** The confirm for Turn on: says what changes, and where, before anything is sent. Escape answers it, except while it runs. */
function LiveConsent({ busy, onCancel, onConfirm }: { busy: boolean; onCancel(): void; onConfirm(): void }) {
  return (
    <div
      class="bd-pm-ask"
      role="alertdialog"
      aria-labelledby="bd-pm-ask-t"
      aria-describedby="bd-pm-ask-d"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        // Escape answers the question, not the whole menu; while the change runs it does nothing, so its answer is seen.
        e.preventDefault();
        e.stopPropagation();
        if (!busy) onCancel();
      }}
    >
      <p class="bd-pm-ask-t" id="bd-pm-ask-t">
        Turn on live updates?
      </p>
      <div class="bd-pm-ask-d" id="bd-pm-ask-d">
        <p>Beads will keep a log of changes on this computer for 7 days.</p>
        <p>
          This changes the project's settings file, <span class="bd-pm-file">.beads/config.yaml</span>, which is shared with your team if you commit it.
        </p>
      </div>
      <div class="bd-pm-ask-acts">
        <button type="button" class="bd-btn bd-btn-sm" data-focus="cancel" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {/* aria-disabled while it runs: focus stays here, and a second press sends nothing. */}
        <button type="button" class="bd-btn bd-btn-sm bd-btn-primary" aria-busy={busy || undefined} aria-disabled={busy || undefined} onClick={onConfirm}>
          {busy ? 'Turning on…' : 'Turn on'}
        </button>
      </div>
    </div>
  );
}

/**
 * Live updates for this project. The one setting the panel writes to Beads: it changes the project's `.beads/config.yaml`, so it
 * runs only from the confirm that says so, and never by itself. One status line, always there, says where it stands: it is a
 * live region, and it takes focus when the control that had it goes away (Try again, the end of Turn on).
 */
function LiveUpdates() {
  const store = useStoreApi();
  const state = useStore();
  const capable = state.capabilities.eventsJournal && !state.unsupported.has('events');
  const [read, setRead] = useState<LiveRead>({ kind: 'reading' });
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(() => {
    const held = carried.get(store);
    if (!held || held.directory !== state.directory) return null;
    carried.delete(store);
    return held.note;
  });
  const alive = useRef(true);
  const focusNext = useRef<'turn-on' | 'cancel' | 'state' | 'note' | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => () => void (alive.current = false), []);
  useLayoutEffect(() => {
    const want = focusNext.current;
    if (!want) return;
    focusNext.current = null;
    box.current?.querySelector<HTMLElement>(`[data-focus="${want}"]`)?.focus();
  });

  const load = async () => {
    setRead({ kind: 'reading' });
    const outcome = await store.readEventsStatus();
    if (!alive.current || outcome.kind === 'dropped') return;
    const next: LiveRead = outcome.kind === 'ok' ? readOf(outcome.value) : { kind: 'unknown', error: outcome.error };
    // A read that finds it on settles an unconfirmed Turn on: its "may be on" note has said all it can.
    if (next.kind === 'status' && next.status.journal === 'on') setNote((n) => (n?.tone === 'info' ? null : n));
    setRead(next);
  };
  useEffect(() => {
    if (capable) void load();
  }, [capable]);

  const enable = async () => {
    if (busy) return;
    const directory = state.directory;
    setBusy(true);
    setNote(null);
    const outcome = await store.enableEvents();
    if (outcome.kind === 'dropped') return;
    const said: Note | null =
      outcome.kind === 'uncertain'
        ? { tone: 'info', text: outcome.message || "Live updates may be on now, but Beads didn't confirm it." }
        : outcome.kind === 'error'
          ? { tone: 'error', text: outcome.error.code === 'sync-running' ? SYNC_WAIT : outcome.error.message }
          : null;
    if (!alive.current) {
      if (said && directory !== null) carried.set(store, { directory, note: said });
      return;
    }
    setBusy(false);
    setAsking(false);
    setNote(said);
    if (outcome.kind === 'ok') {
      setRead(readOf(outcome.value.status));
      focusNext.current = 'state';
    } else if (outcome.kind === 'uncertain') {
      // The service's own words say what is known; the status read straight after says where it stands.
      setRead(outcome.status ? readOf(outcome.status) : { kind: 'unknown', error: null });
      focusNext.current = 'note';
    } else if (outcome.kind === 'error') {
      focusNext.current = 'turn-on';
    } else {
      focusNext.current = 'state';
      void load();
    }
  };

  const retry = () => {
    // The button goes while it reads: the status line, which stays, takes focus and says the answer.
    focusNext.current = 'state';
    void load();
  };

  const status = read.kind === 'status' ? read.status : null;
  const unavailable = !capable || status?.available === false;
  const on = !unavailable && status?.journal === 'on';
  const off = !unavailable && status?.journal === 'off';
  const line = on && status ? onLine(status.live) : null;
  const reading = capable && read.kind === 'reading';
  const word = unavailable ? null : on ? 'On' : off ? 'Off' : reading ? 'Checking' : null;
  const say = unavailable
    ? `Needs a newer version of Beads (1.3 or later). Until then, ${REGULAR}.`
    : reading
      ? 'Checking…'
      : read.kind === 'unknown'
        ? read.error?.code === 'sync-running'
          ? SYNC_WAIT
          : "Couldn't read this setting for the project."
        : line
          ? line.text
          : `Off for this project, so ${REGULAR}. Turn it on to see changes as soon as they happen.`;

  return (
    <div ref={box} class="bd-pm-set bd-pm-live" role="group" aria-labelledby="bd-pm-live-t" aria-busy={reading || undefined}>
      <div class="bd-pm-row">
        <span class="bd-pm-label" id="bd-pm-live-t">
          Live updates
        </span>
        {word && (
          <span class="bd-pm-state" data-tone={line?.tone ?? (on ? 'ok' : 'off')}>
            <span class="bd-pm-dot" aria-hidden="true" />
            {word}
          </span>
        )}
      </div>
      {note && (
        <p class="bd-pm-note" data-tone={note.tone} data-focus="note" tabIndex={-1} role={note.tone === 'error' ? 'alert' : 'status'}>
          {note.text}
        </p>
      )}
      <p class="bd-pm-say" data-focus="state" tabIndex={-1} role="status">
        {say}
      </p>
      {!reading && read.kind === 'unknown' && !unavailable && (
        <div>
          <button type="button" class="bd-btn bd-btn-sm" onClick={retry}>
            Try again
          </button>
        </div>
      )}
      {!reading &&
        off &&
        (asking ? (
          <LiveConsent
            busy={busy}
            onCancel={() => {
              setAsking(false);
              focusNext.current = 'turn-on';
            }}
            onConfirm={() => void enable()}
          />
        ) : (
          <div>
            <button
              type="button"
              class="bd-btn bd-btn-sm"
              data-focus="turn-on"
              onClick={() => {
                setNote(null);
                setAsking(true);
                focusNext.current = 'cancel';
              }}
            >
              Turn on live updates
            </button>
          </div>
        ))}
    </div>
  );
}

/**
 * The project's name in the header, which opens the project menu: what is set for this project in this panel. Stuck days is
 * the panel's own, kept on this computer. Live updates is the one setting written to Beads, and only from its confirm.
 */
export function ProjectMenu({ name, title }: { name: string; title?: string }) {
  const popover = usePopover(false);
  const store = useStoreApi();
  const { unsupported, directory } = useStore();
  // A Beads too old to list memories has no page to open.
  const memories = !unsupported.has('memories');
  return (
    <div class="bd-popwrap bd-pm">
      <button type="button" class="bd-proj bd-projbtn" title={title} aria-haspopup="dialog" aria-expanded={popover.open} onClick={popover.toggle}>
        <IconFolder />
        <span class="bd-proj-name">{name}</span>
        <IconChevron />
      </button>
      {popover.open && (
        <Popover label="Project menu" onClose={popover.close}>
          <div class="bd-pm-body">
            {memories && (
              <button
                type="button"
                class="bd-pm-go"
                aria-labelledby="bd-pm-mem-t"
                aria-describedby="bd-pm-mem-d"
                data-autofocus
                onClick={() => {
                  popover.close();
                  store.setPage('memories');
                }}
              >
                <span class="bd-pm-go-t" id="bd-pm-mem-t">
                  Memories
                </span>
                <span class="bd-pm-go-d" id="bd-pm-mem-d">
                  What every agent session here starts with
                </span>
                <IconChevron />
              </button>
            )}
            <p class="bd-pm-h">Settings</p>
            <StuckDays />
            <LiveUpdates key={directory} />
          </div>
        </Popover>
      )}
    </div>
  );
}
