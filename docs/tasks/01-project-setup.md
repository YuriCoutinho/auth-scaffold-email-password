# 01. Project setup

## Introdução

Todo backend de autenticação começa com decisões que parecem burocráticas e depois definem o resto: qual runtime, qual ORM, como o código se organiza, o que roda antes de cada commit, o que acontece quando falta uma variável de ambiente ou quando uma rota lança um erro inesperado. Esta etapa monta essa base e deixa o esqueleto pronto para receber a primeira regra de negócio.

A ideia central é falhar cedo e em voz alta, mas sem vazar nada para fora. Se o ambiente está incompleto, o processo nem sobe. Se o tipo está errado, a CI barra. Se o código está fora do padrão, o commit não passa. Se uma rota estoura, o cliente recebe uma resposta genérica e o detalhe fica no log. Nada disso vira responsabilidade de quem revisa a PR depois.

A organização do código segue a arquitetura de plugins do Fastify, no formato do repositório oficial `fastify/demo`. Adotar isso desde o primeiro dia evita a refatoração que quase todo projeto Fastify acaba fazendo depois, quando a fiação manual de dependências em `app.ts` cresce a cada endpoint e a pasta `services/` passa a guardar regra de negócio e adaptador externo ao mesmo tempo.

Ao final desta etapa existe um servidor HTTP que responde um healthcheck, conversa com um Postgres local, esconde erros internos e tem pipeline de qualidade fechado, sem nenhuma rota de autenticação ainda.

## Requisitos técnicos

### Runtime e gerenciador de pacotes

* Node 24, fixado em `.nvmrc` e `.tool-versions` para que nvm e mise leiam o mesmo valor
* pnpm gerenciado por corepack e pinado no campo `packageManager` do `package.json`, de modo que todo mundo (e a CI) use exatamente a mesma versão
* `pnpm-workspace.yaml` precisa listar as dependências com build nativo em `allowBuilds`, hoje `argon2` e `esbuild`. O pnpm recente bloqueia scripts de build por padrão, então sem esse allowlist o argon2 instala sem compilar e quebra só em runtime

### TypeScript

* `tsconfig.json` estende `@tsconfig/node24`, que já traz `strict: true` e o alvo correto para o runtime, em vez de replicar flags à mão
* Sobre essa base, quatro flags que valem o incômodo: `noUncheckedIndexedAccess` (acesso por índice devolve `T | undefined`), `exactOptionalPropertyTypes` (distingue ausente de `undefined`), `verbatimModuleSyntax` (imports de tipo explícitos) e `forceConsistentCasingInFileNames`
* Um segundo arquivo, `tsconfig.typecheck.json`, estende o primeiro com `noEmit` e amplia o `include` para `tests`, `vitest.config.ts` e `drizzle.config.ts`. O motivo é que o build só deve compilar `src`, mas a verificação de tipos precisa cobrir testes e arquivos de configuração também
* O projeto é ESM (`"type": "module"`), e os imports relativos usam a extensão `.js` mesmo apontando para arquivos `.ts`, porque é assim que o Node resolve o código compilado em `dist/`

### Arquitetura de plugins do Fastify

Os guias do fastify.dev não prescrevem layout de pastas, mas o `fastify-cli generate` e o repositório `fastify/demo` convergem num formato concreto, e é ele que o projeto adota.

* `src/app.ts` exporta duas coisas. A primeira é o plugin `app`, envolto em `fastify-plugin`, que registra `@fastify/autoload` três vezes, em ordem e esperando cada uma terminar: `plugins/external`, `plugins/app` e `routes`. A segunda é `buildApp(opts)`, que cria a instância Fastify, liga o type provider do Zod e registra o plugin `app`. Envolver o plugin raiz em `fastify-plugin` é o que faz decorators do ecossistema, como `app.swagger()`, chegarem até a instância que `buildApp` devolve e que os testes injetam
* `src/plugins/external/` guarda os plugins do ecossistema. Um arquivo que só faz `export default cookie` já basta, e quando o plugin precisa de opções elas vão numa exportação `autoConfig`, que o autoload lê e repassa
* `src/plugins/app/` guarda os plugins da aplicação. Cada um decora a instância com uma capacidade (`fastify.db`, `fastify.emailSender`, `fastify.auth`, `fastify.sessions`) e declara o tipo dessa capacidade com declaration merging em `FastifyInstance`, dentro do próprio arquivo. Quem usa a capacidade não importa nada, só lê da instância
* Plugin de um arquivo só fica na raiz de `plugins/app`. Plugin com implementação interna vira uma pasta com `index.ts`, e os arquivos irmãos são detalhes dele. Isso funciona porque o autoload, ao encontrar um `index.ts` numa pasta, carrega só ele e não desce nos irmãos, então a implementação pode ter nomes curtos (`auth/repository.ts`, `email/sender.ts`) sem virar plugin por acidente. É o mesmo arranjo do `fastify/demo`, que guarda `tasks-repository.ts` dentro de `plugins/app/tasks/`
* Código próprio que uma rota consome mora em `plugins/app`, inclusive adaptadores de infraestrutura como drivers de email e repositórios sobre o ORM. O `fastify/demo` não tem pasta `services/`, `db/` nem `lib/`: tudo que não é rota nem schema é plugin. O projeto abre uma única exceção, `lib/`, para função pura sem colaborador, porque não há o que injetar nela
* Todo plugin de aplicação passa por `fastify-plugin` com `name` e, quando depende de outro, `dependencies`. É isso que garante a ordem de carga dentro de uma pasta, e não prefixo numérico no nome do arquivo. Sem `fastify-plugin` o Fastify encapsula o plugin, e o decorator não sai dele
* `src/routes/` guarda os plugins de rota. O autoload usa o nome da pasta como prefixo, então `routes/auth/signup.ts` registrando `app.post("/signup")` fica em `/auth/signup`, e `routes/health.ts` fica em `/health`. A rota não sabe o próprio prefixo, o que permite mover um grupo inteiro de rotas mudando uma pasta
* A camada de rota é fina: valida com o schema, chama o decorator do domínio e monta a resposta. Regra de negócio vive no plugin de aplicação correspondente, em funções que recebem as dependências como parâmetro e por isso são testáveis sem subir Fastify
* `src/schemas/` guarda os schemas Zod compartilhados pelas rotas, `src/db/` guarda apenas o schema Drizzle e a fábrica de conexão, `src/lib/` guarda apenas funções puras, e `src/config/` guarda a validação de ambiente

### Injeção de dependências por `AppOptions`

```ts
export interface AppOptions {
  config: Env;
  authRepository?: AuthRepository;
  sessionRepository?: SessionRepository;
  emailSender?: EmailSender;
  checkPwnedPassword?: CheckPwnedPassword;
}
```

* O autoload repassa as opções de `buildApp` a todo plugin, então cada um lê de `opts.config` o que precisa, sem um plugin de configuração decorando a instância
* `config` é o único campo obrigatório. Cada colaborador é opcional porque o plugin dono dele sabe montar a implementação real a partir de `config`, e só os testes precisam substituí-lo
* Essa é a costura de teste do projeto inteiro: um teste de rota chama `buildApp` passando um repositório em memória e um remetente de email falso, e exercita a aplicação completa com `app.inject`, sem banco e sem rede. Nenhum plugin tem condicional do tipo "se for teste, pule o banco"

### Servidor HTTP

* Fastify 5 com logger habilitado
* Type provider do Zod (`fastify-type-provider-zod`) ligando schema, validação de runtime e tipagem estática no mesmo lugar, sem declarar o contrato duas vezes. `buildApp` registra o `validatorCompiler` e o `serializerCompiler`, e cada arquivo de rota tipa o plugin como `FastifyPluginAsyncZod` para que `request.body` saia tipado do schema
* OpenAPI gerado a partir dos próprios schemas via `@fastify/swagger`, registrado em `plugins/external/swagger.ts` com `jsonSchemaTransform` na `autoConfig`. A interface `/docs` fica em `plugins/external/swagger-ui.ts`, declara `dependencies: ["@fastify/swagger"]` e só registra o plugin quando `NODE_ENV` não é `production`. A decisão de ligar ou não a UI fica dentro do próprio plugin, não no bootstrap
* `GET /health` respondendo `{"status":"ok"}`, que serve de alvo para orquestrador e para o primeiro teste do projeto

### Error handler global

* Um plugin de aplicação, `plugins/app/error-handler.ts`, registra `setErrorHandler` na instância. Ele entra nesta etapa, e não depois, porque o handler padrão do Fastify devolve `error.message` no corpo da resposta inclusive para erros 500. Numa API de autenticação isso significa que uma falha de conexão com o banco ou uma resposta inesperada do provedor de email chega ao cliente com a string interna, e essa string frequentemente carrega host, nome de tabela ou trecho de credencial
* Erro com `statusCode` a partir de 500, ou sem `statusCode`, é logado com o objeto de erro completo e respondido como `500` com `{ "message": "Internal Server Error" }`, sem nenhum dado do erro original
* Erro abaixo de 500 mantém status e mensagem, porque são erros que a aplicação escolheu devolver: a validação do schema Zod responde `400` descrevendo o formato do campo, e isso não fere o anti-enumeração porque fala do que foi enviado e nunca da existência de conta
* O formato `{ message }` é o mesmo dos schemas de resposta de erro das rotas, então o OpenAPI continua descrevendo o que o cliente de fato recebe
* O plugin não declara `dependencies` e por isso pode ser carregado em qualquer ordem dentro de `plugins/app`. Como todo plugin da pasta passa por `fastify-plugin`, o handler vale para todas as rotas registradas depois

### Ponto de entrada

* `server.ts` faz quatro coisas, como no `fastify/demo`: carrega o ambiente validado, cria a instância com `buildApp({ config })`, arma o desligamento com `close-with-grace` e chama `listen`. Banco, repositório e remetente de email não aparecem ali, porque cada plugin é dono do ciclo de vida do que cria
* O plugin `database.ts` abre o pool a partir de `config.DATABASE_URL`, decora `fastify.db` e registra o `onClose` que fecha o pool. Assim `app.close()` encerra tudo que a aplicação abriu, e um teste que chama `buildApp` e depois `close` não deixa handle pendurado
* O desligamento usa `close-with-grace` em vez de `process.once` feito à mão, porque a versão manual não tem timeout: um pool travado no `close` deixaria o processo pendurado para sempre. Com ESM em Node 24 o arquivo usa `await` no nível superior, então um ambiente inválido lançado por `loadEnv()` encerra o processo com código 1 e a mensagem do Zod, sem `try` nem `process.exit` explícitos

### Banco e migrations

* Postgres 16 e Mailpit subindo por `docker-compose.yml`, com healthcheck `pg_isready` no Postgres para o compose saber quando o banco está de fato pronto
* Drizzle ORM com o driver `postgres`, e drizzle-kit gerando migrations a partir do schema (`pnpm db:generate`, `pnpm db:migrate`)
* `src/db/client.ts` expõe apenas `createDatabase(url)`, que devolve `{ db, close }`. O módulo não abre conexão no import nem lê o ambiente sozinho, porque isso tornaria impossível importar qualquer coisa de `db/` num teste sem um Postgres de pé
* O `drizzle.config.ts` importa a mesma função de carregamento de ambiente da aplicação, sem valor padrão para `DATABASE_URL`. Um fallback silencioso ali é como uma ferramenta de migration aponta para o banco errado

### Configuração de ambiente

* Schema Zod validando as variáveis no boot, dentro de `src/config/env.ts`, e o processo encerra com código 1 listando cada variável inválida quando algo falta
* O carregamento usa `process.loadEnvFile`, nativo do Node, então o projeto não precisa de `dotenv`
* O schema é construído em função do ambiente cru, o que permite exigências condicionais: `PORT` é obrigatória em produção mas tem padrão 3000 fora dela, `EMAIL_FROM` é exigida a menos que o driver seja `fake`, e `RESEND_API_KEY` só é exigida quando o driver é `resend`
* Nenhuma fonte oficial do Fastify exige `@fastify/env`, então a validação fica numa função pura, que `server.ts` e `drizzle.config.ts` chamam do mesmo jeito
* `.env` e `.env.*` no `.gitignore`, com um `.env.sample` versionado servindo de documentação: valores locais de desenvolvimento preenchidos e toda chave de serviço externo vazia

### Qualidade e automação

* Biome no lugar de ESLint e Prettier, cobrindo lint e formatação numa ferramenta só, com `vcs.useIgnoreFile` para respeitar o `.gitignore`
* Vitest como runner, com `include` apontando para `tests/**/*.test.ts`, e `tests/` espelhando a árvore de `src/`
* O Vitest precisa de `server.deps.inline: ["@fastify/autoload"]`. Sem isso, o `import()` dinâmico que o autoload faz para carregar cada plugin roda fora do processamento do Vite, e nesse caminho o Node não resolve um especificador `./x.js` para o arquivo fonte `./x.ts`. Rodando com `tsx` ou contra o `dist/` compilado o problema não aparece, porque nos dois casos o `.js` corresponde a um arquivo real no disco
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
  app.ts               plugin `app` com três autoloads, e buildApp(opts)
  app-options.ts       interface AppOptions
  server.ts            loadEnv, buildApp, close-with-grace, listen
  config/              validação de ambiente com Zod
  db/                  schema Drizzle e createDatabase
  lib/                 funções puras: hash, tokens, código
  plugins/
    external/          cookie, swagger, swagger-ui
    app/
      database.ts      decora fastify.db
      error-handler.ts setErrorHandler
      pwned-password/  index.ts decora fastify.checkPwnedPassword; checker.ts
      email/           index.ts decora fastify.emailSender; sender.ts, create-sender.ts, drivers/
      auth/            index.ts decora fastify.auth; repository.ts, drizzle-repository.ts, services, emails/
      sessions/        index.ts decora fastify.sessions; repository.ts, drizzle-repository.ts, services
  routes/              plugins de rota, prefixo pelo nome da pasta
  schemas/             schemas Zod compartilhados pelas rotas
tests/                 espelha src/, mais helpers/ com app-options.ts e auth/in-memory-repository.ts, que satisfaz as duas portas
```

## Definition of done

* `pnpm dev` sobe o servidor e `GET /health` responde `200` com `{"status":"ok"}`
* Uma rota que lança um erro sem `statusCode` responde `500` com `{"message":"Internal Server Error"}`, a mensagem original aparece só no log, e um erro com `statusCode` abaixo de 500 mantém status e mensagem
* `buildApp` aceita substituir os colaboradores externos por `AppOptions`, e o teste do healthcheck roda sem Postgres nem rede
* `app.close()` fecha o pool do banco, verificável pelo `onClose` do plugin `database`
* `pnpm typecheck` passa cobrindo `src`, `tests` e os arquivos de configuração
* `pnpm lint` passa sem erros, e `pnpm format` aplica as correções
* O hook de pre-commit bloqueia commit com erro de lint ou teste quebrado
* Faltando qualquer variável obrigatória, o processo encerra com mensagem nomeando a variável e o motivo
* `docker compose up -d` sobe Postgres e Mailpit, e `pnpm db:migrate` aplica as migrations
* A CI roda em toda PR e está plugada como check obrigatório na branch padrão
* README documenta pré-requisitos, setup, scripts disponíveis e a estrutura de pastas
