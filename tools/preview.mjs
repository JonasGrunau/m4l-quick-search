/**
 * Build the standalone UI preview and open it in the default browser.
 * Run: `npm run preview`
 *
 * Produces dist/ui.preview.html (self-contained) and opens it. With no Max
 * bridge present, the page renders in design-preview mode with sample devices —
 * handy for iterating on the look without launching Ableton.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { bundleUi } from "./bundle-ui.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await bundleUi();
const file = join(root, "dist/ui.preview.html");
console.log("✓ built " + file);

const opener =
  process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "start"
      : "xdg-open";

try {
  spawn(opener, [file], {
    stdio: "ignore",
    detached: true,
    shell: process.platform === "win32",
  }).unref();
  console.log("→ opening in your default browser…");
} catch (_e) {
  console.log("Open it manually: " + file);
}
