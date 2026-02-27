-- Migration: Change Class IV (OPER) aggregation_config from count_union to sum_union
-- Date: 2026-02-27
--
-- Previously Class IV counted records (own + Diastema Closure) as 1 each.
-- Now Class IV sums actual rsu_units/cda_units from Class IV + Diastema Closure records.
--
-- The Diastema Closure requirement_id is read from the existing also_count array
-- and written into also_sum, so no UUID is hardcoded here.

UPDATE public.requirement_list rl
SET aggregation_config = jsonb_build_object(
  'type',     'sum_union',
  'also_sum', (rl.aggregation_config -> 'also_count')
)
FROM public.divisions d
WHERE rl.division_id = d.division_id
  AND d.code = 'OPER'
  AND rl.requirement_type = 'Class IV'
  AND rl.aggregation_config ->> 'type' = 'count_union';
