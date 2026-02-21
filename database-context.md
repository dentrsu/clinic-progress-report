# 🏥 Clinic Progress Report: Database Context

This document serves as the "Source of Truth" for the database schema and business logic for the Clinic Progress Report web application built on **Supabase (PostgreSQL)**.

## 1. Core Architecture Overview

The system manages dental students, clinical instructors, and patient treatment progress. It uses a **Catalog-Execution** pattern:

- **Catalog:** Defines what treatments exist (`treatment_catalog`) and the mandatory steps for each (`treatment_steps`).
- **Execution:** Tracks the actual clinical work performed by students (`treatment_records`).

---

## 2. Entity Relationship Model (DDL)

```sql
-- EXTENSIONS
create extension if not exists "pgcrypto";

-- TYPES & ENUMS
-- user_role: student, instructor, admin
-- record_status: planned, in_progress, completed, verified, rejected, void
create type public.record_status as enum ('planned', 'in_progress', 'completed', 'verified', 'rejected', 'void');
-- treatment_phase_order: 1=Systemic, 2=Acute, 3=Disease Control, 4=Definitive, 5=Maintenance
-- patient_status: active, inactive, archived
create type public.patient_status as enum (
  'Waiting to Be Assigned',
  'Full Chart',
  'Treatment Plan',
  'First Treatment Plan',
  'Treatment Plan Approved',
  'Initial Treatment',
  'Inactive',
  'Discharged',
  'Orthodontic Treatment',
  'Waiting in Recall Lists'
);


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
  first_clinic_year int,
  floor_id uuid references public.floors(floor_id),
  unit_id text,
  team_leader_1_id uuid references public.instructors(instructor_id),
  team_leader_2_id uuid references public.instructors(instructor_id),
  status public.user_status not null default 'active'
);


-- 1.1 Divisions
create type public.clinic_type as enum ('main', 'rotate', 'N/A');

create table public.divisions (
  division_id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  clinic public.clinic_type not null default 'N/A',
  have_non_main_patient_requirements boolean not null default true
);

create table public.instructors (
  instructor_id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(user_id) on delete cascade,
  division_id uuid references public.divisions(division_id)
);

-- 2. Treatment Phases (lookup / ordering)
create table public.treatment_phases (
  phase_id uuid primary key default gen_random_uuid(),
  phase_order integer not null unique,   -- 1–5 ascending
  phase_name text not null unique
);

-- 3. Clinical Catalog
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


-- 3.5 Requirement List (Missing from previous context)
create table public.requirement_list (
  requirement_id uuid primary key default gen_random_uuid(),
  division_id uuid not null references public.divisions(division_id),
  requirement_type text not null,
  minimum_rsu numeric not null default 0,
  minimum_cda numeric not null default 0,
  rsu_unit text, -- e.g. 'Case', 'Visit'
  cda_unit text,
  is_patient_treatment boolean not null default true,
  non_mc_pateint_req boolean not null default true
);

-- 3.6 Patients
-- create table public.patients (
--   patient_id uuid primary key default gen_random_uuid(),
--   hn text not null unique,
--   name text not null,
--   status public.patient_status not null default 'Waiting to Be Assigned',
--   is_completed_case boolean not null default false,
  complexity text,
  type_of_case uuid references public.type_of_case(id),
--   ...
-- );

-- 3.7 Case Types
create table public.type_of_case (
  id uuid primary key default gen_random_uuid(),
  type_of_case text not null unique,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 4. Execution (The Workhorse)
create table public.treatment_records (
  record_id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(patient_id), -- Nullable for Rotate Clinic
  hn text,                                          -- For ad-hoc/rotate patients
  patient_name text,                                -- For ad-hoc/rotate patients
  student_id uuid references public.students(student_id),
  phase_id uuid references public.treatment_phases(phase_id), -- Treatment phase for ordering
  treatment_id uuid references public.treatment_catalog(treatment_id),
  step_id uuid,
  status public.record_status not null default 'planned',
  rsu_units numeric,
  cda_units numeric,
  severity numeric,                                  -- PERIO division
  book_number numeric,                               -- OPER division
  page_number numeric,                               -- OPER division
  requirement_id uuid references public.requirement_list(requirement_id), -- Linked requirement
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

- **Composite Validation:** A `treatment_record` cannot have a `step_id` that belongs to a different `treatment_id`. This is enforced at the DB level via `fk_treatment_step_validation`.
- **Treatment Phase Ordering:** Every treatment record can be assigned a `phase_id` from `treatment_phases`. Phases are sorted by `phase_order` (1 = Systemic → 5 = Maintenance) to define the treatment plan sequence.
- **User Provisioning:** The `public.users` table is automatically populated via a database trigger (`handle_new_user`) when a user signs up through Supabase Auth.

### B. Security & Access Control (RLS)

- **Students:** Can `SELECT` and `INSERT` their own `treatment_records`. They cannot update the `verified_by` or `verified_at` fields.
- **Instructors:** Can `SELECT` all records within their division. They are the only ones allowed to `UPDATE` a record status to `verified`.
- **Patients:** Patient data is visible to all authenticated clinical staff/students but is strictly read-only for students unless they are part of the Care Team. Students can toggle the `is_completed_case` status for their assigned patients.

### C. Workflow State Machine

1. **Planned:** Student adds a treatment to a patient's chart.
2. **In Progress:** Student begins clinical work on a specific step.
3. **Completed:** Student finishes the work and requests verification. Recorded in the **Requirement Vault** as "Pending Verification" progress.
4. **Verified:** Instructor reviews work and "signs off". The status changes to "Verified" in the **Requirement Vault**, contributing to the final graduation progress.

### D. Auto-Calculation Logic (PERIO)

For the Periodontics (PERIO) division, `rsu_units` and `cda_units` are automatically calculated based on the selected Requirement, Treatment Step, and Severity:

- **RSU Units**:
  - `Case G` (Step Order >= 7): `Severity / 0.8`
  - `Case P` (Step Order >= 7): `Severity / 0.5`
  - Exams (`SRP 1st Exam`, `OHI 1st Exam`, `OHI 2nd Exam`): `1.0`
  - Others: `0.0`

- **CDA Units**:
  - `Case G`: `1.0`
  - `Case P`: `1.0`
  - `SRP 2nd Exam`: `1.0`
  - Others: `0.0`

### E. Phase Sorting & Smart Reorder

To maintain clinical integrity, treatment records are strictly validated and sorted:

1.  **Strict Phase Sorting:** The list of treatment records is always sorted primarily by `phase_order` (from the `treatment_phases` table), then by the user-defined `treatment_order`. This prevents "Phase Splitting" (e.g., a Phase 1 record appearing between two Phase 3 records).
2.  **Smart Reorder:**
    - If a user manually reorders a record into a position occupied by a different Phase group, the system **automatically updates the record's Phase** to match the new group.
    - Example: Moving a "Systemic" record into the middle of "Disease Control" records will convert it to "Disease Control".
3.  **Contextual Insert:**
    - When inserting a new record via the "Insert" button on an existing row, the new record is **locked** to that row's Phase and inserted immediately after it. The Order field is also locked to prevent accidental displacement.

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
