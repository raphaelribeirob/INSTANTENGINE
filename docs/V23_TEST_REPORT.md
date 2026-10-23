# TMNT Engine v2.3 — Verificação em 20/10/2026

Scope: real-HTTP laboratory integration and the study app QA draft change, not production.

## Verified results

- Modern package tests: **199/199 PASS** (`node --test test/*.test.mjs`).
- Study app TypeScript-adapter tests: **4/4 PASS** (compiled JS from the same `tmntBridge.ts` sources, `node --test integrations/study-app/tmntBridge.test.js`).
- Legacy tests: **137/137 PASS** (`node legacy/R3ENGINE_v1.1.mjs test`).
- **Total 340/340** automated tests in the new package.
- Existing HTTP smoke tests: **21/21 PASS**, with real push disabled and no `DATABASE_URL` in this local runtime.
- Static source and SQL checks: PASS.
- Install verification: 13/13 migrations present with the expected bootstrap.
- HTTP backend-to-backend local example: HTTP 200 `result:true`; not a deployed Neon gateway.
- Study app draft change at inspected head: validate, Flutter and dependency-check succeeded; ZAP baseline skipped.
- Neon QA isolated schema from v2.2: `study_session_completed` registered and ingested once, duplicate returned false, 10 XP, timezone America/Sao_Paulo; this used the Neon SQL connector, not an application-deployed client.

## Falsification / negative tests

- Missing first-party proof rejected; signed learner and session binding prevents impersonation.
- Invalid HMAC, changed locale/timezone, stale proof and zero-attempt studies produce no event.
- Public HTTP and production-over-HTTP gateway configuration rejected by the bridge.
- Identical completed session event ID is deduplicated by the TMNT core.
- Gateway failure results `unavailable` rather than a false recorded receipt.

## Not verified

1. The first-party identity signer and session authentication in a live production deployment.
2. End-to-end durable retry queue across TMNT gateway outages and process restarts.
3. Real Neon SDK runtime driver from a deployed study app process (npm unavailable in local container).
4. Production TLS/authorization and physical push delivery via OneSignal.
5. Quantified D1/D7/D30 improvements with real users, legal/consent review and incident/load rehearsals.
6. Runtime integration of every entrypoint (MCP tool finish path is not instrumented).

**Conclusion:** QA executable; **not** 10/10 production.
