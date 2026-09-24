/*
  renderer.js  -- fall 2026 headline-choice experiment

  Attach to the article INTRO page (the page immediately before the article
  itself). It decides which of the four alternatives from one earlier task the
  respondent will read, pulls that article's text, and stows it in embedded data
  for the next page to pipe.

  With probability P_READ_OWN (set in randomizer.js) the respondent reads the
  alternative they chose in task read_task; otherwise they read the
  read_alt_rank-th of the three alternatives they passed over, in display order.

  The read stage is parked (spec 8.3): articles.json is normally an empty array,
  so almost every respondent lands on the placeholder branch. That is NOT an error
  -- a missing article sets read_placeholder = 1 and a one-line placeholder body,
  and renderer_error stays empty. Only a genuine failure (no read_task, no ids,
  a bad HTTP response) writes renderer_error.

  Writes: read_pos, read_id, read_fallback, read_placeholder, display_headline,
          display_text   (renderer_error on failure)

  readPosition() and articleFields() are PURE and exported for tests.

  ES5 only. Never the two characters dollar-sign and open-brace adjacent.
  Spec: docs/spec-js-and-build.md section 5.
*/

(function (global) {
  "use strict";

  var ARTICLES_URL = "https://williammarble.com/gaza-media/fall2026/articles.json";
  var J = 5;   /* alternatives per task; only a fallback -- ids.length is used when known */

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

  /*
    Pure. Returns { display_headline, display_text, read_placeholder }.

      articles   parsed articles.json (may be [] or null)
      id         read_id
      headline   the title already piped for that position, used when the article
                 record carries no headline of its own

    A missing article is the expected case while the read stage is parked, so it
    resolves to a placeholder paragraph rather than an error. read_placeholder = 1
    is exported: the read-stage analysis must be able to drop those respondents.
  */
  function articleFields(articles, id, headline) {
    var art = findArticle(articles, id);
    if (art && art.text) {
      return {
        display_headline: art.headline || headline || "",
        display_text: art.text,
        read_placeholder: 0
      };
    }
    return {
      display_headline: headline || "",
      display_text: "<p><em>[Article text not yet available for " + id + "]</em></p>",
      read_placeholder: 1
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      readPosition: readPosition,
      findArticle: findArticle,
      articleFields: articleFields,
      ARTICLES_URL: ARTICLES_URL,
      J: J
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
      Qualtrics.SurveyEngine.setEmbeddedData("read_placeholder", 1);
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
        var f = articleFields(articles, readId, headline);
        Qualtrics.SurveyEngine.setEmbeddedData("display_headline", f.display_headline);
        Qualtrics.SurveyEngine.setEmbeddedData("display_text", f.display_text);
        Qualtrics.SurveyEngine.setEmbeddedData("read_placeholder", f.read_placeholder);
        Qualtrics.SurveyEngine.setEmbeddedData("renderer_error", "");
        console.log("fall2026 renderer: task=" + readTask + " pos=" + pos.read_pos +
                    " id=" + readId + " fallback=" + pos.read_fallback +
                    " placeholder=" + f.read_placeholder);
      };

      /* randomizer.js no longer warm-fetches (spec 8.3), so this is normally the
         first and only request for articles.json. It is small -- [] while the read
         stage is parked -- so the fetch is cheap; the window cache only saves a
         second request if the respondent backs up onto this page. */
      if (global.fall2026Articles) {
        finish(global.fall2026Articles);
      } else {
        qThis.hideNextButton();
        fetch(ARTICLES_URL, { cache: "no-store" })
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
