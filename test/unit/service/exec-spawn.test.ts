import { EventEmitter } from 'node:events';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { BdError, runBd } from '../../../src/service/bd/exec';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'oc-beads-spawn-'));
  await writeFile(join(tmp, 'bd'), '#!/bin/sh\n');
  await chmod(join(tmp, 'bd'), 0o755);
});

afterEach(async () => {
  spawnMock.mockReset();
  await rm(tmp, { recursive: true, force: true });
});

/** What node returns on EMFILE: a child with no stdio that reports the failure on the next tick. */
function stdiolessChild(emitError: NodeJS.ErrnoException | null): EventEmitter {
  const child = new EventEmitter();
  if (emitError) process.nextTick(() => child.emit('error', emitError));
  return child;
}

describe('spawn failure without stdio', () => {
  it('settles with a plain exit error on EMFILE instead of crashing', async () => {
    const cause = Object.assign(new Error('spawn bd EMFILE'), { code: 'EMFILE' });
    spawnMock.mockImplementation(() => stdiolessChild(cause));
    const error = (await runBd(tmp, ['list'], { searchDirs: [tmp] }).catch((e: unknown) => e)) as BdError;
    expect(error).toBeInstanceOf(BdError);
    expect(error.kind).toBe('exit');
    expect(error.message).toBe('bd could not be started: too many files are open');
  });

  it('settles even if no error event ever arrives', async () => {
    spawnMock.mockImplementation(() => stdiolessChild(null));
    const error = (await runBd(tmp, ['list'], { searchDirs: [tmp] }).catch((e: unknown) => e)) as BdError;
    expect(error.kind).toBe('exit');
    expect(error.message).toMatch(/could not be started/);
  });

  it('turns a synchronous spawn throw into a plain exit error', async () => {
    spawnMock.mockImplementation(() => {
      throw Object.assign(new Error('bad arg'), { code: 'ERR_INVALID_ARG_VALUE' });
    });
    const error = (await runBd(tmp, ['list'], { searchDirs: [tmp] }).catch((e: unknown) => e)) as BdError;
    expect(error.kind).toBe('exit');
  });
});
