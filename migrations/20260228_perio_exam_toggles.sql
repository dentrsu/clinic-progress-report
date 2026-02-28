-- Migration: PERIO Exam Toggles
-- Adds perio_exams jsonb column to treatment_records and updates the four
-- PERIO exam requirements to use the new perio_exam_flag aggregation type.

-- 1. Add perio_exams column to treatment_records
ALTER TABLE public.treatment_records
  ADD COLUMN IF NOT EXISTS perio_exams jsonb DEFAULT NULL;

-- 2. Update the four PERIO exam requirements:
--    - Mark as not selectable (removed from treatment plan dropdown)
--    - Set aggregation_config to perio_exam_flag type

-- OHI 1st Exam
UPDATE public.requirement_list rl
SET
  is_selectable = false,
  aggregation_config = '{"type":"perio_exam_flag","flag_key":"ohi_1st"}'
FROM public.divisions d
WHERE rl.division_id = d.division_id
  AND d.code = 'PERIO'
  AND rl.requirement_type = 'OHI 1st Exam';

-- OHI 2nd Exam
UPDATE public.requirement_list rl
SET
  is_selectable = false,
  aggregation_config = '{"type":"perio_exam_flag","flag_key":"ohi_2nd"}'
FROM public.divisions d
WHERE rl.division_id = d.division_id
  AND d.code = 'PERIO'
  AND rl.requirement_type = 'OHI 2nd Exam';

-- SRP 1st Exam
UPDATE public.requirement_list rl
SET
  is_selectable = false,
  aggregation_config = '{"type":"perio_exam_flag","flag_key":"srp_1st"}'
FROM public.divisions d
WHERE rl.division_id = d.division_id
  AND d.code = 'PERIO'
  AND rl.requirement_type = 'SRP 1st Exam';

-- SRP 2nd Exam
UPDATE public.requirement_list rl
SET
  is_selectable = false,
  aggregation_config = '{"type":"perio_exam_flag","flag_key":"srp_2nd"}'
FROM public.divisions d
WHERE rl.division_id = d.division_id
  AND d.code = 'PERIO'
  AND rl.requirement_type = 'SRP 2nd Exam';
