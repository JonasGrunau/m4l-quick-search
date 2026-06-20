/**
 * M4L QuickSearch — v8 entry point.
 *
 * The Live browser is unreachable from the LiveAPI, so enumeration + loading run in
 * a Python Remote Script reached over a socket. The Node `bridge.js` relays between
 * that script and this brain. v8 still owns the UI, search ranking, track watching,
 * and the load confirmation (selected-track device-count delta — that IS exposed).
 *
 * Wiring contract (see dist/QuickSearch.maxpat / README):
 *   INLET 0 (control + UI + bridge messages):
 *     "init"            from live.thisdevice  → set up watcher + index, ping bridge
 *     "show"            from live.button      → reset + open the overlay
 *                       (NOT "open": "open" is a reserved js/v8 message that opens
 *                        the script source in Max's text editor instead of running)
 *     "refresh"         from a Refresh button → ask the bridge to rebuild the index
 *     "query <text>"    from jweb             → rank + push results
 *     "enter <ref>"     from jweb             → load the chosen item via the bridge
 *     "close"           from jweb             → hide the overlay
 *     "ready"           from jweb             → page is up; push current state
 *     "bridge <state>"  from bridge.js        → connected | disconnected
 *     "index_begin"/"index_chunk <b64>"/"index_end"  from bridge.js → index transfer
 *     "loaded <ok>"     from bridge.js        → a load_item round-trip finished
 *   OUTLET 0 → jweb:    "state <base64-json>", "focus", "reset", "url <data-uri>"
 *   OUTLET 1 → window:  "open", "close"   (drives the floating subpatcher window)
 *   OUTLET 2 → bridge:  "ping", "get_index", "refresh", "load <base64-uri>"
 *   OUTLET 3 → panel:   "progress <0..1>", "count <n>", "active <0|1>"  (device-strip widgets)
 */

import { BrowserIndex } from "./browser-index.ts";
import { TrackWatcher } from "./track.ts";
import { search } from "./search.ts";
import { selectedTrackDeviceCount } from "./loader.ts";
import { encodeBase64 } from "./b64.ts";
import { errMessage } from "./liveutil.ts";
import type { BridgeStatus, IndexEntry, Kind, Notice, SearchResult, TrackInfo, UiState } from "./types.ts";

// The whole overlay (html/index.html + styles.css + ui.js, inlined) is baked in at
// build time via esbuild `define` — see tools/build.mjs / tools/bundle-ui.mjs.
declare const __QS_UI_HTML__: string;

// Max reads these as magic globals; assign on the global object so the bundled
// (strict-mode IIFE) output configures the v8 object correctly.
const g: any = globalThis as any;
g.inlets = 1;
g.outlets = 4;
g.autowatch = 0;

const OUT_UI = 0;
const OUT_WINDOW = 1;
const OUT_BRIDGE = 2;
const OUT_PANEL = 3;

const LOAD_TIMEOUT_MS = 4000;
// Cadence + ceiling for the indeterminate indexing animation. The slow phase is the
// Python browser walk (before index_begin), for which we have no granular progress —
// so the bar eases toward a ceiling and only snaps to 1.0 when the index lands.
const PROGRESS_TICK_MS = 120;
const PROGRESS_CEIL = 0.9;

// ---- module state -----------------------------------------------------------
let index: BrowserIndex | null = null;
let watcher: TrackWatcher | null = null;
let masterIndex: IndexEntry[] = [];
let results: SearchResult[] = [];
let query = "";
let indexing = true;
let indexProgress = 0;
let indexCount = 0; // items reported by index_begin (shown on the device strip)
let progressTask: Task | null = null;
let bridge: BridgeStatus = "disconnected";
let indexRequested = false;
let notice: Notice = { kind: null, text: "", token: 0 };
let noticeToken = 0;
let closeTask: Task | null = null;
let focusTask: Task | null = null;
let pendingLoad: { entry: IndexEntry; before: number } | null = null;
let loadTimeout: Task | null = null;

// ---- bridge -----------------------------------------------------------------

function sendBridge(selector: string, ...args: unknown[]): void {
  outlet(OUT_BRIDGE, selector, ...args);
}

function pushState(): void {
  const info: TrackInfo = watcher ? watcher.info : { name: "", kind: "none" };
  const state: UiState = {
    query,
    results,
    track: info,
    count: indexCount,
    indexing,
    indexProgress,
    notice,
    bridge,
  };
  outlet(OUT_UI, "state", encodeBase64(JSON.stringify(state)));
}

/** Drive the device-strip widgets: progress bar, item count, refresh-button enable. */
function pushPanel(): void {
  outlet(OUT_PANEL, "progress", indexing ? indexProgress : 1);
  outlet(OUT_PANEL, "count", indexCount);
  outlet(OUT_PANEL, "active", indexing ? 0 : 1);
}

function stopProgressAnim(): void {
  if (progressTask) {
    progressTask.cancel();
    progressTask = null;
  }
}

/** Ease the bar toward PROGRESS_CEIL while we wait; index_end snaps it to 1.0. */
function startProgressAnim(): void {
  stopProgressAnim();
  const tick = guard("progress", () => {
    if (!indexing) {
      stopProgressAnim();
      return;
    }
    indexProgress += (PROGRESS_CEIL - indexProgress) * 0.15;
    if (indexProgress > PROGRESS_CEIL) indexProgress = PROGRESS_CEIL;
    pushPanel();
    pushState();
  });
  progressTask = new Task(tick);
  progressTask.interval = PROGRESS_TICK_MS;
  progressTask.repeat();
}

function focusInput(): void {
  outlet(OUT_UI, "focus");
}

function openWindow(): void {
  outlet(OUT_WINDOW, "open");
}

function closeWindow(): void {
  outlet(OUT_WINDOW, "close");
}

/**
 * Hand jweb the whole overlay as a self-contained `data:` URL, so the device
 * needs NOTHING on the Max search path (and a frozen .amxd works too). A bare
 * "read index.html" instead makes jweb's Chromium treat the filename as a
 * hostname → DNS_PROBE_FINISHED_NXDOMAIN. `encodeBase64` is UTF-8-safe and the
 * data: URI has no spaces, so it survives as a single Max atom.
 */
function loadUi(): void {
  outlet(OUT_UI, "url", "data:text/html;base64," + encodeBase64(__QS_UI_HTML__));
}

// ---- core -------------------------------------------------------------------

function recompute(): void {
  const compat = (k: Kind) => (watcher ? watcher.compatible(k) : true);
  results = search(masterIndex, query, compat);
}

function setNotice(kind: "hint" | "loaded", text: string): void {
  notice = { kind, text, token: ++noticeToken };
}

function clearNotice(): void {
  notice = { kind: null, text: "", token: ++noticeToken };
}

/** Ask the bridge to (re)send the index; the reassembled result arrives via index_*. */
function requestIndex(): void {
  if (!index) return;
  indexRequested = true;
  indexing = true;
  indexProgress = 0;
  indexCount = 0;
  startProgressAnim();
  pushPanel();
  index.start(); // emits "get_index" on OUT_BRIDGE
}

function init(): void {
  post("QuickSearch: init (browser bridge)\n");
  // Pre-warm the overlay: hand jweb the inlined page now (self-contained data:
  // URL — see loadUi). The page signals "ready" once loaded; we push state then.
  loadUi();

  watcher = new TrackWatcher((info) => {
    // Selection changed: recompute compatibility badges and refresh the UI if open.
    recompute();
    pushState();
  });
  watcher.start();

  index = new BrowserIndex(sendBridge, (entries) => {
    masterIndex = entries;
    indexing = false;
    indexProgress = 1;
    indexCount = entries.length;
    stopProgressAnim();
    recompute();
    pushState();
    pushPanel();
    post("QuickSearch: indexed " + entries.length + " items\n");
  });

  indexing = true;
  indexRequested = false;
  indexCount = 0;
  // Ask the bridge where it stands. Its "bridge connected"/"disconnected" reply
  // decides whether we request the index now or show setup guidance and wait.
  pushPanel();
  sendBridge("ping");
}

function open(): void {
  query = "";
  clearNotice();
  recompute();
  openWindow();
  outlet(OUT_UI, "reset");
  pushState();
  // Focus the input once the window is actually on screen.
  if (focusTask) focusTask.cancel();
  focusTask = new Task(focusInput);
  focusTask.schedule(120);
}

function close(): void {
  closeWindow();
}

function closeSoon(delayMs: number): void {
  if (closeTask) closeTask.cancel();
  closeTask = new Task(close);
  closeTask.schedule(delayMs);
}

function nounForKind(k: Kind): string {
  switch (k) {
    case "instrument":
      return "Instruments";
    case "midi_effect":
      return "MIDI effects";
    case "audio_effect":
      return "Audio effects";
    default:
      return "Plug-ins";
  }
}

function enter(ref: unknown): void {
  const n = Number(ref);
  const entry = masterIndex[n];
  if (!entry) return;
  const info: TrackInfo = watcher ? watcher.info : { name: "", kind: "none" };

  if (bridge !== "connected") {
    setNotice("hint", "Remote Script not connected — see the panel");
    pushState();
    return;
  }
  if (info.kind === "none") {
    setNotice("hint", "Select a track first");
    pushState();
    return;
  }
  if (!TrackWatcher.predict(entry.kind, info.kind)) {
    setNotice("hint", nounForKind(entry.kind) + " need a MIDI track");
    pushState();
    return;
  }

  const before = selectedTrackDeviceCount();
  if (before < 0) {
    setNotice("hint", "Select a track first");
    pushState();
    return;
  }

  // Hand off to the Python script; the device-count delta is checked on the ack
  // (or on the timeout, if the script never answers).
  pendingLoad = { entry, before };
  sendBridge("load", encodeBase64(entry.uri));
  if (loadTimeout) loadTimeout.cancel();
  loadTimeout = new Task(() => finishLoad(false));
  loadTimeout.schedule(LOAD_TIMEOUT_MS);
}

/** Resolve a pending load: confirm via the selected-track device-count delta. */
function finishLoad(acked: boolean): void {
  if (!pendingLoad) return;
  if (loadTimeout) {
    loadTimeout.cancel();
    loadTimeout = null;
  }
  const { entry, before } = pendingLoad;
  pendingLoad = null;

  const after = selectedTrackDeviceCount();
  if (after > before) {
    setNotice("loaded", "Added " + entry.name);
    pushState();
    closeSoon(380);
  } else if (!acked) {
    setNotice("hint", "No response — is the QuickSearch Remote Script running?");
    pushState();
  } else {
    setNotice("hint", 'Couldn’t add "' + entry.name + '"');
    pushState();
  }
}

function refresh(): void {
  if (!index) return;
  if (bridge !== "connected") {
    pushState();
    return;
  }
  indexing = true;
  indexProgress = 0;
  indexCount = 0;
  indexRequested = true;
  masterIndex = [];
  startProgressAnim();
  recompute();
  pushState();
  pushPanel();
  sendBridge("refresh"); // Python re-walks the browser, then re-sends the index
}

// ---- Max message handlers (attached to the global object) --------------------

function onQuery(): void {
  // join atoms so queries with spaces survive the Max message layer
  const args = arrayfromargs(arguments) as unknown[];
  query = args.map((a) => String(a)).join(" ");
  clearNotice();
  recompute();
  pushState();
}

function ready(): void {
  pushState();
}

function bang(): void {
  init();
}

// ---- bridge inbound (from node.script bridge.js) -----------------------------

function onBridge(state: unknown): void {
  bridge = String(state) === "connected" ? "connected" : "disconnected";
  if (bridge === "connected") {
    if (index && !index.ready && !indexRequested) requestIndex();
  } else {
    // Allow a re-request once the script comes back.
    indexRequested = false;
  }
  pushState();
  pushPanel();
}

function onIndexBegin(count: unknown): void {
  if (index) index.begin();
  indexing = true;
  // The bridge ships the item total up front (before the chunks) — show it now.
  const n = Number(count);
  if (n > 0) indexCount = n;
  pushPanel();
}

function onIndexChunk(part: unknown): void {
  if (index) index.chunk(String(part));
}

function onIndexEnd(): void {
  // index.end() runs the onDone callback (sets masterIndex, pushes state).
  if (index) index.end();
}

function onLoaded(ok: unknown): void {
  // Python finished the load_item call; confirm via the device-count delta.
  finishLoad(true);
}

function anything(): void {
  // Fallback router for any selector wired in (defensive).
  post("QuickSearch: unhandled message\n");
}

/**
 * Wrap a Max-facing entry point so a thrown JS exception is logged instead of
 * escaping into Max's v8 exception reporter — which null-derefs (gensym) and
 * HARD-CRASHES Live. Every handler here, plus every async callback (the LiveAPI
 * observer in track.ts and the load timeout Task), must be guarded.
 */
function guard<A extends unknown[]>(label: string, fn: (...a: A) => void): (...a: A) => void {
  return function (this: unknown, ...a: A): void {
    try {
      fn.apply(this, a);
    } catch (e) {
      error("QuickSearch: " + label + " error — " + errMessage(e) + "\n");
    }
  };
}

g.init = guard("init", init);
g.show = guard("show", open);
g.close = guard("close", close);
g.refresh = guard("refresh", refresh);
g.ready = guard("ready", ready);
g.enter = guard("enter", enter);
g.query = guard("query", onQuery);
g.bang = guard("bang", bang);
g.bridge = guard("bridge", onBridge);
g.index_begin = guard("index_begin", onIndexBegin);
g.index_chunk = guard("index_chunk", onIndexChunk);
g.index_end = guard("index_end", onIndexEnd);
g.loaded = guard("loaded", onLoaded);
g.anything = guard("anything", anything);
