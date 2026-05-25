// ─────────────────────────────────────────────────────────────────────────────
// Academics · Tuesday Meeting Mode
//
// V1 weeks 4-5. The specific screen for the weekly grade-team DDI meeting.
// Pre-filters to the most recent assessment(s), auto-flags the bottom 5,
// makes action plan creation one click away. Designed to be projected.
//
// Flow:
//   1. Start meeting → modal asks (grade, subject, attendees)
//   2. data_meetings row inserted
//   3. Meeting screen renders: context banner + recent-assessment grid +
//      sidebar with bottom-5 + create-plan inline form + end button
//   4. End meeting → save agenda_notes → return to Academics tab
//
// Reuses the existing binder data fetch from src/api/academics.js but
// renders a simplified grid (only last 1-3 assessments). The full binder
// stays available as a separate screen for deeper analysis.
// ─────────────────────────────────────────────────────────────────────────────

import {
  showScreen, showToast, emptyState,
  skeletonRows, escHtml, openStudent
} from '../../main.js';
import {
  fetchBinderData, fetchActionPlans,
  createDataMeeting, updateDataMeeting,
  createActionPlan, updateActionPlan,
  computeProficiency
} from '../../api/academics.js';

var SCHOOL_YEAR = import.meta.env.VITE_SCHOOL_YEAR || '2025-26';
var SUBJECTS = ['math', 'reading', 'writing', 'science', 'social_studies'];
var GRADES   = ['K', '1', '2', '3', '4', '5'];
var STRATEGIES = [
  { v: 'small_group',     lb: 'Small group' },
  { v: '1_on_1',          lb: '1-on-1' },
  { v: 'whole_class',     lb: 'Whole-class reteach' },
  { v: 'station',         lb: 'Station rotation' },
  { v: 'parent_followup', lb: 'Parent follow-up' },
  { v: 'other',           lb: 'Other' }
];

// View state — one meeting at a time
var V = {
  phase: 'setup',           // 'setup' | 'active' | 'ended'
  meeting: null,            // the data_meetings row
  gradeLevel: '3',
  subject: 'math',
  attendees: [],
  agendaNotes: '',
  binderData: null,         // { events, roster, scoresByCell }
  lastMeetingPlans: [],     // active plans from the previous meeting (for review at top)
  newPlanForm: false,
  loading: false
};

// ── PUBLIC ENTRY POINT ──────────────────────────────────────────────────────
export function openAcademicsMeeting() {
  showScreen('S-academics-meeting');
  V.phase = 'setup';
  V.meeting = null;
  V.binderData = null;
  V.lastMeetingPlans = [];
  V.newPlanForm = false;
  V.attendees = [];
  V.agendaNotes = '';
  renderShell();
}

// ── RENDER ──────────────────────────────────────────────────────────────────
function renderShell() {
  var body = el('meeting-body');
  if (!body) return;
  if (V.phase === 'setup') {
    body.innerHTML = renderSetup();
    wireSetup();
  } else if (V.phase === 'active') {
    body.innerHTML = renderActive();
    wireActive();
  } else {
    body.innerHTML = renderEnded();
  }
  updateSub();
}

function updateSub() {
  var sub = el('meeting-sub');
  if (!sub) return;
  if (V.phase === 'setup') sub.textContent = 'Start a new Tuesday meeting';
  else if (V.phase === 'active' && V.meeting) {
    sub.textContent = 'Grade ' + V.meeting.grade_level + ' · ' + V.meeting.subject +
      ' · ' + V.meeting.meeting_date + ' · ' + (V.meeting.attendees || []).length + ' attending';
  }
  else sub.textContent = 'Meeting ended';
}

// ── SETUP PHASE ─────────────────────────────────────────────────────────────
function renderSetup() {
  var attendeesInput = (V.attendees || []).join(', ');
  return '<div class="card" style="max-width:560px;margin:0 auto;padding:22px">' +
    '<div style="font-size:18px;font-weight:700;margin-bottom:6px">Start Tuesday Meeting</div>' +
    '<div style="font-size:12px;color:var(--text2);margin-bottom:18px">' +
      'Set up the meeting context. Once started, you\'ll see the recent assessment data, ' +
      'identify the bottom 5, and capture action plans live.' +
    '</div>' +
    formGrid([
      ['Grade',
        '<select id="setup-grade" class="input" style="width:100%">' +
          GRADES.map(function(g) {
            return '<option value="' + g + '"' + (g === V.gradeLevel ? ' selected' : '') + '>' + g + '</option>';
          }).join('') +
        '</select>'],
      ['Subject',
        '<select id="setup-subject" class="input" style="width:100%">' +
          SUBJECTS.map(function(s) {
            return '<option value="' + s + '"' + (s === V.subject ? ' selected' : '') + '>' + s + '</option>';
          }).join('') +
        '</select>']
    ]) +
    '<div style="margin-top:10px">' +
      '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Attendees</div>' +
      '<input id="setup-attendees" type="text" class="input" style="width:100%" ' +
        'placeholder="comma-separated emails: jane@school.edu, joe@school.edu" ' +
        'value="' + escHtml(attendeesInput) + '">' +
      '<div style="font-size:10px;color:var(--text3);margin-top:3px">' +
        'Who\'s in the room. Used to attribute action plan ownership later.' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">' +
      '<button id="setup-start" class="btn-primary" style="padding:10px 18px;font-weight:600">' +
        'Start Meeting →' +
      '</button>' +
    '</div>' +
    '<div id="setup-err" style="font-size:11px;color:var(--red);margin-top:8px;display:none"></div>' +
  '</div>';
}

function formGrid(pairs) {
  return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
    pairs.map(function(p) {
      return '<div>' +
        '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">' + p[0] + '</div>' +
        p[1] +
      '</div>';
    }).join('') +
  '</div>';
}

function wireSetup() {
  var startBtn = el('setup-start');
  if (!startBtn) return;
  startBtn.addEventListener('click', function() {
    var errEl = el('setup-err');
    if (errEl) errEl.style.display = 'none';

    V.gradeLevel = el('setup-grade').value;
    V.subject    = el('setup-subject').value;
    V.attendees  = (el('setup-attendees').value || '')
      .split(',').map(function(s) { return s.trim(); }).filter(Boolean);

    startBtn.disabled = true;
    startBtn.textContent = 'Starting…';

    createDataMeeting({
      grade_level: V.gradeLevel,
      subject: V.subject,
      attendees: V.attendees,
      school_year: SCHOOL_YEAR
    }, function(err, created) {
      if (err || !created) {
        startBtn.disabled = false;
        startBtn.textContent = 'Start Meeting →';
        if (errEl) {
          errEl.textContent = 'Could not start: ' + ((err && err.message) || 'unknown');
          errEl.style.display = 'block';
        }
        return;
      }
      V.meeting = created;
      V.phase = 'active';
      loadActiveData();
    });
  });
}

// ── ACTIVE PHASE ────────────────────────────────────────────────────────────
function renderActive() {
  if (V.loading || !V.binderData) {
    return '<div class="card">' + skeletonRows(8) + '</div>';
  }

  var d = V.binderData;
  // Show only the most recent N assessments for focused meeting work
  var MAX_COLS = 3;
  var recentEvents = d.events.slice(-MAX_COLS).reverse(); // newest left in meeting view

  if (!d.events.length) {
    return '<div class="card" style="padding:20px">' +
      emptyState(
        'No assessments yet for Grade ' + V.gradeLevel + ' ' + V.subject,
        'Create an assessment and enter scores in "Score Entry" before running a data meeting.'
      ) +
      '<div style="display:flex;gap:8px;justify-content:center;margin-top:14px">' +
        '<button id="active-end-empty" class="btn-secondary">End meeting</button>' +
      '</div>' +
    '</div>';
  }

  // Compute per-student avg + bottom-N
  var rosterWithStats = d.roster.map(function(s) {
    var stats = computeStudentStats(s, recentEvents, d.scoresByCell);
    return Object.assign({}, s, stats);
  });
  rosterWithStats.sort(function(a, b) {
    if (a.avg === null && b.avg === null) return 0;
    if (a.avg === null) return 1;
    if (b.avg === null) return -1;
    return a.avg - b.avg;
  });

  var bottomN = rosterWithStats.filter(function(s) { return s.avg !== null; }).slice(0, 5);

  return '<div style="display:grid;grid-template-columns:1fr 280px;gap:14px;align-items:start">' +
    // LEFT: grid + agenda notes
    '<div>' +
      renderRecentGrid(recentEvents, rosterWithStats, d.scoresByCell) +
      renderAgendaNotes() +
    '</div>' +
    // RIGHT: sidebar
    '<div id="meeting-sidebar">' +
      renderBottomFive(bottomN, recentEvents[0]) +
      renderLastMeetingReview() +
      renderNewPlanSection(bottomN, recentEvents[0]) +
      renderEndMeeting() +
    '</div>' +
  '</div>';
}

function renderRecentGrid(events, rosterWithStats, scoresByCell) {
  if (!events.length) {
    return '<div class="card">' + emptyState('No recent assessments', '') + '</div>';
  }

  // Build a compact grid: students rows × recent assessments columns
  var header = '<thead><tr>' +
    '<th class="m-th m-sticky-left" style="min-width:160px;text-align:left">Scholar</th>' +
    events.map(function(e) {
      return '<th class="m-th" style="min-width:90px">' +
        '<div style="font-size:11px;font-weight:600">' + escHtml(truncate(e.title, 24)) + '</div>' +
        '<div style="font-size:9px;color:var(--text3);font-weight:400">' + escHtml(formatDate(e.administered_date)) + '</div>' +
      '</th>';
    }).join('') +
    '<th class="m-th" style="min-width:60px">Avg</th>' +
  '</tr></thead>';

  var bodyRows = rosterWithStats.map(function(s, idx) {
    var rowHighlight = idx < 5 ? 'background:rgba(214,59,59,.04)' : '';
    return '<tr style="' + rowHighlight + '">' +
      '<td class="m-td m-sticky-left m-name">' +
        '<span class="stu-name-link" data-stu="' + escHtml(s.student_name || (s.first_name + ' ' + s.last_name)) + '">' +
          escHtml(s.last_name ? (s.last_name + ', ' + (s.first_name || '')) : (s.student_name || '—')) +
        '</span>' +
        '<div style="font-size:9px;color:var(--text3)">' + escHtml(s.homeroom || '—') + '</div>' +
      '</td>' +
      events.map(function(e) {
        var key = s.clever_id + '|' + e.id;
        var score = scoresByCell[key];
        return renderMeetingCell(score, e);
      }).join('') +
      '<td class="m-td m-stat">' +
        (s.avg !== null ? Math.round(s.avg) + '%' : '—') +
      '</td>' +
    '</tr>';
  }).join('');

  return '<div class="card" style="padding:0;overflow:auto">' +
    '<table class="meeting-table" style="border-collapse:collapse;width:100%;font-size:12px">' +
      header +
      '<tbody>' + bodyRows + '</tbody>' +
    '</table>' +
  '</div>' + renderMeetingStyles();
}

function renderMeetingCell(score, event) {
  if (!score) return '<td class="m-td m-cell-empty">—</td>';
  if (score.score === null || score.score === undefined) {
    return '<td class="m-td m-cell-absent" title="Absent">ABS</td>';
  }
  var max = Number(event.max_score) || 100;
  var pct = (Number(score.score) / max) * 100;
  var thresholds = event.proficiency_thresholds || { red: 60, yellow: 80 };
  var bg = pct < thresholds.red ? 'rgba(214,59,59,.18)'
         : pct < thresholds.yellow ? 'rgba(232,197,71,.20)'
         : 'rgba(74,191,163,.20)';
  var fg = pct < thresholds.red ? '#a82828'
         : pct < thresholds.yellow ? '#8a7314'
         : '#287f6c';
  return '<td class="m-td m-cell" style="background:' + bg + ';color:' + fg + ';font-weight:700">' +
    escHtml(score.score) + '/' + escHtml(max) +
  '</td>';
}

function renderMeetingStyles() {
  return '<style>' +
    '.meeting-table .m-th, .meeting-table .m-td { padding:6px 8px; border-bottom:1px solid var(--border); border-right:1px solid var(--border); text-align:center; vertical-align:middle; }' +
    '.meeting-table .m-th { background:var(--panel); font-weight:600; font-size:10px; color:var(--text2); }' +
    '.meeting-table .m-sticky-left { position:sticky; left:0; background:var(--bg); text-align:left; box-shadow:1px 0 0 var(--border); z-index:2; }' +
    '.meeting-table th.m-sticky-left { background:var(--panel); }' +
    '.meeting-table .m-name { font-weight:600; font-size:12px; }' +
    '.meeting-table .m-cell-empty { color:var(--text3); }' +
    '.meeting-table .m-cell-absent { color:var(--text3); font-style:italic; font-size:10px; }' +
    '.meeting-table .m-stat { font-weight:700; }' +
  '</style>';
}

function renderBottomFive(bottomN, mostRecentEvent) {
  if (!bottomN.length) {
    return sidebarCard('Bottom 5',
      '<div style="font-size:11px;color:var(--text3);padding:6px 0">No scored students yet.</div>'
    );
  }
  var items = bottomN.map(function(s, i) {
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)">' +
      '<div>' +
        '<div style="font-size:11px;font-weight:600">' + (i+1) + '. ' + escHtml(niceName(s)) + '</div>' +
        '<div style="font-size:9px;color:var(--text3)">' + escHtml(s.homeroom || '—') + '</div>' +
      '</div>' +
      '<div style="font-size:13px;font-weight:700;color:#a82828">' + Math.round(s.avg) + '%</div>' +
    '</div>';
  }).join('');
  return sidebarCard('Bottom 5',
    items +
    '<button id="bottom5-toplan" class="btn-secondary" style="font-size:10px;padding:5px 10px;margin-top:8px;width:100%">' +
      'Create plan for these 5 →' +
    '</button>'
  );
}

function renderLastMeetingReview() {
  if (!V.lastMeetingPlans.length) {
    return sidebarCard('From last meeting',
      '<div style="font-size:11px;color:var(--text3);padding:6px 0;font-style:italic">First meeting for this grade & subject.</div>'
    );
  }
  var items = V.lastMeetingPlans.slice(0, 5).map(function(p) {
    return '<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:11px">' +
      '<div style="font-weight:600">' + escHtml(p.topic) + '</div>' +
      '<div style="font-size:10px;color:var(--text3)">' +
        (p.action_plan_students ? p.action_plan_students.length : 0) + ' scholars · ' +
        (p.target_check_date ? 'check ' + formatDate(p.target_check_date) : 'no check date') +
      '</div>' +
    '</div>';
  }).join('');
  return sidebarCard('From last meeting (' + V.lastMeetingPlans.length + ' active)',
    items +
    '<div style="font-size:9px;color:var(--text3);padding:4px 0 0;font-style:italic">Mark outcomes in Action Plans →</div>'
  );
}

function renderNewPlanSection(bottomN, mostRecentEvent) {
  if (!V.newPlanForm) {
    return sidebarCard('New action plan',
      '<button id="open-newplan" class="btn-primary" style="font-size:11px;padding:6px 10px;width:100%">+ Create action plan</button>'
    );
  }
  // Pre-fill: topic from mostRecentEvent.topic, students from bottomN
  var defaultStudents = bottomN.map(function(s) { return s.clever_id; });
  var topicDefault = (mostRecentEvent && mostRecentEvent.topic) || '';

  return sidebarCard('New action plan',
    '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Topic *</div>' +
    '<input id="np-topic" class="input" style="width:100%;font-size:12px;padding:4px 6px" ' +
      'placeholder="What\'s being retaught" value="' + escHtml(topicDefault) + '">' +
    '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:8px 0 4px">Strategy</div>' +
    '<select id="np-strategy" class="input" style="width:100%;font-size:12px;padding:4px 6px">' +
      '<option value="">—</option>' +
      STRATEGIES.map(function(s) {
        return '<option value="' + s.v + '">' + s.lb + '</option>';
      }).join('') +
    '</select>' +
    '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:8px 0 4px">Target check date</div>' +
    '<input id="np-check" type="date" class="input" style="width:100%;font-size:12px;padding:4px 6px" ' +
      'value="' + nextTuesdayISO() + '">' +
    '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:8px 0 4px">Students (' + defaultStudents.length + ')</div>' +
    '<div id="np-students" style="font-size:10px;color:var(--text2);max-height:80px;overflow:auto;background:var(--panel);padding:4px 6px;border-radius:4px">' +
      bottomN.map(function(s) {
        return '<div data-cid="' + escHtml(s.clever_id) + '" style="padding:2px 0">' +
          '<input type="checkbox" checked data-cid="' + escHtml(s.clever_id) + '" style="vertical-align:middle"> ' +
          escHtml(niceName(s)) +
        '</div>';
      }).join('') +
    '</div>' +
    '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:8px 0 4px">Description</div>' +
    '<textarea id="np-desc" class="input" style="width:100%;font-size:11px;padding:4px 6px;min-height:50px"' +
      ' placeholder="What\'s the plan?"></textarea>' +
    '<div style="display:flex;gap:6px;margin-top:10px">' +
      '<button id="np-cancel" class="btn-secondary" style="font-size:11px;padding:5px 10px;flex:1">Cancel</button>' +
      '<button id="np-save" class="btn-primary" style="font-size:11px;padding:5px 10px;flex:1">Save plan</button>' +
    '</div>' +
    '<div id="np-err" style="font-size:10px;color:var(--red);margin-top:6px;display:none"></div>'
  );
}

function renderAgendaNotes() {
  return '<div class="card" style="margin-top:14px;padding:14px">' +
    '<div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Meeting notes</div>' +
    '<textarea id="meeting-notes" class="input" style="width:100%;min-height:80px;font-size:12px;padding:8px"' +
      ' placeholder="Discussion points, decisions, follow-ups...">' + escHtml(V.agendaNotes || '') + '</textarea>' +
  '</div>';
}

function renderEndMeeting() {
  return sidebarCard('',
    '<button id="end-meeting" class="btn-primary" style="width:100%;padding:10px;font-weight:700;background:var(--navy)">' +
      'End meeting & save' +
    '</button>'
  );
}

function sidebarCard(title, inner) {
  return '<div class="card" style="margin-bottom:10px;padding:12px">' +
    (title ? '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);margin-bottom:8px">' + title + '</div>' : '') +
    inner +
  '</div>';
}

function wireActive() {
  // Student name clicks (only when there are events to render)
  document.querySelectorAll('#meeting-body .stu-name-link').forEach(function(link) {
    link.addEventListener('click', function(e) {
      e.stopPropagation();
      openStudent(link.dataset.stu, 'S-academics-meeting');
    });
  });

  // Notes — update view state on input so end-meeting saves the latest
  var notes = el('meeting-notes');
  if (notes) notes.addEventListener('input', function() { V.agendaNotes = notes.value; });

  // Bottom-5 → create plan
  var b5btn = el('bottom5-toplan');
  if (b5btn) b5btn.addEventListener('click', function() {
    V.newPlanForm = true;
    var sb = el('meeting-sidebar');
    if (sb) {
      sb.innerHTML = renderShellSidebar();
      wireSidebar();
    }
  });

  // Open new plan form (without bottom-5 trigger)
  var npOpen = el('open-newplan');
  if (npOpen) npOpen.addEventListener('click', function() {
    V.newPlanForm = true;
    var sb = el('meeting-sidebar');
    if (sb) {
      sb.innerHTML = renderShellSidebar();
      wireSidebar();
    }
  });

  wireNewPlanForm();
  wireEndMeeting();

  // Empty-state end button
  var emptyEnd = el('active-end-empty');
  if (emptyEnd) emptyEnd.addEventListener('click', endMeeting);
}

// Re-render just the sidebar (used after newPlanForm toggle)
function renderShellSidebar() {
  if (!V.binderData) return '';
  var recentEvents = V.binderData.events.slice(-3).reverse();
  var rosterWithStats = V.binderData.roster.map(function(s) {
    return Object.assign({}, s, computeStudentStats(s, recentEvents, V.binderData.scoresByCell));
  });
  rosterWithStats.sort(function(a, b) {
    if (a.avg === null && b.avg === null) return 0;
    if (a.avg === null) return 1;
    if (b.avg === null) return -1;
    return a.avg - b.avg;
  });
  var bottomN = rosterWithStats.filter(function(s) { return s.avg !== null; }).slice(0, 5);
  return renderBottomFive(bottomN, recentEvents[0]) +
         renderLastMeetingReview() +
         renderNewPlanSection(bottomN, recentEvents[0]) +
         renderEndMeeting();
}

function wireSidebar() {
  var b5btn = el('bottom5-toplan');
  if (b5btn) b5btn.addEventListener('click', function() {
    V.newPlanForm = true;
    var sb = el('meeting-sidebar');
    if (sb) { sb.innerHTML = renderShellSidebar(); wireSidebar(); }
  });
  var npOpen = el('open-newplan');
  if (npOpen) npOpen.addEventListener('click', function() {
    V.newPlanForm = true;
    var sb = el('meeting-sidebar');
    if (sb) { sb.innerHTML = renderShellSidebar(); wireSidebar(); }
  });
  wireNewPlanForm();
  wireEndMeeting();
}

function wireNewPlanForm() {
  var cancel = el('np-cancel');
  if (cancel) cancel.addEventListener('click', function() {
    V.newPlanForm = false;
    var sb = el('meeting-sidebar');
    if (sb) { sb.innerHTML = renderShellSidebar(); wireSidebar(); }
  });

  var save = el('np-save');
  if (save) save.addEventListener('click', function() {
    var errEl = el('np-err');
    if (errEl) errEl.style.display = 'none';

    var topic = (el('np-topic').value || '').trim();
    if (!topic) {
      if (errEl) { errEl.textContent = 'Topic is required.'; errEl.style.display = 'block'; }
      return;
    }
    var strategy = el('np-strategy').value || null;
    var checkDate = el('np-check').value || null;
    var description = (el('np-desc').value || '').trim() || null;

    var selectedIds = [];
    document.querySelectorAll('#np-students input[type=checkbox]:checked').forEach(function(c) {
      selectedIds.push(c.dataset.cid);
    });
    if (!selectedIds.length) {
      if (errEl) { errEl.textContent = 'Pick at least one student.'; errEl.style.display = 'block'; }
      return;
    }

    save.disabled = true; save.textContent = 'Saving…';

    var mostRecentEvent = V.binderData && V.binderData.events.length
      ? V.binderData.events[V.binderData.events.length - 1] : null;

    createActionPlan({
      data_meeting_id: V.meeting.id,
      topic: topic,
      source_assessment_event_id: mostRecentEvent ? mostRecentEvent.id : null,
      reteach_strategy: strategy,
      description: description,
      target_check_date: checkDate,
      school_year: SCHOOL_YEAR
    }, selectedIds, function(err, plan) {
      if (err) {
        save.disabled = false; save.textContent = 'Save plan';
        if (errEl) {
          errEl.textContent = 'Could not save: ' + ((err && err.message) || 'unknown');
          errEl.style.display = 'block';
        }
        return;
      }
      V.newPlanForm = false;
      showToast('Plan saved', 'info', 1500);
      var sb = el('meeting-sidebar');
      if (sb) { sb.innerHTML = renderShellSidebar(); wireSidebar(); }
    });
  });
}

function wireEndMeeting() {
  var btn = el('end-meeting');
  if (!btn) return;
  btn.addEventListener('click', endMeeting);
}

function endMeeting() {
  if (!V.meeting) {
    V.phase = 'ended';
    renderShell();
    return;
  }
  var btn = el('end-meeting');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  updateDataMeeting(V.meeting.id, {
    agenda_notes: V.agendaNotes || null
  }, function(err) {
    if (err) {
      showToast('Could not save meeting notes', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'End meeting & save'; }
      return;
    }
    V.phase = 'ended';
    showToast('Meeting saved', 'info', 1500);
    renderShell();
  });
}

// ── ENDED PHASE ─────────────────────────────────────────────────────────────
function renderEnded() {
  return '<div class="card" style="padding:32px;text-align:center;max-width:420px;margin:0 auto">' +
    '<div style="font-size:36px;margin-bottom:8px">✓</div>' +
    '<div style="font-size:16px;font-weight:700;margin-bottom:4px">Meeting saved</div>' +
    '<div style="font-size:12px;color:var(--text2);margin-bottom:18px">' +
      'Your meeting record and action plans are stored. ' +
      'Track progress in the Action Plans view.' +
    '</div>' +
    '<button id="ended-back" class="btn-primary">Back to Academics</button>' +
  '</div>';
}

// ── DATA LOAD ───────────────────────────────────────────────────────────────
function loadActiveData() {
  V.loading = true;
  renderShell();

  // Pull last 4 weeks of assessments for context, plus active plans from
  // the previous meeting for this grade/subject.
  var dateFrom = isoDaysAgo(28);
  var binderP = fetchBinderData({
    gradeLevel: V.gradeLevel,
    subject: V.subject,
    schoolYear: SCHOOL_YEAR,
    dateFrom: dateFrom,
    limit: 15
  });
  // Previous meeting's plans = active plans tagged to the most recent
  // PREVIOUS meeting for this grade/subject. For V1, simpler: just all
  // currently-active plans matching this grade/subject context (via
  // checking if any of their target students are in this grade roster).
  // For now, just pull all active plans by school year — sidebar shows
  // them. Future PR: filter by grade/subject.
  var plansP = fetchActionPlans({
    status: 'active',
    schoolYear: SCHOOL_YEAR,
    limit: 50
  });

  Promise.all([binderP, plansP]).then(function(results) {
    V.binderData = results[0];
    var allActive = results[1];
    // Filter active plans to those whose target students are in this grade's roster
    var rosterIds = {};
    (V.binderData.roster || []).forEach(function(s) { rosterIds[s.clever_id] = true; });
    V.lastMeetingPlans = (allActive || []).filter(function(p) {
      var rels = p.action_plan_students || [];
      return rels.some(function(r) { return rosterIds[r.clever_id]; });
    });
    V.loading = false;
    renderShell();
  }).catch(function() {
    V.loading = false;
    showToast('Could not load meeting data', 'error');
    renderShell();
  });
}

// ── COMPUTED ────────────────────────────────────────────────────────────────
function computeStudentStats(student, events, scoresByCell) {
  var pcts = [];
  events.forEach(function(e) {
    var key = student.clever_id + '|' + e.id;
    var s = scoresByCell[key];
    if (s && s.score !== null && s.score !== undefined) {
      var max = Number(e.max_score) || 100;
      pcts.push((Number(s.score) / max) * 100);
    }
  });
  if (!pcts.length) return { avg: null };
  var sum = pcts.reduce(function(a, p) { return a + p; }, 0);
  return { avg: sum / pcts.length };
}

// ── UTIL ────────────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function niceName(s) {
  if (s.first_name && s.last_name) return s.first_name + ' ' + s.last_name;
  return s.student_name || s.clever_id || '?';
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    var d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch (e) { return dateStr; }
}

function isoDaysAgo(n) {
  var d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function nextTuesdayISO() {
  var d = new Date();
  var day = d.getDay(); // 0=Sun ... 2=Tue
  var add = (2 - day + 7) % 7;
  if (add === 0) add = 7; // if today is Tue, next Tue is a week away
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}

// Re-render handler for "back to academics" button on ended phase
document.addEventListener('click', function(e) {
  if (e.target && e.target.id === 'ended-back') {
    // Defer to main's back wiring
    var back = document.getElementById('btn-meeting-back');
    if (back) back.click();
  }
});
