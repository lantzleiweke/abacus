import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { composing } from '../keyboard';

// ------------------------------------------------------------------------------------------------- popover

/** The least room a popover keeps from the panel's edges. */
const EDGE = 12;

type PopoverProps = {
  label: string;
  align?: 'start' | 'end';
  onClose(): void;
  children: ComponentChildren;
  role?: 'menu' | 'dialog';
};

/**
 * A small panel under its trigger (the trigger and this share a relative wrapper). Escape or a click outside closes it,
 * and focus goes back to the trigger.
 */
export function Popover({ label, align = 'start', onClose, children, role = 'dialog' }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Kept at least 12 px inside the panel on both sides, whichever way it opens.
  useLayoutEffect(() => {
    const el = ref.current;
    const panel = el?.closest('.bd')?.getBoundingClientRect();
    if (!el || !panel || panel.width === 0) return;
    // Layout boxes, not the drawn one: the opening animation scales the popover a little.
    const left = (el.offsetParent?.getBoundingClientRect().left ?? 0) + el.offsetLeft;
    const right = left + el.offsetWidth;
    let dx = 0;
    if (right > panel.right - EDGE) dx = panel.right - EDGE - right;
    if (left + dx < panel.left + EDGE) dx = panel.left + EDGE - left;
    // `translate` composes with the animation's `transform`, and moves right-anchored popovers too.
    if (dx !== 0) el.style.translate = `${dx}px 0`;
  }, []);
  useEffect(() => {
    const el = ref.current;
    const first = ['[data-autofocus]', '[role="menuitemradio"][aria-checked="true"]', 'input', '[role="menuitemradio"]', 'button']
      .map((s) => el?.querySelector<HTMLElement>(s))
      .find(Boolean);
    first?.focus();
    const outside = (e: Event) => {
      const wrap = el?.parentElement;
      if (wrap && !wrap.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      (ref.current?.parentElement?.querySelector<HTMLElement>('[aria-haspopup]') ?? null)?.focus();
      onClose();
      return;
    }
    if (role !== 'menu' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    e.preventDefault();
  };
  return (
    <div ref={ref} class="bd-pop" data-align={align} role={role} aria-label={label} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

/** Open state for a popover, closing when the controls turn off. */
export function usePopover(disabled: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  return { open, toggle: () => setOpen((o) => !o), close: () => setOpen(false) };
}

// ------------------------------------------------------------------------------------------------- pick lists

/** Arrow keys over a list of choices from a text field; Enter takes the highlighted one. */
export function useChoices<T>(items: T[], listId: string) {
  const [active, setActive] = useState(-1);
  useEffect(() => setActive(-1), [items.length]);
  const onKey = (e: KeyboardEvent, take: (item: T | null) => void) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length === 0) return;
      setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % items.length : (a <= 0 ? items.length : a) - 1));
    } else if (e.key === 'Enter' && !composing(e)) {
      e.preventDefault();
      take(active >= 0 ? (items[active] ?? null) : null);
    }
  };
  const optionId = (i: number) => `${listId}-o${i}`;
  /** For the field's `aria-activedescendant`: the highlighted option, or none. */
  const activeId = active >= 0 && active < items.length ? optionId(active) : undefined;
  return { active, onKey, optionId, activeId };
}

