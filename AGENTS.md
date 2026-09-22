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

* `src/routes/` guarda plugins Fastify, e a camada é fina: valida, chama o service, monta a resposta
* `src/services/` guarda a regra de negócio, testável sem subir o Fastify
* `src/db/` guarda schema Drizzle, client e repositórios
* `src/lib/` guarda utilitários puros como hash, tokens e geração de código
* `src/config/` guarda a validação de ambiente com Zod
* `tests/` espelha a árvore de `src/`

Dependências entram por `buildApp(deps)`, então teste nenhum precisa de banco ou rede reais.

## Código

* Todo o código é em **inglês**, incluindo nomes de teste, mensagens de erro e strings voltadas ao usuário. A documentação em `docs/` é em português
* Comentário só quando explica um porquê que o código não consegue expressar. Comentário que descreve o que a linha faz não entra
* Use os defaults da biblioteca em vez de configurar parâmetros por intuição, especialmente em criptografia
* Resolva o requisito concreto que existe, não o problema hipotético que pode aparecer

## Testes

* Vitest com mocks, sem banco real. Testes de integração ainda não foram adotados no projeto
* Todo endpoint novo precisa de teste de service e de rota
* Em fluxo de autenticação, cubra explicitamente os caminhos de erro, porque é neles que mora a proteção contra enumeração de contas

## Commits

* Conventional Commit em inglês, com escopo, e **apenas o título**. Body e footer sempre vazios
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

## Segurança

* Nunca leia, edite ou commite `.env`, `.env.*`, `*.pem`, `*.key` ou arquivos de credencial. O `.env.sample` versionado tem apenas valores vazios
* Nunca logue senha, código de confirmação, token de sessão ou email
* Toda resposta de erro em fluxo de autenticação é genérica, porque mensagem específica vira oráculo para descobrir quais contas existem
