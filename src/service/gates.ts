import type { Bead, Gate, Lease } from '../shared/types';

export { PLAN_APPROVAL_REASON, REVIEW_REASON } from '../shared/gates';
import { PLAN_APPROVAL_REASON } from '../shared/gates';

const GATE_TYPE = 'gate';
const REASON_MARKER = '\n\nReason: ';

/** Gate rows (`issue_type: "gate"`) are taken out of an export before anything else sees it. Edges on other beads are kept as exported. */
export function splitGates(exported: Bead[]): { beads: Bead[]; gateRows: Bead[] } {
  if (!exported.some((b) => b.type === GATE_TYPE)) return { beads: exported, gateRows: [] };
  return { beads: exported.filter((b) => b.type !== GATE_TYPE), gateRows: exported.filter((b) => b.type === GATE_TYPE) };
}

function reasonOf(description: string): string | null {
  const at = description.indexOf(REASON_MARKER);
  if (at < 0) return null;
  const reason = description.slice(at + REASON_MARKER.length).trim();
  return reason === '' ? null : reason;
}

/** A gate row as a `Gate`: its kind and reason are read from the row; `blocks` is what the caller knows. */
export function toGate(row: Bead, blocks: string[]): Gate {
  const awaited = row.extra.await_type;
  const kind = typeof awaited === 'string' && awaited !== '' ? awaited : 'unknown';
  const timeout = row.extra.timeout;
  const reason = reasonOf(row.description);
  return {
    id: row.id,
    kind,
    reason,
    blocks,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    timeoutMs: typeof timeout === 'number' && Number.isFinite(timeout) ? timeout / 1e6 : null,
    planApproval: kind === 'human' && reason !== null && reason.startsWith(PLAN_APPROVAL_REASON),
  };
}

/**
 * `gates` is every gate row that is not closed, with `blocks` from the other beads' `blocks` edges to it. `gateIds` is every gate row; `closed` the closed ones.
 * A closed gate is not listed even though its edge persists on the bead, so "gated" is decided on the gate's status, never on an edge.
 */
export function deriveGates(gateRows: Bead[], beads: Bead[]): { gates: Gate[]; gateIds: string[]; closed: Gate[] } {
  const blockedBy = new Map<string, string[]>();
  for (const bead of beads) {
    for (const dep of bead.dependencies) {
      if (dep.kind !== 'blocks') continue;
      const list = blockedBy.get(dep.to) ?? [];
      if (!list.includes(bead.id)) list.push(bead.id);
      blockedBy.set(dep.to, list);
    }
  }
  return {
    gates: gateRows.filter((row) => row.status !== 'closed').map((row) => toGate(row, blockedBy.get(row.id) ?? [])),
    gateIds: gateRows.map((row) => row.id),
    // Kept for one purpose: a review opened and resolved between two reads still says what kind it was and why it was asked.
    closed: gateRows.filter((row) => row.status === 'closed').map((row) => toGate(row, blockedBy.get(row.id) ?? [])),
  };
}

/** `lease_expires_at` is a UTC datetime with no zone ("2026-10-15 05:46:36"); the wire form is ISO UTC. Null when it does not read as a time. */
function isoUtc(raw: string): string | null {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const ms = Date.parse(hasZone ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Rows of `SELECT issue_id, holder, lease_expires_at FROM leases` as leases, by bead id. A row that cannot be read is skipped. */
export function parseLeaseRows(rows: Array<Record<string, unknown>>): Lease[] {
  const out: Lease[] = [];
  for (const row of rows) {
    const { issue_id: beadId, holder, lease_expires_at: expires } = row;
    if (typeof beadId !== 'string' || beadId === '' || typeof holder !== 'string' || holder === '' || typeof expires !== 'string') continue;
    const expiresAt = isoUtc(expires);
    if (expiresAt !== null) out.push({ beadId, holder, expiresAt });
  }
  return out.sort((a, b) => (a.beadId < b.beadId ? -1 : a.beadId > b.beadId ? 1 : 0));
}
