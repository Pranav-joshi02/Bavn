// ============================================
// BAVN.io — popup.js
// Handles login UI and dashboard in popup
// NOTE: No ES module imports here (popup scripts
//       run in their own context). Uses chrome.runtime.sendMessage
//       to talk to background.js for auth.
// ============================================

const loginView      = document.getElementById('login-view')
const dashView       = document.getElementById('dashboard-view')
const btnLogin       = document.getElementById('btn-login')
const btnLogout      = document.getElementById('btn-logout')
const btnOpenSidebar = document.getElementById('btn-open-sidebar')
const loginStatus    = document.getElementById('login-status')
const dashStatus     = document.getElementById('dash-status')
const spinner        = document.getElementById('spinner')
const userNameEl     = document.getElementById('user-name')
const userEmailEl    = document.getElementById('user-email')

function setStatus(el, msg, type = '') {
  el.textContent  = msg
  el.className    = `status ${type}`
}

function setLoading(on) {
  spinner.style.display = on ? 'block' : 'none'
  btnLogin.disabled     = on
}

// ── Init: check auth state ────────────────
async function init() {
  const { loggedIn, user } = await chrome.runtime.sendMessage({ type: 'GET_AUTH' })
  if (loggedIn && user) {
    showDashboard(user)
  } else {
    loginView.style.display  = 'flex'
    dashView.style.display   = 'none'
  }
}

function showDashboard(user) {
  loginView.style.display  = 'none'
  dashView.style.display   = 'flex'
  userNameEl.textContent   = user.user_metadata?.full_name ?? user.email ?? 'User'
  userEmailEl.textContent  = user.email ?? ''
}

// ── Login ─────────────────────────────────
btnLogin.addEventListener('click', async () => {
  setLoading(true)
  setStatus(loginStatus, 'Opening Google sign-in…')
  try {
    const { user } = await chrome.runtime.sendMessage({ type: 'LOGIN' })
    showDashboard(user)
  } catch (err) {
    setStatus(loginStatus, err.message ?? 'Login failed', 'error')
  } finally {
    setLoading(false)
  }
})

// ── Open Sidebar ──────────────────────────
btnOpenSidebar.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'OPEN_SIDEBAR' })
  setStatus(dashStatus, 'Sidebar opened ✓', 'success')
  setTimeout(() => window.close(), 800)
})

// ── Logout ────────────────────────────────
btnLogout.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'LOGOUT' })
  dashView.style.display  = 'none'
  loginView.style.display = 'flex'
  setStatus(loginStatus, '')
})

init()
