# RIVERENGINE 2.5 — Relatório de testes PostHog A/B

**Data:** 21/10/2026. **Estado:** QA validado / produção não homologada.

| Suíte | Resultado |
|---|---:|
| Node.js moderno, incluindo 17 testes PostHog A/B | 219/219 |
| Adaptador InstantStudy | 4/4 |
| Núcleo legado | 137/137 |
| **Total automatizado** | **360/360** |
| Smoke HTTP legado | 21/21 |
| Migrações disponíveis / verificadas estaticamente | 14/14 (0000–0013) |
| Teste de carga sintética em memória | 5.000 eventos + 20 duplicatas rejeitadas |
| Demonstração A/B simulada | Atribuição e conversão aprovadas |

## Evidência no Neon QA

- Projeto: `little-frost-61962118`, branch QA `br-twilight-breeze-b5bnh1z1`, esquema isolado `tmnt_v22_clean_qa` (não produção).
- Migração 0013 instalada: 3 tabelas e 1 índice criados.
- Atribuição `daily-goal-v1` mantida em `test` apesar de segunda tentativa de inserir `control`.
- Conversão `app_opened` (evento sem valor) rejeitada.
- `lesson_completed` com evento verificado após exposição aceita uma única vez; duplicata rejeitada.
- Nenhum vazamento para aplicativo incorreto constatado no teste.

## Limitações e critérios pendentes

- **PostHog externo:** nenhum projeto/feature flag/experimento foi criado ou lançado; os 17 testes usam cliente PostHog simulado com o contrato da API oficial.
- Testar `posthog-node` conectado ao projeto real, captura de `$feature_flag_called`, processamento de `riverengine_ab_conversion`, limites de ingestão e resultados do dashboard.
- Ainda falta outbox de telemetria para reenvio durável: se a captura falhar, a conversão permanece no Neon mas pode não chegar ao PostHog.
- O SDK do PostHog registra a exposição de flag no momento de `getFlag`, **antes** de a inserção da variante ser concluída; uma falha do banco pode gerar exposição não servida. Reconciliar antes de publicar estatísticas.
- Backend real, consentimento assinado e testado em app, medição de retenção D1/D7/D30, LGPD junto ao PostHog e validação estatística com pessoas reais: pendentes.

**Conclusão:** 100% dos critérios de laboratório desta rodada passaram; não equivale a 100% de prontidão comercial ou impacto causal comprovado.
