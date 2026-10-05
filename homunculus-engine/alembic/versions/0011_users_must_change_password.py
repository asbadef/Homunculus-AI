# homunculus-engine/alembic/versions/0011_users_must_change_password.py
"""users.must_change_password: a temporary password is replaced at the next sign-in

Revision 0011, follows 0010 (kept separate although 0010 is unreleased: 0010 is the RBAC
conversion and is reviewed as one piece).

One boolean column, NOT NULL, server default false. `POST /admin/users` and
`POST /admin/users/{id}/reset-password` set it on the LOCAL account they give a temporary
password; the user's own `POST /auth/password` clears it. While it is set, a local account's
session reaches only /auth/password, /auth/me, /auth/refresh and /auth/totp/* (403
`password_change_required` elsewhere: auth/dependencies.py and the board's resolver in
api/prodserver.py). An AD account's password lives in AD and is never flagged.

The upgrade flags EVERY local account that already exists (the user's decision, plan G1 Wave 2):
before 0011 nothing recorded whether a local password was a temporary one an administrator
typed — the seed administrator's included — so each such account chooses its own password once,
at its first sign-in after the deploy. AD accounts are left alone.

Downgrade drops the column: the flags are lost and those accounts keep working with the
password they have.

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-04
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("must_change_password", sa.Boolean(), nullable=False,
                                     server_default=sa.false()))
    # Every local account chooses its own password once; 'local' is auth.models.AUTH_LOCAL
    # (written out: a migration does not import the model it may outlive).
    op.execute("UPDATE users SET must_change_password = true WHERE auth_source = 'local'")


def downgrade() -> None:
    op.drop_column("users", "must_change_password")
