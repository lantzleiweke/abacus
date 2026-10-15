import { useState } from 'preact/hooks';
import type { ConflictInfo, JsonValue, StatusDef } from '../../shared/types';
import { SYNC_ITEM, useAgent, useAgentState } from '../agent';
import { humanize, shortId, statusLabel } from '../list';
import { useStore } from '../store';
import { problemMessage, syncProblem, useSync, useSyncUi, type SyncProblem } from '../sync';
import { IconAlert, IconChat, IconCopy, IconSession, IconSpinner, IconX } from './icons';

/** Values longer than this are cut, with Show all. */
const VALUE_MAX = 64;
/** Conflicting beads shown before "Show N more". */
const BEADS_SHOWN = 3;

const TITLES: Record<SyncProblem['kind'], string> = {
  conflict: 'Sync needs attention',
  error: 'Sync ran into a problem',
  'paused-upgrade': 'Sync is paused',
};

const isRecord = (value: JsonValue): value is Record<string, JsonValue> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** One side's value in words: statuses and priorities as the list shows them, nothing as "none", the rest as written. */
function valueText(field: string | null, value: JsonValue | undefined, statuses: StatusDef[]): string {
  if (value === undefined || value === null) return 'none';
  if (value === '') return 'empty';
  if (field === 'status' && typeof value === 'string') return statusLabel(value, statuses);
  if (field === 'priority' && typeof value === 'number') return `P${value}`;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** The fields both sides changed, with each side's value. A side that is not a field map shows as one unnamed row. */
function fieldsOf(info: ConflictInfo): Array<{ field: string | null; ours: JsonValue | undefined; theirs: JsonValue | undefined }> {
  if (isRecord(info.ours) || isRecord(info.theirs)) {
    const ours = isRecord(info.ours) ? info.ours : {};
    const theirs = isRecord(info.theirs) ? info.theirs : {};
    return [...new Set([...Object.keys(ours), ...Object.keys(theirs)])].map((field) => ({ field, ours: ours[field], theirs: theirs[field] }));
  }
  return [{ field: null, ours: info.ours, theirs: info.theirs }];
}

function FieldRow({ field, ours, theirs }: { field: string | null; ours: string; theirs: string }) {
  const [open, setOpen] = useState(false);
  const long = ours.length > VALUE_MAX || theirs.length > VALUE_MAX;
  const cut = (text: string) => (open || text.length <= VALUE_MAX ? text : `${text.slice(0, VALUE_MAX).trimEnd()}…`);
  return (
    <div class="bd-sc-field" data-open={open || undefined}>
      {field !== null && <dt>{humanize(field)}</dt>}
      <dd>
        <span class="bd-sc-side">Local</span>
        <span class="bd-sc-val">{cut(ours)}</span>
      </dd>
      <dd>
        <span class="bd-sc-side" data-side="team">
          Team
        </span>
        <span class="bd-sc-val">{cut(theirs)}</span>
      </dd>
      {long && (
        <button type="button" class="bd-link bd-sc-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  );
}

function ConflictBeads({ beads, statuses, titleOf }: { beads: ConflictInfo[]; statuses: StatusDef[]; titleOf(id: string): string | null }) {
  const [all, setAll] = useState(false);
  if (beads.length === 0) return <p class="bd-sc-none">Couldn't tell which beads are affected. Copy details has the full record.</p>;
  const shown = all ? beads : beads.slice(0, BEADS_SHOWN);
  return (
    <>
      <ul class="bd-sc-beads" aria-label="Beads changed on both sides" data-all={all || undefined}>
        {shown.map((info) => (
          <li key={info.beadId} class="bd-sc-bead">
            <div class="bd-sc-beadhead">
              <span class="bd-id">{shortId(info.beadId)}</span>
              <span class="bd-sc-title">{info.title ?? titleOf(info.beadId) ?? ''}</span>
            </div>
            <dl class="bd-sc-fields">
              {fieldsOf(info).map((f) => (
                <FieldRow key={f.field ?? ''} field={f.field} ours={valueText(f.field, f.ours, statuses)} theirs={valueText(f.field, f.theirs, statuses)} />
              ))}
            </dl>
          </li>
        ))}
      </ul>
      {beads.length > BEADS_SHOWN && (
        <button type="button" class="bd-link bd-sc-morebeads" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show ${beads.length - BEADS_SHOWN} more`}
        </button>
      )}
    </>
  );
}

/**
 * Under the header while the last sync stopped: what happened in plain words, the beads both sides changed (for a
 * conflict), and the ways on: hand it all to the agent, or copy the raw record. Nothing is resolved from here.
 */
export function SyncCard() {
  const { snapshot, detail } = useStore();
  const sync = useSync();
  const agent = useAgent();
  const { session, busy } = useAgentState();
  const { dismissed } = useSyncUi();
  /** The person's choice to show or hide the beads; until then they show over the list and fold away over a bead's detail. */
  const [showBeads, setShowBeads] = useState<boolean | null>(null);
  const problem = syncProblem(snapshot);
  if (!problem || !snapshot) return null;
  // The error the person put away; the controller forgets it once a new job of this panel is answered as running, or the project changes.
  if (problem.kind === 'error' && dismissed?.kind === 'error' && dismissed.message === problem.message && dismissed.log === problem.log) return null;

  const title = TITLES[problem.kind];
  const mine = busy?.id === SYNC_ITEM ? busy.kind : null;
  const titleOf = (id: string) => snapshot.beads.find((b) => b.id === id)?.title ?? null;
  const tone = problem.kind === 'error' ? 'error' : problem.kind === 'conflict' && !problem.halfMerged ? 'calm' : 'warn';
  return (
    <section class="bd-synccard" role="region" aria-label={title} data-tone={tone}>
      <div class="bd-sc-head">
        <span class="bd-sc-ic" aria-hidden="true">
          <IconAlert size={13} />
        </span>
        <b class="bd-sc-name">{title}</b>
        {problem.kind === 'error' && sync && (
          <button type="button" class="bd-iconbtn bd-iconbtn-sm bd-sc-close" aria-label="Dismiss" title="Dismiss" onClick={() => sync?.dismiss(problem)}>
            <IconX />
          </button>
        )}
      </div>
      <p class="bd-sc-msg">{problemMessage(problem)}</p>
      {problem.kind === 'conflict' && problem.beads.length > 0 && (
        <button type="button" class="bd-link bd-sc-toggle" aria-expanded={showBeads ?? detail === null} onClick={() => setShowBeads(!(showBeads ?? detail === null))}>
          {(showBeads ?? detail === null) ? 'Hide beads' : problem.beads.length === 1 ? 'Show the bead' : `Show the ${problem.beads.length} beads`}
        </button>
      )}
      {problem.kind === 'conflict' && (problem.beads.length === 0 || (showBeads ?? detail === null)) && (
        <ConflictBeads beads={problem.beads} statuses={snapshot.statuses} titleOf={titleOf} />
      )}
      <div class="bd-sc-acts">
        {agent &&
          (session ? (
            <button type="button" class="bd-btn bd-btn-sm bd-btn-primary" disabled={busy !== null} onClick={() => void agent.attachSync()}>
              {mine === 'attach' ? <IconSpinner size={12} /> : <IconChat size={12} />}
              {mine === 'attach' ? 'Adding…' : 'Hand to agent'}
            </button>
          ) : (
            <button type="button" class="bd-btn bd-btn-sm bd-btn-primary" disabled={busy !== null} onClick={() => void agent.startSyncSession()}>
              {mine === 'session' ? <IconSpinner size={12} /> : <IconSession size={12} />}
              {mine === 'session' ? 'Starting…' : 'Start session with this'}
            </button>
          ))}
        {sync && (
          <button type="button" class="bd-btn bd-btn-sm" onClick={() => sync.copyDetails(problem)}>
            <IconCopy size={12} />
            Copy details
          </button>
        )}
        <span class="bd-sc-hint">{session || !agent ? 'Nothing is sent until you send it.' : 'No open chat.'}</span>
      </div>
    </section>
  );
}
