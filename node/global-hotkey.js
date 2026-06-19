/**
 * Opt-in OS-global hotkey for M4L QuickSearch.
 *
 * Runs inside Node for Max (the `node.script` object). It has NO Live API access
 * — its only job is to listen for a global key and `Max.outlet("open")`, which the
 * patch routes to the v8 brain exactly like the live.button.
 *
 * Requires `uiohook-napi` (see package.json). In Max, start the script (the
 * "Global Hotkey" toggle) — if the native module is missing, send the node.script
 * object the message `script npm install` once, then toggle again.
 *
 * macOS: Ableton Live must be granted Accessibility AND Input Monitoring
 * permission (System Settings → Privacy & Security) or the listener stays silent.
 *
 * Default hotkey: F8. Change it from Max with:  key <name>   e.g.  `key f9`.
 */

const Max = require("max-api");

let uIOhook = null;
let UiohookKey = null;
try {
  const mod = require("uiohook-napi");
  uIOhook = mod.uIOhook;
  UiohookKey = mod.UiohookKey;
} catch (_e) {
  Max.post(
    "QuickSearch hotkey: uiohook-napi not installed. Send this object `script npm install`, then restart it.",
  );
}

// Friendly name → uiohook keycode. Extend as needed.
function keycodeFor(name) {
  if (!UiohookKey) return null;
  const n = String(name).toLowerCase();
  const map = {
    f1: UiohookKey.F1, f2: UiohookKey.F2, f3: UiohookKey.F3, f4: UiohookKey.F4,
    f5: UiohookKey.F5, f6: UiohookKey.F6, f7: UiohookKey.F7, f8: UiohookKey.F8,
    f9: UiohookKey.F9, f10: UiohookKey.F10, f11: UiohookKey.F11, f12: UiohookKey.F12,
    space: UiohookKey.Space, backtick: UiohookKey.Backquote, grave: UiohookKey.Backquote,
    tab: UiohookKey.Tab, enter: UiohookKey.Enter,
  };
  return map[n] !== undefined ? map[n] : null;
}

let triggerKey = UiohookKey ? UiohookKey.F8 : -1;
let started = false;

function start() {
  if (!uIOhook || started) return;
  uIOhook.on("keydown", (e) => {
    if (e.keycode === triggerKey) Max.outlet("open");
  });
  try {
    uIOhook.start();
    started = true;
    Max.post("QuickSearch hotkey: active (default F8). Grant Live Accessibility + Input Monitoring on macOS.");
  } catch (err) {
    Max.post("QuickSearch hotkey: failed to start — " + (err && err.message));
  }
}

function stop() {
  if (uIOhook && started) {
    try {
      uIOhook.stop();
    } catch (_e) {
      /* noop */
    }
    started = false;
    Max.post("QuickSearch hotkey: stopped.");
  }
}

// Messages from Max.
Max.addHandler("key", (name) => {
  const code = keycodeFor(name);
  if (code !== null) {
    triggerKey = code;
    Max.post("QuickSearch hotkey: bound to " + name);
  } else {
    Max.post("QuickSearch hotkey: unknown key '" + name + "'");
  }
});

// node.script @autostart starts the process; begin listening immediately.
start();

process.on("exit", stop);
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});
