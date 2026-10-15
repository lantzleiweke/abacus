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
