-- Migration: Add 'is_patient_treatment' column to 'divisions' table

-- 1. Add Column to Table
alter table public.divisions 
add column is_patient_treatment boolean not null default true;

-- 2. Update existing rows (Optional, if defaults need to vary)
-- update public.divisions set is_patient_treatment = false where code = '...';
