# OpenChamber Beads extension: design

Date: 2026-10-14
Status: approved for build (two builder checks done; user: "continue this work until the extension is built and verified"). v1 ships the CLI adapter only; the serve adapter is deferred because no local project runs beads 1.3.
Research: `docs/research/2026-10-13-beads-gui-inventory.md`
Approved mockups: `.superpowers/brainstorm/95678-1791960993/content/panel-v2-detail.html` (list by epic, list by status, bead detail). Earlier exploration: `panel-layouts.html` (option A chosen).

## Intent

The user builds software with an AI agent inside OpenChamber (the web/desktop UI for OpenCode). The agent tracks work in beads (`bd`), a git-native issue tracker. The user has never used the `bd` CLI and does not want to. Today the beads are invisible unless the user asks the agent about them.

This extension puts the beads next to the agent chat so the user can review, audit, and adjust them without leaving OpenChamber and without ever touching a CLI. OpenChamber already has a native Linear integration; this gives beads a comparable experience.

Who it serves: the user, across every beads project on their machine that they open in OpenChamber (14 local beads projects today: 8 embedded mode, 6 server mode, plus 2 older pre-Dolt SQLite projects; some shared with a team, some private). The first and hardest case is a project shared with a team (embedded, pinned to beads 1.2.2), not the only one. Nothing in the design may be specific to one project. It is built to publishable quality, with a later proposal to OpenChamber for native inclusion.

## The user's job

The agent creates the beads. The user opens the panel mostly to:

1. Review and audit: gut-check that nothing is missing, against their own mental picture (primarily), a plan or spec, or what was discussed in chat.
2. Build their own understanding of the project by reading.
3. Fix things: usually adjusting the context inside an existing bead (description, acceptance criteria, notes), sometimes adding a bead the agent missed.
4. Hand a bead to the agent with its context, instead of fixing it themselves.

Design rule that follows: the whole set must be scannable in a few seconds. Reading quality beats editing breadth.

## Goals

1. A right-rail panel that shows the open project's beads, current and trustworthy.
2. Three views with one row style: by epic (default), by status, and an activity feed.
3. A detail view with the normal content of a ticket.
4. In-panel editing of an existing bead, including its text fields, plus creating a new bead.
5. Send a bead's context to the agent the way OpenChamber does for Linear issues.
6. Honest team sync: show how current the data is, and let the user pull and publish with a button.
7. Zero setup and zero CLI for the user. Works on beads projects as they exist today, without migration or upgrade.

## Borrowed features (user direction: mimic OpenChamber's Linear interactions, and borrow from the beads GUIs in the research, tiered)

v1:
- Keyboard navigation: `j`/`k` move, `/` search, Enter open, Esc back (from bv, mardi-gras).
- "Ready" filter: unblocked work, highest priority first (from bv, perles; `bd ready --json`).
- Add and remove dependencies in the detail view, with kind selection (from scotty, mardi-gras).
- Activity view: a third mode in the header switcher (**Epic | Status | Activity**), a reverse-chronological feed of changes (created, changed fields with old to new, closed, commented), each with who made it and a link to the bead. Unseen entries highlighted. (From beadbox, mardi-gras. My call to include in v1: the user liked it, and it reuses the change detection the panel needs anyway.)
- Launch an agent on a bead (from mardi-gras, openspec), in the Linear style below.

v2 (full-screen page):
- Kanban board with columns by status. A kanban does not fit the rail panel; it lives only on the page.
- Saved searches as groups or columns (from perles).
- Epic swimlanes and a per-epic timeline (from bd-board, beadbox).
- Dependency graph and critical path (from bv, maggie).

Dropped after builder check: human vs agent (👤/🤖) icons. Agents write under the user's own git name (62 of 86 beads in one shared project), so the icons would mislabel exactly what the user audits. See "Attribution".

## Non-goals (v1)

- Full-screen board page (planned v2; must reuse the same row and detail components).
- Kanban or drag-and-drop in the rail panel.
- Dependency graph visualization, graph metrics (critical path, PageRank).
- Molecules, gates, wisps as first-class UI (render them as ordinary beads; do not break on them).
- Cross-project views, saved queries, URL-shareable state.
- Live "being worked on in session X" per bead, and opt-in status comments on session start/finish (v1.1).
- Automatic scheduled team sync (v1.1). v1 syncs on button press only.
- Migrating projects between embedded and server Dolt mode, or upgrading beads. The extension never does either.
- VS Code and mobile (OpenChamber does not load extensions there).

## Anti-goals (failure even if it technically works)

The user named these as reasons they would stop opening the panel:

1. **Out of date.** Stale data shown as current is the worst failure. Freshness must be visible and honest about what it covers (local data vs the team), and staleness must be loud.
2. **Missing context or key data.** The detail view must not hide fields the bead actually has.
3. **Hard to read, organize, or interact with.** Density and legibility of option A are the bar.

Also: never change beads configuration or shared data silently. In many projects, `.beads/metadata.json` and `.beads/config.yaml` are git-tracked and shared with teammates, and the Dolt remote may sit outside branch protection. The extension never edits beads config files, never force-pushes, and never pushes on its own; it pushes only when the user presses Publish. It cannot promise that the user's panel edits stay local until Publish: Dolt pushes all local commits together, and agents that sync after their own bead writes (some teams' agents do) will publish the user's edits too. The panel says so plainly instead of implying otherwise.

## Prerequisites and hard constraints

### Beads

- **Supported:** beads **1.2.2 and newer**, both Dolt modes: **embedded** (the `bd init` default; 8 local projects) and **server**. Pre-Dolt projects (`"database": "beads.db"`) are not supported in v1; the panel says so and does not touch them (a `bd` call could auto-migrate them to Dolt).
- **One `bd` per machine** (`/opt/homebrew/bin/bd`, 1.2.2 today). The version that matters is the installed binary, not a per-project setting (my call). If the user upgrades `bd` while a team project's remote is still on an older format, beads refuses pull and push for that project until the team upgrades; the panel shows "Sync paused: this project's team needs to upgrade beads" and stays readable. The team project is pinned to 1.2.2 until its team agrees to upgrade, so 1.2.2 on embedded is the primary target, not an edge case.
- **Primary access path: the `bd` CLI with `--json`.** It works in every supported version and mode. `bd serve` refuses embedded Dolt permanently (beads v1.3.1 `cmd/bd/serve.go:554`), so it can only be an optional accelerator for server-mode projects on 1.3+.
- Embedded Dolt is single-process; concurrent `bd` calls from the extension and the agent can contend for the lock (see beads-ui issue #78). Reads must be lightweight, retried on lock errors with backoff, and never block the agent. Use `--readonly` for reads where supported.
- **Verified CLI surface on 1.2.2** (builder check):
  - Full snapshot: `bd --readonly export` (one JSON line per bead with labels, dependencies, comments; 250 beads in about 0.5 s).
  - List: `bd list --json --all --flat --limit 0` (defaults hide closed and cap at 50).
  - Detail: `bd list --id <id> --json` plus `bd comments <id> --json`. **Do not use `bd show`**: it rewrites `.beads/last-touched`, which changes which bead the agent's id-less `bd update`/`bd close` act on.
  - `bd ready --json`, `bd statuses --json` (name, category, icon), `bd types --json`.
  - Writes: `--actor <name>` on any command (default `$BEADS_ACTOR`, then git `user.name`, then `$USER`); comments also take `--author`. `bd dep add <a> <b> -t <kind>`; `bd dep remove <a> <b>` takes no kind (removing one of two kinds between the same pair is unclear; builder to verify).
  - `--readonly` works on any command. Parse stdout only; stderr carries extra text.
  - `dolt.auto-commit` is on by default: every write is its own local Dolt commit.
- **Audit log (always on in 1.2.2):** beads writes an `events` row for every bead change (`issue_id, event_type, actor, old_value, new_value, created_at`; types include created, updated, closed, reopened, status_changed, label_added, claimed). It syncs with the remote. It is reachable only via read-only `bd sql` against beads' internal tables. Gaps: no events for comments or dependencies; `events.created_at` stores the writer's local time labeled as UTC (observed offsets of -4 to -8 hours).
- **1.3 events journal:** separate feature, off by default, enabled via `.beads/config.yaml`. Not used or enabled by the extension in v1.
- **First contact side effects:** on the first `bd` call by a newer binary, beads writes `.local_version` and may auto-migrate the database, even for read commands on embedded projects without a remote. Five local projects have not yet been opened by 1.2.2.
- **Telemetry:** beads' anonymous usage metrics are on in the user's `~/.config/bd/config.yaml`; every `bd` call likely sends one event. Polling must be frugal (see Freshness).
- A server-mode project with a fixed `dolt_server_port` fails reads when that server is down; `bd` will not start it.
- Vocabularies are open: statuses (including custom ones), issue types, and dependency kinds. Never hardcode columns or icons without a fallback. Priority is 0 to 4 and 0 is valid (highest).

### Team sync (beads behavior on 1.2.2; a team project's rules as the reference workflow)

- Teammates' changes arrive only via `bd dolt pull` from the project's Dolt remote (find it with `bd dolt remote list --json`).
- Publishing: `bd dolt pull`, then `bd dolt push`; on rejection, pull again and retry (bounded). `bd dolt pull` commits pending local changes itself. Never `--force`.
- `bd dolt push` sends all local commits, the agent's included. "Unpublished" must be computed from Dolt (local commits not on the remote), not from a list of panel edits.
- Merge conflicts: 1.2.2 resolves only trivial conflicts. Any conflict on a bead's fields (likely whenever the same bead was edited on both sides, since every write bumps `updated_at`) is left for an operator:
  - Embedded mode: the pull backs out ("merge aborted and working set restored"); local edits survive, but every later Publish fails until resolved.
  - Server mode over git+https: conflicts stay in the local database, half-merged, which may block the agent's bead writes too.
- Server-mode pulls over git+https run the `dolt` CLI, so the service needs `bd`, `dolt`, and `git` on PATH, and git credentials reachable from HOME.
- Sync controls appear only when the project has a Dolt remote.

### OpenChamber extension SDK (`@openchamber/sdk`, apiVersion 1)

- Docs: `packages/docs/content/docs/extensions.mdx`, `sdk.mdx`, `packages/sdk/API.md`, `GUEST_SERVICES.md` in github.com/openchamber/openchamber.
- Panel is a sandboxed iframe running a pre-built classic IIFE (`panel/main.js`); it cannot reach localhost or run processes. All beads access goes through a `contributes.service` Node process, called via `host.serviceRequest`. The service receives only PATH, HOME, temp, and locale env vars (so `bd` and `git` must resolve via PATH, and git credentials for `bd dolt push` via HOME).
- Service-to-panel streaming is not supported; the panel polls the service. Request timeout 20 s (long-running sync must be started and then polled for status).
- Composer integration: `attach(AttachIssueRequest)` adds a chip to the current composer (`text` up to 16,000 chars is model context; `data` is opaque round-trip). `startSession` creates a session with an attached item, optional worktree, and link. `sessionLink` writes a link snapshot.
- `host.storage` for per-project persisted UI state (64 KiB per value). `host.setBadge(n)` for the rail icon.
- Capabilities needed: `prompt`, `sessions` (exact mapping to methods to be confirmed by the builder from API.md). Service needs `permissions.exec` for `bd` (and `dolt`, `git` if the SDK requires listing indirect executables). The panel learns the project folder from `onDirectory`.
- Install from a local folder during development (git-URL install has an open bug, openchamber#4252).
- Closest reference implementation: github.com/jaythomasonprojects/openchamber-openspec (panel plus service running a CLI, starts sessions from the board). Service pattern: github.com/openchamber/openchamber-extension-docker.

## Experience

### Panel list (approved, mockup panels 1 and 2)

- Header: project name, freshness line (see "Freshness"), search (`/` to focus), view switcher **Epic | Status | Activity**, filter icon (includes "Ready"), unseen-change count, sync control when a remote exists.
- **Group by epic (default):** epics expand into children; each epic row shows priority and an x/y done bar plus a blocked count; children show short hierarchical ids (`.4.2`), title, priority chip, status dot. A trailing "Not in an epic" group holds orphans.
- **Group by status:** collapsible sections In progress, Blocked, Ready, Deferred, Closed (last 7 days), each with a count. Same single-line rows as epic view; the parent epic shows as a dimmed tag on the same line. Custom statuses get their own sections, ordered by their category where known.
- **Activity:** see "Borrowed features".
- Rows changed since the user last looked get a highlight and dot.
- Footer: totals (open, in progress, blocked, closed this week).
- View choice and collapsed state persist per project.

### Bead detail (approved, mockup panel 3)

Drill-in that replaces the list inside the panel.

- Top: back arrow, breadcrumb (epic and short id), status dropdown, open-full-page icon (hidden until the v2 page exists).
- Header: type icon, title, full id with copy, status pill, priority chip, assignee or "unassigned", labels.
- Change banner when changed since last look: "Changed 9m ago by <name>: open to blocked".
- Text sections, collapsible, empty ones hidden: Description, Acceptance criteria, Design, Notes. Render markdown.
- Relationships: parent epic; children with x/y done; Blocked by; Blocks; Related and discovered-from (and any other dependency kind, labeled by its kind). Each row: status dot, short id, title; clicking navigates to that bead.
- Activity: comments thread with an Add comment field; created by and at, updated at, closed at plus close reason.
- Any other populated fields (due, defer until, estimate, external ref, custom metadata) in a compact "More" block rather than dropped.
- Footer: "Attach to" (see "Send to agent").

### Editing

- Inline: status, priority, labels, assignee, dependencies, add comment.
- Text fields (title, description, acceptance criteria, design, notes) via an explicit Edit button per section, so reading never risks accidental edits (my call). Save and Cancel; markdown source editing is fine for v1.
- Conflict check: before writing, re-read the bead; if it changed since the user opened the editor, keep the user's draft, show the current version, and let them re-apply or discard. Never silently overwrite either side. (CLI writes have no server-side precondition, so a narrow race remains; when the `bd serve` path is active, use `expected_version` instead.)
- Every panel write is recorded with a recognizable actor so it can be shown as "you (panel)" (format is the builder's call, for example "<git user.name> (panel)").
- Panel writes pass `--actor "<git user.name> (panel)"` (and `--author` for comments) so they are recognizable as "you (panel)".
- When a remote exists, the header's unpublished count updates after a panel write (computed from Dolt, so it includes the agent's unpushed changes).

### Create

- "New bead" in the panel header: title (required), type, priority, parent epic (defaults to the epic currently in view), description. Everything else is editable after creation in the detail view.

### Attribution

- Source of names: the audit log's `actor` for field changes, `comments[].author`, `dependencies[].created_by`, and `created_by`. Show the recorded name as-is (the user, "Claude Code", teammates' names). Panel writes show as **"you (panel)"**. When no name is available, show "unknown" rather than guess.
- No human vs agent icons in v1. If agents later write under a distinct name, an icon split can be added without redesign.
- People filter: by assignee (any, unassigned, a specific name). No "created by me", since creator names cannot separate the user from their agents.

### Send to agent (mirrors OpenChamber's Linear flow)

Source for the Linear behavior: openchamber v2.3.2 `packages/ui/src/components/sourceBoard/SourceBoardActions.tsx`, `references/ReferencePickerDialog`, `lib/linearIssueContext.ts`, `lib/linkedIssues.ts`, `NewWorktreeDialog.tsx`.

- **Context template** (same shape as Linear's): attachment `text` is `Beads issue context (JSON)\n` followed by pretty-printed JSON `{ issue, comments }`, where `issue` includes parent, children, and dependencies with titles and statuses. Read fresh at attach time. Cap 16,000 chars: drop oldest comments first, then truncate long text fields, never the header fields or acceptance criteria.
- **Attach footer in the detail view**, like Linear's: "Attach to" with **Current session**, **New session**, **New session in worktree...**. Nothing is ever sent automatically; the user writes their message and sends.
  - Current session: `attach` (composer chip; re-attaching the same bead replaces the chip).
  - New session: `startSession` with the attachment, no `text`, navigation `open` (expect `sent: 'skipped'`), which also links the session to the bead.
  - New session in worktree: same, with `worktree: { kind: 'new', name: 'issue-<bead-id>-<slug>' }`, matching Linear's branch naming.
- **+ menu "Link beads issue"** next to the chat box: `contributes.attach: "dialog"` opening a picker with list and preview side by side, arrow keys or Ctrl+N/P to move, Enter attaches the highlighted bead, Shift+Enter multi-selects.
- **Slash command** `/bd <id>` attaches a bead without opening anything (`contributes.commands`).
- **Row context menu** in the panel: Add to chat, Start session, Copy id.
- **Session link**: written via `sessionLink`. OpenChamber shows guest links by identifier only; live bead state on linked sessions is v1.1.

### Linear parity details (match unless noted)

- Row meta like Linear's list row: mono short id, assignee, short relative time (just now, m, h, d, w), sub-issue `x/y`, up to 2 label chips.
- State icons and colors follow Linear's mapping by category: unstarted grey (`open`), started (`in_progress`), completed (`closed`); blocked and deferred get distinct treatments; unknown custom statuses get a neutral fallback. Use OpenChamber's theme tokens from `applyHostReady` (`--oc-*`); the builder must confirm which tokens are exposed.
- Priority: keep the approved P0 to P4 chips rather than Linear's text labels (my call).
- Loading and errors like Linear: stale-while-revalidate; a failed first load shows an error with Retry; a failed refresh keeps the list and shows the error above it. Detail loads after the selection settles (about 250 ms).
- Filters: status (open default, all, per status), assignee, priority, plus "Ready".
- Status pill: dropdown of all statuses for the project (built-ins plus custom), success and failure toasts, re-read after change.
- Comments: Linear's board is read-only for comments; beads goes further with Add comment.

### Freshness (anti-goal 1)

The header shows two separate facts, never blended:

1. **Local:** "Local, refreshed 4s ago". The service re-reads the local beads database on an interval (target: a change the agent makes locally appears within about 5 seconds, tuned to avoid embedded-lock contention).
2. **Team** (only when a remote exists): "Team synced 12m ago" plus "N unpublished" counting all local changes not yet on the remote (the user's and the agent's).

- Polling must be frugal (embedded locks, telemetry per call): check a cheap change signal first (for example the latest Dolt commit) and run the full export only when it moved. Exact mechanism is the builder's call.

- Never label data "Live" in a way that implies it reflects the team.
- If a local refresh fails or exceeds a threshold, the header switches to a visible stale state with the age and a Retry; the list stays readable but marked stale.

### Team sync (user decision: honest local plus buttons)

- **Sync** button: runs `bd dolt pull`, then re-reads. Shows progress and the result; errors in plain language.
- **Publish to team** button (visible when the unpublished count is above zero): first shows a short list of exactly what will go (each unpublished change with its bead, what changed, and who made it, the agent's included), then runs pull, push, on rejection pull and retry (bounded), never force.
- A small note near the count: "Your agent may also publish these when it syncs."
- Both are explicit user actions; the extension never pushes on its own. Scheduled sync is v1.1.

### Sync conflicts (user decision: stop safely, hand to agent)

- On a conflict, stop. Keep all local edits. Never discard, force, or pick a side automatically.
- Show a "Sync needs attention" state listing the conflicting beads (title, both sides' values where readable).
- **Hand to agent** button: attaches a conflict context (project, beads involved, both sides, the exact `bd` commands and messages that failed, and the project's documented sync rules if an AGENTS.md mentions them) to the current chat, using the same attach mechanism as beads. Nothing is sent until the user sends.
- In server mode, if the local database is left half-merged, the panel says writes may be blocked until the conflict is resolved, and disables panel writes for that project until a re-read shows it is clear.
- Per-bead "keep mine / take theirs" buttons are v1.1, after testing beads' merge strategy command.

### Change detection and "since you last looked" (user decision: use the audit log, with fallback)

- **What changed:** the service keeps a snapshot of all beads per project (from `bd --readonly export`) and diffs each refresh against it, producing change events (created, field old to new, closed, deleted, dependency added or removed, comment added). Works on every version and mode, including changes that arrive via Sync.
- **Who changed it:** the service reads beads' always-on audit log (`events` table) with read-only `bd sql` queries, behind the CLI adapter, to attach an actor and timestamp to each field change, including teammates' changes after a pull. Comments and dependencies take their author from `comments[].author` and `dependencies[].created_by`.
- **Schema guard:** before using the audit log, the adapter checks that the table and columns it expects exist. If beads changes them, attribution falls back to "unknown" and the panel keeps working; it never errors because of the audit log.
- **Timestamps:** `events.created_at` is the writer's local time mislabeled as UTC. Do not use it to order or age changes across machines; use it only to match events to diffs, and use snapshot time (when the panel first saw the change) for "Xm ago" unless the builder finds a reliable correction.
- No "turn on change history" prompt: the extension never edits beads config.
- A persisted last-seen snapshot per project (stored by the service on disk under the extension's data location, or `host.storage` if it fits) means changes made while OpenChamber was closed still show as unseen on next open.
- Unseen changes drive row highlights, the detail change banner, the header count, the Activity highlights, and the rail badge (`setBadge`).
- Opening a bead's detail marks it seen; "Mark all seen" clears the rest (my call).

### Setup (zero CLI)

- The service locates the beads workspace for the project open in OpenChamber and detects the `bd` version and Dolt mode itself.
- Missing `bd`, a version older than 1.2.2, no beads workspace, or a pre-Dolt project: a plain-language empty state, never an error dump.
- **First contact (my call):** if the project's `.beads/.local_version` is older than the installed `bd`, the panel does not call `bd` until the user confirms: "This project was last opened with beads X. Opening it here lets beads update it to Y, which may change its files." Confirm is remembered per project.
- A server-mode project whose fixed-port server is down: "This project's beads database server isn't running" with plain guidance; the panel never starts it.
- Server-mode projects on 1.3+ may use `bd serve` if one is already running or can be started without config changes; otherwise the CLI path. The user never chooses.

## Architecture

```
panel/ (sandboxed iframe, IIFE)          service/ (Node, unsandboxed)                     beads
  list, detail, edit, create UI   <-->     provider interface                          <-->  local Dolt (embedded or server)
  activity, sync controls         poll       cli adapter  (bd --json; primary)                and Dolt remote via bd dolt pull/push
  host.attach / startSession      via        serve adapter (bd serve; optional, server mode 1.3+)
  host.storage (UI state)         service-   snapshot store + diff -> change events
                                  Request    last-seen tracking, sync jobs
```

- **Provider interface** (in the service): the only code that talks to beads. Operations: list, get, related, ready, update, create, comment, addDependency, removeDependency, statuses, pull, publish. Two adapters behind it: **CLI adapter** (required, v1) and **serve adapter** (optional; may ship after v1 if time is short, since the CLI adapter covers everything). Returns issues normalized to a Linear-like shape (`identifier`, `title`, `state`, `priority`, `labels`, plus beads extras). A later native OpenChamber port or a generic provider proposal reuses this layer.
- **Snapshot store**: per-project snapshot and last-seen snapshot; diff produces the change events consumed by Activity, highlights, and banners.
- **Service HTTP routes** mirror OpenChamber's Linear routes where sensible (`/issues/list`, `/issues/get`, `/issues/update`), plus `/changes`, `/sync/pull`, `/sync/publish`, `/sync/status`.
- **Panel** is a pure rendering of the normalized shape plus UI state. Row and detail components must be reusable by the v2 full-screen page.
- Look and feel follows OpenChamber's own theme (dark and light), typography, and density; it should feel native, matching its Linear board.

## Development and verification (user decision: private copy)

- Build and test against a **private copy of a real project's beads** in a scratch folder that is never pushed (no Dolt remote configured, or a local throwaway remote to exercise Sync and Publish). Real data, zero risk to the team.
- Also verify against a server-mode workspace: a **scratch copy of another project's beads with its Dolt remote removed**. The original has a live remote on GitHub, so Publish tests there would push to it.
- Exercise Sync, Publish, and both conflict paths (embedded back-out, server half-merge) against local throwaway remotes only.
- Before calling v1 done, a smoke pass across the user's projects: open each one already opened by the installed `bd`, using reads that do not touch `last-touched`, and confirm it loads, shows the correct mode and version state, and renders every status and type it contains. Projects that would trigger first-contact upgrades or are pre-Dolt are checked only for the correct empty or confirm state, without calling `bd`, unless the user says otherwise. No bead writes anywhere real.
- Point the extension at the real project only once it is trustworthy, and only with the user's go-ahead.
- v1 must be verified live in OpenChamber (installed from the local folder), not only in unit tests.

## Decided by the user

- Right-rail panel is the primary surface; full-screen board is a later extra.
- Option A's tree layout and feel, plus a group-by-status mode keeping A's row style.
- The detail view as mocked ("this looks great").
- Both self-fixing (mostly adjusting bead context) and sending bead context to the agent.
- Built for themself first, publishable, possible native OpenChamber contribution later.
- Spec-driven development: this document, then an implementation plan, then build.
- Mimic OpenChamber's native Linear interactions and borrow from the evaluated beads GUIs, split v1 and v2 as above. Kanban only on the full-screen page. Activity feed wanted.
- CLI first, `bd serve` optional (works on embedded mode and beads 1.2.2; no migration or team upgrade).
- Honest local freshness plus Sync and Publish buttons.
- Attribution shows recorded names plus "you (panel)"; no human vs agent icons.
- Develop against a private copy of a real project's beads.
- Works across all of the user's beads projects, not just one.
- Read beads' audit log for attribution, with a schema guard and fallback; no change-history opt-in.
- Sync conflicts: stop safely, keep local edits, "Hand to agent"; per-bead resolution in v1.1.
- "Unpublished" counts all local changes from Dolt; Publish shows exactly what will go; the promise is "the extension never pushes on its own".

## My calls (flag any you disagree with)

1. Extension first, native later; provider layer isolated for portability (OpenChamber's contribution policy and lack of a provider abstraction).
2. Snapshot diffing is the source of truth for what changed; the audit log only adds who and when.
3. Text fields edit behind an Edit button; status, priority, labels, assignee, dependencies edit inline.
4. Re-read-before-write conflict check with a visible conflict state.
5. Opening a bead marks it seen; "Mark all seen" exists.
6. Rail badge shows the unseen-change count.
7. The full Linear-style attach set in v1: Current session, New session, New session in worktree, + menu picker, `/bd <id>`.
8. Any populated field without a dedicated slot appears under "More".
9. Activity view in v1 as a third switcher mode.
10. Keep P0 to P4 chips instead of Linear's text priorities.
11. Live bead state on linked sessions, opt-in status comments, and scheduled sync deferred to v1.1.
12. The serve adapter may slip past v1.
13. The installed `bd` defines the version; "Sync paused, team needs to upgrade" state for upgraded machines.
14. Ask before first contact with a project last opened by an older `bd`; pre-Dolt projects unsupported in v1.
15. Never use `bd show` (it moves the agent's `last-touched` pointer); poll frugally because of embedded locks and beads telemetry.
16. During a server-mode half-merge, panel writes are disabled for that project until clear.

## Left to the builder

- Repo name, location, license, build tooling (the openspec extension uses esbuild for the IIFE panel and a CJS service on Node 22.13+).
- UI framework inside the panel (must compile to a classic IIFE).
- Refresh interval, stale threshold, lock-retry backoff (within the freshness target above).
- Exact `bd` commands per operation within the verified surface above, and the audit-log queries.
- Snapshot storage location and format.
- The cheap change signal used before a full export.
- Bead URL scheme for attachments.
- `bd serve` lifecycle details if the serve adapter ships.
- Test strategy, including fixtures captured from the private project copy.

## Risks and open questions

1. Embedded-lock contention between the extension's reads and the agent's `bd` calls. Validate first with a spike on the private project copy while an agent runs `bd` commands.
2. Export cost on larger projects (about 0.5 s for 250 beads on server mode; embedded unmeasured). Mitigated by the cheap change signal.
3. The audit log is an internal table; a beads upgrade can change it. Mitigated by the schema guard.
4. `bd dolt push` needs git credentials from HOME and `dolt`/`git` on PATH; the reduced service environment may break auth for some setups. Verify on a throwaway remote.
5. Telemetry volume from polling (beads usage metrics are on). Keep `bd` calls per minute low; note it in the README.
6. `bd dep remove` takes no kind; removing one of two dependency kinds between the same pair may be impossible or lossy. Verify before exposing per-kind removal.
5. Enterprise OpenChamber mode restricts extensions with services to admin-listed repos or local folders; publishing must document this.

## Success

- The user opens the (private copy of a) team project in OpenChamber, opens the panel, and within seconds sees every bead grouped by epic, with an honest freshness line, and nothing in a bead hidden.
- A change the agent makes locally appears within about 5 seconds and is highlighted as unseen.
- The user corrects a bead's acceptance criteria in the panel, the agent sees the change, and Publish pushes it to the (throwaway) remote without force.
- The user sends a bead to the chat with one click and the agent receives its full context.
- The user never opens a terminal for any of this.
