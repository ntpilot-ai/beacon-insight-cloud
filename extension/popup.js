
document.getElementById(
  "insightBtn"
).addEventListener(
  "click",
  () => {

    chrome.tabs.create({
      url: chrome.runtime.getURL(
        "insight.html"
      )
    });

  }
);

document.getElementById(
  "atlasBtn"
).addEventListener(
  "click",
  () => {

    chrome.tabs.create({
      url: chrome.runtime.getURL(
        "atlas.html"
      )
    });

  }
);
