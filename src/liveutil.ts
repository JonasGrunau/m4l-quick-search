/**
 * Small helpers for reading Live API results, which come back as loosely-typed
 * atom arrays. Centralised so the quirks (id-list shapes, multi-atom strings)
 * live in one place.
 */

/**
 * Parse a child-id list returned by `api.get("children")` (or similar).
 * Live returns these as ["id", n1, "id", n2, ...]; some builds omit the "id"
 * tokens and return bare numbers. This handles both.
 */
export function idList(raw: unknown[]): string[] {
  const ids: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (v === "id") {
      const n = raw[++i];
      if (n !== undefined && String(n) !== "0") ids.push(String(n));
    } else if (typeof v === "number" && v !== 0) {
      ids.push(String(v));
    } else if (typeof v === "string" && /^\d+$/.test(v) && v !== "0") {
      ids.push(v);
    }
  }
  return ids;
}

/**
 * Read a string property that Live may split across several atoms (names with
 * spaces come back as multiple symbols). Joins and trims.
 */
export function readString(raw: unknown[]): string {
  if (!raw || raw.length === 0) return "";
  return raw.map((a) => String(a)).join(" ").trim();
}

/** Read a boolean-ish property (`get` returns [0] or [1]). */
export function readBool(raw: unknown[]): boolean {
  return raw && raw.length > 0 && Number(raw[0]) === 1;
}

/** Read a single number property. */
export function readNum(raw: unknown[]): number {
  return raw && raw.length > 0 ? Number(raw[0]) : 0;
}
