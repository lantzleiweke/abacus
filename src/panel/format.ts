/** "just now" (under 5 s), "8s ago", "12m ago", "3h ago", "2d ago", "3w ago". Negative ages (clock skew) count as now. */
export function ago(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

/** Row-sized age, like Linear's list: "now", "4m", "3h", "2d", "3w". Under a minute counts as now. */
export function shortAgo(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A bare date ("2026-10-02"), which Beads' history gives when it knows no time. */
export const isDateOnly = (text: string): boolean => DATE_ONLY.test(text);

/**
 * A recorded time as a Date. A bare date is read as written: that day's local midnight, never shifted by a time zone.
 * Anything else is an instant. Null when it is not a time at all.
 */
export function recordedDate(text: string): Date | null {
  const m = DATE_ONLY.exec(text);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const t = Date.parse(text);
  return Number.isFinite(t) ? new Date(t) : null;
}

// Formatters are built once, in UTC, and each date is handed over as its local wall-clock fields: the zone in force when
// it is drawn is the one that counts, and no formatter is built per row.
const utc = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' });
const MONTH_DAY = utc({ month: 'short', day: 'numeric' });
const MONTH_DAY_YEAR = utc({ month: 'short', day: 'numeric', year: 'numeric' });
const TIME = utc({ hour: 'numeric', minute: '2-digit' });
const FULL = utc({ month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const wallClock = (d: Date): number => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes());

/** "Oct 2", with the year when it is not the year of `now`. */
export const dayText = (date: Date, now: number): string => (date.getFullYear() === new Date(now).getFullYear() ? MONTH_DAY : MONTH_DAY_YEAR).format(wallClock(date));

/** "5:02 PM". */
export const timeText = (date: Date): string => TIME.format(wallClock(date));

/** "Oct 2, 2026, 5:02 PM". */
export const fullText = (date: Date): string => FULL.format(wallClock(date));

/** Last path segment of a directory, for a project name before the service has answered. */
export const folderName = (directory: string): string => directory.split(/[\\/]/).filter(Boolean).pop() ?? directory;

/** Up to two initials for an avatar: "Bob Builder" is "BB", "claude" is "C". */
export function initials(name: string): string {
  const words = name.replace(/\(.*?\)/g, ' ').trim().split(/[\s._@-]+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}
