import type { Capabilities } from '../shared/types';
import { compareVersions, parseVersion } from './workspace';

const MIN_1_3: [number, number, number] = [1, 3, 0];

/** What a bd version can do: the events journal and leases arrive in 1.3.0. An unreadable version gets nothing. */
export function capabilitiesFor(bdVersion: string): Capabilities {
  const version = parseVersion(bdVersion);
  const modern = version !== null && compareVersions(version, MIN_1_3) >= 0;
  return { eventsJournal: modern, leases: modern };
}
