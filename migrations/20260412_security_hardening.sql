-- Migration: Security hardening
-- Date: 2026-04-12
-- 1) Revoke unnecessary anon grants on oracle schema
-- 2) Enable RLS on treatment_records, patients, students, users

-- =========================================================
-- 1) Revoke anon access to oracle schema
--    Only service_role (GAS backend) and authenticated are needed.
-- =========================================================

REVOKE USAGE ON SCHEMA oracle FROM anon;
REVOKE SELECT ON ALL TABLES IN SCHEMA oracle FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA oracle FROM anon;

-- Update default privileges so future oracle tables also exclude anon
ALTER DEFAULT PRIVILEGES IN SCHEMA oracle
  REVOKE SELECT ON TABLES FROM anon;

-- =========================================================
-- 2) Enable RLS on remaining public tables
--    GAS uses service_role key which bypasses RLS, so this
--    only protects against direct anon/authenticated access.
-- =========================================================

ALTER TABLE public.treatment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
