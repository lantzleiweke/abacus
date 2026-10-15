// Preview page: mounts the real panel against a fake host and service. `?scenario=<id>&theme=light|dark&bare=1`
// (bare hides the controls, for screenshots). `surface=dialog` mounts the + menu picker instead (`item=<bead id>`: as
// opened from that bead's chip); `chat=none` starts with no open chat; `start=<mode>` sets how starting a session
// answers; `sync=<mode>` sets where the last team sync left the project; `toasts=1` shows toasts over the frame in bare mode.
import { applyHostReady } from '@openchamber/sdk/ui';
import type { AttachIssueRequest, ToastRequest } from '@openchamber/sdk';
import { createClient } from '../src/panel/client';
import { resolveCommand } from '../src/panel/resolve';
import { mountPanel, type MountedPanel } from '../src/panel/ui/App';
import { mountAttachDialog } from '../src/panel/ui/Picker';
import { createFakeHost, PREVIEW_SESSION, START_MODES, type StartMode } from './fake-host';
import { createFakeService, directoryOf, SCENARIOS, SYNC_MODES, WRITE_MODES, type Paused, type ScenarioId, type SyncMode, type WriteMode } from './fake-service';

const params = new URLSearchParams(location.search);
const known = (id: string | null): id is ScenarioId => SCENARIOS.some((s) => s.id === id);
let scenario: ScenarioId = known(params.get('scenario')) ? (params.get('scenario') as ScenarioId) : 'normal';
let mode: 'light' | 'dark' = params.get('theme') === 'light' ? 'light' : 'dark';
// `write=<mode>` answers writes with that outcome; `paused=blocked|sync` pauses writes in the snapshot.
let writeMode: WriteMode = WRITE_MODES.some((m) => m.id === params.get('write')) ? (params.get('write') as WriteMode) : 'ok';
let paused: Paused = params.get('paused') === 'blocked' || params.get('paused') === 'sync' ? (params.get('paused') as Paused) : 'none';
// `sync=<mode>` is where the last sync left a project with a shared copy ("With team").
let syncMode: SyncMode = SYNC_MODES.some((m) => m.id === params.get('sync')) ? (params.get('sync') as SyncMode) : 'idle';
let startMode: StartMode = START_MODES.some((m) => m.id === params.get('start')) ? (params.get('start') as StartMode) : 'ok';
let chatOpen = params.get('chat') !== 'none';
const dialog = params.get('surface') === 'dialog';
if (params.get('bare') === '1') document.body.classList.add('bare');
// `width` and `height` (CSS px) size the panel frame, for checking other pane widths.
const size = (name: string) => (Number(params.get(name)) > 0 ? `${Number(params.get(name))}px` : null);

const frame = document.getElementById('frame')!;
const root = document.getElementById('root')!;
frame.style.width = size('width') ?? '';
frame.style.height = size('height') ?? '';
const controls = document.getElementById('controls')!;
const toasts = document.getElementById('toasts')!;
const badge = document.getElementById('badge')!;
const log = document.getElementById('log')!;
// Toasts over the frame, where OpenChamber shows them, for screenshots.
if (params.get('toasts') === '1') {
  document.body.classList.add('show-toasts');
  document.body.append(toasts);
}

/** A beads chip as the panel attaches it, for pretending a chip was clicked. */
const chipFor = (id: string, directory: string | null): AttachIssueRequest => ({
  providerId: 'beads',
  id,
  title: id,
  url: `https://beads.invalid/scratch/${id}`,
  kind: 'issue',
  data: { v: 1, directory: directory ?? '' },
});

function showToast(request: ToastRequest) {
  const el = document.createElement('div');
  el.className = `toast ${request.kind}`;
  el.textContent = request.message;
  if (request.copy) {
    const copy = document.createElement('button');
    copy.textContent = 'Copy';
    const text = typeof request.copy === 'object' ? request.copy.text : request.message;
    copy.onclick = () => {
      void navigator.clipboard?.writeText(text);
      el.remove();
    };
    el.append(copy);
  }
  toasts.prepend(el);
  setTimeout(() => el.remove(), 6000);
}

const host = createFakeHost(
  createFakeService({ beadWait: params.get('beadwait') === '1', writes: () => writeMode, paused: () => paused, sync: () => syncMode }),
  {
    onToast: showToast,
    onBadge: (count) => {
      badge.textContent = count === null ? 'badge: none' : `badge: ${count}`;
    },
    onLog: (text) => {
      log.textContent = `${text}\n${log.textContent ?? ''}`.slice(0, 2000);
    },
  },
  {
    mode,
    directory: directoryOf(scenario),
    session: chatOpen ? PREVIEW_SESSION : null,
    surface: dialog ? 'dialog' : 'panel',
    item: params.get('item') ? chipFor(params.get('item')!, directoryOf(scenario)) : null,
    startMode: () => startMode,
  },
);

// The real panel themes document.documentElement; here the frame stands in for it so the controls keep their own look.
host.onReady((ctx) => {
  applyHostReady(ctx, frame);
  document.body.dataset.theme = ctx.theme.mode;
});
let panel: MountedPanel | undefined;
const client = createClient(host);
// As main.tsx does: the `/bd` resolver answers from the panel's beads.
host.onResolve((request) => {
  const state = panel?.store.get();
  const known = state?.snapshot ? { directory: state.directory, ids: state.snapshot.beads.map((b) => b.id) } : null;
  return resolveCommand(request, { client, directory: state?.directory ?? directoryOf(scenario), known });
});
if (dialog) mountAttachDialog(host, root, { directory: directoryOf(scenario), item: params.get('item') ? chipFor(params.get('item')!, directoryOf(scenario)) : null });
else panel = mountPanel(host, root, { client });

function syncUrl() {
  const next = new URLSearchParams(location.search);
  next.set('scenario', scenario);
  next.set('theme', mode);
  next.set('write', writeMode);
  next.set('paused', paused);
  next.set('start', startMode);
  next.set('sync', syncMode);
  if (chatOpen) next.delete('chat');
  else next.set('chat', 'none');
  history.replaceState(null, '', `?${next}`);
}

function button(label: string, pressed: () => boolean, onClick: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  const paint = () => b.setAttribute('aria-pressed', String(pressed()));
  b.onclick = () => {
    onClick();
    controls.querySelectorAll('button').forEach((x) => x.dispatchEvent(new Event('repaint')));
  };
  b.addEventListener('repaint', paint);
  paint();
  return b;
}

function group(title: string, items: HTMLButtonElement[]) {
  const g = document.createElement('div');
  g.className = 'group';
  const h = document.createElement('div');
  h.className = 'group-title';
  h.textContent = title;
  g.append(h, ...items);
  controls.append(g);
}

group('Theme', [
  button('Dark', () => mode === 'dark', () => {
    mode = 'dark';
    host.emitReady({ mode });
    syncUrl();
  }),
  button('Light', () => mode === 'light', () => {
    mode = 'light';
    host.emitReady({ mode });
    syncUrl();
  }),
]);

for (const name of ['Data', 'Empty states'] as const) {
  group(
    name,
    SCENARIOS.filter((s) => s.group === name).map((s) =>
      button(s.label, () => scenario === s.id, () => {
        scenario = s.id;
        host.emitDirectory(directoryOf(s.id));
        syncUrl();
      }),
    ),
  );
}

group(
  'Writes answer',
  WRITE_MODES.map((m) =>
    button(m.label, () => writeMode === m.id, () => {
      writeMode = m.id;
      syncUrl();
    }),
  ),
);

group(
  'Writes paused',
  (
    [
      ['none', 'No'],
      ['blocked', 'Half merged'],
      ['sync', 'Sync running'],
    ] as Array<[Paused, string]>
  ).map(([id, label]) =>
    button(label, () => paused === id, () => {
      paused = id;
      syncUrl();
    }),
  ),
);

group(
  'Team sync (With team)',
  SYNC_MODES.map((m) =>
    button(m.label, () => syncMode === m.id, () => {
      syncMode = m.id;
      syncUrl();
    }),
  ),
);

group('Chat', [
  button('Open chat', () => chatOpen, () => {
    chatOpen = true;
    host.emitSession(PREVIEW_SESSION);
    syncUrl();
  }),
  button('No open chat', () => !chatOpen, () => {
    chatOpen = false;
    host.emitSession(null);
    syncUrl();
  }),
]);

group(
  'Start session answers',
  START_MODES.map((m) =>
    button(m.label, () => startMode === m.id, () => {
      startMode = m.id;
      syncUrl();
    }),
  ),
);

{
  const field = document.createElement('input');
  field.placeholder = '/bd <id>';
  field.style.cssText = 'height:24px;width:120px;padding:0 6px;border:1px solid var(--chrome-line);border-radius:6px;background:var(--chrome-btn);color:inherit;font:inherit';
  field.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    host
      .resolve('bd', field.value.replace(/^\/?bd\s*/, ''))
      .then((chip) => log.prepend(`resolve → ${chip ? `chip ${chip.id} (${chip.text?.length ?? 0} chars)` : 'null'}\n`))
      .catch((error: Error) => showToast({ kind: 'error', message: error.message }));
  };
  // A clicked chip opens the dialog, not the panel: see it with `surface=dialog&item=<bead id>`.
  group('Chat box', [field as unknown as HTMLButtonElement]);
}

// `do=` drives the panel after the list appears, for screenshots of interactive states. Steps are separated by |:
// `view:status`, `filters`, `q:<text>`, `keys:<keys>` (j, k, e for Enter), `menu:<bead id>`, `scroll:bottom`,
// `open:<bead id>` (clicks its row), `click:<css selector>`, `back`, `dscroll:<px|bottom>` (scrolls the detail),
// `type:<css selector>=><text>` (types into a field; `\n` is a line break), `press:<Shift+Enter>` (a key to the focused
// element).
const steps = (params.get('do') ?? '').split('|').filter(Boolean);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits up to 6 s for `selector`; a cold headless start can take seconds before the first answer paints. */
async function waitFor(selector: string): Promise<HTMLElement | null> {
  for (let i = 0; i < 120; i++) {
    const el = root.querySelector<HTMLElement>(selector);
    if (el) return el;
    await pause(50);
  }
  return null;
}

async function drive() {
  await waitFor(dialog ? '.bdp, .bd-empty' : '.bd-list');
  // The picker focuses its search box just after it paints; keys sent before that would be lost.
  if (dialog) await pause(200);
  for (const step of steps) {
    const [name, arg = ''] = step.split(/:(.*)/s);
    if (name === 'view') root.querySelector<HTMLButtonElement>(`.bd-seg button:nth-child(${['epic', 'status', 'activity'].indexOf(arg) + 1})`)?.click();
    if (name === 'filters') root.querySelector<HTMLButtonElement>('button[aria-label="Filters"]')?.click();
    if (name === 'q') {
      const input = root.querySelector<HTMLInputElement>('.bd-search input')!;
      input.focus();
      input.value = arg;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (name === 'keys') {
      for (const k of arg) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: k === 'e' ? 'Enter' : k, bubbles: true, cancelable: true }));
        await pause(20);
      }
    }
    if (name === 'scroll') {
      const body = root.querySelector<HTMLElement>('.bd-body');
      if (body) body.scrollTop = arg === 'bottom' ? body.scrollHeight : 0;
    }
    if (name === 'open') (await waitFor(`#${CSS.escape(`bd-row-${arg}`)}`))?.click();
    if (name === 'click') (await waitFor(arg))?.click();
    if (name === 'back') (await waitFor('button[aria-label="Back"]'))?.click();
    if (name === 'type') {
      const at = arg.indexOf('=>');
      const field = (await waitFor(arg.slice(0, at))) as HTMLInputElement | HTMLTextAreaElement | null;
      if (field) {
        field.focus();
        field.value = arg.slice(at + 2).replace(/\\n/g, '\n');
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    if (name === 'dscroll') {
      const body = await waitFor('.bd-dbody');
      if (body) body.scrollTop = arg === 'bottom' ? body.scrollHeight : Number(arg);
    }
    // `press:<key>` with optional Shift+ / Ctrl+ prefixes, sent to whatever has focus (the picker's search box).
    if (name === 'press') {
      // A `+` in the URL arrives as a space.
      const parts = arg.split(/[+ ]/);
      const key = parts.pop()!;
      (document.activeElement ?? document).dispatchEvent(
        new KeyboardEvent('keydown', { key, shiftKey: parts.includes('Shift'), ctrlKey: parts.includes('Ctrl'), bubbles: true, cancelable: true }),
      );
    }
    if (name === 'menu') {
      const row = document.getElementById(`bd-row-${arg}`);
      const r = row?.querySelector('.bd-title')?.getBoundingClientRect();
      row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: (r?.left ?? 0) + 40, clientY: (r?.bottom ?? 0) - 4 }));
    }
    await pause(80);
  }
}
if (steps.length) void drive();
