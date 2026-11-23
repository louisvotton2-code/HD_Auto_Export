"""Advance the shared BROWSE-600 control file on the deployment host."""
import argparse
import fcntl
import os
from pathlib import Path
import re
import secrets
import stat
import tempfile


ACTIVE = re.compile(r'[a-f0-9]{32}')
HELD = re.compile(r'hold-[a-f0-9]{32}')


def read_state(path):
    try:
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o022:
                raise ValueError('Unsafe generation file')
            raw = handle.read(39)
    except FileNotFoundError:
        return None
    value = raw.decode('ascii').removesuffix('\n')
    if raw != (value + '\n').encode('ascii') or not (ACTIVE.fullmatch(value) or HELD.fullmatch(value)):
        raise ValueError('Invalid generation file')
    return value


def change(root, operation, expected=None):
    if not root.is_absolute() or root == Path('/') or '..' in root.parts:
        raise ValueError('Use the absolute shared generation directory')
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o022:
        raise ValueError('Use a generation directory controlled solely by the operator')

    fd = os.open(root / '.writer.lock', os.O_NOFOLLOW | os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(fd, 'rb') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        path = root / 'generation'
        before = read_state(path)
        if operation == 'show':
            return before
        if operation == 'initialize' and before is None and expected is None:
            prefix = 'hold-'
        elif operation == 'hold' and before == expected and ACTIVE.fullmatch(before or ''):
            prefix = 'hold-'
        elif operation == 'enable' and before == expected and HELD.fullmatch(before or ''):
            prefix = ''
        else:
            raise ValueError('Generation changed or operation does not match its current state')
        after = prefix + secrets.token_hex(16)
        # Directory bind mounts see this replacement in both serving slots.
        with tempfile.NamedTemporaryFile(prefix='.generation-', dir=root, delete=False) as pending:
            temporary = Path(pending.name)
            try:
                pending.write((after + '\n').encode('ascii'))
                pending.flush()
                os.fchmod(pending.fileno(), 0o644)
                os.fsync(pending.fileno())
                temporary.replace(path)
                directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)
            finally:
                temporary.unlink(missing_ok=True)
        return after


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--expect')
    parser.add_argument('operation', choices=('show', 'initialize', 'hold', 'enable'))
    args = parser.parse_args()
    try:
        print(change(args.directory, args.operation, args.expect) or 'missing')
    except (OSError, ValueError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
