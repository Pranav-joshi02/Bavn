// ============================================
// BAVN.io — routes/memory.js
// GET    /api/memory          → list all saved answers
// DELETE /api/memory/:id      → delete one answer
// ============================================
import { supabase } from '../services/supabase.js'

export default async function memoryRoute(app) {

  // List all saved answers for the logged-in user
  app.get('/memory', async (req, reply) => {
    const userId = req.user.id

    const { data, error } = await supabase
      .from('answers')
      .select('id, question, answer, source_url, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      return reply.code(500).send({ error: error.message })
    }

    return reply.send({ answers: data })
  })

  // Delete a single saved answer
  app.delete('/memory/:id', async (req, reply) => {
    const userId = req.user.id
    const { id } = req.params

    const { error } = await supabase
      .from('answers')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)   // safety: user can only delete their own

    if (error) {
      return reply.code(500).send({ error: error.message })
    }

    return reply.send({ success: true })
  })
}
