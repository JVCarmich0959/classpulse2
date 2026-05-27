# ClassPulse — 10-Minute Demo Script

A literal walkthrough for showing the academic side of ClassPulse to your boss, a fellow ED, an instructional coach, or a charter visiting from another school. Read it once. Bookmark it. Have it open in a second tab during the demo.

The demo lands best in **10 minutes** with **two browsers side by side** so the real-time updates feel real. If you only have 3 minutes, use the **30-Second Hook** at the bottom.

---

## Before you start (60 seconds of prep)

- [ ] Open two browser windows (or one with two tabs) — call them **Window A** (teacher's view) and **Window B** (coach's view)
- [ ] Sign in to both with admin credentials so you can see everything
- [ ] In Window A: go to **Academics → Score Entry**
- [ ] In Window B: go to **Academics → Open Binder**, filter to **Grade K · math · this quarter**
- [ ] You should see the seeded demo data: "Example Assesment" column with ~14 K-Fortner students scored
- [ ] Have a fresh fake assessment ready: title it **"Week 2 Math Check"**, topic **"Math"**, Grade K, max 100 (you can pre-create this so you don't have to fill the form on stage)
- [ ] Resize windows so they're side-by-side. Audience sees both.

If you don't see seeded data: run the demo SQL from the project (`/seed_demo_data.sql` if it exists, or ask the maintainer).

---

## The pitch — what to say while clicking

### Opening (30 seconds)

> *"Every charter doing Data-Driven Instruction runs the same Tuesday-meeting ritual: teachers grade exit tickets, color-code Excel cells red/yellow/green, print binders, walk into a meeting, identify the bottom five kids, write action plans, repeat. We — I — built the daily UI for that ritual. It replaces the spreadsheet, makes the meeting faster, and — here's the part nobody else does — **closes the loop**: when the reteach is given, the platform automatically tells you whether it worked."*

That's your opening. The "nobody else does" line is the hook. Drop it.

### Beat 1: Score Entry (45 seconds) — Window A

Click **Enter Scores** → select the existing "Example Assesment" → the roster appears.

> *"This is where teachers spend most of their time. Keyboard-driven score entry. Tab moves to the next student. Auto-saves on every blur. If the kid was absent, type A. If you graded in Excel first, paste a column with the bulk button."*

Demo: tab through 2–3 students entering scores. Show the green dot appearing as proficiency. Don't fix the typo in "Example Assesment" — laugh about it: *"yes, our first assessment was misspelled. The fact you can see that is part of the point."*

### Beat 2: The Binder (90 seconds) — Window B

Switch to Window B (binder view).

> *"This replaces the printed binder. Students down the side, assessments across. Color-coded mastery — green for meeting, yellow for approaching, red for below 60%. Sorted lowest performers at top — that's the default because the bottom five is who the Tuesday meeting starts with."*

Hover over a red cell.

> *"Click any cell to see the score detail, who entered it, when, any notes."* (click → popover appears)

Point at the rightmost column.

> *"Per-student average + trend arrow. Green up-arrow means they're improving over their recent assessments. Red down means they're sliding. This is the column the IC reads first."*

### Beat 3: Real-time magic (60 seconds) — switch to Window A, then back

> *"Now here's where it gets interesting. Watch the binder while I enter a score over here."*

Switch to Window A. Find a student in Grade K, type a score. Switch back to Window B.

The cell will have pulsed and updated. **This is the demo moment. Pause for effect.**

> *"That just happened across two browsers. Imagine your team is at the Tuesday meeting projected on the TV — that's the dean's view. Teachers can be entering follow-up exit ticket scores from their classrooms in real time, and the meeting sees the data accumulate live. No 'send me the spreadsheet by 3pm' email."*

### Beat 4: Tuesday Meeting Mode (90 seconds) — Window B

In Window B, navigate back to Academics → click **Start Meeting** → Grade K, math, your email as attendee → Start.

> *"This is the screen the team projects on Tuesday. Recent assessments on the left. Bottom 5 auto-flagged on the right. The 'last meeting's plans' section reminds you what you committed to last week and how those plans are going."*

Click **+ Create action plan**.

> *"Right here, live in the meeting, anyone on the team can create a reteach plan. Topic prefills from the assessment. Students prefilled from the bottom 5. Pick a strategy — small group, 1-on-1, parent followup. Target check date defaults to next Tuesday. Save."*

Save the plan with the prefilled data. Toast appears.

### Beat 5: The Closed Loop (90 seconds) — both windows

Navigate to **Action Plans** in Window B.

> *"The plan you just created is sitting under Active. Now, what does every coach actually want to know? Did the reteach work?"*

Switch to Window A. Open Score Entry → select **"Week 2 Math Check"** (your pre-created follow-up).

> *"Watch this. I'm going to enter scores for the same 5 kids on the follow-up assessment."*

Type scores quickly for each of the 5 students in the plan. Make them clearly improved (e.g., bottom student went from 24 → 80).

**As you save the 5th score**, switch back to Window B (Action Plans view).

A toast will appear: *"✓ Live: 'Math' auto-completed (+X pts)"*. The plan will move from Active to Complete with a navy "AUTO-COMPLETED" badge.

Pause. Let it land.

> *"That just happened. The platform watched 5 follow-up scores come in, matched them to the active plan based on topic and target students, calculated the per-scholar delta, and marked the plan complete with the average gain. **Nobody else does this.** Mastery Connect doesn't. Otus doesn't. Kickup doesn't. This is what the moat looks like."*

### Beat 6: Coach Dashboard (45 seconds) — Window B

Navigate back to Academics → **Coach Dashboard**.

> *"This is the view your dean and instructional coach live in. School-wide health: scholars assessed, % meeting, active plans, average reteach impact. By grade — which grades are moving and which need support. By teacher — and notice we frame this as 'reteach impact', not 'rankings'. The point is to celebrate teachers who are helping their kids improve, and surface coaching opportunities for teachers whose plans aren't landing yet."*

Mention the date-range chips.

> *"4 weeks, this quarter, this year. The coach can scope the view to whatever conversation they're having."*

### Close (30 seconds)

> *"Three things you don't get anywhere else:*
> *1. **Auto-completed reteach outcomes.** No more 'did it work?' guessing.*
> *2. **Realtime everywhere.** The whole team sees the data move.*
> *3. **One tool for behavior AND DDI.** Not two logins, not two integrations — one daily UI on top of your existing SIS.*
> *We're piloting at Wayne STEM right now. The plan is to be in 3 charters by end of next semester. Want me to set up a follow-up to talk about what your school would need?"*

---

## What to do if something breaks mid-demo

**If a screen doesn't load**: refresh that tab. Don't panic. Say *"Realtime web app — sometimes the websocket hiccups. One sec."*

**If the closed-loop toast doesn't fire**: open the Plans view manually and click **↻ Recompute outcomes**. The same auto-completion will happen, just triggered by the button. Say *"There's also a manual recompute for catching any plans the live trigger missed."*

**If a teacher's name shows as a clever_id string**: that scholar isn't rostered properly. Skip them, point at another. Say *"Roster's still finalizing for the pilot, that's a missing Clever sync."*

**If Coach Dashboard shows nothing**: KPIs read from the date window — try changing from "4 weeks" to "This year". If still empty, you forgot to apply the seed data.

**If your boss asks a technical question you don't know**: *"Good question — let me pull up the technical doc and follow up tomorrow."* Don't make it up. Then ping the maintainer.

---

## Q&A cheat sheet — the questions you'll actually get

**"How does this integrate with our SIS?"**
*"Clever rostering for student names. Otherwise, ClassPulse is the **system of entry** for daily behavior and DDI. Your SIS — Infinite Campus, PowerSchool — stays the system of record for attendance, transcripts, and state reporting. No conflict."*

**"What about data privacy / FERPA?"**
*"Supabase backend with row-level security, per-role access (teachers see their roster, coaches see their grade band, admins see everything). All student data stays in our database — we don't sell or share. FERPA-compliant posture; happy to walk your compliance officer through the details."*

**"Who can use this?"**
*"Any K-12 school doing DDI. Especially shaped for the Bambrick-Santoyo methodology used by Uncommon, Achievement First, KIPP, Success Academy, IDEA. Most useful if you run Tuesday data meetings; less useful if you don't have that ritual."*

**"What does it cost?"**
*"Pilot pricing for the first few schools — let's talk. Production pricing is per-student per-year, in the range of [$3–7/student/year depending on scope]. Discount for early charters."*

**"How long to set up?"**
*"A weekend if you're hands-on technical, two weeks with onboarding support. Detailed guide in the ONBOARDING.md — Supabase project, schema migrations, Netlify deploy, Clever sync."*

**"What about offline use?"**
*"Online-only. Teachers in classrooms have wifi; this is a meeting-room tool, not a field tool."*

**"What if Clever doesn't work for us?"**
*"Roster can be imported from CSV — works with ClassLink, manual UUIDs, state-issued IDs. Clever is the easiest; alternatives are documented."*

**"Why not just use [Mastery Connect / Otus / Kickup]?"**
*"Mastery Connect is a Common Core mastery tracker — doesn't have the Tuesday-meeting workflow or closed-loop. Otus tries to be everything and is bloated. Kickup is great for coaching but doesn't replace your data binder. ClassPulse is specifically the daily DDI ritual, by someone who's run those meetings."*

**"What's the ML / AI in this?"**
*"The auto-completion of action plans is rule-based, not ML — it's deterministic, which schools prefer for accountability. We have an at-risk leaderboard with SHAP-explained risk scores on the roadmap, but we're not pretending to be an AI product. We're a workflow product. Which is what schools actually need."*

**"Can teachers edit data after entry?"**
*"Yes — every score, every plan, every meeting. Audit trail tracks who changed what when."*

**"What if we have multiple campuses?"**
*"School ID column on every table — already multi-tenant-ready at the schema level. The UI scoping for multi-campus deans is on the roadmap; happy to fast-track if it's a deal requirement."*

---

## The 30-Second Hook (when you only have 30 seconds)

Open the binder view. Point at the grid.

> *"This is the data binder your team brings to Tuesday meetings, but live. Lowest performers at top. Color-coded. Real-time as teachers enter scores."*

Switch to the Action Plans view. Point at an auto-completed plan with the navy AUTO-COMPLETED badge.

> *"And this is the part nobody else has. When a teacher gives the follow-up assessment, the platform automatically matches the new scores to the active reteach plan and tells you whether it worked. +18 pts average, per-scholar deltas right here."*

> *"Wayne STEM is the first pilot. Want a longer demo?"*

---

## After the demo

- [ ] Note what questions came up. Update this script's Q&A section.
- [ ] Send them the [ONBOARDING.md](./ONBOARDING.md) link if they want to deploy.
- [ ] Schedule the follow-up. Don't leave it loose.
- [ ] Take a screenshot of the Coach Dashboard with their hypothetical school's data filled in (you can fake it for the proposal) — use it in the pitch deck.

---

*This script will evolve. Every demo teaches you something — come back and update it.*
