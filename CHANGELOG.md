# Changelog

## 0.2.1 (unreleased)

### Changed

- The Beads-missing and Beads-too-old screens offer to ask the agent, copy the command, or open the install guide.

## 0.2.0 (unreleased)

Review and audit what your agent did, and give it better context. Needs Beads 1.2.2 or 1.3.1. Live updates need 1.3.

### Added

- **Needs me.** A view that lists what waits on a person: reviews and plan approvals, requests for help from an agent, beads stuck in progress, and unseen changes. Resolve, approve, respond, dismiss, keep and defer from the row. It is the view the panel opens on when it has something in it.
- **Reviews and plan approvals.** Ask for a review or for approval of a plan from a bead's menu. A bead that waits shows a "Waiting on" section. Closing it says what to resolve first. Agents see the same reviews, because they are stored in the project.
- **History and Restore.** A bead's earlier versions, with who changed what where Beads recorded it, and a **Restore** that puts one field back. Restore is checked against the bead as it is now and shows a diff before it overwrites a newer edit. It also works from an Activity row.
- **Memories.** List, add, edit and forget the notes Beads gives every agent session in the project, from the project menu. Forget can be undone. Nothing is changed unless its text is still what you saw.
- **Project menu.** The project name in the header opens it: Memories, "Stuck after N days" (1 to 30, default 3) and Live updates.
- **Live updates.** With Beads 1.3, the panel can follow Beads' own log of changes and refresh as they happen. It is off until you turn it on in the project menu and confirm. Polling stays as the fallback.
- **Due and defer dates.** Set, change and clear a due date. Snooze with a date, defer indefinitely, undefer. Dates are typed as words ("tomorrow", "+3d", "next monday") with a preview. New filters: Overdue and Due this week.
- **Move and retype.** Change a bead's type, and move it under an epic or out of one.
- **Acceptance checklist.** Tick `- [ ]` items in the detail. Only that line is rewritten.
- **Superseded and duplicate.** Close a bead as superseded by, or a duplicate of, another, with the link, after a confirmation.
- **Comment and close.** The close dialog takes an optional comment. It goes in first.
- **Close epic.** An epic whose children are all done offers **Close epic**.
- **Why a bead is not ready.** A line under the status says what it waits on or until when it is snoozed.
- **Update project.** A project last written by an older Beads cannot be read by Beads 1.3. The panel says "This project needs a one-time update for the newer Beads." and offers **Update project**, with a confirm that says what it does. It never runs on its own, it runs in the background for up to two minutes, and every other change is refused until it is done. A project that shares its beads with a team copy is not updated from here; the panel says who has to.
- Screenshots and documentation for all of this in the [user guide](docs/user-guide.md), the [troubleshooting](docs/troubleshooting.md) page, the [decisions](docs/decisions.md) page and the [architecture](docs/architecture.md) page.

### Changed

- Two buttons now change Beads, and each asks first: **Turn on live updates** writes one setting in `.beads/config.yaml`, and **Update project** updates an older project's data format. Everything else still leaves the configuration alone.
- The beads that hold reviews are kept out of the Epic and Status lists and counts.
- Moving a bead to a done status, or closing it, is refused with the reason when it waits on a review or has open blockers. The panel never forces it.
- Beads older than 1.3 show "Needs a newer version of Beads" in the Live updates row and keep polling.
- Works with Beads 1.3.1 and 1.2.2. 1.2.2 has no live updates.

### Known limits

- With Beads 1.3, History and Activity name who made a change only when it was made on this computer. A close and a reopen are never named in History.
- History shows some entries without a time on a store that was flattened.
- The live-updates log is local to this computer. Turning live updates on edits `.beads/config.yaml`, so teammates get the setting too if that file is committed.
- Server-mode projects are untested for Memories, for the read of who holds a bead, and for the live-updates follower.
- A claim that has run out is noticed at the next full read, within a minute. It counts as Stuck only while the bead is in progress.
- **Update project** is untested for projects that share their beads through a team copy or a server (Beads refuses to update those in place), and a very large project may need longer than two minutes, in which case the panel asks you to check again.
- Not in 0.2: a query bar and saved searches, a preview of what a chip sends, notifications, bulk actions, the full-screen board, a `bd serve` adapter, per-bead sync conflict resolution, and formulas, molecules, swarms and wisps.

See [decisions](docs/decisions.md#02) for the reasoning behind each.

## 0.1.0 (unreleased)

First version.

### Added

- A right-rail panel, "Abacus", that shows the beads of the open project.
- The Abacus logo: a rail icon drawn for 16 to 18 px, an app tile, light and dark lockups for the README, and a social preview.
- Epic and Status views with one row style, search, filters (status, assignee, priority, "Only ready to start") and keyboard navigation.
- A detail view with the bead's description, acceptance criteria, design, notes, relationships, comments and labels.
- Editing in place: text fields, status, priority, assignee, labels, links and comments. Every edit is checked against the bead as it was last seen, and a change made in the meantime is shown before anything is overwritten.
- A "New bead" form with type, priority, parent and description.
- An Activity view: what changed, who changed it, and when. Unseen changes are highlighted and counted on the rail icon.
- Team sync for projects with a shared copy: Sync brings in the team's changes, Publish sends yours after a review sheet. A conflict is backed out and handed to your agent.
- Handing a bead to the agent: add it to the open chat as a chip, start a linked session, or start one in a new worktree. A `/bd` command attaches a bead by id.
- A freshness line in the header, and a banner when no read has worked for 30 seconds.
- Plain-language screens for a project that cannot be shown: Beads not installed, too old, no Beads in the project, an older format, first contact with a newer Beads, and a server that is not running.
- Works with Beads 1.2.2 and 1.3.1, in embedded and server Dolt modes.
- A dev preview (`npm run preview`) with a fake host and service, and unit and integration tests.
- This documentation.

### Beads 1.3.1

- Closing a bead that is blocked says what blocks it, as it did with 1.2.2.
- A bead someone holds in In progress can be handed over once it leaves In progress. The edit moves the status first, and if Beads still refuses, the message says who holds it.
- The Publish preview names a created bead by its id, and reads linked, unlinked and deleted beads and the team's merges.
- When a Sync or Publish merged two edits to the same field, the "Synced." toast names the beads and fields whose older edit was replaced. A bead deleted on one side and edited on the other is still a conflict.
- Activity dates changes from the time Beads recorded. With 1.3, changes that came in with a Sync show without a name, because Beads keeps that record on each computer.

### Fixed before release (found in live testing)

- New bead, the close reason and the worktree sheet did nothing inside OpenChamber: the panel's frame is sandboxed without `allow-forms`, which blocks form submission. They now run on click and Enter.
- Hovering the panel made the list shift sideways and re-cut every title: OpenChamber's own scrollbar style took over only on hover. The list now keeps one width.
- The header no longer shifts or clips while the first load runs.
- Enter on a "Discard?" question now answers yes, unless a button has focus.
- The Publish preview named two-word changes (comments, links) "Saved a change" by "unknown".
- A project in Beads' old SQLite format said it did not use Beads.
- A bead in a repository with no web page had a chip link that went nowhere. It now opens the user guide's explanation.

### Known limits

See [decisions](docs/decisions.md#deferred).
