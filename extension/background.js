chrome.runtime.onInstalled.addListener(() => {
  console.log("Beacon extension installed");
});

const DASHBOARD_URL = "https://beacon-insight-cloud.vercel.app";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── Windows identity via native messaging ──────────────────────────────────
  if (message.action === "get_windows_identity") {
    chrome.runtime.sendNativeMessage(
      "com.beacon.identity",
      { action: "get_identity" },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn("Beacon native host error:", chrome.runtime.lastError.message);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      }
    );
    return true; // async
  }

  // ── AI-powered prompt classification ──────────────────────────────────────
  if (message.action === "classify_prompt") {
    classifyPrompt(message.prompt, message.keywords)
      .then(result => sendResponse(result))
      .catch(() => sendResponse({ risk: "low", category: "general", reason: "Classification unavailable" }));
    return true; // async
  }

});

async function classifyPrompt(prompt, keywords) {
  try {
    const res = await fetch(`${DASHBOARD_URL}/api/classify`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ prompt, keywords }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn("Beacon classification failed, falling back to keyword matching", err);
    return null; // content.js will fall back to keyword matching
  }
}
