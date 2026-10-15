import { connectHost } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import { createClient } from './client';
import { resolveCommand } from './resolve';
import { mountPanel, type MountedPanel } from './ui/App';

const host = connectHost();
const client = createClient(host);
const root = document.getElementById('root')!;
let panel: MountedPanel | undefined;
let directory: string | null = null;

// `/bd <id>`: registered right after connecting, as the host may ask before the panel is shown. It returns the chip;
// the host attaches it.
host.onResolve((request) => {
  const state = panel?.store.get();
  const known = state?.snapshot ? { directory: state.directory, ids: state.snapshot.beads.map((b) => b.id) } : null;
  return resolveCommand(request, { client, directory: state?.directory ?? directory, known });
});
host.onDirectory((next) => {
  directory = next;
});

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  directory = ctx.directory;
  panel ??= mountPanel(host, root, { client });
});

window.addEventListener('pagehide', () => {
  panel?.dispose();
  host.dispose();
});
