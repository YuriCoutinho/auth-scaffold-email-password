---
name: semantic-commit
description: Use quando a pessoa pedir para commitar ("commita", "faz o commit", "commita isso") ou ao encadear commits dentro de um fluxo maior que exige Conventional Commits.
---

# Semantic Commit

Gera e aplica commits no padrão `type(domain): descrição`, a partir do que está staged. A mensagem descreve o diff real.

## Rules

- **Formato fixo**: `type(domain): descrição`. O `type` varia conforme a mudança (tabela abaixo); o `domain` (scope) é **sempre obrigatório**, nunca omitido.
- **Inglês**, sempre. Descrição em minúsculo, imperativo, sem ponto final.
- **Máximo 80 caracteres** na linha do commit inteira (`type(domain): descrição`), contando tudo. Se não couber, encurtar a descrição, não estourar.
- **Sem body**: commit de uma linha só, sempre. Nunca adicionar corpo.
- **Sem co-author**: nunca adicionar trailer `Co-authored-by` nem qualquer assinatura de agente.
- Um commit por unidade lógica de mudança: se o staged mistura assuntos, dividir em commits separados (`git add -p` ou por arquivo), não amontoar num só.
- Nunca commitar sem revisar o diff staged primeiro; a mensagem reflete o que mudou de fato.

## Tool calling

Git via Bash (`git status`, `git diff --staged`, `git add`, `git commit -m`). Nenhuma chamada de rede.

## Tipos

| Tipo | Uso |
| --- | --- |
| `feat` | Nova funcionalidade |
| `fix` | Correção de bug |
| `docs` | Só documentação |
| `style` | Formatação, espaço em branco (sem mudança de lógica) |
| `refactor` | Reestruturação (nem fix nem feature) |
| `perf` | Melhoria de performance |
| `test` | Adição/correção de testes |
| `build` | Build, dependências |
| `ci` | Configuração de CI |
| `chore` | Manutenção que não se encaixa acima |
| `revert` | Reverte um commit anterior |

## Passos

1. `git status` e `git diff --staged` para ver o que está staged. Se nada estiver staged, mostrar o que há para stagear e parar.
2. Se o staged mistura assuntos distintos, propor a divisão em commits separados.
3. Escolher o `type` pela natureza da mudança e o `domain` pelo módulo afetado.
4. Escrever a linha `type(domain): descrição` em inglês, imperativo, dentro de 80 caracteres.
5. `git commit -m "type(domain): descrição"`. Só um `-m`, sem body, sem trailers.

## Exemplos

- `feat(auth): add password strength validation`
- `fix(session): expire tokens on password change`
- `refactor(db): split profile fields into own table`
- `test(signup): cover duplicate email path`
