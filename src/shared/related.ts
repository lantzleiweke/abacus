import type { Bead, Related } from './types';

/**
 * The parent, the children, and the dependencies in both directions (parent-child links are covered by parent and
 * children). One definition for the service's `bead` and `context` answers and the panel's live detail.
 */
export function relatedFor(bead: Bead, all: Bead[]): Related {
  const byId = new Map(all.map((other) => [other.id, other]));
  const parent = bead.parentId === null ? null : (byId.get(bead.parentId) ?? null);
  const children = all.filter((other) => other.parentId === bead.id && other.id !== bead.id);
  const deps: Related['deps'] = [];
  for (const dep of bead.dependencies) {
    if (dep.kind !== 'parent-child') deps.push({ dep, other: byId.get(dep.to) ?? null, direction: 'out' });
  }
  for (const other of all) {
    if (other.id === bead.id) continue;
    for (const dep of other.dependencies) {
      if (dep.to === bead.id && dep.kind !== 'parent-child') deps.push({ dep, other, direction: 'in' });
    }
  }
  return { parent, children, deps };
}
