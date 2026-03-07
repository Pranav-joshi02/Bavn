// ============================================
// BAVN.io — middleware/auth.js
// Validates Supabase JWT on every request
// Attaches req.user = { id, email }
// ============================================
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// Routes that skip auth
const PUBLIC_ROUTES = ['/health']

export async function authMiddleware(req, reply) {
  if (PUBLIC_ROUTES.includes(req.url)) return

  const authHeader = req.headers['authorization']
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing authorization header' })
  }

  const token = authHeader.slice(7)

  // Verify JWT with Supabase — returns the user if valid
  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data?.user) {
    return reply.code(401).send({ error: 'Invalid or expired token' })
  }

  // Attach user to request for use in route handlers
  req.user = {
    id: data.user.id,
    email: data.user.email,
  }
}
