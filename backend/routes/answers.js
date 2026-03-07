// ============================================
// BAVN.io — routes/answers.js
// POST /api/answers
// Body: { questions, sourceUrl, allowedFields }
// ============================================
import { supabase }          from '../services/supabase.js'
import { generateAnswers }   from '../services/groq.js'
import { findSimilarAnswer } from '../services/memory.js'

export default async function answersRoute(app) {
  app.post('/answers', async (req, reply) => {
    const userId = req.user.id
    const { questions, sourceUrl, allowedFields } = req.body

    if (!Array.isArray(questions) || questions.length === 0) {
      return reply.code(400).send({ error: 'questions must be a non-empty array' })
    }

    // Fetch user profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single()

    // Check memory first for each question
    const toGenerate  = []
    const memoryHits  = {}

    for (const q of questions) {
      const match = await findSimilarAnswer(userId, q)
      if (match) memoryHits[q] = match.answer
      else toGenerate.push(q)
    }

    // Generate for cache misses — pass allowedFields so Groq only sees approved data
    let generated = []
    if (toGenerate.length > 0) {
      generated = await generateAnswers(toGenerate, profile, allowedFields ?? null)
    }

    // Save newly generated answers
    if (generated.length > 0) {
      const rows = generated.map(({ question, answer }) => ({
        user_id:    userId,
        question,
        answer,
        source_url: sourceUrl ?? null,
      }))
      await supabase.from('answers').insert(rows)
    }

    // Build final results in original order
    const results = questions.map(q => {
      if (memoryHits[q]) return { question: q, answer: memoryHits[q], fromMemory: true }
      const gen = generated.find(g => g.question === q)
      return { question: q, answer: gen?.answer ?? '', fromMemory: false }
    })

    return reply.send({ results })
  })
}