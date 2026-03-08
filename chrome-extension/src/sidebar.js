// ============================================
// BAVN.io — sidebar.js
// ============================================

const API_BASE = 'https://bavn-backend.onrender.com'   // ← swap to Railway URL after deploy

// ── Sensitive fields — off by default ─────
const SENSITIVE_FIELDS = ['email', 'phone', 'linkedin']

// ── Storage helpers ───────────────────────
async function getToken() {
  const r = await chrome.storage.local.get(['bavn_access_token'])
  return r.bavn_access_token ?? null
}

async function getAIFields() {
  const r = await chrome.storage.local.get(['bavn_ai_fields'])
  // Default: all non-sensitive fields enabled
  return r.bavn_ai_fields ?? ['name', 'college', 'degree', 'graduation_year', 'resume']
}

async function saveAIFields(fields) {
  await chrome.storage.local.set({ bavn_ai_fields: fields })
}

// ── API helper ────────────────────────────
async function api(method, path, body = null) {
  const token = await getToken()
  if (!token) throw new Error('Not logged in')
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

function setStatus(el, msg, type = '') {
  if (!el) return
  el.textContent = msg
  el.className   = `status-bar ${type}`
}

// ── INIT ──────────────────────────────────
async function init() {
  try {
    const { loggedIn } = await chrome.runtime.sendMessage({ type: 'GET_AUTH' })
    if (loggedIn) { showApp(); scanPage() }
    else showLogin()
  } catch (e) {
    console.error('[BAVN]', e)
    showLogin()
  }
}

function showLogin() {
  document.getElementById('login-view').style.display = 'flex'
  document.getElementById('app-view').style.display   = 'none'
}
function showApp() {
  document.getElementById('login-view').style.display = 'none'
  document.getElementById('app-view').style.display   = 'flex'
}

// ── LOGIN ─────────────────────────────────
document.getElementById('btn-login').addEventListener('click', async () => {
  const btn    = document.getElementById('btn-login')
  const status = document.getElementById('login-status')
  btn.disabled = true
  btn.textContent = 'Signing in…'
  status.textContent = ''
  try {
    const result = await chrome.runtime.sendMessage({ type: 'LOGIN' })
    if (result.error) throw new Error(result.error)
    showApp(); scanPage()
  } catch (err) {
    status.textContent = err.message ?? 'Login failed'
    status.style.color = '#ff6b6b'
    btn.textContent = 'Continue with Google'
  } finally {
    btn.disabled = false
  }
})

document.getElementById('btn-logout').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'LOGOUT' })
  showLogin()
})

// ── TABS ──────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t   => t.classList.remove('active'))
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'))
    tab.classList.add('active')
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active')
    if (tab.dataset.tab === 'memory')  loadMemory()
    if (tab.dataset.tab === 'profile') loadProfile()
  })
})

// ── STATE ─────────────────────────────────
let currentQuestions = []
let currentAnswers   = []
let currentUrl       = ''

// ── AUTOFILL ──────────────────────────────
async function scanPage() {
  const qList = document.getElementById('question-list')
  if (!qList) return
  qList.innerHTML = skeletons(3)
  document.getElementById('btn-fill').disabled = true
  try {
    const [tab]      = await chrome.tabs.query({ active: true, currentWindow: true })
    const response   = await chrome.tabs.sendMessage(tab.id, { type: 'GET_QUESTIONS' })
    currentQuestions = response?.questions ?? []
    currentUrl       = response?.url ?? ''
    document.getElementById('current-url').textContent = currentUrl || 'Unknown page'
    renderQuestions(currentQuestions)
  } catch {
    document.getElementById('question-list').innerHTML =
      `<div class="empty-state"><div class="empty-icon">⚠️</div>Could not scan page.<br>Refresh the tab and try again.</div>`
  }
}

function renderQuestions(questions) {
  const qList = document.getElementById('question-list')
  if (!questions.length) {
    qList.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div>No form fields detected.<br>Navigate to a form and click Rescan.</div>`
    return
  }
  qList.innerHTML = questions.map(q => `
    <div class="q-card" data-q="${escAttr(q)}">
      <div class="q-label">${escHtml(q)}</div>
      <div class="q-answer empty">—</div>
    </div>
  `).join('')
}

function renderAnswers(results) {
  results.forEach(({ question, answer, fromMemory }) => {
    const card = document.querySelector(`[data-q="${escAttr(question)}"]`)
    if (!card) return
    const ansEl = card.querySelector('.q-answer')
    ansEl.textContent = answer
    ansEl.classList.remove('empty')
    card.classList.add(fromMemory ? 'from-memory' : 'filled')
    const badge = document.createElement('div')
    badge.className   = `q-badge ${fromMemory ? 'memory' : 'generated'}`
    badge.textContent = fromMemory ? '↩ memory' : '✦ generated'
    card.insertBefore(badge, ansEl)
  })
  document.getElementById('btn-fill').disabled = false
}

document.getElementById('btn-generate').addEventListener('click', async () => {
  if (!currentQuestions.length) {
    setStatus(document.getElementById('autofill-status'), 'No questions — click Rescan first', 'error')
    return
  }
  const btn = document.getElementById('btn-generate')
  btn.disabled = true
  setStatus(document.getElementById('autofill-status'), '✦ Generating answers…')
  try {
    const allowedFields = await getAIFields()
    const { results }   = await api('POST', '/api/answers', {
      questions: currentQuestions,
      sourceUrl: currentUrl,
      allowedFields,
    })
    currentAnswers = results
    renderAnswers(results)
    setStatus(document.getElementById('autofill-status'), `${results.length} answers ready ✓`, 'success')
  } catch (err) {
    setStatus(document.getElementById('autofill-status'), err.message, 'error')
  } finally {
    btn.disabled = false
  }
})

document.getElementById('btn-fill').addEventListener('click', async () => {
  if (!currentAnswers.length) return
  await chrome.runtime.sendMessage({ type: 'FILL_FIELDS', answers: currentAnswers })
  setStatus(document.getElementById('autofill-status'), 'Fields filled ✓', 'success')
})

document.getElementById('btn-rescan').addEventListener('click', scanPage)

// ── MEMORY ────────────────────────────────
async function loadMemory() {
  const memList = document.getElementById('memory-list')
  memList.innerHTML = skeletons(3)
  try {
    const { answers } = await api('GET', '/api/memory')
    if (!answers.length) {
      memList.innerHTML = `<div class="empty-state"><div class="empty-icon">🧠</div>No saved answers yet.</div>`
      return
    }
    memList.innerHTML = answers.map(a => `
      <div class="mem-card" data-id="${a.id}">
        <div class="mem-q">${escHtml(a.question)}</div>
        <div class="mem-a">${escHtml(a.answer)}</div>
        <div class="mem-meta">${new Date(a.created_at).toLocaleDateString()}</div>
        <button class="mem-del" data-id="${a.id}">×</button>
      </div>
    `).join('')
    document.querySelectorAll('.mem-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api('DELETE', `/api/memory/${btn.dataset.id}`)
        btn.closest('.mem-card').remove()
      })
    })
  } catch (err) {
    document.getElementById('memory-list').innerHTML =
      `<div class="empty-state">Error: ${escHtml(err.message)}</div>`
  }
}

// ── PROFILE ───────────────────────────────
const PROFILE_FIELDS = [
  { key: 'name',            label: 'Full Name',       type: 'text',     sensitive: false },
  { key: 'email',           label: 'Email',           type: 'email',    sensitive: true  },
  { key: 'phone',           label: 'Phone',           type: 'tel',      sensitive: true  },
  { key: 'college',         label: 'College',         type: 'text',     sensitive: false },
  { key: 'degree',          label: 'Degree',          type: 'text',     sensitive: false },
  { key: 'graduation_year', label: 'Graduation Year', type: 'number',   sensitive: false },
  { key: 'linkedin',        label: 'LinkedIn URL',    type: 'url',      sensitive: true  },
  { key: 'resume',          label: 'Resume / Bio',    type: 'textarea', sensitive: false },
]

async function loadProfile() {
  document.getElementById('profile-form').innerHTML = skeletons(4, '52px')
  try {
    const { profile }    = await api('GET', '/api/profile')
    const allowedFields  = await getAIFields()
    renderProfileForm(profile ?? {}, allowedFields)
  } catch {
    renderProfileForm({}, await getAIFields())
  }
}

function renderProfileForm(profile, allowedFields) {
  document.getElementById('profile-form').innerHTML = `
    <div class="privacy-note">
      🔒 Toggle which fields the AI can see when generating answers.
      Sensitive fields are <span style="color:#ff6b35">off by default</span>.
    </div>
    ${PROFILE_FIELDS.map(f => `
      <div class="field-group">
        <div class="field-header">
          <label class="field-label" for="pf-${f.key}">${f.label}</label>
          <label class="toggle-wrap" title="${f.sensitive ? '⚠ Sensitive field' : 'Safe field'}">
            <input
              type="checkbox"
              class="ai-toggle"
              data-field="${f.key}"
              ${allowedFields.includes(f.key) ? 'checked' : ''}
            >
            <span class="toggle-label">AI</span>
          </label>
        </div>
        ${f.type === 'textarea'
          ? `<textarea class="field-input" rows="4" id="pf-${f.key}">${escHtml(profile[f.key] ?? '')}</textarea>`
          : `<input class="field-input" type="${f.type}" id="pf-${f.key}" value="${escAttr(profile[f.key] ?? '')}">`
        }
      </div>
    `).join('')}
  `

  // Save toggle state immediately on change
  document.querySelectorAll('.ai-toggle').forEach(toggle => {
    toggle.addEventListener('change', async () => {
      const checked = [...document.querySelectorAll('.ai-toggle')]
        .filter(t => t.checked)
        .map(t => t.dataset.field)
      await saveAIFields(checked)
      showPrivacySummary(checked)
    })
  })

  showPrivacySummary(allowedFields)
}

function showPrivacySummary(allowedFields) {
  const sensitive = PROFILE_FIELDS
    .filter(f => f.sensitive && allowedFields.includes(f.key))
    .map(f => f.label)

  const el = document.getElementById('privacy-summary')
  if (!el) return
  if (sensitive.length === 0) {
    el.textContent = '✓ No sensitive fields shared with AI'
    el.style.color = '#7dff6b'
  } else {
    el.textContent = `⚠ AI can see: ${sensitive.join(', ')}`
    el.style.color = '#ff6b35'
  }
}

document.getElementById('btn-save-profile').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-profile')
  btn.disabled = true
  setStatus(document.getElementById('profile-status'), 'Saving…')
  const data = {}
  PROFILE_FIELDS.forEach(f => {
    const el = document.getElementById(`pf-${f.key}`)
    data[f.key] = el?.value?.trim() || null
  })
  try {
    await api('POST', '/api/profile', data)
    setStatus(document.getElementById('profile-status'), 'Profile saved ✓', 'success')
  } catch (err) {
    setStatus(document.getElementById('profile-status'), err.message, 'error')
  } finally {
    btn.disabled = false
  }
})

// ── UTILS ─────────────────────────────────
function skeletons(n, height = '70px') {
  return Array(n).fill(`<div class="skeleton" style="height:${height};margin-bottom:8px"></div>`).join('')
}
function escAttr(str) { return String(str ?? '').replace(/"/g,'&quot;') }
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

init()

// ── LEARN PANEL ───────────────────────────
const learnList   = document.getElementById('learn-list')
const learnStatus = document.getElementById('learn-status')

let learnItems = []   // { question, answer, saved }

function renderLearnItems(items) {
  learnItems = items
  if (!items.length) {
    learnList.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div>No filled answers found.<br>Fill some fields on the form first.</div>`
    return
  }
  learnList.innerHTML = items.map((item, i) => `
    <div class="learn-card" id="learn-card-${i}">
      <div class="learn-q">${escHtml(item.question)}</div>
      <div class="learn-a">
        <textarea id="learn-ans-${i}" rows="3">${escHtml(item.answer)}</textarea>
      </div>
      <div class="learn-actions">
        <button class="btn-save-learn" data-index="${i}">✓ Save to memory</button>
        <button class="btn-discard"    data-index="${i}">Discard</button>
      </div>
    </div>
  `).join('')

  // Save button
  learnList.querySelectorAll('.btn-save-learn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i        = parseInt(btn.dataset.index)
      const question = learnItems[i].question
      const answer   = document.getElementById(`learn-ans-${i}`)?.value?.trim()
      if (!answer) return

      btn.disabled     = true
      btn.textContent  = 'Saving…'

      try {
        // Save directly to answers table via backend
        await api('POST', '/api/memory/manual', { question, answer })
        const card = document.getElementById(`learn-card-${i}`)
        card.classList.add('saved')
        card.querySelector('.learn-actions').innerHTML =
          `<div class="saved-badge">✓ Saved to memory</div>`
        setStatus(learnStatus, 'Answer saved ✓', 'success')
      } catch (err) {
        btn.disabled    = false
        btn.textContent = '✓ Save to memory'
        setStatus(learnStatus, err.message, 'error')
      }
    })
  })

  // Discard button
  learnList.querySelectorAll('.btn-discard').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(`learn-card-${btn.dataset.index}`)?.remove()
    })
  })
}

// Read filled values from page
document.getElementById('btn-read-page').addEventListener('click', async () => {
  const btn = document.getElementById('btn-read-page')
  btn.disabled    = true
  btn.textContent = 'Reading page…'
  setStatus(learnStatus, '')

  try {
    const [tab]    = await chrome.tabs.query({ active: true, currentWindow: true })
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'READ_FILLED' })
    const filled   = response?.filled ?? []

    if (!filled.length) {
      setStatus(learnStatus, 'No filled answers found on page', 'error')
    } else {
      renderLearnItems(filled)
      setStatus(learnStatus, `${filled.length} answers found — review and save`, 'success')
    }
  } catch (err) {
    setStatus(learnStatus, 'Could not read page: ' + err.message, 'error')
  } finally {
    btn.disabled    = false
    btn.textContent = '↑ Read answers from page'
  }
})

// Manual add form
document.getElementById('btn-add-manual').addEventListener('click', () => {
  // Toggle manual form
  const existing = document.getElementById('manual-add-form')
  if (existing) { existing.remove(); return }

  const form = document.createElement('div')
  form.id        = 'manual-add-form'
  form.className = 'manual-form'
  form.innerHTML = `
    <div class="manual-label">Question</div>
    <input type="text" id="manual-q" placeholder="e.g. Why do you want this role?">
    <div class="manual-label">Your Answer</div>
    <textarea id="manual-a" rows="4" placeholder="Type your answer here…"></textarea>
    <button class="btn-save-learn" id="btn-save-manual">✓ Save to memory</button>
  `
  learnList.prepend(form)

  document.getElementById('btn-save-manual').addEventListener('click', async () => {
    const question = document.getElementById('manual-q')?.value?.trim()
    const answer   = document.getElementById('manual-a')?.value?.trim()

    if (!question || !answer) {
      setStatus(learnStatus, 'Both question and answer are required', 'error')
      return
    }

    const btn    = document.getElementById('btn-save-manual')
    btn.disabled = true
    btn.textContent = 'Saving…'

    try {
      await api('POST', '/api/memory/manual', { question, answer })
      form.innerHTML = `<div class="saved-badge" style="padding:12px;">✓ Saved to memory — "${question.slice(0,50)}${question.length>50?'…':''}"</div>`
      setStatus(learnStatus, 'Answer saved to memory ✓', 'success')
    } catch (err) {
      btn.disabled    = false
      btn.textContent = '✓ Save to memory'
      setStatus(learnStatus, err.message, 'error')
    }
  })
})