#!/usr/bin/env python3
"""Read-only HTTPS probe for the dedicated loopback OPS environment."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import http.client
import json
import math
import re
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=3440)
    parser.add_argument('--ca', required=True)
    parser.add_argument('--concurrency', type=int, choices=(20, 50, 100), required=True)
    parser.add_argument('--seconds', type=int, choices=range(1, 181), default=30, metavar='1..180')
    parser.add_argument('--path', action='append', required=True)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535 or not all(is_catalog_target(path) for path in args.path):
        parser.error('Use a non-privileged loopback port and public catalog paths; percent-encode non-ASCII query values')

    context = ssl.create_default_context(cafile=args.ca)
    started = 0.0

    def start_clock():
        nonlocal started
        started = time.monotonic()

    start = Barrier(args.concurrency, action=start_clock)

    def run(index):
        connection = http.client.HTTPSConnection('127.0.0.1', args.port, timeout=5, context=context)
        samples = {path: [] for path in args.path}
        statuses = {path: Counter() for path in args.path}
        turn = index
        try:
            start.wait()
            deadline = started + args.seconds
            while time.monotonic() < deadline:
                path = args.path[turn % len(args.path)]
                turn += 1
                request_started = time.monotonic()
                try:
                    connection.request('GET', path)
                    response = connection.getresponse()
                    response.read()
                    statuses[path][str(response.status)] += 1
                    if 200 <= response.status < 300:
                        samples[path].append((time.monotonic() - request_started) * 1000)
                except (OSError, http.client.HTTPException):
                    statuses[path]['transport_error'] += 1
                    connection.close()
        finally:
            connection.close()
        return samples, statuses

    samples = {path: [] for path in args.path}
    statuses = {path: Counter() for path in args.path}
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        for worker_samples, worker_statuses in pool.map(run, range(args.concurrency)):
            for path in samples:
                samples[path].extend(worker_samples[path])
                statuses[path].update(worker_statuses[path])

    routes = {}
    for path, values in samples.items():
        values.sort()
        count = sum(statuses[path].values())
        routes[path] = {
            'requests': count,
            'statuses': statuses[path],
            'non_2xx_percent': round(100 * (count - len(values)) / count, 3) if count else None,
            'p95_success_ms': round(values[math.ceil(.95 * len(values)) - 1], 2) if values else None,
        }
    print(json.dumps({'concurrency': args.concurrency, 'target_seconds': args.seconds, 'routes': routes}, indent=2))


if __name__ == '__main__':
    main()
