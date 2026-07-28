"""
TOTP utilities using pyotp.
S-21: TOTP is mandatory for HOSPITAL_ADMIN, ATTENDING, UNIT_PHYSICIAN, PLATFORM_SUPPORT.
"""
from __future__ import annotations
import pyotp


def generate_totp_secret() -> str:
    """Generate a new Base32 TOTP secret."""
    return pyotp.random_base32()


def generate_provisioning_uri(secret: str, email: str, issuer: str = "Homunculus") -> str:
    """Return the otpauth:// URI for QR code generation."""
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=email, issuer_name=issuer)


def verify_totp(secret: str, code: str) -> bool:
    """
    Verify a 6-digit TOTP code.
    valid_window=1 allows ±30 seconds clock drift.
    """
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)
