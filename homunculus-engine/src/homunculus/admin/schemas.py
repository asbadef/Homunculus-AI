"""Request/response shapes of the /admin API.

Values are validated AFTER normalising, since that is what is stored and what sign-in compares:
names are trimmed and may not end up empty; a username is `normalize_login`-ed (trimmed,
lower-cased, Turkish `İ` folded to `i`) and must then be 2-128 characters of `a-z 0-9 . _ @ -`;
an e-mail is normalised the same way and must have one `@` with text on both sides and no
whitespace or invisible characters. Upper bounds match the columns (so an oversized value is a
422, not a database error) and the auth schemas (1024 for a password: bcrypt reads only 72
bytes, the cap bounds the input)."""
from __future__ import annotations
import re
import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from homunculus.auth.service import normalize_login

_SLUG = re.compile(r"[a-z0-9_]{2,64}")
_USERNAME = re.compile(r"[a-z0-9._@-]{2,128}")
_EMAIL_MAX = 254
_PASSWORD_MAX = 1024
_DESCRIPTION_MAX = 500


def _name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("must not be blank")
    return value


def _username(value: str) -> str:
    key = normalize_login(value)
    if not _USERNAME.fullmatch(key):
        raise ValueError("username: 2-128 characters, a-z 0-9 . _ @ - only (after lower-casing)")
    return key


def _email(value: str) -> str:
    """The normalised address; '' stays '' (a PATCH clears the e-mail with it)."""
    key = normalize_login(value)
    if not key:
        return ""
    local, _, domain = key.partition("@")
    if (key.count("@") != 1 or not local or not domain or len(key) > _EMAIL_MAX
            or any(ch.isspace() or not ch.isprintable() for ch in key)):
        raise ValueError("e-mail: one '@' with text on both sides, no spaces")
    return key


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
    description: str | None = Field(default=None, max_length=_DESCRIPTION_MAX)
    mfa_required: bool = False
    permissions: list[str] = []

    @field_validator("slug")
    @classmethod
    def _slug_shape(cls, value: str) -> str:
        # fullmatch: `$` would also accept a trailing newline ("abc\n").
        if not _SLUG.fullmatch(value):
            raise ValueError("slug: 2-64 characters, lower-case letters, digits and _ only")
        return value

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str) -> str:
        return _name(value)


class GroupPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=_DESCRIPTION_MAX)
    mfa_required: bool | None = None
    permissions: list[str] | None = None

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str | None) -> str | None:
        return None if value is None else _name(value)


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

    @field_validator("username")
    @classmethod
    def _username_shape(cls, value: str) -> str:
        return _username(value)

    @field_validator("email")
    @classmethod
    def _email_shape(cls, value: str | None) -> str | None:
        return None if value is None else (_email(value) or None)

    @field_validator("full_name")
    @classmethod
    def _full_name_not_blank(cls, value: str) -> str:
        return _name(value)


class UserPatch(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    # None: leave the e-mail as it is. "": clear it.
    email: str | None = Field(default=None, max_length=_EMAIL_MAX)
    is_active: bool | None = None

    @field_validator("full_name")
    @classmethod
    def _full_name_not_blank(cls, value: str | None) -> str | None:
        return None if value is None else _name(value)

    @field_validator("email")
    @classmethod
    def _email_shape(cls, value: str | None) -> str | None:
        return None if value is None else _email(value)


class UserGroupsIn(BaseModel):
    group_ids: list[uuid.UUID]


class PasswordResetIn(BaseModel):
    password: str = Field(min_length=8, max_length=_PASSWORD_MAX)
