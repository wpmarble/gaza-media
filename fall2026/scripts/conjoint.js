/*
  conjoint.js  -- fall 2026 candidate conjoint

  Attach to EACH of the three conjoint multiple-choice questions (Candidate A /
  Candidate B). Change the TASK constant to the task number of that question
  (1..3) and change nothing else. The question text must contain an element
  with id "cj-table"; the table is rendered into it.

  Reads embedded data written by randomizer.js: cj{t}_a, cj{t}_b, cj_row_order.
  Writes on submit:
      cj{t}_choice   1 = Candidate A, 2 = Candidate B, "" if nothing selected
      cj{t}_rt_ms    ms between page load and submit (wall-clock dwell)
  On missing or invalid inputs: sets embedded data conjoint_error and shows a
  visible notice instead of a table.

  parseProfile(), buildTable() and choiceFields() are pure and exported for Node.

  ES5 only. Never the two characters dollar-sign and open-brace adjacent.
  Spec: docs/spec-js-and-build.md section 10.
*/

(function (global) {
  "use strict";

  /* ---- CHANGE THIS, AND ONLY THIS, PER QUESTION -------------------- */
  var TASK = 1;
  /* ------------------------------------------------------------------ */

  /* Must match the constants in randomizer.js (test 7.6 checks this). */
  /* 2026-09-30: Iran row cut to make room for the speech row; uncomment to restore */
  // var CJ_ROWS = ["party", "gender", "age", "gaza", "iran", "imm", "health", "abort", "tax"];
  // var CJ_ISSUE_ROWS = ["gaza", "iran", "imm", "health", "abort", "tax"];
  var CJ_ROWS = ["party", "gender", "age", "gaza", "human", "imm", "health", "abort", "tax"];
  var CJ_ISSUE_ROWS = ["gaza", "imm", "health", "abort", "tax"];
  /* Display rows below the demographics, canonical order; gaza and human stay adjacent. */
  var CJ_DISPLAY_ROWS = ["gaza", "human", "imm", "health", "abort", "tax"];
  var NSP = "nsp";

  var CJ_TEXT = {
    party: { label: "Party", levels: { dem: "Democrat", rep: "Republican" } },
    gender: { label: "Gender", levels: { man: "Man", woman: "Woman" } },
    age: { label: "Age", levels: { "38": "38", "52": "52", "66": "66" } },
    gaza: {
      label: "Israel and Gaza",
      levels: {
        pro: "Stands firmly with Israel, America's strongest ally in the Middle East, and supports continuing U.S. military aid.",
        mid: "Supports Israel's right to exist, humanitarian aid for Gaza, and a two-state solution.",
        end: "Supports ending all U.S. military aid and arms sales to Israel."
      }
    },
    human: {
      label: "Campaign speech",
      levels: {
        pal: 'In a speech, said Palestinian families "have the same fundamental right to live in safety, raise their children in peace, and determine their own futures."',
        isr: 'In a speech, said Israeli families "have the same fundamental right to live in safety, raise their children in peace, and determine their own futures."',
        both: 'In a speech, said Israeli and Palestinian families "have the same fundamental right to live in safety, raise their children in peace, and determine their own futures."',
        none: "No statement about the war"
      }
    },
    /* 2026-09-30: Iran row cut to make room for the speech row; uncomment to restore */
    /* iran: {
      label: "War with Iran",
      levels: {
        end: "Supports ending the war with Iran immediately.",
        cont: "Supports continuing the war until Iran's nuclear program is totally destroyed."
      }
    }, */
    imm: {
      label: "Immigration",
      levels: {
        deport: "Supports increasing deportations and finishing the border wall.",
        path: "Supports a path to citizenship for undocumented immigrants who have lived here for years.",
        path_ice: "Supports immediate citizenship for undocumented immigrants who have lived here for at least 2 years, and abolishing ICE."
      }
    },
    health: {
      label: "Health care",
      levels: {
        medicare: "Supports expanding Medicare to cover more people.",
        market: "Supports reducing the federal role in health insurance and lowering premiums through competition."
      }
    },
    abort: {
      label: "Abortion",
      levels: {
        federal: "Supports restoring a federal right to abortion.",
        states: "Supports leaving abortion law to the states."
      }
    },
    tax: {
      label: "Taxes",
      levels: {
        raise: "Supports raising taxes on billionaires and the very wealthy.",
        cut: "Supports cutting taxes across the board."
      }
    }
  };
  var NSP_TEXT = "No stated position";

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function isIssue(row) {
    return CJ_ISSUE_ROWS.indexOf(row) !== -1;
  }

  /* Pure: "dem|woman|52|pro|nsp|..." -> { party: "dem", ... }, or null if the
     string is not exactly nine valid codes in CJ_ROWS order. */
  function parseProfile(str) {
    if (str === null || str === undefined || str === "") return null;
    var parts = String(str).split("|");
    if (parts.length !== CJ_ROWS.length) return null;
    var out = {};
    var i, row, code;
    for (i = 0; i < CJ_ROWS.length; i++) {
      row = CJ_ROWS[i];
      code = parts[i];
      if (has(CJ_TEXT[row].levels, code)) {
        out[row] = code;
      } else if (code === NSP && isIssue(row)) {
        out[row] = code;
      } else {
        return null;
      }
    }
    return out;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* Pure: parsed display order (array of six rows) or null. Valid means a
     permutation of CJ_DISPLAY_ROWS in which gaza and human are adjacent. */
  function parseRowOrder(rowOrderStr) {
    if (rowOrderStr === null || rowOrderStr === undefined || rowOrderStr === "") return null;
    var parts = String(rowOrderStr).split("|");
    if (parts.length !== CJ_DISPLAY_ROWS.length) return null;
    var seen = {};
    var i;
    for (i = 0; i < parts.length; i++) {
      if (CJ_DISPLAY_ROWS.indexOf(parts[i]) === -1 || seen[parts[i]]) return null;
      seen[parts[i]] = 1;
    }
    if (Math.abs(parts.indexOf("gaza") - parts.indexOf("human")) !== 1) return null;
    return parts;
  }

  /* Pure: the parsed order, or canonical order when invalid. */
  function validRowOrder(rowOrderStr) {
    return parseRowOrder(rowOrderStr) || CJ_DISPLAY_ROWS.slice();
  }

  function cell(row, code) {
    if (code === NSP || (row === "human" && code === "none")) {
      return '<td class="cj-nsp"><em>' +
        (code === NSP ? NSP_TEXT : escapeHtml(CJ_TEXT.human.levels.none)) + "</em></td>";
    }
    return "<td>" + escapeHtml(CJ_TEXT[row].levels[code]) + "</td>";
  }

  /* Pure: HTML for the two-candidate table, or null if either profile is invalid. */
  function buildTable(aStr, bStr, rowOrderStr) {
    var a = parseProfile(aStr);
    var b = parseProfile(bStr);
    if (a === null || b === null) return null;
    var order = ["party", "gender", "age"].concat(validRowOrder(rowOrderStr));
    var html = '<table class="cj-table"><thead><tr><th></th>' +
      "<th>Candidate A</th><th>Candidate B</th></tr></thead><tbody>";
    var i, row;
    for (i = 0; i < order.length; i++) {
      row = order[i];
      html += "<tr><td>" + escapeHtml(CJ_TEXT[row].label) + "</td>" +
        cell(row, a[row]) + cell(row, b[row]) + "</tr>";
    }
    return html + "</tbody></table>";
  }

  /* Pure: embedded-data fields for one captured choice. Qualtrics choice id
     "1" = Candidate A, "2" = Candidate B; anything else records "". */
  function choiceFields(task, selectedChoiceId, rtMs) {
    var c = (selectedChoiceId === null || selectedChoiceId === undefined)
      ? "" : String(selectedChoiceId);
    var out = {};
    out["cj" + task + "_choice"] = c === "1" ? 1 : (c === "2" ? 2 : "");
    out["cj" + task + "_rt_ms"] = (rtMs === null || rtMs === undefined) ? "" : rtMs;
    return out;
  }

  var CSS =
    ".cj-table { width: 100%; border-collapse: collapse; font-size: 15px; }" +
    ".cj-table th, .cj-table td { border: 1px solid #999; padding: 6px 8px; vertical-align: top; }" +
    ".cj-table td:first-child { font-weight: bold; width: 28%; }" +
    ".cj-table .cj-nsp { font-style: italic; color: #777; }";

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseProfile: parseProfile,
      buildTable: buildTable,
      validRowOrder: validRowOrder,
      parseRowOrder: parseRowOrder,
      choiceFields: choiceFields,
      CJ_TEXT: CJ_TEXT,
      CJ_ROWS: CJ_ROWS,
      CJ_ISSUE_ROWS: CJ_ISSUE_ROWS,
      CJ_DISPLAY_ROWS: CJ_DISPLAY_ROWS,
      NSP: NSP,
      TASK: TASK
    };
    return;
  }

  if (typeof Qualtrics === "undefined") return;

  Qualtrics.SurveyEngine.addOnload(function () {
    var qThis = this;
    global.fall2026CjStart = Date.now();

    if (!document.getElementById("cj-style")) {
      var st = document.createElement("style");
      st.setAttribute("id", "cj-style");
      st.innerHTML = CSS;
      document.head.appendChild(st);
    }

    var aStr = Qualtrics.SurveyEngine.getEmbeddedData("cj" + TASK + "_a");
    var bStr = Qualtrics.SurveyEngine.getEmbeddedData("cj" + TASK + "_b");
    var order = Qualtrics.SurveyEngine.getEmbeddedData("cj_row_order");

    var container = qThis.getQuestionContainer();
    var target = container.querySelector("#cj-table");
    var html = null;
    try {
      html = buildTable(aStr, bStr, order);
    } catch (e) {
      console.error("conjoint.js task " + TASK + " failed:", e);
    }
    var err = "";
    if (html === null) {
      err = "task " + TASK + ": missing or invalid profile";
      html = "<p>The candidate table could not be loaded.</p>";
    } else if (parseRowOrder(order) === null) {
      err = "task " + TASK + ": invalid cj_row_order, canonical order used";
    }
    if (!target) {
      err = (err ? err + "; " : "") + "task " + TASK + ": cj-table element missing";
      target = document.createElement("div");
      container.appendChild(target);
    }
    if (err) {
      var prev = Qualtrics.SurveyEngine.getEmbeddedData("conjoint_error");
      Qualtrics.SurveyEngine.setEmbeddedData("conjoint_error", prev ? prev + " | " + err : err);
      console.error("conjoint.js: " + err);
    }
    target.innerHTML = html;

    Qualtrics.SurveyEngine.addOnPageSubmit(function (type) {
      if (type === "prev") return;
      try {
        var sel = qThis.getSelectedChoices();
        var start = global.fall2026CjStart;
        var rtMs = start ? (Date.now() - start) : null;
        var fields = choiceFields(TASK, sel && sel.length ? sel[0] : null, rtMs);
        var key;
        for (key in fields) {
          if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
          Qualtrics.SurveyEngine.setEmbeddedData(key, fields[key]);
        }
        console.log("fall2026 conjoint " + TASK + " choice:", fields);
      } catch (e2) {
        console.error("conjoint.js task " + TASK + " submit failed:", e2);
      }
    });
  });
})(typeof window !== "undefined" ? window : global);
