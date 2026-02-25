-- Migration: Add cda_requirement_type and clinical division instructor columns

-- 1. Add cda_requirement_type to requirement_list
-- We add it generally, then you can position it logically in your application views. 
-- PostgreSQL doesn't support 'AFTER column_name' syntax natively like MySQL, columns are always appended to the end of the table structure.
ALTER TABLE public.requirement_list 
ADD COLUMN cda_requirement_type text;

-- 2. Add 9 Clinical Division Instructor IDs to students table
-- Each column references the public.instructors(instructor_id) table.
ALTER TABLE public.students 
ADD COLUMN oper_instructor_id uuid REFERENCES public.instructors(instructor_id) ON DELETE SET NULL,
ADD COLUMN endo_instructor_id uuid REFERENCES public.instructors(instructor_id) ON DELETE SET NULL,
ADD COLUMN perio_instructor_id uuid REFERENCES public.instructors(instructor_id) ON DELETE SET NULL,
ADD COLUMN prosth_instructor_id uuid REFERENCES public.instructors(instructor_id) ON DELETE SET NULL,
ADD COLUMN diag_instructor_id uuid REFERENCES public.instructors(instructor_id) ON DELETE SET NULL,
ADD COLUMN radio_instructor_id uuid REFERENCES public.instructors(instructor_id) ON DELETE SET NULL,
ADD COLUMN sur_instructor_id uuid REFERENCES public.instructors(instructor_id) ON DELETE SET NULL,
ADD COLUMN ortho_instructor_id uuid REFERENCES public.instructors(instructor_id) ON DELETE SET NULL,
ADD COLUMN pedo_instructor_id uuid REFERENCES public.instructors(instructor_id) ON DELETE SET NULL;
