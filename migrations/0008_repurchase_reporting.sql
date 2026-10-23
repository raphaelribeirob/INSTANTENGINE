-- TMNT Engine v1.7: optional commerce analytics, never causal lift by itself.
-- Only completed purchase events; no invented discounts or inferred checkout revenue.
CREATE OR REPLACE VIEW r3_v1_repurchase_report AS
WITH first_purchase AS (
 SELECT ev.tenant_id,ev.app_id,ev.environment,ev.subject_id,u.timezone,
 MIN((ev.occurred_at AT TIME ZONE u.timezone)::date) AS cohort_day,
 MIN(ev.occurred_at) AS first_purchase_at
 FROM r3_v1_events ev
 JOIN r3_v1_subjects u USING(tenant_id,app_id,environment,subject_id)
 JOIN r3_v1_event_registry r USING(tenant_id,app_id,environment,name)
 WHERE ev.name='purchase_completed' AND r.is_value
 GROUP BY ev.tenant_id,ev.app_id,ev.environment,ev.subject_id,u.timezone
), eligible AS (
 SELECT f.*,x.arm,(NOW() AT TIME ZONE f.timezone)::date AS local_today
 FROM first_purchase f JOIN r3_v1_exposures x
 ON x.tenant_id=f.tenant_id AND x.app_id=f.app_id AND x.environment=f.environment AND x.subject_id=f.subject_id
 WHERE x.experiment_key='retention_push' AND x.exposed_at<=f.first_purchase_at
), windows AS (SELECT days FROM (VALUES (30),(60),(90)) w(days))
SELECT c.tenant_id,c.app_id,c.environment,c.cohort_day,w.days AS window_days,c.arm,
 COUNT(*)::bigint AS users_eligible,
 COUNT(*) FILTER (WHERE EXISTS (
 SELECT 1 FROM r3_v1_events e
 WHERE e.tenant_id=c.tenant_id AND e.app_id=c.app_id AND e.environment=c.environment AND e.subject_id=c.subject_id
 AND e.name='purchase_completed'
 AND (e.occurred_at AT TIME ZONE c.timezone)::date>c.cohort_day
 AND (e.occurred_at AT TIME ZONE c.timezone)::date<=c.cohort_day+w.days
 ))::bigint AS users_repurchased
FROM eligible c CROSS JOIN windows w
WHERE c.local_today>c.cohort_day+w.days
GROUP BY c.tenant_id,c.app_id,c.environment,c.cohort_day,w.days,c.arm;
