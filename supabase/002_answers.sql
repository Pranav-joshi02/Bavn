-- ============================================
-- BAVN.io — Migration 002: Answers Table
-- Run this second in Supabase SQL Editor
-- ============================================

CREATE TABLE IF NOT EXISTS public.answers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  source_url  TEXT,                        -- which site the form was on
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()

  -- Future: embedding vector(1536) for pgvector semantic search
);

-- Index for fast per-user queries
CREATE INDEX IF NOT EXISTS answers_user_id_idx ON public.answers(user_id);
CREATE INDEX IF NOT EXISTS answers_created_at_idx ON public.answers(created_at DESC);

-- Auto-update updated_at
CREATE TRIGGER answers_updated_at
  BEFORE UPDATE ON public.answers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
