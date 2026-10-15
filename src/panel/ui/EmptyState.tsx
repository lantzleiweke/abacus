import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { WorkspaceState } from '../../shared/types';
import { firstLoadError, useStore, useStoreApi, type PanelError } from '../store';

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
 * Title, explanation and tone for a project the panel cannot show. Plain words: no command names. "Beads" is the
 * product, "beads" are the issues. `detail` is technical text for "Copy details" only.
 */
export function workspaceCopy(workspace: WorkspaceState): { title: string; body: string; tone: Tone; detail?: string } {
  switch (workspace.kind) {
    case 'no-bd':
      return { tone: 'missing', title: "Beads isn't installed on this computer.", body: 'Install Beads, then retry. The panel finds it on its own.' };
    case 'bd-too-old':
      return {
        tone: 'warning',
        title: 'This version of Beads is too old.',
        body: workspace.lastOpenedWith
          ? `This project was last opened with Beads ${workspace.lastOpenedWith}. This panel uses ${workspace.bdVersion}, which is older. Update Beads to open it here.`
          : `The panel needs Beads ${MIN_BD} or newer, and this computer has ${workspace.bdVersion}. Update Beads, then retry.`,
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
  const { title, body, tone, detail } = workspaceCopy(workspace);
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
