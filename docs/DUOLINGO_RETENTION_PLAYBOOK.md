# RIVERENGINE v2.6 — Duolingo Retention Playbook

**Status:** Implementação técnica QA; nenhuma notificação, feature flag ou experimento foi ativado em usuários reais.
**Direção:** RIVERENGINE passa a priorizar **retorno voluntário para atividades com resultado real**, em vez de benefícios comerciais inspirados no iFood. A camada de commerce mantém compatibilidade, mas não será evoluída nesta etapa.

## Objetivo mensurável

Aumentar a proporção de pessoas que **concluem uma atividade de valor** no dia D1, D7 e D30 após a primeira exposição à experiência de retenção, sem reduzir a qualidade do produto ou violar preferências pessoais.

Eventos de valor são específicos de cada aplicativo e precisam de confirmação autenticada do backend (ex.: `study_session_completed`, `conversation_completed`, `practice_completed`). **Aberturas de tela, cliques ou disparos de push não contam como progresso.**

## Mecanismos do Duolingo aplicáveis

| Mecanismo | Implementação RIVERENGINE | Condições de uso |
|---|---|---|
| Streak diário | Calendário no fuso do usuário + freeze + reconciliação offline | Somente evento de valor, nunca login puro |
| Metas e XP | Meta ajustável e crédito idempotente | Opt-in para produtos que se beneficiem de gamificação |
| Daily quests | Missões parametrizadas por app, recompensa resgatada uma vez | Variedade e rotação de missões ainda a aprofundar |
| Friend Streak | Aceite bilateral e progresso dos dois usuários | Convites limitados, participação voluntária |
| Ligas | Ranking semanal opcional, limites por dia | Desabilitadas em produtos em que competição seja inadequada |
| Notificações | Escolha por resultados, horário aprendido, quiet hours, frequência | Push precisa de consentimento próprio; app não deve afirmar entrega só pela aceitação do provedor |
| Experimentação | PostHog flags + conversões de valor + relatório D1/D7/D30 por variante | Analytics consent verificado, backend autenticado, testes antes de rollout |

Documentação de referência: Duolingo Product Highlights 2025, Friend Streak, artigo de streak A/B e documentação de experimentos do PostHog. Nem todos os detalhes proprietários do Duolingo são conhecidos; implementação equivalente de mecanismos não certifica igualdade de eficácia.

## Integridade de analytics (v2.6)

- `createRiverEngine(..., onEvent)` só invoca telemetria quando o adaptador confirma **analytics habilitado e consentimento persistido/verificado**.
- `createPostHogEmitter({... , isEligible: (scope) => repository.isABEligible(scope) })` revalida na transmissão; sem verificador, a criação falha.
- O worker também só registra telemetria no PostHog após a consulta de consentimento no backend.
- `createRiverABExperiments().conversion()` verifica a variante antes de consumir um evento; a inserção de Neon condiciona a gravação a `x.variant = expectedVariant`.
- Consentimento analítico é **independente** de push/reminders. Revogação bloqueia novos envios. Para conformidade integral, validar processo de exclusão no PostHog real, além da deleção no Neon.
- Eventos capturados no PostHog **ainda não têm outbox transacional**; dados podem ser perdidos se o provedor falhar. Status de telemetria não equivale a ingestão confirmada.

## Relatório D1/D7/D30

```js
import { reportDuolingoRetention } from '@riverthree/riverengine/duolingo-retention';
const report = reportDuolingoRetention({
  flagKey: 'study-goal-guidance-v1', asOf: '2026-10-21', minPerArm: 100,
  participants: [/* sujeitos consentidos com variante/exposedAt verdadeiros */],
  valueDays: [/* eventos de valor verificados, com verified:true */]
});
```

Alternativamente, em um **serviço de analytics com acesso administrativo** e adaptador Neon:

```js
const report = await experiments.reportRetention({
  tenant:'workspace', app:'instantstudy', environment:'test',
  subject:'service_admin', // identificador técnico exigido pelo contrato; não autoriza acesso por si só
  flagKey:'study-goal-guidance-v1', variants:['control','test'],
  asOf:'2026-10-21', minPerArm:100
});
```

**Obrigatório:** controlar autorização administrativa fora da engine. Não publicar este método em rotas de clientes nem mostrar IDs de sujeitos; os relatórios retornam apenas agregados.

- D1 é retorno com atividade de valor **exatamente no dia UTC seguinte** à exposição, D7 e D30 analogamente. *Não* significa evento a qualquer momento nos primeiros N dias.
- Só contar dias totalmente concluídos; janelas ainda imaturas são excluídas (censura à direita).
- Contar usuário **uma única vez por variante**; duplicação e variantes conflitantes causam erro.
- Uma atividade é válida somente quando verificada no backend e posterior à exposição original.
- SRM (Sample Ratio Mismatch) sinaliza alocação desigual; amostra insuficiente e intervalos exploratórios impedem declarar vitória causal.
- Usuários podem estar em fusos diferentes: UTC no relatório experimental é uma simplificação; métricas de streak continuam no **calendário local**. Escolher e registrar previamente qual definição vale para cada experimento.

## Primeiros experimentos sugeridos (rascunhos; todos desativados)

1. **InstantStudy:** explicar o benefício de estabelecer uma meta diária vs. controle. Primária D7 com atividade de valor, secundárias D1/D30; guardrails desistência do onboarding e qualidade das avaliações.
2. **InstantSpeak:** horário personalizado de lembretes vs. lembrete tradicional, somente após consentimento push; primária conversas concluídas por pessoa exposta, secundária D7, guardrails bloqueio de push e queixas.
3. **DOTSVEST:** três missões de revisão (vs. revisão tradicional), primária exercícios corretos concluídos e D7, guardrails erros sistemáticos, abandono e tempo excessivo.

**Não aplicar automaticamente** competição em InstantBible, nem streak diário a InstantWork: retenção inadequada pode piorar a experiência. O objetivo é engajamento relevante, não gamificação indiscriminada.

## Requisitos antes de liberação em produção

- [ ] Integrar uma fonte de identidade autenticada e assinaturas confiáveis no backend.
- [ ] Instalar o SDK e o driver PostHog/Neon reais no ambiente homologado com credenciais de QA.
- [ ] Criar a fila durável transacional e mecanismo de reenvio idempotente para conversões/exposições, com observabilidade e DLQ.
- [ ] Configurar feature flags, limites de exposição, guardrails, kill switch e holdout no PostHog real.
- [ ] Testar consentimento, revogação e exclusão ponta a ponta (PostHog + Neon), incluindo mudanças durante envio.
- [ ] Realizar testes de dispositivos, acessibilidade e não perturbação nas notificações.
- [ ] Pré-registrar métricas, amostragem, SRM, critérios de encerramento, testes múltiplos e análise de D1/D7/D30 com usuários reais.
- [ ] Permitir rollout progressivo com reversão e sem alegar causalidade antes do estudo.

**Nunca confundir:** `372/372` testes locais aprovados ≠ efeito positivo demonstrado em produção.


## v2.7 — Decidir não enviar é inteligência

`planSmartReminder()` adiciona segmentação por contexto (streak consistente, reinício gentil, meta configurada), abstinência por falta de elegibilidade/fadiga e preferência humana de horário inviolável. **Não** transforma o modelo estatístico em aprendizado causal. A política de quatro notificações maduras sem valor em 14 dias é uma barreira inicial de proteção, não uma configuração comprovadamente ótima. Executar o planejador por scheduler backend confiável; notificação colocada na fila **não equivale** à entregue. Ver `V27_ACCEPTANCE.md` para testes.
