/**
 * Ambient declarations for the Max 9 `v8` / `js` runtime and the Live API.
 * These are intentionally minimal — only what QuickSearch uses — and are based on
 * the Cycling '74 JS reference (docs.cycling74.com/apiref/js/).
 *
 * The `v8` object exposes the same globals as `js` (post, outlet, LiveAPI, Task,
 * Dict, ...) plus ES2020+. Message handlers are looked up as properties of the
 * global object, so the entry module attaches them to `globalThis`.
 */

/** Print to the Max console. */
declare function post(...args: unknown[]): void;
/** Print to the Max console as an error (red). */
declare function error(...args: unknown[]): void;
/** Send a message out of outlet `n` of the hosting object. */
declare function outlet(n: number, ...args: unknown[]): void;
/** Arguments typed after the object name in the patcher, e.g. `v8 quicksearch.js`. */
declare const jsarguments: unknown[];
/** Convert the `arguments` object of a handler into a real array. */
declare function arrayfromargs(...args: unknown[]): unknown[];
/** When 1, the file is re-read on disk change. We keep this 0 (see plan: leaks listeners). */
declare let autowatch: number;
/** Number of inlets/outlets the hosting object should present. */
declare let inlets: number;
declare let outlets: number;
/** Send a message to a named `receive`/`named object` (e.g. the jweb via `--->` send). */
declare function messnamed(name: string, ...args: unknown[]): void;

/** Cooperative scheduler task — used to chunk the browser walk across ticks. */
declare class Task {
  constructor(fn: () => void, context?: unknown, ...args: unknown[]);
  interval: number;
  running: boolean;
  schedule(delayMs?: number): void;
  repeat(times?: number, initialDelayMs?: number): void;
  cancel(): void;
}

/** Named dictionary, the safe channel for passing structured data to jweb. */
declare class Dict {
  constructor(name?: string);
  name: string;
  parse(json: string): void;
  stringify(): string;
  set(key: string, value: unknown): void;
  get(key: string): unknown;
  clear(): void;
  freepeer(): void;
}

/**
 * LiveAPI — the bridge to the Live Object Model.
 * Construct with a path (`new LiveAPI(cb, "live_set view selected_track")`) or an id.
 * `id` is a dynamic numeric handle (as a string) — never persist it.
 * NOTE: the browser is NOT in the LiveAPI LOM — it lives behind the Python bridge.
 */
declare class LiveAPI {
  constructor(callback?: ((args: unknown[]) => void) | null, pathOrId?: string);
  /** Current object id as a string, e.g. "42". "0" means "no object". */
  id: string;
  /** Space-delimited path, e.g. "live_set view selected_track". Settable to navigate. */
  path: string;
  /** Number of children for the property last queried (Live-specific). */
  children: string;
  /** Read a property; returns an array of atoms. */
  get(property: string): unknown[];
  /** Set a property. */
  set(property: string, ...value: unknown[]): void;
  /** Call a function on the object, e.g. call("load_item", id). */
  call(fn: string, ...args: unknown[]): unknown;
  /** Read an info string describing the object. */
  info: string;
  /** Observe a property (with the constructor callback). */
  property: string;
  /** Free the underlying object/observer. */
  freepeer?(): void;
  /** "id" + the numeric id, as Live returns it. */
  unquotedpath: string;
}
