"""
Password hashing must actually work with the installed bcrypt.

Regression guard: passlib 1.7.4 (unmaintained) is incompatible with bcrypt >= 4.1 — it
raised "password cannot be longer than 72 bytes" for *any* password, which silently made
user creation and login impossible. These tests fail loudly if that ever returns.
"""
from __future__ import annotations

from homunculus.auth.service import hash_password, verify_password


def test_hashes_and_verifies_a_normal_password():
    hashed = hash_password("Str0ng-Pass-123")
    assert hashed != "Str0ng-Pass-123"          # never stored in plaintext
    assert hashed.startswith("$2")              # bcrypt hash format
    assert verify_password("Str0ng-Pass-123", hashed) is True
    assert verify_password("wrong", hashed) is False


def test_same_password_hashes_differently_each_time():
    """Distinct salts — two users with the same password must not share a hash."""
    assert hash_password("aynisifre") != hash_password("aynisifre")


def test_handles_unicode_password():
    hashed = hash_password("şifreÇĞİÖŞÜ")
    assert verify_password("şifreÇĞİÖŞÜ", hashed) is True


def test_handles_password_longer_than_the_bcrypt_72_byte_limit():
    """bcrypt caps at 72 bytes; long passwords must hash instead of raising."""
    long_password = "x" * 200
    hashed = hash_password(long_password)
    assert verify_password(long_password, hashed) is True


def test_verify_returns_false_for_a_malformed_stored_hash():
    """A corrupt hash must fail the login, not crash the endpoint."""
    assert verify_password("anything", "not-a-bcrypt-hash") is False
