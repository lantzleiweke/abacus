import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Memory, MemoryWriteResult } from '../../shared/api';
import { writesPaused } from '../edit';
import { ago } from '../format';
import { composing, isConfirmKey, isEnterInInput, isSubmitKey, saveKey } from '../keyboard';
import { useNow, useStore, useStoreApi, type PanelError, type WriteOutcome } from '../store';
import { IconBack, IconPlus, IconSearch, IconX } from './icons';
import { feedbackOf, PausedNote, WriteMessage, type Feedback } from './writes';

// Project memories: what every agent session in the project starts with. Losing one is the failure this page is built
// against, so nothing is replaced or forgotten without the person seeing the text it applies to, a forget always takes a
// second, distinct button, and the last forget can be undone.

/** How long typing waits before the search is sent. */
const SEARCH_WAIT_MS = 250;

/** Newest change first; a memory with no known date after every dated one, in the order Beads gave. */
export function newestFirst(memories: Memory[]): Memory[] {
  return memories
    .map((m, i) => [m, i] as const)
    .sort(([a, i], [b, j]) => {
      if (a.changedAt === b.changedAt) return i - j;
      if (a.changedAt === null) return 1;
      if (b.changedAt === null) return -1;
      return Date.parse(b.changedAt) - Date.parse(a.changedAt) || i - j;
    })
    .map(([m]) => m);
}

/** "Changed 2h ago by Alice", "Changed 2h ago", or null when Beads could not say when. */
export function changedLine(memory: Memory, now: number): string | null {
  if (memory.changedAt === null) return null;
  const at = Date.parse(memory.changedAt);
  if (Number.isNaN(at)) return null;
  return `Changed ${ago(now - at)}${memory.changedBy ? ` by ${memory.changedBy}` : ''}`;
}

/**
 * The list as last read. `filtered`: read for a search, so a memory missing from it may still exist. `error`: a later read failed;
 * the list stays as it was, under the message. Only a first read that fails has nothing to show.
 */
type Loaded = { kind: 'loading' } | { kind: 'ok'; memories: Memory[]; filtered: boolean; error: PanelError | null } | { kind: 'error'; error: PanelError };

/**
 * A memory being changed. `base`: the text the edit is made against (as loaded, or as Beads had it when a save was refused or a
 * read showed it changed). `last`: the memory as last known, so the edit stays on screen when a read no longer lists it.
 * `refused`: Beads holds other text than the person saw (`gone`: none at all); nothing was written. `check`: a save that may
 * have gone in, settled by the next full read.
 */
type Editing = { mode: 'edit'; draft: string; base: string; last: Memory; refused?: 'changed' | 'gone'; feedback: Feedback; check?: boolean; asking?: boolean };
/**
 * The forget step, open. `text`: the text the person is shown, and the only text it forgets (sent as `expectedText`). `moved`:
 * Beads holds other text than the step was opened on (a read or a refused forget said so); the step now shows that and asks again.
 */
type Forgetting = { mode: 'forget'; text: string; moved?: boolean; feedback: Feedback; check?: boolean };
type ItemState = Editing | Forgetting;

/** `asking`: "Discard your changes?" shows. `vanished`: "Replace it with mine" met a memory removed meanwhile. */
type Composer = { text: string; name: string; taken: Memory | null; feedback: Feedback; check?: boolean; asking?: boolean; vanished?: string };

/** The note at the top after a forget, with its Undo while it can still be used. */
type Notice =
  | { kind: 'forgot'; memory: Memory; feedback: Feedback }
  | { kind: 'back'; key: string }
  | { kind: 'taken'; memory: Memory };

type Control = 'edit' | 'forget' | 'cancel' | 'field';
/** Where focus goes once the next render shows it. */
type Refocus = { key: string; control: Control } | 'add' | 'new' | 'heading';

// One prefix per part, so no memory's name can make one part's id equal another's (or a fixed id of the page).
const controlId = (control: Control | 'key' | 'ask', key: string) => `bd-mem${control}-${key}`;
const keyId = (key: string) => controlId('key', key);

/** Where the page keeps typed text in the store's drafts, so it outlives the page (Back, another project) until saved or discarded. */
const DRAFTS = '\u0000memories';
const editField = (key: string) => `edit:${key}`;
const ADD_FIELD = 'add';

/** Typed text that would be lost: an edit that differs from its base, or one Beads refused (the person still has to choose). */
const editDirty = (item: Editing) => item.refused !== undefined || item.draft !== item.base;
const composerDirty = (c: Composer | null) => c !== null && (c.text.trim() !== '' || c.name.trim() !== '');


export function MemoriesPage() {
  const store = useStoreApi();
  const state = useStore();
  const now = useNow(60_000);
  const paused = writesPaused(state.snapshot);

  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Record<string, ItemState>>({});
  const [busy, setBusy] = useState<readonly string[]>([]);
  const [composer, setComposer] = useState<Composer | null>(() => {
    const kept = store.draft(DRAFTS, ADD_FIELD);
    // A kept name rides in `base`.
    return kept ? { text: kept.text, name: kept.base ?? '', taken: null, feedback: null } : null;
  });
  /** "Discard your changes?" for leaving the page with typed text. */
  const [leaving, setLeaving] = useState(false);
  /** Kept edits come back with the first full read, which says what each memory is now. Until then the store's copies stay. */
  const restored = useRef(false);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [undoing, setUndoing] = useState(false);
  /** The memory written last, marked for a moment so the eye finds it. */
  const [fresh, setFresh] = useState<string | null>(null);

  const seq = useRef(0);
  const queryRef = useRef('');
  const refocus = useRef<Refocus | null>('heading');
  const heading = useRef<HTMLHeadingElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  /** The open steps as last rendered, for a read to compare against. */
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const patchItem = (key: string, next: ItemState | null) =>
    setItems((all) => {
      const copy = { ...all };
      if (next) copy[key] = next;
      else delete copy[key];
      return copy;
    });
  /** Memories with a write in flight, read at once (a read may land before the next render). */
  const busyNow = useRef(new Set<string>());
  const hold = (key: string, on: boolean) => {
    if (on) busyNow.current.add(key);
    else busyNow.current.delete(key);
    setBusy((keys) => (on ? [...keys, key] : keys.filter((k) => k !== key)));
  };

  /** Reads the memories again for the search as typed; an answer overtaken by a later read is dropped. */
  const load = async (): Promise<Memory[] | null> => {
    const mine = ++seq.current;
    const query = queryRef.current.trim() || undefined;
    const outcome = await store.readMemories(query);
    if (mine !== seq.current || outcome.kind === 'dropped') return null;
    if (outcome.kind === 'error') {
      // A failed read again keeps what is on screen, open edits included; only the first read has nothing to keep.
      setLoaded((l) => (l.kind === 'ok' ? { ...l, error: outcome.error } : { kind: 'error', error: outcome.error }));
      return null;
    }
    const memories = newestFirst(outcome.value.memories);
    const filtered = query !== undefined;
    setLoaded({ kind: 'ok', memories, filtered, error: null });
    if (!restored.current && !filtered) restoreEdits(memories);
    settle(memories, filtered);
    return memories;
  };

  /** Edits typed before the page was last left, opened again with their text; the read after decides if they are still current. */
  const restoreEdits = (memories: Memory[]) => {
    restored.current = true;
    const back: Record<string, ItemState> = {};
    for (const field of store.draftFields(DRAFTS)) {
      if (!field.startsWith('edit:')) continue;
      const key = field.slice('edit:'.length);
      const kept = store.draft(DRAFTS, field)!;
      const base = kept.original ?? kept.text;
      const last = memories.find((m) => m.key === key) ?? { key, text: base, changedAt: null, changedBy: null };
      back[key] = { mode: 'edit', draft: kept.text, base, last, feedback: null };
    }
    if (Object.keys(back).length > 0) setItems((all) => ({ ...back, ...all }));
  };

  /** Writes that may have gone in: what Beads lists now says whether they did. An open forget step whose text moved asks again. */
  const settle = (memories: Memory[], filtered: boolean) => {
    const byKey = new Map(memories.map((m) => [m.key, m]));
    for (const [key, item] of Object.entries(itemsRef.current)) {
      const now = byKey.get(key);
      if (item.mode === 'forget' && !busyNow.current.has(key) && !item.check && now && now.text !== item.text) refocus.current = { key, control: 'cancel' };
    }
    setItems((all) => {
      const copy = { ...all };
      for (const [key, item] of Object.entries(all)) {
        const now = byKey.get(key);
        // A write in flight answers for itself.
        if (busyNow.current.has(key)) continue;
        if (item.mode === 'forget') {
          // Never forget newer text than the step shows: it shows the new text, says so, and the person decides again.
          if (!item.check && now && now.text !== item.text) copy[key] = { ...item, text: now.text, moved: true, feedback: null };
          // Gone (a full read without it): there is nothing left to forget.
          else if (!item.check && !now && !filtered) delete copy[key];
          else if (item.check && !filtered) {
            if (!now) delete copy[key];
            else copy[key] = { ...item, check: false, feedback: { kind: 'checked', saved: false } };
          }
          continue;
        }
        // An edit whose memory a search leaves out stays as it is, on screen; only a full read can say it is gone.
        if (!now && filtered) continue;
        if (item.check) {
          if (filtered) continue;
          if (now?.text === item.draft.trim()) {
            delete copy[key];
            continue;
          }
          copy[key] = { ...item, check: false, feedback: { kind: 'checked', saved: false, kept: 'Your text is still here.' } };
        }
        const edit = copy[key] as Editing;
        // Removed elsewhere: the typed text stays, with the choice to add it again.
        if (!now) copy[key] = { ...edit, refused: 'gone' };
        // Changed elsewhere while it was open: its new text shows beside the typed one, and saving over it takes a button.
        else if (now.text !== edit.base) copy[key] = { ...edit, base: now.text, last: now, refused: 'changed' };
        else copy[key] = { ...edit, last: now };
      }
      return copy;
    });
    setComposer((c) => {
      if (!c?.check || filtered) return c;
      return memories.some((m) => m.text === c.text.trim()) ? null : { ...c, check: false, feedback: { kind: 'checked', saved: false, kept: 'Your text is still here.' } };
    });
  };

  useEffect(() => {
    void load();
  }, []);

  // The search goes to Beads a moment after typing stops.
  useEffect(() => {
    if (query === queryRef.current) return;
    const id = setTimeout(() => {
      queryRef.current = query;
      void load();
    }, SEARCH_WAIT_MS);
    return () => clearTimeout(id);
  }, [query]);

  // Focus moves only to something on screen, without scrolling the page.
  useLayoutEffect(() => {
    const want = refocus.current;
    if (!want) return;
    const el =
      want === 'heading' ? heading.current : want === 'add' ? addButton.current : want === 'new' ? document.getElementById('bd-mem-new') : document.getElementById(controlId(want.control, want.key));
    if (!el) return;
    refocus.current = null;
    el.focus({ preventScroll: true });
  });
  // A place that never came (the memory left with a read): dropped, so it cannot pull focus later when a memory by that name returns.
  useEffect(() => {
    const want = refocus.current;
    if (loaded.kind === 'ok' && want && typeof want === 'object' && !document.getElementById(controlId(want.control, want.key))) refocus.current = null;
  }, [loaded]);

  const back = () => store.setPage('list');

  /** The open edits with typed text, and whether the new memory has some. */
  const dirtyKeys = Object.entries(items).flatMap(([key, item]) => (item.mode === 'edit' && editDirty(item) ? [key] : []));
  const unsaved = dirtyKeys.length > 0 || composerDirty(composer);
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;

  /** Back, asking first when typed text would go. */
  const requestBack = () => {
    if (unsavedRef.current) setLeaving(true);
    else back();
  };
  const discardAndLeave = () => {
    store.dropDrafts(DRAFTS);
    back();
  };
  const keepEditing = () => {
    setLeaving(false);
    refocus.current = dirtyKeys[0] !== undefined ? { key: dirtyKeys[0], control: 'field' } : 'new';
  };

  // Typed text is kept in the store as it changes, so leaving the page (for another project, say) does not lose it.
  useEffect(() => {
    const want = new Map<string, { text: string; original?: string; base?: string }>();
    for (const [key, item] of Object.entries(items)) if (item.mode === 'edit' && editDirty(item)) want.set(editField(key), { text: item.draft, original: item.base });
    if (composer && composerDirty(composer)) want.set(ADD_FIELD, { text: composer.text, base: composer.name });
    for (const field of store.draftFields(DRAFTS)) {
      // Edits kept from before stay until the first full read has opened them again.
      if (!want.has(field) && (restored.current || !field.startsWith('edit:'))) store.setDraft(DRAFTS, field, null);
    }
    for (const [field, draft] of want) store.setDraft(DRAFTS, field, draft);
  }, [items, composer]);

  // Escape is Back, from anywhere on the page but a field (a field's Escape is its own: it closes its step or clears the search).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || composing(e)) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select')) return;
      if (store.get().overlays.length > 0) return;
      e.preventDefault();
      requestBack();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [store]);

  /** What shows: the read, then each open edit the read no longer lists (removed elsewhere, or left out by a search). */
  const listed = loaded.kind === 'ok' ? loaded.memories : [];
  const pinned = Object.values(items).flatMap((item) => (item.mode === 'edit' && !listed.some((m) => m.key === item.last.key) ? [item.last] : []));
  const shown = [...pinned, ...listed];

  /** The control focus moves to when `key` leaves the list: the next memory's, else the one before, else Add. */
  const neighbourOf = (key: string): Refocus => {
    const i = listed.findIndex((m) => m.key === key);
    const next = listed[i + 1] ?? listed[i - 1];
    return next ? { key: next.key, control: 'edit' } : 'add';
  };

  /** The memory `key` as Beads holds it now, in place of the copy on screen. */
  const replaceListed = (memory: Memory) =>
    setLoaded((l) => (l.kind === 'ok' ? { ...l, memories: l.memories.map((m) => (m.key === memory.key ? memory : m)) } : l));

  // ------------------------------------------------------------------------------------------------- edit

  const startEdit = (memory: Memory) => patchItem(memory.key, { mode: 'edit', draft: memory.text, base: memory.text, last: memory, feedback: null });

  /** Cancel or Escape: a forget step closes; an edit with typed text (or a refused one, whose choice is the person's) asks first. */
  const cancelItem = (key: string, control: 'edit' | 'forget') => {
    const item = itemsRef.current[key];
    if (item?.mode === 'edit' && editDirty(item)) {
      patchItem(key, { ...item, asking: true });
      return;
    }
    patchItem(key, null);
    refocus.current = { key, control };
  };

  const keepEdit = (key: string) => {
    const item = itemsRef.current[key];
    if (item?.mode === 'edit') patchItem(key, { ...item, asking: false });
    refocus.current = { key, control: 'field' };
  };

  /** "Discard" answered: the typed text goes. A refused edit then reads the memories again (or lets a removed one go). */
  const discardEdit = (key: string) => {
    const item = itemsRef.current[key];
    if (item?.mode === 'edit' && item.refused === 'gone') return leaveGone(key);
    if (item?.mode === 'edit' && item.refused === 'changed') return keepCurrent(key);
    patchItem(key, null);
    refocus.current = { key, control: 'edit' };
  };

  const save = async (key: string, item: Editing, readd = false) => {
    if (busy.includes(key) || paused !== null) return;
    hold(key, true);
    patchItem(key, { ...item, feedback: null });
    const outcome = await store.remember(readd ? { key, text: item.draft } : { key, text: item.draft, expectedText: item.base });
    hold(key, false);
    if (outcome.kind === 'dropped') return;
    if (outcome.kind === 'ok') {
      const result = outcome.value;
      if (result.ok) {
        patchItem(key, null);
        refocus.current = { key, control: 'edit' };
        setFresh(key);
        void load();
        return;
      }
      // Nothing was written: show what Beads holds now beside what the person typed, and let them choose.
      if (result.current) {
        replaceListed(result.current);
        patchItem(key, { ...item, base: result.current.text, last: result.current, refused: 'changed', feedback: null });
      } else {
        patchItem(key, { ...item, refused: 'gone', feedback: null });
      }
      return;
    }
    // Saved for sure (only reading it back failed): done. Maybe saved: the next full read settles it.
    if (outcome.kind === 'uncertain' && outcome.saved) {
      patchItem(key, null);
      refocus.current = { key, control: 'edit' };
      void load();
      return;
    }
    patchItem(key, { ...item, feedback: feedbackOf(outcome), check: outcome.kind === 'uncertain' });
    if (outcome.kind === 'uncertain') void load();
  };

  /** The memory went while it was being changed, and the person lets it go: it leaves the list now. */
  const leaveGone = (key: string) => {
    refocus.current = neighbourOf(key);
    patchItem(key, null);
    setLoaded((l) => (l.kind === 'ok' ? { ...l, memories: l.memories.filter((m) => m.key !== key) } : l));
    void load();
  };

  const keepCurrent = (key: string) => {
    patchItem(key, null);
    refocus.current = { key, control: 'edit' };
    void load();
  };

  // ------------------------------------------------------------------------------------------------- forget

  const askForget = (memory: Memory) => {
    patchItem(memory.key, { mode: 'forget', text: memory.text, feedback: null });
    refocus.current = { key: memory.key, control: 'cancel' };
  };

  const forget = async (shown: Memory, step: Forgetting) => {
    const key = shown.key;
    if (busy.includes(key) || paused !== null) return;
    // What goes is exactly what the step shows, never a newer text a read brought in.
    const memory = { ...shown, text: step.text };
    // Chosen before the write: the list may move under it while it runs.
    const after = neighbourOf(key);
    hold(key, true);
    patchItem(key, { ...step, feedback: null });
    const outcome = await store.forget(key, step.text);
    hold(key, false);
    if (outcome.kind === 'dropped') return;
    if (outcome.kind === 'ok') {
      const result: MemoryWriteResult = outcome.value;
      if (result.ok) {
        patchItem(key, null);
        setNotice({ kind: 'forgot', memory, feedback: null });
        refocus.current = after;
        void load();
        return;
      }
      if (result.current) {
        // The step now shows the text a forget would take, and asks again.
        replaceListed(result.current);
        patchItem(key, { mode: 'forget', text: result.current.text, moved: true, feedback: null });
        refocus.current = { key, control: 'cancel' };
        return;
      }
      // Already gone: nothing to forget, nothing to undo.
      patchItem(key, null);
      refocus.current = after;
      void load();
      return;
    }
    patchItem(key, { ...step, feedback: feedbackOf(outcome), check: outcome.kind === 'uncertain' && !outcome.saved });
    if (outcome.kind === 'uncertain') {
      const memories = await load();
      if (memories && !memories.some((m) => m.key === key)) setNotice({ kind: 'forgot', memory, feedback: null });
    }
  };

  /** Puts the forgotten memory back under the same name with the same text. */
  const undo = async (memory: Memory) => {
    if (undoing || paused !== null) return;
    setUndoing(true);
    const outcome: WriteOutcome<MemoryWriteResult> = await store.remember({ key: memory.key, text: memory.text });
    setUndoing(false);
    if (outcome.kind === 'dropped') return;
    if (outcome.kind === 'ok') {
      setNotice(outcome.value.ok ? { kind: 'back', key: memory.key } : { kind: 'taken', memory });
      if (outcome.value.ok) {
        refocus.current = { key: memory.key, control: 'edit' };
        setFresh(memory.key);
      }
      void load();
      return;
    }
    setNotice({ kind: 'forgot', memory, feedback: feedbackOf(outcome) });
    if (outcome.kind === 'uncertain') void load();
  };

  // ------------------------------------------------------------------------------------------------- add

  const openComposer = () => {
    if (!composer) setComposer({ text: '', name: '', taken: null, feedback: null });
  };

  const closeComposer = () => {
    if (adding) return;
    setComposer(null);
    refocus.current = 'add';
  };
  /** Cancel or Escape on the new memory: asks first when something is typed. */
  const cancelComposer = () => {
    if (adding || !composer) return;
    if (composerDirty(composer)) setComposer({ ...composer, asking: true });
    else closeComposer();
  };

  const add = async (c: Composer, replace = false) => {
    const text = c.text.trim();
    const name = c.name.trim();
    if (adding || text === '' || paused !== null) return;
    setAdding(true);
    setComposer({ ...c, feedback: null, vanished: undefined });
    const outcome = await store.remember({ text: c.text, ...(name ? { key: name } : {}), ...(replace && c.taken ? { key: c.taken.key, expectedText: c.taken.text } : {}) });
    setAdding(false);
    if (outcome.kind === 'dropped') return;
    if (outcome.kind === 'ok') {
      const result = outcome.value;
      if (result.ok) {
        setComposer(null);
        refocus.current = 'add';
        if (result.memory) setFresh(result.memory.key);
        void load();
        return;
      }
      // Replacing met a memory removed meanwhile: say so; Add memory now adds it as new.
      if (replace && !result.current && c.taken) {
        setComposer({ ...c, taken: null, feedback: null, vanished: `${c.taken.key} was removed elsewhere. Nothing was saved. Add memory adds yours as new.` });
        return;
      }
      setComposer({ ...c, taken: result.current, feedback: null, vanished: undefined });
      return;
    }
    if (outcome.kind === 'uncertain' && outcome.saved) {
      setComposer(null);
      refocus.current = 'add';
      void load();
      return;
    }
    setComposer({ ...c, feedback: feedbackOf(outcome), check: outcome.kind === 'uncertain' });
    if (outcome.kind === 'uncertain') void load();
  };

  // ------------------------------------------------------------------------------------------------- page

  const count = loaded.kind === 'ok' && !loaded.filtered ? loaded.memories.length : null;
  const searching = queryRef.current.trim() !== '';

  return (
    <section class="bd-mem" aria-labelledby="bd-mem-h">
      <nav class="bd-dnav bd-mem-nav">
        <button type="button" class="bd-iconbtn bd-back" aria-label="Back" title="Back (Esc)" onClick={requestBack}>
          <IconBack />
        </button>
        <h1 class="bd-mem-h" id="bd-mem-h" ref={heading} tabIndex={-1}>
          Memories{' '}
          {count !== null && !searching && <span class="bd-n">{count}</span>}
        </h1>
        <button
          ref={addButton}
          type="button"
          class="bd-btn bd-btn-sm bd-mem-addbtn"
          aria-expanded={composer !== null}
          disabled={paused !== null}
          title={paused ?? 'Add a memory'}
          onClick={openComposer}
        >
          <IconPlus />
          Add
        </button>
      </nav>
      {leaving && (
        <DiscardAsk label="Discard your unsaved text?" detail="What you typed here goes. Saved memories stay as they are." onKeep={keepEditing} onDiscard={discardAndLeave} />
      )}
      <div class="bd-mem-body" inert={leaving}>
        <p class="bd-mem-lede">Every agent session in this project starts with these.</p>
        <label class="bd-search bd-mem-search" data-hint="long">
          <IconSearch />
          <input
            type="search"
            placeholder="Search memories"
            aria-label="Search memories"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query !== '' && !composing(e)) {
                e.preventDefault();
                setQuery('');
              }
            }}
          />
        </label>
        {paused && <PausedNote reason={paused} />}
        {notice && <NoticeBar notice={notice} undoing={undoing} paused={paused} undo={undo} hide={() => setNotice(null)} />}
        {composer && (
          <AddBox
            composer={composer}
            busy={adding}
            paused={paused}
            set={(next) => setComposer({ ...composer, ...next })}
            add={(replace) => void add(composer, replace)}
            cancel={cancelComposer}
            keep={() => {
              setComposer({ ...composer, asking: false });
              refocus.current = 'new';
            }}
            discard={closeComposer}
          />
        )}
        {loaded.kind === 'ok' && loaded.error && (
          <div class="bd-mem-err" role="alert">
            <span>{`Could not read the memories again: ${loaded.error.message} The list shows them as last read.`}</span>
            <button type="button" class="bd-btn bd-btn-sm" onClick={() => void load()}>
              Try again
            </button>
          </div>
        )}
        {loaded.kind === 'loading' ? (
          <p class="bd-mem-quiet" role="status">
            Reading memories…
          </p>
        ) : loaded.kind === 'error' ? (
          <div class="bd-mem-err" role="alert">
            <span>{loaded.error.message}</span>
            <button type="button" class="bd-btn bd-btn-sm" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : shown.length === 0 ? (
          searching ? (
            <div class="bd-mem-quiet">
              <p>No memory matches.</p>
              <button
                type="button"
                class="bd-btn bd-btn-sm"
                onClick={() => {
                  setQuery('');
                  queryRef.current = '';
                  void load();
                }}
              >
                Clear search
              </button>
            </div>
          ) : (
            <div class="bd-mem-quiet">
              <p>No memories yet.</p>
              <p class="bd-mem-quiet-sub">Add one and every agent session in this project starts with it.</p>
            </div>
          )
        ) : (
          // role="list": Safari drops a styled list's semantics without it.
          <ul class="bd-mem-list" role="list" aria-label="Memories">
            {shown.map((memory) => (
              <MemoryItem
                key={memory.key}
                memory={memory}
                item={items[memory.key] ?? null}
                busy={busy.includes(memory.key)}
                paused={paused}
                fresh={fresh === memory.key}
                when={changedLine(memory, now)}
                pinned={pinned.includes(memory)}
                edit={() => startEdit(memory)}
                setDraft={(draft) => {
                  const item = items[memory.key];
                  if (item?.mode === 'edit') patchItem(memory.key, { ...item, draft });
                }}
                save={(readd) => {
                  const item = items[memory.key];
                  if (item?.mode === 'edit') void save(memory.key, item, readd);
                }}
                keepCurrent={() => keepCurrent(memory.key)}
                leaveGone={() => leaveGone(memory.key)}
                askForget={() => askForget(memory)}
                forget={() => {
                  const item = items[memory.key];
                  if (item?.mode === 'forget') void forget(memory, item);
                }}
                cancel={(control) => cancelItem(memory.key, control)}
                keepEditing={() => keepEdit(memory.key)}
                discard={() => discardEdit(memory.key)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------- one memory

type ItemProps = {
  memory: Memory;
  item: ItemState | null;
  busy: boolean;
  paused: string | null;
  fresh: boolean;
  when: string | null;
  /** Kept on screen for its open edit though the latest read does not list it. */
  pinned: boolean;
  edit(): void;
  setDraft(draft: string): void;
  save(readd?: boolean): void;
  keepCurrent(): void;
  leaveGone(): void;
  askForget(): void;
  forget(): void;
  cancel(control: 'edit' | 'forget'): void;
  keepEditing(): void;
  discard(): void;
};

/** Escape in a step closes it, and goes no further (the page's Escape is Back). */
const escapeCloses = (cancel: () => void) => (e: KeyboardEvent) => {
  if (e.key !== 'Escape' || composing(e)) return;
  e.preventDefault();
  e.stopPropagation();
  cancel();
};

function MemoryItem(props: ItemProps) {
  const { memory, item, busy, paused, fresh, when } = props;
  const off = busy || paused !== null;
  const title = paused ?? undefined;
  const head = (
    <span class="bd-mem-key" id={keyId(memory.key)} title={memory.key}>
      {memory.key}
    </span>
  );

  if (item?.mode === 'forget') {
    const stepId = controlId('ask', memory.key);
    return (
      <li class="bd-mem-item" data-mode="forget">
        {head}
        <div class="bd-mem-forget" role="group" aria-labelledby={stepId} onKeyDown={escapeCloses(() => !busy && props.cancel('forget'))}>
          <p class="bd-mem-forget-h" id={stepId}>{`Forget ${memory.key}?`}</p>
          {item.moved && (
            <p class="bd-mem-alert" role="alert">
              This memory changed since you opened this step. This is its text now; nothing was forgotten.
            </p>
          )}
          <p class="bd-mem-text bd-mem-quote">{item.text}</p>
          <p class="bd-mem-hint">Every agent session in this project will stop seeing this.</p>
          <div class="bd-mem-acts">
            <button type="button" class="bd-btn bd-btn-sm bd-mem-danger" disabled={off} aria-busy={busy || undefined} title={title} onClick={props.forget}>
              Forget memory
            </button>
            <button type="button" id={controlId('cancel', memory.key)} class="bd-btn bd-btn-sm" disabled={busy} onClick={() => props.cancel('forget')}>
              Cancel
            </button>
          </div>
          {item.feedback && <WriteMessage feedback={item.feedback} />}
        </div>
      </li>
    );
  }

  if (item?.mode === 'edit') {
    const fieldId = controlId('field', memory.key);
    const unchanged = item.draft.trim() === '' || (item.draft === item.base && !item.refused);
    const go = () => {
      if (!unchanged && !off) props.save(item.refused === 'gone');
    };
    return (
      <li class="bd-mem-item" data-mode="edit">
        {head}
        <div class="bd-mem-was" data-refused={item.refused}>
          <span class="bd-mem-label">{item.refused === 'changed' ? 'Now in Beads' : item.refused === 'gone' ? 'Was' : 'Now'}</span>
          <p class="bd-mem-text">{memory.text}</p>
        </div>
        {item.refused && (
          <p class="bd-mem-alert" role="alert">
            {item.refused === 'changed'
              ? `${memory.key} changed elsewhere while you were editing. Nothing was saved.`
              : 'This memory was removed elsewhere. Nothing was saved. Add it again with your text, or discard it.'}
          </p>
        )}
        <label class="bd-mem-label" for={fieldId}>
          New text
        </label>
        <EditField
          id={fieldId}
          value={item.draft}
          busy={busy}
          onInput={props.setDraft}
          // After a refusal the save key does nothing: overriding the newer text, or bringing a forgotten memory back, takes a button.
          onSave={item.refused ? () => {} : go}
          // Escape never makes a refused edit's choice: with typed text it asks, like Cancel.
          onEscape={() => !busy && props.cancel('edit')}
        />
        {props.pinned && !item.refused && <p class="bd-mem-hint">Shown while you edit it, though the search leaves it out.</p>}
        {!item.refused && <p class="bd-mem-hint">{`${saveKey()} saves. The text above stays until you save.`}</p>}
        {item.asking ? (
          <DiscardAsk label="Discard your changes?" onKeep={props.keepEditing} onDiscard={props.discard} />
        ) : (
        <div class="bd-mem-acts">
          {item.refused === 'changed' ? (
            <>
              <button type="button" class="bd-btn bd-btn-sm bd-btn-primary" disabled={off || item.draft.trim() === ''} aria-busy={busy || undefined} title={title} onClick={go}>
                Save mine anyway
              </button>
              <button type="button" class="bd-btn bd-btn-sm" disabled={busy} onClick={props.keepCurrent}>
                Keep current
              </button>
            </>
          ) : item.refused === 'gone' ? (
            <>
              <button type="button" class="bd-btn bd-btn-sm bd-btn-primary" disabled={off || item.draft.trim() === ''} aria-busy={busy || undefined} title={title} onClick={go}>
                Add it again
              </button>
              <button type="button" class="bd-btn bd-btn-sm" disabled={busy} onClick={props.leaveGone}>
                Discard
              </button>
            </>
          ) : (
            <>
              <button type="button" class="bd-btn bd-btn-sm bd-btn-primary" disabled={off || unchanged} aria-busy={busy || undefined} title={title} onClick={go}>
                Save
              </button>
              <button type="button" class="bd-btn bd-btn-sm" disabled={busy} onClick={() => props.cancel('edit')}>
                Cancel
              </button>
            </>
          )}
        </div>
        )}
        {item.feedback && <WriteMessage feedback={item.feedback} />}
      </li>
    );
  }

  return (
    // The name and its actions on one line, then the text, then when and by whom if Beads knows: a memory with no date simply ends
    // with its text, the same shape as the others.
    <li class="bd-mem-item" data-fresh={fresh || undefined}>
      <div class="bd-mem-top">
        {head}
        <span class="bd-mem-tools">
          <button type="button" id={controlId('edit', memory.key)} class="bd-mem-act" disabled={off} title={title} aria-describedby={keyId(memory.key)} onClick={props.edit}>
            Edit
          </button>
          <button type="button" id={controlId('forget', memory.key)} class="bd-mem-act" disabled={off} title={title} aria-describedby={keyId(memory.key)} onClick={props.askForget}>
            Forget
          </button>
        </span>
      </div>
      <p class="bd-mem-text">{memory.text}</p>
      {when && <p class="bd-mem-meta">{when}</p>}
    </li>
  );
}

/** A memory's text being written: focused when it opens, Cmd/Ctrl+Enter saves (Enter is a new line), Escape steps back. Held read-only while it saves, so focus stays. */
function EditField({ id, value, busy, onInput, onSave, onEscape }: { id: string; value: string; busy: boolean; onInput(v: string): void; onSave(): void; onEscape(): void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      id={id}
      class="bd-input bd-ntext bd-mem-field"
      rows={3}
      value={value}
      readOnly={busy}
      onInput={(e) => onInput(e.currentTarget.value)}
      onKeyDown={(e) => {
        escapeCloses(onEscape)(e);
        if (isSubmitKey(e)) {
          e.preventDefault();
          if (!busy) onSave();
        }
      }}
    />
  );
}

// ------------------------------------------------------------------------------------------------- add

type AddBoxProps = { composer: Composer; busy: boolean; paused: string | null; set(next: Partial<Composer>): void; add(replace: boolean): void; cancel(): void; keep(): void; discard(): void };

function AddBox({ composer, busy, paused, set, add, cancel, keep, discard }: AddBoxProps) {
  const off = busy || paused !== null || composer.text.trim() === '';
  const taken = composer.taken;
  const go = () => {
    if (!off) add(false);
  };
  return (
    <div class="bd-mem-add" role="group" aria-label="New memory" onKeyDown={escapeCloses(cancel)}>
      <label class="bd-mem-label" for="bd-mem-new">
        Memory
      </label>
      <EditField id="bd-mem-new" value={composer.text} busy={busy} onInput={(text) => set({ text })} onSave={go} onEscape={cancel} />
      <input
        type="text"
        class="bd-input bd-mem-name"
        aria-label="Name (optional)"
        aria-describedby="bd-mem-name-hint"
        placeholder="Name (optional)"
        value={composer.name}
        readOnly={busy}
        spellcheck={false}
        autoCapitalize="off"
        onInput={(e) => set({ name: e.currentTarget.value, taken: null })}
        onKeyDown={(e) => {
          // A plain Enter in a one-line field adds, as in the rest of the panel.
          if (isEnterInInput(e)) {
            e.preventDefault();
            go();
          }
        }}
      />
      <p class="bd-mem-hint" id="bd-mem-name-hint">
        {`Leave the name empty and Beads makes one from the text. ${saveKey()} adds.`}
      </p>
      {composer.vanished && (
        <p class="bd-mem-alert" role="alert">
          {composer.vanished}
        </p>
      )}
      {taken && (
        <div class="bd-mem-taken">
          <p class="bd-mem-alert" role="alert">{`A memory named ${taken.key} already exists. Nothing was saved.`}</p>
          <p class="bd-mem-text bd-mem-quote">{taken.text}</p>
        </div>
      )}
      {composer.asking ? (
        <DiscardAsk label="Discard this memory?" onKeep={keep} onDiscard={discard} />
      ) : (
      <div class="bd-mem-acts">
        {taken ? (
          <button type="button" class="bd-btn bd-btn-sm bd-btn-primary" disabled={off} aria-busy={busy || undefined} title={paused ?? undefined} onClick={() => add(true)}>
            Replace it with mine
          </button>
        ) : (
          <button type="button" class="bd-btn bd-btn-sm bd-btn-primary" disabled={off} aria-busy={busy || undefined} title={paused ?? undefined} onClick={go}>
            Add memory
          </button>
        )}
        <button type="button" class="bd-btn bd-btn-sm" disabled={busy} onClick={cancel}>
          Cancel
        </button>
      </div>
      )}
      {composer.feedback && <WriteMessage feedback={composer.feedback} />}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- notice

function NoticeBar({ notice, undoing, paused, undo, hide }: { notice: Notice; undoing: boolean; paused: string | null; undo(memory: Memory): void; hide(): void }) {
  let body: ComponentChildren;
  if (notice.kind === 'forgot') {
    body = (
      <>
        <span>{`Forgot ${notice.memory.key}.`}</span>
        <button
          type="button"
          class="bd-btn bd-btn-sm bd-btn-primary bd-mem-undo"
          disabled={undoing || paused !== null}
          aria-busy={undoing || undefined}
          title={paused ?? `Bring back ${notice.memory.key} with the same text`}
          onClick={() => undo(notice.memory)}
        >
          Undo
        </button>
        {notice.feedback && <WriteMessage feedback={notice.feedback} />}
      </>
    );
  } else if (notice.kind === 'back') {
    body = <span>{`${notice.key} is back.`}</span>;
  } else {
    // The forgotten text stays here, to copy or to add under another name.
    body = (
      <>
        <span>{`Could not bring back ${notice.memory.key}: a memory with that name exists now. Nothing was saved. Its text was:`}</span>
        <p class="bd-mem-text bd-mem-quote">{notice.memory.text}</p>
      </>
    );
  }
  return (
    <div class="bd-nnote bd-mem-note" role="status" data-kind={notice.kind}>
      <span class="bd-mem-note-body">{body}</span>
      <button type="button" class="bd-nnote-x" aria-label="Hide this note" onClick={hide}>
        <IconX />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- discard question

/**
 * Asked before typed text would go: Cancel, Escape, Back. Focus goes to the question itself; Enter there answers Discard, as on
 * every confirm question, and Escape keeps editing. Tab reaches both buttons.
 */
function DiscardAsk({ label, detail, onKeep, onDiscard }: { label: string; detail?: string; onKeep(): void; onDiscard(): void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus({ preventScroll: true }), []);
  return (
    <div
      ref={box}
      tabIndex={-1}
      class="bd-confirm bd-mem-ask"
      role="alertdialog"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onKeep();
        } else if (isConfirmKey(e)) {
          e.preventDefault();
          e.stopPropagation();
          onDiscard();
        }
      }}
    >
      <span class="bd-mem-ask-q">
        {label}
        {detail && <span class="bd-mem-ask-d">{detail}</span>}
      </span>
      <button type="button" class="bd-btn bd-btn-sm" onClick={onKeep}>
        Keep editing
      </button>
      <button type="button" class="bd-btn bd-btn-sm" data-tone="danger" onClick={onDiscard}>
        Discard
      </button>
    </div>
  );
}
