# Decisions

Choices made while building version 0.1.0, with the reason for each. All were made on 2026-10-14, during the first build. Where a decision has a cost, it is stated. The [architecture](architecture.md) doc describes how the parts work. This one explains why.

1. [Scope and product](#scope-and-product)
2. [Running Beads](#running-beads)
3. [Workspace detection](#workspace-detection)
4. [Snapshots and attribution](#snapshots-and-attribution)
5. [Freshness and polling](#freshness-and-polling)
6. [Writes](#writes)
7. [Sync and Publish](#sync-and-publish)
8. [Attaching to a chat](#attaching-to-a-chat)
9. [Interface](#interface)
10. [Naming and packaging](#naming-and-packaging)
11. [Deferred](#deferred)

## Scope and product

**The panel is built for reading first.** Its user mostly reviews what an agent created, builds an understanding of the project, and fixes context inside an existing bead. So scanning the whole set quickly matters more than breadth of editing.

**An extension first, native later.** OpenChamber has no provider abstraction for issue trackers and has a contribution policy, so the code that talks to Beads is isolated in `src/service/bd/`. A native port would replace that layer and keep the rest.

**Works on projects as they are.** No migration, no Beads upgrade, no setup. The panel never changes `.beads/config.yaml` or `metadata.json`, because in many projects those files are tracked in Git and shared. It never calls `bd dolt remote add` or any command that writes them. (Why: a silent change to shared configuration is worse than a missing feature.)

**Human or agent icons were dropped.** Agents write under the user's own Git name, so an icon would mislabel exactly the thing the user wants to audit. The Activity feed shows the recorded name and "you (panel)" only for the panel's own writes.

**Kanban, a dependency graph and saved searches are not in the panel.** They do not fit the rail width. See [Deferred](#deferred).

## Running Beads

**The `bd` command line is the data path, with `--json`.** It works in every supported version and in both Dolt modes. `bd serve` refuses embedded Dolt, so it could only help some server-mode projects, and v1 does not need it. Cost: each read starts a process.

**Processes are spawned detached, not run with `execFile`.** `execFile` cannot kill a process group, so a timed-out `bd` could leave children running. The rule "no shell, argv arrays" still holds.

**One deadline per call: 18 seconds in total, each attempt `min(15 s, what is left)`.** The host cuts a request off at 20 seconds. Staying under it lets the service say why it failed. Cost: fewer lock retries.

**`runBd` refuses `show` and `--force`.** `bd show` moves `.beads/last-touched`, which the user's own `bd` relies on. A forced command could override a safeguard. A central guard is safer than remembering at each call site.

**Calls for one project are queued.** Embedded Dolt takes one writer, and `bd` makes a second caller wait with its timer running. Queueing in the service makes a slow call a wait instead of a timeout for the one behind it. Reads and writes share the queue. Reads retry at least twice.

**The child environment drops `BEADS_DIR`, `BEADS_DB`, `BEADS_DOLT_SERVER_HOST`, `_PORT`, `_SOCKET`, `BEADS_DOLT_DATA_DIR`, `BEADS_DOLT_SHARED_SERVER`, `GIT_DIR` and `GIT_WORK_TREE`.** The panel must read the folder it was asked about. Passwords pass through. Cost: someone who configures a server only through environment variables must use config files instead.

**SQL in embedded mode runs as `dolt sql -r json -q` inside `.beads/embeddeddolt/<db>/`.** `bd sql` does not work there. Server mode uses `bd --readonly sql --json`. Both are one adapter method, and the direct route skips Beads telemetry.

**Detail reads use `bd --readonly list --all --id <id> --json`.** Without `--all`, `--id` hides closed beads.

**`BdError.message` is developer text.** The panel maps the kind of error to plain wording and shows the raw message only behind "Copy details".

**One write request shares one deadline across its re-read, its write and its final re-read.** User text goes after `--`, except the title, which uses `--title=` because `bd` rejects a dash-leading title even after `--`.

## Workspace detection

**The check order is fixed:** no workspace, pre-dolt, no `bd`, too old, first contact, server down, ready. Cheap file checks come before anything that starts a process.

**Detection runs when a project opens and when the user presses Retry, not on every poll.** Each run starts a `bd` process. A guard that checks the resolved `bd` binary's path and modified time on each refresh catches an upgrade at the cost of one stat.

**First-contact consent is stored per `bd` version.** A newer Beads may update a project's files on first use. Storing the confirmed version means the question comes back after a Beads upgrade, and only then.

**Server-down probes local addresses only** (`127.0.0.1`, `localhost`, `::1`). Cost: a down server on a remote host shows up as a slow `bd` failure.

**Detection failures from a lock or timeout show "busy" wording.** Raw stderr is never shown.

## Snapshots and attribution

**Audit reads are scoped to the changed beads** (`beadIds IN (...)`) instead of using a "since" cursor. Audit ids are not all time-sortable, so a cursor on them is unreliable. Cost: one extra query per refresh that has changes. A request for more than 1,000 events is refused instead of cut silently.

**Audit rows sort by `created_at DESC, id DESC`.** The time of an event comes from the writer when known. A UUIDv7 id carries a real UTC time, so it is used as a fallback.

**One audit event can attribute one change per field it contains.** The feed shows an actor for each field change. Cost: an event could credit a coincidental same-value field.

**"You (panel)" means the recorded actor equals the panel's actor exactly.** No suffix rule. Recorded names are shown as they are.

**The last observed snapshot is stored with the project's state and diffed after a restart.** That is how a change made while the panel was closed still gets an Activity row. Cost: the state file grows by about one export.

**`ChangeEvent.changedAt` is the writer's time and `observedAt` is the service's clock.** The feed shows `changedAt` when it has one.

**Seen state is per bead.** A deleted bead with no seen time counts as unseen until marked seen, so a deletion is not missed. The rail badge counts beads plus unseen deletions. The Activity bar's "N unseen" counts entries.

**A bead moved into a custom done status shows its close reason and time from the latest `closed` event.** `bd` stores neither on the bead. Beads records such a move as closed then reopened, so a reopen straight after a close on the same bead is folded into one entry.

**Deleted events carry the bead's title.** The service keeps it, so the panel needs no title cache.

**Relationships come from the live snapshot** through one shared function, `relatedFor`, in `src/shared`. The panel and the service cannot disagree about them. Link wording follows the bead being viewed: "Link added: blocked by x9".

**The service puts `panelActor` in the snapshot.** "You (panel)" then works even before any activity exists.

**Writes made through the panel are attributed through a hook** (`onPanelWrite`), so a link the panel removes is attributed to the panel and counts as seen.

## Freshness and polling

**The panel polls every 2 seconds and the service throttles its look at the project to once per 4.** Latency is about 4 to 5 seconds. A shorter cycle would cost more `bd` calls and more lock contention.

**The change signal is a cheap database hash.** If `dolt` is missing it falls back to `bd vc status`, and if that fails, a full export at most every 60 seconds with a note.

**A hidden pane polls every 60 seconds instead of stopping.** The rail badge should rise even when the panel is not open. A hidden window still pauses.

**Staleness is loud.** After 30 seconds with no good read, a banner says so with a Retry. Staleness is counted from when the panel started watching, so reopening it does not show a false warning.

**The cursor answer is `unchanged: true`.** A quiet project costs a tiny reply.

## Writes

**Writes refuse while a Sync is running or the project is half merged.** The routes use the workspace root and the same cache the snapshot uses, so a write's marks and its error detail land where the panel reads them.

**A panel write bumps a data generation that skips the 4-second throttle**, and a refresh already running when it happens runs again. This replaced a local copy of the written bead in the panel, which was a second source of truth.

**Updates send `expected` field values as well as `updatedAt`.** `updated_at` has one-second resolution, so a change in the same second would pass the time check.

**A custom done status takes two writes:** close with a reason, then `update --status`. It keeps the rule that "done" comes from the project's status definitions. Cost: two writes.

**A close that Beads refuses is shown, not forced.** "Blocked by open issues" is a real signal.

**Removing a dependency needs no kind.** Beads keeps one link per ordered pair, so per-kind removal was dropped from the interface.

**A create, comment or link that times out is "uncertain".** The panel refreshes and never retries on its own, because a retry could duplicate. Host errors that mean the request may have run (`HOST_TIMEOUT`, `SERVICE_FAILED`, `REQUEST_FAILED`, `RESPONSE_TOO_LARGE`) are treated the same way.

**Labels containing `"` or `,` are rejected.** Beads reads labels as comma-separated text.

**New beads inherit their parent's labels**, as `bd` does. The panel does not pass `--no-inherit-labels` by default.

**A status change shows a success toast.** OpenChamber's Linear integration does, and it confirms the click landed.

**A new bead's parent defaults to the epic under the cursor in the Epic view.**

## Sync and Publish

**Conflicts exist only when the same field changed on both sides.** Different fields of one bead merge.

**The panel never resolves a conflict.** It hands the record to the agent, with the project's own `AGENTS.md` sync rules (only the sync-related section if found, else the first 4,000 characters).

**A pull blocked by uncommitted settings rows becomes a card with "Hand to agent".** The panel does not change settings itself.

**A half-merged server-mode project is handled best effort.** The state was simulated with `dolt sql`, since a real one over git and https was not set up. The handling stays, and it is labelled as untested against the real thing.

**Sync and Publish pass `--actor` with the panel's actor.** They are changes the panel starts, and the history should say so.

**Publish carries `expectedHead` from the preview.** The service refuses with `preview-stale` if the local head has moved, so what goes out is what the user reviewed.

**Before each push the service re-checks that the unpushed set equals the previewed set plus only this job's own merge commits, and that `dolt_status` is empty.** The panel tells the user a few milliseconds of risk remain, because Dolt cannot push up to a named commit and the agent writes outside the panel.

**A Sync or Publish is refused while one runs.** This includes a Publish that arrives during a job.

**Spawning for sync survives bad input.** A NUL byte or a too-long argument list used to risk a crash. Titles flow into arguments, so the fix was folded in. A crash from running out of file handles was folded in too, since one crash would take every panel down.

## Attaching to a chat

**Starting a session in a worktree links the session and shows a `/bd <id>` tip.** It adds no chip, because the host unmounts the panel when the worktree session opens. The tip is shown before the start and is copyable.

**The picker attaches one bead at a time.** The host holds one chip per dialog open, so multi-select was removed.

**New sessions are linked by `startSession` itself.** "Add to current chat" only attaches, as OpenChamber's Linear integration does.

**Wording is "Current chat" and "Add to current chat"**, and the toast button reads "Copy details".

**The worktree is named `issue-<id>-<slug>`**, with a slug of at most 40 characters.

## Interface

**"Beads" is the product and "beads" are the issues.** They are product words, not jargon, so a suggestion to replace them was declined.

**Blocked means status blocked, or open and not ready with no future defer date.** A future defer date puts a bead under Deferred. Custom in-progress statuses get their own sections.

**Custom statuses are humanized** ("In review") with the raw name in a tooltip. Unknown ones show raw.

**The default "Current" filter includes beads closed in the last 7 days.** The user sees what just finished.

**Filter chips use the same classifier as the sections.** A chip count and a section count cannot disagree.

**"Closed this week" counts custom done statuses**, since it measures throughput.

**Each section is its own listbox.** It is a valid accessible structure.

**The change banner uses an arrow** ("open → in progress"), hidden from screen readers, with a visually hidden "to".

**The Activity bar's "N unseen" counts entries.** The badge counts beads.

**Search placeholder is always "Search beads"** (the count lives in the aria label), so it does not wrap at panel width. It becomes "Search" when the unseen chip is shown.

**The header holds two freshness lines** (`min-height` 46 px), so it does not jump when the team line appears.

**Ruling: Enter affirms a confirm question (Discard), unless a button has focus.**

**Bundle size is accepted for v1.** Minifying is tracked separately.

## Naming and packaging

**Fixtures that came from a real project are never committed.** They live in the git-ignored `test/fixtures-private/`, and tests that need them skip when absent. Only synthetic, seeded fixtures are committed (`test/fixtures/`).

**Preact 10, TypeScript 5 and `@types/node` 22** are the pinned majors.

**The built bundles are committed**, because OpenChamber does not build extensions.

**The extension is called Abacus.** The panel id and the provider id stay `beads`, and the storage folder stays `openchamber-beads`, so saved state and attached chips survive the rename.

## Deferred

Not done in 0.1.0. Some are known limits, some are plans.

**Known limits**

- **Clock skew.** The panel compares its own clock with service times when it settles a write and when it shows ages. It assumes one clock.
- **A change that only moves a bead's stored version** (its `updatedAt`, close reason or extra keys) marks the bead unseen with no Activity row.
- **A down server on a remote host** shows as a slow failure, not as "This project's Beads server isn't running."
- **Half-merged server mode** is best effort and tested only against a simulated state.
- **A Publish and the agent's writes** can overlap in a window of a few milliseconds. The sheet discloses it.
- **The loading header** now has the same buttons and freshness box as the loaded one, so it no longer shifts at 310px. When the project has unseen beads, the switcher still moves left once to make room for the count, which the panel cannot know before the first answer. At narrow widths the search hint hides instead of clipping.
- **In the dark theme, the strikethrough on a deleted bead's title reads faint.**
- **The first Publish into an empty team copy** is a one-time job for the agent.

**Found in the live check and left for later** (see [verification](verification.md))

- When a repository has no Git `origin`, the chip's "Open in the browser" link pointed at `https://beads.invalid/...`, which went nowhere. Fixed: it now opens the user guide's [Beads with no web page](user-guide.md#beads-with-no-web-page) section. OpenChamber always shows that link and requires an https address, so the extension cannot hide it.
- OpenChamber identifies projects by their first Git commit, so a copy of a repository shares the original's project.

**Beads limits seen live**

- Setting a custom done status after the close makes Beads clear the bead's close time and reason. The panel still asks for a reason, because the close and its reason stay in Beads' audit log and Activity shows them ("Closed as <status> · <reason>").

**Planned**

- A full-screen board page (kanban, epic swimlanes, a timeline, a dependency graph and critical path). It would reuse the same row and detail components.
- Saved searches.
- Scheduled team sync. v1 syncs on a button press only.
- A `bd serve` adapter for server-mode projects on newer Beads versions.
- Showing which session is working on a bead, and opt-in status comments when a session starts or finishes.
- Moving projects between embedded and server mode, or upgrading Beads. The extension will not do either.
- VS Code and mobile. OpenChamber does not load extensions there.
