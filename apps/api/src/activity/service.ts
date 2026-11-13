import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ActivityEvent, ActivityPage, ActivityQuery, AdminActivitySummary } from '@hd/contracts/admin';
import { ActivityPageSchema } from '@hd/contracts/admin';
import type { Database } from '../db/index.js';
import { ApiError, notFound } from '../errors.js';
import type { ActivityChange } from './changes.js';
import { isCursorTime } from '../cursor-time.js';

type Actor = { id: string; requestId: string };
const utc = (column: string) => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const actorJson = (alias: string) => `jsonb_build_object('kind',CASE WHEN ${alias}.actor_name IS NULL THEN 'unknown' ELSE 'staff' END,'staffId',${alias}.actor_id,'name',${alias}.actor_name)`;
const entry = (alias: string) => `jsonb_build_object('at',${utc(alias + '.created_at')},'actor',${actorJson(alias)})`;
/** Fixed SQL fragments with aliases supplied by repository code only. No client text is interpolated. */
export const staffActivitySql = (alias = 'v') => `jsonb_build_object(
 'created',(SELECT ${entry('a')} FROM audit_events a WHERE a.vehicle_id=${alias}.id AND a.operation='vehicle.create' ORDER BY a.created_at,a.id LIMIT 1),
 'lastModified',(SELECT ${entry('a')} FROM audit_events a WHERE a.vehicle_id=${alias}.id AND a.operation NOT IN ('vehicle.preview.confirm','vehicle.translationSuggestions','vehicle.displayTranslationSuggestions') ORDER BY a.created_at DESC,a.id DESC LIMIT 1),
 'firstImported',NULL,'lastSyncedAt',NULL)`;
export const externalActivitySql = (alias = 'l') => `jsonb_build_object('created',NULL,
 'lastModified',(SELECT ${entry('a')} FROM external_override_events a WHERE a.listing_id=${alias}.id ORDER BY a.created_at DESC,a.id DESC LIMIT 1),
 'firstImported',CASE WHEN ${alias}.first_imported_at IS NULL THEN NULL ELSE jsonb_build_object('at',${utc(alias + '.first_imported_at')},'batchId',${alias}.first_import_batch_id) END,
 'lastSyncedAt',${utc(alias + '.fetched_at')})`;

export async function recordAudit(tx: PoolClient, actor: Actor, operation: string, vehicleId: string | null,
  oldVersion: number | null, newVersion: number | null, changes: ActivityChange[] | null = null) {
  const result=await tx.query(`INSERT INTO audit_events(id,actor_id,operation,vehicle_id,old_version,new_version,request_id,actor_name,changes,created_at)
    SELECT $1,id,$3,$4,$5,$6,$7,name,$8,clock_timestamp() FROM staff WHERE id=$2`,
    [randomUUID(), actor.id, operation, vehicleId, oldVersion, newVersion, actor.requestId, changes === null ? null : JSON.stringify(changes)]);
  if(result.rowCount!==1)throw new ApiError(403,'FORBIDDEN','An authenticated staff actor is required.');
}
export async function recordOverride(tx: PoolClient, actor: Actor, listingId: string, version: number, data: unknown, changes: ActivityChange[]) {
  const result=await tx.query(`INSERT INTO external_override_events(id,listing_id,actor_id,request_id,version,data,actor_name,changes,created_at)
    SELECT $1,$2,id,$4,$5,$6,name,$7,clock_timestamp() FROM staff WHERE id=$3`,
    [randomUUID(), listingId, actor.id, actor.requestId, version, JSON.stringify(data), JSON.stringify(changes)]);
  if(result.rowCount!==1)throw new ApiError(403,'FORBIDDEN','An authenticated staff actor is required.');
}
export async function externalActivitySummary(tx: PoolClient, id: string): Promise<AdminActivitySummary> {
  const row = (await tx.query<{ activity: AdminActivitySummary }>(`SELECT ${externalActivitySql()} AS activity FROM external_listings l WHERE l.id=$1`, [id])).rows[0];
  if (!row) throw notFound();
  return row.activity;
}
const badCursor = () => new ApiError(400, 'INVALID_REQUEST', 'The activity cursor does not match this resource.');
type Cursor = { kind: 'staff' | 'external'; resource: string; at: string; id: string };
function decodeCursor(value: string | undefined, kind: Cursor['kind'], resource: string): Cursor | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (!parsed || typeof parsed !== 'object') throw badCursor();
    const cursor = parsed as Cursor;
    if (cursor.kind !== kind || cursor.resource !== resource || !isCursorTime(cursor.at) ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(cursor.id)) throw badCursor();
    return cursor;
  } catch { throw badCursor(); }
}
export class ActivityService {
  constructor(private db: Database) {}
  staff(id: string, query: ActivityQuery) { return this.page('staff', id.toLowerCase(), query); }
  external(id: string, query: ActivityQuery) { return this.page('external', id.replace(/^ext-/, '').toLowerCase(), query); }
  private async page(kind: Cursor['kind'], resource: string, query: ActivityQuery): Promise<ActivityPage> {
    const cursor = decodeCursor(query.cursor, kind, resource);
    return this.db.transaction(async tx => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const found = await tx.query(`SELECT id FROM ${kind === 'staff' ? 'vehicles' : 'external_listings'} WHERE id=$1`, [resource]);
      if (!found.rowCount) throw notFound();
      const table = kind === 'staff' ? 'audit_events' : 'external_override_events';
      const id = kind === 'staff' ? 'vehicle_id' : 'listing_id';
      const version = kind === 'staff' ? 'old_version,new_version' : 'version-1 AS old_version,version AS new_version';
      const action = kind === 'staff' ? 'operation' : "'external.override'";
      const rows = (await tx.query<{ id: string; action: string; at: string; actor: ActivityEvent['actor']; old_version: number | null; new_version: number | null; changes: ActivityChange[] | null }>(
        `SELECT a.id,${action} AS action,${utc('a.created_at')} AS at,${actorJson('a')} AS actor,${version},a.changes FROM ${table} a
         WHERE ${id}=$1 AND ($2::timestamptz IS NULL OR (a.created_at,a.id)<($2::timestamptz,$3::uuid))
         ORDER BY a.created_at DESC,a.id DESC LIMIT $4`, [resource, cursor?.at ?? null, cursor?.id ?? null, query.limit + 1])).rows;
      const more = rows.length > query.limit, selected = rows.slice(0, query.limit), last = selected.at(-1);
      return ActivityPageSchema.parse({ items: selected.map(row => ({ id: row.id, action: row.action, at: row.at, actor: row.actor,
        oldVersion: row.old_version, newVersion: row.new_version, changes: row.changes, detailState: row.changes === null ? 'unknown' : 'recorded' })),
      nextCursor: more && last ? Buffer.from(JSON.stringify({ kind, resource, at: last.at, id: last.id })).toString('base64url') : null });
    });
  }
}
