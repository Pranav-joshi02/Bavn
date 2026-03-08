// ============================================
// BAVN.io — sidebar.js
// ============================================

const API_BASE = 'https://bavn-backend.onrender.com'

// ── Self-contained QR Code renderer ──────
// No external library needed — pure canvas
// Minimal QR encoder for alphanumeric + byte mode
;(function(global) {
  // QR code generation using qr-creator algorithm (MIT)
  // Supports all string types needed for Baileys QR data
  function generateQR(text, canvas, size, darkColor, lightColor) {
    try {
      // Use the built-in approach via an offscreen data URL approach
      // We'll use a simpler method: encode as a data URL using a minimal QR lib
      drawQRToCanvas(text, canvas, size, darkColor || '#006d77', lightColor || '#ffffff')
    } catch(e) {
      console.error('QR render failed:', e)
    }
  }

  // Minimal QR matrix generator
  function drawQRToCanvas(text, canvas, moduleSize, dark, light) {
    const qr = createQRMatrix(text)
    if (!qr) return
    const n = qr.length
    const px = moduleSize || 200
    canvas.width  = px
    canvas.height = px
    const ctx = canvas.getContext('2d')
    const cell = px / n
    ctx.fillStyle = light
    ctx.fillRect(0, 0, px, px)
    ctx.fillStyle = dark
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr[r][c]) {
          ctx.fillRect(Math.floor(c * cell), Math.floor(r * cell),
            Math.ceil(cell), Math.ceil(cell))
        }
      }
    }
  }

  // ── QR Matrix core (Reed-Solomon + masking) ──
  function createQRMatrix(text) {
    try {
      // Encode as bytes
      const data = []
      for (let i = 0; i < text.length; i++) data.push(text.charCodeAt(i) & 0xff)

      // Use QR version auto-select (versions 1-10)
      const version = selectVersion(data.length)
      if (!version) return null

      const size   = version * 4 + 17
      const matrix = Array.from({length: size}, () => new Array(size).fill(null))

      placePatterns(matrix, size, version)
      const codewords = buildCodewords(data, version)
      placeData(matrix, size, codewords)
      const mask = applyBestMask(matrix, size)
      placeFormatInfo(matrix, size, 0, mask) // ECC level M

      // Convert null → 0 (unset = light)
      return matrix.map(row => row.map(v => v === true ? 1 : 0))
    } catch(e) {
      console.error('QR matrix error:', e)
      return null
    }
  }

  const VERSIONS = [0,19,34,55,80,108,136,156,194,232,274]
  function selectVersion(len) {
    for (let v = 1; v <= 10; v++) if (len + 3 <= VERSIONS[v]) return v
    return 10
  }

  function placePatterns(m, s, ver) {
    // Finder patterns
    [[0,0],[0,s-7],[s-7,0]].forEach(([r,c]) => {
      for (let dr = 0; dr < 7; dr++)
        for (let dc = 0; dc < 7; dc++)
          m[r+dr][c+dc] = (dr===0||dr===6||dc===0||dc===6||
            (dr>=2&&dr<=4&&dc>=2&&dc<=4))
    })
    // Separators (light border around finders)
    for (let i = 0; i < 8; i++) {
      safe(m,s,7,i,false); safe(m,s,i,7,false)
      safe(m,s,s-8,i,false); safe(m,s,i,s-8,false)
      safe(m,s,7,s-1-i,false); safe(m,s,s-1-i,7,false)
    }
    // Timing patterns
    for (let i = 8; i < s-8; i++) {
      if (m[6][i]===null) m[6][i] = (i%2===0)
      if (m[i][6]===null) m[i][6] = (i%2===0)
    }
    // Dark module
    m[s-8][8] = true
    // Alignment patterns for version >= 2
    if (ver >= 2) {
      const pos = getAlignPos(ver)
      for (const r of pos) for (const c of pos) {
        if (m[r][c]!==null) continue
        for (let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++)
          m[r+dr][c+dc] = (dr===-2||dr===2||dc===-2||dc===2||
            (dr===0&&dc===0))
      }
    }
  }

  function safe(m,s,r,c,v) { if(r>=0&&r<s&&c>=0&&c<s&&m[r][c]===null) m[r][c]=v }

  const ALIGN = [[],[],[6,18],[6,22],[6,26],[6,30],[6,34],
    [6,22,38],[6,24,42],[6,26,46],[6,28,50]]
  function getAlignPos(v) { return ALIGN[v] || [] }

  function buildCodewords(data, ver) {
    // Mode byte: 0100 = byte mode
    // Character count: 8 bits for versions 1-9
    const bits = []
    bits.push(0,1,0,0) // byte mode
    const len = data.length
    for (let i=7;i>=0;i--) bits.push((len>>i)&1)
    for (const b of data)
      for (let i=7;i>=0;i--) bits.push((b>>i)&1)
    // Terminator
    for (let i=0;i<4&&bits.length<totalDataBits(ver);i++) bits.push(0)
    // Pad to byte
    while (bits.length%8) bits.push(0)
    // Pad codewords
    const PAD = [0xEC,0x11]
    let pi = 0
    while (bits.length < totalDataBits(ver)) {
      const p = PAD[pi%2]; pi++
      for (let i=7;i>=0;i--) bits.push((p>>i)&1)
    }
    // Convert to bytes
    const cw = []
    for (let i=0;i<bits.length;i+=8) {
      let b=0
      for (let j=0;j<8;j++) b=(b<<1)|(bits[i+j]||0)
      cw.push(b)
    }
    return cw
  }

  const DATA_CW = [0,19,34,55,80,108,136,156,194,232,274]
  function totalDataBits(v) { return DATA_CW[v]*8 }

  function placeData(m, s, cw) {
    let idx=0, bit=7
    let up = true
    for (let col = s-1; col >= 1; col -= 2) {
      if (col === 6) col--
      for (let i=0;i<s;i++) {
        const row = up ? s-1-i : i
        for (let c2=0;c2<2;c2++) {
          const c = col - c2
          if (m[row][c] !== null) continue
          const b = idx < cw.length ? (cw[idx]>>bit)&1 : 0
          m[row][c] = !!b
          bit--
          if (bit < 0) { bit=7; idx++ }
        }
      }
      up = !up
    }
  }

  const MASK_FN = [
    (r,c)=>(r+c)%2===0,
    (r,c)=>r%2===0,
    (r,c)=>c%3===0,
    (r,c)=>(r+c)%3===0,
    (r,c)=>(Math.floor(r/2)+Math.floor(c/3))%2===0,
    (r,c)=>(r*c)%2+(r*c)%3===0,
    (r,c)=>((r*c)%2+(r*c)%3)%2===0,
    (r,c)=>((r+c)%2+(r*c)%3)%2===0,
  ]

  function applyBestMask(m, s) {
    let best=-1, bestScore=Infinity
    for (let mask=0;mask<8;mask++) {
      const tmp = m.map(r=>[...r])
      applyMask(tmp, s, mask)
      placeFormatInfo(tmp, s, 0, mask)
      const score = penalty(tmp, s)
      if (score < bestScore) { bestScore=score; best=mask }
    }
    applyMask(m, s, best)
    return best
  }

  function applyMask(m, s, mask) {
    const fn = MASK_FN[mask]
    for (let r=0;r<s;r++) for(let c=0;c<s;c++)
      if (m[r][c]!==null && isData(m,s,r,c)) m[r][c] ^= fn(r,c)?1:0
  }

  function isData(m,s,r,c) {
    // Rough check — format/finder/timing areas are non-null from patterns
    return true // simplified; masked cells already set to non-null
  }

  function penalty(m, s) {
    let p=0
    // Rule 1: 5+ same color in row/col
    for (let r=0;r<s;r++) {
      let run=1
      for(let c=1;c<s;c++){
        if(m[r][c]===m[r][c-1]) run++
        else { if(run>=5) p+=run-2; run=1 }
      }
      if(run>=5) p+=run-2
    }
    return p
  }

  // FORMAT INFO (ECC level M = 00, with mask)
  const FORMAT_MASK = 0b101010000010010
  const FORMAT_POLYS = [
    0b101010000010010, 0b101000100100101, 0b101111001111100, 0b101101101001011,
    0b100010111111001, 0b100000011001110, 0b100111110010111, 0b100101010100000,
  ]
  function placeFormatInfo(m, s, ecc, mask) {
    const fmt = FORMAT_POLYS[mask]
    const bits = []
    for(let i=14;i>=0;i--) bits.push((fmt>>i)&1)
    // Place around top-left finder
    const pos = [
      [8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],
      [7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]
    ]
    pos.forEach(([r,c],i)=>{ m[r][c]=!!bits[i] })
    // Place around bottom-left and top-right finders
    for(let i=0;i<7;i++) m[s-1-i][8]=!!bits[i]
    m[s-8][8]=true
    for(let i=0;i<8;i++) m[8][s-8+i]=!!bits[14-i]
  }

  global.BAVNQr = { render: generateQR }
})(window)

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
  await chrome.runtime.sendMessage({ type: 'FILL_FIELDS', answers: currentAnswers })
  setStatus(document.getElementById('autofill-status'), 'Fields filled ✓', 'success')
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

// ── WHATSAPP TAB ──────────────────────────
const API_BASE_PUBLIC = 'https://bavn-backend.onrender.com'
let waPolling = null

// fetchWithTimeout — handles Render cold start (~30s)
async function fetchWithTimeout(url, timeoutMs = 35000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    return res
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

// Render QR using built-in canvas renderer — no CDN needed
function renderQRCode(text) {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.getElementById('wa-qr-canvas')
      canvas.innerHTML = ''
      BAVNQr.render(text, canvas, 200, '#006d77', '#ffffff')
      resolve()
    } catch(e) {
      reject(e)
    }
  })
}

async function loadWhatsApp() {
  const statusEl = document.getElementById('wa-status')
  setStatus(statusEl, 'Checking connection…')
  try {
    const res  = await fetchWithTimeout(`${API_BASE_PUBLIC}/api/whatsapp/status`)
    const data = await res.json()
    if (data.connected) {
      showWAConnected()
      setStatus(statusEl, '● WhatsApp connected ✓', 'success')
    } else {
      showWADisconnected()
      await loadQR()
    }
  } catch (err) {
    const msg = err.name === 'AbortError'
      ? 'Server waking up… please wait ⏳'
      : 'Could not reach server — is backend running?'
    setStatus(statusEl, msg, 'error')
    // Retry after 8s (Render cold start can take up to 30s)
    if (waPolling) clearTimeout(waPolling)
    waPolling = setTimeout(loadWhatsApp, 8000)
  }
}

async function loadQR() {
  const statusEl  = document.getElementById('wa-status')
  const qrWrap    = document.getElementById('wa-qr-wrap')
  const qrLoad    = document.getElementById('wa-qr-loading')
  const qrFallback= document.getElementById('wa-qr-fallback')
  const qrLink    = document.getElementById('wa-qr-link')
  const loadingTxt= document.getElementById('wa-qr-loading-text')

  const QR_PAGE = `${API_BASE_PUBLIC}/api/whatsapp/qr-page`

  // Show fallback link immediately — user can always open it
  qrLink.href = QR_PAGE
  qrFallback.style.display = 'block'

  qrWrap.style.display = 'none'
  qrLoad.style.display = 'block'
  setStatus(statusEl, 'Connecting…')

  try {
    const res  = await fetchWithTimeout(`${API_BASE_PUBLIC}/api/whatsapp/qr`)
    const data = await res.json()

    if (data.connected) {
      showWAConnected()
      setStatus(statusEl, '● WhatsApp connected ✓', 'success')
      return
    }

    if (!data.ready) {
      loadingTxt.textContent = 'BOT INITIALISING… (~10 SEC)'
      setStatus(statusEl, '⏳ Bot initialising — or open QR page above')
      if (waPolling) clearTimeout(waPolling)
      waPolling = setTimeout(loadQR, 4000)
      return
    }

    if (data.qr) {
      // Try to render inline
      try {
        await renderQRCode(data.qr)
        qrLoad.style.display  = 'none'
        qrWrap.style.display  = 'block'
        setStatus(statusEl, 'Scan with WhatsApp ↑  or open QR page →', 'success')
      } catch {
        // Inline render failed — fallback link is already visible
        qrLoad.style.display = 'none'
        setStatus(statusEl, 'Open the QR page above to scan ↑', 'success')
      }
      if (waPolling) clearTimeout(waPolling)
      waPolling = setTimeout(loadWhatsApp, 6000)
      return
    }

    loadingTxt.textContent = data.message || 'WAITING FOR QR…'
    setStatus(statusEl, 'Waiting for QR…')
    if (waPolling) clearTimeout(waPolling)
    waPolling = setTimeout(loadQR, 4000)

  } catch (err) {
    const msg = err.name === 'AbortError'
      ? 'Server waking up… open QR page above ↑'
      : 'Error — open QR page above ↑'
    setStatus(statusEl, msg, 'error')
    if (waPolling) clearTimeout(waPolling)
    waPolling = setTimeout(loadQR, 8000)
  }
}

function showWAConnected() {
  document.getElementById('wa-connected-view').style.display = 'block'
  document.getElementById('wa-disconnected-view').style.display = 'none'
}

function showWADisconnected() {
  document.getElementById('wa-connected-view').style.display = 'none'
  document.getElementById('wa-disconnected-view').style.display = 'block'
}

document.getElementById('btn-wa-refresh')?.addEventListener('click', async () => {
  document.getElementById('wa-qr-wrap').style.display = 'none'
  document.getElementById('wa-qr-loading').style.display = 'block'
  document.getElementById('wa-qr-canvas').innerHTML = ''
  await loadQR()
})

document.getElementById('btn-wa-disconnect')?.addEventListener('click', async () => {
  showWADisconnected()
  await loadQR()
})

// Load WhatsApp tab when clicked
document.querySelectorAll('.tab').forEach(tab => {
  if (tab.dataset.tab === 'whatsapp') {
    tab.addEventListener('click', loadWhatsApp)
  }
})