import { readFileSync } from 'node:fs';
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
import { resetUpdateState, startUpdate, updateJob, whenUpdateSettled } from '../../../src/service/schema-update';
import type { ApiErrorEnvelope } from '../../../src/shared/api';
import type { Bead, LiveState, SyncState, WorkspaceState, WriteResult } from '../../../src/shared/types';

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
let skew: { from: number; to: number } | null;
let log: string[];
let deps: RouteDeps;
let storeState: { unseen: string[] };
let liveState: LiveState;
const journalChanged = vi.fn();
const readFailureDropped = vi.fn();

const provider = {
  update: vi.fn(),
  create: vi.fn(),
  comment: vi.fn(),
  dependency: vi.fn(),
  gateCreate: vi.fn(),
  gateResolve: vi.fn(),
  humanRespond: vi.fn(),
  humanDismiss: vi.fn(),
  history: vi.fn(),
  gateHistory: vi.fn(),
  deferBead: vi.fn(),
  undeferBead: vi.fn(),
  supersede: vi.fn(),
  duplicate: vi.fn(),
  readyExplain: vi.fn(),
  eventsJournal: vi.fn(),
  enableEventsJournal: vi.fn(),
  migrateSchema: vi.fn(),
};
const explain = vi.fn();
const memories = { list: vi.fn(), remember: vi.fn(), forget: vi.fn() };
const store = {
  markSeen: vi.fn(),
  save: vi.fn(),
  allUnseenIds: vi.fn(),
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
  skew = null;
  log = [];
  storeState = { unseen: ['a', 'gone', 'gated'] };
  for (const fn of [...Object.values(provider), ...Object.values(store), ...Object.values(memories)]) fn.mockReset();
  store.allUnseenIds.mockImplementation(() => storeState.unseen);
  store.save.mockResolvedValue(undefined);
  store.firstContactConfirmedFor.mockReturnValue(null);
  provider.update.mockResolvedValue({ ok: true, bead: bead('a', { title: 'New' }) } satisfies WriteResult);
  provider.create.mockResolvedValue(bead('new'));
  provider.comment.mockResolvedValue({ id: 'c1', author: 'x', text: 'hi', createdAt: T0 });
  provider.dependency.mockResolvedValue(undefined);
  provider.gateCreate.mockResolvedValue({ ok: true, gate: { id: 'g1', kind: 'human', reason: 'Review before closing', blocks: ['a'], createdBy: 'Ann (panel)', createdAt: T0, timeoutMs: null, planApproval: false } });
  provider.gateResolve.mockResolvedValue({ ok: true, gateId: 'g1' });
  provider.humanRespond.mockResolvedValue({ ok: true, bead: bead('a', { status: 'closed' }) });
  provider.gateHistory.mockResolvedValue({ rows: [], events: [] });
  provider.humanDismiss.mockResolvedValue({ ok: true, bead: bead('a', { status: 'closed' }) });
  explain.mockReset();
  for (const name of ['deferBead', 'undeferBead', 'supersede', 'duplicate'] as const) provider[name].mockResolvedValue({ ok: true, bead: bead('a') } satisfies WriteResult);
  explain.mockResolvedValue({ state: 'blocked', blockers: [{ id: 'b', title: 'B', status: 'open' }] });
  provider.eventsJournal.mockReset().mockResolvedValue('off');
  provider.enableEventsJournal.mockReset().mockResolvedValue(undefined);
  provider.migrateSchema.mockReset().mockResolvedValue(undefined);
  readFailureDropped.mockReset();
  resetUpdateState();
  journalChanged.mockReset();
  liveState = 'off';
  memories.list.mockResolvedValue({ memories: [], fingerprint: 'f' });
  memories.remember.mockResolvedValue({ ok: true, memory: { key: 'k', text: 'text', changedAt: null, changedBy: null } });
  memories.forget.mockResolvedValue({ ok: true, memory: null });

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
    memories: memories as never,
    cachedBeads: vi.fn(() => beads),
    schemaSkew: vi.fn(() => skew),
    readFailureDropped,
    startUpdate,
    updateJob,
    explain: explain as never,
    panelActor: vi.fn(async () => 'Ann (panel)'),
    preview: vi.fn(async () => ({ head: 'aaaa1111', changes: [], total: 0 })),
    localHead: vi.fn(async () => 'aaaa1111'),
    startPull: vi.fn(() => ({ kind: 'running', op: 'pull', startedAt: T0 }) as SyncState),
    startPublish: vi.fn(() => ({ kind: 'running', op: 'publish', startedAt: T0 }) as SyncState),
    syncState: vi.fn(() => sync),
    writesBlocked: vi.fn(() => blocked),
    checkHalfMerge: vi.fn(async () => undefined),
    live: { state: vi.fn(() => liveState), journalChanged },
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
        ['explain', { id }],
        ['deferBead', { id, expectedUpdatedAt: T0, until: null }],
        ['undeferBead', { id, expectedUpdatedAt: T0 }],
        ['supersede', { id, with: 'b', expectedUpdatedAt: T0 }],
        ['supersede', { id: 'a', with: id, expectedUpdatedAt: T0 }],
        ['duplicate', { id, of: 'b', expectedUpdatedAt: T0 }],
        ['duplicate', { id: 'a', of: id, expectedUpdatedAt: T0 }],
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
      ['deferBead', { id: 'a', until: null }],
      ['deferBead', { id: 'a', expectedUpdatedAt: T0 }],
      ['deferBead', { id: 'a', expectedUpdatedAt: T0, until: 5 }],
      ['deferBead', { id: 'a', expectedUpdatedAt: T0, until: null, reason: 5 }],
      ['undeferBead', { id: 'a' }],
      ['supersede', { id: 'a', expectedUpdatedAt: T0 }],
      ['supersede', { id: 'a', with: 'b' }],
      ['duplicate', { id: 'a', expectedUpdatedAt: T0 }],
      ['duplicate', { id: 'a', of: 'b' }],
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
      ['title', 5], ['status', null], ['description', {}], ['design', []], ['acceptance', 1], ['notes', true], ['closeReason', 0], ['closeComment', 1], ['type', 4], ['type', null],
      ['parent', 5], ['parent', 'bad id'], ['due', 5], ['due', {}],
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
    const expected = { title: 't', status: 's', description: 'd', design: 'g', acceptance: 'c', notes: 'n', priority: null, assignee: null, labels: ['x'], type: 'task', parentId: null, due: '2026-12-01' };
    await call('update', { id: 'a', expectedUpdatedAt: T0, patch: { title: 'u' }, expected: { ...expected, closeReason: 'r', id: 'z' } });
    expect(provider.update).toHaveBeenCalledWith('a', T0, { title: 'u' }, 'Ann (panel)', expected);
    provider.update.mockClear();
    for (const [key, value] of [['title', 5], ['priority', '2'], ['assignee', 3], ['labels', [1]], ['type', 3], ['parentId', 3], ['parentId', 'bad id'], ['due', 3]] as Array<[string, unknown]>) {
      const res = await call('update', { id: 'a', expectedUpdatedAt: T0, patch: {}, expected: { [key]: value } });
      expect(res.status, key).toBe(400);
      expect(errorOf(res.json).message).toContain(`expected.${key}`);
    }
    expect((await call('update', { id: 'a', expectedUpdatedAt: T0, patch: {}, expected: 'x' })).status).toBe(400);
    expect(provider.update).not.toHaveBeenCalled();
  });

  it('drops unknown patch keys and passes the known ones through whole', async () => {
    const patch = { title: 't', status: 's', description: 'd', design: 'g', acceptance: 'c', notes: 'n', closeReason: 'r', closeComment: 'c', type: 'bug', parent: 'b', due: null, priority: 1, assignee: null, labels: ['x'] };
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
      ['deferBead', { id: 'a', expectedUpdatedAt: T0, until: null }],
      ['undeferBead', { id: 'a', expectedUpdatedAt: T0 }],
      ['supersede', { id: 'a', with: 'b', expectedUpdatedAt: T0 }],
      ['duplicate', { id: 'a', of: 'b', expectedUpdatedAt: T0 }],
      ['explain', { id: 'a' }],
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
      ['deferBead', { id: 'a', expectedUpdatedAt: T0, until: null }],
      ['undeferBead', { id: 'a', expectedUpdatedAt: T0 }],
      ['supersede', { id: 'a', with: 'b', expectedUpdatedAt: T0 }],
      ['duplicate', { id: 'a', of: 'b', expectedUpdatedAt: T0 }],
      ['explain', { id: 'a' }],
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

describe('explain', () => {
  it('returns the structured answer for a bead in the cache, read through the root provider', async () => {
    const res = await call('explain', { id: 'a' });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ state: 'blocked', blockers: [{ id: 'b', title: 'B', status: 'open' }] });
    expect(explain).toHaveBeenCalledWith(provider, root, 'a');
  });

  it('answers 404 for a bead that is not there, without asking bd', async () => {
    const res = await call('explain', { id: 'zzz' });
    expect(res.status).toBe(404);
    expect(explain).not.toHaveBeenCalled();
  });

  it('is refused while a sync runs, and does not need writes to be allowed', async () => {
    sync = { kind: 'running', op: 'pull', startedAt: T0 };
    const running = await call('explain', { id: 'a' });
    expect(errorOf(running.json).code).toBe('sync-running');
    sync = { kind: 'idle' };
    blocked = true;
    expect((await call('explain', { id: 'a' })).status).toBe(200);
  });

  it('a failed read says so in plain words', async () => {
    explain.mockRejectedValueOnce(new BdError('exit', 'bd exploded'));
    const res = await call('explain', { id: 'a' });
    expect(res.status).toBe(500);
    expect(errorOf(res.json).code).toBe('beads-error');
  });
});

describe('history', () => {
  const issueRow = (hash: string, n: number, over: Record<string, unknown>) => ({
    CommitHash: hash, Committer: 'beads', CommitDate: `2026-10-14T10:00:0${n}Z`,
    Issue: { id: 'a', title: 'Title a', status: 'open', priority: 2, issue_type: 'task', created_at: T0, created_by: 'x', updated_at: `2026-10-14T10:00:0${n}Z`, ...over },
  });
  const twoVersions = () => ({
    rows: [issueRow('hhhh2222', 2, { acceptance_criteria: '- [ ] one', priority: 1 }), issueRow('hhhh1111', 1, {})],
    events: null,
  });

  it('pages a bead from the versions bd keeps, without events below 1.3', async () => {
    provider.history.mockResolvedValue(twoVersions());
    const res = await call('history', { id: 'a' });
    expect(res.status).toBe(200);
    expect(provider.history).toHaveBeenCalledWith('a', { limit: 200, events: false });
    expect(res.json.labelsKnown).toBe(false);
    expect(res.json.more).toBe(false);
    expect(res.json.entries.map((e: { created?: true }) => e.created === true)).toEqual([false, true]);
    expect(deps.providerFor).toHaveBeenCalledWith(root, 'embedded');
  });

  it('asks for the audit events on 1.3 and later', async () => {
    workspace = okWorkspace({ bdVersion: '1.3.1' });
    provider.history.mockResolvedValue({ ...twoVersions(), events: [] });
    const res = await call('history', { id: 'a' });
    expect(provider.history).toHaveBeenCalledWith('a', { limit: 200, events: true });
    expect(res.json.labelsKnown).toBe(true);
  });

  it('a restorable change builds the patch and the expected values the update route takes', async () => {
    provider.history.mockResolvedValue(twoVersions());
    const { json } = await call('history', { id: 'a' });
    const entry = json.entries[0];
    expect(entry.restorable).toEqual(['priority', 'acceptance']);
    const patch: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const change of entry.changes.filter((c: { field: string }) => entry.restorable.includes(c.field))) {
      patch[change.field] = change.from;
      expected[change.field] = change.to;
    }
    expect(patch).toEqual({ priority: 2, acceptance: '' });
    expect(expected).toEqual({ priority: 1, acceptance: '- [ ] one' });
    const res = await call('update', { id: 'a', expectedUpdatedAt: T0, patch, expected });
    expect(res.status).toBe(200);
    expect(provider.update).toHaveBeenCalledWith('a', T0, patch, 'Ann (panel)', expected);
  });

  it('reads the gates its own links name from their records, not from the activity the service watched', async () => {
    // Gate rows are not beads: a blocks link to an id the bead cache does not hold is a gate (or one that was deleted).
    beads = [bead('a', { dependencies: [{ from: 'a', to: 'gate-1', kind: 'blocks', createdBy: 'Ann (panel)', createdAt: null }, { from: 'a', to: 'b', kind: 'blocks', createdBy: null, createdAt: null }, { from: 'a', to: 'gate-2', kind: 'related', createdBy: null, createdAt: null }, { from: 'a', to: 'external:proj:cap', kind: 'blocks', createdBy: null, createdAt: null }] }), bead('b')];
    provider.history.mockResolvedValue(twoVersions());
    provider.gateHistory.mockResolvedValue({
      rows: [bead('gate-1', { type: 'gate', status: 'closed', closedAt: '2026-10-14T10:00:05Z', description: 'Ad-hoc gate blocking a\n\nReason: Review before closing', extra: { await_type: 'human' } })],
      events: [{ id: 'e1', beadId: 'gate-1', type: 'closed', actor: 'Claude Code', oldValue: '', newValue: 'Reviewed', rawCreatedAt: '2026-10-14 10:00:05', utcCreatedAt: true }],
    });
    const res = await call('history', { id: 'a' });
    expect(res.status).toBe(200);
    expect(provider.gateHistory).toHaveBeenCalledWith(['gate-1'], { utc: false });
    expect(res.json.entries[0]).toMatchObject({ id: 'gate:gate-1:resolved', actor: 'Claude Code', at: '2026-10-14T10:00:05.000Z', gate: { what: 'resolved', byPanel: false, gateKind: 'human' } });
  });

  it('a bead with no gate links reads no gates', async () => {
    provider.history.mockResolvedValue(twoVersions());
    await call('history', { id: 'a' });
    expect(provider.gateHistory).toHaveBeenCalledWith([], expect.anything());
  });

  it('still lists the versions when the gates cannot be read, and keeps the gate rows it observed', async () => {
    provider.history.mockResolvedValue(twoVersions());
    provider.gateHistory.mockRejectedValue(new BdError('exit', 'nope'));
    (deps.getSnapshot as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      unchanged: false, cursor: 'c', activity: [{ id: 'g1', beadId: 'a', kind: 'gate_opened', gateId: 'g', gateKind: 'human', reason: 'Review', actor: 'Ann (panel)', byPanel: true, observedAt: '2026-10-14T10:00:05Z', unseen: false }],
    });
    const res = await call('history', { id: 'a' });
    expect(res.status).toBe(200);
    expect(res.json.entries[0]).toMatchObject({ id: 'gate:g1', gate: { what: 'requested', byPanel: true } });
  });

  it('is refused while a sync holds the project, like every other read that would queue behind it', async () => {
    sync = { kind: 'running', op: 'pull', startedAt: T0 };
    const res = await call('history', { id: 'a' });
    expect(res.status).toBe(409);
    expect(errorOf(res.json).code).toBe('sync-running');
    expect(provider.history).not.toHaveBeenCalled();
    expect(provider.gateHistory).not.toHaveBeenCalled();
  });

  it('checks what it is given and reads nothing otherwise', async () => {
    for (const body of [{}, { id: '../x' }, { id: 'a', limit: 0 }, { id: 'a', limit: 51 }, { id: 'a', limit: 1.5 }, { id: 'a', limit: '5' }, { id: 'a', before: 'a b' }, { id: 'a', before: 7 }]) {
      expect((await call('history', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await call('history', { id: 'nope' })).status).toBe(404);
    expect(provider.history).not.toHaveBeenCalled();
  });

  it('a failed read says so', async () => {
    provider.history.mockRejectedValue(new BdError('exit', 'bd exploded'));
    const res = await call('history', { id: 'a' });
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});

describe('memories', () => {
  it('lists the memories of the resolved root, with the search', async () => {
    memories.list.mockResolvedValue({ memories: [{ key: 'k', text: 'text', changedAt: T0, changedBy: 'Ann (panel)' }], fingerprint: 'f1' });
    const res = await call('memories', { query: 'tabs' });
    expect(res).toMatchObject({ status: 200, json: { memories: [{ key: 'k' }], fingerprint: 'f1' } });
    expect(memories.list).toHaveBeenCalledWith(root, 'embedded', 'tabs');
    await call('memories');
    expect(memories.list).toHaveBeenLastCalledWith(root, 'embedded', undefined);
  });

  it('is refused while a sync holds the project, since the read would queue behind it', async () => {
    sync = { kind: 'running', op: 'pull', startedAt: T0 };
    const res = await call('memories');
    expect(res.status).toBe(409);
    expect(errorOf(res.json).code).toBe('sync-running');
    expect(memories.list).not.toHaveBeenCalled();
  });

  it('a project that cannot be used is the workspace envelope', async () => {
    workspace = { kind: 'no-workspace' } as WorkspaceState;
    const res = await call('memories');
    expect(res.status).toBe(409);
    expect(errorOf(res.json).code).toBe('workspace');
  });

  it('a failed read says so in plain words', async () => {
    memories.list.mockRejectedValue(new BdError('exit', 'bd exploded'));
    const res = await call('memories');
    expect(res.status).toBe(500);
    expect(errorOf(res.json).code).toBe('beads-error');
  });
});

describe('writes', () => {
  const writes: Array<[string, Record<string, unknown>, ReturnType<typeof vi.fn>]> = [
    ['update', { id: 'a', expectedUpdatedAt: T0, patch: { title: 'New' } }, provider.update],
    ['create', { input: { title: 'x', type: 'task', priority: 2, parentId: null, description: '' } }, provider.create],
    ['comment', { id: 'a', text: 'hi' }, provider.comment],
    ['dependency', { op: 'add', from: 'a', to: 'b', kind: 'blocks' }, provider.dependency],
    ['deferBead', { id: 'a', expectedUpdatedAt: T0, until: '2026-12-01' }, provider.deferBead],
    ['undeferBead', { id: 'a', expectedUpdatedAt: T0 }, provider.undeferBead],
    ['supersede', { id: 'a', with: 'b', expectedUpdatedAt: T0 }, provider.supersede],
    ['duplicate', { id: 'a', of: 'b', expectedUpdatedAt: T0 }, provider.duplicate],
    ['gateCreate', { id: 'a' }, provider.gateCreate],
    ['gateResolve', { gateId: 'g1' }, provider.gateResolve],
    ['humanRespond', { id: 'a', response: 'Use 60s' }, provider.humanRespond],
    ['humanDismiss', { id: 'a' }, provider.humanDismiss],
    ['memoryRemember', { text: 'Use tabs' }, memories.remember],
    ['memoryForget', { key: 'k', expectedText: 'text' }, memories.forget],
  ];

  it('while the project needs the update every write route is refused 409 needs-schema-update and runs nothing; the update itself still runs', async () => {
    skew = { from: 32, to: 66 };
    workspace = okWorkspace({ bdVersion: '1.3.1' });
    for (const [name, body, mock] of [...writes, ['enableEvents', { confirm: true }, provider.enableEventsJournal] as [string, Record<string, unknown>, ReturnType<typeof vi.fn>]]) {
      const res = await call(name, body);
      expect(res.status, name).toBe(409);
      expect(errorOf(res.json), name).toMatchObject({ code: 'needs-schema-update', message: 'This project needs a one-time update for the newer Beads.', schemaUpdate: { from: 32, to: 66 } });
      expect(mock, name).not.toHaveBeenCalled();
    }
    // The explicit update is the one write that passes.
    expect((await call('migrateSchema', { confirm: true })).status).toBe(200);
    await whenUpdateSettled(root);
    expect(provider.migrateSchema).toHaveBeenCalledTimes(1);
  });

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

  it('deferBead passes the date text (or null), the reason and the panel actor', async () => {
    const dated = await call('deferBead', { id: 'a', expectedUpdatedAt: T0, until: 'next friday', reason: ' waiting ' });
    expect(dated.status).toBe(200);
    expect(provider.deferBead).toHaveBeenCalledWith('a', T0, 'next friday', 'waiting', 'Ann (panel)');
    await call('deferBead', { id: 'a', expectedUpdatedAt: T0, until: null });
    expect(provider.deferBead).toHaveBeenLastCalledWith('a', T0, null, undefined, 'Ann (panel)');
  });

  it('undeferBead, supersede and duplicate pass their arguments and the panel actor', async () => {
    await call('undeferBead', { id: 'a', expectedUpdatedAt: T0 });
    expect(provider.undeferBead).toHaveBeenCalledWith('a', T0, 'Ann (panel)');
    await call('supersede', { id: 'a', with: 'b', expectedUpdatedAt: T0 });
    expect(provider.supersede).toHaveBeenCalledWith('a', 'b', T0, 'Ann (panel)');
    await call('duplicate', { id: 'a', of: 'b', expectedUpdatedAt: T0 });
    expect(provider.duplicate).toHaveBeenCalledWith('a', 'b', T0, 'Ann (panel)');
  });

  it('a refused close-as write is a WriteError envelope', async () => {
    provider.supersede.mockRejectedValueOnce(new WriteError('blocked', 'Something blocks it.', 'detail'));
    const res = await call('supersede', { id: 'a', with: 'b', expectedUpdatedAt: T0 });
    expect(errorOf(res.json).code).toBe('blocked');
  });

  it('gateCreate passes the bead, the reason (the default one when absent) and the panel actor, and returns the gate', async () => {
    const asked = await call('gateCreate', { id: 'a', reason: '  Look at the schema  ', kind: 'human' });
    expect(asked.status).toBe(200);
    expect(asked.json).toMatchObject({ ok: true, gate: { id: 'g1' } });
    expect(provider.gateCreate).toHaveBeenCalledWith('a', 'Look at the schema', 'Ann (panel)');
    await call('gateCreate', { id: 'a' });
    expect(provider.gateCreate).toHaveBeenLastCalledWith('a', 'Review before closing', 'Ann (panel)');
  });

  it('gateCreate and gateResolve answer a domain conflict as a 200 body, never an error', async () => {
    provider.gateCreate.mockResolvedValueOnce({ ok: false, code: 'already-open', gate: { id: 'g1' } });
    const open = await call('gateCreate', { id: 'a' });
    expect(open).toMatchObject({ status: 200, json: { ok: false, code: 'already-open' } });
    provider.gateResolve.mockResolvedValueOnce({ ok: false, code: 'already-resolved', resolvedBy: 'Claude Code', at: T0 });
    const resolved = await call('gateResolve', { gateId: 'g1', reason: 'ok' });
    expect(resolved).toMatchObject({ status: 200, json: { ok: false, code: 'already-resolved', resolvedBy: 'Claude Code' } });
    expect(provider.gateResolve).toHaveBeenCalledWith('g1', 'ok', 'Ann (panel)');
  });

  it('gateResolve passes no reason when there is none', async () => {
    await call('gateResolve', { gateId: 'g1' });
    expect(provider.gateResolve).toHaveBeenCalledWith('g1', undefined, 'Ann (panel)');
  });

  it('an old Beads that cannot do it is an error envelope with unsupported', async () => {
    provider.gateCreate.mockRejectedValueOnce(new WriteError('unsupported', 'This version of Beads does not support that.', 'Error: unknown command "gate"'));
    const res = await call('gateCreate', { id: 'a' });
    expect(res.status).toBe(501);
    expect(errorOf(res.json)).toMatchObject({ code: 'unsupported', message: 'This version of Beads does not support that.' });
  });

  it('gate routes refuse a bad id, kind or reason before touching anything', async () => {
    const tooLong = 'x'.repeat(501);
    const cases: Array<[string, Record<string, unknown>]> = [
      ['gateCreate', { id: 'a b' }],
      ['gateCreate', { id: 'a;rm' }],
      ['gateCreate', { id: 'a', kind: 'timer' }],
      ['gateCreate', { id: 'a', reason: '' }],
      ['gateCreate', { id: 'a', reason: '   ' }],
      ['gateCreate', { id: 'a', reason: tooLong }],
      ['gateCreate', { id: 'a', reason: 'one\ntwo' }],
      ['gateCreate', { id: 'a', reason: 7 }],
      ['gateResolve', { gateId: '' }],
      ['gateResolve', { gateId: '../x' }],
      ['gateResolve', { gateId: 'x'.repeat(129) }],
      ['gateResolve', { gateId: 'g1', reason: tooLong }],
      ['gateResolve', { gateId: 'g1', reason: 'a\rb' }],
    ];
    for (const [name, body] of cases) {
      const res = await call(name, body);
      expect(res.status, `${name} ${JSON.stringify(body)}`).toBe(400);
      expect(errorOf(res.json).code).toBe('BAD_REQUEST');
    }
    expect(provider.gateCreate).not.toHaveBeenCalled();
    expect(provider.gateResolve).not.toHaveBeenCalled();
    // A reason of exactly 500 characters is fine.
    expect((await call('gateCreate', { id: 'a', reason: 'x'.repeat(500) })).status).toBe(200);
  });

  it('humanRespond passes the bead, the trimmed answer and the panel actor, and returns the bead', async () => {
    const res = await call('humanRespond', { id: 'a', response: '  Use 60s\nnot 30s  ' });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, bead: { id: 'a', status: 'closed' } });
    expect(provider.humanRespond).toHaveBeenCalledWith('a', 'Use 60s\nnot 30s', 'Ann (panel)');
  });

  it('humanDismiss passes the reason trimmed, and none when it is absent or blank', async () => {
    await call('humanDismiss', { id: 'a', reason: '  Not needed ' });
    expect(provider.humanDismiss).toHaveBeenLastCalledWith('a', 'Not needed', 'Ann (panel)');
    await call('humanDismiss', { id: 'a' });
    expect(provider.humanDismiss).toHaveBeenLastCalledWith('a', undefined, 'Ann (panel)');
    await call('humanDismiss', { id: 'a', reason: '   ' });
    expect(provider.humanDismiss).toHaveBeenLastCalledWith('a', undefined, 'Ann (panel)');
    await call('humanDismiss', { id: 'a', reason: '' });
    expect(provider.humanDismiss).toHaveBeenLastCalledWith('a', undefined, 'Ann (panel)');
  });

  it('a request that is no longer open is a 200 body with the current bead, never an error', async () => {
    provider.humanRespond.mockResolvedValueOnce({ ok: false, code: 'not-open', current: bead('a', { status: 'closed' }) });
    const res = await call('humanRespond', { id: 'a', response: 'Late' });
    expect(res).toMatchObject({ status: 200, json: { ok: false, code: 'not-open', current: { id: 'a' } } });
    provider.humanDismiss.mockResolvedValueOnce({ ok: false, code: 'not-open', current: null });
    expect(await call('humanDismiss', { id: 'a' })).toMatchObject({ status: 200, json: { ok: false, code: 'not-open', current: null } });
  });

  it('humanRespond and humanDismiss map a refusal to its envelope: blocked is 409, an old Beads is 501', async () => {
    provider.humanRespond.mockRejectedValueOnce(new WriteError('blocked', "This bead can't be closed yet.", 'raw'));
    const blockedRes = await call('humanRespond', { id: 'a', response: 'x' });
    expect(blockedRes.status).toBe(409);
    expect(errorOf(blockedRes.json)).toMatchObject({ code: 'blocked', detail: 'raw' });
    provider.humanDismiss.mockRejectedValueOnce(new WriteError('unsupported', 'This version of Beads does not support that.', 'Error: unknown command "human"'));
    const old = await call('humanDismiss', { id: 'a' });
    expect(old.status).toBe(501);
    expect(errorOf(old.json)).toMatchObject({ code: 'unsupported' });
  });

  it('human routes refuse a bad id, answer or reason before touching anything', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['humanRespond', { id: 'a b', response: 'x' }],
      ['humanRespond', { id: '../x', response: 'x' }],
      ['humanRespond', { response: 'x' }],
      ['humanRespond', { id: 'a' }],
      ['humanRespond', { id: 'a', response: 7 }],
      ['humanRespond', { id: 'a', response: '' }],
      ['humanRespond', { id: 'a', response: '   \n ' }],
      ['humanRespond', { id: 'a', response: 'x'.repeat(16_001) }],
      ['humanDismiss', { id: 'a;rm' }],
      ['humanDismiss', { id: 'x'.repeat(129) }],
      ['humanDismiss', { id: 'a', reason: 7 }],
      ['humanDismiss', { id: 'a', reason: 'x'.repeat(501) }],
      ['humanDismiss', { id: 'a', reason: 'one\ntwo' }],
    ];
    for (const [name, body] of cases) {
      const res = await call(name, body);
      expect(res.status, `${name} ${JSON.stringify(body)}`).toBe(400);
      expect(errorOf(res.json).code).toBe('BAD_REQUEST');
    }
    expect(provider.humanRespond).not.toHaveBeenCalled();
    expect(provider.humanDismiss).not.toHaveBeenCalled();
    // The limits themselves are fine.
    expect((await call('humanRespond', { id: 'a', response: 'x'.repeat(16_000) })).status).toBe(200);
    expect((await call('humanDismiss', { id: 'a', reason: 'x'.repeat(500) })).status).toBe(200);
  });

  it('memoryRemember passes the text, key and expected text, with the root, mode and panel actor', async () => {
    const added = await call('memoryRemember', { text: '  Use tabs  ', key: 'go-tabs' });
    expect(added).toMatchObject({ status: 200, json: { ok: true, memory: { key: 'k' } } });
    expect(memories.remember).toHaveBeenLastCalledWith(root, { text: '  Use tabs  ', key: 'go-tabs', expectedText: undefined }, 'Ann (panel)');
    await call('memoryRemember', { text: 'New words', key: 'go-tabs', expectedText: 'Old words' });
    expect(memories.remember).toHaveBeenLastCalledWith(root, { text: 'New words', key: 'go-tabs', expectedText: 'Old words' }, 'Ann (panel)');
    await call('memoryRemember', { text: 'x' });
    expect(memories.remember).toHaveBeenLastCalledWith(root, { text: 'x', key: undefined, expectedText: undefined }, 'Ann (panel)');
  });

  it('memoryForget passes the key and the text the person saw', async () => {
    const res = await call('memoryForget', { key: 'go-tabs', expectedText: 'Use tabs' });
    expect(res).toMatchObject({ status: 200, json: { ok: true, memory: null } });
    expect(memories.forget).toHaveBeenCalledWith(root, { key: 'go-tabs', expectedText: 'Use tabs' }, 'Ann (panel)');
  });

  it('a memory that is not as the person saw it is a 200 body with the current one, never an error', async () => {
    const current = { key: 'k', text: 'Someone else wrote this', changedAt: T0, changedBy: 'Bo (panel)' };
    memories.remember.mockResolvedValueOnce({ ok: false, code: 'changed', current });
    expect(await call('memoryRemember', { text: 'Mine', key: 'k', expectedText: 'Old' })).toMatchObject({ status: 200, json: { ok: false, code: 'changed', current } });
    memories.forget.mockResolvedValueOnce({ ok: false, code: 'changed', current: null });
    expect(await call('memoryForget', { key: 'k', expectedText: 'Old' })).toMatchObject({ status: 200, json: { ok: false, code: 'changed', current: null } });
  });

  it('memory writes map a refusal to its envelope', async () => {
    memories.remember.mockRejectedValueOnce(new WriteError('invalid', 'A memory needs some text.'));
    const bad = await call('memoryRemember', { text: 'x' });
    expect(bad.status).toBe(400);
    expect(errorOf(bad.json)).toMatchObject({ code: 'invalid', message: 'A memory needs some text.' });
    memories.forget.mockRejectedValueOnce(new WriteError('unsupported', 'This version of Beads does not support that.', 'Error: unknown command "forget"'));
    expect((await call('memoryForget', { key: 'k', expectedText: 'x' })).status).toBe(501);
  });

  it('memory routes refuse a bad body before touching anything', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['memoryRemember', {}],
      ['memoryRemember', { text: 7 }],
      ['memoryRemember', { text: 'x', key: 7 }],
      ['memoryRemember', { text: 'x', key: 'k'.repeat(201) }],
      ['memoryRemember', { text: 'x', expectedText: null }],
      ['memoryRemember', { text: 'x', expectedText: 7 }],
      ['memoryRemember', { text: 'x', fingerprint: 'abc', key: ['k'] }],
      ['memoryForget', {}],
      ['memoryForget', { key: 'k' }],
      ['memoryForget', { key: 'k', expectedText: 7 }],
      ['memoryForget', { key: '', expectedText: 'x' }],
      ['memoryForget', { key: 7, expectedText: 'x' }],
      ['memories', { query: 7 }],
      ['memories', { query: 'q'.repeat(201) }],
    ];
    for (const [name, body] of cases) {
      const res = await call(name, body);
      expect(res.status, `${name} ${JSON.stringify(body)}`).toBe(400);
      expect(errorOf(res.json).code).toBe('BAD_REQUEST');
    }
    expect(memories.remember).not.toHaveBeenCalled();
    expect(memories.forget).not.toHaveBeenCalled();
    expect(memories.list).not.toHaveBeenCalled();
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
  it('marks the given ids and returns every bead still unseen: changed beads, deletions and beads with an unseen review row', async () => {
    const res = await call('seen', { ids: ['a', 'gone'] });
    expect(res.status).toBe(200);
    expect(store.markSeen).toHaveBeenCalledWith(['a', 'gone']);
    expect(store.save).toHaveBeenCalledTimes(1);
    // The panel replaces its list with this answer, so a bead whose only news is a review row ('gated') must be on it.
    expect(res.json).toEqual({ unseenIds: ['a', 'gone', 'gated'] });
  });

  it('marks everything with all: true', async () => {
    storeState = { unseen: [] };
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

describe('live updates', () => {
  const modern = () => {
    workspace = okWorkspace({ bdVersion: '1.3.1' });
  };

  it('status reports off, on and unknown, and the follower state', async () => {
    modern();
    provider.eventsJournal.mockResolvedValueOnce('off');
    expect((await call('eventsStatus')).json).toEqual({ available: true, journal: 'off', live: 'off' });
    provider.eventsJournal.mockResolvedValueOnce('on');
    liveState = 'following';
    expect((await call('eventsStatus')).json).toEqual({ available: true, journal: 'on', live: 'following' });
    provider.eventsJournal.mockResolvedValueOnce('unknown');
    expect((await call('eventsStatus')).json).toMatchObject({ available: true, journal: 'unknown' });
    // A read that throws is unknown too, not an error: Settings still opens.
    provider.eventsJournal.mockRejectedValueOnce(new Error('boom'));
    const failed = await call('eventsStatus');
    expect(failed.status).toBe(200);
    expect(failed.json).toMatchObject({ available: true, journal: 'unknown' });
  });

  it('live updates are hidden without the capability (status is available: false, not an error, and nothing is read)', async () => {
    workspace = okWorkspace({ bdVersion: '1.2.2' });
    const res = await call('eventsStatus');
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ available: false, live: 'off' });
    expect(provider.eventsJournal).not.toHaveBeenCalled();
  });

  it('status never starts the follower, and is refused while a sync holds the queue', async () => {
    modern();
    await call('eventsStatus');
    expect(deps.getSnapshot).not.toHaveBeenCalled();
    sync = { kind: 'running', op: 'pull', startedAt: T0 };
    const res = await call('eventsStatus');
    expect(res.status).toBe(409);
    expect(errorOf(res.json).code).toBe('sync-running');
  });

  it('enableEvents refuses without confirm: only the literal true counts, and nothing is written', async () => {
    modern();
    for (const body of [{}, { confirm: false }, { confirm: 'true' }, { confirm: 1 }, { confirm: null }]) {
      const res = await call('enableEvents', body);
      expect(res.status).toBe(400);
      expect(errorOf(res.json).code).toBe('BAD_REQUEST');
    }
    expect(provider.enableEventsJournal).not.toHaveBeenCalled();
  });

  it('enableEvents refuses below 1.3 with the unsupported envelope, and nothing is written', async () => {
    workspace = okWorkspace({ bdVersion: '1.2.2' });
    const res = await call('enableEvents', { confirm: true });
    expect(res.status).toBe(501);
    expect(errorOf(res.json)).toMatchObject({ code: 'unsupported' });
    expect(res.json.ok).toBeUndefined();
    expect(provider.enableEventsJournal).not.toHaveBeenCalled();
  });

  it('enableEvents runs exactly one enable with the panel actor, tells the follower, and answers the status read after', async () => {
    modern();
    liveState = 'off';
    const res = await call('enableEvents', { confirm: true });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, status: { available: true, journal: 'on', live: 'off' } });
    expect(provider.enableEventsJournal).toHaveBeenCalledTimes(1);
    expect(provider.enableEventsJournal).toHaveBeenCalledWith('Ann (panel)');
    expect(deps.providerFor).toHaveBeenCalledWith(root, 'embedded');
    expect(journalChanged).toHaveBeenCalledWith(root);
    // No other write path ran.
    for (const name of ['update', 'create', 'comment', 'dependency'] as const) expect(provider[name]).not.toHaveBeenCalled();
  });

  it('a finished enable is answered on, even if a Sync started meanwhile or the setting cannot be read again', async () => {
    modern();
    // The enable resolved (the adapter read it back as on); a pull pressed since must not turn that into a 409.
    provider.enableEventsJournal.mockImplementationOnce(async () => {
      sync = { kind: 'running', op: 'pull', startedAt: T0 };
    });
    liveState = 'following';
    const res = await call('enableEvents', { confirm: true });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, status: { available: true, journal: 'on', live: 'following' } });
    expect(provider.eventsJournal).not.toHaveBeenCalled();
  });

  it('an enable that was saved but could not be confirmed is a 504 with saved, and still tells the follower', async () => {
    modern();
    provider.enableEventsJournal.mockRejectedValueOnce(new WriteError('uncertain', 'Saved, but could not confirm.', 'reads back as unknown', true));
    const res = await call('enableEvents', { confirm: true });
    expect(res.status).toBe(504);
    expect(errorOf(res.json)).toMatchObject({ code: 'uncertain', saved: true });
    expect(journalChanged).toHaveBeenCalledWith(root);
  });

  it('enableEvents goes through the write guard: refused while a sync runs and while the merge is half done', async () => {
    modern();
    sync = { kind: 'running', op: 'pull', startedAt: T0 };
    const running = await call('enableEvents', { confirm: true });
    expect(running.status).toBe(409);
    expect(errorOf(running.json).code).toBe('sync-running');
    sync = { kind: 'idle' };
    blocked = true;
    const half = await call('enableEvents', { confirm: true });
    expect(half.status).toBe(409);
    expect(errorOf(half.json).code).toBe('writes-blocked');
    expect(provider.enableEventsJournal).not.toHaveBeenCalled();
    expect(journalChanged).not.toHaveBeenCalled();
  });

  it('enableEvents answers a failed write as the error envelope and does not tell the follower', async () => {
    modern();
    provider.enableEventsJournal.mockRejectedValueOnce(new WriteError('failed', "Beads didn't turn live updates on.", 'reads back as off'));
    const res = await call('enableEvents', { confirm: true });
    expect(res.status).toBe(500);
    expect(errorOf(res.json)).toMatchObject({ code: 'failed', detail: 'reads back as off' });
    expect(journalChanged).not.toHaveBeenCalled();
  });
});

describe('migrateSchema (the explicit update of a project on an older schema)', () => {
  it('refuses without confirm: only the literal true counts, and nothing is run', async () => {
    for (const body of [{}, { confirm: false }, { confirm: 'true' }, { confirm: 1 }, { confirm: null }]) {
      const res = await call('migrateSchema', body);
      expect(res.status).toBe(400);
      expect(errorOf(res.json).code).toBe('BAD_REQUEST');
    }
    expect(provider.migrateSchema).not.toHaveBeenCalled();
    expect(readFailureDropped).not.toHaveBeenCalled();
  });

  const press = async () => {
    const res = await call('migrateSchema', { confirm: true });
    await whenUpdateSettled(root);
    return res;
  };

  it('starts the update and answers at once; it runs once with the panel actor and drops the cached read failure when it ends', async () => {
    let finish: () => void = () => undefined;
    provider.migrateSchema.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    const res = await call('migrateSchema', { confirm: true });
    // Answered while the update is still running.
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(updateJob(root)).toMatchObject({ kind: 'running' });
    expect(readFailureDropped).not.toHaveBeenCalled();
    finish();
    await whenUpdateSettled(root);
    expect(provider.migrateSchema).toHaveBeenCalledTimes(1);
    expect(provider.migrateSchema).toHaveBeenCalledWith('Ann (panel)');
    expect(updateJob(root)).toBeNull();
    expect(readFailureDropped).toHaveBeenCalledTimes(1);
    expect(readFailureDropped).toHaveBeenCalledWith(root);
    for (const name of ['update', 'create', 'comment', 'dependency', 'enableEventsJournal'] as const) expect(provider[name]).not.toHaveBeenCalled();
  });

  it('a second press while it runs starts nothing and answers the same', async () => {
    let finish: () => void = () => undefined;
    provider.migrateSchema.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    skew = { from: 32, to: 66 };
    expect((await call('migrateSchema', { confirm: true })).status).toBe(200);
    expect((await call('migrateSchema', { confirm: true })).json).toEqual({ ok: true });
    finish();
    await whenUpdateSettled(root);
    expect(provider.migrateSchema).toHaveBeenCalledTimes(1);
  });

  it('while it runs, every write and every read that would wait behind it is refused 409 needs-schema-update at once', async () => {
    let finish: () => void = () => undefined;
    provider.migrateSchema.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    skew = { from: 32, to: 66 };
    await call('migrateSchema', { confirm: true });
    for (const [name, body] of [['update', { id: 'a', expectedUpdatedAt: T0, patch: { title: 'x' } }], ['comment', { id: 'a', text: 'hi' }], ['history', { id: 'a' }], ['sync-preview', {}]] as Array<[string, Record<string, unknown>]>) {
      const res = await call(name, body);
      expect(res.status, name).toBe(409);
      expect(errorOf(res.json), name).toMatchObject({ code: 'needs-schema-update', schemaUpdate: { from: 32, to: 66 } });
    }
    expect(provider.update).not.toHaveBeenCalled();
    finish();
    await whenUpdateSettled(root);
  });

  it('goes through the write guard: refused while a sync runs and while the merge is half done', async () => {
    sync = { kind: 'running', op: 'pull', startedAt: T0 };
    const running = await press();
    expect(running.status).toBe(409);
    expect(errorOf(running.json).code).toBe('sync-running');
    sync = { kind: 'idle' };
    blocked = true;
    const half = await press();
    expect(half.status).toBe(409);
    expect(errorOf(half.json).code).toBe('writes-blocked');
    expect(provider.migrateSchema).not.toHaveBeenCalled();
    expect(readFailureDropped).not.toHaveBeenCalled();
    expect(updateJob(root)).toBeNull();
  });

  it('a refused update ends as a failed job with the error, and keeps the cached failure', async () => {
    provider.migrateSchema.mockRejectedValueOnce(new WriteError('failed', 'The change could not be saved.', 'Error: nope'));
    expect((await press()).status).toBe(200);
    expect(updateJob(root)).toEqual({ kind: 'failed', at: expect.any(String), code: 'failed', message: 'The change could not be saved.', detail: 'Error: nope' });
    expect(readFailureDropped).not.toHaveBeenCalled();
  });

  it('a store shared with the team ends as a failed job update-blocked-shared with the message and the detail', async () => {
    provider.migrateSchema.mockRejectedValueOnce(new WriteError('update-blocked-shared', 'This project shares its beads with your team.', 'refusing to auto-apply 34 pending schema migrations'));
    await press();
    expect(updateJob(root)).toEqual({ kind: 'failed', at: expect.any(String), code: 'update-blocked-shared', message: 'This project shares its beads with your team.', detail: 'refusing to auto-apply 34 pending schema migrations' });
    expect(readFailureDropped).not.toHaveBeenCalled();
  });

  it('an update saved but not confirmed ends as a failed job with saved, and still drops the cached failure so the next snapshot reads again', async () => {
    provider.migrateSchema.mockRejectedValueOnce(new WriteError('uncertain', 'May be updated.', 'read-back failed', true));
    await press();
    expect(updateJob(root)).toMatchObject({ kind: 'failed', code: 'uncertain', saved: true });
    expect(readFailureDropped).toHaveBeenCalledWith(root);
  });

  it('a try after a failure starts again and clears it', async () => {
    provider.migrateSchema.mockRejectedValueOnce(new WriteError('failed', 'The change could not be saved.', 'Error: nope'));
    await press();
    expect(updateJob(root)?.kind).toBe('failed');
    await press();
    expect(provider.migrateSchema).toHaveBeenCalledTimes(2);
    expect(updateJob(root)).toBeNull();
  });

  it('a read refused for the old schema is answered needs-schema-update with the two versions, in plain copy', async () => {
    const stderr = readFileSync(join(__dirname, '../../fixtures/bd13/schema-skew.stderr'), 'utf8').trim();
    (deps.cachedBeads as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (deps.getSnapshot as ReturnType<typeof vi.fn>).mockRejectedValue(new BdError('exit', stderr.replace(/^Error: /, ''), { code: 1, stderr }));
    const res = await call('bead', { id: 'a' });
    expect(res.status).toBe(409);
    expect(errorOf(res.json)).toMatchObject({ code: 'needs-schema-update', message: 'This project needs a one-time update for the newer Beads.', schemaUpdate: { from: 32, to: 66 } });
    expect(errorOf(res.json).detail).toContain('schema version mismatch');
  });
});
