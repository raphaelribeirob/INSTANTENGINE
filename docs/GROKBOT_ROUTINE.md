# Rotina Grokbot — Analista RIVERENGINE

Use a funcionalidade de **routines** do Grokbot no próprio ambiente dele. Este repositório NÃO cria ou ativa uma rotina externa.

## Instrução para o agente

Observe o estado de retenção dos aplicativos R3 usando apenas o skill `riverengine-retention-observer`. Em cada execução, faça `catalog`, `overview 14`, `pipeline`, `retention`, `diagnose`; consulte `experiment <flag>` somente quando existir experimento pré-aprovado. Apresente qualidade da instrumentação, data de observação, D1/D7/D30 com maturidade, amostras suprimidas, variações relevantes e backlog. Não infira causalidade a partir de variações observacionais. Proponha no máximo um experimento principal por aplicativo e entregue critérios de sucesso, holdout e riscos. **Não mude campanhas, flags, consentimento, notificações, checkout nem execute ações externas.** Peça revisão humana.

## Instalação na máquina do agente

- Transfira os arquivos `agents/grokbot/` e o cliente assinado em um diretório seguro do computador Grokbot. Garanta Node 22+ e saída à URL HTTPS da API do observador.
- Crie um *secret* independente por `tenant/app/environment`; salve `RIVER_OBSERVER_BASE_URL`, `RIVER_OBSERVER_SCOPE`, `RIVER_OBSERVER_SIGNING_SECRET` no cofre do executor, e nunca em prompt ou modelo. Para observar vários apps, use perfis de credencial separados.
- Configure uma rotina periódica com o agendador do Grokbot (por exemplo, resumo diário em horário escolhido pelo proprietário). A primeira execução precisa ser inspecionada manualmente; só depois habilite a rotina.
- Ative alertas para erros HTTP, schema desatualizado e dead-letter. O executor real deve impor rate limit, logs redigidos, proibição de comando arbitrário e permissões de sistema mínimos.

**Estado:** artefato de skill pronto; precisa ser instalado e autorizado na conta real antes de existir observação recorrente.
