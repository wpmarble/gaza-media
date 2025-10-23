/* 
  renderer.js

  This script prepares all the ingredients for rendering the article.
  It loads the correct article headline/text/image depending on treatment
  conditions and past choices by the respondent.  

*/
Qualtrics.SurveyEngine.addOnload(function () {
  var exposure = Qualtrics.SurveyEngine.getEmbeddedData("exposure_type");
  var imgUrl = "https://williammarble.com/gaza-media/img/";
  var imgTreatment = parseInt("${e://Field/img_treatment}", 10);
  console.log("Image flag: " + imgTreatment);

  var headline = "";
  var text = "";
  var imgFile = "";

  if (exposure === "self") {
    headline = Qualtrics.SurveyEngine.getEmbeddedData("selected_headline");
    text = Qualtrics.SurveyEngine.getEmbeddedData("selected_text");
    topic = Qualtrics.SurveyEngine.getEmbeddedData("selected_topic");
    valence = Qualtrics.SurveyEngine.getEmbeddedData("selected_valence");
    frame = Qualtrics.SurveyEngine.getEmbeddedData("selected_frame");
  } else if (exposure === "forced") {
    headline = Qualtrics.SurveyEngine.getEmbeddedData("forced_headline");
    text = Qualtrics.SurveyEngine.getEmbeddedData("forced_text");
    topic = Qualtrics.SurveyEngine.getEmbeddedData("forced_topic");
    valence = Qualtrics.SurveyEngine.getEmbeddedData("forced_valence");
    frame = Qualtrics.SurveyEngine.getEmbeddedData("forced_frame");
  } else {
    console.warn("Unknown exposure_type:", exposure);
  }


  // Normalize and sanitize
  topic = topic.toLowerCase().replace(/\s+/g, '').replace(/-/g, '_');
  frame = frame.toLowerCase().replace(/\s+/g, '').replace(/-/g, '_');
  valence = topic != "placebo" ? valence.toLowerCase().replace(/\s+/g, '').replace(/-/g, '_') : "placebo";

  // debugging
  loadedVars = [
    {
      headline: headline,
      text: text,
      topicClean: topic,
      valenceClean: valence,
      frameClean: frame
    }
  ];
  console.log("Renderer loaded these variables:");
  console.log(loadedVars);

  //get image (may not display it)
  if (imgTreatment === 1) {
    var imgFilename = "";

    if (topic === "placebo") {
      imgFilename = "placebo_" + frame + ".png";  // e.g., placebo_climate_change.png
    } else {
      imgFilename = topic + "_" + valence + "_" + frame + ".png";
    }
    imgUrl = imgUrl + imgFilename;
  } else {
    imgUrl = "none";
  }

  // Store for use in the next block
  Qualtrics.SurveyEngine.setEmbeddedData("display_headline", headline);
  Qualtrics.SurveyEngine.setEmbeddedData("display_text", text);
  Qualtrics.SurveyEngine.setEmbeddedData("image_url", imgUrl)

  // add console.log statements for debugging
  console.log("=== Article Rendered ===");
  console.log("Exposure type: ", exposure);
  console.log("Headline: ", headline);
  console.log("Text snippet: ", text ? text.substring(0, 100) + "..." : "[Empty]");
  console.log("Topic: ", topic);
  console.log("Valence: ", valence);
  console.log("Frame: ", frame);
  console.log("Image displayed: ", imgTreatment === 1 ? (imgUrl) : "No image");

});