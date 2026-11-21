#!/usr/bin/env python3
"""Run one v2 catalog capacity phase in the dedicated local synthetic Compose fixture."""

import argparse
import fcntl
import ipaddress
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit


HERE = Path(__file__).resolve().parent
PROJECT = 'hd-ops-ext02-v2capacity'
PROJECTS = (PROJECT, f'{PROJECT}-candidate')
DATABASE = 'hd_ext_scale_v2capacity'
NAMESPACE = 'hd-ext-scale-v2capacity'
OVERLAYS = ('compose.yaml', 'compose.proxy.yaml', 'compose.media.yaml', 'compose.ops-ext.yaml', 'compose.ops-scale.yaml')
PHASES = ('cold', 'warm', 'sync', 'redis-failure', 'contact', 'contact-failure', 'analytics', 'analytics-failure', 'rate-limit')


def compose_command(args, parser):
    sys.path.insert(0, str(HERE.parent))
    from runtime import config, scale_database, validate_operator, validate_proxy

    values, root = config(args.env)
    validate_operator(values)
    validate_proxy(values)
    release = values.get('RELEASE_ID', '')
    origin = urlsplit(values['SITE_ORIGIN'])
    if (scale_database(values, args.project) != DATABASE or values.get('EXTERNAL_CACHE_NAMESPACE') != NAMESPACE
            or values.get('EXTERNAL_PUBLIC_CACHE') != 'redis' or not re.fullmatch(r'[a-f0-9]{40}', release)
            or origin.scheme != 'https' or origin.hostname not in {'127.0.0.1', 'localhost'}
            or origin.port != 3642 or values.get('HTTPS_PORT') != '3642'
            or not ipaddress.IPv4Network(values['PROXY_SUBNET']).is_private
            or not (root / 'postgres').is_dir()):
        parser.error('Use the initialized dedicated v2 local capacity fixture on loopback port 3642')
    for key in ('HD_DATABASE_NAME', 'HD_DEPLOYMENT_ENV', 'POSTGRES_DATA_ROOT', 'MEDIA_DATA_ROOT', 'RELEASE_SECRETS_ROOT'):
        if key in values:
            parser.error('Use only the synthetic Compose runtime profile')
    env = {key: value for key, value in os.environ.items()
           if key not in values and not key.startswith(('DOCKER_', 'COMPOSE_', 'EXTERNAL_', 'ANALYTICS_', 'HD_'))}
    socket = subprocess.check_output(
        ['docker', 'context', 'inspect', args.docker_context, '--format', '{{.Endpoints.docker.Host}}'],
        env=env, text=True,
    ).strip()
    if not socket.startswith('unix:///'):
        parser.error('The benchmark requires a local Unix Docker socket')
    command = ['docker', '--context', args.docker_context, 'compose', '--project-name', args.project,
               '--env-file', str(args.env.resolve()), '--profile', 'scale-sync']
    for overlay in OVERLAYS:
        command += ['-f', str(HERE.parent / overlay)]
    return command, env, release, root


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env', type=Path, required=True)
    parser.add_argument('--docker-context', default='default')
    parser.add_argument('--project', choices=PROJECTS, default=PROJECT)
    parser.add_argument('--queued-loads', type=int, choices=range(17), metavar='0..16',
                        help='Apply the BE synthetic-only origin queue setting')
    parser.add_argument('phase', choices=PHASES)
    parser.add_argument('concurrency', type=int, choices=(20, 50, 100))
    parser.add_argument('requests', type=int)
    parser.add_argument('--sync-generation', type=int,
                        help='First unused increasing generation, required for the concurrent sync phase')
    args = parser.parse_args()
    if (not args.concurrency <= args.requests <= 10_000
            or (args.phase == 'cold' and args.requests != args.concurrency)
            or (args.phase == 'rate-limit' and args.requests <= 120)):
        parser.error('Invalid request count for this phase')
    if args.phase == 'sync' and not 1 <= (args.sync_generation or 0) <= 99_999:
        parser.error('Supply an unused --sync-generation between 1 and 99999')
    command, env, release, root = compose_command(args, parser)
    with (root / 'v2-capacity.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return run_phase(args, parser, command, env, release)


def run_phase(args, parser, command, env, release):
    def compose(*parts, **kwargs):
        return subprocess.run(command + list(parts), check=True, env=env, text=True, **kwargs)

    active = set(compose('ps', '--status', 'running', '--services', capture_output=True).stdout.split())
    if active != {'postgres', 'redis'}:
        parser.error('Only the dedicated PostgreSQL and Redis may be running before this phase')
    if args.phase == 'cold':
        # This fixture disables Redis persistence. A new application plus Redis restart clears the DTO caches.
        compose('restart', 'redis', stdout=sys.stderr)
        compose('up', '--no-build', '--no-recreate', '--pull', 'never', '--wait', '--wait-timeout', '30', '-d', 'redis',
                stdout=sys.stderr)
    app = ['run', '--no-deps', '--pull', 'never', '--rm', '-T',
           '--volume', f'{HERE / "v2-capacity.mjs"}:/bench/v2-capacity.mjs:ro',
           '-e', f'HD_RELEASE_ID={release}', '-e', 'HD_DEPLOYMENT_ENV=test', '-e', 'ANALYTICS_ORIGINS=http://localhost']
    if args.queued_loads is not None:
        app.extend(('-e', f'EXTERNAL_CACHE_MAX_QUEUED_LOADS={args.queued_loads}'))
    if args.phase == 'redis-failure':
        app.extend(('-e', 'EXTERNAL_REDIS_PORT=1'))
    if args.phase in {'contact', 'contact-failure'}:
        app.extend(('-e', 'ANALYTICS_CONTACT_LOCAL_ENABLED=true'))
    if args.phase == 'sync':
        app.extend(('-e', f'CAPACITY_SYNC_GENERATION={args.sync_generation}'))
    app.extend(('api', '/bench/v2-capacity.mjs', args.phase, str(args.concurrency), str(args.requests)))
    if args.phase != 'sync':
        return subprocess.run(command + app, env=env).returncode

    try:
        compose('up', '--no-build', '--no-recreate', '--pull', 'never', '--wait', '--wait-timeout', '35', '-d', 'worker',
                stdout=sys.stderr)
        with subprocess.Popen(command + app, env=env) as benchmark:
            generation = args.sync_generation
            while benchmark.poll() is None and generation <= 100_000:
                compose('exec', '-T', 'worker', 'node', 'dist/external/sync/cli.js', '--seed', str(generation),
                        stdout=subprocess.DEVNULL)
                generation += 1
                try:
                    return benchmark.wait(timeout=0.45)
                except subprocess.TimeoutExpired:
                    pass
            return benchmark.wait()
    finally:
        compose('stop', 'worker', stdout=sys.stderr)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (KeyError, ValueError, OSError, subprocess.CalledProcessError):
        print('The isolated v2 capacity fixture could not be run.', file=sys.stderr)
        sys.exit(2)
