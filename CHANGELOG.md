# Changelog

## 0.1.0 (unreleased)

First version.

### Added

- A right-rail panel, "Abacus", that shows the beads of the open project.
- Epic and Status views with one row style, search, filters (status, assignee, priority, "Only ready to start") and keyboard navigation.
- A detail view with the bead's description, acceptance criteria, design, notes, relationships, comments and labels.
- Editing in place: text fields, status, priority, assignee, labels, links and comments. Every edit is checked against the bead as it was last seen, and a change made in the meantime is shown before anything is overwritten.
- A "New bead" form with type, priority, parent and description.
- An Activity view: what changed, who changed it, and when. Unseen changes are highlighted and counted on the rail icon.
- Team sync for projects with a shared copy: Sync brings in the team's changes, Publish sends yours after a review sheet. A conflict is backed out and handed to your agent.
- Handing a bead to the agent: add it to the open chat as a chip, start a linked session, or start one in a new worktree. A `/bd` command attaches a bead by id.
- A freshness line in the header, and a banner when no read has worked for 30 seconds.
- Plain-language screens for a project that cannot be shown: Beads not installed, too old, no Beads in the project, an older format, first contact with a newer Beads, and a server that is not running.
- Works with Beads 1.2.2 and newer, in embedded and server Dolt modes.
- A dev preview (`npm run preview`) with a fake host and service, and unit and integration tests.
- This documentation.

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
