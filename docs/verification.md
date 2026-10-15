# Verification (v1, 2026-10-14)

How Abacus was checked before calling v1 done. Automated suites first, then a live pass in a real OpenChamber host on a private scratch copy of a shared project, then a read-only pass over every Beads project on the author's machine.

## Automated

| Suite | Command | Result at `2ea662a` |
|---|---|---|
| Type check, lint, unit tests | `npm run check` | 1061 of 1061 passed |
| Integration against real `bd` 1.2.2 and Dolt | `BD_INTEGRATION=1 npx vitest run test/integration` | 28 of 28 passed (rerun at `d33a73d`) |

## Live host pass

Setup:

- OpenChamber 2.3.2 web client on `127.0.0.1`, driven with Chrome DevTools. The panel's frame is reachable through the accessibility tree, and scripts can run inside it by passing an element from the frame.
- Project: a private scratch copy of a real shared project (224 beads, embedded Dolt), with its Dolt remote pointed at a throwaway `file://` remote. The real project was never written to.
- An agent-style change was made beforehand with `bd` as actor "Claude Code": priority P1 to P0, label `live-check`, and a comment.

| Check | Result | Evidence |
|---|---|---|
| Install from folder; panel loads | Pass | Rail button "Abacus"; header shows the project, "Local, refreshed just now", "Search 224 beads" |
| Agent change shows as unpublished and unseen | Pass | Header "2 unpublished", "Publish 2 changes", "1 bead changed since you last looked" |
| Activity attribution | Pass | "Priority: P1 → P0", "Labels: added live-check", "Commented: …", each by "Claude Code"; "3 unseen" |
| Hidden pane slows down | Pass | About 3 `bd`/`dolt` calls per 15 s while visible; one burst per 60 s with the rail on Terminal |
| Attach to Current chat | Pass | Host composer shows the bead's chip (id and title) and a Remove button; success toast |
| Attach to New session | Pass | A new session opened, titled after the bead, with the chip on its composer; nothing sent (0 messages) |
| In worktree… sheet | Pass | Name `issue-<id>-<slug>`, "Nothing is sent.", the `/bd <id>` tip with Copy; cancelled without creating anything |
| `/bd <id>` in the composer | Pass | Suggestion list shows `/bd` as a command from Abacus; Enter cleared the composer and added the chip; 0 messages sent |
| Sync | Pass | "Team synced just now"; unpublished count kept |
| Publish preview and publish | Pass | Preview listed both changes; "Published 2 changes."; the throwaway remote's head equals the local head |
| Real project untouched | Pass | Its latest Dolt commits are all the owner's own edits |

Defects found live and fixed:

1. The Publish preview showed "Saved a change" by "unknown" for commits whose verb is two words (`comments add`, `dep add`, `dep remove`). Fixed in `bc26574`.
2. An old SQLite-era project (`.beads/beads.db`, no `metadata.json`) said the project doesn't use Beads. It now shows the older-format message. Fixed in `2ea662a`.

Found live, left for v1.1:

- When a repo has no git `origin`, the chip's "Open in the browser" link was `https://beads.invalid/...`, a dead link. Fixed after the pass: it now opens the user guide's section on beads with no web page.
- OpenChamber identifies projects by their first git commit, so a copy of a repo shares the original's project. The web client opened the original first; Abacus followed the host's directory and labeled it correctly.
- While the panel loaded at narrow widths, the header shifted and its switcher clipped. Fixed in `3d4300b`; measured at 310 and 420px in the dev preview.
- Hovering the list made it reflow: OpenChamber's injected scrollbar CSS took over only on hover and narrowed the list by 6px, so every title re-truncated. Fixed in `bca6e3d` and `632a57d`; measured with the host CSS injected, 10 of 10 rows changed before and 0 after, light and dark, 310 and 600px.

## Second live pass (after the v1.1 fixes)

Same host and scratch project, after turning the extension off and on.

| Check | Result | Evidence |
|---|---|---|
| New bead, Enter in Title | Pass | Beads has the new bead, created by "<name> (panel)"; no "Blocked form submission" console error |
| Custom done status with a close reason, from the button | Pass, with a Beads limit | A `shipped:done` status appears in the menu after the once-a-minute refresh. "Why is it shipped?" then "Mark shipped" sets the status. Activity shows "Closed as Shipped · <reason>". Beads clears the bead's own close time and reason when a custom status is set after the close, so only Activity keeps them |
| In worktree…, Enter in the name field | Pass | Git worktree and branch `issue-<id>-<slug>` created from the project; the new session opens, titled after the bead |
| `/bd <id>` inside the worktree session | Pass | The chip lands; its browser link opens the user guide's "Beads with no web page" section; 0 messages sent |

Defect found in this pass and fixed: OpenChamber loads the panel in a frame sandboxed with `allow-scripts` only, so the browser blocked every form submission without firing the submit event. New bead, the close reason and the worktree sheet did nothing in the real host while passing every jsdom test. They now run on click and Enter handlers, and a test fails if a form comes back (`514d4ed`, `1b998c7`, `42a078c`).

## Read-only pass over real projects

The service's `workspace` route ran for 17 project folders, then `snapshot` ran for each one that came back ready. No writes.

| State | Projects | Notes |
|---|---|---|
| Ready | 9 (4 to 353 beads; 4 use a Dolt server, 5 embedded) | Bead counts match `bd count` exactly; first load 1.3 to 2.7 s |
| First contact needed | 5 | Answered in 4 to 9 ms, so `bd` was never called |
| No workspace | 2 | A `.beads/` with no metadata, and one with only `interactions.jsonl` |
| Older format | 1 | After fix 2 above |

# Version 0.2 (2026-10-15)

How 0.2 was checked: automated suites on `bd` 1.3.1, then a live pass in a real OpenChamber host on a made-up demo project. Screenshots are in `docs/verification/0.2/`, cropped to the panel.

## Automated (0.2)

| Suite | Command | Result |
|---|---|---|
| Type check, lint, unit tests | `npm run check` | 1968 passed, 5 skipped, at `383ed99` |
| Integration against real `bd` 1.3.1 | `BD_INTEGRATION=1 npx vitest run test/integration --no-file-parallelism` | 79 of 79 passed, at `383ed99` |

## Live host pass (0.2)

Setup:

- OpenChamber web client on `127.0.0.1` with the `feat/0.2` build installed from folder. Clicks inside the panel were driven by a Playwright script on headless Chrome, so each check is repeatable.
- Project: a made-up demo project ("pantry", embedded Dolt, `bd` 1.3.1) that 0.1 had already opened, so the 0.1 to 0.2 upgrade path ran too. No real project was written to.
- Agent-style changes were made beforehand with `bd` as actor "Claude Code": a help request (`human` label), an open review gate, a review gate opened and resolved between two reads, a priority change, a memory, a claim left to expire, an epic whose only child is closed, and an acceptance checklist.

| Check | Result | Evidence |
|---|---|---|
| Needs me opens first when it has items | Pass | Sections "Waiting for your review", "Asked for help", "Changed since you looked"; Stuck appears once the claim runs out ("Claude Code's claim ran out a moment ago", with Keep and Defer). The screenshot `agent-review-rows.png` shows the review rows and Stuck from a later pass |
| Resolve a review from Needs me | Pass | The gate is closed in Beads. `resolve-review.png` |
| An agent's review shows in Activity and Needs me | Pass after fix | "Review requested just now by Claude Code" and "Review resolved just now by Claude Code". `agent-review-rows.png` |
| Ask for a review from the bead menu; Beads enforces it | Pass | One click created the gate; the bead shows Blocked; `bd close` from the command line as "Claude Code" was refused: "cannot close blocked issue: … is blocked by [<gate>]". `ask-for-review.png` |
| Respond to a help request | Pass | The bead closed with reason "Responded"; the answer is a comment "Response: …" by "<name> (panel)" |
| History and Restore | Pass | Restore put P2 back. After an agent changed it to P1, Restore was refused: "The priority was changed again since. Now: P1. Nothing was changed." with Restore anyway and Keep current; Beads still P1. `restore-refused.png` |
| Memories | Pass | Add; Forget with an inline confirm that shows the text ("Every agent session in this project will stop seeing this."); "Forgot release-window. Undo" brought it back. An agent edit made while editing was caught: "sync-tests changed elsewhere while you were editing. Nothing was saved." `memory-edit-caught.png`, `memory-forget-confirm.png`, `memory-undo.png` |
| Due date preview matches Beads | Pass | "next friday" previewed "Due Fri, Oct 16, 11:41 AM"; Beads stored the same instant. `due-preview.png` |
| Acceptance tick | Pass | Only the ticked line changed to `[x]` in Beads |
| Close epic | Pass | Offered on the epic whose children are all done; one click closed it in Beads |
| Live updates consent and switch | Pass | Confirm text: "Beads will keep a log of changes on this computer for 7 days. This changes the project's settings file, .beads/config.yaml, which is shared with your team if you commit it." Turn on wrote `events-journal: true`; the follower started. `live-updates-consent.png` |
| Live update speed | Pass after fix | A change made with `bd` reached the screen in 1.2 to 2.1 s over 6 probes (about 1.3 s typical); before the fix 2.1 to 3.2 s, no faster than polling |
| Follower stops with the service | Pass | Turning the extension off and on left no `bd events tail` process from the old service |
| Update an older-format project | Pass after fix | A copy of a project made with an older Beads showed the update note; nothing changed through the consent and the confirm; Update brought the list back in about 5 s and the project reads normally. `update-project-needed.png`, `update-project-confirm.png` |
| History times for old events | Pass after fix | An event written by `bd` 1.2.2 now sits with the bead's creation instead of 7 hours before it. `history-old-event-times.png` |
| Claim heartbeats are not news | Pass after fix | A heartbeat changes only `heartbeat_at` (Beads keeps `updated_at`); no "Heartbeat" or "Lease" rows in Activity |

Defects found in this pass and fixed before release:

1. Claim heartbeats showed as "Heartbeat at changed" rows by "unknown" and made beads unseen.
2. After the upgrade from 0.1, comments renumbered by `bd` 1.3.1 were announced again as new.
3. Reviews opened or resolved by an agent since the upgrade left no Activity row (the 0.1 state file's gate rows were not carried over).
4. The panel's own writes appeared under "Changed since you looked".
5. Changed rows mixed "now" and a full date for the same minute.
6. Live updates were no faster than polling, because the panel still asked for changes every 2 s; it now asks every 500 ms while the follower runs and the panel is visible.
7. History placed events written by `bd` 1.2.2 hours off (local time labeled UTC). Such rows now show without a time unless their time is known.
8. A project last written by an older Beads could not be read at all: `bd` 1.3.1 refuses read-only opens of an older-format store, and Abacus only reads. Abacus now says "This project needs a one-time update for the newer Beads." and offers "Update project" with an inline confirm; the update never runs on its own, writes are refused until it is done, and a project shared through a team copy gets a plain explanation instead of a forced update.

Not run in this pass:

- Server-mode projects (lease reads, memory dates, the follower): there was no server-mode scratch project that did not share a real Dolt server.
- `bd` 1.2.2: the binary was replaced by the upgrade; 1.2.2 behavior is covered by route tests only.
- Update project on a project that shares a team copy or runs in server mode: the refusal copy is covered by unit and integration tests only.
- These planned checks were not driven live and are covered by unit and integration tests only: Approve plan, Dismiss, defer and undefer, move to another epic, change type, supersede and duplicate confirmations, comment and close, the follower being killed (polling continues), the follower stopping while the panel is hidden, and a browser console check for errors.
