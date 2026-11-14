"""Hastane yapısı (prototip taşıma Tur 1): every unit kind the hospital has, and the unit's profile.

Revision 0023, follows 0021 (the head after the 0020 → 0022 → 0021 chain).

1. `unittype` gains the non-ICU kinds the prototype's hospital has (ward, emergency, cath lab, chemo
   and day units, IVF, nursery, outpatient clinics). `unit_type` is stored and shown only — no rule of
   the engine reads it (grep: tenant/ only) — so a new kind changes no alarm, score or recommendation.
   ADD VALUE is allowed in a transaction on PostgreSQL ≥ 12; nothing here uses the new values.
2. `units` gains the prototype's unit profile, every column optional (an old unit keeps working):
   `floor` (0 = ground floor), `care_tier` (FULL «Tam izlem» · VITAL «Vital izlem» · OPERATIONAL
   «Operasyonel»), `score_rule` (the unit's own words: «SOFA + NEWS2», «PEWS»…), `code` (the hospital's
   unit code) and `age_group` (ADULT · CHILD · NEONATE). `care_tier` and `score_rule` are LABELS on the
   board today: they do not switch the engine's rules on or off.

Downgrade drops the columns; PostgreSQL cannot drop an enum value, so the kinds stay (unused).
ONE STATEMENT PER op.execute (asyncpg).

Revision ID: 0023
Revises: 0021
Create Date: 2026-11-14
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0023"
down_revision: Union[str, None] = "0021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: tenant/models.py UnitType, the values after BMT_ICU (the test holds the two to each other).
NEW_KINDS = ("WARD", "ER", "CATH_LAB", "CHEMO_DAY", "DAY_CARE", "IVF_DAY", "NURSERY", "CLINIC")
TIERS = ("FULL", "VITAL", "OPERATIONAL")
AGE_GROUPS = ("ADULT", "CHILD", "NEONATE")


def _in(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in values)


def upgrade() -> None:
    for kind in NEW_KINDS:
        op.execute(f"ALTER TYPE unittype ADD VALUE IF NOT EXISTS '{kind}'")
    op.add_column("units", sa.Column("floor", sa.SmallInteger(), nullable=True))
    op.add_column("units", sa.Column("care_tier", sa.String(12), nullable=True))
    op.add_column("units", sa.Column("score_rule", sa.String(40), nullable=True))
    op.add_column("units", sa.Column("code", sa.String(20), nullable=True))
    op.add_column("units", sa.Column("age_group", sa.String(8), nullable=True))
    op.create_check_constraint("ck_units_care_tier", "units", f"care_tier IS NULL OR care_tier IN ({_in(TIERS)})")
    op.create_check_constraint("ck_units_age_group", "units", f"age_group IS NULL OR age_group IN ({_in(AGE_GROUPS)})")
    op.create_check_constraint("ck_units_floor", "units", "floor IS NULL OR floor BETWEEN -5 AND 99")


def downgrade() -> None:
    op.drop_constraint("ck_units_floor", "units", type_="check")
    op.drop_constraint("ck_units_age_group", "units", type_="check")
    op.drop_constraint("ck_units_care_tier", "units", type_="check")
    for column in ("age_group", "code", "score_rule", "care_tier", "floor"):
        op.drop_column("units", column)
