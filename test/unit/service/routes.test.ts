import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WriteError } from '../../../src/service/bd/adapter';
import { BdError } from '../../../src/service/bd/exec';
import { startServer } from '../../../src/service/main';
import { createRoutes, rulesFrom, type RouteDeps } from '../../../src/service/routes';
import type { ApiErrorEnvelope } from '../../../src/shared/api';
import type { Bead, SyncState, WorkspaceState, WriteResult } from '../../../src/shared/types';

const TOKEN = 'secret-token';
const T0 = '2026-10-14T10:00:00Z';

function bead(id: string, over: Partial<Bead> = {}): Bead {
  return {
    id, title: `Title ${id}`, status: 'open', priority: 2, type: 'task', assignee: null, labels: [], parentId: null,
    description: '', design: '', acceptance: '', notes: '', createdAt: T0, createdBy: null, updatedAt: T0, closedAt: null,
    closeReason: null, dependencies: [], comments: [], extra: {}, ...over,
  };
}

let dir: string;
let root: string;
/** What the panel sends as `directory`: a folder inside the project. The routes must act on the resolved root instead. */
let sub: string;
let server: Server | undefined;
let workspace: WorkspaceState;
let beads: Bead[] | null;
let sync: SyncState;
let blocked: boolean;
let log: string[];
let deps: RouteDeps;
let storeState: { unseen: string[]; deletions: string[] };

const provider = {
  update: vi.fn(),
  create: vi.fn(),
  comment: vi.fn(),
  dependency: vi.fn(),
};
const store = {
  markSeen: vi.fn(),
  save: vi.fn(),
  unseenIds: vi.fn(),
  unseenDeletionIds: vi.fn(),
  confirmFirstContact: vi.fn(),
  firstContactConfirmedFor: vi.fn(),
  restoreFirstContact: vi.fn(),
};

function okWorkspace(over: Partial<Extract<WorkspaceState, { kind: 'ok' }>> = {}): WorkspaceState {
  return { kind: 'ok', root, mode: 'embedded', bdVersion: '1.2.2', hasRemote: true, projectName: 'demo', ...over };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'beads-routes-'));
  root = join(dir, 'demo');
  sub = join(root, 'sub');
  await mkdir(sub, { recursive: true });
  workspace = okWorkspace();
  beads = [bead('a'), bead('b', { parentId: 'a' })];
  sync = { kind: 'idle' };
  blocked = false;
  log = [];
  storeState = { unseen: ['a'], deletions: ['gone'] };
  for (const fn of [...Object.values(provider), ...Object.values(store)]) fn.mockReset();
  store.unseenIds.mockImplementation(() => storeState.unseen);
  store.unseenDeletionIds.mockImplementation(() => storeState.deletions);
  store.save.mockResolvedValue(undefined);
  store.firstContactConfirmedFor.mockReturnValue(null);
  provider.update.mockResolvedValue({ ok: true, bead: bead('a', { title: 'New' }) } satisfies WriteResult);
  provider.create.mockResolvedValue(bead('new'));
  provider.comment.mockResolvedValue({ id: 'c1', author: 'x', text: 'hi', createdAt: T0 });
  provider.dependency.mockResolvedValue(undefined);

  deps = {
    resolveWorkspace: vi.fn(async (directory: string, opts?: { refreshWorkspace?: boolean }) => {
      log.push(`resolve:${directory}:${opts?.refreshWorkspace ?? false}`);
      return { workspace, root: workspace.kind === 'ok' ? workspace.root : null };
    }),
    getSnapshot: vi.fn(async (directory: string, cursor?: string, refresh?: boolean) => {
      log.push(`snapshot:${cursor ?? ''}:${refresh ?? false}`);
      return { unchanged: true as const, cursor: 'c', freshness: { localRefreshedAt: null, localError: null, localErrorDetail: null, teamSyncedAt: null, unpublished: null }, sync };
    }),
    projectStore: vi.fn(async () => store as never),
    providerFor: vi.fn(() => provider as never),
    cachedBeads: vi.fn(() => beads),
    panelActor: vi.fn(async () => 'Ann (panel)'),
    preview: vi.fn(async () => ({ head: 'aaaa1111', changes: [], total: 0 })),
    localHead: vi.fn(async () => 'aaaa1111'),
    startPull: vi.fn(() => ({ kind: 'running', op: 'pull', startedAt: T0 }) as SyncState),
    startPublish: vi.fn(() => ({ kind: 'running', op: 'publish', startedAt: T0 }) as SyncState),
    syncState: vi.fn(() => sync),
    writesBlocked: vi.fn(() => blocked),
    checkHalfMerge: vi.fn(async () => undefined),
    beadUrl: vi.fn(async (r: string, project: string, id: string) => `https://example.com/${project}?bead=${id}`),
  };
});

afterEach(async () => {
  const s = server;
  server = undefined;
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

async function call(name: string, body: Record<string, unknown> = {}, withDirectory = true): Promise<{ status: number; json: any }> {
  if (!server) {
    server = startServer({ port: 0, token: TOKEN, handlers: createRoutes(deps) });
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
  }
  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/api/${name}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(withDirectory ? { directory: sub, ...body } : body),
  });
  return { status: res.status, json: await res.json() };
}

const errorOf = (json: ApiErrorEnvelope) => json.error;

describe('validation', () => {
  it('rejects a missing, relative or nonexistent directory', async () => {
    for (const directory of [undefined, 42, 'relative/dir', join(dir, 'nope')]) {
      const res = await call('snapshot', { directory }, false);
      expect(res.status).toBe(400);
      expect(errorOf(res.json).code).toBe('BAD_REQUEST');
    }
    expect(deps.resolveWorkspace).not.toHaveBeenCalled();
  });

  it('rejects a bad directory on a write route before touching anything', async () => {
    for (const directory of [undefined, 'relative/dir', join(dir, 'nope')]) {
      const res = await call('update', { directory, id: 'a', expectedUpdatedAt: T0, patch: { title: 'x' } }, false);
      expect(res.status).toBe(400);
      expect(errorOf(res.json).code).toBe('BAD_REQUEST');
    }
    expect(deps.resolveWorkspace).not.toHaveBeenCalled();
    expect(deps.writesBlocked).not.toHaveBeenCalled();
    expect(provider.update).not.toHaveBeenCalled();
  });

  it('rejects a directory that is a file', async () => {
    const file = join(dir, 'file.txt');
    await writeFile(file, 'x');
    const res = await call('snapshot', { directory: file }, false);
    expect(res.status).toBe(400);
  });

  it('rejects bad bead ids on every route that takes one', async () => {
    const bad = ['', 'a b', 'a/b', '../x', 'x'.repeat(129), 'a;rm', 7];
    for (const id of bad) {
      for (const [name, body] of [
        ['bead', { id }],
        ['context', { id }],
        ['update', { id, expectedUpdatedAt: T0, patch: {} }],
        ['comment', { id, text: 'hi' }],
        ['dependency', { op: 'add', from: id, to: 'b', kind: 'blocks' }],
        ['dependency', { op: 'add', from: 'a', to: id, kind: 'blocks' }],
        ['seen', { ids: [id] }],
      ] as const) {
        const res = await call(name, body);
        expect(res.status, `${name} ${String(id)}`).toBe(400);
        expect(errorOf(res.json).code).toBe('BAD_REQUEST');
      }
    }
    expect(provider.update).not.toHaveBeenCalled();
    expect(provider.comment).not.toHaveBeenCalled();
    expect(provider.dependency).not.toHaveBeenCalled();
  });

  it('rejects malformed fields', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['update', { id: 'a', patch: {} }],
      ['update', { id: 'a', expectedUpdatedAt: T0, patch: 'x' }],
      ['create', {}],
      ['create', { input: { title: 'x', type: 'task' } }],
      ['create', { input: { title: 'x', type: 'task', priority: '2', parentId: null, description: '' } }],
      ['create', { input: { title: 'x', type: 'task', priority: 2, parentId: 'bad id', description: '' } }],
      ['comment', { id: 'a' }],
      ['dependency', { op: 'nope', from: 'a', to: 'b', kind: 'blocks' }],
      ['dependency', { op: 'add', from: 'a', to: 'b' }],
      ['seen', {}],
      ['seen', { ids: 'a' }],
      ['workspace', { confirmFirstContact: 'yes' }],
      ['snapshot', { cursor: 5 }],
      ['snapshot', { refreshWorkspace: 'yes' }],
    ];
    for (const [name, body] of cases) {
      const res = await call(name, body);
      expect(res.status, `${name} ${JSON.stringify(body)}`).toBe(400);
      expect(errorOf(res.json).code).toBe('BAD_REQUEST');
    }
  });

  it('rejects every patch field of the wrong type, one by one', async () => {
    const wrong: Array<[string, unknown]> = [
      ['title', 5], ['status', null], ['description', {}], ['design', []], ['acceptance', 1], ['notes', true], ['closeReason', 0],
      ['priority', '2'], ['priority', Number.NaN], ['priority', null], ['assignee', 5], ['assignee', {}],
      ['labels', 'a'], ['labels', [1]], ['labels', ['a', null]],
    ];
    for (const [key, value] of wrong) {
      const res = await call('update', { id: 'a', expectedUpdatedAt: T0, patch: { [key]: value } });
      expect(res.status, `${key}=${JSON.stringify(value)}`).toBe(400);
      expect(errorOf(res.json).message).toContain(`patch.${key}`);
    }
    expect(provider.update).not.toHaveBeenCalled();
  });

  it('passes the shown values (expected) through, and rejects ones of the wrong type', async () => {
    const expected = { title: 't', status: 's', description: 'd', design: 'g', acceptance: 'c', notes: 'n', priority: null, assignee: null, labels: ['x'] };
    await call('update', { id: 'a', expectedUpdatedAt: T0, patch: { title: 'u' }, expected: { ...expected, closeReason: 'r', id: 'z' } });
    expect(provider.update).toHaveBeenCalledWith('a', T0, { title: 'u' }, 'Ann (panel)', expected);
    provider.update.mockClear();
    for (const [key, value] of [['title', 5], ['priority', '2'], ['assignee', 3], ['labels', [1]]] as Array<[string, unknown]>) {
      const res = await call('update', { id: 'a', expectedUpdatedAt: T0, patch: {}, expected: { [key]: value } });
      expect(res.status, key).toBe(400);
      expect(errorOf(res.json).message).toContain(`expected.${key}`);
    }
    expect((await call('update', { id: 'a', expectedUpdatedAt: T0, patch: {}, expected: 'x' })).status).toBe(400);
    expect(provider.update).not.toHaveBeenCalled();
  });

  it('drops unknown patch keys and passes the known ones through whole', async () => {
    const patch = { title: 't', status: 's', description: 'd', design: 'g', acceptance: 'c', notes: 'n', closeReason: 'r', priority: 1, assignee: null, labels: ['x'] };
    await call('update', { id: 'a', expectedUpdatedAt: T0, patch: { ...patch, id: 'other', updatedAt: 'x', extra: { y: 1 }, createdBy: 'me' } });
    expect(provider.update).toHaveBeenCalledWith('a', T0, patch, 'Ann (panel)', {});
  });

  it('answers 400 for a body that is not JSON', async () => {
    server = startServer({ port: 0, token: TOKEN, handlers: createRoutes(deps) });
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/snapshot`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: '{nope' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('BAD_REQUEST');
  });

  it('ignores unknown fields', async () => {
    const res = await call('bead', { id: 'a', extra: { x: 1 }, whatever: true });
    expect(res.status).toBe(200);
  });
});

describe('workspace resolution', () => {
  const notOk: Array<[string, WorkspaceState]> = [
    ['no-bd', { kind: 'no-bd' }],
    ['bd-too-old', { kind: 'bd-too-old', bdVersion: '1.0.0' }],
    ['no-workspace', { kind: 'no-workspace' }],
    ['pre-dolt', { kind: 'pre-dolt', root: '/p' }],
    ['needs-first-contact', { kind: 'needs-first-contact', root: '/p', lastOpenedWith: '1.1.0', bdVersion: '1.2.2' }],
    ['server-down', { kind: 'server-down', root: '/p', port: 3307 }],
  ];

  it.each(notOk)('every acting route answers with the %s state in a workspace envelope', async (_name, state) => {
    workspace = state;
    const bodies: Array<[string, Record<string, unknown>]> = [
      ['bead', { id: 'a' }],
      ['update', { id: 'a', expectedUpdatedAt: T0, patch: { title: 'x' } }],
      ['create', { input: { title: 'x', type: 'task', priority: 2, parentId: null, description: '' } }],
      ['comment', { id: 'a', text: 'hi' }],
      ['dependency', { op: 'add', from: 'a', to: 'b', kind: 'blocks' }],
      ['seen', { all: true }],
      ['context', { id: 'a' }],
      ['sync-preview', {}],
      ['sync-pull', {}],
      ['sync-publish', { expectedHead: 'aaaa1111' }],
      ['conflict-context', {}],
    ];
    for (const [name, body] of bodies) {
      const res = await call(name, body);
      const err = errorOf(res.json);
      expect(res.status, name).toBe(409);
      expect(err.code, name).toBe('workspace');
      expect(err.workspace, name).toEqual(state);
      expect(err.message, name).not.toMatch(/bd |dolt|stderr/i);
      // Fits both a Beads older than the panel needs and one older than the version that last opened the project.
      if (state.kind === 'bd-too-old') expect(err.message, name).toBe("This panel can't use the installed Beads version with this project.");
    }
    expect(provider.update).not.toHaveBeenCalled();
    expect(provider.create).not.toHaveBeenCalled();
    expect(provider.comment).not.toHaveBeenCalled();
    expect(provider.dependency).not.toHaveBeenCalled();
    expect(deps.preview).not.toHaveBeenCalled();
    expect(deps.startPull).not.toHaveBeenCalled();
    expect(deps.startPublish).not.toHaveBeenCalled();
    expect(store.markSeen).not.toHaveBeenCalled();
  });

  it('acts on the root resolveWorkspace returned, never on the directory it was sent', async () => {
    const bodies: Array<[string, Record<string, unknown>]> = [
      ['workspace', {}],
      ['snapshot', {}],
      ['bead', { id: 'a' }],
      ['update', { id: 'a', expectedUpdatedAt: T0, patch: { title: 'x' } }],
      ['create', { input: { title: 'x', type: 'task', priority: 2 } }],
      ['comment', { id: 'a', text: 'hi' }],
      ['dependency', { op: 'add', from: 'a', to: 'b', kind: 'blocks' }],
      ['seen', { all: true }],
      ['context', { id: 'a' }],
      ['sync-preview', {}],
      ['sync-pull', {}],
      ['sync-publish', { expectedHead: 'aaaa1111' }],
    ];
    for (const [name, body] of bodies) expect((await call(name, body)).status, name).toBe(200);
    // A failed write that may have left a half merge, to reach the check.
    provider.update.mockRejectedValueOnce(new WriteError('merge-conflict', 'x', 'tables are in conflict'));
    await call('update', { id: 'a', expectedUpdatedAt: T0, patch: { title: 'y' } });
    sync = { kind: 'idle' };
    // The waiting state, for the consent route.
    workspace = { kind: 'needs-first-contact', root, lastOpenedWith: '1.1.0', bdVersion: '1.3.0' };
    await call('workspace', { confirmFirstContact: true });
    workspace = okWorkspace();
    sync = { kind: 'error', message: 'Sync did not finish.', log: '' };
    await call('conflict-context');

    const mocks = deps as unknown as Record<string, ReturnType<typeof vi.fn>>;
    // Only these take the folder the panel sent; they resolve it.
    for (const name of ['resolveWorkspace', 'getSnapshot']) {
      for (const [first] of mocks[name]!.mock.calls) expect(first, name).toBe(sub);
    }
    // Everything else takes the resolved root.
    for (const name of ['providerFor', 'panelActor', 'writesBlocked', 'syncState', 'projectStore', 'preview', 'localHead', 'startPull', 'startPublish', 'checkHalfMerge', 'beadUrl', 'cachedBeads']) {
      const calls = mocks[name]!.mock.calls;
      expect(calls.length, name).toBeGreaterThan(0);
      for (const [first] of calls) expect(first, name).toBe(root);
    }
  });
});

describe('workspace', () => {
  it('returns the workspace state', async () => {
    const res = await call('workspace');
    expect(res.status).toBe(200);
    expect(res.json).toEqual(workspace);
    expect(store.confirmFirstContact).not.toHaveBeenCalled();
  });

  it('returns a state that needs no root as is', async () => {
    workspace = { kind: 'no-bd' };
    expect((await call('workspace')).json).toEqual({ kind: 'no-bd' });
  });

  it('confirms first contact for the bd version, saves it, and detects again', async () => {
    const waiting: WorkspaceState = { kind: 'needs-first-contact', root, lastOpenedWith: '1.1.0', bdVersion: '1.3.0' };
    workspace = waiting;
    (deps.resolveWorkspace as ReturnType<typeof vi.fn>).mockImplementation(async (directory: string, opts?: { refreshWorkspace?: boolean }) => {
      log.push(`resolve:${opts?.refreshWorkspace ?? false}`);
      if (opts?.refreshWorkspace) workspace = okWorkspace({ bdVersion: '1.3.0' });
      return { workspace, root: workspace.kind === 'ok' ? workspace.root : null };
    });
    const res = await call('workspace', { confirmFirstContact: true });
    expect(res.status).toBe(200);
    expect(res.json.kind).toBe('ok');
    expect(store.confirmFirstContact).toHaveBeenCalledWith('1.3.0');
    expect(deps.projectStore).toHaveBeenCalledWith(root);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.restoreFirstContact).not.toHaveBeenCalled();
    expect(log).toEqual(['resolve:false', 'resolve:true']);
    expect(deps.resolveWorkspace).toHaveBeenNthCalledWith(1, sub);
    expect(deps.resolveWorkspace).toHaveBeenNthCalledWith(2, sub, { refreshWorkspace: true });
  });

  it('refuses confirmation when the project is not waiting for it', async () => {
    const res = await call('workspace', { confirmFirstContact: true });
    expect(res.status).toBe(409);
    expect(errorOf(res.json).code).toBe('workspace');
    expect(errorOf(res.json).workspace).toEqual(workspace);
    expect(store.confirmFirstContact).not.toHaveBeenCalled();
  });

  it('reports a failed save of the confirmation and does not detect again', async () => {
    workspace = { kind: 'needs-first-contact', root, lastOpenedWith: '1.1.0', bdVersion: '1.3.0' };
    store.save.mockRejectedValue(new Error('EACCES: /secret/path'));
    const res = await call('workspace', { confirmFirstContact: true });
    expect(res.status).toBe(500);
    expect(errorOf(res.json).code).toBe('beads-error');
    expect(errorOf(res.json).message).not.toContain('EACCES');
    expect(errorOf(res.json).detail).toContain('EACCES');
    expect(log.filter((l) => l.endsWith(':true'))).toEqual([]);
  });

  it('takes the consent back in memory when saving it fails', async () => {
    workspace = { kind: 'needs-first-contact', root, lastOpenedWith: '1.1.0', bdVersion: '1.3.0' };
    store.firstContactConfirmedFor.mockReturnValue('1.2.2');
    store.save.mockRejectedValue(new Error('disk full'));
    await call('workspace', { confirmFirstContact: true });
    expect(store.confirmFirstContact).toHaveBeenCalledWith('1.3.0');
    expect(store.restoreFirstContact).toHaveBeenCalledWith('1.2.2');
    expect(store.confirmFirstContact.mock.invocationCallOrder[0]!).toBeLessThan(store.restoreFirstContact.mock.invocationCallOrder[0]!);
  });

  it('keeps the consent when it saved', async () => {
    workspace = { kind: 'needs-first-contact', root, lastOpenedWith: '1.1.0', bdVersion: '1.3.0' };
    await call('workspace', { confirmFirstContact: true });
    expect(store.restoreFirstContact).not.toHaveBeenCalled();
  });
});

describe('snapshot', () => {
  it('passes cursor and refreshWorkspace and returns the snapshot as is', async () => {
    const res = await call('snapshot', { cursor: 'c1', refreshWorkspace: true });
    expect(res.status).toBe(200);
    expect(res.json.unchanged).toBe(true);
    expect(deps.getSnapshot).toHaveBeenCalledWith(sub, 'c1', true);
  });

  it('defaults to no cursor and no refresh', async () => {
    await call('snapshot');
    expect(deps.getSnapshot).toHaveBeenCalledWith(sub, undefined, false);
  });

  it('maps a lock or timeout on first detection to busy with plain copy and the raw text in detail', async () => {
    for (const kind of ['lock', 'timeout'] as const) {
      (deps.getSnapshot as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new BdError(kind, 'bd timed out', { stderr: 'Error: database is locked by pid 4242' }));
      const res = await call('snapshot');
      expect(res.status).toBe(503);
      const err = errorOf(res.json);
      expect(err.code).toBe('busy');
      expect(err.message).toBe('Beads is busy. Retrying.');
      expect(err.detail).toContain('locked by pid 4242');
    }
  });

  it('maps any other failure to beads-error and keeps stderr out of the message', async () => {
    (deps.getSnapshot as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new BdError('exit', 'bd exited 1', { code: 1, stderr: 'panic: runtime error at /Users/x' }));
    const res = await call('snapshot');
    expect(res.status).toBe(500);
    const err = errorOf(res.json);
    expect(err.code).toBe('beads-error');
    // The snapshot is the poll, so a non-busy failure also says it is retrying.
    expect(err.message).toBe("Couldn't read beads. Retrying.");
    expect(err.detail).toContain('panic: runtime error');

    (deps.getSnapshot as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const plain = await call('snapshot');
    expect(errorOf(plain.json).code).toBe('beads-error');
    expect(errorOf(plain.json).message).toBe("Couldn't read beads. Retrying.");
    expect(errorOf(plain.json).detail).toContain('boom');
  });
});

describe('bead', () => {
  it('returns the bead and what is around it from the cache', async () => {
    const res = await call('bead', { id: 'a' });
    expect(res.status).toBe(200);
    expect(res.json.bead.id).toBe('a');
    expect(res.json.related.children.map((b: Bead) => b.id)).toEqual(['b']);
    expect(deps.getSnapshot).not.toHaveBeenCalled();
  });

  it('fills a cold cache with one snapshot read first', async () => {
    beads = null;
    (deps.getSnapshot as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      beads = [bead('a')];
      return { unchanged: true, cursor: 'c', freshness: {}, sync };
    });
    const res = await call('bead', { id: 'a' });
    expect(res.status).toBe(200);
    expect(deps.getSnapshot).toHaveBeenCalledTimes(1);
    expect(deps.getSnapshot).toHaveBeenCalledWith(sub);
    expect(deps.cachedBeads).toHaveBeenCalledWith(root);
  });

  it('keeps "Try again in a moment" when its own cold-cache read is busy (only the poll retries by itself)', async () => {
    beads = null;
    (deps.getSnapshot as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new BdError('lock', 'bd timed out', { stderr: 'Error: database is locked by pid 4242' }));
    const res = await call('bead', { id: 'a' });
    expect(res.status).toBe(503);
    expect(errorOf(res.json).code).toBe('busy');
    expect(errorOf(res.json).message).toBe('Beads is busy. Try again in a moment.');
  });

  it('says beads-error when the cache stays empty', async () => {
    beads = null;
    const res = await call('bead', { id: 'a' });
    expect(res.status).toBe(500);
    expect(errorOf(res.json).code).toBe('beads-error');
  });

  it('answers 404 not-found for an id that is not there', async () => {
    const res = await call('bead', { id: 'zzz' });
    expect(res.status).toBe(404);
    expect(errorOf(res.json).code).toBe('not-found');
  });
});

describe('writes', () => {
  const writes: Array<[string, Record<string, unknown>, ReturnType<typeof vi.fn>]> = [
    ['update', { id: 'a', expectedUpdatedAt: T0, patch: { title: 'New' } }, provider.update],
    ['create', { input: { title: 'x', type: 'task', priority: 2, parentId: null, description: '' } }, provider.create],
    ['comment', { id: 'a', text: 'hi' }, provider.comment],
    ['dependency', { op: 'add', from: 'a', to: 'b', kind: 'blocks' }, provider.dependency],
  ];

  it('update passes everything to the root provider with the panel actor and returns the result', async () => {
    const res = await call('update', { id: 'a', expectedUpdatedAt: T0, patch: { title: 'New', assignee: null } });
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(res.json.bead.title).toBe('New');
    expect(provider.update).toHaveBeenCalledWith('a', T0, { title: 'New', assignee: null }, 'Ann (panel)', {});
  });

  it('update returns a conflict or an uncertain result as 200 JSON', async () => {
    provider.update.mockResolvedValueOnce({ ok: false, conflict: true, current: bead('a') });
    const conflict = await call('update', { id: 'a', expectedUpdatedAt: T0, patch: { title: 'x' } });
    expect(conflict.status).toBe(200);
    expect(conflict.json.conflict).toBe(true);
    provider.update.mockResolvedValueOnce({ ok: false, uncertain: true, current: null });
    const uncertain = await call('update', { id: 'a', expectedUpdatedAt: T0, patch: { title: 'x' } });
    expect(uncertain.status).toBe(200);
    expect(uncertain.json.uncertain).toBe(true);
  });

  it('create returns the new bead; comment returns the comment; dependency returns ok', async () => {
    const created = await call('create', { input: { title: ' x ', type: 'task', priority: 1, parentId: 'a', description: 'd' } });
    expect(created.json).toEqual({ bead: bead('new') });
    expect(provider.create).toHaveBeenCalledWith({ title: ' x ', type: 'task', priority: 1, parentId: 'a', description: 'd' }, 'Ann (panel)');
    const commented = await call('comment', { id: 'a', text: 'hi' });
    expect(commented.json.comment.id).toBe('c1');
    expect(provider.comment).toHaveBeenCalledWith('a', 'hi', 'Ann (panel)');
    const linked = await call('dependency', { op: 'add', from: 'a', to: 'b', kind: 'blocks' });
    expect(linked.json).toEqual({ ok: true });
    expect(provider.dependency).toHaveBeenCalledWith('add', 'a', 'b', 'blocks', 'Ann (panel)');
  });

  it('create defaults a missing parentId and description', async () => {
    await call('create', { input: { title: 'x', type: 'task', priority: 2 } });
    expect(provider.create).toHaveBeenCalledWith({ title: 'x', type: 'task', priority: 2, parentId: null, description: '' }, 'Ann (panel)');
  });

  it('dependency remove needs no kind', async () => {
    const res = await call('dependency', { op: 'remove', from: 'a', to: 'b' });
    expect(res.status).toBe(200);
    expect(provider.dependency).toHaveBeenCalledWith('remove', 'a', 'b', '', 'Ann (panel)');
  });

  it.each(writes)('%s is refused with writes-blocked while writes are blocked', async (name, body, fn) => {
    blocked = true;
    const res = await call(name, body);
    expect(res.status).toBe(409);
    expect(errorOf(res.json).code).toBe('writes-blocked');
    expect(fn).not.toHaveBeenCalled();
    expect(deps.providerFor).not.toHaveBeenCalled();
    for (const other of Object.values(provider)) expect(other).not.toHaveBeenCalled();
  });

  it.each(writes)('%s is refused with sync-running while a sync runs', async (name, body, fn) => {
    sync = { kind: 'running', op: 'pull', startedAt: T0 };
    const res = await call(name, body);
    expect(res.status).toBe(409);
    expect(errorOf(res.json).code).toBe('sync-running');
    expect(errorOf(res.json).message).toBe('Sync in progress. Try again when it finishes.');
    expect(fn).not.toHaveBeenCalled();
    expect(deps.providerFor).not.toHaveBeenCalled();
    for (const other of Object.values(provider)) expect(other).not.toHaveBeenCalled();
  });

  it('writes-blocked wins over sync-running', async () => {
    blocked = true;
    sync = { kind: 'running', op: 'pull', startedAt: T0 };
    expect(errorOf((await call('comment', { id: 'a', text: 'hi' })).json).code).toBe('writes-blocked');
  });

  it('maps a WriteError to its code, message and detail', async () => {
    const cases: Array<[WriteError, number]> = [
      [new WriteError('invalid', 'A bead needs a title.'), 400],
      [new WriteError('not-found', 'That bead no longer exists.'), 404],
      [new WriteError('blocked', "This bead can't be closed yet.", 'raw blocked text'), 409],
      [new WriteError('dep-exists', 'Already linked.'), 409],
      [new WriteError('busy', 'Beads is busy. Nothing was saved. Try again in a moment.', 'raw busy'), 503],
      [new WriteError('uncertain', 'Beads did not answer in time.', 'raw timeout'), 504],
      [new WriteError('no-bd', 'Beads could not be found.'), 500],
      [new WriteError('failed', 'The change could not be saved.', 'raw failure'), 500],
    ];
    for (const [error, status] of cases) {
      provider.comment.mockRejectedValueOnce(error);
      const res = await call('comment', { id: 'a', text: 'hi' });
      expect(res.status, error.code).toBe(status);
      expect(errorOf(res.json)).toMatchObject({ code: error.code, message: error.message, detail: error.detail });
    }
  });

  it('says so when a failed write was saved after all', async () => {
    provider.create.mockRejectedValueOnce(new WriteError('uncertain', "Saved, but couldn't load the result. Refreshing.", 'raw', true));
    const res = await call('create', { input: { title: 'x', type: 'task', priority: 2 } });
    expect(errorOf(res.json).saved).toBe(true);
  });

  it('checks for a half-finished merge when a write fails with "in conflict"', async () => {
    provider.update.mockRejectedValueOnce(new WriteError('merge-conflict', 'The team sync has changes that need sorting out first.', 'the table(s) issues are in conflict'));
    const res = await call('update', { id: 'a', expectedUpdatedAt: T0, patch: { title: 'x' } });
    expect(res.status).toBe(409);
    expect(errorOf(res.json).code).toBe('merge-conflict');
    expect(deps.checkHalfMerge).toHaveBeenCalledWith(root, 'embedded');
  });

  it('does not check for a merge on other failures', async () => {
    provider.update.mockRejectedValueOnce(new WriteError('failed', 'The change could not be saved.', 'nope'));
    await call('update', { id: 'a', expectedUpdatedAt: T0, patch: { title: 'x' } });
    expect(deps.checkHalfMerge).not.toHaveBeenCalled();
  });

  it('answers without waiting for the merge check', async () => {
    (deps.checkHalfMerge as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise(() => undefined));
    provider.update.mockRejectedValueOnce(new WriteError('merge-conflict', 'x', 'tables are in conflict'));
    const res = await call('update', { id: 'a', expectedUpdatedAt: T0, patch: {} });
    expect(res.status).toBe(409);
    expect(deps.checkHalfMerge).toHaveBeenCalledTimes(1);
  });

  it('checks for a merge when only the text says "in conflict"', async () => {
    provider.update.mockRejectedValueOnce(new WriteError('failed', 'The change could not be saved.', 'the table(s) issues are in conflict'));
    await call('update', { id: 'a', expectedUpdatedAt: T0, patch: {} });
    expect(deps.checkHalfMerge).toHaveBeenCalledWith(root, 'embedded');
  });

  it('maps an unexpected error to failed with the raw text only in detail', async () => {
    provider.comment.mockRejectedValueOnce(new Error('weird internal /Users/x'));
    const res = await call('comment', { id: 'a', text: 'hi' });
    expect(res.status).toBe(500);
    expect(errorOf(res.json).code).toBe('failed');
    expect(errorOf(res.json).message).not.toContain('weird');
    expect(errorOf(res.json).detail).toContain('weird');
  });
});

describe('seen', () => {
  it('marks the given ids and returns beads and deletions that are still unseen', async () => {
    const res = await call('seen', { ids: ['a', 'gone'] });
    expect(res.status).toBe(200);
    expect(store.markSeen).toHaveBeenCalledWith(['a', 'gone']);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(res.json).toEqual({ unseenIds: ['a', 'gone'] });
  });

  it('marks everything with all: true', async () => {
    storeState = { unseen: [], deletions: [] };
    const res = await call('seen', { all: true });
    expect(store.markSeen).toHaveBeenCalledWith('all');
    expect(res.json).toEqual({ unseenIds: [] });
  });

  it('reports a failed save', async () => {
    store.save.mockRejectedValueOnce(new Error('disk full'));
    const res = await call('seen', { all: true });
    expect(res.status).toBe(500);
    expect(errorOf(res.json).code).toBe('beads-error');
    expect(errorOf(res.json).detail).toContain('disk full');
  });
});

describe('context', () => {
  it('returns the attach payload for a bead', async () => {
    const res = await call('context', { id: 'a' });
    expect(res.status).toBe(200);
    expect(res.json.id).toBe('a');
    expect(res.json.title).toBe('Title a');
    expect(res.json.url).toBe('https://example.com/demo?bead=a');
    const payload = JSON.parse(res.json.text.slice(res.json.text.indexOf('\n') + 1));
    expect(JSON.stringify(payload)).toContain('Title b');
    expect(res.json.text.length).toBeLessThanOrEqual(16_000);
    expect(deps.beadUrl).toHaveBeenCalledWith(root, 'demo', 'a');
  });

  it('answers 404 for an unknown bead', async () => {
    expect((await call('context', { id: 'zzz' })).status).toBe(404);
  });

  it('reads the project before building the payload, so the agent gets the bead as it is now', async () => {
    (deps.getSnapshot as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      beads = [bead('a', { title: 'Renamed just now' })];
      return { unchanged: true, cursor: 'c', freshness: { localRefreshedAt: T0, localError: null, localErrorDetail: null, teamSyncedAt: null, unpublished: null }, sync };
    });
    const res = await call('context', { id: 'a' });
    expect(res.status).toBe(200);
    expect(deps.getSnapshot).toHaveBeenCalledWith(sub);
    expect(res.json.title).toBe('Renamed just now');
    const payload = JSON.parse(res.json.text.slice(res.json.text.indexOf('\n') + 1));
    expect(payload.stale).toBeUndefined();
    expect(payload.readAt).toBeUndefined();
  });

  it('still attaches when that read failed, saying the bead is as last read and when', async () => {
    (deps.getSnapshot as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      unchanged: true,
      cursor: 'c',
      freshness: { localRefreshedAt: T0, localError: 'Beads is busy. Retrying.', localErrorDetail: 'locked', teamSyncedAt: null, unpublished: null },
      sync,
    });
    const res = await call('context', { id: 'a' });
    expect(res.status).toBe(200);
    const payload = JSON.parse(res.json.text.slice(res.json.text.indexOf('\n') + 1));
    expect(payload.stale).toBe(true);
    expect(payload.readAt).toBe(T0);
    expect(payload.issue.id).toBe('a');
  });
});

describe('sync routes', () => {
  it('sync-preview lists the unpublished changes', async () => {
    const changes = [{ commit: 'abc', message: 'm', beadIds: ['a'], summary: 's', actor: null, at: T0 }];
    (deps.preview as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ head: 'aaaa1111', changes, total: 1 });
    const res = await call('sync-preview');
    expect(res.json).toEqual({ changes, head: 'aaaa1111', total: 1 });
    expect(deps.preview).toHaveBeenCalledWith(root, 'embedded');
  });

  it('sync-preview says noRemote when there is no remote', async () => {
    (deps.preview as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    expect((await call('sync-preview')).json).toEqual({ changes: [], noRemote: true });
  });

  it('sync-preview does not queue behind a running sync', async () => {
    sync = { kind: 'running', op: 'publish', startedAt: T0 };
    const res = await call('sync-preview');
    expect(errorOf(res.json).code).toBe('sync-running');
    expect(deps.preview).not.toHaveBeenCalled();
  });

  it('sync-preview maps a read failure', async () => {
    (deps.preview as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new BdError('lock', 'locked', { stderr: 'database is locked' }));
    const res = await call('sync-preview');
    expect(res.status).toBe(503);
    expect(errorOf(res.json).code).toBe('busy');
  });

  it('sync-preview and sync-publish say Publish needs the Dolt tool when it is not installed', async () => {
    const missing = new BdError('not-found', 'dolt was not found on PATH or in the usual install folders');
    (deps.preview as ReturnType<typeof vi.fn>).mockRejectedValueOnce(missing);
    const preview = await call('sync-preview');
    expect(errorOf(preview.json)).toMatchObject({ code: 'beads-error', message: "Publishing needs the Dolt tool, which isn't installed." });
    expect(errorOf(preview.json).detail).toContain('dolt was not found');
    (deps.localHead as ReturnType<typeof vi.fn>).mockRejectedValueOnce(missing);
    const publish = await call('sync-publish', { expectedHead: 'aaaa1111' });
    expect(errorOf(publish.json).message).toBe("Publishing needs the Dolt tool, which isn't installed.");
    expect(deps.startPublish).not.toHaveBeenCalled();
  });

  it('sync-publish refuses, and starts nothing, when the head moved since the preview', async () => {
    (deps.localHead as ReturnType<typeof vi.fn>).mockResolvedValueOnce('bbbb2222');
    const res = await call('sync-publish', { expectedHead: 'aaaa1111' });
    expect(res.status).toBe(409);
    expect(errorOf(res.json).code).toBe('preview-stale');
    expect(errorOf(res.json).message).toBe('New changes arrived since you looked. Review them again.');
    expect(deps.startPublish).not.toHaveBeenCalled();
  });

  it('sync-publish passes the previewed head on to the job when it still matches', async () => {
    const res = await call('sync-publish', { expectedHead: 'aaaa1111' });
    expect(res.status).toBe(200);
    expect(deps.startPublish).toHaveBeenCalledWith(root, 'embedded', 'aaaa1111');
  });

  it('sync-publish refuses an expectedHead that is not a commit hash', async () => {
    const res = await call('sync-publish', { expectedHead: "x'; DROP" });
    expect(res.status).toBe(400);
    expect(deps.startPublish).not.toHaveBeenCalled();
  });

  it('sync-publish with a previewed head is refused while a job runs: that job is not the one confirmed', async () => {
    sync = { kind: 'running', op: 'pull', startedAt: T0 };
    const res = await call('sync-publish', { expectedHead: 'aaaa1111' });
    expect(res.status).toBe(409);
    expect(errorOf(res.json).code).toBe('sync-running');
    expect(deps.localHead).not.toHaveBeenCalled();
    expect(deps.startPublish).not.toHaveBeenCalled();
  });

  it('sync-pull and sync-publish start the job and return its state', async () => {
    const pull = await call('sync-pull');
    expect(pull.json).toEqual({ sync: { kind: 'running', op: 'pull', startedAt: T0 } });
    expect(deps.startPull).toHaveBeenCalledWith(root, 'embedded');
    const publish = await call('sync-publish', { expectedHead: 'aaaa1111' });
    expect(publish.json).toEqual({ sync: { kind: 'running', op: 'publish', startedAt: T0 } });
    expect(deps.startPublish).toHaveBeenCalledWith(root, 'embedded', 'aaaa1111');
  });

  it('sync-publish without the previewed head is a bad request and starts nothing', async () => {
    const res = await call('sync-publish');
    expect(res.status).toBe(400);
    expect(errorOf(res.json).code).toBe('BAD_REQUEST');
    expect(deps.resolveWorkspace).not.toHaveBeenCalled();
    expect(deps.localHead).not.toHaveBeenCalled();
    expect(deps.startPublish).not.toHaveBeenCalled();
  });
});

describe('conflict-context', () => {
  const conflict: SyncState = { kind: 'conflict', mode: 'embedded', halfMerged: false, beads: [{ beadId: 'a', title: 'A', ours: 'x', theirs: 'y' }], log: '$ bd dolt pull\nconflict' };

  it('is refused when there is no sync problem', async () => {
    for (const state of [{ kind: 'idle' }, { kind: 'running', op: 'pull', startedAt: T0 }] as SyncState[]) {
      sync = state;
      const res = await call('conflict-context');
      expect(res.status).toBe(400);
      expect(errorOf(res.json).code).toBe('BAD_REQUEST');
    }
  });

  it('works for a paused upgrade, like a plain error', async () => {
    sync = { kind: 'paused-upgrade', message: "This project's beads data needs a different Beads version. Hand it to your agent to check.", log: '$ bd dolt pull\nunsupported storage format version 9' };
    const res = await call('conflict-context');
    expect(res.status).toBe(200);
    expect(res.json.title).toBe('Beads sync needs attention');
    expect(res.json.text).toContain('needs a different Beads version');
    expect(res.json.text).toContain('unsupported storage format version 9');
  });

  it('builds the attach payload with the sync section of AGENTS.md', async () => {
    sync = conflict;
    await writeFile(join(root, 'AGENTS.md'), '# Project\n\nIntro.\n\n## Beads sync rules\n\nNever force push.\n\n### Details\n\nKeep both sides.\n\n## Other\n\nUnrelated section.\n');
    const res = await call('conflict-context');
    expect(res.status).toBe(200);
    expect(res.json.id).toBe(`sync-${basename(root)}`);
    expect(res.json.title).toBe('Beads sync needs attention');
    expect(res.json.url).toBe('https://example.com/demo?bead=sync');
    expect(res.json.text).toContain('Never force push.');
    expect(res.json.text).toContain('Keep both sides.');
    expect(res.json.text).not.toContain('Unrelated section.');
    expect(res.json.text).not.toContain('Intro.');
    expect(deps.beadUrl).toHaveBeenCalledWith(root, 'demo', 'sync');
    // The project the agent is told about is the resolved root, not the folder the panel sent.
    expect(res.json.text).toContain(`"project": ${JSON.stringify(root)}`);
    expect(res.json.text).not.toContain(JSON.stringify(sub));
  });

  it('works for a sync that ended in an error', async () => {
    sync = { kind: 'error', message: 'Sync did not finish.', log: '$ bd dolt push\nrejected' };
    const res = await call('conflict-context');
    expect(res.status).toBe(200);
    expect(res.json.text).toContain('Sync did not finish.');
  });

  it('falls back to the first 4,000 characters of AGENTS.md with no sync heading', async () => {
    sync = conflict;
    await writeFile(join(root, 'AGENTS.md'), `# Project\n\n${'x'.repeat(5_000)}TAIL`);
    const res = await call('conflict-context');
    expect(res.json.text).toContain('x'.repeat(3_000));
    expect(res.json.text).not.toContain('TAIL');
  });

  it('ignores headings inside code fences', async () => {
    sync = conflict;
    await writeFile(join(root, 'AGENTS.md'), '# Project\n\n```bash\n# sync the beads\n```\n\nPlain intro.\n');
    const res = await call('conflict-context');
    expect(res.json.text).toContain('Plain intro.');
    // No heading counted, so the whole file is the fallback, including the real heading before the fence.
    expect(res.json.text).toContain('# Project');
    expect(res.json.text).toContain('# sync the beads');
  });

  it('sends null rules when there is no AGENTS.md', async () => {
    sync = conflict;
    const res = await call('conflict-context');
    expect(res.status).toBe(200);
    expect(res.json.text).toContain('"projectRules": null');
  });

  it('sends null rules when AGENTS.md is empty', async () => {
    sync = conflict;
    await writeFile(join(root, 'AGENTS.md'), '  \n');
    expect((await call('conflict-context')).json.text).toContain('"projectRules": null');
  });
});

describe('catch-all', () => {
  it('turns an error nobody planned for into plain copy with the raw text only in detail', async () => {
    (deps.syncState as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('kaboom /Users/x/secret');
    });
    const res = await call('comment', { id: 'a', text: 'hi' });
    expect(res.status).toBe(500);
    expect(errorOf(res.json).code).toBe('INTERNAL');
    expect(errorOf(res.json).message).toBe('Something went wrong.');
    expect(errorOf(res.json).detail).toContain('kaboom');
    expect(provider.comment).not.toHaveBeenCalled();
  });

  it('keeps plain copy when a read throws something that is not an Error', async () => {
    (deps.getSnapshot as ReturnType<typeof vi.fn>).mockRejectedValueOnce('plain string');
    expect(errorOf((await call('snapshot')).json).code).toBe('beads-error');
    (deps.resolveWorkspace as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw 42;
    });
    expect(errorOf((await call('workspace')).json).code).toBe('beads-error');
  });
});

describe('rulesFrom', () => {
  it('is null for empty text', () => {
    expect(rulesFrom('')).toBeNull();
    expect(rulesFrom(' \n\t\n')).toBeNull();
  });

  it('returns the whole text when no heading names sync, dolt or beads', () => {
    const text = '# Project\n\nHello.\n\n## Style\n\nTabs.';
    expect(rulesFrom(text)).toBe(text);
  });

  it('returns the whole text when there is no heading at all', () => {
    expect(rulesFrom('Just a note.\nAnother line.')).toBe('Just a note.\nAnother line.');
  });

  it('takes the section down to the next heading of the same or a higher level, subsections included', () => {
    const text = '# P\n\n## Sync rules\n\nA.\n\n### Detail\n\nB.\n\n## Other\n\nC.\n';
    expect(rulesFrom(text)).toBe('## Sync rules\n\nA.\n\n### Detail\n\nB.');
  });

  it('runs to the end of the file when nothing closes the section', () => {
    expect(rulesFrom('# P\n\n## Beads\n\nLast words.\n')).toBe('## Beads\n\nLast words.');
  });

  it('ranks sync over dolt over beads, wherever they appear', () => {
    const text = '## Beads usage\n\nb.\n\n## Dolt remotes\n\nd.\n\n## Team sync\n\ns.\n';
    expect(rulesFrom(text)).toBe('## Team sync\n\ns.');
    expect(rulesFrom('## Beads usage\n\nb.\n\n## Dolt remotes\n\nd.\n')).toBe('## Dolt remotes\n\nd.');
    expect(rulesFrom('## Dolt remotes\n\nd.\n\n## Beads usage\n\nb.\n')).toBe('## Dolt remotes\n\nd.');
  });

  it('prefers the shallowest heading below H1 among equals, then the first, so a section keeps its children', () => {
    const text = '## Sync overview\n\ntop.\n\n### Sync problems\n\ndeep.\n\n### Sync history\n\nlater.\n';
    expect(rulesFrom(text)).toBe('## Sync overview\n\ntop.\n\n### Sync problems\n\ndeep.\n\n### Sync history\n\nlater.');
    expect(rulesFrom('## Sync\n\ns.\n\n### Sync conflicts\n\nc.\n')).toBe('## Sync\n\ns.\n\n### Sync conflicts\n\nc.');
    expect(rulesFrom('## Sync one\n\nfirst.\n\n## Sync two\n\nsecond.\n')).toBe('## Sync one\n\nfirst.');
  });

  it('falls back to an H1 only when no heading below H1 has the best rank', () => {
    expect(rulesFrom('# Sync\n\nwhole.\n\n## Beads usage\n\nb.\n')).toBe('# Sync\n\nwhole.\n\n## Beads usage\n\nb.');
    expect(rulesFrom('# Sync\n\nwhole.\n\n### Team sync\n\ns.\n')).toBe('### Team sync\n\ns.');
  });

  it('matches whole words only', () => {
    expect(rulesFrom('## Asynchronous work\n\nx.\n\n## Beadsman\n\ny.')).toBe('## Asynchronous work\n\nx.\n\n## Beadsman\n\ny.');
  });

  it('reads CRLF and CR files, and returns the section with plain newlines', () => {
    expect(rulesFrom('# P\r\n\r\n## Sync\r\n\r\nKeep both.\r\n\r\n## Other\r\n\r\nNo.\r\n')).toBe('## Sync\n\nKeep both.');
    expect(rulesFrom('# P\r\r## Sync\rKeep.\r## Other\rNo.')).toBe('## Sync\nKeep.');
  });

  it('ignores headings inside code fences, for the start and for the end', () => {
    const text = '# P\n\n```sh\n# sync the beads\n```\n\n## Dolt\n\nBefore.\n\n~~~\n## Other\n~~~\n\nAfter.\n\n## Next\n\nNo.\n';
    expect(rulesFrom(text)).toBe('## Dolt\n\nBefore.\n\n~~~\n## Other\n~~~\n\nAfter.');
  });
});
