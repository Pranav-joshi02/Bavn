// ============================================
// BAVN.io — routes/whatsapp.js
// WhatsApp bot — full state machine
// with Google account switcher
// ============================================
import { supabase } from '../services/supabase.js'
import { pendingAuths } from './accounts.js'
import {
  generateAnswers,
  regenerateSingleAnswer,
  generateReview,
  regenerateReview,
} from '../services/ai.js'

const BASE_URL = process.env.BASE_URL || 'https://bavn-backend.onrender.com'

// ── Session store ─────────────────────────
const sessions = {}
function getSession(phone) {
  if (!sessions[phone]) resetSession(phone)
  return sessions[phone]
}
function resetSession(phone) {
  sessions[phone] = {
    state:       'idle',
    mode:        null,
    userId:      null,
    account:     null,   // selected linked_account row
    // form
    formUrl:     '',
    questions:   [],
    answers:     [],
    // review
    place:       '',
    experience:  '',
    stars:       0,
    platform:    '',
    review:      '',
    // linking
    linkToken:   null,
  }
}

// ── Helpers ───────────────────────────────
function isSubmit(t) { return /^(submit|yes|confirm|go|send it)$/i.test(t.trim()) }
function isPost(t)   { return /^(post|yes|confirm|post it|submit)$/i.test(t.trim()) }
function isConfirm(t){ return /^(yes|correct|right|yep|ok|okay|sure|yup)$/i.test(t.trim()) }

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
    `*Q${i+1}.* ${a.question}\n→ ${a.answer}`
  ).join('\n\n')
}

function formatAccountList(accounts) {
  const list = accounts.map((a, i) =>
    `${i+1} · ${a.email}${a.is_default ? ' ⭐' : ''}`
  ).join('\n')
  return list + '\n➕ Reply *new* to add an account'
}

// ── Main handler ──────────────────────────
export async function handleMessage(userId, phone, text) {
  const sess = getSession(phone)
  sess.userId = userId
  const msg = text.trim()
  const low = msg.toLowerCase()

  // ── GLOBAL COMMANDS ───────────────────────
  if (low === 'cancel' || low === 'reset') {
    resetSession(phone)
    return '🔄 Reset. Send *hi form* or *hi review* to start.'
  }
  if (low === 'help') {
    return `👋 *BAVN Commands*\n\n*hi form* → fill & submit a form\n*hi review* → write & post a review\n*memory* → saved answers\n*accounts* → manage linked Google accounts\n*cancel* → reset session`
  }
  if (low === 'memory') {
    const { data } = await supabase
      .from('answers').select('question,answer')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(5)
    if (!data?.length) return '🧠 No saved answers yet.'
    return '🧠 *Last 5 answers:*\n\n' +
      data.map((a,i) => `${i+1}. ${a.question.slice(0,40)}…\n→ ${a.answer.slice(0,60)}…`).join('\n\n')
  }
  if (low === 'accounts') {
    const { data: accs } = await supabase
      .from('linked_accounts').select('*')
      .eq('user_id', userId).order('created_at', { ascending: true })
    if (!accs?.length) return `No accounts linked yet.\nSend *hi form* to link your first account.`
    return `🔐 *Linked accounts:*\n\n${formatAccountList(accs)}\n\nSend *new* to add, or *remove [number]* to unlink`
  }

  // ── STATE MACHINE ─────────────────────────

  // ═══ IDLE ════════════════════════════════
  if (sess.state === 'idle') {
    if (low === 'hi form') {
      sess.mode = 'form'
      return await showAccountPicker(userId, phone, sess)
    }
    if (low === 'hi review') {
      sess.mode = 'review'
      return await showAccountPicker(userId, phone, sess)
    }
    if (low.startsWith('hi')) {
      return `Hey! 👋\n\n*hi form* → fill & submit a form\n*hi review* → write & post a review`
    }
    return `Send *hi form* or *hi review* to get started.\nType *help* for all commands.`
  }

  // ═══ ACCOUNT SELECTION ═══════════════════
  if (sess.state === 'awaiting_account') {
    const { data: accs } = await supabase
      .from('linked_accounts').select('*')
      .eq('user_id', userId).order('created_at', { ascending: true })

    // Add new account
    if (low === 'new') {
      sess.state = 'awaiting_new_account_label'
      return `What should I call this account?\n_(e.g. "Work", "College", "Personal")_`
    }

    // Remove account
    const removeMatch = low.match(/^remove\s+(\d+)$/)
    if (removeMatch) {
      const idx = parseInt(removeMatch[1]) - 1
      const acc = accs?.[idx]
      if (!acc) return `Account ${idx+1} not found.`
      if (accs.length <= 1) return `Can't remove your only account.`
      await supabase.from('linked_accounts').delete().eq('id', acc.id)
      return `✅ Removed ${acc.email}`
    }

    // Select by number
    const num = parseInt(low)
    if (!isNaN(num) && accs?.[num - 1]) {
      sess.account = accs[num - 1]
      await supabase.from('linked_accounts')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', sess.account.id)
      return await proceedAfterAccount(sess)
    }

    return `Reply with a number to select an account, or *new* to add one.`
  }

  // ═══ NEW ACCOUNT: LABEL ══════════════════
  if (sess.state === 'awaiting_new_account_label') {
    sess.newAccountLabel = msg
    sess.state = 'awaiting_link_auth'

    // Generate OAuth link token
    const { data: tokenRow } = await supabase
      .from('account_link_tokens')
      .insert({
        token:      crypto(),
        user_id:    userId,
        phone,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      })
      .select().single()

    // Create a simple token
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36)
    await supabase.from('account_link_tokens').insert({
      token, user_id: userId, phone,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    })

    sess.linkToken = token

    // Register pending auth resolver
    const authPromise = new Promise(resolve => {
      pendingAuths[token] = { resolve, phone }
    })

    // Start polling in background
    pollForAuth(token, phone, userId, sess, authPromise)

    const linkUrl = `${BASE_URL}/link?token=${token}`
    return `🔗 Open this link on your phone and sign in with Google:\n\n${linkUrl}\n\n_(Link expires in 10 minutes)_\n\nI'll continue automatically once you've signed in.`
  }

  // ═══ WAITING FOR OAUTH ═══════════════════
  if (sess.state === 'awaiting_link_auth') {
    return `⏳ Still waiting for you to sign in via the link I sent.\n\nNeed a new link? Send *new link*`
  }

  // ═══ FORM: AWAITING LINK ═════════════════
  if (sess.state === 'awaiting_link') {
    if (!msg.match(/https?:\/\//)) {
      return `Please send a valid form URL (starting with http/https)`
    }
    sess.formUrl = msg
    sess.state   = 'generating_form'

    // Fetch profile for AI context
    const { data: profile } = await supabase
      .from('profiles').select('*').eq('user_id', userId).single()

    // Mock questions (Puppeteer scraping comes in Phase 4)
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
      resetSession(phone)
      return `Sorry, couldn't generate answers right now. Please try again.`
    }

    sess.state = 'form_preview'
    const accountLine = sess.account
      ? `\n_Submitting as: ${sess.account.email}_`
      : ''

    return `✅ Found ${answers.length} questions. Here are your answers 👇${accountLine}\n\n${formatAnswers(answers)}\n\n——\nTo change: _"change Q2 make it more confident"_\nTo see all: _"preview"_\nOr send *submit* ✓`
  }

  // ═══ FORM: PREVIEW ═══════════════════════
  if (sess.state === 'form_preview') {
    if (isSubmit(low)) {
      // Save to memory
      for (const a of sess.answers) {
        await supabase.from('answers').upsert({
          user_id: userId, question: a.question,
          answer: a.answer, source_url: sess.formUrl
        }, { onConflict: 'user_id,question' })
      }
      const accountLine = sess.account ? ` as *${sess.account.email}*` : ''
      resetSession(phone)
      return `⏳ Submitting form${accountLine}...\n\n✅ *Done!* Form submitted successfully.\nAnswers saved to memory.\n\nGood luck! 🚀`
    }

    if (low === 'preview' || low === 'show all') {
      return `📋 *All answers:*\n\n${formatAnswers(sess.answers)}\n\n——\nChange an answer or send *submit*`
    }

    const change = parseChange(msg)
    if (change) {
      const { qIndex, instruction } = change
      if (qIndex < 0 || qIndex >= sess.answers.length)
        return `Q${qIndex+1} doesn't exist. There are ${sess.answers.length} questions.`
      const { data: profile } = await supabase
        .from('profiles').select('*').eq('user_id', userId).single()
      const updated = await regenerateSingleAnswer(
        sess.answers[qIndex].question, instruction, profile
      )
      sess.answers[qIndex].answer = updated
      return `✏️ *Updated Q${qIndex+1}* 👇\n\n→ ${updated}\n\n——\nAnything else or send *submit*?`
    }

    return `To change: _"change Q2 make it more detailed"_\nTo submit: *submit*\nTo see all: *preview*`
  }

  // ═══ REVIEW: AWAITING PLACE ══════════════
  if (sess.state === 'awaiting_place') {
    sess.experience = msg
    sess.place      = msg.split(',')[0].trim()
    sess.state      = 'awaiting_stars'
    return `Nice! How many stars? ⭐ _(1–5)_`
  }

  // ═══ REVIEW: AWAITING STARS ══════════════
  if (sess.state === 'awaiting_stars') {
    const stars = parseInt(msg)
    if (isNaN(stars) || stars < 1 || stars > 5)
      return `Please send a number between 1 and 5 ⭐`
    sess.stars    = stars
    sess.platform = detectPlatform(sess.experience + ' ' + sess.place)
    sess.state    = 'awaiting_platform_confirm'
    return `Detected: *${sess.platform}* 🎯\n\nCorrect? Or tell me which platform:\n_Google Maps / Zomato / Swiggy / TripAdvisor_`
  }

  // ═══ REVIEW: PLATFORM CONFIRM ════════════
  if (sess.state === 'awaiting_platform_confirm') {
    const override = parsePlatformOverride(msg)
    if (override) sess.platform = override
    else if (!isConfirm(low))
      return `Confirm with *yes* or tell me the platform:\n_Google Maps / Zomato / Swiggy / TripAdvisor_`

    let review
    try {
      review = await generateReview(sess.experience, sess.platform, sess.stars)
      sess.review = review
    } catch(e) {
      resetSession(phone)
      return `Couldn't generate review right now. Please try again.`
    }
    sess.state = 'review_preview'
    const stars = '⭐'.repeat(sess.stars)
    return `Here's your *${sess.platform}* review 👇\n\n${stars}\n_"${review}"_\n\n——\nTo change: _"make it shorter"_\nOr send *post* ✓`
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
      resetSession(phone)
      return `⏳ Posting to ${sess.platform}...\n\n✅ *Review posted!* ${stars}\n\nThanks for using BAVN 🌟`
    }

    let updated
    try {
      updated = await regenerateReview(
        sess.experience, sess.platform, sess.stars, sess.review, msg
      )
      sess.review = updated
    } catch(e) {
      return `Couldn't regenerate. Send *post* to use current version.`
    }
    const stars = '⭐'.repeat(sess.stars)
    return `✏️ *Updated review* 👇\n\n${stars}\n_"${updated}"_\n\n——\nAnything else or send *post*?`
  }

  return `Send *hi form* or *hi review* to get started. Type *help* for all commands.`
}

// ── Show account picker ───────────────────
async function showAccountPicker(userId, phone, sess) {
  const { data: accs } = await supabase
    .from('linked_accounts').select('*')
    .eq('user_id', userId).order('created_at', { ascending: true })

  if (!accs?.length) {
    // No accounts yet — go straight to adding one
    sess.state = 'awaiting_new_account_label'
    return `Hey! 👋 No Google accounts linked yet.\n\nWhat should I call your first account?\n_(e.g. "Personal", "College", "Work")_`
  }

  sess.state = 'awaiting_account'
  const modeLabel = sess.mode === 'form' ? 'fill & submit the form' : 'post the review'
  return `Hey! 👋 Which Google account should I use to ${modeLabel}?\n\n${formatAccountList(accs)}`
}

// ── Proceed after account selected ────────
async function proceedAfterAccount(sess) {
  if (sess.mode === 'form') {
    sess.state = 'awaiting_link'
    return `Using *${sess.account.email}* ✓\n\nSend me the form link 🔗`
  }
  if (sess.mode === 'review') {
    sess.state = 'awaiting_place'
    return `Using *${sess.account.email}* ✓\n\nWhich place and what was your experience?\n_(e.g. "Barbeque Nation Pune, great food slow service")_`
  }
}

// ── Poll for OAuth completion ─────────────
async function pollForAuth(token, phone, userId, sess, authPromise) {
  try {
    const result = await Promise.race([
      authPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 9 * 60 * 1000))
    ])

    // Auth completed — save account with label
    await supabase.from('linked_accounts').upsert({
      user_id:      userId,
      email:        result.email,
      label:        sess.newAccountLabel || 'Personal',
      session_path: result.sessionPath,
      is_default:   false,
      last_used_at: new Date().toISOString()
    }, { onConflict: 'user_id,email' })

    // Fetch the saved account
    const { data: acc } = await supabase
      .from('linked_accounts').select('*')
      .eq('user_id', userId).eq('email', result.email).single()

    sess.account = acc
    sess.state   = 'idle'

    // Send WhatsApp message to continue
    if (sock) {
      const continueMsg = await proceedAfterAccount(sess)
      await sock.sendMessage(`${phone}@s.whatsapp.net`, {
        text: `✅ *${result.email}* linked successfully!\n\n${continueMsg}`
      })
    }
  } catch(e) {
    if (sess.state === 'awaiting_link_auth') {
      sess.state = 'idle'
      if (sock) {
        await sock.sendMessage(`${phone}@s.whatsapp.net`, {
          text: `⏰ Link expired. Send *hi form* to try again.`
        })
      }
    }
  }
}

// ── Baileys connection ────────────────────
let sock        = null
let qrCode      = null
let isConnected = false
let waReady     = false   // true once Baileys has fully initialised

// Silent logger — must have all methods at top level
const silentLogger = {
  level: 'silent',
  trace: ()=>{}, debug: ()=>{}, info: ()=>{},
  warn:  ()=>{}, error: ()=>{}, fatal: ()=>{},
  child: () => ({
    level: 'silent',
    trace: ()=>{}, debug: ()=>{}, info: ()=>{},
    warn:  ()=>{}, error: ()=>{}, fatal: ()=>{}
  })
}

async function connectWhatsApp() {
  try {
    console.log('[BAVN WA] Initialising Baileys...')

    const baileys = await import('@whiskeysockets/baileys')
    const makeWASocket          = baileys.default
    const useMultiFileAuthState = baileys.useMultiFileAuthState
    const DisconnectReason      = baileys.DisconnectReason

    const { state, saveCreds } = await useMultiFileAuthState('./whatsapp-session')

    sock = makeWASocket({
      auth:                  state,
      logger:                silentLogger,
      connectTimeoutMs:      60_000,
      defaultQueryTimeoutMs: 30_000,
      keepAliveIntervalMs:   25_000,
      syncFullHistory:       false,
      markOnlineOnConnect:   false,
      retryRequestDelayMs:   2000,
    })

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        qrCode      = qr
        isConnected = false
        waReady     = true
        console.log('[BAVN WA] QR ready ✓')
      }

      if (connection === 'open') {
        isConnected = true
        waReady     = true
        qrCode      = null
        console.log('[BAVN WA] Connected ✓')
      }

      if (connection === 'close') {
        isConnected = false
        const statusCode = lastDisconnect?.error?.output?.statusCode
        const reason     = lastDisconnect?.error?.message || 'unknown'
        console.log(`[BAVN WA] Disconnected. Code: ${statusCode} Reason: ${reason}`)

        if (statusCode === DisconnectReason.loggedOut) {
          // Logged out — clear session and restart fresh to get new QR
          console.log('[BAVN WA] Logged out — clearing session...')
          await clearSession()
          waReady = false
          qrCode  = null
          setTimeout(connectWhatsApp, 2000)

        } else if (statusCode === 515 || statusCode === 408 || statusCode === 503) {
          // Restart required or timeout — reconnect after delay
          console.log('[BAVN WA] Restart needed — reconnecting in 5s...')
          setTimeout(connectWhatsApp, 5000)

        } else if (statusCode === 440) {
          // Another device connected — clear and restart
          console.log('[BAVN WA] Replaced by another device — reconnecting...')
          await clearSession()
          setTimeout(connectWhatsApp, 3000)

        } else {
          // Generic disconnect — reconnect
          setTimeout(connectWhatsApp, 3000)
        }
      }
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return
      for (const msg of messages) {
        if (msg.key.fromMe) continue
        const phone = msg.key.remoteJid?.replace('@s.whatsapp.net', '')
        if (!phone) continue
        const text = msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text || ''
        if (!text) continue

        console.log(`[BAVN WA] ${phone}: ${text}`)

        const { data: profile } = await supabase
          .from('profiles').select('user_id,phone')
          .eq('phone', phone).single()

        if (!profile) {
          await sock.sendMessage(msg.key.remoteJid, { text:
            `👋 Hey! I don't recognise your number.\n\n1. Install BAVN Chrome extension\n2. Profile tab → add your phone number\n3. Come back and say *hi* 🚀`
          })
          continue
        }

        const reply = await handleMessage(profile.user_id, phone, text)
        await sock.sendMessage(msg.key.remoteJid, { text: reply })
      }
    })

    console.log('[BAVN WA] Baileys setup complete, waiting for QR/connection...')

  } catch(err) {
    console.error('[BAVN WA] Fatal error:', err.message)
    setTimeout(connectWhatsApp, 5000)
  }
}

// Clear corrupted/expired session files
async function clearSession() {
  try {
    const fs   = await import('fs')
    const path = await import('path')
    const dir  = './whatsapp-session'
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
      console.log('[BAVN WA] Session cleared ✓')
    }
  } catch(e) {
    console.error('[BAVN WA] Could not clear session:', e.message)
  }
}

// Delay Baileys init by 2s so Fastify fully starts first
setTimeout(connectWhatsApp, 2000)

// ── Route handlers ────────────────────────
export default async function whatsappRoute(app) {

  // ── GET /whatsapp/qr-page — standalone browser QR page ──
  app.get('/whatsapp/qr-page', async (req, reply) => {
    return reply.type('text/html').send(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BAVN — WhatsApp QR</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;
  background:#edf6f9;font-family:monospace;padding:24px;}
.card{background:#fff;border:1px solid #c8e6ea;max-width:320px;width:100%;
  padding:32px 28px;text-align:center;}
.brand{font-size:10px;color:#83c5be;letter-spacing:3px;text-transform:uppercase;margin-bottom:24px;}
.title{font-size:16px;color:#0d3b42;margin-bottom:6px;font-weight:500;}
.sub{font-size:11px;color:#4d8f99;line-height:1.8;margin-bottom:20px;}
#qr-box{min-height:200px;display:flex;align-items:center;justify-content:center;margin-bottom:16px;}
#qr-box canvas{border:1px solid #c8e6ea;}
.status{font-size:10px;color:#7aacb4;letter-spacing:1px;min-height:16px;}
.status.ok{color:#006d77;font-weight:500;}
.status.err{color:#c0604a;}
.spinner{width:32px;height:32px;border:2px solid #c8e6ea;
  border-top-color:#006d77;border-radius:50%;
  animation:spin 0.8s linear infinite;margin:auto;}
@keyframes spin{to{transform:rotate(360deg)}}
.steps{font-size:10px;color:#4d8f99;line-height:2.2;text-align:left;
  margin-top:18px;border-top:1px solid #c8e6ea;padding-top:14px;}
</style>
</head>
<body>
<div class="card">
  <div class="brand">BAVN.io</div>
  <div class="title">WhatsApp Setup</div>
  <div class="sub">Scan with WhatsApp to activate<br>the BAVN bot on your phone</div>
  <div id="qr-box"><div class="spinner"></div></div>
  <div class="status" id="status">Connecting…</div>
  <div class="steps">
    1 · Open WhatsApp on your phone<br>
    2 · Settings → Linked Devices<br>
    3 · Link a Device → scan QR above<br>
    4 · BAVN bot is now active ✓
  </div>
</div>
<script>
const BASE = window.location.origin
let timer = null

async function poll() {
  const box    = document.getElementById('qr-box')
  const status = document.getElementById('status')
  try {
    const res  = await fetch(BASE + '/api/whatsapp/qr')
    const data = await res.json()

    if (data.connected) {
      box.innerHTML = '<div style="font-size:48px;padding:16px">✅</div>'
      status.textContent = 'Connected! You can close this tab.'
      status.className   = 'status ok'
      return
    }

    if (data.qr) {
      box.innerHTML = '<div id="qr-render"></div>'
      new QRCode(document.getElementById('qr-render'), {
        text: data.qr, width: 200, height: 200,
        colorDark: '#006d77', colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      })
      status.textContent = 'Scan with WhatsApp now ↑'
      status.className   = 'status ok'
      timer = setTimeout(poll, 5000)
      return
    }

    status.textContent = data.message || 'Initialising… please wait'
    timer = setTimeout(poll, 3000)

  } catch(e) {
    status.textContent = 'Retrying…'
    status.className   = 'status err'
    timer = setTimeout(poll, 4000)
  }
}

poll()
</script>
</body>
</html>`)
  })

  // ── GET /whatsapp/qr ──────────────────────
  app.get("/whatsapp/qr", async (req, reply) => {
    if (isConnected) return reply.send({ connected: true,  qr: null })
    if (qrCode)      return reply.send({ connected: false, qr: qrCode, ready: true })
    if (!waReady)    return reply.send({ connected: false, qr: null, ready: false, message: 'Baileys initialising — please wait…' })
    return reply.send({ connected: false, qr: null, ready: true, message: 'Generating QR…' })
  })

  app.get('/whatsapp/status', async (req, reply) => {
    return reply.send({ connected: isConnected, hasQR: !!qrCode })
  })

  app.post('/whatsapp/reset', async (req, reply) => {
    console.log('[BAVN WA] Manual reset requested')
    isConnected = false
    waReady     = false
    qrCode      = null
    if (sock) { try { sock.end() } catch(e) {} sock = null }
    await clearSession()
    setTimeout(connectWhatsApp, 1000)
    return reply.send({ success: true, message: 'Session reset — new QR generating in ~5 seconds' })
  })


    const { phone, message } = req.body
    if (!isConnected) return reply.code(503).send({ error: 'WhatsApp not connected' })
    try {
      await sock.sendMessage(`${phone}@s.whatsapp.net`, { text: message })
      return reply.send({ success: true })
    } catch(err) {
      return reply.code(500).send({ error: err.message })
    }
  }