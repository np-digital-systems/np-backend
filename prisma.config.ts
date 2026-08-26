import { defineConfig, env } from 'prisma/config';

try {
  process.loadEnvFile('.env');
} catch {
  // .env is optional; deployed environments inject variables directly
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node --swc prisma/seed.ts',
  },
  /*
   * Only declared when the URL is actually present.
   *
   * `prisma generate` reads this file but needs no database, and it runs during
   * the image build where no connection string exists yet. `env()` throws on a
   * variable it cannot resolve, so naming DATABASE_URL unconditionally would
   * fail the build for a command that never wanted it. Migrating and seeding
   * still get the datasource, because those run with the variable set.
   */
  ...(process.env.DATABASE_URL
    ? {
        datasource: {
          url: env('DATABASE_URL'),
          ...(process.env.SHADOW_DATABASE_URL
            ? { shadowDatabaseUrl: env('SHADOW_DATABASE_URL') }
            : {}),
        },
      }
    : {}),
});
