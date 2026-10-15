# OpenChamber SDK contract (what this extension relies on)

Source: `@openchamber/sdk` 2.3.2 (manifest/wire apiVersion 1), read from `.ref/openchamber` at commit 601babc (2026-10-14). Paths: `SDK/` = `.ref/openchamber/packages/sdk/`, `SERVER/` = `.ref/openchamber/packages/web/server/lib/guests/`, `UI/` = `.ref/openchamber/packages/ui/src/`. Read the cited source when in doubt; this sheet is a summary.

## Critical facts

1. Ready context has `directory`, not `projectId`. Project ids come from `listProjects()` / `onProjects()` (`SDK/src/contract.ts:203`, `SDK/src/host.ts:98`).
2. The service gets no project dir and no data dir. Its cwd is the extension package root. Send `directory` in every service request (`SDK/GUEST_SERVICES.md:128`, `SERVER/service.js:466`).
3. Service manifest runtime is `"host"`. The host spawns its own executable (`process.execPath` with `ELECTRON_RUN_AS_NODE=1`), so no Node version is selectable.
4. `permissions.exec` is disclosure only, not enforced.
5. `attach`, `startSession`, `sessionLink` require an http(s) `url` (`UI/lib/guests/host-bridge.ts:301-335`).
6. RPC timeout 20 s; `startSession` 180 s.
7. Browser reload does not restart the service. Disable and re-enable the extension to load rebuilt service code.
8. Service env is an allowlist: PATH, HOME, USER, LOGNAME, SHELL, TMPDIR, TEMP, TMP, TZ, LANG, LANGUAGE, LC_*, XDG_* (+ Windows vars). No `BD_*`, `DOLT_*`, `SSH_AUTH_SOCK` (`SERVER/service.js:547`).

## Manifest (`package.json` `openchamber` block)

```json
"openchamber": {
  "apiVersion": 1,
  "engines": { "openchamber": ">=2.3.2" },
  "contributes": {
    "panel": { "id": "beads", "name": "Abacus", "icon": "icon.svg", "entry": "panel/index.html" },
    "attach": { "mode": "dialog", "entry": "panel/attach.html" },
    "commands": [{ "name": "bd", "description": "Attach a bead by id, e.g. /bd k3f2" }],
    "capabilities": ["sessions", "prompt"],
    "service": { "entry": "service/main.js", "runtime": "host", "permissions": { "exec": ["bd", "dolt", "git"] } }
  }
}
```

- `engines.openchamber`: `X.Y.Z` or `>=X.Y.Z` only.
- `panel.id`: `/^[a-z][a-z0-9-]*$/`. `icon`: Remixicon kebab name or package-relative `.svg` (rendered as a currentColor mask).
- Safe paths: `/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/`, no `..`.
- `commands`: 1 to 8; name `/^[a-z][a-z0-9-]{0,23}$/`, no leading slash; description 1 to 80 chars.
- `page` (v2): `true` or `{ "entry": "...", "title": "..." }`.
- `package.json.version` must be semver. Ship built JS for every HTML entry and the service; no `node_modules`; bundle deps.
- Real references: `.ref/docker/package.json:16-39` (panel + exec service), `SDK/examples/tasks-demo/package.json` (attach dialog, page, commands).

## Panel side

```ts
import { connectHost, HostRequestError } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
const host = connectHost();
host.onResolve(async ({ command, args }) => /* AttachIssueRequest | null, or throw */ null);
let dispose: (() => void) | undefined;
host.onReady((ctx) => { applyHostReady(ctx, document.documentElement); dispose ??= mount(host, root); });
window.addEventListener('pagehide', () => { dispose?.(); host.dispose(); });
```

- `HostReadyContext`: `{ theme, locale, directory: string | null, session, surface: 'panel'|'dialog'|'page'|..., connection, settings, item, features? }`.
- `onDirectory(listener)` for directory changes. Guard async results with a generation counter so a late response for an old directory never paints the new one.
- `applyHostReady` sets `--oc-bg, --oc-elevated, --oc-fg, --oc-muted, --oc-subtle, --oc-border, --oc-hover, --oc-selection, --oc-focus, --oc-primary, --oc-muted-surface, --oc-elevated-fg, --oc-active, --oc-selection-fg, --oc-primary-fg, --oc-primary-text, --oc-success-text, --oc-warning-text, --oc-error-text, --oc-info-text, --oc-success, --oc-warning, --oc-error, --oc-info, --oc-font, --oc-mono, --oc-radius` and `data-oc-surface`, `data-oc-theme` on the root. Apply on every ready; mount once.
- `serviceRequest({ method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE', path, query?: Record<string,string>, body?: string }): Promise<{ status: number; body: string }>`. Bodies are strings: `JSON.stringify` in, `JSON.parse` out. Handle non-2xx from `status`. Path max 2,000; body max 64,000; response max 8,000,000 bytes (rejected whole).
- `serviceStatus(): Promise<{ status: 'stopped'|'starting'|'ready'|'failed' }>`.
- Transport errors are `HostRequestError` with `code`: `NO_SERVICE`, `DISABLED`, `SERVICE_FAILED` (message includes the service's stdout/stderr tail), `REQUEST_FAILED` (may have acted), `RESPONSE_TOO_LARGE` (acted), `HOST_TIMEOUT`. Treat mutation timeouts as uncertain; re-read before retry.
- `storage.get/set/delete/keys(key, { scope?: 'instance'|'device' })`. Key 1 to 128 chars; value 65,536 bytes; namespace 2 MiB / 2,000 keys; per extension, not per project (prefix keys with a project key). Device scope only if `ctx.features?.deviceStorage`.
- `setBadge(count | null)`: 0 to 999; cleared when the panel opens; memory only.
- `toast({ kind: 'info'|'success'|'error', message (1-500), copy?, dismiss?, persistent? })`.
- `attach(req: AttachIssueRequest)`, `sessionLink(req)` (current session only), `startSession(req: StartSessionRequest)`, `close()`.

```ts
type AttachIssueRequest = {
  providerId: string;   // panel id, /^[a-z][a-z0-9-]*$/
  id: string;           // max 128
  title: string;        // max 200
  url: string;          // http(s), max 2,000
  text?: string;        // model context, max 16,000
  kind?: 'issue' | 'pull';
  author?: string;      // max 80
  data?: JsonValue;     // opaque, JSON length <= 16,000, never sent to the model
};
type StartSessionRequest = AttachIssueRequest & {
  projectId?: string;
  worktree?: boolean | { kind: 'existing'; directory: string } | { kind: 'new'; name?: string; baseBranch?: string };
  navigation?: 'preserve' | 'open';
};
type StartSessionResult =
  | { sessionId: string; sent: 'sent'|'no-model'|'skipped'|'failed'; directory?: string; worktree?: GuestWorktree; linked?: boolean }
  | { sessionId: null; sent: 'skipped'; directory: string; worktree: GuestWorktree; failure: 'bootstrap-failed'|'session-create-failed' };
```

- Same `providerId + id` replaces the existing composer chip. `attach` never sends.
- `startSession` without `text` does not send. On partial failure the worktree is kept: do not retry blindly.
- Attach dialog: manifest `attach: { mode: 'dialog', entry }`; in the dialog `ctx.surface === 'dialog'` and `ctx.item === null` from the + menu. Select: `await host.attach(payload); await host.close();`. Clicking a chip opens the extension with `ctx.item` set; listen with `host.onItem`. Reference: `SDK/examples/tasks-demo/panel/attach.ts:97-108`.
- Slash command: `host.onResolve(({ command, args }) => AttachIssueRequest | null)`; register synchronously after `connectHost()`; return the chip, do not also call `attach`. 20 s timeout, error text 500 chars. The host mounts the panel HTML hidden if needed.

## Service side

- Plain Node HTTP server on `127.0.0.1:${OPENCHAMBER_SERVICE_PORT}`. Require `Authorization: Bearer ${OPENCHAMBER_SERVICE_TOKEN}` on every request including `GET /health` (200 = ready; 15 s startup budget).
- Spawned on first `serviceRequest`; one process per extension (shared by panel, dialog, page); stopped on disable, uninstall, quit (SIGTERM, kill after 5 s).
- stdout/stderr: only the last 2,000 chars per stream are kept, surfaced in `SERVICE_FAILED`. No log file.
- Module format: ESM via `openchamber-guest-bundle --node`, or CJS with a nested `service/package.json` `{ "type": "commonjs" }` (openspec).
- Use `execFile`/`spawn` with argument arrays and explicit `cwd: directory`; bound stdout/stderr; keep each CLI call under the 20 s RPC budget (openspec uses 15 s). Reference: `.ref/openspec/src/service/cli.ts:50-145`, `SDK/examples/git-graph-status/service/main.ts:49`.

## Build

- `bunx openchamber-guest-bundle panel/main.ts panel/main.js` (IIFE, minified) and `bunx openchamber-guest-bundle --node service/main.ts service/main.js` (ESM). Or esbuild like openspec:
  - `esbuild src/panel.ts --bundle --format=iife --platform=browser --target=es2022 --outfile=panel/main.js`
  - `esbuild src/service.ts --bundle --format=cjs --platform=node --target=node22 --outfile=service/main.js`
- A UI framework (Preact) can be bundled into the IIFE. No CDN scripts, no ESM entry.
- openspec tests: `node --test test/*.test.mjs` against built bundles, real disposable CLI projects, Playwright for document tests.

## Dev loop

1. Build. 2. Settings, Extensions, Add, paste the absolute folder path. 3. Approve capabilities. 4. Open the rail panel (first request starts the service). 5. After panel changes, rebuild and reload. 6. After service changes, disable and re-enable the extension.

## Sandbox

- iframe `sandbox="allow-scripts"`, opaque origin. CSP `connect-src 'none'` unless `origins` are declared. No localhost fetch; everything goes through `serviceRequest`. Use `host.openUrl()` for external links.
