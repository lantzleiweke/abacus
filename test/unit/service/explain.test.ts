import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notePanelWrite } from '../../../src/service/bd/adapter';
import { parseExplain } from '../../../src/service/bd/parse';
import { explainBead, resetExplainCache } from '../../../src/service/explain';

const ANSWER = {
  ready: [{ id: 'r1', title: 'Ready one', reason: 'no blocking dependencies' }],
  blocked: [
    { id: 'b1', title: 'Blocked one', blocked_by: [{ id: 'g1', title: 'Gate: human', status: 'open', priority: 2 }, { id: 'x', title: 'Other task', status: 'in_progress', priority: 1 }], blocked_by_count: 2 },
  ],
  schema_version: 1,
};

let readyExplain: ReturnType<typeof vi.fn>;
const provider = () => ({ readyExplain }) as unknown as Parameters<typeof explainBead>[0];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-10-14T10:00:00Z'));
  resetExplainCache();
  readyExplain = vi.fn(async () => structuredClone(ANSWER));
});
afterEach(() => vi.useRealTimers());

describe('parseExplain', () => {
  it('reads the ready ids and what each blocked bead waits on, and drops what is not an id', () => {
    const parsed = parseExplain({ ...ANSWER, blocked: [...ANSWER.blocked, { nope: 1 }, { id: 'b2', blocked_by: [{ id: 'y' }, 7] }] });
    expect([...parsed.ready]).toEqual(['r1']);
    expect(parsed.blocked.get('b1')).toEqual([{ id: 'g1', title: 'Gate: human', status: 'open' }, { id: 'x', title: 'Other task', status: 'in_progress' }]);
    expect(parsed.blocked.get('b2')).toEqual([{ id: 'y', title: '', status: '' }]);
  });

  it('an answer that is not an object is empty', () => {
    expect(parseExplain(null).ready.size).toBe(0);
    expect(parseExplain([]).blocked.size).toBe(0);
  });
});

describe('explainBead', () => {
  it('picks the bead from one cached global call', async () => {
    expect(await explainBead(provider(), '/p', 'r1')).toEqual({ state: 'ready', blockers: [] });
    expect(await explainBead(provider(), '/p', 'b1')).toEqual({
      state: 'blocked',
      blockers: [{ id: 'g1', title: 'Gate: human', status: 'open' }, { id: 'x', title: 'Other task', status: 'in_progress' }],
    });
    expect(await explainBead(provider(), '/p', 'nowhere')).toEqual({ state: 'other', blockers: [] });
    expect(readyExplain).toHaveBeenCalledTimes(1);
  });

  it('asks again after five seconds', async () => {
    await explainBead(provider(), '/p', 'r1');
    vi.setSystemTime(Date.now() + 4_900);
    await explainBead(provider(), '/p', 'r1');
    expect(readyExplain).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 200);
    await explainBead(provider(), '/p', 'r1');
    expect(readyExplain).toHaveBeenCalledTimes(2);
  });

  it('keeps one answer per project', async () => {
    await explainBead(provider(), '/p', 'r1');
    await explainBead(provider(), '/q', 'r1');
    expect(readyExplain).toHaveBeenCalledTimes(2);
  });

  it('asks again after a panel write to that project, and not after one to another', async () => {
    await explainBead(provider(), '/p', 'r1');
    await notePanelWrite('/q', 'z', { fields: ['title'] });
    await explainBead(provider(), '/p', 'r1');
    expect(readyExplain).toHaveBeenCalledTimes(1);
    await notePanelWrite('/p', 'r1', { fields: ['title'] });
    await explainBead(provider(), '/p', 'r1');
    expect(readyExplain).toHaveBeenCalledTimes(2);
  });

  it('a write while the call is out keeps its answer from being cached', async () => {
    let release = (_: unknown) => {};
    readyExplain.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const first = explainBead(provider(), '/p', 'r1');
    await notePanelWrite('/p', 'r1', { fields: ['title'] });
    release(structuredClone(ANSWER));
    expect(await first).toEqual({ state: 'ready', blockers: [] });
    await explainBead(provider(), '/p', 'r1');
    expect(readyExplain).toHaveBeenCalledTimes(2);
  });

  it('shares one call between asks made at the same time', async () => {
    await Promise.all([explainBead(provider(), '/p', 'r1'), explainBead(provider(), '/p', 'b1')]);
    expect(readyExplain).toHaveBeenCalledTimes(1);
  });

  it('a failed call is not cached', async () => {
    readyExplain.mockRejectedValueOnce(new Error('busy'));
    await expect(explainBead(provider(), '/p', 'r1')).rejects.toThrow('busy');
    expect(await explainBead(provider(), '/p', 'r1')).toEqual({ state: 'ready', blockers: [] });
  });
});
