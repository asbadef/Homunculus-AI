"""Request/response shapes of the /admin API.

Upper bounds match the columns (so an oversized value is a 422, not a database error) and the
auth schemas (1024 for a password: bcrypt reads only 72 bytes, the cap bounds the input)."""
from __future__ import annotations
import re
import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

_SLUG = re.compile(r"^[a-z0-9_]{2,64}$")
_EMAIL_MAX = 254
_PASSWORD_MAX = 1024


class PermissionOut(BaseModel):
    key: str
    description: str


class GroupOut(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    description: str | None
    mfa_required: bool
    is_system: bool
    permissions: list[str]
    member_count: int


class GroupCreate(BaseModel):
    slug: str
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    mfa_required: bool = False
    permissions: list[str] = []

    @field_validator("slug")
    @classmethod
    def _slug_shape(cls, value: str) -> str:
        if not _SLUG.match(value):
            raise ValueError("slug: 2-64 characters, lower-case letters, digits and _ only")
        return value


class GroupPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    mfa_required: bool | None = None
    permissions: list[str] | None = None


class UserGroupOut(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    source: str


class UserOut(BaseModel):
    id: uuid.UUID
    username: str
    email: str | None
    full_name: str
    auth_source: str
    is_active: bool
    totp_enabled: bool
    last_login_at: datetime | None
    groups: list[UserGroupOut]


class UserCreate(BaseModel):
    username: str = Field(min_length=2, max_length=128)
    email: str | None = Field(default=None, max_length=_EMAIL_MAX)
    full_name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=8, max_length=_PASSWORD_MAX)
    group_ids: list[uuid.UUID] = []


class UserPatch(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    email: str | None = Field(default=None, max_length=_EMAIL_MAX)
    is_active: bool | None = None


class UserGroupsIn(BaseModel):
    group_ids: list[uuid.UUID]


class PasswordResetIn(BaseModel):
    password: str = Field(min_length=8, max_length=_PASSWORD_MAX)
