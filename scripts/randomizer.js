Qualtrics.SurveyEngine.addOnload(function () {
  /*
    Gaza Media Survey Randomizer
    This script:
    - Randomizes exposure condition (forced vs. self)
    - Picks two distinct topics from the set {October 7, famine, hospitals}
    - Assigns random frame and valence to each
    - Selects matching articles from an external JSON
    - Sets embedded data for use later in Qualtrics
    - Displays a loading spinner while randomization occurs
  */

  var qThis = this;

  // --- Hide the question content ---
  this.getQuestionContainer().style.display = "none";
  qThis.hideNextButton();
  qThis.hidePreviousButton();

  // --- Show a loading spinner ---
  var spinner = document.createElement("div");
  spinner.setAttribute("id", "loadingSpinner");
  spinner.setAttribute("style", "border:8px solid #f3f3f3; border-top:8px solid #3498db; border-radius:50%; width:50px; height:50px; animation:spin 1s linear infinite; margin:50px auto;");
  document.body.appendChild(spinner);

  var style = document.createElement('style');
  style.innerHTML = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);

  // --- URL of article JSON ---
  const articleUrl = "https://williammarble.com/gaza-media/article-data/gaza-articles.json";

  // --- Helper functions ---
  function shuffleArray(array) {
    for (var i = array.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function randomChoice(array) {
    return array[Math.floor(Math.random() * array.length)];
  }

  // --- Randomize Exposure Assignment ---
  const exposureType = Math.random() < 0.25 ? "self" : "forced";
  Qualtrics.SurveyEngine.setEmbeddedData("exposure_type", exposureType);
  console.log("Exposure type:", exposureType);

  // --- Select 2 unique topics ---
  const topics = shuffleArray(["October 7", "famine", "hospitals"]).slice(0, 2);
  const [topic1, topic2] = topics;
  Qualtrics.SurveyEngine.setEmbeddedData("topic_1", topic1);
  Qualtrics.SurveyEngine.setEmbeddedData("topic_2", topic2);

  // --- Assign random frame to each topic ---
  const frames = ["Humanizing", "Infrastructure", "Military"];
  const frame1 = randomChoice(frames);
  const frame2 = randomChoice(frames);
  Qualtrics.SurveyEngine.setEmbeddedData("frame_1", frame1);
  Qualtrics.SurveyEngine.setEmbeddedData("frame_2", frame2);

  // --- Randomly assign one topic to be Israeli, the other Palestinian ---
  const valences = ["Israeli", "Palestinian"];
  const shuffleValence = shuffleArray(valences);
  const valence1 = shuffleValence[0];
  const valence2 = shuffleValence[1];
  Qualtrics.SurveyEngine.setEmbeddedData("valence_1", valence1);
  Qualtrics.SurveyEngine.setEmbeddedData("valence_2", valence2);

  // --- Fetch articles and select based on combinations ---
  fetch(articleUrl)
    .then(response => response.json())
    .then(articles => {
      console.log("Articles fetched:", articles.length);

      function selectArticle(topic, frame, valence) {
        const eligible = articles.filter(a =>
          a.topic === topic &&
          a.frame === frame &&
          a.valence === valence
        );
        return eligible.length > 0 ? randomChoice(eligible) : null;
      }

      const article1 = selectArticle(topic1, frame1, valence1);
      const article2 = selectArticle(topic2, frame2, valence2);

      if (article1) {
        Qualtrics.SurveyEngine.setEmbeddedData("headline_1", article1.headline);
        Qualtrics.SurveyEngine.setEmbeddedData("article_text_1", article1.text);
      } else {
        console.warn("No article found for combo 1");
      }

      if (article2) {
        Qualtrics.SurveyEngine.setEmbeddedData("headline_2", article2.headline);
        Qualtrics.SurveyEngine.setEmbeddedData("article_text_2", article2.text);
      } else {
        console.warn("No article found for combo 2");
      }

      // --- Clean up and auto-advance ---
      const spinnerEl = document.getElementById("loadingSpinner");
      if (spinnerEl) spinnerEl.remove();

      qThis.clickNextButton();
    })
    .catch(error => {
      console.error("Error loading or processing articles:", error);
      alert("Error loading article data. Please refresh or contact support.");
    });
});