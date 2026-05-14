-- Migration: Beta feedback survey table
-- Date: 2026-05-14
-- Captures UX/UI feedback from beta testers (students + instructors) while using the app.

CREATE TABLE IF NOT EXISTS public.beta_feedback (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_email  text,
  role        text,
  page        text,
  rating      smallint    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT beta_feedback_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS beta_feedback_created_at_idx
  ON public.beta_feedback (created_at DESC);

-- GAS uses service_role which bypasses RLS; this only blocks direct anon access.
ALTER TABLE public.beta_feedback ENABLE ROW LEVEL SECURITY;
