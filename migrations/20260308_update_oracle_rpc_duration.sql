-- Migration: Update Oracle RPC for duration-based prediction
-- Date: 2026-03-08

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
  v_stagnant_patients int := 0;

  v_verified_4w numeric := 0;
  v_verified_8w numeric := 0;

  v_verified_pct numeric := null;
  v_estimated_pct numeric := null;
  v_req_total numeric := 0;
  v_ver_total numeric := 0;

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

  -- 4) Stagnant Patients count
  select count(*) into v_stagnant_patients
  from public.patients p
  where p.student_id_1 = p_student_id
    and p.is_completed_case = false
    and p.status not in ('Inactive', 'Discharged', 'Completed Case')
    and (
      (p.chart_full_at is null and (v_now::date - p.created_at::date) > 14) OR
      (p.tp_approved_at is null and p.chart_full_at is not null and (v_now::date - p.chart_full_at::date) > 30)
    );

  -- 5) Verified velocity: total verified duration over last 4/8 weeks 
  select
    coalesce(sum(case when tr.status = 'verified' and tr.verified_at >= (v_now - interval '4 weeks') then (coalesce(tr.rsu_units, 0) + coalesce(tr.cda_units, 0)) * coalesce(r.est_work_duration, 1.0) else 0 end), 0),
    coalesce(sum(case when tr.status = 'verified' and tr.verified_at >= (v_now - interval '8 weeks') then (coalesce(tr.rsu_units, 0) + coalesce(tr.cda_units, 0)) * coalesce(r.est_work_duration, 1.0) else 0 end), 0)
  into v_verified_4w, v_verified_8w
  from public.treatment_records tr
  left join public.requirement_list r on tr.requirement_id = r.requirement_id
  where tr.student_id = p_student_id;

  -- 6) Overall completion pct (Duration-weighted)
  with req as (
    select
      coalesce(sum((coalesce(r.minimum_rsu,0) + coalesce(r.minimum_cda,0)) * coalesce(r.est_work_duration, 1.0)),0) as req_total
    from public.requirement_list r
  ),
  prog as (
    select
      coalesce(sum(case when tr.status='verified' then (coalesce(tr.rsu_units,0) + coalesce(tr.cda_units,0)) * coalesce(r.est_work_duration, 1.0) else 0 end),0) as ver_total,
      coalesce(sum(case when tr.status in ('verified','pending verification','completed') then (coalesce(tr.rsu_units,0) + coalesce(tr.cda_units,0)) * coalesce(r.est_work_duration, 1.0) else 0 end),0) as est_total
    from public.treatment_records tr
    left join public.requirement_list r on tr.requirement_id = r.requirement_id
    where tr.student_id = p_student_id
  )
  select
    case when req.req_total = 0 then null else prog.ver_total / req.req_total end,
    case when req.req_total = 0 then null else prog.est_total / req.req_total end,
    req.req_total,
    prog.ver_total
  into v_verified_pct, v_estimated_pct, v_req_total, v_ver_total
  from req, prog;

  -- 7) Forecast
  v_monthly_velocity := greatest(v_verified_8w / 2.0, v_verified_4w, 0);

  if v_monthly_velocity > 0 and coalesce(v_req_total, 0) > coalesce(v_ver_total, 0) then
    v_months_remaining := ceil( (v_req_total - v_ver_total) / v_monthly_velocity );
    v_forecast_month := date_trunc('month', (v_now::date + (v_months_remaining || ' months')::interval))::date;
  end if;

  -- 8) Risk score rules
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
  
  -- Milestone Stagnation Penalty
  if v_stagnant_patients > 0 then
    v_risk_score := v_risk_score + (v_stagnant_patients * 10);
  end if;

  v_risk_score := least(100, greatest(0, v_risk_score));

  -- Map score to level
  if v_risk_score >= 75 then v_risk_level := 'red';
  elsif v_risk_score >= 50 then v_risk_level := 'orange';
  elsif v_risk_score >= 25 then v_risk_level := 'yellow';
  else v_risk_level := 'green';
  end if;

  -- 9) Upsert Snapshot 
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

  -- 10) Explanations Update
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

  if v_stagnant_patients > 0 then
    insert into oracle.explanation_factors(student_id, snapshot_at, factor_code, factor_label, factor_value, severity, display_order)
    values (p_student_id, v_now, 'PATIENT_STAGNATION', 'Delayed progress on ' || v_stagnant_patients || ' patient(s)', v_stagnant_patients, 3, 4);
  end if;

  -- 11) Recommendations Update
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
  
  if v_stagnant_patients > 0 then
    insert into oracle.recommendations(student_id, snapshot_at, priority_rank, recommendation_type, message, reason_code)
    values (p_student_id, v_now, 3, 'PROGRESS_STAGNANT_PATIENTS',
            'Review stagnant cases and finalize treatment plans to begin procedures.',
            'PATIENT_STAGNATION');
  end if;

  -- 12) Update the students table directly with the forecast date
  update public.students
  set
    forecast_completion_date = v_forecast_month,
    forecast_at = v_now
  where student_id = p_student_id;

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
