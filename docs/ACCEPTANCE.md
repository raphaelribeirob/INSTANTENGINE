# TMNT Engine v1.7 — Critérios de aceite Duolingo + iFood

**Data:** 2026-10-20. Escopo: laboratório + SQL de homologação. `VERDE` significa teste automatizado ou SQL reproduzido; não equivale a 100% em produção. Base anterior v1.6 preservada.

| Requisito | Status | Evidência / pendência |
|---|---|---|
| Multiapp com módulos opcionais | VERDE QA | Mesma engine em DOTSVEST, CRM, marketplace, loja; sem dependência de Vercel |
| Streak, XP, meta, freeze e missões cooperativas | VERDE QA | Suíte legada e moderna; implantação nos clientes pendente |
| Notificações inteligentes: seleção adaptativa, limites, consentimento reminder | VERDE QA | Suíte de decisões e worker, OneSignal real pendente |
| Catálogo de ofertas do backend com preço/validade | VERDE QA | `publishOffer`, `listOffers`, schema Neon 0007; checkout precisa atestar valores |
| Cupom: uma compra/um benefício, estoque e concorrência | VERDE QA | SQL Neon com duas chamadas concorrentes e apenas um resgate |
| Economia realizada vinculada a checkout | VERDE QA | Ledger não conta pending; checkout simulado; webhook financeiro real pendente |
| Consentimento de marketing para oferta sugerida | VERDE QA | `in_app/marketing` segregado; envio de marketing push pendente |
| Feedback 0–10 após experiência concluída | VERDE QA | 0 e 10 aceitos, app-open não qualifica, SQL com dedup |
| Avaliação pública independente da nota | VERDE QA | Sem rating gating, trava 90d/2 ano e concorrência Neon; prompt em dispositivo pendente |
| Dados apagados por app/usuário | VERDE QA | Cascata SQL; preserva outra conta e estoque agregado |
| D1/D7/D30 de valor + recompra D30/D60/D90 | VERDE QA | análise local, view SQL; dados artificiais NÃO provam uplift |
| Limite/segurança em ambiente | VERDE QA | Worker de escopo da v1.6 preservado |
| Marketing push e canais transacionais dedicados | PENDENTE | Não ligar reminder com marketing; arquitetura separada ainda necessária |
| Horário ideal individual aprendido no núcleo universal | PARCIAL | Há dados/heurística, mas sem otimização de ponta a ponta |
| Jornada universal de conversão, assinaturas e cashback real | PARCIAL | Catálogo/ledger disponíveis; estado de checkout/assinatura real externo |
| Ligas/rankings públicos com antifraude | PENDENTE | Módulo social é cooperativo e opt-in, sem ranking público |
| Dependência `@neondatabase/serverless` instalada e testada com backend real | BLOQUEADO | Registry indisponível; SQL validado via ferramenta Neon independente |
| OneSignal em iOS, Android, Web com recebimento verificado | BLOQUEADO | Sem credenciais/dispositivos de teste; push desligado |
| PostHog ao vivo + impacto causal D1/D7/D30/recompra | BLOQUEADO | Sem amostra real e experimentos acompanhados |
| Pentest, políticas LGPD e testes de carga PostgreSQL | PENDENTE | Carga 5.000 eventos é apenas memória; sem homologação legal completa |

**Proibição de falso 10/10:** não afirmar que o gateway aplicou o desconto, que o sistema operacional exibiu uma avaliação, que o push chegou ao dispositivo, ou que a retenção aumentou apenas porque os contratos locais passaram. Não ativar produção.
