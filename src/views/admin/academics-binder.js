// ─────────────────────────────────────────────────────────────────────────────
// Academics · Data Binder Grid
//
// V1 week 3. The grid that replaces the printed spreadsheet a grade team
// brings to their Tuesday DDI meeting. Students × assessments matrix,
// color-coded cells, lowest performers at top by default.
//
// Layout:
//   - Sticky leftmost column: student name + homeroom
//   - Scrollable middle: one column per assessment_event
//   - Sticky rightmost column: student average + trend arrow
//   - Sticky top row: assessment title + date + class avg footer
//
// Interactions:
//   - Click any cell → small popup with score, who entered it, notes
//   - Click student name → opens existing student profile
//   - Sort selector: lowest first (default), alphabetical, trending down
//   - Filter chips: subject, date range, grade
//   - Print: separate print stylesheet for the holdouts
// ─────────────────────────────────────────────────────────────────────────────

import {
  showScreen, showToast, emptyState,
  skeletonRows, escHtml, openStudent
} from '../../main.js';
import { fetchBinderData } from '../../api/academics.js';

var SCHOOL_YEAR = import.meta.env.VITE_SCHOOL_YEAR || '2025-26';
var SUBJECTS = ['all', 'math', 'reading', 'writing', 'science', 'social_studies'];
var GRADES   = ['K', '1', '2', '3', '4', '5'];
var DATE_RANGES = [
  { key: '4wk', label: 'Last 4 weeks' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' }
];
var SORT_MODES = [
  { key: 'lowest', label: 'Lowest first' },
  { key: 'alpha', label: 'A–Z' },
  { key: 'trending_down', label: 'Trending down' }
];

// View state — one binder open at a time.
var V = {
  gradeLevel: '3',          // sensible default; teacher can change
  subject: 'all',
  dateRange: 'quarter',
  sortMode: 'lowest',
  data: null,               // { events, roster, scoresByCell }
  loading: false
};

// ── PUBLIC ENTRY POINT ──────────────────────────────────────────────────────
export function openAcademicsBinder() {
  showScreen('S-academics-binder');
  renderShell();
  loadData();
}

// ── RENDER ──────────────────────────────────────────────────────────────────
function renderShell() {
  var body = el('binder-body');
  if (!body) return;
  body.innerHTML =
    '<div class="card" id="binder-filters">' + renderFilters() + '</div>' +
    '<div id="binder-grid-wrap" style="margin-top:12px">' +
      (V.loading
        ? '<div class="card">' + skeletonRows(8) + '</div>'
        : V.data
          ? renderGrid()
          : renderEmpty()
      ) +
    '</div>';
  wireFilters();
  if (V.data && !V.loading) wireGrid();
}

function renderFilters() {
  function chipRow(items, currentKey, dataAttr) {
    return items.map(function(item) {
      var key = item.key || item;
      var label = item.label || item;
      var on = currentKey === key;
      return '<button class="binder-chip" ' +
        'data-' + dataAttr + '="' + escHtml(key) + '" ' +
        'style="font-size:11px;padding:5px 10px;border-radius:14px;margin:3px 4px 3px 0;cursor:pointer;' +
          'border:1px solid ' + (on ? 'var(--navy)' : 'var(--border)') + ';' +
          'background:' + (on ? 'rgba(39,26,112,.12)' : 'transparent') + ';' +
          'color:' + (on ? 'var(--navy)' : 'var(--text2)') + '">' +
        escHtml(label) + '</button>';
    }).join('');
  }

  return '<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start">' +
    '<div>' +
      filterLabel('Grade') +
      chipRow(GRADES, V.gradeLevel, 'grade') +
    '</div>' +
    '<div>' +
      filterLabel('Subject') +
      chipRow(SUBJECTS, V.subject, 'subject') +
    '</div>' +
    '<div>' +
      filterLabel('Date range') +
      chipRow(DATE_RANGES, V.dateRange, 'range') +
    '</div>' +
    '<div>' +
      filterLabel('Sort') +
      chipRow(SORT_MODES, V.sortMode, 'sort') +
    '</div>' +
    '<div style="margin-left:auto">' +
      '<button id="binder-print-btn" class="btn-secondary" style="font-size:11px;padding:5px 12px">Print</button>' +
    '</div>' +
  '</div>';
}

function filterLabel(text) {
  return '<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">' +
    text + '</div>';
}

function renderEmpty() {
  return emptyState(
    'No data for this view',
    'Pick a grade and subject above. If you\'ve never entered scores for that combination, head to "Enter Scores" first.'
  );
}

function renderGrid() {
  var d = V.data;
  if (!d.roster.length) {
    return emptyState(
      'No students in Grade ' + V.gradeLevel,
      'Check that students are rostered for this grade in the current school year.'
    );
  }
  if (!d.events.length) {
    return emptyState(
      'No assessments yet',
      'No assessments have been logged for Grade ' + V.gradeLevel +
      (V.subject !== 'all' ? ' ' + V.subject : '') +
      ' in this date range. Create one from "Enter Scores".'
    );
  }

  // Compute per-student averages and sort
  var rosterWithStats = d.roster.map(function(s) {
    var stats = computeStudentStats(s, d.events, d.scoresByCell);
    return Object.assign({}, s, stats);
  });
  rosterWithStats.sort(buildSortFn(V.sortMode));

  // Compute per-event class averages
  var eventStats = d.events.map(function(e) {
    return computeEventStats(e, d.roster, d.scoresByCell);
  });

  // Build the grid HTML
  var nameColWidth = '170px';
  var statsColWidth = '70px';
  var cellWidth = '70px';

  var header =
    '<thead><tr>' +
      '<th class="binder-th binder-sticky-left" style="width:' + nameColWidth + ';min-width:' + nameColWidth + '">Scholar</th>' +
      d.events.map(function(e) {
        return '<th class="binder-th" style="width:' + cellWidth + ';min-width:' + cellWidth + '" ' +
          'title="' + escHtml(e.title) + (e.topic ? ' · ' + escHtml(e.topic) : '') + '">' +
          '<div class="binder-event-title">' + escHtml(truncate(e.title, 22)) + '</div>' +
          '<div class="binder-event-meta">' + escHtml(formatDate(e.administered_date)) + '</div>' +
        '</th>';
      }).join('') +
      '<th class="binder-th binder-sticky-right" style="width:' + statsColWidth + ';min-width:' + statsColWidth + '">Avg</th>' +
    '</tr></thead>';

  var bodyRows = rosterWithStats.map(function(s) {
    return '<tr>' +
      '<td class="binder-td binder-sticky-left binder-name-cell">' +
        '<div class="binder-name">' +
          '<span class="stu-name-link" data-stu="' + escHtml(s.student_name || (s.first_name + ' ' + s.last_name)) + '">' +
            escHtml(s.last_name ? (s.last_name + ', ' + (s.first_name || '')) : (s.student_name || '—')) +
          '</span>' +
        '</div>' +
        '<div class="binder-homeroom">' + escHtml(s.homeroom || '—') + '</div>' +
      '</td>' +
      d.events.map(function(e) {
        var cellKey = s.clever_id + '|' + e.id;
        var score = d.scoresByCell[cellKey];
        return renderCell(score, e, s);
      }).join('') +
      '<td class="binder-td binder-sticky-right binder-stats-cell">' +
        renderStudentStats(s) +
      '</td>' +
    '</tr>';
  }).join('');

  var footerRow =
    '<tr class="binder-footer-row">' +
      '<td class="binder-td binder-sticky-left binder-footer-label">Class avg</td>' +
      eventStats.map(function(es) {
        return '<td class="binder-td binder-footer-cell">' +
          '<div class="binder-footer-avg">' + (es.avg !== null ? Math.round(es.avg) : '—') + '</div>' +
          '<div class="binder-footer-meta">' + es.greenPct + '% ✓</div>' +
        '</td>';
      }).join('') +
      '<td class="binder-td binder-sticky-right">&nbsp;</td>' +
    '</tr>';

  var legend =
    '<div style="display:flex;gap:14px;align-items:center;margin:8px 0 4px;font-size:10px;color:var(--text3)">' +
      '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#4ABFA3;margin-right:4px;vertical-align:middle"></span>Meeting (≥80%)</span>' +
      '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#E8C547;margin-right:4px;vertical-align:middle"></span>Approaching (60–79%)</span>' +
      '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#D63B3B;margin-right:4px;vertical-align:middle"></span>Below (&lt;60%)</span>' +
      '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:transparent;border:1px dashed var(--text3);margin-right:4px;vertical-align:middle"></span>Absent</span>' +
      '<span style="margin-left:auto">' + rosterWithStats.length + ' scholars · ' + d.events.length + ' assessments</span>' +
    '</div>';

  return legend +
    '<div class="binder-scroll-wrap card" style="padding:0;overflow:auto;max-width:100%">' +
      '<table class="binder-table" style="border-collapse:collapse;width:auto">' +
        header +
        '<tbody>' + bodyRows + footerRow + '</tbody>' +
      '</table>' +
    '</div>' +
    renderBinderStyles();
}

function renderCell(score, event, student) {
  var max = Number(event.max_score) || 100;
  var thresholds = event.proficiency_thresholds || { red: 60, yellow: 80 };

  if (!score) {
    // Not yet assessed — distinct from absent
    return '<td class="binder-td binder-cell" data-cleverid="' + escHtml(student.clever_id) + '" data-eventid="' + escHtml(event.id) + '">' +
      '<div class="binder-cell-empty">—</div>' +
    '</td>';
  }

  if (score.score === null || score.score === undefined) {
    // Explicitly absent
    return '<td class="binder-td binder-cell binder-cell-absent" data-cleverid="' + escHtml(student.clever_id) + '" data-eventid="' + escHtml(event.id) + '" data-scoreid="' + escHtml(score.id) + '" title="Absent">' +
      '<div class="binder-cell-content">ABS</div>' +
    '</td>';
  }

  var pct = (Number(score.score) / max) * 100;
  var bgColor = pct < thresholds.red ? 'rgba(214, 59, 59, .18)'
              : pct < thresholds.yellow ? 'rgba(232, 197, 71, .20)'
              : 'rgba(74, 191, 163, .20)';
  var fgColor = pct < thresholds.red ? '#a82828'
              : pct < thresholds.yellow ? '#8a7314'
              : '#287f6c';

  var hasNotes = score.notes && score.notes.trim().length > 0;
  var noteDot = hasNotes ? '<span class="binder-note-dot" title="Has notes">·</span>' : '';

  return '<td class="binder-td binder-cell binder-cell-scored" ' +
    'data-cleverid="' + escHtml(student.clever_id) + '" ' +
    'data-eventid="' + escHtml(event.id) + '" ' +
    'data-scoreid="' + escHtml(score.id) + '" ' +
    'style="background:' + bgColor + '" ' +
    'title="' + escHtml(score.score) + '/' + escHtml(max) + ' (' + Math.round(pct) + '%)' +
    (hasNotes ? ' · ' + escHtml(score.notes) : '') + '">' +
    '<div class="binder-cell-content" style="color:' + fgColor + '">' +
      escHtml(score.score) + noteDot +
    '</div>' +
  '</td>';
}

function renderStudentStats(s) {
  if (s.avg === null) {
    return '<div class="binder-stat-empty">—</div>';
  }
  var trend = s.trend;
  var trendIcon = trend > 5 ? '↑' : trend < -5 ? '↓' : '→';
  var trendColor = trend > 5 ? '#287f6c' : trend < -5 ? '#a82828' : 'var(--text3)';
  return '<div class="binder-stat-avg">' + Math.round(s.avg) + '%</div>' +
         '<div class="binder-stat-trend" style="color:' + trendColor + '">' + trendIcon + '</div>';
}

function renderBinderStyles() {
  // Inline because the binder is the only consumer. Easier to keep
  // self-contained than scattering across a global stylesheet.
  return '<style>' +
    '.binder-table { font-size:12px; }' +
    '.binder-th, .binder-td { padding:6px 8px; border-bottom:1px solid var(--border); border-right:1px solid var(--border); text-align:center; vertical-align:middle; }' +
    '.binder-th { background:var(--panel); font-weight:600; font-size:10px; color:var(--text2); position:sticky; top:0; z-index:2; }' +
    '.binder-sticky-left { position:sticky; left:0; background:var(--bg); z-index:3; text-align:left; box-shadow:1px 0 0 var(--border); }' +
    '.binder-sticky-right { position:sticky; right:0; background:var(--bg); z-index:3; box-shadow:-1px 0 0 var(--border); }' +
    '.binder-th.binder-sticky-left, .binder-th.binder-sticky-right { z-index:4; background:var(--panel); }' +
    '.binder-event-title { font-weight:600; }' +
    '.binder-event-meta { font-size:9px; color:var(--text3); font-weight:400; margin-top:1px; }' +
    '.binder-name { font-weight:600; color:var(--text); font-size:12px; }' +
    '.binder-homeroom { font-size:10px; color:var(--text3); margin-top:1px; }' +
    '.binder-cell { font-family:Inter,sans-serif; font-weight:600; cursor:pointer; }' +
    '.binder-cell:hover { outline:2px solid var(--navy); outline-offset:-2px; }' +
    '.binder-cell-content { font-size:13px; }' +
    '.binder-cell-empty { color:var(--text3); font-weight:400; }' +
    '.binder-cell-absent .binder-cell-content { color:var(--text3); font-style:italic; font-size:10px; }' +
    '.binder-note-dot { color:var(--navy); font-weight:900; margin-left:1px; }' +
    '.binder-footer-row .binder-td { background:var(--panel); font-weight:600; border-top:2px solid var(--border); }' +
    '.binder-footer-label { text-align:left; font-size:11px; color:var(--text2); text-transform:uppercase; letter-spacing:.06em; }' +
    '.binder-footer-avg { font-size:13px; color:var(--text); }' +
    '.binder-footer-meta { font-size:9px; color:var(--text3); font-weight:400; margin-top:1px; }' +
    '.binder-stat-avg { font-size:14px; font-weight:700; }' +
    '.binder-stat-trend { font-size:14px; font-weight:700; margin-top:-2px; }' +
    '.binder-stat-empty { color:var(--text3); }' +
    '@media print {' +
      '.topbar, #binder-filters, .binder-chip { display:none !important; }' +
      '.binder-scroll-wrap { overflow:visible !important; }' +
      '.binder-table { font-size:9px; }' +
      '.binder-th, .binder-td { padding:3px 4px; }' +
    '}' +
  '</style>';
}

// ── COMPUTED ────────────────────────────────────────────────────────────────
function computeStudentStats(student, events, scoresByCell) {
  // Per-student avg = mean of all non-absent percent scores
  // Trend = avg of last 3 - avg of prior 3 (if enough events)
  var pcts = [];
  events.forEach(function(e) {
    var key = student.clever_id + '|' + e.id;
    var s = scoresByCell[key];
    if (s && s.score !== null && s.score !== undefined) {
      var max = Number(e.max_score) || 100;
      pcts.push({ pct: (Number(s.score) / max) * 100, date: e.administered_date });
    }
  });
  if (!pcts.length) return { avg: null, trend: 0 };
  // Sort by date ascending (already mostly true since events are sorted)
  pcts.sort(function(a, b) { return a.date < b.date ? -1 : 1; });
  var sum = pcts.reduce(function(a, p) { return a + p.pct; }, 0);
  var avg = sum / pcts.length;
  var trend = 0;
  if (pcts.length >= 4) {
    var n = Math.min(3, Math.floor(pcts.length / 2));
    var recent = pcts.slice(-n);
    var prior  = pcts.slice(-2 * n, -n);
    var rAvg = recent.reduce(function(a, p) { return a + p.pct; }, 0) / recent.length;
    var pAvg = prior.reduce(function(a, p) { return a + p.pct; }, 0) / prior.length;
    trend = rAvg - pAvg;
  }
  return { avg: avg, trend: trend };
}

function computeEventStats(event, roster, scoresByCell) {
  var scores = [];
  var greenCount = 0;
  var thresholds = event.proficiency_thresholds || { red: 60, yellow: 80 };
  var max = Number(event.max_score) || 100;
  roster.forEach(function(s) {
    var key = s.clever_id + '|' + event.id;
    var sc = scoresByCell[key];
    if (sc && sc.score !== null && sc.score !== undefined) {
      var pct = (Number(sc.score) / max) * 100;
      scores.push(pct);
      if (pct >= thresholds.yellow) greenCount++;
    }
  });
  if (!scores.length) return { avg: null, greenPct: 0, count: 0 };
  var avg = scores.reduce(function(a, p) { return a + p; }, 0) / scores.length;
  return {
    avg: avg,
    greenPct: Math.round((greenCount / scores.length) * 100),
    count: scores.length
  };
}

function buildSortFn(mode) {
  if (mode === 'alpha') {
    return function(a, b) {
      return (a.last_name || '').localeCompare(b.last_name || '');
    };
  }
  if (mode === 'trending_down') {
    return function(a, b) {
      // Most-negative trend first; null avg goes to end
      if (a.avg === null && b.avg === null) return 0;
      if (a.avg === null) return 1;
      if (b.avg === null) return -1;
      return (a.trend || 0) - (b.trend || 0);
    };
  }
  // Default: lowest first
  return function(a, b) {
    if (a.avg === null && b.avg === null) return 0;
    if (a.avg === null) return 1;
    if (b.avg === null) return -1;
    return a.avg - b.avg;
  };
}

// ── WIRING ──────────────────────────────────────────────────────────────────
function wireFilters() {
  document.querySelectorAll('#binder-filters [data-grade]').forEach(function(b) {
    b.addEventListener('click', function() { V.gradeLevel = b.dataset.grade; loadData(); });
  });
  document.querySelectorAll('#binder-filters [data-subject]').forEach(function(b) {
    b.addEventListener('click', function() { V.subject = b.dataset.subject; loadData(); });
  });
  document.querySelectorAll('#binder-filters [data-range]').forEach(function(b) {
    b.addEventListener('click', function() { V.dateRange = b.dataset.range; loadData(); });
  });
  document.querySelectorAll('#binder-filters [data-sort]').forEach(function(b) {
    b.addEventListener('click', function() {
      V.sortMode = b.dataset.sort;
      // Sort is client-side; just re-render
      var card = el('binder-filters');
      if (card) card.innerHTML = renderFilters();
      wireFilters();
      var wrap = el('binder-grid-wrap');
      if (wrap) wrap.innerHTML = renderGrid();
      wireGrid();
    });
  });
  var printBtn = el('binder-print-btn');
  if (printBtn) printBtn.addEventListener('click', function() { window.print(); });
}

function wireGrid() {
  // Student names
  document.querySelectorAll('#binder-grid-wrap .stu-name-link').forEach(function(link) {
    link.addEventListener('click', function(e) {
      e.stopPropagation();
      openStudent(link.dataset.stu, 'S-academics-binder');
    });
  });
  // Cell click → drill popover
  document.querySelectorAll('#binder-grid-wrap .binder-cell-scored, #binder-grid-wrap .binder-cell-absent').forEach(function(cell) {
    cell.addEventListener('click', function(e) {
      e.stopPropagation();
      showCellDrill(cell);
    });
  });
}

// ── CELL DRILL POPOVER ──────────────────────────────────────────────────────
function showCellDrill(cell) {
  closeCellDrill();
  var cleverId = cell.dataset.cleverid;
  var eventId  = cell.dataset.eventid;
  if (!cleverId || !eventId || !V.data) return;
  var student = V.data.roster.find(function(s) { return s.clever_id === cleverId; });
  var event   = V.data.events.find(function(e) { return e.id === eventId; });
  var score   = V.data.scoresByCell[cleverId + '|' + eventId];
  if (!student || !event || !score) return;

  var rect = cell.getBoundingClientRect();
  var pop = document.createElement('div');
  pop.id = 'binder-drill-pop';
  pop.style.cssText = 'position:fixed;z-index:300;background:var(--bg);border:1px solid var(--navy);' +
    'border-radius:6px;padding:10px 12px;min-width:220px;max-width:320px;' +
    'box-shadow:0 4px 12px rgba(0,0,0,.15);font-size:12px';
  // Position below cell; flip up if near bottom
  var top = rect.bottom + window.scrollY + 4;
  var maxTop = window.innerHeight + window.scrollY - 160;
  if (top > maxTop) top = rect.top + window.scrollY - 170;
  pop.style.top  = top + 'px';
  pop.style.left = Math.max(8, Math.min(window.innerWidth - 340, rect.left)) + 'px';

  var name = (student.first_name && student.last_name)
    ? student.first_name + ' ' + student.last_name
    : student.student_name;
  var max = Number(event.max_score) || 100;
  var pct = score.score !== null && score.score !== undefined
    ? Math.round((Number(score.score) / max) * 100) + '%'
    : 'Absent';

  pop.innerHTML =
    '<div style="font-weight:700;font-size:13px;margin-bottom:2px">' + escHtml(name) + '</div>' +
    '<div style="font-size:10px;color:var(--text3);margin-bottom:8px">' +
      escHtml(event.title) + (event.topic ? ' · ' + escHtml(event.topic) : '') +
    '</div>' +
    '<div style="display:flex;gap:14px;margin-bottom:8px">' +
      '<div><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Score</div>' +
        '<div style="font-size:18px;font-weight:700">' +
          (score.score !== null && score.score !== undefined ? score.score + '/' + max : 'ABS') +
        '</div></div>' +
      '<div><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Percent</div>' +
        '<div style="font-size:18px;font-weight:700">' + pct + '</div></div>' +
    '</div>' +
    (score.notes ?
      '<div style="font-size:11px;color:var(--text2);padding:6px 8px;background:var(--panel);border-radius:4px;margin-bottom:6px">' +
        escHtml(score.notes) +
      '</div>' : '') +
    '<div style="font-size:9px;color:var(--text3)">' +
      'Entered ' + escHtml(formatDateTime(score.recorded_at)) +
      (score.recorded_by ? ' by ' + escHtml(score.recorded_by) : '') +
    '</div>' +
    '<button id="binder-drill-close" style="position:absolute;top:4px;right:6px;border:0;background:transparent;cursor:pointer;font-size:14px;color:var(--text3)">×</button>';
  document.body.appendChild(pop);

  document.getElementById('binder-drill-close').addEventListener('click', closeCellDrill);
  // Click outside to close
  setTimeout(function() {
    document.addEventListener('click', closeCellDrillOnOutsideClick, { once: true });
  }, 0);
}

function closeCellDrillOnOutsideClick(e) {
  var pop = document.getElementById('binder-drill-pop');
  if (pop && !pop.contains(e.target)) closeCellDrill();
}

function closeCellDrill() {
  var pop = document.getElementById('binder-drill-pop');
  if (pop) pop.remove();
}

// ── DATA LOAD ───────────────────────────────────────────────────────────────
function loadData() {
  V.loading = true;
  V.data = null;
  renderShell();

  var dateOpts = buildDateRange(V.dateRange);
  fetchBinderData({
    gradeLevel: V.gradeLevel,
    subject: V.subject === 'all' ? null : V.subject,
    schoolYear: SCHOOL_YEAR,
    dateFrom: dateOpts.from,
    dateTo: dateOpts.to,
    limit: 50
  }, function(err, data) {
    V.loading = false;
    if (err && !data) {
      showToast('Could not load binder data', 'error');
      V.data = { events: [], roster: [], scoresByCell: {} };
    } else {
      V.data = data;
    }
    updateSub();
    var wrap = el('binder-grid-wrap');
    if (wrap) wrap.innerHTML = renderGrid();
    wireGrid();
  });
}

function buildDateRange(key) {
  var today = new Date();
  var iso = function(d) { return d.toISOString().slice(0, 10); };
  if (key === '4wk') {
    var d = new Date(today); d.setDate(d.getDate() - 28);
    return { from: iso(d), to: iso(today) };
  }
  if (key === 'quarter') {
    var d2 = new Date(today); d2.setDate(d2.getDate() - 90);
    return { from: iso(d2), to: iso(today) };
  }
  if (key === 'year') {
    var d3 = new Date(today); d3.setDate(d3.getDate() - 365);
    return { from: iso(d3), to: iso(today) };
  }
  return { from: null, to: null };
}

function updateSub() {
  var sub = el('binder-sub');
  if (!sub) return;
  if (!V.data) { sub.textContent = 'Loading…'; return; }
  var n = V.data.roster.length;
  var e = V.data.events.length;
  sub.textContent = 'Grade ' + V.gradeLevel + ' · ' +
    (V.subject === 'all' ? 'all subjects' : V.subject) + ' · ' +
    n + ' scholars · ' + e + ' assessments';
}

// ── UTIL ────────────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

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

function formatDateTime(ts) {
  if (!ts) return '';
  try {
    var d = new Date(ts);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (e) { return ts; }
}
