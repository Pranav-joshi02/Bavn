console.log("✅ BAVN content script loaded");

chrome.runtime.onMessage.addListener((msg) => {
  console.log("📩 Message received in content script:", msg);

  if (msg.action === "OPEN_SIDEBAR") {
    openSidebar();
  }
});

// ================== SIDEBAR ==================

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
    overflowY: "auto",
    boxShadow: "0 0 12px rgba(0,0,0,0.6)"
  });

  // ✅ ADD UI
  sidebar.innerHTML = `
    <h3 style="margin-bottom:10px">BAVN.io Assistant</h3>
    <div id="bavn-qa"></div>
    <button id="bavn-ai" style="width:100%;margin-top:6px">🤖 Get AI Answers</button>
    <button id="bavn-fill" style="width:100%;margin-top:6px">⚡ Autofill</button>
  `;

  document.body.appendChild(sidebar);

  loadQuestions();

  document.getElementById("bavn-ai")!.addEventListener("click", getAIAnswers);
  document.getElementById("bavn-fill")!.addEventListener("click", autofillForm);
}

// ================== QUESTIONS ==================

function loadQuestions() {

  const qa = document.getElementById("bavn-qa")!;
  qa.innerHTML = "";

  const blocks = document.querySelectorAll<HTMLElement>(".Qr7Oae");

  blocks.forEach((block, index) => {

    const q =
      block.querySelector(".M7eMe")?.textContent?.trim() ||
      `Question ${index + 1}`;

    qa.innerHTML += `
      <p style="font-size:13px;margin-bottom:4px">${q}</p>
      <textarea data-index="${index}"
        style="width:100%;border-radius:8px;padding:6px;margin-bottom:10px"></textarea>
    `;
  });
}

// ================== AI CALL ==================

async function getAIAnswers() {

  const session = await new Promise<any>((resolve) => {
    chrome.storage.local.get(["session"], (res) => resolve(res.session));
  });

  if (!session?.access_token) {
    alert("Please login first from extension popup.");
    return;
  }

  const questions = Array.from(
    document.querySelectorAll("#bavn-qa p")
  ).map(p => p.textContent || "");

  const res = await fetch("http://localhost:4000/api/answers", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${session.access_token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ questions })
  });

  const data = await res.json();

  document.querySelectorAll<HTMLTextAreaElement>("#bavn-qa textarea")
    .forEach((t, i) => t.value = data.answers?.[i] || "");
}

// ================== AUTOFILL ==================

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

  alert("Form autofilled ✅");
}
