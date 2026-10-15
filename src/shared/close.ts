import type { Bead } from './types';

/** bd's own literal close rules look at these two statuses only: a done category does not count. */
const CLOSED = 'closed';
const PINNED = 'pinned';

/** Children are those with a `parent-child` link to the bead, which `parentId` reads from the export. */
export const notClosedChildren = (rows: Bead[], id: string): string[] => rows.filter((b) => b.parentId === id && b.status !== CLOSED).map((b) => b.id);

/**
 * What stops a plain `bd close` on bd 1.3.1. It refuses for two separate reasons, both judged here from an export with bd's own
 * rules (a done category does not count, only the literal statuses `closed` and `pinned`):
 *  - a child that is not `closed`, always;
 *  - the request's stored blocked state, when at least one direct `blocks`, `conditional-blocks` or `waits-for` target is live
 *    (neither `closed` nor `pinned`); those targets are what bd names.
 * The blocked state is not in the export, so it is derived the way bd sets it: a live `blocks` or `conditional-blocks` target, a
 * parent that is blocked itself, or a `waits-for` target of any status that holds a child that is not `closed` or `pinned`.
 * Known gaps: the `any-children` and `also_blocks` metadata of a `waits-for` link (the panel does not read link metadata) and
 * ephemeral wisps (children and link targets are not in the export).
 *
 * One implementation for the service (which refuses a close) and the panel (which hides Respond and Dismiss on a row that
 * would be refused), so the two cannot disagree.
 */
export function closeBlockers(rows: Bead[], id: string): string[] {
  const byId = new Map(rows.map((b) => [b.id, b]));
  const live = (s: string | undefined): boolean => s !== undefined && s !== CLOSED && s !== PINNED;
  const holdsLiveChild = (target: string): boolean => rows.some((b) => b.parentId === target && live(b.status));
  const directTargets = (bead: Bead | undefined): string[] =>
    (bead?.dependencies ?? []).filter((d) => d.kind === 'blocks' || d.kind === 'conditional-blocks' || d.kind === 'waits-for').map((d) => d.to);
  const blockedState = (bead: Bead | undefined, seen: Set<string>): boolean => {
    if (bead === undefined || !live(bead.status) || seen.has(bead.id)) return false;
    seen.add(bead.id);
    const links = bead.dependencies;
    return (
      links.some((d) => (d.kind === 'blocks' || d.kind === 'conditional-blocks') && live(byId.get(d.to)?.status)) ||
      links.some((d) => d.kind === 'waits-for' && byId.has(d.to) && holdsLiveChild(d.to)) ||
      (bead.parentId !== null && blockedState(byId.get(bead.parentId), seen))
    );
  };

  const request = byId.get(id);
  const waitingOn = blockedState(request, new Set()) ? directTargets(request).filter((to) => live(byId.get(to)?.status)) : [];
  const blockers = [...waitingOn, ...notClosedChildren(rows, id)];
  return blockers.filter((blocker, index) => blockers.indexOf(blocker) === index);
}
