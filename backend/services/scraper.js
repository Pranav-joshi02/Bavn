// ============================================
// BAVN.io — services/scraper.js
// Scrapes form questions from any URL
// Works for: Google Forms, Internshala,
// Unstop, LinkedIn, Naukri, generic HTML forms
// ============================================

// ── Main scraper ──────────────────────────
export async function scrapeFormQuestions(url) {
  try {
    const html = await fetchHtml(url)
    if (!html) return { questions: [], error: 'Could not fetch page' }

    const questions = extractQuestions(html, url)

    if (!questions.length) {
      return { questions: [], error: 'No questions found on this page' }
    }

    return { questions, error: null }

  } catch(e) {
    console.error('[BAVN Scraper] Error:', e.message)
    return { questions: [], error: e.message }
  }
}

// ── Fetch HTML ────────────────────────────
async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

// ── Extract questions from HTML ───────────
function extractQuestions(html, url) {
  const domain = new URL(url).hostname.toLowerCase()

  // Platform-specific extractors first
  if (domain.includes('docs.google.com') || domain.includes('forms.gle')) {
    return extractGoogleForms(html)
  }
  if (domain.includes('internshala.com')) {
    return extractInternshala(html)
  }
  if (domain.includes('unstop.com') || domain.includes('dare2compete.com')) {
    return extractUnstop(html)
  }
  if (domain.includes('linkedin.com')) {
    return extractLinkedIn(html)
  }
  if (domain.includes('naukri.com')) {
    return extractNaukri(html)
  }
  if (domain.includes('typeform.com')) {
    return extractTypeform(html)
  }

  // Generic fallback — works for most standard HTML forms
  return extractGeneric(html)
}

// ── Google Forms ──────────────────────────
function extractGoogleForms(html) {
  const questions = []

  // Google Forms embeds question data as JSON in the page
  // Pattern: FB_PUBLIC_LOAD_DATA_ = [...]
  const dataMatch = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/)
  if (dataMatch) {
    try {
      const data  = JSON.parse(dataMatch[1])
      const items = data?.[1]?.[1] || []
      for (const item of items) {
        const title = item?.[1]
        const type  = item?.[3]  // 0=short, 1=paragraph, 2=multiple choice etc
        if (title && typeof title === 'string' && title.trim()) {
          const isText = [0, 1].includes(type)
          if (isText) questions.push(clean(title))
        }
      }
      if (questions.length) return questions
    } catch(e) {}
  }

  // Fallback: scrape visible question text
  const matches = html.matchAll(/class="[^"]*freebirdFormviewerViewItemsItemItemTitle[^"]*"[^>]*>([^<]{3,200})<\/div>/g)
  for (const m of matches) {
    const q = clean(m[1])
    if (q && q.length >= 3) questions.push(q)
  }

  return questions
}

// ── Internshala ───────────────────────────
function extractInternshala(html) {
  const questions = []

  // Internshala application questions are in specific divs
  const patterns = [
    /class="[^"]*assessment_question[^"]*"[^>]*>[\s\S]*?<[^>]*>\s*([^<]{10,300})\s*</g,
    /class="[^"]*question[^"]*"[^>]*>\s*<[^>]*>\s*([^<]{10,300})\s*</g,
    /<label[^>]*>\s*([^<]{10,200})\s*<\/label>/g,
    // Cover letter / SOP questions
    /Why\s+do\s+you\s+want[^<]{0,200}/gi,
    /Describe[^<]{0,200}/gi,
    /What\s+(?:are|is|makes|do)[^<]{0,200}/gi,
    /Tell\s+us[^<]{0,200}/gi,
  ]

  for (const pattern of patterns) {
    const matches = [...html.matchAll(pattern)]
    for (const m of matches) {
      const q = clean(m[1] || m[0])
      if (q && q.length >= 10 && q.length < 300 && !questions.includes(q)) {
        questions.push(q)
      }
    }
  }

  // Also grab textarea labels which are common in Internshala
  const labelMatches = html.matchAll(/<label[^>]*for="[^"]*"[^>]*>\s*([\s\S]{10,200}?)\s*<\/label>/g)
  for (const m of labelMatches) {
    const q = clean(m[1])
    if (q && q.length >= 10 && !questions.includes(q)) {
      questions.push(q)
    }
  }

  return questions.slice(0, 10)
}

// ── Unstop ────────────────────────────────
function extractUnstop(html) {
  const questions = []

  const patterns = [
    /<h[1-6][^>]*class="[^"]*question[^"]*"[^>]*>([\s\S]{5,300}?)<\/h/g,
    /class="[^"]*form[-_]question[^"]*"[^>]*>([\s\S]{5,300}?)<\//g,
    /<label[^>]*>\s*([\s\S]{10,200}?)\s*<\/label>/g,
  ]

  for (const pattern of patterns) {
    for (const m of [...html.matchAll(pattern)]) {
      const q = clean(m[1])
      if (q && q.length >= 5 && !questions.includes(q)) questions.push(q)
    }
  }

  return questions.slice(0, 10)
}

// ── LinkedIn Easy Apply ───────────────────
function extractLinkedIn(html) {
  const questions = []

  const patterns = [
    /<label[^>]*class="[^"]*artdeco[^"]*"[^>]*>([\s\S]{3,200}?)<\/label>/g,
    /<h3[^>]*>([\s\S]{5,200}?)<\/h3>/g,
    /aria-label="([^"]{5,200})"/g,
  ]

  for (const pattern of patterns) {
    for (const m of [...html.matchAll(pattern)]) {
      const q = clean(m[1])
      if (q && q.length >= 5 && !questions.includes(q)) questions.push(q)
    }
  }

  return questions.slice(0, 10)
}

// ── Naukri ────────────────────────────────
function extractNaukri(html) {
  const questions = []

  const patterns = [
    /<label[^>]*>([\s\S]{5,200}?)<\/label>/g,
    /class="[^"]*question[^"]*"[^>]*>([\s\S]{5,200}?)<\//g,
  ]

  for (const pattern of patterns) {
    for (const m of [...html.matchAll(pattern)]) {
      const q = clean(m[1])
      if (q && q.length >= 5 && !questions.includes(q)) questions.push(q)
    }
  }

  return questions.slice(0, 10)
}

// ── Typeform ──────────────────────────────
function extractTypeform(html) {
  const questions = []

  // Typeform embeds data as JSON
  const match = html.match(/window\.__REDUX_STATE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/)
  if (match) {
    try {
      const data   = JSON.parse(match[1])
      const fields = data?.form?.fields || []
      for (const f of fields) {
        if (f.title && ['short_text','long_text','multiple_choice'].includes(f.type)) {
          questions.push(clean(f.title))
        }
      }
      if (questions.length) return questions
    } catch(e) {}
  }

  return extractGeneric(html)
}

// ── Generic HTML form scraper ─────────────
// Works on most standard forms
function extractGeneric(html) {
  const questions = []
  const seen      = new Set()

  // Strategy 1: <label> tags — most reliable
  for (const m of html.matchAll(/<label[^>]*>([\s\S]{3,200}?)<\/label>/gi)) {
    const q = clean(m[1])
    if (isGoodQuestion(q) && !seen.has(q)) {
      seen.add(q)
      questions.push(q)
    }
  }

  // Strategy 2: aria-label on inputs
  for (const m of html.matchAll(/(?:input|textarea|select)[^>]*aria-label="([^"]{3,200})"/gi)) {
    const q = clean(m[1])
    if (isGoodQuestion(q) && !seen.has(q)) {
      seen.add(q)
      questions.push(q)
    }
  }

  // Strategy 3: placeholder text (often has the question)
  for (const m of html.matchAll(/(?:input|textarea)[^>]*placeholder="([^"]{10,200})"/gi)) {
    const q = clean(m[1])
    if (isGoodQuestion(q) && !seen.has(q)) {
      seen.add(q)
      questions.push(q)
    }
  }

  // Strategy 4: headings near inputs (question-style text)
  for (const m of html.matchAll(/<(?:h[1-6]|p|div)[^>]*>\s*((?:Why|What|How|Describe|Tell|Explain|When|Where|Who|Please)[^<]{5,200})\s*</gi)) {
    const q = clean(m[1])
    if (isGoodQuestion(q) && !seen.has(q)) {
      seen.add(q)
      questions.push(q)
    }
  }

  return questions.slice(0, 12)
}

// ── Helpers ───────────────────────────────
function clean(str) {
  return String(str || '')
    .replace(/<[^>]+>/g, ' ')  // strip HTML tags
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g,    ' ')
    .replace(/[*:]+$/,  '')
    .trim()
}

function isGoodQuestion(q) {
  if (!q || q.length < 5 || q.length > 300) return false
  // Skip labels that are clearly not questions
  const skip = /^(submit|cancel|next|back|upload|browse|choose|select|click|yes|no|male|female|other|add|remove|\d+)$/i
  if (skip.test(q)) return false
  // Skip things that are clearly UI labels not questions
  if (/^(first name|last name|full name|email|phone|mobile|address|city|state|country|pincode|zip)$/i.test(q)) return false
  return true
}