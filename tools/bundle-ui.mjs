/**
 * Inlines html/styles.css and html/ui.js into html/index.html to produce
 * single self-contained pages under dist/:
 *
 *   dist/ui.bundle.html   transparent body — the seed for the FROZEN-device
 *                         injection path (frozen .amxd can't read a bundled
 *                         .html; this self-contained markup is what gets injected).
 *
 *   dist/ui.preview.html  same page + a dark "over-Live" backdrop. Open it in any
 *                         browser to preview/iterate the design: with no Max bridge
 *                         present, ui.js falls back to design-preview mode and
 *                         renders sample devices (this is the file that was
 *                         published as the Spotlight-overlay artifact).
 *
 * The DEV device uses NEITHER — it loads html/index.html directly off the search path.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// A dark Ableton-desktop backdrop so the (otherwise transparent) card looks right
// when opened standalone in a browser.
const PREVIEW_BACKDROP =
  '<style id="qs-preview">html,body{background:#2b2b2b !important}#scrim{background:rgba(0,0,0,0.22)}</style>\n';

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

  const preview = bundle.replace(
    '<div id="scrim">',
    PREVIEW_BACKDROP + '<div id="scrim">',
  );

  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "dist/ui.bundle.html"), bundle);
  await writeFile(join(root, "dist/ui.preview.html"), preview);
  return { bundle, preview };
}

// Allow running directly: `node tools/bundle-ui.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  bundleUi().then(() => console.log("✓ dist/ui.bundle.html  ✓ dist/ui.preview.html"));
}
