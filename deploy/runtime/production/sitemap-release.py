"""Prepare and atomically publish the approved public sitemap generation."""

import argparse
from contextlib import contextmanager
from datetime import date, datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
from xml.sax.saxutils import escape, quoteattr


MAX_URLS = 10_000
MAX_BYTES = 50 * 1024**2
MAX_SHARDS = 50_000
MAX_SUPPLIER_VEHICLES = 1_000
# Match the FE canonical and alternate-language metadata.
LANGUAGES = {'zh': 'zh-Hans', 'en': 'en', 'ru': 'ru'}
DEFAULT_LOCALE = 'ru'
GENERATION = re.compile(r'[0-9a-f]{64}')
ORIGIN = re.compile(r'https://[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+')
PATH = re.compile(r'/(zh|en|ru)(/(?:|buy/|about/|cars/(?:[A-Za-z0-9][A-Za-z0-9_-]{0,99}/)?|calculator/[a-z0-9-]+/))')
VEHICLE_ID = re.compile(r'(?:ext-)?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}')
CURSOR = re.compile(r'[A-Za-z0-9_-]{1,512}')
W3C_DATE = re.compile(r'\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?')
XML = b'<?xml version="1.0" encoding="UTF-8"?>\n'
SITEMAP_NS = b'http://www.sitemaps.org/schemas/sitemap/0.9'
START = XML + b'<urlset xmlns="' + SITEMAP_NS + b'" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
END = b'</urlset>\n'
INDEX_START = XML + b'<sitemapindex xmlns="' + SITEMAP_NS + b'">\n'
INDEX_END = b'</sitemapindex>\n'


def need(ok, message):
    if not ok:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def deadline(value):
    if value is None:
        return None
    need(isinstance(value, str) and value.endswith('Z') and W3C_DATE.fullmatch(value),
         'Invalid BE manifest validUntil')
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def expired(value):
    expires_at = deadline(value)
    return expires_at is not None and expires_at <= datetime.now(timezone.utc)


def source_metadata(revision, valid_until):
    need(isinstance(revision, str) and 1 <= len(revision) <= 100, 'Invalid BE manifest revision')
    deadline(valid_until)
    return {'sourceRevision': revision, 'validUntil': valid_until}


def sync_directory(path):
    handle = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(handle)
    finally:
        os.close(handle)


def safe_directory(path):
    info = path.lstat()
    need(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid() and not info.st_mode & 0o022,
         'Expected a non-writable-to-others sitemap directory')


def safe_read(path, max_bytes):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as file:
        info = os.fstat(file.fileno())
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and not info.st_mode & 0o022
             and info.st_size <= max_bytes, 'Invalid sitemap artifact')
        value = file.read(max_bytes + 1)
    need(len(value) <= max_bytes, 'Sitemap artifact exceeds its size bound')
    return value


def durable_write(path, content):
    with path.open('xb') as file:
        file.write(content)
        file.flush()
        os.fchmod(file.fileno(), 0o644)
        os.fsync(file.fileno())


@contextmanager
def locked(root):
    need(root.is_absolute() and root.resolve() == root, 'Expected a canonical absolute sitemap root')
    root.mkdir(mode=0o755, exist_ok=True)
    safe_directory(root)
    fd = os.open(root / '.lock', os.O_RDONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'rb') as lock:
        info = os.fstat(lock.fileno())
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and not info.st_mode & 0o077,
             'Invalid sitemap deployment lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for name in ('prepared', 'generations'):
            directory = root / name
            directory.mkdir(mode=0o755, exist_ok=True)
            safe_directory(directory)
        yield


def validated_entries(origin, entries):
    need(isinstance(origin, str) and ORIGIN.fullmatch(origin), 'Expected the canonical HTTPS origin')
    need(isinstance(entries, list) and entries, 'The approved sitemap list is missing or empty')
    by_path = {}
    localized = {}
    supplier_ids = set()
    for entry in entries:
        need(isinstance(entry, dict) and 'path' in entry and set(entry) <= {'path', 'lastModified'},
             'Expected a canonical path and optional lastModified')
        path = entry['path']
        match = PATH.fullmatch(path) if isinstance(path, str) else None
        need(match is not None and path not in by_path and len(origin + path) < 2048,
             'Invalid, duplicate or overlong canonical sitemap path')
        lastmod = entry.get('lastModified')
        if lastmod is not None:
            need(isinstance(lastmod, str) and W3C_DATE.fullmatch(lastmod), 'Invalid lastModified format')
            if len(lastmod) == 10:
                date.fromisoformat(lastmod)
            else:
                datetime.fromisoformat(lastmod.replace('Z', '+00:00'))
        locale, suffix = match.groups()
        if suffix.startswith('/cars/ext-'):
            supplier_ids.add(suffix)
        by_path[path] = lastmod
        localized.setdefault(suffix, set()).add(locale)
    need(len(supplier_ids) <= MAX_SUPPLIER_VEHICLES, 'Supplier eligibility list exceeds 1,000 distinct vehicles')
    return by_path, localized


def join_vehicle_pages(origin, base_entries, pages):
    base_paths, _ = validated_entries(origin, base_entries)
    need(all(not path[3:].startswith('/cars/') or path[3:] == '/cars/' for path in base_paths),
         'The FE base list must contain only non-vehicle paths')
    need(isinstance(pages, list) and pages, 'Expected complete BE manifest pages')
    source = None
    seen_ids = set()
    seen_cursors = set()
    expected_cursor = None
    entries = list(base_entries)
    for index, page in enumerate(pages):
        need(isinstance(page, dict) and set(page) == {'cursor', 'response'} and page['cursor'] == expected_cursor,
             'BE manifest request cursor does not match the previous page')
        payload = page['response']['data']
        reported_source = source_metadata(payload['revision'], payload['validUntil'])
        need(payload['enabled'] is True and source in (None, reported_source),
             'BE manifest is disabled or changed revision or validUntil')
        source = reported_source
        items = payload['items']
        need(isinstance(items, list) and len(items) <= 500, 'Invalid BE manifest items')
        for item in items:
            vehicle_id, locales, lastmod = item['id'], item['locales'], item['lastModified']
            need(isinstance(vehicle_id, str) and VEHICLE_ID.fullmatch(vehicle_id) and vehicle_id not in seen_ids
                 and isinstance(locales, list) and 1 <= len(locales) <= len(LANGUAGES)
                 and all(isinstance(locale, str) and locale in LANGUAGES for locale in locales)
                 and len(set(locales)) == len(locales) and isinstance(lastmod, str), 'Invalid or repeated BE manifest vehicle')
            seen_ids.add(vehicle_id)
            entries.extend({'path': f'/{locale}/cars/{vehicle_id}/', 'lastModified': lastmod} for locale in locales)
        next_cursor = payload['nextCursor']
        if index + 1 == len(pages):
            need(next_cursor is None, 'Incomplete BE manifest cursor chain')
        else:
            need(isinstance(next_cursor, str) and CURSOR.fullmatch(next_cursor) and next_cursor not in seen_cursors,
                 'Invalid or repeated BE manifest next cursor')
            seen_cursors.add(next_cursor)
        expected_cursor = next_cursor
    need(not expired(source['validUntil']), 'BE manifest is expired')
    return entries, source


def rows(origin, entries):
    by_path, localized = validated_entries(origin, entries)
    for path, lastmod in sorted(by_path.items()):
        suffix = path[3:]
        xml = [f'<url><loc>{escape(origin + path)}</loc>']
        if lastmod is not None:
            xml.append(f'<lastmod>{escape(lastmod)}</lastmod>')
        alternatives = {language: locale for locale, language in LANGUAGES.items() if locale in localized[suffix]}
        alternatives['x-default'] = DEFAULT_LOCALE if DEFAULT_LOCALE in localized[suffix] else next(iter(alternatives.values()))
        for language, locale in alternatives.items():
            href = quoteattr(f'{origin}/{locale}{suffix}')
            xml.append(f'<xhtml:link rel="alternate" hreflang="{language}" href={href}/>')
        xml.append('</url>\n')
        yield ''.join(xml).encode('utf-8')


def shard_rows(origin, entries):
    pending = []
    size = len(START) + len(END)
    for row in rows(origin, entries):
        need(len(START) + len(row) + len(END) <= MAX_BYTES, 'A single URL exceeds the sitemap byte limit')
        if len(pending) == MAX_URLS or size + len(row) > MAX_BYTES:
            yield len(pending), START + b''.join(pending) + END
            pending = []
            size = len(START) + len(END)
        pending.append(row)
        size += len(row)
    if pending:
        yield len(pending), START + b''.join(pending) + END


def shard_name(number):
    return f'{number:05d}.xml'


def generation_id(origin, shards, source):
    provenance = b'' if not source else b'\x00' + json.dumps(source, sort_keys=True).encode()
    return digest(origin.encode() + b'\x00' + b''.join(bytes.fromhex(shard['sha256']) for shard in shards) + provenance)


def index_xml(origin, generation, count):
    items = [f'<sitemap><loc>{escape(origin)}/sitemap-{generation}-{shard_name(i)}</loc></sitemap>\n'
             for i in range(1, count + 1)]
    result = INDEX_START + ''.join(items).encode() + INDEX_END
    need(len(result) <= MAX_BYTES, 'Sitemap index exceeds the protocol byte limit')
    return result


def verify_generation(directory, generation):
    safe_directory(directory)
    manifest = json.loads(safe_read(directory / 'manifest.json', 16 * 1024**2))
    origin, shards = manifest['origin'], manifest['shards']
    source = (source_metadata(manifest['sourceRevision'], manifest['validUntil'])
              if 'sourceRevision' in manifest or 'validUntil' in manifest else {})
    need(ORIGIN.fullmatch(origin) and isinstance(shards, list) and 1 <= len(shards) <= MAX_SHARDS
         and all(GENERATION.fullmatch(shard['sha256']) for shard in shards)
         and manifest['generation'] == generation == generation_id(origin, shards, source),
         'Sitemap generation manifest does not match its content address')
    expected_names = {'index.xml', 'manifest.json'}
    count = 0
    for i, expected in enumerate(shards, start=1):
        name = shard_name(i)
        expected_names.add(name)
        body = safe_read(directory / name, MAX_BYTES)
        size = body.count(b'<url>')
        need(0 < size <= MAX_URLS and body.startswith(START) and body.endswith(END)
             and expected == {'urls': size, 'bytes': len(body), 'sha256': digest(body)},
             'Sitemap shard differs from its manifest')
        count += size
    need({path.name for path in directory.iterdir()} == expected_names and manifest['urls'] == count
         and safe_read(directory / 'index.xml', MAX_BYTES) == index_xml(origin, generation, len(shards)),
         'Incomplete or inconsistent sitemap generation')
    return manifest


def prepare(root, origin, entries, source=None):
    """Build local files while leaving the sitemap currently served unchanged."""
    metadata = {} if source is None else source_metadata(source['sourceRevision'], source['validUntil'])
    with locked(root), tempfile.TemporaryDirectory(prefix='.build-', dir=root / 'prepared') as tmp:
        directory = Path(tmp)
        shards = []
        for i, (count, body) in enumerate(shard_rows(origin, entries), start=1):
            need(i <= MAX_SHARDS, 'Sitemap index exceeds the protocol shard count')
            durable_write(directory / shard_name(i), body)
            shards.append({'urls': count, 'bytes': len(body), 'sha256': digest(body)})
        generation = generation_id(origin, shards, metadata)
        manifest = {
            'generation': generation, 'origin': origin,
            'urls': sum(shard['urls'] for shard in shards), 'shards': shards, **metadata,
        }
        durable_write(directory / 'index.xml', index_xml(origin, generation, len(shards)))
        durable_write(directory / 'manifest.json', json.dumps(manifest, indent=2).encode() + b'\n')
        need(not expired(manifest.get('validUntil')), 'BE manifest is expired')
        for parent in ('generations', 'prepared'):
            existing = root / parent / generation
            if existing.exists() or existing.is_symlink():
                return verify_generation(existing, generation)
        directory.chmod(0o755)
        sync_directory(directory)
        directory.rename(root / 'prepared' / generation)
        sync_directory(root / 'prepared')
        return manifest


def current(root):
    try:
        body = safe_read(root / 'current.xml', MAX_BYTES)
    except FileNotFoundError:
        return None
    match = re.match(rb'<sitemap><loc>https://[a-z0-9.-]+/sitemap-([0-9a-f]{64})-00001[.]xml</loc>',
                     body[len(INDEX_START):])
    need(body.startswith(INDEX_START) and body.endswith(INDEX_END) and match is not None,
         'Invalid active sitemap index')
    return match[1].decode('ascii')


def activate(root, generation, expected_current):
    """Publish a revalidated generation or roll back to a retained generation."""
    need(isinstance(generation, str) and GENERATION.fullmatch(generation), 'Invalid sitemap generation')
    with locked(root):
        need(current(root) == expected_current, 'The active sitemap changed')
        active = root / 'generations' / generation
        prepared = root / 'prepared' / generation
        directory = active if active.exists() or active.is_symlink() else prepared
        manifest = verify_generation(directory, generation)
        need(not expired(manifest.get('validUntil')), 'BE manifest is expired')
        if directory == prepared:
            prepared.rename(active)
            sync_directory(root / 'prepared')
            sync_directory(root / 'generations')
        # Shard URLs never change. An index fetched before the switch remains valid.
        with tempfile.TemporaryDirectory(prefix='.switch-', dir=root) as scratch:
            index = Path(scratch) / 'current.xml'
            durable_write(index, safe_read(active / 'index.xml', MAX_BYTES))
            need(not expired(manifest.get('validUntil')), 'BE manifest is expired')
            os.replace(index, root / 'current.xml')
        sync_directory(root)
        return manifest


def deactivate(root, expected_current, only_if_expired=False):
    """Return to the existing Web route while retaining prior generations."""
    with locked(root):
        active = current(root)
        need(active is not None and active == expected_current, 'The active sitemap changed')
        if only_if_expired:
            manifest = verify_generation(root / 'generations' / active, active)
            if not expired(manifest.get('validUntil')):
                return {'active': active, 'validUntil': manifest.get('validUntil')}
        (root / 'current.xml').unlink()
        sync_directory(root)
        return {'deactivated': active}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    commands = parser.add_subparsers(dest='command', required=True)
    build = commands.add_parser('prepare')
    build.add_argument('--origin', required=True)
    build.add_argument('--input', type=Path, required=True, help='JSON array of approved canonical path records')
    build.add_argument('--vehicle-pages', type=Path, help='Complete BE manifest capture, with request cursor and response for each page')
    switch = commands.add_parser('activate')
    switch.add_argument('--generation', required=True)
    switch.add_argument('--expected-current', required=True, help='Previous generation or none')
    off = commands.add_parser('deactivate')
    off.add_argument('--expected-current', required=True)
    off.add_argument('--if-expired', action='store_true', help='Only deactivate after the BE manifest deadline')
    commands.add_parser('status')
    args = parser.parse_args()
    try:
        if args.command == 'prepare':
            entries = json.loads(safe_read(args.input, 64 * 1024**2))
            source = None
            if args.vehicle_pages:
                pages = json.loads(safe_read(args.vehicle_pages, 64 * 1024**2))
                entries, source = join_vehicle_pages(args.origin, entries, pages)
            result = prepare(args.root, args.origin, entries, source)
        elif args.command == 'activate':
            expected = None if args.expected_current == 'none' else args.expected_current
            result = activate(args.root, args.generation, expected)
        elif args.command == 'deactivate':
            result = deactivate(args.root, args.expected_current, args.if_expired)
        else:
            result = {'active': current(args.root)}
    except (OSError, ValueError, TypeError, KeyError) as error:
        parser.exit(1, f'Sitemap operation failed: {error}\n')
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
