"""
Column-level PHI encryption (at-rest) via Fernet.

Design doc §5.2 PHI rule: fields marked PHI are stored encrypted at rest, never
written to logs, never appear in error messages, and never enter the repository.

Key resolution order:
  1. PHI_ENCRYPTION_KEY env var (urlsafe base64, 32-byte Fernet key) — production.
  2. Deterministic dev key derived from JWT_SECRET — DEVELOPMENT ONLY.

The dev fallback keeps local/test environments running without extra setup, but a
real key MUST be provided in production (a warning is emitted otherwise).
"""
from __future__ import annotations

import base64
import hashlib
import logging
import os

from cryptography.fernet import Fernet, InvalidToken

# SQLAlchemy is an API dependency, not a bridge one. The edge bridge's identity mirror uses
# encrypt_phi/decrypt_phi from this module and runs from an image that carries only the standard
# library plus `cryptography` — a hard import here would stop that container at startup, and with
# it every reading on the ward. The column type below is only defined when SQLAlchemy is present.
try:
    from sqlalchemy.types import String, TypeDecorator
except ImportError:                                    # bridge image
    String = TypeDecorator = None                      # type: ignore[assignment,misc]

logger = logging.getLogger(__name__)

_ENC_PREFIX = "enc::v1::"


def _resolve_key() -> bytes:
    key = os.getenv("PHI_ENCRYPTION_KEY")
    if key:
        return key.encode() if isinstance(key, str) else key
    # DEV-ONLY deterministic fallback. Never rely on this in production.
    seed = os.getenv("JWT_SECRET", "dev-insecure-seed-change-me").encode()
    derived = base64.urlsafe_b64encode(hashlib.sha256(seed).digest())
    logger.warning(
        "PHI_ENCRYPTION_KEY not set — using an insecure development key derived "
        "from JWT_SECRET. Set PHI_ENCRYPTION_KEY before handling real data."
    )
    return derived


_fernet: Fernet | None = None


def _fernet_instance() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_resolve_key())
    return _fernet


def encrypt_phi(plaintext: str | None) -> str | None:
    """Encrypt a plaintext PHI string. Returns None for None input."""
    if plaintext is None:
        return None
    token = _fernet_instance().encrypt(plaintext.encode("utf-8")).decode("ascii")
    return _ENC_PREFIX + token


def decrypt_phi(ciphertext: str | None) -> str | None:
    """Decrypt a stored PHI string. Returns None for None input."""
    if ciphertext is None:
        return None
    if not ciphertext.startswith(_ENC_PREFIX):
        # Legacy/plaintext value (e.g. imported before encryption enabled).
        return ciphertext
    token = ciphertext[len(_ENC_PREFIX):]
    try:
        return _fernet_instance().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken:
        # Never leak the ciphertext or key material in the error.
        raise ValueError("PHI decryption failed — key mismatch or corrupted value.")


if TypeDecorator is not None:

    class EncryptedString(TypeDecorator):
        """
        SQLAlchemy column type that transparently encrypts PHI at rest.

        Store/return Python `str`; the database sees only Fernet ciphertext.
        """

        impl = String
        cache_ok = True

        def process_bind_param(self, value, dialect):  # type: ignore[override]
            return encrypt_phi(value)

        def process_result_value(self, value, dialect):  # type: ignore[override]
            return decrypt_phi(value)
