// Tiny static server for the preview: serves dev/ and panel/ from the package root on http://127.0.0.1:5199.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ALLOWED = ['dev', 'panel'];
const PORT = Number(process.env.PORT ?? 5199);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

createServer(async (req, res) => {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (path === '/') {
    res.writeHead(302, { location: '/dev/preview.html' }).end();
    return;
  }
  const file = normalize(join(ROOT, path));
  const top = file.slice(ROOT.length).split(sep).filter(Boolean)[0];
  if (!file.startsWith(ROOT) || !ALLOWED.includes(top)) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Abacus preview: http://127.0.0.1:${PORT}/dev/preview.html`);
});
