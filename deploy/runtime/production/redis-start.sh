#!/bin/sh
# Private cache only. No default user, persistence, public port or administrative ACL.
set -eu
umask 077
LC_ALL=C; export LC_ALL
namespace=${OPS_PUBLIC_CACHE_NAMESPACE:?set the exact API namespace}
case "$namespace" in hd:catalog:*) ;; *) echo 'Invalid public cache namespace' >&2; exit 1 ;; esac
suffix=${namespace#hd:catalog:}
case "$suffix" in ''|*[!a-z0-9-]*) echo 'Invalid public cache namespace' >&2; exit 1 ;; esac
test "${#suffix}" -le 48
secret=/run/secrets/public_cache_password
test -f "$secret" && test ! -L "$secret"
password=$(cat "$secret")
case "$password" in ''|*[!0-9a-f]*) echo 'Invalid cache secret file' >&2; exit 1 ;; esac
test "${#password}" -eq 64
hash=$(printf '%s' "$password" | sha256sum)
unset password
{
  printf '%s\n' 'user default off resetpass'
  printf 'user hd-cache reset on #%s' "${hash%% *}"
  i=0
  while [ "$i" -lt 64 ]; do printf ' ~%s:slot:%s' "$namespace" "$i"; i=$((i+1)); done
  printf '%s\n' ' +get +set'
} > /tmp/hd-public.acl
unset hash
exec redis-server --aclfile /tmp/hd-public.acl --protected-mode yes --dir /data \
  --save '' --appendonly no --maxmemory 128mb --maxmemory-policy allkeys-lru \
  --maxclients 64 --timeout 60 --tcp-keepalive 60
