import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

export type ToolName = 'bd' | 'dolt' | 'git';

export type BdErrorKind = 'not-found' | 'timeout' | 'lock' | 'exit' | 'parse';

export class BdError extends Error {
  readonly kind: BdErrorKind;
  readonly code?: number;
  readonly stderr: string;

  constructor(kind: BdErrorKind, message: string, details: { code?: number; stderr?: string } = {}) {
    super(message);
    this.name = 'BdError';
    this.kind = kind;
    this.code = details.code;
    this.stderr = details.stderr ?? '';
  }
}

export interface RunOptions {
  /** Per attempt, default 15 s, never more than the time left in `deadlineMs`. A timeout is never retried: the call may have taken effect. */
  timeoutMs?: number;
  /** Overall budget across attempts and backoff, default 18 s (under the host's 20 s RPC limit). */
  deadlineMs?: number;
  /**
   * The same budget as an absolute time (ms since epoch), for callers that run several calls under one deadline.
   * Wins over `deadlineMs`. A call that starts after it has passed is not run: it rejects with a `timeout` at once.
   */
  deadlineAt?: number;
  /** Extra attempts after a lock error (bd and dolt only). Default 0. */
  retries?: number;
  /** Written to the child's stdin. */
  input?: string;
  /** Per-stream cap on stdout and stderr. Default and ceiling 4 MB. */
  maxBytes?: number;
  /** First retry delay; doubles on every further retry. Default 150 ms. */
  backoffMs?: number;
  /** Where to look for the executable. Default: host PATH plus the extra dirs. For tests. */
  searchDirs?: string[];
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface RunJsonOptions extends RunOptions {
  /** Parse stdout as one JSON value per line instead of a single document. */
  jsonl?: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_DEADLINE_MS = 18_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_BACKOFF_MS = 150;
const MIN_ATTEMPT_MS = 1_000;
const KILL_GRACE_MS = 1_000;

/** Dirs a Dock-launched app lacks but `bd`, `dolt` and `git` usually live in. */
function extraDirs(): string[] {
  const home = homedir();
  return ['/opt/homebrew/bin', '/usr/local/bin', join(home, '.local', 'bin'), join(home, 'go', 'bin')];
}

/** Host PATH entries first, then the extra dirs, deduplicated. A relative entry ("." or "bin") would search the project folder, so it is dropped. */
export function searchDirs(): string[] {
  const host = (process.env.PATH ?? '').split(delimiter);
  return [...new Set([...host, ...extraDirs()].filter((dir) => isAbsolute(dir)))];
}

// Host variables that would point bd or git at a different database or repo than `cwd`.
// Password variables are kept: they authenticate, they do not redirect.
const LEAKY_ENV = [
  'BEADS_DIR',
  'BEADS_DB',
  'BEADS_DOLT_SERVER_HOST',
  'BEADS_DOLT_SERVER_PORT',
  'BEADS_DOLT_SERVER_SOCKET',
  'BEADS_DOLT_DATA_DIR',
  'BEADS_DOLT_SHARED_SERVER',
  'GIT_DIR',
  'GIT_WORK_TREE',
];

export function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: searchDirs().join(delimiter) };
  for (const key of LEAKY_ENV) delete env[key];
  return env;
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false;
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Finds `name` in `dirs` (default: host PATH plus the extra dirs). */
export async function resolveExecutable(name: ToolName, dirs: string[] = searchDirs()): Promise<string | null> {
  for (const dir of dirs) {
    const candidate = join(dir, name);
    if (await isExecutableFile(candidate)) return candidate;
  }
  return null;
}

// `lock` must stand alone: not inside "blocked", and not joined to a path, id or
// word by `-`, `/`, or `_` (`smart-lock/.beads`, `lock-a1`).
// "locks" and "locking" are left out on purpose: they show up in bead titles, real lock errors do not use them.
const LOCK_PATTERN = /(?<![\w/-])lock(?:ed)?(?![\w/-])/i;

/** Pass the error text only (stderr, or the `error` field of a JSON error), never a result body. */
export function isLockError(errorText: string): boolean {
  return LOCK_PATTERN.test(errorText);
}

const BEADS_ROLE_WARNING = /^warning: beads\.role not configured.*$/gim;

function withoutKnownWarnings(stderr: string): string {
  return stderr.replace(BEADS_ROLE_WARNING, '').trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The error text of a failed call: the `error` field of a JSON error on stdout, else stderr. */
function errorText(result: RunResult): string {
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string') {
      return (parsed as { error: string }).error;
    }
  } catch {
    // Plain-text error on stderr, stdout empty.
  }
  return withoutKnownWarnings(result.stderr);
}

/** Only called once the executable was found, so ENOENT or EACCES from spawn means the working folder, not a missing tool. */
function startFailure(name: ToolName, cause: NodeJS.ErrnoException): BdError {
  if (cause.code === 'ENOENT' || cause.code === 'EACCES') {
    return new BdError('exit', `${name} could not be started: the project folder is missing or cannot be opened`);
  }
  if (cause.code === 'ERR_INVALID_ARG_VALUE') {
    return new BdError('exit', `${name} could not be started: an argument contains a character that cannot be passed`);
  }
  if (cause.code === 'EMFILE' || cause.code === 'ENFILE') {
    return new BdError('exit', `${name} could not be started: too many files are open`);
  }
  if (cause.code === 'E2BIG') {
    return new BdError('exit', `${name} could not be started: the arguments are too long`);
  }
  return new BdError('exit', `${name} could not be started: ${cause.message}`);
}

function runOnce(
  exe: string,
  name: ToolName,
  cwd: string,
  args: string[],
  timeoutMs: number,
  opts: RunOptions,
): Promise<RunResult> {
  // The 4 MB cap is a ceiling: a caller may ask for less, never more.
  const maxBytes = Math.min(opts.maxBytes ?? DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES);

  return new Promise<RunResult>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      // Own process group, so a timeout takes down grandchildren (bd runs dolt and git).
      child = spawn(exe, args, { cwd, env: childEnv(), detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (cause) {
      reject(startFailure(name, cause as NodeJS.ErrnoException));
      return;
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let failure: BdError | undefined;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let timeout: NodeJS.Timeout | undefined;

    const stderrText = () => Buffer.concat(err).toString('utf8');
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      settle();
    };

    // Attach this before touching the streams: on EMFILE/ENFILE spawn returns a child
    // without stdio and reports the failure through 'error' on the next tick.
    child.on('error', (cause: NodeJS.ErrnoException) => finish(() => reject(startFailure(name, cause))));

    const { stdout, stderr: stderrStream, stdin } = child;
    if (!stdout || !stderrStream || !stdin) {
      // Normally 'error' settles this first; the timer only covers a missing 'error'.
      timeout = setTimeout(
        () => finish(() => reject(new BdError('exit', `${name} could not be started: no pipes were created`))),
        50,
      );
      return;
    }

    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    };
    const abort = (error: BdError) => {
      if (failure) return;
      failure = error;
      killGroup('SIGTERM');
      killTimer = setTimeout(() => {
        killGroup('SIGKILL');
        // A process that left the group can keep the pipes open; do not wait for 'close'.
        stdout.destroy();
        stderrStream.destroy();
        finish(() => reject(failure));
      }, KILL_GRACE_MS);
    };

    timeout = setTimeout(() => abort(new BdError('timeout', `${name} timed out after ${timeoutMs} ms`)), timeoutMs);

    stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > maxBytes) abort(new BdError('exit', `${name} output exceeded ${maxBytes} bytes`));
      else out.push(chunk);
    });
    stderrStream.on('data', (chunk: Buffer) => {
      errBytes += chunk.length;
      if (errBytes > maxBytes) abort(new BdError('exit', `${name} error output exceeded ${maxBytes} bytes`));
      else err.push(chunk);
    });

    child.on('close', (code, signal) =>
      finish(() => {
        if (failure) {
          reject(failure.kind === 'timeout' ? failure : new BdError(failure.kind, failure.message, { stderr: stderrText() }));
          return;
        }
        resolve({ stdout: Buffer.concat(out).toString('utf8'), stderr: stderrText(), code: code ?? (signal ? 1 : 0) });
      }),
    );

    // The child may exit before reading stdin; ignore the resulting EPIPE.
    stdin.on('error', () => {});
    stdin.end(opts.input);
  });
}

async function runTool(
  name: ToolName,
  cwd: string,
  args: string[],
  opts: RunOptions,
  retryOnLock: boolean,
): Promise<RunResult> {
  const exe = await resolveExecutable(name, opts.searchDirs);
  if (!exe) throw new BdError('not-found', `${name} was not found on PATH or in the usual install folders`);

  const startedAt = Date.now();
  if (opts.deadlineAt !== undefined && opts.deadlineAt <= startedAt) {
    throw new BdError('timeout', `${name} was not started: the time for this request had run out`);
  }
  const deadlineMs = opts.deadlineAt !== undefined ? opts.deadlineAt - startedAt : (opts.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const retries = retryOnLock ? Math.max(0, opts.retries ?? 0) : 0;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;

  for (let attempt = 0; ; attempt += 1) {
    const remaining = deadlineMs - (Date.now() - startedAt);
    const attemptMs = Math.max(1, Math.min(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, remaining));
    const result = await runOnce(exe, name, cwd, args, attemptMs, opts);
    if (!retryOnLock || result.code === 0) return result;
    const text = errorText(result);
    if (!isLockError(text)) return result;
    const delay = backoff * 2 ** attempt;
    // Do not start an attempt that would be cut off almost at once by the deadline.
    const outOfTime = Date.now() - startedAt + delay + MIN_ATTEMPT_MS > deadlineMs;
    if (attempt >= retries || outOfTime) {
      throw new BdError('lock', `${name} is busy: ${text}`, { code: result.code, stderr: result.stderr });
    }
    await sleep(delay);
  }
}

// Global flags that take their value as the next argument (`--x=value` needs no skip).
const VALUE_FLAGS = new Set(['--actor', '--db', '--directory', '-C', '--dolt-auto-commit']);
// `show` moves .beads/last-touched; `view` is its alias.
const REFUSED_SUBCOMMANDS = new Set(['show', 'view']);

function subcommandOf(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (!arg.startsWith('-')) return arg;
    if (VALUE_FLAGS.has(arg)) i += 1;
  }
  return undefined;
}

function refusalFor(args: string[]): string | undefined {
  const subcommand = subcommandOf(args);
  if (subcommand !== undefined && REFUSED_SUBCOMMANDS.has(subcommand)) {
    return `"bd ${subcommand}" moves .beads/last-touched`;
  }
  // Everything after a bare `--` is user text (a title, a comment), not a flag.
  const separator = args.indexOf('--');
  const flags = separator === -1 ? args : args.slice(0, separator);
  if (flags.some((arg) => arg === '--force' || arg.startsWith('--force=') || arg === '-f')) {
    return '--force is never passed';
  }
  return undefined;
}

/**
 * Runs `bd` in `directory`. Resolves for any exit code; rejects with BdError for
 * not-found, timeout, output over the cap, a refused argument, and a lock error that
 * outlives the retries. Refuses the `show`/`view` subcommand and `--force`/`-f` anywhere
 * in args; user text that merely equals `show` is fine.
 */
export function runBd(directory: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const refusal = refusalFor(args);
  if (refusal) return Promise.reject(new BdError('exit', `refused: ${refusal}`));
  return runTool('bd', directory, args, opts, true);
}

/** Runs `dolt` in `cwd` (for embedded projects: inside `.beads/embeddeddolt/<db>/`). Same contract as runBd, minus the argument guard. */
export function runDolt(cwd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return runTool('dolt', cwd, args, opts, true);
}

/** Runs `git` in `directory`. No lock retry, no argument guard. Same contract as runBd otherwise. */
export function runGit(directory: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return runTool('git', directory, args, opts, false);
}

function errorMessageFor(result: RunResult): string {
  return errorText(result) || `bd exited with code ${result.code}`;
}

function parseJsonLines(stdout: string): unknown[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

/** Runs `bd` and parses stdout. Callers pass `--json` themselves. */
export async function runBdJson<T>(directory: string, args: string[], opts: RunJsonOptions = {}): Promise<T> {
  const result = await runBd(directory, args, opts);
  if (result.code !== 0) {
    throw new BdError('exit', errorMessageFor(result), { code: result.code, stderr: result.stderr });
  }
  try {
    return (opts.jsonl ? parseJsonLines(result.stdout) : JSON.parse(result.stdout)) as T;
  } catch (cause) {
    throw new BdError('parse', `bd printed output that is not valid JSON: ${(cause as Error).message}`, {
      code: result.code,
      stderr: result.stderr,
    });
  }
}
