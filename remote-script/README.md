# QuickSearch — Live Remote Script (browser bridge)

The M4L QuickSearch device can't reach Live's device **browser** through the Max
LiveAPI (it isn't exposed there). This tiny MIDI Remote Script does the two
browser-only jobs — **enumerate** devices/plug-ins and **load** the chosen one —
and talks to the device over a localhost TCP socket (port `32985`).

It uses only the Python standard library (no `pip install`), runs single-threaded
(polled on Live's main thread — Live's embedded Python beachballs on threads), and
has no Live-set side effects beyond `browser.load_item` when you press Enter.

## Install (one time)

1. Copy the **`QuickSearch/`** folder here into Live's Remote Scripts **user** folder:
   - **macOS:** `~/Music/Ableton/User Library/Remote Scripts/`
   - **Windows:** `…\Documents\Ableton\User Library\Remote Scripts\`
   (Create the `Remote Scripts` folder if it doesn't exist.)
2. In Live: **Preferences → Link, Tempo & MIDI → Control Surface**, pick **QuickSearch**
   in any free slot. Leave **Input** and **Output** as *None*.

Live loads it immediately and on every launch. To confirm, open Live's Log.txt — you'll
see `QuickSearch: listening on 127.0.0.1:32985`, then `QuickSearch: indexed N items`.

The device's `node.script bridge.js` connects automatically. If the overlay shows
"Waiting for the QuickSearch Remote Script", the Control Surface isn't selected.
