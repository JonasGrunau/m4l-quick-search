/**
 * Render the Spotlight overlay to docs/overlay.png (the README hero image).
 *
 * Uses the same self-contained UI bundle as everything else, in design-preview
 * mode (sample devices, no Max bridge), on a dark "over-Live" backdrop.
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

// Transparent page so the tile's rounded corners come out transparent (the README
// can't round an <img> with CSS, so we bake the rounding into the PNG). The #scrim
// becomes a solid dark "tile" rounded at 12px — the same radius as the card window.
const SHOT_STYLE = `<style id="qs-shot">
  html,body{background:transparent !important}
  #scrim{background:#2b2b2b; border-radius:12px}
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
  viewport: { width: 820, height: 560 },
  deviceScaleFactor: 2,
});
await page.goto(pathToFileURL(shotPath).href);
// Design-preview mode populates ~1s after load (it first waits for a Max bridge).
await page.waitForSelector("#results li.row", { timeout: 10000 });
await page.waitForTimeout(450); // let the open animation settle

await mkdir(join(root, "docs"), { recursive: true });
const out = join(root, "docs/overlay.png");
// Screenshot the rounded tile element with a transparent background so the
// corners outside the 12px radius are transparent in the PNG.
await page.locator("#scrim").screenshot({ path: out, omitBackground: true });
await browser.close();
console.log("✓ " + out);
