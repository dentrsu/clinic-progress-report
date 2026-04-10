-- Performance indexes for treatment_records table
-- These cover the most frequent query patterns in the application

-- 1. student_id — used by vault, treatment plan, dashboard (most common query)
CREATE INDEX IF NOT EXISTS idx_treatment_records_student_id
  ON public.treatment_records (student_id);

-- 2. instructor_id + status — used by verification queue (instructor/advisor)
CREATE INDEX IF NOT EXISTS idx_treatment_records_instructor_pending
  ON public.treatment_records (instructor_id, status)
  WHERE status = 'pending verification';

-- 3. status — used by admin verification (all pending records)
CREATE INDEX IF NOT EXISTS idx_treatment_records_status
  ON public.treatment_records (status)
  WHERE status = 'pending verification';

-- 4. patient_id — used by treatment plan page
CREATE INDEX IF NOT EXISTS idx_treatment_records_patient_id
  ON public.treatment_records (patient_id);

-- 5. requirement_id — used by vault aggregation joins
CREATE INDEX IF NOT EXISTS idx_treatment_records_requirement_id
  ON public.treatment_records (requirement_id);
