<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-20 | Updated: 2026-06-20 -->

# node

## Purpose
Node-for-Max scripts loaded by `node.script` objects inside the QuickSearch device. These cover the two jobs the v8 brain and Max cannot do themselves: opening raw TCP sockets, and listening for OS-global keystrokes. `bridge.js` is the always-on relay that links the v8 brain to the Python Remote Script (which owns Live's browser, unreachable from the Max LiveAPI) over localhost TCP. `global-hotkey.js` is an opt-in system-wide hotkey that nudges the same open path the device's button uses. Both run as separate Node processes managed by Max; neither holds any Live state.

## Key Files
| File | Description |
| --- | --- |
| `bridge.js` | Always-on relay (`@autostart 1`) between the v8 brain and the Python Remote Script. Node stdlib `net` only — no npm/native deps. Speaks Max messages to v8 (`ping`/`get_index`/`refresh`/`load <base64-uri>` in; `bridge connected\|disconnected`, `index_begin`/`index_chunk`/`index_end`, `loaded <0\|1>` out) and length-prefixed (4-byte big-endian) UTF-8 JSON to Python on `127.0.0.1:32985`. Auto-reconnects every 1500 ms, swallows socket errors, and chunks the base64 index at 3000 chars per atom. |
| `global-hotkey.js` | OPT-IN OS-global hotkey via the native `uiohook-napi` module. NO Live API access — on the configured keydown it just `Max.outlet("show")`, which the patch routes to v8 exactly like the `live.button` (selector is `show`, not the reserved js/v8 word `open`). Accepts a `key <name>` Max message to rebind (default `F8`; map covers F1–F12, space, backtick/grave, tab, enter). If the native module is missing it posts guidance and stays silent. |
| `package.json` | Declares the lone (optional) dependency `uiohook-napi ^1.5.4` used by `global-hotkey.js`. `private`, `main: global-hotkey.js`. `bridge.js` needs nothing from here. |

## For AI Agents

### Working In This Directory
- These run under Node for Max, NOT modern Node tooling. Stick to CommonJS (`require`), `var`/`function` style, and `max-api` (`Max.addHandler`, `Max.outlet`, `Max.post`). No ESM, no TypeScript here.
- **These files must sit next to the `.amxd`.** Max's `node.script` loads them by bare name off the Max search path, so `tools/build.mjs` (`stageNodeScripts()`) copies `bridge.js`/`global-hotkey.js`/`package.json` into `dist/` on every build — that staged copy is what the device and the release zip actually use. If they're not reachable next to the device, Max prints "node.script: no connection to node process manager" and the search index stays empty. Edit the originals here; never hand-edit the `dist/` copies.
- `bridge.js` must stay pure Node stdlib — do NOT add npm/native deps to it. Its zero-dependency nature is why it can be the always-on relay without an install step.
- `PORT = 32985` and `HOST = "127.0.0.1"` in `bridge.js` MUST match `PORT` in `remote-script/QuickSearch/__init__.py`. Change them together or the link silently never connects.
- The Python wire framing is a 4-byte big-endian length prefix + UTF-8 JSON, in BOTH directions. Don't switch to newline-delimited or send a bare write without the header — `drain()` will stall waiting for bytes that never come.
- `index_chunk` payloads are base64 (no spaces), so each chunk crosses as a single Max atom. Keep `CHUNK = 3000` well under Max's message-length limit; v8 reassembles between `index_begin`/`index_end`.
- `global-hotkey.js`'s `uiohook-napi` is native and unsigned. It only works after `script npm install` is sent to its `node.script` object once, AND macOS grants Ableton Live both Accessibility and Input Monitoring (System Settings → Privacy & Security). Without those, the listener loads but never fires — there is no error.
- The hotkey has NO Live awareness by design; do not try to read tracks/devices here. Routing and all logic live in v8.

### Testing / Verifying Changes
- No unit harness covers this directory (`npm test` → `tools/test.mjs` exercises the v8/build path, not these). Verify by loading the device in Live and watching the Max console.
- For `bridge.js`: confirm a `bridge connected` outlet once the Python Remote Script is running, and `bridge disconnected` plus ~1.5 s reconnect attempts when it is not. Trigger `get_index`/`refresh` from v8 and watch for `index_begin`/`index_chunk`/`index_end`; trigger `load` and watch for `loaded 1`.
- For `global-hotkey.js`: toggle the "Global Hotkey" control, look for the `QuickSearch hotkey: active (default F8)` post, then press the key and confirm the overlay opens. If you see the `uiohook-napi not installed` post, run `script npm install` on the object and re-toggle.
- Not browser-previewable — these are runtime processes inside Max, not part of the jweb UI or the esbuild bundle.

### Common Patterns
- All inbound Max messages handled via `Max.addHandler(name, fn)`; all outbound via `Max.outlet(...)`. User-facing diagnostics go through `Max.post(...)`.
- Defensive error handling: socket and module-load errors are swallowed (`catch (_e) {}`) rather than thrown — `bridge.js` leans on the `close` handler to drive reconnects so a refused connection before Python is up is normal, not fatal.
- Clean shutdown: both scripts hook `process.on("exit", ...)` and `process.on("SIGTERM", ...)` to tear down the socket / stop the hook so Max can restart them cleanly.
- base64 is the escaping-free transport convention shared with the rest of the project: URIs arrive at `load` as base64 and the index is shipped to v8 as base64-JSON.

## Dependencies

### Internal
- `remote-script/QuickSearch/__init__.py` — the TCP server `bridge.js` connects to; the shared port and JSON framing are the contract.
- `src/quicksearch.ts` (v8 brain, bundled to `dist/quicksearch.js`) — sends the `ping`/`get_index`/`refresh`/`load` messages and consumes the `bridge`/`index_*`/`loaded` outlets; also the destination of the hotkey's `show` outlet, wired through the patcher.
- The patcher JSON (generated by `tools/build.mjs`) wires the `node.script` objects' inlets/outlets to v8 and the open path.

### External
- **Node for Max** runtime (`max-api`) — the host for both scripts; provides `addHandler`/`outlet`/`post`.
- **Node stdlib `net`** — `bridge.js`'s only dependency (TCP client).
- **`uiohook-napi` ^1.5.4** — native global-keyboard hook for `global-hotkey.js` only; optional, unsigned, installed on demand via `script npm install`.

<!-- MANUAL: Notes added below this line are preserved on regeneration -->
