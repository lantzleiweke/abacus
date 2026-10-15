// In-memory stand-in for the Beads service, built from the committed server fixtures, so the panel can be looked at in a
// browser without OpenChamber. Later UI tasks add routes here as they need them.
import type { ApiRouteName, BeadResponse, ContextResponse, EventsStatusResult, Memory, MemoriesResult, SeenResponse, SyncPreviewResponse, SyncResponse } from '../src/shared/api';
import type {
  Bead, BeadPatch, Capabilities, ChangeEvent, ConflictInfo, ErrorEnvelope, ExplainResult, Freshness, Gate, HistoryEntry, HistoryResult, Lease, LiveState, NewBead, SnapshotResponse, StatusDef, SyncState,
  UnpublishedChange, UpdateJob, WorkspaceState, WriteResult,
} from '../src/shared/types';
import { REVIEW_REASON } from '../src/shared/gates';
import { relatedFor } from '../src/shared/related';
import { parseExport, parseReady, parseStatuses, parseTypes } from '../src/service/bd/parse';
import { localZone, parseDateInput } from '../src/panel/dates';
import exportJsonl from '../test/fixtures/server/reads/export.jsonl';
import statusesJson from '../test/fixtures/server/reads/statuses.json';
import typesJson from '../test/fixtures/server/reads/types.json';
import readyJson from '../test/fixtures/server/reads/ready.json';

export type ScenarioId =
  | 'normal'
  | 'showcase'
  | 'needs'
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

/** What the project says about live updates (`bd events`): the answers of `eventsStatus`, one of each kind. */
export type EventsMode = 'unavailable' | 'journal-off' | 'journal-unknown' | LiveState;
export const EVENTS_MODES: Array<{ id: EventsMode; label: string }> = [
  { id: 'unavailable', label: 'Too old' },
  { id: 'journal-off', label: 'Journal off' },
  { id: 'journal-unknown', label: 'Journal unknown' },
  { id: 'starting', label: 'Starting' },
  { id: 'following', label: 'Following' },
  { id: 'backoff', label: 'Backing off' },
  { id: 'failed', label: 'Failed' },
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
  { id: 'needs', label: 'Needs me', group: 'Data' },
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
// The showcase's epic whose children are all done is ready too, as Beads lists it.
const READY = [...parseReady(readyJson), 'scr-rdy'];

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
        acceptance: 'Done when the monolith signer can be **turned off**:\n\n- [x] Tokens issued by the new service validate in the monolith\n- [ ] Refresh keeps working for clients on 4.x and later\n- [ ] Logout revokes on both sides within 5 seconds\n- No change to claim names',
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
    if (b.id === 'scr-8nw.3') return { ...b, extra: { ...b.extra, due_at: minutesAgo(-3 * 24 * 60) }, dependencies: [...b.dependencies, link('scr-8nw.3', RICH_ID, 'blocks', 'Alice Tester', '2026-10-14T01:23:10Z')] };
    return b;
  });
  const base = BEADS.find((b) => b.id === 'scr-t27')!;
  const doneChild = (id: string, title: string): Bead => ({
    ...base, id, title, type: 'task', status: 'closed', parentId: 'scr-rdy', labels: [], assignee: 'Alice Tester', description: '', acceptance: '',
    closedAt: minutesAgo(3 * 60), closeReason: 'Done', updatedAt: minutesAgo(3 * 60), extra: {}, comments: [],
    dependencies: [link(id, 'scr-rdy', 'parent-child', 'Alice Tester', '2026-10-13T09:00:00Z')],
  });
  return [
    ...beads,
    // An epic whose every child is done: it offers Close epic.
    { ...base, id: 'scr-rdy', title: 'Retire the legacy login page', type: 'epic', status: 'open', priority: 2, labels: [], assignee: null, description: 'Everything that still pointed at the old page.', acceptance: '', parentId: null, closedAt: null, closeReason: null, extra: {}, comments: [], dependencies: [], updatedAt: minutesAgo(3 * 60) },
    doneChild('scr-rdy.1', 'Redirect /login to the new flow'),
    doneChild('scr-rdy.2', 'Remove the old login templates'),
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
      extra: { due_at: minutesAgo(26 * 60) },
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
  return [...(id === 'showcase' ? showcaseActivity() : id === 'needs' ? needsActivity() : []), ...activity()];
}

// ------------------------------------------------------------------------------------------------- needs me
// The fixture plus what each Needs me section holds: a bead waiting on a review (an open human gate), a help request, a
// bead whose claim ran out, one that has simply gone quiet, and a request that cannot be closed yet (it has an open child).

const REVIEW_GATE = 'scr-gate-1';
/** Two more on the same bead, so its detail shows a review, a plan approval and a timer together. */
const CODE_GATE = 'scr-gate-code';
const TIMER_GATE = 'scr-gate-soak';
const NEEDS = { review: 'scr-rev', ask: 'scr-ask', lease: 'scr-lse', quiet: 'scr-qt1', parked: 'scr-prk', askBlocked: 'scr-ask2' } as const;

function needsBeads(): Bead[] {
  const base = BEADS.find((b) => b.id === 'scr-t27')!;
  const make = (id: string, over: Partial<Bead>): Bead => ({ ...base, id, closedAt: null, closeReason: null, comments: [], dependencies: [], extra: {}, parentId: null, labels: [], assignee: null, ...over });
  const day = 24 * 60;
  return [
    ...BEADS,
    make(NEEDS.review, {
      title: 'Roll out the new session store',
      status: 'open',
      priority: 1,
      description: 'Plan: dual-write for one release, then switch reads. Needs a go before the dual-write starts.',
      design: '## Plan\n\n1. Dual-write sessions to the old and new store for one release.\n2. Compare reads in the background and log mismatches.\n3. Switch reads to the new store, keep writing both for a week.',
      updatedAt: minutesAgo(40),
      dependencies: [
        link(NEEDS.review, REVIEW_GATE, 'blocks', 'Claude Code', minutesAgo(40)),
        link(NEEDS.review, CODE_GATE, 'blocks', 'Bob Builder', minutesAgo(3 * 60)),
        link(NEEDS.review, TIMER_GATE, 'blocks', 'Claude Code', minutesAgo(90)),
      ],
    }),
    make(NEEDS.ask, {
      title: 'Which region should the staging tenant live in?',
      status: 'open',
      priority: 2,
      labels: ['human'],
      description: 'Two choices: eu-west (closer to the team) or us-east (matches production). Which one should I use for the staging tenant?',
      createdBy: 'Claude Code',
      updatedAt: minutesAgo(25),
    }),
    make(NEEDS.askBlocked, {
      title: 'Is the old token format still needed?',
      status: 'open',
      priority: 2,
      labels: ['human'],
      description: 'Can I remove the legacy token format, or do mobile clients still send it?',
      createdBy: 'Claude Code',
      updatedAt: minutesAgo(3 * day),
    }),
    make(`${NEEDS.askBlocked}.1`, { title: 'Count legacy token requests', status: 'in_progress', parentId: NEEDS.askBlocked, assignee: 'Claude Code', updatedAt: minutesAgo(30), dependencies: [link(`${NEEDS.askBlocked}.1`, NEEDS.askBlocked, 'parent-child', 'Claude Code', minutesAgo(3 * day))] }),
    make(NEEDS.lease, { title: 'Migrate the audit log writer', status: 'in_progress', priority: 1, assignee: 'Claude Code', updatedAt: minutesAgo(50), description: 'Claimed by an agent whose session ended.' }),
    make(NEEDS.quiet, { title: 'Rewrite the retry policy', status: 'in_progress', priority: 2, assignee: 'Bob Builder', updatedAt: minutesAgo(6 * day), description: 'Started last week, nothing since.' }),
    make(NEEDS.parked, { title: 'Look into flaky checkout test', status: 'in_progress', priority: 3, assignee: 'Alice Tester', updatedAt: minutesAgo(4 * day) }),
  ];
}

const needsGates = (): Gate[] => [
  { id: REVIEW_GATE, kind: 'human', reason: 'Approve the plan before work starts', blocks: [NEEDS.review], createdBy: 'Claude Code', createdAt: minutesAgo(40), timeoutMs: null, planApproval: true },
  { id: CODE_GATE, kind: 'human', reason: 'Check the session expiry change with the mobile team', blocks: [NEEDS.review], createdBy: 'Bob Builder', createdAt: minutesAgo(3 * 60), timeoutMs: null, planApproval: false },
  { id: TIMER_GATE, kind: 'timer', reason: 'Let staging soak for a day', blocks: [NEEDS.review], createdBy: 'Claude Code', createdAt: minutesAgo(90), timeoutMs: 24 * 60 * 60_000, planApproval: false },
];

const needsLeases = (): Lease[] => [{ beadId: NEEDS.lease, holder: 'Claude Code', expiresAt: minutesAgo(130) }];

const needsActivity = (): Feed => [
  { id: 'n1', beadId: NEEDS.review, kind: 'gate_opened', gateId: REVIEW_GATE, gateKind: 'human', reason: 'Approve the plan before work starts', actor: 'Claude Code', byPanel: false, observedAt: minutesAgo(40), unseen: true },
  { id: 'n2', beadId: NEEDS.ask, kind: 'created', actor: 'Claude Code', byPanel: false, observedAt: minutesAgo(25), unseen: true },
];

const beadsFor = (id: ScenarioId) => (id === 'showcase' ? showcaseBeads() : id === 'needs' ? needsBeads() : BEADS);
const unseenFor = (id: ScenarioId) => (id === 'showcase' ? SHOWCASE_UNSEEN : id === 'activity' ? FEED_UNSEEN : id === 'quiet' ? [] : id === 'needs' ? [...UNSEEN, NEEDS.review, NEEDS.ask] : UNSEEN);

const ok = (hasRemote: boolean): Extract<WorkspaceState, { kind: 'ok' }> => ({ kind: 'ok', root: '/Users/preview/projects/scratch', mode: 'embedded', bdVersion: '1.2.2', hasRemote, projectName: 'scratch' });

const NOT_READY: Partial<Record<ScenarioId, WorkspaceState>> = {
  'no-bd': { kind: 'no-bd' },
  'bd-too-old': { kind: 'bd-too-old', bdVersion: '1.1.4' },
  'no-workspace': { kind: 'no-workspace' },
  'pre-dolt': { kind: 'pre-dolt', root: '/Users/preview/projects/pre-dolt' },
  'needs-first-contact': { kind: 'needs-first-contact', root: '/Users/preview/projects/needs-first-contact', lastOpenedWith: '1.2.2', bdVersion: '1.3.0' },
  'server-down': { kind: 'server-down', root: '/Users/preview/projects/server-down', port: 3307 },
};

// ------------------------------------------------------------------------------------------------- memories and history

const seedMemories = (): Memory[] => [
  { key: 'tests-before-merge', text: 'Run the full test suite before asking for a review. The integration tests need the scratch project, never a real one.', changedAt: minutesAgo(90), changedBy: 'Alice Tester' },
  { key: 'staging-region', text: 'Staging lives in eu-west. Production is us-east. Do not mix the two in config files.', changedAt: minutesAgo(26 * 60), changedBy: 'Bob Builder' },
  { key: 'no-force-push', text: 'Never force-push a shared branch. Ask first.', changedAt: minutesAgo(3 * 24 * 60), changedBy: 'Alice Tester' },
  { key: 'token-claims', text: 'Mobile clients pin the token claim names sub, sid and exp. Keep them unchanged.', changedAt: minutesAgo(6 * 24 * 60), changedBy: 'Claude Code' },
  { key: 'release-window', text: 'Releases go out Tuesday and Thursday before noon. Nothing ships on Friday.', changedAt: null, changedBy: null },
];

/**
 * A bead's past versions, newest first: edits that can be put back (one the bead has moved past since, so Restore asks first), a
 * long text edit shown as a diff, one that cannot be restored (cut for transport), a close nobody can be named for, review and
 * other gate events (resolved by an agent, by this panel, deleted, unlinked, a timer that ended), and the creation.
 */
function historyFor(bead: Bead): HistoryEntry[] {
  const review = { gateId: 'scr-gate-1', gateKind: 'human', reason: 'Review before closing' };
  const timer = { gateId: 'scr-gate-soak', gateKind: 'timer', reason: 'Let staging soak for a day' };
  const design = bead.design || '## Plan\n\n1. Write the migration.\n2. Run it on staging.\n3. Run it on production.';
  const lines = design.split('\n');
  const olderDesign = [...lines.slice(0, -1), lines.at(-1)!.replace(/\.$/, '').concat(' after the freeze.'), 'Roll back if error rates rise.'].join('\n');
  const day = 24 * 60;
  return [
    { id: 'h1', at: minutesAgo(20), actor: 'Alice Tester', changes: [{ field: 'priority', from: 2, to: bead.priority, text: false }], restorable: ['priority'] },
    { id: 'h2', at: minutesAgo(50), actor: null, changes: [{ field: 'status', from: 'closed', to: bead.status, text: false }], restorable: ['status'] },
    { id: 'h3', at: minutesAgo(70), actor: null, changes: [{ field: 'status', from: 'in_progress', to: 'closed', text: false }], restorable: ['status'] },
    { id: 'h4', at: minutesAgo(95), actor: 'Claude Code', changes: [{ field: 'title', from: `${bead.title} (draft)`, to: bead.title, text: false }, { field: 'assignee', from: null, to: bead.assignee ?? 'Claude Code', text: false }, { field: 'labels', from: ['triage'], to: ['triage', 'backend'], text: false }], restorable: ['title', 'assignee', 'labels'] },
    { id: 'h5', at: minutesAgo(2 * 60), actor: 'Claude Code', changes: [{ field: 'design', from: olderDesign, to: design, text: true }], restorable: ['design'] },
    { id: 'h6', at: minutesAgo(3 * 60), actor: 'Claude Code', changes: [{ field: 'description', from: `${bead.description.slice(0, 40)}...`, to: `${bead.description.slice(0, 80)}...`, text: true, truncated: true }], restorable: [] },
    { id: 'h7', at: minutesAgo(4 * 60), actor: 'Claude Code', changes: [{ field: 'priority', from: 3, to: 2, text: false }], restorable: ['priority'] },
    { id: 'h8', at: minutesAgo(5 * 60), actor: 'Claude Code', gate: { ...review, what: 'resolved', byPanel: false }, changes: [], restorable: [] },
    { id: 'h9', at: minutesAgo(6 * 60), actor: 'Alice Tester (panel)', gate: { ...review, gateId: 'scr-gate-2', what: 'resolved', byPanel: true }, changes: [], restorable: [] },
    { id: 'h10', at: minutesAgo(day + 60), actor: null, gate: { ...review, gateId: 'scr-gate-3', what: 'deleted', byPanel: false }, changes: [], restorable: [] },
    { id: 'h11', at: minutesAgo(day + 90), actor: null, gate: { ...review, gateId: 'scr-gate-4', what: 'unlinked', byPanel: false }, changes: [], restorable: [] },
    { id: 'h12', at: minutesAgo(day + 120), actor: null, gate: { ...timer, what: 'resolved', byPanel: false }, changes: [], restorable: [] },
    { id: 'h13', at: minutesAgo(day + 180), actor: 'Claude Code', gate: { ...review, what: 'requested', byPanel: false }, changes: [], restorable: [] },
    { id: 'h14', at: bead.createdAt, actor: bead.createdBy, created: true, changes: [], restorable: [] },
  ];
}

type Answer = { status: number; body: string };
const answer = (json: unknown, status = 200): Answer => ({ status, body: JSON.stringify(json) });
const fail = (status: number, error: ErrorEnvelope['error']): Answer => answer({ error }, status);

export type FakeService = { handle(route: ApiRouteName, body: Record<string, unknown>): Promise<Answer> };

const WRITE_ROUTES = new Set<string>(['update', 'deferBead', 'undeferBead', 'supersede', 'duplicate', 'create', 'comment', 'dependency', 'gateCreate', 'gateResolve', 'humanRespond', 'humanDismiss', 'memoryRemember', 'memoryForget', 'enableEvents']);
type Options = { beadWait?: boolean; writes?: () => WriteMode; paused?: () => Paused; sync?: () => SyncMode; events?: () => EventsMode; oldBeads?: () => boolean; oldSchema?: () => boolean; sharedSchema?: () => boolean };

/** The service's words for a store the installed Beads cannot read until it is updated, and the versions the preview shows. */
const SCHEMA_UPDATE_TEXT = 'This project needs a one-time update for the newer Beads.';
const SCHEMA_SKEW = { from: 32, to: 66 };
const SHARED_STORE_TEXT = "This project shares its beads with your team, so Beads won't update it from here. Ask whoever set up the team copy to update it, or update it on the computer that hosts it.";
const SHARED_REFUSAL = 'refusing to auto-apply 34 pending schema migrations to a remote-backed database (v32 -> v66): migrating clones independently forks the schema (#4259)';
const SCHEMA_STDERR =
  'Error: failed to open database: schema version mismatch: database is at v32, binary expects v66, and the read-only open cannot migrate it; run any bd write command in that workspace to migrate, or set BD_IGNORE_SCHEMA_SKEW=1 to read anyway (queries touching newer schema may fail)';

/**
 * `beadWait`: the bead route never answers, for looking at the detail while it loads. `writes` picks how writes answer;
 * `paused` pauses writes in the snapshot; `sync` is where the last sync left a project with a shared copy. Writes change
 * an in-memory copy of each scenario's beads; Sync and Publish run for a few seconds and then end cleanly. `events` is what
 * the project says about live updates. `oldBeads` simulates a Beads too old for the 0.2 features: the capabilities are off and
 * every new route answers `unsupported`, as the service does, so the panel's entry points have to hide.
 */
export function createFakeService({ beadWait = false, writes = () => 'ok', paused = () => 'none', sync: syncMode = () => 'idle', events = () => 'unavailable', oldBeads = () => false, oldSchema = () => false, sharedSchema = () => false }: Options = {}): FakeService {
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
  /** The update ran for this page; it resets when the preview goes back to a current store. */
  let schemaFixed = false;
  /**
   * The one-time update as the service runs it: started at once, ended a moment later. The outcome is chosen when it starts (`fixed`: the
   * store ends up updated; `failure`: the answer the job ends with), and applied when it ends, as the snapshot's `schemaUpdateJob` shows.
   */
  let updating: { until: number; fixed: boolean; failure: Answer | null } | null = null;
  let updateFailed: UpdateJob | null = null;
  const UPDATE_MS = 2_500;
  const settleUpdate = (): void => {
    if (!updating || Date.now() < updating.until) return;
    const { fixed, failure } = updating;
    updating = null;
    if (fixed) {
      schemaFixed = true;
      revision++;
    }
    const error = failure ? (JSON.parse(failure.body) as ErrorEnvelope).error : null;
    updateFailed = error ? { kind: 'failed', at: new Date().toISOString(), code: error.code, message: error.message, ...(error.detail ? { detail: error.detail } : {}), ...(error.saved ? { saved: true as const } : {}) } : null;
  };
  const schemaOld = (): boolean => {
    if (!oldSchema()) {
      schemaFixed = false;
      updating = null;
      updateFailed = null;
    }
    return oldSchema() && !schemaFixed;
  };
  const schemaSkewed = (directory: string): boolean => schemaOld() && workspaceFor(directory).kind === 'ok' && scenarioOf(directory) !== 'loading' && scenarioOf(directory) !== 'load-error';
  const needsSchemaUpdate = (): Answer => fail(409, { code: 'needs-schema-update', message: SCHEMA_UPDATE_TEXT, detail: SCHEMA_STDERR, schemaUpdate: SCHEMA_SKEW });
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
  /** Each scenario's open gates, and every gate id ever made (a closed gate's edge stays on the bead it blocked). */
  const openGates = new Map<ScenarioId, Gate[]>();
  const gateIds = new Map<ScenarioId, Set<string>>();
  const gatesOf = (id: ScenarioId): Gate[] => {
    let list = openGates.get(id);
    if (!list) {
      openGates.set(id, (list = id === 'needs' ? needsGates() : []));
      gateIds.set(id, new Set(list.map((g) => g.id)));
    }
    return list;
  };
  let gateCount = 1;
  let memories: Memory[] = seedMemories();
  /** Live updates were switched on from the panel. */
  let journalEnabled = false;
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
      // A due date or parent being changed is moved by the agent too, so the conflict has a value of its own to show.
      const moved: Partial<Bead> = {};
      if (patch.due !== undefined) moved.extra = { ...bead.extra, due_at: new Date(Date.now() + 9 * 24 * 3_600_000).toISOString().replace(/\.\d+Z$/, 'Z') };
      // A tick that meets an agent's newer criteria: the agent added a line.
      if (patch.acceptance !== undefined) moved.acceptance = `${bead.acceptance}\n- [ ] Agent: rotate the signing key after the cutover`;
      if (patch.parent !== undefined) moved.parentId = beadsOf(id).find((b) => b.type === 'epic' && b.id !== bead.parentId && b.id !== patch.parent && b.id !== bead.id)?.id ?? null;
      const current = mode === 'conflict' && body.expectedUpdatedAt === bead.updatedAt
        ? put(id, { ...bead, description: `${bead.description}\n\nAgent: refresh tokens need the same treatment.`, priority: 1, ...moved, updatedAt: stamp() })
        : bead;
      return answer({ ok: false, conflict: true, current } satisfies WriteResult);
    }
    if (mode === 'uncertain') return answer({ ok: false, uncertain: true, current: null } satisfies WriteResult);
    const done = statusesOf(id).find((s) => s.name === patch.status)?.category === 'done';
    if (mode === 'blocked' && done) {
      // Like the service: a comment that goes with the close is added first, and stays.
      const comment = patch.closeComment?.trim();
      if (comment) put(id, { ...bead, comments: [...bead.comments, { id: `c-${Date.now()}`, author: 'Alice Tester (panel)', text: comment, createdAt: stamp() }] });
      const message = "This bead can't be closed yet. It is still blocked by scr-3i5. Close those first.";
      return fail(409, { code: 'blocked', message: comment ? `Your comment was added, but the bead could not be closed. ${message}` : message, detail: 'cannot close: blocked by open issues [scr-3i5]' });
    }
    const no = refused(mode, 'change');
    if (no) return no;
    const { closeReason, closeComment: _comment, due, parent, ...fields } = patch;
    // A move under the bead itself or something inside it is refused, as the service does, before anything is written.
    if (typeof parent === 'string') {
      const byId = new Map(beadsOf(id).map((b) => [b.id, b]));
      for (let at: string | null = parent; at !== null; at = byId.get(at)?.parentId ?? null) {
        if (at === bead.id) return fail(400, { code: 'invalid', message: parent === bead.id ? 'A bead cannot go inside itself.' : 'An epic cannot go inside its own child.' });
      }
    }
    const next: Bead = { ...bead, ...fields, updatedAt: stamp() };
    if (parent !== undefined) next.parentId = parent;
    if (due !== undefined) {
      // The panel's own reader stands in for Beads here; text it does not know lands a day out.
      const read = due === null ? null : parseDateInput(due, Date.now(), localZone());
      const extra = { ...bead.extra };
      if (due === null) delete extra.due_at;
      else extra.due_at = (read?.kind === 'ok' ? read.at : new Date(Date.now() + 24 * 3_600_000)).toISOString().replace(/\.\d+Z$/, 'Z');
      next.extra = extra;
    }
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

  const unsupported = (): Answer => fail(501, { code: 'unsupported', message: 'This version of Beads does not support that. It needs Beads 1.3 or newer.' });
  const missing = (): Answer => fail(404, { code: 'not-found', message: 'That bead no longer exists.' });

  function eventsStatus(): EventsStatusResult {
    const mode = events();
    if (oldBeads() || mode === 'unavailable') return { available: false, journal: 'off', live: 'off' };
    if (journalEnabled && (mode === 'journal-off' || mode === 'journal-unknown')) return { available: true, journal: 'on', live: 'following' };
    if (mode === 'journal-off') return { available: true, journal: 'off', live: 'off' };
    if (mode === 'journal-unknown') return { available: true, journal: 'unknown', live: 'off' };
    return { available: true, journal: 'on', live: mode };
  }

  function requestReview(id: ScenarioId, body: Record<string, unknown>): Answer {
    const no = refused(writes(), 'review request');
    if (no) return no;
    const bead = beadsOf(id).find((b) => b.id === body.id);
    if (!bead) return missing();
    const reason = typeof body.reason === 'string' && body.reason ? body.reason : REVIEW_REASON;
    const open = gatesOf(id);
    const existing = open.find((g) => g.kind === 'human' && g.blocks.includes(bead.id) && g.reason === reason);
    if (existing) return answer({ ok: false, code: 'already-open', gate: existing });
    const gate: Gate = { id: `scr-gate-${++gateCount}`, kind: 'human', reason, blocks: [bead.id], createdBy: 'Alice Tester (panel)', createdAt: stamp(), timeoutMs: null, planApproval: reason.startsWith('Approve the plan'), };
    open.push(gate);
    gateIds.get(id)!.add(gate.id);
    put(id, { ...bead, updatedAt: stamp(), dependencies: [...bead.dependencies, link(bead.id, gate.id, 'blocks', 'Alice Tester (panel)', stamp())] });
    return answer({ ok: true, gate });
  }

  function resolveReview(id: ScenarioId, body: Record<string, unknown>): Answer {
    const no = refused(writes(), 'review');
    if (no) return no;
    const open = gatesOf(id);
    const at = open.findIndex((g) => g.id === body.gateId);
    if (at < 0) return answer({ ok: false, code: 'already-resolved', resolvedBy: 'Bob Builder', at: minutesAgo(3) });
    open.splice(at, 1);
    revision++;
    return answer({ ok: true, gateId: String(body.gateId) });
  }

  /** Answering or dismissing a help request: the bead closes, with the answer as a comment when there is one. */
  function human(id: ScenarioId, body: Record<string, unknown>, answered: boolean): Answer {
    const no = refused(writes(), answered ? 'answer' : 'dismissal');
    if (no) return no;
    const bead = beadsOf(id).find((b) => b.id === body.id);
    if (!bead) return answer({ ok: false, code: 'not-open', current: null });
    if (bead.status === 'closed' || !bead.labels.includes('human')) return answer({ ok: false, code: 'not-open', current: bead });
    const at = stamp();
    const comments = answered ? [...bead.comments, { id: `c-${Date.now()}`, author: 'Alice Tester (panel)', text: String(body.response ?? ''), createdAt: at }] : bead.comments;
    const reason = answered ? 'Answered' : typeof body.reason === 'string' && body.reason ? body.reason : 'Dismissed';
    return answer({ ok: true, bead: put(id, { ...bead, status: 'closed', closedAt: at, closeReason: reason, comments, updatedAt: at }) });
  }

  /** Snooze, bring back, supersede and duplicate: a write of the whole bead, answered like `update`. */
  function mark(id: ScenarioId, body: Record<string, unknown>, change: (bead: Bead, at: string) => Bead): Answer {
    const bead = beadsOf(id).find((b) => b.id === body.id);
    if (!bead) return missing();
    const mode = writes();
    if (mode === 'conflict' || body.expectedUpdatedAt !== bead.updatedAt) return answer({ ok: false, conflict: true, current: bead } satisfies WriteResult);
    if (mode === 'uncertain') return answer({ ok: false, uncertain: true, current: null } satisfies WriteResult);
    const no = refused(mode, 'change');
    if (no) return no;
    return answer({ ok: true, bead: put(id, change(bead, stamp())) } satisfies WriteResult);
  }

  function explain(id: ScenarioId, beadId: unknown): Answer {
    const beads = beadsOf(id);
    const bead = beads.find((b) => b.id === beadId);
    if (!bead) return missing();
    const gate = gatesOf(id).find((g) => g.blocks.includes(bead.id));
    let result: ExplainResult;
    if (bead.status === 'closed' || bead.status === 'deferred') result = { state: 'other', blockers: [] };
    else if (gate) result = { state: 'blocked', blockers: [{ id: gate.id, title: gate.reason ?? 'Review', status: 'open' }] };
    else {
      const blockers = bead.dependencies.filter((d) => d.kind === 'blocks').map((d) => beads.find((b) => b.id === d.to)).filter((b): b is Bead => b !== undefined && b.status !== 'closed');
      result = blockers.length ? { state: 'blocked', blockers: blockers.map((b) => ({ id: b.id, title: b.title, status: b.status })) } : READY.includes(bead.id) ? { state: 'ready', blockers: [] } : { state: 'other', blockers: [] };
    }
    return answer(result);
  }

  function history(id: ScenarioId, body: Record<string, unknown>): Answer {
    const bead = beadsOf(id).find((b) => b.id === body.id);
    if (!bead) return missing();
    const all = historyFor(bead);
    const from = typeof body.before === 'string' ? all.findIndex((e) => e.id === body.before) + 1 : 0;
    const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.min(50, body.limit) : 20;
    const entries = all.slice(from, from + limit);
    return answer({ entries, more: from + limit < all.length, labelsKnown: true } satisfies HistoryResult);
  }

  const fingerprint = () => `${memories.length}:${memories.map((m) => `${m.key}=${m.text}`).join('|').length}`;
  const memoryList = (query: unknown): Answer => {
    const q = typeof query === 'string' ? query.toLowerCase() : '';
    const found = q ? memories.filter((m) => m.key.toLowerCase().includes(q) || m.text.toLowerCase().includes(q)) : memories;
    return answer({ memories: found, fingerprint: fingerprint() } satisfies MemoriesResult);
  };
  const keyOf = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 5).join('-') || 'memory';

  /** Write mode Conflict: an agent changed the memory just before the panel's write landed. */
  const agentChanged = (key: unknown): Memory | undefined => {
    const stored = memories.find((m) => m.key === key);
    if (writes() !== 'conflict' || !stored) return stored;
    const changed: Memory = { ...stored, text: `${stored.text} Agents: confirm with the team first.`, changedAt: stamp(), changedBy: 'Claude Code' };
    memories = memories.map((m) => (m.key === key ? changed : m));
    return changed;
  };

  function remember(body: Record<string, unknown>): Answer {
    const no = refused(writes(), 'memory');
    if (no) return no;
    const text = String(body.text ?? '').trim();
    const key = typeof body.key === 'string' && body.key ? body.key : keyOf(text);
    const stored = typeof body.expectedText === 'string' ? agentChanged(key) : memories.find((m) => m.key === key);
    if (typeof body.expectedText === 'string' ? stored?.text !== body.expectedText : stored !== undefined) return answer({ ok: false, code: 'changed', current: stored ?? null });
    const memory: Memory = { key, text, changedAt: stamp(), changedBy: 'Alice Tester (panel)' };
    memories = [memory, ...memories.filter((m) => m.key !== key)];
    return answer({ ok: true, memory });
  }

  function forget(body: Record<string, unknown>): Answer {
    const no = refused(writes(), 'memory');
    if (no) return no;
    const stored = agentChanged(body.key);
    if (!stored || stored.text !== body.expectedText) return answer({ ok: false, code: 'changed', current: stored ?? null });
    memories = memories.filter((m) => m.key !== body.key);
    return answer({ ok: true, memory: null });
  }

  function workspaceFor(directory: string): WorkspaceState {
    const id = scenarioOf(directory);
    if (id === 'needs-first-contact' && confirmed.has(directory)) return { ...ok(false), projectName: 'needs-first-contact' };
    const notReady = NOT_READY[id];
    if (notReady) return notReady;
    const ready = ok(id === 'team' || id === 'conflict');
    const current = id === 'needs' && !oldBeads() ? { ...ready, bdVersion: '1.3.1' } : ready;
    return id === 'empty-project' ? { ...current, projectName: 'empty-project' } : current;
  }

  function snapshot(directory: string, cursor: unknown): Answer | null {
    const id = scenarioOf(directory);
    if (id === 'loading') return null;
    if (id === 'load-error') return fail(500, { code: 'beads-error', message: "Couldn't read beads.", detail: 'bd export: exit status 1\nError: failed to open database: file is locked' });
    const workspace = workspaceFor(directory);
    settleUpdate();
    const skewed = schemaSkewed(directory);
    const freshness: Freshness = {
      // The service checks for changes about every 4 s.
      localRefreshedAt: id === 'stale' ? staleSince : new Date(Math.floor(Date.now() / 4000) * 4000).toISOString(),
      localError: skewed ? SCHEMA_UPDATE_TEXT : id === 'stale' ? "Couldn't read beads. Retrying." : null,
      localErrorDetail: skewed ? SCHEMA_STDERR : id === 'stale' ? 'bd export --readonly: signal: killed (timeout after 15s)' : null,
      schemaUpdate: skewed ? SCHEMA_SKEW : null,
      ...(skewed && (updating || updateFailed) ? { schemaUpdateJob: updating ? ({ kind: 'running', startedAt: minutesAgo(0.02) } as const) : updateFailed } : {}),
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
    const beads = workspace.kind !== 'ok' || id === 'empty-project' || skewed ? [] : beadsOf(id);
    const unseenIds = workspace.kind === 'ok' && beads.length ? unseenFor(id).filter((b) => !seen.has(b)) : [];
    const pause = workspace.kind === 'ok' ? paused() : 'none';
    const old = oldBeads();
    const live = eventsStatus();
    const capabilities: Capabilities = { eventsJournal: live.available, leases: id === 'needs' && !old };
    const gates = workspace.kind === 'ok' ? gatesOf(id) : [];
    const next = `${id}:${workspace.kind}:${unseenIds.length}:${revision}:${pause}:${sync.kind}:${live.available}:${old}:${gates.length}:${skewed}:${updating ? 'u' : (updateFailed?.kind === 'failed' ? updateFailed.code : '')}`;
    if (cursor === next) return answer({ unchanged: true, cursor: next, freshness, sync } satisfies SnapshotResponse);
    const full: SnapshotResponse = {
      unchanged: false,
      cursor: next,
      workspace,
      beads,
      statuses: workspace.kind === 'ok' ? (id === 'showcase' ? SHOWCASE_STATUSES : STATUSES) : [],
      types: workspace.kind === 'ok' ? TYPES : [],
      readyIds: workspace.kind === 'ok' ? READY.filter((r) => !gates.some((g) => g.blocks.includes(r))) : [],
      unseenIds,
      activity: beads.length ? activityFor(id).map((e) => ({ ...e, unseen: e.unseen && !seen.has(e.beadId) })) : [],
      freshness,
      sync,
      writesBlocked: workspace.kind === 'ok' && (paused() === 'blocked' || (sync.kind === 'conflict' && sync.halfMerged)),
      panelActor: workspace.kind === 'ok' ? 'Alice Tester (panel)' : '',
      capabilities,
      gates,
      gateIds: workspace.kind === 'ok' ? [...(gateIds.get(id) ?? [])] : [],
      leases: workspace.kind === 'ok' && capabilities.leases ? needsLeases() : [],
    };
    return answer(full);
  }

  /** The routes the 0.2 features added. With a Beads too old for them, each answers `unsupported`, as the service does. */
  function handleNew(route: ApiRouteName, body: Record<string, unknown>, directory: string): Answer {
    if (oldBeads()) return unsupported();
    const id = scenarioOf(directory);
    switch (route) {
      case 'gateCreate':
        return requestReview(id, body);
      case 'gateResolve':
        return resolveReview(id, body);
      case 'humanRespond':
        return human(id, body, true);
      case 'humanDismiss':
        return human(id, body, false);
      case 'history':
        return history(id, body);
      case 'memories':
        return memoryList(body.query);
      case 'memoryRemember':
        return remember(body);
      case 'memoryForget':
        return forget(body);
      case 'explain':
        return explain(id, body.id);
      case 'deferBead':
        return mark(id, body, (bead, at) => {
          const typed = typeof body.until === 'string' ? new Date(body.until) : null;
          const until = typed && !Number.isNaN(typed.getTime()) ? typed.toISOString() : typeof body.until === 'string' ? new Date(Date.now() + 7 * 24 * 3_600_000).toISOString() : null;
          const extra = { ...bead.extra };
          if (until) extra.defer_until = until;
          else delete extra.defer_until;
          return { ...bead, status: 'deferred', extra, updatedAt: at };
        });
      case 'undeferBead':
        return mark(id, body, (bead, at) => {
          // Like the service: a bead left open with a date keeps its status and loses only the date.
          const { defer_until: _gone, ...extra } = bead.extra;
          return { ...bead, status: bead.status === 'deferred' ? 'open' : bead.status, extra, updatedAt: at };
        });
      case 'supersede':
        return mark(id, body, (bead, at) => ({ ...bead, status: 'closed', closedAt: at, closeReason: `Superseded by ${String(body.with)}`, updatedAt: at, dependencies: [...bead.dependencies, link(bead.id, String(body.with), 'supersedes', 'Alice Tester (panel)', at)] }));
      case 'duplicate':
        return mark(id, body, (bead, at) => ({ ...bead, status: 'closed', closedAt: at, closeReason: `Duplicate of ${String(body.of)}`, updatedAt: at, dependencies: [...bead.dependencies, link(bead.id, String(body.of), 'duplicates', 'Alice Tester (panel)', at)] }));
      default:
        return fail(404, { code: 'NOT_FOUND', message: `No route ${route}.` });
    }
  }

  return {
    async handle(route, body) {
      const directory = String(body.directory ?? '');
      await new Promise((r) => setTimeout(r, 120));
      // As the service does: while the project waits for its update, every write is refused (any write would update the store by itself).
      if (WRITE_ROUTES.has(route) && schemaSkewed(directory)) return needsSchemaUpdate();
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
        case 'migrateSchema': {
          // As the service answers a body without the literal confirm (the same envelope enableEvents uses).
          if (body.confirm !== true) return fail(400, { code: 'BAD_REQUEST', message: 'confirm must be true.' });
          if (!schemaSkewed(directory)) return answer({ ok: true });
          settleUpdate();
          // Already running: nothing is started twice.
          if (updating) return answer({ ok: true });
          updateFailed = null;
          // A store that syncs with the team: Beads refuses to update it in place, and Abacus never forces it.
          if (sharedSchema()) updating = { until: Date.now() + UPDATE_MS, fixed: false, failure: fail(409, { code: 'update-blocked-shared', message: SHARED_STORE_TEXT, detail: SHARED_REFUSAL }) };
          // As the service ends an update that ran but was not read back: updated, with its own words.
          else if (writes() === 'uncertain') updating = { until: Date.now() + UPDATE_MS, fixed: true, failure: fail(504, { code: 'uncertain', message: "The update may have worked, but Beads didn't confirm it.", detail: 'signal: killed (timeout after 15s)', saved: true }) };
          else updating = { until: Date.now() + UPDATE_MS, fixed: refused(writes(), 'update') === null, failure: refused(writes(), 'update') };
          return answer({ ok: true });
        }
        case 'bead': {
          if (schemaSkewed(directory)) return needsSchemaUpdate();
          if (beadWait) return new Promise<Answer>(() => {});
          // After a write that may have saved, Beads is slow to answer the re-read too.
          if (writes() === 'uncertain') await new Promise((r) => setTimeout(r, 4_000));
          const beads = beadsOf(scenarioOf(directory));
          const bead = beads.find((b) => b.id === body.id);
          if (!bead) return fail(404, { code: 'not-found', message: "That bead doesn't exist." });
          return answer({ bead, related: relatedFor(bead, beads) } satisfies BeadResponse);
        }
        case 'context': {
          if (schemaSkewed(directory)) return needsSchemaUpdate();
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
        case 'eventsStatus':
          return answer(eventsStatus());
        case 'enableEvents': {
          if (oldBeads()) return unsupported();
          if (body.confirm !== true) return fail(400, { code: 'invalid', message: 'Turning on live updates needs a confirmation.' });
          // As the service answers a setting that went in but was not read back: in, with its own words.
          if (writes() === 'uncertain') {
            journalEnabled = true;
            revision++;
            return fail(504, { code: 'uncertain', message: "Live updates may be on now, but Beads didn't confirm it.", detail: 'signal: killed (timeout after 15s)' });
          }
          const no = refused(writes(), 'setting');
          if (no) return no;
          journalEnabled = true;
          revision++;
          return answer({ ok: true, status: eventsStatus() });
        }
        default:
          return handleNew(route, body, directory);
      }
    },
  };
}
