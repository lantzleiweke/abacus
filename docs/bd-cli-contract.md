# bd CLI contract (beads 1.2.2, dolt 2.3.2)

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
