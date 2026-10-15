# Development

## Setup

You need Node 20 or newer and npm. For the integration tests you also need `bd` 1.2.2 or newer, `dolt` and `git` on the PATH.

```sh
npm install
npm run build
```

## Scripts

| Script | What it does |
|---|---|
| `npm run check` | `typecheck`, then `build`, then `test`. Run this before a commit. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run build` | Builds the three bundles (below). |
| `npm test` | Unit tests only: `vitest run test/unit`. |
| `npm run test:integration` | Runs `BD_INTEGRATION=1 vitest run test/integration`: real `bd` against scratch projects. |
| `npm run preview` | Builds `dev/preview.js` and serves the preview page. |

Tests run with `TZ=UTC` (`test/setup.ts`), so times read the same on every machine.

## Layout

```
src/panel/     the UI that runs in the sandboxed iframe
src/service/   the Node service that runs bd, dolt and git
src/shared/    types and the one function both sides share
panel/         built bundles plus index.html and attach.html (committed)
service/       built bundle plus package.json (committed)
dev/           preview page, fake host, fake service, screenshot tool
test/          unit, integration, fixtures
docs/          these docs, plus contracts and screenshots
```

The manifest is the `openchamber` block in `package.json`. The panel id is `beads` and the rail name is "Abacus". The id and the storage folder `openchamber-beads` keep their old names on purpose, so state saved before the rename still loads. A test (`test/unit/manifest.test.ts`) checks the manifest.

## Bundles and why they are committed

`npm run build` runs esbuild three times:

| Entry | Output | Format |
|---|---|---|
| `src/panel/main.tsx` | `panel/main.js` | iife, browser, es2022 |
| `src/panel/attach.tsx` | `panel/attach.js` | iife, browser, es2022 |
| `src/service/main.ts` | `service/main.js` | cjs, node20 |

OpenChamber loads an extension from its folder and does not build it. So the bundles are committed. A checkout installs without running `npm run build`, and a change to `src/` is not live until you rebuild and commit the bundles with it.

The bundles are not minified. That is accepted for v1.

## Dev preview

```sh
npm run preview
```

Open `http://127.0.0.1:5199/dev/preview.html`. Set `PORT` to use another port. The server serves only `dev/` and `panel/`.

The page runs the real panel against a fake host (`dev/fake-host.ts`) and a fake service (`dev/fake-service.ts`). The fake service builds its beads from the committed fixtures in `test/fixtures/server/reads/` (`export.jsonl`, `statuses.json`, `types.json`, `ready.json`), through the same parse functions the real service uses. No `bd` runs.

Choose what to show with URL parameters:

| Parameter | Values |
|---|---|
| `scenario` | `normal`, `showcase`, `activity`, `quiet`, `team`, `empty-project`, `loading`, `load-error`, `stale`, `conflict`, `no-bd`, `bd-too-old`, `no-workspace`, `pre-dolt`, `needs-first-contact`, `server-down` |
| `theme` | `light`, `dark` |
| `bare` | `1` removes the page frame |
| `width`, `height` | panel size in pixels |
| `surface` | `dialog` shows the attach dialog; add `item=<id>` for a bead |
| `chat` | `none` for no open chat |
| `start` | the outcome of starting a session: `ok`, `slow`, `unlinked`, `bootstrap-failed`, `session-create-failed`, `timeout` |
| `sync` | `idle`, `running-pull`, `running-publish`, `conflict`, `half-merged`, `error`, `paused-upgrade`, `capped`, `stale` |
| `write` | `ok`, `conflict`, `uncertain`, `busy`, `blocked`, `invalid`, `writes-blocked`, `sync-running` |
| `paused` | `blocked` or `sync` |
| `toasts` | `1` shows toasts |

Example: `dev/preview.html?scenario=team&sync=conflict&theme=dark`.

### Screenshots

With the preview running:

```sh
node dev/capture.mjs <out-dir> <shot,...> [width] [height]
```

A shot is a scenario id, or `<file name>=<scenario>&<more preview params>`, for example `team-conflict=team&sync=conflict`. It writes `<name>-light.png` and `<name>-dark.png` with headless Chrome, 380 by 640 at 2x by default. The tool always reads `http://127.0.0.1:5199`, so leave `PORT` alone while capturing. Set `CHROME` to the browser path if it is not at the macOS default.

## Fixtures

`test/fixtures/` is committed and synthetic:

- `server/` is a purpose-built project (prefix `scr`, 16 beads) covering every status, type, dependency kind, label and comment shape, including the custom statuses `in_review` and `qa_wait` and the custom type `incident`.
- `conflict/` holds pull, push and conflict scenarios: `server`, `server-git`, `server-halfmerge` and `dirty-config-pull`. The half-merged state is simulated with `dolt sql`.

Fixture files follow one convention. For a command `X`: `X.json`, `X.jsonl` or `X.txt` is stdout, `X.stderr` is stderr (left out when empty), and `X.meta.json` is `{cmd, cwd_label, exit, ms}`.

`test/fixtures-private/` is git-ignored. It holds captures from real projects and is never committed. A test that needs it must skip when it is absent, so a clean clone passes. Do not copy real project data into `test/fixtures/`.

## Tests

- **Unit** (`test/unit/`) covers the manifest, the panel (`panel/`, with shared helpers in `helpers.ts`) and the service (`service/`). They run without `bd`.
- **Integration** (`test/integration/`: `audit`, `refresh`, `sync`, `writes`) is skipped unless `BD_INTEGRATION=1`. It runs real `bd` against scratch projects it creates in the OS temp folder, including two clones and a local remote for Sync and Publish. It never touches a real project.

When you change how the service reads or writes, run the integration tests as well as `npm run check`.

## The install and reload loop

1. In OpenChamber: Settings, Extensions, Add, then paste the absolute path of this folder.
2. Change code, then `npm run build`.
3. **Panel change:** reload the OpenChamber window.
4. **Service change:** disable the extension, then enable it. A reload does not restart the service.

A few host facts that shape the code (see [sdk-contract.md](sdk-contract.md)):

- The service runs on the host (`runtime: host`). `permissions.exec` only discloses what it runs. It does not grant anything.
- A request to the service is cut off after 20 seconds, and `startSession` after 180 seconds.
- The service environment is an allowlist. It has no `SSH_AUTH_SOCK` and no `BD_*` or `DOLT_*` variables.
- `attach`, `startSession` and `sessionLink` need an http(s) `url`.

## Before you commit

1. `npm run check`.
2. If you changed `src/`, commit the rebuilt bundles with it.
3. If you changed behavior the docs describe, change the docs. UI strings in the user guide are quoted from the source, so search the guide for a string you changed.
4. Do not edit a project's `.beads/` files by hand while testing. Use a scratch project.
