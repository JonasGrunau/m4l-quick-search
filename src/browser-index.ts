/**
 * The search index, sourced from the browser bridge.
 *
 * Live's browser is NOT reachable from the Max LiveAPI — the Application object has
 * no `browser` child (confirmed against the Live 12 LOM; `live_app browser` throws
 * "component 'browser' is not an object"). So a Python Remote Script walks the
 * browser and ships the index over a socket, and the Node `bridge.js` relays it to
 * us as ordered base64 chunks. This class requests the index and reassembles it —
 * no LiveAPI, no chunked walk, no `freepeer` bookkeeping anymore.
 */

import type { IndexEntry, IndexItem } from "./types.ts";
import { decodeBase64 } from "./b64.ts";

export class BrowserIndex {
  private entries: IndexEntry[] = [];
  private parts: string[] = [];
  private receiving = false;
  private done = false;
  private send: (selector: string, ...args: unknown[]) => void;
  private onDone: (entries: IndexEntry[]) => void;

  /**
   * @param send   emits a message to the bridge outlet (e.g. "get_index").
   * @param onDone called with the finished entries when a full index arrives.
   */
  constructor(
    send: (selector: string, ...args: unknown[]) => void,
    onDone: (entries: IndexEntry[]) => void,
  ) {
    this.send = send;
    this.onDone = onDone;
  }

  get items(): IndexEntry[] {
    return this.entries;
  }

  get ready(): boolean {
    return this.done;
  }

  /** Ask the bridge to (re)build and send the index. */
  start(): void {
    this.parts = [];
    this.receiving = false;
    this.done = false;
    this.send("get_index");
  }

  /** Bridge: a fresh index transfer is starting (drop any partial). */
  begin(): void {
    this.parts = [];
    this.receiving = true;
  }

  /** Bridge: one base64 chunk of the index JSON, in order. */
  chunk(part: string): void {
    if (this.receiving) this.parts.push(part);
  }

  /** Bridge: transfer complete — decode, normalise, publish. */
  end(): void {
    if (!this.receiving) return;
    this.receiving = false;
    const items = JSON.parse(decodeBase64(this.parts.join(""))) as IndexItem[];
    this.parts = [];

    const entries: IndexEntry[] = [];
    for (const it of items) {
      const name = it && it.name ? String(it.name) : "";
      if (!name) continue;
      entries.push({
        name,
        uri: it.uri ? String(it.uri) : "",
        source: it.source ? String(it.source) : "",
        kind: it.kind,
        lower: name.toLowerCase(),
      });
    }
    // Stable alphabetical order so equal-score results are deterministic and the
    // empty-query list reads naturally (robust even if Python already sorted).
    entries.sort((a, b) => (a.lower < b.lower ? -1 : a.lower > b.lower ? 1 : 0));

    this.entries = entries;
    this.done = true;
    this.onDone(entries);
  }
}
