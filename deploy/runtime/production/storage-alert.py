"""Persistent local storage alerts; the formal worker independently enforces 70%."""
import argparse
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import syslog
import time

ROOT = Path('/srv/hd-auto')


def classify(total, available):
    if any(isinstance(n, bool) or not isinstance(n, int) for n in (total, available)) or total <= 0 or not 0 <= available <= total:
        raise ValueError('Invalid filesystem measurement')
    used = total - available
    level = 'paused' if 100*used >= 70*total else 'warning' if 100*used >= 60*total else 'ok'
    return {'level': level, 'usedRatio': used/total, 'totalBytes': total, 'availableBytes': available,
            'warning': level != 'ok', 'pauseHeavyWork': level == 'paused'}


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    args = parser.parse_args()
    s = args.config.lstat()
    if os.getuid() != 0 or not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or stat.S_IMODE(s.st_mode) & 0o077:
        raise ValueError('Private root-owned configuration required')
    expected = json.loads(args.config.read_text())['filesystemUuid']
    if not re.fullmatch(r'[a-f0-9-]{36}', expected):
        raise ValueError('Explicit data filesystem UUID required')
    actual = subprocess.check_output(['findmnt', '--mountpoint', str(ROOT/'data'), '-n', '-o', 'UUID'], text=True, timeout=10).strip()
    if actual != expected:
        raise ValueError('Data filesystem identity mismatch')
    fs = os.statvfs(ROOT/'data')
    value = classify(fs.f_blocks*fs.f_frsize, fs.f_bavail*fs.f_frsize)
    value.update(event='hd_auto.storage', asOf=time.time(), includesReservedSpace=True)
    path = ROOT/'staging/ext07/storage-alert.json'
    previous = json.loads(path.read_text()) if path.exists() else {}
    due = previous.get('level') != value['level'] or value['warning'] and value['asOf']-previous.get('lastLoggedAt', 0) >= 86400
    if due:
        priority = syslog.LOG_ERR if value['level'] == 'paused' else syslog.LOG_WARNING if value['warning'] else syslog.LOG_INFO
        syslog.syslog(priority, json.dumps(value))
        value['lastLoggedAt'] = value['asOf']
    else:
        value['lastLoggedAt'] = previous.get('lastLoggedAt', value['asOf'])
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, indent=2)+'\n');temp.chmod(0o600);temp.replace(path)
    print(json.dumps(value))


if __name__ == '__main__':
    syslog.openlog('hd-auto-ext07-storage', syslog.LOG_PID, syslog.LOG_DAEMON)
    try:
        main()
    except Exception as error:
        message = json.dumps({'event': 'hd_auto.storage', 'level': 'error', 'errorType': type(error).__name__})
        syslog.syslog(syslog.LOG_ERR, message)
        print(message)
        raise SystemExit(1)
