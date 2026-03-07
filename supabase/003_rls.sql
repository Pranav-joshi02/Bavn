-- ============================================
-- BAVN.io — Migration 003: Row Level Security
-- Run this third in Supabase SQL Editor
-- ============================================

-- ── PROFILES ──────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can only read their own profile
CREATE POLICY "profiles: select own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

-- Users can only insert their own profile
CREATE POLICY "profiles: insert own"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can only update their own profile
CREATE POLICY "profiles: update own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own profile
CREATE POLICY "profiles: delete own"
  ON public.profiles FOR DELETE
  USING (auth.uid() = user_id);


-- ── ANSWERS ───────────────────────────────

ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;

-- Users can only read their own answers
CREATE POLICY "answers: select own"
  ON public.answers FOR SELECT
  USING (auth.uid() = user_id);

-- Users can only insert answers tied to themselves
CREATE POLICY "answers: insert own"
  ON public.answers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can only update their own answers
CREATE POLICY "answers: update own"
  ON public.answers FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own answers
CREATE POLICY "answers: delete own"
  ON public.answers FOR DELETE
  USING (auth.uid() = user_id);
