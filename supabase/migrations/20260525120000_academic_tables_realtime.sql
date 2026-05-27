-- Add academic tables to the supabase_realtime publication.
-- Without this, the binder/plans/coach views can't receive INSERT/UPDATE/
-- DELETE events for academic data — subscriptions would succeed but no
-- broadcasts would arrive.
--
-- Mirrors what color_transitions already had on the behavior side.

alter publication supabase_realtime add table academic_scores;
alter publication supabase_realtime add table assessment_events;
alter publication supabase_realtime add table action_plans;
alter publication supabase_realtime add table action_plan_students;
alter publication supabase_realtime add table data_meetings;
