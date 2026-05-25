# ClassPulse

**The daily UI for the data-binder ritual.**
Behavior tracking + Data-Driven Instruction for K-5 schools.

---

## What It Is

ClassPulse replaces two things schools currently do in spreadsheets and binders:

1. **Daily behavior tracking** — incident logging, color-chart escalations, threshold alerts, weekly trends
2. **Weekly DDI (Data-Driven Instruction) workflow** — score entry, the printed "data binder" grid, Tuesday meeting mode, action plans with **auto-tracked reteach outcomes**

The product is shaped for the Bambrick-Santoyo *Driven by Data* methodology used by Uncommon Schools, Achievement First, Success Academy, KIPP, BASIS, IDEA, and most high-performing charter networks.

## What It Replaces

- The Excel sheet your teachers print and color-code red/yellow/green every Monday night
- The physical "data binder" your grade-team brings to Tuesday meetings
- The whiteboard where action plans get written and forgotten
- The follow-up questions nobody can answer: *did the reteach actually work?*

## The Closed-Loop Feature

When a teacher enters scores on a follow-up assessment, ClassPulse **automatically detects** which active action plans those scores complete, computes the per-scholar delta vs the source assessment, and updates the plan with the outcome. This is the moat — no other DDI tool closes the loop automatically.

## For Coaches & Deans

A dedicated **Coach Dashboard** surfaces:
- School-wide KPIs (% meeting, active plans, avg reteach impact)
- Per-grade mastery rollup
- Per-teacher reteach impact (framed as personal impact, not rankings)
- Action plans status across the school

This is what justifies the contract when a charter network decides to renew.

## Sits on Top of Your SIS

ClassPulse is the **system of entry** for behavior + the DDI workflow. Your existing SIS (Infinite Campus, PowerSchool, Skyward) stays the **system of record** for attendance, transcripts, and state reporting. Roster comes in via Clever Secure Sync or CSV import.

## Stack

- **Frontend**: Vite + Vanilla JS (SPA, no React)
- **Backend**: Supabase (Postgres + Auth + REST + Realtime)
- **Serverless**: Supabase Edge Functions (weekly digest)
- **Deployment**: Netlify

## Setup

See **[ONBOARDING.md](./ONBOARDING.md)** for a step-by-step deployment guide for a new charter or school.

## Status

Active development at Wayne STEM Academy, the first pilot school. V1 academic features (weeks 1-8 of the rollout plan) are live; week 9+ polish and the coach dashboard are in flight.

## Architecture

```
Browser (Vite SPA)
   ▼ HTTPS
Supabase (Postgres + Auth + REST + Realtime)
   ▲
   │ Nightly CSV / Clever Sync
   │
Your SIS (IC, PowerSchool, etc.)
```

## Why It Matters

Most school tooling produces data without insight. ClassPulse **makes patterns visible and the loop closeable** — so the Tuesday meeting stops being a status update and becomes a working session.
