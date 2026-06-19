/**
 * Builds the searchable index by walking Live's browser.
 *
 * Verified facts this relies on:
 *   - The browser is reached at path `live_app browser`.
 *   - Category accessors (`instruments`, `audio_effects`, `midi_effects`,
 *     `plugins`) each return a single root BrowserItem; you recurse `.children`.
 *   - BrowserItem exposes `name`, `uri`, `source`, `is_folder`, `is_loadable`,
 *     `is_device` — but NO device-kind field, so kind is taken from the category.
 *   - The walk is thousands of synchronous round-trips; doing it in one pass
 *     freezes Live. We reuse ONE LiveAPI (reassign `.id`), process a bounded
 *     budget per scheduler tick, and yield via a Task.
 */

import type { IndexEntry, Kind } from "./types.ts";
import { idList, readBool, readString } from "./liveutil.ts";

interface Category {
  accessor: string;
  kind: Kind;
}

const CATEGORIES: Category[] = [
  { accessor: "instruments", kind: "instrument" },
  { accessor: "audio_effects", kind: "audio_effect" },
  { accessor: "midi_effects", kind: "midi_effect" },
  // plugins last: heaviest subtree, per-machine.
  { accessor: "plugins", kind: "plugin" },
];

const MAX_DEPTH = 12; // guard against pathological trees
const BUDGET_PER_TICK = 250; // BrowserItems visited per scheduler tick

interface StackFrame {
  id: string;
  depth: number;
  kind: Kind;
}

export class BrowserIndex {
  private entries: IndexEntry[] = [];
  private seen: Record<string, boolean> = {}; // dedupe by uri
  private stack: StackFrame[] = [];
  private api: LiveAPI | null = null;
  private task: Task | null = null;
  private visited = 0;
  private estimate = 1; // rough denominator for progress
  private done = false;
  private onProgress: (fraction: number, count: number) => void;
  private onDone: (entries: IndexEntry[]) => void;

  constructor(
    onProgress: (fraction: number, count: number) => void,
    onDone: (entries: IndexEntry[]) => void,
  ) {
    this.onProgress = onProgress;
    this.onDone = onDone;
  }

  get items(): IndexEntry[] {
    return this.entries;
  }

  get ready(): boolean {
    return this.done;
  }

  /** Begin (or restart) indexing. Safe to call again to refresh. */
  start(): void {
    // Free a peer left over from a still-running walk (refresh mid-index).
    if (this.api && this.api.freepeer) this.api.freepeer();
    this.entries = [];
    this.seen = {};
    this.stack = [];
    this.visited = 0;
    this.done = false;
    this.api = new LiveAPI(null, "live_app browser");

    // Seed the work stack with each category root's children.
    for (const cat of CATEGORIES) {
      const rootIds = idList(this.api.get(cat.accessor));
      for (const id of rootIds) {
        this.stack.push({ id, depth: 0, kind: cat.kind });
      }
    }
    this.estimate = Math.max(this.stack.length * 40, 1);

    if (this.task) this.task.cancel();
    // Self-rescheduling one-shot loop: each tick() re-schedules the next via
    // schedule(1) while work remains (no `interval` — that would double-fire).
    this.task = new Task(() => this.tick(), this);
    this.tick();
  }

  private tick(): void {
    if (!this.api) return;
    let budget = BUDGET_PER_TICK;
    while (budget-- > 0 && this.stack.length > 0) {
      const frame = this.stack.pop()!;
      this.visit(frame);
      this.visited++;
    }

    if (this.stack.length > 0) {
      this.estimate = Math.max(this.estimate, this.visited + this.stack.length);
      this.onProgress(this.visited / this.estimate, this.entries.length);
      this.task!.schedule(1);
    } else {
      this.finish();
    }
  }

  private visit(frame: StackFrame): void {
    const api = this.api!;
    api.id = frame.id;

    const isFolder = readBool(api.get("is_folder"));
    if (isFolder) {
      if (frame.depth < MAX_DEPTH) {
        const children = idList(api.get("children"));
        for (const cid of children) {
          this.stack.push({ id: cid, depth: frame.depth + 1, kind: frame.kind });
        }
      }
      return;
    }

    const loadable = readBool(api.get("is_loadable"));
    if (!loadable) return;

    // Device categories: keep only true devices (skip presets/samples).
    // Plugins: keep any loadable leaf (plugin entries are not always is_device).
    if (frame.kind !== "plugin") {
      const isDevice = readBool(api.get("is_device"));
      if (!isDevice) return;
    }

    const uri = readString(api.get("uri"));
    if (uri && this.seen[uri]) return; // dedupe across categories
    if (uri) this.seen[uri] = true;

    const name = readString(api.get("name"));
    if (!name) return;
    const source = readString(api.get("source"));

    this.entries.push({
      name,
      uri,
      source,
      kind: frame.kind,
      lower: name.toLowerCase(),
    });
  }

  private finish(): void {
    this.done = true;
    if (this.task) {
      this.task.cancel();
      this.task = null;
    }
    if (this.api && this.api.freepeer) this.api.freepeer();
    this.api = null;
    // Stable sort by name so equal-score results have a deterministic order.
    this.entries.sort((a, b) => (a.lower < b.lower ? -1 : a.lower > b.lower ? 1 : 0));
    this.onProgress(1, this.entries.length);
    this.onDone(this.entries);
  }

  dispose(): void {
    if (this.task) this.task.cancel();
    if (this.api && this.api.freepeer) this.api.freepeer();
    this.task = null;
    this.api = null;
  }
}

/**
 * Re-resolve a stable `uri` to a fresh live BrowserItem id by a targeted walk of
 * its category. LiveAPI ids are dynamic and must never be persisted, so we look
 * the item up again at load time. Returns the id string, or null if not found.
 */
export function resolveUri(uri: string, kind: Kind): string | null {
  const accessor = ({
    instrument: "instruments",
    audio_effect: "audio_effects",
    midi_effect: "midi_effects",
    plugin: "plugins",
  } as Record<Kind, string>)[kind];

  const api = new LiveAPI(null, "live_app browser");
  const stack = idList(api.get(accessor)).map((id) => ({ id, depth: 0 }));
  let guard = 200000; // hard safety bound
  while (stack.length > 0 && guard-- > 0) {
    const f = stack.pop()!;
    api.id = f.id;
    if (readBool(api.get("is_folder"))) {
      if (f.depth < MAX_DEPTH) {
        for (const cid of idList(api.get("children"))) {
          stack.push({ id: cid, depth: f.depth + 1 });
        }
      }
      continue;
    }
    if (readString(api.get("uri")) === uri) {
      const found = f.id;
      if (api.freepeer) api.freepeer();
      return found;
    }
  }
  if (api.freepeer) api.freepeer();
  return null;
}
