"""Pydantic schemas for tenant hierarchy endpoints."""
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

from homunculus.tenant.models import BedState, UnitType

# G2-B1a (amendment A-13): a new site's, unit's, room's or bed's name is trimmed, never blank, and
# never longer than its column (a longer one was a 500 from the database).
_Name200 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
_Name100 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
_Label50 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
# A room number is trimmed and measured the same way; a blank one is "no number" (None).
_Number20 = Annotated[str, StringConstraints(strip_whitespace=True, max_length=20)]
# A PATCH's new name (amendment A-26, m-1): trimmed, then measured against its column. No
# minimum here: an empty name, typed or all blanks, reaches the route, which answers the coded
# `field_invalid:<name>` — the same refusal either way.
_Rename200 = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
_Rename100 = Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)]
_Relabel50 = Annotated[str, StringConstraints(strip_whitespace=True, max_length=50)]


class TenantCreate(BaseModel):
    name: str
    slug: str
    country_code: str
    timezone: str = "UTC"


class TenantResponse(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    country_code: str
    timezone: str
    is_active: bool
    created_at: datetime
    model_config = {"from_attributes": True}


class SiteCreate(BaseModel):
    name: _Name200
    address: str | None = None


class SiteResponse(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    address: str | None
    is_active: bool
    created_at: datetime
    model_config = {"from_attributes": True}


class UnitCreate(BaseModel):
    name: _Name200
    unit_type: UnitType
    max_beds_per_nurse: int = 2


class UnitResponse(BaseModel):
    id: uuid.UUID
    site_id: uuid.UUID
    name: str
    unit_type: UnitType
    max_beds_per_nurse: int
    is_active: bool
    created_at: datetime
    model_config = {"from_attributes": True}


class RoomCreate(BaseModel):
    name: _Name100
    room_number: _Number20 | None = None
    is_isolation: bool = False


class RoomResponse(BaseModel):
    id: uuid.UUID
    unit_id: uuid.UUID
    name: str
    room_number: str | None
    is_isolation: bool
    is_active: bool
    model_config = {"from_attributes": True}


class BedCreate(BaseModel):
    label: _Label50
    device_location_id: str | None = Field(default=None, max_length=100)


class BedResponse(BaseModel):
    id: uuid.UUID
    room_id: uuid.UUID
    label: str
    state: BedState
    state_updated_at: datetime
    device_location_id: str | None
    created_at: datetime
    is_active: bool = True          # G2-B1a
    model_config = {"from_attributes": True}


class BedStateTransitionRequest(BaseModel):
    new_state: BedState
    reason: str | None = None


# ---------------------------------------------------------------- G2-B1a (Hasta Kabul)
class UnitPatch(BaseModel):
    """Rename, close (`is_active: false`) or reopen a unit. Nothing is ever deleted."""
    name: _Rename200 | None = None
    is_active: bool | None = None


class RoomPatch(BaseModel):
    name: _Rename100 | None = None
    room_number: _Number20 | None = None
    is_active: bool | None = None


class BedPatch(BaseModel):
    label: _Relabel50 | None = None
    is_active: bool | None = None


class StructureBed(BaseModel):
    id: uuid.UUID
    label: str
    state: BedState
    is_active: bool


class StructureRoom(BaseModel):
    id: uuid.UUID
    name: str
    room_number: str | None
    is_isolation: bool
    is_active: bool
    beds: list[StructureBed]


class StructureUnit(BaseModel):
    id: uuid.UUID
    name: str
    unit_type: UnitType
    is_active: bool
    rooms: list[StructureRoom]


class StructureSite(BaseModel):
    id: uuid.UUID
    name: str
    is_active: bool
    units: list[StructureUnit]


class StructureResponse(BaseModel):
    """GET /tenant/structure: the tree every screen resolves a unit's and a bed's NAME from — no
    screen ever shows a UUID (spec D9). `tenant_id` is the parent a new site is created under."""
    tenant_id: uuid.UUID
    sites: list[StructureSite]
