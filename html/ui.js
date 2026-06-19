/* M4L QuickSearch — jweb page logic (plain browser JS, runs in jweb's Chromium). */
(function () {
  "use strict";

  // ---- kind metadata (icon + tint + label), mirrors src/types.ts Kind --------
  var KIND = {
    instrument: {
      hue: "#ffad56",
      label: "Instrument",
      icon:
        '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 5v8M12 5v8M16 5v8" stroke="currentColor" stroke-width="1.4"/></svg>',
    },
    audio_effect: {
      hue: "#5cc8d6",
      label: "Audio FX",
      icon:
        '<svg viewBox="0 0 24 24"><path d="M3 12h3l2-6 4 14 3-10 2 4h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    },
    midi_effect: {
      hue: "#7bd88f",
      label: "MIDI FX",
      icon:
        '<svg viewBox="0 0 24 24"><circle cx="8" cy="17" r="2.4" fill="currentColor"/><path d="M10.4 17V7l8-2v9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="16.4" cy="14.2" r="2.2" fill="currentColor"/></svg>',
    },
    plugin: {
      hue: "#b18cf0",
      label: "Plug-in",
      icon:
        '<svg viewBox="0 0 24 24"><path d="M9 3v4M15 3v4M6 7h12v6a6 6 0 0 1-12 0z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 19v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    },
  };

  var TRACK_LABEL = {
    midi: "MIDI Track",
    audio: "Audio Track",
    group: "Group Track",
    return: "Return Track",
    master: "Master Track",
    none: "No track selected",
  };

  // ---- DOM refs --------------------------------------------------------------
  var el = {};
  function $(id) {
    return document.getElementById(id);
  }

  // ---- state -----------------------------------------------------------------
  var currentResults = [];
  var selIndex = 0;
  var renderedQuery = null;
  var queryDebounce = null;
  var noticeTimer = null;

  // ---- helpers ---------------------------------------------------------------
  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function hexAlpha(hex, a) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }

  function highlight(name, ranges) {
    if (!ranges || !ranges.length) return escapeHtml(name);
    var out = "";
    var pos = 0;
    for (var i = 0; i < ranges.length; i++) {
      var s = ranges[i][0];
      var e = ranges[i][1];
      if (s > pos) out += escapeHtml(name.slice(pos, s));
      out += "<mark>" + escapeHtml(name.slice(s, e)) + "</mark>";
      pos = e;
    }
    if (pos < name.length) out += escapeHtml(name.slice(pos));
    return out;
  }

  function clamp(i, lo, hi) {
    return i < lo ? lo : i > hi ? hi : i;
  }

  // ---- rendering -------------------------------------------------------------
  function render(state) {
    // track badge
    el.trackBadge.textContent = TRACK_LABEL[state.track.kind] || "—";

    // indexing / results / empty visibility
    if (state.indexing) {
      el.indexing.hidden = false;
      el.results.innerHTML = "";
      el.empty.hidden = true;
      el.indexing.querySelector(".fill").style.width =
        Math.round((state.indexProgress || 0) * 100) + "%";
      el.indexing.querySelector(".label").textContent =
        "Indexing your library… " + state.count + " found";
    } else {
      el.indexing.hidden = true;
      currentResults = state.results || [];

      if (state.query !== renderedQuery) {
        selIndex = 0;
        renderedQuery = state.query;
      } else {
        selIndex = clamp(selIndex, 0, Math.max(0, currentResults.length - 1));
      }

      el.empty.hidden = currentResults.length > 0;
      buildRows(currentResults);
      applySelection();
    }

    renderNotice(state.notice);
  }

  function buildRows(results) {
    var html = "";
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var meta = KIND[r.kind] || KIND.plugin;
      var sub = r.source ? escapeHtml(r.source) : "";
      var cls = "row" + (r.compatible ? "" : " incompatible");
      html +=
        '<li class="' +
        cls +
        '" data-i="' +
        i +
        '">' +
        '<span class="badge" style="background:' +
        hexAlpha(meta.hue, 0.18) +
        ";color:" +
        meta.hue +
        '">' +
        meta.icon +
        "</span>" +
        '<span class="meta">' +
        '<span class="name">' +
        highlight(r.name, r.ranges) +
        "</span>" +
        (sub ? '<span class="sub">' + sub + "</span>" : "") +
        "</span>" +
        '<span class="tail">' +
        '<span class="kind" style="color:' +
        meta.hue +
        '">' +
        meta.label +
        "</span>" +
        (r.compatible
          ? '<span class="enter">↵</span>'
          : '<span class="enter warn">⚠</span>') +
        "</span>" +
        "</li>";
    }
    el.results.innerHTML = html;
  }

  function applySelection() {
    var rows = el.results.children;
    for (var i = 0; i < rows.length; i++) {
      if (i === selIndex) rows[i].classList.add("selected");
      else rows[i].classList.remove("selected");
    }
    var sel = rows[selIndex];
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: "nearest" });
  }

  function renderNotice(notice) {
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }
    el.notice.className = "";
    if (!notice || !notice.kind) {
      el.notice.textContent = "";
      return;
    }
    el.notice.classList.add(notice.kind);
    el.notice.textContent = (notice.kind === "loaded" ? "✓ " : "") + notice.text;
    if (notice.kind === "hint") {
      noticeTimer = setTimeout(function () {
        el.notice.textContent = "";
        el.notice.className = "";
      }, 2500);
    }
  }

  function shake() {
    el.card.classList.remove("shake");
    // reflow to restart the animation
    void el.card.offsetWidth;
    el.card.classList.add("shake");
  }

  // ---- interaction -----------------------------------------------------------
  function nav(delta) {
    if (!currentResults.length) return;
    selIndex = clamp(selIndex + delta, 0, currentResults.length - 1);
    applySelection();
  }

  function activate() {
    var r = currentResults[selIndex];
    if (!r) return;
    if (!r.compatible) shake();
    send("enter", r.ref); // v8 decides: load, or push an incompatible/locate hint
  }

  function onInput() {
    if (queryDebounce) clearTimeout(queryDebounce);
    var v = el.q.value;
    queryDebounce = setTimeout(function () {
      send("query", v);
    }, 24);
  }

  function onKeyDown(e) {
    // Keep typing keys inside the page (best-effort against the Mac jweb leak).
    e.stopPropagation();
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        nav(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        nav(-1);
        break;
      case "Tab":
        e.preventDefault();
        nav(e.shiftKey ? -1 : 1);
        break;
      case "Enter":
        e.preventDefault();
        activate();
        break;
      case "Escape":
        e.preventDefault();
        send("close");
        break;
      default:
        break;
    }
  }

  // ---- Max bridge ------------------------------------------------------------
  function decodeState(b64) {
    // our v8 encoder emits UTF-8 → base64; decode back to a JS string.
    var bin = atob(b64);
    try {
      return JSON.parse(decodeURIComponent(escape(bin)));
    } catch (_e) {
      return JSON.parse(bin);
    }
  }

  function onState(b64) {
    render(decodeState(b64));
  }
  function onFocus() {
    el.q.focus();
    el.q.select();
  }
  function onReset() {
    el.q.value = "";
    selIndex = 0;
    renderedQuery = null;
    if (noticeTimer) clearTimeout(noticeTimer);
    el.notice.textContent = "";
    el.notice.className = "";
  }

  function send() {
    var args = Array.prototype.slice.call(arguments);
    if (window.max && typeof window.max.outlet === "function") {
      window.max.outlet.apply(window.max, args);
    } else if (window.__qsPreview) {
      console.log("→ max", args);
    }
  }

  function bindBridge() {
    if (window.max && typeof window.max.bindInlet === "function") {
      window.max.bindInlet("state", onState);
      window.max.bindInlet("focus", onFocus);
      window.max.bindInlet("reset", onReset);
      return true;
    }
    return false;
  }

  // Also expose handlers globally for the frozen executejavascript-injection path.
  window.QS = { state: onState, focus: onFocus, reset: onReset };

  function init() {
    el.scrim = $("scrim");
    el.card = $("card");
    el.q = $("q");
    el.trackBadge = $("track-badge");
    el.results = $("results");
    el.empty = $("empty");
    el.indexing = $("indexing");
    el.notice = $("notice");

    el.q.addEventListener("input", onInput);
    document.addEventListener("keydown", onKeyDown, true);

    el.results.addEventListener("mousedown", function (e) {
      var li = e.target.closest ? e.target.closest(".row") : null;
      if (!li) return;
      e.preventDefault();
      var n = parseInt(li.getAttribute("data-i"), 10);
      selIndex = isNaN(n) ? 0 : n;
      applySelection();
      activate();
    });

    // click on the transparent margin (outside the card) closes
    el.scrim.addEventListener("mousedown", function (e) {
      if (e.target === el.scrim) send("close");
    });

    // Connect the bridge; jweb may inject window.max slightly after load.
    var tries = 0;
    (function waitForBridge() {
      if (bindBridge()) {
        send("ready");
        return;
      }
      if (++tries > 40) {
        // No bridge — design-preview mode (opened in a normal browser).
        previewMode();
        return;
      }
      setTimeout(waitForBridge, 25);
    })();

    el.q.focus();
  }

  // ---- design preview (no Max) ----------------------------------------------
  function previewMode() {
    window.__qsPreview = true;
    var mock = {
      query: "",
      track: { name: "1 MIDI", kind: "midi" },
      indexing: false,
      indexProgress: 1,
      count: 412,
      notice: { kind: null, text: "", token: 0 },
      results: [
        m("Operator", "Core Library", "instrument", true),
        m("Wavetable", "Core Library", "instrument", true),
        m("EQ Eight", "Core Library", "audio_effect", true),
        m("Glue Compressor", "Core Library", "audio_effect", true),
        m("Arpeggiator", "Core Library", "midi_effect", true),
        m("Serum 2", "VST3", "plugin", true),
        m("FabFilter Pro-Q 3", "VST3", "plugin", true),
        m("Reverb", "Core Library", "audio_effect", true),
      ],
    };
    render(mock);
    // demo: a hint after a moment
    el.q.addEventListener("input", function () {
      render(
        Object.assign({}, mock, {
          query: el.q.value,
          results: mock.results.filter(function (r) {
            return r.name.toLowerCase().indexOf(el.q.value.toLowerCase()) >= 0;
          }),
        }),
      );
    });
  }
  function m(name, source, kind, compatible) {
    return { name: name, source: source, kind: kind, compatible: compatible, ranges: [], ref: 0 };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
