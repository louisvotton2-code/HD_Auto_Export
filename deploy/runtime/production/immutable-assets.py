"""Merge only reviewed Next static trees, refusing same-URL content changes."""
import argparse
import hashlib
from pathlib import Path
import shutil
import stat


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').digest()


def merge(source, destination):
    if source.resolve()!=source or not source.is_dir() or destination.is_symlink():
        raise ValueError('Canonical regular asset directories required')
    files=[]
    for path in source.rglob('*'):
        mode=path.lstat().st_mode
        if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
            raise ValueError('No asset links or special files')
        if path.is_file():files.append(path)
    # Validate all collisions before copying; hash URLs must be truly immutable.
    for path in files:
        target=destination/path.relative_to(source)
        if target.exists():
            if target.is_symlink() or not target.is_file() or digest(path)!=digest(target):
                raise ValueError('Existing immutable URL has different content')
    for path in files:
        target=destination/path.relative_to(source)
        target.parent.mkdir(parents=True,exist_ok=True,mode=0o755)
        if not target.exists():shutil.copyfile(path,target);target.chmod(0o644)
    return len(files)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('destination',type=Path);a=p.parse_args();print(merge(a.source,a.destination))
