-- =========================================================
-- ORACLE LAYER (Additive Migration)
-- Description: Creates the analytics/forecasting layer.
-- Safe to apply; does not alter existing operational tables.
-- =========================================================

-- 0) Extensions (safe if already enabled)
create extension if not exists pgcrypto;

-- 1) Create a dedicated schema
create schema if not exists oracle;

-- 1b) Grant schema access to Supabase roles
GRANT USAGE ON SCHEMA oracle TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA oracle TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA oracle TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA oracle
  GRANT SELECT ON TABLES TO anon, authenticated, service_role;

-- 2) Enums
do $$
begin
  if not exists (select 1 from pg_type where typname = 'oracle_risk_level') then
    create type oracle.oracle_risk_level as enum ('green','yellow','orange','red');
  end if;
end$$;

-- 3) Cohort / deadline config
create table if not exists oracle.cohort_calendar (
  cohort_year int primary key,
  cohort_label text not null,
  clinical_start_date date not null,
  graduation_deadline_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4) Optional checkpoints (expected pace by date)
create table if not exists oracle.timeline_targets (
  target_id uuid primary key default gen_random_uuid(),
  cohort_year int not null references oracle.cohort_calendar(cohort_year) on delete cascade,
  division_id uuid null references public.divisions(division_id) on delete set null,
  requirement_id uuid null references public.requirement_list(requirement_id) on delete set null,
  target_date date not null,
  expected_verified_rsu numeric null,
  expected_verified_cda numeric null,
  expected_completion_ratio numeric null check (expected_completion_ratio is null or (expected_completion_ratio >= 0 and expected_completion_ratio <= 1)),
  note text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_timeline_targets_cohort_date
  on oracle.timeline_targets(cohort_year, target_date);

-- 5) Student snapshot (one row per student per refresh)
create table if not exists oracle.student_progress_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(student_id) on delete cascade,
  cohort_year int null,
  snapshot_at timestamptz not null default now(),

  -- high-level outcomes
  risk_level oracle.oracle_risk_level not null,
  risk_score numeric not null check (risk_score >= 0 and risk_score <= 100),

  -- forecasting
  forecast_completion_month date null,        -- store as first day of month (e.g., 2027-02-01)
  forecast_months_remaining int null,

  -- progress summary (overall)
  verified_completion_pct numeric null check (verified_completion_pct is null or (verified_completion_pct >= 0 and verified_completion_pct <= 1)),
  estimated_completion_pct numeric null check (estimated_completion_pct is null or (estimated_completion_pct >= 0 and estimated_completion_pct <= 1)),
  pending_verification_count int not null default 0,
  inactive_days int not null default 0,

  -- velocity
  verified_velocity_4w numeric not null default 0,
  verified_velocity_8w numeric not null default 0,

  -- meta
  generated_by text not null default 'oracle_refresh_student',
  unique (student_id)  -- keep latest snapshot only (simple MVP)
);

-- 6) Division snapshot (per student x division)
create table if not exists oracle.student_division_snapshots (
  row_id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(student_id) on delete cascade,
  division_id uuid not null references public.divisions(division_id) on delete cascade,
  snapshot_at timestamptz not null default now(),

  verified_completion_pct numeric null check (verified_completion_pct is null or (verified_completion_pct >= 0 and verified_completion_pct <= 1)),
  estimated_completion_pct numeric null check (estimated_completion_pct is null or (estimated_completion_pct >= 0 and estimated_completion_pct <= 1)),
  remaining_rsu numeric null,
  remaining_cda numeric null,
  verified_velocity_8w numeric not null default 0,
  pace_gap numeric null,

  bottleneck_rank int null,
  risk_level oracle.oracle_risk_level not null,

  unique (student_id, division_id)  -- keep latest per division (simple MVP)
);

create index if not exists idx_student_division_snapshots_student
  on oracle.student_division_snapshots(student_id);

-- 7) Explanation factors (why this risk)
create table if not exists oracle.explanation_factors (
  factor_id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(student_id) on delete cascade,
  division_id uuid null references public.divisions(division_id) on delete set null,
  snapshot_at timestamptz not null default now(),

  factor_code text not null,         -- e.g., LOW_VERIFIED_VELOCITY_8W
  factor_label text not null,        -- human-friendly
  factor_value numeric null,
  severity int not null default 1 check (severity between 1 and 5),
  display_order int not null default 1
);

create index if not exists idx_explanation_factors_student
  on oracle.explanation_factors(student_id, snapshot_at desc);

-- 8) Recommendations (next actions)
create table if not exists oracle.recommendations (
  rec_id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(student_id) on delete cascade,
  snapshot_at timestamptz not null default now(),
  priority_rank int not null,
  recommendation_type text not null,         -- e.g., "PRIORITIZE_DIVISION", "CLEAR_PENDING_VERIFICATION"
  target_division_id uuid null references public.divisions(division_id) on delete set null,
  message text not null,
  reason_code text not null
);

create index if not exists idx_recommendations_student
  on oracle.recommendations(student_id, snapshot_at desc);

-- 9) Optional: status transition events (better ML later)
create table if not exists oracle.treatment_record_events (
  event_id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.treatment_records(record_id) on delete cascade,
  student_id uuid not null references public.students(student_id) on delete cascade,
  old_status text null,
  new_status text not null,
  changed_by uuid null references public.users(user_id) on delete set null, 
  changed_at timestamptz not null default now(),
  source text null
);

create index if not exists idx_record_events_student_time
  on oracle.treatment_record_events(student_id, changed_at desc);

-- ==========================================
-- ROW-LEVEL SECURITY (RLS) POLICIES
-- ==========================================

-- Enable RLS on all tables
ALTER TABLE oracle.cohort_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE oracle.student_progress_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE oracle.student_division_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE oracle.explanation_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE oracle.recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE oracle.treatment_record_events ENABLE ROW LEVEL SECURITY;

-- 1) Cohort Calendar (Read-only for authenticated users)
CREATE POLICY "Public read cohort calendar" 
ON oracle.cohort_calendar FOR SELECT TO authenticated USING (true);

-- 2) Snapshots (Students see own, Instructors see team/division students, Admins see all)
CREATE POLICY "Users can view their own, Team Leaders/Admins can view all" 
ON oracle.student_progress_snapshots FOR SELECT TO authenticated USING (
    (EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = auth.uid() AND u.role IN ('admin', 'instructor')))
    OR (student_id IN (SELECT s.student_id FROM public.students s WHERE s.user_id = auth.uid()))
);

CREATE POLICY "Users can view their own, Team Leaders/Admins can view all" 
ON oracle.student_division_snapshots FOR SELECT TO authenticated USING (
    (EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = auth.uid() AND u.role IN ('admin', 'instructor')))
    OR (student_id IN (SELECT s.student_id FROM public.students s WHERE s.user_id = auth.uid()))
);

CREATE POLICY "Users can view their own, Team Leaders/Admins can view all" 
ON oracle.explanation_factors FOR SELECT TO authenticated USING (
    (EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = auth.uid() AND u.role IN ('admin', 'instructor')))
    OR (student_id IN (SELECT s.student_id FROM public.students s WHERE s.user_id = auth.uid()))
);

CREATE POLICY "Users can view their own, Team Leaders/Admins can view all" 
ON oracle.recommendations FOR SELECT TO authenticated USING (
    (EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = auth.uid() AND u.role IN ('admin', 'instructor')))
    OR (student_id IN (SELECT s.student_id FROM public.students s WHERE s.user_id = auth.uid()))
);

CREATE POLICY "Users can view their own, Team Leaders/Admins can view all" 
ON oracle.treatment_record_events FOR SELECT TO authenticated USING (
    (EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = auth.uid() AND u.role IN ('admin', 'instructor')))
    OR (student_id IN (SELECT s.student_id FROM public.students s WHERE s.user_id = auth.uid()))
);
