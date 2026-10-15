// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/preact';
import { HostRequestError, type AttachIssueRequest, type SessionSnapshot, type StartSessionResult, type ToastRequest } from '@openchamber/sdk';
import { mountPanel, type PanelHost } from '../../../src/panel/ui/App';
import { mountAttachDialog } from '../../../src/panel/ui/Picker';
import type { BeadResponse, ContextResponse, SyncPreviewResponse } from '../../../src/shared/api';
import type { Bead, StatusDef, SyncState, UnpublishedChange } from '../../../src/shared/types';
import { relatedFor } from '../../../src/shared/related';
import { deferred, flush, freshness, json, OK, snapshot, type Answer, type Call } from './helpers';

const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const DIR = '/p/a';
const ACTOR = 'Alice Tester (panel)';

function bead(id: string, title: string): Bead {
  return {
    id,
    title,
    status: 'open',
    priority: 2,
    type: 'task',
    assignee: null,
    labels: [],
    parentId: null,
    description: '',
    design: '',
    acceptance: '',
    notes: '',
    createdAt: iso(86_400_000),
    createdBy: null,
    updatedAt: iso(60_000),
    closedAt: null,
    closeReason: null,
    dependencies: [],
    comments: [],
    extra: {},
  };
}

const STATUSES: StatusDef[] = [
  { name: 'open', category: 'active', icon: null },
  { name: 'closed', category: 'done', icon: null },
];
const BEADS = [bead('p-a1', 'Fix login timeout'), bead('p-b2', 'Cut over DNS')];

const CHANGES: UnpublishedChange[] = [
  { commit: 'c1', message: 'bd: update p-a1', beadIds: ['p-a1'], summary: 'Changed status', actor: ACTOR, at: iso(5 * 60_000) },
  { commit: 'c2', message: 'bd: create p-zz9', beadIds: ['p-zz9'], summary: 'Created a bead', actor: 'Claude Code', at: iso(2 * 60_000) },
  { commit: 'c3', message: 'bd: comment', beadIds: [], summary: 'Added a comment', actor: null, at: null },
];

const CONFLICT: SyncState = {
  kind: 'conflict',
  mode: 'embedded',
  halfMerged: false,
  beads: [{ beadId: 'p-b2', title: 'Cut over DNS', ours: { status: 'blocked', notes: 'x'.repeat(200) }, theirs: { status: 'in_progress', notes: 'short' } }],
  log: 'bd dolt pull\nmerge aborted and working set restored',
};

const CONTEXT: ContextResponse = { id: 'sync-a', title: 'Beads sync needs attention', text: 'Beads sync conflict (JSON)\n{"project":"/p/a"}', url: 'https://beads.invalid/a/sync' };

type World = { sync: SyncState; unpublished: number; hasRemote: boolean };

/** A service whose snapshot reports `world`; routes not overridden answer as a quiet project would. */
function service(world: World, over: (call: Call) => Answer | Promise<Answer> | undefined = () => undefined) {
  return (call: Call): Answer | Promise<Answer> => {
    const answer = over(call);
    if (answer) return answer;
    if (call.route === 'snapshot') {
      return json(
        snapshot({
          cursor: `c-${JSON.stringify(world)}`,
          workspace: { ...OK, hasRemote: world.hasRemote },
          beads: BEADS,
          statuses: STATUSES,
          freshness: freshness({ localRefreshedAt: iso(0), teamSyncedAt: world.hasRemote ? iso(12 * 60_000) : null, unpublished: world.hasRemote ? world.unpublished : null }),
          sync: world.sync,
          writesBlocked: world.sync.kind === 'conflict' && world.sync.halfMerged,
          panelActor: ACTOR,
        }),
      );
    }
    if (call.route === 'seen') return json({ unseenIds: [] });
    if (call.route === 'bead') {
      const b = BEADS.find((x) => x.id === call.body.id)!;
      return json({ bead: b, related: relatedFor(b, BEADS) } satisfies BeadResponse);
    }
    if (call.route === 'sync-preview') return json({ changes: CHANGES, head: 'aaaa1111' } satisfies SyncPreviewResponse);
    if (call.route === 'sync-pull') return json({ sync: (world.sync = { kind: 'running', op: 'pull', startedAt: iso(0) }) });
    if (call.route === 'sync-publish') return json({ sync: (world.sync = { kind: 'running', op: 'publish', startedAt: iso(0) }) });
    if (call.route === 'conflict-context') return json(CONTEXT);
    return json({});
  };
}

const SESSION: SessionSnapshot = { id: 'ses_1', title: 'Fixing the login', busy: false };

function host(answer: (call: Call) => Answer | Promise<Answer>, session: SessionSnapshot | null = SESSION) {
  const calls: Call[] = [];
  const toasts: ToastRequest[] = [];
  const stored = new Map<string, unknown>();
  const directoryListeners = new Set<(d: string | null) => void>();
  const h = {
    serviceRequest: vi.fn(async ({ path, body }: { path: string; body?: string }) => {
      const call: Call = { route: path.replace('/api/', '') as Call['route'], body: JSON.parse(body ?? '{}') };
      calls.push(call);
      return answer(call);
    }),
    storage: {
      get: async (key: string) => stored.get(key) as never,
      set: async (key: string, value: unknown) => void stored.set(key, value),
      delete: async (key: string) => void stored.delete(key),
      keys: async () => [...stored.keys()],
    },
    toast: vi.fn(async (t: ToastRequest) => void toasts.push(t)),
    setBadge: vi.fn(async () => {}),
    writeClipboard: vi.fn(async () => {}),
    openUrl: vi.fn(async () => {}),
    attach: vi.fn(async (_req: AttachIssueRequest) => {}),
    startSession: vi.fn(async (_req: unknown): Promise<StartSessionResult> => ({ sessionId: 'ses_new', sent: 'skipped', linked: true })),
    onDirectory(listener: (d: string | null) => void) {
      directoryListeners.add(listener);
      listener(DIR);
      return () => void directoryListeners.delete(listener);
    },
    onSession(listener: (s: SessionSnapshot | null) => void) {
      listener(session);
      return () => {};
    },
  };
  /** OpenChamber switching to another project. */
  const switchTo = (directory: string) =>
    act(async () => {
      directoryListeners.forEach((l) => l(directory));
      await flush();
    });
  return { host: h, calls, toasts, switchTo };
}

const alwaysVisible = { isVisible: () => true, onChange: () => () => {} };
const disposers: Array<() => void> = [];

afterEach(() => {
  disposers.splice(0).forEach((d) => d());
  cleanup();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

async function panel(answer: (call: Call) => Answer | Promise<Answer>, session: SessionSnapshot | null = SESSION) {
  const fake = host(answer, session);
  const root = document.createElement('div');
  document.body.append(root);
  let mounted!: ReturnType<typeof mountPanel>;
  await act(async () => {
    mounted = mountPanel(fake.host as unknown as PanelHost, root, { visibility: alwaysVisible });
    disposers.push(mounted.dispose);
    await flush();
  });
  /** Polls now, as the 2 s timer would. */
  const poll = () =>
    act(async () => {
      mounted.store.retry();
      await flush();
    });
  return { ...fake, poll };
}

const click = (el: Element) =>
  act(async () => {
    fireEvent.click(el);
    await flush();
  });

/** Presses Confirm in the open Publish sheet once its guard against a stray activation (500 ms) has passed. */
async function confirm(name = 'Publish 3 changes') {
  const later = Date.now() + 600;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
  try {
    await click(within(screen.getByRole('dialog')).getByRole('button', { name }));
  } finally {
    clock.mockRestore();
  }
}

const routes = (calls: Call[], route: Call['route']) => calls.filter((c) => c.route === route);
const world = (over: Partial<World> = {}): World => ({ sync: { kind: 'idle' }, unpublished: 3, hasRemote: true, ...over });

// ------------------------------------------------------------------------------------------------- team line

describe('team line controls', () => {
  it('shows no sync controls when the project has no shared copy', async () => {
    await panel(service(world({ hasRemote: false })));
    expect(screen.queryByRole('button', { name: /^Sync/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Publish/ })).toBeNull();
    expect(screen.queryByText(/Team synced/)).toBeNull();
  });

  it('shows Sync, and Publish with the count while something is unpublished', async () => {
    await panel(service(world({ unpublished: 3 })));
    expect(screen.getByRole('button', { name: 'Sync' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish 3 changes' })).toBeTruthy();
    expect(screen.getByText('3 unpublished').getAttribute('title')).toBe('Your agent may also publish these when it syncs.');
  });

  it('ties the agent note to the Publish button for screen readers and in its tooltip', async () => {
    await panel(service(world()));
    const publish = screen.getByRole('button', { name: 'Publish 3 changes' });
    const note = document.getElementById(publish.getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toBe('Your agent may also publish these when it syncs.');
    expect(publish.getAttribute('title')).toContain('Your agent may also publish these when it syncs.');
  });

  it('keeps a live region on the team line in every state, so a job\'s start is announced', async () => {
    const w = world();
    const fake = await panel(service(w));
    const region = () => document.querySelector('.bd-teambar [role="status"]');
    const before = region();
    expect(before).not.toBeNull();
    expect(before!.textContent).toBe('');
    await click(screen.getByRole('button', { name: 'Sync' }));
    expect(region()).toBe(before);
    expect(before!.textContent).toBe('Syncing with the team\u2026');
    w.sync = { kind: 'idle' };
    await fake.poll();
    expect(region()).toBe(before);
    expect(before!.textContent).toBe('');
  });

  it('says the unpublished count is unavailable, and keeps Publish reachable, when the service could not count', async () => {
    const w = world();
    const fake = await panel(
      service(w, (c) =>
        c.route === 'snapshot'
          ? json(snapshot({ workspace: { ...OK, hasRemote: true }, beads: BEADS, statuses: STATUSES, freshness: freshness({ localRefreshedAt: iso(0), teamSyncedAt: iso(60_000), unpublished: null }), panelActor: ACTOR }))
          : undefined,
      ),
    );
    expect(screen.getByText('Unpublished count unavailable')).toBeTruthy();
    expect(screen.queryByText(/^0 unpublished$/)).toBeNull();
    await click(screen.getByRole('button', { name: 'Publish' }));
    // The preview reads its own list.
    expect(routes(fake.calls, 'sync-preview')).toHaveLength(1);
    expect(within(screen.getByRole('dialog')).getAllByRole('listitem')).toHaveLength(3);
  });

  it('shows no Publish when nothing is unpublished', async () => {
    await panel(service(world({ unpublished: 0 })));
    expect(screen.getByRole('button', { name: 'Sync' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Publish/ })).toBeNull();
  });

  it('Sync starts one pull, shows progress with both buttons off, and says Synced. when it ends', async () => {
    const w = world();
    const fake = await panel(service(w));
    await click(screen.getByRole('button', { name: 'Sync' }));
    expect(routes(fake.calls, 'sync-pull')).toHaveLength(1);
    const running = screen.getByRole('button', { name: 'Syncing…' });
    expect((running as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Publish 3 changes' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fake.toasts.some((t) => t.message === 'Synced.')).toBe(false);
    w.sync = { kind: 'idle' };
    await fake.poll();
    expect(fake.toasts.filter((t) => t.message === 'Synced.')).toHaveLength(1);
    expect((screen.getByRole('button', { name: 'Sync' }) as HTMLButtonElement).disabled).toBe(false);
    await fake.poll();
    expect(fake.toasts.filter((t) => t.message === 'Synced.')).toHaveLength(1);
    expect(routes(fake.calls, 'sync-publish')).toHaveLength(0);
  });

  it('says which beads and fields had an older edit replaced when the sync merged same-field edits, with Copy details', async () => {
    const w = world();
    const fake = await panel(service(w));
    await click(screen.getByRole('button', { name: 'Sync' }));
    w.sync = {
      kind: 'idle',
      superseded: [{ beadId: 'p-a1', fields: ['title', 'acceptance criteria'] }, { beadId: 'p-zz9', fields: [] }],
      log: "$ bd dolt pull\nNotice: auto-merged issue p-a1; title settled last-write-wins (the older side's edit was superseded)",
    };
    await fake.poll();
    const toast = fake.toasts.find((t) => t.message.startsWith('Synced.'))!;
    expect(toast).toBeTruthy();
    expect(toast.kind).toBe('info');
    expect(toast.message).toContain('"Fix login timeout" (title, acceptance criteria)');
    expect(toast.message).toContain('zz9');
    expect(toast.message).toMatch(/newer edit was kept/);
    expect(toast.message).not.toMatch(/\bpull\b|\bpush\b|dolt|merge|—/i);
    expect(toast.copy).toMatchObject({ text: expect.stringContaining('auto-merged issue p-a1') });
    expect(fake.toasts.filter((t) => t.message.startsWith('Synced.'))).toHaveLength(1);
  });

  it('a publish that merged same-field edits says Published and names them', async () => {
    const w = world();
    const fake = await panel(service(w));
    await click(screen.getByRole('button', { name: 'Publish 3 changes' }));
    await confirm();
    w.sync = { kind: 'idle', superseded: [{ beadId: 'p-b2', fields: ['status'] }], log: 'raw' };
    await fake.poll();
    const toast = fake.toasts.find((t) => t.message.startsWith('Published 3 changes.'))!;
    expect(toast).toBeTruthy();
    expect(toast.message).toContain('"Cut over DNS" (status)');
  });

  it('pauses editing as soon as Sync starts', async () => {
    await panel(service(world()));
    await click(document.getElementById('bd-row-p-a1')!);
    expect(screen.queryByRole('note')).toBeNull();
    await click(screen.getByRole('button', { name: 'Sync' }));
    expect(screen.getByRole('note').textContent).toContain('Editing is paused while Sync runs.');
  });

  it('shows a sync it did not start as running, with both buttons off', async () => {
    await panel(service(world({ sync: { kind: 'running', op: 'publish', startedAt: iso(0) } })));
    expect((screen.getByRole('button', { name: 'Publishing…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Sync' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('project switch during a job', () => {
  it('drops a Sync whose answer comes after the switch: no toast, and the new project is free to sync', async () => {
    const answered = deferred<Answer>();
    const w = world();
    const fake = await panel(service(w, (c) => (c.route === 'sync-pull' && c.body.directory === DIR ? answered.promise : undefined)));
    await click(screen.getByRole('button', { name: 'Sync' }));
    expect(screen.getByRole('button', { name: 'Syncing\u2026' })).toBeTruthy();
    await fake.switchTo('/p/b');
    expect((screen.getByRole('button', { name: 'Sync' }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      answered.resolve(json({ sync: { kind: 'running', op: 'pull', startedAt: iso(0) } }));
      await flush();
    });
    await fake.poll();
    expect(fake.toasts.some((t) => t.message === 'Synced.')).toBe(false);
    expect((screen.getByRole('button', { name: 'Sync' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('forgets a running job of the last project, so the next project being idle is not called Synced.', async () => {
    const w = world();
    const fake = await panel(service(w));
    await click(screen.getByRole('button', { name: 'Sync' }));
    await fake.switchTo('/p/b');
    w.sync = { kind: 'idle' };
    await fake.poll();
    expect(fake.toasts.some((t) => t.message === 'Synced.')).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------- publish

describe('publish', () => {
  it('explains the +N on a change that touched more beads than the one it names', async () => {
    const wide: UnpublishedChange[] = [
      { commit: 'w1', message: 'bd: update', beadIds: ['p-a1', 'p-x7', 'p-x8'], summary: 'Changed status', actor: ACTOR, at: iso(60_000) },
      { commit: 'w2', message: 'bd: update', beadIds: ['p-b2', 'p-x9'], summary: 'Changed status', actor: ACTOR, at: iso(60_000) },
    ];
    await panel(service(world(), (c) => (c.route === 'sync-preview' ? json({ changes: wide, head: 'aaaa1111' } satisfies SyncPreviewResponse) : undefined)));
    await click(screen.getByRole('button', { name: 'Publish 3 changes' }));
    const sheet = screen.getByRole('dialog', { name: 'Publish to the team' });
    const [many, two] = within(sheet).getAllByRole('listitem');
    const plus = (item: HTMLElement) => within(item).getByText(/^\+\d+$/);
    expect(plus(many!).textContent).toBe('+2');
    expect(plus(many!).getAttribute('title')).toBe('and 2 more beads');
    expect(plus(two!).textContent).toBe('+1');
    expect(plus(two!).getAttribute('title')).toBe('and 1 more bead');
  });

  it('previews exactly what goes, and publishes only on Confirm', async () => {
    const w = world();
    const fake = await panel(service(w));
    await click(screen.getByRole('button', { name: 'Publish 3 changes' }));
    expect(routes(fake.calls, 'sync-preview')).toHaveLength(1);
    expect(routes(fake.calls, 'sync-publish')).toHaveLength(0);
    const sheet = screen.getByRole('dialog', { name: 'Publish to the team' });
    expect(within(sheet).getByText("These changes go to the team's shared copy.")).toBeTruthy();
    expect(within(sheet).getByText('Your agent may also publish these when it syncs.')).toBeTruthy();
    const items = within(sheet).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain('a1');
    expect(items[0]!.textContent).toContain('Fix login timeout');
    expect(items[0]!.textContent).toContain('Changed status');
    expect(items[0]!.textContent).toContain('you (panel)');
    expect(items[0]!.textContent).toContain('5m ago');
    expect(items[1]!.textContent).toContain('zz9');
    expect(items[1]!.textContent).toContain('Claude Code');
    expect(items[2]!.textContent).toContain('Added a comment');
    expect(items[2]!.textContent).toContain('unknown');

    await confirm();
    expect(routes(fake.calls, 'sync-publish')).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: 'Publish to the team' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Publishing…' })).toBeTruthy();
    w.sync = { kind: 'idle' };
    w.unpublished = 0;
    await fake.poll();
    expect(fake.toasts.filter((t) => t.message === 'Published 3 changes.')).toHaveLength(1);
    expect(routes(fake.calls, 'sync-publish')).toHaveLength(1);
  });

  it('shows why the preview was refused, and offers nothing to publish', async () => {
    const fake = await panel(
      service(world(), (c) => (c.route === 'sync-preview' ? json({ error: { code: 'sync-running', message: 'Sync in progress. Try again when it finishes.' } }, 409) : undefined)),
    );
    await click(screen.getByRole('button', { name: 'Publish 3 changes' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText('Sync in progress. Try again when it finishes.')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: /^Publish/ })).toBeNull();
    expect(routes(fake.calls, 'sync-publish')).toHaveLength(0);
  });

  it('says Publish did not start when the service answers with another window’s Sync, and never claims it published', async () => {
    const w = world();
    const fake = await panel(service(w, (c) => (c.route === 'sync-publish' ? json({ sync: (w.sync = { kind: 'running', op: 'pull', startedAt: iso(0) }) }) : undefined)));
    await click(screen.getByRole('button', { name: 'Publish 3 changes' }));
    await confirm();
    expect(fake.toasts.some((t) => t.message === "Publish didn't start because a sync is running. Try again when it finishes.")).toBe(true);
    w.sync = { kind: 'idle' };
    await fake.poll();
    expect(fake.toasts.some((t) => /^Published/.test(t.message))).toBe(false);
  });

  it('says Publish did not start when the service refuses it because a job is running', async () => {
    const fake = await panel(service(world(), (c) => (c.route === 'sync-publish' ? json({ error: { code: 'sync-running', message: 'Sync in progress. Try again when it finishes.' } }, 409) : undefined)));
    await click(screen.getByRole('button', { name: 'Publish 3 changes' }));
    await confirm();
    expect(fake.toasts.map((t) => t.message)).toContain("Publish didn't start because a sync is running. Try again when it finishes.");
    expect(fake.toasts.some((t) => /^Couldn't start/.test(t.message))).toBe(false);
  });

  it('says Sync did not start when the service answers with a Publish already running', async () => {
    const w = world();
    const fake = await panel(service(w, (c) => (c.route === 'sync-pull' ? json({ sync: (w.sync = { kind: 'running', op: 'publish', startedAt: iso(0) }) }) : undefined)));
    await click(screen.getByRole('button', { name: 'Sync' }));
    expect(fake.toasts.some((t) => t.message === "Sync didn't start because a sync is running. Try again when it finishes.")).toBe(true);
    w.sync = { kind: 'idle' };
    await fake.poll();
    expect(fake.toasts.some((t) => t.message === 'Synced.')).toBe(false);
  });

  it('says Publish did not start when a job appeared while the preview was open', async () => {
    const w = world();
    const fake = await panel(service(w));
    await click(screen.getByRole('button', { name: 'Publish 3 changes' }));
    w.sync = { kind: 'running', op: 'pull', startedAt: iso(0) };
    await fake.poll();
    await confirm();
    expect(routes(fake.calls, 'sync-publish')).toHaveLength(0);
    expect(fake.toasts.some((t) => t.message === "Publish didn't start because a sync is running. Try again when it finishes.")).toBe(true);
  });

  it('counts the changes a capped preview leaves out, in the list, the button and the toast', async () => {
    const w = world({ unpublished: 5 });
    const fake = await panel(service(w, (c) => (c.route === 'sync-preview' ? json({ changes: CHANGES.slice(0, 2), head: 'aaaa1111', total: 5 }) : undefined)));
    await click(screen.getByRole('button', { name: 'Publish 5 changes' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getAllByRole('listitem')).toHaveLength(2);
    expect(within(sheet).getByText('and 3 more')).toBeTruthy();
    await confirm('Publish 5 changes');
    w.sync = { kind: 'idle' };
    w.unpublished = 0;
    await fake.poll();
    expect(fake.toasts.some((t) => t.message === 'Published 5 changes.')).toBe(true);
  });

  it('sends the head it previewed, and reopens the preview when new changes arrived since', async () => {
    let refused = false;
    const fake = await panel(
      service(world(), (c) => {
        if (c.route !== 'sync-publish' || refused) return undefined;
        refused = true;
        return json({ error: { code: 'preview-stale', message: 'New changes arrived since you looked. Review them again.' } }, 409);
      }),
    );
    await click(screen.getByRole('button', { name: 'Publish 3 changes' }));
    await confirm();
    expect(routes(fake.calls, 'sync-publish')[0]!.body.expectedHead).toBe('aaaa1111');
    const sheet = screen.getByRole('dialog', { name: 'Publish to the team' });
    const notice = within(sheet).getByText('New changes arrived since you looked. Review them again.');
    // Read with the dialog as it opens, not as a live region inserted with its text.
    expect(sheet.getAttribute('aria-describedby')).toBe(notice.id);
    expect(notice.id).not.toBe('');
    expect(notice.closest('[role="status"]')).toBeNull();
    expect(routes(fake.calls, 'sync-preview')).toHaveLength(2);
    expect(routes(fake.calls, 'sync-publish')).toHaveLength(1);
    expect(fake.toasts.some((t) => /^Couldn't start/.test(t.message))).toBe(false);
  });

  it('puts the focus on Cancel, never Confirm, in a sheet that came back on its own', async () => {
    const w = world();
    const fake = await panel(service(w));
    await click(screen.getByRole('button', { name: 'Publish 3 changes' }));
    // Asked for with a click: Confirm takes the focus.
    expect(document.activeElement?.textContent).toBe('Publish 3 changes');
    await confirm();
    w.sync = { kind: 'error', code: 'preview-stale', message: 'New changes arrived since you looked. Review them again.', log: '' };
    await fake.poll();
    const sheet = screen.getByRole('dialog', { name: 'Publish to the team' });
    expect(within(sheet).getByRole('button', { name: 'Publish 3 changes' })).toBeTruthy();
    expect(document.activeElement).toBe(within(sheet).getByRole('button', { name: 'Cancel' }));
  });

  it('holds the list still behind the sheet, makes what is behind it inert, and keeps Tab inside it', async () => {
    await panel(service(world()));
    await click(screen.getByRole('button', { name: 'Publish 3 changes' }));
    const sheet = screen.getByRole('dialog', { name: 'Publish to the team' });
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'j' });
      await flush();
    });
    expect(document.querySelector('[data-cursor]')).toBeNull();
    expect(document.querySelector('main.bd-body')?.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('.bd-head')?.hasAttribute('inert')).toBe(true);
    const buttons = within(sheet).getAllByRole('button');
    const last = buttons[buttons.length - 1]!;
    last.focus();
    await act(async () => {
      fireEvent.keyDown(last, { key: 'Tab' });
      await flush();
    });
    expect(sheet.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(last);
    await click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(document.querySelector('main.bd-body')?.hasAttribute('inert')).toBe(false);
  });

  it('ignores Confirm for half a second after it appears, so a double click on Publish cannot send', async () => {
    const fake = await panel(service(world()));
    await click(screen.getByRole('button', { name: 'Publish 3 changes' }));
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish 3 changes' }));
    expect(routes(fake.calls, 'sync-publish')).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: 'Publish to the team' })).toBeTruthy();
    await confirm();
    expect(routes(fake.calls, 'sync-publish')).toHaveLength(1);
  });

  it('reopens the preview, with no problem card, when the job itself found new changes before pushing', async () => {
    const w = world();
    const fake = await panel(service(w));
    await click(screen.getByRole('button', { name: 'Publish 3 changes' }));
    await confirm();
    w.sync = { kind: 'error', code: 'preview-stale', message: 'New changes arrived since you looked. Review them again.', log: 'New commits that were not in the preview: cccc3333. Nothing was published.' };
    await fake.poll();
    const sheet = screen.getByRole('dialog', { name: 'Publish to the team' });
    expect(within(sheet).getByText('New changes arrived since you looked. Review them again.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Sync ran into a problem' })).toBeNull();
    expect(routes(fake.calls, 'sync-preview')).toHaveLength(2);
    expect(fake.toasts.some((t) => /^Published/.test(t.message))).toBe(false);
  });

  it('says in the sheet that changes made in the moment Publish runs may go too', async () => {
    await panel(service(world()));
    await click(screen.getByRole('button', { name: 'Publish 3 changes' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText('Changes made in the moment Publish runs may go with them.')).toBeTruthy();
    expect(within(sheet).getByText('Your agent may also publish these when it syncs.')).toBeTruthy();
  });

  it('counts only what the preview read, not a header count that is a poll behind', async () => {
    await panel(service(world({ unpublished: 5 }), (c) => (c.route === 'sync-preview' ? json({ changes: CHANGES.slice(0, 2), head: 'aaaa1111', total: 2 }) : undefined)));
    await click(screen.getByRole('button', { name: 'Publish 5 changes' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('button', { name: 'Publish 2 changes' })).toBeTruthy();
    expect(within(sheet).queryByText(/^and \d+ more$/)).toBeNull();
  });

  it('Cancel closes the preview and publishes nothing', async () => {
    const fake = await panel(service(world()));
    await click(screen.getByRole('button', { name: 'Publish 3 changes' }));
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(routes(fake.calls, 'sync-publish')).toHaveLength(0);
  });

  it('says there is nothing to publish when the preview is empty', async () => {
    await panel(service(world(), (c) => (c.route === 'sync-preview' ? json({ changes: [] }) : undefined)));
    await click(screen.getByRole('button', { name: 'Publish 3 changes' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText("Nothing to publish. Everything here is already on the team's shared copy.")).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: /^Publish/ })).toBeNull();
  });

  it('says Publish cannot set up an empty team copy, and offers no Confirm', async () => {
    const fake = await panel(service(world(), (c) => (c.route === 'sync-preview' ? json({ changes: CHANGES, head: 'aaaa1111', total: 3, teamEmpty: true } satisfies SyncPreviewResponse) : undefined)));
    await click(screen.getByRole('button', { name: 'Publish 3 changes' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText("The team's shared copy has nothing in it yet. Publish can't set it up.")).toBeTruthy();
    const confirmButton = within(sheet).getByRole('button', { name: 'Publish 3 changes' }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    await confirm();
    expect(routes(fake.calls, 'sync-publish')).toHaveLength(0);
    expect(document.activeElement?.textContent).toBe('Cancel');
  });

  it('turns Confirm off with a reason when the preview came back without a head to publish against', async () => {
    const fake = await panel(service(world(), (c) => (c.route === 'sync-preview' ? json({ changes: CHANGES, total: 3 } satisfies SyncPreviewResponse) : undefined)));
    await click(screen.getByRole('button', { name: 'Publish 3 changes' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText("Couldn't confirm this list is current. Close and try again.")).toBeTruthy();
    const confirmButton = within(sheet).getByRole('button', { name: 'Publish 3 changes' }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    await confirm();
    expect(routes(fake.calls, 'sync-publish')).toHaveLength(0);
    expect(document.activeElement?.textContent).toBe('Cancel');
  });

  it('tells the person to Sync first when this computer has never seen the team copy, and offers no Confirm', async () => {
    const fake = await panel(service(world(), (c) => (c.route === 'sync-preview' ? json({ changes: CHANGES, head: 'aaaa1111', total: 3, teamUnseen: true } satisfies SyncPreviewResponse) : undefined)));
    await click(screen.getByRole('button', { name: 'Publish 3 changes' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText("This computer hasn't seen the team's shared copy yet. Sync first.")).toBeTruthy();
    expect(within(sheet).queryByText(/nothing in it yet/)).toBeNull();
    const confirmButton = within(sheet).getByRole('button', { name: 'Publish 3 changes' }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    await confirm();
    expect(routes(fake.calls, 'sync-publish')).toHaveLength(0);
    expect(document.activeElement?.textContent).toBe('Cancel');
  });

  it('says there is nothing to publish when there is no shared copy', async () => {
    await panel(service(world(), (c) => (c.route === 'sync-preview' ? json({ changes: [], noRemote: true }) : undefined)));
    await click(screen.getByRole('button', { name: 'Publish 3 changes' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText('This project has no shared copy with the team, so there is nothing to publish.')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: /^Publish/ })).toBeNull();
  });

  it('never sends Publish again after an answer that did not come back', async () => {
    const fake = await panel(
      service(world(), (c) => (c.route === 'sync-publish' ? Promise.reject(new HostRequestError('HOST_TIMEOUT', 'no answer in 30000 ms')) : undefined)),
    );
    await click(screen.getByRole('button', { name: 'Publish 3 changes' }));
    await confirm();
    await fake.poll();
    await fake.poll();
    expect(routes(fake.calls, 'sync-publish')).toHaveLength(1);
    expect(fake.toasts.some((t) => t.message === 'Publish may have started. The team line shows when it is done.')).toBe(true);
    expect(fake.toasts.some((t) => /^Published/.test(t.message))).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------- problems

describe('sync problems', () => {
  it('shows a conflict with both sides and hands its context to the open chat', async () => {
    const fake = await panel(service(world({ sync: CONFLICT })));
    const card = screen.getByRole('region', { name: 'Sync needs attention' });
    expect(within(card).getByText("Your changes are safe. The team's copy has edits to the same fields.")).toBeTruthy();
    expect(within(card).getByText('b2')).toBeTruthy();
    expect(within(card).getByText('Cut over DNS')).toBeTruthy();
    expect(within(card).getByText('Status')).toBeTruthy();
    expect(within(card).getByText('Blocked')).toBeTruthy();
    expect(within(card).getByText('In progress')).toBeTruthy();
    // A long value is cut, with a way to see all of it.
    expect(within(card).queryByText('x'.repeat(200))).toBeNull();
    await click(within(card).getByRole('button', { name: 'Show all' }));
    expect(within(card).getByText('x'.repeat(200))).toBeTruthy();
    expect((screen.getByRole('button', { name: /^Publish/ }) as HTMLButtonElement).disabled).toBe(true);

    await click(within(card).getByRole('button', { name: 'Hand to agent' }));
    expect(routes(fake.calls, 'conflict-context')).toHaveLength(1);
    expect(fake.host.attach).toHaveBeenCalledTimes(1);
    expect(fake.host.attach.mock.calls[0]![0]).toEqual({
      providerId: 'beads',
      id: 'sync-a',
      title: 'Beads sync needs attention',
      url: 'https://beads.invalid/a/sync',
      text: CONTEXT.text,
      kind: 'issue',
      data: { v: 1, directory: DIR, sync: true },
    });
    expect(fake.host.startSession).not.toHaveBeenCalled();
    expect(routes(fake.calls, 'sync-publish')).toHaveLength(0);
  });

  it('says editing is paused for a half merge, and starts a session with the context when no chat is open', async () => {
    const fake = await panel(service(world({ sync: { ...CONFLICT, mode: 'server', halfMerged: true } as SyncState })), null);
    const card = screen.getByRole('region', { name: 'Sync needs attention' });
    expect(within(card).getByText('Editing is paused until this is resolved.')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Hand to agent' })).toBeNull();
    await click(within(card).getByRole('button', { name: 'Start session with this' }));
    expect(fake.host.startSession).toHaveBeenCalledTimes(1);
    const started = fake.host.startSession.mock.calls[0]![0] as Record<string, unknown>;
    expect(started).toMatchObject({ providerId: 'beads', id: 'sync-a', kind: 'issue', navigation: 'open' });
    expect(started.text).toBeUndefined();
    expect(fake.host.attach).toHaveBeenCalledTimes(1);
    expect(fake.host.attach.mock.calls[0]![0].text).toBe(CONTEXT.text);
  });

  it('points the paused note at the sync details while they show', async () => {
    await panel(service(world({ sync: { ...CONFLICT, mode: 'server', halfMerged: true } as SyncState })));
    await click(document.getElementById('bd-row-p-a1')!);
    const note = screen.getByRole('note');
    expect(note.textContent).toContain('Editing is paused until the sync problem is resolved.');
    expect(note.textContent).toContain('See sync details above.');
  });

  it('shows a paused upgrade with its message, Hand to agent, and Copy details with the log', async () => {
    const message = "This project's beads data needs a different Beads version. Hand it to your agent to check.";
    const fake = await panel(service(world({ sync: { kind: 'paused-upgrade', message, log: 'bd dolt pull\nunsupported format' } })));
    const card = screen.getByRole('region', { name: 'Sync is paused' });
    expect(within(card).getByText(message)).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Hand to agent' })).toBeTruthy();
    await click(within(card).getByRole('button', { name: 'Copy details' }));
    const toast = fake.toasts.at(-1)!;
    expect(toast.copy).toEqual({ text: 'bd dolt pull\nunsupported format' });
  });

  it('shows a sync error with its message and Copy details', async () => {
    const message = "Could not reach the team's shared copy. Check your connection, then try again.";
    const fake = await panel(service(world({ sync: { kind: 'error', message, log: 'fatal: unable to access' } })));
    const card = screen.getByRole('region', { name: 'Sync ran into a problem' });
    expect(within(card).getByText(message)).toBeTruthy();
    await click(within(card).getByRole('button', { name: 'Copy details' }));
    expect(fake.toasts.at(-1)!.copy).toEqual({ text: 'fatal: unable to access' });
  });

  it('lets a sync error be put away until a different one comes', async () => {
    const w = world({ sync: { kind: 'error', message: 'Sync did not finish. Try again, or copy the details.', log: 'one' } });
    const fake = await panel(service(w));
    await click(within(screen.getByRole('region', { name: 'Sync ran into a problem' })).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region', { name: 'Sync ran into a problem' })).toBeNull();
    await fake.poll();
    expect(screen.queryByRole('region', { name: 'Sync ran into a problem' })).toBeNull();
    w.sync = { kind: 'error', message: 'Sync did not finish. Try again, or copy the details.', log: 'two' };
    await fake.poll();
    expect(screen.getByRole('region', { name: 'Sync ran into a problem' })).toBeTruthy();
  });

  it('folds the conflicting beads away over a bead detail, and shows them on request', async () => {
    await panel(service(world({ sync: CONFLICT })));
    const card = () => screen.getByRole('region', { name: 'Sync needs attention' });
    expect(within(card()).getByText('Cut over DNS')).toBeTruthy();
    await click(document.getElementById('bd-row-p-a1')!);
    expect(within(card()).queryByText('Cut over DNS')).toBeNull();
    await click(within(card()).getByRole('button', { name: 'Show the bead' }));
    expect(within(card()).getByText('Cut over DNS')).toBeTruthy();
    expect(within(card()).getByRole('button', { name: 'Hand to agent' })).toBeTruthy();
  });

  it('shows a dismissed error again when a new Sync fails the same way', async () => {
    const failed: SyncState = { kind: 'error', message: 'Sync did not finish. Try again, or copy the details.', log: 'same' };
    const w = world({ sync: failed });
    const fake = await panel(service(w));
    await click(within(screen.getByRole('region', { name: 'Sync ran into a problem' })).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region', { name: 'Sync ran into a problem' })).toBeNull();
    await click(screen.getByRole('button', { name: 'Sync' }));
    w.sync = failed;
    await fake.poll();
    expect(screen.getByRole('region', { name: 'Sync ran into a problem' })).toBeTruthy();
  });

  it('keeps an error put away when Sync never started (refused, or another window\'s job answered)', async () => {
    const failed: SyncState = { kind: 'error', message: 'Sync did not finish. Try again, or copy the details.', log: 'same' };
    const w = world({ sync: failed });
    let answer: 'busy' | 'other' = 'busy';
    const fake = await panel(
      service(w, (c) => {
        if (c.route !== 'sync-pull') return undefined;
        return answer === 'busy'
          ? json({ error: { code: 'busy', message: 'Beads is busy with another task. Try again in a moment.' } }, 503)
          : json({ sync: { kind: 'running', op: 'publish', startedAt: iso(0) } });
      }),
    );
    await click(within(screen.getByRole('region', { name: 'Sync ran into a problem' })).getByRole('button', { name: 'Dismiss' }));
    await click(screen.getByRole('button', { name: 'Sync' }));
    await fake.poll();
    expect(screen.queryByRole('region', { name: 'Sync ran into a problem' })).toBeNull();
    answer = 'other';
    await click(screen.getByRole('button', { name: 'Sync' }));
    w.sync = failed;
    await fake.poll();
    expect(screen.queryByRole('region', { name: 'Sync ran into a problem' })).toBeNull();
  });

  it('lays out whole conflicting beads, and scrolls the list inside the card only once all of them are asked for', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ beadId: `p-m${i}`, title: `Bead ${i}`, ours: { status: 'blocked' }, theirs: { status: 'open' } }));
    await panel(service(world({ sync: { ...CONFLICT, beads: many } as SyncState })));
    const card = screen.getByRole('region', { name: 'Sync needs attention' });
    const list = () => within(card).getByRole('list', { name: 'Beads changed on both sides' });
    // Three whole cards and a plain "Show 2 more": no clipped sliver of a fourth.
    expect(within(list()).getAllByRole('listitem')).toHaveLength(3);
    expect(list().hasAttribute('data-all')).toBe(false);
    await click(within(card).getByRole('button', { name: 'Show 2 more' }));
    expect(within(list()).getAllByRole('listitem')).toHaveLength(5);
    expect(list().hasAttribute('data-all')).toBe(true);
    await click(within(card).getByRole('button', { name: 'Show fewer' }));
    expect(list().hasAttribute('data-all')).toBe(false);
  });

  it('offers no Dismiss for a conflict', async () => {
    await panel(service(world({ sync: CONFLICT })));
    expect(within(screen.getByRole('region', { name: 'Sync needs attention' })).queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------- the sync chip

describe('the sync chip', () => {
  const chip = { providerId: 'beads', id: 'sync-a', title: 'Beads sync needs attention', url: 'https://beads.invalid/a/sync', kind: 'issue', data: { v: 1, directory: DIR, sync: true } } as const;

  it('opens as the sync problem, never as a bead that is gone', async () => {
    const fake = host(service(world({ sync: CONFLICT })));
    const root = document.createElement('div');
    document.body.append(root);
    await act(async () => {
      disposers.push(mountAttachDialog({ ...fake.host, close: vi.fn(async () => {}) } as never, root, { directory: DIR, item: chip as never }, { visibility: alwaysVisible }));
      await flush();
    });
    expect(screen.getByText('Beads sync problem')).toBeTruthy();
    expect(screen.queryByText(/no longer in this project/)).toBeNull();
    // The same chip comes from a failed or paused sync, which has no conflicting beads: the copy names none.
    expect(screen.getByText("This holds the details of a team sync that stopped: what happened and what Beads ran. Abacus shows whether it is still there.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/both sides/);
  });

  it('a sync session whose link was not saved says so about the sync details, not a bead', async () => {
    const fake = await panel(service(world({ sync: CONFLICT })), null);
    fake.host.startSession.mockResolvedValueOnce({ sessionId: 'ses_new', sent: 'skipped', linked: false });
    await click(within(screen.getByRole('region', { name: 'Sync needs attention' })).getByRole('button', { name: 'Start session with this' }));
    expect(fake.toasts.some((t) => t.message === "Session started, but the link to the sync details wasn't saved.")).toBe(true);
  });
});
