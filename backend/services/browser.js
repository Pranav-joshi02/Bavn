// ============================================
// BAVN.io — services/browser.js
// Playwright-based form auto-submitter
// Uses Browserless.io (free tier: 1000 min/mo)
// Session stored in Supabase Storage
// ============================================
import { supabase } from './supabase.js'
import { writeFile, readFile, mkdir, rm } from 'fs/promises'
import { existsSync }                      from 'fs'
import path                                from 'path'
import os                                  from 'os'

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN
const BROWSERLESS_WS    = `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`
const SESSION_BUCKET    = 'bavn-sessions'
const SESSION_DIR       = path.join(os.tmpdir(), 'bavn-sessions')

// ── Download session from Supabase Storage ─
async function downloadSession(userId) {
  try {
    const { data, error } = await supabase.storage
      .from(SESSION_BUCKET)
      .download(`${userId}/session.json`)

    if (error || !data) return null

    const text = await data.text()
    return JSON.parse(text)
  } catch(e) {
    console.error('[BAVN Browser] Session download failed:', e.message)
    return null
  }
}

// ── Upload session to Supabase Storage ──────
export async function uploadSession(userId, sessionData) {
  const json = JSON.stringify(sessionData)
  const blob = new Blob([json], { type: 'application/json' })

  const { error } = await supabase.storage
    .from(SESSION_BUCKET)
    .upload(`${userId}/session.json`, blob, {
      upsert:      true,
      contentType: 'application/json',
    })

  if (error) throw new Error(`Session upload failed: ${error.message}`)
  console.log('[BAVN Browser] Session uploaded ✓')
}

// ── Check if user has a session ─────────────
export async function hasSession(userId) {
  const { data } = await supabase.storage
    .from(SESSION_BUCKET)
    .list(userId)
  return data?.some(f => f.name === 'session.json') || false
}

// ── Main: fill + submit a form ───────────────
export async function fillAndSubmitForm({ userId, formUrl, answers }) {
  if (!BROWSERLESS_TOKEN) {
    throw new Error('BROWSERLESS_TOKEN not set')
  }

  // Download user session
  const session = await downloadSession(userId)
  if (!session) {
    throw new Error('NO_SESSION')
  }

  // Dynamic import of playwright
  const { chromium } = await import('playwright-core')

  const browser = await chromium.connectOverCDP(BROWSERLESS_WS, {
    timeout: 30000,
  })

  const context = await browser.newContext({
    storageState: session,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  })

  const page = await context.newPage()

  try {
    console.log(`[BAVN Browser] Opening ${formUrl}`)
    await page.goto(formUrl, { waitUntil: 'networkidle', timeout: 30000 })

    // Check if login required
    const loginRequired = await checkLoginRequired(page, formUrl)
    if (loginRequired) {
      throw new Error('LOGIN_REQUIRED')
    }

    // Multi-page form fill loop
    const result = await fillFormPages(page, answers)

    // Save updated session (cookies may have refreshed)
    const updatedSession = await context.storageState()
    await uploadSession(userId, updatedSession)

    return result

  } finally {
    await context.close()
    await browser.close()
  }
}

// ── Fill all pages of the form ───────────────
async function fillFormPages(page, answers) {
  let pageNum  = 1
  let filled   = 0
  const MAX    = 15

  while (pageNum <= MAX) {
    console.log(`[BAVN Browser] Filling page ${pageNum}`)

    // Wait for form fields to load
    await page.waitForTimeout(1500)

    // Get all visible input fields
    const fieldsData = await page.evaluate(() => {
      const inputs    = []
      const skipTypes = new Set(['hidden','submit','button','reset','image','file'])

      for (const el of document.querySelectorAll('input, textarea, [contenteditable="true"]')) {
        if (el.type && skipTypes.has(el.type)) continue
        const style = getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        if (!el.offsetParent) continue

        const label   = findLabel(el)
        const tagName = el.tagName.toLowerCase()
        if (!label || label.length < 3) continue

        inputs.push({
          label,
          tag:         tagName,
          type:        el.type || tagName,
          selector:    getSelector(el),
          placeholder: el.placeholder || '',
        })
      }

      function findLabel(el) {
        if (el.id) {
          const lbl = document.querySelector(`label[for="${el.id}"]`)
          if (lbl) return lbl.innerText.trim()
        }
        if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim()
        if (el.getAttribute('aria-labelledby')) {
          const ref = document.getElementById(el.getAttribute('aria-labelledby'))
          if (ref) return ref.innerText.trim()
        }
        const wrap = el.closest('label')
        if (wrap) return wrap.innerText.trim()
        const prev = el.previousElementSibling
        if (prev) return prev.innerText?.trim() || ''
        return el.placeholder || ''
      }

      function getSelector(el) {
        if (el.id)   return `#${CSS.escape(el.id)}`
        if (el.name) return `[name="${CSS.escape(el.name)}"]`
        // Build nth-child selector
        const tag = el.tagName.toLowerCase()
        const parent = el.parentElement
        if (!parent) return tag
        const idx = [...parent.children].indexOf(el) + 1
        return `${tag}:nth-child(${idx})`
      }

      return inputs
    })

    // Match answers to fields and fill
    for (const field of fieldsData) {
      const match = findBestMatch(field.label, field.placeholder, answers)
      if (!match) continue

      try {
        await page.fill(field.selector, match.answer)
        await page.waitForTimeout(200)
        filled++
        console.log(`[BAVN Browser] Filled: "${field.label.slice(0,40)}"`)
      } catch(e) {
        // Try clicking first then filling
        try {
          await page.click(field.selector)
          await page.fill(field.selector, match.answer)
          filled++
        } catch(e2) {
          console.log(`[BAVN Browser] Could not fill: ${field.label}`)
        }
      }
    }

    // Look for Next/Submit button
    const navResult = await findAndClickNav(page)

    if (navResult === 'submitted') {
      return { success: true, pagesCompleted: pageNum, fieldsFilled: filled }
    } else if (navResult === 'next') {
      pageNum++
      await page.waitForTimeout(1000)
    } else {
      // No navigation found — form might be done
      return { success: true, pagesCompleted: pageNum, fieldsFilled: filled, noNav: true }
    }
  }

  return { success: true, pagesCompleted: pageNum, fieldsFilled: filled }
}

// ── Find and click Next/Submit ───────────────
async function findAndClickNav(page) {
  const nextLabels   = /^(next|continue|proceed|next step|next page|→|»)$/i
  const submitLabels = /^(submit|send|finish|done|apply|confirm|register|complete)$/i

  // Check all buttons
  const buttons = await page.$$('button, input[type="submit"], input[type="button"], [role="button"]')

  let nextBtn   = null
  let submitBtn = null

  for (const btn of buttons) {
    const visible = await btn.isVisible().catch(() => false)
    if (!visible) continue

    const text = await btn.evaluate(el =>
      (el.innerText || el.value || el.getAttribute('aria-label') || '').trim()
    )

    if (nextLabels.test(text))   nextBtn   = nextBtn   || btn
    if (submitLabels.test(text)) submitBtn = submitBtn || btn
  }

  // Google Forms specific
  if (!nextBtn && !submitBtn) {
    const gfNext = await page.$('[jsname] [role="button"]:has-text("Next")')
    if (gfNext) nextBtn = gfNext
    const gfSubmit = await page.$('[jsname] [role="button"]:has-text("Submit")')
    if (gfSubmit) submitBtn = gfSubmit
  }

  if (nextBtn) {
    await nextBtn.click()
    return 'next'
  }

  if (submitBtn) {
    await submitBtn.click()
    // Wait for confirmation page
    await page.waitForTimeout(3000)
    return 'submitted'
  }

  return null
}

// ── Fuzzy match answer to field ──────────────
function findBestMatch(label, placeholder, answers) {
  const query = (label + ' ' + placeholder).toLowerCase()
  const qWords = new Set(
    query.replace(/[^a-z0-9 ]/g, '').split(' ').filter(w => w.length > 2)
  )

  let best = null, bestScore = 0

  for (const a of answers) {
    const aLow   = a.question.toLowerCase()
    const aWords = new Set(
      aLow.replace(/[^a-z0-9 ]/g, '').split(' ').filter(w => w.length > 2)
    )
    const common = [...qWords].filter(w => aWords.has(w)).length
    const score  = common / Math.max(qWords.size, aWords.size, 1)
    if (score > 0.35 && score > bestScore) { best = a; bestScore = score }
    if (aLow === query.trim()) { best = a; break }
  }

  return best
}

// ── Detect if login is required ──────────────
async function checkLoginRequired(page, formUrl) {
  const url = page.url()
  return (
    url.includes('accounts.google.com/signin') ||
    url.includes('login') ||
    url.includes('signin') ||
    url.includes('auth')
  ) && !url.includes(new URL(formUrl).hostname)
}