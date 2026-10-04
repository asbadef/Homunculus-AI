# LDAP / Active Directory sign-in and group-based RBAC

**Date:** 2026-09-23
**Status:** design approved; amended as built 2026-10-04 (Plan 2 = roadmap G1-03/G1-04, plan
`docs/superpowers/plans/2026-10-03-g1-dalga1a-ldap-arka-uc.md`). Amended passages are marked
*As built*; where they differ from the original text, the code follows them.
**Delivery:** one design, two implementation plans — Plan 1 (RBAC: groups, permissions, user
management) ships and is usable on its own; Plan 2 (LDAP/AD) builds on it.

## Context

Homunculus authenticates clinicians with an e-mail + bcrypt password and issues a JWT whose
`roles` claim maps each tenant to **one** value of a ten-entry `UserRole` enum. Routes are guarded
by `require_roles(...)`, which accepts the role in *any* tenant. There is no user-management API:
the only way an account comes into existence is the bootstrap seed.

Three things make that model insufficient for the pilot hospital:

1. **The hospital runs Active Directory.** Staff already have AD accounts; issuing them a second
   password for a monitoring screen is both an operational burden and a security regression (a
   second, weaker credential per clinician). Sign-in has to go through AD.
2. **The role catalogue has drifted.** The backend enum has ten roles; the dashboard has six of
   its own (`PHARMACIST` and `BIOMEDICAL` exist only in the UI); an untracked router on the
   Infinity branch references `UserRole.BIOMEDICAL`, which does not exist. `/ack` and `/view`
   take the caller's role from the request body — a self-declaration. There is no single place
   where "who may do what" is defined.
3. **The administrator needs to run this without a developer.** Adding a nurse, moving someone to
   the charge-nurse group, or deciding that pharmacists may see the board are hospital decisions,
   not code changes. Today every one of them is a code change.

This design replaces the role enum with **administrator-defined groups carrying permission sets**,
adds a **user-management API and UI**, and adds **AD sign-in with admin-driven import** and an
**AD-group → Homunculus-group mapping**. Local accounts remain, so an AD outage never locks the
ward out of its own admin.

## Decisions taken during brainstorming

| Question | Decision |
| --- | --- |
| Sequencing | One design, two plans; RBAC first. |
| Group model | Custom groups per tenant + a fixed permission catalogue in code. Defaults seeded. |
| How AD users arrive | Administrator searches AD from the admin UI and imports. No just-in-time creation: an AD account that was not imported cannot sign in. |
| AD unreachable | Local (bcrypt) accounts keep working; AD users cannot sign in; open sessions last until their token expires. AD passwords are never cached. |
| AD groups | Mapping table (AD group DN → Homunculus group) applied at import and on every sign-in, on top of manual assignments, which are preserved. *As built:* and at every token refresh the directory answers (§7). |
| Permission granularity | Feature-level (19 keys). Unit-scoped visibility is out of scope. |
| MFA | Per group (`mfa_required` flag), applies to local and AD users alike; the TOTP secret lives in Homunculus. |
| RBAC mechanism | Permissions in the JWT + per-user `token_version` so changes take effect immediately without a per-request permission query. |
| AD mechanism | LDAPS: service-account search, then bind as the user. `ldap3`. Kerberos/SAML out of scope. |
| Test directory | The hospital AD is reachable from the VM; tests use a fake directory, plus one opt-in integration test against the real one. |

## 1. Data model

New tables (Alembic revision `0006`):

| Table | Columns | Notes |
| --- | --- | --- |
| `groups` | `id`, `tenant_id`, `slug`, `name`, `description`, `mfa_required`, `is_system`, `created_at`, `updated_at` | `slug` unique per tenant. `is_system` is true only for `hospital_admin`, which cannot be deleted. |
| `group_permissions` | `group_id`, `permission` | PK `(group_id, permission)`. Writes are validated against the catalogue (§2). |
| `user_groups` | `user_id`, `group_id`, `source` (`manual` \| `ldap`), `granted_by_id`, `created_at` | PK `(user_id, group_id)`. LDAP sync touches only `source = ldap` rows. |
| `ldap_group_mappings` | `id`, `tenant_id`, `ad_group_dn`, `group_id`, `created_by_id`, `created_at` | *As built:* the DN is stored and compared in one canonical spelling, `canonical_dn` (parsed per RFC 4514, spaces around separators dropped, escapes resolved and written back one way, ASCII letters lower-cased and no others), not `lower(...)`. Unique `(tenant_id, ad_group_dn, group_id)` on that form; another spelling of a mapped DN is the 409 duplicate. |

Changes to `users`:

| Column | Change | Why |
| --- | --- | --- |
| `username` | new, `NOT NULL`, unique (case-insensitive) | The sign-in identifier for AD users is `sAMAccountName`; e-mail is not guaranteed in AD. Backfilled from `email` for existing rows. |
| `email` | becomes nullable; unique when present (case-insensitive) | AD accounts without `mail`. |
| `hashed_password` | becomes nullable | AD users have no local password. A local sign-in against a `NULL` hash fails closed. |
| `auth_source` | new enum `local` \| `ldap`, default `local` | Chooses the credential check. |
| `external_id` | new, nullable, unique | AD `objectGUID`. Stable across renames and OU moves. |
| `ldap_dn` | new, nullable | Last-seen DN, for diagnostics only. |
| `token_version` | new, `INTEGER NOT NULL DEFAULT 0` | See §3. |
| `last_login_at` | new, nullable | Shown in the admin list. |
| `sessions_revoked_at` | new, nullable | Set on deactivation; `/auth/refresh` refuses a refresh token issued at or before it, so reactivating an account never revives its old sessions. |

`tenant_memberships` keeps its job as the user ↔ tenant link. Its `role` column becomes nullable
and is no longer written. `UserRole`, `MFA_REQUIRED_ROLES` and `require_roles` are **deleted** from
the Python code; the legacy-role → group conversion happens once, in the migration, in SQL. The
migration turns the now-unused column into `varchar(40)` (an enum-typed column rejects the NULL
the ORM writes); the PostgreSQL `userrole` enum type itself stays until a later cleanup migration
drops it together with the column.

## 2. Permission catalogue

Defined once, in code (`homunculus/auth/permissions.py`), as the complete list of things a
signed-in user may be allowed to do — 19 keys. `require_permission()` refuses an unknown key at import
time, so a typo in a route guard fails at startup rather than silently denying everyone.

| Key | Grants |
| --- | --- |
| `board.view` | The live board, patient detail, the SSE stream (via stream tickets). The baseline clinical permission. |
| `alerts.ack` | Acknowledge or snooze an alert. |
| `alerts.escalate` | Create an alert manually; escalate one. |
| `admissions.view` | Read admissions and patient records. |
| `admissions.admit` | Create an admission. |
| `admissions.sign_off` | Physician sign-off of an admission. |
| `admissions.move.initiate` | Initiate a transfer or discharge. |
| `admissions.transfer.confirm` | Confirm a transfer arrival. |
| `admissions.discharge.confirm` | Confirm a discharge; release the bed. |
| `care_team.claim` | Claim a care-team role on a patient. |
| `care_team.assign` | Assign others to a patient's care team. |
| `handover.sign` | Sign or countersign a handover. |
| `shifts.manage` | Create shift schedules. |
| `break_glass.use` | Open, extend or close a break-glass session. |
| `audit.view` | Read the audit trail. |
| `users.manage` | Users: create, edit, activate, reset password/MFA, set groups, unlock an AD sign-in. Includes LDAP search, import, connection test and reading the group-mapping table. *As built:* creating or deleting a mapping also needs the whole catalogue (§7). |
| `groups.manage` | Groups and their permission sets. |
| `structure.manage` | Tenant → site → unit → room → bed. |
| `devices.manage` | Device and research endpoints (Infinity research router). |

A user with no groups signs in successfully and holds no permissions; the dashboard shows the
existing "Hesabınıza kurum yetkisi tanımlanmamış" message and refuses the session.

## 3. Default groups and the legacy conversion

Seeded for every tenant — by the migration for existing tenants, and by the same service function
whenever a tenant is created later (tenant API and `seed_admin.py`). Every legacy role maps to
exactly one group, and for every route that has a role guard today the group holds precisely the
rights that role had — the migration itself moves nobody to a different tier. Routes that today
require only a valid sign-in are a separate matter; see *What the defaults tighten* below.

| Slug | Name (TR) | Legacy role | Permissions | MFA |
| --- | --- | --- | --- | --- |
| `hospital_admin` | Sistem Yöneticisi | HOSPITAL_ADMIN | all — see *The system group* | yes |
| `attending` | Sorumlu Hekim | ATTENDING | board.view, alerts.ack, alerts.escalate, admissions.view, admissions.sign_off, admissions.move.initiate, care_team.claim, care_team.assign, handover.sign, break_glass.use | yes |
| `unit_physician` | Ünite Hekimi | UNIT_PHYSICIAN | as `attending` minus care_team.claim and care_team.assign | yes |
| `physician` | Hekim | ASSOCIATE_PHYSICIAN, ONCALL_PHYSICIAN | board.view, alerts.ack, alerts.escalate, admissions.view, handover.sign, break_glass.use | no |
| `charge_nurse` | Sorumlu Hemşire | CHARGE_NURSE | board.view, alerts.ack, alerts.escalate, admissions.view, admissions.admit, admissions.transfer.confirm, admissions.discharge.confirm, care_team.claim, handover.sign, shifts.manage, break_glass.use | no |
| `nurse` | Hemşire | NURSE | board.view, alerts.ack, admissions.view, admissions.admit, admissions.transfer.confirm, handover.sign | no |
| `rapid_response` | Hızlı Yanıt Ekibi | RAPID_RESPONSE | board.view, alerts.ack, alerts.escalate, admissions.view, break_glass.use | no |
| `auditor` | Denetçi | AUDITOR | board.view, audit.view | no |
| `platform_support` | Üretici Destek | PLATFORM_SUPPORT | audit.view, devices.manage | yes |
| `pharmacist` | Eczacı | — | board.view, admissions.view | no |
| `biomedical` | Biyomedikal Teknisyen | — | devices.manage | no |

Only `hospital_admin` is `is_system`. Every other default may be renamed, have its permissions
changed, or be deleted once it has no members and no LDAP mapping. Administrators may create any
number of further groups.

**The system group.** `hospital_admin` holds every permission in the catalogue **by rule, not by
its rows**: at token issuance a member of a system group receives the whole catalogue, including
any key added after the tenant was seeded, so the administrator can never fall behind the
software. Its permission set and its MFA flag cannot be edited (409); it cannot be deleted. Its
`group_permissions` rows are still seeded, so the admin screen shows them, but they are display
only. Note that this **widens** the legacy HOSPITAL_ADMIN, which could not sign off admissions,
admit, initiate a move, sign a handover or use break-glass; the spec accepts that on purpose —
one account that can do everything is the break-glass path the design relies on.

**Defaults are seed values.** After seeding, a tenant owns its groups. A later change to the
defaults in code reaches new tenants only; existing tenants' non-system groups change only
through the admin screen. Migration 0006 carries a frozen copy of the defaults as they stood
then, and its test pins that copy to a snapshot inside the test — never to the live defaults.

**What the defaults tighten.** Today `GET /admissions*`, `/handovers*`, the escalation router
(`POST /alerts`, acknowledge, snooze, escalate), `/break-glass*` and `GET /audit` accept **any**
signed-in user. Under the defaults above they become permission-gated, which narrows some groups
on purpose: `nurse` loses manual escalation and break-glass (it keeps transfer confirmation,
which it has today); `rapid_response` loses handover signing; `auditor` keeps the board and the audit trail and loses the clinical actions;
`pharmacist` keeps the board and admissions reading; `biomedical` and `platform_support` lose the
board. `/audit` is now readable only by `hospital_admin`, `auditor` and `platform_support`. An
administrator who wants any of these back adds the permission to the group — that is the point of
the design. The care-team claim stays exactly as it is today: `attending`, `charge_nurse` and
`hospital_admin`.

## 4. Authentication flow

### Sign-in

`POST /auth/login {login, password}`. The existing `email` field is accepted as an alias for
`login`, so the mobile client keeps working unchanged. The user is looked up by `username` **or**
`email`, case-insensitively.

- **Not found** → a dummy bcrypt comparison is performed, then 401. Response time must not reveal
  whether the account exists.
- **`auth_source = local`** → bcrypt against `hashed_password`; a `NULL` hash is a 401.
- **`auth_source = ldap`** → the LDAP directory (§7). Wrong password → 401. Directory unreachable
  or timing out → **503** `Dizin sunucusuna ulaşılamıyor`. The two are never conflated: a 503 is
  an infrastructure fault the clinician should report, a 401 is their own mistake.
- **`is_active = false`** → 401.
- Success writes `last_login_at` and an `auth` audit event (`login.ok`). Failures write
  `login.fail` with the login string and the reason class (`bad_credentials`, `inactive`,
  `directory_unavailable`) — never the password. *As built:* also `directory_disabled`,
  `directory_expired` (§7) and `throttled` (429, §7 Security).
- *As built — timing.* Every 401 of an AD sign-in runs the same dummy bcrypt comparison as an
  unknown login, and every 401 of `POST /auth/login` answers no sooner than 0.5 s
  (`LOGIN_FAILURE_FLOOR_S`) after the request reached the route, so the directory's round trips
  do not mark a login as an AD account. The wait is a sleep, after the database connection has
  gone back to the pool. A 429 and a 503 are not held: their status says it already.

### Token claims

Access token: `sub`, `type`, `iat`, `exp`, `jti`, plus:

| Claim | Value |
| --- | --- |
| `tenant` | The resolved tenant slug. A user with several memberships resolves to the lowest slug, the rule the current JWT→hospital resolver already applies; it now happens once, at issuance. |
| `groups` | Slugs of the user's groups in that tenant. |
| `perms` | Union of those groups' permissions. |
| `mfa_required` | True if any of those groups has `mfa_required`. |
| `mfa_verified` | False until a TOTP code is verified in this session. |
| `tv` | The user's `token_version` at issuance. |

The `roles` claim is removed. The refresh token carries `sub`, `type = refresh`, `mfa_verified` and
`cv` — a short digest of the password hash and TOTP secret it was issued against — and does **not**
carry `tv`. `/auth/refresh` refuses a refresh token whose `cv` no longer matches, so a password
change or reset and an MFA reset end every session, not only the one-hour access token; and it
carries `mfa_verified` forward only while the user still has an authenticator. An access token
without `tv` (minted before this design) is refused with 401; its refresh token has no `cv`
either, so at the cut-over every user signs in once. The fingerprint is an HMAC keyed with the
signing secret.

`TokenResponse` gains `mfa_enrolled` (the user has a verified TOTP secret). `requires_mfa` now
means "must complete TOTP before the app may be used" — `mfa_required && !mfa_verified` — rather
than the current "has enrolled".

### Token version: immediate effect without per-request queries

`get_current_user` already loads the `User` row on every request to check `is_active`. It now
also checks `claims.tv == user.token_version`; a mismatch is a 401.

`token_version` is incremented for every affected user whenever:

- their group memberships change (manual or LDAP sync),
- a group they belong to changes its permissions or `mfa_required`,
- they are deactivated, or their password/MFA is reset by an administrator.

The client already refreshes once on a 401 and retries. `/auth/refresh` issues a **new** access
token from the user's **current** groups and `token_version`, so a permission change costs the
clinician one transparent refresh, not a sign-out. Deactivation makes the refresh fail too
(`is_active` is checked there), which ends the session — today's behaviour.

### MFA enforcement

Today nothing on the API checks `mfa_verified`. New rule: a token with `mfa_required = true` and
`mfa_verified = false` is accepted only by `/auth/totp/setup`, `/auth/totp/verify`, `/auth/me`
and `/auth/refresh`; every other route returns 403 `mfa_required`. A user in an MFA group who has
not enrolled is walked through setup (QR) and verification on first sign-in. A user who **has**
enrolled cannot call `/auth/totp/setup` from a pending session (403 `mfa_reset_required`):
otherwise the password alone would replace the authenticator and pass the gate. A lost device
is an administrator's MFA reset. Replacing an authenticator from a verified session keeps the
account enrolled throughout (it never drops back to "not enrolled"); abandoning the replacement
fails closed.

### Password change

`POST /auth/password {current_password, new_password}` for local accounts (an administrator sets
a temporary password; the user must be able to replace it). For an AD user it returns 400
`Parola Active Directory tarafından yönetiliyor`.

## 5. Enforcement

`require_permission(*keys)` replaces `require_roles`. It builds on `get_current_user` and
succeeds if the token's `perms` contains **any** of the listed keys.

| Route(s) | Permission |
| --- | --- |
| `GET /patients`, `GET /alerts/{patient_id}`, `POST /stream-ticket` | `board.view` |
| `POST /ack` | `alerts.ack` |
| `POST /view` | `board.view` |
| `GET /audit` | `audit.view` |
| `POST /admissions` | `admissions.admit` |
| `GET /admissions*` | `admissions.view` |
| `POST /admissions/{id}/sign-off` | `admissions.sign_off` |
| `.../transfer/initiate`, `.../discharge/initiate` | `admissions.move.initiate` |
| `.../transfer/confirm` | `admissions.transfer.confirm` |
| `.../discharge/confirm`, bed release | `admissions.discharge.confirm` |
| `.../care-team/claim` / `POST .../care-team` | `care_team.claim` / `care_team.assign` |
| `/handovers*` | `handover.sign` |
| `POST /shift-schedule` | `shifts.manage` |
| `POST /alerts`, `.../escalate` | `alerts.escalate` |
| `.../acknowledge`, `.../snooze` | `alerts.ack` |
| `/break-glass*` | `break_glass.use` |
| `/tenant/*` (the caller's own tenant only) | `structure.manage` |
| `POST /tenant/tenants` | platform operator (`users.is_platform_support`); no group permission |
| Infinity research router | `devices.manage` (replaces the dangling `UserRole.BIOMEDICAL`) |
| `/admin/users*`, `/admin/ldap/*` | `users.manage` |
| `POST /admin/ldap/group-mappings`, `DELETE /admin/ldap/group-mappings/{id}` | *As built:* `users.manage` **and** the whole catalogue (every key, through any groups), else 403 |
| `/admin/groups*` writes, `GET /admin/permissions` | `groups.manage` |
| `GET /admin/groups` | `groups.manage` or `users.manage` (a user manager lists the groups it may grant) |

**The device path is unchanged.** A static tenant token (the bridge's `/ingest` credential, and
the legacy `?board=1` screen) is a machine identity and is exempt from permission checks.

The `_hospital()` helper in `api/app.py` becomes `_caller()`, which returns a `Caller`:
- A tenant token gives `Caller(hospital, device=True)`. No permission is demanded, and "device" is
  explicit, never inferred from a missing actor.
- For a JWT:
  - the `tenant` claim supplies the hospital;
  - the user row is loaded for `is_active` and `tv`;
  - the same query confirms an active membership in the active tenant of that slug (see "Tenant
    isolation" below);
  - the `Caller` carries the username as `actor`, together with the token's groups and perms.
- `_require(caller, perm)` raises 403 when the permission is missing.
- A refusal a refresh can fix is 401. A pending MFA step or an inactive tenant is 403.
- The resolver makes one read per request: the user row joined with the tenant condition above.
  A database error stays a 5xx, never a 401, so an outage never signs clinicians out.
- `/ingest` is device-only: a JWT gets 403.

**Attribution.** For a JWT caller, `/ack` and `/view` record the actor from the token —
`username` and `groups` — instead of the body's self-declared `role`; the body field is honoured
only on the device path. The audit row says which: `via` is `device` or `user`, and `actor` is the
username (None for a device). `role` stays, because rehydration reads it. `/notifications?role=` stays: it selects a notification channel, it is
not an authorisation.

**Tenant isolation.** A permission is held in one tenant, the token's `tenant` claim, so every
admission, alert, break-glass, handover, shift and structure route acts only on that tenant's
objects:
- An object of another tenant named by id, in the path or in the body, is a 404 with the same
  detail as a missing one.
- A user of another tenant named in a body is a 422.
- Lists return only the caller's tenant.
- A break-glass session can be extended or closed only by the user who opened it. A closed or
  expired one can be neither extended nor closed again (409), so `closed_at` records when access
  really ended.

The tenant claim is not trusted by name alone. On every router request and every board request,
one query confirms three things: that the slug's tenant exists, that it is active, and that the
caller holds an active membership in it. An unknown slug is 401, and so is a tenant in which the caller has no
membership row at all (a renamed slug that another tenant reuses). The client refreshes and gets the
current slug; the two cases answer identically. An inactive tenant or membership is 403. The signature proves who minted the
token, but a slug can be renamed and reused, and a membership can be deactivated inside the
token's hour. A user named in a request body must be an active user with an active membership.

Creating a tenant is a platform-operator action (`users.is_platform_support`, set in SQL, granted
by no group). The operator is always MFA-verified. A hospital administrator's tenant would have no members and could not be
administered through `/admin`. A new tenant's first administrator comes from
`scripts/seed_admin.py`. (Added after Task 7's review: before this, no route filtered by tenant.
The old `require_roles` accepted a role held in any tenant.)

## 6. Administration API

All routes are scoped to the caller's tenant (`tenant` claim); a request naming a user or group of
another tenant is a 404.

### Groups (`groups.manage`)

- `GET /admin/permissions` — the catalogue with a short English description per key.
- `GET /admin/groups` — with member counts.
- `POST /admin/groups {slug, name, description, mfa_required, permissions[]}`
- `PATCH /admin/groups/{id}` — any of the above; permission changes bump `token_version` of every
  member. On the system group, `permissions` and `mfa_required` are refused with 409; name and
  description may change.
- `DELETE /admin/groups/{id}` — 409 if the group has members, has LDAP mappings, or is `is_system`.

### Users (`users.manage`)

- `GET /admin/users` — `id, username, email, full_name, auth_source, is_active, totp_enabled,
  last_login_at, groups[]` (each group with its `source`).
- `POST /admin/users {username, email?, full_name, password, group_ids[]}` — a local account with
  a temporary password.
- `PATCH /admin/users/{id} {full_name?, email?, is_active?}`
- `PUT /admin/users/{id}/groups {group_ids[]}` — replaces the **manual** memberships only;
  `ldap`-sourced rows are untouched.
- `POST /admin/users/{id}/reset-password {password}` — local accounts only; 400 for AD users.
- `POST /admin/users/{id}/reset-mfa` — clears the TOTP secret; the user re-enrols at next sign-in.
- *As built:* `POST /admin/users/{id}/unlock-sign-in {reason}` — lets 3 more failed binds
  through in the account's current run of failed AD sign-ins (§7 Security), once per run (a
  second: 409); an account with no failed bind in its current run (or a local one) is granted
  nothing and keeps the run's unlock. The reason (one line, at most 200 characters, at least
  one letter or digit, no control or invisible formatting character — Unicode Cc, Cf, Zl, Zp)
  goes into the audit row. Within the caller's rights (a refused unlock uses nothing); not for an
  account shared with another tenant or a platform operator (409). Nothing in the database
  changes.

### Guards

- An *administrator* is an active LOCAL user with a password and an active membership who holds
  the tenant's SYSTEM group (`hospital_admin`, which carries the whole catalogue by rule, now and
  after any release that adds a key). Holding every key through custom groups does not count: a
  custom group does not gain a key a release adds, so its holder would stop being able to
  administer. The last administrator of a tenant cannot be deactivated or leave `hospital_admin`,
  and no group change may leave the tenant without one, including changes an administrator makes
  to their own groups. 409 `Son yönetici pasifleştirilemez` / `Son yönetici yetkisi kaldırılamaz`.
- Manual and LDAP memberships are separate rows; neither operation can delete the other's. A
  user holds a given group through ONE row (the key is user + group): a manual request for a
  group already held through the AD mapping is a no-op, and the LDAP sync leaves a manual row for a
  mapped group as it is.
- The guard is race-free: it runs after the change, in the same transaction, under a per-tenant
  transaction-scoped advisory lock, and counts only users with an active membership in the tenant.
  Every admin write takes that lock first. Under the lock it re-reads the caller's `token_version`
  and `is_active`, so a request queued behind the caller's own demotion is refused (401).
- The guard keeps at least one active LOCAL administrator: a local account with a password. An AD
  outage must never lock the ward out of its own administration, so AD-held administrators do not
  count toward it.
- **No grant beyond your own rights.** The caller's permissions bound everything they can do:
  - a user can be edited, reset or regrouped only if that user's effective rights in the tenant are
    within the caller's;
  - a group can be granted, created, edited or deleted only if its effective rights (before and
    after) are within the caller's. The system group counts as the whole catalogue;
  - an edit that changes a group's rights or its MFA flag, or deletes it, also needs every current
    member's rights, before and after, to be within the caller's. A group edit changes its members,
    so the user rule applies to each of them.

  The caller's rights are read from the database under the admin lock, not from the token, so a
  newly added catalogue key never locks out an administrator whose token predates it.

  Otherwise the answer is 403. So `users.manage` alone makes a *user manager*, for example a charge
  nurse who puts staff into the nurse groups, not an administrator. Only a holder of every key can
  manage `hospital_admin`.
- **An account shared with another tenant is not this tenant's to change.** The password, MFA,
  `is_active`, e-mail and name live on the global user row. A target that holds an active
  membership in another tenant, or is a platform operator (`is_platform_support`), can be regrouped
  within this tenant but not otherwise changed (409).
- **Not on yourself.** An administrator cannot reset their own password or MFA, or deactivate
  themselves, through `/admin` (409). Their own password goes through `/auth/password`, which checks
  the current one.
- Usernames are global. A 409 on a username or e-mail held only in another tenant therefore tells
  the caller that the account exists. That is accepted.

**Audit.** Every mutation appends to the existing `AuditLog` for the tenant with
`event_type = admin`, `kind` = one of `user.create`, `user.update`, `user.groups`,
`user.password_reset`, `user.mfa_reset`, `group.create`, `group.update`, `group.delete`,
`ldap.import`, `ldap.mapping.create`, `ldap.mapping.delete`, and a payload of
`{actor, target, before, after}`. Sign-ins are audited as `event_type = auth` (§4). *As built:*
also `user.sign_in_unlocked` (with the reason), `ldap.test`, and `ldap.sync.guarded` (actor
`ldap-sync`, §7 step 5).

## 7. LDAP directory

### Module

`homunculus/auth/ldap.py` defines the `LdapDirectory` protocol:

```text
authenticate(external_id, password) -> LdapIdentity | None     # by objectGUID; None = bad credentials
find_by_external_id(guid, *, lane=None)        -> LdapIdentity | None
search_users(query, limit=50, *, lane=None)    -> list[LdapIdentity]
search_groups(query, limit=50, *, lane=None)   -> list[LdapGroup]   # dn, name
test_connection(*, lane=None)                  -> None              # raises on failure
```

`LdapIdentity` carries `external_id` (objectGUID), `username` (sAMAccountName), `upn`, `email`,
`display_name`, `dn`, `group_dns`, `disabled`, `pwd_last_set` (for the refresh re-check) and,
*as built*, `account_expires` (accountExpires; sign-in and refresh refuse an account past it).
`authenticate` takes the objectGUID, not the typed login (sign-in step 1; the typed login only
selects the imported account — plan decisions D1–D2). `LdapUnavailable` is raised for connection,
TLS and timeout failures and maps to the 503 in §4. *As built:* its `reason` is one fixed code
(`unreachable`, `timeout`, `tls`, `service_bind_rejected`, `protocol`), and `bind_attempted` says
whether the typed password had reached the directory (the throttle in §7 Security counts only
those).

`Ldap3Directory` implements it with `ldap3` (pure Python; runs on the Windows dev machines and in
the `python:3.12-slim` image without libldap; *as built,* the image installs the exact versions
in `homunculus-engine/constraints.txt`, and the suite runs on Python 3.12 as well as on the
3.14 dev venv). `ldap3` is synchronous. *As built,* instead of
`asyncio.to_thread`: every call runs on the directory's own pool of **8 threads** (never
asyncio's default executor), and is cut off after its deadline, `min(2 × LDAP_TIMEOUT_S, 12)` s,
the wait for a free thread included — so a sign-in or a refresh answers within the deadline
(at most 12 s, under the dashboard's 15 s). A call cut off keeps its thread until the socket
timeouts end it, so the pool, not a semaphore, is the cap; a call the caller stopped waiting for
never binds as the account afterwards. Administration calls (`lane`: search, group search, the
import's lookups, the connection test) first take a place in the process's **admin lane**, a
`BoundedSemaphore(3)`, waiting for it at most the deadline (then `timeout`, nothing sent), and
keep it until their thread is done: administration never holds more than 3 of the 8 threads,
sign-ins and refreshes keep 5, and an administration call answers within 2 × the deadline
(20 s at the default `LDAP_TIMEOUT_S`). One import runs at most 2 lookups at once, so a search
finds a lane place beside one import; two imports at once can fill the lane, and a search then
waits at most its deadline and answers 503. An import's total time is not bounded by 2 × the
deadline: n accounts take up to about ⌈n/2⌉ × 2 × the deadline (G1-14 imports in parts). The
lookups run under `asyncio.wait`, not a `TaskGroup`: on Python 3.12 — the image's — a TaskGroup
leaves its parent task marked as cancelled after a child fails, and an outage could not be told
from a cancelled request. Sign-in, refresh and the four `/admin/ldap` routes that ask the
directory give their database connection back to the pool before they do, and re-read what
they need afterwards (plan decision D7, extended to administration). `FakeDirectory` (in
`tests/`) implements the same protocol from an in-memory list and is what the unit tests use.

### Configuration (environment; secrets stay in `.env`)

| Variable | Meaning |
| --- | --- |
| `LDAP_URL` | `ldaps://dc.example.local:636`. Unset = LDAP disabled: `/admin/ldap/*` returns 409 `Dizin yapılandırılmamış`, the UI hides the AD tab, and `auth_source = ldap` sign-ins return 503. *As built:* `GET /admin/ldap/status` still answers 200 `configured: false` (the panel needs it to hide itself); a setting the API cannot use is logged and leaves LDAP off, never stops the API. |
| `LDAP_CA_CERT` | CA bundle path for certificate verification. |
| `LDAP_ALLOW_INSECURE` | `1` permits `ldap://` or unverified TLS, with a loud startup warning. Never in the pilot `.env`. *As built:* with `LDAP_CA_CERT` given, `ldaps://` is still verified; only without one is verification off. |
| `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD` | Read-only service account used for searches. |
| `LDAP_BASE_DN` | Search base. |
| `LDAP_USER_FILTER` | Default `(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))` — people, not computers, not disabled. |
| `LDAP_LOGIN_ATTRS` | Default `sAMAccountName,userPrincipalName,mail` — attributes a typed login is matched against. |
| `LDAP_NESTED_GROUPS` | Default `1`: resolve `memberOf` through AD's chain matching rule (`1.2.840.113556.1.4.1941`) so membership in a nested group counts. |
| `LDAP_TIMEOUT_S` | Default `5`. A hung directory must not hang the login endpoint. *As built:* 1–10 s; the socket timeouts of each operation, and one call's deadline is `min(2 × LDAP_TIMEOUT_S, 12)` s (see Module). |

### Sign-in for an AD user

*As built, before step 1:* a deactivated account (`inactive`) and an empty password are refused
before the directory is asked, and so is an account whose current run of failed binds is full
(3, or 6 after an unlock; 429, §7 Security) — no bind, so no AD lockout count. The database
connection is released while the directory answers, and the account is re-read afterwards (a deactivation made
meanwhile is a 401).

1. The service account searches by `objectGUID = external_id`. (Not by name: an account renamed
   or moved in AD must still be the same Homunculus user.) Not found → 401 and an audit line.
   *As built:* the search applies `LDAP_USER_FILTER` too, so what it excludes cannot sign in or
   refresh; under the default filter a disabled account is "not found".
2. Bind as the found DN with the supplied password. `invalidCredentials` → 401. Anything else
   (`LdapUnavailable`) → 503.
3. Read `displayName`, `mail`, `userPrincipalName`, `memberOf`, `userAccountControl`. A disabled
   account (`ACCOUNTDISABLE`) → 401; the local `is_active` flag is **not** changed automatically
   (an automatic off-boarding sync is a separate, scheduled slice — see out of scope).
   *As built:* also `pwdLastSet` and `accountExpires`. A disabled account (a custom filter that
   lets it through) or one past its `accountExpires` date is returned without a bind and refused:
   401 `directory_disabled` / `directory_expired`. The typed login must name the account in a form
   `LDAP_LOGIN_ATTRS` allows, else 401. `msDS-User-Account-Control-Computed` is deliberately not
   read: its lockout bit at refresh would let anyone end a clinician's session by typing her name
   with wrong passwords; a locked-out or password-expired account already fails the bind here.

**Refresh for an AD account.** The credential fingerprint of an AD account covers only its TOTP
secret (there is no local password hash), so it cannot notice a password change or a disabled
account in AD. `/auth/refresh` for an `auth_source = ldap` user therefore reads the account by
`objectGUID` with the service account: disabled (`ACCOUNTDISABLE`) or `pwdLastSet` later than the
refresh token's `iat` → 401. *As built:* also `pwdLastSet = 0` ("must change at next logon"),
`accountExpires` passed, and not found (deleted, moved out of `LDAP_BASE_DN`, excluded by the
filter) → 401. The database's own checks (active, `sessions_revoked_at`, credential fingerprint)
run first, so a token they refuse costs no directory call, and again after the directory has
answered. When the account passes, the group sync of step 5 runs too (same function, same guard
and audit), and the refreshed token is minted from the result, so a change of AD groups takes
effect within one access-token lifetime (amendment to Plan 2, closing its gap 5). If the
directory is unreachable the refresh proceeds without a sync — the §4 outage decision (open
sessions continue) — and the audit records `refresh.directory_unavailable`. *As built:* only for
the reasons `unreachable`, `timeout`, `tls` and `service_bind_rejected` (and LDAP not
configured); any other directory failure (`protocol`: a reply about the account that cannot be
read) is 503 with `refresh.directory_error` and no new tokens, so rights AD may have removed are
not carried forward.
4. Update `full_name`, `email`, `ldap_dn`. *As built:* an AD `mail` another account already uses
   (or takes at the same moment) is not copied, and the sign-in still succeeds; the profile is
   written after step 5 (every writer takes the tenant lock before an account's row).
5. **Group sync:** `memberOf` (case-insensitive) ∩ `ldap_group_mappings` for the tenant → the set
   of target groups. The sync runs the §6 administrator guard: a removal that would leave the
   tenant without an administrator is skipped and audited (`ldap.sync.guarded`), never applied.
   (Mechanics: the removal runs inside a savepoint; the guard counts; on 0 the savepoint is rolled
   back, so the profile update from step 4 survives.) The user's `source = ldap` rows are made equal to that set (rows added and
   removed); `source = manual` rows are untouched. If the set changed, an `admin/user.groups`
   audit event is written with `actor = ldap-sync` and `token_version` is bumped.
   *As built:* DNs are compared in their canonical spelling (`canonical_dn`, §1), not
   case-insensitively. The guard refuses only a removal that takes the tenant from some active
   local administrators to none: in a tenant that already has none, removals apply (a WARNING
   says the tenant needs one). The sync runs in the account's tenant, under the tenant's admin
   lock taken before the savepoint, and decides again under it.
6. Issue tokens as in §4.

### Import and mapping (`users.manage`; *as built:* mapping writes need the whole catalogue)

- `GET /admin/ldap/status` → `{configured, url_host, last_test_at, last_test_ok}`. *As built:*
  the one `/admin/ldap` route that answers while LDAP is off (`configured: false`); the others are
  409. A caller without `users.manage` gets 403 first, configured or not.
- `POST /admin/ldap/test` → binds with the service account; 200 or the failure reason.
  *As built:* 200 `{ok, reason, checked_at}` either way, `reason` one of the fixed codes.
- `GET /admin/ldap/search?q=` → up to 50 `LdapIdentity` rows, each flagged `already_imported`.
  *As built:* `q` is trimmed, then 2–64 characters.
- `POST /admin/ldap/import {external_ids[], extra_group_ids[]}` → for each id: fetch by GUID,
  create the user (`auth_source = ldap`, `hashed_password = NULL`, `username = sAMAccountName`,
  `email = mail or NULL`, `full_name = displayName`), add the tenant membership, apply the group
  mapping as `ldap` rows and `extra_group_ids` as `manual` rows. Already-imported ids are reported
  as `skipped: exists`; the call is idempotent.
  *As built:* at most 50 ids. Ids without an account are looked up before the tenant lock is
  taken (through the admin lane, 2 at a time; a directory failure is 503 with nothing written);
  then, under the lock, in one transaction, each account is skipped with a code — `exists`,
  `not_found`, `disabled`, `expired` (accountExpires passed), `no_username`, `invalid_login`
  (the lower-cased sAMAccountName breaks the local username rule, `a-z 0-9 . _ @ -`),
  `login_taken` (already someone's username or e-mail) — or created. `username` is the
  sAMAccountName lower-cased; a `mail` already in use is dropped. Each account is inserted in
  its own savepoint: one imported by another tenant at the same moment is `skipped: exists`, a
  user name taken meanwhile `login_taken`, and the rest of the batch goes on (an e-mail taken
  meanwhile is the 409 for the whole request). The response and the
  `ldap.import` audit rows are built from what was written, before the commit.
- `GET /admin/ldap/groups?q=` → AD groups for the mapping picker.
- `GET /admin/ldap/group-mappings`, `POST {ad_group_dn, group_id}`, `DELETE /{id}`.
  *As built:* `POST` and `DELETE` need the whole catalogue (every permission key, through any
  groups; 403 `AD grup eşlemesini yalnız tüm yetkilere sahip bir yönetici değiştirebilir`):
  a row regroups every member of its AD group, which a user manager (§6) may not do. The DN is stored in
  its canonical spelling (a value that is not a DN is 422); another spelling of a DN already
  mapped to the group is 409. Creating a row changes nobody now: it applies at each user's next
  sign-in or token refresh, and at import. Deleting one removes, at once, every `ldap`-sourced
  row of that group in the tenant and bumps those users' token versions (someone entitled to the
  group through another mapping gets it back at their next sign-in or refresh); the guard
  refuses it (409) only when it takes the tenant from some local administrators to none.
- **The §6 rule applies here too.**
  - Creating a mapping to a group, or an import that grants groups (mapped or
    `extra_group_ids`), needs each group's rights within the caller's.
  - Deleting a mapping removes rights from its members, so their rights must be within the
    caller's too, as for a group edit.
  - Otherwise, a user manager could map an AD group to `hospital_admin`.

### Security

- The AD password is used for one bind and discarded. It is never stored, never logged, never
  included in an audit payload. Homunculus never caches AD credentials.
- The service account is read-only. Its password lives in `.env` (`chmod 600`), never in the
  database and never in a response.
- Every search filter is built with `ldap3.utils.conv.escape_filter_chars`; a typed query cannot
  alter the filter.
- Result sets are capped; searches require `users.manage`.
- The TOTP secret of an AD user is stored in Homunculus like a local user's; the group MFA flag
  applies identically.
- (Done in Plan 1 already: `count_admins` counts local administrators only.) The §6 guard is tightened: a tenant must keep at least one active administrator whose
  `auth_source` is `local`, so an AD outage can never leave it with only administrators who cannot
  sign in. A local `hospital_admin` account therefore always exists, so an AD outage or a mapping mistake
  can be repaired from inside Homunculus.
- *As built — a per-account AD bind throttle.* Every failed bind also counts toward the hospital
  domain's lockout, so Homunculus must not be the way a clinician gets locked out of every
  hospital system. Failed binds are counted per account in a *run* (`auth/limits.py`,
  `FailureChain`) that ends only when 15 minutes pass with no failed bind — the way AD's
  "Reset account lockout counter after" works, measured from the last failure, not a sliding
  window. After 3 in the run an AD account's sign-in is refused with 429 `Çok fazla hatalı
  deneme; 15 dakika sonra tekrar deneyin` without asking the directory, until 15 minutes after
  the last failed bind; a refusal reaches no DC and does not extend the run. Only an attempt
  whose password reached the directory counts; a successful sign-in ends the run. In memory
  (one API process): a restart clears it. An administrator may let 3 more through with
  `POST /admin/users/{id}/unlock-sign-in {reason}` (§6), once per run and never for an account
  shared with another tenant or a platform operator. So one run holds at most 3 + 3 failed
  binds; with the domain's reset period at most 15 minutes, every run of AD's count made of
  Homunculus' failures lies inside one of Homunculus' runs, so Homunculus alone adds at most 6
  to it — a slow trickle (one wrong password every 5 minutes) included — and the domain's
  lockout threshold must be at least 7. This extends *Out of scope: login rate limiting* for AD
  accounts only.
- *As built — per address, at the edge.* nginx limits `POST /auth/login` to 10 a minute per
  client address with a burst of 10 (429 as JSON `{"detail": …}`, `Retry-After: 60`, logged as a
  warning), in front of the per-account throttle. Ward PCs behind one shared address (NAT,
  terminal server) share that limit.
- *As built — timing parity:* see §4 (dummy bcrypt on every AD 401, 0.5 s floor on every 401).

## 8. Dashboard

- **`liveAuth.js`** reads `{tenant, groups, perms, mfa_required, mfa_verified}` from the token.
  The backend-role → UI-role map and its precedence list are deleted. No permissions → the existing
  refusal message; permissions but no `board.view` → `Panoya erişim yetkiniz yok`.
- **Navigation.** `NAV_ITEMS` entries carry `perm: "<key>"` instead of `roles: [...]`; one
  `canSee(item, perms)` gates both live and simulated modes. The simulation (`?demo=1`) derives a
  `perms` array from its own `ROLE` through a small default-permission table in `clinicalDemo.js`
  (the same sets as §3), so the two modes share one gate and the demo keeps working.
- **Admin page in live mode.** `UserAdmin` / `UserRow` call real endpoints through new
  `liveStore` actions (`listUsers`, `createUser`, `updateUser`, `setUserGroups`,
  `resetPassword`, `resetMfa`, `listGroups`, `saveGroup`, `deleteGroup`, `listPermissions`,
  `ldapStatus`, `ldapSearch`, `ldapImport`, `ldapMappings`, `addLdapMapping`,
  `removeLdapMapping`, `ldapTest`). Two new panels: **Groups** (name, description, MFA flag,
  permission checkboxes with labels) and **Active Directory** (search → select → import, with an
  "also add to" group picker; the mapping table; connection test). The AD panel renders only when
  `ldapStatus().configured` is true.
- **Honesty rule.** Simulation-only actions that have no backend — invites, quick PINs, per-user
  MFA policy, unit assignment — are hidden in live mode. A control that writes nowhere is never
  shown as if it worked.
- **MFA enrolment.** When a login returns `requires_mfa` with `mfa_enrolled = false`, the UI
  fetches the provisioning URI from `/auth/totp/setup`, shows the QR, then verifies. When
  `mfa_enrolled = true`, the existing code-entry gate runs.
- **Attribution.** `acknowledgeAlert` stops sending `role`; the API attributes from the token.
- **i18n.** Group names for the defaults and a label per permission key, in TR / AZ / EN / RU.
- **Mobile** is unaffected: it sends `email` (accepted as an alias) and does not read the `roles`
  claim. It already treats `requires_mfa = true` as "cannot proceed" and has no TOTP step, so a
  user in an MFA-required group cannot use the mobile app until that step exists — the same
  limitation it has today for enrolled users, now decided by the group instead of by enrolment.

## 9. Migration, seeding, deployment

**Alembic `0006_groups_and_permissions`** (one revision, transactional):

1. Create `groups`, `group_permissions`, `user_groups`, `ldap_group_mappings`.
2. Alter `users`: add `username` (backfill `= lower(email)`, then `NOT NULL` + unique index on
   `lower(username)`), make `email` and `hashed_password` nullable, add `auth_source`,
   `external_id`, `ldap_dn`, `token_version`, `last_login_at`.
3. Make `tenant_memberships.role` nullable.
4. For every tenant, insert the §3 default groups and their permissions.
5. For every active membership, insert a `user_groups` row (`source = manual`) into the group
   mapped from its legacy role.
6. Downgrade drops the new tables and columns and restores `role NOT NULL` — it cannot rebuild
   roles from groups and says so in its docstring; the pilot database is backed up before upgrade
   (the runbook's existing `pg_dump` step).

The default-group seeding is a service function (`auth/groups.py: ensure_default_groups`) shared
by the migration, `POST /tenant/tenants` and `seed_bootstrap`, so a tenant created after the
migration has the same groups. `seed_admin.py` puts the bootstrap administrator in
`hospital_admin`.

**Dependencies:** `ldap3>=2.9` in `pyproject.toml`. `Dockerfile.api` is unchanged (it installs
the project). `deploy/local/.env.example` and `docker-compose.yml` gain the commented, optional
`LDAP_*` block. The VM receives the change as a git bundle, as always.

**Startup checks.** Unknown permission keys in route guards fail import. If `LDAP_URL` is set,
the API attempts one service-account bind at startup and logs the outcome — a warning, not a
refusal to boot: local sign-in must keep working while the operator fixes the directory settings.
*As built:* the bind runs in the background, so a hung domain controller never delays serving;
an unusable `LDAP_*` setting (an `LDAP_USER_FILTER` that does not compile included) is logged as
an ERROR naming the variable, never its value, and leaves LDAP off.

## 10. Testing

**Backend (pytest).** The pure-logic suite runs everywhere; DB-backed tests use the existing
`TEST_DATABASE_URL` fixture and its "database name must contain `test`" guard.

- Permission catalogue: union across groups; `require_permission("nope")` raises at definition.
- Tokens: `tv` mismatch → 401; refresh after a group change yields the new `perms`; deactivation
  makes refresh fail; `mfa_required && !mfa_verified` is 403 everywhere but the four allowed routes.
- Sign-in: by username and by e-mail, case-insensitive; unknown login and wrong password both 401
  with a bcrypt comparison performed; `NULL` hash → 401; `email` alias still accepted.
- Guards: last-admin deactivation and self-demotion → 409; deleting a group with members,
  mappings, or `is_system` → 409; `PUT .../groups` never removes `ldap` rows.
- Migration: on a database seeded with one member per legacy role, `0006` yields exactly one
  `user_groups` row per membership in the expected group, and every tenant has the 11 defaults.
  The migration's frozen defaults are pinned to a snapshot in the test file, not to the live
  defaults, so a later change to the defaults never asks anyone to edit a released migration.
- LDAP with `FakeDirectory`: bind ok → tokens + profile update; bad password → 401; unavailable →
  503 and an audit line; disabled in AD → 401 with `is_active` unchanged; mapping sync adds and
  removes `ldap` rows and leaves `manual` rows; import is idempotent and reports `skipped`;
  search-filter escaping for a query containing `*`, `(`, `\`.
- `@requires_ldap` integration test (skipped unless `LDAP_TEST_URL`, `LDAP_TEST_BIND_DN`,
  `LDAP_TEST_BIND_PASSWORD`, `LDAP_TEST_BASE_DN` are set): service-account bind, a search, and a
  deliberately failed user bind against the hospital directory. Read-only; run by hand on the VM.
  *As built:* the failed bind is made as the service account, never a clinician (plan D16), and
  two more checks catch what fails silently: `pwdLastSet` and `accountExpires` are readable, and a
  member's group has the same canonical spelling in `memberOf` as in the group picker
  (`tests/test_ldap_integration.py`; recipe in `docs/EDGE-BRIDGE-LOCAL.md`).

**Frontend (Vitest).**

- `liveAuth`: `perms` parsing; no perms and no `board.view` both refuse the session.
- Navigation gating by `perms` in live mode and via the ROLE → perms table in demo mode.
- Admin actions call the expected endpoints with the expected bodies; simulation-only controls
  are absent in live mode; the AD panel is absent when `configured` is false.
- MFA: `requires_mfa` + `mfa_enrolled=false` shows the setup QR before the code gate.

## 11. Delivery sequencing

**Plan 1 — RBAC (usable alone):** §1, §2, §3, §4 (without the LDAP branch), §5, §6 (without
`/admin/ldap/*`), §8 (without the AD panel), §9 (migration, seeding), §10 (all but the LDAP
cases). After Plan 1 the pilot has real user and group management, permission-guarded routes, MFA
by group, and token-version invalidation.

**Plan 2 — LDAP/AD:** §7 in full, the LDAP branch of §4, `/admin/ldap/*`, the AD panel in §8,
the `LDAP_*` configuration in §9, and the LDAP tests in §10.

## Out of scope (named, not forgotten)

- Unit-scoped visibility (a nurse seeing only her unit's patients).
- Kerberos/SPNEGO single sign-on; SAML/OIDC through ADFS or Entra.
- Scheduled AD synchronisation and automatic off-boarding of accounts disabled in AD.
- The invitation flow, quick PINs and per-user MFA overrides that exist only in the simulation.
- Login rate limiting (bcrypt runs in the thread pool and bounds throughput; a per-account lockout
  would let anyone lock a nurse out by typing her username, so it needs its own design). TOTP
  verification IS limited in Plan 1: 5 wrong codes lock that user's verification for 5 minutes and
  a used code cannot be replayed — without it, the password alone reached the MFA-protected groups
  in minutes. *As built (Plan 2):* AD accounts have a per-account bind throttle, and nginx a
  per-address limit on sign-in (§7 Security); local accounts and unknown logins have no
  per-account limit (roadmap, user decision 11).
- A session-revocation UI beyond deactivation.
- Dropping the PostgreSQL `userrole` enum type and the `tenant_memberships.role` column.
- The Infinity branch's `UserRole.BIOMEDICAL` reference: on merge it becomes
  `require_permission("devices.manage")`.
