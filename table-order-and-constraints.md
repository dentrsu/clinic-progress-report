-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.type_of_case (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
type_of_case text NOT NULL UNIQUE,
created_at timestamp with time zone NOT NULL DEFAULT now(),
updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.divisions (
division_id uuid NOT NULL DEFAULT gen_random_uuid(),
code text NOT NULL UNIQUE,
name text NOT NULL,
have_non_main_patient_requirements boolean NOT NULL DEFAULT true,
CONSTRAINT divisions_pkey PRIMARY KEY (division_id)
);
create table public.floors (
floor_id uuid primary key default gen_random_uuid(),
label text not null unique
);
CREATE TABLE public.instructors (
instructor_id uuid NOT NULL DEFAULT gen_random_uuid(),
user_id uuid NOT NULL UNIQUE,
division_id uuid,
teamleader_role boolean NOT NULL DEFAULT false,
floor uuid,
bay text,
status USER-DEFINED NOT NULL DEFAULT 'active'::user_status,
created_at timestamp with time zone NOT NULL DEFAULT now(),
updated_at timestamp with time zone NOT NULL DEFAULT now(),
CONSTRAINT instructors_pkey PRIMARY KEY (instructor_id),
CONSTRAINT instructors_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id),
CONSTRAINT instructors_division_id_fkey FOREIGN KEY (division_id) REFERENCES public.divisions(division_id)
);
CREATE TABLE public.patient_milestones (
patient_id uuid NOT NULL,
milestone_type USER-DEFINED NOT NULL,
milestone_date date NOT NULL,
note text,
updated_by uuid,
updated_at timestamp with time zone NOT NULL DEFAULT now(),
CONSTRAINT patient_milestones_pkey PRIMARY KEY (patient_id, milestone_type),
CONSTRAINT patient_milestones_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(patient_id),
CONSTRAINT patient_milestones_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(user_id)
);
CREATE TABLE public.patients (
patient_id uuid NOT NULL DEFAULT gen_random_uuid(),
hn text NOT NULL UNIQUE,
name text NOT NULL,
birthdate date,
tel text,
status USER-DEFINED NOT NULL DEFAULT 'Waiting to Be Assigned'::patient_status,
is_completed_case boolean NOT NULL DEFAULT false,
complexity text,
type_of_case uuid references public.type_of_case(id),
note text,
instructor_id uuid references public.instructors(instructor_id),
student_id_1 uuid references public.students(student_id),
student_id_2 uuid references public.students(student_id),
student_id_3 uuid references public.students(student_id),
student_id_4 uuid references public.students(student_id),
student_id_5 uuid references public.students(student_id),
created_at timestamp with time zone NOT NULL DEFAULT now(),
updated_at timestamp with time zone NOT NULL DEFAULT now(),
CONSTRAINT patients_pkey PRIMARY KEY (patient_id)
);
CREATE TABLE public.requirement_list (
requirement_id uuid NOT NULL DEFAULT gen_random_uuid(),
division_id uuid NOT NULL,
requirement_type text NOT NULL,
minimum_rsu numeric,
minimum_cda numeric,
rsu_unit text DEFAULT 'Case',
cda_unit text DEFAULT 'Case',
non_mc_pateint_req boolean NOT NULL DEFAULT true,
CONSTRAINT requirement_list_pkey PRIMARY KEY (requirement_id),
CONSTRAINT requirement_list_division_id_fkey FOREIGN KEY (division_id) REFERENCES public.divisions(division_id)
);
CREATE TABLE public.students (
student_id uuid NOT NULL DEFAULT gen_random_uuid(),
user_id uuid NOT NULL UNIQUE,
first_clinic_year integer,
floor_id uuid,
division_id uuid,
unit_id text,
team_leader_1_id uuid,
team_leader_2_id uuid,
status USER-DEFINED NOT NULL DEFAULT 'active'::user_status,
created_at timestamp with time zone NOT NULL DEFAULT now(),
updated_at timestamp with time zone NOT NULL DEFAULT now(),
CONSTRAINT students_pkey PRIMARY KEY (student_id),
CONSTRAINT students_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id),
CONSTRAINT students_floor_id_fkey FOREIGN KEY (floor_id) REFERENCES public.floors(floor_id),
CONSTRAINT students_tl1_fkey FOREIGN KEY (team_leader_1_id) REFERENCES public.instructors(instructor_id),
CONSTRAINT students_tl2_fkey FOREIGN KEY (team_leader_2_id) REFERENCES public.instructors(instructor_id)
);
CREATE TABLE public.treatment_phases (
phase_id uuid NOT NULL DEFAULT gen_random_uuid(),
phase_order integer NOT NULL UNIQUE,
phase_name text NOT NULL UNIQUE,
created_at timestamp with time zone NOT NULL DEFAULT now(),
CONSTRAINT treatment_phases_pkey PRIMARY KEY (phase_id)
);
CREATE TABLE public.treatment_catalog (
treatment_id uuid NOT NULL DEFAULT gen_random_uuid(),
division_id uuid NOT NULL,
treatment_name text NOT NULL,
CONSTRAINT treatment_catalog_pkey PRIMARY KEY (treatment_id),
CONSTRAINT treatment_catalog_division_id_fkey FOREIGN KEY (division_id) REFERENCES public.divisions(division_id)
);
CREATE TABLE public.treatment_records (
record_id uuid NOT NULL DEFAULT gen_random_uuid(),
patient_id uuid NOT NULL,
student_id uuid,
division_id uuid NOT NULL,
phase_id uuid,
treatment_id uuid,
step_id uuid,
status USER-DEFINED NOT NULL DEFAULT 'planned'::record_status,
rsu_units numeric,
cda_units numeric,
severity numeric,
book_number numeric,
page_number numeric,
instructor_id uuid,
verified_at timestamp with time zone,
verified_by uuid,
is_exam boolean DEFAULT false,
created_at timestamp with time zone NOT NULL DEFAULT now(),
updated_at timestamp with time zone NOT NULL DEFAULT now(),
CONSTRAINT treatment_records_pkey PRIMARY KEY (record_id),
CONSTRAINT treatment_records_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(patient_id),
CONSTRAINT treatment_records_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id),
CONSTRAINT treatment_records_division_id_fkey FOREIGN KEY (division_id) REFERENCES public.divisions(division_id),
CONSTRAINT treatment_records_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES public.treatment_phases(phase_id),
CONSTRAINT treatment_records_treatment_id_fkey FOREIGN KEY (treatment_id) REFERENCES public.treatment_catalog(treatment_id),
CONSTRAINT treatment_records_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES public.instructors(instructor_id),
CONSTRAINT treatment_records_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(user_id),
CONSTRAINT fk_treatment_step_validation FOREIGN KEY (treatment_id) REFERENCES public.treatment_steps(step_id),
CONSTRAINT fk_treatment_step_validation FOREIGN KEY (step_id) REFERENCES public.treatment_steps(step_id),
CONSTRAINT fk_treatment_step_validation FOREIGN KEY (treatment_id) REFERENCES public.treatment_steps(treatment_id),
CONSTRAINT fk_treatment_step_validation FOREIGN KEY (step_id) REFERENCES public.treatment_steps(treatment_id)
);
CREATE TABLE public.treatment_steps (
step_id uuid NOT NULL DEFAULT gen_random_uuid(),
treatment_id uuid NOT NULL,
step_order integer NOT NULL,
step_name text NOT NULL,
CONSTRAINT treatment_steps_pkey PRIMARY KEY (step_id),
CONSTRAINT treatment_steps_treatment_id_fkey FOREIGN KEY (treatment_id) REFERENCES public.treatment_catalog(treatment_id)
);
CREATE TABLE public.users (
user_id uuid NOT NULL,
email text NOT NULL UNIQUE,
name text,
role USER-DEFINED NOT NULL,
status USER-DEFINED NOT NULL DEFAULT 'active'::user_status,
profile jsonb,
created_at timestamp with time zone NOT NULL DEFAULT now(),
updated_at timestamp with time zone NOT NULL DEFAULT now(),
CONSTRAINT users_pkey PRIMARY KEY (user_id),
CONSTRAINT users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
