"""
QuickSearch browser bridge — Ableton Live MIDI Remote Script.

Live's device browser is reachable from the Remote Script (Python) API
(`Live.Application.get_application().browser`) but NOT from the Max for Live
LiveAPI. So the M4L QuickSearch device delegates the two browser-only operations
to this script over a localhost TCP socket:

  * enumerate instruments / audio_effects / midi_effects / plugins  → an index
  * load_item(<found by uri>)                                       → load a device

CRITICAL — no threads. Live's embedded Python beachballs if you start a thread
(see AbletonOSC). The socket is non-blocking and polled on Live's main thread via
ControlSurface.schedule_message(1, tick) (1 tick = 100ms), which also means every
browser read and load_item call runs on the main thread, where it is safe.

Install:
  1. Copy this "QuickSearch" folder into Live's Remote Scripts user folder:
       macOS: ~/Music/Ableton/User Library/Remote Scripts/
       Win:   \\Users\\<you>\\Documents\\Ableton\\User Library\\Remote Scripts\\
  2. Live → Preferences → Link, Tempo & MIDI → Control Surface → "QuickSearch".
The device's bridge (node.script) connects automatically once the script loads.
"""

from __future__ import absolute_import

import json
import socket
import struct
import traceback

import Live
from ableton.v2.control_surface import ControlSurface

# Must match PORT in node/bridge.js.
HOST = "127.0.0.1"
PORT = 32985

TICK = 1            # poll every tick (100ms)
WALK_BUDGET = 400   # browser items visited per tick while building the index
MAX_DEPTH = 12      # guard against pathological browser trees

# Browser category accessor → the device's "kind". Plugins last (heaviest subtree).
CATEGORIES = [
    ("instruments", "instrument"),
    ("audio_effects", "audio_effect"),
    ("midi_effects", "midi_effect"),
    ("plugins", "plugin"),
]


def create_instance(c_instance):
    return QuickSearch(c_instance)


class QuickSearch(ControlSurface):
    def __init__(self, c_instance):
        ControlSurface.__init__(self, c_instance)
        self._server = None
        self._clients = []        # list of [conn, bytearray]
        self._index = None        # cached list[dict], or None until built
        self._uri_map = {}        # uri -> BrowserItem, for fast loads
        self._walk = None         # in-progress walk state, or None
        self._pending = []        # conns awaiting the index while it builds

        try:
            srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            srv.setblocking(False)
            srv.bind((HOST, PORT))
            srv.listen(8)
            self._server = srv
            self.log_message("QuickSearch: listening on %s:%d" % (HOST, PORT))
            self.show_message("QuickSearch bridge ready (port %d)" % PORT)
        except Exception as exc:
            self.log_message("QuickSearch: could not bind port %d: %s" % (PORT, exc))
            self.show_message("QuickSearch: port %d unavailable" % PORT)

        # Build the index up front so it's ready when the device asks, and start
        # the poll loop.
        self._begin_walk()
        self.schedule_message(TICK, self._tick)

    # ---- main-thread poll loop ----------------------------------------------

    def _tick(self):
        try:
            self._accept()
            self._read()
            self._advance_walk()
        except Exception:
            self.log_message("QuickSearch tick error:\n" + traceback.format_exc())
        finally:
            self.schedule_message(TICK, self._tick)

    def _accept(self):
        if not self._server:
            return
        while True:
            try:
                conn, _addr = self._server.accept()
            except (BlockingIOError, socket.error):
                break
            try:
                conn.setblocking(False)
            except Exception:
                pass
            self._clients.append([conn, bytearray()])

    def _read(self):
        for entry in list(self._clients):
            conn, buf = entry
            dead = False
            while True:
                try:
                    data = conn.recv(65536)
                except BlockingIOError:
                    break
                except (ConnectionError, OSError):
                    dead = True
                    break
                if not data:
                    dead = True
                    break
                buf.extend(data)
            while len(buf) >= 4:
                length = struct.unpack(">I", bytes(buf[:4]))[0]
                if len(buf) < 4 + length:
                    break
                payload = bytes(buf[4:4 + length])
                del buf[:4 + length]
                try:
                    msg = json.loads(payload.decode("utf-8"))
                except Exception:
                    continue
                self._handle(conn, msg)
            if dead:
                self._drop(entry)

    # ---- request handling ----------------------------------------------------

    def _handle(self, conn, msg):
        op = msg.get("op") if isinstance(msg, dict) else None
        if op == "get_index":
            if self._index is not None:
                self._send(conn, {"type": "index", "items": self._index})
            else:
                if conn not in self._pending:
                    self._pending.append(conn)
                if self._walk is None:
                    self._begin_walk()
        elif op == "refresh":
            self._index = None
            self._begin_walk()
            if conn not in self._pending:
                self._pending.append(conn)
        elif op == "load":
            ok = self._load_uri(msg.get("uri", ""))
            self._send(conn, {"type": "loaded", "ok": bool(ok)})

    def _send(self, conn, obj):
        try:
            payload = json.dumps(obj).encode("utf-8")
            header = struct.pack(">I", len(payload))
            # Block just for this localhost send (sub-ms even for a big index) so a
            # full send buffer can't drop a frame on the non-blocking socket.
            conn.setblocking(True)
            conn.sendall(header + payload)
            conn.setblocking(False)
        except Exception:
            self._drop_conn(conn)

    def _drop(self, entry):
        try:
            self._clients.remove(entry)
        except ValueError:
            pass
        conn = entry[0]
        if conn in self._pending:
            self._pending.remove(conn)
        try:
            conn.close()
        except Exception:
            pass

    def _drop_conn(self, conn):
        for entry in list(self._clients):
            if entry[0] is conn:
                self._drop(entry)
                return

    # ---- browser walk --------------------------------------------------------

    def _browser(self):
        return Live.Application.get_application().browser

    def _children_of(self, item):
        try:
            return list(item.children)
        except Exception:
            return []

    def _begin_walk(self):
        browser = self._browser()
        stack = []
        for accessor, kind in CATEGORIES:
            try:
                root = getattr(browser, accessor)
            except Exception:
                root = None
            if root is not None:
                stack.append((root, kind, 0))  # root is a folder; children expand
        self._walk = {"stack": stack, "items": [], "seen": set(), "uri_map": {}}

    def _advance_walk(self):
        if self._walk is None:
            return
        walk = self._walk
        stack = walk["stack"]
        budget = WALK_BUDGET
        while stack and budget > 0:
            budget -= 1
            item, kind, depth = stack.pop()
            self._visit(item, kind, depth, walk)
        if stack:
            return
        # Walk complete — publish and flush anyone waiting.
        walk["items"].sort(key=lambda it: it["name"].lower())
        self._index = walk["items"]
        self._uri_map = walk["uri_map"]
        self._walk = None
        self.log_message("QuickSearch: indexed %d items" % len(self._index))
        for conn in list(self._pending):
            self._send(conn, {"type": "index", "items": self._index})
        self._pending = []

    def _visit(self, item, kind, depth, walk):
        if getattr(item, "is_folder", False):
            if depth < MAX_DEPTH:
                for child in self._children_of(item):
                    walk["stack"].append((child, kind, depth + 1))
            return
        if not getattr(item, "is_loadable", False):
            return
        # Device categories: keep only true devices (skip presets/samples).
        # Plugins are not always flagged is_device, so keep any loadable leaf.
        if kind != "plugin" and not getattr(item, "is_device", False):
            return
        uri = getattr(item, "uri", "") or ""
        if uri and uri in walk["seen"]:
            return
        if uri:
            walk["seen"].add(uri)
        name = getattr(item, "name", "") or ""
        if not name:
            return
        source = getattr(item, "source", "") or ""
        walk["items"].append({"name": name, "uri": uri, "source": source, "kind": kind})
        if uri:
            walk["uri_map"][uri] = item

    # ---- loading -------------------------------------------------------------

    def _load_uri(self, uri):
        if not uri:
            return False
        item = self._uri_map.get(uri)
        if item is None:
            item = self._find_by_uri(uri)
        if item is None:
            return False
        try:
            self._browser().load_item(item)
            return True
        except Exception:
            self.log_message("QuickSearch load error:\n" + traceback.format_exc())
            return False

    def _find_by_uri(self, uri):
        browser = self._browser()
        for accessor, _kind in CATEGORIES:
            try:
                root = getattr(browser, accessor)
            except Exception:
                continue
            found = self._search(root, uri, 0)
            if found is not None:
                return found
        return None

    def _search(self, item, uri, depth):
        try:
            if getattr(item, "uri", "") == uri and getattr(item, "is_loadable", False):
                return item
        except Exception:
            pass
        if depth >= MAX_DEPTH:
            return None
        for child in self._children_of(item):
            found = self._search(child, uri, depth + 1)
            if found is not None:
                return found
        return None

    # ---- teardown ------------------------------------------------------------

    def disconnect(self):
        try:
            for entry in list(self._clients):
                self._drop(entry)
            if self._server:
                self._server.close()
                self._server = None
        except Exception:
            pass
        ControlSurface.disconnect(self)
