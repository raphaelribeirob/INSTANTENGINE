# RIVERENGINE v3.0 — Churn Prediction & Intelligent Retention

**Data:** 2026-10-21. **Status:** source-level QA complete; no production rollout. **Version:** 3.0.0.

## Resumo

Adds privacy-preserving, explicit-consent engagement instrumentation and per-app daily churn scoring to RIVERENGINE v2.9. It does **not** ship covert network tracking, a deployed inference service, scheduled production jobs or automatic push campaigns.

This is an architecture for helping people achieve verified value, not maximizing compulsive screen time.

## The three modes and their truth conditions

1. **Engagement telemetry:** the app's trusted backend registers an authenticated event, with an allowlisted `kind` and optionally `source` only for app-opening signals. Data is persisted only with current **verified analytics consent**, recorded after consent, in the correct tenant/app/environment. There is no subject identifier supplied by the UI to the SDK adapter. Sources are `icon`, `push`, `widget`, `deeplink`, `unknown`; source=push is allowed only when the backend's verification callback has a trustworthy attribution token. This is best-effort attribution, not a guarantee every platform can report all sources. Events: `app_opened`, `lesson_completed`, `value_completed`, `action_failed`, `app_crashed`. Completion/failure events must be server-verified; do not invent lesson accuracy if unavailable.
2. **Daily scoring:** `createChurnDailyJob` consumes consent-filtered, scoped 45-day history from Neon and writes one idempotent score per subject/day. Without a validated model the output is `heuristic_risk_index` (0–100), **not** a next-day return probability. Signals used: days since activity, active days in last/previous 7 days, verified completions, failures, crashes, opens. No access to social graph, contacts, precise location, network SSID/BSSID, quiet/silent mode or device fingerprint. Scoring runs only on the trusted server and is OFF by default.
3. **Validated model:** an offline Python trainer uses strictly numeric, anonymized feature/outcome CSV; it splits by UTC day into training, calibration and a later independent holdout. It emits an **unapproved** model artifact with AUC, Brier, baseline and calibration error. A trusted human must review leakage, label quality, drift, bias, consent, and benchmark results before setting `approved=true` in controlled backend deployment. With an approved, validated artifact only, `scoreChurnRisk` may return actual estimated `returnProbabilityTomorrow` and `churnProbabilityTomorrow`, subject to uncertainty and monitoring. Merely editing `approved` does not independently prove validity.

## Source tree

- `src/churn-prediction.mjs`: pure scoring, consent-safe advisory intervention planner, trusted event adapter and daily batch.
- `src/storage/churn-neon.mjs`: opt-in-only, tenant-scoped event ingestion, daily feature query, daily upserts and data pruning.
- `migrations/0015_churn_engagement.sql`: strict event schema, score table, FK/cascade, constraints and indexes.
- `python/churn_train_offline.py`: temporal calibration training, model export, no personal identifiers in input.
- `bin/run-churn.mjs`: operator-only batch command, disabled by default.
- `src/integrations/grokbot-observer.mjs`: new `churn` read-only aggregate report, individually suppressed cells under 20.
- `agents/grokbot/observer-client.mjs`: `churn` allowed only if explicitly allowlisted in HMAC credentials.
- `src/smart-notifications.mjs`, `src/policy.mjs`, `src/integrations/posthog-ab.mjs`: preexisting fatigue, consent, quiet-hour, holdout and A/B safety requirements, preserved unchanged.

## Installation (backend only)

1. Install Node.js 22+ and existing `@riverthree/riverengine` private local source; it is **not** published to npm.
2. On a dedicated authorized Neon QA database, apply `migrations/0000` through `0015` **in order**. Do not run migrations directly against a production branch; staging success is not production approval. Never expose the SQL connection or HMAC secrets to the client.
3. In each app backend, implement `verifyEngagementEvent({tenant,app,environment,eventId,kind})` that verifies an actual session/completion/crash event and returns `verified`, `eventId`, `kind`, `subject`, `source` and `occurredAt`. The caller may supply only eventId and kind; the callback controls the subject and source. Require analytics consent separately. Avoid double counting value completions recorded by other adapters.
4. Only after consent infrastructure and authorization are tested, set `enabled:true` on the trusted adapter and `RIVER_CHURN_ENABLED=true` for a QA environment. Production requires the additional explicit flag `RIVER_CHURN_ALLOW_PRODUCTION=true` plus operator approval.
5. Run the daily job after the selected UTC date is complete; a scheduler is not bundled. Configure `RIVER_CHURN_SCOPE=tenant/app/test` (or explicitly authorized environment). Choose the last fully closed UTC day for stable results, and verify reruns are idempotent.
6. Optionally train a model offline using **matured** verified next-day value labels (0/1), consented at the time of collection. If privacy-guarded feature exports are not available, keep heuristic mode. No model is bundled or marked approved.
7. Grant an independent, read-only Grokbot credential the `churn` operation to view a cohort distribution (no user-level risk scores); do not give the agent SQL access, target lists or campaign-writing privileges.
8. Run `npm test`, `npm run test:stats`, `npm run db:verify-install`, `npm run check`, `npm run smoke`, `npm run load:smoke`, `npm run check:churn` before planning any rollout. Live Neon/PostHog/OneSignal checks require separately authorized QA credentials.

### Local example (does not create records or send anything)

```js
import {scoreChurnRisk,planConsentSafeRetention} from '@riverthree/riverengine/churn-prediction';
const risk=scoreChurnRisk({features:{
  daysSinceOpen:4,activeDays7:1,activeDaysPrev7:4,
  completed7:0,failed7:1,crashes7:0,opens7:1
}});
const suggestion=planConsentSafeRetention({score:risk,context:{
  analyticsConsent:true,notificationsEnabled:true,notificationConsent:true,
  experimentArm:'treatment'
}});
// risk.kind is heuristic_risk_index (not a probability).
// suggestion is advisory only, never a provider send.
```

```bash
# Preview disabled behavior, independent of database credentials:
npm run worker:churn
# Offline model candidate (requires matured, consented aggregate-label dataset):
python python/churn_train_offline.py ./consented_matured_churn.csv 2026-q4-candidate ./model-candidate.json
```

## Re-engagement and push policy

- Fix crashes and other product failures before blaming users or increasing reminder frequency.
- Any churn-based decision is **advisory**. The existing smart notification policy evaluates current verified push consent, exact experimental assignment/holdout, verified outcome fatigue, quiet hours, rate limits, deduplication, provider controls, and user-selected reminder time.
- To discuss re-enabling notifications, use only a user-initiated, dismissible **in-app** surface, no more than once every 30 days and never after a dismissal/negative user preference. Select a truthful benefit already verified in app (`friend_quest`, `streak`, `ranking`, `daily_goal`, otherwise `reminder`). No permission dialog spam; users must remain able to use the app without opting in.
- Do not manipulate health, financial, religious, educational or other vulnerable contexts with anxiety-provoking pressure. Optimize verified user value and long-term trust, not raw sessions.
- The engine never attempts Wi-Fi fingerprinting, residence detection or silent-mode inference. Such mobile APIs are restricted and unnecessary.

## A/B, metrics and model QA

Primary metric: 7-day return to a **verified value event**, measured only on exposed, consented, mature cohorts; secondary D1/D30, task completion, opt-outs, uninstall proxies if explicitly observable, crash rate, negative feedback. Persistent randomized holdout >= 10% is recommended subject to power analysis; use existing PostHog A/B path. Monitor sample-ratio mismatch and statistically appropriate power and CIs. Do not treat observational open/click rates or raw churn correlations as causal uplift. Log experiment exposures only when an intervention could be experienced. The Grokbot remains an observer/proposer.

For an actual calibrated risk model, require meaningful outcome labels, temporal holdout, reasonable performance relative to a prevalence baseline, cohort-level drift inspection, and model signoff. AUC ≥ 0.60, Brier ≤ baseline and calibration error ≤ 0.10 are minimum machine-enforced validation gates, **not proof of commercial quality**. Performance can degrade quickly across languages, products and segments; models are versioned by app and reviewed before any promotion.

## Data governance and safety

- Every SQL read or write requires tenant/app/environment scope and verified current analytics consent; the insert requires consent granted before the event. **No backfill from pre-consent data**.
- Raw engagement events expire after 90 days and daily scores after 30 days via `purgeExpired`. Revoked-consent rows are deleted when this operator job runs; existing subject deletion cascades. Operator must separately satisfy revocation/deletion across PostHog, OneSignal, backups and any app-specific stores where relevant.
- Production roles need least privilege, TLS, backups, an independently audited consent trail, audit logs without personal payload, and row-level/tenant isolation verification. The source QA does not prove these deployment controls.
- The observer's `churn` report returns only masked cohort counts; any cell containing fewer than 20 currently consented people is `null`, not zero. It never exposes a user's label, predicted probability or name.
- All new switches default OFF. Adding code is **not** equivalent to running a nightly production job, delivering messages, evaluating a real dataset or increasing retention.

## Acceptance gates and limitations

- PASS locally: pure model safety, trusted attribution interface, cross-scope pagination, no automatic sends, model refusal without validation, migration-chain check, observer HMAC guard, read-only cohort masking, regressions.
- QA-SCHEMA VERIFIED: additive migration `0015` applied to R3ENGINE-staging Neon branch `<redacted>`, isolated schema `tmnt_v22_clean_qa`; both new tables independently confirmed via catalog query. UNVERIFIED: real row ingestion/consent race behavior and performance and security on real tenant data, real frontend event adapters across products, real opt-in telemetry, trained/calibrated model on historical labeled cohorts, notifications through a provider, A/B lift and scheduled executor.
- If any gate above is not proven, stay in QA and do not claim a next-day probability or 10/10 proven retention quality.
