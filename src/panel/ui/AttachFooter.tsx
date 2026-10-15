import type { ComponentChildren } from 'preact';
import { useAgent, useAgentState } from '../agent';
import { useStoreApi } from '../store';
import { IconBranch, IconChat, IconSession, IconSpinner } from './icons';
import type { RowActions } from './Row';

/** The same actions for a list row, an activity entry, and the detail. */
export function useRowActions(): RowActions {
  const store = useStoreApi();
  const agent = useAgent();
  const { session, busy } = useAgentState();
  return {
    addToChat: (id) => void agent?.attach(id),
    startSession: (id) => void agent?.startSession(id),
    startInWorktree: (id) => store.confirmLeave(() => agent?.askWorktree(id)),
    copyId: (id) => store.copyText(id),
    noChat: session === null,
    busy: busy !== null,
  };
}

const RUNNING = { attach: 'Adding…', session: 'Starting…', worktree: 'Starting…' } as const;

/**
 * "Attach to" under a bead's detail: Current chat, New session, or In worktree… (a new session in its own worktree). Nothing is
 * ever sent; the person writes their message.
 */
export function AttachFooter({ id }: { id: string }) {
  const agent = useAgent();
  const store = useStoreApi();
  const { session, busy } = useAgentState();
  if (!agent) return null;
  const mine = busy?.id === id ? busy.kind : null;
  const slow = mine === 'session' || mine === 'worktree';
  const button = (kind: 'attach' | 'session' | 'worktree', label: string, icon: ComponentChildren, run: () => void, off = false) => (
    <button
      type="button"
      class="bd-attach-btn"
      data-attach={kind}
      data-running={mine === kind || undefined}
      disabled={busy !== null || off}
      onClick={run}
    >
      {mine === kind ? <IconSpinner size={13} /> : icon}
      <span>{mine === kind ? RUNNING[kind] : label}</span>
    </button>
  );
  return (
    <footer class="bd-attach" role="group" aria-label="Attach to" aria-busy={mine !== null}>
      <div class="bd-attach-top">
        <span class="bd-attach-lab">Attach to</span>
        {slow ? (
          <span class="bd-attach-note" role="status">
            Starting a session. This can take up to 3 minutes.
          </span>
        ) : session ? (
          <span class="bd-attach-note" title={session.title}>
            <span class="bd-attach-dot" aria-hidden="true" />
            {session.title || 'Open chat'}
          </span>
        ) : (
          <span class="bd-attach-note" data-tone="muted">
            No open chat. Start a new session instead.
          </span>
        )}
      </div>
      <div class="bd-attach-acts" data-nochat={session === null || undefined}>
        {button('attach', 'Current chat', <IconChat size={13} />, () => void agent.attach(id), session === null)}
        {button('session', 'New session', <IconSession size={13} />, () => void agent.startSession(id))}
        {/* The worktree's chat closes this panel, so a draft on screen is asked about first. */}
        {button('worktree', 'In worktree…', <IconBranch size={13} />, () => store.confirmLeave(() => agent.askWorktree(id)))}
      </div>
    </footer>
  );
}
