console.log("BAVN background running");

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-assistant") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return;
      chrome.tabs.sendMessage(tabs[0].id, { action: "OPEN_SIDEBAR" });
    });
  }
});
