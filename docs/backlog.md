# Abacus backlog (draft, 2026-10-14)

Updated 2026-10-15: items marked "Shipped in 0.2" are in the 0.2 release. Not built from the 0.2 scope: the context preview (7), the query bar and saved searches (27), and per-bead conflict resolution (37). They stay open.

Built from three inputs:

- **What Beads offers** (`bd` 1.2.2 help text, upstream docs and the 1.3.0 / 1.3.1 release notes) compared with what Abacus shows today.
- **22 agent task tools** (agent kanbans, agent task managers, human + agent boards): Vibe Kanban, Cline Kanban, Conductor, Nimbalyst, Sculptor, Orchestrator.inc, octomux, saltbo/agent-kanban, Agent Kanban PM, Backlog.md, Task Master, CCPM, Kiro, GitHub Copilot agent, Linear agents, Jira + Rovo, Devin, Codex cloud, Cursor cloud agents, Factory, Plane, Terragon.
- **Other Beads GUIs**, including those added since the [2026-10-13 inventory](2026-10-13-beads-gui-inventory.md): b9s, beady-eye, beadside, LazyBeads, beadbox, mardi-gras and others.

The job Abacus is for: **review and audit what agents did, adjust the context they work from, and hand work to the agent**, without the `bd` CLI. Items are ranked by how much they serve that job.

**Keys.** Source: **B** = a Beads capability Abacus does not expose, **C** = a pattern from agent task tools, **G** = seen in another Beads GUI. Size: **S** under a day, **M** a few days, **L** a week or more. Tier: **Next** (0.2), **Later** (0.3+), **v2** (full-screen board), **Explore** (needs a spike or a host change first).

## 1. Attention and review

| # | Item | What it is | Source | Size | Tier |
|---|---|---|---|---|---|
| 1 | **Needs me inbox** | One view, with a rail count, of beads waiting on a person: labelled `human` (`bd human list`), behind an open human gate, blocked, newly created by an agent, or carrying an unanswered agent question. Respond or dismiss in place (`bd human respond/dismiss`). | B, C (Agent Kanban PM, octomux), G (beadside inbox) | M | Shipped in 0.2 |
| 2 | **Gates** | Show gates blocking a bead (`human`, `timer`, `gh:run`, `gh:pr`, `bead`) with their state; resolve a human gate from the panel (`bd gate resolve`). Nobody in the category presents gates well. | B, G | M | Shipped in 0.2 |
| 3 | **Review queue and agent-closed audit** | A review lane for a review-type status (suggest a custom `in_review` in the `wip` category), plus a flag on beads an agent closed with no human look. Abacus cannot stop an agent from closing, but it can make it visible. | C (saltbo separation of duties, Linear delegates) | M | Partly in 0.2 (reviews are gates; no review-type status and no agent-closed flag) |
| 4 | **Per-bead history** | A full timeline for one bead from `bd history <id>` and `bd show --as-of <commit>`, past the 500-entry Activity window: what it looked like before the agent touched it. | B, C (Copilot commit-to-session tracing) | M | Shipped in 0.2 |
| 5 | **Undo an agent's change** | From an Activity row or the history, put a field back to its previous value (same re-read-before-write path as other edits). | C | S | Shipped in 0.2 |
| 6 | **Stale and stuck work** | Flag `in_progress` beads with no update in N days (`bd stale`), and on 1.3 expired leases. Keep, snooze or close in place. A gap across the agent tools. | B, G (beadside stale filter), C (gap) | M | Shipped in 0.2 |
| 7 | **Preview what the agent gets** | Before attaching, show exactly what the chip will send (bead, parent epic, blockers, notes), with toggles. Users of other tools have hit context silently dropped. | C (Cursor/Linear reports) | S | Next |
| 8 | **Claim and lease visibility** | Show who claimed a bead, when the lease expires and the last heartbeat (`lease_expires_at`, `heartbeat_at`, 1.3). Unclaim a dead claim. | B (1.3) | S | Partly in 0.2 (an expired claim shows under Stuck) |
| 9 | **Notifications** | Tell the person when something lands in Needs me (host toast or notification), opt-in per kind. | C (Conductor, octomux, Copilot) | S | Later |

## 2. Editing what Beads supports

| # | Item | What it is | Source | Size | Tier |
|---|---|---|---|---|---|
| 10 | **Due and defer dates** | Edit `due` and `defer` (natural language like "next monday", as `bd` accepts), `bd undefer`, plus Overdue and Due soon filters (`list --overdue`, `--due-before`). Abacus shows these fields but cannot edit them. | B | M | Shipped in 0.2 |
| 11 | **Move and retype** | Change a bead's parent (move into or out of an epic) and its type after creation. | B | S | Shipped in 0.2 |
| 12 | **Acceptance checklist you can tick** | Check items off in the acceptance criteria from the detail view; warn on beads missing acceptance criteria (`bd lint`). Gives a reviewer something to verify. | B, C (Backlog.md, Kiro) | S | Shipped in 0.2 |
| 13 | **Supersede and duplicate** | Close a bead as superseded by or a duplicate of another, with the link (`bd supersede --with`, `bd duplicate --of`). | B | S | Shipped in 0.2 |
| 14 | **Comment and close in one step** | Add a closing comment in the close dialog; quick "append note" (`bd note`). | B, G (b9s) | S | Shipped in 0.2 |
| 15 | **Estimate, external ref, metadata** | Edit `estimated_minutes`, `external_ref` (shown as a link when it is a URL or a GitHub/Jira/Linear id) and custom metadata keys (`--set-metadata`). | B | M | Later |
| 16 | **Bulk actions** | Multi-select rows to set status, priority, assignee or labels, or close, in one transaction (`bd batch`). | B, G (b9s multi-mark, beads-dashboard) | M | Later |
| 17 | **Quick capture** | A one-line "new bead" from the rail or from selected chat text (`bd q`). | B | S | Later |
| 18 | **Pin** | Pin beads to the top; a pinned strip. | B, G (beadside) | S | Later |
| 19 | **Add the missing link kinds** | `waits-for`, `conditional-blocks`, `until`, `relates-to` in Add link; a cycle warning (`bd dep cycles`). | B | S | Later |

## 3. Context the agent works from

| # | Item | What it is | Source | Size | Tier |
|---|---|---|---|---|---|
| 20 | **Project memories** | List, search, edit and forget `bd remember` memories, which `bd prime` injects into every agent session. This is "adjust context" directly, and no Beads GUI shows them. | B | M | Shipped in 0.2 |
| 21 | **Linked sessions on a bead** | Show which OpenChamber sessions are linked to a bead and whether one is working now, with an Open button (the host stores linked issues on sessions). Already on the Roadmap. | C (Orchestrator.inc, Devin) | M | Explore (needs a host API to list sessions by linked item) |
| 22 | **Plan checkpoint** | A Plan section on a bead (in `design` or a template section) with an Approve action that clears a human gate, so work starts only after the plan is approved. | C (Backlog.md, Kiro, Devin) | M | Shipped in 0.2 (as a plan approval gate) |
| 23 | **Agent handoff notes** | When a session stops, the agent leaves "done / left / unsure" on the bead; Abacus shows the latest prominently. Pairs with the Roadmap's opt-in status comments. | C (CCPM, saltbo, Devin confidence) | M | Later |
| 24 | **Decomposition proposals** | An agent proposes child beads (for example under a `proposed` label); Abacus shows them as a set to accept or reject; nothing becomes real work until accepted. | C (Agent Kanban PM, octomux) | M | Later |
| 25 | **Agent state chips** | Show `bd set-state` dimensions (for example `phase:testing`) as chips, with their history. | B, G (b9s design note) | S | Later |
| 26 | **Formulas, molecules and swarms** | Progress for formula-driven work (`bd mol progress`: done/total, current step, ETA) and swarm status. | B | M | Explore |

## 4. Finding things

| # | Item | What it is | Source | Size | Tier |
|---|---|---|---|---|---|
| 27 | **Query bar and saved searches** | Type a `bd query` expression (`status=open AND priority<=1 AND updated>7d`) and save it as a named view (panel storage or `bd kv`). Saved searches are on the Roadmap. | B, C | M | Next |
| 28 | **Why is it ready or blocked** | Explain a bead's state from `bd ready --explain`: which blocker, which gate, which defer date. | B | S | Shipped in 0.2 |
| 29 | **Epics ready to close** | Prompt when all children are done (`bd epic close-eligible`). | B | S | Shipped in 0.2 |
| 30 | **Project numbers** | Lead time, 24 h activity, counts by status, assignee and actor (agent vs human) from `bd status` and `bd count`. | B, C (Linear insights by delegate) | M | Later |
| 31 | **Dependency tree** | Up/down tree for one bead (`bd dep tree`), critical path. The full graph belongs to the v2 board. | B, C (Kiro waves, Cline auto-start chains) | M | Later |
| 32 | **Duplicate finder** | Review likely duplicates (`bd find-duplicates`) and merge or close. | B | M | Later |
| 33 | **External tracker intake** | Paste a GitHub, Linear or Jira link to create a bead with the source kept in `external_ref`; show tracker sync status (`bd github/linear/jira`). | B, C (octomux, Conductor, Devin) | M | Later |
| 34 | **Full-screen board** | Kanban, swimlanes by epic, assignee or agent, timeline, dependency graph. Already the v2 plan. | C, G | L | v2 |

## 5. Beads 1.3 and sync

| # | Item | What it is | Source | Size | Tier |
|---|---|---|---|---|---|
| 35 | **Beads 1.3 support (epic)** | Verify on a scratch install: the schema migration on first open (v53 to v66), the changed `search`, `ready`, `update --status` and `dep cycles` behavior, and whether proxied-server is the new default topology. Gate behind first contact as today. | B | L | Shipped in 0.2 |
| 36 | **Live updates from the events journal** | Follow `bd events tail --follow` (1.3, opt-in per clone) instead of polling, when it is on. Several GUIs already do. | B, G (LazyBeads, beads-web, Obsidian) | M | Shipped in 0.2 |
| 37 | **Sync with `bd sync` and conflict resolution** | Use the 1.3 one-verb sync and its exit codes; resolve conflicts per bead with keep mine / take theirs (`bd conflicts resolve --ours/--theirs`), which v1 deferred. | B | M | Next (after 35) |
| 38 | **`bd serve` adapter** | Talk HTTP to `bd serve` for server-mode projects (CAS writes, SSE events). Already on the Roadmap. | B, G (LazyBeads) | L | Later |
| 39 | **History "as of"** | Browse the whole project as it was at a commit or before the last Sync. | B | M | Later |

## Not doing

Execution-layer features from agent orchestrators belong to OpenChamber or the agent harness, not a review panel: terminal walls, cloud sandboxes, best-of-N attempts, video artifacts, CI auto-fix. Time tracking, burndown and WIP limits had no evidence of demand. Branch management, federation, compaction, backups and Beads config editing stay with the agent (the extension never changes Beads config, except the one setting you confirm for Live updates).

## Suggested 0.2 scope

The smallest set that most improves "review, adjust, hand off":

1. Needs me inbox (1) with gates (2) and stale work (6).
2. Per-bead history (4) with undo (5).
3. Project memories (20).
4. Due and defer, move and retype, acceptance checklist, supersede and duplicate, comment and close (10 to 14).
5. Context preview (7), why ready or blocked (28), epics ready to close (29).
6. Query bar and saved searches (27).
7. Beads 1.3 support (35) as a spike first, since it affects 36 and 37.
