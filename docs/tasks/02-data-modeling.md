# 02. Data modeling

## Introdução

O schema é onde a maior parte das garantias de segurança de um fluxo de autenticação realmente mora. Se a modelagem separa cadastro pendente de conta confirmada, nenhum código precisa lembrar de filtrar não confirmados. Se o identificador exposto é diferente da chave primária, nenhuma rota vaza a ordem de criação das contas por acidente.

Esta etapa cria quatro tabelas e dois utilitários de hash. Nenhuma rota ainda, apenas o vocabulário que todas as próximas etapas vão usar.

A separação em quatro tabelas responde a quatro perguntas diferentes: quem está tentando se cadastrar, quem já é usuário, qual o dado de produto dessa pessoa e quais dispositivos estão logados.

## Requisitos técnicos

### Convenções que valem para todas as tabelas

* Toda coluna de tempo é `timestamptz`, nunca `timestamp`. Sem fuso, qualquer comparação de expiração vira armadilha no primeiro deploy fora do seu horário local
* Chaves estrangeiras com `ON DELETE CASCADE`. Apagar a conta apaga sessões e perfil de verdade, o que também é o comportamento esperado por leis de proteção de dados
* `UNIQUE` já cria índice no Postgres, então índice explícito só onde não existe unicidade
* `id` interno é `integer GENERATED ALWAYS AS IDENTITY`, e tudo que a aplicação precisa gerar é gerado pelo próprio Postgres no `INSERT`. Isso dá atomicidade sob concorrência sem round-trip extra
* `updated_at` é renovado pelo `$onUpdate` do Drizzle, que injeta o valor em todo `UPDATE` feito pelo ORM, em vez de um trigger no banco. O projeto só escreve nessas tabelas pelo Drizzle, então a solução mais simples basta

### Onde fica

* O schema Drizzle das quatro tabelas vive em `src/db/schema.ts`, e `drizzle/` guarda um baseline único com o schema inicial inteiro, e não uma cadeia de migrations. Como o projeto é um scaffold e não existe banco em produção, toda mudança que faça parte desse schema inicial regenera o baseline; migration incremental só começa depois que o scaffold está fechado
* Os utilitários de hash vivem em `src/lib/`, que guarda apenas funções puras: `password.ts` para Argon2 e `token-hash.ts` para SHA-256. Nenhum dos dois varia entre ambientes, então não há colaborador para injetar e eles não viram plugin
* Nenhum outro módulo de `src/` fala com o banco diretamente. O acesso passa por duas interfaces, uma por fatia do domínio. `AuthRepository`, definida em `src/plugins/app/auth/repository.ts`, cobre identidade, ou seja usuário e cadastro pendente. `SessionRepository`, definida em `src/plugins/app/sessions/repository.ts`, cobre a sessão. Cada uma ganha um adaptador Drizzle ao lado, em `drizzle-repository.ts` da própria pasta, e as duas são satisfeitas pelo mesmo adaptador em memória em `tests/helpers/auth/in-memory-repository.ts`, que guarda tudo num store só. Interface e adaptador ficam na pasta do domínio, e não em `db/`, porque o repositório é detalhe de quem o usa; `db/` só conhece schema e conexão. Cada interface cresce um endpoint por vez, cada um adicionando só os métodos de que precisa

### Tabela `pending_signups`

Guarda a tentativa de cadastro que ainda não foi confirmada. Manter isso fora de `auth_users` significa que a tabela de usuários contém apenas contas reais, sem coluna de "confirmado" para todo mundo esquecer de checar.

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` | `integer` identity | PK interna |
| `email` | `text` | `UNIQUE`, `NOT NULL` |
| `password_hash` | `text` | `NOT NULL` |
| `code_hash` | `text` | `NOT NULL`, hash do código de 6 dígitos |
| `code_attempts` | `integer` | `NOT NULL DEFAULT 0`, conta verificações erradas |
| `last_sent_at` | `timestamptz` | `NOT NULL DEFAULT now()`, base do cooldown de reenvio |
| `code_send_count` | `integer` | `NOT NULL DEFAULT 1`, conta emails enviados, já que o próprio cadastro é o primeiro |
| `signup_session_token` | `text` | `UNIQUE`, `NOT NULL`, 256 bits de entropia |
| `expires_at` | `timestamptz` | `NOT NULL`, indexado para limpeza futura |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |

Os dois contadores medem coisas diferentes e precisam existir separados: `code_attempts` protege contra adivinhar o código, enquanto `code_send_count` protege contra custo e abuso de envio de email.

### Tabela `auth_users`

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` | `integer` identity | PK interna, nunca exposta |
| `public_id` | `uuid` | `UNIQUE`, `NOT NULL`, `DEFAULT gen_random_uuid()` |
| `email` | `text` | `UNIQUE`, `NOT NULL` |
| `password_hash` | `text` | `NOT NULL` |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()`, renovado a cada alteração |

Os dois identificadores existem por razões distintas. O `id` sequencial é eficiente para chave estrangeira e junção. O `public_id` é o que aparece em URL, token e resposta de API, e sendo aleatório não revela quantas contas existem nem em que ordem foram criadas.

### Tabela `profiles`

Dado de produto, mantido separado da autenticação e sem nenhum campo específico de domínio. Relação um para um com `auth_users`, garantida por `UNIQUE` em `user_id`.

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` | `integer` identity | PK interna |
| `user_id` | `integer` | FK para `auth_users.id`, `UNIQUE`, `NOT NULL`, cascade |
| `full_name` | `text` | nullable |
| `role` | enum `profile_role` (`user`, `admin`) | `NOT NULL DEFAULT 'user'` |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` |

### Tabela `sessions`

Uma linha por dispositivo logado, o que permite listar sessões ativas e encerrar uma delas sem derrubar as outras.

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` | `integer` identity | PK interna |
| `public_id` | `uuid` | `NOT NULL`, `UNIQUE`, default aleatório, é o id que sai em resposta |
| `user_id` | `integer` | FK para `auth_users.id`, `NOT NULL`, cascade, indexado |
| `token_hash` | `text` | `UNIQUE`, `NOT NULL` |
| `device_label` | `text` | nullable, rótulo legível do dispositivo |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |
| `expires_at` | `timestamptz` | `NOT NULL`, indexado |
| `revoked_at` | `timestamptz` | nullable, onde `NULL` significa nunca revogada |
| `revoked_reason` | `text` | nullable, por exemplo `user_logout` ou `security_event` |

Expirar e revogar são eventos diferentes e por isso ocupam colunas diferentes. Uma sessão expirada apenas envelheceu, enquanto uma revogada foi encerrada por alguém, e saber o motivo depois vale muito numa investigação. A validação de sessão fica sendo `token_hash = ? AND revoked_at IS NULL AND expires_at > now()`. A chave primária serial nunca aparece numa resposta, porque id sequencial é enumerável e deixa estimar o volume de registros criados entre dois que alguém conhece, então toda tabela cujo registro aparece num payload carrega um `public_id` em uuid ao lado da chave interna, exatamente como `auth_users` faz.

### Hash de senha

* Argon2id via `node-argon2`, usando os **parâmetros padrão da biblioteca**. Custo de memória e paralelismo são exatamente o tipo de parâmetro que se ajusta mal por intuição, e os defaults são mantidos por quem acompanha o estado da arte
* O salt é aleatório por senha e já vem embutido no hash de saída, então não existe coluna de salt
* Verificação sempre por `argon2.verify()`, que compara em tempo constante

### Hash de código e token

* SHA-256 em hexadecimal para o código de confirmação e para o token de sessão
* Usar hash barato aqui é decisão consciente, não descuido: a proteção do código de 6 dígitos vem do limite de tentativas e da expiração, e a do token vem dos seus 256 bits de entropia. O hash existe para que um vazamento do banco não entregue credenciais utilizáveis, e para isso SHA-256 basta
* Senha é o caso oposto, porque é escolhida por humanos e tem entropia baixa, então ali o custo alto do Argon2 é justamente o ponto

## Definition of done

* Schema Drizzle das quatro tabelas escrito e migration inicial gerada e aplicada num Postgres 16 local
* Constraints, índices e cascatas conferidos no SQL gerado antes de aplicar
* Helper de hash de senha com teste cobrindo hash e verificação, incluindo senha errada
* Helper de SHA-256 com teste, verificando que a saída é estável e diferente da entrada
* `id` e `public_id` comprovadamente gerados pelo Postgres no `INSERT`, sem a aplicação informar valor
