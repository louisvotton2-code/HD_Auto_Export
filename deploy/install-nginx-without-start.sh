#!/bin/sh
# Ubuntu/Debian first install only. Run after the read-only port/service audit.
# Prevent package scripts from starting daemons before the site uses a free port.
# Never overwrite an administrator's existing policy-rc.d.
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "Run with sudo sh deploy/install-nginx-without-start.sh" >&2
    exit 1
fi

if command -v nginx >/dev/null 2>&1; then
    echo "Nginx already exists. Keep its installation/configuration; add a separate site." >&2
    exit 1
fi

if [ -e /usr/sbin/policy-rc.d ] || [ -L /usr/sbin/policy-rc.d ]; then
    echo "Existing /usr/sbin/policy-rc.d found; leaving it untouched. Ask its administrator to apply an equivalent no-autostart policy." >&2
    exit 1
fi

if [ -e /etc/nginx/nginx.conf ]; then
    echo "Existing Nginx configuration found. Inspect and back it up before installing; no files changed." >&2
    exit 1
fi

policy_created=0
cleanup() {
    if [ "$policy_created" -eq 1 ] &&
       [ -f /usr/sbin/policy-rc.d ] &&
       [ "$(sed -n '2p' /usr/sbin/policy-rc.d)" = '# hd-auto temporary no-autostart policy' ]; then
        rm /usr/sbin/policy-rc.d
    fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

apt-get update
# noclobber also protects against another process installing a policy meanwhile.
(set -C; printf '%s\n' '#!/bin/sh' '# hd-auto temporary no-autostart policy' 'exit 101' > /usr/sbin/policy-rc.d)
policy_created=1
chmod 755 /usr/sbin/policy-rc.d
DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get install -y nginx rsync

# It remains stopped while you install a site on the verified free port.
# Disable boot start until its default port-80 site has been reviewed.
systemctl disable nginx
echo "Installed without starting Nginx. Review sites-enabled/default, install a free-port site, run nginx -t, then enable --now nginx."
