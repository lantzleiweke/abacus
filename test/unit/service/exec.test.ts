import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BdError,
  childEnv,
  isLockError,
  resolveExecutable,
  runBd,
  runBdJson,
  runDolt,
  runGit,
  searchDirs,
} from '../../../src/service/bd/exec';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'oc-beads-exec-'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmp, { recursive: true, force: true });
});

async function fake(name: string, body: string): Promise<void> {
  const path = join(tmp, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
}

/** Puts the temp dir on PATH so runBd finds the fake, keeping system tools reachable. */
function pathWithTmp(): void {
  vi.stubEnv('PATH', `${tmp}${delimiter}/usr/bin${delimiter}/bin`);
}

describe('resolveExecutable', () => {
  it('resolves bd outside PATH', async () => {
    await fake('bd', 'echo ok');
    vi.stubEnv('PATH', `/usr/bin${delimiter}/bin`);
    expect(await resolveExecutable('bd', ['/usr/bin', '/bin'])).toBeNull();
    expect(await resolveExecutable('bd', ['/usr/bin', tmp])).toBe(join(tmp, 'bd'));
  });

  it('skips files that are not executable', async () => {
    await writeFile(join(tmp, 'bd'), 'not executable');
    expect(await resolveExecutable('bd', [tmp])).toBeNull();
  });
});

describe('searchDirs', () => {
  it('drops PATH entries that are not absolute, so the project folder is never searched', () => {
    vi.stubEnv('PATH', `.${delimiter}bin${delimiter}/usr/bin${delimiter}${delimiter}../tools${delimiter}/bin`);
    const dirs = searchDirs();
    expect(dirs.slice(0, 2)).toEqual(['/usr/bin', '/bin']);
    expect(dirs.every((dir) => isAbsolute(dir))).toBe(true);
    expect(dirs).toContain('/opt/homebrew/bin');
  });
});

describe('childEnv', () => {
  it('child env PATH includes homebrew', () => {
    vi.stubEnv('PATH', `/usr/bin${delimiter}/bin${delimiter}/usr/local/bin`);
    const dirs = (childEnv().PATH ?? '').split(delimiter);
    expect(dirs.slice(0, 3)).toEqual(['/usr/bin', '/bin', '/usr/local/bin']);
    expect(dirs).toContain('/opt/homebrew/bin');
    expect(dirs).toContain(join(homedir(), '.local', 'bin'));
    expect(dirs).toContain(join(homedir(), 'go', 'bin'));
    expect(dirs.filter((dir) => dir === '/usr/local/bin')).toHaveLength(1);
  });

  it('drops host variables that redirect the database or repo, keeps passwords', async () => {
    const redirecting = [
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
    for (const key of redirecting) vi.stubEnv(key, '/elsewhere');
    vi.stubEnv('BEADS_DOLT_PASSWORD', 'secret');
    const env = childEnv();
    for (const key of redirecting) expect(env).not.toHaveProperty(key);
    expect(env.BEADS_DOLT_PASSWORD).toBe('secret');
    await fake('bd', 'env');
    pathWithTmp();
    const names = (await runBd(tmp, [])).stdout.split('\n').map((line) => line.split('=')[0]);
    for (const key of redirecting) expect(names).not.toContain(key);
    expect(names).toContain('BEADS_DOLT_PASSWORD');
  });

  it('drops the switches that let bd migrate a store on its own', () => {
    vi.stubEnv('BD_IGNORE_SCHEMA_SKEW', '1');
    vi.stubEnv('BD_ALLOW_REMOTE_MIGRATE', '1');
    const env = childEnv();
    expect(env).not.toHaveProperty('BD_IGNORE_SCHEMA_SKEW');
    expect(env).not.toHaveProperty('BD_ALLOW_REMOTE_MIGRATE');
  });

  it('hands the augmented PATH to the child', async () => {
    await fake('bd', 'echo "$PATH"');
    pathWithTmp();
    const { stdout } = await runBd(tmp, []);
    expect(stdout.trim().split(delimiter)).toContain('/opt/homebrew/bin');
  });
});

describe('runBd', () => {
  it('runs in the given directory and passes args and stdin', async () => {
    await fake('bd', 'pwd -P; echo "$1|$2"; cat');
    pathWithTmp();
    const result = await runBd(tmp, ['a b', '--c'], { input: 'piped' });
    const [cwd, argLine, ...rest] = result.stdout.split('\n');
    expect(cwd).toBe(await realpath(tmp));
    expect(argLine).toBe('a b|--c');
    expect(rest.join('\n')).toBe('piped');
    expect(result.code).toBe(0);
  });

  it('returns a non-zero exit instead of throwing', async () => {
    await fake('bd', 'echo oops >&2; exit 3');
    pathWithTmp();
    expect(await runBd(tmp, [])).toEqual({ stdout: '', stderr: 'oops\n', code: 3 });
  });

  it('retries on lock error', async () => {
    const counter = join(tmp, 'count');
    await fake(
      'bd',
      `n=$(cat "${counter}" 2>/dev/null || echo 0)
n=$((n+1))
echo $n > "${counter}"
if [ $n -le 2 ]; then echo "Error: lock timeout exceeded" >&2; exit 1; fi
echo '{"ok":true}'`,
    );
    pathWithTmp();
    const started = Date.now();
    const result = await runBd(tmp, [], { retries: 3 });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('{"ok":true}');
    expect((await readFile(counter, 'utf8')).trim()).toBe('3');
    // Backoffs add up to 450 ms; the bound only has to catch a backoff that is off by orders of magnitude, so it leaves room for a loaded machine.
    expect(Date.now() - started).toBeLessThan(6000);
  });

  it('throws kind lock when retries run out', async () => {
    await fake('bd', 'echo "Error: lock timeout exceeded" >&2; exit 1');
    pathWithTmp();
    const error = await runBd(tmp, [], { retries: 1, backoffMs: 5 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BdError);
    expect((error as BdError).kind).toBe('lock');
    expect((error as BdError).code).toBe(1);
  });

  it('does not retry without retries', async () => {
    const counter = join(tmp, 'count');
    await fake('bd', `echo x >> "${counter}"; echo "lock timeout exceeded" >&2; exit 1`);
    pathWithTmp();
    await expect(runBd(tmp, [])).rejects.toMatchObject({ kind: 'lock' });
    expect((await readFile(counter, 'utf8')).trim().split('\n')).toHaveLength(1);
  });

  it.each([
    ['stderr path', 'echo "Error: cannot open /code/smart-lock/.beads/embeddeddolt: permission denied" >&2; exit 1'],
    ['blocked close', 'echo "cannot close lock-a1: blocked by open issues [lock-b2] (use --force to override)" >&2; exit 1'],
    ['json id', `echo '{"error": "issue lock-a1 not found", "schema_version": 1}'; exit 1`],
    ['bare-word lock title in stdout', `echo '[{"id":"x-1","title":"Fix lock in sync"}]'; echo "Error: failed" >&2; exit 1`],
  ])('does not treat %s as a lock', async (_label, body) => {
    const counter = join(tmp, 'count');
    await fake('bd', `echo x >> "${counter}"; ${body}`);
    pathWithTmp();
    const result = await runBd(tmp, [], { retries: 3, backoffMs: 5 });
    expect(result.code).toBe(1);
    expect((await readFile(counter, 'utf8')).trim().split('\n')).toHaveLength(1);
  });

  it('detects a lock error reported as JSON on stdout and keeps its text', async () => {
    await fake('bd', `echo '{"error": "failed to acquire lock: lock timeout exceeded", "schema_version": 1}'; exit 1`);
    pathWithTmp();
    const error = (await runBd(tmp, [], { retries: 1, backoffMs: 5 }).catch((e: unknown) => e)) as BdError;
    expect(error.kind).toBe('lock');
    expect(error.message).toContain('failed to acquire lock: lock timeout exceeded');
  });

  it('timeout kills the whole process group', async () => {
    const pidFile = join(tmp, 'pid');
    // The sleeper is a grandchild that would outlive the test by far if only bd itself were killed.
    await fake('bd', `(sleep 60 & echo $! > "${pidFile}"; wait) &\nwait`);
    pathWithTmp();
    // The timeout is the only clock the script races against (it has to record the pid before it fires), so give it room.
    const error = await runBd(tmp, [], { timeoutMs: 4000, retries: 3 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BdError);
    expect((error as BdError).kind).toBe('timeout');
    const pid = Number((await readFile(pidFile, 'utf8')).trim());
    expect(pid).toBeGreaterThan(1);
    try {
      // Wait on the observable (the process is gone), not a fixed sleep; ESRCH means it is.
      const deadline = Date.now() + 8000;
      let alive = true;
      while (alive && Date.now() < deadline) {
        try {
          process.kill(pid, 0);
          await new Promise((resolve) => setTimeout(resolve, 25));
        } catch (cause) {
          expect((cause as NodeJS.ErrnoException).code).toBe('ESRCH');
          alive = false;
        }
      }
      expect(alive).toBe(false);
    } finally {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone, which is the expected case.
      }
    }
  }, 20_000);

  it('settles on timeout even when a process left the group and holds the pipes', async () => {
    // The escapee holds the pipes for 10 s; settling must come from the kill grace, not from its exit.
    await fake('bd', `perl -MPOSIX -e 'POSIX::setsid(); exec "sleep", "10"' &\nwait`);
    pathWithTmp();
    const started = Date.now();
    const error = await runBd(tmp, [], { timeoutMs: 1000 }).catch((e: unknown) => e);
    expect((error as BdError).kind).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(8000);
  }, 20_000);

  it('caps each attempt at the time left in the overall deadline', async () => {
    await fake('bd', 'sleep 30');
    pathWithTmp();
    const started = Date.now();
    const error = await runBd(tmp, [], { timeoutMs: 15_000, deadlineMs: 300 }).catch((e: unknown) => e);
    expect((error as BdError).kind).toBe('timeout');
    // Well under the 15 s per-attempt timeout and the 30 s the script would run.
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 20_000);

  it('takes an absolute deadline shared by several calls', async () => {
    await fake('bd', 'sleep 30');
    pathWithTmp();
    const started = Date.now();
    const deadlineAt = started + 400;
    const first = await runBd(tmp, [], { timeoutMs: 15_000, deadlineAt }).catch((e: unknown) => e);
    expect((first as BdError).kind).toBe('timeout');
    // The deadline is gone: the next call under it is cut off at once, not given a fresh budget.
    const second = await runBd(tmp, [], { timeoutMs: 15_000, deadlineAt }).catch((e: unknown) => e);
    expect((second as BdError).kind).toBe('timeout');
    // A fresh budget would take 15 s per call (the script runs 30 s).
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 20_000);

  it('does not start a call whose absolute deadline has already passed', async () => {
    const marker = join(tmp, 'ran');
    await fake('bd', `echo ran > "${marker}"`);
    pathWithTmp();
    const error = await runBd(tmp, [], { deadlineAt: Date.now() - 1 }).catch((e: unknown) => e);
    expect((error as BdError).kind).toBe('timeout');
    await expect(readFile(marker, 'utf8')).rejects.toThrow();
  });

  it('treats everything after a bare -- as text, so a comment equal to --force or -f passes', async () => {
    await fake('bd', 'echo ran');
    pathWithTmp();
    expect((await runBd(tmp, ['--actor', 'A', 'comments', 'add', '--json', '--', 'x-1', '--force'])).stdout.trim()).toBe('ran');
    expect((await runBd(tmp, ['create', '--', '-f'])).stdout.trim()).toBe('ran');
    const refused = await runBd(tmp, ['close', '--force', '--', 'x-1']).catch((e: unknown) => e);
    expect((refused as BdError).message).toMatch(/^refused: /);
  });

  it('stops retrying when the next backoff would pass the deadline', async () => {
    const counter = join(tmp, 'count');
    await fake('bd', `echo x >> "${counter}"; echo "Error: lock timeout exceeded" >&2; exit 1`);
    pathWithTmp();
    const started = Date.now();
    await expect(runBd(tmp, [], { retries: 10, backoffMs: 2000, deadlineMs: 6500 })).rejects.toMatchObject({ kind: 'lock' });
    // Attempt 2 starts after 2000 ms. It is allowed while attempt 1 ended within 6500 - 2000 - 1000 = 3500 ms, a wide margin for a loaded machine.
    // A third would wait another 4000 ms: 2000 + 4000 + 1000 of minimum attempt time is over the 6.5 s budget however fast the attempts run.
    expect((await readFile(counter, 'utf8')).trim().split('\n')).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(6500);
  }, 15_000);

  it('reports a NUL byte in an argument as a plain exit error', async () => {
    await fake('bd', 'echo ok');
    pathWithTmp();
    const error = (await runBd(tmp, ['create', 'bad\0title']).catch((e: unknown) => e)) as BdError;
    expect(error).toBeInstanceOf(BdError);
    expect(error.kind).toBe('exit');
    expect(error.message).toMatch(/could not be started/);
    expect(error.message).not.toContain('\0');
  });

  it.each([
    [['create', '--title', 'show', '--json']],
    [['create', 'view']],
    [['--actor', 'show', 'update', 'x-1', '--title', 'show']],
    [['-C', 'show', 'list']],
    [['update', 'x-1', '--notes', '--force-less']],
  ])('lets user text equal to show through: %j', async (args) => {
    await fake('bd', 'echo ran');
    pathWithTmp();
    expect((await runBd(tmp, args)).stdout.trim()).toBe('ran');
  });

  it.each([
    [['show', 'x-1'], 'show'],
    [['--readonly', 'show', 'x-1', '--json'], 'show'],
    [['--actor', 'Ann (panel)', '--readonly', 'show', 'x-1'], 'show'],
    [['-C', '/tmp/p', 'show', 'x-1'], 'show'],
    [['--directory', '/p', 'show', 'x-1'], 'show'],
    [['--db=x', 'view', 'x-1'], 'view'],
    [['view', 'x-1'], 'view'],
    [['close', 'x-1', '--force'], '--force'],
    [['close', 'x-1', '--force=true'], '--force'],
    [['close', 'x-1', '-f'], '--force'],
  ])('refuses %j', async (args, what) => {
    const marker = join(tmp, 'ran');
    await fake('bd', `echo ran > "${marker}"`);
    pathWithTmp();
    const error = (await runBd(tmp, args).catch((e: unknown) => e)) as BdError;
    expect(error).toBeInstanceOf(BdError);
    expect(error.kind).toBe('exit');
    expect(error.message).toMatch(/^refused: /);
    expect(error.message).toContain(what);
    await expect(readFile(marker, 'utf8')).rejects.toThrow();
    await expect(runBdJson(tmp, args)).rejects.toMatchObject({ message: expect.stringMatching(/^refused: /) });
  });

  it('stdout over cap throws', async () => {
    await fake('bd', 'yes aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    pathWithTmp();
    const error = await runBd(tmp, [], { maxBytes: 1024 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BdError);
    expect((error as BdError).message).toMatch(/exceeded/);
  });

  it('stdout over the 4 MB cap throws even when a caller asks for a bigger cap', async () => {
    await fake('bd', 'yes aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    pathWithTmp();
    const error = await runBd(tmp, [], { maxBytes: 64 * 1024 * 1024, timeoutMs: 5_000 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BdError);
    expect((error as BdError).message).toMatch(/exceeded 4194304 bytes/);
  }, 10_000);

  it('not-found when bd missing', async () => {
    const error = await runBd(tmp, [], { searchDirs: [tmp] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BdError);
    expect((error as BdError).kind).toBe('not-found');
  });

  it('reports a missing project folder, not a missing tool, when bd was found but the folder is gone', async () => {
    await fake('bd', 'echo ok');
    pathWithTmp();
    const error = (await runBd(join(tmp, 'moved-away'), []).catch((e: unknown) => e)) as BdError;
    expect(error).toBeInstanceOf(BdError);
    expect(error.kind).toBe('exit');
    expect(error.message).toBe('bd could not be started: the project folder is missing or cannot be opened');
  });
});

describe('runBdJson', () => {
  it('parses stdout only, ignores stderr noise', async () => {
    await fake('bd', 'echo "warning: beads.role not configured (GH#2950)." >&2; echo \'{"a":1}\'');
    pathWithTmp();
    expect(await runBdJson<{ a: number }>(tmp, ['--json'])).toEqual({ a: 1 });
  });

  it('parses JSONL when asked', async () => {
    await fake('bd', 'printf \'{"id":"a"}\\n{"id":"b"}\\n\\n\'');
    pathWithTmp();
    expect(await runBdJson(tmp, ['export'], { jsonl: true })).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('throws the JSON error from stdout on exit 1', async () => {
    await fake('bd', 'echo \'{"error": "bad priority", "schema_version": 1}\'; exit 1');
    pathWithTmp();
    const error = await runBdJson(tmp, []).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'exit', code: 1, message: 'bad priority' });
  });

  it('throws the stderr text when stdout is empty, dropping the role warning', async () => {
    await fake(
      'bd',
      'echo "warning: beads.role not configured (GH#2950)." >&2; echo \'Error resolving nope: no issue found matching "nope"\' >&2; exit 1',
    );
    pathWithTmp();
    const error = (await runBdJson(tmp, []).catch((e: unknown) => e)) as BdError;
    expect(error.kind).toBe('exit');
    expect(error.message).toBe('Error resolving nope: no issue found matching "nope"');
    expect(error.stderr).toContain('beads.role');
  });

  it('throws kind parse on invalid JSON', async () => {
    await fake('bd', 'echo not json');
    pathWithTmp();
    await expect(runBdJson(tmp, [])).rejects.toMatchObject({ kind: 'parse' });
  });

  it('throws kind parse on empty stdout', async () => {
    await fake('bd', 'true');
    pathWithTmp();
    await expect(runBdJson(tmp, [])).rejects.toMatchObject({ kind: 'parse' });
  });
});

describe('runDolt and runGit', () => {
  it('retry dolt on lock but never git', async () => {
    const counter = join(tmp, 'count');
    const body = `echo x >> "${counter}"; echo "database is locked" >&2; exit 1`;
    await fake('dolt', body);
    await fake('git', body);
    pathWithTmp();
    await expect(runDolt(tmp, [], { retries: 2, backoffMs: 5 })).rejects.toMatchObject({ kind: 'lock' });
    expect((await readFile(counter, 'utf8')).trim().split('\n')).toHaveLength(3);
    await rm(counter);
    const git = await runGit(tmp, [], { retries: 2, backoffMs: 5 });
    expect(git.code).toBe(1);
    expect((await readFile(counter, 'utf8')).trim().split('\n')).toHaveLength(1);
  });
});

describe('isLockError', () => {
  it('would match the bare-word title used by the stdout negative test, so that test proves stdout is not scanned', () => {
    expect(isLockError('[{"id":"x-1","title":"Fix lock in sync"}]')).toBe(true);
  });

  it.each([
    'Error: lock timeout exceeded',
    'database is locked',
    'failed to acquire lock on .beads/embeddeddolt/.lock',
    'Could not obtain Lock',
  ])('matches %s', (text) => {
    expect(isLockError(text)).toBe(true);
  });

  it.each([
    'cannot close x-1: blocked by open issues [x-2] (use --force to override)',
    'cannot close lock-a1: blocked by open issues [lock-b2]',
    'issue lock-a1 not found',
    'cannot open /code/smart-lock/.beads/embeddeddolt',
    'Fix locks in sync',
    'Error resolving nope: no issue found',
    // bd's refusal to migrate a shared server database: "lock out" is the refusal's words, not a busy database.
    'refusing to auto-apply 34 pending schema migrations to a shared server database (v32 -> v66): migrating would lock out every co-resident bd client still on the old schema (#5920)',
    'this store is shared (dolt sql-server); the first-mover auto-migrate is disabled here because it would lock out co-resident clients (#5920)',
    '',
  ])('ignores %s', (text) => {
    expect(isLockError(text)).toBe(false);
  });
});
