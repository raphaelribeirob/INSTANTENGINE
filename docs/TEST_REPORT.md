# TMNT Engine v1.7 — Relatório de teste (20/10/2026)

## Evidências locais

- `npm test`: 122/122 testes modernos + 137/137 legados = **259/259 aprovados**; nenhum falhou.
- `npm run smoke`: **21/21** verificações HTTP locais; sem banco conectado; push desativado.
- `npm run check`: **PASS**.
- `node --experimental-test-coverage --test test/*.test.mjs`: **98,66% linhas, 91,11% ramificações, 93,03% funções** na suíte moderna.
- `npm run load:smoke`: **5.000 eventos sintéticos em memória**, 20 duplicatas rejeitadas; não é benchmark PostgreSQL.
- `npm run demo:multiapp`: passou.
- `npm run demo:duolingo-ifood`: passou em DOTSVEST (streak 2) e loja (desconto confirmado simulado e pesquisa nota zero).
- `@neondatabase/serverless`: **não instalado**, `ERR_MODULE_NOT_FOUND`, portanto nenhum E2E Node -> Neon foi demonstrado.

## Neon PostgreSQL (ramificação isolada, banco principal preservado)

- Migração SQL `0007_commerce_feedback.sql`: 16 comandos aprovados em transação.
- Migração SQL `0008_repurchase_reporting.sql`: view criada e consultada.
- Oferta válida criada; oferta com desconto maior que preço rejeitada.
- Oferta personalizada sem opt-in `in_app/marketing` não exibida; descoberta explícita não envia marketing.
- Compra simulada registrada via evento de valor; mera abertura de app não resgatou.
- Cupom com estoque 1: duas requisições concorrentes produziram exatamente um resgate; estoque permaneceu 1/1.
- Tentativas de re-resgate e desconto maior que o permitido rejeitadas; economia BRL 4500 centavos computada somente depois da liquidação simulada (nenhum pagamento real).
- Feedback de 0 e de 10 aceitos; feedback duplicado e sem evento de valor rejeitados.
- Duas solicitações simultâneas de avaliação produziram um único registro.
- Exclusão de usuário removeu eventos e feedback e preservou os de outro usuário.
- View de recompra: coorte SINTÉTICA demonstrou contagens por tratamento/controle em D30/D60/D90; nenhum ganho de produto/causalidade é inferível de N=1.

## Limites

Não há envio de push real, checkout/gateway real, cliente móvel ligado, credenciais PostHog ativas, dados de retenção de usuários ou testes de carga do banco. O sucesso corresponde à homologação dos contratos implementados, **não** à conclusão de todos os critérios de produção.
