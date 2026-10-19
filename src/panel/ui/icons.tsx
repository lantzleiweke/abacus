import type { ComponentChildren } from 'preact';

/** 16-unit stroke icons drawn to match the approved mockups. They inherit `currentColor`. */
function Icon({ size = 14, children }: { size?: number; children: ComponentChildren }) {
  return (
    <svg class="bd-i" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

type P = { size?: number };

export const IconFolder = (p: P) => (
  <Icon {...p}>
    <path d="M2 4.5c0-.6.4-1 1-1h3.2l1.3 1.5H13c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z" />
  </Icon>
);

export const IconSearch = (p: P) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="4.3" />
    <path d="M10.2 10.2l3.3 3.3" />
  </Icon>
);

export const IconFilter = (p: P) => (
  <Icon {...p}>
    <path d="M2.5 3.5h11l-4.2 5v4l-2.6 1.2V8.5z" />
  </Icon>
);

export const IconAlert = (p: P) => (
  <Icon {...p}>
    <path d="M8 2.2l6.2 11H1.8z" />
    <path d="M8 6.6v3M8 11.4v.1" />
  </Icon>
);

export const IconEpic = (p: P) => (
  <Icon {...p}>
    <path d="M8 2l6 3-6 3-6-3z" />
    <path d="M2 8l6 3 6-3" />
    <path d="M2 11l6 3 6-3" />
  </Icon>
);

/** Points down; CSS turns it right when its group is collapsed. */
export const IconChevron = (p: P) => (
  <Icon size={12} {...p}>
    <path d="M4 6l4 4 4-4" />
  </Icon>
);

export const IconMore = (p: P) => (
  <Icon {...p}>
    <path d="M3.5 8h.1M8 8h.1M12.5 8h.1" stroke-width="2.2" />
  </Icon>
);

export const IconCopy = (p: P) => (
  <Icon {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V3.8c0-.7-.6-1.3-1.3-1.3H3.8c-.7 0-1.3.6-1.3 1.3v5.4c0 .7.6 1.3 1.3 1.3h1.7" />
  </Icon>
);

export const IconChat = (p: P) => (
  <Icon {...p}>
    <path d="M2.5 4.2c0-.9.7-1.7 1.7-1.7h7.6c.9 0 1.7.8 1.7 1.7v5c0 .9-.8 1.7-1.7 1.7H7l-3 2.6v-2.6h0c-.9 0-1.5-.8-1.5-1.7z" />
  </Icon>
);

export const IconSession = (p: P) => (
  <Icon {...p}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2.2" />
    <path d="M8 5.5v5M5.5 8h5" />
  </Icon>
);

/** A branch splitting off, for a session in its own worktree. */
export const IconBranch = (p: P) => (
  <Icon {...p}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="5.5" r="1.5" />
    <path d="M4.5 5v6M11.5 7c0 2.5-2 3.2-4.4 3.6-1.2.2-2.2.7-2.6 1.4" />
  </Icon>
);

/** A small spinner for a button whose action is running. */
export const IconSpinner = (p: P) => (
  <Icon {...p}>
    <path class="bd-spin" d="M8 2.5a5.5 5.5 0 1 1-5.5 5.5" />
  </Icon>
);

/** Sync: two arrows chasing round. */
export const IconSync = (p: P) => (
  <Icon {...p}>
    <path d="M13 6.5A5.2 5.2 0 0 0 3.6 5M3 9.5A5.2 5.2 0 0 0 12.4 11" />
    <path d="M3.4 2.6v2.6H6M12.6 13.4v-2.6H10" />
  </Icon>
);

/** Publish: an arrow rising out of a tray. */
export const IconPublish = (p: P) => (
  <Icon {...p}>
    <path d="M8 10.5V2.8M5 5.6l3-3 3 3" />
    <path d="M2.8 9.5v2.7c0 .6.4 1 1 1h8.4c.6 0 1-.4 1-1V9.5" />
  </Icon>
);

export const IconBack = (p: P) => (
  <Icon {...p}>
    <path d="M13 8H3.5M7.5 4l-4 4 4 4" />
  </Icon>
);

export const IconX = (p: P) => (
  <Icon size={12} {...p}>
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </Icon>
);

/** Waiting on something: an hourglass. */
export const IconWait = (p: P) => (
  <Icon {...p}>
    <path d="M4.5 2.5h7M4.5 13.5h7M5.5 2.5c0 3 5 3.5 5 5.5s-5 2.5-5 5.5M10.5 2.5c0 3-5 3.5-5 5.5s5 2.5 5 5.5" />
  </Icon>
);

export const IconEdit = (p: P) => (
  <Icon {...p}>
    <path d="M10.6 3.2l2.2 2.2-7.4 7.4-2.9.7.7-2.9zM9.4 4.4l2.2 2.2" />
  </Icon>
);

export const IconCheck = (p: P) => (
  <Icon {...p}>
    <path d="M3.5 8.5l3 3 6-7" />
  </Icon>
);

export const IconPlus = (p: P) => (
  <Icon {...p}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Icon>
);

/** Two chain links, for a link between beads. */
export const IconLink = (p: P) => (
  <Icon {...p}>
    <path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5l-.8.8M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.8-.8" />
  </Icon>
);

/** A bin, for a bead that was deleted. */
export const IconTrash = (p: P) => (
  <Icon {...p}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2c0 .5.4.8.9.8h4c.5 0 .9-.3.9-.8l.6-8.2" />
  </Icon>
);

export const IconClock = (p: P) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v3.2l2 1.3" />
  </Icon>
);

const TYPE_PATHS: Record<string, ComponentChildren> = {
  bug: <path d="M5.6 5.4a2.4 2.4 0 0 1 4.8 0M4.6 8.8a3.4 3.4 0 0 1 6.8 0v.8a3.4 3.4 0 0 1-6.8 0zM8 7.5V13M2.2 8.6h2.4M11.4 8.6h2.4M2.8 12.6l1.9-1M13.2 12.6l-1.9-1M3.2 4.6l1.7 1.3M12.8 4.6l-1.7 1.3" />,
  feature: <path d="M8 1.8l1.7 3.9 4.1.4-3.1 2.8.9 4.1L8 10.9 4.4 13l.9-4.1-3.1-2.8 4.1-.4z" />,
  task: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.2" />
      <path d="M5.4 8.1l1.9 1.9 3.4-3.7" />
    </>
  ),
  epic: (
    <>
      <path d="M8 2l6 3-6 3-6-3z" />
      <path d="M2 8l6 3 6-3" />
      <path d="M2 11l6 3 6-3" />
    </>
  ),
  chore: <path d="M10.6 2.3a3.1 3.1 0 0 0-2.9 4.1L2.4 11.7l1.9 1.9 5.3-5.3a3.1 3.1 0 0 0 4.1-2.9l-1.9 1.9-1.8-.4-.4-1.8z" />,
  decision: <path d="M8 2l6 6-6 6-6-6zM8 5.5v3M8 10.5v.1" />,
  spike: <path d="M9 1.8L3.8 9H8l-1 5.2L12.2 7H8z" />,
  story: <path d="M3 3.2c1.7-.6 3.4-.4 5 .8 1.6-1.2 3.3-1.4 5-.8v9.5c-1.7-.6-3.4-.4-5 .8-1.6-1.2-3.3-1.4-5-.8zM8 4v9.5" />,
  milestone: <path d="M4 14V2.5M4 3h8.5l-2 3 2 3H4" />,
  incident: (
    <>
      <path d="M8 2.2l6.2 11H1.8z" />
      <path d="M8 6.6v3M8 11.4v.1" />
    </>
  ),
};

/** The bead's type, or a neutral dotted square for types this panel does not know. */
export function TypeIcon({ type, size }: { type: string; size?: number }) {
  const known = Object.prototype.hasOwnProperty.call(TYPE_PATHS, type);
  return <Icon size={size}>{known ? TYPE_PATHS[type] : <rect x="3" y="3" width="10" height="10" rx="2.2" stroke-dasharray="2 1.8" />}</Icon>;
}

/** Put back: an arrow curling back to the left. */
export const IconRestore = (p: P) => (
  <Icon {...p}>
    <path d="M3.5 6.5h6.2a3.3 3.3 0 0 1 0 6.6H6" />
    <path d="M6 3.8L3.3 6.5 6 9.2" />
  </Icon>
);
