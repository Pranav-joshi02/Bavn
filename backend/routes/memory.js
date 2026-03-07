// ============================================
// BAVN.io — routes/memory.js
// GET    /api/memory           → list saved answers
// DELETE /api/memory/:id       → delete one answer
// POST   /api/memory/manual    → manually save an answer
// ============================================
import { supabase } from '../services/supabase.js'

export default async function memoryRoute(app) {

  // List all saved answers
  app.get('/memory', async (req, reply) => {
    const { data, error } = await supabase
      .from('answers')
      .select('id, question, answer, source_url, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
    if (error) return reply.code(500).send({ error: error.message })
    return reply.send({ answers: data })
  })

  // Manually save a user-written answer to memory
  app.post('/memory/manual', async (req, reply) => {
    const { question, answer } = req.body
    if (!question || !answer) {
      return reply.code(400).send({ error: 'question and answer are required' })
    }

    const { data, error } = await supabase
      .from('answers')
      .insert({
        user_id:    req.user.id,
        question,
        answer,
        source_url: 'manual',   // flag so you know it was user-entered
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.send({ answer: data })
  })

  // Delete a saved answer
  app.delete('/memory/:id', async (req, reply) => {
    const { error } = await supabase
      .from('answers')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
    if (error) return reply.code(500).send({ error: error.message })
    return reply.send({ success: true })
  })
}