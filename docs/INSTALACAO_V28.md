# RIVERENGINE v2.8 — instalação e arquitetura operacional

## Dependências e isolamento

**Node (dedicado):** Node >=22, PostgreSQL TCP/TLS e worker com execução contínua. Na infraestrutura de destino: `npm install graphile-worker@^0.18 pg@^8`. Não tentar rodar Graphile Worker com `@neondatabase/serverless` via HTTP; a fila exige conexão nativa `postgres://` ou `postgresql://`, conforme documentação Graphile. Usar credenciais com permissões mínimas, TLS validado e migrations automáticas do Graphile habilitadas apenas em ambiente designado. Nunca publicar connection string no browser.

**Python (treinamento offline):** `python -m venv .venv` e `.venv/bin/pip install -r python/requirements-retention.txt`. Python separado do backend HTTP. Usar apenas dados anonimizados e coortes maduras, autorizadas e randomizadas. **Neste ambiente Graphile Worker e MABWiser não estavam disponíveis para instalação via registro; os testes Node executam implementações simuladas e Statsmodels real.**

## Fluxo da fila durável

1. O backend autentica o usuário, valida/insere o evento de valor no banco e obtém o `eventId` registrado.
2. Chama `queue.enqueueVerifiedValue({tenant,app,environment,eventId})` em serviço confiável. Graphile grava somente o escopo e o UUID do evento; não armazena o identificador do usuário no job.
3. O worker consulta novamente o evento e seu estado, verifica que é de valor real e revalida **consentimento analítico e módulo habilitado**.
4. Emite `riverengine_verified_value` para PostHog com `distinct_id` HMAC e `$insert_id` determinístico. Erros HTTP geram nova tentativa via Graphile, até o limite configurado. Eventos apagados/LGPD e consentimentos revogados são ignorados.
5. Execução ocorre pelo processo `graphile.run()` em serviço dedicado; não dentro de função cron HTTP. `R3_PUSH_ENABLED=false` permanece até homologação independente do worker push.

**Limite de garantia:** a gravação do evento e o enfileiramento não são transacionais no contrato atual. Para zero lacunas após crash entre esses dois passos, criar um **outbox transacional** no mesmo banco (ou reconciliador periódico com checkpoint) antes de garantir entrega de toda telemetria. A aceitação HTTP pelo PostHog não equivale à confirmação de processamento nos dashboards. Uma tarefa pode rodar mais de uma vez; a chave `$insert_id` é estável, mas verificar a deduplicação do PostHog no projeto real.

### Exemplo de integração Node

```js
import {createRiverGraphileQueue,createRiverPostHogHTTPDelivery} from 'instantengine/graphile-worker';
// Todas as funções a seguir rodam exclusivamente em backend autenticado.
const queue=createRiverGraphileQueue({
  enabled: process.env.RIVER_GRAPHILE_ENABLED==='true',
  allowProduction:false,
  connectionString:process.env.RIVER_GRAPHILE_DATABASE_URL,
  secret:process.env.RIVER_GRAPHILE_JOB_SECRET,
  loadVerifiedEvent:({tenant,app,environment,eventId})=>trustedRepository.loadVerifiedEvent({tenant,app,environment,eventId}),
  isEligible:scope=>trustedRepository.isABEligible(scope),
  deliver:createRiverPostHogHTTPDelivery({
    projectKey:process.env.RIVER_POSTHOG_PROJECT_KEY,
    hashSecret:process.env.RIVER_ANALYTICS_HASH_SECRET,
  }),
});
// Em um produtor autorizado, após a gravação de evento de valor:
await queue.enqueueVerifiedValue({tenant:'qaorg',app:'study',environment:'test',eventId:verifiedEventId});
// Em processo worker DEDICADO e com a flag habilitada:
await queue.start();
// Na parada graciosa:
await queue.stop();
```

Não usar `trustedRepository` como import pronto: implementar adaptador realmente seguro e com consultas parametrizadas e `tenant_id/app_id/environment` em toda consulta.

## Treinamento MABWiser (off-line, opt-in)

```bash
python python/bandit_offline.py --input anon_mature_randomized.json --output policy.unsigned.json --as-of 2026-10-21T00:00:00Z
RIVER_BANDIT_SIGNING_SECRET='<secret-of-at-least-32-chars>' node scripts/sign-bandit-policy.mjs policy.unsigned.json policy.signed.json
```

`observations[]`: `arm`, `segment` (ex.: `new_morning`), `reward` (0/1, atividade de valor verificada), `propensity` registrada (0.1–1), `consented`, `matured`, `exposed`. Sem dados pessoais. A validação exige >=100 observações aleatorizadas maduras e >=25 por braço. Não usar modelo treinado com cliques como sinônimo de retenção. O artefato expira após sete dias, e operador deve assinar/configurar permissões. Aplicar somente após os bloqueios de consentimento, quiet hours, fadiga e holdout no planejador; **nenhum rollout automático**.

## Estatística com Statsmodels

```bash
python python/ab_statsmodels.py --input examples/ab_statistical_qa.json --output results.json
python -m unittest discover -s python -p 'test_*.py'
```

A entrada aceita para cada janela D1/D7/D30 `n` de usuários únicos com **coorte madura**, `successes`, alocação pré-registrada e randomização verdadeira. Intervalo Newcombe para diferença de proporções, verificação de SRM via qui-quadrado, z-test de duas proporções. O p-value é nominal, e não confiável para inspeções repetidas/múltiplas métricas sem correções adicionais. Tomar decisões apenas após desenho e revisão do experimento.

## Regras de habilitação

- `RIVER_GRAPHILE_ENABLED=false` e `banditPolicy.enabled=false` por padrão.
- Não iniciar producer/worker sem banco PostgreSQL real com TLS válido, cadastro de eventos, consentimentos e implementação de `loadVerifiedEvent` / `isABEligible`.
- Usar integração Grafana/alertas para fila, retries, DLQ, lacunas de enfileiramento e opt-outs.
- Rodar avaliação de segurança, testes de falhas e retenção D1/D7/D30 reais antes de produção.
