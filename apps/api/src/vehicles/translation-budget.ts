import { randomUUID } from 'node:crypto';
import type { Database } from '../db/index.js';
import { ApiError } from '../errors.js';

export interface TranslationBudget { reserve(characters: number, limit: number): Promise<void>; }
export const translationQuotaExceeded = () => new ApiError(429, 'TRANSLATION_QUOTA_EXCEEDED',
  'The rolling hourly translation character budget is exhausted.');

/** Committed before dispatch. Failed/unknown calls are never refunded, including after restart. */
export class PgTranslationBudget implements TranslationBudget {
  constructor(private db: Database) {}
  async reserve(characters: number, limit: number) {
    if (!Number.isInteger(characters) || characters < 1 || characters > 10_000 ||
        !Number.isInteger(limit) || limit < 1 || limit > 1_000_000) throw new Error('Invalid translation budget reservation.');
    try {
      await this.db.transaction(async tx => {
        // A global lock across all engines/accounts in this DB, independent of API lifetime.
        const state = await tx.query('SELECT id FROM translation_budget_state WHERE id=1 FOR UPDATE');
        if (state.rowCount !== 1) throw new Error('Translation budget migration is required.');
        const { rows: [clock] } = await tx.query<{at:Date}>(`UPDATE translation_budget_state
          SET last_reserved_at=greatest(last_reserved_at,clock_timestamp()) WHERE id=1 RETURNING last_reserved_at AS at`);
        const at = clock!.at;
        const { rows: [usage] } = await tx.query<{used:string}>(`SELECT coalesce(sum(characters),0)::text AS used
          FROM translation_budget_reservations WHERE reserved_at>$1::timestamptz-interval '1 hour'`, [at]);
        if (Number(usage!.used) + characters > limit) throw translationQuotaExceeded();
        await tx.query('INSERT INTO translation_budget_reservations(id,characters,reserved_at) VALUES($1,$2,$3)',
          [randomUUID(), characters, at]);
        await tx.query("DELETE FROM translation_budget_reservations WHERE reserved_at<$1::timestamptz-interval '25 hours'", [at]);
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // A commit acknowledgement can be lost. Never retry the reservation or dispatch.
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Translation budget storage is unavailable.', undefined, true);
    }
  }
}
