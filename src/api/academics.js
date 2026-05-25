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

// Resolve a list of clever_ids to student records. Used by views that
// need to show names for arbitrary student sets (e.g. action plans that
// span grades). Cap large lists in the caller.
export function fetchStudentsByCleverIds(cleverIds, cb) {
  if (!cleverIds || !cleverIds.length) {
    if (cb) cb(null, {});
    return Promise.resolve({});
  }
  var inClause = 'in.(' + cleverIds.map(function(id) {
    // Wrap each id in quotes for PostgREST when the value has special chars
    return '"' + String(id).replace(/"/g, '\\"') + '"';
  }).join(',') + ')';
  var params = [
    'select=clever_id,student_name,first_name,last_name,homeroom,grade',
    'clever_id=' + inClause
  ];
  return authedFetch(REST + '/students?' + params.join('&'))
    .then(function(r) { return r.json(); })
    .then(function(rows) {
      var map = {};
      (Array.isArray(rows) ? rows : []).forEach(function(s) { map[s.clever_id] = s; });
      if (cb) cb(null, map);
      return map;
    })
    .catch(function(err) { if (cb) cb(err, {}); throw err; });
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

// ── DATA MEETINGS ───────────────────────────────────────────────────────────

// Create a new data_meeting row. Returns the created row including its id,
// which is needed to attach action plans to the meeting.
export function createDataMeeting(data, cb) {
  var row = Object.assign({
    meeting_date: new Date().toISOString().slice(0, 10),
    facilitator_email: (SESSION && SESSION.email) || null,
    attendees: [],
    school_year: '2025-26'
  }, data || {});

  return authedFetch(REST + '/data_meetings', {
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

// Patch a meeting (typically: agenda_notes when meeting ends).
export function updateDataMeeting(id, patch, cb) {
  return authedFetch(REST + '/data_meetings?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify(patch)
  })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (cb) cb(null);
    })
    .catch(function(err) { if (cb) cb(err); throw err; });
}

// Recent meetings for a grade × subject (used to find "last meeting" so the
// current meeting can review last meeting's plans).
export function fetchRecentMeetings(opts, cb) {
  opts = opts || {};
  var params = ['select=*', 'order=meeting_date.desc,created_at.desc'];
  if (opts.gradeLevel) params.push('grade_level=eq.' + encodeURIComponent(opts.gradeLevel));
  if (opts.subject)    params.push('subject=eq.' + encodeURIComponent(opts.subject));
  if (opts.schoolYear) params.push('school_year=eq.' + encodeURIComponent(opts.schoolYear));
  params.push('limit=' + (opts.limit || 10));

  return authedFetch(REST + '/data_meetings?' + params.join('&'))
    .then(function(r) { return r.json(); })
    .then(function(rows) {
      var data = Array.isArray(rows) ? rows : [];
      if (cb) cb(null, data);
      return data;
    })
    .catch(function(err) { if (cb) cb(err, []); throw err; });
}

// ── ACTION PLANS ────────────────────────────────────────────────────────────

// Atomically create an action plan + its targeted students. Two-step insert
// since PostgREST doesn't support nested-table inserts. Rolls back the plan
// if the student-attach step fails so we never leave orphan plans.
//
// planData: { data_meeting_id, topic, source_assessment_event_id, reteach_strategy,
//             description, owner_email, target_check_date, school_year }
// cleverIds: array of clever_id strings (the students being targeted)
export function createActionPlan(planData, cleverIds, cb) {
  var row = Object.assign({
    owner_email: (SESSION && SESSION.email) || 'unknown',
    status: 'active',
    school_year: '2025-26'
  }, planData || {});

  return authedFetch(REST + '/action_plans', {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(row)
  })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(rows) {
      var plan = rows && rows[0];
      if (!plan) throw new Error('Plan insert returned no row');
      if (!cleverIds || !cleverIds.length) {
        if (cb) cb(null, plan);
        return plan;
      }
      var assoc = cleverIds.map(function(cid) {
        return { action_plan_id: plan.id, clever_id: cid };
      });
      return authedFetch(REST + '/action_plan_students', {
        method: 'POST',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify(assoc)
      }).then(function(r2) {
        if (!r2.ok) {
          return authedFetch(REST + '/action_plans?id=eq.' + encodeURIComponent(plan.id), {
            method: 'DELETE',
            headers: { 'Prefer': 'return=minimal' }
          }).then(function() { throw new Error('Student attach failed; plan rolled back'); });
        }
        if (cb) cb(null, plan);
        return plan;
      });
    })
    .catch(function(err) { if (cb) cb(err); throw err; });
}

// Patch an action plan (status, outcome notes, outcome_avg_delta, etc.)
export function updateActionPlan(id, patch, cb) {
  return authedFetch(REST + '/action_plans?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(patch)
  })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(rows) {
      var updated = rows && rows[0];
      if (cb) cb(null, updated);
      return updated;
    })
    .catch(function(err) { if (cb) cb(err); throw err; });
}

// Fetch action plans + their targeted students in one go via PostgREST
// foreign-table embedding.
//
// opts: { status?, ownerEmail?, dataMeetingId?, schoolYear?, limit? }
// Returns: [{ ...plan, action_plan_students: [{clever_id}, ...] }]
export function fetchActionPlans(opts, cb) {
  opts = opts || {};
  var params = [
    'select=*,action_plan_students(clever_id)',
    'order=created_at.desc'
  ];
  if (opts.status)         params.push('status=eq.' + encodeURIComponent(opts.status));
  if (opts.ownerEmail)     params.push('owner_email=eq.' + encodeURIComponent(opts.ownerEmail));
  if (opts.dataMeetingId)  params.push('data_meeting_id=eq.' + encodeURIComponent(opts.dataMeetingId));
  if (opts.schoolYear)     params.push('school_year=eq.' + encodeURIComponent(opts.schoolYear));
  params.push('limit=' + (opts.limit || 100));

  return authedFetch(REST + '/action_plans?' + params.join('&'))
    .then(function(r) { return r.json(); })
    .then(function(rows) {
      var data = Array.isArray(rows) ? rows : [];
      if (cb) cb(null, data);
      return data;
    })
    .catch(function(err) { if (cb) cb(err, []); throw err; });
}

// Delete an action plan. Cascades to action_plan_students via FK.
export function deleteActionPlan(id, cb) {
  return authedFetch(REST + '/action_plans?id=eq.' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: { 'Prefer': 'return=minimal' }
  })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (cb) cb(null);
    })
    .catch(function(err) { if (cb) cb(err); throw err; });
}

// ── BULK FETCH SCORES FOR MANY EVENTS ───────────────────────────────────────
// PostgREST `in.()` filter on assessment_event_id. Used by the binder.
// Returns: { 'cleverId|eventId': score row, ... }
export function fetchScoresForEvents(eventIds, cb) {
  if (!eventIds || !eventIds.length) {
    if (cb) cb(null, {});
    return Promise.resolve({});
  }
  // PostgREST `in` syntax: in.(id1,id2,id3)
  var inClause = 'in.(' + eventIds.map(function(id) { return encodeURIComponent(id); }).join(',') + ')';
  var params = [
    'select=id,clever_id,assessment_event_id,score,proficiency,notes,recorded_at,recorded_by',
    'assessment_event_id=' + inClause
  ];
  return authedFetch(REST + '/academic_scores?' + params.join('&'))
    .then(function(r) { return r.json(); })
    .then(function(rows) {
      var map = {};
      (Array.isArray(rows) ? rows : []).forEach(function(r) {
        map[r.clever_id + '|' + r.assessment_event_id] = r;
      });
      if (cb) cb(null, map);
      return map;
    })
    .catch(function(err) { if (cb) cb(err, {}); throw err; });
}

// ── BINDER DATA FETCH ───────────────────────────────────────────────────────
// One call to assemble everything the binder grid needs: events (columns),
// roster (rows), and scores (cells). Parallel fetches under the hood.
//
// opts: { gradeLevel, subject, dateFrom?, dateTo?, schoolYear?, limit? }
// Returns: { events: [...], roster: [...], scoresByCell: { 'cleverId|eventId': scoreRow }, error: optional }
export function fetchBinderData(opts, cb) {
  opts = opts || {};
  // 1. Fetch events first so we know which event_ids to ask for scores on.
  var eventOpts = {
    gradeLevel: opts.gradeLevel,
    subject: opts.subject,
    schoolYear: opts.schoolYear,
    limit: opts.limit || 50
  };
  var eventParams = ['select=*', 'order=administered_date.asc,created_at.asc'];
  if (eventOpts.gradeLevel) eventParams.push('grade_level=eq.' + encodeURIComponent(eventOpts.gradeLevel));
  if (eventOpts.subject)    eventParams.push('subject=eq.' + encodeURIComponent(eventOpts.subject));
  if (eventOpts.schoolYear) eventParams.push('school_year=eq.' + encodeURIComponent(eventOpts.schoolYear));
  if (opts.dateFrom)        eventParams.push('administered_date=gte.' + encodeURIComponent(opts.dateFrom));
  if (opts.dateTo)          eventParams.push('administered_date=lte.' + encodeURIComponent(opts.dateTo));
  eventParams.push('limit=' + (eventOpts.limit || 50));

  var eventsPromise = authedFetch(REST + '/assessment_events?' + eventParams.join('&'))
    .then(function(r) { return r.json(); })
    .then(function(rows) { return Array.isArray(rows) ? rows : []; });

  var rosterPromise = fetchRosterByGrade(opts.gradeLevel, { schoolYear: opts.schoolYear });

  return Promise.all([eventsPromise, rosterPromise])
    .then(function(results) {
      var events = results[0];
      var roster = results[1];
      // Now fetch scores for those events.
      var eventIds = events.map(function(e) { return e.id; });
      return fetchScoresForEvents(eventIds).then(function(scoresByCell) {
        var out = { events: events, roster: roster, scoresByCell: scoresByCell };
        if (cb) cb(null, out);
        return out;
      });
    })
    .catch(function(err) {
      var out = { events: [], roster: [], scoresByCell: {}, error: err };
      if (cb) cb(err, out);
      return out;
    });
}
