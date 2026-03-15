// ============================================
// BAVN.io — server.js
// ============================================
import 'dotenv/config'
import Fastify from 'fastify'
import cors    from '@fastify/cors'

import { authMiddleware }                        from './middleware/auth.js'
import answersRoute                              from './routes/answers.js'
import memoryRoute                               from './routes/memory.js'
import profileRoute                              from './routes/profile.js'
import accountsRoute                             from './routes/accounts.js'
import telegramRoute, { setupTelegramWebhook }   from './routes/telegram.js'

const app = Fastify({ logger: true })

await app.register(cors, {
  origin:         (origin, cb) => { cb(null, true) },
  methods:        ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials:    true,
})

// ── Public routes (no auth) ───────────────
app.get('/health', async () => ({ status: 'ok', service: 'bavn-backend' }))

// Telegram webhook — public, registered before auth hook
app.register(telegramRoute, { prefix: '/api' })

// OAuth link/callback — public
app.register(accountsRoute)

// ── Auth middleware (all routes below require JWT) ──
app.addHook('preHandler', authMiddleware)

// ── Protected routes ──────────────────────
app.register(answersRoute, { prefix: '/api' })
app.register(memoryRoute,  { prefix: '/api' })
app.register(profileRoute, { prefix: '/api' })

const PORT = parseInt(process.env.PORT) || 3000

try {
  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`[BAVN] Backend running on port ${PORT}`)
  await setupTelegramWebhook()
} catch (err) {
  app.log.error(err)
  process.exit(1)
}