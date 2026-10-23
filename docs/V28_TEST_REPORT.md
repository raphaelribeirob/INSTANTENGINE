# RIVERENGINE v2.8 — Relatório de testes (QA)

**Data:** 2026-10-21 | **Versão:** v2.8.0 | **Ambiente:** Node.js 22, Python 3 com statsmodels instalado; sem acesso ao registry npm/PyPI.

- 274/274 testes de SDK Node (250 herdados + 24 novos, incluindo os dois critérios de segurança adicionados).
- 4/4 testes do adaptador legado InstantStudy.
- 137/137 testes legados R3.
- 7/7 testes Python Statsmodels/contratos MABWiser.
- **422/422 testes automatizados** aprovados em laboratório (incluindo os Python).
- **21/21 smoke HTTP**; sem DATABASE_URL, o diagnóstico indica que o banco real não foi validado.
- `npm run check` e `npm run db:verify-install` passaram: esquema bootstrap + 14 migrações.
- Simulação de notificação contextual retornou fila `queued` e `providerDelivered:false` sem chamada externa.
- Statsmodels calculou diferenças em pontos percentuais, intervalos Newcombe e SRM em dois experimentos sintéticos. Nenhuma recomendação de rollout automático.

### O que NÃO foi testado

A instalação npm de `graphile-worker` e pip de `mabwiser` falhou por falta de resolução DNS/registro no contêiner. Não houve worker Postgres TCP real, treino efetivo do MABWiser nem PostHog com credenciais reais. Os módulos Graphile e os guardrails MABWiser foram testados por injeção de implementações simuladas. Somente Statsmodels foi de fato importado e executado.
