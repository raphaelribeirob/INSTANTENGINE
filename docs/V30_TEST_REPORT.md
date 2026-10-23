# RIVERENGINE 3.0 — Test report

Date: 2026-10-21. Base: archived RIVERENGINE v2.9 QA distribution, new additive v3.0 changes only.

| Run | Result |
|---|---|
| `npm test` — Node modern suite | 324/324 PASS |
| `npm test` — InstantStudy bridge | 4/4 PASS |
| `npm test` — legacy engine | 137/137 PASS |
| `npm run test:stats` — Python | 9/9 PASS |
| `npm run test:churn` | 19/19 PASS, included in modern tests |
| `npm run db:verify-install` | 16/16 migration files, checks PASS |
| `npm run smoke` | 21/21 HTTP smoke checks, actual external pushes OFF |
| `npm run check`, `npm run check:observer`, `npm run check:churn` | PASS |
| `npm run worker:churn` without enable flag | `{"status":"disabled","processed":0}` |
| `npm run load:smoke` | 5,000-memory synthetic inserts, 20 duplicates refused; not production benchmark |

**Neon QA:** Project `little-frost-61962118` (R3ENGINE-staging), branch `br-twilight-breeze-b5bnh1z1` (non-default QA), schema `tmnt_v22_clean_qa`: migration `0015_churn_engagement.sql` DDL/indexes executed in one transaction with schema-specific search path; catalog query independently confirmed both `river_v1_engagement_events` and `river_v1_churn_daily_scores`. No writes on the main branch. No user data was inserted or inspected for this verification.

**Not verified:** live event ingestion, realistic scoring query execution on Neon, network and background scheduler, PostHog/OneSignal consent lifecycle in apps, calibrated real model, production IAM, uplift and performance. An offline synthetic Python dataset passed structural smoke tests only. The newly added QA-schema tables are not a production deployment.

**Security:** No Wi-Fi tracking, residence inference, precise location, device fingerprint, or silent-mode inference. Read-only Grokbot operation enforces allowlist + HMAC + cohort suppression. All opt-in and send-gating policies require production integration review.
