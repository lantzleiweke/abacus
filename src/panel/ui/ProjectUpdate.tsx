import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { UpdateFailed } from '../../shared/types';
import { useStore, useStoreApi } from '../store';
import { Thread } from './EmptyState';

export const UPDATE_TITLE = 'This project needs a one-time update for the newer Beads.';
const SYNC_WAIT = 'Wait for the sync to finish, then try again.';
const REREAD = 'Reading the project again.';

/**
 * Where the block stands. `asking`: the confirm is open. `checking`: the project is being read again. The rest is derived, not kept:
 * the update runs as a job on the service's side, so whether it is running, ended in a failure, or may or may not have run comes from the
 * snapshot (`freshness.schemaUpdateJob`) and survives a remount, another panel, and a project switch.
 */
type Phase = 'idle' | 'asking' | 'checking';
/** `again`: the last try found Beads busy, so the action sends again at once (the person already confirmed it). */
type Note = { tone: 'error' | 'info' | 'ok'; text: string; detail?: string; again?: boolean };
type Focus = 'go' | 'cancel' | 'note';

/** The confirm: what the update does, in plain words, before anything is sent. Escape answers it, except while it runs. */
function UpdateConsent({ busy, onCancel, onConfirm }: { busy: boolean; onCancel(): void; onConfirm(): void }) {
  return (
    <div
      class="bd-pm-ask bd-upd-ask"
      role="alertdialog"
      aria-labelledby="bd-upd-ask-t"
      aria-describedby="bd-upd-ask-d"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        if (!busy) onCancel();
      }}
    >
      <p class="bd-pm-ask-t" id="bd-upd-ask-t">
        Update this project?
      </p>
      <div class="bd-pm-ask-d" id="bd-upd-ask-d">
        <p>Beads updates this project's data to the new format. This happens once.</p>
        <p>Your beads themselves don't change.</p>
        <p>Tools that use an older Beads may not open this project afterwards.</p>
      </div>
      <div class="bd-pm-ask-acts">
        <button type="button" class="bd-btn bd-btn-sm" data-focus="cancel" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {/* aria-disabled while it runs: focus stays here, and a second press sends nothing. */}
        <button type="button" class="bd-btn bd-btn-sm bd-btn-primary" data-focus="go" aria-busy={busy || undefined} aria-disabled={busy || undefined} onClick={onConfirm}>
          {busy && <span class="bd-spin" aria-hidden="true" />}
          {busy ? 'Updating…' : 'Update'}
        </button>
      </div>
    </div>
  );
}

/** The list that takes this block's place once the project is updated: focus goes there, not to the page. It may take a moment to appear. */
function focusList(attempts = 20): void {
  const active = document.activeElement;
  // The person moved on by themselves.
  if (active && active !== document.body) return;
  const list = document.querySelector<HTMLElement>('.bd-body [role="listbox"]');
  if (list) {
    list.focus({ preventScroll: true });
    return;
  }
  if (attempts > 0) setTimeout(() => focusList(attempts - 1), 150);
}

/** What a failed job says, in the panel's own terms: the note, and whether the person may only check again. */
function failureNote(job: UpdateFailed): { note: Note; unsure: boolean } {
  if (job.code === 'uncertain' || job.saved) {
    const said = job.saved ? "The update may have finished, but Beads didn't confirm it." : job.message || "Beads didn't say whether the update finished.";
    return { note: { tone: 'info', text: `${said} ${REREAD}` }, unsure: true };
  }
  return {
    note: { tone: 'error', text: job.code === 'sync-running' ? SYNC_WAIT : job.message, ...(job.detail ? { detail: job.detail } : {}), ...(job.code === 'busy' ? { again: true } : {}) },
    unsure: false,
  };
}

/**
 * A project made with an older Beads, in place of the list: the panel cannot read it until the person updates it, which changes the
 * project's Beads data, so it runs only from the confirm that says so. One status line, always there, is the live region.
 * The update is a background job: pressing Update starts it and the block follows it through the snapshot.
 */
export function ProjectUpdate() {
  const store = useStoreApi();
  const state = useStore();
  const raw = state.snapshot?.freshness.localErrorDetail ?? null;
  const job = state.snapshot?.freshness.schemaUpdateJob ?? null;
  const kept = state.directory !== null ? state.sharedUpdates[state.directory] : undefined;
  const [phase, setPhase] = useState<Phase>('idle');
  const [submitting, setSubmitting] = useState(false);
  /** The failure (by the time it ended) the person has already seen and moved past. */
  const [seen, setSeen] = useState<string | null>(null);
  /** The note for what happened to the request itself (refused at once, or its answer was lost). */
  const [note, setNote] = useState<Note | null>(null);
  const [lost, setLost] = useState(false);
  const alive = useRef(true);
  const box = useRef<HTMLElement>(null);
  const focusNext = useRef<Focus | null>(null);
  /** True while focus is inside the block, kept by the focus events: a focused element that is removed leaves nothing to ask. */
  const holds = useRef(false);
  const lastEnd = useRef<string | null>(job?.kind === 'failed' ? job.at : null);

  const running = submitting || job?.kind === 'running';
  const failure = job?.kind === 'failed' && job.at !== seen ? job : null;
  const said = failure ? failureNote(failure) : null;
  const shared = kept ?? (failure?.code === 'update-blocked-shared' ? { message: failure.message, ...(failure.detail ? { detail: failure.detail } : {}) } : null);
  const unsure = !shared && !running && (lost || said?.unsure === true);
  const shownNote: Note | null = shared ? { tone: 'error', text: shared.message, ...(shared.detail ? { detail: shared.detail } : {}) } : running ? null : (note ?? said?.note ?? null);

  // A new failure arrived while the person watched the update: focus goes to what they can act on.
  useLayoutEffect(() => {
    const end = job?.kind === 'failed' ? job.at : null;
    if (end === lastEnd.current) return;
    lastEnd.current = end;
    if (end !== null) focusNext.current = unsure || shared ? 'note' : 'go';
  });

  useLayoutEffect(() => {
    const want = focusNext.current;
    if (!want) return;
    focusNext.current = null;
    box.current?.querySelector<HTMLElement>(`[data-focus="${want}"]`)?.focus();
  });

  useEffect(
    () => () => {
      alive.current = false;
      // Updated: the list takes this block's place. Focus that was in here goes to the list, not to the page.
      if (holds.current) setTimeout(focusList, 0);
    },
    [],
  );

  const send = async () => {
    if (running) return;
    // A failure shown before is answered by this try: whatever it ends in is new.
    setSeen(job?.kind === 'failed' ? job.at : seen);
    setSubmitting(true);
    setNote(null);
    setLost(false);
    const outcome = await store.updateProject();
    if (!alive.current) return;
    setSubmitting(false);
    if (outcome.kind === 'dropped') return;
    setPhase('idle');
    if (outcome.kind === 'ok') {
      // Started. The job is in the snapshot by now: running, or already ended in a failure the block shows, or the project reads again.
      return;
    }
    if (outcome.kind === 'uncertain') {
      // The answer was lost: it may or may not have started. The project is being read again; never sent again by itself.
      const text = outcome.saved ? "The update may have finished, but Beads didn't confirm it." : outcome.message || "Beads didn't say whether the update finished.";
      setLost(true);
      setNote({ tone: 'info', text: `${text} ${REREAD}` });
      focusNext.current = 'note';
    } else if (outcome.kind === 'error') {
      const { code, message, detail } = outcome.error;
      setNote({ tone: 'error', text: code === 'sync-running' ? SYNC_WAIT : message, ...(detail ? { detail } : {}), ...(code === 'busy' ? { again: true } : {}) });
      focusNext.current = 'go';
    }
  };

  const check = async () => {
    setPhase('checking');
    await store.checkProject();
    if (!alive.current) return;
    setPhase('idle');
    const now = store.get().snapshot?.freshness.schemaUpdateJob ?? null;
    // Still going: the block says so by itself.
    if (now?.kind === 'running') return;
    // Still here, so the project still reads as made with the older Beads: the update may be offered again.
    setSeen(now?.kind === 'failed' ? now.at : seen);
    setLost(false);
    setNote({ tone: 'info', text: 'This project still needs the update.' });
    focusNext.current = 'go';
  };

  const asking = !shared && (running || phase === 'asking');
  const say = running ? 'Updating this project. This can take a minute or two.' : phase === 'checking' ? 'Reading the project again…' : '';
  const detail = shownNote?.detail ?? raw;

  return (
    <section
      ref={box}
      class="bd-empty bd-upd"
      data-tone="ask"
      aria-labelledby="bd-upd-t"
      onFocusIn={() => {
        holds.current = true;
      }}
      onFocusOut={(e) => {
        // Focus that leaves for another element is not here any more; focus that just disappears (the block going away) stays counted.
        const to = (e as FocusEvent).relatedTarget as Node | null;
        if (to && !box.current?.contains(to)) holds.current = false;
      }}
    >
      <Thread tone="ask" />
      <h2 class="bd-empty-title" id="bd-upd-t">
        {UPDATE_TITLE}
      </h2>
      <p class="bd-empty-body">It was made with an older version of Beads, and Abacus can't read its beads until it's updated.</p>
      <div class="bd-upd-acts">
        {shownNote && (
          <p class="bd-pm-note bd-upd-note" data-tone={shownNote.tone} data-focus="note" tabIndex={-1} role={shownNote.tone === 'error' ? 'alert' : 'status'}>
            {shownNote.text}
          </p>
        )}
        {asking ? (
          <UpdateConsent
            busy={running}
            onCancel={() => {
              setPhase('idle');
              focusNext.current = 'go';
            }}
            onConfirm={() => void send()}
          />
        ) : unsure || phase === 'checking' ? (
          <button type="button" class="bd-btn bd-btn-primary" data-focus="go" aria-busy={phase === 'checking' || undefined} aria-disabled={phase === 'checking' || undefined} onClick={() => phase !== 'checking' && void check()}>
            {phase === 'checking' && <span class="bd-spin" aria-hidden="true" />}
            Check again
          </button>
        ) : shared ? null : shownNote?.again ? (
          <button type="button" class="bd-btn bd-btn-primary" data-focus="go" onClick={() => void send()}>
            Try again
          </button>
        ) : (
          <button
            type="button"
            class="bd-btn bd-btn-primary"
            data-focus="go"
            onClick={() => {
              setNote(null);
              setSeen(job?.kind === 'failed' ? job.at : seen);
              setPhase('asking');
              focusNext.current = 'cancel';
            }}
          >
            Update project
          </button>
        )}
        <p class="bd-upd-say" role="status">
          {say}
        </p>
        {detail && (
          <details class="bd-upd-more">
            <summary>Details</summary>
            <pre class="bd-upd-raw">{detail}</pre>
          </details>
        )}
      </div>
    </section>
  );
}
