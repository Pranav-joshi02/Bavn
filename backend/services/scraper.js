// ============================================
// BAVN.io — services/scraper.js
// Scrapes form questions using Playwright
// Handles JS-rendered forms (Internshala, etc)
// ============================================
import { hasSession } from './browser.js'
import { supabase }   from './supabase.js'

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN
const BROWSERLESS_WS    = `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`

// ── Shared helpers ────────────────────────
function clean(str) {
  return String(str || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[*:]+$/, '')
    .trim()
}

function isGoodQ(q) {
  if (!q || q.length < 5 || q.length > 400) return false
  return !/^(submit|cancel|next|back|upload|choose|select|yes|no|add|remove|\d+)$/i.test(q.trim())
}

// ── Main scraper ──────────────────────────
export async function scrapeFormQuestions(url, userId = null) {
  const domain = new URL(url).hostname.toLowerCase()

  // Google Forms — parse embedded JSON (no Playwright needed, very fast)
  if (domain.includes('docs.google.com') || domain.includes('forms.gle')) {
    try {
      const result = await scrapeGoogleForms(url)
      if (result.questions.length) return result
    } catch(e) {
      console.error('[BAVN Scraper] Google Forms error:', e.message)
    }
  }

  // Try Playwright scraping for JS-rendered forms
  if (BROWSERLESS_TOKEN) {
    try {
      const result = await scrapeWithPlaywright(url, userId)
      if (result.questions.length) return result
    } catch(e) {
      console.error('[BAVN Scraper] Playwright failed:', e.message)
    }
  }

  // Final fallback — static HTML
  return scrapeWithFetch(url)
}

// ── Google Forms (JSON in page source) ────
async function scrapeGoogleForms(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(10000),
  })
  const html = await res.text()

  const questions = []

  // Method 1: FB_PUBLIC_LOAD_DATA_ JSON blob
  const match = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/)
  if (match) {
    try {
      const data  = JSON.parse(match[1])
      const items = data?.[1]?.[1] || []
      for (const item of items) {
        const title = item?.[1]
        const type  = item?.[3]  // 0=short text, 1=paragraph, 2=radio, etc
        if (title && typeof title === 'string' && title.trim()) {
          // Only text input types (0=short, 1=paragraph)
          if ([0, 1].includes(type)) {
            questions.push(clean(title))
          }
        }
      }
      if (questions.length) {
        console.log(`[BAVN Scraper] Google Forms JSON: ${questions.length} questions`)
        return { questions, error: null }
      }
    } catch(e) {}
  }

  // Method 2: Scrape visible question text from HTML
  for (const m of html.matchAll(/class="[^"]*freebirdFormviewerViewItemsItemItemTitle[^"]*"[^>]*>([\s\S]{3,200}?)<\/div>/g)) {
    const q = clean(m[1])
    if (q && q.length >= 3) questions.push(q)
  }

  return { questions, error: questions.length ? null : 'No questions found' }
}

// ── Playwright scraper (JS-rendered) ──────
async function scrapeWithPlaywright(url, userId) {
  const { chromium } = await import('playwright-core')

  // Download session if available (for login-protected forms)
  let storageState = undefined
  if (userId) {
    const session = await downloadSession(userId)
    if (session) storageState = session
  }

  const browser = await chromium.connectOverCDP(BROWSERLESS_WS, {
    timeout: 30000,
  })

  const context = await browser.newContext({
    storageState,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport:  { width: 1280, height: 800 },
  })

  const page = await context.newPage()

  try {
    console.log(`[BAVN Scraper] Loading ${url}`)
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 })

    // Wait for form fields to appear
    await page.waitForSelector(
      'input[type="text"], textarea, [contenteditable="true"], input[type="email"]',
      { timeout: 8000 }
    ).catch(() => {})

    // Extra wait for dynamic content
    await page.waitForTimeout(2000)

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
        const skip = /^(submit|cancel|next|back|upload|browse|choose|select all|yes|no|male|female|other|add|remove|save|continue|\d+)$/i
        return !skip.test(q.trim())
      }

      const SKIP_TYPES = new Set(['hidden','submit','button','reset','image','file','checkbox','radio'])

      // Strategy 1: label → input association
      for (const label of document.querySelectorAll('label')) {
        const text = clean(label.innerText || label.textContent)
        if (!isGood(text) || seen.has(text)) continue

        // Check label points to an editable field
        const forId = label.getAttribute('for')
        if (forId) {
          const input = document.getElementById(forId)
          if (!input) continue
          if (input.type && SKIP_TYPES.has(input.type)) continue
          seen.add(text)
          results.push(text)
          continue
        }

        // Label wraps an input
        const input = label.querySelector('input, textarea, select, [contenteditable]')
        if (input) {
          if (input.type && SKIP_TYPES.has(input.type)) continue
          seen.add(text)
          results.push(text)
        }
      }

      // Strategy 2: aria-label on inputs
      for (const el of document.querySelectorAll('input, textarea')) {
        if (el.type && SKIP_TYPES.has(el.type)) continue
        const style = window.getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        if (!el.offsetParent) continue

        const q = clean(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.innerText || '')
        if (isGood(q) && !seen.has(q)) {
          seen.add(q)
          results.push(q)
        }
      }

      // Strategy 3: question-like headings near inputs
      for (const el of document.querySelectorAll('p, h1, h2, h3, h4, h5, div, span')) {
        const text = clean(el.innerText || el.textContent)
        if (!isGood(text) || seen.has(text) || text.length > 300) continue
        if (!/^(why|what|how|describe|tell|explain|when|where|who|please|share|write|mention|list|give|state|provide)/i.test(text)) continue

        // Must be near an input
        const next = el.nextElementSibling
        const hasInput = next?.querySelector?.('input, textarea, [contenteditable]') ||
                         next?.matches?.('input, textarea') ||
                         el.closest('div')?.querySelector?.('textarea, input[type="text"]')
        if (hasInput) {
          seen.add(text)
          results.push(text)
        }
      }

      // Strategy 4: placeholder text as fallback
      for (const el of document.querySelectorAll('input[type="text"], textarea')) {
        const style = window.getComputedStyle(el)
        if (style.display === 'none' || !el.offsetParent) continue
        const q = clean(el.placeholder)
        if (isGood(q) && !seen.has(q) && q.length > 10) {
          seen.add(q)
          results.push(q)
        }
      }

      // Strategy 5: Google Forms specific
      for (const el of document.querySelectorAll('[data-params], .freebirdFormviewerViewItemsItemItemTitle, [role="heading"]')) {
        const text = clean(el.innerText || el.textContent)
        if (isGood(text) && !seen.has(text)) {
          seen.add(text)
          results.push(text)
        }
      }

      return results.slice(0, 15)
    })

    await context.close()
    await browser.close()

    console.log(`[BAVN Scraper] Found ${questions.length} questions`)
    return { questions, error: null }

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
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':     'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(10000),
    })
    const html = await res.text()

    const questions = []
    const seen      = new Set()

    // Labels
    for (const m of html.matchAll(/<label[^>]*>([\s\S]{5,200}?)<\/label>/gi)) {
      const q = cleanHtml(m[1])
      if (isGoodQ(q) && !seen.has(q)) { seen.add(q); questions.push(q) }
    }

    // Aria-labels
    for (const m of html.matchAll(/aria-label="([^"]{5,200})"/gi)) {
      const q = m[1].trim()
      if (isGoodQ(q) && !seen.has(q)) { seen.add(q); questions.push(q) }
    }

    // Question-style text
    for (const m of html.matchAll(/<[^>]+>\s*((?:Why|What|How|Describe|Tell|Explain|When|Please)[^<]{5,200})\s*</gi)) {
      const q = cleanHtml(m[1])
      if (isGoodQ(q) && !seen.has(q)) { seen.add(q); questions.push(q) }
    }

    return { questions: questions.slice(0, 15), error: questions.length ? null : 'No questions found' }

  } catch(e) {
    return { questions: [], error: e.message }
  }
}

async function downloadSession(userId) {
  try {
    const { data, error } = await supabase.storage
      .from('bavn-sessions').download(`${userId}/session.json`)
    if (error || !data) return null
    return JSON.parse(await data.text())
  } catch(e) { return null }
}