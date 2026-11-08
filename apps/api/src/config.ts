import path from 'node:path';
import { BlockList, isIP } from 'node:net';
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
  MEDIA_DELIVERY: z.enum(['direct', 'nginx']).default('direct'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
  TRUST_PROXY: z.string().max(2048).default('false'),
  TRANSLATION_PROVIDER: z.enum(['disabled','libretranslate','aliyun']).default('disabled'),
  LIBRETRANSLATE_URL: z.string().url().refine(value=>{
    try {const url=new URL(value);return ['http:','https:'].includes(url.protocol) && ['127.0.0.1','localhost','[::1]','libretranslate'].includes(url.hostname) &&
      !url.username && !url.password && url.pathname==='/' && !url.search && !url.hash;}catch{return false;}
  }).optional(),
  LIBRETRANSLATE_API_KEY: z.string().min(1).optional(),
  LIBRETRANSLATE_ENGINE_VERSION: z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/).optional(),
  ALI_MT_ACCESS_KEY_ID: z.string().min(1).optional(),
  ALI_MT_ACCESS_KEY_SECRET: z.string().min(1).optional(),
  ALI_MT_SECURITY_TOKEN: z.string().min(1).optional(),
  ALI_MT_REGION: z.enum(['cn-hangzhou','ap-southeast-1']).default('cn-hangzhou'),
  ALI_MT_CONFIG_VERSION: z.string().regex(/^[A-Za-z0-9_.-]{1,60}$/).default('1'),
  TRANSLATION_MAX_CHARACTERS_PER_HOUR: z.coerce.number().int().min(1).max(1_000_000).default(50_000),
});

function parseTrustProxy(value: string): false | 'loopback' | string[] {
  const setting = value.trim();
  if (setting === 'false') return false;
  if (setting === 'loopback') return 'loopback';
  const entries = setting.split(',').map(entry => entry.trim());
  const invalid = () => new Error('TRUST_PROXY must be false, loopback, or explicit proxy IPs/CIDRs (IPv4 /24–/32; IPv6 /64–/128)');
  if (entries.length > 32) throw invalid();
  for (const entry of entries) {
    const parts = entry.split('/');
    const address = parts[0]!;
    const family = isIP(address);
    if (!family || address.includes('%') || parts.length > 2) throw invalid();
    // Use IPv4 entries for mapped addresses. A mapped IPv6 /96 could trust all IPv4 peers.
    if (family === 6 && new URL(`http://[${address}]/`).hostname.startsWith('[::ffff:')) throw invalid();
    if (parts.length === 2) {
      const prefix = parts[1]!;
      if (!/^[1-9]\d{0,2}$/.test(prefix)) throw invalid();
      const bits = Number(prefix);
      if (bits < (family === 4 ? 24 : 64) || bits > (family === 4 ? 32 : 128)) throw invalid();
      if (family === 6 && bits <= 96) {
        const range = new BlockList();
        range.addSubnet(address,bits,'ipv6');
        // Also reject parent networks such as ::/64 that contain the mapped IPv4 range.
        if (range.check('::ffff:0:0','ipv6')) throw invalid();
      }
    }
  }
  return [...new Set(entries)];
}

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
    mediaRoot: path.resolve(e.MEDIA_ROOT), mediaDelivery: e.MEDIA_DELIVERY, poolMax: e.DB_POOL_MAX,
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
    translation: {provider:e.TRANSLATION_PROVIDER,accessKeyId:e.ALI_MT_ACCESS_KEY_ID,accessKeySecret:e.ALI_MT_ACCESS_KEY_SECRET,
      libreUrl:e.LIBRETRANSLATE_URL,libreApiKey:e.LIBRETRANSLATE_API_KEY,libreEngineVersion:e.LIBRETRANSLATE_ENGINE_VERSION,
      securityToken:e.ALI_MT_SECURITY_TOKEN,region:e.ALI_MT_REGION,configVersion:e.ALI_MT_CONFIG_VERSION,maxCharactersPerHour:e.TRANSLATION_MAX_CHARACTERS_PER_HOUR},
  };
}
export type Config = ReturnType<typeof readConfig>;
