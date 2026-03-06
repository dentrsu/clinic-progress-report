-- Migration: Add case progression milestones to patients table
-- Date: 2026-03-06
-- Description: Adds date columns to track the beginning of each treatment state.

ALTER TABLE public.patients
ADD COLUMN IF NOT EXISTS chart_full_at date,
ADD COLUMN IF NOT EXISTS first_tp_at date,
ADD COLUMN IF NOT EXISTS tp_approved_at date,
ADD COLUMN IF NOT EXISTS in_progress_at date,
ADD COLUMN IF NOT EXISTS case_completed_at date;

-- Add comments for clarity
COMMENT ON COLUMN public.patients.chart_full_at IS 'Beginning date of Full Chart state';
COMMENT ON COLUMN public.patients.first_tp_at IS 'Beginning date of First Treatment Plan state';
COMMENT ON COLUMN public.patients.tp_approved_at IS 'Beginning date of Treatment Plan Approved state';
COMMENT ON COLUMN public.patients.in_progress_at IS 'Beginning date of Treatment in Progress state';
COMMENT ON COLUMN public.patients.case_completed_at IS 'Beginning date of Completed Case state';
