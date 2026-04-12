# Analytics Feature Plan (Teacher + Admin)

This plan maps requested features to the current code structure in `src/main.js` and aligns implementation with `CODEX_RULES.md`.

## 1) Current state (relevant to your requests)

- **Teacher "My Log" already has a weekly mini trend line** generated from `STATE.myDbLogs` + session logs in `renderHistory()`, but no heatmap there yet.
- **Admin timing tab has the only heatmap** (`buildHeatData()`, `heatmapHtml()`, `wireHeatInteractions()`), and it is currently global/filter-based rather than per-student/per-class embedded views.
- **Class detail pages** currently show weekly trend with a **bar chart** in `openDet()` (`drawBar('c-det-wk', ...)`) rather than a line chart.
- **Admin students page** currently lists students with 4+ incidents (`bST`) but does **not** provide direct drilldown cards/list expansion there.

## 2) Guardrails from CODEX_RULES to preserve while adding features

1. All new visualizations must derive from `STATE.liveRows` / `STATE.myDbLogs` (no seeded arrays, no static counts).
2. Avoid hardcoded subject lists; continue deriving subjects from row data / existing subject helpers.
3. Keep role guards for admin-only actions (`SESSION.role === 'admin'`).
4. Keep logic in `src/main.js` (do not move analytics into new modules).
5. Run `npm run build` before each commit.

## 3) Recommended implementation approach by requested feature

### A. Teacher "My Log" heatmap + weekly line for longitudinal/monthly views

**Best approach**
- Reuse the existing heatmap pipeline but add a `rows` input source so it can render from teacher rows in `renderHistory()`.
- Add a lightweight helper to bucket teacher rows by:
  - school week (Mon-Sun aligned to current app convention),
  - month key (`YYYY-MM`) for month-over-month trend chips/line overlays.
- Render two visuals above the log list:
  1. **Weekly block heatmap** (period × weekday)
  2. **Weekly longitudinal line** (same visual grammar as overview line, but teacher-scoped)

**Why this is safest**
- Reuses existing interaction model and tooltip/drill logic from `wireHeatInteractions()`.
- Keeps all analytics computed from existing live teacher logs.

### B. Student drill-downs: weekly heatmap + weekly line chart

**Best approach**
- Extend `openStudentDetail(...)` flow (currently reached through `wireStudentLinks` + fetch calls) to compute:
  - `studentWeeklySeries` (count per week),
  - `studentHeatGrid` (period × day counts).
- Place visuals above incident list:
  - **Weekly line chart** for longitudinal trajectory,
  - **Weekly incidents block heatmap** for pattern detection.

**Key design detail**
- Add clickable heat cells that filter the incident list for that student detail panel. This makes the heatmap operational instead of decorative.

### C. Admin students page (4+ incidents) should support same drilldown as class page

**Best approach**
- In `bST(...)`, render each student row with a `data-student` attribute and chevron affordance.
- Bind click handlers after render (same pattern used in class explorer and incident list wiring).
- On click, open the existing student detail screen with:
  - incident list,
  - weekly line,
  - weekly heatmap,
  - edit/delete actions controlled by existing role guards.

**Why this is consistent**
- Mirrors `openDet(...)` drill behavior and avoids introducing a second drilldown pattern.

### D. Weekly incidents as block heatmap (student-level weekly patterns)

**Best approach**
- Reuse `getPeriod()` + weekday labeling in heatmap helpers.
- For each student, aggregate only rows for selected date window and current filters.
- Normalize intensity per student (max cell in that student view), so low-volume students still show meaningful pattern contrast.

### E. Weekly line chart for each class on individual class pages

**Best approach**
- In `openDet(...)`, replace/augment weekly bar chart with line chart using the same line renderer semantics used on overview.
- Keep bars optional (toggle) if teachers/admins prefer counts-by-week bars; line should be default for trajectory reading.

## 4) Data model and query recommendations

- Introduce one shared aggregation helper for **week keying** and date-window filtering used by:
  - overview,
  - class detail,
  - student detail,
  - teacher history.
- Add optional date range controls (last 6 weeks, 9 weeks, semester) and pass range to all chart builders.
- Preserve server fetch limits and use client-side memoized aggregates keyed by `(scope + date range + filters)`.

## 5) UX consistency recommendations

- Use one legend and one intensity scale for all heatmaps to avoid interpretation drift.
- Keep chart headers identical across contexts ("Weekly trend", "Weekly pattern heatmap").
- Add zero-state cards with plain text (no emoji) for empty views.

## 6) Priority roadmap (low-risk sequence)

1. **Refactor heatmap helpers to accept arbitrary row scopes** (teacher/class/student).
2. **Add student detail weekly line + heatmap** (highest value for intervention checks).
3. **Enable admin students list drilldown parity** with class page.
4. **Upgrade class detail weekly chart to line default**.
5. **Add My Log heatmap + month-over-month controls**.

## 7) Acceptance criteria (quick checks)

- Teacher My Log shows weekly heatmap and weekly line from `STATE.myDbLogs` only.
- Student drilldown shows both weekly line + weekly heatmap and filters incident list on cell click.
- Admin students list rows open full student drilldown (same capability level as class page).
- Class detail page exposes weekly line chart.
- All screens handle no-data gracefully (no fake values).
- Build succeeds with `npm run build`.
