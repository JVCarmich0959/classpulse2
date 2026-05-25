// ─────────────────────────────────────────────────────────────────────────────
// Academics · Score Entry
//
// V1 hero feature. Replaces the spreadsheet a teacher uses to record exit
// ticket / quiz scores before the Tuesday data meeting.
//
// Design target: a teacher enters 25 scores in under 90 seconds.
//
// Features:
//   - Pick a recent assessment OR create one inline
//   - Roster grouped by homeroom
//   - Keyboard-driven: Tab / Enter / Shift+Tab moves between students
//   - Type 'a' (or the 'Absent' button) to mark absent (score=null)
//   - Esc clears the field
//   - Bulk paste: paste a column of scores from Excel, distributed in roster order
//   - Auto-save on blur (with 200ms debounce against tab spam)
//   - Optimistic UI: score appears + colored immediately, rollback + toast on error
// ─────────────────────────────────────────────────────────────────────────────

import {
  SESSION, showScreen, showToast, emptyState,
  skeletonRows, escHtml
} from '../../main.js';
import {
  fetchAssessmentEvents, createAssessmentEvent,
  fetchRosterByGrade, fetchScoresForAssessment,
  upsertScore, deleteScore, computeProficiency
} from '../../api/academics.js';

var SCHOOL_YEAR = import.meta.env.VITE_SCHOOL_YEAR || '2025-26';
var SUBJECTS = ['math', 'reading', 'writing', 'science', 'social_studies'];
var GRADES   = ['K', '1', '2', '3', '4', '5'];

// View-level state (one entry session at a time).
var V = {
  currentEvent: null,   // the assessment being scored
  recent: [],           // recent assessment events for picker
  roster: [],           // students for current event's grade
  scores: {},           // clever_id -> saved score row
  pending: {},          // clever_id -> save debounce timer
  errors: {},           // clever_id -> error message string
  showNewForm: false    // is the create-assessment form open?
};

// ── PUBLIC ENTRY POINT ──────────────────────────────────────────────────────
export function openAcademicsEntry() {
  showScreen('S-academics');
  V.currentEvent = null;
  V.roster = [];
  V.scores = {};
  V.pending = {};
  V.errors = {};
  V.showNewForm = false;
  renderShell();
  loadRecentEvents();
}

// ── RENDER ──────────────────────────────────────────────────────────────────
function renderShell() {
  var body = el('acad-body');
  if (!body) return;
  body.innerHTML =
    '<div class="card" id="acad-picker-card">' +
      renderPicker() +
    '</div>' +
    '<div id="acad-newform-wrap">' +
      (V.showNewForm ? renderNewForm() : '') +
    '</div>' +
    '<div id="acad-roster-wrap" style="margin-top:12px">' +
      (V.currentEvent ? renderRoster() : renderEmpty()) +
    '</div>';
  wirePicker();
  if (V.showNewForm) wireNewForm();
  if (V.currentEvent) wireRoster();
  updateSub();
}

function updateSub() {
  var sub = el('acad-sub');
  if (!sub) return;
  if (V.currentEvent) {
    var e = V.currentEvent;
    var savedCount = Object.values(V.scores).filter(function(s) { return s && s.score !== null && s.score !== undefined; }).length;
    sub.textContent = e.subject + ' · Grade ' + e.grade_level + ' · ' +
      savedCount + '/' + V.roster.length + ' entered';
  } else {
    sub.textContent = 'Pick an assessment or create one';
  }
}

function renderPicker() {
  var newBtn =
    '<button id="acad-new-btn" class="btn-primary" ' +
      'style="padding:10px 16px;font-weight:600">' +
      (V.showNewForm ? '× Cancel' : '+ New Assessment') +
    '</button>';

  if (!V.recent.length) {
    return '<div style="display:flex;justify-content:space-between;align-items:center">' +
      '<div style="font-size:13px;color:var(--text2)">No recent assessments. Create one to start.</div>' +
      newBtn +
    '</div>';
  }

  var chips = V.recent.slice(0, 8).map(function(e) {
    var active = V.currentEvent && V.currentEvent.id === e.id;
    var label = escHtml(e.title) + ' · G' + escHtml(e.grade_level);
    return '<button class="acad-chip' + (active ? ' on' : '') + '" data-event-id="' + e.id + '" ' +
      'style="font-size:11px;padding:6px 10px;border-radius:14px;' +
        'border:1px solid ' + (active ? 'var(--navy)' : 'var(--border)') + ';' +
        'background:' + (active ? 'rgba(39,26,112,.12)' : 'transparent') + ';' +
        'color:' + (active ? 'var(--navy)' : 'var(--text2)') + ';' +
        'margin:3px 4px 3px 0;cursor:pointer">' +
      label + '</button>';
  }).join('');

  return '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">' +
    '<div style="flex:1">' +
      '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Recent</div>' +
      '<div>' + chips + '</div>' +
    '</div>' +
    '<div>' + newBtn + '</div>' +
  '</div>';
}

function renderNewForm() {
  var todayDefault = new Date().toISOString().slice(0, 10);
  return '<div class="card" style="margin-top:10px;border:1px solid var(--navy)">' +
    '<div style="font-size:13px;font-weight:600;margin-bottom:10px">New Assessment</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      formField('Title', '<input id="naf-title" class="input" placeholder="Week 6 Exit Ticket — Main Idea" style="width:100%">') +
      formField('Topic', '<input id="naf-topic" class="input" placeholder="Main Idea" style="width:100%">') +
      formField('Subject',
        '<select id="naf-subject" class="input" style="width:100%">' +
          SUBJECTS.map(function(s) { return '<option value="' + s + '">' + s + '</option>'; }).join('') +
        '</select>') +
      formField('Grade',
        '<select id="naf-grade" class="input" style="width:100%">' +
          GRADES.map(function(g) { return '<option value="' + g + '">' + g + '</option>'; }).join('') +
        '</select>') +
      formField('Date', '<input id="naf-date" type="date" class="input" value="' + todayDefault + '" style="width:100%">') +
      formField('Max score', '<input id="naf-max" type="number" class="input" value="100" min="1" style="width:100%">') +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">' +
      '<button id="naf-cancel" class="btn-secondary">Cancel</button>' +
      '<button id="naf-save" class="btn-primary">Create &amp; start entering</button>' +
    '</div>' +
    '<div id="naf-error" style="font-size:11px;color:var(--red);margin-top:8px;display:none"></div>' +
  '</div>';
}

function formField(label, inputHtml) {
  return '<div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">' +
    label + '</div>' + inputHtml + '</div>';
}

function renderEmpty() {
  return emptyState(
    'No assessment selected',
    'Pick a recent assessment above or click "+ New Assessment" to start entering scores.'
  );
}

function renderRoster() {
  if (!V.roster.length) {
    return emptyState(
      'No students in Grade ' + V.currentEvent.grade_level,
      'Check that students are rostered for this grade in the current school year.'
    );
  }

  // Group by homeroom for readability
  var groups = {};
  var groupOrder = [];
  V.roster.forEach(function(s) {
    var hr = s.homeroom || '—';
    if (!groups[hr]) { groups[hr] = []; groupOrder.push(hr); }
    groups[hr].push(s);
  });

  var toolbar =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
      '<div style="font-size:11px;color:var(--text3)">' +
        'Max ' + (V.currentEvent.max_score || 100) +
        ' · Type score and Tab. Type <kbd style="background:var(--panel);border:1px solid var(--border);padding:1px 5px;border-radius:3px">A</kbd> for absent.' +
      '</div>' +
      '<button id="acad-bulk-btn" class="btn-secondary" style="font-size:11px;padding:4px 10px">Bulk paste</button>' +
    '</div>';

  var groupsHtml = groupOrder.map(function(hr) {
    var rows = groups[hr].map(function(s) { return renderRow(s); }).join('');
    return '<div class="acad-group" style="margin-bottom:14px">' +
      '<div class="date-grp-hdr" style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em">' +
        escHtml(hr) +
      '</div>' +
      '<div class="card" style="padding:4px 0">' + rows + '</div>' +
    '</div>';
  }).join('');

  return toolbar + groupsHtml;
}

function renderRow(student) {
  var saved = V.scores[student.clever_id];
  var pending = !!V.pending[student.clever_id];
  var err = V.errors[student.clever_id];

  var scoreVal = '';
  var isAbsent = false;
  if (saved) {
    if (saved.score === null || saved.score === undefined) {
      isAbsent = true;
    } else {
      scoreVal = String(saved.score);
    }
  }

  var prof = saved ? saved.proficiency : null;
  var dot = profDot(prof, isAbsent);
  var statusIcon = pending
    ? '<span style="font-size:10px;color:var(--text3)" title="Saving…">…</span>'
    : err
      ? '<span style="font-size:10px;color:var(--red)" title="' + escHtml(err) + '">!</span>'
      : saved && !isAbsent
        ? '<span style="font-size:10px;color:var(--green,#4ABFA3)" title="Saved">✓</span>'
        : '<span style="font-size:10px;color:var(--text3)">&nbsp;</span>';

  var name = (student.first_name && student.last_name)
    ? student.first_name + ' ' + student.last_name
    : (student.student_name || '—');

  return '<div class="acad-row" data-clever-id="' + escHtml(student.clever_id) + '" ' +
    'style="display:grid;grid-template-columns:1fr 110px 28px 22px;gap:8px;align-items:center;padding:6px 12px;border-bottom:1px solid var(--border)">' +
    '<div style="font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
      escHtml(name) +
    '</div>' +
    '<div style="display:flex;gap:4px;align-items:center">' +
      '<input class="acad-score-input input" type="text" inputmode="numeric" ' +
        'data-clever-id="' + escHtml(student.clever_id) + '" ' +
        'value="' + escHtml(scoreVal) + '" ' +
        'placeholder="' + (isAbsent ? 'ABS' : '') + '" ' +
        'style="width:62px;padding:4px 6px;text-align:right;font-family:inherit;font-size:13px;' +
          (isAbsent ? 'color:var(--text3);font-style:italic;' : '') +
          (err ? 'border:1px solid var(--red);' : '') +
          '">' +
      '<button class="acad-absent-btn" data-clever-id="' + escHtml(student.clever_id) + '" ' +
        'style="font-size:9px;padding:3px 6px;border:1px solid var(--border);background:transparent;' +
          'border-radius:4px;cursor:pointer;color:var(--text3)" title="Mark absent (or press A)">A</button>' +
    '</div>' +
    '<div style="text-align:center">' + dot + '</div>' +
    '<div style="text-align:center">' + statusIcon + '</div>' +
  '</div>';
}

function profDot(level, isAbsent) {
  if (isAbsent) return '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:transparent;border:1px dashed var(--text3)"></span>';
  if (!level)   return '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--border)"></span>';
  var colors = { red: '#D63B3B', yellow: '#E8C547', green: '#4ABFA3' };
  return '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + (colors[level] || '#98A2AD') + '"></span>';
}

// ── WIRING ──────────────────────────────────────────────────────────────────
function wirePicker() {
  var newBtn = el('acad-new-btn');
  if (newBtn) {
    newBtn.addEventListener('click', function() {
      V.showNewForm = !V.showNewForm;
      var wrap = el('acad-newform-wrap');
      if (wrap) wrap.innerHTML = V.showNewForm ? renderNewForm() : '';
      if (V.showNewForm) {
        wireNewForm();
        var t = el('naf-title'); if (t) t.focus();
      }
      // Re-render picker so button text flips
      var card = el('acad-picker-card');
      if (card) card.innerHTML = renderPicker();
      wirePicker();
    });
  }
  document.querySelectorAll('#acad-picker-card [data-event-id]').forEach(function(chip) {
    chip.addEventListener('click', function() {
      selectEvent(chip.dataset.eventId);
    });
  });
}

function wireNewForm() {
  var cancel = el('naf-cancel');
  if (cancel) cancel.addEventListener('click', function() {
    V.showNewForm = false;
    var wrap = el('acad-newform-wrap');
    if (wrap) wrap.innerHTML = '';
    var card = el('acad-picker-card');
    if (card) card.innerHTML = renderPicker();
    wirePicker();
  });

  var save = el('naf-save');
  if (save) save.addEventListener('click', function() {
    save.disabled = true;
    save.textContent = 'Creating…';
    var errEl = el('naf-error');
    if (errEl) errEl.style.display = 'none';

    var title = (el('naf-title').value || '').trim();
    if (!title) {
      if (errEl) { errEl.textContent = 'Title is required.'; errEl.style.display = 'block'; }
      save.disabled = false; save.textContent = 'Create & start entering';
      return;
    }

    var data = {
      title: title,
      topic: (el('naf-topic').value || '').trim() || null,
      subject: el('naf-subject').value,
      grade_level: el('naf-grade').value,
      administered_date: el('naf-date').value || new Date().toISOString().slice(0, 10),
      max_score: Number(el('naf-max').value) || 100,
      school_year: SCHOOL_YEAR
    };

    createAssessmentEvent(data, function(err, created) {
      if (err || !created) {
        if (errEl) {
          errEl.textContent = 'Could not create: ' + ((err && err.message) || 'unknown error');
          errEl.style.display = 'block';
        }
        save.disabled = false; save.textContent = 'Create & start entering';
        return;
      }
      V.showNewForm = false;
      V.recent.unshift(created);
      selectEvent(created.id);
    });
  });
}

function wireRoster() {
  // Score inputs
  document.querySelectorAll('.acad-score-input').forEach(function(inp) {
    inp.addEventListener('keydown', handleKeydown);
    inp.addEventListener('blur', function() { handleSave(inp); });
    inp.addEventListener('input', function() { clearError(inp.dataset.cleverId); });
  });
  // Absent buttons
  document.querySelectorAll('.acad-absent-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var cid = btn.dataset.cleverId;
      var inp = document.querySelector('.acad-score-input[data-clever-id="' + cssEscape(cid) + '"]');
      if (inp) inp.value = '';
      saveScore(cid, null);
    });
  });
  // Bulk paste
  var bulk = el('acad-bulk-btn');
  if (bulk) bulk.addEventListener('click', openBulkPaste);
}

// ── INPUT HANDLERS ──────────────────────────────────────────────────────────
function handleKeydown(e) {
  var inp = e.currentTarget;
  var cid = inp.dataset.cleverId;

  if (e.key === 'Enter') {
    e.preventDefault();
    handleSave(inp);
    focusNext(cid, +1);
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    inp.value = '';
    clearError(cid);
    return;
  }
  if (e.key === 'a' || e.key === 'A') {
    // Only intercept 'a' if the field is empty (so you can still type values containing 'a' in notes elsewhere)
    if (!inp.value) {
      e.preventDefault();
      saveScore(cid, null);
      focusNext(cid, +1);
    }
  }
  if (e.key === 'Tab') {
    // Default browser behavior moves focus; let it. But still save on the way out (blur handler covers it).
  }
}

function handleSave(inp) {
  var cid = inp.dataset.cleverId;
  var raw = (inp.value || '').trim();
  var score;
  if (raw === '') {
    // Empty + previously saved = no-op (don't clobber the saved value).
    // To clear a value, user explicitly hits Esc + presses Absent or types '0'.
    if (!V.scores[cid]) return;
    return;
  }
  var n = Number(raw);
  if (isNaN(n)) {
    setError(cid, 'Not a number');
    return;
  }
  var max = V.currentEvent.max_score || 100;
  if (n < 0 || n > max) {
    setError(cid, 'Out of range (0–' + max + ')');
    return;
  }
  // Debounce so rapid Tab/Enter doesn't fire duplicate saves
  if (V.pending[cid]) clearTimeout(V.pending[cid]);
  V.pending[cid] = setTimeout(function() {
    delete V.pending[cid];
    saveScore(cid, n);
  }, 200);
}

function saveScore(cid, score) {
  // Optimistic update
  var prevSaved = V.scores[cid];
  var optimistic = {
    clever_id: cid,
    score: score,
    proficiency: computeProficiency(score, V.currentEvent.max_score || 100, V.currentEvent.proficiency_thresholds),
    recorded_at: new Date().toISOString()
  };
  V.scores[cid] = optimistic;
  clearError(cid);
  rerenderRow(cid, true /* saving */);

  var student = V.roster.find(function(s) { return s.clever_id === cid; });
  var homeroom = student ? student.homeroom : null;

  upsertScore({
    clever_id: cid,
    assessment_event_id: V.currentEvent.id,
    score: score,
    max_score: V.currentEvent.max_score || 100,
    thresholds: V.currentEvent.proficiency_thresholds,
    homeroom: homeroom
  }, function(err, saved) {
    if (err) {
      // Roll back
      if (prevSaved) V.scores[cid] = prevSaved;
      else delete V.scores[cid];
      setError(cid, 'Save failed');
      showToast('Could not save score', 'error');
      return;
    }
    V.scores[cid] = saved;
    rerenderRow(cid, false);
    updateSub();
  });
}

function rerenderRow(cid, saving) {
  var row = document.querySelector('.acad-row[data-clever-id="' + cssEscape(cid) + '"]');
  if (!row) return;
  var student = V.roster.find(function(s) { return s.clever_id === cid; });
  if (!student) return;
  if (saving) V.pending[cid] = V.pending[cid] || true;
  else delete V.pending[cid];
  var nextHtml = renderRow(student);
  // Replace the row's HTML in place, preserving the wrapper so focus can be restored
  var temp = document.createElement('div');
  temp.innerHTML = nextHtml;
  var newRow = temp.firstChild;
  // Track focus to restore after replacement
  var hadFocus = document.activeElement && document.activeElement.dataset &&
    document.activeElement.dataset.cleverId === cid;
  var cursorPos = hadFocus ? document.activeElement.selectionStart : null;
  row.parentNode.replaceChild(newRow, row);
  // Re-bind handlers for this row
  var newInp = newRow.querySelector('.acad-score-input');
  if (newInp) {
    newInp.addEventListener('keydown', handleKeydown);
    newInp.addEventListener('blur', function() { handleSave(newInp); });
    newInp.addEventListener('input', function() { clearError(cid); });
    if (hadFocus) {
      newInp.focus();
      try { newInp.setSelectionRange(cursorPos || 0, cursorPos || 0); } catch (e) {}
    }
  }
  var newAbs = newRow.querySelector('.acad-absent-btn');
  if (newAbs) {
    newAbs.addEventListener('click', function() {
      if (newInp) newInp.value = '';
      saveScore(cid, null);
    });
  }
}

function focusNext(cid, dir) {
  var inputs = Array.prototype.slice.call(document.querySelectorAll('.acad-score-input'));
  var idx = inputs.findIndex(function(i) { return i.dataset.cleverId === cid; });
  if (idx < 0) return;
  var next = inputs[idx + dir];
  if (next) { next.focus(); next.select(); }
}

function setError(cid, msg) {
  V.errors[cid] = msg;
  rerenderRow(cid, false);
}

function clearError(cid) {
  if (V.errors[cid]) {
    delete V.errors[cid];
    rerenderRow(cid, !!V.pending[cid]);
  }
}

// ── BULK PASTE ──────────────────────────────────────────────────────────────
function openBulkPaste() {
  // Simple modal injected at body level. Roster order is shown so the teacher
  // knows the alignment they're pasting into.
  var existing = document.getElementById('acad-bulk-modal');
  if (existing) existing.remove();
  var modal = document.createElement('div');
  modal.id = 'acad-bulk-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px';

  var rosterPreview = V.roster.map(function(s, i) {
    var name = (s.first_name && s.last_name) ? s.first_name + ' ' + s.last_name : s.student_name;
    return (i + 1) + '. ' + name;
  }).join('\n');

  modal.innerHTML =
    '<div style="background:var(--bg);max-width:520px;width:100%;border-radius:10px;padding:16px;border:1px solid var(--border);max-height:90vh;overflow:auto">' +
      '<div style="font-size:14px;font-weight:600;margin-bottom:6px">Bulk paste scores</div>' +
      '<div style="font-size:11px;color:var(--text3);margin-bottom:10px">' +
        'Paste a column of ' + V.roster.length + ' values, one per line. ' +
        'Use blank line or "A" / "ABS" for absent. Aligned to roster order:' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">' +
        '<div>' +
          '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Roster order</div>' +
          '<pre id="acad-bulk-roster" style="font-size:10px;background:var(--panel);padding:8px;border-radius:4px;max-height:220px;overflow:auto;margin:0;white-space:pre-wrap">' +
            escHtml(rosterPreview) +
          '</pre>' +
        '</div>' +
        '<div>' +
          '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Paste here</div>' +
          '<textarea id="acad-bulk-input" style="width:100%;height:220px;font-family:monospace;font-size:12px;padding:6px" placeholder="85\\n92\\n\\n78\\nA\\n..."></textarea>' +
        '</div>' +
      '</div>' +
      '<div id="acad-bulk-preview" style="font-size:11px;color:var(--text2);margin-bottom:10px"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button id="acad-bulk-cancel" class="btn-secondary">Cancel</button>' +
        '<button id="acad-bulk-apply" class="btn-primary">Apply</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  var ta = document.getElementById('acad-bulk-input');
  var preview = document.getElementById('acad-bulk-preview');
  ta.focus();
  ta.addEventListener('input', function() {
    var parsed = parseBulk(ta.value);
    preview.textContent = parsed.valid + ' of ' + V.roster.length +
      ' will apply (' + parsed.absent + ' absent, ' + parsed.invalid + ' invalid, ' +
      parsed.skip + ' skipped/blank).';
  });

  document.getElementById('acad-bulk-cancel').addEventListener('click', function() { modal.remove(); });
  document.getElementById('acad-bulk-apply').addEventListener('click', function() {
    applyBulk(ta.value);
    modal.remove();
  });
}

function parseBulk(text) {
  var lines = (text || '').split(/\r?\n/);
  var valid = 0, absent = 0, invalid = 0, skip = 0;
  for (var i = 0; i < V.roster.length; i++) {
    var raw = (lines[i] || '').trim();
    if (raw === '') { skip++; continue; }
    if (/^(a|abs|absent)$/i.test(raw)) { absent++; continue; }
    var n = Number(raw);
    var max = V.currentEvent.max_score || 100;
    if (isNaN(n) || n < 0 || n > max) { invalid++; continue; }
    valid++;
  }
  return { valid: valid, absent: absent, invalid: invalid, skip: skip };
}

function applyBulk(text) {
  var lines = (text || '').split(/\r?\n/);
  var max = V.currentEvent.max_score || 100;
  V.roster.forEach(function(s, i) {
    var raw = (lines[i] || '').trim();
    if (raw === '') return;
    if (/^(a|abs|absent)$/i.test(raw)) { saveScore(s.clever_id, null); return; }
    var n = Number(raw);
    if (isNaN(n) || n < 0 || n > max) return;
    saveScore(s.clever_id, n);
  });
  showToast('Bulk paste applied', 'info', 2000);
}

// ── DATA LOAD ───────────────────────────────────────────────────────────────
function loadRecentEvents() {
  fetchAssessmentEvents({ schoolYear: SCHOOL_YEAR, limit: 30 }, function(err, rows) {
    if (err) { showToast('Could not load assessments', 'error'); return; }
    V.recent = rows;
    var card = el('acad-picker-card');
    if (card) card.innerHTML = renderPicker();
    wirePicker();
  });
}

function selectEvent(eventId) {
  var ev = V.recent.find(function(e) { return e.id === eventId; });
  if (!ev) return;
  V.currentEvent = ev;
  V.scores = {};
  V.pending = {};
  V.errors = {};

  // Show loading state in roster area
  var wrap = el('acad-roster-wrap');
  if (wrap) wrap.innerHTML = '<div class="card">' + skeletonRows(8) + '</div>';
  updateSub();
  // Re-render picker chips to highlight active
  var card = el('acad-picker-card');
  if (card) card.innerHTML = renderPicker();
  wirePicker();

  // Parallel fetch roster + existing scores
  var rosterDone = false, scoresDone = false;
  fetchRosterByGrade(ev.grade_level, { schoolYear: SCHOOL_YEAR }, function(err, students) {
    V.roster = err ? [] : students;
    rosterDone = true;
    if (scoresDone) renderRosterArea();
  });
  fetchScoresForAssessment(ev.id, function(err, map) {
    V.scores = err ? {} : map;
    scoresDone = true;
    if (rosterDone) renderRosterArea();
  });
}

function renderRosterArea() {
  var wrap = el('acad-roster-wrap');
  if (!wrap) return;
  wrap.innerHTML = renderRoster();
  wireRoster();
  updateSub();
  // Focus first empty score field
  var inputs = document.querySelectorAll('.acad-score-input');
  for (var i = 0; i < inputs.length; i++) {
    if (!inputs[i].value) { inputs[i].focus(); break; }
  }
}

// ── UTIL ────────────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

// CSS.escape polyfill — needed for attribute selectors with clever_ids that
// might contain special characters
function cssEscape(s) {
  if (window.CSS && window.CSS.escape) return window.CSS.escape(s);
  return String(s).replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}
