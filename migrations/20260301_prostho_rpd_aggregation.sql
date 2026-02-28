-- Migration: PROSTHO RPD Aggregation
-- MRPD and ARPD become source_only: still selectable in treatment plan dropdown
-- but hidden from vault top-level display (they appear as sub-items under RPD).
-- RPD derives its RSU/CDA totals from MRPD + ARPD via pass-2 "derived" aggregation.

-- 1. Mark MRPD and ARPD as source_only
UPDATE public.requirement_list rl
SET aggregation_config = '{"type":"source_only"}'
FROM public.divisions d
WHERE rl.division_id = d.division_id
  AND d.code = 'PROSTH'
  AND rl.requirement_type IN ('MRPD', 'ARPD');

-- 2. Set RPD to derive from MRPD + ARPD (sum both RSU and CDA)
UPDATE public.requirement_list rl
SET aggregation_config = json_build_object(
  'type', 'derived',
  'source_ids', json_build_array(
    (SELECT r2.requirement_id
     FROM public.requirement_list r2
     JOIN public.divisions d2 ON r2.division_id = d2.division_id
     WHERE d2.code = 'PROSTH' AND r2.requirement_type = 'MRPD'),
    (SELECT r2.requirement_id
     FROM public.requirement_list r2
     JOIN public.divisions d2 ON r2.division_id = d2.division_id
     WHERE d2.code = 'PROSTH' AND r2.requirement_type = 'ARPD')
  ),
  'operation', 'sum_both'
)::jsonb
FROM public.divisions d
WHERE rl.division_id = d.division_id
  AND d.code = 'PROSTH'
  AND rl.requirement_type = 'RPD';
