# RIVERENGINE 3.0 — acceptance gates, 2026-10-21

| Gate | Result | Evidence |
|---|---|---|
| Multi-app analytics, current consent, strict event whitelist | PASS SOURCE + SQL CONTRACT | Adapter, migration, local tests |
| User-supplied subject/source cannot bypass verifier | PASS UNIT | `test/churn-prediction.test.mjs` |
| No Wi-Fi, geolocation, device fingerprint, silent-state acquisition | PASS CODE REVIEW | SQL and JS explicit enums |
| Nightly scorer isolated per tenant/app/environment, idempotent | PASS UNIT | `test/churn-prediction.test.mjs` |
| Heuristic index cannot be displayed as a probability | PASS UNIT | Validated vs uncalibrated score contract |
| Probability requires calibration evidence and explicit model approval | PASS UNIT | Model validation gate; offline trainer candidate defaults unapproved |
| Production, churn batch and push delivery OFF by default | PASS SOURCE QA | v3.0 flags and runner |
| In-app notification consent reactivation user-initiated/cooldown | PASS PURE POLICY | Advisory-only planner tests; not a UI deployment |
| Grokbot sees only scoped aggregate, suppresses cells <20 | PASS UNIT | HMAC + read-only observer tests |
| Migration 0015 additive, both tables in dedicated Neon QA schema | PASS QA SCHEMA | R3ENGINE-staging branch `br-twilight-breeze-b5bnh1z1`, schema `tmnt_v22_clean_qa` |
| Core Node/legacy/bridge regression | PASS | 324 Node + 4 bridge + 137 legacy |
| Python trainer offline regression | PASS | 9 tests |
| Legacy HTTP smoke + migration chain | PASS | 21/21 smoke and 16 migration-file contract check |
| Live SQL insert, opt-out race, daily SQL job and live model | NOT VERIFIED | Requires authenticated backend + consented QA events |
| App integrations (InstantSpeak/Study/Body/Bible etc.) | NOT VERIFIED | Each app requires a trusted event adapter |
| Production load/security/IAM/backup/retention cleanup | NOT VERIFIED | Requires operations review |
| Proven D1/D7/D30 lift and ROI | NOT VERIFIED | Requires fully matured randomized controlled test |

**Disposition:** Source and QA-schema integrated. **No production enablement or automatic messages.** No claim of a calibrated next-day probability on real users.
