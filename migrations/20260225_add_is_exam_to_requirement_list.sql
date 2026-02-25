-- Migration: Add is_exam flag to requirement_list
-- Date: 2026-02-25
--
-- Purpose: Allow categorizing requirements as "exam-type" at the requirement definition
-- level (not just at the treatment_records level). This enables the requirement vault
-- to correctly display and group exam requirements separately from regular RSU/CDA requirements.
--
-- Usage: After running this migration, update existing exam-type requirements via:
--   UPDATE public.requirement_list SET is_exam = true WHERE requirement_type ILIKE '%exam%';
-- (Review and adjust the WHERE clause to match your actual exam requirement names.)

ALTER TABLE public.requirement_list
  ADD COLUMN IF NOT EXISTS is_exam boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.requirement_list.is_exam IS
  'True for exam-type requirements (e.g. Exam RCT). These are counted by number of exam records, not by rsu_units/cda_units sum.';
