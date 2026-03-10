-- Migration: Add est_work_duration to requirement_list
-- Date: 2026-03-08

ALTER TABLE public.requirement_list
  ADD COLUMN est_work_duration numeric NULL;

-- Default existing rows to 1 so the oracle calculations remain a 1:1 fallback
UPDATE public.requirement_list SET est_work_duration = 1 WHERE est_work_duration IS NULL;
