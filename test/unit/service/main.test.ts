import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../../../src/service/main';
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
