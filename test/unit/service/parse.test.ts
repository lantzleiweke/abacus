import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseComments,
  parseExport,
  parseExportWithWarnings,
  parseList,
  parseReady,
  parseStatuses,
  parseTypes,
} from '../../../src/service/bd/parse';

const reads = join(__dirname, '../../fixtures/server/reads');
const privateReads = join(__dirname, '../../fixtures-private/embedded/reads');
const hasPrivate = existsSync(join(privateReads, 'export.jsonl'));

const text = (name: string, dir = reads) => readFileSync(join(dir, name), 'utf8');
const json = (name: string, dir = reads): unknown => JSON.parse(text(name, dir));

const beads = parseExport(text('export.jsonl'));
const byId = (id: string) => {
  const bead = beads.find((b) => b.id === id);
  if (!bead) throw new Error(`fixture bead ${id} missing`);
  return bead;
};

describe('parseExport field mapping', () => {
  it('parses every line of the server export', () => {
    expect(beads).toHaveLength(16);
    expect(parseExportWithWarnings(text('export.jsonl')).skipped).toBe(0);
  });

  it('maps a fully populated epic', () => {
    expect(byId('scr-8nw')).toEqual({
      id: 'scr-8nw',
      title: 'Platform migration',
      status: 'open',
      priority: 0,
      type: 'epic',
      assignee: 'Alice Tester',
      labels: ['platform', 'q4'],
      parentId: null,
      description: 'Move the legacy platform to the new stack.\n\nIncludes **markdown**:\n- item one\n- item two',
      design: 'Strangler pattern, service by service.',
      acceptance: 'All services run on the new stack; legacy decommissioned.',
      notes: 'Kickoff done 2026-10-01.',
      createdAt: '2026-10-14T08:19:50Z',
      createdBy: 'Alice Tester',
      updatedAt: '2026-10-14T08:19:50Z',
      closedAt: null,
      closeReason: null,
      dependencies: [],
      comments: [
        {
          id: '01a1397f-4445-7883-9d0e-972ef00160b4',
          author: 'Alice Tester',
          text: 'Epic kickoff notes: target end of Q4.',
          createdAt: '2026-10-14T08:20:04Z',
        },
      ],
      extra: { owner: 'alice@example.invalid' },
    });
  });

  it('defaults absent optional fields', () => {
    const bead = byId('scr-t27');
    expect(bead).toMatchObject({
      assignee: null,
      labels: [],
      description: '',
      design: '',
      acceptance: '',
      notes: '',
      closedAt: null,
      closeReason: null,
      dependencies: [],
      comments: [],
      parentId: null,
    });
  });

  it('maps closed beads', () => {
    expect(byId('scr-8nw.1.2')).toMatchObject({
      status: 'closed',
      closedAt: '2026-10-14T08:19:55Z',
      closeReason: 'Fixed in commit abc123',
    });
  });

  it('keeps dependency created_at as the raw local-time string', () => {
    expect(byId('scr-r6b').dependencies).toEqual([
      {
        from: 'scr-r6b',
        to: 'scr-8nw.1.1',
        kind: 'discovered-from',
        createdBy: 'Bob Builder',
        createdAt: '2026-10-14T01:19:52Z',
      },
    ]);
  });

  it('has no comments array when the bead has none, only a count', () => {
    const raw = text('export.jsonl').split('\n').find((line) => line.includes('"id":"scr-t27"')) ?? '';
    expect(raw).not.toContain('"comments"');
    expect(byId('scr-t27').comments).toEqual([]);
  });

  it('ignores a trailing newline and blank lines', () => {
    expect(parseExport(`\n${text('export.jsonl')}\n\n`)).toHaveLength(16);
  });
});

describe('parentId', () => {
  it('comes from the parent-child dependency owned by the child in an export', () => {
    expect(byId('scr-8nw.1').parentId).toBe('scr-8nw');
    expect(byId('scr-8nw.1.1').parentId).toBe('scr-8nw.1');
    expect(byId('scr-8nw.2').parentId).toBe('scr-8nw');
  });

  it('ignores other dependency kinds', () => {
    expect(byId('scr-r6b').parentId).toBeNull();
    expect(byId('scr-lha').parentId).toBeNull();
  });

  it('prefers the parent field when bd provides it (list --id)', () => {
    const [bead] = parseList(json('list-id.json'));
    expect(bead.id).toBe('scr-8nw.1');
    expect(bead.parentId).toBe('scr-8nw');
  });

  it('uses the parent field even with no dependency bodies', () => {
    const [bead] = parseList([{ id: 'x-1', title: 't', parent: 'x-0' }]);
    expect(bead.parentId).toBe('x-0');
    expect(bead.extra).toEqual({});
  });

  it('does not treat a parent-child dependency owned by another bead as the parent', () => {
    const [bead] = parseList([
      { id: 'x-1', dependencies: [{ issue_id: 'x-9', depends_on_id: 'x-0', type: 'parent-child' }] },
    ]);
    expect(bead.parentId).toBeNull();
  });
});

describe('priority', () => {
  const priorityOf = (priority: unknown) => parseList([{ id: 'x', priority }])[0].priority;

  it('keeps 0 to 4', () => {
    expect([0, 1, 2, 3, 4].map(priorityOf)).toEqual([0, 1, 2, 3, 4]);
  });

  it('turns anything else into null', () => {
    expect([5, -1, 1.5, '2', null, undefined, {}].map(priorityOf)).toEqual([null, null, null, null, null, null, null]);
  });
});

describe('unknown vocab passes through', () => {
  it('keeps custom statuses, types and dependency kinds verbatim', () => {
    expect(byId('scr-3i5').status).toBe('qa_wait');
    expect(byId('scr-779').status).toBe('in_review');
    expect(byId('scr-5s0').type).toBe('incident');
    expect(byId('scr-5s0').dependencies[0].kind).toBe('caused-by');
    expect(byId('scr-779').dependencies[0].kind).toBe('related');

    const [bead] = parseExport(
      JSON.stringify({
        id: 'x-1',
        status: 'quantum',
        issue_type: 'wibble',
        dependencies: [{ issue_id: 'x-1', depends_on_id: 'x-2', type: 'frobs' }],
      }),
    );
    expect([bead.status, bead.type, bead.dependencies[0].kind]).toEqual(['quantum', 'wibble', 'frobs']);
  });
});

describe('extra', () => {
  it('captures unmapped populated fields', () => {
    expect(byId('scr-8nw.1').extra).toEqual({
      owner: 'alice@example.invalid',
      started_at: '2026-10-14T08:19:54Z',
    });
    expect(byId('scr-8nw.3').extra).toMatchObject({ defer_until: '2026-11-13T09:19:52Z' });
  });

  it('leaves out bookkeeping and mapped fields', () => {
    for (const bead of beads) {
      for (const key of ['_type', 'id', 'schema_version', 'comment_count', 'dependency_count', 'dependent_count', 'title', 'status', 'labels', 'comments', 'dependencies']) {
        expect(bead.extra).not.toHaveProperty(key);
      }
    }
  });

  it('omits empty strings, arrays, objects and null, but keeps 0 and false', () => {
    const [bead] = parseExport(
      JSON.stringify({
        id: 'x-1',
        external_ref: '',
        spec_id: null,
        tags: [],
        meta: {},
        estimated_minutes: 0,
        flag: false,
        due_at: '2026-12-01T00:00:00Z',
        nested: { a: [1, 'b'] },
      }),
    );
    expect(bead.extra).toEqual({
      estimated_minutes: 0,
      flag: false,
      due_at: '2026-12-01T00:00:00Z',
      nested: { a: [1, 'b'] },
    });
  });
});

describe('malformed input', () => {
  const good = (id: string) => JSON.stringify({ _type: 'issue', id, title: id, status: 'open', priority: 1, issue_type: 'task' });

  it('skips a malformed line with a counted warning instead of throwing', () => {
    const result = parseExportWithWarnings([good('a-1'), '{not json', good('a-2')].join('\n'));
    expect(result.beads.map((b) => b.id)).toEqual(['a-1', 'a-2']);
    expect(result.skipped).toBe(1);
  });

  it('counts lines that are JSON but not an issue object', () => {
    const result = parseExportWithWarnings([good('a-1'), '[1,2]', '"str"', '42', 'null', '{"title":"no id"}'].join('\n'));
    expect(result.beads).toHaveLength(1);
    expect(result.skipped).toBe(5);
  });

  it('parseExport delegates and drops the bad lines', () => {
    expect(parseExport(`${good('a-1')}\nbroken\n`).map((b) => b.id)).toEqual(['a-1']);
  });

  it('ignores records of another _type without counting them', () => {
    const result = parseExportWithWarnings(`${good('a-1')}\n{"_type":"memory","key":"k","value":"v"}`);
    expect(result).toMatchObject({ skipped: 0 });
    expect(result.beads).toHaveLength(1);
  });

  it('drops malformed dependency and comment entries but keeps the bead', () => {
    const [bead] = parseExport(
      JSON.stringify({
        id: 'a-1',
        dependencies: [null, { type: 'blocks' }, { depends_on_id: 'a-2', type: 'blocks' }],
        comments: ['x', { text: 'no id' }, { id: 'c1', text: 'ok' }],
        labels: ['a', 3, null],
      }),
    );
    expect(bead.dependencies).toEqual([{ from: 'a-1', to: 'a-2', kind: 'blocks', createdBy: null, createdAt: null }]);
    expect(bead.comments).toEqual([{ id: 'c1', author: null, text: 'ok', createdAt: '' }]);
    expect(bead.labels).toEqual(['a']);
  });

  it('returns empty results for non-array json or empty input', () => {
    expect(parseExport('')).toEqual([]);
    expect(parseList({ error: 'x' })).toEqual([]);
    expect(parseComments(null)).toEqual([]);
    expect(parseReady('nope')).toEqual([]);
    expect(parseStatuses([])).toEqual([]);
    expect(parseTypes(null)).toEqual([]);
  });
});

describe('parseList', () => {
  it('maps flat list rows (no dependency or comment bodies, so those stay empty)', () => {
    const list = parseList(json('list.json'));
    expect(list.map((b) => b.id).sort()).toEqual(beads.map((b) => b.id).sort());
    const epic = list.find((b) => b.id === 'scr-8nw');
    expect(epic).toMatchObject({ title: 'Platform migration', labels: ['platform', 'q4'], dependencies: [], comments: [] });
  });

  it('maps a detail row with dependencies', () => {
    const [bead] = parseList(json('list-id.json'));
    expect(bead.dependencies).toEqual([
      { from: 'scr-8nw.1', to: 'scr-8nw', kind: 'parent-child', createdBy: 'Bob Builder', createdAt: '2026-10-14T01:19:50Z' },
    ]);
    expect(bead.acceptance).toBe('Edited acceptance criteria');
  });

  it('returns nothing for an unknown id', () => {
    expect(parseList(json('list-id-missing.json'))).toEqual([]);
  });
});

describe('parseComments', () => {
  it('maps bd comments output', () => {
    const comments = parseComments(json('comments.json'));
    expect(comments).toHaveLength(4);
    expect(comments[0]).toEqual({
      id: '01a1397f-41a2-7f1f-9371-2a57b66e2316',
      author: 'Bob Builder',
      text: 'Started porting; token format is the tricky part.',
      createdAt: '2026-10-14T08:20:04Z',
    });
    expect(comments[2].author).toBe('Panel Tester (panel)');
  });

  it('returns an empty array when there are none', () => {
    // fixtures/*/comments-none.json was captured against a bead that has comments (same as
    // comments.json), so the contract's `[]` is written inline.
    expect(parseComments([])).toEqual([]);
  });
});

describe('parseStatuses', () => {
  it('lists built-ins with icons, then custom statuses without', () => {
    const statuses = parseStatuses(json('statuses.json'));
    expect(statuses.map((s) => s.name)).toEqual([
      'open', 'in_progress', 'blocked', 'deferred', 'closed', 'pinned', 'hooked', 'in_review', 'qa_wait',
    ]);
    expect(statuses[0]).toEqual({ name: 'open', category: 'active', icon: '○' });
    expect(statuses[4]).toEqual({ name: 'closed', category: 'done', icon: '✓' });
    expect(statuses[7]).toEqual({ name: 'in_review', category: 'wip', icon: null });
  });

  it('works without custom statuses', () => {
    const statuses = parseStatuses({ built_in_statuses: [{ name: 'open', category: 'active', icon: '○' }] });
    expect(statuses).toEqual([{ name: 'open', category: 'active', icon: '○' }]);
  });
});

describe('parseTypes', () => {
  it('lists core types then custom types', () => {
    const types = parseTypes(json('types.json'));
    expect(types).toEqual(['task', 'bug', 'feature', 'chore', 'epic', 'decision', 'spike', 'story', 'milestone', 'incident']);
  });

  it('works without custom types', () => {
    expect(parseTypes({ core_types: [{ name: 'task' }] })).toEqual(['task']);
  });
});

describe('parseReady', () => {
  it('returns ids in order', () => {
    expect(parseReady(json('ready.json'))).toEqual([
      'scr-r6b', 'scr-8nw', 'scr-t27', 'scr-5s0', 'scr-fum', 'scr-8nw.1.3', 'scr-8nw.1',
    ]);
  });
});

describe.skipIf(!hasPrivate)('real embedded shapes (git-ignored fixtures)', () => {
  it('parses every line of the embedded export without skipping', () => {
    const result = parseExportWithWarnings(text('export.jsonl', privateReads));
    expect(result.skipped).toBe(0);
    expect(result.beads).toHaveLength(40);
    for (const bead of result.beads) {
      expect(bead.id).not.toBe('');
      expect(bead.extra).not.toHaveProperty('comment_count');
    }
  });

  it('derives parents from parent-child dependencies', () => {
    const { beads: real } = parseExportWithWarnings(text('export.jsonl', privateReads));
    const children = real.filter((b) => b.dependencies.some((d) => d.kind === 'parent-child' && d.from === b.id));
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) expect(child.parentId).not.toBeNull();
  });

  it('parses statuses, types, ready and comments', () => {
    expect(parseStatuses(json('statuses.json', privateReads)).length).toBeGreaterThanOrEqual(7);
    expect(parseTypes(json('types.json', privateReads))).toContain('task');
    expect(parseReady(json('ready.json', privateReads)).length).toBeGreaterThan(0);
    expect(parseComments(json('comments.json', privateReads)).length).toBeGreaterThan(0);
  });
});
