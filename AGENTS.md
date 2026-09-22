# AGENTS.md

Instruções para agentes de codificação trabalhando neste repositório.

## Sobre o projeto

Backend de autenticação com email e senha, servindo de scaffold reaproveitável e de material de estudo. O fluxo cobre cadastro com código de confirmação por email, reenvio, confirmação com autologin e login.

Stack: Node 24, TypeScript em modo strict, Fastify 5, Drizzle ORM sobre Postgres 16, Zod para validação, Vitest para testes e Biome para lint e formatação.

O raciocínio por trás de cada decisão técnica está em `docs/tasks/`, em ordem cronológica de implementação. O índice fica em `docs/tasks/README.md`.

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

Antes de abrir PR, rode `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm build`, que é exatamente o que a CI executa.

Postgres e Mailpit sobem com `docker compose up -d`. O Mailpit tem interface web em `http://localhost:8025` e é onde os emails aparecem em desenvolvimento.

## Onde as coisas ficam

O projeto segue a arquitetura de plugins do Fastify, no formato do repositório oficial `fastify/demo`: `app.ts` é um plugin que carrega três pastas com `@fastify/autoload`, nesta ordem, e cada plugin declara sua posição com `fastify-plugin` (`name` e `dependencies`).

O critério para decidir onde um arquivo novo entra:

* Pacote de terceiro registrado na instância vai para `src/plugins/external/`, um arquivo por pacote
* Código próprio que uma rota consome vai para `src/plugins/app/`. Plugin de um arquivo só fica na raiz da pasta. Plugin com implementação interna vira uma pasta com `index.ts`, e os arquivos irmãos são detalhes dele: o autoload carrega só o `index.ts` quando a pasta tem um, então os irmãos não viram plugin por acidente
* Dentro de uma pasta de plugin, o nome do arquivo não repete o nome da pasta: `auth/repository.ts`, nunca `auth/auth-repository.ts`
* Função pura sem colaborador para injetar vai para `src/lib/`. Se precisa de comportamento diferente em teste e em produção, é plugin
* `src/db/` guarda só o schema Drizzle e a fábrica de conexão. Repositório é detalhe do domínio que o usa e mora na pasta do plugin dele

O que existe hoje:

* `src/plugins/external/`: cookie, swagger e swagger-ui
* `src/plugins/app/database.ts` decora `fastify.db` e fecha o pool no `onClose`; `pwned-password.ts` decora `fastify.checkPwnedPassword`; `error-handler.ts` registra o `setErrorHandler` que responde 5xx com mensagem genérica e loga o erro
* `src/plugins/app/email/` decora `fastify.emailSender` no `index.ts`. `sender.ts` tem a interface `EmailSender` e o `EmailProviderError`, `create-sender.ts` escolhe o driver pelo `config`, e `drivers/` tem fake, mailpit e resend
* `src/plugins/app/auth/` decora `fastify.auth` no `index.ts` com os quatro fluxos. `repository.ts` é a interface `AuthRepository`, `drizzle-repository.ts` é o adaptador Drizzle dela, `create-auth.ts` monta os fluxos, `signup.ts`, `resend-code.ts`, `verify-code.ts` e `login.ts` são os services, e `emails/` guarda os templates
* `src/routes/` guarda plugins de rota, autoloaded. O nome da pasta vira prefixo: `routes/auth/signup.ts` expõe `/auth/signup`. A camada é fina: valida com o schema, chama `fastify.auth`, monta a resposta
* `src/schemas/` guarda os schemas Zod compartilhados pelas rotas
* `src/db/` guarda o schema Drizzle e `createDatabase`
* `src/lib/` guarda só funções puras: hash, tokens, código
* `src/config/` guarda a validação de ambiente com Zod
* `tests/` espelha a árvore de `src/`, mais `tests/helpers/` com `app-options.ts` e `auth/in-memory-repository.ts`, o adaptador em memória de `AuthRepository`

`server.ts` carrega o ambiente, chama `buildApp({ config })`, arma o `close-with-grace` e dá `listen`. O autoload repassa `AppOptions` a todo plugin, então um teste substitui um colaborador passando `authRepository`, `emailSender` ou `checkPwnedPassword` em `buildApp`, sem banco nem rede.

## Código

* Todo o código é em **inglês**, incluindo nomes de teste, mensagens de erro e strings voltadas ao usuário. A documentação em `docs/` é em português
* Comentário sempre em **inglês**, em qualquer arquivo de código, e só quando explica um porquê que o código não consegue expressar. Comentário que descreve o que a linha faz não entra
* Use os defaults da biblioteca em vez de configurar parâmetros por intuição, especialmente em criptografia
* Resolva o requisito concreto que existe, não o problema hipotético que pode aparecer

## Testes

* Vitest com mocks, sem banco real. Testes de integração ainda não foram adotados no projeto
* Teste de rota usa o adaptador em memória de `AuthRepository`. O adaptador Drizzle só é coberto por teste de integração, que ainda não foi adotado
* Todo endpoint novo precisa de teste de service e de rota
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
* Sempre com `--assignee YuriCoutinho` e com a label de tipo (`feature`, `fix` ou `documentation`)
* Merge sempre por squash, que o ruleset da `main` já impõe

## Documentação de tasks

O planejamento vive num board interno que não é acessível a terceiros. Ele é o guia do fluxo de trabalho, não do repositório: a task é criada e refinada lá, e o que chega ao repositório é o resultado dela, em código e em documento.

Por isso **nada do board entra no repositório**: nem identificador, nem URL, nem em commit, nem em corpo de PR, nem em documento.

* Cada task implementada vira um documento em `docs/tasks/NN-slug-em-ingles.md`, onde `NN` é a ordem cronológica
* Esses documentos são autocontidos e servem de guia para reconstruir o projeto do zero, trazendo cada decisão técnica com o motivo dela
* Estrutura fixa: `## Introdução`, `## Requisitos técnicos`, `## Definition of done`. Sem seção de limitação conhecida, débito técnico ou "fica para a próxima task"
* Redação sem travessões, usando conectivos
* A PR que implementa uma task inclui o documento dela e atualiza o índice `docs/tasks/README.md`

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
