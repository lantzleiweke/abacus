import { describe, expect, it } from 'vitest';
import { localZone, parseDateInput } from '../../../src/panel/dates';
import fixture from '../../fixtures/bd13/date-forms.json';

type Row = { flag: string; zone: string; form: string; before: string; after: string; stored: string | null; error: string | null };
const rows = fixture.rows as Row[];

/** The forms the preview claims to know, as captured against real bd 1.3.1 (test/fixtures/bd13/date-forms.json). */
const KNOWN = new Set([
  'tomorrow', 'Tomorrow', 'next monday', 'next Monday', 'next thursday', 'next friday', 'next sunday',
  '+0d', '+2d', '+5d', '+20d', '+1w', '+3w', '+3h',
  '2026-10-20', '2026-10-20T14:30:00', '2026-10-20T14:30:00Z',
]);
/** Forms bd reads in a way the preview does not model (or reads wrongly): the preview never guesses these. */
const UNKNOWN = ['+30m', '+90m', '+1y', '+1M', '+2D', '2026-10-20 14:30', 'in 2 days', 'today', 'monday', 'friday', 'eod', 'next week'];

describe('dates: each form parses to the right instant in a given zone', () => {
  const known = rows.filter((r) => r.flag === '--due' && KNOWN.has(r.form));

  it('the fixture holds every known form in every zone', () => {
    expect(new Set(known.map((r) => r.zone)).size).toBe(5);
    for (const form of KNOWN) expect(known.filter((r) => r.form === form).length, form).toBe(5);
  });

  it.each(known.map((r) => [`${r.form} in ${r.zone}`, r] as const))('%s matches what bd 1.3.1 stored', (_name, r) => {
    const result = parseDateInput(r.form, Date.parse(r.before), r.zone);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const diff = Math.abs(result.at.getTime() - Date.parse(r.stored!));
    // bd reads its own clock a moment after `before`; absolute forms (ISO) have no clock in them.
    expect(diff).toBeLessThanOrEqual(/^\d{4}-/.test(r.form) ? 0 : 2_500);
    expect(result.label).not.toBe('');
  });

  it('defer --until reads the same forms the same way', () => {
    const deferred = rows.filter((r) => r.flag === 'defer --until');
    expect(deferred.length).toBeGreaterThan(0);
    for (const r of deferred) {
      const result = parseDateInput(r.form, Date.parse(r.before), r.zone);
      expect(result.kind, r.form).toBe('ok');
      if (result.kind === 'ok') expect(Math.abs(result.at.getTime() - Date.parse(r.stored!)), r.form).toBeLessThanOrEqual(/^\d{4}-/.test(r.form) ? 0 : 2_500);
    }
  });

  it('a +Nd across a daylight saving change keeps the wall clock time (Los Angeles, +20d over 1 Nov)', () => {
    const r = known.find((x) => x.form === '+20d' && x.zone === 'America/Los_Angeles')!;
    const result = parseDateInput('+20d', Date.parse(r.before), r.zone);
    if (result.kind !== 'ok') throw new Error('expected ok');
    // 04:46 PDT today is 04:46 PST in November: an hour later in UTC than a fixed 480 hours.
    expect(result.at.getTime() - Date.parse(r.before)).toBeGreaterThan(20 * 86_400_000);
  });

  it('weekday names count in the zone they are read in (Friday already in Kiritimati)', () => {
    const now = Date.parse('2026-10-15T11:47:00Z');
    const at = (form: string, zone: string) => {
      const r = parseDateInput(form, now, zone);
      return r.kind === 'ok' ? r.at.toISOString() : r.kind;
    };
    expect(at('next friday', 'Pacific/Kiritimati')).toBe('2026-10-22T11:47:00.000Z');
    expect(at('next friday', 'America/Los_Angeles')).toBe('2026-10-16T11:47:00.000Z');
  });

  it('the label says the day, and the time unless the form named only a day', () => {
    const now = Date.parse('2026-10-15T11:47:00Z');
    const label = (text: string) => {
      const r = parseDateInput(text, now, 'America/Los_Angeles');
      return r.kind === 'ok' ? r.label : null;
    };
    expect(label('2026-10-20')).toBe('Tue, Oct 20');
    expect(label('tomorrow')).toBe('Fri, Oct 16, 4:47 AM');
    expect(label('+3h')).toBe('Thu, Oct 15, 7:47 AM');
    expect(label('2027-01-08')).toBe('Fri, Jan 8, 2027');
  });
});

describe('dates: anything else is unknown, never guessed', () => {
  it.each(UNKNOWN.map((f) => [f] as const))('%s is unknown', (form) => {
    expect(parseDateInput(form, Date.parse('2026-10-15T11:47:00Z'), 'America/Los_Angeles')).toEqual({ kind: 'unknown' });
  });

  it('the fixture shows bd reads these in a way worth not guessing (months for +Nm, junk for a space)', () => {
    const stored = (form: string) => rows.find((r) => r.form === form && r.zone === 'UTC')?.stored ?? '';
    expect(stored('+30m')).toMatch(/^2029-04-15/);
    expect(stored('2026-10-20 14:30')).toMatch(/^2026-10-15/);
  });

  it('empty, blank, a calendar day that does not exist, and a zone that is not one', () => {
    const now = Date.parse('2026-10-15T11:47:00Z');
    for (const text of ['', '   ', '2026-02-30', '2026-13-01', '+d', '+-2d', '+99999d', 'next', 'next someday', '2026-10-20T25:00:00']) {
      expect(parseDateInput(text, now, 'UTC'), text).toEqual({ kind: 'unknown' });
    }
    expect(parseDateInput('tomorrow', now, 'Not/AZone')).toEqual({ kind: 'unknown' });
  });

  it('surrounding spaces do not matter', () => {
    expect(parseDateInput('  tomorrow ', Date.parse('2026-10-15T11:47:00Z'), 'UTC').kind).toBe('ok');
  });

  it('localZone names a zone', () => {
    expect(localZone().length).toBeGreaterThan(0);
  });
});
