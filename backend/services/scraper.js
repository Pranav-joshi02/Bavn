// ============================================
// BAVN.io — services/scraper.js
// Auto-detects form questions using Browserless
// No manual input needed
// ============================================
import { supabase } from './supabase.js'

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN
const BROWSERLESS_WS    = `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}&--disable-web-security=true`

// ── Shared helpers ────────────────────────
function clean(str) {
  return String(str || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[*:]+$/, '')
    .trim()
}

function isGoodQ(q) {
  if (!q || q.length < 5 || q.length > 400) return false
  return !/^(submit|cancel|next|back|upload|choose|select|yes|no|add|remove|save|continue|skip|\d+)$/i.test(q.trim())
}

// ── Main entry point ──────────────────────
export async function scrapeFormQuestions(url, userId = null) {
  const domain = new URL(url).hostname.toLowerCase()

  // 1. Google Forms — parse JSON from page source (instant, no browser needed)
  if (domain.includes('docs.google.com') || domain.includes('forms.gle')) {
    try {
      const result = await scrapeGoogleForms(url)
      if (result.questions.length) {
        console.log(`[BAVN Scraper] Google Forms: ${result.questions.length} questions`)
        return result
      }
    } catch(e) {
      console.error('[BAVN Scraper] Google Forms error:', e.message)
    }
  }

  // 2. Browserless — for all JS-rendered forms
  if (BROWSERLESS_TOKEN) {
    try {
      const result = await scrapeWithBrowserless(url, userId)
      if (result.questions.length) {
        console.log(`[BAVN Scraper] Browserless: ${result.questions.length} questions`)
        return result
      }
    } catch(e) {
      console.error('[BAVN Scraper] Browserless error:', e.message)
    }
  }

  // 3. Static HTML fallback
  return scrapeWithFetch(url)
}

// ── Google Forms JSON parser ───────────────
async function scrapeGoogleForms(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(10000),
  })
  const html = await res.text()
  const questions = []

  // Parse embedded JSON data
  const match = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/)
  if (match) {
    try {
      const data  = JSON.parse(match[1])
      const items = data?.[1]?.[1] || []
      for (const item of items) {
        const title = item?.[1]
        const type  = item?.[3]
        if (title && typeof title === 'string' && title.trim()) {
          if ([0, 1].includes(type)) questions.push(title.trim())
        }
      }
      if (questions.length) return { questions, error: null }
    } catch(e) {}
  }

  // Fallback: visible question text
  for (const m of html.matchAll(/class="[^"]*freebirdFormviewerViewItemsItemItemTitle[^"]*"[^>]*>([\s\S]{3,200}?)<\/div>/g)) {
    const q = clean(m[1])
    if (q) questions.push(q)
  }

  return { questions, error: questions.length ? null : 'No questions found' }
}

// ── Browserless scraper ───────────────────
async function scrapeWithBrowserless(url, userId) {
  const { chromium } = await import('playwright-core')

  // Get user session if available
  let storageState
  if (userId) {
    storageState = await downloadSession(userId)
  }

  console.log('[BAVN Scraper] Connecting to Browserless...')

  const browser = await chromium.connect(BROWSERLESS_WS, {
    timeout: 15000,
  })

  const context = await browser.newContext({
    storageState: storageState || undefined,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport:  { width: 1280, height: 800 },
  })

  const page = await context.newPage()

  try {
    console.log(`[BAVN Scraper] Loading: ${url}`)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })

    // Wait for form fields to appear
    await Promise.race([
      page.waitForSelector('input[type="text"], textarea, input[type="email"]', { timeout: 8000 }),
      page.waitForTimeout(5000),
    ]).catch(() => {})

    await page.waitForTimeout(1500)

    // Extract questions from live DOM
    const questions = await page.evaluate(() => {
      const results = []
      const seen    = new Set()

      function clean(str) {
        return String(str || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .replace(/[*:]+$/, '')
          .trim()
      }

      function isGood(q) {
        if (!q || q.length < 5 || q.length > 400) return false
        return !/^(submit|cancel|next|back|upload|browse|choose|select|yes|no|add|remove|save|continue|\d+)$/i.test(q.trim())
      }

      const SKIP = new Set(['hidden','submit','button','reset','image','file','checkbox','radio'])

      // Strategy 1: label → input
      for (const label of document.querySelectorAll('label')) {
        const text = clean(label.innerText || label.textContent)
        if (!isGood(text) || seen.has(text)) continue
        const forId = label.getAttribute('for')
        if (forId) {
          const input = document.getElementById(forId)
          if (!input || (input.type && SKIP.has(input.type))) continue
          seen.add(text); results.push(text); continue
        }
        const input = label.querySelector('input, textarea, select, [contenteditable]')
        if (input && !(input.type && SKIP.has(input.type))) {
          seen.add(text); results.push(text)
        }
      }

      // Strategy 2: aria-label / aria-labelledby
      for (const el of document.querySelectorAll('input, textarea')) {
        if (el.type && SKIP.has(el.type)) continue
        if (!el.offsetParent) continue
        const ariaId = el.getAttribute('aria-labelledby')
        const q = clean(
          el.getAttribute('aria-label') ||
          (ariaId && document.getElementById(ariaId)?.innerText) || ''
        )
        if (isGood(q) && !seen.has(q)) { seen.add(q); results.push(q) }
      }

      // Strategy 3: question-style headings near inputs
      const questionStarters = /^(why|what|how|describe|tell|explain|when|where|who|please|share|write|mention|list|give|state|provide|briefly|elaborate)/i
      for (const el of document.querySelectorAll('p, h1, h2, h3, h4, h5, div.question, span.question, [class*="question"], [class*="Question"]')) {
        const text = clean(el.innerText || el.textContent)
        if (!isGood(text) || seen.has(text) || !questionStarters.test(text)) continue
        const parent = el.closest('div, section, li')
        if (parent?.querySelector('input[type="text"], textarea, [contenteditable]')) {
          seen.add(text); results.push(text)
        }
      }

      // Strategy 4: placeholder fallback
      for (const el of document.querySelectorAll('input[type="text"], textarea')) {
        if (!el.offsetParent) continue
        const q = clean(el.placeholder)
        if (isGood(q) && q.length > 10 && !seen.has(q)) {
          seen.add(q); results.push(q)
        }
      }

      // Strategy 5: Google Forms specific selectors
      for (const el of document.querySelectorAll(
        '[data-params], .freebirdFormviewerViewItemsItemItemTitle, .M7eMe, [jsname="ij8cu"]'
      )) {
        const text = clean(el.innerText || el.textContent)
        if (isGood(text) && !seen.has(text)) { seen.add(text); results.push(text) }
      }

      // Strategy 6: Internshala specific
      for (const el of document.querySelectorAll(
        '.assessment_question, .question-text, [class*="question_text"], [class*="questionText"]'
      )) {
        const text = clean(el.innerText || el.textContent)
        if (isGood(text) && !seen.has(text)) { seen.add(text); results.push(text) }
      }

      return results.slice(0, 15)
    })

    await context.close()
    await browser.close()

    return { questions, error: questions.length ? null : 'No questions found' }

  } catch(e) {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
    throw e
  }
}

// ── Static HTML fallback ──────────────────
async function scrapeWithFetch(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(10000),
    })
    const html = await res.text()
    const questions = []
    const seen      = new Set()

    for (const m of html.matchAll(/<label[^>]*>([\s\S]{5,200}?)<\/label>/gi)) {
      const q = clean(m[1])
      if (isGoodQ(q) && !seen.has(q)) { seen.add(q); questions.push(q) }
    }
    for (const m of html.matchAll(/aria-label="([^"]{5,200})"/gi)) {
      const q = m[1].trim()
      if (isGoodQ(q) && !seen.has(q)) { seen.add(q); questions.push(q) }
    }
    for (const m of html.matchAll(/<[^>]+>\s*((?:Why|What|How|Describe|Tell|Explain|When|Please)[^<]{5,200})\s*</gi)) {
      const q = clean(m[1])
      if (isGoodQ(q) && !seen.has(q)) { seen.add(q); questions.push(q) }
    }

    return { questions: questions.slice(0, 15), error: questions.length ? null : 'No questions found' }
  } catch(e) {
    return { questions: [], error: e.message }
  }
}

// ── Download session ──────────────────────
async function downloadSession(userId) {
  try {
    const { data, error } = await supabase.storage
      .from('bavn-sessions').download(`${userId}/session.json`)
    if (error || !data) return null
    return JSON.parse(await data.text())
  } catch(e) { return null }
}