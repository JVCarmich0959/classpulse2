// ─────────────────────────────────────────────────────────────────────────────
// Academics · Action Plans List
//
// V1 week 6. List view of reteach plans created during Tuesday meetings.
// Manual outcome marking for V1 — auto-matching from re-assessment data
// lands in week 7-8 (PR C).
//
// Layout:
//   - Tabs: Active / Awaiting / Complete / All  (status filter)
//   - Counter strip: "X active · Y awaiting · Z complete"
//   - Plan cards stacked: topic, students, owner, dates, status, outcome
//   - Per-card actions: Mark Complete / Partial / Discontinued + Delete
//
// Future PR C will auto-link follow_up_event_id and compute outcome_avg_delta
// from re-assessment data. For V1, those fields are set manually here.
// ─────────────────────────────────────────────────────────────────────────────

import {
  showScreen, showToast, emptyState,
  skeletonRows, escHtml, openStudent
} from '../../main.js';
import {
  fetchActionPlans, updateActionPlan, deleteActionPlan,
  fetchStudentsByCleverIds, recomputeAllOutcomes,
  fetchPlanOutcomeBreakdown
} from '../../api/academics.js';

var SCHOOL_YEAR = import.meta.env.VITE_SCHOOL_YEAR || '2025-26';

// View state
var V = {
  tab: 'active',
  plans: [],
  studentMap: {},          // clever_id -> {first_name, last_name, homeroom, ...}
  breakdowns: {},          // planId -> per-student outcome breakdown (auto-completed plans only)
  loading: false
};

// ── PUBLIC ENTRY POINT ──────────────────────────────────────────────────────
export function openAcademicsPlans() {
  showScreen('S-academics-plans');
  V.tab = 'active';
  V.plans = [];
  V.studentMap = {};
  V.breakdowns = {};
  V.loading = true;
  renderShell();
  loadData();
}

// ── RENDER ──────────────────────────────────────────────────────────────────
function renderShell() {
  var body = el('plans-body');
  if (!body) return;
  body.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px">' +
      '<div id="plans-tabs" style="flex:1">' + renderTabs() + '</div>' +
      '<button id="plans-recompute" class="btn-secondary" style="font-size:11px;padding:6px 12px;white-space:nowrap" ' +
        'title="Scan recent assessments and auto-link any plans that should be completed">↻ Recompute outcomes</button>' +
    '</div>' +
    '<div id="plans-list" style="margin-top:14px">' +
      (V.loading
        ? '<div class="card">' + skeletonRows(5) + '</div>'
        : renderList()
      ) +
    '</div>';
  wireTabs();
  wireRecompute();
  if (!V.loading) wireList();
}

function wireRecompute() {
  var btn = el('plans-recompute');
  if (!btn) return;
  btn.addEventListener('click', function() {
    btn.disabled = true;
    btn.textContent = 'Scanning…';
    recomputeAllOutcomes({ schoolYear: SCHOOL_YEAR }, function(err, summary) {
      btn.disabled = false;
      btn.textContent = '↻ Recompute outcomes';
      if (err) {
        showToast('Recompute failed', 'error');
        return;
      }
      var msg = summary.completed > 0
        ? '✓ ' + summary.completed + ' plan' + (summary.completed === 1 ? '' : 's') +
          ' auto-completed (' + summary.evaluated + ' checked)'
        : 'Checked ' + summary.evaluated + ' active plan' +
          (summary.evaluated === 1 ? '' : 's') + ' — none ready yet';
      showToast(msg, summary.completed > 0 ? 'info' : 'info', 3500);
      if (summary.completed > 0) loadData();
    });
  });
}

function renderTabs() {
  var counts = countByStatus(V.plans);
  var tabs = [
    { k: 'active',    lb: 'Active',    n: counts.active },
    { k: 'awaiting',  lb: 'Awaiting',  n: counts.awaiting },
    { k: 'complete',  lb: 'Complete',  n: counts.complete },
    { k: 'all',       lb: 'All',       n: V.plans.length }
  ];
  return '<div class="tab-row" style="display:flex;gap:6px;flex-wrap:wrap">' +
    tabs.map(function(t) {
      var on = V.tab === t.k;
      return '<button class="tab' + (on ? ' on' : '') + '" data-plan-tab="' + t.k + '" ' +
        'style="font-size:12px;padding:6px 14px;border-radius:14px;cursor:pointer;' +
          'border:1px solid ' + (on ? 'var(--navy)' : 'var(--border)') + ';' +
          'background:' + (on ? 'rgba(39,26,112,.12)' : 'transparent') + ';' +
          'color:' + (on ? 'var(--navy)' : 'var(--text2)') + '">' +
        escHtml(t.lb) +
        '<span style="font-weight:400;font-size:11px;margin-left:6px;color:var(--text3)">' + t.n + '</span>' +
        '</button>';
    }).join('') +
  '</div>';
}

function renderList() {
  var filtered = filterPlans(V.plans, V.tab);
  if (!filtered.length) {
    var msgs = {
      active:   ['No active plans', 'Plans created in a Tuesday meeting will appear here.'],
      awaiting: ['No plans awaiting follow-up', 'When a plan\'s target check date passes without an update, it\'ll surface here.'],
      complete: ['No completed plans yet', 'Mark plans complete after the reteach assessment confirms improvement.'],
      all:      ['No action plans yet', 'Start a Tuesday meeting and create your first plan.']
    };
    var m = msgs[V.tab] || msgs.all;
    return emptyState(m[0], m[1]);
  }
  return filtered.map(renderPlanCard).join('');
}

function renderPlanCard(plan) {
  var statusBadge = renderStatusBadge(plan.status);
  var strategy = plan.reteach_strategy ? escHtml(prettifyStrategy(plan.reteach_strategy)) : null;
  var dateInfo = renderDates(plan);
  var students = renderStudentChips(plan);
  var outcome = renderOutcome(plan);
  var actions = renderActions(plan);

  return '<div class="card plan-card" data-plan-id="' + escHtml(plan.id) + '" ' +
    'style="margin-bottom:10px;padding:14px">' +
    // Header: topic + status
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px">' +
      '<div style="flex:1">' +
        '<div style="font-size:14px;font-weight:700;color:var(--text)">' + escHtml(plan.topic) + '</div>' +
        (plan.description
          ? '<div style="font-size:12px;color:var(--text2);margin-top:3px">' + escHtml(plan.description) + '</div>'
          : '') +
      '</div>' +
      '<div style="flex-shrink:0">' + statusBadge + '</div>' +
    '</div>' +
    // Meta row
    '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;align-items:center">' +
      (strategy ? '<span class="tag" style="font-size:10px;padding:2px 8px;background:rgba(39,26,112,.08);color:var(--navy);border-radius:10px">' + strategy + '</span>' : '') +
      '<span style="font-size:10px;color:var(--text3)">' + escHtml(plan.owner_email || 'unknown owner') + '</span>' +
      dateInfo +
    '</div>' +
    // Students chips
    students +
    // Outcome (if marked)
    outcome +
    // Actions
    actions +
  '</div>';
}

function renderStatusBadge(status) {
  var colors = {
    active:        { bg: 'rgba(39,26,112,.12)',  fg: 'var(--navy)',   lb: 'Active' },
    complete:      { bg: 'rgba(74,191,163,.18)', fg: '#287f6c',       lb: 'Complete' },
    partial:       { bg: 'rgba(232,197,71,.22)', fg: '#8a7314',       lb: 'Partial' },
    discontinued:  { bg: 'rgba(152,162,173,.22)', fg: 'var(--text3)', lb: 'Discontinued' }
  };
  var c = colors[status] || colors.active;
  return '<span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:10px;background:' + c.bg + ';color:' + c.fg + ';text-transform:uppercase;letter-spacing:.06em">' +
    escHtml(c.lb) + '</span>';
}

function renderDates(plan) {
  var parts = [];
  if (plan.created_at) {
    parts.push('Created ' + formatDate(plan.created_at.slice(0, 10)));
  }
  if (plan.target_check_date) {
    var d = new Date(plan.target_check_date + 'T12:00:00');
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var overdue = plan.status === 'active' && d < today;
    parts.push(
      '<span style="' + (overdue ? 'color:#a82828;font-weight:700' : '') + '">' +
        (overdue ? '⚠ Check due ' : 'Check by ') + formatDate(plan.target_check_date) +
      '</span>'
    );
  }
  return '<span style="font-size:10px;color:var(--text3);margin-left:auto">' +
    parts.join(' · ') +
  '</span>';
}

function renderStudentChips(plan) {
  var rels = plan.action_plan_students || [];
  if (!rels.length) {
    return '<div style="font-size:11px;color:var(--text3);font-style:italic;margin-bottom:8px">No students attached</div>';
  }
  var chips = rels.map(function(rel) {
    var s = V.studentMap[rel.clever_id];
    var name = s ? niceName(s) : rel.clever_id;
    return '<span class="stu-name-link plan-stu-chip" data-stu="' + escHtml(name) + '" ' +
      'style="font-size:11px;padding:3px 8px;border:1px solid var(--border);border-radius:10px;' +
        'background:transparent;color:var(--text2);cursor:pointer">' +
      escHtml(name) + '</span>';
  }).join(' ');
  return '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">' + chips + '</div>';
}

function renderOutcome(plan) {
  if (plan.status === 'active') return '';
  var delta = plan.outcome_avg_delta;
  var hasDelta = delta !== null && delta !== undefined;
  var deltaColor = hasDelta && delta > 0 ? '#287f6c' : hasDelta && delta < 0 ? '#a82828' : 'var(--text3)';
  var deltaText = hasDelta
    ? (delta > 0 ? '+' : '') + Math.round(delta * 10) / 10 + ' pts'
    : '—';
  var isAuto = plan.follow_up_event_id && plan.outcome_notes &&
    plan.outcome_notes.indexOf('Auto-completed') === 0;
  var sourceLabel = isAuto ? 'Auto-completed' : 'Outcome';

  // Per-student delta breakdown — only rendered for auto-completed plans
  // (we have a deterministic source vs follow-up pair to compare).
  var breakdownHtml = '';
  var breakdown = V.breakdowns[plan.id];
  if (isAuto && breakdown && breakdown.length) {
    breakdownHtml =
      '<div style="margin-top:10px;padding-top:8px;border-top:0.5px solid var(--border)">' +
        '<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Per-scholar deltas</div>' +
        breakdown.map(renderStudentDeltaBar).join('') +
      '</div>';
  }

  return '<div style="padding:8px 10px;background:var(--panel);border-radius:6px;margin-bottom:8px">' +
    '<div style="display:flex;justify-content:space-between;align-items:center">' +
      '<div style="font-size:10px;color:' + (isAuto ? 'var(--navy)' : 'var(--text3)') +
        ';text-transform:uppercase;letter-spacing:.06em;font-weight:' + (isAuto ? '700' : '400') + '">' +
        (isAuto ? '✓ ' : '') + sourceLabel +
      '</div>' +
      '<div style="font-size:14px;font-weight:700;color:' + deltaColor + '">' + deltaText + '</div>' +
    '</div>' +
    (plan.outcome_notes
      ? '<div style="font-size:11px;color:var(--text2);margin-top:4px">' + escHtml(plan.outcome_notes) + '</div>'
      : '') +
    breakdownHtml +
  '</div>';
}

// Single row: scholar name | bar | delta. Bars are normalized: a +30 pt gain
// fills the green half; a -30 pt drop fills the red half. Anything beyond
// 30 pts clips to the edge — these are pilot-data magnitudes; rescale later
// if real datasets show consistently larger swings.
function renderStudentDeltaBar(item) {
  var maxAbsForVis = 30; // pts; visual range
  var d = item.delta;
  var hasDelta = d !== null && d !== undefined;
  var pct = hasDelta ? Math.min(1, Math.abs(d) / maxAbsForVis) : 0;
  var color = hasDelta ? (d > 0 ? '#4ABFA3' : d < 0 ? '#D63B3B' : '#98A2AD') : 'var(--border)';
  var deltaText = hasDelta
    ? (d > 0 ? '+' : '') + Math.round(d * 10) / 10
    : '—';

  // Two-tone bar with center pivot
  var leftPct = (d < 0) ? (pct * 50) : 0;
  var rightPct = (d > 0) ? (pct * 50) : 0;

  return '<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:11px">' +
    '<span style="flex:1;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
      escHtml(item.student_name) +
    '</span>' +
    '<div style="position:relative;width:100px;height:6px;background:var(--border);border-radius:3px;flex-shrink:0">' +
      '<div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:var(--text3);opacity:.5"></div>' +
      (d > 0
        ? '<div style="position:absolute;left:50%;top:0;bottom:0;width:' + rightPct.toFixed(1) + '%;background:' + color + ';border-radius:0 3px 3px 0"></div>'
        : '') +
      (d < 0
        ? '<div style="position:absolute;right:50%;top:0;bottom:0;width:' + leftPct.toFixed(1) + '%;background:' + color + ';border-radius:3px 0 0 3px"></div>'
        : '') +
    '</div>' +
    '<span style="width:40px;text-align:right;color:' +
      (hasDelta && d > 0 ? '#287f6c' : hasDelta && d < 0 ? '#a82828' : 'var(--text3)') +
      ';font-weight:700">' + deltaText + '</span>' +
  '</div>';
}

function renderActions(plan) {
  if (plan.status !== 'active') {
    // Already marked — allow edit or undo
    return '<div style="display:flex;gap:6px;justify-content:flex-end">' +
      '<button class="plan-act-edit" data-plan-id="' + escHtml(plan.id) + '" ' +
        'style="font-size:10px;padding:4px 10px;background:transparent;border:1px solid var(--border);border-radius:4px;cursor:pointer;color:var(--text2)">Edit outcome</button>' +
      '<button class="plan-act-reopen" data-plan-id="' + escHtml(plan.id) + '" ' +
        'style="font-size:10px;padding:4px 10px;background:transparent;border:1px solid var(--border);border-radius:4px;cursor:pointer;color:var(--text2)">Reopen</button>' +
      '<button class="plan-act-delete" data-plan-id="' + escHtml(plan.id) + '" ' +
        'style="font-size:10px;padding:4px 10px;background:transparent;border:1px solid var(--border);border-radius:4px;cursor:pointer;color:var(--red)">Delete</button>' +
    '</div>';
  }
  // Active — show mark-outcome buttons
  return '<div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">' +
    '<button class="plan-act-complete" data-plan-id="' + escHtml(plan.id) + '" ' +
      'style="font-size:11px;padding:5px 12px;background:rgba(74,191,163,.15);border:1px solid #287f6c;border-radius:4px;cursor:pointer;color:#287f6c;font-weight:600">Mark complete</button>' +
    '<button class="plan-act-partial" data-plan-id="' + escHtml(plan.id) + '" ' +
      'style="font-size:11px;padding:5px 12px;background:transparent;border:1px solid var(--border);border-radius:4px;cursor:pointer;color:var(--text2)">Partial</button>' +
    '<button class="plan-act-discontinue" data-plan-id="' + escHtml(plan.id) + '" ' +
      'style="font-size:11px;padding:5px 12px;background:transparent;border:1px solid var(--border);border-radius:4px;cursor:pointer;color:var(--text2)">Discontinue</button>' +
    '<button class="plan-act-delete" data-plan-id="' + escHtml(plan.id) + '" ' +
      'style="font-size:11px;padding:5px 12px;background:transparent;border:1px solid var(--border);border-radius:4px;cursor:pointer;color:var(--red)">Delete</button>' +
  '</div>';
}

// ── WIRING ──────────────────────────────────────────────────────────────────
function wireTabs() {
  document.querySelectorAll('#plans-tabs [data-plan-tab]').forEach(function(b) {
    b.addEventListener('click', function() {
      V.tab = b.dataset.planTab;
      var t = el('plans-tabs');
      if (t) t.innerHTML = renderTabs();
      wireTabs();
      var l = el('plans-list');
      if (l) l.innerHTML = renderList();
      wireList();
    });
  });
}

function wireList() {
  // Student chip → profile
  document.querySelectorAll('#plans-list .plan-stu-chip').forEach(function(c) {
    c.addEventListener('click', function(e) {
      e.stopPropagation();
      openStudent(c.dataset.stu, 'S-academics-plans');
    });
  });

  function findPlan(id) {
    return V.plans.find(function(p) { return p.id === id; });
  }

  document.querySelectorAll('#plans-list .plan-act-complete').forEach(function(b) {
    b.addEventListener('click', function() {
      openOutcomeModal(findPlan(b.dataset.planId), 'complete');
    });
  });
  document.querySelectorAll('#plans-list .plan-act-partial').forEach(function(b) {
    b.addEventListener('click', function() {
      openOutcomeModal(findPlan(b.dataset.planId), 'partial');
    });
  });
  document.querySelectorAll('#plans-list .plan-act-discontinue').forEach(function(b) {
    b.addEventListener('click', function() {
      openOutcomeModal(findPlan(b.dataset.planId), 'discontinued');
    });
  });
  document.querySelectorAll('#plans-list .plan-act-edit').forEach(function(b) {
    b.addEventListener('click', function() {
      var plan = findPlan(b.dataset.planId);
      openOutcomeModal(plan, plan.status);
    });
  });
  document.querySelectorAll('#plans-list .plan-act-reopen').forEach(function(b) {
    b.addEventListener('click', function() {
      var plan = findPlan(b.dataset.planId);
      if (!plan) return;
      if (!confirm('Reopen "' + plan.topic + '"? This clears the outcome.')) return;
      updateActionPlan(plan.id, {
        status: 'active',
        outcome_avg_delta: null,
        outcome_notes: null
      }, function(err, updated) {
        if (err) { showToast('Reopen failed', 'error'); return; }
        applyPlanUpdate(updated);
      });
    });
  });
  document.querySelectorAll('#plans-list .plan-act-delete').forEach(function(b) {
    b.addEventListener('click', function() {
      var plan = findPlan(b.dataset.planId);
      if (!plan) return;
      if (!confirm('Delete "' + plan.topic + '"? This cannot be undone.')) return;
      deleteActionPlan(plan.id, function(err) {
        if (err) { showToast('Delete failed', 'error'); return; }
        V.plans = V.plans.filter(function(p) { return p.id !== plan.id; });
        rerenderAll();
        showToast('Plan deleted', 'info', 1500);
      });
    });
  });
}

// ── OUTCOME MODAL ───────────────────────────────────────────────────────────
function openOutcomeModal(plan, targetStatus) {
  if (!plan) return;
  closeOutcomeModal();
  var modal = document.createElement('div');
  modal.id = 'plan-outcome-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px';

  var statusOptions = ['complete', 'partial', 'discontinued']
    .map(function(s) {
      var sel = s === targetStatus ? ' selected' : '';
      return '<option value="' + s + '"' + sel + '">' + capitalize(s) + '</option>';
    }).join('');

  modal.innerHTML =
    '<div style="background:var(--bg);max-width:460px;width:100%;border-radius:10px;padding:18px;border:1px solid var(--border)">' +
      '<div style="font-size:14px;font-weight:700;margin-bottom:4px">Mark outcome</div>' +
      '<div style="font-size:12px;color:var(--text2);margin-bottom:14px">' + escHtml(plan.topic) + '</div>' +
      '<div style="margin-bottom:10px">' +
        '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Status</div>' +
        '<select id="plan-out-status" class="input" style="width:100%">' + statusOptions + '</select>' +
      '</div>' +
      '<div style="margin-bottom:10px">' +
        '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Avg score delta (optional)</div>' +
        '<input id="plan-out-delta" type="number" step="0.1" class="input" style="width:100%" ' +
          'placeholder="+12 if scores improved by 12 pts, -3 if dropped" ' +
          'value="' + (plan.outcome_avg_delta != null ? plan.outcome_avg_delta : '') + '">' +
        '<div style="font-size:10px;color:var(--text3);margin-top:3px">' +
          'For now, eyeball this from the data. Auto-computation lands in the next release.' +
        '</div>' +
      '</div>' +
      '<div style="margin-bottom:14px">' +
        '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Notes</div>' +
        '<textarea id="plan-out-notes" class="input" style="width:100%;min-height:70px;font-family:inherit;font-size:12px" ' +
          'placeholder="What happened? Did the reteach land?">' + escHtml(plan.outcome_notes || '') + '</textarea>' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button id="plan-out-cancel" class="btn-secondary">Cancel</button>' +
        '<button id="plan-out-save" class="btn-primary">Save</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  document.getElementById('plan-out-cancel').addEventListener('click', closeOutcomeModal);
  document.getElementById('plan-out-save').addEventListener('click', function() {
    var btn = document.getElementById('plan-out-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    var patch = {
      status: document.getElementById('plan-out-status').value,
      outcome_notes: (document.getElementById('plan-out-notes').value || '').trim() || null
    };
    var deltaRaw = (document.getElementById('plan-out-delta').value || '').trim();
    patch.outcome_avg_delta = deltaRaw === '' ? null : Number(deltaRaw);
    if (patch.outcome_avg_delta !== null && isNaN(patch.outcome_avg_delta)) {
      btn.disabled = false; btn.textContent = 'Save';
      showToast('Delta must be a number', 'error');
      return;
    }
    updateActionPlan(plan.id, patch, function(err, updated) {
      if (err) {
        btn.disabled = false; btn.textContent = 'Save';
        showToast('Save failed', 'error');
        return;
      }
      applyPlanUpdate(updated);
      closeOutcomeModal();
      showToast('Outcome saved', 'info', 1500);
    });
  });
}

function closeOutcomeModal() {
  var m = document.getElementById('plan-outcome-modal');
  if (m) m.remove();
}

function applyPlanUpdate(updated) {
  if (!updated) return;
  var idx = V.plans.findIndex(function(p) { return p.id === updated.id; });
  if (idx >= 0) {
    // Preserve the embedded action_plan_students from the original
    updated.action_plan_students = V.plans[idx].action_plan_students;
    V.plans[idx] = updated;
  }
  rerenderAll();
}

function rerenderAll() {
  var t = el('plans-tabs');
  if (t) t.innerHTML = renderTabs();
  wireTabs();
  var l = el('plans-list');
  if (l) l.innerHTML = renderList();
  wireList();
}

// ── HELPERS ─────────────────────────────────────────────────────────────────
function countByStatus(plans) {
  var counts = { active: 0, awaiting: 0, complete: 0 };
  var today = new Date(); today.setHours(0, 0, 0, 0);
  plans.forEach(function(p) {
    if (p.status === 'active') {
      // 'awaiting' = active + overdue target check
      if (p.target_check_date) {
        var d = new Date(p.target_check_date + 'T12:00:00');
        if (d < today) counts.awaiting++;
        else counts.active++;
      } else {
        counts.active++;
      }
    } else if (p.status === 'complete' || p.status === 'partial' || p.status === 'discontinued') {
      counts.complete++;
    }
  });
  return counts;
}

function filterPlans(plans, tab) {
  if (tab === 'all') return plans;
  var today = new Date(); today.setHours(0, 0, 0, 0);
  if (tab === 'active') {
    return plans.filter(function(p) {
      if (p.status !== 'active') return false;
      if (p.target_check_date) {
        var d = new Date(p.target_check_date + 'T12:00:00');
        return d >= today;
      }
      return true;
    });
  }
  if (tab === 'awaiting') {
    return plans.filter(function(p) {
      if (p.status !== 'active') return false;
      if (!p.target_check_date) return false;
      var d = new Date(p.target_check_date + 'T12:00:00');
      return d < today;
    });
  }
  if (tab === 'complete') {
    return plans.filter(function(p) {
      return p.status === 'complete' || p.status === 'partial' || p.status === 'discontinued';
    });
  }
  return plans;
}

function loadData() {
  V.loading = true;
  renderShell();
  fetchActionPlans({ schoolYear: SCHOOL_YEAR }, function(err, plans) {
    if (err) {
      V.loading = false;
      V.plans = [];
      showToast('Could not load action plans', 'error');
      renderShell();
      return;
    }
    V.plans = plans;
    // Resolve student names for all clever_ids referenced
    var allCleverIds = {};
    plans.forEach(function(p) {
      (p.action_plan_students || []).forEach(function(rel) { allCleverIds[rel.clever_id] = true; });
    });
    var ids = Object.keys(allCleverIds);

    // Fetch per-student outcome breakdowns for all auto-completed plans
    // (those with both source and follow_up event ids). Used by renderOutcome
    // to draw the per-scholar delta bars. Fires in parallel with the
    // student-name fetch; either failing degrades gracefully (bars just
    // don't render, plan card still works).
    var autoPlans = plans.filter(function(p) {
      return p.source_assessment_event_id && p.follow_up_event_id;
    });

    var nameP = ids.length
      ? fetchStudentsByCleverIds(ids).then(function(m) { V.studentMap = m || {}; })
      : Promise.resolve();

    var breakdownP = Promise.all(autoPlans.map(function(p) {
      return fetchPlanOutcomeBreakdown(p)
        .then(function(b) { if (b) V.breakdowns[p.id] = b; })
        .catch(function() { /* swallow per-plan errors */ });
    }));

    Promise.all([nameP, breakdownP]).then(function() {
      V.loading = false;
      renderShell();
    });
  });
}

// ── UTIL ────────────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function niceName(s) {
  if (s.first_name && s.last_name) return s.first_name + ' ' + s.last_name;
  return s.student_name || s.clever_id || '?';
}

function prettifyStrategy(s) {
  return s.replace(/_/g, ' ').replace(/^./, function(c) { return c.toUpperCase(); });
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    var d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch (e) { return dateStr; }
}
