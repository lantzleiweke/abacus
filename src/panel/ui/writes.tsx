import type { Bead, BeadPatch, ExpectedFields, StatusDef } from '../../shared/types';
import { useEffect, useState } from 'preact/hooks';
import { humanize, shortId, statusLabel } from '../list';
import { useStore, useStoreApi, type PanelError, type WriteOutcome } from '../store';
import { syncProblem } from '../sync';

// ------------------------------------------------------------------------------------------------- feedback

/** What the person sees after a write that did not simply go through. */
export type Feedback =
  | { kind: 'uncertain'; saved: boolean }
  /** A refresh after an uncertain save showed whether it went in; `kept` says what is still there to send again. */
  | { kind: 'checked'; saved: boolean; kept?: string }
  | { kind: 'error'; error: PanelError }
  | null;

export const UNCERTAIN = 'This may have saved. Refreshing.';
export const SAVED_UNREAD = 'Saved. Refreshing to show it.';

/** A refused or uncertain write in plain words, with Copy details when there is raw text. */
export function WriteMessage({ feedback, reword }: { feedback: Feedback; reword?: (message: string) => string }) {
  const store = useStoreApi();
  if (!feedback) return null;
  if (feedback.kind === 'checked') {
    return (
      <p class="bd-wmsg" data-tone={feedback.saved ? 'ok' : 'note'} role="status">
        {feedback.saved ? 'Saved.' : `It did not save.${feedback.kept ? ` ${feedback.kept}` : ''}`}
      </p>
    );
  }
  if (feedback.kind === 'uncertain') {
    return (
      <p class="bd-wmsg" data-tone="note" role="status">
        {feedback.saved ? SAVED_UNREAD : UNCERTAIN}
      </p>
    );
  }
  const { error } = feedback;
  return (
    <p class="bd-wmsg" role="alert">
      <span>{reword && error.code === 'blocked' ? reword(error.message) : error.message}</span>
      {error.detail && (
        <button type="button" class="bd-link" onClick={() => store.copyDetails(error)}>
          Copy details
        </button>
      )}
    </p>
  );
}

/**
 * The service has read the project after `since` (panel clock): what it lists now is the truth, so a change that may have
 * saved and does not show there did not.
 */
export const readSince = (localRefreshedAt: string | null, since: number): boolean => localRefreshedAt !== null && Date.parse(localRefreshedAt) > since;

/** The bead holds what `patch` asks for: titles trimmed, labels as sets, an empty assignee as none. */
export function shows(patch: BeadPatch, b: Bead): boolean {
  for (const [key, value] of Object.entries(patch) as Array<[keyof BeadPatch, unknown]>) {
    // The close reason and comment go with a close; a due date is typed text that Beads reads, so what it stored cannot be compared.
    if (key === 'closeReason' || key === 'closeComment' || key === 'due' || value === undefined) continue;
    const now = key === 'parent' ? b.parentId : b[key];
    if (key === 'labels') {
      const want = new Set(value as string[]);
      if (want.size !== new Set(now as string[]).size || !(now as string[]).every((l) => want.has(l))) return false;
    } else if (key === 'title' ? String(value).trim() !== String(now).trim() : key === 'assignee' ? ((value as string | null) || null) !== ((now as string | null) || null) : value !== now) return false;
  }
  return true;
}

/** Feedback for an outcome that was not ok (null for ok and for an answer about another project). */
export function feedbackOf(outcome: WriteOutcome<unknown>): Feedback {
  if (outcome.kind === 'uncertain') return { kind: 'uncertain', saved: outcome.saved };
  if (outcome.kind === 'error') return { kind: 'error', error: outcome.error };
  return null;
}

// ------------------------------------------------------------------------------------------------- inline writes

/**
 * A change in place, built from the bead it applies to, so Re-apply after a conflict changes the bead as it is now
 * (an agent's newer label stays) instead of sending back an old whole value.
 */
export type MakePatch = (bead: Bead) => BeadPatch;

/** What `on` shows for the fields `patch` changes, so a change in the same second as the shown one still conflicts. */
export function shownFor(patch: BeadPatch, on: Bead): ExpectedFields {
  const shown: ExpectedFields = {};
  for (const key of Object.keys(patch) as Array<keyof BeadPatch>) {
    if (key === 'closeReason' || key === 'closeComment') continue;
    // `ExpectedFields` is named as the Bead stores a field: the epic is `parentId`, the stored due date is `extra.due_at`.
    if (key === 'parent') shown.parentId = on.parentId;
    else if (key === 'due') shown.due = typeof on.extra.due_at === 'string' ? on.extra.due_at : null;
    else (shown as Record<string, unknown>)[key] = on[key];
  }
  return shown;
}

/** A field change that met a newer bead: the change asked for, and the bead as it is now. */
type InlineConflict = { make: MakePatch; current: Bead };

export type InlineWrites = {
  send(make: MakePatch): Promise<boolean>;
  /** The same, answering with how it ended (a close that added a comment first says so in its refusal). */
  sendFor(make: MakePatch): Promise<WriteOutcome<Bead>>;
  /** Shows the outcome of a write made elsewhere (a link). */
  report(outcome: WriteOutcome<unknown>): void;
  conflict: InlineConflict | null;
  feedback: Feedback;
  busy: boolean;
  reapply(): void;
  /** Sends the last change again, once it is known it did not save. */
  retry(): void;
  discard(): void;
};

/**
 * Writes for the fields changed in place on the shown bead (null while there is none). Each sends the time the bead was
 * shown at. What comes back belongs to the bead it was sent for: it shows only while that bead is the one on screen, and
 * busy holds only that bead's controls.
 */
export function useInlineWrites(bead: Bead | null): InlineWrites {
  const store = useStoreApi();
  /** The last answer's note, and for which bead. */
  /** `pending`: a change that may have saved, and when its answer came, until a refresh says whether it is in. */
  const [note, setNote] = useState<{ id: string; conflict: InlineConflict | null; feedback: Feedback; pending?: { make: MakePatch; since: number } } | null>(null);
  const snapshot = useStore().snapshot;
  const refreshed = snapshot?.freshness.localRefreshedAt ?? null;
  /** The list's copy: the one `refreshed` vouches for. The shown bead can be an older read that wins a same-second tie. */
  const listed = (bead && snapshot?.beads.find((b) => b.id === bead.id)) || null;
  /** Beads with a change in flight. */
  const [busyIds, setBusyIds] = useState<readonly string[]>([]);
  const here = note !== null && note.id === bead?.id ? note : null;

  const report = (outcome: WriteOutcome<unknown>) => {
    if (bead) setNote({ id: bead.id, conflict: null, feedback: feedbackOf(outcome) });
  };
  const write = async (make: MakePatch, on: Bead) => {
    const id = on.id;
    setBusyIds((ids) => [...ids, id]);
    setNote((n) => (n?.id === id ? null : n));
    const patch = make(on);
    const outcome = await store.update(id, on.updatedAt, patch, shownFor(patch, on));
    setBusyIds((ids) => ids.filter((x) => x !== id));
    if (outcome.kind === 'dropped') return outcome;
    // Replaces any note: one for another bead is not shown there any more anyway.
    const pending = outcome.kind === 'uncertain' && !outcome.saved ? { make, since: Date.now() } : undefined;
    setNote({ id, conflict: outcome.kind === 'conflict' ? { make, current: outcome.current } : null, feedback: feedbackOf(outcome), ...(pending ? { pending } : {}) });
    return outcome;
  };
  // A change that may have saved settles: "Saved." as soon as either copy shows it; "It did not save." only when the list's
  // copy, read after the answer, still does not.
  useEffect(() => {
    const p = here?.pending;
    if (!p || !bead || here?.feedback?.kind !== 'uncertain') return;
    if (shows(p.make(bead), bead) || (listed && shows(p.make(listed), listed))) setNote({ id: bead.id, conflict: null, feedback: { kind: 'checked', saved: true } });
    else if (listed && readSince(refreshed, p.since)) setNote({ id: bead.id, conflict: null, feedback: { kind: 'checked', saved: false }, pending: p });
  }, [bead, listed, refreshed, here?.pending]);
  return {
    send: async (make) => (bead ? (await write(make, bead)).kind === 'ok' : false),
    sendFor: (make) => (bead ? write(make, bead) : Promise.resolve({ kind: 'dropped' })),
    report,
    conflict: here?.conflict ?? null,
    feedback: here?.feedback ?? null,
    busy: bead !== null && busyIds.includes(bead.id),
    reapply: () => {
      if (here?.conflict) void write(here.conflict.make, here.conflict.current);
    },
    retry: () => {
      if (bead && here?.pending) void write(here.pending.make, bead);
    },
    discard: () => setNote(null),
  };
}

/** The asked-for fields as the bead has them now, in words. `titleOf` names a parent. */
function nowText(patch: BeadPatch, current: Bead, statuses: StatusDef[], titleOf: (id: string) => string = shortId): string {
  const parts: string[] = [];
  if (patch.status !== undefined) parts.push(`status ${statusLabel(current.status, statuses)}`);
  if (patch.priority !== undefined) parts.push(`priority ${current.priority === null ? 'none' : `P${current.priority}`}`);
  if (patch.assignee !== undefined) parts.push(current.assignee ? `assigned to ${current.assignee}` : 'unassigned');
  if (patch.labels !== undefined) parts.push(current.labels.length ? `labels ${current.labels.join(', ')}` : 'no labels');
  if (patch.title !== undefined) parts.push(`title "${current.title}"`);
  if (patch.type !== undefined) parts.push(`type ${humanize(current.type)}`);
  if (patch.parent !== undefined) parts.push(current.parentId ? `in ${titleOf(current.parentId)}` : 'no parent');
  return parts.length ? `Now ${parts.join(', ')}.` : '';
}

/** Under the header: an inline change that met a newer bead, or one that may have saved or was refused. */
/** `reword`: a `blocked` refusal said again with what the shown bead waits on (gates by kind). */
export function InlineNotice({ writes, statuses, paused, reword, titleOf }: { writes: InlineWrites; statuses: StatusDef[]; paused: string | null; reword?: (message: string) => string; titleOf?: (id: string) => string }) {
  if (writes.conflict) {
    return (
      <div class="bd-wnote" role="alert">
        <b>Changed while you were editing</b>
        <span>{nowText(writes.conflict.make(writes.conflict.current), writes.conflict.current, statuses, titleOf)}</span>
        <span class="bd-wnote-acts">
          <button
            type="button"
            class="bd-btn bd-btn-sm bd-btn-primary"
            disabled={writes.busy || paused !== null}
            title={paused ?? undefined}
            onClick={() => {
              if (paused === null) writes.reapply();
            }}
          >
            Re-apply
          </button>
          <button type="button" class="bd-btn bd-btn-sm" onClick={writes.discard}>
            Discard
          </button>
        </span>
      </div>
    );
  }
  if (!writes.feedback) return null;
  const notSaved = writes.feedback.kind === 'checked' && !writes.feedback.saved;
  return (
    <div class="bd-wnote" data-tone={writes.feedback.kind === 'error' ? 'error' : 'note'}>
      <WriteMessage feedback={writes.feedback} reword={reword} />
      {notSaved && (
        <span class="bd-wnote-acts">
          <button type="button" class="bd-btn bd-btn-sm" disabled={writes.busy || paused !== null} title={paused ?? undefined} onClick={writes.retry}>
            Try again
          </button>
        </span>
      )}
    </div>
  );
}

/** Why controls are off, shown once at the top of the bead, pointing at the sync card when it explains more. */
export function PausedNote({ reason }: { reason: string }) {
  const card = syncProblem(useStore().snapshot) !== null;
  return (
    <div class="bd-paused" role="note">
      <span class="bd-paused-dot" aria-hidden="true" />
      <span>{card ? `${reason} See sync details above.` : reason}</span>
    </div>
  );
}

