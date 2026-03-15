// ============================================
// BAVN.io — middleware/auth.js
// ============================================
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const PUBLIC_ROUTES = [
  '/health',
  '/api/telegram/webhook',
  '/api/telegram/status',
  '/api/whatsapp/qr',
  '/api/whatsapp/qr-image',
  '/api/whatsapp/qr-page',
  '/api/whatsapp/status',
  '/api/whatsapp/reset',
  '/link',
  '/link/callback',
]

export async function authMiddleware(req, reply) {
  if (PUBLIC_ROUTES.some(r => req.url === r || req.url.startsWith(r + '?'))) return

  const authHeader = req.headers['authorization']
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing authorization header' })
  }

  const token = authHeader.slice(7)
  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data?.user) {
    return reply.code(401).send({ error: 'Invalid or expired token' })
  }

  req.user = {
    id:    data.user.id,
    email: data.user.email,
  }
}