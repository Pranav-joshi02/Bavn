// ============================================
// BAVN.io — routes/accounts.js
// Linked Google accounts CRUD + OAuth callback
// ============================================
import { supabase } from '../services/supabase.js'
import crypto from 'crypto'

const BASE_URL = process.env.BASE_URL || 'https://bavn-backend.onrender.com'

// ── Generate secure token ─────────────────
function makeToken() {
  return crypto.randomBytes(24).toString('hex')
}

// ── Notify WhatsApp session that auth done ─
// Polled by the state machine in whatsapp.js
export const pendingAuths = {}  // token → { resolve, phone }

export default async function accountsRoute(app) {

  // ── GET /api/accounts — list linked accounts ──
  app.get('/accounts', async (req, reply) => {
    const userId = req.user.id
    const { data, error } = await supabase
      .from('linked_accounts')
      .select('id, email, label, is_default, last_used_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
    if (error) return reply.code(500).send({ error: error.message })
    return reply.send(data || [])
  })

  // ── POST /api/accounts/link-token ─────────
  // Called by WhatsApp bot — generates OAuth link
  app.post('/accounts/link-token', async (req, reply) => {
    const userId = req.user.id
    const phone  = req.body.phone

    const token     = makeToken()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 min

    const { error } = await supabase.from('account_link_tokens').insert({
      token, user_id: userId, phone,
      expires_at: expiresAt.toISOString()
    })
    if (error) return reply.code(500).send({ error: error.message })

    const linkUrl = `${BASE_URL}/link?token=${token}`
    return reply.send({ token, linkUrl, expiresAt })
  })

  // ── GET /link?token=xxx ───────────────────
  // Public page — user opens this on phone
  // Shows Google OAuth button
  app.get('/link', { preHandler: [] }, async (req, reply) => {
    const { token } = req.query
    if (!token) return reply.code(400).send('Invalid link')

    const { data: tokenRow } = await supabase
      .from('account_link_tokens')
      .select('*').eq('token', token).single()

    if (!tokenRow)               return reply.send(linkPage('invalid'))
    if (tokenRow.used)           return reply.send(linkPage('used'))
    if (new Date(tokenRow.expires_at) < new Date())
                                 return reply.send(linkPage('expired'))

    return reply.type('text/html').send(linkPage('ready', token))
  })

  // ── GET /link/callback?token=xxx&email=yyy ─
  // Called after Google OAuth completes on the link page
  app.get('/link/callback', { preHandler: [] }, async (req, reply) => {
    const { token, email } = req.query
    if (!token || !email) return reply.code(400).send('Missing params')

    // Validate token
    const { data: tokenRow } = await supabase
      .from('account_link_tokens')
      .select('*').eq('token', token).single()

    if (!tokenRow || tokenRow.used || new Date(tokenRow.expires_at) < new Date())
      return reply.type('text/html').send(linkPage('expired'))

    const userId      = tokenRow.user_id
    const sessionPath = `./browser-sessions/${email.replace(/[^a-z0-9]/gi, '_')}`

    // Check if this is first account (make it default)
    const { count } = await supabase
      .from('linked_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)

    // Save linked account
    await supabase.from('linked_accounts').upsert({
      user_id:      userId,
      email,
      session_path: sessionPath,
      is_default:   count === 0,
      last_used_at: new Date().toISOString()
    }, { onConflict: 'user_id,email' })

    // Mark token as used + store email
    await supabase.from('account_link_tokens')
      .update({ used: true, linked_email: email })
      .eq('token', token)

    // Notify WhatsApp bot that auth is done
    if (pendingAuths[token]) {
      pendingAuths[token].resolve({ email, sessionPath })
      delete pendingAuths[token]
    }

    return reply.type('text/html').send(linkPage('success', null, email))
  })

  // ── DELETE /api/accounts/:id ──────────────
  app.delete('/accounts/:id', async (req, reply) => {
    const userId = req.user.id
    const id     = req.params.id

    const { count } = await supabase
      .from('linked_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)

    if (count <= 1)
      return reply.code(400).send({ error: 'Cannot remove your only linked account' })

    await supabase.from('linked_accounts')
      .delete().eq('id', id).eq('user_id', userId)

    return reply.send({ success: true })
  })

  // ── PUT /api/accounts/:id/default ─────────
  app.put('/accounts/:id/default', async (req, reply) => {
    const userId = req.user.id
    const id     = req.params.id
    await supabase.from('linked_accounts')
      .update({ is_default: false }).eq('user_id', userId)
    await supabase.from('linked_accounts')
      .update({ is_default: true  }).eq('id', id).eq('user_id', userId)
    return reply.send({ success: true })
  })
}

// ── OAuth link page HTML ──────────────────
function linkPage(state, token = null, email = null) {
  const states = {
    invalid: { icon:'❌', title:'Invalid Link',   msg:'This link is invalid or has already been used.' },
    used:    { icon:'⚠️', title:'Already Used',   msg:'This link has already been used. Ask BAVN for a new one.' },
    expired: { icon:'⏰', title:'Link Expired',   msg:'This link has expired (10 min limit). Ask BAVN for a new one.' },
    success: { icon:'✅', title:'Account Linked!', msg:`${email} has been linked to BAVN. You can close this tab.` },
    ready:   { icon:'🔗', title:'Link Account',   msg:'Sign in with the Google account you want to use for form submission.' }
  }
  const s = states[state] || states.invalid

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BAVN — Link Account</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{
  min-height:100vh;display:flex;align-items:center;justify-content:center;
  background:#edf6f9;font-family:'DM Mono',monospace;padding:24px;}
.card{
  background:#fff;border:1px solid #c8e6ea;max-width:360px;width:100%;
  padding:40px 32px;text-align:center;}
.icon{font-size:48px;margin-bottom:20px;}
.title{font-size:20px;color:#0d3b42;margin-bottom:10px;font-weight:500;}
.msg{font-size:12px;color:#4d8f99;line-height:1.8;margin-bottom:28px;}
.btn{
  display:block;width:100%;padding:13px;background:#006d77;color:#fff;
  border:none;font-family:'DM Mono',monospace;font-size:12px;
  letter-spacing:1.5px;text-transform:uppercase;cursor:pointer;
  text-decoration:none;text-align:center;}
.brand{font-size:10px;color:#83c5be;letter-spacing:3px;text-transform:uppercase;margin-bottom:32px;}
</style>
</head>
<body>
<div class="card">
  <div class="brand">BAVN.io</div>
  <div class="icon">${s.icon}</div>
  <div class="title">${s.title}</div>
  <div class="msg">${s.msg}</div>
  ${state === 'ready' ? `
  <a class="btn" href="https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.BASE_URL + '/link/google-callback')}&response_type=code&scope=email+profile&state=${token}">
    Sign in with Google
  </a>` : ''}
</div>
</body>
</html>`
}