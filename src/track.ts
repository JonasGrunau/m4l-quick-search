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
import { idList, readBool, readString } from "./liveutil.ts";

/**
 * Classify a track by comparing its id against the master and return tracks —
 * robust regardless of how Live formats the selected_track path. Master/return
 * are audio-only, so this only affects the footer label (the load rule keys off
 * has_midi_input), but it keeps that label correct.
 */
function classifyById(id: string, hasMidi: boolean, isGroup: boolean): TrackKind {
  const master = new LiveAPI(null, "live_set master_track");
  const masterId = master.id;
  if (master.freepeer) master.freepeer();
  if (id === masterId) return "master";

  const set = new LiveAPI(null, "live_set");
  const returns = idList(set.get("return_tracks"));
  if (set.freepeer) set.freepeer();
  if (returns.indexOf(id) >= 0) return "return";

  if (isGroup) return "group";
  if (hasMidi) return "midi";
  return "audio";
}

export class TrackWatcher {
  private api: LiveAPI | null = null;
  private current: TrackInfo = { name: "", kind: "none" };
  private onChange: (info: TrackInfo) => void;

  /** @param onChange called whenever the selection (or its type) changes. */
  constructor(onChange: (info: TrackInfo) => void) {
    this.onChange = onChange;
  }

  start(): void {
    // The callback fires on selection change; we re-read on each fire.
    this.api = new LiveAPI(() => this.refresh(), "live_set view selected_track");
    this.refresh();
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
    // Re-point at the live selection each read (the object behind the path can change).
    this.api.path = "live_set view selected_track";
    const id = this.api.id;
    if (!id || id === "0") return { name: "", kind: "none" };

    const name = readString(this.api.get("name")) || "Track";
    const hasMidi = readBool(this.api.get("has_midi_input"));
    const isGroup = readBool(this.api.get("is_foldable"));

    return { name, kind: classifyById(id, hasMidi, isGroup) };
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
    if (this.api && this.api.freepeer) this.api.freepeer();
    this.api = null;
  }
}
