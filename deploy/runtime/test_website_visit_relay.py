"""Verify private event handling, bounded failure and hourly coverage."""

from http.client import HTTPConnection, HTTPException, RemoteDisconnected
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from queue import Queue
import runpy
from select import select
from threading import Event, Thread
from time import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


RELAY = runpy.run_path(str(Path(__file__).resolve().parent/'production/website-visit-relay.py'))
HOUR = 1_795_233_600_000
PrivateApi = RELAY['PrivateApi']
DeliveryFailure = RELAY['DeliveryFailure']
DOCUMENT = {'version': 1, 'kind': 'document', 'observedAt': '2026-11-25T09:00:00.000Z',
            'address': '192.0.2.4'}


class PrivateApiTransport(unittest.TestCase):
    def send(self, connection):
        with patch.dict(PrivateApi.__call__.__globals__, HTTPConnection=Mock(return_value=connection)):
            return PrivateApi('127.0.0.1', 'fixture-key')(DOCUMENT)

    def test_retry_is_limited_to_connection_establishment(self):
        connection = Mock()
        connection.connect.side_effect = [TimeoutError, None]
        connection.getresponse.return_value = SimpleNamespace(status=204)
        self.assertTrue(self.send(connection))
        self.assertEqual(connection.connect.call_count, 2)
        self.assertEqual(connection.request.call_count, 1)

        connection.reset_mock()
        connection.connect.side_effect = ConnectionRefusedError
        with self.assertRaisesRegex(DeliveryFailure, '^connectFailed$'):
            self.send(connection)
        self.assertEqual(connection.connect.call_count, 2)
        connection.request.assert_not_called()

    def test_possible_send_or_commit_is_never_replayed(self):
        for method, error in (('request', BrokenPipeError), ('getresponse', RemoteDisconnected)):
            with self.subTest(method=method):
                connection = Mock()
                getattr(connection, method).side_effect = error
                with self.assertRaisesRegex(DeliveryFailure, '^outcomeUncertain$'):
                    self.send(connection)
                connection.connect.assert_called_once()
                connection.request.assert_called_once()
                connection.close.assert_called_once()

    def test_http_rejections_are_classified_without_post_retries(self):
        for status, category in ((400, 'httpRejected'), (404, 'httpRejected'), (429, 'httpRateLimited'),
                                 (500, 'httpUnavailable'), (503, 'httpUnavailable'), (307, 'httpUnexpected')):
            with self.subTest(status=status):
                connection = Mock()
                connection.getresponse.return_value = SimpleNamespace(status=status)
                with self.assertRaisesRegex(DeliveryFailure, f'^{category}$'):
                    self.send(connection)
                connection.request.assert_called_once()
                connection.close.assert_called_once()

    def test_first_post_after_real_server_idle_close_is_delivered(self):
        documents = []
        closed_or_idle = Event()

        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def setup(self):
                super().setup()
                self.connection.settimeout(0.15)

            def do_POST(self):
                documents.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                self.send_response_only(204)
                self.end_headers()

            def finish(self):
                super().finish()
                closed_or_idle.set()

            def log_error(self, *_):
                pass

        with ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
            thread = Thread(target=server.serve_forever, kwargs={'poll_interval': 0.02}, daemon=True)
            thread.start()
            try:
                prior = HTTPConnection('127.0.0.1', server.server_port, timeout=1)
                try:
                    prior.request('POST', RELAY['PRIVATE_ENDPOINT'], json.dumps(DOCUMENT))
                    self.assertEqual(prior.getresponse().status, 204)
                    self.assertTrue(select([prior.sock], [], [], 2)[0])
                    with self.assertRaises((OSError, HTTPException)):
                        prior.request('POST', RELAY['PRIVATE_ENDPOINT'], json.dumps(DOCUMENT))
                        prior.getresponse()
                finally:
                    prior.close()
                documents.clear()
                closed_or_idle.clear()

                def local(host, _, *, timeout):
                    return HTTPConnection(host, server.server_port, timeout=timeout)

                with patch.dict(PrivateApi.__call__.__globals__, HTTPConnection=local):
                    relay = PrivateApi('127.0.0.1', 'fixture-key')
                    self.assertFalse(relay(DOCUMENT))
                    self.assertTrue(closed_or_idle.wait(2))
                    self.assertFalse(relay(DOCUMENT))
                self.assertEqual(documents, [DOCUMENT, DOCUMENT])
            finally:
                server.shutdown()
                thread.join(2)


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
                raise DeliveryFailure('outcomeUncertain')
            stop.set()
            return True

        RELAY['deliver'](inbox, send, health, coverage, stop)
        self.assertEqual([event['kind'] for event in seen], ['document', 'document'])
        self.assertLess(seen[0]['observedAt'], seen[1]['observedAt'])
        self.assertEqual(health.counts, {'connectRecovered': 1, 'deliveryFailed': 1,
                                        'outcomeUncertain': 1, 'forwarded': 1})
        self.assertEqual(coverage.ready(timestamp+3_725_000)[1], 'partial')


if __name__ == '__main__':
    unittest.main()
