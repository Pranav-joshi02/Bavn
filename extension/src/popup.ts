console.log("✅ Popup script loaded");

document.getElementById("open")?.addEventListener("click", () => {

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {

    if (!tabs[0]?.id) return;

    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      files: ["dist/contentScript.js"]
    }, () => {

      chrome.tabs.sendMessage(tabs[0].id!, { action: "OPEN_SIDEBAR" });

    });
  });
});

