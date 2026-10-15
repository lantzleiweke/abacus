import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../../../src/panel/client';
import { createStore, LIVE_POLL_MS, POLL_MS } from '../../../src/panel/store';
import { fakeHost, flush, json, snapshot, type Answer, type Call } from './helpers';

function visibility(initial = true) {
  let visible = initial;
  const listeners = new Set<() => void>();
  return {
    isVisible: () => visible,
    onChange: (listener: () => void) => (listeners.add(listener), () => listeners.delete(listener)),
    set(next: boolean) {
      visible = next;
      listeners.forEach((l) => l());
    },
  };
}

// The service answers `unchanged` once the cursor is current; `following` rides on every answer.
function setup(following: () => boolean | undefined, vis = visibility()) {
  const answer = (call: Call): Answer => {
    const f = following();
    const base = snapshot({ cursor: 'c1', ...(f === undefined ? {} : { following: f }) });
    if (call.route === 'snapshot' && (call.body as { cursor?: string }).cursor === 'c1') {
      return json({ unchanged: true, cursor: 'c1', freshness: base.freshness, sync: base.sync, ...(f === undefined ? {} : { following: f }) });
    }
    return json(base);
  };
  const fake = fakeHost(answer);
  const store = createStore({ client: createClient(fake.host), host: fake.host, visibility: vis });
  const polls = () => fake.calls.filter((c) => c.route === 'snapshot').length;
  return { ...fake, store, vis, polls };
}

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse('2026-10-15T12:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('store: polls faster while the events follower is running (L6)', () => {
  it('asks about every 500 ms while visible and following', async () => {
    const { store, polls } = setup(() => true);
    store.setDirectory('/p/a');
    await flush();
    const first = polls();
    await vi.advanceTimersByTimeAsync(2 * LIVE_POLL_MS + 50);
    expect(polls() - first).toBe(2);
    store.dispose();
  });

  it('keeps the normal interval when the service is not following, or does not say', async () => {
    for (const following of [false, undefined]) {
      const { store, polls } = setup(() => following);
      store.setDirectory('/p/a');
      await flush();
      const first = polls();
      await vi.advanceTimersByTimeAsync(POLL_MS - 100);
      expect(polls() - first).toBe(0);
      await vi.advanceTimersByTimeAsync(200);
      expect(polls() - first).toBe(1);
      store.dispose();
    }
  });

  it('goes back to the normal interval when the follower stops', async () => {
    let following = true;
    const { store, polls } = setup(() => following);
    store.setDirectory('/p/a');
    await flush();
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS + 50);
    following = false;
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS + 50);
    const settled = polls();
    await vi.advanceTimersByTimeAsync(POLL_MS - 300);
    expect(polls() - settled).toBe(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(polls() - settled).toBe(1);
    store.dispose();
  });

  it('does not poll fast while the panel is not visible', async () => {
    const vis = visibility(true);
    const { store, polls } = setup(() => true, vis);
    store.setDirectory('/p/a');
    await flush();
    vis.set(false);
    await flush();
    const before = polls();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(polls() - before).toBeLessThanOrEqual(1);
    store.dispose();
  });
});
