"""Pydantic request/response schemas for auth endpoints."""
from __future__ import annotations
import uuid
from datetime import datetime

from pydantic import BaseModel, Field, model_validator

# Upper bounds, so an oversized body is a 422 before any lookup or bcrypt work. 254 is the longest
# valid e-mail address; bcrypt reads only 72 bytes, 1024 is a generous cap for a passphrase.
_LOGIN_MAX = 254
_PASSWORD_MAX = 1024


class LoginRequest(BaseModel):
    login: str | None = Field(default=None, max_length=_LOGIN_MAX)   # username or e-mail
    # Legacy alias — the mobile client still sends `email`.
    email: str | None = Field(default=None, max_length=_LOGIN_MAX)
    password: str = Field(max_length=_PASSWORD_MAX)

    @model_validator(mode="after")
    def _needs_an_identifier(self):
        if not (self.login or self.email):
            raise ValueError("login is required")
        return self

    @property
    def identifier(self) -> str:
        return self.login or self.email or ""


class TOTPSetupResponse(BaseModel):
    provisioning_uri: str
    # NOTE: Never include secret in API response — use QR code only
    message: str = "Scan this URI with Google or Microsoft Authenticator"


class TOTPVerifyRequest(BaseModel):
    code: str  # 6-digit TOTP code


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str
    requires_mfa: bool           # a TOTP step is still pending for this session
    mfa_enrolled: bool = False   # the user already has a verified authenticator


class RefreshRequest(BaseModel):
    refresh_token: str


class GroupBrief(BaseModel):
    slug: str
    name: str


class UserMeResponse(BaseModel):
    id: uuid.UUID
    username: str
    email: str | None
    full_name: str
    auth_source: str
    totp_enabled: bool
    is_active: bool
    created_at: datetime
    tenant: str | None
    groups: list[GroupBrief]
    perms: list[str]


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(max_length=_PASSWORD_MAX)
    new_password: str = Field(max_length=_PASSWORD_MAX)
