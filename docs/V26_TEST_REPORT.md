# RIVERENGINE v2.6 — Test Report

**Data:** 2026-10-21. **Escopo:** implementação local, SDK, PostHog com mocks, SQL injetado, QA read-only no Neon. **Ambiente produtivo:** inalterado.

## Mudanças validadas

- F1: Telemetria genérica, emissor PostHog e worker exigem analytics habilitado e consentimento armazenado/verificado; sem prova de elegibilidade, não enviam.
- F2: Validação da variante antes de registrar conversões, com `expectedVariant` aplicado no predicado de gravação do PostgreSQL.
- F3 novo: Relatório D1/D7/D30 por experimento (usuários únicos, maturação de janelas, confidencialidade, SRM, testes estatísticos exploratórios e nenhuma declaração automática de lift causal).

## Verificações executadas

- `npm test`: **372/372** — 231 núcleo moderno (12 novos), 4 integração do app de estudos, 137 legados.
- `npm run smoke`: **21/21** asserts de HTTP local; sem DATABASE_URL no executor e sem push real.
- `npm run check`: PASS.
- `npm run db:verify-install`: **14/14** migrações verificadas na ordem esperada, sem aplicação de novas migrações.
- `npm run load:smoke`: 5.000 eventos sintéticos e 20 duplicatas recusadas; não é benchmark de produção.
- `npm run demo:next`: PASS (Friend Streak, missões e ligas simuladas).
- `npm run demo:ab`: PASS com flag e captura locais simuladas; **não** PostHog em produção.
- Neon QA somente leitura: uma exposição com analytics verificado, um dia distinto de atividade de valor e variante persistida no esquema `tmnt_v22_clean_qa`.

## Limitações abertas

- Sem outbox transacional de PostHog nem garantias de entrega durante indisponibilidade.
- Não foi executado um experimento real com PostHog e usuários.
- Não foi validada a instalação da v2.6 no runtime real dos apps ou em dispositivo físico.
- O relatório D1/D7/D30 é exploratório; retornos por dia UTC e dados sintéticos não demonstram retenção causal.
- Os PRs das aplicações não foram alterados nem integrados à branch de produção nesta rodada.
