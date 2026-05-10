STANDING RULES FOR CLASSPULSE — READ BEFORE TOUCHING ANY FILE

This is a production app used by real teachers at a real school.
These rules are non-negotiable.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. NEVER HARDCODE DATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
All charts, tables, counts, percentages, and stats must derive
from STATE.liveRows (live Supabase data) or STATE.myDbLogs
(teacher's own logs). Never write literal arrays like:

  BAD:  var conD=[{n:'PE',a:11,p:100,l:1.9}]
  BAD:  var total=248
  BAD:  [{f:'Student name',p:100},{f:'Specials class',p:99}]

Instead compute from live data:
  GOOD: var total=STATE.liveRows.length
  GOOD: rows.filter(function(r){return r.student;}).length

If live data is empty, show a graceful empty state, not fake numbers.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. NEVER HARDCODE SUBJECT/ROLE LISTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This app is used by specials teachers, homeroom teachers, IAs,
and admins. Do not hardcode ['PE','Technology','Art','Music']
anywhere in charts, tables, or filters.

Subjects must always be derived dynamically:
  GOOD: Object.keys(rows.reduce(function(a,r){
          var s=r.subject||r.specials; if(s) a[s]=1; return a;
        },{}))

The subject chip list for the log form is role-aware via
getSpecials() — always call that function, never hardcode.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. NEVER ADD DISCLAIMER OR INTERPRETATION TEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Do not add any of the following to the UI:
- "About these numbers" explanations
- "This may reflect..." caveats
- "Specials counts are partial..." notes
- "🔒 Restricted. For administrator use only." banners
- Day-of-week "findings" like "Wednesday leads at 8.0 incidents/day"
- Any inline editorial commentary on the data

The users are professionals. Present the data cleanly and let
them interpret it.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. NEVER ADD EMOJI TO THE UI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
No emoji anywhere — not in empty states, not in alerts,
not in banners, not in buttons. Use text or CSS only.

  BAD:  <div class="empty-ico">📋</div>
  BAD:  <span>⚠</span>
  BAD:  <span>🔒</span>
  GOOD: <div class="empty-t">No logs yet</div>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. ROLE GUARDS — NEVER SKIP THEM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SESSION.role is one of: 'specials', 'homeroom', 'ia', 'admin'

Admin-only UI (notes fields, class explorer nav, switch button,
student notes, restricted data) must always check:
  if(SESSION.role === 'admin')

Teacher nav buttons that call goAdmin() must check role first:
  if(SESSION.role === 'admin') goAdmin();

Never expose admin screens to non-admin roles.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. DO NOT INTRODUCE DUPLICATE DECLARATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Before adding any function or variable, grep the file to confirm
it doesn't already exist. Duplicate function declarations break
the Vite build with "Identifier already declared" errors.

  Before adding: grep -n "function myFunc" src/main.js

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. BUILD MUST PASS BEFORE COMMITTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Always run: npm run build
Fix all errors before committing. A failed build means
Netlify won't deploy and the app breaks for real users.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
8. DO NOT RESTRUCTURE THE CODEBASE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
All logic lives in src/main.js by design. Module files in
src/auth/, src/views/, src/api/, src/state/, src/components/
are re-exports only. Do not move logic into them, do not
create new module files, do not refactor the architecture.
Make changes in place.
KNOWN REPEAT OFFENDER: checkInviteToken
This function is exported from src/auth/session.js and imported
in src/main.js. It must NEVER be declared again in main.js.
Before touching auth or session code, run:
  grep -rn "function checkInviteToken" src/
If it appears in more than one file, remove the duplicate in main.js.EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
9. TOKEN REFRESH ON SESSION RESTORE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The app uses localStorage (not sessionStorage) to persist sessions.
Supabase access tokens expire after 1 hour. Always call refreshSession()
BEFORE fetchRole() in the session restore block — never after. A stale
token causes 401s on all API calls even though the session appears valid.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
10. SUBJECT-TO-TEACHER MAP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SUBJECT_TEACHER maps specials subjects to teacher names for historical
records. Do not hardcode new entries — update this map when teachers change.
  PE → Mrs. Offield
  Technology → Ms. Carmichael
  Art → Mrs. Ali
  Music → Mrs. Groff

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
11. NEVER RUN PATCH SCRIPTS MORE THAN ONCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Python patch scripts are not idempotent. Running them twice duplicates
functions and breaks the build. Always verify with grep before running
a patch, and always check the output for "ERROR" before building.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FUTURE: ACADEMIC PERFORMANCE LAYER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The following tables are planned but NOT YET BUILT.
Do not reference them in code until they exist in Supabase.

student_grades:
  id, student_name, homeroom, subject, standard_code, standard_label,
  score, score_type ('test'|'quiz'|'assignment'|'observation'),
  grading_period, logged_by, school_year, school_id, created_at

student_attendance:
  id, student_name, homeroom, date, status ('present'|'absent'|'tardy'|'early_release'),
  reason, logged_by, school_year, school_id, created_at

When these tables exist, the scholar profile will show:
- Attendance KPIs (present %, consecutive absences flag)
- Academic KPIs (avg score by subject, flagged standards below threshold)
- Behavioral + academic + attendance clustering (performance cohorts)
  displayed as a visual scatter/quadrant showing where each scholar
  sits across behavioral frequency vs academic performance

This is the foundation for the parent-facing academic view and
the teacher standards-gap analysis dashboard.
Do not implement until data entry UI is approved.
