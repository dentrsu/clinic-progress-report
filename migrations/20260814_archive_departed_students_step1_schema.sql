-- Archive departed students — STEP 1 of 2 (schema only).
--
-- Context: students absent from the Master Sheet have graduated or left the
-- programme. Their records must be retained for at least 5 years, but they
-- must not appear in instructor/advisor views or in any headcount, and they
-- must not be able to sign in.
--
-- The previous approach wrote an empty status, which every reader coerced back
-- to "active" via `status || 'active'` fallbacks. This migration introduces an
-- explicit label plus a retention timestamp.
--
-- ⚠️ RUN THIS FILE ON ITS OWN AND LET IT COMMIT.
-- Postgres refuses to use an enum label inside the transaction that added it
-- (SQLSTATE 55P04). The Supabase SQL Editor wraps a whole script in one
-- transaction, so the backfill lives in step 2 and must be run afterwards.

-- 1. Explicit label for students who left the programme -------------------
alter type public.user_status add value if not exists 'graduated';

-- 2. Retention clock ------------------------------------------------------
--    Stamped once, at first archive. Never overwritten by re-runs, so the
--    5-year window is measured from the real departure, not the last sync.
alter table public.students
  add column if not exists archived_at timestamptz;

comment on column public.students.archived_at is
  'When the student was archived after leaving the programme. Starts the 5-year record retention window. NULL = still enrolled.';

create index if not exists idx_students_archived_at
  on public.students (archived_at)
  where archived_at is not null;

-- Verify before running step 2 — 'graduated' must appear in this list:
--   select unnest(enum_range(null::public.user_status))::text;
