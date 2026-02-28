-- ──────────────────────────────────────────────────────────────────────────────
-- Migration: PERIO vault display redesign
-- Date: 2026-02-28
--
-- Adds derived RSU/CDA requirements for Periodontics vault display and marks
-- Case G / Case P as source-only so they no longer appear as raw rows in the
-- vault (students can still select them in treatment_plan.html).
--
-- Source requirement UUIDs:
--   Case G — 418523ff-0fa6-430c-b9d1-1693ef74fa44
--   Case P — 1ee6edcc-aba0-4b5a-876d-af81fc5c978c
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Mark Case G as source-only.
--    Keeps minimum_rsu > 0 so the dropdown badge [RSU] still shows in
--    treatment_plan.html; vault HTML filters this out via aggregation_config.type.
UPDATE public.requirement_list
SET aggregation_config = '{"type":"source_only"}'
WHERE requirement_id = '418523ff-0fa6-430c-b9d1-1693ef74fa44';

-- 2. Hide Case P from RSU vault (set minimum_rsu = 0).
--    Case P still appears in the CDA vault because minimum_cda remains > 0,
--    and it remains selectable in the treatment_plan dropdown (minimum_cda > 0).
UPDATE public.requirement_list
SET minimum_rsu = 0
WHERE requirement_id = '1ee6edcc-aba0-4b5a-876d-af81fc5c978c';

-- 3. Insert "Total Cases" (RSU derived — PERIO processor).
--    Counts Case G + Case P records where step order >= 7 (rsu_units > 0 proxy).
--    minimum_rsu is a placeholder; set the correct graduation target in the Admin Console.
INSERT INTO public.requirement_list (
  division_id, requirement_type, minimum_rsu, minimum_cda,
  is_selectable, aggregation_config, rsu_unit
)
SELECT
  division_id,
  'Total Cases',
  1,      -- ← placeholder: update via Admin Console
  0,
  false,
  '{"type":"perio_total_cases"}',
  'Case'
FROM public.requirement_list
WHERE requirement_id = '418523ff-0fa6-430c-b9d1-1693ef74fa44';

-- 4. Insert "Total Severity Case P" (RSU derived — PERIO processor).
--    Sum of severity of qualifying Case P records (computed as rsu_units × 0.5).
INSERT INTO public.requirement_list (
  division_id, requirement_type, minimum_rsu, minimum_cda,
  is_selectable, aggregation_config, rsu_unit
)
SELECT
  division_id,
  'Total Severity Case P',
  1,      -- ← placeholder: update via Admin Console
  0,
  false,
  '{"type":"perio_severity_casep"}',
  'Score'
FROM public.requirement_list
WHERE requirement_id = '418523ff-0fa6-430c-b9d1-1693ef74fa44';

-- 5. Insert "Complexities" (RSU sum_union — standard aggregation).
--    Sum of rsu_units from Case G + Case P records (records with step < 7 have
--    rsu_units = 0 so they contribute nothing to the total automatically).
INSERT INTO public.requirement_list (
  division_id, requirement_type, minimum_rsu, minimum_cda,
  is_selectable, aggregation_config, rsu_unit
)
SELECT
  division_id,
  'Complexities',
  1,      -- ← placeholder: update via Admin Console
  0,
  false,
  '{"type":"sum_union","also_sum":["418523ff-0fa6-430c-b9d1-1693ef74fa44","1ee6edcc-aba0-4b5a-876d-af81fc5c978c"]}',
  'Score'
FROM public.requirement_list
WHERE requirement_id = '418523ff-0fa6-430c-b9d1-1693ef74fa44';

-- 6. Insert "CDA Cases" (CDA count_union — standard aggregation).
--    Count of all Case G + Case P records (1 per record, any step).
INSERT INTO public.requirement_list (
  division_id, requirement_type, cda_requirement_type, minimum_rsu, minimum_cda,
  is_selectable, aggregation_config, cda_unit
)
SELECT
  division_id,
  'CDA Cases',       -- internal RSU-side label (never shown: minimum_rsu = 0)
  'CDA Cases',       -- CDA display label
  0,
  1,      -- ← placeholder: update via Admin Console
  false,
  '{"type":"count_union","also_count":["418523ff-0fa6-430c-b9d1-1693ef74fa44","1ee6edcc-aba0-4b5a-876d-af81fc5c978c","854f959d-6919-4e82-b093-91aa0a729415"]}',
  'Case'
FROM public.requirement_list
WHERE requirement_id = '418523ff-0fa6-430c-b9d1-1693ef74fa44';
