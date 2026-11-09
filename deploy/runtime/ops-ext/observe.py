#!/usr/bin/env python3
"""Emit resource and health snapshots for a dedicated scale Compose project."""
import argparse
from datetime import datetime, timezone
import json
import re
import subprocess
import time


def docker_lines(*arguments):
    return subprocess.check_output(['docker', *arguments], text=True).splitlines()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True)
    parser.add_argument('--samples', type=int, choices=range(1, 181), default=1, metavar='1..180')
    parser.add_argument('--interval', type=int, choices=range(1, 61), default=5, metavar='1..60')
    args = parser.parse_args()
    if not re.fullmatch(r'hd-ops-ext02(?:-[a-z0-9][a-z0-9-]*)?', args.project):
        parser.error('Expected a dedicated scale Compose project')

    label = f'label=com.docker.compose.project={args.project}'
    state_fields = ('{{.Id}}\t{{index .Config.Labels "com.docker.compose.service"}}\t{{.State.Status}}\t'
                    '{{if .State.Health}}{{.State.Health.Status}}{{end}}\t{{.RestartCount}}\t{{.State.OOMKilled}}')
    for index in range(args.samples):
        started = time.monotonic()
        containers = docker_lines('ps', '-aq', '--filter', label, '--filter', 'label=com.docker.compose.oneoff=False')
        if not containers:
            raise SystemExit('No containers belong to the requested scale project')
        state = []
        for line in docker_lines('inspect', '--format', state_fields, *containers):
            identity, service, status, health, restarts, oom = line.split('\t')
            state.append({'id': identity, 'service': service, 'status': status, 'health': health or None,
                          'restarts': int(restarts), 'oomKilled': oom == 'true'})
        active = [item['id'] for item in state if item['status'] == 'running']
        stats = [json.loads(line) for line in docker_lines('stats', '--no-stream', '--format', '{{json .}}', *active)] if active else []
        print(json.dumps({'at': datetime.now(timezone.utc).isoformat(), 'project': args.project,
                          'state': state, 'stats': stats}), flush=True)
        if index + 1 < args.samples:
            time.sleep(max(0, args.interval - (time.monotonic() - started)))


if __name__ == '__main__':
    main()
