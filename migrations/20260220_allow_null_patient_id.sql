-- Allow patient_id to be NULL for Rotate Clinic records
ALTER TABLE public.treatment_records ALTER COLUMN patient_id DROP NOT NULL;

-- Add columns for ad-hoc patient info (Rotate Clinic)
ALTER TABLE public.treatment_records ADD COLUMN IF NOT EXISTS hn text;
ALTER TABLE public.treatment_records ADD COLUMN IF NOT EXISTS patient_name text;
