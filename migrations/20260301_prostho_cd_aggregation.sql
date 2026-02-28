-- Migration: PROSTHO CD Aggregation
-- CD (Upper) and CD (Lower) become source_only: selectable in treatment plan dropdown,
-- hidden from vault top-level display (they appear as sub-items under CD).
-- CD derives its RSU/CDA totals from CD (Upper) + CD (Lower) via pass-2 "derived" aggregation.

-- 1. Mark CD (Upper) and CD (Lower) as source_only
UPDATE public.requirement_list rl
SET aggregation_config = '{"type":"source_only"}'
FROM public.divisions d
WHERE rl.division_id = d.division_id
  AND d.code = 'PROSTH'
  AND rl.requirement_type IN ('CD (Upper)', 'CD (Lower)');

-- 2. Set CD to derive from CD (Upper) + CD (Lower) (sum both RSU and CDA)
UPDATE public.requirement_list rl
SET aggregation_config = json_build_object(
  'type', 'derived',
  'source_ids', json_build_array(
    (SELECT r2.requirement_id
     FROM public.requirement_list r2
     JOIN public.divisions d2 ON r2.division_id = d2.division_id
     WHERE d2.code = 'PROSTH' AND r2.requirement_type = 'CD (Upper)'),
    (SELECT r2.requirement_id
     FROM public.requirement_list r2
     JOIN public.divisions d2 ON r2.division_id = d2.division_id
     WHERE d2.code = 'PROSTH' AND r2.requirement_type = 'CD (Lower)')
  ),
  'operation', 'sum_both'
)::jsonb
FROM public.divisions d
WHERE rl.division_id = d.division_id
  AND d.code = 'PROSTH'
  AND rl.requirement_type = 'CD';
