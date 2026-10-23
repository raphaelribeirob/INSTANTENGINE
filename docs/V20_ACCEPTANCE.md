# TMNT Engine 2.0 — Matriz de aceite (20/10/2026)

| Critério | Status | Evidência | Limites |
|---|---|---|---|
| Cadastro multiapp e compatibilidade legada | PASS laboratório | 312/312 testes totais | Não é teste de app implantado |
| Missões por evento de valor | PASS | Testes Node e Neon SQL | Admin do app deve definir corretamente os eventos |
| Recompensas idempotentes sob concorrência | PASS | 3 requisições Neon, apenas uma reivindicação | Validação feita em homologação |
| Recompensa XP não fantasma | PASS local | Só permite rewardXp > 0 com habits habilitado | SQL atualizado em QA |
| Missões isoladas por tenant/app/ambiente | PASS | PK/FK compostas, módulo opcional | Validar permissões de DB de produção |
| Friend Streaks pós-aceite bilateral | PASS | Node + Neon, leitura simétrica | Calendário compartilhado UTC, não fusos locais individuais |
| Liga opt-in com placar semanal e sem nomes públicos | PASS | Node + Neon, eventos prévios excluídos | Antiabuso/rate limiting de plataforma ainda requerem testes |
| Personalização de horário | PASS laboratório | 16 notificações sintéticas maturadas no Neon: 1/8 às 10h, 7/8 às 18h | Não foi A/B causal nem envio físico |
| Preservação de preferência explícita | PASS | `r3_v1_apply_optimized_hour`, UPDATE bloqueado após origem user | Pré-requisito: integração de preferências no app |
| Experimento com amostra, SRM e IC | PASS laboratório | Testes `assessExperiment` | Não afirma causalidade nem ganho real |
| API HTTP para novos módulos | PASS local | Requisições assinadas; administração restrita | Backends devem autenticar usuário |
| Compatibilidade iFood: ofertas/feedback | PASS regressão | Suítes 1.x | Pagamento real ausente |
| Push real iOS/Android/Web | PENDENTE | Não realizado | Exige credenciais, dispositivos e consentimento |
| Driver Neon em backend de app real | PENDENTE | SQL QA validado; módulo externo indisponível | Sem certificação E2E |
| Experimentos D1/D7/D30 reais | PENDENTE | Sem coortes reais maduras | Requer usuários e análise causal |
| Carga real e recuperação | PENDENTE | 5.000 eventos sintéticos em memória | Não é benchmark de produção |

**Observação:** PASS significa que o critério e suas asserções foram cumpridos no ambiente indicado, não 100% de correspondência com o Duolingo ou prontidão em produção. Nenhum deploy de app foi feito.
