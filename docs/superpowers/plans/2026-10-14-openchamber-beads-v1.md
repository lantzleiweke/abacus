# OpenChamber Beads Extension v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An OpenChamber extension whose right-rail panel shows, edits, and hands to the agent the beads issues of whatever project is open, on beads 1.2.2+ in embedded or server Dolt mode, without the user ever using a CLI.

**Architecture:** A sandboxed Preact panel (classic IIFE) talks only to a Node service through `host.serviceRequest`. The service shells out to `bd` (CLI adapter), keeps a per-project snapshot, diffs it into change events, attributes them from beads' audit log, and runs pull/publish jobs. Shared TypeScript types define the wire contract.

**Tech Stack:** TypeScript 5, Preact 10 (TSX via esbuild), esbuild (panel IIFE, service CJS), `@openchamber/sdk` 2.3.2, `marked` + `dompurify` (markdown), Vitest + jsdom + `@testing-library/preact`, Node 22+ for tests.

**Spec:** `docs/superpowers/specs/2026-10-14-openchamber-beads-extension-design.md`. Contracts: `docs/sdk-contract.md` (OpenChamber SDK), `docs/bd-cli-contract.md` (bd 1.2.2 commands, outputs, errors, side effects, fixtures). Mockups: `docs/mockups/panel-v2-detail.html` (approved), `docs/mockups/panel-layouts.html` (option A chosen). Executors read the spec and both contracts before their task.

## Global Constraints

- Supports `bd` >= 1.2.2, Dolt `embedded` and `server` modes. Pre-Dolt projects (`"database": "beads.db"`) are unsupported: show an empty state, never call `bd` there.
- Never run `bd show` (moves `.beads/last-touched`). Reads use only commands marked side-effect free in `docs/bd-cli-contract.md`, with `--readonly`.
- Never edit beads config files. Never `--force`. Never push except from the user's Publish action.
- Every panel write passes `--actor "<git user.name> (panel)"`; comments also `--author` with the same value.
- Every service request carries `directory`; the service holds no global "current project".
- All `bd`/`git` calls use `execFile` with argument arrays, explicit `cwd`, a 15 s timeout, stdout/stderr capped at 4 MB, and an augmented PATH: host PATH plus `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/go/bin` (deduplicated). Parse stdout only.
- Attach `text` max 16,000 chars; attach `title` max 200; `id` max 128; `url` must be http(s).
- Bead URL: if the repo's `origin` is a GitHub or GitLab https/ssh remote, `<web repo url>?bead=<id>`; otherwise `https://beads.invalid/<project-dir-name>/<id>`.
- Theme only through `--oc-*` variables from `applyHostReady`; light and dark must both work.
- UI copy: plain language, no em dashes, no CLI jargon in user-facing text (say "Sync", not "dolt pull").
- Manifest: panel id `beads`, `engines.openchamber` `>=2.3.2`, capabilities `["sessions","prompt"]`, service `runtime: "host"`, `exec: ["bd","dolt","git"]`, attach dialog entry `panel/attach.html`, command `bd`.
- Development and all write/sync tests run only against scratch projects under the OS temp dir or `~/.cache/openchamber-beads-scratch/`. Never against a real project's `.beads/` directly.

## Review Focus

1. **OpenChamber launched from the Dock has a minimal PATH** (no `/opt/homebrew/bin`): `bd` must still be found and `bd` must still find `dolt` and `git`. Test in Task 2 (`resolves bd outside PATH`, `child env PATH includes homebrew`).
2. **The user switches projects while a request is in flight**: the late response must not paint or mutate the new project. Test in Task 12 (`drops stale responses after directory change`).
3. **Agent writes during a panel read or write (embedded lock)**: reads retry with backoff and never surface a raw stack; a write that times out is reported as "may have saved, refreshing" and re-read, never retried blindly. Tests in Task 2 (`retries on lock error`) and Task 8 (`timeout is uncertain, re-reads`).
4. **Agent-written markdown with HTML/script, very long text, unknown status/type/dependency kind**: sanitized, truncated in rows, neutral fallback styling. Tests in Task 4 (`unknown vocab passes through`) and Task 14 (`sanitizes html in description`, `renders unknown status with fallback`).
5. **First open of a project with many existing beads**: nothing is flagged unseen on the very first open (baseline), but later changes are. Test in Task 6 (`first snapshot establishes baseline`).

---

## File Structure

```
package.json                 manifest + scripts + deps
tsconfig.json
vitest.config.ts
icon.svg
panel/index.html             rail panel shell (loads main.js, built)
panel/attach.html            attach dialog shell (loads attach.js, built)
panel/main.js, attach.js     BUILT, committed
service/package.json         {"type":"commonjs"}
service/main.js              BUILT, committed
src/shared/types.ts          wire types (Bead, ChangeEvent, WorkspaceState, API req/res)
src/shared/api.ts            route names + request/response type map
src/service/main.ts          HTTP server, auth, routing
src/service/routes.ts        route handlers (thin; call modules below)
src/service/bd/exec.ts       runBd/runGit, PATH augmentation, timeouts, lock retry
src/service/bd/parse.ts      bd JSON -> shared types
src/service/bd/adapter.ts    Provider implementation over bd CLI
src/service/bd/audit.ts      audit log schema guard + queries
src/service/workspace.ts     detect workspace state
src/service/snapshot.ts      per-project cache, diff, change events, seen state, persistence
src/service/sync.ts          remote detection, unpublished, pull, publish, conflicts
src/service/context.ts       attach context text + bead URL
src/panel/main.tsx           rail panel entry
src/panel/attach.tsx         attach dialog entry
src/panel/client.ts          typed service client with generation guard
src/panel/store.ts           panel state (signals or a small reducer)
src/panel/ui/*.tsx           components (Header, ViewSwitcher, EpicView, StatusView, ActivityView, Row, Detail, Editors, CreateForm, SyncBar, ConflictView, EmptyState, AttachFooter)
src/panel/ui/styles.css      bundled CSS using --oc-* tokens
test/unit/**                 vitest unit tests (service + panel)
test/integration/**          vitest tests that run real bd against temp projects (BD_INTEGRATION=1)
test/fixtures/**             captured bd outputs (from the spike)
```

Agent routing: Tasks 1 to 11 are service and build work (implementer: fixer). Tasks 12 to 18 are UI (implementer: designer; must match `docs/mockups/panel-v2-detail.html` density and OpenChamber's look). Task 19 is live verification (orchestrator).

---

### Task 1: Scaffold, build, and authenticated service

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `icon.svg`, `panel/index.html`, `panel/attach.html`, `service/package.json`, `src/service/main.ts`, `src/panel/main.tsx`, `src/panel/attach.tsx`, `src/shared/types.ts`, `src/shared/api.ts`, `.gitignore` (already exists; keep), `README.md`
- Test: `test/unit/service/main.test.ts`, `test/unit/manifest.test.ts`

**Interfaces:**
- Produces: `startServer(opts: { port: number; token: string; handlers: RouteTable }): http.Server`; `type RouteTable = Record<string, (body: unknown) => Promise<{ status: number; json: unknown }>>`. All routes are `POST /api/<name>` with a JSON body; `GET /health` returns `{ ok: true }`. Error envelope: `{ error: { code: string; message: string } }`.
- Scripts: `build` (panel IIFE via esbuild `--bundle --format=iife --platform=browser --target=es2022 --jsx=automatic --jsx-import-source=preact --loader:.css=text`, service CJS `--platform=node --target=node20`), `test`, `test:integration` (`BD_INTEGRATION=1 vitest run test/integration`), `typecheck`, `check` (typecheck + test + build).

- [ ] **Step 1: Write failing tests**: `manifest.test.ts` asserts the manifest exactly matches Global Constraints (panel id `beads`, engines `>=2.3.2`, attach `{mode:'dialog',entry:'panel/attach.html'}`, commands `[{name:'bd',...}]`, capabilities, service exec list) and that every declared entry file exists after build. `main.test.ts`: `GET /health` without token -> 401; with token -> 200 `{ok:true}`; unknown route -> 404 envelope; handler throw -> 500 envelope with message, no stack; body > 64,000 chars -> 413.
- [ ] **Step 2: Run `npx vitest run test/unit` and confirm failures.**
- [ ] **Step 3: Implement** the files above. `src/service/main.ts` reads `OPENCHAMBER_SERVICE_PORT`/`OPENCHAMBER_SERVICE_TOKEN`, exits 1 if missing, binds `127.0.0.1`. Panel entries call `connectHost()`, `applyHostReady` on every ready, and render a placeholder "Beads" heading.
- [ ] **Step 4: Run `npm run check`; expect all pass and `panel/main.js`, `panel/attach.js`, `service/main.js` exist.**
- [ ] **Step 5: Commit** `feat: scaffold extension, build, authenticated service`.

### Task 2: bd execution layer

**Files:** Create `src/service/bd/exec.ts`. Test `test/unit/service/exec.test.ts` (uses a fake `bd` shell script in a temp dir).

**Interfaces:**
- Produces: `resolveExecutable(name: 'bd'|'dolt'|'git'): Promise<string | null>`; `childEnv(): NodeJS.ProcessEnv`; `runBd(directory: string, args: string[], opts?: { timeoutMs?: number; retries?: number; input?: string }): Promise<{ stdout: string; stderr: string; code: number }>`; `runBdJson<T>(directory, args, opts?): Promise<T>` (parses stdout, tolerates JSONL when `opts.jsonl`); `class BdError extends Error { kind: 'not-found'|'timeout'|'lock'|'exit'|'parse'; code?: number; stderr: string }`; `isLockError(stderr: string): boolean` (patterns from `docs/bd-cli-contract.md` lock section).

- [ ] **Step 1: Tests**: `resolves bd outside PATH` (PATH without the fake dir, fake placed in a candidate dir via injectable candidate list -> found); `child env PATH includes homebrew`; `retries on lock error` (fake exits non-zero with a lock message twice then succeeds; resolves with retries=3, total backoff < 2 s); `timeout kills child and throws kind timeout`; `stdout over cap throws`; `parses stdout only, ignores stderr noise`; `not-found when bd missing`.
- [ ] **Step 2: Run, confirm failures. Step 3: Implement. Step 4: Run, pass. Step 5: Commit** `feat: bd execution layer`.

### Task 3: Workspace detection

**Files:** Create `src/service/workspace.ts`. Test `test/unit/service/workspace.test.ts` with temp dirs containing `.beads/metadata.json`, `.beads/.local_version`, `.beads/config.yaml` variants.

**Interfaces:**
- Consumes: `runBd`, `resolveExecutable` (Task 2).
- Produces: `detectWorkspace(directory: string, opts?: { confirmedFirstContact?: boolean }): Promise<WorkspaceState>` where (in `src/shared/types.ts`):

```ts
type WorkspaceState =
  | { kind: 'ok'; root: string; mode: 'embedded' | 'server'; bdVersion: string; hasRemote: boolean; projectName: string }
  | { kind: 'no-bd' }
  | { kind: 'bd-too-old'; bdVersion: string }
  | { kind: 'no-workspace' }
  | { kind: 'pre-dolt'; root: string }
  | { kind: 'needs-first-contact'; root: string; lastOpenedWith: string; bdVersion: string }
  | { kind: 'server-down'; root: string; port: number };
```

- Rules: walk up from `directory` to find `.beads/` (a git worktree uses its main repo's database; follow `bd-cli-contract.md` worktree notes). `metadata.json` `database: "beads.db"` -> `pre-dolt` without calling bd. `.local_version` older than installed bd and not confirmed -> `needs-first-contact` without calling bd. Server mode with fixed `dolt_server_port` not accepting TCP -> `server-down`. `bd --version` cached per process. `hasRemote` from the remote-list command in the contract. `projectName` = basename of root.
- [ ] Steps 1 to 5 as above, tests for each kind; commit `feat: workspace detection`.

### Task 4: Parse bd output into shared types

**Files:** Create `src/service/bd/parse.ts`; extend `src/shared/types.ts`. Test `test/unit/service/parse.test.ts` against `test/fixtures/**`.

**Interfaces:**
- Produces types:

```ts
type Bead = {
  id: string; title: string; status: string; priority: number | null; type: string;
  assignee: string | null; labels: string[]; parentId: string | null;
  description: string; design: string; acceptance: string; notes: string;
  createdAt: string; createdBy: string | null; updatedAt: string;
  closedAt: string | null; closeReason: string | null;
  dependencies: Dependency[]; comments: Comment[];
  extra: Record<string, JsonValue>; // every other populated field, for the "More" block
};
type Dependency = { from: string; to: string; kind: string; createdBy: string | null; createdAt: string | null };
type Comment = { id: string; author: string | null; text: string; createdAt: string };
type StatusDef = { name: string; category: string; icon: string | null };
```

- Produces functions: `parseExport(jsonl: string): Bead[]`, `parseStatuses(json: unknown): StatusDef[]`, `parseTypes(json: unknown): string[]`, `parseReady(json: unknown): string[]` (ids).
- [ ] Tests: field mapping per fixture; `parentId` from parent-child dependency or `parent` field per contract; `unknown vocab passes through` (custom status, type, dep kind kept verbatim); `extra` captures unmapped populated fields and omits empty ones; malformed line -> skipped with a counted warning, not a throw. Commit `feat: parse bd output`.

### Task 5: Audit log with schema guard

**Files:** Create `src/service/bd/audit.ts`. Test `test/unit/service/audit.test.ts` (fixtures) and `test/integration/audit.test.ts`.

**Interfaces:**
- Produces (as shipped, after controller rulings): `type AuditEvent = { id: string; beadId: string; type: string; actor: string | null; oldValue: string | null; newValue: string | null; rawCreatedAt: string }`; `checkAuditSchema(root, mode): Promise<boolean>` (cached per root; true only if the `events` table has the columns listed in the contract); `readAuditEvents(root, mode, opts: { beadIds?: string[]; limit: number }): Promise<AuditEvent[] | null>` (`null` when the guard fails, the query errors, `limit > AUDIT_LIMIT_MAX` (1000), or more than `AUDIT_BEAD_IDS_MAX` (200) ids; never throws to callers); `eventTimeMs(e): number | null` (UUIDv7 ms).
- [ ] Tests: guard false when a column is missing (fixture of `DESCRIBE`); events parsed from the sql JSON fixture; query uses `--readonly`; `rawCreatedAt` kept as-is (not trusted for ordering). Commit `feat: audit log reader with schema guard`.

### Task 6: Snapshot store, diff, change events, seen state

**Files:** Create `src/service/snapshot.ts`. Test `test/unit/service/snapshot.test.ts`.

**Interfaces:**
- Consumes: `Bead` (Task 4), `AuditEvent` (Task 5).
- Produces:

```ts
type ChangeEvent = {
  id: string; beadId: string;
  kind: 'created' | 'field' | 'closed' | 'reopened' | 'deleted' | 'dep_added' | 'dep_removed' | 'comment';
  field?: string; from?: JsonValue; to?: JsonValue;
  actor: string | null; byPanel: boolean;
  observedAt: string;          // when the service saw it (ISO, service clock)
  historical?: boolean;        // backfilled from the audit log, coarse date only
};
function diffSnapshots(prev: Bead[], next: Bead[], observedAt: string): ChangeEvent[];
function attributeChanges(changes: ChangeEvent[], audit: AuditEvent[] | null, panelActor: string): ChangeEvent[];
function beadVersion(b: Bead): string; // updatedAt + comment count + sorted dependency keys
class ProjectStore {
  constructor(root: string, storageDir: string);
  load(): Promise<void>;                                  // reads persisted seen state + activity ring
  apply(next: Bead[], audit: AuditEvent[] | null, panelActor: string, now: string): ChangeEvent[];
  unseenIds(): string[];
  markSeen(ids: string[] | 'all'): void;
  activity(limit: number): ChangeEvent[];                 // newest first, ring of 500
  save(): Promise<void>;
}
```

- Persistence: `storageDir` = `$XDG_DATA_HOME/openchamber-beads` or `~/.local/share/openchamber-beads`, file `<sha1(root)>.json` holding `{ seen: Record<beadId, version>, activity: ChangeEvent[], usedAuditIds: string[] (most recent 2,000), firstContactConfirmedFor: string | null }` (bd version the user confirmed first contact for; set by T11 via `confirmFirstContact(bdVersion)`). Atomic write (temp + rename).
- Rules: `first snapshot establishes baseline` (no unseen, no change events on first apply when nothing persisted); a bead is unseen when new or `beadVersion` differs from `seen[id]`; panel-attributed changes (`actor` ends with ` (panel)`) are auto-seen; `field` events for title, status, priority, type, assignee, labels, description, design, acceptance, notes, parentId; status to/from a done-category maps to closed/reopened; comments and deps diffed by key with actor from `author`/`createdBy`; `attributeChanges` receives audit events read with `readAuditEvents(root, mode, { beadIds: <deduplicated ids of beads that changed in this diff, read in batches of AUDIT_BEAD_IDS_MAX>, limit })` (Task 5 API; there is no cursor) and matches by `beadId` and field (and value when available), choosing the newest unused event per (bead, field) and recording its id in `usedAuditIds` so one event never attributes two changes; else actor stays from the bead data or `null`. On first load, backfill up to 50 audit events (`readAuditEvents(root, mode, { limit: 50 })`) as `historical: true`, deduplicated by audit event id. The audit `AuditEvent` shape is `{ id: string; beadId; type; actor; oldValue; newValue; rawCreatedAt }` plus `eventTimeMs(e)` (UUIDv7 ms or null) for historical display time.
- [ ] Tests for each rule, plus persistence round-trip and atomic write. Commit `feat: snapshot diff and seen state`.

### Task 7: Refresh loop and change signal

**Files:** Extend `src/service/bd/adapter.ts` (create), `src/service/snapshot.ts`. Test `test/unit/service/adapter.test.ts`, `test/integration/refresh.test.ts`.

**Interfaces:**
- Produces: `class BdProvider { constructor(root: string); changeSignal(): Promise<string>; export(): Promise<Bead[]>; statuses(): Promise<StatusDef[]>; types(): Promise<string[]>; ready(): Promise<string[]>; }` (commands per contract). `getSnapshot(directory: string, cursor?: string): Promise<SnapshotResponse>` in `src/service/snapshot.ts`:

```ts
type Freshness = { localRefreshedAt: string | null; localError: string | null; teamSyncedAt: string | null; unpublished: number | null };
type SnapshotResponse =
  | { unchanged: true; cursor: string; freshness: Freshness; sync: SyncState }
  | { unchanged: false; cursor: string; workspace: WorkspaceState; beads: Bead[]; statuses: StatusDef[]; types: string[]; readyIds: string[]; unseenIds: string[]; activity: ChangeEvent[]; freshness: Freshness; sync: SyncState };
```

- Rules: per-root in-memory cache; at most one refresh in flight per root (callers share it); `changeSignal()` runs at most once per 4 s per root no matter how often the panel polls (calls in between answer from cache), and only while a panel is asking (no background timers); a refresh runs the export only when the signal moved or 60 s passed; `cursor` = signal + store revision; `unchanged: true` when the caller's cursor equals the current one; a refresh error keeps the last good data and sets `localError` (plain language) without clearing beads.
- [ ] Tests: shared in-flight refresh; export skipped when signal unchanged; error keeps last data; integration test on a temp `bd init` project: create a bead via bd, next snapshot shows it and a `created` change. Commit `feat: refresh loop with change signal`.

### Task 8: Writes with re-read-before-write

**Files:** Extend `src/service/bd/adapter.ts`. Test `test/unit/service/writes.test.ts`, `test/integration/writes.test.ts`.

**Interfaces:**
- Produces:

```ts
type BeadPatch = Partial<{ title: string; status: string; priority: number; assignee: string | null; labels: string[]; description: string; design: string; acceptance: string; notes: string; closeReason: string }>;
type WriteResult = { ok: true; bead: Bead } | { ok: false; conflict: true; current: Bead } | { ok: false; uncertain: true; current: Bead | null };
BdProvider.update(id: string, expectedUpdatedAt: string, patch: BeadPatch, actor: string): Promise<WriteResult>;
BdProvider.create(input: { title: string; type: string; priority: number; parentId: string | null; description: string }, actor: string): Promise<Bead>;
BdProvider.comment(id: string, text: string, actor: string): Promise<Comment>;
BdProvider.dependency(op: 'add' | 'remove', from: string, to: string, kind: string, actor: string): Promise<void>;
// panelActor(root) and withRootQueue(root, fn) already exist in adapter.ts (Task 7); BdProvider is constructed as new BdProvider(root, mode).
```

- Rules (controller rulings from earlier reviews are binding here): every write runs inside `withRootQueue(root, ...)`; one write call (re-read, write commands, re-read) shares a single deadline under the 20 s host RPC (e.g. 18 s total); user text positionals (create title, comment text, label values) go after `--`; read the detail with `bd --readonly list --all --id <id> --json` (never `show`); close refusal "blocked by open issues" is returned as a plain error, never retried with `--force`; after each successful write call `store.recordPanelWrite(beadId)` (add to ProjectStore) so the following diff attributes that bead's field/dependency changes to the panel actor and auto-sees them; re-read the bead; if `updatedAt !== expectedUpdatedAt` return `conflict` without writing; status to a done-category uses close (with reason) and from done uses reopen; labels diffed into add/remove; on `BdError.kind === 'timeout'` re-read and return `uncertain`; `dep remove` refuses with a clear error when two kinds exist between the pair if the contract shows it cannot target a kind.
- [ ] Tests: `conflict when updatedAt moved`; `timeout is uncertain, re-reads`; `writes carry --actor and --author`; integration round trip for each patch field, create with parent, comment, dep add/remove, close and reopen. Commit `feat: writes with conflict check`.

### Task 9: Sync: remote, unpublished, pull, publish, conflicts

**Files:** Create `src/service/sync.ts`. Test `test/unit/service/sync.test.ts`, `test/integration/sync.test.ts` (local file remotes, two clones).

**Interfaces:**
- Produces:

```ts
type UnpublishedChange = { commit: string; message: string; beadIds: string[]; summary: string; actor: string | null; at: string | null };
type ConflictInfo = { beadId: string; title: string | null; ours: JsonValue; theirs: JsonValue };
type SyncState =
  | { kind: 'idle' }
  | { kind: 'running'; op: 'pull' | 'publish'; startedAt: string }
  | { kind: 'conflict'; mode: 'embedded' | 'server'; halfMerged: boolean; beads: ConflictInfo[]; log: string }
  | { kind: 'error'; message: string; log: string }
  | { kind: 'paused-upgrade'; message: string };
unpublished(directory): Promise<UnpublishedChange[] | null>; // null when no remote
startPull(directory): void; startPublish(directory): void;   // async jobs; one per root
syncState(directory): SyncState; lastTeamSync(directory): string | null;
writesBlocked(directory): boolean;                            // true while server-mode half-merge
```

- Rules (commands and error texts per `bd-cli-contract.md`): jobs run in the background and are polled via snapshot `sync`; publish = pull, push, on rejection pull and retry up to 3 times, never `--force`; embedded conflict (merge aborted) -> `conflict` with `halfMerged: false`; server conflict -> `halfMerged: true` and `writesBlocked` true until a later read shows none; format-version refusal -> `paused-upgrade`; every job captures a trimmed log for "Hand to agent".
- [ ] Tests: unit with a fake runner for each branch; integration: clean pull/publish between two clones; same-bead edit in both clones produces `conflict` in embedded mode with local edits intact; `push never uses --force` (assert args). Commit `feat: sync jobs and conflict detection`.

### Task 10: Attach context and bead URL

**Files:** Create `src/service/context.ts`. Test `test/unit/service/context.test.ts`.

**Interfaces:**
- Produces: `type Related = { parent: Bead | null; children: Bead[]; deps: Array<{ dep: Dependency; other: Bead | null; direction: 'out' | 'in' }> }` (in `src/shared/types.ts`); `relatedFor(bead: Bead, all: Bead[]): Related`; `beadUrl(root: string, projectName: string, id: string): Promise<string>`; `buildContext(bead: Bead, related: Related): { text: string; title: string }`; `buildConflictContext(directory: string, state: Extract<SyncState, { kind: 'conflict' | 'error' }>, rules: string | null): string`.
- `text` = `"Beads issue context (JSON)\n" + JSON.stringify({ issue, comments }, null, 2)`, issue includes parent, children (id, title, status), dependencies (kind, id, title, status). Cap 16,000: drop oldest comments first, then truncate description, design, notes (append "[truncated]"); never cut id, title, status, priority, type, acceptance. `title` = bead title clamped to 200.
- URL rules from Global Constraints (parse `git remote get-url origin`, ssh and https forms).
- [ ] Tests: exact prefix; cap behavior with a 40k-char fixture; acceptance never truncated; URL for GitHub https, GitHub ssh, GitLab, none. Commit `feat: attach context and bead urls`.

### Task 11: Service routes

**Files:** Create `src/service/routes.ts`; wire in `src/service/main.ts`; types in `src/shared/api.ts`. Test `test/unit/service/routes.test.ts` (HTTP with injected fakes).

**Interfaces (all `POST /api/<name>`, body always includes `directory: string`):**

| Route | Body extra | Response |
|---|---|---|
| `workspace` | `confirmFirstContact?: boolean` | `WorkspaceState` |
| `snapshot` | `cursor?: string; refreshWorkspace?: boolean` | `SnapshotResponse` (a rethrown first-detection BdError maps to an error envelope with plain copy) |
| `bead` | `id` | `{ bead: Bead; related: Related }` |
| `update` | `id, expectedUpdatedAt, patch` | `WriteResult` |
| `create` | `input` | `{ bead }` |
| `comment` | `id, text` | `{ comment }` |
| `dependency` | `op, from, to, kind` | `{ ok: true }` |
| `seen` | `ids?: string[]; all?: boolean` | `{ unseenIds }` |
| `context` | `id` | `{ text, title, url, id }` |
| `sync-preview` | | `{ changes: UnpublishedChange[] }` |
| `sync-pull`, `sync-publish` | | `{ sync: SyncState }` |
| `conflict-context` | | `{ text, title, url, id }` |

- Rules: validate `directory` is absolute and exists; validate ids against `/^[A-Za-z0-9._-]{1,128}$/`; writes refused with `{ error: { code: 'writes-blocked' } }` while `writesBlocked`; first-contact confirmation persisted in the store file.
- [ ] Tests per route (happy path, validation error, writes-blocked). Commit `feat: service routes`.

### Task 12: Panel foundation (designer)

**Files:** `src/panel/main.tsx`, `src/panel/client.ts`, `src/panel/store.ts`, `src/panel/ui/Header.tsx`, `src/panel/ui/EmptyState.tsx`, `src/panel/ui/styles.css`. Test `test/unit/panel/client.test.ts`, `test/unit/panel/header.test.tsx`.

**Interfaces:**
- Consumes: `src/shared/api.ts` types; SDK `HostClient`.
- Produces: `createClient(host: HostClient): BeadsClient` with one method per route; `useDirectory()`; store with `{ directory, generation, workspace, snapshot, view: 'epic'|'status'|'activity', filters, selectedId, collapsed }`; view/filters/collapsed persisted via `host.storage` key `ui:<sha-ish of directory>`.
- Behavior: poll `snapshot` every 2 s while visible (pass cursor); Retry and first-contact Confirm send `refreshWorkspace: true`; exponential backoff on errors to 30 s; `drops stale responses after directory change` (generation guard); workspace states render `EmptyState` with plain copy (no-bd: "Beads isn't installed on this computer."; pre-dolt; no-workspace: "This project doesn't use beads."; needs-first-contact with Confirm; server-down; bd-too-old); Header shows project name, "Local, refreshed Ns ago" (turns into a warning with Retry after 30 s without success or on `localError`), team line when `hasRemote` ("Team synced 12m ago", "N unpublished"), search, view switcher Epic | Status | Activity, filter button, unseen count.
- [ ] Tests: stale-response guard; freshness text and stale state at 30 s; each empty state copy; view persistence. Commit `feat: panel foundation`.

### Task 13: Epic and Status views, rows, filters, keyboard, badge (designer)

**Files:** `src/panel/ui/EpicView.tsx`, `StatusView.tsx`, `Row.tsx`, `Filters.tsx`, `Footer.tsx`, `src/panel/keyboard.ts`. Tests `test/unit/panel/views.test.tsx`.

- Behavior per spec "Panel list" and "Linear parity": epic tree with x/y done bar and blocked count, short hierarchical ids, orphans group; status sections In progress, Blocked, Ready, Deferred, Closed (last 7 days), then custom statuses ordered by category, unknown at end; single-line rows (status icon by category, short id mono, title, epic tag in status view, P0 to P4 chip, assignee, relative time, up to 2 labels); unseen highlight; filters: status, assignee, priority, Ready; search over id and title; keys `j`/`k`/Enter/Esc/`/`; footer totals; `host.setBadge(unseen count)`; row context menu with Add to chat, Start session, Copy id (actions wired in Task 17).
- [ ] Tests: grouping, ordering, custom status section, `renders unknown status with fallback`, filter and search, keyboard navigation, badge count. Commit `feat: list views`.

### Task 14: Detail view (designer)

**Files:** `src/panel/ui/Detail.tsx`, `Markdown.tsx`, `Relationships.tsx`, `Comments.tsx`. Tests `test/unit/panel/detail.test.tsx`.

- Behavior per spec "Bead detail": back, breadcrumb, status dropdown, header (type, title, id with copy, status, priority, assignee or "unassigned", labels), change banner "Changed 9m ago by <name>: open to blocked" from the bead's latest unseen ChangeEvent ("you (panel)" for panel actor, "unknown" when null), collapsible Description, Acceptance criteria, Design, Notes (hidden when empty), Relationships (parent, children with x/y, blocked by, blocks, related, discovered-from, other kinds labeled), comments, created/updated/closed + reason, "More" block for `extra`. Opening marks the bead seen (`seen` route). Markdown via `marked` + `DOMPurify`, links opened with `host.openUrl`.
- [ ] Tests: `sanitizes html in description`; empty sections hidden; More shows extra fields; banner text and actor fallbacks; relationship navigation. Commit `feat: detail view`.

### Task 15: Editing and create (designer)

**Files:** `src/panel/ui/Editors.tsx`, `CreateForm.tsx`. Tests `test/unit/panel/editing.test.tsx`.

- Behavior: inline status, priority, labels, assignee, dependency add/remove (kind select, target picker by id or title); per-section Edit/Save/Cancel for title, description, acceptance, design, notes; Save sends `expectedUpdatedAt`; on `conflict` keep the draft and show "Changed while you were editing" with the current text and Re-apply / Discard; on `uncertain` show "This may have saved. Refreshed to check." ; `writes-blocked` disables controls with an explanation; add comment; "New bead" form (title required, type, priority, parent defaulting to the epic in view, description).
- [ ] Tests: conflict flow keeps draft; uncertain message; writes-blocked disables; create defaults parent. Commit `feat: editing and create`.

### Task 16: Activity view and seen (designer)

**Files:** `src/panel/ui/ActivityView.tsx`. Tests `test/unit/panel/activity.test.tsx`.

- Behavior: newest first; each entry: what changed ("Status: open to blocked", "Created", "Commented", "Blocks demo-x added"), bead short id and title (click opens detail), who ("you (panel)", name, or "unknown"), when (relative from `observedAt`; `historical` entries show a date only); unseen highlighted; "Mark all seen".
- [ ] Tests: entry text per kind; historical date display; mark all seen calls route and clears highlights. Commit `feat: activity view`.

### Task 17: Send to agent (designer)

**Files:** `src/panel/ui/AttachFooter.tsx`, `src/panel/attach.tsx` (dialog picker), `src/panel/resolve.ts`. Tests `test/unit/panel/attach.test.tsx` with a mocked HostClient.

- Behavior per spec "Send to agent": footer "Attach to" Current session (`attach`), New session (`startSession` no text, `navigation:'open'`), New session in worktree (`worktree:{kind:'new', name:'issue-<id>-<slug>'}`, slug = lowercase title words joined by `-`, max 40 chars); payload `{ providerId:'beads', id, title, url, text, kind:'issue', data:{ v:1, directory } }` from the `context` route; handle `StartSessionResult` failure shapes with a toast and no retry; dialog: list + preview, arrows and Ctrl+N/P, Enter attaches, Shift+Enter multi-select, then `close()`; `/bd <id>` resolver returns the payload or throws "No bead <id> in this project"; clicking a chip (`ctx.item` with `providerId:'beads'`) opens that bead's detail.
- [ ] Tests: payload shape and caps; worktree name; failure toast; resolver success, unknown id error; chip opens detail. Commit `feat: send to agent`.

### Task 18: Sync UI and conflicts (designer)

**Files:** `src/panel/ui/SyncBar.tsx`, `ConflictView.tsx`. Tests `test/unit/panel/sync.test.tsx`.

- Behavior: shown only when `hasRemote`; Sync button; Publish button when unpublished > 0 opens a preview list from `sync-preview` (bead, summary, who) with Confirm; note "Your agent may also publish these when it syncs."; running state; `conflict` shows "Sync needs attention" with conflicting beads and **Hand to agent** (attach `conflict-context` payload); `halfMerged` adds "Editing is paused until this is resolved."; `paused-upgrade` shows its message; `error` shows message with Copy details.
- [ ] Tests: preview then publish; conflict view and hand-to-agent payload; paused-upgrade copy. Commit `feat: sync ui`.

### Task 19: Live verification in OpenChamber (orchestrator)

**Files:** `README.md` (install, dev loop, limits, telemetry note, enterprise note), `docs/verification.md` (evidence).

- [ ] **Step 1:** `npm run check` and `npm run test:integration` pass.
- [ ] **Step 2:** Create scratch projects: embedded copy of a real project's `.beads` and a server-mode scratch, remotes removed, plus a local file remote pair for sync (reuse the spike's scripts).
- [ ] **Step 3:** Install from the folder in OpenChamber (Settings, Extensions, Add folder). Open each scratch project; with the OpenChamber browser tools, capture: epic view, status view, activity, detail, edit + conflict, create, attach chip in composer, new session, `/bd`, sync preview, conflict view, light and dark.
- [ ] **Step 4:** While an agent session runs `bd` writes in the embedded scratch, confirm changes appear within about 5 s and are highlighted, with no lock errors surfaced.
- [ ] **Step 5:** Smoke pass across the user's real projects read-only per spec (only those already opened by the installed bd; others must show the first-contact state without calling bd). Record results in `docs/verification.md`.
- [ ] **Step 6:** Commit `docs: verification evidence`.
