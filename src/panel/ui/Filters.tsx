import type { ComponentChildren } from 'preact';
import { classifier, looker, markerOf, statusLabel } from '../list';
import { DEFAULT_FILTERS, filtersActive, useStore, useStoreApi, type Filters as FilterState } from '../store';
import { StatusDot } from './Row';

function Chip({ pressed, onClick, title, children }: { pressed: boolean; onClick(): void; title?: string; children: ComponentChildren }) {
  return (
    <button type="button" class="bd-chip" aria-pressed={pressed} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

function Line({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="bd-fline" role="group" aria-label={label}>
      <span class="bd-flabel" aria-hidden="true">
        {label}
      </span>
      <div class="bd-chips">{children}</div>
    </div>
  );
}

const toggle = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

/** The filter sheet under the tools row: status, assignee, priority, due date, and Ready. Choices persist per project. */
export function Filters() {
  const state = useStore();
  const store = useStoreApi();
  const snapshot = state.snapshot;
  if (!snapshot) return null;
  if (state.view === 'activity') {
    return (
      <div class="bd-filters" role="region" aria-label="Filters">
        <p class="bd-fnote">Filters apply to the Epic and Status views. Activity shows every change; search narrows it.</p>
      </div>
    );
  }
  const f = state.filters;
  const set = (patch: Partial<FilterState>) => store.setFilters({ ...f, ...patch });
  const look = looker(snapshot.statuses);

  // Only statuses some bead has, as the filter sees them (an open bead that is waiting counts as blocked): Beads lists
  // built-ins nobody uses.
  const classify = classifier({ statuses: snapshot.statuses, readyIds: snapshot.readyIds, now: Date.now() });
  const used = new Set(snapshot.beads.map((b) => classify(b).filterAs));
  const order = snapshot.statuses.map((s) => s.name).filter((name) => used.has(name));
  const statuses = [...order, ...[...used].filter((name) => !order.includes(name)).sort()];
  const only = typeof f.status === 'object' ? f.status.only : [];
  const assignees = [...new Set(snapshot.beads.map((b) => b.assignee).filter((a): a is string => !!a))].sort((a, b) => a.localeCompare(b));
  const named = typeof f.assignee === 'object' ? f.assignee.name : null;

  return (
    <div class="bd-filters" role="region" aria-label="Filters">
      <Line label="Status">
        <Chip pressed={f.status === 'open'} onClick={() => set({ status: 'open' })} title="Everything not done, plus what closed in the last 7 days">
          Current
        </Chip>
        <Chip pressed={f.status === 'all'} onClick={() => set({ status: 'all' })} title="Everything, however long ago it closed">
          All
        </Chip>
        <span class="bd-fsep" aria-hidden="true" />
        {statuses.map((name) => (
          <Chip
            key={name}
            title={statusLabel(name, snapshot.statuses) === name ? undefined : name}
            pressed={only.includes(name)}
            onClick={() => {
              const next = toggle(only, name);
              set({ status: next.length ? { only: next } : 'open' });
            }}
          >
            <StatusDot look={look(name)} marker={markerOf(name)} />
            {statusLabel(name, snapshot.statuses)}
          </Chip>
        ))}
      </Line>
      <Line label="Assignee">
        <Chip pressed={f.assignee === 'any'} onClick={() => set({ assignee: 'any' })}>
          Anyone
        </Chip>
        <Chip pressed={f.assignee === 'unassigned'} onClick={() => set({ assignee: f.assignee === 'unassigned' ? 'any' : 'unassigned' })}>
          Unassigned
        </Chip>
        {assignees.map((name) => (
          <Chip key={name} pressed={named === name} onClick={() => set({ assignee: named === name ? 'any' : { name } })}>
            {name}
          </Chip>
        ))}
      </Line>
      <Line label="Priority">
        {[0, 1, 2, 3, 4].map((p) => (
          <Chip key={p} pressed={f.priorities.includes(p)} onClick={() => set({ priorities: toggle(f.priorities, p).sort() })}>
            <span class="bd-pr" data-p={p}>{`P${p}`}</span>
          </Chip>
        ))}
      </Line>
      <Line label="Due">
        <Chip pressed={f.due === 'overdue'} onClick={() => set({ due: f.due === 'overdue' ? 'any' : 'overdue' })} title="Not done, and the due date has passed">
          Overdue
        </Chip>
        <Chip pressed={f.due === 'week'} onClick={() => set({ due: f.due === 'week' ? 'any' : 'week' })} title="Not done, and due in the next 7 days">
          Due this week
        </Chip>
      </Line>
      <Line label="Ready">
        <Chip pressed={f.ready} onClick={() => set({ ready: !f.ready })} title="Open beads with nothing blocking them">
          Only ready to start
        </Chip>
        {filtersActive(f) && (
          <button type="button" class="bd-link bd-freset" onClick={() => store.setFilters(DEFAULT_FILTERS)}>
            Reset filters
          </button>
        )}
      </Line>
    </div>
  );
}
