/**
 * Build pipeline:
 *   1. Bundle src/quicksearch.ts (+ its imports) into dist/quicksearch.js
 *      as a single strict-mode IIFE the Max `v8` object can load.
 *   2. Generate the patcher JSON and wrap it into "QuickSearch Dev.amxd".
 *   3. Self-check by parsing the .amxd back (mirrors Ableton's amxd_textconv).
 *
 * Run: `npm run build`   |   watch: `npm run watch`
 */

import * as esbuild from "esbuild";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildPatcher } from "./patcher.mjs";
import { buildAmxd, parseAmxd } from "./amxd.mjs";
import { bundleUi } from "./bundle-ui.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");

const esbuildOptions = {
  entryPoints: [join(root, "src/quicksearch.ts")],
  bundle: true,
  format: "iife",
  target: "es2020",
  platform: "neutral",
  outfile: join(root, "dist/quicksearch.js"),
  legalComments: "none",
  banner: {
    js: "// M4L QuickSearch — generated bundle. Edit src/*.ts and rebuild (npm run build).",
  },
  logLevel: "info",
};

async function writeDevice() {
  const patcher = buildPatcher();
  const json = JSON.stringify(patcher, null, "\t");

  // human-readable patcher (useful for diffing / opening directly in Max)
  await writeFile(join(root, "QuickSearch.maxpat"), json);

  // the loadable device
  const amxd = buildAmxd(json, "audio effect");
  await writeFile(join(root, "QuickSearch Dev.amxd"), amxd);

  // self-check: does it round-trip through the same logic Ableton uses?
  const parsed = parseAmxd(amxd);
  if (parsed.deviceType !== "aaaa") throw new Error("device type check failed");
  if (!parsed.patcher.patcher) throw new Error("patcher round-trip failed");
  const boxCount = parsed.patcher.patcher.boxes.length;
  console.log(
    `✓ QuickSearch Dev.amxd  (type=${parsed.deviceType}, meta=${parsed.version}, ${boxCount} top-level boxes, ${amxd.length} bytes)`,
  );
}

await mkdir(join(root, "dist"), { recursive: true });

if (watch) {
  const ctx = await esbuild.context(esbuildOptions);
  await ctx.watch();
  await writeDevice();
  await bundleUi();
  console.log("watching src/ … (Ctrl-C to stop)");
} else {
  await esbuild.build(esbuildOptions);
  await writeDevice();
  await bundleUi();
  console.log("✓ dist/ui.bundle.html  ✓ dist/ui.preview.html");
}
