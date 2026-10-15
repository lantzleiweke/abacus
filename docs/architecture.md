# Architecture

How Abacus is put together and why. For what the user sees, read the [user guide](user-guide.md). For the exact `bd` commands and their surprises, read [bd-cli-contract.md](bd-cli-contract.md). For the host API, read [sdk-contract.md](sdk-contract.md).

## Two halves

The extension has two parts that run in different places.

```
OpenChamber window
 ┌──────────────────────────┐  serviceRequest   ┌───────────────────────────────┐
 │ panel (sandboxed iframe) │  POST /api/<name> │ service (Node, on the host)   │
 │  src/panel, src/shared   │ ────────────────> │  src/service, src/shared      │
 │  renders state, keeps UI │ <──────────────── │  routes → snapshot, sync      │
 │  state, calls the host   │   JSON            │  → BdProvider (src/service/bd)│
 └──────────────────────────┘                   └──────────────┬────────────────┘
                                                               │ spawn
                                                  bd --json, dolt sql, git
                                                               │
                                                  .beads/ (embedded Dolt or a
                                                  Dolt server) and the team's
                                                  Dolt remote
```

**The panel** is a sandboxed iframe built from `src/panel` into `panel/main.js` and `panel/attach.js`. It cannot run programs or read files. It draws what the service tells it, keeps view state, and calls host functions to attach a bead to a chat or start a session.

**The service** is a Node process the host starts (`service/main.js`). It is the only part that touches the project. It listens on `127.0.0.1` at the port the host passes in `OPENCHAMBER_SERVICE_PORT`, and requires the token in `OPENCHAMBER_SERVICE_TOKEN`. The panel reaches it through `host.serviceRequest`. Every route is `POST /api/<name>` with a JSON body. Every body carries an absolute `directory` that must exist.

Routes: `workspace`, `snapshot`, `bead`, `update`, `deferBead`, `undeferBead`, `supersede`, `duplicate`, `explain`, `create`, `comment`, `dependency`, `gateCreate`, `gateResolve`, `humanRespond`, `humanDismiss`, `history`, `memories`, `memoryRemember`, `memoryForget`, `seen`, `eventsStatus`, `enableEvents`, `context`, `sync-preview`, `sync-pull`, `sync-publish`, `conflict-context`. Request bodies are capped at 64,000 characters.

Errors share one envelope, `{ error: { code, message, detail?, workspace?, saved? } }`, defined once in `src/shared/types.ts` so the service and the panel cannot disagree about it. `src/shared` holds only types and the one function both sides need to work out a bead's relationships (`related.ts`).

## The provider layer

All knowledge of Beads lives in `src/service/bd/`:

| File | Job |
|---|---|
| `exec.ts` | Runs `bd`, `dolt` and `git` as child processes. |
| `parse.ts` | Turns their output into the panel's bead shape. |
| `adapter.ts` | `BdProvider`: change signal, export, statuses, types, ready, update, create, comment, dependency. |
| `audit.ts` | Reads the Beads change log with SQL, for who changed what. |

Nothing outside that folder builds a `bd` command line, and the panel never sees raw Beads output. Everything above it (routes, snapshot, sync, workspace detection) talks to `BdProvider` and the normalized `Bead` type.

The reason is the path to a native OpenChamber feature. OpenChamber has no provider abstraction for issue trackers today, and it has a contribution policy. If Beads support moves into OpenChamber, or if Beads grows an API worth using, the work is to replace `src/service/bd/` and keep the panel. Only a CLI adapter exists. `bd serve` refuses embedded Dolt, so it could only help server-mode projects on newer Beads versions, and v1 does not need it.

## Reading data

Abacus reads through the CLI first. It never opens the Dolt files directly except for one case below.

- **Beads list.** One `bd` export of the whole project. The panel needs every bead at once to group, filter and search, so a full read is the normal case. Cost is about half a second at 250 beads in server mode.
- **Statuses, types, ready.** Small `bd` calls. Custom statuses and types come from the project, so a project with `in_review` or `incident` shows them.
- **Change signal.** `SELECT DOLT_HASHOF_DB(), DOLT_HASHOF('HEAD')`. It changes whenever the database does, in about 0.15 s embedded and 0.25 s server. If `dolt` is not installed (embedded mode), `bd vc status` supplies the last commit hash instead, and if that fails the service forces a full export at most every 60 seconds and tells the panel: "Change detection unavailable; checking every minute."
- **SQL.** `bd sql` does not work in embedded mode. So embedded projects run `dolt sql -r json -q` inside `.beads/embeddeddolt/<db>/`. That is the one direct touch of the database, read-only, and it avoids Beads telemetry. Server-mode projects use `bd --readonly sql --json`.

`bd show` is never called. It moves `.beads/last-touched`, which other tools and the user's own `bd` use to know what they last looked at, so `runBd` refuses it. It also refuses `--force` and `-f`. `.beads/issues.jsonl` is never read, because writes do not update it.

### Process handling

`exec.ts` spawns each command detached, in its own process group, so a timeout kills the whole tree. Defaults:

- 15 seconds per attempt, 18 seconds for the whole call. The host cuts a service request off at 20 seconds, so the service gives up first and can say why.
- Output is capped at 4 MB.
- A lock held by another `bd` is retried with a 150 ms delay that doubles. Timeouts are never retried.
- Reads retry twice. Writes do not retry on their own.

The child environment drops variables that would point `bd` at some other project: `BEADS_DIR`, `BEADS_DB`, the `BEADS_DOLT_*` server and data variables, `GIT_DIR` and `GIT_WORK_TREE`. The search path is the host's `PATH` plus `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin` and `~/go/bin`; relative entries are dropped. The service itself gets an allowlisted environment from the host (`PATH`, `HOME`, `USER`, `XDG_*` and similar), without `SSH_AUTH_SOCK` or any `BD_*` or `DOLT_*` variable.

Every call for one project root goes through one queue (`withRootQueue`). Embedded Dolt is single-writer, and `bd` makes a second caller wait with a timer running. Queueing here means a slow call is a wait, not a timeout for the call behind it.

## Workspace detection

`workspace.ts` decides whether a folder can be shown at all, before any bead is read. It runs when the panel opens and on an explicit Retry, not on every poll (a guard that checks the `bd` binary's path and modified time per refresh catches an upgrade).

1. The root is the nearest ancestor with a `.beads/` folder. A linked git worktree uses the main checkout's database. The walk stops at a git repository root.
2. No `.beads/`, or a `metadata.json` that cannot be read (and no `.beads/beads.db`): no workspace. A fresh clone in embedded mode (no `.beads/embeddeddolt`) is also no workspace.
3. A `.db` database name in `metadata.json`, or no readable `metadata.json` next to a `.beads/beads.db` file (an old Beads that predates the metadata file): an older pre-Dolt project. Not touched.
4. No `bd` on the computer: no-bd.
5. `bd` older than 1.2.2, or older than the version that last opened the project (`.beads/.local_version`): bd-too-old.
6. The project was last opened by an older Beads than the installed one: needs-first-contact. A newer `bd` may upgrade the project on first use, and the user has to agree. The agreement is stored per `bd` version.
7. Server mode with a local fixed port that refuses connections (a 500 ms probe on `127.0.0.1`, `localhost` or `::1`): server-down. A remote host is not probed.
8. Otherwise ready. `bd --readonly dolt remote list --json` then sets whether the project has a shared copy with the team.

`bd --version` runs outside the project and is cached by the executable's path and modified time.

## Snapshots, diffing and attribution

The service keeps, per project, the last snapshot it saw and which changes the user has seen. On each refresh it reads the beads, compares with the last snapshot, and produces `ChangeEvent`s: the Activity feed, the unseen highlights and the rail badge all come from those events.

**Diff.** The comparison is field by field. One audit event can produce one change per field it contains. A new snapshot after a restart is compared with the persisted last one, so changes made while the panel was closed still show up. The feed keeps the latest 500 events.

**Attribution.** The diff says what changed. Who changed it comes from Beads' own audit tables (the `events` table), read with SQL in `audit.ts`. Reads are scoped to the changed beads (`beadIds IN (...)`), newest first by `created_at DESC, id DESC`, because audit ids are not all time-sortable. A UUIDv7 id carries a UTC time in its first 12 hex digits, and that is used as a fallback time. The service never guesses a name. If the audit holds nothing for a change, the actor is "unknown". The first time a project is seen there is no earlier snapshot, so the service takes the latest 50 audit events as the baseline for the feed.

`ChangeEvent.changedAt` is the writer's time. `observedAt` is the service's clock, used when the writer's time is unknown.

**The panel's own writes.** Every write the panel makes carries `--actor "<git user.name, else OS user> (panel)"`. An event counts as "you (panel)" only when the recorded actor equals that string exactly. Changes made through the panel are marked seen on arrival (`autoSeePanelChanges`), unless someone else's earlier change on the same bead was still unseen.

**Unseen** is tracked per bead: the service stores when each bead was last marked seen. The Activity bar's "N unseen" counts feed entries. The rail badge counts beads plus unseen deletions. A change that moves a bead's stored version but none of the fields the feed describes can make a bead unseen without a feed entry. That is a known limit.

State per project is written to files under `$XDG_DATA_HOME/openchamber-beads`, or `~/.local/share/openchamber-beads` when that variable is unset or not absolute. The folder keeps its old name after the rename to Abacus so saved state and chips survive.

## Freshness and polling

Stale data shown as current is the failure this design is built around, so the cadence is explicit.

Panel side:

| Situation | Poll |
|---|---|
| Panel visible | every 2 s |
| Panel visible, events follower running (the answer says `following`) | every 500 ms |
| After a failure | backs off up to 30 s |
| Panel hidden in the rail, window visible | every 60 s |
| Window hidden (`document.visibilityState`) | none |

Visibility is read from `visibilitychange`, from a zero-size viewport on `resize`, and from an `IntersectionObserver`.

A poll sends the `cursor` from the last answer. If nothing moved, the service answers `unchanged: true` with fresh freshness and sync fields and no beads. Beads the panel has just written are held at their written value until the service reports that its own refresh has passed the write time.

Service side:

- The change signal is checked at most every 4 seconds. A panel write bumps a data generation that skips that throttle, so the user sees their own change at once.
- A full export runs only when the signal moved, or every 60 seconds regardless.
- The unpublished count is refreshed at most every 30 seconds.

Each answer carries `freshness` ("Local, refreshed 8s ago") and, for a project with a team copy, a sync state. Beads sends an anonymous usage event per `bd` command when its metrics are on. The signal query and the embedded SQL path avoid `bd`, which keeps most polls out of that count.

## Write safety

Another process can write the same bead between the panel reading and saving. The agent does so all the time.

1. **Re-read before write.** `update` reads the bead again inside the root queue. If its `updatedAt` differs from the `expectedUpdatedAt` the panel sent, nothing is written and the answer is `conflict: true` with the current bead.
2. **Expected values as well.** `updated_at` is stored to the second, so a change in the same second leaves it unchanged. The panel therefore also sends `expected`, the values it showed for the fields it is changing, and the service refuses if any differs now.
3. **Fields already at the new value** are left out of the command.
4. **Custom done statuses** take two writes: close, then `update --status`.
5. **Timeouts on create, comment and dependency** return `uncertain` (HTTP 504). The write may have happened. The service refreshes and does not retry, because a retry could create a duplicate.
6. **Refusals the panel never forces.** A close that Beads refuses ("blocked by open issues") is shown, not forced. One dependency exists per ordered pair, so adding a different kind between the same pair is refused while one exists. Labels containing `"` or `,` are rejected. Removing a dependency needs no kind.
7. **While a sync runs, or after a half-merged sync** (`writesBlocked`), every write route refuses: `sync-running` or `writes-blocked`.

Write error codes: `invalid` 400, `not-found` 404, `blocked` 409, `dep-exists` 409, `merge-conflict` 409, `busy` 503, `uncertain` 504, `no-bd` 500, `failed` 500.

The panel never calls `bd dolt remote add` or anything else that writes `.beads/config.yaml`, with one exception: `enableEvents`, which runs `bd config set events-journal true` after the person confirms it in the project menu. In many projects that file is tracked in Git and shared, so a static test in the suite fails if any other call can write a setting.

## Sync and Publish

One job per project, run inside the root queue, with a 120 second limit (20 seconds for the remote lookup). The remote is `origin` if present, else the first remote.

**Sync** runs `bd dolt pull` with the panel's actor. It never pushes.

**Publish** is two steps so the user can review:

1. `sync-preview` lists the local commits the team's copy lacks (up to 1,000, or 500 when there is no tracking ref), parsing commit messages into a summary and an actor. It returns `expectedHead`, the local head it read from.
2. `sync-publish` sends that `expectedHead` back. If the local head has moved, the service refuses with `preview-stale` ("New changes arrived since you looked. Review them again.") and publishes nothing.

On confirm: pull first, then `bd dolt push`. A rejected push (non-fast-forward) is retried up to 3 attempts, pulling each time. Before every push the service checks that `dolt_status` is empty (else "pending") and that the outgoing commits equal the previewed set plus only this job's own merge commits. If not, it stops.

A small window remains between that check and the push. Dolt cannot push up to a named commit, and the agent writes outside the panel, so it cannot be closed from here. The Publish sheet says so.

**Conflicts.** Different fields of one bead merge cleanly. Only the same field on both sides conflicts.

- Embedded mode: a pull that prints "merge aborted and working set restored" was backed out. The data is untouched, `halfMerged` is false.
- Server mode: `dolt_merge_status` with `is_merging` means the project is half merged. That sets `blocked`, which stops writes.
- The conflicting beads come from `DOLT_PREVIEW_MERGE_CONFLICTS` or `dolt_conflicts_issues`, at most 100.

The panel never resolves a conflict. It builds a record (both sides, what failed, the commands run, the project's `AGENTS.md` rules about syncing) and offers it to the agent. The job log keeps the last 8,000 characters with URL credentials redacted.

A project with uncommitted settings rows cannot pull. The panel reports it and does not clean it up.

## Reviews, history and memories (0.2)

Three features read and write Beads state the 0.1 snapshot did not model. Each has one module in `src/service/` and a route pair, and each follows the write rules above.

### Gates

Beads stores a review or a plan approval as a bead of its own with type `gate`, linked to the bead it holds. `gates.ts` takes those rows out of an export (`splitGates`) before anything else sees the list, so they never reach the Epic or Status views, the counts or the feed. The snapshot carries what is left as `gateIds` and each gate with its kind, reason, who asked and when, and which beads it blocks. A change event for a gate carries a `gateId`. There is no flag on a bead.

- **Kinds.** A human gate is a review or a plan approval. A plan approval is a human gate whose reason starts with the fixed text in `src/shared/gates.ts` (`PLAN_APPROVAL_REASON`). Timer, GitHub run, GitHub pull request, bead and check gates are read-only here.
- **Writes.** `gateCreate` and `gateResolve` re-read the bead and the gate inside the root queue. A gate that is already resolved is answered with who resolved it, not an error. A create for a bead that already waits on one of that kind is refused with a message that says so.
- **Closing.** A close, and `humanRespond` and `humanDismiss`, check the bead's blockers the way `bd close` does (stored blocked state plus at least one live direct blocker, including waits-for links and a parent that waits). They refuse with `blocked` and name what holds the bead. Comment-and-close adds the comment first and relies on Beads' own refusal.
- **Needs me** is derived on the panel from the snapshot (`src/panel/needs.ts`): reviews and plans waiting, `human` beads that are open, in-progress beads past the stuck threshold or with an expired lease, and unseen beads. The service sends the gate and lease data in the snapshot and does not compute the sections.
- **Upgrade.** The saved 0.1 baseline is run through `splitGates` when 0.2 first reads it, so the change feed does not report each review as a deleted bead. The gates open at that last 0.1 read are taken from the gate rows it kept among its beads, so a review opened or resolved since shows its row; only a file with no readable snapshot takes a gate baseline.

### History

`history.ts` builds a bead's versions from `bd history` and, on Beads 1.3, joins audit events to say who made each one. It runs only when the History section is opened. The first read asks for 200 versions and a request for older ones doubles it up to 1,000. A text is cut at 20,000 characters for transport and marked, and is never offered for restore.

- **Actor join.** An audit event is attached to a version only when its written value matches the one the version holds. Anything else is "unknown". The audit table is local to each copy of the project in Beads 1.3, so a change from another computer has no row here.
- **Gate events** in History come from the gates' own audit rows. A close and a reopen carry no name.
- **Restore** goes through the same `update` route as every edit. The panel sends the value it showed as `expected`, so a field changed again since is refused, and the panel shows the current value and the diff before a second, confirmed write.

### Memories

`memories.ts` lists, adds, edits and forgets `bd remember` memories. Beads keeps each as a config row named `kv.memory.<key>`, read with SQL (`audit.ts`), newest change first. `bd` reads a short text that equals a memory's name as that memory, so a new text that matches a key is refused. `schema_version` is refused as a key. A text over 4,000 characters is refused, not cut. An edit or a forget sends the text the person saw, and the service writes only when the stored text still equals it. Undo after a forget is a new add of the same key and text through the same route.

## The events follower (0.2)

Beads 1.3 can keep a log of changes on this computer (`events-journal`, off by default). When it is on, `live.ts` runs one child per project root, `bd events tail --since <seq> --follow --readonly`, and each line it prints marks the root dirty. The next snapshot request sees that, skips the 4-second throttle and refreshes. The log is a nudge. The data still comes from the export, because pulls, merges, other computers and direct SQL are not in it.

- **When it runs.** `ensure(root, capable)` is called by every snapshot request. The child starts only when Beads is 1.3 or later (`capabilitiesFor`), the setting is on, and the panel has been asking. The setting is read once with `bd config get events-journal` and kept for 60 seconds. `journalChanged` drops that reading after `enableEvents`. The `eventsStatus` route reports `on`, `off` or `unknown` for the project menu, and `off` for a Beads older than 1.3.
- **States.** The panel shows Following (child running), Starting, Reconnecting (in backoff after a failure) and Not working (`failed`). Backoff waits are 2, 5, 15 and 60 seconds. After 5 failures with no event in between the follower is `failed` and polling carries on. It tries once more after 5 minutes.
- **Position.** The child starts from the last sequence number seen. When Beads has pruned past it (the log keeps 7 days), the child prints an error that carries the head, and the follower parses it from stderr. If the text does not carry it, one non-follow `bd events tail --since 0 --limit 1 --json` reads the head. Either way the follower carries on from the head.
- **Idle.** With no snapshot request for 30 seconds the child is stopped (a hidden panel polls once a minute). `SIGTERM` is followed by `SIGKILL` after 2 seconds. A timer runs only while a child exists.
- **Pidfile.** Each child has a file `live-<hash of the root>.pid` in the storage folder, holding the child's pid, the service's pid and the root. It is removed when the child ends. When a service starts, `reapStale` reads those files. If the service that wrote one is gone and the pid still belongs to a `bd events tail` command line, it kills that process group. A pid that has been reused by anything else is left alone, and a file whose owner is alive is not touched, since another window's service may own it. This stops a crashed service from leaving followers behind.
- **Fast poll.** Every snapshot answer, full or unchanged, carries `following` (the follower's held state, no bd call). While it is true and the panel is visible, the panel asks every 500 ms instead of 2 s; a poll between events reads nothing. Without it the panel's own interval would put a floor under the wait.
- **Fallback.** The panel's poll and the service's change signal never stop. Live updates shorten the wait for a change from a few seconds to the time a refresh takes. When the follower is off, failed or not capable, nothing else changes, including on Beads 1.2.2.

## The one-time schema update

Beads 1.3 refuses a read-only open of a store written by an older Beads, so a project made with 1.2 or earlier cannot be read until its schema is updated. The service recognises that refusal (`schemaSkewOf`) and keeps the project's state as needing the update (`freshness.schemaUpdate`, answered as `needs-schema-update`). Nothing sets `BD_IGNORE_SCHEMA_SKEW`, and `childEnv` drops it and `BD_ALLOW_REMOTE_MIGRATE` from the environment bd inherits, so a person's shell cannot start an update the panel did not ask for.

- **One call site.** `migrateSchema` is the only route that runs `bd migrate schema`, through the write guard. It needs `confirm: true` in the request. It never passes `--force`.
- **A background job.** `schema-update.ts` holds the job per root. The route starts it and answers at once. The snapshot carries its state in `freshness.schemaUpdateJob` (`running`, or `failed` with when it ended, a code, a message and a detail). The update has its own 120 s budget (`MIGRATE_BUDGET_MS`), outside the host's 20 s request cut and the usual write limit, so a long migration is never killed partway.
- **While it runs or is pending.** Reads answer from the cache, polls do not touch the store, and every other bead, memory and settings write answers 409 `needs-schema-update`. Sync and Publish do not check this themselves; the panel does not offer them in this state.
- **Afterwards.** The service reads the statuses again. A read that still shows an old schema is a failure ("Beads ran the update but the project still reads as out of date."), and any other read failure is uncertain ("The project may be updated now, but Beads didn't confirm it."), which the panel settles with a new read.
- **Shared projects.** A store with a team copy or a server is refused by Beads itself. The service maps that refusal, and Beads' other shared-store wording, to `update-blocked-shared` with plain copy and no retry.

## Attaching to a chat

The attach dialog (`src/panel/attach.tsx`) and the `/bd` command are separate panel entries. The host holds one chip per dialog open, so the picker attaches one bead at a time. Starting a session uses `host.startSession`, which links the new session to the bead. Starting in a worktree links the session and prints a `/bd <id>` tip instead of a chip, because the host unmounts the panel when the worktree opens.

## Where the code is

```
src/panel/    UI: store.ts (state, polling), client.ts (typed service client), ui/*.tsx
src/service/  main.ts (HTTP), routes.ts, snapshot.ts, sync.ts, workspace.ts, errors.ts,
              gates.ts, history.ts, memories.ts, live.ts, explain.ts, capabilities.ts,
              schema-update.ts, bd/*
src/shared/   types.ts, api.ts, related.ts
panel/        built bundles and HTML, committed
service/      built bundle, committed
dev/          preview page, fake host and fake service
test/         unit, integration, fixtures
```
