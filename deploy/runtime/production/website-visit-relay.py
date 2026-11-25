"""Forward private gateway datagrams without keeping a visitor log or deduplicating."""

import argparse
from collections import Counter, deque
from datetime import datetime, timezone
import fcntl
from heapq import heappop, heappush
from http.client import HTTPConnection, HTTPException
from ipaddress import ip_address
from itertools import count
import json
import os
from pathlib import Path
from queue import Empty, Full, Queue
import re
import resource
import signal
import socket
import stat
from threading import Event, Lock, Thread
from time import monotonic, time


DATAGRAM_LIMIT = 160
QUEUE_LIMIT = 256
MAX_AGE_MS = 60_000
HOUR_MS = 3_600_000
GAP_SECONDS = 60
DELIVERY_INTERVAL = 0.06
SEAL_DELAY_MS = 125_000
AUDIT_WAIT_MS = 600_000
REORDER_MS = 250
PRIVATE_ENDPOINT = '/internal/analytics/ip-visits'
RFC3164 = re.compile(rb'<190>[A-Z][a-z]{2} [ 0-9][0-9] [0-9]{2}:[0-9]{2}:[0-9]{2} hd_visit: '
                     rb'v1 (visit|coverage) ([0-9]{10})\.([0-9]{3})(?: ([0-9A-Fa-f:.]{2,45}))?')


def decode(payload, now_ms):
    match = RFC3164.fullmatch(payload) if len(payload) <= DATAGRAM_LIMIT else None
    if match is None:
        raise ValueError('Unexpected gateway envelope')
    kind, seconds, milliseconds, raw = match.groups()
    timestamp = int(seconds)*1000 + int(milliseconds)
    if not now_ms-MAX_AGE_MS <= timestamp <= now_ms+2_000:
        raise ValueError('Gateway clock outside delivery window')
    if kind == b'coverage' and raw is None:
        return {'kind': 'coverage', 'atMs': timestamp}
    if kind != b'visit' or raw is None:
        raise ValueError('Unexpected gateway event shape')
    address = ip_address(raw.decode('ascii'))
    address = getattr(address, 'ipv4_mapped', None) or address
    return {'kind': 'visit', 'atMs': timestamp, 'address': address.compressed}


def private_file(path, limit):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as handle:
        status = os.fstat(handle.fileno())
        if not stat.S_ISREG(status.st_mode) or status.st_uid != os.getuid() or status.st_mode & 0o077:
            raise ValueError('Expected an owner-only regular file')
        data = handle.read(limit+1)
    if not 0 < len(data) <= limit:
        raise ValueError('Unexpected private file size')
    return data


def private_socket_path(value):
    path = Path(value)
    if not path.is_absolute() or path.parent.resolve(strict=True) != path.parent:
        raise ValueError('Expected a private absolute socket path')
    status = path.parent.stat()
    if status.st_uid != os.getuid() or status.st_mode & 0o077:
        raise ValueError('Expected an owner-only socket directory')
    return path


class DeliveryFailure(OSError):
    def __init__(self, category):
        super().__init__(category)
        self.category = category


class PrivateApi:
    def __init__(self, host, key):
        self.host = str(host)
        self.headers = {'Content-Type': 'application/json', 'X-HD-Analytics-Visit-Key': key,
                        'Connection': 'close'}

    def __call__(self, payload):
        # The relay is rate limited and the API is on the same host. A fresh
        # connection avoids losing the first document after an idle period.
        connection = HTTPConnection(self.host, 3320, timeout=0.75)
        try:
            for attempt in range(2):
                try:
                    connection.connect()
                except OSError:
                    connection.close()
                    if attempt:
                        raise DeliveryFailure('connectFailed') from None
                else:
                    break
            body = json.dumps(payload, separators=(',', ':'))
            try:
                connection.request('POST', PRIVATE_ENDPOINT, body, self.headers)
                status = connection.getresponse().status
            except (OSError, HTTPException):
                # Request bytes may already have reached the API.
                raise DeliveryFailure('outcomeUncertain') from None
        finally:
            connection.close()

        if status == 204:
            return attempt != 0
        if status == 429:
            raise DeliveryFailure('httpRateLimited')
        if 400 <= status < 500:
            raise DeliveryFailure('httpRejected')
        if status >= 500:
            raise DeliveryFailure('httpUnavailable')
        raise DeliveryFailure('httpUnexpected')


class Health:
    def __init__(self):
        self.lock = Lock()
        self.counts = Counter()

    def record(self, key, count=1):
        with self.lock:
            self.counts[key] += count

    def flush(self):
        with self.lock:
            values = dict(self.counts)
            self.counts.clear()
        print(json.dumps({'kind': 'website_visit_relay', **values}), flush=True)


def utc_iso(timestamp):
    return datetime.fromtimestamp(timestamp/1000, timezone.utc).isoformat(timespec='milliseconds')


class Coverage:
    def __init__(self):
        self.lock = Lock()
        self.beats = deque(maxlen=768)
        self.hours = {}
        self.delivered = Counter()
        self.sealed_through = -1

    def observe(self, timestamp, *, heartbeat=False, lost=False):
        hour = timestamp-timestamp%HOUR_MS
        with self.lock:
            if heartbeat:
                self.beats.append(timestamp)
            if hour > self.sealed_through:
                self.hours[hour] = self.hours.get(hour, False) or lost

    def forwarded(self, timestamp):
        with self.lock:
            self.delivered[timestamp-timestamp%HOUR_MS] += 1

    def ready(self, now, audit=lambda _: None):
        with self.lock:
            for hour in tuple(self.hours):
                if hour+3*HOUR_MS < now:
                    del self.hours[hour]
                    self.delivered.pop(hour, None)
            if not self.hours:
                return None
            first = min(self.hours)
            end = first+HOUR_MS
            if end+SEAL_DELAY_MS > now:
                return None
            before = max((beat for beat in self.beats if beat <= first), default=0)
            after = min((beat for beat in self.beats if beat >= end), default=0)
            chain = sorted(beat for beat in self.beats if before <= beat <= after)
            covered = (before > 0 and after >= end and not self.hours[first]
                        and all(b-a <= 45_000 for a,b in zip(chain, chain[1:])))
            if not covered:
                return first, 'partial'
            expected = audit(first)
            if expected is None and now < end+AUDIT_WAIT_MS:
                return None
            return first, 'complete' if expected == self.delivered[first] else 'partial'

    def sealed(self, hour):
        with self.lock:
            self.hours.pop(hour, None)
            self.delivered.pop(hour, None)
            self.sealed_through = hour


def audited_count(directory, hour):
    if directory is None:
        return None
    stamp = hour//1000
    try:
        fd = os.open(directory/f'hour-{stamp}.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o027:
                return None
            payload = handle.read(513)
        if len(payload) > 512:
            return None
        record = json.loads(payload)
        if (record.keys() == {'hour', 'status', 'requests'} and record['hour'] == stamp
                and record['status'] == 'complete' and type(record['requests']) is int and record['requests'] >= 0):
            return record['requests']
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    return None


def accept(sock, inbox, health, coverage, stop):
    report_at = monotonic()+GAP_SECONDS
    while not stop.is_set():
        if monotonic() >= report_at:
            health.flush()
            report_at = monotonic()+GAP_SECONDS
        try:
            packet = sock.recv(DATAGRAM_LIMIT+1)
        except TimeoutError:
            continue
        now = int(time()*1000)
        try:
            event = decode(packet, now)
        except ValueError:
            coverage.observe(now, lost=True)
            health.record('invalid')
            continue
        timestamp = event['atMs']
        if event['kind'] == 'coverage':
            coverage.observe(timestamp, heartbeat=True)
        else:
            coverage.observe(timestamp)
            try:
                inbox.put_nowait(event)
                health.record('received')
            except Full:
                coverage.observe(timestamp, lost=True)
                health.record('queueDropped')


def send_with_health(send, payload, health):
    try:
        recovered = send(payload)
    except DeliveryFailure as failure:
        health.record(failure.category)
        raise
    if recovered:
        health.record('connectRecovered')


def deliver(inbox, send, health, coverage, stop, audit_directory=None):
    next_send = next_seal = 0
    latest_delivery = -1
    pending, order = [], count()
    while not stop.is_set():
        now = int(time()*1000)
        ready = coverage.ready(now, lambda hour: audited_count(audit_directory, hour)) if monotonic() >= next_seal else None
        if ready is not None:
            hour, status = ready
            try:
                send_with_health(send, {'version': 1, 'kind': 'coverage', 'hour': utc_iso(hour),
                                        'status': status}, health)
            except (OSError, HTTPException, ValueError):
                health.record('coverageFailed')
                next_seal = monotonic()+15
            else:
                coverage.sealed(hour)
                health.record('coverageComplete' if status == 'complete' else 'coveragePartial')
        delay = 0.2 if not pending else max((pending[0][0]+REORDER_MS-now)/1000, next_send-monotonic())
        while len(pending) < QUEUE_LIMIT:
            try:
                event = inbox.get(timeout=max(0, min(delay, 0.2)))
            except Empty:
                break
            else:
                heappush(pending, (event['atMs'], next(order), event))
                delay = 0
        if not pending:
            continue
        now = int(time()*1000)
        remaining = max((pending[0][0]+REORDER_MS-now)/1000, next_send-monotonic())
        if remaining > 0:
            if len(pending) == QUEUE_LIMIT:
                stop.wait(min(remaining, 0.2))
            continue
        timestamp, _, event = heappop(pending)
        if timestamp < now-MAX_AGE_MS or timestamp < latest_delivery:
            coverage.observe(timestamp, lost=True)
            health.record('late')
            continue
        latest_delivery = timestamp
        next_send = monotonic()+DELIVERY_INTERVAL
        try:
            send_with_health(send, {'version': 1, 'kind': 'document', 'address': event['address'],
                                    'observedAt': utc_iso(timestamp)}, health)
            coverage.forwarded(timestamp)
            health.record('forwarded')
        except (OSError, HTTPException, ValueError):
            coverage.observe(timestamp, lost=True)
            health.record('deliveryFailed')


def clear_stale_socket(path):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid():
        raise ValueError('Unexpected existing gateway socket')
    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as probe:
        try:
            probe.connect(str(path))
        except ConnectionRefusedError:
            path.unlink()
        else:
            raise ValueError('Gateway socket already has a receiver')


def run_listener(path, send, preview_probe=False, audit_directory=None):
    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    lock_fd = os.open(path.with_suffix('.lock'), os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'wb') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        clear_stale_socket(path)
        receive(path, send, preview_probe, audit_directory)


def probe_preview(stop):
    while not stop.is_set():
        try:
            probe = HTTPConnection('127.0.0.1', 3363, timeout=0.75)
            try:
                probe.request('GET', '/health/proxy')
                probe.getresponse().read(64)
            finally:
                probe.close()
        except (OSError, HTTPException):
            pass  # Without the gateway datagram, the coverage window shows the gap.
        stop.wait(15)


def receive(path, send, preview_probe, audit_directory):
    stop = Event()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_: stop.set())
    inbox, health, coverage = Queue(QUEUE_LIMIT), Health(), Coverage()
    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as receiver:
        receiver.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 65_536)
        receiver.settimeout(0.5)
        receiver.bind(str(path))
        identity = path.stat().st_ino
        writer = Thread(target=deliver, args=(inbox, send, health, coverage, stop, audit_directory), daemon=True)
        writer.start()
        if preview_probe:
            Thread(target=probe_preview, args=(stop,), daemon=True).start()
        try:
            print('{"kind":"website_visit_relay_ready"}', flush=True)
            accept(receiver, inbox, health, coverage, stop)
        finally:
            stop.set()
            writer.join(timeout=2)
            if path.is_socket() and path.stat().st_ino == identity:
                path.unlink()
            health.flush()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    args = parser.parse_args()
    try:
        config = json.loads(private_file(args.config, 4096))
        if config == {'enabled': False}:
            print('{"kind":"website_visit_relay_disabled"}')
            return
        if (config['enabled'] is not True or
                set(config)-{'enabled', 'socket', 'apiAddress', 'keyFile', 'previewProbe', 'documentAuditDirectory'}):
            raise ValueError('Unexpected relay settings')
        path = private_socket_path(config['socket'])
        host = ip_address(config['apiAddress'])
        preview_probe = config.get('previewProbe', False)
        if (not (host.is_private or host.is_loopback) or host.is_unspecified or host.is_multicast
                or host.is_link_local or type(preview_probe) is not bool or (preview_probe and not host.is_loopback)):
            raise ValueError('Expected a private API address')
        key_file = Path(config['keyFile'])
        if not key_file.is_absolute():
            raise ValueError('Expected an absolute private key path')
        key = private_file(key_file, 65).decode('ascii').strip()
        if not re.fullmatch('[a-f0-9]{64}', key):
            raise ValueError('Unexpected relay key')
        audit_directory = None
        if 'documentAuditDirectory' in config:
            audit_directory = Path(config['documentAuditDirectory'])
            if not audit_directory.is_absolute() or audit_directory.resolve(strict=True) != audit_directory:
                raise ValueError('Expected a canonical audit directory')
            audit_info = audit_directory.stat()
            if not stat.S_ISDIR(audit_info.st_mode) or audit_info.st_mode & 0o027:
                raise ValueError('Expected a protected audit directory')
        run_listener(path, PrivateApi(host, key), preview_probe, audit_directory)
    except (OSError, ValueError, TypeError, KeyError):
        parser.exit(1, 'Website visit relay could not start or stopped unexpectedly.\n')


if __name__ == '__main__':
    main()
