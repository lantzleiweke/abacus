// Screenshots of preview scenarios with headless Chrome, at panel width. Needs `npm run preview` running.
// Reduced motion is forced, so a shot shows where a transition ends (virtual time can stop one halfway).
// Usage: node dev/capture.mjs <out-dir> <shot>[,<shot>...] [width] [height]
// A shot is a scenario id, or `<file name>=<scenario>&<more preview params>` (for example `filters=normal&do=filters`).
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [outDir, list, width = '380', height = '640'] = process.argv.slice(2);
if (!outDir || !list) {
  console.error('Usage: node dev/capture.mjs <out-dir> <scenario,...> [width] [height]');
  process.exit(1);
}
await mkdir(outDir, { recursive: true });
for (const shot of list.split(',')) {
  const [name, rest] = shot.includes('=') ? [shot.slice(0, shot.indexOf('=')), `scenario=${shot.slice(shot.indexOf('=') + 1)}`] : [shot, `scenario=${shot}`];
  for (const theme of ['light', 'dark']) {
    const file = resolve(join(outDir, `${name}-${theme}.png`));
    const url = `http://127.0.0.1:5199/dev/preview.html?bare=1&${rest}&theme=${theme}&width=${width}&height=${height}`;
    await run(CHROME, ['--headless=new', '--hide-scrollbars', '--force-prefers-reduced-motion', '--force-device-scale-factor=2', `--window-size=${width},${height}`, '--virtual-time-budget=2500', `--screenshot=${file}`, url]);
    console.log(file);
  }
}
