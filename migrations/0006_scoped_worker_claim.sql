-- TMNT v1.6: Isolate worker claims by environment before any row mutation.
-- Apply to a staging branch after 0001..0005. Existing r3_v1_claim_job remains
-- for legacy consumers; the v1.6 worker uses ONLY r3_v1_claim_job_scoped.
CREATE OR REPLACE FUNCTION r3_v1_claim_job_scoped(worker TEXT, env_csv TEXT, scope_csv TEXT)
RETURNS TABLE(job_id UUID,t TEXT,a TEXT,e TEXT,s TEXT,template TEXT,locale TEXT,attempt INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  q r3_v1_outbox%ROWTYPE;
  u r3_v1_subjects%ROWTYPE;
  ap r3_v1_apps%ROWTYPE;
  local_day DATE;
  local_hour INTEGER;
  failed_gate BOOLEAN;
  allowed_envs TEXT[];
  allowed_scopes TEXT[];
BEGIN
  IF worker IS NULL OR length(worker)<8 OR length(worker)>120 THEN RAISE EXCEPTION 'Invalid worker'; END IF;
  allowed_envs := string_to_array(env_csv, ',');
  IF allowed_envs IS NULL OR cardinality(allowed_envs)<1
     OR cardinality(allowed_envs)>3
     OR EXISTS (SELECT 1 FROM unnest(allowed_envs) x WHERE x NOT IN ('test','staging','prod') OR x='')
     OR cardinality(allowed_envs) <> (SELECT count(DISTINCT x) FROM unnest(allowed_envs) x)
  THEN RAISE EXCEPTION 'Invalid worker environments'; END IF;

  allowed_scopes := string_to_array(scope_csv, ',');
  IF allowed_scopes IS NULL OR cardinality(allowed_scopes)<1 OR cardinality(allowed_scopes)>100
     OR EXISTS (SELECT 1 FROM unnest(allowed_scopes) x
                WHERE x !~ '^[a-z][a-z0-9_-]{1,49}/[a-z][a-z0-9_-]{1,49}/(test|staging|prod)$'
                  OR NOT split_part(x, '/', 3) = ANY(allowed_envs))
  THEN RAISE EXCEPTION 'Invalid worker app scopes'; END IF;
  -- Candidate is read without a lock first to respect the same ordering as
  -- enqueue/consent: subject -> outbox. Recheck under the outbox row lock.
  SELECT * INTO q FROM r3_v1_outbox
  WHERE environment = ANY(allowed_envs)
    AND (tenant_id || '/' || app_id || '/' || environment) = ANY(allowed_scopes)
    AND (status IN ('reserved','failed') OR (status='sending' AND lease_until<NOW()))
    AND attempts<3 AND due_at<=NOW()
  ORDER BY due_at,id LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO u FROM r3_v1_subjects
    WHERE tenant_id=q.tenant_id AND app_id=q.app_id AND environment=q.environment AND subject_id=q.subject_id
    FOR UPDATE;
  SELECT * INTO q FROM r3_v1_outbox z
    WHERE z.id=q.id AND z.tenant_id=q.tenant_id AND z.app_id=q.app_id AND z.environment=q.environment
      AND z.environment=ANY(allowed_envs)
      AND (z.tenant_id || '/' || z.app_id || '/' || z.environment) = ANY(allowed_scopes)
    FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR q.attempts>=3
     OR (q.status NOT IN ('reserved','failed') AND NOT (q.status='sending' AND q.lease_until<NOW()))
     OR q.due_at>NOW() THEN RETURN; END IF;

  SELECT * INTO ap FROM r3_v1_apps
    WHERE tenant_id=q.tenant_id AND app_id=q.app_id AND environment=q.environment;
  failed_gate:=NOT FOUND OR NOT ap.enabled OR ap.modules->>'notifications' IS DISTINCT FROM 'true';
  IF u.subject_id IS NULL OR u.last_value_at IS NULL
     OR (u.paused_until IS NOT NULL AND u.paused_until>NOW()) THEN failed_gate:=TRUE; END IF;
  IF NOT failed_gate THEN
    local_day:=(NOW() AT TIME ZONE u.timezone)::DATE;
    local_hour:=EXTRACT(HOUR FROM NOW() AT TIME ZONE u.timezone)::INTEGER;
    IF local_hour<ap.quiet_start OR local_hour>=ap.quiet_end
       OR (u.reminder_hour IS NOT NULL AND u.reminder_hour<>local_hour)
       OR local_day<=(u.last_value_at AT TIME ZONE u.timezone)::DATE THEN failed_gate:=TRUE; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM r3_v1_consents
     WHERE tenant_id=q.tenant_id AND app_id=q.app_id AND environment=q.environment
       AND subject_id=q.subject_id AND channel=q.channel AND purpose=q.purpose
       AND granted AND verified) THEN failed_gate:=TRUE; END IF;
  IF NOT EXISTS (SELECT 1 FROM r3_v1_exposures
     WHERE tenant_id=q.tenant_id AND app_id=q.app_id AND environment=q.environment
       AND subject_id=q.subject_id AND experiment_key='retention_push' AND arm='treatment')
    THEN failed_gate:=TRUE; END IF;
  IF failed_gate THEN
    UPDATE r3_v1_outbox SET status='suppressed',updated_at=NOW(),last_error='Ineligible at claim'
      WHERE id=q.id AND tenant_id=q.tenant_id AND app_id=q.app_id AND environment=q.environment;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM r3_v1_outbox z
      WHERE z.tenant_id=q.tenant_id AND z.app_id=q.app_id AND z.environment=q.environment
        AND z.subject_id=q.subject_id AND z.id<>q.id
        AND ((z.status='provider_accepted' AND z.sent_at>NOW()-INTERVAL '24 hours')
          OR (z.status='sending' AND z.lease_until>NOW()))) THEN RETURN; END IF;
  IF (SELECT COUNT(*) FROM r3_v1_outbox z
      WHERE z.tenant_id=q.tenant_id AND z.app_id=q.app_id AND z.environment=q.environment
        AND z.subject_id=q.subject_id AND z.id<>q.id
        AND z.status='provider_accepted' AND z.sent_at>NOW()-INTERVAL '7 days')>=ap.weekly_limit THEN RETURN; END IF;
  UPDATE r3_v1_outbox SET status='sending',attempts=attempts+1,
      worker_id=worker,lease_until=NOW()+INTERVAL '2 minutes',updated_at=NOW()
    WHERE id=q.id AND tenant_id=q.tenant_id AND app_id=q.app_id AND environment=q.environment;
  RETURN QUERY SELECT q.id,q.tenant_id,q.app_id,q.environment,q.subject_id,q.template_id,q.locale,q.attempts+1;
END $$;
