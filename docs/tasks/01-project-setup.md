# 01. Project setup

## Introdução

Todo backend de autenticação começa com decisões que parecem burocráticas e depois definem o resto: qual runtime, qual ORM, o que roda antes de cada commit, o que acontece quando falta uma variável de ambiente. Esta etapa monta essa base e deixa o esqueleto pronto para receber a primeira regra de negócio.

A ideia central é falhar cedo e em voz alta. Se o ambiente está incompleto, o processo nem sobe. Se o tipo está errado, a CI barra. Se o código está fora do padrão, o commit não passa. Nada disso vira responsabilidade de quem revisa a PR depois.

Ao final desta etapa existe um servidor HTTP que responde um healthcheck, conversa com um Postgres local e tem pipeline de qualidade fechado, sem nenhuma rota de autenticação ainda.

## Requisitos técnicos

### Runtime e gerenciador de pacotes

* Node 24, fixado em `.nvmrc` e `.tool-versions` para que nvm e mise leiam o mesmo valor
* pnpm gerenciado por corepack e pinado no campo `packageManager` do `package.json`, de modo que todo mundo (e a CI) use exatamente a mesma versão
* `pnpm-workspace.yaml` precisa listar as dependências com build nativo em `allowBuilds`, hoje `argon2` e `esbuild`. O pnpm recente bloqueia scripts de build por padrão, então sem esse allowlist o argon2 instala sem compilar e quebra só em runtime

### TypeScript

* `tsconfig.json` estende `@tsconfig/node24`, que já traz `strict: true` e o alvo correto para o runtime, em vez de replicar flags à mão
* Sobre essa base, quatro flags que valem o incômodo: `noUncheckedIndexedAccess` (acesso por índice devolve `T | undefined`), `exactOptionalPropertyTypes` (distingue ausente de `undefined`), `verbatimModuleSyntax` (imports de tipo explícitos) e `forceConsistentCasingInFileNames`
* Um segundo arquivo, `tsconfig.typecheck.json`, estende o primeiro com `noEmit` e amplia o `include` para `tests`, `vitest.config.ts` e `drizzle.config.ts`. O motivo é que o build só deve compilar `src`, mas a verificação de tipos precisa cobrir testes e arquivos de configuração também

### Servidor HTTP

* Fastify 5 com logger habilitado
* Type provider do Zod (`fastify-type-provider-zod`) ligando schema, validação de runtime e tipagem estática no mesmo lugar, sem declarar o contrato duas vezes
* OpenAPI gerado a partir dos próprios schemas via `@fastify/swagger`, e a interface `/docs` registrada apenas quando `NODE_ENV` não é `production`
* `GET /health` respondendo `{"status":"ok"}`, que serve de alvo para orquestrador e para o primeiro teste do projeto
* Desligamento gracioso: `SIGINT` e `SIGTERM` registrados com `process.once` chamam `app.close()` antes de encerrar, para conexões em voo terminarem

### Banco e migrations

* Postgres 16 e Mailpit subindo por `docker-compose.yml`, com healthcheck `pg_isready` no Postgres para o compose saber quando o banco está de fato pronto
* Drizzle ORM com o driver `postgres`, e drizzle-kit gerando migrations a partir do schema (`pnpm db:generate`, `pnpm db:migrate`)
* O `drizzle.config.ts` importa a mesma função de carregamento de ambiente da aplicação, sem valor padrão para `DATABASE_URL`. Um fallback silencioso ali é como uma ferramenta de migration aponta para o banco errado

### Configuração de ambiente

* Schema Zod validando as variáveis no boot, dentro de `src/config/env.ts`, e o processo encerra com código 1 listando cada variável inválida quando algo falta
* O carregamento usa `process.loadEnvFile`, nativo do Node, então o projeto não precisa de `dotenv`
* O schema é construído em função do ambiente cru, o que permite exigências condicionais: `PORT` é obrigatória em produção mas tem padrão 3000 fora dela, `EMAIL_FROM` é exigida a menos que o driver seja `fake`, e `RESEND_API_KEY` só é exigida quando o driver é `resend`
* `.env` e `.env.*` no `.gitignore`, com um `.env.sample` versionado de valores vazios servindo de documentação

### Qualidade e automação

* Biome no lugar de ESLint e Prettier, cobrindo lint e formatação numa ferramenta só, com `vcs.useIgnoreFile` para respeitar o `.gitignore`
* Vitest como runner, com `include` apontando para `tests/**/*.test.ts`
* Husky com hook de pre-commit rodando `pnpm lint-staged && pnpm test`. O typecheck completo ficou deliberadamente fora do hook, porque `tsc` inteiro a cada commit é lento o bastante para as pessoas começarem a usar `--no-verify`, e aí o hook inteiro perde o valor
* A barra de tipos vive na CI: workflow do GitHub Actions em `pull_request` e push na `main` rodando `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test` e `build`, com Node lido do `.nvmrc` e cache do store do pnpm
* Badge do workflow no README

### Configuração do repositório no GitHub

Vale aplicar antes da primeira PR, porque é barato agora e caro depois. Um segredo commitado, por exemplo, exige reescrever histórico e rotacionar a chave.

* Secret scanning e push protection ativos, de modo que um token real seja barrado no `push` em vez de ser publicado
* Dependabot security updates ativo, junto com os vulnerability alerts que são pré-requisito dele
* Ruleset na branch padrão exigindo pull request, com squash como único método de merge, o check da CI obrigatório e bloqueio de deleção e de force-push
* Em Settings, apenas squash and merge habilitado, com remoção automática da branch após o merge
* Labels `feature`, `fix` e `documentation` criadas para classificar as PRs

### Estrutura de pastas

```
src/
  config/    validação de ambiente
  db/        schema Drizzle, client e repositórios
  lib/       utilitários puros (hash, tokens, OTP)
  routes/    plugins Fastify, camada fina de HTTP
  services/  regras de negócio, testáveis sem Fastify
tests/       espelha a árvore de src/
```

## Definition of done

* `pnpm dev` sobe o servidor e `GET /health` responde `200` com `{"status":"ok"}`
* `pnpm typecheck` passa cobrindo `src`, `tests` e os arquivos de configuração
* `pnpm lint` passa sem erros, e `pnpm format` aplica as correções
* O hook de pre-commit bloqueia commit com erro de lint ou teste quebrado
* Faltando qualquer variável obrigatória, o processo encerra com mensagem nomeando a variável e o motivo
* `docker compose up -d` sobe Postgres e Mailpit, e `pnpm db:migrate` aplica as migrations
* A CI roda em toda PR e está plugada como check obrigatório na branch padrão
* README documenta pré-requisitos, setup e scripts disponíveis
