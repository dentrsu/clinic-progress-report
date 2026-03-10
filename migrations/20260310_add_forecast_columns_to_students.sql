-- Add forecast columns to public.students table
ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS forecast_completion_date DATE,
ADD COLUMN IF NOT EXISTS forecast_at TIMESTAMPTZ;
