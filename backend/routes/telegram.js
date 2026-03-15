// ============================================
// BAVN.io — routes/telegram.js
// Telegram bot — full state machine
// Drop-in replacement for WhatsApp bot
// ============================================
import { supabase }    from '../services/supabase.js'
import {
  generateAnswers,
  regenerateSingleAnswer,
  generateReview,
  regenerateReview,
} from '../services/ai.js'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const BASE_URL  = process.env.BASE_URL || 'https://bavn-backend.onrender.com'
const WEBHOOK   = `${BASE_URL}/api/telegram/webhook`

// ── Telegram API helper ───────────────────
async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body)
  })
  return res.json()
}

async function sendMessage(chatId, text, extra = {}) {
  return tg('sendMessage', {
    chat_id:    chatId,
    text,
    parse_mode: 'Markdown',
    ...extra
  })
}

async function sendButtons(chatId, text, buttons) {
  // buttons = [['Label 1', 'Label 2'], ['Label 3']]  (rows of labels)
  return tg('sendMessage', {
    chat_id:    chatId,
    text,
    parse_mode: 'Markdown',
    reply_markup: {
      keyboard:          buttons.map(row => row.map(label => ({ text: label }))),
      resize_keyboard:   true,
      one_time_keyboard: true
    }
  })
}

async function removeKeyboard(chatId, text) {
  return tg('sendMessage', {
    chat_id:    chatId,
    text,
    parse_mode: 'Markdown',
    reply_markup: { remove_keyboard: true }
  })
}

// ── Session store ─────────────────────────
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
    telegramId:      null,
    account:         null,
    // form
    formUrl:         '',
    questions:       [],
    answers:         [],
    // review
    place:           '',
    experience:      '',
    stars:           0,
    platform:        '',
    review:          '',
    // account linking
    newAccountLabel: null,
    linkToken:       null,
  }
}

// ── Helpers ───────────────────────────────
function isSubmit(t)  { return /^(submit|yes|confirm|go|send it|✅ submit)$/i.test(t.trim()) }
function isPost(t)    { return /^(post|yes|confirm|post it|submit|✅ post)$/i.test(t.trim()) }
function isConfirm(t) { return /^(yes|correct|right|yep|ok|okay|sure|yup|✅ yes)$/i.test(t.trim()) }

function detectPlatform(text) {
  const t = text.toLowerCase()
  if (t.includes('zomato'))      return 'Zomato'
  if (t.includes('swiggy'))      return 'Swiggy'
  if (t.includes('google'))      return 'Google Maps'
  if (t.includes('tripadvisor')) return 'TripAdvisor'
  if (t.includes('amazon'))      return 'Amazon'
  if (t.includes('makemytrip') || t.includes('mmt')) return 'MakeMyTrip'
  return 'Zomato'
}

function parsePlatformOverride(text) {
  const platforms = ['Zomato', 'Swiggy', 'Google Maps', 'TripAdvisor', 'Amazon', 'MakeMyTrip']
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
    `*Q${i+1}.* ${a.question}\n→ ${a.answer}`
  ).join('\n\n')
}

function formatAccountList(accounts) {
  return accounts.map((a, i) =>
    `${i+1} · ${a.email}${a.is_default ? ' ⭐' : ''}`
  ).join('\n') + '\n\n➕ Reply *new* to add an account'
}

// ── Main message handler ──────────────────
async function handleMessage(chatId, userId, text) {
  const sess = getSession(chatId)
  sess.userId = userId
  const msg = text.trim()
  const low = msg.toLowerCase()

  // ── GLOBAL COMMANDS ───────────────────────
  if (low === 'cancel' || low === 'reset' || low === '/cancel') {
    resetSession(chatId)
    await sendButtons(chatId,
      '🔄 Reset. What would you like to do?',
      [['📋 Fill Form', '⭐ Write Review'], ['🧠 Memory', '🔗 Accounts']]
    )
    return
  }

  if (low === '/start' || low === '/help' || low === 'help') {
    await sendButtons(chatId,
      `👋 *Welcome to BAVN Bot!*\n\n` +
      `📋 *Fill Form* — paste a form URL, I generate all answers\n` +
      `⭐ *Write Review* — describe your experience, I write it\n` +
      `🧠 *Memory* — see your saved answers\n` +
      `🔗 *Accounts* — manage linked Google accounts\n\n` +
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
      await sendMessage(chatId, '🧠 No saved answers yet.\n\nFill a form first and your answers will be saved here.')
      return
    }
    const list = data.map((a, i) =>
      `${i+1}. _${a.question.slice(0, 50)}${a.question.length > 50 ? '…' : ''}_\n→ ${a.answer.slice(0, 80)}${a.answer.length > 80 ? '…' : ''}`
    ).join('\n\n')
    await sendMessage(chatId, `🧠 *Last 5 saved answers:*\n\n${list}`)
    return
  }

  if (low === 'accounts' || low === '/accounts' || low === '🔗 accounts') {
    const { data: accs } = await supabase
      .from('linked_accounts').select('*')
      .eq('user_id', userId).order('created_at', { ascending: true })
    if (!accs?.length) {
      await sendMessage(chatId, `No accounts linked yet.\n\nSend *Fill Form* to link your first Google account.`)
      return
    }
    await sendMessage(chatId, `🔐 *Linked accounts:*\n\n${formatAccountList(accs)}\n\nSend *remove [number]* to unlink`)
    return
  }

  // ── STATE MACHINE ─────────────────────────

  // ═══ IDLE ════════════════════════════════
  if (sess.state === 'idle') {
    if (low === 'hi form' || low === '📋 fill form') {
      sess.mode = 'form'
      await showAccountPicker(chatId, userId, sess)
      return
    }
    if (low === 'hi review' || low === '⭐ write review') {
      sess.mode = 'review'
      await showAccountPicker(chatId, userId, sess)
      return
    }
    await sendButtons(chatId,
      `What would you like to do?`,
      [['📋 Fill Form', '⭐ Write Review'], ['🧠 Memory', '🔗 Accounts']]
    )
    return
  }

  // ═══ ACCOUNT SELECTION ═══════════════════
  if (sess.state === 'awaiting_account') {
    const { data: accs } = await supabase
      .from('linked_accounts').select('*')
      .eq('user_id', userId).order('created_at', { ascending: true })

    if (low === 'new' || low === '➕ new account') {
      sess.state = 'awaiting_new_account_label'
      await removeKeyboard(chatId, `What should I call this account?\n_(e.g. "Work", "College", "Personal")_`)
      return
    }

    const removeMatch = low.match(/^remove\s+(\d+)$/)
    if (removeMatch) {
      const idx = parseInt(removeMatch[1]) - 1
      const acc = accs?.[idx]
      if (!acc) { await sendMessage(chatId, `Account ${idx+1} not found.`); return }
      if (accs.length <= 1) { await sendMessage(chatId, `Can't remove your only account.`); return }
      await supabase.from('linked_accounts').delete().eq('id', acc.id)
      await sendMessage(chatId, `✅ Removed ${acc.email}`)
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

    await sendMessage(chatId, `Reply with a number to select an account, or *new* to add one.`)
    return
  }

  // ═══ NEW ACCOUNT: LABEL ══════════════════
  if (sess.state === 'awaiting_new_account_label') {
    sess.newAccountLabel = msg
    sess.state = 'awaiting_link_auth'

    const token = Math.random().toString(36).slice(2) + Date.now().toString(36)
    await supabase.from('account_link_tokens').insert({
      token, user_id: userId,
      telegram_chat_id: String(chatId),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    })
    sess.linkToken = token

    // Register pending auth
    const authPromise = new Promise(resolve => {
      pendingAuths[token] = { resolve, chatId }
    })
    pollForAuth(token, chatId, userId, sess, authPromise)

    const linkUrl = `${BASE_URL}/link?token=${token}`
    await sendMessage(chatId,
      `🔗 Open this link and sign in with Google:\n\n${linkUrl}\n\n_Link expires in 10 minutes. I'll continue automatically once you've signed in._`
    )
    return
  }

  // ═══ WAITING FOR OAUTH ═══════════════════
  if (sess.state === 'awaiting_link_auth') {
    await sendMessage(chatId, `⏳ Still waiting for you to sign in via the link I sent.\n\nNeed a new link? Send *cancel* and start again.`)
    return
  }

  // ═══ FORM: AWAITING LINK ═════════════════
  if (sess.state === 'awaiting_link') {
    if (!msg.match(/https?:\/\//)) {
      await sendMessage(chatId, `Please send a valid form URL starting with http or https`)
      return
    }
    sess.formUrl = msg
    sess.state   = 'generating_form'

    await sendMessage(chatId, `⏳ Fetching form and generating answers...`)

    const { data: profile } = await supabase
      .from('profiles').select('*').eq('user_id', userId).single()

    // Placeholder questions (Phase 4 will scrape real ones)
    const questions = [
      'Why do you want to apply for this position?',
      'Describe a technical challenge you solved.',
      'What is your expected stipend?',
      'When can you start?'
    ]
    sess.questions = questions

    let answers
    try {
      answers = await generateAnswers(questions, profile)
      sess.answers = answers
    } catch(e) {
      resetSession(chatId)
      await sendMessage(chatId, `Sorry, couldn't generate answers right now. Please try again.`)
      return
    }

    sess.state = 'form_preview'
    const accountLine = sess.account ? `\n_Submitting as: ${sess.account.email}_` : ''

    await sendButtons(chatId,
      `✅ *${answers.length} answers ready* 👇${accountLine}\n\n${formatAnswers(answers)}\n\n——\nTo change: _"change Q2 make it more confident"_\nOr tap Submit ↓`,
      [['✅ Submit', '👁 Preview All'], ['❌ Cancel']]
    )
    return
  }

  // ═══ FORM: PREVIEW ═══════════════════════
  if (sess.state === 'form_preview') {
    if (isSubmit(low)) {
      for (const a of sess.answers) {
        await supabase.from('answers').upsert({
          user_id: userId, question: a.question,
          answer: a.answer, source_url: sess.formUrl
        }, { onConflict: 'user_id,question' })
      }
      const accountLine = sess.account ? ` as *${sess.account.email}*` : ''
      resetSession(chatId)
      await sendButtons(chatId,
        `✅ *Form submitted${accountLine}!*\nAnswers saved to memory.\n\nGood luck! 🚀`,
        [['📋 Fill Another Form', '⭐ Write Review']]
      )
      return
    }

    if (low === 'preview all' || low === '👁 preview all') {
      await sendMessage(chatId, `📋 *All answers:*\n\n${formatAnswers(sess.answers)}\n\n——\nChange an answer or tap Submit`)
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
      await sendButtons(chatId,
        `✏️ *Updated Q${qIndex+1}* 👇\n\n→ ${updated}\n\n——\nAnything else or tap Submit`,
        [['✅ Submit', '👁 Preview All'], ['❌ Cancel']]
      )
      return
    }

    await sendButtons(chatId,
      `To change an answer: _"change Q2 make it more detailed"_`,
      [['✅ Submit', '👁 Preview All'], ['❌ Cancel']]
    )
    return
  }

  // ═══ REVIEW: AWAITING PLACE ══════════════
  if (sess.state === 'awaiting_place') {
    sess.experience = msg
    sess.place      = msg.split(',')[0].trim()
    sess.state      = 'awaiting_stars'
    await sendButtons(chatId,
      `Nice! How many stars? ⭐`,
      [['⭐ 1', '⭐⭐ 2', '⭐⭐⭐ 3'], ['⭐⭐⭐⭐ 4', '⭐⭐⭐⭐⭐ 5']]
    )
    return
  }

  // ═══ REVIEW: AWAITING STARS ══════════════
  if (sess.state === 'awaiting_stars') {
    const stars = parseInt(msg.replace(/[^1-5]/g, ''))
    if (isNaN(stars) || stars < 1 || stars > 5) {
      await sendMessage(chatId, `Please send a number between 1 and 5`)
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
      await sendMessage(chatId, `Couldn't generate review. Please try again.`)
      return
    }

    sess.state = 'review_preview'
    const stars = '⭐'.repeat(sess.stars)
    await sendButtons(chatId,
      `Here's your *${sess.platform}* review 👇\n\n${stars}\n_"${review}"_\n\n——\nTo change: _"make it shorter"_\nOr tap Post ↓`,
      [['✅ Post', '❌ Cancel']]
    )
    return
  }

  // ═══ REVIEW: PREVIEW ═════════════════════
  if (sess.state === 'review_preview') {
    if (isPost(low)) {
      await supabase.from('reviews').insert({
        user_id: userId, platform: sess.platform,
        place_name: sess.place, user_context: sess.experience,
        generated_review: sess.review, star_rating: sess.stars, submitted: true
      })
      const stars = '⭐'.repeat(sess.stars)
      resetSession(chatId)
      await sendButtons(chatId,
        `✅ *Review saved!* ${stars}\n\n_Copy it and paste on ${sess.platform}._\n\nAnything else?`,
        [['📋 Fill Form', '⭐ Write Review']]
      )
      return
    }

    await sendMessage(chatId, `✏️ Regenerating review...`)
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
      [['✅ Post', '❌ Cancel']]
    )
    return
  }

  // Fallback
  await sendButtons(chatId,
    `What would you like to do?`,
    [['📋 Fill Form', '⭐ Write Review'], ['🧠 Memory', '🔗 Accounts']]
  )
}

// ── Account picker ────────────────────────
async function showAccountPicker(chatId, userId, sess) {
  const { data: accs } = await supabase
    .from('linked_accounts').select('*')
    .eq('user_id', userId).order('created_at', { ascending: true })

  if (!accs?.length) {
    sess.state = 'awaiting_new_account_label'
    await removeKeyboard(chatId,
      `Hey! 👋 No Google accounts linked yet.\n\nWhat should I call your first account?\n_(e.g. "Personal", "College", "Work")_`
    )
    return
  }

  sess.state = 'awaiting_account'
  const modeLabel = sess.mode === 'form' ? 'fill & submit the form' : 'post the review'
  const rows = accs.map((a, i) => [`${i+1} · ${a.email}${a.is_default ? ' ⭐' : ''}`])
  rows.push(['➕ New Account'])

  await sendButtons(chatId,
    `Which Google account should I use to ${modeLabel}?`,
    rows
  )
}

// ── Proceed after account selected ────────
async function proceedAfterAccount(chatId, sess) {
  if (sess.mode === 'form') {
    sess.state = 'awaiting_link'
    await removeKeyboard(chatId, `Using *${sess.account.email}* ✓\n\nSend me the form link 🔗`)
    return
  }
  if (sess.mode === 'review') {
    sess.state = 'awaiting_place'
    await removeKeyboard(chatId,
      `Using *${sess.account.email}* ✓\n\nWhich place and what was your experience?\n_(e.g. "Barbeque Nation Pune, great food but slow service")_`
    )
    return
  }
}

// ── OAuth poll ────────────────────────────
export const pendingAuths = {}

async function pollForAuth(token, chatId, userId, sess, authPromise) {
  try {
    const result = await Promise.race([
      authPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 9 * 60 * 1000))
    ])

    await supabase.from('linked_accounts').upsert({
      user_id:      userId,
      email:        result.email,
      label:        sess.newAccountLabel || 'Personal',
      session_path: result.sessionPath,
      is_default:   false,
      last_used_at: new Date().toISOString()
    }, { onConflict: 'user_id,email' })

    const { data: acc } = await supabase
      .from('linked_accounts').select('*')
      .eq('user_id', userId).eq('email', result.email).single()

    sess.account = acc
    await proceedAfterAccount(chatId, sess)
    await sendMessage(chatId, `✅ *${result.email}* linked successfully!`)

  } catch(e) {
    if (sess.state === 'awaiting_link_auth') {
      resetSession(chatId)
      await sendMessage(chatId, `⏰ Link expired. Send *Fill Form* to try again.`)
    }
  }
}

// ── Webhook setup ─────────────────────────
export async function setupTelegramWebhook() {
  if (!BOT_TOKEN) {
    console.log('[BAVN TG] No TELEGRAM_BOT_TOKEN set — bot disabled')
    return
  }
  const res = await tg('setWebhook', { url: WEBHOOK, drop_pending_updates: true })
  console.log('[BAVN TG] Webhook set:', res.ok ? '✓' : res.description)

  // Set bot commands menu
  await tg('setMyCommands', {
    commands: [
      { command: 'start',  description: 'Start BAVN bot' },
      { command: 'help',   description: 'Show all commands' },
      { command: 'memory', description: 'View saved answers' },
      { command: 'cancel', description: 'Reset current session' },
    ]
  })
  console.log('[BAVN TG] Commands set ✓')
}

// ── Route handler ─────────────────────────
export default async function telegramRoute(app) {

  // Webhook endpoint — Telegram POSTs updates here
  app.post('/telegram/webhook', async (req, reply) => {
    reply.send({ ok: true }) // Respond immediately

    const update = req.body
    const msg    = update?.message || update?.edited_message
    if (!msg?.text) return

    const chatId     = msg.chat.id
    const telegramId = String(msg.from.id)
    const text       = msg.text

    // Look up user by telegram_id
    const { data: profile } = await supabase
      .from('profiles').select('user_id,telegram_id')
      .eq('telegram_id', telegramId).single()

    if (!profile) {
      await tg('sendMessage', {
        chat_id:    chatId,
        parse_mode: 'Markdown',
        text: `👋 Hey! I don't recognise your Telegram account yet.\n\n` +
              `*Your Telegram ID is:*\n\`${telegramId}\`\n\n` +
              `*To link your account:*\n` +
              `1. Open the BAVN Chrome extension\n` +
              `2. Go to *Profile* tab\n` +
              `3. Paste your ID above into the *Telegram ID* field\n` +
              `4. Click *Save Profile*\n` +
              `5. Come back and send /start 🚀`,
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

  // Status check
  app.get('/telegram/status', async (req, reply) => {
    if (!BOT_TOKEN) return reply.send({ enabled: false })
    const info = await tg('getMe', {})
    return reply.send({ enabled: true, bot: info.result })
  })
}