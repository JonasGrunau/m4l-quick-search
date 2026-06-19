/**
 * Inlines html/styles.css and html/ui.js into html/index.html to produce a
 * single self-contained page at dist/ui.bundle.html.
 *
 * Two uses:
 *   1. The seed for the FROZEN-device injection path (frozen .amxd can't read a
 *      bundled .html; the self-contained markup is what gets injected).
 *   2. A standalone file you can open in any browser to preview/iterate the
 *      design (it falls back to mock data when no Max bridge is present).
 *
 * The DEV device does NOT use this — it loads html/index.html directly.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function bundleUi() {
  const html = await readFile(join(root, "html/index.html"), "utf8");
  const css = await readFile(join(root, "html/styles.css"), "utf8");
  const js = await readFile(join(root, "html/ui.js"), "utf8");

  const out = html
    .replace(
      /<link rel="stylesheet" href="styles\.css"\s*\/>/,
      "<style>\n" + css + "\n</style>",
    )
    .replace(/<script src="ui\.js"><\/script>/, "<script>\n" + js + "\n</script>");

  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "dist/ui.bundle.html"), out);
  return out;
}

// Allow running directly: `node tools/bundle-ui.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  bundleUi().then(() => console.log("✓ dist/ui.bundle.html"));
}
