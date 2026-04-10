-- Add instructor_id column to treatment_records if not exists
-- Records which instructor the student requested verification from
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'treatment_records'
      AND column_name = 'instructor_id'
  ) THEN
    ALTER TABLE public.treatment_records
      ADD COLUMN instructor_id uuid REFERENCES public.instructors(instructor_id);
  END IF;
END $$;
