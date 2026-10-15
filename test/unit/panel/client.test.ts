import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostRequestError } from '@openchamber/sdk';
import { BeadsRequestError, createClient } from '../../../src/panel/client';
import { createStore, pageVisibility, uiKey, type Visibility } from '../../../src/panel/store';
import type { Bead } from '../../../src/shared/types';
import { deferred, envelope, fakeHost, flush, json, OK, snapshot, type Answer, type Call } from './helpers';

describe('createClient', () => {
  it('posts the JSON body to /api/<route> and parses the answer', async () => {
    const { host, calls } = fakeHost(() => json(snapshot({ cursor: 'c9' })));
    const client = createClient(host);
    const answer = await client.snapshot({ directory: '/p/a', cursor: 'c8' });
    expect(calls).toEqual([{ route: 'snapshot', body: { directory: '/p/a', cursor: 'c8' } }]);
    expect(answer.cursor).toBe('c9');
  });

  it('names hyphenated routes in camel case', async () => {
    const { host, calls } = fakeHost(() => json({ changes: [] }));
    await createClient(host).syncPreview({ directory: '/p/a' });
    expect(calls[0].route).toBe('sync-preview');
  });

  it('every new route posts to /api/<name> with the directory', async () => {
    const { host, calls } = fakeHost(() => json({}));
    const client = createClient(host);
    const d = '/p/a';
    await client.gateCreate({ directory: d, id: 'x-1' });
    await client.gateResolve({ directory: d, gateId: 'g-1' });
    await client.humanRespond({ directory: d, id: 'x-1', response: 'yes' });
    await client.humanDismiss({ directory: d, id: 'x-1' });
    await client.history({ directory: d, id: 'x-1' });
    await client.memories({ directory: d });
    await client.memoryRemember({ directory: d, text: 'note' });
    await client.memoryForget({ directory: d, key: 'note', expectedText: 'note' });
    await client.deferBead({ directory: d, id: 'x-1', expectedUpdatedAt: 't', until: '+2d' });
    await client.undeferBead({ directory: d, id: 'x-1', expectedUpdatedAt: 't' });
    await client.supersede({ directory: d, id: 'x-1', with: 'x-2', expectedUpdatedAt: 't' });
    await client.duplicate({ directory: d, id: 'x-1', of: 'x-2', expectedUpdatedAt: 't' });
    await client.explain({ directory: d, id: 'x-1' });
    await client.eventsStatus({ directory: d });
    await client.enableEvents({ directory: d, confirm: true });
    await client.migrateSchema({ directory: d, confirm: true });
    expect(calls.map((c) => c.route)).toEqual([
      'gateCreate', 'gateResolve', 'humanRespond', 'humanDismiss', 'history', 'memories', 'memoryRemember', 'memoryForget',
      'deferBead', 'undeferBead', 'supersede', 'duplicate', 'explain', 'eventsStatus', 'enableEvents', 'migrateSchema',
    ]);
    for (const call of calls) expect(call.body.directory).toBe(d);
  });

  it('turns an error envelope into a BeadsRequestError carrying message, detail and workspace', async () => {
    const { host } = fakeHost(() =>
      envelope(409, { code: 'workspace', message: "This folder doesn't use Beads.", detail: 'raw', workspace: { kind: 'no-workspace' } }),
    );
    const error = await createClient(host).bead({ directory: '/p/a', id: 'x-1' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BeadsRequestError);
    expect(error).toMatchObject({ code: 'workspace', status: 409, message: "This folder doesn't use Beads.", detail: 'raw', workspace: { kind: 'no-workspace' } });
  });

  it('maps a host transport failure to plain copy, keeping the raw text only in detail', async () => {
    const { host } = fakeHost(() => {
      throw new HostRequestError('SERVICE_FAILED', 'service exited 1\nTypeError: boom at main.js:12');
    });
    const error = (await createClient(host).snapshot({ directory: '/p/a' }).catch((e: unknown) => e)) as BeadsRequestError;
    expect(error.code).toBe('SERVICE_FAILED');
    expect(error.message).not.toMatch(/TypeError|main\.js/);
    expect(error.detail).toContain('TypeError: boom');
  });

  it('treats an unreadable answer as INTERNAL with the raw body only in detail', async () => {
    const { host } = fakeHost(() => ({ status: 502, body: '<html>Bad gateway</html>' }));
    const error = (await createClient(host).snapshot({ directory: '/p/a' }).catch((e: unknown) => e)) as BeadsRequestError;
    expect(error).toMatchObject({ code: 'INTERNAL', status: 502, detail: '<html>Bad gateway</html>' });
    expect(error.message).not.toContain('<html>');
  });

  it.each([
    ['HOST_TIMEOUT', 'Beads took too long to answer.'],
    ['NO_SERVICE', "Abacus's helper isn't available."],
    ['DISCONNECTED', "OpenChamber isn't connected."],
    ['HOST_UNAVAILABLE', "OpenChamber isn't available right now."],
    ['HOST_REJECTED', 'OpenChamber refused the request.'],
  ] as const)('maps %s to plain copy', async (code, message) => {
    const { host } = fakeHost(() => {
      throw new HostRequestError(code, 'raw host text');
    });
    const error = (await createClient(host).snapshot({ directory: '/p/a' }).catch((e: unknown) => e)) as BeadsRequestError;
    expect(error).toMatchObject({ code, message, detail: 'raw host text', status: null });
  });

  it('treats an empty detail as no detail', async () => {
    const { host } = fakeHost(() => envelope(503, { code: 'busy', message: 'Beads is busy.', detail: '' }));
    const error = (await createClient(host).snapshot({ directory: '/p/a' }).catch((e: unknown) => e)) as BeadsRequestError;
    expect(error.detail).toBeUndefined();
  });
});

/** Visibility the test controls. */
function visibility(initial = true) {
  let visible = initial;
  const listeners = new Set<() => void>();
  const v: Visibility & { set(next: boolean): void } = {
    isVisible: () => visible,
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      visible = next;
      listeners.forEach((l) => l());
    },
  };
  return v;
}

function setup(answer: (call: Call) => Answer | Promise<Answer>, vis = visibility()) {
  const fake = fakeHost(answer);
  const store = createStore({ client: createClient(fake.host), host: fake.host, visibility: vis });
  const snapshots = () => fake.calls.filter((c) => c.route === 'snapshot');
  return { ...fake, store, vis, snapshots };
}

describe('store polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls every 2 s while visible, passing the last cursor', async () => {
    let n = 0;
    const { store, snapshots } = setup(() => json(snapshot({ cursor: `c${++n}` })));
    store.setDirectory('/p/a');
    await flush();
    expect(snapshots()).toHaveLength(1);
    expect(snapshots()[0].body).toEqual({ directory: '/p/a' });
    await vi.advanceTimersByTimeAsync(1999);
    expect(snapshots()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(snapshots()).toHaveLength(2);
    expect(snapshots()[1].body).toEqual({ directory: '/p/a', cursor: 'c1' });
    expect(store.get().snapshot?.cursor).toBe('c2');
  });

  it('pauses while hidden and polls at once when shown again', async () => {
    const { store, snapshots, vis } = setup(() => json(snapshot()));
    store.setDirectory('/p/a');
    await flush();
    vis.set(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(snapshots()).toHaveLength(1);
    vis.set(true);
    await flush();
    expect(snapshots()).toHaveLength(2);
  });

  it('merges an unchanged answer into the held snapshot', async () => {
    let n = 0;
    const { store } = setup(() =>
      ++n === 1
        ? json(snapshot({ beads: [], freshness: { localRefreshedAt: 'T1', localError: null, localErrorDetail: null, teamSyncedAt: null, unpublished: null } }))
        : json({ unchanged: true, cursor: 'c1', freshness: { localRefreshedAt: 'T2', localError: null, localErrorDetail: null, teamSyncedAt: null, unpublished: null }, sync: { kind: 'idle' } }),
    );
    store.setDirectory('/p/a');
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.get().snapshot?.freshness.localRefreshedAt).toBe('T2');
    expect(store.get().snapshot?.workspace).toEqual(OK);
  });

  it('backs off on errors up to 30 s and returns to 2 s after a success', async () => {
    let failing = true;
    const { store, snapshots } = setup(() => (failing ? envelope(503, { code: 'busy', message: 'Beads is busy. Retrying.' }) : json(snapshot())));
    store.setDirectory('/p/a');
    await flush();
    expect(store.get().error?.message).toBe('Beads is busy. Retrying.');
    // Each wait is exact: nothing at one millisecond short, one poll at the mark.
    for (const expected of [4000, 8000, 16000, 30000, 30000]) {
      const before = snapshots().length;
      await vi.advanceTimersByTimeAsync(expected - 1);
      expect(snapshots()).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(snapshots()).toHaveLength(before + 1);
    }
    failing = false;
    await vi.advanceTimersByTimeAsync(30000);
    expect(store.get().error).toBeNull();
    const before = snapshots().length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(snapshots()).toHaveLength(before + 1);
  });

  it('Retry asks the service to detect the workspace again', async () => {
    const { store, snapshots } = setup(() => json(snapshot({ workspace: { kind: 'no-bd' } })));
    store.setDirectory('/p/a');
    await flush();
    store.retry();
    await flush();
    expect(snapshots().at(-1)?.body).toMatchObject({ directory: '/p/a', refreshWorkspace: true });
  });

  it('stops polling a workspace that cannot be used until Retry', async () => {
    const { store, snapshots } = setup(() => json(snapshot({ workspace: { kind: 'server-down', root: '/p/a', port: 3307 } })));
    store.setDirectory('/p/a');
    await flush();
    expect(store.get().workspace).toEqual({ kind: 'server-down', root: '/p/a', port: 3307 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(snapshots()).toHaveLength(1);
  });

  it('shows the workspace state carried by a workspace error', async () => {
    const { store } = setup(() => envelope(409, { code: 'workspace', message: "Beads isn't installed on this computer.", workspace: { kind: 'no-bd' } }));
    store.setDirectory('/p/a');
    await flush();
    expect(store.get().workspace).toEqual({ kind: 'no-bd' });
    expect(store.get().error).toBeNull();
  });

  it('first-contact Confirm records consent, then re-detects with refreshWorkspace', async () => {
    let confirmed = false;
    const { store, calls } = setup(({ route, body }) => {
      if (route === 'workspace') {
        confirmed = body.confirmFirstContact === true;
        return json(OK);
      }
      return json(snapshot({ workspace: confirmed ? OK : { kind: 'needs-first-contact', root: '/p/a', lastOpenedWith: '1.2.2', bdVersion: '1.3.0' } }));
    });
    store.setDirectory('/p/a');
    await flush();
    expect(store.get().workspace?.kind).toBe('needs-first-contact');
    await store.confirmFirstContact();
    await flush();
    expect(calls.map((c) => c.route)).toEqual(['snapshot', 'workspace', 'snapshot']);
    expect(calls[1].body).toEqual({ directory: '/p/a', confirmFirstContact: true });
    expect(calls[2].body).toMatchObject({ refreshWorkspace: true });
    expect(store.get().workspace).toEqual(OK);
  });

  it('a failing snapshot after Confirm keeps polling', async () => {
    let confirmed = false;
    const { store, snapshots } = setup(({ route }) => {
      if (route === 'workspace') {
        confirmed = true;
        return json(OK);
      }
      if (confirmed) return envelope(503, { code: 'busy', message: 'Beads is busy. Retrying.' });
      return json(snapshot({ workspace: { kind: 'needs-first-contact', root: '/p/a', lastOpenedWith: '1.2.2', bdVersion: '1.3.0' } }));
    });
    store.setDirectory('/p/a');
    await flush();
    await store.confirmFirstContact();
    await flush();
    expect(store.get()).toMatchObject({ workspace: OK, snapshot: null, confirming: false });
    expect(store.get().error?.message).toBe('Beads is busy. Retrying.');
    const before = snapshots().length;
    await vi.advanceTimersByTimeAsync(4000);
    expect(snapshots()).toHaveLength(before + 1);
  });

  it('a 409 with an ok workspace resumes polling', async () => {
    let confirmed = false;
    const { store, snapshots } = setup(({ route }) => {
      if (route === 'workspace') {
        confirmed = true;
        return envelope(409, { code: 'workspace', message: 'This project is not waiting for confirmation.', workspace: OK });
      }
      return json(snapshot({ cursor: confirmed ? 'ok1' : 'w1', workspace: confirmed ? OK : { kind: 'needs-first-contact', root: '/p/a', lastOpenedWith: '1.2.2', bdVersion: '1.3.0' } }));
    });
    store.setDirectory('/p/a');
    await flush();
    await store.confirmFirstContact();
    await flush();
    expect(snapshots().at(-1)?.body).toMatchObject({ refreshWorkspace: true });
    expect(store.get()).toMatchObject({ workspace: OK, confirming: false });
    expect(store.get().snapshot?.cursor).toBe('ok1');
    const before = snapshots().length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(snapshots()).toHaveLength(before + 1);
  });

  it('becoming visible does not start a second poll while one is in flight', async () => {
    const slow = deferred<Answer>();
    let n = 0;
    const { store, snapshots, vis } = setup(() => (++n === 1 ? json(snapshot()) : slow.promise));
    store.setDirectory('/p/a');
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(snapshots()).toHaveLength(2);
    vis.set(false);
    vis.set(true);
    await flush();
    expect(snapshots()).toHaveLength(2);
    slow.resolve(json(snapshot({ cursor: 'c2' })));
    await flush();
    expect(store.get().snapshot?.cursor).toBe('c2');
  });

  it('Retry overtakes a poll in flight and the late answer is dropped', async () => {
    const slow = deferred<Answer>();
    let n = 0;
    const { store, snapshots } = setup(() => (++n === 1 ? slow.promise : json(snapshot({ cursor: 'retry' }))));
    store.setDirectory('/p/a');
    await flush();
    store.retry();
    await flush();
    expect(snapshots()).toHaveLength(2);
    expect(store.get().snapshot?.cursor).toBe('retry');
    slow.resolve(json(snapshot({ cursor: 'late' })));
    await flush();
    expect(store.get().snapshot?.cursor).toBe('retry');
  });

  it('a hidden pane leaves a change to the open bead unseen, and marks it seen with its banner once shown', async () => {
    const T = '2026-10-14T10:00:00Z';
    const bead = (title: string): Bead => ({
      id: 'p-a', title, status: 'open', priority: 2, type: 'task', assignee: null, labels: [], parentId: null, description: '', design: '',
      acceptance: '', notes: '', createdAt: T, createdBy: null, updatedAt: T, closedAt: null, closeReason: null, dependencies: [], comments: [], extra: {},
    });
    const change = { id: 'ev1', beadId: 'p-a', kind: 'field' as const, field: 'title', from: 'Old', to: 'New', actor: 'claude', byPanel: false, observedAt: T, unseen: true };
    let changed = false;
    let seen = false;
    const { store, vis, calls } = setup((call) => {
      if (call.route === 'seen') {
        seen = true;
        return json({ unseenIds: [] });
      }
      if (call.route === 'bead') return json({ bead: bead(changed ? 'New' : 'Old'), related: { parent: null, children: [], deps: [] } });
      if (!changed) return json(snapshot({ beads: [bead('Old')] }));
      return json(snapshot({ cursor: seen ? 'c3' : 'c2', beads: [bead('New')], unseenIds: seen ? [] : ['p-a'], activity: [{ ...change, unseen: !seen }] }));
    });
    store.setDirectory('/p/a');
    await flush();
    store.select('p-a');
    await flush();
    vis.set(false);
    changed = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.get().snapshot?.unseenIds).toEqual(['p-a']);
    expect(calls.filter((c) => c.route === 'seen')).toHaveLength(0);
    expect(store.get().detail?.stack.at(-1)?.change).toBeNull();

    vis.set(true);
    await flush();
    expect(calls.filter((c) => c.route === 'seen').map((c) => c.body.ids)).toEqual([['p-a']]);
    expect(store.get().detail?.stack.at(-1)?.change?.id).toBe('ev1');
    expect(store.get().snapshot?.unseenIds).toEqual([]);
  });

  it('measures freshness from when the panel was shown again', async () => {
    const { store, vis } = setup(() => json(snapshot()));
    store.setDirectory('/p/a');
    await flush();
    const opened = store.get().watchedSince;
    vis.set(false);
    await vi.advanceTimersByTimeAsync(60_000);
    vis.set(true);
    expect(store.get().watchedSince).toBe(opened + 60_000);
    vis.set(true);
    expect(store.get().watchedSince).toBe(opened + 60_000);
  });

  it('drops stale responses after directory change', async () => {
    const slowA = deferred<Answer>();
    const { store } = setup(({ body }) =>
      body.directory === '/p/a' ? slowA.promise : json(snapshot({ cursor: 'b1', workspace: { ...OK, root: '/p/b', projectName: 'bravo' } })),
    );
    store.setDirectory('/p/a');
    await flush();
    store.setDirectory('/p/b');
    await flush();
    expect(store.get().snapshot?.cursor).toBe('b1');
    slowA.resolve(json(snapshot({ cursor: 'a1', workspace: { ...OK, projectName: 'alpha' } })));
    await flush();
    expect(store.get().directory).toBe('/p/b');
    expect(store.get().snapshot?.cursor).toBe('b1');
    expect(store.get().workspace).toMatchObject({ projectName: 'bravo' });
  });

  it('drops a stale failure after directory change', async () => {
    const slowA = deferred<Answer>();
    const { store } = setup(({ body }) => (body.directory === '/p/a' ? slowA.promise : json(snapshot({ cursor: 'b1' }))));
    store.setDirectory('/p/a');
    await flush();
    store.setDirectory('/p/b');
    await flush();
    slowA.resolve(envelope(500, { code: 'beads-error', message: "Couldn't read Beads." }));
    await flush();
    expect(store.get().error).toBeNull();
  });

  it('a directory change clears what the old project showed', async () => {
    const slowB = deferred<Answer>();
    const { store } = setup(({ body }) => (body.directory === '/p/a' ? json(snapshot({ cursor: 'a1' })) : slowB.promise));
    store.setDirectory('/p/a');
    await flush();
    store.select('x-1');
    store.setDirectory('/p/b');
    expect(store.get()).toMatchObject({ directory: '/p/b', snapshot: null, workspace: null, selectedId: null, error: null });
  });
});

describe('store persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keys UI state by a short digest of the directory', () => {
    expect(uiKey('/p/a')).toMatch(/^ui:[0-9a-f]{16}$/);
    expect(uiKey('/p/a')).toBe(uiKey('/p/a'));
    expect(uiKey('/p/a')).not.toBe(uiKey('/p/b'));
  });

  it('persists view, filters and collapsed per project and restores them', async () => {
    const fake = fakeHost(() => json(snapshot()));
    const first = createStore({ client: createClient(fake.host), host: fake.host, visibility: visibility() });
    first.setDirectory('/p/a');
    await flush();
    first.setView('status');
    // Deferred and Closed start collapsed; toggling Closed opens it.
    first.toggleCollapsed('status:closed');
    first.setFilters({ ...first.get().filters, ready: true, due: 'overdue' });
    await flush();
    expect(fake.stored.get(uiKey('/p/a'))).toMatchObject({ view: 'status', collapsed: ['status:deferred'], filters: { ready: true, due: 'overdue' } });
    first.dispose();

    const second = createStore({ client: createClient(fake.host), host: fake.host, visibility: visibility() });
    second.setDirectory('/p/a');
    await flush();
    expect(second.get()).toMatchObject({ view: 'status', collapsed: ['status:deferred'], filters: { ready: true, due: 'overdue' } });
    second.setDirectory('/p/b');
    await flush();
    expect(second.get().view).toBe('epic');
    second.dispose();
  });

  it('ignores a stored value it does not understand', async () => {
    const fake = fakeHost(() => json(snapshot()));
    fake.stored.set(uiKey('/p/a'), { view: 'kanban', collapsed: 'x', filters: 7 });
    const store = createStore({ client: createClient(fake.host), host: fake.host, visibility: visibility() });
    store.setDirectory('/p/a');
    await flush();
    expect(store.get()).toMatchObject({ view: 'epic', collapsed: ['status:deferred', 'status:closed'] });
    expect(store.get().filters.ready).toBe(false);
    store.dispose();
  });

  it('a storage load that lands after dispose changes nothing', async () => {
    const fake = fakeHost(() => json(snapshot()));
    const load = deferred<unknown>();
    (fake.host.storage as { get: unknown }).get = () => load.promise;
    const store = createStore({ client: createClient(fake.host), host: fake.host, visibility: visibility() });
    store.setDirectory('/p/a');
    await flush();
    store.dispose();
    load.resolve({ view: 'status' });
    await flush();
    expect(store.get().view).toBe('epic');
  });

  it('an answer that lands after dispose changes nothing and schedules nothing', async () => {
    const slow = deferred<Answer>();
    const fake = fakeHost(() => slow.promise);
    const store = createStore({ client: createClient(fake.host), host: fake.host, visibility: visibility() });
    store.setDirectory('/p/a');
    await flush();
    store.dispose();
    slow.resolve(json(snapshot()));
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.get().snapshot).toBeNull();
    expect(fake.calls).toHaveLength(1);
  });
});

describe('pageVisibility', () => {
  function fakeWindow() {
    const docListeners = new Set<() => void>();
    const winListeners = new Set<() => void>();
    let observed: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;
    const win = {
      innerWidth: 380,
      innerHeight: 640,
      document: {
        visibilityState: 'visible' as DocumentVisibilityState,
        documentElement: {},
        addEventListener: (_: string, l: () => void) => docListeners.add(l),
        removeEventListener: (_: string, l: () => void) => docListeners.delete(l),
      },
      addEventListener: (_: string, l: () => void) => winListeners.add(l),
      removeEventListener: (_: string, l: () => void) => winListeners.delete(l),
      IntersectionObserver: class {
        constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
          observed = callback;
        }
        observe() {}
        disconnect() {
          observed = null;
        }
      },
    };
    return { win, resize: () => winListeners.forEach((l) => l()), intersect: (isIntersecting: boolean) => observed?.([{ isIntersecting }]), docListeners, winListeners };
  }

  it('is hidden when the pane collapses to zero size (display: none), and tells the store', () => {
    const f = fakeWindow();
    const v = pageVisibility(f.win as never);
    const changed = vi.fn();
    const stop = v.onChange(changed);
    expect(v.isVisible()).toBe(true);
    f.win.innerWidth = 0;
    f.resize();
    expect(changed).toHaveBeenCalled();
    expect(v.isVisible()).toBe(false);
    f.win.innerWidth = 380;
    f.resize();
    expect(v.isVisible()).toBe(true);
    stop();
    expect(f.winListeners.size + f.docListeners.size).toBe(0);
  });

  it('is hidden when the root stops intersecting', () => {
    const f = fakeWindow();
    const v = pageVisibility(f.win as never);
    const changed = vi.fn();
    v.onChange(changed);
    f.intersect(false);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(v.isVisible()).toBe(false);
    f.intersect(true);
    expect(v.isVisible()).toBe(true);
  });

  it('is hidden when the document is hidden', () => {
    const f = fakeWindow();
    const v = pageVisibility(f.win as never);
    f.win.document.visibilityState = 'hidden';
    expect(v.isVisible()).toBe(false);
  });
});
