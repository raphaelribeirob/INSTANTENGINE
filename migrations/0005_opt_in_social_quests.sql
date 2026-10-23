-- Optional social retention: explicit bilateral friendship + cooperative quest.
-- Never use as a substitute for authenticating the caller's subject in the app backend.
CREATE TABLE IF NOT EXISTS r3_v1_friendships(
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,
 user_low TEXT NOT NULL,user_high TEXT NOT NULL,requester TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,user_low,user_high),
 CHECK(user_low<user_high),CHECK(requester IN (user_low,user_high)),
 FOREIGN KEY(tenant_id,app_id,environment,user_low) REFERENCES r3_v1_subjects ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,app_id,environment,user_high) REFERENCES r3_v1_subjects ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS r3_v1_friend_quests(
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,
 user_low TEXT NOT NULL,user_high TEXT NOT NULL,quest_key TEXT NOT NULL,
 target_days INT NOT NULL CHECK(target_days BETWEEN 2 AND 30),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(tenant_id,app_id,environment,user_low,user_high,quest_key),
 CHECK(expires_at>created_at),
 FOREIGN KEY(tenant_id,app_id,environment,user_low,user_high)
 REFERENCES r3_v1_friendships ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS r3_v1_friend_quest_days(
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,
 user_low TEXT NOT NULL,user_high TEXT NOT NULL,quest_key TEXT NOT NULL,
 subject_id TEXT NOT NULL,local_day DATE NOT NULL,
 PRIMARY KEY(tenant_id,app_id,environment,user_low,user_high,quest_key,subject_id,local_day),
 CHECK(subject_id IN (user_low,user_high)),
 FOREIGN KEY(tenant_id,app_id,environment,user_low,user_high,quest_key)
 REFERENCES r3_v1_friend_quests ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS r3_v1_quest_lookup_low ON r3_v1_friend_quests(tenant_id,app_id,environment,user_low,expires_at);
CREATE INDEX IF NOT EXISTS r3_v1_quest_lookup_high ON r3_v1_friend_quests(tenant_id,app_id,environment,user_high,expires_at);
CREATE OR REPLACE FUNCTION r3_v1_invite_friend(t TEXT,a TEXT,e TEXT,s TEXT,f TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE n INT;BEGIN
 IF s=f OR s IS NULL OR f IS NULL THEN RETURN FALSE;END IF;
 INSERT INTO r3_v1_friendships(tenant_id,app_id,environment,user_low,user_high,requester)
 SELECT t,a,e,LEAST(s,f),GREATEST(s,f),s
 FROM r3_v1_apps x
 WHERE x.tenant_id=t AND x.app_id=a AND x.environment=e AND x.enabled AND x.modules->>'social'='true'
 AND EXISTS(SELECT 1 FROM r3_v1_subjects u WHERE u.tenant_id=t AND u.app_id=a AND u.environment=e AND u.subject_id=s)
 AND EXISTS(SELECT 1 FROM r3_v1_subjects u WHERE u.tenant_id=t AND u.app_id=a AND u.environment=e AND u.subject_id=f)
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n=1;
END $$;
CREATE OR REPLACE FUNCTION r3_v1_respond_friend(t TEXT,a TEXT,e TEXT,s TEXT,f TEXT,accept BOOLEAN) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE n INT;BEGIN
 IF s=f OR s IS NULL OR f IS NULL OR accept IS NULL THEN RETURN FALSE;END IF;
 UPDATE r3_v1_friendships SET status=CASE WHEN accept THEN 'accepted' ELSE 'declined' END,updated_at=NOW()
 WHERE tenant_id=t AND app_id=a AND environment=e AND user_low=LEAST(s,f) AND user_high=GREATEST(s,f)
 AND requester=f AND status='pending';
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n=1;
END $$;
CREATE OR REPLACE FUNCTION r3_v1_remove_friend(t TEXT,a TEXT,e TEXT,s TEXT,f TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE n INT;BEGIN
 IF s=f OR s IS NULL OR f IS NULL THEN RETURN FALSE;END IF;
 DELETE FROM r3_v1_friendships WHERE tenant_id=t AND app_id=a AND environment=e
 AND user_low=LEAST(s,f) AND user_high=GREATEST(s,f);
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n=1;
END $$;
CREATE OR REPLACE FUNCTION r3_v1_start_friend_quest(t TEXT,a TEXT,e TEXT,s TEXT,f TEXT,k TEXT,target INT,days INT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE n INT;BEGIN
 IF s=f OR target IS NULL OR days IS NULL OR days<1 OR days>30 OR target<2 OR target>30 OR target>days*2 OR k IS NULL OR length(k)>100 THEN RETURN FALSE;END IF;
 INSERT INTO r3_v1_friend_quests(tenant_id,app_id,environment,user_low,user_high,quest_key,target_days,expires_at)
 SELECT t,a,e,LEAST(s,f),GREATEST(s,f),k,target,NOW()+(days*INTERVAL '1 day')
 FROM r3_v1_friendships rel JOIN r3_v1_apps cfg USING(tenant_id,app_id,environment)
 WHERE rel.tenant_id=t AND rel.app_id=a AND rel.environment=e AND rel.user_low=LEAST(s,f)
 AND rel.user_high=GREATEST(s,f) AND rel.status='accepted'
 AND cfg.enabled AND cfg.modules->>'social'='true' ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n=1;
END $$;
CREATE OR REPLACE FUNCTION r3_v1_quest_status(t TEXT,a TEXT,e TEXT,s TEXT,f TEXT,k TEXT)
RETURNS TABLE(target_days INT,days_completed BIGINT,completed BOOLEAN,expired BOOLEAN) LANGUAGE sql STABLE AS $$
 SELECT q.target_days,COUNT(d.local_day) AS days_completed,COUNT(d.local_day)>=q.target_days AS completed,NOW()>=q.expires_at AS expired
 FROM r3_v1_friend_quests q LEFT JOIN r3_v1_friend_quest_days d USING(tenant_id,app_id,environment,user_low,user_high,quest_key)
 WHERE q.tenant_id=t AND q.app_id=a AND q.environment=e AND q.user_low=LEAST(s,f)
 AND q.user_high=GREATEST(s,f) AND q.quest_key=k AND s<>f
 GROUP BY q.target_days,q.expires_at $$;
CREATE OR REPLACE FUNCTION r3_v1_apply_friend_quest_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE is_value BOOLEAN; local_day DATE; tz TEXT; q r3_v1_friend_quests%ROWTYPE;
BEGIN
 SELECT r.is_value,u.timezone INTO is_value,tz FROM r3_v1_event_registry r
 JOIN r3_v1_subjects u ON u.tenant_id=r.tenant_id AND u.app_id=r.app_id AND u.environment=r.environment
 WHERE r.tenant_id=NEW.tenant_id AND r.app_id=NEW.app_id AND r.environment=NEW.environment
 AND r.name=NEW.name AND u.subject_id=NEW.subject_id;
 IF NEW.occurred_at>NOW()+INTERVAL '5 minutes' OR NEW.occurred_at<NOW()-INTERVAL '30 days' THEN RETURN NEW; END IF;
 IF is_value IS DISTINCT FROM TRUE OR NOT EXISTS (SELECT 1 FROM r3_v1_apps cfg WHERE cfg.tenant_id=NEW.tenant_id AND cfg.app_id=NEW.app_id AND cfg.environment=NEW.environment AND cfg.enabled AND cfg.modules->>'social'='true') THEN RETURN NEW;END IF;
 local_day:=(NEW.occurred_at AT TIME ZONE tz)::date;
 FOR q IN SELECT * FROM r3_v1_friend_quests WHERE tenant_id=NEW.tenant_id AND app_id=NEW.app_id AND environment=NEW.environment
 AND (user_low=NEW.subject_id OR user_high=NEW.subject_id)
 AND created_at<=NEW.occurred_at AND expires_at>NEW.occurred_at LOOP
  INSERT INTO r3_v1_friend_quest_days(tenant_id,app_id,environment,user_low,user_high,quest_key,subject_id,local_day)
  VALUES(NEW.tenant_id,NEW.app_id,NEW.environment,q.user_low,q.user_high,q.quest_key,NEW.subject_id,local_day)
  ON CONFLICT DO NOTHING;
 END LOOP;
 RETURN NEW;
END $$;
DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='r3_v1_social_value_event' AND tgrelid='r3_v1_events'::regclass) THEN
 CREATE TRIGGER r3_v1_social_value_event AFTER INSERT ON r3_v1_events FOR EACH ROW EXECUTE FUNCTION r3_v1_apply_friend_quest_event();
END IF;END $$;
