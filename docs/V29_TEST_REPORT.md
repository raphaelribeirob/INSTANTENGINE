# Relatório de QA — RIVERENGINE 2.9 / Grokbot Observer

Data: 2026-10-21. Fonte-base: RIVERENGINE 2.8, alterada somente nesta cópia de trabalho.

## Resultados

- **303/303** testes Node modernos (incluindo o Grokbot Observer API, client HTTP, app instrumentation, SQL contracts e outbox), 0 falhas.
- **4/4** testes do adaptador InstantStudy anterior, 0 falhas.
- **137/137** testes legados R3ENGINE, 0 falhas.
- **7/7** testes Python Statsmodels/bandit offline, 0 falhas.
- **Total 451/451** em suites automatizadas. **21/21** verificações smoke HTTP legadas, sem banco real e sem push.
- `npm run db:verify-install`: **15/15** migrações `0000`–`0014`; ordem e marcadores aprovados.
- Cliente Grokbot verificado com `http.createServer()` real localmente; assinatura, nonce replay e escopo preservados.

## Neon QA — evidências

Projeto: branch de QA isolada preexistente. **Não** utilizar a branch principal.

- A migração SQL `0014` foi aplicada em esquema QA isolado `tmnt_v22_clean_qa` com sucesso; 1 tabela e 1 trigger criados.
- O gatilho foi revalidado com consentimento **anterior à transação do evento**.
- Um evento `app_opened` não criou outbox. Uma atividade antes de consentimento não criou outbox. Evento com consentimento válido criou **1 job pendente**. Repetição UUID idêntico não criou duplicata. Outro sujeito sem consentimento não criou job.
- Consulta SQL de overview restrita a consentidos apresentou 1 usuário sintético e 1 evento elegível; o Grokbot receberia supressão por limiar mínimo de 20. Sem coortes D1/D7/D30 maduras disponíveis neste teste.

## Segurança e limitações

- Migração verificada em QA real; não se testou execução do `@neondatabase/serverless` **dentro** de backend implantado com HTTPS/TLS real, nem envio PostHog real.
- Nenhuma rotina Grokbot real foi instalada; a skill e o CLI são artefatos prontos para configurar no ambiente do agente.
- Outbox tem semantics **at-least-once**; HTTP 2xx do PostHog é aceite, não prova de processamento. `$insert_id` HMAC estável é obrigatório.
- Política mínima: 20 usuários por célula. As métricas suprimidas retornam `null`, nunca zeros inventados.
- Treino MABWiser/Graphile Worker continua opcional e não foi homologado como serviço externo.
- Performance com grande volume, isolamento IAM/RLS, manipulação de múltiplos apps e alertas de fila não foram validados em produção.
