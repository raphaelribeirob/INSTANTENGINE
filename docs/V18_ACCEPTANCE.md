# TMNT Engine v1.8 — aceite verificável

| Critério | Estado | Evidência |
|---|---|---|
| Preservar Duolingo + iFood v1.7 | VERDE | 259 testes anteriores passaram novamente |
| SDK neutro de hospedagem | VERDE | `src/integrations/http-gateway.mjs` sem framework, Node 22+ |
| Cliente e servidor HTTP de verdade | VERDE | teste `end-to-end actual Node HTTP server` e `npm run demo:http` |
| HMAC assina payload exato | VERDE | adulteração no JSON rejeitada com 401 |
| Isolamento de tenant/app/environment | VERDE | assinatura e parâmetros de escopo são obrigatoriamente vinculados à credencial |
| Usuário nunca muda via corpo não autorizado | VERDE | subject mismatch → 403; backend vincula sujeito à sessão |
| Replay e expiração | VERDE LOCAL | nonce repetido ou timestamp ±5 min → 409/401; teste concorrente local |
| Replay persistente Neon | CONTRATO | `claimRequest()` usa `r3_v1_claim_request`; não rodou driver real nesta rodada |
| Produção não aceita nonce em memória | VERDE | falha na inicialização da API |
| Produção exige TLS no assinador | VERDE | requisição HTTP prod rejeitada antes de enviar |
| Operações administrativas protegidas | VERDE | allowlist mínima por app; `eraseSubject`, `publishOffer`, `settleRedemption` ausentes por padrão |
| Limite de payload | VERDE | body 70 KiB → 413, nonce não gasto |
| Retrocompatibilidade | VERDE | 136 modernas + 137 legadas, 21 HTTP legados |
| Teste de carga sintético | VERDE LOCAL | 5.000 eventos inseridos em memória, 20 duplicados rejeitados |
| App real usando driver Neon | PENDENTE | `@neondatabase/serverless` sem instalação, `EAI_AGAIN` |
| Checkout real com reembolso/estorno | PENDENTE | nenhum gateway financeiro conectado |
| OneSignal iOS/Android/Web real | PENDENTE | nenhuma entrega confirmada em dispositivo |
| Retenção incremental de usuários | PENDENTE | experimento e coortes reais ausentes |
| Pentest, rate limit distribuído e rotação de chaves | PENDENTE | dependem de infraestrutura e revisão especializada |

Aprovação de laboratório não equivale a certificação de produção. Nenhuma implementação na conta de produção foi alterada.
