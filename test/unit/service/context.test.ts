import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { beadUrl, buildConflictContext, buildContext, NO_WEB_PAGE_URL, relatedFor } from '../../../src/service/context';
import type { Bead, Dependency, Related, SyncState } from '../../../src/shared/types';

const PREFIX = 'Beads issue context (JSON)\n';
const CAP = 16_000;

function bead(id: string, over: Partial<Bead> = {}): Bead {
  return {
    id,
    title: `Title of ${id}`,
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
    createdAt: '2026-10-01T10:00:00Z',
    createdBy: 'Ann',
    updatedAt: '2026-10-02T10:00:00Z',
    closedAt: null,
    closeReason: null,
    dependencies: [],
    comments: [],
    extra: {},
    ...over,
  };
}

function dep(from: string, to: string, kind = 'blocks'): Dependency {
  return { from, to, kind, createdBy: 'Ann', createdAt: '2026-10-01 10:00:00' };
}

const noRelated: Related = { parent: null, children: [], deps: [] };

function parse(text: string): { issue: Record<string, any>; comments: Array<Record<string, any>> } {
  expect(text.startsWith(PREFIX)).toBe(true);
  return JSON.parse(text.slice(PREFIX.length));
}

describe('relatedFor', () => {
  it('finds the parent, the children, and both directions of dependencies', () => {
    const a = bead('a', { parentId: 'p', dependencies: [dep('a', 'b'), dep('a', 'p', 'parent-child')] });
    const p = bead('p');
    const c1 = bead('c1', { parentId: 'a', dependencies: [dep('c1', 'a', 'parent-child')] });
    const c2 = bead('c2', { parentId: 'a' });
    const b = bead('b');
    const x = bead('x', { dependencies: [dep('x', 'a', 'related')] });
    const related = relatedFor(a, [a, p, c1, c2, b, x]);
    expect(related.parent?.id).toBe('p');
    expect(related.children.map((child) => child.id)).toEqual(['c1', 'c2']);
    expect(related.deps.map((d) => [d.direction, d.dep.kind, d.other?.id])).toEqual([
      ['out', 'blocks', 'b'],
      ['in', 'related', 'x'],
    ]);
  });

  it('gives a null parent and a null other when the bead is not in the list', () => {
    const a = bead('a', { parentId: 'gone', dependencies: [dep('a', 'missing')] });
    const related = relatedFor(a, [a]);
    expect(related.parent).toBeNull();
    expect(related.children).toEqual([]);
    expect(related.deps).toEqual([{ dep: a.dependencies[0], other: null, direction: 'out' }]);
  });
});

describe('buildContext', () => {
  it('starts with the exact header and carries the issue and comments', () => {
    const b = bead('a-1', {
      priority: 1,
      assignee: 'Ann',
      labels: ['ui'],
      description: 'Do it',
      acceptance: 'It works',
      comments: [{ id: 'c1', author: 'Bob', text: 'hello', createdAt: '2026-10-03T10:00:00Z' }],
    });
    const { text, title } = buildContext(b, noRelated);
    expect(text.startsWith('Beads issue context (JSON)\n{\n  "issue": {')).toBe(true);
    const json = parse(text);
    expect(json.issue).toMatchObject({
      id: 'a-1',
      title: 'Title of a-1',
      type: 'task',
      status: 'open',
      priority: 1,
      assignee: 'Ann',
      labels: ['ui'],
      parent: null,
      children: [],
      dependencies: [],
      description: 'Do it',
      acceptance: 'It works',
    });
    expect(json.comments).toEqual([{ author: 'Bob', createdAt: '2026-10-03T10:00:00Z', text: 'hello' }]);
    expect(title).toBe('Title of a-1');
  });

  it('describes parent, children and dependencies with titles and statuses', () => {
    const a = bead('a', { parentId: 'p', dependencies: [dep('a', 'b')] });
    const p = bead('p', { status: 'in_progress' });
    const c = bead('c', { parentId: 'a', status: 'closed' });
    const b = bead('b', { status: 'blocked' });
    const x = bead('x', { dependencies: [dep('x', 'a', 'related')] });
    const { text } = buildContext(a, relatedFor(a, [a, p, c, b, x]));
    const { issue } = parse(text);
    expect(issue.parent).toEqual({ id: 'p', title: 'Title of p', status: 'in_progress' });
    expect(issue.children).toEqual([{ id: 'c', title: 'Title of c', status: 'closed' }]);
    expect(issue.dependencies).toEqual([
      { kind: 'blocks', direction: 'out', id: 'b', title: 'Title of b', status: 'blocked' },
      { kind: 'related', direction: 'in', id: 'x', title: 'Title of x', status: 'open' },
    ]);
  });

  it('lists comments oldest first', () => {
    const b = bead('a', {
      comments: [
        { id: 'c2', author: 'B', text: 'second', createdAt: '2026-10-05T10:00:00Z' },
        { id: 'c1', author: 'A', text: 'first', createdAt: '2026-10-04T10:00:00Z' },
      ],
    });
    expect(parse(buildContext(b, noRelated).text).comments.map((c) => c.text)).toEqual(['first', 'second']);
  });

  it('clamps the chip title to 200 characters', () => {
    const { title } = buildContext(bead('a', { title: 'x'.repeat(500) }), noRelated);
    expect(title.length).toBe(200);
  });

  it('stays under the cap with a 40k fixture, dropping the oldest comments first', () => {
    const comments = Array.from({ length: 30 }, (_, i) => ({
      id: `c${i}`,
      author: 'A',
      text: `comment ${String(i).padStart(2, '0')} ` + 'y'.repeat(400),
      createdAt: `2026-10-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
    }));
    const b = bead('a', { description: 'd'.repeat(2000), notes: 'n'.repeat(2000), comments });
    const { text } = buildContext(b, noRelated);
    expect(text.length).toBeLessThanOrEqual(CAP);
    const json = parse(text);
    expect(json.comments.length).toBeGreaterThan(0);
    expect(json.comments.length).toBeLessThan(30);
    // the newest comment survives, the oldest is gone
    expect(json.comments.at(-1)!.text).toContain('comment 29');
    expect(json.comments[0]!.text).not.toContain('comment 00');
    // fields untouched while dropping comments was enough
    expect(json.issue.description).toBe('d'.repeat(2000));
    expect(json.issue.notes).toBe('n'.repeat(2000));
  });

  it('truncates description, design and notes in that order once no comments are left', () => {
    const big = (c: string) => c.repeat(14_000);
    const source = [1, 2, 3].map((i) => ({ id: `c${i}`, author: 'A', text: `comment ${i} ` + 'y'.repeat(600), createdAt: `2026-10-0${i}T10:00:00Z` }));
    const b = bead('a', { description: big('d'), design: 'g'.repeat(1500), notes: 'n'.repeat(1500), acceptance: 'accept me', comments: source });
    const { text } = buildContext(b, noRelated);
    expect(text.length).toBeLessThanOrEqual(CAP);
    const { issue, comments } = parse(text);
    expect(comments).toEqual([]);
    expect(issue.description.endsWith(' [truncated]')).toBe(true);
    expect(issue.description.length).toBeGreaterThanOrEqual(500);
    expect(issue.design).toBe('g'.repeat(1500));
    expect(issue.notes).toBe('n'.repeat(1500));
    expect(issue.acceptance).toBe('accept me');
  });

  it('cuts design after description has hit its floor, then notes', () => {
    const b = bead('a', { description: 'd'.repeat(20_000), design: 'g'.repeat(20_000), notes: 'n'.repeat(20_000), acceptance: 'accept me' });
    const { issue } = parse(buildContext(b, noRelated).text);
    expect(issue.description).toBe('d'.repeat(500) + ' [truncated]');
    expect(issue.design.endsWith(' [truncated]')).toBe(true);
    expect(issue.notes.endsWith(' [truncated]')).toBe(true);
    expect(buildContext(b, noRelated).text.length).toBeLessThanOrEqual(CAP);
  });

  it('never cuts id, title, status, priority, type or acceptance while the other fields can give', () => {
    const b = bead('a-9', {
      title: 'Keep this title',
      status: 'in_progress',
      priority: 0,
      type: 'bug',
      acceptance: 'a'.repeat(3000),
      description: 'd'.repeat(40_000),
      design: 'g'.repeat(40_000),
      notes: 'n'.repeat(40_000),
      comments: [{ id: 'c', author: 'A', text: 'z'.repeat(40_000), createdAt: '2026-10-03T10:00:00Z' }],
    });
    const { text } = buildContext(b, noRelated);
    expect(text.length).toBeLessThanOrEqual(CAP);
    const { issue, comments } = parse(text);
    expect(comments).toEqual([]);
    expect(issue).toMatchObject({ id: 'a-9', title: 'Keep this title', status: 'in_progress', priority: 0, type: 'bug' });
    expect(issue.acceptance).toBe('a'.repeat(3000));
  });

  it('trims acceptance last, only when that makes it fit, and keeps the other fields at their floor', () => {
    const b = bead('a', { acceptance: 'a'.repeat(40_000), description: 'd'.repeat(40_000) });
    const { text } = buildContext(b, noRelated);
    expect(text.length).toBeLessThanOrEqual(CAP);
    const { issue } = parse(text);
    expect(issue.acceptance.endsWith(' [truncated]')).toBe(true);
    expect(issue.acceptance.startsWith('aaaa')).toBe(true);
    expect(issue.description).toBe('d'.repeat(500) + ' [truncated]');
  });

  it('never marks a field that is empty', () => {
    const b = bead('a', { acceptance: 'a'.repeat(40_000), description: 'd'.repeat(40_000), design: '', notes: '' });
    const { issue } = parse(buildContext(b, noRelated).text);
    expect(issue.design).toBe('');
    expect(issue.notes).toBe('');
    const tiny = parse(buildContext(bead('b', { title: 't'.repeat(20_000), acceptance: '' }), noRelated).text);
    expect(tiny.issue.acceptance).toBe('');
  });

  it('clamps oversized extra values to the floor instead of dropping the issue fields', () => {
    const b = bead('a', { acceptance: 'keep', extra: { blob: 'x'.repeat(40_000) } });
    const { text } = buildContext(b, noRelated);
    expect(text.length).toBeLessThanOrEqual(CAP);
    const { issue } = parse(text);
    expect(issue.acceptance).toBe('keep');
    expect(issue.extra).toEqual({ blob: 'x'.repeat(500) + ' [truncated]' });
  });

  it('keeps description and comments when only an extra blob was too big', () => {
    const comments = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, author: 'A', text: `comment ${i} ` + 'y'.repeat(200), createdAt: `2026-10-${String(i + 1).padStart(2, '0')}T10:00:00Z` }));
    const b = bead('a', { description: 'd'.repeat(5_000), extra: { blob: 'x'.repeat(40_000) }, comments });
    const { issue, comments: out } = parse(buildContext(b, noRelated).text);
    expect(issue.description).toBe('d'.repeat(5_000));
    expect(out).toHaveLength(10);
  });

  it('parses and keeps acceptance for a 150-child epic, with a count of the children left out', () => {
    const epic = bead('epic', { acceptance: 'All children done', description: 'd'.repeat(3_000) });
    const kids = Array.from({ length: 150 }, (_, i) => bead(`k-${i}`, { parentId: 'epic', title: `Child number ${i} with a reasonably long title` }));
    const { text } = buildContext(epic, relatedFor(epic, [epic, ...kids]));
    expect(text.length).toBeLessThanOrEqual(CAP);
    const { issue } = parse(text);
    expect(issue.acceptance).toBe('All children done');
    expect(issue.children.length).toBeGreaterThan(0);
    expect(issue.children.length).toBeLessThan(150);
    expect(issue.childrenOmitted).toBe(150 - issue.children.length);
    expect(issue.description.length).toBeGreaterThanOrEqual(500);
  });

  it('caps dependencies the same way, with a count', () => {
    const a = bead('a', { acceptance: 'ok', dependencies: Array.from({ length: 400 }, (_, i) => dep('a', `d-${i}`)) });
    const others = Array.from({ length: 400 }, (_, i) => bead(`d-${i}`, { title: 'Some dependency title '.repeat(2) }));
    const { issue } = parse(buildContext(a, relatedFor(a, [a, ...others])).text);
    expect(issue.acceptance).toBe('ok');
    expect(issue.dependencies.length + issue.dependenciesOmitted).toBe(400);
    expect(issue.dependenciesOmitted).toBeGreaterThan(0);
  });

  it('parses and keeps acceptance when closeReason is 20k', () => {
    const b = bead('a', { status: 'closed', closeReason: 'r'.repeat(20_000), acceptance: 'Ship it', description: 'What and why' });
    const { text } = buildContext(b, noRelated);
    expect(text.length).toBeLessThanOrEqual(CAP);
    const { issue } = parse(text);
    expect(issue.acceptance).toBe('Ship it');
    expect(issue.description).toBe('What and why');
    expect(issue.closeReason).toBe('r'.repeat(500) + ' [truncated]');
  });

  it('cuts a field only as far as needed, so freed space is not wasted', () => {
    const b = bead('a', { description: 'd'.repeat(20_000) });
    const { text } = buildContext(b, noRelated);
    expect(text.length).toBeLessThanOrEqual(CAP);
    expect(text.length).toBeGreaterThan(CAP - 50);
  });

  it('drops extras before cutting a long acceptance', () => {
    const b = bead('a', { acceptance: 'a'.repeat(15_000), extra: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, 'x'.repeat(400)])) });
    const { text } = buildContext(b, noRelated);
    expect(text.length).toBeLessThanOrEqual(CAP);
    const { issue } = parse(text);
    expect(issue.acceptance).toBe('a'.repeat(15_000));
    expect(Object.keys(issue.extra).length + issue.extraOmitted).toBe(10);
  });

  it('drops labels before cutting a long acceptance', () => {
    const b = bead('a', { acceptance: 'a'.repeat(15_000), labels: Array.from({ length: 100 }, (_, i) => `label-number-${i}`) });
    const { issue } = parse(buildContext(b, noRelated).text);
    expect(issue.acceptance).toBe('a'.repeat(15_000));
    expect(issue.labels.length + issue.labelsOmitted).toBe(100);
    expect(issue.labelsOmitted).toBeGreaterThan(0);
  });

  it('keeps the clamped big extra value and the small ones when room allows', () => {
    const extra = { big: 'x'.repeat(40_000), s1: 'one '.repeat(25), s2: 'two '.repeat(25), s3: 'three '.repeat(16), s4: 'four '.repeat(20), s5: 'five '.repeat(20) };
    const b = bead('a', { acceptance: 'a'.repeat(14_700), extra });
    const { text } = buildContext(b, noRelated);
    expect(text.length).toBeLessThanOrEqual(CAP);
    const { issue } = parse(text);
    expect(issue.acceptance).toBe('a'.repeat(14_700));
    expect(issue.extra.big).toBe('x'.repeat(500) + ' [truncated]');
    expect(issue.extra.s1).toBe(extra.s1);
    expect(issue.extraOmitted).toBeGreaterThan(0);
    expect(Object.keys(issue.extra).length + issue.extraOmitted).toBe(6);
  });

  it('drops optional extras and labels (with counts) rather than acceptance', () => {
    const b = bead('a', {
      acceptance: 'a'.repeat(1_800),
      labels: Array.from({ length: 800 }, (_, i) => `label-number-${i}`),
      extra: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, 'x'.repeat(480)])),
    });
    const { text } = buildContext(b, noRelated);
    expect(text.length).toBeLessThanOrEqual(CAP);
    const { issue } = parse(text);
    expect(issue.acceptance).toBe('a'.repeat(1_800));
    expect(issue.labelsOmitted).toBe(800 - issue.labels.length);
    expect(Object.keys(issue.extra).length + issue.extraOmitted).toBe(60);
  });

  it('always yields valid JSON within the cap, whatever the sizes (seeded random beads)', () => {
    let seed = 12345;
    const rand = (max: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return Math.floor((seed / 2 ** 32) * (max + 1));
    };
    const size = (): number => [0, 10, 300, 2_000, 9_000, 30_000][rand(5)]!;
    for (let run = 0; run < 250; run += 1) {
      const kidCount = [0, 3, 40, 200][rand(3)]!;
      const depCount = [0, 3, 60, 300][rand(3)]!;
      const b = bead('r-1', {
        title: 't'.repeat(rand(300)),
        description: 'd'.repeat(size()),
        design: 'g'.repeat(size()),
        notes: 'n'.repeat(size()),
        acceptance: 'a'.repeat(size()),
        closeReason: rand(1) ? 'c'.repeat(size()) : null,
        labels: Array.from({ length: [0, 5, 500][rand(2)]! }, (_, i) => `label-${i}`),
        extra: Object.fromEntries(Array.from({ length: [0, 2, 80][rand(2)]! }, (_, i) => [`k${i}`, 'x'.repeat(size())])),
        comments: Array.from({ length: [0, 4, 60][rand(2)]! }, (_, i) => ({ id: `c${i}`, author: 'A', text: 'z'.repeat(size() % 3_000), createdAt: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z` })),
        dependencies: Array.from({ length: depCount }, (_, i) => dep('r-1', `d-${i}`)),
      });
      const kids = Array.from({ length: kidCount }, (_, i) => bead(`k-${i}`, { parentId: 'r-1' }));
      const deps = Array.from({ length: depCount }, (_, i) => bead(`d-${i}`));
      const { text } = buildContext(b, relatedFor(b, [b, ...kids, ...deps]));
      expect(text.length, `run ${run}`).toBeLessThanOrEqual(CAP);
      const { issue } = parse(text);
      expect(issue.id).toBe('r-1');
      // a short acceptance is never cut, however large everything else is
      if (b.acceptance.length <= 2_000) expect(issue.acceptance, `run ${run}`).toBe(b.acceptance);
    }
  });

  it('falls back to a small valid document when even the title is enormous', () => {
    const { text, title } = buildContext(bead('a', { title: 't'.repeat(50_000), status: 's'.repeat(50_000) }), noRelated);
    expect(text.length).toBeLessThanOrEqual(CAP);
    expect(parse(text).issue.id).toBe('a');
    expect(title.length).toBe(200);
  });

  it('does not split a surrogate pair when clamping the chip title', () => {
    const { title } = buildContext(bead('a', { title: '😀'.repeat(150) }), noRelated);
    expect(title.length).toBeLessThanOrEqual(200);
    expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(title)).toBe(false);
  });
});

describe('beadUrl', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await realpath(await mkdtemp(join(tmpdir(), 'oc-beads-ctx-')));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  function repoWithOrigin(url: string | null): string {
    execFileSync('git', ['init', '-q'], { cwd: tmp });
    if (url !== null) execFileSync('git', ['remote', 'add', 'origin', url], { cwd: tmp });
    return tmp;
  }

  it('uses the web repo url for a GitHub https remote', async () => {
    expect(await beadUrl(repoWithOrigin('https://github.com/acme/demo.git'), 'demo', 'demo-k3f2')).toBe('https://github.com/acme/demo?bead=demo-k3f2');
  });

  it('strips credentials from an https remote', async () => {
    expect(await beadUrl(repoWithOrigin('https://user:s3cr3t@github.com/acme/demo'), 'demo', 'a-1')).toBe('https://github.com/acme/demo?bead=a-1');
  });

  it('handles the scp-like GitHub ssh form', async () => {
    expect(await beadUrl(repoWithOrigin('git@github.com:acme/demo.git'), 'demo', 'a-1')).toBe('https://github.com/acme/demo?bead=a-1');
  });

  it('handles the ssh:// form, ignoring the ssh port', async () => {
    expect(await beadUrl(repoWithOrigin('ssh://git@github.com:22/acme/demo.git'), 'demo', 'a-1')).toBe('https://github.com/acme/demo?bead=a-1');
  });

  it('handles GitLab, including subgroups and self-hosted gitlab hosts', async () => {
    expect(await beadUrl(repoWithOrigin('https://gitlab.com/group/sub/repo.git'), 'repo', 'r-1')).toBe('https://gitlab.com/group/sub/repo?bead=r-1');
  });

  it('handles a self-hosted gitlab host over ssh', async () => {
    expect(await beadUrl(repoWithOrigin('git@gitlab.example.test:team/repo.git'), 'repo', 'r-1')).toBe('https://gitlab.example.test/team/repo?bead=r-1');
  });

  it('encodes the bead id', async () => {
    expect(await beadUrl(repoWithOrigin('https://github.com/acme/demo'), 'demo', 'a b/1')).toBe('https://github.com/acme/demo?bead=a%20b%2F1');
  });

  it('falls back to the no-web-page help for a repo with no origin', async () => {
    expect(await beadUrl(repoWithOrigin(null), 'my project', 'a-1')).toBe(NO_WEB_PAGE_URL);
  });

  it('falls back for a directory that is not a git repo', async () => {
    expect(await beadUrl(tmp, 'plain', 'a-1')).toBe(NO_WEB_PAGE_URL);
  });

  it('falls back for a remote on another host', async () => {
    expect(await beadUrl(repoWithOrigin('https://git.example.test/acme/demo.git'), 'demo', 'a-1')).toBe(NO_WEB_PAGE_URL);
  });

  it('does not throw for a directory that does not exist', async () => {
    expect(await beadUrl(join(tmp, 'nope'), 'proj', 'a-1')).toBe(NO_WEB_PAGE_URL);
  });

  it('always returns an http(s) url, even for a local-path remote', async () => {
    expect(await beadUrl(repoWithOrigin('/srv/git/demo.git'), 'demo', 'a-1')).toMatch(/^https?:\/\//);
  });
});

describe('buildConflictContext', () => {
  const conflict = (over: Partial<Extract<SyncState, { kind: 'conflict' }>> = {}): Extract<SyncState, { kind: 'conflict' }> => ({
    kind: 'conflict',
    mode: 'embedded',
    halfMerged: false,
    beads: [{ beadId: 'a-1', title: 'Fix it', ours: { status: 'closed' }, theirs: { status: 'blocked' } }],
    log: "$ bd --actor 'Ann (panel)' dolt pull\nexit 1\nmerge aborted and working set restored",
    ...over,
  });

  function parseConflict(text: string): Record<string, any> {
    const header = 'Beads sync needs attention (JSON)\n';
    expect(text.startsWith(header)).toBe(true);
    return JSON.parse(text.slice(header.length));
  }

  it('describes the project, the beads on both sides, the log and the rules', () => {
    const text = buildConflictContext('/work/demo', conflict(), 'Always pull before push.');
    const json = parseConflict(text);
    expect(json.project).toBe('/work/demo');
    expect(json.problem).toBe('conflict');
    expect(json.halfMerged).toBe(false);
    expect(json.beads).toEqual([{ id: 'a-1', title: 'Fix it', ours: { status: 'closed' }, theirs: { status: 'blocked' } }]);
    expect(json.log).toContain("bd --actor 'Ann (panel)' dolt pull");
    expect(json.projectRules).toBe('Always pull before push.');
  });

  it('works for a plain sync error, with no rules', () => {
    const text = buildConflictContext('/work/demo', { kind: 'error', message: 'Could not reach the team.', log: '$ bd dolt pull\nexit 1' }, null);
    const json = parseConflict(text);
    expect(json.problem).toBe('error');
    expect(json.message).toBe('Could not reach the team.');
    expect(json.beads).toEqual([]);
    expect(json.projectRules).toBeNull();
  });

  it('works for a paused upgrade, like a plain error', () => {
    const text = buildConflictContext('/work/demo', { kind: 'paused-upgrade', message: "This project's beads data needs a different Beads version. Hand it to your agent to check.", log: '$ bd dolt pull\nexit 1' }, null);
    const json = parseConflict(text);
    expect(json.problem).toBe('paused-upgrade');
    expect(json.message).toContain('needs a different Beads version');
    expect(json.log).toContain('exit 1');
    expect(json.beads).toEqual([]);
  });

  it('caps at 16,000, trimming the log from the start and keeping the end', () => {
    const log = 'early line\n' + 'x'.repeat(30_000) + '\nthe very last line';
    const text = buildConflictContext('/p', conflict({ log }), null);
    expect(text.length).toBeLessThanOrEqual(CAP);
    const json = parseConflict(text);
    expect(json.log.endsWith('the very last line')).toBe(true);
    expect(json.log).not.toContain('early line');
    expect(json.beads).toHaveLength(1);
  });

  const realisticLog = (lastExit: string): string =>
    [
      "$ bd --readonly dolt remote list --json\nexit 0\n[{\"name\":\"origin\"}]",
      "$ bd --actor 'Ann (panel)' dolt pull\nexit 1\n" + 'merge noise '.repeat(250),
      "$ bd --actor 'Ann (panel)' dolt pull\nexit 1\n" + lastExit,
    ].join('\n\n');
  const LAST = "$ bd --actor 'Ann (panel)' dolt pull\nexit 1\nLAST-BLOCK-MARKER";

  it('keeps the beads and the last command when one bead has 20k on both sides', () => {
    const state = conflict({
      beads: [{ beadId: 'a-1', title: 'Fix it', ours: { description: 'o'.repeat(20_000) }, theirs: { description: 't'.repeat(20_000) } }],
      log: realisticLog('LAST-BLOCK-MARKER'),
    });
    const text = buildConflictContext('/p', state, 'Pull before push.');
    expect(text.length).toBeLessThanOrEqual(CAP);
    const json = parseConflict(text);
    expect(json.mode).toBe('embedded');
    expect(json.beads).toHaveLength(1);
    expect(json.beads[0].ours.description.startsWith('ooo')).toBe(true);
    expect(json.beads[0].ours.description.endsWith(' [truncated]')).toBe(true);
    expect(json.beads[0].theirs.description.endsWith(' [truncated]')).toBe(true);
    expect(json.log).toContain(LAST);
    expect(json.beadsOmitted).toBeUndefined();
  });

  it('keeps the last command and as many beads as fit with ten beads of 1k per side', () => {
    const beads = Array.from({ length: 10 }, (_, i) => ({ beadId: `a-${i}`, title: `Bead ${i}`, ours: { notes: 'o'.repeat(1_000) }, theirs: { notes: 't'.repeat(1_000) } }));
    const text = buildConflictContext('/p', conflict({ beads, log: realisticLog('LAST-BLOCK-MARKER') }), null);
    expect(text.length).toBeLessThanOrEqual(CAP);
    const json = parseConflict(text);
    expect(json.beads.length).toBeGreaterThan(0);
    expect(json.beads.length + (json.beadsOmitted ?? 0)).toBe(10);
    expect(json.log).toContain(LAST);
  });

  it('drops beads from the end, with a count, only after the log is down to its last command', () => {
    const beads = Array.from({ length: 200 }, (_, i) => ({ beadId: `a-${i}`, title: `Bead number ${i}`, ours: { status: 'closed' }, theirs: { status: 'blocked' } }));
    const json = parseConflict(buildConflictContext('/p', conflict({ beads, log: realisticLog('LAST-BLOCK-MARKER') }), null));
    expect(json.beadsOmitted).toBe(200 - json.beads.length);
    expect(json.beads.length).toBeGreaterThan(0);
    expect(json.beads[0].id).toBe('a-0');
    expect(json.log).toContain(LAST);
    expect(json.log).not.toContain('merge noise');
  });

  it('always parses and stays within the cap for any mix of sizes (seeded random states)', () => {
    let seed = 777;
    const rand = (max: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return Math.floor((seed / 2 ** 32) * (max + 1));
    };
    const size = (): number => [0, 20, 1_000, 8_000, 30_000][rand(4)]!;
    for (let run = 0; run < 200; run += 1) {
      const beads = Array.from({ length: [0, 1, 10, 300][rand(3)]! }, (_, i) => ({ beadId: `a-${i}`, title: 'T'.repeat(rand(80)), ours: { f: 'o'.repeat(size()) }, theirs: { f: 't'.repeat(size()) } }));
      const log = Array.from({ length: rand(5) }, (_, i) => `$ bd step ${i}\nexit 1\n` + 'l'.repeat(size() % 9_000)).join('\n\n');
      const text = buildConflictContext('/p', conflict({ beads, log }), rand(1) ? 'r'.repeat(size()) : null);
      expect(text.length, `run ${run}`).toBeLessThanOrEqual(CAP);
      expect(parseConflict(text).project).toBe('/p');
    }
  });

  it('still fits when the rules are huge, keeping the start of the rules', () => {
    const text = buildConflictContext('/p', conflict(), 'RULES-START ' + 'r'.repeat(40_000));
    expect(text.length).toBeLessThanOrEqual(CAP);
    expect(parseConflict(text).projectRules.startsWith('RULES-START')).toBe(true);
  });
});
