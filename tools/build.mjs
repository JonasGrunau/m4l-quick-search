/**
 * Build pipeline:
 *   1. Bundle src/quicksearch.ts (+ its imports) into dist/quicksearch.js
 *      as a single strict-mode IIFE the Max `v8` object can load.
 *   2. Generate the patcher JSON and wrap it into "dist/QuickSearch Dev.amxd".
 *   3. Self-check by parsing the .amxd back (mirrors Ableton's amxd_textconv).
 *
 * Run: `npm run build`   |   watch: `npm run watch`
 */

import * as esbuild from "esbuild";
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildPatcher } from "./patcher.mjs";
import { buildAmxd, parseAmxd } from "./amxd.mjs";
import { bundleUi } from "./bundle-ui.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");

// Inline the whole overlay (html/index.html + styles.css + ui.js) and bake it
// into the v8 brain via esbuild `define`, so quicksearch.ts can hand it to jweb
// as a self-contained data: URL (no Max search path needed). bundleUi() also
// writes dist/ui.bundle.html as a build artifact. NOTE: in --watch this define
// is captured once, so editing html/ won't re-bake until watch restarts — UI
// iteration is the `npm run dev` browser loop; the v8 watch is for src/ logic.
const uiHtml = await bundleUi();

const esbuildOptions = {
  entryPoints: [join(root, "src/quicksearch.ts")],
  bundle: true,
  format: "iife",
  target: "es2020",
  platform: "neutral",
  outfile: join(root, "dist/quicksearch.js"),
  legalComments: "none",
  define: { __QS_UI_HTML__: JSON.stringify(uiHtml) },
  banner: {
    js: "// M4L QuickSearch — generated bundle. Edit src/*.ts and rebuild (npm run build).",
  },
  logLevel: "info",
};

async function writeDevice() {
  const patcher = buildPatcher();
  const json = JSON.stringify(patcher, null, "\t");

  // everything lands in dist/ (created below before any writeDevice() call)
  // human-readable patcher (useful for diffing / opening directly in Max)
  await writeFile(join(root, "dist/QuickSearch.maxpat"), json);

  // the loadable device
  const amxd = buildAmxd(json, "audio effect");
  await writeFile(join(root, "dist/QuickSearch Dev.amxd"), amxd);

  // self-check: does it round-trip through the same logic Ableton uses?
  const parsed = parseAmxd(amxd);
  if (parsed.deviceType !== "aaaa") throw new Error("device type check failed");
  if (!parsed.patcher.patcher) throw new Error("patcher round-trip failed");
  // A `project` dict without `searchpath`/`layout` SIGSEGVs Live on load
  // (Max's project_deserialize_searchpath derefs them) — fail the build, not Live.
  const proj = parsed.patcher.patcher.project;
  if (proj && (!proj.searchpath || !proj.layout)) {
    throw new Error("project dict missing searchpath/layout — would crash Live on load");
  }
  const boxCount = parsed.patcher.patcher.boxes.length;
  console.log(
    `✓ dist/QuickSearch Dev.amxd  (type=${parsed.deviceType}, meta=${parsed.version}, ${boxCount} top-level boxes, ${amxd.length} bytes)`,
  );
}

async function checkUiEmbedded() {
  // Regression guard for the DNS_PROBE_FINISHED_NXDOMAIN bug: the overlay must be
  // inlined into the bundle (so jweb gets a self-contained data: URL), and the old
  // fragile search-path `read "index.html"` must be gone (jweb's Chromium treats a
  // bare filename as a hostname and DNS-fails).
  const js = await readFile(join(root, "dist/quicksearch.js"), "utf8");
  if (!js.includes("scrim")) {
    throw new Error("quicksearch.js does not embed the overlay UI — bundleUi/define wiring broke");
  }
  if (/"read",\s*"index\.html"/.test(js)) {
    throw new Error('quicksearch.js still does `read "index.html"` — would DNS-fail in jweb');
  }
  console.log("✓ overlay UI embedded in dist/quicksearch.js");
}

async function stageRemoteScript() {
  // Bundle the Python Remote Script with the build output for distribution. Users
  // install it (from here or remote-script/) into Live's Remote Scripts folder —
  // it's what reaches the browser, which the LiveAPI cannot. See README.
  await cp(join(root, "remote-script"), join(root, "dist/remote-script"), { recursive: true });
  console.log("✓ dist/remote-script/QuickSearch (install into Live's Remote Scripts)");
}

await mkdir(join(root, "dist"), { recursive: true });

if (watch) {
  const ctx = await esbuild.context(esbuildOptions);
  await ctx.watch();
  await writeDevice();
  await stageRemoteScript();
  console.log("watching src/ … (Ctrl-C to stop)");
} else {
  await esbuild.build(esbuildOptions);
  await writeDevice();
  await checkUiEmbedded();
  await stageRemoteScript();
  console.log("✓ dist/ui.bundle.html");
}
