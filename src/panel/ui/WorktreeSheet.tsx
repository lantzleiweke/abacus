import { useEffect, useRef, useState } from 'preact/hooks';
import { useAgent, useAgentState } from '../agent';
import { useOverlay, useStoreApi } from '../store';
import { isEnterInInput, trapTab } from '../keyboard';
import { shortId } from '../list';
import { validBranchName } from '../resolve';
import { IconBranch, IconCopy, IconSpinner } from './icons';

/**
 * Confirms a new session in its own worktree: the branch and worktree name (editable) and the branch to start from
 * (the project's default when left empty). Escape or Cancel closes it, except while the session is starting.
 */
export function WorktreeSheet() {
  const agent = useAgent();
  const store = useStoreApi();
  const { sheet, busy } = useAgentState();
  const [name, setName] = useState('');
  const [base, setBase] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const starting = busy?.kind === 'worktree';
  useOverlay('worktree', sheet !== null);

  useEffect(() => {
    setName(sheet?.name ?? '');
    setBase('');
    setProblem(null);
    if (sheet) queueMicrotask(() => field.current?.select());
  }, [sheet?.id, sheet?.name]);

  if (!agent || !sheet) return null;

  const submit = () => {
    if (starting) return;
    const wanted = name.trim();
    if (!validBranchName(wanted)) {
      setProblem('Use letters, numbers, dots, dashes and slashes, with no spaces.');
      field.current?.focus();
      return;
    }
    void agent.startInWorktree(wanted, base);
  };

  return (
    <div class="bd-sheet">
      <div class="bd-scrim" aria-hidden="true" onClick={() => agent.cancelWorktree()} />
      {/* No form element here: the host frame is sandboxed without allow-forms, so a submit never fires. Click and Enter do the work. */}
      <div
        ref={dialog}
        class="bd-create bd-wt"
        role="dialog"
        aria-modal="true"
        aria-label="New session in a worktree"
        aria-busy={starting}
        onKeyDown={(e) => {
          trapTab(e, dialog.current);
          if (isEnterInInput(e)) {
            e.preventDefault();
            submit();
            return;
          }
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          agent.cancelWorktree();
        }}
      >
        <div class="bd-wt-head">
          <span class="bd-wt-ic" aria-hidden="true">
            <IconBranch size={15} />
          </span>
          <div class="bd-wt-headtext">
            <h2 class="bd-wt-title">New session in a worktree</h2>
            <p class="bd-wt-bead">
              <span class="bd-id">{shortId(sheet.id)}</span>
              <span class="bd-wt-beadtitle">{sheet.title}</span>
            </p>
          </div>
        </div>
        <label class="bd-cf">
          <span>Branch and worktree name</span>
          <input
            ref={field}
            class="bd-input bd-wt-mono"
            value={name}
            spellcheck={false}
            autoComplete="off"
            readOnly={starting}
            aria-invalid={problem !== null}
            aria-describedby={problem ? 'bd-wt-problem' : undefined}
            onInput={(e) => {
              setName(e.currentTarget.value);
              setProblem(null);
            }}
          />
        </label>
        {problem && (
          <p id="bd-wt-problem" class="bd-wt-err" role="alert">
            {problem}
          </p>
        )}
        <label class="bd-cf">
          <span>Start from</span>
          <input
            class="bd-input bd-wt-mono"
            value={base}
            placeholder="Project default branch"
            spellcheck={false}
            autoComplete="off"
            readOnly={starting}
            onInput={(e) => setBase(e.currentTarget.value)}
          />
        </label>
        <p class="bd-wt-note" role={starting ? 'status' : undefined}>
          {starting
            ? 'Making the worktree and starting the session. This can take up to 3 minutes.'
            : 'The worktree is a separate copy of the project, so your open files stay as they are. Nothing is sent.'}
        </p>
        <div class="bd-wt-tip">
          <p>
            {'The new chat is linked to the bead. To add the bead\u2019s details there, type '}
            <code>{`/bd ${sheet.id}`}</code>
            {' in it.'}
          </p>
          <button type="button" class="bd-btn bd-btn-sm" aria-label={`Copy /bd ${sheet.id}`} onClick={() => store.copyText(`/bd ${sheet.id}`)}>
            <IconCopy size={12} />
            Copy
          </button>
        </div>
        <div class="bd-edacts">
          <button type="button" class="bd-btn bd-btn-sm" disabled={starting} onClick={() => agent.cancelWorktree()}>
            Cancel
          </button>
          <button type="button" class="bd-btn bd-btn-sm bd-btn-primary" disabled={starting} onClick={submit}>
            {starting ? (
              <>
                <IconSpinner size={12} />
                Starting…
              </>
            ) : (
              'Start session'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
