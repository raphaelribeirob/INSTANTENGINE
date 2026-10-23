-- RIVERENGINE v3.0: minimal analytics-consented event origin and daily churn risk snapshots.
-- No IP addresses, Wi-Fi/SSID/BSSID, geolocation, device fingerprint, silent-mode metadata, or message bodies.
-- Historical analytics is never backfilled; explicit consent must predate both occurred_at and recorded_at.
CREATE TABLE IF NOT EXISTS river_v1_engagement_events (
 tenant_id text NOT NULL,app_id text NOT NULL,environment text NOT NULL,
 event_id uuid NOT NULL,subject_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('app_opened','lesson_completed','value_completed','action_failed','app_crashed')),
 source text NOT NULL DEFAULT 'unknown' CHECK(source IN ('icon','push','widget','deeplink','unknown')),
 occurred_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,event_id),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE,
 CHECK(kind='app_opened' OR source='unknown')
);
CREATE INDEX IF NOT EXISTS river_v1_engagement_subject_day
 ON river_v1_engagement_events(tenant_id,app_id,environment,subject_id,occurred_at DESC);
CREATE TABLE IF NOT EXISTS river_v1_churn_daily_scores (
 tenant_id text NOT NULL,app_id text NOT NULL,environment text NOT NULL,
 subject_id text NOT NULL,score_day date NOT NULL,
 model_version text NOT NULL,risk_tier text NOT NULL CHECK(risk_tier IN ('low','medium','high')),
 risk_index integer CHECK(risk_index BETWEEN 0 AND 100),
 probability_return numeric(5,4) CHECK(probability_return BETWEEN 0 AND 1),
 reason_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
 scored_at timestamptz NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,subject_id,score_day),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE,
 CHECK((risk_index IS NULL) <> (probability_return IS NULL))
);
CREATE INDEX IF NOT EXISTS river_v1_churn_score_report
 ON river_v1_churn_daily_scores(tenant_id,app_id,environment,score_day,risk_tier);
-- The trusted backend-only insert uses current verified analytics consent AND consent timestamp preceding event.
-- Operator must restrict INSERT/SELECT grants. Revoke on consent is enforced in all reads and scoring writes.
-- No trigger sends notifications or writes experiment assignments.
