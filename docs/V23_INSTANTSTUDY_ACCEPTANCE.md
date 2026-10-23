# TMNT 2.3 QA acceptance: executable InstantStudy bridge

## Validated

- [x] Six repository contracts prepared in draft PRs, with executable hook for InstantStudy PR #61.
- [x] Authenticated first-party identity HMAC binds learner ID, session ID, timezone, locale, and short expiry.
- [x] Backend-persisted completed study session with >=1 attempt only; raw client progress cannot trigger the event.
- [x] Server-only TMNT signature; pseudonymized learner; deterministic idempotent event UUID.
- [x] HTTP integration, duplicate, spoofing, locale/timezone tampering and gateway outage tests.
- [x] QA Neon clean bootstrap/migrations from v2.2; `study_session_completed` accepted once, duplicate refused, 10 XP earned.
- [x] InstantStudy GitHub CI validate/flutter/dependency-check passed at tested QA commit.

## Not validated for production

- [ ] Provision and test a first-party identity service that signs learner claims in deployed requests.
- [ ] Deploy the central TMNT gateway with Neon-backed nonce store and proper TLS/proxy handling.
- [ ] Durable retry outbox for offline gateway and process crashes; current bridge can lose events on failure.
- [ ] Connect all completion paths, including MCP tool-based completion, not only HTTP REST finish.
- [ ] Exercise the real `@neondatabase/serverless` runtime inside the deployed app backend.
- [ ] Physical iOS/Android notifications and verified granular consent.
- [ ] Live D1/D7/D30 experiments, sustained load, security and cross-processor LGPD erasure.
- [ ] Review/merge/enable the remaining apps only after their own per-app acceptance.

Readiness: **QA executable**, not production 10/10.
