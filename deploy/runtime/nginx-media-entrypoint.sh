#!/bin/sh
set -eu
case "${APP_UID:-}" in ''|*[!0-9]*|0) echo 'Invalid APP_UID' >&2; exit 1;; esac
case "${APP_GID:-}" in ''|*[!0-9]*|0) echo 'Invalid APP_GID' >&2; exit 1;; esac
# Name resolves to the exact API numeric identity; no permission changes to media.
printf 'hdmedia:x:%s:%s:HD media:/nonexistent:/sbin/nologin\n' "$APP_UID" "$APP_GID" >> /etc/passwd
printf 'hdmedia:x:%s:\n' "$APP_GID" >> /etc/group
mkdir -p /tmp/nginx/client /tmp/nginx/proxy /tmp/nginx/fastcgi /tmp/nginx/uwsgi /tmp/nginx/scgi
chown -R "$APP_UID:$APP_GID" /tmp/nginx
exec nginx -c /etc/nginx/nginx-media-main.conf -g 'daemon off;'
