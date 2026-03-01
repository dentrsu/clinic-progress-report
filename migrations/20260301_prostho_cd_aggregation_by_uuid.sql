-- Fix: PROSTHO CD Aggregation (by UUID)
-- The previous migration (20260301_prostho_cd_aggregation.sql) targeted rows by
-- requirement_type text which did not match the actual values in the DB.
-- This migration uses the exact requirement_ids instead.
--
-- CD            : 4c282f32-2d62-4285-b3c7-76a0225b9639  (derived parent)
-- CD (Upper)    : d8e91cd3-6fb2-42e0-8843-53836d5cc44d  (source_only)
-- CD (Lower)    : 9b3872fd-b738-4f19-841e-7575b853f185  (source_only)

-- 1. Mark CD (Upper) and CD (Lower) as source_only
UPDATE public.requirement_list
SET aggregation_config = '{"type":"source_only"}'
WHERE requirement_id IN (
  'd8e91cd3-6fb2-42e0-8843-53836d5cc44d',
  '9b3872fd-b738-4f19-841e-7575b853f185'
);

-- 2. Set CD to derive from CD (Upper) + CD (Lower) (sum both RSU and CDA)
UPDATE public.requirement_list
SET aggregation_config = '{
  "type": "derived",
  "source_ids": [
    "d8e91cd3-6fb2-42e0-8843-53836d5cc44d",
    "9b3872fd-b738-4f19-841e-7575b853f185"
  ],
  "operation": "sum_both"
}'::jsonb
WHERE requirement_id = '4c282f32-2d62-4285-b3c7-76a0225b9639';
