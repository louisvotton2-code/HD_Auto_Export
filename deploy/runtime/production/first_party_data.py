"""PostgreSQL data scope for a recovery point containing the site's own records."""

import json
import os
import re
import resource
import subprocess


SCOPE = 'first-party-v1'
FULL_SCOPE = 'full'


def scope(value):
    if value is None:
        return FULL_SCOPE
    if value not in (FULL_SCOPE, SCOPE):
        raise ValueError('Unknown backup data scope')
    return value


_SUPPLIER_TABLES = tuple('''
    external_canonical_bindings external_catalog external_catalog_filter external_catalog_search
    external_catalog_state external_formal_admission_state external_formal_admissions
    external_full_aliases external_full_archive_pins external_full_controls external_full_daily
    external_full_events external_full_members external_full_receipts external_full_snapshots
    external_full_stage external_full_sync external_full_work external_import_batches external_import_records
    external_ingestion_events external_ingestion_identity_state external_ingestion_jobs
    external_ingestion_members external_ingestion_pages external_inspection_enrichment
    external_listing_overrides external_listings external_media external_media_refresh_requests
    external_override_events external_report_evidence external_source_blob_refs external_source_blobs
    external_source_document_refs external_source_documents external_source_heads external_source_maintenance
    external_source_responses external_source_segment_sets external_source_segments external_sync_events
    external_sync_heartbeats external_sync_state external_translation_cache external_translation_months
    external_translation_reservations external_translation_simulation_results external_translation_trials
    external_translation_work external_trim_documents external_vehicle_evidence external_vehicle_evidence_sets
    external_vehicle_extras
'''.split())


def dump_options():
    # Preserve all definitions and the migration journal. Write the exceptions
    # from the same MVCC snapshot, without copying rebuildable supplier data.
    # Exclude tables by name so the inquiry sequence's watermark stays in the dump.
    return [f'--exclude-table-data=public.{name}' for name in (*_SUPPLIER_TABLES, 'backup_gc_leases')]


_PROTECTED_LISTINGS = """
WITH evidence_rows AS MATERIALIZED (
    SELECT archive_batch_id AS batch_id, archive_row AS row_number
    FROM public.external_inspection_enrichment
), protected_ids AS MATERIALIZED (
    SELECT listing_id FROM public.external_listing_overrides
    UNION SELECT listing_id FROM public.external_override_events
    UNION SELECT listing_id FROM public.external_report_evidence
    UNION SELECT listing_id FROM public.external_inspection_enrichment
    UNION SELECT r.listing_id FROM public.external_import_records r
        JOIN evidence_rows e USING (batch_id, row_number)
    UNION SELECT substring(picked.id FROM 5)::uuid
        FROM public.home_config h
        CROSS JOIN LATERAL jsonb_array_elements(h.sections) AS section(value)
        CROSS JOIN LATERAL jsonb_array_elements_text(section.value->'vehicleIds') AS picked(id)
        WHERE picked.id ~ '^ext-[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
), protected_listings AS MATERIALIZED (
    SELECT l.* FROM protected_ids p JOIN public.external_listings l ON l.id=p.listing_id
)
"""

# Each entry defines the exact columns, restore order, and normalized source
# values for one COPY block. Do not put supplier projections in this list.
_COPY = (
    ('external_listings',
     'id,provider,platform_id,external_id,source_revision,source_hash,source_data,upstream_state,version,'
     'fetched_at,source_updated_at,published_at,first_imported_at,first_import_batch_id,formal_primary,'
     'formal_canonical_id,inquiry_number',
     """SELECT id,provider,platform_id,external_id,
        CASE WHEN provider='chinacarapi' THEN source_revision ELSE 1 END AS source_revision,
        source_hash,NULL::jsonb AS source_data,'withdrawn'::text AS upstream_state,version,
        fetched_at,source_updated_at,published_at,first_imported_at,
        CASE WHEN first_import_batch_id IN (SELECT batch_id FROM evidence_rows)
             THEN first_import_batch_id ELSE NULL END AS first_import_batch_id,
        formal_primary,formal_canonical_id,inquiry_number FROM protected_listings"""),
    ('external_listing_overrides', 'listing_id,data,text_source_identities',
     'SELECT listing_id,data,text_source_identities FROM public.external_listing_overrides'),
    ('external_override_events', 'id,listing_id,actor_id,request_id,version,data,created_at,actor_name,changes',
     'SELECT id,listing_id,actor_id,request_id,version,data,created_at,actor_name,changes '
     'FROM public.external_override_events'),
    ('external_report_evidence',
     'listing_id,binding,observation,observation_hash,manifest_hash,checked_at,expires_at,imported_by,imported_at',
     'SELECT listing_id,binding,observation,observation_hash,manifest_hash,checked_at,expires_at,imported_by,imported_at '
     'FROM public.external_report_evidence'),
    ('external_import_batches', 'id,provider,idempotency_key,request_hash,actor_id,imported_at,counts',
     'SELECT id,provider,idempotency_key,request_hash,actor_id,imported_at,counts '
     'FROM public.external_import_batches WHERE id IN (SELECT batch_id FROM evidence_rows)'),
    ('external_import_records', 'batch_id,row_number,listing_id,operation,status,reason,issues,candidate,raw_encoded,raw_hash',
     'SELECT r.batch_id,r.row_number,r.listing_id,r.operation,r.status,r.reason,r.issues,r.candidate,r.raw_encoded,r.raw_hash '
     'FROM public.external_import_records r WHERE (r.batch_id,r.row_number) IN '
     '(SELECT batch_id,row_number FROM evidence_rows)'),
    ('external_inspection_enrichment',
     'listing_id,binding,content,archive_batch_id,archive_row,raw_hash,imported_by,imported_at',
     'SELECT listing_id,binding,content,archive_batch_id,archive_row,raw_hash,imported_by,imported_at '
     'FROM public.external_inspection_enrichment'),
    ('external_canonical_bindings', 'provider,canonical_id,source,external_id,created_at',
     'SELECT b.provider,b.canonical_id,b.source,b.external_id,b.created_at '
     'FROM public.external_canonical_bindings b JOIN protected_listings l '
     'ON (b.provider,b.source,b.external_id)=(l.provider,l.platform_id,l.external_id)'),
    ('external_ingestion_identity_state', 'provider,source,external_id,business_order,withdrawn,observed_at,business_at',
     'SELECT s.provider,s.source,s.external_id,s.business_order,s.withdrawn,s.observed_at,s.business_at '
     'FROM public.external_ingestion_identity_state s JOIN protected_listings l '
     'ON (s.provider,s.source,s.external_id)=(l.provider,l.platform_id,l.external_id) WHERE s.withdrawn'),
    ('external_formal_admissions', 'source,external_id',
     "SELECT platform_id AS source,external_id FROM protected_listings WHERE provider='chinacarapi'"),
    # Start memberships without a cursor, detail time or event order. The worker
    # increments the anchor's source_revision when it applies the first detail.
    ('external_full_members', 'source,external_id,canonical_id',
     "SELECT platform_id AS source,external_id,coalesce(formal_canonical_id,"
     "concat(provider,':',platform_id,':',external_id)) AS canonical_id "
     "FROM protected_listings WHERE provider='chinacarapi'"),
    ('external_catalog_state', 'id', 'SELECT id FROM public.external_catalog_state WHERE id=1'),
    ('external_sync_state', 'id', 'SELECT id FROM public.external_sync_state WHERE id=1'),
    ('external_source_maintenance', 'id', 'SELECT id FROM public.external_source_maintenance WHERE id=1'),
    ('external_full_sync', 'id,enabled,paused',
     'SELECT id,false AS enabled,true AS paused FROM public.external_full_sync WHERE id=1'),
    ('external_formal_admission_state', 'id,admitted_count',
     "SELECT s.id,(SELECT count(*) FROM protected_listings WHERE provider='chinacarapi') AS admitted_count "
     'FROM public.external_formal_admission_state s WHERE s.id=1'),
)


def measurement_sql():
    # Include the entire relation when only a manual subset is retained. Size
    # estimates can safely overcount these small mixed and identity tables.
    mixed = {name for name, _, _ in _COPY}
    omitted = ','.join(f"'{name}'" for name in (*_SUPPLIER_TABLES, 'backup_gc_leases') if name not in mixed)
    return f"""SELECT coalesce(sum(pg_total_relation_size(c.oid)),0)::bigint
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind IN ('r','m') AND n.nspname IN ('public','drizzle','pg_catalog')
          AND NOT (n.nspname='public' AND c.relname IN ({omitted}))"""


_OWN_RECORDS = (
    'staff', 'staff_accounts', 'vehicles', 'vehicle_drafts', 'vehicle_publications',
    'vehicle_localizations', 'publication_localizations', 'media_assets',
    'publication_media', 'home_config', 'audit_events',
)
_SETTINGS = "SET TIME ZONE 'UTC'; SET DateStyle='ISO, MDY'; SET IntervalStyle='postgres';"


def fingerprint_sql(*, restored=False):
    selections = [(name, f'SELECT * FROM public.{name}') for name in _OWN_RECORDS]
    selections.extend((name, f'SELECT {columns} FROM public.{name}' if restored else query)
                      for name, columns, query in _COPY)
    fingerprints = '\nUNION ALL\n'.join(f"""SELECT '{name}' AS name, count(*) AS rows,
        encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h COLLATE "C"),''),'UTF8')),'hex') AS sha256
        FROM (SELECT encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS h
              FROM ({query}) AS r) AS row_hashes""" for name, query in selections)
    protected = '' if restored else _PROTECTED_LISTINGS
    return f"""{_SETTINGS}
{protected}
SELECT jsonb_object_agg(name,jsonb_build_object('rows',rows,'sha256',sha256))
FROM ({fingerprints}) AS retained;"""


def _copy_header(name, columns):
    return f'COPY public.{name} ({columns}) FROM stdin;'


def _supplement_sql():
    return '\n'.join(f"SELECT '{_copy_header(name, columns)}';\n"
                     f'COPY ({_PROTECTED_LISTINGS}{query}) TO STDOUT;\n'
                     "SELECT chr(92)||'.';" for name, columns, query in _COPY)


def _validate_supplier_tables_sql():
    names = ','.join(f"'{name}'" for name in _SUPPLIER_TABLES)
    return f"""DO $$ BEGIN
        IF EXISTS (
            SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind IN ('r','p','m','f')
              AND starts_with(c.relname,'external_') AND c.relname NOT IN ({names})
        ) THEN
            RAISE EXCEPTION 'Review unknown supplier tables before publishing a first-party recovery point';
        END IF;
    END $$;"""


def _verify_copy_stream(path):
    with path.open('rb') as stream:
        for name, columns, _ in _COPY:
            if stream.readline() != (_copy_header(name, columns)+'\n').encode():
                raise ValueError('Unexpected PostgreSQL restore header')
            for line in stream:
                if line == b'\\.\n':
                    break
            else:
                raise ValueError('Truncated PostgreSQL restore section')
        if stream.read(1):
            raise ValueError('Unexpected content after restore sections')


def write_supplement(psql, snapshot, path, log, *, max_bytes=None):
    if not isinstance(snapshot, str) or not re.fullmatch(r'[a-fA-F0-9]+-[a-fA-F0-9]+-[0-9]+', snapshot):
        raise ValueError('Invalid PostgreSQL snapshot identifier')
    if max_bytes is not None and (type(max_bytes) is not int or max_bytes <= 0):
        raise ValueError('Invalid restore supplement byte budget')
    args = [*psql, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-v', f'held_snapshot={snapshot}', '-f', '-']
    begin = ("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; "
             "SET TRANSACTION SNAPSHOT :'held_snapshot'; "
             "SET LOCAL statement_timeout='90s'; SET LOCAL lock_timeout='5s';\n")

    def constrain_size():
        resource.setrlimit(resource.RLIMIT_FSIZE, (max_bytes, max_bytes))

    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as stream:
        script = '\n'.join((begin, _SETTINGS, _validate_supplier_tables_sql(), _supplement_sql(), 'COMMIT;'))
        subprocess.run(args, input=script.encode(),
                       stdout=stream, stderr=log, check=True, timeout=300,
                       preexec_fn=constrain_size if max_bytes is not None else None)
        stream.flush()
        os.fsync(stream.fileno())
    _verify_copy_stream(path)
    result = subprocess.run(args, input=(begin+fingerprint_sql()+'\nCOMMIT;\n').encode(),
                            stdout=subprocess.PIPE, stderr=log, check=True, timeout=300)
    fingerprints = json.loads(result.stdout)
    if set(fingerprints) != set(_OWN_RECORDS) | {name for name, _, _ in _COPY}:
        raise ValueError('Incomplete first-party data fingerprints')
    return fingerprints
