import { describe, expect, it } from 'vitest';
import { capabilitiesFor } from '../../../src/service/capabilities';

describe('capabilitiesFor', () => {
  it('capabilities are off below 1.3', () => {
    expect(capabilitiesFor('1.2.2')).toEqual({ eventsJournal: false, leases: false });
    expect(capabilitiesFor('1.2.9')).toEqual({ eventsJournal: false, leases: false });
    expect(capabilitiesFor('0.9.0')).toEqual({ eventsJournal: false, leases: false });
  });

  it('capabilities are on at 1.3.1', () => {
    expect(capabilitiesFor('1.3.1')).toEqual({ eventsJournal: true, leases: true });
  });

  it('turn on at exactly 1.3.0 and stay on above it', () => {
    expect(capabilitiesFor('1.3.0')).toEqual({ eventsJournal: true, leases: true });
    expect(capabilitiesFor('2.0.0')).toEqual({ eventsJournal: true, leases: true });
  });

  it('reads a version out of the text bd prints, and is off for one it cannot read', () => {
    expect(capabilitiesFor('bd version 1.3.1 (Homebrew)')).toEqual({ eventsJournal: true, leases: true });
    expect(capabilitiesFor('v1.3.0-rc1')).toEqual({ eventsJournal: true, leases: true });
    expect(capabilitiesFor('dev')).toEqual({ eventsJournal: false, leases: false });
  });
});
