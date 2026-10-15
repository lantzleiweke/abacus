/**
 * Date text as Beads reads it, for the preview under a due or snooze date box. Only the forms that were captured against
 * real bd 1.3.1 (`test/fixtures/bd13/date-forms.json`) are parsed; everything else is `unknown`, which the panel words as
 * "Beads will read this when you save". Never a guess: bd reads `+30m` as 30 months and `2026-10-20 14:30` as something else
 * entirely, and a preview that claimed otherwise would be wrong.
 *
 * What bd does, as captured:
 *  - `tomorrow`, `+Nd`, `+Nw`, `next <weekday>`: calendar days from now in the person's zone, at the same wall clock time as
 *    now (across a daylight saving change the wall clock time holds). `next friday` on a Thursday is tomorrow; on a Friday it
 *    is in 7 days. The weekday is the one in the person's zone.
 *  - `+Nh`: that many hours from now.
 *  - `YYYY-MM-DD`: midnight at the start of that day, in the person's zone.
 *  - `YYYY-MM-DDTHH:MM:SS`: that time in the person's zone; with a trailing `Z`, that instant.
 */

export type DateInput = { kind: 'ok'; at: Date; label: string } | { kind: 'unknown' };

/** The zone this panel runs in, as an IANA name. */
export const localZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' });
    formatters.set(zone, f);
  }
  return f;
}

/** The wall clock in `zone` at an instant. */
function wallAt(ms: number, zone: string): Wall {
  const get: Record<string, string> = {};
  for (const p of parts(zone).formatToParts(new Date(ms))) get[p.type] = p.value;
  return {
    year: Number(get.year),
    month: Number(get.month),
    day: Number(get.day),
    hour: Number(get.hour) % 24,
    minute: Number(get.minute),
    second: Number(get.second),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get.weekday ?? ''),
  };
}

/** The offset of `zone` from UTC (ms, positive east) at an instant. */
function offsetAt(ms: number, zone: string): number {
  const w = wallAt(ms, zone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000;
}

/** The instant a wall clock time in `zone` happens: two passes find the offset in force at that time, not at the guess. */
function instantOf(y: number, mo: number, d: number, h: number, mi: number, s: number, zone: string): number {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  return asUtc - offsetAt(asUtc - offsetAt(asUtc, zone), zone);
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z?)$/;
const RELATIVE_RE = /^\+(\d{1,4})([dwh])$/;
const NEXT_RE = /^next ([a-z]+)$/;

/** Whether y-m-d is a real calendar day. */
function realDay(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function labelFor(ms: number, now: number, zone: string, dayOnly: boolean): string {
  const base: Intl.DateTimeFormatOptions = { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric' };
  const sameYear = wallAt(ms, zone).year === wallAt(now, zone).year;
  const options: Intl.DateTimeFormatOptions = { ...base, ...(sameYear ? {} : { year: 'numeric' }), ...(dayOnly ? {} : { hour: 'numeric', minute: '2-digit' }) };
  return new Intl.DateTimeFormat('en-US', options).format(new Date(ms));
}

/** A stored date for reading ("Fri, Oct 17, 9:00 AM"): the day alone when it is local midnight, the year only when it is not this one. */
export function dateLabel(ms: number, now: number, zone: string = localZone()): string {
  try {
    const w = wallAt(ms, zone);
    return labelFor(ms, now, zone, w.hour === 0 && w.minute === 0 && w.second === 0);
  } catch {
    return new Date(ms).toISOString();
  }
}

/** Calendar days after now in `zone`, at now's wall clock time. */
function daysFromNow(now: number, days: number, zone: string): number {
  const w = wallAt(now, zone);
  const moved = new Date(Date.UTC(w.year, w.month - 1, w.day + days, w.hour, w.minute, w.second));
  return instantOf(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate(), w.hour, w.minute, w.second, zone);
}

/**
 * What Beads would store for `text` typed as a date, read at `now` (ms) by someone in `zone` (an IANA name). `unknown`: not one of
 * the forms known to read as stated, so the panel shows no date and says Beads will read it when saved.
 */
export function parseDateInput(text: string, now: number, zone: string): DateInput {
  const raw = text.trim();
  if (raw === '') return { kind: 'unknown' };
  try {
    const ok = (at: number, dayOnly = false): DateInput => ({ kind: 'ok', at: new Date(at), label: labelFor(at, now, zone, dayOnly) });
    const clock = Math.floor(now / 1000) * 1000;

    const lower = raw.toLowerCase();
    if (lower === 'tomorrow') return ok(daysFromNow(clock, 1, zone));

    const next = NEXT_RE.exec(lower);
    if (next) {
      const target = WEEKDAYS.indexOf(next[1]!);
      if (target < 0) return { kind: 'unknown' };
      const ahead = (target - wallAt(clock, zone).weekday + 7) % 7 || 7;
      return ok(daysFromNow(clock, ahead, zone));
    }

    // The unit is lowercase: bd refuses `+2D`.
    const relative = RELATIVE_RE.exec(raw);
    if (relative) {
      const n = Number(relative[1]);
      if (relative[2] === 'h') return ok(clock + n * 3_600_000);
      return ok(daysFromNow(clock, relative[2] === 'w' ? n * 7 : n, zone));
    }

    const day = DAY_RE.exec(raw);
    if (day) {
      const [y, m, d] = [Number(day[1]), Number(day[2]), Number(day[3])];
      return realDay(y, m, d) ? ok(instantOf(y, m, d, 0, 0, 0, zone), true) : { kind: 'unknown' };
    }

    const time = DATETIME_RE.exec(raw);
    if (time) {
      const [y, m, d, h, mi, s] = time.slice(1, 7).map(Number) as [number, number, number, number, number, number];
      if (!realDay(y, m, d) || h > 23 || mi > 59 || s > 59) return { kind: 'unknown' };
      return ok(time[7] === 'Z' ? Date.UTC(y, m - 1, d, h, mi, s) : instantOf(y, m, d, h, mi, s, zone));
    }
  } catch {
    // A zone name Intl does not know.
  }
  return { kind: 'unknown' };
}
