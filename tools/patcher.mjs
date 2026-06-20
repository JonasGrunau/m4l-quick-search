/**
 * Generates the QuickSearch .maxpat patcher object.
 *
 * Topology (see src/quicksearch.ts for the message contract):
 *   live.thisdevice ─"init"─▶ v8 ◀─"show"── live.button
 *                              │            ◀─"show"── node.script (global hotkey)
 *                              │            ◀─"refresh"── live.text
 *            ┌── outlet0 "state/focus/reset/url" ─▶ [s ---qs_ui] ─▶ (subpatcher) jweb
 *            ├── outlet1 "open/close" ─▶ [pcontrol] ─▶ (subpatcher window)
 *            ├── outlet2 "ping/get_index/refresh/load" ─▶ [node.script bridge.js] ─▶ v8
 *            └── outlet3 "progress/count/active" ─▶ [route] ─▶ progress bar · count · refresh-enable
 *   (subpatcher) jweb ─▶ [s ---qs_from_ui] ─▶ [r ---qs_from_ui] ─▶ v8
 *   node.script bridge.js ⇄ Python Remote Script (browser walk + load_item) over TCP
 *   plugin~ ─▶ plugout~  (mandatory transparent audio passthrough)
 *
 * Box/attribute shapes are per the verified Max 9 / Live 12 spec (see README).
 */

const AMXD_AUDIO = 1633771873; // FourCC "aaaa"

function box(b) {
  return { box: b };
}
function line(srcId, srcOut, dstId, dstIn, order) {
  const pl = { source: [srcId, srcOut], destination: [dstId, dstIn] };
  if (order !== undefined) pl.order = order;
  return { patchline: pl };
}

/** The floating overlay subpatcher that hosts the jweb card. */
function overlaySubpatcher() {
  const W = 700;
  const H = 520;
  return {
    fileversion: 1,
    appversion: { major: 9, minor: 0, revision: 8, architecture: "x64", modernui: 1 },
    classnamespace: "box",
    rect: [120.0, 120.0, W + 40, H + 60],
    openinpresentation: 1,
    toolbarvisible: 0,
    title: "QuickSearch",
    boxes: [
      box({
        id: "ov-in",
        maxclass: "inlet",
        numinlets: 0,
        numoutlets: 1,
        outlettype: [""],
        patching_rect: [20.0, 20.0, 30.0, 30.0],
        comment: "pcontrol link",
      }),
      box({
        id: "ov-rui",
        maxclass: "newobj",
        numinlets: 0,
        numoutlets: 1,
        outlettype: [""],
        patching_rect: [20.0, 70.0, 90.0, 22.0],
        text: "r ---qs_ui",
      }),
      box({
        id: "ov-jweb",
        maxclass: "jweb",
        numinlets: 1,
        numoutlets: 1,
        outlettype: [""],
        rendermode: 2,
        patching_rect: [20.0, 110.0, W, H],
        presentation: 1,
        presentation_rect: [0.0, 0.0, W, H],
      }),
      box({
        id: "ov-sfromui",
        maxclass: "newobj",
        numinlets: 1,
        numoutlets: 0,
        patching_rect: [20.0, 110.0 + H + 10, 130.0, 22.0],
        text: "s ---qs_from_ui",
      }),
      box({
        id: "ov-load",
        maxclass: "newobj",
        numinlets: 1,
        numoutlets: 1,
        outlettype: ["bang"],
        patching_rect: [360.0, 20.0, 64.0, 22.0],
        text: "loadbang",
      }),
      // [active] fires 1 when the window becomes frontmost — re-apply the
      // borderless/float flags then (some builds only honour them once shown).
      box({
        id: "ov-active",
        maxclass: "newobj",
        numinlets: 1,
        numoutlets: 1,
        outlettype: [""],
        patching_rect: [470.0, 20.0, 50.0, 22.0],
        text: "active",
      }),
      box({
        id: "ov-selactive",
        maxclass: "newobj",
        numinlets: 1,
        numoutlets: 2,
        outlettype: ["bang", ""],
        patching_rect: [470.0, 50.0, 40.0, 22.0],
        text: "sel 1",
      }),
      box({
        id: "ov-style",
        maxclass: "message",
        numinlets: 2,
        numoutlets: 1,
        outlettype: [""],
        patching_rect: [360.0, 80.0, 560.0, 22.0],
        // NOTE: no "front" here — pcontrol shows the window; this only styles it.
        // Adjust the `window size <l t r b>` (absolute screen px) for your display.
        text:
          "window flags float, window flags notitle, window flags nogrow, window flags nomenu, window flags nozoom, window exec, window size 360 220 1060 740",
      }),
      box({
        id: "ov-thispatcher",
        maxclass: "newobj",
        numinlets: 1,
        numoutlets: 2,
        outlettype: ["", ""],
        save: ["#N", "thispatcher", ";", "#Q", "end", ";"],
        patching_rect: [360.0, 120.0, 80.0, 22.0],
        text: "thispatcher",
      }),
    ],
    lines: [
      line("ov-rui", 0, "ov-jweb", 0),
      line("ov-jweb", 0, "ov-sfromui", 0),
      line("ov-load", 0, "ov-style", 0),
      line("ov-active", 0, "ov-selactive", 0),
      line("ov-selactive", 0, "ov-style", 0),
      line("ov-style", 0, "ov-thispatcher", 0),
    ],
  };
}

/** Build the complete top-level patcher object. */
export function buildPatcher() {
  const boxes = [
    // ---- audio passthrough (mandatory) ----
    box({
      id: "obj-plugin",
      maxclass: "newobj",
      numinlets: 1,
      numoutlets: 2,
      outlettype: ["signal", "signal"],
      patching_rect: [520.0, 40.0, 60.0, 22.0],
      text: "plugin~",
    }),
    box({
      id: "obj-plugout",
      maxclass: "newobj",
      numinlets: 2,
      numoutlets: 0,
      patching_rect: [520.0, 120.0, 64.0, 22.0],
      text: "plugout~",
    }),

    // ---- init ----
    box({
      id: "obj-thisdev",
      maxclass: "newobj",
      numinlets: 1,
      numoutlets: 3,
      outlettype: ["bang", "int", "int"],
      patching_rect: [40.0, 40.0, 110.0, 22.0],
      text: "live.thisdevice",
    }),
    box({
      id: "obj-init",
      maxclass: "message",
      numinlets: 2,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: [40.0, 80.0, 40.0, 22.0],
      text: "init",
    }),

    // ---- the v8 brain ----
    box({
      id: "obj-v8",
      maxclass: "newobj",
      numinlets: 1,
      numoutlets: 3,
      outlettype: ["", "", ""],
      patching_rect: [40.0, 220.0, 160.0, 22.0],
      text: "v8 quicksearch.js",
      filename: "quicksearch.js",
      saved_object_attributes: { parameter_enable: 0 },
      textfile: { filename: "quicksearch.js", flags: 0, embed: 0, autowatch: 0 },
    }),

    // ---- trigger button (Key-Map / MIDI-Map target) ----
    box({
      id: "obj-button",
      maxclass: "live.button",
      numinlets: 1,
      numoutlets: 1,
      outlettype: [""],
      parameter_enable: 1,
      patching_rect: [240.0, 40.0, 20.0, 20.0],
      presentation: 1,
      presentation_rect: [16.0, 36.0, 22.0, 22.0],
      saved_attribute_attributes: {
        valueof: {
          parameter_enum: ["off", "on"],
          parameter_longname: "QuickSearch Open",
          parameter_mmax: 1,
          parameter_shortname: "Open",
          parameter_type: 2,
        },
      },
      varname: "qs_open_button",
    }),
    box({
      id: "obj-open",
      maxclass: "message",
      numinlets: 2,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: [240.0, 90.0, 45.0, 22.0],
      // "show", NOT "open": sending "open" to a js/v8 object is a reserved Max
      // message that opens the script source in the text editor instead of running.
      text: "show",
    }),

    // ---- refresh ----
    // mode 0 = momentary Button (NOT the default toggle, whose "on" state shows the
    // stock `texton` label "B"). A tap fires a bang → "refresh"; v8 drives `active`
    // to grey it out while indexing.
    box({
      id: "obj-refresh-text",
      maxclass: "live.text",
      mode: 0,
      numinlets: 1,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: [320.0, 40.0, 60.0, 22.0],
      presentation: 1,
      presentation_rect: [16.0, 104.0, 60.0, 22.0],
      saved_attribute_attributes: { valueof: { parameter_enable: 0 } },
      text: "Refresh",
      varname: "qs_refresh",
    }),
    box({
      id: "obj-refresh-msg",
      maxclass: "message",
      numinlets: 2,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: [320.0, 90.0, 60.0, 22.0],
      text: "refresh",
    }),
    // Item count shown next to Refresh — "0" until the index arrives, then the total.
    box({
      id: "obj-count",
      maxclass: "comment",
      numinlets: 1,
      numoutlets: 0,
      patching_rect: [400.0, 90.0, 80.0, 20.0],
      presentation: 1,
      presentation_rect: [84.0, 106.0, 90.0, 18.0],
      text: "0",
      fontsize: 9.0,
      textcolor: [0.55, 0.55, 0.55, 1.0],
    }),
    // Indexing progress bar (non-interactive). v8 sets it 0..1 via `set`; ignoreclick
    // keeps it display-only. parameter range is float 0..1.
    box({
      id: "obj-progress",
      maxclass: "live.slider",
      orientation: 1,
      ignoreclick: 1,
      numinlets: 1,
      numoutlets: 1,
      outlettype: [""],
      parameter_enable: 1,
      patching_rect: [320.0, 130.0, 160.0, 16.0],
      presentation: 1,
      presentation_rect: [16.0, 132.0, 198.0, 10.0],
      saved_attribute_attributes: {
        valueof: {
          parameter_longname: "Index Progress",
          parameter_shortname: "Index",
          parameter_type: 0,
          parameter_mmin: 0.0,
          parameter_mmax: 1.0,
        },
      },
      varname: "qs_progress",
    }),
    // v8 outlet 3 fans out to the three panel widgets: "progress <f>", "count <i>",
    // "active <0|1>" (refresh button enable).
    box({
      id: "obj-panel-route",
      maxclass: "newobj",
      numinlets: 1,
      numoutlets: 4,
      outlettype: ["", "", "", ""],
      patching_rect: [320.0, 160.0, 200.0, 22.0],
      text: "route progress count active",
    }),
    box({
      id: "obj-prep-progress",
      maxclass: "newobj",
      numinlets: 2,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: [320.0, 196.0, 80.0, 22.0],
      text: "prepend set",
    }),
    box({
      id: "obj-prep-count",
      maxclass: "newobj",
      numinlets: 2,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: [410.0, 196.0, 80.0, 22.0],
      text: "prepend set",
    }),
    box({
      id: "obj-prep-active",
      maxclass: "newobj",
      numinlets: 2,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: [500.0, 196.0, 90.0, 22.0],
      text: "prepend active",
    }),

    // ---- opt-in global hotkey ----
    box({
      id: "obj-hotkey-toggle",
      maxclass: "live.toggle",
      numinlets: 1,
      numoutlets: 1,
      outlettype: [""],
      parameter_enable: 1,
      patching_rect: [420.0, 40.0, 20.0, 20.0],
      presentation: 1,
      presentation_rect: [16.0, 70.0, 22.0, 22.0],
      saved_attribute_attributes: {
        valueof: {
          parameter_enum: ["off", "on"],
          parameter_longname: "Global Hotkey",
          parameter_mmax: 1,
          parameter_shortname: "Global",
          parameter_type: 2,
        },
      },
      varname: "qs_hotkey_enable",
    }),
    box({
      id: "obj-hotkey-sel",
      maxclass: "newobj",
      numinlets: 1,
      numoutlets: 3,
      outlettype: ["bang", "bang", ""],
      patching_rect: [420.0, 80.0, 60.0, 22.0],
      text: "sel 1 0",
    }),
    box({
      id: "obj-script-start",
      maxclass: "message",
      numinlets: 2,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: [420.0, 120.0, 90.0, 22.0],
      text: "script start",
    }),
    box({
      id: "obj-script-stop",
      maxclass: "message",
      numinlets: 2,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: [520.0, 200.0, 90.0, 22.0],
      text: "script stop",
    }),
    // The Global Hotkey live.toggle outputs its restored value (0 = off) on device
    // load → "sel 1 0" → "script stop". But the hotkey node.script is @autostart 0,
    // so it isn't running yet → "node.script: Node script not running, can't handle
    // 'script stop'". This [gate] starts CLOSED and is opened by live.thisdevice
    // (which fires AFTER parameter restore), so the spurious load-time stop is
    // dropped; genuine user toggle-offs (script actually running) still pass. We
    // gate ONLY stop — "script start" is fine to send to a stopped node.script.
    box({
      id: "obj-hotkey-stopgate",
      maxclass: "newobj",
      numinlets: 2,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: [620.0, 200.0, 50.0, 22.0],
      text: "gate",
    }),
    box({
      id: "obj-hotkey-gateopen",
      maxclass: "message",
      numinlets: 2,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: [700.0, 160.0, 30.0, 22.0],
      text: "1",
    }),
    box({
      id: "obj-node",
      maxclass: "newobj",
      numinlets: 1,
      numoutlets: 2,
      outlettype: ["", ""],
      patching_rect: [420.0, 240.0, 300.0, 22.0],
      text: "node.script global-hotkey.js @autostart 0",
      saved_object_attributes: {
        autostart: 0,
        defer: 0,
        node: "",
        npm: "",
        running: 0,
        watch: 0,
      },
    }),

    // ---- browser bridge (always-on) ----
    // Relays v8 ⇄ the QuickSearch Python Remote Script over TCP. Stdlib `net`
    // only (no npm), so it autostarts; the browser walk + load_item live there.
    box({
      id: "obj-bridge",
      maxclass: "newobj",
      numinlets: 1,
      numoutlets: 2,
      outlettype: ["", ""],
      patching_rect: [40.0, 340.0, 300.0, 22.0],
      text: "node.script bridge.js @autostart 1",
      saved_object_attributes: {
        autostart: 1,
        defer: 0,
        node: "",
        npm: "",
        running: 0,
        watch: 0,
      },
    }),

    // ---- send/receive bridge + window control ----
    box({
      id: "obj-sui",
      maxclass: "newobj",
      numinlets: 1,
      numoutlets: 0,
      patching_rect: [40.0, 280.0, 80.0, 22.0],
      text: "s ---qs_ui",
    }),
    box({
      id: "obj-pctrl",
      maxclass: "newobj",
      numinlets: 1,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: [150.0, 280.0, 70.0, 22.0],
      text: "pcontrol",
    }),
    box({
      id: "obj-rfromui",
      maxclass: "newobj",
      numinlets: 0,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: [40.0, 180.0, 120.0, 22.0],
      text: "r ---qs_from_ui",
    }),
    box({
      id: "obj-overlay",
      maxclass: "newobj",
      numinlets: 1,
      numoutlets: 0,
      patching_rect: [150.0, 330.0, 110.0, 22.0],
      text: "p qs_overlay",
      patcher: overlaySubpatcher(),
    }),

    // ---- presentation chrome ----
    box({
      id: "obj-title",
      maxclass: "comment",
      numinlets: 1,
      numoutlets: 0,
      patching_rect: [40.0, 400.0, 200.0, 20.0],
      presentation: 1,
      presentation_rect: [12.0, 8.0, 200.0, 20.0],
      text: "M4L QuickSearch",
      fontsize: 13.0,
      textcolor: [0.85, 0.85, 0.85, 1.0],
    }),
    box({
      id: "obj-help",
      maxclass: "comment",
      numinlets: 1,
      numoutlets: 0,
      patching_rect: [40.0, 430.0, 260.0, 36.0],
      presentation: 1,
      presentation_rect: [44.0, 38.0, 230.0, 18.0],
      text: "Map a key to the button (Key Map mode)",
      fontsize: 9.0,
      textcolor: [0.55, 0.55, 0.55, 1.0],
    }),
    box({
      id: "obj-help2",
      maxclass: "comment",
      numinlets: 1,
      numoutlets: 0,
      patching_rect: [40.0, 470.0, 260.0, 18.0],
      presentation: 1,
      presentation_rect: [44.0, 72.0, 230.0, 18.0],
      text: "Global hotkey (needs macOS permission)",
      fontsize: 9.0,
      textcolor: [0.55, 0.55, 0.55, 1.0],
    }),
  ];

  const lines = [
    // audio passthrough
    line("obj-plugin", 0, "obj-plugout", 0),
    line("obj-plugin", 1, "obj-plugout", 1),
    // init
    line("obj-thisdev", 0, "obj-init", 0),
    line("obj-init", 0, "obj-v8", 0),
    // trigger
    line("obj-button", 0, "obj-open", 0),
    line("obj-open", 0, "obj-v8", 0),
    // refresh
    line("obj-refresh-text", 0, "obj-refresh-msg", 0),
    line("obj-refresh-msg", 0, "obj-v8", 0),
    // panel widgets: v8 outlet 3 -> route -> progress / count / refresh-enable
    line("obj-v8", 3, "obj-panel-route", 0),
    line("obj-panel-route", 0, "obj-prep-progress", 0),
    line("obj-panel-route", 1, "obj-prep-count", 0),
    line("obj-panel-route", 2, "obj-prep-active", 0),
    line("obj-prep-progress", 0, "obj-progress", 0),
    line("obj-prep-count", 0, "obj-count", 0),
    line("obj-prep-active", 0, "obj-refresh-text", 0),
    // global hotkey enable
    line("obj-hotkey-toggle", 0, "obj-hotkey-sel", 0),
    line("obj-hotkey-sel", 0, "obj-script-start", 0),
    line("obj-hotkey-sel", 1, "obj-script-stop", 0),
    line("obj-script-start", 0, "obj-node", 0),
    // "script stop" is gated (right inlet = data); the gate is closed at load and
    // opened by live.thisdevice (→ "1" → left inlet), so the load-time stop is
    // dropped while later user toggle-offs pass through to the running script.
    line("obj-script-stop", 0, "obj-hotkey-stopgate", 1),
    line("obj-thisdev", 0, "obj-hotkey-gateopen", 0),
    line("obj-hotkey-gateopen", 0, "obj-hotkey-stopgate", 0),
    line("obj-hotkey-stopgate", 0, "obj-node", 0),
    // global hotkey fires "show"
    line("obj-node", 0, "obj-v8", 0),
    // browser bridge: v8 outlet2 -> bridge, bridge outlet0 -> v8 inlet0
    line("obj-v8", 2, "obj-bridge", 0),
    line("obj-bridge", 0, "obj-v8", 0),
    // v8 bridge out
    line("obj-v8", 0, "obj-sui", 0),
    line("obj-v8", 1, "obj-pctrl", 0),
    line("obj-pctrl", 0, "obj-overlay", 0),
    // ui -> v8
    line("obj-rfromui", 0, "obj-v8", 0),
  ];

  return {
    patcher: {
      fileversion: 1,
      appversion: { major: 9, minor: 0, revision: 8, architecture: "x64", modernui: 1 },
      classnamespace: "box",
      rect: [120.0, 100.0, 760.0, 520.0],
      openinpresentation: 1,
      boxes,
      lines,
      dependency_cache: [],
      autosave: 0,
      project: {
        version: 1,
        contents: { patchers: {} },
        // Max's project_deserialize_searchpath() reads these unconditionally —
        // a project dict missing `searchpath`/`layout` null-derefs and SIGSEGVs
        // Live on device load (confirmed via crash report). Real exported .amxd
        // projects always carry them (usually empty).
        searchpath: {},
        layout: {},
        amxdtype: AMXD_AUDIO,
        devpath: ".",
      },
    },
  };
}
