---
name: linear
description: Use quando a pessoa mencionar Linear, issue, task, backlog ou ticket e quiser criar, buscar, ler, listar, comentar, estimar, relacionar ou mover o status de uma issue, escolher o que trabalhar, ou importar um documento/lista de tasks em lote.
---

# Linear

Orquestra o trabalho sobre issues do Linear: escolher o que fazer, registrar o plano, implementar e manter o Linear atualizado. Fases pesadas rodam em subagents com contexto próprio; o planejamento em si é da skill `/grill-me` (Matt Pocock), rodada antes pela pessoa.

## Rules

- Todo acesso ao Linear passa por `.claude/skills/linear/scripts/linear.sh`. Nunca chamar a API GraphQL direto nem inventar outro cliente.
- `LINEAR_API_KEY`, `LINEAR_TEAM_KEY` e `LINEAR_PROJECT` vêm do `.env`; nunca hardcoded nem impressos. Team e projeto resolvem daí quando a flag é omitida.
- Título e descrição de issue em **português**; nome de projeto, labels e key do team em **inglês**.
- Toda issue leva **exatamente uma label de tipo** (`bug` | `feature` | `spike`, grupo `type` do workspace; o CLI recusa `create` sem ela) e **um `--estimate`** pela rubrica abaixo. Labels de área (`infra`/`api`/`test`) são opcionais.
- Toda descrição tem três seções nesta ordem: `## Introdução`, `## Requisitos técnicos`, `## Definition of done`, iguais às do documento que a task vira no repo. Faltou alguma no pedido → escrever a que falta a partir do contexto, nunca criar incompleta.
- Antes de criar, buscar com `search`/`list` para não duplicar.
- Dependência entre issues registrada com `relate --id A --blocks B`, não só citada em prosa.
- Manter o Linear como fonte de verdade do fluxo: mover status e comentar conforme o trabalho avança.
- **Nada do Linear entra no repositório**: nem identificador, nem URL, em nenhum commit, título, corpo de PR ou documento. O Linear guia o trabalho; o que chega ao repo é o resultado. Ver `AGENTS.md`.
- Pesquisar na web/código para contexto é encorajado; a restrição é só sobre a operação no Linear.
- Não replanejar o que o `/grill-me` decidiu; sem plano no contexto, pedir para rodar `/grill-me`.

## Tipo da issue

| Label | Quando usar |
|---|---|
| `bug` | Comportamento existente errado: erro, regressão, resultado incorreto. |
| `feature` | Capacidade nova ou mudança desejada (inclui melhorias e refactors com valor visível). |
| `spike` | Investigação timeboxed; o resultado é conhecimento/decisão, não código de produto. |

Em dúvida entre `bug` e `feature`: se o comportamento atual foi intencional, é `feature`.

## Estimativa (Fibonacci do workspace)

Estimar pelo fluxo completo (entender + implementar + testar + PR), não só pelo diff:

| Pontos | Significado |
|---|---|
| 1 | Trivial, sem risco: documentação, texto, ajuste de config. |
| 2 | Simples, impacto mínimo: ~20–30min de fluxo total. |
| 3 | Pequena mas real: poucas partes, teste novo, alguma decisão. Algumas horas. |
| 5 | Várias camadas/arquivos ou incerteza técnica: meio dia a um dia. |
| 8 | Grande/muito incerta: um dia+. Considerar quebrar antes de criar. |

Em dúvida entre dois valores, usar o maior.

## Comandos do CLI

Leitura: `teams`, `projects`, `states`, `labels`, `get --id`, `search --query`, `list`.
Escrita: `create`, `update` (ambos com `--estimate` e `--labels`), `status`, `comment`, `relate`, `import`. Detalhe: `scripts/linear.sh --help`.

## Fluxo

1. **Escolher trabalho** ("o que eu faço", "meu backlog") → subagent `linear-triage`.
2. **Registrar plano** (plano do grill em mãos) → subagent `linear-plan`: comenta o plano, ajusta estimate, move para "In Progress".
3. **Implementar** ("implementa a `<identificador>`") → subagent `linear-implement`.
4. **Importar documento/lista de tasks** (2+ issues de uma vez) → seguir [references/importing.md](references/importing.md); direto no contexto atual, sem subagent.

Dispatch de subagent: via Task, com "Leia `.claude/skills/<fase>/SKILL.md` e siga essa skill" + contexto mínimo (identifier, plano). Operação única (criar follow-up, consultar status) → CLI direto.

## Setup

`LINEAR_API_KEY`, `LINEAR_TEAM_KEY`, `LINEAR_PROJECT` no `.env`. Requer `curl`, `jq`, `uuidgen`, `git`. `/grill-me` instalada para planejamento.
