"""Check first-party backup scope and restore retention across schema versions."""

import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent / 'production'))
import first_party_data as data


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


class FirstPartyPixelSettings(unittest.TestCase):
    def test_supplier_settings_are_staged_and_staff_settings_remain_in_the_dump(self):
        options = data.dump_options()
        self.assertIn('--exclude-table-data=public.external_listing_pixel_settings', options)
        self.assertIn('--exclude-table-data=public.external_catalog', options)
        self.assertIn('--exclude-table-data=public.external_full_receive_observations', options)
        self.assertNotIn('--exclude-table-data=public.vehicle_pixel_settings', options)
        self.assertIn("'external_listing_pixel_settings'", data._validate_supplier_tables_sql())
        self.assertNotIn("'external_listing_pixel_settings'", data.measurement_sql())

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
