-- Migration: Correct 'is_patient_treatment' column location

-- 1. Remove incorrectly added column from 'divisions'
alter table public.divisions 
drop column if exists is_patient_treatment;

-- 2. Add column to correct table 'requirement_list'
alter table public.requirement_list 
add column is_patient_treatment boolean not null default true;
