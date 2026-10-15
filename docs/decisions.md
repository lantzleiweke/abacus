# Decisions

Choices made while building Abacus, with the reason for each. The 0.1.0 decisions are first, and were made on 2026-10-14, during the first build. The [0.2 section](#02) follows them. Where a decision has a cost, it is stated. The [architecture](architecture.md) doc describes how the parts work. This one explains why.

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
12. [0.2](#02)

## Scope and product

**The panel is built for reading first.** Its user mostly reviews what an agent created, builds an understanding of the project, and fixes context inside an existing bead. So scanning the whole set quickly matters more than breadth of editing.

**An extension first, native later.** OpenChamber has no provider abstraction for issue trackers and has a contribution policy, so the code that talks to Beads is isolated in `src/service/bd/`. A native port would replace that layer and keep the rest.

**Works on projects as they are.** No migration, no Beads upgrade, no setup. In 0.1.0 the panel never changed `.beads/config.yaml` or `metadata.json`, because in many projects those files are tracked in Git and shared. It never calls `bd dolt remote add` or any command that writes them. (Why: a silent change to shared configuration is worse than a missing feature.) 0.2 has two exceptions, and each needs your click: [Live updates](#live-updates) writes one setting, and [Update project](#update-project) updates an older project once.

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

**Ruling: with Beads 1.3, Activity names who made a change only for changes made on this computer.** Beads 1.3 stops sharing its `events` table between clones, so a change that arrived with a Sync has no recorded name here and shows without one. The panel does not guess a name. Event times come from `created_at`, read as UTC, for a store written by Beads 1.3 or later; Beads 1.2 event ids carry the time and are still read from the id.

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

**Ruling: when Beads 1.3 settles two edits to the same field on its own, the panel says so.** Beads keeps the newer edit and reports it on a successful Sync. A Sync or Publish that did this still ends clean, and its toast names the beads and fields whose older edit was replaced ("Both sides edited the same thing, so the newer edit was kept"), with Copy for the raw text. A bead deleted on one side and edited on the other is still not settled by Beads: it stays a conflict and is handed to the agent. Cost: the notice is on the end-of-job toast only, so it is not shown for a job that ends in an error after the merge, or for a Sync the agent runs. A lasting notice on the team line would be a design call.

**Ruling: a bead someone holds in In progress cannot be reassigned until it leaves In progress.** Beads 1.3 refuses it. The panel runs the status move first, then the rest of the edit, and when Beads still refuses it says who holds the bead and what to do, without ever overriding the hold.

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

## 0.2

Choices made while building 0.2, on 2026-10-14 and 2026-10-15. Each says what was decided, why, and what it costs if it is wrong. The first nine were the design's open calls. The rest were settled as the work met real Beads behavior.

### The design's nine calls

1. **A plan approval is a human gate whose reason starts with fixed words.** Beads has no "plan" kind of gate. A review gate with a known reason prefix lets the panel say "Plan" and "Approve", and lets an agent read it the same way. Cost: someone who types that prefix by hand makes a review look like a plan, and a person who removes the prefix in `bd` turns a plan into a plain review. The panel does not guard against either.
2. **Needs me is the view the panel opens on when it has something in it.** A person who comes back to the panel wants to know what waits on them before anything else. The rail badge keeps meaning "unseen beads", so the two numbers do not compete. An automatic opening is not saved as your choice. Cost: someone who prefers Epic sees another view first on days with work waiting. They press the Epic tab once, and the panel remembers that only if they pick it.
3. **A bead is stuck after 3 days without an update, per project. Keep hides it for 7 days.** Three days is long enough that agent work is not flagged by a slow afternoon. The number is a project setting, 1 to 30. Keep is stored on this computer and writes nothing to Beads, so a teammate's panel is unaffected. Cost: a threshold that is too low floods Stuck. A kept bead returns after 7 days even if you meant it forever.
4. **Memories live on a page behind the project menu, not in a view tab.** They are written rarely and read by agents, not people, so they do not earn a place next to the views you use all day. Cost: they take one more click to find.
5. **The beads that hold a review are kept out of the Epic and Status lists and counts.** Beads stores a gate as a bead of its own. Shown, each review would be one more row of work that cannot be started. Cost: the gate has no row of its own. You reach it from the bead it blocks, and from Needs me.
6. **Live updates are on only when the person turns them on, per project, after a confirmation.** Turning them on writes `.beads/config.yaml`, a file many teams commit. Every earlier version of the panel left that file alone, so changing it needs an explicit yes. Cost: most people will not find the setting, and keep polling every few seconds.
7. **A tick in the acceptance checklist rewrites only that line.** The edit is the one the person made and no more. It still goes through the same re-read-before-write check, so a concurrent edit to the text refuses it. Cost: a checklist item written another way (a `*` bullet, a numbered list) is not tickable.
8. **0.2 was built on its own branch in a separate working copy.** It touched the service, the panel and the bundles at once, and the main branch had to stay releasable for fixes. Cost: a merge at the end that has to be read carefully, since the built bundles are committed.
9. **Settings live in a project menu in the header.** The settings are per project (Stuck days, Live updates) and the project name is where a person already looks for "which project is this". Where Keep is stored (this computer, per project) follows the same rule. Cost: a setting under a name that does not look clickable is easy to miss. The name has a small arrow to say it opens.

### Needs me, reviews and stuck work

**A bead is in Needs me once per section, and "waiting" beats "asked".** A bead that is both under a review and a request for help appears under "Waiting for your review" only. Cost: the question stays hidden until the review is done.

**An expired lease counts as stuck.** A bead whose holder's claim has run out shows under Stuck even if it was updated today. A claim that has run out means nobody is working on it. Cost: a long run by an agent that never refreshed its claim looks stuck. It is one click to Keep.

**A review an agent resolves shows under "Changed since you looked", not Waiting.** There is nothing left to do, and it does not deserve a place that means "do something". Cost: it can be missed if you never open that section.

**Respond and Dismiss refuse when the request is blocked.** They follow `bd close` exactly, including blockers from waits-for links and from a parent that waits on a review. The panel must not be a way around a review. Cost: a request that is blocked for a reason you consider silly cannot be answered here. The panel says what it waits on.

**A `human` bead in a done-category custom status counts as closed.** It is not asking anything any more.

**Dismiss writes no comment.** It closes the request, and Dismiss with a reason is there for words. A silent dismiss is quick and honest about what it is. Cost: the agent learns that its request was closed and not why.

**Respond and Dismiss do not repeat `bd close`'s refusal for pinned beads, templates and beads assigned to someone else.** They check blockers and the rest is left to Beads' own answer. Cost: a pinned or template help request could be closed from the panel where `bd close` would refuse. That is a rare shape of bead for a help request.

**A close that Beads refuses because open children remain is shown as "blocked".** One wording for the one idea, for both a gate and a child.

**Gate-creating actions read "Ask for a review" and "Ask for plan approval". "Approve" only resolves a plan.** A button should say what it does to the bead. "Approve" on the thing that creates the request would say the opposite. "Gate" does not appear in the panel's wording: the history says "Review resolved by <name>", "Review deleted" and "Review removed from this bead".

**The first click acts, and "Add a reason" is a quieter second way in.** A row that always opened a form would turn a one-second job into a three-step one. Cost: a person can resolve a review with no words and the agent gets none.

**The upgrade from 0.1 does not show a "Deleted" row for each review.** The first snapshot after the upgrade takes reviews out the way later ones do, so the change feed is not flooded with beads that were never deleted.

### History and Restore

**History is read when the section opens.** It costs nothing until asked. Cost: the first open waits for a read.

**History names who made a change only when Beads recorded it on this computer.** In 1.3 the table that holds that is local to each copy of the project, so a change that came in with a Sync has no name here. The panel joins the versions to the audit rows only when a recorded value matches what was written, and says "someone else or another computer" otherwise. The tighter join shows an honest "unknown" more often instead of crediting a coincidence. Cost: more entries without a name.

**A close or a reopen has no name in History.** `bd close` records no value Beads can tie to a version, so the panel would be guessing.

**Review events in History come from the gates' own audit rows.** They are the only record of who asked and who resolved.

**Restore is an ordinary edit.** It re-reads, checks the field's current value against the one you saw, and writes only that field. When the field has been changed again since, nothing is written until you see the diff and press "Restore anyway". A test restores a text field and is refused after a newer edit. Cost: two clicks when the bead has moved on, which is the point.

**A long text is never restored from History.** Only its start is read, so putting it back would write a cut text. Cost: a long description cannot be reverted from here.

**Labels are not listed in History.** Beads keeps no record of them that the panel can read.

**Forget in Memories is recoverable.** "Forgot <name>. Undo" re-adds the same name and text, because a forgotten memory is a lost instruction for every agent and a confirm dialog is not enough protection against a slip. Cost: Undo fails if the name has been taken, and then shows the text so it is not lost.

### Memories

**Memories are written with Cmd or Ctrl+Enter, and Enter is a new line.** They are often several lines. The Name field adds on Enter, since it is one line.

**A memory over 4,000 characters is refused, not cut.** Cutting a memory silently changes what every session is told.

**A memory is changed or forgotten only when its text is still the text you saw.** It is the same rule as every other edit, here with higher stakes.

**The newest change comes first.** It is the one a reader wants. Cost: a memory that was never changed has no date and sorts last.

**The name `schema_version` is refused.** Beads' own JSON answers use it, and a memory under that name would collide with them.

### Editing

**Defer indefinitely clears an existing defer date first, then defers.** So a bead that was deferred until a date does not keep that date while it waits for someone to bring it back. Cost: two writes when there is a date to clear. An integration test runs the clear step against Beads 1.3.1 (defer with a date, then defer indefinitely without undeferring in between).

**The date preview reads only the forms it is sure of.** `tomorrow`, `+3d`, `+2w`, `+6h`, `next monday`, a date, a date with a time. Anything else says "Beads will read this when you save." Cost: a form Beads accepts (`+30m`) shows no preview. The alternative was a preview that might not match what Beads wrote.

**Undefer is offered for an open bead with a future defer date.** Beads clears the date.

**The parent menu offers epics only.** The panel's Epic view is built on that, and moving a bead under a bead that is not an epic makes a tree it cannot draw. Cost: a bead cannot be moved under a task.

**Comment and close relies on Beads' own blocker check.** The comment goes in first. If Beads refuses the close, the comment stays and the message says so. Cost: a failed close leaves a comment behind. The comment is the thing you wrote and wanted kept.

**Stuck days takes 1 to 30.** A stored value above 30 falls back to 3. A threshold of a year would hide everything the view is for.

### Live updates

**The follower is a nudge, not the data source.** When the Beads log reports an event, the panel refreshes at once by reading the project as it always did. Polling stays as the fallback and as the only path on Beads 1.2.2. Pulls, merges, other computers and direct SQL are not in the log, so the panel cannot rely on it. Cost: the polling code stays.

**Below Beads 1.3 the setting is shown as unavailable ("Needs a newer version of Beads"), not hidden.** Hiding it would leave a person with no way to learn why they have no live updates.

**The log is local and kept for 7 days.** Turning it on writes a setting in `.beads/config.yaml`, so teammates get it too if that file is committed. The confirmation says both.

**The confirmation message does not say "Open Settings again to check".** The panel reads the setting again and shows what it found. A note that sent you somewhere else was noise.

**The log's first start after a long pause recovers by itself.** Beads prunes old entries after 7 days. When the panel asks from a position Beads no longer has, it reads the head with one extra call and carries on.

**While live updates run, the panel asks for changes every 500 ms instead of every 2 s.** The service answers from what it already read, so no Beads call is made per ask. Without this the faster service made no difference on screen: in the live check a change took 2.1 to 3.2 s to appear, and about 1.3 s after. Cost: more requests while the panel is visible and live updates are on.

### Event times from older Beads

**History shows an event's time only when it is known to be right.** Beads 1.2.2 wrote event times in local time but labeled them UTC, so on a project upgraded from 1.2.2 those rows would sit hours off (in the live check, a label "added" 7 hours before the bead existed). The panel takes the time from the event's id when the id carries one, trusts the stored time only for rows newer than the 1.3 upgrade, and otherwise shows the row without a time (a label added with the bead shows at the bead's creation). Cost: some old rows show no time.

### Update project

**A project made with an older Beads shows a note and one button, "Update project", and never updates by itself.** The note reads "This project needs a one-time update for the newer Beads". The button asks first. This is the second place the panel changes Beads, after live updates. Cost: a second button that writes.

**Every write is refused while the project needs the update.** The detail and New bead screens are hidden meanwhile, so a comment or a new bead cannot start an update nobody confirmed.

**The update never forces anything.** A project that shares its beads with a team copy is refused by Beads. The panel shows plain copy ("This project shares its beads with your team, so Beads won't update it from here. Ask whoever set up the team copy to update it, or update it on the computer that hosts it.") and offers no retry. Such a project stays unreadable in Abacus until it is updated elsewhere.

**The update has its own 120 second budget and runs as a background job like Sync.** The normal write limit never kills it partway, and the host's request cut does not apply. Cost: a long wait on very large stores.

**A person's shell cannot start an update the panel did not ask for.** The service removes the two Beads variables that skip the check or allow a remote update from the environment it passes on.

**The "needs update" state stays until a read succeeds.** It does not clear on a cached shortcut, and it resets when Beads is upgraded.

**Stuck counts an expired claim only for beads that are in progress.** A bead that was closed or returned to open is not stuck.

**Written down, not built:** a project whose history was flattened has no event times for some History rows, which then show without a time. Update project is not tested on projects with a shared remote or in server mode.

### Deferred in 0.2

- **History and Activity cannot name who made a change on another computer with Beads 1.3.** It is a Beads limit (the events table is local to each copy). A close and a reopen are never named in History.
- **Per-bead conflict resolution** ("keep mine", "take theirs") is not built. A Sync conflict is still handed to the agent.
- **Server-mode projects are not tested for three things:** the memories list, the read of who holds a bead, and the live-updates follower. If the follower cannot run there, the panel could start it up to 5 times in about 6 minutes for each open panel before it gives up for 5 minutes. Polling keeps the list fresh meanwhile.
- **Update project is untested on shared stores and server mode,** and a long update on a very large store can end without a clear answer. The panel then offers "Check again".
- **A project with flattened history shows some History rows without a time.** Beads 1.2.2 recorded event times in a way the flattened copy no longer has, so the panel shows those rows untimed instead of guessing.
- **Claims refresh only when the whole project is read.** A claim that runs out is noticed within a minute, not at the second it runs out.
- **The log's 7-day prune means a first start usually recovers from a gap** and is the normal start, not a rare one.
- **Not built, by choice:** a query bar and saved searches, a preview of what a chip sends, notifications, bulk actions, the full-screen board, a `bd serve` adapter, and formulas, molecules, swarms and wisps. The [backlog](backlog.md) lists them with their size.

