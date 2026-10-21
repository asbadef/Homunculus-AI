"""Pydantic schemas for the permission admin endpoints."""
from __future__ import annotations
import uuid

from pydantic import BaseModel, ConfigDict

from homunculus.auth.models import UserRole
from homunculus.permissions.models import PermissionEffect


class RoleGrantIn(BaseModel):
    role: UserRole
    action: str


class UserGrantIn(BaseModel):
    user_id: uuid.UUID
    action: str
    effect: PermissionEffect


class PermissionGrantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    action: str
    role: UserRole | None
    user_id: uuid.UUID | None
    effect: str
    is_active: bool
