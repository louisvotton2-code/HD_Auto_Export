import type { PoolClient } from 'pg';

type Queryable = Pick<PoolClient, 'query'>;
type UploadCounts = { today: number; total: number };

export async function staffUploadCounts(db: Queryable, staffId?: string): Promise<Map<string, UploadCounts>> {
  // Select the first event before limiting the actor or day. Older audit rows without a vehicle link
  // cannot be attributed; recycled vehicles still have that link and remain in the cumulative count.
  const result = await db.query<UploadCounts & { actor_id: string }>(`WITH first_creation AS (
    SELECT DISTINCT ON (vehicle_id) actor_id,created_at
    FROM audit_events WHERE operation='vehicle.create' AND vehicle_id IS NOT NULL
    ORDER BY vehicle_id,created_at,id
  ), beijing AS (
    SELECT date_trunc('day', statement_timestamp() AT TIME ZONE 'Asia/Shanghai') AS day_start
  )
  SELECT actor_id,count(*)::int AS total,
    (count(*) FILTER (WHERE created_at>=day_start AT TIME ZONE 'Asia/Shanghai'
      AND created_at<(day_start+interval '1 day') AT TIME ZONE 'Asia/Shanghai'))::int AS today
  FROM first_creation CROSS JOIN beijing WHERE ($1::text IS NULL OR actor_id=$1)
  GROUP BY actor_id`, [staffId ?? null]);
  return new Map(result.rows.map(({actor_id,today,total}) => [actor_id,{today,total}]));
}

export async function staffUploadStats(db: Queryable, staffId: string) {
  const counts = await staffUploadCounts(db,staffId);
  return {staffId,...(counts.get(staffId) ?? {today:0,total:0})};
}
