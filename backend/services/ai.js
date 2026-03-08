// ============================================
// BAVN.io — services/ai.js
// Dual model routing: Gemini primary, Groq fallback
// ============================================
import Groq from 'groq-sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'

const groq  = new Groq({ apiKey: process.env.GROQ_API_KEY })
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

// ── Model assignments ─────────────────────
// gemini-2.0-flash  → form answers, reviews, pattern analysis
// llama-3.3-70b     → Groq fallback
// llama-3.1-8b-inst → real-time coaching, WhatsApp bot
// mixtral-8x7b      → A/B variants

// ── Build profile context ─────────────────
function buildProfileContext(profile, allowedFields) {
  if (!profile) return 'No profile data available.'
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
  const fields = allowedFields
    ? ALL_FIELDS.filter(f => allowedFields.includes(f.key))
    : ALL_FIELDS
  const lines = fields
    .map(f => profile[f.key] ? `${f.label}: ${profile[f.key]}` : null)
    .filter(Boolean)
  return lines.length ? lines.join('\n') : 'No profile data provided.'
}

// ── Generate form answers (Gemini → Groq fallback) ──
export async function generateAnswers(questions, profile, allowedFields = null) {
  const profileContext = buildProfileContext(profile, allowedFields)
  const systemPrompt = `You are BAVN, a personal AI assistant that helps users fill out forms.
Write answers in first person as if you are the user.
Be concise, professional, and genuine. No filler phrases.
Match tone to context — formal for corporate, natural for casual.

USER PROFILE:
${profileContext}`

  const userPrompt = `Answer each form question using the user profile above.
Return ONLY a JSON array: [{ "question": "...", "answer": "..." }]
No markdown, no explanation.

QUESTIONS:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`

  try {
    return await generateWithGemini(systemPrompt, userPrompt)
  } catch (err) {
    console.log('[BAVN AI] Gemini failed, falling back to Groq:', err.message)
    return await generateWithGroq('llama-3.3-70b-versatile', systemPrompt, userPrompt, questions)
  }
}

// ── Generate review (Gemini primary) ──────
export async function generateReview(context, platform, stars) {
  const toneMap = {
    5: 'enthusiastic and genuinely delighted',
    4: 'positive with minor observations',
    3: 'balanced — good and bad equally',
    2: 'diplomatically critical but fair',
    1: 'honest and clearly disappointed',
  }
  const tone = toneMap[stars] || 'balanced'
  const systemPrompt = `You write authentic, human-sounding reviews for ${platform}.
Tone: ${tone}. 3-5 sentences. Specific details. Natural voice. No corporate language.
Never start with "I". Vary sentence structure. Sound like a real person.`

  const userPrompt = `Write a ${platform} review based on this experience:
"${context}"
Star rating: ${stars}/5
Return ONLY the review text. No quotes, no explanation.`

  try {
    const model  = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
    const result = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`)
    return result.response.text().trim()
  } catch (err) {
    console.log('[BAVN AI] Gemini review failed, using Groq:', err.message)
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      temperature: 0.8, max_tokens: 300,
    })
    return completion.choices[0]?.message?.content?.trim() ?? ''
  }
}

// ── WhatsApp bot reply (fast 8b model) ────
export async function generateWhatsAppReply(userMessage, conversationHistory = []) {
  const systemPrompt = `You are BAVN, a WhatsApp assistant that helps users fill forms and write reviews.
Be concise and conversational — this is WhatsApp, not an essay.
Max 3-4 lines per reply. Use simple language.
When user sends a form link: confirm you'll fill it and ask them to confirm the answers.
When user sends a place + rating: write a review and ask if they want to post it.`

  try {
    const messages = [
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ]
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.7, max_tokens: 256,
    })
    return completion.choices[0]?.message?.content?.trim() ?? 'Something went wrong, please try again.'
  } catch (err) {
    return 'Sorry, I am having trouble right now. Please try again in a moment.'
  }
}

// ── Helpers ───────────────────────────────
async function generateWithGemini(systemPrompt, userPrompt) {
  const model  = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
  const result = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`)
  const raw    = result.response.text()
  const clean  = raw.replace(/```json|```/g, '').trim()
  return JSON.parse(clean)
}

async function generateWithGroq(modelName, systemPrompt, userPrompt, questions) {
  const completion = await groq.chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    temperature: 0.7, max_tokens: 2048,
  })
  const raw   = completion.choices[0]?.message?.content ?? '[]'
  const clean = raw.replace(/```json|```/g, '').trim()
  try {
    return JSON.parse(clean)
  } catch {
    return questions.map(q => ({ question: q, answer: raw }))
  }
}

// ── Regenerate single form answer ─────────
// Called when user says "change Q2 make it more confident"
export async function regenerateSingleAnswer(question, instruction, profile) {
  const profileContext = buildProfileContext(profile, null)

  const systemPrompt = `You are BAVN, rewriting a single form answer based on user feedback.
Write in first person. Be concise and genuine.
USER PROFILE:\n${profileContext}`

  const userPrompt = `Original question: "${question}"
User instruction: "${instruction}"

Rewrite the answer following the instruction exactly.
Return ONLY the new answer text. No explanation, no quotes.`

  try {
    const model  = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
    const result = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`)
    return result.response.text().trim()
  } catch (err) {
    console.log('[BAVN AI] Gemini failed for single regen, using Groq')
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt }
      ],
      temperature: 0.7, max_tokens: 512
    })
    return completion.choices[0]?.message?.content?.trim() ?? ''
  }
}

// ── Regenerate review with instruction ────
// Called when user says "make it shorter" or "make it more formal"
export async function regenerateReview(experience, platform, stars, currentReview, instruction) {
  const toneMap = {
    5: 'enthusiastic and genuinely delighted',
    4: 'positive with minor observations',
    3: 'balanced — good and bad equally',
    2: 'diplomatically critical but fair',
    1: 'honest and clearly disappointed'
  }
  const tone = toneMap[stars] || 'balanced'

  const systemPrompt = `You are BAVN, rewriting a ${platform} review based on user feedback.
Tone: ${tone}. Sound like a real person. No corporate language. Never start with "I".`

  const userPrompt = `Original experience: "${experience}"
Current review: "${currentReview}"
User instruction: "${instruction}"

Rewrite the review following the instruction exactly.
Return ONLY the new review text. No quotes, no explanation.`

  try {
    const model  = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
    const result = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`)
    return result.response.text().trim()
  } catch (err) {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt }
      ],
      temperature: 0.8, max_tokens: 300
    })
    return completion.choices[0]?.message?.content?.trim() ?? ''
  }
}