/*
  strip-commas.js  -- fall 2026

  Attach to the numeric text-entry estimate questions (est_killed_pal, est_killed_isr).
  Respondents often type "70,000" or "70 000", which Qualtrics's Valid Number check
  rejects. This removes commas and spaces from the field as they type or paste, so the
  stored value is a plain number and the native validation (kept ON) passes.

  ES5 only. Never the two characters dollar-sign and open-brace adjacent.
*/
Qualtrics.SurveyEngine.addOnReady(function () {
  var container = this.getQuestionContainer();
  var inputs = container.querySelectorAll("input[type=text], input.InputText");
  function clean(el) {
    var v = el.value;
    var c = v.replace(/[,\s]/g, "");
    if (c !== v) { el.value = c; }
  }
  var i;
  for (i = 0; i < inputs.length; i++) {
    (function (el) {
      el.addEventListener("input", function () { clean(el); });
      el.addEventListener("change", function () { clean(el); });
      el.addEventListener("blur", function () { clean(el); });
      clean(el);
    })(inputs[i]);
  }
});
