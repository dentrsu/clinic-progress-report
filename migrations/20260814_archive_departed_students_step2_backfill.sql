-- Archive departed students — STEP 2 of 2 (backfill).
--
-- ⚠️ Run only after step1_schema.sql has been executed AND committed.
-- Confirm first:
--   select unnest(enum_range(null::public.user_status))::text;
-- 'graduated' must be in the result, otherwise this file fails with 55P04.
--
-- Converts records the old "clear" path blanked out into explicit archives.
-- Cast to text because the empty string may or may not be a valid enum label
-- in this database.

update public.students
   set status = 'graduated',
       archived_at = coalesce(archived_at, now()),
       updated_at = now()
 where coalesce(status::text, '') = '';

update public.users
   set status = 'graduated'
 where role = 'student'
   and coalesce(status::text, '') = '';

-- Verification ------------------------------------------------------------
-- select status::text, count(*) from public.students group by 1 order by 2 desc;
-- select count(*) from public.students where archived_at is not null;
