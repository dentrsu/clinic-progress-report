-- ============================================================
-- Migration: Add cda_units to treatment_records
-- Run this in the Supabase SQL Editor
-- ============================================================

ALTER TABLE public.treatment_records
  ADD COLUMN cda_units numeric;
