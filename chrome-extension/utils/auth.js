// ============================================
// BAVN.io — utils/auth.js
// Google OAuth via chrome.identity
// Token stored in chrome.storage.local
// ============================================
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js'

const TOKEN_KEY   = 'bavn_access_token'
const USER_KEY    = 'bavn_user'

// ── Save token ────────────────────────────
export async function saveToken(token, user) {
  await chrome.storage.local.set({ [TOKEN_KEY]: token, [USER_KEY]: user })
}

// ── Get stored token ──────────────────────
export async function getToken() {
  const result = await chrome.storage.local.get([TOKEN_KEY])
  return result[TOKEN_KEY] ?? null
}

// ── Get stored user ───────────────────────
export async function getUser() {
  const result = await chrome.storage.local.get([USER_KEY])
  return result[USER_KEY] ?? null
}

// ── Clear session (logout) ────────────────
export async function clearSession() {
  await chrome.storage.local.remove([TOKEN_KEY, USER_KEY])
}

// ── Sign in with Google via Supabase OAuth ─
export async function signInWithGoogle() {
  const redirectUrl = chrome.identity.getRedirectURL('callback')

  const oauthUrl =
    `${SUPABASE_URL}/auth/v1/authorize` +
    `?provider=google` +
    `&redirect_to=${encodeURIComponent(redirectUrl)}` +
    `&response_type=token` +
    `&scopes=email+profile`

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: oauthUrl, interactive: true },
      async (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          return reject(chrome.runtime.lastError?.message ?? 'Auth cancelled')
        }

        // Extract access_token from URL hash
        const hash = new URL(responseUrl).hash.slice(1)
        const params = new URLSearchParams(hash)
        const accessToken = params.get('access_token')

        if (!accessToken) return reject('No access token in response')

        // Get user info from Supabase
        const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: SUPABASE_ANON_KEY,
          },
        })
        const user = await res.json()

        await saveToken(accessToken, user)
        resolve({ token: accessToken, user })
      }
    )
  })
}

// ── Check if user is logged in ────────────
export async function isLoggedIn() {
  const token = await getToken()
  return !!token
}
