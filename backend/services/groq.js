// ============================================
// BAVN.io — services/groq.js
// Only sends fields the user has marked as AI-visible
// ============================================
import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

/**
 * Generate answers for a list of form questions.
 * @param {string[]} questions
 * @param {object}   profile        - full profile row from DB
 * @param {string[]} allowedFields  - keys the user wants sent to AI
 */
export async function generateAnswers(questions, profile, allowedFields = null) {
  const profileContext = buildProfileContext(profile, allowedFields)

  const systemPrompt = `
You are BAVN, a personal AI assistant that helps users fill out forms and applications.
You write answers in first person as if you are the user.
Be concise, professional, and genuine. Avoid filler phrases like "Certainly!" or "Of course!".
Match the tone to the question — formal for professional questions, natural for casual ones.

USER PROFILE:
${profileContext}
`.trim()

  const userPrompt = `
Answer each of these form questions using the user's profile above.
Return a JSON array like: [{ "question": "...", "answer": "..." }]
Return ONLY the JSON array — no markdown, no explanation.

QUESTIONS:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}
`.trim()

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 2048,
  })

  const raw   = completion.choices[0]?.message?.content ?? '[]'
  const clean = raw.replace(/```json|```/g, '').trim()

  try {
    return JSON.parse(clean)
  } catch {
    return questions.map(q => ({ question: q, answer: raw }))
  }
}

// ── Build context string from only allowed fields ──
function buildProfileContext(profile, allowedFields) {
  if (!profile) return 'No profile data available.'

  // All possible fields with friendly labels
  const ALL_FIELDS = [
    { key: 'name',            label: 'Name'            },
    { key: 'email',           label: 'Email'           },
    { key: 'phone',           label: 'Phone'           },
    { key: 'college',         label: 'College'         },
    { key: 'degree',          label: 'Degree'          },
    { key: 'graduation_year', label: 'Graduation Year' },
    { key: 'linkedin',        label: 'LinkedIn'        },
    { key: 'resume',          label: 'Resume/Bio'      },
  ]

  // If allowedFields provided, filter to only those — otherwise send all
  const fields = allowedFields
    ? ALL_FIELDS.filter(f => allowedFields.includes(f.key))
    : ALL_FIELDS

  const lines = fields
    .map(f => profile[f.key] ? `${f.label}: ${profile[f.key]}` : null)
    .filter(Boolean)

  return lines.length ? lines.join('\n') : 'No profile data provided.'
}