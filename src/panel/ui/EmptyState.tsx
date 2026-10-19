import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { WorkspaceState } from '../../shared/types';
import { ASK_ITEM, useAgent, useAgentState, type AgentRequest } from '../agent';
import { firstLoadError, useStore, useStoreApi, type PanelError } from '../store';
import { IconChat, IconCopy } from './icons';

/** The middle bead of the illustration: how the state reads at a glance. */
export type Tone = 'neutral' | 'missing' | 'warning' | 'error' | 'ask';

/** Three beads on a thread; the middle one carries the tone. */
export function Thread({ tone }: { tone: Tone }) {
  return (
    <svg class="bd-thread" data-tone={tone} width="72" height="20" viewBox="0 0 72 20" aria-hidden="true" focusable="false">
      <path class="bd-thread-line" d="M2 10h68" />
      <circle class="bd-thread-bead" cx="16" cy="10" r="5" />
      <circle class="bd-thread-mid" cx="36" cy="10" r="6" />
      <circle class="bd-thread-bead" cx="56" cy="10" r="5" />
    </svg>
  );
}

export function EmptyState({ tone, title, body, children }: { tone: Tone; title: string; body?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <section class="bd-empty" data-tone={tone}>
      <Thread tone={tone} />
      <h2 class="bd-empty-title">{title}</h2>
      {body !== undefined && <p class="bd-empty-body">{body}</p>}
      {children !== undefined && <div class="bd-empty-actions">{children}</div>}
    </section>
  );
}

const MIN_BD = '1.2.2';

/**
 * The way forward when Beads is missing or too old. With the agent at hand (the panel) the Ask button leads; where it is
 * not (the attach dialog), the person does it, and learns the panel can ask for them.
 */
const fixIt = (verb: 'install' | 'update', canAsk: boolean) =>
  canAsk
    ? `Ask the agent to ${verb} it, or ${verb} it yourself, then press Retry.`
    : `${verb === 'install' ? 'Install' : 'Update'} it, then press Retry. The Abacus panel can ask the agent to ${verb} it for you.`;

/** Where Beads' own install steps live, for every system. */
export const INSTALL_GUIDE = 'https://github.com/gastownhall/beads#-installation';

/**
 * How the Beads-missing and Beads-too-old screens help: the label of the button that asks the agent, the request it
 * puts on the chat, and the command to copy. Command names live only in `request` and `command`, never on screen.
 */
export type InstallHelp = { ask: string; copy: string; command: string; request: AgentRequest };

export function installHelp(workspace: WorkspaceState): InstallHelp | null {
  const confirm = 'Then run `bd --version` to confirm it works.';
  if (workspace.kind === 'no-bd') {
    return {
      ask: 'Ask the agent to install Beads',
      copy: 'Copy install command',
      command: 'brew install beads',
      request: {
        text: `Please install Beads (the \`bd\` command) on this computer. On macOS use \`brew install beads\`; otherwise follow ${INSTALL_GUIDE}. ${confirm}`,
        topic: { id: 'install-beads', title: 'Install Beads', url: INSTALL_GUIDE },
      },
    };
  }
  if (workspace.kind === 'bd-too-old') {
    // A project a newer Beads opened needs that version; otherwise the panel's own floor applies.
    const needed = workspace.lastOpenedWith ?? MIN_BD;
    const who = workspace.lastOpenedWith ? 'This project needs' : 'The Beads panel needs';
    return {
      ask: 'Ask the agent to update Beads',
      copy: 'Copy update command',
      command: 'brew upgrade beads',
      request: {
        text: `Please update Beads (the \`bd\` command) on this computer. ${who} version ${needed} or newer, and this computer has ${workspace.bdVersion}. On macOS use \`brew upgrade beads\`; otherwise follow ${INSTALL_GUIDE}. ${confirm}`,
        topic: { id: 'update-beads', title: 'Update Beads', url: INSTALL_GUIDE },
      },
    };
  }
  return null;
}

/**
 * Title, explanation and tone for a project the panel cannot show. Plain words: no command names. "Beads" is the
 * product, "beads" are the issues. `detail` is technical text for "Copy details" only. `canAsk`: the agent can be asked
 * from here (false in the attach dialog).
 */
export function workspaceCopy(workspace: WorkspaceState, canAsk = true): { title: string; body: string; tone: Tone; detail?: string } {
  switch (workspace.kind) {
    case 'no-bd':
      return {
        tone: 'missing',
        title: "Beads isn't installed on this computer.",
        body: `Abacus needs Beads to read this project's issues. ${fixIt('install', canAsk)}`,
      };
    case 'bd-too-old':
      return {
        tone: 'warning',
        title: 'This version of Beads is too old.',
        body: workspace.lastOpenedWith
          ? `This project was last opened with Beads ${workspace.lastOpenedWith}. This panel uses ${workspace.bdVersion}, which is older. ${fixIt('update', canAsk)}`
          : `The panel needs Beads ${MIN_BD} or newer, and this computer has ${workspace.bdVersion}. ${fixIt('update', canAsk)}`,
      };
    case 'no-workspace':
      return { tone: 'neutral', title: "This project doesn't use Beads.", body: "Beads keeps a project's issues next to its code. Ask your agent to set it up here, then retry." };
    case 'pre-dolt':
      return {
        tone: 'warning',
        title: 'This project uses an older Beads format.',
        body: "The panel can't read this format. Ask your agent to upgrade the project's Beads data to the current format, then retry.",
      };
    case 'needs-first-contact':
      return {
        tone: 'ask',
        title: `Open this project with Beads ${workspace.bdVersion}?`,
        // Opening updates nothing: a project on an older format is shown the update, which asks again before it runs.
        body: `This project was last opened with Beads ${workspace.lastOpenedWith}. Opening it lets Beads check the project. If it is on an older format, Abacus will ask before updating it.`,
      };
    case 'server-down':
      return {
        tone: 'error',
        title: "This project's Beads server isn't running.",
        body: 'Start it the way you usually do, then retry. The panel never starts it for you.',
        detail: `The Beads database server for ${workspace.root} is expected on port ${workspace.port} and did not answer.`,
      };
    case 'ok':
      return { tone: 'neutral', title: 'This project is ready.', body: '' };
    default:
      // A state from a newer service than this panel knows.
      return { tone: 'neutral', title: "Beads can't open this project right now.", body: 'Retry in a moment. If this keeps happening, update the Beads extension.' };
  }
}

/** Retry that shows it is working for a moment, since a retry that finds nothing new changes nothing on screen. */
function RetryButton({ primary = false }: { primary?: boolean }) {
  const store = useStoreApi();
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!checking) return;
    const id = setTimeout(() => setChecking(false), 900);
    return () => clearTimeout(id);
  }, [checking]);
  return (
    <button
      type="button"
      class={primary ? 'bd-btn bd-btn-primary' : 'bd-btn'}
      aria-busy={checking}
      disabled={checking}
      onClick={() => {
        setChecking(true);
        store.retry();
      }}
    >
      {checking && <span class="bd-spin" aria-hidden="true" />}
      Retry
    </button>
  );
}

/** Runs one press at a time: a press while the last one is still running does nothing. */
function useOneAtATime(): [boolean, (work: () => Promise<void>) => void] {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = (work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    void work().finally(() => {
      running.current = false;
      setBusy(false);
    });
  };
  return [busy, run];
}

/** Beads is missing or too old: ask the agent to fix it, copy the command, open the guide, or retry. */
function InstallActions({ help }: { help: InstallHelp }) {
  const store = useStoreApi();
  const agent = useAgent();
  const { session, busy } = useAgentState();
  const asking = busy?.id === ASK_ITEM;
  const [copying, copy] = useOneAtATime();
  const [opening, open] = useOneAtATime();
  return (
    <>
      {agent && (
        <>
          <button type="button" class="bd-btn bd-btn-primary bd-empty-ask" disabled={busy !== null} aria-busy={asking} onClick={() => void agent.ask(help.request)}>
            {asking ? <span class="bd-spin" aria-hidden="true" /> : <IconChat size={13} />}
            {help.ask}
          </button>
          <p class="bd-empty-hint">{session ? 'Nothing is sent until you send it.' : 'Opens a new chat. Nothing is sent until you send it.'}</p>
        </>
      )}
      <button type="button" class="bd-btn" aria-disabled={copying} aria-busy={copying} onClick={() => copy(() => store.copyText(help.command))}>
        <IconCopy size={13} />
        {help.copy}
      </button>
      <RetryButton primary={!agent} />
      <p class="bd-empty-more">
        <button type="button" class="bd-link" aria-disabled={opening} aria-busy={opening} onClick={() => open(() => store.openUrl(INSTALL_GUIDE))}>
          Install guide
          <span aria-hidden="true"> ↗</span>
        </button>
      </p>
    </>
  );
}

/** "Copy details" for raw text; hidden when there is none, unless `always` (the message itself is then copied). */
function CopyDetails({ error, always = false }: { error: PanelError; always?: boolean }) {
  const store = useStoreApi();
  if (!error.detail && !always) return null;
  return (
    <button type="button" class="bd-link" onClick={() => store.copyDetails(error)}>
      Copy details
    </button>
  );
}

/** A project the panel cannot show yet, and the one thing that moves it forward. */
export function WorkspaceEmpty({ workspace }: { workspace: WorkspaceState }) {
  const state = useStore();
  const store = useStoreApi();
  // The attach dialog has no agent to ask: the copy then says what the person can do there.
  const canAsk = useAgent() !== null;
  const { title, body, tone, detail } = workspaceCopy(workspace, canAsk);
  const help = installHelp(workspace);
  if (help) {
    return (
      <EmptyState tone={tone} title={title} body={body}>
        <InstallActions help={help} />
      </EmptyState>
    );
  }
  if (workspace.kind !== 'needs-first-contact') {
    return (
      <EmptyState tone={tone} title={title} body={body}>
        <RetryButton primary />
        {detail && <CopyDetails error={{ code: 'workspace', message: title, detail }} />}
      </EmptyState>
    );
  }
  return (
    <EmptyState tone={tone} title={title} body={body}>
      <button type="button" class="bd-btn bd-btn-primary" disabled={state.confirming} aria-busy={state.confirming} onClick={() => void store.confirmFirstContact()}>
        {state.confirming && <span class="bd-spin" aria-hidden="true" />}
        Open project
      </button>
      <p class="bd-empty-note">You only need to confirm this once for this project.</p>
      {state.confirmError && (
        <p class="bd-empty-error" role="alert">
          {state.confirmError.message} <CopyDetails error={state.confirmError} />
        </p>
      )}
    </EmptyState>
  );
}

/** The first load failed: nothing to show yet, so one headline takes the panel; the service's words are behind Copy details. */
export function LoadError() {
  const error = firstLoadError(useStore());
  if (!error) return null;
  return (
    <EmptyState tone="error" title="Couldn't load this project's beads.">
      <RetryButton primary />
      <CopyDetails error={error} always />
    </EmptyState>
  );
}

export function NoProject() {
  return <EmptyState tone="neutral" title="Open a project to see its beads." />;
}

export function NoBeads() {
  return <EmptyState tone="neutral" title="No beads in this project yet." body="When your agent creates beads, they show up here within a few seconds." />;
}

/** Placeholder rows while the first answer is on its way. */
export function Loading() {
  const widths = [72, 54, 88, 61, 79, 46, 67];
  return (
    <div class="bd-skeleton" aria-busy="true" aria-label="Loading beads">
      {widths.map((w, i) => (
        <div key={i} class="bd-skel-row" style={{ '--w': `${w}%`, '--d': `${i * 70}ms` }}>
          <i class="bd-skel-dot" />
          <i class="bd-skel-id" />
          <i class="bd-skel-bar" />
        </div>
      ))}
    </div>
  );
}
