# Troubleshooting

Find the message the panel shows, then read the cause and the fix. Messages are quoted as they appear. Most screens have **Retry**. A **Copy details** button, where there is one, copies the technical text to paste to your agent or into a bug report.

1. [Installing](#installing)
2. [The project cannot be shown](#the-project-cannot-be-shown)
3. [The list is out of date](#the-list-is-out-of-date)
4. [Edits are refused or uncertain](#edits-are-refused-or-uncertain)
5. [Sync and Publish](#sync-and-publish)
6. [Attaching and starting sessions](#attaching-and-starting-sessions)
7. [Reviews, History and Restore](#reviews-history-and-restore)
8. [Memories](#memories)
9. [Live updates](#live-updates)
10. [Odd behavior that is not an error](#odd-behavior-that-is-not-an-error)

## Installing

**What the permission prompt means.** Abacus can put a bead on a chat's message box (nothing is sent until you send it), reads your projects and sessions, and runs a local service limited to `bd`, `dolt` and `git`.

**Updates.** When you open Settings, Extensions, OpenChamber checks for a newer version (at most once an hour); **Check for updates** checks now. A newer version shows an **Update** button, and your settings and approvals are kept. Nothing is built on your machine: the released files are in the repository.

**A specific version.** Add the tag to the URL, for example `https://github.com/lantzleiweke/abacus#v0.2.0`.

**Enterprise mode.** OpenChamber installs extensions that run a service only from repositories an admin allows. The admin adds this to `policy.json`:

```json
{ "enterpriseMode": true, "allowedExtensions": ["https://github.com/lantzleiweke/abacus"] }
```

**Only one copy at a time.** To run your own copy from a folder, remove the installed one first (see [development](development.md)). Removing it keeps the beads you have seen, but resets the panel's preferences, Stuck days and Keep list.

## The project cannot be shown

These replace the list. The panel checks them when it opens and when you press Retry, not on every refresh.

| Message | Cause | Fix |
|---|---|---|
| "Beads isn't installed on this computer." | The panel could not find `bd`. It looks on the PATH and in `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin` and `~/go/bin`. | Press **Ask the agent to install Beads**: it puts a request on the chat's message box (or on a new chat, if none is open), and nothing is sent until you send it. Or install it yourself: **Copy install command** copies `brew install beads` for macOS, and **Install guide** opens the steps for other systems. Then **Retry**. If it is installed somewhere else, put it on the PATH or in one of those folders. |
| "This version of Beads is too old." | The installed `bd` is older than 1.2.2, or older than the version that last opened this project. | Press **Ask the agent to update Beads**, which puts a request naming the version needed on the chat's message box, unsent. Or update it yourself: **Copy update command** copies `brew upgrade beads`, and **Install guide** covers other systems. Then **Retry**. The panel says which version it found and, for a project, which one last opened it. |
| "This project doesn't use Beads." | There is no `.beads` folder above this one, its `metadata.json` cannot be read, or it is a fresh clone with no local database (embedded mode). | Ask your agent to set Beads up here, or to fetch the data for a clone, then **Retry**. |
| "This project uses an older Beads format." | The project keeps its data in the old SQLite format (a `.beads/beads.db` file, with or without a `metadata.json`). | Ask your agent to upgrade the project's Beads data, then **Retry**. The panel never touches an old-format project, because a `bd` call could migrate it. |
| "Open this project with Beads X?" | A newer Beads than the one that last opened the project is installed. Opening the project with it may update its files. | Choose **Open project** if you are happy for that to happen. The choice is saved for this project and this Beads version. If not, leave it. |
| "This project's Beads server isn't running." | The project uses a Beads database server on a fixed local port, and nothing answers there. | Start the server the way you usually do, then **Retry**. The panel never starts it. **Copy details** gives the folder and port. |
| "Couldn't load this project's beads." | The first read failed. | **Retry**. If it keeps failing, **Copy details** and look at the cause below. |
| "Beads can't open this project right now." | The service reported a state this panel does not know. Usually the panel and the service are different versions. | **Retry**. Then update the extension and reload. |
| "This project needs a one-time update for the newer Beads." | The project was last written by an older Beads, and the installed one will not read it until its data is updated. Nothing is wrong with the beads. | Press **Update project** and confirm. It runs in the background for up to two minutes. Other changes are refused until it is done. |
| "This project shares its beads with your team, so Beads won't update it from here. Ask whoever set up the team copy to update it, or update it on the computer that hosts it." | The project is shared through a team copy or a server, and Beads refuses to update a shared project in place. The panel does not force it. | Ask whoever set up the team copy, or update the project on the computer that hosts it. There is no retry button. |
| "Beads ran the update but the project still reads as out of date." | The update finished but the project still reads as older. | **Check again**. If it stays, **Copy details** and hand them to your agent. |
| "The project may be updated now, but Beads didn't confirm it." / "The update may have finished, but Beads didn't confirm it." | Beads did not say how the update ended, for example because it ran past two minutes on a large project. | Wait while the panel reads the project again, or press **Check again**. |
| "Open a project to see its beads." | No project is open in OpenChamber. | Open a folder. |
| "No beads in this project yet." | The project has none. | Nothing to fix. They appear within a few seconds of your agent creating them. |

"Couldn't save your confirmation." under "Open this project with Beads X?" means the choice could not be stored. Press **Open project** again.

A project in server mode on a remote host is not probed. If its server is down, you see a slow failure ("Couldn't load this project's beads.") rather than "This project's Beads server isn't running."

## The list is out of date

A banner appears above the list when no read has worked for 30 seconds, or when the service says the last one failed. The header still shows "Local, refreshed 8s ago" or "Local, not refreshed yet".

| Message | Cause | Fix |
|---|---|---|
| "Beads hasn't answered for a while." | Nothing came back from the service for 30 seconds. The window may have been asleep, or the service stopped. | **Retry**. If it stays, disable and enable the extension to restart its service. |
| "Beads is busy. Retrying." | Another `bd` command holds the project's lock, usually your agent. | Wait. The panel retries on its own and backs off up to 30 seconds. |
| "Couldn't read beads. Retrying." | A read failed for another reason. | Wait for the retry. If it stays, **Copy details**. |
| "Change detection unavailable; checking every minute." (in the text behind **Copy details**) | Neither the Dolt change check nor `bd vc status` could run, so the service re-reads everything once a minute. | Install `dolt` and `bd` where the panel can find them. Nothing is wrong with the data. |

When the panel is hidden in the rail it checks once a minute, and when the window is hidden it does not check. After you come back there is a short wait before the header says "refreshed".

## Edits are refused or uncertain

Most of these are described with their buttons in the [user guide](user-guide.md#when-someone-else-changed-the-bead). The causes:

| Message | Cause | Fix |
|---|---|---|
| "Changed while you were editing" | The bead changed after you opened it, often because your agent edited it. | Read the current text, then **Re-apply** to save yours over it or **Discard**. |
| "Other parts of the bead changed; this one did not. Re-apply to save yours." | The bead moved, but not the field you edited. | **Re-apply**. |
| "That bead no longer exists." | It was deleted. | Go back to the list. |
| "This bead can't be closed yet. It is still blocked by x, y. Close those first." | Beads refuses to close a bead whose blockers are open. The panel does not force it. | Close the blockers first, or remove the link. |
| "This bead can't be closed yet. It is waiting on a review. Resolve the review first." | A person has to resolve a review or approve a plan before the bead can close. See [below](#reviews-history-and-restore). | Resolve it in Needs me or in the bead's Waiting on section. |
| "X is working on this bead. Move it out of In progress first, or ask them." | Beads 1.3 refuses to hand a bead to someone else while another person or agent holds it in progress. The panel does not override the hold. | Ask them, or move the bead out of In progress and then change the assignee. |
| "These two beads are already linked as "kind". Remove that link first, then add the new one." | Beads holds one link per ordered pair of beads. | Remove the existing link in Relationships, then add the new one. |
| "Only tasks can block other tasks." | Beads refuses a Blocks link from a bead of another type. | Use another link kind, or change the type. |
| "A label cannot contain a comma or a double quote." | Beads reads labels as comma-separated text. | Rename the label. |
| "The team sync has changes that need sorting out first. Resolve them, then try again." | The project is in the middle of a merge. | See [the sync card](#when-sync-needs-attention). |
| "Sync in progress. Try again when it finishes." | A Sync or Publish is running. Editing is paused. | Wait. |
| "The team sync left this project half merged. Resolve the sync problem first." | A merge did not finish. Writes stay off so nothing is added on top of it. | Hand the sync card to your agent. |
| "Beads is busy. Nothing was saved. Try again in a moment." | The project's lock was held for too long. | Try again. |
| "Beads is busy. Part of your change was saved. Try again in a moment." | A change with two steps (a custom done status) finished one. | Look at the bead, then try again. |
| "Beads could not be found on this computer, so nothing was saved." | `bd` went missing after the project opened. | Install Beads and **Retry**. |
| "This may have saved. Refreshing." | Beads did not answer in time, so the panel does not know. It reads the bead again and never sends it twice. | Wait for the result: "Saved." or "It did not save." |
| "Beads did not answer in time. The comment may or may not have been saved. Check before trying again." | The same, for a comment, a new bead or a link. | Look in the list or the comments before you do it again, or you may make a duplicate. |
| "Saved, but couldn't load the result. Refreshing." | The write worked and the read back did not. | Wait. |
| "The change could not be saved." | Beads refused it for a reason the panel has no wording for. | **Copy details** and hand them to your agent. |
| "Something went wrong." | An error inside the service. | **Copy details**, then restart the extension. |

## Sync and Publish

Sync and Publish only appear for a project with a shared copy with the team.

The messages on the sync card, with the cause and fix:

| Message | Cause | Fix |
|---|---|---|
| "Publishing needs the Dolt tool, which isn't installed." | Publish reads the project's history with `dolt`, and it is not on this computer. | Install `dolt`, then try again. |
| "This project has no shared copy with the team, so there is nothing to sync with." | No Dolt remote is set up. | Nothing to fix. Set one up through your agent if you want one. |
| "Some project settings changed on this computer and have not been saved, so Sync cannot start. Ask your agent to save or undo them, then try again." | Uncommitted settings rows block a pull. The panel does not change settings. | Hand the card to your agent. |
| "This project's beads data needs a different Beads version. Hand it to your agent to check." | The shared data's format or version does not match the installed Beads. The card reads "Sync is paused". | Check the Beads version here and on the team's side. |
| "The team's shared copy did not accept your sign-in. Check your access, then try again." | The remote refused the credentials. | Fix access to the remote (for example your Git sign-in), then try again. |
| "Could not reach the team's shared copy. Check your connection, then try again." | No network or the remote is down. | Check the connection. |
| "Sync did not finish. Try again, or copy the details." | A failure with no more specific wording. | **Copy details**. |
| "Beads did not answer in time. Try again." | A Sync or Publish ran past its limit of 120 seconds. | Try again. If the project is large or the link slow, run it through your agent. |
| "Beads could not be found on this computer." | `bd` is missing. | Install Beads. |
| "Beads is busy with another task. Try again in a moment." | Another `bd` command holds the lock. | Try again. |
| "The team keeps changing the shared copy while you publish. Try again." | Publish retried 3 times and the remote moved each time. | Try again. |
| "New changes arrived since you looked. Review them again." | Something was added on this computer after the Publish list was made, so what would go out is not what you reviewed. Nothing was published. | Open Publish again and review. |
| "Some changes on this computer are still being saved. Try again in a moment." | There was uncommitted work when Publish was about to push. | Try again. |
| "The team's shared copy is empty, so there is nothing to bring in yet." | The remote has no data. | Nothing to fix. |
| "The team's shared copy is empty, so there is nothing to publish into yet. Setting it up the first time is a one-time step: hand it to your agent. Nothing was published." | The first publish to an empty remote is not done from the panel. | Hand it to your agent. |

### When Sync needs attention

"Sync needs attention" means both sides changed the same field of the same bead. Beads backed the merge out, and your local data is as it was. Different fields of one bead never conflict. The card lists the beads and both values. The panel never resolves it. Use **Hand to agent** (a chat is open), **Start session with this** (none is), or **Copy details**, and let the agent merge. Editing resumes when the team's copy holds nothing your copy lacks.

If the card says the project is half merged, a merge started and did not finish. That is rare and only happens in server mode. Writes stay off until it is resolved, so nothing lands on top of a half-done merge.

A sync your agent runs is not counted in "Team synced". Only syncs from the panel are.

## Attaching and starting sessions

| Message | Cause | Fix |
|---|---|---|
| "Type a bead id after /bd, for example /bd k3f2." | `/bd` with no id. | Type one. |
| "Open a project first." | No project is open. | Open one. |
| "No bead x in this project." | No id matches. | Check the id. A short form works when it is the end of exactly one id. |
| "x matches more than one bead: a, b, c and N more. Type more of the id." | The short form is not unique. | Type more of it. |
| "No bead has that id or title." / "No open beads." | The picker has nothing to show. | Change the search. "No open beads." means every bead is done. |
| "Couldn't attach x. <reason>" | The host refused the attachment. | Try again. |
| "Couldn't add x to the chat. <reason>" | Adding to the current chat failed. | Make sure a chat is open. |
| "Couldn't read <name>. <reason>" | The service could not read the bead (or sync problem) fresh to build its chip. Nothing was added. | Try again. If the project changed meanwhile, nothing is added at all. |
| "The session couldn't be started. <reason>" | The host could not create a session. | Try again. |
| "The session didn't start in time. A worktree may already exist: check the sidebar before trying again." | A start in a worktree timed out after the worktree was made. | Look in the sidebar and open the worktree instead of starting again. |
| "The session didn't start in time. It may still appear in the sidebar." | A plain start timed out. | Look in the sidebar. |
| "Session started, but the link to the bead wasn't saved." | The session runs and the bead is in its chat, but OpenChamber has no link between them. | Nothing to fix for the work. |
| "The session started, but the bead couldn't be added to its chat." | The session exists, with no bead on it. | Use **Add to current chat** or `/bd` in it. |
| "<id> is no longer in this project." | A chip points to a bead that was deleted. | None. |
| "That bead is in another project." | The chip is from another folder. | Open that project. |
| "Beads sync problem" (a chip) | A sync card was handed to a chat and the chip carries its details. | Read it with your agent. |

Starting a session in a worktree does not add a chip to it, because OpenChamber closes the panel when the worktree opens. The session is linked, and a tip tells you to type `/bd <id>` there.

## Reviews, History and Restore

| Message | Cause | Fix |
|---|---|---|
| "This bead can't be closed yet. It is waiting on a review. Resolve the review first." (or "Approve the plan first." or "Resolve them first.") | An open review or plan approval holds the bead. Beads refuses the close. The panel shows the refusal and does not force it. | **Resolve** (or **Approve**) in Needs me or in Waiting on, then close. |
| "Your comment was added, but the bead could not be closed. …" | The close dialog adds the comment first, then closes. Beads refused the close, for a review or another open blocker. | The comment is saved, so do not post it again. Fix what blocks the close and close again. |
| "Checking whether your comment went in." | Beads did not answer in time. The panel reads the bead again before it does anything else. | Wait for the result. It never closes the bead until it knows. |
| "This bead already waits on a review." / "This bead already waits on a plan approval." | A second request of the same kind was refused. | Nothing to fix. Resolve the first one. |
| "The review on X was already resolved by <name> 5m ago." / "This review was already resolved by <name> 5m ago. Updating." | An agent or a teammate resolved it between your reading and your click. | Nothing to fix. It shows under "Changed since you looked". |
| "The request X was already answered or closed." | The help request was closed elsewhere first. | Nothing to fix. |
| "<Waiting on …>. You can answer once that is done." | The help request is itself blocked by an open bead. Respond and Dismiss are hidden, because Beads would refuse the close. | Finish or unblock the bead it waits on. |
| "This bead changed since its history was read." | The bead was edited while the History section was open. | Press **Refresh**. |
| "Too long to restore here" | Only the start of a very long text is read for History, so the whole text cannot be put back from it. | Edit the field by hand, or ask your agent. |
| "This bead changed since it was shown. The <field> is still X. Nothing was changed." | A restore was refused because the bead moved since you pressed it. | Look at the bead, then restore again. |
| "The <field> was changed again since. Now: X. Nothing was changed." with **Restore anyway** and **Keep current** | The field moved after the version you are restoring. The panel shows what would change before it writes. | Choose. **Restore anyway** replaces the current value. |
| "The <field> is already the earlier value." / "The <field> it holds now cannot be put back from here." | The restore would change nothing, or the current value is a long text. | Nothing to fix, or edit by hand. |
| An entry reads "someone else or another computer" | Beads 1.3 keeps who made a change only on the computer where it was made. A change that arrived with a Sync has no name here. A close or reopen never has one in History. | Nothing to fix. It is a limit of what Beads records. |

A Sync or Publish pauses restores, like other edits. See [While Sync is running](user-guide.md#while-sync-is-running-or-has-a-problem).

## Memories

| Message | Cause | Fix |
|---|---|---|
| "<name> changed elsewhere while you were editing. Nothing was saved." | Someone, often an agent running `bd remember`, changed the memory after you opened it. | Read "Now in Beads". **Save mine anyway** replaces it, **Keep current** leaves it. |
| "This memory was removed elsewhere. Nothing was saved. Add it again with your text, or discard it." | The memory was forgotten while you edited. | **Add it again** or **Discard**. |
| "This memory changed since you opened this step. This is its text now; nothing was forgotten." | Forget found different text than the text you saw. | Read it again, then decide. |
| "A memory named X already exists. Nothing was saved." | The name is taken. | **Replace it with mine**, or pick another name. |
| "A memory is at most 4,000 characters. Shorten it; nothing was saved." | Beads limits the size, and the panel does not cut text. | Shorten it, or split it in two. |
| "That text is the name of another memory. Reword it so it reads as an instruction." | With no name given, Beads reads a short text that matches a memory's name as that memory. | Reword it, or give it a name. |
| "Could not bring back <name>: a memory with that name exists now. Nothing was saved. Its text was:" | **Undo** after a forget found the name taken. The old text is shown. | Copy the text, then add it under another name. |
| "Could not read the memories again: …" | A read after the page was open failed. The list is the last one read. | Wait, or press **Back** and open Memories again. |

## Live updates

The project menu (the project name in the header) holds the Live updates row. Polling every few seconds keeps working whatever it says, so none of these stop the list from updating.

| Message | Cause | Fix |
|---|---|---|
| "Needs a newer version of Beads (1.3 or later). Until then, the panel checks for changes every few seconds." | Live updates need Beads 1.3. On 1.2.2 the panel is complete in every other way. | Update Beads, or leave it. |
| "Live updates need a newer version of Beads." | The panel asked a Beads that cannot do it. | The same. |
| "Off for this project, so the panel checks for changes every few seconds. Turn it on to see changes as soon as they happen." | The project has not turned it on. The panel never does that on its own. | **Turn on live updates**, and confirm. |
| "Reconnecting. Until then, the panel checks for changes every few seconds." | The follower stopped and is starting again, with waits of 2, 5, 15 and 60 seconds. | Wait. |
| "Not working right now, so the panel checks for changes every few seconds." | The follower failed 5 times in a row with no event. It tries again after 5 minutes, and a successful event ends it earlier. | Wait, or restart the extension. If it stays, run `bd events tail --follow` in the project in a terminal and read what it says. |
| "Starting. Until then, …" | The follower is being started. | Wait a moment. |
| "Wait for the sync to finish, then try again." | A Sync or Publish is running. The setting is not changed during one. | Try again afterwards. |
| "Couldn't read this setting for the project." | The panel could not ask Beads for it. | **Try again**. |
| "Live updates may be on now, but Beads didn't confirm it." | The change was sent and the answer did not come. The panel reads the state again and shows it. | Look at the row. If it says Off, turn it on again. |

Turning it on edits `.beads/config.yaml`. If your project tracks that file in Git, the change shows as an uncommitted edit. Commit it if the team should have it, or `git restore` it to go back. Turning it off, for a project that no longer wants it, is done with `bd config set events-journal false` in a terminal.

## Odd behavior that is not an error

- **A bead is marked unseen with nothing in Activity.** A change that alters a bead's stored version but none of the fields the feed describes does this. It is a known limit. Opening the bead clears it.
- **An entry says "unknown" for who.** Beads recorded no name. Common when `dolt` is not installed, because history then comes from `bd` alone.
- **A change you made shows as someone else's.** The panel could not mark it as its own. The toast says "Saved. It may show as a change from someone else."
- **"refreshed 8s ago" or a save check looks wrong.** The panel compares its own clock with times from the service and assumes they are the same computer's clock. If they differ, ages are off. This is a known limit and is not corrected.
- **A new bead from your agent takes a few seconds.** The panel checks every 2 seconds, the service looks at the project at most every 4 seconds, and a full read happens when it moved.
- **The panel is slow to show a change after the window was hidden.** A hidden window is not checked. It catches up when you return.
- **A fresh clone shows "This project doesn't use Beads."** The clone has no local database yet. Ask your agent to fetch it.

## Still stuck

1. Press **Retry**.
2. Reload the OpenChamber window. This restarts the panel.
3. Disable the extension, then enable it. This restarts the service.
4. Use **Copy details** and share the text.
