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
-- record_status: planned, in_progress, completed, pending verification, verified, rejected, void
create type public.record_status as enum ('planned', 'in_progress', 'completed', 'pending verification', 'verified', 'rejected', 'void');
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
  oper_instructor_id uuid references public.instructors(instructor_id),
  endo_instructor_id uuid references public.instructors(instructor_id),
  perio_instructor_id uuid references public.instructors(instructor_id),
  prosth_instructor_id uuid references public.instructors(instructor_id),
  diag_instructor_id uuid references public.instructors(instructor_id),
  radio_instructor_id uuid references public.instructors(instructor_id),
  sur_instructor_id uuid references public.instructors(instructor_id),
  ortho_instructor_id uuid references public.instructors(instructor_id),
  pedo_instructor_id uuid references public.instructors(instructor_id),
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


-- 3.5 Requirement List
create table public.requirement_list (
  requirement_id uuid primary key default gen_random_uuid(),
  division_id uuid not null references public.divisions(division_id),
  requirement_type text not null,        -- RSU-side label (always set)
  minimum_rsu numeric not null default 0,
  cda_requirement_type text,             -- CDA-side label (nullable; used when minimum_cda > 0)
  minimum_cda numeric not null default 0,
  rsu_unit text,                         -- e.g. 'Case', 'Visit'
  cda_unit text,
  is_patient_treatment boolean not null default true,
  non_mc_pateint_req boolean not null default true,  -- NOTE: typo in column name (pateint)
  is_exam boolean not null default false,            -- True: count exam records (not sum units)
  is_selectable boolean not null default true,       -- False: hide from treatment_plan.html dropdown
  aggregation_config jsonb default null              -- Computation config (see rules below)
);

-- Key rules for requirement_list:
--   • minimum_rsu > 0  → appears in RSU section of vault (label = requirement_type)
--   • minimum_cda > 0  → appears in CDA section of vault (label = cda_requirement_type)
--   • A single row can appear in BOTH sections if both minimums are non-zero
--   • minimum_rsu = 0 AND minimum_cda = 0  → hidden from treatment_plan.html modal dropdown
--   • is_selectable = false → hidden from dropdown (computed/derived requirements)
--   • is_exam = true  → vault counts verified exam records, not sum of rsu_units/cda_units
--
-- aggregation_config shapes (JSON):
--
--   PASS 1 types (sum/count/count_union/count_exam):
--
--   null / omitted
--       → "sum" default: sum rsu_units / cda_units from directly linked records
--   {"type":"sum"}
--       → same as null
--   {"type":"count"}
--       → count records linked to this requirement (not sum units)
--   {"type":"count_union","also_count":["uuid1","uuid2"]}
--       → count records linked to this req PLUS records linked to also_count req IDs
--       → used to merge alias requirements into a parent (e.g. Diastema Closure → Class IV)
--   {"type":"count_exam"}
--       → count is_exam=true records in this division
--   {"type":"count_exam","source_ids":["uuid…"]}
--       → scoped to specific source requirements
--
--   PASS 2 types (run after pass 1; read pass-1 progressMap values):
--
--   {"type":"derived","source_ids":["uuid1","uuid2"],"operation":"sum_both"}
--       operation: "sum_both" (default) | "sum_rsu" | "sum_cda"
--       → aggregates computed values from other requirements already processed in pass 1
--   {"type":"count_met","source_ids":["uuid1","uuid2",...]}
--       → counts how many source requirements have pass-1 verified progress >= their minimum
--       → each qualifying source contributes 1 to this requirement's progress
--       → used for "Recall (any)" style requirements (is_selectable=false)
--       → p_rsu/p_cda intentionally left 0 (verified-only metric)
--
--   NOTE: complex cross-requirement overflow (e.g. OPER) is handled by
--   DIVISION_PROCESSORS['OPER'] in Code.gs, which runs after both passes.

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
  is_exam boolean default false,                  -- Flag for Exam cases
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
3. **Completed:** Student finishes the work. The status changes to "Completed".
4. **Pending Verification:** Student requests email verification. The status changes to "Pending Verification". This still counts toward "Estimated" progress in the Requirement Vault.
5. **Verified:** Instructor reviews work and "signs off". The status changes to "Verified" in the Requirement Vault, contributing to the final graduation progress.
6. **Rejected:** Instructor rejects the work. Student can edit and re-request verification. Also counts toward "Estimated" progress.

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

### F. Requirement Vault Logic (RSU vs CDA)

A single `requirement_list` row can generate **two separate entries** in the vault:

| condition         | appears in                 | label field             |
| ----------------- | -------------------------- | ----------------------- |
| `minimum_rsu > 0` | RSU section                | `requirement_type`      |
| `minimum_cda > 0` | CDA section                | `cda_requirement_type`  |
| both > 0          | both sections              | respective fields above |
| both = 0          | hidden from modal dropdown | —                       |

**treatment_plan.html modal** filters the requirement dropdown to only show rows where `minimum_rsu > 0 OR minimum_cda > 0`. Each option shows `[RSU]`, `[CDA]`, or `[RSU+CDA]` badge so students know what they are submitting.

**requirement_vault.html** shows ALL requirements for the student's divisions (even with zero progress), using a LEFT JOIN approach in `getStudentVaultData`. Each division also returns:

- `rsu_completion_pct` — average of `min(current/minimum, 1)` across all RSU requirements (0–100)
- `cda_completion_pct` — same for CDA requirements

These percentages power the **radar chart** at the top of the vault page (Chart.js), which shows per-division progression for both RSU and CDA tracks.

**Exam-type requirements** (`is_exam = true`): progress is tracked by **counting** verified exam records in that division, not by summing `rsu_units`/`cda_units`.

**Expanded record lists** — each requirement in the vault output carries two separate arrays:

- `rsu_records` — records that count toward RSU progress (own records + transferred-in from other requirements)
- `cda_records` — same for CDA progress (may differ from `rsu_records` when RSU/CDA transfer rules differ)

Records carry transfer metadata for badge display:

- `transferred_from` (string) — set on records that arrived **from** another requirement. Displayed as a violet **"← Class II"** badge with a violet-tinted row.
- `transferred_to` (string) — set on records that were **counted for** another requirement but still shown in the source's list. Displayed as a teal **"→ Class I"** badge with a teal-tinted row.

The `listVaultRecordsByStudent` query includes `record_id` so records can be matched precisely during transfer tracking.

### G. Operative (OPER) Division — Vault Aggregation Override Rules

OPER uses cross-requirement overflow and substitution logic that cannot be expressed in `aggregation_config` alone. It is implemented in `DIVISION_PROCESSORS['OPER']` in `Code.gs`, which runs after both aggregation passes.

**Required `aggregation_config` on OPER `requirement_list` rows:**

| requirement_type | aggregation_config                                                             | Notes                                                         |
| ---------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Class I          | `null` (sum)                                                                   | Receives transfer from Class II and PRR bonus                 |
| Class II         | `null` (sum)                                                                   | Source for transfer to Class I (RSU) and Class I/III-IV (CDA) |
| Class III        | `null` (sum)                                                                   | Receives transfer from Class IV                               |
| Class IV         | `{"type":"sum_union","also_sum":["<DIASTEMA_UUID>"]}`                          | Sums rsu_units from Class IV + Diastema Closure records       |
| Class V          | `null` (sum)                                                                   | Standard                                                      |
| Class VI         | `null` (sum)                                                                   | Standard                                                      |
| PRR              | `null` (sum)                                                                   | Bonus source for Class I RSU (max 1 record)                   |
| Diastema Closure | `null` + `minimum_rsu=0`, `minimum_cda=0`                                      | Selectable but has no vault row; absorbed by Class IV         |
| Recall (any)     | `{"type":"count_met","source_ids":["<I>","<II>","<III>","<IV>","<V>","<VI>"]}` | `is_selectable=false`; computed in pass-2 from raw counts     |

**Transfer algorithm (`greedyTransfer` helper):**

The OPER processor uses a shared `greedyTransfer(records, unitField, minKeep)` function:

1. Compute `total` = sum of `unitField` (e.g. `rsu_units`) across all verified records
2. If `total <= minKeep` → no transfer (return empty)
3. Sort records **ascending** by `unitField` value (smallest first, maximises transfer count)
4. Greedily remove records one by one while `remaining >= minKeep`
5. Return the removed records

**Transfer rules applied by `DIVISION_PROCESSORS['OPER']` (RSU, in order):**

All rules use **SUM-based semantics**: the source's `rsu_units` sum determines excess. Each transferred record adds exactly **1** to the target requirement's progress. The source's progress decreases by the actual `rsu_units` sum of the removed records.

Example: Class II records [2,2,3,3] = 10 total, minimum = 6 →

- Sort ascending: [2,2,3,3]; greedily remove rec(2), rec(2) → remaining 6 ≥ 6 ✓
- Class II: 10 − 4 = **6**; Class I: 0 + 2 = **2** (1 per transferred record)

1. **Class II → Class I (RSU)**: `greedyTransfer(Class II verified, 'rsu_units', minimum_rsu)`. Source loses actual units; target gains 1 per record. Records show `→ Class I` badge at source, `← Class II` badge at target.
2. **Class IV → Class III (RSU)**: Same logic. Class IV pool includes Diastema Closure records (via `sum_union`). Records show `→ Class III` / `← Class IV` or `← Diastema Closure` badges.
3. **PRR → Class I (RSU, max 1)**: If Class I is still below `minimum_rsu` after rule 1, transfer exactly 1 PRR record (last verified). Class I gains 1; PRR loses the record's `rsu_units`. Badges: `→ Class I` / `← PRR`.

**Transfer rules applied by `DIVISION_PROCESSORS['OPER']` (CDA):**

4. **Class II → Class I/III-IV (CDA)**: `greedyTransfer(Class II verified, 'cda_units', minimum_cda)`. Excess records fill Class I's CDA deficit first (1 per record), remainder goes to Class III or IV CDA. Class II CDA decreases by actual `cda_units` sum.

**Recall computation:** Handled by `count_met` in pass-2 using **raw (pre-transfer) counts**. The OPER processor does NOT modify Recall.

**Internal progressMap transfer fields** (set by OPER processor, consumed by output builder):

- `transferred_in_rsu` / `transferred_in_cda` — array of detail-record objects (with `transferred_from` label) appended to target's record list
- `transferred_out_ids_rsu` / `transferred_out_ids_cda` — array of `{ record_id, to_label }` objects; source records are kept in the list but stamped with `transferred_to` for display

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
