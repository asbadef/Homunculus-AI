"""Create an allowlisted source-only pilot ZIP; no captures, environment files or keys."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile


def build(output):
    root = Path(__file__).resolve().parents[2]
    edge = root / "homunculus-engine/src/homunculus/edge"
    files = {
        "enable_continuous_research.py": (root / "deploy/infinity/enable_continuous_research.py").read_bytes(),
        "prepare_pilot_runtime.py": (root / "deploy/infinity/prepare_pilot_runtime.py").read_bytes(),
        "inventory.json": (root / "deploy/infinity/inventory.worker-28.json").read_bytes(),
        "app/src/homunculus/__init__.py": b'"""Isolated Infinity research package."""\n',
        "app/src/homunculus/edge/__init__.py": b"",
        "app/run_infinity_transport.py": (root / "homunculus-engine/scripts/run_infinity_transport.py").read_bytes(),
        # Versions present in the locally exercised transport environment.
        # Transitive dependencies are resolved by pip on the Ubuntu target.
        "requirements.txt": b"fastapi==0.139.2\nuvicorn==0.51.0\ncryptography==50.0.0\n",
        "README.txt": b"Source-only research transport pilot. No patient data or credentials.\n"
                       b"Preparation does not install/start services or change firewall/network settings.\n"
                       b"On each Ubuntu target: sudo python3 prepare_pilot_runtime.py worker|hub\n"
                       b"Full payload forwarding and clinical ingest remain disabled.\n",
    }
    for module in ("infinity_stream", "infinity_journal", "infinity_collector", "infinity_hub",
                   "infinity_decoder", "infinity_live"):
        files[f"app/src/homunculus/edge/{module}.py"] = (edge / f"{module}.py").read_bytes()
    manifest = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    files["manifest.json"] = json.dumps(manifest, indent=2).encode() + b"\n"
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return hashlib.sha256(output.read_bytes()).hexdigest()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps({"bundle": str(args.output.resolve()), "sha256": build(args.output)}))
