import { connectHost } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import { mountAttachDialog } from './ui/Picker';

const host = connectHost();
const root = document.getElementById('root')!;
let dispose: (() => void) | undefined;

// Opened from the + menu `ctx.item` is null and this is the picker; opened from a beads chip it shows that bead.
host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  dispose ??= mountAttachDialog(host, root, { directory: ctx.directory, item: ctx.item });
});

window.addEventListener('pagehide', () => {
  dispose?.();
  host.dispose();
});
