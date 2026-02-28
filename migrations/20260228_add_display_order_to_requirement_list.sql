-- ──────────────────────────────────────────────────────────────────────────────
-- Migration: Add display_order to requirement_list
-- Date: 2026-02-28
--
-- Adds an integer display_order column so requirements can be given a custom
-- sort position within each division group.  Default 0 means existing rows
-- sort at position 0 (ties broken by requirement_type alphabetically).
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.requirement_list
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

-- Optional: set existing rows to 0 (already the default, kept for clarity)
-- UPDATE public.requirement_list SET display_order = 0;
