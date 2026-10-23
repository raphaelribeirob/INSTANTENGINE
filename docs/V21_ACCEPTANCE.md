# TMNT Engine v2.1 — Critérios de aceite e bloqueios

Data: 20/10/2026. Escopo: laboratório / homologação isolada, sem deploy de produção.

| Critério | Status | Evidência |
|---|---|---|
| Gateway de produção rejeita HTTP no receptor antes do nonce | PASS | Testes downgrade assinados; HTTP 403, nonce não consumido |
| Cabeçalhos não confiáveis `Forwarded` e `X-Forwarded-Proto` não anulam exigência TLS | PASS | Teste adversarial com headers falsos |
| Receptor HTTPS e assinaturas HMAC válidas continuam funcionais | PASS | Testes de gateway v2.1 |
| Ensaio extremo 100/100 vs 0/100 não produz IC degenerado | PASS | Newcombe/Wilson 95%; limite inferior menor que 1, `pValue` não é zero |
| A/A, SRM e N insuficiente recebem sinalização conservadora | PASS | Testes de experimentos v2.1 |
| Amizades limitadas por conta e destinatário, configuráveis por app | PASS | 5 padrão; limites por app `socialMaxFriends` 1-50 |
| Convites por janela móvel de 24h limitados por usuário | PASS | 5 padrão, `socialDailyInvites` 1-50; remoção não reinicia a cota |
| Convites concorrentes não ultrapassam o último limite | PASS homologação | PostgreSQL: duas solicitações, apenas uma aceita |
| Histórico de convite no PostgreSQL isolado | PASS homologação | `0011_social_antiabuse.sql`, FK com cascata |
| Reconciliação offline só usa eventos de valor registrados, não `app_opened` | PASS | `0012_habit_reconciliation.sql`, teste local e Neon |
| Replay do histórico preserva meta e XP de missões; é idempotente | PASS | Testes de replay repetido local e Neon; não duplica XP |
| Operação de reconciliação não está na lista padrão HTTP | PASS | Administração requer permissão explícita |
| 100% da suíte incluída na v2.1 | PASS | Execução limpa local; resultados em V21_TEST_REPORT.md |
| TLS real/terminação confiável do ambiente operacional | PENDENTE | Exige configuração e testes no servidor implantado |
| Driver Neon instalado no backend do app | PENDENTE | Não verificado em produção |
| Notificações reais no dispositivo | PENDENTE | OneSignal e aparelhos não conectados |
| Medição de retenção incremental D1/D7/D30 em usuários reais | PENDENTE | Sem experimento online com grupo controle |
| Capacidade sob carga, pentest, LGPD e monitoramento de falhas | PENDENTE | Não é demonstrável apenas pela suíte local |

O resultado **PASS** certifica somente o critério técnico ensaiado no ambiente indicado. Não declara paridade total com o Duolingo/iFood nem prontidão 100% de produção.
