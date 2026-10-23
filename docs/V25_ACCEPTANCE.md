# RIVERENGINE 2.5 — Critérios A/B PostHog

- [x] SDK com cliente PostHog server-side e `evaluateFlags(...).getFlag()`.
- [x] Não consulta flags com engine desligada, ausência de consentimento ou módulo analytics desabilitado.
- [x] Consentimento verificado gravado, revogável e isolado por tenant/app/environment.
- [x] Variantes e identificadores validados, controle seguro em falha externa.
- [x] Variante persistida, idempotência contra mudança posterior da flag.
- [x] Conversões somente com evento de valor real registrado após exposição.
- [x] Bloqueio de duplicatas e atribuição por `$feature/<flag>`.
- [x] HMAC pseudonimizado e sem exposição de IDs brutos.
- [x] Migração SQL 0013 instalada no Neon QA e testes funcionais aprovados.
- [x] Compatibilidade da engine e worker preservada: 359 testes verdes + 21 HTTP.
- [ ] PostHog com feature flag real, análise de métricas e resultados reais.
- [ ] Outbox durável de telemetria e reconciliação de exposições órfãs.
- [ ] SDK instalado em backend implantado, identidade real e TLS verificados.
- [ ] Experimentos estatísticos medidos D1/D7/D30 com consentimento e usuários reais.

**Segurança:** ativação controlada por `RIVERENGINE_AB_ENABLED=false` e `RIVERENGINE_AB_ALLOW_PROD=false` por padrão.
