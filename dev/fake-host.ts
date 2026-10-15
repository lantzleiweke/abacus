// A HostClient for the preview page: the subset the panel uses, backed by the fake service and an in-memory store.
import { HostRequestError, type AttachIssueRequest, type GuestItem, type HostClient, type HostReadyContext, type HostThemeTokens, type SessionSnapshot, type StartSessionRequest, type StartSessionResult, type ToastRequest } from '@openchamber/sdk';
import type { ApiRouteName } from '../src/shared/api';
import type { FakeService } from './fake-service';

const FONT = '"SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const MONO = 'ui-monospace, "SFMono-Regular", "Menlo", "Cascadia Mono", "Segoe UI Mono", monospace';

/** OpenChamber's default theme (Flexoki), as PluginPane.tsx hands it to guests. Text tokens approximate the host's readable-color pass. */
export const THEMES: Record<'light' | 'dark', HostThemeTokens> = {
  dark: {
    background: '#171515',
    elevated: '#201e1e',
    foreground: '#dedcd3',
    muted: '#96958e',
    subtle: '#1e1d1c',
    border: '#2b2a28d4',
    hover: '#ffffff0f',
    selection: '#f4f4f41f',
    focus: '#DA702C50',
    primary: '#DA702C',
    mutedSurface: '#121111',
    elevatedForeground: '#dedcd3',
    active: '#ffffff1a',
    selectionForeground: '#dedcd3',
    primaryForeground: '#171515',
    primaryText: '#e8925a',
    successText: '#a0af54',
    warningText: '#e8925a',
    errorText: '#e07a70',
    infoText: '#6fa3d2',
    success: '#A0AF54',
    warning: '#DA702C',
    error: '#d76459',
    info: '#4d8cc1',
    font: FONT,
    mono: MONO,
    radius: '0.5625rem',
  },
  light: {
    background: '#fffdf4',
    elevated: '#f5f3ea',
    foreground: '#494741',
    muted: '#6a6962',
    subtle: '#f7f4ec',
    border: '#e6e4db',
    hover: '#0000000a',
    selection: '#76736f30',
    focus: '#b54f1440',
    primary: '#b54f14',
    mutedSurface: '#f9f7ee',
    elevatedForeground: '#494741',
    active: '#00000014',
    selectionForeground: '#494741',
    primaryForeground: '#fffdf4',
    primaryText: '#a74912',
    successText: '#5e760a',
    warningText: '#a74912',
    errorText: '#AF3029',
    infoText: '#205EA6',
    success: '#5e760a',
    warning: '#b54f14',
    error: '#AF3029',
    info: '#205EA6',
    font: FONT,
    mono: MONO,
    radius: '0.5625rem',
  },
};

/** How the preview answers `startSession`: as OpenChamber would, or with one of the outcomes the panel must handle. */
export type StartMode = 'ok' | 'unlinked' | 'bootstrap-failed' | 'session-create-failed' | 'timeout' | 'slow';
export const START_MODES: Array<{ id: StartMode; label: string }> = [
  { id: 'ok', label: 'Starts' },
  { id: 'slow', label: 'Slow' },
  { id: 'unlinked', label: 'Not linked' },
  { id: 'bootstrap-failed', label: 'Setup failed' },
  { id: 'session-create-failed', label: 'Create failed' },
  { id: 'timeout', label: 'Times out' },
];

export const PREVIEW_SESSION: SessionSnapshot = { id: 'ses_preview', title: 'Fix the login timeout', busy: false };

export type FakeHost = HostClient & {
  /** Sends a new ready context (theme and directory), as the host does on theme change or reconnect. */
  emitReady(next: { mode?: 'light' | 'dark'; directory?: string | null }): void;
  /** Sends a directory change. */
  emitDirectory(directory: string | null): void;
  /** Opens or closes the chat (null: no open chat). */
  emitSession(session: SessionSnapshot | null): void;
  /** Runs the `/bd` resolver the panel registered. */
  resolve(command: string, args: string): Promise<AttachIssueRequest | null>;
};

export type FakeHostEvents = {
  onToast(request: ToastRequest): void;
  onBadge(count: number | null): void;
  onLog(text: string): void;
};

export type FakeHostInitial = {
  mode: 'light' | 'dark';
  directory: string | null;
  session?: SessionSnapshot | null;
  surface?: 'panel' | 'dialog';
  item?: GuestItem | null;
  startMode?: () => StartMode;
};

export function createFakeHost(service: FakeService, events: FakeHostEvents, initial: FakeHostInitial): FakeHost {
  let ready: HostReadyContext = {
    theme: { mode: initial.mode, tokens: THEMES[initial.mode] },
    locale: 'en-US',
    directory: initial.directory,
    session: initial.session === undefined ? PREVIEW_SESSION : initial.session,
    surface: initial.surface ?? 'panel',
    connection: { connected: true, account: '' },
    settings: {},
    item: initial.item ?? null,
  };
  const startMode = initial.startMode ?? (() => 'ok' as StartMode);
  const readyListeners = new Set<(ctx: HostReadyContext) => void>();
  const directoryListeners = new Set<(directory: string | null) => void>();
  const itemListeners = new Set<(item: GuestItem | null) => void>();
  const sessionListeners = new Set<(session: SessionSnapshot | null) => void>();
  const stored = new Map<string, unknown>();
  let resolver: ((req: { command: string; args: string }) => unknown) | null = null;
  const on = <T>(set: Set<T>, listener: T, replay?: () => void) => {
    set.add(listener);
    replay?.();
    return () => void set.delete(listener);
  };
  const log = (text: string) => events.onLog(text);
  const attachLike = (name: string) => async (req: AttachIssueRequest) => {
    log(`${name}(${req.id}, ${req.text?.length ?? 0} chars of context)`);
  };

  const host = {
    onReady: (listener: (ctx: HostReadyContext) => void) => on(readyListeners, listener, () => listener(ready)),
    onDirectory: (listener: (directory: string | null) => void) => on(directoryListeners, listener, () => listener(ready.directory)),
    onItem: (listener: (item: GuestItem | null) => void) => on(itemListeners, listener, () => listener(ready.item)),
    onSession: (listener: (session: SessionSnapshot | null) => void) => on(sessionListeners, listener, () => listener(ready.session)),
    onResolve: (handler: typeof resolver) => {
      resolver = handler;
      return () => {
        resolver = null;
      };
    },
    async serviceRequest({ path, body }: { path: string; body?: string }) {
      const route = path.replace(/^\/api\//, '') as ApiRouteName;
      return service.handle(route, JSON.parse(body ?? '{}'));
    },
    storage: {
      get: async (key: string) => stored.get(key),
      set: async (key: string, value: unknown) => {
        stored.set(key, structuredClone(value));
      },
      delete: async (key: string) => {
        stored.delete(key);
      },
      keys: async () => [...stored.keys()],
    },
    async setBadge(count: number | null) {
      events.onBadge(count);
    },
    async toast(request: ToastRequest) {
      events.onToast(request);
    },
    attach: attachLike('attach'),
    sessionLink: attachLike('sessionLink'),
    async startSession(req: StartSessionRequest): Promise<StartSessionResult> {
      const wt = req.worktree && req.worktree !== true && req.worktree.kind === 'new' ? req.worktree : null;
      log(`startSession(${req.id}${wt ? `, worktree ${wt.name}${wt.baseBranch ? ` from ${wt.baseBranch}` : ''}` : ''}, text: ${req.text === undefined ? 'none' : 'yes'})`);
      const mode = startMode();
      const name = wt?.name ?? `issue-${req.id}`;
      const worktree = { directory: `/Users/preview/worktrees/${name}`, name, branch: name, status: 'ready' as const };
      await new Promise((r) => setTimeout(r, mode === 'slow' ? 60_000 : 400));
      if (mode === 'timeout') throw new HostRequestError('HOST_TIMEOUT', 'The host did not answer within 180000 ms.');
      if (mode === 'bootstrap-failed' || mode === 'session-create-failed') return { sessionId: null, sent: 'skipped', directory: worktree.directory, worktree, failure: mode };
      // OpenChamber says this itself when a session starts.
      events.onToast({ kind: 'success', message: 'Session created' });
      return { sessionId: 'ses_new', sent: 'skipped', ...(wt ? { directory: worktree.directory, worktree } : {}), linked: mode !== 'unlinked' };
    },
    async close() {
      log('close()');
    },
    async openUrl(url: string) {
      log(`openUrl(${url})`);
    },
    async writeClipboard(text: string) {
      log(`writeClipboard(${text.length} chars)`);
    },
    dispose() {},
    emitReady(next: { mode?: 'light' | 'dark'; directory?: string | null }) {
      const mode = next.mode ?? ready.theme.mode;
      ready = { ...ready, theme: { mode, tokens: THEMES[mode] }, ...(next.directory !== undefined ? { directory: next.directory } : {}) };
      readyListeners.forEach((l) => l(ready));
      directoryListeners.forEach((l) => l(ready.directory));
    },
    emitDirectory(directory: string | null) {
      ready = { ...ready, directory };
      directoryListeners.forEach((l) => l(directory));
    },
    emitSession(session: SessionSnapshot | null) {
      ready = { ...ready, session };
      sessionListeners.forEach((l) => l(session));
    },
    async resolve(command: string, args: string) {
      return resolver?.({ command, args }) ?? null;
    },
  };
  return host as unknown as FakeHost;
}
