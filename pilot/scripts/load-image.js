/*
    load-image.js

    embedded in the question where the article is actually displayed
*/

Qualtrics.SurveyEngine.addOnload(function () {

  var imgTreatment = parseInt("${e://Field/img_treatment}", 10);
  var imgUrl = Qualtrics.SurveyEngine.getEmbeddedData("image_url");
  console.log("== imgUrl == ");
  console.log(imgUrl);

  // Insert image
  if (imgTreatment == 1) {
    var img = document.createElement("img");
    img.src = imgUrl;
    console.log("=== img ===");
    console.log(img);

    document.getElementById("article-image-container").appendChild(img);
  }

  // --- Hide the Next button for 10 seconds ---
  this.hideNextButton();
  setTimeout(() => {
    this.showNextButton();
  }, 10000);
})
