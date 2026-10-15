/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { createClient } from '../../../src/panel/client';
import { createStore, StoreContext } from '../../../src/panel/store';
import { App } from '../../../src/panel/ui/App';
import type { Bead } from '../../../src/shared/types';
import { deferred, envelope, fakeHost, flush, freshness, json, snapshot, type Answer, type Call } from './helpers';

const STDERR = 'Error: failed to open database: schema version mismatch: database is at v32, binary expects v66';

const OLD = snapshot({
  freshness: freshness({ localError: 'This project needs a one-time update for the newer Beads.', localErrorDetail: STDERR, schemaUpdate: { from: 32, to: 66 } }),
});

const bead = (id: string): Bead => ({
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
  createdAt: '2026-10-01T00:00:00Z',
  createdBy: null,
  updatedAt: '2026-10-02T00:00:00Z',
  closedAt: null,
  closeReason: null,
  dependencies: [],
  comments: [],
  extra: {},
});

const CURRENT = snapshot({ cursor: 'c2', beads: [bead('p-1')], readyIds: ['p-1'], freshness: freshness({ localRefreshedAt: '2026-10-14T12:00:00Z' }) });

const always = { isVisible: () => true, isDocumentHidden: () => false, onChange: () => () => {} };

type Job = NonNullable<ReturnType<typeof freshness>['schemaUpdateJob']>;
const RUNNING: Job = { kind: 'running', startedAt: '2026-10-15T12:00:00Z' };
const failedJob = (over: Partial<Extract<Job, { kind: 'failed' }>> = {}): Job => ({ kind: 'failed', at: '2026-10-15T12:01:00Z', code: 'failed', message: 'It failed.', ...over });

/**
 * The panel on a project made with an older Beads. The update is a job on the service's side: `migrate` answers the request (`{ ok: true }`
 * means started) and may set `ctl.job`, which the snapshot then carries in its freshness; `ctl.updated` makes the snapshot current.
 */
function setup(migrate: (call: Call, ctl: Ctl) => Answer | Promise<Answer>) {
  const ctl: Ctl = { updated: false, job: null, rev: 0 };
  const fake = fakeHost(async (call) => {
    if (call.route === 'snapshot') {
      if (ctl.updated) return json(CURRENT);
      return json({ ...OLD, cursor: `old-${ctl.rev}`, freshness: { ...OLD.freshness, ...(ctl.job ? { schemaUpdateJob: ctl.job } : {}) } });
    }
    if (call.route === 'migrateSchema') return migrate(call, ctl);
    return envelope(409, { code: 'needs-schema-update', message: 'This project needs a one-time update for the newer Beads.' });
  });
  const store = createStore({ client: createClient(fake.host), host: fake.host, visibility: always });
  render(
    <StoreContext.Provider value={store}>
      <App />
    </StoreContext.Provider>,
  );
  return { ...fake, store, ctl, markUpdated: () => void (ctl.updated = true) };
}
type Ctl = { updated: boolean; job: Job | null; rev: number };

/** The job moved on in the service; the panel reads it on its next poll. */
const advance = (store: ReturnType<typeof setup>['store'], ctl: Ctl, to: Partial<Ctl>) =>
  act(async () => {
    Object.assign(ctl, to, { rev: ctl.rev + 1 });
    await store.checkProject();
    await flush();
  });

/** Answers the request as started, and the service's job ends as given. */
const started = (job: Job | null) => (_call: Call, ctl: Ctl) => {
  ctl.job = job;
  ctl.rev += 1;
  return json({ ok: true });
};

async function open(store: ReturnType<typeof setup>['store']) {
  await act(async () => {
    store.setDirectory('/p/a');
    await flush();
  });
}

/** A press: focus moves to the button, as it does in a browser, then the click. */
const click = (el: Element) =>
  act(async () => {
    (el as HTMLElement).focus();
    fireEvent.click(el);
    await flush();
  });

const migrations = (calls: Call[]) => calls.filter((c) => c.route === 'migrateSchema');
const block = () => document.querySelector('.bd-upd')!;

/** Opens the confirm and presses Update. */
async function confirmUpdate() {
  await click(screen.getByRole('button', { name: 'Update project' }));
  await click(screen.getByRole('button', { name: 'Update' }));
  // The request, then the read that brings the job into the snapshot.
  await act(flush);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a project that needs the one-time update', () => {
  it('shows the update in place of the empty list and the "couldn\'t load" state, with no stale banner or list tools', async () => {
    const { store } = setup(() => json({ ok: true }));
    await open(store);
    expect(screen.getByRole('heading', { name: 'This project needs a one-time update for the newer Beads.' })).toBeTruthy();
    expect(screen.getByText(/made with an older version of Beads/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update project' })).toBeTruthy();
    expect(screen.queryByText("Couldn't load this project's beads.")).toBeNull();
    expect(screen.queryByText('No beads in this project yet.')).toBeNull();
    expect(document.querySelector('.bd-stale')).toBeNull();
    expect(document.querySelector('.bd-tools')).toBeNull();
    // Nothing was read, so the header claims no freshness.
    expect(document.querySelector('.bd-fresh')).toBeNull();
  });

  it('the status line is a live region that is there from the start and never taken out of the accessibility tree', async () => {
    const { store } = setup(() => json({ ok: true }));
    await open(store);
    const say = document.querySelector<HTMLElement>('.bd-upd-say')!;
    expect(say.getAttribute('role')).toBe('status');
    expect(say.textContent).toBe('');
    expect(say.hidden).toBe(false);
    // An empty status line must not be display:none (that removes it from the accessibility tree); it keeps its height instead.
    const css = readFileSync(join(__dirname, '../../../src/panel/ui/styles.css'), 'utf8');
    expect(css).not.toMatch(/\.bd-upd-say:empty\s*\{[^}]*display:\s*none/);
    expect(/\.bd-upd-say\s*\{[^}]*min-height/.test(css)).toBe(true);
    await click(screen.getByRole('button', { name: 'Update project' }));
    await click(screen.getByRole('button', { name: 'Update' }));
    expect(document.querySelector('.bd-upd-say')).toBe(say);
  });

  it('keeps the raw error behind a closed Details disclosure, and no command words in the visible copy', async () => {
    const { store } = setup(() => json({ ok: true }));
    await open(store);
    const details = document.querySelector<HTMLDetailsElement>('.bd-upd-more')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('Details');
    expect(details.querySelector('pre')!.textContent).toBe(STDERR);
    await click(screen.getByRole('button', { name: 'Update project' }));
    const shown = Array.from(block().querySelectorAll('h2, p, button, summary'))
      .map((el) => el.textContent ?? '')
      .join(' ');
    expect(shown).not.toMatch(/\b(bd|migrat\w*|schema|dolt)\b|—/i);
    expect(shown).toMatch(/your beads themselves don't change/i);
    expect(shown).toMatch(/older Beads may not open this project/);
  });

  it('asks before anything is sent; Cancel sends nothing and returns focus to the button', async () => {
    const { store, calls } = setup(() => json({ ok: true }));
    await open(store);
    await click(screen.getByRole('button', { name: 'Update project' }));
    expect(screen.getByRole('alertdialog', { name: 'Update this project?' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    expect(migrations(calls)).toHaveLength(0);
    await click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Update project' }));
    expect(migrations(calls)).toHaveLength(0);
  });

  it('Escape answers the confirm as Cancel', async () => {
    const { store, calls } = setup(() => json({ ok: true }));
    await open(store);
    await click(screen.getByRole('button', { name: 'Update project' }));
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
      await flush();
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(migrations(calls)).toHaveLength(0);
  });

  it('sends confirm: true once, answers as started, follows the job in the snapshot, and the list returns when it ends', async () => {
    const gate = deferred<Answer>();
    const { store, calls, ctl } = setup(async (call, c) => {
      const answer = await gate.promise;
      return started(RUNNING)(call, c) && answer;
    });
    await open(store);
    await confirmUpdate();
    const go = screen.getByRole('button', { name: 'Updating…' });
    expect(go.getAttribute('aria-disabled')).toBe('true');
    expect(go.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(go);
    const say = document.querySelector('.bd-upd-say')!;
    expect(say.getAttribute('role')).toBe('status');
    expect(say.textContent).toBe('Updating this project. This can take a minute or two.');
    // A second press while it runs sends nothing.
    await click(go);
    expect(migrations(calls)).toEqual([{ route: 'migrateSchema', body: { directory: '/p/a', confirm: true } }]);
    await act(async () => {
      gate.resolve(json({ ok: true }));
      await flush();
      await flush();
    });
    // Read again with the workspace detected again; the job is in that read, so the block keeps saying it is running.
    expect(calls.filter((c) => c.route === 'snapshot').at(-1)!.body).toMatchObject({ refreshWorkspace: true });
    expect(screen.getByRole('button', { name: 'Updating…' })).toBeTruthy();
    expect(document.querySelector('.bd-upd-say')!.textContent).toMatch(/Updating this project/);
    // It ends: the project reads normally.
    await advance(store, ctl, { updated: true, job: null });
    expect(document.querySelector('.bd-upd')).toBeNull();
    expect(screen.getByText('Title p-1')).toBeTruthy();
  });

  it('a block mounted while the job runs (another panel pressed it) says so and sends nothing', async () => {
    const { store, calls, ctl } = setup(() => json({ ok: true }));
    ctl.job = RUNNING;
    await open(store);
    expect(screen.getByRole('button', { name: 'Updating…' })).toBeTruthy();
    expect(document.querySelector('.bd-upd-say')!.textContent).toBe('Updating this project. This can take a minute or two.');
    expect(migrations(calls)).toHaveLength(0);
  });

  it('after a successful update, focus that was in the block goes to the list, not the page', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { store, ctl } = setup(started(RUNNING));
    await open(store);
    await confirmUpdate();
    expect(block().contains(document.activeElement)).toBe(true);
    await advance(store, ctl, { updated: true, job: null });
    expect(document.querySelector('.bd-upd')).toBeNull();
    // The list may take a moment to appear; focus waits for it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    const list = document.querySelector<HTMLElement>('.bd-body [role="listbox"]');
    expect(list).not.toBeNull();
    expect(document.activeElement).toBe(list);
  });

  it('busy: says so and offers Try again, which sends again without a second confirm', async () => {
    let n = 0;
    const { store, calls } = setup(() => (n++ === 0 ? envelope(503, { code: 'busy', message: 'Beads is busy with another change. Nothing was changed.' }) : json({ ok: true })));
    await open(store);
    await confirmUpdate();
    expect(screen.getByRole('alert').textContent).toBe('Beads is busy with another change. Nothing was changed.');
    const again = screen.getByRole('button', { name: 'Try again' });
    expect(document.activeElement).toBe(again);
    expect(block().contains(document.activeElement)).toBe(true);
    await click(again);
    await act(flush);
    expect(migrations(calls)).toHaveLength(2);
    expect(migrations(calls)[1]!.body).toEqual({ directory: '/p/a', confirm: true });
  });

  it('a project shared with the team: the plain who-can-do-it copy and Details, no button to try again, kept across a remount and a lost job', async () => {
    const message =
      "This project shares its beads with your team, so Beads won't update it from here. Ask whoever set up the team copy to update it, or update it on the computer that hosts it.";
    const REFUSAL = 'refusing to auto-apply 34 pending schema migrations to a remote-backed database (v32 -> v66)';
    const { store, calls, ctl } = setup(started(failedJob({ code: 'update-blocked-shared', message, detail: REFUSAL })));
    await open(store);
    await confirmUpdate();
    expect(screen.getByRole('alert').textContent).toBe(message);
    expect(message).not.toMatch(/\b(bd|migrat\w*|schema|dolt|force)\b|—/i);
    // Nothing to press: pressing again could only be refused the same way.
    expect(block().querySelector('button')).toBeNull();
    expect(screen.queryByRole('button', { name: /update|try again|check again/i })).toBeNull();
    // Details holds Beads' own words, closed by default.
    const details = document.querySelector<HTMLDetailsElement>('.bd-upd-more')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('pre')!.textContent).toBe(REFUSAL);
    expect(migrations(calls)).toHaveLength(1);
    // The next poll keeps it: still the same state, still no button.
    await act(async () => {
      await store.checkProject();
      await flush();
    });
    expect(screen.queryByRole('button', { name: /update|try again/i })).toBeNull();
    // The service forgot the job (a restart) and the block is mounted again: the panel remembers it for this project.
    cleanup();
    ctl.job = null;
    ctl.rev += 1;
    render(
      <StoreContext.Provider value={store}>
        <App />
      </StoreContext.Provider>,
    );
    await act(async () => {
      await store.checkProject();
      await flush();
    });
    expect(screen.getByRole('alert').textContent).toBe(message);
    expect(screen.queryByRole('button', { name: /update|try again|check again/i })).toBeNull();
    expect(migrations(calls)).toHaveLength(1);
  });

  it('a project shared with the team stays that way when the person leaves the project and comes back', async () => {
    const message = 'This project shares its beads with your team.';
    const { store, ctl } = setup(started(failedJob({ code: 'update-blocked-shared', message })));
    await open(store);
    await confirmUpdate();
    expect(screen.getByRole('alert').textContent).toBe(message);
    ctl.job = null;
    ctl.rev += 1;
    await act(async () => {
      store.setDirectory('/p/b');
      await flush();
    });
    await act(async () => {
      store.setDirectory('/p/a');
      await flush();
    });
    expect(screen.getByRole('alert').textContent).toBe(message);
    expect(screen.queryByRole('button', { name: /update|try again|check again/i })).toBeNull();
  });

  it('sync running: asks to wait for the sync, and the button asks again before sending', async () => {
    const { store, calls } = setup(() => envelope(409, { code: 'sync-running', message: 'A sync is running.' }));
    await open(store);
    await confirmUpdate();
    expect(screen.getByRole('alert').textContent).toBe('Wait for the sync to finish, then try again.');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Update project' }));
    await click(screen.getByRole('button', { name: 'Update project' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(migrations(calls)).toHaveLength(1);
  });

  it('failed: shows the service words, and their raw cause goes behind Details', async () => {
    const { store } = setup(() => envelope(500, { code: 'failed', message: "The project still can't be read after the update.", detail: 'exit status 1: still v32' }));
    await open(store);
    await confirmUpdate();
    expect(screen.getByRole('alert').textContent).toBe("The project still can't be read after the update.");
    expect(document.querySelector('.bd-upd-raw')!.textContent).toBe('exit status 1: still v32');
    expect(block().contains(document.activeElement)).toBe(true);
  });

  it('uncertain and saved: says it may have finished, reads again, and offers no blind retry', async () => {
    const { store, calls } = setup(() =>
      envelope(504, { code: 'uncertain', message: "The update may have worked, but Beads didn't confirm it.", saved: true }),
    );
    await open(store);
    await confirmUpdate();
    expect(document.querySelector('.bd-upd-note')!.textContent).toBe("The update may have finished, but Beads didn't confirm it. Reading the project again.");
    expect(document.activeElement).toBe(document.querySelector('.bd-upd-note'));
    expect(screen.queryByRole('button', { name: 'Update project' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    const before = calls.filter((c) => c.route === 'snapshot').length;
    // Check again reads the project; still old, so the update may be offered again, and nothing was sent again by itself.
    await click(screen.getByRole('button', { name: 'Check again' }));
    await act(flush);
    expect(calls.filter((c) => c.route === 'snapshot').length).toBeGreaterThan(before);
    expect(migrations(calls)).toHaveLength(1);
    expect(document.querySelector('.bd-upd-note')!.textContent).toBe('This project still needs the update.');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Update project' }));
  });

  it('uncertain and done after all: the read again brings the list back', async () => {
    const harness = setup(() => envelope(504, { code: 'uncertain', message: 'Beads took too long to answer.', saved: true }));
    await open(harness.store);
    await click(screen.getByRole('button', { name: 'Update project' }));
    harness.markUpdated();
    await click(screen.getByRole('button', { name: 'Update' }));
    await act(flush);
    expect(document.querySelector('.bd-upd')).toBeNull();
    expect(screen.getByText('Title p-1')).toBeTruthy();
  });

  it('uncertain without saved: keeps the service words, and still no blind retry', async () => {
    const { store } = setup(() => envelope(504, { code: 'uncertain', message: 'The update may still be running.' }));
    await open(store);
    await confirmUpdate();
    expect(document.querySelector('.bd-upd-note')!.textContent).toBe('The update may still be running. Reading the project again.');
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Update project' })).toBeNull();
  });

  it('a job that ended busy offers Try again, which sends again without a second confirm', async () => {
    let n = 0;
    const { store, calls, ctl } = setup((call, c) => {
      n += 1;
      return started(n === 1 ? failedJob({ code: 'busy', message: 'Beads is busy with another change. Nothing was changed.' }) : RUNNING)(call, c);
    });
    await open(store);
    await confirmUpdate();
    expect(screen.getByRole('alert').textContent).toBe('Beads is busy with another change. Nothing was changed.');
    const again = screen.getByRole('button', { name: 'Try again' });
    expect(document.activeElement).toBe(again);
    await click(again);
    await act(flush);
    expect(migrations(calls)).toHaveLength(2);
    expect(migrations(calls)[1]!.body).toEqual({ directory: '/p/a', confirm: true });
    expect(screen.getByRole('button', { name: 'Updating…' })).toBeTruthy();
    expect(ctl.job).toEqual(RUNNING);
  });

  it('a job that ended saved but unconfirmed: says it may have finished and offers only Check again, which does not start anything', async () => {
    const { store, calls } = setup(started(failedJob({ code: 'uncertain', saved: true, message: 'May be updated.' })));
    await open(store);
    await confirmUpdate();
    expect(document.querySelector('.bd-upd-note')!.textContent).toBe("The update may have finished, but Beads didn't confirm it. Reading the project again.");
    expect(document.activeElement).toBe(document.querySelector('.bd-upd-note'));
    expect(screen.queryByRole('button', { name: 'Update project' })).toBeNull();
    await click(screen.getByRole('button', { name: 'Check again' }));
    await act(flush);
    expect(migrations(calls)).toHaveLength(1);
    expect(document.querySelector('.bd-upd-note')!.textContent).toBe('This project still needs the update.');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Update project' }));
  });

  it('Check again while the update is still running shows that it is running, not "still needs the update"', async () => {
    const { store, ctl } = setup(() => envelope(504, { code: 'uncertain', message: 'Beads took too long to answer.' }));
    await open(store);
    await confirmUpdate();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
    // The update did start after all, and still runs.
    ctl.job = RUNNING;
    ctl.rev += 1;
    await click(screen.getByRole('button', { name: 'Check again' }));
    await act(flush);
    expect(document.querySelector('.bd-upd-say')!.textContent).toBe('Updating this project. This can take a minute or two.');
    expect(screen.getByRole('button', { name: 'Updating…' })).toBeTruthy();
    expect(screen.queryByText('This project still needs the update.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
  });
});

describe('while the project waits for the update, nothing can write to it', () => {
  /** A current project with a bead and the New bead form open, then the store turns old under the open panel. */
  async function turnOld() {
    let old = false;
    const fake = fakeHost(async (call) => {
      if (call.route === 'snapshot') return json(old ? OLD : CURRENT);
      if (call.route === 'migrateSchema') return json({ ok: true });
      return envelope(409, { code: 'needs-schema-update', message: 'This project needs a one-time update for the newer Beads.' });
    });
    const store = createStore({ client: createClient(fake.host), host: fake.host, visibility: always });
    render(
      <StoreContext.Provider value={store}>
        <App />
      </StoreContext.Provider>,
    );
    await open(store);
    await act(async () => {
      store.select('p-1');
      await flush();
    });
    await act(async () => {
      store.openCreate();
      await flush();
    });
    expect(document.querySelector('.bd-detail')).not.toBeNull();
    expect(document.querySelector('.bd-create')).not.toBeNull();
    old = true;
    await act(async () => {
      await store.checkProject();
      await flush();
    });
    return { ...fake, store };
  }

  it('hides the bead detail and the New bead form, so no comment or new bead can reach bd', async () => {
    const { calls } = await turnOld();
    expect(block()).toBeTruthy();
    expect(document.querySelector('.bd-detail')).toBeNull();
    expect(document.querySelector('.bd-create')).toBeNull();
    expect(screen.queryByRole('textbox', { name: /comment/i })).toBeNull();
    expect(calls.filter((c) => ['comment', 'create', 'update'].includes(c.route))).toHaveLength(0);
    // The header has no New bead button for this state, and the edit tools read as paused.
    expect(document.querySelector('.bd-newbtn')).toBeNull();
  });

  it('memories are not shown over the update either', async () => {
    const { store } = await turnOld();
    await act(async () => {
      store.setPage('memories');
      await flush();
    });
    expect(document.querySelector('.bd-mem')).toBeNull();
    expect(block()).toBeTruthy();
  });
});

