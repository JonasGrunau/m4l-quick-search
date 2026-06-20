<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-20 | Updated: 2026-06-20 -->

# QuickSearch

## Purpose
The installable Ableton Live MIDI Remote Script that bridges the single gap forcing
this whole project's architecture: Live's device *browser* is reachable from the
Remote Script Python API (`Live.Application.get_application().browser`) but NOT from
the Max for Live LiveAPI. This script runs inside Live's embedded Python, enumerates
the browser (instruments / audio_effects / midi_effects / plugins) into a deduped
index and performs `load_item`, and serves both over a localhost TCP socket
(`127.0.0.1:32985`) that `node/bridge.js` connects to. It is a `ControlSurface`
subclass that polls a non-blocking socket on Live's main thread — never a worker
thread — because Live's embedded Python beachballs the moment a thread is started.

## Key Files
| File | Description |
| --- | --- |
| `__init__.py` | The entire Remote Script. Defines `create_instance(c_instance)` (Live's entry point) and the `QuickSearch(ControlSurface)` class: binds the listen socket, builds a budgeted main-thread browser walk into a cached index, frames length-prefixed JSON over TCP, and handles the `get_index` / `refresh` / `load` ops. Top-of-file docstring also carries the install instructions (copy folder to `~/Music/Ableton/User Library/Remote Scripts/`, then enable as a Control Surface). |

## For AI Agents

### Working In This Directory
- **NO THREADS, EVER.** Live's embedded Python beachballs Live if you start a thread
  (the AbletonOSC lesson). The socket is `setblocking(False)` and polled via
  `ControlSurface.schedule_message(TICK, self._tick)` (TICK = 1 ≈ 100ms). Every
  browser read and every `load_item` runs on Live's main thread, which is the only
  thread-safe place for them. Do not move browser access or loading off the tick.
- **Never block the main thread.** The browser walk is deliberately incremental:
  `_advance_walk` visits at most `WALK_BUDGET` (400) items per tick and caps recursion
  at `MAX_DEPTH` (12) to avoid stalling Live on large plugin trees (`plugins` is the
  last `CATEGORIES` entry — the heaviest subtree — but the LIFO walk stack `pop()`s it
  first, draining it depth-first). Do not replace it with a single blocking full walk.
  The one intentional blocking call is the per-frame `conn.sendall` in `_send`, which
  flips the socket to blocking only for that localhost send (sub-millisecond) so a full
  send buffer can't drop a frame, then flips it back.
- **Preserve the wire contract.** Framing is a 4-byte big-endian uint32 length header
  (`struct.pack(">I", ...)`) followed by a UTF-8 JSON payload, in BOTH directions.
  `node/bridge.js` decodes exactly this; changing the header, byte order, or the JSON
  shape silently breaks the bridge. Request ops are `get_index`, `refresh`, `load`
  (`{"op": ..., "uri": ...}`); responses are `{"type": "index", "items": [...]}` and
  `{"type": "loaded", "ok": bool}`. Index items are `{name, uri, source, kind}` where
  `kind` is one of `instrument | audio_effect | midi_effect | plugin`.
- **`PORT` must match `node/bridge.js`.** It is hardcoded to `32985` in both; keep them
  in sync. `SO_REUSEADDR` is set, and a bind failure is logged/`show_message`'d but does
  not crash the script.
- **The only Live side effect is `load_item` on a `load` request.** Loading targets
  whatever is current in Live (the browser's `load_item` drops onto the selected track);
  this script does not itself touch `live_set`/tracks — the v8 brain reads the
  selected-track device-count delta via the LiveAPI to confirm success. Don't add
  unrelated Live mutations here.
- **Dedup + filtering rules live in `_visit`.** Items are deduped by `uri`; non-plugin
  kinds are kept only when `is_device` is true (skips presets/samples), while plugins
  keep any loadable leaf because they are not reliably flagged `is_device`. Empty-name
  items are dropped. Preserve these guards or the index fills with junk.
- **Two lookup paths for loads.** `_load_uri` first uses the cached `_uri_map`, and falls
  back to a fresh depth-limited `_find_by_uri` walk if the uri isn't cached (e.g. after
  Live rebuilt the browser). Keep both.

### Testing / Verifying Changes
- This file is NOT exercised by `npm run build` / `npm test` / `npm run dev` — those
  cover the v8/jweb/Node side. It only runs inside Ableton Live as a loaded Control
  Surface, so verification is load-time / runtime in Live, not browser-previewable.
- To test: copy this `QuickSearch` folder into Live's user Remote Scripts folder
  (`~/Music/Ableton/User Library/Remote Scripts/` on macOS), then enable it under
  Live → Preferences → Link, Tempo & MIDI → Control Surface → "QuickSearch".
- Watch Live's log / status bar for the script's own messages: `log_message`
  ("QuickSearch: listening on 127.0.0.1:32985", "QuickSearch: indexed N items",
  and `tick`/`load` error tracebacks) and `show_message` ("QuickSearch bridge ready",
  or "port N unavailable"). A successful end-to-end check is the device loading onto
  the selected track after Enter, plus a non-zero indexed count in the log.
- Errors inside `_tick` and `_load_uri` are caught and logged via
  `traceback.format_exc()` rather than thrown — check the log, not a crash.

### Common Patterns
- Stdlib only: `json`, `socket`, `struct`, `traceback`, plus Live's `Live` and
  `ableton.v2.control_surface.ControlSurface`. No pip / no third-party imports.
- Defensive `getattr(item, attr, default)` / `try/except` around every browser
  attribute and child access — the browser tree is heterogeneous and Live versions
  differ, so attribute access can raise.
- Per-client state is `[conn, bytearray]` in `self._clients`; partial frames accumulate
  in the bytearray until a full length-prefixed frame is available. Dead/closed sockets
  are reaped via `_drop` / `_drop_conn`.
- Index lifecycle: `_begin_walk` seeds the stack from `CATEGORIES`, `_advance_walk`
  drains it across ticks, then publishes `self._index` + `self._uri_map` and flushes
  `self._pending` connections that asked for the index before it was ready. `refresh`
  clears and rebuilds. `disconnect` drops all clients and closes the server socket.

## Dependencies

### Internal
- **`node/bridge.js`** — the only client of this socket. It opens `127.0.0.1:32985`,
  speaks the same length-prefixed JSON framing, and relays between this script and the
  v8 brain. The `PORT` constant and frame format are a shared contract with it.
- **v8 brain (`src/*.ts` → `dist/quicksearch.js`)** — the ultimate consumer of the
  `index` it serves and the issuer of `get_index` / `refresh` / `load`; it predicts
  compatibility and confirms loads via the LiveAPI device-count delta, outside this file.

### External
- **Ableton Live Remote Script API** — `Live.Application.get_application().browser`
  (the browser categories + `BrowserItem` attrs `is_folder`, `is_loadable`, `is_device`,
  `uri`, `name`, `source`, `children`) and `browser.load_item`.
- **`ableton.v2.control_surface.ControlSurface`** — base class providing
  `schedule_message`, `log_message`, `show_message`, and `disconnect` (Live's
  main-thread scheduler and logging hooks). Requires Live 12.2+.
- **Python standard library** — `socket` (non-blocking TCP), `struct` (frame headers),
  `json`, `traceback`. Runs under Live's embedded CPython; no external packages.

<!-- MANUAL: Notes added below this line are preserved on regeneration -->
