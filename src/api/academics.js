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

// ── CLOSED-LOOP OUTCOME MATCHING ────────────────────────────────────────────
// When a new score is entered, check whether it completes any active action
// plans. A plan is "completed" by this score when:
//   1. The score's student is targeted by the plan
//   2. The plan's topic matches the new event's topic (case-insensitive,
//      substring either direction)
//   3. The plan has no follow_up_event_id yet (not already matched)
//   4. ALL of the plan's target students have non-null scores on this event
//   5. The plan has a source_assessment_event_id (so we can compute a delta)
//
// When all five conditions hit, the plan's follow_up_event_id is set, the
// outcome_avg_delta is computed (mean of per-student percent-point gains
// vs the source assessment), and status flips to 'complete'.
//
// Returns: { updatedPlans: [{plan, delta, perStudent: [...]}], errors: [...] }
export function matchClosedLoop(score, event, cb) {
  if (!score || !event || !score.clever_id || !event.id) {
    if (cb) cb(null, { updatedPlans: [], errors: [] });
    return Promise.resolve({ updatedPlans: [], errors: [] });
  }

  // Step 1: find plans this student is targeted by, active, no follow-up yet,
  // with a source_assessment_event_id (so a delta is computable).
  var planParams = [
    'select=*,action_plan_students(clever_id)',
    'status=eq.active',
    'follow_up_event_id=is.null',
    'source_assessment_event_id=not.is.null',
    'action_plan_students.clever_id=eq.' + encodeURIComponent(score.clever_id)
  ];

  return authedFetch(REST + '/action_plans?' + planParams.join('&'))
    .then(function(r) { return r.json(); })
    .then(function(rows) {
      var candidates = Array.isArray(rows) ? rows : [];
      // PostgREST returns embedded action_plan_students filtered by the
      // join clause, so candidates are only plans that contain this student.
      // But re-filter defensively in case server semantics differ:
      candidates = candidates.filter(function(p) {
        var rels = p.action_plan_students || [];
        return rels.some(function(rel) { return rel.clever_id === score.clever_id; });
      });

      // Topic match filter
      candidates = candidates.filter(function(p) {
        return topicsMatch(p.topic, event.topic);
      });

      if (!candidates.length) {
        if (cb) cb(null, { updatedPlans: [], errors: [] });
        return { updatedPlans: [], errors: [] };
      }

      // For each candidate plan, evaluate the closed-loop conditions.
      // Note: action_plan_students embedded above was filtered to this student
      // only. We need the FULL target set, so re-fetch for each plan.
      return Promise.all(candidates.map(function(plan) {
        return evaluatePlanForCompletion(plan, event)
          .catch(function(err) {
            return { plan: plan, error: err, completed: false };
          });
      })).then(function(results) {
        var updatedPlans = [];
        var errors = [];
        results.forEach(function(r) {
          if (r.error) errors.push({ planId: r.plan.id, error: r.error });
          else if (r.completed) updatedPlans.push(r);
        });
        if (cb) cb(null, { updatedPlans: updatedPlans, errors: errors });
        return { updatedPlans: updatedPlans, errors: errors };
      });
    })
    .catch(function(err) {
      if (cb) cb(err, { updatedPlans: [], errors: [{ error: err }] });
      throw err;
    });
}

// Re-runs the matcher across recent scores. Used by the Action Plans
// "Recompute outcomes" button to catch up plans that didn't auto-complete
// (e.g. scores entered before this feature shipped, or bulk paste edge cases).
//
// Strategy: pull all active plans with source_assessment_event_id set, then
// for each plan, look at recent assessment events with matching topic in the
// same school year, and check if any complete the plan.
export function recomputeAllOutcomes(opts, cb) {
  opts = opts || {};
  var schoolYear = opts.schoolYear || '2025-26';

  // Active plans needing a follow-up
  var planParams = [
    'select=*,action_plan_students(clever_id)',
    'status=eq.active',
    'follow_up_event_id=is.null',
    'source_assessment_event_id=not.is.null',
    'school_year=eq.' + encodeURIComponent(schoolYear),
    'limit=200'
  ];

  return authedFetch(REST + '/action_plans?' + planParams.join('&'))
    .then(function(r) { return r.json(); })
    .then(function(plans) {
      plans = Array.isArray(plans) ? plans : [];
      if (!plans.length) {
        if (cb) cb(null, { evaluated: 0, completed: 0, plans: [] });
        return { evaluated: 0, completed: 0, plans: [] };
      }
      // Need source assessment info to determine grade_level/subject scope
      var sourceIds = [];
      plans.forEach(function(p) {
        if (p.source_assessment_event_id) sourceIds.push(p.source_assessment_event_id);
      });
      var uniqIds = Array.from(new Set(sourceIds));
      var inClause = 'in.(' + uniqIds.map(function(id) { return encodeURIComponent(id); }).join(',') + ')';
      return authedFetch(REST + '/assessment_events?select=*&id=' + inClause)
        .then(function(r) { return r.json(); })
        .then(function(srcEvents) {
          var srcMap = {};
          (Array.isArray(srcEvents) ? srcEvents : []).forEach(function(e) { srcMap[e.id] = e; });

          // For each plan, find candidate follow-up events
          return Promise.all(plans.map(function(plan) {
            var src = srcMap[plan.source_assessment_event_id];
            if (!src) return { plan: plan, completed: false, skipped: 'no source event' };
            // Candidates: assessment_events with matching topic, same grade & subject,
            // administered AFTER the source's date
            var params = [
              'select=*',
              'grade_level=eq.' + encodeURIComponent(src.grade_level),
              'subject=eq.' + encodeURIComponent(src.subject),
              'administered_date=gt.' + encodeURIComponent(src.administered_date),
              'order=administered_date.asc',
              'limit=20'
            ];
            return authedFetch(REST + '/assessment_events?' + params.join('&'))
              .then(function(r) { return r.json(); })
              .then(function(candidateEvents) {
                var matchingTopic = (Array.isArray(candidateEvents) ? candidateEvents : [])
                  .filter(function(e) { return topicsMatch(plan.topic, e.topic); });
                if (!matchingTopic.length) return { plan: plan, completed: false, skipped: 'no topic match' };
                // Try each candidate in chronological order; stop at first completion
                return tryCompletionForCandidates(plan, matchingTopic);
              })
              .catch(function(err) { return { plan: plan, error: err, completed: false }; });
          }));
        });
    })
    .then(function(results) {
      var summary = {
        evaluated: results.length,
        completed: results.filter(function(r) { return r.completed; }).length,
        plans: results
      };
      if (cb) cb(null, summary);
      return summary;
    })
    .catch(function(err) {
      if (cb) cb(err, { evaluated: 0, completed: 0, plans: [] });
      throw err;
    });
}

// ── INTERNALS ───────────────────────────────────────────────────────────────

// Two topics match if either contains the other (case-insensitive, trimmed).
function topicsMatch(a, b) {
  if (!a || !b) return false;
  var na = String(a).trim().toLowerCase();
  var nb = String(b).trim().toLowerCase();
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0;
}

function evaluatePlanForCompletion(plan, candidateEvent) {
  // Need full target student list (the embedded action_plan_students was
  // filtered to this score's student only when fetched via the join filter).
  return authedFetch(REST + '/action_plan_students?select=clever_id&action_plan_id=eq.' +
    encodeURIComponent(plan.id))
    .then(function(r) { return r.json(); })
    .then(function(students) {
      var targetIds = (Array.isArray(students) ? students : []).map(function(s) { return s.clever_id; });
      if (!targetIds.length) return { plan: plan, completed: false, reason: 'no targets' };

      // Fetch this event's scores for those students
      var inClause = 'in.(' + targetIds.map(function(id) {
        return '"' + String(id).replace(/"/g, '\\"') + '"';
      }).join(',') + ')';
      return authedFetch(REST + '/academic_scores?select=clever_id,score' +
        '&assessment_event_id=eq.' + encodeURIComponent(candidateEvent.id) +
        '&clever_id=' + inClause)
        .then(function(r) { return r.json(); })
        .then(function(newScores) {
          newScores = Array.isArray(newScores) ? newScores : [];
          var newMap = {};
          newScores.forEach(function(s) { newMap[s.clever_id] = s.score; });

          // All target students must have a non-null score on this event
          var allCovered = targetIds.every(function(cid) {
            return newMap[cid] !== undefined && newMap[cid] !== null;
          });
          if (!allCovered) return { plan: plan, completed: false, reason: 'incomplete coverage' };

          // Fetch source assessment + source scores
          return Promise.all([
            authedFetch(REST + '/assessment_events?select=*&id=eq.' +
              encodeURIComponent(plan.source_assessment_event_id))
              .then(function(r) { return r.json(); }),
            authedFetch(REST + '/academic_scores?select=clever_id,score' +
              '&assessment_event_id=eq.' + encodeURIComponent(plan.source_assessment_event_id) +
              '&clever_id=' + inClause)
              .then(function(r) { return r.json(); })
          ]).then(function(results) {
            var sourceEvent = (results[0] && results[0][0]) || null;
            var sourceScores = Array.isArray(results[1]) ? results[1] : [];
            if (!sourceEvent) return { plan: plan, completed: false, reason: 'source event missing' };

            var srcMap = {};
            sourceScores.forEach(function(s) { srcMap[s.clever_id] = s.score; });

            var srcMax = Number(sourceEvent.max_score) || 100;
            var newMax = Number(candidateEvent.max_score) || 100;
            var perStudent = [];
            var deltas = [];
            targetIds.forEach(function(cid) {
              var newPct = (Number(newMap[cid]) / newMax) * 100;
              var srcRaw = srcMap[cid];
              // If a student had no source score, skip them in the delta calc
              if (srcRaw === undefined || srcRaw === null) {
                perStudent.push({ clever_id: cid, new: newPct, source: null, delta: null });
                return;
              }
              var srcPct = (Number(srcRaw) / srcMax) * 100;
              var delta = newPct - srcPct;
              deltas.push(delta);
              perStudent.push({ clever_id: cid, new: newPct, source: srcPct, delta: delta });
            });

            if (!deltas.length) return { plan: plan, completed: false, reason: 'no source scores for any target' };

            var avgDelta = deltas.reduce(function(a, d) { return a + d; }, 0) / deltas.length;
            var rounded = Math.round(avgDelta * 10) / 10;

            // Update the plan
            return authedFetch(REST + '/action_plans?id=eq.' + encodeURIComponent(plan.id), {
              method: 'PATCH',
              headers: { 'Prefer': 'return=representation' },
              body: JSON.stringify({
                follow_up_event_id: candidateEvent.id,
                outcome_avg_delta: rounded,
                status: 'complete',
                outcome_notes: 'Auto-completed: avg ' + (rounded > 0 ? '+' : '') + rounded +
                  ' pts on "' + candidateEvent.title + '" (' + candidateEvent.administered_date + ')'
              })
            }).then(function(r) {
              if (!r.ok) throw new Error('Plan update failed: HTTP ' + r.status);
              return r.json();
            }).then(function(updated) {
              return {
                plan: (updated && updated[0]) || plan,
                completed: true,
                delta: rounded,
                perStudent: perStudent,
                followUpEvent: candidateEvent
              };
            });
          });
        });
    });
}

function tryCompletionForCandidates(plan, candidates) {
  // Try in chronological order; resolve at first successful completion
  var idx = 0;
  function tryNext() {
    if (idx >= candidates.length) {
      return Promise.resolve({ plan: plan, completed: false, reason: 'no candidate completed' });
    }
    var candidate = candidates[idx++];
    return evaluatePlanForCompletion(plan, candidate).then(function(result) {
      if (result.completed) return result;
      return tryNext();
    });
  }
  return tryNext();
}

// ── SCHOOL-WIDE FETCHES (COACH DASHBOARD) ───────────────────────────────────

// All assessment events + their scores within a date range, used by the coach
// dashboard to compute cross-grade/cross-teacher rollups in the browser.
// At pilot scale (one school, single school year) this is a single round trip
// per table; rollup logic stays client-side for fast iteration.
//
// opts: { schoolYear?, dateFrom?, dateTo? }
// Returns: { events: [...], scores: [...], plans: [...] }
export function fetchCoachDashboardData(opts, cb) {
  opts = opts || {};
  var schoolYear = opts.schoolYear || '2025-26';

  var evParams = ['select=*', 'school_year=eq.' + encodeURIComponent(schoolYear),
                  'order=administered_date.desc', 'limit=500'];
  if (opts.dateFrom) evParams.push('administered_date=gte.' + encodeURIComponent(opts.dateFrom));
  if (opts.dateTo)   evParams.push('administered_date=lte.' + encodeURIComponent(opts.dateTo));

  var planParams = ['select=*,action_plan_students(clever_id)',
                    'school_year=eq.' + encodeURIComponent(schoolYear),
                    'order=created_at.desc', 'limit=500'];

  var eventsP = authedFetch(REST + '/assessment_events?' + evParams.join('&'))
    .then(function(r) { return r.json(); })
    .then(function(rows) { return Array.isArray(rows) ? rows : []; });

  var plansP = authedFetch(REST + '/action_plans?' + planParams.join('&'))
    .then(function(r) { return r.json(); })
    .then(function(rows) { return Array.isArray(rows) ? rows : []; });

  // Scores: fetch only those tied to events in the window. We get the events
  // first, then bulk-fetch scores by event_id in.() — keeps payload bounded.
  return eventsP.then(function(events) {
    var eventIds = events.map(function(e) { return e.id; });
    var scoresP = eventIds.length
      ? authedFetch(REST + '/academic_scores?select=*&assessment_event_id=in.(' +
          eventIds.map(function(id) { return encodeURIComponent(id); }).join(',') + ')')
        .then(function(r) { return r.json(); })
        .then(function(rows) { return Array.isArray(rows) ? rows : []; })
      : Promise.resolve([]);
    return Promise.all([scoresP, plansP]).then(function(results) {
      var out = { events: events, scores: results[0], plans: results[1] };
      if (cb) cb(null, out);
      return out;
    });
  }).catch(function(err) {
    var out = { events: [], scores: [], plans: [], error: err };
    if (cb) cb(err, out);
    return out;
  });
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
