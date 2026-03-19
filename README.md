# BAVN.io — AI Form Filler & Review Writer

> *Built-in Autofill & Verification Node*

🌐 **Website:** [bavn.io]((https://bavn-public-v0-1-chi.vercel.app/)) 
✈️ **Telegram Bot:** [@bavn_bot](https://t.me/@Bavnbot)  
🔧 **Backend:** [bavn-backend.onrender.com](https://bavn-backend.onrender.com)

---

## What is BAVN?

BAVN is a free AI tool that fills forms for you. Send a form URL to the Telegram bot, get perfectly written answers in seconds, then the Chrome extension auto-fills the entire form — even across multiple pages.

Works on Internshala, Unstop, Google Forms, LinkedIn, Naukri, and any website.

---

## Features

- **Telegram Bot** — Send a form URL, get AI-generated answers instantly
- **Chrome Extension** — Auto-fills all form fields and clicks Next automatically
- **Smart Memory** — Remembers your answers and reuses them for similar questions
- **Review Writer** — Write reviews for Zomato, Swiggy, Google Maps, and more
- **Cross-device Sync** — Answers saved to cloud, accessible from anywhere
- **Privacy Controls** — Choose which fields the AI can see

---

## Tech Stack

| Layer | Service |
|---|---|
| Chrome Extension | Manifest V3 · Vanilla JS |
| Backend | Fastify · Node.js · Render.com |
| Database + Auth | Supabase (Postgres + RLS) |
| AI | Gemini 2.0 Flash (primary) · Groq LLaMA (fallback) |
| Telegram | Telegram Bot API (webhook) |
| Website | HTML/CSS/JS · Vercel |

---

## Project Structure

```
bavn.io/
├── backend/
│   ├── server.js                 # Fastify entry point
│   ├── middleware/
│   │   └── auth.js               # Supabase JWT validation
│   ├── routes/
│   │   ├── answers.js            # AI answer generation + streaming
│   │   ├── memory.js             # Saved answers CRUD
│   │   ├── profile.js            # User profile CRUD
│   │   ├── accounts.js           # Linked Google accounts
│   │   └── telegram.js           # Telegram bot + fill jobs
│   ├── services/
│   │   ├── ai.js                 # Gemini + Groq routing
│   │   ├── browser.js            # Playwright auto-submit
│   │   ├── cache.js              # LRU cache
│   │   ├── scraper.js            # Form question scraper
│   │   └── supabase.js           # Supabase client
│   ├── scripts/
│   │   └── export-session.js     # One-time Google session capture
│   └── package.json
│
├── extension/
│   ├── manifest.json
│   ├── sidebar.html              # Extension UI
│   ├── sidebar.js                # Main extension logic
│   ├── content.js                # Form detection + multi-page fill
│   └── background.js             # Auth + messaging
│
├── website/
│   ├── index.html                # Landing page
│   ├── privacy.html
│   ├── terms.html
│   └── roadmap.html
│
└── supabase/
    ├── 001_profiles.sql
    ├── 002_answers.sql
    ├── 003_rls.sql
    ├── 004_user_profiles.sql
    ├── 005_linked_accounts.sql
    ├── 006_telegram.sql
    ├── 007_fill_jobs.sql
    ├── 008_session_storage.sql
    └── 009_scrape_jobs.sql
```

---

## Setup Guide

### Prerequisites
- Node.js v18+
- Supabase account 
- Render.com account 
- Vercel account 
- Telegram account

### 1. Supabase Setup

1. Create a new Supabase project
2. Go to SQL Editor and run all migrations in order:
   ```
   supabase/001_profiles.sql → 009_scrape_jobs.sql
   ```
3. Copy your project URL and service role key

### 2. Backend (Render)

1. Push the `backend/` folder to GitHub
2. Create a new Web Service on Render
3. Set **Root Directory** to `backend`
4. Add environment variables:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key
GROQ_API_KEY=your_groq_key
GEMINI_API_KEY=your_gemini_key
TELEGRAM_BOT_TOKEN=your_bot_token
BASE_URL=https://your-backend.onrender.com
PORT=3000
```

5. Set up a cron job at [cron-job.org](https://cron-job.org) to ping `/health` every 10 minutes to keep Render awake

### 3. Telegram Bot

1. Open Telegram → search **@BotFather** → `/newbot`
2. Copy the token → add to Render env vars as `TELEGRAM_BOT_TOKEN`
3. Open Telegram → search **@userinfobot** → `/start` → copy your numeric ID
4. Open BAVN extension → Profile tab → paste ID in **Telegram ID** field → Save

### 4. Chrome Extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Sign in with Google when prompted

### 5. Website (Vercel)

1. Push the `website/` folder to GitHub
2. Import to Vercel
3. Place `BAVN-extension-v1.0.zip` in the website folder
4. Deploy

---

## How It Works

```
User opens Telegram bot
  → Sends form URL
  → Bot generates AI answers using profile
  → Answers pushed to Supabase fill_jobs table

Chrome extension (polling every 5s)
  → Detects pending fill job
  → Matches URL → auto-fills all fields
  → Clicks Next across multiple pages
  → Marks job complete

Memory sync
  → Both extension and bot write to same answers table
  → Memory tab shows all saved answers from both sources
```

---

## Roadmap

- [ ] Pattern memory — learn your writing style over time
- [ ] Real-time form coaching — live hints while typing
- [ ] Auto-apply agent — full Puppeteer form submission
- [ ] Form DNA fingerprinting — site-specific memory
- [ ] Multi-profile switching
- [ ] Chrome Web Store submission

---


## License

MIT © 2025 BAVN.io
