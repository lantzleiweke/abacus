# User guide

This guide covers everything the Abacus panel shows and does. Quoted text is what the panel displays. For a message that stops you, see [troubleshooting](troubleshooting.md).

"Beads" is the tool. "beads" are the issues it tracks. A bead id looks like `myproj-a1b2`. The panel shows the short form (`a1b2`) in lists.

## Contents

1. [The panel at a glance](#the-panel-at-a-glance)
2. [Header lines](#header-lines)
3. [Epic and Status views](#epic-and-status-views)
4. [Search and filters](#search-and-filters)
5. [Keyboard](#keyboard)
6. [Opening a bead](#opening-a-bead)
7. [Editing](#editing)
8. [Creating a bead](#creating-a-bead)
9. [Giving a bead to your agent](#giving-a-bead-to-your-agent)
10. [Unseen changes and the rail badge](#unseen-changes-and-the-rail-badge)
11. [Activity](#activity)
12. [Sync and Publish](#sync-and-publish)
13. [When a project cannot be shown](#when-a-project-cannot-be-shown)

## The panel at a glance

Open the Abacus icon in the right rail. The panel follows the project OpenChamber has open. From top to bottom:

- **Header.** The project name (or "Abacus" when no project is open) and two status lines.
- **Tools row.** A search box, the view switcher (Epic, Status, Activity), a filters button, a New bead (+) button, and an unseen chip when something changed.
- **The list**, or the bead you opened.
- **Footer.** Counts: open, in progress, blocked, closed this week.

Your view, filters and which groups are folded are remembered per project. The search text is not.

![The panel in the Epic view, with unseen beads highlighted and the team sync line under the header](screenshots/epic-light.png)

## Header lines

The first line says how fresh the local copy is:

- "Local, refreshed 8s ago". The age reads "just now", "8s ago", "12m ago", "3h ago", "2d ago" or "3w ago".
- "Local, not refreshed yet". The first read has not finished.

For a project that has a shared copy with the team, a second line shows:

- "Team synced 12m ago" or "Team not synced yet". The time is the last Sync or Publish run from the panel, remembered across restarts. A sync your agent runs is not counted.
- "N unpublished". Changes on this computer the team's copy does not have yet.
- "Unpublished count unavailable". The count could not be read. Sync and Publish still work.

The team line is absent for a project with no shared copy.

If nothing has been read for 30 seconds, or the last read failed, a banner appears: "Beads hasn't answered for a while." when no more specific reason is known. It has **Copy details** and **Retry**. The panel keeps retrying by itself, with longer waits after repeated failures (up to 30 seconds).

![The stale banner](screenshots/stale-light.png)

## Epic and Status views

**Epic.** Beads nest under their epic, and sub-epics nest under theirs. Beads that belong to no epic fall in a trailing "Not in an epic" group. An epic row shows its progress as sub-issues done of total. Click a group header to fold it.

**Status.** Beads group by status:

| Section | What goes in it |
|---|---|
| In progress | Status in progress. |
| Blocked | Open beads that are not ready, and beads with the blocked status. These read "Waiting on another bead". |
| Ready | Open beads with nothing blocking them. |
| Deferred | Open beads with a defer date in the future. These read "Deferred until later". |
| Closed | Done beads. Under the default filter it reads "Closed (last 7 days)". |

A project's custom statuses get their own sections. The panel capitalizes them for display and shows the raw name on hover. A custom status that counts as done is treated like Closed.

Deferred and Closed start folded. A section with more than 8 rows shows 6 and a "Show N more" link.

Each row shows the status icon (in the Status view it moves to the section header), the type, the short id, the title, up to two labels, the parent epic in the Status view, sub-issue progress, a priority chip (P0 to P4), the assignee's initials, and how long ago it was updated.

![The Status view, with sections for In progress, Blocked, Ready and the project's custom statuses](screenshots/status-light.png)

### Row menu

Open a row's menu with the "More actions" button at its right end, a right click, or the Menu key on a focused row:

- **Add to current chat.** Disabled with "No open chat" when OpenChamber has no chat open.
- **Start session.**
- **Start in worktree…**
- **Copy ID.**

The first three are disabled while another of them is running. See [Giving a bead to your agent](#giving-a-bead-to-your-agent).

![The row menu](screenshots/row-menu-light.png)

## Search and filters

Type in the search box. What you type must appear in the bead's id or title, as one piece of text (the attach picker, below, matches word by word instead). While a search is active, folded groups open and long sections show every row. The placeholder reads "Search beads" in the list and "Search activity" in Activity. When the unseen chip is visible it reads "Search".

The filters button opens:

- **Status.** "Current" (the default: "Everything not done, plus what closed in the last 7 days"), "All", or any set of individual statuses.
- **Assignee.** "Anyone", "Unassigned", or a name.
- **Priority.** Any of P0 to P4.
- **Ready.** "Only ready to start": "Open beads with nothing blocking them".
- **Reset filters.**

Filters apply to the Epic and Status views. The filter panel notes this: "Filters apply to the Epic and Status views. Activity shows every change; search narrows it."

When nothing shows:

- "Only older closed beads match." with "They closed more than 7 days ago." and a **Show all** button. This is the default filter hiding them.
- "No beads match." with "Nothing has that id or title." (a search) or "Nothing fits these filters." Buttons: **Clear search**, **Reset filters**.
- "No beads in this project yet." with "When your agent creates beads, they show up here within a few seconds."

![Filters open while a search for "token" narrows the list to two beads](screenshots/filters-search-light.png)

## Keyboard

In the list:

| Key | Does |
|---|---|
| `j` or Down | Move the cursor down. |
| `k` or Up | Move the cursor up. |
| Enter | Open the bead under the cursor. |
| `/` | Go to the search box. |
| Menu key | Open the row menu. |
| Esc | Back out: clear, close, or leave the bead. |

In the search box, letters are text. The arrow keys still move the cursor and Enter opens the cursor row. In any other text field every key is yours.

Saving a text edit uses Cmd+Enter on a Mac and Ctrl+Enter elsewhere. The editor's hint shows the right one. In the attach picker, Up and Down (or Ctrl+N and Ctrl+P) move, Enter attaches, and Esc clears the search and then closes.

## Opening a bead

Click a row, or press Enter on it. The bead replaces the list. **Back** (or Esc) returns, and the row stays selected. Opening a bead from its relationships stacks the detail views, and Back steps through them.

![A bead's detail: header, change banner, description, acceptance criteria and the Attach to footer](screenshots/detail-light.png)

**Top bar.** Back, the epic it belongs to, New bead, and the status menu.

**Header.** The title (with an Edit title button), "Copy ID", the type, a status pill, a priority menu, the assignee picker, labels, and "+ Label". When the bead cannot start yet you see "Waiting on …". A deferred bead shows "Deferred until …".

**Change banner.** If the bead changed since you last looked, a banner reads "Change since you last looked" and says what changed. **Dismiss** hides it.

**Sections.**

- **Description.** Rendered Markdown. Links open outside the panel. A link the panel cannot open (a relative path, a file link) is offered as text with Copy.
- **Acceptance criteria.** Checkbox items.
- **Design** and **Notes.** Start folded.
- **Relationships.** Linked beads and children, with how many children are done. A linked bead that is not in the project reads "Not in this project". Kinds: Blocked by, Blocks, Related, Discovered from, Tracks, Caused by, Validates, Supersedes.
- **More.** Other fields the bead carries.
- **Activity.** Comments, a comment box, and the Created, Updated, Closed and Reason stamps.

Empty parts are not drawn. An "Add" row of chips (Description, Acceptance, Design, Notes, Link) lets you start one.

![The Relationships section: parent, children with progress, Blocked by, Blocks, Related and Discovered from](screenshots/detail-relationships-light.png)

If the bead cannot be read, the detail shows an error with **Try again**. If the bead is gone from the project, it says "This bead is no longer in the project. This is the last copy read."

## Editing

Edit from the detail view. Everything below goes through Beads and is recorded as you, with "(panel)" after your name. See [Activity](#activity).

### Text fields

Title, description, acceptance criteria, design and notes edit as Markdown source. Buttons: **Save**, **Cancel**. The hint reads "Markdown · ⌘↵ saves" (Ctrl+Enter off a Mac). A title cannot be empty: "A bead needs a title."

Leaving with unsaved text asks "Discard your changes?" with **Keep editing** and **Discard**. Unsaved text is kept while you switch beads or projects, so you find it when you come back.

![The description open as Markdown source, with Cancel and Save](screenshots/edit-description-light.png)

### Status, priority, assignee, labels

- **Status** menu. Moving a bead into a done status asks "Why is it closed?" with an optional reason ("Optional, for example the commit") and **Cancel** or **Mark closed**. Afterwards the panel says "Status set to X." Beads can refuse a close, for example while other beads block it. The panel shows the refusal and does not force it.
- **Priority** menu: Critical, High, Medium, Low, Backlog.
- **Assignee** picker: search a name, choose `Assign to "x"`, or **Unassign**.
- **Labels.** "+ Label" opens a field ("Add a label"). A label cannot be empty, cannot contain a line break, cannot contain a comma or a double quote ("A label cannot contain a comma or a double quote."), and cannot repeat one already on the bead ("That label is already on this bead.").

![The status menu asking "Why is it closed?" with a reason typed in](screenshots/status-close-light.png)

### Links

"+ Add link" takes a kind and another bead ("Bead id or title"; "No bead matches." when nothing fits). Beads keeps one link for each ordered pair of beads, so adding a link of a different kind from A to B is refused while one exists. Remove the old one first, with the "Remove link" button in Relationships. Removal does not ask for a kind.

### Comments

Type in "Add a comment…" and press **Post** ("Posting…" while it runs).

### When someone else changed the bead

Every edit is checked against the bead as you last saw it, down to the field you are changing. If it moved:

- A text edit shows **Changed while you were editing**. You see "Now" (the current text) and "Your draft". **Re-apply** saves yours over it. **Discard** drops yours.
- A one-click change (status, priority and so on) says what it is now, for example "Now status X, …".
- If other parts of the bead changed but the one you edited did not: "Other parts of the bead changed; this one did not. Re-apply to save yours."

### When a write is not certain

- "Saved." The change is in.
- "Saved. Refreshing to show it." The change is in. The panel is reading it back.
- "This may have saved. Refreshing." Beads did not answer in time. The panel reads the bead again and never sends it a second time on its own. Check before you retry.
- "It did not save." with "Your draft is still here." (or "Your comment is still here."). **Try again** sends it again. After a comment that may not have gone in, the button reads **Post again**. After a save it reads **Save again**. After a create, **Create again**.
- "Saved. It may show as a change from someone else." The edit is in, but the panel could not mark it as its own. **Copy** has the detail.

### While Sync is running or has a problem

Editing pauses. The detail says "Editing is paused while Sync runs.", "Editing is paused while Publish runs." or "Editing is paused until the sync problem is resolved." (the last two add "See sync details above."). Your unsaved text stays.

## Creating a bead

Press the + button. The "New bead" dialog has:

- **Title** ("What needs doing").
- **Type.**
- **Priority.** Defaults to "P2 Medium".
- **Parent.** "No parent" by default. From a bead's detail it defaults to that bead if it is an epic, else the nearest epic above it. In the Epic view with no bead open, it defaults the same way from the row under your cursor. The choices are epics that are not done.
- **Description** ("Optional. Markdown works.").

**Create** (Cmd+Enter or Ctrl+Enter, shown as "⌘↵ creates") makes the bead and opens it. The toast reads "Created a1b2." If the list does not have it yet: "Created. It will show in the list in a moment." If you close the dialog with text in it, it asks "Discard this bead?"

If the answer to a create is lost, the panel refreshes and does not retry. Look in the list before you create it again.

![The New bead dialog opened from a bead's detail, with its epic as the parent](screenshots/new-bead-light.png)

## Giving a bead to your agent

Nothing here sends a message. Each action puts the bead, as a chip with its details, on a composer. You write and send.

From a row menu or the bead detail:

- **Add to current chat.** The chip goes on the open chat's composer. The toast reads "Added a1b2 to the chat." With no chat open the item is disabled and says "No open chat".
- **Start session.** Creates a session linked to the bead, opens it, and puts the chip on its composer. This can take up to 3 minutes. While it runs the buttons read "Starting…".
- **Start in worktree…** Opens "New session in a worktree".

![The New session in a worktree sheet, with the branch name and the /bd tip](screenshots/worktree-sheet-light.png)

The worktree sheet asks for:

- **Branch and worktree name.** Defaults to `issue-<id>-<slug>`, where the slug is the title in lowercase words joined by dashes, at most 40 characters. Names may use letters, numbers, dots, dashes and slashes, with no spaces: "Use letters, numbers, dots, dashes and slashes, with no spaces."
- **Start from.** Leave empty for the project's default branch.

The sheet says: "The worktree is a separate copy of the project, so your open files stay as they are. Nothing is sent." While it runs: "Making the worktree and starting the session. This can take up to 3 minutes."

OpenChamber closes the panel when a session in another directory becomes the current one, so a worktree start cannot put a chip on the new chat. The session is linked to the bead anyway. When it is done, the sheet's tip says: "The new chat is linked to the bead. To add the bead's details there, type `/bd <id>` in it." There is a **Copy** button for the command.

### The /bd command

In any chat, `/bd <id>` attaches a bead by id. The id can be the full id, or the end of exactly one id after a dash or dot (`a1b2`, or `b2.1` for a child). If more than one bead matches, it says so and lists up to three. If none match: "No bead x in this project." With no id: "Type a bead id after /bd, for example /bd k3f2."

### The + menu

The composer's + menu has a Beads item. It opens a picker: a search box ("Search by id or title"), the beads on the left, and a preview of the highlighted bead on the right. With no search it lists beads that are not done, plus ones closed this week, newest first. **Attach** (or Enter) adds the highlighted bead and closes. It attaches one bead each time it is opened. Empty states: "No open beads." and "No bead has that id or title."

![The attach picker: a search for "token" on the left and a preview of the highlighted bead on the right](screenshots/attach-picker-light.png)

### Chips

Click a beads chip on a composer to see that bead as the project has it now. If it is gone: "<id> is no longer in this project." with "It may have been deleted since it was attached." A chip from another project says "That bead is in another project." with "Open that project to see it."

### Beads with no web page

OpenChamber shows an "Open in the browser" link on every chip and on a session linked to a bead. When the project's git `origin` is on GitHub or GitLab, that link opens the repository page. Otherwise the bead has no web page: it lives only in the project's Beads database on your computer, and the link brings you here.

To see the bead itself, click the chip's title instead of the link. That opens it in the Abacus panel.

## Unseen changes and the rail badge

A bead is unseen when something changed on it that you have not looked at. Unseen beads are highlighted in the list. The rail icon shows how many, and the chip in the tools row shows the same count ("99+" past 99) with the title "Beads changed since you last looked". Click the chip to open Activity.

A bead stops being unseen when you open it. While a bead is open and the panel is visible, changes to it count as seen as they arrive. A change that arrives while the panel is hidden stays unseen, with no banner, until you show it.

Changes you make through the panel do not mark a bead unseen, unless someone else's earlier change on it was still unseen.

**Mark all seen** in the Activity bar clears everything at once. If that fails: "Couldn't mark the changes seen." and the highlights stay.

## Activity

Choose Activity in the view switcher. The feed lists changes newest first, grouped under Today, Yesterday and dates. The bar reads "N changes" and, when some are unseen, "N unseen" with **Mark all seen**. Filters do not apply here. Search does.

![The activity feed: four unseen changes on top, each entry naming who made it](screenshots/activity-light.png)

### What an entry says

| Entry | Meaning |
|---|---|
| "Created", "Deleted", "Reopened" | The bead's life. |
| "Closed", "Closed as X · reason" | Closed, with the kind and reason when there is one. |
| "Commented: …" | A comment, trimmed. |
| "Status: A → B" | Status moved. |
| "Priority: P1 → P2" | Priority moved. |
| "Title changed" | The title was edited. |
| "Assigned to X", "Unassigned" | Assignee changed. |
| "Labels: added x, removed y" | Labels changed. |
| "Type: A → B" | Type changed. |
| "Moved under X" | Parent changed. |
| "Link added: blocked by x9", "Link removed: …" | A link changed. |
| "Description edited: excerpt", "Description cleared" | The description was edited. |

A deleted bead shows "(title not recorded)" when its title was never seen, and a "deleted" mark. The feed holds the latest 500 changes.

### Who

Each entry names who made the change:

- **"you (panel)".** The change was made through this panel, by you. This is only when the name Beads recorded for the change is exactly the panel's own: your Git `user.name` (or your computer's user name) followed by " (panel)".
- **A name.** The name Beads recorded, such as your agent's or a teammate's.
- **"unknown".** Beads recorded no name. This is common for changes read from history in embedded mode when `dolt` is not installed.

The panel works out who from Beads' own change log. It does not guess. If one change touches several fields, each field is one entry.

### When

An entry shows when the change was made, as the writer recorded it. If that is unknown, it shows when the panel first saw the change. Entries read from Beads' history show only the day. Hover for detail: "From Beads' history. Only the day is known." or "<full time>, when the panel saw it".

### Activity empty states

- "Nothing has changed yet." with "Changes your agent makes show up here."
- "No changes match." with "Nothing in the activity has that id, title, name or change." and **Clear search**.

The panel keeps its last view of a project between restarts and compares against it, so changes made while the panel was closed still appear. A change that alters a bead's stored version but none of the fields the feed describes can mark it unseen without an Activity row. This is a known limit.

## Sync and Publish

Sync and Publish appear only for a project with a shared copy with the team (a Dolt remote). Beads keeps the team's copy separate from your Git remote.

- **Sync** (the sync icon, "Sync: get the team's latest changes") brings in the team's changes. It never sends yours. While it runs: "Syncing with the team…".
- **Publish** sends yours. It first opens a review sheet.

Both are refused while the other is running: "Sync didn't start because a sync is running. Try again when it finishes." Your agent may also sync or publish. The Publish button's tooltip says: "Your agent may also publish these when it syncs."

When Sync finishes: "Synced."

### The Publish sheet

"Publish to the team" opens with "These changes go to the team's shared copy." while it reads "Reading what would be published…". Then it lists the changes that are on this computer and not on the team's copy: a summary of each, who made it, and when. The list shows up to 1,000 and ends with "and N more" beyond that.

![The Publish sheet listing three changes, with who made each and when](screenshots/publish-sheet-light.png)

Cases where the sheet has nothing to confirm:

- "This project has no shared copy with the team, so there is nothing to publish."
- "Nothing to publish. Everything here is already on the team's shared copy."
- "The team's shared copy has nothing in it yet. Publish can't set it up."
- "This computer hasn't seen the team's shared copy yet. Sync first."
- "Couldn't confirm this list is current. Close and try again." (The sheet could not read the point in history the list was taken from, so Confirm is off.)

**Publish N changes** is ignored for half a second after it appears, so a stray click cannot send it. If new changes arrive while the sheet is open, it is refreshed with a notice and focus does not land on Confirm.

When you confirm, Publish first pulls the team's changes, then pushes. It sends only what you saw. If anything new is on your side by then, it stops and says "New changes arrived since you looked. Review them again." Toast: "Published N changes."

**A small window remains.** Right before it pushes, Publish checks that only the changes you reviewed will go. A change written in the few milliseconds between that check and the push can still go along. Your agent writes outside the panel and Dolt cannot push up to a named commit, so this cannot be closed from here. The sheet says it: "Changes made in the moment Publish runs may go with them."

### When Sync needs attention

A card appears when a sync could not finish.

- **"Sync needs attention".** Both sides edited the same field of a bead. "Your changes are safe. The team's copy has edits to the same fields." and "Editing is paused until this is resolved." Beads backed the merge out. Different fields of one bead merge on their own and never conflict.
- **"Sync ran into a problem".** Something else failed. It can be dismissed.
- **"Sync is paused".** Beads refused the data's format or version: "This project's beads data needs a different Beads version. Hand it to your agent to check."

The card can list the beads involved ("Show the bead" or "Show the N beads", then "Hide beads" and "Show N more") and, for each field, the Local and Team values, with "Show all" and "Show less" for long ones. If it cannot tell which beads: "Couldn't tell which beads are affected. Copy details has the full record."

Actions:

- **Hand to agent** with a chat open. It puts the details on the composer. The hint is "Nothing is sent until you send it."
- **Start session with this** with no chat open. The hint is "No open chat."
- **Copy details.**

The details carry both sides of the conflict, what failed, the commands Beads ran, and the rules from the project's `AGENTS.md` about syncing, when it has any. The panel never resolves a conflict for you. The card clears once the team's copy has nothing the local copy lacks, usually after your agent merges it.

![A sync conflict card with the Local and Team values for two beads, Hand to agent and Copy details](screenshots/sync-conflict-light.png)

![A half-merged project](screenshots/conflict-half-merged-light.png)

## When a project cannot be shown

These replace the list. Each has a fix in [troubleshooting](troubleshooting.md).

| Message | Screen |
|---|---|
| "Beads isn't installed on this computer." | [no-bd](screenshots/no-bd-light.png) |
| "This version of Beads is too old." | [bd-too-old](screenshots/bd-too-old-light.png) |
| "This project doesn't use Beads." | [no-workspace](screenshots/no-workspace-light.png) |
| "This project uses an older Beads format." | [pre-dolt](screenshots/pre-dolt-light.png) |
| "Open this project with Beads X?" | [needs-first-contact](screenshots/needs-first-contact-light.png) |
| "This project's Beads server isn't running." | [server-down](screenshots/server-down-light.png) |
| "Couldn't load this project's beads." | [load-error](screenshots/load-error-light.png) |
| "Open a project to see its beads." | No project is open. |
| "Beads can't open this project right now." | Beads could not say why. |

While the first read runs the panel shows a skeleton labelled "Loading beads".
