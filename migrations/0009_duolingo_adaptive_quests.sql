-- TMNT Engine v2.0: additive optional modules, no destructive changes.
-- Run only after 0001-0008 and universal base tables; always QA first.
ALTER TABLE r3_v1_subjects ADD COLUMN IF NOT EXISTS reminder_hour_source TEXT NOT NULL DEFAULT 'unset';
CREATE TABLE IF NOT EXISTS r3_v1_daily_missions(
 tenant_id TEXT NOT NULL, app_id TEXT NOT NULL, environment TEXT NOT NULL,
 mission_key TEXT NOT NULL, event_name TEXT NOT NULL, target INTEGER NOT NULL CHECK(target BETWEEN 1 AND 100),
 reward_xp INTEGER NOT NULL DEFAULT 0 CHECK(reward_xp BETWEEN 0 AND 500),
 PRIMARY KEY(tenant_id,app_id,environment,mission_key),
 FOREIGN KEY(tenant_id,app_id,environment,event_name) REFERENCES r3_v1_event_registry(tenant_id,app_id,environment,name) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS r3_v1_daily_mission_claims(
 tenant_id TEXT NOT NULL, app_id TEXT NOT NULL, environment TEXT NOT NULL,
 subject_id TEXT NOT NULL, mission_key TEXT NOT NULL, local_day DATE NOT NULL,
 earned_xp INTEGER NOT NULL DEFAULT 0, claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,subject_id,mission_key,local_day),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,app_id,environment,mission_key) REFERENCES r3_v1_daily_missions ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS r3_v1_daily_mission_claims_subject_idx ON r3_v1_daily_mission_claims(tenant_id,app_id,environment,subject_id,local_day);

CREATE OR REPLACE FUNCTION r3_v1_send_time_observations(t TEXT,a TEXT,e TEXT,s TEXT)
RETURNS TABLE(hour INTEGER,converted BOOLEAN) LANGUAGE sql STABLE AS $$
 SELECT EXTRACT(HOUR FROM q.sent_at AT TIME ZONE u.timezone)::INTEGER AS hour,
 EXISTS(SELECT 1 FROM r3_v1_message_outcomes o WHERE o.tenant_id=q.tenant_id AND o.app_id=q.app_id AND o.environment=q.environment AND o.delivery_id=q.id AND o.type='value') AS converted
 FROM r3_v1_outbox q JOIN r3_v1_subjects u USING(tenant_id,app_id,environment,subject_id)
 JOIN r3_v1_apps cfg USING(tenant_id,app_id,environment)
 JOIN r3_v1_consents c ON c.tenant_id=q.tenant_id AND c.app_id=q.app_id AND c.environment=q.environment AND c.subject_id=q.subject_id AND c.channel='push' AND c.purpose='reminder'
 JOIN r3_v1_exposures x ON x.tenant_id=q.tenant_id AND x.app_id=q.app_id AND x.environment=q.environment AND x.subject_id=q.subject_id AND x.experiment_key='retention_push'
 WHERE q.tenant_id=t AND q.app_id=a AND q.environment=e AND q.subject_id=s
 AND cfg.enabled AND cfg.modules->>'notifications'='true' AND cfg.cadence IN('daily','weekly')
 AND c.granted AND c.verified AND x.arm='treatment' AND q.status='provider_accepted'
 AND q.sent_at<NOW()-INTERVAL '24 hours' AND q.sent_at>NOW()-INTERVAL '90 days'
 ORDER BY q.sent_at DESC LIMIT 250
$$;

CREATE OR REPLACE FUNCTION r3_v1_apply_optimized_hour(t TEXT,a TEXT,e TEXT,s TEXT,h INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$ DECLARE n INTEGER; BEGIN
 IF h IS NULL OR h<0 OR h>23 THEN RETURN FALSE; END IF;
 UPDATE r3_v1_subjects u SET reminder_hour=h,reminder_hour_source='algorithm'
 FROM r3_v1_apps cfg WHERE u.tenant_id=t AND u.app_id=a AND u.environment=e AND u.subject_id=s
 AND cfg.tenant_id=t AND cfg.app_id=a AND cfg.environment=e AND cfg.enabled
 AND cfg.modules->>'notifications'='true' AND h>=cfg.quiet_start AND h<cfg.quiet_end
 AND (u.reminder_hour IS NULL OR u.reminder_hour_source='algorithm')
 AND EXISTS(SELECT 1 FROM r3_v1_consents c WHERE c.tenant_id=t AND c.app_id=a AND c.environment=e AND c.subject_id=s AND c.channel='push' AND c.purpose='reminder' AND c.granted AND c.verified)
 AND EXISTS(SELECT 1 FROM r3_v1_exposures x WHERE x.tenant_id=t AND x.app_id=a AND x.environment=e AND x.subject_id=s AND x.experiment_key='retention_push' AND x.arm='treatment');
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;

CREATE OR REPLACE FUNCTION r3_v1_define_daily_mission(t TEXT,a TEXT,e TEXT,k TEXT,ev TEXT,trg INTEGER,xp INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$ DECLARE n INTEGER; BEGIN
 IF k IS NULL OR length(k)<1 OR length(k)>100 OR k !~ '^[a-zA-Z0-9_.-]+$' OR trg IS NULL OR trg<1 OR trg>100 OR xp IS NULL OR xp<0 OR xp>500 THEN RETURN FALSE; END IF;
 INSERT INTO r3_v1_daily_missions(tenant_id,app_id,environment,mission_key,event_name,target,reward_xp)
 SELECT t,a,e,k,ev,trg,xp FROM r3_v1_apps cfg JOIN r3_v1_event_registry reg USING(tenant_id,app_id,environment)
 WHERE cfg.tenant_id=t AND cfg.app_id=a AND cfg.environment=e AND cfg.enabled AND cfg.modules->>'missions'='true' AND (xp=0 OR cfg.modules->>'habits'='true') AND reg.name=ev AND reg.is_value
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;

CREATE OR REPLACE FUNCTION r3_v1_daily_mission_status(t TEXT,a TEXT,e TEXT,s TEXT)
RETURNS TABLE(mission_key TEXT,event_name TEXT,day DATE,target INTEGER,progress INTEGER,completed BOOLEAN,reward_xp INTEGER,claimed BOOLEAN)
LANGUAGE sql STABLE AS $$
 SELECT m.mission_key,m.event_name,(NOW() AT TIME ZONE u.timezone)::date AS day,m.target,
 LEAST(m.target,(SELECT COUNT(*)::INTEGER FROM r3_v1_events ev WHERE ev.tenant_id=t AND ev.app_id=a AND ev.environment=e AND ev.subject_id=s AND ev.name=m.event_name AND (ev.occurred_at AT TIME ZONE u.timezone)::date=(NOW() AT TIME ZONE u.timezone)::date)) AS progress,
 (SELECT COUNT(*) FROM r3_v1_events ev WHERE ev.tenant_id=t AND ev.app_id=a AND ev.environment=e AND ev.subject_id=s AND ev.name=m.event_name AND (ev.occurred_at AT TIME ZONE u.timezone)::date=(NOW() AT TIME ZONE u.timezone)::date)>=m.target AS completed,
 m.reward_xp,
 EXISTS(SELECT 1 FROM r3_v1_daily_mission_claims c WHERE c.tenant_id=t AND c.app_id=a AND c.environment=e AND c.subject_id=s AND c.mission_key=m.mission_key AND c.local_day=(NOW() AT TIME ZONE u.timezone)::date) AS claimed
 FROM r3_v1_subjects u JOIN r3_v1_apps cfg USING(tenant_id,app_id,environment)
 JOIN r3_v1_daily_missions m ON m.tenant_id=u.tenant_id AND m.app_id=u.app_id AND m.environment=u.environment
 WHERE u.tenant_id=t AND u.app_id=a AND u.environment=e AND u.subject_id=s AND cfg.enabled AND cfg.modules->>'missions'='true' ORDER BY m.mission_key
$$;

CREATE OR REPLACE FUNCTION r3_v1_claim_daily_mission(t TEXT,a TEXT,e TEXT,s TEXT,k TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$ DECLARE earned INTEGER; d DATE; n INTEGER; BEGIN
 PERFORM 1 FROM r3_v1_subjects WHERE tenant_id=t AND app_id=a AND environment=e AND subject_id=s FOR UPDATE;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 SELECT r.reward_xp,r.day INTO earned,d FROM r3_v1_daily_mission_status(t,a,e,s) r WHERE r.mission_key=k AND r.completed;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 INSERT INTO r3_v1_daily_mission_claims(tenant_id,app_id,environment,subject_id,mission_key,local_day,earned_xp)
 VALUES(t,a,e,s,k,d,earned) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RETURN FALSE; END IF;
 UPDATE r3_v1_habits h SET xp=h.xp+earned,updated_at=NOW() FROM r3_v1_apps cfg WHERE h.tenant_id=t AND h.app_id=a AND h.environment=e AND h.subject_id=s
 AND cfg.tenant_id=t AND cfg.app_id=a AND cfg.environment=e AND cfg.modules->>'habits'='true';
 RETURN TRUE;
END $$;

-- Friend streaks: one verified value event per friend, per UTC day after bilateral acceptance.
-- UTC is deliberately the shared clock, avoiding subject-dependent timezone ambiguity.
CREATE OR REPLACE FUNCTION r3_v1_friend_streak(t TEXT,a TEXT,e TEXT,s TEXT,f TEXT)
RETURNS TABLE(streak INTEGER,longest_streak INTEGER,last_shared_day DATE) LANGUAGE plpgsql STABLE AS $$
DECLARE accepted_at TIMESTAMPTZ; d DATE; last_d DATE; run INTEGER:=0; best INTEGER:=0;
BEGIN
 IF s=f THEN RETURN; END IF;
 SELECT rel.updated_at INTO accepted_at FROM r3_v1_friendships rel JOIN r3_v1_apps cfg USING(tenant_id,app_id,environment)
 WHERE rel.tenant_id=t AND rel.app_id=a AND rel.environment=e AND rel.user_low=LEAST(s,f) AND rel.user_high=GREATEST(s,f)
 AND rel.status='accepted' AND cfg.enabled AND cfg.modules->>'friendStreaks'='true';
 IF NOT FOUND THEN RETURN; END IF;
 FOR d IN WITH days_a AS (SELECT DISTINCT (ev.occurred_at AT TIME ZONE 'UTC')::date AS d FROM r3_v1_events ev
 JOIN r3_v1_event_registry r USING(tenant_id,app_id,environment,name)
 WHERE ev.tenant_id=t AND ev.app_id=a AND ev.environment=e AND ev.subject_id=s AND r.is_value AND ev.occurred_at>accepted_at AND ev.occurred_at<=NOW()),
 days_b AS (SELECT DISTINCT (ev.occurred_at AT TIME ZONE 'UTC')::date AS d FROM r3_v1_events ev
 JOIN r3_v1_event_registry r USING(tenant_id,app_id,environment,name)
 WHERE ev.tenant_id=t AND ev.app_id=a AND ev.environment=e AND ev.subject_id=f AND r.is_value AND ev.occurred_at>accepted_at AND ev.occurred_at<=NOW())
 SELECT da.d FROM days_a da JOIN days_b db USING(d) ORDER BY da.d
 LOOP
  IF last_d IS NOT NULL AND d=last_d+1 THEN run:=run+1; ELSE run:=1; END IF;
  best:=GREATEST(best,run);last_d:=d;
 END LOOP;
 RETURN QUERY SELECT CASE WHEN last_d IS NOT NULL AND last_d >= (NOW() AT TIME ZONE 'UTC')::date-1 THEN run ELSE 0 END,best,last_d;
END $$;
