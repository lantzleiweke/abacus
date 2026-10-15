import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { childEnv, runBd, runBdJson } from '../../src/service/bd/exec';
import { forgetMemory, listMemories, rememberMemory } from '../../src/service/memories';

const run = promisify(execFile);
const ACTOR = 'Scratch User (panel)';
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Real bd and dolt, in a scratch project under the OS temp dir. Never a real project.
describe.skipIf(process.env.BD_INTEGRATION !== '1')('memories (embedded bd)', () => {
  let tmp: string;
  let root: string;

  const stored = async (): Promise<Record<string, unknown>> => runBdJson<Record<string, unknown>>(root, ['--readonly', 'memories', '--json']);

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(join(tmpdir(), 'oc-beads-memories-int-')));
    root = join(tmp, 'proj');
    await run('mkdir', [root]);
    await run('git', ['init', '-q'], { cwd: root, env: childEnv() });
    await run('git', ['config', 'user.name', 'Scratch User'], { cwd: root, env: childEnv() });
    const init = await runBd(root, ['init', '--prefix', 'mm', '--non-interactive', '--quiet']);
    if (init.code !== 0) throw new Error(`bd init failed: ${init.stderr || init.stdout}`);
  }, 90_000);

  afterAll(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('a project with no memories lists none', async () => {
    expect(await listMemories(root, 'embedded')).toMatchObject({ memories: [] });
  }, 30_000);

  it('remember, edit and forget: the list is newest first and the author is the panel actor', async () => {
    const first = await rememberMemory(root, { text: 'Always run tests with the --race flag' }, ACTOR);
    expect(first).toMatchObject({ ok: true, memory: { key: 'always-run-tests-with-the-race-flag', changedBy: ACTOR } });
    await pause(1100);
    const second = await rememberMemory(root, { text: 'Use pnpm, not npm', key: 'package-manager' }, ACTOR);
    expect(second).toMatchObject({ ok: true, memory: { key: 'package-manager' } });

    let listed = await listMemories(root, 'embedded');
    expect(listed.memories.map((m) => m.key)).toEqual(['package-manager', 'always-run-tests-with-the-race-flag']);
    for (const memory of listed.memories) {
      expect(memory.changedBy).toBe(ACTOR);
      expect(Math.abs(Date.now() - Date.parse(memory.changedAt!))).toBeLessThan(120_000);
    }
    expect(Date.parse(listed.memories[0]!.changedAt!)).toBeGreaterThan(Date.parse(listed.memories[1]!.changedAt!));

    // An edit moves the memory to the top, with the new text.
    await pause(1100);
    const edited = await rememberMemory(root, { text: 'Always run tests with -race and -count=1', key: 'always-run-tests-with-the-race-flag', expectedText: 'Always run tests with the --race flag' }, ACTOR);
    expect(edited).toMatchObject({ ok: true, memory: { text: 'Always run tests with -race and -count=1' } });
    listed = await listMemories(root, 'embedded');
    expect(listed.memories.map((m) => m.key)).toEqual(['always-run-tests-with-the-race-flag', 'package-manager']);
    expect(listed.memories[0]!.text).toBe('Always run tests with -race and -count=1');

    // Stale edits and stale forgets write nothing.
    const stale = await rememberMemory(root, { text: 'Mine', key: 'package-manager', expectedText: 'Use npm' }, ACTOR);
    expect(stale).toMatchObject({ ok: false, code: 'changed', current: { key: 'package-manager', text: 'Use pnpm, not npm' } });
    expect(await forgetMemory(root, { key: 'package-manager', expectedText: 'Use npm' }, ACTOR)).toMatchObject({ ok: false, code: 'changed' });
    expect((await stored())['package-manager']).toBe('Use pnpm, not npm');

    // Forget, and then forget again.
    expect(await forgetMemory(root, { key: 'package-manager', expectedText: 'Use pnpm, not npm' }, ACTOR)).toEqual({ ok: true, memory: null });
    expect(Object.keys(await stored())).not.toContain('package-manager');
    expect(await forgetMemory(root, { key: 'package-manager', expectedText: 'Use pnpm, not npm' }, ACTOR)).toEqual({ ok: false, code: 'changed', current: null });
    listed = await listMemories(root, 'embedded');
    expect(listed.memories.map((m) => m.key)).toEqual(['always-run-tests-with-the-race-flag']);
  }, 120_000);

  it('Add never overwrites a key that is taken', async () => {
    const result = await rememberMemory(root, { text: 'Something else', key: 'always-run-tests-with-the-race-flag' }, ACTOR);
    expect(result).toMatchObject({ ok: false, code: 'changed', current: { text: 'Always run tests with -race and -count=1' } });
    expect((await stored())['always-run-tests-with-the-race-flag']).toBe('Always run tests with -race and -count=1');
  }, 30_000);

  it('refuses text that is the name of a memory and the name schema_version, writing nothing', async () => {
    const before = await stored();
    await expect(rememberMemory(root, { text: 'always-run-tests-with-the-race-flag' }, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    await expect(rememberMemory(root, { text: 'x', key: 'schema_version' }, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    expect(await stored()).toEqual(before);
  }, 30_000);

  it('keeps text exactly: a leading dash, quotes, line breaks and unicode', async () => {
    const text = '--force is never ok\nSay "done" only when it is — café ✓';
    const saved = await rememberMemory(root, { text, key: 'odd-text' }, ACTOR);
    expect(saved).toMatchObject({ ok: true, memory: { text } });
    expect((await stored())['odd-text']).toBe(text);
    expect((await listMemories(root, 'embedded', 'CAFÉ')).memories.map((m) => m.key)).toEqual(['odd-text']);
    expect(await forgetMemory(root, { key: 'odd-text', expectedText: text }, ACTOR)).toEqual({ ok: true, memory: null });
  }, 60_000);

  it('text of 4000 characters is kept whole and 4001 is refused', async () => {
    const long = 'word '.repeat(799) + 'abcde';
    expect(long).toHaveLength(4000);
    expect(await rememberMemory(root, { text: long, key: 'long-one' }, ACTOR)).toMatchObject({ ok: true });
    expect((await stored())['long-one']).toBe(long);
    await expect(rememberMemory(root, { text: `${long}x`, key: 'too-long' }, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    expect(Object.keys(await stored())).not.toContain('too-long');
    await forgetMemory(root, { key: 'long-one', expectedText: long }, ACTOR);
  }, 60_000);
});
