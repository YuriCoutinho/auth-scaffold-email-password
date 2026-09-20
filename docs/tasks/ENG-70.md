# ENG-70 — CI com GitHub Actions: typecheck, lint, testes e build

## Introdução

Ficou de fora da ENG-53 (Setup inicial do projeto) por falta de planejamento: o repositório não tem CI. Hoje as verificações (typecheck, lint, testes, build) só rodam localmente e no pre-commit — nada garante a barra em PRs.

## Requisitos técnicos

* Workflow do GitHub Actions (`.github/workflows/ci.yml`) disparando em `pull_request` e em push na `main`
* Node 24 (respeitando `.nvmrc`), pnpm via corepack, cache do pnpm store
* Jobs/steps: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`
* Testes que precisarem de Postgres no futuro: avaliar service container `postgres:16-alpine` (hoje os testes unitários não tocam banco)
* **Realocar o typecheck do pre-commit**: com a CI ativa e obrigatória, remover `pnpm typecheck` do hook de pre-commit (fica só o lint-staged, incremental) — ou movê-lo para pre-push. Motivo: `tsc` completo a cada commit escala mal e incentiva `--no-verify`; a barra de tipos passa a ser garantida pela CI
* **Status check obrigatório**: adicionar o job da CI como required status check no ruleset da `main` (o ruleset já existe desde a ENG-53 — exige PR, squash-only, bloqueia push direto/force-push/deleção; falta só plugar o check quando ele existir)

## Definição de pronto

* CI roda em toda PR e bloqueia merge quando typecheck, lint, testes ou build falham
* Ruleset da `main` atualizado exigindo o check verde da CI
* Pre-commit enxuto (sem typecheck completo) com a barra garantida pela CI
* Badge de status no README
