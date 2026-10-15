import { connect } from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { WorkspaceState } from '../shared/types';
import { BdError, resolveExecutable, runBd, runBdJson } from './bd/exec';
import { schemaSkewOf } from './errors';

/** Oldest `bd` the panel supports. */
export const MIN_BD_VERSION = '1.2.2';

const SERVER_PROBE_TIMEOUT_MS = 500;
const NO_DATABASE = /no beads database found/i;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export interface DetectOptions {
  /** The user agreed to let a newer `bd` open a project last opened with an older one. */
  confirmedFirstContact?: boolean;
  /** Where to look for `bd`. For tests. */
  searchDirs?: string[];
}

export type Version = [number, number, number];

/** `1.2.2`, `v1.3.0-rc1` and `bd version 1.2.2 (Homebrew)` all parse; anything without a x.y.z does not. */
export function parseVersion(text: string): Version | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Negative when `a` is older than `b`. */
export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i += 1) {
    const diff = a[i]! - b[i]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * If `dir` is the root of a linked git worktree, the root of the main checkout. Read from
 * the `.git` file and its `commondir`, with no process spawned. Submodules also have a
 * `.git` file but no `commondir`, so they are not mistaken for worktrees.
 */
async function mainCheckoutOf(dir: string): Promise<string | null> {
  const gitFile = await readText(join(dir, '.git'));
  const gitdirLine = gitFile ? /^gitdir:\s*(.+)$/m.exec(gitFile) : null;
  if (!gitdirLine) return null;
  const gitDir = resolve(dir, gitdirLine[1]!.trim());
  const commonDirText = await readText(join(gitDir, 'commondir'));
  if (!commonDirText) return null;
  const commonDir = resolve(gitDir, commonDirText.trim());
  return basename(commonDir) === '.git' ? dirname(commonDir) : null;
}

/**
 * The project root that owns the beads database for `directory`: the nearest ancestor with a
 * `.beads/` folder, except that a linked git worktree uses its main checkout's database
 * (`bd worktree` shares it through the git common dir). The walk stops at a git repository's
 * root, as bd does, so a nested repo does not inherit the outer project's beads.
 */
export async function findWorkspaceRoot(directory: string): Promise<string | null> {
  let dir = resolve(directory);
  for (;;) {
    const main = await mainCheckoutOf(dir);
    if (main && (await isDirectory(join(main, '.beads')))) return main;
    if (await isDirectory(join(dir, '.beads'))) return dir;
    // bd does not look above a git repository's root: a nested repo is not part of the outer project.
    if (await exists(join(dir, '.git'))) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export interface Metadata {
  database?: unknown;
  dolt_mode?: unknown;
  dolt_database?: unknown;
  dolt_server_host?: unknown;
  dolt_server_port?: unknown;
}

/** `.beads/metadata.json` as bd wrote it; null when it is missing or not a JSON object. */
export async function readMetadata(root: string): Promise<Metadata | null> {
  const text = await readText(join(root, '.beads', 'metadata.json'));
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Metadata) : null;
  } catch {
    return null;
  }
}

function isPreDolt(metadata: Metadata): boolean {
  return typeof metadata.database === 'string' && metadata.database.endsWith('.db');
}

function modeOf(metadata: Metadata): 'embedded' | 'server' {
  if (metadata.dolt_mode === 'server') return 'server';
  if (metadata.dolt_mode === 'embedded') return 'embedded';
  // No explicit mode: a recorded server port or host means a server, otherwise bd's init default.
  return metadata.dolt_server_port !== undefined || metadata.dolt_server_host !== undefined ? 'server' : 'embedded';
}

/** The fixed server port, only when it is a local server the panel can probe. */
function probeTarget(metadata: Metadata): { host: string; port: number } | null {
  const port = metadata.dolt_server_port;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const host = typeof metadata.dolt_server_host === 'string' && metadata.dolt_server_host ? metadata.dolt_server_host : '127.0.0.1';
  return LOCAL_HOSTS.has(host) ? { host, port } : null;
}

function acceptsConnections(host: string, port: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = connect({ host, port });
    const done = (up: boolean) => {
      socket.destroy();
      resolveProbe(up);
    };
    socket.setTimeout(SERVER_PROBE_TIMEOUT_MS, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

// `bd --version` costs a process start (~0.3 s), so keep the answer per process. The key is
// the executable path and its mtime: an upgrade replaces the file and starts a fresh lookup.
const versionCache = new Map<string, { mtimeMs: number; version: Promise<string> }>();

async function installedVersion(exe: string, searchDirs: string[] | undefined): Promise<string> {
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(exe)).mtimeMs;
  } catch (cause) {
    throw new BdError('not-found', `bd could not be read at ${exe}: ${(cause as Error).message}`);
  }
  const cached = versionCache.get(exe);
  if (cached && cached.mtimeMs === mtimeMs) return cached.version;

  const version = (async () => {
    // Run beside the executable, never inside a project: no bd process may start in a project before the user consents.
    const result = await runBd(dirname(exe), ['--version'], { searchDirs });
    if (result.code !== 0) {
      throw new BdError('exit', `bd --version failed: ${result.stderr.trim() || `exit code ${result.code}`}`, {
        code: result.code,
        stderr: result.stderr,
      });
    }
    const parsed = parseVersion(result.stdout);
    if (!parsed) throw new BdError('parse', `bd printed a version that could not be read: ${result.stdout.trim()}`);
    return parsed.join('.');
  })();
  const entry = { mtimeMs, version };
  versionCache.set(exe, entry);
  // A failed lookup is not remembered.
  version.catch(() => {
    if (versionCache.get(exe) === entry) versionCache.delete(exe);
  });
  return version;
}

/** Forget cached `bd --version` answers. For tests. */
export function resetVersionCache(): void {
  versionCache.clear();
}

/**
 * Read-only for both modes (checked against bd 1.2.2): `bd --readonly dolt remote list --json`
 * prints `[]` when there is no remote. `bd dolt show` is wrong here (it says "(none)" even with a remote).
 */
async function hasDoltRemote(root: string, searchDirs: string[] | undefined): Promise<boolean> {
  const remotes = await runBdJson<unknown>(root, ['--readonly', 'dolt', 'remote', 'list', '--json'], { retries: 2, searchDirs });
  if (!Array.isArray(remotes)) throw new BdError('parse', 'bd printed a remote list that is not a list');
  return remotes.length > 0;
}

/**
 * Decides what state the beads workspace for `directory` is in. Calls `bd` only when that is
 * safe: never for a project that is missing, pre-Dolt, or waiting for first-contact consent
 * (beads may update a project's files the first time a newer binary opens it).
 *
 * Order: no workspace (no `.beads/` or unreadable metadata), pre-Dolt, fresh clone (explicit embedded
 * mode with no local database; a missing or unknown mode is left to `bd`), no `bd`,
 * `bd` too old (for the panel, or older than the `bd` that last opened the project), first contact, server down, ok.
 * `bd --version` runs outside the project.
 * Lock, timeout and unexpected failures of the remote lookup reject with BdError so the caller
 * shows "busy" instead of silently hiding the sync controls.
 */
export async function detectWorkspace(directory: string, opts: DetectOptions = {}): Promise<WorkspaceState> {
  const root = await findWorkspaceRoot(directory);
  if (!root) return { kind: 'no-workspace' };

  const metadata = await readMetadata(root);
  // A `.beads/` without readable metadata is not a database bd can open (for example a fresh clone), unless it holds the
  // SQLite `beads.db` of a bd old enough to predate metadata.json: that one is pre-Dolt.
  if (!metadata) {
    const sqlite = await stat(join(root, '.beads', 'beads.db')).then((s) => s.isFile(), () => false);
    return sqlite ? { kind: 'pre-dolt', root } : { kind: 'no-workspace' };
  }
  if (isPreDolt(metadata)) return { kind: 'pre-dolt', root };

  const mode = modeOf(metadata);
  // A fresh clone has the tracked metadata but no local database; bd would only answer "no beads database found".
  // Only when the metadata says embedded outright: with no mode or one we do not know, bd decides.
  if (metadata.dolt_mode === 'embedded' && !(await isDirectory(join(root, '.beads', 'embeddeddolt')))) {
    return { kind: 'no-workspace' };
  }

  const exe = await resolveExecutable('bd', opts.searchDirs);
  if (!exe) return { kind: 'no-bd' };
  let bdVersion: string;
  try {
    bdVersion = await installedVersion(exe, opts.searchDirs);
  } catch (cause) {
    if (cause instanceof BdError && cause.kind === 'not-found') return { kind: 'no-bd' };
    throw cause;
  }
  if (compareVersions(parseVersion(bdVersion)!, parseVersion(MIN_BD_VERSION)!) < 0) {
    return { kind: 'bd-too-old', bdVersion };
  }

  // A missing or unreadable `.local_version` is not "older": there is nothing to compare.
  const lastOpenedWith = (await readText(join(root, '.beads', '.local_version')))?.trim() ?? '';
  const lastOpened = parseVersion(lastOpenedWith);
  // A project a newer Beads has opened is out of this one's reach: it would write its own version over the newer one's,
  // consent or not. Nothing runs in the project.
  if (lastOpened && compareVersions(lastOpened, parseVersion(bdVersion)!) > 0) {
    return { kind: 'bd-too-old', bdVersion, lastOpenedWith: lastOpened.join('.') };
  }
  if (!opts.confirmedFirstContact && lastOpened && compareVersions(lastOpened, parseVersion(bdVersion)!) < 0) {
    return { kind: 'needs-first-contact', root, lastOpenedWith: lastOpened.join('.'), bdVersion };
  }

  const target = mode === 'server' ? probeTarget(metadata) : null;
  if (target && !(await acceptsConnections(target.host, target.port))) {
    return { kind: 'server-down', root, port: target.port };
  }

  let hasRemote: boolean;
  try {
    hasRemote = await hasDoltRemote(root, opts.searchDirs);
  } catch (cause) {
    // A server-mode fresh clone: the tracked files are there, the database is not.
    if (cause instanceof BdError && cause.kind === 'exit' && NO_DATABASE.test(`${cause.message}\n${cause.stderr}`)) {
      return { kind: 'no-workspace' };
    }
    // A store from an older bd refuses every read-only open, this one too. The project is still the person's to open: the
    // snapshot says it needs the update, and the remote is looked up again once it has been updated (`readFailureDropped`).
    if (schemaSkewOf(cause)) return { kind: 'ok', root, mode, bdVersion, hasRemote: false, projectName: basename(root) };
    throw cause;
  }
  return { kind: 'ok', root, mode, bdVersion, hasRemote, projectName: basename(root) };
}
