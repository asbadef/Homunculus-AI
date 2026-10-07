"""O6 — şifresiz eski değer sessiz kabul edilmez: uyarı düşer (değer yazılmaz); sıkı kipte hata verir."""
from __future__ import annotations

import logging

import pytest

from homunculus import crypto

SECRET = "SENTETIK-DUZ-DEGER-123"


def test_plaintext_value_is_returned_but_warned_without_leaking_it(caplog, monkeypatch):
    monkeypatch.delenv("PHI_REQUIRE_ENCRYPTED", raising=False)
    with caplog.at_level(logging.WARNING, logger="homunculus.crypto"):
        assert crypto.decrypt_phi(SECRET) == SECRET
    assert any("Unencrypted value" in r.getMessage() for r in caplog.records)
    assert SECRET not in caplog.text


def test_strict_mode_rejects_plaintext(monkeypatch):
    monkeypatch.setenv("PHI_REQUIRE_ENCRYPTED", "1")
    with pytest.raises(ValueError) as e:
        crypto.decrypt_phi(SECRET)
    assert SECRET not in str(e.value)


def test_production_is_strict_unless_explicitly_relaxed(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("PHI_REQUIRE_ENCRYPTED", raising=False)
    monkeypatch.delenv("PHI_ALLOW_PLAINTEXT_LEGACY", raising=False)
    with pytest.raises(ValueError):
        crypto.decrypt_phi(SECRET)
    monkeypatch.setenv("PHI_ALLOW_PLAINTEXT_LEGACY", "1")
    assert crypto.decrypt_phi(SECRET) == SECRET


def test_encrypted_value_and_none_unaffected(monkeypatch):
    monkeypatch.setenv("PHI_REQUIRE_ENCRYPTED", "1")
    assert crypto.decrypt_phi(None) is None
    assert crypto.decrypt_phi(crypto.encrypt_phi(SECRET)) == SECRET
