"""Request/response shapes of the /admin API.

Values are validated AFTER normalising, since that is what is stored and what sign-in compares:
names are trimmed and may not end up empty; a username is `normalize_login`-ed (trimmed,
lower-cased, Turkish `İ` and `ı` folded to `i`) and must then be 2-128 characters of
`a-z 0-9 . _ @ -` (the refusal says how to transliterate ş ç ğ ö ü ı ə);
an e-mail is normalised the same way and must have one `@` with text on both sides and no
whitespace or invisible characters. Upper bounds match the columns (so an oversized value is a
422, not a database error) and the auth schemas (1024 for a password: bcrypt reads only 72
bytes, the cap bounds the input)."""
from __future__ import annotations
import re
import unicodedata
import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from homunculus.auth.ldap3_directory import canonical_dn
from homunculus.auth.service import normalize_login

_SLUG = re.compile(r"[a-z0-9_]{2,64}")
_USERNAME = re.compile(r"[a-z0-9._@-]{2,128}")
_EMAIL_MAX = 254
_PASSWORD_MAX = 1024
_DESCRIPTION_MAX = 500
_REASON_MAX = 200


def _name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("must not be blank")
    return value


USERNAME_RULE = (
    "Kullanıcı adı 2-128 karakter olmalı; yalnızca a-z, 0-9 ve . _ @ - kullanılabilir. "
    "Türkçe/Azerbaycanca harfleri Latin karşılığıyla yazın: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e."
)


def _username(value: str) -> str:
    key = normalize_login(value)
    if not _USERNAME.fullmatch(key):
        raise ValueError(USERNAME_RULE)
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
    # A temporary password from an administrator that the user has not replaced yet.
    must_change_password: bool = False


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


class SignInUnlockIn(BaseModel):
    """Why an administrator lifts an account's AD sign-in throttle; it goes into the audit row.
    At most 200 characters as sent, trimmed, not blank, one line with no control character (a
    line break or a NUL could forge or cut a line in an exported trail) — nor Unicode's line
    and paragraph separators (U+2028, U+2029), which some viewers break a line on too — and no
    invisible formatting character (category Cf: a bidirectional override or isolate shows the
    text in another order than it is stored; a zero-width character or a byte-order mark hides
    in it). At least one letter or digit: a reason someone can read."""
    reason: str = Field(min_length=1, max_length=_REASON_MAX)

    @field_validator("reason")
    @classmethod
    def _one_line(cls, value: str) -> str:
        value = _name(value)
        if any(unicodedata.category(ch) in ("Cc", "Cf", "Zl", "Zp") for ch in value):
            raise ValueError("reason: one line of text, no control or formatting characters")
        if not any(unicodedata.category(ch)[0] in "LN" for ch in value):
            raise ValueError("reason: at least one letter or digit")
        return value


# ---------------------------------------------------------------- /admin/ldap (spec §7)
class LdapStatusOut(BaseModel):
    configured: bool
    url_host: str | None = None
    last_test_at: datetime | None = None
    last_test_ok: bool | None = None


class LdapTestOut(BaseModel):
    ok: bool
    reason: str | None          # unreachable | timeout | tls | service_bind_rejected | protocol
    checked_at: datetime


class LdapUserOut(BaseModel):
    """An AD account as the search shows it — no group list (plan decision D17)."""
    external_id: str
    username: str
    upn: str | None
    email: str | None
    display_name: str | None
    dn: str
    disabled: bool
    already_imported: bool


class LdapGroupOut(BaseModel):
    dn: str
    name: str


class LdapImportIn(BaseModel):
    external_ids: list[uuid.UUID] = Field(min_length=1, max_length=50)
    extra_group_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class LdapImportedOut(BaseModel):
    external_id: str
    id: uuid.UUID
    username: str
    groups: list[UserGroupOut]


class LdapSkippedOut(BaseModel):
    external_id: str
    # exists | not_found | disabled | expired | login_taken | no_username | invalid_login
    reason: str


class LdapImportOut(BaseModel):
    imported: list[LdapImportedOut]
    skipped: list[LdapSkippedOut]


class LdapMappingIn(BaseModel):
    ad_group_dn: str = Field(min_length=3, max_length=2048)
    group_id: uuid.UUID

    @field_validator("ad_group_dn")
    @classmethod
    def _looks_like_a_dn(cls, value: str) -> str:
        """The DN in its canonical spelling (`canonical_dn`: how it is stored and compared).
        Malformed, or carrying a control character (NUL included, which the database would
        refuse with a 500), it is this 422."""
        try:
            return canonical_dn(value)
        except ValueError:
            raise ValueError("ad_group_dn must be a distinguished name (CN=…,DC=…)") from None


class LdapMappingOut(BaseModel):
    id: uuid.UUID
    ad_group_dn: str
    group_id: uuid.UUID
    group_slug: str
    group_name: str
    created_at: datetime
