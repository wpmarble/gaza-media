/*
  capture-choice.js  -- fall 2026 headline-choice experiment

  Attach to EACH of the six choice questions. Change the TASK constant to the
  task number of that question (1..6) and change nothing else.

  Records, for task k:
      t{k}_choice_pos   display position of the selected alternative, 1..4
      t{k}_choice_id    the headline id at that position, read back from t{k}_ids
      t{k}_rt_ms        ms between page load and submit

  Response time is wall-clock page dwell, not decision latency: a respondent who
  tabs away inflates it. Treat it as a screening variable, not a measure.

  ES5 only. Never the two characters dollar-sign and open-brace adjacent.
  Spec: docs/spec-js-and-build.md section 4.
*/

(function (global) {
  "use strict";

  /* ---- CHANGE THIS, AND ONLY THIS, PER QUESTION -------------------- */
  var TASK = 1;
  /* ------------------------------------------------------------------ */

  /*
    Pure: build the embedded-data fields for one captured choice.
      task       1..6
      pos        selected display position as a number, or null if nothing selected
      idsString  the pipe-joined t{k}_ids string written by randomizer.js
      rtMs       elapsed ms, or null
    A pos outside 1..ids.length yields an empty choice id rather than "undefined".
  */
  function choiceFields(task, pos, idsString, rtMs) {
    var ids = (idsString === null || idsString === undefined || idsString === "")
      ? [] : String(idsString).split("|");
    var p = (pos === null || pos === undefined || pos === "") ? null : parseInt(pos, 10);
    if (p !== null && (isNaN(p) || p < 1 || p > ids.length)) p = null;

    var out = {};
    out["t" + task + "_choice_pos"] = p === null ? "" : p;
    out["t" + task + "_choice_id"] = p === null ? "" : ids[p - 1];
    out["t" + task + "_rt_ms"] = (rtMs === null || rtMs === undefined) ? "" : rtMs;
    return out;
  }

  /* Qualtrics getSelectedChoices() returns an array of choice recode ids as
     strings. Take the first (these are single-select questions). */
  function firstSelected(selected) {
    if (!selected || !selected.length) return null;
    return selected[0];
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { choiceFields: choiceFields, firstSelected: firstSelected, TASK: TASK };
    return;
  }

  if (typeof Qualtrics === "undefined") return;

  Qualtrics.SurveyEngine.addOnload(function () {
    var qThis = this;
    global.fall2026TaskStart = Date.now();

    Qualtrics.SurveyEngine.addOnPageSubmit(function (type) {
      if (type === "prev") return;
      try {
        var pos = firstSelected(qThis.getSelectedChoices());
        var idsString = Qualtrics.SurveyEngine.getEmbeddedData("t" + TASK + "_ids");
        var start = global.fall2026TaskStart;
        var rtMs = start ? (Date.now() - start) : null;

        var fields = choiceFields(TASK, pos, idsString, rtMs);
        var key;
        for (key in fields) {
          if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
          Qualtrics.SurveyEngine.setEmbeddedData(key, fields[key]);
        }
        console.log("fall2026 task " + TASK + " choice:", fields);
      } catch (e) {
        console.error("capture-choice.js task " + TASK + " failed:", e);
      }
    });
  });
})(typeof window !== "undefined" ? window : global);
