"""Pydantic request/response schemas for auth endpoints."""
from __future__ import annotations
import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


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
    requires_mfa: bool


class RefreshRequest(BaseModel):
    refresh_token: str


class UserMeResponse(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    totp_enabled: bool
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
