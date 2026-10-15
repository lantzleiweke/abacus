import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Bead, StatusDef } from '../../shared/types';
import { assigneeOptions, closes, labelProblem, LINK_KINDS, linkRequest, linkTargets, PRIORITY_WORDS } from '../edit';
import { initials } from '../format';
import { looker, markerOf, shortId, statusLabel } from '../list';
import { useStore, useStoreApi } from '../store';
import { personName } from '../detail';
import { composing, isConfirmKey, isSubmitKey, saveKey } from '../keyboard';
import { IconChevron, IconX } from './icons';
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

/** The status at the top right, as a menu of every status the project has. A move that closes the bead asks why first. */
export function StatusMenu({ bead, writes, disabled, statuses }: FieldProps & { statuses: StatusDef[] }) {
  const store = useStoreApi();
  const pop = usePopover(disabled !== null);
  /** Sends the move, and says so once it is in (the dot alone is easy to miss). */
  const move = async (to: string, closeReason?: string) => {
    if (await writes.send(() => ({ status: to, ...(closeReason ? { closeReason } : {}) }))) store.notify(`Status set to ${statusLabel(to, statuses)}.`);
  };
  const [closing, setClosing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const look = looker(statuses);
  const names = statuses.map((s) => s.name);
  if (!names.includes(bead.status)) names.push(bead.status);
  const label = statusLabel(bead.status, statuses);
  const close = () => {
    pop.close();
    setClosing(null);
    setReason('');
  };
  const choose = (name: string) => {
    if (name === bead.status) return close();
    if (asksReason(bead.status, name, statuses)) {
      setClosing(name);
      return;
    }
    close();
    void move(name);
  };
  const confirm = () => {
    if (!closing) return;
    const why = reason.trim();
    close();
    void move(closing, why || undefined);
  };
  return (
    <span class="bd-popwrap">
      <button
        type="button"
        class="bd-statbtn"
        aria-label={`Status: ${label}`}
        aria-haspopup="menu"
        aria-expanded={pop.open}
        title={disabled ?? bead.status}
        disabled={disabled !== null || writes.busy}
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
        <Popover label="Close reason" align="end" onClose={close}>
          {/* No form element here: the host frame is sandboxed without allow-forms, so a submit never fires. */}
          <div class="bd-popform" role="group" aria-label="Close reason">
            <label class="bd-flab" for="bd-close-why">
              {`Why is it ${statusLabel(closing, statuses).toLowerCase()}?`}
            </label>
            <input
              id="bd-close-why"
              class="bd-input"
              aria-label="Close reason (optional)"
              placeholder="Optional, for example the commit"
              value={reason}
              onInput={(e) => setReason(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || composing(e) || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
                e.preventDefault();
                confirm();
              }}
            />
            <div class="bd-popacts">
              <button type="button" class="bd-btn bd-btn-sm" onClick={close}>
                Cancel
              </button>
              <button type="button" class="bd-btn bd-btn-sm bd-btn-primary" onClick={confirm}>{`Mark ${statusLabel(closing, statuses).toLowerCase()}`}</button>
            </div>
          </div>
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
