# RIVERENGINE v2.8 — Aceite da integração open source

**Escopo:** retenção Duolingo-style, telemetria confiável com Graphile, aprendizagem offline com MABWiser e avaliação com Statsmodels. Nenhum envio push, treinamento automático com dados reais ou ativação em produção.

| Critério | Prova | Estado |
|---|---|---|
| SDK v2.7 permanece compatível | testes modernos + app de estudos + legados | PASSOU em laboratório |
| Enfileirar referência scoped UUID, sem identificador pessoal | mock Graphile Worker com verificação de payload | PASSOU em laboratório |
| Revalidar evento de valor e consentimento antes do PostHog | tarefas Graphile testadas | PASSOU em laboratório |
| Produção desabilitada por padrão | flag de QA e task production guard | PASSOU em laboratório |
| Falha HTTP causa retry, não confirmação falsa | testes de Graphile tasks | PASSOU em laboratório |
| `$insert_id` idempotente e `distinct_id` HMAC | teste de payload PostHog | PASSOU em laboratório |
| Política MABWiser sugerir variante, nunca furar consentimento/fadiga | testes integrados via memory repo | PASSOU em laboratório |
| Política `no_send` e assinatura / validade / escopo | testes de integridade | PASSOU em laboratório |
| Statsmodels CI/SRM, sem lançamento automático | testes Python + cálculos reais | PASSOU em laboratório |
| PostgreSQL nativo com Graphile Worker/Neon de QA | banco TCP não disponível + pacote ausente | PENDENTE |
| MABWiser instalado e treinado | dependência não disponível neste ambiente | PENDENTE |
| Outbox transacional entre evento e job | ainda não implementado | PENDENTE |
| PostHog real, ingestão, consumo/retry e LGPD | credenciais e infraestrutura ausentes | PENDENTE |
| Experimentos D1/D7/D30 com usuários e holdout | sem dados reais | PENDENTE |

## Política operacional

A fila Graphile trata **telemetria analítica**. O envio push mantém o worker existente da RIVERENGINE; não há dois emissores de push. Sem consentimento persistido, sinal validado ou configuração explícita, *não enviar*. O modelo MABWiser é somente consultivo, pós-elegibilidade, com artefato assinado e aprovação humana. `no_send` está sempre disponível como opção segura.

## Caveats

- Retries do Graphile são pelo menos uma vez, não exactly-once.
- A escrita de atividade e a chamada de agendamento da telemetria ainda não são atômicas; reconciliação ou outbox transacional é necessária para não perder eventos após crash.
- Statsmodels oferece inferência **nominal de horizonte fixo**; correção de múltiplas hipóteses e monitoramento sequencial dependem de plano estatístico específico.
- Resultado sintético não é retenção real; UI, backend implantado e dispositivos ainda não homologados.
