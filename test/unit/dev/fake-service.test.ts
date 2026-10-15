import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeService, directoryOf, type EventsMode } from '../../../dev/fake-service';
import type { ApiRouteName, MemoriesResult } from '../../../src/shared/api';
import type { Bead, HistoryResult, SnapshotResponse } from '../../../src/shared/types';

const directory = directoryOf('needs');

type Service = ReturnType<typeof createFakeService>;
const call = async <T>(service: Service, route: ApiRouteName, body: Record<string, unknown> = {}): Promise<{ status: number; json: T }> => {
  const out = await service.handle(route, { directory, ...body });
  return { status: out.status, json: JSON.parse(out.body) as T };
};
const full = async (service: Service) => (await call<Extract<SnapshotResponse, { unchanged: false }>>(service, 'snapshot')).json;

// Every route the panel can call, so a route added to the service without a fake answer fails here.
const NEW_ROUTES: Array<[ApiRouteName, Record<string, unknown>]> = [
  ['gateCreate', { id: 'scr-prk' }],
  ['gateResolve', { gateId: 'scr-gate-1' }],
  ['humanRespond', { id: 'scr-ask', response: 'eu-west' }],
  ['humanDismiss', { id: 'scr-ask' }],
  ['history', { id: 'scr-rev' }],
  ['memories', {}],
  ['memoryRemember', { text: 'A note' }],
  ['memoryForget', { key: 'no-force-push', expectedText: 'x' }],
  ['deferBead', { id: 'scr-prk', expectedUpdatedAt: 'x', until: null }],
  ['undeferBead', { id: 'scr-prk', expectedUpdatedAt: 'x' }],
  ['supersede', { id: 'scr-prk', with: 'scr-qt1', expectedUpdatedAt: 'x' }],
  ['duplicate', { id: 'scr-prk', of: 'scr-qt1', expectedUpdatedAt: 'x' }],
  ['explain', { id: 'scr-rev' }],
  ['eventsStatus', {}],
  ['enableEvents', { confirm: true }],
];

describe('fake service: the 0.2 routes', () => {
  it('answers every new route, none as an unknown route', async () => {
    for (const [route, body] of NEW_ROUTES) {
      const { json } = await call<{ error?: { code: string } }>(createFakeService(), route, body);
      expect(json.error?.code, route).not.toBe('NOT_FOUND');
    }
  });

  it('with an old Beads, every new route answers unsupported (501) except the events status', async () => {
    const service = createFakeService({ oldBeads: () => true });
    for (const [route, body] of NEW_ROUTES) {
      const { status, json } = await call<{ error?: { code: string }; available?: boolean }>(service, route, body);
      if (route === 'eventsStatus') expect(json.available).toBe(false);
      else {
        expect(status, route).toBe(501);
        expect(json.error?.code, route).toBe('unsupported');
      }
    }
    const snap = await full(service);
    expect(snap.capabilities).toEqual({ eventsJournal: false, leases: false });
    expect(snap.leases).toEqual([]);
  });

  it('the needs scenario has a gate, an expired lease, a human request and quiet beads', async () => {
    const snap = await full(createFakeService());
    expect(snap.capabilities.leases).toBe(true);
    // A plan approval, a review and a timer, all on one bead.
    expect(snap.gates.map((g) => g.blocks)).toEqual([['scr-rev'], ['scr-rev'], ['scr-rev']]);
    expect(snap.gates.map((g) => [g.kind, g.planApproval])).toEqual([['human', true], ['human', false], ['timer', false]]);
    expect(snap.leases[0]!.beadId).toBe('scr-lse');
    expect(Date.parse(snap.leases[0]!.expiresAt)).toBeLessThan(Date.now());
    expect(snap.beads.filter((b) => b.labels.includes('human')).map((b) => b.id)).toEqual(['scr-ask', 'scr-ask2']);
    expect(snap.readyIds).not.toContain('scr-rev');
  });

  it('answering a human request closes it with the answer as a comment; answering twice says not-open', async () => {
    const service = createFakeService();
    const first = await call<{ ok: boolean; bead: Bead }>(service, 'humanRespond', { id: 'scr-ask', response: 'eu-west' });
    expect(first.json.ok).toBe(true);
    expect(first.json.bead.status).toBe('closed');
    expect(first.json.bead.comments.at(-1)?.text).toBe('eu-west');
    const second = await call<{ ok: boolean; code: string }>(service, 'humanDismiss', { id: 'scr-ask' });
    expect(second.json).toMatchObject({ ok: false, code: 'not-open' });
  });

  it('resolving a gate takes it out of the snapshot; resolving it again says already-resolved', async () => {
    const service = createFakeService();
    expect((await call<{ ok: boolean }>(service, 'gateResolve', { gateId: 'scr-gate-1' })).json.ok).toBe(true);
    expect((await full(service)).gates.map((g) => g.id)).not.toContain('scr-gate-1');
    expect((await call<{ ok: boolean; code: string }>(service, 'gateResolve', { gateId: 'scr-gate-1' })).json).toMatchObject({ ok: false, code: 'already-resolved' });
  });

  it('asking for a review twice says already-open the second time', async () => {
    const service = createFakeService();
    const one = await call<{ ok: boolean }>(service, 'gateCreate', { id: 'scr-prk' });
    const two = await call<{ ok: boolean; code: string }>(service, 'gateCreate', { id: 'scr-prk' });
    expect(one.json.ok).toBe(true);
    expect(two.json).toMatchObject({ ok: false, code: 'already-open' });
  });

  it('history has restorable and non-restorable changes, a gate entry and the creation, and pages', async () => {
    const service = createFakeService();
    const all = (await call<HistoryResult>(service, 'history', { id: 'scr-rev' })).json;
    expect(all.entries.some((e) => e.restorable.length > 0)).toBe(true);
    expect(all.entries.some((e) => e.changes.some((c) => c.truncated))).toBe(true);
    expect(all.entries.some((e) => e.gate)).toBe(true);
    expect(all.entries.at(-1)?.created).toBe(true);
    const page = (await call<HistoryResult>(service, 'history', { id: 'scr-rev', limit: 2 })).json;
    expect(page.entries).toHaveLength(2);
    expect(page.more).toBe(true);
    const next = (await call<HistoryResult>(service, 'history', { id: 'scr-rev', limit: 2, before: page.entries[1]!.id })).json;
    expect(next.entries[0]!.id).toBe(all.entries[2]!.id);
  });

  it('keeps five memories, searches them, and refuses a stale edit', async () => {
    const service = createFakeService();
    const list = (await call<MemoriesResult>(service, 'memories')).json;
    expect(list.memories).toHaveLength(5);
    expect((await call<MemoriesResult>(service, 'memories', { query: 'STAGING' })).json.memories.map((m) => m.key)).toEqual(['staging-region']);
    const stale = await call<{ ok: boolean; code: string }>(service, 'memoryForget', { key: 'no-force-push', expectedText: 'not what is stored' });
    expect(stale.json).toMatchObject({ ok: false, code: 'changed' });
    const stored = list.memories.find((m) => m.key === 'no-force-push')!;
    expect((await call<{ ok: boolean }>(service, 'memoryForget', { key: stored.key, expectedText: stored.text })).json.ok).toBe(true);
    expect((await call<MemoriesResult>(service, 'memories')).json.memories).toHaveLength(4);
  });

  it('defer sets the bead aside and undefer brings it back', async () => {
    const service = createFakeService();
    const bead = (await full(service)).beads.find((b) => b.id === 'scr-prk')!;
    const deferred = await call<{ ok: boolean; bead: Bead }>(service, 'deferBead', { id: 'scr-prk', expectedUpdatedAt: bead.updatedAt, until: '2030-01-01' });
    expect(deferred.json.bead.status).toBe('deferred');
    expect(deferred.json.bead.extra.defer_until).toBe('2030-01-01T00:00:00.000Z');
    const back = await call<{ ok: boolean; bead: Bead }>(service, 'undeferBead', { id: 'scr-prk', expectedUpdatedAt: deferred.json.bead.updatedAt });
    expect(back.json.bead.status).toBe('open');
    expect(back.json.bead.extra.defer_until).toBeUndefined();
  });

  it('shows an events status of each kind', async () => {
    const modes: EventsMode[] = ['unavailable', 'journal-off', 'journal-unknown', 'starting', 'following', 'backoff', 'failed'];
    const seen = new Set<string>();
    for (const mode of modes) {
      const { json } = await call<{ available: boolean; journal: string; live: string }>(createFakeService({ events: () => mode }), 'eventsStatus');
      seen.add(`${json.available}/${json.journal}/${json.live}`);
    }
    expect(seen.size).toBe(modes.length);
  });

  it('enabling live updates needs the confirmation, then reads as on', async () => {
    const service = createFakeService({ events: () => 'journal-off' });
    expect((await call<{ error: { code: string } }>(service, 'enableEvents', {})).json.error.code).toBe('invalid');
    const done = await call<{ ok: boolean; status: { journal: string } }>(service, 'enableEvents', { confirm: true });
    expect(done.json.status.journal).toBe('on');
  });
});

describe('fake service: a project store that needs an update (schema=old)', () => {
  type Snap = Extract<SnapshotResponse, { unchanged: false }>;

  it('reads as the needs-update state: no beads, the plain copy, the raw stderr and both versions', async () => {
    const snap = await full(createFakeService({ oldSchema: () => true }));
    expect(snap.beads).toEqual([]);
    expect(snap.freshness.localError).toBe('This project needs a one-time update for the newer Beads.');
    expect(snap.freshness.localErrorDetail).toContain('schema version mismatch: database is at v32, binary expects v66');
    expect(snap.freshness.schemaUpdate).toEqual({ from: 32, to: 66 });
    const current = await full(createFakeService());
    expect(current.freshness.schemaUpdate).toBeNull();
    expect(current.beads.length).toBeGreaterThan(0);
  });

  it('other reads answer 409 needs-schema-update with the versions', async () => {
    const { status, json } = await call<{ error: { code: string; schemaUpdate: unknown } }>(createFakeService({ oldSchema: () => true }), 'bead', { id: 'scr-prk' });
    expect(status).toBe(409);
    expect(json.error).toMatchObject({ code: 'needs-schema-update', schemaUpdate: { from: 32, to: 66 } });
  });

  // The update is a background job: it answers at once and ends a moment later. Only the clock moves.
  const later = (ms = 3_000) => vi.setSystemTime(Date.now() + ms);
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());

  it('the update needs the literal confirm; then it answers at once, shows as running, and the snapshot after it ends reads normally', async () => {
    const service = createFakeService({ oldSchema: () => true });
    expect((await call<{ error: { code: string } }>(service, 'migrateSchema', {})).json.error.code).toBe('BAD_REQUEST');
    expect((await call<{ error: { code: string } }>(service, 'migrateSchema', { confirm: 'true' })).status).toBe(400);
    expect((await full(service)).freshness.schemaUpdate).not.toBeNull();
    expect((await call<{ ok: boolean }>(service, 'migrateSchema', { confirm: true })).json).toEqual({ ok: true });
    const meanwhile = await full(service);
    expect(meanwhile.freshness.schemaUpdate).not.toBeNull();
    expect(meanwhile.freshness.schemaUpdateJob).toMatchObject({ kind: 'running' });
    expect(meanwhile.beads).toEqual([]);
    later();
    const after = await full(service);
    expect(after.freshness.schemaUpdate).toBeNull();
    expect(after.freshness.schemaUpdateJob ?? null).toBeNull();
    expect(after.beads.length).toBeGreaterThan(0);
  });

  it('every write is refused 409 needs-schema-update while the project is old', async () => {
    const service = createFakeService({ oldSchema: () => true });
    for (const route of ['comment', 'create', 'update', 'enableEvents'] as const) {
      const res = await call<{ error: { code: string } }>(service, route, { id: 'scr-prk', text: 'x', confirm: true });
      expect([route, res.status, res.json.error.code]).toEqual([route, 409, 'needs-schema-update']);
    }
  });

  it('a store shared with the team ends the job as update-blocked-shared and stays old', async () => {
    const service = createFakeService({ oldSchema: () => true, sharedSchema: () => true });
    expect((await call<{ ok: boolean }>(service, 'migrateSchema', { confirm: true })).json).toEqual({ ok: true });
    later();
    const snap = (await full(service)) as Snap;
    expect(snap.freshness.schemaUpdate).not.toBeNull();
    expect(snap.freshness.schemaUpdateJob).toMatchObject({ kind: 'failed', code: 'update-blocked-shared', message: expect.stringMatching(/shares its beads with your team/) });
    const failed = snap.freshness.schemaUpdateJob;
    expect(failed && failed.kind === 'failed' ? failed.detail : '').toContain('remote-backed database');
  });

  it('honors the write modes: refused ends the job failed and leaves the project old, uncertain leaves a project that reads as updated', async () => {
    let mode: 'busy' | 'uncertain' = 'busy';
    const service = createFakeService({ oldSchema: () => true, writes: () => mode });
    await call(service, 'migrateSchema', { confirm: true });
    later();
    const busy = (await full(service)) as Snap;
    expect(busy.freshness.schemaUpdateJob).toMatchObject({ kind: 'failed', code: 'busy' });
    expect(busy.freshness.schemaUpdate).not.toBeNull();
    mode = 'uncertain';
    await call(service, 'migrateSchema', { confirm: true });
    later();
    const unsure = (await full(service)) as Snap;
    expect(unsure.freshness.schemaUpdate).toBeNull();
  });
});
