import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../../../src/panel/client';
import { KEEP_MS } from '../../../src/panel/needs';
import { createStore, projectKey, uiKey } from '../../../src/panel/store';
import type { Bead, Gate } from '../../../src/shared/types';
import { deferred, envelope, fakeHost, flush, json, snapshot, type Answer, type Call } from './helpers';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const DAY = 86_400_000;
const bead = (id: string, over: Partial<Bead> = {}): Bead => ({
  id, title: `Title ${id}`, status: 'open', priority: 2, type: 'task', assignee: null, labels: [], parentId: null, description: '', design: '', acceptance: '', notes: '',
  createdAt: '2026-09-01T00:00:00Z', createdBy: null, updatedAt: '2026-10-14T12:00:00Z', closedAt: null, closeReason: null, dependencies: [], comments: [], extra: {}, ...over,
});
const gate = (blocks: string[]): Gate => ({ id: 'g-1', kind: 'human', reason: 'Please review', blocks, createdBy: null, createdAt: '2026-10-14T12:00:00Z', timeoutMs: null, planApproval: false });
const stuckBead = bead('p-stuck', { status: 'in_progress', updatedAt: new Date(NOW - 5 * DAY).toISOString() });

const visibility = () => ({ isVisible: () => true, onChange: () => () => {} });

function setup(answer: (call: Call) => Answer | Promise<Answer>) {
  const fake = fakeHost(answer);
  const store = createStore({ client: createClient(fake.host), host: fake.host, visibility: visibility() });
  return { ...fake, store };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('store: capabilities, gates and leases come from the snapshot', () => {
  it('are taken from the full answer, and reset when the project changes', async () => {
    const { store } = setup(() => json(snapshot({ beads: [bead('p-1')], capabilities: { eventsJournal: true, leases: true }, gates: [gate(['p-1'])], leases: [{ beadId: 'p-1', holder: 'A', expiresAt: '2026-10-15T13:00:00Z' }] })));
    expect(store.get()).toMatchObject({ capabilities: { eventsJournal: false, leases: false }, gates: [], leases: [] });
    store.setDirectory('/p/a');
    await flush();
    expect(store.get()).toMatchObject({ capabilities: { eventsJournal: true, leases: true } });
    expect(store.get().gates).toHaveLength(1);
    expect(store.get().leases).toHaveLength(1);
    store.setDirectory('/p/b');
    expect(store.get()).toMatchObject({ capabilities: { eventsJournal: false, leases: false }, gates: [], leases: [], snapshot: null });
    store.dispose();
  });
});

describe('store: unsupported hides the entry points', () => {
  it('a write the installed Beads cannot do marks its feature, for this project only', async () => {
    const { store } = setup((call) => (call.route === 'gateCreate' ? envelope(400, { code: 'unsupported', message: 'Needs Beads 1.3' }) : json(snapshot())));
    store.setDirectory('/p/a');
    await flush();
    expect(store.get().unsupported.has('gates')).toBe(false);
    const outcome = await store.requestReview('p-1');
    expect(outcome.kind).toBe('error');
    expect(store.get().unsupported.has('gates')).toBe(true);
    store.setDirectory('/p/b');
    expect(store.get().unsupported.size).toBe(0);
    store.dispose();
  });

  it('a read marks it too, and other errors do not', async () => {
    let code = 'unsupported';
    const { store } = setup((call) => (call.route === 'history' ? envelope(400, { code, message: 'no' }) : json(snapshot())));
    store.setDirectory('/p/a');
    await flush();
    code = 'unavailable';
    expect((await store.readHistory({ id: 'p-1' })).kind).toBe('error');
    expect(store.get().unsupported.size).toBe(0);
    code = 'unsupported';
    expect((await store.readHistory({ id: 'p-1' })).kind).toBe('error');
    expect([...store.get().unsupported]).toEqual(['history']);
    store.dispose();
  });

  it('a read that lands after the project changed is dropped and marks nothing', async () => {
    const slow = deferred<Answer>();
    const { store } = setup((call) => (call.route === 'memories' ? slow.promise : json(snapshot())));
    store.setDirectory('/p/a');
    await flush();
    const read = store.readMemories();
    store.setDirectory('/p/b');
    slow.resolve(envelope(400, { code: 'unsupported', message: 'no' }));
    expect((await read).kind).toBe('dropped');
    expect(store.get().unsupported.size).toBe(0);
    store.dispose();
  });
});

describe('store: keep map is per project', () => {
  it('keeping a row hides it for 7 days, is stored with the threshold, and is not shared with another project', async () => {
    const { store, stored } = setup(() => json(snapshot({ beads: [stuckBead] })));
    store.setDirectory('/p/a');
    await flush();
    store.keepStuck('p-stuck');
    store.setStaleDays(5);
    await flush();
    expect(store.get().keep).toEqual({ 'p-stuck': NOW + KEEP_MS });
    expect(stored.get(projectKey('/p/a'))).toEqual({ staleDays: 5, keep: { 'p-stuck': NOW + KEEP_MS } });
    expect(projectKey('/p/a')).toMatch(/^project:[0-9a-f]{16}$/);
    expect(projectKey('/p/a')).not.toBe(projectKey('/p/b'));
    expect(projectKey('/p/a')).not.toBe(uiKey('/p/a'));

    store.setDirectory('/p/b');
    expect(store.get()).toMatchObject({ keep: {}, settings: { staleDays: 3 } });
    await flush();
    expect(store.get()).toMatchObject({ keep: {}, settings: { staleDays: 3 } });

    store.setDirectory('/p/a');
    await flush();
    expect(store.get()).toMatchObject({ keep: { 'p-stuck': NOW + KEEP_MS }, settings: { staleDays: 5 } });
    store.dispose();
  });

  it('a project load that lands after a switch does not leak into the new project', async () => {
    const fake = fakeHost(() => json(snapshot()));
    fake.stored.set(projectKey('/p/a'), { staleDays: 9, keep: { 'p-1': NOW + DAY } });
    const slow = deferred<unknown>();
    const real = fake.host.storage.get.bind(fake.host.storage);
    (fake.host.storage as { get: unknown }).get = (key: string) => (key === projectKey('/p/a') ? slow.promise : real(key));
    const store = createStore({ client: createClient(fake.host), host: fake.host, visibility: visibility() });
    store.setDirectory('/p/a');
    await flush();
    store.setDirectory('/p/b');
    slow.resolve({ staleDays: 9, keep: { 'p-1': NOW + DAY } });
    await flush();
    expect(store.get()).toMatchObject({ keep: {}, settings: { staleDays: 3 } });
    store.dispose();
  });

  it('kept rows that are already over are let go on load, and a stored value it does not understand falls back', async () => {
    const fake = fakeHost(() => json(snapshot()));
    fake.stored.set(projectKey('/p/a'), { staleDays: 0, keep: { old: NOW - 1, soon: NOW + 1, bad: 'x' } });
    const store = createStore({ client: createClient(fake.host), host: fake.host, visibility: visibility() });
    store.setDirectory('/p/a');
    await flush();
    expect(store.get().keep).toEqual({ soon: NOW + 1 });
    expect(store.get().settings.staleDays).toBe(3);
    store.dispose();
  });

  it('the threshold is a whole number of days, from 1 to 30', async () => {
    const { store } = setup(() => json(snapshot()));
    store.setDirectory('/p/a');
    await flush();
    store.setStaleDays(0);
    expect(store.get().settings.staleDays).toBe(1);
    store.setStaleDays(2.4);
    expect(store.get().settings.staleDays).toBe(2);
    store.setStaleDays(Number.NaN);
    expect(store.get().settings.staleDays).toBe(2);
    store.setStaleDays(45);
    expect(store.get().settings.staleDays).toBe(30);
    store.dispose();
  });

  it('a stored threshold above 30 days falls back to the default', async () => {
    const fake = fakeHost(() => json(snapshot()));
    fake.stored.set(projectKey('/p/a'), { staleDays: 31, keep: {} });
    const store = createStore({ client: createClient(fake.host), host: fake.host, visibility: visibility() });
    store.setDirectory('/p/a');
    await flush();
    expect(store.get().settings.staleDays).toBe(3);
    store.dispose();
  });
});

describe('store: default view is needs only when the count is above zero', () => {
  it('opens on Needs me when something waits, and does not save that as the last used view', async () => {
    const { store, stored } = setup(() => json(snapshot({ beads: [bead('p-1')], gates: [gate(['p-1'])] })));
    store.setDirectory('/p/a');
    await flush();
    expect(store.get().view).toBe('needs');
    expect(stored.get(uiKey('/p/a'))).toBeUndefined();
    store.dispose();
  });

  it('a Needs me that opened by itself is never saved as the chosen view; a click on its tab is', async () => {
    const fake = fakeHost(() => json(snapshot({ beads: [bead('p-1')], gates: [gate(['p-1'])] })));
    fake.stored.set(uiKey('/p/a'), { view: 'status' });
    const store = createStore({ client: createClient(fake.host), host: fake.host, visibility: visibility() });
    store.setDirectory('/p/a');
    await flush();
    expect(store.get().view).toBe('needs');
    // A filter or a fold saves the UI state: the view saved is still the person's own.
    store.toggleCollapsed('epic:x');
    expect(fake.stored.get(uiKey('/p/a'))).toMatchObject({ view: 'status', collapsed: expect.arrayContaining(['epic:x']) });
    store.setFilters({ ...store.get().filters, ready: true });
    expect(fake.stored.get(uiKey('/p/a'))).toMatchObject({ view: 'status' });
    store.setView('needs');
    expect(fake.stored.get(uiKey('/p/a'))).toMatchObject({ view: 'needs' });
    store.dispose();
  });

  it('keeps the last used view when nothing needs the person', async () => {
    const fake = fakeHost(() => json(snapshot({ beads: [bead('p-1')] })));
    fake.stored.set(uiKey('/p/a'), { view: 'status' });
    const store = createStore({ client: createClient(fake.host), host: fake.host, visibility: visibility() });
    store.setDirectory('/p/a');
    await flush();
    expect(store.get().view).toBe('status');
    store.dispose();
  });

  it('a kept stuck row does not count, so Needs me does not open for it', async () => {
    const fake = fakeHost(() => json(snapshot({ beads: [stuckBead] })));
    const open = createStore({ client: createClient(fake.host), host: fake.host, visibility: visibility() });
    open.setDirectory('/p/a');
    await flush();
    expect(open.get().view).toBe('needs');
    open.keepStuck('p-stuck');
    await flush();
    open.dispose();

    const again = createStore({ client: createClient(fake.host), host: fake.host, visibility: visibility() });
    again.setDirectory('/p/a');
    await flush();
    expect(again.get().view).toBe('epic');
    again.dispose();
  });

  it('a view the person picked before the first answer is theirs, and it is decided once per open', async () => {
    const slow = deferred<Answer>();
    const { store } = setup(() => slow.promise);
    store.setDirectory('/p/a');
    await flush();
    store.setView('activity');
    slow.resolve(json(snapshot({ beads: [bead('p-1')], gates: [gate(['p-1'])] })));
    await flush();
    expect(store.get().view).toBe('activity');
    store.dispose();
  });

  it('later answers do not pull the person back to Needs me', async () => {
    let gates: Gate[] = [];
    let n = 0;
    const { store } = setup(() => json(snapshot({ cursor: `c${++n}`, beads: [bead('p-1')], gates })));
    store.setDirectory('/p/a');
    await flush();
    expect(store.get().view).toBe('epic');
    gates = [gate(['p-1'])];
    await vi.advanceTimersByTimeAsync(2_500);
    expect(store.get().gates).toHaveLength(1);
    expect(store.get().view).toBe('epic');
    store.dispose();
  });

  it('Needs me is a view the person can pick and have remembered', async () => {
    const { store, stored } = setup(() => json(snapshot()));
    store.setDirectory('/p/a');
    await flush();
    store.setView('needs');
    expect(stored.get(uiKey('/p/a'))).toMatchObject({ view: 'needs' });
    store.dispose();
  });
});

describe('store: writes for reviews and requests', () => {
  it('answering a request shows the closed bead at once and reads the project again', async () => {
    const closed = bead('p-1', { status: 'closed', labels: ['human'] });
    const { store, calls } = setup((call) => (call.route === 'humanRespond' ? json({ ok: true, bead: closed }) : json(snapshot({ beads: [bead('p-1', { labels: ['human'] })] }))));
    store.setDirectory('/p/a');
    await flush();
    const before = calls.filter((c) => c.route === 'snapshot').length;
    const outcome = await store.respond('p-1', 'Blue.');
    expect(outcome).toEqual({ kind: 'ok', value: { ok: true, bead: closed } });
    expect(calls.find((c) => c.route === 'humanRespond')?.body).toEqual({ directory: '/p/a', id: 'p-1', response: 'Blue.' });
    expect(store.get().snapshot?.beads[0]!.status).toBe('closed');
    await flush();
    expect(calls.filter((c) => c.route === 'snapshot').length).toBeGreaterThan(before);
    store.dispose();
  });

  it('not-open comes back as a value, with the bead as it is now', async () => {
    const now = bead('p-1', { status: 'closed' });
    const { store } = setup((call) => (call.route === 'humanDismiss' ? json({ ok: false, code: 'not-open', current: now }) : json(snapshot({ beads: [bead('p-1')] }))));
    store.setDirectory('/p/a');
    await flush();
    expect(await store.dismissRequest('p-1')).toEqual({ kind: 'ok', value: { ok: false, code: 'not-open', current: now } });
    expect(store.get().snapshot?.beads[0]!.status).toBe('closed');
    store.dispose();
  });

  it('a snooze takes the same path as an update: a conflict comes back with the bead as it is now', async () => {
    const current = bead('p-1', { title: 'Someone else' });
    const { store, calls } = setup((call) => (call.route === 'deferBead' ? json({ ok: false, conflict: true, current }) : json(snapshot({ beads: [bead('p-1')] }))));
    store.setDirectory('/p/a');
    await flush();
    expect(await store.defer('p-1', 'then', '+2d')).toEqual({ kind: 'conflict', current });
    expect(calls.find((c) => c.route === 'deferBead')?.body).toEqual({ directory: '/p/a', id: 'p-1', expectedUpdatedAt: 'then', until: '+2d' });
    store.dispose();
  });
});

describe('store: turning on live updates', () => {
  const MESSAGE = 'Live updates are switched on, but Beads did not confirm it in time. Check the status before trying again.';

  it('an uncertain answer keeps the service message and reads the events status again', async () => {
    const { store, calls } = setup((call) => {
      if (call.route === 'enableEvents') return envelope(504, { code: 'uncertain', message: MESSAGE, saved: true });
      if (call.route === 'eventsStatus') return json({ available: true, journal: 'on', live: 'following' });
      return json(snapshot());
    });
    store.setDirectory('/p/a');
    await flush();
    const outcome = await store.enableEvents();
    expect(outcome).toEqual({ kind: 'uncertain', current: null, saved: true, message: MESSAGE, status: { available: true, journal: 'on', live: 'following' } });
    expect(calls.filter((c) => c.route === 'eventsStatus')).toHaveLength(1);
    expect(calls.find((c) => c.route === 'enableEvents')?.body).toEqual({ directory: '/p/a', confirm: true });
    store.dispose();
  });

  it('when the status cannot be read either, the message is still there and the status is null', async () => {
    const { store } = setup((call) => {
      if (call.route === 'enableEvents') return envelope(504, { code: 'uncertain', message: MESSAGE });
      if (call.route === 'eventsStatus') return envelope(500, { code: 'beads-error', message: 'no' });
      return json(snapshot());
    });
    store.setDirectory('/p/a');
    await flush();
    expect(await store.enableEvents()).toMatchObject({ kind: 'uncertain', saved: false, message: MESSAGE, status: null });
    store.dispose();
  });

  it('is dropped when the project changes while the status is read again', async () => {
    const slow = deferred<Answer>();
    const { store } = setup((call) => {
      if (call.route === 'enableEvents') return envelope(504, { code: 'uncertain', message: MESSAGE });
      if (call.route === 'eventsStatus') return slow.promise;
      return json(snapshot());
    });
    store.setDirectory('/p/a');
    await flush();
    const outcome = store.enableEvents();
    await flush();
    store.setDirectory('/p/b');
    slow.resolve(json({ available: true, journal: 'on', live: 'following' }));
    expect(await outcome).toEqual({ kind: 'dropped' });
    store.dispose();
  });

  it('a clean answer is a plain ok and does not read the status', async () => {
    const status = { available: true, journal: 'on', live: 'following' };
    const { store, calls } = setup((call) => (call.route === 'enableEvents' ? json({ ok: true, status }) : json(snapshot())));
    store.setDirectory('/p/a');
    await flush();
    expect(await store.enableEvents()).toEqual({ kind: 'ok', value: { ok: true, status } });
    expect(calls.some((c) => c.route === 'eventsStatus')).toBe(false);
    store.dispose();
  });
});
