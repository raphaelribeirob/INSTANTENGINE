# RIVERENGINE 2.9 — Dados reais + Agente observador Grokbot

## Contrato

1. Os aplicativos enviam **eventos de valor reais** por backend autenticado, usando `createRiverAppInstrumentation()` e `createRiverEngine.track`. O adaptador exige um `verifyBusinessEvent()` que consulte a atividade concluída e sua identidade no banco do próprio aplicativo, não em parâmetros de cliente. Evento de abertura não é evidência de aula/atividade concluída. O backend deriva `subject` de identidade verificada, usa UUID estável para retries, catálogo de eventos aprovado e hora/fuso reais.
2. A migração `0014_verified_value_outbox.sql` cria uma pendência de telemetria no **mesmo commit** de cada evento de valor. Não envia push nem dados para terceiros no trigger. Eventos históricos não são reenviados automaticamente. O consentimento verificado deve existir **antes da transação da atividade**; em caso de empate de timestamps dentro da mesma transação, o evento é excluído por precaução.
3. Um worker autorizado (executável: `npm run worker:value-outbox`), com `createRiverValueOutboxNeonRepository` + `createRiverValueOutboxPump`, recupera eventos por UUID, **revalida consentimento analítico e o app**, emite para PostHog, aguarda ACK HTTP e marca conclusão. Falhas usam novas tentativas com lease; eventos são pelo menos uma vez e exigem `$insert_id` idempotente. Worker fica OFF por padrão e só reivindica jobs de produção mediante habilitação/aprovação explícita; sem dependência do Graphile Worker para este fallback.
4. Um **Grokbot Retention Observer** consulta apenas métricas **agregadas** via `POST /riverengine/v1/observe`: `catalog`, `overview`, `retention`, `experiment`, `diagnose`, `pipeline`. Assinatura HMAC SHA-256, timestamp ±5min, UUID nonce persistente, escopo fixo tenant/app/environment, operações permitidas por credencial. Produção exige URL canônica HTTPS e replay store PostgreSQL.
5. Grokbot só lê, interpreta e propõe ações. Não altera flags, campanhas, horários, consentimentos ou mensagens; alterações comerciais/impactantes dependem de aprovação humana e execução pelo backend correto.

## Exemplo do backend Node

```js
import {createRiverObserverNeonRepository} from '@riverthree/riverengine/observer-neon';
import {createNeonRepository} from '@riverthree/riverengine/neon';
import {createGrokbotObserver} from '@riverthree/riverengine/grokbot-observer';
const observer=createGrokbotObserver({
 repository:await createRiverObserverNeonRepository(process.env.DATABASE_URL),
 nonceStore:await createNeonRepository(process.env.DATABASE_URL),
 credentials:{'riverthree/instantstudy/test':{
  secret:process.env.RIVER_OBSERVER_SIGNING_SECRET,
  operations:['catalog','overview','retention','experiment','diagnose','pipeline'],
  experiments:['daily_goals_v1'],
 }}
});
// In your authenticated server adapter: await observer.handle(request)
```

## Grokbot (OpenClaw-style skill)

In the trusted runtime of the agent, deploy `agents/grokbot/SKILL.md` and the CLI tool `observer-client.mjs`. Configure `RIVER_OBSERVER_BASE_URL`, `RIVER_OBSERVER_SCOPE` and `RIVER_OBSERVER_SIGNING_SECRET` in the backend/secrets manager, not in prompts. Grokbot may call the read-only CLI; the model only receives its aggregated JSON output. Operations do **not** require database access in the Grokbot process.

Run from a trusted shell:

```bash
node agents/grokbot/observer-client.mjs catalog
node agents/grokbot/observer-client.mjs overview 14
node agents/grokbot/observer-client.mjs retention
node agents/grokbot/observer-client.mjs pipeline
node agents/grokbot/observer-client.mjs diagnose
node agents/grokbot/observer-client.mjs experiment daily_goals_v1
```

### Interpreting reports

- `pipeline` uses coarse status buckets to avoid exposing small activity counts; dead-letter alerts require operator attention.
- `null` metrics mean **privacy suppression/insufficient sample**, not zero; minimum 20 consented users per exposed daily cell/cohort/variant.
- D1/D7/D30: return exactly at day offset after **first verified-value day** (UTC), using mature cohorts only. Not the same as push holdout causality, not a total active-user denominator.
- Diagnoses are deterministic alerts, never proof of why behavior changed.
- Experiment conversions are only confirmed RIVERENGINE value events; sample ratio, statistical power and guardrail checks are still needed before claiming impact.
- LGPD erasure cascades to value outbox through foreign keys; read APIs respect current analytics consent. Avoid providing user-level data to LLMs.

## Acceptance / known production gaps

**Testable now:** scoped HMAC, replay refusal, least-privilege read API, SQL parametrization, cohort suppression, transactional outbox creation, retry contracts and local HTTP end-to-end.

**Requires real deployment to finish:** application event adapters for each product, PostgreSQL migration in isolated/staging before prod, worker supervisor/health metrics and dead-letter alerting, Grokbot runtime installation with secrets, PostHog credentials and dashboards, real-user cohorts, RLS/database-role restriction, and security/load/consent review. The CLI does not schedule itself; Grokbot routine scheduler must be configured by an operator. Do not claim automatic 24/7 operation without that deployment.
