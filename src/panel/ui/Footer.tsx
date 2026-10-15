import { totals } from '../list';
import { useNow, useStore } from '../store';

/** Project totals, whatever the filters show: open (not done), in progress and blocked (as the status view's sections count them), closed this week. */
export function Footer() {
  const snapshot = useStore().snapshot;
  const now = useNow(60_000);
  if (!snapshot) return null;
  const t = totals({ beads: snapshot.beads, statuses: snapshot.statuses, readyIds: snapshot.readyIds, now });
  return (
    <footer class="bd-foot">
      <span>
        <b>{t.open}</b> open
      </span>
      <span>
        <b>{t.inProgress}</b> in progress
      </span>
      <span data-tone={t.blocked > 0 ? 'blocked' : undefined}>
        <b>{t.blocked}</b> blocked
      </span>
      <span>
        <b>{t.closedThisWeek}</b> closed this week
      </span>
    </footer>
  );
}
