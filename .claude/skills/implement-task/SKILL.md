---
name: implement-task
description: Use quando a pessoa pedir para levar uma task do Linear do backlog até a PR, de ponta a ponta ("implementa a task tal", "pega uma task pra fazer", "vamos trabalhar nessa issue" ou algo assim).
---

# Implement Task

Leva uma task do Linear do backlog até a PR aberta, orquestrando as skills existentes em ordem. O próprio orquestrador conduz o grill-me: a pessoa só entra respondendo as rodadas de perguntas; o resto corre encadeado.

## Separação de papéis (invariante)

Três agentes distintos, **nunca o mesmo**, cada um no seu contexto isolado:

- **Planejador**: a entrevista do `/grill-me` no contexto principal — o orquestrador faz as perguntas, a pessoa decide as respostas. Não escreve código.
- **Executor**: subagent que implementa o plano na worktree. Não se auto-revisa nem decide se o próprio trabalho está bom.
- **Revisor**: subagent **separado do executor**, que revisa o que foi implementado com olhos frescos, sem ter escrito o código. Um agente jamais revisa o próprio trabalho — a revisão perde o valor se quem executou é quem aprova.

O orquestrador (esta skill) coordena os três, mas não acumula papéis: ele delega, não implementa nem revisa por conta própria.

## Rules

- Cada etapa usa a skill dedicada, nunca reimplementa o que ela faz: Linear pelo CLI da skill `linear` (`.claude/skills/linear/scripts/linear.sh`), planejamento pelo `/grill-me`, escrita do plano pela skill `superpowers:writing-plans`, commits pela skill `semantic-commit`.
- **O grill-me roda no contexto principal, invocado pelo orquestrador**: ao chegar nessa etapa, o orquestrador invoca a skill do grill (via Skill tool) com o contexto da issue e conduz a entrevista — apresenta cada rodada de perguntas à pessoa e espera as respostas dela antes da rodada seguinte. A pessoa participa respondendo, não invocando comando. Grillar dentro de um subagent ou responder pela pessoa quebra a etapa (responder por ela só se ela pedir).
- **Executor e revisor são subagents diferentes**: o subagent que implementa nunca é o mesmo que revisa. A revisão roda num subagent limpo, que não participou da implementação.
- Implementação roda num subagent com worktree própria (uma por issue), para isolar e não poluir o contexto principal.
- **Testes verdes E revisão aprovada são pré-requisitos da PR**: se os testes falharem ou a revisão apontar problemas bloqueantes, parar, reportar e não abrir a PR.
- O Linear é a fonte de verdade: mover status e comentar conforme avança (In Progress ao começar, In Review/Done ao abrir a PR), não só ao final.
- Pesquisar código/web para contexto é livre; operações no Linear saem sempre pelo CLI da skill linear.

## Tool calling

CLI da skill `linear` (via Bash) para o Linear; `/grill-me` para planejar (o orquestrador o invoca pela Skill tool, nunca pede para a pessoa rodar); skill `semantic-commit` para commitar; Bash/Git para worktree e testes; `gh` para a PR. Subagents de implementação e de revisão via Task, sempre separados.

**Como despachar subagents**: o prompt do Task instrui explicitamente "Leia `.claude/skills/<skill>/SKILL.md` e siga essa skill" (ex: `linear-implement` para o executor), mais o contexto mínimo (identifier, path do arquivo de plano, path da worktree). O plano nunca vai inline no prompt: executor e revisor leem o mesmo arquivo `docs/superpowers/plans/<IDENTIFIER>.md`. O subagent carrega a própria skill; o orquestrador não cola conteúdo de skill no prompt nem traz o trabalho da fase para o contexto principal — só o resumo que o subagent devolve.

## Fluxo

1. **Pegar a issue** (orquestrador): se a pessoa não deu o identifier, usar o subagent `linear-triage` para escolher; senão, `linear get --id <IDENTIFIER>` para ler título e descrição. **Ignorar o `branchName` que o Linear sugere**: ele carrega o identificador do board e o usuário do dono, e o nome da branch fica visível na página da PR num repo público.
2. **Planejar / grillar** (planejador — orquestrador conduz, pessoa responde): o orquestrador invoca a skill do grill (`/grill-me`) passando identifier, título e descrição da issue, e apresenta a primeira rodada de perguntas à pessoa. A cada rodada, espera as respostas dela antes de seguir; as respostas da entrevista produzem o plano.
3. **Escrever e registrar o plano** (orquestrador): com a entrevista concluída, o orquestrador invoca a skill `superpowers:writing-plans` e transforma as respostas do grill no plano, gravado em `docs/superpowers/plans/<IDENTIFIER>.md` (diretório já ignorado pelo git). Escrever o plano é tarefa do orquestrador no contexto principal — é ele quem tem o contexto da entrevista; não delegar a subagent. Em seguida, `linear comment --id <IDENTIFIER>` com o resumo e `linear status --id <IDENTIFIER> --state "In Progress"`. Esse arquivo é a fonte única do plano para executor e revisor.
4. **Implementar** (executor — subagent): o subagent `linear-implement` recebe o path do arquivo de plano e o nome da branch, cria a worktree, executa o plano e edita o código. Este agente só implementa. O nome da branch é **sempre em inglês e semântico**, no formato `<tipo>/<escopo>-<slug>` com o `<tipo>` do Conventional Commit (`feat/auth-change-password`, `fix/sessions-expired-cookie`). Nunca leva identificador de issue, nome ou email de pessoa, nem português.
5. **Commitar** (executor): pela skill `semantic-commit`, um commit por unidade lógica de mudança.
6. **Testar** (executor): rodar os testes do projeto. Se falharem, parar e reportar; não seguir para a revisão nem para a PR.
7. **Revisar** (revisor — subagent separado): um subagent limpo, que não implementou, lê o mesmo arquivo de plano e revisa o diff da worktree contra ele e os padrões do projeto. Ele aponta problemas; não corrige por conta própria. Se houver bloqueio, o orquestrador devolve ao executor para ajustar e a revisão roda de novo.
8. **Espelhar a task no repo** (orquestrador → executor): antes da PR, atualizar a descrição da issue no Linear para refletir o que foi de fato implementado (decisões tomadas durante a task entram na descrição, não só em comentários) e gravar o documento `docs/tasks/NN-slug-em-ingles.md` na worktree (`NN` = ordem cronológica, cabeçalho `# NN. Title`), autocontido e **sem citar identificador do board**, com as seções fixas `## Introdução`, `## Requisitos técnicos` e `## Definition of done`, sem seção de limitações ou débito técnico, e atualizar o índice `docs/tasks/README.md`, commitado na mesma branch (`docs(tasks): add <slug> guide`). Regra permanente (ver `AGENTS.md` do repo): o repo é público e o Linear não, e **nada do board entra no repositório** — nem identificador, nem URL, em nenhum commit, título, corpo de PR ou documento. O Linear guia o fluxo interno; o que chega ao repo é o resultado.
9. **Abrir a PR** (orquestrador): só com testes verdes e revisão aprovada, `gh pr create` com corpo apontando o documento em `docs/tasks/NN-slug.md`, sem citar o board. **Título em formato Conventional Commit, em inglês, com escopo** (ex.: `feat(auth): add signup endpoint`) — o merge é squash, então o título vira a primeira linha do commit na `main` e segue as mesmas regras da skill `semantic-commit`; o corpo da PR pode ser em português. **Sempre** atribuir a PR ao usuário (`--assignee YuriCoutinho`), aplicar a label do GitHub espelhando a label de tipo da issue no Linear (`feature`/`fix`/`spike`; `bug` acompanha `fix` quando a PR conserta algo reportado; usar `documentation` quando a mudança tocar só arquivos de documentação) e seguir o template do repo (`.github/PULL_REQUEST_TEMPLATE.md`): seções Resumo (apontando `docs/tasks/NN-slug.md`), Verificação (o que rodou e o resultado) e Notas da revisão (achados não bloqueantes). Merge é sempre squash (ruleset da `main` já impõe).
10. **Fechar o ciclo** (orquestrador): `linear status --id <IDENTIFIER> --state "In Review"` (ou "Done", conforme o fluxo), `linear comment` com o link da PR (no Linear pode linkar o GitHub; o contrário é que é proibido) e apagar `docs/superpowers/plans/<IDENTIFIER>.md` — plano executado não fica para trás.

## Setup

Skills instaladas: `linear` (esta árvore), `grill-me` (Matt Pocock), `semantic-commit`. `gh` autenticado (`gh auth login`). `.env` com `LINEAR_API_KEY`, `LINEAR_TEAM_KEY`, `LINEAR_PROJECT`. `curl`, `jq`, `git` no PATH.