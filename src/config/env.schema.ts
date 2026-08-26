import { z } from 'zod';

const duration = z.string().regex(/^\d+(ms|s|m|h|d)$/);

/*
 * Said in full because of where it gets read.
 *
 * A signing secret is usually wrong for one of two reasons: the deployment
 * still carries the placeholder from .env.render.example, or someone typed a
 * short word. Either way the message arrives in a deploy log, far from the
 * documentation, so it names the fix rather than only the rule.
 */
const SECRET_TOO_SHORT =
  'must be at least 32 characters — generate one with `openssl rand -hex 32`. ' +
  'A placeholder such as REPLACE_ME will not do.';

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

  JWT_ACCESS_SECRET: z.string().min(32, SECRET_TOO_SHORT),
  JWT_ACCESS_TTL: duration.default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32, SECRET_TOO_SHORT),
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
  const result = envSchema
    .refine((env) => env.JWT_ACCESS_SECRET !== env.JWT_REFRESH_SECRET, {
      path: ['JWT_REFRESH_SECRET'],
      message:
        'must differ from JWT_ACCESS_SECRET, or a stolen access token can be ' +
        'replayed as a refresh token.',
    })
    .safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return result.data;
}
