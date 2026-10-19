// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/preact';
import { HostRequestError, type SessionSnapshot, type StartSessionResult, type ToastRequest } from '@openchamber/sdk';
import { mountPanel, type PanelHost } from '../../../src/panel/ui/App';
import { mountAttachDialog } from '../../../src/panel/ui/Picker';
import type { WorkspaceState } from '../../../src/shared/types';
import { deferred, flush, json, snapshot, type Call } from './helpers';

const DIR = '/p/a';
const SESSION: SessionSnapshot = { id: 'ses_1', title: 'Fixing the login', busy: false };
const GUIDE = 'https://github.com/gastownhall/beads#-installation';

const INSTALL_REQUEST =
  'Please install Beads (the `bd` command) on this computer. On macOS use `brew install beads`; otherwise follow https://github.com/gastownhall/beads#-installation. Then run `bd --version` to confirm it works.';
const UPDATE_REQUEST =
  'Please update Beads (the `bd` command) on this computer. The Beads panel needs version 1.2.2 or newer, and this computer has 1.1.4. On macOS use `brew upgrade beads`; otherwise follow https://github.com/gastownhall/beads#-installation. Then run `bd --version` to confirm it works.';
const UPDATE_FOR_PROJECT_REQUEST =
  'Please update Beads (the `bd` command) on this computer. This project needs version 1.3.0 or newer, and this computer has 1.2.2. On macOS use `brew upgrade beads`; otherwise follow https://github.com/gastownhall/beads#-installation. Then run `bd --version` to confirm it works.';

function host(workspace: WorkspaceState, session: SessionSnapshot | null) {
  const calls: Call[] = [];
  const toasts: ToastRequest[] = [];
  const h = {
    serviceRequest: vi.fn(async ({ path, body }: { path: string; body?: string }) => {
      calls.push({ route: path.replace('/api/', '') as Call['route'], body: JSON.parse(body ?? '{}') });
      return json(snapshot({ workspace }));
    }),
    storage: { get: async () => undefined as never, set: async () => {}, delete: async () => {}, keys: async () => [] },
    toast: vi.fn(async (t: ToastRequest) => void toasts.push(t)),
    setBadge: vi.fn(async () => {}),
    writeClipboard: vi.fn(async (_text: string) => {}),
    openUrl: vi.fn(async (_url: string) => {}),
    attach: vi.fn(async () => {}),
    compose: vi.fn(async (_req: { text: string; mode?: 'append' | 'replace' }) => {}),
    // A host that could send: the panel must never call it.
    prompt: vi.fn(async () => ({ sent: true })),
    close: vi.fn(async () => {}),
    startSession: vi.fn(async (_req: unknown): Promise<StartSessionResult> => ({ sessionId: 'ses_new', sent: 'skipped', linked: true })),
    onDirectory(listener: (d: string | null) => void) {
      listener(DIR);
      return () => {};
    },
    onSession(listener: (s: SessionSnapshot | null) => void) {
      listener(session);
      return () => {};
    },
  };
  return { host: h, calls, toasts };
}

const disposers: Array<() => void> = [];
afterEach(() => {
  disposers.splice(0).forEach((d) => d());
  cleanup();
  document.body.innerHTML = '';
});

async function panel(workspace: WorkspaceState, session: SessionSnapshot | null = SESSION) {
  const fake = host(workspace, session);
  const root = document.createElement('div');
  document.body.append(root);
  await act(async () => {
    const mounted = mountPanel(fake.host as unknown as PanelHost, root, { visibility: { isVisible: () => true, onChange: () => () => {} } });
    disposers.push(mounted.dispose);
    await flush();
  });
  return fake;
}

const click = (el: Element) =>
  act(async () => {
    fireEvent.click(el);
    await flush();
  });

const button = (name: string) => screen.getByRole('button', { name });

describe('Beads is not installed', () => {
  it('asks the agent by putting the request on the open chat, never sending it', async () => {
    const { host: h, toasts } = await panel({ kind: 'no-bd' });
    expect(screen.getByText('Nothing is sent until you send it.')).toBeTruthy();
    await click(button('Ask the agent to install Beads'));
    expect(h.compose).toHaveBeenCalledTimes(1);
    expect(h.compose).toHaveBeenCalledWith({ text: INSTALL_REQUEST });
    expect(h.prompt).not.toHaveBeenCalled();
    expect(h.startSession).not.toHaveBeenCalled();
    expect(h.attach).not.toHaveBeenCalled();
    expect(toasts).toEqual([{ kind: 'success', message: 'The request is on the chat. Nothing is sent until you send it.' }]);
  });

  it('a second press while the request is on its way does nothing', async () => {
    const { host: h } = await panel({ kind: 'no-bd' });
    const gate = deferred<void>();
    h.compose.mockImplementationOnce(() => gate.promise);
    const ask = button('Ask the agent to install Beads');
    await click(ask);
    expect(ask.getAttribute('aria-busy')).toBe('true');
    await click(ask);
    await act(async () => {
      gate.resolve();
      await flush();
    });
    expect(h.compose).toHaveBeenCalledTimes(1);
    expect(ask.getAttribute('aria-busy')).toBe('false');
  });

  it('with no chat open, opens a new chat without sending anything, then puts the request on it', async () => {
    const { host: h, toasts } = await panel({ kind: 'no-bd' }, null);
    expect(screen.getByText('Opens a new chat. Nothing is sent until you send it.')).toBeTruthy();
    await click(button('Ask the agent to install Beads'));
    expect(h.startSession).toHaveBeenCalledWith({ providerId: 'beads', id: 'install-beads', title: 'Install Beads', url: GUIDE, navigation: 'open' });
    expect(h.startSession.mock.calls[0]![0]).not.toHaveProperty('text');
    expect(h.compose).toHaveBeenCalledWith({ text: INSTALL_REQUEST });
    expect(h.startSession.mock.invocationCallOrder[0]).toBeLessThan(h.compose.mock.invocationCallOrder[0]!);
    expect(h.prompt).not.toHaveBeenCalled();
    expect(toasts.at(-1)).toEqual({ kind: 'success', message: 'The request is on a new chat. Nothing is sent until you send it.' });
  });

  it('a second press after the new chat started goes to that chat, even before the host says it is open', async () => {
    const { host: h, toasts } = await panel({ kind: 'no-bd' }, null);
    await click(button('Ask the agent to install Beads'));
    expect(screen.getByText('Nothing is sent until you send it.')).toBeTruthy();
    await click(button('Ask the agent to install Beads'));
    expect(h.startSession).toHaveBeenCalledTimes(1);
    expect(h.compose).toHaveBeenCalledTimes(2);
    expect(toasts.at(-1)).toEqual({ kind: 'success', message: 'The request is on the chat. Nothing is sent until you send it.' });
  });

  it('presses while the new chat is starting start it once', async () => {
    const { host: h } = await panel({ kind: 'no-bd' }, null);
    const gate = deferred<StartSessionResult>();
    h.startSession.mockImplementationOnce(() => gate.promise);
    const ask = button('Ask the agent to install Beads');
    await click(ask);
    await click(ask);
    await act(async () => {
      gate.resolve({ sessionId: 'ses_new', sent: 'skipped', linked: true });
      await flush();
    });
    expect(h.startSession).toHaveBeenCalledTimes(1);
    expect(h.compose).toHaveBeenCalledTimes(1);
  });

  it('when the host answers that no chat was made, says so and puts nothing anywhere', async () => {
    const { host: h, toasts } = await panel({ kind: 'no-bd' }, null);
    h.startSession.mockResolvedValueOnce({
      sessionId: null,
      sent: 'skipped',
      directory: '/w/x',
      worktree: { directory: '/w/x', name: 'x', branch: 'x', status: 'ready' },
      failure: 'session-create-failed',
    } as StartSessionResult);
    await click(button('Ask the agent to install Beads'));
    expect(h.compose).not.toHaveBeenCalled();
    expect(toasts.at(-1)).toMatchObject({ kind: 'error', message: "The session couldn't be started." });
    expect(screen.getByText('Opens a new chat. Nothing is sent until you send it.')).toBeTruthy();
  });

  it('when the new chat does not start, says so and puts nothing anywhere', async () => {
    const { host: h, toasts } = await panel({ kind: 'no-bd' }, null);
    h.startSession.mockRejectedValueOnce(new HostRequestError('HOST_REJECTED', 'nope'));
    await click(button('Ask the agent to install Beads'));
    expect(h.compose).not.toHaveBeenCalled();
    expect(toasts.at(-1)?.kind).toBe('error');
    expect(toasts.at(-1)?.message).toMatch(/^The session couldn't be started\./);
  });

  it('when the chat refuses the text, offers the request on Copy instead', async () => {
    const { host: h, toasts } = await panel({ kind: 'no-bd' });
    h.compose.mockRejectedValueOnce(new HostRequestError('HOST_REJECTED', 'no composer'));
    await click(button('Ask the agent to install Beads'));
    expect(toasts.at(-1)).toMatchObject({ kind: 'error', copy: { text: INSTALL_REQUEST } });
    expect(toasts.at(-1)?.message).toMatch(/^Couldn't put the request on the chat\./);
  });

  it('copies the install command, once per press', async () => {
    const { host: h } = await panel({ kind: 'no-bd' });
    const gate = deferred<void>();
    h.writeClipboard.mockImplementationOnce(() => gate.promise);
    const copy = button('Copy install command');
    await click(copy);
    expect(copy.getAttribute('aria-busy')).toBe('true');
    await click(copy);
    await act(async () => {
      gate.resolve();
      await flush();
    });
    expect(h.writeClipboard).toHaveBeenCalledTimes(1);
    expect(h.writeClipboard).toHaveBeenCalledWith('brew install beads');
    expect(copy.getAttribute('aria-busy')).toBe('false');
  });

  it('opens the install guide, once per press', async () => {
    const { host: h } = await panel({ kind: 'no-bd' });
    const gate = deferred<void>();
    h.openUrl.mockImplementationOnce(() => gate.promise);
    const guide = button('Install guide');
    await click(guide);
    await click(guide);
    await act(async () => {
      gate.resolve();
      await flush();
    });
    expect(h.openUrl).toHaveBeenCalledTimes(1);
    expect(h.openUrl).toHaveBeenCalledWith(GUIDE);
  });

  it('Retry still re-detects the project', async () => {
    const { calls } = await panel({ kind: 'no-bd' });
    const before = calls.length;
    expect(calls.at(-1)?.body).not.toMatchObject({ refreshWorkspace: true });
    await click(button('Retry'));
    expect(calls.length).toBeGreaterThan(before);
    expect(calls.at(-1)).toMatchObject({ route: 'snapshot', body: { refreshWorkspace: true } });
  });

  it('shows plain words: no command names or em dashes on screen, and every name is its visible text', async () => {
    await panel({ kind: 'no-bd' });
    const section = document.querySelector('.bd-empty')!;
    expect(section.querySelector('.bd-empty-body')!.textContent).toBe(
      "Abacus needs Beads to read this project's issues. Ask the agent to install it, or install it yourself, then press Retry.",
    );
    expect(section.textContent).not.toMatch(/\bbd\b|brew|—/);
    for (const el of Array.from(section.querySelectorAll('button'))) {
      expect(el.getAttribute('type')).toBe('button');
      expect(el.hasAttribute('aria-label')).toBe(false);
    }
    expect(section.querySelector('form')).toBeNull();
  });
});

describe('Beads is too old', () => {
  it('asks the agent to update to the version the panel needs', async () => {
    const { host: h } = await panel({ kind: 'bd-too-old', bdVersion: '1.1.4' });
    expect(document.querySelector('.bd-empty-body')!.textContent).toBe(
      'The panel needs Beads 1.2.2 or newer, and this computer has 1.1.4. Ask the agent to update it, or update it yourself, then press Retry.',
    );
    await click(button('Ask the agent to update Beads'));
    expect(h.compose).toHaveBeenCalledWith({ text: UPDATE_REQUEST });
    expect(h.prompt).not.toHaveBeenCalled();
  });

  it('asks for the version the project was last opened with when that is newer', async () => {
    const { host: h } = await panel({ kind: 'bd-too-old', bdVersion: '1.2.2', lastOpenedWith: '1.3.0' });
    await click(button('Ask the agent to update Beads'));
    expect(h.compose).toHaveBeenCalledWith({ text: UPDATE_FOR_PROJECT_REQUEST });
  });

  it('with no chat open, the new chat is about updating Beads', async () => {
    const { host: h } = await panel({ kind: 'bd-too-old', bdVersion: '1.1.4' }, null);
    await click(button('Ask the agent to update Beads'));
    expect(h.startSession).toHaveBeenCalledWith({ providerId: 'beads', id: 'update-beads', title: 'Update Beads', url: GUIDE, navigation: 'open' });
    expect(h.startSession.mock.calls[0]![0]).not.toHaveProperty('text');
    expect(h.compose).toHaveBeenCalledWith({ text: UPDATE_REQUEST });
  });

  it('copies the update command, opens the guide, and keeps Retry', async () => {
    const { host: h, calls } = await panel({ kind: 'bd-too-old', bdVersion: '1.1.4' });
    await click(button('Copy update command'));
    expect(h.writeClipboard).toHaveBeenCalledWith('brew upgrade beads');
    await click(button('Install guide'));
    expect(h.openUrl).toHaveBeenCalledWith(GUIDE);
    await click(button('Retry'));
    expect(calls.at(-1)).toMatchObject({ route: 'snapshot', body: { refreshWorkspace: true } });
    expect(document.querySelector('.bd-empty')!.textContent).not.toMatch(/\bbd\b|brew|—/);
  });
});

describe('in the attach dialog, where there is no agent to ask', () => {
  async function dialog(workspace: WorkspaceState) {
    const fake = host(workspace, SESSION);
    const root = document.createElement('div');
    document.body.append(root);
    await act(async () => {
      disposers.push(mountAttachDialog(fake.host as unknown as PanelHost & { close(): Promise<void> }, root, { directory: DIR, item: null }, { visibility: { isVisible: () => true, onChange: () => () => {} } }));
      await flush();
    });
    return fake;
  }

  it('Beads missing: says to install it and that the panel can ask, with no Ask button', async () => {
    const { host: h } = await dialog({ kind: 'no-bd' });
    expect(document.querySelector('.bd-empty-body')!.textContent).toBe(
      "Abacus needs Beads to read this project's issues. Install it, then press Retry. The Abacus panel can ask the agent to install it for you.",
    );
    expect(screen.queryByRole('button', { name: /Ask the agent/ })).toBeNull();
    expect(document.querySelector('.bd-empty')!.textContent).not.toMatch(/Ask the agent|Nothing is sent/);
    await click(button('Copy install command'));
    expect(h.writeClipboard).toHaveBeenCalledWith('brew install beads');
    expect(button('Retry').className).toContain('bd-btn-primary');
  });

  it('Beads too old: says to update it and that the panel can ask', async () => {
    await dialog({ kind: 'bd-too-old', bdVersion: '1.1.4' });
    expect(document.querySelector('.bd-empty-body')!.textContent).toBe(
      'The panel needs Beads 1.2.2 or newer, and this computer has 1.1.4. Update it, then press Retry. The Abacus panel can ask the agent to update it for you.',
    );
    expect(screen.queryByRole('button', { name: /Ask the agent/ })).toBeNull();
  });
});
