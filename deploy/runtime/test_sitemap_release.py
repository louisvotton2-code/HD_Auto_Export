"""Exercise the public sitemap artifact and its release boundary."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from xml.etree import ElementTree as ET

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('sitemap_release', HERE / 'production/sitemap-release.py')
sitemap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sitemap)
ORIGIN = 'https://cars.hongdingauto.com'
NS = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9', 'xhtml': 'http://www.w3.org/1999/xhtml'}
ELIGIBLE = [
    {'path': '/zh/cars/ext-4d2aacb4-2379-4494-84b9-1055b0c4ecfc/', 'lastModified': '2026-11-21'},
    {'path': '/ru/cars/ext-4d2aacb4-2379-4494-84b9-1055b0c4ecfc/', 'lastModified': '2026-11-21T05:00:12Z'},
    {'path': '/en/cars/'}, {'path': '/en/'}, {'path': '/ru/'},
    {'path': '/zh/calculator/armenia/'}, {'path': '/ru/about/'}, {'path': '/ru/buy/'},
]


class SitemapRelease(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='hd-sitemap-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve() / 'sitemap'

    def build(self, entries=ELIGIBLE):
        return sitemap.prepare(self.root, ORIGIN, entries)

    def test_deterministic_content_and_locale_reciprocity(self):
        first = self.build()
        self.assertIsNone(sitemap.current(self.root))
        self.assertEqual(self.build(list(reversed(ELIGIBLE))), first)
        generation = first['generation']
        index = self.root / 'generations' / generation / 'index.xml'
        self.assertFalse(index.exists())
        sitemap.activate(self.root, generation, None)
        self.assertEqual(sitemap.current(self.root), generation)
        locs = ET.parse(index).findall('s:sitemap/s:loc', NS)
        self.assertEqual([item.text for item in locs], [f'{ORIGIN}/sitemap-{generation}-00001.xml'])
        shard = self.root / 'generations' / generation / '00001.xml'
        urls = {n.findtext('s:loc', namespaces=NS): n for n in ET.parse(shard).findall('s:url', NS)}
        self.assertEqual(set(urls), {ORIGIN + row['path'] for row in ELIGIBLE})
        zh = ORIGIN + ELIGIBLE[0]['path']
        ru = ORIGIN + ELIGIBLE[1]['path']
        targets = {'zh-Hans': zh, 'ru': ru, 'x-default': ru}
        for url in (zh, ru):
            alternates = urls[url].findall('xhtml:link', NS)
            self.assertEqual({node.get('hreflang'): node.get('href') for node in alternates}, targets)
        self.assertEqual(urls[zh].findtext('s:lastmod', namespaces=NS), '2026-11-21')
        self.assertIsNone(urls[ORIGIN + '/en/cars/'].find('s:lastmod', NS))
        self.assertEqual({node.get('hreflang'): node.get('href')
                          for node in urls[ORIGIN + '/en/cars/'].findall('xhtml:link', NS)},
                         {'en': ORIGIN + '/en/cars/', 'x-default': ORIGIN + '/en/cars/'})

    def test_fe_base_paths_and_complete_be_revision_generate_the_eligible_languages(self):
        base = [{'path': '/en/cars/'}, {'path': '/ru/cars/'}]
        vehicles = [
            {'id': '4d2aacb4-2379-4494-84b9-1055b0c4ecfc', 'locales': ['en'],
             'lastModified': '2026-11-21T05:00:12.123Z'},
            {'id': 'ext-4d2aacb4-2379-4494-84b9-1055b0c4ecfc', 'locales': ['zh', 'ru'],
             'lastModified': '2026-11-21T06:00:12Z'},
        ]
        pages = [
            {'cursor': None, 'response': {'data': {'enabled': True, 'revision': '2:42', 'validUntil': None,
                                                  'items': vehicles[:1], 'nextCursor': 'second'}}},
            {'cursor': 'second', 'response': {'data': {'enabled': True, 'revision': '2:42', 'validUntil': None,
                                                      'items': vehicles[1:], 'nextCursor': None}}},
        ]
        entries, source = sitemap.join_vehicle_pages(ORIGIN, base, pages)
        self.assertEqual(source, {'sourceRevision': '2:42', 'validUntil': None})
        self.assertEqual({row['path'] for row in entries}, {row['path'] for row in base} | {
            f'/{locale}/cars/{item["id"]}/' for item in vehicles for locale in item['locales']
        })
        self.assertEqual(self.build(entries)['urls'], 5)
        for changes in (
            {'revision': '2:43'}, {'enabled': False}, {'items': vehicles[:1]}, {'nextCursor': 'third'},
            {'items': [{**vehicles[1], 'locales': ['zh', 'fr']}]}, {'validUntil': '2199-01-02T00:00:00.000Z'},
            {'validUntil': 'invalid'},
        ):
            invalid = deepcopy(pages)
            invalid[1]['response']['data'].update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                sitemap.join_vehicle_pages(ORIGIN, base, invalid)
        for invalid in (pages[:1], list(reversed(pages))):
            with self.assertRaisesRegex(ValueError, 'cursor'):
                sitemap.join_vehicle_pages(ORIGIN, base, invalid)
        wrong_cursor = [pages[0], {**pages[1], 'cursor': 'another'}]
        with self.assertRaisesRegex(ValueError, 'cursor'):
            sitemap.join_vehicle_pages(ORIGIN, base, wrong_cursor)
        stale = deepcopy(pages)
        for item in stale:
            item['response']['data']['validUntil'] = '2000-01-01T00:00:00.000Z'
        with self.assertRaisesRegex(ValueError, 'expired'):
            sitemap.join_vehicle_pages(ORIGIN, base, stale)

    def test_deadline_is_bound_to_generation_and_checked_before_switch_or_expiry_rollback(self):
        future = datetime.now(timezone.utc) + timedelta(hours=1)
        valid_until = future.isoformat().replace('+00:00', 'Z')
        source = {'sourceRevision': 'r1', 'validUntil': valid_until}
        built = sitemap.prepare(self.root, ORIGIN, ELIGIBLE, source)
        generation = built['generation']
        alternate = sitemap.prepare(self.root, ORIGIN, ELIGIBLE, {**source, 'sourceRevision': 'r2'})['generation']
        self.assertNotEqual(generation, alternate)
        self.assertEqual(sitemap.activate(self.root, generation, None), built)
        self.assertEqual(sitemap.deactivate(self.root, generation, only_if_expired=True),
                         {'active': generation, 'validUntil': valid_until})
        with patch.object(sitemap, 'datetime', wraps=datetime) as time:
            time.now.return_value = future
            with self.assertRaisesRegex(ValueError, 'expired'):
                sitemap.activate(self.root, alternate, generation)
            self.assertEqual(sitemap.current(self.root), generation)
            self.assertEqual(sitemap.deactivate(self.root, generation, only_if_expired=True), {'deactivated': generation})
            self.assertIsNone(sitemap.current(self.root))

    def test_10000_limit_and_uncompressed_byte_limit(self):
        entries = [{'path': f'/zh/cars/{i}/'} for i in range(10_001)]
        manifest = self.build(entries)
        self.assertEqual([shard['urls'] for shard in manifest['shards']], [10_000, 1])
        for shard in manifest['shards']:
            self.assertLessEqual(shard['bytes'], 50 * 1024**2)

        entries = [{'path': path} for path in ('/zh/cars/1/', '/zh/cars/2/', '/zh/cars/3/')]
        row = next(sitemap.rows(ORIGIN, entries))
        limit = len(sitemap.START) + len(row) + len(sitemap.END)
        with patch.object(sitemap, 'MAX_BYTES', limit):
            self.assertEqual([len(body) for _, body in sitemap.shard_rows(ORIGIN, entries)], [limit] * 3)
        with patch.object(sitemap, 'MAX_BYTES', limit - 1):
            with self.assertRaisesRegex(ValueError, 'single URL'):
                list(sitemap.shard_rows(ORIGIN, entries))
        with patch.object(sitemap, 'MAX_BYTES', 49):
            with self.assertRaisesRegex(ValueError, 'index exceeds'):
                sitemap.index_xml(ORIGIN, '0' * 64, 1)

    def test_rejects_invalid_input_and_overbroad_supplier_list(self):
        for entries in (
            [], [{'path': '/admin/'}], [{'path': '/ru/cars/?brand=1'}],
            [{'path': '/zh/calculator/../'}], [ELIGIBLE[0]] * 2,
            [{'path': '//outside.invalid/ru/'}], [{'path': '/ru/', 'lastModified': '2026-02-30'}],
            [{'path': '/ru/#x'}], [{'path': '/ru/', 'eligible': False}],
        ):
            with self.subTest(entries=entries):
                with self.assertRaises(ValueError):
                    self.build(entries)
        with self.assertRaisesRegex(ValueError, 'distinct vehicles'):
            self.build([{'path': f'/zh/cars/ext-a{i}/'} for i in range(1_001)])
        with self.assertRaisesRegex(ValueError, 'HTTPS origin'):
            sitemap.prepare(self.root, 'https://cars.hongdingauto.com/path', ELIGIBLE)

    def test_activation_rejects_corruption_and_preserves_complete_prior_generation(self):
        old = self.build()['generation']
        sitemap.activate(self.root, old, None)
        before = (self.root / 'current.xml').read_bytes()
        damaged = self.build(ELIGIBLE[:-1])['generation']
        (self.root / 'prepared' / damaged / '00001.xml').write_bytes(b'bad')
        with self.assertRaisesRegex(ValueError, 'differs'):
            sitemap.activate(self.root, damaged, old)
        self.assertEqual((self.root / 'current.xml').read_bytes(), before)

        new = self.build(ELIGIBLE[:-2])['generation']
        with self.assertRaisesRegex(ValueError, 'active sitemap changed'):
            sitemap.activate(self.root, new, None)
        self.assertFalse((self.root / 'generations' / new).exists())
        sitemap.activate(self.root, new, old)
        after = (self.root / 'current.xml').read_bytes()
        self.assertNotEqual(after, before)
        self.assertTrue((self.root / 'generations' / old / '00001.xml').is_file())
        sitemap.activate(self.root, old, new)
        self.assertEqual((self.root / 'current.xml').read_bytes(), before)
        sitemap.deactivate(self.root, old)
        self.assertIsNone(sitemap.current(self.root))
        self.assertTrue((self.root / 'generations' / new / '00001.xml').is_file())

    def test_atomic_current_index_remains_complete_for_readers(self):
        first = self.build()['generation']
        second = self.build(ELIGIBLE[:-1])['generation']
        sitemap.activate(self.root, first, None)
        sitemap.activate(self.root, second, first)
        originals = {(self.root / 'generations' / item / 'index.xml').read_bytes() for item in (first, second)}

        def read_repeatedly():
            path = self.root / 'current.xml'
            return all(path.read_bytes() in originals for _ in range(300))

        with ThreadPoolExecutor(max_workers=4) as pool:
            readers = [pool.submit(read_repeatedly) for _ in range(4)]
            for i in range(6):
                source, target = (second, first) if i % 2 == 0 else (first, second)
                sitemap.activate(self.root, target, source)
            self.assertTrue(all(reader.result() for reader in readers))


if __name__ == '__main__':
    unittest.main()
