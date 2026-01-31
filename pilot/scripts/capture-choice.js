/* 
  capture-choice.js
  embedded on the first headline selection task

  Captures the preferred headline. Place as JS in the question asking
  which headline respondent would prefer to read.
*/

Qualtrics.SurveyEngine.addOnload(function () {
  var qThis = this;

  // Get all radio inputs in the question
  var radios = qThis.getQuestionContainer().querySelectorAll('input[type="radio"]');

  // Listen for a change event on any radio button
  for (var i = 0; i < radios.length; i++) {
    (function (index) {
      radios[index].addEventListener("click", function () {
        var choiceIndex = index + 1; // Convert 0-based index to 1-based field names

        // Retrieve embedded data values for the selected choice
        var selectedHeadline = Qualtrics.SurveyEngine.getEmbeddedData("headline_" + choiceIndex);
        var selectedText = Qualtrics.SurveyEngine.getEmbeddedData("article_text_" + choiceIndex);
        var selectedFrame = Qualtrics.SurveyEngine.getEmbeddedData("article_frame_" + choiceIndex);
        var selectedValence = Qualtrics.SurveyEngine.getEmbeddedData("article_valence_" + choiceIndex);
        var selectedTopic = Qualtrics.SurveyEngine.getEmbeddedData("article_topic_" + choiceIndex);

        // Store in new embedded fields
        Qualtrics.SurveyEngine.setEmbeddedData("selected_headline", selectedHeadline);
        Qualtrics.SurveyEngine.setEmbeddedData("selected_text", selectedText);
        Qualtrics.SurveyEngine.setEmbeddedData("selected_frame", selectedFrame);
        Qualtrics.SurveyEngine.setEmbeddedData("selected_valence", selectedValence);
        Qualtrics.SurveyEngine.setEmbeddedData("selected_topic", selectedTopic);
        Qualtrics.SurveyEngine.setEmbeddedData("selected_choice_index", choiceIndex);

        // Debug log
        console.log("Headline Selected:");
        console.log("  Index: " + choiceIndex);
        console.log("  Topic: " + selectedTopic);
        console.log("  Headline: " + selectedHeadline);
        console.log("  Text: " + (selectedText ? selectedText.substring(0, 100) + "..." : "[Empty]"));
        console.log("  Frame: " + selectedFrame);
        console.log("  Valence: " + selectedValence);
      });
    })(i);
  }
});