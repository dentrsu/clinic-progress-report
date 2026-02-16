# 🏥 Clinic Progress Report: Database Context

This document serves as the "Source of Truth" for the database schema and business logic for the Clinic Progress Report web application built on **Supabase (PostgreSQL)**.

## 1. Core Architecture Overview

The system manages dental students, clinical instructors, and patient treatment progress. It uses a **Catalog-Execution** pattern:

* **Catalog:** Defines what treatments exist (`treatment_catalog`) and the mandatory steps for each (`treatment_steps`).
* **Execution:** Tracks the actual clinical work performed by students (`treatment_records`).

---

## 2. Entity Relationship Model (DDL)

```sql
-- EXTENSIONS
create extension if not exists "pgcrypto";

-- TYPES & ENUMS
-- user_role: student, instructor, admin
-- record_status: planned, in_progress, completed, verified, rejected, void

-- TABLES

-- 1. Profiles & Auth Link
-- public.users links to auth.users (Supabase Auth)
create table public.users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text,
  role public.user_role not null,
  status public.user_status not null default 'active'
);

create table public.students (
  student_id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(user_id) on delete cascade,
  first_clinic_year int
);

create table public.instructors (
  instructor_id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(user_id) on delete cascade,
  division_id uuid references public.divisions(division_id)
);

-- 2. Clinical Catalog
create table public.treatment_catalog (
  treatment_id uuid primary key default gen_random_uuid(),
  division_id uuid not null references public.divisions(division_id),
  treatment_name text not null
);

create table public.treatment_steps (
  step_id uuid primary key default gen_random_uuid(),
  treatment_id uuid not null references public.treatment_catalog(treatment_id),
  step_order int not null,
  step_name text not null,
  unique (treatment_id, step_id) -- Required for composite FK validation
);

-- 3. Execution (The Workhorse)
create table public.treatment_records (
  record_id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(patient_id),
  student_id uuid references public.students(student_id),
  treatment_id uuid references public.treatment_catalog(treatment_id),
  step_id uuid,
  status public.record_status not null default 'planned',
  rsu_units numeric,
  verified_by uuid references public.users(user_id), -- The Instructor's user_id
  
  -- Validation: Step MUST belong to the Treatment
  constraint fk_treatment_step_validation 
    foreign key (treatment_id, step_id) 
    references public.treatment_steps(treatment_id, step_id)
);

```

---

## 3. Business Logic & Constraints

### A. Data Integrity

* **Composite Validation:** A `treatment_record` cannot have a `step_id` that belongs to a different `treatment_id`. This is enforced at the DB level via `fk_treatment_step_validation`.
* **User Provisioning:** The `public.users` table is automatically populated via a database trigger (`handle_new_user`) when a user signs up through Supabase Auth.

### B. Security & Access Control (RLS)

* **Students:** Can `SELECT` and `INSERT` their own `treatment_records`. They cannot update the `verified_by` or `verified_at` fields.
* **Instructors:** Can `SELECT` all records within their division. They are the only ones allowed to `UPDATE` a record status to `verified`.
* **Patients:** Patient data is visible to all authenticated clinical staff/students but is strictly read-only for students unless they are part of the Care Team.

### C. Workflow State Machine

1. **Planned:** Student adds a treatment to a patient's chart.
2. **In Progress:** Student begins clinical work on a specific step.
3. **Completed:** Student finishes the work and requests verification.
4. **Verified:** Instructor reviews work and "signs off" (triggers RSU unit credit).

---

## 4. Key Developer Queries (Reference)

### Fetching a Student's Progress

```sql
select 
  tc.treatment_name, 
  ts.step_name, 
  tr.status
from public.treatment_records tr
join public.treatment_catalog tc using (treatment_id)
left join public.treatment_steps ts using (step_id)
where tr.student_id = 'STUDENT_UUID';

```

### Verifying a Record (Instructor Action)

```sql
update public.treatment_records
set status = 'verified', 
    verified_by = auth.uid(), 
    verified_at = now()
where record_id = 'RECORD_UUID';

```

---