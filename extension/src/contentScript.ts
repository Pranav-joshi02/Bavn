console.log("✅ BAVN content script loaded");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("📩 Message received in content script:", msg);

  if (msg.action === "OPEN_SIDEBAR") {
    console.log("🚀 Opening sidebar");
    openSidebar();
  }
});


function openSidebar() {

  if (document.getElementById("bavn-sidebar")) return;

  const sidebar = document.createElement("div");
  sidebar.id = "bavn-sidebar";

  Object.assign(sidebar.style, {
    position: "fixed",
    right: "0",
    top: "0",
    width: "360px",
    height: "100vh",
    background: "#020617",
    color: "white",
    zIndex: "999999",
    padding: "12px",
    overflowY: "auto"
  });

  sidebar.innerHTML = `
    <h3>BAVN.io Assistant</h3>
    <div id="bavn-qa"></div>
    <button id="bavn-fill">Autofill</button>
  `;

  document.body.appendChild(sidebar);

  loadQuestions();

  document.getElementById("bavn-fill")!.onclick = autofillForm;
}

function loadQuestions() {

  const qa = document.getElementById("bavn-qa")!;
  qa.innerHTML = "";

  const blocks = document.querySelectorAll<HTMLElement>(".Qr7Oae");

  blocks.forEach((b, i) => {

    const q =
      b.querySelector(".M7eMe")?.textContent?.trim() ||
      `Question ${i + 1}`;

    qa.innerHTML += `
      <p style="font-size:13px">${q}</p>
      <textarea data-i="${i}" style="width:100%;margin-bottom:8px"></textarea>
    `;
  });
}

function autofillForm() {

  const blocks = document.querySelectorAll<HTMLElement>(".Qr7Oae");

  document.querySelectorAll<HTMLTextAreaElement>("#bavn-qa textarea")
    .forEach((t, i) => {

      const block = blocks[i];
      if (!block) return;

      const input =
        block.querySelector<HTMLInputElement>("input") ||
        block.querySelector<HTMLTextAreaElement>("textarea");

      if (input) {
        input.value = t.value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

  alert("Autofilled!");
}
