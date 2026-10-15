import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { HostClient } from '@openchamber/sdk';
import type { Bead, SupersededEdit, SyncState, UnpublishedChange } from '../shared/types';
import { ANSWER_LOST, asRequestError, COPY_MAX, TOAST_MAX, type BeadsClient } from './client';
import { shortId } from './list';
import type { FullSnapshot, PanelError, Store } from './store';

/** A sync problem the panel shows as a card: a conflict, a failed job, or a project Beads cannot sync as it is. */
export type SyncProblem = Extract<SyncState, { kind: 'conflict' | 'error' | 'paused-upgrade' }>;

const SUPERSEDED_NAMED_MAX = 3;

/** Says which beads had an older edit replaced by a newer one to the same fields, in plain words. */
function supersededText(edits: SupersededEdit[], beads: Bead[]): string {
  const named = edits.slice(0, SUPERSEDED_NAMED_MAX).map((edit) => {
    const title = beads.find((bead) => bead.id === edit.beadId)?.title;
    const who = title ? `"${title}"` : shortId(edit.beadId);
    return edit.fields.length > 0 ? `${who} (${edit.fields.join(', ')})` : who;
  });
  const more = edits.length - named.length;
  return `Both sides edited the same thing, so the newer edit was kept: ${named.join(', ')}${more > 0 ? `, and ${more} more` : ''}.`;
}

/** The shown sync problem, or null when there is none (or the project has no shared copy). */
export function syncProblem(snapshot: FullSnapshot | null): SyncProblem | null {
  if (!snapshot || snapshot.workspace.kind !== 'ok') return null;
  const sync = snapshot.sync;
  // A Publish that stopped because new changes arrived is no problem: nothing went, and the preview opens again.
  if (sync.kind === 'error' && sync.code === 'preview-stale') return null;
  return sync.kind === 'conflict' || sync.kind === 'error' || sync.kind === 'paused-upgrade' ? sync : null;
}

/** The Publish preview: being read, read (`noRemote`: nothing to publish to), or refused. */
/**
 * `total` is how many changes Publish sends, as the service counted them with the list: more than the list holds when it
 * was capped (at 1,000), so the unlisted rest is never hidden.
 */
export type PublishPreview =
  | { kind: 'loading' }
  /** `head`: the commit the list was read from, sent back with Publish. `notice`: why the sheet came back. */
  /** `teamEmpty`: the team's copy has no branch yet, which Publish cannot set up. `teamUnseen`: this computer has not fetched it yet. */
  | { kind: 'ready'; changes: UnpublishedChange[]; noRemote: boolean; total: number; head?: string; notice?: string; teamEmpty?: true; teamUnseen?: true }
  | { kind: 'error'; error: PanelError };

export type SyncUi = {
  /** The Publish preview sheet, while open. */
  preview: PublishPreview | null;
  /** A Sync or Publish request is on its way to the service. */
  starting: 'pull' | 'publish' | null;
  /** The error the person put away; it shows again once the service answers that a new job of this panel's runs, or the project changes. */
  dismissed: SyncProblem | null;
};

export type Sync = {
  get(): SyncUi;
  subscribe(listener: () => void): () => void;
  /** Fetches the team's changes. Never publishes. */
  pull(): Promise<void>;
  /** Opens the sheet listing exactly what Publish would send (`notice`: why it opened again). Nothing is sent. */
  openPublish(notice?: string): Promise<void>;
  closePublish(): void;
  /** Publishes what the sheet listed: the person's one click. Never sent again on its own, whatever comes back. */
  confirmPublish(): Promise<void>;
  /** The problem's message in a toast whose Copy copies its log. */
  copyDetails(problem: SyncProblem): void;
  /** Puts an error away until the next job or project. */
  dismiss(problem: SyncProblem): void;
};

export type SyncDeps = {
  client: Pick<BeadsClient, 'syncPreview' | 'syncPull' | 'syncPublish'>;
  host: Pick<HostClient, 'toast'>;
  store: Pick<Store, 'get' | 'subscribe' | 'syncStarted' | 'copyDetails'>;
};

const LABEL = { pull: 'Sync', publish: 'Publish' } as const;

export const changesText = (n: number): string => (n === 1 ? '1 change' : `${n} changes`);

/** The message a sync problem shows with, in plain words. */
export function problemMessage(problem: SyncProblem): string {
  if (problem.kind !== 'conflict') return problem.message;
  return problem.halfMerged ? 'Editing is paused until this is resolved.' : "Your changes are safe. The team's copy has edits to the same fields.";
}

export function createSync({ client, host, store }: SyncDeps): Sync {
  let ui: SyncUi = { preview: null, starting: null, dismissed: null };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<SyncUi>) => {
    ui = { ...ui, ...patch };
    listeners.forEach((l) => l());
  };
  const toast = (kind: 'info' | 'success' | 'error', message: string, copy?: string) =>
    host.toast({ kind, message: message.slice(0, TOAST_MAX), ...(copy ? { copy: { text: copy.slice(0, COPY_MAX) } } : {}) }).catch(() => {});

  /** A job this panel started, until the snapshot shows how it ended; `count` is what the preview listed. */
  let awaiting: { op: 'pull' | 'publish'; count: number; generation: number } | null = null;
  /** Each preview read gets a number; only the newest one's answer is applied, and only while the sheet is open. */
  let previewSeq = 0;
  let generation = store.get().generation;

  store.subscribe(() => {
    const state = store.get();
    if (state.generation !== generation) {
      // Another project: nothing about the last one applies here.
      generation = state.generation;
      awaiting = null;
      previewSeq++;
      if (ui.preview || ui.starting || ui.dismissed) set({ preview: null, starting: null, dismissed: null });
      return;
    }
    if (!awaiting || awaiting.generation !== state.generation) return;
    const sync = state.snapshot?.sync;
    if (!sync || sync.kind === 'running') return;
    const done = awaiting;
    awaiting = null;
    // A problem shows as its own card; only a clean end gets a word. A Publish the job stopped because new changes arrived
    // shows the preview again, as it is now.
    if (sync.kind === 'idle') {
      const lead = done.op === 'pull' ? 'Synced.' : `Published ${changesText(done.count)}.`;
      if (sync.superseded && sync.superseded.length > 0) toast('info', `${lead} ${supersededText(sync.superseded, state.snapshot?.beads ?? [])}`, sync.log);
      else toast('success', lead);
    }
    else if (done.op === 'publish' && sync.kind === 'error' && sync.code === 'preview-stale') void openPreview(sync.message);
  });

  const running = () => ui.starting !== null || store.get().snapshot?.sync.kind === 'running';

  /** Another job holds the project: this one never started, so nothing about it may be claimed later. */
  const otherJob = (op: 'pull' | 'publish') => toast('info', `${LABEL[op]} didn't start because a sync is running. Try again when it finishes.`);

  async function begin(op: 'pull' | 'publish', count: number, send: (directory: string) => Promise<{ sync: SyncState }>) {
    const { directory, generation: gen } = store.get();
    if (directory === null) return;
    if (running()) {
      // Confirm pressed after a job appeared (the sheet stays open over a poll); the buttons are off otherwise.
      if (op === 'publish') otherJob(op);
      return;
    }
    set({ starting: op });
    /** Why the preview opens again once this request is done (it cannot open while one is starting). */
    let reopen: string | null = null;
    try {
      const { sync } = await send(directory);
      if (store.get().generation !== gen) return;
      // The service answers a job already running (another window's) with that job: this one is not it.
      if (sync.kind === 'running' && sync.op !== op) otherJob(op);
      else {
        awaiting = { op, count, generation: gen };
        // This job runs: whatever it ends with is news, even the same failure as the one put away.
        if (ui.dismissed) set({ dismissed: null });
      }
      store.syncStarted(sync);
    } catch (thrown) {
      if (store.get().generation !== gen) return;
      const error = asRequestError(thrown);
      if (ANSWER_LOST.has(error.code)) {
        // It may be running: show what the service says now, and leave the next step to the person.
        toast('info', `${LABEL[op]} may have started. The team line shows when it is done.`, error.detail);
        store.syncStarted(null);
      } else if (error.code === 'sync-running') {
        // Refused, not started: a confirmed preview never rides along with a job already running.
        otherJob(op);
        store.syncStarted(null);
      } else if (error.code === 'preview-stale') {
        // Nothing went: show the list as it is now, for a fresh decision.
        reopen = error.message;
      } else {
        toast('error', `Couldn't start ${LABEL[op]}. ${error.message}`, error.detail);
        if (error.workspace) store.syncStarted(null);
      }
    } finally {
      if (store.get().generation === gen) set({ starting: null });
    }
    if (reopen !== null && store.get().generation === gen) await openPreview(reopen);
  }

  async function openPreview(notice?: string) {
    const { directory, generation: gen } = store.get();
    if (directory === null || running()) return;
    const seq = ++previewSeq;
    set({ preview: { kind: 'loading' } });
    const current = () => seq === previewSeq && ui.preview !== null && store.get().generation === gen;
    try {
      const answer = await client.syncPreview({ directory });
      if (!current()) return;
      const changes = Array.isArray(answer.changes) ? answer.changes : [];
      // The count read with the list, never the header's, which can be a poll behind.
      const total = changes.length > 0 ? Math.max(changes.length, typeof answer.total === 'number' ? answer.total : 0) : 0;
      const head = typeof answer.head === 'string' ? answer.head : undefined;
      set({ preview: { kind: 'ready', changes, noRemote: answer.noRemote === true, total, ...(head ? { head } : {}), ...(notice ? { notice } : {}), ...(answer.teamEmpty === true ? { teamEmpty: true as const } : {}), ...(answer.teamUnseen === true ? { teamUnseen: true as const } : {}) } });
    } catch (thrown) {
      if (!current()) return;
      const error = asRequestError(thrown);
      set({ preview: { kind: 'error', error: error.detail ? { code: error.code, message: error.message, detail: error.detail } : { code: error.code, message: error.message } } });
    }
  }

  return {
    get: () => ui,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pull: () => begin('pull', 0, (directory) => client.syncPull({ directory })),
    openPublish: (notice) => openPreview(notice),
    closePublish() {
      previewSeq++;
      if (ui.preview) set({ preview: null });
    },
    async confirmPublish() {
      const preview = ui.preview;
      // The service publishes only against the head the list was read from.
      if (preview?.kind !== 'ready' || preview.noRemote || preview.teamEmpty || preview.teamUnseen || preview.changes.length === 0 || !preview.head) return;
      const expectedHead = preview.head;
      previewSeq++;
      set({ preview: null });
      await begin('publish', preview.total, (directory) => client.syncPublish({ directory, expectedHead }));
    },
    dismiss(problem) {
      if (problem.kind === 'error') set({ dismissed: problem });
    },
    copyDetails(problem) {
      store.copyDetails({ code: 'sync', message: problemMessage(problem), ...(problem.log ? { detail: problem.log } : {}) });
    },
  };
}

export const SyncContext = createContext<Sync | null>(null);

const IDLE: SyncUi = { preview: null, starting: null, dismissed: null };

/** The sync actions, or null where the panel runs without them (tests of other parts). */
export const useSync = (): Sync | null => useContext(SyncContext);

/** The sync UI state; re-renders on every change. */
export function useSyncUi(): SyncUi {
  const sync = useSync();
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (!sync) return;
    const bump = () => setVersion((v) => v + 1);
    const stop = sync.subscribe(bump);
    bump();
    return stop;
  }, [sync]);
  return sync?.get() ?? IDLE;
}
