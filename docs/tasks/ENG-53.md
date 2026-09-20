# ENG-53 — Setup inicial do projeto

## Introdução

Configurar a base do backend de autenticação antes de qualquer feature de auth. Primeira task da sequência do backend (cadastro, login, sessão, senha), em ordem cronológica de implementação. O raciocínio e as decisões técnicas por trás de cada escolha ficam no documento "Decisões de Arquitetura do Backend de Autenticação".

## Requisitos técnicos

* Node.js + TypeScript, `strict: true` no `tsconfig.json`
* Fastify como framework HTTP
* Drizzle ORM + driver `postgres` (ou `pg`), conectado a um Postgres 15+
* Zod para validação de schemas (body/query/params dos endpoints)
* ESLint + Prettier (ou Biome como alternativa única, mais rápida e moderna, cobrindo lint e format em uma ferramenta só)
* Husky + lint-staged: hook de pre-commit rodando lint e type-check
* Variáveis de ambiente via `.env` + validação de schema das envs com Zod no startup (falha rápido se faltar variável obrigatória)
* Estrutura de pastas inicial separando `routes`, `db` (schema Drizzle), `services` e `config`

## Adendos do review (incorporados nesta task)

* Drizzle entra **só como infra**: pipeline de migration provado com tabela descartável e depois removido; a modelagem real começa do zero na próxima task
* Código 100% em inglês (testes, strings, mensagens); comentários apenas quando essenciais, em inglês e sucintos
* Sem fallback de `DATABASE_URL` no `drizzle.config.ts` — fail-fast com a mesma validação Zod do startup
* `tsconfig.json` estende a base oficial `@tsconfig/node24` (repo tsconfig/bases); typecheck dedicado (`tsconfig.typecheck.json`) cobrindo `tests/` e configs
* Graceful shutdown (`SIGINT`/`SIGTERM`) no server
* **Pre-commit revisado**: `pnpm typecheck` sai do hook (escala mal por commit); fica lint-staged + testes unitários. A barra de tipos migra para a CI
* **CI com GitHub Actions incorporada** (absorve a ENG-70): workflow em `pull_request` e push na `main` rodando install --frozen-lockfile, typecheck, lint, test e build, com Node 24 via `.nvmrc` e cache do pnpm; job plugado como required status check no ruleset da `main`; badge no README

## Definição de pronto

* Servidor Fastify sobe localmente com um comando documentado e responde `200` num endpoint de healthcheck (`GET /health`)
* `tsc --noEmit` passa com `strict: true`
* Lint e format rodam sem erros; o hook de pre-commit bloqueia commits com erro de lint ou teste quebrado; erro de tipo é bloqueado pela CI
* Startup falha rápido, com mensagem clara, quando uma variável de ambiente obrigatória está ausente ou inválida
* Drizzle conecta no Postgres 15+ e o pipeline de migration foi provado (registro nos comentários/PR)
* Estrutura de pastas (`routes`, `db`, `services`, `config`) criada, com um README curto explicando como rodar o projeto
* CI verde obrigatória para merge na `main`
