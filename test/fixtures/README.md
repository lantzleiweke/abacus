# bd CLI fixtures

Real output captured on 2026-10-14 from `bd` 1.2.2 (Homebrew) and `dolt` 2.3.2, in scratch copies only. Nothing was run in a live project. See `docs/bd-cli-contract.md` for what each one shows.

## Layout

- **Not committed:** everything derived from the private project copy lives in git-ignored `test/fixtures-private/` (`embedded/`, `conflict/embedded/`, `lock/`, `side-effects-embedded.txt`). Tests that need it must skip when it is absent. Committed fixtures below are synthetic only.
- `embedded/` (in `test/fixtures-private/`): output from a scratch copy of a real shared project (embedded Dolt, 214 beads), remotes stripped, then a local `file://` remote added.
  - `reads/` : read commands. `export.jsonl`, `list*.json` and `ready.json` are trimmed to 40 beads (10 for `ready`); everything else is untrimmed.
  - `writes/` : every write the panel will issue (`w-*`).
- `server/` : output from a purpose-built project (prefix `scr`, 16 beads, complete, nothing trimmed) on a private `dolt sql-server`. Seeded to cover every status, type, dependency kind, label, assignee and comment shape, including the custom statuses `in_review`, `qa_wait` and the custom type `incident`.
- `conflict/` : pull/push/conflict scenarios. `embedded/`, `server/` (file remote), `server-git/` (git+file remote), `server-halfmerge/` (half-merged state, **simulated** with `dolt sql`), `dirty-config-pull/`.
- `lock/` : lock-contention spike results and the scripts that produced them.
- `side-effects-*.txt` : which files each command changed.

## File convention

For a command `X`: `X.json|jsonl|txt|csv` is stdout; `X.stderr` is stderr (omitted when empty); `X.meta.json` is `{cmd, cwd_label, exit, ms}`.

## Data handling

- `embedded/` carries real bead titles and descriptions from a team-internal project; only the minimum needed for realistic shapes is included (trimmed to 40 beads where it matters). Do not publish this directory outside the team.
- Some beads in that copy were edited by the write tests (priority, notes, labels and so on); that happened in the scratch copy only.
- Email addresses are replaced with `user@example.com`, local paths with `<scratch>` and `<home>`.
- No credentials, tokens or keys are present (checked by grep). Words like "token" appear only in bead text.
