import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { AttachIssueRequest, HostClient, SessionSnapshot, StartSessionRequest, StartSessionResult } from '@openchamber/sdk';
import type { ContextResponse } from '../shared/api';
import { asRequestError, COPY_MAX, TOAST_MAX, type BeadsClient } from './client';
import { folderName } from './format';
import { shortId } from './list';
import { attachPayload, PROVIDER_ID, worktreeName } from './resolve';
import type { Store } from './store';

/** What is running: adding a bead (or the sync problem, id `SYNC_ITEM`) to the chat, or starting a session (in a new worktree or not). */
export type AgentBusy = { id: string; kind: 'attach' | 'session' | 'worktree' };

/** The busy id while the sync problem's details are being handed to the agent. */
export const SYNC_ITEM = ':sync';

/** The busy id while a request is being put on a chat's message box (`ask`). */
export const ASK_ITEM = ':ask';

/**
 * A request for the agent, put on the chat's message box as plain text the person reads and sends. `topic` is what a
 * new chat started for it is linked to (with no chat open): an id, a title and a page about it.
 */
export type AgentRequest = { text: string; topic: { id: string; title: string; url: string } };

/** The "New session in a worktree" confirmation, for bead `id`. */
export type WorktreeSheet = { id: string; title: string; name: string };

export type AgentState = {
  /** The chat open in OpenChamber, or null when there is none (Current chat is then off). */
  session: SessionSnapshot | null;
  busy: AgentBusy | null;
  sheet: WorktreeSheet | null;
};

export type AgentHost = Pick<HostClient, 'attach' | 'compose' | 'startSession' | 'toast'>;

export type Agent = {
  get(): AgentState;
  subscribe(listener: () => void): () => void;
  setSession(session: SessionSnapshot | null): void;
  /** Puts the bead on the open chat's composer as a chip. Nothing is sent. */
  attach(id: string): Promise<void>;
  /** Starts a new session linked to the bead, opens it, and puts the chip on its composer. */
  startSession(id: string): Promise<void>;
  /** Opens the worktree confirmation for the bead. */
  askWorktree(id: string): void;
  cancelWorktree(): void;
  /** Starts the session in a new worktree named `name`, from `baseBranch` or the project's default. */
  startInWorktree(name: string, baseBranch?: string): Promise<void>;
  /** Puts the sync problem's details (both sides, what failed, the project's sync rules) on the open chat's composer. */
  attachSync(): Promise<void>;
  /** Starts a new session with the sync problem's details on its composer. */
  startSyncSession(): Promise<void>;
  /**
   * Puts the request's text on the open chat's message box; with no chat open, starts one (opened, nothing sent) and
   * puts it there. Nothing is sent: the person reads it and sends it.
   */
  ask(request: AgentRequest): Promise<void>;
};

/** What OpenChamber 2.3.2 rejects `startSession` with after showing its own failure toast. */
const HOST_SAID_SO = 'Could not start that session.';

/** Why a start that answered a failure shape stopped. A worktree exists then: say so, and never start again by itself. */
function failedStart(result: Extract<StartSessionResult, { sessionId: null }>, wanted: boolean): string {
  const name = result.worktree.name || folderName(result.worktree.directory);
  if (!wanted) return "The session couldn't be started.";
  if (result.failure === 'bootstrap-failed') {
    return `The worktree ${name} was made, but its setup didn't finish, so no session started. Open the worktree from the sidebar instead of starting again.`;
  }
  return `The worktree ${name} was made, but the session couldn't be created. Open the worktree from the sidebar instead of starting again.`;
}

/** What a chip is read from, how to name it in a toast (`name` for an error, `noun` for what a session is linked to), and whether it is the sync problem. */
type ChipSource = { read(directory: string): Promise<ContextResponse>; name: string; noun: string; sync?: true };

export function createAgent({ client, host, store }: { client: Pick<BeadsClient, 'context' | 'conflictContext'>; host: AgentHost; store: Pick<Store, 'get' | 'subscribe'> }): Agent {
  let state: AgentState = { session: null, busy: null, sheet: null };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<AgentState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  // Another project: a worktree sheet for a bead of the last one no longer applies.
  let generation = store.get().generation;
  store.subscribe(() => {
    const next = store.get().generation;
    if (next === generation) return;
    generation = next;
    if (state.sheet) set({ sheet: null });
  });
  const toast = (kind: 'info' | 'success' | 'error', message: string, copy?: string) =>
    host.toast({ kind, message: message.slice(0, TOAST_MAX), ...(copy ? { copy: { text: copy.slice(0, COPY_MAX) } } : {}) }).catch(() => {});

  const beadSource = (id: string): ChipSource => ({ read: (directory) => client.context({ directory, id }), name: shortId(id), noun: 'the bead' });
  const syncSource: ChipSource = { read: (directory) => client.conflictContext({ directory }), name: 'the sync details', noun: 'the sync details', sync: true };

  /**
   * Reads the chip's context fresh, for the project shown now. Null (after saying why) when it could not be read, or
   * when the project changed meanwhile: it then belongs to another project than the one OpenChamber would use.
   */
  async function chip(source: ChipSource): Promise<AttachIssueRequest | null> {
    const { directory, generation } = store.get();
    if (directory === null) return null;
    try {
      const context = await source.read(directory);
      if (store.get().generation !== generation) return null;
      return attachPayload(context, directory, source.sync === true);
    } catch (thrown) {
      if (store.get().generation !== generation) return null;
      const error = asRequestError(thrown);
      toast('error', `Couldn't read ${source.name}. ${error.message}`, error.detail);
      return null;
    }
  }

  /** One action at a time: a second press while one runs does nothing. */
  async function run(busy: AgentBusy, work: () => Promise<void>) {
    if (state.busy) return;
    set({ busy });
    try {
      await work();
    } finally {
      set({ busy: null });
    }
  }

  /** Says why `startSession` refused, unless OpenChamber already did. */
  function startRefused(thrown: unknown, worktree: boolean) {
    const error = asRequestError(thrown);
    // OpenChamber shows its own "couldn't start" toast before refusing like this; a second one would only repeat it.
    if (error.code === 'HOST_REJECTED' && error.detail === HOST_SAID_SO) return;
    if (error.code === 'HOST_TIMEOUT') {
      const after = worktree ? 'A worktree may already exist: check the sidebar before trying again.' : 'It may still appear in the sidebar.';
      toast('error', `The session didn't start in time. ${after}`, error.detail);
      return;
    }
    const lead = `The session couldn't be started. ${error.message}`;
    toast('error', worktree ? `${lead} A worktree may already exist: check the sidebar before trying again.` : lead, error.detail);
  }

  async function start(id: string, source: ChipSource, kind: 'session' | 'worktree', worktree?: StartSessionRequest['worktree']) {
    await run({ id, kind }, async () => {
      const payload = await chip(source);
      if (!payload) return;
      // No text: the host would send it as the first message. The person writes that; the chip carries the context.
      const { text, ...linked } = payload;
      let result: StartSessionResult;
      try {
        result = await host.startSession({ ...linked, ...(worktree ? { worktree } : {}), navigation: 'open' });
      } catch (thrown) {
        startRefused(thrown, worktree !== undefined);
        return;
      }
      if (result.sessionId === null) {
        toast('error', failedStart(result, worktree !== undefined), result.worktree.directory);
        return;
      }
      if (result.linked === false) toast('info', `Session started, but the link to ${source.noun} wasn't saved.`);
      // OpenChamber 2.3.2 unmounts this panel's frame when a worktree's session becomes current (it belongs to another
      // directory), so nothing can follow a worktree start: no chip, no toast. The sheet says beforehand to type
      // `/bd <id>` in the new chat instead.
      if (worktree) return;
      await host.attach({ ...linked, ...(text ? { text } : {}) }).catch(() => toast('error', `The session started, but ${source.noun} couldn't be added to its chat.`));
    });
  }

  /** Puts the chip on the open chat's composer, and says so. */
  function attach(id: string, source: ChipSource, added: string) {
    return run({ id, kind: 'attach' }, async () => {
      const payload = await chip(source);
      if (!payload) return;
      try {
        await host.attach(payload);
        toast('success', `Added ${added} to the chat.`);
      } catch (thrown) {
        const error = asRequestError(thrown);
        toast('error', `Couldn't add ${added} to the chat. ${error.message}`, error.detail);
      }
    });
  }

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSession(session) {
      set({ session });
    },
    attach(id) {
      return attach(id, beadSource(id), shortId(id));
    },
    startSession(id) {
      return start(id, beadSource(id), 'session');
    },
    attachSync() {
      return attach(SYNC_ITEM, syncSource, 'the sync details');
    },
    startSyncSession() {
      return start(SYNC_ITEM, syncSource, 'session');
    },
    ask({ text, topic }) {
      const open = state.session !== null;
      return run({ id: ASK_ITEM, kind: open ? 'attach' : 'session' }, async () => {
        if (!open) {
          // Like the sync problem with no chat open: a new chat, opened. No text, which the host would send as its first message.
          let result: StartSessionResult;
          try {
            result = await host.startSession({ providerId: PROVIDER_ID, id: topic.id, title: topic.title, url: topic.url, navigation: 'open' });
          } catch (thrown) {
            startRefused(thrown, false);
            return;
          }
          if (result.sessionId === null) {
            toast('error', failedStart(result, false), result.worktree.directory);
            return;
          }
          // The chat is open now, whenever the host gets round to saying so: another press goes to it, not to a third chat.
          if (!state.session) set({ session: { id: result.sessionId, title: topic.title, busy: false } });
        }
        try {
          await host.compose({ text });
          toast('success', open ? 'The request is on the chat. Nothing is sent until you send it.' : 'The request is on a new chat. Nothing is sent until you send it.');
        } catch (thrown) {
          const error = asRequestError(thrown);
          // The request itself rides on Copy, so it can still be pasted into a chat by hand.
          toast('error', `Couldn't put the request on the chat. ${error.message}`, text);
        }
      });
    },
    askWorktree(id) {
      if (state.busy) return;
      const bead = store.get().snapshot?.beads.find((b) => b.id === id);
      const title = bead?.title ?? id;
      set({ sheet: { id, title, name: worktreeName(id, title) } });
    },
    cancelWorktree() {
      if (state.sheet && state.busy?.kind !== 'worktree') set({ sheet: null });
    },
    async startInWorktree(name, baseBranch) {
      const sheet = state.sheet;
      if (!sheet) return;
      const base = baseBranch?.trim();
      await start(sheet.id, beadSource(sheet.id), 'worktree', { kind: 'new', name, ...(base ? { baseBranch: base } : {}) });
      set({ sheet: null });
    },
  };
}

export const AgentContext = createContext<Agent | null>(null);

const IDLE: AgentState = { session: null, busy: null, sheet: null };

/** The agent actions, or null where the panel runs without a host that has them (tests of other parts). */
export const useAgent = (): Agent | null => useContext(AgentContext);

/** The agent state; re-renders on every change. */
export function useAgentState(): AgentState {
  const agent = useAgent();
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (!agent) return;
    const bump = () => setVersion((v) => v + 1);
    const stop = agent.subscribe(bump);
    bump();
    return stop;
  }, [agent]);
  return agent?.get() ?? IDLE;
}
