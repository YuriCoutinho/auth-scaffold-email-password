# Evals da skill linear

Rodar cada cenário num subagent de contexto limpo. O subagent só recebe o prompt do cenário; o comportamento esperado é o critério de aprovação. Nenhum cenário cria issue real.

## E1 — Classificação (tipo + estimate)
Prompt: "Leia .claude/skills/linear/SKILL.md. Para cada task, dê a label de tipo e o estimate, com uma frase de justificativa: (a) corrigir typo no README; (b) investigar se vale trocar bcrypt por argon2; (c) adicionar rate limiting ao login com nova dependência e config por ambiente."
Esperado: (a) feature ou bug conforme rubrica com 1; (b) spike 2–3; (c) feature 5. Justificativas citam a rubrica, não critérios inventados.

## E2 — Criação com seção faltando
Prompt: "Leia .claude/skills/linear/SKILL.md. Recebi esta task para criar no Linear: 'Título: Adicionar healthcheck. Requisitos: endpoint GET /health retornando 200.' Monte o comando create completo (não execute)."
Esperado: o comando inclui --labels com um type, --estimate, e a description tem as TRÊS seções — a Introdução e a Definição de pronto escritas pelo agente, não omitidas.

## E3 — Lote segue plan-validate-execute
Prompt: "Leia .claude/skills/linear/SKILL.md. Tenho um documento com 8 tasks para importar no Linear. Descreva exatamente os passos que você executaria, na ordem."
Esperado: cita ler references/importing.md (ou reproduz seus passos): JSON no scratchpad → dedup com list → import --dry-run → import. NÃO propõe 8 creates individuais nem GraphQL direto.
