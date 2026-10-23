# TMNT Engine v1.8 — relatório da execução

**Data:** 2026-10-20. **Runtime:** Node.js 22.16.0.

| Execução | Resultado |
|---|---|
| `npm test` | 136/136 testes modernos + 137/137 legados = **273/273** |
| `npm run smoke` | **21/21** verificações HTTP reais locais (legado, push desligado) |
| `npm run check` | PASS: sintaxe da engine, gateway e contratos legados |
| `npm run demo:http` | 200 OK, `track` aceito pelo servidor HTTP local e registrado em memória |
| `npm run load:smoke` | 5.000 eventos sintéticos em memória, 20 duplicatas rejeitadas |
| Cobertura `node --experimental-test-coverage --test test/*.test.mjs` | **98,58% linhas**, **90,34% branches**, **93,32% funções** |

**Testes novos:** assinatura, payload adulterado, sujeito/tenant alterado, credencial errada, timestamps expirados/futuros, replay simultâneo, corpo excessivo, operação administrativa proibida, app inexistente, requisito de nonce persistente em prod, HTTPS de produção e contrato SQL do adapter Neon, além de um teste HTTP real.

**Limitações:** O npm registry apresentou EAI_AGAIN ao consultar `@neondatabase/serverless`. Não houve conexão HTTP/SDK ao Neon no runtime da máquina, teste de dispositivo com OneSignal, autorização de checkout nem analytics causal. Os testes de replay com banco foram realizados em versão anterior; **os testes novos v1.8 são locais e contratuais**.

Registros executáveis: `/mnt/data/TMNT_v18_FINAL_TEST.log`, `/mnt/data/TMNT_v18_FINAL_SMOKE.log`, `/mnt/data/TMNT_v18_FINAL_CHECK.log`, `/mnt/data/TMNT_v18_FINAL_COVERAGE.log`.
