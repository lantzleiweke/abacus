import { useEffect, useRef } from 'preact/hooks';
import { localZone, parseDateInput } from '../dates';
import { isEnterInInput } from '../keyboard';

/** What the preview says for text the panel cannot read ahead of Beads. */
export const BEADS_READS = 'Beads will read this when you save.';
/** What the preview says before anything is typed. */
export const DATE_HINT = 'For example tomorrow, next monday, +3d or 2026-10-20.';

type DateInputProps = {
  value: string;
  onInput(text: string): void;
  /** Enter in the box, not while an input method is composing. */
  onEnter?(): void;
  /** The box's accessible name ("Defer until"). */
  label: string;
  /** Put before a date read from the text: "Until" gives "Until Fri, Oct 17, 9:41 AM". */
  lead?: string;
  disabled?: boolean;
  /** Held while a save is out: the text stays readable and selectable, not greyed out. */
  readOnly?: boolean;
  autoFocus?: boolean;
  /** Panel clock for the preview (tests); now by default. */
  now?: number;
  zone?: string;
};

/**
 * A date as typed for Beads, with a line under it that says what Beads will store: the date when the text is one of the forms
 * the panel reads exactly as Beads does (`dates.ts`), else that Beads will read it on save. Never a guess.
 */
export function DateInput({ value, onInput, onEnter, label, lead, disabled, readOnly, autoFocus, now, zone }: DateInputProps) {
  const hintId = useRef(`bd-date-${Math.random().toString(36).slice(2, 9)}`).current;
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) box.current?.focus();
  }, []);
  const text = value.trim();
  const parsed = text === '' ? null : parseDateInput(text, now ?? Date.now(), zone ?? localZone());
  const preview = parsed === null ? DATE_HINT : parsed.kind === 'ok' ? (lead ? `${lead} ${parsed.label}` : parsed.label) : BEADS_READS;
  return (
    <div class="bd-date">
      <input
        type="text"
        class="bd-input"
        aria-label={label}
        aria-describedby={hintId}
        autoComplete="off"
        spellcheck={false}
        placeholder="tomorrow, +3d, 2026-10-20"
        value={value}
        disabled={disabled}
        readOnly={readOnly}
        ref={box}
        onInput={(e) => onInput(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (onEnter && isEnterInInput(e)) {
            e.preventDefault();
            onEnter();
          }
        }}
      />
      <p class="bd-date-preview" id={hintId} data-kind={parsed === null ? 'hint' : parsed.kind}>
        {preview}
      </p>
    </div>
  );
}
