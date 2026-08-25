import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const name = process.argv[2];

if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error('Usage: npm run db:migrate:sql -- <snake_case_name>');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const dir = join('prisma', 'migrations', `${stamp}_${name}`);

mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, 'migration.sql'),
  `-- ${name}\n-- Hand-written SQL: constraints, indexes, triggers and data fixes that\n-- the Prisma schema language cannot express. Prisma will apply this in order\n-- and will not diff its contents.\n\n`,
);

console.log(`Created ${join(dir, 'migration.sql')}`);
console.log('Apply it with: npm run db:migrate');
