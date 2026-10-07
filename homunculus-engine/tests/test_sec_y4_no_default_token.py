"""Y4 — eski pano API'sinde herkesin bildiği varsayılan token (demo-token / dev-token) yok;
token değişkeni tanımlı değilse sunucu açılmaz."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from homunculus.api.app import create_app

SRC = str(Path(__file__).resolve().parents[1] / "src")


def _import_devserver(**env: str) -> subprocess.CompletedProcess:
    clean = {k: v for k, v in os.environ.items() if k not in ("HOMUNCULUS_API_TOKEN", "HOMUNCULUS_HOSPITAL")}
    clean.update(env)
    clean["PYTHONPATH"] = SRC
    clean["HOMUNCULUS_AUDIT_DB"] = ":memory:"
    return subprocess.run([sys.executable, "-c", "import homunculus.api.devserver"],
                          env=clean, capture_output=True, text=True)


def test_devserver_refuses_to_start_without_token_variable():
    r = _import_devserver()
    assert r.returncode != 0
    assert "HOMUNCULUS_API_TOKEN" in r.stderr


@pytest.mark.parametrize("weak", ["demo-token", "dev-token", "changeme", "  ", "tok"])
def test_devserver_refuses_known_or_trivial_tokens(weak):
    r = _import_devserver(HOMUNCULUS_API_TOKEN=weak)
    assert r.returncode != 0


def test_devserver_starts_with_a_real_token():
    r = _import_devserver(HOMUNCULUS_API_TOKEN="sentetik-gelistirme-anahtari-0123456789")
    assert r.returncode == 0, r.stderr


@pytest.mark.parametrize("tenants", [{}, {"demo-token": "HOSP1"}, {"dev-token": "HOSP1"}, {"": "HOSP1"}])
def test_create_app_rejects_empty_and_default_tokens(tenants):
    with pytest.raises(RuntimeError):
        create_app(tenants, run_escalation_loop=False)


def test_create_app_still_accepts_a_real_token():
    create_app({"sentetik-test-anahtari-0123456789": "HOSP1"}, run_escalation_loop=False)
