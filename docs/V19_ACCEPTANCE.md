# TMNT v1.9 — Critérios de aceite (20/10/2026)

| Critério | Resultado | Evidência |
|---|---|---|
| Streak não avança duas vezes no mesmo dia local | **PASS** | `test/habits-timezone-regression.test.mjs`; reprodução anterior 0/2, atual 2/2 |
| Streak avança após meia-noite **local** | **PASS** | 4 fusos no teste de regressão |
| Fim/início de DST não produz streak falso | **PASS** | `America/New_York` 01:30 repetido e salto em março |
| Meta personalizada persiste após atividades | **PASS** | Memória, teste de continuidade com dias distintos |
| Mudança da meta atualiza `goalMet` | **PASS** | Teste de atualização de meta sem novos eventos |
| Mesmo evento UUID não gera XP duplicado | **PASS** | API `track` em teste moderno |
| Evento anterior ao último dia não altera streak/XP | **PASS** | Teste de evento fora de ordem |
| PostgreSQL e memória concordam em calendários locais | **PASS para 3 cenários QA** | Neon branch `<redacted>` (São Paulo, Tóquio, Nova York) |
| Estado de hábito do SDK Neon normalizado | **PASS contrato com SQL injetado** | DATE/BIGINT/goalMet; **driver real ainda não instalado** |
| Suíte antiga e moderna sem regressão | **PASS 288/288** | Log `TMNT_v19_FINAL_TEST.log` |
| Smoke HTTP | **PASS 21/21** | Log `TMNT_v19_FINAL_SMOKE.log` (sem DATABASE_URL) |
| Envio físico OneSignal/APNs/FCM | **PENDENTE** | Credenciais, SDKs e aparelhos não provisionados |
| Experimentação causal sobre D1/D7/D30 | **PENDENTE** | Não há coortes reais suficientes |
| Paridade integral de missões sociais, ligas e notificações com Duolingo | **PENDENTE** | Requer implementação e avaliação de produto |

Os resultados PASS referem-se à implementação testada, não à retenção alcançada em produção. O banco principal não foi modificado.
