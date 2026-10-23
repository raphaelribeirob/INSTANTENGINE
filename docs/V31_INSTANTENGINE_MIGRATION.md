# INSTANTENGINE v3.1.0 — migration, hardening and release gates

## Scope

- **Product:** INSTANTENGINE (formerly RIVERENGINE / TMNT Engine).
- **Private Node package ID:** `@riverthree/instantengine` (not published). Existing integrations using the **old package name** `@riverthree/riverengine` must explicitly migrate the installation/import; merely updating the directory will not preserve the old package specifier. The old distribution remains available separately in its archived artifact.
- **API aliases:** new `createInstantEngine`, `createInstantEngineGateway`, `makeSignedInstantEngineRequest`, `createInstantEngagementAdapter`, and `createInstantChurnNeonRepository`. Legacy `createRiverEngine`, `createTMNT`, `createRiverEngineGateway`, `createTMNTGateway`, and old request builders remain exact function aliases.
- **Wire compatibility:** keep `POST /tmnt/v1/action`, `x-tmnt-*` headers and original HMAC signing protocol. No automatic API endpoint migration.
- **Data compatibility:** retain all `r3_v1_*`, `river_v1_*` tables, migrations `0000`–`0015`, and existing schema, env secrets, signer credential scopes. No destructive SQL or migration required for this rename.
- **No mobile/app integration changed.** In particular, InstantSpeak maintains its separately chosen FreeLingo pedagogical engine; INSTANTENGINE is not silently installed there.

## Usage

```js
import {createInstantEngine} from '@riverthree/instantengine';
import {createInstantEngineGateway, makeSignedInstantEngineRequest} from '@riverthree/instantengine/gateway';
const engine = createInstantEngine({repository}); // trusted backend only
const gateway = createInstantEngineGateway({engine,nonceStore,credentials});
```

**Do not run the same instance twice as a legacy and branded worker.** During migration, use one configured process per scoped service.

## Hardening details

1. **Inactivity risk:** `src/storage/churn-neon.mjs` compares the UTC **calendar date** of the last verified engagement event with `asOf` UTC. Late-yesterday activity now yields 1 inactive day, not 0. Test: `test/churn-gap-v31.test.mjs`.
2. **Independent retention purge:** `bin/run-churn-purge.mjs` executes `createInstantChurnNeonRepository().purgeExpired()`. It does not depend on churn prediction, and cannot send notifications. Defaults OFF. Run it on a scoped, authenticated backend scheduler **only after manual approval**, ideally with a database role that has minimal DELETE access. It deletes engagement events older than 90 days and scores older than 30 days or whose current consent was withdrawn, as codified by the existing adapter. Production requires extra acknowledgment.
3. **Manifest integrity:** `scripts/verify-manifest.mjs` checks SHA-256 of all source files, recorded sizes, no extras and version identity. `npm run check:manifest` verifies; operators must use `node scripts/verify-manifest.mjs --write` only when preparing an intended new release.
4. **Documentation:** old docs are archived for historical context. The internal master specifications are no longer shipped in this repository; `README.md` is the public entry point.

## Retention purge configuration

```sh
# safe by default — no connection or deletion
npm run worker:purge

# staging / QA, after verified backups and permission review:
INSTANT_PURGE_ENABLED=true \
INSTANT_CHURN_SCOPE=riverthree/instantstudy/staging \
DATABASE_URL='postgresql://REDACTED' npm run worker:purge
```

To execute production cleanup, `INSTANT_PURGE_ALLOW_PRODUCTION=true` is required **in addition** to `INSTANT_PURGE_ENABLED=true`, a `/prod` scope, server-side Neon credentials and reviewed SQL grants. Never store real DATABASE_URL in git.

For the existing churn scorer, the preferred environment keys are `INSTANT_CHURN_ENABLED`, `INSTANT_CHURN_SCOPE`, `INSTANT_CHURN_ALLOW_PRODUCTION`, `INSTANT_CHURN_VALIDATED_MODEL_PATH`, `INSTANT_CHURN_DAY`. Existing `RIVER_CHURN_*` keys remain fallback inputs and do not turn any feature on by default. `INSTANT_PURGE_*` is a **separate** maintenance permission, not a fallback for push delivery.

## Release gates

- [x] Functional tests of new aliases, UTC calendar days, purge opt-in / production guard.
- [x] Existing Node, legacy SDK, Python QA and migrations regressions rerun.
- [x] SHA-256 release inventory generated and verified from the packaged source.
- [ ] Live Neon staging: real consent grants/revocations, UTC time boundaries, SQL deletes, scoped user isolation and concurrent opt-out race.
- [ ] HTTP gateway / backend deployment TLS, credentials, nonce durability and observability in target environment.
- [ ] PostHog outbox delivery, OneSignal/Android/iOS push, provider callbacks and accurate notification suppression.
- [ ] Trained validated churn probability model and D1/D7/D30 randomized controlled experiments with actual users.
- [ ] Privacy, retention, RLS/IAM, backup and recovery sign-off before production.

**No automatic sends, no claims of churn uplift, and no production deploy.**
