// ============================================
// BAVN.io — utils/api.js
// All calls to the Fastify backend
// ============================================
import { API_BASE } from './config.js'
import { getToken, clearSession } from './auth.js'

async function request(method, path, body = null) {
  const token = await getToken()

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  // Auto-logout on 401
  if (res.status === 401) {
    await clearSession()
    throw new Error('Session expired — please log in again')
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `Request failed: ${res.status}`)
  }

  return res.json()
}

// ── Answers ───────────────────────────────

/** Generate (or recall) answers for an array of questions */
export async function generateAnswers(questions, sourceUrl) {
  return request('POST', '/api/answers', { questions, sourceUrl })
}

// ── Memory ────────────────────────────────

/** Fetch all saved answers for the user */
export async function getMemory() {
  return request('GET', '/api/memory')
}

/** Delete a saved answer by id */
export async function deleteAnswer(id) {
  return request('DELETE', `/api/memory/${id}`)
}

// ── Profile ───────────────────────────────

/** Fetch user profile */
export async function getProfile() {
  return request('GET', '/api/profile')
}

/** Save / update user profile */
export async function saveProfile(data) {
  return request('POST', '/api/profile', data)
}
