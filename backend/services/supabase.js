// ============================================
// BAVN.io — services/supabase.js
// Backend Supabase client (service role key)
// ============================================
import { createClient } from '@supabase/supabase-js'

// Service role key bypasses RLS — only use server-side, never expose
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)
