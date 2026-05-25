import { SB_URL, SB_KEY } from '../../config.js';
import { SESSION, showScreen, escHtml, fetchStudentIncidents, renderIncidentList, setStuPrevScreen, getStuPrevScreen, drawLine, wireHeatCard, displayBehavior, skeletonKpis, skeletonRows, animateListIn, showToast, emptyState, authedFetch, buildAcc } from '../../main.js';
import { fetchStudentAcademics, fetchActionPlansForStudent } from '../../api/academics.js';

// -- HELPERS ------------------------------------------------------------------

function colorFill(color) {
  var fills = { Green:'#4ABFA3', Yellow:'#E8C547', Orange:'#E87D2B', Red:'#D63B3B' };
  return fills[color] || '#98A2AD';
}

function stuInitials(name) {
  if (!name) return '?';
  var parts = name.trim().split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function stuNameLink(name) {
  if (!name || name === 'Other') return escHtml(name || '');
  var n = escHtml(name);
  return '<span class="stu-name-link" data-stu="' + n + '">' + n + '</span>';
}

function wireStudentLinks(container, prevScreen) {
  if (!container) return;
  container.querySelectorAll('[data-stu]').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      openStudent(el.dataset.stu, prevScreen);
    });
  });
}

function fetchStudentNote(name, cb) {
  if (!SESSION.token) { if (cb) cb(new Error('not authenticated'), ''); return; }
  fetch(SB_URL + '/rest/v1/student_notes?student_name=eq.' + encodeURIComponent(name) + '&select=notes', {
    headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SESSION.token }
  }).then(function(r) { return r.json(); })
    .then(function(rows) {
      var note = (rows && rows[0] && rows[0].notes) || '';
      if (cb) cb(null, note);
    }).catch(function(err) { if (cb) cb(err, ''); });
}

function saveStudentNote(name, notes, cb) {
  if (!SESSION.token) { if (cb) cb(new Error('not authenticated')); return; }
  fetch(SB_URL + '/rest/v1/student_notes', {
    method: 'POST',
    headers: {
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SESSION.token,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify({
      student_name: name,
      notes: notes || '',
      updated_at: new Date().toISOString(),
      updated_by: SESSION.email || null
    })
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if (cb) cb(null);
  }).catch(function(err) { if (cb) cb(err); });
}

function studentDateStr(r) {
  return r.incident_date || (r.created_at || '').slice(0, 10) || '';
}

function studentWeekStart(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr + 'T12:00:00');
  if (isNaN(d)) return '';
  var day = d.getDay();
  var mon = new Date(d);
  mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return mon.toISOString().slice(0, 10);
}

function buildStudentWeekly(rows) {
  var wk = {};
  (rows || []).forEach(function(r) {
    var k = studentWeekStart(studentDateStr(r));
    if (!k) return;
    wk[k] = (wk[k] || 0) + 1;
  });
  var keys = Object.keys(wk).sort().slice(-10);
  return {
    labels: keys.map(function(k) {
      var d = new Date(k + 'T12:00:00');
      return isNaN(d) ? k : (d.toLocaleString('en-US', { month: 'short' }) + ' ' + d.getDate());
    }),
    values: keys.map(function(k) { return wk[k] || 0; })
  };
}

// -- BLOCK HEATMAP ------------------------------------------------------------

function buildBlockHeatmap(rows) {
  var counts = {};
  (rows || []).forEach(function(r) {
    if (!r.specials) return;
    if (r._type === 'transition' && r.to_color === 'Green' && !r.needs_documentation) return;
    counts[r.specials] = (counts[r.specials] || 0) + 1;
  });
  var blocks = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; });
  if (!blocks.length) return '<div style="font-size:12px;color:var(--text3);padding:8px 0">No block data yet</div>';
  var max = counts[blocks[0]] || 1;
  return blocks.map(function(b, i) {
    var pct  = Math.round((counts[b] / max) * 100);
    var fill = i === 0 ? '#D63B3B' : i === 1 ? '#E87D2B' : '#271A70';
    return '<div style="margin-bottom:10px">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px">' +
        '<span style="font-size:12px;font-weight:600;color:var(--text)">' + escHtml(b) + '</span>' +
        '<span style="font-size:11px;color:var(--text3)">' + counts[b] + ' event' + (counts[b] !== 1 ? 's' : '') + '</span>' +
      '</div>' +
      '<div style="height:8px;border-radius:4px;background:var(--border)">' +
        '<div style="height:100%;width:' + pct + '%;border-radius:4px;background:' + fill + ';transition:width 0.4s ease"></div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// -- TRANSITION ROW -----------------------------------------------------------

function buildTransitionRow(r) {
  var fromC = colorFill(r.from_color);
  var toC   = colorFill(r.to_color);
  var time  = r.created_at
    ? new Date(r.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : r.date || '';
  return '<div style="padding:10px 0;border-bottom:0.5px solid var(--border);display:flex;gap:10px;align-items:flex-start">' +
    '<div style="display:flex;align-items:center;gap:5px;flex-shrink:0;padding-top:2px">' +
      '<div style="width:10px;height:10px;border-radius:50%;background:' + fromC + '"></div>' +
      '<span style="font-size:11px;color:var(--text3)">\u2192</span>' +
      '<div style="width:10px;height:10px;border-radius:50%;background:' + toC + '"></div>' +
    '</div>' +
    '<div style="flex:1;min-width:0">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">' +
        '<span style="font-size:12px;font-weight:700;color:' + toC + '">' + escHtml(r.from_color) + ' \u2192 ' + escHtml(r.to_color) + '</span>' +
        '<span style="font-size:10px;color:var(--text3);flex-shrink:0">' + escHtml(time) + '</span>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--text3);margin-top:1px">' + escHtml(r.specials || '') + '</div>' +
      (r.duration_mins !== null && r.duration_mins !== undefined
        ? '<div style="font-size:11px;color:var(--text2);margin-top:2px">' + r.duration_mins + ' min</div>' : '') +
      (r.notes ? '<div style="font-size:11px;color:var(--text2);margin-top:2px;white-space:pre-wrap">' + escHtml(r.notes) + '</div>' : '') +
      (r.needs_documentation
        ? '<div style="font-size:10px;color:#E87D2B;font-weight:700;margin-top:3px">\u26a0\ufe0f Needs documentation</div>' : '') +
    '</div>' +
  '</div>';
}

// -- RENDER UNIFIED TIMELINE --------------------------------------------------

function renderUnifiedTimeline(rows, container, onAfterEdit) {
  if (!rows || !rows.length) {
    container.innerHTML = emptyState('No behavioral events on record', 'Incidents and Quick Color events will appear here when logged.');
    return;
  }
  var incidents   = rows.filter(function(r) { return r._type !== 'transition'; });
  var transitions = rows.filter(function(r) { return r._type === 'transition'; });

  renderIncidentList(incidents.length ? incidents : [], container, onAfterEdit);

  if (transitions.length) {
    var tWrap = document.createElement('div');
    tWrap.style.cssText = 'margin-top:10px';
    var tHdr = document.createElement('div');
    tHdr.className = 'sec';
    tHdr.textContent = 'Quick Color events';
    tWrap.appendChild(tHdr);
    var tList = document.createElement('div');
    tList.className = 'card';
    tList.style.padding = '4px 12px';
    tList.innerHTML = transitions.map(buildTransitionRow).join('');
    tWrap.appendChild(tList);
    container.appendChild(tWrap);
  }
}

// -- MAIN OPEN FUNCTION -------------------------------------------------------

function openStudent(name, prevScreen) {
  var navMap = {
    'S-detail':  '\u2039 Class',
    'S-classes': '\u2039 Classes',
    'S-admin':   '\u2039 Dashboard',
    'S-teacher': '\u2039 My Logs'
  };
  setStuPrevScreen(prevScreen || 'S-detail');
  var ps = getStuPrevScreen();
  var backBtn = document.getElementById('btn-stu-back');
  if (backBtn) backBtn.textContent = navMap[ps] || '\u2039 Back';

  var title = document.getElementById('stu-title');
  var sub   = document.getElementById('stu-sub');
  var body  = document.getElementById('stu-body');
  if (title) title.textContent = name || 'Scholar';
  if (sub)   sub.textContent   = '';
  if (body)  body.innerHTML    = skeletonKpis(6) + skeletonRows(10);
  showScreen('S-student');

  var isAdmin = SESSION.role === 'admin';
  var TOTAL   = isAdmin ? 4 : 3;
  var done    = 0;
  var stuRecord = null, incidents = [], faRows = [], accRows = [];

  function tryRender() {
    done++;
    if (done >= TOTAL) renderProfile(name, stuRecord, incidents, faRows, accRows, body);
  }

  // 1. Student roster record (guardian, espark, clever_id)
  authedFetch(
    '/rest/v1/students?student_name=eq.' + encodeURIComponent(name) +
    '&select=student_name,homeroom,grade,grade_code,guardian_name,guardian_email,' +
    'guardian_phone,clever_id,testing_id,espark_username,espark_password,photo_url&limit=1'
  ).then(function(r) { return r.json(); })
   .then(function(rows) { stuRecord = (rows && rows[0]) || null; })
   .catch(function() { stuRecord = null; })
   .then(tryRender);

  // 2. Unified behavioral timeline (incidents + color_transitions)
  fetchStudentIncidents(name, function(_e, rows) {
    incidents = rows || [];
    tryRender();
  });

  // 3. First aid log
  authedFetch(
    '/rest/v1/first_aid_log?student=eq.' + encodeURIComponent(name) +
    '&select=*&order=incident_date.desc,created_at.desc&limit=50'
  ).then(function(r) { return r.json(); })
   .then(function(rows) { faRows = Array.isArray(rows) ? rows : []; })
   .catch(function() { faRows = []; })
   .then(tryRender);

  // 4. Accommodations (admin only)
  if (isAdmin) {
    authedFetch(
      '/rest/v1/student_accommodations?student_name=eq.' + encodeURIComponent(name) +
      '&select=plan_type,classroom_accommodations&limit=1'
    ).then(function(r) { return r.json(); })
     .then(function(rows) { accRows = Array.isArray(rows) ? rows : []; })
     .catch(function() { accRows = []; })
     .then(tryRender);
  }
}

// -- RENDER PROFILE -----------------------------------------------------------

function renderProfile(name, stu, incidents, faRows, accRows, body) {
  var isAdmin = SESSION.role === 'admin';

  // Derived stats
  var fullIncidents = incidents.filter(function(r) { return r._type !== 'transition'; });
  var transitions   = incidents.filter(function(r) { return r._type === 'transition'; });
  var total         = fullIncidents.length;
  var qcCount       = transitions.length;
  var chartY        = fullIncidents.filter(function(r) { return !!r.color_chart; }).length;
  var homeY         = fullIncidents.filter(function(r) { return !!r.home_contact; }).length;
  var chartPct      = total ? Math.round(chartY / total * 100) : 0;
  var homePct       = total ? Math.round(homeY / total * 100) : 0;

  var behCounts = {}, spCounts = {};
  incidents.forEach(function(r) {
    (r.behaviors || []).forEach(function(bh) {
      var mapped = displayBehavior(bh);
      behCounts[mapped] = (behCounts[mapped] || 0) + 1;
    });
    if (r.specials && !(r._type === 'transition' && r.to_color === 'Green' && !r.needs_documentation)) {
      spCounts[r.specials] = (spCounts[r.specials] || 0) + 1;
    }
  });
  var topBehavior = Object.keys(behCounts).sort(function(a, b) { return behCounts[b] - behCounts[a]; })[0] || '\u2014';
  var topBlock    = Object.keys(spCounts).sort(function(a, b)  { return spCounts[b]  - spCounts[a];  })[0] || '\u2014';

  var accRec      = accRows && accRows[0];
  var accPlanType = accRec ? (accRec.plan_type || '') : '';
  var initials    = stuInitials(name);
  var gradeCode   = (stu && (stu.grade_code || stu.grade)) || '';
  var homeroom    = (stu && stu.homeroom) || '';

  // Header card
  var guardianHtml = '';
  if (isAdmin && stu && (stu.guardian_name || stu.guardian_email)) {
    guardianHtml =
      '<div style="margin-top:8px;padding-top:8px;border-top:0.5px solid var(--border)">' +
        (stu.guardian_name
          ? '<div style="font-size:12px;font-weight:600;color:var(--text)">' + escHtml(stu.guardian_name) + '</div>' : '') +
        (stu.guardian_email
          ? '<div style="font-size:11px;color:var(--text3)">' + escHtml(stu.guardian_email) + '</div>' : '') +
        (stu.guardian_phone
          ? '<div style="font-size:11px;color:var(--text3)">' + escHtml(stu.guardian_phone) + '</div>' : '') +
      '</div>';
  }

  var esparkHtml = '';
  if (isAdmin && stu && (stu.espark_username || stu.clever_id)) {
    esparkHtml =
      '<div style="text-align:right;flex-shrink:0;margin-left:8px">' +
        (stu.espark_username
          ? '<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">eSpark</div>' +
            '<div style="font-size:11px;font-weight:600;font-family:monospace;color:var(--text)">' + escHtml(stu.espark_username) + '</div>' +
            (stu.espark_password
              ? '<div style="font-size:11px;font-family:monospace;color:var(--text3)">' + escHtml(stu.espark_password) + '</div>' : '') : '') +
        (stu.clever_id
          ? '<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-top:6px">Clever ID</div>' +
            '<div style="font-size:10px;font-family:monospace;color:var(--text2)">' + escHtml(stu.clever_id.slice(0, 14)) + '\u2026</div>' : '') +
      '</div>';
  }

  var headerHtml =
    '<div class="card" style="margin-top:10px">' +
      '<div style="display:flex;gap:12px;align-items:flex-start">' +
        '<div style="width:54px;height:54px;border-radius:50%;background:var(--indigo);' +
          'display:flex;align-items:center;justify-content:center;flex-shrink:0;' +
          'color:var(--gold);font-weight:800;font-size:20px;letter-spacing:-0.02em">' +
          escHtml(initials) +
        '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px">' +
            '<span style="font-size:17px;font-weight:800;color:var(--text)">' + escHtml(name) + '</span>' +
            (gradeCode
              ? '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;' +
                'background:var(--indigo);color:var(--gold)">Gr ' + escHtml(gradeCode) + '</span>' : '') +
            (accPlanType
              ? '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;' +
                'background:#E87D2B22;color:#E87D2B;border:1px solid #E87D2B44">' + escHtml(accPlanType) + '</span>' : '') +
          '</div>' +
          (homeroom ? '<div style="font-size:12px;color:var(--text3)">' + escHtml(homeroom) + '</div>' : '') +
          guardianHtml +
        '</div>' +
        esparkHtml +
      '</div>' +
    '</div>';

  // KPI row
  var kpiHtml =
    '<div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:10px">' +
      '<div class="kpi"><div class="lbl">Full incidents</div><div class="val">' + total + '</div></div>' +
      '<div class="kpi"><div class="lbl">Quick Color</div><div class="val">' + qcCount + '</div></div>' +
      '<div class="kpi"><div class="lbl">Chart used</div><div class="val">' + chartPct + '%</div></div>' +
      '<div class="kpi"><div class="lbl">Home contact</div><div class="val">' + homePct + '%</div></div>' +
      '<div class="kpi"><div class="lbl">Top behavior</div><div class="val" style="font-size:12px;line-height:1.2;margin-top:6px">' + escHtml(topBehavior) + '</div></div>' +
      '<div class="kpi"><div class="lbl">Hardest block</div><div class="val" style="font-size:12px;line-height:1.2;margin-top:6px">' + escHtml(topBlock) + '</div></div>' +
    '</div>';

  // Block heatmap
  var heatHtml =
    '<div class="card" style="margin-bottom:10px">' +
      '<div class="sec" style="margin-top:0">By specials block</div>' +
      buildBlockHeatmap(incidents) +
    '</div>';

  // Weekly trend
  var weeklyHtml =
    '<div class="card" style="margin-bottom:10px">' +
      '<canvas id="stu-wk-line" height="80" style="width:100%;display:block"></canvas>' +
    '</div>';

  // First aid
  var faHtml = !faRows.length
    ? '<div class="card">' + emptyState('No first aid records', 'First aid events will appear here when logged.') + '</div>'
    : '<div class="card">' + faRows.map(function(r) {
        return '<div style="padding:8px 0;border-bottom:0.5px solid var(--border)">' +
          '<div style="font-size:12px;font-weight:700;color:var(--text)">' + escHtml(r.incident_date || '\u2014') + ' \u00B7 ' + escHtml(r.specials || '\u2014') + '</div>' +
          '<div style="font-size:11px;color:var(--text2);margin-top:2px">Injury: ' + escHtml(r.injury_description || '\u2014') + '</div>' +
          '<div style="font-size:11px;color:var(--text2)">Treatment: ' + escHtml(r.treatment || '\u2014') + '</div>' +
          '<div style="font-size:11px;color:var(--text3)">Returned: ' + (r.returned_to_activity ? 'Yes' : 'No') + ' \u00B7 Home contacted: ' + (r.home_contact ? 'Yes' : 'No') + '</div>' +
        '</div>';
      }).join('') + '</div>';

  // Pattern heatmap
  var patternHtml = '<div id="stu-heat-card" style="margin-bottom:10px;overflow-x:auto"></div>';

  // Timeline placeholder
  var timelineHtml = '<div id="stu-inc-list"></div>';

  // Accommodations (admin)
  var accomHtml = '';
  if (isAdmin) {
    accomHtml = (accRec && accRec.classroom_accommodations)
      ? '<div class="card">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
            '<span style="font-size:12px;font-weight:700;color:var(--indigo)">' + escHtml(accRec.plan_type || 'Plan') + ' \u2014 Classroom Accommodations</span>' +
            '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--indigo-lt);color:var(--indigo);font-weight:700;letter-spacing:.04em">CONFIDENTIAL</span>' +
          '</div>' +
          '<div style="font-size:13px;color:var(--text2);line-height:1.8;white-space:pre-wrap">' + escHtml(accRec.classroom_accommodations) + '</div>' +
        '</div>'
      : emptyState('No accommodations on file', '');
  }

  // Admin notes (admin)
  var notesHtml = '';
  if (isAdmin) {
    notesHtml =
      '<div class="card">' +
        '<div style="font-size:11px;color:var(--text3);margin-bottom:6px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Admin notes</div>' +
        '<textarea id="stu-notes-ta" style="width:100%;min-height:88px;background:var(--panel);border:0.5px solid var(--border);color:var(--text);border-radius:10px;padding:10px;font-family:inherit;box-sizing:border-box;resize:vertical"></textarea>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:8px">' +
          '<button class="pill" id="stu-save-note">Save note</button>' +
        '</div>' +
        '<div id="stu-note-status" style="font-size:10px;color:var(--text3);margin-top:4px;text-align:right"></div>' +
      '</div>';
  }

  // Academics — lazy loaded after render. Renders skeleton placeholder here;
  // actual fetch + render happens in the post-mount section so it doesn't
  // block the initial page paint.
  var academicsHtml = '<div id="stu-academics-wrap">' + skeletonRows(3) + '</div>';

  // Assemble layout
  var primaryHtml =
    buildAcc('stu', 'timeline',  'Behavioral timeline', (total + qcCount) + ' events', timelineHtml, true) +
    buildAcc('stu', 'academics', 'Academic performance', 'recent scores + trend',       academicsHtml, true) +
    buildAcc('stu', 'blocks',    'Block pattern',       'by specials class',            heatHtml,     false) +
    buildAcc('stu', 'pattern',   'Day/time heatmap',    '',                             patternHtml,  false) +
    buildAcc('stu', 'trend',     'Weekly trend',        '',                             weeklyHtml,   false) +
    buildAcc('stu', 'firstaid',  'First aid / injury log', faRows.length + ' records', faHtml,       false);

  var sidebarHtml = '';
  if (isAdmin) {
    sidebarHtml =
      buildAcc('stu', 'acc',   'Accommodations', accPlanType || 'Admin only', accomHtml, !!accRec) +
      buildAcc('stu', 'notes', 'Admin notes',    'Private',                  notesHtml, false);
  }

  body.innerHTML =
    headerHtml +
    kpiHtml +
    '<div id="stu-two-col" style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">' +
      '<div id="stu-primary" style="flex:1 1 300px;min-width:0">' + primaryHtml + '</div>' +
      (sidebarHtml
        ? '<div id="stu-sidebar" style="flex:0 1 280px;min-width:0">' + sidebarHtml + '</div>'
        : '') +
    '</div>';

  // Post-mount wiring
  var listEl    = document.getElementById('stu-inc-list');

  var onRefresh = function() {
    fetchStudentIncidents(name, function(_e, rows2) {
      incidents = rows2 || [];
      var wk2 = buildStudentWeekly(incidents);
      if (wk2.values.length) setTimeout(function() { drawLine('stu-wk-line', wk2.labels, wk2.values); }, 20);
      wireHeatCard('stu-heat-card', incidents.filter(function(r) { return r._type !== 'transition'; }), {
        prefix: 'stu-heat', showFilters: false,
        onCellClick: function(filteredRows) { if (listEl) renderUnifiedTimeline(filteredRows, listEl, onRefresh); }
      });
      if (listEl) renderUnifiedTimeline(incidents, listEl, onRefresh);
    });
  };

  if (listEl) renderUnifiedTimeline(incidents, listEl, onRefresh);

  wireHeatCard('stu-heat-card', fullIncidents, {
    prefix: 'stu-heat', showFilters: false,
    onCellClick: function(filteredRows) { if (listEl) renderUnifiedTimeline(filteredRows, listEl, onRefresh); }
  });

  var weekly = buildStudentWeekly(incidents);
  if (weekly.values.length) {
    setTimeout(function() { drawLine('stu-wk-line', weekly.labels, weekly.values); }, 40);
  }

  if (isAdmin) {
    fetchStudentNote(name, function(_e, note) {
      var ta = document.getElementById('stu-notes-ta');
      if (ta) ta.value = note || '';
    });
    var saveBtn = document.getElementById('stu-save-note');
    if (saveBtn) {
      saveBtn.addEventListener('click', function() {
        var ta = document.getElementById('stu-notes-ta');
        var st = document.getElementById('stu-note-status');
        saveBtn.disabled = true; saveBtn.textContent = '[ Saving\u2026 ]';
        saveStudentNote(name, ta ? ta.value : '', function(e2) {
          saveBtn.disabled = false; saveBtn.textContent = 'Save note';
          if (st) st.textContent = e2 ? 'Save failed' : 'Saved';
          if (e2) showToast('Could not connect', 'error');
          else showToast('Note saved');
        });
      });
    }
  }

  wireStudentLinks(body, 'S-student');
  animateListIn(listEl);

  // Academics section — fetch in parallel with the rest, render into the
  // placeholder when both calls resolve. Falls back gracefully if the student
  // has no clever_id (older roster row) or no academic data yet.
  loadAcademicsSection(stu);
}

// ── ACADEMICS SECTION ───────────────────────────────────────────────────────
// Renders into #stu-academics-wrap. Self-contained — own data fetch, own
// render, own error handling. Does not block the primary profile render.
function loadAcademicsSection(stu) {
  var wrap = document.getElementById('stu-academics-wrap');
  if (!wrap) return;
  var cleverId = stu && stu.clever_id;
  if (!cleverId) {
    wrap.innerHTML = emptyState('No academic data available',
      'This scholar has no clever_id on file, so academic scores can’t be joined.');
    return;
  }
  Promise.all([
    fetchStudentAcademics(cleverId),
    fetchActionPlansForStudent(cleverId)
  ]).then(function(results) {
    var scores = results[0] || [];
    var plans  = results[1] || [];
    wrap.innerHTML = renderAcademicsSection(scores, plans);
    wireAcademicsSection(wrap);
  }).catch(function() {
    wrap.innerHTML = emptyState('Could not load academic data',
      'Check your connection and refresh.');
  });
}

function renderAcademicsSection(scores, plans) {
  if (!scores.length && !plans.length) {
    return emptyState('No academic records yet',
      'When teachers enter exit ticket and quiz scores for this scholar, they’ll show here.');
  }

  // KPIs — overall avg, # assessments, plans active/complete
  var nonAbsent = scores.filter(function(s) { return s.score !== null && s.score !== undefined; });
  var avgPct = null;
  if (nonAbsent.length) {
    var pctSum = nonAbsent.reduce(function(a, s) {
      var max = (s.assessment_event && Number(s.assessment_event.max_score)) || 100;
      return a + (Number(s.score) / max) * 100;
    }, 0);
    avgPct = Math.round(pctSum / nonAbsent.length);
  }
  var activePlans = plans.filter(function(p) { return p.status === 'active'; });
  var completedPlans = plans.filter(function(p) { return p.status !== 'active'; });

  var kpiHtml =
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-bottom:10px">' +
      academicKpi('Overall avg', avgPct !== null ? avgPct + '%' : '—',
                  avgPct === null ? null : avgPct >= 80 ? 'green' : avgPct >= 60 ? 'yellow' : 'red') +
      academicKpi('Assessments', String(scores.length), null) +
      academicKpi('Active plans', String(activePlans.length), activePlans.length ? 'navy' : null) +
      academicKpi('Completed', String(completedPlans.length), null) +
    '</div>';

  // Mini trend sparkline (last 10 chronologically)
  var trendHtml = renderMiniTrend(scores);

  // Recent assessment list with proficiency dots
  var assessmentsHtml = scores.length
    ? '<div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:12px 0 6px">Recent assessments</div>' +
      '<div class="card" style="padding:4px 0">' +
        scores.slice(0, 10).map(function(s) { return renderAcademicRow(s); }).join('') +
      '</div>'
    : '';

  // Active plans block
  var plansHtml = activePlans.length
    ? '<div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:12px 0 6px">Active action plans</div>' +
      activePlans.map(function(p) { return renderActivePlanCard(p); }).join('')
    : '';

  // Completed plans summary (compact)
  var doneHtml = completedPlans.length
    ? '<div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:12px 0 6px">Completed plans</div>' +
      '<div class="card" style="padding:6px 10px">' +
        completedPlans.slice(0, 5).map(function(p) {
          var delta = p.outcome_avg_delta;
          var deltaText = (delta !== null && delta !== undefined)
            ? (delta > 0 ? '+' : '') + Math.round(delta * 10) / 10 + ' pts'
            : '—';
          var deltaColor = (delta > 0) ? '#287f6c' : (delta < 0) ? '#a82828' : 'var(--text3)';
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:11px">' +
            '<span>' + escHtml(p.topic) + '</span>' +
            '<span style="font-weight:700;color:' + deltaColor + '">' + deltaText + '</span>' +
          '</div>';
        }).join('') +
      '</div>'
    : '';

  return kpiHtml + trendHtml + assessmentsHtml + plansHtml + doneHtml;
}

function academicKpi(label, value, colorTone) {
  var colors = { green: '#287f6c', yellow: '#8a7314', red: '#a82828', navy: 'var(--navy)' };
  var color = colorTone ? colors[colorTone] : 'var(--text)';
  return '<div class="kpi" style="padding:8px 10px">' +
    '<div class="lbl" style="font-size:9px">' + escHtml(label) + '</div>' +
    '<div class="val" style="font-size:18px;color:' + color + '">' + value + '</div>' +
  '</div>';
}

function renderMiniTrend(scores) {
  var nonAbsent = scores.filter(function(s) { return s.score !== null && s.score !== undefined; });
  if (nonAbsent.length < 2) return '';
  // Chronological order (oldest first)
  var chrono = nonAbsent.slice().sort(function(a, b) {
    return new Date(a.recorded_at) - new Date(b.recorded_at);
  });
  // Last 10
  var pts = chrono.slice(-10).map(function(s) {
    var max = (s.assessment_event && Number(s.assessment_event.max_score)) || 100;
    return Math.max(0, Math.min(100, (Number(s.score) / max) * 100));
  });
  var n = pts.length;
  if (n < 2) return '';
  var W = 240, H = 40, P = 4;
  var step = (W - 2 * P) / (n - 1);
  var d = pts.map(function(y, i) {
    var x = P + i * step;
    var yPos = H - P - (y / 100) * (H - 2 * P);
    return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + yPos.toFixed(1);
  }).join(' ');
  var last = pts[n - 1];
  var first = pts[0];
  var trendColor = (last - first) > 5 ? '#287f6c' : (last - first) < -5 ? '#a82828' : 'var(--text3)';
  return '<div class="card" style="padding:8px 10px;display:flex;align-items:center;gap:10px">' +
    '<div style="font-size:10px;color:var(--text3)">Trend</div>' +
    '<svg width="' + W + '" height="' + H + '" style="display:block">' +
      '<path d="' + d + '" stroke="' + trendColor + '" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
      pts.map(function(y, i) {
        var x = P + i * step;
        var yPos = H - P - (y / 100) * (H - 2 * P);
        return '<circle cx="' + x.toFixed(1) + '" cy="' + yPos.toFixed(1) + '" r="2" fill="' + trendColor + '"/>';
      }).join('') +
    '</svg>' +
    '<div style="font-size:11px;color:' + trendColor + ';font-weight:700">' +
      (last > first ? '+' : '') + Math.round(last - first) + ' pts' +
    '</div>' +
  '</div>';
}

function renderAcademicRow(s) {
  var ev = s.assessment_event || {};
  var max = Number(ev.max_score) || 100;
  var isAbsent = (s.score === null || s.score === undefined);
  var pct = isAbsent ? null : Math.round((Number(s.score) / max) * 100);
  var dotColor = isAbsent ? 'transparent'
               : s.proficiency === 'green' ? '#4ABFA3'
               : s.proficiency === 'yellow' ? '#E8C547'
               : s.proficiency === 'red' ? '#D63B3B'
               : 'var(--border)';
  var dotStyle = isAbsent
    ? 'background:transparent;border:1px dashed var(--text3)'
    : 'background:' + dotColor;

  return '<div style="display:flex;align-items:center;gap:10px;padding:6px 10px;border-bottom:0.5px solid var(--border)">' +
    '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;flex-shrink:0;' + dotStyle + '"></span>' +
    '<div style="flex:1;min-width:0">' +
      '<div style="font-size:12px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        escHtml(ev.title || 'Untitled') +
      '</div>' +
      '<div style="font-size:10px;color:var(--text3)">' +
        escHtml((ev.subject || '—')) + ' · ' + escHtml(ev.administered_date || '—') +
      '</div>' +
    '</div>' +
    '<div style="font-size:13px;font-weight:700;color:' +
      (isAbsent ? 'var(--text3)' : 'var(--text)') + '">' +
      (isAbsent ? 'ABS' : (s.score + '/' + max)) +
    '</div>' +
    '<div style="font-size:10px;color:var(--text3);min-width:35px;text-align:right">' +
      (pct !== null ? pct + '%' : '') +
    '</div>' +
  '</div>';
}

function renderActivePlanCard(plan) {
  var checkText = '';
  if (plan.target_check_date) {
    var d = new Date(plan.target_check_date + 'T12:00:00');
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var overdue = d < today;
    checkText = '<span style="font-size:10px;color:' + (overdue ? '#a82828' : 'var(--text3)') + '">' +
      (overdue ? '⚠ Check due ' : 'Check ') + plan.target_check_date + '</span>';
  }
  return '<div class="card" style="padding:10px;margin-bottom:6px;border-left:3px solid var(--navy)">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">' +
      '<div style="flex:1">' +
        '<div style="font-size:12px;font-weight:700">' + escHtml(plan.topic) + '</div>' +
        (plan.description ? '<div style="font-size:10px;color:var(--text2);margin-top:2px">' + escHtml(plan.description) + '</div>' : '') +
      '</div>' +
      '<span style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:10px;background:rgba(39,26,112,.12);color:var(--navy);text-transform:uppercase;letter-spacing:.06em;flex-shrink:0">Active</span>' +
    '</div>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">' +
      '<span style="font-size:10px;color:var(--text3)">Owner: ' + escHtml(plan.owner_email || '—') + '</span>' +
      checkText +
    '</div>' +
  '</div>';
}

function wireAcademicsSection(/* container */) {
  // Reserved for future click handlers (drill into assessment, open plan, etc.)
}

export { openStudent, wireStudentLinks, stuNameLink, fetchStudentNote, saveStudentNote };
