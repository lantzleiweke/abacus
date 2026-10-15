// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';
import { createClient } from '../../../src/panel/client';
import { createStore, projectKey, StoreContext, uiKey, type Store } from '../../../src/panel/store';
import { Header } from '../../../src/panel/ui/Header';
import { App } from '../../../src/panel/ui/App';
import { WorkspaceEmpty, workspaceCopy } from '../../../src/panel/ui/EmptyState';
import type { WorkspaceState } from '../../../src/shared/types';
import { deferred, envelope, fakeHost, flush, freshness, json, OK, snapshot, type Answer, type Call } from './helpers';

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
    // It does not promise that opening changes the project: an older format is asked about separately, in plain words.
    const said = document.querySelector('.bd-empty-body')!.textContent!;
    expect(said).toBe('This project was last opened with Beads 1.2.2. Opening it lets Beads check the project. If it is on an older format, Abacus will ask before updating it.');
    expect(said).not.toMatch(/lets Beads update it|change its files|—/);
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

describe('Needs me tab and project menu', () => {
  const fresh = freshness({ localRefreshedAt: iso(0) });
  const task = (id: string, over: Record<string, unknown> = {}) => ({
    id, title: `Title ${id}`, status: 'open', priority: 2, type: 'task', assignee: null, labels: [], parentId: null, description: '', design: '', acceptance: '', notes: '',
    createdAt: iso(864e6), createdBy: null, updatedAt: iso(86_400_000), closedAt: null, closeReason: null, dependencies: [], comments: [], extra: {}, ...over,
  });
  const review = { id: 'p-g', kind: 'human', reason: 'Look', blocks: ['p-1'], createdBy: null, createdAt: iso(0), timeoutMs: null, planApproval: false };
  const statuses = [{ name: 'open', category: 'active', icon: null }, { name: 'in_progress', category: 'wip', icon: null }, { name: 'closed', category: 'done', icon: null }];

  it('Needs me count is on the tab, the rail badge is unchanged', async () => {
    const { store, wrap, host } = setup(() =>
      json(snapshot({ beads: [task('p-1'), task('p-2', { labels: ['human'] })] as never, statuses, gates: [review] as never, unseenIds: ['p-2'], freshness: fresh })),
    );
    const setBadge = vi.fn(async () => {});
    (host as unknown as { setBadge: unknown }).setBadge = setBadge;
    wrap(<Header />);
    await open(store);
    // Waiting (p-1), Asked (p-2) and Changed (p-2): three rows.
    const tab = screen.getByRole('button', { name: 'Needs me 3' });
    expect(tab.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('group', { name: 'View' })[0]!.firstElementChild).toBe(tab);
    // The unseen chip (the rail badge's number) still counts unseen beads only.
    expect(screen.getByRole('button', { name: '1 bead changed since you last looked' })).toBeTruthy();
    expect(setBadge).toHaveBeenLastCalledWith(1);
  });

  it('hides the count when nothing needs the person', async () => {
    const { store, wrap } = setup(() => json(snapshot({ beads: [task('p-1')] as never, statuses, freshness: fresh })));
    wrap(<Header />);
    await open(store);
    expect(screen.getByRole('button', { name: 'Needs me' }).querySelector('.bd-seg-n')).toBeNull();
  });

  it('the project menu sets the Stuck days for this project, on this computer only', async () => {
    const { store, wrap, stored, calls } = setup(() => json(snapshot({ beads: [task('p-1')] as never, statuses, freshness: fresh })));
    wrap(<Header />);
    await open(store);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'demo' }));
      await flush();
    });
    const menu = screen.getByRole('dialog', { name: 'Project menu' });
    const days = screen.getByRole('spinbutton', { name: 'Stuck after' }) as HTMLInputElement;
    expect([days.getAttribute('aria-valuemin'), days.getAttribute('aria-valuemax'), days.getAttribute('aria-valuenow')]).toEqual(['1', '30', '3']);
    expect(days.value).toBe('3');
    // The menu opens on its first entry, the memories page. This Beads is too old for live updates: it says so, with nothing to press.
    expect(document.activeElement).toBe(within(menu).getByRole('button', { name: 'Memories' }));
    expect(menu.textContent).toMatch(/Live updatesNeeds a newer version of Beads \(1\.3 or later\)\./);
    expect(within(menu).queryByRole('button', { name: /live updates/i })).toBeNull();
    expect(menu.querySelector('.bd-pm-live')?.hasAttribute('aria-busy')).toBe(false);
    await act(async () => {
      fireEvent.input(days, { target: { value: '5' } });
      await flush();
    });
    expect(store.get().settings.staleDays).toBe(5);
    expect(stored.get(projectKey('/p/a'))).toMatchObject({ staleDays: 5 });
    await act(async () => {
      fireEvent.input(days, { target: { value: '0' } });
      await flush();
    });
    expect(screen.getByRole('alert').textContent).toBe('Enter a whole number of days from 1 to 30.');
    expect(store.get().settings.staleDays).toBe(5);
    await act(async () => {
      fireEvent.input(days, { target: { value: '31' } });
      await flush();
    });
    expect(screen.getByRole('alert').textContent).toBe('Enter a whole number of days from 1 to 30.');
    expect(store.get().settings.staleDays).toBe(5);
    await act(async () => {
      fireEvent.input(days, { target: { value: '5' } });
      await flush();
    });
    await act(async () => {
      fireEvent.keyDown(days, { key: 'ArrowUp' });
      await flush();
    });
    expect(store.get().settings.staleDays).toBe(6);
    // Nothing went to Beads.
    expect(calls.map((c) => c.route).filter((r) => r !== 'snapshot')).toEqual([]);
    await act(async () => {
      fireEvent.keyDown(days, { key: 'Escape' });
      await flush();
    });
    expect(screen.queryByRole('dialog', { name: 'Project menu' })).toBeNull();
  });

  it('offers no project menu before a project answers', async () => {
    const { store, wrap } = setup(() => new Promise(() => {}));
    wrap(<Header />);
    await open(store);
    expect(screen.getByText('a')).toBeTruthy();
    expect(document.querySelector('[aria-haspopup]')).toBeNull();
  });
});

describe('Project menu: live updates', () => {
  type Status = { available: boolean; journal: 'on' | 'off' | 'unknown'; live: string };
  const status = (over: Partial<Status> = {}): Status => ({ available: true, journal: 'off', live: 'off', ...over });
  // Effects run as an act ends, and the reads they start answer after it: give those their own act.
  const settle = async () => {
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        for (let j = 0; j < 4; j++) await flush();
      });
    }
  };
  const full = () => json(snapshot({ capabilities: { eventsJournal: true, leases: true }, freshness: freshness({ localRefreshedAt: iso(0) }) }));

  /** Opens the menu on a 1.3 project whose routes answer as `routes` says; anything else is the snapshot. */
  async function menu(routes: Partial<Record<'eventsStatus' | 'enableEvents', (call: Call) => Answer | Promise<Answer>>>) {
    const env = setup((call) => (call.route === 'eventsStatus' || call.route === 'enableEvents' ? (routes[call.route]?.(call) ?? full()) : full()));
    env.wrap(<Header />);
    await open(env.store);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'demo' }));
    });
    await settle();
    return { ...env, menu: screen.getByRole('dialog', { name: 'Project menu' }) };
  }
  const click = async (el: HTMLElement) => {
    await act(async () => {
      fireEvent.click(el);
    });
    await settle();
  };
  const routes = (calls: Call[]) => calls.map((c) => c.route).filter((r) => r !== 'snapshot');

  it('says when the installed Beads is too old, with nothing to press', async () => {
    const { menu: m, calls } = await menu({ eventsStatus: () => json(status({ available: false })) });
    expect(m.textContent).toContain('Live updatesNeeds a newer version of Beads (1.3 or later). Until then, the panel checks for changes every few seconds.');
    expect(within(m).queryByRole('button', { name: /turn on/i })).toBeNull();
    expect(routes(calls)).toEqual(['eventsStatus']);
  });

  it('turn on live updates needs the confirm and names the file', async () => {
    let journal: Status['journal'] = 'off';
    const { menu: m, calls } = await menu({
      eventsStatus: () => json(status({ journal })),
      enableEvents: () => {
        journal = 'on';
        return json({ ok: true, status: status({ journal: 'on', live: 'following' }) });
      },
    });
    expect(m.textContent).toContain('Off');
    expect(m.textContent).toContain('Off for this project, so the panel checks for changes every few seconds.');
    const turnOn = within(m).getByRole('button', { name: 'Turn on live updates' });
    await click(turnOn);
    // Pressing it only asks: nothing is sent until the confirm.
    expect(routes(calls)).toEqual(['eventsStatus']);
    const ask = within(m).getByRole('alertdialog', { name: 'Turn on live updates?' });
    expect(ask.textContent).toContain('Beads will keep a log of changes on this computer for 7 days.');
    expect(ask.textContent).toContain("This changes the project's settings file, .beads/config.yaml, which is shared with your team if you commit it.");
    expect(ask.textContent).not.toMatch(/Teammates are not affected/);
    expect(ask.getAttribute('aria-describedby')).toBe('bd-pm-ask-d');
    // Focus lands on the safe answer.
    expect(document.activeElement).toBe(within(ask).getByRole('button', { name: 'Cancel' }));
    await click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(within(m).queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(within(m).getByRole('button', { name: 'Turn on live updates' }));
    // Escape answers the question and leaves the menu open.
    await click(within(m).getByRole('button', { name: 'Turn on live updates' }));
    await act(async () => {
      fireEvent.keyDown(within(m).getByRole('alertdialog'), { key: 'Escape' });
    });
    await settle();
    expect(within(m).queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Project menu' })).toBe(m);
    expect(routes(calls)).toEqual(['eventsStatus']);
    await click(within(m).getByRole('button', { name: 'Turn on live updates' }));
    await click(within(m).getByRole('button', { name: 'Turn on' }));
    expect(calls.filter((c) => c.route === 'enableEvents').map((c) => c.body)).toEqual([{ directory: '/p/a', confirm: true }]);
    expect(m.textContent).toContain('On');
    expect(within(m).getByRole('status').textContent).toBe('Following changes as they happen.');
    expect(within(m).queryByRole('button', { name: /turn on/i })).toBeNull();
  });

  it.each([
    ['following', 'Following changes as they happen.'],
    ['starting', 'Starting. Until then, the panel checks for changes every few seconds.'],
    ['off', 'Starting. Until then, the panel checks for changes every few seconds.'],
    ['backoff', 'Reconnecting. Until then, the panel checks for changes every few seconds.'],
    ['failed', 'Not working right now, so the panel checks for changes every few seconds.'],
  ])('when on and %s, says what it is doing in plain words', async (live, text) => {
    const { menu: m } = await menu({ eventsStatus: () => json(status({ journal: 'on', live })) });
    expect(m.querySelector('.bd-pm-state')?.textContent).toBe('On');
    expect(within(m).getByRole('status').textContent).toBe(text);
    expect(within(m).queryByRole('button', { name: /turn on/i })).toBeNull();
  });

  it('when the setting cannot be read, offers Try again', async () => {
    let answer: Answer = json(status({ journal: 'unknown' }));
    const { menu: m, calls } = await menu({ eventsStatus: () => answer });
    expect(m.textContent).toContain("Couldn't read this setting for the project.");
    answer = envelope(500, { code: 'beads-error', message: 'no' });
    await click(within(m).getByRole('button', { name: 'Try again' }));
    expect(m.textContent).toContain("Couldn't read this setting for the project.");
    answer = json(status({ journal: 'off' }));
    await click(within(m).getByRole('button', { name: 'Try again' }));
    expect(within(m).getByRole('button', { name: 'Turn on live updates' })).toBeTruthy();
    expect(routes(calls)).toEqual(['eventsStatus', 'eventsStatus', 'eventsStatus']);
  });

  it('a sync running says to wait, for the read and for turning it on', async () => {
    const busy = () => envelope(409, { code: 'sync-running', message: 'Sync in progress. Try again when it finishes.' });
    let read: () => Answer = busy;
    const { menu: m } = await menu({ eventsStatus: () => read(), enableEvents: busy });
    expect(m.textContent).toContain('Wait for the sync to finish, then try again.');
    read = () => json(status());
    await click(within(m).getByRole('button', { name: 'Try again' }));
    await click(within(m).getByRole('button', { name: 'Turn on live updates' }));
    await click(within(m).getByRole('button', { name: 'Turn on' }));
    expect(within(m).getByRole('alert').textContent).toBe('Wait for the sync to finish, then try again.');
    // Still off, with the button back and focused.
    expect(document.activeElement).toBe(within(m).getByRole('button', { name: 'Turn on live updates' }));
  });

  it("an uncertain answer shows the service's words and the status read again, not the generic saved text", async () => {
    const MESSAGE = "Live updates may be on now, but Beads didn't confirm it.";
    let reads = 0;
    const { menu: m, toast } = await menu({
      eventsStatus: () => json(++reads === 1 ? status() : status({ journal: 'on', live: 'starting' })),
      enableEvents: () => envelope(504, { code: 'uncertain', message: MESSAGE, saved: true }),
    });
    await click(within(m).getByRole('button', { name: 'Turn on live updates' }));
    await click(within(m).getByRole('button', { name: 'Turn on' }));
    expect(m.querySelector('.bd-pm-note')?.textContent).toBe(MESSAGE);
    expect(m.querySelector('.bd-pm-state')?.textContent).toBe('On');
    expect(m.textContent).toContain('Starting. Until then, the panel checks for changes every few seconds.');
    expect(document.body.textContent).not.toMatch(/Refreshing to show it/);
    expect(toast).not.toHaveBeenCalled();
  });

  it('an uncertain answer whose status cannot be read either keeps the words and offers Try again', async () => {
    const MESSAGE = "Live updates may be on now, but Beads didn't confirm it.";
    let reads = 0;
    const { menu: m } = await menu({
      eventsStatus: () => (++reads === 1 ? json(status()) : envelope(500, { code: 'beads-error', message: 'no' })),
      enableEvents: () => envelope(504, { code: 'uncertain', message: MESSAGE }),
    });
    await click(within(m).getByRole('button', { name: 'Turn on live updates' }));
    await click(within(m).getByRole('button', { name: 'Turn on' }));
    expect(m.querySelector('.bd-pm-note')?.textContent).toBe(MESSAGE);
    expect(m.textContent).toContain("Couldn't read this setting for the project.");
    expect(within(m).getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('an unconfirmed answer whose read-again lands after the project changed is dropped, not kept for later', async () => {
    const UNSURE = "Live updates may be on now, but Beads didn't confirm it.";
    const slow = deferred<Answer>();
    let reads = 0;
    const { menu: m, store } = await menu({
      eventsStatus: () => (++reads === 2 ? slow.promise : json(status())),
      enableEvents: () => envelope(504, { code: 'uncertain', message: UNSURE }),
    });
    await click(within(m).getByRole('button', { name: 'Turn on live updates' }));
    await click(within(m).getByRole('button', { name: 'Turn on' }));
    expect(reads).toBe(2);
    await open(store, '/p/b');
    slow.resolve(json(status({ journal: 'on', live: 'following' })));
    await settle();
    await open(store, '/p/a');
    await settle();
    if (!screen.queryByRole('dialog', { name: 'Project menu' })) await click(screen.getByRole('button', { name: 'demo' }));
    // The answer was about a project no longer shown: nothing of it comes back with the project.
    expect(screen.getByRole('dialog', { name: 'Project menu' }).textContent).toContain('Off for this project');
    expect(document.body.textContent).not.toContain(UNSURE);
  });

  it('Try again keeps focus in the menu, says the answer, and Escape still closes the menu', async () => {
    let answer: Answer = json(status({ journal: 'unknown' }));
    const { menu: m } = await menu({ eventsStatus: () => answer });
    const line = m.querySelector('.bd-pm-say')!;
    answer = json(status({ journal: 'on', live: 'following' }));
    await click(within(m).getByRole('button', { name: 'Try again' }));
    // The same live line, now focused, carries the answer.
    expect(m.querySelector('.bd-pm-say')).toBe(line);
    expect(document.activeElement).toBe(line);
    expect(line.getAttribute('role')).toBe('status');
    expect(line.textContent).toBe('Following changes as they happen.');
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog', { name: 'Project menu' })).toBeNull();
  });

  it('Try again that still cannot read keeps focus on the line and offers Try again again', async () => {
    const { menu: m } = await menu({ eventsStatus: () => envelope(500, { code: 'beads-error', message: 'no' }) });
    await click(within(m).getByRole('button', { name: 'Try again' }));
    expect(document.activeElement).toBe(m.querySelector('.bd-pm-say'));
    expect(within(m).getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('an unsupported answer shows the too-old line', async () => {
    const { menu: m } = await menu({ eventsStatus: () => envelope(501, { code: 'unsupported', message: 'Live updates need a newer version of Beads.' }) });
    expect(m.textContent).toContain('Needs a newer version of Beads (1.3 or later).');
    expect(within(m).queryByRole('button')?.textContent).not.toMatch(/Try again|Turn on/);
    expect(m.querySelector('.bd-pm-live')?.hasAttribute('aria-busy')).toBe(false);
  });

  it('Escape on the confirm answers it and gives focus back to Turn on live updates', async () => {
    const { menu: m } = await menu({ eventsStatus: () => json(status()) });
    await click(within(m).getByRole('button', { name: 'Turn on live updates' }));
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    });
    await settle();
    expect(within(m).queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(within(m).getByRole('button', { name: 'Turn on live updates' }));
  });

  it('Escape while it turns on does nothing, so the answer is seen', async () => {
    const slow = deferred<Answer>();
    const { menu: m } = await menu({ eventsStatus: () => json(status()), enableEvents: () => slow.promise });
    await click(within(m).getByRole('button', { name: 'Turn on live updates' }));
    await click(within(m).getByRole('button', { name: 'Turn on' }));
    // A click leaves focus on the button it pressed.
    const busy = within(m).getByRole('button', { name: 'Turning on…' });
    busy.focus();
    await act(async () => {
      fireEvent.keyDown(busy, { key: 'Escape' });
    });
    expect(screen.getByRole('dialog', { name: 'Project menu' })).toBe(m);
    slow.resolve(envelope(409, { code: 'sync-running', message: 'Sync in progress. Try again when it finishes.' }));
    await settle();
    expect(within(m).getByRole('alert').textContent).toBe('Wait for the sync to finish, then try again.');
  });

  it('an answer that arrives after the menu closed is shown when it opens again', async () => {
    const slow = deferred<Answer>();
    const { menu: m } = await menu({ eventsStatus: () => json(status()), enableEvents: () => slow.promise });
    await click(within(m).getByRole('button', { name: 'Turn on live updates' }));
    await click(within(m).getByRole('button', { name: 'Turn on' }));
    // A click outside closes the menu while the change runs.
    await act(async () => {
      fireEvent.pointerDown(document.body);
    });
    expect(screen.queryByRole('dialog', { name: 'Project menu' })).toBeNull();
    slow.resolve(envelope(409, { code: 'sync-running', message: 'Sync in progress. Try again when it finishes.' }));
    await settle();
    await click(screen.getByRole('button', { name: 'demo' }));
    const again = screen.getByRole('dialog', { name: 'Project menu' });
    expect(within(again).getByRole('alert').textContent).toBe('Wait for the sync to finish, then try again.');
    // Shown once.
    await click(screen.getByRole('button', { name: 'demo' }));
    await click(screen.getByRole('button', { name: 'demo' }));
    expect(screen.getByRole('dialog', { name: 'Project menu' }).querySelector('.bd-pm-note')).toBeNull();
  });

  it('the unconfirmed note clears once a later read finds it on', async () => {
    const UNSURE = "Live updates may be on now, but Beads didn't confirm it.";
    let reads = 0;
    const { menu: m } = await menu({
      eventsStatus: () => (++reads === 1 ? json(status()) : reads === 2 ? envelope(500, { code: 'beads-error', message: 'no' }) : json(status({ journal: 'on', live: 'following' }))),
      enableEvents: () => envelope(504, { code: 'uncertain', message: UNSURE }),
    });
    await click(within(m).getByRole('button', { name: 'Turn on live updates' }));
    await click(within(m).getByRole('button', { name: 'Turn on' }));
    const note = m.querySelector<HTMLElement>('.bd-pm-note')!;
    expect(note.textContent).toBe(UNSURE);
    // Focus goes to the service's words, so they are read out.
    expect(document.activeElement).toBe(note);
    await click(within(m).getByRole('button', { name: 'Try again' }));
    expect(m.querySelector('.bd-pm-note')).toBeNull();
    expect(m.querySelector('.bd-pm-say')?.textContent).toBe('Following changes as they happen.');
  });
});
