# ENG-56 — Endpoint POST /signup

## Introdução

Recebe email e senha, cria o cadastro pendente e gera o código de verificação de 6 dígitos. O endpoint ficou completo em `POST /auth/signup` (prefixo `/auth` agrupa todo o fluxo e facilita rate limit e hooks por prefixo na ENG-67), **mas o disparo do email ainda não funciona**: o código é entregue a um ponto de integração injetado que, por ora, é um stub que não envia nada. A integração com envio real (fake nos testes, Mailpit em dev, Resend em produção) é a ENG-55.

## Requisitos técnicos

* Body validado via schema Zod: `{ email: string, password: string }`
* **Validação de email**: `z.email()` do Zod no backend, independente do front, com `maxLength` 254 (limite prático do RFC)
* **Validação de senha**: comprimento entre 15 e 128 caracteres (mínimo NIST SP800-63B sem MFA; máximo acima dos 64 exigidos, seguro para Argon2), sem regra de composição, aceitando todos os caracteres incluindo unicode e espaço, sem truncamento silencioso
* **Bloqueio de senhas vazadas**: checagem contra a API Pwned Passwords do HIBP via k-anonymity (só o prefixo de 5 caracteres do SHA-1 sai na requisição), com `fetch` nativo do Node. **Fail-open** com timeout de 2s: indisponibilidade do HIBP não bloqueia cadastro (loga aviso). Rejeição em qualquer ocorrência (`count > 0`), respondendo 400 com mensagem específica sobre a senha ("apareceu em vazamento, escolha outra") — fala da senha, nada sobre contas
* **Erros de validação (400)**: detalhados por campo, via comportamento default do type provider Zod do Fastify — não fere anti-enumeração (nada sobre contas existentes é revelado)
* **Normalização**: email `trim` + lowercase antes de qualquer verificação de unicidade ou gravação (`Foo@Gmail.com` e `foo@gmail.com` colidem)
* **Idempotência**: se já existe `pending_signup` **não expirado** para o email normalizado, não cria duplicata nem reenvia código; retorna a mesma resposta genérica com o `signup_session_token` já armazenado (reenvio explícito é responsabilidade do `/resend-code`)
* **Pendente expirado**: o novo cadastro substitui o expirado atomicamente — `INSERT ... ON CONFLICT (email) DO UPDATE` (Drizzle `onConflictDoUpdate`) trocando `password_hash`, `code_hash`, `signup_session_token`, `expires_at`, zerando `code_attempts` e renovando `created_at`, `last_sent_at` e `code_send_count = 1`. O UNIQUE de `email` nunca estoura como erro para o usuário; o upsert também garante atomicidade sob requisições concorrentes do mesmo email
* Senha hasheada (Argon2id) antes de qualquer gravação
* **TTL do cadastro pendente: 15 minutos** (`expires_at`), o mesmo valor do `Max-Age` do cookie
* Código OTP de 6 dígitos via `crypto.randomInt` (com padding), hasheado SHA-256 (`code_hash`) e salvo junto com `signup_session_token` (32 bytes `randomBytes` em base64url, 256 bits); o código em claro existe só em memória no momento da geração — nunca em log, nunca no banco, nunca na resposta
* **Ponto de integração de email (stub nesta task)**: após gravar o pendente (ordem gravar-primeiro-enviar-depois, coberta por teste), o service entrega destinatário e código à dependência `EmailSender` injetada na composição do app; a implementação atual é um no-op. A ENG-55 define as implementações reais (fake/Mailpit/Resend), tratamento de falha do provedor e template
* **Injeção de dependências**: `buildApp(deps)` recebe `{ db, emailSender, checkPwnedPassword }`; `server.ts` monta as implementações reais. Rota fina em `src/routes/auth/signup.ts`, lógica de negócio em `src/services/signup.ts` (testável sem Fastify)
* Cookie `signup_session` setado na resposta 202: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/auth`, `Max-Age=900`
* **Resposta sempre genérica**: `202 Accepted` + `{ "message": "If the email is valid, we sent a confirmation code." }`, byte-idêntica nos três caminhos (cadastro criado, pendente não expirado, conta já confirmada) — 202 é semanticamente honesto (envio de email é assíncrono) e não vaza criação de recurso. Quando o email pertence a conta confirmada, nenhum código é gerado nem entregue ao ponto de integração, e o cookie recebe um token descartável
* **Sem rate limit nesta task**: proteção por IP fica para a ENG-67; double-click/conexão ruim é resolvido pela idempotência acima
* Endpoint servido apenas sobre HTTPS

## Definição de pronto

* Contrato documentado no Swagger/OpenAPI: `@fastify/swagger` gerando a spec a partir dos schemas Zod (via `fastify-type-provider-zod`), com `@fastify/swagger-ui` servindo `/docs` desabilitável em produção
* Tipagem de request/response validada via schema Zod
* Testes **unitários** (Vitest + mocks, sem banco real — integração fica para a ENG-71) cobrindo validações, idempotência, substituição de pendente expirado, resposta genérica/anti-enumeração, ordem gravar-antes-de-enviar e senha vazada, com a camada de banco mockada e o stub injetado capturando destinatário e código gerado
* Endpoint funcionando conforme os requisitos acima, com o disparo real de email explicitamente fora do escopo (ENG-55)
