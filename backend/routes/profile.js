// ============================================
// BAVN.io — routes/profile.js
// GET  /api/profile   → fetch user profile
// POST /api/profile   → create or update profile
// ============================================
import { supabase } from '../services/supabase.js'

export default async function profileRoute(app) {

  // Get profile
  app.get('/profile', async (req, reply) => {
    const userId = req.user.id

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (error && error.code !== 'PGRST116') {  // PGRST116 = no rows found
      return reply.code(500).send({ error: error.message })
    }

    return reply.send({ profile: data ?? null })
  })

  // Create or update profile (upsert)
  app.post('/profile', async (req, reply) => {
    const userId = req.user.id
    const {
      name, email, phone, linkedin,
      resume, college, degree, graduation_year,
    } = req.body

    const { data, error } = await supabase
      .from('profiles')
      .upsert({
        user_id: userId,
        name, email, phone, linkedin,
        resume, college, degree, graduation_year,
      }, { onConflict: 'user_id' })
      .select()
      .single()

    if (error) {
      return reply.code(500).send({ error: error.message })
    }

    return reply.send({ profile: data })
  })
}
