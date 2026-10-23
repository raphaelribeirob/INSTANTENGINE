# Relatório de testes TMNT Engine 2.0

**Versão:** 2.0.0 · **Data:** 2026-10-20 · **Ambiente:** Node.js 22.16.0, laboratório local + Neon PostgreSQL staging.

## Resultados automatizados

- `npm test`: 175 testes modernos + 137 legados = **312/312 PASS**.
- `npm run smoke`: **21/21 PASS** em HTTP local; DB real desligado no smoke legado; push real desligado.
- `npm run check`: PASS.
- `npm run load:smoke`: 5.000 inserts sintéticos, 20 duplicatas rejeitadas, sem claim de capacidade produtiva.
- `npm run demo:next`: PASS; eventos, missão, prêmio único, Friend Streak, liga semanal, leitura de experimento.
- Cobertura da suíte moderna: **99,10% das linhas**, **89,68% dos ramos**, **93,76% das funções** (`tmnt_v20_release_coverage.log`).

## PostgreSQL QA

**Projeto:** `<redacted>`; **ramificação isolada de homologação:** `<redacted>`.

- Migração SQL aditiva `0009` + `0010` instalada e testada, sem tocar no banco principal.
- Missão diária de duas atividades: progress 2/2; única recompensa = 20 XP; duplicata rejeitada.
- Concorrência de 3 resgates para missão de 1 atividade: 1 sucesso, 2 recusas.
- Friend Streak: 0 antes dos eventos de valor; 1 após ambos; consulta reversa retorna mesmo resultado; outro app sem amizade retorna zero linhas.
- Preferência do usuário: alterar `reminder_hour_source='user'` impediu que a otimização sobrescrevesse o horário.
- Aprendizado de horários com dados sintéticos: 16 registros aceitos artificialmente, 8 em cada horário; `converted` 1 às 10h, 7 às 18h; query computou contagens corretas; nenhum push foi enviado.
- Liga opt-in: módulo desligado recusa adesão; após ativação em app de QA, novo evento real (de laboratório) vale 10 pontos; abertura não pontua; saída encerra consulta de ranking.

**O que não foi comprovado:** comunicação entre SDK completo e Neon via driver externo, entrega OneSignal em aparelhos, infraestrutura de alta disponibilidade, retenção incremental causal, segurança ofensiva completa, experimento real comparável ao do Duolingo.

## Resultado de release final

- `npm test`: **175/175 modernos + 137/137 legados**.
- `npm run check`, `npm run smoke`, `npm run load:smoke`, `npm run demo:next`, `npm run demo:http` e `npm run demo:duolingo-ifood`: PASS.
- As verificações de SQL usam o conector Neon na branch de QA; o pacote JavaScript Neon não foi instalado neste runtime, portanto não há E2E real app→SDK→Neon.

- Última correção: missões sem `habits=true` recusam `rewardXp>0`; teste Node e função SQL Neon QA passaram.
