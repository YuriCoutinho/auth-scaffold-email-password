# 09. Fastify plugin architecture

## Introdução

A estrutura em camadas que o projeto vinha usando tinha a direção de dependência correta, mas o padrão nunca foi nomeado e não correspondia ao que a comunidade Fastify pratica. `services/` guardava regra de negócio e adaptador externo ao mesmo tempo, `lib/` misturava função pura com um módulo que faz HTTP, `db/client.ts` abria o pool e relia o ambiente no próprio import, e a fiação de dependências crescia manualmente em `app.ts` a cada endpoint novo.

Havia um atrito mais grave, e menos visível que os anteriores: o falso de banco em `tests/helpers/` imitava a cadeia fluente do Drizzle, com `select().from().where().limit()` encadeados. Os testes de rota atravessavam a interface do repositório e acabavam testando a implementação dela. Qualquer refatoração de query quebrava testes de rota que nunca afirmaram nada sobre SQL, porque a costura estava no lugar errado: existia um adaptador só, o real, e o falso reconstruía o ORM por baixo dele.

A revisão das fontes oficiais do Fastify mostrou o caminho. Os guias do fastify.dev não prescrevem layout de pastas, mas o `fastify-cli generate` gera um layout concreto: `app.ts`, `plugins/`, `routes/`, com as duas pastas carregadas por `@fastify/autoload`. O repositório `fastify/demo`, citado pelos próprios guias como exemplo do que a comunidade considera boa prática, separa `plugins/external/` para plugins do ecossistema de `plugins/app/<domínio>/` para os plugins próprios, e trata repositórios como plugins decorados, sem `services/`, `db/` nem `lib/`. Dependências chegam às rotas por decorators com declaration merging, declarados dentro de cada plugin, e a ordem de carga é garantida por `fastify-plugin` com `name` e `dependencies`, não por prefixo numérico nos arquivos. O guia de testes do Fastify é silencioso sobre usar mock ou banco real, o que confirma que a política de testar com mocks é deste repositório, não uma exigência do framework.

Essa leitura resultou em duas mudanças que andam juntas: a costura de persistência sai do Drizzle e vai para uma interface de repositório explícita, e o código se reorganiza na arquitetura de plugins do Fastify, com `plugins/external/`, `plugins/app/` e `routes/` carregados por autoload em ordem fixa.

## Requisitos técnicos

### A costura de persistência

A interface `AuthRepository` passa a ser o ponto de substituição entre produção e teste, com os nove métodos que já existiam, sem redesenho. Ela ganha dois adaptadores: um sobre Drizzle e Postgres, usado em produção, e um em memória, usado nos testes. O adaptador em memória vive em `tests/helpers/` e não entra no build, porque é um detalhe de teste, não parte do produto.

O adaptador Drizzle fica sem teste próprio até o projeto adotar testes de integração. Escrever um falso do ORM para testar o adaptador que usa esse mesmo ORM é o mesmo problema de acoplamento em outro lugar, só que descido um nível. A lacuna fica registrada aqui em vez de virar débito escondido.

### O ponto de entrada só liga e desliga

`server.ts` faz quatro coisas, como o `server.ts` do `fastify/demo`: carrega o ambiente validado, cria a instância com `buildApp({ config })`, arma o desligamento com `close-with-grace`, e chama `ready` e `listen`. Banco, repositório e remetente de email não aparecem ali.

O plugin `plugins/app/database.ts` é dono do ciclo de vida da conexão, no mesmo formato do `knex.ts` do demo: cria o `Database` a partir de `config.DATABASE_URL`, decora `fastify.db` e registra o `onClose` que fecha o pool. O plugin `email-sender.ts` decora `fastify.emailSender` a partir do driver configurado. O plugin `auth` monta o repositório Drizzle sobre `fastify.db` quando nenhum adaptador vem por opção, que é o caso de produção.

O desligamento usa `close-with-grace`, que o demo e o `fastify start` também usam, porque a versão feita à mão com `process.once` não tinha timeout: um pool travado no `close` deixaria o processo pendurado para sempre. Com ESM em Node 24, o arquivo usa `await` no nível superior, então um ambiente inválido lançado por `loadEnv()` encerra o processo com código 1 e a mensagem do Zod, sem `try` nem `process.exit` explícitos.

Nos testes, o plugin de banco cria um cliente postgres.js com a URL do `config` de teste e nunca conecta, porque o cliente só abre conexão na primeira query. Isso evita um condicional escondido no plugin para pular o banco quando um repositório falso é passado.

### `config/env.ts` sem mudança

A validação de ambiente com Zod continua onde estava. Já existia, já era testada, e nenhuma fonte oficial do Fastify exige `@fastify/env` no lugar dela.

### `lib/` só com função pura

`password.ts`, `token-hash.ts`, `otp.ts` e `session.ts` continuam em `src/lib/`, porque são funções puras que não variam entre ambientes. Só a verificação de senha vazada sai de lá, porque faz uma chamada HTTP e precisa de um comportamento diferente em teste e em produção. O hash de senha não vira plugin pelo motivo oposto: Argon2 não muda de implementação conforme o ambiente, então não há colaborador para injetar.

### Os quatro fluxos viram um módulo `auth`

Os quatro services (`signup`, `resendCode`, `verifyCode`, `login`) se tornam um módulo único em `src/plugins/app/auth/`, decorado como `fastify.auth`. Os quatro arquivos que já existiam continuam existindo como implementação interna do módulo, com os testes deles intactos, porque a costura entre eles não mudou, só a forma como chegam até a rota. A verificação de senha vazada vira `src/plugins/app/pwned-password.ts`, decorando `fastify.checkPwnedPassword`, e deixa de ser um campo obrigatório em `AppOptions`.

### `schemas/auth.ts`

Os schemas Zod das rotas de autenticação, antes duplicados em cada um dos quatro arquivos de rota, passam a viver num módulo só, `src/schemas/auth.ts`, compartilhado pelas rotas que fazem uso deles.

### Sem `CONTEXT.md` nem ADR

O vocabulário e as decisões deste passo vão para este documento e para a seção "Onde as coisas ficam" do `AGENTS.md`, sem abrir um documento de arquitetura à parte. O motivo de não apagar a camada equivalente a `services/` como o `fastify/demo` faz, e a política de testar com mocks em vez de banco real, já estavam registrados no `AGENTS.md` antes desta etapa e continuam lá.

### Uma PR, um commit por fase

A migração inteira acontece numa única PR, com um commit por fase, e cada commit passa em `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm build` antes do próximo começar. Isso mantém a árvore sempre num estado que builda e testa, mesmo no meio de uma refatoração grande.

### Vitest e o autoload

O Vitest precisa da opção `server.deps.inline: ["@fastify/autoload"]` na configuração. Sem ela, o `import()` dinâmico que o autoload faz para carregar cada plugin roda fora do processamento do Vite, nativo do Node, e nesse caminho o Node não resolve um especificador `./x.js` para o arquivo fonte `./x.ts`. Rodando com `tsx` ou contra o `dist/` já compilado esse problema não aparece, porque em ambos os casos o especificador `.js` já corresponde a um arquivo real no disco. A variável de ambiente `FASTIFY_AUTOLOAD_TYPESCRIPT` sozinha não resolve o caso do Vitest, então a opção de configuração é necessária.

### Ordem de carga e `dependencies`

`app.ts` é o próprio plugin `app`, exportado envolto em `fp()` para que decorators do ecossistema, como `app.swagger()`, cheguem até a instância raiz que `buildApp` devolve e que os testes injetam. Dentro dele, três chamadas de autoload carregam, nesta ordem, `plugins/external`, `plugins/app` e `routes`, cada uma esperando a anterior terminar antes de começar. Dentro de cada pasta, a ordem entre plugins é declarada por `fastify-plugin`, passando `name` e `dependencies`: por exemplo, o plugin `auth` declara `dependencies: ["pwned-password"]`, porque `create-auth.ts` usa `fastify.checkPwnedPassword` ao montar o fluxo de signup, e sem essa dependência declarada o autoload não garante que `pwned-password` já rodou.

### `dirNameRoutePrefix`

O autoload usa o nome da pasta como prefixo de rota por padrão. Por isso `routes/auth/signup.ts`, registrando `app.post("/signup", ...)`, fica exposto em `/auth/signup`, sem que o código da rota precise saber o próprio prefixo. `routes/health.ts`, fora de qualquer subpasta, fica em `/health`.

### `AppOptions`

```ts
export interface AppOptions {
  config: Env;
  authRepository?: AuthRepository;
  emailSender?: EmailSender;
  checkPwnedPassword?: CheckPwnedPassword;
}
```

`config` é o ambiente validado pelo Zod e é o único campo obrigatório: o autoload repassa as opções a todo plugin, então cada um lê dali o que precisa, sem um plugin de configuração decorando a instância. Os três adaptadores são opcionais porque cada plugin sabe montar a própria implementação padrão a partir de `config`, e só os testes precisam substituí-los. O Swagger UI é registrado quando `NODE_ENV` não é `production`, decisão que fica dentro do próprio plugin `swagger-ui.ts`.

### Árvore alvo

```
src/
  app.ts                       plugin `app` com três autoloads, e `buildApp(opts)`
  app-options.ts               interface AppOptions
  server.ts                    loadEnv, buildApp, close-with-grace, listen
  config/env.ts                sem mudança
  db/
    schema.ts                  sem mudança
    client.ts                  createDatabase(url) devolve { db, close }
    drizzle-auth-repository.ts createDrizzleAuthRepository(db): AuthRepository
  email/
    email-sender.ts            interface EmailSender e EmailProviderError
    create-email-sender.ts     seleção de driver por env
    fake-, mailpit-, resend-email-sender.ts
  lib/
    otp.ts                     generateOtpCode
    password.ts                sem mudança
    session.ts                 SESSION_TTL_SECONDS, generateSessionToken, generateSignupSessionToken
    token-hash.ts              sem mudança
  plugins/
    external/
      cookie.ts                export default cookie
      swagger.ts               export default swagger, com autoConfig
      swagger-ui.ts            fp, registra swagger-ui fora de production
    app/
      database.ts              fp, decora fastify.db e fecha o pool no onClose
      email-sender.ts          fp, decora fastify.emailSender
      pwned-password.ts        fp, decora fastify.checkPwnedPassword
      auth/
        index.ts               fp, decora fastify.auth
        auth-repository.ts     interface AuthRepository e tipos de registro
        create-auth.ts         createAuth(deps) monta os quatro fluxos
        signup.ts, resend-code.ts, verify-code.ts, login.ts
        signup-email.ts
  routes/
    health.ts
    auth/signup.ts, resend-code.ts, verify-code.ts, login.ts
  schemas/
    auth.ts
tests/                         espelha src/, mais helpers/
  helpers/
    app-options.ts             makeAppOptions(overrides)
    in-memory-auth-repository.ts
```

## Definition of done

* `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm build` passando em cada commit
* nenhum teste precisando de Postgres ou rede
* `tests/` espelhando a árvore de `src/`
* `AGENTS.md` com "Onde as coisas ficam" reescrita, nomeando a arquitetura de plugins do Fastify, a ordem de carga e o que cada pasta guarda, e a política de testes dizendo que o adaptador Drizzle só é coberto por teste de integração
* `docs/tasks/09-fastify-plugin-architecture.md` e índice atualizado
* commits Conventional Commit em inglês, só título
* PR com `--assignee YuriCoutinho` e label `feature`
