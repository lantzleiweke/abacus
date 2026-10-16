# Development

## Setup

You need Node 20 or newer and npm. For the integration tests you also need `bd` 1.3.1, `dolt` and `git` on the PATH. The integration suites are verified on 1.3.1; 1.2.2 is covered by unit tests on captured output.

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
dev/           preview page, fake host, fake service, screenshot and demo tools
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

### README demo

`docs/demo.gif` and `docs/demo.mp4` are rendered from five stills of Abacus in OpenChamber (1440 by 900 at 2x, dark theme): `s00-needs.png`, `s01-resolved.png`, `s02-detail.png`, `s03-history.png` and `s04-refused.png` (the names are in `dev/demo/storyboard.json`). Take them with the left sidebar collapsed; `crop_top_css` removes OpenChamber's header. The stills are not committed. To re-render, you need `ffmpeg` and ImageMagick 7 (`magick`):

```sh
python3 dev/demo/render.py <stills-dir>
```

It writes both files to `docs/`. Pass `--out` for another folder, `--work` to keep the frames, or `--only-frames 0,60,240` to render single frames for a quick check. Timings, click targets, zoom levels and output sizes are in `dev/demo/storyboard.json`, in CSS pixels of the original stills. The script removes the top `crop_top_css` pixels of every still first, so the OpenChamber header with the folder name never shows. If you capture new stills, check that the header is still inside that strip.

### Logo

`icon.svg` (the rail icon) and everything in `docs/logo/` are written by `python3 dev/logo/build.py`, which needs only Python 3 and ImageMagick 7 (`magick`) for the PNGs. The geometry, colors and tagline live in that one file, so change them there and rerun rather than editing the outputs. The mark is drawn on an 18 px grid so it stays sharp at the rail's size. Pass `--font` with a TTF to change the social preview tagline font; it defaults to JetBrains Mono Medium when installed.

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

1. In OpenChamber: Settings, Extensions, Add, then paste the absolute path of this folder. If Abacus is already installed from GitHub, remove that copy first: only one copy with the panel id `beads` can be installed. Removing it keeps the beads you have seen (the service keeps them in `~/.local/share/openchamber-beads`), but OpenChamber deletes the panel's storage, so view preferences, Stuck days and the Keep list start over.
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

## Releasing

People who installed Abacus from the GitHub URL get an **Update** button only when `version` in `package.json` goes up. OpenChamber compares versions, not commits, and never builds anything.

1. Bump `version` in `package.json` (and `package-lock.json`) and add the release to `CHANGELOG.md`.
2. `npm run build`, then `npm run check`, and commit the rebuilt bundles in the same release.
3. Publish to the public repository and tag the release there (`v<version>`), so `https://github.com/lantzleiweke/abacus#v<version>` installs that version.
