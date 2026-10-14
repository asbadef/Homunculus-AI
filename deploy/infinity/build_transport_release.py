"""Build one immutable Infinity transport release from a commit: code and checksums only.

Both roles run the same release. It holds no inventory, key, token, certificate, capture or
profile. Files are read from git, not from the working copy, so the release is that commit's
code and nothing uncommitted (and LF, as git holds it, although Windows checks out CRLF).
It is named after its contents: the same commit always gives the same name and the same
tarball bytes, and any change gives a new name. On the VM, `sha256sum -c SHA256SUMS` checks
every file before a drop-in points at the directory.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
ENGINE = "homunculus-engine/"
EDGE = ("__init__", "infinity_stream", "infinity_journal", "infinity_collector", "infinity_hub",
        "infinity_live", "infinity_records", "infinity_timing")
SOURCES = {"app/run_infinity_transport.py": ENGINE + "scripts/run_infinity_transport.py",
           **{f"app/src/homunculus/edge/{name}.py": f"{ENGINE}src/homunculus/edge/{name}.py" for name in EDGE}}
# The package root is the release's own: the repo's would import the clinical engine.
PACKAGE = b'"""Isolated Infinity research package."""\n'


def _git(*args):
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, check=True).stdout


def build(output, commit="HEAD"):
    revision = _git("rev-parse", "--verify", commit + "^{commit}").decode().strip()
    stamp = int(_git("show", "-s", "--format=%ct", revision).decode())
    files = {path: _git("show", f"{revision}:{source}") for path, source in SOURCES.items()}
    files["app/src/homunculus/__init__.py"] = PACKAGE
    sums = "".join(f"{hashlib.sha256(data).hexdigest()}  {path}\n" for path, data in sorted(files.items()))
    name = "transport-" + hashlib.sha256(sums.encode()).hexdigest()[:16]
    files["SHA256SUMS"] = sums.encode()
    files["RELEASE.json"] = json.dumps({"name": name, "commit": revision}, indent=2).encode() + b"\n"
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    tarball = output / f"{name}.tar.gz"
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode="wb", mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
            for path in sorted(files):
                info = tarfile.TarInfo(f"{name}/{path}")
                info.size, info.mode, info.mtime = len(files[path]), 0o644, stamp
                info.uid = info.gid = 0
                info.uname = info.gname = "root"
                archive.addfile(info, io.BytesIO(files[path]))
    tarball.write_bytes(buffer.getvalue())
    return name, tarball


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="a folder outside the repository")
    parser.add_argument("--commit", default="HEAD")
    args = parser.parse_args()
    name, tarball = build(args.output, args.commit)
    print(json.dumps({"release": name, "tarball": str(tarball.resolve()),
                      "sha256": hashlib.sha256(tarball.read_bytes()).hexdigest()}))
