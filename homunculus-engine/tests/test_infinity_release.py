"""The release a VM runs is a commit's code and nothing else. No credentials, no captures."""
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("build_transport_release",
                                              ROOT / "deploy/infinity/build_transport_release.py")
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)

FILES = {
    "app/run_infinity_transport.py", "app/src/homunculus/__init__.py",
    "app/src/homunculus/edge/__init__.py", "app/src/homunculus/edge/infinity_stream.py",
    "app/src/homunculus/edge/infinity_journal.py", "app/src/homunculus/edge/infinity_collector.py",
    "app/src/homunculus/edge/infinity_hub.py", "app/src/homunculus/edge/infinity_live.py",
    "app/src/homunculus/edge/infinity_records.py", "app/src/homunculus/edge/infinity_timing.py",
}


def git(*args):
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, check=True).stdout


def test_a_release_is_exactly_the_transport_code_of_a_commit(tmp_path):
    name, tarball = release.build(tmp_path)
    with tarfile.open(tarball) as archive:
        members = {m.name: m for m in archive.getmembers() if m.isfile()}
        assert set(members) == {f"{name}/{path}" for path in FILES | {"SHA256SUMS", "RELEASE.json"}}
        for path in FILES:
            data = archive.extractfile(members[f"{name}/{path}"]).read()
            source = release.SOURCES.get(path)
            if source:
                # The bytes git holds, not the working copy's: Windows checks out CRLF.
                assert data == git("show", "HEAD:" + source), path
        sums = archive.extractfile(members[f"{name}/SHA256SUMS"]).read().decode()
    assert sorted(line.split("  ", 1)[1] for line in sums.splitlines()) == sorted(FILES)
    assert name.startswith("transport-") and len(name) == len("transport-") + 16


def test_the_same_commit_gives_the_same_bytes_and_name(tmp_path):
    first = release.build(tmp_path / "a")
    second = release.build(tmp_path / "b")
    assert first[0] == second[0]
    assert first[1].read_bytes() == second[1].read_bytes()


def test_a_release_runs_on_its_own(tmp_path):
    name, tarball = release.build(tmp_path)
    with tarfile.open(tarball) as archive:
        archive.extractall(tmp_path / "x", filter="data")
    app = tmp_path / "x" / name / "app"
    environment = dict(os.environ, PYTHONPATH=str(app / "src"), PYTHONDONTWRITEBYTECODE="1")
    result = subprocess.run([sys.executable, "-I", "-c",
                             "import sys; sys.path.insert(0, sys.argv[1]); "
                             "import homunculus.edge.infinity_timing, homunculus.edge.infinity_hub, "
                             "homunculus.edge.infinity_collector, homunculus.edge.infinity_live",
                             str(app / "src")], capture_output=True, text=True, env=environment)
    assert result.returncode == 0, result.stderr
    result = subprocess.run([sys.executable, str(app / "run_infinity_transport.py"), "--help"],
                            capture_output=True, text=True, env=environment)
    assert result.returncode == 0 and "collector" in result.stdout, result.stderr
