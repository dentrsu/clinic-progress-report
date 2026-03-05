-- =========================================================
-- ORACLE REFRESH FUNCTION (RPC)
-- =========================================================

-- Helper: month diff
create or replace function oracle.months_between(a date, b date)
returns int language sql immutable as $$
  select (date_part('year', age(b, a))::int * 12) + date_part('month', age(b, a))::int;
$$;

-- Main RPC: recompute student oracle snapshot + explanations + recommendations
create or replace function oracle.oracle_refresh_student(p_student_id uuid)
returns json
language plpgsql
security definer
as $$
declare
  v_now timestamptz := now();
  v_cohort_year int;
  v_deadline date;
  v_start date;

  v_pending int := 0;
  v_inactive_days int := 0;

  v_verified_4w numeric := 0;
  v_verified_8w numeric := 0;

  v_verified_pct numeric := null;
  v_estimated_pct numeric := null;

  v_months_remaining int := null;
  v_forecast_month date := null;

  v_risk_score numeric := 0;
  v_risk_level oracle.oracle_risk_level := 'green';
  v_monthly_velocity numeric := 0;

begin
  -- 1) Cohort info
  select s.first_clinic_year into v_cohort_year
  from public.students s
  where s.student_id = p_student_id;

  select c.clinical_start_date, c.graduation_deadline_date
    into v_start, v_deadline
  from oracle.cohort_calendar c
  where c.cohort_year = v_cohort_year;

  -- 2) Pending verification count 
  select count(*) into v_pending
  from public.treatment_records tr
  where tr.student_id = p_student_id
    and tr.status in ('pending verification','completed'); 

  -- 3) Inactive days: days since last update 
  select coalesce(
    greatest(0, (v_now::date - max(coalesce(tr.updated_at, tr.created_at))::date)),
    0
  ) into v_inactive_days
  from public.treatment_records tr
  where tr.student_id = p_student_id;

  -- 4) Verified velocity: total verified units over last 4/8 weeks 
  select
    coalesce(sum(case when tr.status = 'verified' and tr.verified_at >= (v_now - interval '4 weeks') then coalesce(tr.rsu_units, 0) else 0 end), 0),
    coalesce(sum(case when tr.status = 'verified' and tr.verified_at >= (v_now - interval '8 weeks') then coalesce(tr.rsu_units, 0) else 0 end), 0)
  into v_verified_4w, v_verified_8w
  from public.treatment_records tr
  where tr.student_id = p_student_id;

  -- 5) Overall completion pct 
  -- MVP approach: student verified totals vs required totals (RSU/CDA).
  with req as (
    select
      coalesce(sum(coalesce(r.minimum_rsu,0)),0) as req_rsu,
      coalesce(sum(coalesce(r.minimum_cda,0)),0) as req_cda
    from public.requirement_list r
  ),
  prog as (
    select
      coalesce(sum(case when tr.status='verified' then coalesce(tr.rsu_units,0) else 0 end),0) as ver_rsu,
      -- Note: using 'pending verification' properly
      coalesce(sum(case when tr.status in ('verified','pending verification','completed') then coalesce(tr.rsu_units,0) else 0 end),0) as est_rsu,
      coalesce(sum(case when tr.status='verified' then coalesce(tr.cda_units,0) else 0 end),0) as ver_cda,
      coalesce(sum(case when tr.status in ('verified','pending verification','completed') then coalesce(tr.cda_units,0) else 0 end),0) as est_cda
    from public.treatment_records tr
    where tr.student_id = p_student_id
  )
  select
    case when (req.req_rsu + req.req_cda) = 0 then null
         else (prog.ver_rsu + prog.ver_cda) / (req.req_rsu + req.req_cda) end,
    case when (req.req_rsu + req.req_cda) = 0 then null
         else (prog.est_rsu + prog.est_cda) / (req.req_rsu + req.req_cda) end
  into v_verified_pct, v_estimated_pct
  from req, prog;

  -- 6) Forecast months remaining
  -- Use 8w velocity (annualised avg) for stability; fall back to 4w if 8w is zero.
  -- v_monthly_velocity is declared at the top of the function
  v_monthly_velocity := greatest(v_verified_8w / 2.0, v_verified_4w, 0);

  if v_monthly_velocity > 0 and coalesce(v_verified_pct, 0) < 1 then
    v_months_remaining := ceil( ( (1 - coalesce(v_verified_pct,0)) * 100 ) / v_monthly_velocity );
    v_forecast_month := date_trunc('month', (v_now::date + (v_months_remaining || ' months')::interval))::date;
  end if;

  -- 7) Risk score rules (MVP)
  v_risk_score := 0;

  -- inactivity penalty
  if v_inactive_days >= 30 then v_risk_score := v_risk_score + 25; end if;
  if v_inactive_days >= 60 then v_risk_score := v_risk_score + 15; end if;

  -- backlog penalty
  if v_pending >= 10 then v_risk_score := v_risk_score + 15; end if;

  -- pace penalty
  if v_verified_8w <= 0 then v_risk_score := v_risk_score + 25; end if;

  -- deadline proximity
  if v_deadline is not null then
    if (v_deadline - v_now::date) <= 90 then v_risk_score := v_risk_score + 20; end if;
  end if;

  v_risk_score := least(100, greatest(0, v_risk_score));

  -- Map score to level
  if v_risk_score >= 75 then v_risk_level := 'red';
  elsif v_risk_score >= 50 then v_risk_level := 'orange';
  elsif v_risk_score >= 25 then v_risk_level := 'yellow';
  else v_risk_level := 'green';
  end if;

  -- 8) Upsert Snapshot 
  insert into oracle.student_progress_snapshots(
    student_id, cohort_year, snapshot_at,
    risk_level, risk_score,
    forecast_completion_month, forecast_months_remaining,
    verified_completion_pct, estimated_completion_pct,
    pending_verification_count, inactive_days,
    verified_velocity_4w, verified_velocity_8w
  )
  values (
    p_student_id, v_cohort_year, v_now,
    v_risk_level, v_risk_score,
    v_forecast_month, v_months_remaining,
    v_verified_pct, v_estimated_pct,
    v_pending, v_inactive_days,
    v_verified_4w, v_verified_8w
  )
  on conflict (student_id) do update set
    cohort_year = excluded.cohort_year,
    snapshot_at = excluded.snapshot_at,
    risk_level = excluded.risk_level,
    risk_score = excluded.risk_score,
    forecast_completion_month = excluded.forecast_completion_month,
    forecast_months_remaining = excluded.forecast_months_remaining,
    verified_completion_pct = excluded.verified_completion_pct,
    estimated_completion_pct = excluded.estimated_completion_pct,
    pending_verification_count = excluded.pending_verification_count,
    inactive_days = excluded.inactive_days,
    verified_velocity_4w = excluded.verified_velocity_4w,
    verified_velocity_8w = excluded.verified_velocity_8w;

  -- 9) Explanations Update
  delete from oracle.explanation_factors where student_id = p_student_id;

  if v_inactive_days >= 30 then
    insert into oracle.explanation_factors(student_id, snapshot_at, factor_code, factor_label, factor_value, severity, display_order)
    values (p_student_id, v_now, 'INACTIVE_30D', 'No recorded progress in the last 30 days', v_inactive_days, 4, 1);
  end if;

  if v_pending >= 10 then
    insert into oracle.explanation_factors(student_id, snapshot_at, factor_code, factor_label, factor_value, severity, display_order)
    values (p_student_id, v_now, 'PENDING_VERIFICATION_BACKLOG', 'High number of pending verifications', v_pending, 3, 2);
  end if;

  if v_verified_8w <= 0 then
    insert into oracle.explanation_factors(student_id, snapshot_at, factor_code, factor_label, factor_value, severity, display_order)
    values (p_student_id, v_now, 'LOW_VERIFIED_VELOCITY_8W', 'Low verified completion velocity in last 8 weeks', v_verified_8w, 5, 3);
  end if;

  -- 10) Recommendations Update
  delete from oracle.recommendations where student_id = p_student_id;

  if v_pending > 0 then
    insert into oracle.recommendations(student_id, snapshot_at, priority_rank, recommendation_type, message, reason_code)
    values (p_student_id, v_now, 1, 'CLEAR_PENDING_VERIFICATION',
            'Prioritize getting completed work verified to lock in progress.',
            'PENDING_VERIFICATION_BACKLOG');
  end if;

  if v_inactive_days >= 30 then
    insert into oracle.recommendations(student_id, snapshot_at, priority_rank, recommendation_type, message, reason_code)
    values (p_student_id, v_now, 2, 'RESUME_ACTIVITY',
            'Plan and start at least 1–2 cases this week to restore momentum.',
            'INACTIVE_30D');
  end if;

  return json_build_object(
    'student_id', p_student_id,
    'risk_level', v_risk_level,
    'risk_score', v_risk_score,
    'forecast_completion_month', v_forecast_month,
    'pending_verification_count', v_pending,
    'inactive_days', v_inactive_days
  );

end;
$$;

-- Make the RPC callable via REST
grant execute on function oracle.oracle_refresh_student(uuid) to anon, authenticated;
