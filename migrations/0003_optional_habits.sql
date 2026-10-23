-- Apply after r3_v1 core schema. Opt-in: only apps.modules.habits=true.
CREATE TABLE IF NOT EXISTS r3_v1_habits (
 tenant_id TEXT NOT NULL, app_id TEXT NOT NULL, environment TEXT NOT NULL,
 subject_id TEXT NOT NULL, last_day DATE, streak INTEGER NOT NULL DEFAULT 0,
 longest_streak INTEGER NOT NULL DEFAULT 0, today_count INTEGER NOT NULL DEFAULT 0,
 daily_goal INTEGER NOT NULL DEFAULT 1 CHECK(daily_goal BETWEEN 1 AND 10),
 xp BIGINT NOT NULL DEFAULT 0, freeze_balance INTEGER NOT NULL DEFAULT 1 CHECK(freeze_balance BETWEEN 0 AND 2),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,subject_id),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id)
 REFERENCES r3_v1_subjects ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS r3_v1_habit_rewards (
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,subject_id TEXT NOT NULL,
 milestone INTEGER NOT NULL CHECK(milestone IN (7,30,100)), earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,subject_id,milestone),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id)
 REFERENCES r3_v1_subjects ON DELETE CASCADE
);
CREATE OR REPLACE FUNCTION r3_v1_apply_habit_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE allowed BOOLEAN; zone TEXT; day_local DATE; state r3_v1_habits%ROWTYPE; gap INTEGER; missed INTEGER; balance INTEGER; streak_new INTEGER; inserted_count INTEGER;
BEGIN
 SELECT (a.modules->>'habits'='true') AND r.is_value,u.timezone INTO allowed,zone
 FROM r3_v1_apps a JOIN r3_v1_event_registry r
 ON r.tenant_id=a.tenant_id AND r.app_id=a.app_id AND r.environment=a.environment
 JOIN r3_v1_subjects u ON u.tenant_id=a.tenant_id AND u.app_id=a.app_id AND u.environment=a.environment
 WHERE a.tenant_id=NEW.tenant_id AND a.app_id=NEW.app_id AND a.environment=NEW.environment AND r.name=NEW.name AND u.subject_id=NEW.subject_id;
 IF allowed IS DISTINCT FROM TRUE THEN RETURN NEW; END IF;
 day_local:=(NEW.occurred_at AT TIME ZONE zone)::date;
 INSERT INTO r3_v1_habits(tenant_id,app_id,environment,subject_id)
 VALUES(NEW.tenant_id,NEW.app_id,NEW.environment,NEW.subject_id) ON CONFLICT DO NOTHING;
 SELECT * INTO state FROM r3_v1_habits WHERE tenant_id=NEW.tenant_id AND app_id=NEW.app_id AND environment=NEW.environment AND subject_id=NEW.subject_id FOR UPDATE;
 IF state.last_day IS NOT NULL AND day_local<state.last_day THEN RETURN NEW; END IF;
 gap:=CASE WHEN state.last_day IS NULL THEN NULL ELSE day_local-state.last_day END;
 IF gap=0 THEN
  UPDATE r3_v1_habits SET today_count=today_count+1,xp=xp+10,updated_at=NOW()
  WHERE tenant_id=NEW.tenant_id AND app_id=NEW.app_id AND environment=NEW.environment AND subject_id=NEW.subject_id;
  RETURN NEW;
 END IF;
 missed:=CASE WHEN gap IS NULL THEN 0 ELSE GREATEST(0,gap-1) END;
 balance:=state.freeze_balance;
 streak_new:=CASE WHEN gap IS NULL THEN 1 WHEN gap=1 THEN state.streak+1 WHEN missed>0 AND missed<=balance THEN state.streak+1 ELSE 1 END;
 IF missed>0 AND missed<=balance THEN balance:=balance-missed; END IF;
 IF streak_new IN (7,30,100) THEN
  INSERT INTO r3_v1_habit_rewards(tenant_id,app_id,environment,subject_id,milestone)
  VALUES(NEW.tenant_id,NEW.app_id,NEW.environment,NEW.subject_id,streak_new)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted_count=ROW_COUNT;
  IF inserted_count=1 THEN balance:=LEAST(2,balance+1); END IF;
 END IF;
 UPDATE r3_v1_habits SET last_day=day_local,streak=streak_new,
 longest_streak=GREATEST(state.longest_streak,streak_new),today_count=1,
 xp=xp+10,freeze_balance=balance,updated_at=NOW()
 WHERE tenant_id=NEW.tenant_id AND app_id=NEW.app_id AND environment=NEW.environment AND subject_id=NEW.subject_id;
 RETURN NEW;
END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='r3_v1_habit_value_event' AND tgrelid='r3_v1_events'::regclass) THEN CREATE TRIGGER r3_v1_habit_value_event AFTER INSERT ON r3_v1_events FOR EACH ROW EXECUTE FUNCTION r3_v1_apply_habit_event(); END IF; END $$;
CREATE OR REPLACE FUNCTION r3_v1_set_habit_goal(t TEXT,a TEXT,e TEXT,s TEXT,goal INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$ DECLARE count_rows INTEGER; BEGIN
 IF goal<1 OR goal>10 OR goal IS NULL THEN RETURN FALSE; END IF;
 UPDATE r3_v1_habits h SET daily_goal=goal,updated_at=NOW()
 FROM r3_v1_apps ap
 WHERE h.tenant_id=t AND h.app_id=a AND h.environment=e AND h.subject_id=s
 AND ap.tenant_id=t AND ap.app_id=a AND ap.environment=e AND ap.modules->>'habits'='true';
 GET DIAGNOSTICS count_rows=ROW_COUNT;RETURN count_rows=1;
END $$;
