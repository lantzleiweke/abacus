import type { HostClient } from '@openchamber/sdk';
import type { ApiRouteName } from '../../../src/shared/api';
import type { Freshness, SnapshotResponse, WorkspaceState } from '../../../src/shared/types';

export type Answer = { status: number; body: string };
export type Call = { route: ApiRouteName; body: Record<string, unknown> };

/** A promise the test settles by hand. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export const json = (value: unknown, status = 200): Answer => ({ status, body: JSON.stringify(value) });
export const envelope = (status: number, error: Record<string, unknown>): Answer => json({ error }, status);

/** Host fake: `serviceRequest` routes `/api/<name>` to `answer`, storage is an in-memory map. */
export function fakeHost(answer: (call: Call) => Answer | Promise<Answer>) {
  const calls: Call[] = [];
  const stored = new Map<string, unknown>();
  const host = {
    serviceRequest: async ({ path, body }: { path: string; body?: string }) => {
      const call: Call = { route: path.replace('/api/', '') as ApiRouteName, body: JSON.parse(body ?? '{}') };
      calls.push(call);
      return answer(call);
    },
    storage: {
      get: async (key: string) => stored.get(key) as never,
      set: async (key: string, value: unknown) => {
        stored.set(key, value);
      },
      delete: async (key: string) => {
        stored.delete(key);
      },
      keys: async () => [...stored.keys()],
    },
    toast: async () => {},
    setBadge: async () => {},
    writeClipboard: async () => {},
  };
  return { host: host as unknown as HostClient, calls, stored };
}

export const OK: Extract<WorkspaceState, { kind: 'ok' }> = { kind: 'ok', root: '/p/a', mode: 'embedded', bdVersion: '1.2.2', hasRemote: false, projectName: 'demo' };

export function freshness(over: Partial<Freshness> = {}): Freshness {
  return { localRefreshedAt: null, localError: null, localErrorDetail: null, teamSyncedAt: null, unpublished: null, ...over };
}

export function snapshot(over: Partial<Extract<SnapshotResponse, { unchanged: false }>> = {}): Extract<SnapshotResponse, { unchanged: false }> {
  return {
    unchanged: false,
    cursor: 'c1',
    workspace: OK,
    beads: [],
    statuses: [],
    types: [],
    readyIds: [],
    unseenIds: [],
    activity: [],
    freshness: freshness(),
    sync: { kind: 'idle' },
    writesBlocked: false,
    panelActor: '',
    ...over,
  };
}

/** Lets queued promise callbacks run. */
export const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
