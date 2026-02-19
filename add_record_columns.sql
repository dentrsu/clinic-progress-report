-- ============================================================
-- Migration: Add severity, book_number, page_number to treatment_records
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. severity — used by PERIO division to record periodontal severity
ALTER TABLE public.treatment_records
  ADD COLUMN severity numeric;

-- 2. book_number — used by OPER division to record the logbook number
ALTER TABLE public.treatment_records
  ADD COLUMN book_number numeric;

-- 3. page_number — used by OPER division to record the page number
ALTER TABLE public.treatment_records
  ADD COLUMN page_number numeric;
