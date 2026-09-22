---
name: linear-plan
description: Use quando houver um plano já produzido pelo /grill-me pronto para ser registrado numa issue do Linear, antes da implementação. Fase de registro do fluxo Linear, roda como subagent do orquestrador.
---

# Linear: Plan

Registra o plano já decidido e prepara a issue para implementação. Não faz o planejamento: isso é papel do `/grill-me` (skill externa do Matt Pocock), que a pessoa roda no contexto principal antes de acionar o fluxo Linear.

## Rules

- CLI em `.claude/skills/linear/scripts/linear.sh`; team e projeto vêm do `.env`.
- O plano chega pronto, vindo do `/grill-me`. Não re-entrevistar nem replanejar aqui; apenas registrar e preparar a issue.
- Registrar o plano na issue como comentário (`comment`), para ficar rastreável no Linear.
- Mover a issue para "In Progress" (`status --state "In Progress"`) ao registrar, sinalizando que o trabalho vai começar.
- Se o plano do grill não estiver disponível no contexto, parar e pedir para a pessoa rodar `/grill-me` primeiro, em vez de improvisar um plano.

## Tool calling

O CLI acima (via Bash) para comentar e mover status. Nenhuma edição de código nesta fase.

## Passos

1. `get --id <IDENTIFIER>` para confirmar a issue, o estado atual e o `estimate`.
2. `comment --id <IDENTIFIER> --body` com o plano produzido pelo `/grill-me` (resumo das decisões e passos).
3. Reavaliar a estimativa à luz do plano, usando a rubrica de "Estimativa" da skill `linear` (`.claude/skills/linear/SKILL.md`). Se a issue estiver sem estimate ou o valor não refletir o plano, `update --id <IDENTIFIER> --estimate <1|2|3|5|8>`.
4. `status --id <IDENTIFIER> --state "In Progress"`.
5. Devolver o `identifier` e o plano ao orquestrador, para o subagent de implementação seguir.
