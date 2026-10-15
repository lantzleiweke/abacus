import { useMemo, useState } from 'preact/hooks';
import { ago, folderName } from '../format';
import { needsOf } from '../needs';
import { ProjectMenu } from './ProjectMenu';
import { filtersActive, firstLoadError, useNow, useStore, useStoreApi, type PanelError, type State, type View } from '../store';
import { Filters } from './Filters';
import { NewBeadButton } from './CreateForm';
import { IconAlert, IconFilter, IconFolder, IconSearch } from './icons';
import { TeamBar } from './SyncBar';

/** With no successful local refresh for this long, the header says the list may be out of date. */
export const STALE_AFTER_MS = 30_000;

export type FreshnessView = {
  local: string;
  /** When the local refresh last succeeded (ms), for replaying the "just refreshed" pulse. */
  refreshedAt: number | null;
  stale: boolean;
  /** Why it is stale, from the service; set only when stale. */
  problem: PanelError | null;
  team: string | null;
  /** Local changes the team lacks; null when the service could not count them. */
  unpublished: number | null;
};

/** What the header says about how current the list is. Null until a usable project has answered. */
export function describeFreshness(state: State, now: number): FreshnessView | null {
  const snapshot = state.snapshot;
  if (!snapshot || snapshot.workspace.kind !== 'ok') return null;
  const f = snapshot.freshness;
  // A project that needs the one-time update has nothing read to be fresh about; the body says why, with its button.
  if (f.schemaUpdate) return null;
  const parsed = f.localRefreshedAt === null ? NaN : Date.parse(f.localRefreshedAt);
  const refreshedAt = Number.isFinite(parsed) ? parsed : null;
  // Staleness never counts from before the panel started watching (opened, or shown again after being hidden).
  const quietFor = now - Math.max(refreshedAt ?? -Infinity, state.watchedSince);
  const stale = f.localError !== null || quietFor > STALE_AFTER_MS;
  let problem: PanelError | null = null;
  if (stale) {
    if (f.localError !== null) problem = { code: 'local', message: f.localError, ...(f.localErrorDetail ? { detail: f.localErrorDetail } : {}) };
    else if (state.error) problem = state.error;
    else problem = { code: 'waiting', message: "Beads hasn't answered for a while." };
  }
  const teamAt = f.teamSyncedAt === null ? NaN : Date.parse(f.teamSyncedAt);
  return {
    local: refreshedAt === null ? 'Local, not refreshed yet' : `Local, refreshed ${ago(now - refreshedAt)}`,
    refreshedAt,
    stale,
    problem,
    team: snapshot.workspace.hasRemote ? (Number.isFinite(teamAt) ? `Team synced ${ago(now - teamAt)}` : 'Team not synced yet') : null,
    unpublished: snapshot.workspace.hasRemote ? f.unpublished : 0,
  };
}

const VIEW_LABELS: Array<[View, string]> = [
  ['needs', 'Needs me'],
  ['epic', 'Epic'],
  ['status', 'Status'],
  ['activity', 'Activity'],
];

function Freshness({ view }: { view: FreshnessView }) {
  return (
    <div class="bd-fresh" data-state={view.stale ? 'stale' : 'ok'}>
      <div class="bd-local">
        {/* Keyed on the refresh time so the ring plays once per successful refresh. */}
        <i class="bd-pulse" key={view.stale ? 'stale' : view.refreshedAt ?? 'none'} aria-hidden="true" />
        <span>{view.local}</span>
      </div>
    </div>
  );
}

/**
 * Same footprint as Freshness while the first answer is on its way, so the header does not jump: the line Freshness
 * shows first, set in the same type but hidden behind a placeholder bar.
 */
function FreshnessPlaceholder() {
  return (
    <div class="bd-fresh" data-state="loading" aria-hidden="true">
      <div class="bd-local">
        <i class="bd-pulse" />
        <span class="bd-skel-text">Local, refreshed just now</span>
      </div>
    </div>
  );
}

function StaleBanner({ problem }: { problem: PanelError }) {
  const store = useStoreApi();
  return (
    <div class="bd-stale" role="status">
      <IconAlert />
      <span class="bd-stale-msg">{problem.message}</span>
      {problem.detail && (
        <button type="button" class="bd-link" onClick={() => store.copyDetails(problem)}>
          Copy details
        </button>
      )}
      <button type="button" class="bd-btn bd-btn-sm" onClick={() => store.retry()}>
        Retry
      </button>
    </div>
  );
}

type ToolsProps = { state: State; now: number; loading: boolean; filtersOpen: boolean; toggleFilters(): void };

function Tools({ state, now, loading, filtersOpen, toggleFilters }: ToolsProps) {
  const store = useStoreApi();
  // On the tab only: the rail badge keeps its meaning (beads changed since you last looked).
  const minute = Math.floor(now / 60_000) * 60_000;
  const needs = useMemo(() => needsOf(state, minute).count, [state.snapshot, state.settings, state.keep, minute]);
  const count = state.snapshot?.beads.length ?? 0;
  const unseen = state.snapshot?.unseenIds.length ?? 0;
  // The count is for screen readers only: the placeholder stays short at every width.
  const counted = count === 1 ? 'Search 1 bead' : `Search ${count} beads`;
  // The unseen chip leaves room for one word at panel width; a longer hint would be cut mid-word.
  const placeholder = unseen > 0 ? 'Search' : state.view === 'activity' ? 'Search activity' : 'Search beads';
  return (
    <div class="bd-tools" data-loading={loading || undefined}>
      <label class="bd-search" data-hint={placeholder === 'Search' ? undefined : 'long'}>
        <IconSearch />
        <input
          type="search"
          placeholder={placeholder}
          aria-label={loading ? 'Search beads' : state.view === 'activity' ? 'Search activity' : counted}
          disabled={loading}
          value={state.query}
          onInput={(e) => store.setQuery(e.currentTarget.value)}
        />
      </label>
      <div class="bd-seg" role="group" aria-label="View">
        {VIEW_LABELS.map(([id, text]) => (
          <button key={id} type="button" aria-pressed={state.view === id} disabled={loading} onClick={() => store.setView(id)} data-view={id}>
            {text}
            {id === 'needs' && needs > 0 && (
              <>
                {' '}
                <span class="bd-seg-n">{needs > 99 ? '99+' : needs}</span>
              </>
            )}
          </button>
        ))}
      </div>
      <button
        type="button"
        class="bd-iconbtn"
        aria-label="Filters"
        aria-expanded={filtersOpen}
        disabled={loading}
        data-active={(filtersActive(state.filters) && (state.view === 'epic' || state.view === 'status')) || undefined}
        onClick={toggleFilters}
      >
        <IconFilter />
      </button>
      {/* Held (disabled) while loading too: the row keeps the loaded set of tools, so the switcher does not move. */}
      <NewBeadButton />
      {unseen > 0 && (
        <button type="button" class="bd-unseen" aria-label={`${unseen === 1 ? '1 bead' : `${unseen} beads`} changed since you last looked`} title="Beads changed since you last looked" onClick={() => store.setView('activity')}>
          {unseen > 99 ? '99+' : unseen}
        </button>
      )}
    </div>
  );
}

/**
 * Project name, how fresh the list is (local and team, never blended; the team line carries Sync and Publish), and the
 * list tools once a usable project answered.
 */
export function Header() {
  const state = useStore();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const now = useNow();
  const workspace = state.workspace;
  const failed = firstLoadError(state) !== null;
  // Before the first answer for a project that may be usable: hold the full header's shape.
  const loading = state.directory !== null && !failed && state.snapshot === null && (workspace === null || workspace.kind === 'ok');
  const fresh = failed ? null : describeFreshness(state, now);
  const name = workspace?.kind === 'ok' ? workspace.projectName : state.directory ? folderName(state.directory) : 'Abacus';
  return (
    <header class="bd-head" inert={state.overlays.length > 0}>
      <div class="bd-top">
        {/* The project menu needs a project that answered; before that the name is only a name. */}
        {workspace?.kind === 'ok' && state.directory !== null ? (
          <ProjectMenu key={state.directory} name={name} title={state.directory} />
        ) : (
          <div class="bd-proj" title={state.directory ?? undefined}>
            <IconFolder />
            <span class="bd-proj-name">{name}</span>
          </div>
        )}
        {fresh && <Freshness view={fresh} />}
        {loading && <FreshnessPlaceholder />}
      </div>
      {/* Its own line, so local and team freshness are never read as one fact. */}
      {fresh?.team != null && <TeamBar team={fresh.team} unpublished={fresh.unpublished} />}
      {fresh?.problem && <StaleBanner problem={fresh.problem} />}
      {/* A bead's detail and the memories have their own top bar; the list's tools come back with the list. */}
      {(fresh || loading) && !state.detail && state.page === 'list' && (
        <Tools state={state} now={now} loading={loading} filtersOpen={filtersOpen && !loading} toggleFilters={() => setFiltersOpen((open) => !open)} />
      )}
      {fresh && filtersOpen && !state.detail && state.page === 'list' && <Filters />}
    </header>
  );
}
