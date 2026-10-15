import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Bead, HistoryChange, HistoryEntry, JsonValue, StatusDef } from '../../shared/types';
import { fullText, personName, recordedDate, timeText } from '../format';
import { gateEventWords } from '../gates';
import { freshChange, groupByDay, lineDiff, restoreRequest, restoreState, type DiffRow } from '../history';
import { humanize, looker, shortId, statusLabel } from '../list';
import { useStoreApi, type PanelError } from '../store';
import { IconRestore, IconWait } from './icons';
import { feedbackOf, WriteMessage, type Feedback } from './writes';

// ------------------------------------------------------------------------------------------------- words

const FIELD_NAMES: Record<string, string> = {
  title: 'Title',
  status: 'Status',
  priority: 'Priority',
  type: 'Type',
  assignee: 'Assignee',
  labels: 'Labels',
  description: 'Description',
  design: 'Design',
  acceptance: 'Acceptance',
  notes: 'Notes',
  closeReason: 'Close reason',
};

export const fieldName = (field: string): string => FIELD_NAMES[field] ?? humanize(field);

/** A field's name inside a sentence: "priority", "acceptance criteria". */
export const fieldWord = (field: string): string => (field === 'acceptance' ? 'acceptance criteria' : fieldName(field).toLowerCase());

const EXCERPT = 80;
const firstLine = (text: string): string => {
  const line = text.trim().split('\n')[0]!.trim();
  return line.length > EXCERPT ? `${line.slice(0, EXCERPT).trimEnd()}…` : line;
};

/** One value of a field in words: a status by its label, a priority as P1, nobody, no labels, the first line of a text. */
export function valueWords(field: string, value: JsonValue | undefined, statuses: StatusDef[]): string {
  if (value === undefined) return 'not recorded';
  switch (field) {
    case 'status':
      return typeof value === 'string' && value ? statusLabel(value, statuses) : 'none';
    case 'priority':
      return typeof value === 'number' ? `P${value}` : 'none';
    case 'assignee':
      return typeof value === 'string' && value ? value : 'nobody';
    case 'labels':
      return Array.isArray(value) ? (value.length ? value.join(', ') : 'no labels') : 'not recorded';
    case 'type':
      return typeof value === 'string' && value ? humanize(value) : 'none';
  }
  if (typeof value === 'string') return value.trim() ? firstLine(value) : 'empty';
  return value === null ? 'none' : JSON.stringify(value);
}

/** What a bead holds now for a restorable field, as a history value. */
const valueNow = (bead: Bead, field: string): JsonValue | undefined => (Object.hasOwn(bead, field) ? (bead[field as keyof Bead] as JsonValue) : undefined);

/** Shown for a change whose author Beads does not know here. */
export const UNKNOWN_WHO = 'someone else or another computer';
const UNKNOWN_WHY = 'Beads keeps who made a change only on the computer where it was made.';

// ------------------------------------------------------------------------------------------------- restore

/** How a restore went: in, refused because the bead moved on (`current` is it now), or a message to show. */
export type RestoreOutcome = { kind: 'done' } | { kind: 'refused'; current: Bead } | { kind: 'note'; feedback: Feedback };

export type RestoreKit = {
  busy(key: string): boolean;
  outcome(key: string): RestoreOutcome | null;
  /** Puts `change`'s old value back on `on`, expecting the value the change left: refused, never forced, if the bead moved on. */
  restore(key: string, on: Bead, change: HistoryChange): void;
  /** The person's decision once the panel knows the field holds something else: shown, nothing written. */
  hold(key: string, current: Bead): void;
  dismiss(key: string): void;
};

/** The id a restore control carries, so focus can come back to it after its write. */
export const restoreDomId = (scope: string, key: string) => `bd-rs-${scope}-${key.replace(/[^\w-]/g, '_')}`;

/**
 * Restores, guarded per change (a second click while one runs does nothing). Answers for another bead or project are dropped by
 * the caller remounting this per bead; the store drops answers for another project. Nothing is ever sent again on its own.
 */
export function useRestore(scope: string, options: { focusChoice?: boolean } = {}): RestoreKit {
  const store = useStoreApi();
  const inflight = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [outcomes, setOutcomes] = useState<Record<string, RestoreOutcome>>({});
  const live = useRef(true);
  const refocus = useRef<string | null>(null);
  /** The next refocus goes to a choice the person has to make, wherever focus is (the Activity bar, away from the feed). */
  const toChoice = useRef(false);
  useEffect(() => () => void (live.current = false), []);
  useLayoutEffect(() => {
    const key = refocus.current;
    if (key === null) return;
    refocus.current = null;
    const force = toChoice.current;
    toChoice.current = false;
    const active = document.activeElement;
    if (!force && active && active !== document.body) return;
    // The control that was pressed went away or was disabled while the write ran: focus goes to what replaced it.
    const box = document.getElementById(restoreDomId(scope, key));
    // A refusal protects newer work: focus goes to its message, never to "Restore anyway", so a double Enter cannot overwrite what it warns about.
    if (box?.hasAttribute('data-refused')) box.focus({ preventScroll: true });
    else (box?.querySelector<HTMLElement>('button:not(:disabled)') ?? box)?.focus({ preventScroll: true });
  });
  const settle = (key: string, outcome: RestoreOutcome | null) => {
    setOutcomes((all) => {
      const next = { ...all };
      if (outcome) next[key] = outcome;
      else delete next[key];
      return next;
    });
  };
  return {
    busy: (key) => busy.has(key),
    outcome: (key) => outcomes[key] ?? null,
    restore: (key, on, change) => {
      const request = restoreRequest(on, change);
      if (!request || inflight.current.has(key)) return;
      inflight.current.add(key);
      setBusy(new Set(inflight.current));
      settle(key, null);
      void store.update(request.id, request.expectedUpdatedAt, request.patch, request.expected).then((outcome) => {
        inflight.current.delete(key);
        if (!live.current) return;
        setBusy(new Set(inflight.current));
        if (outcome.kind === 'dropped') return;
        settle(key, outcome.kind === 'ok' ? { kind: 'done' } : outcome.kind === 'conflict' ? { kind: 'refused', current: outcome.current } : { kind: 'note', feedback: feedbackOf(outcome) });
        refocus.current = key;
        toChoice.current = options.focusChoice === true && outcome.kind === 'conflict';
      });
    },
    hold: (key, current) => {
      settle(key, { kind: 'refused', current });
      refocus.current = key;
      toChoice.current = options.focusChoice === true;
    },
    dismiss: (key) => {
      settle(key, null);
      refocus.current = key;
    },
  };
}

type RestoreProps = {
  kit: RestoreKit;
  scope: string;
  rkey: string;
  bead: Bead;
  change: HistoryChange;
  statuses: StatusDef[];
  paused: string | null;
  reword?: (message: string) => string;
  /** Already inside a group that names the field (the Activity bar): no second one. */
  grouped?: boolean;
  /** After Keep current, when the control lives somewhere that closes then (the Activity bar). */
  onKeep?(): void;
};

/**
 * The restore control of one change and what its write said. A change the bead has moved past is never sent as it is: the person
 * sees what the field holds now and can restore over that (a new restore that expects the current value), or keep it.
 */
export function RestoreControl({ kit, scope, rkey, bead, change, statuses, paused, reword, grouped = false, onKeep }: RestoreProps) {
  const outcome = kit.outcome(rkey);
  const busy = kit.busy(rkey);
  const id = restoreDomId(scope, rkey);
  const word = fieldWord(change.field);
  const off = paused !== null || busy;
  // The group around these says which field; each button's name is its own words.
  const button = (label: string, run: () => void, primary = false) => (
    <button type="button" class={primary ? 'bd-btn bd-btn-sm bd-btn-primary' : 'bd-btn bd-btn-sm'} disabled={off} aria-busy={busy || undefined} title={paused ?? undefined} onClick={run}>
      {label}
    </button>
  );

  if (outcome?.kind === 'done') {
    return (
      <div id={id} class="bd-rs" tabIndex={-1}>
        <p class="bd-rs-msg" data-tone="done" role="status">
          {`Restored the earlier ${word}.`}
        </p>
      </div>
    );
  }
  if (outcome?.kind === 'refused') {
    const current = outcome.current;
    const state = restoreState(current, change);
    const held = valueNow(current, change.field);
    const now = valueWords(change.field, held, statuses);
    // A long text is never judged on its first line: what "Restore anyway" would do to the whole text is shown, line by line.
    const text = change.text && typeof held === 'string' && typeof change.from === 'string';
    const preview = text && (
      <div class="bd-rs-diff">
        <p class="bd-rs-msg">Restoring would change it like this:</p>
        <TextDiff from={held as string} to={change.from as string} />
      </div>
    );
    const again = freshChange(current, change);
    // Nothing that could be sent (a value of a kind the panel cannot write): said, never a button that does nothing.
    const sendable = restoreRequest(current, state === 'ready' ? change : again) !== null;
    const acts = (run: () => void) =>
      sendable ? (
        <div class="bd-rs-acts">
          {button('Restore anyway', run, true)}
          {button('Keep current', () => (onKeep ? onKeep() : kit.dismiss(rkey)))}
        </div>
      ) : (
        <p class="bd-rs-msg">{`The ${word} it holds now cannot be put back from here.`}</p>
      );
    return (
      <div id={id} class="bd-rs" data-refused tabIndex={-1} {...(grouped ? {} : { role: 'group', 'aria-label': `Restore ${word}` })}>
        {state === 'unchanged' ? (
          <p class="bd-rs-msg" role="status">{`The ${word} is already the earlier value.`}</p>
        ) : state === 'ready' ? (
          <>
            <p class="bd-rs-msg" role="alert">
              {text ? `This bead changed since it was shown. The ${word} has not. Nothing was changed.` : `This bead changed since it was shown. The ${word} is still ${now}. Nothing was changed.`}
            </p>
            {preview}
            {acts(() => kit.restore(rkey, current, change))}
          </>
        ) : (
          <>
            <p class="bd-rs-msg" role="alert">
              <b>{`The ${word} was changed again since.`}</b> {!text && <span>{`Now: ${now}.`}</span>} <span>Nothing was changed.</span>
            </p>
            {preview}
            {acts(() => kit.restore(rkey, current, again))}
          </>
        )}
      </div>
    );
  }

  const state = restoreState(bead, change);
  if (state === 'never') {
    return change.truncated ? (
      <span id={id} class="bd-rs-tag" title="Only the start of this text is shown here, so it cannot be put back from here.">
        Too long to restore here
      </span>
    ) : null;
  }
  if (state === 'unchanged') {
    return (
      <span id={id} class="bd-rs-tag">
        Already the earlier value
      </span>
    );
  }
  return (
    <div id={id} class="bd-rs" data-state={state}>
      <button
        type="button"
        class="bd-rs-btn"
        aria-label={`Restore previous ${word}`}
        title={paused ?? (state === 'changed' ? `The ${word} was changed again since. You choose before anything is written.` : `Put the earlier ${word} back`)}
        disabled={off}
        aria-busy={busy || undefined}
        // Moved on since: show what it holds now and let the person decide; a write would only be refused.
        onClick={() => (state === 'changed' ? kit.hold(rkey, bead) : kit.restore(rkey, bead, change))}
      >
        <IconRestore size={12} />
        <span>{busy ? 'Restoring…' : 'Restore'}</span>
      </button>
      {outcome?.kind === 'note' && <WriteMessage feedback={outcome.feedback} reword={reword} />}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- one change

const MAX_DIFF_ROWS = 14;

/** A long text's change as a compact diff: removed and added lines, unchanged runs folded. Long diffs show their start first. */
function TextDiff({ from, to }: { from: string; to: string }) {
  // The detail redraws on a clock; the diff only changes with its texts.
  const rows = useMemo(() => lineDiff(from, to), [from, to]);
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, MAX_DIFF_ROWS);
  const hidden = rows.length - shown.length;
  const line = (row: DiffRow, i: number) =>
    row.kind === 'skip' ? (
      <li key={i} class="bd-diff-skip">
        {row.count === 1 ? '1 unchanged line' : `${row.count} unchanged lines`}
      </li>
    ) : (
      <li key={i} class="bd-diff-line" data-kind={row.kind}>
        <span class="bd-vh">{row.kind === 'add' ? 'Added: ' : row.kind === 'del' ? 'Removed: ' : ''}</span>
        <span aria-hidden="true" class="bd-diff-mark">
          {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}
        </span>
        <span class="bd-diff-t">{row.text || ' '}</span>
      </li>
    );
  return (
    <div class="bd-diff">
      <ul role="list" class="bd-diff-rows">
        {shown.map(line)}
      </ul>
      {hidden > 0 && (
        <button type="button" class="bd-link bd-diff-more" onClick={() => setAll(true)}>
          {`Show ${hidden} more ${hidden === 1 ? 'line' : 'lines'}`}
        </button>
      )}
    </div>
  );
}

function Values({ change, statuses }: { change: HistoryChange; statuses: StatusDef[] }) {
  const { field, from, to } = change;
  if (field === 'status' && typeof from === 'string' && typeof to === 'string') {
    const look = looker(statuses);
    return (
      <span class="bd-hv">
        <span class="bd-hv-old" data-look={look(from)}>
          {statusLabel(from, statuses)}
        </span>
        {/* The arrow travels with the new value: a narrow line breaks before it, never after. */}
        <span class="bd-hv-to">
          <span class="bd-hv-arrow" aria-hidden="true">→</span>
          <span class="bd-vh">to</span>
          <span class="bd-hv-new" data-look={look(to)}>
            {statusLabel(to, statuses)}
          </span>
        </span>
      </span>
    );
  }
  if (field === 'labels' && Array.isArray(from) && Array.isArray(to)) {
    const added = to.filter((l) => !from.includes(l));
    const removed = from.filter((l) => !to.includes(l));
    return (
      <span class="bd-hv bd-hv-labels">
        {added.map((l) => (
          <span key={`+${l}`} class="bd-lb" data-diff="add">
            <span class="bd-vh">Added </span>
            {String(l)}
          </span>
        ))}
        {removed.map((l) => (
          <span key={`-${l}`} class="bd-lb" data-diff="del">
            <span class="bd-vh">Removed </span>
            {String(l)}
          </span>
        ))}
      </span>
    );
  }
  // Titles and other values that can run long read better one above the other.
  const stacked = field === 'title' || field === 'closeReason' || (typeof from === 'string' && from.length > 24) || (typeof to === 'string' && to.length > 24);
  return (
    <span class="bd-hv" data-stacked={stacked || undefined}>
      <span class="bd-hv-old">
        <span class="bd-vh">From </span>
        {valueWords(field, from, statuses)}
      </span>
      <span class="bd-hv-to">
        {!stacked && (
          <span class="bd-hv-arrow" aria-hidden="true">
            →
          </span>
        )}
        <span class="bd-hv-new">
          <span class="bd-vh">to </span>
          {valueWords(field, to, statuses)}
        </span>
      </span>
    </span>
  );
}

type ChangeProps = {
  entry: HistoryEntry;
  change: HistoryChange;
  bead: Bead;
  kit: RestoreKit;
  statuses: StatusDef[];
  paused: string | null;
  reword?: (message: string) => string;
};

function ChangeRow({ entry, change, bead, kit, statuses, paused, reword }: ChangeProps) {
  const key = `${entry.id}:${change.field}`;
  const restorable = entry.restorable.includes(change.field);
  const control = restorable || change.truncated ? <RestoreControl kit={kit} scope="h" rkey={key} bead={bead} change={change} statuses={statuses} paused={paused} reword={reword} /> : null;
  const text = change.text && typeof change.from === 'string' && typeof change.to === 'string';
  return (
    <li class="bd-hc" data-field={change.field} data-text={text || undefined}>
      <span class="bd-hc-f">{fieldName(change.field)}</span>
      {text ? <span class="bd-hc-what">{change.to === '' ? 'Cleared' : change.from === '' ? 'Added' : 'Edited'}</span> : <Values change={change} statuses={statuses} />}
      {control && <span class="bd-hc-act">{control}</span>}
      {text && (
        <div class="bd-hc-diff">
          <TextDiff from={change.from as string} to={change.to as string} />
          {change.truncated && <p class="bd-hc-cut">Only the start of this text is shown.</p>}
        </div>
      )}
    </li>
  );
}

// ------------------------------------------------------------------------------------------------- one entry

type EntryProps = { entry: HistoryEntry; bead: Bead; kit: RestoreKit; statuses: StatusDef[]; panel: string | null; paused: string | null; reword?: (message: string) => string };

/** A close or reopen: `bd close` records no value Beads can tie to a version, so who did it is never guessed (nor called someone else). */
const closes = (entry: HistoryEntry, statuses: StatusDef[]): boolean => {
  const look = looker(statuses);
  return entry.changes.some((c) => c.field === 'status' && [c.from, c.to].some((v) => typeof v === 'string' && look(v) === 'done'));
};

function Who({ actor, panel }: { actor: string | null; panel: string | null }) {
  if (actor) return <span class="bd-he-who">{personName(actor, panel)}</span>;
  return (
    <span class="bd-he-who" data-unknown title={UNKNOWN_WHY}>
      {UNKNOWN_WHO}
    </span>
  );
}

function Entry({ entry, bead, kit, statuses, panel, paused, reword }: EntryProps) {
  const date = recordedDate(entry.at);
  const time = (
    <time class="bd-he-time" dateTime={entry.at} title={date ? fullText(date) : undefined}>
      {date ? timeText(date) : entry.at}
    </time>
  );
  if (entry.gate) {
    const g = entry.gate;
    const { head, by } = gateEventWords({ ...g, actor: entry.actor });
    // Asked by and unlinked by whoever the log names; a resolve by someone else already says who; a deleted gate names no one.
    const who = by === null && g.what !== 'deleted' && (entry.actor || g.byPanel) ? personName(entry.actor, panel) : null;
    const reason = g.reason ? g.reason.trim().split('\n')[0] : '';
    return (
      <li class="bd-he" data-kind="gate" data-what={g.what}>
        <div class="bd-he-top">
          {time}
          {who && <span class="bd-he-who">{who}</span>}
        </div>
        <p class="bd-he-gate">
          <IconWait size={12} />
          <span>{by ? `${head} by ${by}` : head}</span>
        </p>
        {reason && <p class="bd-he-reason">{reason}</p>}
      </li>
    );
  }
  if (entry.created) {
    return (
      <li class="bd-he" data-kind="created">
        <div class="bd-he-top">
          {time}
          <Who actor={entry.actor} panel={panel} />
        </div>
        <p class="bd-he-gate">
          <span>Created</span>
        </p>
      </li>
    );
  }
  const quiet = !entry.actor && closes(entry, statuses);
  return (
    <li class="bd-he" data-kind="change">
      <div class="bd-he-top">
        {time}
        {!quiet && <Who actor={entry.actor} panel={panel} />}
      </div>
      <ul role="list" class="bd-hcs">
        {entry.changes.map((change) => (
          <ChangeRow key={change.field} entry={entry} change={change} bead={bead} kit={kit} statuses={statuses} paused={paused} reword={reword} />
        ))}
      </ul>
    </li>
  );
}

// ------------------------------------------------------------------------------------------------- section

type Loaded = { entries: HistoryEntry[]; more: boolean; labelsKnown: boolean; at: string };

type HistoryProps = {
  bead: Bead;
  /** The section is open: the first page is read the first time this turns true, never before and never again on its own. */
  open: boolean;
  statuses: StatusDef[];
  panel: string | null;
  paused: string | null;
  now: number;
  reword?: (message: string) => string;
};

/**
 * A bead's past versions, newest first by day: who changed what, from what to what, with Restore on what can be put back. Read when
 * the section first opens and when the person asks (Load older, Refresh); never polled. Mount one per bead.
 */
export function History({ bead, open, statuses, panel, paused, now, reword }: HistoryProps) {
  const store = useStoreApi();
  const kit = useRestore('h');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reading, setReading] = useState<'first' | 'older' | null>(null);
  const [error, setError] = useState<{ error: PanelError; older: boolean } | null>(null);
  const live = useRef(true);
  useEffect(() => () => void (live.current = false), []);

  const read = async (older: boolean) => {
    if (reading) return;
    const before = older ? loaded?.entries.at(-1)?.id : undefined;
    setReading(older ? 'older' : 'first');
    setError(null);
    const shownAt = bead.updatedAt;
    const outcome = await store.readHistory({ id: bead.id, ...(before ? { before } : {}) });
    if (!live.current) return;
    setReading(null);
    if (outcome.kind === 'dropped') return;
    if (outcome.kind === 'error') {
      setError({ error: outcome.error, older });
      return;
    }
    const page = outcome.value;
    setLoaded((prev) => {
      if (!older || !prev) return { entries: page.entries, more: page.more, labelsKnown: page.labelsKnown, at: shownAt };
      const seen = new Set(prev.entries.map((e) => e.id));
      return { ...prev, entries: [...prev.entries, ...page.entries.filter((e) => !seen.has(e.id))], more: page.more, labelsKnown: prev.labelsKnown && page.labelsKnown };
    });
  };

  useEffect(() => {
    if (open && !loaded && !reading && !error) void read(false);
  }, [open]);

  if (!loaded) {
    if (error) {
      return (
        <div class="bd-hist-err" role="alert">
          <span>{error.error.message}</span>
          <button type="button" class="bd-btn bd-btn-sm" onClick={() => void read(false)}>
            Try again
          </button>
        </div>
      );
    }
    return (
      <p class="bd-hist-load" role="status">
        <span class="bd-spin" aria-hidden="true" />
        Reading history…
      </p>
    );
  }

  const groups = groupByDay(loaded.entries, now);
  const newer = bead.updatedAt !== loaded.at;
  return (
    <div class="bd-hist" aria-busy={reading !== null || undefined}>
      {newer && (
        <p class="bd-hist-newer" role="status">
          <span>This bead changed since its history was read.</span>
          <button type="button" class="bd-link" disabled={reading !== null} onClick={() => void read(false)}>
            Refresh
          </button>
        </p>
      )}
      {loaded.entries.length === 0 && <p class="bd-hist-none">No earlier versions.</p>}
      {groups.map((group) => {
        const head = `bd-hday-${shortId(bead.id)}-${group.key}`;
        return (
          <div key={group.key} class="bd-hday">
            <h4 class="bd-hday-h" id={head}>
              {group.label}
            </h4>
            <ul role="list" class="bd-hes" aria-labelledby={head}>
              {group.entries.map((entry) => (
                <Entry key={entry.id} entry={entry} bead={bead} kit={kit} statuses={statuses} panel={panel} paused={paused} reword={reword} />
              ))}
            </ul>
          </div>
        );
      })}
      {!loaded.labelsKnown && <p class="bd-hist-note">Label changes are not listed: Beads has no record of them on this computer.</p>}
      {error?.older && (
        <div class="bd-hist-err" role="alert">
          <span>{error.error.message}</span>
        </div>
      )}
      {loaded.more && (
        <button type="button" class="bd-btn bd-btn-sm bd-hist-older" disabled={reading !== null} aria-busy={reading === 'older' || undefined} onClick={() => void read(true)}>
          {reading === 'older' ? 'Loading…' : 'Load older'}
        </button>
      )}
    </div>
  );
}
