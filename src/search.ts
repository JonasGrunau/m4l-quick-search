/** Ranking: turn an index + query into the top-N results for the UI. */

import { fuzzyMatch } from "./fuzzy.ts";
import type { IndexEntry, Kind, SearchResult } from "./types.ts";

export const RESULT_LIMIT = 50;

/**
 * Rank `index` against `query`. An empty query returns the first `limit` entries
 * (the index is pre-sorted alphabetically). `compat` decides the per-row badge.
 * `ref` is the entry's position in `index`, so Enter can resolve the exact item.
 */
export function search(
  index: IndexEntry[],
  query: string,
  compat: (kind: Kind) => boolean,
  limit: number = RESULT_LIMIT,
): SearchResult[] {
  const q = query.trim().toLowerCase();

  if (q.length === 0) {
    const out: SearchResult[] = [];
    for (let i = 0; i < index.length && out.length < limit; i++) {
      const e = index[i];
      out.push({
        name: e.name,
        source: e.source,
        kind: e.kind,
        compatible: compat(e.kind),
        ranges: [],
        ref: i,
      });
    }
    return out;
  }

  const scored: Array<{ res: SearchResult; score: number }> = [];
  for (let i = 0; i < index.length; i++) {
    const e = index[i];
    const m = fuzzyMatch(q, e.name, e.lower);
    if (!m) continue;
    scored.push({
      score: m.score,
      res: {
        name: e.name,
        source: e.source,
        kind: e.kind,
        compatible: compat(e.kind),
        ranges: m.ranges,
        ref: i,
      },
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // tiebreak: shorter name, then alphabetical
    if (a.res.name.length !== b.res.name.length) return a.res.name.length - b.res.name.length;
    return a.res.name < b.res.name ? -1 : 1;
  });

  return scored.slice(0, limit).map((s) => s.res);
}
