# Relatório de testes v2.2 — 20/10/2026

- `npm test`: **329/329** (192 testes modernos e 137 legados).
- `npm run smoke`: **21/21 HTTP**, local, `DATABASE_URL` não configurada, real push desabilitado.
- `npm run check`: PASS.
- `npm run db:verify-install`: PASS (0000 a 0012).
- Neon QA (somente branch `<redacted>`): instalação do esquema vazio `tmnt_v22_clean_qa`, **27 tabelas, 36 funções**.
- Neon QA recém-instalado: app+eventos, meta 3, missão diária recompensada uma vez, reconciliação, streak 2, XP 35, tenant isolado.
- GitHub QA branches criadas em 6 apps; documentação de integração adicionada sem alterar a branch principal nem iniciar integração runtime.
- `@neondatabase/serverless` ausente neste runtime: Node SDK→Neon, TLS de produção e OneSignal físico não testados.

**Status:** Homologado para desenvolvimento e integração QA; não certificado para produção.

- 6 perfis QA específicos passaram nos testes: cadastro por app, valor, hábitos opcionais e push sem consentimento negado.
- 6 PRs GitHub em rascunho criadas para revisão documental, sem merge ou runtime deploy.
