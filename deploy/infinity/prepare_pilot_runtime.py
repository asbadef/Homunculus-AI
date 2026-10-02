"""Prepare an isolated pilot runtime on Ubuntu; never starts network services."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def verified_files(bundle):
    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or not 5 <= len(manifest) <= 30:
        raise ValueError("Unexpected bundle manifest")
    for name, digest in manifest.items():
        candidate = bundle / name
        if (not isinstance(name, str) or "\\" in name or Path(name).is_absolute()
                or ".." in Path(name).parts or candidate.is_symlink()
                or not candidate.resolve().is_relative_to(bundle.resolve())
                or hashlib.sha256(candidate.read_bytes()).hexdigest() != digest):
            raise ValueError("Bundle verification failed")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("role", choices=("worker", "hub"))
    args = parser.parse_args()
    if sys.platform != "linux" or os.geteuid() != 0:
        raise SystemExit("Run on the intended Ubuntu VM using sudo.")
    if sys.version_info < (3, 12):
        raise SystemExit("Python 3.12 or newer is required.")
    release = Path("/etc/os-release").read_text()
    if 'ID=ubuntu' not in release or 'VERSION_ID="24.04"' not in release:
        raise SystemExit("This preparation is scoped to Ubuntu 24.04.")
    bundle = Path(__file__).resolve().parent
    manifest = verified_files(bundle)
    expected_ip = "10.10.203.101" if args.role == "worker" else "172.100.101.72"
    addresses = json.loads(run("ip", "-j", "-4", "address", "show", capture_output=True, text=True).stdout)
    if not any(row.get("local") == expected_ip for nic in addresses for row in nic.get("addr_info", [])):
        raise SystemExit("Expected role IP is missing; refusing preparation on this host.")
    if args.role == "worker" and not any(
            row.get("local") == "172.100.101.74" for nic in addresses for row in nic.get("addr_info", [])):
        raise SystemExit("Worker management IP is missing.")
    port = 2050 if args.role == "worker" else 8766
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM if args.role == "worker" else socket.SOCK_STREAM) as probe:
        probe.bind(("0.0.0.0", port))
    target = Path("/opt/homunculus-infinity/pilot")
    # No overwrite/update/cleanup of an existing install, keys or databases.
    if target.exists() or target.is_symlink():
        raise SystemExit("Pilot directory already exists; inspect it before updating. Nothing overwritten.")
    run("apt-get", "update")
    run("apt-get", "install", "-y", "python3-venv", "ca-certificates")
    target.mkdir(parents=True, mode=0o755)
    for name in manifest:
        dest = target / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(bundle / name, dest)
        dest.chmod(0o644)
    shutil.copyfile(bundle / "manifest.json", target / "manifest.json")
    run(sys.executable, "-m", "venv", str(target / ".venv"))
    python = str(target / ".venv/bin/python")
    run(python, "-m", "pip", "install", "--disable-pip-version-check", "-r", str(target / "requirements.txt"))
    env = dict(os.environ, PYTHONPATH=str(target / "app/src"))
    run(python, str(target / "app/run_infinity_transport.py"), "--help", env=env, stdout=subprocess.DEVNULL)
    run(python, "-c", "from pathlib import Path; from homunculus.edge.infinity_stream import Inventory; "
        "v=Inventory.read(Path('inventory.json')); assert len(v.devices)==1; print('Inventory OK: one monitor.')",
        cwd=target, env=env)
    print(f"PREPARED: {args.role}; runtime={target}; services_started=0; clinical_forwarding=false")
    print("Next: provision TLS and protected credentials, then install/start the separate pilot services.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        print(f"Preparation stopped: {type(exc).__name__}. No services were started.", file=sys.stderr)
        raise SystemExit(2)
