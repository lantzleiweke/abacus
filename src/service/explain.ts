import type { ExplainResult } from '../shared/types';
import { onPanelWrite, type BdProvider } from './bd/adapter';
import { parseExplain } from './bd/parse';

// `bd ready --explain` answers for the whole project, not one bead, so one call serves every bead asked about in the next few
// seconds. A write of the panel's own drops the answer (it would be about the project as it was); a change from elsewhere shows
// up when the five seconds are over.

const TTL_MS = 5_000;

type Answer = ReturnType<typeof parseExplain>;
type Entry = { at: number; answer: Promise<Answer> };

const cache = new Map<string, Entry>();
/** Counts the panel's writes per project, so an answer asked for before a write is not kept after it. */
const writes = new Map<string, number>();

onPanelWrite((root) => {
  writes.set(root, (writes.get(root) ?? 0) + 1);
  cache.delete(root);
});

/** Forget every answer. For tests. */
export function resetExplainCache(): void {
  cache.clear();
  writes.clear();
}

async function answerFor(provider: Pick<BdProvider, 'readyExplain'>, root: string): Promise<Answer> {
  const held = cache.get(root);
  if (held && Date.now() - held.at < TTL_MS) return held.answer;
  const before = writes.get(root) ?? 0;
  const entry: Entry = { at: Date.now(), answer: provider.readyExplain().then(parseExplain) };
  cache.set(root, entry);
  const forget = (): void => {
    if (cache.get(root) === entry) cache.delete(root);
  };
  // A failed read is not worth keeping, and neither is one that a write overtook.
  entry.answer.then(() => (writes.get(root) ?? 0) === before || forget(), forget);
  return entry.answer;
}

/** Whether a bead is ready, and if not what it waits on. A bead Beads did not list (closed, snoozed, a gate) is `other`. */
export async function explainBead(provider: Pick<BdProvider, 'readyExplain'>, root: string, id: string): Promise<ExplainResult> {
  const answer = await answerFor(provider, root);
  if (answer.ready.has(id)) return { state: 'ready', blockers: [] };
  const blockers = answer.blocked.get(id);
  return blockers ? { state: 'blocked', blockers } : { state: 'other', blockers: [] };
}
