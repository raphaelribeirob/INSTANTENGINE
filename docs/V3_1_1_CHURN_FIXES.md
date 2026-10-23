# INSTANTENGINE v3.1.1 — churn daily-job correctness and production gates

**Scope:** source QA only. No migrations, new provider integrations, consent policy relaxations, or production enables in this patch.

## Fixed regressions

1. **Unfinished UTC days:** `createChurnDailyJob().run()` defaults `asOf` to yesterday UTC, computed using one sampled wall clock. Explicit `asOf` today or later is rejected before any feature read/score write. The UTC midnight boundary is covered; invalid clocks and impossible dates fail closed. This changes the previous default of the current UTC day. Any external scheduler that passes `INSTANT_CHURN_DAY` must pass a fully closed UTC date.
2. **Page counting:** `pages` counts real calls to `repository.listChurnFeatures`, including an empty final page, but never invents one at `maxPages`. `processed` counts written per-subject scores. If the final permitted page is full, `hasMore=true` means **there may be more**, not proof of another page; no probe beyond `maxPages` occurs.
3. **Safety regression coverage:** ten deterministic tests cover day default, midnight, explicit future/today, invalid clock, short/empty pages, terminal empty page, page caps, disabled default and production guard. The CI job runs these explicitly in addition to the full suite.

## Verification

Run on source: `npm run check:manifest && npm test && npm run test:stats && npm run db:verify-install && npm run smoke && npm run test:identity` and inspect the matching GitHub Actions result. These checks are offline tests, not a Neon or provider deployment.

## Production release blockers — not fixed by this patch

- **Database isolation and consent:** in an isolated Neon staging branch, test multi-tenant read/write denial, schema roles and any RLS/security-definer grants, consent grant/revocation races during batch writes, purge, backup restore and scoped deletion. Do not assume SQL `WHERE tenant_id=...` alone is sufficient if credentials permit arbitrary SQL.
- **Delivery:** configure the real authenticated gateway, durable nonce store, TLS, staging worker, PostHog outbox and OneSignal/iOS/Android device receipts; test retries, suppression, opt-out, rollbacks and kill switches. Leave `R3_PUSH_ENABLED=false` without this evidence.
- **Data validity:** train and independently calibrate optional per-app churn models on consented matured labels; otherwise reports must say `heuristic_risk_index`, never probability. Measure true D1/D7/D30 uplift via holdout, plus opt-outs and negative feedback.
- **Distribution:** `private: true` remains set; package is not published on npm. Repository visibility alone does not confer an open-source license. Choose and review a LICENSE before declaring it open source.

**Exit criterion:** no live push/churn deployment until corresponding real-world staging evidence is attached. GitHub Actions passing is necessary but insufficient.
