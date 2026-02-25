-- Migration: Add aggregation control columns to requirement_list
-- Date: 2026-02-25
--
-- is_selectable: whether this requirement appears in the treatment_plan.html modal dropdown.
--   false = computed/derived requirement that is never directly submitted by a student.
--
-- aggregation_config: JSON config driving how the vault computes progress for this requirement.
--   null / omitted  → "sum"  (default: sum rsu_units/cda_units from directly linked records)
--   { "type": "sum" }
--   { "type": "count" }                                  → count records (not sum units)
--   { "type": "count_exam" }                             → count is_exam=true records in division
--   { "type": "count_exam", "source_ids": ["uuid…"] }   → count exam records scoped to source reqs
--   { "type": "derived", "source_ids": ["uuid1","uuid2"], "operation": "sum_both" }
--       operation: "sum_both" (default) | "sum_rsu" | "sum_cda"
--       → aggregates computed values from other requirements (processed in pass 2)

ALTER TABLE public.requirement_list
  ADD COLUMN IF NOT EXISTS is_selectable  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS aggregation_config jsonb DEFAULT NULL;

COMMENT ON COLUMN public.requirement_list.is_selectable IS
  'When false, this requirement is hidden from the treatment plan modal dropdown. Used for derived/computed requirements.';

COMMENT ON COLUMN public.requirement_list.aggregation_config IS
  'JSON config for vault progress computation. null = default sum. See migration comments for schema.';
