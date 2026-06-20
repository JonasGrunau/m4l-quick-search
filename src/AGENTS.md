<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-20 | Updated: 2026-06-20 -->

# src

## Purpose
The v8 "brain" of QuickSearch: TypeScript modules that esbuild bundles into a single
strict-mode IIFE (`dist/quicksearch.js`) loaded by the Max `v8` object. This code owns
everything that isn't the jweb card or the out-of-process bridge: the inlet/outlet wiring
contract, search ranking, device-vs-track compatibility prediction, selected-track watching,
load confirmation by device-count delta, and the base64-JSON UI state pushed to the page.
The Live *browser* (enumeration + `load_item`) is unreachable from the Max LiveAPI, so those
live in the Python Remote Script and reach this code over the Node bridge; this directory is
the client of that bridge and the source of truth for all UI state.

## Key Files
| File | Description |
| --- | --- |
| `quicksearch.ts` | Entry point. Sets the Max magic globals (`inlets=1`, `outlets=4`, `autowatch=0`), holds all module state, and registers every Max message handler on `globalThis`. Documents the full inlet/outlet contract at the top (see below). Wires the `TrackWatcher` + `BrowserIndex`, runs the `enter` → bridge `load` → `finishLoad` confirmation flow with a 4 s timeout, and wraps every Max-facing entry point in `guard()`. |
| `browser-index.ts` | `BrowserIndex` class: the bridge index client. Requests the index (`get_index`), reassembles the ordered base64 chunks (`begin`/`chunk`/`end`), JSON-parses + normalises raw `IndexItem`s into `IndexEntry`s (adds `lower`), sorts alphabetically for deterministic ranking, and fires `onDone`. |
| `track.ts` | `TrackWatcher` class + `classifySpecialById` helper. Observes the `selected_track` *property* on `live_set view`, classifies the track (`midi`/`audio`/`group`/`return`/`master`/`none`), and predicts device compatibility (`compatible`/`predict`, plus the static `label`). Heavily guarded against Live's LiveAPI observer re-entrancy crash. |
| `search.ts` | `search()` ranker (`RESULT_LIMIT = 50`). Empty query → first N of the pre-sorted index; otherwise scores via `fuzzyMatch`, sorts by score then shorter-name then alphabetical, and maps to `SearchResult`s carrying compat badge, highlight ranges, and a stable `ref` index. |
| `fuzzy.ts` | `fuzzyMatch()`: Spotlight-style subsequence matcher. Cheap subsequence rejection, then an O(m) DP that rewards prefix/exact/boundary/camelCase/consecutive matches and penalises gaps + a late start. Returns a score and contiguous highlight ranges, or null. |
| `loader.ts` | `selectedTrackDeviceCount()`: reads `live_set view selected_track` → `devices` length (or `-1` if nothing selected). The before/after delta is how a load is confirmed, since `load_item` silently no-ops on an incompatible drop. |
| `liveutil.ts` | LiveAPI atom-parsing helpers: `idList` (both `["id", n]` and bare-number shapes), `readString` (joins multi-atom names), `readBool`, `readNum`, and `errMessage` (printable text for the guards). |
| `b64.ts` | `encodeBase64`/`decodeBase64`: hand-rolled UTF-8 ↔ base64 because Max's v8 lacks reliable `btoa`/`TextEncoder`. Used to ship UI state and load URIs as a single space-free Max atom, and to decode index chunks. |
| `types.ts` | Shared data model: `Kind`, `TrackKind`, `BridgeStatus`, `IndexItem`, `IndexEntry`, `SearchResult`, `TrackInfo`, `Notice`, and the `UiState` envelope pushed to the page. |

## For AI Agents

### Working In This Directory
- **Crashing Live is the prime hazard, and it's not a normal exception.** Two distinct C++-level
  crash modes are defended against here; preserve both:
  1. An *escaped JS throw* into Max's v8 exception reporter null-derefs `gensym` and hard-crashes
     Live. So every Max-facing entry point AND every async callback (LiveAPI observer in `track.ts`,
     the load-timeout `Task`) must be wrapped — see `guard()` in `quicksearch.ts` and the inline
     try/catch in `TrackWatcher.start`. Do not register a new `g.*` handler unwrapped.
  2. Doing LiveAPI reads (or even *constructing* a `LiveAPI`) inside an observer callback trips a
     Live re-entrancy limitation (`TLimitation`/`TNotPossibleWhileRecording`) that try/catch cannot
     stop. The observer in `track.ts` therefore does NOTHING but `schedule(0)` a `Task`; the real
     read runs on the next scheduler tick. Keep that deferral.
- **Never re-point the observed LiveAPI object.** `TrackWatcher` observes the `selected_track`
  *property* on a `live_set view` object and reads the actual selection through a *throwaway*
  `new LiveAPI(...)` each time. Re-pointing the observed object's `.path` re-resolves its id,
  re-fires the observer, and creates a scheduler-rate feedback loop that pegs Max. (`loader.ts`
  also uses a throwaway LiveAPI for the same reason.)
- `g.autowatch = 0` is **deliberate** — autowatch leaks observers. Don't turn it on.
- Every throwaway `LiveAPI` must be `freepeer()`'d (guarded with `if (api.freepeer)`); follow the
  existing pattern so peers don't accumulate.
- **Imports use explicit `.ts` extensions** (e.g. `import { search } from "./search.ts"`). esbuild
  resolves these; keep the extension on every relative import.
- UI state and load URIs cross to jweb/the bridge as a **single base64 atom** — no spaces, quotes,
  or commas survive Max's message layer otherwise. Always route structured data through `b64.ts`,
  never raw JSON.
- Compatibility is *predicted* before loading (`TrackWatcher.predict`) and *confirmed* after
  (`loader.ts` device-count delta). Plugins are intentionally never hard-blocked (synth/effect
  ambiguous); audio effects load anywhere; instruments + MIDI effects need a MIDI track. Mirror
  this if you touch either side.

### The wiring contract (from `quicksearch.ts`)
- **Inlet 0** (control + UI + bridge): `init`, `show`, `refresh`, `query <text>`, `enter <ref>`,
  `close`, `ready` from live.thisdevice/live.button/jweb; `bridge <state>`,
  `index_begin`/`index_chunk <b64>`/`index_end`, and `loaded <ok>` from `bridge.js`.
- **Outlet 0 → jweb**: `state <base64-json>`, `focus`, `reset`, `url <data-uri>`.
- **Outlet 1 → window**: `open`/`close` (drives the floating subpatcher via `pcontrol`).
- **Outlet 2 → bridge**: `ping`, `get_index`, `refresh`, `load <base64-uri>`.
- **Outlet 3 → panel**: `progress <0..1>`, `count <n>`, `active <0|1>` (device-strip widgets: progress bar, item count, refresh-enable).

### Testing / Verifying Changes
- `npm run typecheck` (tsc) for types, `npm test` (`tools/test.mjs`) for the unit suite — pure
  modules (`fuzzy.ts`, `search.ts`, `b64.ts`, `liveutil.ts`) are testable in plain Node without Max.
- `npm run build` to re-bundle and re-wrap the `.amxd`; `npm run watch` to rebuild on save.
- LiveAPI- and Task-dependent code (`track.ts`, `loader.ts`, the load flow in `quicksearch.ts`)
  is **load-time only** — it can only be exercised by dropping the device into Live 12.2+ / Max 9+.
  Watch the Max console for `QuickSearch: ...` posts; any `QuickSearch: <label> error — ...` line
  is a guard catching a throw that would otherwise crash Live.
- UI-shape changes to `UiState`/`SearchResult` are browser-previewable via `npm run dev`
  (`tools/dev-server.mjs`) on the jweb side, but the producing code here still needs a real Live
  session to populate it.

### Common Patterns
- All mutable module state is top-level `let` in `quicksearch.ts`; helpers (`pushState`,
  `recompute`, `setNotice`/`clearNotice`) read/write it directly — there's no store abstraction.
- Max globals are assigned via `const g: any = globalThis as any` so the strict-mode IIFE still
  configures the `v8` object.
- LiveAPI results are loosely-typed atom arrays; always read them through `liveutil.ts` helpers
  rather than indexing the raw array.
- Pure logic (`fuzzy.ts`, `search.ts`, `b64.ts`) takes no Max/Live globals and stays dependency-free
  and unit-testable; keep new pure logic that way.

## Dependencies

### Internal
- Bundled by `tools/build.mjs` (esbuild) into `dist/quicksearch.js` and wrapped into the `.amxd`.
- Produces the `UiState` (base64-JSON) consumed by the jweb UI in `../html/`.
- Talks to `../node/bridge.js` (Node bridge) over the three bridge outlet messages; that bridge
  relays to `../remote-script/QuickSearch/` (Python), which owns enumeration + `load_item`.
- `quicksearch.ts` orchestrates all other modules in this directory.

### External
- **esbuild** — bundles these `.ts` modules to the single IIFE.
- **Max `v8` runtime** — provides the magic globals (`inlets`/`outlets`/`autowatch`), `outlet`,
  `post`/`error`, `arrayfromargs`, and the `Task` scheduler. Lacks reliable `btoa`/`TextEncoder`
  (hence `b64.ts`).
- **LiveAPI** — the only Live surface reachable from here: tracks, the selected track, and its
  device count. Typed via `../types/maxapi.d.ts`. The browser is NOT exposed here (that's why the
  Python script exists).
- **jweb** (Chromium) — consumer of the base64-JSON state; not imported, but the contract here
  targets it.

<!-- MANUAL: Notes added below this line are preserved on regeneration -->
