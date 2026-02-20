-- Migration: Add 'is_patient_treatment' column to 'requirement_list' table

-- 1. Add Column to Table
alter table public.requirement_list 
add column is_patient_treatment boolean not null default true;
