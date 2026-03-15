// ============================================
// BAVN.io — routes/telegram.js
// Full Telegram bot — forms, reviews, memory,
// Google account linking, extension bridge
// ============================================
import { supabase }              from '../services/supabase.js'
import { scrapeFormQuestions }   from '../services/scraper.js'
import { fillAndSubmitForm, hasSession } from '../services/browser.js'
import {
  generateAnswers,
  regenerateSingleAnswer,
  generateReview,
  regenerateReview,
} from '../services/ai.js'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const BASE_URL  = process.env.BASE_URL || 'https://bavn-backend.onrender.com'
const WEBHOOK   = `${BASE_URL}/api/telegram/webhook`

// ── Telegram API ──────────────────────────
async function tg(method, body = {}) {
  if (!BOT_TOKEN) return {}
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  return res.json()
}

async function sendMessage(chatId, text, extra = {}) {
  return tg('sendMessage', {
    chat_id:    chatId,
    text,
    parse_mode: 'Markdown',
    ...extra,
  })
}

async function sendButtons(chatId, text, buttons) {
  return tg('sendMessage', {
    chat_id:      chatId,
    text,
    parse_mode:   'Markdown',
    reply_markup: {
      keyboard:          buttons.map(row => row.map(label => ({ text: label }))),
      resize_keyboard:   true,
      one_time_keyboard: true,
    },
  })
}

async function removeKeyboard(chatId, text) {
  return tg('sendMessage', {
    chat_id:      chatId,
    text,
    parse_mode:   'Markdown',
    reply_markup: { remove_keyboard: true },
  })
}

// ── Sessions ──────────────────────────────
const sessions = {}

function getSession(chatId) {
  if (!sessions[chatId]) resetSession(chatId)
  return sessions[chatId]
}

function resetSession(chatId) {
  sessions[chatId] = {
    state:           'idle',
    mode:            null,
    userId:          null,
    account:         null,   // selected linked account {id, email, label}
    formUrl:         '',
    questions:       [],
    answers:         [],
    place:           '',
    experience:      '',
    stars:           0,
    platform:        '',
    review:          '',
    newAccountLabel: null,
  }
}

// ── Helpers ───────────────────────────────
const isSubmit  = t => /^(submit|yes|confirm|go|send it|✅ submit)$/i.test(t.trim())
const isPost    = t => /^(post|yes|confirm|post it|submit|✅ post)$/i.test(t.trim())
const isConfirm = t => /^(yes|correct|right|yep|ok|okay|sure|yup|✅ yes)$/i.test(t.trim())

function detectPlatform(text) {
  const t = text.toLowerCase()
  if (t.includes('zomato'))                          return 'Zomato'
  if (t.includes('swiggy'))                          return 'Swiggy'
  if (t.includes('google'))                          return 'Google Maps'
  if (t.includes('tripadvisor'))                     return 'TripAdvisor'
  if (t.includes('amazon'))                          return 'Amazon'
  if (t.includes('makemytrip') || t.includes('mmt')) return 'MakeMyTrip'
  return 'Zomato'
}

function parsePlatformOverride(text) {
  const platforms = ['Zomato','Swiggy','Google Maps','TripAdvisor','Amazon','MakeMyTrip']
  for (const p of platforms) {
    if (text.toLowerCase().includes(p.toLowerCase())) return p
  }
  return null
}

function parseChange(text) {
  const m = text.match(/change\s+q(\d+)\s+(.+)/i)
  if (m) return { qIndex: parseInt(m[1]) - 1, instruction: m[2].trim() }
  return null
}

function formatAnswers(answers) {
  return answers.map((a, i) =>
    `*Q${i+1}.* ${a.question.slice(0,60)}${a.question.length>60?'…':''}\n→ ${a.answer}`
  ).join('\n\n')
}

// ── Main menu ─────────────────────────────
async function showMainMenu(chatId, text = 'What would you like to do? 👇') {
  await sendButtons(chatId, text,
    [['📋 Fill Form', '⭐ Write Review'], ['🧠 Memory', '🔗 Accounts']]
  )
}

// ── Main handler ──────────────────────────
async function handleMessage(chatId, userId, text) {
  const sess = getSession(chatId)
  sess.userId = userId
  const msg   = text.trim()
  const low   = msg.toLowerCase()

  // ── Global commands ───────────────────────
  if (low === 'cancel' || low === 'reset' || low === '/cancel') {
    resetSession(chatId)
    await showMainMenu(chatId, '🔄 Reset. What would you like to do?')
    return
  }

  if (low === '/start' || low === '/help' || low === 'help') {
    await sendButtons(chatId,
      `👋 *Welcome to BAVN Bot!*\n\n` +
      `📋 *Fill Form* — send a form URL, I generate answers and push them to your browser\n` +
      `⭐ *Write Review* — describe your experience, I write a polished review\n` +
      `🧠 *Memory* — see your saved answers\n` +
      `🔗 *Accounts* — link your Google accounts\n\n` +
      `Tap a button to get started 👇`,
      [['📋 Fill Form', '⭐ Write Review'], ['🧠 Memory', '🔗 Accounts']]
    )
    return
  }

  if (low === 'memory' || low === '/memory' || low === '🧠 memory') {
    const { data } = await supabase
      .from('answers').select('question,answer')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(5)
    if (!data?.length) {
      await sendButtons(chatId,
        '🧠 No saved answers yet.\n\nFill a form first and your answers will be saved here.',
        [['📋 Fill Form', '⭐ Write Review']]
      )
      return
    }
    const list = data.map((a, i) =>
      `${i+1}. _${a.question.slice(0,50)}${a.question.length>50?'…':''}_\n→ ${a.answer.slice(0,80)}${a.answer.length>80?'…':''}`
    ).join('\n\n')
    await sendButtons(chatId, `🧠 *Last 5 saved answers:*\n\n${list}`,
      [['📋 Fill Form', '⭐ Write Review']]
    )
    return
  }

  if (low === 'accounts' || low === '/accounts' || low === '🔗 accounts') {
    await showAccountsMenu(chatId, userId)
    return
  }

  // ── State machine ─────────────────────────

  // ═══ IDLE ════════════════════════════════
  if (sess.state === 'idle') {
    if (low === '📋 fill form' || low === 'hi form' || low === 'fill form') {
      sess.mode = 'form'
      await pickAccount(chatId, userId, sess)
      return
    }
    if (low === '⭐ write review' || low === 'hi review' || low === 'review') {
      sess.mode = 'review'
      await pickAccount(chatId, userId, sess)
      return
    }
    await showMainMenu(chatId)
    return
  }

  // ═══ ACCOUNT SELECTION ═══════════════════
  if (sess.state === 'awaiting_account') {
    const { data: accs } = await supabase
      .from('linked_accounts').select('*')
      .eq('user_id', userId).order('created_at', { ascending: true })

    if (low === '➕ add account' || low === 'new' || low === 'add') {
      sess.state = 'awaiting_account_label'
      await removeKeyboard(chatId,
        `What should I call this account?\n_(e.g. "College", "Work", "Personal")_`)
      return
    }

    // Skip — proceed without selecting account
    if (low === '⏭ skip' || low === 'skip') {
      sess.account = null
      await proceedAfterAccount(chatId, sess)
      return
    }

    const num = parseInt(low)
    if (!isNaN(num) && accs?.[num - 1]) {
      sess.account = accs[num - 1]
      await supabase.from('linked_accounts')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', sess.account.id)
      await proceedAfterAccount(chatId, sess)
      return
    }

    await sendMessage(chatId, `Reply with a number to select, *skip* to continue without, or *add* to add a new account.`)
    return
  }

  // ═══ ADD ACCOUNT: LABEL ══════════════════
  if (sess.state === 'awaiting_account_label') {
    sess.newAccountLabel = msg
    sess.state = 'awaiting_account_email'
    await removeKeyboard(chatId,
      `What's the Gmail address for *${msg}*?\n_(e.g. pranav@gmail.com)_`)
    return
  }

  // ═══ ADD ACCOUNT: EMAIL ══════════════════
  if (sess.state === 'awaiting_account_email') {
    const email = msg.toLowerCase().trim()
    if (!email.includes('@')) {
      await sendMessage(chatId, `That doesn't look like an email. Please send a valid Gmail address.`)
      return
    }

    // Save linked account
    const { data: existing } = await supabase
      .from('linked_accounts').select('id').eq('user_id', userId).eq('email', email).single()

    if (!existing) {
      // Check if first account (make default)
      const { count } = await supabase
        .from('linked_accounts').select('id', { count: 'exact', head: true })
        .eq('user_id', userId)

      await supabase.from('linked_accounts').insert({
        user_id:      userId,
        email,
        label:        sess.newAccountLabel || 'Personal',
        is_default:   count === 0,
        last_used_at: new Date().toISOString()
      })
    }

    const { data: acc } = await supabase
      .from('linked_accounts').select('*')
      .eq('user_id', userId).eq('email', email).single()

    sess.account = acc
    await proceedAfterAccount(chatId, sess)
    await sendMessage(chatId, `✅ *${email}* linked as _${sess.newAccountLabel || 'Personal'}_`)
    return
  }

  // ═══ FORM: MANUAL QUESTIONS ══════════════
  if (sess.state === 'awaiting_manual_questions') {
    // User typed questions manually, one per line
    const questions = msg.split('\n')
      .map(q => q.trim())
      .filter(q => q.length >= 5)

    if (!questions.length) {
      await sendMessage(chatId, `Please type at least one question.`)
      return
    }

    sess.questions = questions
    sess.state = 'form_preview'
    await sendMessage(chatId, `⏳ Generating answers for ${questions.length} question(s)...`)

    const { data: profile } = await supabase
      .from('profiles').select('*').eq('user_id', userId).single()

    let answers
    try {
      answers = await generateAnswers(questions, profile)
      sess.answers = answers
    } catch(e) {
      resetSession(chatId)
      await showMainMenu(chatId, `Sorry, couldn't generate answers. Please try again.`)
      return
    }

    await supabase.from('fill_jobs').insert({
      user_id:  userId,
      status:   'pending',
      form_url: sess.formUrl,
      answers,
    })

    for (const a of answers) {
      await supabase.from('answers').upsert({
        user_id: userId, question: a.question,
        answer: a.answer, source_url: sess.formUrl,
      }, { onConflict: 'user_id,question' })
    }

    const acctLine = sess.account ? `\n_Account: ${sess.account.email}_` : ''
    await sendButtons(chatId,
      `✅ *${answers.length} answers ready* 👇${acctLine}\n\n` +
      `${formatAnswers(answers)}\n\n` +
      `——\n📱 *Open the form in Chrome* — BAVN extension will auto-fill it`,
      [['✅ Save to Memory', '👁 Preview All'], ['✏️ Change Answer', '❌ Cancel']]
    )
    return
  }

  // ═══ FORM: AWAITING URL ══════════════════
  if (sess.state === 'awaiting_link') {
    if (!msg.match(/https?:\/\//)) {
      await sendMessage(chatId, `Please send a valid form URL starting with http or https 🔗`)
      return
    }
    sess.formUrl = msg
    sess.state   = 'generating_form'
    await sendMessage(chatId, `🔍 Scanning form questions...`)

    const { data: profile } = await supabase
      .from('profiles').select('*').eq('user_id', userId).single()

    // Scrape questions — 25s max
    let questions = []
    try {
      const result = await Promise.race([
        scrapeFormQuestions(sess.formUrl, userId),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 25000))
      ])
      questions = result.questions || []
    } catch(e) {
      console.error('[BAVN TG] Scrape failed:', e.message)
    }

    if (!questions.length) {
      sess.state = 'awaiting_manual_questions'
      await sendMessage(chatId,
        `⚠️ Couldn't auto-detect questions.\n\n` +
        `Type the questions below, *one per line*:\n\n` +
        `_Why do you want to apply?_\n` +
        `_What is your expected stipend?_\n\n` +
        `_Or /cancel to start over_`
      )
      return
    }

    sess.questions = questions
    sess.state     = 'form_preview'
    await sendMessage(chatId, `✅ Found *${questions.length} questions* — generating answers...`)

    let answers
    try {
      answers = await generateAnswers(questions, profile)
      sess.answers = answers
    } catch(e) {
      resetSession(chatId)
      await showMainMenu(chatId, `Sorry, couldn't generate answers. Please try again.`)
      return
    }

    await supabase.from('fill_jobs').insert({
      user_id: userId, status: 'pending',
      form_url: sess.formUrl, answers,
    })
    for (const a of answers) {
      await supabase.from('answers').upsert({
        user_id: userId, question: a.question,
        answer: a.answer, source_url: sess.formUrl,
      }, { onConflict: 'user_id,question' })
    }

    const acctLine  = sess.account ? `\n_Account: ${sess.account.email}_` : ''
    const hasS      = await hasSession(userId).catch(() => false)
    const submitBtn = hasS ? '🚀 Auto-Submit' : '✅ Save to Memory'

    await sendButtons(chatId,
      `✅ *${answers.length} answers ready* 👇${acctLine}\n\n` +
      `${formatAnswers(answers)}\n\n——\n` +
      `📱 Open form in Chrome — extension auto-fills it`,
      [[submitBtn, '👁 Preview All'], ['✏️ Change Answer', '❌ Cancel']]
    )
    return
  }
  // ═══ FORM: PREVIEW ═══════════════════════
  if (sess.state === 'form_preview') {

    // ── Auto-Submit via Browserless ───────────
    if (low === '🚀 auto-submit') {
      await sendMessage(chatId, `🤖 Starting auto-submit...\n\n_Opening form in browser, filling fields and submitting. This takes ~30 seconds._`)

      try {
        const result = await fillAndSubmitForm({
          userId,
          formUrl: sess.formUrl,
          answers: sess.answers,
        })

        // Save to memory
        for (const a of sess.answers) {
          await supabase.from('answers').upsert({
            user_id: userId, question: a.question,
            answer: a.answer, source_url: sess.formUrl,
          }, { onConflict: 'user_id,question' })
        }

        resetSession(chatId)
        await sendButtons(chatId,
          `✅ *Form submitted!*\n\n` +
          `📄 Pages filled: ${result.pagesCompleted}\n` +
          `✏️ Fields filled: ${result.fieldsFilled}\n\n` +
          `Answers saved to memory. Good luck! 🚀`,
          [['📋 Fill Another Form', '⭐ Write Review']]
        )

      } catch(e) {
        if (e.message === 'NO_SESSION') {
          await sendButtons(chatId,
            `⚠️ *No session found.*\n\n` +
            `Run this command on your laptop first:\n` +
            `\`\`\`\nnode scripts/capture-session.js your@email.com\n\`\`\`\n\n` +
            `This logs you into Google once and saves the session.\n\n` +
            `Or tap *Save to Memory* — extension will auto-fill instead.`,
            [['✅ Save to Memory', '❌ Cancel']]
          )
        } else if (e.message === 'LOGIN_REQUIRED') {
          await sendButtons(chatId,
            `⚠️ *Login required.*\n\n` +
            `Your session expired. Re-run the capture script:\n` +
            `\`\`\`\nnode scripts/capture-session.js your@email.com\n\`\`\``,
            [['✅ Save to Memory', '❌ Cancel']]
          )
        } else {
          await sendButtons(chatId,
            `❌ *Auto-submit failed:* ${e.message}\n\n` +
            `Extension fill still works — open the form in Chrome.`,
            [['✅ Save to Memory', '❌ Cancel']]
          )
        }
      }
      return
    }

    // ── Save to memory ─────────────────────────
    if (isSubmit(low) || low === '✅ save to memory') {
      for (const a of sess.answers) {
        await supabase.from('answers').upsert({
          user_id: userId, question: a.question,
          answer: a.answer, source_url: sess.formUrl
        }, { onConflict: 'user_id,question' })
      }
      resetSession(chatId)
      await sendButtons(chatId,
        `✅ *Answers saved to memory!*\n\nOpen the form in Chrome — BAVN will auto-fill it. 🚀`,
        [['📋 Fill Another Form', '⭐ Write Review']]
      )
      return
    }

    if (low === '👁 preview all' || low === 'preview') {
      await sendButtons(chatId,
        `📋 *All answers:*\n\n${formatAnswers(sess.answers)}\n\n——\nChange an answer or save to memory`,
        [['✅ Save to Memory', '✏️ Change Answer'], ['❌ Cancel']]
      )
      return
    }

    if (low === '✏️ change answer' || low === 'change') {
      await removeKeyboard(chatId,
        `Which answer to change?\n\n_e.g. "change Q2 make it more confident"_`)
      return
    }

    const change = parseChange(msg)
    if (change) {
      const { qIndex, instruction } = change
      if (qIndex < 0 || qIndex >= sess.answers.length) {
        await sendMessage(chatId, `Q${qIndex+1} doesn't exist. There are ${sess.answers.length} questions.`)
        return
      }
      await sendMessage(chatId, `✏️ Regenerating Q${qIndex+1}...`)
      const { data: profile } = await supabase
        .from('profiles').select('*').eq('user_id', userId).single()
      const updated = await regenerateSingleAnswer(
        sess.answers[qIndex].question, instruction, profile
      )
      sess.answers[qIndex].answer = updated

      // Update the fill job with new answers
      await supabase.from('fill_jobs')
        .update({ answers: sess.answers })
        .eq('user_id', userId).eq('status', 'pending')

      await sendButtons(chatId,
        `✏️ *Updated Q${qIndex+1}* 👇\n\n→ ${updated}\n\n——\nAnything else or save to memory`,
        [['✅ Save to Memory', '👁 Preview All'], ['✏️ Change Answer', '❌ Cancel']]
      )
      return
    }

    await sendButtons(chatId,
      `To change: _"change Q2 make it more detailed"_`,
      [['✅ Save to Memory', '👁 Preview All'], ['❌ Cancel']]
    )
    return
  }

  // ═══ REVIEW: AWAITING PLACE ══════════════
  if (sess.state === 'awaiting_place') {
    sess.experience = msg
    sess.place      = msg.split(',')[0].trim()
    sess.state      = 'awaiting_stars'
    await sendButtons(chatId, `Nice! How many stars? ⭐`,
      [['⭐ 1', '⭐⭐ 2', '⭐⭐⭐ 3'], ['⭐⭐⭐⭐ 4', '⭐⭐⭐⭐⭐ 5']]
    )
    return
  }

  // ═══ REVIEW: AWAITING STARS ══════════════
  if (sess.state === 'awaiting_stars') {
    const stars = parseInt(msg.replace(/[^1-5]/g, ''))
    if (isNaN(stars) || stars < 1 || stars > 5) {
      await sendMessage(chatId, `Please send a number between 1 and 5 ⭐`)
      return
    }
    sess.stars    = stars
    sess.platform = detectPlatform(sess.experience + ' ' + sess.place)
    sess.state    = 'awaiting_platform_confirm'
    await sendButtons(chatId,
      `Detected: *${sess.platform}* 🎯\n\nCorrect?`,
      [['✅ Yes', 'Google Maps', 'Zomato'], ['Swiggy', 'TripAdvisor', 'Amazon']]
    )
    return
  }

  // ═══ REVIEW: PLATFORM CONFIRM ════════════
  if (sess.state === 'awaiting_platform_confirm') {
    const override = parsePlatformOverride(msg)
    if (override) sess.platform = override
    else if (!isConfirm(low)) {
      await sendMessage(chatId, `Confirm with *yes* or pick a platform above`)
      return
    }
    await sendMessage(chatId, `✍️ Writing your ${sess.platform} review...`)
    let review
    try {
      review = await generateReview(sess.experience, sess.platform, sess.stars)
      sess.review = review
    } catch(e) {
      resetSession(chatId)
      await showMainMenu(chatId, `Couldn't generate review. Please try again.`)
      return
    }
    sess.state = 'review_preview'
    const stars = '⭐'.repeat(sess.stars)
    await sendButtons(chatId,
      `Here's your *${sess.platform}* review 👇\n\n${stars}\n_"${review}"_\n\n——\nTo change: _"make it shorter"_ or _"make it formal"_`,
      [['✅ Post Review', '❌ Cancel']]
    )
    return
  }

  // ═══ REVIEW: PREVIEW ═════════════════════
  if (sess.state === 'review_preview') {
    if (isPost(low) || low === '✅ post review') {
      await supabase.from('reviews').insert({
        user_id: userId, platform: sess.platform,
        place_name: sess.place, user_context: sess.experience,
        generated_review: sess.review, star_rating: sess.stars, submitted: true
      })
      const stars = '⭐'.repeat(sess.stars)
      resetSession(chatId)
      await sendButtons(chatId,
        `✅ *Review saved!* ${stars}\n\n_Copy and paste it on ${sess.platform}_`,
        [['📋 Fill Form', '⭐ Write Review']]
      )
      return
    }

    await sendMessage(chatId, `✏️ Regenerating...`)
    let updated
    try {
      updated = await regenerateReview(
        sess.experience, sess.platform, sess.stars, sess.review, msg
      )
      sess.review = updated
    } catch(e) {
      await sendMessage(chatId, `Couldn't regenerate. Send *post* to use current version.`)
      return
    }
    const stars = '⭐'.repeat(sess.stars)
    await sendButtons(chatId,
      `✏️ *Updated review* 👇\n\n${stars}\n_"${updated}"_\n\n——\nAnything else or tap Post`,
      [['✅ Post Review', '❌ Cancel']]
    )
    return
  }

  // ── Fallback — show main menu ─────────────
  await showMainMenu(chatId)
}

// ── Account picker ────────────────────────
async function pickAccount(chatId, userId, sess) {
  const { data: accs } = await supabase
    .from('linked_accounts').select('*')
    .eq('user_id', userId).order('created_at', { ascending: true })

  const modeLabel = sess.mode === 'form' ? 'fill the form' : 'post the review'

  if (!accs?.length) {
    // No accounts — offer to add one or skip
    sess.state = 'awaiting_account'
    await sendButtons(chatId,
      `Which Google account should I use to ${modeLabel}?\n\n_No accounts linked yet. Add one or skip._`,
      [['➕ Add Account', '⏭ Skip']]
    )
    return
  }

  sess.state = 'awaiting_account'
  const rows = accs.map((a, i) =>
    [`${i+1} · ${a.label || a.email}${a.is_default ? ' ⭐' : ''}`]
  )
  rows.push(['➕ Add Account', '⏭ Skip'])

  await sendButtons(chatId,
    `Which Google account for ${modeLabel}?`,
    rows
  )
}

// ── After account selected ─────────────────
async function proceedAfterAccount(chatId, sess) {
  if (sess.mode === 'form') {
    sess.state = 'awaiting_link'
    const acctLine = sess.account ? `Using *${sess.account.label || sess.account.email}* ✓\n\n` : ''
    await removeKeyboard(chatId, `${acctLine}Send me the form URL 🔗`)
    return
  }
  if (sess.mode === 'review') {
    sess.state = 'awaiting_place'
    const acctLine = sess.account ? `Using *${sess.account.label || sess.account.email}* ✓\n\n` : ''
    await removeKeyboard(chatId,
      `${acctLine}Which place and what was your experience?\n\n_e.g. "Barbeque Nation Pune, great food but slow service"_`
    )
    return
  }
}

// ── Accounts menu ─────────────────────────
async function showAccountsMenu(chatId, userId) {
  const { data: accs } = await supabase
    .from('linked_accounts').select('*')
    .eq('user_id', userId).order('created_at', { ascending: true })

  if (!accs?.length) {
    await sendButtons(chatId,
      `🔗 *No accounts linked yet.*\n\nLink a Google account so BAVN knows which Gmail to associate with your forms.`,
      [['➕ Add Account', '🏠 Back']]
    )
    return
  }

  const list = accs.map((a, i) =>
    `${i+1} · *${a.label || 'Account'}* — ${a.email}${a.is_default ? ' ⭐' : ''}`
  ).join('\n')

  await sendButtons(chatId,
    `🔗 *Linked accounts:*\n\n${list}\n\n_Reply *remove [number]* to unlink_`,
    [['➕ Add Account', '🏠 Back']]
  )
}

// ── Webhook setup ─────────────────────────
export async function setupTelegramWebhook() {
  if (!BOT_TOKEN) {
    console.log('[BAVN TG] No TELEGRAM_BOT_TOKEN — bot disabled')
    return
  }
  const res = await tg('setWebhook', { url: WEBHOOK, drop_pending_updates: true })
  console.log('[BAVN TG] Webhook:', res.ok ? '✓' : res.description)
  await tg('setMyCommands', { commands: [
    { command: 'start',    description: 'Show main menu' },
    { command: 'help',     description: 'Show all commands' },
    { command: 'memory',   description: 'View saved answers' },
    { command: 'accounts', description: 'Manage Google accounts' },
    { command: 'cancel',   description: 'Reset current session' },
  ]})
  console.log('[BAVN TG] Commands set ✓')
}

// ── Route handler ─────────────────────────
export default async function telegramRoute(app) {

  // ── POST /telegram/webhook ────────────────
  app.post('/telegram/webhook', async (req, reply) => {
    reply.send({ ok: true })  // respond immediately

    const update = req.body
    const msg    = update?.message || update?.edited_message
    if (!msg?.text) return

    const chatId     = msg.chat.id
    const telegramId = String(msg.from.id)
    const text       = msg.text

    const { data: profile } = await supabase
      .from('profiles').select('user_id, telegram_id')
      .eq('telegram_id', telegramId).single()

    if (!profile) {
      await tg('sendMessage', {
        chat_id:    chatId,
        parse_mode: 'Markdown',
        text:
          `👋 Hey! I don't recognise your Telegram account yet.\n\n` +
          `*Your Telegram ID:*\n\`${telegramId}\`\n\n` +
          `*To link:*\n` +
          `1. Open BAVN Chrome extension\n` +
          `2. Go to *Profile* tab\n` +
          `3. Paste your ID in the *Telegram ID* field\n` +
          `4. Click *Save Profile*\n` +
          `5. Come back and tap /start 🚀`,
        reply_markup: {
          keyboard: [[{ text: '/start' }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        }
      })
      return
    }

    await handleMessage(chatId, profile.user_id, text)
  })

  // ── GET /telegram/status ──────────────────
  app.get('/telegram/status', async (req, reply) => {
    if (!BOT_TOKEN) return reply.send({ enabled: false })
    const info = await tg('getMe', {})
    return reply.send({ enabled: true, bot: info.result })
  })

  // ── GET /telegram/fill-jobs ───────────────
  // Extension polls this to get pending fill jobs
  app.get('/telegram/fill-jobs', async (req, reply) => {
    const userId = req.user.id
    const { data } = await supabase
      .from('fill_jobs')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
    return reply.send({ job: data?.[0] || null })
  })

  // ── POST /telegram/fill-jobs/:id/done ─────
  // Extension calls this after filling the form
  app.post('/telegram/fill-jobs/:id/done', async (req, reply) => {
    const userId = req.user.id
    const { id } = req.params
    await supabase.from('fill_jobs')
      .update({ status: 'filled', updated_at: new Date().toISOString() })
      .eq('id', id).eq('user_id', userId)
    return reply.send({ success: true })
  })
}