<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-20 | Updated: 2026-06-20 -->

# html

## Purpose
The jweb Spotlight overlay — a self-contained, dependency-free web page (HTML + CSS + plain ES5 JS) rendered inside Max's `jweb` object as QuickSearch's floating search card. It is the entire user-facing surface: a centered dark search bar over Live, fuzzy-matched result rows with kind badges, a track-target badge, and indexing/notice states. It owns no search logic — the v8 brain (`src/`) computes ranking, compatibility, and notices, ships the whole UI state to this page as base64-JSON over the `window.max` bridge, and this page renders it and sends back `query` / `enter` / `close` / `ready`. With no Max bridge present (a normal browser via `npm run dev`) it self-detects and falls into a design-preview mode seeded with sample devices, so the visuals can be iterated standalone.

## Key Files
| File | Description |
| --- | --- |
| `index.html` | Static markup: the `#scrim` (transparent margin) wrapping the `#card` dialog — `#searchbar` (magnifier SVG, `#q` text input, `#track-badge`), `#results-wrap` (`#results` list, `#empty`, `#indexing` progress), and `#footer` (`#notice` + key hints). Loads `styles.css` and `ui.js`. At build time `bundle-ui.mjs` inlines both into a single page that the v8 brain bakes in (`__QS_UI_HTML__`) and hands to jweb as a self-contained `data:` URL — dev and frozen alike; `npm run dev` serves this folder as-is for browser preview. |
| `styles.css` | All styling, targeting the real Live 12 dark palette via `:root` custom properties — amber accent `#ffad56` (caret, load-ok, selected left bar), cyan selection tint, per-kind hues, and the alert color. Defines the `pop` open animation, the `shake` (incompatible-Enter) animation, the `#indexing.waiting` bridge-offline state, and a `prefers-reduced-motion` opt-out. `html, body` are transparent so only the card paints over Live. |
| `ui.js` | Page logic as a strict-mode IIFE in plain ES5 (jweb's Chromium). Holds the `KIND` icon/tint/label map (mirrors `src/types.ts` `Kind`) and `TRACK_LABEL` map; renders state, builds result rows, handles keyboard/mouse navigation, decodes base64-JSON state, and wires the `window.max` bridge (with a frozen-path `window.QS` global and a polling fallback to `previewMode`). |

## For AI Agents

### Working In This Directory
- This page is a passive view of v8 state. The shape `render()` consumes (`state.track.kind`, `results[]` with `{name, source, kind, compatible, ranges, ref}`, `indexing`/`indexProgress`/`count`, `notice.kind` of `loaded`|`hint`, `bridge`) is a contract with `src/`. Changing a field name here without changing the v8 encoder breaks the UI silently — keep them in sync.
- `ui.js` is hand-written ES5 (`var`, IIFE, no arrow funcs/template literals/`const`). Match that style; jweb's engine and the frozen-injection path are the reason — do not modernize casually.
- Keyboard capture is the top real-Max hazard. `onKeyDown` is attached in capture phase and calls `e.stopPropagation()` plus `e.preventDefault()` so typing keys (and crucially **spacebar**) do not leak to Live's transport. The card relies on jweb `rendermode 2` for this on macOS; do not remove the capture-phase listener, the `stopPropagation`, or assume keys are safely trapped.
- The `send("close")` paths (Escape, and `mousedown` on the bare `#scrim`) depend on the floating window being shown/hidden by Max `pcontrol` — UI changes here cannot themselves close the window, only request it.
- `KIND` icons/hues and `TRACK_LABEL` keys mirror `src/types.ts`. If you add a kind or track type in v8, add it here too or rows fall back to the `plugin` badge / a `—` track label.
- The selected row must stay cyan-tinted with an amber left bar (`.row.selected`), never an opaque orange fill — this is a deliberate match to Live's shipped `.ask` theme; preserve it.
- State arrives base64-encoded specifically to dodge Max atom escaping — `decodeState` does `atob` then `decodeURIComponent(escape(...))` for UTF-8. Do not assume plain JSON over the wire.

### Testing / Verifying Changes
- Run `npm run dev` (`tools/dev-server.mjs`) to serve this folder with live-reload and preview in a normal browser. With no `window.max`, `ui.js` polls ~40×25ms then enters `previewMode()` with mock devices — so layout, palette, badges, highlight `<mark>`, empty/indexing states, and animations are all verifiable standalone, but the bridge round-trip is not.
- These files are not bundled by esbuild; they are consumed at load time by jweb. Real bridge behavior (state decode, `enter` loading, keyboard non-leak, spacebar/transport, floating-window flags) can only be confirmed inside Max running the built `.amxd` — watch the Max console and verify a space typed in the field does not start/stop Live playback.
- There is no automated test for these files; `npm test` covers the TS brain, not the rendered DOM.

### Common Patterns
- All result HTML is built as a string in `buildRows` and assigned via `innerHTML`; every interpolated value passes through `escapeHtml` (and match ranges through `highlight`, which wraps spans in `<mark>`). Keep that escaping when editing row markup — `name`/`source` come from the user's library.
- Selection state lives in JS (`selIndex`, `currentResults`) and is reflected to the DOM by toggling the `.selected` class in `applySelection`, which also `scrollIntoView({block:"nearest"})`. Navigation (`nav`) clamps; a new `state.query` resets `selIndex` to 0.
- Input is debounced 24ms before `send("query", …)`. Activation sends `send("enter", r.ref)` and `shake()`s first if `!r.compatible` — but v8, not the page, decides whether a load actually happens.
- Bridge handlers are registered two ways for robustness: `window.max.bindInlet("state"|"focus"|"reset", …)` when the bridge exists, and `window.QS = {state, focus, reset}` for the frozen `executejavascript` injection path. `send` no-ops gracefully (logs in preview) when `window.max.outlet` is absent.

## Dependencies

### Internal
- **`src/` (v8 brain)** — the authoritative producer of the base64-JSON UI state this page renders and the consumer of its `query`/`enter`/`close`/`ready` outlet messages. The `KIND` and `TRACK_LABEL` maps mirror `src/types.ts`.
- **`tools/build.mjs`** — inlines this page into the v8 brain at build time (`__QS_UI_HTML__`); the brain hands it to jweb as a self-contained `data:` URL (dev + frozen). The `window.QS` global remains as the `executejavascript`-injection fallback.
- **`tools/dev-server.mjs`** (`npm run dev`) — serves and live-reloads this folder for standalone browser iteration.

### External
- **Max `jweb`** — the Chromium host that renders this page in Live; supplies the `window.max` bridge (`bindInlet`/`outlet`) and depends on `rendermode 2` for keyboard capture. No npm packages, frameworks, or build step touch these files — pure browser HTML/CSS/ES5.

<!-- MANUAL: Notes added below this line are preserved on regeneration -->
