-- RIVERENGINE 2.5: PostHog native A/B testing, additive and tenant-isolated.
-- Apply AFTER 0000..0012. Does NOT rename previous experiment/notification contracts.
CREATE TABLE IF NOT EXISTS river_v1_analytics_consents (
 tenant_id TEXT NOT NULL, app_id TEXT NOT NULL, environment TEXT NOT NULL, subject_id TEXT NOT NULL,
 granted BOOLEAN NOT NULL, verified BOOLEAN NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,subject_id),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE,
 CHECK (NOT granted OR verified)
);
CREATE TABLE IF NOT EXISTS river_v1_ab_assignments (
 tenant_id TEXT NOT NULL, app_id TEXT NOT NULL, environment TEXT NOT NULL, subject_id TEXT NOT NULL,
 flag_key TEXT NOT NULL, variant TEXT NOT NULL, exposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,subject_id,flag_key),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS river_v1_ab_conversions (
 tenant_id TEXT NOT NULL, app_id TEXT NOT NULL, environment TEXT NOT NULL, subject_id TEXT NOT NULL,
 flag_key TEXT NOT NULL, event_id UUID NOT NULL, conversion_event TEXT NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,subject_id,flag_key,event_id),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id,flag_key)
  REFERENCES river_v1_ab_assignments ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,app_id,environment,event_id)
  REFERENCES r3_v1_events ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS river_v1_ab_conversion_reporting_idx
 ON river_v1_ab_conversions(tenant_id,app_id,environment,flag_key,recorded_at DESC);
