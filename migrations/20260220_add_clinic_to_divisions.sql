-- Migration: Add 'clinic' column to 'divisions' table

-- 1. Create Enum Type
create type public.clinic_type as enum ('main', 'rotate', 'N/A');

-- 2. Add Column to Table
alter table public.divisions 
add column clinic public.clinic_type not null default 'N/A';

-- 3. Update existing rows (Optional, if needed to set defaults different from 'N/A')
-- update public.divisions set clinic = 'main' where ...;
