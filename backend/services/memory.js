// ============================================
// BAVN.io — services/memory.js
// Finds past answers that match new questions
// ============================================
import { supabase } from '../services/supabase.js'

/**
 * Given a new question, search the user's saved answers
 * for a close enough match via keyword overlap.
 *
 * @param {string} userId
 * @param {string} question
 * @returns {object|null} matched answer row, or null
 */
export async function findSimilarAnswer(userId, question) {
  const { data: answers, error } = await supabase
    .from('answers')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error || !answers?.length) return null

  const normalize = str =>
    str.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()

  const queryWords = new Set(normalize(question).split(/\s+/).filter(w => w.length > 3))

  let bestMatch = null
  let bestScore = 0

  for (const row of answers) {
    const rowWords = normalize(row.question).split(/\s+/).filter(w => w.length > 3)
    const overlap = rowWords.filter(w => queryWords.has(w)).length
    const score = overlap / Math.max(queryWords.size, rowWords.length, 1)

    if (score > bestScore && score >= 0.45) {   // 45% word overlap threshold
      bestScore = score
      bestMatch = row
    }
  }

  return bestMatch
}
