-- Rename is_exam_rct to is_exam in treatment_records table
ALTER TABLE public.treatment_records 
RENAME COLUMN is_exam_rct TO is_exam;

COMMENT ON COLUMN public.treatment_records.is_exam IS 'Flag for tracking Exam cases (e.g., RCT in Endodontics)';
