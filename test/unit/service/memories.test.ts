import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/service/bd/exec', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/service/bd/exec')>()),
  runBd: vi.fn(),
  runBdJson: vi.fn(),
  runDolt: vi.fn(),
  runGit: vi.fn(),
}));

vi.mock('../../../src/service/bd/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/service/bd/audit')>()),
  runSql: vi.fn(),
}));

import { WriteError } from '../../../src/service/bd/adapter';
import { runSql } from '../../../src/service/bd/audit';
import { BdError, runBdJson } from '../../../src/service/bd/exec';
import { forgetMemory, generateKey, listMemories, rememberMemory } from '../../../src/service/memories';

const bdJson = vi.mocked(runBdJson);
const sql = vi.mocked(runSql);

const ROOT = '/projects/demo';
const ACTOR = 'Ann (panel)';

const fixture = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, '../../fixtures/bd13', `${name}.json`), 'utf8'));

/** What the fake bd holds, and every call it got (after `--readonly` / `--actor <name>` are peeled off). */
let store: Map<string, string>;
let calls: Array<{ args: string[]; actor: string | null; readonly: boolean }>;
/** Replaces what `remember` prints, for the answer the tests want. */
let rememberAction: ((key: string) => string) | null;

function words(args: string[]): { actor: string | null; readonly: boolean; rest: string[] } {
  let actor: string | null = null;
  let readonly = false;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--readonly') readonly = true;
    else if (args[i] === '--actor') actor = args[(i += 1)] ?? null;
    else rest.push(args[i]!);
  }
  return { actor, readonly, rest };
}

const keyFlag = (rest: string[]): string | null => {
  const at = rest.findIndex((a) => a === '--key' || a.startsWith('--key='));
  if (at === -1) return null;
  return rest[at] === '--key' ? (rest[at + 1] ?? null) : rest[at]!.slice('--key='.length);
};

beforeEach(() => {
  store = new Map([
    ['race-flag', 'Always run tests with the --race flag'],
    ['use-pnpm-not-npm', 'Use pnpm, not npm'],
  ]);
  calls = [];
  rememberAction = null;
  bdJson.mockReset();
  sql.mockReset();
  sql.mockResolvedValue([]);
  bdJson.mockImplementation(async (_root, args) => {
    const { actor, readonly, rest } = words(args);
    calls.push({ args, actor, readonly });
    const dashes = rest.indexOf('--');
    const positional = dashes === -1 ? [] : rest.slice(dashes + 1);
    if (rest[0] === 'memories') return { ...Object.fromEntries([...store].sort(([a], [b]) => (a < b ? -1 : 1))), schema_version: 1 };
    if (rest[0] === 'remember') {
      const key = keyFlag(rest) ?? 'generated-by-bd';
      const text = positional[0]!;
      const action = rememberAction?.(key) ?? (store.has(key) ? 'updated' : 'remembered');
      if (action !== 'recalled') store.set(key, text);
      return { action, key, schema_version: 1, value: store.get(key) ?? text };
    }
    if (rest[0] === 'forget') {
      const key = positional[0]!;
      if (!store.delete(key)) throw new BdError('exit', 'forget failed', { code: 1, stderr: '' });
      return { deleted: 'true', key, schema_version: 1 };
    }
    throw new Error(`unexpected bd call: ${args.join(' ')}`);
  });
});

const writes = () => calls.filter((c) => !c.readonly);

describe('list', () => {
  it('the fixtures are what the fake bd imitates', () => {
    expect(fixture('memories-list-json')).toMatchObject({ schema_version: 1 });
    expect(fixture('memories-empty')).toEqual({ schema_version: 1 });
    expect(fixture('remember-bare-key')).toMatchObject({ action: 'remembered' });
    expect(fixture('forget')).toMatchObject({ deleted: 'true' });
    expect(fixture('forget-missing')).toMatchObject({ found: 'false' });
    expect(fixture('remember-update')).toMatchObject({ action: 'updated' });
    expect(fixture('remember')).toMatchObject({ action: 'remembered' });
  });

  it('list drops schema_version and orders newest first', async () => {
    sql.mockResolvedValue([
      { to_key: 'kv.memory.use-pnpm-not-npm', diff_type: 'modified', to_commit_date: '2026-10-15 09:30:40.568000', message: 'bd: remember (auto-commit) by Ann (panel)' },
      { to_key: 'kv.memory.race-flag', diff_type: 'added', to_commit_date: '2026-10-14 08:00:00.000000', message: 'bd: remember (auto-commit) by Bo (panel)' },
      // An older row for a key already seen is not the last change.
      { to_key: 'kv.memory.use-pnpm-not-npm', diff_type: 'added', to_commit_date: '2026-10-01 08:00:00.000000', message: 'bd: remember (auto-commit) by Old (panel)' },
    ]);
    const result = await listMemories(ROOT, 'embedded');
    expect(result.memories.map((m) => m.key)).toEqual(['use-pnpm-not-npm', 'race-flag']);
    expect(result.memories[0]).toEqual({ key: 'use-pnpm-not-npm', text: 'Use pnpm, not npm', changedAt: '2026-10-15T09:30:40.568Z', changedBy: 'Ann (panel)' });
    expect(result.memories[1]).toMatchObject({ key: 'race-flag', changedAt: '2026-10-14T08:00:00.000Z', changedBy: 'Bo (panel)' });
    expect(result.memories.some((m) => m.key === 'schema_version')).toBe(false);
    expect(calls[0]).toMatchObject({ readonly: true, args: ['--readonly', 'memories', '--json'] });
  });

  it('a key with no change row sorts last with no date', async () => {
    sql.mockResolvedValue([{ to_key: 'kv.memory.race-flag', diff_type: 'added', to_commit_date: '2026-10-14 08:00:00.000000', message: 'bd: remember (auto-commit) by Bo (panel)' }]);
    const { memories } = await listMemories(ROOT, 'embedded');
    expect(memories.map((m) => m.key)).toEqual(['race-flag', 'use-pnpm-not-npm']);
    expect(memories[1]).toMatchObject({ changedAt: null, changedBy: null });
  });

  it('a commit that did not come from Beads has a date and no author', async () => {
    sql.mockResolvedValue([{ to_key: 'kv.memory.race-flag', diff_type: 'added', to_commit_date: '2026-10-14T08:00:00Z', message: 'Merge remote-tracking branch' }]);
    const { memories } = await listMemories(ROOT, 'server');
    expect(memories[0]).toMatchObject({ key: 'race-flag', changedAt: '2026-10-14T08:00:00.000Z', changedBy: null });
  });

  it('list survives a failing SQL read', async () => {
    sql.mockRejectedValue(new BdError('not-found', 'dolt is not installed'));
    const result = await listMemories(ROOT, 'embedded');
    expect(result.memories).toEqual([
      { key: 'race-flag', text: 'Always run tests with the --race flag', changedAt: null, changedBy: null },
      { key: 'use-pnpm-not-npm', text: 'Use pnpm, not npm', changedAt: null, changedBy: null },
    ]);
  });

  it('a project with no memories lists none', async () => {
    store.clear();
    expect((await listMemories(ROOT, 'embedded')).memories).toEqual([]);
  });

  it('the list does not fail on a value that is not text', async () => {
    bdJson.mockResolvedValueOnce({ good: 'ok', odd: 7, schema_version: 1 });
    expect((await listMemories(ROOT, 'embedded')).memories.map((m) => m.key)).toEqual(['good']);
  });

  it('search filters by key and text', async () => {
    expect((await listMemories(ROOT, 'embedded', 'PNPM')).memories.map((m) => m.key)).toEqual(['use-pnpm-not-npm']);
    expect((await listMemories(ROOT, 'embedded', 'race')).memories.map((m) => m.key)).toEqual(['race-flag']);
    expect((await listMemories(ROOT, 'embedded', 'tests with')).memories.map((m) => m.key)).toEqual(['race-flag']);
    expect((await listMemories(ROOT, 'embedded', 'nothing like this')).memories).toEqual([]);
    expect((await listMemories(ROOT, 'embedded', '   ')).memories).toHaveLength(2);
  });

  it('the fingerprint covers the whole list, not the search, and changes with a text', async () => {
    const all = await listMemories(ROOT, 'embedded');
    expect((await listMemories(ROOT, 'embedded', 'pnpm')).fingerprint).toBe(all.fingerprint);
    store.set('race-flag', 'changed');
    expect((await listMemories(ROOT, 'embedded')).fingerprint).not.toBe(all.fingerprint);
  });
});

describe('keys', () => {
  it('a generated key is lowercase words joined by dashes, at most 60 characters', () => {
    expect(generateKey('Always run tests with the --race flag!', new Set())).toBe('always-run-tests-with-the-race-flag');
    expect(generateKey('x'.repeat(100), new Set())).toBe('x'.repeat(60));
    expect(generateKey('word '.repeat(30), new Set()).length).toBeLessThanOrEqual(60);
    expect(generateKey('word '.repeat(30), new Set())).not.toMatch(/-$/);
    expect(generateKey('???', new Set())).toBe('memory');
  });

  it('generated key avoids collisions', () => {
    expect(generateKey('Use pnpm', new Set(['use-pnpm']))).toBe('use-pnpm-2');
    expect(generateKey('Use pnpm', new Set(['use-pnpm', 'use-pnpm-2']))).toBe('use-pnpm-3');
  });
});

describe('remember', () => {
  it('key is always passed to remember, generated when the person gives none', async () => {
    const result = await rememberMemory(ROOT, { text: 'Use tabs in Go files' }, ACTOR);
    expect(result).toMatchObject({ ok: true, memory: { key: 'use-tabs-in-go-files', text: 'Use tabs in Go files', changedBy: ACTOR } });
    const [write] = writes();
    expect(write!.args).toEqual(['--actor', ACTOR, 'remember', '--json', '--key', 'use-tabs-in-go-files', '--', 'Use tabs in Go files']);
    expect(write!.actor).toBe(ACTOR);
    expect(store.get('use-tabs-in-go-files')).toBe('Use tabs in Go files');
  });

  it('a given key is used as typed and passed too', async () => {
    await rememberMemory(ROOT, { text: 'Use tabs', key: 'go.tabs' }, ACTOR);
    expect(writes()[0]!.args).toContain('go.tabs');
    expect(keyFlag(writes()[0]!.args)).toBe('go.tabs');
  });

  it('a generated key skips one that is taken', async () => {
    await rememberMemory(ROOT, { text: 'Use pnpm not npm' }, ACTOR);
    await rememberMemory(ROOT, { text: 'Use pnpm not npm!' }, ACTOR);
    expect([...store.keys()]).toEqual(expect.arrayContaining(['use-pnpm-not-npm-2', 'use-pnpm-not-npm-3']));
  });

  it('rejects the key schema_version', async () => {
    await expect(rememberMemory(ROOT, { text: 'x', key: 'schema_version' }, ACTOR)).rejects.toMatchObject({ code: 'invalid', message: expect.stringMatching(/name/i) });
    expect(writes()).toHaveLength(0);
  });

  it.each(['', 'Has Caps', '-lead', 'a b', 'x'.repeat(81), 'tab\tkey'])('rejects the key %j', async (key) => {
    await expect(rememberMemory(ROOT, { text: 'x', key }, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    expect(writes()).toHaveLength(0);
  });

  it('remember with an existing key never silently recalls', async () => {
    rememberAction = () => 'recalled';
    await expect(rememberMemory(ROOT, { text: 'Use tabs', key: 'brand-new' }, ACTOR)).rejects.toMatchObject({ code: 'failed', message: 'Beads did not save that' });
    expect(store.has('brand-new')).toBe(false);
  });

  it('refuses text that equals an existing key, which Beads would recall instead of store', async () => {
    await expect(rememberMemory(ROOT, { text: 'race-flag' }, ACTOR)).rejects.toMatchObject({ code: 'invalid', message: expect.stringMatching(/name of another memory/i) });
    await expect(rememberMemory(ROOT, { text: '  use-pnpm-not-npm ', key: 'other' }, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    expect(writes()).toHaveLength(0);
  });

  it('add refuses an existing key without expectedText', async () => {
    const result = await rememberMemory(ROOT, { text: 'New words', key: 'race-flag' }, ACTOR);
    expect(result).toEqual({ ok: false, code: 'changed', current: { key: 'race-flag', text: 'Always run tests with the --race flag', changedAt: null, changedBy: null } });
    expect(writes()).toHaveLength(0);
    expect(store.get('race-flag')).toBe('Always run tests with the --race flag');
  });

  it('edit writes when the stored text is what the person loaded', async () => {
    const result = await rememberMemory(ROOT, { text: 'Always run tests with -race', key: 'race-flag', expectedText: 'Always run tests with the --race flag' }, ACTOR);
    expect(result).toMatchObject({ ok: true, memory: { key: 'race-flag', text: 'Always run tests with -race' } });
    expect(store.get('race-flag')).toBe('Always run tests with -race');
    // The re-read comes before the write, and again after it.
    expect(calls.map((c) => (c.readonly ? 'read' : 'write'))).toEqual(['read', 'write', 'read']);
  });

  it('edit refused when the text changed since load', async () => {
    store.set('race-flag', 'Somebody else changed this');
    const result = await rememberMemory(ROOT, { text: 'Mine', key: 'race-flag', expectedText: 'Always run tests with the --race flag' }, ACTOR);
    expect(result).toMatchObject({ ok: false, code: 'changed', current: { key: 'race-flag', text: 'Somebody else changed this' } });
    expect(writes()).toHaveLength(0);
    expect(store.get('race-flag')).toBe('Somebody else changed this');
  });

  it('edit of a memory someone forgot meanwhile reports changed with null', async () => {
    store.delete('race-flag');
    expect(await rememberMemory(ROOT, { text: 'Mine', key: 'race-flag', expectedText: 'old' }, ACTOR)).toEqual({ ok: false, code: 'changed', current: null });
    expect(writes()).toHaveLength(0);
  });

  it('edit needs a key', async () => {
    await expect(rememberMemory(ROOT, { text: 'Mine', expectedText: 'old' }, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('edit with identical text writes nothing', async () => {
    const result = await rememberMemory(ROOT, { text: 'Use pnpm, not npm', key: 'use-pnpm-not-npm', expectedText: 'Use pnpm, not npm' }, ACTOR);
    expect(result).toMatchObject({ ok: true, memory: { key: 'use-pnpm-not-npm', text: 'Use pnpm, not npm' } });
    expect(writes()).toHaveLength(0);
  });

  it('text over 4000 is rejected, not cut', async () => {
    await expect(rememberMemory(ROOT, { text: 'a'.repeat(4001) }, ACTOR)).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('4,000') });
    expect(writes()).toHaveLength(0);
    await rememberMemory(ROOT, { text: 'a'.repeat(4000), key: 'long' }, ACTOR);
    expect(store.get('long')).toHaveLength(4000);
  });

  it.each(['', '   \n '])('empty text %j is rejected', async (text) => {
    await expect(rememberMemory(ROOT, { text }, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('text that starts with a dash goes in after the separator, never as a flag', async () => {
    await rememberMemory(ROOT, { text: '--force everything', key: 'dashy' }, ACTOR);
    const args = writes()[0]!.args;
    expect(args.indexOf('--')).toBeLessThan(args.indexOf('--force everything'));
  });

  it('a write that Beads accepts but the re-read does not show is a failure', async () => {
    bdJson.mockImplementation(async (_root, args) => {
      const { actor, readonly, rest } = words(args);
      calls.push({ args, actor, readonly });
      if (rest[0] === 'memories') return { schema_version: 1 };
      return { action: 'remembered', key: 'k', schema_version: 1, value: 'x' };
    });
    await expect(rememberMemory(ROOT, { text: 'x', key: 'k' }, ACTOR)).rejects.toMatchObject({ code: 'failed' });
  });

  it('a read that fails before the write saves nothing and says so', async () => {
    bdJson.mockRejectedValueOnce(new BdError('lock', 'database is locked'));
    await expect(rememberMemory(ROOT, { text: 'x', key: 'k' }, ACTOR)).rejects.toMatchObject({ code: 'busy', message: expect.stringContaining('Nothing was saved') });
    expect(writes()).toHaveLength(0);
  });

  it('a write that times out may or may not have saved', async () => {
    const original = bdJson.getMockImplementation()!;
    bdJson.mockImplementation(async (root, args, opts) => {
      if (!args.includes('--readonly')) throw new BdError('timeout', 'bd timed out');
      return original(root, args, opts);
    });
    await expect(rememberMemory(ROOT, { text: 'x', key: 'k' }, ACTOR)).rejects.toMatchObject({ code: 'uncertain' });
  });

  it('an older Beads without the command is unsupported', async () => {
    const original = bdJson.getMockImplementation()!;
    bdJson.mockImplementation(async (root, args, opts) => {
      if (!args.includes('--readonly')) throw new BdError('exit', 'x', { code: 1, stderr: 'Error: unknown command "remember" for "bd"' });
      return original(root, args, opts);
    });
    const error = await rememberMemory(ROOT, { text: 'x', key: 'k' }, ACTOR).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WriteError);
    expect(error).toMatchObject({ code: 'unsupported' });
  });

  it('writes are never retried', async () => {
    await rememberMemory(ROOT, { text: 'x', key: 'k' }, ACTOR);
    const opts = bdJson.mock.calls.find((c) => !c[1].includes('--readonly'))![2]!;
    expect(opts.retries).toBe(0);
    expect(opts.deadlineAt).toBeGreaterThan(Date.now());
  });
});

describe('forget', () => {
  it('forgets a memory whose text is what the person saw', async () => {
    const result = await forgetMemory(ROOT, { key: 'race-flag', expectedText: 'Always run tests with the --race flag' }, ACTOR);
    expect(result).toEqual({ ok: true, memory: null });
    expect(store.has('race-flag')).toBe(false);
    expect(writes()[0]!.args).toEqual(['--actor', ACTOR, 'forget', '--json', '--', 'race-flag']);
  });

  it('forget refused when the text changed', async () => {
    store.set('race-flag', 'Somebody else changed this');
    const result = await forgetMemory(ROOT, { key: 'race-flag', expectedText: 'Always run tests with the --race flag' }, ACTOR);
    expect(result).toMatchObject({ ok: false, code: 'changed', current: { key: 'race-flag', text: 'Somebody else changed this' } });
    expect(store.has('race-flag')).toBe(true);
    expect(writes()).toHaveLength(0);
  });

  it('forget of an already forgotten key reports changed with null', async () => {
    store.delete('race-flag');
    expect(await forgetMemory(ROOT, { key: 'race-flag', expectedText: 'old' }, ACTOR)).toEqual({ ok: false, code: 'changed', current: null });
    expect(writes()).toHaveLength(0);
  });

  it('never forgets the schema_version marker', async () => {
    await expect(forgetMemory(ROOT, { key: 'schema_version', expectedText: '1' }, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    expect(calls).toHaveLength(0);
  });

  it('a forget that Beads accepts but the re-read still shows is a failure', async () => {
    const original = bdJson.getMockImplementation()!;
    bdJson.mockImplementation(async (root, args, opts) => {
      if (args.includes('forget')) return { deleted: 'true', key: 'race-flag', schema_version: 1 };
      return original(root, args, opts);
    });
    await expect(forgetMemory(ROOT, { key: 'race-flag', expectedText: 'Always run tests with the --race flag' }, ACTOR)).rejects.toMatchObject({ code: 'failed' });
  });
});

describe('the queue', () => {
  it('a write waits behind an earlier call for the same root', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const original = bdJson.getMockImplementation()!;
    bdJson.mockImplementationOnce(async (root, args, opts) => {
      order.push('first-start');
      await gate;
      order.push('first-end');
      return original(root, args, opts);
    });
    const first = listMemories(ROOT, 'embedded');
    const second = rememberMemory(ROOT, { text: 'x', key: 'k' }, ACTOR).then(() => order.push('second-done'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(['first-start']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second-done']);
  });
});
