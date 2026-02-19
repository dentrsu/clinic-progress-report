-- ============================================================
-- Migration: Add Treatment Phases
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Create the treatment_phases lookup table
CREATE TABLE public.treatment_phases (
  phase_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_order integer NOT NULL UNIQUE,
  phase_name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Seed the five phases in ascending treatment-plan order
INSERT INTO public.treatment_phases (phase_order, phase_name) VALUES
  (1, 'Systemic Phase'),
  (2, 'Acute Phase'),
  (3, 'Disease Control Phase'),
  (4, 'Definitive Phase'),
  (5, 'Maintenance Phase');

-- 3. Add phase_id column to treatment_records (nullable for existing rows)
ALTER TABLE public.treatment_records
  ADD COLUMN phase_id uuid
  REFERENCES public.treatment_phases(phase_id);

-- 4. (Optional) Create an index for faster phase-based queries
CREATE INDEX idx_treatment_records_phase_id
  ON public.treatment_records(phase_id);
