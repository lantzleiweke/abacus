import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Bead, StatusDef } from '../../shared/types';
import { assigneeOptions, closes, labelProblem, LINK_KINDS, linkRequest, linkTargets, parentOptions, PRIORITY_WORDS } from '../edit';
import { initials } from '../format';
import { humanize, looker, markerOf, shortId, statusLabel } from '../list';
import { dateLabel } from '../dates';
import { useStore, useStoreApi, type WriteOutcome } from '../store';
import { personName } from '../detail';
import { COMMENT_ADDED } from '../gates';
import { composing, isConfirmKey, isSubmitKey, saveKey } from '../keyboard';
import { IconChevron, IconEpic, IconX, TypeIcon } from './icons';
import { CHECKING_COMMENT, CloseFields, closePatch, commentWentIn, useCloseDrafts } from './CloseDialog';
import { DateInput } from './DateInput';
import { Markdown } from './Markdown';
import { Popover, useChoices, usePopover } from './popover';
import { Priority, StatusDot } from './Row';
import { feedbackOf, readSince, WriteMessage, type Feedback, type InlineWrites } from './writes';

export type { InlineWrites } from './writes';

// ------------------------------------------------------------------------------------------------- text

export type TextField = 'title' | 'description' | 'acceptance' | 'design' | 'notes';

type TextEditorProps = {
  bead: Bead;
  field: TextField;
  /** The section's name, which names the field. */
  label: string;
  disabled: string | null;
  onClose(): void;
  /** Told whether there is an unsaved draft, so leaving the bead can ask first. */
  onDirty?(dirty: boolean): void;
};

const isMod = isSubmitKey;

/**
 * Markdown source for one part of a bead, opened by its Edit button. Save sends the time the bead had when editing began,
 * moved on only while this part stayed as it was; when someone else changes it, the draft stays and their text shows,
 * with Re-apply (save mine over it) and Discard. Cmd/Ctrl+Enter saves; Escape cancels, asking first when there are changes.
 */
export function TextEditor({ bead, field, label, disabled, onClose: closed, onDirty }: TextEditorProps) {
  const store = useStoreApi();
  // A draft kept from before this editor was last on screen comes back with what it started from.
  const [kept] = useState(() => store.draft(bead.id, field));
  const [draft, setDraft] = useState(kept?.text ?? bead[field]);
  const [original, setOriginal] = useState(kept?.original ?? bead[field]);
  const [base, setBase] = useState(kept?.base ?? bead.updatedAt);
  /** Closing the editor lets its draft go: saved, or discarded on purpose. */
  const onClose = () => {
    store.setDraft(bead.id, field, null);
    closed();
  };
  const [conflict, setConflict] = useState<Bead | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const box = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const title = field === 'title';

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  // The question takes the Cancel button's place, and answering Keep editing removes its own: focus would fall to the page,
  // where no key reaches this editor. It goes back to the box instead, so Enter keeps meaning what the question asks.
  useEffect(() => {
    if (!root.current || root.current.contains(document.activeElement)) return;
    box.current?.focus();
  }, [confirming]);

  /**
   * An uncertain save without a re-read, and when its answer came (panel clock). The draft showing up says it went in at
   * once; that it did not is only believed from data the service read after then, not from a copy it held from before.
   */
  const [checking, setChecking] = useState<number | null>(null);
  const snapshot = useStore().snapshot;
  const refreshed = snapshot?.freshness.localRefreshedAt ?? null;
  /** The list's copy: the one `refreshed` vouches for. The shown copy can be an older read that wins a same-second tie. */
  const listed = snapshot?.beads.find((b) => b.id === bead.id) ?? null;

  // The bead moved on while this was open. Now holding the draft: it is saved (ours, or someone wrote the same). This part
  // unchanged: keep going from the new time. Changed, and nothing typed yet: follow it, so there is nothing of the
  // person's to protect. Changed under a draft: a conflict.
  useEffect(() => {
    if (busy) return;
    const current = title ? bead[field].trim() : bead[field];
    if (checking !== null) {
      // Either copy holding the draft says it went in. Only the list's copy, read after the answer, can say it did not.
      const inList = listed === null ? null : title ? listed[field].trim() : listed[field];
      if (current === value || inList === value) {
        setChecking(null);
        setOriginal(draft);
        setBase(inList === value && listed ? listed.updatedAt : bead.updatedAt);
        setFeedback({ kind: 'checked', saved: true });
        return;
      }
      if (listed === null || !readSince(refreshed, checking)) return;
      setChecking(null);
      if (listed[field] === original) {
        setBase(listed.updatedAt);
        setFeedback({ kind: 'checked', saved: false, kept: 'Your draft is still here.' });
      } else {
        setFeedback(null);
        setConflict(listed);
      }
      return;
    }
    if (conflict) return;
    // The list's copy and the shown copy disagree on this part: one is a read behind (after "Saved." the list is usually the newer).
    // Neither is the truth yet, so do not follow the shown copy and do not move the base; the next read of either decides.
    if (listed !== null && listed[field] !== bead[field]) return;
    if (bead[field] === original) setBase(bead.updatedAt);
    else if (current === value) {
      setOriginal(draft);
      setBase(bead.updatedAt);
    } else if (draft === original) {
      setDraft(bead[field]);
      setOriginal(bead[field]);
      setBase(bead.updatedAt);
    } else setConflict(bead);
  }, [bead, listed, refreshed]);

  // The text box grows with what is in it (wrapped lines too), up to the CSS cap, so long text never hides above the fold.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || title) return;
    el.style.height = 'auto';
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight + 2}px`;
  }, [draft]);

  const value = title ? draft.trim() : draft;
  const changed = draft !== original;
  /** The last save may be in: only "Save again" sends the draft once more. */
  const maybeIn = feedback?.kind === 'uncertain';
  useEffect(() => onDirty?.(changed), [changed]);
  useEffect(() => () => onDirty?.(false), []);
  useEffect(() => store.setDraft(bead.id, field, changed ? { text: draft, original, base } : null), [draft, original, base]);
  /** Saves the draft over `shown`, the text as the bead had it at `expected` (Re-apply passes the newer one). */
  const save = async (expected: string, shown: string = original) => {
    if (busy || disabled || (title && value === '')) return;
    if (!changed && !conflict) return onClose();
    setBusy(true);
    setFeedback(null);
    setConfirming(false);
    const outcome = await store.update(bead.id, expected, { [field]: value }, { [field]: shown });
    setBusy(false);
    if (outcome.kind === 'ok') return onClose();
    if (outcome.kind === 'conflict') return setConflict(outcome.current);
    if (outcome.kind === 'uncertain' && outcome.saved) return onClose();
    if (outcome.kind === 'uncertain' && !outcome.current) setChecking(Date.now());
    if (outcome.kind === 'uncertain' && outcome.current) {
      if (outcome.current[field] === value) return onClose();
      if (outcome.current[field] !== shown) setConflict(outcome.current);
      else setBase(outcome.current.updatedAt);
    }
    setFeedback(feedbackOf(outcome));
  };
  const reapply = () => {
    if (!conflict) return;
    const now = conflict;
    setOriginal(now[field]);
    setBase(now.updatedAt);
    setConflict(null);
    void save(now.updatedAt, now[field]);
  };
  const cancel = () => {
    if (changed && !confirming) setConfirming(true);
    else onClose();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (confirming) {
      // While "Discard your changes?" shows, Enter says yes; it never saves.
      if (isConfirmKey(e)) {
        e.preventDefault();
        onClose();
      }
    } else if (isMod(e) || (title && e.key === 'Enter' && !composing(e))) {
      e.preventDefault();
      if (!conflict && !maybeIn) void save(base);
    }
  };

  const lines = draft.split('\n').length;
  const field_ = title ? (
    <input ref={box} class="bd-input bd-titlein" aria-label={label} value={draft} readOnly={busy} onInput={(e) => setDraft(e.currentTarget.value)} onKeyDown={onKeyDown} />
  ) : (
    <textarea
      ref={box}
      class="bd-ta"
      aria-label={label}
      rows={Math.min(16, Math.max(4, lines + 1))}
      value={draft}
      readOnly={busy}
      spellcheck
      onInput={(e) => setDraft(e.currentTarget.value)}
      onKeyDown={onKeyDown}
    />
  );
  return (
    <div
      ref={root}
      class="bd-editor"
      data-field={field}
      data-busy={busy || undefined}
      onKeyDown={(e) => {
        // Escape anywhere in the editor is the editor's (the box handles its own): on its discard question it keeps
        // editing, so the detail behind never asks a second time.
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        e.preventDefault();
        e.stopPropagation();
        if (confirming) {
          setConfirming(false);
          box.current?.focus();
        } else cancel();
      }}
    >
      {conflict && (
        <div class="bd-wnote bd-wnote-edit" role="alert">
          <b>Changed while you were editing</b>
          {conflict[field] === original ? (
            <span>Other parts of the bead changed; this one did not. Re-apply to save yours.</span>
          ) : (
            <div class="bd-theirs">
              <span class="bd-theirs-lab">Now</span>
              {conflict[field].trim() === '' ? <span class="bd-none">Empty</span> : title ? <span>{conflict[field]}</span> : <Markdown class="bd-txt" text={conflict[field]} />}
            </div>
          )}
          <span class="bd-wnote-acts">
            <button type="button" class="bd-btn bd-btn-sm" onClick={onClose}>
              Discard
            </button>
            <button type="button" class="bd-btn bd-btn-sm bd-btn-primary" disabled={busy || disabled !== null} title={disabled ?? 'Save your version over it'} onClick={reapply}>
              Re-apply
            </button>
          </span>
        </div>
      )}
      {conflict && !title && <span class="bd-theirs-lab bd-draft-lab">Your draft</span>}
      {field_}
      {confirming && (
        <div class="bd-confirm" role="alertdialog" aria-label="Discard your changes?">
          <span>Discard your changes?</span>
          <button type="button" class="bd-btn bd-btn-sm" onClick={() => setConfirming(false)}>
            Keep editing
          </button>
          <button type="button" class="bd-btn bd-btn-sm" data-tone="danger" onClick={onClose}>
            Discard
          </button>
        </div>
      )}
      <WriteMessage feedback={feedback} />
      {!conflict && !confirming && (
        <div class="bd-edacts">
          {!title && <span class="bd-edhint">{`Markdown · ${saveKey()} saves`}</span>}
          <button type="button" class="bd-btn bd-btn-sm" onClick={cancel}>
            Cancel
          </button>
          {maybeIn && (
            <button type="button" class="bd-btn bd-btn-sm" disabled={busy || disabled !== null} title={disabled ?? 'It may already be saved. Send it once more.'} onClick={() => void save(base)}>
              Save again
            </button>
          )}
          <button
            type="button"
            class="bd-btn bd-btn-sm bd-btn-primary"
            disabled={busy || maybeIn || disabled !== null || (title && value === '')}
            title={disabled ?? (title && value === '' ? 'A bead needs a title.' : undefined)}
            onClick={() => void save(base)}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- comment

/**
 * Add a comment under the thread. Cmd/Ctrl+Enter posts. When Beads did not answer in time the text stays, and only the
 * button, now "Post again", sends it a second time: the first one may already be in.
 */
export function CommentComposer({ bead, disabled, onDirty }: { bead: Bead; disabled: string | null; onDirty?(dirty: boolean): void }) {
  const store = useStoreApi();
  const [text, setText] = useState(() => store.draft(bead.id, 'comment')?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  /** The last post may be in: only "Post again" sends it once more. */
  const maybeIn = feedback?.kind === 'uncertain' && !feedback.saved;
  const empty = text.trim() === '';
  useEffect(() => onDirty?.(!empty), [empty]);
  useEffect(() => () => onDirty?.(false), []);
  useEffect(() => store.setDraft(bead.id, 'comment', empty ? null : { text }), [text]);
  const snapshot = useStore().snapshot;
  const panelActor = snapshot?.panelActor ?? '';
  const refreshed = snapshot?.freshness.localRefreshedAt ?? null;
  /** A post that may be in: its text, how many such comments the bead had then, and when the answer came. */
  const [pending, setPending] = useState<{ text: string; before: number; since: number } | null>(null);
  /** The list's copy: the one `refreshed` vouches for. The shown copy can be an older read (comments leave updatedAt alone). */
  const listed = snapshot?.beads.find((b) => b.id === bead.id) ?? null;
  const count = (comments: Bead['comments'], t: string) => comments.filter((c) => c.text === t && (!panelActor || c.author === panelActor)).length;
  const mine = (t: string) => Math.max(count(bead.comments, t), listed ? count(listed.comments, t) : 0);
  // It settles: "Saved." (and the box empties) as soon as either copy shows the comment; "It did not save." only when the
  // list's copy, read after the answer, still lacks it.
  useEffect(() => {
    if (!pending) return;
    if (mine(pending.text) > pending.before) {
      setPending(null);
      setText('');
      setFeedback({ kind: 'checked', saved: true });
    } else if (listed && readSince(refreshed, pending.since)) {
      setPending(null);
      setFeedback({ kind: 'checked', saved: false, kept: 'Your comment is still here.' });
    }
  }, [bead.comments, listed, refreshed, pending]);
  const post = async () => {
    if (busy || empty || disabled) return;
    const sent = text.trim();
    const before = mine(sent);
    setBusy(true);
    setFeedback(null);
    setPending(null);
    const outcome = await store.comment(bead.id, sent);
    setBusy(false);
    // Saved (even when it could not be read back): the box clears, so nothing is left to send twice.
    if (outcome.kind === 'ok' || (outcome.kind === 'uncertain' && outcome.saved)) setText('');
    if (outcome.kind === 'uncertain' && !outcome.saved) setPending({ text: sent, before, since: Date.now() });
    setFeedback(feedbackOf(outcome));
  };
  return (
    <div class="bd-cmp" data-open={!empty || undefined}>
      <textarea
        class="bd-cmp-ta"
        aria-label="Add a comment"
        placeholder="Add a comment…"
        rows={empty ? 1 : Math.min(8, Math.max(3, text.split('\n').length + 1))}
        value={text}
        disabled={disabled !== null}
        readOnly={busy}
        title={disabled ?? undefined}
        onInput={(e) => {
          setText(e.currentTarget.value);
          if (e.currentTarget.value.trim() === '') setFeedback(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !empty) {
            e.preventDefault();
            e.stopPropagation();
            (e.currentTarget as HTMLTextAreaElement).blur();
          } else if (isMod(e)) {
            e.preventDefault();
            if (!maybeIn) void post();
          }
        }}
      />
      <WriteMessage feedback={feedback} />
      <div class="bd-cmp-acts">
        <kbd class="bd-edhint" aria-hidden="true">
          {saveKey()}
        </kbd>
        {maybeIn && (
          <button type="button" class="bd-btn bd-btn-sm" disabled={disabled !== null || busy || empty} title={disabled ?? 'It may already be posted. Send it once more.'} onClick={() => void post()}>
            Post again
          </button>
        )}
        <button type="button" class="bd-btn bd-btn-sm bd-btn-primary" disabled={disabled !== null || busy || empty || maybeIn} title={disabled ?? undefined} onClick={() => void post()}>
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  );
}

type FieldProps = { bead: Bead; writes: InlineWrites; disabled: string | null };

// ------------------------------------------------------------------------------------------------- status

/** Whether moving from `from` to `to` closes the bead, so Beads keeps a reason. */
const asksReason = (from: string, to: string, statuses: StatusDef[]) => closes(to, statuses) && (!closes(from, statuses) || (to === 'closed' && from !== 'closed'));

/** Answers a status menu has already acted on (by object, so one that shows again is not acted on twice). */
const answered = new WeakSet<object>();

/** The status at the top right, as a menu of every status the project has. A move that closes the bead asks why first. */
export function StatusMenu({ bead, writes, disabled, statuses }: FieldProps & { statuses: StatusDef[] }) {
  const store = useStoreApi();
  const pop = usePopover(disabled !== null);
  const trigger = useRef<HTMLButtonElement>(null);
  const said = (to: string) => store.notify(`Status set to ${statusLabel(to, statuses)}.`);
  /** Sends the move, and says so once it is in (the dot alone is easy to miss). */
  const move = async (to: string) => {
    if (await writes.send(() => ({ status: to }))) said(to);
  };
  const [closing, setClosing] = useState<string | null>(null);
  const drafts = useCloseDrafts(bead);
  const look = looker(statuses);
  // Another bead: its own drafts. Done (here, by Re-apply, or elsewhere): what was typed for the close has gone with it, though
  // never from under the open dialog, where the person may still be typing.
  useEffect(() => drafts.load(), [bead.id]);
  const done = look(bead.status) === 'done';
  useEffect(() => {
    if (done && !closing) drafts.drop();
  }, [done, bead.id, closing]);
  // Try again and Re-apply send the close again from under the header, not from here: what they answered still says whether the
  // comment may be in. Unknown: wait for a read before the dialog sends it. Added before a refused close: it is in.
  const fb = writes.feedback;
  useEffect(() => {
    // Each answer acts once. The same one shows again after the person leaves the bead and comes back, and by then a comment typed
    // since is a new one that no earlier answer has touched.
    if (!fb || answered.has(fb)) return;
    answered.add(fb);
    if (fb?.kind === 'uncertain' && !fb.saved) drafts.uncertain();
    else if (fb?.kind === 'error' && fb.error.message.startsWith(COMMENT_ADDED)) drafts.drop('comment');
  }, [fb]);
  const names = statuses.map((s) => s.name);
  if (!names.includes(bead.status)) names.push(bead.status);
  const label = statusLabel(bead.status, statuses);
  const close = () => {
    pop.close();
    setClosing(null);
  };
  const choose = (name: string) => {
    if (name === bead.status) return close();
    if (asksReason(bead.status, name, statuses)) {
      drafts.load();
      setClosing(name);
      return;
    }
    close();
    void move(name);
  };
  const confirmClose = async () => {
    if (!closing || writes.busy || drafts.checking) return;
    const to = closing;
    const reason = drafts.reason;
    drafts.sending();
    // Built on the bead it goes to, also for Re-apply and Try again: a comment that is already on it is not sent again.
    const outcome = await writes.sendFor((b) => closePatch(to, reason, drafts.commentFor(b)));
    if (outcome.kind === 'dropped') return;
    if (outcome.kind === 'ok') {
      drafts.drop();
      said(to);
    } else if (commentWentIn(outcome)) drafts.drop('comment');
    else if (outcome.kind === 'uncertain' && !outcome.saved) drafts.uncertain();
    // What it answered shows under the header; what did not go in stays typed for the next try.
    close();
    refocusSoon(trigger.current);
  };
  return (
    <span class="bd-popwrap">
      <button
        ref={trigger}
        type="button"
        class="bd-statbtn"
        aria-label={`Status: ${label}`}
        aria-haspopup="menu"
        aria-expanded={pop.open}
        title={disabled ?? bead.status}
        disabled={disabled !== null || (writes.busy && !pop.open)}
        onClick={() => (pop.open ? close() : pop.toggle())}
      >
        <StatusDot look={look(bead.status)} marker={markerOf(bead.status)} />
        {label}
        <IconChevron />
      </button>
      {pop.open && !closing && (
        <Popover label="Status" align="end" role="menu" onClose={close}>
          {names.map((name) => (
            <button key={name} type="button" role="menuitemradio" aria-checked={name === bead.status} class="bd-menu-item" title={name} onClick={() => choose(name)}>
              <StatusDot look={look(name)} marker={markerOf(name)} />
              <span>{statusLabel(name, statuses)}</span>
            </button>
          ))}
        </Popover>
      )}
      {pop.open && closing && (
        <Popover label="Close" align="end" onClose={close}>
          {/* No form element here: the host frame is sandboxed without allow-forms, so a submit never fires. */}
          <CloseFields
            question={`Why is it ${statusLabel(closing, statuses).toLowerCase()}?`}
            action={`Mark ${statusLabel(closing, statuses).toLowerCase()}`}
            reason={drafts.reason}
            comment={drafts.comment}
            setReason={drafts.setReason}
            setComment={drafts.setComment}
            busy={writes.busy}
            disabled={disabled ?? (drafts.checking ? CHECKING_COMMENT : null)}
            message={drafts.checking && <p class="bd-wmsg" data-tone="note" role="status">{CHECKING_COMMENT}</p>}
            send={() => void confirmClose()}
            cancel={() => {
              drafts.drop();
              close();
              refocusSoon(trigger.current);
            }}
          />
        </Popover>
      )}
    </span>
  );
}

// ------------------------------------------------------------------------------------------------- priority

export function PriorityMenu({ bead, writes, disabled }: FieldProps) {
  const pop = usePopover(disabled !== null);
  return (
    <span class="bd-popwrap">
      <button
        type="button"
        class="bd-chipbtn"
        aria-label={`Priority: ${bead.priority === null ? 'none' : `P${bead.priority}`}`}
        aria-haspopup="menu"
        aria-expanded={pop.open}
        title={disabled ?? 'Priority'}
        disabled={disabled !== null || writes.busy}
        onClick={pop.toggle}
      >
        {bead.priority === null ? <span class="bd-pr" data-p="none-set">P–</span> : <Priority value={bead.priority} />}
      </button>
      {pop.open && (
        <Popover label="Priority" role="menu" onClose={pop.close}>
          {PRIORITY_WORDS.map((word, p) => (
            <button
              key={p}
              type="button"
              role="menuitemradio"
              aria-checked={p === bead.priority}
              class="bd-menu-item"
              onClick={() => {
                pop.close();
                if (p !== bead.priority) void writes.send(() => ({ priority: p }));
              }}
            >
              <Priority value={p} />
              <span>{word}</span>
            </button>
          ))}
        </Popover>
      )}
    </span>
  );
}

// ------------------------------------------------------------------------------------------------- type

/** Types for a project that did not list its own. */
export const FALLBACK_TYPES = ['task', 'bug', 'feature', 'epic', 'chore'];

/** Hands focus back to a header button once its menu is gone, without moving the page. */
const refocusSoon = (el: HTMLElement | null) => requestAnimationFrame(() => el?.isConnected && el.focus({ preventScroll: true }));

/**
 * The bead's type, as a menu of the project's types. Nothing is checked here: Beads says when a type will not do, and its
 * words show under the header.
 */
export function TypeMenu({ bead, writes, disabled, types }: FieldProps & { types: string[] }) {
  const store = useStoreApi();
  const pop = usePopover(disabled !== null);
  const trigger = useRef<HTMLButtonElement>(null);
  const names = (types.length ? types : FALLBACK_TYPES).filter((t) => t !== 'gate');
  if (bead.type && !names.includes(bead.type)) names.push(bead.type);
  const choose = async (type: string) => {
    pop.close();
    refocusSoon(trigger.current);
    if (type === bead.type) return;
    if (await writes.send(() => ({ type }))) store.notify(`Type set to ${humanize(type)}.`);
    refocusSoon(trigger.current);
  };
  return (
    <span class="bd-popwrap">
      <button
        ref={trigger}
        type="button"
        class="bd-chipbtn bd-dtype"
        aria-label={`Type: ${humanize(bead.type || 'bead')}`}
        aria-haspopup="menu"
        aria-expanded={pop.open}
        title={disabled ?? 'Change the type'}
        disabled={disabled !== null || writes.busy}
        onClick={pop.toggle}
      >
        {humanize(bead.type || 'bead')}
        <IconChevron />
      </button>
      {pop.open && (
        <Popover label="Type" role="menu" onClose={pop.close}>
          {names.map((name) => (
            <button key={name} type="button" role="menuitemradio" aria-checked={name === bead.type} class="bd-menu-item" title={name} onClick={() => void choose(name)}>
              <TypeIcon type={name} size={13} />
              <span>{humanize(name)}</span>
            </button>
          ))}
        </Popover>
      )}
    </span>
  );
}

// ------------------------------------------------------------------------------------------------- parent

/** Whether `candidate` sits somewhere inside `id` (following parents up from it). */
function inside(candidate: Bead, id: string, byId: Map<string, Bead>): boolean {
  const seen = new Set<string>();
  for (let at: string | null = candidate.parentId; at !== null && !seen.has(at); at = byId.get(at)?.parentId ?? null) {
    if (at === id) return true;
    seen.add(at);
  }
  return false;
}

/**
 * Where the bead sits: its parent, as a menu of "No parent" and the epics not done. The bead itself and anything inside it
 * are left out; when the list is behind and Beads refuses anyway, its words show under the header.
 */
export function ParentMenu({ bead, writes, disabled, beads, byId, statuses }: FieldProps & { beads: Bead[]; byId: Map<string, Bead>; statuses: StatusDef[] }) {
  const store = useStoreApi();
  const pop = usePopover(disabled !== null);
  const trigger = useRef<HTMLButtonElement>(null);
  const parent = bead.parentId ? (byId.get(bead.parentId) ?? null) : null;
  const named = (id: string) => byId.get(id)?.title || shortId(id);
  const options = pop.open ? parentOptions(beads, statuses, bead.parentId).filter((b) => b.id !== bead.id && !inside(b, bead.id, byId)) : [];
  const choose = async (to: string | null) => {
    pop.close();
    refocusSoon(trigger.current);
    if (to === bead.parentId) return;
    const from = bead.parentId;
    if (await writes.send(() => ({ parent: to }))) store.notify(to ? `Moved under ${named(to)}.` : `Moved out of ${from ? named(from) : 'its parent'}.`);
    refocusSoon(trigger.current);
  };
  const shown = bead.parentId ? (parent?.title || shortId(bead.parentId)) : null;
  /** Only epics are offered; a parent of another type is named plainly, never marked as an epic. */
  const epicParent = parent?.type === 'epic';
  return (
    <span class="bd-popwrap bd-parentwrap">
      <button
        ref={trigger}
        type="button"
        class="bd-chipbtn bd-parent"
        data-none={shown === null || undefined}
        aria-label={`Parent: ${shown ?? 'No parent'}`}
        aria-haspopup="menu"
        aria-expanded={pop.open}
        title={disabled ?? (epicParent ? 'Move to another epic' : 'Move to an epic')}
        disabled={disabled !== null || writes.busy}
        onClick={pop.toggle}
      >
        {epicParent && <IconEpic size={12} />}
        <span class="bd-parent-t">{shown ?? 'No parent'}</span>
        <IconChevron />
      </button>
      {pop.open && (
        <Popover label="Move to" role="menu" onClose={pop.close}>
          <button type="button" role="menuitemradio" aria-checked={bead.parentId === null} class="bd-menu-item" onClick={() => void choose(null)}>
            <span>No parent</span>
          </button>
          {options.length > 0 && <div class="bd-menu-rule" role="separator" />}
          <div class="bd-menu-scroll" role="none">
            {options.map((epic) => (
              <button key={epic.id} type="button" role="menuitemradio" aria-checked={epic.id === bead.parentId} class="bd-menu-item bd-menu-epic" title={epic.title} onClick={() => void choose(epic.id)}>
                <IconEpic size={12} />
                <span class="bd-menu-t">{epic.title}</span>
                <span class="bd-menu-sub">{shortId(epic.id)}</span>
              </button>
            ))}
          </div>
          {options.length === 0 && (
            <button type="button" role="menuitem" class="bd-menu-item bd-menu-note" disabled>
              No other open epics in this project.
            </button>
          )}
        </Popover>
      )}
    </span>
  );
}

// ------------------------------------------------------------------------------------------------- dates

type DateKind = 'due' | 'defer';

const dueOf = (b: Bead): string | null => (typeof b.extra.due_at === 'string' ? b.extra.due_at : null);
const deferOf = (b: Bead): string | null => (typeof b.extra.defer_until === 'string' ? b.extra.defer_until : null);
/** A date as Beads stored it, for reading; text that is not a date as it is. */
const storedLabel = (text: string, now: number) => {
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? dateLabel(ms, now) : text;
};

/** Set aside by `defer` (status deferred), or open with a date still to come; a date that came due no longer counts. */
function snoozed(b: Bead, now: number): { until: string | null } | null {
  const until = deferOf(b);
  if (b.status === 'deferred') return { until };
  const at = until === null ? NaN : Date.parse(until);
  return Number.isFinite(at) && at > now ? { until } : null;
}

/** The part of the bead one date row shows, so a change to the rest of the bead is followed, not a conflict. */
const shownKey = (kind: DateKind, b: Bead) => (kind === 'due' ? (dueOf(b) ?? '') : `${b.status === 'deferred'}|${deferOf(b) ?? ''}`);

function dateNow(kind: DateKind, b: Bead, now: number): string {
  if (kind === 'due') {
    const due = dueOf(b);
    return due === null ? 'Now no due date.' : `Now due ${storedLabel(due, now)}.`;
  }
  const s = snoozed(b, now);
  return s === null ? 'Now not deferred.' : s.until === null ? 'Now deferred until someone brings it back.' : `Now deferred until ${storedLabel(s.until, now)}.`;
}

type DateRowProps = {
  kind: DateKind;
  bead: Bead;
  disabled: string | null;
  done: boolean;
  now: number;
  reword?: (message: string) => string;
  onDirty(dirty: boolean): void;
};

/**
 * A write that met a newer bead: the bead as it is now, the same change made again on it, and whether this row's date is still
 * as it was shown (only something else on the bead changed).
 */
type DateConflict = { current: Bead; again(current: Bead): void; same: boolean };

/**
 * One date on the bead (its due date, or how long it is deferred) with what can be done to it. A date is typed with a preview of
 * what Beads will store; Clear, Defer indefinitely and Undefer act on one click. A change that met a newer bead shows what is
 * there now and is sent again only on Re-apply. Escape, Cancel or leaving with typed text asks first.
 */
function DateRow({ kind, bead, disabled, done, now, reword, onDirty }: DateRowProps) {
  const store = useStoreApi();
  const due = kind === 'due';
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  /** The bead as it was when typing began, moved on while this row's date stayed as shown. */
  const [base, setBase] = useState<Bead | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [conflict, setConflict] = useState<DateConflict | null>(null);
  const [confirming, setConfirming] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const typed = text.trim();
  const dirty = editing && typed !== '';
  useEffect(() => onDirty(dirty), [dirty]);
  useEffect(() => () => onDirty(false), []);

  /** Focus to the row's first button (the one that opens the editor), without moving the page. */
  const home = () =>
    requestAnimationFrame(() => (row.current?.querySelector<HTMLElement>('[data-date-open]:not(:disabled)') ?? row.current?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus({ preventScroll: true }));
  const close = () => {
    setEditing(false);
    setText('');
    setBase(null);
    setConfirming(false);
    setConflict(null);
    home();
  };

  // While typing, the bead moves on: this date unchanged, keep going from the new time; changed, nothing typed, follow it;
  // changed under typed text, a conflict before anything is sent.
  useEffect(() => {
    if (!editing || busy || conflict || base === null) return;
    if (shownKey(kind, bead) === shownKey(kind, base)) {
      if (bead.updatedAt !== base.updatedAt) setBase(bead);
    } else if (typed === '') setBase(bead);
    else setConflict({ current: bead, again: (current) => void save(current), same: false });
  }, [bead]);

  /**
   * Shows how a write sent on `on` ended. `again` makes the same change on a newer bead (Re-apply). A pressed button was off while
   * the write ran, so focus goes to the conflict note (not Re-apply) when it opens, or back to the row after a refusal outside an edit.
   */
  const settle = (outcome: WriteOutcome<Bead>, on: Bead, again: (current: Bead) => void, said: (b: Bead) => string, keepOpen: boolean) => {
    if (outcome.kind === 'dropped') return;
    if (outcome.kind === 'ok') {
      store.notify(said(outcome.value));
      return close();
    }
    if (outcome.kind === 'conflict') {
      setConflict({ current: outcome.current, again, same: shownKey(kind, outcome.current) === shownKey(kind, on) });
      // The note itself, never Re-apply: a double Enter must not write over what the refusal protects.
      requestAnimationFrame(() => row.current?.querySelector<HTMLElement>('.bd-wnote-date')?.focus({ preventScroll: true }));
      return;
    }
    if (outcome.kind === 'uncertain' && outcome.saved && keepOpen) close();
    else if (!editing) home();
    setFeedback(feedbackOf(outcome));
  };

  const run = async (on: Bead, send: () => Promise<WriteOutcome<Bead>>, again: (current: Bead) => void, said: (b: Bead) => string, keepOpen = false) => {
    // Read at once: two presses in one frame both see it, where `busy` is only seen after the next render.
    if (sending.current || disabled !== null) return;
    sending.current = true;
    setBusy(true);
    setFeedback(null);
    setConflict(null);
    setConfirming(false);
    const outcome = await send();
    sending.current = false;
    setBusy(false);
    settle(outcome, on, again, said, keepOpen);
  };

  const save = (on: Bead) => {
    if (typed === '') return;
    setBase(on);
    const sent = typed;
    void run(
      on,
      () => (due ? store.update(bead.id, on.updatedAt, { due: sent }, { due: dueOf(on) }) : store.defer(bead.id, on.updatedAt, sent)),
      (current) => save(current),
      (b) => {
        const stored = due ? dueOf(b) : deferOf(b);
        return stored === null ? (due ? 'Due date saved.' : 'Deferred.') : due ? `Due ${storedLabel(stored, now)}.` : `Deferred until ${storedLabel(stored, now)}.`;
      },
      true,
    );
  };
  const clearDue = (on: Bead) =>
    void run(on, () => store.update(bead.id, on.updatedAt, { due: null }, { due: dueOf(on) }), clearDue, () => 'Due date cleared.');
  const indefinitely = (on: Bead) => void run(on, () => store.defer(bead.id, on.updatedAt, null), indefinitely, () => 'Deferred until someone brings it back.');
  const undefer = (on: Bead) => void run(on, () => store.undefer(bead.id, on.updatedAt), undefer, () => 'No longer deferred.');

  const open = () => {
    setEditing(true);
    setText('');
    setBase(bead);
    setFeedback(null);
    setConflict(null);
  };
  const cancel = () => {
    if (busy) return;
    if (typed !== '' && !confirming) setConfirming(true);
    else close();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    // Outside an edit, Escape is the detail's (back to the list): a note or a focused button here does not keep it.
    if (e.key !== 'Escape' || e.defaultPrevented || !(editing || confirming)) return;
    e.preventDefault();
    e.stopPropagation();
    if (confirming) {
      setConfirming(false);
      row.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    } else cancel();
  };

  const off = disabled !== null || busy;
  const title = disabled ?? undefined;
  const stored = due ? dueOf(bead) : null;
  const snooze = due ? null : snoozed(bead, now);
  const storedAt = stored === null ? NaN : Date.parse(stored);
  const overdue = due && !done && Number.isFinite(storedAt) && storedAt < now;
  const value = due
    ? stored === null
      ? 'No due date'
      : storedLabel(stored, now)
    : snooze === null
      ? 'Not deferred'
      : snooze.until === null
        ? 'Until someone brings it back'
        : `Until ${storedLabel(snooze.until, now)}`;
  const empty = due ? stored === null : snooze === null;

  const actions = due ? (
    stored === null ? (
      <button type="button" class="bd-datebtn" data-date-open title={title} disabled={off} onClick={open}>
        Set due date
      </button>
    ) : (
      <>
        <button type="button" class="bd-datebtn" data-date-open aria-label="Change due date" title={title} disabled={off} onClick={open}>
          Change
        </button>
        <button type="button" class="bd-datebtn" aria-label="Clear due date" title={title} disabled={off} onClick={() => clearDue(bead)}>
          Clear
        </button>
      </>
    )
  ) : (
    <>
      <button type="button" class="bd-datebtn" data-date-open aria-label={snooze === null ? 'Defer until a date' : snooze.until ? 'Change defer date' : 'Set a date to defer until'} title={title} disabled={off} onClick={open}>
        {snooze === null ? 'Defer until…' : snooze.until ? 'Change' : 'Set a date'}
      </button>
      {(snooze === null || snooze.until !== null) && (
        <button type="button" class="bd-datebtn" title={title ?? 'Set aside with no date, until someone brings it back'} disabled={off} onClick={() => indefinitely(bead)}>
          Defer indefinitely
        </button>
      )}
      {snooze !== null && (
        <button type="button" class="bd-datebtn" title={title ?? 'Back to open'} disabled={off} onClick={() => undefer(bead)}>
          Undefer
        </button>
      )}
    </>
  );

  return (
    <div ref={row} class="bd-daterow" data-date={kind} data-editing={editing || undefined} data-busy={busy || undefined} role="group" aria-label={due ? 'Due date' : 'Deferred'} onKeyDown={onKeyDown}>
      <span class="bd-datelab" aria-hidden="true">
        {due ? 'Due' : 'Deferred'}
      </span>
      <div class="bd-dateval">
        {!editing && (
          <div class="bd-dateline">
            <span class="bd-datetext" data-none={empty || undefined}>
              {value}
              {overdue && <span class="bd-overdue">Overdue</span>}
            </span>
            <span class="bd-dateacts">{actions}</span>
          </div>
        )}
        {editing && (
          <div class="bd-dateedit">
            <DateInput
              label={due ? 'Due date' : 'Defer until'}
              lead={due ? 'Due' : 'Until'}
              value={text}
              onInput={setText}
              onEnter={() => (confirming ? close() : conflict ? undefined : save(base ?? bead))}
              readOnly={busy || conflict !== null}
              disabled={disabled !== null}
              autoFocus
            />
            {confirming ? (
              <div class="bd-confirm" role="alertdialog" aria-label="Discard your changes?">
                <span>Discard your changes?</span>
                <button
                  type="button"
                  class="bd-btn bd-btn-sm"
                  onClick={() => {
                    setConfirming(false);
                    row.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
                  }}
                >
                  Keep editing
                </button>
                <button type="button" class="bd-btn bd-btn-sm" data-tone="danger" onClick={close}>
                  Discard
                </button>
              </div>
            ) : (
              !conflict && (
                <div class="bd-edacts">
                  <button type="button" class="bd-btn bd-btn-sm" disabled={busy} onClick={cancel}>
                    Cancel
                  </button>
                  <button type="button" class="bd-btn bd-btn-sm bd-btn-primary" disabled={off || typed === ''} title={title} onClick={() => save(base ?? bead)}>
                    {busy ? 'Saving…' : due ? 'Save' : 'Defer'}
                  </button>
                </div>
              )
            )}
          </div>
        )}
        {conflict && (
          <div class="bd-wnote bd-wnote-date" role="alert" tabIndex={-1}>
            <b>Changed while you were editing</b>
            <span>{conflict.same ? 'Something else on this bead changed; this date did not. Re-apply to make your change.' : dateNow(kind, conflict.current, now)}</span>
            <span class="bd-wnote-acts">
              <button
                type="button"
                class="bd-btn bd-btn-sm"
                onClick={() => {
                  setConflict(null);
                  if (editing) close();
                  else home();
                }}
              >
                Discard
              </button>
              <button type="button" class="bd-btn bd-btn-sm bd-btn-primary" disabled={off} title={disabled ?? 'Make your change over it'} onClick={() => conflict.again(conflict.current)}>
                Re-apply
              </button>
            </span>
          </div>
        )}
        <WriteMessage feedback={feedback} reword={reword} />
      </div>
    </div>
  );
}

type DateFieldsProps = Omit<DateRowProps, 'kind' | 'onDirty'> & {
  /** Defer is not marked unsupported for this project (an older Beads answered that it cannot). */
  canDefer: boolean;
  /** Told whether either row holds typed text, so leaving the bead can ask first. */
  onDirty?(dirty: boolean): void;
};

/** The bead's due date and whether it is deferred, at the top of More. A finished bead is not offered a defer. */
export function DateFields({ canDefer, onDirty, ...props }: DateFieldsProps) {
  const [dirty, setDirty] = useState({ due: false, defer: false });
  const any = dirty.due || dirty.defer;
  useEffect(() => onDirty?.(any), [any]);
  return (
    <div class="bd-dates">
      <DateRow kind="due" {...props} onDirty={(d) => setDirty((x) => (x.due === d ? x : { ...x, due: d }))} />
      {canDefer && !props.done && <DateRow kind="defer" {...props} onDirty={(d) => setDirty((x) => (x.defer === d ? x : { ...x, defer: d }))} />}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- assignee

export function AssigneePicker({ bead, writes, disabled, beads, panelActor }: FieldProps & { beads: Bead[]; panelActor: string }) {
  const pop = usePopover(disabled !== null);
  const [text, setText] = useState('');
  const listId = useId();
  const q = text.trim().toLowerCase();
  const options = assigneeOptions(beads, panelActor).filter((n) => n !== bead.assignee && (q === '' || n.toLowerCase().includes(q)));
  const choices = useChoices(options, listId);
  const close = () => {
    pop.close();
    setText('');
  };
  const assign = (name: string | null) => {
    close();
    if (name !== bead.assignee) void writes.send(() => ({ assignee: name }));
  };
  const shown = bead.assignee ? personName(bead.assignee, panelActor || null) : 'unassigned';
  return (
    <span class="bd-popwrap">
      <button
        type="button"
        class="bd-assignee bd-chipbtn"
        data-none={bead.assignee ? undefined : true}
        aria-label={`Assignee: ${bead.assignee ?? 'unassigned'}`}
        aria-haspopup="dialog"
        aria-expanded={pop.open}
        title={disabled ?? (bead.assignee ? `Assigned to ${bead.assignee}` : 'Assign')}
        disabled={disabled !== null || writes.busy}
        onClick={() => (pop.open ? close() : pop.toggle())}
      >
        {bead.assignee ? (
          <span class="bd-av" data-size="sm" aria-hidden="true">
            {initials(bead.assignee)}
          </span>
        ) : (
          <i aria-hidden="true" />
        )}
        {shown}
      </button>
      {pop.open && (
        <Popover label="Assignee" onClose={close}>
          <input
            class="bd-input"
            aria-label="Assignee"
            aria-controls={listId}
            aria-activedescendant={choices.activeId}
            placeholder="Name"
            value={text}
            onInput={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => choices.onKey(e, (picked) => (picked ? assign(picked) : text.trim() ? assign(text.trim()) : undefined))}
          />
          {options.length > 0 && (
            <ul id={listId} class="bd-opts" role="listbox" aria-label="People">
              {options.map((name, i) => (
                <li key={name} id={choices.optionId(i)} role="option" aria-selected={i === choices.active} class="bd-opt" onClick={() => assign(name)}>
                  {name}
                </li>
              ))}
            </ul>
          )}
          {text.trim() && !options.some((n) => n.toLowerCase() === q) && (
            <button type="button" class="bd-menu-item" onClick={() => assign(text.trim())}>{`Assign to "${text.trim()}"`}</button>
          )}
          {bead.assignee && (
            <button type="button" class="bd-menu-item bd-menu-sep" onClick={() => assign(null)}>
              Unassign
            </button>
          )}
        </Popover>
      )}
    </span>
  );
}

// ------------------------------------------------------------------------------------------------- labels

export function LabelsEditor({ bead, writes, disabled, beads }: FieldProps & { beads: Bead[] }) {
  const pop = usePopover(disabled !== null);
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  const listId = useId();
  const problem = labelProblem(text, bead.labels);
  const q = text.trim().toLowerCase();
  const known = [...new Set(beads.flatMap((b) => b.labels))].filter((l) => !bead.labels.includes(l) && q !== '' && l.toLowerCase().includes(q)).sort().slice(0, 5);
  const choices = useChoices(known, listId);
  const close = () => {
    pop.close();
    setText('');
    setTried(false);
  };
  const add = (label: string) => {
    setTried(true);
    if (labelProblem(label, bead.labels)) return;
    setText('');
    setTried(false);
    const added = label.trim();
    void writes.send((b) => ({ labels: b.labels.includes(added) ? b.labels : [...b.labels, added] }));
  };
  return (
    <span class="bd-popwrap">
      <button
        type="button"
        class="bd-lbadd"
        aria-label="Edit labels"
        aria-haspopup="dialog"
        aria-expanded={pop.open}
        title={disabled ?? 'Labels'}
        disabled={disabled !== null}
        onClick={() => (pop.open ? close() : pop.toggle())}
      >
        {bead.labels.length ? '+' : '+ Label'}
      </button>
      {pop.open && (
        <Popover label="Labels" align="end" onClose={close}>
          {bead.labels.length > 0 && (
            <div class="bd-lbs">
              {bead.labels.map((label) => (
                <span key={label} class="bd-lb bd-lb-edit">
                  {label}
                  <button
                    type="button"
                    aria-label={`Remove label ${label}`}
                    disabled={writes.busy}
                    onClick={() => void writes.send((b) => ({ labels: b.labels.filter((l) => l !== label) }))}
                  >
                    <IconX size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            class="bd-input"
            aria-label="Add a label"
            aria-controls={listId}
            aria-activedescendant={choices.activeId}
            aria-invalid={problem !== null && (tried || text !== '') ? true : undefined}
            placeholder="Add a label"
            data-autofocus
            value={text}
            disabled={writes.busy}
            onInput={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => choices.onKey(e, (picked) => add(picked ?? text))}
          />
          {problem && (tried || text !== '') && <p class="bd-fieldmsg">{problem}</p>}
          {known.length > 0 && (
            <ul id={listId} class="bd-opts" role="listbox" aria-label="Labels in this project">
              {known.map((label, i) => (
                <li key={label} id={choices.optionId(i)} role="option" aria-selected={i === choices.active} class="bd-opt" onClick={() => add(label)}>
                  {label}
                </li>
              ))}
            </ul>
          )}
        </Popover>
      )}
    </span>
  );
}

// ------------------------------------------------------------------------------------------------- supersede and duplicate

export type ReplaceKind = 'supersede' | 'duplicate';

const REPLACE: Record<ReplaceKind, { title: string; ask: string; as: string; action: string; done: string }> = {
  supersede: { title: 'Superseded by', ask: 'Which bead replaces this one?', as: 'superseded by', action: 'Close as superseded', done: 'superseded by' },
  duplicate: { title: 'Duplicate of', ask: 'Which bead does this one repeat?', as: 'a duplicate of', action: 'Close as duplicate', done: 'a duplicate of' },
};

type ReplaceStepProps = {
  kind: ReplaceKind;
  bead: Bead;
  beads: Bead[];
  statuses: StatusDef[];
  disabled: string | null;
  /** A `blocked` refusal in the words the detail uses (gates by kind, never by id). */
  reword(message: string): string;
  /** Closes the step; `closed` when the bead was closed by it. */
  onClose(closed: boolean): void;
};

/**
 * Closing a bead as superseded by, or a duplicate of, another: find the other bead, then a confirmation that says the bead
 * closes, then the write. A refusal keeps the choice and says why; Escape clears the search first, then leaves.
 */
export function ReplaceStep({ kind, bead, beads, statuses, disabled, reword, onClose }: ReplaceStepProps) {
  const store = useStoreApi();
  const words = REPLACE[kind];
  const [text, setText] = useState('');
  const [chosen, setChosen] = useState<Bead | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [changed, setChanged] = useState(false);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const look = looker(statuses);
  const found = chosen ? [] : linkTargets(text, beads, bead.id, statuses);
  const choices = useChoices(found, listId);
  useEffect(() => (chosen ? confirm.current : input.current)?.focus({ preventScroll: true }), [chosen === null]);

  const pick = (target: Bead | null) => {
    if (!target) return;
    setFeedback(null);
    setChanged(false);
    setChosen(target);
  };
  const send = async () => {
    if (!chosen || sending.current || disabled !== null) return;
    sending.current = true;
    setBusy(true);
    setFeedback(null);
    setChanged(false);
    const outcome = kind === 'supersede' ? await store.supersede(bead.id, chosen.id, bead.updatedAt) : await store.duplicate(bead.id, chosen.id, bead.updatedAt);
    sending.current = false;
    setBusy(false);
    if (outcome.kind === 'dropped') return;
    if (outcome.kind === 'ok') {
      store.notify(`Closed ${shortId(bead.id)} as ${words.done} ${shortId(chosen.id)}.`);
      return onClose(true);
    }
    // The bead on screen is now the one Beads has: the person looks it over and confirms again.
    if (outcome.kind === 'conflict') setChanged(true);
    else setFeedback(feedbackOf(outcome));
  };
  const back = () => {
    if (busy) return;
    setChosen(null);
    setFeedback(null);
    setChanged(false);
  };
  const named = (b: Bead) => `${shortId(b.id)} ${b.title}`.trim();
  return (
    <div
      class="bd-nstep bd-replace"
      data-stage={chosen ? 'confirm' : 'pick'}
      role="group"
      aria-label={words.title}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || composing(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (busy) return;
        if (!chosen && text) setText('');
        else onClose(false);
      }}
    >
      {chosen ? (
        <>
          <p class="bd-replace-q">
            <span class="bd-replace-lab">{words.title}</span>
            <span class="bd-replace-pick">
              <StatusDot look={look(chosen.status)} marker={markerOf(chosen.status)} />
              <span class="bd-id">{shortId(chosen.id)}</span>
              <span class="bd-title">{chosen.title}</span>
            </span>
          </p>
          <p class="bd-replace-says">
            <b>{`This closes ${bead.id}.`}</b> {`It will show as ${words.as} ${named(chosen)}.`}
          </p>
          {changed && (
            <p class="bd-wmsg" data-tone="note" role="status">
              This bead changed while you were choosing. Nothing was saved. Look it over, then close it again.
            </p>
          )}
          {feedback && <WriteMessage feedback={feedback} reword={reword} />}
          <div class="bd-nstep-acts">
            {/* aria-disabled while it saves: focus stays here, and a second press sends nothing. */}
            <button
              ref={confirm}
              type="button"
              class="bd-btn bd-btn-sm bd-btn-primary"
              aria-disabled={busy || disabled !== null || undefined}
              aria-busy={busy || undefined}
              title={disabled ?? undefined}
              onClick={() => void send()}
            >
              {busy ? 'Closing…' : words.action}
            </button>
            <button type="button" class="bd-btn bd-btn-sm" disabled={busy} onClick={back}>
              Choose another
            </button>
            <button type="button" class="bd-btn bd-btn-sm" disabled={busy} onClick={() => onClose(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <label class="bd-flab" for={`${listId}-in`}>
            {words.ask}
          </label>
          <input
            ref={input}
            id={`${listId}-in`}
            class="bd-input"
            role="combobox"
            aria-expanded={found.length > 0}
            aria-controls={listId}
            aria-activedescendant={choices.activeId}
            aria-autocomplete="list"
            placeholder="Bead id or title"
            value={text}
            onInput={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => choices.onKey(e, (b) => pick(b ?? found[0] ?? null))}
          />
          {found.length > 0 && (
            <ul id={listId} class="bd-opts bd-opts-in" role="listbox" aria-label="Beads">
              {found.map((b, i) => (
                <li key={b.id} id={choices.optionId(i)} role="option" aria-selected={i === choices.active} class="bd-opt bd-opt-bead" onClick={() => pick(b)}>
                  <StatusDot look={look(b.status)} marker={markerOf(b.status)} />
                  <span class="bd-id">{shortId(b.id)}</span>
                  <span class="bd-title">{b.title}</span>
                </li>
              ))}
            </ul>
          )}
          {text.trim() !== '' && found.length === 0 && <p class="bd-fieldmsg" data-tone="quiet">No bead matches.</p>}
          <p class="bd-nstep-hint">{`Closes ${bead.id} and links it to the bead you pick. You confirm first.`}</p>
          <div class="bd-nstep-acts">
            <button type="button" class="bd-btn bd-btn-sm" onClick={() => onClose(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- links

type LinkAdderProps = { bead: Bead; beads: Bead[]; statuses: StatusDef[]; disabled: string | null; onDone(): void };

/** Kind of link, then the other bead found by id or title. The link shows at once; the list catches up. */
export function LinkAdder({ bead, beads, statuses, disabled, onDone }: LinkAdderProps) {
  const store = useStoreApi();
  const [kind, setKind] = useState(LINK_KINDS[0]!.value);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const look = looker(statuses);
  const found = linkTargets(text, beads, bead.id, statuses);
  const choices = useChoices(found, listId);
  const pick = async (target: Bead | null) => {
    if (!target || busy || disabled !== null) return;
    setBusy(true);
    setFeedback(null);
    const outcome = await store.link({ op: 'add', ...linkRequest(kind, bead.id, target.id) });
    setBusy(false);
    if (outcome.kind === 'ok') onDone();
    else setFeedback(feedbackOf(outcome));
  };
  return (
    <div
      class="bd-linkadd"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        onDone();
      }}
    >
      <div class="bd-linkrow">
        <select class="bd-select" aria-label="Kind of link" value={kind} disabled={disabled !== null || busy} onChange={(e) => setKind(e.currentTarget.value)}>
          {LINK_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <input
          class="bd-input"
          role="combobox"
          aria-label="Find a bead by id or title"
          aria-expanded={found.length > 0}
          aria-controls={listId}
            aria-activedescendant={choices.activeId}
          aria-autocomplete="list"
          placeholder="Bead id or title"
          ref={input}
          value={text}
          disabled={disabled !== null || busy}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => choices.onKey(e, (b) => void pick(b ?? found[0] ?? null))}
        />
        <button type="button" class="bd-iconbtn bd-iconbtn-sm" aria-label="Cancel adding a link" onClick={onDone}>
          <IconX />
        </button>
      </div>
      {found.length > 0 && (
        <ul id={listId} class="bd-opts bd-opts-in" role="listbox" aria-label="Beads">
          {found.map((b, i) => (
            <li
              key={b.id}
              id={choices.optionId(i)}
              role="option"
              aria-selected={i === choices.active}
              aria-disabled={disabled !== null || busy || undefined}
              class="bd-opt bd-opt-bead"
              title={disabled ?? undefined}
              onClick={() => void pick(b)}
            >
              <StatusDot look={look(b.status)} marker={markerOf(b.status)} />
              <span class="bd-id">{shortId(b.id)}</span>
              <span class="bd-title">{b.title}</span>
            </li>
          ))}
        </ul>
      )}
      {text.trim() !== '' && found.length === 0 && <p class="bd-fieldmsg" data-tone="quiet">No bead matches.</p>}
      <WriteMessage feedback={feedback} />
    </div>
  );
}
