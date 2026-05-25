// ─────────────────────────────────────────────────────────────────────────────
// Academics API — assessment events, scores, roster, action plans.
//
// Each function takes a node-style (err, data) callback so it composes with
// the existing fetch helpers in main.js (fetchClassRoster, fetchUnifiedRecords,
// etc.). Promises returned for callers who prefer them.
// ─────────────────────────────────────────────────────────────────────────────

import { SB_URL, SB_KEY } from '../config.js';
import { SESSION, authedFetch } from '../main.js';

var REST = '/rest/v1';

// ── PROFICIENCY HELPER ──────────────────────────────────────────────────────
// Pure function — no fetch. Used by entry UI and binder rendering alike.
export function computeProficiency(score, maxScore, thresholds) {
  if (score === null || score === undefined || isNaN(score)) return null;
  var max = Number(maxScore) || 100;
  var pct = (Number(score) / max) * 100;
  var t = thresholds || { red: 60, yellow: 80 };
  if (pct < t.red) return 'red';
  if (pct < t.yellow) return 'yellow';
  return 'green';
}

// ── ASSESSMENT EVENTS ───────────────────────────────────────────────────────

// Recent events for the picker dropdown. Filter by grade+subject when known.
export function fetchAssessmentEvents(opts, cb) {
  opts = opts || {};
  var params = ['select=*', 'order=administered_date.desc,created_at.desc'];
  if (opts.gradeLevel) params.push('grade_level=eq.' + encodeURIComponent(opts.gradeLevel));
  if (opts.subject)    params.push('subject=eq.' + encodeURIComponent(opts.subject));
  if (opts.schoolYear) params.push('school_year=eq.' + encodeURIComponent(opts.schoolYear));
  var limit = opts.limit || 50;
  params.push('limit=' + limit);

  return authedFetch(REST + '/assessment_events?' + params.join('&'))
    .then(function(r) { return r.json(); })
    .then(function(rows) {
      var data = Array.isArray(rows) ? rows : [];
      if (cb) cb(null, data);
      return data;
    })
    .catch(function(err) { if (cb) cb(err, []); throw err; });
}

// Create a new assessment event. `data` shape:
//   { title, subject, grade_level, topic, administered_date, max_score, school_year }
export function createAssessmentEvent(data, cb) {
  var row = Object.assign({
    max_score: 100,
    administered_date: new Date().toISOString().slice(0, 10),
    created_by: (SESSION && SESSION.email) || 'unknown'
  }, data || {});

  return authedFetch(REST + '/assessment_events', {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(row)
  })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(rows) {
      var created = rows && rows[0];
      if (cb) cb(null, created);
      return created;
    })
    .catch(function(err) { if (cb) cb(err); throw err; });
}

// ── ROSTER ──────────────────────────────────────────────────────────────────

// All active students in a grade, sorted by homeroom then last name.
// Returns: [{ clever_id, student_name, first_name, last_name, homeroom, grade }, ...]
export function fetchRosterByGrade(gradeLevel, opts, cb) {
  opts = opts || {};
  var params = [
    'select=clever_id,student_name,first_name,last_name,homeroom,grade,grade_code',
    'active=eq.true',
    'order=homeroom.asc,last_name.asc,first_name.asc'
  ];
  // Try both `grade` and `grade_code` since the column name varies.
  if (gradeLevel != null) {
    params.push('or=(grade.eq.' + encodeURIComponent(gradeLevel) +
                ',grade_code.eq.' + encodeURIComponent(gradeLevel) + ')');
  }
  if (opts.schoolYear) params.push('school_year=eq.' + encodeURIComponent(opts.schoolYear));

  return authedFetch(REST + '/students?' + params.join('&'))
    .then(function(r) { return r.json(); })
    .then(function(rows) {
      var data = (Array.isArray(rows) ? rows : []).filter(function(s) {
        // Defensive: only students with a clever_id are joinable for academics
        return !!s.clever_id;
      });
      if (cb) cb(null, data);
      return data;
    })
    .catch(function(err) { if (cb) cb(err, []); throw err; });
}

// ── SCORES ──────────────────────────────────────────────────────────────────

// All scores for an assessment, keyed by clever_id for fast lookup in render.
// Returns: { cleverId: { id, score, proficiency, notes, recorded_at }, ... }
export function fetchScoresForAssessment(assessmentEventId, cb) {
  var params = [
    'select=id,clever_id,score,proficiency,notes,recorded_at,recorded_by',
    'assessment_event_id=eq.' + encodeURIComponent(assessmentEventId)
  ];
  return authedFetch(REST + '/academic_scores?' + params.join('&'))
    .then(function(r) { return r.json(); })
    .then(function(rows) {
      var map = {};
      (Array.isArray(rows) ? rows : []).forEach(function(r) { map[r.clever_id] = r; });
      if (cb) cb(null, map);
      return map;
    })
    .catch(function(err) { if (cb) cb(err, {}); throw err; });
}

// Upsert a score. Uses PostgREST's on_conflict to update if (clever_id,
// assessment_event_id) already exists. Computes proficiency client-side and
// stores it so binder queries don't have to recompute.
//
// scoreData: { clever_id, assessment_event_id, score, max_score, thresholds,
//              homeroom, notes }
export function upsertScore(scoreData, cb) {
  var max = scoreData.max_score || 100;
  var thresholds = scoreData.thresholds || { red: 60, yellow: 80 };
  var proficiency = computeProficiency(scoreData.score, max, thresholds);

  var row = {
    clever_id: scoreData.clever_id,
    assessment_event_id: scoreData.assessment_event_id,
    score: scoreData.score,            // null = absent / cleared
    proficiency: proficiency,
    homeroom: scoreData.homeroom || null,
    recorded_by: (SESSION && SESSION.email) || 'unknown',
    notes: scoreData.notes || null
  };

  return authedFetch(REST + '/academic_scores?on_conflict=clever_id,assessment_event_id', {
    method: 'POST',
    headers: {
      'Prefer': 'return=representation,resolution=merge-duplicates'
    },
    body: JSON.stringify(row)
  })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(rows) {
      var saved = rows && rows[0];
      if (cb) cb(null, saved);
      return saved;
    })
    .catch(function(err) { if (cb) cb(err); throw err; });
}

// Delete a score (used when a teacher clears a cell intentionally rather
// than marking absent — absent is score=null, not a deleted row).
export function deleteScore(scoreId, cb) {
  return authedFetch(REST + '/academic_scores?id=eq.' + encodeURIComponent(scoreId), {
    method: 'DELETE',
    headers: { 'Prefer': 'return=minimal' }
  })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (cb) cb(null);
    })
    .catch(function(err) { if (cb) cb(err); throw err; });
}
