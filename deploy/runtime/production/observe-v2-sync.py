"""Collect a bounded, aggregate-only supplier synchronization observation."""
import argparse
from datetime import datetime, timedelta, timezone
import json
import re
import subprocess


QUERY = """
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='1s';
SET LOCAL work_mem='24MB';
SET LOCAL max_parallel_workers_per_gather=0;
WITH boundary AS (
  SELECT now()-interval '24 hours' AS start_at, now() AS end_at
), events AS MATERIALIZED (
  SELECT operation,source,external_id,event_id,business_at,received_at,applied_at,error_code,
    EXTRACT(EPOCH FROM applied_at-received_at) AS elapsed_seconds
  FROM external_full_events e CROSS JOIN boundary b
  WHERE e.received_at>=b.start_at AND e.received_at<b.end_at
), latency AS (
  SELECT operation,count(*) received,
    count(*) FILTER (WHERE applied_at IS NOT NULL AND error_code IS NULL AND elapsed_seconds>=0) AS applied_ok,
    count(*) FILTER (WHERE applied_at IS NULL) AS pending,
    count(*) FILTER (WHERE error_code IS NOT NULL) AS with_error,
    count(*) FILTER (WHERE elapsed_seconds<0) AS invalid_clock_samples,
    round((percentile_cont(.95) WITHIN GROUP (ORDER BY elapsed_seconds)
      FILTER(WHERE error_code IS NULL AND elapsed_seconds>=0))::numeric, 2) AS receipt_to_apply_p95_seconds
  FROM events GROUP BY operation
), event_failures AS (
  SELECT operation,CASE WHEN error_code='SYNC_LISTING_LIMIT' THEN 'listing_limit'
    WHEN error_code LIKE '%404%' OR error_code LIKE '%NOT_FOUND%' THEN 'upstream_not_found'
    WHEN error_code LIKE '%QUOTA%' OR error_code LIKE '%RATE%' THEN 'quota_or_rate'
    ELSE 'other' END AS category,count(*) AS items
  FROM events WHERE error_code IS NOT NULL GROUP BY operation,category
), backlog AS (
  SELECT operation,count(*) AS items,min(received_at) AS oldest_received_at
  FROM external_full_events WHERE applied_at IS NULL GROUP BY operation
), work AS (
  SELECT kind,count(*) AS items,count(*) FILTER(WHERE attempts>=5) AS exhausted,
    count(*) FILTER(WHERE attempts<5 AND due_at<=now()) AS due,
    min(due_at) FILTER(WHERE attempts<5) AS earliest_due_at
  FROM external_full_work GROUP BY kind
), work_failures AS (
  SELECT kind,CASE WHEN last_error_code LIKE '%404%' OR last_error_code LIKE '%NOT_FOUND%' THEN 'upstream_not_found'
    WHEN last_error_code LIKE '%QUOTA%' OR last_error_code LIKE '%RATE%' THEN 'quota_or_rate'
    ELSE 'other' END AS category,count(*) AS items,count(*) FILTER(WHERE attempts>=5) AS exhausted
  FROM external_full_work WHERE last_error_code IS NOT NULL GROUP BY kind,category
), receipt_flow AS (
  SELECT first_receipt, latest_receipt,latest_detail,latest_report,accesses FROM (
    SELECT min(e.received_at) AS first_receipt,max(e.received_at) AS latest_receipt FROM events e
  ) e CROSS JOIN (
    SELECT max(last_detail_at) AS latest_detail,max(report_checked_at) AS latest_report,
      count(*) FILTER (WHERE last_accessed_at>=now()-interval '24 hours') AS accesses
    FROM external_full_members
  ) m
), admission_demand AS (
  SELECT count(DISTINCT (e.source,e.external_id)) AS unadmitted_candidates_24h
  FROM events e
  LEFT JOIN external_formal_admissions a USING(source,external_id)
  LEFT JOIN external_ingestion_identity_state t ON t.provider='chinacarapi' AND
    (t.source,t.external_id)=(e.source,e.external_id) AND t.withdrawn
  WHERE a.source IS NULL AND e.operation IN ('upsert','relist') AND
    (t.source IS NULL OR (e.operation='relist' AND e.event_id>t.business_order AND e.business_at>=t.business_at))
)
SELECT jsonb_build_object('observed_at', now(),
  'window', jsonb_build_object('start',b.start_at,'end',b.end_at),
  'receipt_to_apply',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.operation),'[]'::jsonb) FROM latency x),
  'event_failures',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.operation,x.category),'[]'::jsonb) FROM event_failures x),
  'active_backlog',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.operation),'[]'::jsonb) FROM backlog x),
  'work',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.kind),'[]'::jsonb) FROM work x),
  'work_failures',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.kind,x.category),'[]'::jsonb) FROM work_failures x),
  'activity',to_jsonb(r),
  'slots',jsonb_build_object('admitted',a.admitted_count,'limit',a.admission_limit,
    'remaining',a.admission_limit-a.admitted_count,
    'unadmitted_candidates_24h',d.unadmitted_candidates_24h),
  'sync',jsonb_build_object('enabled',f.enabled,'mode',f.mode,'paused',f.paused,'disk_paused',f.disk_paused,
    'capacity_pending',f.capacity_pending,'received',f.received_events,'applied',f.applied_events,
    'next_csv_at',f.next_snapshot_at,'next_delta_at',f.next_delta_at,
    'last_error_code',f.last_error_code,'last_error_at',f.last_error_at,
    'worker_locks',(SELECT count(*) FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database())
      AND locktype='advisory' AND objid=78291333 AND classid=0 AND objsubid=1 AND granted)),
  'csv',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]'::jsonb)
    FROM (SELECT state,rows,staged,apply_cursor,generated_at,created_at,completed_at,target_rows,
          sha256 IS NOT NULL AS checksum_recorded
          FROM external_full_snapshots ORDER BY created_at DESC,id DESC LIMIT 4) x),
  'public_visibility_latency',jsonb_build_object('status','not_instrumented',
    'withdrawals',NULL,'price_changes',NULL)
)
FROM boundary b CROSS JOIN receipt_flow r CROSS JOIN admission_demand d
CROSS JOIN external_full_sync f CROSS JOIN external_formal_admission_state a
WHERE f.id=1 AND a.id=1;
ROLLBACK;
"""


def collect(container, database, user, *, run=subprocess.run):
    for value in (container, database, user):
        if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}', value):
            raise ValueError('Expected explicit local PostgreSQL names')
    result = run(['docker', 'exec', '-u', 'postgres', container, 'psql', '-XAtq',
                  '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', database, '-c', QUERY],
                 capture_output=True, text=True, check=True, timeout=28)
    value = json.loads(result.stdout)
    start = datetime.fromisoformat(value['window']['start'])
    stop = datetime.fromisoformat(value['window']['end'])
    if stop-start != timedelta(hours=24) or stop.utcoffset() is None:
        raise ValueError('Invalid 24-hour database observation window')
    value['window']['start'] = start.astimezone(timezone.utc).isoformat()
    value['window']['end'] = stop.astimezone(timezone.utc).isoformat()
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', required=True)
    parser.add_argument('--database', required=True)
    parser.add_argument('--user', default='postgres')
    args = parser.parse_args()
    try:
        print(json.dumps(collect(args.container, args.database, args.user), sort_keys=True))
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError):
        raise SystemExit('The read-only aggregate observation did not complete') from None


if __name__ == '__main__':
    main()
