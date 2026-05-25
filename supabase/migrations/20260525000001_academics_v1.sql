-- ─────────────────────────────────────────────────────────────────────────────
-- Academics V1 — Data-Driven Instruction (DDI) foundation
-- ─────────────────────────────────────────────────────────────────────────────
-- Replaces the spreadsheet "data binder" workflow used in weekly grade-team
-- meetings. Five tables, no standards taxonomy yet (topic is freetext for V1),
-- no RLS yet (V1 pilot is small; lock down before opening to more teams).
--
-- Tables:
--   assessment_events       — "Week 6 Exit Ticket — Main Idea" (one row)
--   academic_scores         — one row per student per assessment
--   data_meetings           — Tuesday meeting capture
--   action_plans            — reteach plans created in a meeting
--   action_plan_students    — many-to-many: plan ↔ targeted students
-- ─────────────────────────────────────────────────────────────────────────────

-- ── ASSESSMENT EVENTS ────────────────────────────────────────────────────────
create table if not exists assessment_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,                          -- 'Week 6 Exit Ticket — Main Idea'
  subject text not null,                        -- 'math' | 'reading' | 'writing' | 'science' | 'social_studies'
  grade_level text not null,                    -- 'K' | '1' | '2' | etc
  topic text,                                   -- freetext for V1 ('Main Idea', 'Multiplication Facts')
  administered_date date not null,
  max_score numeric not null default 100,
  proficiency_thresholds jsonb not null default
    '{"red": 60, "yellow": 80}'::jsonb,         -- <red = red, <yellow = yellow, else green
  created_by text not null,
  school_year text not null,
  school_id text,
  created_at timestamptz not null default now()
);
create index if not exists ae_grade_subject_date
  on assessment_events(grade_level, subject, administered_date desc);
create index if not exists ae_recent
  on assessment_events(administered_date desc);

comment on table assessment_events is
  'Replaces the "column" in a data-binder spreadsheet — one row per assessment.';
comment on column assessment_events.proficiency_thresholds is
  'JSON: {"red": <pct>, "yellow": <pct>}. Below red = red, below yellow = yellow, else green.';


-- ── ACADEMIC SCORES ──────────────────────────────────────────────────────────
create table if not exists academic_scores (
  id bigserial primary key,
  clever_id text not null,                      -- FK target: students.clever_id (add when ready)
  assessment_event_id uuid not null
    references assessment_events(id) on delete cascade,
  score numeric,                                -- null = absent / not assessed
  proficiency text,                             -- 'red' | 'yellow' | 'green' (computed at write)
  homeroom text,                                -- denormalized for fast cross-domain queries
  recorded_by text not null,
  recorded_at timestamptz not null default now(),
  notes text,
  unique (clever_id, assessment_event_id)
);
create index if not exists as_event on academic_scores(assessment_event_id);
create index if not exists as_student on academic_scores(clever_id);
create index if not exists as_homeroom_date on academic_scores(homeroom, recorded_at desc);

comment on table academic_scores is
  'Replaces a "cell" in a data-binder spreadsheet — one row per student per assessment.';


-- ── DATA MEETINGS ────────────────────────────────────────────────────────────
create table if not exists data_meetings (
  id uuid primary key default gen_random_uuid(),
  grade_level text not null,
  subject text not null,
  meeting_date date not null,
  facilitator_email text,
  attendees text[],                             -- list of staff emails
  agenda_notes text,
  school_year text not null,
  school_id text,
  created_at timestamptz not null default now()
);
create index if not exists dm_grade_subject_date
  on data_meetings(grade_level, subject, meeting_date desc);

comment on table data_meetings is
  'The Tuesday DDI meeting itself — what got discussed, by whom, when.';


-- ── ACTION PLANS (the closed-loop magic) ─────────────────────────────────────
create table if not exists action_plans (
  id uuid primary key default gen_random_uuid(),
  data_meeting_id uuid references data_meetings(id) on delete set null,
  topic text not null,                          -- what's being retaught
  source_assessment_event_id uuid
    references assessment_events(id) on delete set null,  -- the bad result that prompted this
  reteach_strategy text,                        -- 'small_group' | '1_on_1' | 'whole_class' | 'station' | 'parent_followup'
  description text,
  owner_email text not null,                    -- who's doing the reteach
  target_check_date date,                       -- when we'll re-assess
  follow_up_event_id uuid
    references assessment_events(id) on delete set null,  -- the re-assessment (auto-linked)
  outcome_avg_delta numeric,                    -- avg score improvement on target students (auto-computed)
  status text not null default 'active',        -- 'active' | 'complete' | 'partial' | 'discontinued'
  outcome_notes text,
  school_year text not null,
  created_at timestamptz not null default now()
);
create index if not exists ap_owner_active
  on action_plans(owner_email) where status = 'active';
create index if not exists ap_meeting on action_plans(data_meeting_id);

comment on table action_plans is
  'Closed-loop reteach plans. follow_up_event_id + outcome_avg_delta are populated automatically when a re-assessment matches.';


-- ── ACTION PLAN STUDENTS (many-to-many) ──────────────────────────────────────
create table if not exists action_plan_students (
  action_plan_id uuid not null
    references action_plans(id) on delete cascade,
  clever_id text not null,
  primary key (action_plan_id, clever_id)
);
create index if not exists aps_student on action_plan_students(clever_id);


-- ── CONVENIENCE VIEW: latest score per student per assessment ────────────────
-- (Useful for the data binder grid query — though we'll likely query directly.)
create or replace view v_student_assessment_grid as
  select
    s.clever_id,
    s.homeroom,
    e.id           as assessment_event_id,
    e.title,
    e.subject,
    e.grade_level,
    e.topic,
    e.administered_date,
    e.max_score,
    e.proficiency_thresholds,
    s.score,
    s.proficiency,
    s.recorded_at
  from academic_scores s
  join assessment_events e on e.id = s.assessment_event_id;

comment on view v_student_assessment_grid is
  'Flat join for binder rendering: one row per (student, assessment) cell.';


-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE on RLS: deliberately not enabled in V1. Pilot is a single small grade
-- team; everyone has implicit access. Before opening this to other teachers /
-- other schools, enable RLS on all five tables and gate by staff_scopes (see
-- the schema sketch in PR thread).
-- ─────────────────────────────────────────────────────────────────────────────
