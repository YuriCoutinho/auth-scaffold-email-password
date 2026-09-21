# ENG-58 — Endpoint POST /resend-code

## Introdução

Reemite um novo código para um cadastro pendente já existente. **Este endpoint é o único caminho de reenvio** (o `/signup` idempotente nunca reenvia) e é o que mais chama o provedor de email pago — por isso o controle de custo/abuso vive aqui, em camadas.

O envio usa a interface `EmailSender` e o template de OTP criados na ENG-55; nada de falar com o provedor diretamente. Entregue como PR **stacked** sobre a branch da ENG-55 (que por sua vez está stacked na ENG-56).

## Como foi implementado

**Contrato** (`src/routes/auth/resend-code.ts`)

* `POST /auth/resend-code`, **sem body** — o pendente é identificado exclusivamente pelo `signup_session_token` do cookie `signup_session` (mesma lógica que o `/verify-code` usará; nunca recebe email, o que evita spray horizontal entre contas)
* Documentado no Swagger/OpenAPI via schemas Zod (`202`/`401`/`429`/`503`)
* Sucesso: `202 { "message": "If your signup is still pending, we sent a new confirmation code." }`, re-setando o cookie `signup_session` (mesmo token, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/auth`, `Max-Age=900`) para acompanhar o `expires_at` renovado
* Cookie ausente, token desconhecido ou pendente expirado: **401** único e genérico (`Invalid or expired signup session.`), sem diferenciar os três casos

**Fluxo do reenvio** (`src/services/resend-code.ts`, service isolado que compartilha o repo e o `EmailSender` com o signup)

* Gera novo código OTP, novo `code_hash`, reseta `code_attempts` para 0 e renova `expires_at` (+15 min, mesmo TTL do `/signup`)
* Usa as colunas `last_sent_at` e `code_send_count` de `pending_signups` (criadas na ENG-54): `code_send_count` conta envios de email (distinto de `code_attempts`, que conta verificações erradas)

**Controles de custo — sempre checados ANTES de gravar e de chamar o provedor**, na ordem teto → cooldown:

1. **Teto por pendente**: máximo de **5 envios no total** (contando o do `/signup`) via `code_send_count`; atingido, responde **429** (`Code resend limit reached. Wait for the current signup to expire and sign up again.`) — só resta o pendente expirar e o usuário se cadastrar de novo
2. **Cooldown por pendente**: 60s desde `last_sent_at`, respondendo **429** (`Please wait before requesting another code.`), sem `Retry-After`, sem tocar o banco além da leitura e sem chamar o provedor. **Exceção herdada da ENG-55**: quando `code_send_count = 0` (falha de envio compensada — nenhum email entregue para o código atual), o cooldown é pulado, já que `last_sent_at` é NOT NULL e fica para trás nesses casos

Rate limit por IP fica para a ENG-67; o contador desabilitado no front (60s) é UX, não segurança — a barreira real é server-side.

**Ordem gravar-primeiro-enviar-depois, com compensação total em falha**

* Atualiza a linha (novo `code_hash`, `expires_at`, `code_attempts = 0`, `last_sent_at = now`, `code_send_count + 1`) e então envia via `EmailSender` (template da ENG-55)
* Se o envio falhar sincronamente: restaura **todos os cinco valores anteriores** da linha (capturados antes do update, via o mesmo método de update do repo) — o reenvio falhado não consome cota nem inicia cooldown e **o código antigo volta a valer** — e responde **503** genérico (mesma mensagem do `/signup`), sem re-setar o cookie. O restore é best-effort (falha do restore é logada e a resposta continua 503)
* Logs usam só `pendingSignupId` e `providerMessageId`; o código nunca aparece em log, nunca em claro no banco; erro de provedor logado com status/corpo da resposta (`EmailProviderError`)

**Repo** (`src/db/signup-repo.ts`): novos métodos `findPendingSignupBySessionToken` (retorna id, email, code_hash, code_attempts, last_sent_at, code_send_count, expires_at) e `updatePendingSignupResendState` (usado tanto para o novo estado quanto para o restore da compensação). Os deps dos services passaram a usar `Pick<SignupRepo, ...>`, declarando só os métodos que cada um usa.

Limitação conhecida e aceita: o check-then-act (teto/cooldown → update → envio) não é atômico sob requisições concorrentes do mesmo cookie; irrelevante para fluxo single-user de signup e mitigável pela ENG-67.

## Definição de pronto

* Contrato documentado no Swagger/OpenAPI (request e response) ✔
* Tipagem de request/response validada via schema Zod ✔
* Testes **unitários** (Vitest, banco mockado — integração fica para a ENG-71) com o `FakeEmailSender` e mocks, cobrindo: reenvio feliz (novo hash, attempts zerados, expiry renovado, ordem gravar-antes-de-enviar), cooldown (e a exceção `code_send_count = 0`), teto sem tocar banco/provedor, falha de envio com compensação campo a campo (cota/cooldown intactos, restore falhando ainda responde 503), sessão inválida/expirada, e os cinco status na rota com cookie re-setado só no sucesso ✔
* Endpoint funcionando conforme os requisitos acima ✔
