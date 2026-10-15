import type { Bead, SnapshotResponse, StatusDef } from '../shared/types';
import { compareIds, looker, nearestEpic, shortId } from './list';

type FullSnapshot = Extract<SnapshotResponse, { unchanged: false }>;

/** Why nothing can be changed right now, in a sentence, or null when changes can go through. */
export function writesPaused(snapshot: FullSnapshot | null): string | null {
  if (!snapshot) return null;
  // Any write would open the store and update it, which only the update's own confirm may do.
  if (snapshot.freshness.schemaUpdate) return 'Editing is paused until the project is updated.';
  if (snapshot.writesBlocked) return 'Editing is paused until the sync problem is resolved.';
  if (snapshot.sync.kind === 'running') return `Editing is paused while ${snapshot.sync.op === 'publish' ? 'Publish' : 'Sync'} runs.`;
  return null;
}

/** Why Beads would refuse or mangle this label (it reads labels as comma-separated text), or null when it is fine. */
export function labelProblem(label: string, existing: string[]): string | null {
  if (label.trim() === '') return 'A label cannot be empty.';
  if (/[\r\n]/.test(label)) return 'A label cannot contain a line break.';
  if (label.includes(',') || label.includes('"')) return 'A label cannot contain a comma or a double quote.';
  if (existing.includes(label.trim())) return 'That label is already on this bead.';
  return null;
}

/** Beads priorities in words, P0 first. */
export const PRIORITY_WORDS = ['Critical', 'High', 'Medium', 'Low', 'Backlog'] as const;

/** The name the panel writes under, without the " (panel)" mark: the person using it. */
const personOf = (panelActor: string) => panelActor.replace(/\s*\(panel\)$/, '').trim();

/** Who a bead can be assigned to: you first, then everyone assigned anything, once each, by name. */
export function assigneeOptions(beads: Bead[], panelActor: string): string[] {
  const me = personOf(panelActor);
  const names = new Set<string>();
  for (const b of beads) if (b.assignee && b.assignee !== me) names.add(b.assignee);
  const others = [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  return me ? [me, ...others] : others;
}

/** A kind of link as the panel offers it. `reverse`: the other bead holds the link (it depends on this one). */
export type LinkKind = { value: string; label: string; kind: string; reverse?: true };

/** The links a person adds by hand, read from the shown bead. "Blocks" is a `blocks` link held by the other bead. */
export const LINK_KINDS: readonly LinkKind[] = [
  { value: 'blocked-by', label: 'Blocked by', kind: 'blocks' },
  { value: 'blocks', label: 'Blocks', kind: 'blocks', reverse: true },
  { value: 'related', label: 'Related', kind: 'related' },
  { value: 'discovered-from', label: 'Discovered from', kind: 'discovered-from' },
  { value: 'tracks', label: 'Tracks', kind: 'tracks' },
  { value: 'caused-by', label: 'Caused by', kind: 'caused-by' },
  { value: 'validates', label: 'Validates', kind: 'validates' },
  { value: 'supersedes', label: 'Supersedes', kind: 'supersedes' },
];

/** The dependency to write for a link of `value` between the shown bead and another (`from` depends on `to`). */
export function linkRequest(value: string, selfId: string, otherId: string): { from: string; to: string; kind: string } {
  const choice = LINK_KINDS.find((k) => k.value === value) ?? LINK_KINDS[0]!;
  return choice.reverse ? { from: otherId, to: selfId, kind: choice.kind } : { from: selfId, to: otherId, kind: choice.kind };
}

/**
 * Beads a link can point at, for what the person typed: by id (full or short) or by title, never the bead itself.
 * Id matches come first, then open beads before done ones, then in id order.
 */
export function linkTargets(query: string, beads: Bead[], selfId: string, statuses: StatusDef[], limit = 6): Bead[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const look = looker(statuses);
  const scored: Array<{ bead: Bead; rank: number }> = [];
  for (const b of beads) {
    if (b.id === selfId) continue;
    const id = b.id.toLowerCase();
    const short = shortId(b.id).toLowerCase();
    const rank = id === q || short === q ? 0 : id.includes(q) ? 1 : b.title.toLowerCase().includes(q) ? 2 : -1;
    if (rank >= 0) scored.push({ bead: b, rank });
  }
  const done = (b: Bead) => Number(look(b.status) === 'done');
  scored.sort((a, b) => a.rank - b.rank || done(a.bead) - done(b.bead) || compareIds(a.bead.id, b.bead.id));
  return scored.slice(0, limit).map((s) => s.bead);
}

/** The parent a new bead starts with: the epic shown, or the nearest epic above the bead shown; none otherwise. */
export function defaultParent(beads: Bead[], shownId: string | null): string | null {
  if (shownId === null) return null;
  const byId = new Map(beads.map((b) => [b.id, b]));
  const shown = byId.get(shownId);
  if (!shown) return null;
  if (shown.type === 'epic') return shown.id;
  return nearestEpic(shown, byId)?.id ?? null;
}

/** Epics a new bead can go under: the ones not done, in id order, plus `keep` when it is one (the default stays choosable). */
export function parentOptions(beads: Bead[], statuses: StatusDef[], keep: string | null): Bead[] {
  const look = looker(statuses);
  return beads.filter((b) => b.type === 'epic' && (look(b.status) !== 'done' || b.id === keep)).sort((a, b) => compareIds(a.id, b.id));
}

/** Whether moving to `status` closes the bead (a done category), so a close reason applies. */
export const closes = (status: string, statuses: StatusDef[]): boolean => looker(statuses)(status) === 'done';
