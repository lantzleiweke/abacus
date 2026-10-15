import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { PLAN_APPROVAL_REASON, REVIEW_REASON } from '../../shared/gates';
import type { Bead, Gate } from '../../shared/types';
import { ago } from '../format';
import { gateLabel, gatesOn, gateState } from '../gates';
import { composing, isEnterInInput } from '../keyboard';
import { shortId } from '../list';
import { useStore, useStoreApi, type WriteOutcome } from '../store';
import { IconMore, IconWait } from './icons';
import { Popover, usePopover } from './popover';
import { feedbackOf, WriteMessage, type Feedback } from './writes';

/** What a person can ask for on a bead: a review before it closes, or approval of its plan before work starts. */
export type AskKind = 'review' | 'plan';

const DEFAULT_REASON: Record<AskKind, string> = { review: REVIEW_REASON, plan: PLAN_APPROVAL_REASON };
/** Beads takes a reason of at most 500 characters on one line. */
const MAX_REASON = 500;

/**
 * The reason sent for a request. A plan approval keeps the known start, so Abacus and agents both read it as one; an empty field
 * sends the default.
 */
export function askReason(kind: AskKind, text: string): string {
  const typed = text.replace(/\s+/g, ' ').trim();
  if (!typed) return DEFAULT_REASON[kind];
  if (kind === 'review' || typed.startsWith(PLAN_APPROVAL_REASON)) return typed.slice(0, MAX_REASON);
  return `${PLAN_APPROVAL_REASON}: ${typed}`.slice(0, MAX_REASON);
}

export const gateDomId = (id: string) => `bd-gate-${id.replace(/[^\w.-]/g, '_')}`;

/** The open step: asking with a reason, or resolving one gate with a reason. Kept per bead. */
type Step = { mode: 'ask'; kind: AskKind; text: string } | { mode: 'resolve'; gateId: string; text: string };

type Settled = { text: string; tone: 'done' | 'note' };

/** Everything the bead's gate controls share: what is shown, what is in flight, what each write said. */
export type GateKit = {
  /** The open gates on the bead, plus one just made that the list has not caught up with. */
  gates: Gate[];
  /** An ask on this bead is on its way (asks on another bead do not hold this one). */
  asking: boolean;
  /** A resolve of this gate is on its way. */
  resolving(gateId: string): boolean;
  /** One click: asks with the default reason, or `reason` from the step. */
  ask(kind: AskKind, reason?: string): void;
  resolve(gate: Gate, reason: string): void;
  step: Step | null;
  openStep(step: Step): void;
  /** Closes the step; `focus` is the id of what takes focus once it is gone. */
  closeStep(focus?: string): void;
  /** Feedback by key (`ask`, or a gate id). */
  feedback: Record<string, Feedback>;
  settled: Record<string, Settled>;
  /** The gate an ask found already open, shown marked. */
  found: string | null;
  supported: boolean;
};

const askKey = (beadId: string) => `ask:${beadId}`;
const gateKey = (id: string) => `gate:${id}`;
/** Ids of the controls focus goes back to when a write is refused (they were disabled while it ran, so focus fell off them). */
const ASK_FIELD = 'bd-ask-field';
const goId = (gateId: string) => `${gateDomId(gateId)}-go`;
const fieldId = (gateId: string) => `${gateDomId(gateId)}-field`;

/**
 * The gate controls of the shown bead. Writes are guarded per action (a second click while one runs does nothing) and per gate
 * (one gate is resolved once). Everything is dropped when another bead is shown.
 */
export function useGates(bead: Bead | null): GateKit {
  const state = useStore();
  const store = useStoreApi();
  const id = bead?.id ?? null;
  /** The bead on screen now: an answer for another bead changes nothing here. */
  const current = useRef(id);
  current.current = id;
  /** Every gate the list has carried. A made gate the list has had and lost was resolved elsewhere, so it never shows again. */
  const seen = useRef(new Set<string>());
  for (const g of state.gates) seen.current.add(g.id);
  const inflight = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [step, setStep] = useState<Step | null>(null);
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [settled, setSettled] = useState<Record<string, Settled>>({});
  /** Gates made here (or found already open) that the snapshot does not list yet. */
  const [made, setMade] = useState<Gate[]>([]);
  const [found, setFound] = useState<string | null>(null);
  /** After a resolve: the gate that held focus and the one after it, so focus follows when the gate leaves. */
  const follow = useRef<{ id: string; next: string | null } | null>(null);
  /** Where focus goes after the next render. */
  const refocus = useRef<string | null>(null);

  useEffect(() => {
    setStep(null);
    setFeedback({});
    setSettled({});
    setMade([]);
    setFound(null);
    follow.current = null;
  }, [id]);

  const listed = bead ? gatesOn(bead, state.gates) : [];
  // A made gate shows, on its own bead only, until the list carries it; from then on the list decides.
  const gates = [...listed, ...made.filter((g) => id !== null && g.blocks.includes(id) && !seen.current.has(g.id) && !settled[g.id])];

  useLayoutEffect(() => {
    const target = refocus.current;
    if (target) {
      refocus.current = null;
      document.getElementById(target)?.focus({ preventScroll: true });
    }
    const f = follow.current;
    if (!f || document.getElementById(gateDomId(f.id))) return;
    follow.current = null;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const next = (f.next && document.getElementById(gateDomId(f.next))) || document.querySelector<HTMLElement>('.bd-detail');
    next?.focus({ preventScroll: true });
  });

  /**
   * One write for bead `at`: busy while it runs, its answer used only if `at` is still the bead on screen. A refusal is shown under
   * the control, and focus, which fell off the disabled control, goes back to `back()`.
   */
  async function run<T>(at: string, key: string, feedbackKey: string, send: () => Promise<WriteOutcome<T>>, done: (value: T) => void, back: () => string) {
    if (inflight.current.has(key)) return;
    inflight.current.add(key);
    setBusy(new Set(inflight.current));
    setFeedback((f) => ({ ...f, [feedbackKey]: null }));
    const outcome = await send();
    inflight.current.delete(key);
    setBusy(new Set(inflight.current));
    if (outcome.kind === 'dropped' || current.current !== at) return;
    if (outcome.kind === 'ok') {
      done(outcome.value);
      return;
    }
    setFeedback((f) => ({ ...f, [feedbackKey]: feedbackOf(outcome) }));
    const active = document.activeElement;
    if (!active || active === document.body) refocus.current = back();
  }

  const ask = (kind: AskKind, reason?: string) => {
    if (!bead) return;
    const at = bead.id;
    const why = askReason(kind, reason ?? '');
    const send = () => store.requestReview(at, why === REVIEW_REASON ? undefined : why);
    const back = () => (document.getElementById(ASK_FIELD) ? ASK_FIELD : MENU_ID);
    void run(at, askKey(at), 'ask', send, (result) => {
      setStep((s) => (s?.mode === 'ask' ? null : s));
      // A gate the list already carries (found already open) is the list's: keeping a copy would bring it back after it closes.
      if (!seen.current.has(result.gate.id)) setMade((list) => [...list.filter((g) => g.id !== result.gate.id), result.gate]);
      refocus.current = gateDomId(result.gate.id);
      if (result.ok) {
        setFound(null);
        store.notify(kind === 'plan' ? `Plan approval asked for on ${shortId(at)}.` : `Review asked for on ${shortId(at)}.`);
      } else {
        setFound(result.gate.id);
      }
    }, back);
  };

  const resolve = (gate: Gate, reason: string) => {
    if (!bead) return;
    const at = bead.id;
    const shown = gates.map((g) => g.id);
    const next = shown[shown.indexOf(gate.id) + 1] ?? shown[shown.indexOf(gate.id) - 1] ?? null;
    const back = () => (document.getElementById(fieldId(gate.id)) ? fieldId(gate.id) : goId(gate.id));
    void run(at, gateKey(gate.id), gate.id, () => store.resolveReview(gate.id, reason.trim() || undefined), (result) => {
      const li = document.getElementById(gateDomId(gate.id));
      const held = !!li && (li.contains(document.activeElement) || document.activeElement === document.body);
      setStep((s) => (s?.mode === 'resolve' && s.gateId === gate.id ? null : s));
      if (result.ok) {
        setSettled((s) => ({ ...s, [gate.id]: { text: gate.planApproval ? 'Approved. Updating.' : 'Resolved. Updating.', tone: 'done' } }));
        store.notify(gate.planApproval ? `Plan approved for ${shortId(at)}.` : `Review resolved for ${shortId(at)}.`);
      } else {
        const when = result.at === null ? NaN : Date.parse(result.at);
        const what = gate.planApproval ? 'This plan was already approved' : 'This review was already resolved';
        const who = result.resolvedBy ? ` by ${result.resolvedBy}` : '';
        setSettled((s) => ({ ...s, [gate.id]: { text: `${what}${who}${Number.isFinite(when) ? ` ${ago(Date.now() - when)}` : ''}. Updating.`, tone: 'note' } }));
      }
      if (held) {
        refocus.current = gateDomId(gate.id);
        follow.current = { id: gate.id, next };
      }
    }, back);
  };

  return {
    gates,
    asking: id !== null && busy.has(askKey(id)),
    resolving: (gateId) => busy.has(gateKey(gateId)),
    ask,
    resolve,
    step,
    openStep: (s) => setStep(s),
    closeStep: (focus) => {
      if (focus) refocus.current = focus;
      setStep(null);
    },
    feedback,
    settled,
    found,
    supported: !state.unsupported.has('gates'),
  };
}

// ------------------------------------------------------------------------------------------------- bead menu

const MENU_ID = 'bd-bead-menu';

export const BEAD_MENU_ID = MENU_ID;

/**
 * The bead's own actions, under ⋯ at the top right: asks for a review or plan approval, and (`replace`, when the installed Beads
 * can) closing it as superseded by or a duplicate of another bead.
 */
export function BeadMenu({ kit, disabled, done, replace }: { kit: GateKit; disabled: string | null; done: boolean; replace?: (kind: 'supersede' | 'duplicate') => void }) {
  const pop = usePopover(disabled !== null);
  if ((!kit.supported && !replace) || done) return null;
  const off = kit.asking;
  const pick = (go: () => void) => () => {
    pop.close();
    go();
  };
  return (
    <span class="bd-popwrap">
      <button type="button" id={MENU_ID} class="bd-iconbtn" aria-label="Bead actions" aria-haspopup="menu" aria-expanded={pop.open} title={disabled ?? 'Bead actions'} disabled={disabled !== null} onClick={pop.toggle}>
        <IconMore />
      </button>
      {pop.open && (
        <Popover label="Bead actions" align="end" role="menu" onClose={pop.close}>
          {kit.supported && (
            <>
              <button type="button" role="menuitem" class="bd-menu-item" disabled={off} onClick={pick(() => kit.ask('review'))}>
                <span>Ask for a review</span>
              </button>
              <button type="button" role="menuitem" class="bd-menu-item" disabled={off} onClick={pick(() => kit.ask('plan'))}>
                <span>Ask for plan approval</span>
              </button>
              <div class="bd-menu-rule" role="separator" />
              <button type="button" role="menuitem" class="bd-menu-item" onClick={pick(() => kit.openStep({ mode: 'ask', kind: 'review', text: REVIEW_REASON }))}>
                <span>Ask with a reason…</span>
              </button>
            </>
          )}
          {replace && (
            <>
              {kit.supported && <div class="bd-menu-rule" role="separator" />}
              <button type="button" role="menuitem" class="bd-menu-item" onClick={pick(() => replace('supersede'))}>
                <span>Superseded by…</span>
              </button>
              <button type="button" role="menuitem" class="bd-menu-item" onClick={pick(() => replace('duplicate'))}>
                <span>Duplicate of…</span>
              </button>
            </>
          )}
        </Popover>
      )}
    </span>
  );
}

/** Beside the Design section, where the plan lives: one click asks for its approval. Hidden while one is open. */
export function PlanAsk({ kit, disabled }: { kit: GateKit; disabled: string | null }) {
  if (!kit.supported || kit.gates.some((g) => g.planApproval)) return null;
  const busy = kit.asking;
  return (
    <button
      type="button"
      class="bd-edit bd-planask"
      title={disabled ?? 'Ask for approval of this plan before work starts'}
      disabled={disabled !== null || busy}
      aria-busy={busy || undefined}
      onClick={() => kit.ask('plan')}
    >
      Ask for plan approval
    </button>
  );
}

// ------------------------------------------------------------------------------------------------- waiting on

/** Escape in a step's field closes the step, and stops there (the detail's Escape is Back). */
const escapeCloses = (cancel: () => void) => (e: KeyboardEvent) => {
  if (e.key !== 'Escape' || composing(e)) return;
  e.preventDefault();
  e.stopPropagation();
  cancel();
};

/** Focus on the step's field when it opens, with its text selected so typing replaces the default. */
function useFirstFocus() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.select();
  }, []);
  return ref;
}

type ReasonStepProps = {
  /** The field's id, so focus can come back to it after a refusal. */
  id: string;
  label: string;
  text: string;
  set(text: string): void;
  send(): void;
  cancel(): void;
  action: string;
  hint: string;
  busy: boolean;
  paused: string | null;
  message?: ComponentChildren;
  children?: ComponentChildren;
};

/** A one-line reason, a line saying what happens, the action and Cancel. Enter sends, Escape cancels. Never a form. */
function ReasonStep({ id, label, text, set, send, cancel, action, hint, busy, paused, message, children }: ReasonStepProps) {
  const field = useFirstFocus();
  const go = () => {
    if (!busy && paused === null) send();
  };
  return (
    <div class="bd-nstep bd-gstep" role="group" aria-label={label}>
      {children}
      <input
        ref={field}
        id={id}
        type="text"
        class="bd-input"
        aria-label={label}
        placeholder="Reason (optional)"
        maxLength={MAX_REASON}
        value={text}
        disabled={busy}
        onInput={(e) => set(e.currentTarget.value)}
        onKeyDown={(e) => {
          escapeCloses(() => !busy && cancel())(e);
          if (isEnterInInput(e)) {
            e.preventDefault();
            go();
          }
        }}
      />
      <p class="bd-nstep-hint">{hint}</p>
      <div class="bd-nstep-acts">
        <button type="button" class="bd-btn bd-btn-sm bd-btn-primary" disabled={busy || paused !== null} aria-busy={busy || undefined} title={paused ?? undefined} onClick={go}>
          {action}
        </button>
        <button type="button" class="bd-btn bd-btn-sm" disabled={busy} onClick={cancel}>
          Cancel
        </button>
      </div>
      {message}
    </div>
  );
}

const ASK_HINT: Record<AskKind, string> = {
  review: 'The bead cannot close until someone resolves the review. Agents see it too.',
  plan: 'Work waits until someone approves the plan in Design. Agents see it too.',
};

/** Asking with a reason: which kind, then the reason, prefilled with the default. */
function AskStep({ kit, step, paused }: { kit: GateKit; step: Extract<Step, { mode: 'ask' }>; paused: string | null }) {
  const busy = kit.asking;
  const choose = (kind: AskKind) => {
    // A reason still at the other kind's default follows the choice; a typed one stays.
    const text = step.text === DEFAULT_REASON[step.kind] || !step.text.trim() ? DEFAULT_REASON[kind] : step.text;
    kit.openStep({ ...step, kind, text });
  };
  const fb = kit.feedback.ask ?? null;
  return (
    <ReasonStep
      id={ASK_FIELD}
      label={step.kind === 'plan' ? 'Reason for the plan approval' : 'Reason for the review'}
      text={step.text}
      set={(text) => kit.openStep({ ...step, text })}
      send={() => kit.ask(step.kind, step.text)}
      cancel={() => kit.closeStep(MENU_ID)}
      action={step.kind === 'plan' ? 'Ask for plan approval' : 'Ask for a review'}
      hint={ASK_HINT[step.kind]}
      busy={busy}
      paused={paused}
      message={fb && <WriteMessage feedback={fb} />}
    >
      <div class="bd-gkind" role="group" aria-label="Ask for">
        {(['review', 'plan'] as const).map((kind) => (
          <button key={kind} type="button" class="bd-gkind-opt" aria-pressed={step.kind === kind} disabled={busy} onClick={() => choose(kind)}>
            {kind === 'plan' ? 'Plan approval' : 'Review'}
          </button>
        ))}
      </div>
    </ReasonStep>
  );
}

/** What resolving this gate does. With others still open, it only clears this one: the hint must not promise more. */
function resolveHint(gate: Gate, others: boolean): string {
  if (others) return gate.planApproval ? 'Approving clears this plan approval. The bead still waits on the rest.' : 'Resolving clears this review. The bead still waits on the rest.';
  return gate.planApproval ? 'Approving lets work on the plan start.' : 'Resolving lets the bead close.';
}

const kindOf = (gate: Gate): string => (gate.kind === 'human' ? (gate.planApproval ? 'plan' : 'review') : gate.kind === 'gh:run' || gate.kind === 'gh:pr' ? 'github' : gate.kind === 'timer' || gate.kind === 'bead' ? gate.kind : 'other');

const firstLine = (text: string): string => text.trim().split('\n')[0]!.trim();

type WaitingOnProps = { kit: GateKit; now: number; panel: string | null; paused: string | null };

/**
 * What holds the bead: each open gate with its kind, reason, who opened it and when. Reviews and plan approvals are resolved here
 * (one click, or with a reason); timers and GitHub checks only say where they stand. Shown only while there is something to say.
 */
export function WaitingOn({ kit, now, panel, paused }: WaitingOnProps) {
  const step = kit.step;
  const askFeedback = step?.mode === 'ask' ? null : (kit.feedback.ask ?? null);
  if (kit.gates.length === 0 && step?.mode !== 'ask' && !askFeedback) return null;
  return (
    <div class="bd-gates-wrap">
      {step?.mode === 'ask' && <AskStep kit={kit} step={step} paused={paused} />}
      {askFeedback && (
        <div class="bd-gnote">
          <WriteMessage feedback={askFeedback} />
        </div>
      )}
      {kit.gates.length > 0 && (
        <section class="bd-gates" aria-labelledby="bd-gates-h">
          <h3 class="bd-gates-h" id="bd-gates-h">
            <IconWait size={12} />
            <span>Waiting on</span>
            {kit.gates.length > 1 && <span class="bd-n">{kit.gates.length}</span>}
          </h3>
          {/* role="list": Safari drops a styled list's semantics without it. */}
          <ul class="bd-glist" role="list">
            {kit.gates.map((gate) => (
              <GateItem key={gate.id} kit={kit} gate={gate} now={now} panel={panel} paused={paused} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function GateItem({ kit, gate, now, panel, paused }: { kit: GateKit; gate: Gate; now: number; panel: string | null; paused: string | null }) {
  const id = gateDomId(gate.id);
  const human = gate.kind === 'human';
  const busy = kit.resolving(gate.id);
  const settled = kit.settled[gate.id] ?? null;
  const step = kit.step?.mode === 'resolve' && kit.step.gateId === gate.id ? kit.step : null;
  const fb = kit.feedback[gate.id] ?? null;
  const off = paused !== null || busy;
  const reason = gate.reason ? firstLine(gate.reason) : null;
  const closeStep = () => kit.closeStep(`${id}-why`);
  return (
    <li id={id} class="bd-gate" data-kind={kindOf(gate)} data-found={kit.found === gate.id || undefined} tabIndex={-1} aria-labelledby={`${id}-k ${id}-r`} aria-describedby={`${id}-m`}>
      <div class="bd-gate-top">
        <span class="bd-tag" id={`${id}-k`} data-kind={kindOf(gate)}>
          {gateLabel(gate)}
        </span>
        <span class="bd-gate-reason" id={`${id}-r`} title={gate.reason ?? undefined} data-none={reason ? undefined : true}>
          {reason ?? 'No reason given'}
        </span>
      </div>
      <p class="bd-gate-meta" id={`${id}-m`}>
        {gateState(gate, now, panel)}
      </p>
      {kit.found === gate.id && !settled && (
        <p class="bd-why" data-tone="hold" role="status">
          {gate.planApproval ? 'This bead already waits on a plan approval.' : 'This bead already waits on a review.'}
        </p>
      )}
      {settled ? (
        <p class="bd-why bd-gate-settled" data-tone={settled.tone} role="status">
          {settled.text}
        </p>
      ) : step ? (
        <ReasonStep
          id={fieldId(gate.id)}
          label={gate.planApproval ? 'Reason for approving' : 'Reason for resolving'}
          text={step.text}
          set={(text) => kit.openStep({ ...step, text })}
          send={() => kit.resolve(gate, step.text)}
          cancel={closeStep}
          action={gate.planApproval ? 'Approve plan' : 'Resolve review'}
          hint={resolveHint(gate, kit.gates.length > 1)}
          busy={busy}
          paused={paused}
          message={fb && <WriteMessage feedback={fb} />}
        />
      ) : (
        human &&
        kit.supported && (
          <div class="bd-gate-acts">
            <div class="bd-nacts-row">
              <button type="button" id={goId(gate.id)} class="bd-btn bd-btn-sm bd-btn-primary" disabled={off} aria-busy={busy || undefined} title={paused ?? undefined} onClick={() => kit.resolve(gate, '')}>
                {gate.planApproval ? 'Approve' : 'Resolve'}
              </button>
              <button type="button" id={`${id}-why`} class="bd-link bd-nreason" disabled={off} title={paused ?? undefined} onClick={() => kit.openStep({ mode: 'resolve', gateId: gate.id, text: '' })}>
                Add a reason
              </button>
            </div>
            {fb && <WriteMessage feedback={fb} />}
          </div>
        )
      )}
    </li>
  );
}
