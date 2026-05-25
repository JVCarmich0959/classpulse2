# ClassPulse — Setup & Onboarding Guide

A self-contained guide for deploying ClassPulse at a new charter or school. If you've never set this up before, this should be everything you need.

---

## What you're deploying

ClassPulse is a behavior-tracking + Data-Driven Instruction (DDI) platform for K-5 schools. It replaces the printed/spreadsheet "data binder" that DDI schools bring to weekly grade-team meetings, and it sits on top of your existing SIS rather than replacing it.

**The product has two surfaces**:

1. **Behavior tracking** — daily incident logging, color-chart escalations, alerts, weekly trends
2. **Academics / DDI workflow** — score entry, data binder grid, Tuesday meeting mode, action plans with auto-tracked outcomes, coach/dean dashboard

**Who uses what**:
- *Teachers* → log incidents · quick colors · enter scores · run Tuesday meetings · create + track action plans
- *Instructional coaches & deans* → coach dashboard for school-wide academic health and reteach impact by teacher
- *Admins* → all of the above plus accommodation editing and admin notes

---

## Prerequisites

- A **Supabase project** (free tier is fine for a single school pilot — 500MB DB, 1GB storage, unlimited API calls)
- A **GitHub account** to fork/clone the repo
- A **Netlify account** (free tier) for hosting the SPA
- A **Clever account** (or another rostering source) — students need a stable `clever_id` for the academic data to join cleanly. If you don't use Clever, see the *No Clever?* section below.

Optional:
- A custom domain for the deployed app
- A nightly job runner (cron, GitHub Actions, etc.) if you eventually want server-side outcome computation

---

## Setup, step by step

### 1. Fork & clone

```bash
git clone https://github.com/JVCarmich0959/classpulse2.git
cd classpulse2
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Name it (e.g., `classpulse-<schoolname>`)
3. Pick the region closest to your school
4. Set a strong DB password (you'll need it once; the app uses anon/auth keys)
5. Wait ~2 minutes for provisioning

Once it's up, copy two values from **Settings → API**:
- `Project URL` (looks like `https://abcdefgh.supabase.co`)
- `anon public` key (a long JWT)

### 3. Configure environment

Create a `.env` file at the repo root:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-long-anon-jwt-here
VITE_SCHOOL_YEAR=2025-26
```

The school year is used as a filter across all data — change it at the start of each new year.

### 4. Apply database migrations

The schema lives in `supabase/migrations/`. Two ways to apply it:

**Option A: Supabase CLI** (if you have it installed):
```bash
supabase link --project-ref your-project-ref
supabase db push
```

**Option B: Manual** (simpler for first-time setup):
1. Open your Supabase dashboard → SQL Editor
2. Open each file in `supabase/migrations/` in order (filenames are timestamp-prefixed)
3. Paste the contents and click "Run"

Repeat for every migration file in the folder. Order matters.

### 5. Set up authentication

In your Supabase dashboard → Authentication → Providers:
- **Enable Email** (with "Confirm email" turned off for pilot simplicity, or on if you prefer)
- **Disable all other providers** unless you have a specific need

In Authentication → URL Configuration:
- Add your Netlify URL (or `localhost:5173` for local dev) as a redirect URL

### 6. Seed initial roster + staff

You need at least:
- One **admin user**: an entry in `auth.users` (created when you sign up via the app) + a row in `public.profiles` with `role='admin'`
- A **student roster**: rows in `public.students` with `clever_id`, `student_name`, `homeroom`, `grade`, `active=true`, `school_year`

**Two ways to import students**:

**Manual / CSV**: From your SIS (Infinite Campus, PowerSchool, etc.), export a roster CSV with columns:
```
clever_id, student_name, first_name, last_name, homeroom, grade, active, school_year
```
Then in Supabase → Table Editor → `students` → Import from CSV.

**Via Clever Sync**: If you use Clever, set up Clever's Secure Sync to push rosters into Supabase. The integration is one-time setup and updates nightly; covers the per-student demographic fields used by the academic features.

**Staff/teachers**: Once the app is deployed, sign up each teacher via the login screen using their school email. After they create an account, manually update their `public.profiles.role` to `'specials'` or `'homeroom'` as appropriate.

### 7. Deploy to Netlify

Push your fork to GitHub, then:

1. Netlify → "Add new site" → "Import from Git"
2. Select your repo
3. Build settings:
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
4. Add environment variables (Site settings → Environment variables):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_SCHOOL_YEAR`
5. Deploy

Your URL will be something like `https://your-site-name.netlify.app`. Custom domain optional.

### 8. Test the deployment

Sign in with your admin account. You should see:
- Dashboard with Overview / Scholars / Classes / etc. tabs
- An Academics tab with launchers for Score Entry, Data Binder, Tuesday Meeting, Action Plans, Coach Dashboard

If any tab is empty or errors, check:
- Are migrations all applied? (`SELECT tablename FROM pg_tables WHERE schemaname = 'public'` should show ~20 tables)
- Is your `students` table populated?
- Is RLS preventing reads? (Authenticated users should be able to read everything per the V1 policies)

---

## First week of pilot use

The recommended onboarding path for a pilot grade team:

**Day 1 (Monday, 30 min)**: One grade-team lead + the instructional coach walk through the app together. Focus on Score Entry and the Data Binder.

**Days 2-4**: Teachers enter their exit ticket / quiz scores in Score Entry. The lead checks the binder each evening to see what's accumulating.

**Tuesday (the meeting)**: Instead of bringing printed binders, the team gathers around a laptop or projector and opens **Tuesday Meeting** mode. The bottom-5 auto-flag and the per-assessment grid are right there. Create action plans live during the meeting.

**Friday**: Give the follow-up assessment. Enter scores in Score Entry. When the last score for any plan's target students saves, watch the toast fire: *"Plan 'Main Idea' auto-completed (+18 pts)"*. That's the moment teachers realize this isn't just a fancier spreadsheet.

**Week 2 Tuesday meeting**: Open Coach Dashboard to see the school-wide picture and the per-teacher reteach impact.

---

## No Clever? Other rostering sources

ClassPulse uses `clever_id` as the canonical student key for academic data, but the column is just text — you can use any stable per-student identifier:

- **ClassLink**: use ClassLink's per-student identifier in place of `clever_id`
- **Manual import**: generate UUIDs and store them in the `clever_id` column
- **State-issued IDs**: most state-hosted SIS instances assign per-student state IDs that work fine

The field name `clever_id` is historical; a future migration could rename it to `source_system_id`. Doesn't block setup.

---

## Infinite Campus integration

If your school uses Infinite Campus:

- **Multi-tenant state-hosted IC**: don't try to pull attendance via API for V1. Use the built-in IC reporting module to generate weekly CSV exports and import via the Supabase dashboard. Real integration requires state DOE vendor approval (6-18 months) — not blocking for pilot.
- **District-hosted IC**: your IT director can provision API credentials or set up nightly SFTP exports to a folder ClassPulse polls.

For the pilot, ClassPulse is the **system of entry** for academic data and behavior. IC remains the **system of record** for attendance, final grades, transcripts, and state reporting. No conflict.

---

## Security checklist before going past pilot

ClassPulse's current V1 RLS policies are "any authenticated user can read/write everything." That's appropriate for a single pilot grade team where everyone is trusted, but **not appropriate** when you open it to a second team or another school. Before that happens:

- [ ] Enable per-role RLS policies on all behavior + academic tables (specials teachers see only their scheduled classes, classroom teachers see only their roster, etc.)
- [ ] Audit who has `role='admin'` in `public.profiles` — revoke any test accounts
- [ ] Rotate the Supabase anon key if it's been shared widely
- [ ] Enable Supabase's audit logging
- [ ] Review FERPA implications with your school's compliance officer if you're storing real assessment scores

---

## Architecture quick reference

```
┌─────────────────────────────────────────────────┐
│  Browser (Vite-built SPA)                       │
│  - Vanilla JS (no React)                        │
│  - Modular views in src/views/admin/            │
│  - API helpers in src/api/                      │
│  - Supabase JS client + custom realtime channel │
└───────────────────────────┬─────────────────────┘
                            │ HTTPS (REST + Realtime)
                            ▼
┌─────────────────────────────────────────────────┐
│  Supabase                                       │
│  - PostgreSQL (RLS-enforced)                    │
│  - GoTrue auth (email/password)                 │
│  - PostgREST auto-generated REST API            │
│  - Realtime over WebSocket (color transitions)  │
└─────────────────────────────────────────────────┘
                            ▲
                            │ Nightly CSV / API
                            │
                ┌───────────┴────────────┐
                │  Your existing SIS     │
                │  (IC, PowerSchool, …)  │
                │  Roster + attendance   │
                └────────────────────────┘
```

Key tables:
- **Behavior**: `incidents`, `color_transitions`, `color_cycles`, `first_aid_log`, `staff_notifications`
- **Academics**: `assessment_events`, `academic_scores`, `data_meetings`, `action_plans`, `action_plan_students`
- **Identity / roster**: `students`, `profiles`, `homeroom_aliases`, `student_accommodations`, `student_notes`

---

## Getting help

- Check `CODEX_RULES.md` in this repo for the development conventions used by the original author
- File issues on GitHub for bugs
- For setup questions, the original maintainer is Jacquelyn Carmichael (jacquelyn.carmichael@waynestem.org)

---

*ClassPulse is open-source under the same license as the upstream repository. Contributions welcome.*
