# Group 1 · Wave 1A — LDAP / Active Directory backend (G1-03, G1-04) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Active Directory accounts sign in to Homunculus through the hospital directory (LDAPS), their AD groups map onto Homunculus groups at every sign-in, an AD account's refresh is re-checked against the directory and applies its current AD groups, and an administrator can search AD, import accounts and edit the AD-group mapping through `/admin/ldap/*` — backend only (the AD panel is G1-14).

**Architecture:** A pure module `auth/ldap.py` (protocol, identity types, `LDAP_*` configuration, sign-in rules, the runtime handle `app.state.ldap`); an `ldap3` implementation `auth/ldap3_directory.py` whose network calls run on worker threads under a hard deadline; `auth/ldap_sync.py` writes what a directory sign-in changes (profile, `ldap`-sourced group rows, with the local-administrator guard in a savepoint); `auth/router.py` gains the LDAP branch of sign-in and the refresh re-check, which runs the same group sync; `admin/ldap_service.py` + `admin/ldap_router.py` add the eight `/admin/ldap/*` routes under the same rights rules as the rest of `/admin`. Tests use an in-memory `FakeDirectory`; one opt-in test runs read-only against the real directory.

**Tech Stack:** Python 3.12 (image) / 3.14 (dev venv), FastAPI, SQLAlchemy 2 async + asyncpg, `ldap3>=2.9` (new), pytest + pytest-asyncio + httpx, PostgreSQL test container.

**Spec:** `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md` — §7 in full, the LDAP branch of §4, §6 guards, §9 (dependency, `LDAP_*` block, start-up check), §10 (LDAP tests). **Roadmap:** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` (G1-03, G1-04; D0 = the administrator imports AD users, no just-in-time accounts).

**Size:** 13 tasks (0–12), about 161 new tests (+3 skipped integration tests). Roughly 13–15 hours of subagent execution including review — two working days (roadmap: 5 + 5 points).

---

## Decisions (where the spec is silent or ambiguous)

**D1. `authenticate` takes the objectGUID, not the typed login.** §7's protocol line reads `authenticate(login, password)`, but §7 sign-in step 1 says the service account searches by `objectGUID = external_id`, so that an account renamed or moved in AD stays the same user. The step is the more specific and security-relevant text, so the protocol here is `authenticate(external_id, password)`. The directory is never searched by a typed name at sign-in; the typed login only selects a local row (D2).

**D2. Typed login → account.** `normalize_login`, then: (1) `users.username` or `users.email`, as today — the import stores the sAMAccountName lower-cased as `username` and `mail` as `email`; (2) if nothing matched, `DOMAIN\name` → `name` and a UPN `name@suffix` → `name`, each tried as the username of an `auth_source = ldap` account only (a local account is never reached that way). After the bind, the typed login must equal, case-insensitively, one of the account's attributes that `LDAP_LOGIN_ATTRS` allows (`sAMAccountName`, typed bare or with any `DOMAIN\`; `userPrincipalName`; `mail`), so an operator can switch a form off. One domain per deployment: the `DOMAIN\` part is not checked. A UPN whose prefix differs from the sAMAccountName is not found; that user signs in with the sAMAccountName or the mail.

**D3. objectGUID ↔ `external_id`.** Stored as `str(uuid.UUID(bytes_le=raw))` — the lower-case hyphenated form AD's own tools print — in the existing `String(64)` column. Filters receive the 16 raw bytes, each escaped `\xx`. API input (`external_ids`) is validated as a UUID and canonicalised the same way.

**D4. Nested groups.** `LDAP_NESTED_GROUPS=1` (default): after the account is found, one more search under `LDAP_BASE_DN`, `(&(objectClass=group)(member:1.2.840.113556.1.4.1941:=<escaped DN>))`, at most 1 000 groups. A reply that hits that limit is an error (503), never a silently truncated list — a truncated list would make the sync remove mapped groups. `0`: the direct `memberOf` values.

**D5. The by-GUID lookup applies `LDAP_USER_FILTER`.** `(&<LDAP_USER_FILTER>(objectGUID=…))`, so whatever the operator's filter excludes (disabled accounts by default, or anyone outside a required OU or group) cannot sign in or refresh. The `ACCOUNTDISABLE` bit is still checked on the entry, for a custom filter that does not exclude disabled accounts. A disabled account is returned without a bind and refused with the reason `directory_disabled` — a fourth `login.fail` reason next to §4's three.

**D6. Timeouts stay under the dashboard's 15 s.** `LDAP_TIMEOUT_S` (default 5, allowed 1–10) is the socket connect and receive timeout of each LDAP operation. One directory call (service bind + search [+ group search] [+ user bind]) is cut off after `min(2 × LDAP_TIMEOUT_S, 12)` s → `LdapUnavailable("timeout")` → 503. At most 8 directory calls run at once, each on a worker thread (`asyncio.to_thread`).

**D7. The database connection is released during directory I/O at sign-in and refresh.** Both are frequent and concurrent at shift change; a slow domain controller must not pin the connection pool (and with it the board). The route reads what it needs, rolls back (it has written nothing), asks the directory, then re-reads the account — which also catches a deactivation made meanwhile. Admin search and import keep their session (rare, administrator-only).

**D8. A deactivated account is refused before the directory is asked** (reason `inactive`): no bind against AD for an account Homunculus has switched off, so no AD lockout count. An empty password is refused before any directory call too (an empty simple bind is an *anonymous* bind in LDAP, and `ldap3` raises on it — that would otherwise surface as a 503).

**D9. Refresh re-check.** `pwdLastSet` (a FILETIME) is compared with the refresh token's `iat` in whole seconds: later → 401 `directory_password_changed`; `0` ("must change at next logon", which an AD password reset usually sets) → 401; absent → no opinion. Disabled → 401; not found (deleted, moved out of `LDAP_BASE_DN`, excluded by the filter) → 401. When the account passes, the refresh runs the same group sync as sign-in (`sync_ldap_groups`: same tenant, lock before the savepoint, `ldap.sync.guarded`, actor `ldap-sync`; the token version moves only when the set changed) and only then mints the tokens, so the refreshed token already reflects an AD-side removal or addition — within one access-token lifetime, not at the next sign-in (controller decision, fail-closed; closes gap 5). The profile (step 4) is not re-copied at refresh. Unreachable **or not configured** → the refresh proceeds with no sync and `refresh.directory_unavailable` is audited (the §4 outage rule: open sessions continue; to cut AD sessions, deactivate the accounts). D7 holds: the connection is released during the directory call and the account re-read after it.

**D10. Group sync scope and mechanics.** The sync runs at sign-in and at refresh (D9), in the account's session tenant (`tenant_of_user`): an AD account is imported into one tenant, and a second import of it anywhere is `skipped: exists`. DNs compare lower-cased (`ldap_group_mappings.ad_group_dn` is stored lower-case). When there is something to change, the tenant admin lock is taken and the difference recomputed under it (a mapping deleted meanwhile is not re-applied). The lock is taken BEFORE the savepoint, because a lock taken inside a savepoint is released when the savepoint is rolled back. Removals are one Core `DELETE` inside the savepoint, so a rollback leaves no stale ORM state; on `count_admins == 0` the savepoint is rolled back, `ldap.sync.guarded` is audited, and the profile update (flushed before the savepoint) stays. `count_admins` already counts LOCAL administrators only (Plan 1, `auth/groups.py:171-202`), so this guard can trip only on hand-made data (a local account holding `hospital_admin` through an `ldap` row). It is kept as defence in depth, as the spec asks.

**D11. Profile update (step 4).** `full_name ← displayName` when present; `email ← mail`, lower-cased, cleared when AD has none, left unchanged when another account already uses that value as its username or e-mail (a sign-in must never fail on a unique constraint); `ldap_dn ← DN`. `username` is not changed (spec).

**D12. Import.** One request carries at most 50 ids. Ids already in `users.external_id` are `skipped: exists` without a directory call; the others are fetched concurrently BEFORE the tenant lock is taken, and a directory failure is a 503 with nothing written. Then, under the lock: disabled → `skipped: disabled`; a sAMAccountName that, lower-cased, is already someone's username or e-mail → `skipped: login_taken`; a `mail` already in use is dropped (the account is created without an e-mail). The mapped groups and `extra_group_ids` must each be within the caller's rights (403, the whole request rolled back). One `ldap.import` audit row per created account.

**D13. Mappings.** The DN is stored `strip().lower()`. A group of another tenant in the body is 422 (as `_grantable` answers); a duplicate is 409. Creating a mapping changes nobody now: it applies at each user's next sign-in or token refresh (D9), and at import. Deleting one removes, at once, every `ldap`-sourced row of that group in the tenant and bumps those users' token versions (their next request refreshes without the right) — also for users entitled to the group through another mapping, who get it back at their next sign-in or refresh. That is the fail-closed choice: a right nobody can trace to a mapping does not linger. The deletion needs the group and every such member within the caller's rights, then runs `count_admins`.

**D14. `/admin/ldap/status` answers when LDAP is off** (200, `configured: false`): the panel needs it to hide itself. Every other `/admin/ldap/*` route is 409 `Dizin yapılandırılmamış`; a caller without `users.manage` gets 403 first, configured or not. `POST /admin/ldap/test` answers 200 `{ok, reason, checked_at}` either way; `reason` is a fixed code (`unreachable`, `timeout`, `tls`, `service_bind_rejected`, `protocol`). The last outcome is kept in memory for `status`.

**D15. TLS and configuration errors.** `ldaps://` is verified (`CERT_REQUIRED`, host name checked by `ldap3`) against `LDAP_CA_CERT`, or the system store when it is unset. `LDAP_ALLOW_INSECURE=1` permits `ldap://` and, only when no `LDAP_CA_CERT` is given, an unverified `ldaps://`; the API logs a WARNING at start. An unusable `LDAP_*` configuration (bad URL, missing bind DN, password or base DN, a CA path that is not a file, a timeout out of range) is logged as an ERROR and LDAP stays OFF — the API still boots (spec §9). The start-up service bind runs in the background, so a hung DC never delays serving local sign-ins.

**D16. The integration test's failed bind is made as the service account**, never as a clinician: a failed bind counts toward that account's AD lockout, and a test must not move a nurse's counter.

**D17. Search.** `(&<LDAP_USER_FILTER>(|(sAMAccountName=*q*)(displayName=*q*)(userPrincipalName=*q*)(mail=*q*)))`, `q` 2–64 characters, at most 50 rows; a result row carries no group list.

## Uygulamada değişenler / As built

The task bodies below are left as written; seven review fix batches (F1 `08ee940..33f226d`, F2 `a55a3d4..dabd690`, F3 `4cdc8aa..daa8fe2`, F4 `adeab76..f4d8647`, F5 `f10f362..a941bd9`, F6 `56341d7..efd3602`, F7 the commits after `efd3602`) changed these decisions. The code, the spec (marked *As built*) and the runbook (`docs/EDGE-BRIDGE-LOCAL.md`) describe the result.

- **D6** — no `asyncio.to_thread` and no semaphore: the directory's own 8-thread pool is the cap, and the deadline covers the wait for a thread (`386f4f9`); the receive timeout is an int, any library failure a 503 (`08ee940`). Administration shares one admin lane of 3 places, so sign-ins keep 5 threads (`67cf993`); a lane place is awaited at most the deadline, an admin call answers within 2 × the deadline, one import runs at most 2 lookups (`f10f362`); the lane is a `BoundedSemaphore` (`540cdfe`).
- **D7** — extended to administration: test, search, groups and import release the database connection before asking the directory (`f10f362`); a refused sign-in waits out its floor without one (`3f9184f`).
- **D9** — the refresh runs its database checks before the directory (`b624363`); it goes on unsynced only for `unreachable`, `timeout`, `tls`, `service_bind_rejected` (or LDAP off), any other directory error is 503 `refresh.directory_error` (`5c56cee`); an account past `accountExpires` is refused at sign-in and at refresh, `directory_expired` (`42547cd`).
- **D10** — the guard refuses only a removal from some local administrators to none (`a55a3d4`); the sync runs before the profile is written (lock order, `969acb0`); DNs are stored and compared in one canonical spelling, `canonical_dn`, not lower-cased (`b2d48bf`; idempotent `d60e981`, ASCII-only case folding `fb0033b`, cached `dd7a0a4`).
- **D11** — an AD mail taken by a concurrent sign-in is not copied, the sign-in still succeeds (savepoint, `eebd38a`).
- **D12** — skip codes `expired` (`fa9d289`) and `invalid_login` (`be341a1`); each account inserted in its own savepoint, so an account another tenant imports at the same moment is skipped, not the whole batch (`8c16db3`, `c53cc96`); the answer and the audit rows come from what was written, before the commit (`34394ff`); lookups go through the admin lane, 2 at a time, without a database connection (`f10f362`); a cancelled import stays cancelled (`04669be`).
- **D13** — creating or deleting a mapping needs the whole catalogue, 403 `MAPPING_ADMIN_ONLY` (`adeab76`, `36a73b8`); the DN is stored canonical and another spelling is the 409 duplicate (`b2d48bf`); deleting is refused only from some local administrators to none (`826fe26`).
- **D17** — `q` is trimmed before its length is checked (`e0f3749`).
- **Security rules (spec §7, Security; §4)** — per-account AD bind throttle, 3 failed binds → 429 (`cf2e00c`, `33f226d`), counted in runs that end only after 15 minutes with no failed bind, as AD counts (F6 `a1dac30`), counting only a password that reached the directory (`4cdc8aa`); every AD 401 pays the unknown login's dummy bcrypt (`bf57e2b`) and every 401 answers no sooner than 0.5 s (`0839bb9`); an administrator's unlock (`3c12c09`) with a reason (one line, a letter or digit, no invisible formatting, F6 `e7c1913`), once per run, not for shared or platform accounts (`a497561`, `a941bd9`, `a1dac30`); nginx limits `/auth/login` per address, 10/min + burst 10, JSON 429 with `Retry-After` (`cff32e4`, `a9c30f8`, `0c7476e`, `31bb5b5`); a bad `LDAP_*` setting never stops the API or echoes a secret, `LDAP_USER_FILTER` compiled at start-up (`962abdf`).
- **F7 (the final Wave 1A review)** — a right password ends the run only for the failures recorded before it began (`FailureChain.begin` hands out a `Ticket`; the ones recorded while it was checked stay counted, unlock spent if it was); a bind cut off at its deadline once the password had been sent is dated one deadline later (`LdapUnavailable.bind_pending_s`), and the bind request as the account is sent only once its connection is open; passwords reach `ldap3` as UTF-8 bytes (no SASLprep); production logs the `homunculus` logger at INFO, and the runbook checks `GET /admin/ldap/status` first; `LDAP_ALLOW_INSECURE=1` keeps LDAP off in production; `.dockerignore` excludes `.db` files and bytecode at any depth; the unlock's audit row says `failed`, `allowed` (3 or 6) and `granted`, and its 409 the run's logic; a TLS refusal is tested on a real connection. A restart within 15 minutes of failed binds can double the per-run bound (documented, not changed).
- **Task 12** — the integration test has five checks (adds `pwdLastSet`/`accountExpires` readable and one canonical DN spelling in the picker and `memberOf`); the runbook, spec, guide and roadmap follow the code above, not the text of Task 12.

## Spec gaps and conflicts found while planning

1. **Protocol vs flow (→ D1).** Spec §7 line 406 `authenticate(login, password)` conflicts with §7 sign-in step 1 (lines 438–439, search by objectGUID). The plan follows step 1; Task 12 amends the spec line.
2. **`pwdLastSet` is not in `LdapIdentity`** (§7 lines 413–414), yet the refresh re-check (lines 446–451) needs it. Added as `pwd_last_set`.
3. **`/admin/ldap/status` vs "every `/admin/ldap/*` is 409 when off"** (§7 line 426 vs line 464 and §8's "the AD panel renders only when `ldapStatus().configured` is true"). Status answers 200 `configured: false` (→ D14).
4. **The "Plan 2 tightening" of the §6 guard (§7 lines 492–495) is already in the merged code:** `count_admins` counts only `auth_source = local` accounts with a password (`auth/groups.py:196`), tested by `tests/test_admin_api.py:851`. Consequence: the sign-in sync's guard (§7 step 5) can trip only on hand-made data — kept as defence in depth (→ D10). Nothing to tighten; G1-04's "local-admin guard" work is applying it to the new removal paths (sync, mapping delete).
5. **AD group changes reached Homunculus only at the next sign-in — RESOLVED by amendment.** The spec runs the sync at sign-in only; a refresh token lives 7 days (`auth/jwt.py:18`), so a clinician removed from an AD group would have kept that mapping's rights for up to a week. Controller decision (fail-closed): the refresh, which already reads the account from AD, runs the same sync (D9, Task 7), so a change in AD takes effect within one access-token lifetime (60 min). Task 12 records this in the spec's refresh paragraph.
6. **What deleting or creating a mapping does to existing rows is unspecified** (§7 "Import and mapping"). Decided in D13 (delete: immediate, fail-closed; create: next sign-in or refresh).
7. **An AD rename is not followed.** Step 4 updates name, e-mail and DN but not `username`, and no admin route renames: after an AD rename the old sAMAccountName stays the Homunculus username, and the new one cannot be typed (UPN or mail still work when they name the account). A follow-up: Task 12 records it in the roadmap's open items, target Grup 4.
8. **Mapping uniqueness.** §1 says unique `(tenant_id, lower(ad_group_dn), group_id)`; the code has a plain unique `(tenant_id, ad_group_dn, group_id)` (`auth/models.py:215`, migration `0010:240`) and relies on writers lower-casing. The plan's only writer does (`normalise_dn`), so they are equivalent in practice.
9. **A fourth `login.fail` reason**, `directory_disabled` (§4 lists three) — D5.
10. **Refresh after an outage.** Comparing `pwdLastSet` with the refresh token's `iat` (spec wording) misses a password changed while the directory was down at the next refresh (the new token's `iat` moves past it). Accepted with the §4 outage rule; noted for the record.

---

## Ground rules for every task

- Work only in the worktree `/c/tmp/homunculus-g1` (branch `feat/canli-tasarim`). Never touch `/c/Users/User/Desktop/Project/Homunculus AI`, the user's main checkout.
- Shell: Git Bash. Every backend command runs from `homunculus-engine/` with `PYTHONPATH=src` (the venv's editable install points at the main checkout; `PYTHONPATH=src` makes Python import the worktree):

  ```bash
  cd /c/tmp/homunculus-g1/homunculus-engine
  export PY="/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe"
  export TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test
  ```
- DB tests need the container: `docker start homunculus-test-pg` (if `docker ps` cannot reach the daemon, start Docker Desktop first). Without `TEST_DATABASE_URL` the DB tests are skipped, not failed — a green run that skipped them proves nothing about Tasks 5–7 and 9–11. **Never export `DATABASE_URL`** (prodserver would read it as production and exit on the PHI-key check).
- The venv is shared with the main checkout. Task 0 installs `ldap3` into it; that is additive (nothing in the main checkout imports it).
- Tests in this repo: DB tests carry `pytestmark = [pytest.mark.asyncio, requires_db]`, drive the app through `httpx.ASGITransport` on the test's event loop, and give every request its own session (`async_sessionmaker(db_session.bind, expire_on_commit=False)`), as `tests/test_admin_api.py:73-87` does. Tokens are minted with `build_context` + `issue_tokens` (`tests/signed_in.py::bearer`). Audit rows are read from `app.state.audit.records(...)`.
- Commit after each task. Every commit message ends with:

  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  ```

---

## File map

**Create**

| File | Responsibility |
|---|---|
| `homunculus-engine/src/homunculus/auth/ldap.py` | Protocol `LdapDirectory`; `LdapIdentity`, `LdapGroup`, `LdapUnavailable`, `LdapConfigError`; `LdapConfig` + `load_ldap_config(env)`; pure rules (GUID form, `ACCOUNTDISABLE`, `pwdLastSet`, `login_matches`); `LdapRuntime` (= `app.state.ldap`), `get_ldap`, `check_directory_at_startup`. No network, no `ldap3`. |
| `homunculus-engine/src/homunculus/auth/ldap3_directory.py` | `Ldap3Directory` over `ldap3`: filters (`escape_filter_chars`), raw-entry parsing, failure → reason, TLS settings, worker threads + deadline; `ldap_from_env()` for production. |
| `homunculus-engine/src/homunculus/auth/ldap_sync.py` | What a directory sign-in writes: `apply_directory_profile`, `mapped_group_ids`, `sync_ldap_groups` (savepoint + local-admin guard), `login_in_use`. |
| `homunculus-engine/src/homunculus/admin/ldap_service.py` | `/admin/ldap` logic: `imported_ids`, `import_users`, `list_mappings`, `create_mapping`, `delete_mapping`. |
| `homunculus-engine/src/homunculus/admin/ldap_router.py` | The eight `/admin/ldap/*` routes. |
| `homunculus-engine/tests/fake_directory.py` | `FakeDirectory`, `person`, `group_dn`, `runtime`; DB helpers `ad_world`, `add_mapping`, `add_directory_account`, `fresh_user`; `ad_client`, `audit_events`. |
| `homunculus-engine/tests/test_ldap_rules.py` | Configuration and pure rules. |
| `homunculus-engine/tests/test_ldap3_directory.py` | Filters, parsing, failures, TLS; the class over scripted connections; `ldap_from_env`. |
| `homunculus-engine/tests/test_ldap_runtime.py` | `FakeDirectory` contract, `LdapRuntime.test`, the start-up check function. |
| `homunculus-engine/tests/test_ldap_sync.py` | Profile + group sync against Postgres. |
| `homunculus-engine/tests/test_auth_ldap_login.py` | AD sign-in end to end. |
| `homunculus-engine/tests/test_auth_ldap_refresh.py` | Refresh re-check end to end. |
| `homunculus-engine/tests/test_ldap_startup.py` | Lifespan start-up bind; production wiring. |
| `homunculus-engine/tests/test_admin_ldap_api.py` | `/admin/ldap/*` end to end. |
| `homunculus-engine/tests/test_ldap_integration.py` | `@requires_ldap`, read-only, real directory. |

**Modify** (line numbers at `fd15f04`)

| File | Change |
|---|---|
| `homunculus-engine/pyproject.toml:6-20` | `ldap3>=2.9` dependency (Task 1). |
| `homunculus-engine/src/homunculus/auth/service.py:29` (import), after `:96` (end of `find_user_by_login`) | `AUTH_LDAP` import; `directory_login_alternative`, `find_user_for_sign_in` (Task 6). |
| `homunculus-engine/src/homunculus/auth/router.py:21-39` (imports), `:54-98` (`_login_failed`, `login`), `:165-200` (`refresh_token`) | LDAP sign-in branch (Task 6), refresh re-check with the group sync (Task 7). Uses `tenant_of_user` (`auth/groups.py:205`), `build_context`/`issue_tokens`/`mark_login` (`auth/service.py:131,155,180`). |
| `homunculus-engine/src/homunculus/api/app.py:17-20,53` (imports), `:111-138` (`create_app` signature/docstring), `:238-249` (lifespan), `:276-298` (routers, `app.state`) | `ldap` kwarg → `app.state.ldap` (Task 6); background start-up bind (Task 8); `/admin/ldap` router (Task 9). |
| `homunculus-engine/src/homunculus/api/prodserver.py:7-12,29-39,407-415` | `ldap=ldap_from_env()` (Task 8). |
| `homunculus-engine/src/homunculus/admin/schemas.py` (end of file, `:172`) | LDAP request/response models (Tasks 9–11). |
| `homunculus-engine/tests/test_route_permissions.py:34-39,99-111,196-197` | The `/admin/ldap/*` rows; route count 45 → 49 → 50 → 53 (Tasks 9–11). |
| `homunculus-engine/tests/test_route_inventory.py:48-51` | `/admin/ldap/status` is walked (Task 9). |
| `homunculus-engine/tests/conftest.py:27-30` | `requires_ldap` marker (Task 12). |
| `deploy/local/.env.example` (end), `deploy/local/docker-compose.yml:66-81` | Commented, optional `LDAP_*` block; `ldap-ca/` mount (Task 8). |
| `.gitignore:25-30` | `deploy/local/ldap-ca/` (Task 8). |
| `docs/EDGE-BRIDGE-LOCAL.md:207` (before "Backups") | Runbook section "Active Directory sign-in (optional)" (Task 12). |
| `docs/homunculus-rehber-TR.md:313,420` | AD entry in the identity glossary (Task 12). |
| `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md:406,413-414,450-451,464,492-495` | Record D1, `pwd_last_set`, the sync at refresh (D9), D14, the guard already in Plan 1 (Task 12). |
| `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md:79-80,248` | G1-03/G1-04 status; the AD-rename gap as an open item, target Grup 4 (Task 12). |

Read, reused, not changed: `auth/groups.py` (`groups_of` :65, `bump_user` :93, `set_manual_groups` :107, `lock_admin_guard` :162, `count_admins` :171 — local administrators only since Plan 1, tested at `tests/test_admin_api.py:851`), `auth/models.py` (`AUTH_LDAP` :25, `SOURCE_LDAP` :27, `LdapGroupMapping` :195-216, unique `(tenant_id, ad_group_dn, group_id)`), `admin/service.py` (`serialise` :115, `group_rights` :151, `_within` :163, `_rights_by_user` :169, `_union` :188, `_grantable` :208, `_flush` :237, `get_group` :259, `get_tenant_user` :402, `LAST_ADMIN` :78, `UNKNOWN_GROUP` :82, `LOGIN_TAKEN` :84), `admin/router.py` (`_user_out` :74, `_audit` :86, `_run` :103, `_begin` :112), `auth/audit.py::append_audit`, `tests/signed_in.py` (`add_user`, `bearer`), `tests/test_nginx_routes.py` (already proxies `/admin`, which covers `/admin/ldap`).

---

### Task 0: Baseline, plan commit, `ldap3` in the venv

**Files:** none changed (this plan file is committed).

- [ ] **Step 1: Confirm the worktree, branch and head**

```bash
cd /c/tmp/homunculus-g1
git status --short --branch | head -3
git log --oneline -1
```
Expected: `## feat/canli-tasarim`; untracked only plan files under `docs/superpowers/plans/` (this one, and possibly the parallel Wave 1B plan — leave that one alone); head `fd15f04 docs(plan): Wave 0 closed — …` or a later docs-only commit.

- [ ] **Step 2: Prove Python imports the worktree**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -c "import homunculus; print(homunculus.__file__)"
```
Expected: a path under `C:\tmp\homunculus-g1\homunculus-engine\src`. If it names the main checkout, STOP.

- [ ] **Step 3: Install `ldap3` into the shared venv**

```bash
"$PY" -m pip install "ldap3>=2.9"
"$PY" -c "import ldap3; from ldap3 import Server, Connection, Tls; print(ldap3.__version__)"
```
Expected: `Successfully installed ldap3-2.9.1` (its `pyasn1` dependency is already present), then `2.9.1`. `ldap3` 2.9.1 imports cleanly on the venv's Python 3.14 (checked against an unpacked copy while writing this plan); the image runs 3.12.

- [ ] **Step 4: Record the baseline**

```bash
docker start homunculus-test-pg
PYTHONPATH=src "$PY" -m pytest -q -p no:cacheprovider 2>&1 | tail -3
```
Expected: `1670 passed, 1 skipped` (the Wave 0 record). Write the exact numbers into Task 1's commit message.

- [ ] **Step 5: Commit the plan**

```bash
cd /c/tmp/homunculus-g1
git add docs/superpowers/plans/2026-10-03-g1-dalga1a-ldap-arka-uc.md
git commit -m "docs(plan): G1 Wave 1A — LDAP/AD backend (G1-03, G1-04)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 1 (G1-03a): `auth/ldap.py` — protocol, configuration, pure rules; `ldap3` dependency

**Files:**
- Create: `homunculus-engine/src/homunculus/auth/ldap.py`
- Create: `homunculus-engine/tests/test_ldap_rules.py`
- Modify: `homunculus-engine/pyproject.toml:19` (after the `uvicorn[standard]` line)

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_ldap_rules.py`:

```python
"""The LDAP configuration and the pure rules of a directory sign-in (spec §7): the LDAP_*
environment, objectGUID's string form, the ACCOUNTDISABLE bit, pwdLastSet against a token, and
which typed login forms name an account. No network, no database."""
from __future__ import annotations

import pytest

from homunculus.auth.ldap import (
    DEFAULT_USER_FILTER, LOGIN_ATTRS, LdapConfigError, LdapIdentity, canonical_guid,
    filetime_to_unix, guid_from_bytes, guid_to_bytes, is_disabled, load_ldap_config,
    login_matches, password_changed_since,
)

BASE = {
    "LDAP_URL": "ldaps://dc1.hastane.local",
    "LDAP_BIND_DN": "CN=svc-homunculus,OU=Servis,DC=hastane,DC=local",
    "LDAP_BIND_PASSWORD": "Servis-Parolasi-7",
    "LDAP_BASE_DN": "DC=hastane,DC=local",
}
GUID = "6b29fc40-ca47-1067-b31d-00dd010662da"


def _env(**changes: str | None) -> dict[str, str]:
    env = dict(BASE)
    for key, value in changes.items():
        if value is None:
            env.pop(key, None)
        else:
            env[key] = value
    return env


# ---------------------------------------------------------------- configuration
def test_no_url_means_the_directory_is_off():
    assert load_ldap_config({}) is None
    assert load_ldap_config({"LDAP_URL": "   "}) is None


def test_the_defaults():
    config = load_ldap_config(BASE)
    assert (config.host, config.port, config.use_ssl) == ("dc1.hastane.local", 636, True)
    assert config.ca_cert is None and config.allow_insecure is False
    assert config.user_filter == DEFAULT_USER_FILTER
    assert config.login_attrs == LOGIN_ATTRS
    assert config.nested_groups is True
    assert (config.timeout_s, config.deadline_s) == (5.0, 10.0)


def test_an_explicit_port_and_options(tmp_path):
    ca = tmp_path / "ca.pem"
    ca.write_text("-----BEGIN CERTIFICATE-----\n")
    config = load_ldap_config(_env(
        LDAP_URL="ldaps://DC1.hastane.local:3269", LDAP_CA_CERT=str(ca),
        LDAP_NESTED_GROUPS="0", LDAP_TIMEOUT_S="2", LDAP_LOGIN_ATTRS="sAMAccountName, mail"))
    assert (config.host, config.port) == ("dc1.hastane.local", 3269)
    assert config.ca_cert == str(ca) and config.nested_groups is False
    assert (config.timeout_s, config.deadline_s) == (2.0, 4.0)
    assert config.login_attrs == ("samaccountname", "mail")


def test_the_deadline_never_reaches_the_dashboards_15_seconds():
    assert load_ldap_config(_env(LDAP_TIMEOUT_S="10")).deadline_s == 12.0


def test_plain_ldap_needs_the_insecure_flag():
    with pytest.raises(LdapConfigError, match="LDAP_ALLOW_INSECURE"):
        load_ldap_config(_env(LDAP_URL="ldap://dc1.hastane.local"))
    config = load_ldap_config(_env(LDAP_URL="ldap://dc1.hastane.local", LDAP_ALLOW_INSECURE="1"))
    assert (config.use_ssl, config.port, config.allow_insecure) == (False, 389, True)


@pytest.mark.parametrize("url", [
    "https://dc1.hastane.local", "ldaps://", "ldaps://dc1.hastane.local/DC=x",
    "ldaps://dc1.hastane.local:99999", "ldaps://dc1.hastane.local?x=1",
])
def test_a_url_that_is_not_just_a_host_is_refused(url):
    with pytest.raises(LdapConfigError, match="LDAP_URL"):
        load_ldap_config(_env(LDAP_URL=url))


def test_credentials_in_the_url_are_refused_and_never_echoed():
    with pytest.raises(LdapConfigError) as err:
        load_ldap_config(_env(LDAP_URL="ldaps://svc:Gizli-Url-Parola@dc1.hastane.local"))
    assert "Gizli-Url-Parola" not in str(err.value)


@pytest.mark.parametrize("name", ["LDAP_BIND_DN", "LDAP_BIND_PASSWORD", "LDAP_BASE_DN"])
def test_the_service_account_and_the_base_are_required(name):
    with pytest.raises(LdapConfigError, match=name):
        load_ldap_config(_env(**{name: None}))
    with pytest.raises(LdapConfigError, match=name):
        load_ldap_config(_env(**{name: "  "}))


def test_the_ca_certificate_must_be_a_file(tmp_path):
    with pytest.raises(LdapConfigError, match="LDAP_CA_CERT"):
        load_ldap_config(_env(LDAP_CA_CERT=str(tmp_path / "missing.pem")))
    with pytest.raises(LdapConfigError, match="LDAP_CA_CERT"):
        load_ldap_config(_env(LDAP_CA_CERT=str(tmp_path)))   # Docker's missing-file trap: a dir


@pytest.mark.parametrize("value", ["0.5", "11", "abc"])
def test_the_timeout_is_a_number_between_1_and_10_seconds(value):
    with pytest.raises(LdapConfigError, match="LDAP_TIMEOUT_S"):
        load_ldap_config(_env(LDAP_TIMEOUT_S=value))


@pytest.mark.parametrize("value", ["cn", "sAMAccountName,cn", " , "])
def test_login_attrs_name_only_the_three_login_attributes(value):
    with pytest.raises(LdapConfigError, match="LDAP_LOGIN_ATTRS"):
        load_ldap_config(_env(LDAP_LOGIN_ATTRS=value))


def test_the_user_filter_must_be_one_parenthesised_filter():
    with pytest.raises(LdapConfigError, match="LDAP_USER_FILTER"):
        load_ldap_config(_env(LDAP_USER_FILTER="objectClass=user"))
    custom = "(&(objectClass=user)(memberOf=CN=Homunculus,OU=Gruplar,DC=hastane,DC=local))"
    assert load_ldap_config(_env(LDAP_USER_FILTER=custom)).user_filter == custom


def test_a_flag_is_1_or_0():
    with pytest.raises(LdapConfigError, match="LDAP_NESTED_GROUPS"):
        load_ldap_config(_env(LDAP_NESTED_GROUPS="belki"))


def test_the_service_password_never_appears_in_a_repr():
    assert "Servis-Parolasi-7" not in repr(load_ldap_config(BASE))


# ---------------------------------------------------------------- objectGUID
def test_objectguid_bytes_read_as_ads_own_tools_print_them():
    raw = bytes.fromhex("40fc296b47ca6710b31d00dd010662da")    # as AD stores it
    assert guid_from_bytes(raw) == GUID
    assert guid_to_bytes(GUID) == raw
    assert canonical_guid("{6B29FC40-CA47-1067-B31D-00DD010662DA}") == GUID


def test_a_guid_is_16_bytes_or_a_uuid():
    with pytest.raises(ValueError):
        guid_from_bytes(b"\x01" * 15)
    with pytest.raises(ValueError):
        guid_to_bytes("not-a-guid")


# ---------------------------------------------------------------- userAccountControl, pwdLastSet
@pytest.mark.parametrize("uac, disabled", [
    (512, False), (514, True), (66048, False), (66050, True), (None, False),
])
def test_the_accountdisable_bit(uac, disabled):
    assert is_disabled(uac) is disabled


def _filetime(unix_seconds: int, ticks: int = 0) -> int:
    return (unix_seconds + 11_644_473_600) * 10_000_000 + ticks


def test_filetime_counts_from_1601():
    assert filetime_to_unix(116_444_736_000_000_000) == 0.0


def test_a_password_set_after_the_token_ends_the_session():
    iat = 1_790_000_000
    assert password_changed_since(_filetime(iat + 5), iat) is True
    assert password_changed_since(_filetime(iat - 5), iat) is False
    assert password_changed_since(_filetime(iat, 5_000_000), iat) is False   # the same second
    assert password_changed_since(None, iat) is False                         # not read
    assert password_changed_since(0, iat) is True                             # must change at next logon


# ---------------------------------------------------------------- typed login forms
AYSE = LdapIdentity(external_id=GUID, username="AYilmaz",
                    dn="CN=Ayşe Yılmaz,OU=Personel,DC=hastane,DC=local",
                    upn="ayilmaz@hastane.local", email="Ayse.Yilmaz@hastane.az")


@pytest.mark.parametrize("key, ok", [
    ("ayilmaz", True), ("hastane\\ayilmaz", True), ("ayilmaz@hastane.local", True),
    ("ayse.yilmaz@hastane.az", True), ("ayilmaz@baska.local", False), ("yilmaz", False),
    ("", False),
])
def test_a_login_names_the_account_in_any_allowed_form(key, ok):
    assert login_matches(key, AYSE, LOGIN_ATTRS) is ok


def test_ldap_login_attrs_switch_forms_off():
    assert login_matches("ayilmaz", AYSE, ("userprincipalname",)) is False
    assert login_matches("ayse.yilmaz@hastane.az", AYSE, ("samaccountname",)) is False
    assert login_matches("ayilmaz@hastane.local", AYSE, ("samaccountname", "mail")) is False
    assert login_matches("ayilmaz@hastane.local", AYSE, ("userprincipalname",)) is True


def test_an_account_without_upn_or_mail_answers_to_its_name_only():
    bare = LdapIdentity(external_id=GUID, username="servis", dn="CN=servis,DC=hastane,DC=local")
    assert login_matches("servis", bare, LOGIN_ATTRS) is True
    assert login_matches("servis@hastane.local", bare, LOGIN_ATTRS) is False
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest tests/test_ldap_rules.py -q -p no:cacheprovider
```
Expected: collection error, `ModuleNotFoundError: No module named 'homunculus.auth.ldap'`.

- [ ] **Step 3: Write `auth/ldap.py`**

Create `homunculus-engine/src/homunculus/auth/ldap.py`:

```python
"""The directory (LDAP / Active Directory) as Homunculus sees it — spec §7.

  LdapDirectory    the protocol: authenticate, find_by_external_id, search_users, search_groups,
                   test_connection. `auth/ldap3_directory.py` implements it against a real
                   server, `tests/fake_directory.py` from memory.
  LdapIdentity     one AD account as the directory reports it; LdapGroup one AD group.
  LdapUnavailable  the directory did not answer. Sign-in turns it into 503, never 401.
  LdapConfig       the LDAP_* environment, read and checked by `load_ldap_config`.
  LdapRuntime      what the app holds as `app.state.ldap` (None = LDAP off): the directory, its
                   host, the login forms it accepts, the outcome of the last connection test.

The pure rules of a directory sign-in live here too: objectGUID's string form, the
ACCOUNTDISABLE bit, pwdLastSet against a token's issue time, and which typed login forms an
account answers to. Nothing here talks to the network or imports `ldap3`.

The AD password a clinician types goes to one bind and is dropped: never stored, logged,
audited or cached (spec §7, Security). The service account's password comes from the
environment only and is kept out of every repr.
"""
from __future__ import annotations

import logging
import os
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol
from urllib.parse import urlsplit

from fastapi import Request

from homunculus.auth.service import normalize_login

logger = logging.getLogger(__name__)

DIRECTORY_DOWN = "Dizin sunucusuna ulaşılamıyor"
NOT_CONFIGURED = "Dizin yapılandırılmamış"

ACCOUNTDISABLE = 0x2                    # userAccountControl bit
DEFAULT_USER_FILTER = ("(&(objectCategory=person)(objectClass=user)"
                       "(!(userAccountControl:1.2.840.113556.1.4.803:=2)))")
# The attributes a typed login may be matched against, lower-cased (LDAP_LOGIN_ATTRS).
LOGIN_ATTRS: tuple[str, ...] = ("samaccountname", "userprincipalname", "mail")
DEFAULT_TIMEOUT_S = 5.0
TIMEOUT_MIN_S, TIMEOUT_MAX_S = 1.0, 10.0
# One directory call never takes longer than this: under the dashboard's 15 s request timeout,
# with room for the database work around it.
DEADLINE_CAP_S = 12.0
FILETIME_TICKS_PER_S = 10_000_000
FILETIME_UNIX_OFFSET_S = 11_644_473_600   # 1601-01-01 to 1970-01-01, in seconds
_TRUE = frozenset({"1", "true", "yes", "on"})
_FALSE = frozenset({"0", "false", "no", "off"})


class LdapUnavailable(Exception):
    """The directory could not answer: unreachable, TLS refused, too slow, the service account
    refused, or a reply that makes no sense. `reason` is a fixed short code — `unreachable`,
    `timeout`, `tls`, `service_bind_rejected`, `protocol` — and never carries a credential."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class LdapConfigError(ValueError):
    """The LDAP_* environment cannot be used. The message names the variable, never its value."""


@dataclass(frozen=True)
class LdapIdentity:
    """One AD account. `external_id` is objectGUID in its string form (`guid_from_bytes`);
    `username` is sAMAccountName as AD spells it; `group_dns` are the DNs of its groups (nested
    ones included when LDAP_NESTED_GROUPS=1); `pwd_last_set` is pwdLastSet, a FILETIME — 0 when
    the account must change its password at the next logon, None when it was not read."""
    external_id: str
    username: str
    dn: str
    upn: str | None = None
    email: str | None = None
    display_name: str | None = None
    group_dns: tuple[str, ...] = ()
    disabled: bool = False
    pwd_last_set: int | None = None


@dataclass(frozen=True)
class LdapGroup:
    dn: str
    name: str


class LdapDirectory(Protocol):
    """What Homunculus asks of a directory. Every method raises LdapUnavailable when the
    directory does not answer; "no such account" and "wrong password" are answers (None)."""

    async def authenticate(self, external_id: str, password: str) -> LdapIdentity | None:
        """The account with this objectGUID, checked with ONE bind as its DN. None: not found
        (as LDAP_USER_FILTER sees it), or an empty or wrong password. A DISABLED account is
        returned as found, without a bind, so the caller can say why it refuses."""

    async def find_by_external_id(self, external_id: str) -> LdapIdentity | None:
        """The account with this objectGUID, read with the service account; None if not found."""

    async def search_users(self, query: str, limit: int = 50) -> list[LdapIdentity]:
        """Accounts whose name, display name, UPN or mail contains `query`; at most `limit`."""

    async def search_groups(self, query: str, limit: int = 50) -> list[LdapGroup]:
        """Groups whose cn contains `query`; at most `limit`."""

    async def test_connection(self) -> None:
        """Bind with the service account; raise LdapUnavailable if that fails."""


# ---------------------------------------------------------------- objectGUID
def guid_from_bytes(raw: bytes) -> str:
    """AD's 16-byte objectGUID as the string Homunculus stores in `users.external_id`: the
    lower-case hyphenated form AD's own tools print (the first three fields little-endian)."""
    if len(raw) != 16:
        raise ValueError("objectGUID must be 16 bytes")
    return str(uuid.UUID(bytes_le=bytes(raw)))


def guid_to_bytes(external_id: str) -> bytes:
    """The 16 bytes AD stores for this objectGUID string. ValueError if it is not a UUID."""
    return uuid.UUID(str(external_id)).bytes_le


def canonical_guid(value: str) -> str:
    """Any UUID spelling (braces, capitals) in the stored form."""
    return str(uuid.UUID(str(value)))


# ---------------------------------------------------------------- account state
def is_disabled(user_account_control: int | None) -> bool:
    return bool((user_account_control or 0) & ACCOUNTDISABLE)


def filetime_to_unix(filetime: int) -> float:
    """A FILETIME (100 ns ticks since 1601-01-01 UTC) in Unix seconds."""
    return filetime / FILETIME_TICKS_PER_S - FILETIME_UNIX_OFFSET_S


def password_changed_since(pwd_last_set: int | None, issued_at: int) -> bool:
    """Spec §7, refresh: was the AD password set after a token issued at `issued_at` (Unix
    seconds)? Compared in whole seconds, as `iat` is. 0 means "must change at next logon" —
    what an AD password reset usually sets — and counts as changed. None (not read): no."""
    if pwd_last_set is None:
        return False
    if pwd_last_set <= 0:
        return True
    return pwd_last_set // FILETIME_TICKS_PER_S - FILETIME_UNIX_OFFSET_S > issued_at


def login_matches(key: str, identity: LdapIdentity, attrs: Iterable[str]) -> bool:
    """Whether the typed login `key` (already `normalize_login`-ed) names this account in one of
    the forms `attrs` (LDAP_LOGIN_ATTRS) allows: `samaccountname` — typed bare or as
    `DOMAIN\\name`, the domain part unchecked (one domain per deployment) —
    `userprincipalname`, `mail`."""
    allowed = set(attrs)
    bare = key.rsplit("\\", 1)[-1]
    forms = (("samaccountname", identity.username, bare),
             ("userprincipalname", identity.upn, key),
             ("mail", identity.email, key))
    return any(attr in allowed and value and normalize_login(value) == typed
               for attr, value, typed in forms)


# ---------------------------------------------------------------- configuration
@dataclass(frozen=True)
class LdapConfig:
    """The LDAP_* settings (spec §7, Configuration), checked. Build it with `load_ldap_config`."""
    host: str
    port: int
    use_ssl: bool
    ca_cert: str | None
    allow_insecure: bool
    bind_dn: str
    bind_password: str = field(repr=False)
    base_dn: str
    user_filter: str
    login_attrs: tuple[str, ...]
    nested_groups: bool
    timeout_s: float

    @property
    def deadline_s(self) -> float:
        """The longest one directory call may take, all its LDAP operations together."""
        return min(2 * self.timeout_s, DEADLINE_CAP_S)


def _flag(env: Mapping[str, str], name: str, default: bool) -> bool:
    raw = (env.get(name) or "").strip().lower()
    if not raw:
        return default
    if raw in _TRUE:
        return True
    if raw in _FALSE:
        return False
    raise LdapConfigError(f"{name} must be 1 or 0")


def _required(env: Mapping[str, str], name: str) -> str:
    value = env.get(name) or ""
    if not value.strip():
        raise LdapConfigError(f"{name} is required when LDAP_URL is set")
    return value


def parse_login_attrs(raw: str | None) -> tuple[str, ...]:
    if raw is None or not raw.strip():
        return LOGIN_ATTRS
    attrs = tuple(dict.fromkeys(a.strip().lower() for a in raw.split(",") if a.strip()))
    if not attrs or any(a not in LOGIN_ATTRS for a in attrs):
        raise LdapConfigError(
            "LDAP_LOGIN_ATTRS may name only sAMAccountName, userPrincipalName and mail")
    return attrs


def load_ldap_config(env: Mapping[str, str]) -> LdapConfig | None:
    """The directory settings, or None when LDAP_URL is unset (LDAP off). Raises
    LdapConfigError for a setting that cannot be used; the caller logs it and keeps LDAP off —
    the API still starts (spec §9)."""
    url = (env.get("LDAP_URL") or "").strip()
    if not url:
        return None
    allow_insecure = _flag(env, "LDAP_ALLOW_INSECURE", False)
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    if scheme not in ("ldaps", "ldap"):
        raise LdapConfigError("LDAP_URL must start with ldaps://")
    if scheme == "ldap" and not allow_insecure:
        raise LdapConfigError(
            "LDAP_URL is ldap:// (plain text: AD passwords would cross the network readable); "
            "use ldaps://, or set LDAP_ALLOW_INSECURE=1 in a lab")
    try:
        port = parts.port
    except ValueError:
        raise LdapConfigError("LDAP_URL has an invalid port") from None
    if (not parts.hostname or parts.username is not None or parts.password is not None
            or parts.path not in ("", "/") or parts.query or parts.fragment):
        raise LdapConfigError("LDAP_URL must be ldaps://host[:port] and nothing else")
    ca_cert = (env.get("LDAP_CA_CERT") or "").strip() or None
    if ca_cert is not None and not os.path.isfile(ca_cert):
        raise LdapConfigError("LDAP_CA_CERT does not name a file")
    user_filter = (env.get("LDAP_USER_FILTER") or "").strip() or DEFAULT_USER_FILTER
    if not (user_filter.startswith("(") and user_filter.endswith(")")):
        raise LdapConfigError("LDAP_USER_FILTER must be one parenthesised LDAP filter")
    raw_timeout = (env.get("LDAP_TIMEOUT_S") or "").strip()
    try:
        timeout_s = float(raw_timeout) if raw_timeout else DEFAULT_TIMEOUT_S
    except ValueError:
        raise LdapConfigError("LDAP_TIMEOUT_S must be a number of seconds") from None
    if not TIMEOUT_MIN_S <= timeout_s <= TIMEOUT_MAX_S:
        raise LdapConfigError("LDAP_TIMEOUT_S must be between 1 and 10 seconds")
    return LdapConfig(
        host=parts.hostname, port=port or (636 if scheme == "ldaps" else 389),
        use_ssl=scheme == "ldaps", ca_cert=ca_cert, allow_insecure=allow_insecure,
        bind_dn=_required(env, "LDAP_BIND_DN").strip(),
        bind_password=_required(env, "LDAP_BIND_PASSWORD"),
        base_dn=_required(env, "LDAP_BASE_DN").strip(), user_filter=user_filter,
        login_attrs=parse_login_attrs(env.get("LDAP_LOGIN_ATTRS")),
        nested_groups=_flag(env, "LDAP_NESTED_GROUPS", True), timeout_s=timeout_s,
    )


# ---------------------------------------------------------------- the app's handle
@dataclass
class LdapRuntime:
    """The directory as the running app holds it (`app.state.ldap`; None when LDAP is off).
    The last connection test is kept here, in memory, for `GET /admin/ldap/status`."""
    directory: LdapDirectory
    url_host: str
    login_attrs: tuple[str, ...] = LOGIN_ATTRS
    last_test_at: datetime | None = None
    last_test_ok: bool | None = None
    last_test_reason: str | None = None

    async def test(self) -> tuple[bool, str | None]:
        """Bind with the service account now; remember and return (ok, reason)."""
        try:
            await self.directory.test_connection()
        except LdapUnavailable as exc:
            ok, reason = False, exc.reason
        else:
            ok, reason = True, None
        self.last_test_at = datetime.now(timezone.utc)
        self.last_test_ok, self.last_test_reason = ok, reason
        return ok, reason


def get_ldap(request: Request) -> LdapRuntime | None:
    """The app's directory, or None when LDAP is off. A FastAPI dependency and a plain call."""
    return getattr(request.app.state, "ldap", None)


async def check_directory_at_startup(runtime: LdapRuntime) -> None:
    """Spec §9: one service-account bind at start-up, logged. A failure is a WARNING, never a
    refusal to boot — local sign-in must keep working while the operator fixes the directory."""
    ok, reason = await runtime.test()
    if ok:
        logger.info("LDAP: service-account bind to %s succeeded", runtime.url_host)
    else:
        logger.warning(
            "LDAP: service-account bind to %s FAILED (%s). Directory accounts get 503 at "
            "sign-in until this is fixed; local accounts sign in as usual.",
            runtime.url_host, reason)
```

- [ ] **Step 4: Add the dependency**

In `homunculus-engine/pyproject.toml`, after the line `    "uvicorn[standard]>=0.30",          # ASGI server (production serving)`, add:

```toml
    "ldap3>=2.9",                       # Active Directory sign-in (pure Python; spec §7)
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
PYTHONPATH=src "$PY" -m pytest tests/test_ldap_rules.py -q -p no:cacheprovider
```
Expected: `42 passed`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add homunculus-engine/src/homunculus/auth/ldap.py homunculus-engine/tests/test_ldap_rules.py homunculus-engine/pyproject.toml
git commit -m "feat(ldap): directory protocol, LDAP_* configuration and sign-in rules (G1-03)

Baseline before this plan: <numbers from Task 0 Step 4>.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 2 (G1-03b): `ldap3_directory.py` — filters, entries, failures, TLS (pure)

**Files:**
- Create: `homunculus-engine/src/homunculus/auth/ldap3_directory.py`
- Create: `homunculus-engine/tests/test_ldap3_directory.py`

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_ldap3_directory.py`:

```python
"""`Ldap3Directory` without a server: the filters it sends, how it reads AD's entries, how it
names a failure, its TLS settings — and (Task 3) the class itself over scripted connections."""
from __future__ import annotations

import ssl
import uuid

import pytest
from ldap3 import Tls
from ldap3.core.exceptions import LDAPException, LDAPResponseTimeoutError, LDAPSocketOpenError

from homunculus.auth.ldap import DEFAULT_USER_FILTER, LdapGroup, load_ldap_config
from homunculus.auth.ldap3_directory import (
    escape_guid, failure_reason, group_search_filter, guid_lookup_filter, nested_groups_filter,
    parse_group_entry, parse_user_entry, tls_for, user_search_filter,
)

GUID = "6b29fc40-ca47-1067-b31d-00dd010662da"
GUID_ESCAPED = r"\40\fc\29\6b\47\ca\67\10\b3\1d\00\dd\01\06\62\da"
USER_DN = "CN=Ayşe Yılmaz,OU=Personel,DC=hastane,DC=local"
BASE = {
    "LDAP_URL": "ldaps://dc1.hastane.local",
    "LDAP_BIND_DN": "CN=svc-homunculus,OU=Servis,DC=hastane,DC=local",
    "LDAP_BIND_PASSWORD": "Servis-Parolasi-7",
    "LDAP_BASE_DN": "DC=hastane,DC=local",
}


# ---------------------------------------------------------------- filters
def test_every_character_that_could_reshape_a_search_filter_is_escaped():
    escaped = r"a\2a\28b\29\5cc"                       # a*(b)\c
    assert user_search_filter("(objectClass=user)", "a*(b)\\c") == (
        rf"(&(objectClass=user)(|(sAMAccountName=*{escaped}*)(displayName=*{escaped}*)"
        rf"(userPrincipalName=*{escaped}*)(mail=*{escaped}*)))")


def test_an_injection_attempt_stays_a_value():
    attempt = user_search_filter(DEFAULT_USER_FILTER, "*)(objectClass=*")
    template = user_search_filter(DEFAULT_USER_FILTER, "x")
    assert attempt.count("(") == template.count("(") and attempt.count(")") == template.count(")")
    assert r"\2a\29\28objectClass=\2a" in attempt


def test_a_group_query_is_escaped_too():
    assert group_search_filter(" YB-(Hekim) ") == r"(&(objectClass=group)(cn=*YB-\28Hekim\29*))"


def test_the_nested_membership_filter_escapes_the_dn():
    dn = r"CN=Yılmaz\, Ayşe,OU=Personel,DC=hastane,DC=local"
    assert nested_groups_filter(dn) == (
        r"(&(objectClass=group)(member:1.2.840.113556.1.4.1941:="
        r"CN=Yılmaz\5c, Ayşe,OU=Personel,DC=hastane,DC=local))")


def test_the_guid_reaches_the_filter_as_escaped_bytes():
    assert escape_guid(GUID) == GUID_ESCAPED          # \29 is ")" — harmless once escaped
    assert guid_lookup_filter(DEFAULT_USER_FILTER, GUID) == (
        f"(&{DEFAULT_USER_FILTER}(objectGUID={GUID_ESCAPED}))")
    with pytest.raises(ValueError):
        escape_guid("not-a-guid")


# ---------------------------------------------------------------- entries
def _entry(**overrides):
    raw = {
        "objectGUID": [uuid.UUID(GUID).bytes_le], "sAMAccountName": [b"AYilmaz"],
        "userPrincipalName": [b"ayilmaz@hastane.local"], "mail": [b"Ayse.Yilmaz@hastane.az"],
        "displayName": ["Ayşe Yılmaz".encode()], "userAccountControl": [b"512"],
        "pwdLastSet": [b"134044992000000000"],
        "memberOf": [b"CN=YB-Hemsire,OU=Gruplar,DC=hastane,DC=local"],
    }
    raw.update(overrides)
    return {"type": "searchResEntry", "dn": USER_DN,
            "raw_attributes": {k: v for k, v in raw.items() if v is not None}}


def test_an_ad_entry_is_read_from_its_raw_attributes():
    identity = parse_user_entry(_entry())
    assert identity.external_id == GUID and identity.username == "AYilmaz"
    assert (identity.dn, identity.upn, identity.email, identity.display_name) == (
        USER_DN, "ayilmaz@hastane.local", "Ayse.Yilmaz@hastane.az", "Ayşe Yılmaz")
    assert identity.group_dns == ("CN=YB-Hemsire,OU=Gruplar,DC=hastane,DC=local",)
    assert identity.disabled is False and identity.pwd_last_set == 134044992000000000


def test_attribute_names_are_matched_whatever_their_case():
    entry = _entry()
    lowered = {**entry,
               "raw_attributes": {k.lower(): v for k, v in entry["raw_attributes"].items()}}
    assert parse_user_entry(lowered) == parse_user_entry(entry)


def test_the_accountdisable_bit_marks_the_account_disabled():
    assert parse_user_entry(_entry(userAccountControl=[b"514"])).disabled is True


@pytest.mark.parametrize("overrides", [
    {"objectGUID": None}, {"objectGUID": [b"\x01" * 15]},
    {"sAMAccountName": None}, {"sAMAccountName": [b"  "]},
])
def test_an_entry_without_a_guid_or_a_name_is_not_an_account(overrides):
    assert parse_user_entry(_entry(**overrides)) is None


def test_a_group_entry():
    entry = {"dn": "CN=YB-Hekim,OU=Gruplar,DC=hastane,DC=local",
             "raw_attributes": {"cn": [b"YB-Hekim"]}}
    assert parse_group_entry(entry) == LdapGroup(entry["dn"], "YB-Hekim")
    assert parse_group_entry({"dn": "CN=X,DC=y", "raw_attributes": {}}).name == "CN=X,DC=y"
    assert parse_group_entry({"dn": "", "raw_attributes": {}}) is None


# ---------------------------------------------------------------- failures
@pytest.mark.parametrize("exc, reason", [
    (LDAPSocketOpenError("unable to open socket", [
        (ssl.SSLCertVerificationError("certificate verify failed"), ("10.0.0.5", 636))]), "tls"),
    (ssl.SSLError("handshake"), "tls"),
    (TimeoutError("timed out"), "timeout"),
    (LDAPResponseTimeoutError("no response"), "timeout"),
    (LDAPSocketOpenError("socket connection error while opening: refused"), "unreachable"),
    (ConnectionRefusedError(111, "refused"), "unreachable"),
    (LDAPException("odd reply"), "protocol"),
])
def test_a_failure_is_named_by_its_cause(exc, reason):
    assert failure_reason(exc) == reason


# ---------------------------------------------------------------- TLS
def test_ldaps_is_verified_against_the_given_ca(tmp_path):
    ca = tmp_path / "ca.pem"
    ca.write_text("-----BEGIN CERTIFICATE-----\n")
    tls = tls_for(load_ldap_config({**BASE, "LDAP_CA_CERT": str(ca)}))
    assert isinstance(tls, Tls) and tls.validate == ssl.CERT_REQUIRED
    assert tls.ca_certs_file == str(ca)


def test_without_a_ca_the_system_store_verifies():
    tls = tls_for(load_ldap_config(BASE))
    assert tls.validate == ssl.CERT_REQUIRED and tls.ca_certs_file is None


def test_only_the_insecure_flag_without_a_ca_skips_verification(tmp_path):
    ca = tmp_path / "ca.pem"
    ca.write_text("-----BEGIN CERTIFICATE-----\n")
    insecure = {**BASE, "LDAP_ALLOW_INSECURE": "1"}
    assert tls_for(load_ldap_config(insecure)).validate == ssl.CERT_NONE
    assert tls_for(load_ldap_config({**insecure, "LDAP_CA_CERT": str(ca)})).validate == \
        ssl.CERT_REQUIRED


def test_plain_ldap_has_no_tls_at_all():
    config = load_ldap_config({**BASE, "LDAP_URL": "ldap://dc1.hastane.local",
                               "LDAP_ALLOW_INSECURE": "1"})
    assert tls_for(config) is None
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest tests/test_ldap3_directory.py -q -p no:cacheprovider
```
Expected: collection error, `ModuleNotFoundError: No module named 'homunculus.auth.ldap3_directory'`.

- [ ] **Step 3: Write the pure half of `ldap3_directory.py`**

Create `homunculus-engine/src/homunculus/auth/ldap3_directory.py`:

```python
"""`LdapDirectory` against a real Active Directory, with `ldap3` (pure Python: it runs on the
Windows dev machines and in the python:3.12-slim image without libldap). Spec §7.

  * LDAPS, verified: CERT_REQUIRED against LDAP_CA_CERT (or the system store), host name
    checked by `ldap3`. `ldap://` or an unverified certificate needs LDAP_ALLOW_INSECURE=1, and
    `ldap_from_env` says so loudly at start-up.
  * Every typed value reaches a filter through `ldap3.utils.conv.escape_filter_chars`, the
    objectGUID through `escape_guid` (each byte `\\xx`): a query cannot change a filter's shape.
  * `ldap3` is synchronous: each call runs on a worker thread (`asyncio.to_thread`), at most
    `SLOTS` at once, and is cut off after `LdapConfig.deadline_s` (2 × LDAP_TIMEOUT_S, at most
    12 s — under the dashboard's 15 s request timeout). The socket connect and receive
    timeouts are LDAP_TIMEOUT_S each.
  * Results are capped: `size_limit` on the server, and the slice here.
  * A network or TLS failure becomes LdapUnavailable(reason); a wrong password is None.
  * The clinician's password goes to one bind. It is not kept, logged or put into an
    exception; an empty one never reaches the server (an empty simple bind is anonymous).
"""
from __future__ import annotations

import ssl
from collections.abc import Mapping
from typing import Any

from ldap3 import Tls
from ldap3.core.exceptions import (
    LDAPCertificateError, LDAPCommunicationError, LDAPResponseTimeoutError, LDAPSocketOpenError,
    LDAPSSLConfigurationError, LDAPStartTLSError,
)
from ldap3.utils.conv import escape_filter_chars

from homunculus.auth.ldap import (
    LdapConfig, LdapGroup, LdapIdentity, guid_from_bytes, guid_to_bytes, is_disabled,
)

USER_ATTRIBUTES = ("objectGUID", "sAMAccountName", "userPrincipalName", "mail", "displayName",
                   "memberOf", "userAccountControl", "pwdLastSet")
# A search lists accounts to pick from; their group lists are not shown, so not read.
SEARCH_ATTRIBUTES = tuple(a for a in USER_ATTRIBUTES if a != "memberOf")
GROUP_ATTRIBUTES = ("cn",)
IN_CHAIN = "1.2.840.113556.1.4.1941"   # LDAP_MATCHING_RULE_IN_CHAIN: nested membership
GROUP_LIMIT = 1000     # nested groups of one account; more is an error, never a truncation
RESULT_CAP = 50
SLOTS = 8              # directory calls at once, each on its own worker thread


# ---------------------------------------------------------------- filters (pure)
def escape_guid(external_id: str) -> str:
    """objectGUID as a filter value: its 16 bytes, each written `\\xx` (RFC 4515), so a byte
    that happens to be `(`, `)`, `*` or NUL cannot end the value. ValueError if not a UUID."""
    return "".join(f"\\{byte:02x}" for byte in guid_to_bytes(external_id))


def guid_lookup_filter(user_filter: str, external_id: str) -> str:
    """Decision D5: LDAP_USER_FILTER applies here too — what it excludes cannot sign in."""
    return f"(&{user_filter}(objectGUID={escape_guid(external_id)}))"


def user_search_filter(user_filter: str, query: str) -> str:
    q = escape_filter_chars(query.strip())
    return (f"(&{user_filter}(|(sAMAccountName=*{q}*)(displayName=*{q}*)"
            f"(userPrincipalName=*{q}*)(mail=*{q}*)))")


def group_search_filter(query: str) -> str:
    return f"(&(objectClass=group)(cn=*{escape_filter_chars(query.strip())}*))"


def nested_groups_filter(user_dn: str) -> str:
    return f"(&(objectClass=group)(member:{IN_CHAIN}:={escape_filter_chars(user_dn)}))"


# ---------------------------------------------------------------- entries (pure)
def _decode(value: Any) -> str:
    return value.decode("utf-8", "replace") if isinstance(value, (bytes, bytearray)) else str(value)


def _attributes(entry: Mapping[str, Any]) -> dict[str, list[Any]]:
    """The entry's raw attributes, names lower-cased (AD returns its own capitalisation)."""
    raw = entry.get("raw_attributes") or {}
    return {str(name).lower(): list(values or []) for name, values in raw.items()}


def _first_text(values: list[Any]) -> str | None:
    return (_decode(values[0]).strip() or None) if values else None


def _first_int(values: list[Any]) -> int | None:
    text = _first_text(values)
    try:
        return int(text) if text is not None else None
    except ValueError:
        return None


def parse_user_entry(entry: Mapping[str, Any]) -> LdapIdentity | None:
    """An `ldap3` search result entry as an LdapIdentity, read from its RAW attributes:
    objectGUID is binary, and raw values do not depend on the schema being loaded. None without
    a 16-byte objectGUID, a sAMAccountName or a DN."""
    attrs = _attributes(entry)
    guid = (attrs.get("objectguid") or [b""])[0]
    username = _first_text(attrs.get("samaccountname", []))
    dn = str(entry.get("dn") or "")
    if not isinstance(guid, (bytes, bytearray)) or len(guid) != 16 or not username or not dn:
        return None
    return LdapIdentity(
        external_id=guid_from_bytes(bytes(guid)), username=username, dn=dn,
        upn=_first_text(attrs.get("userprincipalname", [])),
        email=_first_text(attrs.get("mail", [])),
        display_name=_first_text(attrs.get("displayname", [])),
        group_dns=tuple(_decode(v) for v in attrs.get("memberof", [])),
        disabled=is_disabled(_first_int(attrs.get("useraccountcontrol", []))),
        pwd_last_set=_first_int(attrs.get("pwdlastset", [])),
    )


def parse_group_entry(entry: Mapping[str, Any]) -> LdapGroup | None:
    dn = str(entry.get("dn") or "")
    if not dn:
        return None
    return LdapGroup(dn=dn, name=_first_text(_attributes(entry).get("cn", [])) or dn)


# ---------------------------------------------------------------- failures and TLS (pure)
_TLS_FAILURES = (ssl.SSLError, LDAPSSLConfigurationError, LDAPStartTLSError, LDAPCertificateError)
_TIMEOUTS = (TimeoutError, LDAPResponseTimeoutError)


def failure_reason(exc: BaseException) -> str:
    """The LdapUnavailable reason for an `ldap3` or socket failure. `ldap3` reports a failed
    connection to a host with several addresses as one LDAPSocketOpenError whose second argument
    lists each address's own exception; those are read too."""
    causes: list[BaseException] = [exc]
    if (isinstance(exc, LDAPSocketOpenError) and len(exc.args) > 1
            and isinstance(exc.args[1], list)):
        causes += [item[0] for item in exc.args[1]
                   if isinstance(item, tuple) and item and isinstance(item[0], BaseException)]
    if any(isinstance(c, _TLS_FAILURES) for c in causes):
        return "tls"
    if any(isinstance(c, _TIMEOUTS) for c in causes):
        return "timeout"
    if any(isinstance(c, (LDAPCommunicationError, OSError)) for c in causes):
        return "unreachable"
    return "protocol"


def tls_for(config: LdapConfig) -> Tls | None:
    """None for ldap://. For ldaps:// the certificate is verified (and its name checked by
    `ldap3`) against LDAP_CA_CERT, or the system store when that is unset — unless
    LDAP_ALLOW_INSECURE=1 AND no CA was given, the one case that skips verification."""
    if not config.use_ssl:
        return None
    verify = not (config.allow_insecure and config.ca_cert is None)
    return Tls(validate=ssl.CERT_REQUIRED if verify else ssl.CERT_NONE,
               ca_certs_file=config.ca_cert)
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
PYTHONPATH=src "$PY" -m pytest tests/test_ldap3_directory.py -q -p no:cacheprovider
```
Expected: `24 passed`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/homunculus-g1
git add homunculus-engine/src/homunculus/auth/ldap3_directory.py homunculus-engine/tests/test_ldap3_directory.py
git commit -m "feat(ldap): escaped filters, raw AD entries, failure reasons and TLS policy (G1-03)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3 (G1-03c): `Ldap3Directory` — worker threads, deadline, binds; `ldap_from_env`

**Files:**
- Modify: `homunculus-engine/src/homunculus/auth/ldap3_directory.py` (import block; append the class)
- Modify: `homunculus-engine/tests/test_ldap3_directory.py` (import block; append tests)

- [ ] **Step 1: Write the failing tests**

In `homunculus-engine/tests/test_ldap3_directory.py`, replace the import block (from `from __future__ import annotations` through the closing `)` of the `homunculus.auth.ldap3_directory` import) with:

```python
from __future__ import annotations

import logging
import ssl
import time
import uuid

import pytest
from ldap3 import Tls
from ldap3.core.exceptions import LDAPException, LDAPResponseTimeoutError, LDAPSocketOpenError

from homunculus.auth.ldap import DEFAULT_USER_FILTER, LdapGroup, LdapUnavailable, load_ldap_config
from homunculus.auth.ldap3_directory import (
    GROUP_LIMIT, Ldap3Directory, escape_guid, failure_reason, group_search_filter,
    guid_lookup_filter, ldap_from_env, nested_groups_filter, parse_group_entry,
    parse_user_entry, tls_for, user_search_filter,
)
```

Then append to the end of the file:

```python
# ---------------------------------------------------------------- the class, over scripted connections
SVC_DN = BASE["LDAP_BIND_DN"]
SVC_PW = BASE["LDAP_BIND_PASSWORD"]
USER_PW = "Dogru-Parola-1"


class Script:
    """What the fake server answers: a password per DN, a result code for a refused bind, an
    error every bind raises, and one queued (entries, result code) reply per search."""

    def __init__(self, *replies):
        self.passwords = {SVC_DN: SVC_PW, USER_DN: USER_PW}
        self.bind_codes: dict[str, int] = {}
        self.error: BaseException | None = None
        self.replies = list(replies)
        self.connections: list[FakeConnection] = []
        self.searches: list[dict] = []

    def connect(self, user, password):
        conn = FakeConnection(self, user, password)
        self.connections.append(conn)
        return conn


class FakeConnection:
    """The slice of `ldap3.Connection` that Ldap3Directory uses."""

    def __init__(self, script, user, password):
        self.script, self.user, self._password = script, user, password
        self.result, self.response, self.closed = {}, [], False

    def bind(self):
        if self.script.error is not None:
            raise self.script.error
        ok = self.script.passwords.get(self.user) == self._password
        self.result = {"result": 0 if ok else self.script.bind_codes.get(self.user, 49)}
        return ok

    def search(self, **request):
        self.script.searches.append(request)
        entries, code = self.script.replies.pop(0)
        self.response, self.result = entries, {"result": code}
        return bool(entries)

    def unbind(self):
        self.closed = True


def _directory(script, **env):
    config = load_ldap_config({**BASE, "LDAP_NESTED_GROUPS": "0", **env})
    return Ldap3Directory(config, connect=script.connect)


def _bound_as(script):
    return [c.user for c in script.connections]


async def test_sign_in_finds_the_account_by_guid_then_binds_as_its_dn():
    script = Script(([_entry()], 0))
    identity = await _directory(script).authenticate(GUID, USER_PW)
    assert identity is not None and identity.username == "AYilmaz"
    assert _bound_as(script) == [SVC_DN, USER_DN]
    search = script.searches[0]
    assert search["search_filter"] == guid_lookup_filter(DEFAULT_USER_FILTER, GUID)
    assert search["search_base"] == BASE["LDAP_BASE_DN"] and search["size_limit"] == 2
    assert all(c.closed for c in script.connections)


async def test_a_wrong_password_is_none_not_an_outage():
    script = Script(([_entry()], 0))
    assert await _directory(script).authenticate(GUID, "Yanlis-1") is None
    assert _bound_as(script) == [SVC_DN, USER_DN]


async def test_an_empty_password_or_a_malformed_guid_never_reaches_the_server():
    script = Script()
    directory = _directory(script)
    assert await directory.authenticate(GUID, "") is None
    assert await directory.authenticate("not-a-guid", USER_PW) is None
    assert await directory.find_by_external_id("not-a-guid") is None
    assert script.connections == []


async def test_an_unknown_account_is_none_after_one_service_search():
    script = Script(([], 0))
    assert await _directory(script).authenticate(GUID, USER_PW) is None
    assert _bound_as(script) == [SVC_DN]


async def test_a_disabled_account_is_returned_without_a_bind_as_it():
    script = Script(([_entry(userAccountControl=[b"514"])], 0))
    identity = await _directory(script).authenticate(GUID, "her-neyse")
    assert identity is not None and identity.disabled is True
    assert _bound_as(script) == [SVC_DN]


async def test_a_refused_service_account_is_an_outage():
    script = Script()
    script.passwords[SVC_DN] = "baska"
    with pytest.raises(LdapUnavailable) as err:
        await _directory(script).test_connection()
    assert err.value.reason == "service_bind_rejected"


async def test_a_user_bind_refused_for_another_reason_is_an_outage():
    script = Script(([_entry()], 0))
    script.bind_codes[USER_DN] = 53                       # unwillingToPerform
    with pytest.raises(LdapUnavailable) as err:
        await _directory(script).authenticate(GUID, "Yanlis-1")
    assert err.value.reason == "protocol"


@pytest.mark.parametrize("error, reason", [
    (LDAPSocketOpenError("socket connection error while opening: refused"), "unreachable"),
    (LDAPSocketOpenError("unable to open socket", [
        (ssl.SSLCertVerificationError("certificate verify failed"), ("10.0.0.5", 636))]), "tls"),
])
async def test_network_and_tls_failures_are_outages(error, reason, caplog):
    script = Script()
    script.error = error
    with caplog.at_level(logging.WARNING), pytest.raises(LdapUnavailable) as err:
        await _directory(script).authenticate(GUID, USER_PW)
    assert err.value.reason == reason
    assert script.connections[0].closed
    assert USER_PW not in caplog.text and SVC_PW not in caplog.text


async def test_nested_groups_come_from_the_in_chain_rule():
    groups = [{"type": "searchResEntry", "dn": "CN=YB-Hemsire,OU=Gruplar,DC=hastane,DC=local",
               "raw_attributes": {"cn": [b"YB-Hemsire"]}},
              {"type": "searchResEntry", "dn": "CN=Tum-Personel,OU=Gruplar,DC=hastane,DC=local",
               "raw_attributes": {"cn": [b"Tum-Personel"]}}]
    script = Script(([_entry()], 0), (groups, 0))
    identity = await _directory(script, LDAP_NESTED_GROUPS="1").find_by_external_id(GUID)
    assert identity.group_dns == (groups[0]["dn"], groups[1]["dn"])
    nested = script.searches[1]
    assert nested["search_filter"] == nested_groups_filter(USER_DN)
    assert nested["size_limit"] == GROUP_LIMIT


async def test_a_nested_group_list_over_the_limit_is_refused_not_truncated():
    script = Script(([_entry()], 0), ([], 4))             # 4 = sizeLimitExceeded
    with pytest.raises(LdapUnavailable) as err:
        await _directory(script, LDAP_NESTED_GROUPS="1").find_by_external_id(GUID)
    assert err.value.reason == "protocol"


async def test_a_search_is_capped_and_reads_no_group_lists():
    second = _entry(objectGUID=[uuid.uuid4().bytes_le], sAMAccountName=[b"AYildiz"])
    script = Script(([_entry(), second], 4))              # more exist: the first page is enough
    found = await _directory(script).search_users("yil", limit=2)
    assert [i.username for i in found] == ["AYilmaz", "AYildiz"]
    request = script.searches[0]
    assert request["size_limit"] == 2 and "memberOf" not in request["attributes"]
    assert request["search_filter"] == user_search_filter(DEFAULT_USER_FILTER, "yil")


async def test_a_blank_search_never_reaches_the_server():
    script = Script()
    assert await _directory(script).search_users("   ") == []
    assert await _directory(script).search_groups("") == []
    assert script.connections == []


async def test_groups_for_the_mapping_picker():
    entry = {"type": "searchResEntry", "dn": "CN=YB-Hekim,OU=Gruplar,DC=hastane,DC=local",
             "raw_attributes": {"cn": [b"YB-Hekim"]}}
    script = Script(([entry], 0))
    assert await _directory(script).search_groups("hekim") == [LdapGroup(entry["dn"], "YB-Hekim")]
    assert script.searches[0]["search_filter"] == group_search_filter("hekim")


async def test_the_service_account_test_binds_and_closes():
    script = Script()
    await _directory(script).test_connection()
    assert _bound_as(script) == [SVC_DN] and script.connections[0].closed


async def test_a_hung_directory_is_cut_off_at_the_deadline():
    script = Script()

    def slow(user, password):
        time.sleep(0.5)
        return script.connect(user, password)

    directory = Ldap3Directory(load_ldap_config(BASE), connect=slow, deadline_s=0.05)
    started = time.monotonic()
    with pytest.raises(LdapUnavailable) as err:
        await directory.test_connection()
    assert err.value.reason == "timeout" and time.monotonic() - started < 0.4


async def test_check_password_binds_once_as_the_given_dn():
    script = Script()
    directory = _directory(script)
    assert await directory.check_password(SVC_DN, "yanlis") is False
    assert await directory.check_password(SVC_DN, SVC_PW) is True
    assert await directory.check_password(SVC_DN, "") is False
    assert _bound_as(script) == [SVC_DN, SVC_DN]


# ---------------------------------------------------------------- the production wiring
def test_no_url_no_directory():
    assert ldap_from_env({}) is None


def test_an_unusable_configuration_turns_ldap_off_and_says_why(caplog):
    with caplog.at_level(logging.ERROR, logger="homunculus.auth.ldap3_directory"):
        assert ldap_from_env({**BASE, "LDAP_BIND_DN": ""}) is None
    assert "LDAP is OFF" in caplog.text and "LDAP_BIND_DN" in caplog.text


def test_the_insecure_flag_is_announced(caplog):
    with caplog.at_level(logging.WARNING, logger="homunculus.auth.ldap3_directory"):
        runtime = ldap_from_env({**BASE, "LDAP_URL": "ldap://dc1.hastane.local",
                                 "LDAP_ALLOW_INSECURE": "1"})
    assert runtime is not None and "plain ldap://" in caplog.text


def test_a_good_configuration_builds_the_runtime():
    runtime = ldap_from_env({**BASE, "LDAP_LOGIN_ATTRS": "sAMAccountName"})
    assert isinstance(runtime.directory, Ldap3Directory)
    assert (runtime.url_host, runtime.login_attrs, runtime.last_test_ok) == (
        "dc1.hastane.local", ("samaccountname",), None)
    assert SVC_PW not in repr(runtime)
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest tests/test_ldap3_directory.py -q -p no:cacheprovider
```
Expected: collection error, `ImportError: cannot import name 'Ldap3Directory' from 'homunculus.auth.ldap3_directory'`.

- [ ] **Step 3: Extend the module's imports**

In `homunculus-engine/src/homunculus/auth/ldap3_directory.py`, replace the import block (from `import ssl` through the closing `)` of the `homunculus.auth.ldap` import) with:

```python
import asyncio
import logging
import math
import os
import ssl
from collections.abc import Callable, Mapping
from dataclasses import replace
from typing import Any

from ldap3 import AUTO_BIND_NONE, SIMPLE, SUBTREE, Connection, Server, Tls
from ldap3 import NONE as NO_SERVER_INFO
from ldap3.core.exceptions import (
    LDAPCertificateError, LDAPCommunicationError, LDAPException, LDAPResponseTimeoutError,
    LDAPSocketOpenError, LDAPSSLConfigurationError, LDAPStartTLSError,
)
from ldap3.core.results import (
    RESULT_INVALID_CREDENTIALS, RESULT_SIZE_LIMIT_EXCEEDED, RESULT_SUCCESS,
)
from ldap3.utils.conv import escape_filter_chars

from homunculus.auth.ldap import (
    LdapConfig, LdapConfigError, LdapGroup, LdapIdentity, LdapRuntime, LdapUnavailable,
    guid_from_bytes, guid_to_bytes, is_disabled, load_ldap_config,
)

logger = logging.getLogger(__name__)

Connect = Callable[[str, str], Any]
```

- [ ] **Step 4: Append the class and the production factory**

Append to the end of `homunculus-engine/src/homunculus/auth/ldap3_directory.py`:

```python
# ---------------------------------------------------------------- the directory
def _close(conn: Any) -> None:
    try:
        conn.unbind()
    except Exception:      # closing is best effort; the call's own outcome is what counts
        pass


def _is_guid(value: str) -> bool:
    try:
        guid_to_bytes(value)
    except (ValueError, TypeError, AttributeError):
        return False
    return True


def _guarded(fn: Callable[..., Any], *args: Any) -> Any:
    """Run `fn` on the worker thread; an `ldap3` or socket failure becomes LdapUnavailable.
    Only the exception's type and the reason are logged — never its arguments, which for a bind
    could name the account."""
    try:
        return fn(*args)
    except LdapUnavailable:
        raise
    except (LDAPException, OSError) as exc:
        reason = failure_reason(exc)
        logger.warning("directory call failed (%s): %s", reason, type(exc).__name__)
        raise LdapUnavailable(reason) from None


class Ldap3Directory:
    """The protocol over `ldap3`. `connect(user_dn, password)` returns an unbound connection —
    injected by tests; the default opens one per the configuration."""

    def __init__(self, config: LdapConfig, *, connect: Connect | None = None,
                 deadline_s: float | None = None) -> None:
        self._config = config
        self._connect: Connect = connect or self._open
        self._deadline = config.deadline_s if deadline_s is None else deadline_s
        self._slots = asyncio.Semaphore(SLOTS)

    # ---- the protocol (event loop side)
    async def authenticate(self, external_id: str, password: str) -> LdapIdentity | None:
        if not password or not _is_guid(external_id):
            return None
        return await self._call(self._authenticate, external_id, password)

    async def find_by_external_id(self, external_id: str) -> LdapIdentity | None:
        if not _is_guid(external_id):
            return None
        return await self._call(self._find, external_id)

    async def search_users(self, query: str, limit: int = RESULT_CAP) -> list[LdapIdentity]:
        if not query.strip():
            return []
        return await self._call(self._search_users, query, max(1, min(limit, RESULT_CAP)))

    async def search_groups(self, query: str, limit: int = RESULT_CAP) -> list[LdapGroup]:
        if not query.strip():
            return []
        return await self._call(self._search_groups, query, max(1, min(limit, RESULT_CAP)))

    async def test_connection(self) -> None:
        await self._call(self._test)

    async def check_password(self, dn: str, password: str) -> bool:
        """One bind as `dn`: True if the password is right. Not part of the protocol — sign-in
        goes through `authenticate`; the read-only integration test uses this."""
        if not password:
            return False
        return await self._call(self._password_ok, dn, password)

    async def _call(self, fn: Callable[..., Any], *args: Any) -> Any:
        async with self._slots:
            try:
                return await asyncio.wait_for(asyncio.to_thread(_guarded, fn, *args),
                                              self._deadline)
            except TimeoutError:
                logger.warning("directory call cut off after %.1f s", self._deadline)
                raise LdapUnavailable("timeout") from None

    # ---- the worker-thread side
    def _open(self, user: str, password: str) -> Any:
        server = Server(self._config.host, port=self._config.port,
                        use_ssl=self._config.use_ssl, tls=tls_for(self._config),
                        get_info=NO_SERVER_INFO, connect_timeout=self._config.timeout_s)
        return Connection(server, user=user, password=password, authentication=SIMPLE,
                          auto_bind=AUTO_BIND_NONE, read_only=True, raise_exceptions=False,
                          receive_timeout=self._config.timeout_s, auto_referrals=False,
                          check_names=False)

    def _service(self) -> Any:
        conn = self._connect(self._config.bind_dn, self._config.bind_password)
        try:
            bound = conn.bind()
        except BaseException:
            _close(conn)
            raise
        if bound:
            return conn
        code = (conn.result or {}).get("result")
        _close(conn)
        raise LdapUnavailable("service_bind_rejected" if code == RESULT_INVALID_CREDENTIALS
                              else "protocol")

    def _search(self, conn: Any, search_filter: str, attributes: tuple[str, ...],
                size_limit: int, *, truncated_ok: bool = True) -> list[dict]:
        conn.search(search_base=self._config.base_dn, search_filter=search_filter,
                    search_scope=SUBTREE, attributes=list(attributes), size_limit=size_limit,
                    time_limit=max(1, math.ceil(self._config.timeout_s)))
        code = (conn.result or {}).get("result")
        if code != RESULT_SUCCESS and not (truncated_ok and code == RESULT_SIZE_LIMIT_EXCEEDED):
            raise LdapUnavailable("protocol")
        entries = [e for e in (conn.response or []) if e.get("type") == "searchResEntry"]
        return entries[:size_limit]

    def _find(self, external_id: str) -> LdapIdentity | None:
        conn = self._service()
        try:
            entries = self._search(
                conn, guid_lookup_filter(self._config.user_filter, external_id),
                USER_ATTRIBUTES, 2)
            identity = parse_user_entry(entries[0]) if len(entries) == 1 else None
            if identity is not None and self._config.nested_groups:
                groups = self._search(conn, nested_groups_filter(identity.dn), GROUP_ATTRIBUTES,
                                      GROUP_LIMIT, truncated_ok=False)
                identity = replace(identity, group_dns=tuple(
                    str(e["dn"]) for e in groups if e.get("dn")))
            return identity
        finally:
            _close(conn)

    def _password_ok(self, dn: str, password: str) -> bool:
        conn = self._connect(dn, password)
        try:
            if conn.bind():
                return True
            if (conn.result or {}).get("result") == RESULT_INVALID_CREDENTIALS:
                return False
            raise LdapUnavailable("protocol")
        finally:
            _close(conn)

    def _authenticate(self, external_id: str, password: str) -> LdapIdentity | None:
        identity = self._find(external_id)
        if identity is None or identity.disabled:
            return identity
        return identity if self._password_ok(identity.dn, password) else None

    def _search_users(self, query: str, limit: int) -> list[LdapIdentity]:
        conn = self._service()
        try:
            entries = self._search(conn, user_search_filter(self._config.user_filter, query),
                                   SEARCH_ATTRIBUTES, limit)
        finally:
            _close(conn)
        return [i for i in map(parse_user_entry, entries) if i is not None]

    def _search_groups(self, query: str, limit: int) -> list[LdapGroup]:
        conn = self._service()
        try:
            entries = self._search(conn, group_search_filter(query), GROUP_ATTRIBUTES, limit)
        finally:
            _close(conn)
        return [g for g in map(parse_group_entry, entries) if g is not None]

    def _test(self) -> None:
        _close(self._service())


def ldap_from_env(env: Mapping[str, str] | None = None) -> LdapRuntime | None:
    """`app.state.ldap` for production (`api/prodserver.py`): None when LDAP_URL is unset, or —
    logged as an ERROR — when the LDAP_* settings cannot be used. Never raises: an unusable
    directory configuration must not stop the API (spec §9)."""
    env = os.environ if env is None else env
    try:
        config = load_ldap_config(env)
    except LdapConfigError as exc:
        logger.error("LDAP is OFF: %s. Local accounts sign in as usual; directory accounts get "
                     "503 until this is fixed.", exc)
        return None
    if config is None:
        return None
    if config.allow_insecure:
        logger.warning(
            "LDAP_ALLOW_INSECURE=1: %s. Never in a hospital: AD passwords cross this link.",
            "plain ldap://, no encryption" if not config.use_ssl
            else "the domain controller's certificate is NOT verified" if config.ca_cert is None
            else "set, but LDAP_CA_CERT is given, so the certificate is still verified")
    return LdapRuntime(directory=Ldap3Directory(config), url_host=config.host,
                       login_attrs=config.login_attrs)
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
PYTHONPATH=src "$PY" -m pytest tests/test_ldap3_directory.py tests/test_ldap_rules.py -q -p no:cacheprovider
```
Expected: `87 passed` (45 + 42).

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add homunculus-engine/src/homunculus/auth/ldap3_directory.py homunculus-engine/tests/test_ldap3_directory.py
git commit -m "feat(ldap): Ldap3Directory on worker threads with a hard deadline; ldap_from_env (G1-03)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4 (G1-03d): `FakeDirectory`; the connection test and the start-up check

**Files:**
- Create: `homunculus-engine/tests/fake_directory.py`
- Create: `homunculus-engine/tests/test_ldap_runtime.py`

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_ldap_runtime.py`:

```python
"""The app's handle on the directory (`LdapRuntime`), the start-up check (spec §9), and the
FakeDirectory every LDAP route test stands on — held to the contract Ldap3Directory keeps
(tests/test_ldap3_directory.py)."""
from __future__ import annotations

import logging

import pytest

from homunculus.auth.ldap import LdapUnavailable, check_directory_at_startup
from tests.fake_directory import AD_PASSWORD, FakeDirectory, person, runtime


async def test_the_fake_signs_in_by_guid_and_password_only():
    p = person("AYilmaz")
    directory = FakeDirectory([p])
    eid = p.identity.external_id
    assert await directory.authenticate(eid, AD_PASSWORD) == p.identity
    assert await directory.authenticate(eid, "yanlis") is None
    assert await directory.authenticate(eid, "") is None
    assert await directory.authenticate("00000000-0000-0000-0000-000000000000",
                                        AD_PASSWORD) is None
    assert ("authenticate", eid) in directory.calls
    assert all(AD_PASSWORD not in str(call) for call in directory.calls)


async def test_the_fake_returns_a_disabled_account_without_checking_its_password():
    p = person("Eski", disabled=True)
    found = await FakeDirectory([p]).authenticate(p.identity.external_id, "her-neyse")
    assert found is not None and found.disabled is True


async def test_the_fake_can_be_down():
    directory = FakeDirectory([person("AYilmaz")])
    directory.unavailable = True
    with pytest.raises(LdapUnavailable) as err:
        await directory.search_users("ayse")
    assert err.value.reason == "unreachable"


async def test_a_connection_test_is_remembered():
    rt = runtime(FakeDirectory())
    assert (rt.last_test_at, rt.last_test_ok) == (None, None)
    assert await rt.test() == (True, None)
    assert rt.last_test_ok is True and rt.last_test_at is not None
    rt.directory.unavailable = True
    assert await rt.test() == (False, "unreachable")
    assert (rt.last_test_ok, rt.last_test_reason) == (False, "unreachable")


async def test_the_startup_check_logs_success_and_failure_and_never_raises(caplog):
    rt = runtime(FakeDirectory())
    with caplog.at_level(logging.INFO, logger="homunculus.auth.ldap"):
        await check_directory_at_startup(rt)
        rt.directory.unavailable = True
        await check_directory_at_startup(rt)
    assert "bind to dc1.hastane.local succeeded" in caplog.text
    assert "FAILED (unreachable)" in caplog.text
    assert [r.levelname for r in caplog.records if r.getMessage().startswith("LDAP:")] == \
        ["INFO", "WARNING"]
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest tests/test_ldap_runtime.py -q -p no:cacheprovider
```
Expected: collection error, `ModuleNotFoundError: No module named 'tests.fake_directory'`.

- [ ] **Step 3: Write `tests/fake_directory.py`**

Create `homunculus-engine/tests/fake_directory.py`:

```python
"""A directory in memory (spec §10: "FakeDirectory implements the same protocol from an
in-memory list") and the helpers the LDAP tests share. Synthetic accounts only.

FakeDirectory keeps Ldap3Directory's contract: `authenticate` finds the account by objectGUID,
returns a disabled one as found WITHOUT checking the password, and answers None for an unknown
account or an empty or wrong password. `unavailable = True` makes every call raise
LdapUnavailable("unreachable"), as a domain controller that is down would. `calls` records which
method was asked about what — never a password."""
from __future__ import annotations

import uuid
from dataclasses import dataclass, replace

from homunculus.auth.ldap import LdapGroup, LdapIdentity, LdapRuntime, LdapUnavailable

DOMAIN_DN = "DC=hastane,DC=local"
AD_PASSWORD = "Ad-Parola-1"


def group_dn(cn: str) -> str:
    return f"CN={cn},OU=Gruplar,{DOMAIN_DN}"


@dataclass
class FakePerson:
    identity: LdapIdentity
    password: str


def person(username: str, *, password: str = AD_PASSWORD, groups: tuple[str, ...] = (),
           disabled: bool = False, email: str | None = None, upn: str | None = None,
           display_name: str | None = None, pwd_last_set: int | None = None) -> FakePerson:
    """An AD account: sAMAccountName `username`; UPN `<username>@hastane.local` unless given;
    display name `username.title()` unless given; a fresh objectGUID."""
    name = display_name or username.title()
    return FakePerson(
        identity=LdapIdentity(
            external_id=str(uuid.uuid4()), username=username,
            dn=f"CN={name},OU=Personel,{DOMAIN_DN}",
            upn=upn or f"{username.lower()}@hastane.local", email=email, display_name=name,
            group_dns=tuple(groups), disabled=disabled, pwd_last_set=pwd_last_set),
        password=password)


class FakeDirectory:
    def __init__(self, people: list[FakePerson] | tuple = (),
                 groups: list[LdapGroup] | tuple = ()) -> None:
        self.people: dict[str, FakePerson] = {p.identity.external_id: p for p in people}
        self.groups: list[LdapGroup] = list(groups)
        self.unavailable = False
        self.calls: list[tuple[str, str]] = []

    def add(self, p: FakePerson) -> FakePerson:
        self.people[p.identity.external_id] = p
        return p

    def update(self, external_id: str, **changes) -> None:
        """Change the account in AD: disable it, move it between groups, set pwdLastSet."""
        p = self.people[external_id]
        p.identity = replace(p.identity, **changes)

    def _ask(self, method: str, about: str) -> None:
        self.calls.append((method, about))
        if self.unavailable:
            raise LdapUnavailable("unreachable")

    async def authenticate(self, external_id: str, password: str) -> LdapIdentity | None:
        self._ask("authenticate", external_id)
        p = self.people.get(external_id)
        if p is None:
            return None
        if p.identity.disabled:
            return p.identity
        return p.identity if password and password == p.password else None

    async def find_by_external_id(self, external_id: str) -> LdapIdentity | None:
        self._ask("find_by_external_id", external_id)
        p = self.people.get(external_id)
        return p.identity if p is not None else None

    async def search_users(self, query: str, limit: int = 50) -> list[LdapIdentity]:
        self._ask("search_users", query)
        q = query.strip().lower()
        if not q:
            return []
        hits = [p.identity for p in self.people.values()
                if any(q in (value or "").lower() for value in (
                    p.identity.username, p.identity.display_name, p.identity.upn,
                    p.identity.email))]
        return sorted(hits, key=lambda i: i.username.lower())[:limit]

    async def search_groups(self, query: str, limit: int = 50) -> list[LdapGroup]:
        self._ask("search_groups", query)
        q = query.strip().lower()
        return [g for g in self.groups if q and q in g.name.lower()][:limit]

    async def test_connection(self) -> None:
        self._ask("test_connection", "")


def runtime(directory: FakeDirectory) -> LdapRuntime:
    return LdapRuntime(directory=directory, url_host="dc1.hastane.local")
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
PYTHONPATH=src "$PY" -m pytest tests/test_ldap_runtime.py -q -p no:cacheprovider
```
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/homunculus-g1
git add homunculus-engine/tests/fake_directory.py homunculus-engine/tests/test_ldap_runtime.py
git commit -m "test(ldap): FakeDirectory; the connection test and the start-up check log, never raise (G1-03)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5 (G1-03e): `auth/ldap_sync.py` — profile from AD, group sync with the guard in a savepoint

**Files:**
- Create: `homunculus-engine/src/homunculus/auth/ldap_sync.py`
- Create: `homunculus-engine/tests/test_ldap_sync.py`
- Modify: `homunculus-engine/tests/fake_directory.py` (import block; append the DB helpers)

- [ ] **Step 1: Give `fake_directory.py` its database helpers**

In `homunculus-engine/tests/fake_directory.py`, replace the import block (from `from __future__ import annotations` through `from homunculus.auth.ldap import …`) with:

```python
from __future__ import annotations

import uuid
from dataclasses import dataclass, replace

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.groups import ensure_default_groups, set_manual_groups
from homunculus.auth.ldap import LdapGroup, LdapIdentity, LdapRuntime, LdapUnavailable
from homunculus.auth.models import (
    AUTH_LDAP, Group, LdapGroupMapping, TenantMembership, User, UserGroup,
)
from homunculus.auth.service import hash_password
from homunculus.tenant.models import Tenant
```

Append to the end of the file:

```python
# ---------------------------------------------------------------- database helpers
ADMIN_PASSWORD = "Gizli-123"
TENANT_SLUG = "demo-hastanesi"


async def add_mapping(db: AsyncSession, tenant_id: uuid.UUID, ad_group_dn: str,
                      group: Group) -> LdapGroupMapping:
    """A mapping row as the admin API writes it: the DN lower-cased."""
    mapping = LdapGroupMapping(tenant_id=tenant_id, ad_group_dn=ad_group_dn.strip().lower(),
                               group_id=group.id)
    db.add(mapping)
    await db.flush()
    return mapping


async def add_directory_account(db: AsyncSession, tenant_id: uuid.UUID, p: FakePerson, *,
                                is_active: bool = True) -> User:
    """The Homunculus row an import would have made for `p`, before its first sign-in: the
    sAMAccountName lower-cased as username, no e-mail yet, an old name, no groups."""
    user = User(username=p.identity.username.lower(), email=None, full_name="Eski Ad",
                hashed_password=None, auth_source=AUTH_LDAP,
                external_id=p.identity.external_id, is_active=is_active)
    db.add(user)
    await db.flush()
    db.add(TenantMembership(user_id=user.id, tenant_id=tenant_id))
    await db.flush()
    return user


async def fresh_user(db: AsyncSession, user_id: uuid.UUID) -> User:
    """The committed row, not the session's cached copy."""
    return (await db.execute(select(User).where(User.id == user_id)
                             .execution_options(populate_existing=True))).scalar_one()


async def group_rows(db: AsyncSession, user_id: uuid.UUID) -> set[tuple[str, str]]:
    """(group slug, source) for every group link of the user."""
    rows = await db.execute(select(Group.slug, UserGroup.source)
                            .join(UserGroup, UserGroup.group_id == Group.id)
                            .where(UserGroup.user_id == user_id))
    return set(rows.all())


async def ad_world(db: AsyncSession) -> dict:
    """One tenant with its default groups; a LOCAL administrator `admin` (ADMIN_PASSWORD, in
    hospital_admin); the AD mappings YB-Hemsire → nurse and YB-Hekim → physician; and `ayse`,
    an AD account (sAMAccountName AYilmaz, in YB-Hemsire, mail Ayse.Yilmaz@hastane.az) already
    imported as `ayilmaz`, before her first sign-in. Committed."""
    tenant = Tenant(name="Demo", slug=TENANT_SLUG, country_code="TR")
    db.add(tenant)
    await db.flush()
    groups = await ensure_default_groups(db, tenant.id)
    admin = User(username="admin", email="admin@example.com", full_name="Yönetici",
                 hashed_password=hash_password(ADMIN_PASSWORD))
    db.add(admin)
    await db.flush()
    db.add(TenantMembership(user_id=admin.id, tenant_id=tenant.id))
    await db.flush()
    await set_manual_groups(db, user=admin, tenant_id=tenant.id,
                            group_ids=[groups["hospital_admin"].id], granted_by_id=None)
    mappings = {
        "YB-Hemsire": await add_mapping(db, tenant.id, group_dn("YB-Hemsire"), groups["nurse"]),
        "YB-Hekim": await add_mapping(db, tenant.id, group_dn("YB-Hekim"), groups["physician"]),
    }
    ayse = person("AYilmaz", groups=(group_dn("YB-Hemsire"),), email="Ayse.Yilmaz@hastane.az",
                  display_name="Ayşe Yılmaz")
    directory = FakeDirectory([ayse], groups=[LdapGroup(group_dn(cn), cn) for cn in
                                              ("YB-Hemsire", "YB-Hekim", "YB-Sorumlu")])
    account = await add_directory_account(db, tenant.id, ayse)
    await db.commit()
    return {"tenant": tenant, "groups": groups, "admin": admin, "mappings": mappings,
            "ayse": ayse, "account": account, "directory": directory}
```

- [ ] **Step 2: Write the failing tests**

Create `homunculus-engine/tests/test_ldap_sync.py`:

```python
"""The directory's half of a sign-in, against the test Postgres (spec §7 steps 4–5): the
profile copied from AD, and the AD-mapped groups made equal to the mapping — `ldap` rows only,
manual rows untouched; a removal that would leave the tenant without a LOCAL administrator is
rolled back in its savepoint while the profile update stays. Synthetic accounts only."""
from __future__ import annotations

from dataclasses import replace

import pytest
import pytest_asyncio

from homunculus.auth.groups import ensure_default_groups, set_manual_groups
from homunculus.auth.ldap_sync import apply_directory_profile, mapped_group_ids, sync_ldap_groups
from homunculus.auth.models import SOURCE_LDAP, SOURCE_MANUAL, TenantMembership, User, UserGroup
from homunculus.auth.service import hash_password
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db
from tests.fake_directory import ADMIN_PASSWORD, ad_world, fresh_user, group_dn, group_rows

pytestmark = [pytest.mark.asyncio, requires_db]


@pytest_asyncio.fixture
async def world(db_session):
    return await ad_world(db_session)


# ---------------------------------------------------------------- the mapping
async def test_the_mapping_reads_dns_whatever_their_case(world, db_session):
    tid = world["tenant"].id
    assert await mapped_group_ids(db_session, tid, [group_dn("YB-Hemsire").upper()]) == \
        {world["groups"]["nurse"].id}
    assert await mapped_group_ids(db_session, tid, ["CN=Baska,DC=x"]) == set()
    assert await mapped_group_ids(db_session, tid, []) == set()


async def test_mapped_groups_arrive_as_directory_rows_and_retire_old_tokens(world, db_session):
    user = await fresh_user(db_session, world["account"].id)
    tv = user.token_version
    outcome = await sync_ldap_groups(db_session, user=user, tenant_id=world["tenant"].id,
                                     group_dns=[group_dn("YB-Hemsire")])
    await db_session.commit()
    assert (outcome.before, outcome.after, outcome.guarded) == ((), ("nurse",), ())
    assert outcome.changed is True
    assert await group_rows(db_session, user.id) == {("nurse", SOURCE_LDAP)}
    assert (await fresh_user(db_session, user.id)).token_version == tv + 1


async def test_rows_the_mapping_no_longer_gives_go_and_manual_rows_stay(world, db_session):
    g, tid = world["groups"], world["tenant"].id
    user = await fresh_user(db_session, world["account"].id)
    db_session.add(UserGroup(user_id=user.id, group_id=g["nurse"].id, source=SOURCE_LDAP))
    await set_manual_groups(db_session, user=user, tenant_id=tid,
                            group_ids=[g["charge_nurse"].id], granted_by_id=None)
    await db_session.commit()
    outcome = await sync_ldap_groups(db_session, user=user, tenant_id=tid,
                                     group_dns=[group_dn("YB-Hekim")])
    await db_session.commit()
    assert outcome.before == ("charge_nurse", "nurse")
    assert outcome.after == ("charge_nurse", "physician")
    assert await group_rows(db_session, user.id) == {
        ("charge_nurse", SOURCE_MANUAL), ("physician", SOURCE_LDAP)}


async def test_a_manual_row_for_a_mapped_group_stays_manual_and_nothing_moves(world, db_session):
    g, tid = world["groups"], world["tenant"].id
    user = await fresh_user(db_session, world["account"].id)
    await set_manual_groups(db_session, user=user, tenant_id=tid, group_ids=[g["nurse"].id],
                            granted_by_id=None)
    await db_session.commit()
    tv = (await fresh_user(db_session, user.id)).token_version
    outcome = await sync_ldap_groups(db_session, user=user, tenant_id=tid,
                                     group_dns=[group_dn("YB-Hemsire")])
    await db_session.commit()
    assert outcome.changed is False and outcome.after == ("nurse",)
    assert await group_rows(db_session, user.id) == {("nurse", SOURCE_MANUAL)}
    assert (await fresh_user(db_session, user.id)).token_version == tv


# ---------------------------------------------------------------- the local-administrator guard
async def _sole_local_admin_through_ad(db):
    """A second tenant whose ONLY local administrator holds hospital_admin through an `ldap`
    row — data the API never produces (the sync runs for AD accounts only), built by hand to
    reach the guard (plan decision D10)."""
    tenant = Tenant(name="Iki", slug="iki", country_code="TR")
    db.add(tenant)
    await db.flush()
    groups = await ensure_default_groups(db, tenant.id)
    boss = User(username="patron", email="patron@example.com", full_name="Patron",
                hashed_password=hash_password(ADMIN_PASSWORD))
    db.add(boss)
    await db.flush()
    db.add(TenantMembership(user_id=boss.id, tenant_id=tenant.id))
    db.add(UserGroup(user_id=boss.id, group_id=groups["hospital_admin"].id, source=SOURCE_LDAP))
    await db.commit()
    return tenant, groups, boss


async def test_a_removal_that_would_leave_no_local_administrator_is_rolled_back(world,
                                                                               db_session):
    tenant, _groups, boss = await _sole_local_admin_through_ad(db_session)
    boss = await fresh_user(db_session, boss.id)
    tv = boss.token_version
    boss.full_name = "Profil AD'den"                     # step 4, before the sync
    outcome = await sync_ldap_groups(db_session, user=boss, tenant_id=tenant.id, group_dns=[])
    await db_session.commit()
    assert outcome.guarded == ("hospital_admin",) and outcome.changed is False
    after = await fresh_user(db_session, boss.id)
    assert after.full_name == "Profil AD'den" and after.token_version == tv
    assert await group_rows(db_session, boss.id) == {("hospital_admin", SOURCE_LDAP)}


async def test_the_same_removal_goes_through_when_another_local_administrator_remains(
        world, db_session):
    tenant, groups, boss = await _sole_local_admin_through_ad(db_session)
    other = User(username="ikinci", email="ikinci@example.com", full_name="İkinci",
                 hashed_password=hash_password(ADMIN_PASSWORD))
    db_session.add(other)
    await db_session.flush()
    db_session.add(TenantMembership(user_id=other.id, tenant_id=tenant.id))
    await set_manual_groups(db_session, user=other, tenant_id=tenant.id,
                            group_ids=[groups["hospital_admin"].id], granted_by_id=None)
    await db_session.commit()
    boss = await fresh_user(db_session, boss.id)
    outcome = await sync_ldap_groups(db_session, user=boss, tenant_id=tenant.id, group_dns=[])
    await db_session.commit()
    assert (outcome.before, outcome.after, outcome.guarded) == (("hospital_admin",), (), ())
    assert await group_rows(db_session, boss.id) == set()


# ---------------------------------------------------------------- the profile
async def test_the_profile_follows_ad(world, db_session):
    user = await fresh_user(db_session, world["account"].id)
    changed = await apply_directory_profile(db_session, user, world["ayse"].identity)
    await db_session.commit()
    assert sorted(changed) == ["email", "full_name", "ldap_dn"]
    after = await fresh_user(db_session, user.id)
    assert (after.full_name, after.email, after.ldap_dn) == (
        "Ayşe Yılmaz", "ayse.yilmaz@hastane.az", world["ayse"].identity.dn)
    assert await apply_directory_profile(db_session, after, world["ayse"].identity) == []


async def test_an_ad_mail_another_account_uses_is_not_copied(world, db_session):
    user = await fresh_user(db_session, world["account"].id)
    taken = replace(world["ayse"].identity, email="ADMIN@example.com")
    changed = await apply_directory_profile(db_session, user, taken)
    assert "email" not in changed and user.email is None


async def test_an_account_without_mail_in_ad_loses_its_email_here(world, db_session):
    user = await fresh_user(db_session, world["account"].id)
    await apply_directory_profile(db_session, user, world["ayse"].identity)
    changed = await apply_directory_profile(db_session, user,
                                            replace(world["ayse"].identity, email=None))
    assert "email" in changed and user.email is None
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest tests/test_ldap_sync.py -q -p no:cacheprovider
```
Expected: collection error, `ModuleNotFoundError: No module named 'homunculus.auth.ldap_sync'`.

- [ ] **Step 4: Write `auth/ldap_sync.py`**

Create `homunculus-engine/src/homunculus/auth/ldap_sync.py`:

```python
"""What a directory sign-in writes (spec §7, "Sign-in for an AD user", steps 4–5): the account's
profile as AD has it now, and its AD-mapped groups.

  apply_directory_profile   full_name, email, ldap_dn from AD (plan decision D11)
  mapped_group_ids          the tenant's groups these AD group DNs map to
  sync_ldap_groups          make the account's `ldap` rows equal to the mapping; `manual` rows
                            are never touched (plan decision D10)
  login_in_use              whether a value is already some account's username or e-mail

The sync keeps the §6 guard: a removal that would leave the tenant without an active LOCAL
administrator is rolled back in its savepoint and reported (`SyncOutcome.guarded`), and the
profile update made before it stays. The caller writes the audit rows (actor
LDAP_SYNC_ACTOR) after its commit.
"""
from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.groups import bump_user, count_admins, groups_of, lock_admin_guard
from homunculus.auth.ldap import LdapIdentity
from homunculus.auth.models import SOURCE_LDAP, Group, LdapGroupMapping, User, UserGroup
from homunculus.auth.service import normalize_login

LDAP_SYNC_ACTOR = "ldap-sync"
_EMAIL_MAX = 254       # users.email
_NAME_MAX = 200        # users.full_name


def normalise_dn(dn: str) -> str:
    """How a DN is stored in `ldap_group_mappings` and compared: trimmed, lower-cased."""
    return dn.strip().lower()


async def login_in_use(db: AsyncSession, value: str, *,
                       except_id: uuid.UUID | None = None) -> bool:
    """Whether `value` is already some account's username or e-mail (sign-in matches both)."""
    stmt = select(User.id).where(or_(User.username == value, User.email == value))
    if except_id is not None:
        stmt = stmt.where(User.id != except_id)
    return (await db.execute(stmt.limit(1))).first() is not None


async def apply_directory_profile(db: AsyncSession, user: User,
                                  identity: LdapIdentity) -> list[str]:
    """Spec §7 step 4: the account's name, e-mail and DN as AD has them now. Returns the fields
    that changed. `username` never changes. An AD `mail` that another account already uses as
    its username or e-mail is not copied (the old e-mail stays): a sign-in must not fail on a
    unique constraint. An account without `mail` in AD loses its e-mail here."""
    changed: list[str] = []
    name = (identity.display_name or "").strip()[:_NAME_MAX]
    if name and name != user.full_name:
        user.full_name = name
        changed.append("full_name")
    mail = normalize_login(identity.email) or None
    if mail != user.email and (mail is None or (
            len(mail) <= _EMAIL_MAX and not await login_in_use(db, mail, except_id=user.id))):
        user.email = mail
        changed.append("email")
    if identity.dn and identity.dn != user.ldap_dn:
        user.ldap_dn = identity.dn
        changed.append("ldap_dn")
    return changed


async def mapped_group_ids(db: AsyncSession, tenant_id: uuid.UUID,
                           group_dns: Iterable[str]) -> set[uuid.UUID]:
    """The tenant's groups that these AD group DNs map to (DNs compared lower-cased)."""
    dns = {normalise_dn(dn) for dn in group_dns if dn and dn.strip()}
    if not dns:
        return set()
    rows = await db.execute(select(LdapGroupMapping.group_id).where(
        LdapGroupMapping.tenant_id == tenant_id, LdapGroupMapping.ad_group_dn.in_(dns)))
    return set(rows.scalars().all())


@dataclass(frozen=True)
class SyncOutcome:
    """The account's groups in the tenant (slugs, manual and AD alike) before and after the
    sync, and the AD groups the administrator guard kept (their removal would have left the
    tenant without a LOCAL administrator)."""
    before: tuple[str, ...]
    after: tuple[str, ...]
    guarded: tuple[str, ...] = ()

    @property
    def changed(self) -> bool:
        return self.before != self.after


async def _slugs(db: AsyncSession, user_id: uuid.UUID, tenant_id: uuid.UUID) -> tuple[str, ...]:
    rows = await db.execute(
        select(Group.slug).join(UserGroup, UserGroup.group_id == Group.id)
        .where(UserGroup.user_id == user_id, Group.tenant_id == tenant_id)
        .order_by(Group.slug))
    return tuple(rows.scalars().all())


async def _difference(db: AsyncSession, user_id: uuid.UUID, tenant_id: uuid.UUID,
                      group_dns: Iterable[str]) -> tuple[set[uuid.UUID], set[uuid.UUID]]:
    """(groups to add as `ldap` rows, `ldap` rows to remove). A group the user already holds
    through a MANUAL row is left as it is (one row per user and group)."""
    target = await mapped_group_ids(db, tenant_id, group_dns)
    links = await groups_of(db, user_id, tenant_id)
    held_ldap = {link.group_id for link in links if link.source == SOURCE_LDAP}
    held_other = {link.group_id for link in links if link.source != SOURCE_LDAP}
    return target - held_ldap - held_other, held_ldap - target


async def sync_ldap_groups(db: AsyncSession, *, user: User, tenant_id: uuid.UUID,
                           group_dns: Iterable[str]) -> SyncOutcome:
    """Spec §7 step 5: the account's `ldap` rows in this tenant become the mapped set. Bumps
    the token version when something changed. Does not commit."""
    group_dns = list(group_dns)
    await db.flush()          # the profile update (step 4) belongs to the outer transaction
    user_id = user.id
    to_add, to_remove = await _difference(db, user_id, tenant_id, group_dns)
    if not to_add and not to_remove:
        current = await _slugs(db, user_id, tenant_id)
        return SyncOutcome(before=current, after=current)
    # Serialise with every /admin write of the tenant, and decide again under the lock: a
    # mapping deleted meanwhile must not be re-applied. The lock is taken BEFORE the savepoint:
    # a lock taken inside a savepoint is released when the savepoint is rolled back.
    await lock_admin_guard(db, tenant_id)
    to_add, to_remove = await _difference(db, user_id, tenant_id, group_dns)
    before = await _slugs(db, user_id, tenant_id)
    for group_id in sorted(to_add):
        db.add(UserGroup(user_id=user_id, group_id=group_id, source=SOURCE_LDAP))
    await db.flush()
    guarded: tuple[str, ...] = ()
    removed = False
    if to_remove:
        savepoint = await db.begin_nested()
        # A Core DELETE: no ORM object changes inside the savepoint, so rolling it back leaves
        # nothing stale in the session.
        await db.execute(
            delete(UserGroup)
            .where(UserGroup.user_id == user_id, UserGroup.group_id.in_(to_remove),
                   UserGroup.source == SOURCE_LDAP)
            .execution_options(synchronize_session=False))
        if await count_admins(db, tenant_id) == 0:
            await savepoint.rollback()
            guarded = tuple(sorted((await db.execute(
                select(Group.slug).where(Group.id.in_(to_remove)))).scalars().all()))
        else:
            await savepoint.commit()
            removed = True
    if to_add or removed:
        await bump_user(db, user)
    return SyncOutcome(before=before, after=await _slugs(db, user_id, tenant_id),
                       guarded=guarded)
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
docker start homunculus-test-pg
PYTHONPATH=src "$PY" -m pytest tests/test_ldap_sync.py tests/test_ldap_runtime.py -q -p no:cacheprovider
```
Expected: `14 passed` (9 + 5).

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add homunculus-engine/src/homunculus/auth/ldap_sync.py homunculus-engine/tests/test_ldap_sync.py homunculus-engine/tests/fake_directory.py
git commit -m "feat(ldap): profile from AD and the AD group sync, guarded in a savepoint (G1-03)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6 (G1-03f): sign-in of an AD account

**Files:**
- Modify: `homunculus-engine/src/homunculus/auth/service.py:29` (import) and after `:96` (end of `find_user_by_login`)
- Modify: `homunculus-engine/src/homunculus/auth/router.py:3-4` (docstring), `:21-39` (imports), `:54-98` (`_login_failed`, `login`)
- Modify: `homunculus-engine/src/homunculus/api/app.py:20,53` (imports), `:122` (signature), `:138` (docstring), `:298` (`app.state`)
- Modify: `homunculus-engine/tests/fake_directory.py` (import block; append `ad_client`, `audit_events`)
- Modify: `homunculus-engine/tests/test_ldap_rules.py` (import; append one test)
- Create: `homunculus-engine/tests/test_auth_ldap_login.py`

- [ ] **Step 1: Give `fake_directory.py` the app client**

In `homunculus-engine/tests/fake_directory.py`, replace the import block (from `from __future__ import annotations` through `from homunculus.tenant.models import Tenant`) with:

```python
from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, replace

from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from homunculus.api.app import create_app
from homunculus.auth.groups import ensure_default_groups, set_manual_groups
from homunculus.auth.ldap import LdapGroup, LdapIdentity, LdapRuntime, LdapUnavailable
from homunculus.auth.models import (
    AUTH_LDAP, Group, LdapGroupMapping, TenantMembership, User, UserGroup,
)
from homunculus.auth.service import hash_password
from homunculus.db import get_db
from homunculus.tenant.models import Tenant
```

Append to the end of the file:

```python
# ---------------------------------------------------------------- the app
@asynccontextmanager
async def ad_client(db: AsyncSession, directory: FakeDirectory
                    ) -> AsyncIterator[tuple[AsyncClient, object]]:
    """The real app with `directory` as its LDAP directory. Every request gets its own session,
    as `get_db` gives it in production: the sign-in route rolls its session back while the
    directory answers (plan decision D7), which must not expire the test's objects."""
    app = create_app({"bridge-token": TENANT_SLUG}, run_escalation_loop=False,
                     ldap=runtime(directory))
    maker = async_sessionmaker(db.bind, expire_on_commit=False)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, app


def audit_events(app, event_type: str, subject: str) -> list:
    return [r for r in app.state.audit.records(event_type=event_type, limit=10_000)
            if r.subject == subject]
```

- [ ] **Step 2: Write the failing tests**

In `homunculus-engine/tests/test_ldap_rules.py`, add a separate import line after the `homunculus.auth.ldap` import:

```python
from homunculus.auth.service import directory_login_alternative
```

and append to the end of the file:

```python
@pytest.mark.parametrize("key, name", [
    ("hastane\\ayilmaz", "ayilmaz"), ("ayilmaz@hastane.local", "ayilmaz"), ("ayilmaz", None),
    ("hastane\\", None), ("@hastane.local", None),
])
def test_the_bare_name_inside_a_directory_login(key, name):
    assert directory_login_alternative(key) == name
```

Create `homunculus-engine/tests/test_auth_ldap_login.py`:

```python
"""Sign-in of an Active Directory account (spec §7, the LDAP branch of §4) against a
FakeDirectory and the test Postgres: the password goes to the directory once, a wrong one is
401, a directory that does not answer is 503, the profile and the AD-mapped groups follow AD,
and neither the audit trail nor the log ever holds a password. Synthetic accounts only."""
from __future__ import annotations

import logging

import pytest
import pytest_asyncio
from sqlalchemy import update

from homunculus.auth.groups import set_manual_groups
from homunculus.auth.jwt import decode_token
from homunculus.auth.models import User
from tests.conftest import requires_db
from tests.fake_directory import (
    AD_PASSWORD, ADMIN_PASSWORD, ad_client, ad_world, audit_events, fresh_user, group_dn,
    group_rows,
)

pytestmark = [pytest.mark.asyncio, requires_db]


@pytest_asyncio.fixture
async def world(db_session):
    return await ad_world(db_session)


@pytest_asyncio.fixture
async def client(db_session, world):
    async with ad_client(db_session, world["directory"]) as pair:
        yield pair


async def _login(c, login, password=AD_PASSWORD):
    return await c.post("/auth/login", json={"login": login, "password": password})


def _reasons(app):
    return [r.payload["reason"] for r in audit_events(app, "auth", "login.fail")]


async def test_an_ad_account_signs_in_with_its_directory_password(client, world, db_session):
    c, app = client
    res = await _login(c, "ayilmaz")
    assert res.status_code == 200, res.text
    body = res.json()
    assert decode_token(body["access_token"])["groups"] == ["nurse"]
    assert body["requires_mfa"] is False
    user = await fresh_user(db_session, world["account"].id)
    assert (user.full_name, user.email, user.ldap_dn) == (
        "Ayşe Yılmaz", "ayse.yilmaz@hastane.az", world["ayse"].identity.dn)
    assert user.last_login_at is not None and user.hashed_password is None
    [ok] = audit_events(app, "auth", "login.ok")
    assert (ok.payload["source"], ok.payload["profile"]) == (
        "ldap", ["email", "full_name", "ldap_dn"])


@pytest.mark.parametrize("login", [
    "ayilmaz", "AYILMAZ", "HASTANE\\ayilmaz", "ayilmaz@hastane.local",
])
async def test_every_directory_login_form_reaches_the_same_account(client, world, login):
    c, _ = client
    res = await _login(c, login)
    assert res.status_code == 200, (login, res.text)
    assert decode_token(res.json()["access_token"])["sub"] == str(world["account"].id)


async def test_the_ad_mail_signs_in_once_the_account_carries_it(client, world):
    c, _ = client
    assert (await _login(c, "ayse.yilmaz@hastane.az")).status_code == 401
    assert (await _login(c, "ayilmaz")).status_code == 200        # copies the mail from AD
    assert (await _login(c, "Ayse.Yilmaz@hastane.az")).status_code == 200


async def test_ldap_login_attrs_switch_a_login_form_off(client, world):
    c, app = client
    app.state.ldap.login_attrs = ("samaccountname",)
    assert (await _login(c, "ayilmaz@hastane.local")).status_code == 401
    assert (await _login(c, "ayilmaz")).status_code == 200
    app.state.ldap.login_attrs = ("userprincipalname",)
    assert (await _login(c, "ayilmaz")).status_code == 401
    assert (await _login(c, "ayilmaz@hastane.local")).status_code == 200


async def test_a_wrong_password_is_401_and_no_password_is_kept_anywhere(client, world, caplog):
    c, app = client
    with caplog.at_level(logging.DEBUG, logger="homunculus"):
        wrong = await _login(c, "ayilmaz", "Yanlis-Parola-9")
        right = await _login(c, "ayilmaz")
    assert (wrong.status_code, right.status_code) == (401, 200)
    assert _reasons(app) == ["bad_credentials"]
    trail = str([r.payload for r in app.state.audit.records(limit=10_000)])
    for secret in ("Yanlis-Parola-9", AD_PASSWORD):
        assert secret not in trail and secret not in caplog.text


async def test_a_directory_that_does_not_answer_is_503_never_401(client, world):
    c, app = client
    world["directory"].unavailable = True
    res = await _login(c, "ayilmaz")
    assert (res.status_code, res.json()["detail"]) == (503, "Dizin sunucusuna ulaşılamıyor")
    assert [(r.payload["reason"], r.tenant) for r in audit_events(app, "auth", "login.fail")] \
        == [("directory_unavailable", "demo-hastanesi")]


async def test_without_a_directory_an_ad_account_gets_503(client, world):
    c, app = client
    app.state.ldap = None
    assert (await _login(c, "ayilmaz")).status_code == 503
    assert _reasons(app) == ["directory_unavailable"]


async def test_an_account_disabled_in_ad_is_refused_and_stays_active_here(client, world,
                                                                        db_session):
    c, app = client
    world["directory"].update(world["ayse"].identity.external_id, disabled=True)
    assert (await _login(c, "ayilmaz")).status_code == 401
    assert _reasons(app) == ["directory_disabled"]
    assert (await fresh_user(db_session, world["account"].id)).is_active is True


async def test_a_deactivated_account_never_reaches_the_directory(client, world, db_session):
    c, app = client
    await db_session.execute(update(User).where(User.id == world["account"].id)
                             .values(is_active=False))
    await db_session.commit()
    assert (await _login(c, "ayilmaz")).status_code == 401
    assert world["directory"].calls == [] and _reasons(app) == ["inactive"]


async def test_an_account_deactivated_while_the_directory_answers_is_refused(client, world,
                                                                           db_session):
    c, app = client
    directory = world["directory"]
    answer = directory.authenticate

    async def deactivate_then_answer(external_id, password):
        await db_session.execute(update(User).where(User.id == world["account"].id)
                                 .values(is_active=False))
        await db_session.commit()
        return await answer(external_id, password)

    directory.authenticate = deactivate_then_answer
    assert (await _login(c, "ayilmaz")).status_code == 401
    assert _reasons(app) == ["inactive"]


async def test_an_empty_password_never_reaches_the_directory(client, world):
    c, app = client
    assert (await _login(c, "ayilmaz", "")).status_code == 401
    assert world["directory"].calls == [] and _reasons(app) == ["bad_credentials"]


async def test_sign_in_applies_the_ad_group_mapping_and_audits_each_change(client, world,
                                                                         db_session):
    c, app = client
    eid = world["ayse"].identity.external_id
    assert (await _login(c, "ayilmaz")).status_code == 200
    world["directory"].update(eid, group_dns=(group_dn("YB-Hekim"),))
    user = await fresh_user(db_session, world["account"].id)
    await set_manual_groups(db_session, user=user, tenant_id=world["tenant"].id,
                            group_ids=[world["groups"]["charge_nurse"].id], granted_by_id=None)
    await db_session.commit()
    res = await _login(c, "ayilmaz")
    assert decode_token(res.json()["access_token"])["groups"] == ["charge_nurse", "physician"]
    assert await group_rows(db_session, user.id) == {
        ("charge_nurse", "manual"), ("physician", "ldap")}
    assert (await _login(c, "ayilmaz")).status_code == 200            # nothing changes now
    changes = [(r.payload["actor"], r.payload["target"], r.payload["before"], r.payload["after"])
               for r in audit_events(app, "admin", "user.groups")]
    assert changes == [
        ("ldap-sync", str(user.id), [], ["nurse"]),
        ("ldap-sync", str(user.id), ["charge_nurse", "nurse"], ["charge_nurse", "physician"]),
    ]


async def test_an_unknown_directory_shaped_login_is_a_plain_401(client, world):
    c, app = client
    for login in ("kimse@hastane.local", "HASTANE\\kimse"):
        assert (await _login(c, login)).status_code == 401
    assert world["directory"].calls == []
    assert {(r.payload["reason"], r.tenant) for r in audit_events(app, "auth", "login.fail")} \
        == {("bad_credentials", "-")}


async def test_a_local_account_never_reaches_the_directory(client, world):
    c, _ = client
    assert (await _login(c, "admin", ADMIN_PASSWORD)).status_code == 200
    assert world["directory"].calls == []


async def test_a_upn_shaped_login_never_falls_back_to_a_local_account(client, world):
    c, _ = client
    assert (await _login(c, "admin@baska.local", ADMIN_PASSWORD)).status_code == 401
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest tests/test_auth_ldap_login.py tests/test_ldap_rules.py -q -p no:cacheprovider
```
Expected: collection errors — `ImportError: cannot import name 'directory_login_alternative' from 'homunculus.auth.service'`, and for the login file `TypeError: create_app() got an unexpected keyword argument 'ldap'` at fixture setup.

- [ ] **Step 4: Find the account a typed login names (`auth/service.py`)**

In `homunculus-engine/src/homunculus/auth/service.py`, change the import at line 29:

```python
from homunculus.auth.models import AUTH_LOCAL, User
```
to:
```python
from homunculus.auth.models import AUTH_LDAP, AUTH_LOCAL, User
```

Directly after `find_user_by_login` (which ends with `return result.scalars().first()`, line 96), add:

```python
def directory_login_alternative(key: str) -> str | None:
    """The bare account name inside a directory-style login: `DOMAIN\\name` → `name`, a UPN
    `name@suffix` → `name`; None when `key` has neither form (plan decision D2)."""
    if "\\" in key:
        name = key.rsplit("\\", 1)[1]
    elif "@" in key:
        name = key.split("@", 1)[0]
    else:
        return None
    return name or None


async def find_user_for_sign_in(db: AsyncSession, login: str) -> tuple[User | None, str]:
    """The account a typed login names, and the normalised login. First as `find_user_by_login`
    (username or e-mail, every account); then, for a DIRECTORY account only, the bare name of a
    `DOMAIN\\name` or UPN-shaped login as its username — a local account is never reached that
    way. Which forms the directory account accepts is decided after the bind
    (`auth.ldap.login_matches`)."""
    key = normalize_login(login)
    user = await find_user_by_login(db, key)
    if user is not None or not key:
        return user, key
    name = directory_login_alternative(key)
    if name is None:
        return None, key
    result = await db.execute(
        select(User).where(User.username == name, User.auth_source == AUTH_LDAP).limit(1))
    return result.scalars().first(), key
```

- [ ] **Step 5: The app holds the directory (`api/app.py`)**

In `homunculus-engine/src/homunculus/api/app.py`:

After `from datetime import datetime, timedelta, timezone` (line 20) add:

```python
from typing import TYPE_CHECKING
```

After `from homunculus.tenant.bedmap import BedMap` (line 53) add:

```python

if TYPE_CHECKING:
    from homunculus.auth.ldap import LdapRuntime
```

In the `create_app` signature, after the line `    on_startup_check: Callable[[], Awaitable[None]] | None = None,` add:

```python
    ldap: LdapRuntime | None = None,
```

At the end of the `create_app` docstring, replace

```python
    worse than one running with a fault an operator can read in the log."""
```
with
```python
    worse than one running with a fault an operator can read in the log.
    `ldap`, if given, is the directory (LDAP / Active Directory, spec §7) and becomes
    `app.state.ldap`; None leaves AD sign-in off — AD accounts get 503, /admin/ldap/* 409."""
```

After `    app.state.tickets = tickets` add:

```python
    app.state.ldap = ldap
```

- [ ] **Step 6: The LDAP branch of sign-in (`auth/router.py`)**

In `homunculus-engine/src/homunculus/auth/router.py`, replace the docstring lines 3–4

```
POST /auth/login        — username or e-mail + password; returns tokens (requires_mfa when a
                          TOTP step is still pending, mfa_enrolled when the user has one)
```
with
```
POST /auth/login        — username or e-mail + password; returns tokens (requires_mfa when a
                          TOTP step is still pending, mfa_enrolled when the user has one). An
                          Active Directory account is checked by the directory (spec §7): a
                          wrong password is 401, a directory that does not answer is 503
```

Replace the imports from `from homunculus.auth.audit import append_audit` through the closing `)` of the `homunculus.auth.service` import (lines 21–39) with:

```python
from homunculus.auth.audit import append_audit
from homunculus.auth.dependencies import (
    Principal, get_current_user_pre_mfa, get_principal, get_principal_pre_mfa,
    get_user_for_enrolment,
)
from homunculus.auth.groups import tenant_of_user
from homunculus.auth.jwt import decode_token
from homunculus.auth.ldap import DIRECTORY_DOWN, LdapUnavailable, get_ldap, login_matches
from homunculus.auth.ldap_sync import (
    LDAP_SYNC_ACTOR, SyncOutcome, apply_directory_profile, sync_ldap_groups,
)
from homunculus.auth.limits import totp_failures
from homunculus.auth.models import AUTH_LDAP, User
from homunculus.auth.schemas import (
    GroupBrief, LoginRequest, PasswordChangeRequest, RefreshRequest, TOTPSetupResponse,
    TOTPVerifyRequest, TokenResponse, UserMeResponse,
)
from homunculus.auth.service import (
    PasswordError, build_context, change_password, credential_fingerprint, enable_totp,
    find_user_for_sign_in, get_user_by_id, issue_tokens, mark_login, run_bcrypt, setup_totp,
    verify_local_password,
)
```

Replace everything from `async def _login_failed(` through the end of `login` (the line `    return TokenResponse(**tokens)` before `@router.post("/totp/setup"`, lines 54–98) with:

```python
def _bad_credentials() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")


def _directory_down() -> HTTPException:
    """Spec §4: a directory that does not answer is a fault to report (503), never the
    clinician's own mistake (401)."""
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=DIRECTORY_DOWN)


async def _login_failed(request: Request, db: AsyncSession, user_id: uuid.UUID | None, key: str,
                        reason: str) -> None:
    """Audit a failed sign-in. A known account's failure is filed under its hospital, so the
    hospital's own (tenant-scoped) audit shows attempts on its accounts; an unknown login has
    no hospital and is filed under "-".

    The tenant lookup runs for an unknown login too (with the nil UUID, which matches nothing):
    a failure then costs the same queries whether or not the account exists. Takes the account's
    id, not the row: after a directory call the row may be expired (see _directory_sign_in)."""
    ref = await tenant_of_user(db, user_id if user_id is not None else _NO_USER)
    append_audit(request, tenant=ref.slug if ref is not None else None, event_type="auth",
                 subject="login.fail", payload={"login": key, "reason": reason})


@router.post("/login", response_model=TokenResponse, summary="Sign in with username or e-mail")
async def login(body: LoginRequest, request: Request,
                db: AsyncSession = Depends(get_db)) -> TokenResponse:
    user, key = await find_user_for_sign_in(db, body.identifier)

    if user is not None and user.auth_source == AUTH_LDAP:
        return await _directory_sign_in(request, db, user, key, body.password)

    # bcrypt is ~0.2 s of CPU: off the event loop, or every sign-in stalls ingest and SSE. The
    # account's fields are read here, on the loop; the worker thread gets plain values.
    source = user.auth_source if user is not None else None
    hashed = user.hashed_password if user is not None else None
    user_id = user.id if user is not None else None
    if not await run_bcrypt(verify_local_password, source, hashed, body.password):
        await _login_failed(request, db, user_id, key, "bad_credentials")
        raise _bad_credentials()
    if not user.is_active:
        await _login_failed(request, db, user_id, key, "inactive")
        raise _bad_credentials()

    ctx = await build_context(db, user)
    mark_login(user)
    await db.commit()
    tokens = issue_tokens(user, ctx, mfa_verified=False)
    append_audit(request, tenant=ctx.tenant, event_type="auth", subject="login.ok",
                 payload={"login": key, "user": user.username, "source": user.auth_source,
                          "mfa_pending": tokens["requires_mfa"]})
    return TokenResponse(**tokens)


def _audit_sync(request: Request, tenant: str, user_id: uuid.UUID,
                outcome: SyncOutcome) -> None:
    """The directory group sync's audit rows (spec §7 step 5), written after the commit, at
    sign-in and at refresh alike: `admin/user.groups` when the set changed, and
    `admin/ldap.sync.guarded` when the administrator guard kept a group. Actor `ldap-sync`."""
    if outcome.changed:
        append_audit(request, tenant=tenant, event_type="admin", subject="user.groups",
                     payload={"actor": LDAP_SYNC_ACTOR, "target": str(user_id),
                              "before": list(outcome.before), "after": list(outcome.after)})
    if outcome.guarded:
        append_audit(request, tenant=tenant, event_type="admin", subject="ldap.sync.guarded",
                     payload={"actor": LDAP_SYNC_ACTOR, "target": str(user_id),
                              "kept": list(outcome.guarded)})


async def _directory_sign_in(request: Request, db: AsyncSession, user: User, key: str,
                             password: str) -> TokenResponse:
    """Spec §7, "Sign-in for an AD user". The password goes to ONE bind, as the account's DN
    found by objectGUID, and nowhere else: not stored, logged or audited. A wrong password, an
    account disabled or gone in AD, or a login form LDAP_LOGIN_ATTRS does not allow: 401. A
    directory that does not answer, or none configured: 503 — never conflated with 401.

    A deactivated account is refused before the directory is asked (no bind, so no AD lockout
    count for an account Homunculus has switched off). The database connection is released
    while the directory answers, so a slow domain controller cannot pin the pool at shift
    change; the account is re-read afterwards (plan decisions D7, D8)."""
    user_id, external_id = user.id, user.external_id
    if not user.is_active:
        await _login_failed(request, db, user_id, key, "inactive")
        raise _bad_credentials()
    ldap = get_ldap(request)
    if ldap is None:
        await _login_failed(request, db, user_id, key, "directory_unavailable")
        raise _directory_down()
    if not password or not external_id:
        await _login_failed(request, db, user_id, key, "bad_credentials")
        raise _bad_credentials()
    await db.rollback()                      # nothing written yet; frees the connection
    try:
        identity = await ldap.directory.authenticate(external_id, password)
    except LdapUnavailable:
        await _login_failed(request, db, user_id, key, "directory_unavailable")
        raise _directory_down() from None
    if identity is None:
        await _login_failed(request, db, user_id, key, "bad_credentials")
        raise _bad_credentials()
    if identity.disabled:
        await _login_failed(request, db, user_id, key, "directory_disabled")
        raise _bad_credentials()
    if not login_matches(key, identity, ldap.login_attrs):
        await _login_failed(request, db, user_id, key, "bad_credentials")
        raise _bad_credentials()
    user = await get_user_by_id(db, user_id)
    if user is None or not user.is_active:               # deactivated while AD answered
        await _login_failed(request, db, user_id, key, "inactive")
        raise _bad_credentials()
    profile = await apply_directory_profile(db, user, identity)
    ref = await tenant_of_user(db, user_id)
    outcome = (await sync_ldap_groups(db, user=user, tenant_id=ref.id,
                                      group_dns=identity.group_dns)
               if ref is not None else None)
    mark_login(user)
    await db.commit()
    if outcome is not None:
        _audit_sync(request, ref.slug, user_id, outcome)
    ctx = await build_context(db, user)
    tokens = issue_tokens(user, ctx, mfa_verified=False)
    append_audit(request, tenant=ctx.tenant, event_type="auth", subject="login.ok",
                 payload={"login": key, "user": user.username, "source": user.auth_source,
                          "mfa_pending": tokens["requires_mfa"], "profile": sorted(profile)})
    return TokenResponse(**tokens)
```

- [ ] **Step 7: Run the new tests and the existing sign-in tests**

```bash
PYTHONPATH=src "$PY" -m pytest tests/test_auth_ldap_login.py tests/test_ldap_rules.py tests/test_auth_login.py tests/test_auth_tokens.py tests/test_admin_api.py -q -p no:cacheprovider
```
Expected: all pass — `test_auth_ldap_login.py` 18, `test_ldap_rules.py` 47, and the three existing files unchanged (`test_auth_login.py::test_an_ad_account_gets_503_not_401_until_the_directory_exists` still passes: its app has no directory).

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/homunculus-g1
git add homunculus-engine/src/homunculus/auth/service.py homunculus-engine/src/homunculus/auth/router.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/fake_directory.py homunculus-engine/tests/test_ldap_rules.py homunculus-engine/tests/test_auth_ldap_login.py
git commit -m "feat(ldap): AD sign-in — one bind by objectGUID, 401 vs 503, profile and group sync (G1-03)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7 (G1-03g): the refresh of an AD session asks the directory and applies its groups

**Files:**
- Modify: `homunculus-engine/src/homunculus/auth/router.py` (docstring line for `/auth/refresh`; the `homunculus.auth.ldap` import; `refresh_token`)
- Create: `homunculus-engine/tests/test_auth_ldap_refresh.py`

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_auth_ldap_refresh.py`:

```python
"""The refresh of an Active Directory session (spec §7, "Refresh for an AD account"; plan
decision D9). An AD account's credential fingerprint covers only its TOTP secret, so
/auth/refresh reads the account back from the directory: disabled, gone, or a password set after
the session began — 401; otherwise its AD groups are applied at once, so the refreshed token
already carries the current rights. A directory that does not answer, or none configured — the
session goes on unchanged, and the audit trail says so. Synthetic accounts only."""
from __future__ import annotations

import pytest
import pytest_asyncio

from homunculus.auth.jwt import decode_token
from tests.conftest import requires_db
from tests.fake_directory import (
    AD_PASSWORD, ADMIN_PASSWORD, ad_client, ad_world, audit_events, fresh_user, group_dn,
    group_rows,
)

pytestmark = [pytest.mark.asyncio, requires_db]


@pytest_asyncio.fixture
async def world(db_session):
    return await ad_world(db_session)


@pytest_asyncio.fixture
async def client(db_session, world):
    async with ad_client(db_session, world["directory"]) as pair:
        yield pair


async def _signed_in(c, world, login="ayilmaz", password=AD_PASSWORD) -> dict:
    res = await c.post("/auth/login", json={"login": login, "password": password})
    assert res.status_code == 200, res.text
    world["directory"].calls.clear()
    return res.json()


async def _refresh(c, tokens):
    return await c.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})


def _reasons(app, subject):
    return [r.payload["reason"] for r in audit_events(app, "auth", subject)]


def _filetime(unix_seconds: int) -> int:
    return (unix_seconds + 11_644_473_600) * 10_000_000


async def test_an_unchanged_ad_account_refreshes_after_asking_the_directory(client, world):
    c, app = client
    tokens = await _signed_in(c, world)
    res = await _refresh(c, tokens)
    assert res.status_code == 200, res.text
    assert world["directory"].calls == [
        ("find_by_external_id", world["ayse"].identity.external_id)]
    assert decode_token(res.json()["access_token"])["groups"] == ["nurse"]
    assert _reasons(app, "refresh.fail") == []
    assert len(audit_events(app, "admin", "user.groups")) == 1      # the sign-in's; no change now


async def test_an_account_disabled_in_ad_loses_its_session_at_the_next_refresh(client, world,
                                                                             db_session):
    c, app = client
    tokens = await _signed_in(c, world)
    world["directory"].update(world["ayse"].identity.external_id, disabled=True)
    assert (await _refresh(c, tokens)).status_code == 401
    assert _reasons(app, "refresh.fail") == ["directory_disabled"]
    assert (await fresh_user(db_session, world["account"].id)).is_active is True


async def test_a_password_set_in_ad_after_the_session_began_ends_it(client, world):
    c, app = client
    tokens = await _signed_in(c, world)
    iat = decode_token(tokens["refresh_token"])["iat"]
    world["directory"].update(world["ayse"].identity.external_id,
                              pwd_last_set=_filetime(iat + 60))
    assert (await _refresh(c, tokens)).status_code == 401
    assert _reasons(app, "refresh.fail") == ["directory_password_changed"]


async def test_a_password_set_before_the_session_began_does_not(client, world):
    c, _ = client
    tokens = await _signed_in(c, world)
    iat = decode_token(tokens["refresh_token"])["iat"]
    world["directory"].update(world["ayse"].identity.external_id,
                              pwd_last_set=_filetime(iat - 3600))
    assert (await _refresh(c, tokens)).status_code == 200


async def test_must_change_password_at_next_logon_ends_the_session(client, world):
    c, app = client
    tokens = await _signed_in(c, world)
    world["directory"].update(world["ayse"].identity.external_id, pwd_last_set=0)
    assert (await _refresh(c, tokens)).status_code == 401
    assert _reasons(app, "refresh.fail") == ["directory_password_changed"]


async def test_an_account_gone_from_the_directory_loses_its_session(client, world):
    c, app = client
    tokens = await _signed_in(c, world)
    world["directory"].people.pop(world["ayse"].identity.external_id)
    assert (await _refresh(c, tokens)).status_code == 401
    assert _reasons(app, "refresh.fail") == ["directory_not_found"]


async def test_a_directory_that_does_not_answer_lets_the_session_go_on(client, world):
    c, app = client
    tokens = await _signed_in(c, world)
    world["directory"].unavailable = True
    assert (await _refresh(c, tokens)).status_code == 200
    assert _reasons(app, "refresh.directory_unavailable") == ["unreachable"]


async def test_no_directory_configured_lets_the_session_go_on(client, world):
    c, app = client
    tokens = await _signed_in(c, world)
    app.state.ldap = None
    assert (await _refresh(c, tokens)).status_code == 200
    assert _reasons(app, "refresh.directory_unavailable") == ["not_configured"]


async def test_a_local_accounts_refresh_never_asks_the_directory(client, world):
    c, _ = client
    tokens = await _signed_in(c, world, "admin", ADMIN_PASSWORD)
    assert (await _refresh(c, tokens)).status_code == 200
    assert world["directory"].calls == []


# ---------------------------------------------------------------- the group sync at refresh
async def test_a_refresh_after_leaving_the_mapped_ad_group_drops_the_right_at_once(
        client, world, db_session):
    c, app = client
    tokens = await _signed_in(c, world)
    old = {"Authorization": f"Bearer {tokens['access_token']}"}
    world["directory"].update(world["ayse"].identity.external_id, group_dns=())
    res = await _refresh(c, tokens)
    assert res.status_code == 200, res.text
    claims = decode_token(res.json()["access_token"])
    assert claims["groups"] == [] and "board.view" not in claims["perms"]
    assert await group_rows(db_session, world["account"].id) == set()
    last = audit_events(app, "admin", "user.groups")[-1]
    assert (last.payload["actor"], last.payload["before"], last.payload["after"]) == (
        "ldap-sync", ["nurse"], [])
    assert (await c.get("/auth/me", headers=old)).status_code == 401    # the old token is retired


async def test_a_refresh_after_joining_a_mapped_ad_group_carries_the_new_right(client, world,
                                                                             db_session):
    c, _ = client
    tokens = await _signed_in(c, world)
    world["directory"].update(world["ayse"].identity.external_id,
                              group_dns=(group_dn("YB-Hemsire"), group_dn("YB-Hekim")))
    res = await _refresh(c, tokens)
    assert res.status_code == 200, res.text
    claims = decode_token(res.json()["access_token"])
    assert claims["groups"] == ["nurse", "physician"] and "alerts.escalate" in claims["perms"]
    assert await group_rows(db_session, world["account"].id) == {
        ("nurse", "ldap"), ("physician", "ldap")}


async def test_a_directory_that_does_not_answer_changes_no_group_at_refresh(client, world,
                                                                          db_session):
    c, app = client
    tokens = await _signed_in(c, world)
    world["directory"].update(world["ayse"].identity.external_id, group_dns=())
    world["directory"].unavailable = True
    res = await _refresh(c, tokens)
    assert res.status_code == 200
    assert decode_token(res.json()["access_token"])["groups"] == ["nurse"]
    assert await group_rows(db_session, world["account"].id) == {("nurse", "ldap")}
    assert len(audit_events(app, "admin", "user.groups")) == 1      # the sign-in's only
    assert _reasons(app, "refresh.directory_unavailable") == ["unreachable"]
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest tests/test_auth_ldap_refresh.py -q -p no:cacheprovider
```
Expected: `10 failed, 2 passed`. Today's refresh never asks the directory: the disabled, password-changed, must-change and gone cases get 200 where 401 is expected; the two unavailable cases and the not-configured case find no `refresh.directory_unavailable` row; the unchanged account finds no `find_by_external_id` call; and the two group cases still see the sign-in's groups. Only "a password set before the session began" and "a local account's refresh" pass already. Any other split means a fixture problem — stop and look.

- [ ] **Step 3: Implement the re-check and the sync (`auth/router.py`)**

In `homunculus-engine/src/homunculus/auth/router.py`, replace the docstring line

```
POST /auth/refresh      — exchange refresh token for new tokens built from the CURRENT groups
```
with
```
POST /auth/refresh      — exchange refresh token for new tokens built from the CURRENT groups; an
                          AD account is read back from the directory first (disabled, gone or
                          password changed there: 401; otherwise its AD groups are applied, so
                          the new token carries them; directory down: the session goes on)
```

Replace the import line

```python
from homunculus.auth.ldap import DIRECTORY_DOWN, LdapUnavailable, get_ldap, login_matches
```
with
```python
from homunculus.auth.ldap import (
    DIRECTORY_DOWN, LdapIdentity, LdapUnavailable, get_ldap, login_matches,
    password_changed_since,
)
```

Replace the whole `refresh_token` function — from `@router.post("/refresh", response_model=TokenResponse,` through its last line `    return TokenResponse(**issue_tokens(user, ctx, mfa_verified=verified))` — with:

```python
@router.post("/refresh", response_model=TokenResponse,
             summary="Exchange refresh token for tokens built from the current groups")
async def refresh_token(body: RefreshRequest, request: Request,
                        db: AsyncSession = Depends(get_db)) -> TokenResponse:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token"
    )
    try:
        payload = decode_token(body.refresh_token)
        if payload.get("type") != "refresh":
            raise credentials_exc
        user_id = uuid.UUID(payload["sub"])
    except (JWTError, ValueError, KeyError):
        raise credentials_exc

    user = await get_user_by_id(db, user_id)
    identity: LdapIdentity | None = None
    if user is not None and user.is_active and user.auth_source == AUTH_LDAP:
        # An AD account's credential fingerprint covers only its TOTP secret: a password changed
        # or an account disabled in AD is seen only by asking AD (spec §7).
        refuse, identity = await _directory_at_refresh(request, db, user, payload.get("iat"))
        if refuse:
            raise credentials_exc
        user = await get_user_by_id(db, user_id)          # re-read: the check let the row go
    if not user or not user.is_active:
        raise credentials_exc
    revoked = user.sessions_revoked_at
    iat = payload.get("iat")
    if revoked is not None and (type(iat) is not int or iat <= revoked.timestamp()):
        # Issued before the account's last deactivation: reactivating it must not revive the
        # sessions it had ("phone stolen, deactivate, reactivate tomorrow").
        raise credentials_exc
    cv = payload.get("cv")
    # Compared as bytes: `compare_digest` raises TypeError on a non-ASCII str, which a claim
    # can hold — that must be a 401, not a 500.
    if not isinstance(cv, str) or not hmac.compare_digest(
            cv.encode(), credential_fingerprint(user).encode()):
        # The password or the authenticator changed since this session opened: sign in again.
        raise credentials_exc

    if identity is not None:
        # The directory answered: its group memberships apply now, so this refresh already
        # carries the current rights — a removal is not left for the next sign-in (plan D9).
        ref = await tenant_of_user(db, user.id)
        if ref is not None:
            outcome = await sync_ldap_groups(db, user=user, tenant_id=ref.id,
                                             group_dns=identity.group_dns)
            await db.commit()
            _audit_sync(request, ref.slug, user.id, outcome)

    ctx = await build_context(db, user)
    # Verified only if the refresh token says so AND an authenticator still exists (an MFA reset
    # must send the user back through enrolment, not keep a stale "verified").
    verified = payload.get("mfa_verified") is True and user.totp_enabled
    return TokenResponse(**issue_tokens(user, ctx, mfa_verified=verified))


async def _directory_at_refresh(request: Request, db: AsyncSession, user: User,
                                iat: object) -> tuple[bool, LdapIdentity | None]:
    """Spec §7, "Refresh for an AD account" (plan decisions D7, D9). Returns (refuse, identity).

    refuse is True when the session must end: the account is gone (deleted, moved out of
    LDAP_BASE_DN, excluded by LDAP_USER_FILTER), disabled, or its password was set after the
    refresh token was issued (pwdLastSet later than `iat`, or 0 — "must change at next logon").
    identity is the account as the directory reports it now, for the group sync; None when the
    directory does not answer or is not configured — the session goes on, unsynced (the spec §4
    outage rule), and the audit trail says so. Releases the database connection while the
    directory answers; the caller re-reads the account."""
    user_id, username, external_id = user.id, user.username, user.external_id
    ref = await tenant_of_user(db, user_id)
    tenant = ref.slug if ref is not None else None

    def audit(subject: str, reason: str) -> None:
        append_audit(request, tenant=tenant, event_type="auth", subject=subject,
                     payload={"user": username, "reason": reason})

    ldap = get_ldap(request)
    if ldap is None:
        audit("refresh.directory_unavailable", "not_configured")
        return False, None
    if not external_id or type(iat) is not int:
        audit("refresh.fail", "directory_not_found" if not external_id else "bad_token")
        return True, None
    await db.rollback()                      # read-only so far; frees the connection
    try:
        identity = await ldap.directory.find_by_external_id(external_id)
    except LdapUnavailable as exc:
        audit("refresh.directory_unavailable", exc.reason)
        return False, None
    if identity is None:
        reason = "directory_not_found"
    elif identity.disabled:
        reason = "directory_disabled"
    elif password_changed_since(identity.pwd_last_set, iat):
        reason = "directory_password_changed"
    else:
        return False, identity
    audit("refresh.fail", reason)
    return True, None
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
PYTHONPATH=src "$PY" -m pytest tests/test_auth_ldap_refresh.py tests/test_auth_ldap_login.py tests/test_ldap_sync.py tests/test_auth_login.py tests/test_admin_api.py -q -p no:cacheprovider
```
Expected: all pass (`test_auth_ldap_refresh.py`: 12).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/homunculus-g1
git add homunculus-engine/src/homunculus/auth/router.py homunculus-engine/tests/test_auth_ldap_refresh.py
git commit -m "feat(ldap): an AD session's refresh asks the directory — 401 when disabled or re-keyed, else its AD groups apply at once (G1-03)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8 (G1-03h): start-up bind, production wiring, deploy files

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/app.py` (a helper above `create_app`; the lifespan, lines 238–249)
- Modify: `homunculus-engine/src/homunculus/api/prodserver.py:7-12` (docstring), `:37` (import), `:407-415` (`create_app` call)
- Modify: `deploy/local/.env.example` (end of file), `deploy/local/docker-compose.yml` (api `environment` and `volumes`)
- Modify: `.gitignore` (after `deploy/local/bed-mapping.json`)
- Create: `homunculus-engine/tests/test_ldap_startup.py`

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_ldap_startup.py`:

```python
"""Start-up (spec §9): with a directory configured, the API binds once with the service account
in the background and logs the outcome — a failure is a warning, never a refusal to boot, and a
hung directory never delays serving local sign-ins. Production builds the directory from
LDAP_*."""
from __future__ import annotations

import asyncio
import logging
import os

import pytest

from homunculus.api.app import create_app
from tests.fake_directory import FakeDirectory, runtime


async def _boot(rt):
    app = create_app({"t": "demo-hastanesi"}, run_escalation_loop=False, ldap=rt)
    async with app.router.lifespan_context(app):
        await app.state.ldap_startup_check
    return app


async def test_the_api_binds_once_at_startup_and_remembers_the_outcome(caplog):
    rt = runtime(FakeDirectory())
    with caplog.at_level(logging.INFO, logger="homunculus.auth.ldap"):
        await _boot(rt)
    assert rt.last_test_ok is True and rt.directory.calls == [("test_connection", "")]
    assert "succeeded" in caplog.text


async def test_a_directory_that_does_not_answer_is_a_warning_not_a_refusal(caplog):
    rt = runtime(FakeDirectory())
    rt.directory.unavailable = True
    with caplog.at_level(logging.WARNING, logger="homunculus.auth.ldap"):
        app = await _boot(rt)
    assert rt.last_test_ok is False and "FAILED (unreachable)" in caplog.text
    assert app.state.ldap is rt


async def test_a_hung_directory_does_not_hold_up_startup():
    class Hung(FakeDirectory):
        async def test_connection(self):
            await asyncio.sleep(3600)

    app = create_app({"t": "demo-hastanesi"}, run_escalation_loop=False, ldap=runtime(Hung()))
    async with asyncio.timeout(2):
        async with app.router.lifespan_context(app):
            check = app.state.ldap_startup_check
            assert not check.done()                  # serving has begun; the check still runs
    with pytest.raises(asyncio.CancelledError):
        await check                                  # shutdown cancelled it


async def test_without_a_directory_there_is_no_check():
    app = create_app({"t": "demo-hastanesi"}, run_escalation_loop=False)
    async with app.router.lifespan_context(app):
        assert app.state.ldap_startup_check is None and app.state.ldap is None


def test_production_takes_the_directory_from_the_environment():
    if os.getenv("LDAP_URL"):
        pytest.skip("LDAP_URL is set in this shell")
    from homunculus.api import prodserver

    assert prodserver.app.state.ldap is None
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest tests/test_ldap_startup.py -q -p no:cacheprovider
```
Expected: `4 failed, 1 passed` — the lifespan tests fail with `AttributeError: 'State' object has no attribute 'ldap_startup_check'`; the production test passes already (`app.state.ldap` is None since Task 6).

- [ ] **Step 3: Bind in the background at start-up (`api/app.py`)**

In `homunculus-engine/src/homunculus/api/app.py`, directly above `def create_app(`, add:

```python
async def _check_directory_at_startup(runtime: LdapRuntime) -> None:
    """Spec §9: one service-account bind at start-up, logged; never raises."""
    from homunculus.auth.ldap import check_directory_at_startup

    try:
        await check_directory_at_startup(runtime)
    except Exception:          # a diagnostic must never take anything down
        log.exception("the directory start-up check failed to run")


```

Replace the lifespan (lines 238–249)

```python
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if on_startup_check is not None:
            try:
                await on_startup_check()
            except Exception:      # a diagnostic must never stop the service from starting
                logging.getLogger(__name__).exception("tenant configuration check failed to run")
        task = asyncio.create_task(_escalation_loop()) if run_escalation_loop else None
        try:
            yield
        finally:
            if task is not None:
                task.cancel()
```
with
```python
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if on_startup_check is not None:
            try:
                await on_startup_check()
            except Exception:      # a diagnostic must never stop the service from starting
                logging.getLogger(__name__).exception("tenant configuration check failed to run")
        # The directory's start-up bind (spec §9) runs in the background: a domain controller
        # that hangs must not delay serving local sign-ins. Kept on app.state for the tests.
        ldap_check = (asyncio.create_task(_check_directory_at_startup(ldap))
                      if ldap is not None else None)
        app.state.ldap_startup_check = ldap_check
        task = asyncio.create_task(_escalation_loop()) if run_escalation_loop else None
        try:
            yield
        finally:
            if task is not None:
                task.cancel()
            if ldap_check is not None and not ldap_check.done():
                ldap_check.cancel()
```

- [ ] **Step 4: Production builds the directory from `LDAP_*` (`api/prodserver.py`)**

In the module docstring, after the line
```
    DATABASE_URL / DATABASE_SSL / JWT_SECRET / CORS_ORIGINS  read by db.py / auth.jwt / app.py
```
add
```
    LDAP_*         optional Active Directory sign-in, read by auth/ldap3_directory.py
                   (`ldap_from_env`); unset or unusable = off, never a refusal to start
```

After `from homunculus.auth.jwt import jwt_secret_problem` add:

```python
from homunculus.auth.ldap3_directory import ldap_from_env
```

In the final `create_app(` call, after the line `    on_startup_check=make_startup_tenant_check(list(_tenants.values())),` add:

```python
    ldap=ldap_from_env(),
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
PYTHONPATH=src "$PY" -m pytest tests/test_ldap_startup.py tests/test_identity.py tests/test_jwt_caller.py -q -p no:cacheprovider
```
Expected: all pass (`test_ldap_startup.py`: 5).

- [ ] **Step 6: The deploy files**

Append to `deploy/local/.env.example`:

```bash

# ---------------------------------------------------------------------------------------
# Active Directory sign-in (optional). LDAP_URL unset = off: only local accounts sign in, AD
# accounts get "Dizin sunucusuna ulaşılamıyor", and the AD admin panel hides itself. See
# docs/EDGE-BRIDGE-LOCAL.md, "Active Directory sign-in (optional)".
#
# LDAPS only: ldaps://<the DC's name exactly as in its certificate>:636. Put the CA that signed
# the DC's certificate in deploy/local/ldap-ca/ca.pem (public; mounted read-only). A setting
# the API cannot use is logged ("LDAP is OFF: ...") and leaves AD sign-in off; it never stops
# the API, and local accounts always keep working.
#
# The bind account is a READ-ONLY service account. Its password lives here and nowhere else
# (never in the database, never in a response). If it contains a "$", single-quote the value.
#LDAP_URL=ldaps://dc1.hastane.local:636
#LDAP_CA_CERT=/etc/homunculus/ldap-ca/ca.pem
#LDAP_BIND_DN=CN=svc-homunculus,OU=Service Accounts,DC=hastane,DC=local
#LDAP_BIND_PASSWORD=
#LDAP_BASE_DN=DC=hastane,DC=local
# Optional; the defaults are shown:
#LDAP_USER_FILTER=(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))
#LDAP_LOGIN_ATTRS=sAMAccountName,userPrincipalName,mail
#LDAP_NESTED_GROUPS=1
#LDAP_TIMEOUT_S=5
# Lab only, never in the hospital: permits ldap:// and, without LDAP_CA_CERT, an unverified
# certificate. The API logs a warning at every start while it is set.
#LDAP_ALLOW_INSECURE=0
```

In `deploy/local/docker-compose.yml`, in the `api` service's `environment`, after the line `      INFINITY_HUB_CA_FILE: ${INFINITY_HUB_CA_FILE:-}` add:

```yaml
      # Active Directory sign-in (optional; spec §7, docs/EDGE-BRIDGE-LOCAL.md). LDAP_URL unset =
      # off. A value the API cannot use is logged and leaves AD sign-in off; it never stops the
      # API. The service account's password stays in .env and never reaches a browser.
      LDAP_URL: ${LDAP_URL:-}
      LDAP_CA_CERT: ${LDAP_CA_CERT:-}
      LDAP_ALLOW_INSECURE: ${LDAP_ALLOW_INSECURE:-}
      LDAP_BIND_DN: ${LDAP_BIND_DN:-}
      LDAP_BIND_PASSWORD: ${LDAP_BIND_PASSWORD:-}
      LDAP_BASE_DN: ${LDAP_BASE_DN:-}
      LDAP_USER_FILTER: ${LDAP_USER_FILTER:-}
      LDAP_LOGIN_ATTRS: ${LDAP_LOGIN_ATTRS:-}
      LDAP_NESTED_GROUPS: ${LDAP_NESTED_GROUPS:-}
      LDAP_TIMEOUT_S: ${LDAP_TIMEOUT_S:-}
```

and in the same service's `volumes`, after the line `      - ${INFINITY_HUB_CA_HOST_PATH:-./infinity-ca.pem}:/etc/homunculus/infinity-ca.pem:ro` add:

```yaml
      # The domain controller's CA certificate (public): deploy/local/ldap-ca/ca.pem, with
      # LDAP_CA_CERT=/etc/homunculus/ldap-ca/ca.pem. A directory, not a file: Docker creates a
      # missing source, and a missing directory is harmless where a missing file would become a
      # directory named like a certificate.
      - ./ldap-ca:/etc/homunculus/ldap-ca:ro
```

In `.gitignore`, after the line `deploy/local/bed-mapping.json` add:

```
# The domain controller's CA certificate: public, but site-specific.
deploy/local/ldap-ca/
```

- [ ] **Step 7: Check that compose renders the new block**

```bash
cd /c/tmp/homunculus-g1/deploy/local
POSTGRES_PASSWORD=x JWT_SECRET=0123456789abcdef0123456789abcdef01 TENANT_TOKEN=t \
PHI_ENCRYPTION_KEY=p WEB_LISTEN_ADDR=127.0.0.1 \
docker compose --env-file .env.example config 2>&1 | grep -E "LDAP_|ldap-ca"
```
Expected: ten lines `LDAP_…: ""` and the `ldap-ca` bind (`source: …/deploy/local/ldap-ca`, `target: /etc/homunculus/ldap-ca`). If `docker compose` is not available in this shell, record "compose config not run" in the commit message.

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/homunculus-g1
git add homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/prodserver.py homunculus-engine/tests/test_ldap_startup.py deploy/local/.env.example deploy/local/docker-compose.yml .gitignore
git commit -m "feat(ldap): start-up service bind in the background; LDAP_* in prodserver, .env.example, compose (G1-03)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9 (G1-04a): `/admin/ldap` — status, connection test, account and group search

**Files:**
- Create: `homunculus-engine/src/homunculus/admin/ldap_service.py`
- Create: `homunculus-engine/src/homunculus/admin/ldap_router.py`
- Modify: `homunculus-engine/src/homunculus/admin/schemas.py` (append)
- Modify: `homunculus-engine/src/homunculus/api/app.py:276,288` (import and mount the router)
- Modify: `homunculus-engine/tests/test_route_permissions.py:34-39,99-111,196-197`
- Modify: `homunculus-engine/tests/test_route_inventory.py:50-51`
- Create: `homunculus-engine/tests/test_admin_ldap_api.py`

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_admin_ldap_api.py`:

```python
"""/admin/ldap end to end (spec §7, "Import and mapping"; plan decisions D12–D14): with LDAP off
everything but the status is 409, the permission comes first (403), the status and the
connection test, the account and group searches — and, in the sections Tasks 10 and 11 add, the
import and the mapping table under the same rights rules as the rest of /admin. FakeDirectory
and the test Postgres; synthetic accounts only."""
from __future__ import annotations

import pytest
import pytest_asyncio

from homunculus.auth.groups import ensure_default_groups
from homunculus.auth.ldap import NOT_CONFIGURED
from homunculus.auth.models import Group, GroupPermission
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db
from tests.fake_directory import (
    ad_client, ad_world, add_mapping, audit_events, group_dn, person,
)
from tests.signed_in import add_user, bearer

pytestmark = [pytest.mark.asyncio, requires_db]


@pytest_asyncio.fixture
async def world(db_session):
    """`ad_world`, plus: a second tenant with its own YB-Hemsire mapping; YB-Sorumlu →
    charge_nurse here; a nurse `hemsire`; a user desk `masa` (the nurse's rights +
    users.manage); and in AD, accounts not yet imported — `MKaya` (YB-Sorumlu), `BDemir`
    (YB-Hemsire, with a mail), the disabled `Eski`, and `Admin`, whose sAMAccountName is the
    local administrator's username."""
    db = db_session
    w = await ad_world(db)
    other = Tenant(name="Other", slug="other", country_code="TR")
    db.add(other)
    await db.flush()
    w["other_groups"] = await ensure_default_groups(db, other.id)
    w["foreign_mapping"] = await add_mapping(db, other.id, group_dn("YB-Hemsire"),
                                             w["other_groups"]["nurse"])
    w["mappings"]["YB-Sorumlu"] = await add_mapping(db, w["tenant"].id, group_dn("YB-Sorumlu"),
                                                    w["groups"]["charge_nurse"])
    desk = Group(tenant_id=w["tenant"].id, slug="personel_masasi", name="Personel Masası")
    desk.permissions = [GroupPermission(permission=k) for k in
                        sorted(set(w["groups"]["nurse"].permission_keys) | {"users.manage"})]
    db.add(desk)
    await db.commit()
    w["desk"] = await add_user(db, username="masa", tenant_id=w["tenant"].id, group=desk)
    w["nurse"] = await add_user(db, username="hemsire", tenant_id=w["tenant"].id,
                                group=w["groups"]["nurse"])
    directory = w["directory"]
    w["mkaya"] = directory.add(person("MKaya", groups=(group_dn("YB-Sorumlu"),)))
    w["bdemir"] = directory.add(person("BDemir", groups=(group_dn("YB-Hemsire"),),
                                       email="B.Demir@hastane.az", display_name="Burak Demir"))
    w["eski"] = directory.add(person("Eski", disabled=True))
    w["clash"] = directory.add(person("Admin"))
    return w


@pytest_asyncio.fixture
async def client(db_session, world):
    async with ad_client(db_session, world["directory"]) as pair:
        yield pair


def _routes(w) -> list[tuple[str, str, dict | None]]:
    """Every /admin/ldap route, each with a body an administrator could send."""
    return [
        ("GET", "/admin/ldap/status", None),
        ("POST", "/admin/ldap/test", None),
        ("GET", "/admin/ldap/search?q=kaya", None),
        ("GET", "/admin/ldap/groups?q=yb", None),
    ]


# ---------------------------------------------------------------- off, and who may ask
async def test_a_caller_without_users_manage_is_refused_everywhere_configured_or_not(
        client, world, db_session):
    c, app = client
    nurse = await bearer(db_session, world["nurse"])
    for ldap in (app.state.ldap, None):
        app.state.ldap = ldap
        for method, path, body in _routes(world):
            res = await c.request(method, path, headers=nurse, json=body)
            assert res.status_code == 403, (method, path, ldap)


async def test_without_a_directory_only_the_status_answers(client, world, db_session):
    c, app = client
    app.state.ldap = None
    admin = await bearer(db_session, world["admin"])
    res = await c.get("/admin/ldap/status", headers=admin)
    assert res.status_code == 200 and res.json() == {
        "configured": False, "url_host": None, "last_test_at": None, "last_test_ok": None}
    for method, path, body in _routes(world)[1:]:
        res = await c.request(method, path, headers=admin, json=body)
        assert (res.status_code, res.json()["detail"]) == (409, NOT_CONFIGURED), (method, path)


# ---------------------------------------------------------------- status and connection test
async def test_the_status_reports_the_last_connection_test(client, world, db_session):
    c, app = client
    admin = await bearer(db_session, world["admin"])
    status = (await c.get("/admin/ldap/status", headers=admin)).json()
    assert (status["configured"], status["url_host"], status["last_test_ok"]) == (
        True, "dc1.hastane.local", None)
    res = await c.post("/admin/ldap/test", headers=admin)
    assert res.status_code == 200 and (res.json()["ok"], res.json()["reason"]) == (True, None)
    world["directory"].unavailable = True
    res = await c.post("/admin/ldap/test", headers=admin)
    assert res.status_code == 200
    assert (res.json()["ok"], res.json()["reason"]) == (False, "unreachable")
    status = (await c.get("/admin/ldap/status", headers=admin)).json()
    assert status["last_test_ok"] is False and status["last_test_at"] is not None
    assert [r.payload["after"] for r in audit_events(app, "admin", "ldap.test")] == [
        {"ok": True, "reason": None}, {"ok": False, "reason": "unreachable"}]


# ---------------------------------------------------------------- searches
async def test_the_search_flags_accounts_already_imported(client, world, db_session):
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    rows = (await c.get("/admin/ldap/search?q=yilmaz", headers=admin)).json()
    assert [(r["username"], r["already_imported"]) for r in rows] == [("AYilmaz", True)]
    assert rows[0]["external_id"] == world["ayse"].identity.external_id
    assert set(rows[0]) == {"external_id", "username", "upn", "email", "display_name", "dn",
                            "disabled", "already_imported"}
    rows = (await c.get("/admin/ldap/search?q=kaya", headers=admin)).json()
    assert [(r["username"], r["already_imported"]) for r in rows] == [("MKaya", False)]


async def test_a_search_needs_two_characters(client, world, db_session):
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    assert (await c.get("/admin/ldap/search?q=k", headers=admin)).status_code == 422
    assert (await c.get("/admin/ldap/search", headers=admin)).status_code == 422
    assert world["directory"].calls == []


async def test_a_search_with_the_directory_down_is_503(client, world, db_session):
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    world["directory"].unavailable = True
    for path in ("/admin/ldap/search?q=kaya", "/admin/ldap/groups?q=yb"):
        res = await c.get(path, headers=admin)
        assert (res.status_code, res.json()["detail"]) == (503, "Dizin sunucusuna ulaşılamıyor")


async def test_the_group_picker_lists_ad_groups(client, world, db_session):
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    rows = (await c.get("/admin/ldap/groups?q=yb", headers=admin)).json()
    assert sorted(r["name"] for r in rows) == ["YB-Hekim", "YB-Hemsire", "YB-Sorumlu"]
    assert {r["dn"] for r in rows} == {group_dn(n) for n in ("YB-Hekim", "YB-Hemsire",
                                                             "YB-Sorumlu")}


async def test_a_user_desk_may_search(client, world, db_session):
    c, _ = client
    desk = await bearer(db_session, world["desk"])
    assert (await c.get("/admin/ldap/search?q=kaya", headers=desk)).status_code == 200
```

In `homunculus-engine/tests/test_route_permissions.py`:

Add to `GUARDED_MODULES`, after `"homunculus.admin.router",`:

```python
    "homunculus.admin.ldap_router",
```

In `EXPECTED`, after the line `    ("POST", "/admin/users/{user_id}/reset-mfa"): ANY(_U),` add:

```python
    # admin/ldap_router.py (spec §5: /admin/ldap/* users.manage)
    ("GET", "/admin/ldap/status"): ANY(_U),
    ("POST", "/admin/ldap/test"): ANY(_U),
    ("GET", "/admin/ldap/search"): ANY(_U),
    ("GET", "/admin/ldap/groups"): ANY(_U),
```

Replace

```python
def test_the_table_covers_all_45_guarded_routes():
    assert len(EXPECTED) == 45
```
with
```python
def test_the_table_covers_every_guarded_route():
    assert len(EXPECTED) == 49
```

In `homunculus-engine/tests/test_route_inventory.py`, replace

```python
    assert {r.path for r in _routes() if r.path.startswith("/admin/")} >= {
        "/admin/permissions", "/admin/groups", "/admin/users"}
```
with
```python
    assert {r.path for r in _routes() if r.path.startswith("/admin/")} >= {
        "/admin/permissions", "/admin/groups", "/admin/users", "/admin/ldap/status"}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest tests/test_admin_ldap_api.py tests/test_route_permissions.py tests/test_route_inventory.py -q -p no:cacheprovider
```
Expected: the 8 `test_admin_ldap_api.py` tests fail (404 for every `/admin/ldap` path), and so do `test_no_table_entry_lacks_a_route` (four rows without a route) and `test_the_admin_router_is_mounted_and_walked`. The count test already passes (49 rows).

- [ ] **Step 3: The response models (`admin/schemas.py`)**

Append to `homunculus-engine/src/homunculus/admin/schemas.py`:

```python


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
```

- [ ] **Step 4: The service (`admin/ldap_service.py`)**

Create `homunculus-engine/src/homunculus/admin/ldap_service.py`:

```python
"""The /admin/ldap logic (spec §7, "Import and mapping"). The same rules as the rest of /admin
(`admin/service.py`): the tenant lock first (`serialise`, which the router calls), nobody grants
beyond their own rights, and every change that can take administrator rights away ends with
`count_admins`, which counts LOCAL administrators only. Errors are AdminError; the router turns
them into HTTP and rolls back.

It borrows `admin/service.py`'s private helpers (`_within`, `_grantable`, `_rights_by_user`,
`_union`, `_flush`) on purpose: one implementation of the rights rule, not two."""
from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.models import User

RESULT_CAP = 50


async def imported_ids(db: AsyncSession, external_ids: Iterable[str]) -> set[str]:
    """Which of these objectGUIDs already have a Homunculus account (in any tenant)."""
    ids = [i for i in external_ids if i]
    if not ids:
        return set()
    rows = await db.execute(select(User.external_id).where(User.external_id.in_(ids)))
    return {value for value in rows.scalars().all() if value is not None}
```

- [ ] **Step 5: The router (`admin/ldap_router.py`)**

Create `homunculus-engine/src/homunculus/admin/ldap_router.py`:

```python
"""
/admin/ldap — the Active Directory side of user administration (spec §7, "Import and
mapping"). Every route needs `users.manage` and resolves the caller's tenant:

  GET    /admin/ldap/status        configured?, the directory's host, the last connection test
  POST   /admin/ldap/test          bind with the service account now (200 {ok, reason})
  GET    /admin/ldap/search?q=     AD accounts (at most 50), each flagged already_imported
  GET    /admin/ldap/groups?q=     AD groups (at most 50), for the mapping picker

With LDAP off (LDAP_URL unset) every route but `status` answers 409 `Dizin yapılandırılmamış`;
`status` answers `configured: false`, so the panel can hide itself (plan decision D14). A
caller without `users.manage` gets 403 first, configured or not. A directory that does not
answer is 503 `Dizin sunucusuna ulaşılamıyor`. The service account's password never appears in
a response. Writes follow `admin/router.py`: `_begin` (the tenant lock and a re-read of the
caller), AdminError → rollback, the audit row after the commit.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admin import ldap_service
from homunculus.admin.router import _audit
from homunculus.admin.schemas import LdapGroupOut, LdapStatusOut, LdapTestOut, LdapUserOut
from homunculus.auth.dependencies import (
    Principal, caller_tenant_id, get_principal, require_permission,
)
from homunculus.auth.ldap import (
    DIRECTORY_DOWN, NOT_CONFIGURED, LdapIdentity, LdapRuntime, LdapUnavailable, get_ldap,
)
from homunculus.db import get_db

router = APIRouter(prefix="/admin/ldap", tags=["admin"])

_users = [Depends(require_permission("users.manage"))]
# Every route resolves the caller's tenant (tests/test_tenant_isolation.py demands it), a
# search included: the directory is one per deployment, the caller is not.
_users_here = [*_users, Depends(caller_tenant_id)]


def configured_ldap(ldap: LdapRuntime | None = Depends(get_ldap)) -> LdapRuntime:
    """The directory, or 409 when LDAP is off. Resolved after the permission guard, so a caller
    without `users.manage` learns nothing about the configuration."""
    if ldap is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=NOT_CONFIGURED)
    return ldap


def _directory_down() -> HTTPException:
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=DIRECTORY_DOWN)


def _identity_out(identity: LdapIdentity, imported: bool) -> LdapUserOut:
    return LdapUserOut(external_id=identity.external_id, username=identity.username,
                       upn=identity.upn, email=identity.email,
                       display_name=identity.display_name, dn=identity.dn,
                       disabled=identity.disabled, already_imported=imported)


@router.get("/status", response_model=LdapStatusOut, dependencies=_users_here)
async def ldap_status(ldap: LdapRuntime | None = Depends(get_ldap)) -> LdapStatusOut:
    if ldap is None:
        return LdapStatusOut(configured=False)
    return LdapStatusOut(configured=True, url_host=ldap.url_host,
                         last_test_at=ldap.last_test_at, last_test_ok=ldap.last_test_ok)


@router.post("/test", response_model=LdapTestOut, dependencies=_users_here)
async def ldap_test(request: Request, principal: Principal = Depends(get_principal),
                    ldap: LdapRuntime = Depends(configured_ldap)) -> LdapTestOut:
    ok, reason = await ldap.test()
    _audit(request, principal, "ldap.test", ldap.url_host, after={"ok": ok, "reason": reason})
    return LdapTestOut(ok=ok, reason=reason, checked_at=ldap.last_test_at)


@router.get("/search", response_model=list[LdapUserOut], dependencies=_users_here)
async def ldap_search(q: str = Query(min_length=2, max_length=64),
                      ldap: LdapRuntime = Depends(configured_ldap),
                      db: AsyncSession = Depends(get_db)) -> list[LdapUserOut]:
    try:
        found = await ldap.directory.search_users(q, ldap_service.RESULT_CAP)
    except LdapUnavailable:
        raise _directory_down() from None
    found = found[:ldap_service.RESULT_CAP]
    imported = await ldap_service.imported_ids(db, [i.external_id for i in found])
    return [_identity_out(i, i.external_id in imported) for i in found]


@router.get("/groups", response_model=list[LdapGroupOut], dependencies=_users_here)
async def ldap_groups(q: str = Query(min_length=2, max_length=64),
                      ldap: LdapRuntime = Depends(configured_ldap)) -> list[LdapGroupOut]:
    try:
        found = await ldap.directory.search_groups(q, ldap_service.RESULT_CAP)
    except LdapUnavailable:
        raise _directory_down() from None
    return [LdapGroupOut(dn=g.dn, name=g.name) for g in found[:ldap_service.RESULT_CAP]]
```

- [ ] **Step 6: Mount it (`api/app.py`)**

In `homunculus-engine/src/homunculus/api/app.py`, after the line `    from homunculus.admin.router import router as admin_router` add:

```python
    from homunculus.admin.ldap_router import router as ldap_admin_router
```

and after the line `    app.include_router(admin_router)` add:

```python
    app.include_router(ldap_admin_router)
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
PYTHONPATH=src "$PY" -m pytest tests/test_admin_ldap_api.py tests/test_route_permissions.py tests/test_route_inventory.py tests/test_tenant_isolation.py tests/test_nginx_routes.py -q -p no:cacheprovider
```
Expected: all pass (`test_admin_ldap_api.py`: 8). `test_tenant_isolation.py::test_every_route_resolves_the_callers_tenant_unless_unscoped_by_design` passes because every new route depends on `caller_tenant_id`; `test_nginx_routes.py` passes because `/admin` is already proxied.

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/homunculus-g1
git add homunculus-engine/src/homunculus/admin/ldap_service.py homunculus-engine/src/homunculus/admin/ldap_router.py homunculus-engine/src/homunculus/admin/schemas.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_admin_ldap_api.py homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_route_inventory.py
git commit -m "feat(ldap): /admin/ldap status, connection test, account and group search (G1-04)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10 (G1-04b): `POST /admin/ldap/import`

**Files:**
- Modify: `homunculus-engine/src/homunculus/admin/ldap_service.py` (import block; append `import_users`)
- Modify: `homunculus-engine/src/homunculus/admin/ldap_router.py` (docstring; import block; append the route)
- Modify: `homunculus-engine/src/homunculus/admin/schemas.py` (append)
- Modify: `homunculus-engine/tests/test_route_permissions.py` (one row; count 50)
- Modify: `homunculus-engine/tests/test_admin_ldap_api.py` (import block; `_routes`; append tests)

- [ ] **Step 1: Write the failing tests**

In `homunculus-engine/tests/test_admin_ldap_api.py`, replace the import block (from `from __future__ import annotations` through `from tests.signed_in import add_user, bearer`) with:

```python
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import func, select

from homunculus.auth.groups import ensure_default_groups
from homunculus.auth.ldap import NOT_CONFIGURED
from homunculus.auth.models import Group, GroupPermission, User
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db
from tests.fake_directory import (
    AD_PASSWORD, ad_client, ad_world, add_mapping, audit_events, group_dn, person,
)
from tests.signed_in import add_user, bearer
```

In `_routes`, after the line `        ("GET", "/admin/ldap/groups?q=yb", None),` add:

```python
        ("POST", "/admin/ldap/import", {"external_ids": [w["mkaya"].identity.external_id]}),
```

Append to the end of the file:

```python
# ---------------------------------------------------------------- import
async def _imported(db, *external_ids) -> int:
    return (await db.execute(select(func.count()).select_from(User)
                             .where(User.external_id.in_(external_ids)))).scalar_one()


async def test_import_creates_directory_accounts_with_mapped_and_extra_groups(client, world,
                                                                            db_session):
    c, app = client
    admin = await bearer(db_session, world["admin"])
    mkaya = world["mkaya"].identity
    res = await c.post("/admin/ldap/import", headers=admin, json={
        "external_ids": [mkaya.external_id],
        "extra_group_ids": [str(world["groups"]["physician"].id)]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["skipped"] == []
    [row] = body["imported"]
    assert (row["external_id"], row["username"]) == (mkaya.external_id, "mkaya")
    assert [(g["slug"], g["source"]) for g in row["groups"]] == [
        ("charge_nurse", "ldap"), ("physician", "manual")]
    user = (await db_session.execute(select(User).where(User.external_id == mkaya.external_id))
            ).scalar_one()
    assert (user.auth_source, user.hashed_password, user.email, user.full_name, user.ldap_dn) \
        == ("ldap", None, None, "Mkaya", mkaya.dn)
    signed_in = await c.post("/auth/login", json={"login": "mkaya", "password": AD_PASSWORD})
    assert signed_in.status_code == 200
    assert [r.payload["after"]["username"] for r in audit_events(app, "admin", "ldap.import")] \
        == ["mkaya"]


async def test_import_is_idempotent_and_says_what_it_skipped(client, world, db_session):
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    unknown = str(uuid.uuid4())
    ids = [world["mkaya"].identity.external_id, world["ayse"].identity.external_id,
           world["eski"].identity.external_id, world["clash"].identity.external_id, unknown]
    body = (await c.post("/admin/ldap/import", headers=admin, json={"external_ids": ids})).json()
    assert [r["username"] for r in body["imported"]] == ["mkaya"]
    assert [(s["external_id"], s["reason"]) for s in body["skipped"]] == [
        (ids[1], "exists"), (ids[2], "disabled"), (ids[3], "login_taken"), (unknown, "not_found")]
    again = (await c.post("/admin/ldap/import", headers=admin,
                          json={"external_ids": ids[:1]})).json()
    assert again == {"imported": [], "skipped": [{"external_id": ids[0], "reason": "exists"}]}


async def test_a_user_desk_imports_only_within_its_rights(client, world, db_session):
    c, _ = client
    desk = await bearer(db_session, world["desk"])
    mkaya, bdemir = world["mkaya"].identity, world["bdemir"].identity
    res = await c.post("/admin/ldap/import", headers=desk,
                       json={"external_ids": [mkaya.external_id]})       # maps to charge_nurse
    assert res.status_code == 403 and "Kendi yetkilerinizi aşan" in res.json()["detail"]
    res = await c.post("/admin/ldap/import", headers=desk, json={
        "external_ids": [bdemir.external_id],
        "extra_group_ids": [str(world["groups"]["physician"].id)]})
    assert res.status_code == 403
    assert await _imported(db_session, mkaya.external_id, bdemir.external_id) == 0
    res = await c.post("/admin/ldap/import", headers=desk,
                       json={"external_ids": [bdemir.external_id]})      # maps to nurse
    assert res.status_code == 200
    assert [g["slug"] for g in res.json()["imported"][0]["groups"]] == ["nurse"]


async def test_an_import_with_the_directory_down_is_503_and_writes_nothing(client, world,
                                                                         db_session):
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    world["directory"].unavailable = True
    res = await c.post("/admin/ldap/import", headers=admin,
                       json={"external_ids": [world["mkaya"].identity.external_id]})
    assert (res.status_code, res.json()["detail"]) == (503, "Dizin sunucusuna ulaşılamıyor")
    assert await _imported(db_session, world["mkaya"].identity.external_id) == 0


@pytest.mark.parametrize("body", [
    {"external_ids": []}, {"external_ids": ["not-a-guid"]},
    {"external_ids": [str(uuid.uuid4()) for _ in range(51)]},
])
async def test_the_import_body_is_bounded(client, world, db_session, body):
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    assert (await c.post("/admin/ldap/import", headers=admin, json=body)).status_code == 422
```

In `homunculus-engine/tests/test_route_permissions.py`, after `    ("GET", "/admin/ldap/groups"): ANY(_U),` add:

```python
    ("POST", "/admin/ldap/import"): ANY(_U),
```

and change `    assert len(EXPECTED) == 49` to `    assert len(EXPECTED) == 50`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest tests/test_admin_ldap_api.py tests/test_route_permissions.py -q -p no:cacheprovider
```
Expected: the 7 new import tests fail (404 for `/admin/ldap/import`), the two "every route" tests fail on the import row (404 where 403 or 409 is expected), and `test_no_table_entry_lacks_a_route` fails on the new row.

- [ ] **Step 3: The request/response models (`admin/schemas.py`)**

Append to `homunculus-engine/src/homunculus/admin/schemas.py`:

```python


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
    reason: str          # exists | not_found | disabled | login_taken | no_username


class LdapImportOut(BaseModel):
    imported: list[LdapImportedOut]
    skipped: list[LdapSkippedOut]
```

- [ ] **Step 4: The import (`admin/ldap_service.py`)**

In `homunculus-engine/src/homunculus/admin/ldap_service.py`, replace the import block (from `from collections.abc import Iterable` through `from homunculus.auth.models import User`) with:

```python
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admin.service import LOGIN_TAKEN, Actor, _flush, _grantable
from homunculus.auth.groups import set_manual_groups
from homunculus.auth.ldap import LdapIdentity
from homunculus.auth.ldap_sync import login_in_use, mapped_group_ids, sync_ldap_groups
from homunculus.auth.models import AUTH_LDAP, TenantMembership, User
from homunculus.auth.service import normalize_login
```

Append to the end of the file:

```python
# ---------------------------------------------------------------- import (plan decision D12)
SKIP_EXISTS = "exists"
SKIP_NOT_FOUND = "not_found"
SKIP_DISABLED = "disabled"
SKIP_LOGIN_TAKEN = "login_taken"
SKIP_NO_USERNAME = "no_username"
_USERNAME_MAX = 128    # users.username
_EMAIL_MAX = 254       # users.email
_NAME_MAX = 200        # users.full_name


@dataclass(frozen=True)
class Imported:
    external_id: str
    user_id: uuid.UUID


@dataclass
class ImportReport:
    imported: list[Imported] = field(default_factory=list)
    skipped: list[tuple[str, str]] = field(default_factory=list)


async def import_users(db: AsyncSession, tenant_id: uuid.UUID, actor: Actor,
                       external_ids: list[str], identities: Mapping[str, LdapIdentity | None],
                       *, extra_group_ids: list[uuid.UUID]) -> ImportReport:
    """Spec §7 import, in the order given (ids already canonical). Call under the tenant lock
    (`serialise`). `identities` holds the directory's answer for every id that had no account
    when the request began (fetched before the lock); an id imported since is caught by the
    re-check here. Each created account: auth_source ldap, no password, username = the
    sAMAccountName lower-cased, email = mail (dropped when another account uses it),
    full_name = displayName, a membership in this tenant, the mapped groups as `ldap` rows and
    `extra_group_ids` as `manual` rows — every one of those groups within the caller's rights,
    or 403 for the whole request."""
    await _grantable(db, tenant_id, actor, extra_group_ids)
    existing = await imported_ids(db, external_ids)
    report = ImportReport()
    for external_id in external_ids:
        identity = identities.get(external_id)
        if external_id in existing:
            report.skipped.append((external_id, SKIP_EXISTS))
            continue
        if identity is None:
            report.skipped.append((external_id, SKIP_NOT_FOUND))
            continue
        if identity.disabled:
            report.skipped.append((external_id, SKIP_DISABLED))
            continue
        username = normalize_login(identity.username)
        if not username or len(username) > _USERNAME_MAX:
            report.skipped.append((external_id, SKIP_NO_USERNAME))
            continue
        if await login_in_use(db, username):
            report.skipped.append((external_id, SKIP_LOGIN_TAKEN))
            continue
        await _grantable(db, tenant_id, actor,
                         await mapped_group_ids(db, tenant_id, identity.group_dns))
        mail = normalize_login(identity.email) or None
        if mail is not None and (len(mail) > _EMAIL_MAX or await login_in_use(db, mail)):
            mail = None
        name = ((identity.display_name or "").strip() or identity.username)[:_NAME_MAX]
        user = User(username=username, email=mail, full_name=name, hashed_password=None,
                    auth_source=AUTH_LDAP, external_id=external_id, ldap_dn=identity.dn)
        db.add(user)
        await _flush(db, LOGIN_TAKEN)              # a concurrent create took the name
        db.add(TenantMembership(user_id=user.id, tenant_id=tenant_id, granted_by_id=actor.id))
        await db.flush()
        await sync_ldap_groups(db, user=user, tenant_id=tenant_id, group_dns=identity.group_dns)
        if extra_group_ids:
            await set_manual_groups(db, user=user, tenant_id=tenant_id,
                                    group_ids=extra_group_ids, granted_by_id=actor.id)
        existing.add(external_id)
        report.imported.append(Imported(external_id=external_id, user_id=user.id))
    return report
```

- [ ] **Step 5: The route (`admin/ldap_router.py`)**

In the module docstring, after the line `  GET    /admin/ldap/groups?q=     AD groups (at most 50), for the mapping picker` add:

```
  POST   /admin/ldap/import        create accounts from AD (idempotent; plan decision D12)
```

Replace the import block (from `from fastapi import APIRouter` through `from homunculus.db import get_db`) with:

```python
import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admin import ldap_service
from homunculus.admin.router import _audit, _begin, _run
from homunculus.admin.router import _user_out as _admin_user_out
from homunculus.admin.schemas import (
    LdapGroupOut, LdapImportedOut, LdapImportIn, LdapImportOut, LdapSkippedOut, LdapStatusOut,
    LdapTestOut, LdapUserOut,
)
from homunculus.admin.service import get_tenant_user
from homunculus.auth.dependencies import (
    Principal, caller_tenant_id, get_principal, require_permission,
)
from homunculus.auth.ldap import (
    DIRECTORY_DOWN, NOT_CONFIGURED, LdapIdentity, LdapRuntime, LdapUnavailable, get_ldap,
)
from homunculus.db import get_db
```

Append to the end of the file:

```python
@router.post("/import", response_model=LdapImportOut, dependencies=_users)
async def ldap_import(body: LdapImportIn, request: Request,
                      principal: Principal = Depends(get_principal),
                      tenant_id: uuid.UUID = Depends(caller_tenant_id),
                      ldap: LdapRuntime = Depends(configured_ldap),
                      db: AsyncSession = Depends(get_db)) -> LdapImportOut:
    """The directory is asked first, before the tenant lock — a slow directory must not hold up
    every other /admin write — and only about ids that have no account yet. A directory that
    does not answer is 503 with nothing written. Then the import, under the lock, in one
    transaction; one `ldap.import` audit row per created account, after the commit."""
    wanted = list(dict.fromkeys(str(i) for i in body.external_ids))
    known = await ldap_service.imported_ids(db, wanted)
    fresh = [eid for eid in wanted if eid not in known]
    try:
        answers = await asyncio.gather(
            *(ldap.directory.find_by_external_id(eid) for eid in fresh))
    except LdapUnavailable:
        raise _directory_down() from None
    actor = await _begin(db, tenant_id, principal)
    report = await _run(db, ldap_service.import_users(
        db, tenant_id, actor, wanted, dict(zip(fresh, answers)),
        extra_group_ids=list(dict.fromkeys(body.extra_group_ids))))
    await db.commit()
    imported: list[LdapImportedOut] = []
    for row in report.imported:
        user = await get_tenant_user(db, tenant_id, row.user_id)
        groups = _admin_user_out(user, tenant_id).groups
        imported.append(LdapImportedOut(external_id=row.external_id, id=user.id,
                                        username=user.username, groups=groups))
        _audit(request, principal, "ldap.import", str(user.id),
               after={"username": user.username, "external_id": row.external_id,
                      "groups": [g.slug for g in groups]})
    return LdapImportOut(imported=imported,
                         skipped=[LdapSkippedOut(external_id=e, reason=r)
                                  for e, r in report.skipped])
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
PYTHONPATH=src "$PY" -m pytest tests/test_admin_ldap_api.py tests/test_route_permissions.py tests/test_tenant_isolation.py tests/test_admin_api.py -q -p no:cacheprovider
```
Expected: all pass (`test_admin_ldap_api.py`: 15).

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/homunculus-g1
git add homunculus-engine/src/homunculus/admin/ldap_service.py homunculus-engine/src/homunculus/admin/ldap_router.py homunculus-engine/src/homunculus/admin/schemas.py homunculus-engine/tests/test_admin_ldap_api.py homunculus-engine/tests/test_route_permissions.py
git commit -m "feat(ldap): import AD accounts — idempotent, mapped and extra groups within the caller's rights (G1-04)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11 (G1-04c): the AD group → group mapping table

**Files:**
- Modify: `homunculus-engine/src/homunculus/admin/ldap_service.py` (import block; append the mapping functions)
- Modify: `homunculus-engine/src/homunculus/admin/ldap_router.py` (docstring; import block; append three routes)
- Modify: `homunculus-engine/src/homunculus/admin/schemas.py` (append)
- Modify: `homunculus-engine/tests/test_route_permissions.py` (three rows; count 53)
- Modify: `homunculus-engine/tests/test_admin_ldap_api.py` (import block; `_routes`; append tests)

- [ ] **Step 1: Write the failing tests**

In `homunculus-engine/tests/test_admin_ldap_api.py`, replace the `tests.fake_directory` import with:

```python
from tests.fake_directory import (
    AD_PASSWORD, ADMIN_PASSWORD, ad_client, ad_world, add_mapping, audit_events, group_dn,
    group_rows, person,
)
```

In `_routes`, after the import row add:

```python
        ("GET", "/admin/ldap/group-mappings", None),
        ("POST", "/admin/ldap/group-mappings",
         {"ad_group_dn": group_dn("YB-Eczaci"), "group_id": str(w["groups"]["pharmacist"].id)}),
        ("DELETE", f"/admin/ldap/group-mappings/{w['mappings']['YB-Hekim'].id}", None),
```

Append to the end of the file:

```python
# ---------------------------------------------------------------- the mapping table
async def test_the_mapping_table_shows_this_tenants_rows(client, world, db_session):
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    rows = (await c.get("/admin/ldap/group-mappings", headers=admin)).json()
    assert [(r["ad_group_dn"], r["group_slug"]) for r in rows] == [
        (group_dn("YB-Hekim").lower(), "physician"), (group_dn("YB-Hemsire").lower(), "nurse"),
        (group_dn("YB-Sorumlu").lower(), "charge_nurse")]
    assert str(world["foreign_mapping"].id) not in {r["id"] for r in rows}


async def test_a_mapping_is_stored_once_with_its_dn_lowercased(client, world, db_session):
    c, app = client
    admin = await bearer(db_session, world["admin"])
    body = {"ad_group_dn": "  CN=YB-Eczaci,OU=Gruplar,DC=HASTANE,DC=LOCAL ",
            "group_id": str(world["groups"]["pharmacist"].id)}
    res = await c.post("/admin/ldap/group-mappings", headers=admin, json=body)
    assert res.status_code == 201, res.text
    assert (res.json()["ad_group_dn"], res.json()["group_slug"]) == (
        "cn=yb-eczaci,ou=gruplar,dc=hastane,dc=local", "pharmacist")
    again = await c.post("/admin/ldap/group-mappings", headers=admin, json={
        **body, "ad_group_dn": "cn=yb-eczaci,ou=gruplar,dc=hastane,dc=local"})
    assert (again.status_code, again.json()["detail"]) == (409, "Bu AD grubu bu gruba zaten eşlenmiş")
    foreign = await c.post("/admin/ldap/group-mappings", headers=admin, json={
        **body, "group_id": str(world["other_groups"]["nurse"].id)})
    assert foreign.status_code == 422
    short = await c.post("/admin/ldap/group-mappings", headers=admin,
                         json={**body, "ad_group_dn": "yb"})
    assert short.status_code == 422
    assert [r.payload["after"] for r in audit_events(app, "admin", "ldap.mapping.create")] == [
        {"ad_group_dn": "cn=yb-eczaci,ou=gruplar,dc=hastane,dc=local", "group": "pharmacist"}]


async def test_deleting_a_mapping_takes_the_rights_it_gave_away_now(client, world, db_session):
    c, app = client
    admin = await bearer(db_session, world["admin"])
    ayse_id = world["account"].id
    res = await c.put(f"/admin/users/{ayse_id}/groups", headers=admin,
                      json={"group_ids": [str(world["groups"]["charge_nurse"].id)]})
    assert res.status_code == 200
    login = await c.post("/auth/login", json={"login": "ayilmaz", "password": AD_PASSWORD})
    ayse = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert (await c.get("/auth/me", headers=ayse)).status_code == 200
    mapping = world["mappings"]["YB-Hemsire"]
    res = await c.delete(f"/admin/ldap/group-mappings/{mapping.id}", headers=admin)
    assert res.status_code == 204
    assert (await c.get("/auth/me", headers=ayse)).status_code == 401      # tokens retired
    assert await group_rows(db_session, ayse_id) == {("charge_nurse", "manual")}
    [event] = audit_events(app, "admin", "ldap.mapping.delete")
    assert event.payload["before"] == {"ad_group_dn": group_dn("YB-Hemsire").lower(),
                                       "group": "nurse"}
    assert event.payload["after"] == {"removed_from": ["ayilmaz"]}
    assert (await c.delete(f"/admin/ldap/group-mappings/{mapping.id}",
                           headers=admin)).status_code == 404
    assert (await c.delete(f"/admin/ldap/group-mappings/{world['foreign_mapping'].id}",
                           headers=admin)).status_code == 404


async def test_a_user_desk_cannot_map_or_unmap_beyond_its_rights(client, world, db_session):
    c, _ = client
    desk = await bearer(db_session, world["desk"])
    admin = await bearer(db_session, world["admin"])
    res = await c.post("/admin/ldap/group-mappings", headers=desk, json={
        "ad_group_dn": group_dn("YB-Yeni"), "group_id": str(world["groups"]["charge_nurse"].id)})
    assert res.status_code == 403
    res = await c.delete(f"/admin/ldap/group-mappings/{world['mappings']['YB-Sorumlu'].id}",
                         headers=desk)
    assert res.status_code == 403                    # the group is above the desk
    assert (await c.post("/auth/login", json={"login": "ayilmaz",
                                              "password": AD_PASSWORD})).status_code == 200
    ayse_id = world["account"].id
    res = await c.put(f"/admin/users/{ayse_id}/groups", headers=admin,
                      json={"group_ids": [str(world["groups"]["physician"].id)]})
    assert res.status_code == 200
    hemsire = world["mappings"]["YB-Hemsire"].id
    res = await c.delete(f"/admin/ldap/group-mappings/{hemsire}", headers=desk)
    assert res.status_code == 403                    # a member it takes rights from is above it
    res = await c.put(f"/admin/users/{ayse_id}/groups", headers=admin, json={"group_ids": []})
    assert res.status_code == 200
    assert (await c.delete(f"/admin/ldap/group-mappings/{hemsire}",
                           headers=desk)).status_code == 204


async def test_ldap_admin_changes_are_audited_without_a_secret(client, world, db_session):
    c, app = client
    admin = await bearer(db_session, world["admin"])
    await c.post("/admin/ldap/test", headers=admin)
    await c.post("/admin/ldap/import", headers=admin,
                 json={"external_ids": [world["bdemir"].identity.external_id]})
    created = (await c.post("/admin/ldap/group-mappings", headers=admin, json={
        "ad_group_dn": group_dn("YB-Eczaci"),
        "group_id": str(world["groups"]["pharmacist"].id)})).json()
    assert (await c.delete(f"/admin/ldap/group-mappings/{created['id']}",
                           headers=admin)).status_code == 204
    records = [r for r in app.state.audit.records(event_type="admin", limit=10_000)
               if r.subject.startswith("ldap.")]
    assert {r.subject for r in records} == {
        "ldap.test", "ldap.import", "ldap.mapping.create", "ldap.mapping.delete"}
    assert {r.payload["actor"] for r in records} == {"admin"}
    trail = str([r.payload for r in records])
    assert AD_PASSWORD not in trail and ADMIN_PASSWORD not in trail
```

In `homunculus-engine/tests/test_route_permissions.py`, after `    ("POST", "/admin/ldap/import"): ANY(_U),` add:

```python
    ("GET", "/admin/ldap/group-mappings"): ANY(_U),
    ("POST", "/admin/ldap/group-mappings"): ANY(_U),
    ("DELETE", "/admin/ldap/group-mappings/{mapping_id}"): ANY(_U),
```

and change `    assert len(EXPECTED) == 50` to `    assert len(EXPECTED) == 53`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest tests/test_admin_ldap_api.py tests/test_route_permissions.py -q -p no:cacheprovider
```
Expected: the 5 new mapping tests and the two "every route" tests fail (404 or 405 for `/admin/ldap/group-mappings`), and `test_no_table_entry_lacks_a_route` fails on the three new rows.

- [ ] **Step 3: The request/response models (`admin/schemas.py`)**

Append to `homunculus-engine/src/homunculus/admin/schemas.py`:

```python


class LdapMappingIn(BaseModel):
    ad_group_dn: str = Field(min_length=3, max_length=2048)
    group_id: uuid.UUID

    @field_validator("ad_group_dn")
    @classmethod
    def _looks_like_a_dn(cls, value: str) -> str:
        value = value.strip()
        if "=" not in value:
            raise ValueError("ad_group_dn must be a distinguished name (CN=…,DC=…)")
        return value


class LdapMappingOut(BaseModel):
    id: uuid.UUID
    ad_group_dn: str
    group_id: uuid.UUID
    group_slug: str
    group_name: str
    created_at: datetime
```

- [ ] **Step 4: The mapping functions (`admin/ldap_service.py`)**

Replace the import block (from `import uuid` through `from homunculus.auth.service import normalize_login`) with:

```python
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from homunculus.admin.service import (
    LAST_ADMIN, LOGIN_TAKEN, UNKNOWN_GROUP, Actor, AdminError, _flush, _grantable,
    _rights_by_user, _union, _within, get_group, group_rights,
)
from homunculus.auth.groups import count_admins, set_manual_groups
from homunculus.auth.ldap import LdapIdentity
from homunculus.auth.ldap_sync import (
    login_in_use, mapped_group_ids, normalise_dn, sync_ldap_groups,
)
from homunculus.auth.models import (
    AUTH_LDAP, SOURCE_LDAP, Group, LdapGroupMapping, TenantMembership, User, UserGroup,
)
from homunculus.auth.service import normalize_login
```

Append to the end of the file:

```python
# ---------------------------------------------------------------- mappings (plan decision D13)
MAPPING_EXISTS = "Bu AD grubu bu gruba zaten eşlenmiş"
MAPPING_NOT_FOUND = "Mapping not found"


async def list_mappings(db: AsyncSession,
                        tenant_id: uuid.UUID) -> list[tuple[LdapGroupMapping, Group]]:
    rows = await db.execute(
        select(LdapGroupMapping, Group).join(Group, Group.id == LdapGroupMapping.group_id)
        .where(LdapGroupMapping.tenant_id == tenant_id)
        .order_by(LdapGroupMapping.ad_group_dn, Group.slug))
    return [(mapping, group) for mapping, group in rows.all()]


async def create_mapping(db: AsyncSession, tenant_id: uuid.UUID, actor: Actor, *,
                         ad_group_dn: str, group_id: uuid.UUID) -> tuple[LdapGroupMapping, Group]:
    """AD group (DN, stored and compared lower-case) → this tenant's group. The group must be
    this tenant's (422, as for any group named in a body) and within the caller's rights
    (403). It changes nobody now: each account picks it up at its next sign-in or token
    refresh, and at import."""
    group = (await db.execute(select(Group).where(
        Group.id == group_id, Group.tenant_id == tenant_id))).scalar_one_or_none()
    if group is None:
        raise AdminError(422, UNKNOWN_GROUP)
    _within(actor, group_rights(group))
    dn = normalise_dn(ad_group_dn)
    taken = (await db.execute(select(LdapGroupMapping.id).where(
        LdapGroupMapping.tenant_id == tenant_id, LdapGroupMapping.ad_group_dn == dn,
        LdapGroupMapping.group_id == group.id))).first()
    if taken is not None:
        raise AdminError(409, MAPPING_EXISTS)
    mapping = LdapGroupMapping(tenant_id=tenant_id, ad_group_dn=dn, group_id=group.id,
                               created_by_id=actor.id)
    db.add(mapping)
    await _flush(db, MAPPING_EXISTS)                 # a concurrent create took the row
    return mapping, group


@dataclass(frozen=True)
class RemovedMapping:
    ad_group_dn: str
    group_slug: str
    removed_from: tuple[str, ...]


async def delete_mapping(db: AsyncSession, tenant_id: uuid.UUID, actor: Actor,
                         mapping_id: uuid.UUID) -> RemovedMapping:
    """Remove the row AND, now, every `ldap`-sourced membership of its group in this tenant,
    retiring those users' tokens — also for users entitled to the group through another
    mapping, who get it back at their next sign-in or refresh (fail closed). Needs the group and every
    such member within the caller's rights (a deletion takes rights away from them, as a group
    edit would), then the local-administrator guard."""
    mapping = (await db.execute(select(LdapGroupMapping).where(
        LdapGroupMapping.id == mapping_id, LdapGroupMapping.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if mapping is None:
        raise AdminError(404, MAPPING_NOT_FOUND)
    group = await get_group(db, tenant_id, mapping.group_id, for_update=True)
    _within(actor, group_rights(group))
    link = aliased(UserGroup)
    holders = select(link.user_id).where(link.group_id == group.id, link.source == SOURCE_LDAP)
    for groups in (await _rights_by_user(db, tenant_id,
                                         UserGroup.user_id.in_(holders))).values():
        _within(actor, _union(groups))
    dn = mapping.ad_group_dn
    await db.delete(mapping)
    removed = list((await db.execute(
        delete(UserGroup)
        .where(UserGroup.group_id == group.id, UserGroup.source == SOURCE_LDAP)
        .returning(UserGroup.user_id)
        .execution_options(synchronize_session=False))).scalars().all())
    if removed:
        await db.execute(
            update(User).where(User.id.in_(removed))
            .values(token_version=User.token_version + 1)
            .execution_options(synchronize_session=False))
    await db.flush()
    if await count_admins(db, tenant_id) == 0:
        raise AdminError(409, LAST_ADMIN)
    names: list[str] = []
    if removed:
        names = list((await db.execute(select(User.username).where(User.id.in_(removed))
                                       .order_by(User.username))).scalars().all())
    return RemovedMapping(ad_group_dn=dn, group_slug=group.slug, removed_from=tuple(names))
```

- [ ] **Step 5: The routes (`admin/ldap_router.py`)**

In the module docstring, after the import line add:

```
  GET    /admin/ldap/group-mappings        this tenant's AD group → group table
  POST   /admin/ldap/group-mappings        add a row (applies from each user's next sign-in or refresh)
  DELETE /admin/ldap/group-mappings/{id}   remove a row and, now, the rights it gave
```

Replace the import block (from `import asyncio` through `from homunculus.db import get_db`) with:

```python
import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admin import ldap_service
from homunculus.admin.router import _audit, _begin, _run
from homunculus.admin.router import _user_out as _admin_user_out
from homunculus.admin.schemas import (
    LdapGroupOut, LdapImportedOut, LdapImportIn, LdapImportOut, LdapMappingIn, LdapMappingOut,
    LdapSkippedOut, LdapStatusOut, LdapTestOut, LdapUserOut,
)
from homunculus.admin.service import get_tenant_user
from homunculus.auth.dependencies import (
    Principal, caller_tenant_id, get_principal, require_permission,
)
from homunculus.auth.ldap import (
    DIRECTORY_DOWN, NOT_CONFIGURED, LdapIdentity, LdapRuntime, LdapUnavailable, get_ldap,
)
from homunculus.auth.models import Group, LdapGroupMapping
from homunculus.db import get_db
```

Append to the end of the file:

```python
def _mapping_out(mapping: LdapGroupMapping, group: Group) -> LdapMappingOut:
    return LdapMappingOut(id=mapping.id, ad_group_dn=mapping.ad_group_dn, group_id=group.id,
                          group_slug=group.slug, group_name=group.name,
                          created_at=mapping.created_at)


@router.get("/group-mappings", response_model=list[LdapMappingOut],
            dependencies=[*_users, Depends(configured_ldap)])
async def list_group_mappings(tenant_id: uuid.UUID = Depends(caller_tenant_id),
                              db: AsyncSession = Depends(get_db)) -> list[LdapMappingOut]:
    return [_mapping_out(m, g) for m, g in await ldap_service.list_mappings(db, tenant_id)]


@router.post("/group-mappings", response_model=LdapMappingOut,
             status_code=status.HTTP_201_CREATED,
             dependencies=[*_users, Depends(configured_ldap)])
async def create_group_mapping(body: LdapMappingIn, request: Request,
                               principal: Principal = Depends(get_principal),
                               tenant_id: uuid.UUID = Depends(caller_tenant_id),
                               db: AsyncSession = Depends(get_db)) -> LdapMappingOut:
    actor = await _begin(db, tenant_id, principal)
    mapping, group = await _run(db, ldap_service.create_mapping(
        db, tenant_id, actor, ad_group_dn=body.ad_group_dn, group_id=body.group_id))
    await db.commit()
    _audit(request, principal, "ldap.mapping.create", str(mapping.id),
           after={"ad_group_dn": mapping.ad_group_dn, "group": group.slug})
    return _mapping_out(mapping, group)


@router.delete("/group-mappings/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[*_users, Depends(configured_ldap)])
async def delete_group_mapping(mapping_id: uuid.UUID, request: Request,
                               principal: Principal = Depends(get_principal),
                               tenant_id: uuid.UUID = Depends(caller_tenant_id),
                               db: AsyncSession = Depends(get_db)) -> Response:
    actor = await _begin(db, tenant_id, principal)
    removed = await _run(db, ldap_service.delete_mapping(db, tenant_id, actor, mapping_id))
    await db.commit()
    _audit(request, principal, "ldap.mapping.delete", str(mapping_id),
           before={"ad_group_dn": removed.ad_group_dn, "group": removed.group_slug},
           after={"removed_from": list(removed.removed_from)})
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
PYTHONPATH=src "$PY" -m pytest tests/test_admin_ldap_api.py tests/test_route_permissions.py tests/test_route_inventory.py tests/test_tenant_isolation.py tests/test_admin_api.py -q -p no:cacheprovider
```
Expected: all pass (`test_admin_ldap_api.py`: 20).

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/homunculus-g1
git add homunculus-engine/src/homunculus/admin/ldap_service.py homunculus-engine/src/homunculus/admin/ldap_router.py homunculus-engine/src/homunculus/admin/schemas.py homunculus-engine/tests/test_admin_ldap_api.py homunculus-engine/tests/test_route_permissions.py
git commit -m "feat(ldap): AD group mapping table; deleting a row takes its rights away now (G1-04)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12 (G1-04d): the read-only check against the real directory; runbook, guide, spec, roadmap; whole-branch run

**Files:**
- Modify: `homunculus-engine/tests/conftest.py:27-30` (the `requires_ldap` marker)
- Create: `homunculus-engine/tests/test_ldap_integration.py`
- Modify: `docs/EDGE-BRIDGE-LOCAL.md:207` (a section before "## Backups — your responsibility now")
- Modify: `docs/homunculus-rehber-TR.md:313,420`
- Modify: `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md:406,413-414,450-451,464,492-495`
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md:79-80` (rows), `:248` (open items)

- [ ] **Step 1: The marker (`tests/conftest.py`)**

In `homunculus-engine/tests/conftest.py`, directly after the `requires_db = pytest.mark.skipif(…)` block (ending `)` on line 30), add:

```python

# The read-only check against a real directory (tests/test_ldap_integration.py), run by hand on
# the VM (docs/EDGE-BRIDGE-LOCAL.md, "Active Directory sign-in"): skipped unless all four
# LDAP_TEST_* variables are set.
LDAP_TEST_ENV = ("LDAP_TEST_URL", "LDAP_TEST_BIND_DN", "LDAP_TEST_BIND_PASSWORD",
                 "LDAP_TEST_BASE_DN")
requires_ldap = pytest.mark.skipif(
    not all(os.getenv(name) for name in LDAP_TEST_ENV),
    reason="LDAP_TEST_* not set; the directory integration test runs by hand on the VM.",
)
```

- [ ] **Step 2: The integration test**

Create `homunculus-engine/tests/test_ldap_integration.py`:

```python
"""Read-only checks against the hospital's real directory (spec §10), run by hand on the VM —
see docs/EDGE-BRIDGE-LOCAL.md, "Active Directory sign-in (optional)". Skipped unless
LDAP_TEST_URL, LDAP_TEST_BIND_DN, LDAP_TEST_BIND_PASSWORD and LDAP_TEST_BASE_DN are set
(LDAP_TEST_CA_CERT and LDAP_TEST_QUERY are optional). It binds and searches; it writes nothing.

The one failed bind is made as the SERVICE account with a wrong password, never as a clinician:
a failed bind counts toward the account's AD lockout, and a test must not move a nurse's counter
(plan decision D16)."""
from __future__ import annotations

import os
import secrets

from homunculus.auth.ldap import LdapConfig, load_ldap_config
from homunculus.auth.ldap3_directory import Ldap3Directory
from tests.conftest import requires_ldap

pytestmark = requires_ldap


def _config() -> LdapConfig:
    config = load_ldap_config({
        "LDAP_URL": os.environ["LDAP_TEST_URL"],
        "LDAP_BIND_DN": os.environ["LDAP_TEST_BIND_DN"],
        "LDAP_BIND_PASSWORD": os.environ["LDAP_TEST_BIND_PASSWORD"],
        "LDAP_BASE_DN": os.environ["LDAP_TEST_BASE_DN"],
        "LDAP_CA_CERT": os.getenv("LDAP_TEST_CA_CERT", ""),
    })
    assert config is not None
    return config


async def test_the_service_account_binds():
    await Ldap3Directory(_config()).test_connection()


async def test_a_search_finds_people_and_each_reads_back_by_guid():
    directory = Ldap3Directory(_config())
    found = await directory.search_users(os.getenv("LDAP_TEST_QUERY", "a"), limit=5)
    assert found, "the search found nobody; set LDAP_TEST_QUERY to part of a known name"
    for identity in found:
        assert len(identity.external_id) == 36 and identity.username and identity.dn
    again = await directory.find_by_external_id(found[0].external_id)
    assert again is not None and again.dn == found[0].dn


async def test_a_wrong_password_is_an_answer_not_an_outage():
    config = _config()
    wrong = "homunculus-yanlis-" + secrets.token_hex(8)
    assert await Ldap3Directory(config).check_password(config.bind_dn, wrong) is False
```

Run it here (no `LDAP_TEST_*` set):

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest tests/test_ldap_integration.py -q -p no:cacheprovider -rs
```
Expected: `3 skipped`, each with the reason `LDAP_TEST_* not set; …`.

- [ ] **Step 3: The runbook (`docs/EDGE-BRIDGE-LOCAL.md`)**

Insert, directly before the line `## Backups — your responsibility now`:

````markdown
## Active Directory sign-in (optional)

Clinicians can sign in with their hospital (Active Directory) account instead of a Homunculus
password. It is off until `LDAP_URL` is set. Local accounts keep working either way, and the API
refuses any change that would leave the hospital without an active **local** administrator, so a
directory outage or a mapping mistake can always be repaired from inside Homunculus.

### What to get from hospital IT

1. **The LDAPS address and its CA certificate:** `ldaps://<DC name>:636`, the name exactly as
   it appears in the domain controller's certificate (not an IP address), and the certificate of
   the CA that signed it (PEM; public).
2. **A read-only service account:** its bind DN (e.g.
   `CN=svc-homunculus,OU=Service Accounts,DC=hastane,DC=local`) and password. It reads users and
   groups, nothing else. Ask for a password that does not expire, or note when it does.
3. **The search base** (`LDAP_BASE_DN`): usually the domain root (`DC=hastane,DC=local`) or the
   OU that holds the staff accounts.
4. **The AD group for each role**, e.g. `YB-Hekim` → Hekim, `YB-Hemsire` → Hemşire,
   `YB-Sorumlu-Hemsire` → Sorumlu Hemşire. Nested groups count.
5. **Port 636 open from the VM to the domain controller**, and the DC's name resolvable from
   the VM.

### Configure

From the VM, first check the network and the certificate:

```bash
getent hosts dc1.hastane.local
openssl s_client -connect dc1.hastane.local:636 -CAfile /opt/homunculus/deploy/local/ldap-ca/ca.pem \
  -verify_hostname dc1.hastane.local </dev/null 2>/dev/null | grep "Verify return code"
```

Expected: an address, then `Verify return code: 0 (ok)`. Then:

```bash
cd /opt/homunculus/deploy/local
mkdir -p ldap-ca && cp /path/to/ca.pem ldap-ca/ca.pem && chmod 644 ldap-ca/ca.pem
$EDITOR .env      # the LDAP_* block from .env.example; LDAP_CA_CERT=/etc/homunculus/ldap-ca/ca.pem
docker compose up -d api
docker compose logs api | grep "LDAP"
```

Expected: `LDAP: service-account bind to dc1.hastane.local succeeded`. Otherwise:
`FAILED (tls)` — the certificate or the name in `LDAP_URL`; `FAILED (unreachable)` — DNS or the
firewall; `FAILED (timeout)` — the DC does not answer in time; `FAILED (service_bind_rejected)`
— the bind DN or its password; `LDAP is OFF: …` — a setting the API cannot use (the message
names it). None of these stops the API, and local sign-in keeps working.

### Check against the real directory (read-only)

`tests/test_ldap_integration.py` binds as the service account, runs one search, and makes one
deliberately failed bind — as the **service account** with a wrong password, never as a
clinician (a failed bind counts toward that account's lockout). It writes nothing. It runs in a
throwaway container built from the API image, with the API's own `LDAP_*` settings:

```bash
cd /opt/homunculus/deploy/local
docker compose run --rm --no-deps --user root --entrypoint sh \
  -v /opt/homunculus/homunculus-engine/tests:/app/tests:ro api -c '
    pip install -q "pytest>=8.0" "pytest-asyncio>=0.23" "httpx>=0.27" &&
    LDAP_TEST_URL="$LDAP_URL" LDAP_TEST_BIND_DN="$LDAP_BIND_DN" \
    LDAP_TEST_BIND_PASSWORD="$LDAP_BIND_PASSWORD" LDAP_TEST_BASE_DN="$LDAP_BASE_DN" \
    LDAP_TEST_CA_CERT="$LDAP_CA_CERT" \
    python -m pytest -q -p no:cacheprovider tests/test_ldap_integration.py'
```

Expected: `3 passed`. A search for `a` that finds nobody fails the second test; add
`LDAP_TEST_QUERY=<part of a known name>` inside the quotes.

### How it behaves

- **Accounts come from an import.** An administrator searches AD and imports the people who
  need Homunculus; an AD account that was not imported cannot sign in. Until the AD panel ships
  (G1-14), the routes are `/admin/ldap/*` (`homunculus-engine/src/homunculus/admin/ldap_router.py`).
- **Sign-in forms:** the AD user name (`ayilmaz`), `DOMAIN\ayilmaz`, the UPN
  (`ayilmaz@hastane.local`) or the mail — as `LDAP_LOGIN_ATTRS` allows.
- **AD down:** AD accounts get "Dizin sunucusuna ulaşılamıyor" (503) at sign-in; open sessions
  continue; local accounts are unaffected.
- **Disabled, deleted or password changed in AD:** refused at the next sign-in, and the open
  session ends at its next token refresh (within the hour). Homunculus's own "active" flag is not
  changed; deactivate the account in Homunculus to stop it whatever AD says.
- **AD group changes** apply at the user's next sign-in or token refresh, whichever comes first
  (within the hour); while the directory is down, nothing changes. Deleting a mapping in
  Homunculus takes its rights away at once; someone who still holds the group through another
  mapping gets it back at their next sign-in or refresh.
- **Wrong passwords** typed into Homunculus count toward the AD lockout policy, like any other
  AD sign-in.
````

- [ ] **Step 4: The Turkish guide (`docs/homunculus-rehber-TR.md`)**

Replace the line

```
`admin/`). Active Directory (LDAP) ile giriş ayrı bir iştir (Plan 2) ve henüz kurulmadı.
```
with
```
`admin/`). Active Directory (LDAP) ile giriş için aşağıdaki "Active Directory ile giriş"
maddesine bakın: arka ucu hazır, yönetim panelindeki AD sekmesi G1-14'te gelir.
```

Insert, directly before the line `**Yetkilerin yeniden okunması**`:

```markdown
**Active Directory ile giriş**
- *Basit:* Hastanedeki bilgisayar hesabıyla (kullanıcı adı ve Windows parolası) giriş.
  Homunculus bu parolayı saklamaz; her girişte hastanenin dizin sunucusuna bir kez sorar.
- *Homunculus'ta:* `LDAP_URL` ayarlanınca açılır. Kimse kendiliğinden hesap açamaz: yönetici
  kişiyi AD'de arar ve içe aktarır. Kişi kullanıcı adıyla, `ALAN\kullanıcı` biçimiyle, UPN'iyle
  (`ad@alan`) ya da e-postasıyla girebilir. AD grupları Homunculus gruplarına eşlenir (ör.
  YB-Hemşire → Hemşire); eşleme her girişte ve her token yenilemesinde (en geç bir saat içinde)
  yeniden uygulanır, yöneticinin elle verdiği gruplara dokunulmaz. Bir eşleme silinince verdiği yetki hemen geri alınır. Dizin sunucusuna
  ulaşılamazsa AD hesapları "Dizin sunucusuna ulaşılamıyor" (503) alır, açık oturumlar sürer,
  yerel hesaplar etkilenmez. AD'de kapatılan ya da parolası değişen hesabın oturumu en geç bir
  saat içinde, token yenilenirken kapanır. Her kurumda en az bir **yerel** yönetici kalır; sistem
  sonuncusunun kaldırılmasına izin vermez, çünkü AD çöktüğünde yönetime girebilecek tek hesap
  odur. Homunculus'a yanlış girilen parola AD'nin hesap kilitleme sayacına işler.

```

- [ ] **Step 5: Record the decisions in the spec**

In `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md`:

Replace
```
authenticate(login, password)      -> LdapIdentity | None      # None = bad credentials
```
with
```
authenticate(external_id, password) -> LdapIdentity | None     # by objectGUID; None = bad credentials
```

Replace
```
`LdapIdentity` carries `external_id` (objectGUID), `username` (sAMAccountName), `upn`, `email`,
`display_name`, `dn`, `group_dns`, `disabled`. `LdapUnavailable` is raised for connection,
```
with
```
`LdapIdentity` carries `external_id` (objectGUID), `username` (sAMAccountName), `upn`, `email`,
`display_name`, `dn`, `group_dns`, `disabled`, `pwd_last_set` (for the refresh re-check).
`authenticate` takes the objectGUID, not the typed login (sign-in step 1; the typed login only
selects the imported account — see plan `2026-10-03-g1-dalga1a-ldap-arka-uc.md`, D1–D2).
`LdapUnavailable` is raised for connection,
```

Replace
```
- `GET /admin/ldap/status` → `{configured, url_host, last_test_at, last_test_ok}`.
```
with
```
- `GET /admin/ldap/status` → `{configured, url_host, last_test_at, last_test_ok}`. The one
  `/admin/ldap` route that answers while LDAP is off (`configured: false`); the others are 409.
```

Replace
```
- In Plan 2 the §6 guard is tightened: a tenant must keep at least one active administrator whose
```
with
```
- (Done in Plan 1 already: `count_admins` counts local administrators only.) The §6 guard is tightened: a tenant must keep at least one active administrator whose
```

Replace
```
refresh token's `iat` → 401. If the directory is unreachable the refresh proceeds — the §4 outage
decision (open sessions continue) — and the audit records `refresh.directory_unavailable`.
```
with
```
refresh token's `iat` → 401. Otherwise the group sync of step 5 runs too (same function, same
guard and audit), and the refreshed token is minted from the result, so a change of AD groups
takes effect within one access-token lifetime (amendment to Plan 2, closing its gap 5). If the
directory is unreachable the refresh proceeds without a sync — the §4 outage decision (open
sessions continue) — and the audit records `refresh.directory_unavailable`.
```

- [ ] **Step 6: The whole branch**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
docker start homunculus-test-pg
PYTHONPATH=src "$PY" -m pytest -q -p no:cacheprovider 2>&1 | tail -3
```
Expected: no failures; `passed` ≈ 1670 + 161 = 1831, `skipped` = 4 (the baseline's 1 + the three integration tests). If the counts differ, record the exact numbers — what matters is 0 failed.

Then make sure nothing outside this plan's files changed:

```bash
cd /c/tmp/homunculus-g1
git status --short
```
Expected: only this task's files (staged next), plus at most another wave's uncommitted plan file — leave that alone. No stray edits.

- [ ] **Step 7: The roadmap rows**

Print the task commits:

```bash
git log --oneline -12
```

In `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, replace the two rows

```
| G1-03 | LDAP arka ucu · dizin modülü + AD girişi + yenilemede dizin kontrolü (spec §7, §4) | 5 | Orta | G1-02 | Bekliyor |
| G1-04 | LDAP arka ucu · `/admin/ldap/*` içe aktarma, grup eşlemesi, yerel yönetici koruması | 5 | Orta | G1-03 | Bekliyor |
```
with the two rows below, writing today's date as `GG.AA` and, from the log just printed, the short SHAs of the Task 1 and Task 8 commits (G1-03) and of the Task 9 and Task 11 commits (G1-04):

```
| G1-03 | LDAP arka ucu · dizin modülü + AD girişi + yenilemede dizin kontrolü (spec §7, §4) · plan: [dalga 1A](2026-10-03-g1-dalga1a-ldap-arka-uc.md) | 5 | Orta | G1-02 | ✅ GG.AA · <Task 1>…<Task 8> |
| G1-04 | LDAP arka ucu · `/admin/ldap/*` içe aktarma, grup eşlemesi, yerel yönetici koruması (zaten Plan 1'de: `count_admins` yalnız yerel yöneticileri sayar) | 5 | Orta | G1-03 | ✅ GG.AA · <Task 9>…<Task 11> |
```

In the same file, in "## Dalga 0'dan açık kalanlar", after the line that starts with
``- `scripts/dev_local.py` SQLite'ta hâlâ tamamlanmaz`` add:

```
- (Dalga 1A) AD'de yeniden adlandırılan hesap izlenmiyor: girişte ad, e-posta ve DN güncelleniyor ama `username` değil, yönetimde yeniden adlandırma yolu da yok; AD'de adı değişen kişi yeni sAMAccountName'iyle giremez (UPN ya da e-posta hesabı adlandırıyorsa onlarla girer). → Grup 4
```

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/homunculus-g1
git add homunculus-engine/tests/conftest.py homunculus-engine/tests/test_ldap_integration.py docs/EDGE-BRIDGE-LOCAL.md docs/homunculus-rehber-TR.md docs/superpowers/specs/2026-09-23-ldap-rbac-design.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md
git commit -m "docs(ldap): runbook, guide and spec for AD sign-in; read-only directory check (G1-04)

Backend: <passed> passed, <skipped> skipped, 0 failed (Step 6).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
(Write the two numbers from Step 6 into the message.)

---

## Self-review (writer's)

**Spec coverage.**

| Spec | Where |
|---|---|
| §7 Module: protocol, `LdapIdentity`, `LdapUnavailable`, `Ldap3Directory` over `asyncio.to_thread`, `FakeDirectory` | Tasks 1, 3, 4 (protocol per D1) |
| §7 Configuration: all ten `LDAP_*` variables; unset = off (409 / 503) | Task 1 (`load_ldap_config`), Task 3 (`ldap_from_env`), Tasks 6 and 9 (503 / 409), Task 8 (deploy files) |
| §7 Sign-in steps 1–6 (GUID search, bind, disabled, profile, group sync with the guard in a savepoint, tokens) | Tasks 5, 6 |
| §7 Refresh for an AD account (`ACCOUNTDISABLE`, `pwdLastSet` vs `iat`, unreachable → proceed + `refresh.directory_unavailable`); plus, by amendment, the group sync at refresh (D9) | Task 7 |
| §7 Import and mapping (8 routes; idempotent import; `skipped: exists`; §6 rule on import, mapping create and delete) | Tasks 9–11 |
| §7 Security (one bind, never stored/logged/audited; service password env-only; `escape_filter_chars`; capped results; `users.manage`; TOTP as for local; local-admin guard) | Tasks 1–3 (escaping, caps, repr), 6 (password tests), 9–11 (permission, caps), 5 and 11 (`count_admins`) |
| §4 LDAP branch: 401 vs 503 never conflated; `login.fail` reasons; `last_login_at` | Task 6 |
| §6 "No grant beyond your own rights"; at least one active LOCAL administrator | Tasks 10–11 (`_grantable`, `_within`, members of a deleted mapping); the guard itself is Plan 1's `count_admins` (`auth/groups.py:171`), applied to every new path that removes rights (sync, mapping delete) |
| §9 `ldap3>=2.9`; `.env.example` + compose block; start-up bind = warning | Tasks 1, 8 |
| §10 FakeDirectory cases (bind ok, bad password, unavailable, disabled, sync add/remove/manual, import idempotent, escaping of `*`, `(`, `\`); `@requires_ldap` | Tasks 2, 5, 6, 10, 12 |

**Placeholder scan.** The only values left to the executor are measured ones: test counts in
two commit messages, and the date and commit SHAs in the roadmap rows (Task 12 Step 7) — none can
be known in advance.

**Type consistency.** `LdapRuntime(directory, url_host, login_attrs, last_test_*)` and its
`test()` (Task 1) are what `runtime()` (Task 4), `ldap_from_env` (Task 3), the routes (Tasks 6,
7, 9) and the lifespan (Task 8) use. `authenticate(external_id, password)` and
`find_by_external_id(external_id)` match in `LdapDirectory`, `Ldap3Directory` and
`FakeDirectory`. `SyncOutcome(before, after, guarded)` / `.changed` (Task 5) is what `_audit_sync` reads,
at sign-in (Task 6) and at refresh (Task 7). `ImportReport.imported: list[Imported(external_id, user_id)]` and
`.skipped: list[tuple[str, str]]`, `RemovedMapping(ad_group_dn, group_slug, removed_from)`
(Tasks 10–11) are what the routes read. `login_in_use`, `mapped_group_ids`, `normalise_dn`,
`sync_ldap_groups` (Task 5) are the names `admin/ldap_service.py` imports.

**Dry run (while writing, after the refresh-sync amendment).** Every edit in this plan was
applied mechanically, in task order, to a scratch copy of `fd15f04` (with `ldap3` 2.9.1 on
`PYTHONPATH`), against the test container: each anchor and each replaced block matched exactly
once, and the task-level test runs passed at each task (for Tasks 7, 10 and 11 a subset of the
step's command; the rest of those files passed in the whole-suite run) — `test_ldap_rules` 42,
`test_ldap3_directory` 24 then 45, `test_ldap_runtime` 5, `test_ldap_sync` 9, the Task 6 run 171,
the Task 7 run 60 (`test_auth_ldap_refresh` 12), the Task 8 run 99, and the Task 9–11 runs 165,
139 and 147. The whole suite with the database: 1829 passed, 5 skipped, 1 failed. The failure is
environmental (`test_infinity_transport.py::test_inventory_and_remote_transport_fail_closed`
expects its file to sit inside a git repository; it passes in the worktree), and so is the fifth
skip; in the worktree expect 1831 passed, 4 skipped.
