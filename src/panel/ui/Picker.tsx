import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AttachIssueRequest, GuestItem, HostClient } from '@openchamber/sdk';
import type { Bead, StatusDef } from '../../shared/types';
import { asRequestError, createClient, type BeadsClient } from '../client';
import { acceptanceItems } from '../detail';
import { shortAgo } from '../format';
import { composing } from '../keyboard';
import { humanize, looker, markerOf, shortId, statusLabel, WEEK_MS } from '../list';
import { attachPayload, beadOfItem, chipDirectory, isSyncChip } from '../resolve';
import { createStore, firstLoadError, needsUpdate, StoreContext, useNow, useStore, type StoreDeps } from '../store';
import { addStyles, type PanelHost } from './App';
import { EmptyState, Loading, LoadError, WorkspaceEmpty } from './EmptyState';
import { UPDATE_TITLE } from './ProjectUpdate';
import { IconSearch, IconSpinner, TypeIcon } from './icons';
import { Markdown } from './Markdown';
import { Priority, StatusDot } from './Row';

export type DialogHost = Pick<PanelHost, 'serviceRequest' | 'storage' | 'toast' | 'setBadge' | 'writeClipboard' | 'openUrl' | 'attach'> & Pick<HostClient, 'close'>;

/** The beads to offer for `query`: what is not done (and what closed this week), or with a query anything that matches. */
export function pickable(beads: Bead[], statuses: StatusDef[], query: string, now: number): Bead[] {
  const look = looker(statuses);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = beads.filter((b) => {
    if (words.length === 0) {
      if (look(b.status) !== 'done') return true;
      const closed = Date.parse(b.closedAt ?? b.updatedAt);
      return Number.isFinite(closed) && now - closed < WEEK_MS;
    }
    const text = `${b.id} ${b.title}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
  return hits.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
}

const optionId = (id: string) => `bdp-opt-${id}`;

/** One bead in full enough to choose it: kind, state, people, then what it says. */
function Preview({ bead, statuses }: { bead: Bead; statuses: StatusDef[] }) {
  const look = looker(statuses)(bead.status);
  const acceptance = bead.acceptance.trim();
  const items = acceptance ? acceptanceItems(acceptance) : null;
  return (
    <article class="bdp-card" key={bead.id}>
      <div class="bdp-kind">
        <span class="bd-ty" data-type={bead.type} title={bead.type}>
          <TypeIcon type={bead.type} size={13} />
        </span>
        <span>{humanize(bead.type || 'bead')}</span>
        <span class="bdp-fullid">{bead.id}</span>
      </div>
      <h2 class="bdp-title">{bead.title || bead.id}</h2>
      <div class="bdp-meta">
        <span class="bd-pill" data-look={look} title={bead.status}>
          <StatusDot look={look} marker={markerOf(bead.status)} />
          {statusLabel(bead.status, statuses)}
        </span>
        <Priority value={bead.priority} />
        {bead.assignee && <span class="bdp-who">{bead.assignee}</span>}
        {bead.labels.slice(0, 4).map((label) => (
          <span key={label} class="bd-lb">
            {label}
          </span>
        ))}
      </div>
      {bead.description.trim() ? <Markdown class="bd-txt bdp-text" text={bead.description} /> : <p class="bdp-none">No description.</p>}
      {acceptance && (
        <section class="bdp-sec">
          <h3 class="bdp-sec-title">Acceptance criteria{items ? ` · ${items.length}` : ''}</h3>
          <Markdown class="bd-txt bdp-text" text={acceptance} />
        </section>
      )}
    </article>
  );
}

/** The + menu picker: search, the beads beside a preview of the highlighted one, Enter attaches. */
function Picker({ host, client }: { host: DialogHost; client: Pick<BeadsClient, 'context'> }) {
  const state = useStore();
  const now = useNow(60_000);
  const snapshot = state.snapshot!;
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const minute = Math.floor(now / 60_000) * 60_000;
  const beads = useMemo(() => pickable(snapshot.beads, snapshot.statuses, query, minute), [snapshot.beads, snapshot.statuses, query, minute]);
  const at = cursor !== null && beads.some((b) => b.id === cursor) ? cursor : (beads[0]?.id ?? null);
  const shown = beads.find((b) => b.id === at) ?? null;
  const look = useMemo(() => looker(snapshot.statuses), [snapshot.statuses]);

  useEffect(() => input.current?.focus(), []);
  // The cursor holds an id, never a place: the first bead shown stays highlighted when a refresh reorders the list.
  useEffect(() => {
    if (at !== cursor) setCursor(at);
  }, [at, cursor]);
  useEffect(() => {
    if (at) document.getElementById(optionId(at))?.scrollIntoView?.({ block: 'nearest' });
  }, [at]);

  const move = (step: number) => {
    if (beads.length === 0) return;
    const i = beads.findIndex((b) => b.id === at);
    setCursor(beads[Math.max(0, Math.min(beads.length - 1, i + step))]!.id);
  };

  /**
   * Attaches the bead, read fresh, and closes; on failure stays open and says why. OpenChamber's + menu dialog takes one
   * chip per open, so there is no picking several.
   */
  async function attach(id: string | null) {
    const directory = state.directory;
    if (busy || id === null || directory === null) return;
    setBusy(true);
    setError(null);
    try {
      const chip: AttachIssueRequest = attachPayload(await client.context({ directory, id }), directory);
      await host.attach(chip);
    } catch (thrown) {
      setBusy(false);
      setError(`Couldn't attach ${shortId(id)}. ${asRequestError(thrown).message}`);
      return;
    }
    setBusy(false);
    host.close().catch(() => {});
  }

  const chooseNow = () => void attach(at);

  const onKeyDown = (e: KeyboardEvent) => {
    if (composing(e)) return;
    const ctrl = e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === 'ArrowDown' || (ctrl && e.key === 'n')) move(1);
    else if (e.key === 'ArrowUp' || (ctrl && e.key === 'p')) move(-1);
    else if (e.key === 'Enter') {
      // Shift+Enter does nothing: one bead per open.
      if (!e.shiftKey) chooseNow();
    }
    else if (e.key === 'Escape') {
      if (query) setQuery('');
      else host.close().catch(() => {});
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div class="bdp" aria-busy={busy}>
      <div class="bdp-search">
        <IconSearch size={14} />
        <input
          ref={input}
          role="combobox"
          aria-label="Search beads"
          aria-expanded="true"
          aria-controls="bdp-list"
          aria-activedescendant={at ? optionId(at) : undefined}
          aria-autocomplete="list"
          placeholder="Search by id or title"
          value={query}
          spellcheck={false}
          autoComplete="off"
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setCursor(null);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {error && (
        <p class="bdp-error" role="alert">
          {error}
        </p>
      )}
      <div class="bdp-body">
        <div ref={list} id="bdp-list" class="bdp-list" role="listbox" aria-label="Beads">
          {beads.length === 0 ? (
            <p class="bdp-empty">{query ? 'No bead has that id or title.' : 'No open beads.'}</p>
          ) : (
            beads.map((b) => {
              const l = look(b.status);
              const updated = Date.parse(b.updatedAt);
              return (
                <div
                  key={b.id}
                  id={optionId(b.id)}
                  role="option"
                  class="bdp-row"
                  data-id={b.id}
                  data-cursor={b.id === at || undefined}
                  data-done={l === 'done' || undefined}
                  aria-selected={b.id === at}
                  onMouseMove={() => b.id !== at && setCursor(b.id)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void attach(b.id)}
                >
                  <StatusDot look={l} marker={markerOf(b.status)} label={statusLabel(b.status, snapshot.statuses)} />
                  <span class="bd-id">{shortId(b.id)}</span>
                  <span class="bdp-row-title">{b.title}</span>
                  <time class="bd-age" dateTime={b.updatedAt}>
                    {Number.isFinite(updated) ? shortAgo(minute - updated) : ''}
                  </time>
                </div>
              );
            })
          )}
        </div>
        <section class="bdp-preview" role="region" aria-label="Preview">
          {shown ? <Preview bead={shown} statuses={snapshot.statuses} /> : <p class="bdp-none">Nothing to preview.</p>}
        </section>
      </div>
      <footer class="bdp-foot">
        <span class="bdp-keys" aria-hidden="true">
          <kbd>↑</kbd>
          <kbd>↓</kbd> move <kbd>↵</kbd> attach <kbd>esc</kbd> close
        </span>
        <button type="button" class="bd-btn bd-btn-sm" onClick={() => host.close().catch(() => {})}>
          Cancel
        </button>
        <button type="button" class="bd-btn bd-btn-sm bd-btn-primary" disabled={busy || !at} onClick={chooseNow}>
          {busy ? (
            <>
              <IconSpinner size={12} />
              Attaching…
            </>
          ) : (
            'Attach'
          )}
        </button>
      </footer>
    </div>
  );
}

/** Opened from a chip: that bead, read as the project has it now. */
function ChipView({ id, host }: { id: string; host: DialogHost }) {
  const state = useStore();
  const bead = state.snapshot?.beads.find((b) => b.id === id) ?? null;
  return (
    <div class="bdp bdp-chip">
      <div class="bdp-chip-body">
        {bead ? (
          <Preview bead={bead} statuses={state.snapshot!.statuses} />
        ) : (
          <EmptyState tone="neutral" title={`${shortId(id)} is no longer in this project.`} body="It may have been deleted since it was attached." />
        )}
      </div>
      <footer class="bdp-foot">
        <span class="bdp-keys" />
        <button type="button" class="bd-btn bd-btn-sm" onClick={() => host.close().catch(() => {})}>
          Close
        </button>
      </footer>
    </div>
  );
}

/** Opened from the sync problem's chip: what it is, and where its state is now. */
function SyncChipView({ host, here }: { host: DialogHost; here: boolean }) {
  return (
    <div class="bdp bdp-chip">
      <div class="bdp-chip-body">
        <EmptyState
          tone="neutral"
          title="Beads sync problem"
          body={
            here
              ? 'This holds the details of a team sync that stopped: what happened and what Beads ran. Abacus shows whether it is still there.'
              : 'This holds the details of a team sync that stopped in another project. Open that project to see it.'
          }
        />
      </div>
      <footer class="bdp-foot">
        <span class="bdp-keys" />
        <button type="button" class="bd-btn bd-btn-sm" onClick={() => host.close().catch(() => {})}>
          Close
        </button>
      </footer>
    </div>
  );
}

function Dialog({ host, client, item }: { host: DialogHost; client: BeadsClient; item: GuestItem | null }) {
  const state = useStore();
  const chipId = beadOfItem(item, state.directory);
  const body = (() => {
    if (state.directory === null) return <EmptyState tone="neutral" title="Open a project to pick beads." />;
    if (isSyncChip(item)) return <SyncChipView host={host} here={chipDirectory(item) === state.directory} />;
    if (chipId === null && chipDirectory(item) !== null) return <EmptyState tone="neutral" title="That bead is in another project." body="Open that project to see it." />;
    if (state.workspace && state.workspace.kind !== 'ok') return <WorkspaceEmpty workspace={state.workspace} />;
    // The update runs only from the panel's own confirm; this dialog only says where.
    if (needsUpdate(state)) return <EmptyState tone="ask" title={UPDATE_TITLE} body="Update it from the Abacus panel, then pick beads here." />;
    if (firstLoadError(state)) return <LoadError />;
    if (!state.snapshot) return <Loading />;
    if (chipId) return <ChipView id={chipId} host={host} />;
    if (state.snapshot.beads.length === 0) return <EmptyState tone="neutral" title="No beads in this project yet." />;
    return <Picker host={host} client={client} />;
  })();
  return <div class="bd bd-dialog">{body}</div>;
}

/** Mounts the attach dialog for the project `directory`, opened from the + menu (`item` null) or a chip. Returns the teardown. */
export function mountAttachDialog(
  host: DialogHost,
  root: Element,
  ctx: { directory: string | null; item: GuestItem | null },
  deps: Partial<StoreDeps> = {},
): () => void {
  addStyles();
  const client = deps.client ?? createClient(host);
  const store = createStore({ client, host, ...deps });
  store.setDirectory(ctx.directory);
  render(
    <StoreContext.Provider value={store}>
      <Dialog host={host} client={client} item={ctx.item} />
    </StoreContext.Provider>,
    root,
  );
  return () => {
    store.dispose();
    render(null, root);
  };
}
