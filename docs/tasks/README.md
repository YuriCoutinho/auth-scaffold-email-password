# Tasks

Este diretório documenta, etapa por etapa, como este backend de autenticação foi construído. Cada arquivo traz o que a etapa entrega, quais decisões técnicas foram tomadas e por quê.

A ordem numérica é a ordem em que as etapas foram implementadas, e é a ordem em que vale a pena ler. Juntas, elas funcionam como um guia para levantar um fluxo de cadastro e login com email e senha do zero.

## Estrutura de cada documento

| Seção | O que traz |
| --- | --- |
| Introdução | O problema que a etapa resolve e o raciocínio por trás da solução |
| Requisitos técnicos | As decisões, com o motivo de cada uma e o que configurar |
| Definition of done | O que precisa estar verificável antes de considerar a etapa pronta |

## Ordem de leitura

| # | Documento | O que entrega |
| --- | --- | --- |
| 01 | [Project setup](01-project-setup.md) | Fastify, TypeScript strict, Drizzle, Postgres, validação de ambiente, pre-commit e CI |
| 02 | [Data modeling](02-data-modeling.md) | As quatro tabelas do fluxo e os utilitários de hash, com o porquê de cada escolha |
| 03 | [Signup endpoint](03-signup-endpoint.md) | Cadastro pendente, código de 6 dígitos, idempotência e resposta que não revela contas |
| 04 | [Signup OTP email](04-signup-otp-email.md) | Envio de email atrás de uma interface, com driver de teste, de desenvolvimento e de produção |
| 05 | [Resend code endpoint](05-resend-code-endpoint.md) | Reenvio com cooldown, teto de envios e compensação quando a entrega falha |
| 06 | [Verify code endpoint](06-verify-code-endpoint.md) | Confirmação do código, promoção atômica para conta real e autologin |
| 07 | [Agnostic profile](07-agnostic-profile.md) | A fronteira entre dado de autenticação e dado de produto |
| 08 | [Login endpoint](08-login-endpoint.md) | Verificação de credenciais em tempo constante e sessão por dispositivo |
