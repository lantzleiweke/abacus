import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { installShutdown, startServer } from '../../../src/service/main';
import type { RouteTable } from '../../../src/shared/api';

const TOKEN = 'secret-token';
let server: Server | undefined;

async function boot(handlers: RouteTable): Promise<string> {
  server = startServer({ port: 0, token: TOKEN, handlers });
  await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

const auth = { authorization: `Bearer ${TOKEN}` };

afterEach(async () => {
  const s = server;
  server = undefined;
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
});

describe('service http', () => {
  it('rejects GET /health without a token', async () => {
    const base = await boot({});
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a wrong token', async () => {
    const base = await boot({});
    const res = await fetch(`${base}/health`, { headers: { authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  it('answers GET /health with a token', async () => {
    const base = await boot({});
    const res = await fetch(`${base}/health`, { headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns a 404 envelope for unknown routes', async () => {
    const base = await boot({});
    const res = await fetch(`${base}/api/missing`, { method: 'POST', headers: auth, body: '{}' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route not found.' },
    });
  });

  it('routes POST /api/<name> to the handler with the parsed body', async () => {
    const base = await boot({
      echo: async (body) => ({ status: 200, json: { got: body } }),
    });
    const res = await fetch(`${base}/api/echo`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ a: 1 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ got: { a: 1 } });
  });

  it('returns a 500 envelope with the message and no stack when a handler throws', async () => {
    const base = await boot({
      boom: async () => {
        throw new Error('kaboom');
      },
    });
    const res = await fetch(`${base}/api/boom`, { method: 'POST', headers: auth, body: '{}' });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: { code: 'INTERNAL', message: 'kaboom' } });
    expect(text).not.toContain('at ');
  });

  it('returns a 500 envelope when a handler result cannot be serialized', async () => {
    const base = await boot({
      big: async () => ({ status: 200, json: { n: 1n } }),
    });
    const res = await fetch(`${base}/api/big`, { method: 'POST', headers: auth, body: '{}' });
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('INTERNAL');
    const health = await fetch(`${base}/health`, { headers: auth });
    expect(health.status).toBe(200);
  });

  it('returns 400 for a body that is not a JSON object', async () => {
    const base = await boot({ echo: async (b) => ({ status: 200, json: b }) });
    const res = await fetch(`${base}/api/echo`, { method: 'POST', headers: auth, body: '[1]' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('BAD_REQUEST');
  });

  it('returns 413 when the body exceeds 64,000 chars', async () => {
    const base = await boot({ echo: async (b) => ({ status: 200, json: b }) });
    const res = await fetch(`${base}/api/echo`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ text: 'x'.repeat(64_001) }),
    });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe('BODY_TOO_LARGE');
  });
});

describe('shutdown', () => {
  it('stops the followers, then exits, on SIGTERM and SIGINT', () => {
    const handlers = new Map<string, () => void>();
    const exits: number[] = [];
    const stops: string[] = [];
    installShutdown(
      {
        on: ((event: string, handler: () => void) => {
          handlers.set(event, handler);
          return process;
        }) as never,
        exit: ((code?: number) => {
          stops.push('exit');
          exits.push(code ?? 0);
        }) as never,
      },
      () => stops.push('stop'),
    );
    handlers.get('SIGTERM')!();
    handlers.get('SIGINT')!();
    expect(stops).toEqual(['stop', 'exit', 'stop', 'exit']);
    expect(exits).toEqual([0, 0]);
    // A normal exit stops the followers too, and does not exit again.
    handlers.get('exit')!();
    expect(stops.at(-1)).toBe('stop');
    expect(exits).toHaveLength(2);
  });

  it('still exits if stopping the followers throws', () => {
    const handlers = new Map<string, () => void>();
    let exited = false;
    installShutdown(
      { on: ((event: string, handler: () => void) => handlers.set(event, handler)) as never, exit: (() => (exited = true)) as never },
      () => {
        throw new Error('boom');
      },
    );
    expect(() => handlers.get('SIGTERM')!()).toThrow('boom');
    expect(exited).toBe(true);
  });

  it('service still exits on SIGTERM', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oc-beads-main-'));
    try {
      const bundle = join(dir, 'main.cjs');
      await build({ entryPoints: [join(process.cwd(), 'src/service/main.ts')], bundle: true, format: 'cjs', platform: 'node', target: 'node20', outfile: bundle, logLevel: 'silent' });
      const port = 20_000 + Math.floor(Math.random() * 20_000);
      const env: NodeJS.ProcessEnv = { ...process.env, OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: 'tok', XDG_DATA_HOME: join(dir, 'data') };
      for (const key of Object.keys(env)) if (key.startsWith('VITEST')) delete env[key];
      const child = spawn(process.execPath, [bundle], { env, stdio: 'ignore' });
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
      // Up when /health answers.
      let up = false;
      for (let i = 0; i < 50 && !up; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
        up = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: 'Bearer tok' } }).then((r) => r.ok, () => false);
      }
      expect(up).toBe(true);
      child.kill('SIGTERM');
      const result = await Promise.race([exited, new Promise<'hung'>((r) => setTimeout(() => r('hung'), 5_000))]);
      if (result === 'hung') child.kill('SIGKILL');
      expect(result).toEqual({ code: 0, signal: null });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
