/*
  dwell.js  -- fall 2026 headline-choice experiment

  Attach to the article display page (the one piping display_headline and
  display_text). Hides the Next button for DWELL_MS so respondents cannot skim
  past the article instantly, then reveals it.

  This is the pilot's load-image.js with the image logic removed: the fall
  instrument shows no images.

  ES5 only. Never the two characters dollar-sign and open-brace adjacent.
  Spec: docs/spec-js-and-build.md section 5.
*/

(function (global) {
  "use strict";

  var DWELL_MS = 10000;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { DWELL_MS: DWELL_MS };
    return;
  }

  if (typeof Qualtrics === "undefined") return;

  Qualtrics.SurveyEngine.addOnload(function () {
    var qThis = this;
    global.fall2026ReadStart = Date.now();

    qThis.hideNextButton();
    setTimeout(function () {
      qThis.showNextButton();
    }, DWELL_MS);
  });
})(typeof window !== "undefined" ? window : global);
