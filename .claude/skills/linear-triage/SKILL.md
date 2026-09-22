---
name: linear-triage
description: Use quando o pedido for escolher a próxima issue do Linear ("o que eu faço", "pega uma task", "meu backlog") e ainda não houver issue definida. Fase de triagem do fluxo Linear, roda como subagent do orquestrador.
---

# Linear: Triage

Ajuda a escolher a próxima issue. Roda em subagent próprio para não encher o contexto principal.

## Rules

- Toda leitura pelo CLI `.claude/skills/linear/scripts/linear.sh`; team e projeto vêm do `.env`.
- Só leitura nesta fase: nunca criar, mover status nem comentar. A escolha é da pessoa.
- Apresentar uma lista curta e comparável (identifier, título, status, prioridade), não despejar o backlog inteiro.
- Se o pedido for vago, filtrar pelo que faz sentido (status aberto, prioridade alta) e perguntar antes de assumir.

## Tool calling

Somente o CLI acima (via Bash), mais leitura de código/web para contexto. Nenhuma escrita no Linear.

## Passos

1. `list` com os filtros do pedido (ex: `--status "Todo"`, `--label bug`, `--priority` via ordenação natural do resultado). Sem filtro claro, liste o backlog aberto do projeto.
2. Se a pessoa deu um termo, use `search --query`.
3. Monte uma tabela curta das candidatas e ajude a escolher; para detalhes de uma, use `get --id`.
4. Ao escolher, devolva o `identifier` para o orquestrador seguir com o subagent de plano.
