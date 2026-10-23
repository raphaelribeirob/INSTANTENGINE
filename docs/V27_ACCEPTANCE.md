# RIVERENGINE v2.7 — Aceite de notificações inteligentes

**Escopo:** camada de decisão contextual *backend-only*, integração no SDK, adaptadores de memória/Neon, gateway assinado e barreira adicional de fadiga no worker. **Estado:** aprovado em testes automatizados de QA, não implantado em produção.

| Critério | Evidência | Situação |
|---|---|---|
| Identidade/escopo autenticados | Gateway HMAC impede troca de `subject`, valida escopo e nonce | Aprovado em HTTP de laboratório |
| Push consentido/verificado | Negado quando falta consentimento push/reminder | Aprovado |
| Holdout A/B respeitado | Negado antes da escolha de template | Aprovado |
| Quiet hours e timezone | Calendário local e horários específicos do app | Aprovado |
| Meta já concluída e pausas | Não envia no mesmo dia de atividade válida nem em pausa | Aprovado |
| Classificação contextual | Streak, retorno gentil, meta e template genérico aprovado | Aprovado |
| Evitar fadiga | Quatro notificações maduras sem atividade de valor em 14 dias → não enviar | Aprovado em memória; SQL de worker em teste de contrato |
| Não otimizar por cliques | Só eventos de valor verificados evitam a supressão por fadiga | Aprovado |
| Seleção estável | Catálogo aprovado e seleção estatística com penalização de repetição | Aprovado |
| Melhor hora individualizada | Mínimo de amostras, comparação de resultados verificados | Aprovado em memória |
| Preferência explícita de horário | Nunca sobrescreve a configuração de origem `user` | Aprovado |
| Concorrência/revogação | Revalidação no enqueue e preflight do worker | Aprovado em memória; preflight SQL por contrato |
| Entrega ≠ reserva | Resposta `queued` e `providerDelivered:false` | Aprovado |
| Outros apps | Identificadores tenant/app/environment isolados | Aprovado em memória e contrato SQL |
| Instalação DB | Migrações 0000–0013, sem nova migração na v2.7 | Verificação estática passou; SQL vivo v2.7 não confirmado |
| OneSignal em celulares | Recibo físico e taxa de entrega | **Pendente** |
| Cron produtivo | Agendador autenticado chamando o planner em todos os backends | **Pendente** |
| Eficácia de retenção | Experimento de retorno D1/D7/D30 com usuários reais, guardrails e holdout | **Pendente** |

Os thresholds iniciais são **heurísticas de segurança**, não promessas de eficácia nem uma cópia do algoritmo proprietário do Duolingo. A definição de evento de valor e os templates devem ser adaptados à oferta de cada app; proibir conteúdo coercitivo, falso ou que crie urgência artificial.

## Liberação

Antes de ativar `R3_PUSH_ENABLED` em produção: testar `planSmartReminder()` com Neon real no backend, cron seguro, auditoria de consentimento, configuração OneSignal/alias, desativação fácil pelo usuário, tempo de resposta e falha de rede, logs de supressão em escopo permitido, exclusão e LGPD, testes em Android/iOS, além de experimentos aleatorizados e revisão dos templates.
