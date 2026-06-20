<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-20 | Updated: 2026-06-20 -->

# remote-script

## Purpose
This directory holds the Python MIDI Remote Script that users install into Ableton Live. It is the only part of QuickSearch that can reach Live's device **browser**, which the Max LiveAPI does not expose. The script does the two browser-only jobs — enumerate devices/plug-ins and load the chosen one — and serves them to the rest of the device over a localhost TCP socket (port `32985`). This folder is shipped/installed *verbatim*: users copy the `QuickSearch/` package into Live's Remote Scripts user folder and select it as a Control Surface. The runnable code lives in `QuickSearch/` (see its AGENTS.md); this top-level folder is just the install bundle plus its README.

## Key Files
| File | Description |
| --- | --- |
| `README.md` | Install instructions and the architectural "why": the device can't reach Live's browser via the Max LiveAPI, so this stdlib-only, single-threaded Remote Script enumerates + loads over TCP `32985`. Covers the one-time copy-into-`Remote Scripts`-and-pick-as-Control-Surface steps (macOS/Windows paths), the Log.txt lines that confirm it's listening/indexed, and the "Waiting for the QuickSearch Remote Script" overlay state when the Control Surface isn't selected. |

## Subdirectories
| Directory | Purpose |
| --- | --- |
| `QuickSearch/` | The installable Remote Script package (`__init__.py`) — the browser walk + `load_item` served over TCP. (see `QuickSearch/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- **Install bundle, not a build target.** `QuickSearch/` is what the user manually copies into `~/Music/Ableton/User Library/Remote Scripts/` (macOS) or `…\Documents\Ableton\User Library\Remote Scripts\` (Windows). Nothing here is produced by `npm run build`; do not move code out of `QuickSearch/` or rename the package, or Live won't discover the Control Surface.
- **Standard library only.** The Remote Script runs inside Live's embedded Python and there is no `pip install` step. Never add third-party imports under `QuickSearch/`.
- **Single-threaded constraint.** Live's embedded Python beachballs when work is done on threads, so the script must stay polled on Live's main thread. Don't introduce threading to "fix" socket blocking.
- **Keep the README and the real behavior in sync.** The README documents the port (`32985`), the Log.txt confirmation strings, and the no-side-effects-beyond-`load_item` guarantee. If you change those in `QuickSearch/__init__.py`, update `README.md` to match.

### Testing / Verifying Changes
- There is no npm script or browser preview for this folder — it is **load-time-only inside Live**. To verify, copy `QuickSearch/` into the Remote Scripts user folder, pick **QuickSearch** as a Control Surface (Input/Output = None), and watch Live's **Log.txt** for `QuickSearch: listening on 127.0.0.1:32985` followed by `QuickSearch: indexed N items`.
- End-to-end, confirm the device's `node.script bridge.js` connects and the overlay stops showing "Waiting for the QuickSearch Remote Script" — that message means the Control Surface isn't selected.

### Common Patterns
- One self-contained package directory (`QuickSearch/`) plus a README that doubles as the install guide. New documentation about installation belongs in `README.md`; new runtime logic belongs in `QuickSearch/`.

## Dependencies

### Internal
- **Node bridge (`node/bridge.js`)** connects to this script's TCP socket on `127.0.0.1:32985` and relays its JSON index + `load_item` calls to the v8 brain. v8 and Max can't open sockets, so this Remote Script is the upstream end of that relay.

### External
- **Ableton Live 12.2+ Remote Script API** — `get_application().browser` (instruments / audio_effects / midi_effects / plugins) and `browser.load_item`; this is the API surface the Max LiveAPI lacks.
- **Python standard library only** (`socket`/`net` over localhost, no external packages) — runs in Live's embedded, single-threaded Python.

<!-- MANUAL: Notes added below this line are preserved on regeneration -->
