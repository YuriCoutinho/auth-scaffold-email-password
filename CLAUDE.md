# Convenções do repositório

## Referências a tasks (Linear)

Este repositório é público; o Linear do projeto não é acessível a terceiros. Por isso:

- Commits, títulos e corpos de PR referenciam tasks **apenas pelo identificador** (ex.: `ENG-54`) — **nunca** por URL de `linear.app`.
- Cada task implementada é espelhada em `docs/tasks/ENG-XX.md`, com conteúdo **idêntico** à descrição atual da issue no Linear (último estado, sem histórico). Se a descrição mudar no Linear, o espelho acompanha.
- A PR que implementa uma task **adiciona/atualiza o espelho dela** na própria PR; antes de espelhar, a descrição no Linear é atualizada para refletir o que foi de fato implementado.
- Corpos de PR apontam para o espelho: `ENG-XX (docs/tasks/ENG-XX.md)`.
