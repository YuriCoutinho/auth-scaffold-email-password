---
name: linear-implement
description: Use quando houver uma issue do Linear com plano registrado, pronta para ser implementada em código. Fase de implementação do fluxo Linear, roda como subagent do orquestrador.
---

# Linear: Implement

Executa o plano de uma issue e mantém o Linear em dia. Roda em subagent próprio.

## Rules

- CLI em `.claude/skills/linear/scripts/linear.sh`; team e projeto vêm do `.env`.
- **Uma worktree git por issue**: nunca implementar direto no branch atual. Isola o trabalho e permite issues em paralelo.
- Rodar os checks do projeto (testes, lint, type-check) antes de dar a issue por concluída. Só o que passa nos checks avança de estado.
- Comentar o progresso no Linear conforme avança (`comment`), não só ao final; a issue é o registro do trabalho.
- Tech-debt ou follow-up descoberto durante a implementação vira nova issue com `create` (título em português, exatamente uma label de tipo `bug`/`feature`/`spike` mais áreas opcionais, e `--estimate` pela rubrica da skill `linear`), nunca escopo silencioso na atual.
- Mover para "In Review" ao abrir a entrega para revisão, ou "Done" conforme o fluxo do time; usar `states` se não souber os nomes exatos.
- Convenções do repositório (commit, PR, documento da task, código) vivem no `AGENTS.md` da raiz. Seguir de lá, não duplicar aqui.
- **Nada do Linear entra no repositório**: nem identificador, nem URL, em commit, título, corpo de PR ou documento.

## Tool calling

O CLI acima (via Bash) para status/comment/create; Bash e Git para worktree, edição de código e checks. Web/leitura de código liberadas.

## Passos

1. Ler o plano no arquivo indicado pelo orquestrador (`docs/superpowers/plans/<IDENTIFIER>.md`); ele é a fonte única do que implementar.
2. Criar a worktree: `git worktree add` num branch **nomeado por você**, nunca o `branchName` que o Linear sugere. Aquele carrega o identificador do board e o usuário do dono, e o nome da branch aparece na página da PR num repo público. O nome é **sempre em inglês e semântico**, no formato `<tipo>/<escopo>-<slug>`, onde `<tipo>` é o mesmo do Conventional Commit (`feat`, `fix`, `refactor`, `docs`) e o resto descreve a entrega: `feat/auth-change-password`, `fix/sessions-expired-cookie`. Sem identificador de issue, sem nome ou email de pessoa, sem português.
3. Executar o plano passo a passo, editando o código na worktree.
4. Rodar os checks do projeto; corrigir até passarem.
5. Gravar o documento da task em `docs/tasks/NN-slug-em-ingles.md` (`NN` = ordem cronológica), autocontido e sem citar o board, com as seções `## Introdução`, `## Requisitos técnicos` e `## Definition of done`; atualizar o índice `docs/tasks/README.md`.
6. Abrir a PR seguindo `.github/PULL_REQUEST_TEMPLATE.md`, com `--assignee YuriCoutinho` e a label de tipo (`feature`, `fix` ou `documentation`).
7. `comment --id <IDENTIFIER> --body` com o resumo do que foi feito e o link da PR.
8. Para tech-debt descoberto: `create` uma issue de follow-up.
9. `status --id <IDENTIFIER> --state "In Review"` (ou "Done"), conforme o fluxo.
10. Devolver ao orquestrador o resumo das mudanças e o estado final da issue.
