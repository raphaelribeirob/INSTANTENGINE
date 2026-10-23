# RIVERENGINE v2.9 — Critérios de aceite do observador Grokbot

Status **LAB/QA**; não significa que Grokbot já tenha acesso a um ambiente implantado.

| Critério | Resultado nesta versão |
|---|---|
| Adaptador universal exige prova de atividade concluída obtida no backend | PASS: 4 novos testes |
| A própria RIVERENGINE registra UUID idempotente, sujeito e escopo verificados | PASS: testes de adapter e SDK |
| Migração `0014`: outbox na mesma transação do evento real | PASS: trigger validado em Neon QA, branch isolada |
| Evento sem consentimento, abertura de aplicativo ou duplicação não cria job | PASS: Neon QA |
| Analytics histórico antes do consentimento não é disponibilizado | PASS: gatilho SQL estrito + contratos de consulta |
| Worker aplica novamente consentimento e pseudonimiza identificador | PASS: testes de unidade; envio real não executado |
| Worker mantém envio de produção desativado por padrão | PASS: código + execução de worker OFF |
| Grokbot API assinada e read-only | PASS: testes HMAC, escopo, replay, HTTP real |
| Amostras menores que 20 pessoas não aparecem como dados individuais | PASS: testes de supressão; modo analítico QA |
| Retenção D1/D7/D30 por primeira atividade verificada | PASS: SQL em QA sem coortes maduras; cálculo unitário |
| Métricas por variante e alertas de outbox | PASS: contratos SQL, amostra QA insuficiente |
| Regressão SDK, app bridge, legado, Python e smoke | PASS: 303 + 4 + 137 + 7 testes; 21 HTTP smoke |
| Integração do agente Grokbot no computador próprio com credenciais reais | **PENDENTE — não há acesso remoto à conta** |
| Coleta em todos os apps com eventos reais | **PENDENTE — cada app requer adaptador backend** |
| Entrega PostHog real, DNS/TLS, escalabilidade, IAM/RLS, LGPD real | **PENDENTE** |
| Rotina 24/7 com monitoramento, supervisão e alertas | **PENDENTE — executor/rotina externa não configurados** |
| Prova causal de melhora D7/D30 | **PENDENTE — sem experimento em usuários reais** |

Segurança: use contas SQL com privilégio mínimo, TLS, namespace isolado, segredos por app, rotação, limites de chamadas na borda, logging sem payload individual, expurgo de nonces/filas, operação de dead letters e revisão legal LGPD. A API não permite campanhas, configurações, notificações ou ações do Grokbot sobre usuários.
