/**
 * Spotlight-style fuzzy matcher.
 *
 * Given a lowercased query and a target string, returns a score and the matched
 * character ranges (for highlighting), or null if the query is not a subsequence
 * of the target. Scoring rewards, in rough order of weight:
 *   - exact and prefix matches
 *   - matches at word boundaries (start, after a separator, or camelCase humps)
 *   - consecutive (contiguous) matched characters
 * and penalizes gaps and a late first match. The result is a small, fast DP over
 * the target — names are short, so this stays well under a millisecond even across
 * a few thousand candidates per keystroke.
 */

const SCORE_MATCH = 16;
const SCORE_BOUNDARY = 30; // bonus for matching at a word boundary
const SCORE_CONSECUTIVE = 18; // bonus for matching immediately after the previous match
const SCORE_CAMEL = 22; // bonus for matching a camelCase hump
const PENALTY_LEADING = 4; // per-char penalty for characters skipped before the first match (capped)
const PENALTY_LEADING_MAX = 12;
const PENALTY_GAP = 2; // per-char penalty for a gap between two matched characters

const SEPARATORS = " \t-_/\\.()[]:,";

export interface FuzzyMatch {
  score: number;
  ranges: Array<[number, number]>;
}

function isSeparator(ch: string): boolean {
  return SEPARATORS.indexOf(ch) >= 0;
}

/** True if position `i` in `target` begins a "word" (boundary). */
function boundaryAt(target: string, i: number): boolean {
  if (i === 0) return true;
  const prev = target[i - 1];
  if (isSeparator(prev)) return true;
  // camelCase / digit humps: lower|digit -> Upper, or letter -> digit
  const cur = target[i];
  const prevLower = prev >= "a" && prev <= "z";
  const curUpper = cur >= "A" && cur <= "Z";
  if (prevLower && curUpper) return true;
  const prevAlpha = /[a-zA-Z]/.test(prev);
  const curDigit = cur >= "0" && cur <= "9";
  if (prevAlpha && curDigit) return true;
  return false;
}

/**
 * Core matcher. `query` must already be lowercased. `target` is the original
 * (mixed-case) string; `targetLower` its lowercased form (passed in to avoid
 * re-lowercasing on every call from the index).
 */
export function fuzzyMatch(
  query: string,
  target: string,
  targetLower: string,
): FuzzyMatch | null {
  const n = query.length;
  const m = target.length;
  if (n === 0) return { score: 1, ranges: [] };
  if (n > m) return null;

  // Quick subsequence rejection (cheap) before the DP.
  let qi = 0;
  for (let ti = 0; ti < m && qi < n; ti++) {
    if (targetLower[ti] === query[qi]) qi++;
  }
  if (qi < n) return null;

  // DP. best[j] holds the best score for matching query[0..i] with query[i] at
  // target[j], plus a backpointer to reconstruct ranges.
  // We iterate query char by char to keep memory at O(m).
  const NEG = -1e9;
  let prevRow = new Float64Array(m).fill(NEG);
  // backtrack table: for each (i, j) store the j' used at i-1. Store rows.
  const back: Int32Array[] = [];

  for (let i = 0; i < n; i++) {
    const row = new Float64Array(m).fill(NEG);
    const pick = new Int32Array(m).fill(-1);
    let bestPrev = NEG; // best prevRow[j'] for j' < j
    let bestPrevIdx = -1;
    for (let j = 0; j < m; j++) {
      // maintain running best of prevRow for positions strictly less than j
      if (i > 0 && j > 0) {
        if (prevRow[j - 1] > bestPrev) {
          bestPrev = prevRow[j - 1];
          bestPrevIdx = j - 1;
        }
      }
      if (query[i] !== targetLower[j]) continue;

      let cellBonus = SCORE_MATCH;
      const isBoundary = boundaryAt(target, j);
      const isCamel = isBoundary && j > 0 && !isSeparator(target[j - 1]);
      if (isBoundary) cellBonus += isCamel ? SCORE_CAMEL : SCORE_BOUNDARY;

      if (i === 0) {
        // first query char: penalize how far in we start
        const leading = Math.min(j * PENALTY_LEADING, PENALTY_LEADING_MAX);
        row[j] = cellBonus - leading;
        pick[j] = -1;
      } else if (bestPrevIdx >= 0) {
        const gap = j - bestPrevIdx - 1;
        let score = bestPrev + cellBonus - gap * PENALTY_GAP;
        if (gap === 0) score += SCORE_CONSECUTIVE; // contiguous run
        row[j] = score;
        pick[j] = bestPrevIdx;
      }
    }
    back.push(pick);
    prevRow = row;
  }

  // Find best ending cell in the last row.
  let bestScore = NEG;
  let bestJ = -1;
  for (let j = 0; j < m; j++) {
    if (prevRow[j] > bestScore) {
      bestScore = prevRow[j];
      bestJ = j;
    }
  }
  if (bestJ < 0) return null;

  // Backtrack to collect matched indices.
  const matched: number[] = [];
  let i = n - 1;
  let j = bestJ;
  while (i >= 0 && j >= 0) {
    matched.push(j);
    j = back[i][j];
    i--;
  }
  matched.reverse();

  // Bonuses that depend on the whole match.
  if (targetLower === query) bestScore += 200; // exact
  else if (targetLower.startsWith(query)) bestScore += 80; // prefix
  // Prefer shorter targets very slightly (tiebreak); keeps "EQ" above "EQ Eight" for "eq".
  bestScore -= m * 0.1;

  // Collapse matched indices into contiguous ranges.
  const ranges: Array<[number, number]> = [];
  for (const idx of matched) {
    const last = ranges[ranges.length - 1];
    if (last && idx === last[1]) last[1] = idx + 1;
    else ranges.push([idx, idx + 1]);
  }

  return { score: bestScore, ranges };
}
