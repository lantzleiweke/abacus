import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditEvent } from '../../../src/service/bd/audit';
import { ProjectStore, attributeChanges, beadVersion, defaultStorageDir, diffSnapshots } from '../../../src/service/snapshot';
import type { Bead, ChangeEvent, Comment, Dependency, StatusDef } from '../../../src/shared/types';

const T0 = '2026-10-14T10:00:00.000Z';
const T1 = '2026-10-14T10:05:00.000Z';
const PANEL = 'Ann (panel)';

function bead(id: string, over: Partial<Bead> = {}): Bead {
  return {
    id,
    title: `Title ${id}`,
    status: 'open',
    priority: 2,
    type: 'task',
    assignee: null,
    labels: [],
    parentId: null,
    description: '',
    design: '',
    acceptance: '',
    notes: '',
    createdAt: '2026-10-01 09:00:00',
    createdBy: 'Creator',
    updatedAt: '2026-10-01 09:00:00',
    closedAt: null,
    closeReason: null,
    dependencies: [],
    comments: [],
    extra: {},
    ...over,
  };
}

const dep = (from: string, to: string, kind = 'blocks', createdBy: string | null = 'Dep Maker'): Dependency => ({
  from,
  to,
  kind,
  createdBy,
  createdAt: '2026-10-02 10:00:00',
});

const comment = (id: string, author: string | null, text = 'hello'): Comment => ({ id, author, text, createdAt: '2026-10-02 10:00:00' });

let n = 0;
function audit(over: Partial<AuditEvent> & Pick<AuditEvent, 'beadId' | 'type'>): AuditEvent {
  n += 1;
  return { id: `evt-${n}`, actor: 'Someone', oldValue: null, newValue: null, rawCreatedAt: '2026-10-14 10:00:00', ...over };
}

const updated = (beadId: string, fields: Record<string, unknown>, actor: string | null = 'Someone', id?: string): AuditEvent =>
  audit({ beadId, type: 'updated', actor, newValue: JSON.stringify(fields), oldValue: JSON.stringify({ id: beadId }), ...(id ? { id } : {}) });

const field = (changes: ChangeEvent[], name: string) => changes.find((c) => c.kind === 'field' && c.field === name);

describe('beadVersion', () => {
  it('moves with updatedAt, comment count, and dependencies, not their order', () => {
    const base = bead('a', { dependencies: [dep('a', 'b'), dep('a', 'c')], comments: [comment('1', 'x')] });
    const same = bead('a', { dependencies: [dep('a', 'c'), dep('a', 'b')], comments: [comment('1', 'x')] });
    expect(beadVersion(base)).toBe(beadVersion(same));
    expect(beadVersion(bead('a', { ...base, updatedAt: '2026-10-02 09:00:00' }))).not.toBe(beadVersion(base));
    expect(beadVersion(bead('a', { ...base, comments: [] }))).not.toBe(beadVersion(base));
    expect(beadVersion(bead('a', { ...base, dependencies: [dep('a', 'b')] }))).not.toBe(beadVersion(base));
    expect(beadVersion(bead('a', { ...base, dependencies: [dep('a', 'b'), dep('a', 'c', 'related')] }))).not.toBe(beadVersion(base));
  });
});

describe('diffSnapshots', () => {
  it('reports nothing when nothing changed', () => {
    expect(diffSnapshots([bead('a')], [bead('a')], T0)).toEqual([]);
  });

  it('reports a new bead as created, with the recorded creator', () => {
    const [e, ...rest] = diffSnapshots([], [bead('a', { createdBy: 'Claude Code' })], T0);
    expect(rest).toEqual([]);
    expect(e).toMatchObject({ beadId: 'a', kind: 'created', actor: 'Claude Code', byPanel: false, observedAt: T0 });
    expect(typeof e.id).toBe('string');
  });

  it('reports a missing bead as deleted', () => {
    const [e] = diffSnapshots([bead('a')], [], T0);
    expect(e).toMatchObject({ beadId: 'a', kind: 'deleted', actor: null, observedAt: T0, title: 'Title a' });
  });

  it('keeps a deleted bead\'s title on its deletion, capped like other text', () => {
    const [e] = diffSnapshots([bead('a', { title: 'x'.repeat(5000) })], [], T0);
    expect(e!.title!.length).toBeLessThan(2100);
  });

  it.each<[string, Partial<Bead>, unknown, unknown]>([
    ['title', { title: 'New' }, 'Title a', 'New'],
    ['status', { status: 'in_progress' }, 'open', 'in_progress'],
    ['priority', { priority: 0 }, 2, 0],
    ['type', { type: 'bug' }, 'task', 'bug'],
    ['assignee', { assignee: 'Dana' }, null, 'Dana'],
    ['labels', { labels: ['x'] }, [], ['x']],
    ['description', { description: 'd' }, '', 'd'],
    ['design', { design: 'd' }, '', 'd'],
    ['acceptance', { acceptance: 'd' }, '', 'd'],
    ['notes', { notes: 'd' }, '', 'd'],
    ['parentId', { parentId: 'p' }, null, 'p'],
  ])('reports a %s change as a field event with from and to', (name, over, from, to) => {
    const changes = diffSnapshots([bead('a')], [bead('a', over)], T0);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ beadId: 'a', kind: 'field', field: name, from, to, actor: null, byPanel: false });
  });

  it('reports a change to a "More" field or the close reason as a field event, so a change bd saw always has a row', () => {
    const before = bead('a', { extra: { estimate: 3, gone: 'x', comment_count: 1 } });
    const after = bead('a', { extra: { estimate: 5, added: { k: 1 }, comment_count: 2 }, closeReason: 'Shipped', updatedAt: '2026-10-09 09:00:00' });
    const changes = diffSnapshots([before], [after], T0);
    const byField = Object.fromEntries(changes.map((c) => [c.field, c]));
    expect(Object.keys(byField).sort()).toEqual(['added', 'closeReason', 'estimate', 'gone']);
    expect(byField.estimate).toMatchObject({ kind: 'field', from: 3, to: 5 });
    expect(byField.gone).toMatchObject({ kind: 'field', from: 'x', to: null });
    expect(byField.added).toMatchObject({ kind: 'field', from: null, to: { k: 1 } });
    expect(byField.closeReason).toMatchObject({ kind: 'field', from: null, to: 'Shipped' });
  });

  it('does not report a timestamp alone, a count, or the close reason that came with the close itself', () => {
    expect(diffSnapshots([bead('a')], [bead('a', { updatedAt: '2026-10-09 09:00:00', extra: { dependent_count: 4 } })], T0)).toEqual([]);
    const changes = diffSnapshots([bead('a')], [bead('a', { status: 'closed', closeReason: 'Done' })], T0);
    expect(changes.map((c) => c.kind)).toEqual(['closed']);
  });

  it('folds a started_at that came with the status change into that row, but reports one set on its own', () => {
    const moved = diffSnapshots([bead('a')], [bead('a', { status: 'in_progress', extra: { started_at: '2026-10-14T10:00:00Z' } })], T0);
    expect(moved.map((c) => c.field)).toEqual(['status']);
    const alone = diffSnapshots([bead('a')], [bead('a', { extra: { started_at: '2026-10-14T10:00:00Z' } })], T0);
    expect(alone.map((c) => c.field)).toEqual(['started_at']);
    const changed = diffSnapshots(
      [bead('a', { extra: { started_at: '2026-10-13T10:00:00Z' } })],
      [bead('a', { status: 'in_progress', extra: { started_at: '2026-10-14T10:00:00Z' } })],
      T0,
    );
    expect(changed.map((c) => c.field).sort()).toEqual(['started_at', 'status']);
  });

  it('treats a relabel in a different order as no change', () => {
    expect(diffSnapshots([bead('a', { labels: ['x', 'y'] })], [bead('a', { labels: ['y', 'x'] })], T0)).toEqual([]);
  });

  it('reports several changes to one bead', () => {
    const changes = diffSnapshots([bead('a')], [bead('a', { title: 'T', priority: 1 })], T0);
    expect(changes.map((c) => c.field).sort()).toEqual(['priority', 'title']);
  });

  it('maps status into a done category to closed, and back out to reopened', () => {
    const [closed] = diffSnapshots([bead('a')], [bead('a', { status: 'closed' })], T0);
    expect(closed).toMatchObject({ kind: 'closed', field: 'status', from: 'open', to: 'closed' });
    const [reopened] = diffSnapshots([bead('a', { status: 'closed' })], [bead('a', { status: 'open' })], T0);
    expect(reopened).toMatchObject({ kind: 'reopened', field: 'status', from: 'closed', to: 'open' });
  });

  it('uses the done statuses it is given, so a custom done status closes', () => {
    const done = new Set(['shipped']);
    const [closed] = diffSnapshots([bead('a')], [bead('a', { status: 'shipped' })], T0, done);
    expect(closed.kind).toBe('closed');
    // `closed` is no longer done when the set says so.
    const [plain] = diffSnapshots([bead('a')], [bead('a', { status: 'closed' })], T0, done);
    expect(plain.kind).toBe('field');
  });

  it('keeps a move between two done statuses a plain field change', () => {
    const [e] = diffSnapshots([bead('a', { status: 'closed' })], [bead('a', { status: 'shipped' })], T0, new Set(['closed', 'shipped']));
    expect(e).toMatchObject({ kind: 'field', field: 'status' });
  });

  it('reports a new comment with its author', () => {
    const changes = diffSnapshots(
      [bead('a', { comments: [comment('1', 'x')] })],
      [bead('a', { comments: [comment('1', 'x'), comment('2', 'Claude Code', 'looks good')] })],
      T0,
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'comment', beadId: 'a', actor: 'Claude Code', to: 'looks good' });
  });

  it('leaves byPanel to attributeChanges, which knows the panel actor', () => {
    const [e] = diffSnapshots([bead('a')], [bead('a', { comments: [comment('1', PANEL)] })], T0);
    expect(e).toMatchObject({ actor: PANEL, byPanel: false });
  });

  it('cuts long field text and comment text, ending in an ellipsis', () => {
    const long = 'x'.repeat(2500);
    const [f] = diffSnapshots([bead('a', { description: long })], [bead('a', { description: `${long}y` })], T0);
    expect(f.from).toBe(`${'x'.repeat(2000)}…`);
    expect(f.to).toBe(`${'x'.repeat(2000)}…`);
    const [c] = diffSnapshots([bead('a')], [bead('a', { comments: [comment('1', 'x', 'y'.repeat(600))] })], T0);
    expect(c.to).toBe(`${'y'.repeat(500)}…`);
    // Short text is untouched.
    const [s] = diffSnapshots([bead('a')], [bead('a', { notes: 'short' })], T0);
    expect(s.to).toBe('short');
  });

  it('does not report a parent-child dependency (the parentId field covers it)', () => {
    const link = dep('a', 'p', 'parent-child');
    expect(diffSnapshots([bead('a')], [bead('a', { dependencies: [link], parentId: 'p' })], T0).map((c) => c.kind)).toEqual(['field']);
    expect(diffSnapshots([bead('a', { dependencies: [link] })], [bead('a')], T0)).toEqual([]);
  });

  it('reports dependencies added and removed by key, with the creator', () => {
    const added = diffSnapshots([bead('a')], [bead('a', { dependencies: [dep('a', 'b', 'blocks', 'Dana')] })], T0);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ kind: 'dep_added', beadId: 'a', field: 'blocks', to: 'b', actor: 'Dana' });
    const removed = diffSnapshots([bead('a', { dependencies: [dep('a', 'b')] })], [bead('a')], T0);
    expect(removed[0]).toMatchObject({ kind: 'dep_removed', beadId: 'a', field: 'blocks', from: 'b', actor: null });
  });

  it('treats the same target under a different dependency kind as a different dependency', () => {
    const changes = diffSnapshots([bead('a', { dependencies: [dep('a', 'b', 'blocks')] })], [bead('a', { dependencies: [dep('a', 'b', 'related')] })], T0);
    expect(changes.map((c) => c.kind).sort()).toEqual(['dep_added', 'dep_removed']);
  });

  it('gives every event its own id', () => {
    const changes = diffSnapshots([bead('a')], [bead('a', { title: 'T', priority: 1 }), bead('b')], T0);
    expect(new Set(changes.map((c) => c.id)).size).toBe(changes.length);
  });
});

describe('attributeChanges', () => {
  const change = (over: Partial<ChangeEvent>): ChangeEvent => ({
    id: 'c1',
    beadId: 'a',
    kind: 'field',
    field: 'priority',
    from: 2,
    to: 1,
    actor: null,
    byPanel: false,
    observedAt: T0,
    ...over,
  });

  it('leaves actors from the bead data when there is no audit log', () => {
    const [out] = attributeChanges([change({ kind: 'comment', field: undefined, actor: 'Claude Code' })], null, PANEL);
    expect(out.actor).toBe('Claude Code');
    const [none] = attributeChanges([change({})], null, PANEL);
    expect(none.actor).toBeNull();
  });

  it('takes the actor from the audit event that changed the same field to the same value', () => {
    const [out] = attributeChanges([change({})], [updated('a', { priority: 1 }, 'Claude Code')], PANEL);
    expect(out.actor).toBe('Claude Code');
  });

  it('ignores events of another bead, another field, or another value', () => {
    const events = [updated('b', { priority: 1 }, 'B'), updated('a', { title: 'x' }, 'Title'), updated('a', { priority: 4 }, 'Wrong value')];
    expect(attributeChanges([change({})], events, PANEL)[0].actor).toBeNull();
  });

  it('takes the newest unused event when several match', () => {
    const newest = updated('a', { priority: 1 }, 'Newest');
    const older = updated('a', { priority: 1 }, 'Older');
    expect(attributeChanges([change({})], [newest, older], PANEL)[0].actor).toBe('Newest');
  });

  it('gives a closed change the reason from the matched audit closed event, and nothing else ever sets one', () => {
    const closed = change({ kind: 'closed', field: 'status', from: 'open', to: 'shipped' });
    const [withReason] = attributeChanges([closed], [audit({ beadId: 'a', type: 'closed', actor: 'X', newValue: 'Shipped to prod' })], PANEL);
    expect(withReason.reason).toBe('Shipped to prod');
    const [blank] = attributeChanges([closed], [audit({ beadId: 'a', type: 'closed', actor: 'X', newValue: null })], PANEL);
    expect('reason' in blank).toBe(false);
    const viaStatus = audit({ beadId: 'a', type: 'status_changed', newValue: '{"status":"shipped"}' });
    expect('reason' in attributeChanges([closed], [viaStatus], PANEL)[0]).toBe(false);
    const reopened = change({ kind: 'reopened', field: 'status', from: 'shipped', to: 'open' });
    const [back] = attributeChanges([reopened], [audit({ beadId: 'a', type: 'reopened', newValue: 'because' })], PANEL);
    expect('reason' in back).toBe(false);
  });

  it('lets one event attribute one change per field it contains: a status_changed event with priority, status and title', () => {
    // Shaped like test/fixtures/server/reads/sql-events-recent.json: one event, three fields.
    const multi = audit({
      beadId: 'a',
      type: 'status_changed',
      actor: 'Panel Tester',
      newValue: '{"priority":2,"status":"in_progress","title":"Multi edit"}',
      oldValue: '{"id":"a","title":"Old","status":"blocked","priority":0}',
    });
    const changes = diffSnapshots(
      [bead('a', { title: 'Old', status: 'blocked', priority: 0 })],
      [bead('a', { title: 'Multi edit', status: 'in_progress', priority: 2 })],
      T0,
    );
    expect(changes.map((c) => c.field)).toEqual(['title', 'status', 'priority']);
    const used = new Set<string>();
    const out = attributeChanges(changes, [multi], PANEL, used);
    expect(out.map((c) => c.actor)).toEqual(['Panel Tester', 'Panel Tester', 'Panel Tester']);
    expect([...used]).toEqual([multi.id]);
  });

  it('attributes both fields of a claimed event, and still checks each value', () => {
    const claimed = audit({ beadId: 'a', type: 'claimed', actor: 'Claude Code', newValue: '{"assignee":"Claude Code","status":"in_progress"}' });
    const changes = diffSnapshots([bead('a')], [bead('a', { status: 'in_progress', assignee: 'Claude Code' })], T0);
    expect(attributeChanges(changes, [claimed], PANEL).map((c) => c.actor)).toEqual(['Claude Code', 'Claude Code']);
    // A status that is not the claimed one is not attributed to the claim.
    const other = diffSnapshots([bead('a')], [bead('a', { status: 'blocked', assignee: 'Claude Code' })], T0);
    expect(attributeChanges(other, [claimed], PANEL).map((c) => [c.field, c.actor])).toEqual([
      ['status', null],
      ['assignee', 'Claude Code'],
    ]);
  });

  it('still never attributes two changes to the same field from one event', () => {
    const claimed = audit({ beadId: 'a', type: 'claimed', actor: 'Claude Code' });
    const out = attributeChanges([change({ id: 'c1', field: 'assignee', from: null, to: 'A' }), change({ id: 'c2', field: 'assignee', from: 'A', to: 'B' })], [claimed], PANEL);
    expect(out.map((c) => c.actor)).toEqual(['Claude Code', null]);
  });

  it('puts the matched event\'s real time (UUIDv7) in changedAt and keeps observedAt as the service time', () => {
    const ms = Date.parse('2026-10-14T09:59:00.000Z');
    const hex = ms.toString(16).padStart(12, '0');
    const timed = updated('a', { priority: 1 }, 'X', `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-000000000000`);
    expect(attributeChanges([change({})], [timed], PANEL)[0]).toMatchObject({ observedAt: T0, changedAt: '2026-10-14T09:59:00.000Z' });
    const untimed = attributeChanges([change({})], [updated('a', { priority: 1 }, 'X')], PANEL)[0];
    expect(untimed.observedAt).toBe(T0);
    expect(untimed.changedAt).toBeUndefined();
  });

  it('still matches a long text change, whose value in the change is cut but in the audit log is not', () => {
    const long = 'z'.repeat(2500);
    const changes = diffSnapshots([bead('a')], [bead('a', { description: long })], T0);
    expect(attributeChanges(changes, [updated('a', { description: long }, 'Writer')], PANEL)[0].actor).toBe('Writer');
  });

  it('falls back to field-only matching for status and claim events that carry no values', () => {
    expect(attributeChanges([change({ field: 'status', from: 'open', to: 'x' })], [audit({ beadId: 'a', type: 'status_changed', actor: 'SC' })], PANEL)[0].actor).toBe('SC');
  });

  it('records the event ids it used and skips ids already used', () => {
    const e1 = updated('a', { priority: 1 }, 'First', 'id-1');
    const used = new Set<string>();
    expect(attributeChanges([change({})], [e1], PANEL, used)[0].actor).toBe('First');
    expect([...used]).toEqual(['id-1']);
    // The same event does not attribute a later, identical change.
    expect(attributeChanges([change({ id: 'c9' })], [e1], PANEL, used)[0].actor).toBeNull();
  });

  it('matches status_changed, closed, reopened, and renamed events', () => {
    expect(
      attributeChanges(
        [change({ field: 'status', from: 'open', to: 'in_progress' })],
        [audit({ beadId: 'a', type: 'status_changed', actor: 'SC', newValue: '{"status":"in_progress"}' })],
        PANEL,
      )[0].actor,
    ).toBe('SC');
    expect(
      attributeChanges([change({ kind: 'closed', field: 'status', from: 'open', to: 'closed' })], [audit({ beadId: 'a', type: 'closed', actor: 'Closer', newValue: 'done' })], PANEL)[0].actor,
    ).toBe('Closer');
    expect(
      attributeChanges([change({ kind: 'reopened', field: 'status', from: 'closed', to: 'open' })], [audit({ beadId: 'a', type: 'reopened', actor: 'Opener' })], PANEL)[0].actor,
    ).toBe('Opener');
    expect(attributeChanges([change({ field: 'title', from: 'a', to: 'b' })], [audit({ beadId: 'a', type: 'renamed', actor: 'Renamer' })], PANEL)[0].actor).toBe('Renamer');
  });

  it('maps bd column names: issue_type for type, acceptance_criteria for acceptance, and label events for labels', () => {
    expect(attributeChanges([change({ field: 'type', from: 'task', to: 'bug' })], [updated('a', { issue_type: 'bug' }, 'T')], PANEL)[0].actor).toBe('T');
    expect(attributeChanges([change({ field: 'acceptance', from: '', to: 'ok' })], [updated('a', { acceptance_criteria: 'ok' }, 'A')], PANEL)[0].actor).toBe('A');
    expect(attributeChanges([change({ field: 'labels', from: [], to: ['x'] })], [audit({ beadId: 'a', type: 'label_added', actor: 'L' })], PANEL)[0].actor).toBe('L');
    expect(attributeChanges([change({ field: 'labels', from: ['x'], to: [] })], [audit({ beadId: 'a', type: 'label_removed', actor: 'L2' })], PANEL)[0].actor).toBe('L2');
  });

  it('takes an actor for a created bead only when the data has none', () => {
    const c = change({ kind: 'created', field: undefined, from: undefined, to: undefined });
    expect(attributeChanges([{ ...c, actor: 'FromData' }], [audit({ beadId: 'a', type: 'created', actor: 'FromAudit' })], PANEL)[0].actor).toBe('FromData');
    expect(attributeChanges([c], [audit({ beadId: 'a', type: 'created', actor: 'FromAudit' })], PANEL)[0].actor).toBe('FromAudit');
  });

  it('flags only the panel actor itself as byPanel, never another person\'s " (panel)" name', () => {
    expect(attributeChanges([change({})], [updated('a', { priority: 1 }, 'Dana (panel)')], PANEL)[0]).toMatchObject({ actor: 'Dana (panel)', byPanel: false });
    expect(attributeChanges([change({})], [updated('a', { priority: 1 }, 'Claude Code')], PANEL)[0].byPanel).toBe(false);
    expect(attributeChanges([change({})], [updated('a', { priority: 1 }, PANEL)], PANEL)[0].byPanel).toBe(true);
    // Comment and dependency actors come from the bead data and are judged the same way.
    expect(attributeChanges([change({ kind: 'comment', field: undefined, actor: PANEL })], null, PANEL)[0].byPanel).toBe(true);
    expect(attributeChanges([change({ kind: 'comment', field: undefined, actor: 'Dana (panel)' })], null, PANEL)[0].byPanel).toBe(false);
  });

  it('does not touch the input events', () => {
    const input = change({});
    attributeChanges([input], [updated('a', { priority: 1 }, 'X')], PANEL);
    expect(input.actor).toBeNull();
  });
});

describe('defaultStorageDir', () => {
  it('uses $XDG_DATA_HOME when set', () => {
    expect(defaultStorageDir({ XDG_DATA_HOME: '/data/xdg' })).toBe(join('/data/xdg', 'openchamber-beads'));
  });

  it('falls back to ~/.local/share when it is unset or empty', () => {
    const expected = join(homedir(), '.local', 'share', 'openchamber-beads');
    expect(defaultStorageDir({})).toBe(expected);
    expect(defaultStorageDir({ XDG_DATA_HOME: '' })).toBe(expected);
  });

  it('ignores a relative $XDG_DATA_HOME, as the XDG spec says', () => {
    expect(defaultStorageDir({ XDG_DATA_HOME: 'relative/dir' })).toBe(join(homedir(), '.local', 'share', 'openchamber-beads'));
  });
});

describe('ProjectStore', () => {
  let dir: string;
  const ROOT = '/projects/demo';
  const statuses: StatusDef[] = [
    { name: 'open', category: 'active', icon: null },
    { name: 'closed', category: 'done', icon: null },
    { name: 'shipped', category: 'done', icon: null },
  ];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ocb-snapshot-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function store(root = ROOT): Promise<ProjectStore> {
    const s = new ProjectStore(root, dir);
    await s.load();
    return s;
  }
  const file = (root = ROOT) => join(dir, `${createHash('sha1').update(root).digest('hex')}.json`);

  it('first snapshot establishes baseline: nothing unseen, no change events', async () => {
    const s = await store();
    const events = s.apply([bead('a'), bead('b'), bead('c')], [audit({ beadId: 'a', type: 'created' })], PANEL, T0, statuses);
    expect(events).toEqual([]);
    expect(s.unseenIds()).toEqual([]);
    expect(s.activity(10)).toEqual([]);
  });

  it('flags later changes as unseen and new beads too', async () => {
    const s = await store();
    s.apply([bead('a'), bead('b')], null, PANEL, T0, statuses);
    const events = s.apply([bead('a', { title: 'New', updatedAt: '2026-10-14 10:00:00' }), bead('b'), bead('c')], null, PANEL, T1, statuses);
    expect(events.map((e) => [e.beadId, e.kind]).sort()).toEqual([['a', 'field'], ['c', 'created']]);
    expect(s.unseenIds().sort()).toEqual(['a', 'c']);
  });

  it('flags a change that only moves the version (comment or dependency)', async () => {
    const s = await store();
    s.apply([bead('a')], null, PANEL, T0, statuses);
    s.apply([bead('a', { comments: [comment('1', 'Claude Code')] })], null, PANEL, T1, statuses);
    expect(s.unseenIds()).toEqual(['a']);
  });

  it('markSeen clears the given ids, and "all" clears everything', async () => {
    const s = await store();
    s.apply([bead('a'), bead('b'), bead('c')], null, PANEL, T0, statuses);
    s.apply([bead('a', { title: 'x', updatedAt: 'u1' }), bead('b', { title: 'y', updatedAt: 'u1' }), bead('c', { title: 'z', updatedAt: 'u1' })], null, PANEL, T1, statuses);
    s.markSeen(['a', 'unknown-id']);
    expect(s.unseenIds().sort()).toEqual(['b', 'c']);
    s.markSeen('all');
    expect(s.unseenIds()).toEqual([]);
  });

  it('a seen bead becomes unseen again on the next change', async () => {
    const s = await store();
    s.apply([bead('a')], null, PANEL, T0, statuses);
    s.apply([bead('a', { title: 'x', updatedAt: 'u1' })], null, PANEL, T1, statuses);
    s.markSeen(['a']);
    s.apply([bead('a', { title: 'y', updatedAt: 'u2' })], null, PANEL, T1, statuses);
    expect(s.unseenIds()).toEqual(['a']);
  });

  it('auto-sees a bead whose changes were all made by the panel', async () => {
    const s = await store();
    s.apply([bead('a')], null, PANEL, T0, statuses);
    const next = [bead('a', { priority: 1, updatedAt: 'u1' })];
    const events = s.apply(next, [updated('a', { priority: 1 }, PANEL)], PANEL, T1, statuses);
    expect(events[0]).toMatchObject({ actor: PANEL, byPanel: true });
    expect(s.unseenIds()).toEqual([]);
  });

  it('a panel move to in progress that also sets started_at leaves the bead seen, with no unknown row; an agent move adds only the status row', async () => {
    const s = await store();
    s.apply([bead('a'), bead('b')], null, PANEL, T0, statuses);
    const started = { started_at: '2026-10-14T10:05:00Z' };
    s.recordPanelWrite('a', { fields: ['status'] });
    const events = s.apply(
      [bead('a', { status: 'in_progress', extra: started, updatedAt: 'u1' }), bead('b', { status: 'in_progress', extra: started, updatedAt: 'u1' })],
      [updated('b', { status: 'in_progress' }, 'Claude Code')],
      PANEL,
      T1,
      statuses,
    );
    expect(events.filter((e) => e.beadId === 'a').map((e) => [e.field, e.byPanel])).toEqual([['status', true]]);
    expect(events.filter((e) => e.beadId === 'b').map((e) => [e.field, e.actor])).toEqual([['status', 'Claude Code']]);
    expect(s.unseenIds()).toEqual(['b']);
  });

  it('does not auto-see when someone else also changed the bead in the same refresh', async () => {
    const s = await store();
    s.apply([bead('a')], null, PANEL, T0, statuses);
    s.apply([bead('a', { priority: 1, title: 'x', updatedAt: 'u1' })], [updated('a', { priority: 1 }, PANEL)], PANEL, T1, statuses);
    expect(s.unseenIds()).toEqual(['a']);
  });

  it('does not let a panel change hide an earlier unseen change by someone else', async () => {
    const s = await store();
    s.apply([bead('a')], null, PANEL, T0, statuses);
    s.apply([bead('a', { title: 'by agent', updatedAt: 'u1' })], null, PANEL, T0, statuses);
    s.apply([bead('a', { title: 'by agent', priority: 0, updatedAt: 'u2' })], [updated('a', { priority: 0 }, PANEL)], PANEL, T1, statuses);
    expect(s.unseenIds()).toEqual(['a']);
  });

  it('auto-sees a bead the panel created', async () => {
    const s = await store();
    s.apply([bead('a')], null, PANEL, T0, statuses);
    s.apply([bead('a'), bead('b', { createdBy: PANEL })], null, PANEL, T1, statuses);
    expect(s.unseenIds()).toEqual([]);
  });

  it('does not auto-see a change made by another person whose name ends in " (panel)"', async () => {
    const s = await store();
    s.apply([bead('a')], null, PANEL, T0, statuses);
    const [e] = s.apply([bead('a', { priority: 1, updatedAt: 'u1' })], [updated('a', { priority: 1 }, 'Dana (panel)')], PANEL, T1, statuses);
    expect(e).toMatchObject({ actor: 'Dana (panel)', byPanel: false });
    expect(s.unseenIds()).toEqual(['a']);
  });

  describe('recordPanelWrite', () => {
    it('attributes a dependency removal to the panel and auto-sees it', async () => {
      const s = await store();
      s.apply([bead('a', { dependencies: [dep('a', 'b')] }), bead('b')], null, PANEL, T0, statuses);
      s.recordPanelWrite('a', { deps: [['a', 'b']] });
      const events = s.apply([bead('a', { updatedAt: 'u1' }), bead('b')], null, PANEL, T1, statuses);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ beadId: 'a', kind: 'dep_removed', actor: PANEL, byPanel: true });
      expect(s.unseenIds()).toEqual([]);
    });

    it('attributes the fields and links the panel wrote, with no audit events at all', async () => {
      const s = await store();
      s.apply([bead('a'), bead('b')], null, PANEL, T0, statuses);
      s.recordPanelWrite('a', { fields: ['title'] });
      s.recordPanelWrite('a', { deps: [['a', 'b']] });
      const events = s.apply([bead('a', { title: 'New', updatedAt: 'u1', dependencies: [dep('a', 'b', 'related', null)] }), bead('b')], null, PANEL, T1, statuses);
      expect(events.map((e) => e.kind).sort()).toEqual(['dep_added', 'field']);
      for (const e of events) expect(e).toMatchObject({ actor: PANEL, byPanel: true });
      expect(s.unseenIds()).toEqual([]);
    });

    it('leaves what the panel did not write as unknown, and the bead unseen, when the audit log has nothing', async () => {
      const s = await store();
      s.apply([bead('a'), bead('b'), bead('c')], null, PANEL, T0, statuses);
      s.recordPanelWrite('a', { fields: ['title'], deps: [['a', 'b']] });
      const events = s.apply(
        [bead('a', { title: 'Mine', priority: 0, updatedAt: 'u1', dependencies: [dep('a', 'c', 'related', null)] }), bead('b'), bead('c')],
        null,
        PANEL,
        T1,
        statuses,
      );
      expect(events.find((e) => e.field === 'title')).toMatchObject({ actor: PANEL, byPanel: true });
      expect(events.find((e) => e.field === 'priority')).toMatchObject({ actor: null, byPanel: false });
      expect(events.find((e) => e.kind === 'dep_added')).toMatchObject({ actor: null, byPanel: false });
      expect(s.unseenIds()).toEqual(['a']);
    });

    it('expires after the next apply', async () => {
      const s = await store();
      s.apply([bead('a')], null, PANEL, T0, statuses);
      s.recordPanelWrite('a', { fields: ['title'] });
      s.apply([bead('a')], null, PANEL, T0, statuses);
      const events = s.apply([bead('a', { title: 'By someone', updatedAt: 'u1' })], null, PANEL, T1, statuses);
      expect(events[0]).toMatchObject({ actor: null, byPanel: false });
      expect(s.unseenIds()).toEqual(['a']);
    });

    it('does not touch other beads', async () => {
      const s = await store();
      s.apply([bead('a'), bead('b')], null, PANEL, T0, statuses);
      s.recordPanelWrite('a', { fields: ['title'] });
      const events = s.apply([bead('a', { title: 'x', updatedAt: 'u1' }), bead('b', { title: 'y', updatedAt: 'u1' })], null, PANEL, T1, statuses);
      expect(events.find((e) => e.beadId === 'b')).toMatchObject({ actor: null, byPanel: false });
      expect(s.unseenIds()).toEqual(['b']);
    });

    it('leaves a change another actor is recorded for, and then does not auto-see the bead', async () => {
      const s = await store();
      s.apply([bead('a')], null, PANEL, T0, statuses);
      s.recordPanelWrite('a', { fields: ['title'] });
      const events = s.apply(
        [bead('a', { title: 'x', priority: 0, updatedAt: 'u1' })],
        [updated('a', { priority: 0 }, 'Claude Code')],
        PANEL,
        T1,
        statuses,
      );
      expect(events.find((e) => e.field === 'priority')).toMatchObject({ actor: 'Claude Code', byPanel: false });
      expect(events.find((e) => e.field === 'title')).toMatchObject({ actor: PANEL, byPanel: true });
      expect(s.unseenIds()).toEqual(['a']);
    });

    it('does not auto-see over an earlier unseen change by someone else', async () => {
      const s = await store();
      s.apply([bead('a')], null, PANEL, T0, statuses);
      s.apply([bead('a', { title: 'by agent', updatedAt: 'u1' })], null, PANEL, T0, statuses);
      s.recordPanelWrite('a', { fields: ['title'] });
      s.apply([bead('a', { title: 'by agent', priority: 0, updatedAt: 'u2' })], null, PANEL, T1, statuses);
      expect(s.unseenIds()).toEqual(['a']);
    });

    it('is cleared by the baseline apply too, and never saved to disk', async () => {
      const s = await store();
      s.recordPanelWrite('a', { fields: ['title'] });
      s.apply([bead('a')], null, PANEL, T0, statuses);
      const events = s.apply([bead('a', { title: 'x', updatedAt: 'u1' })], null, PANEL, T1, statuses);
      expect(events[0]).toMatchObject({ actor: null, byPanel: false });
      s.recordPanelWrite('a', { fields: ['title'] });
      await s.save();
      expect(await readFile(file(), 'utf8')).not.toContain('recordPanelWrite');
      const reloaded = await store();
      const again = reloaded.apply([bead('a', { title: 'y', updatedAt: 'u2' })], null, PANEL, T1, statuses);
      expect(again[0]).toMatchObject({ actor: null, byPanel: false });
    });
  });

  describe('isEventUnseen', () => {
    it('is true for events newer than the last time the bead was marked seen, while the bead is unseen', async () => {
      const s = await store();
      s.apply([bead('a'), bead('b')], null, PANEL, '2026-10-14T10:00:00.000Z', statuses);
      const first = s.apply([bead('a', { title: 'one', updatedAt: 'u1' }), bead('b')], null, PANEL, '2026-10-14T10:01:00.000Z', statuses);
      expect(first.map((e) => s.isEventUnseen(e))).toEqual([true]);
      s.markSeen(['a'], '2026-10-14T10:02:00.000Z');
      expect(s.isEventUnseen(first[0])).toBe(false);
      const second = s.apply([bead('a', { title: 'two', updatedAt: 'u2' }), bead('b')], null, PANEL, '2026-10-14T10:03:00.000Z', statuses);
      expect(s.isEventUnseen(second[0])).toBe(true);
      // The older event stays seen even though the bead is unseen again.
      expect(s.isEventUnseen(first[0])).toBe(false);
    });

    it('is true when the bead was never marked seen, and for a deletion; false once everything is marked seen', async () => {
      const s = await store();
      s.apply([bead('a'), bead('gone')], null, PANEL, T0, statuses);
      const events = s.apply([bead('a', { title: 'x', updatedAt: 'u1' }), bead('c')], null, PANEL, T1, statuses);
      const byKind = Object.fromEntries(events.map((e) => [e.kind, e]));
      expect(s.isEventUnseen(byKind.field)).toBe(true);
      expect(s.isEventUnseen(byKind.created)).toBe(true);
      expect(s.isEventUnseen(byKind.deleted)).toBe(true);
      s.markSeen('all', '2099-01-01T00:00:00.000Z');
      expect(events.some((e) => s.isEventUnseen(e))).toBe(false);
    });

    it('uses the service clock: a change attributed to an event from before the mark, seen after it, is unseen', async () => {
      const s = await store();
      s.apply([bead('a')], null, PANEL, '2026-10-14T10:00:00.000Z', statuses);
      s.markSeen(['a'], '2026-10-14T10:02:00.000Z');
      const ms = Date.parse('2026-10-14T10:01:00.000Z');
      const hex = ms.toString(16).padStart(12, '0');
      const timed = updated('a', { title: 'x' }, 'Writer', `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-000000000000`);
      const [e] = s.apply([bead('a', { title: 'x', updatedAt: 'u1' })], [timed], PANEL, '2026-10-14T10:03:00.000Z', statuses);
      expect(e).toMatchObject({ actor: 'Writer', observedAt: '2026-10-14T10:03:00.000Z', changedAt: '2026-10-14T10:01:00.000Z' });
      expect(s.isEventUnseen(e)).toBe(true);
    });

    it('does not light up backfilled history of a bead that was never opened when it later changes', async () => {
      const s = await store();
      s.backfill([updated('a', { priority: 1 }, 'Old Actor', 'old-1')], PANEL);
      s.apply([bead('a')], null, PANEL, T0, statuses);
      const history = s.activity(10);
      expect(history).toHaveLength(1);
      const [fresh] = s.apply([bead('a', { title: 'x', updatedAt: 'u1' })], null, PANEL, T1, statuses);
      expect(s.isEventUnseen(fresh)).toBe(true);
      expect(history.map((e) => s.isEventUnseen(e))).toEqual([false]);
    });

    it('counts a deletion as unseen until markSeen, though the bead is gone', async () => {
      const s = await store();
      s.apply([bead('a'), bead('gone')], null, PANEL, T0, statuses);
      const [deleted] = s.apply([bead('a')], null, PANEL, T1, statuses);
      expect(deleted.kind).toBe('deleted');
      expect(s.isEventUnseen(deleted)).toBe(true);
      s.markSeen('all', '2026-10-14T10:06:00.000Z');
      expect(s.isEventUnseen(deleted)).toBe(false);
    });

    it('can dismiss a deletion by id, and forgets a gone bead\'s mark after 30 days', async () => {
      const s = await store();
      s.apply([bead('a'), bead('gone')], null, PANEL, T0, statuses);
      const [deleted] = s.apply([bead('a')], null, PANEL, T1, statuses);
      s.markSeen(['gone'], '2026-10-14T10:06:00.000Z');
      expect(s.isEventUnseen(deleted)).toBe(false);
      await s.save();
      expect(JSON.parse(await readFile(file(), 'utf8')).seenAt.gone).toBe('2026-10-14T10:06:00.000Z');
      s.apply([bead('a')], null, PANEL, '2026-11-20T10:00:00.000Z', statuses);
      await s.save();
      expect(JSON.parse(await readFile(file(), 'utf8')).seenAt.gone).toBeUndefined();
    });

    it('is false for a panel change that was auto-seen', async () => {
      const s = await store();
      s.apply([bead('a')], null, PANEL, T0, statuses);
      const [e] = s.apply([bead('a', { priority: 1, updatedAt: 'u1' })], [updated('a', { priority: 1 }, PANEL)], PANEL, T1, statuses);
      expect(s.isEventUnseen(e)).toBe(false);
    });
  });

  describe('deletions of beads that were never marked seen', () => {
    it('counts the deletion as unseen until markSeen, and lists it in unseenDeletionIds', async () => {
      const s = await store();
      s.apply([bead('a')], null, PANEL, T0, statuses);
      s.apply([bead('a'), bead('c')], null, PANEL, T1, statuses);
      const [deleted] = s.apply([bead('a')], null, PANEL, '2026-10-14T10:10:00.000Z', statuses);
      expect(deleted).toMatchObject({ beadId: 'c', kind: 'deleted' });
      expect(s.isEventUnseen(deleted)).toBe(true);
      expect(s.unseenDeletionIds()).toEqual(['c']);
      s.markSeen(['c'], '2026-10-14T10:11:00.000Z');
      expect(s.isEventUnseen(deleted)).toBe(false);
      expect(s.unseenDeletionIds()).toEqual([]);
    });

    it('keeps the never-seen marker across a save and load', async () => {
      const s = await store();
      s.apply([bead('a')], null, PANEL, T0, statuses);
      s.apply([bead('a'), bead('c')], null, PANEL, T1, statuses);
      s.apply([bead('a')], null, PANEL, '2026-10-14T10:10:00.000Z', statuses);
      await s.save();
      const again = await store();
      expect(again.unseenDeletionIds()).toEqual(['c']);
    });

    it('lists a deletion once, and not a deleted bead that came back', async () => {
      const s = await store();
      s.apply([bead('a'), bead('gone')], null, PANEL, T0, statuses);
      s.apply([bead('a')], null, PANEL, T1, statuses);
      expect(s.unseenDeletionIds()).toEqual(['gone']);
      s.apply([bead('a'), bead('gone', { updatedAt: 'u2' })], null, PANEL, '2026-10-14T10:10:00.000Z', statuses);
      expect(s.unseenDeletionIds()).toEqual([]);
    });
  });

  it('never flags a historical row as unseen, even for a bead that is unseen now', async () => {
    const s = await store();
    s.backfill([audit({ beadId: 'c', type: 'created', actor: 'Old Actor' })], PANEL);
    s.apply([bead('a')], null, PANEL, T0, statuses);
    s.apply([bead('a'), bead('c')], null, PANEL, T1, statuses);
    expect(s.unseenIds()).toEqual(['c']);
    const history = s.activity(10).filter((e) => e.historical);
    expect(history).toHaveLength(1);
    expect(s.isEventUnseen(history[0])).toBe(false);
  });

  it('revision moves when apply sees changes, backfill adds rows, or seen state changes, and holds still otherwise', async () => {
    const s = await store();
    const r0 = s.revision();
    s.backfill([audit({ beadId: 'a', type: 'created' })], PANEL);
    const r1 = s.revision();
    expect(r1).toBeGreaterThan(r0);
    s.apply([bead('a')], null, PANEL, T0, statuses);
    const r2 = s.revision();
    expect(r2).toBeGreaterThan(r1);
    s.apply([bead('a')], null, PANEL, T1, statuses);
    expect(s.revision()).toBe(r2);
    s.apply([bead('a', { title: 'x', updatedAt: 'u1' })], null, PANEL, T1, statuses);
    const r3 = s.revision();
    expect(r3).toBeGreaterThan(r2);
    s.markSeen('all', T1);
    expect(s.revision()).toBeGreaterThan(r3);
  });

  it('maps a move into a done-category status to closed, using the project statuses', async () => {
    const s = await store();
    s.apply([bead('a')], null, PANEL, T0, statuses);
    const [e] = s.apply([bead('a', { status: 'shipped', updatedAt: 'u1' })], null, PANEL, T1, statuses);
    expect(e.kind).toBe('closed');
  });

  it('treats closed as the only done status when no statuses are known', async () => {
    const s = await store();
    s.apply([bead('a'), bead('b')], null, PANEL, T0, []);
    const events = s.apply([bead('a', { status: 'closed', updatedAt: 'u1' }), bead('b', { status: 'shipped', updatedAt: 'u1' })], null, PANEL, T1, []);
    expect(events.find((e) => e.beadId === 'a')?.kind).toBe('closed');
    expect(events.find((e) => e.beadId === 'b')?.kind).toBe('field');
  });

  it('drops deleted beads from the unseen set', async () => {
    const s = await store();
    s.apply([bead('a'), bead('b')], null, PANEL, T0, statuses);
    const events = s.apply([bead('a')], null, PANEL, T1, statuses);
    expect(events.map((e) => [e.beadId, e.kind])).toEqual([['b', 'deleted']]);
    expect(s.unseenIds()).toEqual([]);
  });

  it('changedBeadIds lists beads that differ from the snapshot without mutating anything', async () => {
    const s = await store();
    expect(s.changedBeadIds([bead('a')])).toEqual([]);
    s.apply([bead('a'), bead('b'), bead('c')], null, PANEL, T0, statuses);
    const next = [bead('a', { title: 'x', priority: 0 }), bead('b'), bead('d')];
    expect(s.changedBeadIds(next).sort()).toEqual(['a', 'c', 'd']);
    expect(s.activity(10)).toEqual([]);
    expect(s.unseenIds()).toEqual([]);
    const events = s.apply(next, null, PANEL, T1, statuses);
    expect(new Set(events.map((e) => e.beadId))).toEqual(new Set(['a', 'c', 'd']));
  });

  it('records the audit ids it used so one event never attributes two changes across refreshes', async () => {
    const s = await store();
    s.apply([bead('a')], null, PANEL, T0, statuses);
    const claimed = audit({ beadId: 'a', type: 'claimed', actor: 'Claude Code', id: 'claim-1' });
    const [first] = s.apply([bead('a', { assignee: 'X', updatedAt: 'u1' })], [claimed], PANEL, T1, statuses);
    expect(first.actor).toBe('Claude Code');
    const [second] = s.apply([bead('a', { assignee: 'Y', updatedAt: 'u2' })], [claimed], PANEL, T1, statuses);
    expect(second.actor).toBeNull();
  });

  describe('activity', () => {
    it('returns newest first, honours the limit, and keeps a ring of 500', async () => {
      const s = await store();
      s.apply([bead('a')], null, PANEL, T0, statuses);
      for (let i = 1; i <= 520; i += 1) {
        s.apply([bead('a', { title: `t${i}`, updatedAt: `u${i}` })], null, PANEL, T1, statuses);
      }
      const all = s.activity(1000);
      expect(all).toHaveLength(500);
      expect(all[0]).toMatchObject({ to: 't520' });
      expect(all[499]).toMatchObject({ to: 't21' });
      expect(s.activity(3).map((e) => e.to)).toEqual(['t520', 't519', 't518']);
    });
  });

  describe('activity limits', () => {
    it('returns nothing for a limit of zero, a negative, or a non-finite number', async () => {
      const s = await store();
      s.apply([bead('a')], null, PANEL, T0, statuses);
      s.apply([bead('a', { title: 'x', updatedAt: 'u1' })], null, PANEL, T1, statuses);
      expect(s.activity(1)).toHaveLength(1);
      for (const limit of [0, -1, -Infinity, Infinity, NaN]) expect(s.activity(limit)).toEqual([]);
    });
  });

  describe('backfill', () => {
    const v7 = (hexTime: string, tail = '7000-8000-000000000000') => `${hexTime.slice(0, 8)}-${hexTime.slice(8, 12)}-${tail}`;

    it('adds historical events, oldest first underneath, dated from the UUIDv7 time else the raw date', async () => {
      const s = await store();
      const ms = Date.parse('2026-10-10T12:00:00.000Z');
      const timed = audit({ id: v7(ms.toString(16).padStart(12, '0')), beadId: 'a', type: 'closed', actor: 'Closer', newValue: 'done' });
      const untimed = audit({ id: 'e60585b7-e041-5e39-a552-237e9a1481c1', beadId: 'b', type: 'created', actor: 'Creator', rawCreatedAt: '2026-06-22 11:43:12' });
      const added = s.backfill([timed, untimed], PANEL);
      expect(added).toHaveLength(2);
      const [first, second] = s.activity(10);
      expect(first).toMatchObject({ beadId: 'a', kind: 'closed', actor: 'Closer', historical: true, observedAt: '2026-10-10T12:00:00.000Z' });
      expect(second).toMatchObject({ beadId: 'b', kind: 'created', actor: 'Creator', historical: true, observedAt: '2026-06-22' });
      expect(s.unseenIds()).toEqual([]);
    });

    it('turns an updated event into one field event per changed field, with before and after values', async () => {
      const s = await store();
      const e = audit({ beadId: 'a', type: 'updated', actor: 'X', oldValue: JSON.stringify({ id: 'a', priority: 2, title: 'Old' }), newValue: JSON.stringify({ priority: 1, title: 'New' }) });
      s.backfill([e], PANEL);
      const events = s.activity(10);
      expect(events.map((x) => [x.field, x.from, x.to]).sort()).toEqual([
        ['priority', 2, 1],
        ['title', 'Old', 'New'],
      ]);
    });

    it('maps the other audit types and skips ones it does not know', async () => {
      const s = await store();
      s.backfill([
        audit({ beadId: 'a', type: 'status_changed', newValue: '{"status":"in_progress"}', oldValue: '{"status":"open"}' }),
        audit({ beadId: 'a', type: 'reopened' }),
        audit({ beadId: 'a', type: 'label_added' }),
        audit({ beadId: 'a', type: 'something_new' }),
      ], PANEL);
      const kinds = s.activity(10).map((x) => `${x.kind}:${x.field ?? ''}`);
      expect(kinds.sort()).toEqual(['field:labels', 'field:status', 'reopened:status']);
    });

    it('applies at most 50 events and skips ones it already took', async () => {
      const s = await store();
      const many = Array.from({ length: 80 }, (_, i) => audit({ id: `bf-${i}`, beadId: 'a', type: 'created' }));
      expect(s.backfill(many, PANEL)).toHaveLength(50);
      expect(s.backfill(many.slice(0, 50), PANEL)).toEqual([]);
      expect(s.activity(1000)).toHaveLength(50);
    });

    it('turns a claimed event with values into one row per field, like updated', async () => {
      const s = await store();
      s.backfill([audit({ beadId: 'a', type: 'claimed', actor: 'Claude Code', newValue: '{"assignee":"Claude Code","status":"in_progress"}', oldValue: '{"id":"a","status":"open"}' })], PANEL);
      expect(s.activity(10).map((x) => [x.field, x.from, x.to]).sort()).toEqual([
        ['assignee', undefined, 'Claude Code'],
        ['status', 'open', 'in_progress'],
      ]);
    });

    it('flags only the panel actor as byPanel', async () => {
      const s = await store();
      s.backfill([audit({ beadId: 'a', type: 'created', actor: PANEL }), audit({ beadId: 'b', type: 'created', actor: 'Dana (panel)' })], PANEL);
      expect(s.activity(10).map((x) => [x.beadId, x.byPanel]).sort()).toEqual([
        ['a', true],
        ['b', false],
      ]);
    });

    it('puts the audit close reason on historical closed rows only', async () => {
      const s = await store();
      s.backfill([
        audit({ beadId: 'a', type: 'closed', newValue: 'Shipped to prod' }),
        audit({ beadId: 'b', type: 'closed' }),
        audit({ beadId: 'c', type: 'reopened', newValue: 'oops' }),
        audit({ beadId: 'd', type: 'created', newValue: 'nope' }),
      ], PANEL);
      const byBead = Object.fromEntries(s.activity(10).map((x) => [x.beadId, x]));
      expect(byBead.a.reason).toBe('Shipped to prod');
      expect('reason' in byBead.b).toBe(false);
      expect('reason' in byBead.c).toBe(false);
      expect('reason' in byBead.d).toBe(false);
    });

    describe('closed then reopened pairs', () => {
      const closed = (beadId: string) => audit({ beadId, type: 'closed', newValue: 'done' });
      const reopened = (beadId: string, status: string) => audit({ beadId, type: 'reopened', newValue: JSON.stringify({ defer_until: null, status }) });
      const kinds = (s: ProjectStore) => s.activity(10).map((x) => `${x.beadId}:${x.kind}`);

      it('drops the reopened row that follows a closed row when it lands in a done status, and keeps the closed row', async () => {
        const s = await store();
        // Newest first: the reopen came after the close.
        s.backfill([reopened('a', 'shipped'), closed('a')], PANEL, statuses);
        expect(kinds(s)).toEqual(['a:closed']);
      });

      it('keeps a reopened row that lands in a status that is not done', async () => {
        const s = await store();
        s.backfill([reopened('a', 'open'), closed('a')], PANEL, statuses);
        expect(kinds(s).sort()).toEqual(['a:closed', 'a:reopened']);
      });

      it('without statuses, treats any target other than open, in_progress, blocked and deferred as done', async () => {
        const s = await store();
        s.backfill([reopened('a', 'shipped'), closed('a'), reopened('b', 'in_progress'), closed('b')], PANEL);
        expect(kinds(s).sort()).toEqual(['a:closed', 'b:closed', 'b:reopened']);
      });

      it('keeps a reopened row that does not directly follow a closed row of the same bead', async () => {
        const s = await store();
        s.backfill([
          reopened('a', 'shipped'),
          updated('a', { priority: 1 }),
          closed('a'),
          reopened('b', 'shipped'),
          closed('c'),
        ], PANEL, statuses);
        expect(kinds(s).filter((k) => k.endsWith(':reopened')).sort()).toEqual(['a:reopened', 'b:reopened']);
      });

      it('pairs rows of one bead even when other beads sit between them, and keeps a reopened row with no target status', async () => {
        const s = await store();
        s.backfill([reopened('a', 'shipped'), audit({ beadId: 'z', type: 'created' }), closed('a'), audit({ beadId: 'b', type: 'reopened' }), closed('b')], PANEL, statuses);
        expect(kinds(s).sort()).toEqual(['a:closed', 'b:closed', 'b:reopened', 'z:created']);
      });

      it('does not let a dropped reopened event attribute a later change', async () => {
        const s = await store();
        const dropped = reopened('a', 'shipped');
        s.backfill([dropped, closed('a')], PANEL, statuses);
        expect(s.activity(10).map((x) => x.id)).not.toContain(`audit:${dropped.id}`);
        s.apply([bead('a', { status: 'shipped' })], null, PANEL, T0, statuses);
        const [e] = s.apply([bead('a', { status: 'open', updatedAt: 'u1' })], [dropped], PANEL, T1, statuses);
        expect(e).toMatchObject({ kind: 'reopened', actor: null });
      });
    });

    it('does nothing once a baseline exists', async () => {
      const s = await store();
      s.apply([bead('a')], null, PANEL, T0, statuses);
      expect(s.backfill([audit({ beadId: 'a', type: 'created' })], PANEL)).toEqual([]);
      expect(s.activity(10)).toEqual([]);
    });

    it('does not let a backfilled audit event attribute a later change', async () => {
      const s = await store();
      s.backfill([updated('a', { priority: 1 }, 'Old Actor', 'old-1')], PANEL);
      s.apply([bead('a')], null, PANEL, T0, statuses);
      const [e] = s.apply([bead('a', { priority: 1, updatedAt: 'u1' })], [updated('a', { priority: 1 }, 'Old Actor', 'old-1')], PANEL, T1, statuses);
      expect(e.actor).toBeNull();
    });
  });

  describe('first contact consent', () => {
    it('restores the consent as it was, and moves the revision, when a confirmation is taken back', async () => {
      const a = await store();
      expect(a.firstContactConfirmedFor()).toBeNull();
      const before = a.revision();
      a.confirmFirstContact('1.3.0');
      a.restoreFirstContact(null);
      expect(a.firstContactConfirmedFor()).toBeNull();
      expect(a.revision()).toBeGreaterThan(before);
      a.confirmFirstContact('1.2.2');
      a.confirmFirstContact('1.3.0');
      a.restoreFirstContact('1.2.2');
      expect(a.firstContactConfirmedFor()).toBe('1.2.2');
    });
  });

  describe('persistence', () => {
    it('round-trips seen state, activity, used audit ids, and first-contact confirmation', async () => {
      const a = await store();
      a.apply([bead('a'), bead('b')], null, PANEL, T0, statuses);
      a.apply([bead('a', { priority: 1, updatedAt: 'u1' }), bead('b')], [updated('a', { priority: 1 }, 'Claude Code', 'used-1')], PANEL, T1, statuses);
      a.confirmFirstContact('1.2.2');
      expect(a.firstContactConfirmedFor()).toBe('1.2.2');
      await a.save();

      const b = await store();
      expect(b.activity(10)).toEqual(a.activity(10));
      expect(b.firstContactConfirmedFor()).toBe('1.2.2');
      // Same data, same versions: the unseen bead stays unseen, the other stays seen.
      expect(b.apply([bead('a', { priority: 1, updatedAt: 'u1' }), bead('b')], null, PANEL, T1, statuses)).toEqual([]);
      expect(b.unseenIds()).toEqual(['a']);
      // The used audit id survived the restart.
      b.apply([bead('a', { priority: 1, updatedAt: 'u1' }), bead('b')], null, PANEL, T1, statuses);
      const [e] = b.apply([bead('a', { priority: 1, title: 'again', updatedAt: 'u2' }), bead('b')], [updated('a', { title: 'again' }, 'X', 'used-1')], PANEL, T1, statuses);
      expect(e.actor).toBeNull();
    });

    it('diffs the first read after a restart against the saved snapshot: field, created and deleted rows', async () => {
      const a = await store();
      a.apply([bead('a'), bead('b'), bead('gone')], null, PANEL, T0, statuses);
      await a.save();
      const b = await store();
      expect(b.hasBaseline()).toBe(true);
      const events = b.apply([bead('a', { title: 'changed', updatedAt: 'u1' }), bead('b'), bead('new')], [updated('a', { title: 'changed' }, 'Claude Code')], PANEL, T1, statuses);
      expect(events.map((e) => [e.beadId, e.kind, e.field, e.actor]).sort()).toEqual([
        ['a', 'field', 'title', 'Claude Code'],
        ['gone', 'deleted', undefined, null],
        ['new', 'created', undefined, 'Creator'],
      ]);
      expect(b.unseenIds().sort()).toEqual(['a', 'new']);
      await b.save();
      const c = await store();
      c.apply([bead('a', { title: 'changed', updatedAt: 'u1' }), bead('b'), bead('new')], null, PANEL, T1, statuses);
      expect(c.unseenIds().sort()).toEqual(['a', 'new']);
      expect(c.activity(10)).toHaveLength(3);
      // The deletion still names the bead after the restart.
      expect(c.activity(10).find((e) => e.kind === 'deleted')?.title).toBe('Title gone');
    });

    it('baselines again when the saved snapshot is damaged, and diffBead never throws on it', async () => {
      const a = await store();
      a.apply([bead('a')], null, PANEL, T0, statuses);
      await a.save();
      const good = JSON.parse(await readFile(file(), 'utf8'));
      const damaged: unknown[] = [
        [{ id: 'a' }],
        [{ ...good.snapshot[0], comments: 'nope' }],
        [{ ...good.snapshot[0], dependencies: [{ from: 1 }] }],
        [{ ...good.snapshot[0], labels: [1] }],
        'not an array',
        [null],
      ];
      for (const snapshot of damaged) {
        await writeFile(file(), JSON.stringify({ ...good, snapshot, firstContactConfirmedFor: '1.2.2' }));
        const s = await store();
        expect(s.hasBaseline()).toBe(false);
        // The rest of the file is kept.
        expect(s.firstContactConfirmedFor()).toBe('1.2.2');
        expect(s.apply([bead('a', { title: 'changed', updatedAt: 'u1' })], null, PANEL, T1, statuses)).toEqual([]);
        // Re-baselining only seeds ids that have no seen entry, so the saved flag (an older version) stays unseen.
        expect(s.unseenIds()).toEqual(['a']);
      }
    });

    it('rethrows a read error other than a missing file, so a real file is never overwritten', async () => {
      await mkdir(file());
      const s = new ProjectStore(ROOT, dir);
      await expect(s.load()).rejects.toMatchObject({ code: 'EISDIR' });
    });

    it('records when each bead was last marked seen, and keeps it across a restart', async () => {
      const a = await store();
      a.apply([bead('a')], null, PANEL, T0, statuses);
      a.markSeen(['a'], T1);
      await a.save();
      expect(JSON.parse(await readFile(file(), 'utf8')).seenAt).toEqual({ a: T1 });
    });

    it('writes a versioned file named for the sha1 of the root', async () => {
      const s = await store();
      s.apply([bead('a')], null, PANEL, T0, statuses);
      await s.save();
      const json = JSON.parse(await readFile(file(), 'utf8'));
      expect(json).toMatchObject({ v: 1, snapshot: [bead('a')], seen: { a: beadVersion(bead('a')) }, seenAt: {}, activity: [], usedAuditIds: [], firstContactConfirmedFor: null });
    });

    it('keeps separate state per root', async () => {
      const a = await store('/p/one');
      a.apply([bead('x')], null, PANEL, T0, statuses);
      await a.save();
      const b = await store('/p/two');
      // Nothing persisted for /p/two: baseline, nothing unseen.
      b.apply([bead('x', { title: 'q', updatedAt: 'u1' })], null, PANEL, T0, statuses);
      expect(b.unseenIds()).toEqual([]);
    });

    it('creates the storage directory when it is missing', async () => {
      const nested = join(dir, 'a', 'b');
      const s = new ProjectStore(ROOT, nested);
      await s.load();
      s.apply([bead('a')], null, PANEL, T0, statuses);
      await s.save();
      expect(await readdir(nested)).toHaveLength(1);
    });

    it('leaves no temp files behind and stays valid under concurrent saves', async () => {
      const s = await store();
      s.apply([bead('a')], null, PANEL, T0, statuses);
      await Promise.all(Array.from({ length: 8 }, () => s.save()));
      const names = await readdir(dir);
      expect(names).toEqual([`${createHash('sha1').update(ROOT).digest('hex')}.json`]);
      const text = await readFile(file(), 'utf8');
      expect(() => JSON.parse(text)).not.toThrow();
    });

    it('removes its temp file and rejects when the final rename fails', async () => {
      // A directory sitting where the file belongs makes the rename fail.
      const s = await store();
      s.apply([bead('a')], null, PANEL, T0, statuses);
      await mkdir(file());
      await expect(s.save()).rejects.toThrow();
      expect(await readdir(dir)).toEqual([`${createHash('sha1').update(ROOT).digest('hex')}.json`]);
    });

    it('trims used audit ids to the most recent 2000', async () => {
      const s = await store();
      s.apply([bead('a')], null, PANEL, T0, statuses);
      for (let i = 0; i < 2100; i += 1) {
        s.apply([bead('a', { priority: i % 5, title: `t${i}`, updatedAt: `u${i}` })], [updated('a', { title: `t${i}` }, 'X', `aud-${i}`)], PANEL, T1, statuses);
      }
      await s.save();
      const json = JSON.parse(await readFile(file(), 'utf8'));
      expect(json.usedAuditIds).toHaveLength(2000);
      expect(json.usedAuditIds.at(-1)).toBe('aud-2099');
      expect(json.usedAuditIds[0]).toBe('aud-100');
      expect(json.activity.length).toBeLessThanOrEqual(500);
    });

    it.each([
      ['not JSON', '{nope'],
      ['wrong version', JSON.stringify({ v: 2, snapshot: [], seen: {}, activity: [], usedAuditIds: [], firstContactConfirmedFor: null })],
      ['wrong shape', JSON.stringify({ v: 1, seen: [], activity: 'x' })],
      ['null', 'null'],
    ])('treats a %s file as absent and baselines again', async (_name, text) => {
      await writeFile(file(), text);
      const s = await store();
      expect(s.activity(10)).toEqual([]);
      expect(s.firstContactConfirmedFor()).toBeNull();
      expect(s.apply([bead('a')], null, PANEL, T0, statuses)).toEqual([]);
      expect(s.unseenIds()).toEqual([]);
    });

    it('drops malformed activity entries but keeps the rest', async () => {
      const good: ChangeEvent = { id: 'g', beadId: 'a', kind: 'created', actor: null, byPanel: false, observedAt: T0 };
      await writeFile(file(), JSON.stringify({ v: 1, snapshot: null, seen: {}, activity: [good, { id: 5 }, 'x', null], usedAuditIds: ['u', 7], firstContactConfirmedFor: null }));
      const s = await store();
      expect(s.activity(10)).toEqual([good]);
    });

    it('does not mistake a file written only for first-contact consent for a baseline', async () => {
      const a = await store();
      a.confirmFirstContact('1.2.2');
      await a.save();
      const b = await store();
      expect(b.firstContactConfirmedFor()).toBe('1.2.2');
      b.apply([bead('a'), bead('b')], null, PANEL, T0, statuses);
      expect(b.unseenIds()).toEqual([]);
    });
  });
});
