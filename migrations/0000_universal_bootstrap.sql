-- TMNT Engine v2.2: schema universal R3 v1.0+v1.1 (NO legacy r3_users tables).
-- Generated from legacy/R3ENGINE_v1.1.mjs via npm run db:bootstrap:build.
-- Run ONLY on an authorized, isolated PostgreSQL QA branch/database.
-- Requires PostgreSQL 14+ and pgcrypto/gen_random_uuid support.

-- R3ENGINE universal v1.0. Additive side-by-side schema. Tenant/app/environment-scoped.
CREATE TABLE IF NOT EXISTS r3_v1_apps (
 tenant_id TEXT NOT NULL CHECK(tenant_id ~ '^[a-z][a-z0-9_-]{1,49}$'),
 app_id TEXT NOT NULL CHECK(app_id ~ '^[a-z][a-z0-9_-]{1,49}$'),
 environment TEXT NOT NULL CHECK(environment IN ('test','staging','prod')),
 key_hash TEXT NOT NULL CHECK(key_hash ~ '^[a-f0-9]{64}$'),
 enabled BOOLEAN NOT NULL DEFAULT TRUE,
 cadence TEXT NOT NULL CHECK(cadence IN ('daily','weekly','episodic','none')),
 modules JSONB NOT NULL DEFAULT '{}'::jsonb,
 quiet_start INTEGER NOT NULL CHECK(quiet_start BETWEEN 0 AND 22),
 quiet_end INTEGER NOT NULL CHECK(quiet_end BETWEEN 1 AND 23 AND quiet_end>quiet_start),
 weekly_limit INTEGER NOT NULL CHECK(weekly_limit BETWEEN 0 AND 7),
 holdout_percent INTEGER NOT NULL CHECK(holdout_percent BETWEEN 0 AND 50),
 config_version INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment));
CREATE TABLE IF NOT EXISTS r3_v1_event_registry(
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,
 name TEXT NOT NULL CHECK(name ~ '^[a-z][a-z0-9_.]{1,63}$'),is_value BOOLEAN NOT NULL,
 schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version=1),
 PRIMARY KEY(tenant_id,app_id,environment,name),
 FOREIGN KEY(tenant_id,app_id,environment) REFERENCES r3_v1_apps ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS r3_v1_subjects(
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,
 subject_id TEXT NOT NULL CHECK(length(subject_id) BETWEEN 1 AND 120),
 timezone TEXT NOT NULL DEFAULT 'UTC',locale TEXT NOT NULL DEFAULT 'en',
 last_active_at TIMESTAMPTZ,last_value_at TIMESTAMPTZ,
 value_count BIGINT NOT NULL DEFAULT 0 CHECK(value_count>=0),
 reminder_hour INTEGER CHECK(reminder_hour BETWEEN 0 AND 23),paused_until TIMESTAMPTZ,
 PRIMARY KEY(tenant_id,app_id,environment,subject_id),
 FOREIGN KEY(tenant_id,app_id,environment) REFERENCES r3_v1_apps ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS r3_v1_events(
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,
 event_id UUID NOT NULL,subject_id TEXT NOT NULL,
 name TEXT NOT NULL,schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version=1),
 occurred_at TIMESTAMPTZ NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,event_id),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,app_id,environment,name) REFERENCES r3_v1_event_registry);
CREATE INDEX IF NOT EXISTS r3_v1_events_activity_idx ON r3_v1_events(tenant_id,app_id,environment,name,occurred_at DESC);
CREATE TABLE IF NOT EXISTS r3_v1_consents(
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,subject_id TEXT NOT NULL,
 channel TEXT NOT NULL CHECK(channel IN ('push','in_app','email')),
 purpose TEXT NOT NULL CHECK(purpose IN ('reminder','marketing','transactional')),
 granted BOOLEAN NOT NULL,verified BOOLEAN NOT NULL,
 platform TEXT NOT NULL CHECK(platform IN ('ios','android','web','server')),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,subject_id,channel,purpose),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE,
 CHECK(NOT granted OR verified));
CREATE TABLE IF NOT EXISTS r3_v1_consent_history(
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,subject_id TEXT NOT NULL,
 channel TEXT NOT NULL,purpose TEXT NOT NULL,granted BOOLEAN NOT NULL,verified BOOLEAN NOT NULL,platform TEXT NOT NULL,
 changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS r3_v1_consent_history_idx ON r3_v1_consent_history(tenant_id,app_id,environment,subject_id,changed_at DESC);
CREATE TABLE IF NOT EXISTS r3_v1_exposures(
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,subject_id TEXT NOT NULL,
 experiment_key TEXT NOT NULL,arm TEXT NOT NULL CHECK(arm IN ('holdout','treatment')),
 config_version INTEGER NOT NULL,
 exposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,subject_id,experiment_key),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE);
-- Receipt ingestion is reserved for a future authenticated provider adapter.
-- No public endpoint may write an unverified delivery receipt.
CREATE TABLE IF NOT EXISTS r3_v1_notification_receipts(
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,subject_id TEXT NOT NULL,
 delivery_id UUID NOT NULL,channel TEXT NOT NULL,purpose TEXT NOT NULL,
 sent_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(tenant_id,app_id,environment,delivery_id),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS r3_v1_receipts_user_idx ON r3_v1_notification_receipts(tenant_id,app_id,environment,subject_id,sent_at DESC);

CREATE OR REPLACE FUNCTION r3_v1_register_app(
 t TEXT,a TEXT,e TEXT,h TEXT,c TEXT,m JSONB,qs INT,qe INT,wl INT,ho INT,ev JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE item JSONB;
BEGIN
 IF jsonb_typeof(ev)<>'array' OR jsonb_array_length(ev)=0 THEN RAISE EXCEPTION 'Invalid registry'; END IF;
 INSERT INTO r3_v1_apps(tenant_id,app_id,environment,key_hash,cadence,modules,quiet_start,quiet_end,weekly_limit,holdout_percent)
 VALUES(t,a,e,h,c,m,qs,qe,wl,ho) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(ev) LOOP
   INSERT INTO r3_v1_event_registry(tenant_id,app_id,environment,name,is_value)
   VALUES(t,a,e,item->>'name',(item->>'value')::boolean);
 END LOOP;
 RETURN TRUE;
END $$;

CREATE OR REPLACE FUNCTION r3_v1_ingest(
 t TEXT,a TEXT,e TEXT,s TEXT,id UUID,ev TEXT,when_at TIMESTAMPTZ,l TEXT,tz TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE is_val BOOLEAN; r INTEGER;
BEGIN
 SELECT reg.is_value INTO is_val FROM r3_v1_event_registry reg JOIN r3_v1_apps ap USING(tenant_id,app_id,environment)
 WHERE reg.tenant_id=t AND reg.app_id=a AND reg.environment=e AND reg.name=ev AND ap.enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unregistered event or disabled app'; END IF;
 INSERT INTO r3_v1_subjects(tenant_id,app_id,environment,subject_id,locale,timezone)
 VALUES(t,a,e,s,l,tz) ON CONFLICT DO NOTHING;
 INSERT INTO r3_v1_events(tenant_id,app_id,environment,event_id,subject_id,name,occurred_at)
 VALUES(t,a,e,id,s,ev,when_at) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS r=ROW_COUNT;
 IF r=0 THEN RETURN FALSE; END IF;
 UPDATE r3_v1_subjects SET locale=l,timezone=tz,
 last_active_at=GREATEST(COALESCE(last_active_at,when_at),when_at),
 last_value_at=CASE WHEN is_val THEN GREATEST(COALESCE(last_value_at,when_at),when_at) ELSE last_value_at END,
 value_count=value_count+CASE WHEN is_val THEN 1 ELSE 0 END
 WHERE tenant_id=t AND app_id=a AND environment=e AND subject_id=s;
 RETURN TRUE;
END $$;

CREATE OR REPLACE FUNCTION r3_v1_set_consent(
 t TEXT,a TEXT,e TEXT,s TEXT,ch TEXT,p TEXT,g BOOLEAN,v BOOLEAN,pl TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
 IF g AND NOT v THEN RAISE EXCEPTION 'Unverified consent'; END IF;
 PERFORM 1 FROM r3_v1_subjects WHERE tenant_id=t AND app_id=a AND environment=e AND subject_id=s FOR UPDATE;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 INSERT INTO r3_v1_consents(tenant_id,app_id,environment,subject_id,channel,purpose,granted,verified,platform)
 VALUES(t,a,e,s,ch,p,g,v,pl)
 ON CONFLICT(tenant_id,app_id,environment,subject_id,channel,purpose)
 DO UPDATE SET granted=EXCLUDED.granted,verified=EXCLUDED.verified,platform=EXCLUDED.platform,updated_at=NOW();
 INSERT INTO r3_v1_consent_history(tenant_id,app_id,environment,subject_id,channel,purpose,granted,verified,platform)
 VALUES(t,a,e,s,ch,p,g,v,pl);
 RETURN TRUE;
END $$;

-- R3ENGINE v1.1.0: additive migration to be run AFTER R3ENGINE v1.0 schema.
-- Requires database credentials in trusted backend. This does NOT activate notifications.
CREATE TABLE IF NOT EXISTS r3_v1_request_nonces (
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,
 request_id UUID NOT NULL,subject_id TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,request_id),
 FOREIGN KEY(tenant_id,app_id,environment) REFERENCES r3_v1_apps ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS r3_v1_nonce_cleanup ON r3_v1_request_nonces(created_at);
-- Schedule periodic cleanup: DELETE FROM r3_v1_request_nonces WHERE created_at<NOW()-INTERVAL '15 minutes';
CREATE OR REPLACE FUNCTION r3_v1_claim_request(t TEXT,a TEXT,e TEXT,s TEXT,n UUID,ts BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE affected INTEGER;
BEGIN
 IF ABS(EXTRACT(EPOCH FROM NOW())*1000-ts)>300000 THEN RETURN FALSE; END IF;
 INSERT INTO r3_v1_request_nonces(tenant_id,app_id,environment,request_id,subject_id)
 VALUES(t,a,e,n,s) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected=1;
END $$;

CREATE TABLE IF NOT EXISTS r3_v1_outbox (
 id UUID NOT NULL DEFAULT gen_random_uuid(),tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,subject_id TEXT NOT NULL,
 campaign_key TEXT NOT NULL CHECK(length(campaign_key) BETWEEN 1 AND 100),
 channel TEXT NOT NULL DEFAULT 'push' CHECK(channel='push'),purpose TEXT NOT NULL DEFAULT 'reminder' CHECK(purpose='reminder'),
 template_id TEXT NOT NULL CHECK(length(template_id) BETWEEN 1 AND 80),locale TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','sending','provider_accepted','failed','suppressed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 due_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),lease_until TIMESTAMPTZ,worker_id TEXT,provider_id TEXT,last_error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),sent_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,id),
 UNIQUE(tenant_id,app_id,environment,subject_id,campaign_key),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS r3_v1_outbox_claim ON r3_v1_outbox(status,due_at,lease_until);
CREATE INDEX IF NOT EXISTS r3_v1_outbox_subject ON r3_v1_outbox(tenant_id,app_id,environment,subject_id,sent_at DESC);

CREATE OR REPLACE FUNCTION r3_v1_enqueue(t TEXT,a TEXT,e TEXT,s TEXT,campaign TEXT,template TEXT)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE ap r3_v1_apps%ROWTYPE;u r3_v1_subjects%ROWTYPE;result UUID;local_day DATE;local_hour INTEGER;days_since INTEGER;total_sent INTEGER;
BEGIN
 SELECT * INTO u FROM r3_v1_subjects WHERE tenant_id=t AND app_id=a AND environment=e AND subject_id=s FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO ap FROM r3_v1_apps WHERE tenant_id=t AND app_id=a AND environment=e;
 IF NOT FOUND OR NOT ap.enabled OR ap.cadence IN ('none','episodic') OR ap.modules->>'notifications' IS DISTINCT FROM 'true' THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM r3_v1_consents WHERE tenant_id=t AND app_id=a AND environment=e AND subject_id=s AND channel='push' AND purpose='reminder' AND granted AND verified) THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM r3_v1_exposures WHERE tenant_id=t AND app_id=a AND environment=e AND subject_id=s AND experiment_key='retention_push' AND arm='treatment') THEN RETURN NULL;END IF;
 IF u.last_value_at IS NULL OR (u.paused_until IS NOT NULL AND u.paused_until>NOW()) THEN RETURN NULL;END IF;
 local_day:=(NOW() AT TIME ZONE u.timezone)::DATE;
 local_hour:=EXTRACT(HOUR FROM NOW() AT TIME ZONE u.timezone)::INTEGER;
 IF local_hour<ap.quiet_start OR local_hour>=ap.quiet_end OR (u.reminder_hour IS NOT NULL AND u.reminder_hour<>local_hour) THEN RETURN NULL;END IF;
 days_since:=local_day-(u.last_value_at AT TIME ZONE u.timezone)::date;
 IF days_since<1 OR (ap.cadence='daily' AND days_since>7) OR (ap.cadence='weekly' AND days_since<7) THEN RETURN NULL;END IF;
 IF EXISTS(SELECT 1 FROM r3_v1_outbox q WHERE q.tenant_id=t AND q.app_id=a AND q.environment=e AND q.subject_id=s AND ((q.status='provider_accepted' AND q.sent_at>NOW()-INTERVAL '24 hours') OR (q.status='sending' AND q.lease_until>NOW()))) THEN RETURN NULL;END IF;
 SELECT COUNT(*)::INTEGER INTO total_sent FROM r3_v1_outbox q WHERE q.tenant_id=t AND q.app_id=a AND q.environment=e AND q.subject_id=s AND q.status='provider_accepted' AND q.sent_at>NOW()-INTERVAL '7 days';
 IF total_sent>=ap.weekly_limit THEN RETURN NULL;END IF;
 INSERT INTO r3_v1_outbox(tenant_id,app_id,environment,subject_id,campaign_key,template_id,locale) VALUES(t,a,e,s,campaign,template,u.locale) ON CONFLICT DO NOTHING RETURNING id INTO result;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION r3_v1_claim_job(worker TEXT)
RETURNS TABLE(job_id UUID,t TEXT,a TEXT,e TEXT,s TEXT,template TEXT,locale TEXT,attempt INTEGER)
LANGUAGE plpgsql AS $$
DECLARE q r3_v1_outbox%ROWTYPE;u r3_v1_subjects%ROWTYPE;ap r3_v1_apps%ROWTYPE;local_day DATE;local_hour INTEGER;failed_gate BOOLEAN;
BEGIN
 IF length(worker)<8 OR length(worker)>120 THEN RAISE EXCEPTION 'Invalid worker';END IF;
 -- Read candidate without locking; then lock subject BEFORE outbox (same order as enqueue).
 SELECT * INTO q FROM r3_v1_outbox WHERE (status IN ('reserved','failed') OR (status='sending' AND lease_until<NOW())) AND attempts<3 AND due_at<=NOW() ORDER BY due_at,id LIMIT 1;
 IF NOT FOUND THEN RETURN;END IF;
 SELECT * INTO u FROM r3_v1_subjects WHERE tenant_id=q.tenant_id AND app_id=q.app_id AND environment=q.environment AND subject_id=q.subject_id FOR UPDATE;
 SELECT * INTO q FROM r3_v1_outbox z WHERE z.id=q.id AND z.tenant_id=q.tenant_id AND z.app_id=q.app_id AND z.environment=q.environment FOR UPDATE SKIP LOCKED;
 IF NOT FOUND OR q.attempts>=3 OR (q.status NOT IN ('reserved','failed') AND NOT(q.status='sending' AND q.lease_until<NOW())) OR q.due_at>NOW() THEN RETURN;END IF;
 SELECT * INTO ap FROM r3_v1_apps WHERE tenant_id=q.tenant_id AND app_id=q.app_id AND environment=q.environment;
 failed_gate:=NOT FOUND OR NOT ap.enabled OR ap.modules->>'notifications' IS DISTINCT FROM 'true';
 IF u.subject_id IS NULL OR u.last_value_at IS NULL OR (u.paused_until IS NOT NULL AND u.paused_until>NOW()) THEN failed_gate:=TRUE;END IF;
 IF NOT failed_gate THEN
  local_day:=(NOW() AT TIME ZONE u.timezone)::date;local_hour:=EXTRACT(HOUR FROM NOW() AT TIME ZONE u.timezone)::INTEGER;
  IF local_hour<ap.quiet_start OR local_hour>=ap.quiet_end OR (u.reminder_hour IS NOT NULL AND u.reminder_hour<>local_hour) OR local_day<=(u.last_value_at AT TIME ZONE u.timezone)::date THEN failed_gate:=TRUE;END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM r3_v1_consents WHERE tenant_id=q.tenant_id AND app_id=q.app_id AND environment=q.environment AND subject_id=q.subject_id AND channel=q.channel AND purpose=q.purpose AND granted AND verified) THEN failed_gate:=TRUE;END IF;
 IF NOT EXISTS(SELECT 1 FROM r3_v1_exposures WHERE tenant_id=q.tenant_id AND app_id=q.app_id AND environment=q.environment AND subject_id=q.subject_id AND experiment_key='retention_push' AND arm='treatment') THEN failed_gate:=TRUE;END IF;
 IF failed_gate THEN
  UPDATE r3_v1_outbox SET status='suppressed',updated_at=NOW(),last_error='Ineligible at claim' WHERE id=q.id AND tenant_id=q.tenant_id AND app_id=q.app_id AND environment=q.environment;
  RETURN;
 END IF;
 IF EXISTS(SELECT 1 FROM r3_v1_outbox z WHERE z.tenant_id=q.tenant_id AND z.app_id=q.app_id AND z.environment=q.environment AND z.subject_id=q.subject_id AND z.id<>q.id AND ((z.status='provider_accepted' AND z.sent_at>NOW()-INTERVAL '24 hours') OR(z.status='sending' AND z.lease_until>NOW()))) THEN RETURN;END IF;
 IF (SELECT COUNT(*) FROM r3_v1_outbox z WHERE z.tenant_id=q.tenant_id AND z.app_id=q.app_id AND z.environment=q.environment AND z.subject_id=q.subject_id AND z.id<>q.id AND z.status='provider_accepted' AND z.sent_at>NOW()-INTERVAL '7 days')>=ap.weekly_limit THEN RETURN;END IF;
 UPDATE r3_v1_outbox SET status='sending',attempts=attempts+1,worker_id=worker,lease_until=NOW()+INTERVAL '2 minutes',updated_at=NOW() WHERE id=q.id AND tenant_id=q.tenant_id AND app_id=q.app_id AND environment=q.environment;
 RETURN QUERY SELECT q.id,q.tenant_id,q.app_id,q.environment,q.subject_id,q.template_id,q.locale,q.attempts+1;
END $$;

CREATE OR REPLACE FUNCTION r3_v1_finish_job(job UUID,tenant TEXT,app TEXT,env TEXT,worker TEXT,attempt INTEGER,accepted BOOLEAN,provider TEXT,err TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE q r3_v1_outbox%ROWTYPE;
BEGIN
 SELECT * INTO q FROM r3_v1_outbox WHERE id=job AND tenant_id=tenant AND app_id=app AND environment=env FOR UPDATE;
 IF NOT FOUND OR q.status<>'sending' OR q.worker_id IS DISTINCT FROM worker OR q.attempts<>attempt THEN RETURN FALSE;END IF;
 IF accepted AND (provider IS NULL OR length(provider)=0) THEN RETURN FALSE;END IF;
 UPDATE r3_v1_outbox SET status=CASE WHEN accepted THEN 'provider_accepted' ELSE 'failed' END,
 provider_id=CASE WHEN accepted THEN provider ELSE NULL END,
 last_error=CASE WHEN accepted THEN NULL ELSE LEFT(COALESCE(err,'provider_error'),160) END,
 sent_at=CASE WHEN accepted THEN NOW() ELSE NULL END,
 due_at=CASE WHEN accepted THEN due_at ELSE NOW()+((attempt*attempt)*INTERVAL '5 minutes') END,
 lease_until=NULL,worker_id=NULL,updated_at=NOW()
 WHERE id=job AND tenant_id=tenant AND app_id=app AND environment=env;
 IF accepted THEN INSERT INTO r3_v1_notification_receipts(tenant_id,app_id,environment,subject_id,delivery_id,channel,purpose,sent_at)
 VALUES(q.tenant_id,q.app_id,q.environment,q.subject_id,q.id,q.channel,q.purpose,NOW()) ON CONFLICT DO NOTHING;END IF;
 RETURN TRUE;
END $$;
