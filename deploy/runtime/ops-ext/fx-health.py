#!/usr/bin/env python3
"""Translate the private FX CLI health summary into monitoring exit status."""
import json
import sys


def main():
    try:
        summary = json.load(sys.stdin)
        status = summary['status']
        outcome = summary['lastOutcome']
        if status not in ('missing', 'fresh', 'retained', 'expired') or outcome not in ('never', 'pending', 'success', 'failed'):
            raise ValueError('Unknown health state')
    except (ValueError, KeyError, TypeError):
        print(json.dumps({'severity': 'critical', 'status': 'invalid-health'}))
        return 2
    code = 2 if status in ('missing', 'expired') else 1 if status == 'retained' or outcome == 'failed' else 0
    print(json.dumps({'severity': ('ok', 'warning', 'critical')[code], 'status': status, 'lastOutcome': outcome}))
    return code


if __name__ == '__main__':
    sys.exit(main())
