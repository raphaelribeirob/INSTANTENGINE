-- TMNT v2.1: non-destructive, opt-in social antiabuse controls.
-- socialMaxFriends and socialDailyInvites are validated by the SDK, stored in app modules JSON.
-- Defaults: max 5 pending+accepted relationships per participant, max 5 successful invites per rolling 24h.
-- Apply after 0005; validate on an isolated Neon branch before deploying.
CREATE TABLE IF NOT EXISTS r3_v1_social_invite_audit (
 tenant_id TEXT NOT NULL, app_id TEXT NOT NULL, environment TEXT NOT NULL,
 inviter TEXT NOT NULL, invited TEXT NOT NULL, invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 request_id UUID NOT NULL DEFAULT gen_random_uuid(),
 PRIMARY KEY (tenant_id,app_id,environment,request_id),
 FOREIGN KEY (tenant_id,app_id,environment,inviter) REFERENCES r3_v1_subjects ON DELETE CASCADE,
 FOREIGN KEY (tenant_id,app_id,environment,invited) REFERENCES r3_v1_subjects ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS r3_v1_social_invite_rate_idx ON r3_v1_social_invite_audit(tenant_id,app_id,environment,inviter,invited_at DESC);

CREATE OR REPLACE FUNCTION r3_v1_invite_friend(t TEXT,a TEXT,e TEXT,s TEXT,f TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE cfg r3_v1_apps%ROWTYPE; max_friends INTEGER; daily_limit INTEGER; n INTEGER; c INTEGER;
BEGIN
 IF s IS NULL OR f IS NULL OR s=f THEN RETURN FALSE; END IF;
 SELECT * INTO cfg FROM r3_v1_apps WHERE tenant_id=t AND app_id=a AND environment=e;
 IF NOT FOUND OR NOT cfg.enabled OR cfg.modules->>'social' IS DISTINCT FROM 'true' THEN RETURN FALSE; END IF;
 max_friends:=COALESCE((cfg.modules->>'socialMaxFriends')::INTEGER,5);
 daily_limit:=COALESCE((cfg.modules->>'socialDailyInvites')::INTEGER,5);
 IF max_friends NOT BETWEEN 1 AND 50 OR daily_limit NOT BETWEEN 1 AND 50 THEN RETURN FALSE; END IF;
 -- Lock both members in lexicographic order; serializes overlapping invitations.
 PERFORM 1 FROM r3_v1_subjects u WHERE u.tenant_id=t AND u.app_id=a AND u.environment=e
 AND u.subject_id IN(s,f) ORDER BY u.subject_id FOR UPDATE;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>2 THEN RETURN FALSE; END IF;
 IF EXISTS(SELECT 1 FROM r3_v1_friendships r WHERE r.tenant_id=t AND r.app_id=a AND r.environment=e AND r.user_low=LEAST(s,f) AND r.user_high=GREATEST(s,f)) THEN RETURN FALSE; END IF;
 SELECT COUNT(*) INTO c FROM r3_v1_friendships r WHERE r.tenant_id=t AND r.app_id=a AND r.environment=e
 AND r.status IN('pending','accepted') AND (r.user_low=s OR r.user_high=s);
 IF c>=max_friends THEN RETURN FALSE; END IF;
 SELECT COUNT(*) INTO c FROM r3_v1_friendships r WHERE r.tenant_id=t AND r.app_id=a AND r.environment=e
 AND r.status IN('pending','accepted') AND (r.user_low=f OR r.user_high=f);
 IF c>=max_friends THEN RETURN FALSE; END IF;
 SELECT COUNT(*) INTO c FROM r3_v1_social_invite_audit h WHERE h.tenant_id=t AND h.app_id=a AND h.environment=e
 AND h.inviter=s AND h.invited_at>NOW()-INTERVAL '24 hours';
 IF c>=daily_limit THEN RETURN FALSE; END IF;
 INSERT INTO r3_v1_friendships(tenant_id,app_id,environment,user_low,user_high,requester)
 VALUES(t,a,e,LEAST(s,f),GREATEST(s,f),s) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RETURN FALSE; END IF;
 INSERT INTO r3_v1_social_invite_audit(tenant_id,app_id,environment,inviter,invited) VALUES(t,a,e,s,f);
 RETURN TRUE;
END $$;
