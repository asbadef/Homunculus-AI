"""A malformed PHI key fails at boot, by name, without echoing the key."""
import pytest

from homunculus import crypto


def test_a_malformed_key_is_refused_at_validation_without_being_echoed(monkeypatch):
    monkeypatch.setenv("PHI_ENCRYPTION_KEY", "definitely-not-base64!")
    monkeypatch.setattr(crypto, "_fernet", None)
    with pytest.raises(ValueError) as caught:
        crypto.validate_key()
    assert "PHI_ENCRYPTION_KEY" in str(caught.value)
    assert "definitely-not" not in str(caught.value)


def test_a_well_formed_key_validates_and_round_trips(monkeypatch):
    from cryptography.fernet import Fernet

    monkeypatch.setenv("PHI_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(crypto, "_fernet", None)
    crypto.validate_key()
    assert crypto.decrypt_phi(crypto.encrypt_phi("x")) == "x"
