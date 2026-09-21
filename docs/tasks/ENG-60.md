# Endpoint POST /login

## Introdução

Verifica credenciais de um usuário já cadastrado e cria uma nova sessão (novo dispositivo).

## Requisitos técnicos

* Endpoint `POST /auth/login` (prefixo `/auth`, como os demais endpoints do módulo)
* Body validado via Zod: `{ email: string (formato email, ≤254), password: string (1–128) }`
* Email normalizado (trim + lowercase) no service antes da busca em `auth_users`
* Comparação de senha via `argon2.verify()` (`verifyPassword`), nunca `===`
* **Sem "quick exit"**: exatamente uma verificação argon2 por tentativa — quando o email não existe, verifica contra `DUMMY_PASSWORD_HASH` (hash argon2 pré-computado, `src/lib/password.ts`) e o resultado nunca autentica; tempo de resposta não revela se o email é cadastrado (conforme o doc OWASP)
* **Erro sempre genérico**: 401 `"Invalid credentials."` idêntico (status, body, sem cookie) para email inexistente e senha errada
* Ao autenticar: nova linha em `sessions` via `createSession` no repo (`token_hash` SHA-256 de token de 32 bytes base64url, `device_label` do user-agent ≤256 chars, `expires_at` = agora + 30 dias); cookie `session` `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, `Max-Age=2592000` — mesmo formato da sessão do `/auth/verify-code` (ENG-57); `SESSION_TTL_SECONDS` movida para `src/lib/session.ts`
* **Resposta 200 (body)**: apenas `{ user: { publicId } }` — sem token de sessão (está no cookie `HttpOnly`; devolvê-lo no JSON quebraria a proteção contra XSS), sem `id` interno, sem `email` (front não usa) e sem `password_hash`; `role` fica para o `GET /me` (ENG-61)
* **Sem rate limit/throttling nesta task**: proteção contra brute-force (throttling por conta + rate limit por IP) fica para a ENG-67; o insumo dela já existe — log de tentativa falha `{ reason: user_not_found | invalid_password, userId? }`, nunca com senha, email ou token
* Endpoint servido apenas sobre HTTPS (deploy; o cookie `Secure` já impede sessão via HTTP)

## Definição de pronto

* Contrato documentado no Swagger/OpenAPI (request e response)
* Tipagem de request/response validada via schema Zod
* Endpoint funcionando conforme os requisitos acima
