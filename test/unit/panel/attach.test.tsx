// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/preact';
import { HostRequestError, type AttachIssueRequest, type GuestItem, type SessionSnapshot, type StartSessionResult } from '@openchamber/sdk';
import { createClient } from '../../../src/panel/client';
import { attachPayload, beadOfItem, matchBead, resolveCommand, worktreeName } from '../../../src/panel/resolve';
import { mountPanel, type PanelHost } from '../../../src/panel/ui/App';
import { mountAttachDialog } from '../../../src/panel/ui/Picker';
import type { BeadResponse, ContextResponse } from '../../../src/shared/api';
import type { Bead, StatusDef } from '../../../src/shared/types';
import { relatedFor } from '../../../src/shared/related';
import { deferred, envelope, flush, freshness, json, snapshot, type Answer, type Call } from './helpers';

const NOW = Date.now();
const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const DIR = '/p/a';

function bead(id: string, over: Partial<Bead> = {}): Bead {
  return {
    id,
    title: `Title ${id}`,
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
    createdAt: iso(10 * DAY),
    createdBy: null,
    updatedAt: iso(DAY),
    closedAt: null,
    closeReason: null,
    dependencies: [],
    comments: [],
    extra: {},
    ...over,
  };
}

const STATUSES: StatusDef[] = [
  { name: 'open', category: 'active', icon: null },
  { name: 'in_progress', category: 'wip', icon: null },
  { name: 'closed', category: 'done', icon: null },
];

const BEADS = [
  bead('p-a1', { title: 'Fix login timeout', description: 'Sessions expire after **5 minutes**.', updatedAt: iso(1_000) }),
  bead('p-b2', { title: 'Port session tokens', updatedAt: iso(2_000) }),
  bead('p-b2.1', { title: 'Refresh tokens too', parentId: 'p-b2', updatedAt: iso(3_000) }),
  bead('p-c3.1', { title: 'Old cleanup', updatedAt: iso(4_000) }),
];

const contextOf = (id: string): ContextResponse => ({ id, title: `Title ${id}`, text: `Beads issue context (JSON)\n{"issue":{"id":"${id}"}}`, url: `https://github.com/o/r?bead=${id}` });

const live = (beads = BEADS) => snapshot({ beads, statuses: STATUSES, readyIds: beads.map((b) => b.id), freshness: freshness({ localRefreshedAt: iso(0) }) });

function service(over: (call: Call) => Answer | Promise<Answer> | undefined = () => undefined) {
  return (call: Call): Answer | Promise<Answer> => {
    const answer = over(call);
    if (answer) return answer;
    if (call.route === 'snapshot') return json(live());
    if (call.route === 'seen') return json({ unseenIds: [] });
    if (call.route === 'context') return json(contextOf(call.body.id as string));
    if (call.route === 'bead') {
      const b = BEADS.find((x) => x.id === call.body.id)!;
      return json({ bead: b, related: relatedFor(b, BEADS) } satisfies BeadResponse);
    }
    return json({});
  };
}

const SESSION: SessionSnapshot = { id: 'ses_1', title: 'Fixing the login', busy: false };

/** A host with every call the panel and the dialog make, each recorded. */
function host(answer: (call: Call) => Answer | Promise<Answer>, opts: { session?: SessionSnapshot | null; item?: GuestItem | null; directory?: string | null } = {}) {
  const calls: Call[] = [];
  const directoryListeners = new Set<(d: string | null) => void>();
  const sessionListeners = new Set<(s: SessionSnapshot | null) => void>();
  const itemListeners = new Set<(i: GuestItem | null) => void>();
  let directory = opts.directory === undefined ? DIR : opts.directory;
  let session = opts.session === undefined ? SESSION : opts.session;
  let item = opts.item ?? null;
  const stored = new Map<string, unknown>();
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
    toast: vi.fn(async () => {}),
    setBadge: vi.fn(async () => {}),
    writeClipboard: vi.fn(async () => {}),
    openUrl: vi.fn(async () => {}),
    attach: vi.fn(async (_req: AttachIssueRequest) => {}),
    sessionLink: vi.fn(async (_req: AttachIssueRequest) => {}),
    startSession: vi.fn(async (_req: unknown): Promise<StartSessionResult> => ({ sessionId: 'ses_new', sent: 'skipped', linked: true })),
    close: vi.fn(async () => {}),
    onDirectory(listener: (d: string | null) => void) {
      directoryListeners.add(listener);
      listener(directory);
      return () => void directoryListeners.delete(listener);
    },
    onSession(listener: (s: SessionSnapshot | null) => void) {
      sessionListeners.add(listener);
      listener(session);
      return () => void sessionListeners.delete(listener);
    },
    onItem(listener: (i: GuestItem | null) => void) {
      itemListeners.add(listener);
      listener(item);
      return () => void itemListeners.delete(listener);
    },
  };
  const emit = {
    directory(next: string | null) {
      directory = next;
      directoryListeners.forEach((l) => l(next));
    },
    session(next: SessionSnapshot | null) {
      session = next;
      sessionListeners.forEach((l) => l(next));
    },
    item(next: GuestItem | null) {
      item = next;
      itemListeners.forEach((l) => l(next));
    },
  };
  return { host: h, calls, emit };
}

const alwaysVisible = { isVisible: () => true, onChange: () => () => {} };
const disposers: Array<() => void> = [];

afterEach(() => {
  disposers.splice(0).forEach((d) => d());
  cleanup();
  document.body.innerHTML = '';
});

async function panel(answer = service(), opts: Parameters<typeof host>[1] = {}) {
  const fake = host(answer, opts);
  const root = document.createElement('div');
  document.body.append(root);
  await act(async () => {
    const mounted = mountPanel(fake.host as unknown as PanelHost, root, { visibility: alwaysVisible });
    disposers.push(mounted.dispose);
    await flush();
  });
  return fake;
}

async function openBead(id: string) {
  await act(async () => {
    fireEvent.click(document.getElementById(`bd-row-${id}`)!);
    await flush();
  });
}

const click = (el: Element) =>
  act(async () => {
    fireEvent.click(el);
    await flush();
  });

const footer = () => screen.getByRole('group', { name: 'Attach to' });

// ------------------------------------------------------------------------------------------------- logic

describe('attach payload', () => {
  it('is the beads chip, with the context text and the project folder in data', () => {
    expect(attachPayload(contextOf('p-a1'), DIR)).toEqual({
      providerId: 'beads',
      id: 'p-a1',
      title: 'Title p-a1',
      url: 'https://github.com/o/r?bead=p-a1',
      text: 'Beads issue context (JSON)\n{"issue":{"id":"p-a1"}}',
      kind: 'issue',
      data: { v: 1, directory: DIR },
    });
  });

  it('keeps id, title and text within what OpenChamber accepts', () => {
    const long = attachPayload({ id: 'x'.repeat(140), title: 't'.repeat(260), text: 'y'.repeat(20_000), url: 'https://beads.invalid/a/x' }, DIR);
    expect(long.id).toHaveLength(128);
    expect(long.title).toHaveLength(200);
    expect(long.text).toHaveLength(16_000);
  });
});

describe('worktree name', () => {
  it('is issue-<id>-<slug>, the slug lowercase title words joined by dashes', () => {
    expect(worktreeName('p-a1', 'Fix login timeout')).toBe('issue-p-a1-fix-login-timeout');
    expect(worktreeName('p-a1', 'Fix "café" crash: v2.1!')).toBe('issue-p-a1-fix-cafe-crash-v2-1');
  });

  it('caps the slug at 40 characters, ending on a whole word', () => {
    const name = worktreeName('scr-8nw.1', 'Port session tokens to the new auth service and retire the old one');
    expect(name).toBe('issue-scr-8nw.1-port-session-tokens-to-the-new-auth');
    expect(name.length - 'issue-scr-8nw.1-'.length).toBeLessThanOrEqual(40);
    // One very long word is cut rather than dropped.
    expect(worktreeName('p-a1', 'a'.repeat(60))).toBe(`issue-p-a1-${'a'.repeat(40)}`);
  });

  it('is just issue-<id> when the title has no words', () => {
    expect(worktreeName('p-a1', '!!!')).toBe('issue-p-a1');
  });
});

describe('/bd resolver', () => {
  const ids = BEADS.map((b) => b.id);

  it('matches the full id, the short id, or an unambiguous end of the id', () => {
    expect(matchBead(ids, 'p-b2')).toEqual({ kind: 'one', id: 'p-b2' });
    expect(matchBead(ids, 'P-B2')).toEqual({ kind: 'one', id: 'p-b2' });
    expect(matchBead(ids, 'a1')).toEqual({ kind: 'one', id: 'p-a1' });
    expect(matchBead(ids, 'b2.1')).toEqual({ kind: 'one', id: 'p-b2.1' });
    expect(matchBead(ids, '1')).toEqual({ kind: 'many', ids: ['p-b2.1', 'p-c3.1'] });
    // Only at a - or . boundary: "a1" is not "1".
    expect(matchBead(ids, 'b2')).toEqual({ kind: 'one', id: 'p-b2' });
    expect(matchBead(ids, 'zz')).toEqual({ kind: 'none' });
  });

  it('returns the chip for a known bead, read fresh from the context route', async () => {
    const fake = host(service());
    const client = createClient(fake.host as unknown as PanelHost);
    const chip = await resolveCommand({ command: 'bd', args: '  a1 ' }, { client, directory: DIR });
    expect(chip).toEqual(attachPayload(contextOf('p-a1'), DIR));
    expect(fake.calls.map((c) => c.route)).toEqual(['snapshot', 'context']);
    expect(fake.calls[1]!.body).toEqual({ directory: DIR, id: 'p-a1' });
    // The host attaches what the resolver returns; the resolver never attaches too.
    expect(fake.host.attach).not.toHaveBeenCalled();
  });

  it('uses the beads the panel already holds for this project instead of reading them again', async () => {
    const fake = host(service());
    const client = createClient(fake.host as unknown as PanelHost);
    await resolveCommand({ command: 'bd', args: 'b2' }, { client, directory: DIR, known: { directory: DIR, ids } });
    expect(fake.calls.map((c) => c.route)).toEqual(['context']);
  });

  it('reads the project again once when the held beads lack it, as the agent may have just made it', async () => {
    const fake = host(service());
    const client = createClient(fake.host as unknown as PanelHost);
    const chip = await resolveCommand({ command: 'bd', args: 'a1' }, { client, directory: DIR, known: { directory: DIR, ids: ['p-b2'] } });
    expect(chip?.id).toBe('p-a1');
    expect(fake.calls.map((c) => c.route)).toEqual(['snapshot', 'context']);
    // Ambiguous among held ids, but one match on the fresh read.
    const fresh = host(service());
    const again = await resolveCommand(
      { command: 'bd', args: 'b2.1' },
      { client: createClient(fresh.host as unknown as PanelHost), directory: DIR, known: { directory: DIR, ids: ['p-b2.1', 'p-x-b2.1'] } },
    );
    expect(again?.id).toBe('p-b2.1');
    expect(fresh.calls.filter((c) => c.route === 'snapshot')).toHaveLength(1);
  });

  it('says plainly when no bead or more than one matches', async () => {
    const client = createClient(host(service()).host as unknown as PanelHost);
    await expect(resolveCommand({ command: 'bd', args: 'zz9' }, { client, directory: DIR })).rejects.toThrow('No bead zz9 in this project.');
    const more = [...BEADS, bead('p-d4.1'), bead('p-e5.1')];
    const crowded = createClient(host(service((c) => (c.route === 'snapshot' ? json(live(more)) : undefined))).host as unknown as PanelHost);
    await expect(resolveCommand({ command: 'bd', args: '1' }, { client: crowded, directory: DIR, known: { directory: DIR, ids } })).rejects.toThrow(
      '1 matches more than one bead: p-b2.1, p-c3.1, p-d4.1 and 1 more. Type more of the id.',
    );
    await expect(resolveCommand({ command: 'bd', args: '   ' }, { client, directory: DIR })).rejects.toThrow('Type a bead id after /bd');
    await expect(resolveCommand({ command: 'bd', args: 'a1' }, { client, directory: null })).rejects.toThrow('Open a project first.');
  });

  it('answers nothing for another command', async () => {
    const client = createClient(host(service()).host as unknown as PanelHost);
    expect(await resolveCommand({ command: 'other', args: 'a1' }, { client, directory: DIR })).toBeNull();
  });
});

describe('chip item', () => {
  const chip = (over: Partial<AttachIssueRequest> = {}): AttachIssueRequest => ({ ...attachPayload(contextOf('p-b2'), DIR), ...over });

  it('names the bead for a beads chip from this project, and nothing otherwise', () => {
    expect(beadOfItem(chip(), DIR)).toBe('p-b2');
    expect(beadOfItem(chip({ data: { v: 1, directory: '/p/other' } }), DIR)).toBeNull();
    expect(beadOfItem(chip({ providerId: 'linear' }), DIR)).toBeNull();
    expect(beadOfItem(null, DIR)).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------- the panel

describe('attach footer', () => {
  it('adds the bead to the open chat as a chip, read fresh at click time, and never sends', async () => {
    const fake = await panel();
    await openBead('p-a1');
    const before = fake.calls.filter((c) => c.route === 'context').length;
    expect(before).toBe(0);
    await click(within(footer()).getByRole('button', { name: 'Current chat' }));
    expect(fake.calls.filter((c) => c.route === 'context')).toHaveLength(1);
    expect(fake.host.attach).toHaveBeenCalledWith(attachPayload(contextOf('p-a1'), DIR));
    expect(fake.host.startSession).not.toHaveBeenCalled();
    expect(fake.host.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success', message: 'Added a1 to the chat.' }));
  });

  it('shows the open chat by name, and with no open chat disables Current session and points to New session', async () => {
    const fake = await panel(service(), { session: null });
    await openBead('p-a1');
    const current = within(footer()).getByRole('button', { name: 'Current chat' }) as HTMLButtonElement;
    expect(current.disabled).toBe(true);
    expect(footer().textContent).toContain('No open chat. Start a new session instead.');
    await act(async () => {
      fake.emit.session(SESSION);
      await flush();
    });
    expect(current.disabled).toBe(false);
    expect(footer().textContent).toContain('Fixing the login');
  });

  it('starts a new session linked to the bead, opens it, then puts the chip on its composer', async () => {
    const fake = await panel();
    await openBead('p-a1');
    await click(within(footer()).getByRole('button', { name: 'New session' }));
    const { text, ...rest } = attachPayload(contextOf('p-a1'), DIR);
    expect(fake.host.startSession).toHaveBeenCalledTimes(1);
    // No text, so nothing is sent: the person writes the first message.
    expect(fake.host.startSession).toHaveBeenCalledWith({ ...rest, navigation: 'open' });
    expect(fake.host.attach).toHaveBeenCalledWith({ ...rest, text });
    // The chip goes to the new chat's composer, so the session must exist first.
    expect(fake.host.startSession.mock.invocationCallOrder[0]!).toBeLessThan(fake.host.attach.mock.invocationCallOrder[0]!);
  });

  it('shows progress while a session starts, and keeps every button off until it ends', async () => {
    const gate = deferred<StartSessionResult>();
    const fake = await panel();
    fake.host.startSession.mockImplementationOnce(() => gate.promise);
    await openBead('p-a1');
    await click(within(footer()).getByRole('button', { name: 'New session' }));
    expect(footer().getAttribute('aria-busy')).toBe('true');
    expect(footer().textContent).toContain('Starting…');
    // The button's name follows what it shows, not the label it had before.
    expect(within(footer()).getByRole('button', { name: 'Starting…' }).getAttribute('data-attach')).toBe('session');
    expect(within(footer()).queryByRole('button', { name: 'New session' })).toBeNull();
    for (const b of within(footer()).getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      gate.resolve({ sessionId: 'ses_new', sent: 'skipped', linked: true });
      await flush();
    });
    expect(footer().getAttribute('aria-busy')).toBe('false');
  });

  it('says so when the session started but the link to the bead was not saved', async () => {
    const fake = await panel();
    fake.host.startSession.mockResolvedValueOnce({ sessionId: 'ses_new', sent: 'skipped', linked: false });
    await openBead('p-a1');
    await click(within(footer()).getByRole('button', { name: 'New session' }));
    expect(fake.host.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'info', message: "Session started, but the link to the bead wasn't saved." }));
  });

  it('confirms the worktree name, which can be changed, then starts the session in a new worktree', async () => {
    const fake = await panel();
    await openBead('p-a1');
    await click(within(footer()).getByRole('button', { name: 'In worktree…' }));
    const sheet = screen.getByRole('dialog', { name: 'New session in a worktree' });
    const name = within(sheet).getByLabelText('Branch and worktree name') as HTMLInputElement;
    expect(name.value).toBe('issue-p-a1-fix-login-timeout');
    expect((within(sheet).getByLabelText('Start from') as HTMLInputElement).placeholder).toBe('Project default branch');
    await act(async () => {
      fireEvent.input(name, { target: { value: 'issue-p-a1-login' } });
      await flush();
    });
    await click(within(sheet).getByRole('button', { name: 'Start session' }));
    await act(async () => {
      await flush();
    });
    const { text: _text, ...rest } = attachPayload(contextOf('p-a1'), DIR);
    expect(fake.host.startSession).toHaveBeenCalledWith({ ...rest, worktree: { kind: 'new', name: 'issue-p-a1-login' }, navigation: 'open' });
    expect(screen.queryByRole('dialog', { name: 'New session in a worktree' })).toBeNull();
  });

  // The host frame has no allow-forms, so the sheet never relies on a form submit: the button's click and a plain Enter in a
  // field each start the session exactly once.
  it('starts the worktree session once from the Start session button, with no form in the sheet', async () => {
    const fake = await panel();
    await openBead('p-a1');
    await click(within(footer()).getByRole('button', { name: 'In worktree…' }));
    const sheet = screen.getByRole('dialog', { name: 'New session in a worktree' });
    expect(sheet.tagName).not.toBe('FORM');
    await click(within(sheet).getByRole('button', { name: 'Start session' }));
    expect(fake.host.startSession).toHaveBeenCalledTimes(1);
  });

  it('starts the worktree session once from Enter in either field, and not while composing', async () => {
    const fake = await panel();
    await openBead('p-a1');
    await click(within(footer()).getByRole('button', { name: 'In worktree…' }));
    const sheet = screen.getByRole('dialog', { name: 'New session in a worktree' });
    const name = within(sheet).getByLabelText('Branch and worktree name');
    const press = (el: Element, init: KeyboardEventInit) =>
      act(async () => {
        fireEvent.keyDown(el, { key: 'Enter', ...init });
        await flush();
      });
    await press(name, { isComposing: true });
    expect(fake.host.startSession).not.toHaveBeenCalled();
    await press(within(sheet).getByLabelText('Start from'), {});
    expect(fake.host.startSession).toHaveBeenCalledTimes(1);
  });

  it('closes the worktree sheet when OpenChamber switches to another project', async () => {
    const fake = await panel();
    await openBead('p-a1');
    await click(within(footer()).getByRole('button', { name: 'In worktree…' }));
    expect(screen.getByRole('dialog', { name: 'New session in a worktree' })).toBeTruthy();
    await act(async () => {
      fake.emit.directory('/p/b');
      await flush();
    });
    expect(screen.queryByRole('dialog', { name: 'New session in a worktree' })).toBeNull();
    expect(fake.host.startSession).not.toHaveBeenCalled();
  });

  it('keeps Tab inside the worktree sheet and the detail behind it inert', async () => {
    await panel();
    await openBead('p-a1');
    await click(within(footer()).getByRole('button', { name: 'In worktree…' }));
    const sheet = screen.getByRole('dialog', { name: 'New session in a worktree' });
    expect(document.querySelector('.bd-detail')?.hasAttribute('inert')).toBe(true);
    const start = within(sheet).getByRole('button', { name: 'Start session' });
    start.focus();
    await act(async () => {
      fireEvent.keyDown(start, { key: 'Tab' });
      await flush();
    });
    expect(sheet.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(start);
    const first = within(sheet).getByLabelText('Branch and worktree name');
    first.focus();
    await act(async () => {
      fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
      await flush();
    });
    expect(document.activeElement).toBe(start);
  });

  it('asks before a worktree start while a draft is unsaved: the new chat closes this panel', async () => {
    const fake = await panel();
    await openBead('p-a1');
    const box = screen.getByRole('textbox', { name: 'Add a comment' }) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.input(box, { target: { value: 'Half a thought' } });
      await flush();
    });
    await click(within(footer()).getByRole('button', { name: 'In worktree…' }));
    const ask = screen.getByRole('alertdialog', { name: 'Discard your changes?' });
    expect(screen.queryByRole('dialog', { name: 'New session in a worktree' })).toBeNull();
    await click(within(ask).getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('dialog', { name: 'New session in a worktree' })).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Add a comment' }) as HTMLTextAreaElement).value).toBe('Half a thought');

    await click(within(footer()).getByRole('button', { name: 'In worktree…' }));
    await click(within(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).getByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('dialog', { name: 'New session in a worktree' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Add a comment' }) as HTMLTextAreaElement).value).toBe('');
    expect(fake.host.startSession).not.toHaveBeenCalled();
  });

  it('never attaches after a worktree start, and says before starting how to add the bead in the new chat', async () => {
    const fake = await panel();
    await openBead('p-a1');
    await click(within(footer()).getByRole('button', { name: 'In worktree…' }));
    const sheet = screen.getByRole('dialog', { name: 'New session in a worktree' });
    expect(sheet.textContent).toContain('The new chat is linked to the bead. To add the bead’s details there, type /bd p-a1 in it.');
    await click(within(sheet).getByRole('button', { name: 'Copy /bd p-a1' }));
    expect(fake.host.writeClipboard).toHaveBeenCalledWith('/bd p-a1');
    await click(within(sheet).getByRole('button', { name: 'Start session' }));
    await act(async () => {
      await flush();
    });
    expect(fake.host.startSession).toHaveBeenCalledTimes(1);
    // The panel's frame goes away when the worktree's chat opens, so no chip can follow.
    expect(fake.host.attach).not.toHaveBeenCalled();
  });

  it('passes a base branch only when one is typed, and refuses a name git would not take', async () => {
    const fake = await panel();
    await openBead('p-a1');
    await click(within(footer()).getByRole('button', { name: 'In worktree…' }));
    const sheet = screen.getByRole('dialog', { name: 'New session in a worktree' });
    await act(async () => {
      fireEvent.input(within(sheet).getByLabelText('Branch and worktree name'), { target: { value: 'has space' } });
      await flush();
    });
    await click(within(sheet).getByRole('button', { name: 'Start session' }));
    expect(fake.host.startSession).not.toHaveBeenCalled();
    expect(sheet.textContent).toContain('Use letters, numbers, dots, dashes and slashes, with no spaces.');
    await act(async () => {
      fireEvent.input(within(sheet).getByLabelText('Branch and worktree name'), { target: { value: 'issue-x' } });
      fireEvent.input(within(sheet).getByLabelText('Start from'), { target: { value: ' develop ' } });
      await flush();
    });
    await click(within(sheet).getByRole('button', { name: 'Start session' }));
    expect(fake.host.startSession).toHaveBeenCalledWith(expect.objectContaining({ worktree: { kind: 'new', name: 'issue-x', baseBranch: 'develop' } }));
  });

  it('reports a failed start once, says the worktree was kept, and never tries again', async () => {
    const fake = await panel();
    fake.host.startSession.mockResolvedValueOnce({
      sessionId: null,
      sent: 'skipped',
      directory: '/p/a-wt',
      worktree: { directory: '/p/a-wt', name: 'issue-p-a1-title-p-a1', branch: 'issue-p-a1-title-p-a1', status: 'ready' },
      failure: 'bootstrap-failed',
    });
    await openBead('p-a1');
    await click(within(footer()).getByRole('button', { name: 'In worktree…' }));
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start session' }));
    await act(async () => {
      await flush();
    });
    expect(fake.host.startSession).toHaveBeenCalledTimes(1);
    expect(fake.host.attach).not.toHaveBeenCalled();
    expect(fake.host.toast).toHaveBeenCalledTimes(1);
    expect(fake.host.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        message: "The worktree issue-p-a1-title-p-a1 was made, but its setup didn't finish, so no session started. Open the worktree from the sidebar instead of starting again.",
        copy: { text: '/p/a-wt' },
      }),
    );
  });

  it('when OpenChamber gives up waiting, warns that a worktree may already exist', async () => {
    const fake = await panel();
    fake.host.startSession.mockRejectedValueOnce(new HostRequestError('HOST_TIMEOUT', 'timed out after 180000ms'));
    await openBead('p-a1');
    await click(within(footer()).getByRole('button', { name: 'In worktree…' }));
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start session' }));
    expect(fake.host.startSession).toHaveBeenCalledTimes(1);
    expect(fake.host.toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', message: "The session didn't start in time. A worktree may already exist: check the sidebar before trying again." }),
    );
  });

  it('stays quiet when OpenChamber refused the start and already said so', async () => {
    const fake = await panel();
    fake.host.startSession.mockRejectedValueOnce(new HostRequestError('HOST_REJECTED', 'Could not start that session.'));
    await openBead('p-a1');
    fake.host.toast.mockClear();
    await click(within(footer()).getByRole('button', { name: 'New session' }));
    expect(fake.host.startSession).toHaveBeenCalledTimes(1);
    expect(fake.host.toast).not.toHaveBeenCalled();
    expect(fake.host.attach).not.toHaveBeenCalled();
  });

  it('after a plain session times out, says it may still appear', async () => {
    const fake = await panel();
    fake.host.startSession.mockRejectedValueOnce(new HostRequestError('HOST_TIMEOUT', 'timed out after 180000ms'));
    await openBead('p-a1');
    await click(within(footer()).getByRole('button', { name: 'New session' }));
    expect(fake.host.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', message: "The session didn't start in time. It may still appear in the sidebar." }));
  });

  it('says why when the bead could not be read, and attaches nothing', async () => {
    const fake = await panel(service((c) => (c.route === 'context' ? envelope(503, { code: 'busy', message: 'Beads is busy. Try again in a moment.', detail: 'locked' }) : undefined)));
    await openBead('p-a1');
    await click(within(footer()).getByRole('button', { name: 'Current chat' }));
    expect(fake.host.attach).not.toHaveBeenCalled();
    expect(fake.host.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', message: "Couldn't read a1. Beads is busy. Try again in a moment.", copy: { text: 'locked' } }));
  });

  it('drops the action when the project changes while the bead is read', async () => {
    const gate = deferred<Answer>();
    const fake = await panel(service((c) => (c.route === 'context' ? gate.promise : undefined)));
    await openBead('p-a1');
    await click(within(footer()).getByRole('button', { name: 'New session' }));
    await act(async () => {
      fake.emit.directory('/p/b');
      gate.resolve(json(contextOf('p-a1')));
      await flush();
    });
    expect(fake.host.startSession).not.toHaveBeenCalled();
    expect(fake.host.attach).not.toHaveBeenCalled();
  });
});

describe('row menus', () => {
  it('list rows offer the same actions as the detail', async () => {
    const fake = await panel();
    await act(async () => {
      fireEvent.contextMenu(screen.getByText('Fix login timeout'));
      await flush();
    });
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Add to current chat', 'Start session', 'Start in worktree…', 'Copy ID']);
    await click(within(menu).getByRole('menuitem', { name: 'Start session' }));
    expect(fake.host.startSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-a1', navigation: 'open' }));
  });

  it('turns off Add to chat when no chat is open, saying why', async () => {
    await panel(service(), { session: null });
    await act(async () => {
      fireEvent.contextMenu(screen.getByText('Fix login timeout'));
      await flush();
    });
    const add = screen.getByRole('menuitem', { name: /Add to current chat/ }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.textContent).toContain('No open chat');
  });

  it('activity entries have the menu too', async () => {
    const activity = [{ id: 'e1', beadId: 'p-b2', kind: 'comment' as const, actor: 'Claude Code', byPanel: false, observedAt: iso(60_000), unseen: false }];
    const fake = await panel(service((c) => (c.route === 'snapshot' ? json({ ...live(), activity }) : undefined)));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
      await flush();
    });
    await act(async () => {
      fireEvent.contextMenu(screen.getByText('Port session tokens'));
      await flush();
    });
    const menu = screen.getByRole('menu', { name: 'Actions for p-b2' });
    await click(within(menu).getByRole('menuitem', { name: 'Add to current chat' }));
    expect(fake.host.attach).toHaveBeenCalledWith(attachPayload(contextOf('p-b2'), DIR));
    // The worktree confirmation opens from the activity menu as well.
    await act(async () => {
      fireEvent.contextMenu(screen.getByText('Port session tokens'));
      await flush();
    });
    await click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Start in worktree…' }));
    expect((screen.getByLabelText('Branch and worktree name') as HTMLInputElement).value).toBe('issue-p-b2-port-session-tokens');
  });
});

describe('chip click', () => {
  // With `attach: dialog` OpenChamber opens the attach dialog for a clicked chip (ChatInput, openGuestWithItem), never
  // the panel; the dialog shows the bead (see "opened from a chip" below). The panel does not listen for items.
  it('the panel ignores items', async () => {
    const fake = await panel(service(), { item: attachPayload(contextOf('p-b2'), DIR) });
    expect(screen.queryByRole('heading', { name: 'Port session tokens' })).toBeNull();
    expect(fake.host.toast).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------------------------------------- the + menu dialog

async function dialog(opts: Parameters<typeof host>[1] = {}, answer = service()) {
  const fake = host(answer, opts);
  const root = document.createElement('div');
  document.body.append(root);
  await act(async () => {
    disposers.push(mountAttachDialog(fake.host as unknown as PanelHost & { close(): Promise<void> }, root, { directory: opts.directory === undefined ? DIR : opts.directory, item: opts.item ?? null }, { visibility: alwaysVisible }));
    await flush();
  });
  return fake;
}

const search = () => screen.getByRole('combobox', { name: 'Search beads' });
const key = (k: string, extra: Partial<KeyboardEventInit> = {}) =>
  act(async () => {
    fireEvent.keyDown(search(), { key: k, ...extra });
    await flush();
  });

describe('attach dialog', () => {
  it('lists the beads, newest change first, with the highlighted one previewed beside them', async () => {
    await dialog();
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.getAttribute('data-id'))).toEqual(['p-a1', 'p-b2', 'p-b2.1', 'p-c3.1']);
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    const preview = screen.getByRole('region', { name: 'Preview' });
    expect(preview.textContent).toContain('Fix login timeout');
    expect(preview.querySelector('strong')?.textContent).toBe('5 minutes');
  });

  it('moves with the arrows and Ctrl+N / Ctrl+P, and filters as you type', async () => {
    await dialog();
    await key('ArrowDown');
    await key('n', { ctrlKey: true });
    expect(screen.getByRole('option', { selected: true }).getAttribute('data-id')).toBe('p-b2.1');
    await key('p', { ctrlKey: true });
    expect(screen.getByRole('option', { selected: true }).getAttribute('data-id')).toBe('p-b2');
    expect(screen.getByRole('region', { name: 'Preview' }).textContent).toContain('Port session tokens');
    await act(async () => {
      fireEvent.input(search(), { target: { value: 'refresh' } });
      await flush();
    });
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('data-id'))).toEqual(['p-b2.1']);
  });

  it('Enter attaches the highlighted bead, then closes', async () => {
    const fake = await dialog();
    await key('ArrowDown');
    await key('Enter');
    expect(fake.host.attach).toHaveBeenCalledTimes(1);
    expect(fake.host.attach).toHaveBeenCalledWith(attachPayload(contextOf('p-b2'), DIR));
    expect(fake.host.close).toHaveBeenCalledTimes(1);
  });

  it('keeps the highlighted bead when a refresh reorders the list, so Enter attaches the one shown', async () => {
    let reordered = false;
    const listeners = new Set<() => void>();
    let visible = true;
    const fake = host(
      service((c) => (c.route === 'snapshot' && reordered ? json(live(BEADS.map((b) => (b.id === 'p-b2' ? { ...b, updatedAt: iso(0) } : b)))) : undefined)),
    );
    const root = document.createElement('div');
    document.body.append(root);
    const visibility = { isVisible: () => visible, onChange: (l: () => void) => (listeners.add(l), () => listeners.delete(l)) };
    await act(async () => {
      disposers.push(mountAttachDialog(fake.host as unknown as PanelHost & { close(): Promise<void> }, root, { directory: DIR, item: null }, { visibility }));
      await flush();
    });
    expect(document.querySelector('[data-cursor]')?.getAttribute('data-id')).toBe('p-a1');
    // A poll brings p-b2 to the top.
    reordered = true;
    await act(async () => {
      visible = false;
      listeners.forEach((l) => l());
      visible = true;
      listeners.forEach((l) => l());
      await flush();
    });
    expect(document.querySelector('.bdp-row')?.getAttribute('data-id')).toBe('p-b2');
    expect(document.querySelector('[data-cursor]')?.getAttribute('data-id')).toBe('p-a1');
    await key('Enter');
    expect(fake.host.attach).toHaveBeenCalledWith(attachPayload(contextOf('p-a1'), DIR));
  });

  it('holds one chip per open: Shift+Enter picks nothing extra, and there are no check boxes or counts', async () => {
    const fake = await dialog();
    await key('Enter', { shiftKey: true });
    expect(fake.host.attach).not.toHaveBeenCalled();
    expect(document.querySelector('.bdp-check')).toBeNull();
    expect(screen.queryByText(/picked/)).toBeNull();
    expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBeNull();
    expect(screen.getByRole('button', { name: 'Attach' })).toBeTruthy();
    // The key hint promises only a single attach.
    expect(document.querySelector('.bdp-keys')?.textContent).not.toContain('pick more');
    await key('Enter');
    expect(fake.host.attach.mock.calls.map(([req]) => req.id)).toEqual(['p-a1']);
    expect(fake.host.close).toHaveBeenCalledTimes(1);
  });

  it('stays open and says which failed when nothing could be attached', async () => {
    const fake = await dialog({}, service((c) => (c.route === 'context' ? envelope(503, { code: 'busy', message: 'Beads is busy.' }) : undefined)));
    await key('Enter');
    expect(fake.host.close).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain("Couldn't attach a1. Beads is busy.");
  });

  it('opened from a chip, shows that bead', async () => {
    await dialog({ item: attachPayload(contextOf('p-b2'), DIR) });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Port session tokens' })).toBeTruthy();
  });

  it('with no project open, says so', async () => {
    await dialog({ directory: null });
    expect(screen.getByText('Open a project to pick beads.')).toBeTruthy();
  });
});
