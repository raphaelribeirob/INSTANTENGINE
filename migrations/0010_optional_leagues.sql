-- Opt-in, pseudonymous weekly leaderboards. No public identity display.
CREATE TABLE IF NOT EXISTS r3_v1_league_members(
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,subject_id TEXT NOT NULL,
 joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,subject_id),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE);
CREATE OR REPLACE FUNCTION r3_v1_join_league(t TEXT,a TEXT,e TEXT,s TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$ DECLARE n INTEGER; BEGIN
 INSERT INTO r3_v1_league_members(tenant_id,app_id,environment,subject_id)
 SELECT t,a,e,s FROM r3_v1_apps cfg JOIN r3_v1_subjects u USING(tenant_id,app_id,environment)
 WHERE cfg.tenant_id=t AND cfg.app_id=a AND cfg.environment=e AND u.subject_id=s AND cfg.enabled AND cfg.modules->>'leagues'='true' ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n=1;
END $$;
CREATE OR REPLACE FUNCTION r3_v1_leave_league(t TEXT,a TEXT,e TEXT,s TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$ DECLARE n INTEGER; BEGIN
 DELETE FROM r3_v1_league_members WHERE tenant_id=t AND app_id=a AND environment=e AND subject_id=s;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n=1;
END $$;
CREATE OR REPLACE FUNCTION r3_v1_weekly_leaderboard(t TEXT,a TEXT,e TEXT,s TEXT,lim INTEGER)
RETURNS TABLE(rank BIGINT,score BIGINT,is_self BOOLEAN) LANGUAGE sql STABLE AS $$
 WITH allowed AS (SELECT 1 FROM r3_v1_league_members m JOIN r3_v1_apps cfg USING(tenant_id,app_id,environment)
 WHERE m.tenant_id=t AND m.app_id=a AND m.environment=e AND m.subject_id=s AND cfg.enabled AND cfg.modules->>'leagues'='true'),
 days AS (SELECT ev.subject_id,(ev.occurred_at AT TIME ZONE 'UTC')::date AS day,LEAST(COUNT(*)::INTEGER,10)*10 AS points
 FROM r3_v1_events ev JOIN r3_v1_event_registry reg USING(tenant_id,app_id,environment,name) JOIN r3_v1_league_members participant USING(tenant_id,app_id,environment,subject_id)
 WHERE ev.tenant_id=t AND ev.app_id=a AND ev.environment=e AND reg.is_value
 AND ev.occurred_at >= DATE_TRUNC('week',NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND ev.occurred_at>participant.joined_at AND ev.occurred_at<=NOW()
 GROUP BY ev.subject_id,(ev.occurred_at AT TIME ZONE 'UTC')::date),
 totals AS (SELECT m.subject_id,COALESCE(SUM(d.points),0)::BIGINT AS score FROM r3_v1_league_members m
 LEFT JOIN days d ON d.subject_id=m.subject_id WHERE m.tenant_id=t AND m.app_id=a AND m.environment=e GROUP BY m.subject_id),
 ordered AS (SELECT ROW_NUMBER() OVER(ORDER BY totals.score DESC,totals.subject_id ASC) AS rank,totals.score,totals.subject_id=s AS is_self FROM totals)
 SELECT ordered.rank,ordered.score,ordered.is_self FROM ordered CROSS JOIN allowed WHERE lim BETWEEN 1 AND 50 ORDER BY ordered.rank LIMIT lim
$$;
