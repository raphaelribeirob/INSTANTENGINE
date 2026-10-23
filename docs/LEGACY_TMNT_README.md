# TMNT Engine v2.1 — correções de segurança, estatística, social e streak offline

**Versão 2.1 (20/10/2026).** Camada universal independente de hospedagem; inclui todos os recursos da v2.0.

**Novidades verificadas:** (1) gateway receptor `prod` rejeita requisições `http:` e ignora cabeçalhos `X-Forwarded-Proto` não confiáveis; (2) avaliação de experimentos usa intervalo Newcombe/Wilson de 95% em vez de Wald; (3) convites limitados por vínculos ativos/pendentes e por 24h, no adaptador de memória e no PostgreSQL; (4) replay idempotente de streak e XP a partir dos eventos comprovados do backend, após sincronização offline.

**Migrações novas:** `migrations/0011_social_antiabuse.sql` e `migrations/0012_habit_reconciliation.sql`, após as da v2.0, primeiro em homologação. **Sem ativação automática de push/cobranças.**

**Exemplos de política social:** no cadastro de um app, `modules: { social: true, socialMaxFriends: 5, socialDailyInvites: 5 }`; ambas as cotas são configuráveis entre 1 e 50. A cota diária é uma janela móvel de 24 horas, não reinicia após remover amizade.

**TLS em proxies:** o receptor valida `request.url.protocol` em produção, não confia em cabeçalhos encaminhados pelo cliente. O adaptador HTTP que roda atrás de proxy reverso deve receber a URL canônica HTTPS somente depois de validar o proxy/terminação TLS em sua própria fronteira de confiança. Um gateway isolado **não consegue atestar o transporte de rede** ao receber apenas um objeto Request.

**Offline:** após ingestão de eventos de valor autenticados, um backend autorizado pode executar `sdk.reconcileHabit` para recomputar progressão. Leia `docs/STREAK_RECOVERY.md`; essa operação é restrita e não recupera eventos nunca registrados.

Consulte `docs/V21_ACCEPTANCE.md` e `docs/V21_TEST_REPORT.md` para status verificados e pendências de produção.

---

# TMNT Engine v2.0 — Retenção universal (codinome interno)

**Status:** homologação técnica; **não** aprovada para envio comercial ou alegação de incremento causal de retenção. Nenhuma dependência de Vercel. A marca TMNT é apenas um nome interno, sem uso de personagens ou sinais distintivos da franquia.

Esta versão agrega, de forma **opt-in por app**, os módulos `missions`, `friendStreaks` e `leagues` aos mecanismos de hábitos, ofertas, consentimento, notificações e feedback preexistentes. Os módulos anteriores permanecem compatíveis.

## Instalação e testes (Node.js 22+)

```bash
npm test                   # 175 testes modernos + 137 legados = 312/312
npm run smoke             # 21 verificações HTTP legadas; push real desligado
npm run check             # contratos e sintaxe estática
npm run load:smoke        # 5.000 eventos sintéticos em memória
npm run demo:next         # hábitos + missões + Friend Streak + liga + experimentos
npm run demo:duolingo-ifood
```

## Integração PostgreSQL

1. Em backend confiável, instalar `@neondatabase/serverless` e configurar `DATABASE_URL` apenas no servidor. O runtime de testes desta entrega não conseguiu instalar esse driver; os SQLs foram validados separadamente via conexão segura ao Neon QA.
2. Sobre o banco universal migrado até `0008`, aplicar **em ordem** `migrations/0009_duolingo_adaptive_quests.sql` e `migrations/0010_optional_leagues.sql` **primeiro em uma ramificação de homologação**. Ambos são aditivos; produção não foi modificada.
3. Executar testes end-to-end autenticados com os apps, com tenant/app/environment vinculados ao backend e `subject` derivado de sessão/autorização real.
4. Habilitar os módulos apenas onde apropriados: `missions`, `social`, `friendStreaks`, `leagues`, `habits`, `notifications` são `false` quando omitidos no cadastro.
5. Manter `R3_PUSH_ENABLED=false` até dispositivos, tokens, LGPD, cancelamento de consentimento e delivery webhooks estarem testados.

## Novas APIs do SDK

```js
const scope={tenant:'example',app:'school',environment:'test'};
// Somente backend autenticado com permissão de administrador:
await tmnt.defineDailyMission({...scope,missionKey:'learn_twice',event:'lesson_completed',target:2,rewardXp:15});
// Somente backend autenticado pelo usuário:
await tmnt.dailyMissions({...scope,subject:'opaque_user'});
await tmnt.claimDailyMission({...scope,subject:'opaque_user',missionKey:'learn_twice'});
await tmnt.friendStreak({...scope,subject:'opaque_user',friend:'accepted_friend'});
await tmnt.joinLeague({...scope,subject:'opaque_user'});
await tmnt.weeklyLeaderboard({...scope,subject:'opaque_user',limit:20});
await tmnt.leaveLeague({...scope,subject:'opaque_user'});
await tmnt.recommendReminderHour({...scope,subject:'opaque_user',apply:false});
```

`recommendReminderHour(apply:true)` só grava uma sugestão aprendida quando há amostras maduras e consentimento de push verificado, sem sobrescrever `reminder_hour` configurado explicitamente pelo usuário. Dados são observacionais e **não** garantem a melhor hora causalmente. A fila/worker existentes usam `reminder_hour` do usuário ao verificar elegibilidade.

Recompensas de XP exigem `modules.habits=true`; aplicativos sem hábitos podem configurar missões com `rewardXp=0`, sem prometer pontos não creditáveis.

Os Friend Streaks usam **UTC como calendário compartilhado**, para que os dois participantes tenham uma definição consistente do mesmo dia. A amizade exige aceite bilateral; eventos anteriores ao aceite nunca contam. A liga usa semana UTC (segunda-feira a domingo), pontua eventos válidos até 10 por dia por usuário e oferece pseudônimos efêmeros por posição em vez de nomes públicos. Sem aceite voluntário, nenhuma pontuação fica pública.

A análise `assessExperiment` não faz afirmação causal. Sinais estatísticos só são reportados com amostra mínima por grupo; incluem alerta de *sample ratio mismatch*. Intervalos são exploratórios 95% e devem acompanhar verificação da randomização, desenho do experimento, métricas de guarda e testes A/A antes de decisões comerciais.

## Contratos de segurança

- Para chamadas HTTP, a ação `defineDailyMission` exige permissão **administrativa explícita**. `dailyMissions`, `claimDailyMission`, `friendStreak`, `joinLeague`, `leaveLeague`, `weeklyLeaderboard` e `recommendReminderHour` podem ser habilitadas por backend assinado; autenticar e autorizar usuários **antes** de assiná-las.
- IDs dos outros participantes das ligas não são retornados na API da engine. Não usar nomes pessoais como `subject`.
- O módulo não processa checkout nem envia push real na demonstração. Aceitação do provedor de push não significa entrega no aparelho.
- Antes de produção: testar conexão Node→Neon com driver real, recuperação de fila, consentimento e erasure fora do banco, OneSignal/APNs/FCM em dispositivos, privacidade/abuso social, limites de recursos, e experimentos D1/D7/D30 com usuários.

**Evidências:** `docs/V20_ACCEPTANCE.md`, `docs/V20_TEST_REPORT.md` e os testes `test/duolingo-v20.test.mjs`.

---

# TMNT Engine v1.9 — Homologação dos hábitos Duolingo (nome interno)

A v1.9 corrige as duas falhas P0 identificadas na auditoria da v1.8 e reforça a paridade do estado de hábito entre memória e PostgreSQL. A arquitetura permanece independente de hospedagem; APIs, segredos e tabelas são compatíveis com a v1.8. **Nenhuma migração SQL adicional é necessária para essas correções**.

## Correções confirmadas

- Streak calculado pela **data civil do usuário em seu fuso IANA**; eventos no mesmo dia local não aumentam a sequência mesmo atravessando 00h UTC ou uma transição de horário de verão.
- Meta `dailyGoal` preservada após novos eventos; mudar a meta atualiza `goalMet` imediatamente sem recontar eventos.
- O SDK Neon normaliza `DATE` como `YYYY-MM-DD`, `BIGINT` de XP como número seguro e expõe `goalMet` calculado de forma compatível com a memória.
- Casos de eventos duplicados, antigos ou fora de ordem incluídos na regressão padrão.
- Nome TMNT usado somente internamente; não envolve interface, marcas ou personagens da franquia TMNT.

## Verificação desta versão

```bash
npm test                    # 151 testes modernos + 137 legados = 288/288
npm run smoke              # 21/21 HTTP legado, sem push real
npm run check              # análise estática
node --test test/habits-timezone-regression.test.mjs  # 15 cenários focados
npm run demo:http          # comunicação real HTTP local, sem provedor
npm run load:smoke         # 5.000 eventos sintéticos em memória
```

No Neon PostgreSQL de **homologação**, três casos independentes (São Paulo, Tóquio e Nova York com fim do horário de verão) geraram os mesmos valores esperados: streak=1, today_count=2, daily_goal=3, XP=20. Não houve implantação de produção nem notificações reais.

**Limites:** não há paridade integral com o produto Duolingo. Permanecem pendentes algoritmo de horário ótimo validado, missões diárias e Friend Streaks completos, ligas opcionais, testes físicos de push e experimentos com retenção incremental. A v1.9 é **correção de confiabilidade da camada de hábitos**, não certificação 10/10 de produção.

Consulte `docs/V19_ACCEPTANCE.md` e `docs/V19_TEST_REPORT.md`.

---

# TMNT Engine v1.8 — API universal de backends (codinome interno)

## Entregas desta versão

O núcleo v1.7 (Duolingo + iFood) permanece intacto. A v1.8 adiciona
`src/integrations/http-gateway.mjs` com **uma entrada HTTP assinada** para
backends iOS/Android/Web/Node de qualquer app, sem dependência de hospedagem:

- `createTMNTGateway`: valida assinatura HMAC SHA-256 do **corpo exato**, escopo tenant/app/ambiente, ID do usuário autenticado pelo backend integrador, timestamp (±5 min), UUID de requisição, papel e operação autorizada.
- `makeSignedTMNTRequest`: constrói e assina a chamada pelo **backend do app**, jamais pela interface ou dispositivo do usuário.
- Replay é bloqueado por `r3_v1_claim_request` (PostgreSQL), via `createNeonRepository().claimRequest`. Um segundo uso do mesmo nonce falha, inclusive em concorrência.
- Em escopos `prod`, a inicialização rejeita adaptadores de nonce declarados não persistentes; o assinador exige HTTPS.
- Operações financeiras sensíveis (`settleRedemption`) e exclusão de dados (`eraseSubject`) **não** estão na lista padrão de operações autorizadas. Realize liquidação somente pelo backoffice que verificou o checkout financeiro.
- Limite de 64 KiB por requisição, respostas sem stack traces e contrato `POST /tmnt/v1/action`.

### Teste rápido (sem rede externa)

```bash
node --version                 # Node >= 22
npm test                       # 136 modernas + 137 legadas = 273/273
npm run check
npm run smoke                  # 21/21 HTTP legados; sem banco externo
npm run demo:http              # HTTP real local, assinado, sem provedor
npm run demo:duolingo-ifood
npm run load:smoke             # 5 mil eventos SINTÉTICOS; NÃO é benchmark Neon
```

### Integrar a um backend seguro

```js
import {createTMNT} from './src/index.mjs';
import {createNeonRepository} from './src/storage/neon.mjs';
import {createTMNTGateway,makeSignedTMNTRequest} from './src/integrations/http-gateway.mjs';

// Serviço TMNT: banco e segredo exclusivos do backend.
const repo=await createNeonRepository(process.env.DATABASE_URL);
const engine=createTMNT({repository:repo});
const gateway=createTMNTGateway({engine,nonceStore:repo,credentials:{
  'company/instantstudy/test': {
    secret:process.env.TMNT_STUDY_HMAC_SECRET, // >= 32 caracteres aleatórios
    actions:['track','setConsent','expose','recommend','recordOutcome','getHabit']
  }
}});
// Adapte `gateway(Request)` à infraestrutura HTTP utilizada (Express,
// Fastify, Node nativo, contêiner etc). NUNCA publique a chave no cliente.
// O backend do InstantStudy autentica primeiro o usuário, depois assina:
const req=makeSignedTMNTRequest({
  baseUrl:'https://tmnt.example.internal',scope:'company/instantstudy/test',
  subject:'opaque-authenticated-user',secret:process.env.TMNT_STUDY_HMAC_SECRET,
  operation:'track',params:{eventId:'d9448014-810a-48e4-a965-21157d8a66fb',event:'flashcard_reviewed'}
});
```

A lista de operações deve ser a mínima necessária para cada app. `subject`
precisa corresponder à sessão **já verificada pelo backend integrador**; a
TMNT Engine não é um serviço de login. `nonceStore.nonceDurability='persistent'`
é um contrato do adaptador e não substitui revisão e provas de durabilidade
em homologação. Provisione TLS real, segredos rotacionáveis, ACL e limites
operacionais antes de publicar.

### Conformidade e escopo real dos testes

- **273/273 testes**, 21/21 smoke HTTP, 98,58% de linhas e 90,34% de ramificações (suíte moderna); exemplo com HTTP local aprovado.
- O banco Neon foi validado em rodadas anteriores e o contrato SQL da v1.8 está coberto por testes injetados; **a nova ligação SDK ↔ banco não foi exercitada** por falta do driver na máquina atual. Tentativa de `npm view @neondatabase/serverless` falhou com `EAI_AGAIN`.
- Nenhum app externo, checkout real, dispositivo físico, OneSignal ou PostHog de produção foi conectado nesta versão. Nenhum segredo real foi utilizado.
- A API HTTP deve ficar atrás de rede segura, autenticação prévia e rate limiting do ambiente hospedeiro. A implementação não fornece rate limiting distribuído nem gerenciamento/rotação de segredos.
- Não declarar 10/10 de produção até concluir validação de payload no backend real, replay sob concorrência Neon, integrações e experimentos com usuários.

---

# TMNT Engine v1.7 — codinome interno

Engine de retenção **privada, multiapp e independente de hospedagem**. Node.js 22+. O nome TMNT é apenas interno. Os contratos legados da R3ENGINE v1.1 permanecem incluídos; nenhuma troca de nomes de tabelas, chaves ou endpoints antigos foi feita.


## v1.7 — duas camadas complementares (Duolingo + iFood)

A engine permanece **independente de hospedagem**; nome TMNT é exclusivamente interno. Os novos recursos são opcionais (`modules.offers` e `modules.feedback`) e não impõem marketing, vendas ou gamificação em todos os apps.

**Hábitos (Duolingo):** mantém os módulos existentes de streak, meta diária, XP, proteção, missões cooperativas, escolha de mensagens e coortes D1/D7/D30. **Comércio (iFood):** adiciona catálogo de oferta com preço/validade, redemptions idempotentes e com limite de estoque, economia de checkout confirmada, pesquisa 0–10 após evento de valor, pedidos de avaliação nativa sem separação por nota e taxa de recompra D30/D60/D90.

### Instalar e testar

```bash
node --version             # >=22
npm test                   # regressão moderna + legado
npm run smoke              # HTTP local; push desligado
npm run check              # checagens estáticas
npm run demo:duolingo-ifood
npm run demo:multiapp
npm run load:smoke          # 5.000 eventos SINTÉTICOS em memória
```

Aplique `migrations/0007_commerce_feedback.sql` e depois `migrations/0008_repurchase_reporting.sql` **somente depois das migrations 0001–0006**, inicialmente numa ramificação de homologação do PostgreSQL. O SQL da v1.7 foi testado na ramificação isolada do Neon. Instale `@neondatabase/serverless` no backend final quando houver conectividade com o registry; **não está instalado neste ambiente**. O teste injetado de adaptador não substitui executar o driver real.

### APIs novas do SDK

```js
import {createTMNT,analyzeRepurchase} from './src/index.mjs';
const engine=createTMNT({repository:repo});
const scope={tenant:'empresa',app:'loja',environment:'test'};
// O backend da loja atesta preço/estoque a partir de seu catálogo/checkout.
await engine.publishOffer({...scope,offerId:'boasvindas',conversionEvent:'purchase_completed',
 currency:'BRL',listPriceMinor:10000,discountMinor:1000,
 startsAt:'2026-10-20T00:00:00Z',endsAt:'2026-10-25T00:00:00Z',
 maxRedemptions:100,verificationRef:'checkout-snapshot-123'});
// Eventos de compra devem ser registrados APENAS pelo backend com pagamento validado.
const offers=await engine.listOffers({...scope,subject:'opaque-user'}); // busca explícita
const personalized=await engine.listOffers({...scope,subject:'opaque-user',personalized:true});
// personalized requer consentimento verificado in_app/marketing; não envia push.
const redeem=await engine.redeemOffer({...scope,subject:'opaque-user',offerId:'boasvindas',eventId:'uuid-de-evento-ja-validado'});
// settle SOMENTE depois do webhook verificado do processador/checkout.
if(redeem) await engine.settleRedemption({...scope,subject:'opaque-user',redemptionId:redeem.redemptionId,checkoutRef:'recibo-verificado',appliedDiscountMinor:900});
const savings=await engine.getSavings({...scope,subject:'opaque-user'});
// feedback vale de 0 a 10 sem condicionar elegibilidade a avaliação pública.
await engine.recordFeedback({...scope,subject:'opaque-user',eventId:'uuid-de-evento-ja-validado',score:0,reason:'price'});
// Somente em momento ocioso, após sessão concluída, na interface nativa:
await engine.claimReviewPrompt({...scope,subject:'opaque-user',platform:'ios',sessionCompleted:true,inForeground:true,taskIdle:true});
```

`eventId` acima é ilustrativo; **use um UUID real** retornado pelo seu backend. Nunca passe IDs arbitrários ou comprovantes inventados da interface pública para o SDK. O SDK não calcula o pagamento, não cobra cartões, não aplica descontos no gateway e não verifica autonomamente recibos. `verificationRef` e `checkoutRef` são atestados pelo backend integrador; não constituem prova independente de verificação pelo provedor.

**Controles importantes:** catálogo exclusivo do servidor; dinheiro em centavos inteiros; preço e prazo reais; uma redenção por usuário/oferta e por evento de compra; estoque reservado atomicamente; economia realizada somente após confirmação de checkout; consentimento de marketing independente de navegação explícita; feedback negativo não bloqueia o pedido de avaliação; limitação de prompts (90 dias, máximo 2 por 365 dias, conta com 7 dias e 5 eventos de valor). Apple/Google decidem se o prompt aparecerá. Não reutilize `checkoutRef` entre compras; use IDs opacos, sem PII.

**Sem paridade total ainda:** campanhas promocionais PUSH e mensagens transacionais específicas precisam de filas/consentimentos próprios, a personalização de horário continua parcial, jornada comercial/rankings sofisticados não estão prontos, SDK Neon real não executou neste ambiente, OneSignal em aparelhos e PostHog real estão pendentes, e não há prova causal D1/D7/D30 ou recompra. Consulte `docs/ACCEPTANCE.md`.

## Componentes

| Componente | Contrato |
|---|---|
| `src/index.mjs` | SDK universal: apps, eventos, consentimento, experimentos, sugestões, hábitos, missões sociais e exclusão |
| `src/policy.mjs` | Elegibilidade fail-closed: evento de valor, fuso, pausa, opt-in, holdout, horário, cadência e frequência |
| `src/decisions.mjs` | Escolha adaptativa, experimentação e penalidade a mensagens repetidas |
| `src/storage/memory.mjs` | Adaptador de desenvolvimento, **não** fila de produção |
| `src/storage/neon.mjs` | Adaptador PostgreSQL; suporta cliente SQL injetado para testes de contrato |
| `src/worker.mjs` | Executor independente; OneSignal opcional e desligado por padrão; SQL preflight reforçado |
| `src/integrations/posthog.mjs` | Telemetria opcional com identificadores HMAC segregados por app/ambiente |
| `migrations/0005_opt_in_social_quests.sql` | Convite bilateral, aceite, missão cooperativa, 1 contribuição de valor por usuário/dia, exclusão em cascata |

## Instalação

```bash
node --version   # >=22
npm test
npm run smoke
npm run check
npm run load:smoke
npm run demo:multiapp
```

Em um backend confiável que use o Neon, instale `@neondatabase/serverless` e configure `DATABASE_URL` **somente no servidor**. Dependências externas não vêm instaladas dentro do ZIP. Faça `0001` a `0006` na ordem, após a base R3 v1.1, primeiramente em **homologação**. A versão 0006 não é aplicada automaticamente. Para `PostHog`, configure `TMNT_POSTHOG_PROJECT_KEY` e `TMNT_ANALYTICS_HASH_SECRET` de 32+ caracteres no backend; use a **mesma** chave de hash no worker e no emitter. Não coloque segredos no Flutter, iOS, Android ou web.

## Exemplo de API universal

```js
import {createTMNT} from './src/index.mjs';
import {createNeonRepository} from './src/storage/neon.mjs';
import {createPostHogEmitter} from './src/integrations/posthog.mjs';

const repository=await createNeonRepository(process.env.DATABASE_URL);
const onEvent=process.env.TMNT_POSTHOG_PROJECT_KEY
  ? createPostHogEmitter({
      projectKey:process.env.TMNT_POSTHOG_PROJECT_KEY,
      hashSecret:process.env.TMNT_ANALYTICS_HASH_SECRET,
    }) : null;
const tmnt=createTMNT({repository,onEvent});

// O BACKEND DO APP deve autenticar o usuário e derivar subject do contexto
// de autenticação, não da entrada do cliente. Os exemplos usam IDs opacos.
await tmnt.track({tenant:'instant',app:'dotsvest',environment:'test',
 subject:'opaque-server-authenticated-id',event:'micro_lesson_completed',
 eventId:crypto.randomUUID(),timezone:'America/Sao_Paulo',locale:'pt-BR'});
```

O banco deve estar previamente migrado e o aplicativo cadastrado com `events:[{name:'micro_lesson_completed',value:true}]`. A operação de `track` depende da identidade autenticada e da autorização ao app, ambas fornecidas pelo backend integrador.

### Mecânicas sociais opcionais

Habilite `modules.social=true` **somente** em produtos apropriados. Os usuários podem convidar, aceitar ou rejeitar, criar uma missão cooperativa entre amigos e encerrar a relação:

```js
await tmnt.inviteFriend({...scope,subject:'alice',friend:'bob'});
await tmnt.respondFriend({...scope,subject:'bob',friend:'alice',accept:true});
await tmnt.startFriendQuest({...scope,subject:'alice',friend:'bob',questKey:'week01',targetDays:6,durationDays:7});
await tmnt.friendQuestStatus({...scope,subject:'alice',friend:'bob',questKey:'week01'});
await tmnt.removeFriend({...scope,subject:'alice',friend:'bob'});
```

Convites **não** concedem amizade sem aceite. A missão só soma dias com evento de valor registrado depois do início, até uma contribuição por dia e por membro. `removeFriend` remove também as missões correspondentes em cascata. Não existem rankings públicos, amizades recomendadas automaticamente ou convites push compulsórios.

## Segurança e integridade

- O SDK é **somente backend**. Nenhuma chamada deve aceitar `tenant`, `app`, `environment` e `subject` arbitrários sem autorização do chamador. As funções SQL dependem de uma credencial de serviço com acesso apropriado.
- O envio de push permanece **desligado** por padrão (`R3_PUSH_ENABLED=false`). OneSignal retornar um identificador significa *aceitação*, não entrega ou abertura em aparelho físico.
- O worker revê consentimento, janela horária, cadência, cooldown, limites, resultado de valor e alocação antes da chamada externa. A partir da v1.6 a retirada de fila filtra no banco **ambiente e tenant/app autorizados**; um worker não pode reservar campanhas de outro escopo. Uma revogação no instante exato da chamada de rede ainda exige controles do provedor/dispositivo.
- Telemetria PostHog é **best effort**: falhar não deve duplicar eventos de valor ou notificações. O ganho D1/D7/D30 exige experimentos com usuários, amostra adequada e análise causal.
- Amizades são limitadas ao mesmo tenant/app/ambiente e opt-in bilateral; evite cadastrar nomes ou dados pessoais como IDs. Backend deve implementar bloqueios/abuso e rate limiting para recursos sociais antes de produção.

## Evidência e limites

Veja `docs/TEST_REPORT.md` e `docs/ACCEPTANCE.md`. A compatibilidade SQL foi testada em ramificação isolada do Neon, mas o pacote cliente JavaScript `@neondatabase/serverless` **não pôde ser instalado nesta execução por falta de conectividade npm**. O teste `load:smoke` é sintético e executado em memória. Ainda faltam testes end-to-end com dispositivos iOS/Android/Web, credenciais reais OneSignal/PostHog, observabilidade, controle operacional e impacto real de retenção. **Não chamar esta versão de 100% pronta para produção.**

## v1.6 — correção crítica de isolamento dos workers

Antes da v1.6, a função SQL de reserva de trabalhos buscava na fila universal inteira. Um executor configurado apenas para um ambiente ou aplicativo poderia reservar (e depois suprimir ou marcar como falha) uma notificação de outro ambiente/app.

A migração `migrations/0006_scoped_worker_claim.sql` cria `r3_v1_claim_job_scoped(worker,env_csv,scope_csv)` com os filtros obrigatórios **dentro do PostgreSQL, antes do primeiro bloqueio de linha**. O adaptador Node passa exclusivamente os escopos que constam de `TMNT_ONESIGNAL_APPS_JSON` e de `TMNT_ALLOWED_PUSH_ENVIRONMENTS`. O worker também bloqueia qualquer resultado fora de escopo antes de invocar o provedor.

**Ordem de instalação:** manter push desligado; aplicar `0001`–`0006` na ramificação de homologação; executar testes; validar acesso real do driver Neon e o contrato do worker; só então instalar na infraestrutura escolhida. Não ativar `R3_PUSH_ENABLED` antes de homologar consentimento, usuários de teste e OneSignal nos aparelhos. Uma instância do worker sem provedores autorizados falha sem retirar trabalhos.

**Telemetria:** PostHog só opera com `TMNT_ANALYTICS_HASH_SECRET` forte. Removi o fallback para hash SHA-256 sem chave. IDs de usuário enviados à telemetria são HMACs segregados por app, empresa e ambiente.

**Estado:** contrato local, regressão e SQL isolado testados; nenhuma integração real OneSignal/iOS/Android/WEB ou experimento D1/D7/D30 com usuários reais comprovado. A tentativa de `npm install` do driver devolveu sucesso sem instalar os bytes; verificação por `import()` retornou `ERR_MODULE_NOT_FOUND` porque o acesso ao registry npm falhou (`EAI_AGAIN`). A instalação real do SDK permanece pendente.


## v2.3 InstantStudy executable QA integration

Backend bridge in `integrations/instantstudy/`, with draft PR https://github.com/raphaelribeirob/InstantStudy/pull/61. HTTP transport verified with HMAC identity, pseudonym and replay protection, opt-out/default disabled. This is **not** production-activated, and cannot guarantee durable retries during outages. See `docs/V23_INSTANTSTUDY_ACCEPTANCE.md`.
