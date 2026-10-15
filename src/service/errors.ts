import { BdError } from './bd/exec';

// How a failed read of beads is told to the user and kept for "Copy details". One classifier for the refresh loop (snapshot.ts)
// and the routes (routes.ts), so the same failure reads the same everywhere.

/** Raw text kept for "Copy details" is cut to this. */
export const DETAIL_MAX = 4_000;

/** Long text cut to `max` characters, with an ellipsis. */
export function capText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** What Sync and Publish say when the Dolt tool they read the project's history with is missing. */
export const NO_DOLT_TEXT = "Publishing needs the Dolt tool, which isn't installed.";

/** The `dolt` executable could not be found (embedded mode reads history and counts with it). */
export function isNoDolt(error: unknown): boolean {
  return error instanceof BdError && error.kind === 'not-found' && /^dolt\b/.test(error.message);
}

/** Beads is locked or did not answer in time: a passing problem. */
export function isBusyError(error: unknown): boolean {
  return error instanceof BdError && (error.kind === 'lock' || error.kind === 'timeout');
}

/** The raw cause, for `detail` fields: the message and bd's stderr, cut to `DETAIL_MAX`. Never put this in a message. */
export function errorDetail(error: unknown): string {
  const text = error instanceof BdError ? [error.message, error.stderr.trim()].filter(Boolean).join('\n') : error instanceof Error ? error.message : String(error);
  return capText(text, DETAIL_MAX);
}

/**
 * Plain-language copy for a failed read. `retrying` is for the poll path (the panel asks again by itself); anywhere the
 * user must act, the copy says to try again instead.
 */
export function readErrorText(error: unknown, retrying: boolean): string {
  if (isBusyError(error)) return retrying ? 'Beads is busy. Retrying.' : 'Beads is busy. Try again in a moment.';
  return retrying ? "Couldn't read beads. Retrying." : "Couldn't read beads.";
}
