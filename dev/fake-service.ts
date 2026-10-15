// In-memory stand-in for the Beads service, built from the committed server fixtures, so the panel can be looked at in a
// browser without OpenChamber. Later UI tasks add routes here as they need them.
import type { ApiRouteName, BeadResponse, ContextResponse, SeenResponse, SyncPreviewResponse, SyncResponse } from '../src/shared/api';
import type { Bead, BeadPatch, ChangeEvent, ConflictInfo, ErrorEnvelope, Freshness, NewBead, SnapshotResponse, StatusDef, SyncState, UnpublishedChange, WorkspaceState, WriteResult } from '../src/shared/types';
import { relatedFor } from '../src/shared/related';
import { parseExport, parseReady, parseStatuses, parseTypes } from '../src/service/bd/parse';
import exportJsonl from '../test/fixtures/server/reads/export.jsonl';
import statusesJson from '../test/fixtures/server/reads/statuses.json';
import typesJson from '../test/fixtures/server/reads/types.json';
import readyJson from '../test/fixtures/server/reads/ready.json';

export type ScenarioId =
  | 'normal'
  | 'showcase'
  | 'activity'
  | 'quiet'
  | 'team'
  | 'empty-project'
  | 'loading'
  | 'load-error'
  | 'stale'
  | 'conflict'
  | 'no-bd'
  | 'bd-too-old'
  | 'no-workspace'
  | 'pre-dolt'
  | 'needs-first-contact'
  | 'server-down';

/** How the preview answers writes: as Beads would, or with one of the outcomes the panel must handle. */
export type WriteMode = 'ok' | 'conflict' | 'uncertain' | 'busy' | 'blocked' | 'invalid' | 'writes-blocked' | 'sync-running';
export const WRITE_MODES: Array<{ id: WriteMode; label: string }> = [
  { id: 'ok', label: 'Saves' },
  { id: 'conflict', label: 'Conflict' },
  { id: 'uncertain', label: 'Uncertain' },
  { id: 'busy', label: 'Busy' },
  { id: 'blocked', label: 'Close blocked' },
  { id: 'invalid', label: 'Invalid' },
  { id: 'writes-blocked', label: 'Writes blocked' },
  { id: 'sync-running', label: 'Sync running' },
];

/** Writes paused in the snapshot itself: a half-merged project, or a sync job running. */
export type Paused = 'none' | 'blocked' | 'sync';

/** Where the last sync left a project with a shared copy (the "With team" and "Conflict" scenarios). */
export type SyncMode = 'idle' | 'running-pull' | 'running-publish' | 'conflict' | 'half-merged' | 'error' | 'paused-upgrade' | 'capped' | 'stale';
export const SYNC_MODES: Array<{ id: SyncMode; label: string }> = [
  { id: 'idle', label: 'Idle' },
  { id: 'running-pull', label: 'Syncing' },
  { id: 'running-publish', label: 'Publishing' },
  { id: 'conflict', label: 'Conflict' },
  { id: 'half-merged', label: 'Half merged' },
  { id: 'error', label: 'Error' },
  { id: 'paused-upgrade', label: 'Needs upgrade' },
  // Idle, with a header count above the listed changes (the service lists at most 1,000).
  { id: 'capped', label: 'Long list' },
  // Idle; the first Publish finds new changes landed after the preview.
  { id: 'stale', label: 'Changed since preview' },
];

export const SCENARIOS: Array<{ id: ScenarioId; label: string; group: 'Data' | 'Empty states' }> = [
  { id: 'normal', label: 'Normal', group: 'Data' },
  { id: 'team', label: 'With team', group: 'Data' },
  { id: 'showcase', label: 'Detail showcase', group: 'Data' },
  { id: 'activity', label: 'Activity feed', group: 'Data' },
  { id: 'quiet', label: 'No changes yet', group: 'Data' },
  { id: 'empty-project', label: 'No beads yet', group: 'Data' },
  { id: 'loading', label: 'Loading', group: 'Data' },
  { id: 'load-error', label: 'Load error', group: 'Data' },
  { id: 'stale', label: 'Stale', group: 'Data' },
  { id: 'conflict', label: 'Conflict', group: 'Data' },
  { id: 'no-bd', label: 'Not installed', group: 'Empty states' },
  { id: 'bd-too-old', label: 'Too old', group: 'Empty states' },
  { id: 'no-workspace', label: 'No Beads here', group: 'Empty states' },
  { id: 'pre-dolt', label: 'Older format', group: 'Empty states' },
  { id: 'needs-first-contact', label: 'First contact', group: 'Empty states' },
  { id: 'server-down', label: 'Server down', group: 'Empty states' },
];

/** Each scenario is its own project directory, so switching scenarios exercises the panel's directory change. */
export const directoryOf = (id: ScenarioId) => `/Users/preview/projects/${id === 'normal' ? 'scratch' : `scratch-${id}`}`;
const scenarioOf = (directory: string): ScenarioId => {
  for (const s of SCENARIOS) if (directoryOf(s.id) === directory) return s.id;
  return 'normal';
};

const BEADS: Bead[] = parseExport(exportJsonl);
const STATUSES = parseStatuses(statusesJson);
const TYPES = parseTypes(typesJson);
const READY = parseReady(readyJson);

/** The fixture's closed bug, whose close the activity reports with the same time and reason. */
const CLOSED_FIX = BEADS.find((b) => b.id === 'scr-8nw.1.2');

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function activity(): Array<ChangeEvent & { unseen: boolean }> {
  const e = (id: string, beadId: string, kind: ChangeEvent['kind'], minutes: number, unseen: boolean, extra: Partial<ChangeEvent> = {}) => ({
    id,
    beadId,
    kind,
    actor: 'Claude Code',
    byPanel: false,
    observedAt: minutesAgo(minutes),
    unseen,
    ...extra,
  });
  return [
    e('e1', 'scr-r6b', 'created', 2, true),
    e('e2', 'scr-8nw.2', 'field', 9, true, { field: 'status', from: 'open', to: 'blocked' }),
    e('e3', 'scr-8nw.1.1', 'comment', 21, true),
    // The audit log dates the close when Beads did, so the banner and the stamp agree.
    e('e4', 'scr-8nw.1.2', 'closed', 34, true, { reason: CLOSED_FIX?.closeReason ?? undefined, changedAt: CLOSED_FIX?.closedAt ?? undefined }),
    e('e5', 'scr-779', 'field', 80, false, { field: 'status', from: 'open', to: 'in_review', actor: 'Alice Tester (panel)', byPanel: true }),
  ];
}

const UNSEEN = ['scr-r6b', 'scr-8nw.2', 'scr-8nw.1.1', 'scr-8nw.1.2'];

// ------------------------------------------------------------------------------------------------- team sync

/** What Publish would send: the panel's change, the agent's, and one nobody recorded a name for. */
function unpublishedChanges(): UnpublishedChange[] {
  return [
    { commit: 'a1f30000', message: 'bd: update by Alice Tester (panel) [scr-8nw.2]', beadIds: ['scr-8nw.2'], summary: 'Updated scr-8nw.2', actor: 'Alice Tester (panel)', at: minutesAgo(4) },
    { commit: 'b27c0000', message: 'bd: comment by Claude Code [scr-8nw.1.1]', beadIds: ['scr-8nw.1.1'], summary: 'Commented on scr-8nw.1.1', actor: 'Claude Code', at: minutesAgo(21) },
    { commit: 'c90d0000', message: 'dependency: add blocks scr-8nw.3 -> scr-8nw.2', beadIds: ['scr-8nw.3', 'scr-8nw.2'], summary: 'Linked scr-8nw.3 and scr-8nw.2', actor: null, at: minutesAgo(48) },
  ];
}

const CONFLICT_BEADS: ConflictInfo[] = [
  {
    beadId: 'scr-8nw.2',
    title: 'Cut over DNS',
    ours: { status: 'blocked', notes: 'Waiting on the registrar to lower the TTL before the cutover window opens on Friday night.' },
    theirs: { status: 'in_progress', notes: 'Registrar lowered the TTL. Cutover can start.' },
  },
  { beadId: 'scr-r6b', title: 'Crash on login with empty password', ours: { priority: 0 }, theirs: { priority: 1 } },
];

const PULL_LOG = '$ bd --actor "Alice Tester (panel)" dolt pull\nexit 1\nAuto-merging issues\nCONFLICT (content): Merge conflict in issues\nmerge aborted and working set restored';

function syncFor(mode: SyncMode): SyncState {
  switch (mode) {
    case 'running-pull':
      return { kind: 'running', op: 'pull', startedAt: minutesAgo(0.1) };
    case 'running-publish':
      return { kind: 'running', op: 'publish', startedAt: minutesAgo(0.1) };
    case 'conflict':
      return { kind: 'conflict', mode: 'embedded', halfMerged: false, beads: CONFLICT_BEADS, log: PULL_LOG };
    case 'half-merged':
      return { kind: 'conflict', mode: 'server', halfMerged: true, beads: CONFLICT_BEADS, log: PULL_LOG.replace('\nmerge aborted and working set restored', '') };
    case 'error':
      return { kind: 'error', message: "Could not reach the team's shared copy. Check your connection, then try again.", log: '$ bd dolt pull\nexit 1\nfatal: unable to access \'https://example.com/team/beads.git/\': Could not resolve host' };
    case 'paused-upgrade':
      return { kind: 'paused-upgrade', message: "This project's beads data needs a different Beads version. Hand it to your agent to check.", log: '$ bd dolt pull\nexit 1\nError: unsupported storage format version 7 (this bd reads up to 6)' };
    default:
      return { kind: 'idle' };
  }
}

// ------------------------------------------------------------------------------------------------- showcase
// The fixture plus what a detail can hold: a fully filled-in bead, a bead done in a project's own done status (its
// close reason only in the activity), and agent text carrying HTML and script.

const SHOWCASE_STATUSES: StatusDef[] = [...STATUSES, { name: 'shipped', category: 'done', icon: null }];

const link = (from: string, to: string, kind: string, createdBy: string | null, createdAt: string) => ({ from, to, kind, createdBy, createdAt });

const RICH_ID = 'scr-8nw.1';

function showcaseBeads(): Bead[] {
  const beads = BEADS.map((b): Bead => {
    if (b.id === RICH_ID) {
      return {
        ...b,
        title: 'Port session tokens to the new auth service',
        status: 'in_progress',
        priority: 1,
        updatedAt: minutesAgo(9),
        description:
          'Sessions still come from the legacy monolith. Move token issue and refresh to the new auth service so the monolith can be **turned off** behind the platform cutover.\n\nThe token format is the tricky part: existing mobile clients pin the claim names. See the [JWT ADR](https://example.com/adr/jwt) and keep `sub`, `sid` and `exp` unchanged.',
        acceptance: '- [x] Tokens issued by the new service validate in the monolith\n- Refresh keeps working for clients on 4.x and later\n- Logout revokes on both sides within 5 seconds\n- No change to claim names',
        design: 'Reuse the existing key ring; issue from the new service and dual-validate for one release, then drop the monolith signer.',
        notes: 'Wait for MFA reset to land first: it changes the session table this work reads.',
        extra: { ...b.extra, estimated_minutes: 300, external_ref: 'gh-412', due_at: '2026-10-24T17:00:00Z', metadata: { team: 'identity', risk: 'medium' } },
        dependencies: [
          ...b.dependencies,
          link(RICH_ID, 'scr-3i5', 'blocks', 'Bob Builder', '2026-10-14T01:21:40Z'),
          link(RICH_ID, 'scr-779', 'related', 'Claude Code', '2026-10-14T01:22:05Z'),
          link(RICH_ID, 'scr-5s0', 'discovered-from', 'Claude Code', '2026-10-14T01:22:30Z'),
        ],
      };
    }
    if (b.id === 'scr-8nw.3') return { ...b, dependencies: [...b.dependencies, link('scr-8nw.3', RICH_ID, 'blocks', 'Alice Tester', '2026-10-14T01:23:10Z')] };
    return b;
  });
  return [
    ...beads,
    {
      ...BEADS.find((b) => b.id === 'scr-t27')!,
      id: 'scr-shp',
      title: 'Ship SSO to staging',
      type: 'feature',
      status: 'shipped',
      priority: 2,
      assignee: 'Alice Tester',
      labels: ['sso'],
      description: 'Turn on SSO for the staging tenant.',
      createdBy: 'Alice Tester',
      createdAt: minutesAgo(3 * 24 * 60),
      updatedAt: minutesAgo(50),
      closedAt: null,
      closeReason: null,
      extra: {},
    },
    {
      ...BEADS.find((b) => b.id === 'scr-t27')!,
      id: 'scr-pst',
      title: 'Agent notes with pasted HTML',
      dependencies: [link('scr-pst', 'scr-3i5', 'blocks', 'Claude Code', '2026-10-14T01:24:00Z')],
      type: 'task',
      priority: 3,
      description:
        'Pasted from a web page by an agent:\n\n<script>alert("hi")</script><img src="https://example.com/pixel.png" onerror="alert(1)"> <a href="javascript:alert(1)">a script link</a> <iframe src="https://example.com"></iframe>\n\n<b onclick="alert(1)">Bold from HTML</b>, a [real link](https://example.com/docs), and code:\n\n```\nnpm run check\n```\n\n- [x] Sanitized\n- [ ] Still readable',
      createdBy: 'Claude Code',
      extra: {},
    },
  ];
}

function showcaseActivity(): Array<ChangeEvent & { unseen: boolean }> {
  const base = { actor: 'Claude Code', byPanel: false, unseen: true };
  return [
    { ...base, id: 's1', beadId: RICH_ID, kind: 'field', field: 'status', from: 'open', to: 'in_progress', observedAt: minutesAgo(9) },
    { ...base, id: 's2', beadId: 'scr-shp', kind: 'closed', field: 'status', from: 'in_review', to: 'shipped', actor: 'Alice Tester', observedAt: minutesAgo(50), reason: 'Released in 2.3 and checked on staging', unseen: false },
  ];
}

const SHOWCASE_UNSEEN = [...UNSEEN, RICH_ID];

// ------------------------------------------------------------------------------------------------- activity feed
// Every kind of change, from the agent, teammates, this panel and nobody recorded; live and backfilled from history;
// two deleted beads (one deleted before titles were recorded); and long text.

type Feed = Array<ChangeEvent & { unseen: boolean }>;

function feedActivity(): Feed {
  const e = (id: string, beadId: string, kind: ChangeEvent['kind'], minutes: number, extra: Partial<ChangeEvent & { unseen: boolean }> = {}) => ({
    id,
    beadId,
    kind,
    actor: 'Claude Code',
    byPanel: false,
    observedAt: minutesAgo(minutes),
    unseen: false,
    ...extra,
  });
  const panel = { actor: 'Alice Tester (panel)', byPanel: true };
  const history = (at: string) => ({ observedAt: at, historical: true });
  return [
    e('f1', 'scr-r6b', 'field', 1, { field: 'priority', from: 2, to: 0, unseen: true }),
    e('f2', 'scr-8nw.2', 'field', 4, { field: 'status', from: 'in_progress', to: 'blocked', changedAt: minutesAgo(6), unseen: true }),
    e('f3', 'scr-old1', 'deleted', 12, { actor: null, unseen: true, title: 'Spike: try the Rust exporter' }),
    e('f4', 'scr-8nw.1.1', 'comment', 18, {
      actor: 'Bob Builder',
      to: 'Ran the token tests against staging: two failures in the refresh path, both from clock skew between the auth service and the monolith. Retrying with a 30 s leeway.',
      unseen: true,
    }),
    e('f5', 'scr-8nw.1', 'field', 25, {
      field: 'description',
      from: '',
      to: 'Sessions still come from the legacy monolith. Move token issue and refresh to the new auth service so the monolith can be turned off behind the platform cutover.',
    }),
    e('f6', 'scr-r6b', 'field', 40, { field: 'labels', from: ['bug', 'regression', 'triage'], to: ['bug', 'regression', 'urgent'] }),
    e('f7', 'scr-3i5', 'field', 55, { ...panel, field: 'assignee', from: null, to: 'Bob Builder' }),
    e('f8', 'scr-8nw.3', 'dep_added', 120, { field: 'blocks', to: 'scr-8nw.2' }),
    e('f9', 'scr-779', 'dep_removed', 150, { field: 'related', from: 'scr-5s0', actor: null }),
    e('f10', 'scr-old2', 'deleted', 180, { actor: null }),
    e('f11', 'scr-old1', 'field', 210, { field: 'title', from: 'Old spike', to: 'Spike: try the Rust exporter' }),
    e('f12', 'scr-8nw.1', 'field', 230, { field: 'estimated_minutes', from: 120, to: 300 }),
    e('f13', 'scr-5s0', 'dep_added', 240, { field: 'needs-review', to: 'scr-8yo', actor: 'Alice Tester' }),
    e('f14', 'scr-m0h', 'field', 26 * 60, { field: 'title', from: 'A2 title', to: 'A2 edited title', actor: 'Alice Tester' }),
    e('f15', 'scr-8nw.1.2', 'closed', 28 * 60, {
      field: 'status',
      from: 'in_progress',
      to: 'closed',
      reason: 'Fixed by setting SameSite=Lax and Secure on the session cookie; verified on staging with Safari 17 and Chrome 129',
    }),
    e('f16', 'scr-5s0', 'reopened', 30 * 60, { field: 'status', from: 'closed', to: 'open', actor: 'Alice Tester' }),
    e('f17', 'scr-t27', 'created', 2 * 24 * 60, panel),
    e('f18', 'scr-779', 'field', 3 * 24 * 60, { field: 'status', from: 'open', to: 'in_review', ...panel }),
    e('f19', 'scr-8yo', 'closed', 0, { ...history('2026-10-02'), field: 'status', actor: 'Bob Builder', reason: 'Chose EdDSA' }),
    e('f20', 'scr-lha', 'created', 0, { ...history('2026-10-01T15:04:00.000Z'), actor: 'Alice Tester' }),
    e('f21', 'scr-fum', 'field', 0, { ...history('2026-09-30'), field: 'labels', actor: null }),
    e('f22', 'scr-5s0', 'comment', 0, history('2026-09-30')),
  ];
}

const FEED_UNSEEN = [...new Set(feedActivity().filter((e) => e.unseen).map((e) => e.beadId))];

function activityFor(id: ScenarioId): Feed {
  if (id === 'activity') return feedActivity();
  if (id === 'quiet') return [];
  return [...(id === 'showcase' ? showcaseActivity() : []), ...activity()];
}

const beadsFor = (id: ScenarioId) => (id === 'showcase' ? showcaseBeads() : BEADS);
const unseenFor = (id: ScenarioId) => (id === 'showcase' ? SHOWCASE_UNSEEN : id === 'activity' ? FEED_UNSEEN : id === 'quiet' ? [] : UNSEEN);

const ok = (hasRemote: boolean): Extract<WorkspaceState, { kind: 'ok' }> => ({ kind: 'ok', root: '/Users/preview/projects/scratch', mode: 'embedded', bdVersion: '1.2.2', hasRemote, projectName: 'scratch' });

const NOT_READY: Partial<Record<ScenarioId, WorkspaceState>> = {
  'no-bd': { kind: 'no-bd' },
  'bd-too-old': { kind: 'bd-too-old', bdVersion: '1.1.4' },
  'no-workspace': { kind: 'no-workspace' },
  'pre-dolt': { kind: 'pre-dolt', root: '/Users/preview/projects/pre-dolt' },
  'needs-first-contact': { kind: 'needs-first-contact', root: '/Users/preview/projects/needs-first-contact', lastOpenedWith: '1.2.2', bdVersion: '1.3.0' },
  'server-down': { kind: 'server-down', root: '/Users/preview/projects/server-down', port: 3307 },
};

type Answer = { status: number; body: string };
const answer = (json: unknown, status = 200): Answer => ({ status, body: JSON.stringify(json) });
const fail = (status: number, error: ErrorEnvelope['error']): Answer => answer({ error }, status);

export type FakeService = { handle(route: ApiRouteName, body: Record<string, unknown>): Promise<Answer> };

type Options = { beadWait?: boolean; writes?: () => WriteMode; paused?: () => Paused; sync?: () => SyncMode };

/**
 * `beadWait`: the bead route never answers, for looking at the detail while it loads. `writes` picks how writes answer;
 * `paused` pauses writes in the snapshot; `sync` is where the last sync left a project with a shared copy. Writes change
 * an in-memory copy of each scenario's beads; Sync and Publish run for a few seconds and then end cleanly.
 */
export function createFakeService({ beadWait = false, writes = () => 'ok', paused = () => 'none', sync: syncMode = () => 'idle' }: Options = {}): FakeService {
  /** A Sync or Publish the preview's panel started, until it ends. */
  let job: { op: 'pull' | 'publish'; startedAt: string; until: number } | null = null;
  /** The sync mode the job started from; choosing another one in the controls replaces the job's end state. */
  let jobFrom: SyncMode | null = null;
  let teamSyncedAt = minutesAgo(12);
  let unpublished = unpublishedChanges();
  /** The "Changed since preview" mode refuses one Publish, then lets the next one through. */
  let staleShown = false;
  const syncNow = (): SyncState => {
    if (job && Date.now() >= job.until) {
      if (job.op === 'publish') unpublished = [];
      teamSyncedAt = new Date().toISOString();
      job = null;
    }
    if (job) return { kind: 'running', op: job.op, startedAt: job.startedAt };
    // A job this page ran ended cleanly: the problem it was started from is gone until another mode is picked.
    return jobFrom !== null && jobFrom === syncMode() ? { kind: 'idle' } : syncFor(syncMode());
  };
  const startJob = (op: 'pull' | 'publish'): SyncState => {
    if (!job) {
      job = { op, startedAt: new Date().toISOString(), until: Date.now() + (op === 'pull' ? 2_500 : 3_500) };
      jobFrom = syncMode();
    }
    return syncNow();
  };
  /** Projects the user confirmed first contact for in this page. */
  const confirmed = new Set<string>();
  let seen = new Set<string>();
  /** When the stale scenario's data was last good. */
  const staleSince = minutesAgo(0.75);
  /** Each scenario's beads as the preview's writes left them. */
  const held = new Map<ScenarioId, Bead[]>();
  let revision = 0;
  const beadsOf = (id: ScenarioId): Bead[] => {
    let list = held.get(id);
    if (!list) held.set(id, (list = structuredClone(beadsFor(id))));
    return list;
  };
  const put = (id: ScenarioId, bead: Bead) => {
    const list = beadsOf(id);
    const i = list.findIndex((b) => b.id === bead.id);
    if (i < 0) list.push(bead);
    else list[i] = bead;
    revision++;
    return bead;
  };
  const stamp = () => new Date().toISOString();
  const refused = (mode: WriteMode, what: string): Answer | null => {
    switch (mode) {
      case 'busy':
        return fail(503, { code: 'busy', message: 'Beads is busy. Nothing was saved. Try again in a moment.', detail: 'database is locked (embedded mode holds an exclusive lock)' });
      case 'invalid':
        return fail(400, { code: 'invalid', message: 'Only tasks can block other tasks.', detail: 'Error: tasks can only block other tasks' });
      case 'writes-blocked':
        return fail(409, { code: 'writes-blocked', message: 'The team sync left this project half merged. Resolve the sync problem first.' });
      case 'sync-running':
        return fail(409, { code: 'sync-running', message: 'Sync in progress. Try again when it finishes.' });
      case 'uncertain':
        return fail(504, { code: 'uncertain', message: `Beads did not answer in time. The ${what} may or may not have been saved. Check before trying again.`, detail: 'signal: killed (timeout after 15s)' });
      default:
        return null;
    }
  };
  const statusesOf = (id: ScenarioId) => (id === 'showcase' ? SHOWCASE_STATUSES : STATUSES);

  function update(id: ScenarioId, body: Record<string, unknown>): Answer {
    const bead = beadsOf(id).find((b) => b.id === body.id);
    if (!bead) return fail(404, { code: 'not-found', message: 'That bead no longer exists.' });
    const patch = (body.patch ?? {}) as BeadPatch;
    const mode = writes();
    if (mode === 'conflict' || body.expectedUpdatedAt !== bead.updatedAt) {
      // Someone else got there first: the agent added to the same text.
      const current = mode === 'conflict' && body.expectedUpdatedAt === bead.updatedAt
        ? put(id, { ...bead, description: `${bead.description}\n\nAgent: refresh tokens need the same treatment.`, priority: 1, updatedAt: stamp() })
        : bead;
      return answer({ ok: false, conflict: true, current } satisfies WriteResult);
    }
    if (mode === 'uncertain') return answer({ ok: false, uncertain: true, current: null } satisfies WriteResult);
    const done = statusesOf(id).find((s) => s.name === patch.status)?.category === 'done';
    if (mode === 'blocked' && done) return fail(409, { code: 'blocked', message: "This bead can't be closed yet. It is still blocked by scr-3i5. Close those first.", detail: 'cannot close: blocked by open issues [scr-3i5]' });
    const no = refused(mode, 'change');
    if (no) return no;
    const { closeReason, ...fields } = patch;
    const next: Bead = { ...bead, ...fields, updatedAt: stamp() };
    if (done && patch.status === 'closed') Object.assign(next, { closedAt: stamp(), closeReason: closeReason ?? null });
    return answer({ ok: true, bead: put(id, next) } satisfies WriteResult);
  }

  function create(id: ScenarioId, input: NewBead): Answer {
    const no = refused(writes(), 'bead');
    if (no) return no;
    const list = beadsOf(id);
    const prefix = input.parentId ?? 'scr-new';
    let n = 1;
    while (list.some((b) => b.id === `${prefix}.${n}`)) n++;
    const at = stamp();
    const bead: Bead = {
      ...list[0]!, id: `${prefix}.${n}`, title: input.title, type: input.type, priority: input.priority, parentId: input.parentId, description: input.description,
      status: 'open', assignee: null, labels: [], design: '', acceptance: '', notes: '', createdAt: at, createdBy: 'Alice Tester (panel)', updatedAt: at,
      closedAt: null, closeReason: null, comments: [], extra: {},
      dependencies: input.parentId ? [{ from: `${prefix}.${n}`, to: input.parentId, kind: 'parent-child', createdBy: 'Alice Tester (panel)', createdAt: at.replace(/\.\d+Z$/, 'Z') }] : [],
    };
    return answer({ bead: put(id, bead) });
  }

  function workspaceFor(directory: string): WorkspaceState {
    const id = scenarioOf(directory);
    if (id === 'needs-first-contact' && confirmed.has(directory)) return { ...ok(false), projectName: 'needs-first-contact' };
    const notReady = NOT_READY[id];
    if (notReady) return notReady;
    const ready = ok(id === 'team' || id === 'conflict');
    return id === 'empty-project' ? { ...ready, projectName: 'empty-project' } : ready;
  }

  function snapshot(directory: string, cursor: unknown): Answer | null {
    const id = scenarioOf(directory);
    if (id === 'loading') return null;
    if (id === 'load-error') return fail(500, { code: 'beads-error', message: "Couldn't read beads.", detail: 'bd export: exit status 1\nError: failed to open database: file is locked' });
    const workspace = workspaceFor(directory);
    const freshness: Freshness = {
      // The service checks for changes about every 4 s.
      localRefreshedAt: id === 'stale' ? staleSince : new Date(Math.floor(Date.now() / 4000) * 4000).toISOString(),
      localError: id === 'stale' ? "Couldn't read beads. Retrying." : null,
      localErrorDetail: id === 'stale' ? 'bd export --readonly: signal: killed (timeout after 15s)' : null,
      teamSyncedAt: null,
      unpublished: null,
    };
    const remote = workspace.kind === 'ok' && workspace.hasRemote;
    const sync: SyncState =
      id === 'conflict'
        ? syncFor('conflict')
        : remote
          ? syncNow()
          : workspace.kind === 'ok' && paused() === 'sync'
            ? { kind: 'running', op: 'pull', startedAt: minutesAgo(0.2) }
            : { kind: 'idle' };
    if (remote) {
      freshness.teamSyncedAt = teamSyncedAt;
      freshness.unpublished = unpublished.length + (syncMode() === 'capped' && unpublished.length > 0 ? 1_000 : 0);
    }
    const beads = workspace.kind !== 'ok' || id === 'empty-project' ? [] : beadsOf(id);
    const unseenIds = workspace.kind === 'ok' && beads.length ? unseenFor(id).filter((b) => !seen.has(b)) : [];
    const pause = workspace.kind === 'ok' ? paused() : 'none';
    const next = `${id}:${workspace.kind}:${unseenIds.length}:${revision}:${pause}:${sync.kind}`;
    if (cursor === next) return answer({ unchanged: true, cursor: next, freshness, sync } satisfies SnapshotResponse);
    const full: SnapshotResponse = {
      unchanged: false,
      cursor: next,
      workspace,
      beads,
      statuses: workspace.kind === 'ok' ? (id === 'showcase' ? SHOWCASE_STATUSES : STATUSES) : [],
      types: workspace.kind === 'ok' ? TYPES : [],
      readyIds: workspace.kind === 'ok' ? READY : [],
      unseenIds,
      activity: beads.length ? activityFor(id).map((e) => ({ ...e, unseen: e.unseen && !seen.has(e.beadId) })) : [],
      freshness,
      sync,
      writesBlocked: workspace.kind === 'ok' && (paused() === 'blocked' || (sync.kind === 'conflict' && sync.halfMerged)),
      panelActor: workspace.kind === 'ok' ? 'Alice Tester (panel)' : '',
    };
    return answer(full);
  }

  return {
    async handle(route, body) {
      const directory = String(body.directory ?? '');
      await new Promise((r) => setTimeout(r, 120));
      switch (route) {
        case 'snapshot': {
          const result = snapshot(directory, body.cursor);
          return result ?? new Promise<Answer>(() => {});
        }
        case 'workspace':
          if (body.confirmFirstContact === true) confirmed.add(directory);
          return answer(workspaceFor(directory));
        case 'seen': {
          const all = unseenFor(scenarioOf(directory));
          seen = body.all === true ? new Set(all) : new Set([...seen, ...((body.ids as string[]) ?? [])]);
          return answer({ unseenIds: all.filter((b) => !seen.has(b)) } satisfies SeenResponse);
        }
        case 'bead': {
          if (beadWait) return new Promise<Answer>(() => {});
          // After a write that may have saved, Beads is slow to answer the re-read too.
          if (writes() === 'uncertain') await new Promise((r) => setTimeout(r, 4_000));
          const beads = beadsOf(scenarioOf(directory));
          const bead = beads.find((b) => b.id === body.id);
          if (!bead) return fail(404, { code: 'not-found', message: "That bead doesn't exist." });
          return answer({ bead, related: relatedFor(bead, beads) } satisfies BeadResponse);
        }
        case 'context': {
          const bead = beadsOf(scenarioOf(directory)).find((b) => b.id === body.id);
          if (!bead) return fail(404, { code: 'not-found', message: "That bead doesn't exist." });
          const text = `Beads issue context (JSON)\n${JSON.stringify({ issue: bead }, null, 2)}`.slice(0, 16_000);
          return answer({ id: bead.id, title: bead.title, text, url: `https://beads.invalid/scratch/${bead.id}` } satisfies ContextResponse);
        }
        case 'update':
          return update(scenarioOf(directory), body);
        case 'create':
          return create(scenarioOf(directory), body.input as NewBead);
        case 'comment': {
          const id = scenarioOf(directory);
          const no = refused(writes(), 'comment');
          if (no) return no;
          const bead = beadsOf(id).find((b) => b.id === body.id);
          if (!bead) return fail(404, { code: 'not-found', message: 'That bead no longer exists.' });
          const comment = { id: `c-${Date.now()}`, author: 'Alice Tester (panel)', text: String(body.text ?? ''), createdAt: stamp() };
          put(id, { ...bead, comments: [...bead.comments, comment] });
          return answer({ comment });
        }
        case 'dependency': {
          const id = scenarioOf(directory);
          const no = refused(writes(), 'link');
          if (no) return no;
          const from = beadsOf(id).find((b) => b.id === body.from);
          if (!from) return fail(404, { code: 'not-found', message: 'That bead no longer exists.' });
          const others = from.dependencies.filter((d) => d.to !== body.to);
          const added = body.op === 'add' ? [{ from: from.id, to: String(body.to), kind: String(body.kind), createdBy: 'Alice Tester (panel)', createdAt: stamp().replace(/\.\d+Z$/, 'Z') }] : [];
          put(id, { ...from, dependencies: [...others, ...added] });
          return answer({ ok: true });
        }
        case 'sync-preview': {
          const here = workspaceFor(directory);
          if (here.kind !== 'ok' || !here.hasRemote) return answer({ changes: [], noRemote: true } satisfies SyncPreviewResponse);
          if (syncNow().kind === 'running') return fail(409, { code: 'sync-running', message: 'Sync in progress. Try again when it finishes.' });
          const total = unpublished.length + (syncMode() === 'capped' && unpublished.length > 0 ? 1_000 : 0);
          return answer({ changes: unpublished, head: unpublished[0]?.commit ?? 'pub00000', total } satisfies SyncPreviewResponse);
        }
        case 'sync-pull':
          return answer({ sync: startJob('pull') } satisfies SyncResponse);
        case 'sync-publish':
          if (syncMode() === 'stale' && !staleShown) {
            staleShown = true;
            unpublished = [{ commit: 'd4e50000', message: 'bd: update by Claude Code [scr-r6b]', beadIds: ['scr-r6b'], summary: 'Updated scr-r6b', actor: 'Claude Code', at: new Date().toISOString() }, ...unpublished];
            return fail(409, { code: 'preview-stale', message: 'New changes arrived since you looked. Review them again.' });
          }
          return answer({ sync: startJob('publish') } satisfies SyncResponse);
        case 'conflict-context': {
          const state = scenarioOf(directory) === 'conflict' ? syncFor('conflict') : syncNow();
          if (state.kind !== 'conflict' && state.kind !== 'error' && state.kind !== 'paused-upgrade') return fail(400, { code: 'BAD_REQUEST', message: 'There is no sync problem to attach.' });
          const text = `Beads sync needs attention (JSON)\n${JSON.stringify({ project: directory, sync: state }, null, 2)}`.slice(0, 16_000);
          return answer({ id: 'sync-scratch', title: 'Beads sync needs attention', text, url: 'https://beads.invalid/scratch/sync' } satisfies ContextResponse);
        }
        default:
          return fail(404, { code: 'NOT_FOUND', message: "The preview doesn't answer this yet." });
      }
    },
  };
}
