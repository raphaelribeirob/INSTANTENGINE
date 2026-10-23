# TMNT v1.9 — Relatório de testes

**Data:** 20/10/2026  
**Ambiente:** Node.js >= 22; engine independente de hospedagem; PostgreSQL Neon em ramo isolado de QA.

## Execuções confirmadas

- `npm test`: **151/151 modernos + 137/137 legados = 288/288 PASS**.
- `npm run smoke`: **21/21 HTTP PASS**, sem DATABASE_URL e sem push real.
- `npm run check`: **PASS**.
- `node --test --experimental-test-coverage test/*.test.mjs`: **98,70% linhas / 90,15% branches / 93,74% funções** (somente suíte moderna).
- `node --test test/habits-timezone-regression.test.mjs`: **15/15 PASS**.
- `node /mnt/data/TMNT_DUOLINGO_v19_REGRESSION.mjs`: **2/2 PASS** dos casos que falhavam na v1.8.
- `npm run demo:http`: **PASS** HTTP local.
- `npm run demo:duolingo-ifood`: **PASS** integração demonstrativa.
- `npm run load:smoke`: **5.000 eventos em memória; 20 duplicatas bloqueadas**. Não é benchmark PostgreSQL ou teste de produção.

## Prova de paridade no Neon

Branche QA `br-twilight-breeze-b5bnh1z1`, projeto `little-frost-61962118`. App sintético `tmnt19/timezoneqa/test`. Três usuários em `America/Sao_Paulo`, `Asia/Tokyo`, `America/New_York`. Para todos, duas atividades no mesmo dia local (inclusive travessia de meia-noite UTC e fim de DST) produziram `streak=1`, `today_count=2`, `daily_goal=3`, `xp=20`, sem alterar o banco principal.

## O que não se deve inferir

A cobertura não significa que o SDK tenha sido exercitado com o **driver** `@neondatabase/serverless` instalado. A prova via conector Neon testa o SQL de homologação; os testes locais do SDK usam cliente SQL injetado. Sem credenciais OneSignal/APNs/FCM, nenhuma entrega real foi medida. Não há inferência causal de melhoria de retenção D1/D7/D30.
