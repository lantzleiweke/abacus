import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BdError } from '../../../src/service/bd/exec';
import { detectWorkspace, resetVersionCache } from '../../../src/service/workspace';

let tmp: string;
let bin: string;
let log: string;
let cwdLog: string;
const servers: Server[] = [];

beforeEach(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), 'oc-beads-ws-')));
  bin = join(tmp, 'bin');
  log = join(tmp, 'bd-calls.log');
  cwdLog = join(tmp, 'bd-cwds.log');
  await mkdir(bin);
  resetVersionCache();
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  await rm(tmp, { recursive: true, force: true });
});

/** A fake `bd` that logs every call and answers `--version` and the remote list. */
async function fakeBd(version: string, remotesJson = '[]'): Promise<void> {
  const path = join(bin, 'bd');
  await writeFile(
    path,
    `#!/bin/sh
echo "$@" >> "${log}"
echo "$PWD" >> "${cwdLog}"
case "$*" in
  "--version") echo "bd version ${version} (Homebrew)" ;;
  "--readonly dolt remote list --json") echo '${remotesJson}' ;;
  *) echo "unexpected call: $*" >&2; exit 2 ;;
esac
`,
  );
  await chmod(path, 0o755);
}

async function calls(): Promise<string[]> {
  try {
    return (await readFile(log, 'utf8')).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

interface ProjectFiles {
  metadata?: Record<string, unknown> | string;
  localVersion?: string;
  /** Tracked files only, as after `git clone`: no local database yet. */
  freshClone?: boolean;
}

const EMBEDDED = { database: 'dolt', backend: 'dolt', dolt_mode: 'embedded', dolt_database: 'demo', project_id: 'p-1' };

async function project(name: string, files: ProjectFiles = {}): Promise<string> {
  const root = join(tmp, name);
  await mkdir(join(root, '.beads'), { recursive: true });
  const metadata = files.metadata ?? EMBEDDED;
  await writeFile(join(root, '.beads', 'metadata.json'), typeof metadata === 'string' ? metadata : JSON.stringify(metadata));
  if (files.localVersion !== undefined) await writeFile(join(root, '.beads', '.local_version'), files.localVersion);
  if (!files.freshClone) await mkdir(join(root, '.beads', 'embeddeddolt'));
  return root;
}

const detect = (dir: string, confirmedFirstContact?: boolean) =>
  detectWorkspace(dir, { searchDirs: [bin], confirmedFirstContact });

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await new Promise((done) => server.close(done));
  return port;
}

async function listenOnPort(): Promise<number> {
  const server = createServer((socket) => socket.destroy());
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return (server.address() as { port: number }).port;
}

describe('no workspace', () => {
  it('reports no-workspace without calling bd when no .beads folder is above the directory', async () => {
    await fakeBd('1.2.2');
    const dir = join(tmp, 'plain', 'deep');
    await mkdir(dir, { recursive: true });
    expect(await detect(dir)).toEqual({ kind: 'no-workspace' });
    expect(await calls()).toEqual([]);
  });

  it('reports no-workspace when .beads has no readable metadata', async () => {
    await fakeBd('1.2.2');
    const missing = await project('missing-meta');
    await rm(join(missing, '.beads', 'metadata.json'));
    const broken = await project('broken-meta', { metadata: '{ not json' });
    expect(await detect(missing)).toEqual({ kind: 'no-workspace' });
    expect(await detect(broken)).toEqual({ kind: 'no-workspace' });
    expect(await calls()).toEqual([]);
  });
});

describe('fresh clone', () => {
  it('reports no-workspace for an embedded project with no local database, without spawning bd', async () => {
    await fakeBd('1.2.2');
    const root = await project('clone', { freshClone: true });
    expect(await detect(root)).toEqual({ kind: 'no-workspace' });
    expect(await calls()).toEqual([]);
  });

  it('does not take the fresh-clone shortcut when the mode is missing or unknown: bd is asked instead', async () => {
    await fakeBd('1.2.2');
    const missing = await project('no-mode', { metadata: { database: 'dolt', dolt_database: 'demo' }, freshClone: true });
    expect(await detect(missing)).toMatchObject({ kind: 'ok' });
    const callsAfterMissing = (await calls()).length;
    expect(callsAfterMissing).toBeGreaterThan(0);
    const unknown = await project('weird-mode', { metadata: { database: 'dolt', dolt_mode: 'weird', dolt_database: 'demo' }, freshClone: true });
    expect(await detect(unknown)).toMatchObject({ kind: 'ok' });
    expect((await calls()).length).toBeGreaterThan(callsAfterMissing);
  });

  it('reports no-workspace for a server project when bd says there is no database', async () => {
    await writeFile(
      join(bin, 'bd'),
      '#!/bin/sh\ncase "$*" in\n  "--version") echo "bd version 1.2.2" ;;\n  *) echo "Error: no beads database found" >&2; exit 1 ;;\nesac\n',
    );
    await chmod(join(bin, 'bd'), 0o755);
    const root = await project('clone', {
      metadata: { database: 'dolt', dolt_mode: 'server', dolt_database: 'beads_demo' },
      freshClone: true,
    });
    expect(await detect(root)).toEqual({ kind: 'no-workspace' });
  });

  it('still rejects for a server project when bd fails for another reason', async () => {
    await writeFile(
      join(bin, 'bd'),
      '#!/bin/sh\ncase "$*" in\n  "--version") echo "bd version 1.2.2" ;;\n  *) echo "Error: boom" >&2; exit 1 ;;\nesac\n',
    );
    await chmod(join(bin, 'bd'), 0o755);
    const root = await project('srv', { metadata: { database: 'dolt', dolt_mode: 'server' }, freshClone: true });
    await expect(detect(root)).rejects.toMatchObject({ kind: 'exit' });
  });
});

describe('pre-dolt', () => {
  it('reports pre-dolt for database beads.db and never calls bd', async () => {
    await fakeBd('1.2.2');
    const root = await project('old', { metadata: { database: 'beads.db', backend: 'sqlite' }, localVersion: '0.20.0' });
    expect(await detect(root)).toEqual({ kind: 'pre-dolt', root });
    expect(await calls()).toEqual([]);
  });

  it('reports pre-dolt for an old SQLite beads.db with no metadata.json, without calling bd', async () => {
    await fakeBd('1.2.2');
    const root = join(tmp, 'sqlite-only');
    await mkdir(join(root, '.beads'), { recursive: true });
    await writeFile(join(root, '.beads', 'beads.db'), 'SQLite format 3\0');
    expect(await detect(root)).toEqual({ kind: 'pre-dolt', root });
    expect(await calls()).toEqual([]);
  });

  it('reports pre-dolt even when bd is not installed', async () => {
    const root = await project('old', { metadata: { database: 'beads.db' } });
    expect(await detect(root)).toEqual({ kind: 'pre-dolt', root });
  });
});

describe('bd availability and version', () => {
  it('reports no-bd when bd is not on the search path', async () => {
    const root = await project('p', { localVersion: '1.2.2' });
    expect(await detect(root)).toEqual({ kind: 'no-bd' });
  });

  it('reports bd-too-old below 1.2.2 and calls nothing but --version', async () => {
    await fakeBd('1.2.1');
    const root = await project('p', { localVersion: '1.0.3' });
    expect(await detect(root)).toEqual({ kind: 'bd-too-old', bdVersion: '1.2.1' });
    expect(await calls()).toEqual(['--version']);
  });

  it('compares versions by number, not text', async () => {
    await fakeBd('1.10.0');
    const root = await project('p', { localVersion: '1.10.0' });
    const state = await detect(root);
    expect(state).toMatchObject({ kind: 'ok', bdVersion: '1.10.0' });
  });

  it('rejects with a parse error when --version prints no version', async () => {
    await writeFile(join(bin, 'bd'), '#!/bin/sh\necho nonsense\n');
    await chmod(join(bin, 'bd'), 0o755);
    const root = await project('p');
    await expect(detect(root)).rejects.toMatchObject({ kind: 'parse' });
    await expect(detect(root)).rejects.toBeInstanceOf(BdError);
  });

  it('caches bd --version per process and refreshes when the executable changes', async () => {
    await fakeBd('1.2.2');
    const root = await project('p', { localVersion: '1.2.2' });
    await detect(root);
    await detect(root);
    expect((await calls()).filter((call) => call === '--version')).toHaveLength(1);

    await fakeBd('1.3.0');
    const exe = join(bin, 'bd');
    const bumped = new Date((await stat(exe)).mtimeMs + 5_000);
    await utimes(exe, bumped, bumped);
    // The upgrade is visible at once: the project's 1.2.2 is now older than bd.
    expect(await detect(root)).toMatchObject({ kind: 'needs-first-contact', bdVersion: '1.3.0', lastOpenedWith: '1.2.2' });
    expect((await calls()).filter((call) => call === '--version')).toHaveLength(2);
  });

  it('does not cache a failed version lookup', async () => {
    // One executable whose path and mtime never change; only a state file decides what it prints.
    const state = join(tmp, 'bd-state');
    const exe = join(bin, 'bd');
    await writeFile(
      exe,
      `#!/bin/sh\ncase "$*" in\n  "--version") if [ -f "${state}" ]; then echo nonsense; else echo "bd version 1.2.2"; fi ;;\n  *) echo '[]' ;;\nesac\n`,
    );
    await chmod(exe, 0o755);
    const fixed = new Date('2026-01-01T00:00:00Z');
    await utimes(exe, fixed, fixed);
    await writeFile(state, '');
    const root = await project('p', { localVersion: '1.2.2' });
    await expect(detect(root)).rejects.toMatchObject({ kind: 'parse' });
    await rm(state);
    expect(await detect(root)).toMatchObject({ kind: 'ok', bdVersion: '1.2.2' });
  });

  it('rejects with an exit error, keeping code and stderr, when --version fails', async () => {
    await writeFile(join(bin, 'bd'), '#!/bin/sh\necho "bd: broken install" >&2\nexit 3\n');
    await chmod(join(bin, 'bd'), 0o755);
    const root = await project('p');
    await expect(detect(root)).rejects.toMatchObject({ kind: 'exit', code: 3, stderr: expect.stringContaining('broken install') });
  });

  it('runs bd --version beside the executable, never inside the project', async () => {
    await fakeBd('1.2.2');
    const root = await project('p', { localVersion: '1.0.3' });
    expect(await detect(root)).toMatchObject({ kind: 'needs-first-contact' });
    expect(await calls()).toEqual(['--version']);
    expect((await readFile(cwdLog, 'utf8')).trim()).toBe(bin);
  });
});

describe('first contact', () => {
  it('asks first when .local_version is older than bd, without any call beyond --version', async () => {
    await fakeBd('1.2.2');
    const root = await project('p', { localVersion: '1.0.3\n' });
    expect(await detect(root)).toEqual({
      kind: 'needs-first-contact',
      root,
      lastOpenedWith: '1.0.3',
      bdVersion: '1.2.2',
    });
    expect(await calls()).toEqual(['--version']);
  });

  it('proceeds once the user has confirmed', async () => {
    await fakeBd('1.2.2');
    const root = await project('p', { localVersion: '1.0.3' });
    expect(await detect(root, true)).toMatchObject({ kind: 'ok', root });
  });

  it('does not ask when .local_version matches', async () => {
    await fakeBd('1.2.2');
    const same = await project('same', { localVersion: '1.2.2' });
    expect(await detect(same)).toMatchObject({ kind: 'ok' });
  });

  it('stops at a project last opened with a newer Beads, without any call beyond --version', async () => {
    await fakeBd('1.2.2');
    const newer = await project('newer', { localVersion: '1.3.0\n' });
    // Even after consent for an older one: this Beads would rewrite what the newer one left.
    expect(await detect(newer, true)).toEqual({ kind: 'bd-too-old', bdVersion: '1.2.2', lastOpenedWith: '1.3.0' });
    expect(await calls()).toEqual(['--version']);
  });

  it('does not ask when .local_version is missing or unreadable', async () => {
    await fakeBd('1.2.2');
    const missing = await project('missing');
    const junk = await project('junk', { localVersion: 'garbage' });
    expect(await detect(missing)).toMatchObject({ kind: 'ok' });
    expect(await detect(junk)).toMatchObject({ kind: 'ok' });
  });
});

describe('server mode', () => {
  it('reports server-down when the fixed port refuses connections, without a remote lookup', async () => {
    await fakeBd('1.2.2');
    const port = await freePort();
    const root = await project('srv', {
      metadata: { database: 'dolt', dolt_mode: 'server', dolt_server_port: port, dolt_database: 'dolt' },
      localVersion: '1.2.2',
    });
    expect(await detect(root)).toEqual({ kind: 'server-down', root, port });
    expect(await calls()).toEqual(['--version']);
  });

  it('is ok when the fixed port accepts connections', async () => {
    await fakeBd('1.2.2');
    const port = await listenOnPort();
    const root = await project('srv', {
      metadata: { database: 'dolt', dolt_mode: 'server', dolt_server_host: '127.0.0.1', dolt_server_port: port },
      localVersion: '1.2.2',
    });
    expect(await detect(root)).toMatchObject({ kind: 'ok', mode: 'server' });
  });

  it('does not probe a server with no fixed port', async () => {
    await fakeBd('1.2.2');
    const root = await project('srv', {
      metadata: { database: 'dolt', dolt_mode: 'server', dolt_database: 'beads_floatie' },
      localVersion: '1.2.2',
    });
    expect(await detect(root)).toMatchObject({ kind: 'ok', mode: 'server' });
  });

  it('does not probe a server on another machine', async () => {
    await fakeBd('1.2.2');
    const port = await freePort();
    const root = await project('srv', {
      metadata: { database: 'dolt', dolt_mode: 'server', dolt_server_host: 'dolt.example.com', dolt_server_port: port },
      localVersion: '1.2.2',
    });
    expect(await detect(root)).toMatchObject({ kind: 'ok', mode: 'server' });
  });

  it('does not probe an embedded project that happens to list a port', async () => {
    await fakeBd('1.2.2');
    const port = await freePort();
    const root = await project('emb', { metadata: { ...EMBEDDED, dolt_server_port: port }, localVersion: '1.2.2' });
    expect(await detect(root)).toMatchObject({ kind: 'ok', mode: 'embedded' });
  });

  it('checks first contact before the server', async () => {
    await fakeBd('1.2.2');
    const port = await freePort();
    const root = await project('srv', {
      metadata: { database: 'dolt', dolt_mode: 'server', dolt_server_port: port },
      localVersion: '1.0.3',
    });
    expect(await detect(root)).toMatchObject({ kind: 'needs-first-contact' });
    expect(await detect(root, true)).toMatchObject({ kind: 'server-down', port });
  });
});

describe('ok', () => {
  it('reports an embedded project without a remote', async () => {
    await fakeBd('1.2.2', '[]');
    const root = await project('my-app', { localVersion: '1.2.2' });
    expect(await detect(root)).toEqual({
      kind: 'ok',
      root,
      mode: 'embedded',
      bdVersion: '1.2.2',
      hasRemote: false,
      projectName: 'my-app',
    });
    expect(await calls()).toEqual(['--version', '--readonly dolt remote list --json']);
  });

  it('reports hasRemote when the remote list is not empty', async () => {
    await fakeBd('1.2.2', '[{"name":"origin","url":"file:///x","sql_url":"file:///x","status":"ok"}]');
    const root = await project('p', { localVersion: '1.2.2' });
    expect(await detect(root)).toMatchObject({ kind: 'ok', hasRemote: true });
  });

  it('does not take sync.remote in config.yaml as a remote when the Dolt remote list is empty', async () => {
    await fakeBd('1.2.2', '[]');
    const root = await project('p', { localVersion: '1.2.2' });
    await writeFile(join(root, '.beads', 'config.yaml'), 'sync:\n  remote: git+https://example.com/team/beads.git\n');
    expect(await detect(root)).toMatchObject({ kind: 'ok', hasRemote: false });
  });

  it('an older-schema store refuses the remote lookup: the project is still ok, with no remote known until it is updated', async () => {
    const path = join(bin, 'bd');
    await writeFile(
      path,
      `#!/bin/sh
case "$*" in
  "--version") echo "bd version 1.3.1 (Homebrew)" ;;
  *) echo "Error: failed to open database: schema version mismatch: database is at v32, binary expects v66, and the read-only open cannot migrate it; run any bd write command in that workspace to migrate, or set BD_IGNORE_SCHEMA_SKEW=1 to read anyway (queries touching newer schema may fail)" >&2; exit 1 ;;
esac
`,
    );
    await chmod(path, 0o755);
    const root = await project('old-store', { localVersion: '1.3.1' });
    expect(await detect(root)).toEqual({ kind: 'ok', root, mode: 'embedded', bdVersion: '1.3.1', hasRemote: false, projectName: 'old-store' });
  });

  it('finds the workspace from a folder inside the project', async () => {
    await fakeBd('1.2.2');
    const root = await project('p', { localVersion: '1.2.2' });
    const inner = join(root, 'src', 'deep');
    await mkdir(inner, { recursive: true });
    expect(await detect(inner)).toMatchObject({ kind: 'ok', root, projectName: 'p' });
  });

  it('rejects instead of guessing when the remote lookup fails', async () => {
    await writeFile(
      join(bin, 'bd'),
      '#!/bin/sh\ncase "$*" in\n  "--version") echo "bd version 1.2.2" ;;\n  *) echo "Error: boom" >&2; exit 1 ;;\nesac\n',
    );
    await chmod(join(bin, 'bd'), 0o755);
    const root = await project('p', { localVersion: '1.2.2' });
    await expect(detect(root)).rejects.toMatchObject({ kind: 'exit' });
  });
});

describe('git worktrees', () => {
  function git(cwd: string, ...args: string[]): void {
    execFileSync('git', args, {
      cwd,
      stdio: 'ignore',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    });
  }

  async function repoWithWorktree(): Promise<{ main: string; worktree: string }> {
    const main = await project('main-app', { localVersion: '1.2.2' });
    git(main, 'init', '-q', '-b', 'main');
    git(main, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'init');
    const worktree = join(tmp, 'feature-wt');
    git(main, 'worktree', 'add', '-q', '-b', 'feature', worktree);
    return { main, worktree };
  }

  it('uses the main checkout when the worktree has no .beads folder', async () => {
    await fakeBd('1.2.2');
    const { main, worktree } = await repoWithWorktree();
    expect(await detect(worktree)).toMatchObject({ kind: 'ok', root: main, projectName: 'main-app' });
    const inner = join(worktree, 'src');
    await mkdir(inner);
    expect(await detect(inner)).toMatchObject({ kind: 'ok', root: main });
  });

  it('prefers the main checkout even when the worktree carries its own tracked .beads files', async () => {
    await fakeBd('1.2.2');
    const { main, worktree } = await repoWithWorktree();
    await mkdir(join(worktree, '.beads'));
    await writeFile(join(worktree, '.beads', 'metadata.json'), JSON.stringify(EMBEDDED));
    expect(await detect(worktree)).toMatchObject({ kind: 'ok', root: main });
  });

  it('uses its own .beads when the main checkout has none', async () => {
    await fakeBd('1.2.2');
    const { main, worktree } = await repoWithWorktree();
    await rm(join(main, '.beads'), { recursive: true });
    await mkdir(join(worktree, '.beads'));
    await writeFile(join(worktree, '.beads', 'metadata.json'), JSON.stringify(EMBEDDED));
    await writeFile(join(worktree, '.beads', '.local_version'), '1.2.2');
    await mkdir(join(worktree, '.beads', 'embeddeddolt'));
    expect(await detect(worktree)).toMatchObject({ kind: 'ok', root: worktree });
  });

  it('treats a submodule-style .git file as a repository boundary, not as a worktree', async () => {
    await fakeBd('1.2.2');
    const outer = await project('outer', { localVersion: '1.2.2' });
    const sub = join(outer, 'vendor', 'lib');
    await mkdir(sub, { recursive: true });
    await mkdir(join(outer, '.git', 'modules', 'lib'), { recursive: true });
    await writeFile(join(sub, '.git'), `gitdir: ${join(outer, '.git', 'modules', 'lib')}\n`);
    expect(await detect(sub)).toEqual({ kind: 'no-workspace' });
    expect(await calls()).toEqual([]);
  });

  it('does not walk out of a nested git repository into the outer project', async () => {
    await fakeBd('1.2.2');
    const outer = await project('outer', { localVersion: '1.2.2' });
    const inner = join(outer, 'tools', 'inner');
    await mkdir(join(inner, 'src'), { recursive: true });
    git(inner, 'init', '-q');
    expect(await detect(join(inner, 'src'))).toEqual({ kind: 'no-workspace' });
    expect(await detect(inner)).toEqual({ kind: 'no-workspace' });
    // The outer project itself, and plain folders inside it, still resolve.
    expect(await detect(join(outer, 'tools'))).toMatchObject({ kind: 'ok', root: outer });
  });

  it('finds .beads at the root of the git repository the directory is in', async () => {
    await fakeBd('1.2.2');
    const root = await project('repo', { localVersion: '1.2.2' });
    git(root, 'init', '-q');
    await mkdir(join(root, 'src'));
    expect(await detect(join(root, 'src'))).toMatchObject({ kind: 'ok', root });
  });
});
