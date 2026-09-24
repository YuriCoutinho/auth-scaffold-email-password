# Tasks

Este diretório documenta, etapa por etapa, como este backend de autenticação foi construído. Cada arquivo traz o que a etapa entrega, quais decisões técnicas foram tomadas e por quê.

A ordem numérica é a ordem em que vale a pena ler, e cada documento descreve o estado final do código, não o caminho até ele. Quando uma etapa posterior muda uma decisão anterior, o documento da etapa anterior é atualizado, para que ler os dezessete na ordem leve a um projeto igual a este. Juntos, eles funcionam como um guia para levantar um fluxo de cadastro e login com email e senha do zero.

## Estrutura de cada documento

| Seção | O que traz |
| --- | --- |
| Introdução | O problema que a etapa resolve e o raciocínio por trás da solução |
| Requisitos técnicos | As decisões, com o motivo de cada uma e o que configurar |
| Definition of done | O que precisa estar verificável antes de considerar a etapa pronta |

## Ordem de leitura

| # | Documento | O que entrega |
| --- | --- | --- |
| 01 | [Project setup](01-project-setup.md) | Fastify com arquitetura de plugins e autoload, TypeScript strict, Drizzle, Postgres, validação de ambiente, error handler global, pre-commit e CI |
| 02 | [Data modeling](02-data-modeling.md) | As quatro tabelas do fluxo e os utilitários de hash, com o porquê de cada escolha |
| 03 | [Signup endpoint](03-signup-endpoint.md) | Conta não confirmada, código de 6 dígitos, idempotência e resposta que não revela contas |
| 04 | [Signup OTP email](04-signup-otp-email.md) | Envio de email atrás de uma interface, com driver de teste, de desenvolvimento e de produção |
| 05 | [Resend code endpoint](05-resend-code-endpoint.md) | Reenvio com cooldown, teto de envios e compensação quando a entrega falha |
| 06 | [Verify code endpoint](06-verify-code-endpoint.md) | Confirmação do código, promoção atômica para conta real e autologin |
| 07 | [Agnostic profile](07-agnostic-profile.md) | Nome e papel como colunas de `users`, sem tabela de perfil |
| 08 | [Login endpoint](08-login-endpoint.md) | Verificação de credenciais em tempo constante e sessão por dispositivo |
| 09 | [Session hook and current user endpoint](09-session-hook-and-current-user-endpoint.md) | Hook que valida a sessão em toda rota protegida e o endpoint que devolve o usuário autenticado |
| 10 | [Logout endpoint](10-logout-endpoint.md) | `DELETE /sessions/current`, encerramento idempotente da sessão do dispositivo atual, com a fatia de sessão ganhando porta, adaptador e o decorator `fastify.sessions` |
| 11 | [Logout all endpoint](11-logout-all-endpoint.md) | `DELETE /sessions`, remoção em lote das sessões do usuário, com a sessão atual sempre preservada e o hook publicando a sessão do request |
| 12 | [Sessions list endpoint](12-sessions-list-endpoint.md) | `GET /sessions`, lista das sessões ativas do usuário, com o id uuid de cada sessão e a sessão atual sinalizada, para uma tela de dispositivos conectados |
| 13 | [Revoke session endpoint](13-revoke-session-endpoint.md) | `DELETE /sessions/:sessionId`, remoção de uma sessão escolhida pelo id, com resposta uniforme e autorização dentro da própria consulta |
| 14 | [Change password endpoint](14-change-password-endpoint.md) | `POST /auth/change-password`, troca de senha com confirmação da senha atual, remoção das demais sessões na mesma transação e aviso por email |
| 15 | [Password reset endpoints](15-password-reset-endpoints.md) | `POST /auth/forgot-password` e `POST /auth/reset-password`, recuperação por código de seis dígitos com resposta genérica, envio fora do caminho da requisição para não vazar quais emails existem, remoção de todas as sessões e autologin |
| 16 | [Rate limit and credential throttling](16-rate-limit-and-credential-throttling.md) | Bloqueio progressivo por email guardado no banco, com `429` e `Retry-After` no login e na troca de senha, mais limite de requisições por IP em toda rota via `@fastify/rate-limit` |
| 17 | [Security headers and CORS](17-security-headers-and-cors.md) | Cabeçalhos de segurança de resposta via `@fastify/helmet`, com a CSP restrita a produção, e CORS limitado à origem do frontend vinda do ambiente, com credenciais liberadas para o cookie de sessão |
