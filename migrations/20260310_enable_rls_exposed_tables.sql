-- Migration: Enable Row Level Security (RLS) on tables exposed to PostgREST
-- Date: 2026-03-10
-- Purpose: Resolve Supabase Security Vulnerabilities by closing public access.
--          Apps Script connects using a service_role key, which bypasses RLS.

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE oracle.timeline_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatment_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatment_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requirement_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatment_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.type_of_case ENABLE ROW LEVEL SECURITY;
