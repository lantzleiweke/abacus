# Beads GUI feature inventory (input for an OpenChamber beads extension)

Date: 2026-10-13. Judged against beads 1.3.x (user will upgrade from 1.2.2 before building).
Source: librarian research from READMEs, docs, and source. No tool was run locally. "?" = unconfirmed.

## 1. Landscape (GitHub API, 2026-10-13)

| Tool | Stars | Last push | License | Form | Backend |
|---|---|---|---|---|---|
| [beads_viewer (bv)](https://github.com/Dicklesworthstone/beads_viewer) | 1713 | 2026-10-13 | Other | TUI | JSONL/SQLite export |
| [beads-ui](https://github.com/mantoni/beads-ui) | 755 | 2026-08-11 | MIT | web | `bd` CLI |
| [perles](https://github.com/zjrosen/perles) | 191 | 2026-10-13 | MIT | TUI | Dolt SQL |
| [bead-me-up-scotty](https://github.com/brendan-appstart/bead-me-up-scotty) | 149 | 2026-10-08 | MIT | web | `bd` CLI |
| [beadbox](https://github.com/beadbox/beadbox) | 137 | 2026-10-12 | MIT | Tauri desktop | `bd`, remote Dolt |
| [mardi-gras](https://github.com/quietpublish/mardi-gras) | 95 | 2026-10-10 | MIT | TUI | `bd` CLI, 5 s poll |
| [vscode-beads](https://github.com/jdillon/vscode-beads) | 51 | 2026-09-30 | Apache-2.0 | VS Code | SQL, else `bd` |
| [beads-web](https://github.com/weselow/beads-web) | 50 | 2026-09-29 | MIT | web (Rust) | Dolt SQL / `bd` |
| [bd-board](https://github.com/jeanpfs/bd-board) | ? | ? | ? | web + Tauri | `bd` events journal |
| [maggie](https://github.com/mulgadc/maggie) | ? | ? | AGPL-3.0 | web (Go) | `bd` CLI |

No existing beads GUI is an OpenChamber extension. Closest precedent: [openchamber-openspec](https://github.com/jaythomasonprojects/openchamber-openspec) (kanban panel + service running a CLI, starts sessions from the board).

## 2. Feature matrix

Legend: Y yes, N no, P partial, ? unknown, ro read-only.

| Feature | beads-ui | bv | perles | beadbox | beads-web | mg | scotty | vscode | bd-board | maggie | openspec |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Kanban | Y | Y | Y | N | Y | N | Y | Y | Y | Y | Y |
| List / table | Y | Y | P | ? | ? | Y | P | Y | N | Y | N |
| Epic tree | Y | P | Y | Y | P | P | Y | N | P | ? | N |
| Dependency graph | N | Y | Y (trees) | P | N | P | Y | N | N | Y | N |
| Timeline / Gantt | N | Y (git history) | N | Y | N | P | N | N | N | N | N |
| Activity feed | N | N | N | Y | N | Y | N | N | N | N | N |
| Graph metrics | N | Y | N | N | P | P | N | P | N | P | N |
| Text filter | Y | Y | Y | ? | ? | Y | Y | Y | Y | Y | ? |
| Field filters | ? | P | Y | Y | ? | Y | P | Y | P | Y | ? |
| Query language | N | P | Y (BQL) | N | N | P | N | N | N | N | N |
| Saved views | N | Y | Y | Y | N | N | N | P | N | P (URL) | N |
| Create | ? | N | Y | ? | ? | Y | Y | ? | Y | ? | Y |
| Inline edit | Y | N | Y | Y | Y | Y | Y | Y | Y | Y | N |
| Drag to change status | ? | N | N | N | Y | N | P | Y | Y | ? | ? |
| Comments | ? | ro | Y | ro | ? | Y | Y | ro | Y | ? | N |
| Labels | ? | ro | Y | ? | ? | Y | Y | Y | ? | ? | N |
| Priority / assignee | ? | ro | Y | ? | ? | Y | Y | Y | Y | Y | N |
| Edit dependencies | ? | N | N | ? | N | Y | Y | Y | N | ? | N |
| Delete | ? | N | Y | ? | ? | ? | Y | ? | Y | ? | Y |
| Multi-project | Y | P | N | Y | Y | N | Y | Y | Y | N | N |
| Live updates | watch | file watch | refresh | live | SSE / poll | 5 s poll | poll | poll | events journal | ? | n/a |
| Ready work | Y | Y | Y | Y | ? | Y | Y | N | ? | ? | N |
| Claim | ? | P | N | ? | ? | Y | N | P | ? | ? | N |
| Launch agent on issue | N | N | Y | N | N | Y | N | N | N | N | Y |
| Human vs agent attribution | N | N | ? | P | N | N | Y | N | N | ? | N |
| Molecules / gates / wisps | ? | ? | ? | P | ? | P | ? | P | ? | ? | N |
| Keyboard | Y | Y | Y | Y | ? | Y | P | P | P | ? | ? |
| Theming | ? | Y | ? | ? | Y (11) | Y | Y | VS Code | ? | ? | OC |

## 3. Beads 1.3.x native surfaces

### `bd serve` HTTP API
Spec: `internal/httpapi/spec/openapi.v0.yaml` (OpenAPI 3.0.3), help in `cmd/bd/serve.go`, repo github.com/gastownhall/beads.

- Read: `issues`, `issues:query` (boolean query language), `issues:count`, `issues/{id}`, `issues/{id}/related`, `issues:batchGet`, `ready`, `ready:count`, `dependencies` (+ `blocking`, `tree`, `cycles`), `memories`, `stats`, `context` (capabilities), `config`.
- Write: create, `PATCH issues/{id}`, comments, `:close`, `:reopen`, `:claim`, `:release`, `:claimNext`, `:advanceMolecule`, batch create/apply/close, `dependencies:add/remove`, `issues:sweep` (irreversible bulk delete of closed).
- PATCH supports `expected_version` / `expected_status` preconditions (409 on mismatch) and `claim: true`.
- Streaming: `GET events:watch` is SSE with `Last-Event-ID` resume.
- Auth: none on loopback by default; `--auth-token-file` enables bearer tokens. No TLS. Refuses embedded Dolt and `--readonly`. Hooks do not fire on HTTP writes. Edits take a caller-asserted `actor`.

### Events journal
- Off by default: `bd config set events-journal true` or `BD_EVENTS_JOURNAL=1` for every writer.
- Record: `{seq, ts, op, issue_id, actor, issue, dep, comment}`; `op` in create, update, close, delete, dep_add, dep_remove, comment. `issue` is full post-mutation state.
- Retention 7 days or 100k rows. Stale cursor returns `events_journal_truncated` (HTTP 410): re-baseline.
- Not journaled: `bd dolt pull`, raw `bd sql`. Needs a periodic full refresh as backstop.

### JSON envelope
`BD_JSON_ENVELOPE=1` wraps output as `{"schema_version":1,"data":...}`; default in v2.0.

### Open vocabularies (render unknowns, never hardcode)
- Status: open, in_progress, blocked, closed, deferred, pinned, hooked, plus custom (`bd statuses --json`, categories active, wip, done, frozen).
- Type: bug, feature, task, epic, chore, gate, plus configured.
- Priority: 0 to 4 (0 is valid).
- Dependency kinds: blocks, parent-child, conditional-blocks, waits-for, tracks, discovered-from, caused-by, supersedes, related, plus others.

## 4. Worth stealing

1. Saved queries as board columns (perles BQL); `bd serve` has `issues:query`.
2. Graph metrics: critical path, PageRank, cycles (bv).
3. Journal-driven refresh with a timed backstop (bd-board); SSE via `events:watch`.
4. Launch an agent on an issue and tie the session back (mardi-gras; openspec does this in OpenChamber).
5. Human vs agent attribution on issues and comments (scotty).
6. Epic swimlanes (bd-board) and per-epic timeline (beadbox).
7. Shareable URL state for filters and open issue (maggie, scotty).
8. Optimistic-concurrency writes via `expected_version` (no GUI uses it yet).

## 5. Gaps nobody covers well

1. Molecules, gates, wisps: no tool presents gate resolution or molecule progress.
2. Custom statuses and types: most tools hardcode columns.
3. Full edit coverage in one GUI (create, drag, comments, labels, deps, claim).
4. Who is working on what right now: nobody joins claims with live agent sessions. OpenChamber sessions fit here.
5. Cross-repo dependency views.

## Native OpenChamber provider vs extension

- Nobody has started a beads integration in OpenChamber (issues, PRs, code, discussions, npm all empty; forks not scanned). About 10 OpenCode beads plugins exist (e.g. `joshuadavidthomas/opencode-beads`), all agent-side or TUI.
- No provider abstraction: Linear is a bespoke module (`packages/web/server/lib/linear/`, `components/sourceBoard/*`, `useSourceBoardStore.ts` hardcodes `'repository' | 'linear'`). Linear PR #3235 was 11,888 lines; Jira branch commit 4,317 lines / 35 files.
- Native board is list + preview (no kanban), filters, status pill, start session/worktree from issue, server-side polling every 2 min.
- `session.link` stores unknown URLs as `external` entries, so beads links work today without live state.
- CONTRIBUTING.md: new features need an Ideas discussion and maintainer go-ahead first. Community Jira (#2729, #2885) and Linear (#2725, #2886) PRs were closed; Linear landed via a team member.
- Verdict: extension first. Keep bd access behind a small provider module with a Linear-like normalized issue shape so a native port (or a proposed generic provider seam) stays possible. Bring the working extension to an Ideas discussion if it proves out.

## Open technical questions

- Can an OpenChamber extension page consume SSE through `serviceRequest`? Service streaming is documented as deferred, so likely poll or long-poll.
- Can the page call `bd serve` directly? Sandbox allows only https origins, so probably not; route through the extension service.
