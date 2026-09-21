# auth-scaffold-email-password

[![CI](https://github.com/YuriCoutinho/auth-scaffold-email-password/actions/workflows/ci.yml/badge.svg)](https://github.com/YuriCoutinho/auth-scaffold-email-password/actions/workflows/ci.yml)

Backend de autenticação com email e senha. Fastify + TypeScript strict + Drizzle ORM (Postgres) + Zod.

## Pré-requisitos

- Node 24 (via [nvm](https://github.com/nvm-sh/nvm) ou [mise](https://mise.jdx.dev) — o repo tem `.nvmrc` e `.tool-versions`)
- corepack (vem com o Node; gerencia o pnpm pinado no `package.json`)
- Docker + Docker Compose (para o Postgres e o Mailpit locais)

## Setup

```sh
corepack enable
pnpm install
cp .env.sample .env   # e preencha os valores
docker compose up -d
pnpm db:migrate
```

O `docker compose up -d` sobe o Postgres e também o [Mailpit](https://mailpit.axllent.org), um servidor de email para desenvolvimento: a aplicação entrega emails via SMTP em `localhost:1025` e você visualiza as mensagens na interface web em `http://localhost:8025`.

## Rodar

```sh
pnpm dev
```

Healthcheck: `GET http://localhost:3000/health` → `{"status":"ok"}`.

## Envio de email

O driver de envio é escolhido pela variável `EMAIL_DRIVER`:

- `fake` — usado nos testes; as mensagens ficam apenas em memória, nada é enviado.
- `mailpit` — dev local; entrega via SMTP no Mailpit (`localhost:1025`) e as mensagens aparecem na UI em `http://localhost:8025`.
- `resend` — produção; envia pela API do [Resend](https://resend.com) e exige `RESEND_API_KEY`. Enquanto não houver domínio verificado, o remetente `onboarding@resend.dev` só entrega para o email da própria conta Resend.

`EMAIL_FROM` (remetente) é obrigatório para `mailpit` e `resend`.

## Scripts

| Script | O que faz |
| --- | --- |
| `pnpm dev` | Sobe o servidor em watch mode (tsx) |
| `pnpm build` | Compila TypeScript para `dist/` |
| `pnpm start` | Roda o build compilado |
| `pnpm test` | Roda os testes (Vitest) |
| `pnpm lint` | Lint + format check (Biome) |
| `pnpm format` | Aplica lint + format (Biome) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm db:generate` | Gera migrations a partir do schema (drizzle-kit) |
| `pnpm db:migrate` | Aplica migrations no banco |

Qualidade: a CI (GitHub Actions) roda `typecheck` + `lint` + `test` + `build` em toda PR e push na `main`; o pre-commit local roda lint-staged (Biome) + testes.

## Estrutura

- `src/routes` — rotas HTTP (plugins Fastify)
- `src/db` — schema Drizzle e client Postgres
- `src/services` — regras de negócio (signup) e envio de email (drivers em `src/services/email`)
- `src/config` — configuração validada de ambiente (Zod, fail-fast)
