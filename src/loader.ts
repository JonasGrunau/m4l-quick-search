/**
 * Selected-track device-count probe — used to confirm a load actually landed.
 *
 * Loading itself happens in the Python Remote Script: the browser, and therefore
 * `load_item`, is unreachable from the LiveAPI. But the *selected track* and its
 * `devices` ARE exposed, so we still confirm success on the v8 side by diffing the
 * device count around the bridge round-trip — `load_item` silently no-ops on an
 * incompatible drop, so a count that didn't move means "nothing landed".
 */

import { idList } from "./liveutil.ts";

/** Devices on the selected track, or -1 if nothing is selected. */
export function selectedTrackDeviceCount(): number {
  const t = new LiveAPI(null, "live_set view selected_track");
  const empty = !t.id || t.id === "0";
  const count = empty ? -1 : idList(t.get("devices")).length;
  if (t.freepeer) t.freepeer();
  return count;
}
