// ============================================
// BAVN.io — scripts/export-session.js
// Saves your Google session for BAVN bot
// Usage: node scripts/export-session.js your@gmail.com
// ============================================
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join }  from 'path'
import os                 from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require   = createRequire(import.meta.url)

require('dotenv').config({ path: join(__dirname, '..', '.env') })

const { createClient } = require('@supabase/supabase-js')
const { chromium }     = require('playwright')
const fs               = require('fs')
const { execSync }     = require('child_process')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const email = process.argv[2]
if (!email) {
  console.error('Usage: node scripts/export-session.js your@gmail.com')
  process.exit(1)
}

// Kill Chrome
try {
  execSync('taskkill /F /IM chrome.exe', { stdio: 'ignore' })
  console.log('✓ Closed Chrome')
  await new Promise(r => setTimeout(r, 2000))
} catch(e) {}

// Look up user
const { data: profile } = await supabase
  .from('profiles').select('user_id').eq('email', email).single()

if (!profile) {
  console.error(`No profile found for ${email}`)
  process.exit(1)
}
const userId = profile.user_id
console.log(`✓ Found profile: ${email}\n`)

// Copy Default Chrome profile to a temp dir
// (Chrome requires non-default dir for remote debugging)
const srcDir  = join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default')
const tempDir = join(os.tmpdir(), 'bavn-chrome-session')

console.log('⏳ Copying Chrome profile...')
if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
fs.mkdirSync(tempDir, { recursive: true })

// Copy only session-critical files (fast, avoids locked files)
const filesToCopy = [
  'Cookies',
  'Login Data',
  'Web Data',
  'Preferences',
  'Secure Preferences',
]
const foldersToCopy = [
  'Local Storage',
  'Session Storage',
  'IndexedDB',
  'Network',
]

for (const file of filesToCopy) {
  const src = join(srcDir, file)
  const dst = join(tempDir, file)
  try {
    if (fs.existsSync(src)) fs.copyFileSync(src, dst)
  } catch(e) { /* skip locked files */ }
}

for (const folder of foldersToCopy) {
  const src = join(srcDir, folder)
  const dst = join(tempDir, folder)
  try {
    if (fs.existsSync(src)) {
      execSync(`xcopy "${src}" "${dst}" /E /I /H /Y /Q 2>nul`, { stdio: 'ignore' })
    }
  } catch(e) { /* skip */ }
}

console.log('✓ Profile copied\n')

// Launch with temp profile — no conflict with Chrome's default
const browser = await chromium.launchPersistentContext(tempDir, {
  headless:  false,
  channel:   'chrome',
  viewport:  { width: 1280, height: 800 },
  timeout:   30000,
  args: [
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
  ],
  ignoreDefaultArgs: ['--enable-automation', '--disable-sync'],
})

const page = await browser.newPage()

// Remove webdriver flag
await browser.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
})

await page.goto('https://accounts.google.com', { waitUntil: 'domcontentloaded', timeout: 15000 })
  .catch(() => {})

console.log('══════════════════════════════════════════')
console.log('  Chrome is open with your cookies.')
console.log('')
console.log('  1. Check you are logged into Google')
console.log('  2. Go to Internshala and confirm login')
console.log('  3. Come back here and press ENTER')
console.log('══════════════════════════════════════════\n')

await new Promise(resolve => {
  process.stdout.write('Press ENTER to save session > ')
  process.stdin.once('data', resolve)
})

console.log('\n⏳ Saving session...')
const sessionState = await browser.storageState()
const sessionJson  = JSON.stringify(sessionState)

await browser.close()

// Upload to Supabase Storage
try {
  const blob = new Blob([sessionJson], { type: 'application/json' })
  const { error } = await supabase.storage
    .from('bavn-sessions')
    .upload(`${userId}/session.json`, blob, {
      upsert:      true,
      contentType: 'application/json',
    })

  if (error) throw new Error(error.message)

  console.log('\n✅ Session saved to Supabase!')
  console.log('Your bot can now submit forms on your behalf.')
  console.log('Re-run this script if session expires.\n')

} catch(e) {
  console.error('\n❌ Upload failed:', e.message)
  const backupPath = join(__dirname, '..', 'session-backup.json')
  fs.writeFileSync(backupPath, sessionJson)
  console.log(`\nSaved locally: session-backup.json`)
  console.log('Upload manually to Supabase:')
  console.log(`  Storage → bavn-sessions → ${userId}/session.json`)
}

// Cleanup temp dir
try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch(e) {}

process.exit(0)