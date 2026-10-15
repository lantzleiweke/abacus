import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/service/bd/exec', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/service/bd/exec')>()),
  runBd: vi.fn(),
  runBdJson: vi.fn(),
}));

import { BdProvider, WriteError } from '../../../src/service/bd/adapter';
import { BdError, runBd } from '../../../src/service/bd/exec';

const bd = vi.mocked(runBd);
const ok = (stdout: string) => ({ stdout, stderr: '', code: 0 });
const ROOT = '/work/proj';

let journal: string | Error;
let calls: string[][];

beforeEach(() => {
  journal = 'false\n';
  calls = [];
  bd.mockReset();
  bd.mockImplementation(async (_dir, args) => {
    calls.push(args);
    if (args.includes('get')) {
      if (journal instanceof Error) throw journal;
      return ok(journal);
    }
    if (args.includes('set')) {
      journal = 'true\n';
      return ok('Set events-journal = true (in config.yaml)\n');
    }
    throw new Error(`unexpected bd call: ${args.join(' ')}`);
  });
});

describe('eventsJournal (the setting, read)', () => {
  it('reports on, off and unknown, always with --readonly', async () => {
    const provider = new BdProvider(ROOT, 'embedded');
    journal = 'true\n';
    expect(await provider.eventsJournal()).toBe('on');
    journal = 'false\n';
    expect(await provider.eventsJournal()).toBe('off');
    journal = 'something else\n';
    expect(await provider.eventsJournal()).toBe('unknown');
    journal = new BdError('timeout', 'bd did not answer');
    expect(await provider.eventsJournal()).toBe('unknown');
    bd.mockResolvedValueOnce({ stdout: '', stderr: 'Error: boom', code: 1 });
    expect(await provider.eventsJournal()).toBe('unknown');
    for (const args of calls) expect(args.slice(0, 4)).toEqual(['--readonly', 'config', 'get', 'events-journal']);
  });
});

describe('enableEventsJournal (the one place a project setting is written)', () => {
  it('runs exactly one write, with the panel actor and no --force, then reads the setting back', async () => {
    await new BdProvider(ROOT, 'embedded').enableEventsJournal('Ann (panel)');
    const writes = calls.filter((args) => args.includes('set'));
    expect(writes).toEqual([['--actor', 'Ann (panel)', 'config', 'set', 'events-journal', 'true']]);
    expect(calls.flat()).not.toContain('--force');
    expect(calls.flat()).not.toContain('--force-git-tracked');
    // The read-back came after the write.
    expect(calls[calls.length - 1]).toEqual(['--readonly', 'config', 'get', 'events-journal']);
  });

  it('a write that exits 0 but reads back as off is a failure, not a success', async () => {
    bd.mockImplementation(async (_dir, args) => (args.includes('get') ? ok('false\n') : ok('Set events-journal = true\n')));
    const error = await new BdProvider(ROOT, 'embedded').enableEventsJournal('Ann (panel)').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WriteError);
    expect(error).toMatchObject({ code: 'failed' });
    // Beads said it set it, so the words must not suggest the file was left alone.
    expect((error as WriteError).message).not.toMatch(/didn't turn/i);
  });

  it('a write that exits 0 but cannot be read back is uncertain and saved, never "failed"', async () => {
    for (const readBack of [new BdError('timeout', 'bd did not answer'), 'surprise\n']) {
      journal = readBack;
      bd.mockImplementation(async (_dir, args) => {
        if (args.includes('get')) {
          if (journal instanceof Error) throw journal;
          return ok(journal);
        }
        return ok('Set events-journal = true (in config.yaml)\n');
      });
      const error = await new BdProvider(ROOT, 'embedded').enableEventsJournal('Ann (panel)').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WriteError);
      // The panel reads the status again and shows it under these words, so they do not send the person back to Settings.
      expect(error).toMatchObject({ code: 'uncertain', saved: true, message: "Live updates may be on now, but Beads didn't confirm it." });
    }
  });

  it('a refused write is a WriteError, and nothing is read back', async () => {
    bd.mockImplementation(async (_dir, args) => {
      calls.push(args);
      return { stdout: '', stderr: 'Error: unknown command "events-journal"', code: 1 };
    });
    await expect(new BdProvider(ROOT, 'embedded').enableEventsJournal('Ann (panel)')).rejects.toBeInstanceOf(WriteError);
    expect(calls.filter((args) => args.includes('get'))).toEqual([]);
  });
});

// The panel never changes a project's settings silently: the tracked .beads/config.yaml is the person's to change, and only the
// Settings button may. A static guard over every source file, not just the adapter. It reads whole files, so an argument list split
// across lines (the likeliest shape of a second call site) is caught too.
const WRITE_PATTERN = /['"`]config['"`]\s*,\s*['"`]set['"`]|\bconfig\s+set\b|['"`]set['"`]\s*,\s*['"`]events-journal/g;

function settingWrites(text: string): string[] {
  return [...text.matchAll(WRITE_PATTERN)].map((m) => m[0]);
}

describe('no other path writes a project setting', () => {
  const SRC = join(__dirname, '../../../src');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name)) files.push(path);
    }
  };

  it('the guard sees a call whose argument list is split across lines', () => {
    expect(settingWrites("run(['config', 'set', 'events-journal', 'true'])")).toHaveLength(1);
    expect(settingWrites("run([\n  'config',\n  'set',\n  'other-key',\n  'x',\n])")).toHaveLength(1);
    expect(settingWrites("run([\n  'config'\n  , 'set'\n])")).toHaveLength(1);
    expect(settingWrites('exec("bd config   set key v")')).toHaveLength(1);
    expect(settingWrites("run(['config', 'get', 'events-journal'])")).toHaveLength(0);
  });

  it('the only `config` `set` in src/ is the events journal switch in the adapter', () => {
    walk(SRC);
    expect(files.length).toBeGreaterThan(10);
    const hits = files.flatMap((path) => settingWrites(readFileSync(path, 'utf8')).map(() => relative(SRC, path)));
    expect(hits).toEqual([join('service', 'bd', 'adapter.ts')]);
    expect(readFileSync(join(SRC, 'service', 'bd', 'adapter.ts'), 'utf8')).toContain("['config', 'set', 'events-journal', 'true']");
  });
});

// The same kind of guard for the schema update: it rewrites the project's database, so the panel never runs it by itself, and only
// the Update button's route reaches it. Exactly one call site in src/, and it is the adapter's.
const MIGRATE_PATTERN = /['"`]migrate['"`]|\bmigrate\s+schema\b/g;

function schemaUpdates(text: string): string[] {
  return [...text.matchAll(MIGRATE_PATTERN)].map((m) => m[0]);
}

describe('no other path runs a schema update', () => {
  const SRC = join(__dirname, '../../../src');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name)) files.push(path);
    }
  };

  it('the guard sees a call whose argument list is split across lines', () => {
    expect(schemaUpdates("run(['migrate', 'schema'])")).toHaveLength(1);
    expect(schemaUpdates("run([\n  'migrate'\n  , 'schema'\n])")).toHaveLength(1);
    expect(schemaUpdates('exec("bd migrate   schema --json")')).toHaveLength(1);
    expect(schemaUpdates("run(['--readonly', 'list'])")).toHaveLength(0);
  });

  it('the only schema update in src/ is the one in the adapter', () => {
    walk(SRC);
    expect(files.length).toBeGreaterThan(10);
    const hits = files.flatMap((path) => schemaUpdates(readFileSync(path, 'utf8')).map(() => relative(SRC, path)));
    expect(hits).toEqual([join('service', 'bd', 'adapter.ts')]);
    expect(readFileSync(join(SRC, 'service', 'bd', 'adapter.ts'), 'utf8')).toContain("['migrate', 'schema']");
  });

  /** Every `.name(` call in src/, as "path: count", so a second call in the same file counts too. */
  const calls = (name: string): string[] => {
    if (files.length === 0) walk(SRC);
    const pattern = new RegExp(`\\.${name}\\(`, 'g');
    return files.flatMap((path) => {
      const n = [...readFileSync(path, 'utf8').matchAll(pattern)].length;
      return n > 0 ? [`${relative(SRC, path)}: ${n}`] : [];
    });
  };

  it('guard counts calls, not files: a second call in the same file is seen', () => {
    const count = (text: string) => [...text.matchAll(/\.migrateSchema\(/g)].length;
    expect(count('a.migrateSchema(1);\nb.migrateSchema(2);')).toBe(2);
    expect(count('async migrateSchema(actor) {}')).toBe(0);
  });

  it('is reached by exactly one call in the route and one in the panel store', () => {
    // The service side: one call, in the route. The panel side: one call, in the store action that only the confirm runs.
    expect(calls('migrateSchema')).toEqual([`panel${sep}store.ts: 1`, `service${sep}routes.ts: 1`]);
  });

  it('the store action is called from the confirm in ProjectUpdate and nowhere else', () => {
    expect(calls('updateProject')).toEqual([`panel${sep}ui${sep}ProjectUpdate.tsx: 1`]);
    // ...and that one call sits in `send`, which only the confirm's Update button and the busy "Try again" run.
    const text = readFileSync(join(SRC, 'panel', 'ui', 'ProjectUpdate.tsx'), 'utf8');
    expect([...text.matchAll(/void send\(\)/g)]).toHaveLength(2);
  });
});
