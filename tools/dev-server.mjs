/**
 * Live‑reload dev server for the QuickSearch UI.
 *
 * Serves the files in html/ and reloads the browser whenever any of them change,
 * so you can edit index.html / styles.css / ui.js and see it instantly. With no
 * Max bridge present, ui.js runs in design‑preview mode (sample devices), and the
 * server injects a dark "over‑Live" backdrop so the card looks right.
 *
 *   npm run dev            # → http://localhost:5173
 *   PORT=4000 npm run dev  # pick a port
 *
 * NOTE: this previews the UI/design only. The v8 brain and real device loading
 * need Ableton + Max — use the device itself (`npm run build`, see README) for that.
 *
 * Zero dependencies (Node http + fs.watch + Server‑Sent Events).
 */

import http from "node:http";
import { readFile } from "node:fs/promises";
import { watch } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const htmlDir = join(root, "html");
const PORT = Number(process.env.PORT || 5173);
const open = !process.argv.includes("--no-open");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json",
  ".b64": "text/plain; charset=utf-8",
};

// Dark backdrop (so the transparent card reads well in a plain browser tab).
const BACKDROP =
  '<style id="qs-dev">html,body{background:#2b2b2b !important}#scrim{background:rgba(0,0,0,0.22)}</style>';

// Live‑reload client: an EventSource that reloads the page on a "reload" event.
const LIVE_RELOAD = `
<script>
(function () {
  var es = new EventSource("/__livereload");
  es.addEventListener("reload", function () { location.reload(); });
})();
</script>`;

const clients = new Set();

const server = http.createServer(async (req, res) => {
  const path = (req.url || "/").split("?")[0];

  // SSE channel the browser listens on.
  if (path === "/__livereload") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("retry: 500\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  const file = path === "/" ? "/index.html" : path;
  try {
    let body = await readFile(join(htmlDir, file));
    const ext = extname(file);
    if (ext === ".html") {
      const s = body
        .toString("utf8")
        .replace('<div id="scrim">', BACKDROP + "\n<div id=\"scrim\">") + LIVE_RELOAD;
      body = Buffer.from(s, "utf8");
    }
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found: " + file);
  }
});

// Debounced reload broadcast on any change in html/.
let timer = null;
function reloadSoon(name) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    for (const c of clients) {
      try {
        c.write("event: reload\ndata: 1\n\n");
      } catch {
        /* client gone */
      }
    }
    console.log("  ↻ " + (name || "changed") + " → reloaded " + clients.size + " tab(s)");
  }, 60);
}
watch(htmlDir, (_evt, name) => reloadSoon(name));

server.listen(PORT, () => {
  const url = "http://localhost:" + PORT;
  console.log("\n  🔍 M4L QuickSearch — UI dev preview (live reload)");
  console.log("  ▶ " + url);
  console.log("  edit html/index.html · styles.css · ui.js → the browser reloads automatically");
  console.log("  (no Max bridge → design‑preview mode with sample devices)\n");
  if (open) {
    const cmd =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    try {
      spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
    } catch {
      /* user can open manually */
    }
  }
});
