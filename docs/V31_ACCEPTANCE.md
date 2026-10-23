# INSTANTENGINE 3.1.0 — release acceptance

| Gate | Status |
|---|---|
| Official renamed product and private package metadata | PASS (local) |
| Preserved legacy exported APIs, TMNT HMAC route, headers and SQL contract | PASS (local tests) |
| Correct UTC calendar-day churn inactivity | PASS (regression) |
| Purge can run independently and is OFF by default | PASS (unit) |
| Production cleanup requires separate approval and trusted scoped DB | PASS (unit), live DB unverified |
| Full modern / legacy Node, Python, SQL-file and local HTTP smoke tests | PASS |
| Manifest SHA-256 generated and verifiable | PASS |
| GitHub CI workflow authored | EXISTS, not executed in connected remote repo |
| Production auth, TLS, nonce-store, scoped DB IAM and backups | NOT VERIFIED |
| Live SQL consent / purge / race scenario in Neon | NOT VERIFIED |
| Real sending via providers and mobile devices | NOT VERIFIED |
| RDS algorithm full reproduction and user-level calibrated churn probabilities | NOT IMPLEMENTED / NOT VERIFIED |
| D1 / D7 / D30 proven randomized uplift with guardrails | NOT VERIFIED |

**Disposition:** maintain all production push and optional churn jobs disabled; never infer production readiness from the local green suites.
