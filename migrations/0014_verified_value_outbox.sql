-- RIVERENGINE v2.9: transactional analytics-consented verified value-event outbox. No user identifiers or raw payloads in jobs.
-- Prerequisite: 0000..0013. Disabled delivery by default, no network side-effects in database.
CREATE TABLE IF NOT EXISTS river_v1_verified_value_outbox (
 tenant_id text NOT NULL, app_id text NOT NULL, environment text NOT NULL,
 event_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending'
   CHECK(status IN ('pending','leased','acknowledged','discarded','dead')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 20),
 available_at timestamptz NOT NULL DEFAULT NOW(), lease_until timestamptz,
 lease_token uuid, last_error text,
 created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,event_id),
 FOREIGN KEY(tenant_id,app_id,environment,event_id)
  REFERENCES r3_v1_events(tenant_id,app_id,environment,event_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS river_v1_verified_value_outbox_ready
 ON river_v1_verified_value_outbox(status,available_at,lease_until);
CREATE OR REPLACE FUNCTION river_v1_outbox_on_value() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM r3_v1_event_registry r
    WHERE r.tenant_id=NEW.tenant_id AND r.app_id=NEW.app_id AND r.environment=NEW.environment
      AND r.name=NEW.name AND r.is_value)
   AND EXISTS(SELECT 1 FROM r3_v1_apps a
       JOIN river_v1_analytics_consents c USING(tenant_id,app_id,environment)
       WHERE a.tenant_id=NEW.tenant_id AND a.app_id=NEW.app_id AND a.environment=NEW.environment
         AND c.subject_id=NEW.subject_id AND c.granted AND c.verified AND c.updated_at<NEW.recorded_at AND c.updated_at<=NEW.occurred_at
         AND a.enabled AND a.modules->>'analytics'='true') THEN
   INSERT INTO river_v1_verified_value_outbox(tenant_id,app_id,environment,event_id)
     VALUES(NEW.tenant_id,NEW.app_id,NEW.environment,NEW.event_id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='river_value_outbox_insert'
    AND tgrelid='r3_v1_events'::regclass AND NOT tgisinternal) THEN
   CREATE TRIGGER river_value_outbox_insert AFTER INSERT ON r3_v1_events
   FOR EACH ROW EXECUTE FUNCTION river_v1_outbox_on_value();
 END IF;
END $$;
-- Historical data is NOT backfilled automatically. Operator review and explicit
-- consent-aware backfill are required to avoid unexpected replay or backlog.
