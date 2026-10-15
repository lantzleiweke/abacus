import { useEffect, useRef, useState } from 'preact/hooks';
import type { Bead } from '../../shared/types';
import { blockedMessage } from '../gates';
import type { EpicGroup, Progress } from '../list';
import { shortId } from '../list';
import { useStore, useStoreApi } from '../store';
import { CHECKING_COMMENT, CloseFields, closePatch, commentWentIn, useCloseDrafts } from './CloseDialog';
import { IconChevron } from './icons';
import { BeadRow, Row, rowDomId, type RowEvents } from './Row';
import { feedbackOf, readSince, WriteMessage, type Feedback } from './writes';

/**
 * An epic whose every child is done: says so, with Close epic (one click) and Add a reason (the close dialog: a reason and a comment,
 * the comment added first). `where` is the Epic view's group or the epic's own detail; focus goes on from there once it closes.
 */
export function EpicReady({ epic, where, paused }: { epic: Bead; where: 'row' | 'detail'; paused: string | null }) {
  const store = useStoreApi();
  const gates = useStore().gates;
  const drafts = useCloseDrafts(epic);
  const refreshed = useStore().snapshot?.freshness.localRefreshedAt ?? null;
  /** When an answer left the close unknown: once the project is read after it and the epic is still here, it did not close. */
  const [unsure, setUnsure] = useState<number | null>(null);
  useEffect(() => {
    if (unsure === null || !readSince(refreshed, unsure)) return;
    setUnsure(null);
    setFeedback({ kind: 'checked', saved: false });
  }, [refreshed, unsure]);
  const [step, setStep] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [changed, setChanged] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const send = async (withText: boolean) => {
    if (sending.current || paused !== null || (withText && drafts.checking)) return;
    sending.current = true;
    setBusy(true);
    setFeedback(null);
    setChanged(false);
    setUnsure(null);
    if (withText) drafts.sending();
    // A comment that is already on the epic (an earlier close added it, then did not answer) is not sent again.
    const patch = closePatch('closed', withText ? drafts.reason : '', withText ? drafts.commentFor(epic) : '');
    const outcome = await store.update(epic.id, epic.updatedAt, patch, { status: epic.status });
    sending.current = false;
    setBusy(false);
    if (outcome.kind === 'dropped') return;
    if (outcome.kind === 'ok') {
      drafts.drop();
      store.notify(`Closed ${epic.title || shortId(epic.id)}.`);
      // This goes with the epic's open state: focus to the epic's row in the list, or to the detail's status.
      const next = where === 'row' ? document.getElementById(rowDomId(epic.id))?.closest<HTMLElement>('[role="listbox"]') : document.querySelector<HTMLElement>('.bd-detail .bd-statbtn');
      next?.focus({ preventScroll: true });
      return;
    }
    if (commentWentIn(outcome)) drafts.drop('comment');
    if (outcome.kind === 'uncertain' && !outcome.saved) {
      if (withText) drafts.uncertain();
      setUnsure(Date.now());
    }
    if (outcome.kind === 'conflict') setChanged(true);
    else setFeedback(feedbackOf(outcome));
  };
  const leave = () => {
    setStep(false);
    requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }));
  };
  return (
    <div ref={root} class="bd-epic-ready" data-where={where}>
      <div class="bd-epic-ready-row">
        <span class="bd-epic-ready-t">
          <span class="bd-epic-ready-mark" aria-hidden="true" />
          All children done
        </span>
        {!step && (
          <>
            {/* In the list a quieter button: every ready epic shows one, and none should outshout the rows. */}
            <button
              type="button"
              class={where === 'detail' ? 'bd-btn bd-btn-sm bd-btn-primary' : 'bd-btn bd-btn-sm'}
              aria-disabled={busy || paused !== null || undefined}
              aria-busy={busy || undefined}
              title={paused ?? undefined}
              onClick={() => void send(false)}
            >
              {busy ? 'Closing…' : 'Close epic'}
            </button>
            <button
              ref={opener}
              type="button"
              class="bd-link bd-nreason"
              disabled={busy || paused !== null}
              title={paused ?? undefined}
              onClick={() => {
                drafts.load();
                setFeedback(null);
                setChanged(false);
                setStep(true);
              }}
            >
              Add a reason
            </button>
          </>
        )}
      </div>
      {step && (
        <CloseFields
          variant="step"
          question="Why is it closed?"
          action="Close epic"
          reason={drafts.reason}
          comment={drafts.comment}
          setReason={drafts.setReason}
          setComment={drafts.setComment}
          busy={busy}
          disabled={paused ?? (drafts.checking ? CHECKING_COMMENT : null)}
          message={drafts.checking && <p class="bd-wmsg" data-tone="note" role="status">{CHECKING_COMMENT}</p>}
          send={() => void send(true)}
          cancel={() => {
            drafts.drop();
            leave();
          }}
          onEscape={leave}
          autofocus
        />
      )}
      {changed && (
        <p class="bd-wmsg" data-tone="note" role="status">
          This epic changed since it was shown. Nothing was saved. Look it over, then close it again.
        </p>
      )}
      {feedback && <WriteMessage feedback={feedback} reword={(message) => blockedMessage(message, epic, gates)} />}
    </div>
  );
}

/** Done, in progress and blocked as one thin stacked bar. */
function Bar({ progress }: { progress: Progress }) {
  const share = (n: number) => `${progress.total ? (n / progress.total) * 100 : 0}%`;
  return (
    <span class="bd-bar" aria-hidden="true">
      <i data-look="done" style={{ width: share(progress.done) }} />
      <i data-look="progress" style={{ width: share(progress.inProgress) }} />
      <i data-look="blocked" style={{ width: share(progress.blocked) }} />
    </span>
  );
}

function ProgressLine({ progress, changed }: { progress: Progress; changed: number }) {
  return (
    <div class="bd-prog">
      <Bar progress={progress} />
      {progress.total === 0 ? (
        <span>Nothing in it yet</span>
      ) : (
        <span title={`${progress.done} of ${progress.total} beads in this epic done`}>{`${progress.done}/${progress.total} done`}</span>
      )}
      {progress.blocked > 0 && <span class="bd-prog-blk">{`${progress.blocked} blocked`}</span>}
      {changed > 0 && <span class="bd-prog-new">{`${changed} changed`}</span>}
    </div>
  );
}

/** Focus and active-descendant attributes for one section's listbox; the list decides which box holds the cursor. */
export type BoxAttrs = (key: string) => { tabIndex: number; 'aria-activedescendant'?: string };

type Props = RowEvents & {
  groups: EpicGroup[];
  toggle(key: string): void;
  box: BoxAttrs;
  /** Epics whose children are all done and nothing else holds: they offer Close epic. */
  ready?: ReadonlySet<string>;
  paused?: string | null;
};

export const headerId = (key: string) => `bd-h-${key}`;

/**
 * Epics expand into their children (short ids relative to the epic); "Not in an epic" holds the rest. Each group is
 * its own listbox, so the collapse control sits beside the options rather than inside one.
 */
export function EpicView({ groups, toggle, box, ready, paused = null, ...events }: Props) {
  return (
    <>
      {groups.map((group) => {
        const { epic } = group;
        const rows = group.rows.map((row) => <Row key={row.bead.id} row={row} dot {...events} />);
        if (!epic) {
          return (
            <section key={group.key} class="bd-orphans" data-collapsed={group.collapsed || undefined}>
              <button type="button" class="bd-sect" aria-expanded={!group.collapsed} onClick={() => toggle(group.key)}>
                <span class="bd-chev">
                  <IconChevron />
                </span>
                <span id={headerId(group.key)}>Not in an epic</span>
                <span class="bd-n">{group.count}</span>
                {group.changed > 0 && <span class="bd-ux">{`${group.changed} changed`}</span>}
              </button>
              {rows.length > 0 && (
                <div role="listbox" aria-labelledby={headerId(group.key)} {...box(group.key)}>
                  {rows}
                </div>
              )}
            </section>
          );
        }
        return (
          <section key={group.key} class="bd-epic" data-collapsed={group.collapsed || undefined}>
            <button
              type="button"
              class="bd-chev bd-epic-chev"
              aria-expanded={!group.collapsed}
              aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} ${epic.title}`}
              onClick={() => toggle(group.key)}
            >
              <IconChevron />
            </button>
            <div role="listbox" aria-label={epic.title} {...box(group.key)}>
              <BeadRow
                {...events}
                variant="epic"
                bead={epic}
                id={shortId(epic.id)}
                look={group.look}
                label={epic.status}
                marker="builtin"
                depth={0}
                unseen={group.unseen}
                context={group.context}
                dot={false}
                below={group.progress && <ProgressLine progress={group.progress} changed={group.changed} />}
              />
              {rows}
            </div>
            {/* Beside the listbox, never in it: a listbox holds options only. */}
            {ready?.has(epic.id) && <EpicReady key={epic.id} epic={epic} where="row" paused={paused} />}
          </section>
        );
      })}
    </>
  );
}
