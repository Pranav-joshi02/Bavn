// ============================================
// BAVN.io — utils/filler.js
// Fills form fields with AI-generated answers
// ============================================

/**
 * Fill a list of fields with their answers.
 * @param {Array<{ element, question, answer }>} items
 */
export function fillFields(items) {
  for (const { element, answer } of items) {
    if (!element || !answer) continue
    fillField(element, answer)
  }
}

function fillField(el, value) {
  const tag = el.tagName.toLowerCase()

  if (tag === 'select') {
    fillSelect(el, value)
  } else {
    // input / textarea — trigger React/Vue change detection too
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set
    const nativeTextareaSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set

    if (tag === 'textarea' && nativeTextareaSetter) {
      nativeTextareaSetter.call(el, value)
    } else if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value)
    } else {
      el.value = value
    }

    el.dispatchEvent(new Event('input',  { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  // Brief highlight so user sees what was filled
  highlight(el)
}

function fillSelect(el, value) {
  const lower = value.toLowerCase()
  for (const option of el.options) {
    if (option.text.toLowerCase().includes(lower) ||
        option.value.toLowerCase().includes(lower)) {
      el.value = option.value
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return
    }
  }
}

function highlight(el) {
  const prev = el.style.outline
  el.style.outline = '2px solid #00e5ff'
  el.style.transition = 'outline 0.4s'
  setTimeout(() => { el.style.outline = prev }, 1500)
}
