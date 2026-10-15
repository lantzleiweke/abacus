import { PLAN_APPROVAL_REASON } from '../shared/gates';
import type { Bead, ChangeEvent, ExplainResult, Gate, HistoryGate } from '../shared/types';
import { localZone } from './dates';
import { personName, shortAgo } from './format';
import { shortId } from './list';

/** A bead something waits on, as the panel names it: by id and title. */
export type Blocker = { id: string; title: string };

/** A gate as part of a sentence ("waiting on a review", "waiting on 2 reviews"). Never its id: the id names nothing a person knows. */
export function gateWord(gate: Gate, count = 1): string {
  const [one, many] = WORDS[gate.kind === 'human' && gate.planApproval ? 'plan' : gate.kind] ?? WORDS.other!;
  return count > 1 ? `${count} ${many}` : one;
}

const WORDS: Record<string, [string, string]> = {
  human: ['a review', 'reviews'],
  // Counted like the rest: two plan-approval gates are two approvals someone has to give.
  plan: ['plan approval', 'plan approvals'],
  timer: ['a timer', 'timers'],
  'gh:run': ['a GitHub check', 'GitHub checks'],
  'gh:pr': ['a GitHub PR', 'GitHub PRs'],
  bead: ['another bead', 'other beads'],
  other: ['an outside check', 'outside checks'],
};

/** A gate's tag in the Waiting on block. */
export function gateLabel(gate: Gate): string {
  switch (gate.kind) {
    case 'human':
      return gate.planApproval ? 'Plan approval' : 'Review';
    case 'timer':
      return 'Timer';
    case 'gh:run':
      return 'GitHub run';
    case 'gh:pr':
      return 'GitHub pull request';
    case 'bead':
      return 'Bead';
    default:
      return 'Check';
  }
}

/** A gate as a person knows it, from its kind (null or unknown on older rows) and reason. */
type GateFamily = 'review' | 'plan' | 'timer' | 'github' | 'other';

function familyOf(kind: string | null | undefined, reason: string | null | undefined): GateFamily {
  if (kind === 'human') return reason?.startsWith(PLAN_APPROVAL_REASON) ? 'plan' : 'review';
  if (kind === 'timer') return 'timer';
  if (kind === 'gh:run' || kind === 'gh:pr') return 'github';
  return 'other';
}

/** What happened to a gate, by family: only people's gates are called reviews, and only they are "resolved by" someone. */
const GATE_EVENTS: Record<GateFamily, Record<HistoryGate['what'], string>> = {
  review: { requested: 'Review requested', resolved: 'Review resolved', deleted: 'Review deleted', unlinked: 'Review removed from this bead' },
  plan: { requested: 'Plan approval requested', resolved: 'Plan approved', deleted: 'Plan approval deleted', unlinked: 'Plan approval removed from this bead' },
  timer: { requested: 'Timer set', resolved: 'Timer ended', deleted: 'Timer deleted', unlinked: 'Timer removed from this bead' },
  github: { requested: 'GitHub check added', resolved: 'GitHub check cleared', deleted: 'GitHub check deleted', unlinked: 'GitHub check removed from this bead' },
  other: { requested: 'Check added', resolved: 'Check cleared', deleted: 'Check deleted', unlinked: 'Check removed from this bead' },
};

/** One gate event, as History, Activity and the change banner word it. */
export type GateEvent = { what: HistoryGate['what']; gateKind: string | null | undefined; reason: string | null | undefined; byPanel: boolean; actor: string | null };

/**
 * A gate event in words: `head` ("Review resolved", "Timer set", "Review deleted") and `by`, the name that belongs in the sentence
 * itself. Only a resolve by someone other than this panel carries one: the recorded name, or "someone else" when a review's resolve
 * names nobody (a timer or GitHub check that cleared names no one either, so it gets none). Null otherwise: the panel's own resolve
 * is "you (panel)" in the who line, and a deleted gate names no one.
 */
export function gateEventWords(e: GateEvent): { head: string; by: string | null } {
  const family = familyOf(e.gateKind, e.reason);
  const head = GATE_EVENTS[family][e.what];
  if (e.what !== 'resolved' || e.byPanel) return { head, by: null };
  const people = family === 'review' || family === 'plan';
  return { head, by: e.actor ?? (people ? 'someone else' : null) };
}

/** A gate row of the activity (`gate_opened`, `gate_resolved`) as a gate event. */
export const gateEventOf = (e: ChangeEvent): GateEvent => ({
  what: e.kind === 'gate_opened' ? 'requested' : (e.ended ?? 'resolved'),
  gateKind: e.gateKind,
  reason: e.reason,
  byPanel: e.byPanel,
  actor: e.actor,
});

/** The open gates that hold this bead. */
export const gatesOn = (bead: Pick<Bead, 'id'>, gates: Gate[]): Gate[] => gates.filter((g) => g.blocks.includes(bead.id));

/**
 * What a bead waits on: its gates and the beads it waits on. Everything that says so (the detail's why line, Needs me, a refused
 * close) words it from this, through `waitItems`, so they all name the same things the same way.
 */
export type Waits = { gates: Gate[]; beads: Blocker[] };

/** One named thing in a "waiting on" sentence: gates by kind (counted when there are several of one kind), beads by id and title. */
export type WaitItem = { kind: 'gate'; word: string } | { kind: 'bead'; id: string; title: string };

/** Up to three names are listed; past that, two and a count. */
const LISTED = 3;
const SHOWN = 2;

/**
 * The names of `waits` in sentence order, each with what goes before it (", " or " and "), and the tail for the rest
 * (" and 2 more"). Gates first, one entry per kind; then beads.
 */
export function waitItems(waits: Waits): { items: Array<{ sep: string; item: WaitItem }>; more: string } {
  const counts = new Map<string, { gate: Gate; n: number }>();
  for (const gate of waits.gates) {
    const key = gateWord(gate);
    const seen = counts.get(key);
    if (seen) seen.n++;
    else counts.set(key, { gate, n: 1 });
  }
  const all: WaitItem[] = [...[...counts.values()].map(({ gate, n }) => ({ kind: 'gate' as const, word: gateWord(gate, n) })), ...waits.beads.map((b) => ({ kind: 'bead' as const, id: b.id, title: b.title }))];
  const shown = all.length > LISTED ? all.slice(0, SHOWN) : all;
  const rest = all.length - shown.length;
  const last = shown.length - 1;
  return {
    items: shown.map((item, i) => ({ sep: i === 0 ? '' : i === last && rest === 0 ? ' and ' : ', ', item })),
    more: rest > 0 ? ` and ${rest} more` : '',
  };
}

/** A bead in a sentence: short id and title. */
export const beadName = (b: Blocker): string => `${shortId(b.id)} ${b.title}`.trim();

/** "waiting on a review, a timer and k3f2 Fix login", lowercase so it fits a sentence; never a gate id. */
export function waitsText(waits: Waits): string {
  const { items, more } = waitItems(waits);
  if (items.length === 0) return 'waiting on something that is not done';
  return `waiting on ${items.map(({ sep, item }) => sep + (item.kind === 'gate' ? item.word : beadName(item))).join('')}${more}`;
}

/** Why a bead cannot close or start: its open gates (from `gates`, the ones that hold it) and the open beads it waits on. */
export const blockedText = (bead: Pick<Bead, 'id'>, gates: Gate[], blockers: Blocker[] = []): string => waitsText({ gates: gatesOn(bead, gates), beads: blockers });

/**
 * What the bead waits on, or null when nothing holds it that is known. `explain` (Beads' own answer, current for this snapshot) gives
 * the beads when it says blocked; else `links`, the open beads the list's links name. Any id in `gateIds` (every gate, open or
 * closed) or `gates` is a gate, never a bead: a gate that just closed drops out instead of turning into an id.
 */
export function waitsOf(bead: Pick<Bead, 'id'>, explain: ExplainResult | null, gates: Gate[], gateIds: readonly string[] = [], links: Blocker[] = []): Waits | null {
  const isGate = (id: string) => gateIds.includes(id) || gates.some((g) => g.id === id);
  const own = gatesOn(bead, gates);
  const beads = explain?.state === 'blocked' ? explain.blockers.filter((b) => !isGate(b.id) && b.status !== 'closed') : links.filter((b) => !isGate(b.id));
  return own.length > 0 || beads.length > 0 ? { gates: own, beads } : null;
}

/** The calendar day of an instant in `zone`, as YYYY-MM-DD. */
function dayIn(ms: number, zone: string): string {
  const parts = new Map(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`;
}

/**
 * Why a bead can or cannot start, in a line, from Beads' own answer (`explain`; null while it is not known) and the gates.
 * Null when there is nothing to say (closed, not known, or Beads' answer only named gates that have closed since).
 */
export function whyLine(bead: Bead, explain: ExplainResult | null, gates: Gate[], now: number = Date.now(), zone: string = localZone(), gateIds: readonly string[] = []): string | null {
  if (explain?.state === 'blocked') {
    const waits = waitsOf(bead, explain, gates, gateIds);
    if (waits) return sentence(waitsText(waits));
    // Beads said blocked but named nothing: say so plainly. Named only gates that closed since: nothing left to say.
    return explain.blockers.length === 0 ? 'Waiting on something that is not done' : null;
  }
  if (explain === null && gatesOn(bead, gates).length > 0) return sentence(blockedText(bead, gates));
  if (explain?.state === 'ready') return 'Ready to start';
  if (typeof bead.extra.defer_until === 'string') {
    const until = Date.parse(bead.extra.defer_until);
    if (Number.isFinite(until) && until > now) return `Snoozed until ${dayIn(until, zone)}`;
  }
  if (bead.status === 'deferred') return 'Snoozed with no date';
  return null;
}

/** The first letter up, for a line of its own. */
export const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** How the service starts a refused close whose comment went in first. */
export const COMMENT_ADDED = 'Your comment was added, but the bead could not be closed. ';
const PART_SAVED = ' Part of your change was saved.';
/** A refusal for what the bead waits on (not for open sub-tasks, which are worded well already). */
const WAITS = /still blocked by|still waiting on|is waiting on a review/;

/**
 * A `blocked` refusal from the service, worded again when the bead is held by an open gate: the service names a gate by its id or
 * calls any gate "a review", and says "Close those first", which is wrong advice for a review. "Your comment was added" at the
 * start and "Part of your change was saved." at the end stay as they were. Any other message is returned as it came.
 */
export function blockedMessage(message: string, bead: Pick<Bead, 'id'>, gates: Gate[], blockers: Blocker[] = []): string {
  const own = gatesOn(bead, gates);
  if (own.length === 0 || !WAITS.test(message)) return message;
  const prefix = message.startsWith(COMMENT_ADDED) ? COMMENT_ADDED : '';
  const suffix = message.endsWith(PART_SAVED) ? PART_SAVED : '';
  const what = message.slice(prefix.length).startsWith('This request') ? 'request' : 'bead';
  const people = own.every((g) => g.kind === 'human');
  const advice =
    blockers.length > 0 || !people ? '' : own.every((g) => g.planApproval) ? ' Approve the plan first.' : own.length > 1 ? ' Resolve them first.' : ' Resolve the review first.';
  return `${prefix}This ${what} can't be closed yet. It is ${blockedText(bead, gates, blockers)}.${advice}${suffix}`;
}

/** What a gate in the Waiting on block says under its reason: who opened it and when, and for a timer or GitHub gate its state. */
export function gateState(gate: Gate, now: number, panel: string | null): string {
  const at = Date.parse(gate.createdAt);
  const since = Number.isFinite(at) ? `${shortAgo(now - at)} ago` : '';
  const who = gate.createdBy ? personName(gate.createdBy, panel) : null;
  const opened = (verb: string) => [who ? `${verb} by ${who}` : verb, since].filter(Boolean).join(who ? ', ' : ' ');
  if (gate.kind === 'human') return opened('Asked');
  if (gate.kind === 'timer' && gate.timeoutMs !== null && Number.isFinite(at)) {
    const left = at + gate.timeoutMs - now;
    if (left <= 0) return 'Time is up. Beads clears it on its next check';
    return `Ends in ${shortAgo(left)}. ${opened('Set')}`;
  }
  if (gate.kind === 'gh:run' || gate.kind === 'gh:pr') return `Beads checks GitHub for it. ${opened('Set')}`;
  return opened('Set');
}
