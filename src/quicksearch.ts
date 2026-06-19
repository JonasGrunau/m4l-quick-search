/**
 * M4L QuickSearch — v8 entry point.
 *
 * Wiring contract (see QuickSearch.maxpat / README):
 *   INLET 0 (control + UI messages):
 *     "init"            from live.thisdevice  → build index + watcher
 *     "open"            from live.button      → reset + open the overlay
 *     "refresh"         from a Refresh button → rebuild the index
 *     "query <text>"    from jweb             → rank + push results
 *     "enter <ref>"     from jweb             → load the chosen item
 *     "close"           from jweb             → hide the overlay
 *     "ready"           from jweb             → page is up; push current state
 *   OUTLET 0 → jweb:    "state <base64-json>", "focus", "reset"
 *   OUTLET 1 → window:  "open", "close"   (drives the floating subpatcher window)
 */

import { BrowserIndex } from "./browser-index.ts";
import { TrackWatcher } from "./track.ts";
import { search } from "./search.ts";
import { loadItem } from "./loader.ts";
import { encodeBase64 } from "./b64.ts";
import type { IndexEntry, Kind, Notice, SearchResult, TrackInfo, UiState } from "./types.ts";

// Max reads these as magic globals; assign on the global object so the bundled
// (strict-mode IIFE) output configures the v8 object correctly.
const g: any = globalThis as any;
g.inlets = 1;
g.outlets = 2;
g.autowatch = 0;

const OUT_UI = 0;
const OUT_WINDOW = 1;

// ---- module state -----------------------------------------------------------
let index: BrowserIndex | null = null;
let watcher: TrackWatcher | null = null;
let masterIndex: IndexEntry[] = [];
let results: SearchResult[] = [];
let query = "";
let indexing = true;
let indexProgress = 0;
let lastPushedProgress = -1;
let notice: Notice = { kind: null, text: "", token: 0 };
let noticeToken = 0;
let closeTask: Task | null = null;
let focusTask: Task | null = null;

// ---- bridge -----------------------------------------------------------------

function pushState(): void {
  const info: TrackInfo = watcher ? watcher.info : { name: "", kind: "none" };
  const state: UiState = {
    query,
    results,
    track: info,
    count: masterIndex.length,
    indexing,
    indexProgress,
    notice,
  };
  outlet(OUT_UI, "state", encodeBase64(JSON.stringify(state)));
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

function init(): void {
  // Pre-warm the overlay: tell jweb to load the page now (DEV path — needs html/
  // on the Max search path). Frozen devices inject the UI instead (see README).
  outlet(OUT_UI, "read", "index.html");

  watcher = new TrackWatcher((info) => {
    // Selection changed: recompute compatibility badges and refresh the UI if open.
    recompute();
    pushState();
  });
  watcher.start();

  index = new BrowserIndex(
    (fraction, count) => {
      indexing = true;
      indexProgress = fraction;
      if (fraction - lastPushedProgress >= 0.04 || fraction >= 1) {
        lastPushedProgress = fraction;
        pushState();
      }
    },
    (entries) => {
      masterIndex = entries;
      indexing = false;
      indexProgress = 1;
      recompute();
      pushState();
      post("QuickSearch: indexed " + entries.length + " items\n");
    },
  );
  index.start();
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

  const outcome = loadItem(entry);
  if (!outcome.located) {
    setNotice("hint", 'Couldn’t locate "' + entry.name + '" — try Refresh');
    pushState();
    return;
  }
  if (outcome.delta <= 0) {
    // located but nothing landed (e.g. an unexpected load_item rejection)
    setNotice("hint", 'Couldn’t add "' + entry.name + '"');
    pushState();
    return;
  }

  setNotice("loaded", "Added " + entry.name);
  pushState();
  closeSoon(380);
}

function refresh(): void {
  if (!index) return;
  indexing = true;
  indexProgress = 0;
  lastPushedProgress = -1;
  masterIndex = [];
  recompute();
  pushState();
  index.start();
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

function anything(): void {
  // Fallback router for any selector wired in (defensive).
  // messagename holds the selector in Max js/v8.
  post("QuickSearch: unhandled message\n");
}

g.init = init;
g.open = open;
g.close = close;
g.refresh = refresh;
g.ready = ready;
g.enter = enter;
g.query = onQuery;
g.bang = bang;
g.anything = anything;
