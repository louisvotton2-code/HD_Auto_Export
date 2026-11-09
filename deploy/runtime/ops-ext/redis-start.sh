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
namespace=${OPS_EXT_SCALE_CACHE_NAMESPACE:-}
if [ -n "$namespace" ]; then
  case "$namespace" in hd-ext-scale-*) ;; *) exit 1 ;; esac
  slug=${namespace#hd-ext-scale-}
  case "$slug" in ''|*[!a-z0-9-]*) exit 1 ;; esac
  test "${#slug}" -le 48
fi
{
  printf '%s\n' 'user default off resetpass'
  if [ -n "$namespace" ]; then
    printf 'user hd-cache on #%s ~%s:slot:* +get +set\n' "${hash%% *}" "$namespace"
  else
    printf 'user hd-cache on #%s ~hd-ext:* +ping +get +set +del +unlink +expire +pttl\n' "${hash%% *}"
  fi
} > /tmp/hd-ext.acl
exec redis-server --aclfile /tmp/hd-ext.acl --protected-mode yes --dir /data \
  --save '' --appendonly no --maxmemory 128mb --maxmemory-policy allkeys-lru
