"""Check first-party backup scope and restore retention across schema versions."""

import json
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent / 'production'))
import first_party_data as data
restore_spec = spec_from_file_location('first_party_restore', Path(__file__).parent / 'production/verify-first-party-restore.py')
restore = module_from_spec(restore_spec)
restore_spec.loader.exec_module(restore)


class FirstPartyAnalytics(unittest.TestCase):
    def test_short_lived_identifiers_are_excluded_but_anonymous_statistics_remain(self):
        for table in ('analytics_event_receipts', 'analytics_ip_keys', 'analytics_ip_visit_keys',
                      'analytics_session_events', 'analytics_session_keys'):
            with self.subTest(table=table):
                self.assertIn(f'--exclude-table-data=public.{table}', data.dump_options())
                self.assertIn(f"'{table}'", data.measurement_sql())
        for table in ('analytics_activity_hourly', 'analytics_contact_hourly', 'analytics_document_snapshots',
                      'analytics_document_hourly', 'analytics_ip_visit_hourly', 'analytics_ip_visit_coverage',
                      'analytics_sessions', 'analytics_session_vehicles'):
            with self.subTest(table=table):
                self.assertNotIn(f'--exclude-table-data=public.{table}', data.dump_options())
                self.assertNotIn(f"'{table}'", data.measurement_sql())


class FirstPartySupplierFacets(unittest.TestCase):
    def test_rebuildable_global_facets_data_is_excluded_from_first_party_backups(self):
        table = 'external_catalog_global_facets'
        options = data.dump_options()
        self.assertIn(f'--exclude-table-data=public.{table}', options)
        self.assertNotIn(f'--exclude-table=public.{table}', options)
        self.assertIn(f"'{table}'", data._validate_supplier_tables_sql())
        self.assertIn(f"'{table}'", data.measurement_sql())
        self.assertNotIn(table, data._supplement_sql(True, seo_selection=True))


class FirstPartySupplierKeywordMatch(unittest.TestCase):
    def test_rebuildable_keyword_matches_and_readiness_are_excluded(self):
        tables = ('external_catalog_keyword_match', 'external_catalog_keyword_match_en',
                  'external_catalog_keyword_match_ru', 'external_catalog_keyword_match_state')
        options = data.dump_options()
        schema_gate = data._validate_supplier_tables_sql()
        measurement = data.measurement_sql()
        supplement = data._supplement_sql(True, seo_selection=True)
        for table in tables:
            with self.subTest(table=table):
                self.assertIn(f'--exclude-table-data=public.{table}', options)
                self.assertNotIn(f'--exclude-table=public.{table}', options)
                self.assertIn(f"'{table}'", schema_gate)
                self.assertIn(f"'{table}'", measurement)
                self.assertNotIn(table, supplement)


class FirstPartyMarketProjection(unittest.TestCase):
    TABLES = ('external_market_quote_models', 'external_market_quote_pending', 'external_market_quote_rows')

    def test_market_projection_schema_remains_without_certified_data(self):
        options = [option for option in data.dump_options() if 'external_market_quote_' in option]
        self.assertCountEqual(options, [f'--exclude-table-data=public.{table}' for table in self.TABLES])
        for table in self.TABLES:
            with self.subTest(table=table):
                self.assertIn(f"'{table}'", data._validate_supplier_tables_sql())
                self.assertIn(f"'{table}'", data.measurement_sql())
                self.assertNotIn(table, data._supplement_sql(True, seo_selection=True))
                self.assertNotIn(table, data.fingerprint_sql(restored=True))

    def test_restores_verify_the_market_projection_only_when_0058_is_present(self):
        for migrated in (False, True):
            with self.subTest(migrated=migrated):
                calls = []

                def read(sql):
                    calls.append(sql)
                    if len(calls) == 1:
                        self.assertIn('created_at=1794182400058', sql)
                        for table in self.TABLES:
                            self.assertIn(f"to_regclass('public.{table}')", sql)
                        return json.dumps({'migrated': migrated, 'tables': 3 if migrated else 0}).encode()
                    for table in self.TABLES:
                        self.assertIn(f'NOT EXISTS (SELECT FROM public.{table})', sql)
                    return b't\n'

                restore.verify_empty_market_projection(read)
                self.assertEqual(len(calls), 2 if migrated else 1)

    def test_restore_rejects_an_incomplete_schema_or_leaked_supplier_projection(self):
        for migrated, tables in ((False, 1), (False, 3), (True, 0), (True, 1), (True, 2)):
            facts = json.dumps({'migrated': migrated, 'tables': tables}).encode()
            with self.subTest(migrated=migrated, tables=tables), self.assertRaisesRegex(ValueError, 'Unexpected market'):
                restore.verify_empty_market_projection(lambda _sql: facts)
        results = iter((b'{"migrated":true,"tables":3}', b'f\n'))
        with self.assertRaisesRegex(ValueError, 'contains supplier market projection data'):
            restore.verify_empty_market_projection(lambda _sql: next(results))


class FirstPartyPixelSettings(unittest.TestCase):
    def test_supplier_settings_are_staged_and_staff_settings_remain_in_the_dump(self):
        options = data.dump_options()
        self.assertIn('--exclude-table-data=public.external_listing_pixel_settings', options)
        self.assertIn('--exclude-table-data=public.external_catalog', options)
        self.assertIn('--exclude-table-data=public.external_full_receive_observations', options)
        self.assertNotIn('--exclude-table-data=public.vehicle_pixel_settings', options)
        self.assertIn("'external_listing_pixel_settings'", data._validate_supplier_tables_sql())
        self.assertNotIn("'external_listing_pixel_settings'", data.measurement_sql())

    def test_supplier_control_schema_is_retained_without_replay_or_delta_data(self):
        options = data.dump_options()
        for table in ('external_full_admission_replays', 'external_full_admission_replay_items',
                      'external_formal_expansion_operations', 'external_formal_expansion_admissions',
                      'external_full_delta_policy'):
            with self.subTest(table=table):
                self.assertIn(f'--exclude-table-data=public.{table}', options)
                self.assertNotIn(f'--exclude-table=public.{table}', options)
                self.assertIn(f"'{table}'", data._validate_supplier_tables_sql())
                self.assertIn(f"'{table}'", data.measurement_sql())
                self.assertNotIn(table, data._supplement_sql(True, seo_selection=True))

    def test_every_saved_supplier_setting_anchors_its_listing_and_keeps_false_values(self):
        supplement = data._supplement_sql(True)
        self.assertIn('UNION SELECT listing_id FROM public.external_listing_pixel_settings', supplement)
        self.assertIn("NULL::jsonb AS source_data,'withdrawn'::text AS upstream_state", supplement)
        self.assertIn('SELECT listing_id,pixel_enabled,version FROM public.external_listing_pixel_settings', supplement)
        listing = supplement.index('COPY public.external_listings (')
        settings = supplement.index('COPY public.external_listing_pixel_settings (')
        self.assertLess(listing, settings)
        for sql in (data.fingerprint_sql(pixel_settings=True), data.fingerprint_sql(restored=True, pixel_settings=True)):
            self.assertIn("'vehicle_pixel_settings' AS name", sql)
            self.assertIn("'external_listing_pixel_settings' AS name", sql)

    def test_seo_selection_keeps_its_dump_and_adds_only_referenced_identity_anchors(self):
        table = 'public.seo_external_selection'
        self.assertNotIn(f'--exclude-table-data={table}', data.dump_options())
        self.assertNotIn(table, data._supplement_sql(False))
        supplement = data._supplement_sql(False, seo_selection=True)
        self.assertIn(f'UNION SELECT listing_id FROM {table}', supplement)
        self.assertNotIn(f'COPY {table}', supplement)
        self.assertIn(f'UNION SELECT listing_id FROM {table}', data.fingerprint_sql(seo_selection=True))
        self.assertEqual(data.fingerprint_sql(restored=True, seo_selection=True), data.fingerprint_sql(restored=True))

    def test_a_single_pixel_table_is_not_a_supported_schema(self):
        self.assertEqual(data.backup_schema(b'0|0\n'), {'seo_selection': False, 'pixel_settings': False})
        self.assertEqual(data.backup_schema(b'1|0\n'), {'seo_selection': True, 'pixel_settings': False})
        self.assertEqual(data.backup_schema(b'1|2\n'), {'seo_selection': True, 'pixel_settings': True})
        for result in (b'1|1\n', b'0|0\n1|2\n', b'2|2\n', b''):
            with self.subTest(result=result), self.assertRaises(ValueError):
                data.backup_schema(result)

    def test_supplement_and_fingerprints_follow_the_schema_in_the_exported_snapshot(self):
        for probe, migrated, seo in ((b'0|0\n', False, False), (b'1|0\n', False, True), (b'1|2\n', True, True)):
            with self.subTest(probe=probe), tempfile.TemporaryDirectory() as root:
                path = Path(root) / 'first-party.sql'
                copy_tables = data._copy_tables(migrated)
                names = set(data._owned_tables(migrated)) | {name for name, _, _ in copy_tables}
                expected = {name: {'rows': 0, 'sha256': 'a' * 64} for name in names}
                calls = []

                def run(args, *, input, stdout, **kwargs):
                    sql = input.decode()
                    self.assertIn('SET TRANSACTION SNAPSHOT :\'held_snapshot\'', sql)
                    self.assertIn('held_snapshot=00000010-00000009-1', args)
                    calls.append(sql)
                    if len(calls) == 1:
                        return SimpleNamespace(stdout=probe)
                    if len(calls) == 2:
                        for name, columns, _ in copy_tables:
                            stdout.write(f'COPY public.{name} ({columns}) FROM stdin;\n\\.\n'.encode())
                        return SimpleNamespace()
                    return SimpleNamespace(stdout=json.dumps(expected).encode())

                with patch.object(data.subprocess, 'run', side_effect=run):
                    self.assertEqual(data.write_supplement(['psql'], '00000010-00000009-1', path, None), expected)
                self.assertEqual(len(calls), 3)
                self.assertEqual('COPY public.external_listing_pixel_settings' in calls[1], migrated)
                self.assertEqual("'vehicle_pixel_settings' AS name" in calls[2], migrated)
                for sql in calls[1:]:
                    self.assertEqual('UNION SELECT listing_id FROM public.seo_external_selection' in sql, seo)
                self.assertNotIn('pixel_settings', data.fingerprint_sql(restored=True))


if __name__ == '__main__':
    unittest.main()
