-- Additive migration for GDPR/LGPD in-domain erasure.
-- Run only in a dedicated staging branch first. Does not erase OneSignal/PostHog provider data;
-- app backend must request provider erasure separately before claiming full fulfillment.
CREATE OR REPLACE FUNCTION r3_v1_delete_subject(t TEXT,a TEXT,e TEXT,s TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE changed INTEGER;
BEGIN
  DELETE FROM r3_v1_request_nonces WHERE tenant_id=t AND app_id=a AND environment=e AND subject_id=s;
  DELETE FROM r3_v1_subjects WHERE tenant_id=t AND app_id=a AND environment=e AND subject_id=s;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed=1;
END $$;
