"""Verify private event handling, bounded failure and hourly coverage."""

from pathlib import Path
from queue import Queue
import runpy
from threading import Event
from time import time
import unittest


RELAY = runpy.run_path(str(Path(__file__).resolve().parent/'production/website-visit-relay.py'))
HOUR = 1_795_233_600_000


class VisitRelay(unittest.TestCase):
    def test_gateway_envelope_uses_one_ephemeral_address(self):
        prefix = b'<190>Nov  8 20:15:00 hd_visit: v1 '
        instant = 1_795_260_310_123
        parse = RELAY['decode']
        self.assertEqual(parse(prefix+b'visit 1795260310.123 ::ffff:c000:204', instant),
                         {'kind': 'visit', 'atMs': instant, 'address': '192.0.2.4'})
        self.assertEqual(parse(prefix+b'coverage 1795260310.123', instant),
                         {'kind': 'coverage', 'atMs': instant})
        for payload in (b'visit 1795260310.123 192.0.2.4 extra', b'visit 1795260310.123 ::1%en0',
                        b'coverage 1795260310.123 192.0.2.4', b'visit 1795260010.123 192.0.2.4'):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                parse(prefix+payload, instant)

    def test_hour_only_closes_after_delivery_and_coverage_window(self):
        coverage = RELAY['Coverage']()
        hour = HOUR-HOUR%3_600_000
        for stamp in range(hour-15_000, hour+3_631_000, 15_000):
            coverage.observe(stamp, heartbeat=True)
        coverage.sealed(hour-3_600_000)
        self.assertIsNone(coverage.ready(hour+3_600_000))
        self.assertIsNone(coverage.ready(hour+3_725_000))
        self.assertEqual(coverage.ready(hour+3_725_000, lambda _: 0), (hour, 'complete'))
        self.assertEqual(coverage.ready(hour+3_725_000, lambda _: 1), (hour, 'partial'))
        self.assertEqual(coverage.ready(hour+4_200_000), (hour, 'partial'))
        coverage.observe(hour+1000, lost=True)
        self.assertEqual(coverage.ready(hour+3_725_000, lambda _: 0), (hour, 'partial'))
        coverage.sealed(hour)
        self.assertIsNone(coverage.ready(hour+3_725_000))

    def test_relay_does_not_deduplicate_or_retry_failed_documents(self):
        health, coverage = RELAY['Health'](), RELAY['Coverage']()
        inbox, stop = Queue(), Event()
        timestamp = int(time()*1000)
        for offset in (0, 1):
            inbox.put({'kind': 'visit', 'atMs': timestamp-offset, 'address': '192.0.2.4'})
        seen = []

        def send(event):
            seen.append(event)
            if len(seen) == 1:
                raise TimeoutError
            stop.set()

        RELAY['deliver'](inbox, send, health, coverage, stop)
        self.assertEqual([event['kind'] for event in seen], ['document', 'document'])
        self.assertLess(seen[0]['observedAt'], seen[1]['observedAt'])
        self.assertEqual(health.counts, {'deliveryFailed': 1, 'forwarded': 1})
        self.assertEqual(coverage.ready(timestamp+3_725_000)[1], 'partial')


if __name__ == '__main__':
    unittest.main()
