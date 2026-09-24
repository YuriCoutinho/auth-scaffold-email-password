# 07. Agnostic profile

## Introdução

Um scaffold de autenticação só serve de base para o próximo projeto enquanto não souber nada sobre o produto atual. Basta uma coluna de domínio na tabela de usuários, um registro profissional ou um código de área, para que reaproveitar isso signifique primeiro apagar coisas.

Esta etapa fixa essa fronteira. Os dados de perfil que qualquer produto teria entram como colunas de `users`, e só eles. Tudo que for específico entra depois, no projeto que consumir o scaffold.

A fronteira é também conceitual e vale para quem for estender isto: uma parte da linha responde "esta pessoa consegue provar quem é", e outra responde "quem é esta pessoa dentro do produto". Deixar a segunda crescer sem critério é o começo de uma tabela de usuário com quarenta colunas que todo mundo tem medo de alterar.

## Requisitos técnicos

### O que fica em `users`

| Grupo | Responsabilidade | Colunas |
| --- | --- | --- |
| Identidade | Provar quem é | `email`, `password_hash`, `email_verified_at` |
| Perfil genérico | Representar a pessoa no produto | `full_name`, `role` |

* `full_name` é nullable, porque o cadastro não pede nome e nenhum produto deveria ser obrigado a inventar um
* `role` é o enum `user_role`, com os valores genéricos `user` e `admin` e `NOT NULL DEFAULT 'user'`
* Nenhuma outra coluna de produto entra aqui. Um produto específico estende criando tabelas próprias que referenciam `users.id`, uma para um ou uma para muitos, sem alterar o núcleo

### Colunas da mesma linha, e não uma tabela de perfil

Uma tabela `profiles` separada, um para um com o usuário, parece a forma mais limpa de manter a fronteira, e custa mais do que entrega. Ela obriga a criar o perfil na mesma transação que cria o usuário para garantir que todo usuário tenha perfil, e na prática o que sobra é um `INSERT` a mais em todo cadastro para uma linha que nenhum fluxo lê. Dados um para um sem ciclo de vida próprio são a mesma linha, e com as colunas em `users` o invariante de que todo usuário tem perfil sai de graça: as colunas nascem com a linha, nos valores padrão.

A preocupação que motivava a separação, a de que toda coluna de perfil passasse a ser carregada em todo fluxo de autenticação, é resolvida na consulta e não no schema. Os métodos do adaptador Drizzle projetam explicitamente as colunas que o fluxo usa, e nenhum deles faz `SELECT *`, então acrescentar uma coluna de perfil não muda o que o login ou a confirmação leem.

### Migration antes do primeiro deploy

* Enquanto não existe banco em produção, mudar o schema pede regerar a migration inicial a partir do schema novo, em vez de acumular migration incremental para corrigir decisão da semana passada
* O histórico de migrations é para preservar dados que existem. Bancos locais de desenvolvimento são recriados sem custo, então empilhar correções ali só deixa o arquivo inicial ilegível para quem chegar depois
* A partir do primeiro deploy a regra se inverte, e toda alteração passa a ser incremental

## Definition of done

* `full_name` nullable e `role` com valores genéricos em `users`, sem nenhum campo específico de domínio
* Baseline gerado a partir do schema atual e aplicável num banco limpo
* Nenhum fluxo de autenticação lendo colunas de perfil, com as consultas do adaptador Drizzle projetando colunas explícitas
