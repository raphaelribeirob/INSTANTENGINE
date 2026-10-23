-- TMNT v2.1: trusted, idempotent offline-sync repair.
-- Recompute from durable value events, never from client-supplied streak counters.
-- Run after 0003 and 0009 on an isolated QA branch first.
CREATE OR REPLACE FUNCTION r3_v1_reconcile_habit(t TEXT,a TEXT,e TEXT,s TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE zone TEXT; h r3_v1_habits%ROWTYPE; last_day_local DATE := NULL;
 d DATE; evt RECORD; current_streak INTEGER:=0; longest INTEGER:=0; today INTEGER:=0;
 total_xp BIGINT:=0; balance INTEGER:=1; missed INTEGER; gap INTEGER; days_rewarded INT[]:='{}'; extra_xp BIGINT;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM r3_v1_apps ap WHERE ap.tenant_id=t AND ap.app_id=a AND ap.environment=e AND ap.enabled AND ap.modules->>'habits'='true') THEN RETURN FALSE; END IF;
 SELECT u.timezone INTO zone FROM r3_v1_subjects u WHERE u.tenant_id=t AND u.app_id=a AND u.environment=e AND u.subject_id=s FOR UPDATE;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 INSERT INTO r3_v1_habits(tenant_id,app_id,environment,subject_id) VALUES(t,a,e,s) ON CONFLICT DO NOTHING;
 SELECT * INTO h FROM r3_v1_habits WHERE tenant_id=t AND app_id=a AND environment=e AND subject_id=s FOR UPDATE;
 FOR evt IN SELECT ev.occurred_at,ev.event_id FROM r3_v1_events ev JOIN r3_v1_event_registry reg USING(tenant_id,app_id,environment,name)
 WHERE ev.tenant_id=t AND ev.app_id=a AND ev.environment=e AND ev.subject_id=s AND reg.is_value AND ev.occurred_at<=NOW()+INTERVAL '5 minutes'
 ORDER BY ev.occurred_at,ev.event_id LOOP
  d := (evt.occurred_at AT TIME ZONE zone)::DATE;
  total_xp:=total_xp+10;
  IF d=last_day_local THEN today:=today+1;CONTINUE;END IF;
  gap:=CASE WHEN last_day_local IS NULL THEN NULL ELSE d-last_day_local END;
  missed:=CASE WHEN gap IS NULL THEN 0 ELSE GREATEST(0,gap-1) END;
  IF gap IS NULL OR gap=1 THEN current_streak:=current_streak+1;
  ELSIF missed<=balance THEN current_streak:=current_streak+1; balance:=balance-missed;
  ELSE current_streak:=1;END IF;
  today:=1;last_day_local:=d;longest:=GREATEST(longest,current_streak);
  IF current_streak=ANY(ARRAY[7,30,100]) AND NOT(current_streak=ANY(days_rewarded)) THEN
   days_rewarded:=array_append(days_rewarded,current_streak);
   balance:=LEAST(2,balance+1);
   INSERT INTO r3_v1_habit_rewards(tenant_id,app_id,environment,subject_id,milestone)
   VALUES(t,a,e,s,current_streak) ON CONFLICT DO NOTHING;
  END IF;
 END LOOP;
 SELECT COALESCE(SUM(earned_xp),0) INTO extra_xp FROM r3_v1_daily_mission_claims
 WHERE tenant_id=t AND app_id=a AND environment=e AND subject_id=s;
 UPDATE r3_v1_habits SET last_day=last_day_local,streak=current_streak,longest_streak=longest,today_count=today,
 xp=total_xp+extra_xp,freeze_balance=balance,updated_at=NOW()
 WHERE tenant_id=t AND app_id=a AND environment=e AND subject_id=s;
 RETURN TRUE;
END $$;
