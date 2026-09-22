<!--
Este arquivo é só um ponteiro. Todas as convenções do repositório vivem no AGENTS.md,
que é o formato aberto lido pela maioria dos agentes de codificação.

Por que o ponteiro existe: o Claude Code só lê AGENTS.md direto a partir da versão
2.1.277, e o cask do Homebrew ainda distribui a 2.1.267. Sem este arquivo, uma sessão
nesse binário roda sem nenhuma instrução de projeto carregada.

O import abaixo funciona em qualquer versão e, segundo a documentação oficial
(https://code.claude.com/docs/en/memory.md), nunca causa leitura dupla depois que o
AGENTS.md passar a ser lido direto. Ou seja, dá para manter ou apagar sem risco.

Atenção: nunca crie um CLAUDE.local.md aqui. A presença dele desativa a leitura do
AGENTS.md, em silêncio.
-->

@AGENTS.md
