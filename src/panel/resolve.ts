import {
  GUEST_ATTACH_ID_MAX,
  GUEST_ATTACH_TEXT_MAX,
  GUEST_ATTACH_TITLE_MAX,
  isGuestAttachItem,
  type AttachIssueRequest,
  type GuestItem,
} from '@openchamber/sdk';
import type { ContextResponse } from '../shared/api';
import type { BeadsClient } from './client';

/** The panel id, which OpenChamber uses as the chip's provider. */
export const PROVIDER_ID = 'beads';

/**
 * What a beads chip carries for the panel to find its bead again. Never sent to the model. `sync`: the chip is a sync
 * problem's details (from `conflict-context`), not a bead; its id is not a bead id.
 */
export type ChipData = { v: 1; directory: string; sync?: true };

/** The chip for a bead (or, with `sync`, a sync problem), from the `context` route's answer, within OpenChamber's limits. */
export function attachPayload(context: ContextResponse, directory: string, sync = false): AttachIssueRequest {
  const data: ChipData = sync ? { v: 1, directory, sync: true } : { v: 1, directory };
  return {
    providerId: PROVIDER_ID,
    id: context.id.slice(0, GUEST_ATTACH_ID_MAX),
    title: context.title.slice(0, GUEST_ATTACH_TITLE_MAX),
    url: context.url,
    text: context.text.slice(0, GUEST_ATTACH_TEXT_MAX),
    kind: 'issue',
    data,
  };
}

const SLUG_MAX = 40;

/** Lowercase title words joined by dashes, at most 40 characters, ending on a whole word when one fits. */
export function branchSlug(title: string): string {
  const words = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let slug = '';
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > SLUG_MAX) return slug || word.slice(0, SLUG_MAX);
    slug = next;
  }
  return slug;
}

/** The branch and worktree name for a session on a bead: `issue-<id>-<slug>`, like OpenChamber names Linear's. */
export function worktreeName(id: string, title: string): string {
  const slug = branchSlug(title);
  return slug ? `issue-${id}-${slug}` : `issue-${id}`;
}

/** A name git takes for a new branch: no spaces or special characters, no `..`, no leading dash or slash. */
export const validBranchName = (name: string): boolean =>
  name.length > 0 && name.length <= 200 && /^[A-Za-z0-9._/-]+$/.test(name) && !/^[-/.]|\.\.|\/\/|[/.]$|\.lock$/.test(name);

export type BeadMatch = { kind: 'one'; id: string } | { kind: 'none' } | { kind: 'many'; ids: string[] };

/**
 * Which bead `query` names: the full id (any case), or else the end of exactly one id after a `-` or `.` (the short id,
 * or a child's tail like `b2.1`).
 */
export function matchBead(ids: string[], query: string): BeadMatch {
  const q = query.trim().toLowerCase();
  if (!q) return { kind: 'none' };
  const exact = ids.find((id) => id.toLowerCase() === q);
  if (exact) return { kind: 'one', id: exact };
  const ends = ids.filter((id) => {
    const lower = id.toLowerCase();
    if (!lower.endsWith(q) || lower.length === q.length) return false;
    const before = lower[lower.length - q.length - 1];
    return before === '-' || before === '.';
  });
  if (ends.length === 1) return { kind: 'one', id: ends[0]! };
  return ends.length === 0 ? { kind: 'none' } : { kind: 'many', ids: ends };
}

export type ResolveDeps = {
  client: Pick<BeadsClient, 'snapshot' | 'context'>;
  directory: string | null;
  /** The bead ids the panel already holds, and for which project; read again when it is another one. */
  known?: { directory: string | null; ids: string[] } | null;
};

/** `/bd <id>`: the chip for that bead, read fresh. Throws a plain sentence the host shows when it can't. */
export async function resolveCommand(request: { command: string; args: string }, { client, directory, known }: ResolveDeps): Promise<AttachIssueRequest | null> {
  if (request.command !== 'bd') return null;
  const query = request.args.trim();
  if (!query) throw new Error('Type a bead id after /bd, for example /bd k3f2.');
  if (directory === null) throw new Error('Open a project first.');
  const read = async () => {
    const answer = await client.snapshot({ directory });
    if (answer.unchanged) throw new Error("Couldn't read this project's beads.");
    return answer.beads.map((b) => b.id);
  };
  const held = known && known.directory === directory ? known.ids : null;
  let match = matchBead(held ?? (await read()), query);
  // The held list can be a poll behind (the agent may have just made the bead): read once more before saying no.
  if (held && match.kind !== 'one') match = matchBead(await read(), query);
  if (match.kind === 'none') throw new Error(`No bead ${query} in this project.`);
  if (match.kind === 'many') {
    const shown = match.ids.slice(0, 3).join(', ');
    const more = match.ids.length > 3 ? ` and ${match.ids.length - 3} more` : '';
    throw new Error(`${query} matches more than one bead: ${shown}${more}. Type more of the id.`);
  }
  return attachPayload(await client.context({ directory, id: match.id }), directory);
}

const isChipData = (value: unknown): value is ChipData =>
  typeof value === 'object' && value !== null && (value as ChipData).v === 1 && typeof (value as ChipData).directory === 'string';

/** The bead a clicked chip is for, when it is a beads chip from the project `directory`. */
export function beadOfItem(item: GuestItem | null, directory: string | null): string | null {
  if (!item || !isGuestAttachItem(item) || item.providerId !== PROVIDER_ID || isSyncChip(item)) return null;
  return isChipData(item.data) && item.data.directory === directory ? item.id : null;
}

/** The chip is a sync problem's details rather than a bead. */
export function isSyncChip(item: GuestItem | null): boolean {
  if (!item || !isGuestAttachItem(item) || item.providerId !== PROVIDER_ID) return false;
  return isChipData(item.data) && item.data.sync === true;
}

/** The project folder a beads chip came from, if it is one. */
export function chipDirectory(item: GuestItem | null): string | null {
  if (!item || !isGuestAttachItem(item) || item.providerId !== PROVIDER_ID) return null;
  return isChipData(item.data) ? item.data.directory : null;
}
