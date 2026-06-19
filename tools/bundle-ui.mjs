/**
 * Inlines html/styles.css and html/ui.js into html/index.html to produce a
 * single self-contained page at dist/ui.bundle.html.
 *
 * This is the seed for the FROZEN-device injection path: a frozen .amxd can't
 * read a bundled .html, so this self-contained markup is what gets injected via
 * executejavascript (see README → Freezing).
 *
 * Neither the DEV device nor the browser dev server use this file — the device
 * loads html/index.html off the search path, and `npm run dev` serves html/
 * directly with live reload.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function bundleUi() {
  const html = await readFile(join(root, "html/index.html"), "utf8");
  const css = await readFile(join(root, "html/styles.css"), "utf8");
  const js = await readFile(join(root, "html/ui.js"), "utf8");

  const bundle = html
    .replace(
      /<link rel="stylesheet" href="styles\.css"\s*\/>/,
      "<style>\n" + css + "\n</style>",
    )
    .replace(/<script src="ui\.js"><\/script>/, "<script>\n" + js + "\n</script>");

  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "dist/ui.bundle.html"), bundle);
  return bundle;
}

// Allow running directly: `node tools/bundle-ui.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  bundleUi().then(() => console.log("✓ dist/ui.bundle.html"));
}
