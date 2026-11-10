"""Install only pinned official models; never download from the serving process."""

import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import pwd
import shutil
import sys
import urllib.request

ROOT = Path(__file__).resolve().parent
MANIFEST = json.loads((ROOT / "models.json").read_text())
LOCAL = Path.home() / ".local"
SENTENCES = Path.home() / ".cache" / "minisbd"
STAMP = LOCAL / "hd-auto-translation-models.json"


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def check_engine():
    for distribution, version in MANIFEST["engine"].items():
        actual = importlib.metadata.version(distribution)
        if actual != version:
            raise RuntimeError(f"Unexpected {distribution} {actual}; expected {version}")


def packages():
    from argostranslate import package

    return {
        (item.from_code, item.to_code): item
        for item in package.get_installed_packages()
    }


def expected_packages():
    return {(item["from"], item["to"]): item for item in MANIFEST["translationModels"]}


def check_packages():
    installed = packages()
    expected = expected_packages()
    if installed.keys() != expected.keys():
        raise RuntimeError(f"Expected only {list(expected)}; found {list(installed)}")
    for pair, item in installed.items():
        if item.package_version != expected[pair]["version"]:
            raise RuntimeError(f"Unexpected model version for {pair}")


def download(item, directory):
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / item["file"]
    if target.exists() and digest(target) == item["sha256"]:
        return target
    provided = os.environ.get("MODEL_DOWNLOAD_DIR")
    temporary = target.with_suffix(target.suffix + ".part")
    try:
        if provided:
            shutil.copyfile(Path(provided) / item["file"], temporary)
        else:
            print(f"Downloading {item['url']}", flush=True)
            with urllib.request.urlopen(item["url"], timeout=120) as response:
                with temporary.open("wb") as destination:
                    shutil.copyfileobj(response, destination)
        if digest(temporary) != item["sha256"]:
            raise RuntimeError(f"SHA-256 mismatch: {item['file']}")
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    return target


def install():
    # Docker creates a new .cache volume as root. Only the setup process starts
    # as root, fixes the two mount roots, and drops to the image's service user.
    if os.getuid() == 0:
        identity = pwd.getpwnam("libretranslate")
        for directory in (LOCAL, SENTENCES.parent):
            os.chown(directory, identity.pw_uid, identity.pw_gid)
        os.setgroups([])
        os.setgid(identity.pw_gid)
        os.setuid(identity.pw_uid)
    from argostranslate import package

    check_engine()
    installed = packages()
    expected = expected_packages()
    if installed.keys() - expected.keys():
        raise RuntimeError("This volume has unrelated models; use a dedicated empty volume")
    for item in MANIFEST["translationModels"]:
        archive = download(item, LOCAL / "cache" / "hd-auto-translation-downloads")
        pair = (item["from"], item["to"])
        if pair not in installed:
            package.install_from_path(archive)
    for item in MANIFEST["sentenceModels"]:
        download(item, SENTENCES)
    check_packages()
    STAMP.write_text(json.dumps(MANIFEST, ensure_ascii=False, indent=2) + "\n")
    verify()
    print("Pinned translation models installed and verified", flush=True)


def verify():
    check_engine()
    if json.loads(STAMP.read_text()) != MANIFEST:
        raise RuntimeError("Model manifest changed; run the setup step before starting")
    check_packages()
    for item in MANIFEST["translationModels"]:
        archive = LOCAL / "cache" / "hd-auto-translation-downloads" / item["file"]
        if digest(archive) != item["sha256"]:
            raise RuntimeError(f"Archive SHA-256 mismatch: {item['file']}")
    for item in MANIFEST["sentenceModels"]:
        if digest(SENTENCES / item["file"]) != item["sha256"]:
            raise RuntimeError(f"Sentence model SHA-256 mismatch: {item['file']}")


def health():
    with urllib.request.urlopen("http://127.0.0.1:5000/health", timeout=2) as response:
        if response.status != 200:
            raise RuntimeError("Health endpoint unavailable")
    with urllib.request.urlopen("http://127.0.0.1:5000/languages", timeout=2) as response:
        languages = json.load(response)
    zh = next((item for item in languages if item["code"] in ("zh", "zh-Hans")), None)
    if not zh or not {"en", "ru"}.issubset(zh["targets"]):
        raise RuntimeError("Required Chinese to English/Russian routes unavailable")


if __name__ == "__main__":
    commands = {"install": install, "verify": verify, "health": health}
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        raise SystemExit("Usage: bootstrap.py install|verify|health (inside the pinned image)")
    commands[sys.argv[1]]()
