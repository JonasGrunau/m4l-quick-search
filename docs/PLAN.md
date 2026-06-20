# M4L QuickSearch — Implementation Plan

A Spotlight-style search overlay for Ableton Live, built as a Max for Live device. A hotkey opens a centered search card; typing fuzzy-matches the user's installed instruments, audio effects, MIDI effects, and VST/AU plugins; pressing Enter loads the selected item onto the currently selected track. Incompatible items show an inline hint instead of loading.

> **Status (2026-06-19):** Implemented and verified to the extent possible without Ableton — unit tests, `tsc`, esbuild bundle, and a round-trip through Ableton's own `amxd_textconv.py` all pass; a fresh-eyes logic review found no blocking bugs. The remaining work is the **verify-in-Max checklist** (below). See `README.md`.
>
> **Correction (2026-06-20):** The first real run in Ableton exposed a false premise — **Live's browser is NOT in the Max LiveAPI.** The Live 12 `Application` LOM has no `browser` child (only `view` + `control_surfaces`), so `new LiveAPI(null, "live_app browser")` throws *"component 'browser' is not an object"* and indexed **0** items. The browser + `load_item` exist only in the **Python Remote Script** API (`Live.Application.get_application().browser`). Re-architected accordingly: a `remote-script/QuickSearch/` Python control surface owns enumeration + loading, reached from the v8 brain via `node.script bridge.js` over a localhost TCP socket. v8 still owns ranking, compatibility, the overlay, and the device-count load confirmation (tracks/devices *are* exposed). Passages below that describe a LiveAPI browser walk are **superseded** by this bridge design.

## Context

The user wants a fast, keyboard-driven way to load devices/plugins in Ableton Live without hunting through the browser — like macOS Spotlight, but for Live's device library. This was a greenfield repo. Feasibility was verified against primary sources (Cycling '74 LOM, the NSUSpray LiveAPI version XML dumps, shipped Ableton `.ask` theme files, and Ableton's `maxdevtools/maxdiff` parser). The core mechanisms — enumerating the browser, predicting track compatibility, loading onto the selected track, and rendering a polished overlay — are all confirmed possible. One Mac-specific risk (jweb leaking keystrokes to Live) is de-risked by a spike before anything else is built.

### Locked decisions
- **Targets:** Live 12.2 + Max 9 only (v8 / ES2020+, modern jweb / CEF 122).
- **Trigger:** native Live Key-Map + MIDI-map to a `live.button` (primary), **plus** an opt-in OS-global hotkey via `node.script` + `uiohook-napi`.
- **Search scope:** devices + plugins only — instruments, audio effects, MIDI effects, VST/AU plugins.
- **Form factor:** floating centered Spotlight card only (no docked variant).

### Load-bearing facts (verified)
- ~~Browser is reached via `new LiveAPI(null, "live_app browser")`.~~ **WRONG (see Correction above)** — the browser is not exposed to the Max LiveAPI. It lives only in the Python Remote Script API (`Live.Application.get_application().browser`); a Remote Script enumerates it and calls `browser.load_item(item)`, which loads onto whatever `live_set view selected_track` points at — taking **no** track argument.
- `load_item` **silently no-ops** on an incompatible drop (no catchable error). Compatibility **must be predicted before** calling, never caught after.
- BrowserItem exposes `name`, `is_loadable`, `is_device`, `is_folder`, `uri`, `source`, `children` — but **no "device kind"** field. Kind is inferred from which category root it was walked under and stored per entry.
- Selected track: `live_set view selected_track` (returns `id 0` when nothing selected — guard it). Classify via `has_midi_input==1` → MIDI; group/return/master by comparing track ids; else audio.
- Compatibility rules (Live 11/12, identical): instruments + MIDI effects → MIDI tracks only; audio effects → any track; plugins are synth/effect-ambiguous → don't hard-block.
- Max `key`/`keyup` only fire when the Max window is focused — useless as the trigger. Live Key-Map binds one computer key to a `live.button`; single keys only (no Cmd+Space-style chords). The button outlet fires while Live is focused.
- `jweb` = Chromium/CEF. The whole overlay (`html/`, inlined at build time) is handed to jweb as a self-contained `data:` URL, so the device needs nothing on the search path and a frozen `.amxd` works too (`executejavascript` injection into `about:blank` is the kept fallback). Bridge: `window.max.outlet()` (page→Max), `bindInlet` / `executejavascript` / `setDict`/`getDict` (Max→page).
- `.amxd` container = chunks `ampf`(`"aaaa"` audio-effect code) → `meta`(LE 7) → `ptch`(plain UTF-8 patcher JSON + `\n\0`); patcher `classnamespace:"box"`, `project.amxdtype` FourCC. An M4L audio effect **must** wire `plugin~`→`plugout~` or the track goes silent.
- Floating chromeless overlay = a subpatcher window driven by `thispatcher` (`window flags float nogrow nomenu notitle nozoom`, `window exec`, `window size <l t r b>` in absolute screen px). M4L floating windows **freeze redraw when the user switches tracks** → design the flow as momentary (open → type → Enter → close on one selection).
- Index is requested on the `live.thisdevice` bang (never in JS global scope). The browser walk now runs in the **Python Remote Script**, chunked across Live's main-thread ticks (`schedule_message`) — Live's embedded Python beachballs if you start a thread, so the socket is non-blocking and polled on the tick. Dedupe entries by `uri`.

## Architecture

```
┌────────────────────────── QuickSearch.amxd (Max Audio Effect) ───────────────────────────┐
│  live.thisdevice ──► [v8 quicksearch.js] ── LiveAPI(live_set view selected_track)          │
│       (init)              │  ▲                 (track compat + load confirm — exposed)      │
│  live.button ──► show ───┤  │ results / hint / open-close                                  │
│  node.script (hotkey) ───┤  ▼                                                              │
│  global hotkey ──► show   │ [pcontrol] ──► floating chromeless jweb overlay window ◄ window.max │
│                           │                                                                │
│  v8 outlet2  ◄──────────► [node.script bridge.js] ──TCP / JSON──► Python Remote Script      │
│  ping/get_index/load/refresh   (Node `net` relay)                 get_application().browser │
│                                                                    walk + load_item(by uri) │
│  plugin~ ─► plugout~   (mandatory transparent audio passthrough)                            │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Device type:** Max **Audio Effect** — the only kind placeable on every track including Master/return/group. User parks one instance on the **Master**; it always targets the *selected* track regardless.
- **Stateless:** nothing is written into the `.als`. The index rebuilds on device load (+ manual Refresh).
- **v8 ↔ jweb bridge:** state is shipped page-bound as base64-encoded JSON (a single Max atom — no escaping issues); the page decodes with `atob`. Page→Max sends small messages (`query`, `enter`, `close`, `ready`).

## Repo layout

```
m4l-quick-search/
├─ src/                          # v8 (TypeScript) source
│  ├─ quicksearch.ts             # entry: glue, message handlers, jweb bridge
│  ├─ browser-index.ts           # bridge index client: request + reassemble {name,uri,source,kind}
│  ├─ track.ts                   # selected-track classify + compatibility prediction
│  ├─ search.ts                  # ranking (top-N, compat flags, refs)
│  ├─ fuzzy.ts                   # subsequence DP scorer + highlight ranges
│  ├─ loader.ts                  # selected-track device-count probe (load confirm)
│  ├─ b64.ts                     # UTF-8 → base64 (no btoa in v8)
│  └─ liveutil.ts                # LiveAPI atom-array parsers
├─ dist/                         # all build output, git-ignored: quicksearch.js,
│                                #   ui.bundle.html, QuickSearch Dev.amxd, QuickSearch.maxpat,
│                                #   staged node.script files (bridge.js, global-hotkey.js, package.json) + remote-script/
├─ html/                         # the jweb Spotlight UI (index.html, styles.css, ui.js)
├─ node/                         # bridge.js (browser bridge) + global-hotkey.js + package.json
├─ remote-script/                # QuickSearch/ — Python Remote Script (browser walk + load_item)
├─ tools/                        # build.mjs, patcher.mjs, amxd.mjs, bundle-ui.mjs, test.mjs
├─ types/                        # LiveAPI / Max v8 typings
├─ .gitattributes               # maxdiff textconv for *.amxd / *.maxpat
└─ package.json · tsconfig.json
```

Dev loop: add `dist/` to **Max → Options → File Preferences → search path**, install `remote-script/QuickSearch/` into Live's Remote Scripts folder (select it as a Control Surface), work on `dist/QuickSearch Dev.amxd` unfrozen, reload the `v8` with a manual `compile` message (auto-watch is off — it leaks Live API observers). Release: pushing a `v*` tag runs `.github/workflows/release.yml`, which `npm run build`s and publishes `QuickSearch.zip` (`dist/` — the build stages the `node.script` files into it — + `remote-script/` + install note) to the GitHub Release.

## Build milestones

### 0 — jweb keyboard spike (Mac) · GO/NO-GO ⚠️
Confirm on the user's exact Live 12.2 / Max 9 / macOS build that typing (esp. **spacebar**) is captured by the search input and doesn't leak to Live's transport, using `rendermode 2` (offscreen + transparent). **If fatal:** fall back to a native Max `textedit` for the input. The rest of the design is identical either way. _(Only runtime-testable; see verify checklist.)_

### 1 — Scaffold + device shell + build tooling ✓
Audio Effect `.amxd` with `live.thisdevice`, `v8 quicksearch.js`, `jweb`, mappable `live.button`, `node.script`, `plugin~`→`plugout~`, generated by `tools/patcher.mjs` + `tools/amxd.mjs`. esbuild bundle to `dist/`. Validated through Ableton's parser.

### 2 — Browser indexing ✓
Walk `instruments`, `audio_effects`, `midi_effects`, `plugins`. Reuse one `LiveAPI`; recurse `children`; collect `is_loadable` (device/plugin) leaves as `{name, uri, source, kind}`; dedupe by `uri`; chunk the walk with a self-rescheduling `Task`; show an "indexing…" state; manual Refresh.

### 3 — Selected-track observer + compatibility ✓
Callback'd `LiveAPI` on `live_set view selected_track`; classify (id comparison for master/return, `is_foldable` for group, `has_midi_input` for MIDI, else audio); `predict(itemKind, trackKind)` drives a live badge.

### 4 — Load + hint ✓
On Enter: guard no-track → predict incompatible → inline hint, no load. If ok: re-resolve `uri` → fresh BrowserItem id, snapshot device count, `load_item` (bare-id then `"id" N` fallback), flash the amber load-OK bar only when the count actually increased.

### 5 — Spotlight UI + bridge ✓
HTML/CSS/JS card to the design tokens, base64-JSON state push, keystroke→query→ranked results, arrow/Tab nav, Enter loads, Esc/click-outside closes. The self-contained bundle (`dist/ui.bundle.html`) is inlined into the v8 brain at build time and handed to jweb as a `data:` URL.

### 6 — Floating centered window ✓ (verify in Max)
Subpatcher + `thispatcher` set `float / notitle / nogrow / …` + `window size`; `[active]` re-applies flags on show; `pcontrol` shows/hides without destroying (jweb stays warm). Momentary open→Enter→close flow.

### 7 — Triggers (Key-Map + MIDI-Map) ✓
The `live.button` outlet → `show` (not the reserved js/v8 word `open`). README documents the one-time Computer-Key-Map / MIDI-Map step.

### 8 — Opt-in OS-global hotkey ✓
`node.script` + `uiohook-napi`; gated behind the Global Hotkey toggle; warns about macOS Accessibility/Input-Monitoring permission. The Node process has no Live API access — it only outlets `show`.

### 9 — Fuzzy ranking ✓
Subsequence DP with exact/prefix boosts, word-boundary/camelCase bonuses, contiguous-run bonus, shorter-name tiebreak, ~24 ms input debounce.

### 10 — Freeze, distribute, README ◷
Freeze, verify externals, commit the frozen `.amxd`. (The overlay is inlined into the v8 brain and served to jweb as a `data:` URL, so dev and frozen builds are both self-contained; only `dist/` needs to be on the search path.)

## Design system (Live 12 dark, from shipped `.ask` themes)

| Token | Value |
|---|---|
| Panel bg / border | `#1c1c1c` / `1px rgba(255,255,255,0.06)`, radius `12`, top `22vh`, width `640` |
| Search field | bg `#1e1e1e`, h `60`, input `20px/400 #d6d6d6`, placeholder `#6f6f6f`, **caret `#ffad56`** |
| Result row | h `48`, label `14/500 #c8c8c8`, meta `12 #7a7a7a`, badge `28 r7` |
| Selected row | bg `rgba(176,221,235,0.10)` (**cyan**, not orange) + **2px left bar `#ffad56`** + label `#f0f0f0` |
| Footer / keycaps | bg `#161616`, keycap bg `#2a2a2a` border `#383838` |
| Accent (caret / load-OK) | amber `#ffad56` · Selection cyan `#b0ddeb` (~10%) |
| Incompatible hint | bar `rgba(231,105,66,0.12)`, left `2px #e76942`, text `#d98a5e` — **no hard red**; gentle shake, auto-dismiss 2.5s |
| Category hues | Instrument `#ffad56` · AudioFX `#5cc8d6` · MIDIFX `#7bd88f` · Plugin `#b18cf0` |
| Font | system stack `-apple-system, "Helvetica Neue", "Segoe UI", Inter, Roboto, Arial, sans-serif` |
| Motion | open: panel `translateY(-8px) scale(.98)→0/1` 160ms `cubic-bezier(.16,1,.3,1)`; respect `prefers-reduced-motion` |

## Verification

- **In-repo (automated):** `npm test` (fuzzy/search/compat/base64), `npm run typecheck`, `npm run build` (round-trips the `.amxd` through Ableton's `amxd_textconv.py`).
- **In Max/Live (the verify-in-Max checklist):**
  1. **jweb keyboard capture** — typing (esp. spacebar) stays in the field, doesn't hit Live's transport.
  2. **Floating-window flags** — overlay floats borderless; tweak `window size` per display.
  3. **Loading** — Key-Map a key, search, Enter lands the device on the selected track; an instrument onto an audio track shows the hint instead.

## Top risks & mitigations
1. **(Mac) jweb keystroke leak** → spike first; `rendermode 2`; native `textedit` fallback.
2. **Overlay freezes on mid-search track switch** → momentary open→Enter→close flow; documented.
3. **`load_item` silent no-op on incompatible** → predict before loading; device-count delta gates the success notice + drives the bare-id↔`"id" N` fallback.
4. **Blocking browser walk freezes Live** → one reused `LiveAPI`, chunked self-rescheduling `Task`, index plugins last, indexing state.
5. **Stale dynamic ids** → never persist ids; re-resolve `uri`→id at load time; rebuild index per session.
6. **Single-key trigger only / key collision** → suggest an uncommon key, document remap, offer MIDI + opt-in global hotkey.
7. **Frozen device can't read bundled HTML** → the overlay is inlined into the v8 brain (`__QS_UI_HTML__`) and served to jweb as a self-contained `data:` URL; `executejavascript` injection is the kept fallback.
