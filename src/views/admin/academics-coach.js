// ─────────────────────────────────────────────────────────────────────────────
// Academics · Coach / Dean Dashboard
//
// The buyer's view. Principals, instructional coaches, and academic deans
// use this to see the academic health of the whole school at a glance.
// This is the screen that justifies the contract when a charter network is
// deciding whether to renew or expand.
//
// Layout (top to bottom):
//   1. School-wide KPI strip — scholars assessed, % meeting, # active
//      plans, avg auto-completed plan delta
//   2. By grade rollup — one row per grade with: # assessments, # scholars
//      with data, % meeting, # active plans, avg outcome
//   3. By teacher impact — # plans owned, # auto-completed, avg delta,
//      framed as "your reteach impact" not rankings
//   4. Active plans status strip — total active, awaiting (overdue),
//      complete, with avg outcome by completion type
//
// Ethical framing:
//   The teacher impact section is intentionally framed as personal impact
//   ("you helped your scholars improve by X pts") rather than competitive
//   rankings. Same data, healthier conversation.
//
// All aggregations are client-side. At expected pilot scale (one school,
// 500 students, hundreds of assessments) this is fast and keeps the schema
// simple. If the data outgrows this approach, materialize as a Supabase view.
// ─────────────────────────────────────────────────────────────────────────────

import {
  showScreen, showToast, emptyState,
  skeletonRows, escHtml, drawLine
} from '../../main.js';
import { fetchCoachDashboardData } from '../../api/academics.js';

var SCHOOL_YEAR = import.meta.env.VITE_SCHOOL_YEAR || '2025-26';

// View state
var V = {
  data: null,
  loading: false,
  rangeKey: 'quarter'
};

var DATE_RANGES = [
  { key: '4wk',     label: 'Last 4 weeks' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'year',    label: 'This year' }
];

// ── PUBLIC ENTRY POINT ──────────────────────────────────────────────────────
export function openAcademicsCoach() {
  showScreen('S-academics-coach');
  V.data = null;
  V.loading = true;
  V.rangeKey = 'quarter';
  renderShell();
  loadData();
}

// ── RENDER ──────────────────────────────────────────────────────────────────
function renderShell() {
  var body = el('coach-body');
  if (!body) return;
  body.innerHTML =
    '<div id="coach-controls">' + renderControls() + '</div>' +
    '<div id="coach-content" style="margin-top:12px">' +
      (V.loading
        ? '<div class="card">' + skeletonRows(8) + '</div>'
        : renderContent()
      ) +
    '</div>';
  wireControls();
}

function renderControls() {
  var chips = DATE_RANGES.map(function(r) {
    var on = V.rangeKey === r.key;
    return '<button class="coach-range-chip" data-range="' + r.key + '" ' +
      'style="font-size:11px;padding:5px 12px;border-radius:14px;margin-right:4px;cursor:pointer;' +
        'border:1px solid ' + (on ? 'var(--navy)' : 'var(--border)') + ';' +
        'background:' + (on ? 'rgba(39,26,112,.12)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--navy)' : 'var(--text2)') + '">' +
      escHtml(r.label) + '</button>';
  }).join('');
  return '<div class="card" style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center">' +
    '<div>' +
      '<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Window</div>' +
      chips +
    '</div>' +
    '<button id="coach-refresh" class="btn-secondary" style="font-size:11px;padding:5px 12px">↻ Refresh</button>' +
  '</div>';
}

function renderContent() {
  if (!V.data) return renderEmpty();
  var d = V.data;
  if (!d.events.length) {
    return emptyState(
      'No academic data in this window',
      'When teachers enter assessment scores, the school health view will populate here.'
    );
  }
  return renderKpiStrip(d) +
         renderTrendCard(d) +
         renderGradeRollup(d) +
         renderTeacherImpact(d) +
         renderActivePlansStrip(d);
}

function renderEmpty() {
  return emptyState(
    'Loading…',
    'Pulling school-wide academic data.'
  );
}

// ── 1. SCHOOL-WIDE KPIs ─────────────────────────────────────────────────────
function renderKpiStrip(d) {
  var stats = computeSchoolStats(d);
  return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px">' +
    kpiCard('Scholars assessed',  stats.scholarCount,
            stats.scholarCount + ' have at least one score'),
    kpiCard('% meeting',           stats.meetingPct + '%',
            'of all scored events scored ≥80%',
            stats.meetingPct >= 70 ? 'green' : stats.meetingPct >= 50 ? 'yellow' : 'red'),
    kpiCard('Active plans',        stats.activePlans,
            stats.awaitingPlans + ' overdue'),
    kpiCard('Avg reteach impact',  (stats.avgDelta > 0 ? '+' : '') + stats.avgDelta + ' pts',
            stats.autoCompleted + ' auto-completed plans',
            stats.avgDelta > 0 ? 'green' : stats.avgDelta < 0 ? 'red' : null) +
  '</div>';
}

function kpiCard(label, value, sub, tone) {
  var colors = { green: '#287f6c', yellow: '#8a7314', red: '#a82828' };
  var color = tone ? colors[tone] : 'var(--text)';
  return '<div class="card" style="padding:12px 14px">' +
    '<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">' +
      escHtml(label) + '</div>' +
    '<div style="font-size:22px;font-weight:700;color:' + color + ';line-height:1">' +
      value + '</div>' +
    '<div style="font-size:10px;color:var(--text3);margin-top:4px">' +
      escHtml(sub) + '</div>' +
  '</div>';
}

// ── 2. WEEKLY TREND ─────────────────────────────────────────────────────────
function renderTrendCard(d) {
  return '<div class="card" style="margin-bottom:14px;padding:12px 14px">' +
    '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">' +
      '<div style="font-size:12px;font-weight:600">Weekly avg score (all assessments)</div>' +
      '<div style="font-size:10px;color:var(--text3)">School-wide</div>' +
    '</div>' +
    '<canvas id="coach-trend" height="80" style="width:100%;display:block"></canvas>' +
  '</div>';
}

// ── 3. BY GRADE ROLLUP ──────────────────────────────────────────────────────
function renderGradeRollup(d) {
  var byGrade = computeGradeRollup(d);
  if (!byGrade.length) return '';
  var maxScholarCount = byGrade.reduce(function(m, g) { return Math.max(m, g.scholarCount); }, 1);
  return '<div class="card" style="margin-bottom:14px">' +
    '<div style="font-size:12px;font-weight:600;margin-bottom:10px">By grade</div>' +
    '<div style="display:grid;grid-template-columns:60px 1fr 70px 70px 60px 80px;gap:8px;font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;padding-bottom:6px;border-bottom:1px solid var(--border)">' +
      '<div>Grade</div>' +
      '<div>Scholars w/ data</div>' +
      '<div style="text-align:right">% meeting</div>' +
      '<div style="text-align:right">Assessments</div>' +
      '<div style="text-align:right">Plans</div>' +
      '<div style="text-align:right">Avg Δ</div>' +
    '</div>' +
    byGrade.map(function(g) {
      var pct = g.meetingPct;
      var meetColor = pct >= 70 ? '#287f6c' : pct >= 50 ? '#8a7314' : '#a82828';
      var deltaColor = g.avgDelta > 0 ? '#287f6c' : g.avgDelta < 0 ? '#a82828' : 'var(--text3)';
      var deltaText = g.autoCompleted > 0
        ? ((g.avgDelta > 0 ? '+' : '') + g.avgDelta + ' pts')
        : '—';
      var barWidth = Math.round((g.scholarCount / maxScholarCount) * 100);
      return '<div style="display:grid;grid-template-columns:60px 1fr 70px 70px 60px 80px;gap:8px;align-items:center;padding:8px 0;border-bottom:0.5px solid var(--border);font-size:12px">' +
        '<div style="font-weight:700">' + escHtml(g.grade) + '</div>' +
        '<div>' +
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<div style="height:6px;flex:1;background:var(--border);border-radius:3px;max-width:140px">' +
              '<div style="height:100%;width:' + barWidth + '%;background:var(--navy);border-radius:3px"></div>' +
            '</div>' +
            '<span style="font-size:11px;color:var(--text2);font-weight:600">' + g.scholarCount + '</span>' +
          '</div>' +
        '</div>' +
        '<div style="text-align:right;font-weight:700;color:' + meetColor + '">' + pct + '%</div>' +
        '<div style="text-align:right;color:var(--text2)">' + g.eventCount + '</div>' +
        '<div style="text-align:right;color:var(--text2)">' + g.activePlans + '</div>' +
        '<div style="text-align:right;font-weight:700;color:' + deltaColor + '">' + deltaText + '</div>' +
      '</div>';
    }).join('') +
  '</div>';
}

// ── 4. BY TEACHER IMPACT ────────────────────────────────────────────────────
function renderTeacherImpact(d) {
  var byTeacher = computeTeacherImpact(d);
  if (!byTeacher.length) return '';

  return '<div class="card" style="margin-bottom:14px">' +
    '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">' +
      '<div style="font-size:12px;font-weight:600">Reteach impact by teacher</div>' +
      '<div style="font-size:10px;color:var(--text3)">based on auto-completed plans they own</div>' +
    '</div>' +
    '<div style="font-size:10px;color:var(--text3);margin-bottom:10px;font-style:italic">' +
      'This view is meant to celebrate impact and surface coaching opportunities — not for rankings. ' +
      'A "—" means the teacher hasn\'t had a plan auto-complete yet, which is common early in the year.' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 60px 60px 70px 80px;gap:8px;font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;padding-bottom:6px;border-bottom:1px solid var(--border)">' +
      '<div>Teacher</div>' +
      '<div style="text-align:right">Plans</div>' +
      '<div style="text-align:right">Auto-done</div>' +
      '<div style="text-align:right">Scores entered</div>' +
      '<div style="text-align:right">Avg Δ</div>' +
    '</div>' +
    byTeacher.map(function(t) {
      var deltaColor = t.avgDelta > 0 ? '#287f6c' : t.avgDelta < 0 ? '#a82828' : 'var(--text3)';
      var deltaText = t.autoCompleted > 0
        ? ((t.avgDelta > 0 ? '+' : '') + t.avgDelta + ' pts')
        : '—';
      return '<div style="display:grid;grid-template-columns:1fr 60px 60px 70px 80px;gap:8px;align-items:center;padding:8px 0;border-bottom:0.5px solid var(--border);font-size:12px">' +
        '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(t.email) + '">' +
          escHtml(prettyEmail(t.email)) +
        '</div>' +
        '<div style="text-align:right;color:var(--text2)">' + t.planCount + '</div>' +
        '<div style="text-align:right;color:var(--text2)">' + t.autoCompleted + '</div>' +
        '<div style="text-align:right;color:var(--text2)">' + t.scoresEntered + '</div>' +
        '<div style="text-align:right;font-weight:700;color:' + deltaColor + '">' + deltaText + '</div>' +
      '</div>';
    }).join('') +
  '</div>';
}

// ── 5. ACTIVE PLANS STRIP ───────────────────────────────────────────────────
function renderActivePlansStrip(d) {
  var stats = computePlanBuckets(d.plans);
  return '<div class="card" style="padding:14px">' +
    '<div style="font-size:12px;font-weight:600;margin-bottom:10px">Action plans status</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px">' +
      planBucket('Active', stats.active, 'var(--navy)') +
      planBucket('Awaiting (overdue)', stats.awaiting,
                 stats.awaiting > 0 ? '#a82828' : 'var(--text3)') +
      planBucket('Auto-completed', stats.autoCompleted, '#287f6c') +
      planBucket('Manual outcome', stats.manualOutcome, '#8a7314') +
      planBucket('Discontinued', stats.discontinued, 'var(--text3)') +
    '</div>' +
  '</div>';
}

function planBucket(label, n, color) {
  return '<div style="text-align:center;padding:10px;background:var(--panel);border-radius:8px">' +
    '<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">' + escHtml(label) + '</div>' +
    '<div style="font-size:24px;font-weight:700;color:' + color + ';line-height:1.2">' + n + '</div>' +
  '</div>';
}

// ── COMPUTATIONS ────────────────────────────────────────────────────────────

function computeSchoolStats(d) {
  // Distinct scholars who have at least one non-null score
  var scholarSet = {};
  var pcts = [];
  d.scores.forEach(function(s) {
    if (s.score === null || s.score === undefined) return;
    scholarSet[s.clever_id] = true;
    var ev = d.events.find(function(e) { return e.id === s.assessment_event_id; });
    if (!ev) return;
    var max = Number(ev.max_score) || 100;
    pcts.push((Number(s.score) / max) * 100);
  });
  var meetingPct = pcts.length
    ? Math.round(pcts.filter(function(p) { return p >= 80; }).length / pcts.length * 100)
    : 0;

  var today = new Date(); today.setHours(0, 0, 0, 0);
  var activePlans = 0, awaitingPlans = 0;
  d.plans.forEach(function(p) {
    if (p.status !== 'active') return;
    if (p.target_check_date) {
      var due = new Date(p.target_check_date + 'T12:00:00');
      if (due < today) awaitingPlans++;
      else activePlans++;
    } else {
      activePlans++;
    }
  });
  var autoCompleted = d.plans.filter(function(p) {
    return p.follow_up_event_id && p.outcome_notes &&
      p.outcome_notes.indexOf('Auto-completed') === 0;
  });
  var avgDelta = 0;
  if (autoCompleted.length) {
    var sumD = autoCompleted.reduce(function(a, p) {
      return a + (Number(p.outcome_avg_delta) || 0);
    }, 0);
    avgDelta = Math.round((sumD / autoCompleted.length) * 10) / 10;
  }

  return {
    scholarCount: Object.keys(scholarSet).length,
    meetingPct: meetingPct,
    activePlans: activePlans,
    awaitingPlans: awaitingPlans,
    autoCompleted: autoCompleted.length,
    avgDelta: avgDelta
  };
}

function computeGradeRollup(d) {
  // Group events by grade, compute meeting % across scores in those events
  var grades = {};
  d.events.forEach(function(e) {
    var g = e.grade_level || 'Other';
    if (!grades[g]) grades[g] = { grade: g, events: [], scores: [], scholars: {}, plans: [] };
    grades[g].events.push(e);
  });
  d.scores.forEach(function(s) {
    var ev = d.events.find(function(e) { return e.id === s.assessment_event_id; });
    if (!ev) return;
    var g = ev.grade_level || 'Other';
    if (!grades[g]) return;
    grades[g].scores.push({ score: s, event: ev });
    if (s.score !== null && s.score !== undefined) grades[g].scholars[s.clever_id] = true;
  });
  // Attribute plans by their source assessment's grade
  d.plans.forEach(function(p) {
    var srcEvent = d.events.find(function(e) { return e.id === p.source_assessment_event_id; });
    var g = srcEvent ? srcEvent.grade_level : 'Other';
    if (!grades[g]) return;
    grades[g].plans.push(p);
  });

  return Object.keys(grades).map(function(gKey) {
    var g = grades[gKey];
    var pcts = [];
    g.scores.forEach(function(item) {
      if (item.score.score === null || item.score.score === undefined) return;
      var max = Number(item.event.max_score) || 100;
      pcts.push((Number(item.score.score) / max) * 100);
    });
    var meetingPct = pcts.length
      ? Math.round(pcts.filter(function(p) { return p >= 80; }).length / pcts.length * 100)
      : 0;
    var activePlans = g.plans.filter(function(p) { return p.status === 'active'; }).length;
    var auto = g.plans.filter(function(p) {
      return p.follow_up_event_id && p.outcome_notes &&
        p.outcome_notes.indexOf('Auto-completed') === 0;
    });
    var avgDelta = auto.length
      ? Math.round((auto.reduce(function(a, p) { return a + (Number(p.outcome_avg_delta) || 0); }, 0) / auto.length) * 10) / 10
      : 0;
    return {
      grade: g.grade,
      eventCount: g.events.length,
      scholarCount: Object.keys(g.scholars).length,
      meetingPct: meetingPct,
      activePlans: activePlans,
      autoCompleted: auto.length,
      avgDelta: avgDelta
    };
  }).sort(function(a, b) {
    // K first, then numeric grades
    if (a.grade === 'K') return -1;
    if (b.grade === 'K') return 1;
    return (parseInt(a.grade, 10) || 99) - (parseInt(b.grade, 10) || 99);
  });
}

function computeTeacherImpact(d) {
  // Attribute by: action_plans.owner_email AND academic_scores.recorded_by
  var teachers = {};

  function ensure(email) {
    if (!email) return null;
    if (!teachers[email]) {
      teachers[email] = {
        email: email,
        planCount: 0,
        autoCompleted: 0,
        deltas: [],
        scoresEntered: 0
      };
    }
    return teachers[email];
  }

  d.plans.forEach(function(p) {
    var t = ensure(p.owner_email);
    if (!t) return;
    t.planCount++;
    if (p.follow_up_event_id && p.outcome_notes && p.outcome_notes.indexOf('Auto-completed') === 0) {
      t.autoCompleted++;
      if (p.outcome_avg_delta !== null && p.outcome_avg_delta !== undefined) {
        t.deltas.push(Number(p.outcome_avg_delta));
      }
    }
  });
  d.scores.forEach(function(s) {
    var t = ensure(s.recorded_by);
    if (!t) return;
    t.scoresEntered++;
  });

  return Object.values(teachers).map(function(t) {
    var avgDelta = t.deltas.length
      ? Math.round((t.deltas.reduce(function(a, x) { return a + x; }, 0) / t.deltas.length) * 10) / 10
      : 0;
    return {
      email: t.email,
      planCount: t.planCount,
      autoCompleted: t.autoCompleted,
      scoresEntered: t.scoresEntered,
      avgDelta: avgDelta
    };
  }).sort(function(a, b) {
    // Sort by recent activity: scores entered + plan count
    return (b.scoresEntered + b.planCount * 5) - (a.scoresEntered + a.planCount * 5);
  });
}

function computePlanBuckets(plans) {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var b = { active: 0, awaiting: 0, autoCompleted: 0, manualOutcome: 0, discontinued: 0 };
  plans.forEach(function(p) {
    if (p.status === 'active') {
      if (p.target_check_date) {
        var due = new Date(p.target_check_date + 'T12:00:00');
        if (due < today) b.awaiting++;
        else b.active++;
      } else {
        b.active++;
      }
      return;
    }
    if (p.status === 'discontinued') { b.discontinued++; return; }
    // complete or partial
    var isAuto = p.follow_up_event_id && p.outcome_notes &&
      p.outcome_notes.indexOf('Auto-completed') === 0;
    if (isAuto) b.autoCompleted++;
    else b.manualOutcome++;
  });
  return b;
}

// ── DATA LOAD ───────────────────────────────────────────────────────────────
function loadData() {
  V.loading = true;
  renderShell();
  var range = buildDateRange(V.rangeKey);
  fetchCoachDashboardData({
    schoolYear: SCHOOL_YEAR,
    dateFrom: range.from,
    dateTo: range.to
  }, function(err, data) {
    V.loading = false;
    if (err) {
      showToast('Could not load coach dashboard', 'error');
      V.data = { events: [], scores: [], plans: [] };
    } else {
      V.data = data;
    }
    renderShell();
    // Draw trend after the canvas mounts
    if (V.data && V.data.events.length) {
      setTimeout(function() { drawTrend(V.data); }, 30);
    }
  });
}

function drawTrend(d) {
  // Group scores by week, compute weekly avg percent
  var wkMap = {};
  d.scores.forEach(function(s) {
    if (s.score === null || s.score === undefined) return;
    var ev = d.events.find(function(e) { return e.id === s.assessment_event_id; });
    if (!ev || !ev.administered_date) return;
    var date = new Date(ev.administered_date + 'T12:00:00');
    if (isNaN(date)) return;
    var day = date.getDay();
    var mon = new Date(date);
    mon.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
    var key = mon.toISOString().slice(0, 10);
    if (!wkMap[key]) wkMap[key] = [];
    var max = Number(ev.max_score) || 100;
    wkMap[key].push((Number(s.score) / max) * 100);
  });
  var weeks = Object.keys(wkMap).sort();
  if (!weeks.length) return;
  var labels = weeks.map(function(w) {
    var d = new Date(w + 'T12:00:00');
    return isNaN(d) ? w : (d.toLocaleString('en-US', { month: 'short' }) + ' ' + d.getDate());
  });
  var values = weeks.map(function(w) {
    var arr = wkMap[w];
    return Math.round(arr.reduce(function(a, p) { return a + p; }, 0) / arr.length);
  });
  drawLine('coach-trend', labels, values);
}

// ── WIRING ──────────────────────────────────────────────────────────────────
function wireControls() {
  document.querySelectorAll('#coach-controls [data-range]').forEach(function(b) {
    b.addEventListener('click', function() {
      V.rangeKey = b.dataset.range;
      loadData();
    });
  });
  var rf = el('coach-refresh');
  if (rf) rf.addEventListener('click', loadData);
}

// ── UTIL ────────────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function buildDateRange(key) {
  var today = new Date();
  var iso = function(d) { return d.toISOString().slice(0, 10); };
  if (key === '4wk') {
    var d = new Date(today); d.setDate(d.getDate() - 28);
    return { from: iso(d), to: iso(today) };
  }
  if (key === 'year') {
    var d3 = new Date(today); d3.setDate(d3.getDate() - 365);
    return { from: iso(d3), to: iso(today) };
  }
  // quarter
  var d2 = new Date(today); d2.setDate(d2.getDate() - 90);
  return { from: iso(d2), to: iso(today) };
}

function prettyEmail(email) {
  if (!email) return '—';
  // Strip domain for compact display
  var at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}
