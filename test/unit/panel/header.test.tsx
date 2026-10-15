// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';
import { createClient } from '../../../src/panel/client';
import { createStore, StoreContext, uiKey, type Store } from '../../../src/panel/store';
import { Header } from '../../../src/panel/ui/Header';
import { App } from '../../../src/panel/ui/App';
import { WorkspaceEmpty, workspaceCopy } from '../../../src/panel/ui/EmptyState';
import type { WorkspaceState } from '../../../src/shared/types';
import { envelope, fakeHost, flush, freshness, json, OK, snapshot, type Answer, type Call } from './helpers';

const NOW = new Date('2026-10-14T12:00:00Z').getTime();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function visibility() {
  let visible = true;
  const listeners = new Set<() => void>();
  return {
    isVisible: () => visible,
    onChange: (l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    set(next: boolean) {
      visible = next;
      listeners.forEach((l) => l());
    },
  };
}

function setup(answer: (call: Call) => Answer | Promise<Answer>) {
  const fake = fakeHost(answer);
  const toast = vi.fn(async () => {});
  (fake.host as { toast: unknown }).toast = toast;
  const vis = visibility();
  const store = createStore({ client: createClient(fake.host), host: fake.host, visibility: vis });
  const wrap = (ui: ComponentChildren) => render(<StoreContext.Provider value={store}>{ui}</StoreContext.Provider>);
  return { ...fake, store, toast, wrap, vis };
}

async function open(store: Store, directory = '/p/a') {
  await act(async () => {
    store.setDirectory(directory);
    await flush();
  });
}

const tick = (ms: number) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms);
});

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Header freshness', () => {
  it('shows the project name and "Local, refreshed Ns ago"', async () => {
    const { store, wrap } = setup(() => json(snapshot({ freshness: freshness({ localRefreshedAt: iso(6000) }) })));
    wrap(<Header />);
    await open(store);
    expect(screen.getByText('demo')).toBeTruthy();
    expect(screen.getByText('Local, refreshed 6s ago')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('counts the age up every second between polls', async () => {
    const refreshedAt = iso(4000);
    const { store, wrap } = setup(() => json(snapshot({ freshness: freshness({ localRefreshedAt: refreshedAt }) })));
    wrap(<Header />);
    await open(store);
    await tick(3000);
    expect(screen.getByText('Local, refreshed 7s ago')).toBeTruthy();
  });

  it('turns stale with Retry after 30 s without a successful refresh', async () => {
    const refreshedAt = iso(0);
    let failing = false;
    const { store, wrap, calls } = setup(() =>
      failing ? envelope(503, { code: 'busy', message: 'Beads is busy. Retrying.' }) : json(snapshot({ freshness: freshness({ localRefreshedAt: refreshedAt }) })),
    );
    wrap(<Header />);
    await open(store);
    failing = true;
    await tick(29_000);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    await tick(2_000);
    expect(screen.getByText('Local, refreshed 31s ago')).toBeTruthy();
    expect(screen.getByText('Beads is busy. Retrying.')).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Retry' });
    await act(async () => {
      fireEvent.click(retry);
      await flush();
    });
    expect(calls.at(-1)).toMatchObject({ route: 'snapshot', body: { refreshWorkspace: true } });
  });

  it('turns stale at once on a local error and keeps the raw cause behind Copy details', async () => {
    const { store, wrap, toast } = setup(() =>
      json(snapshot({ freshness: freshness({ localRefreshedAt: iso(2000), localError: "Couldn't read Beads. Retrying.", localErrorDetail: 'exit 1: database locked' }) })),
    );
    wrap(<Header />);
    await open(store);
    expect(screen.getByText("Couldn't read Beads. Retrying.")).toBeTruthy();
    expect(screen.queryByText(/database locked/)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
      await flush();
    });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ copy: { text: 'exit 1: database locked' } }));
  });

  it('offers no Copy details when the detail is empty', async () => {
    const { store, wrap } = setup(() => json(snapshot({ freshness: freshness({ localRefreshedAt: iso(2000), localError: "Couldn't read Beads.", localErrorDetail: '' }) })));
    wrap(<Header />);
    await open(store);
    expect(screen.getByText("Couldn't read Beads.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy details' })).toBeNull();
  });

  it('does not flash stale when the panel is shown again after a long time hidden', async () => {
    let n = 0;
    const { store, wrap, vis } = setup(() => (++n === 1 ? json(snapshot({ freshness: freshness({ localRefreshedAt: iso(0) }) })) : new Promise<Answer>(() => {})));
    wrap(<Header />);
    await open(store);
    await act(async () => {
      vis.set(false);
      await vi.advanceTimersByTimeAsync(120_000);
      vis.set(true);
      await flush();
    });
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    await tick(31_000);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('shows the team line only when the project has a shared copy', async () => {
    const answer = { current: snapshot({ freshness: freshness({ localRefreshedAt: iso(1000), teamSyncedAt: iso(12 * 60_000), unpublished: 3 }) }) };
    const { store, wrap } = setup(() => json(answer.current));
    wrap(<Header />);
    await open(store);
    expect(screen.queryByText(/Team synced/)).toBeNull();
    cleanup();

    answer.current = snapshot({ workspace: { ...OK, hasRemote: true }, freshness: freshness({ localRefreshedAt: iso(1000), teamSyncedAt: iso(12 * 60_000), unpublished: 3 }) });
    const second = setup(() => json(answer.current));
    second.wrap(<Header />);
    await open(second.store);
    expect(screen.getByText('Team synced 12m ago')).toBeTruthy();
    expect(screen.getByText('3 unpublished')).toBeTruthy();
  });
});

describe('Header tools', () => {
  it('switches views and remembers the choice for the project', async () => {
    const { store, wrap, stored } = setup(() => json(snapshot({ freshness: freshness({ localRefreshedAt: iso(0) }) })));
    wrap(<Header />);
    await open(store);
    expect(screen.getByRole('button', { name: 'Epic' }).getAttribute('aria-pressed')).toBe('true');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
      await flush();
    });
    expect(screen.getByRole('button', { name: 'Activity' }).getAttribute('aria-pressed')).toBe('true');
    expect(stored.get(uiKey('/p/a'))).toMatchObject({ view: 'activity' });
  });

  it('shows the unseen count and opens Activity from it', async () => {
    const { store, wrap } = setup(() => json(snapshot({ unseenIds: ['a', 'b', 'c', 'd'], freshness: freshness({ localRefreshedAt: iso(0) }) })));
    wrap(<Header />);
    await open(store);
    // The count is of beads (deleted ones included), and the name says so.
    const unseen = screen.getByRole('button', { name: '4 beads changed since you last looked' });
    await act(async () => {
      fireEvent.click(unseen);
      await flush();
    });
    expect(store.get().view).toBe('activity');
  });

  it('names a single changed bead in the singular', async () => {
    const { store, wrap } = setup(() => json(snapshot({ unseenIds: ['a'], freshness: freshness({ localRefreshedAt: iso(0) }) })));
    wrap(<Header />);
    await open(store);
    expect(screen.getByRole('button', { name: '1 bead changed since you last looked' })).toBeTruthy();
  });

  it('falls back to "Search beads" when the count cannot be measured to fit', async () => {
    const { store, wrap } = setup(() => json(snapshot({ freshness: freshness({ localRefreshedAt: iso(0) }) })));
    wrap(<Header />);
    await open(store);
    expect(screen.getByRole('searchbox').getAttribute('placeholder')).toBe('Search beads');
  });

  it('says just "Search" while the unseen chip takes the room, so the hint is never cut mid-word', async () => {
    const { store, wrap } = setup(() => json(snapshot({ unseenIds: ['a'], freshness: freshness({ localRefreshedAt: iso(0) }) })));
    wrap(<Header />);
    await open(store);
    expect(screen.getByRole('searchbox').getAttribute('placeholder')).toBe('Search');
    await act(async () => {
      store.setView('activity');
      await flush();
    });
    expect(screen.getByRole('searchbox').getAttribute('placeholder')).toBe('Search');
  });

  it('marks the longer hints, so a narrow box hides them instead of cutting them mid-word', async () => {
    const { store, wrap } = setup(() => json(snapshot({ freshness: freshness({ localRefreshedAt: iso(0) }) })));
    const { container } = wrap(<Header />);
    await open(store);
    expect(container.querySelector('.bd-search')?.getAttribute('data-hint')).toBe('long');
    cleanup();
    const second = setup(() => json(snapshot({ unseenIds: ['a'], freshness: freshness({ localRefreshedAt: iso(0) }) })));
    const rendered = second.wrap(<Header />);
    await open(second.store);
    expect(rendered.container.querySelector('.bd-search')?.hasAttribute('data-hint')).toBe(false);
  });

  it('says "Search activity" in Activity when there is room', async () => {
    const { store, wrap } = setup(() => json(snapshot({ freshness: freshness({ localRefreshedAt: iso(0) }) })));
    wrap(<Header />);
    await open(store);
    await act(async () => {
      store.setView('activity');
      await flush();
    });
    expect(screen.getByRole('searchbox').getAttribute('placeholder')).toBe('Search activity');
  });

  it('keeps the header layout while the first answer loads', async () => {
    const { store, wrap } = setup(() => new Promise<Answer>(() => {}));
    const { container } = wrap(<Header />);
    await open(store);
    expect(container.querySelector('.bd-tools')).toBeTruthy();
    expect(container.querySelector('.bd-fresh')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Epic' }).hasAttribute('disabled')).toBe(true);
  });

  it('renders the same tools and freshness line while loading as once loaded, so the header neither clips nor jumps', async () => {
    let answer: (a: Answer) => void = () => {};
    const { store, wrap } = setup(() => new Promise<Answer>((resolve) => (answer = resolve)));
    const { container } = wrap(<Header />);
    await open(store);
    const shape = () => ({
      tools: Array.from(container.querySelector('.bd-tools')?.children ?? []).map((el) => `${el.tagName}.${el.className}`),
      views: Array.from(container.querySelectorAll('.bd-seg button')).map((el) => el.textContent),
      fresh: Array.from(container.querySelector('.bd-fresh .bd-local')?.children ?? []).map((el) => `${el.tagName}:${el.textContent}`),
    });
    const loading = shape();
    expect(container.querySelector('.bd-tools')?.hasAttribute('data-loading')).toBe(true);
    expect(screen.getByRole('button', { name: 'New bead' }).hasAttribute('disabled')).toBe(true);
    await act(async () => {
      answer(json(snapshot({ freshness: freshness({ localRefreshedAt: iso(0) }) })));
      await flush();
    });
    expect(container.querySelector('.bd-tools')?.hasAttribute('data-loading')).toBe(false);
    expect(loading).toEqual(shape());
  });

  it('hides the unseen count when there is nothing new', async () => {
    const { store, wrap } = setup(() => json(snapshot({ freshness: freshness({ localRefreshedAt: iso(0) }) })));
    wrap(<Header />);
    await open(store);
    expect(screen.queryByRole('button', { name: /unseen/ })).toBeNull();
  });
});

describe('Empty states', () => {
  const cases: Array<[WorkspaceState, RegExp]> = [
    [{ kind: 'no-bd' }, /^Beads isn't installed on this computer\.$/],
    [{ kind: 'no-workspace' }, /^This project doesn't use Beads\.$/],
    [{ kind: 'pre-dolt', root: '/p/a' }, /older Beads format/],
    [{ kind: 'bd-too-old', bdVersion: '1.1.0' }, /too old/],
    [{ kind: 'server-down', root: '/p/a', port: 3307 }, /server isn't running/],
    [{ kind: 'needs-first-contact', root: '/p/a', lastOpenedWith: '1.2.2', bdVersion: '1.3.0' }, /^Open this project with Beads 1\.3\.0\?$/],
  ];

  it.each(cases)('renders plain copy for %o', async (workspace, title) => {
    const { wrap } = setup(() => json(snapshot()));
    wrap(<WorkspaceEmpty workspace={workspace} />);
    expect(screen.getByRole('heading').textContent).toMatch(title);
  });

  it('says a project last opened with a newer Beads needs Beads updated here', async () => {
    const { wrap } = setup(() => json(snapshot()));
    const { container } = wrap(<WorkspaceEmpty workspace={{ kind: 'bd-too-old', bdVersion: '1.2.2', lastOpenedWith: '1.3.0' } as WorkspaceState} />);
    expect(container.textContent).toContain('This project was last opened with Beads 1.3.0. This panel uses 1.2.2, which is older. Update Beads to open it here.');
    expect(container.textContent).not.toContain('or newer');
  });

  it('names an unknown state generically and still offers Retry', async () => {
    const { wrap } = setup(() => json(snapshot()));
    wrap(<WorkspaceEmpty workspace={{ kind: 'from-the-future' } as unknown as WorkspaceState} />);
    expect(screen.getByRole('heading').textContent).toBe("Beads can't open this project right now.");
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('keeps the server port out of the visible text and in Copy details', async () => {
    const { wrap, toast } = setup(() => json(snapshot()));
    const { container } = wrap(<WorkspaceEmpty workspace={{ kind: 'server-down', root: '/p/a', port: 3307 }} />);
    expect(container.textContent).not.toContain('3307');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
      await flush();
    });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ copy: { text: expect.stringContaining('3307') } }));
  });

  it('never uses CLI words or em dashes', () => {
    for (const [workspace] of cases) {
      const { title, body } = workspaceCopy(workspace);
      expect(`${title} ${body}`).not.toMatch(/\bbd\b|dolt|\bpull\b|\bpush\b|remote|—/i);
    }
  });

  it('first contact names both versions and confirms with refreshWorkspace', async () => {
    const workspace: WorkspaceState = { kind: 'needs-first-contact', root: '/p/a', lastOpenedWith: '1.2.2', bdVersion: '1.3.0' };
    const { store, wrap, calls } = setup(({ route }) => (route === 'workspace' ? json(OK) : json(snapshot({ workspace }))));
    await open(store);
    wrap(<WorkspaceEmpty workspace={workspace} />);
    expect(screen.getByText(/last opened with Beads 1\.2\.2/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open project' }));
      await flush();
    });
    expect(calls.map((c) => c.route)).toEqual(['snapshot', 'workspace', 'snapshot']);
    expect(calls[2].body).toMatchObject({ refreshWorkspace: true });
  });

  it('Retry on a not-ready project re-detects it', async () => {
    const { store, wrap, calls } = setup(() => json(snapshot({ workspace: { kind: 'no-bd' } })));
    await open(store);
    wrap(<WorkspaceEmpty workspace={{ kind: 'no-bd' }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await flush();
    });
    expect(calls.at(-1)?.body).toMatchObject({ refreshWorkspace: true });
  });

  it('a failed first load shows one headline with Retry and Copy details', async () => {
    const { store, wrap, toast } = setup(() => envelope(500, { code: 'beads-error', message: "Couldn't read Beads.", detail: 'stderr: boom' }));
    wrap(<App />);
    await open(store);
    expect(screen.getByRole('heading').textContent).toBe("Couldn't load this project's beads.");
    expect(screen.queryByText("Couldn't read Beads.")).toBeNull();
    expect(screen.queryByText(/boom/)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
      await flush();
    });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ copy: { text: 'stderr: boom' } }));
  });

  it('a project that never refreshed with a local error shows the load error, not "no beads"', async () => {
    const { store, wrap } = setup(() =>
      json(snapshot({ freshness: freshness({ localRefreshedAt: null, localError: "Couldn't read Beads.", localErrorDetail: 'exit 1' }) })),
    );
    wrap(<App />);
    await open(store);
    expect(screen.getByRole('heading').textContent).toBe("Couldn't load this project's beads.");
    expect(screen.queryByText(/No beads/)).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
  });

  it('an empty project says beads will show up when the agent creates them', async () => {
    const { store, wrap } = setup(() => json(snapshot({ freshness: freshness({ localRefreshedAt: iso(0) }) })));
    wrap(<App />);
    await open(store);
    expect(screen.getByText('When your agent creates beads, they show up here within a few seconds.')).toBeTruthy();
  });
});
