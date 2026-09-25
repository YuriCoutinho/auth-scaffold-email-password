# AGENTS.md

Instruções para agentes de codificação trabalhando neste repositório.

## Sobre o projeto

Backend de autenticação com email e senha, servindo de scaffold reaproveitável e de material de estudo. O fluxo cobre cadastro com código de confirmação por email, reenvio, confirmação com autologin e login.

Stack: Node 24, TypeScript em modo strict, Fastify 5, Drizzle ORM sobre Postgres 16, Zod para validação, Vitest para testes e Biome para lint e formatação.

## Comandos

O gerenciador de pacotes é **pnpm**, gerenciado por corepack. Não use npm nem yarn.

| Comando | O que faz |
| --- | --- |
| `pnpm dev` | Sobe o servidor em watch mode |
| `pnpm test` | Roda a suíte (Vitest) |
| `pnpm typecheck` | Verifica tipos em `src`, `tests` e configs |
| `pnpm lint` | Lint e format check (Biome) |
| `pnpm format` | Aplica as correções do Biome |
| `pnpm build` | Compila para `dist/` |
| `pnpm db:generate` | Gera migration a partir do schema |
| `pnpm db:migrate` | Aplica migrations |

O `drizzle/` guarda um baseline único com o schema inicial inteiro, não uma cadeia de migrations, porque o projeto é um scaffold e não existe banco em produção. Mudança de schema que faça parte desse schema inicial regenera o baseline; mudança que venha depois dele entra como migration incremental.

Antes de abrir PR, rode `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm build`, que é exatamente o que a CI executa.

Postgres e Mailpit sobem com `docker compose up -d`. O Mailpit tem interface web em `http://localhost:8025` e é onde os emails aparecem em desenvolvimento.

## Onde as coisas ficam

O código se divide em quatro camadas, e cada uma só importa das camadas à direita dela:

```
features/  ──►  http/  ──►  modules/  ──►  plugins/
    │             │            │             │
    └─────────────┴────────────┴─────────────┴──►  lib/, db/, config/
```

* `src/plugins/` é infraestrutura sem regra de negócio: `database.ts` decora `fastify.db` e fecha o pool no `onClose`, `transaction.ts` decora `fastify.transaction`, `error-handler.ts` responde 5xx com mensagem genérica e loga o erro, `email/` decora `fastify.emailSender` (a interface `EmailSender`, a fábrica que escolhe o driver pelo `config` e os drivers fake, mailpit e resend), e `pwned-password/` decora `fastify.checkPwnedPassword` com a chamada à API do Have I Been Pwned. Pacote de terceiro registrado na instância vai para `plugins/external/`, um arquivo por pacote: hoje cookie, cors, helmet, rate-limit, swagger e swagger-ui
* `src/modules/` guarda as capacidades reutilizáveis, uma por tabela dona: `users`, `sessions`, `otp` (a tabela `verification_codes`) e `credential-throttle`. Um módulo não sabe de HTTP e não importa outro módulo
* `src/http/` guarda o que é HTTP e é compartilhado por várias features: `authenticate.ts` decora o hook `fastify.authenticate`, que publica `request.user` e `request.session`, e exporta `requireAuth(request)`, enquanto `schemas.ts` tem os schemas Zod reusados. Essa camada existe para que nenhuma feature precise importar outra e para que o hook de sessão não vá parar em `plugins/`, onde dependeria de um módulo
* `src/features/` tem um diretório por caso de uso, e uma feature não importa outra
* `src/lib/`, `src/db/` e `src/config/` são a base, importável por qualquer camada e sem importar nenhuma delas. `db/` guarda só o schema Drizzle e `createDatabase`, e `config/` guarda a validação de ambiente com Zod

A direção das setas não é só convenção, porque `tests/architecture.test.ts` varre `src/` e falha quando um import a quebra. O mesmo teste impede que um arquivo de módulo importe de `fastify` algo além dos tipos `FastifyBaseLogger`, `FastifyInstance` e `FastifyPluginAsync`, e que outro arquivo do módulo que não o `index.ts` use `fastify-plugin`.

### Registro em `app.ts`

`app.ts` registra tudo explicitamente, sem autoload, na ordem das camadas: `plugins/external`, a infraestrutura, os módulos, `http/authenticate` e depois as features, com `health`, `me` e o job do sweep sem prefixo antes das de `/auth` e de `/sessions`. Assim o arquivo serve de índice do sistema, e dá para ler nele, de cima para baixo, toda a infraestrutura, todos os módulos e todos os endpoints. Os prefixos `/auth` e `/sessions` vêm do `register`, e não de caminho absoluto no `route.ts`, o que mantém uma rota `"/"` sob `/sessions` respondendo tanto em `/sessions` quanto em `/sessions/`. A ordem de registro não é livre, porque `tests/characterization.test.ts` fixa em snapshot a tabela de rotas e o documento OpenAPI, e reordenar uma feature muda os dois. Cada plugin continua declarando `name` e `dependencies` no `fastify-plugin`, que é o que faz o boot falhar se a ordem quebrar.

`server.ts` carrega o ambiente, chama `buildApp({ config })`, arma o `close-with-grace` e dá `listen`.

### Formato de um módulo

```
modules/users/
  index.ts              plugin que decora fastify.users
  service.ts            createUsersService, com as regras da capacidade
  repository.ts         interface UsersRepository, a porta
  drizzle-repository.ts createDrizzleUsersRepository, o SQL
```

O `index.ts` decora o service montado sobre `fastify.db` e acrescenta `inTx(tx)`, que devolve o mesmo service montado sobre uma transação aberta fora. A porta fica separada do adaptador porque é ela que deixa testar tudo com o store em memória, sem banco. Política que só uma capacidade usa mora no módulo dela, em `policy.ts`: a curva do bloqueio em `credential-throttle/policy.ts`, e o gerador de código com o cooldown, o teto de envios e o teto de tentativas em `otp/policy.ts`. Templates de email seguem o mesmo critério e ficam em `emails/` dentro do módulo que os envia.

Dentro de uma pasta, o nome do arquivo não repete o nome da pasta: `users/repository.ts`, nunca `users/users-repository.ts`.

### Formato de uma feature

```
features/change-password/
  route.ts     plugin da rota: monta o use-case com os decorators e traduz o resultado em resposta
  schema.ts    schemas Zod do corpo, da resposta e o texto do OpenAPI
  use-case.ts  createChangePassword, a orquestração dos módulos
```

`health` não tem `use-case.ts`, porque não orquestra nada. `retention-sweep` é uma feature sem rota: `job.ts` ocupa o lugar do `route.ts` e agenda de hora em hora o `use-case.ts`, que chama o purge de cada módulo, e `cutoffs.ts` guarda os cortes de retenção, que só o sweep usa.

### Transações

A transação é decidida no use-case. Ele abre `fastify.transaction(async (tx) => ...)` e usa `modulo.inTx(tx)` dentro dela, de modo que escritas em módulos diferentes commitam ou desfazem juntas. Para desfazer tudo e ainda devolver um resultado, como no código de cadastro de uma conta que já foi confirmada, o use-case chama `rollback(valor)`, e o runner converte isso no valor em vez de propagar erro. O email de código nunca sai de dentro da transação: `otp.inTx(tx).issue(...)` só devolve a intenção de envio, e o use-case chama `fastify.otp.dispatch(issued)` depois do commit, para que o email não saia de um cadastro que desfez e a compensação de entrega falha rode sobre o banco, e não sobre uma transação já encerrada.

### Onde um arquivo novo entra

* Função pura e genérica, que mais de uma capacidade usa, vai para `src/lib/`. Hoje ela guarda `cookies`, `device-label`, `email`, `id`, `password`, `rate-limit`, `token`, `token-hash` e `ttl`
* Política de uma capacidade vai para o módulo dela, mesmo sendo função pura
* Algo que precisa de comportamento diferente em teste e em produção não é função de `lib/`, e sim plugin ou módulo, para poder ser injetado
* Repositório é detalhe da capacidade que o usa e mora na pasta do módulo, nunca em `db/`

### Injeção em teste

`buildApp` recebe `AppOptions` e repassa a cada plugin, então um teste troca um colaborador sem banco nem rede. `repositories` recebe uma fábrica por módulo (`users`, `sessions`, `otp` e `credentialThrottle`), e `transaction` recebe o runner. Também chegam por ali `emailSender`, `checkPwnedPassword`, `rateLimit` e os tempos de vida de sessão e de código em `ttl`, validados com Zod e com defaults quando omitidos.

`tests/` espelha a árvore de `src/`. Em `tests/helpers/`, `createInMemoryStore(seed)` implementa as quatro portas sobre um store só e expõe `repositories`, `transaction` e os `Map`s para inspeção, e o runner em memória tira um snapshot do store antes da transação e o restaura se ela desfizer. `makeAppOptions({ store })` monta as opções de teste sobre esse store, e um teste que precisa sobrescrever uma única fábrica passa `repositories` junto, sem perder o store nos outros módulos.

## Código

* Todo o código é em **inglês**, incluindo nomes de teste, mensagens de erro e strings voltadas ao usuário. A documentação em `docs/` é em português
* Comentário sempre em **inglês**, em qualquer arquivo de código, e só quando explica um porquê que o código não consegue expressar. Comentário que descreve o que a linha faz não entra
* Use os defaults da biblioteca em vez de configurar parâmetros por intuição, especialmente em criptografia
* Resolva o requisito concreto que existe, não o problema hipotético que pode aparecer

## Testes

* Vitest com mocks, sem banco real. Testes de integração ainda não foram adotados no projeto
* Teste de use-case e de rota usa o store em memória de `tests/helpers/in-memory-store.ts`. O adaptador Drizzle só é coberto por teste de integração, que ainda não foi adotado
* Todo endpoint novo precisa de teste de use-case e de rota
* Em fluxo de autenticação, cubra explicitamente os caminhos de erro, porque é neles que mora a proteção contra enumeração de contas

## Commits

* Conventional Commit em inglês, com escopo, e **apenas o título**. Body e footer vazios em todo commit que você escrever
* A exceção não é sua: o commit de squash gerado na `main` ao mergear uma PR recebe, no body, a lista dos commits dela. Isso é o GitHub montando a mensagem, é intencional, e não muda a regra acima
* **Nunca** inclua trailer `Co-authored-by` nem qualquer assinatura de agente ou ferramenta
* Ao dar stage, prefira arquivos específicos a `git add -A`

Exemplo: `feat(auth): add post /auth/login endpoint with timing-safe credential check`

## Pull requests

* Título em Conventional Commit, em inglês, porque o merge é squash e ele vira a mensagem do commit na `main`
* Corpo segue `.github/PULL_REQUEST_TEMPLATE.md`, com as seções Resumo, Verificação e Notas da revisão
* O corpo **nunca** leva assinatura de agente ou ferramenta, nem menção a ferramenta de IA, nem emoji de robô
* Sempre com `--assignee YuriCoutinho` e com a label de tipo (`feature`, `fix`, `refactor` ou `documentation`)
* Merge sempre por squash, que o ruleset da `main` já impõe

## Board de planejamento

O planejamento vive num board interno que não é acessível a terceiros. Ele é o guia do fluxo de trabalho, não do repositório: a task é criada e refinada lá, e o que chega ao repositório é o resultado dela, em código.

Por isso **nada do board entra no repositório**: nem identificador, nem URL, nem em commit, nem em corpo de PR, nem em documento.

## Skills

As skills do fluxo de trabalho vivem em `.claude/skills/` e são versionadas junto do código, para que o processo seja reproduzível e não dependa da máquina de uma pessoa:

| Skill | Para que serve |
| --- | --- |
| `implement-task` | Leva uma task do backlog até a PR, de ponta a ponta |
| `linear` | Orquestra as operações no board de planejamento |
| `linear-triage` | Escolhe a próxima task |
| `linear-plan` | Registra o plano já decidido na task |
| `linear-implement` | Executa o plano e abre a PR |
| `semantic-commit` | Gera o commit no padrão Conventional Commit |

O board de planejamento é ferramenta interna e exige `LINEAR_API_KEY`, `LINEAR_TEAM_KEY` e `LINEAR_PROJECT` no `.env`. Sem essas variáveis, as skills de board não funcionam, mas o restante do repositório é independente delas.

## Segurança

* Nunca leia, edite ou commite `.env`, `.env.*`, `*.pem`, `*.key` ou arquivos de credencial. O `.env.sample` versionado tem apenas valores vazios
* Nunca logue senha, código de confirmação, token de sessão ou email
* Toda resposta de erro em fluxo de autenticação é genérica, porque mensagem específica vira oráculo para descobrir quais contas existem
