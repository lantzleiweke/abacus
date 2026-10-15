import type { ComponentChildren } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Bead, BeadPatch } from '../../shared/types';
import { COMMENT_ADDED } from '../gates';
import { composing, isSubmitKey } from '../keyboard';
import { useStore, useStoreApi, type WriteOutcome } from '../store';
import { readSince } from './writes';

// The close dialog, shared by the status menu and an epic's Close epic. Kept apart from the editors (and the markdown renderer
// they load), so the list can offer it without them.

/** The typed close reason and comment of a bead, kept as drafts so a closed dialog, another bead or a refusal never loses them. */
const CLOSE_DRAFTS = ['closeReason', 'closeComment'] as const;

/** Said while a close that carried a comment may have added it, until the project has been read again. */
export const CHECKING_COMMENT = 'Checking whether your comment went in.';

/** The comments the panel posted on `b` with exactly `text` (any author when the panel's name is not known). */
const panelCount = (b: Bead | null, text: string, actor: string) => (b ? b.comments.filter((c) => c.text === text && (!actor || c.author === actor)).length : 0);

/**
 * A close's reason and comment, read from the drafts and written back as they are typed. Beads adds the comment before it closes, and
 * keeps it when the close fails or does not answer, so a comment is sent once: the draft remembers how many such comments the bead
 * had when it was first sent (`base`) and when an answer left it unknown (`original`, a time). Once the bead shows one more, the
 * comment is in: it leaves the draft and no retry carries it. While it is unknown, the dialog waits for the next read.
 */
export function useCloseDrafts(bead: Bead) {
  const store = useStoreApi();
  const snapshot = useStore().snapshot;
  const id = bead.id;
  const read = () => ({ reason: store.draft(id, 'closeReason')?.text ?? '', comment: store.draft(id, 'closeComment')?.text ?? '' });
  const [text, setText] = useState(read);
  const set = (field: 'reason' | 'comment', value: string) => {
    setText((t) => ({ ...t, [field]: value }));
    const key = field === 'reason' ? 'closeReason' : 'closeComment';
    const was = store.draft(id, key);
    // A changed comment is a new one, nothing of it sent; the same words (spaces aside) keep what is known about the sent one.
    const same = field === 'comment' && was !== null && was.text.trim() === value.trim();
    store.setDraft(id, key, value.trim() ? (same ? { ...was, text: value } : { text: value }) : null);
  };
  const drop = (which: 'comment' | 'all' = 'all') => {
    for (const field of which === 'comment' ? (['closeComment'] as const) : CLOSE_DRAFTS) store.setDraft(id, field, null);
    setText((t) => (which === 'comment' ? { ...t, comment: '' } : { reason: '', comment: '' }));
  };
  /** The panel's comments with `text` on the freshest copy known: the shown bead, the list's, or `also` (the one a write goes to). */
  const posted = (body: string, also: Bead | null = null) => {
    const snap = store.get().snapshot;
    const actor = snap?.panelActor ?? '';
    const listed = snap?.beads.find((b) => b.id === id) ?? null;
    return Math.max(panelCount(bead, body, actor), panelCount(listed, body, actor), panelCount(also, body, actor));
  };
  const sent = () => {
    const d = store.draft(id, 'closeComment');
    return d?.base === undefined ? null : { body: d.text.trim(), before: Number(d.base), at: d.original === undefined ? null : Number(d.original) };
  };
  const listedComments = snapshot?.beads.find((b) => b.id === id)?.comments;
  useEffect(() => {
    const s = sent();
    if (s && posted(s.body) > s.before) drop('comment');
  }, [id, bead.comments, listedComments]);
  const s = sent();
  return {
    ...text,
    setReason: (value: string) => set('reason', value),
    setComment: (value: string) => set('comment', value),
    /** Reads them again (another bead, or the dialog opening again). */
    load: () => setText(read()),
    /** Lets go of `which`, or both. */
    drop,
    /** A close that may have added the comment has not been checked yet: nothing is sent until the project is read again. */
    checking: s?.at != null && !readSince(snapshot?.freshness.localRefreshedAt ?? null, s.at),
    /** Before a close is sent: notes how many such comments the bead has, the first time this comment goes. */
    sending: () => {
      const d = store.draft(id, 'closeComment');
      if (!d || !d.text.trim()) return;
      store.setDraft(id, 'closeComment', { text: d.text, base: d.base ?? String(posted(d.text.trim())) });
    },
    /** The close came back without saying whether it went in. */
    uncertain: () => {
      const d = store.draft(id, 'closeComment');
      if (d?.base !== undefined) store.setDraft(id, 'closeComment', { ...d, original: String(Date.now()) });
    },
    /** The comment to send with a close on `b`: none once it is on the bead. Read at send time, so a retry sees what is there now. */
    commentFor: (b: Bead): string => {
      const d = store.draft(id, 'closeComment');
      const body = d?.text.trim() ?? '';
      if (!body) return '';
      return d?.base !== undefined && posted(body, b) > Number(d.base) ? '' : body;
    },
  };
}

/** The patch a close sends: the status, with the reason and the comment only when typed. */
export const closePatch = (status: string, reason: string, comment: string): BeadPatch => ({
  status,
  ...(reason.trim() ? { closeReason: reason.trim() } : {}),
  ...(comment.trim() ? { closeComment: comment.trim() } : {}),
});

/** Whether a refused close still added its comment (Beads adds it first and keeps it). */
export const commentWentIn = (outcome: WriteOutcome<unknown>): boolean => outcome.kind === 'error' && outcome.error.message.startsWith(COMMENT_ADDED);

type CloseFieldsProps = {
  /** What the close is asking, over its fields ("Why is it closed?"). */
  question: string;
  action: string;
  reason: string;
  comment: string;
  setReason(text: string): void;
  setComment(text: string): void;
  busy: boolean;
  disabled: string | null;
  send(): void;
  /** Cancel, once the person agreed to let typed text go. */
  cancel(): void;
  /** `step` sits in the page (an epic's row); the default sits in a popover. */
  variant?: 'pop' | 'step';
  /** Escape: closes, keeping what is typed for next time. */
  onEscape?(): void;
  /** Focus the reason on opening (a popover does this itself). */
  autofocus?: boolean;
  message?: ComponentChildren;
};

/**
 * The close dialog: a one-line reason (Enter closes) and an optional comment, added before the close (Cmd/Ctrl+Enter closes from
 * there, Enter is a new line). Fields are read-only while it saves. Cancel with typed text asks first. Never a form.
 */
export function CloseFields({ question, action, reason, comment, setReason, setComment, busy, disabled, send, cancel, variant = 'pop', onEscape, autofocus, message }: CloseFieldsProps) {
  const id = useId();
  const [asking, setAsking] = useState(false);
  const typed = reason.trim() !== '' || comment.trim() !== '';
  const go = () => {
    if (!busy && disabled === null) send();
  };
  const box = useRef<HTMLTextAreaElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const why = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autofocus) why.current?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    if (el.scrollHeight > 0) el.style.height = `${Math.min(el.scrollHeight + 2, 160)}px`;
  }, [comment]);
  // The question takes Cancel's place: focus goes to it, and back to the comment when the person keeps editing.
  const asked = useRef(false);
  useEffect(() => {
    if (asking) keep.current?.focus({ preventScroll: true });
    else if (asked.current) box.current?.focus({ preventScroll: true });
    asked.current = asking;
  }, [asking]);
  return (
    <div
      class={variant === 'step' ? 'bd-nstep bd-closeform' : 'bd-popform bd-closeform'}
      role="group"
      aria-label={question}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || composing(e)) return;
        if (asking) {
          e.preventDefault();
          e.stopPropagation();
          setAsking(false);
        } else if (onEscape) {
          e.preventDefault();
          e.stopPropagation();
          onEscape();
        }
      }}
    >
      <p class="bd-closeq">{question}</p>
      <label class="bd-flab" for={`${id}-why`}>
        Reason (optional)
      </label>
      <input
        ref={why}
        id={`${id}-why`}
        class="bd-input"
        aria-label="Close reason (optional)"
        placeholder="For example the commit"
        data-autofocus
        value={reason}
        readOnly={busy}
        onInput={(e) => setReason(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || composing(e) || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          go();
        }}
      />
      <label class="bd-flab" for={`${id}-note`}>
        Comment (optional)
      </label>
      <textarea
        ref={box}
        id={`${id}-note`}
        class="bd-input bd-ntext bd-closenote"
        placeholder="Added to the comments before it closes"
        rows={2}
        value={comment}
        readOnly={busy}
        onInput={(e) => setComment(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (!isSubmitKey(e)) return;
          e.preventDefault();
          go();
        }}
      />
      {asking ? (
        <div class="bd-confirm" role="alertdialog" aria-label="Discard what you typed?">
          <span>Discard what you typed?</span>
          <button ref={keep} type="button" class="bd-btn bd-btn-sm" onClick={() => setAsking(false)}>
            Keep editing
          </button>
          <button
            type="button"
            class="bd-btn bd-btn-sm"
            data-tone="danger"
            onClick={() => {
              setAsking(false);
              cancel();
            }}
          >
            Discard
          </button>
        </div>
      ) : (
        <div class="bd-popacts">
          <button type="button" class="bd-btn bd-btn-sm" disabled={busy} onClick={() => (typed ? setAsking(true) : cancel())}>
            Cancel
          </button>
          {/* aria-disabled while it saves: focus stays here, and a second press sends nothing. */}
          <button type="button" class="bd-btn bd-btn-sm bd-btn-primary" aria-disabled={busy || disabled !== null || undefined} aria-busy={busy || undefined} title={disabled ?? undefined} onClick={go}>
            {busy ? 'Closing…' : action}
          </button>
        </div>
      )}
      {message}
    </div>
  );
}
