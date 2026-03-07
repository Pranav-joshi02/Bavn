// ============================================
// BAVN.io — content.js  (self-contained)
// Enhanced extractor + manual memory capture
// ============================================

let questionMap = {}
let filledMap   = {}   // tracks what user manually typed

// ── MAIN EXTRACTOR ────────────────────────
function extractQuestions() {
  const results = []
  const seen    = new Set()

  // Strategy 1: Google Forms
  const googleItems = document.querySelectorAll(
    '[role="listitem"], .freebirdFormviewerViewItemsItemItem, [data-item-id]'
  )
  for (const item of googleItems) {
    const titleEl =
      item.querySelector('[role="heading"]') ||
      item.querySelector('.freebirdFormviewerViewItemsItemItemTitle') ||
      item.querySelector('[data-params]')
    const questionText = titleEl ? clean(titleEl.textContent) : null
    if (!questionText || questionText.length < 3 || seen.has(questionText)) continue
    const input =
      item.querySelector('input[type="text"], input[type="email"], input[type="url"], input[type="number"]') ||
      item.querySelector('textarea') ||
      item.querySelector('[contenteditable="true"]') ||
      item.querySelector('[role="textbox"]')
    if (!input) continue
    seen.add(questionText)
    results.push({ element: input, question: questionText })
  }

  // Strategy 2: aria-labelledby
  for (const input of document.querySelectorAll('[aria-labelledby]')) {
    if (!isEditable(input)) continue
    const labelEl = document.getElementById(input.getAttribute('aria-labelledby'))
    if (!labelEl) continue
    const q = clean(labelEl.textContent)
    if (!q || q.length < 3 || seen.has(q)) continue
    seen.add(q)
    results.push({ element: input, question: q })
  }

  // Strategy 3: aria-label
  for (const input of document.querySelectorAll('[aria-label]')) {
    if (!isEditable(input)) continue
    const q = clean(input.getAttribute('aria-label'))
    if (!q || q.length < 3 || seen.has(q)) continue
    seen.add(q)
    results.push({ element: input, question: q })
  }

  // Strategy 4: Standard label+input
  const SKIP_TYPES = new Set(['hidden','submit','button','reset','image','file','checkbox','radio'])
  const SKIP_NAMES = /^(email|phone|tel|name|date|zip|postal|captcha|token|csrf)$/i
  for (const el of document.querySelectorAll('input:not([type]), input[type="text"], input[type="url"], textarea')) {
    if (el.type && SKIP_TYPES.has(el.type)) continue
    if (el.name && SKIP_NAMES.test(el.name)) continue
    if (!isVisible(el)) continue
    const q = findLabel(el)
    if (!q || q.length < 3 || seen.has(q)) continue
    seen.add(q)
    results.push({ element: el, question: q })
  }

  return results
}

// ── FILLER ────────────────────────────────
function fillFields(items) {
  for (const { element, answer } of items) {
    if (!element || !answer) continue
    fillField(element, answer)
  }
}

function fillField(el, value) {
  if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox') {
    el.focus()
    el.textContent = value
    el.dispatchEvent(new Event('input',  { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  } else {
    const tag    = el.tagName.toLowerCase()
    const proto  = tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (setter) setter.call(el, value)
    else el.value = value
    el.dispatchEvent(new Event('input',  { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const prev = el.style.outline
  el.style.outline = '2px solid #00e5ff'
  setTimeout(() => { el.style.outline = prev }, 1500)
}

// ── READ CURRENT VALUES FROM PAGE ─────────
function readCurrentValues() {
  const filled = []
  for (const [question, element] of Object.entries(questionMap)) {
    let value = ''
    if (element.getAttribute('contenteditable') === 'true') {
      value = element.textContent?.trim()
    } else {
      value = element.value?.trim()
    }
    if (value && value.length > 1) {
      filled.push({ question, answer: value })
    }
  }
  return filled
}

// ── HELPERS ───────────────────────────────
function findLabel(el) {
  if (el.id) {
    const lbl = document.querySelector(`label[for="${el.id}"]`)
    if (lbl) return clean(lbl.textContent)
  }
  if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'))
  if (el.getAttribute('aria-labelledby')) {
    const ref = document.getElementById(el.getAttribute('aria-labelledby'))
    if (ref) return clean(ref.textContent)
  }
  const wrap = el.closest('label')
  if (wrap) return clean(wrap.textContent)
  const prev = el.previousElementSibling
  if (prev && /label|span|p|div|legend/i.test(prev.tagName)) {
    const t = clean(prev.textContent)
    if (t.length >= 3 && t.length < 200) return t
  }
  if (el.placeholder?.length >= 3) return clean(el.placeholder)
  if (el.name) return el.name.replace(/[_\-]/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase()
  return null
}

function clean(str) { return String(str||'').replace(/\s+/g,' ').replace(/[*:]+$/,'').trim() }
function isEditable(el) {
  const tag = el.tagName.toLowerCase()
  return ['input','textarea'].includes(tag) ||
    el.getAttribute('contenteditable') === 'true' ||
    el.getAttribute('role') === 'textbox'
}
function isVisible(el) {
  const s = getComputedStyle(el)
  return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && el.offsetParent !== null
}

// ── SCAN ──────────────────────────────────
function scanPage() {
  const fields = extractQuestions()
  questionMap  = {}
  fields.forEach(({ element, question }) => { questionMap[question] = element })
  console.log('[BAVN content] Found:', Object.keys(questionMap))
}

let lastUrl = location.href
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href
    setTimeout(scanPage, 1000)
  }
}).observe(document, { subtree: true, childList: true })

setTimeout(scanPage, 500)
setTimeout(scanPage, 1500)

// ── MESSAGE LISTENER ──────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_QUESTIONS') {
    scanPage()
    sendResponse({ questions: Object.keys(questionMap), url: window.location.href })
  }
  if (msg.type === 'DO_FILL') {
    const items = msg.answers
      .map(({ question, answer }) => ({ element: questionMap[question], question, answer }))
      .filter(i => i.element)
    fillFields(items)
  }
  // New: read what user has typed into the form right now
  if (msg.type === 'READ_FILLED') {
    scanPage()
    const filled = readCurrentValues()
    sendResponse({ filled, url: window.location.href })
  }
})