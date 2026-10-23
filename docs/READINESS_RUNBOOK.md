# INSTANTENGINE v3.1.2 — controlled staging and ML readiness

## Current verdict

Source QA may pass, but **production is blocked** until independent staging evidence exists. No notification provider, agent, churn worker, Neon migration or user traffic is automatically enabled by this release.

## What is implemented

1. The daily churn batch can resume by using nextCursor as INSTANT_CHURN_CURSOR on the next private backend run. Always keep the same tenant/app/environment and asOf UTC day across segments. nextCursor is an internal subject token and must not be shown to clients or untrusted agents. When an opt-out makes an upsert return false, the batch counts it under skipped, not processed.
2. A scored ML artifact must first pass independent temporal validation and human review. Only the operator marks approved=true. The private signing tool produces a detached HMAC signature; the real worker refuses unsigned or modified model files. Do not give the signing secret or approval privilege to applications or Grokbot.
3. A read-only staging CLI checks the existence of critical Neon tables, RLS enabled, FORCE RLS, and at least one policy per table. Catalog checks are **necessary but not sufficient** to prove tenant isolation.

## Offline verification

Run npm ci --omit=optional --ignore-scripts, npm test, npm run test:stats, npm run check:manifest, npm run check:readiness, npm run db:verify-install and npm run smoke. The GitHub Actions workflow runs these gates without Neon credentials.

## Opt-in staging catalog preflight

Set DATABASE_URL only in a trusted backend terminal or secrets manager. Set INSTANT_PREFLIGHT_SCOPE=tenant/app/staging and INSTANT_PREFLIGHT_SCHEMA to the isolated staging schema. Then run npm run readiness:staging. It never modifies the database. Exit code 1 means catalog protection gaps, code 2 means configuration/connectivity failure. No production scope is accepted.

Important: the existing R3ENGINE QA branch has been observed with RLS disabled in consent, engagement, churn score and subject tables. Do not enable production using this database until policies, application roles, function SECURITY DEFINER behavior, migration compatibility and adversarial cross-tenant reads are reviewed. Do not apply blanket RLS to an existing shared schema without a controlled migration.

## Model operator approval

Train using consented, matured, schema-whitelisted records via python/churn_train_offline.py. Review temporal leakage, calibration, cohort metrics, retention policy and deployment monitoring; never infer validation merely from synthetic training samples. After review, mark approved=true in a controlled artifact. Set INSTANT_CHURN_MODEL_SIGNING_SECRET to a backend-only 32+ character random secret, then run npm run ml:sign-churn-model -- path/to/reviewed-model.json. Set INSTANT_CHURN_MODEL_SIGNATURE to the detached signature in the backend worker environment and INSTANT_CHURN_VALIDATED_MODEL_PATH to the matching file. Any artifact edit invalidates its signature. Rotate and securely store keys; the signature proves possession of the signing key, not the truth of training labels.

## Release blockers (must have evidence, not checkboxes)

- Dedicated staging Neon database, correct privileges/RLS/policies, consent and deletion tests under race conditions, backups and recovery.
- Authenticated HTTPS gateway, durable nonce store, worker idempotency, delivery receipts, bounded retries and observability/alerting.
- OneSignal/APNs/FCM device confirmation and revocation under concurrent sends.
- Randomized holdout and mature D1/D7/D30 retained value outcomes; assess negative effects. No real ROI or churn uplift is yet proven.
- Model artifacts evaluated with real consented outcomes, operator approval, signed promotion, drift and rollback plans.
- Explicit manual production approval after all gates, with every worker still default-OFF.

Do not treat passing GitHub Actions or catalog_pass as a license to send push notifications, scrape user data or bypass opt-out.
