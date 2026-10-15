import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkAuditSchema, eventTimeMs, readAuditEvents, readUtcSince, resetAuditSchemaCache, storeWritesUtc } from '../../src/service/bd/audit';
import { childEnv, runBd, runBdJson } from '../../src/service/bd/exec';
import { readMetadata } from '../../src/service/workspace';

const run = promisify(execFile);

// Real bd and dolt, in a scratch project under the OS temp dir. Never a real project.
describe.skipIf(process.env.BD_INTEGRATION !== '1')('audit log (embedded bd)', () => {
  let root: string;
  let beadId: string;
  let otherBeadId: string;

  async function bd(args: string[]): Promise<void> {
    const result = await runBd(root, args);
    if (result.code !== 0) throw new Error(`bd ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'oc-beads-audit-int-')));
    await run('git', ['init', '-q'], { cwd: root, env: childEnv() });
    await bd(['init', '--prefix', 'aud', '--non-interactive', '--quiet']);
    const created = await runBdJson<{ id: string }>(root, ['create', 'First bead', '-t', 'task', '-p', '2', '--actor', 'Alice (panel)', '--json']);
    beadId = created.id;
    await bd(['update', beadId, '--priority', '1', '--actor', 'Bob (panel)']);
    await bd(['close', beadId, '--reason', 'done', '--actor', 'Alice (panel)']);
    // A second bead with its own events, so scoping to one bead has something to leave out.
    const other = await runBdJson<{ id: string }>(root, ['create', 'Second bead', '-t', 'task', '-p', '3', '--actor', 'Carol (panel)', '--json']);
    otherBeadId = other.id;
    await bd(['update', otherBeadId, '--priority', '2', '--actor', 'Carol (panel)']);
  }, 60_000);

  afterAll(async () => {
    resetAuditSchemaCache();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('is an embedded project the guard accepts', async () => {
    expect((await readMetadata(root))?.dolt_mode).toBe('embedded');
    expect(await checkAuditSchema(root, 'embedded')).toBe(true);
  });

  it('reads who changed each field, newest first', async () => {
    const events = await readAuditEvents(root, 'embedded', { limit: 50 });
    expect(events).not.toBeNull();
    const mine = events!.filter((event) => event.beadId === beadId);
    expect(mine.map((event) => event.type)).toEqual(expect.arrayContaining(['created', 'updated', 'closed']));

    const updated = mine.find((event) => event.type === 'updated')!;
    expect(updated.actor).toBe('Bob (panel)');
    expect(JSON.parse(updated.newValue!)).toEqual({ priority: 1 });

    const closed = mine.find((event) => event.type === 'closed')!;
    expect(closed.actor).toBe('Alice (panel)');
    expect(closed.newValue).toBe('done');

    // created_at ties within a second are broken by id, so order is stable but newest-first overall.
    const raw = events!.map((event) => event.rawCreatedAt);
    expect([...raw].sort().reverse()).toEqual(raw);
  });

  // bd 1.2 ids carry the time (UUIDv7); bd 1.3 ids do not (UUIDv5), but it writes created_at in UTC.
  it('dates events in real UTC', async () => {
    const version = (await runBd(root, ['--version'])).stdout;
    const events = (await readAuditEvents(root, 'embedded', { limit: 50, utcCreatedAt: storeWritesUtc(version) }))!;
    const times = events.map(eventTimeMs);
    expect(times.every((time) => time !== null)).toBe(true);
    for (const time of times) expect(Math.abs(Date.now() - time!)).toBeLessThan(10 * 60_000);
  });

  // The real binary writes per-migration commits at init, so the 0062 commit is there; a bd that stopped would untime every 1.3 event.
  it('finds the 0062 migration commit, dated no later than the first event', async () => {
    const since = await readUtcSince(root, 'embedded');
    expect(since).not.toBeNull();
    const events = (await readAuditEvents(root, 'embedded', { limit: 50, utcCreatedAt: true }))!;
    const first = Math.min(...events.map((event) => eventTimeMs(event)!));
    expect(since!).toBeLessThanOrEqual(first + 1000);
    expect(events.every((event) => eventTimeMs(event) !== null)).toBe(true);
  });

  it('scopes to one bead and keeps its newest event when the page is full', async () => {
    // Unscoped, the other bead's events are there; scoped, none of them are.
    const unscoped = (await readAuditEvents(root, 'embedded', { limit: 50 }))!;
    expect(unscoped.some((event) => event.beadId === otherBeadId)).toBe(true);
    const all = (await readAuditEvents(root, 'embedded', { limit: 50, beadIds: [beadId] }))!;
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.some((event) => event.beadId === otherBeadId)).toBe(false);
    expect(all.every((event) => event.beadId === beadId)).toBe(true);

    const [newest] = (await readAuditEvents(root, 'embedded', { limit: 1, beadIds: [beadId] }))!;
    expect(newest).toEqual(all[0]);

    expect(await readAuditEvents(root, 'embedded', { limit: 50, beadIds: ['aud-nonexistent'] })).toEqual([]);
  });

  it('honors the limit', async () => {
    expect(await readAuditEvents(root, 'embedded', { limit: 1 })).toHaveLength(1);
  });
});
