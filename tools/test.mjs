/**
 * Unit tests for the pure logic (no Max runtime needed).
 * Node strips the TS types on import. Run with `npm test`.
 */

import assert from "node:assert/strict";
import { fuzzyMatch } from "../src/fuzzy.ts";
import { search } from "../src/search.ts";
import { TrackWatcher } from "../src/track.ts";
import { encodeBase64, decodeBase64 } from "../src/b64.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("  ✓ " + name);
}

console.log("fuzzy:");
test("rejects non-subsequence", () => {
  assert.equal(fuzzyMatch("eq8", "EQ Eight", "eq eight"), null);
});
test("matches subsequence with ranges", () => {
  const m = fuzzyMatch("ppd", "Ping Pong Delay", "ping pong delay");
  assert.ok(m);
  assert.deepEqual(m.ranges, [[0, 1], [5, 6], [10, 11]]);
});
test("exact beats prefix beats substring", () => {
  const exact = fuzzyMatch("serum", "Serum", "serum").score;
  const prefix = fuzzyMatch("serum", "Serum 2", "serum 2").score;
  const sub = fuzzyMatch("serum", "MySerum", "myserum").score;
  assert.ok(exact > prefix && prefix > sub, `${exact} > ${prefix} > ${sub}`);
});

console.log("search:");
const idx = [
  ["EQ Eight", "audio_effect"],
  ["Operator", "instrument"],
  ["Arpeggiator", "midi_effect"],
  ["Serum 2", "plugin"],
  ["Reverb", "audio_effect"],
].map(([name, kind]) => ({
  name, kind, uri: "u:" + name, source: "Lib", lower: name.toLowerCase(),
}));

test("empty query returns all (capped) with compat flags", () => {
  const r = search(idx, "", () => true);
  assert.equal(r.length, idx.length);
  assert.ok(r.every((x) => x.compatible === true));
});
test("query ranks the intended item first", () => {
  const r = search(idx, "arp", () => true);
  assert.equal(r[0].name, "Arpeggiator");
});
test("compat callback drives per-row flag", () => {
  const r = search(idx, "", (k) => k === "audio_effect");
  const op = r.find((x) => x.name === "Operator");
  const eq = r.find((x) => x.name === "EQ Eight");
  assert.equal(op.compatible, false);
  assert.equal(eq.compatible, true);
});

console.log("compatibility:");
test("audio effects load anywhere", () => {
  for (const t of ["midi", "audio", "group", "return", "master"]) {
    assert.equal(TrackWatcher.predict("audio_effect", t), true);
  }
});
test("instruments + midi effects need a MIDI track", () => {
  assert.equal(TrackWatcher.predict("instrument", "midi"), true);
  assert.equal(TrackWatcher.predict("instrument", "audio"), false);
  assert.equal(TrackWatcher.predict("midi_effect", "audio"), false);
  assert.equal(TrackWatcher.predict("midi_effect", "midi"), true);
});
test("nothing selected → incompatible", () => {
  assert.equal(TrackWatcher.predict("audio_effect", "none"), false);
});
test("plugins never hard-blocked (except no track)", () => {
  assert.equal(TrackWatcher.predict("plugin", "audio"), true);
  assert.equal(TrackWatcher.predict("plugin", "none"), false);
});

console.log("base64 bridge:");
test("encodeBase64 matches reference, incl. UTF-8", () => {
  for (const s of ['{"a":1}', "Écho & Déláy — ✓", JSON.stringify({ x: "Pong↵" })]) {
    assert.equal(encodeBase64(s), Buffer.from(s, "utf8").toString("base64"));
  }
});
test("decodeBase64 round-trips encodeBase64, incl. UTF-8 + chunk reassembly", () => {
  const payload = JSON.stringify([
    { name: "Écho & Déláy — ✓", uri: "query:Audio#Echo", source: "Core Library", kind: "audio_effect" },
    { name: "Operator", uri: "query:Synths#Operator", source: "Core Library", kind: "instrument" },
  ]);
  const b64 = encodeBase64(payload);
  assert.equal(decodeBase64(b64), payload);
  // Reassemble from arbitrary base64-substring chunks (what the bridge sends).
  const parts = [];
  for (let i = 0; i < b64.length; i += 7) parts.push(b64.slice(i, i + 7));
  assert.equal(decodeBase64(parts.join("")), payload);
  assert.deepEqual(JSON.parse(decodeBase64(parts.join("")))[1].name, "Operator");
});

console.log(`\n${passed} tests passed.`);
