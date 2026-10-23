# INSTANTENGINE v3.1.0 — multi-app retention engine (QA)

**Renamed from RIVERENGINE.** Official master: [INSTANTENGINE.MD](INSTANTENGINE.MD). Historical package, API and database compatibility is documented in [v3.1 migration](docs/V31_INSTANTENGINE_MIGRATION.md).

This distribution is **not** enabled in production. No real notifications, customer data, user traffic, subscriptions or external AI models were connected in these QA tests.

Quick verification: `npm test && npm run test:stats && npm run db:verify-install && npm run check:manifest`. The optional independent cleanup worker is `npm run worker:purge` (OFF by default).

---

## Historical documentation (RIVERENGINE v3.0 and earlier)

# RIVERENGINE v3.0 — Consent-safe churn analytics (source QA)

**New:** backend-verified engagement signals, daily scoped churn risk **index**, optional externally validated probabilistic model, voluntary in-app permission explanation, no automatic push sends, read-only Grokbot cohort report, and migration `0015`.

**Install & limitations:** [`docs/V30_CHURN_PREDICTION.md`](docs/V30_CHURN_PREDICTION.md). QA: `npm run test:churn`, `npm test`, `npm run test:stats`, `npm run db:verify-install`. Code does **not** establish a live prediction service or claim a calibrated return probability without training and valid independent outcome labels.

---

# RIVERENGINE v2.9 — Grokbot Retention Observer (QA)

Inclui o ciclo **evento verificado → outbox PostgreSQL transacional → telemetria com revalidação de consentimento → agregados Neon → observação de Grokbot**. O agente tem ferramentas de leitura com assinatura HMAC, isoladas por aplicativo, e não executa mudanças. A execução real depende de backend, credenciais e agendador Grokbot configurados.

**Documentação e instalação:** [`docs/GROKBOT_OBSERVER_V29.md`](docs/GROKBOT_OBSERVER_V29.md). **Migração adicional:** `migrations/0014_verified_value_outbox.sql`. **Teste QA:** `npm run test:observer` e `npm test`. **Demo:** `npm run demo:observer`.

---

# RIVERENGINE v2.8 — Retenção adaptativa e analytics confiável (QA)

**Estado:** integrações opcionais, desligadas por padrão. Sem implantações em produção.

**Novidades:** Graphile Worker para telemetria durável (separada do push), MABWiser para treinamento offline, Statsmodels para avaliar testes A/B. Os três complementam o núcleo de retenção existente.

Leia [INSTALACAO_V28.md](docs/INSTALACAO_V28.md) e [V28_ACCEPTANCE.md](docs/V28_ACCEPTANCE.md). O servidor Node e o Python precisam de instalações independentes. Registro externo indisponível neste ambiente: Graphile/MABWiser **não** foram instalados localmente. Statsmodels instalado e executado.

# RIVERENGINE v2.7 — Contextual Smart Notifications

**Marca oficial:** RIVERENGINE (antes TMNT Engine). **Versão:** 2.8.0. **Estado:** validação de QA; **não** implantada em produção.

Sistema compartilhado de retenção e fidelização para aplicativos web, Android e iOS, executado em backend autenticado, independente de hospedagem. Suporta hábitos, missões, streaks, XP, notificações com consentimento, experimentos, iniciativas sociais e ofertas/cupões. Todos os módulos são opcionais por app.

## Documento mestre

[`RIVERENGINE.MD`](./RIVERENGINE.MD) descreve arquitetura, integrações e critérios de aceite. [`TMNT_ENGINE.MD`](./TMNT_ENGINE.MD) é somente uma referência histórica.

## Testes locais

```bash
npm test
npm run smoke
npm run check
npm run db:verify-install
npm run load:smoke
npm run demo:http
```

## Backend Node (nome oficial)

```js
import { createRiverEngine } from '@riverthree/riverengine';
import { createRiverEngineGateway, makeSignedRiverEngineRequest } from '@riverthree/riverengine/gateway';

// Somente servidor autenticado; nunca expor DATABASE_URL, HMAC, nem chaves a clientes.
const engine = createRiverEngine({ repository });
const gateway = createRiverEngineGateway({ engine, nonceStore: repository, credentials });
```

A API histórica `createTMNT`, `createTMNTGateway` e `makeSignedTMNTRequest` continua funcionando e usa exatamente o mesmo motor. Não foi publicado um pacote no npm; a importação com esse nome pressupõe instalação local ou publicação autorizada do pacote privado.

## Compatibilidade de instalações anteriores

- **Não** alterar funções/tabelas PostgreSQL com prefixo `r3_v1_`.
- **Não** trocar o endpoint existente `POST /tmnt/v1/action` nem os headers `x-tmnt-*` nesta versão: o protocolo está assinado e o adaptador InstantStudy v2.3 depende dele.
- **Não** trocar `TMNT_*` e `INSTANTSTUDY_TMNT_*` diretamente no ambiente, pois são variáveis operacionais legadas. Alias de nome de marca não equivale a migração de credenciais.
- Manter a flag do InstantStudy **desativada** até instalar uma fonte real de identidade, retry durável, TLS, testes em dispositivos físicos e experimentos com usuários.
- Alterações de documentação dos aplicativos ocorrem em branches/PRs de QA, sem merge automático.
- Histórico técnico detalhado: [`docs/LEGACY_TMNT_README.md`](./docs/LEGACY_TMNT_README.md).

## Critério de produção

Aprovação da suíte não comprova notificações em iOS/Android nem aumento causal em D1/D7/D30. A integração efetiva com aplicativo e Neon em produção ainda exige validação de segurança, telemetria e recuperação de falhas.

## PostHog A/B Experiments (v2.5+)

**New:** server-side PostHog A/B via `createRiverABExperiments`, persistent experiment variants in Neon and verified post-exposure conversion events. Feature is opt-in, backend-only and OFF by default. Requires verified consent and a configured PostHog multivariate feature flag. Existing legacy retention `holdout` contract remains unchanged. See [PostHog A/B Guide](docs/V25_POSTHOG_AB.md). Migration `0013_posthog_ab_experiments.sql` is additive. Does not constitute a launched PostHog experiment or production certification.

## Foco 2.6: Retenção no modelo Duolingo

**Prioridade:** retorno para realizar uma atividade real, qualidade de aprendizagem e progresso sustentável — não tempo de tela a qualquer custo. A camada comercial (ofertas, cupons, cashback) permanece no pacote por compatibilidade, mas fica **fora do roadmap ativo**. Os aplicativos só devem habilitar módulos relevantes.

**Problemas da auditoria corrigidos nesta versão:**

1. Telemetria genérica e worker só enviam para PostHog quando o backend confirma analytics habilitado **e** consentimento analítico persistido, verificado e concedido. \`createPostHogEmitter()\` exige um verificador \`isEligible(scope)\`. Não confundir consentimento analítico com consentimento de push.
2. Conversão A/B confere a variante persistida **antes** da inserção; memória e SQL do Neon exigem \`expectedVariant\` no próprio registro. Reenvios corretos não são perdidos devido a uma chamada com lista de variantes incorreta.
3. \`reportDuolingoRetention()\` e \`createRiverABExperiments().reportRetention()\` geram D1/D7/D30 exatos (em dias **UTC**, apenas coortes maduras), um usuário por variante, verificação de SRM, intervalos exploratórios e alertas sem declarar eficácia causal. A consulta é **administrativa e só pode existir em backend autenticado**.

**Pendente:** outbox transacional para eventos PostHog e reenvio confiável, flag kill-switch remota em todo serviço, integração de identidade/Neon/PostHog em produção e testes com dispositivos/usuários. Os testes locais não garantem entrega de push ou ganho de retenção.

Consulte [o playbook de retenção](docs/DUOLINGO_RETENTION_PLAYBOOK.md).


## Novidade v2.7: notificações realmente contextuais

O backend pode chamar `createRiverEngine({repository}).planSmartReminder()` em um agendador autenticado para **decidir se deve enfileirar ou não**, não para prometer entrega em dispositivo. O método usa consentimento verificável, holdout, quiet hours, metas concluídas, streak, histórico de atividades verificadas, limite semanal e fadiga por ausência de retorno. Um template só é elegível se seu `intent` corresponder ao contexto (`streak`, `restart`, `goal`) ou se tiver intenção `general`. Mensagens são **pré-aprovadas pelo aplicativo**; nenhum texto de notificação é gerado livremente por IA.

A escolha de horário pode ser otimizada automaticamente quando há pelo menos seis observações maduras por hora e evidência de atividades verificadas; a preferência marcada como `user` nunca é alterada. A execução agendada depende **do backend do aplicativo** — não existe um daemon autônomo ativado pelo pacote. Respostas: `queued` = reserva na fila, `do_not_send` = supressão; nenhuma significa entrega confirmada.

```js
const plan=await engine.planSmartReminder({
  tenant:'river',app:'study',environment:'test',subject:verifiedSubject,
  campaignKey:'daily_20261021',
  variants:[{id:'habit_safe',intent:'streak'},
            {id:'restart_gentle',intent:'restart'},
            {id:'neutral_tip',intent:'general'}]
});
```

**Desenvolvimento local:** `npm run demo:smart-notifications`. O worker valida novamente consentimento e regras na hora de enviar; possui proteção adicional contra 4+ notificações maduras sem atividade de valor em 14 dias. O mecanismo não contorna a desativação padrão `R3_PUSH_ENABLED=false`. Veja [`docs/V27_ACCEPTANCE.md`](docs/V27_ACCEPTANCE.md) e [`docs/V27_TEST_REPORT.md`](docs/V27_TEST_REPORT.md).

**Limitações:** notificações de dispositivo OneSignal e callbacks de entrega ainda não foram homologados; não há prova de ganho real D1/D7/D30, nem autotuning autônomo de uma base de usuários sem agendador integrado. Validação SQL direta em Neon desta revisão não foi concluída porque a ferramenta externa bloqueou a consulta; os contratos foram testados com SQL parametrizado injetado.

## QA e implantação opcional do Grokbot

- Guia para instalar o agente: [`docs/GROKBOT_ROUTINE.md`](docs/GROKBOT_ROUTINE.md).
- Arquivos de skill: [`agents/grokbot/SKILL.md`](agents/grokbot/SKILL.md), [`agents/grokbot/observer-client.mjs`](agents/grokbot/observer-client.mjs).
- API assinada: `POST /riverengine/v1/observe`, sem alterações de dados. Comandos: `catalog`, `overview`, `retention`, `experiment`, `diagnose`, `pipeline`.
- `npm run worker:value-outbox` é **seguro por padrão e encerra sem processar quando a flag está desligada**. Admite QA com credenciais somente de backend. Se o serviço PostHog não estiver ativo, as tentativas de entrega permanecem pendentes/reprocessáveis.
- Os registros de negócio devem ser verificados pelo backend de cada app usando `createRiverAppInstrumentation` (padrão OFF). Uma instalação do Grokbot não gera eventos reais automaticamente sem esses adaptadores.
