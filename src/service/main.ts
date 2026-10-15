import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { RouteTable } from '../shared/api';
import type { ApiErrorCode, ErrorEnvelope } from '../shared/types';
import { follower } from './live';
import { createRoutes } from './routes';

/** Host request bodies are capped at 64,000 chars; reject anything larger. */
const MAX_BODY_CHARS = 64_000;
/** Hard read cap in bytes (4 bytes per char at most) so a huge upload is never buffered whole. */
const MAX_BODY_BYTES = MAX_BODY_CHARS * 4;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, json: unknown): void {
  // Stringify first: a value that cannot be serialized must fail before any header is written.
  const encoded = JSON.stringify(json);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(encoded);
}

function sendError(res: ServerResponse, status: number, code: ApiErrorCode, message: string): void {
  const envelope: ErrorEnvelope = { error: { code, message } };
  send(res, status, envelope);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buf.length;
    if (bytes > MAX_BODY_BYTES) throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large.');
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.length > MAX_BODY_CHARS) throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large.');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'Request body must be a JSON object.');
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new HttpError(400, 'BAD_REQUEST', 'Request body must be a JSON object.');
  }
  return value;
}

export function startServer(opts: { port: number; token: string; handlers: RouteTable }): Server {
  const { port, token, handlers } = opts;
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Missing or invalid service token.');
    }
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });

    const name = req.method === 'POST' && req.url?.startsWith('/api/') ? req.url.slice('/api/'.length) : '';
    const handler = Object.hasOwn(handlers, name) ? handlers[name] : undefined;
    if (!handler) return sendError(res, 404, 'NOT_FOUND', 'Route not found.');

    try {
      const body = await readJsonBody(req);
      const result = await handler(body);
      send(res, result.status, result.json);
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof HttpError) return sendError(res, err.status, err.code, err.message);
      const message = err instanceof Error ? err.message : 'Unexpected error.';
      sendError(res, 500, 'INTERNAL', message);
    }
  });
  server.listen(port, '127.0.0.1');
  return server;
}

/**
 * Ends the events followers, then the service. A listener for SIGTERM or SIGINT replaces Node's default exit, so it has to exit itself:
 * without that the service would ignore the host's stop request.
 */
export function installShutdown(proc: Pick<NodeJS.Process, 'on' | 'exit'> = process, stop: () => void = () => follower().stopAll()): void {
  const shutdown = () => {
    try {
      stop();
    } finally {
      proc.exit(0);
    }
  };
  proc.on('SIGTERM', shutdown);
  proc.on('SIGINT', shutdown);
  // A normal exit (the host closing the pipe, an uncaught error) still takes the children with it.
  proc.on('exit', () => {
    try {
      stop();
    } catch {
      // Nothing left to do at exit.
    }
  });
}

export function main(): void {
  const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
  const token = process.env.OPENCHAMBER_SERVICE_TOKEN;
  if (!Number.isInteger(port) || port <= 0 || !token) {
    process.stderr.write('OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required.\n');
    process.exit(1);
  }
  installShutdown();
  // Followers a crashed service left behind (their owner is gone and the command line still says `bd events tail`).
  follower().reapStale();
  startServer({ port, token, handlers: createRoutes() });
}

// The bundled service runs as the host's entry point; tests import startServer without starting it.
if (!process.env.VITEST) main();
