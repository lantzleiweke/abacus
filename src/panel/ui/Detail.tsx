import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Bead, StatusDef } from '../../shared/types';
import { acceptanceItems, changeLine, closedAt, closeReason, recordedDay, moreFields, newerBead, personName, when, type ChangeLine } from '../detail';
import { relatedFor } from '../../shared/related';
import { writesPaused } from '../edit';
import { isConfirmKey } from '../keyboard';
import { childId, classifier, humanize, looker, markerOf, nearestEpic, shortId, statusLabel } from '../list';
import { useNow, useOverlay, useStore, useStoreApi } from '../store';
import { Comments } from './Comments';
import { NewBeadButton } from './CreateForm';
import { AssigneePicker, CommentComposer, LabelsEditor, LinkAdder, PriorityMenu, StatusMenu, TextEditor, type TextField } from './Editors';
import { InlineNotice, PausedNote, useInlineWrites } from './writes';
import { IconBack, IconChevron, IconClock, IconCopy, IconEdit, IconEpic, IconWait, IconX, TypeIcon } from './icons';
import { Markdown } from './Markdown';
import { Relationships } from './Relationships';
import { StatusDot } from './Row';

/** The bead's own status as Beads has it, in words and its icon. Task 15 turns this into the status menu. */
function StatusPill({ status, statuses }: { status: string; statuses: StatusDef[] }) {
  const look = looker(statuses)(status);
  return (
    <span class="bd-pill" data-look={look} title={status}>
      <StatusDot look={look} marker={markerOf(status)} />
      {statusLabel(status, statuses)}
    </span>
  );
}

/** First line of a text section, plain, for a folded section's preview. */
const peekOf = (text: string) =>
  text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:#+|>|[-*+]|\d+[.)])\s*(?:\[[ xX]\]\s*)?/, '').replace(/[*_`~]/g, '').trim())
    .find(Boolean) ?? '';

type SectionProps = {
  id: string;
  title: string;
  note?: string;
  peek?: string;
  folded?: boolean;
  /** Beside the heading, for example its Edit button. */
  action?: ComponentChildren;
  /** Being edited: held open. */
  editing?: boolean;
  children: ComponentChildren;
};

/** A collapsible section: the heading folds it; a folded one keeps a one-line preview when it has one. */
function Section({ id, title, note, peek, folded = false, action, editing = false, children }: SectionProps) {
  const [isFolded, setFolded] = useState(folded);
  const open = editing || !isFolded;
  const bodyId = `bd-sec-${id}`;
  return (
    <section class="bd-sec" data-section={id} data-open={open || undefined} data-editing={editing || undefined}>
      <h3 class="bd-sh">
        <button type="button" class="bd-sh-tog" aria-expanded={open} aria-controls={bodyId} disabled={editing} onClick={() => setFolded((f) => !f)}>
          <span class="bd-chev">
            <IconChevron />
          </span>
          <span class="bd-sh-t">{title}</span>
          {note && <span class="bd-n">{note}</span>}
          {!open && peek && <span class="bd-peek">{peek}</span>}
        </button>
        {!editing && action}
      </h3>
      <div id={bodyId} class="bd-sec-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** The text parts of a bead, in reading order. Design and Notes start folded; `chip` is the short name in the Add row. */
const TEXT_SECTIONS: Array<{ field: Exclude<TextField, 'title'>; title: string; chip: string; folded?: true }> = [
  { field: 'description', title: 'Description', chip: 'Description' },
  { field: 'acceptance', title: 'Acceptance criteria', chip: 'Acceptance' },
  { field: 'design', title: 'Design', chip: 'Design', folded: true },
  { field: 'notes', title: 'Notes', chip: 'Notes', folded: true },
];
const EDITABLE: readonly TextField[] = ['title', ...TEXT_SECTIONS.map((s) => s.field)];

function Acceptance({ text }: { text: string }) {
  const items = acceptanceItems(text);
  if (!items) return <Markdown class="bd-txt" text={text} />;
  return (
    <ul class="bd-ac">
      {items.map((item, i) => (
        <li key={i} data-done={item.done || undefined}>
          <span class="bd-ac-box" role="img" aria-label={item.done ? 'Done' : 'Not done yet'} />
          <Markdown inline text={item.text} />
        </li>
      ))}
    </ul>
  );
}

/** Asked before an unsaved draft would be dropped: Back, another bead, another section's editor. */
function LeaveConfirm({ onKeep, onDiscard }: { onKeep(): void; onDiscard(): void }) {
  // Focus goes to the question itself, not a button: Enter there answers yes (Discard), as on every confirm question.
  // Tab reaches both buttons, and Enter on a focused button presses that button.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  return (
    <div
      ref={box}
      tabIndex={-1}
      class="bd-confirm bd-leave"
      role="alertdialog"
      aria-label="Discard your changes?"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onKeep();
        } else if (isConfirmKey(e)) {
          e.preventDefault();
          e.stopPropagation();
          onDiscard();
        }
      }}
    >
      <span>Discard your changes?</span>
      <button type="button" class="bd-btn bd-btn-sm" onClick={onKeep}>
        Keep editing
      </button>
      <button type="button" class="bd-btn bd-btn-sm" data-tone="danger" onClick={onDiscard}>
        Discard
      </button>
    </div>
  );
}

/** The arrow is drawn for the eye; screen readers hear "to". */
const Arrow = () => (
  <>
    <span aria-hidden="true">→</span>
    <span class="bd-vh">to</span>{' '}
  </>
);

/** Text with each " → " read as "to". */
const arrowed = (text: string) =>
  text.split(' → ').map((part, i) => (
    <>
      {i > 0 && (
        <>
          {' '}
          <Arrow />
        </>
      )}
      {part}
    </>
  ));

function Banner({ line, onDismiss }: { line: ChangeLine; onDismiss(): void }) {
  return (
    <div class="bd-banner" role="status" aria-label="Change since you last looked">
      <span class="bd-banner-txt">
        {line.to !== undefined ? (
          <>
            {`${line.lead}: ${line.from} `}
            <Arrow />
            <span class="bd-banner-to" data-look={line.toLook}>
              {line.to}
            </span>
          </>
        ) : line.what ? (
          arrowed(`${line.lead}: ${line.what}`)
        ) : (
          line.lead
        )}
      </span>
      <button type="button" class="bd-banner-x" aria-label="Dismiss" onClick={onDismiss}>
        <IconX />
      </button>
    </div>
  );
}

const isField = (el: Element | null) => !!el && (el instanceof HTMLElement && el.isContentEditable ? true : !!el.closest('input, textarea, select'));

type DetailProps = {
  /** Slot under the body for the "Attach to" footer (Task 17). */
  footer?: ComponentChildren;
  /** Slot under the comments for adding one (Task 15). */
  composer?: ComponentChildren;
  /** Behind a sheet: nothing in it can be reached. */
  inert?: boolean;
};

/** One bead, read in full, in place of the list. Nothing the bead has is left out: what has no place of its own is under More. */
export function Detail({ footer, composer, inert }: DetailProps) {
  const state = useStore();
  const store = useStoreApi();
  const now = useNow(15_000);
  const scroller = useRef<HTMLDivElement>(null);
  const region = useRef<HTMLElement>(null);
  const detail = state.detail;
  const snapshot = state.snapshot;
  const entry = detail?.stack[detail.stack.length - 1] ?? null;
  const entryId = entry?.id ?? null;
  const minute = Math.floor(now / 60_000) * 60_000;

  const beads = snapshot?.beads;
  const byId = useMemo(() => new Map((beads ?? []).map((b) => [b.id, b])), [beads]);
  const kids = useMemo(() => {
    const map = new Map<string, Bead[]>();
    for (const b of beads ?? []) {
      if (!b.parentId || b.parentId === b.id) continue;
      map.set(b.parentId, [...(map.get(b.parentId) ?? []), b]);
    }
    return map;
  }, [beads]);
  // Relationships follow the list, so a new child or link shows up without the bead itself changing.
  const liveRelated = useMemo(() => {
    const listedBead = entryId ? byId.get(entryId) : undefined;
    return listedBead && beads ? relatedFor(listedBead, beads) : null;
  }, [beads, byId, entryId]);
  const [scrolled, setScrolled] = useState(false);
  const classify = useMemo(
    () => classifier({ statuses: snapshot?.statuses ?? [], readyIds: snapshot?.readyIds ?? [], now: minute }),
    [snapshot?.statuses, snapshot?.readyIds, minute],
  );

  // A new bead on screen starts at the top, with focus in the detail so Escape and Tab start from here.
  useEffect(() => {
    scroller.current?.scrollTo?.({ top: 0 });
    setScrolled(false);
    region.current?.focus({ preventScroll: true });
  }, [entryId, detail?.stack.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isField(e.target instanceof Element ? e.target : null)) return;
      e.preventDefault();
      store.back();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [store]);

  const data = entry && detail?.data?.bead.id === entry.id ? detail.data : null;
  const listed = entry ? (byId.get(entry.id) ?? null) : null;
  const bead = newerBead(data?.bead ?? null, listed);
  const writes = useInlineWrites(bead);
  const [linking, setLinking] = useState(false);
  /** The part with a draft kept from when this bead was last on screen: its editor opens again with it. */
  const drafted = (id: string | null) => (id === null ? null : (EDITABLE.find((field) => store.draft(id, field) !== null) ?? null));
  const [editing, setEditing] = useState<TextField | null>(() => drafted(entryId));
  /** Links being removed (`from>to`). */
  const [removing, setRemoving] = useState<readonly string[]>([]);
  /** The same, read at once (two presses in one frame both see it). */
  const removingNow = useRef(new Set<string>());
  /** Bumped to empty the comment box when its draft is discarded. */
  const [composerRound, setComposerRound] = useState(0);
  useEffect(() => {
    setLinking(false);
    setEditing(drafted(entryId));
  }, [entryId]);
  // Unsaved drafts on screen. While there is one, leaving the bead or switching editors asks first.
  const [dirty, setDirty] = useState({ editor: false, comment: false });
  /** What waits on "Discard": `editor` drops only the open editor's draft (a section switch); `all` leaves the bead. */
  const [asking, setAsking] = useState<{ go: () => void; stay?: () => void; drops: 'editor' | 'all' } | null>(null);
  useOverlay('leave', asking !== null);
  const unsaved = dirty.editor || dirty.comment;
  useEffect(() => {
    store.setLeaveGuard(unsaved ? (go, stay) => setAsking({ go, stay, drops: 'all' }) : null);
    return () => store.setLeaveGuard(null);
  }, [unsaved, store]);
  // An editor that closes hands focus back to the button that opened it (or the Add chip, when the part is now empty).
  const refocus = useRef<TextField | null>(null);
  const closeEditor = () => {
    refocus.current = editing;
    setEditing(null);
  };
  useEffect(() => {
    const field = refocus.current;
    refocus.current = null;
    if (editing === null && field) region.current?.querySelector<HTMLElement>(`[data-edit="${field}"]`)?.focus();
  }, [editing]);
  /** Opens another part's editor, asking first when the open one has a draft. */
  const edit = (field: TextField) => (dirty.editor ? setAsking({ go: () => setEditing(field), drops: 'editor' }) : setEditing(field));
  const discard = () => {
    if (!asking) return;
    setAsking(null);
    // A typed comment stays (and stays guarded) when only the editor's draft is let go.
    setDirty((d) => (asking.drops === 'editor' ? { ...d, editor: false } : { editor: false, comment: false }));
    if (entryId !== null && asking.drops === 'editor' && editing) store.setDraft(entryId, editing, null);
    if (entryId !== null && asking.drops === 'all') {
      // Everything typed on this bead goes, also where the bead stays on screen (a worktree start).
      store.dropDrafts(entryId);
      setEditing(null);
      setComposerRound((r) => r + 1);
    }
    asking.go();
  };

  if (!detail || !entry || !snapshot) return null;
  const statuses = snapshot.statuses;
  const panel = snapshot.panelActor || null;
  const paused = writesPaused(snapshot);
  const back = (
    <button type="button" class="bd-iconbtn bd-back" aria-label="Back" title="Back (Esc)" onClick={() => store.back()}>
      <IconBack />
    </button>
  );

  if (!bead) {
    return (
      <section ref={region} class="bd-detail" aria-label="Bead" aria-busy={detail.loading} tabIndex={-1} inert={inert}>
        <nav class="bd-dnav">
          {back}
          <span class="bd-crumb">
            <span class="bd-crumb-here">{shortId(entry.id)}</span>
          </span>
        </nav>
        {detail.loading && <div class="bd-loadbar" aria-hidden="true" />}
        <div class="bd-dbody" ref={scroller}>
          {detail.error ? (
            <div class="bd-derr" role="alert">
              <span>{detail.error.message}</span>
              <button type="button" class="bd-btn bd-btn-sm" onClick={() => store.reloadDetail()}>
                Try again
              </button>
            </div>
          ) : (
            <div class="bd-dskel" aria-hidden="true">
              <i style={{ '--w': '78%' }} />
              <i style={{ '--w': '40%' }} />
              <i style={{ '--w': '92%' }} />
              <i style={{ '--w': '86%' }} />
              <i style={{ '--w': '60%' }} />
            </div>
          )}
        </div>
      </section>
    );
  }

  // The read copy's relationships only for a bead the list no longer has.
  const related = liveRelated ?? data?.related ?? relatedFor(bead, snapshot.beads);
  const epic = bead.type === 'epic' ? null : nearestEpic(bead, byId);
  const root = bead.type === 'epic' ? bead : epic;
  const c = classify(bead);
  const reason = closeReason(bead, snapshot.activity, statuses);
  const closed = closedAt(bead, snapshot.activity, statuses);
  const extra = moreFields(bead.extra, now);
  const gone = data !== null && !listed;
  const sub = (id: string) => {
    const list = kids.get(id);
    return list?.length ? { done: list.filter((k) => classify(k).look === 'done').length, total: list.length } : null;
  };
  // Waiting and set-aside open beads are told apart the same way the list does.
  const waiting = bead.status === 'open' && c.bucket === 'blocked';
  const blockers = related.deps
    .filter((d) => d.direction === 'out' && d.dep.kind === 'blocks')
    .map((d) => byId.get(d.dep.to) ?? d.other)
    .filter((b): b is Bead => b !== null && classify(b).look !== 'done');
  const missing = TEXT_SECTIONS.filter((s) => !bead[s.field].trim() && editing !== s.field);
  const hasRelations = !!(related.parent || bead.parentId || related.children.length > 0 || related.deps.length > 0);
  const deferUntil = bead.status === 'open' && c.bucket === 'deferred' && typeof bead.extra.defer_until === 'string' ? bead.extra.defer_until : null;

  return (
    <section
      ref={region}
      class="bd-detail"
      aria-label={bead.title || bead.id}
      aria-busy={detail.loading}
      tabIndex={-1}
      inert={inert}
      onKeyDownCapture={(e) => {
        // While "Discard your changes?" shows, Enter says yes, from a field too: it never saves or posts what is behind it.
        // A focused button keeps its own Enter. Captured, so the editor and the comment box never see the key.
        if (!asking || !isConfirmKey(e)) return;
        e.preventDefault();
        e.stopPropagation();
        discard();
      }}
    >
      <nav class="bd-dnav" data-scrolled={scrolled || undefined}>
        {back}
        <span class="bd-crumb">
          {epic && (
            <>
              <button type="button" class="bd-crumb-epic" title={`Open ${epic.title}`} onClick={() => store.openRelated(epic.id)}>
                <IconEpic size={12} />
                <span>{epic.title}</span>
              </button>
              <span class="bd-crumb-sep" aria-hidden="true">
                ›
              </span>
            </>
          )}
          <span class="bd-crumb-here">{epic ? childId(bead.id, epic.id) : shortId(bead.id)}</span>
        </span>
        <span class="bd-dacts">
          <NewBeadButton />
          <StatusMenu bead={bead} writes={writes} disabled={paused} statuses={statuses} />
        </span>
      </nav>
      {detail.loading && <div class="bd-loadbar" aria-hidden="true" />}
      {asking && (
        <LeaveConfirm
          onKeep={() => {
            setAsking(null);
            asking.stay?.();
          }}
          onDiscard={discard}
        />
      )}

      <div class="bd-dbody" ref={scroller} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 2)}>
        {detail.error && (
          <div class="bd-derr" role="alert">
            <span>{detail.error.message}</span>
            {detail.error.detail && (
              <button type="button" class="bd-link" onClick={() => store.copyDetails(detail.error!)}>
                Copy details
              </button>
            )}
            <button type="button" class="bd-btn bd-btn-sm" onClick={() => store.reloadDetail()}>
              Try again
            </button>
          </div>
        )}
        {gone && (
          <div class="bd-derr" data-tone="note" role="note">
            This bead is no longer in the project. This is the last copy read.
          </div>
        )}
        {paused && <PausedNote reason={paused} />}

        <header class="bd-dhead">
          {editing === 'title' ? (
            <div class="bd-dtitle" data-editing>
              <span class="bd-ty" data-type={bead.type} title={bead.type}>
                <TypeIcon type={bead.type} size={16} />
              </span>
              <TextEditor bead={bead} field="title" label="Title" disabled={paused} onClose={() => closeEditor()} onDirty={(d) => setDirty((x) => ({ ...x, editor: d }))} />
            </div>
          ) : (
            <h2 class="bd-dtitle">
              <span class="bd-ty" data-type={bead.type} title={bead.type}>
                <TypeIcon type={bead.type} size={16} />
              </span>
              <span>{bead.title || bead.id}</span>
              <button type="button" class="bd-edit bd-edit-title" data-edit="title" aria-label="Edit title" title={paused ?? 'Edit title'} disabled={paused !== null} onClick={() => edit('title')}>
                <IconEdit size={13} />
              </button>
            </h2>
          )}
          <button type="button" class="bd-did" title="Copy ID" onClick={() => store.copyText(bead.id)}>
            <span>{bead.id}</span>
            <IconCopy size={11} />
          </button>
          <span class="bd-dtype">{humanize(bead.type || 'bead')}</span>
          <div class="bd-dmeta">
            <StatusPill status={bead.status} statuses={statuses} />
            <PriorityMenu bead={bead} writes={writes} disabled={paused} />
            <AssigneePicker bead={bead} writes={writes} disabled={paused} beads={snapshot.beads} panelActor={snapshot.panelActor} />
            {bead.labels.map((label) => (
              <span key={label} class="bd-lb">
                {label}
              </span>
            ))}
            <LabelsEditor bead={bead} writes={writes} disabled={paused} beads={snapshot.beads} />
          </div>
          <InlineNotice writes={writes} statuses={statuses} paused={paused} />
          {waiting && (
            <div class="bd-dhint" data-tone="blocked">
              <IconWait size={13} />
              {blockers.length === 0 ? (
                <span>{c.label}</span>
              ) : (
                <span>
                  {'Waiting on '}
                  {blockers.map((b, i) => (
                    <>
                      {i > 0 && ', '}
                      <button type="button" class="bd-hint-id" title={`${b.title}. See Blocked by below.`} onClick={() => store.openRelated(b.id)}>
                        {shortId(b.id)}
                      </button>
                    </>
                  ))}
                </span>
              )}
            </div>
          )}
          {deferUntil && (
            <div class="bd-dhint">
              <IconClock size={13} />
              <span>{`Deferred until ${when(deferUntil, now)}`}</span>
            </div>
          )}
        </header>

        {entry.change && <Banner line={changeLine(entry.change, statuses, now)} onDismiss={() => store.dismissChange()} />}

        {TEXT_SECTIONS.map(({ field, title, folded }) => {
          const text = bead[field];
          if (!text.trim() && editing !== field) return null;
          return (
            <Section
              key={`${bead.id}:${field}`}
              id={field}
              title={title}
              folded={folded}
              peek={folded ? peekOf(text) : undefined}
              note={field === 'acceptance' ? acceptanceItems(text)?.length.toString() : undefined}
              editing={editing === field}
              action={
                <button type="button" class="bd-edit" data-edit={field} aria-label={`Edit ${title.toLowerCase()}`} title={paused ?? undefined} disabled={paused !== null} onClick={() => edit(field)}>
                  Edit
                </button>
              }
            >
              {editing === field ? (
                <TextEditor bead={bead} field={field} label={title} disabled={paused} onClose={() => closeEditor()} onDirty={(d) => setDirty((x) => ({ ...x, editor: d }))} />
              ) : field === 'acceptance' ? (
                <Acceptance text={text} />
              ) : (
                <Markdown class="bd-txt" text={text} />
              )}
            </Section>
          );
        })}

        {(missing.length > 0 || (!hasRelations && !linking)) && (
          <div class="bd-addrow">
            <span class="bd-addrow-lab">Add</span>
            {missing.map((s) => (
              <button key={s.field} type="button" class="bd-addchip" data-edit={s.field} aria-label={`Add ${s.title.toLowerCase()}`} disabled={paused !== null} title={paused ?? undefined} onClick={() => edit(s.field)}>
                {s.chip}
              </button>
            ))}
            {!hasRelations && !linking && (
              <button type="button" class="bd-addchip" aria-label="Add link" disabled={paused !== null} title={paused ?? undefined} onClick={() => setLinking(true)}>
                Link
              </button>
            )}
          </div>
        )}
        {(hasRelations || linking) && (
          <Section key={`${bead.id}:relationships`} id="relationships" title="Relationships">
            <Relationships
              related={related}
              parentId={bead.parentId}
              root={root}
              current={(id) => byId.get(id) ?? null}
              classify={classify}
              sub={sub}
              panel={panel}
              open={(id) => store.openRelated(id)}
              remove={async (d) => {
                // One removal per link at a time: a second press while the first runs does nothing.
                const key = `${d.from}>${d.to}`;
                if (removingNow.current.has(key)) return;
                removingNow.current.add(key);
                setRemoving((r) => [...r, key]);
                const outcome = await store.link({ op: 'remove', from: d.from, to: d.to });
                removingNow.current.delete(key);
                setRemoving((r) => r.filter((k) => k !== key));
                writes.report(outcome);
              }}
              removing={removing}
              disabled={paused}
              footer={
                linking ? (
                  <LinkAdder bead={bead} beads={snapshot.beads} statuses={statuses} disabled={paused} onDone={() => setLinking(false)} />
                ) : (
                  <button type="button" class="bd-addlink" aria-label="Add link" disabled={paused !== null} title={paused ?? undefined} onClick={() => setLinking(true)}>
                    <span aria-hidden="true">+</span> Add link
                  </button>
                )
              }
            />
          </Section>
        )}

        {extra.length > 0 && (
          <Section key={`${bead.id}:more`} id="more" title="More" note={String(Object.keys(bead.extra).length)}>
            <dl class="bd-more">
              {extra.map((f) => (
                <div key={f.key} class="bd-more-row" data-sub={f.sub || undefined} data-group={f.group || undefined}>
                  <dt title={f.key}>{f.label}</dt>
                  <dd title={f.title}>{f.code ? <code>{f.value}</code> : f.value}</dd>
                </div>
              ))}
            </dl>
          </Section>
        )}

        <Section key={`${bead.id}:activity`} id="activity" title="Activity" note={bead.comments.length === 1 ? '1 comment' : `${bead.comments.length} comments`}>
          <Comments comments={bead.comments} panel={panel} now={now} composer={composer ?? <CommentComposer key={`${bead.id}:${composerRound}`} bead={bead} disabled={paused} onDirty={(d) => setDirty((x) => ({ ...x, comment: d }))} />} />
          <p class="bd-stamp">
            <span>
              <b>Created</b> {`${when(bead.createdAt, now)} by ${personName(bead.createdBy, panel)}`}
            </span>
            <span class="bd-sep" aria-hidden="true">
              {' · '}
            </span>
            <span>
              <b>Updated</b> {when(bead.updatedAt, now)}
            </span>
            {closed && (
              <span class="bd-stamp-line">
                <b>Closed</b> {closed.historical ? recordedDay(closed.at, now) : when(closed.at, now)}
              </span>
            )}
            {reason && (
              <span class="bd-stamp-line">
                <b>Reason</b> {reason}
              </span>
            )}
          </p>
        </Section>
      </div>
      {footer}
    </section>
  );
}
