import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/service/bd/exec', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/service/bd/exec')>()),
  runBd: vi.fn(),
  runBdJson: vi.fn(),
  runDolt: vi.fn(),
  runGit: vi.fn(),
}));
vi.mock('../../../src/service/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/service/workspace')>()),
  detectWorkspace: vi.fn(),
}));
vi.mock('../../../src/service/bd/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/service/bd/audit')>()),
  readAuditEvents: vi.fn(),
  runSql: vi.fn(),
}));

import { notePanelWrite, resetPanelActorCache } from '../../../src/service/bd/adapter';
import { readAuditEvents, runSql, type AuditEvent } from '../../../src/service/bd/audit';
import { runBd, runBdJson, runDolt, runGit } from '../../../src/service/bd/exec';
import { parseExport } from '../../../src/service/bd/parse';
import { getSnapshot, projectStore, resetSnapshotState, setClock, setStorageDir } from '../../../src/service/snapshot';
import { detectWorkspace } from '../../../src/service/workspace';
import type { SnapshotResponse, WorkspaceState } from '../../../src/shared/types';

const bd = vi.mocked(runBd);
const bdJson = vi.mocked(runBdJson);
const dolt = vi.mocked(runDolt);
const git = vi.mocked(runGit);
const detect = vi.mocked(detectWorkspace);
const auditRead = vi.mocked(readAuditEvents);
const sql = vi.mocked(runSql);

const ok = (stdout: string) => ({ stdout, stderr: '', code: 0 });
const STATUSES = JSON.stringify({ built_in_statuses: [{ name: 'open', category: 'active', icon: 'o' }] });
const TYPES = JSON.stringify({ core_types: [{ name: 'task', description: '' }] });
const WITH_GATE = readFileSync(join(__dirname, '../../fixtures/bd13/export-with-gate.txt'), 'utf8');
const LEASE_SQL = /FROM leases/i;

let tmp: string;
let root: string;
let now: number;
let exportText: string;
let readyIds: string[];
let leaseRows: Array<Record<string, unknown>> | Error;
let leaseReads: number;
const T0 = Date.parse('2026-10-15T10:00:00.000Z');

function workspace(bdVersion: string): WorkspaceState {
  return { kind: 'ok', root, mode: 'embedded', bdVersion, hasRemote: false, projectName: 'demo' };
}

function full(res: SnapshotResponse): Extract<SnapshotResponse, { unchanged: false }> {
  if (res.unchanged) throw new Error('expected a full snapshot');
  return res;
}

/** Re-reads: past the 4 s throttle, and past the minute pass too. */
async function nextMinute(cursor?: string): Promise<SnapshotResponse> {
  now += 61_000;
  return getSnapshot(root, cursor);
}

function gateAudit(): AuditEvent[] {
  return [
    { id: 'e1', beadId: 'pl-ox2', type: 'created', actor: 'Tester (panel)', oldValue: null, newValue: null, rawCreatedAt: '2026-10-15 05:36:30' },
    { id: 'e2', beadId: 'pl-sex', type: 'updated', actor: 'tester', oldValue: null, newValue: '{"title":"Task A"}', rawCreatedAt: '2026-10-15 05:36:31' },
  ];
}

beforeEach(async () => {
  for (const mock of [bd, bdJson, dolt, git, detect, auditRead, sql]) mock.mockReset();
  resetPanelActorCache();
  resetSnapshotState();
  tmp = await mkdtemp(join(tmpdir(), 'oc-beads-gates-'));
  root = join(tmp, 'proj');
  await mkdir(join(root, '.beads'), { recursive: true });
  await writeFile(join(root, '.beads', 'metadata.json'), JSON.stringify({ dolt_mode: 'embedded', dolt_database: 'testdb' }));
  setStorageDir(join(tmp, 'state'));
  now = T0;
  setClock(() => now);
  exportText = WITH_GATE;
  readyIds = ['pl-b9p', 'pl-2n0'];
  leaseRows = [];
  leaseReads = 0;
  auditRead.mockResolvedValue(gateAudit());
  bdJson.mockImplementation(async (dir, args, opts) => JSON.parse((await bd(dir, args, opts)).stdout) as never);
  bd.mockImplementation(async (_dir, args) => {
    const plain = args[0] === '--actor' ? args.slice(2) : args;
    const name = plain.find((a) => !a.startsWith('-'));
    if (name === 'export') return ok(exportText);
    if (name === 'statuses') return ok(STATUSES);
    if (name === 'types') return ok(TYPES);
    if (name === 'ready') return ok(JSON.stringify(readyIds.map((id) => ({ id, title: id, status: 'open', priority: 2, issue_type: 'task', created_at: '2026-10-15T05:36:24Z', updated_at: '2026-10-15T05:36:24Z' }))));
    throw new Error(`unexpected bd call: ${args.join(' ')}`);
  });
  git.mockResolvedValue(ok('Ann\n'));
  dolt.mockResolvedValue(ok('{}'));
  sql.mockImplementation(async (_root, _mode, query) => {
    if (LEASE_SQL.test(query)) {
      leaseReads += 1;
      if (leaseRows instanceof Error) throw leaseRows;
      return leaseRows;
    }
    throw new Error(`unexpected sql: ${query}`);
  });
  detect.mockResolvedValue(workspace('1.3.1'));
});

afterEach(async () => {
  setClock(null);
  setStorageDir(null);
  resetSnapshotState();
  await rm(tmp, { recursive: true, force: true });
});

describe('gate rows in the snapshot', () => {
  it('gate rows never reach beads, counts, unseen or activity', async () => {
    const first = full(await getSnapshot(root));
    expect(first.beads.map((b) => b.id)).toEqual(['pl-b9p', 'pl-2n0', 'pl-sex']);
    expect(first.readyIds).toEqual(['pl-b9p', 'pl-2n0']);
    expect(first.unseenIds).toEqual([]);
    // The first read backfills from the audit log: a gate's own events are not rows.
    expect(first.activity.map((e) => e.beadId)).not.toContain('pl-ox2');

    // The agent touches the gate row and a task; the gate is no news, the task is.
    exportText = exportText.replace('"updated_at":"2026-10-15T05:36:30Z","await_type"', '"updated_at":"2026-10-15T09:00:00Z","await_type"').replace('"title":"Task B"', '"title":"Task B2"').replace('"updated_at":"2026-10-15T05:36:24Z","dependency_count":0,"dependent_count":0,"comment_count":0}\n{"_type":"issue","id":"pl-sex"', '"updated_at":"2026-10-15T09:00:00Z","dependency_count":0,"dependent_count":0,"comment_count":0}\n{"_type":"issue","id":"pl-sex"');
    readyIds = ['pl-b9p', 'pl-ox2'];
    const next = full(await nextMinute(first.cursor));
    expect(next.beads.map((b) => b.id)).not.toContain('pl-ox2');
    expect(next.readyIds).toEqual(['pl-b9p']);
    expect(next.unseenIds).toEqual(['pl-2n0']);
    expect(next.activity.map((e) => e.beadId)).not.toContain('pl-ox2');
    expect(next.activity.find((e) => !e.historical)?.beadId).toBe('pl-2n0');
  });

  it('gates lists only open gates with their blocked beads, and gateIds lists every gate', async () => {
    const res = full(await getSnapshot(root));
    expect(res.gates).toEqual([
      expect.objectContaining({ id: 'pl-ox2', kind: 'human', reason: 'Review before closing', blocks: ['pl-sex'], planApproval: false }),
    ]);
    expect(res.gateIds).toEqual(['pl-ox2']);
  });

  it('resolved gate leaves the gates list while its edge stays on the bead, and no deletion appears', async () => {
    const first = full(await getSnapshot(root));
    exportText = exportText.replace('"status":"open","priority":2,"issue_type":"gate"', '"status":"closed","priority":2,"issue_type":"gate"');
    const next = full(await nextMinute(first.cursor));
    expect(next.gates).toEqual([]);
    expect(next.gateIds).toEqual(['pl-ox2']);
    expect(next.beads.find((b) => b.id === 'pl-sex')?.dependencies.map((d) => d.to)).toEqual(['pl-ox2']);
    // The agent's resolve is news on the bead it held (the bead's own version did not move).
    expect(next.unseenIds).toEqual(['pl-sex']);
    // The gate resolving is the only news: no dependency or deletion rows.
    expect(next.activity.filter((e) => !e.historical).map((e) => [e.kind, e.beadId, e.gateId])).toEqual([['gate_resolved', 'pl-sex', 'pl-ox2']]);
  });
});

const RESOLVED = (text: string): string => text.replace('"status":"open","priority":2,"issue_type":"gate"', '"status":"closed","priority":2,"issue_type":"gate"');
const closedAudit = (actor: string): AuditEvent => ({ id: 'e9', beadId: 'pl-ox2', type: 'closed', actor, oldValue: null, newValue: 'Looks fine', rawCreatedAt: '2026-10-15 10:00:30' });
const OTHER_GATE = `${JSON.stringify({ _type: 'issue', id: 'pl-g2', title: 'Gate: human', description: 'x\n\nReason: Check the numbers', status: 'open', priority: 2, issue_type: 'gate', created_by: 'Claude Code', created_at: '2026-10-15T08:00:00Z', updated_at: '2026-10-15T08:00:00Z', await_type: 'human' })}\n`;
const EDGE_TO_G2 = '"dependencies":[{"issue_id":"pl-2n0","depends_on_id":"pl-g2","type":"blocks","created_at":"2026-10-15T08:00:00Z","created_by":"Claude Code","metadata":"{}"}],';

/** The fixture with a second gate, pl-g2, opened by an agent on pl-2n0. */
function withSecondGate(text: string): string {
  return text.replace('"issue_type":"task","owner":"user@example.com","created_at":"2026-10-15T05:36:24Z","created_by":"tester","updated_at":"2026-10-15T05:36:24Z","dependency_count":0,"dependent_count":0,"comment_count":0}\n{"_type":"issue","id":"pl-sex"', `"issue_type":"task","owner":"user@example.com","created_at":"2026-10-15T05:36:24Z","created_by":"tester","updated_at":"2026-10-15T09:00:00Z",${EDGE_TO_G2}"dependency_count":1,"dependent_count":0,"comment_count":0}\n{"_type":"issue","id":"pl-sex"`) + OTHER_GATE;
}

describe('gate activity', () => {
  const rows = (res: SnapshotResponse) => full(res).activity.filter((e) => !e.historical);

  it('an agent resolving a gate gives a row with the agent as actor, not the panel', async () => {
    const first = full(await getSnapshot(root));
    exportText = RESOLVED(exportText);
    auditRead.mockResolvedValue([closedAudit('Claude Code'), ...gateAudit()]);
    const [row] = rows(await nextMinute(first.cursor));
    expect(row).toMatchObject({ kind: 'gate_resolved', beadId: 'pl-sex', gateId: 'pl-ox2', reason: 'Review before closing', actor: 'Claude Code', byPanel: false, unseen: true, gateKind: 'human' });
    // A real resolve is the plain case: no `ended`.
    expect(row).not.toHaveProperty('ended');
  });

  it('a gate resolved with no audit event has no actor', async () => {
    const first = full(await getSnapshot(root));
    exportText = RESOLVED(exportText);
    const [row] = rows(await nextMinute(first.cursor));
    expect(row).toMatchObject({ kind: 'gate_resolved', actor: null, byPanel: false });
  });

  it('a gate resolved by the panel is byPanel, and does not wait on the audit log for its credit', async () => {
    const first = full(await getSnapshot(root));
    exportText = RESOLVED(exportText);
    auditRead.mockResolvedValue([closedAudit('Ann (panel)'), ...gateAudit()]);
    const [row] = rows(await nextMinute(first.cursor));
    expect(row).toMatchObject({ kind: 'gate_resolved', actor: 'Ann (panel)', byPanel: true });
  });

  it('another person\'s panel name is not the panel', async () => {
    const first = full(await getSnapshot(root));
    exportText = RESOLVED(exportText);
    auditRead.mockResolvedValue([closedAudit('Bob (panel)'), ...gateAudit()]);
    expect(rows(await nextMinute(first.cursor))[0]).toMatchObject({ actor: 'Bob (panel)', byPanel: false });
  });

  it('a gate opened by an agent gives a row naming its creator, with the gate id and reason, and no dependency row', async () => {
    const first = full(await getSnapshot(root));
    exportText = withSecondGate(exportText);
    const res = rows(await nextMinute(first.cursor));
    expect(res.map((e) => [e.kind, e.beadId, e.gateId, e.reason, e.actor, e.byPanel])).toEqual([['gate_opened', 'pl-2n0', 'pl-g2', 'Check the numbers', 'Claude Code', false]]);
  });

  it('the first read of a project does not flag gates already open', async () => {
    const first = full(await getSnapshot(root));
    expect(first.activity.filter((e) => e.kind === 'gate_opened' || e.kind === 'gate_resolved')).toEqual([]);
    expect(first.gates).toHaveLength(1);
    // And the next read with nothing moved still has none.
    exportText = exportText.replace('"title":"Task B"', '"title":"Task B2"');
    const next = full(await nextMinute(first.cursor));
    expect(next.activity.filter((e) => e.kind === 'gate_opened' || e.kind === 'gate_resolved')).toEqual([]);
  });

  /** Writes the project's state file the way 0.1 left it: no gate list, and (as 0.1 kept them) the gate rows among the beads of its last read. */
  async function as01File(lastRead: string): Promise<void> {
    const path = join(tmp, 'state', `${createHash('sha1').update(root).digest('hex')}.json`);
    const saved = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    delete saved.openGates;
    saved.snapshot = parseExport(lastRead);
    await writeFile(path, JSON.stringify(saved));
    resetSnapshotState();
  }

  it('a state file from 0.1 whose last read already had the gate: an open gate is no news, a later resolve is', async () => {
    await getSnapshot(root);
    await as01File(WITH_GATE);
    const again = full(await nextMinute());
    expect(again.activity.filter((e) => e.kind === 'gate_opened')).toEqual([]);
    exportText = RESOLVED(exportText);
    expect(rows(await nextMinute(again.cursor)).map((e) => e.kind)).toEqual(['gate_resolved']);
  });

  it('a state file from 0.1 with no gate rows to read takes a gate baseline: an open gate is no news, a later resolve is', async () => {
    await getSnapshot(root);
    const path = join(tmp, 'state', `${createHash('sha1').update(root).digest('hex')}.json`);
    const saved = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    delete saved.openGates;
    saved.snapshot = null;
    await writeFile(path, JSON.stringify(saved));
    resetSnapshotState();
    const again = full(await nextMinute());
    expect(again.activity.filter((e) => e.kind === 'gate_opened')).toEqual([]);
    exportText = RESOLVED(exportText);
    expect(rows(await nextMinute(again.cursor)).map((e) => e.kind)).toEqual(['gate_resolved']);
  });

  it('a 0.1 file that held the gate rows tells what changed since: a gate resolved after the last 0.1 read gives its row', async () => {
    await getSnapshot(root);
    await as01File(WITH_GATE);
    exportText = RESOLVED(exportText);
    auditRead.mockResolvedValue([closedAudit('Claude Code'), ...gateAudit()]);
    const res = rows(await nextMinute());
    expect(res.map((e) => [e.kind, e.beadId, e.gateId, e.actor, e.byPanel])).toEqual([['gate_resolved', 'pl-sex', 'pl-ox2', 'Claude Code', false]]);
  });

  it('a 0.1 file read before an agent opened and resolved gates still shows them: one open, one opened and resolved between reads', async () => {
    // What 0.1 last saw: no gates at all.
    const bare = editRows(WITH_GATE, (r) => (r.id === 'pl-ox2' ? null : { ...r, dependencies: undefined, dependency_count: 0 }));
    exportText = bare;
    await getSnapshot(root);
    await as01File(bare);
    // Then the agent made a gate on pl-sex (still open) and another on pl-2n0 that it resolved at once.
    exportText = editRows(withSecondGate(WITH_GATE), (r) => (r.id === 'pl-g2' ? { ...r, status: 'closed' } : r));
    auditRead.mockResolvedValue([{ id: 'e7', beadId: 'pl-g2', type: 'closed', actor: 'Claude Code', oldValue: null, newValue: 'Looked fine', rawCreatedAt: '2026-10-15 10:00:30' }, ...gateAudit()]);
    const res = full(await nextMinute());
    const mine = res.activity.filter((e) => !e.historical);
    expect(mine.map((e) => [e.kind, e.beadId, e.gateId, e.actor, e.unseen]).sort()).toEqual(
      [
        ['gate_opened', 'pl-2n0', 'pl-g2', 'Claude Code', true],
        ['gate_opened', 'pl-sex', 'pl-ox2', 'Tester (panel)', true],
        ['gate_resolved', 'pl-2n0', 'pl-g2', 'Claude Code', true],
      ].sort(),
    );
    // No "unexplained" bead: both have a row, and no dependency row names a gate.
    expect(mine.some((e) => e.kind === 'dep_added')).toBe(false);
  });

  it('the open gates are saved, so a gate resolved while the service was down still gives its row', async () => {
    await getSnapshot(root);
    resetSnapshotState();
    exportText = RESOLVED(exportText);
    expect(rows(await nextMinute()).map((e) => [e.kind, e.gateId])).toEqual([['gate_resolved', 'pl-ox2']]);
  });

  it('the seen answer and the snapshot list the same unseen beads: opening another bead does not drop one with an agent review row', async () => {
    const first = full(await getSnapshot(root));
    exportText = editRows(RESOLVED(exportText), (r) => (r.id === 'pl-2n0' ? { ...r, title: 'Task B2', updated_at: '2026-10-15T09:00:00Z' } : r));
    const next = full(await nextMinute(first.cursor));
    expect(next.unseenIds.sort()).toEqual(['pl-2n0', 'pl-sex']);
    const store = await projectStore(root);
    store.markSeen(['pl-2n0'], new Date(now + 1).toISOString());
    expect(store.allUnseenIds()).toEqual(['pl-sex']);
    expect(full(await getSnapshot(root)).unseenIds).toEqual(store.allUnseenIds());
  });

  it('a gate event by an agent is unseen until marked seen, and puts the bead in the unseen set', async () => {
    const first = full(await getSnapshot(root));
    exportText = RESOLVED(exportText);
    const next = full(await nextMinute(first.cursor));
    expect(rows(next)[0]?.unseen).toBe(true);
    expect(next.unseenIds).toEqual(['pl-sex']);
    (await projectStore(root)).markSeen(['pl-sex'], new Date(now + 1).toISOString());
    const seen = full(await getSnapshot(root));
    expect(rows(seen)[0]?.unseen).toBe(false);
    expect(seen.unseenIds).toEqual([]);
  });

  it('a gate the panel just wrote is credited to the panel and stays seen', async () => {
    const first = full(await getSnapshot(root));
    await notePanelWrite(root, 'pl-sex', { deps: [['pl-sex', 'pl-ox2']] });
    exportText = RESOLVED(exportText);
    const next = full(await nextMinute(first.cursor));
    expect(rows(next)[0]).toMatchObject({ kind: 'gate_resolved', actor: 'Ann (panel)', byPanel: true, unseen: false });
    expect(next.unseenIds).toEqual([]);
  });
});

/** The fixture with its lines edited: `edit` gets each parsed row and returns it, or null to drop the row. */
function editRows(text: string, edit: (row: Record<string, unknown>) => Record<string, unknown> | null): string {
  return text.split('\n').filter((l) => l !== '').map((l) => edit(JSON.parse(l) as Record<string, unknown>)).filter((r) => r !== null).map((r) => JSON.stringify(r)).join('\n') + '\n';
}

describe('a review that ends without the gate closing', () => {
  const rows = (res: SnapshotResponse) => full(res).activity.filter((e) => !e.historical);
  const summary = (res: SnapshotResponse) => rows(res).map((e) => [e.kind, e.beadId, e.gateId, e.actor]);

  it('a gate deleted with bd delete gives a gate_resolved row, and no dependency or deletion row', async () => {
    const first = full(await getSnapshot(root));
    // bd delete removes the row and every link to it.
    exportText = editRows(exportText, (r) => (r.id === 'pl-ox2' ? null : r.id === 'pl-sex' ? { ...r, dependencies: undefined, dependency_count: 0 } : r));
    const next = await nextMinute(first.cursor);
    expect(summary(next)).toEqual([['gate_resolved', 'pl-sex', 'pl-ox2', null]]);
    expect(rows(next)[0]).toMatchObject({ ended: 'deleted', gateKind: 'human' });
    expect(full(next).unseenIds).toEqual(['pl-sex']);
  });

  it('a link to an open gate removed with bd dep remove gives a gate_resolved row, and the gate stays listed', async () => {
    const first = full(await getSnapshot(root));
    exportText = editRows(exportText, (r) => (r.id === 'pl-sex' ? { ...r, dependencies: undefined, dependency_count: 0, updated_at: '2026-10-15T09:30:00Z' } : r));
    const next = await nextMinute(first.cursor);
    expect(summary(next)).toEqual([['gate_resolved', 'pl-sex', 'pl-ox2', null]]);
    expect(rows(next)[0]).toMatchObject({ ended: 'unlinked', gateKind: 'human' });
    expect(full(next).gates.map((g) => g.id)).toEqual(['pl-ox2']);
  });

  it('a gate opened and resolved between two reads gives both rows, named from the audit log', async () => {
    const first = full(await getSnapshot(root));
    exportText = withSecondGate(exportText).replace('"status":"open","priority":2,"issue_type":"gate","created_by":"Claude Code"', '"status":"closed","priority":2,"issue_type":"gate","created_by":"Claude Code"');
    auditRead.mockResolvedValue([{ id: 'e7', beadId: 'pl-g2', type: 'closed', actor: 'Claude Code', oldValue: null, newValue: 'Done', rawCreatedAt: '2026-10-15 10:00:40' }, ...gateAudit()]);
    const next = await nextMinute(first.cursor);
    expect(summary(next).sort()).toEqual([['gate_opened', 'pl-2n0', 'pl-g2', 'Claude Code'], ['gate_resolved', 'pl-2n0', 'pl-g2', 'Claude Code']].sort());
    expect(full(next).gates.map((g) => g.id)).toEqual(['pl-ox2']);
    // Both rows keep the kind and the reason, so a self-approved review reads as one, not as an unknown check.
    for (const row of rows(next).filter((e) => e.gateId === 'pl-g2')) expect(row).toMatchObject({ gateKind: 'human', reason: 'Check the numbers' });
  });

  it('a gate that was closed before the first read is not news, and neither is an old edge to it on a later read', async () => {
    exportText = RESOLVED(exportText);
    const first = full(await getSnapshot(root));
    exportText = exportText.replace('"title":"Task B"', '"title":"Task B2"');
    expect(rows(await nextMinute(first.cursor)).map((e) => e.kind)).toEqual(['field']);
  });
});

describe('gate rows and dependencies', () => {
  it('gates and leases change the cursor', async () => {
    const first = full(await getSnapshot(root));
    // Nothing moved: unchanged.
    expect((await nextMinute(first.cursor)).unchanged).toBe(true);

    // A gate opens.
    exportText += `${JSON.stringify({ _type: 'issue', id: 'pl-new', title: 'Gate: human', description: 'x\n\nReason: Approve the plan before work starts', status: 'open', priority: 2, issue_type: 'gate', created_at: '2026-10-15T08:00:00Z', updated_at: '2026-10-15T08:00:00Z', await_type: 'human' })}\n`;
    const withGate = await nextMinute(first.cursor);
    expect(withGate.unchanged).toBe(false);
    expect(full(withGate).gates.map((g) => g.id)).toEqual(['pl-ox2', 'pl-new']);
    expect(full(withGate).gates[1]?.planApproval).toBe(true);
    expect((await nextMinute(withGate.cursor)).unchanged).toBe(true);

    // A lease appears.
    leaseRows = [{ issue_id: 'pl-2n0', holder: 'agent', lease_expires_at: '2026-10-15 10:10:00' }];
    const withLease = await nextMinute(withGate.cursor);
    expect(withLease.unchanged).toBe(false);
    expect(full(withLease).leases).toEqual([{ beadId: 'pl-2n0', holder: 'agent', expiresAt: '2026-10-15T10:10:00.000Z' }]);
  });
});

describe('capabilities and leases', () => {
  it('reports capabilities from the bd version', async () => {
    expect(full(await getSnapshot(root)).capabilities).toEqual({ eventsJournal: true, leases: true });
    resetSnapshotState();
    detect.mockResolvedValue(workspace('1.2.2'));
    expect(full(await getSnapshot(root)).capabilities).toEqual({ eventsJournal: false, leases: false });
  });

  it('reads leases only on bd 1.3 and newer', async () => {
    detect.mockResolvedValue(workspace('1.2.2'));
    const res = full(await getSnapshot(root));
    expect(res.leases).toEqual([]);
    expect(leaseReads).toBe(0);
  });

  it('reads leases at most once a minute per root', async () => {
    leaseRows = [{ issue_id: 'pl-2n0', holder: 'agent', lease_expires_at: '2026-10-15 10:10:00' }];
    await getSnapshot(root);
    expect(leaseReads).toBe(1);
    now += 10_000;
    await getSnapshot(root);
    now += 10_000;
    await getSnapshot(root);
    expect(leaseReads).toBe(1);
    now += 41_000;
    await getSnapshot(root);
    expect(leaseReads).toBe(2);
  });

  it('leases read failure gives an empty list, no error', async () => {
    leaseRows = new Error('no such table: leases');
    const res = full(await getSnapshot(root));
    expect(res.leases).toEqual([]);
    expect(res.freshness.localError).toBeNull();
    expect(res.freshness.localErrorDetail).toBeNull();
    expect(res.beads.length).toBe(3);
  });

  it('drops leases when a later read fails', async () => {
    leaseRows = [{ issue_id: 'pl-2n0', holder: 'agent', lease_expires_at: '2026-10-15 10:10:00' }];
    const first = full(await getSnapshot(root));
    expect(first.leases).toHaveLength(1);
    leaseRows = new Error('locked');
    const next = full(await nextMinute(first.cursor));
    expect(next.leases).toEqual([]);
    expect(next.freshness.localError).toBeNull();
  });

  it('answers with capabilities off and nothing listed for a workspace that is not usable', async () => {
    detect.mockResolvedValue({ kind: 'no-workspace' });
    const res = full(await getSnapshot(root));
    expect(res.capabilities).toEqual({ eventsJournal: false, leases: false });
    expect([res.gates, res.gateIds, res.leases]).toEqual([[], [], []]);
  });
});
