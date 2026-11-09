#!/usr/bin/env python3
"""Read-only probe for the isolated OPS gateway or its internal scale API."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import http.client
import ipaddress
import json
import math
import os
import re
import socket
import ssl
from threading import Barrier
import time
from urllib.parse import urlsplit


CATALOG_PATH = re.compile(r'/api/v1/(?:vehicles(?:/[A-Za-z0-9_-]{1,128})?|vehicle-filters|home/vehicles)/?')


def is_catalog_target(target):
    if not target.startswith('/api/v1/') or not target.isascii() or '#' in target:
        return False
    if any(ord(character) <= 32 or ord(character) == 127 for character in target):
        return False
    try:
        parts = urlsplit(target)
    except ValueError:
        return False
    return not parts.scheme and not parts.netloc and CATALOG_PATH.fullmatch(parts.path) is not None


def percentile(sorted_samples, quantile):
    if not sorted_samples:
        return None
    return round(sorted_samples[math.ceil(quantile * len(sorted_samples)) - 1], 2)


class LocalHTTPSConnection(http.client.HTTPSConnection):
    def connect(self):
        raw_socket = socket.create_connection(('127.0.0.1', self.port), self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw_socket, server_hostname=self.host)
        except BaseException:
            raw_socket.close()
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=3440)
    parser.add_argument('--host', choices=('127.0.0.1', 'localhost', 'cars.hongdingauto.com'), default='127.0.0.1',
                        help='TLS and Host name only; the connection always goes to 127.0.0.1')
    parser.add_argument('--ca')
    parser.add_argument('--internal-api', action='store_true', help='use only from the isolated scale Compose runner')
    parser.add_argument('--concurrency', type=int, choices=(20, 50, 100), required=True)
    parser.add_argument('--seconds', type=int, choices=range(1, 181), default=30, metavar='1..180')
    parser.add_argument('--warmup-seconds', type=int, choices=range(0, 121), default=0, metavar='0..120')
    parser.add_argument('--requests-per-client', type=int, choices=range(1, 1001), metavar='1..1000',
                        help='stop after a bounded request wave; use 1 for a cold-cache sample')
    parser.add_argument('--path', action='append', required=True)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535 or not all(is_catalog_target(path) for path in args.path):
        parser.error('Use a non-privileged loopback port and public catalog paths; percent-encode non-ASCII query values')
    if args.requests_per_client is not None and args.warmup_seconds:
        parser.error('A bounded request wave must start without warm-up')

    if args.internal_api:
        try:
            network = ipaddress.IPv4Network(os.environ['OPS_EXT_SCALE_BENCH_SUBNET'])
            addresses = {result[4][0] for result in socket.getaddrinfo('api', 3320, socket.AF_INET, socket.SOCK_STREAM)}
            if not network.is_private or len(addresses) != 1 or ipaddress.IPv4Address(next(iter(addresses))) not in network:
                raise ValueError('API outside scale network')
        except (KeyError, OSError, ValueError):
            parser.error('Internal API target must resolve inside the dedicated scale network')
        address = next(iter(addresses))

        def connect():
            return http.client.HTTPConnection(address, 3320, timeout=5)
    else:
        if not args.ca:
            parser.error('--ca is required for gateway HTTPS')
        context = ssl.create_default_context(cafile=args.ca)

        def connect():
            return LocalHTTPSConnection(args.host, args.port, timeout=5, context=context)

    started = 0.0

    def start_clock():
        nonlocal started
        started = time.monotonic()

    start = Barrier(args.concurrency, action=start_clock)

    def run(index):
        connection = connect()
        samples = {path: [] for path in args.path}
        statuses = {path: Counter() for path in args.path}
        turn = index
        sent = 0
        try:
            start.wait()
            measure_from = started + args.warmup_seconds
            deadline = measure_from + args.seconds
            while (request_started := time.monotonic()) < deadline:
                if args.requests_per_client is not None and sent >= args.requests_per_client:
                    break
                path = args.path[turn % len(args.path)]
                turn += 1
                sent += 1
                try:
                    connection.request('GET', path)
                    response = connection.getresponse()
                    response.read()
                    if request_started >= measure_from:
                        statuses[path][str(response.status)] += 1
                        if 200 <= response.status < 300:
                            samples[path].append((time.monotonic() - request_started) * 1000)
                except (OSError, http.client.HTTPException):
                    if request_started >= measure_from:
                        statuses[path]['transport_error'] += 1
                    connection.close()
        finally:
            connection.close()
        return samples, statuses, time.monotonic()

    samples = {path: [] for path in args.path}
    statuses = {path: Counter() for path in args.path}
    finished = 0.0
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        for worker_samples, worker_statuses, worker_finished in pool.map(run, range(args.concurrency)):
            finished = max(finished, worker_finished)
            for path in samples:
                samples[path].extend(worker_samples[path])
                statuses[path].update(worker_statuses[path])
    elapsed = finished - started - args.warmup_seconds

    routes = {}
    for path, values in samples.items():
        values.sort()
        count = sum(statuses[path].values())
        routes[path] = {
            'requests': count,
            'statuses': statuses[path],
            'requests_per_second': round(count / elapsed, 2),
            'non_2xx_percent': round(100 * (count - len(values)) / count, 3) if count else None,
            'rate_limited_percent': round(100 * statuses[path]['429'] / count, 3) if count else None,
            'p50_success_ms': percentile(values, .50),
            'p95_success_ms': percentile(values, .95),
            'p99_success_ms': percentile(values, .99),
        }
    print(json.dumps({
        'transport': 'internal-api' if args.internal_api else 'loopback-https',
        'concurrency': args.concurrency, 'target_seconds': args.seconds,
        'warmup_seconds': args.warmup_seconds, 'requests_per_client': args.requests_per_client,
        'elapsed_seconds': round(elapsed, 3), 'routes': routes,
    }, indent=2))


if __name__ == '__main__':
    main()
