# RIVERENGINE v2.7 — Relatório reproduzível de QA

**Data:** 2026-10-21. **Ambiente:** Node.js 22.16.0, pasta de trabalho isolada; testes sem segredos nem envios a usuários reais.

## Execuções

- `npm test`: **391/391** aprovados (**250** SDK moderno, **4** adaptador do app de estudos, **137** legados).
- Novas regressões v2.7: **19** (15 decisões/contexto + 3 SQL contract + 1 gateway HMAC).
- `npm run smoke`: **21/21** verificações HTTP legadas, com aviso explícito de `DATABASE_URL` ausente.
- `npm run check`: aprovado.
- `npm run db:verify-install`: verificadas **14 migrações** (0000–0013) e integridade estática do bootstrap.
- `npm run load:smoke`: 5.000 eventos sintéticos, 20 duplicações rejeitadas; não é benchmark Neon.
- `npm run demo:smart-notifications`: decisão de streak contextual `queued`, `providerDelivered:false`, sem tráfego OneSignal.
- `node --experimental-test-coverage --test test/*.test.mjs`: linhas **98,26%**, ramos **88,57%**, funções **94,15%** no relatório agregado. Esse número não é medição de segurança de produção.

## Evidência técnica

- Função pura `decideSmartNotification` nega pushes por consentimento, holdout, horários, pausa, atividade atual, limite e fadiga; escolhe apenas templates contextualmente aprovados.
- `recommendSafeSendHour` exige histórico suficiente e preserva preferência explícita.
- `planSmartReminder` só retorna `queued` após reserva efetiva no backend, nunca um recibo de entrega.
- Adaptador Neon tem leituras parametrizadas, com verificação de consentimento antes de consultar o comportamento e políticas de fadiga no worker.
- Gateway assinado só aceita a operação para sujeito do backend autenticado.

## Limitações materiais

**A consulta Neon real desta rodada foi bloqueada pela camada de segurança da ferramenta externa.** A implementação SQL v2.7 passou na análise de contrato injetado, **não** foi homologada nesta rodada contra a execução real do Neon. A QA do esquema anterior não certifica a nova query. Não foi feita ativação no OneSignal ou PostHog, nem testes com usuários ou celulares, cron e gateway implantados, ou validação causal D1/D7/D30. `R3_PUSH_ENABLED` permanece `false` por padrão.

Para reproduzir: `npm test && npm run check && npm run smoke && npm run db:verify-install && npm run load:smoke && npm run demo:smart-notifications`.
