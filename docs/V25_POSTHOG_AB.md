# RIVERENGINE v2.5 — PostHog A/B experiments (QA integration)

**Status: implemented and tested with mock PostHog SDK. Does not create or launch a remote PostHog experiment.** Default OFF, no production credentials, no live notifications.

## What this adds

- Native PostHog multivariate feature-flag evaluation via Node SDK `evaluateFlags(distinctId,{flagKeys:[flagKey]})` and `flags.getFlag(flagKey)`. Native `$feature_flag_called` exposure is triggered when `getFlag` is called at the decision surface; **not** when a user is randomly assigned ahead of time.
- Sticky assignments scoped by tenant, app, environment and opaque user ID persisted in `river_v1_ab_assignments`. Fail-closed to control when provider is down or flag invalid; do not register a control exposure on failure.
- Verified analytics opt-in/opt-out in `river_v1_analytics_consents`. Both verified persisted consent and trusted backend `analyticsConsent: true` are required.
- Verified **post-exposure** value conversions backed by `r3_v1_events` and the event registry, with duplicate rejection. Conversion capture includes the native `$feature/<flag-key>` property for PostHog attribution.
- Pseudonymous analytics distinct IDs derived from HMAC-SHA256 with `TMNT_ANALYTICS_HASH_SECRET` (same secret as existing backend telemetry). No client secrets or emails sent.
- Erasure cascades through new SQL foreign keys; external PostHog deletion still needs provider API/process.

## Backend example

```js
import { createRiverEngine, createRiverABExperiments, createPostHogNodeClient } from '@riverthree/riverengine';
import { createNeonRepository } from '@riverthree/riverengine/neon';
const repository = await createNeonRepository(process.env.DATABASE_URL);
const posthogClient = await createPostHogNodeClient({
  projectKey: process.env.RIVERENGINE_POSTHOG_PROJECT_KEY,
  host: process.env.RIVERENGINE_POSTHOG_HOST,
});
const sdk = createRiverEngine({repository});
const ab = createRiverABExperiments({repository,posthogClient,
  hashSecret:process.env.TMNT_ANALYTICS_HASH_SECRET,
  enabled:process.env.RIVERENGINE_AB_ENABLED==='true',
  allowProduction:process.env.RIVERENGINE_AB_ALLOW_PROD==='true',
});
// Authenticated backend AFTER explicit verified analytics opt-in:
await ab.setAnalyticsConsent({tenant:'river',app:'instantstudy',environment:'test',subject:verifiedOpaqueSubject,granted:true,verified:true});
// Evaluate only at the feature surface just before delivering the experience:
const decision = await ab.expose({tenant:'river',app:'instantstudy',environment:'test',subject:verifiedOpaqueSubject,
 flagKey:'daily-goal-copy',variants:['control','test'],analyticsConsent:true});
// Use decision.variant ONLY if decision.status==='assigned'; otherwise keep control and do not count an exposure.
// Later, after the backend successfully records a legitimate value event with sdk.track():
const result = await ab.conversion({tenant:'river',app:'instantstudy',environment:'test',subject:verifiedOpaqueSubject,
 flagKey:'daily-goal-copy',variants:['control','test'],eventId:verifiedEventUUID,
 conversionEvent:'study_session_completed',analyticsConsent:true});
// On shutdown: await posthogClient.shutdown(). Capture only queues an event; not proof of ingestion.
```

## PostHog dashboard setup (manual, requires account)

1. **Create experiment** using `control` and `test` variants, with a matching multivariate feature flag key, e.g. `daily-goal-copy`. Configure eligible population and rollout explicitly. For prod use an *approved* project with permission to capture analytics.
2. Set **exposure** to `$feature_flag_called` (PostHog default) with `$feature_flag= daily-goal-copy`, not to a page view or earlier assignment event.
3. Choose `riverengine_ab_conversion` as a **primary metric**, filtering `conversion_event=study_session_completed`. Configure PostHog retention D1/D7/D30 separately using repeated verified conversion events and explicit observation windows. Avoid treating simple event counts as retention.
4. Select guardrail metrics (unsubscribes, complaint rate, crashes, notification opt-out, refunds where relevant) and sample-size/duration thresholds before launching. Avoid peeking or claiming statistical lift without the required samples and holdout.
5. Start with QA users in test environment, then gradual rollout after authentication, transport, queue reliability and privacy checks.

## Security and reporting limits

- The application backend must derive `subject` and `analyticsConsent` from an authenticated identity / verified consent store; NEVER trust arbitrary client values. The AB methods are server-only and are intentionally absent from the public gateway allowlist.
- The assignment is sticky after first exposure. An experiment's configured variant list and flag semantics must remain stable; use a **new flag key** for a materially changed experiment. Avoid mixed-variant exposure across account migrations.
- SDK `evaluateFlags().getFlag()` can emit `$feature_flag_called` **before** assignment is committed to PostgreSQL. If storage is unavailable immediately afterwards, a phantom exposure is possible; audit and reconcile before declaring clean production stats.
- A conversion is committed in Neon **before** PostHog SDK capture is queued. There is **no durable telemetry retry outbox** in v2.5; a provider failure can lose conversion telemetry. `posthogQueued` only signals SDK queue acceptance, not PostHog ingestion. Do not claim production 10/10.
- Tests use a mocked PostHog client, real memory adapter and injected parametrized Neon contract. Live PostHog dashboard experiment creation, real PostHog ingestion, production backend and outcome lift have NOT been verified.

## Commands

```bash
npm test
npm run db:verify-install
npm run demo:ab
```

Sources: https://posthog.com/docs/experiments/creating-an-experiment ; https://posthog.com/docs/libraries/node ; https://posthog.com/docs/experiments/analyzing-results

## Three ready-to-configure QA experiment drafts

See [`config/posthog-ab-drafts.json`](../config/posthog-ab-drafts.json):

- **InstantStudy:** daily goal guidance → verified `study_session_completed` conversions, D1/D7/D30 guardrails.
- **InstantSpeak:** reminder copy → verified `conversation_completed`, requires separate push permission and does not enable push automatically.
- **DOTSVEST:** optional revision mission → verified `practice_completed` and D1/D7 metrics.

These are local QA templates only. They are not remote PostHog experiments and have no assigned participants or measured lift.
