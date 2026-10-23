# TMNT Engine v2.2 — Critérios de aceite

| Critério | Resultado | Evidência |
|---|---|---|
| Esquema inicial embutido convertido em 0000 independente | PASS | `scripts/build-bootstrap.mjs` |
| 0000–0012 disponíveis, completos e na ordem | PASS | `npm run db:verify-install` |
| PostgreSQL QA, esquema vazio: 0000 + 12 migrações | PASS QA | 27 tabelas, 36 funções |
| App/atividade/mission/reward/idempotência em esquema novo | PASS QA | streak 2, goal 3, XP 35 |
| SDK moderno e regressão legado | PASS laboratório | 192 + 137 = 329 testes |
| Smoke HTTP local | PASS laboratório | 21/21 |
| Contratos específicos nos repositórios de apps | PASS QA documental | Seis branches com contrato de integração (somente documentação) |
| Driver @neondatabase/serverless no backend de app real | PENDENTE | `npm run db:verify-live` requer credenciais e driver |
| App real executando API e banco com identidade validada | PENDENTE | Nenhum backend de app foi conectado por deploy |
| TLS/proxy de produção, OneSignal APNs/FCM e pagamentos reais | PENDENTE | Sem infra/credenciais/dispositivos |
| Testes de carga PostgreSQL, falhas, LGPD e D1/D7/D30 com usuários | PENDENTE | Só laboratório/QA |

**PASS significa apenas o cenário nomeado, não autorização de produção.**
