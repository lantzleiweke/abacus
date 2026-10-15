/** What a key does in the list. `move` sets the keyboard cursor; `open` selects the bead; `menu` opens its row menu. */
export type KeyAction = { type: 'move'; id: string } | { type: 'open'; id: string } | { type: 'menu'; id: string } | { type: 'search' } | { type: 'escape' } | null;

/**
 * Where focus is when the key arrives:
 *  - `list`: the list or nothing in particular, so every list key works.
 *  - `search`: the search box. Letters and `/` are text there; arrows still move, and Enter opens the cursor row.
 *  - `control`: a button, link or menu item, whose own Enter and menu key must keep working; j, k and arrows still move.
 *  - `field`: any other text field or select, which keeps every key.
 */
export type KeyFocus = 'list' | 'search' | 'control' | 'field';

export type KeyInput = {
  key: string;
  /** Visible rows in order. */
  ids: string[];
  cursor: string | null;
  focus: KeyFocus;
};

/** Linear's list keys: `j`/`k` (or arrows) move, Enter opens, `/` searches, Escape backs out. */
export function listKey({ key, ids, cursor, focus }: KeyInput): KeyAction {
  if (focus === 'field') return null;
  const at = cursor === null ? -1 : ids.indexOf(cursor);
  const move = (step: 1 | -1): KeyAction => {
    if (ids.length === 0) return null;
    const next = at < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, at + step));
    return { type: 'move', id: ids[next]! };
  };
  switch (key) {
    case 'ArrowDown':
      return move(1);
    case 'ArrowUp':
      return move(-1);
    case 'Enter':
      return at < 0 || focus === 'control' ? null : { type: 'open', id: ids[at]! };
    case 'Escape':
      return { type: 'escape' };
  }
  if (focus === 'search') return null;
  switch (key) {
    case 'j':
      return move(1);
    case 'k':
      return move(-1);
    case '/':
      return { type: 'search' };
    case 'ContextMenu':
      return at < 0 || focus === 'control' ? null : { type: 'menu', id: ids[at]! };
  }
  return null;
}

/** A Mac, where the save shortcut is Cmd+Enter (Ctrl+Enter elsewhere). Read each time, so it follows the browser. */
export const isMac = (): boolean => /Mac|iPhone|iPad/i.test(typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent);

/** The save shortcut as the hint shows it. */
export const saveKey = (): string => (isMac() ? '⌘↵' : 'Ctrl+Enter');

/** An input method is still composing (Japanese, Chinese, Korean...): its Enter picks a character, it does not submit. */
export const composing = (e: KeyboardEvent): boolean => e.isComposing || e.keyCode === 229;

/** Cmd/Ctrl+Enter, not while composing. */
export const isSubmitKey = (e: KeyboardEvent): boolean => !composing(e) && (e.metaKey || e.ctrlKey) && e.key === 'Enter';

/** A plain Enter in a single-line input, not while an input method is composing: what used to submit a form. */
export const isEnterInInput = (e: KeyboardEvent): boolean =>
  e.key === 'Enter' && !composing(e) && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey && e.target instanceof HTMLInputElement;

/**
 * Enter or Cmd/Ctrl+Enter, not while composing, answering a confirm question ("Discard?") with its affirmative. A focused
 * button is left out: its own Enter activation does what its label says (Enter on "Keep editing" keeps editing).
 */
export const isConfirmKey = (e: KeyboardEvent): boolean => e.key === 'Enter' && !composing(e) && !e.shiftKey && !e.altKey && !(e.target instanceof HTMLButtonElement);

const FOCUSABLE = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Tab and Shift+Tab stay inside a dialog: from its last control to its first, and back. Other keys pass. */
export function trapTab(e: KeyboardEvent, dialog: HTMLElement | null): void {
  if (e.key !== 'Tab' || !dialog) return;
  const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next = e.shiftKey ? (at <= 0 ? items.length - 1 : -1) : at === items.length - 1 || at < 0 ? 0 : -1;
  if (next < 0) return;
  e.preventDefault();
  items[next]!.focus();
}
