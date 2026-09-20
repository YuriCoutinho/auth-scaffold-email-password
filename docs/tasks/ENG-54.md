# ENG-54 — Modelagem de dados

## Introdução

Criar o schema Drizzle das tabelas do fluxo de auth, separadas de qualquer dado de produto/perfil. O raciocínio por trás das escolhas fica no documento "Decisões de Arquitetura do Backend de Autenticação".

## Requisitos técnicos

Todas as colunas de tempo são `timestamptz`. FKs com `ON DELETE CASCADE` (hard delete, alinhado à LGPD: dado pessoal de conta é apagado de verdade). Constraints `UNIQUE` já criam índice automaticamente no Postgres — índices explícitos só onde não há unicidade.

**Tabela** `pending_signups` (cadastro ainda não confirmado)

| Campo | Tipo | Regra |
| -- | -- | -- |
| `id` | `integer`, `GENERATED ALWAYS AS IDENTITY` | PK interna, gerada pelo Postgres |
| `email` | `text` | `UNIQUE`, `NOT NULL` |
| `password_hash` | `text` | `NOT NULL` |
| `code_hash` | `text` | `NOT NULL`; hash do código OTP de 6 dígitos |
| `code_attempts` | `integer` | `NOT NULL DEFAULT 0`; verificações erradas do código atual |
| `last_sent_at` | `timestamptz` | `NOT NULL DEFAULT now()`; cooldown de reenvio |
| `code_send_count` | `integer` | `NOT NULL DEFAULT 1`; emails com código enviados (o insert é o 1º) |
| `signup_session_token` | `text` | `UNIQUE`, `NOT NULL`, alta entropia (≥128 bits) |
| `expires_at` | `timestamptz` | `NOT NULL`; indexado (limpeza futura) |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |

**Tabela** `auth_users` (conta confirmada e criada de fato)

| Campo | Tipo | Regra |
| -- | -- | -- |
| `id` | `integer`, `GENERATED ALWAYS AS IDENTITY` | PK interna, nunca exposta |
| `public_id` | `uuid` | `UNIQUE`, `NOT NULL`, `DEFAULT gen_random_uuid()`; identificador exposto em URL/JWT/API |
| `email` | `text` | `UNIQUE`, `NOT NULL` |
| `password_hash` | `text` | `NOT NULL` |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()`; renovado a cada alteração (ex.: troca/recuperação de senha) |

**Tabela** `profiles` (dado de produto — cadastro de profissionais do PICC; relação 1:1 com `auth_users`)

| Campo | Tipo | Regra |
| -- | -- | -- |
| `id` | `integer`, `GENERATED ALWAYS AS IDENTITY` | PK interna |
| `user_id` | `integer` | FK → `auth_users.id`, `UNIQUE`, `NOT NULL`, cascade |
| `full_name` | `text` | nullable; nome completo do profissional |
| `role` | enum `profile_role` (`nurse` \| `admin`) | `NOT NULL DEFAULT 'nurse'`; perfil de acesso |
| `coren` | `text` | nullable, `UNIQUE`; registro no conselho (múltiplos NULL permitidos) |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()`; renovado a cada edição de perfil |

**Tabela** `sessions` (uma linha por dispositivo/login, ativo ou recém-revogado)

| Campo | Tipo | Regra |
| -- | -- | -- |
| `id` | `integer`, `GENERATED ALWAYS AS IDENTITY` | PK interna |
| `user_id` | `integer` | FK → `auth_users.id`, `NOT NULL`, cascade, indexado |
| `token_hash` | `text` | `UNIQUE`, `NOT NULL` |
| `device_label` | `text` | nullable; ex. "Chrome no Windows" |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |
| `expires_at` | `timestamptz` | `NOT NULL`; indexado (limpeza futura) |
| `last_used_at` | `timestamptz` | nullable |
| `revoked_at` | `timestamptz` | nullable; NULL = nunca revogada (expiração não é revogação) |
| `revoked_reason` | `text` | nullable; ex. `user_logout`, `logout_all`, `security_event` |

**Validação de sessão** (hook de autenticação): `WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > now()`

**Geração de** `id` **e** `public_id`**:** ambos gerados pelo próprio Postgres no `INSERT` (`IDENTITY` e `gen_random_uuid()`), nunca pela aplicação — atomicidade sob concorrência sem round-trip extra.

**Hash de senha: Argon2id** via `node-argon2`, com os **defaults da biblioteca** (sem configuração própria — confiar nos parâmetros mantidos pelos autores). Salt aleatório por senha, embutido no hash de saída. Verificação sempre via `argon2.verify()` (tempo-constante), nunca comparação direta.

**Hash do código OTP e do token de sessão:** SHA-256 (hex). A proteção do código vem de `code_attempts` + `expires_at`; a do token, da própria entropia — o hash protege só contra vazamento do banco.

## Definição de pronto

* Schema Drizzle das quatro tabelas escrito e migration única gerada e aplicada com sucesso num Postgres 15+ local
* Constraints e índices conferidos no SQL da migration gerada
* Helper de hash de senha (Argon2id) com testes de hash + verify
* Helper de hash SHA-256 (código OTP e token de sessão) com teste
* `id`/`public_id` comprovadamente gerados pelo Postgres no `INSERT`
