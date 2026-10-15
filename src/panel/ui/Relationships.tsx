import type { ComponentChildren } from 'preact';
import type { Bead, Dependency, Related } from '../../shared/types';
import { depTime, personName, relationGroups, type RelItem } from '../detail';
import { childId, shortId, type Classified } from '../list';
import { IconX, TypeIcon } from './icons';
import { StatusDot } from './Row';

export type Sub = { done: number; total: number };

type Props = {
  related: Related;
  /** The shown bead's parent id, kept even when the project no longer has that bead. */
  parentId: string | null;
  /** The epic the shown bead sits in (or the bead itself when it is one), for short child ids. */
  root: Bead | null;
  /** The list's copy of a bead, which is fresher than the one read with the detail. */
  current(id: string): Bead | null;
  classify(b: Bead): Classified;
  /** Direct children done of total, or null without children. */
  sub(id: string): Sub | null;
  panel: string | null;
  open(id: string): void;
  /** Removes a link (not parent or child); absent where links cannot be changed. */
  remove?(dep: Dependency): void;
  /** Why links cannot be changed right now. */
  disabled?: string | null;
  /** Links whose removal is in flight (`from>to`). */
  removing?: readonly string[];
  /** Under the groups: the "Add link" row. */
  footer?: ComponentChildren;
};

function Done({ sub, whose }: { sub: Sub; whose: string }) {
  return (
    <span class="bd-sub" data-all={sub.done === sub.total || undefined} title={`${sub.done} of ${sub.total} of ${whose} direct sub-issues done`}>
      {`${sub.done}/${sub.total}`}
    </span>
  );
}

/** Who made a link and when, as recorded. The time is shown as written: Beads stores it in local time. */
function linkNote(item: RelItem, panel: string | null): string | undefined {
  if (!item.dep) return undefined;
  const time = depTime(item.dep.createdAt);
  return `Linked by ${personName(item.dep.createdBy, panel)}${time ? `, ${time}` : ''}`;
}

/** Parent, children, and every kind of link, each row opening that bead. */
export function Relationships({ related, parentId, root, current, classify, sub, panel, open, remove, disabled = null, removing = [], footer }: Props) {
  const groups = relationGroups(related, parentId);
  if (groups.length === 0 && !footer) return null;
  const idFor = (id: string) => (root && id !== root.id ? childId(id, root.id) : shortId(id));
  /** A link row's remove button, for links only (parent and children are not links here). */
  const removeFor = (item: RelItem) =>
    remove && item.dep && item.dep.kind !== 'parent-child' ? (
      <button
        type="button"
        class="bd-relx"
        aria-label={`Remove link to ${item.id}`}
        title={disabled ?? 'Remove link'}
        disabled={disabled !== null || removing.includes(`${item.dep.from}>${item.dep.to}`)}
        onClick={() => remove(item.dep!)}
      >
        <IconX size={11} />
      </button>
    ) : null;

  return (
    <div class="bd-rels">
      {groups.map((group) => {
        const kids = group.key === 'children' ? group.items.map((i) => current(i.id) ?? i.bead).filter((b): b is Bead => b !== null) : [];
        const done = kids.filter((b) => classify(b).look === 'done').length;
        return (
          <div key={group.key} class="bd-rgroup" data-group={group.key} role="group" aria-label={group.label}>
            <div class="bd-rlab" data-tone={group.tone}>
              <b>{group.label}</b>
              {group.key === 'children' && (
                <>
                  <span class="bd-n" title={`${done} of ${kids.length} of this bead's children done`}>{`${done}/${kids.length} done`}</span>
                  <span class="bd-bar" aria-hidden="true">
                    <i data-look="done" style={{ width: `${kids.length ? (done / kids.length) * 100 : 0}%` }} />
                  </span>
                </>
              )}
            </div>
            {group.items.map((item) => {
              const bead = current(item.id) ?? item.bead;
              const note = linkNote(item, panel);
              const x = removeFor(item);
              if (!bead) {
                return (
                  <div key={`${item.id}:${item.dep?.kind ?? ''}`} class="bd-relrow" data-x={x ? true : undefined}>
                    <div
                      class="bd-rel"
                      data-missing
                      tabIndex={0}
                      title={note ?? 'This bead is not in the project any more.'}
                      aria-label={`${item.id}, not in this project${note ? `. ${note}` : ''}`}
                    >
                      <span class="bd-sd" data-look="other" aria-hidden="true" />
                      <span class="bd-id">{item.id}</span>
                      <span class="bd-title">Not in this project</span>
                    </div>
                    {x}
                  </div>
                );
              }
              const c = classify(bead);
              const s = sub(bead.id);
              return (
                <div key={`${item.id}:${item.dep?.kind ?? ''}`} class="bd-relrow" data-x={x ? true : undefined}>
                  <button type="button" class="bd-rel" data-done={c.look === 'done' || undefined} title={note} onClick={() => open(bead.id)}>
                    {group.key === 'parent' ? (
                      <span class="bd-ty" data-type={bead.type} title={bead.type}>
                        <TypeIcon type={bead.type} />
                      </span>
                    ) : (
                      <StatusDot look={c.look} label={c.label} marker={c.marker} />
                    )}
                    <span class="bd-id">{idFor(bead.id)}</span>
                    <span class="bd-title">{bead.title}</span>
                    {s && <Done sub={s} whose={group.key === 'parent' ? "this parent's" : 'its'} />}
                  </button>
                  {x}
                </div>
              );
            })}
          </div>
        );
      })}
      {footer}
    </div>
  );
}
