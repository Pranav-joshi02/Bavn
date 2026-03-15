// ============================================
// BAVN.io — scripts/capture-session.js
// Run ONCE locally to save your Google session
// Usage: node scripts/capture-session.js your@gmail.com
// ============================================

// Load env FIRST before any other imports
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join }  from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require   = createRequire(import.meta.url)

// Load dotenv synchronously
require('dotenv').config({ path: join(__dirname, '..', '.env') })

// Now safe to import supabase (env vars are loaded)
const { createClient } = require('@supabase/supabase-js')
const { chromium }     = require('playwright')
const fs               = require('fs')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

console.log('\n🔐 BAVN Session Capture\n')
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? '✓ loaded' : '✗ missing')

const email = process.argv[2]
if (!email) {
  console.error('\nUsage: node scripts/capture-session.js your@gmail.com')
  process.exit(1)
}

// Look up user
const { data: profile, error } = await supabase
  .from('profiles').select('user_id').eq('email', email).single()

if (!profile) {
  console.error(`\nNo BAVN profile found for ${email}`)
  console.error('Log into the BAVN extension first, then run this.')
  process.exit(1)
}

const userId = profile.user_id
console.log(`✓ Found profile: ${email} (${userId})\n`)

// Launch browser with real Chrome to avoid bot detection
const browser = await chromium.launch({
  headless: false,
  channel:  'chrome',
  args: [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
  ]
})

const context = await browser.newContext({
  viewport:  { width: 1280, height: 800 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  // Hide automation flags
  javaScriptEnabled: true,
})

// Remove webdriver flag — this is what Google detects
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
  Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3] })
})

const page = await context.newPage()
await page.goto('https://accounts.google.com', { waitUntil: 'networkidle' })

console.log('══════════════════════════════════════════')
console.log('  Browser is open.')
console.log('')
console.log('  Log into:')
console.log('  · Google account (required)')
console.log('  · Internshala (if you apply there)')
console.log('  · Any other site you want BAVN to use')
console.log('')
console.log('  Come back here and press ENTER when done.')
console.log('══════════════════════════════════════════\n')

await new Promise(resolve => {
  process.stdout.write('Press ENTER when done logging in > ')
  process.stdin.once('data', resolve)
})

console.log('\n⏳ Saving your session...')
const sessionState = await context.storageState()
const sessionJson  = JSON.stringify(sessionState)

// Upload to Supabase Storage
const blob = new Blob([sessionJson], { type: 'application/json' })
const { error: uploadError } = await supabase.storage
  .from('bavn-sessions')
  .upload(`${userId}/session.json`, blob, {
    upsert:      true,
    contentType: 'application/json',
  })

if (uploadError) {
  console.error('\n❌ Upload failed:', uploadError.message)
  // Save locally as fallback
  const backupPath = join(__dirname, '..', 'session-backup.json')
  fs.writeFileSync(backupPath, sessionJson)
  console.log(`Saved locally as session-backup.json`)
  console.log('You can manually upload it to Supabase Storage → bavn-sessions → ${userId}/session.json')
} else {
  console.log('\n✅ Session saved to Supabase!')
  console.log('Your Telegram bot can now submit forms on your behalf.')
  console.log('Re-run this script if the bot says session expired.\n')
}

await browser.close()
process.exit(0)