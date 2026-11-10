#!/bin/sh
set -eu
# Read file while root, before the official entrypoint drops to postgres.
export HD_APP_PASSWORD="$(cat /run/secrets/app_db_password)"
exec /usr/local/bin/docker-entrypoint.sh "$@"
