# ENG-57 — Endpoint POST /verify-code

## Introdução

Confirma o código, promove o cadastro pendente para `auth_users` e realiza autologin. Não envolve envio de email (reemissão de código é responsabilidade exclusiva do `/resend-code`). Entregue como PR **stacked** sobre a branch da ENG-58 (pilha: ENG-56 → ENG-55 → ENG-58 → ENG-57).

## Como foi implementado

**Contrato** (`src/routes/auth/verify-code.ts`)

* `POST /auth/verify-code`, body validado via Zod: `{ code: string }` com `^\d{6}$` — formato inválido cai no 400 automático de validação (não vaza nada de conta); **nunca recebe** `email` como parâmetro (busca pelo `signup_session_token` do cookie, o que evita spray horizontal entre contas)
* Documentado no Swagger/OpenAPI via schemas Zod (`200`/`400`/`401`)
* **Resposta de erro única e genérica**: `401 { "message": "Invalid or expired code." }`, byte-idêntica nos cinco casos — cookie ausente, token desconhecido, pendente expirado, código errado e código invalidado por excesso de tentativas

**Verificação** (`src/services/verify-code.ts`)

* Busca o `pending_signup` pelo `signup_session_token` do cookie; não encontrado ou expirado → erro genérico
* Compara o código recebido (hasheado SHA-256) com `code_hash` salvo
* **Contador de tentativas**: `code_attempts >= 5` é checado **antes** da comparação — código esgotado fica inutilizável mesmo se o valor correto aparecer depois (sem flag nova no banco); sai do limbo via `/resend-code` (que zera attempts) ou expirando. Cada tentativa errada incrementa `code_attempts` via SQL (`code_attempts + 1`, sem read-modify-write)
* Logada toda tentativa falha (`pendingSignupId` + contagem, nunca o código) e a invalidação ao atingir 5 — insumo para detecção de padrão de ataque

**Promoção + autologin — transaction atômica** (`src/db/signup-repo.ts`, método `promotePendingSignup`)

Se o código bate, executa em **uma única transaction** (decisão da task: a sessão entra **dentro** da transaction, não depois — tudo-ou-nada; se qualquer parte falhar, o pendente e o código continuam válidos para retry):

1. `INSERT` em `auth_users` (gera `public_id` e `created_at` novos)
2. `DELETE` do registro em `pending_signups`
3. `INSERT` em `sessions`: `token_hash` (SHA-256 do token; o token em claro nunca vai ao banco), `device_label` (User-Agent cru truncado a 256 chars, `null` se ausente — sem lib de parsing) e `expires_at`

* Token de sessão: 32 bytes `randomBytes` em base64url (256 bits), gerado por `generateSessionToken()`
* **TTL da sessão: 30 dias** (`SESSION_TTL_SECONDS`), mesmo valor no `expires_at` e no `Max-Age`
* Resposta 200 descarta o cookie `signup_session` (`clearCookie`, `Path=/auth`) e seta o cookie da sessão real: **`session`**, `HttpOnly`, `Secure`, `SameSite=Strict`, **`Path=/`** (vale para a API toda), `Max-Age=2592000` — mesmo formato de sessão que o `/login` (ENG-60) usará
* Cria a linha de `profiles` (`{ user_id }`, resto default/null) na mesma transação da promoção — invariante introduzido pela ENG-73, que revogou a decisão lazy original desta task

**Limitações conhecidas e aceitas**

* Dois verifies simultâneos do mesmo token podem estourar o UNIQUE de `auth_users` (500) — mesmo perfil de risco aceito no `/resend-code`; mitigável pela ENG-67
* Sem rate limit por IP nesta task (ENG-67); a barreira é o limite de 5 tentativas por código
* Endpoint servido apenas sobre HTTPS

## Definição de pronto

* Contrato documentado no Swagger/OpenAPI (request e response) ✔
* Tipagem de request/response validada via schema Zod ✔
* Testes **unitários** (Vitest + mocks, sem banco real — integração fica para a ENG-71) cobrindo: código correto (promoção atômica + autologin, com asserts dos dois INSERTs e do DELETE, hash do token de sessão ≠ token em claro), código errado (incremento + sem cookie), expirado, excesso de tentativas (sem comparar nem incrementar), cookie ausente e formato inválido (400) ✔
* Endpoint funcionando conforme os requisitos acima ✔
