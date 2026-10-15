import { closeBlockers } from '../shared/close';
import type { Bead, ChangeEvent, Gate, Lease, SnapshotResponse, StatusDef } from '../shared/types';
import { changeLine, changeText, latestUnseenChange } from './detail';
import { compareIds, looker, WEEK_MS } from './list';
import type { State } from './store';

type Full = Extract<SnapshotResponse, { unchanged: false }>;

/** What the Needs me view reads: the last full answer, the project's Stuck threshold, and the Stuck rows kept away. */
export type NeedsInput = { snapshot: Full | null; staleDays: number; keep: Record<string, number> };

/** Keep hides a Stuck row for this long. */
export const KEEP_MS = WEEK_MS;

const DAY_MS = 86_400_000;
export const DEFAULT_STALE_DAYS = 3;

/** The sections for the store's state. */
export const needsOf = (state: Pick<State, 'snapshot' | 'settings' | 'keep'>, now: number): NeedsSections =>
  needsSections({ snapshot: state.snapshot, staleDays: state.settings.staleDays, keep: state.keep }, now);

/** Beads with an open review waiting on a person. `gates` are the open human gates that hold the bead. */
export type WaitingRow = { bead: Bead; gates: Gate[]; reason: string };

/**
 * A help request (label `human`, not done). `blockers` are the beads that stop a plain close; while there are any, Respond and
 * Dismiss are not offered (they close the bead, and bd would refuse) and the row says what it waits on instead.
 */
export type AskedRow = { bead: Bead; text: string; blockers: string[] };

export type StuckRow = { bead: Bead; why: string; kind: 'quiet' | 'lease' };

/** The newest unseen change to the bead. `event` is kept whole so the row can word a gate that ended without a resolve (`ended`, `gateKind`). */
export type ChangedRow = { bead: Bead; summary: string; event: ChangeEvent | null };

export type NeedsSections = { waiting: WaitingRow[]; asked: AskedRow[]; stuck: StuckRow[]; changed: ChangedRow[]; count: number };

export const EMPTY_NEEDS: NeedsSections = { waiting: [], asked: [], stuck: [], changed: [], count: 0 };

const WAITING_FALLBACK = 'Waiting for your review';

const timeOf = (iso: string): number => {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : NaN;
};

/** "5 days", "2 hours", "30 minutes", "a moment": the span in the biggest whole unit. */
function span(ms: number): string {
  const days = Math.floor(ms / DAY_MS);
  if (days >= 1) return days === 1 ? '1 day' : `${days} days`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return hours === 1 ? '1 hour' : `${hours} hours`;
  const minutes = Math.floor(ms / 60_000);
  return minutes >= 1 ? (minutes === 1 ? '1 minute' : `${minutes} minutes`) : 'a moment';
}

const firstLine = (text: string): string => text.trim().split('\n')[0]!.trim();

/**
 * What the person is asked: the request's description, else its title. Shown whole, not cut here (the row decides how much fits).
 */
const askedText = (bead: Bead): string => (bead.description.trim() ? bead.description.trim() : bead.title);

function waiting(beads: Bead[], gates: Gate[], done: (b: Bead) => boolean): WaitingRow[] {
  const byId = new Map(beads.map((b) => [b.id, b]));
  const held = new Map<string, Gate[]>();
  for (const gate of gates) {
    if (gate.kind !== 'human') continue;
    for (const id of gate.blocks) held.set(id, [...(held.get(id) ?? []), gate]);
  }
  const rows: WaitingRow[] = [];
  for (const [id, own] of held) {
    const bead = byId.get(id);
    if (!bead || done(bead)) continue;
    rows.push({ bead, gates: own, reason: own.find((g) => g.reason)?.reason ?? WAITING_FALLBACK });
  }
  return rows.sort((a, b) => compareIds(a.bead.id, b.bead.id));
}

function stuck(beads: Bead[], leases: Lease[], keep: Record<string, number>, staleDays: number, now: number, look: (s: string) => string): StuckRow[] {
  const expired = new Map<string, Lease>();
  for (const lease of leases) {
    const until = timeOf(lease.expiresAt);
    if (until <= now) expired.set(lease.beadId, lease);
  }
  const rows: Array<StuckRow & { at: number }> = [];
  for (const bead of beads) {
    if (look(bead.status) === 'done') continue;
    if ((keep[bead.id] ?? 0) > now) continue;
    const touched = timeOf(bead.updatedAt);
    const quiet = bead.status === 'in_progress' && Number.isFinite(touched) && now - touched > staleDays * DAY_MS;
    // A claim only matters while the bead is in progress; one left on a bead moved back to open, blocked or deferred is not news.
    const lease = bead.status === 'in_progress' ? expired.get(bead.id) : undefined;
    if (!quiet && !lease) continue;
    const parts: string[] = [];
    if (quiet) parts.push(`No update in ${span(now - touched)}`);
    if (lease) parts.push(`${lease.holder}'s claim ran out ${span(now - timeOf(lease.expiresAt))} ago`);
    rows.push({ bead, why: parts.join('. '), kind: quiet ? 'quiet' : 'lease', at: Number.isFinite(touched) ? touched : 0 });
  }
  return rows.sort((a, b) => a.at - b.at || compareIds(a.bead.id, b.bead.id)).map(({ at: _at, ...row }) => row);
}

/** An open gate as the export lists it, for `closeBlockers`: a live row with no links. A closed gate is simply absent. */
const gateRow = (g: Gate): Bead =>
  ({ id: g.id, title: g.reason ?? 'Gate', status: 'open', priority: 2, type: 'gate', assignee: null, labels: [], parentId: null, description: '', design: '', acceptance: '', notes: '',
     createdAt: g.createdAt, createdBy: g.createdBy, updatedAt: g.createdAt, closedAt: null, closeReason: null, dependencies: [], comments: [], extra: {} });

function changed(snapshot: Full, now: number): ChangedRow[] {
  const byId = new Map(snapshot.beads.map((b) => [b.id, b]));
  const rows: Array<ChangedRow & { order: number }> = [];
  for (const id of snapshot.unseenIds) {
    const bead = byId.get(id);
    if (!bead) continue;
    const event = latestUnseenChange(id, snapshot.activity);
    const order = event ? snapshot.activity.indexOf(event as (typeof snapshot.activity)[number]) : Number.MAX_SAFE_INTEGER;
    rows.push({ bead, event, summary: event ? changeText(changeLine(event, snapshot.statuses, now)) : 'Changed since you last looked', order });
  }
  return rows.sort((a, b) => a.order - b.order).map(({ order: _order, ...row }) => row);
}

/**
 * The four sections of Needs me. A bead is in one row per section. Waiting beats Asked (a help request that also holds an open
 * review is one row, in Waiting); a bead may appear in Stuck and Changed as well, for different reasons. A done bead is in
 * neither Waiting, Asked nor Stuck.
 */
export function needsSections(input: NeedsInput, now: number): NeedsSections {
  const { snapshot } = input;
  if (!snapshot) return EMPTY_NEEDS;
  const look = looker(snapshot.statuses);
  const done = (b: Bead) => look(b.status) === 'done';
  const waitingRows = waiting(snapshot.beads, snapshot.gates, done);
  const waitingIds = new Set(waitingRows.map((r) => r.bead.id));
  // The service judges a close on the whole export, where an open gate is a row too; the snapshot keeps gates apart.
  const withGates = [...snapshot.beads, ...snapshot.gates.map(gateRow)];
  const asked: AskedRow[] = snapshot.beads
    .filter((b) => b.labels.includes('human') && !done(b) && !waitingIds.has(b.id))
    .map((bead) => ({ bead, text: askedText(bead), blockers: closeBlockers(withGates, bead.id) }));
  const stuckRows = stuck(snapshot.beads, snapshot.leases, input.keep, input.staleDays, now, look);
  const changedRows = changed(snapshot, now);
  return { waiting: waitingRows, asked, stuck: stuckRows, changed: changedRows, count: waitingRows.length + asked.length + stuckRows.length + changedRows.length };
}

/**
 * Epics whose every child is done, with at least one child, and which are not done themselves. With `gates`, an epic an open gate
 * holds is left out: it cannot close until the gate is resolved, so the panel does not offer to close it (the rest is Beads' own rule).
 */
export function eligibleEpics(beads: Bead[], statuses: StatusDef[], gates: Gate[] = []): Bead[] {
  const look = looker(statuses);
  const held = new Set(gates.flatMap((g) => g.blocks));
  const children = new Map<string, Bead[]>();
  for (const b of beads) if (b.parentId !== null) children.set(b.parentId, [...(children.get(b.parentId) ?? []), b]);
  return beads.filter((b) => {
    if (b.type !== 'epic' || look(b.status) === 'done' || held.has(b.id)) return false;
    const own = children.get(b.id) ?? [];
    return own.length > 0 && own.every((c) => look(c.status) === 'done');
  });
}

/** Why a bead can or cannot start, in a line: kept here for the callers that know it from Needs me; the wording lives in `gates.ts`. */
export { whyLine } from './gates';
