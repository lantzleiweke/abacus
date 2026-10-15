import { Fragment } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { UnpublishedChange } from '../../shared/types';
import { personName } from '../detail';
import { ago } from '../format';
import { shortId } from '../list';
import { useNow, useOverlay, useStore, useStoreApi } from '../store';
import { trapTab } from '../keyboard';
import { changesText, syncProblem, useSync, useSyncUi } from '../sync';
import { IconPublish, IconSpinner, IconSync } from './icons';

export const AGENT_NOTE = 'Your agent may also publish these when it syncs.';
const AGENT_NOTE_ID = 'bd-agent-note';
/** Why the preview opened again; the dialog is described by it, so it is read as the sheet opens. */
const NOTICE_ID = 'bd-pub-notice';
/** Confirm does nothing this long after it appears, so a double click on Publish or a stray Enter cannot publish. */
export const CONFIRM_GUARD_MS = 500;

/**
 * The team line: when the team's shared copy was last fetched, how many local changes it lacks, and (with the sync
 * actions) Sync and Publish. Only shown for a project with a shared copy.
 */
export function TeamBar({ team, unpublished: counted }: { team: string; unpublished: number | null }) {
  // A count the service could not make says so, and Publish stays reachable: its preview reads its own list.
  const unknown = counted === null;
  const unpublished = counted ?? 0;
  const { snapshot } = useStore();
  const sync = useSync();
  const { starting } = useSyncUi();
  const job = snapshot?.sync.kind === 'running' ? snapshot.sync.op : null;
  const op = starting ?? job;
  const problem = syncProblem(snapshot);
  const conflict = problem?.kind === 'conflict';
  return (
    <div class="bd-teambar" data-running={op ?? undefined}>
      {/*
        Always mounted, so a job's start is announced (a region added with its text is not). It holds only the job's
        progress: the age beside it changes every minute and would be read out each time. The end is the toast.
      */}
      <span class="bd-hidden" role="status">
        {op === 'pull' ? 'Syncing with the team\u2026' : op === 'publish' ? 'Publishing to the team\u2026' : ''}
      </span>
      <span class="bd-team">
        {op ? (
          // The last sync time is about to change: say what is happening instead of showing it.
          <span class="bd-team-text">{op === 'pull' ? 'Syncing with the team…' : 'Publishing to the team…'}</span>
        ) : (
          <span class="bd-team-text">
            <span>{team}</span>
            {(unpublished > 0 || unknown) && (
              <>
                <span class="bd-sep" aria-hidden="true">
                  ·
                </span>
                <span class="bd-unpub" title={AGENT_NOTE}>{unknown ? 'Unpublished count unavailable' : `${unpublished} unpublished`}</span>
              </>
            )}
          </span>
        )}
      </span>
      {sync && (
        <span class="bd-team-acts">
          <button
            type="button"
            class="bd-tbtn bd-tbtn-icon"
            data-running={op === 'pull' || undefined}
            aria-label={op === 'pull' ? 'Syncing…' : 'Sync'}
            disabled={op !== null}
            title={op !== null ? undefined : conflict ? 'Sync again to check whether it is resolved' : "Sync: get the team's latest changes"}
            onClick={() => void sync.pull()}
          >
            {op === 'pull' ? <IconSpinner size={13} /> : <IconSync size={13} />}
          </button>
          {(unpublished > 0 || unknown || op === 'publish') && (
            <button
              type="button"
              class="bd-tbtn"
              data-tone="publish"
              data-running={op === 'publish' || undefined}
              aria-label={op === 'publish' ? 'Publishing…' : unknown ? 'Publish' : `Publish ${changesText(unpublished)}`}
              disabled={op !== null || conflict}
              aria-describedby={AGENT_NOTE_ID}
              title={conflict ? 'Resolve the sync problem first' : op !== null ? undefined : `Review and publish ${unknown ? 'your changes' : changesText(unpublished)} to the team. ${AGENT_NOTE}`}
              onClick={() => void sync.openPublish()}
            >
              {op === 'publish' ? <IconSpinner size={12} /> : <IconPublish size={12} />}
              <span>Publish</span>
            </button>
          )}
          <span id={AGENT_NOTE_ID} class="bd-hidden">
            {AGENT_NOTE}
          </span>
        </span>
      )}
    </div>
  );
}

/** A full id in a summary as its short form, which the row already leads with. */
const shortened = (summary: string, ids: string[]) => ids.reduce((text, id) => text.split(id).join(shortId(id)), summary);

function ChangeItem({ change, titleOf, panelActor, now }: { change: UnpublishedChange; titleOf(id: string): string | null; panelActor: string | null; now: number }) {
  const [first, ...rest] = change.beadIds;
  const at = change.at === null ? NaN : Date.parse(change.at);
  const meta = [personName(change.actor, panelActor), ...(Number.isFinite(at) ? [ago(now - at)] : [])];
  const summary = shortened(change.summary, change.beadIds);
  return (
    <li class="bd-pub-item">
      {first !== undefined && (
        <div class="bd-pub-bead">
          <span class="bd-id">{shortId(first)}</span>
          <span class="bd-pub-title">{titleOf(first) ?? ''}</span>
          {rest.length > 0 && (
            <span class="bd-pub-plus" title={`and ${rest.length} more ${rest.length === 1 ? 'bead' : 'beads'}`}>
              {`+${rest.length}`}
            </span>
          )}
        </div>
      )}
      <div class="bd-pub-meta">
        <span class="bd-pub-sum">{summary}</span>
        {meta.map((m, i) => (
          <Fragment key={i}>
            <span class="bd-sep" aria-hidden="true">
              ·
            </span>
            <span>{m}</span>
          </Fragment>
        ))}
      </div>
    </li>
  );
}

/** Lists exactly what Publish sends, and sends it only on the person's click. */
export function PublishSheet() {
  const sync = useSync();
  const store = useStoreApi();
  const { snapshot } = useStore();
  const { preview } = useSyncUi();
  const now = useNow(30_000);
  const confirm = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useOverlay('publish', preview !== null);
  /** When Confirm appeared (panel clock): a click or Enter meant for what was there before must not publish. */
  const shownAt = useRef(0);
  const ready = preview?.kind === 'ready' && !preview.noRemote && preview.changes.length > 0;
  // A sheet that came back on its own (new changes arrived) was not asked for: its Confirm never takes the focus.
  const reopened = preview?.kind === 'ready' && preview.notice !== undefined;
  // An empty team copy is listed, but Publish cannot set it up, and one this computer never fetched needs a Sync first.
  // Without the head the list was read from, Publish has nothing to check against. Confirm stays off in each case.
  const noHead = preview?.kind === 'ready' && !preview.head;
  const confirmOff = preview?.kind === 'ready' && (preview.teamEmpty === true || preview.teamUnseen === true || noHead);

  useEffect(() => {
    if (!preview || preview.kind === 'loading') return;
    if (ready) shownAt.current = Date.now();
    queueMicrotask(() => (ready && !reopened && !confirmOff ? confirm.current : cancel.current)?.focus());
  }, [preview?.kind]);

  if (!sync || !preview) return null;
  const titleOf = (id: string) => snapshot?.beads.find((b) => b.id === id)?.title ?? null;
  const panelActor = snapshot?.panelActor || null;

  let body;
  if (preview.kind === 'loading') {
    body = (
      <p class="bd-pub-state" role="status">
        <IconSpinner size={12} />
        Reading what would be published…
      </p>
    );
  } else if (preview.kind === 'error') {
    body = (
      <p class="bd-pub-state" data-tone="error" role="alert">
        <span>{preview.error.message}</span>
        {preview.error.detail && (
          <button type="button" class="bd-link" onClick={() => store.copyDetails(preview.error)}>
            Copy details
          </button>
        )}
      </p>
    );
  } else if (preview.noRemote) {
    body = <p class="bd-pub-state">This project has no shared copy with the team, so there is nothing to publish.</p>;
  } else if (preview.changes.length === 0) {
    body = <p class="bd-pub-state">Nothing to publish. Everything here is already on the team's shared copy.</p>;
  } else {
    body = (
      <>
        {preview.notice && (
          <p id={NOTICE_ID} class="bd-pub-state" data-tone="note">
            {preview.notice}
          </p>
        )}
        {preview.teamEmpty && (
          <p class="bd-pub-state" data-tone="note">
            The team's shared copy has nothing in it yet. Publish can't set it up.
          </p>
        )}
        {preview.teamUnseen && (
          <p class="bd-pub-state" data-tone="note">
            This computer hasn't seen the team's shared copy yet. Sync first.
          </p>
        )}
        {!preview.head && (
          <p class="bd-pub-state" data-tone="note">
            Couldn't confirm this list is current. Close and try again.
          </p>
        )}
        <ul class="bd-pub-list" aria-label={`${changesText(preview.total)} to publish`}>
          {preview.changes.map((change, i) => (
            <ChangeItem key={change.commit || i} change={change} titleOf={titleOf} panelActor={panelActor} now={now} />
          ))}
        </ul>
        {preview.total > preview.changes.length && <p class="bd-pub-rest">{`and ${preview.total - preview.changes.length} more`}</p>}
        <p class="bd-pub-note">
          <span>Changes made in the moment Publish runs may go with them.</span> <span>{AGENT_NOTE}</span>
        </p>
      </>
    );
  }

  return (
    <div class="bd-sheet">
      <div class="bd-scrim" aria-hidden="true" onClick={() => sync.closePublish()} />
      <div
        ref={dialog}
        class="bd-create bd-pub"
        role="dialog"
        aria-modal="true"
        aria-label="Publish to the team"
        aria-describedby={preview.kind === 'ready' && preview.notice ? NOTICE_ID : undefined}
        aria-busy={preview.kind === 'loading'}
        onKeyDown={(e) => {
          trapTab(e, dialog.current);
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          sync.closePublish();
        }}
      >
        <div class="bd-wt-head">
          <span class="bd-wt-ic" aria-hidden="true">
            <IconPublish size={15} />
          </span>
          <div class="bd-wt-headtext">
            <h2 class="bd-wt-title">Publish to the team</h2>
            <p class="bd-pub-lead">These changes go to the team's shared copy.</p>
          </div>
        </div>
        {body}
        <div class="bd-edacts">
          <button ref={cancel} type="button" class="bd-btn bd-btn-sm" onClick={() => sync.closePublish()}>
            {ready || preview.kind === 'loading' ? 'Cancel' : 'Close'}
          </button>
          {ready && (
            <button
              ref={confirm}
              type="button"
              class="bd-btn bd-btn-sm bd-btn-primary"
              disabled={confirmOff}
              onClick={() => {
                if (Date.now() - shownAt.current < CONFIRM_GUARD_MS) return;
                void sync.confirmPublish();
              }}
            >
              {`Publish ${changesText(preview.total)}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
