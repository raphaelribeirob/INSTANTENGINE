# Integração segura da TMNT Engine v1.7

1. Implantar o pacote em um **backend confiável**. Não colocar segredos nem o SDK administrativo no app cliente.
2. Migrar uma ramificação isolada do PostgreSQL com `0001`–`0008`. Testar `r3_v1_publish_offer`, `r3_v1_redeem_offer`, `r3_v1_settle_redemption` e `r3_v1_record_feedback` antes de migrar ambiente final.
3. Instalar `@neondatabase/serverless` e confirmar `import()` antes de ativar o adaptador Node Neon. O driver **não estava disponível** neste ambiente.
4. Registrar cada app com eventos de valor corretos, `modules` específicos e escopos isolados. Os exemplos devem manter push desligado.
5. Conectar checkout autenticado: validar SKU, preço, estoque, transação e webhook do processador no servidor. Só depois chamar `track(purchase_completed)`, `redeemOffer` e `settleRedemption` com recibo auditável e desconto efetivo. Não confiar em preço ou recibo enviado pelo usuário.
6. Para **navegação explícita**, usar `listOffers`; para **sugestão personalizada**, obter consentimento verificado `in_app/marketing`. Não enviar cupom em canal push pelo scheduler de reminders.
7. Solicitar feedback somente após evento de valor real. Não filtrar avaliação pública pela nota. Chamar API nativa de loja apenas quando elegível, respeitando retorno do sistema.
8. Executar ensaios reais OneSignal, Android, iOS e Web, revogação de consentimento, carga, monitoramento, rollback, exclusão LGPD e experimentos randomizados antes de promover a produção.
9. Revisar limites/cooldowns, tratamento de fraude, estornos, cancelamentos, preços, tributos e políticas de cashback do app comercial, pois estes ainda não são providos pela engine.
