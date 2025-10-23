/* 
  randomizer.js
  embedded just before first headline selection question
  
  Implements randomization for PICA experiment in Gaza media study.

  We will present 2 articles for respondents to choose from (plus a placebo)
  We select pro-Israeli and one pro-Palestinian (valence) article. 
  Within valence, we randomize topic (["October 7", "famine", "hospitals"]) 
  and frame (["Humanizing", "Infrastructure", "Military"]). 

  We then select a random article from our set of candidates matching the
  assignment. 

  We further randomize whether respondents will read the article they choose
  or will be forced to read a randomly selected article (exposure_type).

  Finally, we randomize whether an image is included or not (img_treatment)
*/

Qualtrics.SurveyEngine.addOnload(function () {
  var qThis = this;

  // Hide question and buttons
  this.getQuestionContainer().style.display = "none";
  qThis.hideNextButton();
  qThis.hidePreviousButton();

  // Spinner
  var spinner = document.createElement("div");
  spinner.setAttribute("id", "loadingSpinner");
  spinner.setAttribute("style", "border:8px solid #f3f3f3; border-top:8px solid #3498db; border-radius:50%; width:50px; height:50px; animation:spin 1s linear infinite; margin:50px auto;");
  document.body.appendChild(spinner);

  var style = document.createElement("style");
  style.innerHTML = "@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }";
  document.head.appendChild(style);

  // URL for article JSON
  var articleUrl = "https://williammarble.com/gaza-media/article-data/gaza-articles.json";

  // Helpers
  function shuffleArray(array) {
    for (var i = array.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = array[i];
      array[i] = array[j];
      array[j] = temp;
    }
    return array;
  }

  function randomChoice(array) {
    return array[Math.floor(Math.random() * array.length)];
  }

  // Random assignment
  var exposureType = Math.random() < 0.25 ? "self" : "forced";
  Qualtrics.SurveyEngine.setEmbeddedData("exposure_type", exposureType);

  var imgTreatment = Math.random() < 0.5 ? 0 : 1;
  var topics = ["October 7", "famine", "hospitals"]
  var topic1 = randomChoice(topics);
  var topic2 = randomChoice(topics);
  var frames = ["Humanizing", "Infrastructure", "Military"];
  var frame1 = randomChoice(frames);
  var frame2 = randomChoice(frames);
  var valences = shuffleArray(["Israeli", "Palestinian"]);
  var valence1 = valences[0];
  var valence2 = valences[1];

  Qualtrics.SurveyEngine.setEmbeddedData("img_treatment", imgTreatment);
  Qualtrics.SurveyEngine.setEmbeddedData("topic_1", topic1);
  Qualtrics.SurveyEngine.setEmbeddedData("topic_2", topic2);
  Qualtrics.SurveyEngine.setEmbeddedData("frame_1", frame1);
  Qualtrics.SurveyEngine.setEmbeddedData("frame_2", frame2);
  Qualtrics.SurveyEngine.setEmbeddedData("valence_1", valence1);
  Qualtrics.SurveyEngine.setEmbeddedData("valence_2", valence2);

  console.log("Assigned Conditions:", {
    topic_1: topic1,
    frame_1: frame1,
    valence_1: valence1,
    topic_2: topic2,
    frame_2: frame2,
    valence_2: valence2,
    imgTreatment: imgTreatment,
    exposureType: exposureType
  });

  fetch(articleUrl)
    .then(response => response.json())
    .then(function (articles) {
      function selectArticle(topic, frame, valence) {
        var filtered = articles.filter(function (a) {
          return a.topic === topic && a.frame === frame && a.valence === valence;
        });
        return filtered.length > 0 ? randomChoice(filtered) : null;
      }

      var placeboArticles = articles.filter(function (a) {
        return a.topic === "placebo";
      });

      var art1 = selectArticle(topic1, frame1, valence1);
      var art2 = selectArticle(topic2, frame2, valence2);
      var placebo = randomChoice(placeboArticles);

      var articleObjects = [
        {
          slot: "1",
          headline: art1 ? art1.headline : "",
          text: art1 ? art1.text : "",
          topic: art1 ? art1.topic : "",
          frame: art1 ? art1.frame : "",
          valence: art1 ? art1.valence : ""
        },
        {
          slot: "2",
          headline: art2 ? art2.headline : "",
          text: art2 ? art2.text : "",
          topic: art2 ? art2.topic : "",
          frame: art2 ? art2.frame : "",
          valence: art2 ? art2.valence : ""
        },
        {
          slot: "3",
          headline: placebo ? placebo.headline : "",
          text: placebo ? placebo.text : "",
          topic: placebo ? placebo.topic : "",
          frame: placebo ? placebo.frame : "",
          valence: placebo ? placebo.valence : "",
        }
      ];

      var shuffledArticles = shuffleArray(articleObjects);
      console.log("shuffledArticles: ", shuffledArticles);

      for (var i = 0; i < shuffledArticles.length; i++) {
        var idx = i + 1;
        var art = shuffledArticles[i];
        Qualtrics.SurveyEngine.setEmbeddedData("headline_" + idx, art.headline);
        Qualtrics.SurveyEngine.setEmbeddedData("article_text_" + idx, art.text);
        Qualtrics.SurveyEngine.setEmbeddedData("article_topic_" + idx, art.topic);
        Qualtrics.SurveyEngine.setEmbeddedData("article_frame_" + idx, art.frame);
        Qualtrics.SurveyEngine.setEmbeddedData("article_valence_" + idx, art.valence);
      }

      if (exposureType === "forced") {
        var forcedArticle = randomChoice(shuffledArticles);
        Qualtrics.SurveyEngine.setEmbeddedData("forced_headline", forcedArticle.headline);
        Qualtrics.SurveyEngine.setEmbeddedData("forced_topic", forcedArticle.topic);
        Qualtrics.SurveyEngine.setEmbeddedData("forced_frame", forcedArticle.frame);
        Qualtrics.SurveyEngine.setEmbeddedData("forced_valence", forcedArticle.valence);
        Qualtrics.SurveyEngine.setEmbeddedData("forced_text", forcedArticle.text);
      }

      // select second headline task articles
      var usedHeadlines = articleObjects.map(function(a) { return a.headline; });

      function filterUnused(articles, topic, frame, valence) {
        return articles.filter(function (a) {
          return (
            a.topic === topic &&
            a.frame === frame &&
            a.valence === valence &&
            usedHeadlines.indexOf(a.headline) === -1
          );
        });
      }

      function pickFollowupArticle(topicPool, framePool, valence, usedHeadlines) {
        var shuffledTopics = shuffleArray(topicPool.slice());
        var shuffledFrames = shuffleArray(framePool.slice());

        for (var i = 0; i < shuffledTopics.length; i++) {
          for (var j = 0; j < shuffledFrames.length; j++) {
            var candidates = filterUnused(articles, shuffledTopics[i], shuffledFrames[j], valence);
            if (candidates.length > 0) {
              return randomChoice(candidates);
            }
          }
        }
        return null; // fallback
      }
      var followupPal = pickFollowupArticle(topics, frames, "Palestinian", usedHeadlines);
      var followupIsr = pickFollowupArticle(topics, frames, "Israeli", usedHeadlines);
      var followupPlacebos = placeboArticles.filter(function (a) {
        return usedHeadlines.indexOf(a.headline) === -1;
      });
      var followupPlacebo = followupPlacebos.length > 0 ? randomChoice(followupPlacebos) : null;

      var followupArticles = [
        {
          slot: "1",
          headline: followupPal ? followupPal.headline : "",
          text: followupPal ? followupPal.text : "",
          topic: followupPal ? followupPal.topic : "",
          frame: followupPal ? followupPal.frame : ""
        },
        {
          slot: "2",
          headline: followupIsr ? followupIsr.headline : "",
          text: followupIsr ? followupIsr.text : "",
          topic: followupIsr ? followupIsr.topic : "",
          frame: followupIsr ? followupIsr.frame : ""
        },
        {
          slot: "3",
          headline: followupPlacebo ? followupPlacebo.headline : "",
          text: followupPlacebo ? followupPlacebo.text : "",
          topic: followupPlacebo ? followupPlacebo.topic : "",
          frame: followupPlacebo ? followupPlacebo.frame : ""
        }
      ];
      followupArticles = shuffleArray(followupArticles);

      for (var i = 0; i < followupArticles.length; i++) {
        var idx = i + 1;
        var art = followupArticles[i];
        Qualtrics.SurveyEngine.setEmbeddedData("headline_" + idx + "_followup", art.headline);
        Qualtrics.SurveyEngine.setEmbeddedData("article_text_" + idx + "_followup", art.text);
        Qualtrics.SurveyEngine.setEmbeddedData("article_topic_" + idx + "_followup", art.topic);
        Qualtrics.SurveyEngine.setEmbeddedData("article_valence_" + idx + "_followup", art.valence);
        Qualtrics.SurveyEngine.setEmbeddedData("article_frame_" + idx + "_followup", art.frame);
      }
      console.log("Follow-up headline task articles:", followupArticles);
      // end(follow up task articles)

      var spinnerEl = document.getElementById("loadingSpinner");
      if (spinnerEl) spinnerEl.remove();
      qThis.clickNextButton();
    })
    .catch(function (error) {
      console.error("Article loading failed:", error);
      alert("There was a problem loading the articles. Please refresh the page or try again.");
    });
});