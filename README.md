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
  common/              cross-cutting: decorators, DTOs, filters, guards, money, enums
  infrastructure/      technical adapters: prisma, audit, health
  modules/             one folder per bounded context
    auth/              login, refresh rotation, sessions, passwords, RBAC
    users/             users, staff accounts and the sanththa register
    roles/             the role matrix and the permission catalogue
    sponsors/          standing sponsorship of event-type instances
    settings/          temple, locale and accounting policy
    financial-years/   opening, closing and freezing a year
    accounts/          the chart of accounts
    funds/ projects/   earmarked money and the work it pays for
    bank-accounts/     where the money sits, and the head it posts through
    vouchers/          the receipt and payment lifecycle
    ledger/            posted entries, the cash book and the bank book
    fixed-deposits/    deposits, renewals and accrued interest
    assets/            the asset register and depreciation
    reports/           trial balance, income statement, summaries
  generated/prisma/    Prisma client output; generated, not committed
test/                  end-to-end specs
```

A module owns its controller, service, DTOs and module definition. Controllers
handle HTTP and nothing else; services hold the domain logic and are the only
callers of `PrismaService`. Anything shared by two modules moves to `common/`;
anything that talks to a system outside the process lives in `infrastructure/`.

Adding a context — events, notifications, the audit-log reader — means adding a
folder under `modules/` in that shape and importing it in `app.module.ts`.

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

## Accounting

### Nothing is stored that can be derived

Balances are never written down. An account's balance is its opening position
plus the year's postings, read through `LedgerQueryService` — the single
definition of "what the ledger says", which always excludes vouchers that have
not reached `Posted`. Fund positions, project spend, bank balances and every
report are computed the same way, so the chart of accounts cannot disagree with
the entries that produced it.

Opening positions are recorded once, on the ledger head. Creating a bank account
with an opening balance writes it to the head in the same transaction, so the
chart of accounts, the bank book, the bank account record and the dashboard
summary all read the same number.

### The voucher lifecycle

```
Draft ──submit──▶ Pending Approval ──approve──▶ Approved ──post──▶ Posted
  │                      │              │                            (frozen)
  │                      │              └──reject──▶ Rejected ──edit──▶ Draft
  └──────cancel──────────┴──▶ Cancelled
```

Only `Posted` touches the ledger. Everything before it is a claim about money,
not a record of it. Posting writes both legs and the status change in one
transaction, and the deferred `ledger_balanced` trigger checks the voucher
balances at commit — a half-written entry cannot reach the books.

A voucher names one head and one amount; the contra side is implied by the
payment mode. A receipt debits where the money landed and credits the income
head that explains it; a payment debits the expense head and credits where the
money came from. Only the contra leg carries `bankAccountId`, which is what lets
the bank book be a filter over the ledger rather than a parallel list.

Cash posts through the head named in `accounting.cashAccountId`; set it under
`PATCH /settings/accounting` before the first cash voucher.

**Approval is a second pair of eyes.** You cannot approve a voucher you raised.
An administrator can lift that with `allowSelfApproval` in the accounting
settings, for a temple too small to separate the two roles.

References are allocated by a single `INSERT … ON CONFLICT DO UPDATE …
RETURNING` against `voucher_sequences`, so two cashiers raising a voucher at the
same moment cannot be handed the same `RV-2026-0001`.

Without `voucher:manage-all`, a user sees and acts on only the vouchers they
raised.

### Closing a year

Closing snapshots income, expenditure and the voucher count into the row and
refuses further postings. The figures become frozen rather than live, so a later
correction cannot silently rewrite a published statement. A year with unposted
vouchers will not close, and a closed year cannot be reopened.

### Enum values on the wire

Prisma names an enum member `onHold` and stores `on-hold`; the client only ever
sees the stored spelling. `src/common/enums/wire.ts` translates at the API
boundary so the published contract matches the frontend's own types rather than
leaking the ORM's identifier rules. Its spec asserts every value against the
list the frontend switches on — if the two ever part company, that suite says so.

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
| Settings | `GET /settings` `PATCH /settings/temple` `PATCH /settings/accounting` |
| Years | `GET /financial-years` `GET /financial-years/current` `POST /financial-years` `POST /financial-years/:id/open` `POST /financial-years/:id/close` |
| Masters | `/accounts` `/funds` `/projects` `/bank-accounts` — full CRUD, plus `GET /funds/:id/breakdown` |
| Vouchers | `GET /vouchers` `POST /vouchers` `PATCH /vouchers/:id` and `/submit` `/approve` `/reject` `/post` `/cancel` |
| Books | `GET /ledger` `GET /cash-book` `GET /bank-book?bankAccountId=` |
| Holdings | `/fixed-deposits` (+ `/mature` `/close` `/renew`), `/assets` (+ `/dispose`, `/by-category`) |
| Reports | `GET /reports/trial-balance` `/income-statement` `/accounting-summary` `/finance-summary` |

Users and roles require `user:manage`. Sponsors require `event-sponsor:view` to
read and `event-sponsor:manage` to write or to see contact details. The
accounting routes use the catalogue's own permissions — `account:*`, `fund:*`,
`project:*`, `bank-account:*`, `voucher:*`, `transaction:view`, `cash-book:view`,
`bank-book:view`, `fixed-deposit:*`, `asset:*` and `report:generate`. Financial
years read on `transaction:view` and are opened or closed on `settings:manage`;
the catalogue has no year-specific permission, and closing a year is an
administrator's act.

Bank account numbers are masked to the last four digits on the way out. The full
number is stored but never leaves the server.

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
