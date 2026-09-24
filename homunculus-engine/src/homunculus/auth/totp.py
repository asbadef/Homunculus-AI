"""
TOTP utilities using pyotp.
S-21: TOTP is mandatory for HOSPITAL_ADMIN, ATTENDING, UNIT_PHYSICIAN, PLATFORM_SUPPORT.
"""
from __future__ import annotations
import hmac
import time

import pyotp


def generate_totp_secret() -> str:
    """Generate a new Base32 TOTP secret."""
    return pyotp.random_base32()


def generate_provisioning_uri(secret: str, email: str, issuer: str = "Homunculus") -> str:
    """Return the otpauth:// URI for QR code generation."""
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=email, issuer_name=issuer)


def accepted_step(secret: str, code: str, *, now: float | None = None) -> int | None:
    """The 30-second time step whose code `code` is — among the previous, current and next step
    (±30 s clock drift) — or None. The caller refuses a step it has already accepted for this
    user, so a code that was seen once cannot be replayed. This is the ONLY code check: there is
    deliberately no boolean `verify` beside it, which could be called without the attempt limit
    and the replay refusal of /auth/totp/verify.

    The step is computed from the Unix time directly (`t // 30`) and its code generated for that
    step, rather than through `TOTP.at(t)`, which round-trips a naive local datetime and can land
    an hour off inside a daylight-saving change."""
    totp = pyotp.TOTP(secret)
    t = time.time() if now is None else now
    current = int(t // totp.interval)
    offered = str(code).encode()
    for step in (current - 1, current, current + 1):
        if hmac.compare_digest(totp.generate_otp(step).encode(), offered):
            return step
    return None
