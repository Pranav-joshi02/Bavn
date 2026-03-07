// ============================================
// BAVN.io — server.js
// ============================================
import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'

import { authMiddleware } from './middleware/auth.js'
import answersRoute from './routes/answers.js'
import memoryRoute  from './routes/memory.js'
import profileRoute from './routes/profile.js'

const app = Fastify({ logger: true })

// ── CORS — allow all origins (Chrome extension needs this) ──
await app.register(cors, {
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman) and all chrome-extension:// origins
    cb(null, true)
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
})

// ── Auth hook ──────────────────────────────
app.addHook('preHandler', authMiddleware)

// ── Routes ────────────────────────────────
app.register(answersRoute, { prefix: '/api' })
app.register(memoryRoute,  { prefix: '/api' })
app.register(profileRoute, { prefix: '/api' })

// ── Health check ──────────────────────────
app.get('/health', async () => ({ status: 'ok', service: 'bavn-backend' }))

// ── Start ─────────────────────────────────
const PORT = process.env.PORT || 3000
try {
  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`BAVN backend running on :${PORT}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}