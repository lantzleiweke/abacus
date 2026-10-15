import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/service/bd/exec', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/service/bd/exec')>()),
  runBd: vi.fn(),
  runBdJson: vi.fn(),
  runDolt: vi.fn(),
  runGit: vi.fn(),
}));
vi.mock('../../../src/service/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/service/workspace')>()),
  detectWorkspace: vi.fn(),
}));
vi.mock('../../../src/service/bd/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/service/bd/audit')>()),
  readAuditEvents: vi.fn(),
}));

import { BdProvider, panelActor, resetPanelActorCache, withRootQueue } from '../../../src/service/bd/adapter';
import { readAuditEvents, type AuditEvent } from '../../../src/service/bd/audit';
import { BdError, runBd, runBdJson, runDolt, runGit } from '../../../src/service/bd/exec';
import { getSnapshot, projectStore, resetSnapshotState, resolveWorkspace, setClock, setStorageDir } from '../../../src/service/snapshot';
import { detectWorkspace } from '../../../src/service/workspace';
import type { SnapshotResponse, WorkspaceState } from '../../../src/shared/types';

const bd = vi.mocked(runBd);
const bdJson = vi.mocked(runBdJson);
const dolt = vi.mocked(runDolt);
const git = vi.mocked(runGit);
const detect = vi.mocked(detectWorkspace);
const auditRead = vi.mocked(readAuditEvents);

const ok = (stdout: string) => ({ stdout, stderr: '', code: 0 });

function issueLine(id: string, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    _type: 'issue',
    id,
    title: `Title ${id}`,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
    ...over,
  });
}

const STATUSES = JSON.stringify({
  built_in_statuses: [
    { name: 'open', category: 'active', icon: 'o' },
    { name: 'closed', category: 'done', icon: 'x' },
  ],
});
const TYPES = JSON.stringify({ core_types: [{ name: 'task', description: '' }, { name: 'bug', description: '' }] });

/** A tiny fake of bd and dolt that answers by the command it is given and counts the calls. */
type Fake = {
  export: string | (() => string | Error);
  ready: string[];
  signal: string;
  signalError: Error | null;
  exportCalls: number;
  signalCalls: number;
  statusesCalls: number;
  readyCalls: number;
  /** What `bd vc status` answers: a commit hash, or an error. */
  vcCommit: string;
  vcError: Error | null;
  vcCalls: number;
  log: string[][];
};
let fake: Fake;

function install(): void {
  // runBdJson calls the real runBd inside exec.ts, so it is faked on top of the fake runBd.
  bdJson.mockImplementation(async (dir, args, opts) => JSON.parse((await bd(dir, args, opts)).stdout) as never);
  bd.mockImplementation(async (_dir, args) => {
    fake.log.push(args);
    const name = args.find((a) => !a.startsWith('-'));
    if (name === 'export') {
      fake.exportCalls += 1;
      const out = typeof fake.export === 'function' ? fake.export() : fake.export;
      if (out instanceof Error) throw out;
      return ok(out);
    }
    if (name === 'statuses') {
      fake.statusesCalls += 1;
      return ok(STATUSES);
    }
    if (name === 'types') return ok(TYPES);
    if (name === 'ready') {
      fake.readyCalls += 1;
      return ok(JSON.stringify(fake.ready.map((id) => ({ id }))));
    }
    if (name === 'vc') {
      fake.vcCalls += 1;
      if (fake.vcError) throw fake.vcError;
      return ok(JSON.stringify({ branch: 'main', commit: fake.vcCommit, schema_version: 1 }));
    }
    if (name === 'sql') {
      fake.signalCalls += 1;
      if (fake.signalError) throw fake.signalError;
      return ok(JSON.stringify([{ working: fake.signal, head: 'h' }]));
    }
    throw new Error(`unexpected bd call: ${args.join(' ')}`);
  });
  dolt.mockImplementation(async (_cwd, args) => {
    fake.log.push(['dolt', ...args]);
    fake.signalCalls += 1;
    if (fake.signalError) throw fake.signalError;
    return ok(JSON.stringify({ rows: [{ working: fake.signal, head: 'h' }] }));
  });
  git.mockResolvedValue(ok('Ann\n'));
}

let tmp: string;
let root: string;
let now: number;
const T0 = Date.parse('2026-10-14T10:00:00.000Z');

function okWorkspace(mode: 'embedded' | 'server' = 'embedded'): WorkspaceState {
  return { kind: 'ok', root, mode, bdVersion: '1.2.2', hasRemote: false, projectName: 'demo' };
}

async function makeRoot(mode: 'embedded' | 'server'): Promise<void> {
  await mkdir(join(root, '.beads'), { recursive: true });
  await writeFile(join(root, '.beads', 'metadata.json'), JSON.stringify({ dolt_mode: mode, dolt_database: 'testdb' }));
}

function full(res: SnapshotResponse): Extract<SnapshotResponse, { unchanged: false }> {
  if (res.unchanged) throw new Error('expected a full snapshot');
  return res;
}

beforeEach(async () => {
  bd.mockReset();
  bdJson.mockReset();
  dolt.mockReset();
  git.mockReset();
  detect.mockReset();
  auditRead.mockReset();
  auditRead.mockResolvedValue([]);
  resetPanelActorCache();
  resetSnapshotState();
  tmp = await mkdtemp(join(tmpdir(), 'oc-beads-adapter-'));
  root = join(tmp, 'proj');
  await makeRoot('embedded');
  setStorageDir(join(tmp, 'state'));
  now = T0;
  setClock(() => now);
  fake = {
    export: [issueLine('a'), issueLine('b')].join('\n'),
    ready: ['a'],
    signal: 's1',
    signalError: null,
    exportCalls: 0,
    signalCalls: 0,
    statusesCalls: 0,
    readyCalls: 0,
    vcCommit: 'c1',
    vcError: null,
    vcCalls: 0,
    log: [],
  };
  install();
  detect.mockResolvedValue(okWorkspace());
});

afterEach(async () => {
  setClock(null);
  setStorageDir(null);
  resetSnapshotState();
  await rm(tmp, { recursive: true, force: true });
});

describe('withRootQueue', () => {
  it('runs calls for one root one after another, in order', async () => {
    const order: string[] = [];
    const gate = { release: () => {} };
    const first = withRootQueue('/r', async () => {
      order.push('first start');
      await new Promise<void>((resolve) => (gate.release = resolve));
      order.push('first end');
      return 1;
    });
    const second = withRootQueue('/r', async () => {
      order.push('second start');
      return 2;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(['first start']);
    gate.release();
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(order).toEqual(['first start', 'first end', 'second start']);
  });

  it('keeps going after a call fails, and hands the failure to its own caller', async () => {
    const failed = withRootQueue('/r', async () => {
      throw new Error('boom');
    });
    const next = withRootQueue('/r', async () => 'fine');
    await expect(failed).rejects.toThrow('boom');
    expect(await next).toBe('fine');
  });

  it('does not make one root wait for another', async () => {
    let release = () => {};
    const slow = withRootQueue('/one', () => new Promise<void>((resolve) => (release = resolve)));
    expect(await withRootQueue('/two', async () => 'quick')).toBe('quick');
    release();
    await slow;
  });
});

describe('panelActor', () => {
  it('is the git user name plus " (panel)", asked once per root', async () => {
    expect(await panelActor(root)).toBe('Ann (panel)');
    expect(await panelActor(root)).toBe('Ann (panel)');
    expect(git).toHaveBeenCalledTimes(1);
    expect(git.mock.calls[0]![0]).toBe(root);
    expect(git.mock.calls[0]![1]).toEqual(['config', 'user.name']);
  });

  it('falls back to the OS user when git has no name or fails', async () => {
    git.mockResolvedValueOnce({ stdout: '', stderr: '', code: 1 });
    expect(await panelActor(root)).toBe(`${userInfo().username} (panel)`);
    resetPanelActorCache();
    git.mockRejectedValueOnce(new BdError('not-found', 'git missing'));
    expect(await panelActor(root)).toBe(`${userInfo().username} (panel)`);
  });
});

describe('BdProvider', () => {
  it('reads with --readonly and two lock retries, one command per read', async () => {
    const provider = new BdProvider(root, 'server');
    fake.export = issueLine('a');
    expect((await provider.export()).map((b) => b.id)).toEqual(['a']);
    expect((await provider.statuses()).map((s) => s.name)).toEqual(['open', 'closed']);
    expect(await provider.types()).toEqual(['task', 'bug']);
    expect(await provider.ready()).toEqual(['a']);
    for (const [dir, args, opts] of bd.mock.calls) {
      expect(dir).toBe(root);
      expect(args[0]).toBe('--readonly');
      expect(opts).toMatchObject({ retries: 2 });
    }
    expect(bd.mock.calls.map((c) => c[1])).toEqual([
      ['--readonly', 'export'],
      ['--readonly', 'statuses', '--json'],
      ['--readonly', 'types', '--json'],
      ['--readonly', 'ready', '--json', '--limit', '0'],
    ]);
  });

  it('reads the signal through bd sql in server mode', async () => {
    const provider = new BdProvider(root, 'server');
    expect(await provider.changeSignal()).toBe('s1:h');
    const [, args, opts] = bd.mock.calls[0]!;
    expect(args.slice(0, 3)).toEqual(['--readonly', 'sql', '--json']);
    expect(args[3]).toBe("SELECT DOLT_HASHOF_DB() AS working, DOLT_HASHOF('HEAD') AS head");
    expect(opts).toMatchObject({ retries: 2 });
    expect(dolt).not.toHaveBeenCalled();
  });

  it('reads the signal with the dolt CLI inside the database folder in embedded mode', async () => {
    const provider = new BdProvider(root, 'embedded');
    expect(await provider.changeSignal()).toBe('s1:h');
    const [cwd, args] = dolt.mock.calls[0]!;
    expect(cwd).toBe(join(root, '.beads', 'embeddeddolt', 'testdb'));
    expect(args.slice(0, 3)).toEqual(['sql', '-r', 'json']);
    expect(bd).not.toHaveBeenCalled();
  });

  it('fails the export when bd exits non-zero, with the cause kept', async () => {
    bd.mockResolvedValueOnce({ stdout: '', stderr: 'Error: something broke', code: 1 });
    await expect(new BdProvider(root, 'server').export()).rejects.toMatchObject({ kind: 'exit' });
  });

  it('fails the export when output is present but nothing in it parsed', async () => {
    fake.export = 'this is not json\nneither is this';
    await expect(new BdProvider(root, 'server').export()).rejects.toMatchObject({ kind: 'parse' });
  });

  it('accepts an empty project and ignores lines that are not issues', async () => {
    fake.export = '';
    expect(await new BdProvider(root, 'server').export()).toEqual([]);
    fake.export = `${JSON.stringify({ _type: 'memory', key: 'k' })}\n${issueLine('a')}`;
    expect((await new BdProvider(root, 'server').export()).map((b) => b.id)).toEqual(['a']);
  });

  it('queues its reads behind other calls for the same root', async () => {
    let release = () => {};
    const blocker = withRootQueue(root, () => new Promise<void>((resolve) => (release = resolve)));
    const pending = new BdProvider(root, 'server').ready();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(bd).not.toHaveBeenCalled();
    release();
    await blocker;
    expect(await pending).toEqual(['a']);
  });
});

describe('getSnapshot', () => {
  it('returns the beads, statuses, types and ready ids on first read', async () => {
    const res = full(await getSnapshot(root));
    expect(res.workspace.kind).toBe('ok');
    expect(res.beads.map((b) => b.id)).toEqual(['a', 'b']);
    expect(res.statuses.map((s) => s.name)).toEqual(['open', 'closed']);
    expect(res.types).toEqual(['task', 'bug']);
    expect(res.readyIds).toEqual(['a']);
    expect(res.unseenIds).toEqual([]);
    expect(res.freshness).toEqual({ localRefreshedAt: new Date(T0).toISOString(), localError: null, localErrorDetail: null, teamSyncedAt: null, unpublished: null });
    expect(res.sync).toEqual({ kind: 'idle' });
    expect(res.cursor).toEqual(expect.any(String));
  });

  it('shares one refresh between callers that ask while it is running', async () => {
    const [a, b, c] = await Promise.all([getSnapshot(root), getSnapshot(root), getSnapshot(root)]);
    expect(fake.exportCalls).toBe(1);
    expect(fake.signalCalls).toBe(1);
    expect(full(a).beads).toEqual(full(b).beads);
    expect(full(c).cursor).toBe(full(a).cursor);
  });

  it('skips the export while the signal has not moved, and exports when it moves', async () => {
    await getSnapshot(root);
    expect(fake.exportCalls).toBe(1);
    now += 5_000;
    await getSnapshot(root);
    expect(fake.signalCalls).toBe(2);
    expect(fake.exportCalls).toBe(1);
    fake.signal = 's2';
    fake.export = [issueLine('a'), issueLine('b'), issueLine('c')].join('\n');
    now += 5_000;
    const res = full(await getSnapshot(root));
    expect(fake.exportCalls).toBe(2);
    expect(res.beads.map((b) => b.id)).toEqual(['a', 'b', 'c']);
  });

  it('reads the signal at most once every 4 seconds however often it is polled', async () => {
    await getSnapshot(root);
    for (let i = 0; i < 5; i += 1) {
      now += 700;
      await getSnapshot(root);
    }
    // 3.5 s passed: still the one first read.
    expect(fake.signalCalls).toBe(1);
    now += 600;
    await getSnapshot(root);
    expect(fake.signalCalls).toBe(2);
  });

  it('answers from the cache inside the throttle even when the signal would have moved', async () => {
    await getSnapshot(root);
    fake.signal = 's2';
    now += 1_000;
    await getSnapshot(root);
    expect(fake.signalCalls).toBe(1);
    expect(fake.exportCalls).toBe(1);
  });

  it('exports once a minute even when the signal never moves', async () => {
    await getSnapshot(root);
    now += 59_000;
    await getSnapshot(root);
    expect(fake.exportCalls).toBe(1);
    // The poll at 59 s read the signal; the next window after the minute exports.
    now += 5_000;
    await getSnapshot(root);
    expect(fake.exportCalls).toBe(2);
  });

  it('fetches statuses and types on the first read and on the minute, not on every export', async () => {
    await getSnapshot(root);
    fake.signal = 's2';
    now += 5_000;
    await getSnapshot(root);
    expect(fake.exportCalls).toBe(2);
    expect(fake.statusesCalls).toBe(1);
    expect(fake.readyCalls).toBe(2);
  });

  it('answers unchanged when the caller already has the current cursor', async () => {
    const first = full(await getSnapshot(root));
    now += 5_000;
    const again = await getSnapshot(root, first.cursor);
    expect(again.unchanged).toBe(true);
    if (again.unchanged) {
      expect(again.cursor).toBe(first.cursor);
      expect(again.freshness.localRefreshedAt).toBe(new Date(now).toISOString());
      expect(again.sync).toEqual({ kind: 'idle' });
    }
    fake.signal = 's2';
    fake.export = issueLine('a');
    now += 5_000;
    const moved = await getSnapshot(root, first.cursor);
    expect(moved.unchanged).toBe(false);
    expect(moved.cursor).not.toBe(first.cursor);
  });

  it('moves the cursor when the seen state changes', async () => {
    const first = full(await getSnapshot(root));
    (await projectStore(root)).markSeen('all');
    const second = await getSnapshot(root, first.cursor);
    expect(second.unchanged).toBe(false);
  });

  describe('when a refresh fails', () => {
    it('keeps the last data, says so in plain language, and keeps the raw cause apart', async () => {
      const before = full(await getSnapshot(root));
      fake.signal = 's2';
      fake.export = () => new BdError('exit', 'bd failed: Error 1105 something raw', { stderr: 'raw stderr text' });
      now += 5_000;
      const res = full(await getSnapshot(root));
      expect(res.beads).toEqual(before.beads);
      expect(res.statuses).toEqual(before.statuses);
      expect(res.freshness.localError).toBe("Couldn't read beads. Retrying.");
      expect(res.freshness.localErrorDetail).toContain('something raw');
      expect(res.freshness.localErrorDetail).toContain('raw stderr text');
      expect(res.freshness.localError).not.toContain('raw');
      expect(res.freshness.localRefreshedAt).toBe(new Date(T0).toISOString());
    });

    it('says busy for a lock or a timeout', async () => {
      await getSnapshot(root);
      fake.signal = 's2';
      fake.export = () => new BdError('lock', 'bd is busy: lock');
      now += 5_000;
      expect(full(await getSnapshot(root)).freshness.localError).toBe('Beads is busy. Retrying.');
      fake.export = () => new BdError('timeout', 'bd timed out after 15000 ms');
      now += 5_000;
      expect(full(await getSnapshot(root)).freshness.localError).toBe('Beads is busy. Retrying.');
    });

    it('tries again after the throttle, recovers, and clears the error', async () => {
      await getSnapshot(root);
      fake.signal = 's2';
      let failing = true;
      fake.export = () => (failing ? new BdError('exit', 'nope') : [issueLine('a'), issueLine('z')].join('\n'));
      now += 5_000;
      expect(full(await getSnapshot(root)).freshness.localError).not.toBeNull();
      // Inside the throttle nothing is retried.
      failing = false;
      now += 1_000;
      expect(full(await getSnapshot(root)).freshness.localError).not.toBeNull();
      expect(fake.exportCalls).toBe(2);
      now += 4_000;
      const res = full(await getSnapshot(root));
      expect(res.freshness.localError).toBeNull();
      expect(res.freshness.localErrorDetail).toBeNull();
      expect(res.beads.map((b) => b.id)).toEqual(['a', 'z']);
    });

    it('never applies an export that parsed to nothing', async () => {
      const before = full(await getSnapshot(root));
      fake.signal = 's2';
      fake.export = 'garbage that is not json';
      now += 5_000;
      const res = full(await getSnapshot(root));
      expect(res.beads).toEqual(before.beads);
      expect(res.freshness.localError).toBe("Couldn't read beads. Retrying.");
      expect(res.activity).toEqual([]);
    });

    it('returns the workspace with empty beads and an error when the very first read fails', async () => {
      fake.export = () => new BdError('exit', 'nope');
      const res = full(await getSnapshot(root));
      expect(res.workspace.kind).toBe('ok');
      expect(res.beads).toEqual([]);
      expect(res.freshness.localError).toBe("Couldn't read beads. Retrying.");
      // Not loaded yet, so the same cursor never counts as unchanged.
      expect((await getSnapshot(root, res.cursor)).unchanged).toBe(false);
    });

    it('falls back to exporting when the signal cannot be read, at most once per throttle window', async () => {
      fake.signalError = new BdError('lock', 'busy');
      const res = full(await getSnapshot(root));
      expect(res.beads.map((b) => b.id)).toEqual(['a', 'b']);
      expect(fake.exportCalls).toBe(1);
      now += 1_000;
      await getSnapshot(root);
      expect(fake.exportCalls).toBe(1);
      now += 4_000;
      await getSnapshot(root);
      expect(fake.exportCalls).toBe(2);
    });
  });

  describe('throttle while reads keep failing', () => {
    it('does not export again inside the window after a failed first export', async () => {
      fake.export = () => new BdError('exit', 'nope');
      await getSnapshot(root);
      expect(fake.exportCalls).toBe(1);
      now += 1_000;
      await getSnapshot(root);
      now += 1_000;
      await getSnapshot(root);
      expect(fake.exportCalls).toBe(1);
      now += 3_000;
      await getSnapshot(root);
      expect(fake.exportCalls).toBe(2);
    });

    it('does not export again inside the window after a failed minute pass', async () => {
      await getSnapshot(root);
      expect(fake.exportCalls).toBe(1);
      fake.export = () => new BdError('exit', 'nope');
      now += 61_000;
      await getSnapshot(root);
      expect(fake.exportCalls).toBe(2);
      now += 1_000;
      const res = full(await getSnapshot(root));
      expect(fake.exportCalls).toBe(2);
      expect(res.freshness.localError).not.toBeNull();
    });
  });

  describe('whole exports only', () => {
    it('applies nothing when one line of an export cannot be read', async () => {
      const before = full(await getSnapshot(root));
      fake.signal = 's2';
      fake.export = [issueLine('a'), '{"truncated', issueLine('c')].join('\n');
      now += 5_000;
      const res = full(await getSnapshot(root));
      expect(res.beads).toEqual(before.beads);
      expect(res.activity.filter((e) => e.kind === 'deleted')).toEqual([]);
      expect(res.freshness.localError).toBe("Couldn't read beads. Retrying.");
      expect(res.freshness.localErrorDetail).toContain('1 line');
      expect(res.freshness.localErrorDetail).toContain('{"truncated');
    });

    it('quotes at most 200 characters of the bad line', async () => {
      await getSnapshot(root);
      fake.signal = 's2';
      fake.export = `${issueLine('a')}\n{"x":"${'y'.repeat(500)}`;
      now += 5_000;
      const detail = full(await getSnapshot(root)).freshness.localErrorDetail ?? '';
      expect(detail).toContain('y'.repeat(150));
      expect(detail).not.toContain('y'.repeat(300));
    });
  });

  describe('an export with no beads when beads are held', () => {
    const deleted = (res: ReturnType<typeof full>) => res.activity.filter((e) => e.kind === 'deleted').map((e) => e.beadId).sort();

    it('is not applied until a second read also finds none, so a passing empty read never shows every bead as deleted', async () => {
      await getSnapshot(root);
      fake.signal = 's2';
      fake.export = '';
      now += 5_000;
      const held = full(await getSnapshot(root));
      expect(held.beads.map((b) => b.id)).toEqual(['a', 'b']);
      expect(held.freshness.localError).toBe('Beads returned no issues. Checking again.');
      expect(deleted(held)).toEqual([]);

      now += 5_000;
      const applied = full(await getSnapshot(root));
      expect(applied.beads).toEqual([]);
      expect(applied.freshness.localError).toBeNull();
      expect(deleted(applied)).toEqual(['a', 'b']);
    });

    it('applies the next read normally when it finds the beads again', async () => {
      await getSnapshot(root);
      fake.signal = 's2';
      fake.export = '';
      now += 5_000;
      await getSnapshot(root);
      fake.export = [issueLine('a'), issueLine('b'), issueLine('c')].join('\n');
      now += 5_000;
      const res = full(await getSnapshot(root));
      expect(res.beads.map((b) => b.id)).toEqual(['a', 'b', 'c']);
      expect(res.freshness.localError).toBeNull();
      expect(deleted(res)).toEqual([]);
    });

    it('is held again after a non-empty export was applied in between', async () => {
      await getSnapshot(root);
      fake.signal = 's2';
      fake.export = '';
      now += 5_000;
      await getSnapshot(root);
      fake.signal = 's3';
      fake.export = [issueLine('a'), issueLine('b')].join('\n');
      now += 5_000;
      await getSnapshot(root);
      fake.signal = 's4';
      fake.export = '';
      now += 5_000;
      const held = full(await getSnapshot(root));
      expect(held.beads.map((b) => b.id)).toEqual(['a', 'b']);
      expect(held.freshness.localError).toBe('Beads returned no issues. Checking again.');
      expect(deleted(held)).toEqual([]);
    });

    it('is held again when a failed read came between two empty reads', async () => {
      await getSnapshot(root);
      fake.signal = 's2';
      fake.export = '';
      now += 5_000;
      await getSnapshot(root);
      fake.export = () => new BdError('exit', 'nope');
      now += 5_000;
      expect(full(await getSnapshot(root)).freshness.localError).toBe("Couldn't read beads. Retrying.");
      fake.export = '';
      now += 5_000;
      const held = full(await getSnapshot(root));
      expect(held.beads.map((b) => b.id)).toEqual(['a', 'b']);
      expect(held.freshness.localError).toBe('Beads returned no issues. Checking again.');
      expect(deleted(held)).toEqual([]);
    });

    it('is read again at the next window even when the signal has not moved', async () => {
      await getSnapshot(root);
      // The minute pass exports without a moved signal and finds nothing.
      fake.export = '';
      now += 60_000;
      const held = full(await getSnapshot(root));
      expect(held.beads.map((b) => b.id)).toEqual(['a', 'b']);
      expect(held.freshness.localError).toBe('Beads returned no issues. Checking again.');
      const exportsBefore = fake.exportCalls;
      now += 5_000;
      const applied = full(await getSnapshot(root));
      expect(fake.exportCalls).toBe(exportsBefore + 1);
      expect(applied.beads).toEqual([]);
    });

    it('is applied at once when nothing is held yet', async () => {
      fake.export = '';
      const res = full(await getSnapshot(root));
      expect(res.beads).toEqual([]);
      expect(res.freshness.localError).toBeNull();
    });
  });

  describe('cursor', () => {
    it('is not "unchanged" for a panel holding old data after a failed export and then a good one with only an undiffed field changed', async () => {
      await getSnapshot(root);
      fake.signal = 's2';
      fake.export = () => new BdError('exit', 'nope');
      now += 5_000;
      const during = full(await getSnapshot(root));
      expect(during.freshness.localError).not.toBeNull();
      fake.export = [issueLine('a', { owner: 'zed' }), issueLine('b')].join('\n');
      now += 5_000;
      const after = await getSnapshot(root, during.cursor);
      expect(after.unchanged).toBe(false);
      expect(after.cursor).not.toBe(during.cursor);
    });

    it('stays "unchanged" while the data held is the same, even across a failed read', async () => {
      const first = full(await getSnapshot(root));
      fake.signal = 's2';
      fake.export = () => new BdError('exit', 'nope');
      now += 5_000;
      expect((await getSnapshot(root, first.cursor)).unchanged).toBe(true);
    });

    it('changes with the workspace answer and carries a per-process prefix', async () => {
      const first = full(await getSnapshot(root));
      detect.mockResolvedValue({ kind: 'ok', root, mode: 'embedded', bdVersion: '1.2.2', hasRemote: true, projectName: 'demo' });
      const again = full(await getSnapshot(root, first.cursor, true));
      expect(again.cursor).not.toBe(first.cursor);
      expect(first.cursor.split(':')[0]).toMatch(/^[0-9a-f]{8}$/);
      expect(first.cursor.split(':')[0]).toBe(again.cursor.split(':')[0]);
    });
  });

  describe('saving the panel state', () => {
    it('puts a failed save in the detail and leaves localError empty', async () => {
      const store = await projectStore(root);
      vi.spyOn(store, 'save').mockRejectedValue(new Error('disk full'));
      const res = full(await getSnapshot(root));
      expect(res.beads).toHaveLength(2);
      expect(res.freshness.localError).toBeNull();
      expect(res.freshness.localErrorDetail).toContain('disk full');
    });

    it('keeps the save failure in the detail through polls that save nothing, until a save works', async () => {
      const store = await projectStore(root);
      const save = vi.spyOn(store, 'save').mockRejectedValue(new Error('disk full'));
      await getSnapshot(root);
      now += 5_000;
      expect(full(await getSnapshot(root)).freshness.localErrorDetail).toContain('disk full');
      save.mockRestore();
      fake.signal = 's2';
      now += 5_000;
      const res = full(await getSnapshot(root));
      expect(res.freshness.localErrorDetail).toBeNull();
    });
  });

  describe("a write the panel could not note", () => {
    function answerDependencyWrites(): void {
      const base = bd.getMockImplementation()!;
      bd.mockImplementation(async (dir, args, opts) => (args.includes('dep') ? ok(JSON.stringify({ status: 'added' })) : base(dir, args, opts)));
    }

    it('keeps the failure in the detail after a create, comment or link that succeeded, until a note works', async () => {
      answerDependencyWrites();
      await getSnapshot(root);
      const store = await projectStore(root);
      const record = vi.spyOn(store, 'recordPanelWrite').mockImplementation(() => {
        throw new Error('state is locked');
      });
      await new BdProvider(root, 'embedded').dependency('add', 'a', 'b', 'blocks', 'Ann (panel)');
      now += 5_000;
      expect(full(await getSnapshot(root, undefined, true)).freshness.localErrorDetail).toContain('state is locked');

      record.mockRestore();
      await new BdProvider(root, 'embedded').dependency('add', 'a', 'b', 'blocks', 'Ann (panel)');
      now += 5_000;
      expect(full(await getSnapshot(root, undefined, true)).freshness.localErrorDetail).toBeNull();
    });
  });

  describe('the wall clock', () => {
    it('counts a clock that went back as due for the signal read', async () => {
      await getSnapshot(root);
      expect(fake.signalCalls).toBe(1);
      now = T0 - 10_000;
      await getSnapshot(root);
      expect(fake.signalCalls).toBe(2);
      now += 1_000;
      await getSnapshot(root);
      expect(fake.signalCalls).toBe(2);
    });

    it('counts a clock that went back as due for the minute pass too', async () => {
      await getSnapshot(root);
      now = T0 - 10_000;
      await getSnapshot(root);
      expect(fake.exportCalls).toBe(2);
    });
  });

  describe('when the change signal cannot be read', () => {
    const noDolt = () => new BdError('not-found', 'dolt could not be started');

    it('falls back to bd vc status in embedded mode', async () => {
      fake.signalError = noDolt();
      await getSnapshot(root);
      expect(fake.vcCalls).toBe(1);
      now += 5_000;
      await getSnapshot(root);
      expect(fake.exportCalls).toBe(1);
      fake.vcCommit = 'c2';
      fake.export = [issueLine('a'), issueLine('b'), issueLine('c')].join('\n');
      now += 5_000;
      expect(full(await getSnapshot(root)).beads.map((b) => b.id)).toEqual(['a', 'b', 'c']);
      expect(fake.exportCalls).toBe(2);
      expect(fake.log.filter((a) => a.includes('vc')).every((a) => a[0] === '--readonly' && a.includes('--json'))).toBe(true);
    });

    it('exports at most once a minute when no signal can be had at all', async () => {
      fake.signalError = noDolt();
      fake.vcError = new BdError('exit', 'vc failed');
      await getSnapshot(root);
      expect(fake.exportCalls).toBe(1);
      for (let t = 5; t <= 55; t += 5) {
        now += 5_000;
        await getSnapshot(root);
      }
      expect(fake.exportCalls).toBe(1);
      expect(full(await getSnapshot(root)).freshness.localErrorDetail).toBe('Change detection unavailable; checking every minute.');
      now += 5_000;
      await getSnapshot(root);
      expect(fake.exportCalls).toBe(2);
    });

    it('says nothing about it when a signal can be read', async () => {
      expect(full(await getSnapshot(root)).freshness.localErrorDetail).toBeNull();
    });

    it('still exports every window when the signal is only busy', async () => {
      fake.signalError = new BdError('lock', 'busy');
      await getSnapshot(root);
      now += 5_000;
      await getSnapshot(root);
      expect(fake.exportCalls).toBe(2);
      expect(fake.vcCalls).toBe(0);
    });
  });

  describe('the mode of a root', () => {
    it('is not flipped back by a caller whose cached workspace is out of date', async () => {
      const worktree = join(tmp, 'wt');
      detect.mockImplementation(async (dir) => (dir === worktree ? okWorkspace('server') : okWorkspace('embedded')));
      await getSnapshot(worktree);
      expect(fake.log.some((a) => a[0] === '--readonly' && a.includes('sql'))).toBe(true);
      now += 5_000;
      await getSnapshot(root, undefined, true);
      fake.log.length = 0;
      now += 5_000;
      await getSnapshot(worktree);
      expect(fake.log.some((a) => a[0] === 'dolt')).toBe(true);
      expect(fake.log.some((a) => a[0] === '--readonly' && a.includes('sql'))).toBe(false);
    });
  });

  describe('audit reads', () => {
    it("use the root's mode, not the mode of the worktree workspace that asked", async () => {
      const worktree = join(tmp, 'wt');
      detect.mockImplementation(async (dir) => (dir === worktree ? okWorkspace('server') : okWorkspace('embedded')));
      await getSnapshot(worktree);
      now += 5_000;
      await getSnapshot(root, undefined, true);
      auditRead.mockClear();
      fake.signal = 's2';
      fake.export = [issueLine('a'), issueLine('b', { title: 'New', updated_at: '2026-10-14T10:00:00Z' })].join('\n');
      now += 5_000;
      await getSnapshot(worktree);
      expect(auditRead).toHaveBeenCalled();
      for (const call of auditRead.mock.calls) expect(call[1]).toBe('embedded');
    });
  });

  describe('resolveWorkspace', () => {
    it('gives the same cached answer as getSnapshot, with the root', async () => {
      const first = await resolveWorkspace(root);
      expect(first).toEqual({ workspace: okWorkspace(), root });
      await getSnapshot(root);
      await resolveWorkspace(root);
      expect(detect).toHaveBeenCalledTimes(1);
    });

    it('has no root for a state that names none, and detects again when asked', async () => {
      detect.mockResolvedValueOnce({ kind: 'no-bd' });
      expect(await resolveWorkspace(root)).toEqual({ workspace: { kind: 'no-bd' }, root: null });
      expect((await resolveWorkspace(root, { refreshWorkspace: true })).root).toBe(root);
      expect(detect).toHaveBeenCalledTimes(2);
    });

    it('gives a root only for a usable project, never before consent or while the server is down', async () => {
      const states: WorkspaceState[] = [
        { kind: 'needs-first-contact', root, lastOpenedWith: '1.1.0', bdVersion: '1.2.2' },
        { kind: 'pre-dolt', root },
        { kind: 'server-down', root, port: 3307 },
        { kind: 'bd-too-old', bdVersion: '0.1.0' },
        { kind: 'no-workspace' },
      ];
      for (const state of states) {
        resetSnapshotState();
        detect.mockResolvedValue(state);
        expect(await resolveWorkspace(root)).toEqual({ workspace: state, root: null });
      }
      resetSnapshotState();
      detect.mockResolvedValue(okWorkspace());
      expect((await resolveWorkspace(root)).root).toBe(root);
    });

    it('rejects when a requested re-detection fails, instead of returning the old answer', async () => {
      await resolveWorkspace(root);
      detect.mockRejectedValueOnce(new BdError('lock', 'busy'));
      await expect(resolveWorkspace(root, { refreshWorkspace: true })).rejects.toMatchObject({ kind: 'lock' });
      // Without a refresh request the cached answer is still served.
      expect((await resolveWorkspace(root)).root).toBe(root);
    });

    it('passes a mode change it finds on to the root cache', async () => {
      await getSnapshot(root);
      expect(fake.log.some((a) => a[0] === 'dolt')).toBe(true);
      detect.mockResolvedValue(okWorkspace('server'));
      await resolveWorkspace(root, { refreshWorkspace: true });
      fake.log.length = 0;
      now += 5_000;
      await getSnapshot(root);
      expect(fake.log.some((a) => a[0] === '--readonly' && a.includes('sql'))).toBe(true);
      expect(fake.log.some((a) => a[0] === 'dolt')).toBe(false);
    });
  });

  describe('when the installed bd changes', () => {
    let bin: string;
    let savedPath: string | undefined;
    const exe = () => join(bin, 'bd');

    beforeEach(async () => {
      bin = join(tmp, 'bin');
      await mkdir(bin, { recursive: true });
      await writeFile(exe(), '#!/bin/sh\n', { mode: 0o755 });
      await utimes(exe(), new Date(1_700_000_000_000), new Date(1_700_000_000_000));
      savedPath = process.env.PATH;
      process.env.PATH = `${bin}:${savedPath ?? ''}`;
    });

    afterEach(() => {
      process.env.PATH = savedPath;
    });

    it('detects again, before any bd call, when the bd file is replaced', async () => {
      detect.mockImplementation(async () => {
        fake.log.push(['detect']);
        return okWorkspace();
      });
      await getSnapshot(root);
      now += 5_000;
      await getSnapshot(root);
      expect(detect).toHaveBeenCalledTimes(1);
      await utimes(exe(), new Date(1_800_000_000_000), new Date(1_800_000_000_000));
      fake.log.length = 0;
      fake.signal = 's2';
      now += 5_000;
      await getSnapshot(root);
      expect(detect).toHaveBeenCalledTimes(2);
      expect(fake.log[0]).toEqual(['detect']);
    });

    it('follows a symlinked bd to the real file', async () => {
      const real = join(tmp, 'real-bd');
      await writeFile(real, '#!/bin/sh\n', { mode: 0o755 });
      await rm(exe());
      await symlink(real, exe());
      await getSnapshot(root);
      await utimes(real, new Date(1_900_000_000_000), new Date(1_900_000_000_000));
      now += 5_000;
      await getSnapshot(root);
      expect(detect).toHaveBeenCalledTimes(2);
    });

    it('applies to resolveWorkspace too, so other routes never act on the old answer', async () => {
      await resolveWorkspace(root);
      await utimes(exe(), new Date(1_800_000_000_000), new Date(1_800_000_000_000));
      await resolveWorkspace(root);
      expect(detect).toHaveBeenCalledTimes(2);
    });

    it('runs no bd call on the old answer when the new detection fails', async () => {
      await getSnapshot(root);
      await utimes(exe(), new Date(1_800_000_000_000), new Date(1_800_000_000_000));
      detect.mockRejectedValueOnce(new BdError('lock', 'busy'));
      bd.mockClear();
      dolt.mockClear();
      now += 5_000;
      await expect(getSnapshot(root)).rejects.toMatchObject({ kind: 'lock' });
      expect(bd).not.toHaveBeenCalled();
      expect(dolt).not.toHaveBeenCalled();
    });
  });

  describe('workspace detection', () => {
    it('runs once per directory, and again only when asked', async () => {
      await getSnapshot(root);
      now += 5_000;
      await getSnapshot(root);
      await getSnapshot(root);
      expect(detect).toHaveBeenCalledTimes(1);
      await getSnapshot(root, undefined, true);
      expect(detect).toHaveBeenCalledTimes(2);
    });

    it('returns a workspace that is not ok with nothing else and no bd call, and keeps returning it', async () => {
      detect.mockResolvedValue({ kind: 'no-bd' });
      const res = full(await getSnapshot(root));
      expect(res).toMatchObject({ workspace: { kind: 'no-bd' }, beads: [], statuses: [], types: [], readyIds: [], unseenIds: [], activity: [] });
      expect(res.sync).toEqual({ kind: 'idle' });
      expect(full(await getSnapshot(root, res.cursor)).workspace.kind).toBe('no-bd');
      expect(bd).not.toHaveBeenCalled();
      expect(dolt).not.toHaveBeenCalled();
      expect(auditRead).not.toHaveBeenCalled();
      expect(detect).toHaveBeenCalledTimes(1);
    });

    it('picks up a changed workspace when asked to detect again', async () => {
      detect.mockResolvedValueOnce({ kind: 'server-down', root, port: 3307 });
      expect(full(await getSnapshot(root)).workspace.kind).toBe('server-down');
      expect(bd).not.toHaveBeenCalled();
      const res = full(await getSnapshot(root, undefined, true));
      expect(res.workspace.kind).toBe('ok');
      expect(res.beads.map((b) => b.id)).toEqual(['a', 'b']);
    });

    it('detects again with consent when the project store has already confirmed that bd version', async () => {
      const needs: WorkspaceState = { kind: 'needs-first-contact', root, lastOpenedWith: '1.1.0', bdVersion: '1.2.2' };
      detect.mockResolvedValueOnce(needs);
      const store = await projectStore(root);
      store.confirmFirstContact('1.2.2');
      const res = full(await getSnapshot(root));
      expect(detect).toHaveBeenCalledTimes(2);
      expect(detect.mock.calls[0]![1]?.confirmedFirstContact).toBeFalsy();
      expect(detect.mock.calls[1]![1]).toMatchObject({ confirmedFirstContact: true });
      expect(res.workspace.kind).toBe('ok');
    });

    it('stays on first contact when the confirmation was for another bd version', async () => {
      detect.mockResolvedValue({ kind: 'needs-first-contact', root, lastOpenedWith: '1.1.0', bdVersion: '1.3.0' });
      const store = await projectStore(root);
      store.confirmFirstContact('1.2.2');
      expect(full(await getSnapshot(root)).workspace.kind).toBe('needs-first-contact');
      expect(detect).toHaveBeenCalledTimes(1);
      expect(bd).not.toHaveBeenCalled();
    });

    it('rethrows a failed first detection, and keeps the old workspace when a later one fails', async () => {
      detect.mockRejectedValueOnce(new BdError('lock', 'busy'));
      await expect(getSnapshot(root)).rejects.toMatchObject({ kind: 'lock' });
      detect.mockResolvedValueOnce(okWorkspace());
      const res = full(await getSnapshot(root));
      expect(res.workspace.kind).toBe('ok');
      detect.mockRejectedValueOnce(new BdError('timeout', 'slow'));
      const again = full(await getSnapshot(root, undefined, true));
      expect(again.workspace.kind).toBe('ok');
      expect(again.freshness.localError).toBe('Beads is busy. Retrying.');
    });

    it('shares one detection between concurrent callers', async () => {
      await Promise.all([getSnapshot(root), getSnapshot(root)]);
      expect(detect).toHaveBeenCalledTimes(1);
    });
  });

  describe('history and attribution', () => {
    const event = (beadId: string, type: string, actor = 'Someone'): AuditEvent => ({
      id: `e-${beadId}-${type}`,
      beadId,
      type,
      actor,
      oldValue: null,
      newValue: null,
      rawCreatedAt: '2026-10-10 10:00:00',
    });

    it('seeds the activity feed from the newest 50 audit events on the first read, as seen history', async () => {
      auditRead.mockResolvedValueOnce([event('a', 'created', 'Old Actor')]);
      const res = full(await getSnapshot(root));
      expect(auditRead).toHaveBeenCalledTimes(1);
      expect(auditRead).toHaveBeenCalledWith(root, 'embedded', { limit: 50 });
      expect(res.activity).toHaveLength(1);
      expect(res.activity[0]).toMatchObject({ beadId: 'a', kind: 'created', historical: true, unseen: false, actor: 'Old Actor' });
      expect(res.unseenIds).toEqual([]);
    });

    it('still takes a baseline when the audit log is unavailable', async () => {
      auditRead.mockResolvedValueOnce(null);
      const res = full(await getSnapshot(root));
      expect(res.activity).toEqual([]);
      expect(res.beads).toHaveLength(2);
    });

    it('does not backfill again once a baseline exists', async () => {
      await getSnapshot(root);
      auditRead.mockClear();
      fake.signal = 's2';
      fake.export = [issueLine('a'), issueLine('b', { title: 'New', updated_at: '2026-10-14T10:00:00Z' })].join('\n');
      now += 5_000;
      await getSnapshot(root);
      expect(auditRead).toHaveBeenCalledTimes(1);
      expect(auditRead.mock.calls[0]![2]).toMatchObject({ beadIds: ['b'] });
    });

    it('reads audit events only for the beads that changed, and shows the change as unseen with its actor', async () => {
      await getSnapshot(root);
      auditRead.mockClear();
      auditRead.mockResolvedValueOnce([{ ...event('c', 'created', 'Teammate') }]);
      fake.signal = 's2';
      fake.export = [issueLine('a'), issueLine('b'), issueLine('c', { created_by: null })].join('\n');
      now += 5_000;
      const res = full(await getSnapshot(root));
      expect(auditRead).toHaveBeenCalledTimes(1);
      expect(auditRead).toHaveBeenCalledWith(root, 'embedded', expect.objectContaining({ beadIds: ['c'] }));
      expect(res.unseenIds).toEqual(['c']);
      expect(res.activity[0]).toMatchObject({ beadId: 'c', kind: 'created', actor: 'Teammate', unseen: true, byPanel: false });
      expect(res.activity[0]!.historical).toBeUndefined();
    });

    it('does not read the audit log when nothing changed', async () => {
      await getSnapshot(root);
      auditRead.mockClear();
      now += 61_000;
      await getSnapshot(root);
      expect(fake.exportCalls).toBe(2);
      expect(auditRead).not.toHaveBeenCalled();
    });

    it('reads the audit log in batches of 200 bead ids and joins what comes back', async () => {
      fake.export = '';
      await getSnapshot(root);
      auditRead.mockClear();
      const ids = Array.from({ length: 250 }, (_, i) => `n-${i}`);
      fake.signal = 's2';
      fake.export = ids.map((id) => issueLine(id)).join('\n');
      auditRead.mockImplementation(async (_r, _m, opts) => (opts.beadIds ?? []).map((id) => event(id, 'created', `Actor of ${id}`)));
      now += 5_000;
      const res = full(await getSnapshot(root));
      expect(auditRead).toHaveBeenCalledTimes(2);
      expect(auditRead.mock.calls[0]![2].beadIds).toHaveLength(200);
      expect(auditRead.mock.calls[1]![2].beadIds).toHaveLength(50);
      // The feed holds the newest 200 of the 250 changes: n-50 to n-249.
      expect(res.activity).toHaveLength(200);
      const byBead = new Map(res.activity.map((e) => [e.beadId, e]));
      expect(byBead.get('n-60')!.actor).toBe('Actor of n-60');
      expect(byBead.get('n-249')!.actor).toBe('Actor of n-249');
    });

    it('treats a batch the audit reader could not answer as no audit for that batch', async () => {
      fake.export = '';
      await getSnapshot(root);
      const ids = Array.from({ length: 250 }, (_, i) => `n-${i}`);
      fake.signal = 's2';
      fake.export = ids.map((id) => issueLine(id)).join('\n');
      let call = 0;
      auditRead.mockImplementation(async (_r, _m, opts) => {
        call += 1;
        return call === 1 ? null : (opts.beadIds ?? []).map((id) => event(id, 'created', 'From audit'));
      });
      now += 5_000;
      const res = full(await getSnapshot(root));
      const byBead = new Map(res.activity.map((e) => [e.beadId, e]));
      expect(byBead.get('n-100')!.actor).toBeNull();
      expect(byBead.get('n-249')!.actor).toBe('From audit');
    });

    it('lists an unseen deletion in unseenIds and clears it when marked seen', async () => {
      await getSnapshot(root);
      fake.signal = 's2';
      fake.export = issueLine('a');
      now += 5_000;
      const res = full(await getSnapshot(root));
      expect(res.unseenIds).toEqual(['b']);
      expect(res.activity[0]).toMatchObject({ beadId: 'b', kind: 'deleted', unseen: true });
      (await projectStore(root)).markSeen('all', new Date(now + 1).toISOString());
      now += 5_000;
      const after = full(await getSnapshot(root));
      expect(after.unseenIds).toEqual([]);
      expect(after.activity[0]!.unseen).toBe(false);
    });

    it('treats the panel\'s own changes as its own', async () => {
      await getSnapshot(root);
      auditRead.mockClear();
      auditRead.mockResolvedValueOnce([
        { ...event('a', 'updated', 'Ann (panel)'), newValue: JSON.stringify({ title: 'Mine' }) },
      ]);
      fake.signal = 's2';
      fake.export = [issueLine('a', { title: 'Mine', updated_at: '2026-10-14T10:00:00Z' }), issueLine('b')].join('\n');
      now += 5_000;
      const res = full(await getSnapshot(root));
      expect(res.activity[0]).toMatchObject({ beadId: 'a', byPanel: true, unseen: false });
      expect(res.unseenIds).toEqual([]);
    });

    it('persists the store after a refresh', async () => {
      await getSnapshot(root);
      resetSnapshotState();
      // A fresh process: the saved baseline is there, so no backfill and no stale "everything is new".
      auditRead.mockClear();
      fake.signal = 's9';
      const res = full(await getSnapshot(root));
      expect(res.unseenIds).toEqual([]);
      expect(auditRead).not.toHaveBeenCalled();
    });
  });

  it('answers beads in a worktree from one shared cache for the same root', async () => {
    const other = join(tmp, 'proj-wt');
    await mkdir(other, { recursive: true });
    detect.mockResolvedValue(okWorkspace());
    await getSnapshot(root);
    await getSnapshot(other);
    expect(fake.exportCalls).toBe(1);
    expect(detect).toHaveBeenCalledTimes(2);
  });
});
