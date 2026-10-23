-- TMNT Engine v1.7: optional, verified commerce + contextual feedback.
-- Run after 0001–0006 on a NON-PRODUCTION branch first. Backend credentials only.
-- No webhook, payment, offer verification or store-review display is implied here.
-- TMNT_STATEMENT
ALTER TABLE r3_v1_subjects ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- TMNT_STATEMENT
CREATE TABLE IF NOT EXISTS r3_v1_offers (
 tenant_id TEXT NOT NULL, app_id TEXT NOT NULL, environment TEXT NOT NULL,
 offer_id TEXT NOT NULL, conversion_event TEXT NOT NULL,
 currency TEXT NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 list_price_minor BIGINT NOT NULL CHECK(list_price_minor>0 AND list_price_minor<=10000000000),
 discount_minor BIGINT NOT NULL CHECK(discount_minor>0 AND discount_minor<=list_price_minor),
 starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
 max_redemptions INTEGER NOT NULL CHECK(max_redemptions BETWEEN 1 AND 1000000),
 redemption_count INTEGER NOT NULL DEFAULT 0 CHECK(redemption_count>=0 AND redemption_count<=max_redemptions),
 verification_ref TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,offer_id),
 FOREIGN KEY(tenant_id,app_id,environment) REFERENCES r3_v1_apps ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,app_id,environment,conversion_event) REFERENCES r3_v1_event_registry(tenant_id,app_id,environment,name),
 CHECK(ends_at>starts_at AND ends_at<=starts_at+INTERVAL '366 days')
);
-- TMNT_STATEMENT
CREATE INDEX IF NOT EXISTS r3_v1_offer_live_idx ON r3_v1_offers(tenant_id,app_id,environment,starts_at,ends_at);
-- TMNT_STATEMENT
CREATE TABLE IF NOT EXISTS r3_v1_redemptions (
 tenant_id TEXT NOT NULL, app_id TEXT NOT NULL, environment TEXT NOT NULL,
 redemption_id UUID NOT NULL DEFAULT gen_random_uuid(), subject_id TEXT NOT NULL,
 offer_id TEXT NOT NULL, event_id UUID NOT NULL,
 discount_minor BIGINT NOT NULL CHECK(discount_minor>0), currency TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','settled')),
 applied_discount_minor BIGINT CHECK(applied_discount_minor>=0 AND applied_discount_minor<=discount_minor),
 checkout_ref TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),settled_at TIMESTAMPTZ,
 PRIMARY KEY(tenant_id,app_id,environment,redemption_id),
 UNIQUE(tenant_id,app_id,environment,event_id),
 UNIQUE(tenant_id,app_id,environment,subject_id,offer_id),
 FOREIGN KEY(tenant_id,app_id,environment,offer_id) REFERENCES r3_v1_offers ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,app_id,environment,event_id) REFERENCES r3_v1_events ON DELETE CASCADE,
 CHECK((status='pending' AND checkout_ref IS NULL AND settled_at IS NULL AND applied_discount_minor IS NULL)
    OR (status='settled' AND checkout_ref IS NOT NULL AND settled_at IS NOT NULL AND applied_discount_minor IS NOT NULL))
);
-- TMNT_STATEMENT
CREATE UNIQUE INDEX IF NOT EXISTS r3_v1_checkout_unique ON r3_v1_redemptions(tenant_id,app_id,environment,checkout_ref) WHERE checkout_ref IS NOT NULL;
-- TMNT_STATEMENT
CREATE INDEX IF NOT EXISTS r3_v1_redemptions_subject ON r3_v1_redemptions(tenant_id,app_id,environment,subject_id,status);
-- TMNT_STATEMENT
CREATE TABLE IF NOT EXISTS r3_v1_feedback (
 tenant_id TEXT NOT NULL, app_id TEXT NOT NULL, environment TEXT NOT NULL,
 event_id UUID NOT NULL, subject_id TEXT NOT NULL, score INT NOT NULL CHECK(score BETWEEN 0 AND 10),
 reason TEXT NOT NULL CHECK(reason IN ('content','price','usability','performance','support','other')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,event_id),
 FOREIGN KEY(tenant_id,app_id,environment,event_id) REFERENCES r3_v1_events ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE
);
-- TMNT_STATEMENT
CREATE TABLE IF NOT EXISTS r3_v1_review_prompt_claims (
 claim_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,
 subject_id TEXT NOT NULL,platform TEXT NOT NULL CHECK(platform IN('ios','android')),
 requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE
);
-- TMNT_STATEMENT
CREATE INDEX IF NOT EXISTS r3_v1_review_prompt_claims_subject ON r3_v1_review_prompt_claims(tenant_id,app_id,environment,subject_id,requested_at DESC);

-- TMNT_STATEMENT
CREATE OR REPLACE FUNCTION r3_v1_publish_offer(t TEXT,a TEXT,e TEXT,oid TEXT,conversion TEXT,curr TEXT,price BIGINT,discount BIGINT,starts TIMESTAMPTZ,expires TIMESTAMPTZ,lim INT,verification TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$ DECLARE count_rows INTEGER;
BEGIN
 IF oid IS NULL OR oid !~ '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$'
    OR verification IS NULL OR verification !~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$'
    OR curr !~ '^[A-Z]{3}$' OR price IS NULL OR discount IS NULL OR price<1 OR price>10000000000
    OR discount<1 OR discount>price OR lim NOT BETWEEN 1 AND 1000000
    OR starts IS NULL OR expires IS NULL OR expires<=starts OR expires>starts+INTERVAL '366 days' THEN RETURN FALSE;END IF;
 INSERT INTO r3_v1_offers(tenant_id,app_id,environment,offer_id,conversion_event,currency,list_price_minor,discount_minor,starts_at,ends_at,max_redemptions,verification_ref)
 SELECT t,a,e,oid,conversion,curr,price,discount,starts,expires,lim,verification
 FROM r3_v1_apps cfg JOIN r3_v1_event_registry reg USING(tenant_id,app_id,environment)
 WHERE cfg.tenant_id=t AND cfg.app_id=a AND cfg.environment=e AND cfg.enabled
 AND cfg.modules->>'offers'='true' AND reg.name=conversion AND reg.is_value
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS count_rows=ROW_COUNT;RETURN count_rows=1;
END $$;

-- TMNT_STATEMENT
CREATE OR REPLACE FUNCTION r3_v1_list_offers(t TEXT,a TEXT,e TEXT,s TEXT,personalized BOOLEAN)
RETURNS TABLE(offer_id TEXT,currency TEXT,list_price_minor BIGINT,discount_minor BIGINT,starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
 SELECT o.offer_id,o.currency,o.list_price_minor,o.discount_minor,o.starts_at,o.ends_at
 FROM r3_v1_offers o JOIN r3_v1_apps cfg USING(tenant_id,app_id,environment)
 JOIN r3_v1_subjects u ON u.tenant_id=o.tenant_id AND u.app_id=o.app_id AND u.environment=o.environment AND u.subject_id=s
 WHERE o.tenant_id=t AND o.app_id=a AND o.environment=e AND cfg.enabled AND cfg.modules->>'offers'='true'
 AND o.starts_at<=NOW() AND o.ends_at>NOW() AND o.redemption_count<o.max_redemptions
 AND (NOT COALESCE(personalized,FALSE) OR EXISTS(SELECT 1 FROM r3_v1_consents c WHERE c.tenant_id=t AND c.app_id=a AND c.environment=e AND c.subject_id=s AND c.channel='in_app' AND c.purpose='marketing' AND c.granted AND c.verified))
 AND NOT EXISTS(SELECT 1 FROM r3_v1_redemptions r WHERE r.tenant_id=t AND r.app_id=a AND r.environment=e AND r.offer_id=o.offer_id AND r.subject_id=s)
 ORDER BY o.ends_at ASC,o.offer_id ASC;
$$;

-- TMNT_STATEMENT
CREATE OR REPLACE FUNCTION r3_v1_redeem_offer(t TEXT,a TEXT,e TEXT,s TEXT,oid TEXT,ev_id UUID)
RETURNS TABLE(redemption_id UUID,discount_minor BIGINT,currency TEXT,status TEXT)
LANGUAGE plpgsql AS $$ DECLARE offer_row r3_v1_offers%ROWTYPE; event_row r3_v1_events%ROWTYPE; saved UUID;
BEGIN
 SELECT * INTO offer_row FROM r3_v1_offers WHERE tenant_id=t AND app_id=a AND environment=e AND offer_id=oid FOR UPDATE;
 IF NOT FOUND OR offer_row.starts_at>NOW() OR offer_row.ends_at<=NOW() OR offer_row.redemption_count>=offer_row.max_redemptions THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM r3_v1_apps cfg WHERE cfg.tenant_id=t AND cfg.app_id=a AND cfg.environment=e AND cfg.enabled AND cfg.modules->>'offers'='true') THEN RETURN; END IF;
 SELECT * INTO event_row FROM r3_v1_events WHERE tenant_id=t AND app_id=a AND environment=e AND event_id=ev_id;
 IF NOT FOUND OR event_row.subject_id<>s OR event_row.name<>offer_row.conversion_event OR event_row.occurred_at<offer_row.starts_at OR event_row.occurred_at>NOW() THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM r3_v1_redemptions r WHERE r.tenant_id=t AND r.app_id=a AND r.environment=e AND (r.event_id=ev_id OR (r.subject_id=s AND r.offer_id=oid))) THEN RETURN;END IF;
 INSERT INTO r3_v1_redemptions(tenant_id,app_id,environment,subject_id,offer_id,event_id,discount_minor,currency)
 VALUES(t,a,e,s,oid,ev_id,offer_row.discount_minor,offer_row.currency) ON CONFLICT DO NOTHING RETURNING r3_v1_redemptions.redemption_id INTO saved;
 IF saved IS NULL THEN RETURN;END IF;
 UPDATE r3_v1_offers SET redemption_count=redemption_count+1 WHERE tenant_id=t AND app_id=a AND environment=e AND offer_id=oid;
 RETURN QUERY SELECT saved,offer_row.discount_minor,offer_row.currency,'pending'::TEXT;
END $$;

-- TMNT_STATEMENT
CREATE OR REPLACE FUNCTION r3_v1_settle_redemption(t TEXT,a TEXT,e TEXT,s TEXT,rid UUID,receipt TEXT,applied BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$ DECLARE r r3_v1_redemptions%ROWTYPE; affected INTEGER;
BEGIN
 IF receipt IS NULL OR receipt !~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$' OR applied IS NULL OR applied<0 THEN RETURN FALSE;END IF;
 SELECT * INTO r FROM r3_v1_redemptions WHERE tenant_id=t AND app_id=a AND environment=e AND subject_id=s AND redemption_id=rid FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' OR applied>r.discount_minor THEN RETURN FALSE;END IF;
 UPDATE r3_v1_redemptions SET status='settled',applied_discount_minor=applied,checkout_ref=receipt,settled_at=NOW()
 WHERE tenant_id=t AND app_id=a AND environment=e AND redemption_id=rid;
 GET DIAGNOSTICS affected=ROW_COUNT;RETURN affected=1;
 EXCEPTION WHEN unique_violation THEN RETURN FALSE;
END $$;

-- TMNT_STATEMENT
CREATE OR REPLACE FUNCTION r3_v1_savings(t TEXT,a TEXT,e TEXT,s TEXT)
RETURNS TABLE(currency TEXT,total_minor BIGINT,redemption_count BIGINT) LANGUAGE sql STABLE AS $$
 SELECT r.currency,COALESCE(SUM(r.applied_discount_minor),0)::BIGINT,COUNT(*)::BIGINT
 FROM r3_v1_redemptions r WHERE r.tenant_id=t AND r.app_id=a AND r.environment=e AND r.subject_id=s AND r.status='settled' GROUP BY r.currency ORDER BY r.currency;
$$;

-- TMNT_STATEMENT
CREATE OR REPLACE FUNCTION r3_v1_record_feedback(t TEXT,a TEXT,e TEXT,s TEXT,ev_id UUID,score INT,reason TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$ DECLARE affected INTEGER;
BEGIN
 IF score NOT BETWEEN 0 AND 10 OR reason NOT IN ('content','price','usability','performance','support','other') THEN RETURN FALSE;END IF;
 INSERT INTO r3_v1_feedback(tenant_id,app_id,environment,event_id,subject_id,score,reason)
 SELECT t,a,e,ev_id,s,score,reason FROM r3_v1_events ev JOIN r3_v1_event_registry reg USING(tenant_id,app_id,environment,name)
 JOIN r3_v1_apps cfg USING(tenant_id,app_id,environment)
 WHERE ev.tenant_id=t AND ev.app_id=a AND ev.environment=e AND ev.event_id=ev_id AND ev.subject_id=s AND reg.is_value
 AND cfg.enabled AND cfg.modules->>'feedback'='true' ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS affected=ROW_COUNT;RETURN affected=1;
END $$;

-- Caller must have independently verified completed session, foreground, and idle UI.
-- Store dialog appearance is controlled by Apple/Google, not the engine.
-- TMNT_STATEMENT
CREATE OR REPLACE FUNCTION r3_v1_claim_review_prompt(t TEXT,a TEXT,e TEXT,s TEXT,platform TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$ DECLARE u r3_v1_subjects%ROWTYPE; claims_year INTEGER; last_claim TIMESTAMPTZ;
BEGIN
 IF platform NOT IN ('ios','android') THEN RETURN FALSE;END IF;
 SELECT * INTO u FROM r3_v1_subjects WHERE tenant_id=t AND app_id=a AND environment=e AND subject_id=s FOR UPDATE;
 IF NOT FOUND OR u.created_at>NOW()-INTERVAL '7 days' OR u.value_count<5 THEN RETURN FALSE;END IF;
 IF NOT EXISTS(SELECT 1 FROM r3_v1_apps cfg WHERE cfg.tenant_id=t AND cfg.app_id=a AND cfg.environment=e AND cfg.enabled AND cfg.modules->>'feedback'='true') THEN RETURN FALSE;END IF;
 SELECT COUNT(*)::INT,MAX(requested_at) INTO claims_year,last_claim FROM r3_v1_review_prompt_claims
 WHERE tenant_id=t AND app_id=a AND environment=e AND subject_id=s AND requested_at>NOW()-INTERVAL '365 days';
 IF claims_year>=2 OR last_claim>NOW()-INTERVAL '90 days' THEN RETURN FALSE;END IF;
 INSERT INTO r3_v1_review_prompt_claims(tenant_id,app_id,environment,subject_id,platform) VALUES(t,a,e,s,platform);
 RETURN TRUE;
END $$;
