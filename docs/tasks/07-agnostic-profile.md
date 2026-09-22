# 07. Agnostic profile

## Introdução

Um scaffold de autenticação só serve de base para o próximo projeto enquanto não souber nada sobre o produto atual. Basta uma coluna de domínio na tabela de perfil, um registro profissional ou um código de área, para que reaproveitar isso signifique primeiro apagar coisas.

Esta etapa fixa essa fronteira. A tabela de perfil existe, tem relação um para um com o usuário, e guarda apenas o que qualquer produto teria. Tudo que for específico entra depois, no projeto que consumir o scaffold.

A fronteira é também conceitual e vale para quem for estender isto: a tabela de autenticação responde "esta pessoa consegue provar quem é", e a de perfil responde "quem é esta pessoa dentro do produto". Misturar as duas é o começo de uma tabela de usuário com quarenta colunas que todo mundo tem medo de alterar.

## Requisitos técnicos

### O que fica em cada lado

| Tabela | Responsabilidade | Exemplos |
| --- | --- | --- |
| `auth_users` | Provar identidade | email, hash de senha, identificador público |
| `profiles` | Representar a pessoa no produto | nome, papel de acesso, e o que o produto precisar |

* `auth_users` não ganha colunas novas conforme o produto cresce, porque toda coluna ali passa a ser carregada em todo fluxo de autenticação
* `profiles` mantém apenas `full_name`, que é nullable, e `role` com os valores genéricos `user` e `admin`
* Um produto específico estende criando colunas próprias em `profiles`, ou tabelas novas referenciando `auth_users.id`, sem alterar o núcleo

### Criação junto do usuário

* A linha de perfil nasce dentro da mesma transação que cria o usuário, com apenas a referência preenchida e o resto nos valores padrão
* Isso estabelece o invariante de que todo usuário tem perfil, e é o que permite todo o resto do sistema apenas ler o perfil, sem verificar existência e sem criar nada
* Nenhum outro ponto do código cria perfil. Login lê, endpoints futuros leem, e só a promoção do cadastro escreve

A alternativa seria criar o perfil sob demanda, na primeira vez que alguém precisasse dele. Ela parece mais econômica e não é: espalha verificação de nulo por todo lugar que toca perfil, e abre a possibilidade de dois caminhos concorrentes criarem dois perfis para o mesmo usuário.

### Migration antes do primeiro deploy

* Enquanto não existe banco em produção, mudar o schema pede regerar a migration inicial a partir do schema novo, em vez de acumular migration incremental para corrigir decisão da semana passada
* O histórico de migrations é para preservar dados que existem. Bancos locais de desenvolvimento são recriados sem custo, então empilhar correções ali só deixa o arquivo inicial ilegível para quem chegar depois
* A partir do primeiro deploy a regra se inverte, e toda alteração passa a ser incremental

## Definition of done

* Tabela de perfil sem nenhum campo específico de domínio, com papel de acesso em valores genéricos
* Migration inicial gerada a partir do schema atual e aplicável num banco limpo
* Promoção do cadastro criando o perfil na mesma transação do usuário, coberta por teste
* Nenhum outro caminho do código criando perfil
