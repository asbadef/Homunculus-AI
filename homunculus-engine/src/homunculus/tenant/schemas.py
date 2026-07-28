"""Pydantic schemas for tenant hierarchy endpoints."""
from __future__ import annotations
import uuid
from datetime import datetime

from pydantic import BaseModel

from homunculus.tenant.models import BedState, UnitType


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
    name: str
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
    name: str
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
    name: str
    room_number: str | None = None
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
    label: str
    device_location_id: str | None = None


class BedResponse(BaseModel):
    id: uuid.UUID
    room_id: uuid.UUID
    label: str
    state: BedState
    state_updated_at: datetime
    device_location_id: str | None
    created_at: datetime
    model_config = {"from_attributes": True}


class BedStateTransitionRequest(BaseModel):
    new_state: BedState
    reason: str | None = None
