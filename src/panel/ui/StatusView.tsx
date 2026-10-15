import type { Section } from '../list';
import { headerId, type BoxAttrs } from './EpicView';
import { IconChevron } from './icons';
import { Row, StatusDot, type RowEvents } from './Row';

type Props = RowEvents & { sections: Section[]; toggle(key: string): void; expand(key: string): void; box: BoxAttrs };

/**
 * Collapsible sections by status, each with a count; the status icon sits on the header and rows carry their epic as a
 * tag. Each section's rows are a listbox labelled by its header.
 */
export function StatusView({ sections, toggle, expand, box, ...events }: Props) {
  return (
    <>
      {sections.map((s) => (
        <section key={s.key} class="bd-grp" data-collapsed={s.collapsed || undefined}>
          <button
            type="button"
            class="bd-grp-h"
            aria-expanded={!s.collapsed}
            title={s.status ?? undefined}
            onClick={() => toggle(s.key)}
          >
            <span class="bd-chev">
              <IconChevron />
            </span>
            <StatusDot look={s.look} marker={s.marker} />
            <span class="bd-grp-title" id={headerId(s.key)}>
              {s.title}
            </span>
            <span class="bd-n">{s.count}</span>
            {s.changed > 0 && <span class="bd-ux">{`${s.changed} changed`}</span>}
          </button>
          {s.rows.length > 0 && (
            <div role="listbox" aria-labelledby={headerId(s.key)} {...box(s.key)}>
              {s.rows.map((row) => (
                <Row key={row.bead.id} row={{ ...row, depth: 1 }} dot={false} {...events} />
              ))}
            </div>
          )}
          {s.more > 0 && (
            <button type="button" class="bd-morerows" onClick={() => expand(s.key)}>
              {`Show ${s.more} more`}
            </button>
          )}
        </section>
      ))}
    </>
  );
}
