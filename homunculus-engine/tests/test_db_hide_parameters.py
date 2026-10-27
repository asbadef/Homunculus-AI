"""Lane B's finding of 2026-10-27 (spec D12): a 500 on an INSERT must not log bound parameters —
clinical free text among them. Every engine the service creates hides them."""
from pathlib import Path
import re

SRC = Path(__file__).resolve().parents[1] / "src" / "homunculus"
FILES = ("db.py", "api/audit_postgres.py", "api/patient_identity_postgres.py", "api/monitor_samples.py")


def test_every_engine_creation_hides_parameters():
    for rel in FILES:
        text = (SRC / rel).read_text(encoding="utf-8")
        calls = re.findall(r"create(?:_async)?_engine\((?:[^()]|\([^()]*\))*\)", text, re.S)
        assert calls, rel
        for call in calls:
            assert "hide_parameters=True" in call, f"{rel}: {call[:80]}"
