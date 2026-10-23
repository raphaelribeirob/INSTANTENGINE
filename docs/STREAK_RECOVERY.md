# Operação: recuperação de streak após sincronização offline

1. O backend autentica o usuário e registra eventos idempotentes (`event_id` UUID) de atividade *comprovada* por seu sistema. **Nunca** aceite um campo `streak` calculado no dispositivo como verdade do servidor.
2. O backend ingere todos os eventos pendentes, incluindo os mais antigos, com horário e fuso apropriados. Cuidado: o limite de aceitação do evento e as políticas antifraude do aplicativo precisam ser aplicados antes da ingestão.
3. Após confirmar a ingestão, o serviço de confiança pode executar `sdk.reconcileHabit({tenant,app,environment,subject})`. O registro de eventos de valor, e não alegações do cliente, define a recuperação.
4. No Neon, a migração `0012_habit_reconciliation.sql` implementa `r3_v1_reconcile_habit`, com travamento do usuário e reconstrução de streak, XP, freeze e meta diária. Reconciliar o mesmo histórico duas vezes não cria mais XP.
5. Na API HTTP, `reconcileHabit` não está em `DEFAULT_ACTIONS`: só uma credencial de backend explicitamente configurada para essa operação pode utilizá-la. Registre e monitore esses acessos administrativos.
6. Compare o estado antes e depois, registre o resultado e trate anomalias. Para incidências massivas, processe em lotes pequenos com observabilidade e rollback operacional do app.

**Limites:** esta versão usa o fuso atual do perfil para replay histórico. Mudanças de fuso ao longo do histórico precisam de avaliação específica. A integridade dos eventos registrados depende do backend host (autenticação, prevenção a fraude e política de backfill); a TMNT não pode validar uma aula ou compra simplesmente por receber seu evento. Incidentes da plataforma que apagaram eventos inteiros exigem um fluxo administrativo adicional baseado em evidências externas; a reconciliação não inventa atividades ausentes.
