-- Migration: Add completed_at to treatment_records
-- Created: 2026-04-12

-- 1. Add the column
ALTER TABLE public.treatment_records 
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- 2. Add an index for performance (Oracle velocity queries)
CREATE INDEX IF NOT EXISTS idx_treatment_records_completed_at 
ON public.treatment_records(completed_at);

-- 3. Backfill existing records
-- For verified records, use verified_at
UPDATE public.treatment_records
SET completed_at = verified_at
WHERE status = 'verified' 
  AND verified_at IS NOT NULL 
  AND completed_at IS NULL;

-- For completed/pending records, use updated_at as a proxy
UPDATE public.treatment_records
SET completed_at = updated_at
WHERE status IN ('completed', 'pending verification', 'rejected')
  AND completed_at IS NULL;

-- For anything else that might have units but no completed_at (fallback)
UPDATE public.treatment_records
SET completed_at = created_at
WHERE completed_at IS NULL 
  AND (rsu_units > 0 OR cda_units > 0);
