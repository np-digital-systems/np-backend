import { z } from 'zod';

const duration = z.string().regex(/^\d+(ms|s|m|h|d)$/);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().min(1).default('0.0.0.0'),
  API_PREFIX: z.string().default('api'),
  API_VERSION: z.string().default('1'),

  DATABASE_URL: z.string().min(1),
  SHADOW_DATABASE_URL: z.string().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
  DATABASE_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(0).default(5_000),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(15_000),

  REDIS_URL: z.string().min(1),
  REDIS_KEY_PREFIX: z.string().default('np:'),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(60),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: duration.default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_TTL: duration.default('30d'),

  CORS_ORIGINS: z.string().default(''),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(20_000),
  THROTTLE_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
  THROTTLE_LIMIT: z.coerce.number().int().min(1).default(120),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SWAGGER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return result.data;
}
