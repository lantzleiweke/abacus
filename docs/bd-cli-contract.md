# bd CLI contract (beads 1.2.2, dolt 2.3.2; 1.3.1 differences below)

Captured 2026-10-14 against two scratch projects (never a real project):

- **embedded**: a copy of a real shared project's `.beads/` (214 beads, embedded Dolt), remotes stripped, then a local `file://` Dolt remote added. A second copy (`embedded-b`) plays a teammate.
- **server**: a purpose-built project (prefix `scr`, 14 seeded beads, then edited by write tests) on its own `dolt sql-server` (127.0.0.1:38307), with a local `file://` remote and a teammate clone on :38308.

Fixtures live in `test/fixtures/{server,conflict}/` (committed, synthetic) and `test/fixtures-private/{embedded,conflict/embedded,lock}/` (git-ignored, derived from a real shared project; tests must skip when absent). See `test/fixtures/README.md`. Paths below that say `embedded/` or `lock/` are under `test/fixtures-private/`. Each fixture `X.json|jsonl|txt` has `X.meta.json` (`cmd`, `exit`, `ms`) and, when stderr was non-empty, `X.stderr`.

Status: complete for this spike. Not verified: a real `git+https` remote (conflict half-merge state is simulated), network latency for pull/push, and whether `pull` touches `.beads/last-touched`.

## Surprises versus the design spec (read first)

1. **`bd sql` does not work in embedded mode.** `Error: 'bd sql' is not yet supported in embedded mode`, exit 1 (with or without `--readonly`). The audit log, change signal, and unpublished count cannot go through `bd sql` for embedded projects. Working alternative: the **`dolt` CLI run inside the embedded database directory** (`.beads/embeddeddolt/<dolt_database>/`, where `dolt_database` is in `metadata.json`): `dolt sql -r json -q "<query>"`. It works, takes about 0.12 to 0.16 s (faster than any `bd` call), and sends no beads telemetry. Output shape differs from `bd sql --json` (see "SQL access").
2. **`bd list --id <id>` hides closed and pinned beads** unless `--all` is given (returns `[]`, exit 0). Use `bd --readonly list --all --id <id> --json`.
3. **`bd export` has no `comments` array on projects with zero comments** (only `comment_count`). Empty collections (`labels`, `dependencies`, `comments`) are omitted, not `[]`. Comments are in export when they exist (server fixture).
4. **Only one dependency per ordered pair.** `bd dep add A B -t related` when `A -> B` already exists as `blocks` fails: `dependency A -> B already exists with type "blocks" (requested "related"); remove it first with 'bd dep remove' then re-add`. So `bd dep remove A B` (no kind) is never ambiguous within one direction; B -> A can exist with a different kind. Per-kind removal UI is unnecessary (risk 6 resolved).
5. **Audit-log ids are not all time-sortable.** In that project, the 24 oldest `events` rows (2026-06-22/24, an import) have UUIDv5 ids that sort *after* every UUIDv7 id. `ORDER BY id DESC` is wrong; use `ORDER BY created_at DESC, id DESC`. For UUIDv7 ids (version nibble at char 15 is `7`), the first 12 hex digits are the real UTC Unix ms. That gives a **reliable UTC time** for each event, correcting the local-time-labeled-as-UTC `created_at` (observed here: PDT, `created_at` is 7 h behind real UTC).
6. **Different-field edits on the same bead merge cleanly** on pull (verified embedded: priority on one side, notes on the other; exit 0, merge commit). Only the *same field* on both sides conflicts. The spec assumed any same-bead edit conflicts.
7. **Conflicts abort in server mode too, with `file://` and `git+file://` remotes.** `merge aborted and working set restored`, same as embedded. The half-merged server state in the spec (git+https) could not be reproduced with a real remote (no network/credentials in scratch). I simulated it with `dolt sql` (`SET @@dolt_allow_commit_conflicts=1; CALL DOLT_MERGE(...)`) and captured how `bd` behaves in that state (below). Treat that capture as simulated.
8. **`bd dolt remote add` writes `sync.remote: <url>` into `.beads/config.yaml`** (a git-tracked file in many projects). The extension must never call it. (Done here only in scratch copies.)
9. **Commit messages differ by mode.** Embedded: `bd: update (auto-commit) by <actor> [<ids>]`, committer `root`. Server: `bd: update <id>`, committer `beads`, no actor. So "who" for unpublished commits is available from commit messages in embedded mode only; use the `events` table otherwise.
10. **Close can be refused**: `cannot close <id>: blocked by open issues [<ids>] (use --force to override)`, exit 1, on stderr. The panel must surface it, not retry with `--force` silently.
11. **Children inherit the parent's labels on create** (`--parent`), unless `--no-inherit-labels`. A panel "create child" will copy labels; pass `--no-inherit-labels` if that is not wanted.
12. **`owner` on create comes from git `user.email`**, not `--actor`.
13. **Dirty `config` rows block `bd dolt pull`** in server mode: `refusing to auto-commit 3 dirty internal config key(s) before pull: issue_prefix, status.custom, types.custom; ... commit or revert these explicitly with 'bd dolt commit' first` (exit 1). Real projects can hit this after `bd config set`. Fixture: `conflict/dirty-config-pull/`. `bd dolt commit` did not clear it for me; `CALL DOLT_COMMIT('-Am', ...)` via `bd sql` did. The panel should just show the error in plain language and offer "Hand to agent".
14. Warning on every `bd` call in a repo without `git config beads.role`: `warning: beads.role not configured (GH#2950).` on **stderr** (stdout stays clean JSON).

## General CLI facts

- Run every call with `cwd` = project root (or `-C <dir>`). Parse **stdout only**; stderr carries warnings and some errors.
- `--readonly` blocks writes: `Error: operation 'update' is not allowed in read-only mode`, exit 1, stderr.
- `--json` is global. Many errors in `--json` mode are `{"error": "...", "schema_version": 1}` on **stdout** with exit 1; others are plain text on **stderr** with empty stdout (e.g. unknown id: `Error resolving nope-zzz: no issue found matching "nope-zzz"`). Handle both.
- Every JSON object has `schema_version: 1` except raw list/export rows.
- Dolt auto-commit is on in both modes: each write is its own local Dolt commit (the help text saying "Default: off" is wrong for 1.2.2).
- Time: `created_at`/`updated_at`/`closed_at` on issues and comments are real UTC (`...Z`). `events.created_at` and `dependencies[].created_at` are **local time** without a real zone.

## Operations

Fixture names below are relative to `test/fixtures/<mode>/`. `reads/` fixtures were captured on the final state of each scratch (after the write tests). Embedded `export.jsonl`, `list.json`, `list-default.json` and `ready.json` are trimmed to 40 beads (10 for ready).

### Version

`bd --version` -> stdout `bd version 1.2.2 (Homebrew)`, exit 0. ~250-365 ms. Fixture `reads/version.txt`.
`bd --readonly info --json` -> object with database path/mode info. Fixture `reads/bd-info.json`.

### Snapshot (full export)

`bd --readonly export` -> JSONL, one issue per line, no trailing array. Every line has `_type: "issue"`.
Fields: `id, title, description, design?, acceptance_criteria?, notes?, status, priority(int 0-4), issue_type, assignee?, owner, created_at, created_by, updated_at, started_at?, closed_at?, close_reason?, defer_until?, due_at?, estimated_minutes?, external_ref?, spec_id?, labels?[], dependencies?[{issue_id, depends_on_id, type, created_at, created_by, metadata:"{}"}], comments?[{id, issue_id, author, text, created_at}], dependency_count, dependent_count, comment_count`.
Optional keys are omitted when empty. Fixtures `reads/export.jsonl` (embedded trimmed to 40 beads, original 214; server complete).
Side effects: none observed (see Side effects). Timing: server (16 beads) ~230 ms; embedded (214 beads) ~630 ms.

### List (flat)

`bd --readonly list --json --all --flat --limit 0` -> JSON array of issues. Same scalar fields as export, plus a `parent` field; full `dependencies` bodies are included (verified in Task 4 review), but **no** `comments` bodies (only `comment_count`), labels are included when present. Default `list` hides closed and caps at 50. IDs matched `export` exactly in both scratches (no hidden gates/templates here). Fixtures `reads/list.json`, `reads/list-default.json`.

### Detail

`bd --readonly list --all --id <id> --json` -> array of one issue, with `labels`, `dependencies` (full objects), `parent`, counts. `--id` takes a comma list. Unknown id -> `[]`, exit 0. Fixtures `reads/list-id.json`, `reads/list-id-missing.json`. Do not use `bd show` (rewrites `.beads/last-touched`; confirmed below).

### Comments

`bd --readonly comments <id> --json` -> array of `{id, issue_id, author, text, created_at}` (id is UUIDv7). No comments -> `[]` exit 0. Fixtures `reads/comments.json`, `reads/comments-none.json`.

### Ready, statuses, types

- `bd --readonly ready --json` -> array of issues (same shape as list). Excludes blocked, deferred, closed, and statuses in categories wip/frozen/done. Without `--limit` it returns at most 100 issues (default 100); `--limit 0` lifts the cap, and the adapter always passes it.
- `bd --readonly statuses --json` -> `{built_in_statuses:[{name,category,icon,description}], custom_statuses?:[{name,category}], schema_version}`. Built-ins: open, in_progress, blocked, deferred, closed, pinned, hooked. Categories: active, wip, frozen, done. Custom statuses have **no icon**. Configure only in scratch (`bd config set status.custom "in_review:wip,qa_wait:active"`). To remove them, `bd config set status.custom ""`: `bd config unset status.custom` reports "(not set)" afterwards but `bd statuses` keeps listing the old custom statuses (seen live, 2026-10-14). Setting a custom status takes up to a minute to reach the panel (the once-a-minute full refresh re-reads statuses).
- `bd --readonly types --json` -> `{core_types:[{name,description}], custom_types?:["incident"], schema_version}`. Custom types are plain strings. Core: task, bug, feature, chore, epic, decision, spike, story, milestone.
- Dependency kinds (from `bd dep add --help`): blocks, tracks, related, parent-child, discovered-from, until, caused-by, validates, relates-to, supersedes. No JSON listing; hardcode with fallback.
- Fixtures `reads/ready.json`, `reads/statuses.json`, `reads/types.json`.

### Structure rules observed on create/dep

- `tasks can only block other tasks, not epics` (`dep add` blocks from a task/milestone onto an epic fails).
- Hierarchical ids: `--parent scr-8nw` -> `scr-8nw.1`, grandchild `scr-8nw.1.1`.

### SQL access (audit log, signals, remotes)

- **Server mode:** `bd --readonly sql --json "<query>"` -> JSON array of row objects. Timestamps come as `YYYY-MM-DDTHH:MM:SSZ` (but still local time for `events.created_at`). `--csv` also works; no flag -> text table. A DDL/DESCRIBE returns `Field/Type/Null/Key/Default/Extra` rows.
- **Embedded mode:** `bd sql` unavailable. Run, with `cwd` = `.beads/embeddeddolt/<dolt_database>`: `dolt sql -r json -q "<query>"` -> `{"rows":[{...}]}` (note the wrapper object). Timestamps are `YYYY-MM-DD HH:MM:SS` (no T/Z). `-r csv` works. Fixtures `reads/sql-*.json|csv` (embedded ones were produced with this CLI; the `meta.json` records the command). `reads/bd-sql-unsupported.*` holds the failure.
- The server-mode `dolt` CLI also works against the server's data dir while the server runs (it connects to it); not needed.

### Audit log (`events`)

`DESCRIBE events` (fixture `reads/sql-describe-events.json`): `id char(36) PK, issue_id varchar(255), event_type varchar(32), actor varchar(255), old_value longtext NULL, new_value longtext NULL, comment text NULL, created_at timestamp default CURRENT_TIMESTAMP`.
Query: `SELECT id, issue_id, event_type, actor, old_value, new_value, comment, created_at FROM events ORDER BY created_at DESC, id DESC LIMIT 50` (**not** `ORDER BY id`). Fixture `reads/sql-events-recent.json`.
Event types seen: created, updated, status_changed, claimed, closed, reopened, label_added, label_removed, renamed (counts in `reads/sql-events-types.json`).
Value encoding:

- `created`: old/new empty in imports; in 1.2.2 new events may carry a value.
- `updated`: `new_value` = JSON of only the changed fields (`{"priority":1}`); `old_value` = JSON of the **whole previous issue**.
- `status_changed`: `new_value` `{"status":"..."}`, `old_value` whole previous issue JSON.
- `closed`: `new_value` is the close reason (plain string), `old_value` empty.
- `label_added`/`label_removed`: label name (see fixture).
- No events for comments or dependencies.

Real time of a UUIDv7 event: `parseInt(id.replace(/-/g,'').slice(0,12),16)` = UTC ms. Verified against issue `updated_at`. Treat ids whose 13th hex char (index 14 incl. dash, i.e. `id[14]`) is not `7` as untimed.
Schema guard: `DESCRIBE events` must list `id, issue_id, event_type, actor, old_value, new_value, created_at`.

### Change signal

Candidates (fixtures `reads/signal-*.json`):

| Query | Meaning | Notes |
|---|---|---|
| `SELECT DOLT_HASHOF('HEAD')` | last commit hash | Moves on every committed write and pull. Misses uncommitted working-set changes. |
| `SELECT DOLT_HASHOF_DB()` | hash of the working-set root | Includes uncommitted changes. Recommended. |
| `bd --readonly vc status --json` -> `{branch, commit, schema_version}` | last commit hash through bd | Works in both modes (so it is the embedded-friendly signal if you want to avoid the dolt CLI); ~0.2-0.5 s. |
| `SELECT COUNT(*) FROM dolt_status` | dirty tables | 0 = clean. |

Recommended: `dolt sql` (embedded) or `bd --readonly sql` (server) with `SELECT DOLT_HASHOF_DB() AS working, DOLT_HASHOF('HEAD') AS head`; export only when it changes. Cost: dolt CLI ~0.12-0.16 s with no telemetry; `bd sql` ~0.2-0.3 s with a telemetry event.
Caveat: dirty config rows (`bd config set`) change `DOLT_HASHOF_DB()` without changing beads; harmless extra export.

### Remotes and unpublished count

- `bd dolt remote list --json` -> `[{name, url, sql_url, status:"ok"}]`; `[]` when none (exit 0). Fixture `reads/remote-list.json`. `bd dolt show` prints `Remotes: (none)` even when a remote exists: do not use it.
- Unpublished (local commits not on the remote), assuming remote `origin` and branch `main`:
  `SELECT COUNT(*) AS unpublished FROM dolt_log('remotes/origin/main..main')`. List: `SELECT commit_hash, committer, date, message FROM dolt_log('remotes/origin/main..main') ORDER BY date DESC`. Fixtures `reads/unpublished-count.json`, `reads/unpublished-list.json`.
  Resolve the actual remote and branch name first (`dolt_remotes`, `dolt_remote_branches`: `SELECT name, hash, latest_commit_date FROM dolt_remote_branches`; `SELECT active_branch()`).
  The remote-tracking ref is only as fresh as the last pull/push/fetch. The count is therefore "unpublished relative to the last time we talked to the remote".
- Incoming commits (after a fetch): `SELECT COUNT(*) FROM dolt_log('main..remotes/origin/main')`. `bd dolt pull` is the only bd command that fetches. Plain `dolt fetch origin` in the embedded dir would also work but is not verified as safe while `bd` is running.
- Counts observed: 23 unpublished on embedded and 32 on server after the write tests; 0 right after a push.
- "Last team sync" time: `dolt_remote_branches.latest_commit_date` is the latest *commit* on the remote, not the last sync. Store the last successful pull time in the service.

### Writes

All with `bd --actor "<name> (panel)"`. Fixtures `writes/w-*.json` (server and embedded).

| Op | Command | stdout on success | Notes |
|---|---|---|---|
| status | `update <id> --status <s>` | `--json`: array with the full updated issue (no deps/comments) | invalid status: `{"error":"invalid status \"x\" (built-in: ...)"}` stdout, exit 1 |
| priority | `update <id> --priority 0..4` | same | invalid: `{"error":"invalid priority \"9\" (expected 0-4 or P0-P4 ...)"}` exit 1 |
| labels | `update <id> --add-label x`, `--remove-label x`, `--set-labels a,b`; also `label add <id> <label> --json` -> `[{issue_id,label,status:"added"}]` | | |
| assignee | `update <id> --assignee "<name>"` | same | |
| title/description/acceptance/design/notes | `update <id> --title ... --description ... --acceptance ... --design ... --notes ...` | same | Multi-line text passes fine as an argv string. Clearing: `--design ""` removes the field (key disappears). Several flags can be combined in one call (one commit). |
| create | `create "<title>" -t <type> -p <0-4> [--parent <id>] [-d ...] --json` | one object `{id, title, status, priority, issue_type, labels?, owner, created_by, created_at, updated_at, schema_version}` | created_by = actor; owner = git email; labels inherited from parent. |
| comment | `comments add <id> "<text>" --author "<name>" --json` | `{id, issue_id, author, text, created_at, schema_version}` | `--author` omitted -> author defaults to the actor. |
| dep add | `dep add <from> <to> -t <kind> --json` | `{issue_id, depends_on_id, type, status:"added", schema_version}` | `<from>` depends on `<to>`. Existing pair with another kind -> error above. Task-blocks-epic rejected. |
| dep remove | `dep remove <from> <to> --json` | `{issue_id, depends_on_id, status:"removed", schema_version}` | no kind argument; one dep per ordered pair. |
| dep list | `--readonly dep list <id> --json` | array of issues each with `dependency_type` | |
| close | `close <id> --reason "..." --json` | array with the issue (`closed_at`, `close_reason`) | refused when open blockers exist (see surprises #10) |
| reopen | `reopen <id> --reason "..." --json` | array with the issue; `closed_at`/`close_reason` cleared | |

Each write makes exactly one Dolt commit (dep add/remove: `dependency: add <kind> <a> -> <b>` on server). Typical latency 170-480 ms.
Errors: unknown id -> stderr `Error resolving <id>: no issue found matching "<id>"`, exit 1, empty stdout. Fixtures `writes/w-err-*.json`.

### Pull and publish

- `bd dolt pull` -> stdout `Pulling from Dolt remote...\nPull complete.`, exit 0. Up to date also exit 0, same text. ~0.4-0.9 s. Pulls commit pending *user* changes first.
- `bd dolt push` -> `Pushing to Dolt remote...\nPush complete.`, exit 0. ~0.3-0.4 s (0.8 s for the first push of the 84 MB copy).
- `--remote <name>` selects a remote.
- Divergent, non-conflicting histories: `pull` merges (merge commit `Merge branch 'origin/main' into main`), exit 0, then `push` succeeds. Fixtures `conflict/<mode>/*pull-diverged*`, `*push-after-merge*`.
- Push when behind: exit 1, stderr:
  ```
  Error: push to origin/main: Error 1105: To <url>
   ! [rejected]            main -> main (non-fast-forward)
  error: failed to push some refs to '<url>'
  hint: Updates were rejected because the tip of your current branch is behind
  ```
  (server mode prefix: `Error: failed to push to origin/main: Error 1105 (HY000): To <url>`). Detect with `non-fast-forward` / `[rejected]`.

### Conflict detection

Same-field conflict on the same bead, remote ahead:

- Embedded `bd dolt pull`: exit 1, stderr `Error: merge origin/main: merge conflicts in issues require operator resolution; merge aborted and working set restored`. Repeating it gives the same. Local data intact; `bd` writes still succeed afterwards; every `push` fails non-fast-forward until resolved. Fixtures `conflict/embedded/A-23*`, `A-24*`, `A-25*`, `A-26*`, `A-27*`.
- Server `bd dolt pull` (file:// and git+file:// remotes): exit 1, stderr `Error: failed to pull from origin/main: merge conflicts in issues require operator resolution; merge aborted and working set restored`. Same aftermath: writes succeed, push rejected. Fixtures `conflict/server/A-24*..A-29*`, `conflict/server-git/*`.
- Match on `merge conflicts in` in stderr.
- **Preview before merging** (works after any pull attempt has fetched the ref): in the embedded dir `dolt sql -r json -q "SELECT * FROM DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY('main','remotes/origin/main')"` -> `[{table, num_data_conflicts, num_schema_conflicts}]`; and `SELECT base_id, base_title, our_title, their_title, base_priority, our_priority, their_priority, ... FROM DOLT_PREVIEW_MERGE_CONFLICTS('main','remotes/origin/main','issues')` lists the bead ids and both sides, read-only. Fixture `conflict/embedded/preview-*`. (`bd --readonly sql` can run the same in server mode.)
- **Half-merged server state (simulated, not from a real git+https pull)**: `bd --readonly sql --json "SELECT * FROM dolt_merge_status"` -> `is_merging: 1, source, source_commit, target, unmerged_tables:"issues"`; clean state is `is_merging: 0` with nulls. `SELECT * FROM dolt_conflicts` -> `[{table:"issues", num_conflicts:N}]`; `SELECT ... FROM dolt_conflicts_issues` gives per-bead sides; `dolt_status` shows `status:"conflict"`. While in that state: reads (`list`, `export`, `ready`, `vc status`) still work and show *our* side; **every write fails** with exit 1:
  - update: `Error updating <id>: dolt commit: Error 1105 (HY000): error: the table(s) issues are in conflict`
  - create: `Error: commit write tx: Error 1105 (HY000): Merge conflict detected, @autocommit transaction rolled back. @autocommit must be disabled ...`
  - comment add (`--json`): `{"error":"adding comment: commit write tx: Error 1105 (HY000): Merge conflict detected, ..."}`
  - `bd dolt pull`: `Error: failed to commit pending changes before pull: failed to commit: Error 1105 (HY000): error: the table(s) issues are in conflict`
  - `bd dolt commit`: `Error: failed to commit: Error 1105 (HY000): error: the table(s) issues are in conflict`
  - `bd dolt push` still exits 0 (pushes committed HEAD only).
  Fixtures `conflict/server-halfmerge/*`. Recovery used in scratch: `dolt sql -q "CALL DOLT_MERGE('--abort')"`. The extension should poll `dolt_merge_status.is_merging` (server mode) after a failed pull and when a write fails with `in conflict`, and disable panel writes while it is 1.

### Pre-pull blockers (server mode)

`bd dolt pull` exit 1: `Error: failed to commit pending changes before pull: refusing to auto-commit 3 dirty internal config key(s) before pull: issue_prefix, status.custom, types.custom; only user kv.* keys auto-commit before a pull (GH#2455) — commit or revert these explicitly with 'bd dolt commit' first`. Fixture `conflict/dirty-config-pull/A-01-pull-uptodate.*`.

### Lock contention (embedded) — spike results

Fixtures in `test/fixtures/lock/` (scripts `spike.sh`, `spike2.sh`). Embedded Dolt keeps a file lock at `.beads/embeddeddolt/.lock`; `bd` strings include `lock timeout exceeded`, but **I never hit a lock error**.

| Scenario | Result |
|---|---|
| 1 `bd` writer (20 back-to-back updates) + `bd --readonly export` every 0.5 s + `dolt sql` CLI read every 0.3 s | 20/20 writes exit 0, 6/6 exports exit 0, 25/25 dolt reads exit 0. No stderr. |
| 3 concurrent `bd` writers (8 each) + 10 `bd --readonly export` + `dolt sql` CLI **writer** | 24/24 bd writes exit 0, 10/10 exports exit 0. Dolt CLI writes: 2/6 ok, 4/6 exit 1 `cannot update manifest: database is read only`. |

Takeaways:

- `bd` serializes itself: concurrent `bd` calls queue instead of failing. The cost is latency. Idle: write ~0.3-0.5 s, export ~0.5 s. Under contention: writes up to 4.3 s, exports up to 8.5 s (one outlier each run). **Use a per-project queue and a 20-30 s timeout; do not retry on slowness.**
- Reading through the `dolt` CLI while `bd` writes is safe (0.14-0.27 s, never failed).
- **Never write through the `dolt` CLI while `bd` may be running**: it fails with `database is read only` about two thirds of the time, and if it wins it bypasses `bd` bookkeeping. Writes go through `bd` only.
- The OpenChamber extension and an agent's own `bd` calls can overlap freely; expect slow calls, not errors.
- If a lock error does appear in the field, the likeliest text contains `lock`; treat any exit 1 with `lock` in stderr as "busy, retry once after 1 s". Not verified.

### Side effects (does a read mutate the repo?)

Measured with mtime/size snapshots (`side-effects-*.txt`):

- **Server mode:** `export`, `list` and the other reads change nothing under the project (only the server's own data dir, which it manages).
- **Embedded mode:** every `bd` call, reads included, touches Dolt internals under `.beads/embeddeddolt/<db>/.dolt/noms/` (`journal.idx`, `manifest`, `vvvv…`). These are gitignored, but **do not watch `.beads/embeddeddolt/**` for change detection**: reads trigger it. `dolt sql` CLI also touches `.dolt/stats/`.
- `bd show` rewrites `.beads/last-touched` (gitignored). `bd --readonly` reads do not. **Writes** touch `last-touched` (mtime changes, size 8-14 bytes). That makes `.beads/last-touched` a cheap, *local-only* "a bd write just happened on this machine" watch target. It does not fire on pulls from teammates (not tested either way for pull).
- **Writes do not update `.beads/issues.jsonl`** in 1.2.2 (git-tracked in that project; it showed 17 issues while the database had 214). It is stale. Do not read it, and do not watch it.
- `.beads/interactions.jsonl` was not touched by reads or by my writes.
- Net: the change signal for the panel is the Dolt hash query (see Change signal), optionally combined with `last-touched` mtime as a hint to poll sooner.

### Timing (single runs, warm, Apple silicon laptop)

| Operation | Embedded (214 beads) | Server (16 beads) |
|---|---|---|
| `bd --version` | 0.25 s | 0.37 s |
| `export` | 0.63 s | 0.24 s |
| `list --all --flat --limit 0` | 0.49 s | 0.20 s |
| `list --all --id` | 0.47 s | 0.26 s |
| `comments <id>` | 0.38 s | 0.20-0.23 s |
| `ready` | 0.34 s | 0.25 s |
| `statuses` / `types` | 0.36 s | 0.24 s |
| `dolt remote list` | 0.31 s | 0.22 s |
| `vc status` | 0.50 s | 0.22 s |
| `bd sql ...` | n/a (unsupported) | 0.19-0.30 s |
| `dolt sql` CLI in embedded dir | 0.12-0.16 s | n/a |
| write (update/create/comment/dep) | 0.2-0.5 s | 0.17-0.32 s |
| `dolt pull` / `push` | 0.4-0.9 s / 0.35-0.4 s | 0.2-0.75 s / 0.28-0.3 s |

## bd 1.3.1 differences (verified 2026-10-14)

**Adapter status (Phase 0): every BREAKS item below is handled, the integration suites pass on 1.3.1, and 1.2.2 behavior is covered by unit tests built on captured 1.2.2 output (no 1.2.2 binary has been installed since the 2026-10-14 upgrade).** Close-blocked text: `adapter.ts` reads both messages. Claimed beads: new write error code `claimed`, and a status move out of In progress runs as its own `update` before the assignee change. Commit messages: `describeCommit` reads the server-style forms, and `nameCreated` gets a created id from one `dolt_diff` query. Auto-merge: `parseSupersededEdits` turns the `Notice: auto-merged` lines into `SyncState.idle.superseded`. Audit: `storeWritesUtc(bdVersion)` (1.3 and later) lets `eventTimeMs` read `created_at` as UTC for ids without a time.

Captured with `bd version 1.3.1 (Homebrew)` against fresh **embedded** scratch projects under `~/.cache/openchamber-beads-scratch/bd13-*` (`bd init`, then the adapter's own commands). The `dolt` CLI on PATH is 2.4.2 (Homebrew keeps 2.3.2 beside it, unlinked). Schema of a freshly initialised embedded store is `schema_migrations` v66 (the 1.2.2 contract above was v53). **Not verified:** server mode, a v53 -> v66 migration of an existing store (no 1.2.2 binary or old store was available), a real `git+https` remote. The six integration failures seen on 1.3.1 (`audit` 1, `sync` 2, `writes` 3) all trace to the items marked **BREAKS** below. Everything not listed behaved as in 1.2.2 (export/list/ready/statuses/types/comments/`dep list`/`vc status`/`dolt remote list` shapes, `list --all --id` hiding nothing and returning `[]` for an unknown id, `--limit 0`, `dolt push`/`pull` text and exit 0).

### BREAKS: close refused by a blocker, new message text

`bd close --json -- <id>` on a bead with an open blocker: exit 1, stdout empty, stderr (plain text, no JSON):

```
cannot close blocked issue: wr-3fm is blocked by [wr-cw3] (use --force to override)
```

1.2.2 said `cannot close <id>: blocked by open issues [<ids>] (use --force to override)`. The adapter's `/blocked by open issues\s*\[([^\]]*)\]/i` no longer matches, so the failure maps to `code: 'failed'` instead of `'blocked'`. Match both: `/(?:blocked by open issues|is blocked by)\s*\[([^\]]*)\]/i`.

`bd update --json --status=<done status or closed> -- <id>` on a blocked bead now **also enforces the close policy** (it did not in 1.2.2). Exit 1, stdout empty, stderr two lines: `Error updating <id>: cannot close blocked issue: <id> is blocked by [<ids>]` then `{"error":"1 of 1 issues failed to update","failed":[{"id":"...","error":"updating issue: cannot close blocked issue: ... is blocked by [...]"}],"schema_version":1}`. `--force` overrides (also for open children); the adapter never passes it. An unblocked bead still moves to a custom done status with a plain `update --status=shipped` (exit 0, no `closed_at` or reason on the bead, as before). The adapter closes first, so it hits the `close` message above.

### BREAKS: changing or clearing the assignee of a claimed (in_progress) bead

`bd update --json --assignee= -- <id>` (or `--assignee=<someone else>`) on a bead that is `in_progress` and assigned to someone other than the actor: exit 1, stdout empty, stderr:

```
cannot reassign wr-2m4: held by "Dana" (in_progress); coordinate with the holder (bd mail Dana) — pass --force only if their claim is abandoned (crashed agent, expired lease), or use bd reclaim
{"error":"1 of 1 issues failed to update","failed":[{"id":"wr-2m4","error":"cannot reassign ... "}],"schema_version":1}
```

- Same command in one call with `--status=open` is still refused (the guard looks at the stored status). Two calls work: `update --status=open`, then `update --assignee=`.
- Setting the same assignee again (`--assignee=Dana`) passes; running as the holder (`--actor Dana --assignee=`) passes; on an `open` bead any reassign passes. Assigning while moving to `in_progress` in the same call passes (the bead was not held yet).
- `--force` overrides it; never pass it. `bd reclaim` and `bd unclaim` are the intended paths.
- No lease fields appear in `export`/`list`. Leases live in the new `leases` table (`issue_id, holder, granted_at, lease_expires_at, heartbeat_at, granted_node`), which is dolt-ignored (local only) and was empty after `update --status=in_progress --assignee=...`.
- Not a real error to retry. The adapter should map `cannot reassign` / `held by` to its own code (for example `claimed`) with plain language, and/or order the steps so a status move out of `in_progress` runs before the assignee change.
- New exit code **13**: `update --if-assignee <v>` / `--if-status <v>` guards (a stale precondition writes nothing). Not used by the adapter yet; usable as an atomic compare-and-set for status/assignee.

### BREAKS: embedded commit messages changed

Embedded writes now commit as committer `beads` with **server-style** messages, no actor, no id list:

| Write | Commit message |
|---|---|
| create | `bd: create issue` (**no id**) |
| update | `bd: update <id>` (a multi-id `update` makes one commit per id) |
| comment | `bd: comment <id>` |
| close / reopen | `bd: close <id>` / `bd: reopen <id>` |
| dep add / remove | `bd: dep add <from> <to>` / `bd: dep remove <from> <to>` |
| label add | `bd: update <id>` (it is an update commit) |
| pull merge | `Merge branch ...` (non-conflicting), or `auto-resolve merge conflicts: metadata, dependencies, schema_migrations, config, issues (field-level three-way merge), labels/comments/events (union)` (committer `root`) |
| init | `bd init`, then `schema: apply migrations` (committer `root`), plus one `schema: apply migration NNNN_<name>.up.sql` commit per migration (0001 to 0066 on 1.3.1) |

The 1.2.2 embedded form `bd: update (auto-commit) by <actor> [<ids>]` is gone. In `describeCommit` (`src/service/sync.ts`) the server regex `/^bd: (\S+) (\S+)\s*$/` now matches `bd: create issue` and returns `beadIds: ['issue']`, so a created bead is not in the unpublished list's `beadIds`, and `bd: dep add A B` falls through to "Saved a change". Fix direction: treat `create` (no id) and `dep add|remove <a> <b>` explicitly; for the created id read `SELECT to_id FROM dolt_diff('<hash>~','<hash>','issues')` (works, `diff_type`, `to_id`) or accept "Created a bead" without an id. Keep the 1.2.2 regex first so both versions work. "Who" for unpublished commits is no longer in the message at all in embedded mode.

### BREAKS: pull auto-settles same-field conflicts (last-write-wins)

`bd dolt pull` now runs an auto-resolver. Two clones editing the **same field of the same bead** (title; description and status; priority all tried) no longer conflict: exit 0, stdout `Pulling from Dolt remote...\nPull complete.`, one stderr line per bead:

```
Notice: auto-merged issue sx-g0z; title, updated_at settled last-write-wins (the older side's edit was superseded)
```

The side with the later `updated_at` wins; a merge commit `auto-resolve merge conflicts: ...` (committer `root`) is made, `dolt_merge_status.is_merging` is 0, `dolt_conflicts` is empty, and the pull is reported as success. In the sync test the second clone (B, later edit) kept `B title`, and A's earlier edit was silently overwritten. Labels, comments and events are unioned; dependencies, metadata and config are auto-settled. The adapter sees `kind: 'idle'` where 1.2.2 gave a backed-out conflict.

Conflicts the resolver declines still abort exactly as in 1.2.2. Verified: one clone **deletes** a bead (`bd delete --force`) and pushes, the other edits it then pulls: exit 1, stderr `Error: merge origin/main: merge conflicts in issues require operator resolution; merge aborted and working set restored`, working set clean, `DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY` -> `[{table:'issues', num_data_conflicts:1, num_schema_conflicts:0}]`, and `SELECT * FROM DOLT_PREVIEW_MERGE_CONFLICTS('main','remotes/origin/main','issues')` still lists `base_/our_/their_` columns (no `diff_type` column, but `conflictOf` does not need one). So the existing detection (`ABORTED`/`CONFLICT_TEXT` match) stays valid; a delete-vs-edit is the reproducible decline case for tests. Also new: `bd dolt pull --strategy ours|theirs` (embedded only), `bd conflicts list|show|resolve`, and `bd sync` (pull, conflict check, `is_blocked` repair, push; exits 2 on unresolved conflicts, 4 on a stuck working set). The panel should consider showing the `Notice: auto-merged` lines (stderr of a successful pull) as "older edit superseded", since a user's change can now be lost without any prompt.

### BREAKS: audit `events` ids are UUIDv5 and `created_at` is real UTC

Every `events` row written by 1.3.1 has a UUIDv5 id (version nibble `5`, `id[14] === '5'`), none v7 (16 of 16 and 5 of 5 rows in two clones). `eventTimeMs` returns null for all of them, so the audit test "dates UUIDv7 events in real UTC" fails (`times.every(t => t !== null)`). The id no longer carries time. But `events.created_at` (now `datetime`, was `timestamp`) is **real UTC**, not local time labeled UTC: with `TZ=Asia/Tokyo` and `TZ=UTC` it equals `date -u` to the second (PDT machine: `2026-10-15 05:26:38` for a write made at 22:26:38 PDT), and matches the bead's own `updated_at`. dolt JSON output is `YYYY-MM-DD HH:MM:SS`, no zone. Fix direction: keep v7 decoding first; for a non-v7 id fall back to `created_at` read as UTC **only when the store is known to write UTC** (bd >= 1.3, or the row is newer than the 0062 migration commit in `dolt_log`). Rows from 1.2.2 (v7 ids written with local `created_at`, v5 imports) must stay untimed or v7-timed. A migrated store (made by 1.2.2, opened by 1.3.1; the demo pantry) keeps its 1.2.2 rows as they were: local-time `created_at` (a bead made 03:45Z has a `created` event at 20:45 on the day before, in PDT), UUIDv5 ids in that store, so neither the id nor the stamp dates them. Opening it applies migrations 0054 to 0066, each its own `schema: apply migration ...` commit in `dolt_log`, dated in real UTC. The panel reads the **newest** `0062_events_dolt_ignore` commit date as the start of UTC stamps (`readUtcSince`; newest, because clones upgraded on different days merge several), and dates a non-v7 row only when its stamp is not before it. A store whose history was squashed (`bd flatten`, `bd compact`) has no such commit: its non-v7 event rows stay untimed (History shows them without a time, label changes made with the bead at the bead's creation), never wrong.

Other `events` changes: columns are `issue_id, event_type, actor, old_value, new_value, comment, created_at, id` (same set, `id` now last; the guard is order independent), and `events` is now in `dolt_ignore` (migration `0062_events_dolt_ignore`): it is **local to each clone and does not travel on push/pull**. After A made edits and B pulled, B's `events` lacked A's rows (A 16 rows, B 5). The audit view therefore only knows changes made on this machine; `Beads` also added `bd_events_journal` (opt-in, `bd config set events-journal true`, per replica, empty by default), `provenance_events`, `leases`, `interactions`, all dolt-ignored or local.

### BREAKS: a store from an older bd refuses every read-only open (L8)

A project last opened by bd 1.2.x or older holds an older schema (v32 in the pre-1.3 backup; 1.3.1 expects v66). Every `--readonly` call on it, including the workspace probe `bd --readonly dolt remote list --json`, exits 1 with this on stderr (`test/fixtures/bd13/schema-skew.stderr`): `Error: failed to open database: schema version mismatch: database is at v32, binary expects v66, and the read-only open cannot migrate it; run any bd write command in that workspace to migrate, or set BD_IGNORE_SCHEMA_SKEW=1 to read anyway (queries touching newer schema may fail)`. The panel never sets `BD_IGNORE_SCHEMA_SKEW` (reads that touch the newer schema would fail in odd ways). It recognises the text (`schemaSkewOf`, which needs both the "database is at vN, binary expects vM" and the "read-only open cannot migrate" parts), shows the project as needing a one-time update (`freshness.schemaUpdate`, error code `needs-schema-update`), and runs the update only when the person confirms: the `migrateSchema` route, the one call site of `bd migrate schema`, which goes through the write guard and needs a literal `confirm: true`. Two quirks (`migrate-schema.txt`): `bd migrate schema --json` prints plain text (`✓ Schema already at v66` once current), so the exit code is the only signal; and the **open itself** performs the migration (any write-mode open does), so a project that did not need it still answers exit 0. The panel therefore reads statuses again after the command and treats a still-skewed answer as failed and any other read failure as uncertain. A store with a Dolt remote is gated: `bd migrate schema --json` exits 1 with a stderr line "refusing to auto-apply N pending schema migrations to a remote-backed database" (`migrate-schema-remote-refused.stderr`, captured on the pre-1.3 backup plus `dolt remote add`), and the store stays at v32. The panel maps it to `update-blocked-shared` (409, `isRemoteMigrateGate`), shows plain copy that a teammate who shares the project has to update it first, keeps Details, and offers no retry button. It never passes `--force` and never sets `BD_ALLOW_REMOTE_MIGRATE`. The update has its own 120 s budget (`MIGRATE_BUDGET_MS`), not the 15 s write limit. It runs as a background job: the route answers `{ ok: true }` at once (started), and the snapshot carries its state in `freshness.schemaUpdateJob` (`running`, or `failed` with `at`, code, message, detail, saved); while it runs, polls answer from cache and nothing else touches the store, which keeps the 120 s outside the host's 20 s request cut. bd's other shared or remote refusals (remote-adopt, remote-diverged, shared-server wording; the server-mode "lock out" wording is not a busy lock) map to the same `update-blocked-shared` result. While a project needs the update, every other write route answers 409 `needs-schema-update`. The route answers 400 `BAD_REQUEST` ("confirm must be true.") when `confirm` is not literally `true`. First contact applies first: a store last opened by an older bd asks for the person's consent before anything runs, then shows the update prompt.

### Other differences (no failing test)

- `bd init` now also writes agent integration files into the working directory (`CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`, `.agents/skills/beads/`, Codex and Cursor hooks/rules). Harmless in the temp test projects; never run it in a real project from the extension.
- `bd create --json` prints microsecond timestamps (`2026-10-15T05:26:08.480189Z`); `export`, `list`, `update` print second precision (`...:08Z`). The adapter reads beads back with `list`, so `updatedAt` comparisons stay second-based.
- `bd close` with no `--reason` sets `close_reason: "Closed"`; closing an already closed bead exits 0 and is a no-op.
- `dep add --type=blocks` from a task onto an **epic** now succeeds (exit 0); 1.2.2 rejected it (`tasks can only block other tasks, not epics`). The adapter's mapping for that text is now dead code but harmless.
- `bd comments <unknown> --json` and `bd close <unknown> --json` print `{"error":"resolving <id>: no issue found matching \"<id>\"","schema_version":1}` on **stdout**, exit 1 (the text still matches `no issue found matching`). `bd update <unknown>` keeps the plain `Error resolving <id>: ...` line on stderr plus a JSON `failed[]` line.
- Batch `update`/`close` with a failing id exits non-zero and still applies the others (the adapter only sends one id per call).
- `bd dolt status --json` -> `{data_dir, data_dir_exists, mode:"embedded", schema_version:1, server_running:false}`. `bd sql` is still unsupported in embedded mode (`Error: 'bd sql' is not yet supported in embedded mode`, exit 1), so the `dolt sql` CLI route in `audit.ts` is still required.
- `bd --readonly vc status --json` -> `{branch, commit, schema_version}` unchanged; `bd --readonly info --json` gains `mode:"direct"`, `config{}` and `issue_count`.
- New global flags `--database` (proxied-server mode only), `--ignore-schema-skew`, `--sandbox`, `--global`; new commands `heartbeat`, `reclaim`, `unclaim`, `batch`, `events`, `provenance`, `serve`, `schema`. No proxied-server topology showed up for `bd init` in a plain directory (it created an embedded store, `dolt_mode: "embedded"`).
- `bd dep add` / `remove` / `list`, `comments add`, `label add`, `statuses`, `types`, `ready --limit 0`, `list --all --flat --limit 0` JSON shapes and fields match the 1.2.2 contract above.

## bd 1.3.1 capabilities for 0.2 (verified 2026-10-14)

Captured by the Abacus 0.2 plan, Task 1, in a scratch project (prefix `pl`, embedded Dolt). Fixtures are in `test/fixtures/bd13/` (`<name>.json|txt|jsonl`, `.stderr`, `.meta.json`). No 1.2.2 binary was available for these commands, so **every claim below is bd 1.3.1 only; 1.2.2 behavior is unverified** and the service must treat each command as "may not exist" (see the capability set in the 0.2 plan).

### Gates

- `bd gate create --type=human --blocks <id> --reason <r> --json` prints one object (`gate-create`). `issue_type` is `gate`, `await_type` is `human` (or `timer` with `timeout` in nanoseconds, `gate-create-timer`). The reason is the text after `\n\nReason: ` in `description`. The title is `Gate: human`.
- `bd gate list --json` prints an array of OPEN gates, or the literal `null` when there are none (`gate-list-empty`). `--all` adds closed gates (`closed_at`, `close_reason` is the resolve reason).
- `bd gate resolve <gate> --reason <r>` prints text only (`✓ Gate resolved: <id>`), no JSON. Judge it by exit code and re-read.
- A gate is a normal row in `bd export` and `bd list` with `issue_type: "gate"`. The blocked bead carries `dependencies: [{depends_on_id: <gate>, type: "blocks"}]`. That edge **persists after the gate closes**, so "gated" means: has a `blocks` edge to a gate whose `status` is not `closed`.
- Creating or resolving a gate does not change the blocked bead's `updated_at`.
- `bd close <gated>` exits 1 with stderr `cannot close blocked issue: <id> is blocked by [<gate>] (use --force to override)`. We never pass `--force`. After resolving, close works.
- Gate rows also appear in `bd ready`, `bd list` and export counts. Every consumer must exclude `issue_type: "gate"` (counts, epic progress, Status buckets, activity feed, unseen set).

### Human

- `bd human list --json` prints an array of non-closed beads labelled `human`, or `null` when empty. No `--all`.
- `bd human respond <id> --response <t>` prints text only. It adds the comment `Response: <t>` (by the actor) and closes with `close_reason: "Responded"`.
- `bd human dismiss <id> --reason <r>` prints text only. It closes with `close_reason: "Dismissed: <r>"`.
- `bd human respond` and `dismiss` close a bead even when it is not labelled `human` or has an open blocker, so the panel checks first, by the rule of `bd close` on 1.3.1 (read from the v1.3.1 source, confirmed in a scratch project). `bd close` refuses for two separate reasons. (1) A child (`parent-child`) whose status is not exactly `closed` (a custom done status, `pinned` and `deferred` all count as open): `cannot close X: N open child issue(s); close children first or use --force to override`, no ids. (2) The bead's stored, transitive `is_blocked` is set AND at least one direct `blocks`, `conditional-blocks` or `waits-for` target is neither `closed` nor `pinned`: `cannot close blocked issue: X is blocked by [t (waits-for)]`, naming only those live targets (a kind other than `blocks` is printed in parentheses after the id). `is_blocked` is not in `bd export`, `list` or `show`; bd sets it from a live `blocks` or `conditional-blocks` target (custom done statuses are live), from a parent that is blocked itself, and from a `waits-for` target of any status that holds a child that is neither `closed` nor `pinned`. So a `waits-for` link alone does nothing for a target without such a child, yet the same link is refused when the bead is blocked another way (a blocked parent, or a pinned target with an open child that is also waited on). A blocked bead whose direct targets are all closed or pinned closes. `related`, `discovered-from`, `tracks`, `caused-by`, `validates`, `supersedes`, `replies-to`, `relates-to`, `duplicates`, an open parent, and the blocker side of a link are not blockers. The panel derives `is_blocked` from the export (`closeBlockers`). Known gaps: the `any-children` and `also_blocks` metadata of a `waits-for` link (the panel does not read link metadata; `also_blocks` blocks while the target is live, with or without children), and ephemeral wisps (a wisp child or a link to a wisp is not in the export, so it never counts). Not checked by the panel, because `bd human` skips them: a pinned or template request, and one assigned to someone other than the actor.
- A `human` bead that is already closed does not appear in `list`. Derive the set from export (`labels` has `human`, `status` not closed) so there is no extra call.

### History

- `bd history <id> --json` prints `[{CommitHash, Committer, CommitDate, Issue}]`, newest first, one row per **database commit** that touched anything (12 rows for 4 real changes). The service must collapse consecutive identical `Issue` snapshots. `Issue` has no labels, dependencies or comments. `Committer` is `beads` or `root`, never the actor. A missing id prints `null`.
- `bd history <id> --events --json` prints `[{id, issue_id, event_type, actor, old_value, new_value, created_at}]`. `old_value` is the whole previous issue as a JSON string, `new_value` the changed fields as a JSON string. Join to a snapshot where `created_at` equals the snapshot's `updated_at` to name the actor. Label changes appear only here. On 1.3 the events table is clone-local.
- `--limit N` is supported.

### Memories

- `bd memories --json` prints a flat map `{"<key>": "<text>", ..., "schema_version": 1}`, alphabetical, no timestamps. No memories gives `{"schema_version":1}`. `bd memories <keyword> --json` filters. The key `schema_version` collides with the metadata field: reject it, and drop that key when reading.
- `bd remember "<text>" [--key k] --json` prints `{action: "remembered" | "updated" | "recalled", key, value}`. With an existing key it updates in place. **Without `--key`, text equal to an existing key recalls instead of storing** (`remember-bare-key`): always pass `--key` and treat `action: "recalled"` as a failure.
- `bd forget <key> --json` prints `{deleted: "true", key}`. A missing key exits 1 with `{found: "false", key}`.
- Memories are config rows `kv.memory.<key>`. Commit messages are `bd: remember|forget (auto-commit) by <actor>`. For timestamps and per-memory history use `dolt_diff_config` through `runSql` (works in embedded and server mode): `SELECT diff_type, from_key, to_key, from_value, to_value, to_commit_date, to_commit FROM dolt_diff_config WHERE to_key LIKE 'kv.memory.%' OR from_key LIKE 'kv.memory.%' ORDER BY COALESCE(to_commit_date, from_commit_date) DESC LIMIT 50`. (`dolt_history_config` has a row per commit per key, so it is not usable.)

### Defer, dates, move, retype, supersede, duplicate

- `bd defer <id> --until=<date> [--reason r] --json` prints an array with the issue: `status: "deferred"`, `defer_until` in UTC. A bad date exits 1, stderr `Error: invalid --until format "blorp". Examples: +1h, tomorrow, next monday, 2025-01-15`.
- `bd defer <id>` with no date on an already snoozed bead **keeps the old `defer_until`**. To clear: `bd undefer <id>` (status back to `open`) or `bd update <id> --defer "" --json`.
- `bd update <id> --defer "2030-01-02"` sets `status: deferred` and `defer_until` at local midnight in UTC. `--due "+2d"` sets `due_at`. `--due ""` clears it. A bad `--due` exits 1 with `{"error":"invalid --due format ...","schema_version":1}` on **stdout**.
- **Date forms, captured 2026-10-15 on bd 1.3.1** (`test/fixtures/bd13/date-forms.json`: 150 runs in five zones, `--due` and `defer --until`, which read alike). `tomorrow`, `+Nd`, `+Nw` and `next <weekday>` are calendar days from now in the machine's zone at the same wall clock time as now (`+20d` across a daylight saving change keeps the wall clock). `next friday` on a Thursday is tomorrow, on a Friday in 7 days; the weekday is the one in the machine's zone. `+Nh` is hours from now. `YYYY-MM-DD` is local midnight. `YYYY-MM-DDTHH:MM:SS` is local time, with a trailing `Z` that instant. Case-insensitive for `tomorrow` and `next <weekday>`; `+2D` and `+1M` are refused. **Traps the preview never guesses:** `+30m` is 30 *months* (stored 2029-04-15), `+1y` is a year, `2026-10-20 14:30` (a space) is stored as something unrelated (now plus a few hours), and bare `monday`, `today` and `in 2 days` are accepted but are not modelled. `panel/dates.ts` parses only the forms above; anything else previews as "Beads will read this when you save".
- There is no dry run for date parsing. The panel's "what will this mean" preview needs its own parser for the common forms (`+Nh`, `+Nd`, `tomorrow`, `next monday`, `YYYY-MM-DD`) and must say "bd decides" for anything else.
- `bd update <id> --parent <epic>` adds a `parent-child` dependency. `--parent ""` removes it (`parent-clear2`). `bd update <id> --type bug` works. A bad type exits 1, stderr `Error updating <id>: validation failed: invalid issue type nonsense`. Children created with `--parent` get dotted ids (`pl-b9p.1`); moving an existing bead keeps its id.
- `bd duplicate <id> --of <canonical> --json` prints `{canonical, duplicate, status: "closed"}`. `bd supersede <id> --with <new> --json` prints `{replacement, superseded, status: "closed"}`. Both close the bead and add a dependency of type `duplicates` / `supersedes` to the other bead (`close_reason` stays empty).
- `--if-assignee` / `--if-status` guards exist (exit 13). `--force` exists and is never used.

### Ready, epics, stale

- `bd ready --explain --json` prints `{ready: [...], blocked: [{...bead, blocked_by: [{id, title, status, priority}], blocked_by_count}], ...}` (global, not per bead). The text form says `no blocking dependencies` or `← blocked by <id>: <title> [<status>]`. Gates show up as blockers titled `Gate: human`.
- `bd epic status --eligible-only --json` prints `[]` when no epic has all children closed. When one does (captured 2026-10-15 on bd 1.3.1, `test/fixtures/bd13/epic-eligible-nonempty.json`) it prints an array of `{epic: {id, title, status, priority, issue_type, owner, created_at, created_by, updated_at}, total_children, closed_children, eligible_for_close: true}`. Without `--eligible-only` it also lists epics that are not eligible (`eligible_for_close: false`, e.g. `closed_children` 0 of 1). An epic with no children is not listed. The panel does not call it: `eligibleEpics` (`panel/needs.ts`) derives the same set from the export (an open epic with at least one child, every child done), and `test/integration/gates.test.ts` checks the two agree.
- `bd stale --days N` needs N >= 1 (`--days 0` is a JSON error). Only the empty result was captured; the stale path against an old bead could not be exercised (`bd sql` is not supported in embedded mode). **Derive the stale set from `updated_at` in the export** rather than calling `bd stale`.

### Events journal

- `bd config get events-journal` prints `true` or `false`. `bd config set events-journal true` prints `Set events-journal = true (in config.yaml)` and **modifies the tracked `.beads/config.yaml`**. Only an explicit button may do that. The panel's Settings button is the only caller (`BdProvider.enableEventsJournal`): `bd --actor "<name> (panel)" config set events-journal true` is accepted (`--actor` is a global flag), and a real run on 1.3.1 added `events-journal: true` to `.beads/config.yaml` (verified in `test/integration/live.test.ts`). A project that commits that file shares the setting with the team. `bd config get events-journal` reads it back and is what the route trusts, not the printed text.
- `bd events tail --since <seq> [--limit N] [--follow]` prints JSON lines `{seq, ts, op, issue_id, actor, issue, dep?, comment?}` with `op` in create, update, close, delete, dep_add, dep_remove, comment. `seq` is gapless and per clone. `--follow` keeps the process alive and prints new records as other `bd` processes commit them (`events-follow`); it does not exit on its own, so a follower must be killed on teardown.
- With the journal off, `tail` prints a note on stderr and exits 0 with no records. `--since` above the head also exits 0 with no records (it "reads as caught up"). A `--since` below the retention floor fails (exit 1, forms below): re-baseline with a full export.
- Pull and merge do not journal, and `bd sql` writes are not journaled. After a sync the panel re-baselines from a full export. The journal is a nudge to refresh, not the data source.
- **Follow process lifetime (verified on 1.3.1, Task 8).** A `bd events tail --follow` child spawned detached with piped stdio does **not** die when its parent is SIGKILLed. With `--since 0` it was still running 6 s later; a journaled write by another `bd` then made it print into the closed pipe and it died (EPIPE). With `--since` above the head (nothing is ever printed) it was alive 8 s after the parent died and still alive after a further journaled write, and the same with `stdio: ignore`. So an orphaned follower lives until it next has a record to print, which can be hours or forever. The pidfile and the shutdown kill are needed, not belt and braces. SIGTERM ends the child at once.
- Another `bd` writes to the same embedded project while a follower runs without blocking (create, update, close all succeeded, and the follower printed each record).
- **`--json` on `tail --follow` changes the output**: it pretty-prints each record over several lines instead of one JSON line. The follower therefore does not pass `--json`, so failures are plain text on stderr.
- **Truncation, captured on 1.3.1 (Task 8 fix round 1).** Scratch project with `events-journal-retain-days 0`, `events-journal-retain-rows 2`, six creates, `bd events prune --before 5` (window `[5..6]`). `bd events tail --since 0`, with or without `--follow`, prints nothing on stdout and exits 1 with, on stderr (`test/fixtures/bd13/events-tail-truncated.stderr`):
  ```
  Error: events journal truncated: checkpoint 0 is below the retained window [5..6]; records 1..4 were pruned
  Hint: resume with --since 4 to continue from the oldest retained record (accepting the gap), or re-import from scratch
  ```
  The plain text carries no `events_journal_truncated` code. The head is the second number in `retained window [floor..head]`. With `--json` the same refusal goes to **stdout** as the pretty-printed `{"code":"events_journal_truncated","error":...,"floor":5,"head":6,"schema_version":1,"since":0}` (`events-tail-truncated.json`), exit 1. The follower parses the plain form (and the JSON form if it ever sees it); if the text carries no head it asks once with a non-follow `bd --readonly events tail --since 0 --limit 1 --json`, which refuses the same way and carries `head`. `--since <floor-1>` resumes, and prints the retained records. The retention floors can be lowered with `bd config set events-journal-retain-days/-rows` (scratch projects only).
- The follower is spawned as `bd events tail --since <seq> --follow --readonly` (first start: `--since 0`, which replays the retained journal once; that replay is one nudge). The setting is read with `bd --readonly config get events-journal`.

### Leases (Stuck, 1.3 only)

- `bd update <id> --claim` creates a row in the dolt-ignored `leases` table (`issue_id, holder, granted_at, lease_expires_at, heartbeat_at, granted_node`, UTC datetimes without a zone). The lease runs **5 minutes** from the claim (`leases-after-claim`). `bd update <id> --status in_progress --assignee <x>` creates **no** lease (the table stayed empty), so a bead whose claim was made that way has no lease to expire.
- The table is readable with `dolt sql` inside the embedded database folder (`runSql` already does this). Reading it through `bd sql` in server mode was **not verified**; treat a read failure as "no lease information" and leave the lease reason out of Stuck.
- "Lease expired" therefore means: the bead is `in_progress`, has a lease row, and `lease_expires_at` is in the past. It is a weaker signal than "no update for N days" and is shown as a reason on the same Stuck row, not as a separate section.
