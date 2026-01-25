import { supabase } from "./supabaseClient";

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) {
    chrome.storage.local.set({ session });
  }
});
