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

  var topics = shuffleArray(["October 7", "famine", "hospitals"]).slice(0, 2);
  var topic1 = topics[0];
  var topic2 = topics[1];
  var frames = ["Humanizing", "Infrastructure", "Military"];
  var frame1 = randomChoice(frames);
  var frame2 = randomChoice(frames);
  var valences = shuffleArray(["Israeli", "Palestinian"]);
  var valence1 = valences[0];
  var valence2 = valences[1];

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
    valence_2: valence2
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
          topic: art1 ? art1.topic : ""
        },
        {
          slot: "2",
          headline: art2 ? art2.headline : "",
          text: art2 ? art2.text : "",
          topic: art2 ? art2.topic : ""
        },
        {
          slot: "3",
          headline: placebo ? placebo.headline : "",
          text: placebo ? placebo.text : "",
          topic: placebo ? placebo.topic : ""
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
      }

      if (exposureType === "forced") {
        var forcedArticle = randomChoice(shuffledArticles);
        Qualtrics.SurveyEngine.setEmbeddedData("display_headline", forcedArticle.headline);
        Qualtrics.SurveyEngine.setEmbeddedData("display_text", forcedArticle.text);
      }

      var spinnerEl = document.getElementById("loadingSpinner");
      if (spinnerEl) spinnerEl.remove();
      qThis.clickNextButton();
    })
    .catch(function (error) {
      console.error("Article loading failed:", error);
      alert("There was a problem loading the articles. Please refresh the page or try again.");
    });
});