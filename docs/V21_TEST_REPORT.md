# TMNT Engine v2.1 — relatório de verificação

20 de outubro de 2026. Plataforma: Node.js 22.x, execução local em laboratório + PostgreSQL Neon em ramificação QA isolada.

| Teste | Resultado |
|---|---|
| Suíte moderna com novos testes adversariais | PASS 187/187 |
| Regressão legada | PASS 137/137 |
| **Total de testes automatizados** | **PASS 324/324** |
| Smoke HTTP legado | PASS 21/21; sem banco de produção |
| `npm run check` | PASS |
| Carga sintética em memória | PASS: 5.000 eventos, 20 duplicatas negadas |
| Demo de missões, Friend Streak e ligas | PASS; sem notificações reais |
| Gateway contra downgrade HTTP em produção e spoof de proxy | PASS; HTTP 403 |
| Experimentos extremos 100/100 e 0/100 | PASS; intervalo Newcombe/Wilson não degenerado |
| Convites com cota padrão e por app | PASS, inclusive concorrência simulada |
| Migração 0011 Neon QA: cotas, histórico, destinatário cheio e duas tentativas simultâneas | PASS; apenas uma ocupou última vaga |
| Migração 0012 Neon QA: eventos fora de ordem, replay repetido | PASS; streak 1→3, XP 10→30, repetição sem ganhos extras |

**Limites verificados:** o driver `@neondatabase/serverless` não foi instalado como dependência local do backend de um aplicativo. As chamadas SQL foram testadas pela conexão de homologação Neon; isso não é teste E2E de um app em produção. Não houve entrega OneSignal para aparelho físico, checkout financeiro, experimento D1/D7/D30 com usuários reais, teste de carga PostgreSQL nem auditoria externa de segurança. O gateway necessita de TLS efetivo no edge/proxy.

**Reprodução local:** `npm test`, `npm run smoke`, `npm run check`, `npm run load:smoke`, `npm run demo:next`, e `node --experimental-test-coverage --test test/*.test.mjs`.

**Proteção operacional:** notificações reais desativadas por padrão; não aplicar as migrações à branch principal sem processo de release e backup aprovado. Rollback usando backup/versão anterior da aplicação, sem manipular históricos de atividade de usuário.

**Cobertura da suíte moderna:** # all files                              /   99.08  /     89.54  /    93.70  / 
