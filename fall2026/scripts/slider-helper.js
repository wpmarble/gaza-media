/*
  slider-helper.js  -- fall 2026 headline-choice experiment

  Attach to every Slider (HSLIDER) question. Qualtrics's horizontal slider only
  responds to a precise click on the thin track or a drag of the handle. This
  makes the whole bar row a hit target: a click anywhere across the bar sets the
  value to the clicked position, and the row gets extra vertical padding so it is
  easy to hit on a laptop trackpad or a phone.

  It works by updating the native <input type="range" class="RealSlider"> that
  Qualtrics keeps in sync with the visual track, then firing the input/change
  events Qualtrics listens to. Nothing is recorded by this script.

  ES5 only. Never the two characters dollar-sign and open-brace adjacent.
*/

(function (global) {
  "use strict";

  var PAD_PX = 14;   /* extra padding above and below each bar */

  function valueFromEvent(input, bar, ev) {
    var rect = bar.getBoundingClientRect();
    if (!rect.width) return null;
    var x = (ev.touches && ev.touches.length) ? ev.touches[0].clientX : ev.clientX;
    var frac = (x - rect.left) / rect.width;
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;
    var min = parseFloat(input.min) || 0;
    var max = parseFloat(input.max);
    if (isNaN(max)) max = 100;
    var step = parseFloat(input.step) || 1;
    var val = min + frac * (max - min);
    return Math.round(val / step) * step;
  }

  /* Choice id from the native input's id, e.g. "QID24~3~realslider" -> "3". */
  function choiceIdOf(input) {
    var m = /^QID\d+~(\d+)~/.exec(input.id || "");
    return m ? m[1] : null;
  }

  /* setter(choiceId, value) is Qualtrics's question.setChoiceValue, which moves the
     handle and records the answer. Fallback: drive the native range input. */
  function applyValue(input, val, setter) {
    var cid = choiceIdOf(input);
    if (setter && cid !== null) {
      try { setter(cid, val); return; } catch (e) { /* fall through */ }
    }
    input.value = val;
    var ev1 = document.createEvent("Event"); ev1.initEvent("input", true, true); input.dispatchEvent(ev1);
    var ev2 = document.createEvent("Event"); ev2.initEvent("change", true, true); input.dispatchEvent(ev2);
  }

  /* Choice id from any Qualtrics slider element id, e.g. "QID24~3~track" -> "3". */
  function choiceIdOfEl(el) {
    var node = el;
    while (node && !(typeof document !== "undefined" && node === document)) {
      var m = /^QID\d+~(\d+)~/.exec(node.id || "");
      if (m) return m[1];
      node = node.parentNode;
    }
    return null;
  }

  /* Find the slider bars in a question container, whatever layout Qualtrics used.
     Returns [{bar, input, cid}] — bar is the element whose width spans the scale. */
  function findSliders(container) {
    var out = [], i, els, el;
    els = container.querySelectorAll("input[type=range]");
    for (i = 0; i < els.length; i++) {
      el = els[i];
      var holder = el.parentNode;
      var track = holder ? holder.querySelector(".track") : null;
      out.push({ bar: track || holder || el, input: el, cid: choiceIdOf(el) || choiceIdOfEl(el) });
    }
    if (out.length) return out;
    els = container.querySelectorAll(".track, [class*='track']");
    for (i = 0; i < els.length; i++) {
      el = els[i];
      var cid = choiceIdOfEl(el);
      if (cid === null) continue;
      out.push({ bar: el, input: null, cid: cid });
    }
    return out;
  }

  var THICK_CSS = ".fall2026-thick .track, .fall2026-thick [class*='track'] { min-height: 10px; }" +
                  ".fall2026-thick td.BarOuter, .fall2026-thick .trackHolderRel { cursor: pointer; }";

  function enhance(container, setter) {
    if (!document.getElementById("fall2026-slider-css")) {
      var st = document.createElement("style"); st.id = "fall2026-slider-css";
      st.appendChild(document.createTextNode(THICK_CSS)); document.head.appendChild(st);
    }
    container.className += " fall2026-thick";
    var sliders = findSliders(container);
    var i;
    for (i = 0; i < sliders.length; i++) {
      (function (sl) {
        var row = sl.bar;
        while (row && row.tagName !== "TD" && row !== container && row.parentNode) row = row.parentNode;
        if (!row || row === container) row = sl.bar.parentNode || sl.bar;
        row.style.paddingTop = PAD_PX + "px";
        row.style.paddingBottom = PAD_PX + "px";
        row.style.cursor = "pointer";
        row.setAttribute("data-slider-helper", "1");
        function onPress(ev) {
          if (ev.target && ev.target.className && String(ev.target.className).indexOf("handle") !== -1) return;
          var pseudo = sl.input || { min: "0", max: "100", step: "1" };
          var val = valueFromEvent(pseudo, sl.bar, ev);
          if (val === null) return;
          if (setter && sl.cid !== null) {
            try { setter(sl.cid, val); return; } catch (e) { /* fall through */ }
          }
          if (sl.input) applyValue(sl.input, val, null);
        }
        row.addEventListener("mousedown", onPress);
        row.addEventListener("touchstart", onPress, { passive: true });
      })(sliders[i]);
    }
    if (!sliders.length) {
      console.warn("fall2026 slider-helper: no sliders found; markup sample: " +
                   String(container.innerHTML).replace(/\s+/g, " ").slice(0, 600));
    }
    return sliders.length;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { enhance: enhance, valueFromEvent: valueFromEvent, choiceIdOf: choiceIdOf, choiceIdOfEl: choiceIdOfEl, findSliders: findSliders };
    return;
  }

  if (typeof Qualtrics === "undefined") return;

  console.log("fall2026 slider-helper: script evaluated");

  function run(qThis, hook) {
    try {
      var n = enhance(qThis.getQuestionContainer(), function (cid, val) { qThis.setChoiceValue(cid, val); });
      console.log("fall2026 slider-helper (" + hook + "): enhanced " + n + " sliders");
    } catch (e) {
      console.error("slider-helper.js failed:", e);
    }
  }

  Qualtrics.SurveyEngine.addOnload(function () {
    console.log("fall2026 slider-helper: addOnload fired");
    var container = this.getQuestionContainer();
    if (!container.querySelector("[data-slider-helper]")) run(this, "onload");
  });

  Qualtrics.SurveyEngine.addOnReady(function () {
    console.log("fall2026 slider-helper: addOnReady fired");
    var container = this.getQuestionContainer();
    if (!container.querySelector("[data-slider-helper]")) run(this, "onready");
  });
})(typeof window !== "undefined" ? window : global);
