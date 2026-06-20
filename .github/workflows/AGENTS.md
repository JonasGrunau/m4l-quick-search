<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-20 | Updated: 2026-06-20 -->

# workflows

## Purpose
This directory holds the GitHub Actions CI/CD pipelines for M4L QuickSearch. Currently a single workflow fires on version tags (`v*`), runs the full test + build chain, and publishes a self-contained `QuickSearch.zip` to the GitHub Release — the artifact the README's Quick Start section links users to for installation.

## Key Files

| File | Description |
|------|-------------|
| `release.yml` | Triggered by any `v*` tag push. Runs `npm ci`, `npm test`, then `npm run build` to produce `dist/QuickSearch Dev.amxd` and the v8 brain bundle (with the overlay UI baked in). Packages `dist/` (`.amxd` + `quicksearch.js`), `node/` (`bridge.js`, `global-hotkey.js`, `package.json`), and `remote-script/` (the Python Remote Script) together with a generated `INSTALL.txt` into `QuickSearch.zip`, then attaches it to the Release via `softprops/action-gh-release@v2`. |

## Subdirectories

(none)

## For AI Agents

### Working In This Directory

- The workflow runs on `ubuntu-latest`. The build target (`dist/QuickSearch Dev.amxd`) is produced by `tools/build.mjs` via `npm run build`; if that script or its dependencies change in a way that alters the output filename or path, the `Verify the device was produced` step and the `cp` commands in `Package QuickSearch.zip` must be updated together.
- The zip packaging step is explicit: it copies individual named files from `dist/` and `node/` — it is NOT a blanket copy of those directories. Adding a new runtime file to either requires adding it to the corresponding `cp` line in `release.yml`, or it will be silently omitted from the release artifact. (`html/` is no longer shipped — the overlay is baked into `dist/quicksearch.js`.)
- `remote-script/` is copied recursively (`cp -R`), so new files added under `remote-script/QuickSearch/` are included automatically.
- The `INSTALL.txt` embedded in the workflow is the authoritative user-facing install guide. If port numbers, paths, or Live/Max version requirements change, update it here as well as in the README.
- The job requires `contents: write` permission to upload the release asset. Do not remove or downscope this permission.
- `softprops/action-gh-release@v2` must find a pre-existing or auto-created Release for the pushed tag; if the tag has no associated Release draft, the action creates one. `fail_on_unmatched_files: true` means the job will fail hard if `QuickSearch.zip` was not produced — do not relax this.

### Testing / Verifying Changes

- There is no way to run Actions workflows locally with the standard tooling in this repo. To validate a workflow change, push a `v*` tag to a fork or the main repo and watch the Actions tab.
- The build steps themselves (`npm ci`, `npm test`, `npm run build`) are all runnable locally to verify they succeed before tagging.
- After a release workflow run, manually download `QuickSearch.zip` from the release page and verify the zip contents with `unzip -l QuickSearch.zip` — the workflow echoes this during CI, so compare against the Actions log if something looks wrong.

### Common Patterns

- Trigger: `on.push.tags: ["v*"]` — semantic version tags only; no branch-level CI is defined here.
- Build: `npm ci` (reproducible installs from `package-lock.json`) → `npm test` → `npm run build`.
- Artifact assembly is done with plain shell (`mkdir`, `cp`, `cat`, `zip`) rather than a third-party packaging action, keeping the step readable and auditable.
- The `softprops/action-gh-release@v2` action is the only third-party action beyond the standard `actions/checkout@v4` and `actions/setup-node@v4`.

## Dependencies

### Internal

- `tools/build.mjs` — invoked by `npm run build`; produces `dist/QuickSearch Dev.amxd`, `dist/quicksearch.js`, and `dist/ui.bundle.html`.
- `tools/test.mjs` — invoked by `npm test`; must pass before packaging begins.
- `html/` (`index.html`, `styles.css`, `ui.js`) — build-time source for the overlay, inlined into `dist/quicksearch.js` by `npm run build`; NOT shipped in the zip.
- `node/` (`bridge.js`, `global-hotkey.js`, `package.json`) — copied verbatim; the Node-for-Max TCP bridge and optional OS-global hotkey.
- `remote-script/` — copied recursively; the Python Remote Script that enumerates Live's browser and serves `load_item` over TCP.
- `package.json` / `package-lock.json` — drive `npm ci` and expose the `build`/`test` scripts.

### External

- `actions/checkout@v4` — checks out the repository.
- `actions/setup-node@v4` — provisions Node 20 with npm cache.
- `softprops/action-gh-release@v2` — creates/updates the GitHub Release and attaches `QuickSearch.zip`.
- `esbuild` (dev dependency, installed via `npm ci`) — used indirectly through `tools/build.mjs` during the build step.

<!-- MANUAL: Notes added below this line are preserved on regeneration -->
