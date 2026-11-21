"""Prepare a new local Nginx country map from a reviewed DB-IP Lite CSV gzip."""

import argparse
import csv
import gzip
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import tempfile


MAX_COMPRESSED_BYTES = 64 * 1024**2
MAX_ROWS = 2_000_000
MAX_PREFIXES = 2_000_000
MAX_LINE_BYTES = 128
COUNTRY = re.compile(r'[A-Z]{2}', re.ASCII)


def rows(compressed):
    """Require disjoint address ranges per family; omit provider unknown rows."""
    last_end = {4: -1, 6: -1}
    count = 0
    while line := compressed.readline(MAX_LINE_BYTES + 1):
        count += 1
        if count > MAX_ROWS or len(line) > MAX_LINE_BYTES:
            raise ValueError('Country CSV exceeds input limits')
        try:
            first_text, last_text, country = next(csv.reader([line.decode('ascii')], strict=True))
            first, last = ipaddress.ip_address(first_text), ipaddress.ip_address(last_text)
            if (first.version != last.version or not COUNTRY.fullmatch(country)
                    or ('%' in first_text or '%' in last_text)
                    or int(first) > int(last) or int(first) <= last_end[first.version]):
                raise ValueError
        except (ValueError, csv.Error) as error:
            raise ValueError(f'Invalid or overlapping country range at row {count}') from error
        last_end[first.version] = int(last)
        if country != 'ZZ':
            yield first, last, country


def build(source_path, expected, output_path):
    if not re.fullmatch(r'[a-f0-9]{64}', expected):
        raise ValueError('Supply the reviewed source SHA-256')
    fd = os.open(source_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= MAX_COMPRESSED_BYTES:
            raise ValueError('Expected a bounded regular country database')
        if hashlib.file_digest(source, 'sha256').hexdigest() != expected:
            raise ValueError('Country database SHA-256 does not match its reviewed input')
        source.seek(0)
        with tempfile.NamedTemporaryFile('w', encoding='ascii', dir=output_path.parent,
                                         prefix='.analytics-geo-', delete=False) as out:
            temporary = Path(out.name)
            counts = {4: 0, 6: 0}
            total = 0
            try:
                out.write(f'# DB-IP Lite (CC BY 4.0), https://db-ip.com/; input SHA-256 {expected}\n')
                with gzip.GzipFile(fileobj=source) as compressed:
                    for first, last, country in rows(compressed):
                        for prefix in ipaddress.summarize_address_range(first, last):
                            counts[first.version] += 1
                            total += 1
                            if total > MAX_PREFIXES:
                                raise ValueError('Expanded country database exceeds prefix limits')
                            out.write(f'{prefix} {country};\n')
                after = os.fstat(source.fileno())
                if (min(counts.values()) <= 0 or
                        (before.st_size, before.st_mtime_ns, before.st_ctime_ns) !=
                        (after.st_size, after.st_mtime_ns, after.st_ctime_ns)):
                    raise ValueError('Expected an unchanged database with both IPv4 and IPv6')
                out.flush()
                os.fchmod(out.fileno(), 0o644)
                os.fsync(out.fileno())
                with temporary.open('rb') as prepared:
                    output_hash = hashlib.file_digest(prepared, 'sha256').hexdigest()
                # Build a new candidate only; deployment validates and switches it separately.
                os.link(temporary, output_path)
            finally:
                temporary.unlink(missing_ok=True)
    return {'sourceSha256': expected, 'tableSha256': output_hash,
            'ipv4Prefixes': counts[4], 'ipv6Prefixes': counts[6]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--expect-sha256', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(build(args.source, args.expect_sha256, args.output), sort_keys=True))
    except (OSError, ValueError, EOFError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
