"""Conservative EXT07 checkpoint estimate; index bytes are included in database bytes."""
import argparse
import json
import math
from pathlib import Path


def nonnegative(value, name):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f'{name} must be a nonnegative integer')
    return value


def estimate(baseline, current, *, processed, target):
    processed = nonnegative(processed, 'processed')
    target = nonnegative(target, 'target')
    if processed < 10000 or target < processed:
        raise ValueError('Estimate requires at least 10000 measured source identities and target >= processed')
    fields = ('diskTotalBytes', 'diskUsedBytes', 'databaseBytes', 'indexBytes', 'walBytes', 'archiveBytes', 'stagingBytes', 'backupBytes')
    for sample in (baseline, current):
        for field in fields:
            nonnegative(sample[field], field)
        if not sample['diskTotalBytes'] or sample['diskUsedBytes'] > sample['diskTotalBytes']:
            raise ValueError('Invalid disk capacity sample')
        if sample['indexBytes'] > sample['databaseBytes']:
            raise ValueError('Index bytes must be included within database bytes')
    if baseline['diskTotalBytes'] != current['diskTotalBytes']:
        raise ValueError('Checkpoint must use the same filesystem capacity')
    # All measured sources count, including failed/withdrawn, so the checkpoint
    # denominator must come from the worker, never the current public count.
    per_source = {field: max(0, current[field] - baseline[field]) / processed
                  for field in ('databaseBytes', 'archiveBytes')}
    remaining = target - processed
    growth = math.ceil(sum(per_source.values()) * remaining)
    if baseline.get('archivesInDatabase', False) != current.get('archivesInDatabase', False):
        raise ValueError('Archive accounting mode changed between samples')
    history_fields = ('databaseBytes', 'archiveBytes') if current.get('archivesInDatabase', False) else ('archiveBytes',)
    archive_history_reserve = sum(current[field] + math.ceil(per_source[field] * remaining) for field in history_fields)
    active = current['databaseBytes'] + current['archiveBytes'] + growth + archive_history_reserve
    # Current filesystem usage already includes staging, old backups and WAL.
    # Reserve two future *uncompressed* full recovery points plus one additional
    # observed WAL window. Existing release-point backups remain accounted for.
    recovery_reserve = 2 * active
    wal_reserve = max(current['walBytes'], baseline['walBytes'], 2 * 1024**3)
    projected = current['diskUsedBytes'] + growth + archive_history_reserve + recovery_reserve + wal_reserve
    used_ratio = current['diskUsedBytes'] / current['diskTotalBytes']
    projected_ratio = projected / current['diskTotalBytes']
    return {
        'processedSources': processed, 'targetSources': target,
        'measured': current, 'bytesPerSource': per_source,
        'remainingGrowthBytes': growth, 'futureRecoveryReserveBytes': recovery_reserve,
        'archiveHistoryReserveBytes': archive_history_reserve, 'additionalWalReserveBytes': wal_reserve, 'projectedPeakBytes': projected,
        'currentRatio': used_ratio, 'projectedPeakRatio': projected_ratio,
        'warning': used_ratio >= .60 or projected_ratio >= .60,
        'pauseHeavyWork': used_ratio >= .70 or projected_ratio >= .70,
        'reason': 'capacity_limit' if used_ratio >= .70 or projected_ratio >= .70 else 'within_budget',
        'assumptions': 'linear database/archive growth; one extra archive version (whole DB reserved if archives are embedded); two uncompressed future backups; WAL reserve at least 2 GiB; indexes not double counted; staging and existing backups already in disk usage',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--current', type=Path, required=True)
    parser.add_argument('--processed', type=int, required=True)
    parser.add_argument('--target', type=int, required=True)
    args = parser.parse_args()
    result = estimate(json.loads(args.baseline.read_text()), json.loads(args.current.read_text()), processed=args.processed, target=args.target)
    print(json.dumps(result, indent=2))
    return 2 if result['pauseHeavyWork'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
