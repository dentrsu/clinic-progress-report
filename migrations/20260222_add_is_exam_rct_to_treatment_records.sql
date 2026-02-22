-- Add is_exam_rct column to treatment_records table
ALTER TABLE public.treatment_records
ADD COLUMN is_exam_rct BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN public.treatment_records.is_exam_rct IS 'Flag for tracking Exam RCT cases in Endodontics division';
