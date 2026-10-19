import { render } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { HostClient } from '@openchamber/sdk';
import { AgentContext, createAgent } from '../agent';
import { createClient } from '../client';
import { createStore, firstLoadError, needsUpdate, StoreContext, useStore, type State, type Store, type StoreDeps } from '../store';
import { ProjectUpdate } from './ProjectUpdate';
import { AttachFooter } from './AttachFooter';
import { WorktreeSheet } from './WorktreeSheet';
import { createSync, SyncContext } from '../sync';
import { SyncCard } from './ConflictView';
import { PublishSheet } from './SyncBar';
import { Header } from './Header';
import { Detail } from './Detail';
import { List } from './List';
import { ActivityView } from './ActivityView';
import { NeedsView } from './NeedsView';
import { MemoriesPage } from './MemoriesPage';
import { Footer } from './Footer';
import { CreateForm } from './CreateForm';
import { Loading, LoadError, NoProject, WorkspaceEmpty } from './EmptyState';
import { rowDomId } from './Row';
import css from './styles.css';

/** A usable project answered with beads to list. */
const listing = (state: State): boolean =>
  state.directory !== null && (!state.workspace || state.workspace.kind === 'ok') && !firstLoadError(state) && (state.snapshot?.beads.length ?? 0) > 0;

/**
 * A bead's detail is open over a usable project. Never while the project waits for its one-time update: a comment or a new bead
 * would open the store for writing, and Beads updates the store the moment it does, so only the update's own confirm may do that.
 */
export const showingDetail = (state: State): boolean => state.detail !== null && state.snapshot !== null && (!state.workspace || state.workspace.kind === 'ok') && !needsUpdate(state);

/** The project's memories are open over a usable project, in place of the list and any detail (both come back as they were). */
export const showingMemories = (state: State): boolean => state.page === 'memories' && state.directory !== null && state.workspace?.kind === 'ok' && !needsUpdate(state);

/** What the panel shows below the header, in order of precedence. */
function Body() {
  const state = useStore();
  if (state.directory === null) return <NoProject />;
  if (state.workspace && state.workspace.kind !== 'ok') return <WorkspaceEmpty workspace={state.workspace} />;
  // Made with an older Beads: the update takes the list's place, ahead of the generic "couldn't load".
  if (needsUpdate(state)) return <ProjectUpdate key={state.directory} />;
  if (firstLoadError(state)) return <LoadError />;
  if (!state.snapshot) return <Loading />;
  // Keyed on the project so the keyboard cursor and expanded sections start fresh in each one.
  if (state.view === 'activity') return <ActivityView key={state.directory} />;
  if (state.view === 'needs') return <NeedsView key={state.directory} />;
  return <List key={state.directory} />;
}

export function App() {
  const state = useStore();
  const detail = showingDetail(state);
  const memories = showingMemories(state);
  // What a sheet or confirmation covers cannot be reached; the leave confirmation sits inside the detail, so only a sheet makes the detail inert.
  const covered = state.overlays.length > 0;
  const sheet = state.overlays.some((name) => name !== 'leave');
  const body = useRef<HTMLElement>(null);
  /** The list's scroll position, kept while a detail covers it. */
  const scrolled = useRef(0);
  const wasDetail = useRef(detail);
  // Opening a detail: take the list's place now, while the DOM still shows it. Scroll events arrive a frame late, so a
  // click right after scrolling (or during a fling) would otherwise save a stale position.
  if (detail && !wasDetail.current && body.current) scrolled.current = body.current.scrollTop;

  // Back from a detail: the list comes back where it was, with focus on the selected row's list.
  useLayoutEffect(() => {
    const leaving = wasDetail.current && !detail;
    wasDetail.current = detail;
    if (!leaving || !body.current) return;
    body.current.scrollTop = scrolled.current;
    const active = document.activeElement;
    if (active && active !== document.body && body.current.contains(active)) return;
    const row = state.selectedId ? document.getElementById(rowDomId(state.selectedId)) : null;
    row?.closest<HTMLElement>('[role="listbox"]')?.focus({ preventScroll: true });
  }, [detail]);

  // Back from the memories: focus goes to the project menu that opened them, unless the person already moved it.
  const wasMemories = useRef(memories);
  useLayoutEffect(() => {
    const leaving = wasMemories.current && !memories;
    wasMemories.current = memories;
    const active = document.activeElement;
    if (!leaving || (active && active !== document.body)) return;
    document.querySelector<HTMLElement>('.bd-projbtn')?.focus({ preventScroll: true });
  }, [memories]);

  return (
    <div class="bd">
      <Header />
      {/* Keyed on the project so its folded beads start fresh in each one. */}
      <SyncCard key={state.directory ?? ''} />
      {/* The list stays mounted under a detail, so its cursor, open sections and place are kept for Back. */}
      <main class="bd-body" ref={body} hidden={detail || memories} inert={covered} onScroll={(e) => {
          // Hiding the list under a detail can report a scroll to 0; only the visible list's position counts.
          if (!detail) scrolled.current = e.currentTarget.scrollTop;
        }}>
        <Body />
      </main>
      {/* Keyed on the project so nothing typed on one project's memories shows on another's. */}
      {memories && <MemoriesPage key={state.directory} />}
      {detail && !memories && <Detail inert={sheet} footer={<AttachFooter id={state.detail!.stack[state.detail!.stack.length - 1]!.id} />} />}
      {listing(state) && !detail && !memories && <Footer />}
      {state.create && state.snapshot && !needsUpdate(state) && <CreateForm />}
      <WorktreeSheet />
      {!needsUpdate(state) && <PublishSheet />}
    </div>
  );
}

/** The host surface the panel uses. */
export type PanelHost = Pick<
  HostClient,
  'serviceRequest' | 'storage' | 'toast' | 'onDirectory' | 'setBadge' | 'writeClipboard' | 'openUrl' | 'attach' | 'compose' | 'startSession' | 'onSession'
>;

let styled = false;

/** Adds the panel's styles to the page, once. */
export function addStyles() {
  if (styled) return;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  styled = true;
}

export type MountedPanel = { store: Store; dispose(): void };

/**
 * Mounts the panel into `root`, following the host's directory and open chat. Clicked chips are not handled here: with
 * `attach: dialog` OpenChamber opens the attach dialog for them, which shows the bead.
 */
export function mountPanel(host: PanelHost, root: Element, deps: Partial<StoreDeps> = {}): MountedPanel {
  addStyles();
  const client = deps.client ?? createClient(host);
  const store = createStore({ client, host, ...deps });
  const agent = createAgent({ client, host, store });
  const sync = createSync({ client, host, store });
  const stopDirectory = host.onDirectory((directory) => store.setDirectory(directory));
  const stopSession = host.onSession((session) => agent.setSession(session));
  render(
    <StoreContext.Provider value={store}>
      <AgentContext.Provider value={agent}>
        <SyncContext.Provider value={sync}>
          <App />
        </SyncContext.Provider>
      </AgentContext.Provider>
    </StoreContext.Provider>,
    root,
  );
  return {
    store,
    dispose() {
      stopSession();
      stopDirectory();
      store.dispose();
      render(null, root);
    },
  };
}
