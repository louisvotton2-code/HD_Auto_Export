import path from 'node:path';
import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3320),
  DATABASE_URL: z.string().url().refine((v) => /^postgres(?:ql)?:/.test(v)),
  AUTH_SECRET: z.string().min(32),
  AUTH_BASE_URL: z.string().url().default('http://127.0.0.1:3318'),
  TRUSTED_ORIGINS: z.string().default('http://127.0.0.1:3318'),
  MEDIA_ROOT: z.string().default('.data/media'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
  TRUST_PROXY: z.enum(['false', 'loopback']).default('false'),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = Env.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid API configuration: ${parsed.error.issues.map(i => i.path.join('.')).join(', ')}`);
  const e = parsed.data;
  if(e.AUTH_SECRET==='replace-with-a-random-local-secret-before-starting') throw new Error('Replace the example AUTH_SECRET before starting');
  const trustedOrigins = e.TRUSTED_ORIGINS.split(',').map(s => s.trim());
  if (!trustedOrigins.length || trustedOrigins.some(origin => {
    try { return new URL(origin).origin !== origin || !/^https?:/.test(origin); } catch { return true; }
  })) throw new Error('TRUSTED_ORIGINS must contain exact HTTP(S) origins');
  if (!trustedOrigins.includes(new URL(e.AUTH_BASE_URL).origin)) throw new Error('AUTH_BASE_URL origin must be trusted');
  if (new URL(e.AUTH_BASE_URL).origin !== e.AUTH_BASE_URL) throw new Error('AUTH_BASE_URL must be an origin without a path');
  if (e.NODE_ENV === 'production' && trustedOrigins.some(o => !o.startsWith('https://'))) throw new Error('Production origins must use HTTPS');
  return {
    environment: e.NODE_ENV, host: e.HOST, port: e.PORT, databaseUrl: e.DATABASE_URL,
    authSecret: e.AUTH_SECRET, authBaseUrl: e.AUTH_BASE_URL, trustedOrigins,
    mediaRoot: path.resolve(e.MEDIA_ROOT), poolMax: e.DB_POOL_MAX,
    trustProxy: e.TRUST_PROXY === 'loopback' ? 'loopback' as const : false as const,
  };
}
export type Config = ReturnType<typeof readConfig>;
