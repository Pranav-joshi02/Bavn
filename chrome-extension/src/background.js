// ============================================
// BAVN.io — background.js  (Service Worker)
// Original redirect flow — simple and clean
// ============================================

const SUPABASE_URL      = 'https://zfqebdsoyglymmmiztbi.supabase.co'   // ← fill in
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpmcWViZHNveWdseW1tbWl6dGJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NjA2MDgsImV4cCI6MjA4ODQzNjYwOH0.bpbtMbAgzKMghS_ZXoJDVJehLj-dz9cN1Ek7NYI0HZg'                   // ← fill in

const TOKEN_KEY = 'bavn_access_token'
const USER_KEY  = 'bavn_user'

// ── Side panel on icon click ───────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)
})

// ── Storage helpers ────────────────────────
async function getToken() {
  const r = await chrome.storage.local.get([TOKEN_KEY])
  return r[TOKEN_KEY] ?? null
}
async function getUser() {
  const r = await chrome.storage.local.get([USER_KEY])
  return r[USER_KEY] ?? null
}
async function saveToken(token, user) {
  await chrome.storage.local.set({ [TOKEN_KEY]: token, [USER_KEY]: user })
}
async function clearSession() {
  await chrome.storage.local.remove([TOKEN_KEY, USER_KEY])
}

// ── Sign in via Supabase redirect ──────────
async function signInWithGoogle() {
  const redirectUrl = chrome.identity.getRedirectURL()
  console.log('[BAVN] Redirect URL:', redirectUrl)

  // This is the Supabase OAuth URL — Supabase handles Google, returns token to our redirect
  const oauthUrl =
    `${SUPABASE_URL}/auth/v1/authorize` +
    `?provider=google` +
    `&redirect_to=${encodeURIComponent(redirectUrl)}`

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: oauthUrl, interactive: true },
      async (responseUrl) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message))
        }
        if (!responseUrl) {
          return reject(new Error('Auth was cancelled'))
        }

        console.log('[BAVN] Response URL:', responseUrl)

        // Supabase returns token in the URL hash
        let accessToken  = null
        let refreshToken = null

        try {
          const url   = new URL(responseUrl)
          // Try hash first (#access_token=...)
          const hash  = new URLSearchParams(url.hash.replace('#', ''))
          accessToken  = hash.get('access_token')
          refreshToken = hash.get('refresh_token')

          // Fallback: try query params (?access_token=...)
          if (!accessToken) {
            accessToken  = url.searchParams.get('access_token')
            refreshToken = url.searchParams.get('refresh_token')
          }
        } catch (e) {
          return reject(new Error('Could not parse response URL: ' + e.message))
        }

        if (!accessToken) {
          console.error('[BAVN] Full response URL:', responseUrl)
          return reject(new Error('No access_token found in response. Check console for full URL.'))
        }

        console.log('[BAVN] Got access token ✓')

        // Get user info from Supabase
        try {
          const res  = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              apikey: SUPABASE_ANON_KEY,
            },
          })
          const user = await res.json()
          console.log('[BAVN] Logged in as:', user.email)
          await saveToken(accessToken, user)
          resolve({ token: accessToken, user })
        } catch (e) {
          reject(new Error('Failed to get user info: ' + e.message))
        }
      }
    )
  })
}

// ── Message router ─────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg).then(sendResponse).catch(err => {
    console.error('[BAVN] Error:', err.message)
    sendResponse({ error: err.message })
  })
  return true
})

async function handle(msg) {
  switch (msg.type) {

    case 'GET_AUTH': {
      const token = await getToken()
      const user  = await getUser()
      return { token, user, loggedIn: !!token }
    }

    case 'LOGIN': {
      const result = await signInWithGoogle()
      return { success: true, user: result.user }
    }

    case 'LOGOUT': {
      await clearSession()
      return { success: true }
    }

    case 'FILL_FIELDS': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab) chrome.tabs.sendMessage(tab.id, { type: 'DO_FILL', answers: msg.answers })
      return { success: true }
    }

    default:
      return { error: `Unknown type: ${msg.type}` }
  }
}