"""O5 — parola ve JWT: bakımsız passlib/python-jose yerine bcrypt ve PyJWT; davranış korunur."""
from __future__ import annotations

import importlib
import sys
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt as pyjwt
import pytest

from homunculus.auth import jwt as hjwt
from homunculus.auth.service import hash_password, verify_password


def test_passlib_and_jose_are_not_imported():
    importlib.import_module("homunculus.auth.service")
    importlib.import_module("homunculus.auth.dependencies")
    assert "passlib" not in sys.modules
    assert "jose" not in sys.modules


def test_hash_roundtrip_and_wrong_password():
    h = hash_password("Sentetik-Parola-1!")
    assert h.startswith("$2b$")
    assert verify_password("Sentetik-Parola-1!", h)
    assert not verify_password("baska-parola", h)


def test_existing_bcrypt_hashes_still_verify():
    # passlib'in ürettiği biçimle aynı: standart $2b$ bcrypt özeti
    legacy = bcrypt.hashpw(b"Eski-Parola-9", bcrypt.gensalt(rounds=4)).decode()
    assert verify_password("Eski-Parola-9", legacy)


def test_password_longer_than_72_bytes_does_not_crash():
    long_pw = "a" * 100
    h = hash_password(long_pw)
    assert verify_password(long_pw, h)
    assert not verify_password("b" * 100, h)


def test_malformed_hash_is_a_failed_login_not_an_exception():
    assert verify_password("x", "bcrypt-degil") is False


def test_jwt_roundtrip_and_claims():
    tok = hjwt.create_access_token("kullanici-1", {"mfa_verified": True})
    claims = hjwt.decode_token(tok)
    assert claims["sub"] == "kullanici-1" and claims["type"] == "access" and claims["mfa_verified"] is True


def test_expired_token_is_rejected():
    past = datetime.now(timezone.utc) - timedelta(minutes=5)
    tok = pyjwt.encode({"sub": "x", "exp": past}, hjwt.JWT_SECRET, algorithm="HS256")
    with pytest.raises(hjwt.JWTError):
        hjwt.decode_token(tok)


def test_wrong_signature_and_alg_none_are_rejected():
    forged = pyjwt.encode({"sub": "x", "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
                          "baska-bir-gizli-anahtar-en-az-32-karakter!!", algorithm="HS256")
    with pytest.raises(hjwt.JWTError):
        hjwt.decode_token(forged)
    unsigned = pyjwt.encode({"sub": "x"}, None, algorithm="none")
    with pytest.raises(hjwt.JWTError):
        hjwt.decode_token(unsigned)
