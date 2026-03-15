// ============================================
// BAVN.io — sidebar.js
// ============================================

const API_BASE = 'https://bavn-backend.onrender.com'

// ── Self-contained QR Code renderer ──────
// No external library needed — pure canvas
// Minimal QR encoder for alphanumeric + byte mode

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
    if (loggedIn) { showApp(); showTelegramBanner(); scanPage() }
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

const TG_BOT_USERNAME = 'bavn_bot' // ← update this to your bot username after setup

function showApp(firstTime = false) {
  document.getElementById('login-view').style.display = 'none'
  document.getElementById('app-view').style.display   = 'flex'
  if (firstTime) showTelegramBanner()
}

function showTelegramBanner() {
  // Don't show banner if already dismissed
  chrome.storage.local.get(['bavn_tg_banner_dismissed'], ({ bavn_tg_banner_dismissed }) => {
    if (bavn_tg_banner_dismissed) return
    const banner = document.getElementById('tg-banner')
    if (banner) banner.style.display = 'flex'
  })
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
    showApp(true); scanPage() // firstTime = true shows Telegram banner
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

// ── TELEGRAM BANNER ───────────────────────
document.getElementById('tg-banner-btn')?.addEventListener('click', (e) => {
  e.preventDefault()
  chrome.tabs.create({ url: `https://t.me/${TG_BOT_USERNAME}` })
})
document.getElementById('tg-banner-dismiss')?.addEventListener('click', () => {
  document.getElementById('tg-banner').style.display = 'none'
  chrome.storage.local.set({ bavn_tg_banner_dismissed: true })
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

// Render a single answer card as it streams in
function renderSingleAnswer({ idx, question, answer, source }) {
  const card = document.querySelector(`[data-q="${escAttr(question)}"]`)
  if (!card) return
  const ansEl  = card.querySelector('.q-answer')
  const fromMem = source === 'memory'
  ansEl.textContent = answer
  ansEl.classList.remove('empty')
  card.classList.remove('generating')
  card.classList.add(fromMem ? 'from-memory' : 'filled')
  if (!card.querySelector('.q-badge')) {
    const badge = document.createElement('div')
    badge.className   = `q-badge ${fromMem ? 'memory' : 'generated'}`
    badge.textContent = fromMem ? '↩ memory' : '✦ generated'
    card.insertBefore(badge, ansEl)
  }
  // Update fill fraction live
  const filled = document.querySelectorAll('.q-card.filled, .q-card.from-memory').length
  const total  = currentQuestions.length
  document.getElementById('fill-fraction').textContent = `${filled} of ${total}`
  if (filled === total) document.getElementById('btn-fill').disabled = false
}

function renderAnswers(results) {
  results.forEach(r => r && renderSingleAnswer(r))
  document.getElementById('btn-fill').disabled = false
}

document.getElementById('btn-generate').addEventListener('click', async () => {
  if (!currentQuestions.length) {
    setStatus(document.getElementById('autofill-status'), 'No questions — click Rescan first', 'error')
    return
  }
  const btn       = document.getElementById('btn-generate')
  const statusEl  = document.getElementById('autofill-status')
  const bar       = document.getElementById('progress-bar')
  btn.disabled    = true
  bar.classList.add('active')

  // Mark all cards as generating immediately (optimistic UI)
  document.querySelectorAll('.q-card').forEach(c => {
    if (!c.classList.contains('filled') && !c.classList.contains('from-memory')) {
      c.classList.add('generating')
    }
  })
  setStatus(statusEl, '✦ Generating answers…')

  try {
    const token         = await getToken()
    const allowedFields = await getAIFields()

    // ── Try streaming first ───────────────────
    const res = await fetch(`${API_BASE}/api/answers?stream=true`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        questions: currentQuestions,
        sourceUrl: currentUrl,
        allowedFields,
      })
    })

    if (res.ok && res.headers.get('content-type')?.includes('text/event-stream')) {
      // ── Streaming path — answers pop in one by one ──
      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ''
      let   count   = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = JSON.parse(line.slice(6))
          if (payload.done) {
            bar.classList.remove('active')
            setStatus(statusEl, `✓ ${currentAnswers.filter(Boolean).length} answers ready`, 'success')
            btn.disabled = false
            return
          }
          currentAnswers[payload.idx] = payload
          renderSingleAnswer(payload)
          count++
          setStatus(statusEl, `✦ ${count} of ${currentQuestions.length} answers ready…`)
        }
      }

    } else {
      // ── Fallback: non-streaming ───────────────
      const data = await res.json()
      currentAnswers = data.results
      renderAnswers(data.results)
      setStatus(statusEl, `✓ ${data.results.length} answers ready${data.fromCache ? ' (cached)' : ''}`, 'success')
    }

  } catch (err) {
    setStatus(document.getElementById('autofill-status'), err.message, 'error')
    document.querySelectorAll('.q-card.generating').forEach(c => c.classList.remove('generating'))
  } finally {
    btn.disabled = false
    bar.classList.remove('active')
  }
})

document.getElementById('btn-fill').addEventListener('click', async () => {
  if (!currentAnswers.length) return
  const btn     = document.getElementById('btn-fill')
  const statusEl= document.getElementById('autofill-status')
  const bar     = document.getElementById('progress-bar')
  btn.disabled  = true
  bar.classList.add('active')
  setStatus(statusEl, '↓ Filling form…')

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

    // Use FILL_AND_ADVANCE — handles multi-page forms automatically
    const result = await chrome.tabs.sendMessage(tab.id, {
      type:    'FILL_AND_ADVANCE',
      answers: currentAnswers.filter(Boolean)
    })

    if (result?.lastPage && result?.submitBtn) {
      setStatus(statusEl, '✓ All pages filled — review and submit ✓', 'success')
    } else {
      setStatus(statusEl, '✓ Form filled ✓', 'success')
    }
  } catch (err) {
    setStatus(document.getElementById('autofill-status'), err.message, 'error')
  } finally {
    btn.disabled = false
    bar.classList.remove('active')
  }
})

document.getElementById('btn-rescan').addEventListener('click', scanPage)

// ── MEMORY ────────────────────────────────
// ── Local in-memory cache (session-scoped) ─
const localCache = {
  memory:  null,
  profile: null,
  memoryTs:  0,
  profileTs: 0,
  TTL: 5 * 60 * 1000  // 5 min
}

async function loadMemory(forceRefresh = false) {
  const memList = document.getElementById('memory-list')

  // Show cached instantly while refreshing in background
  if (localCache.memory && !forceRefresh) {
    renderMemoryList(localCache.memory)
    // Refresh in background if older than TTL
    if (Date.now() - localCache.memoryTs > localCache.TTL) {
      fetchMemory().catch(() => {})
    }
    return
  }

  memList.innerHTML = skeletons(3)
  await fetchMemory()
}

async function fetchMemory() {
  const memList = document.getElementById('memory-list')
  try {
    const { answers } = await api('GET', '/api/memory')
    localCache.memory   = answers
    localCache.memoryTs = Date.now()
    renderMemoryList(answers)
  } catch (err) {
    if (!localCache.memory)
      document.getElementById('memory-list').innerHTML =
        `<div class="empty-state">Error: ${escHtml(err.message)}</div>`
  }
}

function renderMemoryList(answers) {
  const memList = document.getElementById('memory-list')
  if (!answers.length) {
    memList.innerHTML = `<div class="empty-state"><div class="empty-icon">🧠</div>No saved answers yet.</div>`
    return
  }
  const DOMAIN_COLORS = {
    'internshala': '#ff6b35', 'linkedin': '#0a66c2', 'naukri': '#ff6633',
    'unstop': '#7c3aed', 'google': '#4285f4', 'amazon': '#ff9900',
    'swiggy': '#fc8019', 'zomato': '#e23744'
  }
  memList.innerHTML = answers.map(a => {
    const domain = a.source_url ? new URL(a.source_url).hostname.replace('www.','').split('.')[0] : ''
    const color  = DOMAIN_COLORS[domain] || '#4d8f99'
    const fav    = domain ? `<span class="mem-fav" style="background:${color};color:#fff">${domain[0].toUpperCase()}</span>` : ''
    const meta   = [fav, domain, '·', new Date(a.created_at).toLocaleDateString()].filter(Boolean).join(' ')
    return `
      <div class="mem-card" data-id="${a.id}">
        <div class="mem-q">${escHtml(a.question)}</div>
        <div class="mem-a">${escHtml(a.answer)}</div>
        <div class="mem-meta">${meta}</div>
        <button class="mem-del" data-id="${a.id}">×</button>
      </div>`
  }).join('')
  document.querySelectorAll('.mem-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api('DELETE', `/api/memory/${btn.dataset.id}`)
      btn.closest('.mem-card').remove()
      localCache.memory = localCache.memory?.filter(a => a.id !== btn.dataset.id)
    })
  })
}

// ── PROFILE ───────────────────────────────
const PROFILE_FIELDS = [
  { key: 'name',            label: 'Full Name',       type: 'text',     sensitive: false },
  { key: 'email',           label: 'Email',           type: 'email',    sensitive: true  },
  { key: 'phone',           label: 'Phone',           type: 'tel',      sensitive: true  },
  { key: 'telegram_id',     label: 'Telegram ID',     type: 'text',     sensitive: false },
  { key: 'college',         label: 'College',         type: 'text',     sensitive: false },
  { key: 'degree',          label: 'Degree',          type: 'text',     sensitive: false },
  { key: 'graduation_year', label: 'Graduation Year', type: 'number',   sensitive: false },
  { key: 'linkedin',        label: 'LinkedIn URL',    type: 'url',      sensitive: true  },
  { key: 'resume',          label: 'Resume / Bio',    type: 'textarea', sensitive: false },
]

async function loadProfile(forceRefresh = false) {
  // Show cached instantly
  if (localCache.profile && !forceRefresh) {
    renderProfileForm(localCache.profile, await getAIFields())
    if (Date.now() - localCache.profileTs > localCache.TTL) {
      fetchProfile().catch(() => {})
    }
    return
  }
  document.getElementById('profile-form').innerHTML = skeletons(4, '52px')
  await fetchProfile()
}

async function fetchProfile() {
  try {
    const { profile } = await api('GET', '/api/profile')
    localCache.profile   = profile ?? {}
    localCache.profileTs = Date.now()
    renderProfileForm(localCache.profile, await getAIFields())
  } catch {
    renderProfileForm(localCache.profile ?? {}, await getAIFields())
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
    localCache.profile   = data      // update cache immediately
    localCache.profileTs = Date.now()
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

// ── TELEGRAM FILL JOB POLLER ──────────────
// Polls backend every 5s for jobs pushed from Telegram bot
// When a job arrives, auto-fills the current form tab
let fillJobPollTimer = null

async function startFillJobPoller() {
  if (fillJobPollTimer) return  // already running
  fillJobPollTimer = setInterval(checkFillJob, 5000)
  console.log('[BAVN] Fill job poller started')
}

async function checkFillJob() {
  try {
    const data = await api('GET', '/api/telegram/fill-jobs')
    const job  = data?.job
    if (!job) return

    console.log('[BAVN] Fill job received:', job.id)

    // Get current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab) return

    // Check if tab URL matches job URL (loose match — same domain)
    const jobDomain = new URL(job.form_url).hostname
    const tabDomain = new URL(tab.url).hostname
    const isMatch   = tabDomain.includes(jobDomain) || jobDomain.includes(tabDomain)

    if (!isMatch) {
      // Show notification that job is waiting
      showFillJobBanner(job)
      return
    }

    // Fill the form
    await chrome.tabs.sendMessage(tab.id, {
      type:    'FILL_AND_ADVANCE',
      answers: job.answers
    })

    // Save answers to memory (same DB as Telegram)
    try {
      await api('POST', '/api/answers', {
        questions: job.answers.map(a => a.question),
        sourceUrl: job.form_url,
        allowedFields: await getAIFields(),
      })
    } catch(e) {
      // Save manually if generate endpoint fails
      for (const a of job.answers) {
        await api('POST', '/api/memory/manual', {
          question: a.question,
          answer:   a.answer,
        }).catch(() => {})
      }
    }

    // Mark job as done
    await api('POST', `/api/telegram/fill-jobs/${job.id}/done`, {})

    // Update UI
    currentAnswers   = job.answers
    currentQuestions = job.answers.map(a => a.question)
    renderAnswers(job.answers)
    setStatus(document.getElementById('autofill-status'), '✓ Filled from Telegram ✓', 'success')

    // Invalidate memory cache so Memory tab shows latest
    localCache.memory   = null
    localCache.memoryTs = 0

    hideFillJobBanner()

  } catch(e) {
    // Silent fail — poller keeps running
  }
}

function showFillJobBanner(job) {
  let banner = document.getElementById('fill-job-banner')
  if (!banner) {
    banner = document.createElement('div')
    banner.id = 'fill-job-banner'
    banner.style.cssText = `
      position:fixed;bottom:0;left:0;right:0;z-index:999;
      background:#006d77;color:#fff;padding:10px 14px;
      display:flex;align-items:center;gap:10px;font-size:10px;
    `
    document.body.appendChild(banner)
  }
  const domain = new URL(job.form_url).hostname.replace('www.','')
  banner.innerHTML = `
    <div style="flex:1">📋 Telegram job ready — open <b>${domain}</b> to auto-fill</div>
    <button onclick="dismissFillJob('${job.id}')"
      style="background:rgba(255,255,255,0.2);border:none;color:#fff;
      padding:4px 10px;font-family:inherit;font-size:9px;cursor:pointer;
      letter-spacing:1px;text-transform:uppercase;">Dismiss</button>
  `
}

async function dismissFillJob(jobId) {
  hideFillJobBanner()
  await api('POST', `/api/telegram/fill-jobs/${jobId}/done`, {})
}

function hideFillJobBanner() {
  document.getElementById('fill-job-banner')?.remove()
}

// Start poller when logged in
document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.sendMessage({ type: 'GET_AUTH' }).then(({ loggedIn }) => {
    if (loggedIn) startFillJobPoller()
  }).catch(() => {})
})

// ── TELEGRAM SCRAPE JOB POLLER ────────────
// Polls for scrape jobs from Telegram bot
// When found: opens URL in tab, extracts questions, sends back
async function checkScrapeJob() {
  try {
    const data = await api('GET', '/api/telegram/scrape-jobs')
    const job  = data?.job
    if (!job) return

    console.log('[BAVN] Scrape job received:', job.id, job.form_url)

    // Open the form URL in a new tab
    const tab = await chrome.tabs.create({ url: job.form_url, active: true })

    // Wait for page to load
    await new Promise(resolve => {
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener)
          resolve()
        }
      })
      // Fallback timeout
      setTimeout(resolve, 8000)
    })

    // Extra wait for JS to render
    await new Promise(r => setTimeout(r, 2000))

    // Extract questions using content script
    let questions = []
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_QUESTIONS' })
      questions = response?.questions || []
    } catch(e) {
      console.log('[BAVN] Could not extract questions:', e.message)
    }

    if (questions.length) {
      // Send questions back to backend
      await api('POST', `/api/telegram/scrape-jobs/${job.id}/done`, { questions })
      console.log(`[BAVN] Sent ${questions.length} questions to bot`)

      // Show notification in extension
      setStatus(document.getElementById('autofill-status'),
        `✓ Sent ${questions.length} questions to Telegram bot`, 'success')

      // Switch to Fill tab so user can see
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'))
      document.querySelector('[data-tab="autofill"]').classList.add('active')
      document.getElementById('panel-autofill').classList.add('active')

    } else {
      // No questions found — mark as failed so bot asks manually
      await api('POST', `/api/telegram/scrape-jobs/${job.id}/done`, { questions: [] })
    }

  } catch(e) {
    // Silent fail
  }
}

// Add scrape job polling to the existing poller
const _originalFillPoll = checkFillJob
async function checkAllJobs() {
  await _originalFillPoll()
  await checkScrapeJob()
}

// Override the interval to check both
if (fillJobPollTimer) {
  clearInterval(fillJobPollTimer)
  fillJobPollTimer = setInterval(checkAllJobs, 5000)
}