import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { admin } from 'better-auth/plugins';
import { adminAc, userAc } from 'better-auth/plugins/admin/access';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { Database } from './db/index.js';
import * as schema from './db/schema.js';
import { ApiError } from './errors.js';
import type { StaffMe } from '@hd/contracts/admin';

export function createAuth(db: Database, config: Config) {
  return betterAuth({
    appName: 'HD Auto Staff', baseURL: config.authBaseUrl, basePath: '/api/auth', secret: config.authSecret,
    logger: {disabled:true},
    database: drizzleAdapter(db.orm, { provider: 'pg', schema }), trustedOrigins: config.trustedOrigins,
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128 },
    session: { expiresIn: 8 * 60 * 60, updateAge: 60 * 60, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, window: 60, max: 30, customRules: { '/sign-in/email': { window: 60, max: 5 } } },
    advanced: { cookiePrefix: 'hd-auto', useSecureCookies: config.environment === 'production',
      ipAddress: {ipAddressHeaders:['x-hd-client-ip']},
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/api' } },
    plugins: [admin({ defaultRole: 'editor', adminRoles: ['admin'], roles: { admin: adminAc, editor: userAc } })],
  });
}
export type Auth = ReturnType<typeof createAuth>;

export function authHeaders(request:FastifyRequest) {
  const headers=fromNodeHeaders(request.headers);
  // Only Fastify's configured proxy policy determines client identity; never trust a caller's IP header.
  headers.set('x-hd-client-ip',request.ip);
  return headers;
}

export function requireTrustedOrigin(request: FastifyRequest, config: Config) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !config.trustedOrigins.includes(origin)) {
      throw new ApiError(403, 'FORBIDDEN', 'A trusted Origin is required for staff writes.');
    }
  }
}
export async function requireStaff(request: FastifyRequest, auth: Auth, db: Database): Promise<StaffMe> {
  const session = await auth.api.getSession({ headers: authHeaders(request), query: { disableCookieCache: true } });
  if (!session) throw new ApiError(401, 'UNAUTHENTICATED', 'Staff login is required.');
  const result = await db.pool.query('SELECT id,name,role,banned FROM staff WHERE id=$1', [session.user.id]);
  const user = result.rows[0];
  if (!user || user.banned) throw new ApiError(401, 'UNAUTHENTICATED', 'Staff session is no longer active.');
  if (user.role !== 'admin' && user.role !== 'editor') throw new ApiError(403, 'FORBIDDEN', 'Staff role is required.');
  const permissions: StaffMe['permissions'] = ['vehicles:read','vehicles:write','vehicles:publish','media:write','home:write'];
  if (user.role === 'admin') permissions.push('staff:manage');
  return { id: user.id, name: user.name, role: user.role, permissions };
}
