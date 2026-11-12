import path from 'node:path';
import { BlockList, isIP } from 'node:net';
import { z } from 'zod';
import { readDatabaseEnvironment, readLocalSecret } from './local-secrets.js';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HD_DEPLOYMENT_ENV: z.enum(['production','local','test']).optional(),
  HD_RELEASE_ID: z.string().regex(/^(?:[a-f0-9]{40,64}|sha256:[a-f0-9]{64})$/).optional(),
  HD_SSR_SERVICE_SECRET_FILE: z.string().min(1).max(1024).optional(),
  HD_SSR_SERVICE_PEERS: z.string().max(2048).optional(),
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
  EXTERNAL_CATALOG_MODE: z.enum(['disabled', 'synthetic', 'synthetic-scale']).default('disabled'),
  CATALOG_READ_MODE: z.enum(['staff', 'combined']).default('staff'),
  EXTERNAL_SYNC_MODE: z.literal('off').default('off'),
  PUBLIC_CATALOG_CACHE: z.enum(['off', 'memory', 'redis']).default('off'),
  PUBLIC_CACHE_NAMESPACE: z.string().regex(/^hd:catalog:[a-z0-9-]{1,48}$/).default('hd:catalog:production'),
  PUBLIC_CACHE_TTL_MS: z.coerce.number().int().min(250).max(15_000).default(15_000),
  PUBLIC_CACHE_MAX_LOADS: z.coerce.number().int().min(1).max(4).default(4),
  PUBLIC_REDIS_HOST: z.enum(['127.0.0.1', 'redis']).optional(),
  PUBLIC_REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
  PUBLIC_REDIS_USER: z.string().regex(/^[a-z][a-z0-9_-]{0,48}$/).optional(),
  PUBLIC_REDIS_PASSWORD_FILE: z.string().min(1).max(1024).optional(),
  CHINACARAPI_ACCOUNT_KEY_FILE: z.string().min(1).max(1024).optional(),
  EXTERNAL_PUBLIC_CACHE: z.enum(['off', 'memory', 'redis']).default('off'),
  EXTERNAL_CACHE_NAMESPACE: z.string().regex(/^hd-ext-scale-[a-z0-9-]{1,48}$/).optional(),
  EXTERNAL_CACHE_TTL_MS: z.coerce.number().int().min(250).max(30_000).default(5000),
  EXTERNAL_CACHE_MAX_LOADS: z.coerce.number().int().min(1).max(20).default(4),
  EXTERNAL_REDIS_HOST: z.enum(['127.0.0.1','redis-scale']).optional(),
  EXTERNAL_REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
  EXTERNAL_REDIS_USER: z.string().regex(/^[a-z][a-z0-9_-]{0,48}$/).optional(),
  EXTERNAL_REDIS_PASSWORD_FILE: z.string().min(1).max(1024).optional(),
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

export function readConfig(env: NodeJS.ProcessEnv = process.env, options: {runtime?:boolean} = {}) {
  const databaseEnvironment = readDatabaseEnvironment(env);
  if (env.AUTH_SECRET_FILE !== undefined && env.AUTH_SECRET !== undefined) throw new Error('Set exactly one staff authentication secret source');
  const parsed = Env.safeParse(env.AUTH_SECRET_FILE === undefined ? databaseEnvironment :
    { ...databaseEnvironment, AUTH_SECRET: readLocalSecret(env.AUTH_SECRET_FILE) });
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
  if (e.EXTERNAL_CATALOG_MODE === 'synthetic') {
    const database = new URL(e.DATABASE_URL);
    if (e.NODE_ENV === 'production' || e.HOST !== '127.0.0.1' || database.hostname !== '127.0.0.1' ||
        !/^\/hd_ext_[a-z0-9_]+$/.test(database.pathname) || database.search || database.hash || e.TRANSLATION_PROVIDER !== 'disabled') {
      throw new Error('Synthetic external catalog requires a loopback API, an isolated hd_ext_* database and disabled translation');
    }
  }
  const externalScale = e.EXTERNAL_CATALOG_MODE === 'synthetic-scale';
  if (e.EXTERNAL_CATALOG_MODE !== 'disabled' && (e.CATALOG_READ_MODE !== 'staff' ||
      Object.keys(env).some(key => key.startsWith('PUBLIC_CACHE_') || key.startsWith('PUBLIC_REDIS_')) || e.PUBLIC_CATALOG_CACHE !== 'off')) {
    throw new Error('Formal catalog settings cannot be combined with synthetic catalog settings');
  }
  if (externalScale) {
    const database = new URL(e.DATABASE_URL);
    const native = e.HOST === '127.0.0.1' && database.hostname === '127.0.0.1';
    const compose = e.HOST === '0.0.0.0' && database.hostname === 'postgres-scale' && ['', '5432'].includes(database.port);
    if (e.NODE_ENV !== 'test' || !(native || compose) || !/^\/hd_ext_scale_[a-z0-9_]+$/.test(database.pathname) ||
        database.search || database.hash || e.TRANSLATION_PROVIDER !== 'disabled') {
      throw new Error('Capacity mode requires a dedicated hd_ext_scale_* test database and disabled translation');
    }
  }
  if (e.EXTERNAL_PUBLIC_CACHE !== 'off' && !externalScale) throw new Error('Public cache requires the isolated capacity mode');
  if (e.EXTERNAL_PUBLIC_CACHE === 'redis' && (!e.EXTERNAL_CACHE_NAMESPACE || !e.EXTERNAL_REDIS_HOST || !e.EXTERNAL_REDIS_USER ||
      !e.EXTERNAL_REDIS_PASSWORD_FILE || !path.isAbsolute(e.EXTERNAL_REDIS_PASSWORD_FILE) ||
      (e.HOST === '127.0.0.1' ? e.EXTERNAL_REDIS_HOST !== '127.0.0.1' : e.EXTERNAL_REDIS_HOST !== 'redis-scale'))) {
    throw new Error('Redis capacity mode requires the isolated endpoint, namespace, user and an absolute password file');
  }
  if (e.PUBLIC_CATALOG_CACHE === 'redis' && (!e.PUBLIC_REDIS_HOST || !e.PUBLIC_REDIS_USER ||
      !e.PUBLIC_REDIS_PASSWORD_FILE || !path.isAbsolute(e.PUBLIC_REDIS_PASSWORD_FILE))) {
    throw new Error('Formal Redis cache requires an internal endpoint, user and an absolute password file');
  }
  if ((options.runtime || e.NODE_ENV !== 'test' || e.PUBLIC_CATALOG_CACHE !== 'off' || e.EXTERNAL_PUBLIC_CACHE !== 'off') &&
      (!e.HD_DEPLOYMENT_ENV || !e.HD_RELEASE_ID)) throw new Error('HD_DEPLOYMENT_ENV and HD_RELEASE_ID are required for API runtime and enabled caches');
  if (e.NODE_ENV === 'production' && e.HD_DEPLOYMENT_ENV !== 'production') throw new Error('Production requires HD_DEPLOYMENT_ENV=production');
  const deployment = {environment:e.HD_DEPLOYMENT_ENV ?? 'test', releaseId:e.HD_RELEASE_ID ?? 'unreleased'};
  let ssrService: {secret:string;peers:string[]}|null = null;
  if (e.HD_SSR_SERVICE_SECRET_FILE || e.HD_SSR_SERVICE_PEERS) {
    if (!e.HD_SSR_SERVICE_SECRET_FILE || !e.HD_SSR_SERVICE_PEERS || !path.isAbsolute(e.HD_SSR_SERVICE_SECRET_FILE))
      throw new Error('SSR service requires a secret file and explicit socket peer IPs/CIDRs');
    const peers = parseTrustProxy(e.HD_SSR_SERVICE_PEERS);
    if (!Array.isArray(peers)) throw new Error('HD_SSR_SERVICE_PEERS requires explicit IPs/CIDRs');
    const secret = readLocalSecret(e.HD_SSR_SERVICE_SECRET_FILE,512);
    if (!/^[\x21-\x7e]{32,256}$/.test(secret)) throw new Error('Invalid SSR service secret');
    ssrService = {secret,peers};
  }
  const externalCatalog = e.EXTERNAL_CATALOG_MODE !== 'disabled' || e.CATALOG_READ_MODE === 'combined';
  const formalCache = { enabled: e.PUBLIC_CATALOG_CACHE !== 'off', externalCatalog, deployment,
    namespace: e.PUBLIC_CACHE_NAMESPACE, ttlMs: e.PUBLIC_CACHE_TTL_MS, maxConcurrentLoads: e.PUBLIC_CACHE_MAX_LOADS,
    maxEntries: 64, maxBytes: 16 * 1_048_576,
    maxQueuedLoads: e.EXTERNAL_CATALOG_MODE === 'disabled' ? 16 : 0,
    redis: e.PUBLIC_CATALOG_CACHE === 'redis' ? {host:e.PUBLIC_REDIS_HOST!,port:e.PUBLIC_REDIS_PORT,
      username:e.PUBLIC_REDIS_USER!,passwordFile:e.PUBLIC_REDIS_PASSWORD_FILE!} : undefined };
  const providerAccountKey = e.CHINACARAPI_ACCOUNT_KEY_FILE
    ? readLocalSecret(e.CHINACARAPI_ACCOUNT_KEY_FILE, 512)
    : undefined;
  if (providerAccountKey !== undefined && !/^[\x21-\x7e]+$/.test(providerAccountKey)) {
    throw new Error('Invalid ChinaCarAPI account key');
  }
  return {
    environment: e.NODE_ENV, deployment, ssrService, host: e.HOST, port: e.PORT, databaseUrl: e.DATABASE_URL,
    authSecret: e.AUTH_SECRET, authBaseUrl: e.AUTH_BASE_URL, trustedOrigins,
    mediaRoot: path.resolve(e.MEDIA_ROOT), mediaDelivery: e.MEDIA_DELIVERY, poolMax: e.DB_POOL_MAX,
    trustProxy: parseTrustProxy(e.TRUST_PROXY), externalCatalog, externalScale,
    externalIngestion: e.EXTERNAL_CATALOG_MODE !== 'disabled', externalSync: e.EXTERNAL_SYNC_MODE,
    publicCache: e.EXTERNAL_PUBLIC_CACHE === 'off' ? formalCache : {
      enabled: true, externalCatalog, deployment,
      maxEntries: 64, maxBytes: 16 * 1_048_576,
      maxQueuedLoads: 0,
      namespace: e.EXTERNAL_CACHE_NAMESPACE ?? 'hd-ext-scale-memory', ttlMs: e.EXTERNAL_CACHE_TTL_MS, maxConcurrentLoads: e.EXTERNAL_CACHE_MAX_LOADS,
      redis: e.EXTERNAL_PUBLIC_CACHE === 'redis' ? { host: e.EXTERNAL_REDIS_HOST!, port: e.EXTERNAL_REDIS_PORT,
        username: e.EXTERNAL_REDIS_USER!, passwordFile: e.EXTERNAL_REDIS_PASSWORD_FILE! } : undefined,
    },
    providerAccountKey,
    translation: {provider:e.TRANSLATION_PROVIDER,accessKeyId:e.ALI_MT_ACCESS_KEY_ID,accessKeySecret:e.ALI_MT_ACCESS_KEY_SECRET,
      libreUrl:e.LIBRETRANSLATE_URL,libreApiKey:e.LIBRETRANSLATE_API_KEY,libreEngineVersion:e.LIBRETRANSLATE_ENGINE_VERSION,
      securityToken:e.ALI_MT_SECURITY_TOKEN,region:e.ALI_MT_REGION,configVersion:e.ALI_MT_CONFIG_VERSION,maxCharactersPerHour:e.TRANSLATION_MAX_CHARACTERS_PER_HOUR},
  };
}
export type Config = ReturnType<typeof readConfig>;
