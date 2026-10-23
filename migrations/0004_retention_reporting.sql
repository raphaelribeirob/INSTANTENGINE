-- Read-only A/B value-retention view. Uses exposure day as cohort baseline,
-- includes exposed users who produce zero follow-on value events.
-- Calculates exact D1/D7/D30 only after a full local-day observation window.
-- For very large deployments prefer incrementally aggregated materialized data.
CREATE OR REPLACE VIEW r3_v1_retention_report AS
WITH eligible AS (
 SELECT x.tenant_id,x.app_id,x.environment,x.subject_id,x.arm,
        (x.exposed_at AT TIME ZONE u.timezone)::date AS cohort_day,
        u.timezone,
        (NOW() AT TIME ZONE u.timezone)::date AS current_day
 FROM r3_v1_exposures x JOIN r3_v1_subjects u USING(tenant_id,app_id,environment,subject_id)
 JOIN r3_v1_apps a USING(tenant_id,app_id,environment)
 WHERE x.experiment_key='retention_push'
), windows AS (SELECT day_offset FROM (VALUES (1),(7),(30)) AS days(day_offset))
SELECT p.tenant_id,p.app_id,p.environment,p.cohort_day,w.day_offset,p.arm,
       COUNT(*)::bigint AS users_eligible,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM r3_v1_events e
         JOIN r3_v1_event_registry r USING(tenant_id,app_id,environment,name)
         WHERE e.tenant_id=p.tenant_id AND e.app_id=p.app_id AND e.environment=p.environment
           AND e.subject_id=p.subject_id AND r.is_value
           AND (e.occurred_at AT TIME ZONE p.timezone)::date=p.cohort_day+w.day_offset
       ))::bigint AS users_retained
FROM eligible p CROSS JOIN windows w
WHERE p.current_day>p.cohort_day+w.day_offset
GROUP BY p.tenant_id,p.app_id,p.environment,p.cohort_day,w.day_offset,p.arm;
