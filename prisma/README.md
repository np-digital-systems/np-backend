# Database layer

The schema is split across two layers on purpose, because Prisma's schema language
cannot express everything PostgreSQL can.

| Layer | Owns | Where it lives |
| --- | --- | --- |
| Prisma | tables, columns, enums, foreign keys, plain indexes, unique constraints | `schema.prisma` |
| SQL | CHECK constraints, partial and expression indexes, exclusion constraints, sequences, trigger functions | `migrations/*_integrity/migration.sql` and later hand-written migrations |

Both layers are applied by the same tool, in one ordered migration history. Prisma's
differ does not see CHECK constraints, triggers, partial indexes or expression
indexes, so it will never generate a migration that drops them — verified with
`npm run db:drift`, which must exit `0`.

## Migration order

```
00000000000000_extensions      citext, pg_trgm, btree_gist
20260825194450_init            24 tables, 17 enums, foreign keys, plain indexes
20260825194500_integrity       35 CHECKs, 1 exclusion constraint, 8 partial indexes,
                               3 expression indexes, 10 triggers
20260825194756_updated_at_defaults   database-side defaults for updated_at
```

`00000000000000_extensions` is named to sort first no matter what timestamp a
generated migration receives. Migration filenames are UTC timestamps, so a
hand-named migration dated "today" in a positive-offset timezone can otherwise
sort after a migration generated moments later.

## Changing the schema

Editing a table, column, enum, relation or plain index:

```bash
npm run db:migrate:create -- --name add_something   # generate SQL, do not apply
$EDITOR prisma/migrations/*_add_something/migration.sql
npm run db:migrate                                  # review, then apply
npm run db:drift                                    # must exit 0
```

Adding a rule Prisma cannot express (a CHECK, trigger, partial index):

```bash
npm run db:migrate:sql -- add_some_rule
$EDITOR prisma/migrations/*_add_some_rule/migration.sql
npm run db:migrate
```

Never edit a migration that has been applied anywhere but your own machine.

## Rules enforced by the database

These hold regardless of which service writes to the database, which is the point
of putting them here rather than in application code.

- **Member numbers** are allocated by a trigger from `sanththa_member_no_seq`.
  Setting `joined_on` enrols someone; the `S-00n` number follows automatically and
  can never be changed afterwards, because it is printed on receipts.
- **Only members subscribe.** `subscribes` cannot be true without a `member_no`,
  and a subscription payment is rejected unless the payer is on the register.
- **Staff need credentials.** Any role other than `user` must have both an email
  and a password hash.
- **Financial years cannot overlap** (a GiST exclusion constraint over
  `daterange(starts_on, ends_on)`), and at most one may be current.
- **Vouchers must balance.** A deferred constraint trigger checks that each
  voucher's ledger lines sum equal on both sides at commit, so a two-line insert
  is legal mid-transaction and illegal at the end of it.
- **The ledger and the audit log are append-only.** `UPDATE` and `DELETE` are
  rejected outright.
- **Posted vouchers are immutable.** Their financial columns cannot be edited and
  the row cannot be deleted; reverse the voucher instead. Notes may still be added.
- **One subscription per member per year.**

Violations surface through the API as `422 BusinessRuleViolation` with the
database's own message, mapped in `src/common/filters/all-exceptions.filter.ts`.

## Deviations from the source schema document

- `events.year` is not a stored generated column. The same uniqueness is enforced
  by a unique index on `(event_type_id, instance_identifier, extract(year from
  scheduled_date))`, which keeps the table fully Prisma-managed.
- `audit_log` is a plain table, not partitioned by range. Partitioning is worth
  adding once volume justifies it; doing it now would mean managing the parent and
  its partitions outside Prisma's differ. Prisma 7's experimental
  `externalTables` support is the intended route when that time comes.
- `id` columns use `SERIAL`/`BIGSERIAL` rather than `GENERATED ALWAYS AS IDENTITY`,
  because that is what Prisma Migrate emits and matching it avoids permanent drift.
