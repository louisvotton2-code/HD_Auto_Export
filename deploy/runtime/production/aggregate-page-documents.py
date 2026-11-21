"""Summarize one closed gateway hour from privacy-filtered Nginx logs."""

import argparse
from collections import Counter
from datetime import datetime, timedelta
import json
import math
from pathlib import Path
import sys
from zoneinfo import ZoneInfo


BEIJING = ZoneInfo('Asia/Shanghai')
KIND = 'page_document_v1'
RECORD_PREFIX = b'{"kind":"page_document_v1"'
FIELDS = {'kind', 'time', 'locale', 'pageType', 'cache'}
LOCALES = {'zh', 'en', 'ru'}
PAGE_TYPES = {'home', 'catalog', 'vehicle', 'calculator', 'parts', 'guide', 'about', 'other'}
CACHES = {'cold', 'hot'}
MAX_RECORD_BYTES = 256


def beijing_hour(value):
    hour = datetime.fromisoformat(value)
    if hour.tzinfo is None:
        raise ValueError('Supply an hour with an explicit offset')
    hour = hour.astimezone(BEIJING)
    if hour.minute or hour.second or hour.microsecond:
        raise ValueError('Supply a whole Beijing hour')
    return hour


def aggregate(stream, hour, status):
    now = datetime.now(BEIJING)
    if status not in ('complete', 'partial') or hour > now:
        raise ValueError('Supply a started hour and a known coverage status')
    if status == 'complete' and hour + timedelta(hours=1) > now:
        raise ValueError('The aggregation hour is still open')
    start, end = hour.timestamp(), (hour + timedelta(hours=1)).timestamp()
    counts = Counter()
    for raw in stream:
        if not raw.startswith(RECORD_PREFIX):
            continue
        try:
            if len(raw) > MAX_RECORD_BYTES or not raw.endswith(b'\n'):
                raise ValueError
            record = json.loads(raw)
            if (not isinstance(record, dict) or record.keys() != FIELDS or record['kind'] != KIND
                    or type(record['time']) not in (float, int) or not math.isfinite(record['time'])
                    or record['locale'] not in LOCALES or record['pageType'] not in PAGE_TYPES
                    or record['cache'] not in CACHES):
                raise ValueError
        except (ValueError, TypeError, OverflowError) as error:
            raise ValueError('Malformed page-document log record') from error
        if start <= record['time'] < end:
            counts[record['locale'], record['pageType']] += 1
    if any(count > 100_000_000 for count in counts.values()):
        raise ValueError('Request count exceeds the snapshot limit')
    return {'version': 1, 'hour': hour.isoformat(), 'status': status, 'rows': [
        {'locale': locale, 'pageType': page_type, 'requests': count}
        for (locale, page_type), count in sorted(counts.items())
    ]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--hour', required=True, type=beijing_hour)
    parser.add_argument('--status', choices=('partial', 'complete'), required=True)
    parser.add_argument('--input', type=Path)
    args = parser.parse_args()
    try:
        if args.input is None:
            snapshot = aggregate(sys.stdin.buffer, args.hour, args.status)
        else:
            with args.input.open('rb') as source:
                snapshot = aggregate(source, args.hour, args.status)
    except (OSError, ValueError):
        parser.exit(1, 'Could not aggregate this page-document hour; check the input and arguments.\n')
    print(json.dumps(snapshot, separators=(',', ':')))


if __name__ == '__main__':
    main()
