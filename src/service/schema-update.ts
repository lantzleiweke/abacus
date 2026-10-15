import type { UpdateFailed, UpdateJob } from '../shared/types';

// The one-time project update, run as a background job like a sync: the route starts it and answers at once, and the panel reads how
// it stands from the snapshot (`freshness.schemaUpdateJob`). The update can take longer than the host lets a request run (20 s), and
// it holds the project's queue, so nothing here waits for it. Nothing in this module talks to bd; the caller hands in what to run.

type RootUpdate = { state: UpdateJob | null; job: Promise<void> | null };

const roots = new Map<string, RootUpdate>();

function rootUpdate(root: string): RootUpdate {
  let entry = roots.get(root);
  if (!entry) {
    entry = { state: null, job: null };
    roots.set(root, entry);
  }
  return entry;
}

/** Forget everything. For tests. */
export function resetUpdateState(): void {
  roots.clear();
}

/** `running` while the job holds the project, `failed` (kept until the next try, or until a read shows the store is no longer old), else null. */
export function updateJob(root: string): UpdateJob | null {
  return roots.get(root)?.state ?? null;
}

export function updateRunning(root: string): boolean {
  return updateJob(root)?.kind === 'running';
}

/** A read of the project worked, so the store is not old: a failure kept for it no longer says anything. A running job is left alone. */
export function forgetUpdateFailure(root: string): void {
  const entry = roots.get(root);
  if (entry && entry.state?.kind === 'failed') entry.state = null;
}

/** Settles when the root's job has ended. For tests. */
export function whenUpdateSettled(root: string): Promise<void> {
  return roots.get(root)?.job ?? Promise.resolve();
}

/**
 * Starts the update unless one is already running for the root (then that one's state comes back). `run` resolves null when the store
 * was updated, or the failure to remember; if it throws, the failure is a plain one. The state is set before this returns.
 */
export function startUpdate(root: string, run: () => Promise<Omit<UpdateFailed, 'at'> | null>): UpdateJob {
  const entry = rootUpdate(root);
  if (entry.job && entry.state?.kind === 'running') return entry.state;
  const running: UpdateJob = { kind: 'running', startedAt: new Date().toISOString() };
  entry.state = running;
  entry.job = run()
    .then(
      (failure) => {
        entry.state = failure ? { ...failure, at: new Date().toISOString() } : null;
      },
      () => {
        entry.state = { kind: 'failed', at: new Date().toISOString(), code: 'failed', message: 'The update could not be finished.' };
      },
    )
    .finally(() => {
      entry.job = null;
    });
  return running;
}
