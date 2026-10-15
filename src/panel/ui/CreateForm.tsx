import { useEffect, useRef, useState } from 'preact/hooks';
import { parentOptions, PRIORITY_WORDS, writesPaused } from '../edit';
import { isConfirmKey, isEnterInInput, isSubmitKey, saveKey, trapTab } from '../keyboard';
import { shortId } from '../list';
import { useOverlay, useStore, useStoreApi } from '../store';
import { feedbackOf, PausedNote, readSince, WriteMessage, type Feedback } from './writes';
import { IconPlus, IconX } from './icons';

const FALLBACK_TYPES = ['task', 'bug', 'feature', 'epic', 'chore'];

/** The header's "New bead" button, off while writes are paused. */
export function NewBeadButton() {
  const state = useStore();
  const store = useStoreApi();
  const paused = writesPaused(state.snapshot);
  return (
    <button
      type="button"
      class="bd-iconbtn bd-newbtn"
      aria-label="New bead"
      title={paused ?? 'New bead'}
      disabled={paused !== null || !state.snapshot}
      aria-expanded={state.create !== null}
      onClick={() => (state.create ? store.closeCreate() : store.openCreate())}
    >
      <IconPlus />
    </button>
  );
}

/**
 * A new bead in a few fields: title (required), type, priority (P2), parent (the epic in view), description. The rest is
 * set on the bead once it opens. When Beads did not answer in time the form stays, and only "Create again" sends it again.
 */
export function CreateForm() {
  const state = useStore();
  const store = useStoreApi();
  useOverlay('create', true);
  const snapshot = state.snapshot;
  const start = state.create;
  const types = snapshot?.types.length ? snapshot.types : FALLBACK_TYPES;
  const [title, setTitle] = useState('');
  const [type, setType] = useState(types.includes('task') ? 'task' : types[0]!);
  const [priority, setPriority] = useState(2);
  const [parentId, setParentId] = useState(start?.parentId ?? '');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confirming, setConfirming] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLDivElement>(null);
  // Focus starts in the title and goes back to whatever opened the form when it closes. The page behind the form is inert
  // until the overlay clears, and an inert element ignores focus(), so the return waits for the next frame.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    first.current?.focus();
    return () => {
      requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus();
      });
    };
  }, []);
  // The question swaps the Cancel button for its own, and answering Keep editing removes that one: focus would fall to the
  // page, where no key reaches this dialog. It goes back to the title instead, so Enter keeps meaning what the question asks.
  useEffect(() => {
    if (!form.current || form.current.contains(document.activeElement)) return;
    first.current?.focus();
  }, [confirming]);
  /** A create that may be in: its title, the beads there were, and when the answer came. */
  const [pending, setPending] = useState<{ title: string; ids: ReadonlySet<string>; since: number } | null>(null);
  // It settles: a new bead with this title, made under the panel's own name, shows, so the form closes with "Created"; or
  // the service has read the project since and none does: "It did not save.", and Create is back. A same-title bead an
  // agent made meanwhile is not the panel's.
  useEffect(() => {
    if (!pending || !snapshot) return;
    const made = snapshot.beads.find((b) => !pending.ids.has(b.id) && b.title === pending.title && b.createdBy === snapshot.panelActor);
    if (made) {
      setPending(null);
      store.closeCreate();
      store.notify(`Created ${shortId(made.id)}.`);
    } else if (readSince(snapshot.freshness.localRefreshedAt, pending.since)) {
      setPending(null);
      setFeedback({ kind: 'checked', saved: false });
    }
  }, [snapshot?.beads, snapshot?.freshness.localRefreshedAt, pending]);
  if (!snapshot || !start) return null;

  const paused = writesPaused(snapshot);
  const parents = parentOptions(snapshot.beads, snapshot.statuses, start.parentId);
  const dirty = title.trim() !== '' || description.trim() !== '';
  /** The last create may be in: only "Create again" sends it once more. */
  const maybeIn = feedback?.kind === 'uncertain' && !feedback.saved;
  const submit = async () => {
    if (busy || paused || title.trim() === '') return;
    setBusy(true);
    setFeedback(null);
    setPending(null);
    const ids = new Set(snapshot.beads.map((b) => b.id));
    const outcome = await store.create({ title: title.trim(), type, priority, parentId: parentId || null, description });
    setBusy(false);
    if (outcome.kind === 'uncertain' && !outcome.saved) setPending({ title: title.trim(), ids, since: Date.now() });
    if (outcome.kind === 'uncertain' && outcome.saved) {
      store.closeCreate();
      store.notify('Created. It will show in the list in a moment.');
      return;
    }
    if (outcome.kind !== 'ok') setFeedback(feedbackOf(outcome));
  };
  const cancel = () => (dirty && !confirming ? setConfirming(true) : store.closeCreate());

  return (
    <div class="bd-sheet">
      <div class="bd-scrim" aria-hidden="true" onClick={cancel} />
      {/* No form element here: the host frame is sandboxed without allow-forms, so a submit never fires. Click and keys do the work. */}
      <div
        ref={form}
        class="bd-create"
        role="dialog"
        aria-modal="true"
        aria-label="New bead"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancel();
          } else if (e.key === 'Tab') {
            // Tab stays inside the form while it is open.
            trapTab(e, form.current);
          } else if (confirming) {
            // While "Discard this bead?" shows, Enter says yes; it never creates.
            if (isConfirmKey(e)) {
              e.preventDefault();
              store.closeCreate();
            }
          } else if (isSubmitKey(e) || isEnterInInput(e)) {
            e.preventDefault();
            if (!maybeIn) void submit();
          }
        }}
      >
        <div class="bd-create-head">
          <b>New bead</b>
          <button type="button" class="bd-iconbtn bd-iconbtn-sm" aria-label="Close" onClick={cancel}>
            <IconX />
          </button>
        </div>
        {paused && <PausedNote reason={paused} />}
        <label class="bd-cf">
          <span>Title</span>
          <input ref={first} class="bd-input" aria-label="Title" required placeholder="What needs doing" value={title} readOnly={busy} onInput={(e) => setTitle(e.currentTarget.value)} />
        </label>
        <div class="bd-cf-row">
          <label class="bd-cf">
            <span>Type</span>
            <select class="bd-select" aria-label="Type" value={type} disabled={busy} onChange={(e) => setType(e.currentTarget.value)}>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t[0]!.toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label class="bd-cf">
            <span>Priority</span>
            <select class="bd-select" aria-label="Priority" value={String(priority)} disabled={busy} onChange={(e) => setPriority(Number(e.currentTarget.value))}>
              {PRIORITY_WORDS.map((word, p) => (
                <option key={p} value={String(p)}>{`P${p} ${word}`}</option>
              ))}
            </select>
          </label>
        </div>
        <label class="bd-cf">
          <span>Parent</span>
          <select class="bd-select" aria-label="Parent" value={parentId} disabled={busy} onChange={(e) => setParentId(e.currentTarget.value)}>
            <option value="">No parent</option>
            {parents.map((b) => (
              <option key={b.id} value={b.id}>{`${shortId(b.id)}  ${b.title}`}</option>
            ))}
          </select>
        </label>
        <label class="bd-cf">
          <span>Description</span>
          <textarea class="bd-ta bd-cf-ta" aria-label="Description" rows={4} placeholder="Optional. Markdown works." value={description} readOnly={busy} onInput={(e) => setDescription(e.currentTarget.value)} />
        </label>
        <WriteMessage feedback={feedback} />
        {confirming ? (
          <div class="bd-confirm" role="alertdialog" aria-label="Discard this bead?">
            <span>Discard this bead?</span>
            <button type="button" class="bd-btn bd-btn-sm" onClick={() => setConfirming(false)}>
              Keep editing
            </button>
            <button type="button" class="bd-btn bd-btn-sm" data-tone="danger" onClick={() => store.closeCreate()}>
              Discard
            </button>
          </div>
        ) : (
          <div class="bd-edacts">
            <span class="bd-edhint">{`${saveKey()} creates`}</span>
            <button type="button" class="bd-btn bd-btn-sm" onClick={cancel}>
              Cancel
            </button>
            {maybeIn && (
              <button type="button" class="bd-btn bd-btn-sm" disabled={busy || paused !== null || title.trim() === ''} title={paused ?? 'It may already exist. Make it once more.'} onClick={() => void submit()}>
                Create again
              </button>
            )}
            <button type="button" class="bd-btn bd-btn-sm bd-btn-primary" disabled={busy || maybeIn || paused !== null || title.trim() === ''} title={paused ?? undefined} onClick={() => void submit()}>
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
