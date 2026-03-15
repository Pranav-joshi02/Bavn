// ============================================
// BAVN.io — services/scraper.js
// Scrapes form questions using Browserless
// Full JS rendering — works on all forms
// ============================================
import { supabase } from './supabase.js'

const TOKEN = process.env.BROWSERLESS_TOKEN

// ── Main entry point ──────────────────────
export async function scrapeFormQuestions(url, userId = null) {
  const domain = new URL(url).hostname.toLowerCase()

  // Google Forms — instant JSON parse, no browser needed
  if (domain.includes('docs.google.com') || domain.includes('forms.gle')) {
    try {
      const r = await scrapeGoogleForms(url)
      if (r.questions.length) return r
    } catch(e) {}
  }

  // All other forms — use Browserless REST API
  // REST API is more reliable than WebSocket CDP
  if (TOKEN) {
    try {
      return await scrapeViaBrowserlessRest(url, userId)
    } catch(e) {
      console.error('[Scraper] Browserless error:', e.message)
    }
  }

  return { questions: [], error: 'No scraper available' }
}

// ── Google Forms JSON ─────────────────────
async function scrapeGoogleForms(url) {
  const res  = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal:  AbortSignal.timeout(10000),
  })
  const html = await res.text()
  const questions = []

  const match = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/)
  if (match) {
    const data  = JSON.parse(match[1])
    const items = data?.[1]?.[1] || []
    for (const item of items) {
      const title = item?.[1]
      const type  = item?.[3]
      if (title && typeof title === 'string' && [0, 1].includes(type)) {
        questions.push(title.trim())
      }
    }
  }
  return { questions, error: null }
}

// ── Browserless REST API ──────────────────
// Uses /function endpoint — most reliable method
async function scrapeViaBrowserlessRest(url, userId) {
  // Get user session cookies if available
  let cookies = []
  if (userId) {
    try {
      const { data } = await supabase.storage
        .from('bavn-sessions').download(`${userId}/session.json`)
      if (data) {
        const session = JSON.parse(await data.text())
        cookies = session.cookies || []
      }
    } catch(e) {}
  }

  // The extraction function that runs inside Browserless Chrome
  const extractFn = `
    export default async function ({ page }) {
      // Set cookies for logged-in sites
      ${cookies.length ? `
      await page.context().addCookies(${JSON.stringify(cookies)});
      ` : ''}

      await page.goto(${JSON.stringify(url)}, {
        waitUntil: 'networkidle',
        timeout: 20000,
      });

      // Wait for form fields
      await page.waitForSelector(
        'input[type="text"], textarea, input[type="email"], [contenteditable]',
        { timeout: 8000 }
      ).catch(() => {});

      await page.waitForTimeout(2000);

      const questions = await page.evaluate(() => {
        const results = [];
        const seen = new Set();
        const SKIP = new Set(['hidden','submit','button','reset','image','file','checkbox','radio']);

        function clean(s) {
          return String(s||'').replace(/<[^>]+>/g,' ').replace(/\\s+/g,' ').replace(/[*:]+$/,'').trim();
        }
        function good(q) {
          if (!q || q.length < 5 || q.length > 400) return false;
          return !/^(submit|cancel|next|back|upload|choose|select|yes|no|add|remove|save|\\d+)$/i.test(q.trim());
        }

        // 1. label → input
        for (const label of document.querySelectorAll('label')) {
          const text = clean(label.innerText);
          if (!good(text) || seen.has(text)) continue;
          const forId = label.getAttribute('for');
          if (forId) {
            const inp = document.getElementById(forId);
            if (!inp || (inp.type && SKIP.has(inp.type))) continue;
            seen.add(text); results.push(text); continue;
          }
          const inp = label.querySelector('input,textarea,select,[contenteditable]');
          if (inp && !(inp.type && SKIP.has(inp.type))) { seen.add(text); results.push(text); }
        }

        // 2. aria-label
        for (const el of document.querySelectorAll('input,textarea')) {
          if (el.type && SKIP.has(el.type)) continue;
          if (!el.offsetParent) continue;
          const ariaId = el.getAttribute('aria-labelledby');
          const q = clean(el.getAttribute('aria-label') || (ariaId && document.getElementById(ariaId)?.innerText) || '');
          if (good(q) && !seen.has(q)) { seen.add(q); results.push(q); }
        }

        // 3. question-style text near inputs
        const starts = /^(why|what|how|describe|tell|explain|when|where|who|please|share|write|mention|list|give|state|provide|briefly)/i;
        for (const el of document.querySelectorAll('p,h1,h2,h3,h4,div,span,[class*="question"],[class*="Question"]')) {
          const text = clean(el.innerText);
          if (!good(text) || seen.has(text) || !starts.test(text)) continue;
          const parent = el.closest('div,section,li,form');
          if (parent?.querySelector('input[type="text"],textarea,[contenteditable]')) {
            seen.add(text); results.push(text);
          }
        }

        // 4. placeholder fallback
        for (const el of document.querySelectorAll('input[type="text"],textarea')) {
          if (!el.offsetParent) continue;
          const q = clean(el.placeholder);
          if (good(q) && q.length > 10 && !seen.has(q)) { seen.add(q); results.push(q); }
        }

        // 5. Internshala / Unstop specific
        for (const el of document.querySelectorAll('.assessment_question,.question-text,[class*="questionText"],[class*="question_text"]')) {
          const text = clean(el.innerText);
          if (good(text) && !seen.has(text)) { seen.add(text); results.push(text); }
        }

        return results.slice(0, 15);
      });

      return { questions };
    }
  `

  const res = await fetch(`https://chrome.browserless.io/function?token=${TOKEN}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/javascript' },
    body:    extractFn,
    signal:  AbortSignal.timeout(35000),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Browserless HTTP ${res.status}: ${text.slice(0,200)}`)
  }

  const data      = await res.json()
  const questions = data?.questions || data?.data?.questions || []

  console.log(`[Scraper] Browserless found ${questions.length} questions`)
  return { questions, error: null }
}