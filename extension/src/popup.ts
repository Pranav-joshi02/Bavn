import { supabase } from "./supabaseClient";
import "./auth";

console.log("✅ Popup loaded");

const status = document.getElementById("status")!;

// show login state
supabase.auth.getSession().then(({ data }) => {
  if (data.session) {
    chrome.storage.local.set({ session: data.session });
    status.textContent = "Logged in ✅";
  } else {
    status.textContent = "Not logged in";
  }
});


// ---------------- LOGIN ----------------

document.getElementById("login")?.addEventListener("click", async () => {

  console.log("LOGIN BUTTON CLICKED");

  const redirectUrl = chrome.identity.getRedirectURL();
  console.log("Redirect URL:", redirectUrl);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectUrl,
      skipBrowserRedirect: true
    }
  });

  if (error || !data?.url) {
    console.error("OAuth start error:", error);
    alert("Failed to start Google login");
    return;
  }

  chrome.identity.launchWebAuthFlow(
    { url: data.url, interactive: true },
    async (callbackUrl) => {

      console.log("OAuth callback:", callbackUrl);

      if (!callbackUrl) {
        alert("Login cancelled");
        return;
      }

      chrome.identity.launchWebAuthFlow(
  { url: data.url, interactive: true },
  async (callbackUrl) => {

    console.log("OAuth callback:", callbackUrl);

    if (!callbackUrl) {
      alert("Login cancelled");
      return;
    }

    const { data, error } = await supabase.auth.setSessionFromUrl({
  storeSession: true,
  url: callbackUrl
});

if (error) {
  console.error("Session error:", error);
  alert(error.message);
  return;
}

await new Promise<void>((resolve) => {
  chrome.storage.local.set({ session: data.session }, () => resolve());
});

status.textContent = "Logged in ✅";
alert("Login successful 🎉");
console.log("User:", data.session?.user.email);


    if (error) {
      console.error("Session error:", error);
      alert(error.message);
      return;
    }
    await new Promise<void>((resolve) => {
  chrome.storage.local.set(
    { session: data.session },
    () => resolve()
  );
});

    status.textContent = "Logged in ✅";
    alert("Login successful 🎉");
    console.log("User:", data.session?.user.email);
  }
);


      if (error) {
        console.error("Session error:", error);
        alert(error.message);
        return;
      }

      status.textContent = "Logged in ✅";
      alert("Login successful 🎉");
      console.log("User:", data.session?.user.email);
    }
  );
});

// ---------------- OPEN ASSISTANT ----------------

document.getElementById("open")?.addEventListener("click", () => {

  console.log("Open Assistant clicked");

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {

    console.log("Tabs:", tabs);

    if (!tabs[0]?.id) return;

    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      files: ["dist/contentScript.js"]
    }, () => {

      if (chrome.runtime.lastError) {
        console.error("Inject error:", chrome.runtime.lastError.message);
      } else {
        console.log("Script injected");
      }

      chrome.tabs.sendMessage(tabs[0].id!, { action: "OPEN_SIDEBAR" });

    });
  });
});
