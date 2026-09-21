/*
  renderer.js  -- fall 2026 headline-choice experiment

  Attach to the article INTRO page (the page immediately before the article
  itself). It decides which of the four alternatives from one earlier task the
  respondent will read, pulls that article's text, and stows it in embedded data
  for the next page to pipe.

  With probability P_READ_OWN (set in randomizer.js) the respondent reads the
  alternative they chose in task read_task; otherwise they read the
  read_alt_rank-th of the three alternatives they passed over, in display order.

  Writes: read_pos, read_id, read_fallback, display_headline, display_text
          (renderer_error on failure)

  readPosition() is PURE and exported for tests.

  ES5 only. Never the two characters dollar-sign and open-brace adjacent.
  Spec: docs/spec-js-and-build.md section 5.
*/

(function (global) {
  "use strict";

  var ARTICLES_URL = "https://williammarble.com/gaza-media/fall2026/articles.json";
  var J = 4;

  /*
    Pure. Returns { read_pos, read_fallback }.

      choicePos     1..J, or null/""/NaN if the respondent skipped the task
      readOwn       1 -> read the chosen alternative; 0 -> read a passed-over one
      readAltRank   1..J-1, which passed-over position (display order)

    read_fallback = 1 marks the degenerate case where no choice was recorded, so
    "the alternatives they passed over" is undefined and we index all J positions
    instead. Note this can never return position J in that case, because
    readAltRank only runs to J-1; the fallback branch is a rare-path patch, not a
    design, and analysis should condition on read_fallback == 0.
  */
  function readPosition(choicePos, readOwn, readAltRank, nAlt) {
    var n = nAlt || J;
    var c = (choicePos === null || choicePos === undefined || choicePos === "")
      ? null : parseInt(choicePos, 10);
    if (c !== null && (isNaN(c) || c < 1 || c > n)) c = null;

    var own = parseInt(readOwn, 10) === 1;
    var rank = parseInt(readAltRank, 10);
    if (isNaN(rank) || rank < 1) rank = 1;

    if (c === null) {
      var all = [];
      for (var a = 1; a <= n; a++) all.push(a);
      if (rank > all.length) rank = all.length;
      return { read_pos: all[rank - 1], read_fallback: 1 };
    }
    if (own) return { read_pos: c, read_fallback: 0 };

    var others = [];
    for (var i = 1; i <= n; i++) if (i !== c) others.push(i);
    if (rank > others.length) rank = others.length;
    return { read_pos: others[rank - 1], read_fallback: 0 };
  }

  function findArticle(articles, id) {
    if (!articles) return null;
    for (var i = 0; i < articles.length; i++) {
      if (articles[i] && articles[i].id === id) return articles[i];
    }
    return null;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      readPosition: readPosition,
      findArticle: findArticle,
      ARTICLES_URL: ARTICLES_URL
    };
    return;
  }

  if (typeof Qualtrics === "undefined") return;

  Qualtrics.SurveyEngine.addOnload(function () {
    var qThis = this;

    function fail(where, err, headline) {
      console.error("renderer.js failed at " + where + ":", err);
      Qualtrics.SurveyEngine.setEmbeddedData(
        "renderer_error", where + ": " + (err && err.message ? err.message : String(err))
      );
      /* Degrade to the headline alone rather than a blank page. */
      Qualtrics.SurveyEngine.setEmbeddedData("display_headline", headline || "");
      Qualtrics.SurveyEngine.setEmbeddedData("display_text", "");
    }

    var readTask, ids, headline;
    try {
      readTask = parseInt(Qualtrics.SurveyEngine.getEmbeddedData("read_task"), 10);
      if (isNaN(readTask)) throw new Error("read_task is not set");

      var idsString = Qualtrics.SurveyEngine.getEmbeddedData("t" + readTask + "_ids");
      if (!idsString) throw new Error("t" + readTask + "_ids is empty");
      ids = String(idsString).split("|");

      var pos = readPosition(
        Qualtrics.SurveyEngine.getEmbeddedData("t" + readTask + "_choice_pos"),
        Qualtrics.SurveyEngine.getEmbeddedData("read_own"),
        Qualtrics.SurveyEngine.getEmbeddedData("read_alt_rank"),
        ids.length
      );

      var readId = ids[pos.read_pos - 1];
      headline = Qualtrics.SurveyEngine.getEmbeddedData("t" + readTask + "_h" + pos.read_pos);

      Qualtrics.SurveyEngine.setEmbeddedData("read_pos", pos.read_pos);
      Qualtrics.SurveyEngine.setEmbeddedData("read_id", readId);
      Qualtrics.SurveyEngine.setEmbeddedData("read_fallback", pos.read_fallback);

      var finish = function (articles) {
        var art = findArticle(articles, readId);
        if (!art) throw new Error("no article for id " + readId);
        Qualtrics.SurveyEngine.setEmbeddedData("display_headline", art.headline || headline || "");
        Qualtrics.SurveyEngine.setEmbeddedData("display_text", art.text || "");
        Qualtrics.SurveyEngine.setEmbeddedData("renderer_error", "");
        console.log("fall2026 renderer: task=" + readTask + " pos=" + pos.read_pos +
                    " id=" + readId + " fallback=" + pos.read_fallback);
      };

      if (global.fall2026Articles) {
        finish(global.fall2026Articles);
      } else {
        qThis.hideNextButton();
        fetch(ARTICLES_URL, { cache: "force-cache" })
          .then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status + " for articles.json");
            return r.json();
          })
          .then(function (articles) {
            global.fall2026Articles = articles;
            finish(articles);
            qThis.showNextButton();
          })
          .catch(function (e) {
            fail("fetch", e, headline);
            qThis.showNextButton();
          });
      }
    } catch (e) {
      fail("select", e, headline);
    }
  });
})(typeof window !== "undefined" ? window : global);
