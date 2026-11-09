#!/bin/sh
set -eu
umask 077
secret=/run/secrets/ext_cache_password
password=$(cat "$secret")
case "$password" in
  ''|*[!0-9a-f]*) echo 'Expected a generated hexadecimal cache password' >&2; exit 1 ;;
esac
test "${#password}" -eq 64
hash=$(printf '%s' "$password" | sha256sum)
unset password
{
  printf '%s\n' 'user default off resetpass'
  printf 'user hd-cache on #%s ~hd-ext:* +ping +get +set +del +unlink +expire +pttl\n' "${hash%% *}"
} > /tmp/hd-ext.acl
exec redis-server --aclfile /tmp/hd-ext.acl --protected-mode yes --dir /data \
  --save '' --appendonly no --maxmemory 128mb --maxmemory-policy allkeys-lru
