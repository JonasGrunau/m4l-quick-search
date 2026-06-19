/**
 * Loads a chosen item onto the currently selected track.
 *
 * Verified facts this relies on:
 *   - `browser.call("load_item", <id>)` loads onto whatever `live_set view
 *     selected_track` points at — no track argument.
 *   - load_item SILENTLY no-ops on an incompatible drop (no catchable error), so
 *     compatibility is predicted BEFORE calling. As a best-effort confirmation we
 *     diff the selected track's device count around the call.
 *   - LiveAPI ids are dynamic; the stable `uri` is re-resolved to a fresh id here.
 */

import type { IndexEntry } from "./types.ts";
import { resolveUri } from "./browser-index.ts";
import { idList } from "./liveutil.ts";

export interface LoadOutcome {
  /** False if the uri could not be re-resolved (library changed / needs Refresh). */
  located: boolean;
  /** Change in the selected track's device count (>0 ⇒ something was added). */
  delta: number;
}

function selectedTrackDeviceCount(): number {
  const t = new LiveAPI(null, "live_set view selected_track");
  const empty = !t.id || t.id === "0";
  const count = empty ? -1 : idList(t.get("devices")).length;
  if (t.freepeer) t.freepeer();
  return count;
}

export function loadItem(entry: IndexEntry): LoadOutcome {
  const before = selectedTrackDeviceCount();
  if (before < 0) return { located: false, delta: 0 };

  const id = resolveUri(entry.uri, entry.kind);
  if (!id) return { located: false, delta: 0 };

  const browser = new LiveAPI(null, "live_app browser");
  // load_item never throws (it silently no-ops on bad input), so we can't rely on
  // try/catch. Call the primary bare-id form; if the device count didn't move, try
  // the documented two-token "id N" form before giving up.
  browser.call("load_item", Number(id));
  let after = selectedTrackDeviceCount();
  if (after - before <= 0) {
    browser.call("load_item", "id", id);
    after = selectedTrackDeviceCount();
  }
  if (browser.freepeer) browser.freepeer();

  return { located: true, delta: after - before };
}
