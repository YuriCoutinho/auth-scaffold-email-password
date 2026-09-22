# Importar documento de tasks em lote

Padrão plan-validate-execute: nunca criar issues direto de um documento; sempre gerar o plano em JSON, validar, e só então executar.

## Passos

1. Ler o documento e mapear cada task para um item do array JSON:
   `[{"title": "...", "labels": "feature,infra", "estimate": 5, "description": "## Introdução\n\n...\n\n## Requisitos técnicos\n\n...\n\n## Definição de pronto\n\n..."}]`
   - Título em português; exatamente uma label de tipo por item; estimate pela rubrica do SKILL.md.
   - Task sem definição de pronto no documento → escrever uma, com critérios verificáveis.
   - Task marcada como "a refinar"/investigação → `spike`.
2. Salvar o JSON no scratchpad da sessão (nunca no repositório).
3. `list --limit 50` e conferir título a título: item que já existe sai do JSON.
4. `import --file plano.json --dry-run` → validar. Erro → corrigir o JSON e repetir.
5. Mostrar a tabela do dry-run à pessoa se o lote veio de interpretação sua (não de spec literal); com spec literal aprovada, seguir direto.
6. `import --file plano.json` → criar. O CLI resolve team/labels uma vez e re-tenta 5xx sozinho (creates são idempotentes por UUID).
7. Se abortar no item N: itens < N já existem; remover do JSON os criados e re-rodar.
8. Dependências citadas no documento → `relate --id A --blocks B` para cada uma, ao final.
