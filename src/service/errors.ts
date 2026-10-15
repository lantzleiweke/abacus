import type { SchemaSkew } from '../shared/types';
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

/** What a read says when the project's store is on an older schema than the installed Beads expects. */
export const SCHEMA_UPDATE_TEXT = 'This project needs a one-time update for the newer Beads.';

const SCHEMA_SKEW = /schema version mismatch: database is at v(\d+), binary expects v(\d+)/i;
const READ_ONLY_CANNOT_MIGRATE = /read-only open cannot migrate/i;

/**
 * bd 1.3.1 refuses a `--readonly` open of a store still on an older schema: `schema version mismatch: database is at v32, binary
 * expects v66, and the read-only open cannot migrate it`. The two versions, or null when the error is not that refusal.
 * Never answered with `BD_IGNORE_SCHEMA_SKEW`: the person updates the project on purpose, or it stays as it is.
 */
export function schemaSkewOf(error: unknown): SchemaSkew | null {
  if (!(error instanceof BdError)) return null;
  const text = `${error.message}\n${error.stderr}`;
  const versions = SCHEMA_SKEW.exec(text);
  if (!versions || !READ_ONLY_CANNOT_MIGRATE.test(text)) return null;
  return { from: Number(versions[1]), to: Number(versions[2]) };
}

/**
 * What the explicit update prints (stderr, exit 1) when the store is shared, where migrating in place would fork the team's schema or
 * lock out the other clients. bd 1.3.1 words it five ways (fixtures `migrate-schema-remote-refused.stderr` from a real run, and
 * `-remote-adopt`, `-remote-diverged`, `-shared-server` from the binary's own message text):
 * - "refusing to auto-apply N pending schema migrations to a remote-backed database" (no cached remote state to compare with)
 * - "refusing to migrate a remote-backed database ...: the remote is already migrated" (it should adopt the remote's copy instead)
 * - "refusing to migrate a remote-backed database ...: this clone and the remote applied different content"
 * - "refusing to auto-apply N pending schema migrations to a shared server database ... lock out every co-resident bd client"
 * - "... pending schema migrations on a shared server database, no consent" / "the first-mover auto-migrate is disabled here"
 */
const REMOTE_MIGRATE_GATE =
  /refusing to (?:auto-apply \d+ pending schema migrations? to a (?:remote-backed|shared server) database|migrate a remote-backed database)|pending schema migrations? on a shared server database, no consent|first-mover auto-migrate is disabled/i;

/**
 * bd's own gate (#4259, #5920): it will not migrate a store that syncs with a remote, or that is a shared server, unless told with
 * `--force`, which Abacus never passes. True when the text is one of those refusals.
 */
export function isRemoteMigrateGate(text: string): boolean {
  return REMOTE_MIGRATE_GATE.test(text);
}

/**
 * Plain-language copy for a failed read. `retrying` is for the poll path (the panel asks again by itself); anywhere the
 * user must act, the copy says to try again instead.
 */
export function readErrorText(error: unknown, retrying: boolean): string {
  if (schemaSkewOf(error)) return SCHEMA_UPDATE_TEXT;
  if (isBusyError(error)) return retrying ? 'Beads is busy. Retrying.' : 'Beads is busy. Try again in a moment.';
  return retrying ? "Couldn't read beads. Retrying." : "Couldn't read beads.";
}
