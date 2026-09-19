# auth-scaffold-email-password

Backend de autenticação com email e senha. Fastify + TypeScript strict + Drizzle ORM (Postgres) + Zod.

## Pré-requisitos

- Node 24 (via [nvm](https://github.com/nvm-sh/nvm) ou [mise](https://mise.jdx.dev) — o repo tem `.nvmrc` e `.tool-versions`)
- corepack (vem com o Node; gerencia o pnpm pinado no `package.json`)
- Docker + Docker Compose (para o Postgres local)

## Setup

```sh
corepack enable
pnpm install
cp .env.sample .env   # e preencha os valores
docker compose up -d
pnpm db:migrate
```

## Rodar

```sh
pnpm dev
```

Healthcheck: `GET http://localhost:3000/health` → `{"status":"ok"}`.

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

## Estrutura

- `src/routes` — rotas HTTP (plugins Fastify)
- `src/db` — schema Drizzle e client Postgres
- `src/services` — regras de negócio (vazia por enquanto)
- `src/config` — configuração validada de ambiente (Zod, fail-fast)
