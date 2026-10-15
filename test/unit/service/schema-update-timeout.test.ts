import { EventEmitter } from 'node:events';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { BdProvider, MIGRATE_BUDGET_MS, WriteError } from '../../../src/service/bd/adapter';

// The explicit update goes through the real exec layer with a fake child process and fake timers, so what is tested is the time limit itself:
// the usual 15 s write limit must never kill it, and it still ends at its own budget.

const STATUSES = JSON.stringify({ built_in_statuses: [{ name: 'open', category: 'active', icon: 'o' }] });

type FakeChild = EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; pid: number };

function fakeChild(pid: number): FakeChild {
  return Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), pid });
}

let tmp: string;
let path: string | undefined;
let killed: Array<[number, string | number | undefined]>;
let kill: ReturnType<typeof vi.spyOn>;
let children: FakeChild[];

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'oc-beads-migrate-time-'));
  await writeFile(join(tmp, 'bd'), '#!/bin/sh\n');
  await chmod(join(tmp, 'bd'), 0o755);
  path = process.env.PATH;
  process.env.PATH = tmp;
  killed = [];
  children = [];
  kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
    killed.push([pid, signal]);
    return true;
  }) as typeof process.kill);
  spawnMock.mockImplementation(() => {
    const child = fakeChild(1000 + children.length);
    children.push(child);
    return child;
  });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(async () => {
  vi.useRealTimers();
  kill.mockRestore();
  spawnMock.mockReset();
  process.env.PATH = path;
  await rm(tmp, { recursive: true, force: true });
});

/** Lets the real file lookups finish (timers are fake, setImmediate is not) until the nth bd process was started. */
async function started(n: number): Promise<FakeChild> {
  for (let i = 0; i < 500 && children.length < n; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
  expect(children.length).toBeGreaterThanOrEqual(n);
  return children[n - 1]!;
}

function finish(child: FakeChild, stdout: string, code = 0): void {
  child.stdout.write(stdout);
  child.emit('close', code, null);
}

describe('the update runs under its own time limit', () => {
  it('a 20 s update is not killed by the usual 15 s write limit, and the project reads back as updated', async () => {
    const update = new BdProvider('/work/proj', 'embedded').migrateSchema('Ann (panel)');
    const migrate = await started(1);
    expect(spawnMock.mock.calls[0]![1]).toEqual(['--actor', 'Ann (panel)', 'migrate', 'schema']);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(killed).toEqual([]);

    finish(migrate, '✓ Schema updated\n');
    // The read-back that proves it, read-only.
    const read = await started(2);
    expect(spawnMock.mock.calls[1]![1].slice(0, 1)).toEqual(['--readonly']);
    finish(read, STATUSES);
    await expect(update).resolves.toBeUndefined();
    expect(killed).toEqual([]);
  });

  it('it is still not killed a minute in, and is ended (as uncertain, never retried) only at its own budget', async () => {
    const update = new BdProvider('/work/proj', 'embedded').migrateSchema('Ann (panel)');
    const caught = update.catch((e: unknown) => e);
    await started(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(killed).toEqual([]);

    // The budget less the time kept back for the read-back.
    await vi.advanceTimersByTimeAsync(MIGRATE_BUDGET_MS - 60_000);
    expect(killed.length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(2_000);
    const error = await caught;
    expect(error).toBeInstanceOf(WriteError);
    expect(error).toMatchObject({ code: 'uncertain' });
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('every other write is still held to the usual limit: a write that hangs is killed at 15 s', async () => {
    const write = new BdProvider('/work/proj', 'embedded').enableEventsJournal('Ann (panel)').catch((e: unknown) => e);
    await started(1);
    await vi.advanceTimersByTimeAsync(14_000);
    expect(killed).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(killed.length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await write).toMatchObject({ code: 'uncertain' });
  });
});
