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
  infrastructure/      technical adapters: prisma, audit, health
  modules/             one folder per bounded context
    auth/              login, refresh rotation, sessions, passwords, RBAC
    users/             users, staff accounts and the sanththa register
    roles/             the role matrix and the permission catalogue
    sponsors/          standing sponsorship of event-type instances
  generated/prisma/    Prisma client output; generated, not committed
test/                  end-to-end specs
```

A module owns its controller, service, DTOs and module definition. Controllers
handle HTTP and nothing else; services hold the domain logic and are the only
callers of `PrismaService`. Anything shared by two modules moves to `common/`;
anything that talks to a system outside the process lives in `infrastructure/`.

Adding a context — vouchers, ledger, events, assets, deposits, notifications,
settings — means adding a folder under `modules/` in that shape and importing it
in `app.module.ts`.

## Authentication and authorisation

Login returns a short-lived JWT access token and an opaque refresh token. Refresh
tokens are stored only as a SHA-256 hash in `user_sessions`, and rotate on every
use: presenting an already-used token fails. Passwords are hashed with Argon2id,
and a failed login still pays the hashing cost so a missing account and a wrong
password take the same time.

`JwtAuthGuard` and `PermissionsGuard` are registered globally, so every route is
authenticated unless marked `@Public()`. Authorisation is by permission, not role:

```ts
@RequirePermissions('voucher:approve')
approve(@Param('id') id: string) { ... }
```

The permission catalogue is the one the frontend gates its UI on
(`src/features/auth/types/permission.ts`) — 42 permissions across five groups, with
the same role matrix. `prisma/seed.ts` is authoritative: it upserts the catalogue
and removes any permission no longer in it.

The role-to-permission mapping is cached in process for five minutes, so a normal
request costs one JWT verification and no database round trip.
`PUT /roles/:code/permissions` invalidates that role immediately — note it clears
one instance only, so with several instances a change takes up to five minutes to
apply everywhere.

Because the access token carries the role, a role change or deactivation would
otherwise take effect only at the next refresh. Both revoke the user's sessions so
the change lands at once. Two guards protect the portal from being locked out: you
cannot change your own role or deactivate yourself, and the last active
administrator cannot be demoted, deactivated, or stripped of `user:manage`.

### Withheld rather than hidden

Roles without `event-sponsor:manage` never receive a sponsor's phone or email —
`SponsorsService` nulls them before the response is built, matching the rule the
frontend states in `lib/event-privacy.ts`. Omitting a field from the markup while
still sending it in the payload would not be access control.

## Audit trail

Every mutation in these modules writes to `audit_log` through `AuditService`:
sign-in and sign-out, user creation and updates, role and permission changes,
password resets, and sponsor assignments. Entries carry the actor, their role at
the time, the source IP, and a field-level diff where one applies.

The table is append-only at the database level, so an audit row cannot be edited
or deleted by the application — including by this service. An audit write that
fails is logged and swallowed rather than failing the request it describes.

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

## API surface

| Area | Routes |
| --- | --- |
| Auth | `POST /auth/login` `POST /auth/refresh` `POST /auth/logout` `POST /auth/logout-all` `GET /auth/me` `GET /auth/sessions` `DELETE /auth/sessions/:id` `POST /auth/change-password` |
| Users | `GET /users` `GET /users/:id` `POST /users` `PATCH /users/:id` `PATCH /users/:id/role` `POST /users/:id/reset-password` `POST /users/:id/activate` `DELETE /users/:id` |
| Register | `POST /users/:id/enrol` `PATCH /users/:id/subscription`, plus `?membersOnly` and `?subscribes` on `GET /users` |
| Roles | `GET /roles` `GET /roles/permissions` `GET /roles/:code` `PUT /roles/:code/permissions` |
| Sponsors | `GET /sponsors` `GET /sponsors/directory` `GET /sponsors/:id` `POST /sponsors` `PATCH /sponsors/:id` `DELETE /sponsors/:id` |

Users and roles require `user:manage`. Sponsors require `event-sponsor:view` to
read and `event-sponsor:manage` to write or to see contact details.

Member numbers are never supplied by a caller: setting `joinedOn` — through
`POST /users`, `PATCH /users/:id` or `POST /users/:id/enrol` — makes the database
allocate the next `S-00n`, and it can never be changed afterwards.

Event types themselves are read-only here; their CRUD belongs to the events module,
which is not built yet. `GET /sponsors` composes each assignment with its event
type, its sponsor, an `instanceLabel` ("Week 24", "Valarpirai", or the temple's own
name for the day) and the count of dated occurrences it covers this year, matching
the frontend's `SponsorAssignment` type.

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
