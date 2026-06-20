/**
 * Inlines html/styles.css and html/ui.js into html/index.html to produce a
 * single self-contained page at dist/ui.bundle.html.
 *
 * This bundle is baked into the v8 brain at build time (injected via esbuild
 * `define` as __QS_UI_HTML__ — see tools/build.mjs) and shipped to jweb as a
 * `data:` URL by src/quicksearch.ts → loadUi(), so the device needs nothing on
 * the Max search path. A frozen .amxd is therefore fully self-contained.
 *
 * The browser dev server does NOT use this file — `npm run dev` serves html/
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
