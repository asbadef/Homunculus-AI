"""encrypt users.totp_secret at rest

O3: the column is now `EncryptedString`. Widens it (Fernet ciphertext is longer than a Base32 secret)
and encrypts the plaintext values already stored. Idempotent: already-encrypted values are skipped.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-07

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from homunculus.crypto import ENC_PREFIX, encrypt_phi

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("users", "totp_secret", existing_type=sa.String(64), type_=sa.String(512),
                    existing_nullable=True)
    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT id, totp_secret FROM users WHERE totp_secret IS NOT NULL")).fetchall()
    for user_id, secret in rows:
        if secret.startswith(ENC_PREFIX):
            continue
        bind.execute(sa.text("UPDATE users SET totp_secret = :s WHERE id = :i"),
                     {"s": encrypt_phi(secret), "i": user_id})


def downgrade() -> None:
    # Ciphertext cannot be narrowed back safely; decrypt first, then shrink.
    from homunculus.crypto import decrypt_phi
    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT id, totp_secret FROM users WHERE totp_secret IS NOT NULL")).fetchall()
    for user_id, secret in rows:
        bind.execute(sa.text("UPDATE users SET totp_secret = :s WHERE id = :i"),
                     {"s": decrypt_phi(secret), "i": user_id})
    op.alter_column("users", "totp_secret", existing_type=sa.String(512), type_=sa.String(64),
                    existing_nullable=True)
