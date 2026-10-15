import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/service/bd/exec', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/service/bd/exec')>()),
  runBd: vi.fn(),
  runDolt: vi.fn(),
}));

import { AUDIT_BEAD_IDS_MAX, AUDIT_LIMIT_MAX, checkAuditSchema, eventTimeMs, readAuditEvents, resetAuditSchemaCache, type AuditEvent } from '../../../src/service/bd/audit';
import { BdError, runBd, runDolt } from '../../../src/service/bd/exec';

const bd = vi.mocked(runBd);
const dolt = vi.mocked(runDolt);

const SERVER_READS = join(__dirname, '..', '..', 'fixtures', 'server', 'reads');
const EMBEDDED_READS = join(__dirname, '..', '..', 'fixtures-private', 'embedded', 'reads');

async function fixture(dir: string, name: string): Promise<string> {
  return readFile(join(dir, name), 'utf8');
}

const ok = (stdout: string) => ({ stdout, stderr: '', code: 0 });

let tmp: string;
let describeJson: string;
let eventsJson: string;
let eventRows: Array<Record<string, unknown>>;

beforeEach(async () => {
  resetAuditSchemaCache();
  bd.mockReset();
  dolt.mockReset();
  tmp = await mkdtemp(join(tmpdir(), 'oc-beads-audit-'));
  describeJson = await fixture(SERVER_READS, 'sql-describe-events.json');
  eventsJson = await fixture(SERVER_READS, 'sql-events-recent.json');
  eventRows = JSON.parse(eventsJson) as Array<Record<string, unknown>>;
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function embeddedProject(name: string, metadata: Record<string, unknown> = { database: 'dolt', dolt_mode: 'embedded', dolt_database: 'demo' }): Promise<string> {
  const root = join(tmp, name);
  await mkdir(join(root, '.beads'), { recursive: true });
  await writeFile(join(root, '.beads', 'metadata.json'), JSON.stringify(metadata));
  return root;
}

/** Answers DESCRIBE with `describe` and any other query with `events`. */
function serverAnswers(describe: string, events: string): void {
  bd.mockImplementation(async (_dir, args) => ok(args.at(-1) === 'DESCRIBE events' ? describe : events));
}

function without(field: string): string {
  const rows = JSON.parse(describeJson) as Array<{ Field: string }>;
  return JSON.stringify(rows.filter((row) => row.Field !== field));
}

describe('checkAuditSchema', () => {
  it('is true for the full events table and reads it with --readonly', async () => {
    serverAnswers(describeJson, '[]');
    expect(await checkAuditSchema('/p', 'server')).toBe(true);
    expect(bd).toHaveBeenCalledWith('/p', ['--readonly', 'sql', '--json', 'DESCRIBE events'], expect.objectContaining({ retries: 2 }));
  });

  it.each(['issue_id', 'event_type', 'actor', 'old_value', 'new_value', 'created_at', 'id'])('is false when %s is missing', async (column) => {
    serverAnswers(without(column), '[]');
    expect(await checkAuditSchema('/p', 'server')).toBe(false);
  });

  it('keeps the answer per root', async () => {
    serverAnswers(describeJson, '[]');
    expect(await checkAuditSchema('/p', 'server')).toBe(true);
    expect(await checkAuditSchema('/p', 'server')).toBe(true);
    expect(bd).toHaveBeenCalledTimes(1);
    expect(await checkAuditSchema('/other', 'server')).toBe(true);
    expect(bd).toHaveBeenCalledTimes(2);
  });

  it('keeps a false answer too', async () => {
    serverAnswers(without('actor'), '[]');
    expect(await checkAuditSchema('/p', 'server')).toBe(false);
    expect(await checkAuditSchema('/p', 'server')).toBe(false);
    expect(bd).toHaveBeenCalledTimes(1);
  });

  it('shares one lookup between concurrent callers', async () => {
    serverAnswers(describeJson, '[]');
    expect(await Promise.all([checkAuditSchema('/p', 'server'), checkAuditSchema('/p', 'server')])).toEqual([true, true]);
    expect(bd).toHaveBeenCalledTimes(1);
  });

  it('gives every concurrent caller false when the shared lookup fails', async () => {
    bd.mockRejectedValue(new BdError('timeout', 'bd timed out'));
    expect(await Promise.all([checkAuditSchema('/p', 'server'), checkAuditSchema('/p', 'server')])).toEqual([false, false]);
    expect(bd).toHaveBeenCalledTimes(1);
    // Not remembered: the next call looks again.
    serverAnswers(describeJson, '[]');
    expect(await checkAuditSchema('/p', 'server')).toBe(true);
  });

  it('is false for a failed lookup and asks again next time', async () => {
    bd.mockRejectedValueOnce(new BdError('lock', 'bd is busy'));
    expect(await checkAuditSchema('/p', 'server')).toBe(false);
    serverAnswers(describeJson, '[]');
    expect(await checkAuditSchema('/p', 'server')).toBe(true);
  });

  it('is false when the table does not exist (exit 1)', async () => {
    bd.mockResolvedValue({ stdout: '', stderr: 'table not found: events', code: 1 });
    expect(await checkAuditSchema('/p', 'server')).toBe(false);
  });

  it('reads the embedded database with dolt from inside its folder', async () => {
    const root = await embeddedProject('emb');
    dolt.mockResolvedValue(ok(JSON.stringify({ rows: JSON.parse(describeJson) })));
    expect(await checkAuditSchema(root, 'embedded')).toBe(true);
    expect(dolt).toHaveBeenCalledWith(
      join(root, '.beads', 'embeddeddolt', 'demo'),
      ['sql', '-r', 'json', '-q', 'DESCRIBE events'],
      expect.objectContaining({ retries: 2 }),
    );
    expect(bd).not.toHaveBeenCalled();
  });

  it.skipIf(!existsSync(join(EMBEDDED_READS, 'sql-describe-events.json')))('accepts the real embedded DESCRIBE output', async () => {
    const root = await embeddedProject('emb');
    dolt.mockResolvedValue(ok(await fixture(EMBEDDED_READS, 'sql-describe-events.json')));
    expect(await checkAuditSchema(root, 'embedded')).toBe(true);
  });

  it.each(['../escape', 'a/b', '..', '', 7])('refuses the embedded database name %j', async (name) => {
    const root = await embeddedProject('bad', { dolt_mode: 'embedded', dolt_database: name });
    expect(await checkAuditSchema(root, 'embedded')).toBe(false);
    expect(dolt).not.toHaveBeenCalled();
  });
});

describe('readAuditEvents', () => {
  it('parses the sql JSON fixture and keeps created_at as bd wrote it', async () => {
    serverAnswers(describeJson, eventsJson);
    const events = await readAuditEvents('/p', 'server', { limit: 50 });
    expect(events).toHaveLength(eventRows.length);
    expect(events![0]).toEqual({
      id: '01a13989-534f-7288-bce3-267994d4b2ae',
      beadId: 'scr-m0h',
      type: 'updated',
      actor: 'Alice Tester',
      oldValue: eventRows[0]!.old_value,
      newValue: '{"priority":1}',
      rawCreatedAt: '2026-10-14T01:31:03Z',
    });
    expect(events!.map((e) => e.rawCreatedAt)).toEqual(eventRows.map((row) => row.created_at));
  });

  it('queries read-only, newest first by created_at then id', async () => {
    serverAnswers(describeJson, '[]');
    await readAuditEvents('/p', 'server', { limit: 25 });
    const [, args] = bd.mock.calls.at(-1)!;
    expect(args.slice(0, 3)).toEqual(['--readonly', 'sql', '--json']);
    expect(args[3]).toBe(
      'SELECT id, issue_id, event_type, actor, old_value, new_value, created_at FROM events ORDER BY created_at DESC, id DESC LIMIT 25',
    );
  });

  it('turns empty and missing values into null', async () => {
    const rows = [
      { id: 'e60585b7-e041-5e39-a552-237e9a1481c1', issue_id: 'a-1', event_type: 'created', actor: '', old_value: '', new_value: null, created_at: '2026-06-22 11:43:12' },
    ];
    serverAnswers(describeJson, JSON.stringify(rows));
    expect(await readAuditEvents('/p', 'server', { limit: 5 })).toEqual([
      { id: rows[0]!.id, beadId: 'a-1', type: 'created', actor: null, oldValue: null, newValue: null, rawCreatedAt: '2026-06-22 11:43:12' },
    ]);
  });

  it('drops rows that are missing an id, bead, type or time', async () => {
    const good = eventRows[0]!;
    const rows = [good, { ...good, id: '' }, { ...good, issue_id: undefined }, { ...good, event_type: 7 }, { ...good, created_at: null }, 'nope'];
    serverAnswers(describeJson, JSON.stringify(rows));
    expect(await readAuditEvents('/p', 'server', { limit: 5 })).toHaveLength(1);
  });

  it('returns an empty list for no rows', async () => {
    serverAnswers(describeJson, '[]');
    expect(await readAuditEvents('/p', 'server', { limit: 5 })).toEqual([]);
    resetAuditSchemaCache();
    serverAnswers(describeJson, 'null');
    expect(await readAuditEvents('/p', 'server', { limit: 5 })).toEqual([]);
  });

  it('treats dolt\'s empty-result output {} as no rows', async () => {
    const root = await embeddedProject('emb');
    dolt.mockImplementation(async (_cwd, args) => ok(args.at(-1) === 'DESCRIBE events' ? JSON.stringify({ rows: JSON.parse(describeJson) }) : '{}\n\n'));
    expect(await readAuditEvents(root, 'embedded', { limit: 5 })).toEqual([]);
  });

  it('reads embedded rows from the dolt {"rows": [...]} wrapper', async () => {
    const root = await embeddedProject('emb');
    dolt.mockImplementation(async (_cwd, args) =>
      ok(JSON.stringify({ rows: args.at(-1) === 'DESCRIBE events' ? JSON.parse(describeJson) : [{ ...eventRows[0], created_at: '2026-10-14 01:31:03' }] })),
    );
    const events = await readAuditEvents(root, 'embedded', { limit: 1 });
    expect(events).toHaveLength(1);
    expect(events![0]!.rawCreatedAt).toBe('2026-10-14 01:31:03');
    const [cwd, args] = dolt.mock.calls.at(-1)!;
    expect(cwd).toBe(join(root, '.beads', 'embeddeddolt', 'demo'));
    expect(args.slice(0, 4)).toEqual(['sql', '-r', 'json', '-q']);
    expect(bd).not.toHaveBeenCalled();
  });

  it.skipIf(!existsSync(join(EMBEDDED_READS, 'sql-events-recent.json')))('parses the real embedded events output', async () => {
    const root = await embeddedProject('emb');
    const real = await fixture(EMBEDDED_READS, 'sql-events-recent.json');
    dolt.mockImplementation(async (_cwd, args) =>
      ok(args.at(-1) === 'DESCRIBE events' ? await fixture(EMBEDDED_READS, 'sql-describe-events.json') : real),
    );
    const events = await readAuditEvents(root, 'embedded', { limit: 50 });
    const rows = (JSON.parse(real) as { rows: unknown[] }).rows;
    expect(events).toHaveLength(rows.length);
    expect(events![0]!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  describe('beadIds', () => {
    it('scopes the query to those beads, newest first', async () => {
      serverAnswers(describeJson, '[]');
      await readAuditEvents('/p', 'server', { limit: 10, beadIds: ['scr-m0h', 'scr-fum.1', 'scr-m0h'] });
      expect(bd.mock.calls.at(-1)![1]).toEqual([
        '--readonly',
        'sql',
        '--json',
        "SELECT id, issue_id, event_type, actor, old_value, new_value, created_at FROM events WHERE issue_id IN ('scr-m0h', 'scr-fum.1') ORDER BY created_at DESC, id DESC LIMIT 10",
      ]);
    });

    it('scopes the embedded query too', async () => {
      const root = await embeddedProject('emb');
      dolt.mockImplementation(async (_cwd, args) => ok(JSON.stringify({ rows: args.at(-1) === 'DESCRIBE events' ? JSON.parse(describeJson) : [] })));
      expect(await readAuditEvents(root, 'embedded', { limit: 5, beadIds: ['a-1'] })).toEqual([]);
      expect(dolt.mock.calls.at(-1)![1].at(-1)).toContain("WHERE issue_id IN ('a-1') ORDER BY");
    });

    it('returns an empty list for no beads without querying', async () => {
      serverAnswers(describeJson, eventsJson);
      expect(await readAuditEvents('/p', 'server', { limit: 10, beadIds: [] })).toEqual([]);
      expect(bd).not.toHaveBeenCalled();
    });

    it('accepts exactly the cap and refuses one more', async () => {
      serverAnswers(describeJson, '[]');
      const ids = (n: number) => Array.from({ length: n }, (_, i) => `scr-${i}`);
      expect(await readAuditEvents('/p', 'server', { limit: 10, beadIds: ids(AUDIT_BEAD_IDS_MAX) })).toEqual([]);
      bd.mockClear();
      expect(await readAuditEvents('/p', 'server', { limit: 10, beadIds: ids(AUDIT_BEAD_IDS_MAX + 1) })).toBeNull();
      expect(bd).not.toHaveBeenCalled();
    });

    it('counts the cap after duplicates are dropped', async () => {
      serverAnswers(describeJson, '[]');
      const unique = Array.from({ length: AUDIT_BEAD_IDS_MAX }, (_, i) => `scr-${i}`);
      expect(await readAuditEvents('/p', 'server', { limit: 10, beadIds: [...unique, 'scr-0', 'scr-1'] })).toEqual([]);
      expect(bd).toHaveBeenCalled();
      bd.mockClear();
      expect(await readAuditEvents('/p', 'server', { limit: 10, beadIds: [...unique, 'scr-new', 'scr-0'] })).toBeNull();
      expect(bd).not.toHaveBeenCalled();
    });

    it.each([["x' OR '1'='1"], ['a b'], [''], ['a'.repeat(129)], ['a;DROP TABLE events'], ['a)--']])('returns null without querying for the id %j', async (bad) => {
      serverAnswers(describeJson, eventsJson);
      expect(await readAuditEvents('/p', 'server', { limit: 10, beadIds: ['scr-ok', bad] })).toBeNull();
      expect(bd).not.toHaveBeenCalled();
    });
  });

  describe('limit', () => {
    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, AUDIT_LIMIT_MAX + 1])('returns null for limit %s', async (limit) => {
      serverAnswers(describeJson, eventsJson);
      expect(await readAuditEvents('/p', 'server', { limit })).toBeNull();
      expect(bd).not.toHaveBeenCalled();
    });

    it('accepts the cap', async () => {
      serverAnswers(describeJson, '[]');
      expect(AUDIT_LIMIT_MAX).toBe(1000);
      expect(await readAuditEvents('/p', 'server', { limit: AUDIT_LIMIT_MAX })).toEqual([]);
      expect(bd.mock.calls.at(-1)![1].at(-1)).toMatch(/LIMIT 1000$/);
    });
  });

  describe('never throws', () => {
    it('returns null and runs no event query when the guard fails', async () => {
      serverAnswers(without('new_value'), eventsJson);
      expect(await readAuditEvents('/p', 'server', { limit: 10 })).toBeNull();
      expect(bd).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['a BdError', () => Promise.reject(new BdError('timeout', 'bd timed out'))],
      ['a spawn failure', () => Promise.reject(new Error('boom'))],
      ['exit 1', () => Promise.resolve({ stdout: '', stderr: 'Error: nope', code: 1 })],
      ['invalid JSON', () => Promise.resolve(ok('not json'))],
      ['rows in an unexpected shape', () => Promise.resolve(ok('{"nope":1}'))],
    ])('returns null when the event query fails with %s', async (_name, fail) => {
      bd.mockImplementation(async (_dir, args) => (args.at(-1) === 'DESCRIBE events' ? ok(describeJson) : fail()));
      expect(await readAuditEvents('/p', 'server', { limit: 10 })).toBeNull();
    });
  });
});

describe('eventTimeMs', () => {
  const event = (id: string): AuditEvent => ({ id, beadId: 'a-1', type: 'updated', actor: null, oldValue: null, newValue: null, rawCreatedAt: '' });

  it('reads the UTC time from a UUIDv7 id', () => {
    expect(new Date(eventTimeMs(event('01a13989-534f-7288-bce3-267994d4b2ae'))!).toISOString()).toBe('2026-10-14T08:31:03.503Z');
  });

  it('is null for an imported UUIDv5 id', () => {
    expect(eventTimeMs(event('e60585b7-e041-5e39-a552-237e9a1481c1'))).toBeNull();
  });

  it('is null for anything that is not a UUID', () => {
    expect(eventTimeMs(event('1234'))).toBeNull();
    expect(eventTimeMs(event(''))).toBeNull();
  });
});
