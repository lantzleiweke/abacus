import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Bead } from '../../shared/types';
import { initials, shortAgo } from '../format';
import { shortId, type Look, type Marker, type Row as RowModel, type Sub } from '../list';
import { IconBranch, IconChat, IconCopy, IconEpic, IconMore, IconSession, TypeIcon } from './icons';

/**
 * Status icon by look, in the marker's shape: built-ins as Linear draws them, Beads' extras (pinned, hooked) as a
 * square, project statuses as a diamond, so none borrows another's icon. `label` names the status in words; leave it
 * out where nearby text already says it.
 */
export function StatusDot({ look, label, marker = 'builtin' }: { look: Look; label?: string; marker?: Marker }) {
  const marks = { class: 'bd-sd', 'data-look': look, 'data-marker': marker === 'builtin' ? undefined : marker };
  return label ? <span {...marks} role="img" aria-label={label} title={label} /> : <span {...marks} aria-hidden="true" />;
}

/** The P0 to P4 chip. A bead with no priority keeps the slot empty so the columns stay aligned. */
export function Priority({ value }: { value: number | null }) {
  if (value === null) return <span class="bd-pr" data-p="none" aria-hidden="true" />;
  return (
    <span class="bd-pr" data-p={value} title={`Priority ${value}`}>
      P{value}
    </span>
  );
}

/** Assignee as initials (full name on hover), or an empty slot. */
function Who({ name }: { name: string | null }) {
  if (!name) return <span class="bd-who" data-none aria-hidden="true" />;
  return (
    <span class="bd-who" title={name} aria-label={`Assigned to ${name}`} role="img">
      {initials(name)}
    </span>
  );
}

/** Sub-issues done of total, like Linear's row meta. */
function SubCount({ sub }: { sub: Sub }) {
  return (
    <span class="bd-sub" data-all={sub.done === sub.total || undefined} title={`${sub.done} of ${sub.total} direct sub-issues done`}>
      {`${sub.done}/${sub.total}`}
    </span>
  );
}

/** Titles this short always fit the tag. */
const TAG_FITS = 12;

/** The parent epic in the status view: its title where at least about 10 characters fit, otherwise its short id. */
function EpicTag({ epic }: { epic: Bead }) {
  const fits = epic.title.length <= TAG_FITS;
  return (
    <span class="bd-ep" data-fits={fits || undefined} title={epic.title}>
      <IconEpic size={11} />
      <em class="bd-ep-name">{epic.title}</em>
      {!fits && <em class="bd-ep-id">{shortId(epic.id)}</em>}
    </span>
  );
}

export const rowDomId = (id: string) => `bd-row-${id}`;

/** Where the row menu opens: its row's vertical extent, and the left edge to aim for. */
export type MenuAt = { id: string; x: number; top: number; bottom: number };

const MENU_W = 176;

/** Under the row, right-aligned to `anchor` (the row's menu button, or the row). */
export const menuFor = (id: string, row: Element, anchor: Element = row): MenuAt => {
  const r = row.getBoundingClientRect();
  return { id, x: anchor.getBoundingClientRect().right - MENU_W, top: r.top, bottom: r.bottom };
};

export type RowEvents = {
  cursor: string | null;
  selectedId: string | null;
  now: number;
  pick(id: string): void;
  menu(at: MenuAt): void;
};

type RowProps = RowEvents & {
  bead: Bead;
  id: string;
  look: Look;
  label: string;
  marker: Marker;
  depth: number;
  unseen: boolean;
  context?: boolean;
  /** Draw the status icon (the status view moves it to the section header). */
  dot: boolean;
  epic?: Bead | null;
  sub?: Sub | null;
  variant?: 'epic';
  /** More of the option under its line (the epic's progress), so the listbox holds options only. */
  below?: ComponentChildren;
};

export function BeadRow(p: RowProps) {
  const { bead } = p;
  const updated = Date.parse(bead.updatedAt);
  return (
    <div
      role="option"
      id={rowDomId(bead.id)}
      class="bd-row"
      data-variant={p.variant}
      aria-selected={p.selectedId === bead.id}
      data-selected={p.selectedId === bead.id || undefined}
      data-cursor={p.cursor === bead.id || undefined}
      data-unseen={p.unseen || undefined}
      data-done={p.look === 'done' || undefined}
      data-context={p.context || undefined}
      style={{ '--l': p.depth }}
      onClick={() => p.pick(bead.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        const row = e.currentTarget;
        p.menu({ ...menuFor(bead.id, row), x: e.clientX });
      }}
    >
      {p.dot && <StatusDot look={p.look} label={p.label} marker={p.marker} />}
      <span class="bd-ty" data-type={bead.type} title={bead.type}>
        <TypeIcon type={bead.type} />
      </span>
      <span class="bd-id">{p.id}</span>
      <span class="bd-title">{bead.title}</span>
      {bead.labels.slice(0, 2).map((label) => (
        <span key={label} class="bd-lb">
          {label}
        </span>
      ))}
      {p.epic && <EpicTag epic={p.epic} />}
      {p.sub && <SubCount sub={p.sub} />}
      <Priority value={bead.priority} />
      <Who name={bead.assignee} />
      <time class="bd-age" dateTime={bead.updatedAt} title={`Updated ${bead.updatedAt}`}>
        {Number.isFinite(updated) ? shortAgo(p.now - updated) : ''}
      </time>
      <button
        type="button"
        class="bd-rowmore"
        aria-label="More actions"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          const button = e.currentTarget;
          p.menu(menuFor(bead.id, button.closest('.bd-row') ?? button, button));
        }}
      >
        <IconMore />
      </button>
      {p.below}
    </div>
  );
}

/** A data row in either view. */
export const Row = ({ row, dot, ...events }: RowEvents & { row: RowModel; dot: boolean }) => (
  <BeadRow
    {...events}
    bead={row.bead}
    id={row.id}
    look={row.look}
    label={row.label}
    marker={row.marker}
    depth={row.depth}
    unseen={row.unseen}
    context={row.context}
    epic={row.epic}
    sub={row.sub}
    dot={dot}
  />
);

export type RowActions = {
  addToChat(id: string): void;
  startSession(id: string): void;
  startInWorktree(id: string): void;
  copyId(id: string): void;
  /** No chat is open, so Add to current chat has nowhere to go. */
  noChat?: boolean;
  /** An action is running: the agent items wait for it. */
  busy?: boolean;
};

/** Why the menu closed: from the keyboard or a chosen item (focus goes back to the row), or a click elsewhere. */
export type MenuClose = 'keyboard' | 'item' | 'outside';

/** An item a view adds above the usual ones (an Activity row's Restore). `off` says why it cannot run. */
export type MenuExtra = { label: string; icon: ComponentChildren; run: () => void; off?: string };

/**
 * Add to current chat, Start session, Start in worktree, Copy ID for one bead. Opens under its row (above when there is no room), so the row's
 * title stays in view. Arrow keys move; Escape, Tab, or a click outside closes.
 */
export function RowMenu({ at, actions, extra = [], onClose }: { at: MenuAt; actions: RowActions; extra?: MenuExtra[]; onClose(why: MenuClose): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const menu = ref.current;
    const width = window.innerWidth || Infinity;
    const height = window.innerHeight || Infinity;
    const h = menu?.offsetHeight ?? 0;
    const below = at.bottom + 2;
    const top = below + h <= height - 4 || at.top - h - 2 < 4 ? below : at.top - h - 2;
    setPlace({ left: Math.max(4, Math.min(at.x, width - MENU_W - 4)), top: Math.max(4, top) });
  }, [at]);

  useEffect(() => {
    const menu = ref.current;
    menu?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const outside = (e: Event) => {
      if (menu && !menu.contains(e.target as Node)) onClose('outside');
    };
    const blur = () => onClose('outside');
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', blur);
    };
  }, [onClose]);

  const busy = actions.busy === true;
  const items: Array<MenuExtra & { rule?: true }> = [
    ...extra,
    { label: 'Add to current chat', ...(extra.length ? { rule: true as const } : {}), icon: <IconChat />, run: () => actions.addToChat(at.id), off: actions.noChat ? 'No open chat' : undefined },
    { label: 'Start session', icon: <IconSession />, run: () => actions.startSession(at.id) },
    { label: 'Start in worktree…', icon: <IconBranch />, run: () => actions.startInWorktree(at.id) },
    { label: 'Copy ID', icon: <IconCopy />, run: () => actions.copyId(at.id) },
  ];
  const agentItem = (label: string) => label !== 'Copy ID' && !extra.some((x) => x.label === label);

  const onKeyDown = (e: KeyboardEvent) => {
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (n: number) => buttons[(n + buttons.length) % buttons.length]?.focus();
    if (e.key === 'ArrowDown') focus(i + 1);
    else if (e.key === 'ArrowUp') focus(i - 1);
    else if (e.key === 'Home') focus(0);
    else if (e.key === 'End') focus(buttons.length - 1);
    else if (e.key === 'Escape' || e.key === 'Tab') onClose('keyboard');
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={ref}
      class="bd-menu"
      role="menu"
      aria-label={`Actions for ${at.id}`}
      style={place ? { left: `${place.left}px`, top: `${place.top}px` } : { visibility: 'hidden', left: '0px', top: '0px' }}
      onKeyDown={onKeyDown}
    >
      {items.map(({ label, icon, run, off, rule }) => [
        rule && <div key={`${label}-rule`} class="bd-menu-rule" role="separator" />,
        <button
          key={label}
          type="button"
          role="menuitem"
          class="bd-menu-item"
          disabled={off !== undefined || (busy && agentItem(label))}
          title={off}
          onClick={() => {
            onClose('item');
            run();
          }}
        >
          {icon}
          <span>{label}</span>
          {off && <span class="bd-menu-off">{off}</span>}
        </button>,
      ])}
      <div class="bd-menu-id">{at.id}</div>
    </div>
  );
}
