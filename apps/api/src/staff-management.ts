import { staffLoginFromEmail, type StaffCreateRequest, type StaffRecord } from '@hd/contracts/admin';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';
import type { Auth } from './auth.js';
import type { Database } from './db/index.js';
import * as schema from './db/schema.js';
import { ApiError, notFound } from './errors.js';
import { createStaff } from './staff-cli.js';
import { staffUploadCounts } from './vehicles/upload-attribution.js';

const revokedReason = 'staff_access_revoked';
const recordColumns = 'id, email, name, role, banned, created_at, updated_at';

type StaffRow = {
  id: string;
  email: string;
  name: string;
  role: StaffRecord['role'];
  banned: boolean;
  created_at: Date;
  updated_at: Date;
};

function toStaffRecord(row: StaffRow, uploads: StaffRecord['uploads'] = { today: 0, total: 0 }): StaffRecord {
  return {
    id: row.id,
    login: staffLoginFromEmail(row.email),
    name: row.name,
    role: row.role,
    disabled: row.banned,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    uploads,
  };
}

function isDuplicateLogin(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  type Failure = { body?: { code?: string }; code?: string; constraint?: string };
  const failure = error as Failure & { cause?: Failure };
  return failure.body?.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' || [failure, failure.cause].some(
    cause => cause?.code === '23505' && cause.constraint === 'staff_email_key',
  );
}

async function lockEditor(tx: PoolClient, id: string) {
  const { rows: [row] } = await tx.query<Pick<StaffRow, 'role' | 'banned'>>(
    'SELECT role, banned FROM staff WHERE id=$1 FOR UPDATE', [id],
  );
  if (!row) throw notFound();
  if (row.role !== 'editor') throw new ApiError(403, 'FORBIDDEN', 'Administrator accounts cannot be managed here.');
  return row;
}

export class StaffManagement {
  constructor(private readonly db: Database, private readonly auth: Auth) {}

  async list(): Promise<{ items: StaffRecord[] }> {
    return this.db.transaction(async tx => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const { rows } = await tx.query<StaffRow>(`SELECT ${recordColumns} FROM staff s
        WHERE NOT (s.banned AND s.ban_reason IS NOT DISTINCT FROM $1)
          AND EXISTS (SELECT 1 FROM staff_accounts a WHERE a.user_id=s.id AND a.account_id=s.id
            AND a.provider_id='credential' AND a.password IS NOT NULL)
        ORDER BY s.created_at DESC, s.id`, [revokedReason]);
      const counts = await staffUploadCounts(tx);
      return { items: rows.map(row => toStaffRecord(row, counts.get(row.id))) };
    });
  }

  async create({ login, name, password }: StaffCreateRequest): Promise<StaffRecord> {
    try {
      return await this.db.transaction(async tx => {
        // Keep Better Auth's user and credential inserts on the same connection so both roll back on failure.
        const auth = betterAuth({
          ...this.auth.options,
          database: drizzleAdapter(drizzle(tx, { schema }), { provider: 'pg', schema }),
        });
        const { user } = await createStaff(auth, { email: login, name, password, role: 'editor' });
        const { rows: [row] } = await tx.query<StaffRow>(`SELECT ${recordColumns} FROM staff WHERE id=$1`, [user.id]);
        if (!row) throw new Error('Created staff account is unavailable.');
        return toStaffRecord(row);
      });
    } catch (error) {
      if (isDuplicateLogin(error)) {
        throw new ApiError(409, 'STAFF_LOGIN_CONFLICT', 'This staff login is already in use.');
      }
      throw error;
    }
  }

  async resetPassword(id: string, password: string): Promise<{ id: string }> {
    const hash = await (await this.auth.$context).password.hash(password);
    return this.db.transaction(async tx => {
      const target = await lockEditor(tx, id);
      if (target.banned) throw new ApiError(409, 'STAFF_ACCOUNT_DISABLED', 'This staff account is disabled.');
      const credential = await tx.query(`UPDATE staff_accounts SET password=$2, updated_at=clock_timestamp()
        WHERE user_id=$1 AND account_id=$1 AND provider_id='credential' AND password IS NOT NULL`, [id, hash]);
      if (credential.rowCount !== 1) {
        throw new ApiError(409, 'STAFF_CREDENTIAL_UNAVAILABLE', 'This staff account has no active password credential.');
      }
      await tx.query('UPDATE staff SET updated_at=clock_timestamp() WHERE id=$1', [id]);
      await tx.query('DELETE FROM staff_sessions WHERE user_id=$1', [id]);
      return { id };
    });
  }

  async revoke(id: string): Promise<{ id: string }> {
    return this.db.transaction(async tx => {
      await lockEditor(tx, id);
      await tx.query(`UPDATE staff SET banned=true, ban_reason=$2, ban_expires=NULL, updated_at=clock_timestamp()
        WHERE id=$1 AND NOT (banned AND ban_reason IS NOT DISTINCT FROM $2 AND ban_expires IS NULL)`, [id, revokedReason]);
      await tx.query('DELETE FROM staff_sessions WHERE user_id=$1', [id]);
      return { id };
    });
  }
}
