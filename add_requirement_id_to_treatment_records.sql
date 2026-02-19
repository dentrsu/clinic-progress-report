-- Add requirement_id to treatment_records
ALTER TABLE public.treatment_records
ADD COLUMN requirement_id uuid REFERENCES public.requirement_list(requirement_id);

COMMENT ON COLUMN public.treatment_records.requirement_id IS 'Link to specific requirement fulfilled by this record';
