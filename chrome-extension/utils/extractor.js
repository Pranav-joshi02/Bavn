// ============================================
// BAVN.io — utils/extractor.js
// Scans the DOM and extracts labelled form fields
// Returns: [{ element, question, type }]
// ============================================

const SKIP_TYPES  = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file', 'checkbox', 'radio'])
const SKIP_NAMES  = /email|phone|tel|name|date|zip|postal|captcha|token|csrf/i
const MIN_LABEL_LEN = 3

/**
 * Extract all answerable questions from the current page.
 * Returns array of { element, question, type }
 */
export function extractQuestions() {
  const results = []
  const seen = new Set()

  const fields = [
    ...document.querySelectorAll('input:not([type]), input[type="text"], input[type="url"], textarea'),
    ...document.querySelectorAll('select'),
  ]

  for (const el of fields) {
    if (el.type && SKIP_TYPES.has(el.type))  continue
    if (el.name  && SKIP_NAMES.test(el.name)) continue
    if (el.id    && SKIP_NAMES.test(el.id))   continue
    if (!isVisible(el)) continue

    const label = findLabel(el)
    if (!label || label.length < MIN_LABEL_LEN) continue
    if (seen.has(label)) continue

    seen.add(label)
    results.push({
      element:  el,
      question: label,
      type:     el.tagName === 'SELECT' ? 'select' : (el.tagName === 'TEXTAREA' ? 'textarea' : 'text'),
    })
  }

  return results
}

// ── Find the best label text for a field ──
function findLabel(el) {
  // 1. <label for="id">
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`)
    if (label) return clean(label.textContent)
  }

  // 2. aria-label / aria-labelledby
  if (el.getAttribute('aria-label')) {
    return clean(el.getAttribute('aria-label'))
  }
  if (el.getAttribute('aria-labelledby')) {
    const ref = document.getElementById(el.getAttribute('aria-labelledby'))
    if (ref) return clean(ref.textContent)
  }

  // 3. Wrapping <label>
  const wrapping = el.closest('label')
  if (wrapping) return clean(wrapping.textContent)

  // 4. Preceding sibling / parent text
  const parent = el.parentElement
  if (parent) {
    // look for a sibling label-like element
    const prev = el.previousElementSibling
    if (prev && /label|span|p|div|legend/i.test(prev.tagName)) {
      const t = clean(prev.textContent)
      if (t.length >= MIN_LABEL_LEN) return t
    }
    // parent direct text nodes
    const parentText = clean(parent.textContent)
    if (parentText.length >= MIN_LABEL_LEN && parentText.length < 200) return parentText
  }

  // 5. placeholder as fallback
  if (el.placeholder) return clean(el.placeholder)

  // 6. name attribute humanised
  if (el.name) return humanise(el.name)

  return null
}

function clean(str) {
  return str.replace(/\s+/g, ' ').replace(/[*:]+$/, '').trim()
}

function humanise(name) {
  return name.replace(/[_\-]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
}

function isVisible(el) {
  const style = getComputedStyle(el)
  return (
    style.display    !== 'none'   &&
    style.visibility !== 'hidden' &&
    style.opacity    !== '0'      &&
    el.offsetParent  !== null
  )
}
