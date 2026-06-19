/**
 * Render the Spotlight overlay to docs/overlay.png (the README hero image).
 *
 * Uses the same self-contained UI bundle as everything else, in design-preview
 * mode (sample devices, no Max bridge). The card window is captured on a
 * transparent background so its real 12px rounded corners + drop shadow are
 * baked into the PNG (the README can't round an <img> via CSS).
 *
 * Playwright is optional / ad-hoc (not a project dependency). To (re)generate:
 *   npm i --no-save playwright && npx playwright install chromium
 *   node tools/screenshot.mjs
 */

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { bundleUi } from "./bundle-ui.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Fully transparent page + scrim: we capture only the #card window, which already
// has border-radius:12px and a drop shadow. With omitBackground, everything outside
// the card's rounded edge is transparent, so the PNG has real, visible rounded
// corners on any GitHub background (no big dark tile burying the curve).
const SHOT_STYLE = `<style id="qs-shot">
  html,body{background:transparent !important}
  #scrim{background:transparent !important; align-items:center !important}
  #results-wrap{max-height:none !important}   /* show every row, no scrollbar */
</style>`;

const bundle = await bundleUi();
const shotHtml = bundle.replace('<div id="scrim">', SHOT_STYLE + '\n<div id="scrim">');
await mkdir(join(root, "dist"), { recursive: true });
const shotPath = join(root, "dist/ui.shot.html");
await writeFile(shotPath, shotHtml);

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "Playwright not installed. Run once:\n" +
      "  npm i --no-save playwright && npx playwright install chromium",
  );
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({
  // room around the centered card for its drop shadow
  viewport: { width: 760, height: 620 },
  deviceScaleFactor: 2,
});
await page.goto(pathToFileURL(shotPath).href);
// Design-preview mode populates ~1s after load (it first waits for a Max bridge).
await page.waitForSelector("#results li.row", { timeout: 10000 });
await page.waitForTimeout(450); // let the open animation settle

await mkdir(join(root, "docs"), { recursive: true });
const out = join(root, "docs/overlay.png");
// Clip a tight region around the card (+ margin for its drop shadow) and capture
// it on a transparent canvas. An element screenshot would clip the shadow, so we
// compute the card box and expand it. The card's 12px border-radius gives the PNG
// its rounded corners; everything outside stays transparent.
const bb = await page.locator("#card").boundingBox();
const M = 52; // margin for the drop shadow
await page.screenshot({
  path: out,
  omitBackground: true,
  clip: {
    x: Math.max(0, bb.x - M),
    y: Math.max(0, bb.y - M),
    width: bb.width + 2 * M,
    height: bb.height + 2 * M,
  },
});
await browser.close();
console.log("✓ " + out);
