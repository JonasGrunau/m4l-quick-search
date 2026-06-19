/** Shared data model for QuickSearch (v8 side and, mirrored, the jweb UI). */

/** The kind of loadable item — inferred from the browser category it was walked under. */
export type Kind = "instrument" | "audio_effect" | "midi_effect" | "plugin";

/** A track classification, used to predict device compatibility. */
export type TrackKind = "midi" | "audio" | "group" | "return" | "master" | "none";

/** One loadable entry in the search index. */
export interface IndexEntry {
  /** Canonical display name (BrowserItem.name) — what we match against. */
  name: string;
  /** Stable cross-session identifier (BrowserItem.uri). Re-resolved to a live id at load time. */
  uri: string;
  /** Provenance, e.g. "Core Library", a pack name (BrowserItem.source). */
  source: string;
  /** Which top-level browser category this came from. */
  kind: Kind;
  /** Lowercased name, precomputed for matching. */
  lower: string;
}

/** A ranked search result handed to the UI. */
export interface SearchResult {
  name: string;
  source: string;
  kind: Kind;
  /** True if this item can load onto the currently selected track. */
  compatible: boolean;
  /** Inclusive-exclusive match ranges into `name`, for highlighting. */
  ranges: Array<[number, number]>;
  /** Stable index into the master list, so Enter can resolve the exact entry. */
  ref: number;
}

/** The current selected-track summary shown in the footer / used for compat. */
export interface TrackInfo {
  name: string;
  kind: TrackKind;
}

/** A transient notice rendered in the footer area. */
export interface Notice {
  kind: "hint" | "loaded" | null;
  text: string;
  /** Monotonic token so the UI can distinguish repeated identical notices. */
  token: number;
}

/** The full UI state pushed to the jweb page on each update. */
export interface UiState {
  query: string;
  results: SearchResult[];
  /** Selection is owned by the page (it tracks the highlighted row locally). */
  track: TrackInfo;
  /** Number of items currently indexed. */
  count: number;
  /** Indexing progress; `indexing` false means the index is ready. */
  indexing: boolean;
  indexProgress: number; // 0..1
  notice: Notice;
}
