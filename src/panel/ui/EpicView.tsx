import type { EpicGroup, Progress } from '../list';
import { shortId } from '../list';
import { IconChevron } from './icons';
import { BeadRow, Row, type RowEvents } from './Row';

/** Done, in progress and blocked as one thin stacked bar. */
function Bar({ progress }: { progress: Progress }) {
  const share = (n: number) => `${progress.total ? (n / progress.total) * 100 : 0}%`;
  return (
    <span class="bd-bar" aria-hidden="true">
      <i data-look="done" style={{ width: share(progress.done) }} />
      <i data-look="progress" style={{ width: share(progress.inProgress) }} />
      <i data-look="blocked" style={{ width: share(progress.blocked) }} />
    </span>
  );
}

function ProgressLine({ progress, changed }: { progress: Progress; changed: number }) {
  return (
    <div class="bd-prog">
      <Bar progress={progress} />
      {progress.total === 0 ? (
        <span>Nothing in it yet</span>
      ) : (
        <span title={`${progress.done} of ${progress.total} beads in this epic done`}>{`${progress.done}/${progress.total} done`}</span>
      )}
      {progress.blocked > 0 && <span class="bd-prog-blk">{`${progress.blocked} blocked`}</span>}
      {changed > 0 && <span class="bd-prog-new">{`${changed} changed`}</span>}
    </div>
  );
}

/** Focus and active-descendant attributes for one section's listbox; the list decides which box holds the cursor. */
export type BoxAttrs = (key: string) => { tabIndex: number; 'aria-activedescendant'?: string };

type Props = RowEvents & { groups: EpicGroup[]; toggle(key: string): void; box: BoxAttrs };

export const headerId = (key: string) => `bd-h-${key}`;

/**
 * Epics expand into their children (short ids relative to the epic); "Not in an epic" holds the rest. Each group is
 * its own listbox, so the collapse control sits beside the options rather than inside one.
 */
export function EpicView({ groups, toggle, box, ...events }: Props) {
  return (
    <>
      {groups.map((group) => {
        const { epic } = group;
        const rows = group.rows.map((row) => <Row key={row.bead.id} row={row} dot {...events} />);
        if (!epic) {
          return (
            <section key={group.key} class="bd-orphans" data-collapsed={group.collapsed || undefined}>
              <button type="button" class="bd-sect" aria-expanded={!group.collapsed} onClick={() => toggle(group.key)}>
                <span class="bd-chev">
                  <IconChevron />
                </span>
                <span id={headerId(group.key)}>Not in an epic</span>
                <span class="bd-n">{group.count}</span>
                {group.changed > 0 && <span class="bd-ux">{`${group.changed} changed`}</span>}
              </button>
              {rows.length > 0 && (
                <div role="listbox" aria-labelledby={headerId(group.key)} {...box(group.key)}>
                  {rows}
                </div>
              )}
            </section>
          );
        }
        return (
          <section key={group.key} class="bd-epic" data-collapsed={group.collapsed || undefined}>
            <button
              type="button"
              class="bd-chev bd-epic-chev"
              aria-expanded={!group.collapsed}
              aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} ${epic.title}`}
              onClick={() => toggle(group.key)}
            >
              <IconChevron />
            </button>
            <div role="listbox" aria-label={epic.title} {...box(group.key)}>
              <BeadRow
                {...events}
                variant="epic"
                bead={epic}
                id={shortId(epic.id)}
                look={group.look}
                label={epic.status}
                marker="builtin"
                depth={0}
                unseen={group.unseen}
                context={group.context}
                dot={false}
                below={group.progress && <ProgressLine progress={group.progress} changed={group.changed} />}
              />
              {rows}
            </div>
          </section>
        );
      })}
    </>
  );
}
