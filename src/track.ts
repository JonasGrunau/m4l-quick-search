/**
 * Tracks the currently selected Live track and predicts device compatibility.
 *
 * Verified facts this relies on:
 *   - The selection lives at `live_set view selected_track`; a callback'd LiveAPI
 *     on that path fires when the user changes selection. It resolves to `id 0`
 *     when nothing is selected.
 *   - `has_midi_input == 1` is the decisive "this track accepts MIDI" test. Do
 *     NOT use the output booleans — they flip once an instrument is present.
 *   - Compatibility (Live 11/12, identical): instruments + MIDI effects require a
 *     MIDI track; audio effects load anywhere; plugins are synth/effect-ambiguous
 *     so we never hard-block them.
 */

import type { Kind, TrackInfo, TrackKind } from "./types.ts";
import { idList, readBool, readString, errMessage } from "./liveutil.ts";

/**
 * Classify the master/return tracks by comparing the id against the master and
 * return-track ids — robust regardless of how Live formats the selected_track
 * path. These tracks are audio-only and DON'T expose `has_midi_input` /
 * `is_foldable`, so the caller checks this first and skips those reads (which
 * would otherwise post benign "no such attribute" errors). Returns null for a
 * normal track, which the caller then resolves via those properties.
 */
function classifySpecialById(id: string): TrackKind | null {
  const master = new LiveAPI(null, "live_set master_track");
  const masterId = master.id;
  if (master.freepeer) master.freepeer();
  if (id === masterId) return "master";

  const set = new LiveAPI(null, "live_set");
  const returns = idList(set.get("return_tracks"));
  if (set.freepeer) set.freepeer();
  if (returns.indexOf(id) >= 0) return "return";

  return null;
}

export class TrackWatcher {
  private api: LiveAPI | null = null;
  private current: TrackInfo = { name: "", kind: "none" };
  private onChange: (info: TrackInfo) => void;
  private refreshTask: Task | null = null;

  /** @param onChange called whenever the selection (or its type) changes. */
  constructor(onChange: (info: TrackInfo) => void) {
    this.onChange = onChange;
  }

  start(): void {
    // CRITICAL: a LiveAPI observer callback fires *inside* a Live notification.
    // Doing LiveAPI reads — or constructing LiveAPI objects — in that context
    // trips a Live re-entrancy limitation that throws a C++ exception (TLimitation
    // / TNotPossibleWhileRecording). That is NOT a JS throw, so try/catch can't
    // stop it; it unwinds through Max's v8 bridge and hard-crashes Live.
    //
    // So the observer must do NOTHING but schedule work: the actual read runs on
    // the next scheduler tick, outside the notification, where LiveAPI is safe.
    this.refreshTask = new Task(() => {
      try {
        this.refresh();
      } catch (e) {
        error("QuickSearch: selection watch error — " + errMessage(e) + "\n");
      }
    }, this);

    // Observe the *property* `selected_track` on `live_set view` — NOT the
    // selected_track object directly. Observing the property fires the callback
    // on every selection change without us ever mutating the observed object.
    // (The old approach re-pointed this same object's `.path` on each read,
    // which re-resolved its id and re-fired this callback → a scheduler-rate
    // feedback loop that pegged Max. Reads now go through a throwaway LiveAPI in
    // read(), so the observed object is never touched.)
    this.api = new LiveAPI(() => {
      if (this.refreshTask) this.refreshTask.schedule(0);
    }, "live_set view");
    this.api.property = "selected_track";

    // First read is deferred too (the observer's initial fire happens during
    // construction, which is itself inside Live's notification machinery).
    this.refreshTask.schedule(0);
  }

  get info(): TrackInfo {
    return this.current;
  }

  /** Re-read the selected track and classify it. */
  refresh(): void {
    const info = this.read();
    const changed = info.kind !== this.current.kind || info.name !== this.current.name;
    this.current = info;
    if (changed) this.onChange(info);
  }

  private read(): TrackInfo {
    if (!this.api) return { name: "", kind: "none" };
    // Read the live selection through a throwaway LiveAPI — NEVER the observed
    // object (re-pointing it would re-fire the observer and loop, see start()).
    const sel = new LiveAPI(null, "live_set view selected_track");
    const id = sel.id;
    if (!id || id === "0") {
      if (sel.freepeer) sel.freepeer();
      return { name: "", kind: "none" };
    }

    const name = readString(sel.get("name")) || "Track";

    // Master/return first (by id) — they lack has_midi_input/is_foldable, so
    // only read those for a normal track.
    let kind = classifySpecialById(id);
    if (!kind) {
      const isGroup = readBool(sel.get("is_foldable"));
      const hasMidi = readBool(sel.get("has_midi_input"));
      kind = isGroup ? "group" : hasMidi ? "midi" : "audio";
    }
    if (sel.freepeer) sel.freepeer();

    return { name, kind };
  }

  /**
   * Predict whether an item of the given kind can load onto the current track.
   * Pure function of kind + the cached track kind, so the UI can show a live badge.
   */
  compatible(kind: Kind): boolean {
    return TrackWatcher.predict(kind, this.current.kind);
  }

  static predict(kind: Kind, track: TrackKind): boolean {
    if (track === "none") return false; // nothing selected — nothing to load onto
    switch (kind) {
      case "audio_effect":
        return true; // loads onto any track type
      case "instrument":
      case "midi_effect":
        return track === "midi"; // MIDI-capable tracks only
      case "plugin":
        return true; // ambiguous (synth vs fx) — let Live decide, never hard-block
      default:
        return true;
    }
  }

  /** Human label for the footer. */
  static label(track: TrackKind): string {
    switch (track) {
      case "midi":
        return "MIDI Track";
      case "audio":
        return "Audio Track";
      case "group":
        return "Group Track";
      case "return":
        return "Return Track";
      case "master":
        return "Master Track";
      default:
        return "No track selected";
    }
  }

  dispose(): void {
    if (this.refreshTask) this.refreshTask.cancel();
    this.refreshTask = null;
    if (this.api && this.api.freepeer) this.api.freepeer();
    this.api = null;
  }
}
