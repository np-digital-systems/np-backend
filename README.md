# np-backend

API for the Neeliyampathi Pillaiyar Kovil management portal: accounting, events,
assets and the sanththa register.

NestJS 11 on Fastify, Prisma 7 against PostgreSQL 16.

## Getting started

Requires Node 22+ and Docker.

```bash
cp .env.example .env      # then set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET
npm install
npm run db:up             # postgres on 5433
npm run db:deploy         # apply migrations
npm run db:seed           # roles, permissions, settings, admin account
npm run start:dev
```

The API is then on `http://localhost:4000/api/v1`, Swagger on
`http://localhost:4000/api/docs`, and probes on `/health/live` and `/health/ready`.

The seed creates `admin@kovil.lk` / `ChangeMe!2026`. Override with
`SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`, and change the password before
anyone else can reach the service.

## Layout

```
prisma/
  schema.prisma        24 models, 17 enums
  migrations/          ordered, hand-reviewed; see prisma/README.md
  seed.ts              roles, permissions, base settings, admin account
src/
  main.ts              Fastify bootstrap: security, compression, versioning, Swagger
  app.module.ts        composition root; global guards, filter and interceptor
  config/              environment schema and validation (zod, fails fast at boot)
  common/              cross-cutting: decorators, DTOs, filters, guards, interceptors
  infrastructure/      technical adapters: prisma, health
  modules/             one folder per bounded context
    auth/              login, refresh rotation, sessions, RBAC
    users/             users and the sanththa register
  generated/prisma/    Prisma client output; generated, not committed
test/                  end-to-end specs
```

A module owns its controller, service, DTOs and module definition. Controllers
handle HTTP and nothing else; services hold the domain logic and are the only
callers of `PrismaService`. Anything shared by two modules moves to `common/`;
anything that talks to a system outside the process lives in `infrastructure/`.

Adding a context — vouchers, ledger, events, assets, deposits, notifications,
audit, settings — means adding a folder under `modules/` in that shape and
importing it in `app.module.ts`.

## Authentication and authorisation

Login returns a short-lived JWT access token and an opaque refresh token. Refresh
tokens are stored only as a SHA-256 hash in `user_sessions`, and rotate on every
use: presenting an already-used token fails. Passwords are hashed with Argon2id.

`JwtAuthGuard` and `PermissionsGuard` are registered globally, so every route is
authenticated unless marked `@Public()`. Authorisation is by permission, not role:

```ts
@RequirePermissions('voucher:approve')
approve(@Param('id') id: string) { ... }
```

The role-to-permission mapping is cached in process for five minutes, so a normal
request costs one JWT verification and no database round trip. Call
`PermissionsService.invalidate(role)` after changing a role's permissions — note
that this clears the cache on one instance only, so with several instances a
change takes up to five minutes to apply everywhere.

Because the access token carries the role, deactivating a user takes effect on
their next token refresh rather than immediately; `POST /auth/logout-all` and
`DELETE /users/:id` both revoke sessions to close that window.

## Latency

- Fastify with request logging handled once by pino rather than twice.
- Prisma 7's query compiler with the `pg` driver adapter — no Rust query engine
  process, and an explicit pool (`DATABASE_POOL_MAX`, default 20).
- `statement_timeout` set on every connection so a slow query cannot pin a pool
  slot; `REQUEST_TIMEOUT_MS` bounds the request itself.
- Permission lookups served from an in-process cache.
- Compression only above 1 KB, so small JSON responses skip it.
- Health probes excluded from request logs.

Set `DATABASE_POOL_MAX` deliberately: total connections across all instances must
stay under the server's `max_connections` (200 in the compose file). Put PgBouncer
in front in transaction mode if you scale past that.

There is no Redis. Two things depend on that, and both matter only once more than
one instance is running: rate limiting is per-instance, so N instances allow N
times `THROTTLE_LIMIT`; and the permission cache is per-instance, as noted above.
Introduce a shared store before scaling out horizontally.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run start:dev` | watch mode |
| `npm run build` / `start:prod` | compile / run compiled output |
| `npm run typecheck` | `tsc --noEmit` across src, test and prisma |
| `npm run lint` / `format` | ESLint (type-aware) / Prettier |
| `npm test` / `test:e2e` | unit specs / end-to-end specs |
| `npm run db:up` / `db:down` | start / stop Postgres |
| `npm run db:migrate` | create and apply a migration in development |
| `npm run db:migrate:create` | generate a migration without applying it |
| `npm run db:migrate:sql -- <name>` | scaffold a hand-written SQL migration |
| `npm run db:deploy` | apply pending migrations (CI and production) |
| `npm run db:status` / `db:drift` | migration state / schema drift check |
| `npm run db:seed` / `db:studio` | seed data / browse the database |

## Database

The schema is deliberately split: Prisma owns tables, columns, enums, foreign keys
and plain indexes, while CHECK constraints, triggers, partial and expression
indexes live in hand-written SQL migrations. Both are applied by Prisma Migrate in
one ordered history, and `npm run db:drift` proves the two stay reconciled.

Read `prisma/README.md` before changing anything under `prisma/` — it lists the
rules the database enforces on its own and the workflow for adding more.

## Deployment

`Dockerfile` builds a pruned production image. Run migrations as a separate step
before rolling out new instances:

```bash
npm run db:deploy && node dist/main
```

`SWAGGER_ENABLED` should be `false` outside development. Every environment
variable in `.env.example` is validated at boot; the process exits with a listing
of what is wrong rather than starting in a half-configured state.
