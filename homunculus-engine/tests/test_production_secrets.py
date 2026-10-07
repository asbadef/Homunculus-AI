"""Production must refuse to start with the built-in development secrets."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

SRC = str(Path(__file__).resolve().parents[1] / "src")


def _import(module: str, **env: str) -> subprocess.CompletedProcess:
    clean = {k: v for k, v in os.environ.items()
             if k not in ("ENVIRONMENT", "JWT_SECRET", "PHI_ENCRYPTION_KEY")}
    clean.update(env)
    clean["PYTHONPATH"] = SRC
    return subprocess.run([sys.executable, "-c", f"import {module}"],
                          env=clean, capture_output=True, text=True)


def test_jwt_refuses_default_secret_in_production():
    r = _import("homunculus.auth.jwt", ENVIRONMENT="production")
    assert r.returncode != 0
    assert "JWT_SECRET must be set" in r.stderr


def test_crypto_refuses_dev_key_in_production():
    r = _import("homunculus.crypto", ENVIRONMENT="production", JWT_SECRET="x" * 32)
    assert r.returncode != 0
    assert "PHI_ENCRYPTION_KEY must be set" in r.stderr


def test_production_starts_with_real_secrets():
    r = _import("homunculus.crypto, homunculus.auth.jwt", ENVIRONMENT="production",
                JWT_SECRET="x" * 32, PHI_ENCRYPTION_KEY="A" * 43 + "=")
    assert r.returncode == 0, r.stderr


def test_jwt_refuses_to_start_without_secret_in_any_environment():
    for env in ("development", "production", ""):
        r = _import("homunculus.auth.jwt", **({"ENVIRONMENT": env} if env else {}))
        assert r.returncode != 0, env
        assert "JWT_SECRET" in r.stderr


def test_jwt_refuses_known_placeholder_secret():
    r = _import("homunculus.auth.jwt", JWT_SECRET="CHANGE_ME_IN_PRODUCTION_USE_32_CHARS_MIN")
    assert r.returncode != 0
    assert "JWT_SECRET" in r.stderr


def test_jwt_refuses_short_secret():
    r = _import("homunculus.auth.jwt", JWT_SECRET="kisa-sir")
    assert r.returncode != 0
    assert "JWT_SECRET" in r.stderr


def test_development_works_with_a_proper_secret():
    r = _import("homunculus.crypto, homunculus.auth.jwt", ENVIRONMENT="development",
                JWT_SECRET="sentetik-test-sirri-" + "0123456789abcdef")
    assert r.returncode == 0, r.stderr
