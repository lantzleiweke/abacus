import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../../../src/service/bd/exec', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/service/bd/exec')>()),
  runBd: vi.fn(),
  runBdJson: vi.fn(),
  runDolt: vi.fn(),
  runGit: vi.fn(),
}));

vi.mock('../../../src/service/bd/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/service/bd/audit')>()),
  readAuditEvents: vi.fn(),
}));

import { BdProvider, WriteError, onPanelWrite, withRootQueue, writeFailure } from '../../../src/service/bd/adapter';
import { readAuditEvents } from '../../../src/service/bd/audit';
import { BdError, runBd, runBdJson, type RunOptions } from '../../../src/service/bd/exec';
import { PLAN_APPROVAL_REASON } from '../../../src/shared/gates';

const bd = vi.mocked(runBd);
const audit = vi.mocked(readAuditEvents);
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
  if (words[0] === 'gate') return `gate ${words[1]}`;
  if (words[0] === 'human') return `human ${words[1]}`;
  return words[0]!;
}

function fakeBd(args: string[]): unknown {
  const { actor, words, flags, positionals } = parse(args);
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
      const map: Record<string, string> = { '--title': 'title', '--description': 'description', '--design': 'design', '--acceptance': 'acceptance_criteria', '--notes': 'notes', '--assignee': 'assignee', '--status': 'status', '--type': 'issue_type' };
      for (const [flag, key] of Object.entries(map)) if (flags.has(flag)) row[key] = flags.get(flag)![0];
      if (flags.has('--priority')) row.priority = Number(flags.get('--priority')![0]);
      // `--parent=` takes the bead out of its epic, `--due=` clears the date, `--defer=` clears the snooze date and leaves the status.
      if (flags.has('--parent')) row.parent = flags.get('--parent')![0] || undefined;
      if (flags.has('--due')) row.due_at = flags.get('--due')![0] ? `due:${flags.get('--due')![0]}` : undefined;
      if (flags.has('--defer')) {
        row.defer_until = flags.get('--defer')![0] ? `snooze:${flags.get('--defer')![0]}` : undefined;
        if (flags.get('--defer')![0]) row.status = 'deferred';
      }
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
    case 'defer': {
      const row = issues.get(positionals[0]!)!;
      row.status = 'deferred';
      if (flags.has('--until')) row.defer_until = `snooze:${flags.get('--until')![0]}`;
      row.updated_at = tick();
      return [row];
    }
    case 'undefer': {
      const row = issues.get(positionals[0]!)!;
      row.status = 'open';
      delete row.defer_until;
      row.updated_at = tick();
      return [row];
    }
    case 'supersede':
    case 'duplicate': {
      const row = issues.get(positionals[0]!)!;
      const other = flags.get(cmd === 'supersede' ? '--with' : '--of')![0]!;
      row.status = 'closed';
      row.dependencies = [...((row.dependencies as unknown[] | undefined) ?? []), { issue_id: positionals[0], depends_on_id: other, type: cmd === 'supersede' ? 'supersedes' : 'duplicates', created_by: actor }];
      row.updated_at = tick();
      return cmd === 'supersede' ? { replacement: other, superseded: positionals[0], status: 'closed', schema_version: 1 } : { canonical: other, duplicate: positionals[0], status: 'closed', schema_version: 1 };
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
    case 'export':
      return [...issues.values()].map((row) => JSON.stringify({ _type: 'issue', ...row })).join('\n');
    case 'gate create': {
      nextId += 1;
      const id = `g-${nextId}`;
      const blocked = flags.get('--blocks')![0]!;
      const reason = flags.get('--reason')![0]!;
      issues.set(id, issue(id, { title: 'Gate: human', issue_type: 'gate', await_type: 'human', description: `Ad-hoc gate blocking ${blocked}\n\nReason: ${reason}`, created_by: actor, created_at: tick() }));
      const owner = issues.get(blocked)!;
      owner.dependencies = [...((owner.dependencies as unknown[] | undefined) ?? []), { issue_id: blocked, depends_on_id: id, type: 'blocks', created_by: actor }];
      return { id, issue_type: 'gate', await_type: 'human', created_by: actor, schema_version: 1 };
    }
    case 'gate resolve': {
      const row = issues.get(positionals[0]!)!;
      row.status = 'closed';
      row.closed_at = tick();
      return `✓ Gate resolved: ${positionals[0]}\n`;
    }
    case 'human respond':
    case 'human dismiss': {
      // Prints text, never JSON. Like bd 1.3.1 it closes whatever it is given (labelled or not, gated or not).
      const row = issues.get(positionals[0]!)!;
      if (row.status === 'closed') throw new Error(`Error: issue ${positionals[0]} is already closed`);
      row.status = 'closed';
      row.closed_at = tick();
      row.updated_at = row.closed_at;
      if (cmd === 'human respond') {
        row.close_reason = 'Responded';
        row.comments_list = [...((row.comments_list as unknown[] | undefined) ?? []), { id: 'c-r', issue_id: positionals[0], author: actor, text: `Response: ${flags.get('--response')![0]}`, created_at: tick() }];
        row.comment_count = (row.comments_list as unknown[]).length;
        return `✔ Bead ${positionals[0]} closed with response.\n`;
      }
      const why = flags.get('--reason')?.[0];
      row.close_reason = why ? `Dismissed: ${why}` : 'Dismissed';
      return `✔ Bead ${positionals[0]} dismissed.\n`;
    }
    default:
      throw new Error(`unexpected bd call: ${args.join(' ')}`);
  }
}

/** The command words of a call, for asserting what ran. */
const commandOf = (c: Call): string => commandName(parse(c.args).words);
const ran = (): string[] => calls.map(commandOf);
const writes = (): Call[] => calls.filter((c) => !['list', 'statuses', 'comments list', 'export'].includes(commandOf(c)));

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
  audit.mockReset();
  audit.mockResolvedValue(null);
  bd.mockReset();
  bdJson.mockReset();
  bd.mockImplementation(async (_dir, args, opts) => {
    calls.push({ args, opts: opts ?? {} });
    try {
      const out = fakeBd(args);
      // Some commands print text (`export` lines, `gate resolve`), not one JSON document.
      return { stdout: typeof out === 'string' ? out : JSON.stringify(out), stderr: '', code: 0 };
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

  it('reads bd 1.3.1\'s refusal text too: "cannot close blocked issue: a is blocked by [b, c.1]"', async () => {
    overrides.close = () => {
      throw new Error('cannot close blocked issue: a is blocked by [b, c.1] (use --force to override)');
    };
    const error = await provider().update('a', T0, { status: 'closed', title: 'Never applied' }, ACTOR).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'WriteError', code: 'blocked' });
    expect((error as WriteError).message).toContain('blocked by b, c.1');
    expect((error as WriteError).message).not.toMatch(/--force/);
    expect(writes().map(commandOf)).toEqual(['close']);
  });

  it('bd 1.3.1: a close refused for open children is blocked and names the children that are not closed', async () => {
    issues.set('kid', issue('kid', { status: 'in_progress', dependencies: [{ issue_id: 'kid', depends_on_id: 'a', type: 'parent-child' }] }));
    issues.set('kid-ship', issue('kid-ship', { status: 'shipped', dependencies: [{ issue_id: 'kid-ship', depends_on_id: 'a', type: 'parent-child' }] }));
    issues.set('kid-done', issue('kid-done', { status: 'closed', closed_at: T0, dependencies: [{ issue_id: 'kid-done', depends_on_id: 'a', type: 'parent-child' }] }));
    overrides.close = () => {
      throw new Error('cannot close a: 2 open child issue(s); close children first or use --force to override');
    };
    const error = await provider().update('a', T0, { status: 'closed' }, ACTOR).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WriteError);
    expect(error).toMatchObject({ code: 'blocked' });
    const message = (error as WriteError).message;
    expect(message).toBe("This bead can't be closed yet. It has sub-tasks that are not closed yet: kid, kid-ship. Close those first.");
    expect(message).not.toMatch(/--force|—/);
    expect(writes().map(commandOf)).toEqual(['close']);
  });

  it('bd 1.3.1: an open-children refusal is still blocked when the children cannot be read', async () => {
    overrides.close = () => {
      throw new Error('cannot close a: 1 open child issue(s); close children first or use --force to override');
    };
    overrides.export = () => {
      throw new BdError('timeout', 'slow');
    };
    const error = await provider().update('a', T0, { status: 'closed' }, ACTOR).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'blocked', message: "This bead can't be closed yet. It has sub-tasks that are not closed yet. Close those first." });
  });

  it('bd 1.3.1: a blocker bd prints with its link kind is named by id alone', async () => {
    overrides.close = () => {
      throw new Error('cannot close blocked issue: a is blocked by [b (conditional-blocks), c (waits-for), d] (use --force to override)');
    };
    const error = await provider().update('a', T0, { status: 'closed' }, ACTOR).catch((e: unknown) => e);
    expect((error as WriteError).message).toContain('blocked by b, c, d.');
  });

  it('bd 1.3.1: a custom done status on a blocked bead is blocked, whichever command bd refuses it with', async () => {
    overrides.close = () => {
      throw new Error('cannot close blocked issue: a is blocked by [b] (use --force to override)');
    };
    await expect(provider().update('a', T0, { status: 'shipped' }, ACTOR)).rejects.toMatchObject({ code: 'blocked' });
    delete overrides.close;
    issues.set('ship', issue('ship', { status: 'shipped' }));
    overrides.update = () => {
      throw new Error('cannot close blocked issue: ship is blocked by [b] (use --force to override)');
    };
    await expect(provider().update('ship', T0, { status: 'shipped', title: 'T' }, ACTOR)).rejects.toMatchObject({ code: 'blocked' });
  });

  it('bd 1.3.1: a refused reassign of a held bead is "claimed", in plain words, with the holder named and no --force', async () => {
    issues.set('held', issue('held', { status: 'in_progress', assignee: 'Dana' }));
    overrides.update = () => {
      throw new Error('cannot reassign held: held by "Dana" (in_progress); coordinate with the holder (bd mail Dana) — pass --force only if their claim is abandoned (crashed agent, expired lease), or use bd reclaim');
    };
    const error = await provider().update('held', T0, { assignee: 'Ann' }, ACTOR).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'WriteError', code: 'claimed' });
    const message = (error as WriteError).message;
    expect(message).toBe('Dana is working on this bead. Move it out of In progress first, or ask them.');
    expect(message).not.toMatch(/--force|reclaim|lease|bd /i);
    expect((error as WriteError).detail).toContain('cannot reassign');
    expect(writes().every((c) => !c.args.includes('--force'))).toBe(true);
  });

  it('bd 1.3.1: moving a held bead out of In progress and clearing its assignee is two updates, the status first', async () => {
    issues.set('held', issue('held', { status: 'in_progress', assignee: 'Dana' }));
    const result = await provider().update('held', T0, { status: 'open', assignee: null, title: 'Renamed' }, ACTOR);
    expect(writes().map(commandOf)).toEqual(['update', 'update']);
    expect(writes()[0]!.args).toEqual(['--actor', ACTOR, 'update', '--json', '--status=open', '--', 'held']);
    expect(writes()[1]!.args).toEqual(['--actor', ACTOR, 'update', '--json', '--title=Renamed', '--assignee=', '--', 'held']);
    expect(result).toMatchObject({ ok: true, bead: { id: 'held', status: 'open', assignee: null, title: 'Renamed' } });
  });

  it('bd 1.3.1: an assignee change that does not move the bead out of In progress stays one update', async () => {
    issues.set('held', issue('held', { status: 'in_progress', assignee: 'Dana' }));
    await provider().update('held', T0, { assignee: 'Ann', title: 'Renamed' }, ACTOR);
    expect(writes().map(commandOf)).toEqual(['update']);
  });

  it('bd 1.3.1: if the second step is refused, the status move is reported as saved', async () => {
    issues.set('held', issue('held', { status: 'in_progress', assignee: 'Dana' }));
    let n = 0;
    const refuseSecond = (args: string[]): unknown => {
      n += 1;
      if (n === 2) throw new Error('cannot reassign held: held by "Dana" (in_progress)');
      delete overrides.update;
      try {
        return fakeBd(args);
      } finally {
        overrides.update = refuseSecond;
      }
    };
    overrides.update = refuseSecond;
    const error = await provider().update('held', T0, { status: 'open', assignee: null }, ACTOR).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'claimed', saved: true });
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

describe('BdProvider.gateCreate', () => {
  const gates = () => [...issues.values()].filter((row) => row.issue_type === 'gate');

  it('opens a human gate on the bead: the actor goes in, the reason is one argument', async () => {
    const reason = 'Does this -x "quote" $(rm -rf) ; look right?';
    const result = await provider().gateCreate('a', `  ${reason}  `, ACTOR);
    const call = calls.find((c) => commandOf(c) === 'gate create')!;
    expect(call.args).toEqual(['--actor', ACTOR, 'gate', 'create', '--type=human', '--blocks=a', `--reason=${reason}`, '--json']);
    expect(result).toMatchObject({ ok: true, gate: { kind: 'human', reason, blocks: ['a'], createdBy: ACTOR, planApproval: false } });
    expect(panelWrote).toEqual([{ deps: [['a', (result as { gate: { id: string } }).gate.id]] }]);
    expect(recordPanelWrite).toHaveBeenCalledWith(ROOT, 'a');
  });

  it('refuses a closed bead and a bead that is not there, without writing', async () => {
    await expect(provider().gateCreate('done', 'Check it', ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    await expect(provider().gateCreate('nope', 'Check it', ACTOR)).rejects.toMatchObject({ code: 'not-found' });
    expect(writes()).toEqual([]);
    // Never `show`: the bead comes from the export.
    expect(ran()).not.toContain('show');
  });

  it('refuses a reason that is empty, too long or has a line break', async () => {
    for (const reason of ['  ', 'x'.repeat(501), 'one\ntwo']) {
      await expect(provider().gateCreate('a', reason, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    }
    expect(calls).toEqual([]);
  });

  it('answers already-open with the existing gate instead of making a second one', async () => {
    const first = await provider().gateCreate('a', 'Check it', ACTOR);
    const again = await provider().gateCreate('a', 'Check it again', ACTOR);
    expect(again).toMatchObject({ ok: false, code: 'already-open', gate: { id: (first as { gate: { id: string } }).gate.id } });
    expect(gates()).toHaveLength(1);
    expect(calls.filter((c) => commandOf(c) === 'gate create')).toHaveLength(1);
  });

  it('a plan approval and a plain review are different kinds, so one does not hide the other', async () => {
    await provider().gateCreate('a', 'Check it', ACTOR);
    const plan = await provider().gateCreate('a', `${PLAN_APPROVAL_REASON} for the rollout`, ACTOR);
    expect(plan).toMatchObject({ ok: true, gate: { planApproval: true } });
    expect(gates()).toHaveLength(2);
  });

  it('a resolved gate no longer counts as open', async () => {
    const first = (await provider().gateCreate('a', 'Check it', ACTOR)) as { gate: { id: string } };
    await provider().gateResolve(first.gate.id, undefined, ACTOR);
    expect(await provider().gateCreate('a', 'Check it', ACTOR)).toMatchObject({ ok: true });
  });

  it('a timeout is uncertain and is never retried', async () => {
    overrides['gate create'] = () => {
      throw new BdError('timeout', 'slow');
    };
    await expect(provider().gateCreate('a', 'Check it', ACTOR)).rejects.toMatchObject({ code: 'uncertain' });
    expect(calls.filter((c) => commandOf(c) === 'gate create')).toHaveLength(1);
  });

  it('maps an old bd that does not know the command to unsupported', async () => {
    overrides['gate create'] = () => {
      throw new Error('Error: unknown command "gate" for "bd"');
    };
    const error = await provider().gateCreate('a', 'Check it', ACTOR).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'WriteError', code: 'unsupported', message: 'This version of Beads does not support that.' });
    expect(writeFailure(new BdError('exit', 'x', { code: 1, stderr: 'Error: unknown flag: --blocks' }))).toMatchObject({ code: 'unsupported' });
    expect(writeFailure(new BdError('exit', 'x', { code: 1, stderr: 'Error: unknown shorthand flag: \'z\' in -z' }))).toMatchObject({ code: 'unsupported' });
  });
});

describe('BdProvider.gateResolve', () => {
  async function openGate(kind = 'human'): Promise<string> {
    const result = (await provider().gateCreate('a', 'Check it', ACTOR)) as { gate: { id: string } };
    issues.get(result.gate.id)!.await_type = kind;
    calls = [];
    panelWrote = [];
    recordPanelWrite.mockClear();
    return result.gate.id;
  }

  it('resolves the gate and verifies by reading it again, not by what bd printed', async () => {
    const id = await openGate();
    const result = await provider().gateResolve(id, 'Looks good', ACTOR);
    expect(result).toEqual({ ok: true, gateId: id });
    const call = calls.find((c) => commandOf(c) === 'gate resolve')!;
    expect(call.args).toEqual(['--actor', ACTOR, 'gate', 'resolve', '--reason=Looks good', '--', id]);
    expect(ran()).toEqual(['export', 'gate resolve', 'export']);
    expect(panelWrote).toEqual([{ deps: [['a', id]] }]);
    expect(recordPanelWrite).toHaveBeenCalledWith(ROOT, 'a');
  });

  it('leaves the reason out when there is none', async () => {
    const id = await openGate();
    await provider().gateResolve(id, undefined, ACTOR);
    expect(calls.find((c) => commandOf(c) === 'gate resolve')!.args).toEqual(['--actor', ACTOR, 'gate', 'resolve', '--', id]);
  });

  it('says it failed when bd printed success but the gate is still open', async () => {
    const id = await openGate();
    overrides['gate resolve'] = () => '✓ Gate resolved\n';
    await expect(provider().gateResolve(id, undefined, ACTOR)).rejects.toMatchObject({ code: 'failed' });
  });

  it('an already resolved gate is a conflict that names who resolved it', async () => {
    const id = await openGate();
    await provider().gateResolve(id, undefined, 'Cleo (panel)');
    calls = [];
    audit.mockResolvedValue([{ id: 'e1', beadId: id, type: 'closed', actor: 'Claude Code', oldValue: null, newValue: 'ok', rawCreatedAt: T0 }]);
    const result = await provider().gateResolve(id, undefined, ACTOR);
    expect(result).toEqual({ ok: false, code: 'already-resolved', resolvedBy: 'Claude Code', at: expect.any(String) });
    expect(audit).toHaveBeenCalledWith(ROOT, 'embedded', expect.objectContaining({ beadIds: [id] }));
    expect(writes()).toEqual([]);
  });

  it('an already resolved gate with no audit event has no resolver', async () => {
    const id = await openGate();
    await provider().gateResolve(id, undefined, ACTOR);
    audit.mockResolvedValue(null);
    expect(await provider().gateResolve(id, undefined, ACTOR)).toMatchObject({ ok: false, code: 'already-resolved', resolvedBy: null });
  });

  it('refuses timer and gh gates here, and a bead that is not a gate', async () => {
    for (const kind of ['timer', 'gh:run', 'gh:pr']) {
      const id = await openGate(kind);
      await expect(provider().gateResolve(id, undefined, ACTOR)).rejects.toMatchObject({ code: 'invalid', message: 'Only review gates can be resolved here.' });
      issues.get(id)!.status = 'closed';
    }
    await expect(provider().gateResolve('nope', undefined, ACTOR)).rejects.toMatchObject({ code: 'not-found' });
    expect(writes()).toEqual([]);
  });

  it('a timeout is uncertain and credits the panel, and an old bd maps to unsupported', async () => {
    const id = await openGate();
    overrides['gate resolve'] = () => {
      throw new BdError('timeout', 'slow');
    };
    await expect(provider().gateResolve(id, undefined, ACTOR)).rejects.toMatchObject({ code: 'uncertain' });
    expect(recordPanelWrite).toHaveBeenCalledWith(ROOT, 'a');
    overrides['gate resolve'] = () => {
      throw new Error('Error: unknown command "gate" for "bd"');
    };
    await expect(provider().gateResolve(id, undefined, ACTOR)).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('BdProvider.humanRespond and humanDismiss', () => {
  beforeEach(() => {
    issues.set('h', issue('h', { title: 'Need a decision on cache TTL', labels: ['human'] }));
    issues.set('h2', issue('h2', { title: 'Second help', labels: ['human', 'x'] }));
    issues.set('hdone', issue('hdone', { status: 'closed', closed_at: T0, close_reason: 'Responded', labels: ['human'] }));
  });

  it('respond adds the comment and closes: the text is one argument, the actor goes in, the result is the re-read', async () => {
    const text = '- Use 60s\n--force "quote" $(rm -rf) ;';
    const result = await provider().humanRespond('h', `  ${text}  `, ACTOR);
    expect(result).toMatchObject({ ok: true, bead: { id: 'h', status: 'closed', closeReason: 'Responded', comments: [{ author: ACTOR, text: `Response: ${text}` }] } });
    const call = calls.find((c) => commandOf(c) === 'human respond')!;
    expect(call.args).toEqual(['--actor', ACTOR, 'human', 'respond', `--response=${text}`, '--', 'h']);
    expect(ran()).toEqual(['list', 'statuses', 'export', 'human respond', 'list', 'comments list']);
    // The comment and the status move are the panel's, so the next diff is credited to it.
    expect(panelWrote).toEqual([{ comment: true, fields: ['status'] }]);
    expect(recordPanelWrite).toHaveBeenCalledWith(ROOT, 'h');
  });

  it('dismiss closes with the reason: no comment is made, and a missing reason leaves the flag out', async () => {
    const result = await provider().humanDismiss('h', '  Not needed  ', ACTOR);
    expect(result).toMatchObject({ ok: true, bead: { id: 'h', status: 'closed', closeReason: 'Dismissed: Not needed' } });
    expect(calls.find((c) => commandOf(c) === 'human dismiss')!.args).toEqual(['--actor', ACTOR, 'human', 'dismiss', '--reason=Not needed', '--', 'h']);
    expect(panelWrote).toEqual([{ fields: ['status'] }]);

    const bare = await provider().humanDismiss('h2', undefined, ACTOR);
    expect(bare).toMatchObject({ ok: true, bead: { closeReason: 'Dismissed' } });
    expect(calls.filter((c) => commandOf(c) === 'human dismiss')[1]!.args).toEqual(['--actor', ACTOR, 'human', 'dismiss', '--', 'h2']);
  });

  it('an already closed human bead gives not-open with the current bead and writes nothing', async () => {
    for (const run of [() => provider().humanRespond('hdone', 'Late answer', ACTOR), () => provider().humanDismiss('hdone', 'Late', ACTOR)]) {
      calls = [];
      const result = await run();
      expect(result).toMatchObject({ ok: false, code: 'not-open', current: { id: 'hdone', status: 'closed', closeReason: 'Responded' } });
      expect(writes()).toEqual([]);
    }
    expect(panelWrote).toEqual([]);
    expect(recordPanelWrite).not.toHaveBeenCalled();
  });

  it('a bead that lost its human label meanwhile gives not-open and writes nothing', async () => {
    issues.get('h')!.labels = ['other'];
    expect(await provider().humanRespond('h', 'Too late', ACTOR)).toMatchObject({ ok: false, code: 'not-open', current: { id: 'h', status: 'open', labels: ['other'] } });
    expect(await provider().humanDismiss('a', undefined, ACTOR)).toMatchObject({ ok: false, code: 'not-open', current: { id: 'a' } });
    expect(writes()).toEqual([]);
    expect(panelWrote).toEqual([]);
  });

  it('a human bead in a done status (a custom one too) counts as closed: not-open, nothing written', async () => {
    issues.set('hship', issue('hship', { status: 'shipped', labels: ['human'] }));
    expect(await provider().humanRespond('hship', 'Late', ACTOR)).toMatchObject({ ok: false, code: 'not-open', current: { id: 'hship', status: 'shipped' } });
    expect(await provider().humanDismiss('hship', undefined, ACTOR)).toMatchObject({ ok: false, code: 'not-open', current: { id: 'hship' } });
    expect(writes()).toEqual([]);
    expect(panelWrote).toEqual([]);
  });

  describe('blockers', () => {
    const refusal = async (id: string, run: 'respond' | 'dismiss' = 'respond') => {
      const error = await (run === 'respond' ? provider().humanRespond(id, 'Answer', ACTOR) : provider().humanDismiss(id, 'Nope', ACTOR)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WriteError);
      return error as WriteError;
    };

    it('an open review gate on the request refuses both, names the gate, and writes nothing', async () => {
      const gate = (await provider().gateCreate('h', 'Check it', ACTOR)) as { gate: { id: string } };
      calls = [];
      panelWrote = [];
      recordPanelWrite.mockClear();
      for (const run of ['respond', 'dismiss'] as const) {
        const error = await refusal('h', run);
        expect(error).toMatchObject({ code: 'blocked' });
        expect(error.message).toContain(gate.gate.id);
        expect(error.message).not.toMatch(/—|--force|bd |dolt/i);
      }
      expect(writes()).toEqual([]);
      expect(panelWrote).toEqual([]);
      expect(recordPanelWrite).not.toHaveBeenCalled();
      expect(issues.get('h')!.status).toBe('open');
    });

    it('an open blocks dependency refuses and names every open blocker; closed and other kinds do not', async () => {
      issues.set('h', issue('h', { labels: ['human'], dependencies: [
        { issue_id: 'h', depends_on_id: 'a', type: 'blocks' },
        { issue_id: 'h', depends_on_id: 'h2', type: 'blocks' },
        { issue_id: 'h', depends_on_id: 'done', type: 'blocks' },
        { issue_id: 'h', depends_on_id: 'hdone', type: 'blocks' },
        { issue_id: 'h', depends_on_id: 'h3', type: 'related' },
      ] }));
      issues.set('h3', issue('h3'));
      const error = await refusal('h');
      expect(error).toMatchObject({ code: 'blocked' });
      expect(error.message).toContain('still waiting on a, h2.');
      expect(error.message).not.toContain('done');
      expect(error.message).not.toContain('h3');
      expect(writes()).toEqual([]);
    });

    it('a closed or pinned blocker is not open, and neither is a resolved gate; a custom done status still blocks', async () => {
      issues.set('b-pin', issue('b-pin', { status: 'pinned' }));
      issues.set('h', issue('h', { labels: ['human'], dependencies: [
        { issue_id: 'h', depends_on_id: 'b-pin', type: 'blocks' },
        { issue_id: 'h', depends_on_id: 'done', type: 'blocks' },
        { issue_id: 'h', depends_on_id: 'b-pin', type: 'conditional-blocks' },
      ] }));
      const gate = (await provider().gateCreate('h2', 'Check it', ACTOR)) as { gate: { id: string } };
      await provider().gateResolve(gate.gate.id, undefined, ACTOR);
      expect(await provider().humanRespond('h', 'Answer', ACTOR)).toMatchObject({ ok: true });
      expect(await provider().humanDismiss('h2', undefined, ACTOR)).toMatchObject({ ok: true });

      for (const kind of ['blocks', 'conditional-blocks']) {
        issues.set('b-ship', issue('b-ship', { status: 'shipped' }));
        issues.set(`hk-${kind}`, issue(`hk-${kind}`, { labels: ['human'], dependencies: [{ issue_id: `hk-${kind}`, depends_on_id: 'b-ship', type: kind }] }));
        const error = await refusal(`hk-${kind}`);
        expect(error).toMatchObject({ code: 'blocked' });
        expect(error.message).toContain('still waiting on b-ship.');
      }
    });

    it('waits-for blocks while its target has a child that is not closed or pinned, and not otherwise', async () => {
      const waitsOn = (target: string) => issue('hw', { labels: ['human'], dependencies: [{ issue_id: 'hw', depends_on_id: target, type: 'waits-for' }] });
      const child = (parent: string, status = 'open') => issue(`k-${parent}-${status}`, { status, dependencies: [{ issue_id: `k-${parent}-${status}`, depends_on_id: parent, type: 'parent-child' }] });
      issues.set('hw', waitsOn('a'));
      // No children: nothing to wait for.
      expect(await provider().humanDismiss('hw', undefined, ACTOR)).toMatchObject({ ok: true });

      // An open child (a custom done one too) holds the gate and the target is what is named.
      for (const status of ['open', 'in_progress', 'shipped']) {
        issues.set('hw', waitsOn('a'));
        issues.set(`k-a-${status}`, child('a', status));
        const error = await refusal('hw');
        expect(error).toMatchObject({ code: 'blocked' });
        expect(error.message).toContain('still waiting on a.');
        issues.delete(`k-a-${status}`);
      }
      expect(writes().filter((c) => commandOf(c) === 'human respond')).toEqual([]);

      // Closed and pinned children release it; so does a closed or pinned target with an open child.
      issues.set('hw', waitsOn('a'));
      issues.set('k-a-closed', child('a', 'closed'));
      issues.set('k-a-pinned', child('a', 'pinned'));
      expect(await provider().humanRespond('hw', 'Answer', ACTOR)).toMatchObject({ ok: true });
      issues.set('hw', waitsOn('b-pin'));
      issues.set('b-pin', issue('b-pin', { status: 'pinned' }));
      issues.set('k-b-open', child('b-pin', 'open'));
      expect(await provider().humanRespond('hw', 'Answer', ACTOR)).toMatchObject({ ok: true });
    });

    // bd 1.3.1's literal close rules: a child is open unless it is `closed`; a `blocks` or `conditional-blocks` target blocks unless
    // it is `closed` or `pinned` (a custom done status still blocks); `waits-for` blocks while its target has such a child.
    it('an unfinished child (a custom done status is not closed) refuses both, names it with the other blockers, and writes nothing', async () => {
      issues.set('c-open', issue('c-open', { dependencies: [{ issue_id: 'c-open', depends_on_id: 'h', type: 'parent-child' }] }));
      issues.set('c-wip', issue('c-wip', { status: 'in_progress', dependencies: [{ issue_id: 'c-wip', depends_on_id: 'h', type: 'parent-child' }] }));
      issues.set('c-done', issue('c-done', { status: 'closed', closed_at: T0, dependencies: [{ issue_id: 'c-done', depends_on_id: 'h', type: 'parent-child' }] }));
      issues.set('c-ship', issue('c-ship', { status: 'shipped', dependencies: [{ issue_id: 'c-ship', depends_on_id: 'h', type: 'parent-child' }] }));
      issues.set('h', issue('h', { labels: ['human'], dependencies: [{ issue_id: 'h', depends_on_id: 'a', type: 'blocks' }] }));
      for (const run of ['respond', 'dismiss'] as const) {
        const error = await refusal('h', run);
        expect(error).toMatchObject({ code: 'blocked' });
        expect(error.message).toBe("This request can't be closed yet. It is still waiting on a, c-open, c-wip, c-ship.");
      }
      expect(writes()).toEqual([]);
      expect(panelWrote).toEqual([]);
    });

    // bd refuses when the request's own blocked state is set AND a direct blocks, conditional-blocks or waits-for target is live.
    // The blocked state also comes from a blocked parent, and from a waits-for target of any status that holds an open child.
    it('waits-for: a request under a blocked parent is refused for a live target with no children (bd: blocked by it)', async () => {
      issues.set('pa', issue('pa', { dependencies: [{ issue_id: 'pa', depends_on_id: 'a', type: 'blocks' }] }));
      issues.set('w', issue('w'));
      issues.set('h', issue('h', { labels: ['human'], dependencies: [
        { issue_id: 'h', depends_on_id: 'pa', type: 'parent-child' },
        { issue_id: 'h', depends_on_id: 'w', type: 'waits-for' },
      ] }));
      const error = await refusal('h');
      expect(error).toMatchObject({ code: 'blocked' });
      expect(error.message).toBe("This request can't be closed yet. It is still waiting on w.");
      expect(writes()).toEqual([]);

      // The same link under a parent that is free, or one that is closed or pinned, closes.
      issues.get('a')!.status = 'closed';
      expect(await provider().humanRespond('h', 'Answer', ACTOR)).toMatchObject({ ok: true });
    });

    it('waits-for: a blocked grandparent counts, and a blocked parent without a live direct target does not refuse', async () => {
      issues.set('gp', issue('gp', { dependencies: [{ issue_id: 'gp', depends_on_id: 'a', type: 'blocks' }] }));
      issues.set('pa', issue('pa', { dependencies: [{ issue_id: 'pa', depends_on_id: 'gp', type: 'parent-child' }] }));
      issues.set('w', issue('w'));
      issues.set('h', issue('h', { labels: ['human'], dependencies: [
        { issue_id: 'h', depends_on_id: 'pa', type: 'parent-child' },
        { issue_id: 'h', depends_on_id: 'w', type: 'waits-for' },
      ] }));
      expect(await refusal('h')).toMatchObject({ code: 'blocked' });
      // Blocked through the parent but nothing live to name: bd lets it close.
      issues.set('h2', issue('h2', { labels: ['human'], dependencies: [{ issue_id: 'h2', depends_on_id: 'pa', type: 'parent-child' }] }));
      expect(await provider().humanRespond('h2', 'Answer', ACTOR)).toMatchObject({ ok: true });
    });

    it('waits-for: a pinned target that holds an open child blocks the request, so a live target with no children is refused', async () => {
      issues.set('b-pin', issue('b-pin', { status: 'pinned' }));
      issues.set('k-pin', issue('k-pin', { dependencies: [{ issue_id: 'k-pin', depends_on_id: 'b-pin', type: 'parent-child' }] }));
      issues.set('w', issue('w'));
      issues.set('h', issue('h', { labels: ['human'], dependencies: [
        { issue_id: 'h', depends_on_id: 'b-pin', type: 'waits-for' },
        { issue_id: 'h', depends_on_id: 'w', type: 'waits-for' },
      ] }));
      const error = await refusal('h');
      expect(error).toMatchObject({ code: 'blocked' });
      expect(error.message).toBe("This request can't be closed yet. It is still waiting on w.");
      expect(writes()).toEqual([]);
    });

    it('an unfinished child alone refuses, and the request goes through once the child is closed', async () => {
      issues.set('c-open', issue('c-open', { dependencies: [{ issue_id: 'c-open', depends_on_id: 'h', type: 'parent-child' }] }));
      expect(await refusal('h')).toMatchObject({ code: 'blocked' });
      issues.get('c-open')!.status = 'closed';
      expect(await provider().humanRespond('h', 'Answer', ACTOR)).toMatchObject({ ok: true });
    });

    it('an open conditional-blocks target refuses; closed does not', async () => {
      issues.set('h', issue('h', { labels: ['human'], dependencies: [{ issue_id: 'h', depends_on_id: 'a', type: 'conditional-blocks' }] }));
      const error = await refusal('h');
      expect(error).toMatchObject({ code: 'blocked' });
      expect(error.message).toContain('still waiting on a.');
      issues.get('a')!.status = 'closed';
      expect(await provider().humanRespond('h', 'Answer', ACTOR)).toMatchObject({ ok: true });
    });

    it('other kinds, and the request being a child of an open parent, do not refuse', async () => {
      issues.set('h', issue('h', { labels: ['human'], dependencies: [
        { issue_id: 'h', depends_on_id: 'a', type: 'waits-for' },
        { issue_id: 'h', depends_on_id: 'h2', type: 'related' },
        { issue_id: 'h', depends_on_id: 'h3', type: 'discovered-from' },
        { issue_id: 'h', depends_on_id: 'h4', type: 'parent-child' },
      ] }));
      issues.set('h3', issue('h3'));
      issues.set('h4', issue('h4'));
      expect(await provider().humanRespond('h', 'Answer', ACTOR)).toMatchObject({ ok: true });
    });

    it('an unreadable export refuses before writing: nothing is saved', async () => {
      overrides.export = () => {
        throw new BdError('timeout', 'slow');
      };
      await expect(provider().humanRespond('h', 'Answer', ACTOR)).rejects.toMatchObject({ code: 'busy' });
      expect(writes()).toEqual([]);
    });
  });

  it('a bead that is not there is not-found, without writing', async () => {
    await expect(provider().humanRespond('nope', 'x', ACTOR)).rejects.toMatchObject({ code: 'not-found' });
    await expect(provider().humanDismiss('nope', undefined, ACTOR)).rejects.toMatchObject({ code: 'not-found' });
    expect(writes()).toEqual([]);
    expect(ran()).not.toContain('show');
  });

  it('a blocked bead reports blocked when bd refuses, and the bead stays open', async () => {
    overrides['human respond'] = () => {
      throw new BdError('exit', 'x', { code: 1, stderr: 'cannot close blocked issue: h is blocked by [g-1] (use --force to override)' });
    };
    const error = await provider().humanRespond('h', 'Answer', ACTOR).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WriteError);
    expect(error).toMatchObject({ code: 'blocked' });
    expect((error as WriteError).message).toContain('g-1');
    expect((error as WriteError).message).not.toMatch(/--force/);
    expect(issues.get('h')!.status).toBe('open');
  });

  it('text verified by re-read when stdout is not JSON: exit 0 alone is not success', async () => {
    // bd printed a success line but the bead is still open.
    overrides['human respond'] = () => '✔ Bead h closed with response.\n';
    await expect(provider().humanRespond('h', 'Answer', ACTOR)).rejects.toMatchObject({ code: 'failed' });
    // It closed, but the answer was not kept.
    overrides['human respond'] = () => {
      issues.get('h2')!.status = 'closed';
      return 'done\n';
    };
    const unkept = await provider().humanRespond('h2', 'Answer', ACTOR).catch((e: unknown) => e);
    expect(unkept).toMatchObject({ code: 'failed', saved: true, message: 'The request was closed, but the answer was not saved.' });
    overrides['human dismiss'] = () => 'ok\n';
    await expect(provider().humanDismiss('h', undefined, ACTOR)).rejects.toMatchObject({ code: 'failed', message: "The request couldn't be closed." });
  });

  it('the close reason is checked on the re-read: a dropped or different one is failed with saved, not ok', async () => {
    // Respond: the comment is there, the reason is not `Responded`.
    overrides['human respond'] = () => {
      const row = issues.get('h')!;
      row.status = 'closed';
      row.close_reason = 'Closed';
      row.comments_list = [{ id: 'c-r', issue_id: 'h', author: ACTOR, text: 'Response: Answer', created_at: T0 }];
      row.comment_count = 1;
      return 'ok\n';
    };
    expect(await provider().humanRespond('h', 'Answer', ACTOR).catch((e: unknown) => e)).toMatchObject({
      code: 'failed',
      saved: true,
      message: 'The request was closed, but Beads recorded it differently.',
    });

    // Dismiss with a reason: bd closed it but kept none.
    overrides['human dismiss'] = () => {
      const row = issues.get('h2')!;
      row.status = 'closed';
      row.close_reason = 'Dismissed';
      return 'ok\n';
    };
    expect(await provider().humanDismiss('h2', 'Not needed', ACTOR).catch((e: unknown) => e)).toMatchObject({
      code: 'failed',
      saved: true,
      message: 'The request was closed, but the reason was not saved.',
    });

    // Dismiss with a different reason, and one without a reason that has none recorded at all.
    issues.set('h5', issue('h5', { labels: ['human'] }));
    overrides['human dismiss'] = () => {
      const row = issues.get('h5')!;
      row.status = 'closed';
      row.close_reason = 'Dismissed: something else';
      return 'ok\n';
    };
    await expect(provider().humanDismiss('h5', 'Not needed', ACTOR)).rejects.toMatchObject({ code: 'failed', saved: true });
    issues.set('h6', issue('h6', { labels: ['human'] }));
    overrides['human dismiss'] = () => {
      const row = issues.get('h6')!;
      row.status = 'closed';
      delete row.close_reason;
      return 'ok\n';
    };
    // No reason was typed, so the message does not talk about one.
    await expect(provider().humanDismiss('h6', undefined, ACTOR)).rejects.toMatchObject({ code: 'failed', saved: true, message: 'The request was closed, but Beads recorded it differently.' });
  });

  it('stdout of any shape is fine when the re-read shows the result', async () => {
    const real = fakeBd;
    overrides['human dismiss'] = (args) => {
      overrides = {};
      real(args);
      return '';
    };
    expect(await provider().humanDismiss('h', 'Fine', ACTOR)).toMatchObject({ ok: true, bead: { status: 'closed' } });
  });

  it('a timeout is uncertain, credits the panel, is never retried; an old bd maps to unsupported; a lost re-read is saved', async () => {
    overrides['human respond'] = () => {
      throw new BdError('timeout', 'slow');
    };
    await expect(provider().humanRespond('h', 'Answer', ACTOR)).rejects.toMatchObject({ code: 'uncertain' });
    expect(calls.filter((c) => commandOf(c) === 'human respond')).toHaveLength(1);
    expect(recordPanelWrite).toHaveBeenCalledWith(ROOT, 'h');
    expect(panelWrote).toEqual([{ comment: true, fields: ['status'] }]);

    overrides['human dismiss'] = () => {
      throw new Error('Error: unknown command "human" for "bd"');
    };
    await expect(provider().humanDismiss('h', undefined, ACTOR)).rejects.toMatchObject({ code: 'unsupported' });

    overrides['human dismiss'] = (args) => {
      overrides = { list: () => { throw new BdError('timeout', 'slow'); } };
      const row = issues.get('h2')!;
      row.status = 'closed';
      row.close_reason = 'Dismissed';
      return 'ok\n';
    };
    await expect(provider().humanDismiss('h2', undefined, ACTOR)).rejects.toMatchObject({ code: 'uncertain', saved: true });
  });

  it('refuses an empty or too long answer, a too long reason, and a bad id, before reading anything', async () => {
    await expect(provider().humanRespond('h', '   ', ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    await expect(provider().humanRespond('h', 'x'.repeat(16_001), ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    await expect(provider().humanDismiss('h', 'x'.repeat(501), ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    await expect(provider().humanDismiss('h', 'one\ntwo', ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    await expect(provider().humanRespond('h;rm', 'x', ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    expect(calls).toEqual([]);
    // 16,000 exactly is fine.
    expect(await provider().humanRespond('h', 'x'.repeat(16_000), ACTOR)).toMatchObject({ ok: true });
  });
});

const BAD_DUE = 'invalid --due format "blorp". Examples: +6h, tomorrow, next monday, 2025-01-15';
const BAD_UNTIL = 'Error: invalid --until format "blorp". Examples: +1h, tomorrow, next monday, 2025-01-15';

const badDate = (text: string) => (): never => {
  throw new BdError('exit', text, { code: 1, stderr: text });
};

describe('BdProvider.update: type, move, due date', () => {
  it('due text is passed through as typed, one argument', async () => {
    const result = await provider().update('a', T0, { due: 'next monday' }, ACTOR);
    expect(result).toMatchObject({ ok: true, bead: { id: 'a', extra: { due_at: 'due:next monday' } } });
    const update = calls.find((c) => commandOf(c) === 'update')!;
    expect(update.args).toEqual(['--actor', ACTOR, 'update', '--json', '--due=next monday', '--', 'a']);
    expect(panelWrote).toEqual([{ fields: ['due_at'] }]);
  });

  it('a due date is cleared with an empty value, and only when there is one', async () => {
    expect(await provider().update('a', T0, { due: null }, ACTOR)).toMatchObject({ ok: true });
    expect(writes()).toEqual([]);
    beadA().due_at = '2026-10-20T00:00:00Z';
    expect(await provider().update('a', T0, { due: null }, ACTOR)).toMatchObject({ ok: true, bead: { extra: {} } });
    expect(calls.find((c) => commandOf(c) === 'update')!.args).toContain('--due=');
  });

  it('a bad due date is invalid, in plain words, with the list of examples left out', async () => {
    overrides.update = badDate(BAD_DUE);
    const failure = await provider().update('a', T0, { due: 'blorp' }, ACTOR).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(WriteError);
    expect(failure).toMatchObject({ code: 'invalid', message: `That date isn't one Beads understands: "blorp".` });
    expect((failure as WriteError).message).not.toMatch(/Examples|--due/);
    expect((failure as WriteError).detail).toContain('Examples');
  });

  it('refuses an empty or too long date, and one with a line break, before reading anything', async () => {
    for (const due of ['', '   ', 'x'.repeat(101), 'a\nb']) {
      await expect(provider().update('a', T0, { due }, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    }
    expect(calls).toEqual([]);
  });

  it('moves a bead under an epic with --parent, and out of it with an empty one', async () => {
    issues.set('epic', issue('epic', { issue_type: 'epic' }));
    const moved = await provider().update('a', T0, { parent: 'epic' }, ACTOR);
    expect(moved).toMatchObject({ ok: true, bead: { parentId: 'epic' } });
    expect(calls.find((c) => commandOf(c) === 'update')!.args).toEqual(['--actor', ACTOR, 'update', '--json', '--parent=epic', '--', 'a']);
    expect(panelWrote).toEqual([{ fields: ['parentId'] }]);

    const at = (moved as { bead: { updatedAt: string } }).bead.updatedAt;
    calls = [];
    const out = await provider().update('a', at, { parent: null }, ACTOR, { parentId: 'epic' });
    expect(out).toMatchObject({ ok: true, bead: { parentId: null } });
    expect(calls.find((c) => commandOf(c) === 'update')!.args).toContain('--parent=');
  });

  it('a parent that is already the parent, and no parent for a bead with none, change nothing', async () => {
    issues.get('a')!.parent = 'epic';
    issues.set('epic', issue('epic', { issue_type: 'epic' }));
    await provider().update('a', T0, { parent: 'epic' }, ACTOR);
    await provider().update('epic', T0, { parent: null }, ACTOR);
    expect(writes()).toEqual([]);
  });

  it('moving a bead under its own child, or under itself, is refused before bd is asked', async () => {
    issues.set('c', issue('c', { parent: 'a' }));
    issues.set('gc', issue('gc', { parent: 'c' }));
    const refusal = { code: 'invalid', message: 'An epic cannot go inside its own child.' };
    await expect(provider().update('a', T0, { parent: 'c' }, ACTOR)).rejects.toMatchObject(refusal);
    await expect(provider().update('a', T0, { parent: 'gc' }, ACTOR)).rejects.toMatchObject(refusal);
    await expect(provider().update('a', T0, { parent: 'a' }, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    expect(writes()).toEqual([]);
  });

  it('a parent that does not exist is refused, and a bead id with a flag in it is not a parent', async () => {
    await expect(provider().update('a', T0, { parent: 'missing' }, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    await expect(provider().update('a', T0, { parent: '--force' }, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    expect(writes()).toEqual([]);
  });

  it('an unknown type is not pre-checked: bd refuses it and the refusal is mapped', async () => {
    overrides.update = () => {
      throw new BdError('exit', 'validation failed: invalid issue type nonsense', { code: 1, stderr: 'Error updating a: validation failed: invalid issue type nonsense' });
    };
    await expect(provider().update('a', T0, { type: 'nonsense' }, ACTOR)).rejects.toMatchObject({ code: 'invalid', message: '"nonsense" is not a type in this project.' });
    expect(calls.find((c) => commandOf(c) === 'update')!.args).toContain('--type=nonsense');
    expect(ran()).not.toContain('types');
  });

  it('a type that differs goes in as --type, one that matches does not', async () => {
    expect(await provider().update('a', T0, { type: 'task' }, ACTOR)).toMatchObject({ ok: true });
    expect(writes()).toEqual([]);
    expect(await provider().update('a', T0, { type: 'bug' }, ACTOR)).toMatchObject({ ok: true, bead: { type: 'bug' } });
    expect(panelWrote).toEqual([{ fields: ['type'] }]);
  });

  it('panel writes are named as the snapshot diff names them, never as raw patch keys', async () => {
    issues.set('epic', issue('epic', { issue_type: 'epic' }));
    await provider().update('a', T0, { type: 'bug', parent: 'epic', due: 'tomorrow', closeReason: 'unused' }, ACTOR);
    // The close reason keeps its own name: the diff names it when a reason changes without a move into or out of done.
    expect(panelWrote).toEqual([{ fields: ['type', 'parentId', 'due_at', 'closeReason'] }]);
  });

  it('expected fields refuse a stale date, parent or type', async () => {
    beadA().due_at = '2026-10-20T00:00:00Z';
    beadA().parent = 'epic';
    issues.set('epic', issue('epic', { issue_type: 'epic' }));
    // Same second as the panel's read, so only the shown values can tell.
    for (const expected of [{ due: '2026-10-19T00:00:00Z' }, { due: null }, { parentId: 'other' }, { parentId: null }, { type: 'bug' }]) {
      const result = await provider().update('a', T0, { title: 'Mine' }, ACTOR, expected);
      expect(result, JSON.stringify(expected)).toMatchObject({ ok: false, conflict: true });
    }
    expect(writes()).toEqual([]);
    const fine = await provider().update('a', T0, { title: 'Mine' }, ACTOR, { due: '2026-10-20T00:00:00Z', parentId: 'epic', type: 'task' });
    expect(fine).toMatchObject({ ok: true });
  });

  it('expected null for a date or parent the bead does not have is not a conflict', async () => {
    const result = await provider().update('a', T0, { title: 'Mine' }, ACTOR, { due: null, parentId: null });
    expect(result).toMatchObject({ ok: true });
  });

  it('a move and a date edit together are one update call', async () => {
    issues.set('epic', issue('epic', { issue_type: 'epic' }));
    await provider().update('a', T0, { parent: 'epic', due: '+2d' }, ACTOR);
    expect(writes()).toHaveLength(1);
    expect(writes()[0]!.args).toEqual(['--actor', ACTOR, 'update', '--json', '--due=+2d', '--parent=epic', '--', 'a']);
  });
});

describe('BdProvider.deferBead and undeferBead', () => {
  it('snoozes until the date as typed', async () => {
    const result = await provider().deferBead('a', T0, 'next monday', undefined, ACTOR);
    expect(result).toMatchObject({ ok: true, bead: { status: 'deferred', extra: { defer_until: 'snooze:next monday' } } });
    expect(writes().map((c) => c.args)).toEqual([['--actor', ACTOR, 'defer', '--json', '--until=next monday', '--', 'a']]);
    expect(panelWrote).toEqual([{ fields: ['status', 'defer_until'] }]);
  });

  it('passes a reason along', async () => {
    await provider().deferBead('a', T0, 'tomorrow', '  waiting on legal ', ACTOR);
    expect(writes()[0]!.args).toContain('--reason=waiting on legal');
    await expect(provider().deferBead('a', T0, 'tomorrow', 'one\ntwo', ACTOR)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('a bad date is invalid, with the examples stripped', async () => {
    overrides.defer = badDate(BAD_UNTIL);
    const failure = await provider().deferBead('a', T0, 'blorp', undefined, ACTOR).catch((e: unknown) => e);
    expect(failure).toMatchObject({ code: 'invalid', message: `That date isn't one Beads understands: "blorp".` });
    expect((failure as WriteError).message).not.toMatch(/Examples|--until/);
  });

  it('refuses an empty date before reading anything', async () => {
    await expect(provider().deferBead('a', T0, '  ', undefined, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    expect(calls).toEqual([]);
  });

  it('defer indefinitely clears an existing date first, because a plain defer would keep it', async () => {
    beadA().defer_until = '2026-10-20T00:00:00Z';
    const result = await provider().deferBead('a', T0, null, undefined, ACTOR);
    expect(writes().map((c) => c.args.slice(2))).toEqual([
      ['update', '--json', '--defer=', '--', 'a'],
      ['defer', '--json', '--', 'a'],
    ]);
    expect(result).toMatchObject({ ok: true, bead: { status: 'deferred' } });
    expect((result as { bead: { extra: Record<string, unknown> } }).bead.extra).not.toHaveProperty('defer_until');
    expect(panelWrote).toEqual([{ fields: ['status', 'defer_until'] }]);
  });

  it('defer indefinitely with no date set is one defer', async () => {
    await provider().deferBead('a', T0, null, undefined, ACTOR);
    expect(writes().map((c) => c.args.slice(2))).toEqual([['defer', '--json', '--', 'a']]);
  });

  it('conflict when updatedAt moved: nothing is written', async () => {
    beadA().updated_at = '2026-10-14T10:00:30Z';
    expect(await provider().deferBead('a', T0, 'tomorrow', undefined, ACTOR)).toMatchObject({ ok: false, conflict: true, current: { id: 'a' } });
    expect(await provider().undeferBead('a', T0, ACTOR)).toMatchObject({ ok: false, conflict: true });
    expect(writes()).toEqual([]);
  });

  it('will not snooze a finished bead', async () => {
    await expect(provider().deferBead('done', T0, 'tomorrow', undefined, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    expect(writes()).toEqual([]);
  });

  it('a missing bead is not-found', async () => {
    await expect(provider().deferBead('nope', T0, 'tomorrow', undefined, ACTOR)).rejects.toMatchObject({ code: 'not-found' });
    await expect(provider().undeferBead('nope', T0, ACTOR)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('undefer brings the bead back and notes the status and the date', async () => {
    beadA().status = 'deferred';
    beadA().defer_until = '2026-10-20T00:00:00Z';
    const result = await provider().undeferBead('a', T0, ACTOR);
    expect(writes().map((c) => c.args.slice(2))).toEqual([['undefer', '--json', '--', 'a']]);
    expect(result).toMatchObject({ ok: true, bead: { status: 'open' } });
    expect(panelWrote).toEqual([{ fields: ['status', 'defer_until'] }]);
  });

  it('undefer of an open bead that still carries a date clears the date and leaves the status', async () => {
    beadA().defer_until = '2026-12-01T00:00:00Z';
    const result = await provider().undeferBead('a', T0, ACTOR);
    expect(writes().map((c) => c.args.slice(2))).toEqual([['update', '--json', '--defer=', '--', 'a']]);
    expect(result).toMatchObject({ ok: true, bead: { status: 'open' } });
    expect((result as { bead: { extra: Record<string, unknown> } }).bead.extra).not.toHaveProperty('defer_until');
    expect(panelWrote).toEqual([{ fields: ['defer_until'] }]);
  });

  it('undefer of a bead that is not snoozed writes nothing', async () => {
    expect(await provider().undeferBead('a', T0, ACTOR)).toMatchObject({ ok: true, bead: { id: 'a' } });
    expect(writes()).toEqual([]);
  });

  it('a timeout is uncertain and the bead is read again', async () => {
    overrides.defer = () => {
      throw new BdError('timeout', 'slow');
    };
    const result = await provider().deferBead('a', T0, 'tomorrow', undefined, ACTOR);
    expect(result).toMatchObject({ ok: false, uncertain: true, current: { id: 'a' } });
    expect(panelWrote).toEqual([{ fields: ['status', 'defer_until'] }]);
  });
});

describe('BdProvider.supersede and duplicate', () => {
  beforeEach(() => {
    issues.set('new', issue('new'));
  });

  it('supersede closes the bead and adds the supersedes edge', async () => {
    const result = await provider().supersede('a', 'new', T0, ACTOR);
    expect(writes().map((c) => c.args)).toEqual([['--actor', ACTOR, 'supersede', '--json', '--with=new', '--', 'a']]);
    expect(result).toMatchObject({ ok: true, bead: { id: 'a', status: 'closed', dependencies: [{ from: 'a', to: 'new', kind: 'supersedes' }] } });
    expect(panelWrote).toEqual([{ fields: ['status'], deps: [['a', 'new']] }]);
  });

  it('duplicate closes the bead and adds the duplicates edge', async () => {
    const result = await provider().duplicate('a', 'new', T0, ACTOR);
    expect(writes().map((c) => c.args)).toEqual([['--actor', ACTOR, 'duplicate', '--json', '--of=new', '--', 'a']]);
    expect(result).toMatchObject({ ok: true, bead: { status: 'closed', dependencies: [{ to: 'new', kind: 'duplicates' }] } });
  });

  it('supersede refuses when updatedAt moved: conflict, nothing written', async () => {
    beadA().updated_at = '2026-10-14T10:00:30Z';
    expect(await provider().supersede('a', 'new', T0, ACTOR)).toMatchObject({ ok: false, conflict: true, current: { id: 'a' } });
    expect(await provider().duplicate('a', 'new', T0, ACTOR)).toMatchObject({ ok: false, conflict: true });
    expect(writes()).toEqual([]);
  });

  it('refuses itself, a bead that does not exist, and a closed bead', async () => {
    await expect(provider().supersede('a', 'a', T0, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    await expect(provider().duplicate('a', 'missing', T0, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    await expect(provider().duplicate('done', 'new', T0, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    await expect(provider().supersede('nope', 'new', T0, ACTOR)).rejects.toMatchObject({ code: 'not-found' });
    await expect(provider().supersede('a', '--force', T0, ACTOR)).rejects.toMatchObject({ code: 'invalid' });
    expect(writes()).toEqual([]);
  });

  it('supersede on a gated bead is blocked, and names a review, not an id', async () => {
    issues.set('g-1', issue('g-1', { issue_type: 'gate', await_type: 'human', title: 'Gate: human' }));
    beadA().dependencies = [{ issue_id: 'a', depends_on_id: 'g-1', type: 'blocks' }];
    const failure = await provider().supersede('a', 'new', T0, ACTOR).catch((e: unknown) => e);
    expect(failure).toMatchObject({ code: 'blocked' });
    expect((failure as WriteError).message).toContain('review');
    expect((failure as WriteError).message).not.toContain('g-1');
    await expect(provider().duplicate('a', 'new', T0, ACTOR)).rejects.toMatchObject({ code: 'blocked' });
    expect(writes()).toEqual([]);
  });

  it('a bead with an open sub-task is blocked, like a plain close', async () => {
    issues.set('c', issue('c', { parent: 'a' }));
    await expect(provider().supersede('a', 'new', T0, ACTOR)).rejects.toMatchObject({ code: 'blocked' });
    expect(writes()).toEqual([]);
  });

  it('an older Beads without the command is unsupported', async () => {
    overrides.supersede = () => {
      throw new Error('Error: unknown command "supersede" for "bd"');
    };
    await expect(provider().supersede('a', 'new', T0, ACTOR)).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('a timeout is uncertain: the bead is looked at again and the link is noted as the panel\'s', async () => {
    overrides.duplicate = () => {
      throw new BdError('timeout', 'slow');
    };
    expect(await provider().duplicate('a', 'new', T0, ACTOR)).toMatchObject({ ok: false, uncertain: true, current: { id: 'a' } });
    expect(panelWrote).toEqual([{ fields: ['status'], deps: [['a', 'new']] }]);
  });
});

describe('BdProvider.update: closeComment', () => {
  it('adds the comment, then closes', async () => {
    const result = await provider().update('a', T0, { status: 'closed', closeReason: 'Shipped', closeComment: 'All merged.' }, ACTOR);
    expect(ran().filter((c) => c !== 'list' && c !== 'statuses')).toEqual(['comments add', 'close']);
    const comment = calls.find((c) => commandOf(c) === 'comments add')!;
    expect(comment.args).toEqual(['--actor', ACTOR, 'comments', 'add', '--json', `--author=${ACTOR}`, '--', 'a', 'All merged.']);
    expect(result).toMatchObject({ ok: true, bead: { status: 'closed' } });
    expect(panelWrote).toEqual([{ comment: true }, { fields: ['status', 'closeReason'] }]);
  });

  it('keeps the comment when the close is refused, and says so', async () => {
    overrides.close = () => {
      throw new BdError('exit', 'cannot close blocked issue: a is blocked by [b]', { code: 1, stderr: 'cannot close blocked issue: a is blocked by [b] (use --force to override)' });
    };
    const failure = await provider().update('a', T0, { status: 'closed', closeComment: 'Done.' }, ACTOR).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(WriteError);
    expect(failure).toMatchObject({ code: 'blocked', saved: true });
    expect((failure as WriteError).message).toBe("Your comment was added, but the bead could not be closed. This bead can't be closed yet. It is still blocked by b. Close those first.");
    expect(ran()).toContain('comments add');
    // The comment is not taken back, and the panel is told about it.
    expect(panelWrote).toEqual([{ comment: true }]);
  });

  it('a close that fails on open sub-tasks keeps the comment too', async () => {
    overrides.close = () => {
      throw new BdError('exit', 'cannot close a: 1 open child issue(s); close children first', { code: 1, stderr: 'cannot close a: 1 open child issue(s); close children first or use --force to override' });
    };
    issues.set('c', issue('c', { parent: 'a' }));
    await expect(provider().update('a', T0, { status: 'closed', closeComment: 'Done.' }, ACTOR)).rejects.toMatchObject({
      code: 'blocked',
      saved: true,
      message: "Your comment was added, but the bead could not be closed. This bead can't be closed yet. It has sub-tasks that are not closed yet: c. Close those first.",
    });
  });

  it('keeps "Beads" capitalised and does not say nothing was saved when the close is busy', async () => {
    overrides.close = () => {
      throw new BdError('lock', 'database is locked', { stderr: 'database is locked' });
    };
    await expect(provider().update('a', T0, { status: 'closed', closeComment: 'Done.' }, ACTOR)).rejects.toMatchObject({
      code: 'busy',
      saved: true,
      message: 'Your comment was added, but the bead could not be closed. Beads is busy. Try again in a moment.',
    });
  });

  it('a refused close that a review blocks says so as a review, never by the gate id', async () => {
    issues.set('g-1', issue('g-1', { issue_type: 'gate', await_type: 'human', title: 'Gate: human' }));
    overrides.close = () => {
      throw new BdError('exit', 'cannot close blocked issue: a is blocked by [g-1]', { code: 1, stderr: 'cannot close blocked issue: a is blocked by [g-1] (use --force to override)' });
    };
    const failure = await provider().update('a', T0, { status: 'closed', closeComment: 'Done.' }, ACTOR).catch((e: unknown) => e);
    expect(failure).toMatchObject({ code: 'blocked', saved: true, message: 'Your comment was added, but the bead could not be closed. This bead is waiting on a review. Resolve it first.' });
    const plain = await provider().update('a', T0, { status: 'closed' }, ACTOR).catch((e: unknown) => e);
    expect(plain).toMatchObject({ code: 'blocked', message: 'This bead is waiting on a review. Resolve it first.' });
    expect((plain as WriteError).saved).toBeFalsy();
    // The raw text stays in the detail.
    expect((plain as WriteError).detail).toContain('g-1');
  });

  it('a review and a bead that block it are both named, the review as one', async () => {
    issues.set('g-1', issue('g-1', { issue_type: 'gate', await_type: 'human', title: 'Gate: human' }));
    overrides.close = () => {
      throw new BdError('exit', 'cannot close blocked issue: a is blocked by [g-1, b]', { code: 1, stderr: 'cannot close blocked issue: a is blocked by [g-1, b] (use --force to override)' });
    };
    const failure = await provider().update('a', T0, { status: 'closed' }, ACTOR).catch((e: unknown) => e);
    expect((failure as WriteError).message).toBe("This bead can't be closed yet. It is still blocked by a review, b. Close those first.");
  });

  it('a gate that blocks a move to a custom done status is worded the same way', async () => {
    issues.set('g-1', issue('g-1', { issue_type: 'gate', await_type: 'human', title: 'Gate: human' }));
    overrides.close = () => {
      throw new BdError('exit', 'cannot close blocked issue: a is blocked by [g-1]', { code: 1, stderr: 'cannot close blocked issue: a is blocked by [g-1]' });
    };
    await expect(provider().update('a', T0, { status: 'shipped' }, ACTOR)).rejects.toMatchObject({ code: 'blocked', message: 'This bead is waiting on a review. Resolve it first.' });
  });

  it('is left out when the patch does not close the bead', async () => {
    await provider().update('a', T0, { title: 'Renamed', closeComment: 'Not a close.' }, ACTOR);
    expect(ran()).not.toContain('comments add');
    expect(panelWrote).toEqual([{ fields: ['title'] }]);
  });

  it('a blank comment is no comment', async () => {
    await provider().update('a', T0, { status: 'closed', closeComment: '   ' }, ACTOR);
    expect(ran()).not.toContain('comments add');
    expect(ran()).toContain('close');
  });

  it('a conflict writes neither the comment nor the close', async () => {
    beadA().updated_at = '2026-10-14T10:00:30Z';
    expect(await provider().update('a', T0, { status: 'closed', closeComment: 'Done.' }, ACTOR)).toMatchObject({ ok: false, conflict: true });
    expect(writes()).toEqual([]);
  });

  it('a comment that cannot be added stops the close', async () => {
    overrides['comments add'] = () => {
      throw new BdError('timeout', 'slow');
    };
    await expect(provider().update('a', T0, { status: 'closed', closeComment: 'Done.' }, ACTOR)).rejects.toMatchObject({ code: 'uncertain' });
    expect(ran()).not.toContain('close');
  });
});
