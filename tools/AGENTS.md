<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-20 | Updated: 2026-06-20 -->

# tools

## Purpose
The build/dev/test pipeline for QuickSearch. Pure Node ESM (`.mjs`, stdlib only;
esbuild is the lone heavy dep), invoked via the root `package.json` npm scripts.
It compiles `src/*.ts` into the v8 bundle (`dist/quicksearch.js`), generates the
Max patcher JSON, packs it into the loadable `.amxd` device, inlines `html/` into
the self-contained UI bundle, stages the Python Remote Script into `dist/`, serves
the browser-only UI dev preview, runs the unit tests, and captures the README
overlay screenshot. Everything it produces lands in the git-ignored `dist/`.

## Key Files
| File | Description |
| --- | --- |
| `build.mjs` | Top-level orchestrator behind `npm run build` / `npm run watch`. Calls `bundleUi()` first and injects the inlined overlay into esbuild via `define` (`__QS_UI_HTML__`), esbuilds `src/quicksearch.ts` → `dist/quicksearch.js` (IIFE, es2020, `platform: "neutral"`), then `writeDevice()` (patcher JSON + `.amxd` + round-trip self-check), `checkUiEmbedded()` (asserts the overlay is baked in and the old search-path `read` is gone), and `stageRemoteScript()` (copies `remote-script/` → `dist/remote-script/`). `--watch` runs esbuild in context-watch mode. |
| `patcher.mjs` | Builds the complete `.maxpat` patcher object as plain JS (`buildPatcher()`). Defines every box/patchline: audio passthrough `plugin~`→`plugout~`, `live.thisdevice` init, the `v8 quicksearch.js` brain, trigger button, refresh, opt-in global-hotkey `node.script`, always-on `bridge.js` `node.script`, send/receive bridge atoms, `pcontrol`, and the floating `jweb` overlay subpatcher. The `project` dict carries `searchpath`/`layout` (see gotcha below). |
| `amxd.mjs` | `.amxd` container reader/writer mirroring Ableton's `amxd_textconv`. `buildAmxd()` writes the `ampf` → `meta` → `ptch` chunk sequence (`[4 ASCII id][UInt32 LE size][payload]`); `parseAmxd()` reads it back. Device codes: `aaaa` audio, `mmmm` midi, `iiii` instrument. Rejects frozen `mx@c` bundles. |
| `bundle-ui.mjs` | `bundleUi()` inlines `html/styles.css` and `html/ui.js` into `html/index.html` (regex-replacing the `<link>`/`<script src>` tags) → `dist/ui.bundle.html`, and returns the string. `build.mjs` bakes that into the v8 brain via esbuild `define` (`__QS_UI_HTML__`); `quicksearch.ts` → `loadUi()` then hands it to jweb as a `data:` URL, so the device needs nothing on the Max search path. Runnable standalone. |
| `dev-server.mjs` | Zero-dep live-reload server behind `npm run dev` (default port 5173, `PORT=` overrides). Node `http` + `fs.watch` + Server-Sent Events. Serves `html/` directly (NOT the bundle), injects a dark "over-Live" backdrop and a reload `<script>`, and auto-opens the browser. UI/design preview only — no Max bridge, so `ui.js` runs in design-preview mode with sample devices. |
| `test.mjs` | Unit runner behind `npm test`. Imports `src/*.ts` directly (Node strips the TS types) and asserts the pure logic: `fuzzyMatch`, `search` ranking + compat flags, `TrackWatcher.predict` compatibility rules, and the `encodeBase64`/`decodeBase64` bridge (incl. UTF-8 + chunked reassembly). No Max runtime needed. |
| `screenshot.mjs` | Renders the Spotlight overlay to `docs/overlay.png` (README hero). Uses `bundleUi()` in design-preview mode, opens it in Playwright (Chromium), and screenshots `#card` on a transparent canvas so the real 12px rounded corners + drop shadow are baked in. Playwright is ad-hoc / not a project dependency. |

## For AI Agents

### Working In This Directory
- **The patcher `project` dict MUST keep `searchpath` and `layout`.** Max's
  `project_deserialize_searchpath()` dereferences both unconditionally; a project
  dict missing either null-derefs and **SIGSEGVs Live on device load**. `build.mjs`
  guards this in its self-check (throws "would crash Live on load") — never remove
  the keys in `patcher.mjs` or the guard in `build.mjs`.
- Box/patchline shapes in `patcher.mjs` are per the verified Max 9 / Live 12 spec.
  IDs are referenced by string in the `lines` array — rename a box `id` and you
  must update every `line(...)` that points at it, or wiring silently breaks.
- The overlay `ov-style` message intentionally has **no `front`** token (`pcontrol`
  shows the window; the message only styles it) and sets absolute screen-pixel
  `window size` coords — adjust per display, don't add `front`.
- `.amxd` chunk sizes are **payload-only, UInt32 little-endian**; `buildAmxd`
  appends a `"\n\0"` (`0x0a 0x00`) to the `ptch` JSON. Keep `buildAmxd`/`parseAmxd`
  symmetric — the build's round-trip self-check is the only thing catching format drift.
- `bundle-ui.mjs` relies on the exact `<link rel="stylesheet" href="styles.css" />`
  and `<script src="ui.js"></script>` tags in `index.html`. If those tags change in
  `html/`, the regex replacements no-op silently and ship an unbundled page.
- `dev-server.mjs` injects its backdrop by string-replacing `<div id="scrim">`;
  `screenshot.mjs` does the same for its transparent shot style. Renaming that DOM
  anchor in `html/index.html` breaks both.
- Keep everything stdlib + esbuild. Playwright (screenshot) is opt-in and installed
  ad-hoc (`npm i --no-save playwright && npx playwright install chromium`); don't add
  it as a project dependency.

### Testing / Verifying Changes
- Logic / `src` changes: `npm test` (runs `test.mjs`; pure, no Max).
- Patcher / `.amxd` / build changes: `npm run build` — watch the console for the
  `✓ dist/QuickSearch Dev.amxd (type=aaaa, …)` line. A failed round-trip throws
  (`device type check failed`, `patcher round-trip failed`, or the
  `missing searchpath/layout` crash guard) and fails the build, not Live. Then load
  `dist/QuickSearch Dev.amxd` in Ableton and watch the Max console.
- UI / `html/` changes: `npm run dev` → http://localhost:5173, browser-previewable
  with live reload (design-preview mode, sample devices). Real device loading still
  needs Ableton + Max.
- README image: `node tools/screenshot.mjs` (after the ad-hoc Playwright install).
- `npm run typecheck` (tsc) covers the `src` types these tools compile.

### Common Patterns
- Every script computes `root` via `join(dirname(fileURLToPath(import.meta.url)), "..")`
  and uses absolute paths under it — `dist/` is `mkdir`'d before any write.
- Modules export pure functions (`buildPatcher`, `buildAmxd`/`parseAmxd`, `bundleUi`)
  that `build.mjs` composes; `bundle-ui.mjs` and `screenshot.mjs` also self-run when
  invoked directly via the `import.meta.url === file://${process.argv[1]}` guard.
- Console success lines are `✓`-prefixed; output is descriptive (type, byte size,
  box count) to make build failures self-explanatory.

## Dependencies

### Internal
- Reads `src/quicksearch.ts` (+ its imports) and, for tests, `src/fuzzy.ts`,
  `src/search.ts`, `src/track.ts`, `src/b64.ts`.
- Reads `html/index.html`, `html/styles.css`, `html/ui.js` (bundle + dev server + shot).
- Copies `remote-script/` (the Python Remote Script) into `dist/` for distribution.
- Produces the git-ignored `dist/` build outputs (`quicksearch.js`,
  `QuickSearch.maxpat`, `QuickSearch Dev.amxd`, `ui.bundle.html`, `remote-script/`)
  and `docs/overlay.png`.
- Driven by the npm scripts in the root `package.json`.

### External
- **esbuild** — the only heavy dependency; bundles `src` → `dist/quicksearch.js`.
- **Node stdlib** — `fs/promises`, `fs.watch`, `http`, `child_process`, `path`,
  `url`, `assert/strict`, `Buffer` (no other npm at runtime).
- **Playwright (Chromium)** — optional, ad-hoc, screenshot-only; not a project dep.
- Targets the **Max 9 / Live 12** patcher + `.amxd` spec, and the Max `v8` engine /
  `jweb` / `node.script` / `pcontrol` objects the generated patcher wires up.

<!-- MANUAL: Notes added below this line are preserved on regeneration -->
