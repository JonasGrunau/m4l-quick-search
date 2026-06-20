/**
 * Browser bridge for M4L QuickSearch — the v8 brain's link to Live's browser.
 *
 * Live's browser is NOT reachable from the Max LiveAPI, so a Python Remote Script
 * (see remote-script/QuickSearch/) owns enumeration + load_item and exposes them
 * over a localhost TCP socket. v8/Max can't open raw sockets — but Node for Max can
 * — so this script is a thin relay:
 *
 *   v8  ──Max msgs──▶  bridge.js (net.Socket client)  ──length-prefixed JSON──▶  Python
 *
 * It runs at @autostart 1 and keeps no Live state of its own; it only forwards.
 * Uses Node stdlib `net` only (no npm/native module), unlike the opt-in hotkey.
 *
 * Protocol with v8 (Max messages):
 *   in : ping | get_index | refresh | load <base64-uri>
 *   out: bridge connected|disconnected
 *        index_begin <count> · index_chunk <base64> · index_end
 *        loaded <0|1>
 *
 * Protocol with Python (4-byte big-endian length prefix + UTF-8 JSON):
 *   out: {op:"get_index"} | {op:"refresh"} | {op:"load", uri:"..."}
 *   in : {type:"index", items:[{name,uri,source,kind},...]} | {type:"loaded", ok:bool}
 */

const net = require("net");
const Max = require("max-api");

// Must match PORT in remote-script/QuickSearch/__init__.py.
const HOST = "127.0.0.1";
const PORT = 32985;
const RECONNECT_MS = 1500;
// Keep each index_chunk well under any Max message-length limit; base64 has no
// spaces so each chunk crosses the bridge as a single atom.
const CHUNK = 3000;

let socket = null;
let connected = false;
let reconnectTimer = null;
let rxBuffer = Buffer.alloc(0);

function setConnected(value) {
  if (connected === value) return;
  connected = value;
  Max.outlet("bridge", value ? "connected" : "disconnected");
}

// ---- Python → v8 ------------------------------------------------------------

function sendIndexToV8(items) {
  const b64 = Buffer.from(JSON.stringify(items || []), "utf8").toString("base64");
  Max.outlet("index_begin", Array.isArray(items) ? items.length : 0);
  for (let i = 0; i < b64.length; i += CHUNK) {
    Max.outlet("index_chunk", b64.slice(i, i + CHUNK));
  }
  Max.outlet("index_end");
}

function handlePythonMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "index") {
    sendIndexToV8(msg.items);
  } else if (msg.type === "loaded") {
    Max.outlet("loaded", msg.ok ? 1 : 0);
  }
}

function drain() {
  while (rxBuffer.length >= 4) {
    const len = rxBuffer.readUInt32BE(0);
    if (rxBuffer.length < 4 + len) break;
    const payload = rxBuffer.slice(4, 4 + len);
    rxBuffer = rxBuffer.slice(4 + len);
    try {
      handlePythonMessage(JSON.parse(payload.toString("utf8")));
    } catch (_e) {
      /* skip a malformed frame; framing stays intact via the length prefix */
    }
  }
}

// ---- v8 → Python ------------------------------------------------------------

function sendToPython(obj) {
  if (!connected || !socket) return false;
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);
  try {
    socket.write(Buffer.concat([header, payload]));
    return true;
  } catch (_e) {
    return false;
  }
}

// ---- connection lifecycle ---------------------------------------------------

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(function () {
    reconnectTimer = null;
    connect();
  }, RECONNECT_MS);
}

function connect() {
  if (socket) return;
  const s = new net.Socket();
  socket = s;
  s.setNoDelay(true);
  s.on("connect", function () {
    rxBuffer = Buffer.alloc(0);
    setConnected(true);
  });
  s.on("data", function (chunk) {
    rxBuffer = Buffer.concat([rxBuffer, chunk]);
    drain();
  });
  // Swallow errors (ECONNREFUSED before the script is up, resets, etc.) — the
  // "close" handler that follows drives the reconnect.
  s.on("error", function () {});
  s.on("close", function () {
    socket = null;
    setConnected(false);
    scheduleReconnect();
  });
  s.connect(PORT, HOST);
}

// ---- Max message handlers ---------------------------------------------------

Max.addHandler("ping", function () {
  // v8 asks for the current link state on init (covers the device-loaded-after-
  // script race). Re-announce so it can request the index or show guidance.
  Max.outlet("bridge", connected ? "connected" : "disconnected");
});

Max.addHandler("get_index", function () {
  sendToPython({ op: "get_index" });
});

Max.addHandler("refresh", function () {
  sendToPython({ op: "refresh" });
});

Max.addHandler("load", function (b64) {
  let uri = "";
  try {
    uri = Buffer.from(String(b64), "base64").toString("utf8");
  } catch (_e) {
    uri = "";
  }
  if (uri) sendToPython({ op: "load", uri: uri });
});

// Announce the initial (disconnected) state, then start trying to reach Python.
Max.outlet("bridge", "disconnected");
connect();

process.on("exit", function () {
  if (socket) {
    try {
      socket.destroy();
    } catch (_e) {
      /* noop */
    }
  }
});
process.on("SIGTERM", function () {
  process.exit(0);
});
