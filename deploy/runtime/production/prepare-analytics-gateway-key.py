"""Prepare an owner-only Nginx key fragment from the API's existing private key."""

import argparse
import os
from pathlib import Path
import re
import stat
import tempfile


def prepare(source, output):
    directory = output.parent.stat()
    if (output.name != 'gateway-key.conf' or output.parent.resolve() != output.parent
            or not stat.S_ISDIR(directory.st_mode) or directory.st_uid != os.getuid()
            or directory.st_mode & 0o077):
        raise ValueError('Expected an owner-only gateway directory')
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
            raise ValueError('Expected an owner-only API key file')
        key = handle.read(67)
        if not re.fullmatch(rb'[a-f0-9]{64}(?:\r?\n)?', key):
            raise ValueError('Expected a 64-character lowercase hexadecimal key')

    with tempfile.NamedTemporaryFile(dir=output.parent, prefix='.analytics-key-', delete=False) as handle:
        temporary = Path(handle.name)
        try:
            handle.write(b'cars.hongdingauto.com '+key.rstrip(b'\r\n')+b';\n')
            handle.flush()
            os.fsync(handle.fileno())
            os.link(temporary, output)
        finally:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    try:
        prepare(args.source, args.output)
    except (OSError, ValueError):
        parser.exit(1, 'Could not prepare the private analytics gateway map.\n')


if __name__ == '__main__':
    main()
