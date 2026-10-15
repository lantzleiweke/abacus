import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../../../src/service/bd/exec', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/service/bd/exec')>()),
  runBd: vi.fn(),
  runBdJson: vi.fn(),
  runDolt: vi.fn(),
  runGit: vi.fn(),
}));

import { BdProvider, WriteError, onPanelWrite, withRootQueue } from '../../../src/service/bd/adapter';
import { BdError, runBd, runBdJson, type RunOptions } from '../../../src/service/bd/exec';

const bd = vi.mocked(runBd);
const bdJson = vi.mocked(runBdJson);

const ROOT = '/projects/demo';
const ACTOR = 'Ann (panel)';
const T0 = '2026-10-14T10:00:00Z';

type Raw = Record<string, unknown>;
type Call = { args: string[]; opts: RunOptions };

let issues: Map<string, Raw>;
let calls: Call[];
let clock: number;
let nextId: number;
/** The panel-write listener the adapter tells (snapshot.ts registers the real one; it is not loaded here). */
let recordPanelWrite: Mock<(root: string, beadId: string) => void | Promise<void>>;
/** What each panel write said it touched, in order. */
let panelWrote: unknown[];
let unlisten: () => void;
/** Per command ("update", "close", ...): replaces what the fake does. */
let overrides: Record<string, (args: string[]) => unknown>;

const STATUSES = JSON.stringify({
  built_in_statuses: [
    { name: 'open', category: 'active', icon: 'o' },
    { name: 'in_progress', category: 'wip', icon: 'p' },
    { name: 'closed', category: 'done', icon: 'x' },
  ],
  custom_statuses: [{ name: 'shipped', category: 'done' }],
});

function issue(id: string, over: Raw = {}): Raw {
  return { id, title: `Title ${id}`, status: 'open', priority: 2, issue_type: 'task', created_at: T0, updated_at: T0, ...over };
}

function parse(args: string[]) {
  const dashes = args.indexOf('--');
  const before = dashes === -1 ? args : args.slice(0, dashes);
  const positionals = dashes === -1 ? [] : args.slice(dashes + 1);
  const flags = new Map<string, string[]>();
  const words: string[] = [];
  let actor: string | undefined;
  for (let i = 0; i < before.length; i += 1) {
    const arg = before[i]!;
    if (arg === '--actor') {
      actor = before[(i += 1)];
    } else if (arg.startsWith('--') && arg.includes('=')) {
      const at = arg.indexOf('=');
      flags.set(arg.slice(0, at), [...(flags.get(arg.slice(0, at)) ?? []), arg.slice(at + 1)]);
    } else if (arg.startsWith('-')) {
      flags.set(arg, flags.get(arg) ?? []);
    } else words.push(arg);
  }
  return { actor, words, flags, positionals };
}

function tick(): string {
  clock += 1_000;
  return new Date(clock).toISOString().replace('.000Z', 'Z');
}

/** `comments <id>` reads, `comments add` writes; `dep add|remove` are two words too. */
function commandName(words: string[]): string {
  if (words[0] === 'comments') return words[1] === 'add' ? 'comments add' : 'comments list';
  if (words[0] === 'dep') return `dep ${words[1]}`;
  return words[0]!;
}

function fakeBd(args: string[]): unknown {
  const { words, flags, positionals } = parse(args);
  const cmd = commandName(words);
  const override = overrides[cmd];
  if (override) return override(args);
  switch (cmd) {
    case 'statuses':
      return JSON.parse(STATUSES);
    case 'list': {
      const row = issues.get(flags.get('--id')?.[0] ?? positionals[0] ?? args[args.indexOf('--id') + 1]!);
      return row ? [row] : [];
    }
    case 'update': {
      const row = issues.get(positionals[0]!)!;
      const map: Record<string, string> = { '--title': 'title', '--description': 'description', '--design': 'design', '--acceptance': 'acceptance_criteria', '--notes': 'notes', '--assignee': 'assignee', '--status': 'status' };
      for (const [flag, key] of Object.entries(map)) if (flags.has(flag)) row[key] = flags.get(flag)![0];
      if (flags.has('--priority')) row.priority = Number(flags.get('--priority')![0]);
      const labels = new Set((row.labels as string[] | undefined) ?? []);
      for (const l of flags.get('--add-label') ?? []) labels.add(l);
      for (const l of flags.get('--remove-label') ?? []) labels.delete(l);
      row.labels = [...labels];
      row.updated_at = tick();
      return [row];
    }
    case 'close': {
      const row = issues.get(positionals[0]!)!;
      row.status = 'closed';
      row.close_reason = flags.get('--reason')?.[0];
      row.updated_at = tick();
      return [row];
    }
    case 'reopen': {
      const row = issues.get(positionals[0]!)!;
      row.status = 'open';
      delete row.close_reason;
      row.updated_at = tick();
      return [row];
    }
    case 'create': {
      nextId += 1;
      const id = `n-${nextId}`;
      issues.set(id, issue(id, { title: flags.get('--title')?.[0], issue_type: flags.get('--type')?.[0], priority: Number(flags.get('--priority')?.[0]), description: flags.get('--description')?.[0], ...(flags.has('--parent') ? { parent: flags.get('--parent')![0] } : {}), created_at: tick(), updated_at: clock }));
      return { id, schema_version: 1 };
    }
    case 'comments list':
      return (issues.get(words[1]!)?.comments_list as unknown[] | undefined) ?? [];
    case 'comments add':
      return { id: 'c-1', issue_id: positionals[0], author: flags.get('--author')?.[0], text: positionals[1], created_at: tick(), schema_version: 1 };
    case 'dep add':
      return { issue_id: positionals[0], depends_on_id: positionals[1], type: flags.get('--type')?.[0], status: 'added', schema_version: 1 };
    case 'dep remove':
      return { issue_id: positionals[0], depends_on_id: positionals[1], status: 'removed', schema_version: 1 };
    default:
      throw new Error(`unexpected bd call: ${args.join(' ')}`);
  }
}

/** The command words of a call, for asserting what ran. */
const commandOf = (c: Call): string => commandName(parse(c.args).words);
const ran = (): string[] => calls.map(commandOf);
const writes = (): Call[] => calls.filter((c) => !['list', 'statuses', 'comments list'].includes(commandOf(c)));

/** Holds the root's queue until `release()`; resolves once the hold is running, so a call made next really waits behind it. */
async function holdQueue(): Promise<{ release: () => void; blocker: Promise<void> }> {
  let release = () => {};
  let started = () => {};
  const running = new Promise<void>((resolve) => (started = resolve));
  const blocker = withRootQueue(ROOT, () => new Promise<void>((resolve) => {
    release = resolve;
    started();
  }));
  await running;
  return { release, blocker };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse(T0));
  clock = Date.parse(T0);
  nextId = 0;
  calls = [];
  overrides = {};
  issues = new Map([
    ['a', issue('a', { labels: ['x', 'y'], assignee: 'Bob' })],
    ['done', issue('done', { status: 'closed', closed_at: T0, close_reason: 'finished' })],
  ]);
  recordPanelWrite = vi.fn();
  panelWrote = [];
  unlisten = onPanelWrite((root, beadId, wrote) => {
    panelWrote.push(wrote);
    return recordPanelWrite(root, beadId);
  });
  bd.mockReset();
  bdJson.mockReset();
  bd.mockImplementation(async (_dir, args, opts) => {
    calls.push({ args, opts: opts ?? {} });
    try {
      return { stdout: JSON.stringify(fakeBd(args)), stderr: '', code: 0 };
    } catch (error) {
      if (error instanceof BdError) throw error;
      return { stdout: '', stderr: (error as Error).message, code: 1 };
    }
  });
  bdJson.mockImplementation(async (dir, args, opts) => {
    const result = await bd(dir, args, opts);
    if (result.code !== 0) throw new BdError('exit', result.stderr, { code: result.code, stderr: result.stderr });
    return JSON.parse(result.stdout) as never;
  });
});

afterEach(() => {
  unlisten();
  vi.useRealTimers();
});

const provider = () => new BdProvider(ROOT, 'embedded');
const beadA = () => issues.get('a')!;

describe('BdProvider.update', () => {
  it('conflict when updatedAt moved: nothing is written and the current bead comes back', async () => {
    beadA().updated_at = '2026-10-14T10:00:30Z';
    const result = await provider().update('a', T0, { title: 'Mine' }, ACTOR);
    expect(result).toMatchObject({ ok: false, conflict: true, current: { id: 'a', updatedAt: '2026-10-14T10:00:30Z' } });
    expect(writes()).toEqual([]);
    expect(recordPanelWrite).not.toHaveBeenCalled();
  });

  it('conflict when a field changed within the same second: the shown value does not match, and nothing is written', async () => {
    // Same updated_at (it has one-second precision), different priority.
    beadA().priority = 1;
    const result = await provider().update('a', T0, { priority: 0 }, ACTOR, { priority: 2 });
    expect(result).toMatchObject({ ok: false, conflict: true, current: { id: 'a', priority: 1 } });
    expect(writes()).toEqual([]);
    expect(recordPanelWrite).not.toHaveBeenCalled();
  });

  it('compares shown labels as sets, the title trimmed, and an empty assignee as none', async () => {
    beadA().labels = ['b', 'a'];
    beadA().title = 'Shown title';
    beadA().assignee = '';
    const same = await provider().update('a', T0, { labels: ['a', 'b', 'c'] }, ACTOR, { labels: ['a', 'b'], title: '  Shown title ', assignee: null });
    expect(same).toMatchObject({ ok: true });
    const moved = await provider().update('a', (same as { bead: { updatedAt: string } }).bead.updatedAt, { labels: ['x'] }, ACTOR, { labels: ['a', 'b'] });
    expect(moved).toMatchObject({ ok: false, conflict: true, current: { labels: expect.arrayContaining(['a', 'b', 'c']) } });
  });

  it('timeout is uncertain, re-reads: the write is never retried and the bead is read again', async () => {
    overrides.update = () => {
      beadA().title = 'Mine';
      beadA().updated_at = '2026-10-14T10:00:05Z';
      throw new BdError('timeout', 'bd timed out after 15000 ms');
    };
    const result = await provider().update('a', T0, { title: 'Mine' }, ACTOR);
    expect(result).toMatchObject({ ok: false, uncertain: true, current: { id: 'a', title: 'Mine' } });
    expect(ran()).toEqual(['list', 'update', 'list']);
    // It may have saved, so the next refresh must still treat it as the panel's own.
    expect(recordPanelWrite).toHaveBeenCalledWith(ROOT, 'a');
    // Only what it set is credited to the panel.
    expect(panelWrote).toEqual([{ fields: ['title'] }]);
  });

  it('is uncertain with no bead when the re-read after a timeout fails too', async () => {
    overrides.update = () => {
      throw new BdError('timeout', 'slow');
    };
    let lists = 0;
    overrides.list = (args) => {
      lists += 1;
      if (lists === 2) throw new BdError('timeout', 'slow again');
      return [beadA()];
    };
    const result = await provider().update('a', T0, { title: 'Mine' }, ACTOR);
    expect(result).toMatchObject({ ok: false, uncertain: true, current: null, detail: 'slow' });
    expect(result).not.toHaveProperty('saved');
  });

  it('writes carry --actor and --author', async () => {
    await provider().update('a', T0, { title: 'Mine' }, ACTOR);
    await provider().comment('a', 'Hello', ACTOR);
    await provider().dependency('add', 'a', 'done', 'blocks', ACTOR);
    await provider().create({ title: 'New', type: 'task', priority: 2, parentId: null, description: '' }, ACTOR);
    for (const call of writes()) {
      const at = call.args.indexOf('--actor');
      expect(at).toBeGreaterThanOrEqual(0);
      expect(call.args[at + 1]).toBe(ACTOR);
    }
    const comment = calls.find((c) => commandOf(c) === 'comments add')!;
    expect(comment.args).toContain(`--author=${ACTOR}`);
    expect(writes()).toHaveLength(4);
  });

  it('updates the changed fields in one call, user text as --flag=value, id after --', async () => {
    beadA().design = 'old design';
    const result = await provider().update('a', T0, { title: '--force', priority: 0, assignee: null, description: 'line one\nline two', design: '', acceptance: 'ok', notes: '-f', labels: ['y', 'z'] }, ACTOR);
    const update = calls.find((c) => commandOf(c) === 'update')!;
    expect(update.args).toEqual([
      '--actor', ACTOR, 'update', '--json',
      '--title=--force', '--priority=0', '--assignee=', '--description=line one\nline two', '--design=', '--acceptance=ok', '--notes=-f',
      '--add-label=z', '--remove-label=x',
      '--', 'a',
    ]);
    expect(result).toMatchObject({ ok: true, bead: { id: 'a', title: '--force', priority: 0, assignee: null, labels: ['y', 'z'] } });
    expect(ran().filter((c) => c === 'update')).toHaveLength(1);
  });

  it('leaves out fields that already have the value, and does nothing when nothing differs', async () => {
    const result = await provider().update('a', T0, { title: 'Title a', priority: 2, labels: ['y', 'x'], assignee: 'Bob' }, ACTOR);
    expect(result).toMatchObject({ ok: true, bead: { id: 'a' } });
    expect(writes()).toEqual([]);
    expect(recordPanelWrite).not.toHaveBeenCalled();
  });

  it('re-reads with --readonly list --all --id, never show', async () => {
    await provider().update('a', T0, { title: 'Mine' }, ACTOR);
    const reads = calls.filter((c) => commandOf(c) === 'list');
    expect(reads).toHaveLength(2);
    for (const read of reads) expect(read.args).toEqual(['--readonly', 'list', '--all', '--id', 'a', '--json']);
    expect(ran()).not.toContain('show');
  });

  it('closes with the reason when the status moves into a done category', async () => {
    const result = await provider().update('a', T0, { status: 'closed', closeReason: 'All done', title: 'Final' }, ACTOR);
    const sequence = writes().map((c) => [commandOf(c), ...c.args.filter((a) => a.startsWith('--reason') || a.startsWith('--title'))]);
    expect(sequence).toEqual([['close', '--reason=All done'], ['update', '--title=Final']]);
    expect(writes()[0]!.args.slice(-2)).toEqual(['--', 'a']);
    expect(result).toMatchObject({ ok: true, bead: { status: 'closed', title: 'Final' } });
  });

  it('closes without a reason flag when none is given, and never passes --force', async () => {
    await provider().update('a', T0, { status: 'closed' }, ACTOR);
    const close = calls.find((c) => commandOf(c) === 'close')!;
    expect(close.args.some((a) => a.startsWith('--reason'))).toBe(false);
    expect(calls.every((c) => !c.args.some((a) => a === '--force' || a === '-f'))).toBe(true);
  });

  it('reopens when the status leaves a done category, then sets any other status', async () => {
    issues.get('done')!.updated_at = T0;
    await provider().update('done', T0, { status: 'open' }, ACTOR);
    expect(writes().map(commandOf)).toEqual(['reopen']);
    calls = [];
    issues.set('done', issue('done', { status: 'closed', closed_at: T0 }));
    await provider().update('done', T0, { status: 'in_progress' }, ACTOR);
    expect(writes().map(commandOf)).toEqual(['reopen', 'update']);
    expect(writes()[1]!.args).toContain('--status=in_progress');
  });

  it('closes into a custom done status with a second step, so the close guard and reason apply', async () => {
    await provider().update('a', T0, { status: 'shipped', closeReason: 'Out the door' }, ACTOR);
    expect(writes().map(commandOf)).toEqual(['close', 'update']);
    expect(writes()[0]!.args).toContain('--reason=Out the door');
    expect(writes()[1]!.args).toContain('--status=shipped');
  });

  it('moves from the built-in closed to a custom done status with one plain update', async () => {
    await provider().update('done', T0, { status: 'shipped' }, ACTOR);
    expect(writes().map(commandOf)).toEqual(['update']);
    expect(writes()[0]!.args).toContain('--status=shipped');
  });

  it('a close refused for a custom done status stops there: no status update, no panel mark', async () => {
    overrides.close = () => {
      throw new Error('cannot close a: blocked by open issues [b] (use --force to override)');
    };
    const error = await provider().update('a', T0, { status: 'shipped', title: 'Never applied' }, ACTOR).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'WriteError', code: 'blocked' });
    expect(writes().map(commandOf)).toEqual(['close']);
    expect(recordPanelWrite).not.toHaveBeenCalled();
  });

  it('moves between two non-done statuses with a plain update', async () => {
    await provider().update('a', T0, { status: 'in_progress' }, ACTOR);
    expect(writes().map(commandOf)).toEqual(['update']);
    expect(writes()[0]!.args).toContain('--status=in_progress');
  });

  it('turns a refused close into a plain error that names the blockers, without retrying or forcing', async () => {
    overrides.close = () => {
      throw new Error('cannot close a: blocked by open issues [b, c.1] (use --force to override)');
    };
    const error = await provider().update('a', T0, { status: 'closed', title: 'Never applied' }, ACTOR).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WriteError);
    expect(error).toMatchObject({ code: 'blocked' });
    const message = (error as WriteError).message;
    expect(message).toContain('blocked by b, c.1');
    expect(message).not.toMatch(/--force|exit|stderr/i);
    expect(writes().map(commandOf)).toEqual(['close']);
  });

  it('says plainly that the bead is gone', async () => {
    await expect(provider().update('nope', T0, { title: 'x' }, ACTOR)).rejects.toMatchObject({ name: 'WriteError', code: 'not-found' });
    expect(writes()).toEqual([]);
  });

  it('rejects an unknown status, a bad priority, an empty title and a label with a comma before writing anything', async () => {
    const attempts: Array<[Parameters<BdProvider['update']>[2], string]> = [
      [{ labels: ['say "hi"'] }, 'invalid'],
      [{ labels: ['two\nlines'] }, 'invalid'],
      [{ labels: ['carriage\rreturn'] }, 'invalid'],
      [{ status: 'banana' }, 'invalid'],
      [{ priority: 9 }, 'invalid'],
      [{ priority: 1.5 }, 'invalid'],
      [{ title: '   ' }, 'invalid'],
      [{ labels: ['a,b'] }, 'invalid'],
      [{ labels: [''] }, 'invalid'],
    ];
    for (const [patch, code] of attempts) {
      await expect(provider().update('a', T0, patch, ACTOR)).rejects.toMatchObject({ code });
    }
    expect(writes()).toEqual([]);
  });

  it('maps a merge in progress to a plain error', async () => {
    overrides.update = () => {
      throw new Error('Error updating a: dolt commit: Error 1105 (HY000): error: the table(s) issues are in conflict');
    };
    const error = await provider().update('a', T0, { title: 'x' }, ACTOR).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'merge-conflict' });
    expect((error as WriteError).message).not.toContain('1105');
  });

  it('a busy first read is an error, with nothing written', async () => {
    overrides.list = () => {
      throw new BdError('timeout', 'slow');
    };
    await expect(provider().update('a', T0, { title: 'x' }, ACTOR)).rejects.toMatchObject({ code: 'busy' });
    expect(writes()).toEqual([]);
  });

  it('shares one deadline across the re-read, the writes and the re-read, inside 18 s', async () => {
    await provider().update('a', T0, { status: 'closed', title: 'Both' }, ACTOR);
    const deadlines = new Set(calls.map((c) => c.opts.deadlineAt));
    expect(deadlines.size).toBeLessThanOrEqual(2);
    const overall = Math.max(...calls.map((c) => c.opts.deadlineAt ?? NaN));
    expect(overall).toBe(Date.parse(T0) + 18_000);
    // Writes stop a little earlier so a timed-out write still leaves time for the re-read.
    for (const w of writes()) expect(w.opts.deadlineAt!).toBeLessThan(overall);
    for (const c of calls) expect(c.opts.deadlineMs).toBeUndefined();
  });

  it('does not retry write commands on a lock error', async () => {
    await provider().update('a', T0, { title: 'x' }, ACTOR);
    for (const w of writes()) expect(w.opts.retries ?? 0).toBe(0);
  });

  it('tells the store about the bead after a successful write', async () => {
    await provider().update('a', T0, { title: 'x' }, ACTOR);
    expect(recordPanelWrite).toHaveBeenCalledTimes(1);
    expect(recordPanelWrite).toHaveBeenCalledWith(ROOT, 'a');
  });

  it('still succeeds when the listener fails, and says so in the result detail', async () => {
    recordPanelWrite.mockRejectedValue(new Error('unreadable state file'));
    const result = await provider().update('a', T0, { title: 'x' }, ACTOR);
    expect(result).toMatchObject({ ok: true, bead: { title: 'x' } });
    expect((result as { detail?: string }).detail).toContain('unreadable state file');
  });

  it('a listener failure does not lose the uncertain result either', async () => {
    recordPanelWrite.mockRejectedValue(new Error('unreadable state file'));
    overrides.update = () => {
      throw new BdError('timeout', 'slow');
    };
    const result = await provider().update('a', T0, { title: 'x' }, ACTOR);
    expect(result).toMatchObject({ ok: false, uncertain: true });
    expect((result as { detail?: string }).detail).toContain('unreadable state file');
  });

  it('records the write before the next queued call can read', async () => {
    const order: string[] = [];
    recordPanelWrite.mockImplementation(() => {
      order.push('recorded');
    });
    const write = provider().update('a', T0, { title: 'x' }, ACTOR);
    const next = withRootQueue(ROOT, async () => order.push('next call'));
    await Promise.all([write, next]);
    expect(order).toEqual(['recorded', 'next call']);
  });

  it('queues behind other calls for the same root', async () => {
    const { release, blocker } = await holdQueue();
    const pending = provider().update('a', T0, { title: 'x' }, ACTOR);
    await vi.advanceTimersByTimeAsync(10);
    expect(bd).not.toHaveBeenCalled();
    release();
    await blocker;
    expect(await pending).toMatchObject({ ok: true });
  });

  it('returns the comments of the re-read bead, fetched under the same deadline', async () => {
    beadA().comment_count = 2;
    beadA().comments_list = [
      { id: 'c-1', author: 'Bob', text: 'First', created_at: T0 },
      { id: 'c-2', author: 'Ann', text: 'Second', created_at: T0 },
    ];
    const result = await provider().update('a', T0, { title: 'Mine' }, ACTOR);
    expect(result).toMatchObject({ ok: true, bead: { comments: [{ id: 'c-1', text: 'First' }, { id: 'c-2', text: 'Second' }] } });
    const reads = calls.filter((c) => commandOf(c) === 'comments list');
    // Only the final re-read: the first read is not handed back, so it does not fetch them.
    expect(reads.map((c) => c.args)).toEqual([['--readonly', 'comments', 'a', '--json']]);
    for (const read of reads) expect(read.opts.deadlineAt).toBe(Date.parse(T0) + 18_000);
  });

  it('fetches the comments once when the first read is what comes back: nothing to change', async () => {
    beadA().comment_count = 1;
    beadA().comments_list = [{ id: 'c-1', author: 'Bob', text: 'Seen', created_at: T0 }];
    const result = await provider().update('a', T0, { title: beadA().title as string }, ACTOR);
    expect(result).toMatchObject({ ok: true, bead: { comments: [{ text: 'Seen' }] } });
    expect(ran().filter((c) => c === 'comments list')).toHaveLength(1);
    expect(writes()).toHaveLength(0);
  });

  it('does not fetch comments on the first read for a bead that is then written', async () => {
    beadA().comment_count = 1;
    beadA().comments_list = [{ id: 'c-1', author: 'Bob', text: 'Seen', created_at: T0 }];
    await provider().update('a', T0, { title: 'Mine' }, ACTOR);
    const order = ran();
    expect(order.filter((c) => c === 'comments list')).toHaveLength(1);
    expect(order.indexOf('comments list')).toBeGreaterThan(order.indexOf('update'));
  });

  it('moves from a custom done status to closed with close, so the blocker guard and the reason apply', async () => {
    issues.set('ship', issue('ship', { status: 'shipped' }));
    await provider().update('ship', T0, { status: 'closed', closeReason: 'Really done' }, ACTOR);
    expect(writes().map(commandOf)).toEqual(['close']);
    expect(writes()[0]!.args).toContain('--reason=Really done');
  });

  it('a refused close from a custom done status to closed is blocked and writes nothing else', async () => {
    issues.set('ship', issue('ship', { status: 'shipped' }));
    overrides.close = () => {
      throw new Error('cannot close ship: blocked by open issues [b] (use --force to override)');
    };
    const error = await provider().update('ship', T0, { status: 'closed', title: 'Never applied' }, ACTOR).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'WriteError', code: 'blocked' });
    expect(writes().map(commandOf)).toEqual(['close']);
  });

  it('does not ask for comments when the bead has none', async () => {
    await provider().update('a', T0, { title: 'Mine' }, ACTOR);
    expect(ran()).not.toContain('comments list');
  });

  it('a conflict carries the current bead with its comments', async () => {
    beadA().updated_at = '2026-10-14T10:00:30Z';
    beadA().comment_count = 1;
    beadA().comments_list = [{ id: 'c-1', author: 'Bob', text: 'Seen', created_at: T0 }];
    const result = await provider().update('a', T0, { title: 'Mine' }, ACTOR);
    expect(result).toMatchObject({ ok: false, conflict: true, current: { comments: [{ text: 'Seen' }] } });
  });

  it('waiting in the queue counts against the 18 s: past it, nothing is sent and the answer is busy', async () => {
    const { release, blocker } = await holdQueue();
    const pending = provider().update('a', T0, { title: 'x' }, ACTOR).catch((e: unknown) => e);
    vi.setSystemTime(Date.parse(T0) + 17_500);
    release();
    await blocker;
    const error = await pending;
    expect(error).toMatchObject({ name: 'WriteError', code: 'busy', saved: false });
    expect((error as WriteError).message).toBe('Beads is busy. Nothing was saved. Try again in a moment.');
    expect(bd).not.toHaveBeenCalled();
    expect(recordPanelWrite).not.toHaveBeenCalled();
  });

  it('a short queue wait still leaves the call its own deadline from when it was made', async () => {
    const { release, blocker } = await holdQueue();
    const pending = provider().update('a', T0, { title: 'x' }, ACTOR);
    vi.setSystemTime(Date.parse(T0) + 5_000);
    release();
    await blocker;
    expect(await pending).toMatchObject({ ok: true });
    expect(Math.max(...calls.map((c) => c.opts.deadlineAt ?? NaN))).toBe(Date.parse(T0) + 18_000);
  });

  it('runs out of time between two steps: busy, and says part was saved', async () => {
    overrides.close = (args) => {
      const row = issues.get('a')!;
      row.status = 'closed';
      row.updated_at = '2026-10-14T10:00:20Z';
      vi.setSystemTime(Date.parse(T0) + 16_000);
      return [row];
    };
    const error = await provider().update('a', T0, { status: 'closed', title: 'Both' }, ACTOR).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'WriteError', code: 'busy', saved: true });
    expect((error as WriteError).message).toContain('Part of your change was saved.');
    expect(writes().map(commandOf)).toEqual(['close']);
    expect(recordPanelWrite).toHaveBeenCalledWith(ROOT, 'a');
  });

  it('a later step failing says part was saved and still marks the bead', async () => {
    overrides.update = () => {
      throw new Error('boom: something unexpected');
    };
    const error = await provider().update('a', T0, { status: 'closed', title: 'Both' }, ACTOR).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'WriteError', code: 'failed', saved: true });
    expect((error as WriteError).message).toContain('Part of your change was saved.');
    expect((error as WriteError).detail).toContain('boom');
    expect(writes().map(commandOf)).toEqual(['close', 'update']);
    expect(recordPanelWrite).toHaveBeenCalledWith(ROOT, 'a');
  });

  it('saved but not readable afterwards: uncertain, flagged as saved, current null', async () => {
    let lists = 0;
    overrides.list = () => {
      lists += 1;
      if (lists === 2) throw new BdError('timeout', 'slow');
      return [beadA()];
    };
    expect(await provider().update('a', T0, { title: 'Mine' }, ACTOR)).toEqual({ ok: false, uncertain: true, current: null, saved: true });
    expect(recordPanelWrite).toHaveBeenCalledWith(ROOT, 'a');
    expect(beadA().title).toBe('Mine');
  });

  it('a timed-out write is uncertain but not flagged as saved', async () => {
    overrides.update = () => {
      throw new BdError('timeout', 'slow');
    };
    expect(await provider().update('a', T0, { title: 'Mine' }, ACTOR)).not.toHaveProperty('saved');
  });
});

describe('BdProvider.create', () => {
  it('creates with a parent, the title as a flag (bd refuses a leading "-" in a positional one), and returns the bead read back', async () => {
    issues.set('p', issue('p'));
    const bead = await provider().create({ title: '--odd title', type: 'bug', priority: 1, parentId: 'p', description: 'About it' }, ACTOR);
    const create = calls.find((c) => commandOf(c) === 'create')!;
    expect(create.args).toEqual(['--actor', ACTOR, 'create', '--json', '--title=--odd title', '--type=bug', '--priority=1', '--parent=p', '--description=About it']);
    expect(bead).toMatchObject({ id: 'n-1', title: '--odd title', type: 'bug', priority: 1, parentId: 'p' });
    expect(calls.at(-1)!.args).toEqual(['--readonly', 'list', '--all', '--id', 'n-1', '--json']);
    expect(recordPanelWrite).toHaveBeenCalledWith(ROOT, 'n-1');
  });

  it('leaves out --parent and an empty description for a top-level bead', async () => {
    await provider().create({ title: 'Top', type: 'task', priority: 2, parentId: null, description: '' }, ACTOR);
    const create = calls.find((c) => commandOf(c) === 'create')!;
    expect(create.args.some((a) => a.startsWith('--parent') || a.startsWith('--description'))).toBe(false);
  });

  it('refuses an empty title and a bad priority', async () => {
    await expect(provider().create({ title: ' ', type: 'task', priority: 2, parentId: null, description: '' }, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    await expect(provider().create({ title: 'x', type: 'task', priority: 7, parentId: null, description: '' }, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    expect(writes()).toEqual([]);
  });

  it('reports a timeout as "may have saved", not as a failure to retry', async () => {
    overrides.create = () => {
      throw new BdError('timeout', 'slow');
    };
    const error = await provider().create({ title: 'x', type: 'task', priority: 2, parentId: null, description: '' }, ACTOR).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'WriteError', code: 'uncertain' });
    expect(ran().filter((c) => c === 'create')).toHaveLength(1);
  });
});

describe('BdProvider write extras', () => {
  const NEW = { title: 'x', type: 'task', priority: 2, parentId: null, description: '' };

  it('create: queue wait past the budget is busy with nothing sent', async () => {
    const { release, blocker } = await holdQueue();
    const pending = provider().create(NEW, ACTOR).catch((e: unknown) => e);
    vi.setSystemTime(Date.parse(T0) + 19_000);
    release();
    await blocker;
    expect(await pending).toMatchObject({ code: 'busy', saved: false });
    expect(bd).not.toHaveBeenCalled();
  });

  it('comment: queue wait past the budget is busy with nothing sent', async () => {
    const { release, blocker } = await holdQueue();
    const pending = provider().comment('a', 'hi', ACTOR).catch((e: unknown) => e);
    vi.setSystemTime(Date.parse(T0) + 19_000);
    release();
    await blocker;
    expect(await pending).toMatchObject({ code: 'busy' });
    expect(bd).not.toHaveBeenCalled();
    expect(recordPanelWrite).not.toHaveBeenCalled();
  });

  it('dependency: queue wait past the budget is busy with nothing sent', async () => {
    const { release, blocker } = await holdQueue();
    const pending = provider().dependency('add', 'a', 'done', 'blocks', ACTOR).catch((e: unknown) => e);
    vi.setSystemTime(Date.parse(T0) + 19_000);
    release();
    await blocker;
    expect(await pending).toMatchObject({ code: 'busy' });
    expect(bd).not.toHaveBeenCalled();
  });

  it('create: made but not readable afterwards is "saved, refreshing", never "failed"', async () => {
    overrides.list = () => {
      throw new BdError('timeout', 'slow');
    };
    const error = await provider().create(NEW, ACTOR).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'WriteError', code: 'uncertain', saved: true, message: "Saved, but couldn't load the result. Refreshing." });
    expect(recordPanelWrite).toHaveBeenCalledWith(ROOT, 'n-1');
  });

  it('create: an answer with no id is the same "saved, refreshing"', async () => {
    overrides.create = () => ({ schema_version: 1 });
    await expect(provider().create(NEW, ACTOR)).rejects.toMatchObject({ code: 'uncertain', saved: true });
  });

  it('comment: added but the answer cannot be read is "saved, refreshing"', async () => {
    overrides['comments add'] = () => ({ schema_version: 1 });
    const error = await provider().comment('a', 'hi', ACTOR).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'uncertain', saved: true, message: "Saved, but couldn't load the result. Refreshing." });
    expect(recordPanelWrite).toHaveBeenCalledWith(ROOT, 'a');
  });

  it('a timed-out create, comment or link is uncertain and not flagged as saved', async () => {
    overrides.create = overrides['comments add'] = overrides['dep add'] = () => {
      throw new BdError('timeout', 'slow');
    };
    for (const attempt of [provider().create(NEW, ACTOR), provider().comment('a', 'hi', ACTOR), provider().dependency('add', 'a', 'done', 'blocks', ACTOR)]) {
      await expect(attempt).rejects.toMatchObject({ code: 'uncertain', saved: false });
    }
  });

  it('never says "bd" in a message for the user; the raw text stays in detail', async () => {
    const messages: string[] = [];
    const collect = async (attempt: Promise<unknown>) => {
      const error = await attempt.catch((e: unknown) => e);
      if (error instanceof WriteError) messages.push(error.message);
      return error;
    };
    overrides.update = () => {
      throw new Error('bd: weird failure');
    };
    const weird = await collect(provider().update('a', T0, { title: 'x' }, ACTOR));
    expect((weird as WriteError).detail).toContain('bd: weird failure');
    overrides.update = () => {
      throw new BdError('timeout', 'bd timed out after 15000 ms');
    };
    overrides.create = overrides['comments add'] = overrides['dep add'] = () => {
      throw new BdError('timeout', 'bd timed out after 15000 ms');
    };
    await collect(provider().create(NEW, ACTOR));
    await collect(provider().comment('a', 'hi', ACTOR));
    await collect(provider().dependency('add', 'a', 'done', 'blocks', ACTOR));
    overrides.list = () => {
      throw new BdError('lock', 'bd is busy');
    };
    await collect(provider().update('a', T0, { title: 'x' }, ACTOR));
    overrides.list = () => {
      throw new BdError('not-found', 'bd was not found');
    };
    await collect(provider().update('a', T0, { title: 'x' }, ACTOR));
    overrides.list = () => [beadA()];
    overrides.update = () => {
      throw new BdError('lock', 'bd is locked');
    };
    await collect(provider().update('a', T0, { title: 'x' }, ACTOR));
    expect(messages.length).toBeGreaterThanOrEqual(7);
    for (const message of messages) expect(message).not.toMatch(/\bbd\b/i);
  });
});

describe('BdProvider.comment', () => {
  it('adds the comment with the panel as author, text after --', async () => {
    const comment = await provider().comment('a', '-f looks fine', ACTOR);
    const call = calls.find((c) => commandOf(c) === 'comments add')!;
    expect(call.args).toEqual(['--actor', ACTOR, 'comments', 'add', '--json', `--author=${ACTOR}`, '--', 'a', '-f looks fine']);
    expect(comment).toEqual({ id: 'c-1', author: ACTOR, text: '-f looks fine', createdAt: expect.any(String) });
    expect(recordPanelWrite).toHaveBeenCalledWith(ROOT, 'a');
  });

  it('says plainly when the bead is gone', async () => {
    overrides['comments add'] = () => {
      throw new Error('Error resolving nope: no issue found matching "nope"');
    };
    await expect(provider().comment('nope', 'hi', ACTOR)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('refuses an empty comment', async () => {
    await expect(provider().comment('a', '  ', ACTOR)).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('BdProvider.dependency', () => {
  it('adds with the kind, ids after --', async () => {
    await provider().dependency('add', 'a', 'done', 'discovered-from', ACTOR);
    const call = writes()[0]!;
    expect(call.args).toEqual(['--actor', ACTOR, 'dep', 'add', '--json', '--type=discovered-from', '--', 'a', 'done']);
    expect(recordPanelWrite).toHaveBeenCalledWith(ROOT, 'a');
  });

  it('removes by pair; bd keeps one dependency per ordered pair, so there is no kind to pick', async () => {
    await provider().dependency('remove', 'a', 'done', 'blocks', ACTOR);
    expect(writes()[0]!.args).toEqual(['--actor', ACTOR, 'dep', 'remove', '--json', '--', 'a', 'done']);
    expect(recordPanelWrite).toHaveBeenCalledWith(ROOT, 'a');
  });

  it('explains a pair that already has another kind', async () => {
    overrides['dep add'] = () => {
      throw new Error('dependency a -> done already exists with type "blocks" (requested "related"); remove it first with \'bd dep remove\' then re-add');
    };
    const error = await provider().dependency('add', 'a', 'done', 'related', ACTOR).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'WriteError', code: 'dep-exists' });
    expect((error as WriteError).message).toContain('blocks');
    expect((error as WriteError).message).not.toContain("bd dep");
  });

  it('refuses a kind that is not a plain word', async () => {
    await expect(provider().dependency('add', 'a', 'done', '--force', ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    await expect(provider().dependency('add', 'a', 'done', '', ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    expect(writes()).toEqual([]);
  });

  it('reports a timeout as uncertain', async () => {
    overrides['dep add'] = () => {
      throw new BdError('timeout', 'slow');
    };
    await expect(provider().dependency('add', 'a', 'done', 'blocks', ACTOR)).rejects.toMatchObject({ code: 'uncertain' });
    expect(recordPanelWrite).toHaveBeenCalledWith(ROOT, 'a');
  });
});
