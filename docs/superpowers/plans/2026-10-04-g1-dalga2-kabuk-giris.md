# Group 1 · Wave 2 — the live shell (G1-07) and sign-in, 2FA, first-sign-in password change, lock screen (G1-08) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The bare URL (and `?live=1`) opens the new live UI: its own session and board stores on the real API (no demo store under them), a sign-in screen, the TOTP step, a forced change of a temporary password (an administrator's, and — once, after the deploy — every existing local account's), a lock screen, and the signed-in shell — permission-filtered rail, top bar (unit chip, clock, language, theme, full screen, shortcuts, alarm bell, account menu), hash routing with a route table Wave 3 fills in, and a personal Settings screen that is every session's home until Wave 3 builds the work screens. The backend gains what the sign-in and lock need: `users.must_change_password` (migration `0011`, which flags every existing local account) enforced on every route, `POST /auth/reauth` for the lock screen (its wrong passwords counted with `/auth/password`'s), and the hospital's two screen-lock times on `/auth/me`. The mobile app says why a temporary password stops it instead of answering 403 everywhere.

**Architecture:** Backend: one boolean column, set by the two admin routes that hand out a temporary password and cleared by `/auth/password`; `get_principal` (every router route) and the board's JWT resolver (`api/prodserver.py`) answer 403 `password_change_required` while it is set on a local account; `/auth/password` alone stops at a new `get_principal_pre_password`. `/auth/reauth` checks the session's own password — bcrypt for a local account (a limit it shares with `/auth/password`), one bind for an AD account counted in the same `directory_binds` chain as its sign-ins, exactly as a sign-in's bind (F8: `Ticket`, `LdapIdentity.bound`, an unanswered bind dated a deadline later, every counted failure audited at once). Frontend: `src/live/session/sessionStore.js` (phases: restoring, signedOut, unreachable, mfa, password, ready, locked) and `src/live/data/boardStore.js` (patients, alerts, connection, scope) are framework-free and wrap `backendApi.js`; React reads them through two small providers. `LiveApp.jsx` picks the screen by phase; `shell/` holds the rail, top bar, menus, route table and the hash router; `auth/` the screens before the shell and the lock screen. The lock is per browser (`hmc.lock` in localStorage), so a reload or a new tab opens on it, and lasts at most the hospital's `SCREEN_LOCK_SIGNOUT_HOURS`. The board is LIVE only when its stream is open and it was reloaded since; only a LIVE board may say "no alarms".

**Tech Stack:** Python 3.12 (image; a 3.12 venv at `C:/tmp/f7-py312/venv`) / 3.14 (dev venv), FastAPI, SQLAlchemy 2 async + asyncpg, Alembic, pytest on the PostgreSQL test container. React 18.3, Vite 5.4, Tailwind 3.4, Vitest 2.1 + Testing Library on jsdom 24; `qrcode` (already a dependency). The mobile app: Expo 54, Jest 29 (`jest-expo`). No new package.

**Design source:** the clickable prototype, `origin/tasarim/prototip` (`8bebc67`) `tasarim-taslaklari/app/` — `shell.js` (sign-in `VIEWS.login/mfa/force`, `lockHtml`, `renderApp`, `railHtml`, `topHtml`, the idle warning, menus, shortcuts), `core.js` (`H.state`, `WD`, dictionary keys `login_*`, `m_*`, `logout`, `lock`), `ayarlar.js` (Settings), `app.css` / `ek.css` (`.shell .rail .ri .top .chip .today .lsel .ib .av .menu .ncenter .login .lg2 .lk .deny .idlewarn`), `ceviri-sozluk.js`. **Roadmap:** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` — G1-07, G1-08; D1 (the new shell does not rest on the demo store), D2 (Azerbaijani default), D4 (sign-in + 2FA + first-sign-in password change + lock screen; "Şifremi unuttum" = "BT birimine başvurun"); "Main'den gelen ve yeni kabukta karşılanacak davranışlar" (the G1-07/G1-08 rows); "Dalga 1B'den açık kalanlar" (the G1-07/G1-08 rows); user decision 3 (forced MFA for four groups — not decided here: the UI follows `requires_mfa`, i.e. `groups.mfa_required`). **Spec:** `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md` §4 (tokens, MFA enforcement, password change), §5, §7 Security (the AD bind throttle). **Foundation:** `docs/superpowers/plans/2026-10-03-g1-dalga1b-tasarim-temeli.md` (`src/live/` tokens, i18n, `ui/`).

**Size:** 28 tasks (0–27). Backend: 67 new tests in 4 new files and 3 changed ones (and a fourth changed, `test_migration_0010_orm_writes.py`, whose administrator `0011` now flags) — the suite goes from 2188 passed / 6 skipped to 2255 passed / 6 skipped on Python 3.14, and from 2184 passed / 8 skipped to 2251 passed / 8 skipped on 3.12. Dashboard: 213 new tests, 21 new files — from 63 files / 1317 tests to 84 files / 1530 tests. Mobile app: 3 new tests (298 → 301; its 3 failures at the base are not this plan's). About 20–24 hours of subagent execution including review (roadmap: 5 + 5 points ≈ 1.5 days; the backend pieces D4 needs — the column, the gate, `/auth/reauth` and its limits —, the board store Wave 3 shares and the mobile app's refusal were not in that estimate). Every code block below was run while writing this plan, in a scratch worktree at `9ec264b`: the backend tests on a database of their own (`homunculus_test_plan2`), the whole backend suite on 3.14 and on 3.12, the whole dashboard suite and `npx vite build`, the mobile app's suite; the shell was looked at in headless Chrome at 1440 px and 390 px in both themes against a stand-in API in the first version (sign-in, shell, bell, lock screen — no horizontal scroll at either width; the revision changed texts and the bell's dot, not the layout). The plan was then replayed mechanically onto a clean `9ec264b` worktree, every "Expected" checked at its step, and the result compared file by file with the tested tree (identical).

**Not in this plan:**
- The work screens: beds (G1-09), alarms (G1-10), patient (G1-11), admin users/roles/login source (G1-12–G1-14). Their routes are listed with `screen: null`; each wave sets its own.
- The **shift-end chip** of the top bar ("Nöbet bitimine"): Group 1 has no source for it; the user decided it is not shown (decision 12, "User decisions" at the end).
- Patient/bed **search** (Ctrl K, "/"): it searches the bed board, which G1-09 builds. Not shown, not in the shortcut list.
- The rail's alarm count badge: comes with the alarms screen (G1-10), which the badge would link to. The bell carries the count meanwhile.
- The prototype's role preview ("Rol gözüyle bak"), notification centre (Group 2+ events), quick-PIN sign-in, the session list ("Açık oturumlar"), Settings tabs without a backend (notifications, monitor sound, browser permissions, help/legal), the legal links of the sign-in page, the animated "live ward" scene of the sign-in hero.
- The automatic theme (20:00–08:00): the web prototype has none (Wave 1B Decision 7).
- A server-side sign-out (revoking a refresh token): signing out drops the tokens from the browser; a refresh token taken from it stays valid until it expires (7 days) or the account changes — as today.
- `?eski=1` honouring the lock: the previous workspace knows nothing of `hmc.lock`. It exists only until G1-16, which must run before the G1-15 deploy (a deploy-gate item, Task 27).
- A "never" for the idle lock, or a per-user lock time: a personal session always locks (Decision 16); a wall or central display is Group 2's kiosk mode, with no personal session.
- A password form in the mobile app: it says to change the temporary password on the dashboard (Task 3).

---

## Decisions

1. **First-sign-in password change: a column, enforced on the server, never for AD.** `users.must_change_password` (`BOOLEAN NOT NULL DEFAULT false`, migration `0011`, down `0010` — kept separate from the unreleased `0010`, which is the RBAC conversion reviewed as one piece). `POST /admin/users` and `POST /admin/users/{id}/reset-password` set it (both give a LOCAL account a temporary password); `POST /auth/password` clears it and refuses a new password equal to the current one ("Yeni parola mevcut paroladan farklı olmalı" — otherwise the forced change could keep the temporary password). `auth.service.password_change_due(user)` = flag **and** `auth_source == "local"`: nothing writes the flag on an AD account (its password lives in AD, and `/auth/password` refuses it), and an AD row flagged by hand is still not held. Enforcement: `get_principal` — the dependency of every router route — answers 403 `password_change_required` while it is due, after the MFA gate; a new `get_principal_pre_password` (the MFA gate alone) serves `/auth/password` only; `/auth/me`, `/auth/refresh` and `/auth/totp/*` never reached `get_principal` and stay open. The board's own resolver (`api/prodserver.py`, `/patients`, `/stream-ticket`, `/ack`…) reads the flag in its one query and answers the same 403. The flag is read from the user row both already load: it takes effect at once, with no extra query. `TokenResponse.password_change_required`, `UserMeResponse.must_change_password` and the admin's `UserOut.must_change_password` say so to the clients. **Order: MFA first, then the password** — a password reset never lets the temporary password alone choose the next password of an account that has an authenticator. *Rejected:* a token claim (stale until the next refresh, and the next refresh must then re-read it anyway); a separate restricted token type (more token kinds for the same effect); enforcing it only in the dashboard (the temporary password would still open every API route, and the mobile client). **Every local account that exists before `0011` is flagged by it** (the user's decision 16: `UPDATE users SET must_change_password = true WHERE auth_source = 'local'` in the upgrade; AD rows never; the downgrade drops the column): nothing recorded which local passwords were an administrator's temporary ones — the seed administrator's included — so each local account chooses its own password once, at its first sign-in after the deploy (the users are told beforehand: a G1-15 deploy-gate item). Accounts made afterwards get the column's default, false, unless an administrator gives the password.

2. **The idle lock time is the hospital's, from the API.** `SCREEN_LOCK_IDLE_MINUTES` (default 10, 1–60; a value the API cannot use is logged as a WARNING and 10 applies — a typo must neither stop the API nor leave a ward PC that never locks), read once at start (`auth/session_policy.py`), served on `/auth/me` as `lock_idle_minutes`. A minute before the lock a warning counts down with "Davam et". Activity = a key, a click, a touch or the wheel — not a pointer that only moves (a mouse bumped on a cart must not keep a ward PC open) — in any tab of the browser (`hmc.activeAt`, shared, written at most every 5 s), so a background tab does not lock the one in use. The default stays 10 minutes (the user's decision 14; the prototype said 15). *Rejected:* a build-time `VITE_*` value (changing it would mean rebuilding the web image); the prototype's per-user choice with a "never" option (Decision 16) — a per-user shorter time can come later.

3. **Locking hides the session, and it is per browser.** The lock screen *replaces* the shell: every screen, menu, dialog and portal of the session unmounts, and the toasts are emptied (`ToastProvider resetKey`). What it shows of the ward is the number of open alarms in the session's units, by severity, and how many of them nobody has acknowledged — no name, bed or value; a board that is not LIVE never says "none" (Decision 18). The board store keeps running while locked, so the counts stay current and unlocking is instant. The lock is kept in `localStorage` (`hmc.lock = {user, at, why}`): a reload or a new tab of the same browser opens on the lock screen instead of walking past it with the tokens the browser holds, and every tab locks and unlocks together. Unsaved input on screen is lost at the lock (accepted). *Rejected:* an overlay over a still-mounted shell (patient data stays in the DOM, a dialog's portal escapes the overlay, and the dialog stack would make the lock's own password field inert); stopping the stream while locked (no counts, and no security gain — the tokens stay in the browser either way; against a person with developer tools only signing out helps, which the lock screen offers).

4. **Unlock is a new endpoint, `POST /auth/reauth {password}`, and cannot become an AD-lockout lever.** It takes the whole session (`get_principal`), checks the session's own account and issues nothing (the session continues; MFA is not asked again — this is a presence check, not a sign-in). A local account: bcrypt; 5 wrong in a row lock its unlock for 15 minutes (`reauth_failures`, 429) — **counted together with the wrong current passwords at `/auth/password`**, the other place a held token can test the account's password (both answer 429 while it holds); one audit row marks the lock engaging, the attempts it refuses write none. An AD account: one bind, counted in **the same `directory_binds` chain as its sign-ins** — so Homunculus adds at most 3 + 3 failed binds per chain to the domain's count however sign-ins and unlocks are mixed, and a full chain is refused (429) without a bind; a directory that does not answer is 503 and counts nothing unless the password had been sent. The bind is handled exactly as `_directory_sign_in` handles its own (Wave 1A, F7): `begin` hands out a `Ticket`; a bind the domain controller never answered once the password had gone (the deadline, ldap3's receive timeout, a dropped connection) is counted, dated `bind_pending_s` — one deadline — later; an unmarked cancellation is counted, dated `DEADLINE_CAP_S` later; a right password ends the chain only for the failures recorded before it began — `succeeded(slot, ticket)` exactly when the directory returns the identity `bound` (F8: the route never asks the clock whether a bind was made), nothing awaited after `end`; a disabled or expired account (returned without a bind) is 401. Every failure the chain counts is audited at once with nothing awaited (`audit` is a plain call): a cancelled unlock whose password may have been sent writes `reauth.fail` `cancelled`, a fault `directory_error` — as a cancelled sign-in writes `login.fail` (F8), so the rows the runbook reads before a restart are complete (subject `reauth.fail`, the account as `user` in the payload, the same reasons as `login.fail`; Task 27 extends the runbook's pre-restart query to `subject IN ('login.fail', 'reauth.fail')`). A test sends the same directory answer — wrong, right, cut off, not sent, answered oddly, disabled, expired, a fault — once to a sign-in and once to an unlock and requires the same calls on `directory_binds` and the same audit reason: F8's seeded invariant model (`tests/test_directory_bind_invariant.py`), which drives the chain as a sign-in does, therefore covers the unlocks as well; they add no new way to use the chain. And a `FailureChain` now refuses a ticket another chain handed out (an owner stamp on `Ticket`, kept out of its repr and comparison): F8's check compared only the key and the attempt number, which every chain counts from 1 (the review of F8; Task 5, Step 3). A wrong password is **403** `Parola hatalı`, never 401: `backendApi` answers a 401 by refreshing and *retrying*, which would send the password to the directory a second time. A 401 from it means the session itself is over (an expired token is refreshed and retried before any password check; an account disabled or expired in AD). The dashboard allows 3 wrong unlocks per lock, then signs out; "Başqa istifadəçi ilə giriş" signs out at once — leaving never needs a password. *Rejected:* reusing `/auth/login` (it spends the ward's shared per-address nginx budget at shift change, would ask for TOTP again at every unlock, writes `last_login_at`, and refuses with 401); a TOTP-only or PIN unlock (no backend, and a PIN is a second, weaker credential). *Consequences, both accepted:* during an AD outage an AD user whose screen locks cannot unlock it (503; fail closed — the user's decision 13); and the user decision 11(b) reaches the lock screen — whoever knows a clinician's AD login can fill her chain with wrong passwords and so hold her locked screen at 429 for at least 15 minutes (her sign-in too: she waits, an administrator unlocks the run once, or a colleague signs in). The runbook says both.

5. **New stores, no demo store (D1).** `sessionStore.js` and `boardStore.js` are new and framework-free; they use only the old app's API client modules — `backendApi.js`, `liveAuth.js`, `liveAdapters.js`, `liveConnection.js` — never `liveStore.js` (built over the simulation), `clinicalDemo.js`, `ClinicalDemo.jsx` or `clinicalI18n.js`. `boundaries.test.js` enforces it, so G1-16 deletes the old workspace without touching `src/live/`. The board store is built here, not in Wave 3, because G1-09, G1-10 and G1-11 all read it and run on parallel branches. Ending a session, any way it ends, empties everything it loaded — tokens, user, board, unit choice, toasts, lock — and drops a late answer from it (the `epoch`; main's shared-workstation rule, carried from `liveStore.endSession`). Another tab signing out signs this tab out; another account signing in elsewhere opens here too (`api.forget()` drops the copy of the tokens held in memory); the same account passing the TOTP step or the password change in another tab moves this tab on as well. A refused sign-in changes nothing in the browser — the remembered username and a lock are touched only once the API accepted it. A tracked call answered 403 `password_change_required` (an administrator reset the password of an open session) takes the shell to the password step. *Rejected:* `createLiveStore` with no base store (it is built to overlay the simulation's state; every simulation action would need a stub — what D1 rules out).

6. **The bare URL is the new shell now; the previous live workspace stays at `?eski=1` until G1-16.** `?live=1` still wins over everything. Wave 3 ports behaviours from the old screens and needs them reachable meanwhile. *Rejected:* keeping the old workspace on the bare URL until Wave 3 (the roadmap moves live mode in G1-07, and Wave 3 would build screens into a shell nobody opens); dropping it now (Wave 3 loses its reference). `?eski=1` does not know the lock: G1-16 removes it before the G1-15 deploy.

7. **Routing: the address's hash and one route table.** `#/settings`, `#/beds`, `#/alarms`, `#/patients/<id>`, `#/admin`. `shell/routes.js` lists every Group-1 screen with the permissions that open it (any one of them) and `screen: null` until its wave sets it — each on its own line, with its import line pre-placed as a comment, so Wave 3's three branches touch different lines. The rail shows built screens the session may open; an unknown address or an unbuilt screen answers "Belə səhifə yoxdur", a screen the session may not open "Bu səhifəyə icazəniz yoxdur" — never a blank, never a dead link, never a silent jump. *Rejected:* react-router (a dependency for five routes; path routes need nginx and service-worker fallbacks); path routing (the same).

8. **Who may enter, and where they land.** A session needs a tenant, at least one permission, and at least one Group-1 *work* screen its permissions open — built or not, so nobody is turned away in Wave 2 for a screen Wave 3 is building. Otherwise sign-in ends with a reason (`noPermissions`, `noScreen`): a devices-only account (biomedical) is refused until Group 4 gives it a screen, as today (`NO_BOARD_ACCESS`). It lands on the first built work screen it may open, else on its Settings — in Wave 2, everyone lands on Settings. No setup wizard (roadmap: setupWizardScope).

9. **The top bar.** Breadcrumb (hospital name from `/auth/me` › page); the **unit chip** from the engine's own scope block on `/patients` (`scope.unit_ids`, shown only when restricted to two or more units; the choice is held by the shell in memory, `useShell().unit`, for G1-09 to filter by); the **clock** (browser clock, weekday from the dictionary, 24-hour); language menu (code and native name — no flags: a flag names a country, and the wards speak more than one language of each); theme toggle; full screen (hidden ≤ 1100 px and where the browser has no Fullscreen API); keyboard shortcuts (Esc, Alt L — the key's place, `KeyL`, so it works on every layout and on a Mac —, F11); the **bell** — the alarms nobody has acknowledged in the session's scope, most severe first (bed, the engine's summary, since when): "none" only from a LIVE board, the last list marked "may be out of date" with a dot from a DEGRADED one, "cannot know" otherwise (only for a session with `board.view`); the **account menu** — name, groups, build SHA (`__BUILD_SHA__`, roadmap item), Settings, lock, sign out. Shift-end and search: "Not in this plan".

10. **The sign-in screen.** Username or e-mail and password (AD accounts use the same form), a show-password toggle (one name, its state in `aria-pressed`), Caps Lock warning, "remember my username" (the name only — never a password; unticking deletes it; it fills the field and opens nothing; written only for a sign-in the API accepted: roadmap loginRemember). A refusal is an announced alert (new `ui/Alert.jsx`, role="alert"; a notice such as "signed out" is role="status"), translated through a keyed `errors` namespace; a 429 that sends `Retry-After` holds the button that long. A missing field is said on the field (`Field` error) and focused. "Şifrəni unutmusunuz?" opens a static note: ask IT, who give a temporary password (D4: no SMS, no e-mail). The hero is static: brand, tagline, two true statements ("Qərarı həkim verir", "Məlumat xəstəxanada") — not the prototype's animated ward with invented alarms on a live system's door. A step line ("Addım 2/3") on the TOTP and password screens.

11. **The TOTP step (spec §4, §8).** Asked when the token says `requires_mfa` — which the groups' `mfa_required` decide (user decision 3 stays open; nothing here names a group). Not enrolled: `/auth/totp/setup` once per showing (kept in a ref across StrictMode's rehearsal), the QR drawn in the page by `qrcode` (no network; a light quiet zone in both themes), the key in groups of four with a copy button only where the clipboard exists; a retry only for a failure with no answer (network, 5xx), not for a refusal (403 `mfa_reset_required`). The code field takes digits only (`autocomplete="one-time-code"`); `/auth/totp/verify` stays a plain request (a wrong code is a 401 that must not refresh-and-retry).

12. **The forced password change.** After the TOTP step. Current (temporary) password, new, repeat. The form checks the server's rules only — at least 8 characters (`PASSWORD_MIN_LENGTH` in `auth/service.py`; a test reads it), different from the current one, the two equal — and puts the server's refusals on the field they are about. Leaving signs out. *Rejected:* the prototype's client-side policy (10+ characters, upper, lower, digit, symbol) — a rule only the UI enforces is a rule the administrator's tools do not know; the policy is the server's, and 8+ stays (the user's decision 15). The same form changes the password voluntarily in Settings (local accounts; an AD account is sent to the hospital's own way).

13. **Errors in the user's language.** `live/apiErrors.js` maps every message of the sign-in/MFA/password/lock/session surface — `auth/dependencies.py`, `auth/router.py`, `auth/service.py`, `auth/schemas.py`, `auth/ldap.py`, nginx's 429, `backendApi.js` — to an `errors.*` key in four languages; `apiErrors.test.js` reads those sources as text and fails on an unmapped message, as `i18n.rbac.test.js` does for the old workspace (which is also taught the three new server messages, so the old workspace at `?eski=1` keeps translating them). Unknown messages are shown as the server wrote them. A time or a number stands after a label ("Kilid vaxtı: 21:05", "Qalan cəhd: 2"), never inside a word that would need a suffix or a plural fitted to it. Dates are written the prototype's way (24-hour `HH:MM`, `dd.MM`, the weekday from the dictionary), not with `Intl`: a browser built with a reduced locale set answers an Azerbaijani request in English.

14. **Accessibility and small screens.** Skip link first ("Əsas məzmuna keç" → focuses `<main>`; it is not a hash, which is the router's); landmarks `nav` (the rail, named), `header` (the top bar), `main`; one `h1` per screen; after a move between screens — back to the first one too — focus goes to `<main>`; the language button's name starts with what it shows ("AZ · Dil", WCAG 2.5.3); the idle warning is said when it opens and once more 10 seconds before the lock, not every second; rail entries are links with `aria-current="page"`; menus are ARIA menu buttons (arrows, Home/End, Escape back to the button, Tab closes); the bell and the shortcuts are disclosure panels; `document.title` names the screen. At 390 px: rail 62 px with each entry's short name (never an icon alone — roadmap: admissionScreen), the top bar drops the hospital name, clock, unit chip, full screen and shortcuts, the bell's panel spans the screen under the top bar; no horizontal page scroll (checked in headless Chrome). The sign-in hero and the lock screen are always dark (`data-theme="gece"` on their roots); their text on the gradient is contrast-tested (`tokens.test.js`).

15. **Wave 1B's G1-07/G1-08 leftovers, done here:** `ui/index.js` exports `MODAL_EXEMPT`, `MODAL_OPEN`, `TOAST_WARN_MS`, `TOAST_MAX`, `Alert`, and maps the components' tone vocabularies in its header; `TabPanel` without an `id` claims no tab (and warns) instead of `undefined-panel-0`; `riskStyle(risk, null)` no longer throws; `ThemeProvider` / `I18nProvider` give `<html>` back its earlier `data-theme` / `data-size` / `lang` on unmount and follow a change made in another tab (`storage` event); `ToastProvider` sits at the live root (and empties on `resetKey`); the live root paints `bg-page`; the `Table` ResizeObserver path and the `Empty` icon are tested; the dev proxy gains `/admin`, `/scope`, `/scores`, `/infinity-research` (with a test that it covers every path nginx proxies); type sizes 15/20/28/40.

16. **A personal session always locks.** There is no "never", per user or per hospital: a shared workstation that never locks is the failure the lock exists for. A wall or central display that must stay on is Group 2's kiosk mode, which has no personal session to lock.

17. **A lock does not last for ever.** A browser locked for longer than `SCREEN_LOCK_SIGNOUT_HOURS` (default 12, 1–72; served on `/auth/me` as `lock_signout_hours`; a value the API cannot use is logged and 12 applies) signs itself out (`NOTICE.LOCK_EXPIRED`): checked when the lock is shown — a reload, a new tab, another tab's lock — and by a timer while it stays. A ward PC locked overnight does not keep yesterday's session behind its lock. *Rejected:* the refresh token's 7 days as the only bound (a week behind one password at a shared station).

18. **Only a LIVE board says "none".** LIVE = the stream is open **and** the board was loaded since it opened: every open — the first and each reconnect — reloads the board, and only that load makes it LIVE (a load overtaken by a later one is dropped). An open stream vouches for nothing about a load that failed: that board stays UNAVAILABLE and empty, and frames alone do not refill it. A board that has data but no open stream, or one whose reload has not landed, is DEGRADED: the bell and the lock screen show what it has, marked "may be out of date" with the dot, and never say "none". *Rejected:* `liveConnection.nextConnection`'s rule (stream-open → LIVE from any state: a failed load plus an open stream read as a calm ward; a reconnect after a drop was LIVE without a reload); it stays as it is for the old workspace.

---

## Roadmap behaviours this wave owns

| Roadmap item | Where |
|---|---|
| admissionScreen · collapsed rail shows each entry's short name, never an icon alone | Task 22 (`nav.*Short`), Task 24 (`Sidebar`); `Shell.test.jsx` "each with its name" |
| setupWizardScope · no setup wizard; an administrator lands straight in the product | Task 23 (`homePath`); `LiveApp.test.jsx` "lands … no setup wizard" |
| loginRemember · the username only, never a password; unticking deletes it; opens nothing | Tasks 11, 12, 19; `browserState.test.js`, `sessionStore.test.js`, `SignIn.test.jsx`, `LiveApp.test.jsx` |
| Build SHA on screen (`__BUILD_SHA__`) | Task 24 (account menu), Task 22 (Settings › Profil) |
| Vite dev proxy lacks `/admin`, `/scope`, `/scores`, `/infinity-research` | Task 26, `devProxy.test.js` |
| Language/theme/size not synced across tabs | Task 6 |
| `ThemeProvider`/`I18nProvider` do not restore `<html>` | Task 6 |
| The small G1-07 items of the Wave 1B review; test gaps (`Table`, `Empty`) | Task 6 |
| A refused sign-in needs an announced inline alert | Task 8 (`Alert`), Task 19 |
| `Field` error is not live: focus the first invalid field on submit | Tasks 18–22 (every form here) |
| Automatic theme (20:00–08:00) | Not done: the web prototype has none (Wave 1B Decision 7) |
| Clearing per-user data on sign-out (main, `liveStore.endSession`) | Tasks 12, 25 (`end`, `board.clear`, the toasts' `resetKey`) |

---

## Ground rules for every task

- Work only in the worktree `/c/tmp/homunculus-g1` (branch `feat/canli-tasarim`). Never touch `/c/Users/User/Desktop/Project/Homunculus AI`, the user's main checkout. Its uncommitted edits to `dashboard/src/main.jsx`, `dashboard/src/routing.test.js` and `dashboard/vite.config.js` (the `?infinityTest=1` view) were not inspected for this plan; Task 26 changes `main.jsx` in three small separate places (one more `chooseMode` line, the `live` branch of `pickRoot`, one lazy import), appends to the end of `routing.test.js`, and adds four entries at the end of `vite.config.js`'s proxy list.
- Shell: Git Bash. Backend commands run from `homunculus-engine/` with `PYTHONPATH=src` (the venv's editable install points at the main checkout):

  ```bash
  cd /c/tmp/homunculus-g1/homunculus-engine
  export PY="/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe"
  export TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test
  export PY312=C:/tmp/f7-py312/venv/Scripts/python.exe      # the image's Python, where it exists
  ```
  `docker start homunculus-test-pg` first if `docker ps` does not list it. Without `TEST_DATABASE_URL` the DB tests are **skipped, not failed** — a green run that skipped them proves nothing about Tasks 1–5. **Never export `DATABASE_URL`.** If another agent is using `homunculus_test`, create a database of your own (`docker exec homunculus-test-pg createdb -U homunculus homunculus_test_<you>`) and point `TEST_DATABASE_URL` at it; its name must contain `test`.
- Dashboard commands run from `/c/tmp/homunculus-g1/dashboard`. Filter tests by **folder with a trailing slash** (`npx vitest run src/live/`): Vitest filters by substring, so `src/live` alone also runs `src/liveStore.test.js` and the other old `live*` files.
- The gate at the end of every task: the task's own backend tests (Tasks 1–5) or the whole dashboard suite plus a production build (Tasks 2, 5 and 6–26 — Tasks 2 and 5 change a message the old workspace's `i18n.rbac.test.js` reads):

  ```bash
  cd /c/tmp/homunculus-g1/dashboard
  npx vitest run 2>&1 | tail -5
  npx vite build 2>&1 | grep -E "built in|error"
  ```
  The build always prints `(!) Some chunks are larger than 500 kB` (the old workspace's main chunk): not a failure.
- **Counts.** Every "Expected" count assumes the branch at `9ec264b`: backend 2188 passed / 6 skipped on 3.14 (2184 passed / 8 skipped on 3.12), dashboard 63 files / 1317 tests, mobile app 3 failed / 295 passed (298) — those three fail at `9ec264b` already (Task 3, Step 8). Task 0 records the real base; if it differs (a later commit on the branch), every later expected count is the real base plus this plan's additions.
- Write files with an editor, not with a shell heredoc: the Bash tool's heredocs have been seen to drop backslashes (`\\n` in a regular expression, `\\b` turned into a backspace character) on this machine.
- No hex colour and no Tailwind palette colour in a live component (token classes only; the QR's white quiet zone is `bg-[white]`, commented). Class names are written out whole, never assembled. No user-visible text inside a component: it comes from `t()` or from the caller. Source files are UTF-8; the AZ/RU strings must survive as typed.
- Stage exactly the paths a task lists — never `git add -A` or `git add .` (other agents commit on this branch). **Never stage while another agent's hunks are uncommitted in a file you stage:** `git add <file>` takes the whole file, theirs included. Before every commit run `git status --short` and `git diff --stat`; if a file the task stages shows changes that are not this task's, stop and ask instead of committing. Commit after each task. Every commit message ends with:

  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  ```

---

## File map

**Create — backend**

| File | Responsibility |
|---|---|
| `homunculus-engine/alembic/versions/0011_users_must_change_password.py` | The column, up (flagging every existing local account) and down. |
| `homunculus-engine/src/homunculus/auth/session_policy.py` | `SCREEN_LOCK_IDLE_MINUTES`, `SCREEN_LOCK_SIGNOUT_HOURS` and their parsing. |
| `homunculus-engine/tests/test_migration_0011_must_change_password.py` | The migration on the real chain, with local and AD rows. |
| `homunculus-engine/tests/test_auth_password_change.py` | The rule, the gate, admin set / user clear, MFA first, `/auth/me`. |
| `homunculus-engine/tests/test_auth_reauth.py` | `/auth/reauth`, local and AD; `/auth/password`'s share of the local limit. |
| `homunculus-engine/tests/test_session_policy.py` | The two settings' parsing. |

**Modify — backend** (line numbers at `9ec264b`)

| File | Change |
|---|---|
| `auth/models.py:64-66` (after `sessions_revoked_at`) | `must_change_password` column (Task 1). |
| `auth/service.py:175` (before `credential_fingerprint`), `:185-207` (`issue_tokens`), `:236-258` (`PasswordError`, `change_password`) | `password_change_due`, the token field, `PASSWORD_MIN_LENGTH`, "unchanged", clearing the flag (Task 2). |
| `auth/dependencies.py:4-6, 41, 48, 120-123` | `PASSWORD_CHANGE_REQUIRED`, `get_principal_pre_password`, the password gate in `get_principal` (Task 2). |
| `auth/schemas.py:41-47` (`TokenResponse`), `:58-69` (`UserMeResponse`), `:72-74` (`PasswordChangeRequest`) | `password_change_required`, `must_change_password`, `tenant_name`, `lock_idle_minutes`, `ReauthRequest` (Tasks 2, 4, 5). |
| `auth/router.py:1-22` (docstring), `:30-59` (imports), `:70-71`, `:494-527` (`/auth/me`, `/auth/password`), end of file | Docstring; imports; `_REAUTH_REFUSED`; `/auth/me`; `/auth/password` dependency (Task 2) and its share of the local limit (Task 5); `/auth/reauth` (Tasks 2, 4, 5). |
| `auth/limits.py:92-97` (`Ticket`), `:150-153`, `:168`, `:180-195` (`FailureChain`), `:259` (after `totp_failures`) | A ticket carries its chain, and only that chain takes it; `REAUTH_MAX_FAILURES`, `reauth_failures` (Task 5). |
| `admin/service.py:458-459` (`create_local_user`), `:529-533` (`reset_password`) | Set the flag on create and reset (Task 2). |
| `admin/schemas.py:127`, `admin/router.py:48`, `:82` | `UserOut.must_change_password` (Task 2). |
| `api/prodserver.py:39, 45` (imports; F7's `configure_logging` below them is not touched), `:208-214` (`UserAuthRow`), `:254`, `:275-276` (the resolver), `:296`, `:323` (the read) | The board resolver's gate (Task 3). |
| `tests/test_route_inventory.py` | `PRE_PASSWORD`; the third inventory test (Task 2). |
| `tests/test_jwt_caller.py` | Three tests (Task 3). |
| `tests/test_auth_limits.py` | One test: another chain's ticket is refused (Task 5). |
| `tests/test_migration_0010_orm_writes.py` | Its administrator from before `0011` changes the password `0011` flagged (Task 1). |
| `deploy/local/docker-compose.yml:84`, `deploy/local/.env.example` (end) | `SCREEN_LOCK_IDLE_MINUTES`, `SCREEN_LOCK_SIGNOUT_HOURS` (Task 4). |

**Modify — mobile app** (Task 3)

| File | Change |
|---|---|
| `homunculus-mobile/src/transport/authClient.ts` | `PasswordChangeRequiredError`: a sign-in whose temporary password must be replaced stores nothing. |
| `homunculus-mobile/app/(tabs)/settings.tsx`, `src/i18n/tr.ts` | The line that sends the clinician to the dashboard. |
| `homunculus-mobile/__tests__/authClient.test.ts`, `__tests__/SettingsScreen.test.tsx` | Three tests. |

**Create — dashboard** (all under `dashboard/src/live/` unless a path says otherwise)

| File | Responsibility |
|---|---|
| `ui/Alert.jsx` | Announced inline message (role alert/status). |
| `apiErrors.js`, `i18n/strings/errors.js` | API message → `errors.*` key; the texts. |
| `i18n/dates.js`, `i18n/strings/dates.js` | `HH:MM`, `dd.MM`, weekday keys. |
| `session/browserState.js` | `hmc.lock`, `hmc.activeAt`, `hmc.rememberUser`. |
| `session/sessionStore.js`, `session/SessionProvider.jsx` | The session's phases and actions; `useSession()`. |
| `session/useIdleLock.js` | The idle lock and its warning. |
| `session/testTokens.testutil.js`, `session/mount.testutil.jsx` | Test-only: unsigned tokens, a fake API, a mount helper. |
| `data/boardStore.js`, `data/BoardProvider.jsx` | Patients, alerts, connection, scope; `useBoard()`; `alarmCounts`, `waitingAlarms`, `scopeUnits`. |
| `shell/Menu.jsx`, `shell/Prefs.jsx` | `Popover`, `MenuButton`; `LanguageMenu`, `ThemeToggle`, `Brand`. |
| `shell/routes.js` | The route table and the access rules. |
| `shell/ShellContext.jsx`, `shell/Sidebar.jsx`, `shell/TopBar.jsx`, `shell/Shell.jsx` | The signed-in frame. |
| `auth/passwordRules.js`, `auth/PasswordForm.jsx` | The server's password rules; the change form. |
| `auth/AuthLayout.jsx`, `auth/SignIn.jsx`, `auth/MfaStep.jsx`, `auth/PasswordStep.jsx`, `auth/SessionWait.jsx`, `auth/LockScreen.jsx` | The screens before (and instead of) the shell. |
| `screens/settings/SettingsScreen.jsx` | The personal settings. |
| `LiveApp.jsx` | The live mode's root. |
| `i18n/strings/{shell,auth,lock,account,nav}.js` | The new namespaces. |
| Tests | `ui/{Alert,index}.test.*`, `apiErrors.test.js`, `i18n/dates.test.js`, `session/{browserState,sessionStore}.test.js`, `session/useIdleLock.test.jsx`, `data/boardStore.test.js`, `shell/{Menu,Shell}.test.jsx`, `shell/routes.test.js`, `auth/passwordRules.test.js`, `auth/{AuthLayout,PasswordForm,SignIn,MfaStep,LockScreen}.test.jsx`, `screens/settings/SettingsScreen.test.jsx`, `LiveApp.test.jsx`, `boundaries.test.js`; `dashboard/src/devProxy.test.js`. |

**Modify — dashboard**

| File | Change |
|---|---|
| `src/backendApi.js` | `TOKEN_KEYS`, `err.retryAfter`, `forget()`, `reauth()` (Task 7). |
| `src/clinicalI18n.js` | Three new server messages, in the old workspace's four languages (Tasks 2, 5). |
| `src/live/prefs.js`, `theme/ThemeProvider.jsx`, `i18n/I18nProvider.jsx`, `ui/Tabs.jsx`, `ui/riskStyle.js`, `ui/Toast.jsx`, `ui/index.js`, `theme/tokens.js` | Wave 1B leftovers, `resetKey`, type sizes (Task 6); `Alert` export (Task 8). |
| `src/live/i18n/catalog.js`, `i18n/strings.test.js` | One import per new namespace; reviewed AZ = TR texts (Tasks 9, 10, 15, 17, 21, 22). |
| `src/live/theme/tokens.test.js` | The dark gradient's contrast (Task 17). |
| `src/main.jsx`, `src/routing.test.js`, `vite.config.js` | Live → `LiveApp`; `?eski=1`; the proxy (Task 26). |
| Existing tests | `backendApi.test.js` (Task 7); `ui/{riskStyle,choice,Table,surfaces,Toast}.test.*`, `theme/ThemeProvider.test.jsx`, `i18n/I18nProvider.test.jsx` (Task 6). |

**Modify — docs** (Task 27): `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md`, `docs/EDGE-BRIDGE-LOCAL.md`, `docs/homunculus-rehber-TR.md`, `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`.

Read and left alone: `ClinicalDemo.jsx`, `clinicalDemo.js`, `liveStore.js`, `liveAuth.js`, `liveAdapters.js`, `liveConnection.js`, `index.css`, `index.html`, `nginx.conf` (it already proxies `/auth/*`, `/auth/reauth` included, and per-address limits only `/auth/login`).

---

### Task 0: Baseline and plan commit

**Files:** none changed (this plan file is committed).

- [ ] **Step 1: Confirm the worktree, branch and head**

```bash
cd /c/tmp/homunculus-g1
git status --short --branch | head -3
git log --oneline -1
```
Expected: `## feat/canli-tasarim` with nothing uncommitted; head `9ec264b docs: F8 — unanswered binds dated a deadline later, …` or a later commit.

- [ ] **Step 2: Record the backend baseline** (the "Ground rules" exports first; about 40 minutes for the whole suite)

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest -q -p no:cacheprovider 2>&1 | tail -1
```
Expected: `2188 passed, 6 skipped` (and warnings). If it differs, use the real numbers as the base. (The 3.12 venv: `2184 passed, 8 skipped`; Task 5 runs both.)

- [ ] **Step 3: Record the dashboard baseline**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  63 passed (63)`, `Tests  1317 passed (1317)`, `✓ built in …`.

- [ ] **Step 4: Record the mobile app's baseline** (Task 3 changes it; `npm ci --prefer-offline --no-audit --no-fund` there first if it has no `node_modules`)

```bash
cd /c/tmp/homunculus-g1/homunculus-mobile
npx jest 2>&1 | grep -E "^Tests:|^FAIL" | sort -u
```
Expected: `FAIL __tests__/charter.test.ts`, `FAIL __tests__/recording.test.ts`, `Tests:       3 failed, 295 passed, 298 total` — failing before this plan (Task 3, Step 8).

- [ ] **Step 5: Commit the plan**

```bash
cd /c/tmp/homunculus-g1
git add docs/superpowers/plans/2026-10-04-g1-dalga2-kabuk-giris.md
git commit -m "docs(plan): G1 Wave 2 — the live shell and sign-in, 2FA, first-sign-in password change, lock screen (G1-07, G1-08)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 1: `users.must_change_password` — migration `0011`

**Files:**
- Create: `homunculus-engine/alembic/versions/0011_users_must_change_password.py`
- Modify: `homunculus-engine/src/homunculus/auth/models.py:64-66`
- Test: `homunculus-engine/tests/test_migration_0011_must_change_password.py`; `homunculus-engine/tests/test_migration_0010_orm_writes.py` (its administrator from before `0011` is flagged now)

- [ ] **Step 1: Write the failing test.** The user decided that every LOCAL account existing at the deploy chooses its own password once (decision 16): nothing before `0011` recorded which local passwords an administrator typed. **Create** `homunculus-engine/tests/test_migration_0011_must_change_password.py`:

```python
# homunculus-engine/tests/test_migration_0011_must_change_password.py
"""Migration 0011 on a database built by the real chain (`clean_db`, never `create_all`): every
LOCAL account that existed before it is flagged — it chooses its own password at its next sign-in
(the user's decision) — and no AD account is; the column is NOT NULL with a false default for
accounts made afterwards, agrees with the model, and the downgrade takes it away again. Sync tests
on purpose (alembic runs its own event loop, see `clean_db`). Synthetic accounts only."""
from __future__ import annotations

import uuid

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

import homunculus.admission.models  # noqa: F401  (register every table on Base.metadata)
import homunculus.auth.models  # noqa: F401
import homunculus.escalation.models  # noqa: F401
import homunculus.tenant.models  # noqa: F401
from homunculus.db import Base
from tests.conftest import requires_db

pytestmark = [requires_db]


def _columns(engine) -> dict[str, dict]:
    return {c["name"]: c for c in inspect(engine).get_columns("users")}


def _add_account(conn, username: str, source: str = "local") -> uuid.UUID:
    """An account as 0010 left the table: no `must_change_password` named in the INSERT."""
    uid = uuid.uuid4()
    conn.execute(text(
        "INSERT INTO users (id, username, email, full_name, hashed_password, auth_source, "
        "totp_enabled, is_active, is_platform_support) VALUES (:id, :u, :u, 'Sentetik', "
        ":pw, :src, false, true, false)"),
        {"id": uid, "u": username, "pw": "x" if source == "local" else None, "src": source})
    return uid


def test_every_local_account_from_before_0011_is_flagged_and_no_ad_one(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0010")
    with engine.begin() as conn:
        local = _add_account(conn, "yerel@example.com")
        seed = _add_account(conn, "admin")                 # the seed administrator is local too
        directory = _add_account(conn, "ad.hesap", source="ldap")
        other_ad = _add_account(conn, "ad.ikinci", source="ldap")
    command.upgrade(cfg, "0011")

    with engine.begin() as conn:
        flags = dict(conn.execute(text("SELECT id, must_change_password FROM users")).all())
    assert flags == {local: True, seed: True, directory: False, other_ad: False}
    column = _columns(engine)["must_change_password"]
    assert column["nullable"] is False
    assert "false" in str(column["default"]).lower()


def test_an_insert_that_does_not_name_the_flag_gets_false(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        uid = _add_account(conn, "sonra@example.com")
        assert conn.execute(text("SELECT must_change_password FROM users WHERE id = :id"),
                            {"id": uid}).scalar_one() is False


def test_the_downgrade_drops_the_column_and_the_upgrade_flags_again(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        uid = _add_account(conn, "gidip@example.com")
        directory = _add_account(conn, "ad.donus", source="ldap")
    command.downgrade(cfg, "0010")
    assert "must_change_password" not in _columns(engine)
    with engine.begin() as conn:                       # the accounts themselves survive
        assert conn.execute(text("SELECT count(*) FROM users")).scalar_one() == 2
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        flags = dict(conn.execute(text("SELECT id, must_change_password FROM users")).all())
    assert flags == {uid: True, directory: False}


def test_the_model_and_the_migration_agree_on_the_column(clean_db):
    """Type, nullability, presence: the scoped parity test of 0010 leaves this column out."""
    engine, cfg = clean_db
    command.upgrade(cfg, "head")

    def only_the_flag(object_, name, type_, reflected, compare_to):
        if type_ == "table":
            return name == "users"
        if type_ == "column":
            return name == "must_change_password"
        return False

    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={
            "compare_type": True, "compare_server_default": False,
            "include_object": only_the_flag})
        assert compare_metadata(ctx, Base.metadata) == []
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest tests/test_migration_0011_must_change_password.py -q 2>&1 | tail -6
```
Expected: `3 failed, 1 passed` — the first test cannot reach revision `0011` (`Can't locate revision identified by '0011'`), the other two find no column (`UndefinedColumn: column "must_change_password" does not exist`). The parity test passes for now: neither the model nor the database has the column yet, so they agree; it starts guarding once Step 4 adds the model column.

- [ ] **Step 3: The migration.** **Create** `homunculus-engine/alembic/versions/0011_users_must_change_password.py`:

```python
# homunculus-engine/alembic/versions/0011_users_must_change_password.py
"""users.must_change_password: a temporary password is replaced at the next sign-in

Revision 0011, follows 0010 (kept separate although 0010 is unreleased: 0010 is the RBAC
conversion and is reviewed as one piece).

One boolean column, NOT NULL, server default false. `POST /admin/users` and
`POST /admin/users/{id}/reset-password` set it on the LOCAL account they give a temporary
password; the user's own `POST /auth/password` clears it. While it is set, a local account's
session reaches only /auth/password, /auth/me, /auth/refresh and /auth/totp/* (403
`password_change_required` elsewhere: auth/dependencies.py and the board's resolver in
api/prodserver.py). An AD account's password lives in AD and is never flagged.

The upgrade flags EVERY local account that already exists (the user's decision, plan G1 Wave 2):
before 0011 nothing recorded whether a local password was a temporary one an administrator
typed — the seed administrator's included — so each such account chooses its own password once,
at its first sign-in after the deploy. AD accounts are left alone.

Downgrade drops the column: the flags are lost and those accounts keep working with the
password they have.

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-04
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("must_change_password", sa.Boolean(), nullable=False,
                                     server_default=sa.false()))
    # Every local account chooses its own password once; 'local' is auth.models.AUTH_LOCAL
    # (written out: a migration does not import the model it may outlive).
    op.execute("UPDATE users SET must_change_password = true WHERE auth_source = 'local'")


def downgrade() -> None:
    op.drop_column("users", "must_change_password")
```

- [ ] **Step 4: The model.** **In** `homunculus-engine/src/homunculus/auth/models.py` **replace:**

```python
    sessions_revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # TOTP secret (Base32)
```
**with:**
```python
    sessions_revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Set when an administrator gives this LOCAL account a temporary password (POST /admin/users,
    # reset-password); cleared by the user's own change (POST /auth/password). While it is set
    # the session reaches only the password change and the session routes (auth/dependencies.py).
    # Never set for an AD account, whose password lives in AD (auth.service.password_change_due).
    must_change_password: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default=false()
    )
    # TOTP secret (Base32)
```

- [ ] **Step 5: The deploy-blocker-B1 test meets the flag.** `test_migration_0010_orm_writes` builds an administrator before `0010`, migrates to head and has it create a user through the API — the VM administrator's first act. From Task 2 on, that administrator — flagged by `0011` — would get 403 `password_change_required`; the test says so, and does the change the administrator does at the first sign-in. **In** `homunculus-engine/tests/test_migration_0010_orm_writes.py` **replace:**

```python
    command.upgrade(cfg, "head")

    status, body = asyncio.run(_create_a_nurse(admin_id))
```
**with:**
```python
    command.upgrade(cfg, "head")
    # 0011 flagged this local administrator: it chooses its own password at its first sign-in
    # after the deploy (plan G1 Wave 2, decision 1), and until then every route but the
    # password change answers 403. That change, done here:
    with engine.begin() as conn:
        assert conn.execute(text("SELECT must_change_password FROM users WHERE id = :id"),
                            {"id": admin_id}).scalar_one() is True
        conn.execute(text("UPDATE users SET must_change_password = false WHERE id = :id"),
                     {"id": admin_id})

    status, body = asyncio.run(_create_a_nurse(admin_id))
```

- [ ] **Step 6: Run it to see it pass, with the 0010 migration tests**

```bash
PYTHONPATH=src "$PY" -m pytest tests/test_migration_0011_must_change_password.py tests/test_migration_0010_conversion.py tests/test_migration_0010_orm_writes.py tests/test_migration_0010_schema_parity.py tests/test_migration_0010_defaults.py -q 2>&1 | tail -1
```
Expected: all passed, none skipped (`4` of them new). `test_migration_0010_orm_writes` now inserts the new column through the ORM on a database migrated to head — the deploy-blocker-B1 check covers `0011` too.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/homunculus-g1
git add homunculus-engine/alembic/versions/0011_users_must_change_password.py homunculus-engine/src/homunculus/auth/models.py homunculus-engine/tests/test_migration_0011_must_change_password.py homunculus-engine/tests/test_migration_0010_orm_writes.py
git commit -m "feat(auth): users.must_change_password, migration 0011

A temporary password from an administrator is to be replaced at the next
sign-in (roadmap D4). NOT NULL, default false; the upgrade flags every
local account that already exists (the user's decision: each chooses its
own password once after the deploy), never an AD one; the downgrade drops
the column.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The temporary password is replaced first — the rule and the gate

**Files:**
- Modify: `homunculus-engine/src/homunculus/auth/service.py`, `auth/dependencies.py`, `auth/schemas.py`, `auth/router.py`, `admin/service.py`, `admin/schemas.py`, `admin/router.py`
- Modify: `homunculus-engine/tests/test_route_inventory.py`
- Modify: `dashboard/src/clinicalI18n.js` (the old workspace translates the two new messages)
- Test: `homunculus-engine/tests/test_auth_password_change.py`

- [ ] **Step 1: Write the failing test.** **Create** `homunculus-engine/tests/test_auth_password_change.py`:

```python
# homunculus-engine/tests/test_auth_password_change.py
"""A temporary password is replaced at the first sign-in (roadmap D4, plan G1 Wave 2 decision 1):
an administrator's new account or password reset flags the LOCAL account; while flagged, its
session reaches only /auth/password, /auth/me, /auth/refresh and /auth/totp/*; the change clears
the flag. MFA comes first. An AD account is never flagged. Synthetic accounts only."""
from __future__ import annotations

import pyotp
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

import homunculus.scope.models  # noqa: F401  (staff_scopes, read by /scope/me, before create_all)
from homunculus.api.app import create_app
from homunculus.auth.groups import ensure_default_groups, set_manual_groups
from homunculus.auth.models import AUTH_LDAP, AUTH_LOCAL, TenantMembership, User
from homunculus.auth.service import (
    build_context, hash_password, issue_tokens, password_change_due,
)
from homunculus.db import get_db
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db

PASSWORD = "Gizli-123"
TEMPORARY = "Gecici-Parola-1"
CHOSEN = "Kendi-Parolam-9"


# ---------------------------------------------------------------- the rule, no database
@pytest.mark.parametrize("source,flag,due", [
    (AUTH_LOCAL, True, True), (AUTH_LOCAL, False, False),
    (AUTH_LDAP, True, False), (AUTH_LDAP, False, False),
])
def test_only_a_flagged_local_account_must_change_its_password(source, flag, due):
    user = User(username="u", full_name="U", auth_source=source, must_change_password=flag)
    assert password_change_due(user) is due


def test_the_token_response_says_so():
    from homunculus.auth.service import EMPTY_CONTEXT
    user = User(username="u", full_name="U", auth_source=AUTH_LOCAL, must_change_password=True,
                token_version=0, totp_enabled=False)
    assert issue_tokens(user, EMPTY_CONTEXT, mfa_verified=False)["password_change_required"]
    user.must_change_password = False
    assert not issue_tokens(user, EMPTY_CONTEXT, mfa_verified=False)["password_change_required"]


# ---------------------------------------------------------------- end to end


@pytest_asyncio.fixture
async def world(db_session):
    tenant = Tenant(name="Sentetik Hastane", slug="demo-hastanesi", country_code="TR")
    db_session.add(tenant)
    await db_session.flush()
    groups = await ensure_default_groups(db_session, tenant.id)

    async def make(username, group_slug, **kw):
        u = User(username=username, email=f"{username}@example.com", full_name=username.title(),
                 hashed_password=kw.pop("hashed_password", hash_password(PASSWORD)), **kw)
        db_session.add(u)
        await db_session.flush()
        db_session.add(TenantMembership(user_id=u.id, tenant_id=tenant.id))
        await db_session.flush()
        await set_manual_groups(db_session, user=u, tenant_id=tenant.id,
                                group_ids=[groups[group_slug].id], granted_by_id=None)
        return u

    admin = await make("admin", "hospital_admin")
    ldap = await make("ldapci", "nurse", auth_source=AUTH_LDAP, hashed_password=None)
    await db_session.commit()
    return {"tenant": tenant, "groups": groups, "admin": admin, "ldap": ldap, "make": make}


@pytest_asyncio.fixture
async def client(db_session):
    app = create_app({"bridge-token": "demo-hastanesi"}, run_escalation_loop=False)
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _admin_headers(db, admin) -> dict:
    tokens = issue_tokens(admin, await build_context(db, admin), mfa_verified=True)
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def _bearer(tokens: dict) -> dict:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def _flag(db, user_id) -> bool:
    return (await db.execute(select(User.must_change_password).where(User.id == user_id)
                             .execution_options(populate_existing=True))).scalar_one()


async def _create(c, admin, username, group_id):
    res = await c.post("/admin/users", headers=admin, json={
        "username": username, "full_name": "Sentetik Kişi", "password": TEMPORARY,
        "group_ids": [str(group_id)]})
    assert res.status_code == 201, res.text
    return res.json()


@pytest.mark.asyncio
@requires_db
async def test_a_new_account_must_replace_its_temporary_password_first(client, world, db_session):
    c = client
    admin = await _admin_headers(db_session, world["admin"])
    created = await _create(c, admin, "selin", world["groups"]["nurse"].id)
    assert created["must_change_password"] is True

    tokens = (await c.post("/auth/login", json={"login": "selin", "password": TEMPORARY})).json()
    assert tokens["password_change_required"] is True and tokens["requires_mfa"] is False
    me = await c.get("/auth/me", headers=_bearer(tokens))
    assert me.status_code == 200 and me.json()["must_change_password"] is True
    # The routers; the board's own resolver (/patients, /stream-ticket) is tests/test_jwt_caller.py.
    for path in ("/scope/me", "/admissions", "/admin/users"):
        res = await c.get(path, headers=_bearer(tokens))
        assert (res.status_code, res.json()["detail"]) == (403, "password_change_required"), path

    changed = await c.post("/auth/password", headers=_bearer(tokens),
                           json={"current_password": TEMPORARY, "new_password": CHOSEN})
    assert changed.status_code == 200, changed.text
    fresh = changed.json()
    assert fresh["password_change_required"] is False
    assert await _flag(db_session, created["id"]) is False
    assert (await c.get("/scope/me", headers=_bearer(fresh))).status_code == 200
    users = {u["username"]: u for u in (await c.get("/admin/users", headers=admin)).json()}
    assert users["selin"]["must_change_password"] is False


@pytest.mark.asyncio
@requires_db
async def test_a_password_reset_flags_a_local_account_and_never_an_ad_one(client, world,
                                                                         db_session):
    c = client
    admin = await _admin_headers(db_session, world["admin"])
    nurse = await world["make"]("ayse", "nurse")
    await db_session.commit()
    res = await c.post(f"/admin/users/{nurse.id}/reset-password", headers=admin,
                       json={"password": TEMPORARY})
    assert res.status_code == 200
    assert await _flag(db_session, nurse.id) is True
    res = await c.post(f"/admin/users/{world['ldap'].id}/reset-password", headers=admin,
                       json={"password": TEMPORARY})
    assert res.status_code == 400
    assert await _flag(db_session, world["ldap"].id) is False


@pytest.mark.asyncio
@requires_db
async def test_an_ad_account_with_the_flag_set_by_hand_is_not_held(client, world, db_session):
    """Defence in depth: nothing writes the flag on an AD account, and if something did, the
    account would be stuck — its password cannot be changed here."""
    c = client
    await db_session.execute(update(User).where(User.id == world["ldap"].id)
                             .values(must_change_password=True))
    await db_session.commit()
    user = (await db_session.execute(select(User).where(User.id == world["ldap"].id)
                                     .execution_options(populate_existing=True))).scalar_one()
    tokens = issue_tokens(user, await build_context(db_session, user), mfa_verified=False)
    assert tokens["password_change_required"] is False
    assert (await c.get("/scope/me", headers=_bearer(tokens))).status_code == 200
    assert (await c.get("/auth/me", headers=_bearer(tokens))).json()["must_change_password"] is False


@pytest.mark.asyncio
@requires_db
async def test_mfa_comes_before_the_password_change(client, world, db_session):
    """An attending (MFA group) with a temporary password: the TOTP step first, then the
    change. The temporary password alone never chooses the next one."""
    c = client
    admin = await _admin_headers(db_session, world["admin"])
    created = await _create(c, admin, "dr.kaya", world["groups"]["attending"].id)

    pending = (await c.post("/auth/login", json={"login": "dr.kaya", "password": TEMPORARY})).json()
    assert pending["requires_mfa"] is True and pending["password_change_required"] is True
    res = await c.post("/auth/password", headers=_bearer(pending),
                       json={"current_password": TEMPORARY, "new_password": CHOSEN})
    assert (res.status_code, res.json()["detail"]) == (403, "mfa_required")

    uri = (await c.post("/auth/totp/setup", headers=_bearer(pending))).json()["provisioning_uri"]
    code = pyotp.parse_uri(uri).now()
    verified = (await c.post("/auth/totp/verify", headers=_bearer(pending),
                             json={"code": code})).json()
    assert verified["requires_mfa"] is False and verified["password_change_required"] is True
    res = await c.get("/scope/me", headers=_bearer(verified))
    assert (res.status_code, res.json()["detail"]) == (403, "password_change_required")
    res = await c.post("/auth/password", headers=_bearer(verified),
                       json={"current_password": TEMPORARY, "new_password": CHOSEN})
    assert res.status_code == 200 and res.json()["password_change_required"] is False
    assert await _flag(db_session, created["id"]) is False


@pytest.mark.asyncio
@requires_db
async def test_the_temporary_password_cannot_be_kept(client, world, db_session):
    c = client
    admin = await _admin_headers(db_session, world["admin"])
    created = await _create(c, admin, "aynen", world["groups"]["nurse"].id)
    tokens = (await c.post("/auth/login", json={"login": "aynen", "password": TEMPORARY})).json()
    res = await c.post("/auth/password", headers=_bearer(tokens),
                       json={"current_password": TEMPORARY, "new_password": TEMPORARY})
    assert (res.status_code, res.json()["detail"]) == (
        400, "Yeni parola mevcut paroladan farklı olmalı")
    assert await _flag(db_session, created["id"]) is True
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest tests/test_auth_password_change.py -q 2>&1 | tail -3
```
Expected: collection error — `ImportError: cannot import name 'password_change_due' from 'homunculus.auth.service'`.

- [ ] **Step 3: The rule, the token field, the change.** **In** `homunculus-engine/src/homunculus/auth/service.py` **replace:**

```python
def credential_fingerprint(user: User) -> str:
```
**with:**
```python
def password_change_due(user: User) -> bool:
    """The account still holds a temporary password an administrator gave it, and must replace it
    before anything else (users.must_change_password). Only ever a LOCAL account: an AD account's
    password lives in AD, and the flag is not set for one — this is the second line."""
    return bool(user.must_change_password) and user.auth_source == AUTH_LOCAL


def credential_fingerprint(user: User) -> str:
```

**In** `homunculus-engine/src/homunculus/auth/service.py` **replace:**

```python
    """Access + refresh tokens. `requires_mfa` means "a TOTP step is still pending"."""
```
**with:**
```python
    """Access + refresh tokens. `requires_mfa` means "a TOTP step is still pending";
    `password_change_required`, that the account must replace its temporary password next (after
    the TOTP step, when both are due: /auth/password is behind the MFA gate)."""
```

**In** `homunculus-engine/src/homunculus/auth/service.py` **replace:**

```python
        "mfa_enrolled": bool(user.totp_enabled),
    }
```
**with:**
```python
        "mfa_enrolled": bool(user.totp_enabled),
        "password_change_required": password_change_due(user),
    }
```

**In** `homunculus-engine/src/homunculus/auth/service.py` **replace:**

```python
class PasswordError(ValueError):
```
**with:**
```python
# The shortest password a person may choose; the admin schemas' `min_length=8` for a temporary
# one is the same rule. The "8" in the message below is this number.
PASSWORD_MIN_LENGTH = 8


class PasswordError(ValueError):
```

**In** `homunculus-engine/src/homunculus/auth/service.py` **replace:**

```python
async def change_password(db: AsyncSession, user: User, current: str, new: str) -> None:
    """The new password's length is checked BEFORE the current password: the other order would
    let a stolen session test guesses at the current password by sending a too-short new one —
    "too short" would mean "right guess", and nothing would change or look unusual."""
    if user.auth_source != AUTH_LOCAL:
        raise PasswordError("Parola Active Directory tarafından yönetiliyor", "directory_account")
    if len(new) < 8:
        raise PasswordError("Yeni parola en az 8 karakter olmalı", "too_short")
    if not await run_bcrypt(verify_local_password, user.auth_source, user.hashed_password,
                            current):
        raise PasswordError("Mevcut parola yanlış", "wrong_current")
    user.hashed_password = await run_bcrypt(hash_password, new)
    await bump_user(db, user)
```
**with:**
```python
async def change_password(db: AsyncSession, user: User, current: str, new: str) -> None:
    """The new password's rules are checked BEFORE the current password: the other order would
    let a stolen session test guesses at the current password by sending a too-short new one —
    "too short" would mean "right guess", and nothing would change or look unusual. The same
    holds for "unchanged", which compares the two typed values and says nothing about the stored
    one. A temporary password (`must_change_password`) is replaced here, and the flag goes with
    it."""
    if user.auth_source != AUTH_LOCAL:
        raise PasswordError("Parola Active Directory tarafından yönetiliyor", "directory_account")
    if len(new) < PASSWORD_MIN_LENGTH:
        raise PasswordError("Yeni parola en az 8 karakter olmalı", "too_short")
    if new == current:
        raise PasswordError("Yeni parola mevcut paroladan farklı olmalı", "unchanged")
    if not await run_bcrypt(verify_local_password, user.auth_source, user.hashed_password,
                            current):
        raise PasswordError("Mevcut parola yanlış", "wrong_current")
    user.hashed_password = await run_bcrypt(hash_password, new)
    user.must_change_password = False
    await bump_user(db, user)
```

- [ ] **Step 4: The gate.** **In** `homunculus-engine/src/homunculus/auth/dependencies.py` **replace:**

```python
    get_principal           + the MFA gate: 403 `mfa_required` while a TOTP step is pending
```
**with:**
```python
    get_principal_pre_password  + the MFA gate: 403 `mfa_required` while a TOTP step is pending —
                            ONLY for POST /auth/password
    get_principal           + the password gate: 403 `password_change_required` while the account
                            holds a temporary password (users.must_change_password, local only)
```

**In** `homunculus-engine/src/homunculus/auth/dependencies.py` **replace:**

```python
from homunculus.auth.service import get_user_by_id
```
**with:**
```python
from homunculus.auth.service import get_user_by_id, password_change_due
```

**In** `homunculus-engine/src/homunculus/auth/dependencies.py` **replace:**

```python
PLATFORM_ONLY = "Platform operatörü yetkisi gerekli"
```
**with:**
```python
PLATFORM_ONLY = "Platform operatörü yetkisi gerekli"
# A temporary password an administrator gave the account must be replaced first (POST /auth/password).
PASSWORD_CHANGE_REQUIRED = "password_change_required"
```

**In** `homunculus-engine/src/homunculus/auth/dependencies.py` **replace:**

```python
async def get_principal(principal: Principal = Depends(get_principal_pre_mfa)) -> Principal:
    if principal.mfa_required and not principal.mfa_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="mfa_required")
    return principal
```
**with:**
```python
async def get_principal_pre_password(
    principal: Principal = Depends(get_principal_pre_mfa),
) -> Principal:
    """The MFA gate. POST /auth/password alone stops here: a session whose account must replace
    its temporary password reaches the change and nothing else. MFA comes first, so a password
    reset by an administrator never lets the temporary password alone choose the next one for an
    account that has an authenticator."""
    if principal.mfa_required and not principal.mfa_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="mfa_required")
    return principal


async def get_principal(principal: Principal = Depends(get_principal_pre_password)) -> Principal:
    """Every route's principal: MFA done, and no temporary password left to replace. The flag is
    read from the user row get_principal_pre_mfa loaded anyway, so it takes effect at once — no
    token claim to go stale, no extra query."""
    if password_change_due(principal.user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=PASSWORD_CHANGE_REQUIRED)
    return principal
```

- [ ] **Step 5: The schemas.** **In** `homunculus-engine/src/homunculus/auth/schemas.py` **replace:**

```python
    requires_mfa: bool           # a TOTP step is still pending for this session
    mfa_enrolled: bool = False   # the user already has a verified authenticator
```
**with:**
```python
    requires_mfa: bool           # a TOTP step is still pending for this session
    mfa_enrolled: bool = False   # the user already has a verified authenticator
    # The account holds a temporary password: POST /auth/password is the only way on (after the
    # TOTP step, when that is pending too). Never true for an AD account.
    password_change_required: bool = False
```

**In** `homunculus-engine/src/homunculus/auth/schemas.py` **replace:**

```python
    groups: list[GroupBrief]
    perms: list[str]
```
**with:**
```python
    groups: list[GroupBrief]
    perms: list[str]
    must_change_password: bool = False   # as TokenResponse.password_change_required
```

- [ ] **Step 6: The routes.** **In** `homunculus-engine/src/homunculus/auth/router.py` **replace:**

```python
from homunculus.auth.dependencies import (
    Principal, get_current_user_pre_mfa, get_principal, get_principal_pre_mfa,
    get_user_for_enrolment,
)
```
**with:**
```python
from homunculus.auth.dependencies import (
    Principal, get_current_user_pre_mfa, get_principal, get_principal_pre_mfa,
    get_principal_pre_password, get_user_for_enrolment,
)
```

**In** `homunculus-engine/src/homunculus/auth/router.py` **replace:**

```python
    find_user_for_sign_in, get_user_by_id, issue_tokens, mark_login, run_bcrypt, setup_totp,
    verify_local_password,
)
```
**with:**
```python
    find_user_for_sign_in, get_user_by_id, issue_tokens, mark_login, password_change_due,
    run_bcrypt, setup_totp, verify_local_password,
)
```

**In** `homunculus-engine/src/homunculus/auth/router.py` **replace:**

```python
        perms=sorted(ctx.perms),
    )
```
**with:**
```python
        perms=sorted(ctx.perms), must_change_password=password_change_due(current_user),
    )
```

**In** `homunculus-engine/src/homunculus/auth/router.py` **replace:**

```python
                   principal: Principal = Depends(get_principal),
                   db: AsyncSession = Depends(get_db)) -> TokenResponse:
    """The change retires every existing session (token version and credential fingerprint
    both move), so the caller receives a fresh pair and keeps working."""
```
**with:**
```python
                   principal: Principal = Depends(get_principal_pre_password),
                   db: AsyncSession = Depends(get_db)) -> TokenResponse:
    """The change retires every existing session (token version and credential fingerprint
    both move), so the caller receives a fresh pair and keeps working. It is also how a
    temporary password is replaced: the one route such a session reaches (after MFA)."""
```

- [ ] **Step 7: The administrator sets the flag.** **In** `homunculus-engine/src/homunculus/admin/service.py` **replace:**

```python
    user = User(username=key, email=mail, full_name=full_name.strip(),
                hashed_password=hashed, auth_source=AUTH_LOCAL)
```
**with:**
```python
    # A temporary password: the user replaces it at the first sign-in (D4, auth/dependencies.py).
    user = User(username=key, email=mail, full_name=full_name.strip(),
                hashed_password=hashed, auth_source=AUTH_LOCAL, must_change_password=True)
```

**In** `homunculus-engine/src/homunculus/admin/service.py` **replace:**

```python
    version moves (every access token ends)."""
    await _may_reset(db, tenant_id, user, actor)
    if user.auth_source != AUTH_LOCAL:
        raise AdminError(400, DIRECTORY_PASSWORD)
    user.hashed_password = await run_bcrypt(hash_password, password)
```
**with:**
```python
    version moves (every access token ends). The user replaces it at the next sign-in
    (`must_change_password`, D4)."""
    await _may_reset(db, tenant_id, user, actor)
    if user.auth_source != AUTH_LOCAL:
        raise AdminError(400, DIRECTORY_PASSWORD)
    user.hashed_password = await run_bcrypt(hash_password, password)
    user.must_change_password = True
```

**In** `homunculus-engine/src/homunculus/admin/schemas.py` **replace:**

```python
    last_login_at: datetime | None
    groups: list[UserGroupOut]


class UserCreate(BaseModel):
```
**with:**
```python
    last_login_at: datetime | None
    groups: list[UserGroupOut]
    # A temporary password from an administrator that the user has not replaced yet.
    must_change_password: bool = False


class UserCreate(BaseModel):
```

**In** `homunculus-engine/src/homunculus/admin/router.py` **replace:**

```python
from homunculus.auth.permissions import ALL_PERMISSIONS, PERMISSIONS
```
**with:**
```python
from homunculus.auth.permissions import ALL_PERMISSIONS, PERMISSIONS
from homunculus.auth.service import password_change_due
```

**In** `homunculus-engine/src/homunculus/admin/router.py` **replace:**

```python
        last_login_at=user.last_login_at,
```
**with:**
```python
        last_login_at=user.last_login_at, must_change_password=password_change_due(user),
```

- [ ] **Step 8: Run it to see it pass**

```bash
PYTHONPATH=src "$PY" -m pytest tests/test_auth_password_change.py -q 2>&1 | tail -1
```
Expected: `10 passed`.

- [ ] **Step 9: The route inventory knows the new gate.** Run it first:

```bash
PYTHONPATH=src "$PY" -m pytest tests/test_route_inventory.py -q 2>&1 | tail -3
```
Expected: `2 failed, 1 passed` — both inventory tests name `/auth/password`, which no longer reaches `get_principal`.

**In** `homunculus-engine/tests/test_route_inventory.py` **replace:**

```python
"""Every JWT route reaches the MFA-gated principal; only /auth/totp/* and /auth/me may stop at the
pre-MFA one. A route added later without a guard fails here, not in a ward."""
```
**with:**
```python
"""Every JWT route reaches the full principal (MFA done, no temporary password left to replace);
only /auth/totp/* and /auth/me may stop at the pre-MFA one, and only /auth/password at the MFA
gate. A route added later without a guard fails here, not in a ward."""
```

**In** `homunculus-engine/tests/test_route_inventory.py` **replace:**

```python
from homunculus.auth.dependencies import get_principal, get_principal_pre_mfa
```
**with:**
```python
from homunculus.auth.dependencies import (
    get_principal, get_principal_pre_mfa, get_principal_pre_password,
)
```

**In** `homunculus-engine/tests/test_route_inventory.py` **replace:**

```python
PRE_MFA = {"/auth/totp/setup", "/auth/totp/verify", "/auth/me"}
```
**with:**
```python
PRE_MFA = {"/auth/totp/setup", "/auth/totp/verify", "/auth/me"}
# MFA-gated, but reachable while the account must still replace its temporary password: the one
# route that replaces it (D4). Everything else answers 403 `password_change_required` then.
PRE_PASSWORD = {"/auth/password"}
```

**In** `homunculus-engine/tests/test_route_inventory.py` **replace:**

```python
               and r.path not in PUBLIC | PRE_MFA
               and get_principal not in _calls(r.dependant)]
    assert missing == []


def test_only_enrolment_and_profile_routes_skip_the_mfa_gate():
    pre_only = {r.path for r in _routes()
                if get_principal_pre_mfa in _calls(r.dependant)
                and get_principal not in _calls(r.dependant)}
    assert pre_only == PRE_MFA
```
**with:**
```python
               and r.path not in PUBLIC | PRE_MFA | PRE_PASSWORD
               and get_principal not in _calls(r.dependant)]
    assert missing == []


def test_only_enrolment_and_profile_routes_skip_the_mfa_gate():
    pre_only = {r.path for r in _routes()
                if get_principal_pre_mfa in _calls(r.dependant)
                and get_principal_pre_password not in _calls(r.dependant)}
    assert pre_only == PRE_MFA


def test_only_the_password_change_skips_the_password_gate():
    mfa_only = {r.path for r in _routes()
                if get_principal_pre_password in _calls(r.dependant)
                and get_principal not in _calls(r.dependant)}
    assert mfa_only == PRE_PASSWORD
```

```bash
PYTHONPATH=src "$PY" -m pytest tests/test_route_inventory.py tests/test_auth_login.py tests/test_auth_tokens.py tests/test_auth_dependencies.py tests/test_admin_api.py -q 2>&1 | tail -1
```
Expected: all passed, none skipped.

- [ ] **Step 10: The old workspace translates the two new messages.** Its `i18n.rbac.test.js` reads `auth/dependencies.py` and `auth/service.py` as text:

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/i18n.rbac.test.js 2>&1 | grep -E "Tests "
```
Expected: `Tests  2 failed | 104 passed (106)` — `password_change_required` and `Yeni parola mevcut paroladan farklı olmalı`.

**In** `dashboard/src/clinicalI18n.js` **replace:**

```js
        wrongCurrentPassword: "Mevcut parola yanlış.",
```
**with:**
```js
        wrongCurrentPassword: "Mevcut parola yanlış.",
        passwordUnchanged: "Yeni parola mevcut paroladan farklı olmalı.",
        passwordChangeRequired: "Geçici parolanızı değiştirmeden devam edemezsiniz. Hesabım > Parola değiştir'i kullanın.",
```

**In** `dashboard/src/clinicalI18n.js` **replace:**

```js
        wrongCurrentPassword: "Cari parol yanlışdır.",
```
**with:**
```js
        wrongCurrentPassword: "Cari parol yanlışdır.",
        passwordUnchanged: "Yeni parol cari paroldan fərqli olmalıdır.",
        passwordChangeRequired: "Müvəqqəti parolunuzu dəyişmədən davam edə bilməzsiniz. Hesabım > Parolu dəyiş bölməsindən istifadə edin.",
```

**In** `dashboard/src/clinicalI18n.js` **replace:**

```js
        wrongCurrentPassword: "The current password is incorrect.",
```
**with:**
```js
        wrongCurrentPassword: "The current password is incorrect.",
        passwordUnchanged: "The new password must differ from the current one.",
        passwordChangeRequired: "Change your temporary password before you continue: My account > Change password.",
```

**In** `dashboard/src/clinicalI18n.js` **replace:**

```js
        wrongCurrentPassword: "Текущий пароль неверен.",
```
**with:**
```js
        wrongCurrentPassword: "Текущий пароль неверен.",
        passwordUnchanged: "Новый пароль должен отличаться от текущего.",
        passwordChangeRequired: "Смените временный пароль, прежде чем продолжить: Мой аккаунт > Сменить пароль.",
```

**In** `dashboard/src/clinicalI18n.js` **replace:**

```js
  ["mfa_reset_required", "mfaResetRequired"],
```
**with:**
```js
  ["mfa_reset_required", "mfaResetRequired"],
  ["password_change_required", "passwordChangeRequired"],
```

**In** `dashboard/src/clinicalI18n.js` **replace:**

```js
  ["Mevcut parola yanlış", "wrongCurrentPassword"],
```
**with:**
```js
  ["Mevcut parola yanlış", "wrongCurrentPassword"],
  ["Yeni parola mevcut paroladan farklı olmalı", "passwordUnchanged"],
```

- [ ] **Step 11: Gate**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  63 passed (63)`, `Tests  1319 passed (1319)`, `✓ built in …`.

- [ ] **Step 12: Commit**

```bash
cd /c/tmp/homunculus-g1
git add homunculus-engine/src/homunculus/auth/service.py homunculus-engine/src/homunculus/auth/dependencies.py homunculus-engine/src/homunculus/auth/schemas.py homunculus-engine/src/homunculus/auth/router.py homunculus-engine/src/homunculus/admin/service.py homunculus-engine/src/homunculus/admin/schemas.py homunculus-engine/src/homunculus/admin/router.py homunculus-engine/tests/test_auth_password_change.py homunculus-engine/tests/test_route_inventory.py dashboard/src/clinicalI18n.js
git commit -m "feat(auth): a temporary password is replaced before anything else

POST /admin/users and reset-password flag the local account; while the
flag is set every route but /auth/password, /auth/me, /auth/refresh and
/auth/totp/* answers 403 password_change_required (get_principal reads
the row it already loads). MFA first, then the password. /auth/password
clears the flag and refuses the current password as the new one. Never
for an AD account. TokenResponse, /auth/me and the admin's UserOut say so.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The board's resolver and the mobile app hold a temporary password too

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/prodserver.py`
- Modify: `homunculus-mobile/src/transport/authClient.ts`, `homunculus-mobile/app/(tabs)/settings.tsx`, `homunculus-mobile/src/i18n/tr.ts`
- Test: `homunculus-engine/tests/test_jwt_caller.py`; `homunculus-mobile/__tests__/authClient.test.ts`, `homunculus-mobile/__tests__/SettingsScreen.test.tsx`

- [ ] **Step 1: Write the failing tests.** **In** `homunculus-engine/tests/test_jwt_caller.py` **replace:**

```python
from homunculus.auth.models import TenantMembership, User
```
**with:**
```python
from homunculus.auth.models import AUTH_LDAP, TenantMembership, User
```

**In** `homunculus-engine/tests/test_jwt_caller.py` **replace:**

```python
async def test_a_slug_unknown_to_the_user_is_a_401_so_the_client_refreshes():
```
**with:**
```python
async def test_a_temporary_password_not_yet_replaced_blocks_the_board():
    """403 `password_change_required`, after the MFA gate — as get_principal answers on the
    routers (plan G1 Wave 2, decision 1)."""
    load = _Loader(_row(password_change_due=True))
    exc = await _refused(make_jwt_caller_resolver(load), _token())
    assert exc.status_code == 403 and exc.detail == "password_change_required"
    exc = await _refused(make_jwt_caller_resolver(load), _token(mfa_required=True))
    assert exc.detail == "mfa_required"                  # the MFA step comes first


async def test_a_slug_unknown_to_the_user_is_a_401_so_the_client_refreshes():
```

**In** `homunculus-engine/tests/test_jwt_caller.py` **replace:**

```python
    for part in ("users.username", "users.is_active", "users.token_version",
```
**with:**
```python
    for part in ("users.username", "users.is_active", "users.token_version",
                 "users.must_change_password", "users.auth_source",
```

**In** `homunculus-engine/tests/test_jwt_caller.py` **replace:**

```python
@requires_db
async def test_an_unknown_slug_or_a_missing_membership_is_unknown(ward):
```
**with:**
```python
@requires_db
async def test_the_read_says_whether_a_local_account_must_change_its_password(ward):
    db, nurse = ward["db"], ward["nurse"]
    assert (await _read_user_auth(str(nurse.id), "hastane-a")).password_change_due is False
    await _set(db, User, User.id == nurse.id, must_change_password=True)
    assert (await _read_user_auth(str(nurse.id), "hastane-a")).password_change_due is True
    await _set(db, User, User.id == nurse.id, auth_source=AUTH_LDAP)   # never an AD account
    assert (await _read_user_auth(str(nurse.id), "hastane-a")).password_change_due is False


@requires_db
async def test_an_unknown_slug_or_a_missing_membership_is_unknown(ward):
```

**In** `homunculus-engine/tests/test_jwt_caller.py` **replace:**

```python
@requires_db
async def test_a_pending_mfa_step_or_no_tenant_is_a_403(ward):
```
**with:**
```python
@requires_db
async def test_a_temporary_password_is_a_403_on_the_board(ward):
    db, nurse = ward["db"], ward["nurse"]
    auth = await bearer(db, nurse)
    await _set(db, User, User.id == nurse.id, must_change_password=True)
    r = await _patients(auth)
    assert r.status_code == 403 and r.json()["detail"] == "password_change_required"


@requires_db
async def test_a_pending_mfa_step_or_no_tenant_is_a_403(ward):
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest tests/test_jwt_caller.py -q 2>&1 | tail -6
```
Expected: `4 failed, 53 passed` — `UserAuthRow` has no `password_change_due`, the query has neither column, the board answers 200.

- [ ] **Step 3: Implement.** **In** `homunculus-engine/src/homunculus/api/prodserver.py` **replace:**

```python
from homunculus.auth.dependencies import MEMBERSHIP_INACTIVE, NO_TENANT
```
**with:**
```python
from homunculus.auth.dependencies import (
    MEMBERSHIP_INACTIVE, NO_TENANT, PASSWORD_CHANGE_REQUIRED,
)
```

**In** `homunculus-engine/src/homunculus/api/prodserver.py` **replace:**

```python
from homunculus.auth.models import User
```
**with:**
```python
from homunculus.auth.models import AUTH_LOCAL, User
```

**In** `homunculus-engine/src/homunculus/api/prodserver.py` **replace:**

```python
    the token's `tenant` slug (TENANT_OK, TENANT_UNKNOWN or TENANT_INACTIVE)."""
    username: str
    is_active: bool
    token_version: int
    tenant_verdict: str
```
**with:**
```python
    the token's `tenant` slug (TENANT_OK, TENANT_UNKNOWN or TENANT_INACTIVE).
    `password_change_due`: a LOCAL account still holding an administrator's temporary password
    (auth.service.password_change_due)."""
    username: str
    is_active: bool
    token_version: int
    tenant_verdict: str
    password_change_due: bool = False
```

**In** `homunculus-engine/src/homunculus/api/prodserver.py` **replace:**

```python
      403 "mfa_required"                         a pending MFA step
```
**with:**
```python
      403 "mfa_required"                         a pending MFA step
      403 "password_change_required"             a temporary password not yet replaced
```

**In** `homunculus-engine/src/homunculus/api/prodserver.py` **replace:**

```python
            raise HTTPException(status_code=403, detail="mfa_required")
        if slug is None:
```
**with:**
```python
            raise HTTPException(status_code=403, detail="mfa_required")
        if row.password_change_due:
            raise HTTPException(status_code=403, detail=PASSWORD_CHANGE_REQUIRED)
        if slug is None:
```

**In** `homunculus-engine/src/homunculus/api/prodserver.py` **replace:**

```python
    account = (User.username, User.is_active, User.token_version)
```
**with:**
```python
    account = (User.username, User.is_active, User.token_version, User.must_change_password,
               User.auth_source)
```

**In** `homunculus-engine/src/homunculus/api/prodserver.py` **replace:**

```python
                       token_version=row.token_version, tenant_verdict=verdict)
```
**with:**
```python
                       token_version=row.token_version, tenant_verdict=verdict,
                       password_change_due=bool(row.must_change_password)
                       and row.auth_source == AUTH_LOCAL)
```

- [ ] **Step 4: Run them to see them pass**

```bash
PYTHONPATH=src "$PY" -m pytest tests/test_jwt_caller.py -q 2>&1 | tail -1
```
Expected: `57 passed`.

- [ ] **Step 5: The mobile app says why, instead of a 403 everywhere.** A flagged account signing in on the phone gets its tokens with `password_change_required: true`, then 403 from every route; the app has no password form. It refuses the sign-in the way it refuses an MFA account (`MfaRequiredError`): nothing stored, a line saying to change the password on the dashboard first. The failing tests:

**In** `homunculus-mobile/__tests__/authClient.test.ts` **replace:**

```ts
  MfaRequiredError,
```
**with:**
```ts
  MfaRequiredError,
  PasswordChangeRequiredError,
```

**In** `homunculus-mobile/__tests__/authClient.test.ts` **replace:**

```ts
  it("throws a plain error carrying the server's detail on a 401 login", async () => {
```
**with:**
```ts
  it("throws PasswordChangeRequiredError and stores nothing while a temporary password is in use", async () => {
    const tokenStore = fakeTokenStore();
    const fetchImpl = jest.fn(async () =>
      jsonResponse(200, {
        access_token: "access-1",
        refresh_token: "refresh-1",
        token_type: "bearer",
        requires_mfa: false,
        password_change_required: true,
      })
    );
    const client = createAuthClient({ baseUrl: BASE_URL, fetchImpl, tokenStore });

    await expect(client.login("nurse@example.test", "Gecici-1")).rejects.toBeInstanceOf(
      PasswordChangeRequiredError
    );
    expect(tokenStore.setTokens).not.toHaveBeenCalled();
  });

  it("asks for the authenticator first when both are due", async () => {
    const tokenStore = fakeTokenStore();
    const fetchImpl = jest.fn(async () =>
      jsonResponse(200, {
        access_token: "access-1",
        refresh_token: "refresh-1",
        token_type: "bearer",
        requires_mfa: true,
        password_change_required: true,
      })
    );
    const client = createAuthClient({ baseUrl: BASE_URL, fetchImpl, tokenStore });

    await expect(client.login("doctor@example.test", "Gecici-1")).rejects.toBeInstanceOf(
      MfaRequiredError
    );
    expect(tokenStore.setTokens).not.toHaveBeenCalled();
  });

  it("throws a plain error carrying the server's detail on a 401 login", async () => {
```

**In** `homunculus-mobile/__tests__/SettingsScreen.test.tsx` **replace:**

```tsx
import { MfaRequiredError } from "../src/transport/authClient";
```
**with:**
```tsx
import { MfaRequiredError, PasswordChangeRequiredError } from "../src/transport/authClient";
```

**In** `homunculus-mobile/__tests__/SettingsScreen.test.tsx` **replace:**

```tsx
  it("maps a plain failure to the generic line carrying the server detail", async () => {
```
**with:**
```tsx
  it("maps PasswordChangeRequiredError to the change-it-on-the-dashboard line", async () => {
    const value = boardValue();
    (value.auth.login as jest.Mock).mockRejectedValue(new PasswordChangeRequiredError("temp"));
    mockUseBoard.mockReturnValue(value);
    await render(<SettingsScreen />);
    await submitLogin();
    expect(
      screen.getByText(
        "Bu hesabın geçici parolası değiştirilmeli; önce panodan giriş yapıp kendi parolanızı belirleyin.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Giriş başarısız/)).toBeNull();
  });

  it("maps a plain failure to the generic line carrying the server detail", async () => {
```

- [ ] **Step 6: Run them to see them fail** (`npm ci --prefer-offline --no-audit --no-fund` in `homunculus-mobile/` first if it has no `node_modules`)

```bash
cd /c/tmp/homunculus-g1/homunculus-mobile
npx jest __tests__/authClient.test.ts __tests__/SettingsScreen.test.tsx 2>&1 | grep -E "^Tests:"
```
Expected: `Tests:       2 failed, 11 passed, 13 total` — `PasswordChangeRequiredError` does not exist yet (the "both are due" test passes already: the MFA refusal comes first today too).

- [ ] **Step 7: Implement**

**In** `homunculus-mobile/src/transport/authClient.ts` **replace:**

```ts
// anything beyond MFA verification. Since the mobile app has no TOTP step yet, a `requires_mfa:
// true` response throws MfaRequiredError and stores nothing — the UI sends the clinician to the
// dashboard instead of holding a token it can't legally use.
```
**with:**
```ts
// anything beyond MFA verification. Since the mobile app has no TOTP step yet, a `requires_mfa:
// true` response throws MfaRequiredError and stores nothing — the UI sends the clinician to the
// dashboard instead of holding a token it can't legally use. Likewise `password_change_required:
// true` (a temporary password an administrator gave, migration 0011): every route but the
// password change answers 403 until it is replaced, and the app has no such form — it throws
// PasswordChangeRequiredError, stores nothing, and the clinician changes it on the dashboard.
```

**In** `homunculus-mobile/src/transport/authClient.ts` **replace:**

```ts
export class SessionExpiredError extends Error {
```
**with:**
```ts
export class PasswordChangeRequiredError extends Error {
  constructor(message = "This account's temporary password must be changed first. Use the dashboard for now.") {
    super(message);
    this.name = "PasswordChangeRequiredError";
  }
}

export class SessionExpiredError extends Error {
```

**In** `homunculus-mobile/src/transport/authClient.ts` **replace:**

```ts
  token_type: string;
  requires_mfa: boolean;
}
```
**with:**
```ts
  token_type: string;
  requires_mfa: boolean;
  /** Absent from an API older than migration 0011. */
  password_change_required?: boolean;
}
```

**In** `homunculus-mobile/src/transport/authClient.ts` **replace:**

```ts
    if (body.requires_mfa) {
      throw new MfaRequiredError();
    }
```
**with:**
```ts
    if (body.requires_mfa) {
      throw new MfaRequiredError();
    }
    if (body.password_change_required) {
      throw new PasswordChangeRequiredError();
    }
```

**In** `homunculus-mobile/app/(tabs)/settings.tsx` **replace:**

```tsx
import { MfaRequiredError } from "../../src/transport/authClient";
```
**with:**
```tsx
import { MfaRequiredError, PasswordChangeRequiredError } from "../../src/transport/authClient";
```

**In** `homunculus-mobile/app/(tabs)/settings.tsx` **replace:**

```tsx
            if (err instanceof MfaRequiredError) {
              setLoginError(t("login.mfaUnsupported"));
            } else if
```
**with:**
```tsx
            if (err instanceof MfaRequiredError) {
              setLoginError(t("login.mfaUnsupported"));
            } else if (err instanceof PasswordChangeRequiredError) {
              setLoginError(t("login.passwordChangeRequired"));
            } else if
```

**In** `homunculus-mobile/src/i18n/tr.ts` **replace:**

```ts
  "login.mfaUnsupported": "Bu hesap doğrulama kodu istiyor; şimdilik panodan giriş yapın.",
```
**with:**
```ts
  "login.mfaUnsupported": "Bu hesap doğrulama kodu istiyor; şimdilik panodan giriş yapın.",
  "login.passwordChangeRequired": "Bu hesabın geçici parolası değiştirilmeli; önce panodan giriş yapıp kendi parolanızı belirleyin.",
```

- [ ] **Step 8: Run them to see them pass, then the app's whole suite and its type check**

```bash
npx jest __tests__/authClient.test.ts __tests__/SettingsScreen.test.tsx 2>&1 | grep -E "^Tests:"
npx jest 2>&1 | grep -E "^Tests:|^FAIL" | sort -u
npx tsc --noEmit -p . 2>&1 | head -3
```
Expected: `Tests:       13 passed, 13 total`; then `Tests:       3 failed, 298 passed, 301 total` with `FAIL __tests__/charter.test.ts` and `FAIL __tests__/recording.test.ts` — **those three fail at `9ec264b` already** (the committed recording carries fields those tests do not list; not this plan's, leave them); then only the type error those tests already have (`__tests__/recording.test.ts(19,6): error TS1360`).

- [ ] **Step 9: Commit**

```bash
cd /c/tmp/homunculus-g1
git add homunculus-engine/src/homunculus/api/prodserver.py homunculus-engine/tests/test_jwt_caller.py homunculus-mobile/src/transport/authClient.ts "homunculus-mobile/app/(tabs)/settings.tsx" homunculus-mobile/src/i18n/tr.ts homunculus-mobile/__tests__/authClient.test.ts homunculus-mobile/__tests__/SettingsScreen.test.tsx
git commit -m "feat(api, mobile): the board answers 403 password_change_required too; the app says why

The production JWT resolver reads the flag and the account's source in its
one query, after the MFA gate, as get_principal does on the routers. The
mobile app refuses a sign-in whose temporary password must be replaced
(PasswordChangeRequiredError, nothing stored) and sends the clinician to
the dashboard, as it does for an MFA account.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `/auth/me` carries the hospital's name and its two screen-lock times

**Files:**
- Create: `homunculus-engine/src/homunculus/auth/session_policy.py`
- Modify: `homunculus-engine/src/homunculus/auth/schemas.py`, `auth/router.py`
- Modify: `deploy/local/docker-compose.yml:84`, `deploy/local/.env.example` (end)
- Test: `homunculus-engine/tests/test_session_policy.py`; `tests/test_auth_password_change.py` (one more test)

- [ ] **Step 1: Write the failing tests.** **Create** `homunculus-engine/tests/test_session_policy.py`:

```python
# homunculus-engine/tests/test_session_policy.py
"""SCREEN_LOCK_IDLE_MINUTES and SCREEN_LOCK_SIGNOUT_HOURS: the dashboard's idle lock, and how long
a browser may stay locked before it signs itself out — the hospital's to set (plan G1 Wave 2,
decision 2). A value the API cannot use falls back to the default with a warning — a typo must
neither stop the API nor leave a ward PC that never locks, or a lock that never ends."""
from __future__ import annotations

import logging

import pytest

from homunculus.auth.session_policy import (
    SCREEN_LOCK_DEFAULT_MINUTES, SCREEN_LOCK_MAX_MINUTES, SCREEN_LOCK_MIN_MINUTES,
    SCREEN_LOCK_SIGNOUT_DEFAULT_HOURS, SCREEN_LOCK_SIGNOUT_MAX_HOURS, SCREEN_LOCK_SIGNOUT_MIN_HOURS,
    lock_signout_hours, screen_lock_minutes,
)

SETTINGS = [
    ("SCREEN_LOCK_IDLE_MINUTES", screen_lock_minutes, SCREEN_LOCK_DEFAULT_MINUTES,
     SCREEN_LOCK_MIN_MINUTES, SCREEN_LOCK_MAX_MINUTES),
    ("SCREEN_LOCK_SIGNOUT_HOURS", lock_signout_hours, SCREEN_LOCK_SIGNOUT_DEFAULT_HOURS,
     SCREEN_LOCK_SIGNOUT_MIN_HOURS, SCREEN_LOCK_SIGNOUT_MAX_HOURS),
]


def test_the_defaults_and_ranges_are_the_plans():
    assert (SCREEN_LOCK_DEFAULT_MINUTES, SCREEN_LOCK_MIN_MINUTES,
            SCREEN_LOCK_MAX_MINUTES) == (10, 1, 60)
    assert (SCREEN_LOCK_SIGNOUT_DEFAULT_HOURS, SCREEN_LOCK_SIGNOUT_MIN_HOURS,
            SCREEN_LOCK_SIGNOUT_MAX_HOURS) == (12, 1, 72)


@pytest.mark.parametrize("name,read,default,low,high", SETTINGS)
def test_unset_or_blank_is_the_default_without_a_warning(name, read, default, low, high, caplog):
    with caplog.at_level(logging.WARNING):
        assert read({}) == default
        assert read({name: "  "}) == default
    assert caplog.records == []


@pytest.mark.parametrize("name,read,default,low,high", SETTINGS)
def test_a_whole_number_in_range_is_taken(name, read, default, low, high):
    assert read({name: str(low)}) == low
    assert read({name: f" {high} "}) == high
    assert read({name: str(default + 1)}) == default + 1


@pytest.mark.parametrize("name,read,default,low,high", SETTINGS)
@pytest.mark.parametrize("raw", ["0", "-5", "1440", "10.5", "on", "10m"])
def test_anything_else_is_the_default_and_a_warning(name, read, default, low, high, raw, caplog):
    with caplog.at_level(logging.WARNING, logger="homunculus.auth.session_policy"):
        assert read({name: raw}) == default
    [record] = caplog.records
    assert record.getMessage().startswith(name)
    assert f"{low} to {high}" in record.getMessage()


@pytest.mark.parametrize("name,read,default,low,high", SETTINGS)
def test_one_past_either_end_is_refused(name, read, default, low, high, caplog):
    with caplog.at_level(logging.WARNING, logger="homunculus.auth.session_policy"):
        assert read({name: str(low - 1)}) == default
        assert read({name: str(high + 1)}) == default
    assert len(caplog.records) == 2
```

**In** `homunculus-engine/tests/test_auth_password_change.py` **replace:**

```python
    build_context, hash_password, issue_tokens, password_change_due,
)
from homunculus.db import get_db
```
**with:**
```python
    build_context, hash_password, issue_tokens, password_change_due,
)
from homunculus.auth.session_policy import SCREEN_LOCK_IDLE_MINUTES, SCREEN_LOCK_SIGNOUT_HOURS
from homunculus.db import get_db
```

**Append to** `homunculus-engine/tests/test_auth_password_change.py`:

```python


@pytest.mark.asyncio
@requires_db
async def test_the_profile_carries_the_lock_time_and_the_hospital_name(client, world, db_session):
    c = client
    admin = await _admin_headers(db_session, world["admin"])
    me = (await c.get("/auth/me", headers=admin)).json()
    assert me["lock_idle_minutes"] == SCREEN_LOCK_IDLE_MINUTES
    assert me["lock_signout_hours"] == SCREEN_LOCK_SIGNOUT_HOURS
    assert (me["tenant"], me["tenant_name"]) == ("demo-hastanesi", "Sentetik Hastane")
    assert me["must_change_password"] is False
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest tests/test_session_policy.py tests/test_auth_password_change.py -q 2>&1 | tail -3
```
Expected: collection errors — `ModuleNotFoundError: No module named 'homunculus.auth.session_policy'`.

- [ ] **Step 3: The setting.** **Create** `homunculus-engine/src/homunculus/auth/session_policy.py`:

```python
"""What the hospital decides about an open session on a shared ward workstation.

    SCREEN_LOCK_IDLE_MINUTES   minutes without a key press, click or touch after which the
                               dashboard locks its screen (patient data off the screen, the
                               session kept, the password to come back). Default 10; 1-60.
    SCREEN_LOCK_SIGNOUT_HOURS  hours a browser may stay locked; past them it signs itself out
                               (a ward PC locked overnight does not keep yesterday's session
                               behind its lock). Default 12; 1-72.

A personal session always locks: there is no "never". A wall or central display that must stay
on is Group 2's kiosk mode, which has no personal session to lock.

Read once, at import, like the token lifetimes in auth/jwt.py: changing one is a restart of the
API, and the dashboard learns both from /auth/me at every sign-in and page load. A value the API
cannot use is logged as a WARNING and the default applies: a typo in .env must not leave a ward
PC that never locks, nor stop the API.
"""
from __future__ import annotations

import logging
import os
from collections.abc import Mapping

logger = logging.getLogger(__name__)

SCREEN_LOCK_DEFAULT_MINUTES = 10
SCREEN_LOCK_MIN_MINUTES = 1
SCREEN_LOCK_MAX_MINUTES = 60

SCREEN_LOCK_SIGNOUT_DEFAULT_HOURS = 12
SCREEN_LOCK_SIGNOUT_MIN_HOURS = 1
SCREEN_LOCK_SIGNOUT_MAX_HOURS = 72


def _whole_number(env: Mapping[str, str] | None, name: str, default: int, low: int,
                  high: int) -> int:
    """`name` from `env` (default: the process environment) as a whole number from `low` to
    `high`; unset or blank is `default`, anything else is `default` and a warning."""
    raw = (os.environ if env is None else env).get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        value = None
    if value is None or not low <= value <= high:
        logger.warning("%s must be a whole number from %d to %d; using %d",
                       name, low, high, default)
        return default
    return value


def screen_lock_minutes(env: Mapping[str, str] | None = None) -> int:
    """SCREEN_LOCK_IDLE_MINUTES from `env` (default: the process environment)."""
    return _whole_number(env, "SCREEN_LOCK_IDLE_MINUTES", SCREEN_LOCK_DEFAULT_MINUTES,
                         SCREEN_LOCK_MIN_MINUTES, SCREEN_LOCK_MAX_MINUTES)


def lock_signout_hours(env: Mapping[str, str] | None = None) -> int:
    """SCREEN_LOCK_SIGNOUT_HOURS from `env` (default: the process environment)."""
    return _whole_number(env, "SCREEN_LOCK_SIGNOUT_HOURS", SCREEN_LOCK_SIGNOUT_DEFAULT_HOURS,
                         SCREEN_LOCK_SIGNOUT_MIN_HOURS, SCREEN_LOCK_SIGNOUT_MAX_HOURS)


SCREEN_LOCK_IDLE_MINUTES = screen_lock_minutes()
SCREEN_LOCK_SIGNOUT_HOURS = lock_signout_hours()
```

- [ ] **Step 4: `/auth/me`.** **In** `homunculus-engine/src/homunculus/auth/schemas.py` **replace:**

```python
    tenant: str | None
    groups: list[GroupBrief]
```
**with:**
```python
    tenant: str | None
    tenant_name: str | None = None   # the hospital's name, for the dashboard's top bar
    groups: list[GroupBrief]
```

**In** `homunculus-engine/src/homunculus/auth/schemas.py` **replace:**

```python
    must_change_password: bool = False   # as TokenResponse.password_change_required
```
**with:**
```python
    must_change_password: bool = False   # as TokenResponse.password_change_required
    # Minutes without input after which the dashboard locks its screen, and hours a browser may
    # stay locked before it signs itself out (auth/session_policy.py).
    lock_idle_minutes: int
    lock_signout_hours: int
```

**In** `homunculus-engine/src/homunculus/auth/router.py` **replace:**

```python
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession
```
**with:**
```python
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
```

**In** `homunculus-engine/src/homunculus/auth/router.py` **replace:**

```python
from homunculus.auth.totp import accepted_step
from homunculus.db import get_db
```
**with:**
```python
from homunculus.auth.session_policy import SCREEN_LOCK_IDLE_MINUTES, SCREEN_LOCK_SIGNOUT_HOURS
from homunculus.auth.totp import accepted_step
from homunculus.db import get_db
from homunculus.tenant.models import Tenant
```

**In** `homunculus-engine/src/homunculus/auth/router.py` **replace:**

```python
    ctx = await build_context(db, current_user)
    return UserMeResponse(
        id=current_user.id, username=current_user.username, email=current_user.email,
        full_name=current_user.full_name, auth_source=current_user.auth_source,
        totp_enabled=current_user.totp_enabled, is_active=current_user.is_active,
        created_at=current_user.created_at, tenant=ctx.tenant,
        groups=[GroupBrief(slug=s, name=n) for s, n in zip(ctx.groups, ctx.group_names)],
        perms=sorted(ctx.perms), must_change_password=password_change_due(current_user),
    )
```
**with:**
```python
    ctx = await build_context(db, current_user)
    tenant_name = (await db.scalar(select(Tenant.name).where(Tenant.id == ctx.tenant_id))
                   if ctx.tenant_id is not None else None)
    return UserMeResponse(
        id=current_user.id, username=current_user.username, email=current_user.email,
        full_name=current_user.full_name, auth_source=current_user.auth_source,
        totp_enabled=current_user.totp_enabled, is_active=current_user.is_active,
        created_at=current_user.created_at, tenant=ctx.tenant, tenant_name=tenant_name,
        groups=[GroupBrief(slug=s, name=n) for s, n in zip(ctx.groups, ctx.group_names)],
        perms=sorted(ctx.perms), must_change_password=password_change_due(current_user),
        lock_idle_minutes=SCREEN_LOCK_IDLE_MINUTES, lock_signout_hours=SCREEN_LOCK_SIGNOUT_HOURS,
    )
```

- [ ] **Step 5: Run them to see them pass**

```bash
PYTHONPATH=src "$PY" -m pytest tests/test_session_policy.py tests/test_auth_password_change.py tests/test_auth_login.py -q 2>&1 | tail -1
```
Expected: all passed, none skipped (`19` + `11` of them this plan's).

- [ ] **Step 6: The deployment knows the setting.** **In** `deploy/local/docker-compose.yml` **replace:**

```yaml
      LDAP_TIMEOUT_S: ${LDAP_TIMEOUT_S:-}
```
**with:**
```yaml
      LDAP_TIMEOUT_S: ${LDAP_TIMEOUT_S:-}
      # Minutes without input after which the dashboard locks its screen (1-60; unset = 10). The
      # dashboard reads it from /auth/me; a value the API cannot use is logged and 10 applies.
      SCREEN_LOCK_IDLE_MINUTES: ${SCREEN_LOCK_IDLE_MINUTES:-}
      # Hours a browser may stay locked before it signs itself out (1-72; unset = 12).
      SCREEN_LOCK_SIGNOUT_HOURS: ${SCREEN_LOCK_SIGNOUT_HOURS:-}
```

**Append to** `deploy/local/.env.example`:

```ini

# ---------------------------------------------------------------------------------------
# Screen lock on the ward PCs (optional). After this many minutes without a key press, click or
# touch, the dashboard hides every patient and asks for the user's password again (a minute's
# warning first). 1-60; unset = 10. A value the API cannot use is logged and 10 applies.
# There is no "never": a personal session always locks (a wall display is Group 2's kiosk mode).
#SCREEN_LOCK_IDLE_MINUTES=10
# A browser that stays locked this many hours signs itself out (1-72; unset = 12).
#SCREEN_LOCK_SIGNOUT_HOURS=12
```

```bash
cd /c/tmp/homunculus-g1/deploy/local
POSTGRES_PASSWORD=x JWT_SECRET=x PHI_ENCRYPTION_KEY=x TENANT_TOKEN=x docker compose --env-file .env.example -f docker-compose.yml config 2>&1 | grep -E "SCREEN_LOCK|rror"
```
Expected: `      SCREEN_LOCK_IDLE_MINUTES: ""` and `      SCREEN_LOCK_SIGNOUT_HOURS: ""`, and no error (the four placeholders only satisfy compose's required-variable checks).

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/homunculus-g1
git add homunculus-engine/src/homunculus/auth/session_policy.py homunculus-engine/src/homunculus/auth/schemas.py homunculus-engine/src/homunculus/auth/router.py homunculus-engine/tests/test_session_policy.py homunculus-engine/tests/test_auth_password_change.py deploy/local/docker-compose.yml deploy/local/.env.example
git commit -m "feat(auth): /auth/me says the hospital's name and its screen-lock times

SCREEN_LOCK_IDLE_MINUTES (default 10, 1-60) for the dashboard's idle lock,
SCREEN_LOCK_SIGNOUT_HOURS (default 12, 1-72) for how long a browser may
stay locked before it signs itself out. A value the API cannot use is
logged and the default applies; both are read once at start.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `POST /auth/reauth` — the lock screen's unlock

**Files:**
- Modify: `homunculus-engine/src/homunculus/auth/limits.py:259`, `auth/schemas.py` (end), `auth/router.py` (docstring, imports, constants, `/auth/password`, end)
- Modify: `dashboard/src/clinicalI18n.js` (one more message)
- Test: `homunculus-engine/tests/test_auth_reauth.py`; `homunculus-engine/tests/test_auth_limits.py` (one test: a `FailureChain` refuses another chain's ticket)

- [ ] **Step 1: Write the failing test.** **Create** `homunculus-engine/tests/test_auth_reauth.py`:

```python
# homunculus-engine/tests/test_auth_reauth.py
"""POST /auth/reauth — unlocking the dashboard's locked screen with the session's own password
(plan G1 Wave 2, decision 4). A wrong password is 403, never 401 (a 401 makes the dashboard
refresh and retry, which would send the password to the directory twice). A local account is
checked with bcrypt and locked for 15 minutes after 5 wrong ones; an AD account's unlock is one
bind, counted in the SAME chain as its sign-ins — a locked screen adds no capacity to lock the
account out of the hospital domain — and driven exactly as a sign-in drives it, so the seeded
model of tests/test_directory_bind_invariant.py, which drives the chain as a sign-in does,
covers the unlocks too (test_an_unlock_drives_the_chain_and_the_audit_as_a_sign_in_does). A
wrong current password at /auth/password counts with the local unlocks. Synthetic accounts
only."""
from __future__ import annotations

import asyncio
import time

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.api.app import create_app
from homunculus.auth.groups import ensure_default_groups, set_manual_groups
from homunculus.auth.ldap import DIRECTORY_DOWN
from homunculus.auth.limits import (
    DIRECTORY_BIND_MAX_FAILURES, REAUTH_MAX_FAILURES, Ticket, directory_binds,
)
from homunculus.auth.models import TenantMembership, User
from homunculus.auth.router import _DIRECTORY_THROTTLED, _REAUTH_REFUSED
from homunculus.auth.service import build_context, hash_password, issue_tokens
from homunculus.db import get_db
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db
from tests.fake_directory import (
    AD_PASSWORD, ad_client, ad_world, audit_events, fresh_user,
)

pytestmark = [pytest.mark.asyncio, requires_db]

PASSWORD = "Gizli-123"
CHOSEN = "Kendi-Parolam-9"
REFUSED = _REAUTH_REFUSED
THROTTLED = _DIRECTORY_THROTTLED


async def _headers(db, user, *, mfa_verified=True) -> dict:
    tokens = issue_tokens(user, await build_context(db, user), mfa_verified=mfa_verified)
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def _reasons(app) -> list[str]:
    return [r.payload["reason"] for r in audit_events(app, "auth", "reauth.fail")]


# ---------------------------------------------------------------- a local account
@pytest_asyncio.fixture
async def local(db_session):
    tenant = Tenant(name="Sentetik", slug="demo-hastanesi", country_code="TR")
    db_session.add(tenant)
    await db_session.flush()
    groups = await ensure_default_groups(db_session, tenant.id)

    async def make(username, slug, **kw):
        user = User(username=username, email=f"{username}@example.com", full_name="Sentetik",
                    hashed_password=hash_password(PASSWORD), **kw)
        db_session.add(user)
        await db_session.flush()
        db_session.add(TenantMembership(user_id=user.id, tenant_id=tenant.id))
        await db_session.flush()
        await set_manual_groups(db_session, user=user, tenant_id=tenant.id,
                                group_ids=[groups[slug].id], granted_by_id=None)
        return user

    nurse = await make("ayse", "nurse")
    attending = await make("dr.kaya", "attending")
    fresh = await make("yeni", "nurse", must_change_password=True)
    await db_session.commit()
    app = create_app({"bridge-token": "demo-hastanesi"}, run_escalation_loop=False)
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield {"c": c, "app": app, "nurse": nurse, "attending": attending, "fresh": fresh}


async def test_the_right_password_unlocks_and_nothing_else_changes(local, db_session):
    c, nurse = local["c"], local["nurse"]
    before = await fresh_user(db_session, nurse.id)
    res = await c.post("/auth/reauth", headers=await _headers(db_session, nurse),
                       json={"password": PASSWORD})
    assert (res.status_code, res.json()) == (200, {"ok": True})
    after = await fresh_user(db_session, nurse.id)
    assert (after.token_version, after.last_login_at) == (before.token_version,
                                                          before.last_login_at)
    [ok] = audit_events(local["app"], "auth", "reauth.ok")
    assert ok.payload == {"user": "ayse"}


async def test_a_wrong_password_is_403_never_401(local, db_session):
    c, nurse = local["c"], local["nurse"]
    res = await c.post("/auth/reauth", headers=await _headers(db_session, nurse),
                       json={"password": "yanlis"})
    assert (res.status_code, res.json()["detail"]) == (403, REFUSED)
    assert _reasons(local["app"]) == ["bad_credentials"]
    assert "yanlis" not in str([r.payload for r in local["app"].state.audit.records(limit=100)])


async def test_five_wrong_passwords_lock_the_unlock_and_a_right_one_then_waits(local, db_session):
    c, nurse = local["c"], local["nurse"]
    headers = await _headers(db_session, nurse)
    for _ in range(REAUTH_MAX_FAILURES):
        assert (await c.post("/auth/reauth", headers=headers,
                             json={"password": "yanlis"})).status_code == 403
    for _ in range(2):
        res = await c.post("/auth/reauth", headers=headers, json={"password": PASSWORD})
        assert (res.status_code, res.json()["detail"]) == (429, THROTTLED)
    # One row marks the lock engaging; the unlocks it refuses write none.
    assert len(audit_events(local["app"], "auth", "reauth.locked")) == 1
    assert _reasons(local["app"]) == ["bad_credentials"] * REAUTH_MAX_FAILURES


async def test_a_right_password_clears_the_count(local, db_session):
    c, nurse = local["c"], local["nurse"]
    headers = await _headers(db_session, nurse)
    for _ in range(REAUTH_MAX_FAILURES - 1):
        await c.post("/auth/reauth", headers=headers, json={"password": "yanlis"})
    assert (await c.post("/auth/reauth", headers=headers,
                         json={"password": PASSWORD})).status_code == 200
    for _ in range(REAUTH_MAX_FAILURES - 1):
        assert (await c.post("/auth/reauth", headers=headers,
                             json={"password": "yanlis"})).status_code == 403


async def test_wrong_current_passwords_count_with_the_unlocks(local, db_session):
    """/auth/password is the other place a held token can test the password: its wrong current
    passwords count in the same limit. 3 wrong unlocks + 2 wrong current passwords lock both,
    and both then answer 429 before any check."""
    c, nurse = local["c"], local["nurse"]
    headers = await _headers(db_session, nurse)
    for _ in range(3):
        assert (await c.post("/auth/reauth", headers=headers,
                             json={"password": "yanlis"})).status_code == 403
    for _ in range(REAUTH_MAX_FAILURES - 3):
        res = await c.post("/auth/password", headers=headers,
                           json={"current_password": "yanlis", "new_password": CHOSEN})
        assert (res.status_code, res.json()["detail"]) == (400, "Mevcut parola yanlış")
    res = await c.post("/auth/password", headers=headers,
                       json={"current_password": PASSWORD, "new_password": CHOSEN})
    assert (res.status_code, res.json()["detail"]) == (429, THROTTLED)
    res = await c.post("/auth/reauth", headers=headers, json={"password": PASSWORD})
    assert (res.status_code, res.json()["detail"]) == (429, THROTTLED)
    assert len(audit_events(local["app"], "auth", "password.change.locked")) == 1
    assert audit_events(local["app"], "auth", "reauth.locked") == []


async def test_a_rule_the_new_password_breaks_is_not_a_wrong_password(local, db_session):
    c, nurse = local["c"], local["nurse"]
    headers = await _headers(db_session, nurse)
    for _ in range(REAUTH_MAX_FAILURES + 1):
        res = await c.post("/auth/password", headers=headers,
                           json={"current_password": "yanlis", "new_password": "kisa"})
        assert res.status_code == 400                    # too short: the current one is not read
    assert (await c.post("/auth/reauth", headers=headers,
                         json={"password": PASSWORD})).status_code == 200


async def test_a_changed_password_clears_the_count(local, db_session):
    c, nurse = local["c"], local["nurse"]
    headers = await _headers(db_session, nurse)
    for _ in range(REAUTH_MAX_FAILURES - 1):
        await c.post("/auth/reauth", headers=headers, json={"password": "yanlis"})
    res = await c.post("/auth/password", headers=headers,
                       json={"current_password": PASSWORD, "new_password": CHOSEN})
    assert res.status_code == 200
    fresh = {"Authorization": f"Bearer {res.json()['access_token']}"}
    for _ in range(REAUTH_MAX_FAILURES - 1):
        assert (await c.post("/auth/reauth", headers=fresh,
                             json={"password": "yanlis"})).status_code == 403


async def test_an_empty_password_never_reaches_a_check(local, db_session):
    res = await local["c"].post("/auth/reauth", headers=await _headers(db_session, local["nurse"]),
                                json={"password": ""})
    assert res.status_code == 422
    assert _reasons(local["app"]) == []


async def test_it_takes_a_whole_session(local, db_session):
    c = local["c"]
    assert (await c.post("/auth/reauth", json={"password": PASSWORD})).status_code == 401
    pending = await _headers(db_session, local["attending"], mfa_verified=False)
    res = await c.post("/auth/reauth", headers=pending, json={"password": PASSWORD})
    assert (res.status_code, res.json()["detail"]) == (403, "mfa_required")
    res = await c.post("/auth/reauth", headers=await _headers(db_session, local["fresh"]),
                       json={"password": PASSWORD})
    assert (res.status_code, res.json()["detail"]) == (403, "password_change_required")


# ---------------------------------------------------------------- an AD account
@pytest_asyncio.fixture
async def ad(db_session):
    world = await ad_world(db_session)
    async with ad_client(db_session, world["directory"]) as (c, app):
        yield {**world, "c": c, "app": app}


async def _signed_in(ad) -> dict:
    tokens = (await ad["c"].post("/auth/login", json={"login": "ayilmaz",
                                                      "password": AD_PASSWORD})).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def _binds(directory) -> int:
    return sum(1 for method, _ in directory.calls if method == "authenticate")


def _record_ends(monkeypatch) -> list[tuple[bool, float]]:
    """Every `directory_binds.end` the route makes, as (failed, pending_s)."""
    ends: list[tuple[bool, float]] = []
    end = directory_binds.end

    def recording(key, ticket, *, failed, pending_s=0.0):
        ends.append((failed, pending_s))
        end(key, ticket, failed=failed, pending_s=pending_s)

    monkeypatch.setattr(directory_binds, "end", recording)
    return ends


async def test_an_ad_account_unlocks_with_one_bind(ad):
    headers = await _signed_in(ad)
    before = _binds(ad["directory"])
    res = await ad["c"].post("/auth/reauth", headers=headers, json={"password": AD_PASSWORD})
    assert res.status_code == 200
    assert _binds(ad["directory"]) == before + 1


async def test_unlocks_and_sign_ins_share_one_chain_of_failed_binds(ad):
    """2 wrong unlocks + 1 wrong sign-in = the chain's 3: the next sign-in AND the next unlock
    are refused without asking the directory."""
    headers = await _signed_in(ad)
    c, directory = ad["c"], ad["directory"]
    for _ in range(2):
        res = await c.post("/auth/reauth", headers=headers, json={"password": "yanlis"})
        assert (res.status_code, res.json()["detail"]) == (403, REFUSED)
    assert (await c.post("/auth/login", json={"login": "ayilmaz",
                                              "password": "yanlis"})).status_code == 401
    binds = _binds(directory)
    res = await c.post("/auth/reauth", headers=headers, json={"password": AD_PASSWORD})
    assert (res.status_code, res.json()["detail"]) == (429, THROTTLED)
    assert (await c.post("/auth/login", json={"login": "ayilmaz",
                                              "password": AD_PASSWORD})).status_code == 429
    assert _binds(directory) == binds                    # neither reached the directory
    assert _reasons(ad["app"]) == ["bad_credentials", "bad_credentials", "throttled"]


async def test_a_directory_that_does_not_answer_is_503_and_counts_no_failure(ad):
    headers = await _signed_in(ad)
    ad["directory"].unavailable = True
    for _ in range(4):                                   # more than the chain allows
        res = await ad["c"].post("/auth/reauth", headers=headers, json={"password": AD_PASSWORD})
        assert res.status_code == 503
    ad["directory"].unavailable = False
    res = await ad["c"].post("/auth/reauth", headers=headers, json={"password": AD_PASSWORD})
    assert res.status_code == 200


async def test_a_bind_cut_off_under_way_counts_in_the_chain(ad, monkeypatch):
    """The deadline cut the unlock's bind off once the password had been sent: the domain
    controller may still count it, so the chain does — dated a deadline later, as a sign-in's
    (test_auth_ldap_login). Three such unlocks fill the chain: the fourth is not tried."""
    headers = await _signed_in(ad)
    ends = _record_ends(monkeypatch)
    directory = ad["directory"]
    directory.unavailable, directory.outage_after_bind = "timeout", True
    for _ in range(DIRECTORY_BIND_MAX_FAILURES):
        res = await ad["c"].post("/auth/reauth", headers=headers, json={"password": AD_PASSWORD})
        assert res.status_code == 503
    assert ends == [(True, directory.deadline)] * DIRECTORY_BIND_MAX_FAILURES
    directory.unavailable = False
    binds = _binds(directory)
    res = await ad["c"].post("/auth/reauth", headers=headers, json={"password": AD_PASSWORD})
    assert (res.status_code, res.json()["detail"]) == (429, THROTTLED)
    assert _binds(directory) == binds


@pytest.mark.parametrize("bind_attempted, counted", [(True, True), (None, True), (False, False)])
async def test_a_cancelled_unlock_whose_password_was_sent_counts_and_is_audited(
        ad, monkeypatch, bind_attempted, counted):
    """An unlock cut off (the request cancelled) once the password had reached the directory —
    or without the directory saying (counted, fail closed) — is a failed bind AD may count: the
    chain counts it, dated as late as the longest deadline when nothing says otherwise, and the
    audit trail has its row (`cancelled`), written with nothing awaited. One cut off before the
    bind counts for nothing and has no row."""
    headers = await _signed_in(ad)
    ends = _record_ends(monkeypatch)
    entered = asyncio.Event()

    async def hang(external_id, password):
        entered.set()
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError as exc:
            if bind_attempted is not None:
                exc.bind_attempted = bind_attempted
            raise

    ad["directory"].authenticate = hang
    task = asyncio.create_task(ad["c"].post("/auth/reauth", headers=headers,
                                            json={"password": "yanlis"}))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert [failed for failed, _ in ends] == [counted]
    assert _reasons(ad["app"]) == (["cancelled"] if counted else [])
    assert "yanlis" not in str([r.payload for r in ad["app"].state.audit.records(limit=100)])


async def test_a_directory_fault_that_may_have_sent_the_password_counts_and_is_audited(
        ad, monkeypatch):
    headers = await _signed_in(ad)
    ends = _record_ends(monkeypatch)

    async def broken(external_id, password):
        raise RuntimeError("library bug")

    ad["directory"].authenticate = broken
    with pytest.raises(RuntimeError):
        await ad["c"].post("/auth/reauth", headers=headers, json={"password": AD_PASSWORD})
    assert [failed for failed, _ in ends] == [True]
    assert _reasons(ad["app"]) == ["directory_error"]


async def test_an_account_past_its_ad_end_date_ends_the_session_and_ends_no_run(ad):
    """The directory returns an expired account WITHOUT a bind (`bound` False): 401, and the
    run of failed binds goes on — no bind reset AD's count, whatever the clock here says."""
    headers = await _signed_in(ad)
    key = str(ad["account"].id)
    for _ in range(2):                                   # two wrong passwords, earlier
        ticket = directory_binds.begin(key)
        directory_binds.end(key, ticket, failed=True)
    ad["directory"].update(ad["ayse"].identity.external_id,
                           account_expires=int((time.time() - 60 + 11_644_473_600) * 10_000_000))
    res = await ad["c"].post("/auth/reauth", headers=headers, json={"password": AD_PASSWORD})
    assert res.status_code == 401
    assert _reasons(ad["app"]) == ["directory_expired"]
    assert len(directory_binds._chains[key].failures) == 2


def _record_chain(monkeypatch) -> list[tuple]:
    """Every call made on `directory_binds` — begin (and whether it gave a place), end,
    succeeded — with its key and keywords; a ticket is shown as "ticket" (its numbers differ)."""
    calls: list[tuple] = []
    for name in ("begin", "end", "succeeded"):
        real = getattr(directory_binds, name)

        def recording(*args, _real=real, _name=name, **kw):
            result = _real(*args, **kw)
            shown = tuple("ticket" if isinstance(a, Ticket) else a for a in args)
            calls.append((_name, shown, tuple(sorted(kw.items())),
                          "ticket" if isinstance(result, Ticket) else result))
            return result

        monkeypatch.setattr(directory_binds, name, recording)
    return calls


def _outcome(ad, what: str) -> str:
    """Make the directory answer the next bind as `what`; the password to send."""
    directory, external_id = ad["directory"], ad["ayse"].identity.external_id
    if what == "cut":
        directory.unavailable, directory.outage_after_bind = "timeout", True
    elif what == "not_sent":
        directory.unavailable, directory.outage_after_bind = "unreachable", False
    elif what == "answered_oddly":
        directory.unavailable, directory.outage_after_bind = "protocol", True
    elif what == "disabled":
        directory.update(external_id, disabled=True)
    elif what == "expired":
        directory.update(external_id,
                         account_expires=int((time.time() - 60 + 11_644_473_600) * 10_000_000))
    elif what == "fault":
        async def broken(external_id, password):
            raise RuntimeError("library bug")
        directory.authenticate = broken
    return "yanlis" if what == "wrong" else AD_PASSWORD


@pytest.mark.parametrize("what", ["wrong", "right", "cut", "not_sent", "answered_oddly",
                                  "disabled", "expired", "fault"])
async def test_an_unlock_drives_the_chain_and_the_audit_as_a_sign_in_does(ad, monkeypatch, what):
    """The same directory answer, once to a sign-in and once to an unlock: the same calls on
    `directory_binds` (so tests/test_directory_bind_invariant.py's model, which drives the
    chain as a sign-in does, covers the unlocks) and the same failure reason in the audit trail
    (`login.fail` for the one, `reauth.fail` for the other)."""
    headers = await _signed_in(ad)
    password = _outcome(ad, what)
    calls = _record_chain(monkeypatch)

    async def ask(path, **kw):
        try:
            return (await ad["c"].post(path, **kw)).status_code
        except RuntimeError:
            return "fault"

    signed = await ask("/auth/login", json={"login": "ayilmaz", "password": password})
    by_sign_in = calls[:]
    calls.clear()
    unlocked = await ask("/auth/reauth", headers=headers, json={"password": password})
    assert calls == by_sign_in
    assert [r.payload["reason"] for r in audit_events(ad["app"], "auth", "reauth.fail")] == \
        [r.payload["reason"] for r in audit_events(ad["app"], "auth", "login.fail")]
    # What differs is the answer: a wrong password at a lock is 403, never 401.
    expected = {"wrong": (401, 403), "right": (200, 200), "cut": (503, 503),
                "not_sent": (503, 503), "answered_oddly": (503, 503), "disabled": (401, 401),
                "expired": (401, 401), "fault": ("fault", "fault")}[what]
    assert (signed, unlocked) == expected


async def test_an_account_disabled_in_ad_ends_the_session(ad):
    headers = await _signed_in(ad)
    ad["directory"].update(ad["ayse"].identity.external_id, disabled=True)
    res = await ad["c"].post("/auth/reauth", headers=headers, json={"password": AD_PASSWORD})
    assert res.status_code == 401
    assert _reasons(ad["app"]) == ["directory_disabled"]


async def test_without_a_directory_an_ad_account_cannot_unlock(db_session):
    world = await ad_world(db_session)
    app = create_app({"bridge-token": "demo-hastanesi"}, run_escalation_loop=False)
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    account = (await db_session.execute(select(User).where(User.id == world["account"].id))
               ).scalar_one()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        res = await c.post("/auth/reauth", headers=await _headers(db_session, account),
                           json={"password": AD_PASSWORD})
    assert (res.status_code, res.json()["detail"]) == (503, DIRECTORY_DOWN)
```

The unlock is a second route on `directory_binds`; while here, close a gap the review of F8 found in its ownership check. `FailureChain._own` compares only a ticket's key, and `end` its attempt number — numbers every chain counts from 1 — so chain B takes chain A's ticket for its own attempt of the same number and frees that place. Production has one `directory_binds`; the docstring and F8's commit claim more. **Append to** `homunculus-engine/tests/test_auth_limits.py`:

```python


def test_a_ticket_of_another_chain_is_refused_and_changes_nothing():
    """Attempt numbers are counted per chain: two chains both hand out attempt 1. A ticket is
    its own chain's — another chain's is refused (ValueError), never taken for the place of the
    same number there, which `end` would free (plan G1 Wave 2, Task 5)."""
    a, b = (FailureChain(max_failures=DIRECTORY_BIND_MAX_FAILURES,
                         quiet_seconds=DIRECTORY_BIND_WINDOW_S) for _ in range(2))
    a_ticket, b_ticket = a.begin("u"), b.begin("u")
    assert a_ticket.attempt == b_ticket.attempt
    with pytest.raises(ValueError, match="another FailureChain"):
        b.end("u", a_ticket, failed=False)
    with pytest.raises(ValueError, match="another FailureChain"):
        b.succeeded("u", a_ticket)
    assert b._chains["u"].in_flight == {b_ticket.attempt}       # b's place is still held
    assert b._chains["u"].failures == [] and b._recorded == 0
    b.end("u", b_ticket, failed=True)                           # and only its own ticket ends it
    assert len(b._chains["u"].failures) == 1
    a.end("u", a_ticket, failed=False)                          # a's ticket still ends a's place
    assert "u" not in a._chains
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest tests/test_auth_reauth.py -q 2>&1 | tail -3
PYTHONPATH=src "$PY" -m pytest tests/test_auth_limits.py -q -k another_chain 2>&1 | tail -1
```
Expected: collection error — `ImportError: cannot import name 'REAUTH_MAX_FAILURES' from 'homunculus.auth.limits'`; then `1 failed, 39 deselected` — `DID NOT RAISE` (B's `end` took A's ticket and freed B's place).

- [ ] **Step 3: The limits.** A ticket carries the chain that handed it out, and only that chain takes it:

**In** `homunculus-engine/src/homunculus/auth/limits.py` **replace:**

```python
    from those that may have come after. A ticket is good for its own key only — `end` and
    `succeeded` refuse another key's (ValueError)."""
    key: str
    attempt: int
    seq: int
    at: float
```
**with:**
```python
    from those that may have come after. A ticket is good for its own key and its own
    FailureChain only — `end` and `succeeded` refuse another key's and another chain's
    (ValueError): attempt numbers are counted per chain, so another chain's ticket could
    otherwise name a place here and free it."""
    key: str
    attempt: int
    seq: int
    at: float
    # The FailureChain that handed it out (its `_owner`); left out of repr and comparison.
    owner: object = field(default=None, repr=False, compare=False)
```

**In** `homunculus-engine/src/homunculus/auth/limits.py` **replace:**

```python
    Misuse is refused, never absorbed: a ticket used for another key, an `end` for a place
    that is not held (ended already, or never handed out by this chain) and a `succeeded`
    before its attempt's `end` raise ValueError and change nothing. A silent `end` would free
    another attempt's place and let one more bind through than the chain allows.
```
**with:**
```python
    Misuse is refused, never absorbed: a ticket used for another key or handed out by another
    FailureChain, an `end` for a place that is not held (ended already, or never handed out)
    and a `succeeded` before its attempt's `end` raise ValueError and change nothing. A silent
    `end` would free another attempt's place and let one more bind through than the chain
    allows.
```

**In** `homunculus-engine/src/homunculus/auth/limits.py` **replace:**

```python
        self._attempts = 0                   # places handed out so far, every key: .attempt
```
**with:**
```python
        self._attempts = 0                   # places handed out so far, every key: .attempt
        self._owner = object()               # stamped on every Ticket this chain hands out
```

**In** `homunculus-engine/src/homunculus/auth/limits.py` **replace:**

```python
    @staticmethod
    def _own(key: str, ticket: Ticket) -> None:
        if ticket.key != key:
            raise ValueError("this ticket was handed out for another key")
```
**with:**
```python
    def _own(self, key: str, ticket: Ticket) -> None:
        if ticket.owner is not self._owner:
            raise ValueError("this ticket was handed out by another FailureChain")
        if ticket.key != key:
            raise ValueError("this ticket was handed out for another key")
```

**In** `homunculus-engine/src/homunculus/auth/limits.py` **replace:**

```python
        return Ticket(key=key, attempt=self._attempts, seq=self._recorded, at=self._clock())
```
**with:**
```python
        return Ticket(key=key, attempt=self._attempts, seq=self._recorded, at=self._clock(),
                      owner=self._owner)
```

Then the local limit. **In** `homunculus-engine/src/homunculus/auth/limits.py` **replace:**

```python
totp_failures = FailureLimiter(max_failures=5, lock_seconds=300)
```
**with:**
```python
totp_failures = FailureLimiter(max_failures=5, lock_seconds=300)

# Wrong passwords at a locked screen (POST /auth/reauth) and wrong current passwords at
# POST /auth/password, for a LOCAL account, keyed by user id: the two places a held token can
# test the account's password, counted together. An AD account's unlock is a bind and counts
# in `directory_binds` below, with its sign-ins. The dashboard itself signs out after 3 wrong
# unlocks; this bounds a caller holding the token.
REAUTH_MAX_FAILURES = 5
reauth_failures = FailureLimiter(max_failures=REAUTH_MAX_FAILURES, lock_seconds=15 * 60)
```

- [ ] **Step 4: The request.** **In** `homunculus-engine/src/homunculus/auth/schemas.py` **replace:**

```python
class PasswordChangeRequest(BaseModel):
    current_password: str = Field(max_length=_PASSWORD_MAX)
    new_password: str = Field(max_length=_PASSWORD_MAX)
```
**with:**
```python
class PasswordChangeRequest(BaseModel):
    current_password: str = Field(max_length=_PASSWORD_MAX)
    new_password: str = Field(max_length=_PASSWORD_MAX)


class ReauthRequest(BaseModel):
    """Unlocking a locked screen: the session's own password once more. Empty is a 422 before
    any check (an empty LDAP simple bind is an anonymous bind, never a password check)."""
    password: str = Field(min_length=1, max_length=_PASSWORD_MAX)
```

- [ ] **Step 5: The route.** **In** `homunculus-engine/src/homunculus/auth/router.py` **replace:**

```python
GET  /auth/me           — profile, tenant, groups, permissions (allowed before MFA)
POST /auth/password     — change own password (local accounts)
```
**with:**
```python
GET  /auth/me           — profile, tenant, groups, permissions, the screen-lock time (allowed
                          before MFA and before a temporary password is replaced)
POST /auth/password     — change own password (local accounts); the one route a session whose
                          temporary password must be replaced reaches (after MFA)
POST /auth/reauth       — unlock a locked screen: the session's own password once more. Local:
                          bcrypt; AD: one bind, counted with the sign-ins in the same chain. A
                          wrong password is 403 (never 401: the dashboard refreshes and RETRIES
                          a 401, which would send the password to the directory twice)
```

**In** `homunculus-engine/src/homunculus/auth/router.py` **replace:**

```python
from homunculus.auth.limits import directory_binds, totp_failures
from homunculus.auth.models import AUTH_LDAP, User
from homunculus.auth.schemas import (
    GroupBrief, LoginRequest, PasswordChangeRequest, RefreshRequest, TOTPSetupResponse,
    TOTPVerifyRequest, TokenResponse, UserMeResponse,
)
```
**with:**
```python
from homunculus.auth.limits import directory_binds, reauth_failures, totp_failures
from homunculus.auth.models import AUTH_LDAP, User
from homunculus.auth.schemas import (
    GroupBrief, LoginRequest, PasswordChangeRequest, ReauthRequest, RefreshRequest,
    TOTPSetupResponse, TOTPVerifyRequest, TokenResponse, UserMeResponse,
)
```

**In** `homunculus-engine/src/homunculus/auth/router.py` **replace:**

```python
# The AD bind throttle's refusal; "15" is DIRECTORY_BIND_WINDOW_S (auth/limits.py).
_DIRECTORY_THROTTLED = "Çok fazla hatalı deneme; 15 dakika sonra tekrar deneyin"
```
**with:**
```python
# The AD bind throttle's refusal; "15" is DIRECTORY_BIND_WINDOW_S (auth/limits.py). The same
# words refuse a local account's unlock and its own password change once `reauth_failures` has
# locked them (also 15 minutes).
_DIRECTORY_THROTTLED = "Çok fazla hatalı deneme; 15 dakika sonra tekrar deneyin"
# A wrong password at a locked screen (POST /auth/reauth). 403, not 401: see the module docstring.
_REAUTH_REFUSED = "Parola hatalı"
```

The password change counts its wrong current passwords in the same limit — the other place a
held token can test the account's password. **In** `homunculus-engine/src/homunculus/auth/router.py` **replace:**

```python
    """The change retires every existing session (token version and credential fingerprint
    both move), so the caller receives a fresh pair and keeps working. It is also how a
    temporary password is replaced: the one route such a session reaches (after MFA)."""
    current_user = principal.user
    try:
        await change_password(db, current_user, body.current_password, body.new_password)
    except PasswordError as exc:
        append_audit(request, tenant=principal.tenant, event_type="auth",
                     subject="password.change.fail",
                     payload={"user": current_user.username, "reason": exc.reason})
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    append_audit(request, tenant=principal.tenant, event_type="auth", subject="password.change",
                 payload={"user": current_user.username})
```
**with:**
```python
    """The change retires every existing session (token version and credential fingerprint
    both move), so the caller receives a fresh pair and keeps working. It is also how a
    temporary password is replaced: the one route such a session reaches (after MFA).

    A wrong current password counts in `reauth_failures`, with the wrong passwords at a locked
    screen (/auth/reauth): these are the two places a held token can test the account's
    password, and 5 wrong in a row lock both for 15 minutes (429, before any check). One audit
    row marks the lock engaging; the requests it refuses meanwhile write none."""
    current_user = principal.user
    key = str(current_user.id)
    if reauth_failures.locked(key):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail=_DIRECTORY_THROTTLED)
    try:
        await change_password(db, current_user, body.current_password, body.new_password)
    except PasswordError as exc:
        append_audit(request, tenant=principal.tenant, event_type="auth",
                     subject="password.change.fail",
                     payload={"user": current_user.username, "reason": exc.reason})
        if exc.reason == "wrong_current" and reauth_failures.failed(key):
            append_audit(request, tenant=principal.tenant, event_type="auth",
                         subject="password.change.locked",
                         payload={"user": current_user.username,
                                  "lock_seconds": reauth_failures.lock_seconds})
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    reauth_failures.succeeded(key)
    append_audit(request, tenant=principal.tenant, event_type="auth", subject="password.change",
                 payload={"user": current_user.username})
```

**Append to** `homunculus-engine/src/homunculus/auth/router.py`:

```python


@router.post("/reauth", summary="Unlock a locked screen with the session's own password")
async def reauth(body: ReauthRequest, request: Request,
                 principal: Principal = Depends(get_principal),
                 db: AsyncSession = Depends(get_db)) -> dict:
    """The dashboard's lock screen: is the person at the workstation the one whose session this
    is? Nothing is issued — the session goes on as it was; MFA is not asked again (the session
    passed it at sign-in, and this is a presence check, not a sign-in).

    200 {"ok": true}: the password is right. 403 `_REAUTH_REFUSED`: it is wrong (counted). 429:
    too many wrong ones. 503: the directory does not answer. 401: the session itself is over
    (the token, or an AD account disabled or expired in AD) — the dashboard's refresh then ends
    it. Every answer but the 401 leaves the session untouched; signing out instead is always the
    dashboard's to do, with no password.

    A LOCAL account is checked with bcrypt; `reauth_failures` locks its unlock for 15 minutes
    after 5 wrong passwords in a row — counted with the wrong current passwords at
    /auth/password. One audit row marks the lock engaging; the unlocks it refuses meanwhile write
    none. An AD account's password is one bind, and that bind counts in `directory_binds` — the
    same chain as the account's sign-ins, so a locked screen adds no capacity to lock the
    account out of the hospital domain: 3 failed binds (3 more after an administrator's unlock)
    per chain, whatever mix of sign-ins and unlocks made them, and once the chain is full the
    directory is not asked (429). The flip side, as at sign-in: whoever knows the account's
    login can fill its chain with wrong passwords, and its locked screen then cannot be
    unlocked for at least 15 minutes (sign out, or wait). The database connection is released
    while the directory answers (plan decision D7 of Wave 1A)."""
    user = principal.user
    user_id, username, source = user.id, user.username, user.auth_source
    external_id, hashed = user.external_id, user.hashed_password

    def audit(subject: str, **payload) -> None:
        append_audit(request, tenant=principal.tenant, event_type="auth", subject=subject,
                     payload={"user": username, **payload})

    if source == AUTH_LDAP:
        await _directory_reauth(request, db, user_id, external_id, body.password, audit)
        audit("reauth.ok")
        return {"ok": True}

    key = str(user_id)
    if reauth_failures.locked(key):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail=_DIRECTORY_THROTTLED)
    if not await run_bcrypt(verify_local_password, source, hashed, body.password):
        audit("reauth.fail", reason="bad_credentials")
        if reauth_failures.failed(key):
            audit("reauth.locked", lock_seconds=reauth_failures.lock_seconds)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_REAUTH_REFUSED)
    reauth_failures.succeeded(key)
    audit("reauth.ok")
    return {"ok": True}


async def _directory_reauth(request: Request, db: AsyncSession, user_id: uuid.UUID,
                            external_id: str | None, password: str, audit) -> None:
    """An AD account's unlock: one bind as the account (found by objectGUID), under the same
    throttle as its sign-ins and counted exactly as `_directory_sign_in` counts its bind.
    Returns when the password is right; raises otherwise.

    Every failed bind the throttle counts is audited (`reauth.fail`) the moment it is counted,
    with nothing awaited in between — `audit` is a plain call, and the hospital is the
    session's —: a wrong password, an outage once the password was sent, and an unlock
    cancelled (`cancelled`) or failing on a fault (`directory_error`) once it may have been, as
    a sign-in's `login.fail`. The runbook reads these rows before a restart."""
    ldap = get_ldap(request)
    if ldap is None:
        audit("reauth.fail", reason="directory_unavailable")
        raise _directory_down()
    if not external_id:
        audit("reauth.fail", reason="directory_not_found")
        raise _bad_credentials()                 # 401: the refresh will not keep it either
    await db.rollback()                          # nothing written; frees the connection
    slot = str(user_id)
    ticket = directory_binds.begin(slot)
    if ticket is None:
        audit("reauth.fail", reason="throttled")
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail=_DIRECTORY_THROTTLED)
    # As at sign-in: nothing between `begin` and the try, and every path releases the place
    # (`end` with this attempt's ticket). An outage counts only when the password had reached
    # the directory (`bind_attempted`), dated as late as the domain controller may still count a
    # bind it has not answered (`bind_pending_s`); anything else fails closed, dated as late as
    # the longest deadline.
    try:
        identity = await ldap.directory.authenticate(external_id, password)
    except LdapUnavailable as exc:
        directory_binds.end(slot, ticket, failed=exc.bind_attempted,
                            pending_s=exc.bind_pending_s)
        audit("reauth.fail", reason="directory_unavailable")
        raise _directory_down() from None
    except BaseException as exc:             # cancelled, or a fault: the bind may have been made
        counted = getattr(exc, "bind_attempted", True)
        directory_binds.end(slot, ticket, failed=counted,
                            pending_s=getattr(exc, "bind_pending_s", DEADLINE_CAP_S))
        if counted:
            audit("reauth.fail", reason="cancelled" if isinstance(exc, asyncio.CancelledError)
                  else "directory_error")
        raise
    if identity is None:
        directory_binds.end(slot, ticket, failed=True)
        audit("reauth.fail", reason="bad_credentials")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_REAUTH_REFUSED)
    directory_binds.end(slot, ticket, failed=False)
    if identity.bound:
        # The bind as the account succeeded, and AD reset its count then — the directory says
        # so (`LdapIdentity.bound`), the clock is not asked. Right after `end`, nothing awaited
        # in between: failures recorded while this one ran stay (auth/limits.py, `succeeded`).
        directory_binds.succeeded(slot, ticket)
    if identity.disabled or not identity.bound:
        # Returned without a bind: switched off in AD, or past its end date as the directory
        # judged it. The session is over in AD: 401, and the dashboard's refresh ends it.
        audit("reauth.fail",
              reason="directory_disabled" if identity.disabled else "directory_expired")
        raise _bad_credentials()
```

- [ ] **Step 6: Run it to see it pass**

```bash
PYTHONPATH=src "$PY" -m pytest tests/test_auth_reauth.py tests/test_route_inventory.py tests/test_auth_ldap_login.py tests/test_auth_limits.py -q 2>&1 | tail -1
```
Expected: all passed, none skipped (`29` of them new). `/auth/reauth` reaches `get_principal`, so the route inventory needs no entry.

- [ ] **Step 7: The old workspace translates the refusal**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/i18n.rbac.test.js 2>&1 | grep -E "Tests "
```
Expected: `Tests  1 failed | 106 passed (107)` — `auth/router.py constant: Parola hatalı`.

**In** `dashboard/src/clinicalI18n.js` **replace:**

```js
        passwordChangeRequired: "Geçici parolanızı değiştirmeden devam edemezsiniz. Hesabım > Parola değiştir'i kullanın.",
```
**with:**
```js
        passwordChangeRequired: "Geçici parolanızı değiştirmeden devam edemezsiniz. Hesabım > Parola değiştir'i kullanın.",
        reauthRefused: "Parola hatalı.",
```

**In** `dashboard/src/clinicalI18n.js` **replace:**

```js
        passwordChangeRequired: "Müvəqqəti parolunuzu dəyişmədən davam edə bilməzsiniz. Hesabım > Parolu dəyiş bölməsindən istifadə edin.",
```
**with:**
```js
        passwordChangeRequired: "Müvəqqəti parolunuzu dəyişmədən davam edə bilməzsiniz. Hesabım > Parolu dəyiş bölməsindən istifadə edin.",
        reauthRefused: "Parol yanlışdır.",
```

**In** `dashboard/src/clinicalI18n.js` **replace:**

```js
        passwordChangeRequired: "Change your temporary password before you continue: My account > Change password.",
```
**with:**
```js
        passwordChangeRequired: "Change your temporary password before you continue: My account > Change password.",
        reauthRefused: "Incorrect password.",
```

**In** `dashboard/src/clinicalI18n.js` **replace:**

```js
        passwordChangeRequired: "Смените временный пароль, прежде чем продолжить: Мой аккаунт > Сменить пароль.",
```
**with:**
```js
        passwordChangeRequired: "Смените временный пароль, прежде чем продолжить: Мой аккаунт > Сменить пароль.",
        reauthRefused: "Неверный пароль.",
```

**In** `dashboard/src/clinicalI18n.js` **replace:**

```js
  ["Invalid credentials", "invalidCredentials"],
```
**with:**
```js
  ["Invalid credentials", "invalidCredentials"],
  ["Parola hatalı", "reauthRefused"],
```

- [ ] **Step 8: Gate — the whole backend suite on the test database (about 40 minutes each), on 3.14 and on the image's 3.12, then the dashboard**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest -q -p no:cacheprovider 2>&1 | tail -1
[ -x "$PY312" ] && PYTHONPATH=src "$PY312" -m pytest -q -p no:cacheprovider 2>&1 | tail -1
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `2255 passed, 6 skipped` with `$PY`, and `2251 passed, 8 skipped` with `$PY312` (where it exists); `Test Files  63 passed (63)`, `Tests  1320 passed (1320)`, `✓ built in …`.

- [ ] **Step 9: Commit**

```bash
cd /c/tmp/homunculus-g1
git add homunculus-engine/src/homunculus/auth/limits.py homunculus-engine/src/homunculus/auth/schemas.py homunculus-engine/src/homunculus/auth/router.py homunculus-engine/tests/test_auth_reauth.py homunculus-engine/tests/test_auth_limits.py dashboard/src/clinicalI18n.js
git commit -m "feat(auth): POST /auth/reauth unlocks a locked screen with the session's password

Local: bcrypt, 5 wrong in a row lock the unlock for 15 minutes, counted
with the wrong current passwords at /auth/password (the other place a
held token can test the password); one audit row when the lock engages.
AD: one bind, counted in the same failure chain as the account's sign-ins
exactly as a sign-in's bind is (Ticket, a bind the DC never answered
dated a deadline later, succeeded only for a bound identity, every
counted failure audited at once, a cancelled one too), so a locked screen
adds no capacity to lock the account out of the domain; a full chain is
429 without a bind. A wrong password is 403,
never 401 (the dashboard retries a 401 after a refresh). Nothing is
issued; MFA is not asked again. FailureChain refuses a ticket another
chain handed out (owner stamp): attempt numbers alone repeat across chains.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Wave 1B's leftovers for the shell

**Files:**
- Modify: `dashboard/src/live/ui/riskStyle.js`, `ui/Tabs.jsx`, `ui/index.js`, `prefs.js`, `theme/ThemeProvider.jsx`, `i18n/I18nProvider.jsx`, `ui/Toast.jsx`, `theme/tokens.js`
- Test: `ui/riskStyle.test.js`, `ui/choice.test.jsx`, `theme/ThemeProvider.test.jsx`, `i18n/I18nProvider.test.jsx`, `ui/Table.test.jsx`, `ui/surfaces.test.jsx`, `ui/Toast.test.jsx`; create `ui/index.test.js`

- [ ] **Step 1: Write the tests.** **Create** `dashboard/src/live/ui/index.test.js`:

```js
// The barrel hands screens everything they need from one import: the dialog's markers and the
// toast limits included (Wave 1B left them out).
import { describe, it, expect } from "vitest";
import * as ui from "./index.js";

describe("ui/index.js", () => {
  it("exports the dialog markers and the toast constants", () => {
    expect(ui.MODAL_EXEMPT).toBe("data-modal-exempt");
    expect(ui.MODAL_OPEN).toBe("data-modal-open");
    expect(ui.TOAST_WARN_MS).toBeGreaterThan(ui.TOAST_MS);
    expect(ui.TOAST_MAX).toBe(5);
  });
});
```

**Append to** `dashboard/src/live/ui/riskStyle.test.js`:

```js

describe("riskStyle options", () => {
  it("takes null for the options as it takes nothing", () => {
    expect(() => riskStyle("none", null)).not.toThrow();
    expect(riskStyle("none", null)).toEqual(riskStyle("none"));
    expect(riskStyle("high", null).tone).toBe("high");
  });
});
```

**In** `dashboard/src/live/ui/choice.test.jsx` **replace:**

```jsx
  it("reads a count label in place of the bare badge number", () => {
```
**with:**
```jsx
  it("a panel without an id claims no tab and says so in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<TabPanel tabs={TABS} value="users">bir</TabPanel>);
    const panel = screen.getByRole("tabpanel");
    expect(panel).not.toHaveAttribute("id");
    expect(panel).not.toHaveAttribute("aria-labelledby");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("TabPanel: no id"));
    warn.mockRestore();
  });

  it("reads a count label in place of the bare badge number", () => {
```

**In** `dashboard/src/live/theme/ThemeProvider.test.jsx` **replace:**

```jsx
import { render, screen, fireEvent } from "@testing-library/react";
```
**with:**
```jsx
import { render, screen, fireEvent, act } from "@testing-library/react";
```

**In** `dashboard/src/live/theme/ThemeProvider.test.jsx` **replace:**

```jsx
  // G1-07 mounts the new shell beside the old app in one tab: leaving it must not leave its theme
  // on <html> for the old app's page.
  it("takes data-theme and data-size off <html> when it unmounts", () => {
    const { unmount } = render(<ThemeProvider><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByText("gun"));
    expect(html.dataset.theme).toBe("gun");
    unmount();
    expect(html.hasAttribute("data-theme")).toBe(false);
    expect(html.hasAttribute("data-size")).toBe(false);
  });
```
**with:**
```jsx
  // The old app may run in the same tab (?eski=1, until G1-16): leaving the live UI must not
  // leave its theme on <html> — and a value the page had before is given back, not deleted.
  it("takes data-theme and data-size off <html> when it unmounts", () => {
    const { unmount } = render(<ThemeProvider><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByText("gun"));
    expect(html.dataset.theme).toBe("gun");
    unmount();
    expect(html.hasAttribute("data-theme")).toBe(false);
    expect(html.hasAttribute("data-size")).toBe(false);
  });

  it("gives back the values <html> had before it mounted", () => {
    html.dataset.theme = "eski";
    html.dataset.size = "kucuk";
    const { unmount } = render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(html.dataset.theme).toBe("gece");
    unmount();
    expect(html.dataset.theme).toBe("eski");
    expect(html.dataset.size).toBe("kucuk");
  });

  it("follows a theme or size chosen in another tab, without writing it back", () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    const write = vi.spyOn(Storage.prototype, "setItem");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "hmc.theme", newValue: "gun" }));
      window.dispatchEvent(new StorageEvent("storage", { key: "hmc.size", newValue: "buyuk" }));
    });
    expect(screen.getByTestId("theme")).toHaveTextContent("gun");
    expect(html.dataset.size).toBe("buyuk");
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "hmc.theme", newValue: "auto" })));
    expect(screen.getByTestId("theme")).toHaveTextContent("gun");
    expect(write).not.toHaveBeenCalled();
  });
```

**In** `dashboard/src/live/i18n/I18nProvider.test.jsx` **replace:**

```jsx
import { render, screen, fireEvent } from "@testing-library/react";
```
**with:**
```jsx
import { render, screen, fireEvent, act } from "@testing-library/react";
```

**In** `dashboard/src/live/i18n/I18nProvider.test.jsx` **replace:**

```jsx
describe("without a provider", () => {
```
**with:**
```jsx
describe("beside another page and other tabs", () => {
  it("gives <html lang> back as it was when it unmounts", () => {
    document.documentElement.setAttribute("lang", "tr");
    const { unmount } = render(<I18nProvider><Probe /></I18nProvider>);
    expect(document.documentElement.lang).toBe("az");
    unmount();
    expect(document.documentElement.lang).toBe("tr");
    document.documentElement.removeAttribute("lang");
    const again = render(<I18nProvider><Probe /></I18nProvider>);
    again.unmount();
    expect(document.documentElement.hasAttribute("lang")).toBe(false);
  });

  it("follows a language chosen in another tab, and ignores one it does not have", () => {
    render(<I18nProvider><Probe /></I18nProvider>);
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "hmc.lang", newValue: "en" })));
    expect(screen.getByText("Close")).toBeInTheDocument();
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "hmc.lang", newValue: "de" })));
    expect(screen.getByText("Close")).toBeInTheDocument();
  });
});

describe("without a provider", () => {
```

**In** `dashboard/src/live/ui/Table.test.jsx` **replace:**

```jsx
  it("without a caption is no region, takes no focus, and warns in development", () => {
```
**with:**
```jsx
  // Browsers have ResizeObserver (jsdom does not): the frame and the table are both watched, and
  // the observer goes away with the table.
  it("watches the frame and the table with a ResizeObserver where the browser has one", () => {
    const observers = [];
    class FakeObserver {
      constructor(callback) { this.callback = callback; this.targets = []; this.disconnected = false; observers.push(this); }
      observe(target) { this.targets.push(target); }
      disconnect() { this.disconnected = true; }
    }
    vi.stubGlobal("ResizeObserver", FakeObserver);
    widths(600, 600);
    const { container, unmount } = render(<Table caption="İstifadəçilər">{rows}</Table>);
    const [observer] = observers;
    expect(observer.targets).toEqual([container.firstChild, container.firstChild.firstElementChild]);
    size.client = 390;
    act(() => observer.callback());
    expect(screen.getByRole("region", { name: "İstifadəçilər" })).toBeInTheDocument();
    unmount();
    expect(observer.disconnected).toBe(true);
    vi.unstubAllGlobals();
  });

  it("without a caption is no region, takes no focus, and warns in development", () => {
```

**In** `dashboard/src/live/ui/surfaces.test.jsx` **replace:**

```jsx
  it("says what is missing", () => {
    render(<Empty icon="search">Uyğun qeyd yoxdur.</Empty>);
    expect(screen.getByText("Uyğun qeyd yoxdur.")).toBeInTheDocument();
  });
```
**with:**
```jsx
  it("says what is missing", () => {
    render(<Empty icon="search">Uyğun qeyd yoxdur.</Empty>);
    expect(screen.getByText("Uyğun qeyd yoxdur.")).toBeInTheDocument();
  });

  it("draws its icon as decoration, and none when not given one", () => {
    const { container, rerender } = render(<Empty icon="search">Uyğun qeyd yoxdur.</Empty>);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    rerender(<Empty>Uyğun qeyd yoxdur.</Empty>);
    expect(container.querySelector("svg")).toBeNull();
  });
```

**In** `dashboard/src/live/ui/Toast.test.jsx` **replace:**

```jsx
describe("toasts", () => {
  it("have a named live region before the first toast", () => {
```
**with:**
```jsx
describe("toasts", () => {
  it("all go when the provider's resetKey changes, and not before", () => {
    const { rerender } = render(<ToastProvider resetKey="a"><Grab /></ToastProvider>);
    show("Yadda saxlanıldı");
    show("Xəta baş verdi", "error");
    rerender(<ToastProvider resetKey="a"><Grab /></ToastProvider>);
    expect(cards()).toHaveLength(2);
    rerender(<ToastProvider resetKey="b"><Grab /></ToastProvider>);
    expect(cards()).toHaveLength(0);
    expect(alerts()).toBeEmptyDOMElement();
  });

  it("have a named live region before the first toast", () => {
```

- [ ] **Step 2: Run them to see which fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ 2>&1 | grep -E "×|Tests "
```
Expected: `Test Files  6 failed | 15 passed (21)` and `Tests  8 failed | 494 passed (502)` — the index exports, `riskStyle(…, null)` (`Cannot destructure property 'measured' of 'object null'`), the id-less panel (`id="undefined-panel-0"`), the two ThemeProvider and two I18nProvider cases, the toast `resetKey`. The `Table` ResizeObserver and `Empty` icon tests pass at once: they cover existing code that had no test (the roadmap's "test boşlukları").

- [ ] **Step 3: Implement**

**In** `dashboard/src/live/ui/riskStyle.js` **replace:**

```js
export function riskStyle(risk, { measured } = {}) {
```
**with:**
```js
export function riskStyle(risk, opts) {
  const { measured } = opts ?? {};
```

**In** `dashboard/src/live/ui/Tabs.jsx` **replace:**

```jsx
export function TabPanel({ id, tabs, value, className = "", children }) {
  const index = tabs.findIndex((tab) => tab.value === value);
  const link = index === -1 ? {} : { id: panelId(id, index), "aria-labelledby": tabId(id, index) };
```
**with:**
```jsx
export function TabPanel({ id, tabs, value, className = "", children }) {
  if (!id && import.meta.env.DEV) console.warn("TabPanel: no id — it cannot name its tab (give <Tabs> and <TabPanel> the same id)");
  const index = id ? tabs.findIndex((tab) => tab.value === value) : -1;
  const link = index === -1 ? {} : { id: panelId(id, index), "aria-labelledby": tabId(id, index) };
```

**In** `dashboard/src/live/ui/index.js` **replace:**

```js
// src/live/ui/index.js — the live UI's base components, for screens to import from one place.
```
**with:**
```js
// src/live/ui/index.js — the live UI's base components, for screens to import from one place.
//
// Tones, by component. Each keeps its own table, and a tone it does not have falls back:
//   Tag          neutral | warn | crit                          -> neutral
//   StatusPill   crit | high | mid | low | ok | att | neutral    -> neutral   (STATUS_TONES)
//   Note         warn | info                                     -> warn
//   Alert        crit | info                                     -> crit
//   toast()      ok | warn | error                               -> ok
//   riskStyle    an engine risk -> a StatusPill tone; an unknown risk -> att (attention), never ok
// Callers pass only a tone the component has: the fallbacks are a safety net, not a vocabulary.
```

**In** `dashboard/src/live/ui/index.js` **replace:**

```js
export { Modal } from "./Modal.jsx";
export { ToastProvider, useToast, TOAST_MS } from "./Toast.jsx";
```
**with:**
```js
export { Modal, MODAL_EXEMPT, MODAL_OPEN } from "./Modal.jsx";
export { ToastProvider, useToast, TOAST_MS, TOAST_WARN_MS, TOAST_MAX } from "./Toast.jsx";
```

**In** `dashboard/src/live/prefs.js` **replace:**

```js
const PREFIX = "hmc.";
```
**with:**
```js
export const PREF_PREFIX = "hmc.";
const PREFIX = PREF_PREFIX;
```

**In** `dashboard/src/live/theme/ThemeProvider.jsx` **replace:**

```jsx
import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";
import { readPref, writePref } from "../prefs.js";
```
**with:**
```jsx
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { PREF_PREFIX, readPref, writePref } from "../prefs.js";
```

**In** `dashboard/src/live/theme/ThemeProvider.jsx` **replace:**

```jsx
  // On unmount, take them off again: G1-07 mounts the new shell beside the old app in one tab, and
  // the old app's page must not keep the live UI's theme.
  useLayoutEffect(() => () => {
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.size;
  }, []);
```
**with:**
```jsx
  // On unmount, put back what <html> had before (usually nothing): the old app may run in the
  // same tab (?eski=1, until G1-16) and must not keep the live UI's theme, and a page that had set
  // its own value keeps it. Read in the first render, before the effects above write.
  const [before] = useState(() => ({
    theme: document.documentElement.getAttribute("data-theme"),
    size: document.documentElement.getAttribute("data-size"),
  }));
  useLayoutEffect(() => () => {
    restoreAttribute("data-theme", before.theme);
    restoreAttribute("data-size", before.size);
  }, [before]);

  // Another tab of this browser changed it: follow, without writing it back.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === `${PREF_PREFIX}theme` && THEMES.includes(event.newValue)) setThemeState(event.newValue);
      if (event.key === `${PREF_PREFIX}size` && SIZES.includes(event.newValue)) setSizeState(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
```

**In** `dashboard/src/live/theme/ThemeProvider.jsx` **replace:**

```jsx
export function useTheme() {
  return useContext(ThemeContext);
}
```
**with:**
```jsx
export function useTheme() {
  return useContext(ThemeContext);
}

/** Put an attribute of <html> back to `value`, or remove it when it had none. */
export function restoreAttribute(name, value) {
  if (value === null || value === undefined) document.documentElement.removeAttribute(name);
  else document.documentElement.setAttribute(name, value);
}
```

**In** `dashboard/src/live/i18n/I18nProvider.jsx` **replace:**

```jsx
import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";
import { readPref, writePref } from "../prefs.js";
```
**with:**
```jsx
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { PREF_PREFIX, readPref, writePref } from "../prefs.js";
```

**In** `dashboard/src/live/i18n/I18nProvider.jsx` **replace:**

```jsx
  useLayoutEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
```
**with:**
```jsx
  useLayoutEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  // On unmount, give <html lang> back as it was (the old app sets its own).
  const [before] = useState(() => document.documentElement.getAttribute("lang"));
  useLayoutEffect(() => () => {
    if (before === null) document.documentElement.removeAttribute("lang");
    else document.documentElement.setAttribute("lang", before);
  }, [before]);
  // Another tab of this browser switched language: follow, without writing it back.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === `${PREF_PREFIX}lang` && LANG_CODES.includes(event.newValue)) setLangState(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
```

**In** `dashboard/src/live/ui/Toast.jsx` **replace:**

```jsx
  return {
    add,
    remove,
    hover(id, on) {
```
**with:**
```jsx
  return {
    add,
    remove,
    /** Every toast goes at once (the session they spoke for ended or locked). */
    clear() {
      if (items.length) remove(items.map((item) => item.id));
    },
    hover(id, on) {
```

**In** `dashboard/src/live/ui/Toast.jsx` **replace:**

```jsx
export function ToastProvider({ children }) {
  const { t } = useI18n();
  const base = useId();
  const [items, setItems] = useState([]);
  const [toasts] = useState(() => createToasts(setItems));
  const sayId = (id) => `${base}-toast-${id}`;
```
**with:**
```jsx
export function ToastProvider({ resetKey, children }) {
  const { t } = useI18n();
  const base = useId();
  const [items, setItems] = useState([]);
  const [toasts] = useState(() => createToasts(setItems));
  const sayId = (id) => `${base}-toast-${id}`;

  // A new `resetKey` empties the stack: the live shell changes it when a session locks or ends,
  // so a toast that named a bed or a person does not outlive the screen it belonged to.
  useEffect(() => {
    toasts.clear();
  }, [toasts, resetKey]);
```

**In** `dashboard/src/live/ui/Toast.jsx` **replace:**

```jsx
 *  Not for alarms: a clinical alarm never lives in a toast. */
```
**with:**
```jsx
 *  `resetKey`: when it changes, every toast goes (the live shell: a session locked or ended).
 *  Not for alarms: a clinical alarm never lives in a toast. */
```

**In** `dashboard/src/live/theme/tokens.js` **replace:**

```js
export const TYPE_SIZES = ["10", "10.5", "11", "11.5", "12", "12.5", "13", "13.5", "14", "14.5", "17", "23"];
```
**with:**
```js
// 15/20/28/40 came with the shell (G1-07/G1-08): the lock card, the brand and step headings, the
// sign-in title (the prototype's .lg2 h2) and the hero headline.
export const TYPE_SIZES = ["10", "10.5", "11", "11.5", "12", "12.5", "13", "13.5", "14", "14.5", "15", "17", "20", "23", "28", "40"];
```

- [ ] **Step 4: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  64 passed (64)`, `Tests  1330 passed (1330)`, `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/ui/riskStyle.js dashboard/src/live/ui/Tabs.jsx dashboard/src/live/ui/index.js dashboard/src/live/prefs.js dashboard/src/live/theme/ThemeProvider.jsx dashboard/src/live/i18n/I18nProvider.jsx dashboard/src/live/ui/Toast.jsx dashboard/src/live/theme/tokens.js dashboard/src/live/ui/index.test.js dashboard/src/live/ui/riskStyle.test.js dashboard/src/live/ui/choice.test.jsx dashboard/src/live/theme/ThemeProvider.test.jsx dashboard/src/live/i18n/I18nProvider.test.jsx dashboard/src/live/ui/Table.test.jsx dashboard/src/live/ui/surfaces.test.jsx dashboard/src/live/ui/Toast.test.jsx
git commit -m "fix(dashboard): Wave 1B's leftovers for the shell

ui/index.js exports the dialog markers and toast limits and maps the tone
vocabularies; an id-less TabPanel claims no tab; riskStyle takes null
options; Theme/I18n providers give <html> back its earlier attributes and
follow other tabs; ToastProvider empties on a new resetKey; type sizes
15/20/28/40; tests for Table's ResizeObserver path and Empty's icon.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The API client — `Retry-After`, `forget()`, `reauth()`

**Files:**
- Modify: `dashboard/src/backendApi.js`
- Test: `dashboard/src/backendApi.test.js`

- [ ] **Step 1: Write the failing tests**

**In** `dashboard/src/backendApi.test.js` **replace:**

```js
describe("backendApi — auth", () => {
```
**with:**
```js
describe("backendApi — locked screen and other tabs", () => {
  it("unlocks with the session's password through /auth/reauth", async () => {
    store.set("homunculus-access-token", "acc-1");
    store.set("homunculus-refresh-token", "ref-1");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    expect(await api.reauth("gizli")).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/auth/reauth");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer acc-1");
    expect(JSON.parse(init.body)).toEqual({ password: "gizli" });
  });

  it("never sends a refused unlock again: a wrong password is a 403", async () => {
    store.set("homunculus-access-token", "acc-1");
    store.set("homunculus-refresh-token", "ref-1");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ detail: "Parola hatalı" }, { ok: false, status: 403 }));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    await expect(api.reauth("yanlis")).rejects.toMatchObject({ status: 403, message: "Parola hatalı" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a 429's Retry-After, in seconds", async () => {
    const res = {
      ...jsonResponse({ detail: "Çok fazla giriş denemesi; bir dakika sonra tekrar deneyin" },
        { ok: false, status: 429 }),
      headers: new Headers({ "Retry-After": "60" }),
    };
    const api = createBackendApi({ baseUrl: "", fetchImpl: vi.fn().mockResolvedValue(res) });
    await expect(api.login("ayse", "x")).rejects.toMatchObject({ status: 429, retryAfter: 60 });
  });

  it("sets no retryAfter without a usable Retry-After", async () => {
    for (const headers of [undefined, new Headers(), new Headers({ "Retry-After": "soon" })]) {
      const res = { ...jsonResponse({ detail: "x" }, { ok: false, status: 429 }), headers };
      const api = createBackendApi({ baseUrl: "", fetchImpl: vi.fn().mockResolvedValue(res) });
      const err = await api.login("ayse", "x").catch((e) => e);
      expect(err.retryAfter).toBeUndefined();
    }
  });

  it("forgets the pair it holds when another tab changed storage, and reads storage again", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    store.set("homunculus-access-token", "acc-1");
    expect(api.accessToken()).toBe("acc-1");
    store.set("homunculus-access-token", "acc-other-tab");
    expect(api.accessToken()).toBe("acc-1");          // the copy in memory
    api.forget();
    expect(api.accessToken()).toBe("acc-other-tab");
    expect(store.get("homunculus-access-token")).toBe("acc-other-tab");   // storage untouched
  });
});

describe("backendApi — auth", () => {
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/backendApi.test.js 2>&1 | grep -E "×|Tests "
```
Expected: `Tests  4 failed | 33 passed (37)` — `api.reauth is not a function`, no `retryAfter`, `api.forget is not a function` (the "no usable Retry-After" case passes already).

- [ ] **Step 3: Implement**

**In** `dashboard/src/backendApi.js` **replace:**

```js
const ACCESS_KEY = "homunculus-access-token";
const REFRESH_KEY = "homunculus-refresh-token";
```
**with:**
```js
const ACCESS_KEY = "homunculus-access-token";
const REFRESH_KEY = "homunculus-refresh-token";
/** Where the pair is stored: another tab's change to either is a `storage` event on that key. */
export const TOKEN_KEYS = Object.freeze({ access: ACCESS_KEY, refresh: REFRESH_KEY });
```

**In** `dashboard/src/backendApi.js` **replace:**

```js
  function logout() {
    generation += 1;
    setTokens(null);
  }
```
**with:**
```js
  function logout() {
    generation += 1;
    setTokens(null);
  }

  /** Another tab of this browser replaced or removed the stored pair: drop the copy held in
   *  memory, so the next request reads storage again, and treat it as a new session (a refresh
   *  on its way for the old pair is superseded). Storage itself is not touched — it belongs to
   *  the other tab's session now. */
  function forget() {
    generation += 1;
    mem.access = null;
    mem.refresh = null;
  }
```

**In** `dashboard/src/backendApi.js` **replace:**

```js
    const err = new Error(detail);
    err.status = res.status;
    if (fieldErrors) err.fieldErrors = fieldErrors;
    return err;
  }
```
**with:**
```js
    const err = new Error(detail);
    err.status = res.status;
    if (fieldErrors) err.fieldErrors = fieldErrors;
    // A 429 says how long to wait (nginx's sign-in limit sends Retry-After: 60): whole seconds,
    // kept so a screen can hold its button that long instead of letting it be pressed again.
    const retryAfter = Number.parseInt(res.headers?.get?.("Retry-After") ?? "", 10);
    if (Number.isFinite(retryAfter) && retryAfter > 0) err.retryAfter = retryAfter;
    return err;
  }
```

**In** `dashboard/src/backendApi.js` **replace:**

```js
  return {
    accessToken,
    logout,
```
**with:**
```js
  return {
    accessToken,
    logout,
    forget,
```

**In** `dashboard/src/backendApi.js` **replace:**

```js
    me() {
      return authed("/auth/me");
    },
```
**with:**
```js
    me() {
      return authed("/auth/me");
    },

    /** Unlock a locked screen with the session's own password. Through the refresh-and-retry
     *  path on purpose: a 401 here is the access token's (it expired while the screen was
     *  locked), answered before the password is looked at, so the retry is the first check. A
     *  wrong password is a 403 and is never retried. Resolves to {ok: true}. */
    reauth(password) {
      return authed("/auth/reauth", { method: "POST", body: { password } });
    },
```

- [ ] **Step 4: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  64 passed (64)`, `Tests  1335 passed (1335)`, `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/backendApi.js dashboard/src/backendApi.test.js
git commit -m "feat(dashboard): the API client keeps Retry-After, forgets on another tab's change, unlocks

err.retryAfter (seconds) on a refusal that says how long to wait; forget()
drops the in-memory token pair when another tab replaced the stored one;
reauth(password) for the lock screen; TOKEN_KEYS names the storage keys.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `Alert` — a message that is announced

**Files:**
- Create: `dashboard/src/live/ui/Alert.jsx`
- Modify: `dashboard/src/live/ui/index.js`
- Test: `dashboard/src/live/ui/Alert.test.jsx`

- [ ] **Step 1: Write the failing test.** **Create** `dashboard/src/live/ui/Alert.test.jsx`:

```jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Alert } from "./Alert.jsx";

describe("Alert", () => {
  it("announces a refusal at once (role=alert), with an icon", () => {
    const { container } = render(<Alert>İstifadəçi adı və ya şifrə səhvdir.</Alert>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("İstifadəçi adı və ya şifrə səhvdir.");
    expect(alert).toHaveAttribute("data-tone", "crit");
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("announces a confirmation politely (role=status)", () => {
    render(<Alert tone="info">Təhlükəsiz çıxış edildi.</Alert>);
    expect(screen.getByRole("status")).toHaveTextContent("Təhlükəsiz çıxış edildi.");
  });

  it("treats a tone it does not have as a refusal", () => {
    render(<Alert tone="green">Kod səhvdir.</Alert>);
    expect(screen.getByRole("alert")).toHaveAttribute("data-tone", "crit");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/Alert.test.jsx 2>&1 | grep -E "Error|Tests "
```
Expected: `Failed to resolve import "./Alert.jsx"`.

- [ ] **Step 3: Implement.** **Create** `dashboard/src/live/ui/Alert.jsx`:

```jsx
// src/live/ui/Alert.jsx — a message that appears because of what the user just did, next to it:
// a refused sign-in, a wrong code, "you were signed out". The prototype's errBox (shell.js).
import React from "react";
import { Icon } from "./Icon.jsx";

const TONE = {
  crit: { role: "alert", icon: "alert",
    cls: "border-[color:color-mix(in_srgb,var(--crit)_45%,transparent)] bg-crit-soft text-crit-ink" },
  info: { role: "status", icon: "ok",
    cls: "border-[color:color-mix(in_srgb,var(--pri)_40%,transparent)] bg-pri-soft text-pri" },
};

/** Announced, unlike Note (a static aside): `crit` is role="alert" — read at once, for a refusal —
 *  and `info` role="status" — read politely, for a confirmation. Render it only while there is
 *  something to say: a screen reader announces it when it appears. tone: crit (default) | info. */
export function Alert({ tone = "crit", icon, className = "", children }) {
  const t = TONE[tone] ? tone : "crit";
  return (
    <div
      role={TONE[t].role}
      data-tone={t}
      className={`flex items-start gap-2 rounded-ctl border px-3 py-2.5 font-text text-13 font-semibold leading-snug ${TONE[t].cls} ${className}`}
    >
      <Icon name={icon || TONE[t].icon} size={16} className="mt-px shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
```

**In** `dashboard/src/live/ui/index.js` **replace:**

```js
export { Note } from "./Note.jsx";
```
**with:**
```js
export { Note } from "./Note.jsx";
export { Alert } from "./Alert.jsx";
```

- [ ] **Step 4: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  65 passed (65)`, `Tests  1338 passed (1338)`, `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/ui/Alert.jsx dashboard/src/live/ui/Alert.test.jsx dashboard/src/live/ui/index.js
git commit -m "feat(live-ui): Alert, an announced inline message (role alert / status)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The server's refusals in the user's language

**Files:**
- Create: `dashboard/src/live/apiErrors.js`, `dashboard/src/live/i18n/strings/errors.js`
- Modify: `dashboard/src/live/i18n/catalog.js`
- Test: `dashboard/src/live/apiErrors.test.js`

- [ ] **Step 1: Write the failing test.** **Create** `dashboard/src/live/apiErrors.test.js`:

```js
// Every refusal the sign-in, MFA, password, lock-screen and session surface can show is mapped
// to a translated text. The messages are read from their sources as TEXT (never executed), so a
// message added or changed on the server fails here until apiErrors.js maps it — the same
// guarantee i18n.rbac.test.js gives the old workspace.
// (Paths built with node:path: under jsdom the global URL is jsdom's, which fileURLToPath refuses.)
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API_MESSAGE_KEYS, apiErrorKey, apiErrorText } from "./apiErrors.js";
import { DICTIONARIES } from "./i18n/catalog.js";
import { LANG_CODES } from "./i18n/langs.js";
import { createTranslator } from "./i18n/translate.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, "../../../homunculus-engine/src/homunculus");
const py = (rel) => fs.readFileSync(path.join(ENGINE, rel), "utf8");
const js = (rel) => fs.readFileSync(path.resolve(HERE, "..", rel), "utf8");

const STR = String.raw`"((?:[^"\\\n]|\\.)*)"`;
const unquote = (s) => {
  if (s.includes("\\")) throw new Error(`escape sequence in ${JSON.stringify(s)}: extend the reader`);
  return s;
};
/** Module-level string constants: `NAME = "…"` or `NAME = ("…" "…")`. */
function pyConstants(src) {
  const out = new Map();
  const re = new RegExp(String.raw`^(_?[A-Z][A-Z0-9_]*) = (?:${STR}|\(((?:\s*${STR})+)\s*\))`, "gm");
  for (const m of src.matchAll(re)) {
    out.set(m[1], m[2] !== undefined ? unquote(m[2])
      : [...m[3].matchAll(new RegExp(STR, "g"))].map((p) => unquote(p[1])).join(""));
  }
  return out;
}
const literals = (src, pattern) => [...src.matchAll(new RegExp(pattern, "g"))].map((m) => unquote(m[1]));

const DEPS = py("auth/dependencies.py");
const ROUTER = py("auth/router.py");
const LDAP = pyConstants(py("auth/ldap.py"));
const BACKEND_API = js("backendApi.js");
const NGINX = fs.readFileSync(path.resolve(HERE, "../../../deploy/local/web/nginx.conf"), "utf8");
const nginxLimited = /^\s*location @login_limited \{[^]*?^\s*return 429 '([^']*)';/m.exec(NGINX);

/** Every message the auth surface can answer with, and where it comes from. */
const SOURCES = [
  ...[...pyConstants(DEPS).values()].map((m) => ["auth/dependencies.py constant", m]),
  ...literals(DEPS, String.raw`detail=${STR}`).map((m) => ["auth/dependencies.py detail", m]),
  ...literals(DEPS, String.raw`_unauthorized\(${STR}\)`).map((m) => ["auth/dependencies.py 401", m]),
  ...literals(DEPS, String.raw`def _unauthorized\(detail: str = ${STR}\)`).map((m) => ["auth/dependencies.py 401", m]),
  ...[...pyConstants(ROUTER).values()].map((m) => ["auth/router.py constant", m]),
  ...literals(ROUTER, String.raw`detail=${STR}`).map((m) => ["auth/router.py detail", m]),
  ...literals(py("auth/service.py"), String.raw`PasswordError\(${STR}`).map((m) => ["auth/service.py", m]),
  ...literals(py("auth/schemas.py"), String.raw`ValueError\(${STR}\)`).map((m) => ["auth/schemas.py", m]),
  ["auth/ldap.py DIRECTORY_DOWN", LDAP.get("DIRECTORY_DOWN")],
  ["auth/ldap.py NOT_CONFIGURED", LDAP.get("NOT_CONFIGURED")],
  ["nginx.conf 429", nginxLimited ? JSON.parse(nginxLimited[1]).detail : undefined],
  ...literals(BACKEND_API, String.raw`failure\(\w+,\s*${STR}\)`).map((m) => ["backendApi.js", m]),
  ...literals(BACKEND_API, String.raw`TIMEOUT_MESSAGE = ${STR}`).map((m) => ["backendApi.js timeout", m]),
  ...literals(BACKEND_API, String.raw`SUPERSEDED_MESSAGE = ${STR}`).map((m) => ["backendApi.js superseded", m]),
];

describe("the auth surface's messages are translated", () => {
  it("the readers found the messages the sources hold", () => {
    const texts = SOURCES.map(([, text]) => text);
    for (const anchor of ["password_change_required", "mfa_required", "Parola hatalı", "Invalid credentials",
      "Yeni parola mevcut paroladan farklı olmalı", "Dizin sunucusuna ulaşılamıyor", "login is required",
      "Çok fazla giriş denemesi; bir dakika sonra tekrar deneyin", "Giriş başarısız."]) {
      expect(texts, anchor).toContain(anchor);
    }
    expect(SOURCES.length).toBeGreaterThan(25);
  });

  it.each(SOURCES)("%s: %s", (_where, message) => {
    const hit = apiErrorKey(new Error(message));
    expect(hit, message).not.toBeNull();
    for (const lang of LANG_CODES) expect(DICTIONARIES[lang][hit.key], `${lang} ${hit.key}`).toBeTruthy();
  });

  it("every mapped key has its text in the four languages", () => {
    for (const key of new Set(API_MESSAGE_KEYS.values())) {
      for (const lang of LANG_CODES) expect(DICTIONARIES[lang][`errors.${key}`], `${lang} ${key}`).toBeTruthy();
    }
  });
});

describe("apiErrorText", () => {
  const az = createTranslator("az", DICTIONARIES);
  const en = createTranslator("en", DICTIONARIES);

  it("translates a known message, whatever whitespace surrounds it", () => {
    expect(apiErrorText(az, new Error("  Invalid credentials \n"))).toBe("İstifadəçi adı və ya şifrə səhvdir.");
    expect(apiErrorText(en, "Parola hatalı")).toBe("Incorrect password.");
  });

  it("prefers the client's code to the text", () => {
    const err = Object.assign(new Error("anything"), { code: "REQUEST_TIMEOUT" });
    expect(apiErrorText(en, err)).toMatch(/^The server did not answer/);
  });

  it("keeps the status of a request that failed without a message of its own", () => {
    expect(apiErrorText(en, new Error("İstek başarısız (502)"))).toBe("The request failed (502).");
  });

  it("names a password that is too long, from the 422's items, never echoing the input", () => {
    const err = Object.assign(new Error("new_password: String should have at most 1024 characters"), {
      status: 422, fieldErrors: [{ field: "new_password", type: "string_too_long", message: "…" }],
    });
    expect(apiErrorText(en, err)).toBe("The password can be at most 1024 characters.");
  });

  it("shows an unknown message as the server wrote it, and never an empty string", () => {
    expect(apiErrorText(en, new Error("Beklenmeyen bir durum"))).toBe("Beklenmeyen bir durum");
    expect(apiErrorText(en, new Error(""))).toBe("The action could not be completed.");
    expect(apiErrorText(en, null)).toBe("The action could not be completed.");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/apiErrors.test.js 2>&1 | grep -E "Error|Tests "
```
Expected: `Failed to resolve import "./apiErrors.js"`.

- [ ] **Step 3: The mapping.** **Create** `dashboard/src/live/apiErrors.js`:

```js
// src/live/apiErrors.js — an API failure, in the user's language.
//
// The API writes its refusals as fixed texts, mostly Turkish, some English or a bare code
// (homunculus-engine auth/*.py), nginx answers a sign-in over its limit itself, and the client
// adds its own (backendApi.js). Each known text maps to a key of the `errors` namespace;
// apiErrors.test.js reads those sources as TEXT and fails when one of their messages is not
// mapped here, so a message added on the server cannot reach a ward untranslated.
//
// This covers the sign-in, MFA, password, lock-screen and session surface (Wave 2). A screen
// that talks to more of the API (G1-12's /admin) adds its own sources to the test and its own
// messages below.
//
// Not translated, ever: anything the message carries about a patient. These texts carry none.

/** Exact text (trimmed) -> key in the `errors` namespace. */
export const API_MESSAGE_KEYS = new Map([
  // auth/dependencies.py
  ["Hesabınıza kurum tanımlanmamış", "noTenant"],
  ["Bu kurumdaki üyeliğiniz etkin değil", "membershipInactive"],
  ["Platform operatörü yetkisi gerekli", "platformOnly"],
  ["password_change_required", "passwordChangeRequired"],
  ["mfa_required", "mfaRequired"],
  ["mfa_reset_required", "mfaResetRequired"],
  ["Invalid or missing authentication credentials", "notAuthenticated"],
  ["token_version", "tokenVersion"],
  ["tenant", "tenantChanged"],
  // auth/router.py
  ["Çok fazla hatalı kod. 5 dakika sonra tekrar deneyin.", "totpLocked"],
  ["Bu kod zaten kullanıldı; yeni kodu bekleyin.", "totpReplayed"],
  ["TOTP not set up", "totpNotSetUp"],
  ["Invalid TOTP code", "invalidTotp"],
  ["Çok fazla hatalı deneme; 15 dakika sonra tekrar deneyin", "directoryThrottled"],
  ["Parola hatalı", "reauthRefused"],
  ["Invalid credentials", "invalidCredentials"],
  ["Invalid or expired refresh token", "sessionExpired"],
  // auth/ldap.py
  ["Dizin sunucusuna ulaşılamıyor", "directoryUnreachable"],
  ["Dizin yapılandırılmamış", "directoryNotConfigured"],
  // auth/service.py (own password change)
  ["Parola Active Directory tarafından yönetiliyor", "directoryPassword"],
  ["Yeni parola en az 8 karakter olmalı", "passwordTooShort"],
  ["Yeni parola mevcut paroladan farklı olmalı", "passwordUnchanged"],
  ["Mevcut parola yanlış", "wrongCurrentPassword"],
  // auth/schemas.py
  ["login is required", "loginRequired"],
  // deploy/local/web/nginx.conf: a sign-in over the per-address limit (location @login_limited)
  ["Çok fazla giriş denemesi; bir dakika sonra tekrar deneyin", "loginRateLimited"],
  // backendApi.js
  ["Oturum süresi doldu, tekrar giriş yapın.", "sessionExpired"],
  ["Sunucuya şu an ulaşılamıyor; oturumunuz açık, biraz sonra tekrar deneyin.", "sessionUnreachable"],
  ["Giriş başarısız.", "loginFailed"],
  ["Doğrulama kodu geçersiz.", "invalidTotp"],
  ["Sunucu yanıt vermedi. İşlem gerçekleşmiş olabilir; listeyi kontrol edip gerekirse tekrar deneyin.",
    "requestTimeout"],
  ["Bu istek önceki oturuma aitti; sonucu uygulanmadı.", "sessionSuperseded"],
  // fetch() rejecting with no response: Chrome/Edge, Firefox, Safari
  ["Failed to fetch", "network"],
  ["NetworkError when attempting to fetch resource.", "network"],
  ["Load failed", "network"],
]);

/** backendApi.js `err.code`s; they win over the text. */
export const API_CODE_KEYS = new Map([
  ["REQUEST_TIMEOUT", "requestTimeout"],
  ["SESSION_SUPERSEDED", "sessionSuperseded"],
]);

const REQUEST_FAILED = /^İstek başarısız \((\d{3})\)$/; // backendApi.js
const PASSWORD_FIELDS = new Set(["password", "current_password", "new_password"]);

const messageOf = (err) => (typeof err === "string" ? err : typeof err?.message === "string" ? err.message : "");

/** One 422 item ({field, type, message}, backendApi.js) as {key, vars}, or null. Only the password
 *  fields of the auth forms: the screens' own checks catch the rest before a request is sent. */
function fieldErrorKey(item) {
  if (!item || !PASSWORD_FIELDS.has(item.field)) return null;
  if (item.type === "string_too_long") return { key: "errors.passwordTooLong", vars: {} };
  if (item.type === "string_too_short" || item.type === "missing") return { key: "errors.passwordRequired", vars: {} };
  return null;
}

/** Which `errors.*` text an API failure is — {key, vars} — or null when it is not a known one.
 *  Takes an Error from backendApi (its `code` first, then its 422 items, then its message), or
 *  the message itself. */
export function apiErrorKey(err) {
  if (err && typeof err === "object" && API_CODE_KEYS.has(err.code)) {
    return { key: `errors.${API_CODE_KEYS.get(err.code)}`, vars: {} };
  }
  if (err && Array.isArray(err.fieldErrors)) {
    const hit = err.fieldErrors.map(fieldErrorKey).find(Boolean);
    if (hit) return hit;
  }
  const text = messageOf(err).trim();
  if (API_MESSAGE_KEYS.has(text)) return { key: `errors.${API_MESSAGE_KEYS.get(text)}`, vars: {} };
  const failed = REQUEST_FAILED.exec(text);
  if (failed) return { key: "errors.requestFailed", vars: { status: failed[1] } };
  return null;
}

/** The failure as the user reads it: a known message translated; anything else as the server
 *  wrote it (better than nothing, and what a support call needs); nothing at all, a generic
 *  sentence. Never an empty string. */
export function apiErrorText(t, err) {
  const hit = apiErrorKey(err);
  if (hit) return t(hit.key, hit.vars);
  return messageOf(err).trim() || t("errors.unknown");
}
```

- [ ] **Step 4: The texts.** **Create** `dashboard/src/live/i18n/strings/errors.js`:

```js
// What an API refusal says, by key (live/apiErrors.js maps the server's texts onto these). TR is
// the source. The wording follows the old workspace's reviewed rbac.err texts (clinicalI18n.js),
// with the prototype's word for password ("şifre"/"şifrə") instead of the old "parola"/"parol".
// New here: passwordRequired. AZ/RU/EN need a native speaker's review before the pilot.
export default {
  tr: {
    noTenant: "Hesabınıza kurum tanımlanmamış. Sistem yöneticinizle görüşün.",
    membershipInactive: "Bu kurumdaki üyeliğiniz etkin değil. Sistem yöneticinizle görüşün.",
    platformOnly: "Bu işlem platform operatörü yetkisi gerektirir.",
    passwordChangeRequired: "Devam etmeden önce geçici şifrenizi değiştirin.",
    mfaRequired: "Bu işlem iki adımlı doğrulama gerektirir. Doğrulama kodunuzla yeniden giriş yapın.",
    mfaResetRequired: "Hesabınızda kayıtlı bir doğrulayıcı var. Cihazınızı kaybettiyseniz sistem yöneticinizden iki adımlı doğrulamayı sıfırlamasını isteyin.",
    notAuthenticated: "Oturumunuz doğrulanamadı; yeniden giriş yapın.",
    tokenVersion: "Yetkileriniz değişti; yeniden giriş yapın.",
    tenantChanged: "Kurum bilginiz değişti; yeniden giriş yapın.",
    totpLocked: "Çok fazla hatalı kod. 5 dakika sonra tekrar deneyin.",
    totpReplayed: "Bu kod zaten kullanıldı; yeni kodu bekleyin.",
    totpNotSetUp: "İki adımlı doğrulama henüz kurulmamış.",
    invalidTotp: "Kod doğru değil ya da süresi doldu.",
    invalidCredentials: "Kullanıcı adı veya şifre hatalı.",
    sessionExpired: "Oturum süresi doldu; yeniden giriş yapın.",
    directoryUnreachable: "Hastane dizin sunucusuna (Active Directory) ulaşılamıyor. Biraz sonra tekrar deneyin; sürerse bilgi işleme haber verin.",
    directoryNotConfigured: "Hastane dizini (Active Directory) bu kurulumda yapılandırılmamış.",
    directoryThrottled: "Çok fazla hatalı şifre denemesi. Hastane hesabınız kilitlenmesin diye 15 dakika sonra tekrar deneyin.",
    reauthRefused: "Şifre hatalı.",
    directoryPassword: "Şifreniz hastane hesabınızla (Active Directory) yönetiliyor; buradan değiştirilemez.",
    passwordTooShort: "Yeni şifre en az 8 karakter olmalı.",
    passwordUnchanged: "Yeni şifre mevcut şifreden farklı olmalı.",
    wrongCurrentPassword: "Mevcut şifre hatalı.",
    loginRequired: "Kullanıcı adınızı veya e-postanızı girin.",
    loginRateLimited: "Çok fazla giriş denemesi yapıldı. Bir dakika sonra tekrar deneyin.",
    sessionUnreachable: "Sunucuya şu an ulaşılamıyor; oturumunuz açık. Biraz sonra tekrar deneyin.",
    loginFailed: "Giriş başarısız.",
    requestTimeout: "Sunucu yanıt vermedi. İşlem gerçekleşmiş olabilir; kontrol edip gerekirse tekrar deneyin.",
    sessionSuperseded: "Bu istek önceki oturuma aitti; sonucu uygulanmadı.",
    requestFailed: "İstek başarısız ({status}).",
    network: "Sunucuya bağlanılamadı. Ağ bağlantınızı kontrol edin.",
    passwordTooLong: "Şifre en fazla 1024 karakter olabilir.",
    passwordRequired: "Şifrenizi girin.",
    unknown: "İşlem tamamlanamadı.",
  },
  az: {
    noTenant: "Hesabınıza qurum təyin edilməyib. Sistem administratorunuza müraciət edin.",
    membershipInactive: "Bu qurumdakı üzvlüyünüz aktiv deyil. Sistem administratorunuza müraciət edin.",
    platformOnly: "Bu əməliyyat üçün platforma operatoru səlahiyyəti tələb olunur.",
    passwordChangeRequired: "Davam etməzdən əvvəl müvəqqəti şifrənizi dəyişin.",
    mfaRequired: "Bu əməliyyat üçün iki addımlı doğrulama tələb olunur. Doğrulama kodunuzla yenidən daxil olun.",
    mfaResetRequired: "Hesabınızda qeydiyyatlı doğrulayıcı var. Cihazınızı itirmisinizsə, sistem administratorundan iki addımlı doğrulamanı sıfırlamasını xahiş edin.",
    notAuthenticated: "Sessiyanızı təsdiqləmək mümkün olmadı; yenidən daxil olun.",
    tokenVersion: "Səlahiyyətləriniz dəyişib; yenidən daxil olun.",
    tenantChanged: "Qurum məlumatlarınız dəyişib; yenidən daxil olun.",
    totpLocked: "Həddindən artıq yanlış kod. 5 dəqiqədən sonra yenidən cəhd edin.",
    totpReplayed: "Bu kod artıq istifadə olunub; növbəti kodu gözləyin.",
    totpNotSetUp: "İki addımlı doğrulama hələ quraşdırılmayıb.",
    invalidTotp: "Kod səhvdir və ya vaxtı bitib.",
    invalidCredentials: "İstifadəçi adı və ya şifrə səhvdir.",
    sessionExpired: "Sessiyanın müddəti bitib; yenidən daxil olun.",
    directoryUnreachable: "Xəstəxananın kataloq serverinə (Active Directory) qoşulmaq mümkün deyil. Bir az sonra yenidən cəhd edin; davam edərsə, İT şöbəsinə xəbər verin.",
    directoryNotConfigured: "Xəstəxana kataloqu (Active Directory) bu quraşdırmada konfiqurasiya edilməyib.",
    directoryThrottled: "Həddindən artıq yanlış şifrə cəhdi. Xəstəxana hesabınız bloklanmasın deyə 15 dəqiqədən sonra yenidən cəhd edin.",
    reauthRefused: "Şifrə səhvdir.",
    directoryPassword: "Şifrəniz xəstəxana hesabınızla (Active Directory) idarə olunur; burada dəyişdirilə bilməz.",
    passwordTooShort: "Yeni şifrə ən azı 8 simvol olmalıdır.",
    passwordUnchanged: "Yeni şifrə cari şifrədən fərqli olmalıdır.",
    wrongCurrentPassword: "Cari şifrə səhvdir.",
    loginRequired: "İstifadəçi adınızı və ya e-poçtunuzu daxil edin.",
    loginRateLimited: "Həddindən artıq giriş cəhdi edildi. Bir dəqiqədən sonra yenidən cəhd edin.",
    sessionUnreachable: "Server hazırda əlçatan deyil; sessiyanız açıq qalır. Bir az sonra yenidən cəhd edin.",
    loginFailed: "Giriş alınmadı.",
    requestTimeout: "Server cavab vermədi. Əməliyyat yerinə yetirilmiş ola bilər; yoxlayın və lazım olsa yenidən cəhd edin.",
    sessionSuperseded: "Bu sorğu əvvəlki sessiyaya aid idi; nəticəsi tətbiq edilmədi.",
    requestFailed: "Sorğu uğursuz oldu ({status}).",
    network: "Serverə qoşulmaq mümkün olmadı. Şəbəkə bağlantınızı yoxlayın.",
    passwordTooLong: "Şifrə ən çoxu 1024 simvol ola bilər.",
    passwordRequired: "Şifrənizi daxil edin.",
    unknown: "Əməliyyatı tamamlamaq mümkün olmadı.",
  },
  ru: {
    noTenant: "Вашей учётной записи не назначена организация. Обратитесь к системному администратору.",
    membershipInactive: "Ваше членство в этой организации неактивно. Обратитесь к системному администратору.",
    platformOnly: "Для этого действия нужны права оператора платформы.",
    passwordChangeRequired: "Прежде чем продолжить, смените временный пароль.",
    mfaRequired: "Для этого действия требуется двухэтапная проверка. Войдите снова с кодом подтверждения.",
    mfaResetRequired: "К вашей учётной записи уже привязан аутентификатор. Если устройство утеряно, попросите системного администратора сбросить двухэтапную проверку.",
    notAuthenticated: "Не удалось проверить сеанс; войдите снова.",
    tokenVersion: "Ваши права изменились; войдите снова.",
    tenantChanged: "Данные вашей организации изменились; войдите снова.",
    totpLocked: "Слишком много неверных кодов. Повторите попытку через 5 минут.",
    totpReplayed: "Этот код уже использован; дождитесь следующего.",
    totpNotSetUp: "Двухэтапная проверка ещё не настроена.",
    invalidTotp: "Код неверен или срок его действия истёк.",
    invalidCredentials: "Неверное имя пользователя или пароль.",
    sessionExpired: "Срок сеанса истёк; войдите снова.",
    directoryUnreachable: "Сервер каталога больницы (Active Directory) недоступен. Повторите попытку позже; если не пройдёт — сообщите в ИТ-отдел.",
    directoryNotConfigured: "Каталог больницы (Active Directory) в этой установке не настроен.",
    directoryThrottled: "Слишком много неверных попыток ввода пароля. Чтобы больничная учётная запись не была заблокирована, повторите попытку через 15 минут.",
    reauthRefused: "Неверный пароль.",
    directoryPassword: "Пароль управляется больничной учётной записью (Active Directory); здесь его изменить нельзя.",
    passwordTooShort: "Новый пароль должен содержать не менее 8 символов.",
    passwordUnchanged: "Новый пароль должен отличаться от текущего.",
    wrongCurrentPassword: "Текущий пароль неверен.",
    loginRequired: "Введите имя пользователя или эл. почту.",
    loginRateLimited: "Слишком много попыток входа. Повторите попытку через минуту.",
    sessionUnreachable: "Сервер сейчас недоступен; ваш сеанс сохранён. Повторите попытку позже.",
    loginFailed: "Не удалось войти.",
    requestTimeout: "Сервер не ответил. Действие могло быть выполнено: проверьте и при необходимости повторите.",
    sessionSuperseded: "Этот запрос относился к предыдущему сеансу; его результат не применён.",
    requestFailed: "Запрос не выполнен ({status}).",
    network: "Не удалось подключиться к серверу. Проверьте сетевое подключение.",
    passwordTooLong: "Пароль может содержать не более 1024 символов.",
    passwordRequired: "Введите пароль.",
    unknown: "Не удалось выполнить действие.",
  },
  en: {
    noTenant: "No organization is assigned to your account. Contact your system administrator.",
    membershipInactive: "Your membership in this organization is not active. Contact your system administrator.",
    platformOnly: "This action requires platform operator rights.",
    passwordChangeRequired: "Change your temporary password before you continue.",
    mfaRequired: "This action requires two-step verification. Sign in again with your verification code.",
    mfaResetRequired: "An authenticator is already registered to your account. If you lost the device, ask your system administrator to reset two-step verification.",
    notAuthenticated: "Your session could not be verified; please sign in again.",
    tokenVersion: "Your permissions have changed; please sign in again.",
    tenantChanged: "Your organization details have changed; please sign in again.",
    totpLocked: "Too many incorrect codes. Try again in 5 minutes.",
    totpReplayed: "This code has already been used; wait for the next one.",
    totpNotSetUp: "Two-step verification is not set up yet.",
    invalidTotp: "The code is wrong or has expired.",
    invalidCredentials: "Incorrect username or password.",
    sessionExpired: "Your session has expired; please sign in again.",
    directoryUnreachable: "The hospital directory server (Active Directory) cannot be reached. Try again shortly; if it persists, tell IT.",
    directoryNotConfigured: "The hospital directory (Active Directory) is not configured for this installation.",
    directoryThrottled: "Too many incorrect password attempts. So that your hospital account is not locked, try again in 15 minutes.",
    reauthRefused: "Incorrect password.",
    directoryPassword: "Your password is managed by your hospital account (Active Directory) and cannot be changed here.",
    passwordTooShort: "The new password must be at least 8 characters.",
    passwordUnchanged: "The new password must differ from the current one.",
    wrongCurrentPassword: "The current password is incorrect.",
    loginRequired: "Enter your username or email.",
    loginRateLimited: "Too many sign-in attempts. Try again in a minute.",
    sessionUnreachable: "The server cannot be reached right now; your session is kept. Try again shortly.",
    loginFailed: "Sign-in failed.",
    requestTimeout: "The server did not answer. The action may have gone through: check, and try again if needed.",
    sessionSuperseded: "This request belonged to an earlier session; its answer was not applied.",
    requestFailed: "The request failed ({status}).",
    network: "Could not connect to the server. Check your network connection.",
    passwordTooLong: "The password can be at most 1024 characters.",
    passwordRequired: "Enter your password.",
    unknown: "The action could not be completed.",
  },
};
```

**In** `dashboard/src/live/i18n/catalog.js` **replace:**

```js
import ui from "./strings/ui.js";

export const NAMESPACES = { common, risk, prefs, news2, gallery, ui };
```
**with:**
```js
import ui from "./strings/ui.js";
import errors from "./strings/errors.js";

export const NAMESPACES = {
  common, risk, prefs, news2, gallery, ui, errors,
};
```

- [ ] **Step 5: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  66 passed (66)`, `Tests  1378 passed (1378)` (the 32 messages read from the sources are one test each), `✓ built in …`. `strings.test.js` already holds the new namespace to the four languages and the Turkish placeholders; no Azerbaijani text in it equals its Turkish source.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/apiErrors.js dashboard/src/live/apiErrors.test.js dashboard/src/live/i18n/strings/errors.js dashboard/src/live/i18n/catalog.js
git commit -m "feat(live-ui): every refusal of the sign-in surface in four languages

apiErrors maps the API's and nginx's texts and the client's codes to an
errors.* key; the test reads auth/*.py, nginx.conf and backendApi.js as
text, so a new server message fails until it is translated.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Dates the prototype's way

**Files:**
- Create: `dashboard/src/live/i18n/dates.js`, `dashboard/src/live/i18n/strings/dates.js`
- Modify: `dashboard/src/live/i18n/catalog.js`
- Test: `dashboard/src/live/i18n/dates.test.js`

- [ ] **Step 1: Write the failing test.** **Create** `dashboard/src/live/i18n/dates.test.js`:

```js
import { describe, it, expect } from "vitest";
import { ddmm, ddmmyyyy, hhmm, weekdayKey } from "./dates.js";
import { DICTIONARIES } from "./catalog.js";

// A local-time moment: 4 October 2026 is a Sunday.
const SUNDAY_EVENING = new Date(2026, 9, 4, 21, 5).getTime();

describe("the shell's dates", () => {
  it("writes 24-hour HH:MM, dd.MM and dd.MM.yyyy, zero-padded", () => {
    expect(hhmm(SUNDAY_EVENING)).toBe("21:05");
    expect(hhmm(new Date(2026, 0, 2, 7, 3).getTime())).toBe("07:03");
    expect(ddmm(SUNDAY_EVENING)).toBe("04.10");
    expect(ddmmyyyy(SUNDAY_EVENING)).toBe("04.10.2026");
  });

  it("names the weekday from the dictionary, in each language", () => {
    expect(weekdayKey(SUNDAY_EVENING)).toBe("dates.wd0");
    expect(DICTIONARIES.az["dates.wd0"]).toBe("B.");
    expect(DICTIONARIES.tr["dates.wd1"]).toBe("Pzt");
    expect(DICTIONARIES.ru["dates.wd6"]).toBe("Сб");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/i18n/dates.test.js 2>&1 | grep -E "Error|Tests "
```
Expected: `Failed to resolve import "./dates.js"`.

- [ ] **Step 3: Implement.** **Create** `dashboard/src/live/i18n/dates.js`:

```js
// src/live/i18n/dates.js — the clock's and the lock screen's dates, written the prototype's way
// (core.js H.now / H.dm / H.wd): 24-hour HH:MM, dd.MM, and the weekday from the dictionary.
// Not Intl: a browser built with a reduced locale set (a headless or kiosk Chrome) answers an
// Azerbaijani request in English ("Sun"), and a ward screen must not switch language by itself.
// The browser's local time zone, which on the ward PCs is the hospital's.
export const pad2 = (n) => String(n).padStart(2, "0");

export function hhmm(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function ddmm(ms) {
  const d = new Date(ms);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`;
}

export function ddmmyyyy(ms) {
  return `${ddmm(ms)}.${new Date(ms).getFullYear()}`;
}

/** The weekday's key in the `dates` namespace: dates.wd0 (Sunday) … dates.wd6. */
export const weekdayKey = (ms) => `dates.wd${new Date(ms).getDay()}`;
```

**Create** `dashboard/src/live/i18n/strings/dates.js`:

```js
// Short weekday names, Sunday first (Date.getDay()). The prototype's dictionary (core.js WD).
export default {
  tr: { wd0: "Paz", wd1: "Pzt", wd2: "Sal", wd3: "Çar", wd4: "Per", wd5: "Cum", wd6: "Cmt" },
  az: { wd0: "B.", wd1: "B.e.", wd2: "Ç.a.", wd3: "Ç.", wd4: "C.a.", wd5: "C.", wd6: "Ş." },
  ru: { wd0: "Вс", wd1: "Пн", wd2: "Вт", wd3: "Ср", wd4: "Чт", wd5: "Пт", wd6: "Сб" },
  en: { wd0: "Sun", wd1: "Mon", wd2: "Tue", wd3: "Wed", wd4: "Thu", wd5: "Fri", wd6: "Sat" },
};
```

**In** `dashboard/src/live/i18n/catalog.js` **replace:**

```js
import errors from "./strings/errors.js";
```
**with:**
```js
import errors from "./strings/errors.js";
import dates from "./strings/dates.js";
```

**In** `dashboard/src/live/i18n/catalog.js` **replace:**

```js
  common, risk, prefs, news2, gallery, ui, errors,
```
**with:**
```js
  common, risk, prefs, news2, gallery, ui, errors, dates,
```

- [ ] **Step 4: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  67 passed (67)`, `Tests  1380 passed (1380)`, `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/i18n/dates.js dashboard/src/live/i18n/dates.test.js dashboard/src/live/i18n/strings/dates.js dashboard/src/live/i18n/catalog.js
git commit -m "feat(live-ui): HH:MM, dd.MM and the weekday from the dictionary

Not Intl: a reduced-locale browser answers an Azerbaijani request in English.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: What the browser keeps — the lock, the last activity, the remembered username

**Files:**
- Create: `dashboard/src/live/session/browserState.js`
- Test: `dashboard/src/live/session/browserState.test.js`

- [ ] **Step 1: Write the failing test.** **Create** `dashboard/src/live/session/browserState.test.js`:

```js
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  LOCK_KEY, REMEMBER_KEY, clearLock, forgetUser, parseLock, readActiveAt, readLock,
  readRememberedUser, rememberUser, writeActiveAt, writeLock,
} from "./browserState.js";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("the lock this browser keeps", () => {
  it("round-trips, and clears", () => {
    writeLock({ user: "u-1", at: 1_700_000_000_000, why: "idle" });
    expect(readLock()).toEqual({ user: "u-1", at: 1_700_000_000_000, why: "idle" });
    clearLock();
    expect(readLock()).toBeNull();
    expect(localStorage.getItem(LOCK_KEY)).toBeNull();
  });

  it.each(["", "{}", "null", "kilit", '{"user":"","at":1,"why":"idle"}', '{"user":"u","at":"dün","why":"idle"}',
    '{"user":"u","at":1,"why":"tired"}'])("reads %j as no lock", (raw) => {
    expect(parseLock(raw)).toBeNull();
  });

  it("answers no lock, and writes nothing, when storage refuses", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("SecurityError"); });
    expect(() => writeLock({ user: "u", at: 1, why: "manual" })).not.toThrow();
    expect(readLock()).toBeNull();
  });
});

describe("the last activity in any tab", () => {
  it("is a time, or nothing", () => {
    expect(readActiveAt()).toBeNull();
    writeActiveAt(1_700_000_000_123);
    expect(readActiveAt()).toBe(1_700_000_000_123);
    localStorage.setItem("hmc.activeAt", "dün");
    expect(readActiveAt()).toBeNull();
  });
});

describe("remember my username", () => {
  it("keeps the name and only the name; forgetting removes it", () => {
    rememberUser("ayse");
    expect(readRememberedUser()).toBe("ayse");
    expect(Object.keys(localStorage)).toEqual([REMEMBER_KEY]);
    forgetUser();
    expect(readRememberedUser()).toBe("");
    expect(localStorage.getItem(REMEMBER_KEY)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/session/ 2>&1 | grep -E "Error|Tests "
```
Expected: `Failed to resolve import "./browserState.js"`.

- [ ] **Step 3: Implement.** **Create** `dashboard/src/live/session/browserState.js`:

```js
// src/live/session/browserState.js — what the live UI keeps in this browser about a session.
//
// None of it is secret, and none of it opens anything by itself:
//   hmc.lock          {user, at, why}: this browser's screen is locked for that user. Shared by
//                     every tab, so a reload or a new tab opens on the lock screen too — otherwise
//                     either would walk past it with the tokens the browser still holds.
//   hmc.activeAt      when someone last pressed a key, clicked or touched in ANY tab (epoch ms):
//                     a tab in the background must not lock the one in use.
//   hmc.rememberUser  the username "remember my username" keeps — never a password; it fills
//                     the field and opens nothing (roadmap: loginRemember).
// Storage may be refused (a private window, blocked site data): reads answer "nothing", writes
// do nothing, and the UI goes on. The tokens themselves are backendApi.js's business.
export const LOCK_KEY = "hmc.lock";
export const ACTIVE_KEY = "hmc.activeAt";
export const REMEMBER_KEY = "hmc.rememberUser";
export const LOCK_REASONS = Object.freeze(["idle", "manual"]);

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(key) {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) storage()?.removeItem(key);
    else storage()?.setItem(key, value);
  } catch {
    // refused: holds for this page only
  }
}

/** The lock, or null. A value that is not a lock (junk, an older build's) is no lock. */
export function parseLock(raw) {
  try {
    const lock = JSON.parse(raw);
    if (lock && typeof lock.user === "string" && lock.user && Number.isFinite(lock.at)
        && LOCK_REASONS.includes(lock.why)) {
      return { user: lock.user, at: lock.at, why: lock.why };
    }
  } catch {
    // not JSON
  }
  return null;
}

export const readLock = () => parseLock(read(LOCK_KEY));
export const writeLock = (lock) => write(LOCK_KEY, JSON.stringify(lock));
export const clearLock = () => write(LOCK_KEY, null);

export function readActiveAt() {
  const at = Number(read(ACTIVE_KEY));
  return Number.isFinite(at) && at > 0 ? at : null;
}
export const writeActiveAt = (at) => write(ACTIVE_KEY, String(at));

export const readRememberedUser = () => read(REMEMBER_KEY) || "";
export const rememberUser = (username) => write(REMEMBER_KEY, username || null);
export const forgetUser = () => write(REMEMBER_KEY, null);
```

- [ ] **Step 4: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  68 passed (68)`, `Tests  1391 passed (1391)`, `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/session/browserState.js dashboard/src/live/session/browserState.test.js
git commit -m "feat(live-ui): the lock, the last activity and the remembered username, per browser

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: The session store

**Files:**
- Create: `dashboard/src/live/session/sessionStore.js`, `dashboard/src/live/session/SessionProvider.jsx`, `dashboard/src/live/session/testTokens.testutil.js`
- Test: `dashboard/src/live/session/sessionStore.test.js`

- [ ] **Step 1: The test helpers.** **Create** `dashboard/src/live/session/testTokens.testutil.js`:

```js
// Test-only: an access token the way the API shapes it (auth/service.py `issue_tokens`), unsigned —
// liveAuth.js reads claims for display and gating only, the server checks the signature. Synthetic.
function b64url(obj) {
  let binary = "";
  for (const byte of new TextEncoder().encode(JSON.stringify(obj))) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function token({
  sub = "u-ayse", tenant = "demo-hastanesi", groups = ["nurse"], perms = ["board.view", "alerts.ack"],
  mfaRequired = false, mfaVerified = false, tv = 0,
} = {}) {
  const claims = { sub, type: "access", tenant, groups, perms, mfa_required: mfaRequired, mfa_verified: mfaVerified, tv };
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.signature`;
}

/** The /auth/me answer for a synthetic nurse, with overrides. */
export function profile(over = {}) {
  return {
    id: "u-ayse", username: "ayse", email: "ayse@example.com", full_name: "Ayşe Sentetik",
    auth_source: "local", totp_enabled: false, is_active: true, created_at: "2026-10-01T08:00:00Z",
    tenant: "demo-hastanesi", tenant_name: "Sentetik Hastane",
    groups: [{ slug: "nurse", name: "Hemşire" }], perms: ["alerts.ack", "board.view"],
    must_change_password: false, lock_idle_minutes: 10, lock_signout_hours: 12, ...over,
  };
}

/** A backendApi stand-in: one stored access token, every call a vi.fn the test sets up. */
export function fakeApi(vi, { access = null } = {}) {
  let stored = access;
  const api = {
    accessToken: vi.fn(() => stored),
    logout: vi.fn(() => { stored = null; }),
    forget: vi.fn(),
    login: vi.fn(),
    verifyTotp: vi.fn(),
    setupTotp: vi.fn(),
    me: vi.fn(),
    changePassword: vi.fn(),
    reauth: vi.fn(),
    boardPatients: vi.fn(),
    streamTicket: vi.fn(),
    /** What the API's own token handling would do: store a new pair. */
    store(next) { stored = next; },
  };
  return api;
}
```

- [ ] **Step 2: Write the failing test.** **Create** `dashboard/src/live/session/sessionStore.test.js`:

```js
import { describe, it, expect, vi, afterEach } from "vitest";
import { FALLBACK_LOCK_SIGNOUT_HOURS, NOTICE, PHASE, UNLOCK_ATTEMPTS, createSessionStore } from "./sessionStore.js";
import { LOCK_KEY, readLock, writeLock } from "./browserState.js";
import { fakeApi, profile, token } from "./testTokens.testutil.js";

const NURSE = token();
const PENDING = token({ sub: "u-kaya", groups: ["attending"], perms: ["board.view"], mfaRequired: true });
const VERIFIED = token({ sub: "u-kaya", groups: ["attending"], perms: ["board.view"], mfaRequired: true, mfaVerified: true });

function refusal(status, message = "x", extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

/** A store on a fake API; `events` is a private EventTarget standing in for window; `timers`
 *  holds what the store scheduled (the end of a long lock). */
function setup({ access = null, canEnter = () => true, now = () => NOW } = {}) {
  const api = fakeApi(vi, { access });
  const events = new EventTarget();
  const timers = [];
  const store = createSessionStore({
    api, canEnter, events, now,
    setTimer: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length - 1; },
    clearTimer: (id) => { timers[id].cleared = true; },
  });
  return { api, store, events, timers, state: () => store.getState() };
}

function storageEvent(events, key, newValue) {
  const event = new Event("storage");
  Object.assign(event, { key, newValue });
  events.dispatchEvent(event);
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("restoring a stored session (a page load)", () => {
  it("with nothing stored, stays on the form and asks the API nothing", async () => {
    const { api, store, state } = setup();
    await store.restore();
    expect(state().phase).toBe(PHASE.SIGNED_OUT);
    expect(api.me).not.toHaveBeenCalled();
  });

  it("opens the shell with the profile and the token's rights", async () => {
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockResolvedValue(profile());
    const seen = [];
    store.subscribe(() => seen.push(store.getState().phase));
    await store.restore();
    expect(seen[0]).toBe(PHASE.RESTORING);
    expect(state().phase).toBe(PHASE.READY);
    expect(state().user).toEqual({
      id: "u-ayse", username: "ayse", fullName: "Ayşe Sentetik", email: "ayse@example.com",
      authSource: "local", tenant: "demo-hastanesi", tenantName: "Sentetik Hastane",
      groups: [{ slug: "nurse", name: "Hemşire" }], perms: ["board.view", "alerts.ack"],
      totpEnabled: false, lockIdleMinutes: 10, lockSignoutHours: 12,
    });
  });

  it("locks, and ends a long lock, when the server does not say how long (an older API)", async () => {
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockResolvedValue(profile({ lock_idle_minutes: undefined, lock_signout_hours: undefined }));
    await store.restore();
    expect(state().user.lockIdleMinutes).toBe(10);
    expect(state().user.lockSignoutHours).toBe(FALLBACK_LOCK_SIGNOUT_HOURS);
  });

  it("drops a session the server refuses, quietly", async () => {
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockRejectedValue(refusal(401, "Oturum süresi doldu, tekrar giriş yapın.", { sessionEnded: true }));
    await store.restore();
    expect(state().phase).toBe(PHASE.SIGNED_OUT);
    expect(state().notice).toBeNull();
    expect(api.logout).toHaveBeenCalled();
  });

  it("keeps the tokens when the server does not answer, and retries", async () => {
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockRejectedValueOnce(refusal(503, "upstream")).mockResolvedValueOnce(profile());
    await store.restore();
    expect(state().phase).toBe(PHASE.UNREACHABLE);
    expect(state().error.status).toBe(503);
    expect(api.logout).not.toHaveBeenCalled();
    await store.retry();
    expect(state().phase).toBe(PHASE.READY);
  });

  it("goes back to the TOTP step for a session that has not passed it", async () => {
    const { api, store, state } = setup({ access: PENDING });
    api.me.mockResolvedValue(profile({ id: "u-kaya", totp_enabled: true }));
    await store.restore();
    expect(state().phase).toBe(PHASE.MFA);
    expect(state().mfa).toEqual({ enrolled: true });
  });

  it("goes to the password change while a temporary password is in use", async () => {
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockResolvedValue(profile({ must_change_password: true }));
    await store.restore();
    expect(state().phase).toBe(PHASE.PASSWORD);
  });

  it("opens on the lock screen when this browser is locked for this user — a reload does not pass it", async () => {
    writeLock({ user: "u-ayse", at: 1_699_999_000_000, why: "idle" });
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockResolvedValue(profile());
    await store.restore();
    expect(state().phase).toBe(PHASE.LOCKED);
    expect(state().lock).toEqual({ at: 1_699_999_000_000, why: "idle" });
  });

  it("signs out a browser that has been locked longer than the hospital allows", async () => {
    writeLock({ user: "u-ayse", at: NOW - 3 * HOUR - 1, why: "idle" });
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockResolvedValue(profile({ lock_signout_hours: 3 }));
    await store.restore();
    expect(state()).toMatchObject({ phase: PHASE.SIGNED_OUT, user: null, notice: { code: NOTICE.LOCK_EXPIRED } });
    expect(api.logout).toHaveBeenCalled();
    expect(readLock()).toBeNull();
  });

  it("ignores, and clears, a lock left for another account", async () => {
    writeLock({ user: "u-baskasi", at: 1, why: "manual" });
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockResolvedValue(profile());
    await store.restore();
    expect(state().phase).toBe(PHASE.READY);
    expect(readLock()).toBeNull();
  });
});

describe("signing in", () => {
  it("changes nothing in this browser for a refused sign-in: no remembered name, the lock stays", async () => {
    localStorage.setItem("hmc.rememberUser", "ayse");
    writeLock({ user: "u-ayse", at: NOW, why: "manual" });
    const { api, store } = setup();
    api.login.mockRejectedValue(refusal(401, "Invalid credentials"));
    await expect(store.signIn("yabanci", "tahmin", { remember: true })).rejects.toThrow();
    await expect(store.signIn("yabanci", "tahmin", { remember: false })).rejects.toThrow();
    expect(localStorage.getItem("hmc.rememberUser")).toBe("ayse");
    expect(readLock()).toEqual({ user: "u-ayse", at: NOW, why: "manual" });
  });

  it("remembers the username when asked, and only the username", async () => {
    const { api, store } = setup();
    api.login.mockImplementation(async () => { api.store(NURSE); return { access_token: NURSE, requires_mfa: false }; });
    api.me.mockResolvedValue(profile());
    await store.signIn(" ayse ", "Gizli-Sifre-1", { remember: true });
    expect(localStorage.getItem("hmc.rememberUser")).toBe("ayse");
    expect(Object.values(localStorage).join(" ")).not.toContain("Gizli-Sifre-1");
    await store.signIn("ayse", "Gizli-Sifre-1", { remember: false });
    expect(localStorage.getItem("hmc.rememberUser")).toBeNull();
  });

  it("goes through the TOTP step, then into the shell", async () => {
    const { api, store, state } = setup();
    api.login.mockImplementation(async () => { api.store(PENDING); return { access_token: PENDING, requires_mfa: true, mfa_enrolled: false }; });
    api.me.mockResolvedValue(profile({ id: "u-kaya", totp_enabled: false }));
    await store.signIn("dr.kaya", "x");
    expect(state().phase).toBe(PHASE.MFA);
    expect(state().mfa).toEqual({ enrolled: false });
    api.verifyTotp.mockImplementation(async () => { api.store(VERIFIED); return { access_token: VERIFIED }; });
    await store.verifyMfa(" 123456 ");
    expect(api.verifyTotp).toHaveBeenCalledWith("123456");
    expect(state().phase).toBe(PHASE.READY);
  });

  it("keeps count of the steps: the TOTP one still counts at the password change after it", async () => {
    const { api, store, state } = setup();
    api.login.mockImplementation(async () => { api.store(PENDING); return { access_token: PENDING, requires_mfa: true }; });
    api.me.mockResolvedValueOnce(profile({ id: "u-kaya", must_change_password: true }))
      .mockResolvedValueOnce(profile({ id: "u-kaya", must_change_password: true }));
    await store.signIn("dr.kaya", "Gecici-1");
    expect(state()).toMatchObject({ phase: PHASE.MFA, steps: { mfa: true, password: true } });
    api.verifyTotp.mockImplementation(async () => { api.store(VERIFIED); return { access_token: VERIFIED }; });
    await store.verifyMfa("123456");
    expect(state()).toMatchObject({ phase: PHASE.PASSWORD, steps: { mfa: true, password: true } });
    store.signOut();
    expect(state().steps).toEqual({ mfa: false, password: false });
  });

  it("goes through the forced password change, then into the shell", async () => {
    const { api, store, state } = setup();
    api.login.mockImplementation(async () => { api.store(NURSE); return { access_token: NURSE, password_change_required: true }; });
    api.me.mockResolvedValueOnce(profile({ must_change_password: true })).mockResolvedValueOnce(profile());
    await store.signIn("ayse", "Gecici-1");
    expect(state().phase).toBe(PHASE.PASSWORD);
    api.changePassword.mockResolvedValue({ access_token: NURSE });
    await store.changePassword("Gecici-1", "Kendi-Sifrem-9");
    expect(api.changePassword).toHaveBeenCalledWith("Gecici-1", "Kendi-Sifrem-9");
    expect(state().phase).toBe(PHASE.READY);
  });

  it("refuses an account with no rights, before any step, and says why", async () => {
    const empty = token({ perms: [], groups: [] });
    const { api, store, state } = setup();
    api.login.mockImplementation(async () => { api.store(empty); return { access_token: empty }; });
    await store.signIn("bos", "x");
    expect(state().phase).toBe(PHASE.SIGNED_OUT);
    expect(state().notice).toEqual({ code: NOTICE.NO_PERMISSIONS });
    expect(api.logout).toHaveBeenCalled();
    expect(api.me).not.toHaveBeenCalled();
  });

  it("refuses rights no screen of the live UI uses (a biomedical account, until Group 4)", async () => {
    const devices = token({ perms: ["devices.manage"], groups: ["biomedical"] });
    const { api, store, state } = setup({ canEnter: (perms) => perms.includes("board.view") });
    api.login.mockImplementation(async () => { api.store(devices); return { access_token: devices }; });
    await store.signIn("biomed", "x");
    expect(state().notice).toEqual({ code: NOTICE.NO_SCREEN });
  });

  it("rejects with the API's error and stays on the form", async () => {
    const { api, store, state } = setup();
    api.login.mockRejectedValue(refusal(401, "Invalid credentials"));
    await expect(store.signIn("ayse", "yanlis")).rejects.toThrow("Invalid credentials");
    expect(state().phase).toBe(PHASE.SIGNED_OUT);
  });

  it("drops a profile that arrives after the session was given up", async () => {
    const { api, store, state } = setup();
    let answer;
    api.login.mockImplementation(async () => { api.store(NURSE); return { access_token: NURSE }; });
    api.me.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const pending = store.signIn("ayse", "x");
    await vi.waitFor(() => expect(api.me).toHaveBeenCalled());
    store.signOut();
    answer(profile());
    await pending;
    expect(state().phase).toBe(PHASE.SIGNED_OUT);
    expect(state().user).toBeNull();
  });
});

describe("signing out", () => {
  it("drops the tokens, the user and this browser's lock, and says so", async () => {
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockResolvedValue(profile());
    await store.restore();
    store.lock();
    store.signOut();
    expect(state()).toMatchObject({ phase: PHASE.SIGNED_OUT, user: null, lock: null, notice: { code: NOTICE.SIGNED_OUT } });
    expect(api.logout).toHaveBeenCalled();
    expect(readLock()).toBeNull();
  });

  it("backing out of a step ends the session with no message", async () => {
    const { api, store, state } = setup({ access: PENDING });
    api.me.mockResolvedValue(profile({ id: "u-kaya" }));
    await store.restore();
    store.cancel();
    expect(state()).toMatchObject({ phase: PHASE.SIGNED_OUT, notice: null });
  });

  it("ends a session the server refused during any tracked call", async () => {
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockResolvedValue(profile());
    await store.restore();
    await expect(store.track(() => Promise.reject(refusal(401, "x", { sessionEnded: true })))).rejects.toThrow();
    expect(state().notice).toEqual({ code: NOTICE.SESSION_ENDED });
  });

  it("takes an open shell to the password step when an administrator has just reset the password", async () => {
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockResolvedValue(profile());
    await store.restore();
    await expect(store.track(() => Promise.reject(refusal(403, "password_change_required")))).rejects.toThrow();
    expect(state()).toMatchObject({ phase: PHASE.PASSWORD, steps: { mfa: false, password: true } });
    expect(api.logout).not.toHaveBeenCalled();
    store.lock();                                                       // no lock from the step
    expect(state().phase).toBe(PHASE.PASSWORD);
  });
});

describe("the lock", () => {
  async function ready() {
    const s = setup({ access: NURSE });
    s.api.me.mockResolvedValue(profile());
    await s.store.restore();
    return s;
  }

  it("locks the browser for this user and unlocks with the password", async () => {
    const { api, store, state } = await ready();
    store.lock("idle");
    expect(state()).toMatchObject({ phase: PHASE.LOCKED, lock: { at: NOW, why: "idle" } });
    expect(readLock()).toEqual({ user: "u-ayse", at: NOW, why: "idle" });
    api.reauth.mockResolvedValue({ ok: true });
    await store.unlock("Gizli-Sifre-1");
    expect(api.reauth).toHaveBeenCalledWith("Gizli-Sifre-1");
    expect(state()).toMatchObject({ phase: PHASE.READY, lock: null });
    expect(readLock()).toBeNull();
  });

  it("signs out when the lock lasts the hospital's hours, and forgets the timer when unlocked", async () => {
    const { api, store, timers, state } = await ready();
    store.lock("idle");
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(12 * HOUR);
    api.reauth.mockResolvedValue({ ok: true });
    await store.unlock("Gizli-Sifre-1");
    expect(timers[0].cleared).toBe(true);
    store.lock("manual");
    timers[1].fn();
    expect(state()).toMatchObject({ phase: PHASE.SIGNED_OUT, notice: { code: NOTICE.LOCK_EXPIRED } });
    expect(api.logout).toHaveBeenCalled();
  });

  it(`signs out after ${UNLOCK_ATTEMPTS} wrong passwords`, async () => {
    const { api, store, state } = await ready();
    store.lock();
    api.reauth.mockRejectedValue(refusal(403, "Parola hatalı"));
    for (let i = 1; i < UNLOCK_ATTEMPTS; i += 1) {
      await expect(store.unlock("yanlis")).rejects.toThrow("Parola hatalı");
      expect(state()).toMatchObject({ phase: PHASE.LOCKED, unlockFailures: i });
    }
    await expect(store.unlock("yanlis")).rejects.toThrow();
    expect(state()).toMatchObject({ phase: PHASE.SIGNED_OUT, notice: { code: NOTICE.LOCKED_OUT } });
    expect(api.logout).toHaveBeenCalled();
  });

  it("stays locked, counting nothing, when the server cannot check (429, 503, no network)", async () => {
    const { api, store, state } = await ready();
    store.lock();
    for (const err of [refusal(429, "Çok fazla hatalı deneme; 15 dakika sonra tekrar deneyin"),
      refusal(503, "Dizin sunucusuna ulaşılamıyor"), new Error("Failed to fetch")]) {
      api.reauth.mockRejectedValueOnce(err);
      await expect(store.unlock("Gizli")).rejects.toBe(err);
      expect(state()).toMatchObject({ phase: PHASE.LOCKED, unlockFailures: 0 });
    }
  });

  it.each([[401, "Invalid credentials"], [403, "Bu kurumdaki üyeliğiniz etkin değil"]])(
    "ends the session when the server says it is over (%i %s)", async (status, message) => {
      const { api, store, state } = await ready();
      store.lock();
      api.reauth.mockRejectedValue(refusal(status, message));
      await expect(store.unlock("Gizli")).rejects.toThrow();
      expect(state().notice).toEqual({ code: NOTICE.SESSION_ENDED });
    });
});

describe("rights follow the token", () => {
  it("re-reads the rights after a call that brought a refreshed token", async () => {
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockResolvedValue(profile());
    await store.restore();
    const wider = token({ groups: ["nurse", "charge_nurse"], perms: ["board.view", "alerts.ack", "shifts.manage"] });
    await store.track(async () => { api.store(wider); return null; });
    expect(state().user.perms).toEqual(["board.view", "alerts.ack", "shifts.manage"]);
    expect(state().user.groups).toEqual([{ slug: "nurse", name: "Hemşire" }, { slug: "charge_nurse", name: "charge_nurse" }]);
  });
});

describe("other tabs of this browser", () => {
  async function ready() {
    const s = setup({ access: NURSE });
    s.api.me.mockResolvedValue(profile());
    await s.store.restore();
    return s;
  }

  it("signs out here when another tab signed out, without touching storage again", async () => {
    const { api, store, events, state } = await ready();
    api.store(null);
    storageEvent(events, "homunculus-access-token", null);
    expect(state()).toMatchObject({ phase: PHASE.SIGNED_OUT, notice: { code: NOTICE.ELSEWHERE } });
    expect(api.forget).toHaveBeenCalled();
    expect(api.logout).not.toHaveBeenCalled();
    store.dispose();
  });

  it("opens the session another tab signed in to", async () => {
    const { api, store, events, state } = await ready();
    const other = token({ sub: "u-murad" });
    api.me.mockResolvedValue(profile({ id: "u-murad", username: "murad" }));
    api.store(other);
    storageEvent(events, "homunculus-access-token", other);
    await vi.waitFor(() => expect(state().user?.username).toBe("murad"));
    store.dispose();
  });

  it("locks with another tab, and unlocks when it is unlocked there", async () => {
    const { events, state } = await ready();
    storageEvent(events, LOCK_KEY, JSON.stringify({ user: "u-ayse", at: NOW - 5, why: "manual" }));
    expect(state()).toMatchObject({ phase: PHASE.LOCKED, lock: { at: NOW - 5, why: "manual" } });
    storageEvent(events, LOCK_KEY, null);
    expect(state().phase).toBe(PHASE.READY);
  });

  it("moves on from the TOTP step when the same account passed it in another tab", async () => {
    const s = setup({ access: PENDING });
    s.api.me.mockResolvedValue(profile({ id: "u-kaya", totp_enabled: true }));
    await s.store.restore();
    expect(s.state().phase).toBe(PHASE.MFA);
    s.api.store(VERIFIED);
    storageEvent(s.events, "homunculus-access-token", VERIFIED);
    await vi.waitFor(() => expect(s.state().phase).toBe(PHASE.READY));
    s.store.dispose();
  });

  it("does not lock for another account's lock", async () => {
    const { events, state } = await ready();
    storageEvent(events, LOCK_KEY, JSON.stringify({ user: "u-baskasi", at: 5, why: "manual" }));
    expect(state().phase).toBe(PHASE.READY);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/session/sessionStore.test.js 2>&1 | grep -E "Error|Tests "
```
Expected: `Failed to resolve import "./sessionStore.js"`.

- [ ] **Step 4: Implement.** **Create** `dashboard/src/live/session/sessionStore.js`:

```js
// src/live/session/sessionStore.js — the live UI's session: who is signed in, and what the screen
// may show now. Framework-free; React reads it through SessionProvider.jsx.
//
// It talks to the real API only (backendApi.js) and never to the simulation: roadmap D1 — the
// new shell does not rest on the demo store. One phase at a time:
//
//   restoring    a stored session is being checked (a page load): no form yet, it would race it
//   signedOut    the sign-in form; `notice` says why it opened, when it matters
//   unreachable  a stored session could not be checked — the server did not answer. The tokens
//                are kept (an outage never signs a clinician out); retry, or sign out
//   mfa          the TOTP step: enrolment first when the account has no authenticator
//   password     a temporary password must be replaced (after the TOTP step)
//   ready        the shell
//   locked       the lock screen: the session lives, nothing of it is on the screen — for at most
//                the hospital's SCREEN_LOCK_SIGNOUT_HOURS, then the browser signs itself out
//
// Ending a session — any way it ends — empties everything it loaded (main's behaviour on a
// shared ward workstation, liveStore.js `endSession`), and an answer that arrives after it
// ended, or after another began, is dropped (`epoch`).
import { decodeJwtPayload, secretFromProvisioningUri, sessionFromToken } from "../../liveAuth.js";
import { TOKEN_KEYS } from "../../backendApi.js";
import { LOCK_KEY, clearLock, forgetUser, parseLock, readLock, rememberUser, writeLock } from "./browserState.js";
import { apiErrorKey } from "../apiErrors.js";

export const PHASE = Object.freeze({
  RESTORING: "restoring",
  SIGNED_OUT: "signedOut",
  UNREACHABLE: "unreachable",
  MFA: "mfa",
  PASSWORD: "password",
  READY: "ready",
  LOCKED: "locked",
});

/** Why the sign-in form opened (`state.notice.code`); each has an `auth.notice.*` text. */
export const NOTICE = Object.freeze({
  SIGNED_OUT: "signedOut",          // the user signed out
  SESSION_ENDED: "sessionEnded",    // the server ended it: a refused refresh, an account change
  ELSEWHERE: "signedOutElsewhere",  // another tab of this browser signed out
  LOCKED_OUT: "lockedOut",          // too many wrong passwords at the lock screen
  LOCK_EXPIRED: "lockExpired",      // locked longer than the hospital allows (SCREEN_LOCK_SIGNOUT_HOURS)
  NO_PERMISSIONS: "noPermissions",  // no tenant, or no permission at all
  NO_SCREEN: "noScreen",            // permissions, but no screen of the live UI uses them
});

/** Wrong passwords one lock takes before it signs out (the server's own limits are wider). */
export const UNLOCK_ATTEMPTS = 3;
/** Minutes, when the server does not say (an older API): lock rather than never. */
export const FALLBACK_LOCK_MINUTES = 10;
/** Hours a browser may stay locked, when the server does not say (an older API). */
export const FALLBACK_LOCK_SIGNOUT_HOURS = 12;
const HOUR_MS = 3_600_000;

const NO_STEPS = Object.freeze({ mfa: false, password: false });
const INITIAL = Object.freeze({
  phase: PHASE.SIGNED_OUT, user: null, mfa: null, notice: null, lock: null, unlockFailures: 0, error: null,
  steps: NO_STEPS,
});

/** True when the server REFUSED the session (a refresh it turned down, a 401/403); anything else
 *  — a 5xx, no network, a timeout — means it did not answer, and the session may be good. */
const refused = (err) => err?.sessionEnded === true || err?.status === 401 || err?.status === 403;

const sameList = (a, b) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

/** The profile (/auth/me) and the token's rights, as the screens read them. Rights come from the
 *  token — what the server checks this hour — and follow it as it is refreshed (`syncRights`). */
function userFrom(me, session) {
  const groups = (Array.isArray(me?.groups) ? me.groups : [])
    .filter((g) => g && typeof g.slug === "string")
    .map((g) => ({ slug: g.slug, name: typeof g.name === "string" && g.name ? g.name : g.slug }));
  const minutes = me?.lock_idle_minutes;
  const hours = me?.lock_signout_hours;
  return {
    id: String(me.id),
    username: me.username,
    fullName: me.full_name || me.username,
    email: me.email ?? null,
    authSource: me.auth_source === "ldap" ? "ldap" : "local",
    tenant: typeof me.tenant === "string" && me.tenant ? me.tenant : session.tenant,
    tenantName: typeof me.tenant_name === "string" && me.tenant_name ? me.tenant_name : null,
    groups,
    perms: session.perms,
    totpEnabled: me.totp_enabled === true,
    lockIdleMinutes: Number.isInteger(minutes) && minutes > 0 ? minutes : FALLBACK_LOCK_MINUTES,
    lockSignoutHours: Number.isInteger(hours) && hours > 0 ? hours : FALLBACK_LOCK_SIGNOUT_HOURS,
  };
}

/**
 * api: backendApi (login, verifyTotp, setupTotp, me, changePassword, reauth, accessToken, logout,
 *      forget).
 * canEnter(perms): whether the live UI has a screen for these rights (shell/routes.js).
 * events: where `storage` events arrive (window); now: the clock; setTimer/clearTimer: the end
 * of a lock that lasts too long.
 */
export function createSessionStore({
  api, canEnter = () => true, events = window, now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
}) {
  let state = { ...INITIAL };
  let epoch = 0;
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(); };
  const set = (patch) => { state = { ...state, ...patch }; emit(); };

  // ---------------------------------------------------------------- endings
  /** Everything this session loaded goes; the next screen starts from nothing. */
  function end(notice, { keepStorage = false } = {}) {
    epoch += 1;
    disarm();
    if (keepStorage) api.forget();
    else api.logout();
    clearLock();
    rightsToken = null;
    set({ ...INITIAL, notice: notice ? { code: notice } : null });
  }

  // ---------------------------------------------------------------- how long a lock may last
  // A browser locked longer than the hospital's SCREEN_LOCK_SIGNOUT_HOURS signs itself out: a ward
  // PC locked overnight does not keep yesterday's session behind its lock. Checked when the lock
  // is shown (a reload, a new tab, another tab's lock) and by a timer while it stays.
  let expiry = null;
  function disarm() {
    if (expiry !== null) clearTimer(expiry);
    expiry = null;
  }

  /** Show the lock screen for `user`, locked since `at` — or end the session if that is too long ago. */
  function showLock(user, { at, why }) {
    const left = user.lockSignoutHours * HOUR_MS - (now() - at);
    if (left <= 0) {
      end(NOTICE.LOCK_EXPIRED);
      return;
    }
    disarm();
    const mine = epoch;
    expiry = setTimer(() => {
      expiry = null;
      if (mine === epoch && state.phase === PHASE.LOCKED) end(NOTICE.LOCK_EXPIRED);
    }, left);
    set({ phase: PHASE.LOCKED, user, mfa: null, notice: null, error: null, lock: { at, why }, unlockFailures: 0 });
  }

  /** Why these rights cannot open the live UI, or null. */
  function entryProblem(session) {
    if (!session || session.tenant == null || session.perms.length === 0) return NOTICE.NO_PERMISSIONS;
    if (!canEnter(session.perms)) return NOTICE.NO_SCREEN;
    return null;
  }

  // ---------------------------------------------------------------- rights follow the token
  // backendApi refreshes the access token on a 401 and retries; a refreshed token carries the
  // CURRENT groups. After each call the store makes, the rights are read from it again, so the
  // menu follows an administrator's change within the hour without a sign-out.
  let rightsToken = null;
  function syncRights() {
    const token = api.accessToken();
    if (!state.user || !token || token === rightsToken) return;
    rightsToken = token;
    const session = sessionFromToken(token);
    if (!session) return;
    const user = state.user;
    const groups = session.groups.map((slug) => user.groups.find((g) => g.slug === slug) ?? { slug, name: slug });
    if (sameList(user.perms, session.perms) && sameList(user.groups.map((g) => g.slug), session.groups)) return;
    set({ user: { ...user, perms: session.perms, groups } });
  }

  /** Run an API call for this session: a refusal that ended it signs out here, and one that says
   *  an administrator has just given the account a temporary password (403
   *  password_change_required) takes an open shell to the password step; the rights are read again
   *  afterwards either way. The error still reaches the caller. */
  async function track(call) {
    const mine = epoch;
    try {
      return await call();
    } catch (err) {
      if (err?.sessionEnded === true && mine === epoch && state.phase !== PHASE.SIGNED_OUT) end(NOTICE.SESSION_ENDED);
      else if (err?.status === 403 && mine === epoch && state.phase === PHASE.READY
               && apiErrorKey(err)?.key === "errors.passwordChangeRequired") {
        set({ phase: PHASE.PASSWORD, steps: { mfa: false, password: true }, error: null });
      }
      throw err;
    } finally {
      if (mine === epoch) syncRights();
    }
  }

  // ---------------------------------------------------------------- opening a session
  /** Where a session with this profile goes next. */
  function settle(me) {
    const session = sessionFromToken(api.accessToken());
    const problem = entryProblem(session);
    if (problem) {
      end(problem);
      return;
    }
    const user = userFrom(me, session);
    rightsToken = api.accessToken();
    const mfaPending = session.mfaRequired && !session.mfaVerified;
    // The steps this sign-in takes after the password, for the "Step 2/3" line: once known, kept
    // until the session is open, so the password step after the TOTP one still counts it.
    const steps = { mfa: state.steps.mfa || mfaPending, password: state.steps.password || me.must_change_password === true };
    state = { ...state, steps };
    if (mfaPending) {
      set({ phase: PHASE.MFA, user, notice: null, error: null,
            mfa: { enrolled: me.totp_enabled === true } });
    } else if (me.must_change_password === true) {
      set({ phase: PHASE.PASSWORD, user, mfa: null, notice: null, error: null });
    } else {
      const lock = readLock();
      if (lock && lock.user === user.id) {
        showLock(user, lock);
      } else {
        if (lock) clearLock();                 // another account's lock: not this session's
        set({ phase: PHASE.READY, user, mfa: null, notice: null, error: null, lock: null });
      }
    }
  }

  /** Read the profile for the session in storage and settle it, unless superseded meanwhile. */
  async function openWithProfile(mine) {
    const me = await api.me();
    if (mine !== epoch) return;
    settle(me);
  }

  async function restore() {
    if (!api.accessToken()) {
      if (state.phase !== PHASE.SIGNED_OUT) set({ ...INITIAL });
      return;
    }
    epoch += 1;
    const mine = epoch;
    set({ phase: PHASE.RESTORING, error: null, steps: NO_STEPS });
    try {
      await openWithProfile(mine);
    } catch (err) {
      if (mine !== epoch) return;
      if (refused(err)) end(null);              // "you were not signed in": a state, not a fault
      else set({ phase: PHASE.UNREACHABLE, error: err });
    }
  }

  /** The password step. Resolves when the session has moved on (state.phase says where);
   *  rejects with the API's error, the form staying where it is. */
  async function signIn(login, password, { remember = false } = {}) {
    epoch += 1;
    const mine = epoch;
    state = { ...state, steps: NO_STEPS };
    const tokens = await api.login(login, password);
    if (mine !== epoch) return;
    // Only a sign-in the server accepted changes this browser: a refused one (a stranger's guess,
    // a typo) neither replaces the remembered name nor lifts a lock.
    if (remember) rememberUser(login.trim());
    else forgetUser();
    clearLock();                                // a new sign-in is a new presence
    const problem = entryProblem(sessionFromToken(tokens.access_token));
    if (problem) {
      end(problem);
      return;
    }
    await openWithProfile(mine);
  }

  /** The authenticator, minted by the API. Each call ROTATES the secret: call once per showing. */
  async function setupMfa() {
    const res = await track(() => api.setupTotp());
    return { provisioningUri: res.provisioning_uri, secret: secretFromProvisioningUri(res.provisioning_uri) };
  }

  /** The 6-digit code. A plain request (backendApi.verifyTotp): a wrong code is a 401 that must
   *  not go through refresh-and-retry. Rejects with the API's error; the step stays open. */
  async function verifyMfa(code) {
    const mine = epoch;
    await api.verifyTotp(String(code).trim());
    if (mine !== epoch) return;
    await openWithProfile(mine);
  }

  /** The user's own password; also how a temporary one is replaced. The API answers with a fresh
   *  pair (every older session ends). Rejects with the API's error. */
  async function changePassword(current, next) {
    const mine = epoch;
    await track(() => api.changePassword(current, next));
    if (mine !== epoch) return;
    await openWithProfile(mine);
  }

  // ---------------------------------------------------------------- the lock
  function lock(why = "manual") {
    if (state.phase !== PHASE.READY || !state.user) return;
    const at = now();
    writeLock({ user: state.user.id, at, why });
    showLock(state.user, { at, why });
  }

  /** The session's own password. Rejects with the API's error, the lock staying; the
   *  UNLOCK_ATTEMPTS-th wrong one signs out instead. Any other refusal (401, or a 403 such as an
   *  inactive membership) means the session itself is over; a server that did not answer (429,
   *  503, no network) changes nothing. */
  async function unlock(password) {
    if (state.phase !== PHASE.LOCKED) return;
    const mine = epoch;
    try {
      await track(() => api.reauth(password));
    } catch (err) {
      if (mine !== epoch) throw err;
      if (apiErrorKey(err)?.key === "errors.reauthRefused") {
        const failures = state.unlockFailures + 1;
        if (failures >= UNLOCK_ATTEMPTS) end(NOTICE.LOCKED_OUT);
        else set({ unlockFailures: failures });
      } else if ((err?.status === 401 || err?.status === 403) && state.phase === PHASE.LOCKED) {
        end(NOTICE.SESSION_ENDED);
      }
      throw err;
    }
    if (mine !== epoch) return;
    disarm();
    clearLock();
    set({ phase: PHASE.READY, lock: null, unlockFailures: 0 });
  }

  // ---------------------------------------------------------------- other tabs of this browser
  function onStorage(event) {
    if (event.key === TOKEN_KEYS.access || event.key === TOKEN_KEYS.refresh || event.key === null) {
      api.forget();                              // read storage again on the next request
      if (event.key === TOKEN_KEYS.refresh) return;
      const token = api.accessToken();
      if (!token) {
        if (state.phase !== PHASE.SIGNED_OUT) end(NOTICE.ELSEWHERE, { keepStorage: true });
        return;
      }
      const sub = decodeJwtPayload(token)?.sub;
      // Another account signed in in another tab, or one did while this tab showed the form:
      // this browser now holds that session — open it here too.
      if (!state.user || String(sub) !== state.user.id) {
        epoch += 1;
        disarm();
        rightsToken = null;
        set({ ...INITIAL });
        restore();
      } else if (state.phase === PHASE.MFA || state.phase === PHASE.PASSWORD) {
        // The same account passed this step in another tab (a verified code, a new password):
        // its new token is here now — settle again instead of asking for it twice.
        restore();
      }
      return;
    }
    if (event.key === LOCK_KEY) {
      const other = parseLock(event.newValue);
      if (other && state.phase === PHASE.READY && state.user && other.user === state.user.id) {
        showLock(state.user, other);
      } else if (!other && state.phase === PHASE.LOCKED && api.accessToken()) {
        disarm();
        set({ phase: PHASE.READY, lock: null, unlockFailures: 0 });   // unlocked in another tab
      }
    }
  }
  events?.addEventListener?.("storage", onStorage);

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Bumped whenever a session begins or ends: data keyed to it can tell it is stale. */
    epoch: () => epoch,
    restore,
    retry: restore,
    signIn,
    setupMfa,
    verifyMfa,
    changePassword,
    lock,
    unlock,
    track,
    /** Back out of a step (MFA, a forced password change): the session ends, nothing kept. */
    cancel: () => end(null),
    signOut: () => end(NOTICE.SIGNED_OUT),
    dispose() {
      events?.removeEventListener?.("storage", onStorage);
      disarm();
      listeners.clear();
    },
  };
}
```

**Create** `dashboard/src/live/session/SessionProvider.jsx`:

```jsx
// src/live/session/SessionProvider.jsx — the session store (sessionStore.js) for React.
//
//   const { phase, user, notice, lock, store } = useSession();
// The component re-renders when the session changes; `store` carries the actions (signIn,
// verifyMfa, changePassword, lock, unlock, signOut, track…).
import React, { createContext, useContext, useSyncExternalStore } from "react";

const SessionContext = createContext(null);

export function SessionProvider({ store, children }) {
  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const store = useContext(SessionContext);
  if (!store) throw new Error("useSession: no <SessionProvider> above this component");
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return { ...state, store };
}
```

- [ ] **Step 5: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  69 passed (69)`, `Tests  1426 passed (1426)`, `✓ built in …`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/session/sessionStore.js dashboard/src/live/session/SessionProvider.jsx dashboard/src/live/session/testTokens.testutil.js dashboard/src/live/session/sessionStore.test.js
git commit -m "feat(live-ui): the session store, on the real API and nothing simulated (D1)

Phases restoring / signedOut / unreachable / mfa / password / ready /
locked. Sign-in (remembering the username only, and only once the API
accepted it), the TOTP step, the forced password change (also when a
tracked call says an administrator reset the password), the per-browser
lock and its unlock (3 wrong: signed out; locked longer than the
hospital's hours: signed out), rights that follow the refreshed token,
other tabs (a step passed in one moves the others on). Every way a
session ends empties it and drops its late answers.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: The board store

**Files:**
- Create: `dashboard/src/live/data/boardStore.js`, `dashboard/src/live/data/BoardProvider.jsx`, `dashboard/src/live/session/mount.testutil.jsx`
- Test: `dashboard/src/live/data/boardStore.test.js`

- [ ] **Step 1: Write the failing test.** **Create** `dashboard/src/live/data/boardStore.test.js`:

```js
import { describe, it, expect, vi } from "vitest";
import { RECONNECT_DELAY_MS, alarmCounts, createBoardStore, scopeUnits, waitingAlarms } from "./boardStore.js";
import { CONNECTION } from "../../liveConnection.js";

// Synthetic board entries, in the API's /patients shape (api/board.py). No real data.
const entry = (id, alerts = [], extra = {}) => ({
  patient_id: id, risk: "moderate", vitals: {}, alerts, last_update: "2026-10-04T08:00:00Z", ...extra,
});
const alert = (kind, severity, extra = {}) => ({
  kind, severity, summary: `${kind} ölçütü karşılandı`, first_seen_at: "2026-10-04T07:58:00Z",
  acknowledged: false, ...extra,
});
const BOARD = {
  patients: [entry("P-001", [alert("news2", "high")]), entry("P-002")],
  scope: { unrestricted: false, unit_ids: ["REA", "NICU"] }, scope_note: "2 birim",
};

function setup({ board = BOARD } = {}) {
  const handlers = [];
  const closes = [];
  const timers = [];
  const api = {
    boardPatients: vi.fn().mockResolvedValue(board),
    streamTicket: vi.fn().mockResolvedValue({ ticket: "t-1" }),
  };
  const openStream = vi.fn((url, h) => {
    handlers.push(h);
    const close = vi.fn();
    closes.push(close);
    return close;
  });
  const store = createBoardStore({
    api, openStream,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: vi.fn(),
  });
  return { api, store, handlers, closes, timers, openStream, state: () => store.getState() };
}

describe("the board store", () => {
  it("loads the board, then streams with a ticket — never a token in the URL", async () => {
    const { api, store, openStream, handlers, state } = setup();
    await store.start();
    expect(state().patients.map((p) => p.patient_id)).toEqual(["P-001", "P-002"]);
    expect(state().alerts).toHaveLength(1);
    expect(state().scope).toEqual(BOARD.scope);
    expect(state().scopeNote).toBe("2 birim");
    expect(openStream).toHaveBeenCalledWith("/stream?ticket=t-1", expect.any(Object));
    expect(state().connection).toBe(CONNECTION.CONNECTING);          // the stream is not open yet
    handlers[0].onopen();
    expect(api.boardPatients).toHaveBeenCalledTimes(2);                // the open reloads the board
    await vi.waitFor(() => expect(state().connection).toBe(CONNECTION.LIVE));
  });

  it("is never LIVE over a load that failed — an open stream vouches for nothing", async () => {
    const { api, store, handlers, state } = setup();
    api.boardPatients.mockRejectedValue(new Error("Failed to fetch"));
    await store.start();
    expect(state()).toMatchObject({ patients: [], connection: CONNECTION.UNAVAILABLE });
    handlers[0].onopen();
    await vi.waitFor(() => expect(api.boardPatients).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    handlers[0].onmessage({ data: JSON.stringify(entry("P-003", [alert("sepsis", "critical")])) });
    expect(state()).toMatchObject({ patients: [], alerts: [], connection: CONNECTION.UNAVAILABLE });
    handlers[0].onerror();
    expect(state().connection).toBe(CONNECTION.UNAVAILABLE);
  });

  it("reloads at every reopen, and is LIVE again only once that load has landed", async () => {
    const { api, store, handlers, timers, state } = setup();
    await store.start();
    handlers[0].onopen();
    await vi.waitFor(() => expect(state().connection).toBe(CONNECTION.LIVE));
    handlers[0].onerror();
    expect(state().connection).toBe(CONNECTION.DEGRADED);
    expect(state().patients).toHaveLength(2);                          // shown, flagged as maybe old
    let answer;
    api.boardPatients.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    await timers[0].fn();
    handlers[1].onopen();
    expect(api.boardPatients).toHaveBeenCalledTimes(3);
    expect(state().connection).toBe(CONNECTION.DEGRADED);              // open, not reloaded yet
    answer({ ...BOARD, patients: [entry("P-002")] });
    await vi.waitFor(() => expect(state().connection).toBe(CONNECTION.LIVE));
    expect(state().patients.map((p) => p.patient_id)).toEqual(["P-002"]);
  });

  it("drops a load that a later one overtook", async () => {
    const { api, store, handlers, state } = setup();
    await store.start();
    let early;
    api.boardPatients.mockImplementationOnce(() => new Promise((resolve) => { early = resolve; }));
    const overtaken = store.refresh();
    handlers[0].onopen();
    await vi.waitFor(() => expect(state().connection).toBe(CONNECTION.LIVE));
    early({ ...BOARD, patients: [] });
    await overtaken;
    expect(state()).toMatchObject({ connection: CONNECTION.LIVE });
    expect(state().patients).toHaveLength(2);
  });

  it("on a failed load shows nothing and says UNAVAILABLE — never the previous list", async () => {
    const { api, store, state } = setup();
    await store.start();
    api.boardPatients.mockRejectedValue(new Error("Failed to fetch"));
    await store.refresh();
    expect(state()).toMatchObject({ patients: [], alerts: [], scope: null, connection: CONNECTION.UNAVAILABLE });
  });

  it("merges stream frames, and takes a removed patient off", async () => {
    const { store, handlers, state } = setup();
    await store.start();
    handlers[0].onopen();
    await vi.waitFor(() => expect(state().connection).toBe(CONNECTION.LIVE));
    handlers[0].onmessage({ data: JSON.stringify(entry("P-003", [alert("sepsis", "critical")])) });
    expect(state().patients.map((p) => p.patient_id)).toEqual(["P-001", "P-002", "P-003"]);
    handlers[0].onmessage({ data: JSON.stringify({ ...entry("P-001"), removed: true }) });
    expect(state().patients.map((p) => p.patient_id)).toEqual(["P-002", "P-003"]);
    handlers[0].onmessage({ data: "{not json" });
    expect(state().patients).toHaveLength(2);
  });

  it("closes a dropped stream and reconnects ONCE, with a fresh ticket", async () => {
    const { api, store, handlers, closes, timers, state } = setup();
    await store.start();
    handlers[0].onerror();
    handlers[0].onerror();
    expect(closes[0]).toHaveBeenCalled();
    expect(state().connection).toBe(CONNECTION.DEGRADED);
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(RECONNECT_DELAY_MS);
    api.streamTicket.mockResolvedValue({ ticket: "t-2" });
    await timers[0].fn();
    expect(api.streamTicket).toHaveBeenCalledTimes(2);
  });

  it("forgets everything on clear(), and drops an answer that arrives afterwards", async () => {
    const { api, store, state } = setup();
    let answer;
    api.boardPatients.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const started = store.start();
    store.clear();
    answer(BOARD);
    await started;
    expect(state()).toMatchObject({ patients: [], alerts: [], scope: null, connection: CONNECTION.CONNECTING });
    expect(api.streamTicket).not.toHaveBeenCalled();
  });
});

describe("alarm counts and lists", () => {
  const alerts = [
    { id: "a", severity: "critical", ack: null, firstSeenAtMs: 300 },
    { id: "b", severity: "high", ack: { by: "ayse" }, firstSeenAtMs: 100 },
    { id: "c", severity: "high", ack: null, firstSeenAtMs: 200 },
    { id: "d", severity: "info", ack: null, firstSeenAtMs: null },
    { id: "e", severity: "high", ack: null, firstSeenAtMs: 50 },
  ];

  it("counts every open alarm by severity, and the ones nobody acknowledged", () => {
    expect(alarmCounts(alerts)).toEqual({
      open: { total: 5, critical: 1, high: 3, moderate: 0, low: 0, info: 1 }, waiting: 4,
    });
    expect(alarmCounts([])).toEqual({ open: { total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 }, waiting: 0 });
  });

  it("lists the unacknowledged ones, most severe first, oldest first within a severity", () => {
    expect(waitingAlarms(alerts).map((a) => a.id)).toEqual(["a", "e", "c", "d"]);
  });
});

describe("the units the chip offers", () => {
  it("are the engine's restricted scope, from two units up", () => {
    expect(scopeUnits({ unrestricted: false, unit_ids: ["REA", "NICU"] })).toEqual(["REA", "NICU"]);
    expect(scopeUnits({ unrestricted: false, unit_ids: ["REA"] })).toEqual([]);
    expect(scopeUnits({ unrestricted: true, unit_ids: [] })).toEqual([]);
    expect(scopeUnits(null)).toEqual([]);
    expect(scopeUnits({ unrestricted: false, unit_ids: ["REA", " ", 3] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/data/ 2>&1 | grep -E "Error|Tests "
```
Expected: `Failed to resolve import "./boardStore.js"`.

- [ ] **Step 3: Implement.** **Create** `dashboard/src/live/data/boardStore.js`:

```js
// src/live/data/boardStore.js — the ward as the API shows it to this session: patients, their
// open alarms, the connection's state and the scope the engine applied. Framework-free; React
// reads it through BoardProvider.jsx. The screens of Wave 3 (beds, alarms, patient) read it; the
// shell reads it for the bell and the lock screen's counts.
//
// Ported from liveStore.js's live half (refreshBoard / startLive), without the simulation under
// it (roadmap D1). The rules it keeps:
//   - a failed load EMPTIES the list and says UNAVAILABLE — never yesterday's patients, never a
//     simulated ward (liveConnection.js);
//   - the stream opens with a single-use ticket, never a token in a URL, and a dropped stream gets
//     ONE scheduled reconnect with a fresh ticket;
//   - an answer that arrives after `clear()` (the session ended) is dropped.
// And one it adds: LIVE means "the stream is open AND the board was loaded since it opened" —
// nothing less. An open stream says nothing about a load that failed, and a stream that comes
// back after a drop may have missed changes: every open reloads the board, and only that load
// makes it LIVE. Until then a board that has data is DEGRADED (shown, possibly out of date), one
// whose load failed stays UNAVAILABLE. The shell treats only LIVE as known (the bell, the lock
// screen's counts): "no alarms" is never said of a board that is not.
import { patientFromBoard, patientsFromBoard, alertsFromPatients } from "../../liveAdapters.js";
import { CONNECTION } from "../../liveConnection.js";

export const RECONNECT_DELAY_MS = 5000;

const EMPTY = Object.freeze({
  patients: [], alerts: [], connection: CONNECTION.CONNECTING, scope: null, scopeNote: null,
});

/** Real SSE. `ticket` is short-lived and single-use: EventSource sends no headers, and a bearer
 *  token in a URL would leak into logs, history and Referer headers. */
function defaultOpenStream(url, handlers) {
  if (typeof EventSource === "undefined") return () => {};
  const source = new EventSource(url);
  source.onopen = handlers.onopen;
  source.onmessage = handlers.onmessage;
  source.onerror = handlers.onerror;
  return () => source.close();
}

function upsert(patients, patient) {
  const at = patients.findIndex((p) => p.patient_id === patient.patient_id);
  if (at === -1) return [...patients, patient];
  const next = patients.slice();
  next[at] = patient;
  return next;
}

/**
 * api: backendApi (boardPatients, streamTicket). track(call): the session's wrapper for its API
 * calls (sessionStore.track: a refused refresh ends the session, rights follow the token).
 */
export function createBoardStore({
  api, track = (call) => call(), openStream = defaultOpenStream,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
}) {
  let state = { ...EMPTY };
  let generation = 0;               // bumped by start() and clear(): a stale answer is dropped
  let closeSource = () => {};
  let reconnect = null;
  let opened = 0;                   // the stream's opens so far: a load counts for the one it began in
  let streamOpen = false;
  let loadsBegun = 0;               // a load overtaken by a later one that landed first is dropped
  let loadLanded = 0;
  const listeners = new Set();
  const set = (patch) => {
    state = { ...state, ...patch };
    for (const fn of listeners) fn();
  };
  const withPatients = (patients, patch = {}) => set({ patients, alerts: alertsFromPatients(patients), ...patch });

  async function refresh() {
    const mine = generation;
    loadsBegun += 1;
    const seq = loadsBegun;
    const during = streamOpen ? opened : -1;     // began while the stream was open: which open
    let board = null;
    let patients = null;
    try {
      board = await track(() => api.boardPatients());
      patients = patientsFromBoard(board);
    } catch {
      // patients stays null: the load failed
    }
    if (mine !== generation || seq < loadLanded) return;
    loadLanded = seq;
    if (patients) {
      // LIVE only for a load that began after the stream (still) open had opened; otherwise the
      // data is shown but not vouched for: still connecting at the start, DEGRADED after.
      const live = streamOpen && during === opened;
      const connection = live ? CONNECTION.LIVE
        : state.connection === CONNECTION.CONNECTING ? CONNECTION.CONNECTING : CONNECTION.DEGRADED;
      withPatients(patients, { scope: board?.scope ?? null, scopeNote: board?.scope_note ?? null, connection });
    } else {
      // An empty list with the reason, never the last one: a board that stopped updating must
      // not look like a ward that is calm.
      withPatients([], { scope: null, scopeNote: null, connection: CONNECTION.UNAVAILABLE });
    }
  }

  /** The stream opened: reload, so the board it updates is a whole one (LIVE once that lands). */
  function onOpen() {
    streamOpen = true;
    opened += 1;
    refresh();
  }

  function onMessage(event) {
    let patient;
    let removed;
    try {
      const entry = JSON.parse(event.data);
      removed = entry.removed === true;
      patient = patientFromBoard(entry);
    } catch {
      return;                                     // a malformed frame touches nothing
    }
    if (patient.patient_id == null) return;
    // A board whose load failed stays empty: frames alone are not a ward, only the next whole load is.
    if (state.connection === CONNECTION.UNAVAILABLE) return;
    withPatients(removed ? state.patients.filter((p) => p.patient_id !== patient.patient_id)
      : upsert(state.patients, patient));
  }

  function onError(mine) {
    closeSource();                                // or the browser retries with the spent ticket
    if (mine !== generation) return;
    streamOpen = false;
    // A board whose load failed stays UNAVAILABLE (empty, and says so); any other is DEGRADED.
    if (state.connection !== CONNECTION.UNAVAILABLE) set({ connection: CONNECTION.DEGRADED });
    if (reconnect) return;
    reconnect = setTimer(() => {
      reconnect = null;
      if (mine === generation) connect(mine);
    }, RECONNECT_DELAY_MS);
  }

  async function connect(mine) {
    try {
      const { ticket } = await track(() => api.streamTicket());
      if (mine !== generation) return;
      closeSource = openStream(`/stream?ticket=${encodeURIComponent(ticket)}`, {
        onopen: () => { if (mine === generation) onOpen(); },
        onmessage: (event) => { if (mine === generation) onMessage(event); },
        onerror: () => onError(mine),
      });
    } catch {
      if (mine === generation) onError(mine);
    }
  }

  function stopStream() {
    if (reconnect) clearTimer(reconnect);
    reconnect = null;
    closeSource();
    closeSource = () => {};
    streamOpen = false;
  }

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    refresh,
    /** Load, then stream (LIVE once the stream has opened and its reload landed). Resolves once
     *  the first load and the first ticket are done. */
    async start() {
      stopStream();
      generation += 1;
      const mine = generation;
      set({ ...EMPTY });
      await refresh();
      if (mine === generation) await connect(mine);
    },
    /** The session ended: nothing of it stays, and nothing late comes back. */
    clear() {
      generation += 1;
      stopStream();
      set({ ...EMPTY });
    },
  };
}

/** Open alarms in the board, counted. `open` is every alarm the engine still holds (seen or not),
 *  by severity; `waiting` those nobody has acknowledged yet. Numbers only: the lock screen shows
 *  these and nothing else of the ward. */
const SEVERITY_ORDER = ["critical", "high", "moderate", "low", "info"];

export function alarmCounts(alerts) {
  const open = { total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  let waiting = 0;
  for (const a of alerts) {
    open.total += 1;
    if (SEVERITY_ORDER.includes(a.severity)) open[a.severity] += 1;
    if (!a.ack) waiting += 1;
  }
  return { open, waiting };
}

/** The alarms nobody has acknowledged, most severe first, then the oldest first. */
export function waitingAlarms(alerts) {
  const rank = (a) => {
    const at = SEVERITY_ORDER.indexOf(a.severity);
    return at === -1 ? SEVERITY_ORDER.length : at;
  };
  return alerts.filter((a) => !a.ack).sort((a, b) => rank(a) - rank(b)
    || (a.firstSeenAtMs ?? Infinity) - (b.firstSeenAtMs ?? Infinity));
}

/** The units the chip may offer: the engine's own scope, when it is restricted to two or more. */
export function scopeUnits(scope) {
  if (!scope || scope.unrestricted !== false || !Array.isArray(scope.unit_ids)) return [];
  const units = scope.unit_ids.filter((u) => typeof u === "string" && u.trim());
  return units.length >= 2 ? units : [];
}
```

**Create** `dashboard/src/live/data/BoardProvider.jsx`:

```jsx
// src/live/data/BoardProvider.jsx — the board store (boardStore.js) for React.
//
//   const { patients, alerts, connection, scope, scopeNote, store } = useBoard();
// Wave 3's screens (beds, alarms, patient) read the ward from here; the shell reads it for the bell
// and the lock screen's counts. LiveApp starts the store for a session that may see the board and
// clears it when the session ends.
import React, { createContext, useContext, useSyncExternalStore } from "react";

const BoardContext = createContext(null);

export function BoardProvider({ store, children }) {
  return <BoardContext.Provider value={store}>{children}</BoardContext.Provider>;
}

export function useBoard() {
  const store = useContext(BoardContext);
  if (!store) throw new Error("useBoard: no <BoardProvider> above this component");
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return { ...state, store };
}
```

- [ ] **Step 4: The mount helper the screens' tests share** (no test of its own; Tasks 18–22 use it). **Create** `dashboard/src/live/session/mount.testutil.jsx`:

```jsx
// Test-only: render a piece of the live UI inside a real session store (on a fake API) and a
// board store, the way LiveApp nests them. `access` null: signed out; otherwise the session is
// restored first (phase ready, or whatever the profile says). Synthetic accounts only.
import React from "react";
import { vi } from "vitest";
import { render } from "@testing-library/react";
import { I18nProvider } from "../i18n/I18nProvider.jsx";
import { ToastProvider } from "../ui/index.js";
import { SessionProvider } from "./SessionProvider.jsx";
import { createSessionStore } from "./sessionStore.js";
import { BoardProvider } from "../data/BoardProvider.jsx";
import { createBoardStore } from "../data/boardStore.js";
import { fakeApi, profile, token } from "./testTokens.testutil.js";

export const refusal = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

export async function mount(ui, { access = token(), me = profile(), setup } = {}) {
  const api = fakeApi(vi, { access });
  api.me.mockResolvedValue(me);
  setup?.(api);
  const store = createSessionStore({ api, events: new EventTarget() });
  if (access) await store.restore();
  const board = createBoardStore({ api });
  render(
    <I18nProvider><ToastProvider>
      <SessionProvider store={store}><BoardProvider store={board}>{ui}</BoardProvider></SessionProvider>
    </ToastProvider></I18nProvider>,
  );
  return { api, store, board };
}
```

- [ ] **Step 5: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  70 passed (70)`, `Tests  1437 passed (1437)`, `✓ built in …`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/data/boardStore.js dashboard/src/live/data/BoardProvider.jsx dashboard/src/live/data/boardStore.test.js dashboard/src/live/session/mount.testutil.jsx
git commit -m "feat(live-ui): the board store Wave 3 shares — patients, alarms, connection, scope

Ported from liveStore's live half without the simulation: a failed load
empties the list and says UNAVAILABLE; the stream opens with a single-use
ticket and reconnects once with a fresh one; clear() forgets everything
and drops late answers. LIVE only when the stream is open and the board
was reloaded since: every open reloads it, an overtaken load is dropped,
an open stream never makes a failed load look live. alarmCounts,
waitingAlarms, scopeUnits.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: The idle lock

**Files:**
- Create: `dashboard/src/live/session/useIdleLock.js`
- Test: `dashboard/src/live/session/useIdleLock.test.jsx`

- [ ] **Step 1: Write the failing test.** **Create** `dashboard/src/live/session/useIdleLock.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { useIdleLock, WARN_SECONDS } from "./useIdleLock.js";
import { readActiveAt, writeActiveAt } from "./browserState.js";

function Probe({ minutes = 2, onIdle, enabled = true }) {
  const { secondsLeft, stay } = useIdleLock({ minutes, onIdle, enabled });
  return (
    <div>
      <p data-testid="left">{secondsLeft === null ? "-" : secondsLeft}</p>
      <button type="button" onClick={stay}>devam</button>
    </div>
  );
}

const left = () => screen.getByTestId("left").textContent;
const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T08:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("the idle lock", () => {
  it("warns for the last minute, counting down, then locks", () => {
    const onIdle = vi.fn();
    render(<Probe minutes={2} onIdle={onIdle} />);
    advance(59_000);
    expect(left()).toBe("-");
    advance(2_000);
    expect(left()).toBe(String(WARN_SECONDS - 1));
    advance(58_000);
    expect(left()).toBe("1");
    expect(onIdle).not.toHaveBeenCalled();
    advance(1_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(left()).toBe("-");
  });

  it("a key, a click, a touch or the wheel is activity; a moving pointer is not", () => {
    const onIdle = vi.fn();
    render(<Probe minutes={1} onIdle={onIdle} />);
    advance(50_000);
    fireEvent.pointerMove(document);
    fireEvent.mouseMove(document);
    advance(11_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    onIdle.mockClear();
    // 50 s apart: one that did not count would leave 100 s without activity, past the minute.
    for (const fire of [() => fireEvent.keyDown(document, { key: "a" }), () => fireEvent.pointerDown(document),
      () => fireEvent.wheel(document), () => fireEvent.touchStart(document)]) {
      advance(25_000);
      fire();
      advance(25_000);
      expect(onIdle).not.toHaveBeenCalled();
    }
  });

  it("'stay' is activity, shared with the other tabs at once", () => {
    const onIdle = vi.fn();
    render(<Probe minutes={1} onIdle={onIdle} />);
    advance(30_000);
    expect(left()).toBe("30");
    fireEvent.click(screen.getByText("devam"));
    expect(left()).toBe("-");
    expect(readActiveAt()).toBe(Date.now());
    advance(59_000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("does not lock this tab while another tab is in use", () => {
    const onIdle = vi.fn();
    render(<Probe minutes={1} onIdle={onIdle} />);
    advance(50_000);
    writeActiveAt(Date.now());                  // someone typing in another tab
    advance(50_000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("does nothing while disabled", () => {
    const onIdle = vi.fn();
    render(<Probe minutes={1} onIdle={onIdle} enabled={false} />);
    advance(120_000);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/session/useIdleLock.test.jsx 2>&1 | grep -E "Error|Tests "
```
Expected: `Failed to resolve import "./useIdleLock.js"`.

- [ ] **Step 3: Implement.** **Create** `dashboard/src/live/session/useIdleLock.js`:

```js
// src/live/session/useIdleLock.js — lock the screen after the hospital's idle time.
//
// Idle = no key press, click, touch or wheel in ANY tab of this browser for `minutes` (the
// API's SCREEN_LOCK_IDLE_MINUTES, from /auth/me). A pointer that only moves does not count: a
// mouse bumped on a cart must not keep a ward PC open. The last activity is shared through
// browserState (hmc.activeAt, written at most every SHARE_EVERY_MS), so a tab in the background
// does not lock the one in use. WARN_SECONDS before the lock, `secondsLeft` counts down for the
// warning; `stay()` (its button) is activity.
import { useCallback, useEffect, useRef, useState } from "react";
import { readActiveAt, writeActiveAt } from "./browserState.js";

export const WARN_SECONDS = 60;
export const SHARE_EVERY_MS = 5000;
export const ACTIVITY_EVENTS = Object.freeze(["keydown", "pointerdown", "wheel", "touchstart"]);

export function useIdleLock({ minutes, onIdle, enabled = true }) {
  const [secondsLeft, setSecondsLeft] = useState(null);
  const last = useRef(Date.now());
  const shared = useRef(0);
  const idle = useRef(onIdle);
  idle.current = onIdle;

  const touch = useCallback(() => {
    const now = Date.now();
    last.current = now;
    if (now - shared.current >= SHARE_EVERY_MS) {
      shared.current = now;
      writeActiveAt(now);
    }
  }, []);

  const stay = useCallback(() => {
    shared.current = 0;                        // share it now: the warning is a deliberate act
    touch();
    setSecondsLeft(null);
  }, [touch]);

  useEffect(() => {
    if (!enabled) return undefined;
    last.current = Date.now();
    const options = { capture: true, passive: true };
    for (const type of ACTIVITY_EVENTS) document.addEventListener(type, touch, options);
    const limit = minutes * 60_000;
    const tick = () => {
      const latest = Math.max(last.current, readActiveAt() ?? 0);
      const left = Math.ceil((limit - (Date.now() - latest)) / 1000);
      if (left <= 0) {
        setSecondsLeft(null);
        last.current = Date.now();               // once per idle period, not every second
        idle.current();
      } else {
        setSecondsLeft(left <= WARN_SECONDS ? left : null);
      }
    };
    const timer = setInterval(tick, 1000);
    return () => {
      clearInterval(timer);
      for (const type of ACTIVITY_EVENTS) document.removeEventListener(type, touch, options);
      setSecondsLeft(null);
    };
  }, [enabled, minutes, touch]);

  return { secondsLeft, stay };
}
```

- [ ] **Step 4: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  71 passed (71)`, `Tests  1442 passed (1442)`, `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/session/useIdleLock.js dashboard/src/live/session/useIdleLock.test.jsx
git commit -m "feat(live-ui): the idle lock — the hospital's minutes, a minute's warning, any tab's activity

Keys, clicks, touches and the wheel count; a pointer that only moves does not.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Menus, the language menu and the theme switch

**Files:**
- Create: `dashboard/src/live/shell/Menu.jsx`, `dashboard/src/live/shell/Prefs.jsx`, `dashboard/src/live/i18n/strings/shell.js`
- Modify: `dashboard/src/live/i18n/catalog.js`, `dashboard/src/live/i18n/strings.test.js`
- Test: `dashboard/src/live/shell/Menu.test.jsx`

- [ ] **Step 1: Write the failing test.** **Create** `dashboard/src/live/shell/Menu.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MenuButton, Popover } from "./Menu.jsx";

function Account({ onLock = vi.fn(), onOut = vi.fn() }) {
  return (
    <>
      <MenuButton
        label="Hesab menyusu"
        button="AS"
        header={<p>Ayşe Sentetik</p>}
        items={[
          { key: "lock", label: "Ekranı kilidlə", icon: "lock", onSelect: onLock },
          "separator",
          { key: "out", label: "Çıxış", icon: "out", onSelect: onOut },
        ]}
      />
      <button type="button">kənarda</button>
    </>
  );
}

describe("MenuButton", () => {
  it("is a closed menu button until pressed; then the first item has focus", () => {
    render(<Account />);
    const button = screen.getByRole("button", { name: "Hesab menyusu" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "Hesab menyusu" })).toBeInTheDocument();
    expect(screen.getByText("Ayşe Sentetik")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Ekranı kilidlə" }));
  });

  it("moves with the arrows, wrapping, and jumps with Home/End", () => {
    render(<Account />);
    fireEvent.click(screen.getByRole("button", { name: "Hesab menyusu" }));
    const menu = screen.getByRole("menu");
    const [lock, out] = screen.getAllByRole("menuitem");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(out);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(lock);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(out);
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(lock);
  });

  it("runs an item, closes, and gives focus back to its button", () => {
    const onOut = vi.fn();
    render(<Account onOut={onOut} />);
    const button = screen.getByRole("button", { name: "Hesab menyusu" });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("menuitem", { name: "Çıxış" }));
    expect(onOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes on Escape (focus back) and on a press outside", () => {
    render(<Account />);
    const button = screen.getByRole("button", { name: "Hesab menyusu" });
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByRole("button", { name: "kənarda" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens from the keyboard with ArrowDown, and marks the chosen radio item", () => {
    render(<MenuButton label="Dil" button="AZ" items={[
      { key: "az", label: "Azərbaycan", checked: true, onSelect: () => {} },
      { key: "tr", label: "Türkçe", checked: false, onSelect: () => {} },
    ]} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Dil" }), { key: "ArrowDown" });
    const chosen = screen.getByRole("menuitemradio", { name: "Azərbaycan" });
    expect(chosen).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Türkçe" })).toHaveAttribute("aria-checked", "false");
    expect(document.activeElement).toBe(chosen);
  });
});

describe("Popover", () => {
  it("opens a named panel that takes focus, and closes on Escape back to its button", () => {
    render(<Popover label="Klaviatura qısayolları" button="⌨">{() => <p>Alt L</p>}</Popover>);
    const button = screen.getByRole("button", { name: "Klaviatura qısayolları" });
    fireEvent.click(button);
    const panel = screen.getByRole("region", { name: "Klaviatura qısayolları" });
    expect(button).toHaveAttribute("aria-controls", panel.id);
    expect(document.activeElement).toBe(panel);
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("region")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/shell/ 2>&1 | grep -E "Error|Tests "
```
Expected: `Failed to resolve import "./Menu.jsx"`.

- [ ] **Step 3: Implement.** **Create** `dashboard/src/live/shell/Menu.jsx`:

```jsx
// src/live/shell/Menu.jsx — the top bar's drop-downs: the prototype's .menu (shell.js openMenu).
//
// Popover: a button that opens a panel under it (the bell, the keyboard shortcuts). MenuButton: the
// same with a list of actions (the account, the language), as an ARIA menu. Both close on Escape —
// focus back on the button — and on a press outside them, which leaves focus where it went.
import React, { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../ui/Icon.jsx";
import { FOCUS_RING } from "../ui/focus.js";

export const TOOL_BUTTON =
  `relative grid h-9 w-9 shrink-0 place-items-center rounded-ctl text-mute hover:bg-card2 hover:text-ink ${FOCUS_RING}`;
const PANEL = "absolute right-0 top-full z-[90] mt-1.5 min-w-[220px] rounded-box border border-line2 bg-card p-2 font-text text-ink shadow-pop";

function useDisclosure() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };
  return { open, setOpen, close, wrapRef, buttonRef };
}

/** A button and the panel it opens. `children(close)` renders the panel; it gets focus on open. */
export function Popover({ label, button, buttonClassName = TOOL_BUTTON, panelClassName = "", children }) {
  const { open, setOpen, close, wrapRef, buttonRef } = useDisclosure();
  const panelId = useId();
  const panelRef = useRef(null);
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);
  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); close(); } }}
        className={buttonClassName}
      >
        {button}
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="region"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}
          className={`${PANEL} outline-none ${panelClassName}`}
        >
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

/** A menu of actions. items: [{ key, label, icon?, onSelect, checked? }, …] and "separator";
 *  `checked` (true/false) makes the item a menuitemradio (the language). `header` is shown above
 *  the list and is not an item (who is signed in). Arrow keys move, Home/End jump, Escape and Tab
 *  close; opening focuses the checked item, else the first. */
export function MenuButton({ label, button, buttonClassName = TOOL_BUTTON, header = null, items, panelClassName = "" }) {
  const { open, setOpen, close, wrapRef, buttonRef } = useDisclosure();
  const menuId = useId();
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const all = [...listRef.current.querySelectorAll("[role^='menuitem']")];
    (all.find((el) => el.getAttribute("aria-checked") === "true") || all[0])?.focus();
  }, [open]);

  const move = (event) => {
    const all = [...listRef.current.querySelectorAll("[role^='menuitem']")];
    const at = all.indexOf(document.activeElement);
    const go = (i) => { event.preventDefault(); all[(i + all.length) % all.length]?.focus(); };
    if (event.key === "ArrowDown") go(at + 1);
    else if (event.key === "ArrowUp") go(at - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(all.length - 1);
    else if (event.key === "Escape") { event.stopPropagation(); close(); }
    else if (event.key === "Tab") close(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); }
        }}
        className={buttonClassName}
      >
        {button}
      </button>
      {open ? (
        <div className={`${PANEL} ${panelClassName}`}>
          {header}
          <ul ref={listRef} id={menuId} role="menu" aria-label={label} onKeyDown={move} className="m-0 list-none p-0">
            {items.map((item, i) => (item === "separator" ? (
              <li key={`sep-${i}`} role="separator" className="my-1.5 border-t border-line" />
            ) : (
              <li key={item.key} role="none">
                <button
                  type="button"
                  role={typeof item.checked === "boolean" ? "menuitemradio" : "menuitem"}
                  aria-checked={typeof item.checked === "boolean" ? item.checked : undefined}
                  tabIndex={-1}
                  onClick={() => { close(); item.onSelect(); }}
                  className={`flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-[9px] text-left text-13 font-semibold text-ink hover:bg-card2 focus:bg-card2 ${FOCUS_RING}`}
                >
                  {item.icon ? <Icon name={item.icon} size={17} className="text-mute" /> : null}
                  <span className="flex-1">{item.label}</span>
                  {item.checked ? <Icon name="ok" size={16} className="text-pri" /> : null}
                </button>
              </li>
            )))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: The shell's words, the language menu and the theme switch** (used by the sign-in screen and the top bar; exercised in Tasks 17 and 24). **Create** `dashboard/src/live/i18n/strings/shell.js`:

```js
// The shell's own words: the rail, the top bar and its menus, the "no access" page, the idle
// warning. From the prototype's dictionary where it has them (shell.js tb_*, deny_*, idle_*; core.js
// logout, lock, notifs; lg_day/lg_night). Written for this plan (AZ/RU/EN need a native speaker's
// review before the pilot): skip, rail, account, version*, units*, bell*, notFound, exitFullscreen,
// idleSpoken. Times and counts stand after a label ("Since: 21:05"), never inside a word that would
// need a suffix or a plural fitted to the number.
export default {
  tr: {
    skip: "Ana içeriğe geç",
    rail: "Ana menü",
    account: "Hesap menüsü",
    signOut: "Çıkış",
    lock: "Ekranı kilitle",
    version: "Sürüm {sha}",
    versionUnknown: "Sürüm bilinmiyor",
    lightTheme: "Gündüz görünümü",
    darkTheme: "Gece görünümü",
    fullscreen: "Tam ekran",
    exitFullscreen: "Tam ekrandan çık",
    keys: "Klavye kısayolları",
    keyClose: "Pencereyi ya da menüyü kapat",
    keyLock: "Ekranı kilitle",
    keyFull: "Tam ekran",
    units: "Birimlerim · {count}",
    allUnits: "Tüm birimlerim",
    unitChoice: "Gösterilen birim",
    bell: "Yanıt bekleyen alarmlar",
    bellCount: "{count} alarm yanıt bekliyor",
    bellNone: "Yanıt bekleyen alarm yok.",
    bellStale: "Yanıt bekleyen: {count} — güncel olmayabilir: canlı akış koptu, yeniden bağlanılıyor.",
    bellConnecting: "Alarm bilgisi yükleniyor…",
    bellUnavailable: "Alarm bilgisi alınamıyor: sunucu bağlantısı yok. Bu, alarm olmadığı anlamına gelmez.",
    bellMore: "ve {count} alarm daha",
    bellSince: "Başlangıç: {time}",
    deny: "Bu sayfaya erişim yetkiniz yok",
    denyHelp: "Gerekiyorsa bölüm sorumlunuzdan ya da bilgi işlemden yetki isteyin.",
    notFound: "Bu sayfa yok.",
    home: "Ana sayfaya dön",
    idle: "Ekran kilitlenecek",
    idleWhy: "Hareket olmadığı için · {seconds} sn",
    idleSpoken: "Ekran {seconds} saniye içinde kilitlenecek. Devam etmek için Devam et düğmesine basın.",
    idleStay: "Devam et",
  },
  az: {
    skip: "Əsas məzmuna keç",
    rail: "Əsas menyu",
    account: "Hesab menyusu",
    signOut: "Çıxış",
    lock: "Ekranı kilidlə",
    version: "Versiya {sha}",
    versionUnknown: "Versiya məlum deyil",
    lightTheme: "Gündüz görünüşü",
    darkTheme: "Gecə görünüşü",
    fullscreen: "Tam ekran",
    exitFullscreen: "Tam ekrandan çıx",
    keys: "Klaviatura qısayolları",
    keyClose: "Pəncərəni və ya menyunu bağla",
    keyLock: "Ekranı kilidlə",
    keyFull: "Tam ekran",
    units: "Bölmələrim · {count}",
    allUnits: "Bütün bölmələrim",
    unitChoice: "Göstərilən bölmə",
    bell: "Cavab gözləyən siqnallar",
    bellCount: "{count} siqnal cavab gözləyir",
    bellNone: "Cavab gözləyən siqnal yoxdur.",
    bellStale: "Cavab gözləyən: {count} — köhnə ola bilər: canlı axın kəsildi, yenidən qoşulur.",
    bellConnecting: "Siqnal məlumatı yüklənir…",
    bellUnavailable: "Siqnal məlumatı alına bilmir: serverlə əlaqə yoxdur. Bu, siqnal olmadığı demək deyil.",
    bellMore: "və daha {count} siqnal",
    bellSince: "Başlanğıc: {time}",
    deny: "Bu səhifəyə icazəniz yoxdur",
    denyHelp: "Lazımdırsa şöbə rəhbərinizdən və ya İT-dən icazə istəyin.",
    notFound: "Belə səhifə yoxdur.",
    home: "Ana səhifəyə qayıt",
    idle: "Ekran kilidlənəcək",
    idleWhy: "Hərəkət olmadığı üçün · {seconds} san",
    idleSpoken: "Ekran {seconds} saniyə ərzində kilidlənəcək. Davam etmək üçün Davam et düyməsini basın.",
    idleStay: "Davam et",
  },
  ru: {
    skip: "Перейти к основному содержимому",
    rail: "Главное меню",
    account: "Меню учётной записи",
    signOut: "Выход",
    lock: "Заблокировать экран",
    version: "Версия {sha}",
    versionUnknown: "Версия неизвестна",
    lightTheme: "Светлая тема",
    darkTheme: "Тёмная тема",
    fullscreen: "Во весь экран",
    exitFullscreen: "Выйти из полноэкранного режима",
    keys: "Горячие клавиши",
    keyClose: "Закрыть окно или меню",
    keyLock: "Заблокировать экран",
    keyFull: "Во весь экран",
    units: "Мои отделения · {count}",
    allUnits: "Все мои отделения",
    unitChoice: "Показываемое отделение",
    bell: "Тревоги без ответа",
    bellCount: "Тревог без ответа: {count}",
    bellNone: "Тревог без ответа нет.",
    bellStale: "Тревог без ответа: {count} — данные могут быть устаревшими: поток прервался, идёт переподключение.",
    bellConnecting: "Загрузка данных о тревогах…",
    bellUnavailable: "Нет данных о тревогах: нет связи с сервером. Это не значит, что тревог нет.",
    bellMore: "и ещё {count}",
    bellSince: "с {time}",
    deny: "Нет доступа к этой странице",
    denyHelp: "При необходимости запросите доступ у руководителя отделения или в ИТ-отделе.",
    notFound: "Такой страницы нет.",
    home: "На главную",
    idle: "Экран будет заблокирован",
    idleWhy: "Из-за бездействия · {seconds} с",
    idleSpoken: "Экран будет заблокирован через {seconds} с. Чтобы продолжить, нажмите «Продолжить».",
    idleStay: "Продолжить",
  },
  en: {
    skip: "Skip to main content",
    rail: "Main menu",
    account: "Account menu",
    signOut: "Sign out",
    lock: "Lock screen",
    version: "Version {sha}",
    versionUnknown: "Version unknown",
    lightTheme: "Light theme",
    darkTheme: "Dark theme",
    fullscreen: "Full screen",
    exitFullscreen: "Exit full screen",
    keys: "Keyboard shortcuts",
    keyClose: "Close a window or menu",
    keyLock: "Lock screen",
    keyFull: "Full screen",
    units: "My units · {count}",
    allUnits: "All my units",
    unitChoice: "Unit shown",
    bell: "Alarms awaiting response",
    bellCount: "Awaiting response: {count}",
    bellNone: "No alarms awaiting response.",
    bellStale: "Awaiting response: {count} — may be out of date: the live stream dropped, reconnecting.",
    bellConnecting: "Loading alarm information…",
    bellUnavailable: "Alarm information unavailable: no connection to the server. This does not mean there are no alarms.",
    bellMore: "and {count} more",
    bellSince: "Since: {time}",
    deny: "You don't have access to this page",
    denyHelp: "Ask your unit lead or IT for access if you need it.",
    notFound: "This page does not exist.",
    home: "Back to home",
    idle: "Screen will lock",
    idleWhy: "Due to inactivity · {seconds} s",
    idleSpoken: "The screen will lock in {seconds} s. Press Stay signed in to continue.",
    idleStay: "Stay signed in",
  },
};
```

**In** `dashboard/src/live/i18n/catalog.js` **replace:**

```js
import dates from "./strings/dates.js";
```
**with:**
```js
import dates from "./strings/dates.js";
import shell from "./strings/shell.js";
```

**In** `dashboard/src/live/i18n/catalog.js` **replace:**

```js
  common, risk, prefs, news2, gallery, ui, errors, dates,
```
**with:**
```js
  common, risk, prefs, news2, gallery, ui, errors, dates, shell,
```

**In** `dashboard/src/live/i18n/strings.test.js` **replace:**

```js
  "gallery.lastLogin", //    Son giriş — the prototype's AZ dictionary
]);
```
**with:**
```js
  "gallery.lastLogin", //    Son giriş — the prototype's AZ dictionary
  "shell.fullscreen", //     Tam ekran — the prototype's AZ dictionary (shell.js tb_full)
  "shell.keyFull", //        Tam ekran — the same (shell.js tb_k_full)
]);
```

**Create** `dashboard/src/live/shell/Prefs.jsx`:

```jsx
// src/live/shell/Prefs.jsx — the language menu and the theme switch: on the top bar and on the
// sign-in screen (the prototype's .lsel and its sun/moon button).
//
// Languages are named by their code and in their own language — no flags: a flag names a country,
// not a language, and the wards speak more than one language of each.
import React from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useTheme } from "../theme/ThemeProvider.jsx";
import { Icon } from "../ui/Icon.jsx";
import { FOCUS_RING } from "../ui/focus.js";
import { MenuButton, TOOL_BUTTON } from "./Menu.jsx";

const LANG_BUTTON =
  `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-ctl border border-line bg-card2 px-2.5 font-text text-12.5 font-bold text-ink hover:border-pri ${FOCUS_RING}`;

export function LanguageMenu() {
  const { t, lang, setLang, langs } = useI18n();
  return (
    <MenuButton
      // The name starts with what the button shows ("AZ"), so a voice command that says what it
      // sees reaches it (WCAG 2.5.3, label in name).
      label={`${lang.toUpperCase()} · ${t("prefs.lang")}`}
      buttonClassName={LANG_BUTTON}
      button={(
        <>
          <span className="font-data">{lang.toUpperCase()}</span>
          <Icon name="chevD" size={14} className="text-mute" />
        </>
      )}
      items={langs.map((l) => ({
        key: l.code,
        label: <span lang={l.code}>{l.native} <span className="font-data text-11 text-mute">{l.code.toUpperCase()}</span></span>,
        checked: l.code === lang,
        onSelect: () => setLang(l.code),
      }))}
    />
  );
}

export function ThemeToggle({ className = "" }) {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const toDay = theme === "gece";
  const label = t(toDay ? "shell.lightTheme" : "shell.darkTheme");
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setTheme(toDay ? "gun" : "gece")}
      className={`${TOOL_BUTTON} ${className}`}
    >
      <Icon name={toDay ? "sun" : "moon"} size={19} />
    </button>
  );
}

/** The prototype's mark (.mk) and name. */
export function Brand({ subtitle, className = "" }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-ctl bg-ink font-display text-20 font-bold text-app">h</span>
      <div className="min-w-0">
        <b className="block font-display text-20 font-bold leading-tight">homunculus</b>
        {subtitle ? <small className="block truncate text-12 text-mute">{subtitle}</small> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  72 passed (72)`, `Tests  1448 passed (1448)`, `✓ built in …`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/shell/Menu.jsx dashboard/src/live/shell/Menu.test.jsx dashboard/src/live/shell/Prefs.jsx dashboard/src/live/i18n/strings/shell.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js
git commit -m "feat(live-ui): menu buttons and popovers; the language menu and the theme switch

ARIA menu buttons (arrows, Home/End, Escape back to the button, Tab
closes); disclosure panels. Languages by code and native name, no flags.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: The server's password rules, in the browser

**Files:**
- Create: `dashboard/src/live/auth/passwordRules.js`
- Test: `dashboard/src/live/auth/passwordRules.test.js`

- [ ] **Step 1: Write the failing test.** **Create** `dashboard/src/live/auth/passwordRules.test.js`:

```js
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PASSWORD_MIN, fieldOfRefusal, passwordProblem } from "./passwordRules.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVICE = fs.readFileSync(
  path.resolve(HERE, "../../../../homunculus-engine/src/homunculus/auth/service.py"), "utf8");

describe("the new-password rules", () => {
  it("are the server's: the same minimum length", () => {
    const m = /^PASSWORD_MIN_LENGTH = (\d+)$/m.exec(SERVICE);
    expect(m, "PASSWORD_MIN_LENGTH in auth/service.py").not.toBeNull();
    expect(PASSWORD_MIN).toBe(Number(m[1]));
  });

  it.each([
    [{ current: "", next: "Yeni-Sifre-1", repeat: "Yeni-Sifre-1" }, { field: "current", key: "errors.passwordRequired" }],
    [{ current: "Gecici-1", next: "kisa", repeat: "kisa" }, { field: "next", key: "errors.passwordTooShort" }],
    [{ current: "Gecici-123", next: "Gecici-123", repeat: "Gecici-123" }, { field: "next", key: "errors.passwordUnchanged" }],
    [{ current: "Gecici-1", next: "Yeni-Sifre-1", repeat: "Yeni-Sifre-2" }, { field: "repeat", key: "auth.mismatch" }],
    [{ current: "Gecici-1", next: "Yeni-Sifre-1", repeat: "Yeni-Sifre-1" }, null],
  ])("%j -> %j", (form, problem) => {
    expect(passwordProblem(form)).toEqual(problem);
  });

  it("puts a server refusal on the field it is about", () => {
    expect(fieldOfRefusal("errors.wrongCurrentPassword")).toBe("current");
    expect(fieldOfRefusal("errors.passwordUnchanged")).toBe("next");
    expect(fieldOfRefusal("errors.network")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/auth/ 2>&1 | grep -E "Error|Tests "
```
Expected: `Failed to resolve import "./passwordRules.js"`.

- [ ] **Step 3: Implement.** **Create** `dashboard/src/live/auth/passwordRules.js`:

```js
// src/live/auth/passwordRules.js — what a new password must be, checked before it is sent.
//
// The server's rules, and only those (auth/service.py change_password: at least
// PASSWORD_MIN_LENGTH characters, different from the current one); passwordRules.test.js reads
// the number from there. A stricter rule enforced only here would be a rule the administrator's
// own tools do not know: the policy is the server's to tighten, and this file follows it.
export const PASSWORD_MIN = 8;

/** The first problem with the form, as {field, key} (an i18n key), or null. Fields: current,
 *  next, repeat. In the order a person fills them in. */
export function passwordProblem({ current, next, repeat }) {
  if (!current) return { field: "current", key: "errors.passwordRequired" };
  if (!next || next.length < PASSWORD_MIN) return { field: "next", key: "errors.passwordTooShort" };
  if (next === current) return { field: "next", key: "errors.passwordUnchanged" };
  if (repeat !== next) return { field: "repeat", key: "auth.mismatch" };
  return null;
}

/** Which field a refusal from the server belongs to, by its errors.* key; null: the whole form. */
export function fieldOfRefusal(key) {
  if (key === "errors.wrongCurrentPassword") return "current";
  if (key === "errors.passwordTooShort" || key === "errors.passwordUnchanged" || key === "errors.passwordTooLong") return "next";
  return null;
}
```

- [ ] **Step 4: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  73 passed (73)`, `Tests  1455 passed (1455)`, `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/auth/passwordRules.js dashboard/src/live/auth/passwordRules.test.js
git commit -m "feat(live-ui): the new-password rules are the server's (PASSWORD_MIN_LENGTH)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: The frame of the screens before the shell

**Files:**
- Create: `dashboard/src/live/auth/AuthLayout.jsx`, `dashboard/src/live/i18n/strings/auth.js`
- Modify: `dashboard/src/live/i18n/catalog.js`, `dashboard/src/live/i18n/strings.test.js`, `dashboard/src/live/theme/tokens.test.js`
- Test: `dashboard/src/live/auth/AuthLayout.test.jsx`

- [ ] **Step 1: Write the failing test.** **Create** `dashboard/src/live/auth/AuthLayout.test.jsx`:

```jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n/I18nProvider.jsx";
import { AuthLayout, stepOf } from "./AuthLayout.jsx";

describe("AuthLayout", () => {
  it("counts the steps after the password: TOTP 2/3, the password change 3/3", () => {
    expect(stepOf("mfa", { mfa: true, password: true })).toEqual({ current: 2, total: 3 });
    expect(stepOf("password", { mfa: true, password: true })).toEqual({ current: 3, total: 3 });
    expect(stepOf("password", { mfa: false, password: true })).toEqual({ current: 2, total: 2 });
    expect(stepOf("signedOut", { mfa: false, password: false })).toBeUndefined();
  });

  it("keeps the hero out of the accessibility tree; the form's title is the page's h1", () => {
    const { container } = render(<I18nProvider><AuthLayout><h1>Daxil olun</h1></AuthLayout></I18nProvider>);
    const hero = container.querySelector("[data-theme='gece']");
    expect(hero).toHaveAttribute("aria-hidden", "true");
    expect(hero).toHaveTextContent("Hər çarpayı, hər növbə — bir baxışda.");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("heading", { level: 1 }));
    expect(screen.getByRole("button", { name: "AZ · Dil" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/auth/AuthLayout.test.jsx 2>&1 | grep -E "Error|Tests "
```
Expected: `Failed to resolve import "./AuthLayout.jsx"`.

- [ ] **Step 3: The words.** **Create** `dashboard/src/live/i18n/strings/auth.js`:

```js
// Sign-in, the TOTP step, the forced password change, and why the sign-in form opened. TR is the
// source. From the prototype's dictionary (core.js login_*, username, password, remember, signin,
// forgot, hero_sub; shell.js lg_*; ceviri-sozluk "İki adımlı doğrulama", "Doğrula", "Yeni şifre
// belirleyin", "Yeni şifre (tekrar)", "İki şifre aynı değil.", "Güvenli çıkış yapıldı.",
// "← Girişe dön", "Şifreyi kaydet ve devam et"). Written for this plan, AZ/RU/EN to be reviewed
// by a native speaker before the pilot: usernameHint, show, forgotHelp (roadmap D4: no SMS
// or e-mail), retryIn, enrol*, qr*, manualKey, copy*, loading, retry, current*, rule, notice.*,
// restoring, unreachable*.
export default {
  tr: {
    pill: "Yoğun bakım için klinik karar desteği",
    headline: "Her yatak, her nöbet — tek bakışta.",
    lead: "Cihazlardan gelen veriyi toplar, kötüleşmeyi erken gösterir, doğru ekibi çağırır. Kararı hekim verir.",
    trustDecides: "Kararı hekim verir",
    trustOnSite: "Veri hastanede",
    title: "Oturum açın",
    sub: "Kurumsal kullanıcı adınız ve şifrenizle",
    username: "Kullanıcı adı",
    usernameHint: "Hastane hesabınızın kullanıcı adı ya da e-postanız",
    password: "Şifre",
    show: "Şifreyi göster",
    caps: "Caps Lock açık",
    remember: "Kullanıcı adımı hatırla",
    submit: "Giriş yap",
    busy: "Kontrol ediliyor…",
    forgot: "Şifremi unuttum",
    forgotHelp: "Bilgi işlem birimine başvurun: size geçici bir şifre verilir, ilk girişte kendi şifrenizi belirlersiniz. Hastane hesabıyla (Active Directory) girenler şifrelerini hastanenin olağan yolundan değiştirir.",
    retryIn: "{seconds} sn sonra tekrar deneyebilirsiniz.",
    step: "Adım {current}/{total}",
    mfaTitle: "İki adımlı doğrulama",
    mfaSub: "Doğrulayıcı uygulamadaki 6 haneli kodu girin.",
    enrolTitle: "Doğrulayıcıyı kurun",
    enrolSub: "Grubunuz iki adımlı doğrulama istiyor. Doğrulayıcı uygulamayla (Google ya da Microsoft Authenticator) bu kodu okutun, sonra uygulamanın gösterdiği 6 haneli kodu girin.",
    qrAlt: "Doğrulayıcı uygulama için QR kodu",
    qrUnavailable: "QR kodu çizilemedi; anahtarı elle girin.",
    manualKey: "Elle giriş anahtarı",
    copy: "Kopyala",
    copied: "Kopyalandı",
    loading: "Hazırlanıyor…",
    retry: "Tekrar dene",
    code: "6 haneli kod",
    verify: "Doğrula",
    back: "Girişe dön",
    passwordTitle: "Yeni şifre belirleyin",
    passwordSub: "Bu hesabın ilk girişi ya da şifresi yönetici tarafından sıfırlandı. Devam etmek için kendi şifrenizi belirleyin.",
    currentTemporary: "Size verilen geçici şifre",
    current: "Mevcut şifre",
    newPassword: "Yeni şifre",
    repeat: "Yeni şifre (tekrar)",
    rule: "En az {min} karakter; mevcut şifreden farklı olmalı.",
    mismatch: "İki şifre aynı değil.",
    saveAndContinue: "Şifreyi kaydet ve devam et",
    leave: "Çıkış yap",
    restoring: "Oturum kontrol ediliyor…",
    unreachableTitle: "Sunucuya ulaşılamıyor",
    unreachableBody: "Oturumunuz korunuyor; bağlantı gelince kaldığınız yerden devam edersiniz.",
    notice: {
      signedOut: "Güvenli çıkış yapıldı.",
      sessionEnded: "Oturumunuz sona erdi; yeniden giriş yapın.",
      signedOutElsewhere: "Bu tarayıcının başka bir sekmesinde çıkış yapıldı.",
      lockedOut: "Kilit ekranında 3 kez hatalı şifre girildi; oturum kapatıldı. Yeniden giriş yapın.",
      lockExpired: "Ekran çok uzun süre kilitli kaldı; oturum kapatıldı. Yeniden giriş yapın.",
      noPermissions: "Hesabınıza bu hastanede bir yetki tanımlanmamış. Sistem yöneticinizle görüşün.",
      noScreen: "Hesabınızın yetkileri bu arayüzdeki ekranlardan hiçbirini açmıyor (ör. yalnız cihaz yönetimi). Sistem yöneticinizle görüşün.",
    },
  },
  az: {
    pill: "Reanimasiya üçün klinik qərar dəstəyi",
    headline: "Hər çarpayı, hər növbə — bir baxışda.",
    lead: "Cihazlardan gələn məlumatı toplayır, pisləşməni erkən göstərir, doğru komandanı çağırır. Qərarı həkim verir.",
    trustDecides: "Qərarı həkim verir",
    trustOnSite: "Məlumat xəstəxanada",
    title: "Daxil olun",
    sub: "Korporativ istifadəçi adınız və şifrənizlə",
    username: "İstifadəçi adı",
    usernameHint: "Xəstəxana hesabınızın istifadəçi adı və ya e-poçtunuz",
    password: "Şifrə",
    show: "Şifrəni göstər",
    caps: "Caps Lock açıqdır",
    remember: "İstifadəçi adını xatırla",
    submit: "Daxil ol",
    busy: "Yoxlanılır…",
    forgot: "Şifrəni unutmusunuz?",
    forgotHelp: "İT şöbəsinə müraciət edin: sizə müvəqqəti şifrə verilir, ilk girişdə öz şifrənizi təyin edirsiniz. Xəstəxana hesabı (Active Directory) ilə daxil olanlar şifrəni xəstəxananın adi qaydası ilə dəyişir.",
    retryIn: "{seconds} saniyədən sonra yenidən cəhd edə bilərsiniz.",
    step: "Addım {current}/{total}",
    mfaTitle: "İki addımlı doğrulama",
    mfaSub: "Autentifikator tətbiqindəki 6 rəqəmli kodu daxil edin.",
    enrolTitle: "Autentifikatoru quraşdırın",
    enrolSub: "Qrupunuz iki addımlı doğrulama tələb edir. Autentifikator tətbiqi (Google və ya Microsoft Authenticator) ilə bu kodu oxudun, sonra tətbiqin göstərdiyi 6 rəqəmli kodu daxil edin.",
    qrAlt: "Autentifikator tətbiqi üçün QR kod",
    qrUnavailable: "QR kodu çəkmək mümkün olmadı; açarı əl ilə daxil edin.",
    manualKey: "Əl ilə daxil etmə açarı",
    copy: "Kopyala",
    copied: "Kopyalandı",
    loading: "Hazırlanır…",
    retry: "Yenidən cəhd et",
    code: "6 rəqəmli kod",
    verify: "Təsdiqlə",
    back: "Girişə qayıt",
    passwordTitle: "Yeni şifrə təyin edin",
    passwordSub: "Bu hesaba ilk dəfə daxil olursunuz və ya şifrəsi administrator tərəfindən sıfırlanıb. Davam etmək üçün öz şifrənizi təyin edin.",
    currentTemporary: "Sizə verilən müvəqqəti şifrə",
    current: "Cari şifrə",
    newPassword: "Yeni şifrə",
    repeat: "Yeni şifrə (təkrar)",
    rule: "Ən azı {min} simvol; cari şifrədən fərqli olmalıdır.",
    mismatch: "İki şifrə eyni deyil.",
    saveAndContinue: "Şifrəni yadda saxla və davam et",
    leave: "Çıxış et",
    restoring: "Sessiya yoxlanılır…",
    unreachableTitle: "Serverə qoşulmaq mümkün deyil",
    unreachableBody: "Sessiyanız qorunur; əlaqə bərpa olunanda qaldığınız yerdən davam edəcəksiniz.",
    notice: {
      signedOut: "Təhlükəsiz çıxış edildi.",
      sessionEnded: "Sessiyanız başa çatıb; yenidən daxil olun.",
      signedOutElsewhere: "Bu brauzerin başqa bir vərəqində çıxış edildi.",
      lockedOut: "Kilid ekranında 3 dəfə səhv şifrə daxil edildi; sessiya bağlandı. Yenidən daxil olun.",
      lockExpired: "Ekran çox uzun müddət kilidli qaldı; sessiya bağlandı. Yenidən daxil olun.",
      noPermissions: "Hesabınıza bu xəstəxanada heç bir səlahiyyət təyin edilməyib. Sistem administratorunuza müraciət edin.",
      noScreen: "Hesabınızın səlahiyyətləri bu interfeysdəki ekranların heç birini açmır (məs. yalnız cihaz idarəsi). Sistem administratorunuza müraciət edin.",
    },
  },
  ru: {
    pill: "Поддержка клинических решений для реанимации",
    headline: "Каждая койка, каждая смена — с одного взгляда.",
    lead: "Собирает данные с приборов, рано показывает ухудшение, вызывает нужную команду. Решение за врачом.",
    trustDecides: "Решение за врачом",
    trustOnSite: "Данные в больнице",
    title: "Вход в систему",
    sub: "С корпоративным логином и паролем",
    username: "Имя пользователя",
    usernameHint: "Имя пользователя больничной учётной записи или эл. почта",
    password: "Пароль",
    show: "Показать пароль",
    caps: "Включён Caps Lock",
    remember: "Запомнить имя пользователя",
    submit: "Войти",
    busy: "Проверка…",
    forgot: "Забыли пароль?",
    forgotHelp: "Обратитесь в ИТ-отдел: вам выдадут временный пароль, при первом входе вы зададите свой. Пользователи больничной учётной записи (Active Directory) меняют пароль обычным для больницы способом.",
    retryIn: "Повторить можно через {seconds} с.",
    step: "Шаг {current}/{total}",
    mfaTitle: "Двухэтапная проверка",
    mfaSub: "Введите 6-значный код из приложения-аутентификатора.",
    enrolTitle: "Настройте аутентификатор",
    enrolSub: "Ваша группа требует двухэтапной проверки. Отсканируйте этот код приложением-аутентификатором (Google или Microsoft Authenticator), затем введите 6-значный код из приложения.",
    qrAlt: "QR-код для приложения-аутентификатора",
    qrUnavailable: "Не удалось нарисовать QR-код; введите ключ вручную.",
    manualKey: "Ключ для ручного ввода",
    copy: "Копировать",
    copied: "Скопировано",
    loading: "Подготовка…",
    retry: "Повторить",
    code: "6-значный код",
    verify: "Подтвердить",
    back: "Вернуться ко входу",
    passwordTitle: "Задайте новый пароль",
    passwordSub: "Это первый вход в учётную запись, или администратор сбросил пароль. Чтобы продолжить, задайте свой пароль.",
    currentTemporary: "Выданный вам временный пароль",
    current: "Текущий пароль",
    newPassword: "Новый пароль",
    repeat: "Новый пароль (повторно)",
    rule: "Не менее {min} символов; должен отличаться от текущего.",
    mismatch: "Пароли не совпадают.",
    saveAndContinue: "Сохранить пароль и продолжить",
    leave: "Выйти",
    restoring: "Проверка сеанса…",
    unreachableTitle: "Сервер недоступен",
    unreachableBody: "Ваш сеанс сохранён; когда связь восстановится, вы продолжите с того же места.",
    notice: {
      signedOut: "Выполнен безопасный выход.",
      sessionEnded: "Ваш сеанс завершён; войдите снова.",
      signedOutElsewhere: "В другой вкладке этого браузера выполнен выход.",
      lockedOut: "На экране блокировки трижды введён неверный пароль; сеанс закрыт. Войдите снова.",
      lockExpired: "Экран был заблокирован слишком долго; сеанс закрыт. Войдите снова.",
      noPermissions: "Вашей учётной записи не назначены права в этой больнице. Обратитесь к системному администратору.",
      noScreen: "Права вашей учётной записи не открывают ни одного экрана этого интерфейса (например, только управление устройствами). Обратитесь к системному администратору.",
    },
  },
  en: {
    pill: "Clinical decision support for critical care",
    headline: "Every bed, every shift — at a glance.",
    lead: "Collects device data, surfaces deterioration early and calls the right team. The physician decides.",
    trustDecides: "The physician decides",
    trustOnSite: "Data stays on site",
    title: "Sign in",
    sub: "With your hospital username and password",
    username: "Username",
    usernameHint: "Your hospital account's username, or your email",
    password: "Password",
    show: "Show password",
    caps: "Caps Lock is on",
    remember: "Remember username",
    submit: "Sign in",
    busy: "Checking…",
    forgot: "Forgot password?",
    forgotHelp: "Contact IT: you are given a temporary password and choose your own at the first sign-in. If you sign in with your hospital account (Active Directory), change your password the hospital's usual way.",
    retryIn: "You can try again in {seconds} s.",
    step: "Step {current}/{total}",
    mfaTitle: "Two-step verification",
    mfaSub: "Enter the 6-digit code from your authenticator app.",
    enrolTitle: "Set up your authenticator",
    enrolSub: "Your group requires two-step verification. Scan this code with an authenticator app (Google or Microsoft Authenticator), then enter the 6-digit code the app shows.",
    qrAlt: "QR code for the authenticator app",
    qrUnavailable: "The QR code could not be drawn; enter the key by hand.",
    manualKey: "Key for manual entry",
    copy: "Copy",
    copied: "Copied",
    loading: "Preparing…",
    retry: "Try again",
    code: "6-digit code",
    verify: "Verify",
    back: "Back to sign-in",
    passwordTitle: "Set a new password",
    passwordSub: "This is the account's first sign-in, or an administrator reset the password. Set your own password to continue.",
    currentTemporary: "The temporary password you were given",
    current: "Current password",
    newPassword: "New password",
    repeat: "New password (again)",
    rule: "At least {min} characters; different from the current one.",
    mismatch: "The two passwords do not match.",
    saveAndContinue: "Save password and continue",
    leave: "Sign out",
    restoring: "Checking your session…",
    unreachableTitle: "The server cannot be reached",
    unreachableBody: "Your session is kept; when the connection is back you continue where you were.",
    notice: {
      signedOut: "Signed out securely.",
      sessionEnded: "Your session has ended; please sign in again.",
      signedOutElsewhere: "Another tab of this browser signed out.",
      lockedOut: "A wrong password was entered 3 times at the lock screen; the session was closed. Please sign in again.",
      lockExpired: "The screen stayed locked too long; the session was closed. Please sign in again.",
      noPermissions: "Your account has no rights in this hospital. Contact your system administrator.",
      noScreen: "Your account's rights open none of this interface's screens (for example, device management only). Contact your system administrator.",
    },
  },
};
```

- [ ] **Step 4: The frame.** **Create** `dashboard/src/live/auth/AuthLayout.jsx`:

```jsx
// src/live/auth/AuthLayout.jsx — the frame of every screen before the shell: sign-in, the TOTP step,
// the forced password change, the session check. The prototype's .login.lg2 (shell.js authScreen):
// a dark hero on the left (hidden under 861 px), the form on the right, language and theme in the
// corner.
//
// The hero is decoration (aria-hidden; the form's title is the page's h1). It is always dark, as in
// the prototype: it carries data-theme="gece", so it takes the Gece
// tokens whatever the page's theme (contrast-tested there). It shows no invented ward: the
// prototype's animated scene ("REA03 · SpO₂ 86") would put fabricated clinical events on the door
// of a live system.
import React from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { Icon } from "../ui/Icon.jsx";
import { Brand, LanguageMenu, ThemeToggle } from "../shell/Prefs.jsx";

/** `step`: {current, total} for the "Step 2/3" line, or nothing. */
export function AuthLayout({ step, children }) {
  const { t } = useI18n();
  return (
    <div className="grid min-h-full bg-app font-text text-14.5 text-ink min-[861px]:grid-cols-[1.1fr_1fr]">
      <section
        data-theme="gece"
        aria-hidden="true"
        className="relative hidden flex-col overflow-hidden bg-[radial-gradient(120%_90%_at_10%_0%,color-mix(in_srgb,var(--pri)_25%,var(--page)),var(--page)_60%)] px-12 pb-7 pt-9 text-ink min-[861px]:flex"
      >
        <Brand />
        <div className="my-auto max-w-[540px] py-8">
          <span className="mb-[18px] inline-flex items-center gap-2 rounded-full border border-[color:color-mix(in_srgb,var(--pri)_35%,transparent)] bg-pri-soft px-3 py-1.5 text-12 font-bold text-ink">
            <i className="h-1.5 w-1.5 rounded-full bg-pri" />
            {t("auth.pill")}
          </span>
          <p className="m-0 mb-3 font-display text-40 font-bold leading-[1.08]">{t("auth.headline")}</p>
          <p className="m-0 max-w-[500px] text-mute">{t("auth.lead")}</p>
        </div>
        <div className="flex flex-wrap gap-[18px] border-t border-line pt-3.5 text-12.5 text-mute">
          <span className="flex items-center gap-1.5"><Icon name="shield" size={15} className="text-pri" />{t("auth.trustDecides")}</span>
          <span className="flex items-center gap-1.5"><Icon name="building" size={15} className="text-pri" />{t("auth.trustOnSite")}</span>
        </div>
      </section>
      <div className="relative flex items-center justify-center px-5 py-16">
        <div className="absolute right-5 top-[18px] z-[5] flex items-center gap-2">
          <LanguageMenu />
          <ThemeToggle className="border border-line2 bg-card" />
        </div>
        <main className="w-full max-w-[410px]">
          <Brand className="mb-[22px] min-[861px]:hidden" />
          {step ? (
            <p className="mb-7 flex items-center gap-2 text-11.5 font-bold tracking-[.04em] text-mute">
              {t("auth.step", step)}
              <span aria-hidden="true" className="flex gap-1">
                {Array.from({ length: step.total }, (_, i) => (
                  <em key={i} className={`h-1 w-[18px] rounded-sm ${i < step.current ? "bg-pri" : "bg-line2"}`} />
                ))}
              </span>
            </p>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

/** The step a session is on, for AuthLayout: sign-in is step 1, then TOTP, then the password. */
export function stepOf(phase, steps) {
  const total = 1 + (steps.mfa ? 1 : 0) + (steps.password ? 1 : 0);
  if (total === 1) return undefined;
  if (phase === "mfa") return { current: 2, total };
  if (phase === "password") return { current: total, total };
  return undefined;
}
```

**In** `dashboard/src/live/i18n/catalog.js` **replace:**

```js
import shell from "./strings/shell.js";
```
**with:**
```js
import shell from "./strings/shell.js";
import auth from "./strings/auth.js";
```

**In** `dashboard/src/live/i18n/catalog.js` **replace:**

```js
  common, risk, prefs, news2, gallery, ui, errors, dates, shell,
```
**with:**
```js
  common, risk, prefs, news2, gallery, ui, errors, dates, shell, auth,
```

**In** `dashboard/src/live/i18n/strings.test.js` **replace:**

```js
  "shell.keyFull", //        Tam ekran — the same (shell.js tb_k_full)
]);
```
**with:**
```js
  "shell.keyFull", //        Tam ekran — the same (shell.js tb_k_full)
  "auth.copy", //            Kopyala — Azerbaijani imperative of "kopyalamaq"
  "auth.copied", //          Kopyalandı — its passive past
]);
```

**In** `dashboard/src/live/theme/tokens.test.js` **replace:**

```js
describe("token registry", () => {
```
**with:**
```js
// The sign-in hero and the lock screen are always dark (data-theme="gece" on their roots) and lie
// on a radial gradient from color-mix(in srgb, var(--pri) 25%, var(--page)) to the page colour:
// their text is held to 4.5:1 at the gradient's lightest point, and the primary icons to 3:1.
describe("the dark gradient of the sign-in hero and the lock screen (Gece)", () => {
  const glow = tint("gece", "pri", 0.25, "page");
  it.each(["ink", "mute"])("%s clears 4.5:1 on the gradient's lightest point", (name) => {
    expect(ratio(solid("gece", name), glow)).toBeGreaterThanOrEqual(BODY);
  });
  // The hero's pill is ink on priSoft: pri text there would be 4.09:1.
  it("pri (icons) clears 3:1 there, and the pill's ink 4.5:1 on priSoft over it", () => {
    expect(ratio(solid("gece", "pri"), glow)).toBeGreaterThanOrEqual(UI);
    const pill = parse(THEMES.gece.priSoft);
    const ground = pill.rgb.map((v, i) => v * pill.a + glow[i] * (1 - pill.a));
    expect(ratio(solid("gece", "ink"), ground)).toBeGreaterThanOrEqual(BODY);
  });
});

describe("token registry", () => {
```

- [ ] **Step 5: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  74 passed (74)`, `Tests  1460 passed (1460)` (2 here, 3 contrast cases in `tokens.test.js`), `✓ built in …`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/auth/AuthLayout.jsx dashboard/src/live/auth/AuthLayout.test.jsx dashboard/src/live/i18n/strings/auth.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/theme/tokens.test.js
git commit -m "feat(live-ui): the sign-in frame — a dark hero with no invented ward, the form, the step line

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: The password change form, the forced step, the session check

**Files:**
- Create: `dashboard/src/live/auth/PasswordForm.jsx`, `dashboard/src/live/auth/PasswordStep.jsx`, `dashboard/src/live/auth/SessionWait.jsx`
- Test: `dashboard/src/live/auth/PasswordForm.test.jsx`

- [ ] **Step 1: Write the failing test.** **Create** `dashboard/src/live/auth/PasswordForm.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { mount, refusal } from "../session/mount.testutil.jsx";
import { PasswordForm } from "./PasswordForm.jsx";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const fill = (current, next, repeat) => {
  fireEvent.change(screen.getByLabelText(/^Cari şifrə/), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(/^Yeni şifrə \*/), { target: { value: next } });
  fireEvent.change(screen.getByLabelText(/Yeni şifrə \(təkrar\)/), { target: { value: repeat } });
  fireEvent.click(screen.getByRole("button", { name: "Saxla" }));
};

describe("PasswordForm", () => {
  it("checks the server's rules before sending, and points at the field", async () => {
    const { api } = await mount(<PasswordForm submitLabel="Saxla" />);
    fill("Gizli-Sifre-1", "Yeni-Sifre-22", "Yeni-Sifre-23");
    const repeat = screen.getByLabelText(/Yeni şifrə \(təkrar\)/);
    expect(repeat).toHaveAccessibleDescription("İki şifrə eyni deyil.");
    expect(document.activeElement).toBe(repeat);
    fill("Gizli-Sifre-1", "kisa", "kisa");
    expect(screen.getByLabelText(/^Yeni şifrə \*/)).toHaveAccessibleDescription(/Yeni şifrə ən azı 8 simvol olmalıdır/);
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it("puts the server's refusal of the current password on its field", async () => {
    const { api } = await mount(<PasswordForm submitLabel="Saxla" />);
    api.changePassword.mockRejectedValue(refusal(400, "Mevcut parola yanlış"));
    fill("yanlis-1", "Yeni-Sifre-22", "Yeni-Sifre-22");
    await waitFor(() => expect(screen.getByLabelText(/^Cari şifrə/)).toHaveAccessibleDescription("Cari şifrə səhvdir."));
    expect(document.activeElement).toBe(screen.getByLabelText(/^Cari şifrə/));
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/auth/PasswordForm.test.jsx 2>&1 | grep -E "Error|Tests "
```
Expected: `Failed to resolve import "./PasswordForm.jsx"`.

- [ ] **Step 3: Implement.** **Create** `dashboard/src/live/auth/PasswordForm.jsx`:

```jsx
// src/live/auth/PasswordForm.jsx — the user's own password change: the forced one after a temporary
// password (PasswordStep) and the voluntary one in Settings. One form, the server's rules
// (passwordRules.js), the server's refusals translated and put on the field they are about.
import React, { useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { apiErrorKey, apiErrorText } from "../apiErrors.js";
import { Alert, Button, Field, Input } from "../ui/index.js";
import { PASSWORD_MIN, fieldOfRefusal, passwordProblem } from "./passwordRules.js";

const EMPTY = { current: "", next: "", repeat: "" };

/** `temporary`: the current password is the one an administrator gave (its label says so).
 *  `onDone` runs after the server took the change. */
export function PasswordForm({ temporary = false, submitLabel, onDone }) {
  const { t } = useI18n();
  const { store } = useSession();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);
  const refs = { current: useRef(null), next: useRef(null), repeat: useRef(null) };

  const edit = (field) => (event) => {
    setForm((f) => ({ ...f, [field]: event.target.value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setFailure(null);
    const problem = passwordProblem(form);
    if (problem) {
      setErrors({ [problem.field]: t(problem.key) });
      refs[problem.field].current?.focus();     // the error is read with the field (Field)
      return;
    }
    setBusy(true);
    try {
      await store.changePassword(form.current, form.next);
      setForm(EMPTY);
      setErrors({});
      onDone?.();
    } catch (err) {
      const field = fieldOfRefusal(apiErrorKey(err)?.key);
      if (field) {
        setErrors({ [field]: apiErrorText(t, err) });
        refs[field].current?.focus();
      } else {
        setFailure(apiErrorText(t, err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={submit}>
      {failure ? <Alert className="mb-3">{failure}</Alert> : null}
      <Field layout="col" required label={t(temporary ? "auth.currentTemporary" : "auth.current")} error={errors.current}>
        <Input ref={refs.current} type="password" autoComplete="current-password" value={form.current} onChange={edit("current")} />
      </Field>
      <Field layout="col" required label={t("auth.newPassword")} hint={t("auth.rule", { min: PASSWORD_MIN })} error={errors.next}>
        <Input ref={refs.next} type="password" autoComplete="new-password" value={form.next} onChange={edit("next")} />
      </Field>
      <Field layout="col" required label={t("auth.repeat")} error={errors.repeat}>
        <Input ref={refs.repeat} type="password" autoComplete="new-password" value={form.repeat} onChange={edit("repeat")} />
      </Field>
      <Button type="submit" variant="primary" size="lg" busy={busy} className="mt-2 w-full justify-center">
        {submitLabel}
      </Button>
    </form>
  );
}
```

**Create** `dashboard/src/live/auth/PasswordStep.jsx` (exercised end to end in Task 25):

```jsx
// src/live/auth/PasswordStep.jsx — a temporary password is replaced before anything else (roadmap
// D4; the server holds every other route at 403 `password_change_required` meanwhile). After the
// TOTP step when both are due. Leaving signs out: nothing of the session is kept.
import React from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { FOCUS_RING } from "../ui/focus.js";
import { AuthLayout, stepOf } from "./AuthLayout.jsx";
import { PasswordForm } from "./PasswordForm.jsx";

export function PasswordStep() {
  const { t } = useI18n();
  const { store, steps } = useSession();
  return (
    <AuthLayout step={stepOf("password", steps)}>
      <h1 className="m-0 mb-1 font-display text-28 font-bold">{t("auth.passwordTitle")}</h1>
      <p className="m-0 mb-5 text-14 text-mute">{t("auth.passwordSub")}</p>
      <PasswordForm temporary submitLabel={t("auth.saveAndContinue")} />
      <button
        type="button"
        onClick={() => store.cancel()}
        className={`mt-4 rounded-lg px-1 text-13 font-semibold text-pri ${FOCUS_RING}`}
      >
        {t("auth.leave")}
      </button>
    </AuthLayout>
  );
}
```

**Create** `dashboard/src/live/auth/SessionWait.jsx` (exercised end to end in Task 25):

```jsx
// src/live/auth/SessionWait.jsx — while a stored session is checked (a page load), and when the
// server did not answer that check. The tokens are kept in the second case: an outage never signs
// a clinician out (liveStore.js's rule). Retry, or sign out by choice.
import React from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { PHASE } from "../session/sessionStore.js";
import { apiErrorText } from "../apiErrors.js";
import { Alert, Button } from "../ui/index.js";
import { AuthLayout } from "./AuthLayout.jsx";

export function SessionWait() {
  const { t } = useI18n();
  const { phase, error, store } = useSession();
  if (phase === PHASE.RESTORING) {
    return (
      <AuthLayout>
        <h1 className="sr-only">{t("auth.title")}</h1>
        <p role="status" className="text-14 text-mute">{t("auth.restoring")}</p>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout>
      <h1 className="m-0 mb-1 font-display text-28 font-bold">{t("auth.unreachableTitle")}</h1>
      <p className="m-0 mb-4 text-14 text-mute">{t("auth.unreachableBody")}</p>
      {error ? <Alert className="mb-4">{apiErrorText(t, error)}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon="swap" onClick={() => store.retry()}>{t("auth.retry")}</Button>
        <Button variant="ghost" icon="out" onClick={() => store.signOut()}>{t("auth.leave")}</Button>
      </div>
    </AuthLayout>
  );
}
```

- [ ] **Step 4: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  75 passed (75)`, `Tests  1462 passed (1462)`, `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/auth/PasswordForm.jsx dashboard/src/live/auth/PasswordForm.test.jsx dashboard/src/live/auth/PasswordStep.jsx dashboard/src/live/auth/SessionWait.jsx
git commit -m "feat(live-ui): the password change form, the forced step, the session check

The server's rules checked first and its refusals put on their field; a
temporary password is replaced before the shell; a session the server
could not check is kept, with retry and sign-out.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: Sign-in

**Files:**
- Create: `dashboard/src/live/auth/SignIn.jsx`
- Test: `dashboard/src/live/auth/SignIn.test.jsx`

- [ ] **Step 1: Write the failing test.** **Create** `dashboard/src/live/auth/SignIn.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { mount, refusal } from "../session/mount.testutil.jsx";
import { token } from "../session/testTokens.testutil.js";
import { NOTICE } from "../session/sessionStore.js";
import { SignIn } from "./SignIn.jsx";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("SignIn", () => {
  it("shows a password on request and warns about Caps Lock", async () => {
    await mount(<SignIn />, { access: null });
    const password = screen.getByLabelText(/^Şifrə \*$/);
    expect(password).toHaveAttribute("type", "password");
    const toggle = screen.getByRole("button", { name: "Şifrəni göstər" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(password).toHaveAttribute("type", "text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");               // the state; the name stays
    expect(toggle).toHaveAccessibleName("Şifrəni göstər");
    fireEvent.keyDown(password, { key: "A", modifierCapsLock: true });
    expect(screen.getByRole("status")).toHaveTextContent("Caps Lock açıqdır");
  });

  it("fills in a remembered username and starts at the password", async () => {
    localStorage.setItem("hmc.rememberUser", "ayse");
    await mount(<SignIn />, { access: null });
    expect(screen.getByLabelText(/^İstifadəçi adı \*$/)).toHaveValue("ayse");
    expect(screen.getByLabelText("İstifadəçi adını xatırla")).toBeChecked();
    expect(document.activeElement).toBe(screen.getByLabelText(/^Şifrə \*$/));
  });

  it("says why it opened: a sign-out as a status, a lock-out as an alert", async () => {
    const { api, store } = await mount(<SignIn />);
    store.signOut();
    const out = await screen.findByText("Təhlükəsiz çıxış edildi.");
    expect(out.closest("[role]")).toHaveAttribute("role", "status");

    api.store(token());
    await store.restore();
    store.lock();
    api.reauth.mockRejectedValue(refusal(403, "Parola hatalı"));
    for (let i = 0; i < 3; i += 1) await store.unlock("yanlis").catch(() => {});
    expect(store.getState().notice).toEqual({ code: NOTICE.LOCKED_OUT });
    const locked = await screen.findByText(/Kilid ekranında 3 dəfə səhv şifrə daxil edildi/);
    expect(locked.closest("[role]")).toHaveAttribute("role", "alert");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/auth/SignIn.test.jsx 2>&1 | grep -E "Error|Tests "
```
Expected: `Failed to resolve import "./SignIn.jsx"`.

- [ ] **Step 3: Implement.** **Create** `dashboard/src/live/auth/SignIn.jsx`:

```jsx
// src/live/auth/SignIn.jsx — the sign-in form (the prototype's VIEWS.login).
//
// Username or e-mail and password; an AD account signs in with the same form (spec §4). "Remember
// my username" keeps the name only — never the password — and opens nothing (roadmap:
// loginRemember). A refusal is an announced alert in the user's language; a 429 that says how long
// to wait holds the button that long. "Forgot password" says whom to ask (roadmap D4: no SMS, no
// e-mail). Nothing here is clinical data.
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { NOTICE } from "../session/sessionStore.js";
import { readRememberedUser } from "../session/browserState.js";
import { apiErrorText } from "../apiErrors.js";
import { Alert, Button, Field, Icon, Input, Note } from "../ui/index.js";
import { FOCUS_RING } from "../ui/focus.js";
import { AuthLayout } from "./AuthLayout.jsx";

// How the reason the form opened is shown: a plain fact, or a refusal.
const NOTICE_TONE = {
  [NOTICE.SIGNED_OUT]: "info",
  [NOTICE.ELSEWHERE]: "info",
  [NOTICE.SESSION_ENDED]: "crit",
  [NOTICE.LOCKED_OUT]: "crit",
  [NOTICE.LOCK_EXPIRED]: "info",
  [NOTICE.NO_PERMISSIONS]: "crit",
  [NOTICE.NO_SCREEN]: "crit",
};

export function SignIn() {
  const { t } = useI18n();
  const { store, notice } = useSession();
  const [remembered] = useState(readRememberedUser);
  const [login, setLogin] = useState(remembered);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(Boolean(remembered));
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [wait, setWait] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const loginRef = useRef(null);
  const passwordRef = useRef(null);

  useEffect(() => {
    (remembered ? passwordRef : loginRef).current?.focus();
  }, [remembered]);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const timer = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const submit = async (event) => {
    event.preventDefault();
    if (busy || wait > 0) return;
    setFailure(null);
    if (!login.trim()) {
      setErrors({ login: t("errors.loginRequired") });
      loginRef.current?.focus();
      return;
    }
    if (!password) {
      setErrors({ password: t("errors.passwordRequired") });
      passwordRef.current?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await store.signIn(login.trim(), password, { remember });
    } catch (err) {
      setFailure(apiErrorText(t, err));
      if (Number.isInteger(err?.retryAfter)) setWait(err.retryAfter);
      setPassword("");
      passwordRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const capsFrom = (event) => setCaps(Boolean(event.getModifierState?.("CapsLock")));

  return (
    <AuthLayout>
      <h1 className="m-0 mb-1 font-display text-28 font-bold">{t("auth.title")}</h1>
      <p className="m-0 mb-5 text-14 text-mute">{t("auth.sub")}</p>
      {notice ? (
        <Alert tone={NOTICE_TONE[notice.code] ?? "crit"} className="mb-3">{t(`auth.notice.${notice.code}`)}</Alert>
      ) : null}
      {failure ? <Alert className="mb-3">{failure}</Alert> : null}
      <form noValidate onSubmit={submit}>
        <Field layout="col" required label={t("auth.username")} hint={t("auth.usernameHint")} error={errors.login}>
          <Input
            ref={loginRef}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={login}
            onChange={(e) => { setLogin(e.target.value); setErrors({}); }}
            className="h-[46px]"
          />
        </Field>
        <Field layout="col" required label={t("auth.password")} error={errors.password}>
          <Input
            ref={passwordRef}
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setErrors({}); }}
            onKeyDown={capsFrom}
            onKeyUp={capsFrom}
            className="h-[46px]"
          />
        </Field>
        <div className="-mt-1 mb-2 flex items-center justify-between gap-2">
          {/* A toggle: one name, its state in aria-pressed (a name that changes as well would
              say the state twice, and the two can disagree). */}
          <button
            type="button"
            aria-pressed={show}
            onClick={() => setShow((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-1 text-12.5 font-semibold text-pri aria-pressed:underline ${FOCUS_RING}`}
          >
            <Icon name="eye" size={15} />
            {t("auth.show")}
          </button>
          {caps ? (
            <span role="status" className="flex items-center gap-1.5 text-12 font-semibold text-mid-ink">
              <Icon name="alert" size={14} />{t("auth.caps")}
            </span>
          ) : null}
        </div>
        <label className="mb-[18px] mt-1.5 flex cursor-pointer select-none items-center gap-2.5 text-13">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className={`h-4 w-4 accent-[var(--pri)] ${FOCUS_RING}`}
          />
          {t("auth.remember")}
        </label>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          busy={busy}
          disabled={wait > 0}
          className="w-full justify-center"
        >
          {busy ? t("auth.busy") : t("auth.submit")}
          {busy ? null : <Icon name="chevR" size={16} />}
        </Button>
        {wait > 0 ? <p role="status" className="mt-2 text-12.5 text-mute">{t("auth.retryIn", { seconds: wait })}</p> : null}
      </form>
      <div className="mt-4">
        <button
          type="button"
          aria-expanded={helpOpen}
          aria-controls="sign-in-help"
          onClick={() => setHelpOpen((v) => !v)}
          className={`rounded-lg px-1 text-12.5 font-semibold text-pri ${FOCUS_RING}`}
        >
          {t("auth.forgot")}
        </button>
        {helpOpen ? (
          <div id="sign-in-help" className="mt-2">
            <Note tone="info" icon="key">{t("auth.forgotHelp")}</Note>
          </div>
        ) : null}
      </div>
    </AuthLayout>
  );
}
```

- [ ] **Step 4: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  76 passed (76)`, `Tests  1465 passed (1465)`, `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/auth/SignIn.jsx dashboard/src/live/auth/SignIn.test.jsx
git commit -m "feat(live-ui): sign-in — announced refusals, Retry-After, remember the username only

A show-password toggle (aria-pressed, one name) and Caps Lock; a missing field said on the field; 'Forgot
password' sends to IT (roadmap D4: no SMS, no e-mail); why the form
opened (signed out, session ended, locked out, no rights).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 20: The TOTP step

**Files:**
- Create: `dashboard/src/live/auth/MfaStep.jsx`
- Test: `dashboard/src/live/auth/MfaStep.test.jsx`

- [ ] **Step 1: Write the failing test.** **Create** `dashboard/src/live/auth/MfaStep.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { mount, refusal } from "../session/mount.testutil.jsx";
import { profile, token } from "../session/testTokens.testutil.js";
import { MfaStep } from "./MfaStep.jsx";

// A browser that cannot draw the QR (no canvas): the key must still be there.
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => { throw new Error("no canvas"); }) } }));

const PENDING = token({ sub: "u-kaya", perms: ["board.view"], mfaRequired: true });
const NEW_ACCOUNT = profile({ id: "u-kaya", totp_enabled: false });

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("MfaStep", () => {
  it("draws no QR when it cannot, and the key still works", async () => {
    await mount(<MfaStep />, {
      access: PENDING, me: NEW_ACCOUNT,
      setup: (api) => api.setupTotp.mockResolvedValue({ provisioning_uri: "otpauth://totp/x?secret=ABCDEFGH" }),
    });
    expect(await screen.findByText("QR kodu çəkmək mümkün olmadı; açarı əl ilə daxil edin.")).toBeInTheDocument();
    expect(screen.getByText("ABCD EFGH")).toBeInTheDocument();
  });

  it("offers a retry when the server did not answer the enrolment", async () => {
    const { api } = await mount(<MfaStep />, {
      access: PENDING, me: NEW_ACCOUNT,
      setup: (a) => a.setupTotp.mockRejectedValueOnce(new Error("Failed to fetch"))
        .mockResolvedValueOnce({ provisioning_uri: "otpauth://totp/x?secret=ABCDEFGH" }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Yenidən cəhd et" }));
    expect(await screen.findByText("ABCD EFGH")).toBeInTheDocument();
    expect(api.setupTotp).toHaveBeenCalledTimes(2);
  });

  it("has no retry for a refusal (403 mfa_reset_required)", async () => {
    await mount(<MfaStep />, {
      access: PENDING, me: NEW_ACCOUNT,
      setup: (a) => a.setupTotp.mockRejectedValue(refusal(403, "mfa_reset_required")),
    });
    expect(await screen.findByText(/sistem administratorundan iki addımlı doğrulamanı sıfırlamasını/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yenidən cəhd et" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/auth/MfaStep.test.jsx 2>&1 | grep -E "Error|Tests "
```
Expected: `Failed to resolve import "./MfaStep.jsx"`.

- [ ] **Step 3: Implement.** **Create** `dashboard/src/live/auth/MfaStep.jsx`:

```jsx
// src/live/auth/MfaStep.jsx — the TOTP step (spec §4 "MFA enforcement", §8 "MFA enrolment").
//
// Whether it is asked at all is the server's: the groups' `mfa_required` (and the platform
// operator rule) make `requires_mfa`; nothing here assumes which groups need it (the roadmap's
// open user decision 3 can change them without touching this screen).
//
// Not enrolled: the API mints the secret (POST /auth/totp/setup) ONCE per showing — every call
// rotates it and retires the refresh tokens issued before it — so the call is kept in a ref that
// survives StrictMode's rehearsal remount. The QR is drawn here, by the `qrcode` package, with no
// network call: the secret never leaves the browser. A failure with no answer (network, 5xx) can
// be retried; a refusal (403 mfa_reset_required) cannot. The code goes to /auth/totp/verify as a
// plain request — a wrong code is a 401 that must not go through refresh-and-retry.
import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { apiErrorText } from "../apiErrors.js";
import { Alert, Button, Field, Input } from "../ui/index.js";
import { FOCUS_RING } from "../ui/focus.js";
import { AuthLayout, stepOf } from "./AuthLayout.jsx";

const canCopy = () => typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function";

function Enrolment() {
  const { t } = useI18n();
  const { store, user } = useSession();
  const [attempt, setAttempt] = useState(0);
  const [setup, setSetup] = useState(null);
  const [failure, setFailure] = useState(null);
  const [qr, setQr] = useState(null);
  const [copied, setCopied] = useState(false);
  const call = useRef(null);
  const key = `${user?.id ?? ""}|${attempt}`;

  useEffect(() => {
    if (!call.current || call.current.key !== key) {
      setSetup(null); setFailure(null); setQr(null); setCopied(false);
      call.current = { key, promise: Promise.resolve().then(() => store.setupMfa()) };
    }
    let current = true;
    call.current.promise.then(
      (s) => {
        if (!current) return;
        setSetup(s);
        QRCode.toDataURL(s.provisioningUri, { margin: 1 })
          .then((url) => { if (current) setQr(url); })
          .catch(() => {});                     // the key below still works
      },
      (err) => { if (current) setFailure(err); },
    );
    return () => { current = false; };
  }, [key, store]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(setup?.secret || "");
    } catch {
      return;                                    // refused: do not claim it was copied
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (failure) {
    const retryable = failure.status == null || failure.status >= 500;
    return (
      <div className="mb-4">
        <Alert className="mb-2">{apiErrorText(t, failure)}</Alert>
        {retryable ? <Button icon="swap" onClick={() => setAttempt((n) => n + 1)}>{t("auth.retry")}</Button> : null}
      </div>
    );
  }
  if (!setup) return <p role="status" className="mb-4 text-13 text-mute">{t("auth.loading")}</p>;
  return (
    <div className="mb-4 rounded-box border border-line bg-card2 p-4 text-center">
      {/* White behind the QR in both themes: a scanner needs a light quiet zone around it. */}
      {qr ? (
        <img src={qr} alt={t("auth.qrAlt")} className="mx-auto mb-3 h-36 w-36 rounded-ctl bg-[white] p-1" />
      ) : (
        <p className="mb-2 text-12 text-mute">{t("auth.qrUnavailable")}</p>
      )}
      <p className="m-0 text-11.5 text-mute">{t("auth.manualKey")}</p>
      <div className="mt-1 flex items-center justify-center gap-2">
        <code className="font-data text-14 tracking-widest">{(setup.secret || "").replace(/(.{4})/g, "$1 ").trim()}</code>
        {canCopy() ? (
          <button type="button" onClick={copy} className={`rounded-lg px-2 py-1 text-12 font-semibold text-pri hover:bg-card ${FOCUS_RING}`}>
            {t(copied ? "auth.copied" : "auth.copy")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function MfaStep() {
  const { t } = useI18n();
  const { store, mfa, steps, user } = useSession();
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const enrolled = mfa?.enrolled === true;

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setFailure(null);
    if (!/^\d{6}$/.test(code)) {
      setError(t("errors.invalidTotp"));
      input.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await store.verifyMfa(code);
    } catch (err) {
      setFailure(apiErrorText(t, err));
      setCode("");
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout step={stepOf("mfa", steps)}>
      <h1 className="m-0 mb-1 font-display text-28 font-bold">{t(enrolled ? "auth.mfaTitle" : "auth.enrolTitle")}</h1>
      <p className="m-0 mb-5 text-14 text-mute">
        {user?.fullName ? <b className="text-ink">{user.fullName} · </b> : null}
        {t(enrolled ? "auth.mfaSub" : "auth.enrolSub")}
      </p>
      {enrolled ? null : <Enrolment />}
      {failure ? <Alert className="mb-3">{failure}</Alert> : null}
      <form noValidate onSubmit={submit}>
        <Field layout="col" required label={t("auth.code")} error={error}>
          <Input
            ref={input}
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(null); }}
            className="h-[54px] text-center font-data text-23 font-bold tracking-[.5em]"
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" busy={busy} className="mt-2 w-full justify-center">
          {t("auth.verify")}
        </Button>
      </form>
      <button
        type="button"
        onClick={() => store.cancel()}
        disabled={busy}
        className={`mt-4 rounded-lg px-1 text-13 font-semibold text-pri disabled:opacity-45 ${FOCUS_RING}`}
      >
        ← {t("auth.back")}
      </button>
    </AuthLayout>
  );
}
```

- [ ] **Step 4: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  77 passed (77)`, `Tests  1468 passed (1468)`, `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/auth/MfaStep.jsx dashboard/src/live/auth/MfaStep.test.jsx
git commit -m "feat(live-ui): the TOTP step — enrolment once per showing, the QR drawn here

Asked when the token says requires_mfa (the groups' mfa_required decide);
a retry only for a failure with no answer; the code as a plain request.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 21: The lock screen

**Files:**
- Create: `dashboard/src/live/auth/LockScreen.jsx`, `dashboard/src/live/i18n/strings/lock.js`
- Modify: `dashboard/src/live/i18n/catalog.js`, `dashboard/src/live/i18n/strings.test.js`
- Test: `dashboard/src/live/auth/LockScreen.test.jsx`

- [ ] **Step 1: Write the failing test.** **Create** `dashboard/src/live/auth/LockScreen.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, screen, fireEvent } from "@testing-library/react";
import { mount, refusal } from "../session/mount.testutil.jsx";
import { token } from "../session/testTokens.testutil.js";
import { LockScreen } from "./LockScreen.jsx";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("LockScreen", () => {
  it("counts nothing for a 503 — it says what the server said", async () => {
    const { api, store } = await mount(<LockScreen />);
    store.lock();
    api.reauth.mockRejectedValue(refusal(503, "Dizin sunucusuna ulaşılamıyor"));
    fireEvent.change(screen.getByLabelText("Şifrə"), { target: { value: "Gizli" } });
    fireEvent.click(screen.getByRole("button", { name: "Kilidi aç" }));
    expect(await screen.findByText(/Xəstəxananın kataloq serverinə/)).toBeInTheDocument();
    expect(store.getState().unlockFailures).toBe(0);
  });

  it("asks for the password before sending anything", async () => {
    const { api, store } = await mount(<LockScreen />);
    store.lock();
    fireEvent.click(screen.getByRole("button", { name: "Kilidi aç" }));
    expect(await screen.findByText("Şifrənizi daxil edin.")).toBeInTheDocument();
    expect(api.reauth).not.toHaveBeenCalled();
  });

  it("shows a board that stopped updating as possibly out of date — its counts, never 'none'", async () => {
    const { store, board } = await mount(<LockScreen />, { setup: (api) => {
      api.boardPatients.mockResolvedValue({ patients: [], scope: { unrestricted: true, unit_ids: [] } });
      api.streamTicket.mockRejectedValue(new Error("Failed to fetch"));
    } });
    store.lock();
    await act(() => board.start());
    const counts = screen.getByRole("region", { name: "Bölmələrinizdəki açıq siqnalların sayı" });
    expect(counts).toHaveTextContent("Bölmələrinizdəki açıq siqnal: 0");
    expect(counts).toHaveTextContent("Təsdiqlənməmiş: 0");
    expect(counts).toHaveTextContent("Köhnə ola bilər");
    expect(counts).not.toHaveTextContent("yoxdur");
    board.clear();
  });

  it("shows no alarm counts to an account that cannot see the board", async () => {
    const { store } = await mount(<LockScreen />, { access: token({ perms: ["users.manage"] }) });
    store.lock();
    expect(screen.queryByRole("region", { name: "Bölmələrinizdəki açıq siqnalların sayı" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Ekran kilidlənib" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/auth/LockScreen.test.jsx 2>&1 | grep -E "Error|Tests "
```
Expected: `Failed to resolve import "./LockScreen.jsx"`.

- [ ] **Step 3: The words.** **Create** `dashboard/src/live/i18n/strings/lock.js`:

```js
// The lock screen. The prototype's dictionary (shell.js lk_*); its "open alarms in the UNIT" says
// "in your units" here — the counts are the session's scope, which may be several units. Times
// and counts stand after a label ("Since: 21:05", "Attempts left: 2"), never inside a word that
// would need a suffix or a plural fitted to the number. Written for this plan (AZ/RU/EN to be
// reviewed by a native speaker before the pilot): low, info, unavailable, waiting, stale,
// attemptsLeft, region.
export default {
  tr: {
    title: "Ekran kilitlendi",
    idle: "Hareketsizlik nedeniyle · Kilit saati: {time}",
    manual: "Ekranı siz kilitlediniz · Kilit saati: {time}",
    hidden: "Hasta bilgileri gizlendi",
    password: "Şifre",
    unlock: "Kilidi aç",
    other: "Başka kullanıcıyla giriş",
    caps: "Caps Lock açık",
    open: "Birimlerinizdeki açık alarm",
    waiting: "Onaylanmamış",
    none: "Birimlerinizde açık alarm yok",
    seeing: "Ayrıntı için kilidi açın",
    stale: "Güncel olmayabilir: canlı akış kesildi",
    unavailable: "Alarm bilgisi alınamıyor. Bu, alarm olmadığı anlamına gelmez.",
    critical: "kritik", high: "yüksek", moderate: "orta", low: "düşük", info: "bilgi",
    attemptsLeft: "Şifre hatalı. Kalan deneme: {count}; sonra oturum kapanır.",
    region: "Birimlerinizdeki açık alarmların sayısı",
  },
  az: {
    title: "Ekran kilidlənib",
    idle: "Hərəkətsizlik səbəbilə · Kilid vaxtı: {time}",
    manual: "Ekranı siz kilidlədiniz · Kilid vaxtı: {time}",
    hidden: "Xəstə məlumatları gizlədilib",
    password: "Şifrə",
    unlock: "Kilidi aç",
    other: "Başqa istifadəçi ilə giriş",
    caps: "Caps Lock açıqdır",
    open: "Bölmələrinizdəki açıq siqnal",
    waiting: "Təsdiqlənməmiş",
    none: "Bölmələrinizdə açıq siqnal yoxdur",
    seeing: "Təfərrüat üçün kilidi açın",
    stale: "Köhnə ola bilər: canlı axın kəsilib",
    unavailable: "Siqnal məlumatı alına bilmir. Bu, siqnal olmadığı demək deyil.",
    critical: "kritik", high: "yüksək", moderate: "orta", low: "aşağı", info: "məlumat",
    attemptsLeft: "Şifrə səhvdir. Qalan cəhd: {count}; sonra sessiya bağlanır.",
    region: "Bölmələrinizdəki açıq siqnalların sayı",
  },
  ru: {
    title: "Экран заблокирован",
    idle: "Из-за бездействия · с {time}",
    manual: "Вы заблокировали экран · с {time}",
    hidden: "Данные пациентов скрыты",
    password: "Пароль",
    unlock: "Разблокировать",
    other: "Войти под другим пользователем",
    caps: "Включён Caps Lock",
    open: "Открытые тревоги в ваших отделениях",
    waiting: "Не подтверждены",
    none: "В ваших отделениях открытых тревог нет",
    seeing: "Подробности — после разблокировки",
    stale: "Могут быть устаревшими: поток прервался",
    unavailable: "Нет данных о тревогах. Это не значит, что тревог нет.",
    critical: "критич.", high: "высокие", moderate: "средние", low: "низкие", info: "инфо",
    attemptsLeft: "Неверный пароль. Осталось попыток: {count}; затем сеанс закроется.",
    region: "Число открытых тревог в ваших отделениях",
  },
  en: {
    title: "Screen locked",
    idle: "Locked after inactivity · Since: {time}",
    manual: "You locked the screen · Since: {time}",
    hidden: "Patient data is hidden",
    password: "Password",
    unlock: "Unlock",
    other: "Sign in as someone else",
    caps: "Caps Lock is on",
    open: "Open alarms in your units",
    waiting: "Unacknowledged",
    none: "No open alarms in your units",
    seeing: "Unlock to see details",
    stale: "May be out of date: the live stream dropped",
    unavailable: "Alarm information unavailable. This does not mean there are no alarms.",
    critical: "critical", high: "high", moderate: "medium", low: "low", info: "info",
    attemptsLeft: "Incorrect password. Attempts left: {count}; then the session closes.",
    region: "Number of open alarms in your units",
  },
};
```

**In** `dashboard/src/live/i18n/catalog.js` **replace:**

```js
import auth from "./strings/auth.js";
```
**with:**
```js
import auth from "./strings/auth.js";
import lock from "./strings/lock.js";
```

**In** `dashboard/src/live/i18n/catalog.js` **replace:**

```js
  common, risk, prefs, news2, gallery, ui, errors, dates, shell, auth,
```
**with:**
```js
  common, risk, prefs, news2, gallery, ui, errors, dates, shell, auth, lock,
```

**In** `dashboard/src/live/i18n/strings.test.js` **replace:**

```js
  "auth.copied", //          Kopyalandı — its passive past
]);
```
**with:**
```js
  "auth.copied", //          Kopyalandı — its passive past
  "lock.unlock", //          Kilidi aç — the prototype's AZ dictionary (shell.js lk_open)
  "lock.critical", //        kritik — the prototype's AZ dictionary (shell.js lk_crit)
  "lock.moderate", //        orta — the prototype's AZ dictionary (shell.js lk_mid)
]);
```

- [ ] **Step 4: The screen.** **Create** `dashboard/src/live/auth/LockScreen.jsx`:

```jsx
// src/live/auth/LockScreen.jsx — the locked screen (the prototype's lockHtml, shell.js).
//
// It replaces the whole shell: no screen, menu, dialog or toast of the session is in the page
// while it shows (plan decision 3). What it shows of the ward: the NUMBER of open alarms in the
// session's units, by severity, and how many nobody has acknowledged — no name, bed or value —
// so a nurse glancing at a shared station knows whether something is waiting. Only a LIVE board
// may say "none"; a board that stopped updating shows its counts as possibly out of date, and
// one that is not there says it cannot know. Unlock is the session's own password (POST
// /auth/reauth); the third wrong one signs out. "Sign in as someone else" signs out at once — no
// password is needed to leave.
//
// Always dark, as in the prototype: data-theme="gece" on its root.
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { UNLOCK_ATTEMPTS } from "../session/sessionStore.js";
import { useBoard } from "../data/BoardProvider.jsx";
import { alarmCounts } from "../data/boardStore.js";
import { CONNECTION } from "../../liveConnection.js";
import { apiErrorKey, apiErrorText } from "../apiErrors.js";
import { Alert, Button, Icon, StatusPill } from "../ui/index.js";
import { FOCUS_RING } from "../ui/focus.js";
import { Brand } from "../shell/Prefs.jsx";
import { ddmmyyyy, hhmm, weekdayKey } from "../i18n/dates.js";

function useNow(stepMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(timer);
  }, [stepMs]);
  return now;
}

const PILLS = [["critical", "crit"], ["high", "high"], ["moderate", "mid"], ["low", "low"], ["info", "neutral"]];

function OpenAlarms() {
  const { t } = useI18n();
  const { alerts, connection } = useBoard();
  const live = connection === CONNECTION.LIVE;
  const stale = connection === CONNECTION.DEGRADED;     // shown, but it stopped updating
  const { open, waiting } = alarmCounts(alerts);
  return (
    <section aria-label={t("lock.region")} aria-live="polite"
      className="flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-box border border-line2 bg-card px-4 py-2.5 text-13.5">
      {!live && !stale ? <span className="text-mute">{t("lock.unavailable")}</span> : live && open.total === 0 ? (
        <b>{t("lock.none")}</b>
      ) : (
        <>
          <b>{t("lock.open")}: <span className="font-data">{open.total}</span></b>
          <span>{t("lock.waiting")}: <span className="font-data font-bold">{waiting}</span></span>
          {PILLS.filter(([sev]) => open[sev] > 0).map(([sev, tone]) => (
            <StatusPill key={sev} tone={tone}>{open[sev]} {t(`lock.${sev}`)}</StatusPill>
          ))}
          {stale ? (
            <small className="flex items-center gap-1.5 font-semibold text-mid-ink">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-mid" />{t("lock.stale")}
            </small>
          ) : <small className="text-mute">{t("lock.seeing")}</small>}
        </>
      )}
    </section>
  );
}

export function LockScreen() {
  const { t } = useI18n();
  const { store, user, lock } = useSession();
  const now = useNow();
  const [password, setPassword] = useState("");
  const [caps, setCaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const input = useRef(null);
  const seesBoard = user?.perms?.includes("board.view");

  useEffect(() => { input.current?.focus(); }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!password) {
      setFailure(t("errors.passwordRequired"));
      input.current?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await store.unlock(password);
    } catch (err) {
      if (apiErrorKey(err)?.key === "errors.reauthRefused") {
        const left = UNLOCK_ATTEMPTS - store.getState().unlockFailures;
        setFailure(t("lock.attemptsLeft", { count: left }));
      } else {
        setFailure(apiErrorText(t, err));
      }
      setPassword("");
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const capsFrom = (event) => setCaps(Boolean(event.getModifierState?.("CapsLock")));
  const date = `${t(weekdayKey(now))} ${ddmmyyyy(now)}`;
  const initials = (user?.fullName || "?").split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join("");

  return (
    <div data-theme="gece" className="flex min-h-full flex-col bg-[radial-gradient(120%_90%_at_50%_-10%,color-mix(in_srgb,var(--pri)_25%,var(--page)),var(--page)_62%)] px-[clamp(16px,4vw,56px)] py-7 font-text text-ink">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Brand subtitle={user?.tenantName || user?.tenant} />
        <p className="m-0 font-data text-14 font-semibold text-mute">{date}</p>
      </div>
      <main className="flex flex-1 flex-col items-center justify-center gap-[22px] py-6">
        <p aria-hidden="true" className="m-0 font-data text-[calc(clamp(64px,9vw,120px)*var(--fs))] font-bold leading-none tracking-[-.02em]">{hhmm(now)}</p>
        <div className="w-full max-w-[420px] rounded-dlg border border-line2 bg-card p-[22px] shadow-pop">
          <div className="flex items-center gap-3.5 border-b border-line pb-4">
            <span aria-hidden="true" className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-pri font-display text-20 font-bold text-onpri">{initials}</span>
            <div className="min-w-0">
              <b className="block truncate font-display text-17">{user?.fullName}</b>
              <small className="text-13 text-mute">{(user?.groups ?? []).map((g) => g.name).join(" · ")}</small>
            </div>
          </div>
          <div className="flex items-start gap-3 py-3.5">
            <Icon name="lock" size={20} className="mt-0.5 text-pri" />
            <div>
              <h1 className="m-0 text-15 font-bold">{t("lock.title")}</h1>
              <small className="text-12.5 text-mute">
                {t(lock?.why === "idle" ? "lock.idle" : "lock.manual", { time: hhmm(lock?.at ?? now) })} · {t("lock.hidden")}
              </small>
            </div>
          </div>
          {failure ? <Alert className="mb-2.5">{failure}</Alert> : null}
          <form noValidate onSubmit={submit}>
            <label htmlFor="lock-password" className="sr-only">{t("lock.password")}</label>
            <div className="flex h-12 items-center gap-2.5 rounded-ctl border border-line2 bg-page px-3.5 focus-within:border-pri focus-within:shadow-[0_0_0_4px_var(--priSoft)]">
              <Icon name="key" size={18} className="text-mute" />
              <input
                ref={input}
                id="lock-password"
                type="password"
                autoComplete="current-password"
                placeholder={t("lock.password")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={capsFrom}
                onKeyUp={capsFrom}
                className="h-full min-w-0 flex-1 border-0 bg-transparent text-15 text-ink outline-none placeholder:text-mute"
              />
            </div>
            {caps ? <p role="status" className="mb-0 mt-2 text-12.5 font-bold text-mid-ink">{t("lock.caps")}</p> : null}
            <Button type="submit" variant="primary" size="lg" icon="lock" busy={busy} className="mt-3 w-full justify-center">
              {t("lock.unlock")}
            </Button>
          </form>
          <button
            type="button"
            onClick={() => store.signOut()}
            className={`mt-2.5 block w-full rounded-ctl p-2.5 text-13.5 font-semibold text-mute hover:bg-card2 hover:text-ink ${FOCUS_RING}`}
          >
            {t("lock.other")}
          </button>
        </div>
        {seesBoard ? <OpenAlarms /> : null}
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  78 passed (78)`, `Tests  1472 passed (1472)`, `✓ built in …`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/auth/LockScreen.jsx dashboard/src/live/auth/LockScreen.test.jsx dashboard/src/live/i18n/strings/lock.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js
git commit -m "feat(live-ui): the lock screen — nothing of the session, only open-alarm counts

The counts in the session's units and the unacknowledged ones; 'none'
only from a LIVE board, 'may be out of date' from a DEGRADED one,
'cannot know' otherwise. Unlock with the session's password (a wrong one
says how many tries are left); sign in as someone else with no password.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 22: Settings — every session's home until Wave 3

**Files:**
- Create: `dashboard/src/live/screens/settings/SettingsScreen.jsx`, `dashboard/src/live/i18n/strings/account.js`, `dashboard/src/live/i18n/strings/nav.js`
- Modify: `dashboard/src/live/i18n/catalog.js`, `dashboard/src/live/i18n/strings.test.js`
- Test: `dashboard/src/live/screens/settings/SettingsScreen.test.jsx`

- [ ] **Step 1: Write the failing test.** **Create** `dashboard/src/live/screens/settings/SettingsScreen.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { SettingsScreen } from "./SettingsScreen.jsx";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("SettingsScreen", () => {
  it("changes a local account's password and says so", async () => {
    const { api } = await mount(<SettingsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "Təhlükəsizlik" }));
    api.changePassword.mockResolvedValue({ access_token: token() });
    fireEvent.change(screen.getByLabelText(/^Cari şifrə/), { target: { value: "Gizli-Sifre-1" } });
    fireEvent.change(screen.getByLabelText(/^Yeni şifrə \*/), { target: { value: "Yeni-Sifre-22" } });
    fireEvent.change(screen.getByLabelText(/Yeni şifrə \(təkrar\)/), { target: { value: "Yeni-Sifre-22" } });
    fireEvent.click(screen.getByRole("button", { name: "Şifrəni dəyiş" }));
    await waitFor(() => expect(api.changePassword).toHaveBeenCalledWith("Gizli-Sifre-1", "Yeni-Sifre-22"));
    expect(await screen.findByText("Şifrəniz dəyişdi.", { selector: "span" })).toBeInTheDocument();
  });

  it("sends an AD account to the hospital's own way of changing it", async () => {
    await mount(<SettingsScreen />, { me: profile({ auth_source: "ldap" }) });
    fireEvent.click(screen.getByRole("tab", { name: "Təhlükəsizlik" }));
    expect(screen.getByRole("note")).toHaveTextContent(/xəstəxana hesabınızla idarə olunur/);
    expect(screen.queryByLabelText(/^Cari şifrə/)).toBeNull();
  });

  it("shows the hospital's lock time and the profile the server reports", async () => {
    await mount(<SettingsScreen />, { me: profile({ lock_idle_minutes: 7 }) });
    expect(screen.getByRole("heading", { level: 1, name: "Ayarlar" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Təhlükəsizlik" }));
    expect(screen.getByText("7 dəq hərəkətsizlikdən sonra")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Profil" }));
    expect(screen.getByText("Sentetik Hastane")).toBeInTheDocument();
    expect(screen.getByText("Hemşire")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/screens/ 2>&1 | grep -E "Error|Tests "
```
Expected: `Failed to resolve import "./SettingsScreen.jsx"`.

- [ ] **Step 3: The words** — the screen's, and the screens' names (the rail's, Task 24). **Create** `dashboard/src/live/i18n/strings/account.js`:

```js
// The personal settings screen. The prototype's dictionary (ayarlar.js st_*), trimmed to what has
// a backend in Group 1: appearance (this browser), the profile as /auth/me reports it, the
// password (local accounts) and what the hospital decided about two-step verification and the
// screen lock. Written for this plan (AZ/RU/EN to be reviewed by a native speaker before the
// pilot): everything but sub, look, profile, security, passwordTitle.
export default {
  tr: {
    sub: "Yalnız sizin ekranınızı etkiler.",
    sections: "Ayar bölümleri",
    look: "Görünüm",
    profile: "Profil",
    security: "Güvenlik",
    fullName: "Ad soyad",
    username: "Kullanıcı adı",
    email: "E-posta",
    hospital: "Hastane",
    groups: "Gruplar",
    source: "Giriş",
    sourceLocal: "Yerel hesap",
    sourceLdap: "Hastane hesabı (Active Directory)",
    version: "Sürüm",
    passwordTitle: "Şifre değiştir",
    passwordChanged: "Şifreniz değişti.",
    passwordSave: "Şifreyi değiştir",
    ldapPassword: "Şifreniz hastane hesabınızla yönetilir; hastanenin olağan yolundan değiştirin.",
    mfa: "İki adımlı doğrulama",
    mfaOn: "Açık",
    mfaOff: "Kapalı",
    mfaHelp: "Grubunuz gerektiriyorsa girişte kurulur. Cihazınızı kaybettiyseniz sistem yöneticiniz sıfırlar.",
    lock: "Ekran kilidi",
    lockValue: "{minutes} dk hareketsizlikten sonra",
    lockHelp: "Süreyi hastane belirler. Kilitli ekranda hasta bilgisi görünmez; kilidi şifrenizle açarsınız.",
  },
  az: {
    sub: "Yalnız sizin ekranınıza təsir edir.",
    sections: "Ayar bölmələri",
    look: "Görünüş",
    profile: "Profil",
    security: "Təhlükəsizlik",
    fullName: "Ad, soyad",
    username: "İstifadəçi adı",
    email: "E-poçt",
    hospital: "Xəstəxana",
    groups: "Qruplar",
    source: "Giriş",
    sourceLocal: "Yerli hesab",
    sourceLdap: "Xəstəxana hesabı (Active Directory)",
    version: "Versiya",
    passwordTitle: "Şifrəni dəyiş",
    passwordChanged: "Şifrəniz dəyişdi.",
    passwordSave: "Şifrəni dəyiş",
    ldapPassword: "Şifrəniz xəstəxana hesabınızla idarə olunur; xəstəxananın adi qaydası ilə dəyişin.",
    mfa: "İki addımlı doğrulama",
    mfaOn: "Açıq",
    mfaOff: "Bağlı",
    mfaHelp: "Qrupunuz tələb edirsə, girişdə quraşdırılır. Cihazınızı itirmisinizsə, sistem administratorunuz sıfırlayır.",
    lock: "Ekran kilidi",
    lockValue: "{minutes} dəq hərəkətsizlikdən sonra",
    lockHelp: "Müddəti xəstəxana təyin edir. Kilidli ekranda xəstə məlumatı görünmür; kilidi şifrənizlə açırsınız.",
  },
  ru: {
    sub: "Влияет только на ваш экран.",
    sections: "Разделы настроек",
    look: "Вид",
    profile: "Профиль",
    security: "Безопасность",
    fullName: "Имя и фамилия",
    username: "Имя пользователя",
    email: "Эл. почта",
    hospital: "Больница",
    groups: "Группы",
    source: "Вход",
    sourceLocal: "Локальная учётная запись",
    sourceLdap: "Больничная учётная запись (Active Directory)",
    version: "Версия",
    passwordTitle: "Сменить пароль",
    passwordChanged: "Пароль изменён.",
    passwordSave: "Сменить пароль",
    ldapPassword: "Пароль управляется больничной учётной записью; меняйте его обычным для больницы способом.",
    mfa: "Двухэтапная проверка",
    mfaOn: "Включена",
    mfaOff: "Выключена",
    mfaHelp: "Если ваша группа требует её, она настраивается при входе. Если устройство утеряно, системный администратор её сбросит.",
    lock: "Блокировка экрана",
    lockValue: "через {minutes} мин бездействия",
    lockHelp: "Время задаёт больница. На заблокированном экране данные пациентов не видны; разблокировка — вашим паролем.",
  },
  en: {
    sub: "Affects only your screen.",
    sections: "Settings sections",
    look: "Appearance",
    profile: "Profile",
    security: "Security",
    fullName: "Name",
    username: "Username",
    email: "Email",
    hospital: "Hospital",
    groups: "Groups",
    source: "Sign-in",
    sourceLocal: "Local account",
    sourceLdap: "Hospital account (Active Directory)",
    version: "Version",
    passwordTitle: "Change password",
    passwordChanged: "Your password was changed.",
    passwordSave: "Change password",
    ldapPassword: "Your password is managed by your hospital account; change it the hospital's usual way.",
    mfa: "Two-step verification",
    mfaOn: "On",
    mfaOff: "Off",
    mfaHelp: "Set up at sign-in when your group requires it. If you lose your device, your system administrator resets it.",
    lock: "Screen lock",
    lockValue: "after {minutes} min of inactivity",
    lockHelp: "The hospital sets the time. A locked screen shows no patient data; you unlock it with your password.",
  },
};
```

**Create** `dashboard/src/live/i18n/strings/nav.js`:

```js
// The screens' names: in the rail, the breadcrumb and the page title. The prototype's dictionary
// (core.js m_beds, m_alarms, m_admin, m_settings). `*Short` is the rail's word on a phone (62 px):
// never an icon alone (roadmap: "Daraltılmış sol menüde her madde kısa adıyla görünür").
// patient, *Short: written for this plan; AZ/RU/EN need a native speaker's review before the pilot.
export default {
  tr: {
    beds: "Yataklar", bedsShort: "Yatak",
    alarms: "Alarmlar", alarmsShort: "Alarm",
    patient: "Hasta",
    admin: "Yönetim", adminShort: "Yönetim",
    settings: "Ayarlar", settingsShort: "Ayarlar",
  },
  az: {
    beds: "Çarpayılar", bedsShort: "Çarpayı",
    alarms: "Siqnallar", alarmsShort: "Siqnal",
    patient: "Xəstə",
    admin: "İdarə", adminShort: "İdarə",
    settings: "Ayarlar", settingsShort: "Ayarlar",
  },
  ru: {
    beds: "Койки", bedsShort: "Койки",
    alarms: "Тревоги", alarmsShort: "Тревоги",
    patient: "Пациент",
    admin: "Управление", adminShort: "Управл.",
    settings: "Настройки", settingsShort: "Настр.",
  },
  en: {
    beds: "Beds", bedsShort: "Beds",
    alarms: "Alarms", alarmsShort: "Alarms",
    patient: "Patient",
    admin: "Admin", adminShort: "Admin",
    settings: "Settings", settingsShort: "Settings",
  },
};
```

**In** `dashboard/src/live/i18n/catalog.js` **replace:**

```js
import lock from "./strings/lock.js";
```
**with:**
```js
import lock from "./strings/lock.js";
import account from "./strings/account.js";
import nav from "./strings/nav.js";
```

**In** `dashboard/src/live/i18n/catalog.js` **replace:**

```js
  common, risk, prefs, news2, gallery, ui, errors, dates, shell, auth, lock,
```
**with:**
```js
  common, risk, prefs, news2, gallery, ui, errors, dates, shell, auth, lock, account, nav,
```

**In** `dashboard/src/live/i18n/strings.test.js` **replace:**

```js
  "lock.moderate", //        orta — the prototype's AZ dictionary (shell.js lk_mid)
]);
```
**with:**
```js
  "lock.moderate", //        orta — the prototype's AZ dictionary (shell.js lk_mid)
  "account.profile", //      Profil — the prototype's AZ dictionary (ayarlar.js st_profile)
  "account.source", //       Giriş — "sign-in" in Azerbaijani too (core.js signin: "Daxil ol" is the verb)
  "account.lock", //         Ekran kilidi — "screen lock" in Azerbaijani too (shell.js lk_title "Ekran kilidlənib")
  "nav.settings", //         Ayarlar — the prototype's AZ dictionary (core.js m_settings)
  "nav.settingsShort", //    Ayarlar — the same word
]);
```

- [ ] **Step 4: The screen.** **Create** `dashboard/src/live/screens/settings/SettingsScreen.jsx`:

```jsx
// src/live/screens/settings/SettingsScreen.jsx — the person's own settings (the prototype's
// ayarlar.js), trimmed to what Group 1 can back: how this browser shows the UI, who the server
// says you are, your password (local accounts) and what the hospital decided about two-step
// verification and the screen lock. Every signed-in user reaches it; it is the home of a session
// whose work screens a later wave builds.
import React, { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useTheme } from "../../theme/ThemeProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { PasswordForm } from "../../auth/PasswordForm.jsx";
import { Box, KV, KVList, Note, Seg, StatusPill, TabPanel, Tabs, useToast } from "../../ui/index.js";

const BUILD_SHA = typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "";
const TAB_ID = "settings";

/** One setting: its name, then its choices (the prototype's .st-row). */
function Row({ label, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
      <b className="text-13.5">{label}</b>
      {children}
    </div>
  );
}

function Look() {
  const { t, lang, setLang, langs } = useI18n();
  const { theme, setTheme, size, setSize } = useTheme();
  return (
    <Box>
      <Row label={t("prefs.lang")}>
        <Seg label={t("prefs.lang")} value={lang} onChange={setLang} className="max-w-full flex-wrap"
          options={langs.map((l) => ({ value: l.code, label: l.native, lang: l.code }))} />
      </Row>
      <Row label={t("prefs.theme")}>
        <Seg label={t("prefs.theme")} value={theme} onChange={setTheme} options={[
          { value: "gece", label: t("prefs.themeGece"), icon: "moon" },
          { value: "gun", label: t("prefs.themeGun"), icon: "sun" },
        ]} />
      </Row>
      <Row label={t("prefs.size")}>
        <Seg label={t("prefs.size")} value={size} onChange={setSize} options={[
          { value: "normal", label: t("prefs.sizeNormal") },
          { value: "buyuk", label: t("prefs.sizeBuyuk") },
        ]} />
      </Row>
    </Box>
  );
}

function Profile() {
  const { t } = useI18n();
  const { user } = useSession();
  return (
    <Box>
      <KVList>
        <KV label={t("account.fullName")} mono={false}>{user.fullName}</KV>
        <KV label={t("account.username")}>{user.username}</KV>
        <KV label={t("account.email")}>{user.email ?? "—"}</KV>
        <KV label={t("account.hospital")} mono={false}>{user.tenantName || user.tenant}</KV>
        <KV label={t("account.groups")} mono={false}>{user.groups.map((g) => g.name).join(", ") || "—"}</KV>
        <KV label={t("account.source")} mono={false}>{t(user.authSource === "ldap" ? "account.sourceLdap" : "account.sourceLocal")}</KV>
        <KV label={t("account.version")}>{BUILD_SHA || "—"}</KV>
      </KVList>
    </Box>
  );
}

function Security() {
  const { t } = useI18n();
  const { user } = useSession();
  const toast = useToast();
  return (
    <div className="grid gap-3">
      <Box title={t("account.passwordTitle")} icon="key" level={2}>
        {user.authSource === "ldap" ? (
          <Note tone="info">{t("account.ldapPassword")}</Note>
        ) : (
          <div className="max-w-[420px]">
            <PasswordForm submitLabel={t("account.passwordSave")} onDone={() => toast(t("account.passwordChanged"))} />
          </div>
        )}
      </Box>
      <Box title={t("account.mfa")} icon="shield" level={2}
        right={<StatusPill tone={user.totpEnabled ? "ok" : "neutral"}>{t(user.totpEnabled ? "account.mfaOn" : "account.mfaOff")}</StatusPill>}>
        <p className="m-0 text-13 text-mute">{t("account.mfaHelp")}</p>
      </Box>
      <Box title={t("account.lock")} icon="lock" level={2}>
        <p className="m-0 mb-1 text-13 font-semibold">{t("account.lockValue", { minutes: user.lockIdleMinutes })}</p>
        <p className="m-0 text-13 text-mute">{t("account.lockHelp")}</p>
      </Box>
    </div>
  );
}

export function SettingsScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState("look");
  const tabs = [
    { value: "look", label: t("account.look") },
    { value: "profile", label: t("account.profile") },
    { value: "security", label: t("account.security") },
  ];
  return (
    <div className="max-w-[860px]">
      <h1 className="m-0 font-display text-23 font-bold">{t("nav.settings")}</h1>
      <p className="m-0 mb-4 text-13 text-mute">{t("account.sub")}</p>
      <Tabs id={TAB_ID} label={t("account.sections")} tabs={tabs} value={tab} onChange={setTab} className="mb-3" />
      <TabPanel id={TAB_ID} tabs={tabs} value={tab}>
        {tab === "look" ? <Look /> : tab === "profile" ? <Profile /> : <Security />}
      </TabPanel>
    </div>
  );
}
```

- [ ] **Step 5: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  79 passed (79)`, `Tests  1475 passed (1475)`, `✓ built in …`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/screens/settings/SettingsScreen.jsx dashboard/src/live/screens/settings/SettingsScreen.test.jsx dashboard/src/live/i18n/strings/account.js dashboard/src/live/i18n/strings/nav.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js
git commit -m "feat(live-ui): Settings — appearance, the profile the server reports, password, MFA, lock time

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 23: The route table

**Files:**
- Create: `dashboard/src/live/shell/routes.js`
- Test: `dashboard/src/live/shell/routes.test.js`

- [ ] **Step 1: Write the failing test.** **Create** `dashboard/src/live/shell/routes.test.js`:

```js
import { describe, it, expect } from "vitest";
import { ROUTES, canReach, hasWorkRoute, homePath, matchRoute, navRoutes } from "./routes.js";
import { PERMISSION_KEYS } from "../../permissions.js";
import { DICTIONARIES } from "../i18n/catalog.js";
import { LANG_CODES } from "../i18n/langs.js";
import { ICON_NAMES } from "../ui/icons.js";

const NURSE = ["board.view", "alerts.ack", "admissions.view"];
const ADMIN = [...PERMISSION_KEYS];

describe("the route table", () => {
  it("names real permissions, icons and texts in the four languages", () => {
    for (const r of ROUTES) {
      for (const key of r.perms) expect(PERMISSION_KEYS, `${r.id}: ${key}`).toContain(key);
      expect(ICON_NAMES, r.id).toContain(r.icon);
      for (const lang of LANG_CODES) {
        expect(DICTIONARIES[lang][r.labelKey], `${lang} ${r.labelKey}`).toBeTruthy();
        expect(DICTIONARIES[lang][r.shortKey], `${lang} ${r.shortKey}`).toBeTruthy();
      }
    }
  });

  it("has unique ids and paths", () => {
    expect(new Set(ROUTES.map((r) => r.id)).size).toBe(ROUTES.length);
    expect(new Set(ROUTES.map((r) => r.path)).size).toBe(ROUTES.length);
  });

  // Wave 2 builds the shell and the settings; Wave 3 fills the others in. Until then their
  // addresses answer "no such page" and the rail does not show them: no dead links.
  it("shows only built screens in the rail", () => {
    const { main, bottom } = navRoutes(ADMIN);
    expect(main.every((r) => r.screen)).toBe(true);
    expect(bottom.map((r) => r.id)).toEqual(["settings"]);
  });
});

describe("who may open what", () => {
  it("opens a screen with any one of its permissions; settings for everyone", () => {
    const admin = ROUTES.find((r) => r.id === "admin");
    expect(canReach(admin, ["groups.manage"])).toBe(true);
    expect(canReach(admin, NURSE)).toBe(false);
    expect(canReach(ROUTES.find((r) => r.id === "settings"), [])).toBe(true);
    expect(canReach(undefined, ADMIN)).toBe(false);
  });

  it("lets in whoever a Group-1 screen is for — built or not — and nobody else", () => {
    expect(hasWorkRoute(NURSE)).toBe(true);
    expect(hasWorkRoute(["users.manage"])).toBe(true);
    expect(hasWorkRoute(["devices.manage"])).toBe(false);     // biomedical: Group 4
    expect(hasWorkRoute(["audit.view"])).toBe(false);         // the audit page: Group 2
    expect(hasWorkRoute([])).toBe(false);
  });

  it("lands on the first built screen the session opens, else on its settings", () => {
    const first = navRoutes(NURSE).main[0];
    expect(homePath(NURSE)).toBe(first ? first.path : "/settings");
    expect(homePath(["devices.manage"])).toBe("/settings");
  });
});

describe("matching an address", () => {
  it("finds a route and its parameters", () => {
    expect(matchRoute("/beds")).toMatchObject({ route: { id: "beds" }, params: {} });
    expect(matchRoute("/patients/P%2F1")).toMatchObject({ route: { id: "patient" }, params: { id: "P/1" } });
    expect(matchRoute("/settings/")).toMatchObject({ route: { id: "settings" } });
  });

  it("finds nothing for an unknown or malformed address", () => {
    for (const path of ["", "/", "/yok", "/patients", "/patients/a/b", "/patients/%E0%A4%A"]) {
      expect(matchRoute(path), path).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/shell/routes.test.js 2>&1 | grep -E "Error|Tests "
```
Expected: `Failed to resolve import "./routes.js"`.

- [ ] **Step 3: Implement.** **Create** `dashboard/src/live/shell/routes.js`:

```js
// src/live/shell/routes.js — every screen of Group 1, who may open it, and whether it exists yet.
//
// The one table the rail, the router and the entry rule read. A screen of a later wave is listed
// now with `screen: null`: the rail does not show it and its address answers "no such page" —
// never a dead link. The wave that builds it replaces its own `screen: null` with the component
// (and its own import line below), so the parallel branches of Wave 3 touch different lines.
//
// `perms`: any one of them opens the screen ([] = every signed-in user). `work`: a screen someone
// signs in to use — the entry rule (canEnter) asks whether the session can reach at least one,
// built or not, so nobody is turned away in Wave 2 for want of a screen Wave 3 is building.
// `nav`: "main" (the rail, in this order), "bottom" (the rail's foot) or false (reached from
// another screen: a patient is opened from the beds).
import { SettingsScreen } from "../screens/settings/SettingsScreen.jsx";
// G1-09: import { BedsScreen } from "../screens/beds/BedsScreen.jsx";

// G1-10: import { AlarmsScreen } from "../screens/alarms/AlarmsScreen.jsx";

// G1-11: import { PatientScreen } from "../screens/patient/PatientScreen.jsx";

// G1-12: import { AdminScreen } from "../screens/admin/AdminScreen.jsx";

export const ROUTES = Object.freeze([
  { id: "beds", path: "/beds", icon: "grid", labelKey: "nav.beds", shortKey: "nav.bedsShort",
    perms: ["board.view"], work: true, nav: "main",
    screen: null }, // G1-09

  { id: "alarms", path: "/alarms", icon: "bell", labelKey: "nav.alarms", shortKey: "nav.alarmsShort",
    perms: ["board.view"], work: true, nav: "main",
    screen: null }, // G1-10

  { id: "patient", path: "/patients/:id", icon: "user", labelKey: "nav.patient", shortKey: "nav.patient",
    perms: ["board.view"], work: false, nav: false,
    screen: null }, // G1-11

  { id: "admin", path: "/admin", icon: "shield", labelKey: "nav.admin", shortKey: "nav.adminShort",
    perms: ["users.manage", "groups.manage"], work: true, nav: "main",
    screen: null }, // G1-12 (users), G1-13 (roles), G1-14 (login source) — tabs inside one screen

  { id: "settings", path: "/settings", icon: "gear", labelKey: "nav.settings", shortKey: "nav.settingsShort",
    perms: [], work: false, nav: "bottom", screen: SettingsScreen },
]);

const has = (perms, keys) => keys.length === 0 || keys.some((k) => perms.includes(k));

/** Whether these rights open the route (built or not). */
export function canReach(route, perms) {
  return Boolean(route) && has(Array.isArray(perms) ? perms : [], route.perms);
}

/** The entry rule: the session reaches at least one work screen of Group 1. */
export function hasWorkRoute(perms) {
  return ROUTES.some((r) => r.work && canReach(r, perms));
}

/** The rail: built routes these rights open, `main` ones then `bottom` ones. */
export function navRoutes(perms) {
  const open = ROUTES.filter((r) => r.nav && r.screen && canReach(r, perms));
  return { main: open.filter((r) => r.nav === "main"), bottom: open.filter((r) => r.nav === "bottom") };
}

/** Where a session lands: the first built main screen it opens, else its settings. */
export function homePath(perms) {
  const { main } = navRoutes(perms);
  return (main[0] ?? ROUTES.find((r) => r.id === "settings")).path;
}

/** The route a path names, with its parameters — or null. `/patients/P-1` -> {route, params: {id}}. */
export function matchRoute(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  for (const route of ROUTES) {
    const pattern = route.path.split("/").filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params = {};
    let ok = true;
    pattern.forEach((p, i) => {
      if (p.startsWith(":")) {
        try {
          params[p.slice(1)] = decodeURIComponent(parts[i]);
        } catch {
          ok = false;
        }
      } else if (p !== parts[i]) ok = false;
    });
    if (ok) return { route, params };
  }
  return null;
}
```

- [ ] **Step 4: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  80 passed (80)`, `Tests  1483 passed (1483)`, `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/shell/routes.js dashboard/src/live/shell/routes.test.js
git commit -m "feat(live-ui): one route table for Group 1 — who may open what, and what is built

Wave 3 sets its own screen: null, each on its own line.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 24: The shell — rail, top bar, router, idle lock

**Files:**
- Create: `dashboard/src/live/shell/ShellContext.jsx`, `shell/Sidebar.jsx`, `shell/TopBar.jsx`, `shell/Shell.jsx`
- Test: `dashboard/src/live/shell/Shell.test.jsx`

- [ ] **Step 1: Write the failing test.** **Create** `dashboard/src/live/shell/Shell.test.jsx`:

```jsx
// The signed-in frame: the rail (built screens only, names never icons alone), the router's three
// answers (a screen, "no access", "no such page"), focus, the skip link, the idle lock, the unit
// chip and the language menu. Synthetic accounts only.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "../i18n/I18nProvider.jsx";
import { ThemeProvider } from "../theme/ThemeProvider.jsx";
import { ToastProvider } from "../ui/index.js";
import { SessionProvider } from "../session/SessionProvider.jsx";
import { PHASE, createSessionStore } from "../session/sessionStore.js";
import { BoardProvider } from "../data/BoardProvider.jsx";
import { createBoardStore } from "../data/boardStore.js";
import { fakeApi, profile, token } from "../session/testTokens.testutil.js";
import { ROUTES, hasWorkRoute } from "./routes.js";
import { IDLE_SPOKEN_AGAIN_AT, Shell } from "./Shell.jsx";
import { useShell } from "./ShellContext.jsx";

const NURSE_PERMS = ["board.view", "alerts.ack"];

// What Wave 3 will do: give a route its screen. Undone after each test.
function AdminProbe() {
  return <h1>İdarə ekranı</h1>;
}
function BedsProbe() {
  const { unit } = useShell();
  return <h1>Çarpayı ekranı · {unit ?? "hamısı"}</h1>;
}
const built = (id, screen) => { ROUTES.find((r) => r.id === id).screen = screen; };

async function renderShell({ perms = NURSE_PERMS, scope = { unrestricted: true, unit_ids: [] }, minutes = 10, hash = "#/settings" } = {}) {
  window.location.hash = hash;
  const api = fakeApi(vi, { access: token({ perms }) });
  api.me.mockResolvedValue(profile({ perms, lock_idle_minutes: minutes }));
  api.boardPatients.mockResolvedValue({ patients: [], scope });
  api.streamTicket.mockResolvedValue({ ticket: "t" });
  const session = createSessionStore({ api, canEnter: hasWorkRoute, events: new EventTarget() });
  const streams = [];
  const board = createBoardStore({ api, openStream: (url, handlers) => { streams.push(handlers); return () => {}; } });
  await session.restore();
  await board.start();
  render(
    <ThemeProvider><I18nProvider><ToastProvider>
      <SessionProvider store={session}><BoardProvider store={board}><Shell /></BoardProvider></SessionProvider>
    </ToastProvider></I18nProvider></ThemeProvider>,
  );
  return { api, session, board, streams };
}

beforeEach(() => {
  window.location.hash = "";
});
afterEach(() => {
  built("admin", null);
  built("beds", null);
  vi.useRealTimers();
  localStorage.clear();
});

describe("the rail", () => {
  it("lists the built screens this session may open, each with its name — not an icon alone", async () => {
    built("admin", AdminProbe);
    await renderShell();
    const rail = screen.getByRole("navigation", { name: "Əsas menyu" });
    const links = within(rail).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["#/settings", "#/settings"]);   // home, settings
    const settings = links[1];
    expect(settings).toHaveAttribute("aria-current", "page");
    expect(within(settings).getAllByText("Ayarlar")).toHaveLength(2);                          // full + short (phone)
    expect(within(rail).queryByText("İdarə")).toBeNull();                                       // not the nurse's
  });

  it("shows an administrator the built admin screen", async () => {
    built("admin", AdminProbe);
    await renderShell({ perms: ["users.manage"] });
    const rail = screen.getByRole("navigation", { name: "Əsas menyu" });
    expect(within(rail).getByRole("link", { name: /İdarə/ })).toHaveAttribute("href", "#/admin");
  });
});

describe("the router", () => {
  it("lands an empty address on the session's home", async () => {
    await renderShell({ hash: "" });
    await waitFor(() => expect(window.location.hash).toBe("#/settings"));
    expect(await screen.findByRole("heading", { level: 1, name: "Ayarlar" })).toBeInTheDocument();
  });

  it("answers an unknown address, or a screen not built yet, with 'no such page' — never a blank", async () => {
    await renderShell({ hash: "#/yok" });
    expect(screen.getByRole("heading", { level: 1, name: "Belə səhifə yoxdur." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ana səhifəyə qayıt" })).toHaveAttribute("href", "#/settings");
    act(() => { window.location.hash = "#/beds"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(await screen.findByRole("heading", { level: 1, name: "Belə səhifə yoxdur." })).toBeInTheDocument();
  });

  it("answers a screen the session may not open with 'no access'", async () => {
    built("admin", AdminProbe);
    await renderShell({ hash: "#/admin" });
    expect(screen.getByRole("heading", { level: 1, name: "Bu səhifəyə icazəniz yoxdur" })).toBeInTheDocument();
    expect(screen.queryByText("İdarə ekranı")).toBeNull();
  });

  it("moves focus to the new screen after a move, and the skip link goes there too", async () => {
    built("beds", BedsProbe);
    await renderShell();
    act(() => { window.location.hash = "#/beds"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await screen.findByRole("heading", { level: 1, name: /Çarpayı ekranı/ });
    const main = screen.getByRole("main");
    expect(document.activeElement).toBe(main);
    act(() => screen.getByRole("link", { name: "Əsas məzmuna keç" }).focus());
    fireEvent.click(screen.getByRole("link", { name: "Əsas məzmuna keç" }));
    expect(document.activeElement).toBe(main);
    expect(window.location.hash).toBe("#/beds");                        // the skip link is no route
    act(() => screen.getByRole("link", { name: "Əsas məzmuna keç" }).focus());
    act(() => { window.location.hash = "#/settings"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await screen.findByRole("heading", { level: 1, name: "Ayarlar" });
    expect(document.activeElement).toBe(main);                          // back to the first screen too
  });
});

describe("locking", () => {
  it.each([["l"], ["д"], ["¬"]])("locks on Alt+L, whatever the layout writes (%s)", async (key) => {
    const { session } = await renderShell();
    fireEvent.keyDown(document, { key, code: "KeyL", altKey: true });
    expect(session.getState().phase).toBe(PHASE.LOCKED);
  });

  it("does not lock for another key that writes an l", async () => {
    const { session } = await renderShell();
    fireEvent.keyDown(document, { key: "l", code: "KeyK", altKey: true });
    expect(session.getState().phase).toBe(PHASE.READY);
  });

  it("warns for the last minute of the hospital's idle time, then locks", async () => {
    vi.useFakeTimers();
    const { session } = await renderShell({ minutes: 2 });
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(screen.getByText("Ekran kilidlənəcək")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Davam et" }));
    expect(screen.queryByText("Ekran kilidlənəcək")).toBeNull();
    act(() => { vi.advanceTimersByTime(121_000); });
    expect(session.getState()).toMatchObject({ phase: PHASE.LOCKED, lock: { why: "idle" } });
  });

  it("says the warning when it opens and once more near the end — not every second", async () => {
    vi.useFakeTimers();
    await renderShell({ minutes: 2 });
    act(() => { vi.advanceTimersByTime(61_000); });
    const spoken = screen.getByRole("status");
    const first = spoken.textContent;
    expect(first).toMatch(/Ekran \d+ saniyə ərzində kilidlənəcək/);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByRole("status").textContent).toBe(first);                     // the count moved on screen
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(screen.getByRole("status")).toHaveTextContent(`Ekran ${IDLE_SPOKEN_AGAIN_AT} saniyə ərzində`);
  });
});

describe("the top bar", () => {
  it("offers the units of a restricted scope, and the screen reads the choice", async () => {
    built("beds", BedsProbe);
    await renderShell({ hash: "#/beds", scope: { unrestricted: false, unit_ids: ["NICU", "REA"] } });
    const chip = screen.getByRole("button", { name: "Göstərilən bölmə" });
    expect(chip).toHaveTextContent("Bölmələrim · 2");
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "NICU" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Çarpayı ekranı · NICU");
  });

  it("has no unit chip for an unrestricted scope", async () => {
    await renderShell();
    expect(screen.queryByRole("button", { name: "Göstərilən bölmə" })).toBeNull();
  });

  it("never says 'none' for a board that stopped updating: it shows what it had, marked", async () => {
    const { board, streams } = await renderShell();
    act(() => { streams[0].onopen(); });
    expect(await screen.findByRole("button", { name: /Cavab gözləyən siqnal yoxdur/ })).toBeInTheDocument();
    act(() => { streams[0].onerror(); });
    const bell = screen.getByRole("button", { name: /Cavab gözləyən siqnallar · Cavab gözləyən: 0 — köhnə ola bilər/ });
    expect(bell).not.toHaveAccessibleName(/yoxdur/);
    board.clear();
  });

  it("names the language menu by what it shows first", async () => {
    await renderShell();
    expect(screen.getByRole("button", { name: "AZ · Dil" })).toHaveTextContent("AZ");
  });

  it("switches the language for the whole shell", async () => {
    await renderShell();
    fireEvent.click(screen.getByRole("button", { name: "AZ · Dil" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /English/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main menu" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/shell/Shell.test.jsx 2>&1 | grep -E "Error|Tests "
```
Expected: `Failed to resolve import "./Shell.jsx"`.

- [ ] **Step 3: What the shell holds for its screens.** **Create** `dashboard/src/live/shell/ShellContext.jsx`:

```jsx
// src/live/shell/ShellContext.jsx — what the shell holds for its screens.
//
//   const { unit, setUnit, units } = useShell();
// `units`: the units the engine scoped this session to, when two or more (boardStore.scopeUnits);
// `unit`: the one the top bar's chip picked, or null for all of them. G1-09's bed board filters by
// it. Held in memory only: it goes with the session (the shell unmounts on sign-out and lock).
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

const ShellContext = createContext({ unit: null, setUnit: () => {}, units: [] });

export function ShellProvider({ units, children }) {
  const [unit, setUnit] = useState(null);
  useEffect(() => {
    if (unit !== null && !units.includes(unit)) setUnit(null);   // the scope changed under it
  }, [unit, units]);
  const value = useMemo(() => ({ unit: units.includes(unit) ? unit : null, setUnit, units }), [unit, units]);
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell() {
  return useContext(ShellContext);
}
```

- [ ] **Step 4: The rail.** **Create** `dashboard/src/live/shell/Sidebar.jsx`:

```jsx
// src/live/shell/Sidebar.jsx — the rail (the prototype's .rail / .ri): the screens this session may
// open, built ones only (routes.js), each a link with its icon AND its name — on a phone (62 px)
// its short name, never an icon alone (roadmap: "Daraltılmış sol menüde her madde kısa adıyla
// görünür"). The current screen is aria-current="page".
import React from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { Icon } from "../ui/Icon.jsx";
import { FOCUS_RING } from "../ui/focus.js";
import { homePath, navRoutes } from "./routes.js";

function RailLink({ route, current }) {
  const { t } = useI18n();
  const on = route.id === current;
  return (
    <li>
      <a
        href={`#${route.path}`}
        aria-current={on ? "page" : undefined}
        className={`flex flex-col items-center gap-1 rounded-box px-0.5 pb-2 pt-[9px] text-center font-text text-10.5 font-semibold leading-[1.15] ${on ? "bg-pri text-onpri" : "text-mute hover:bg-card2 hover:text-ink"} ${FOCUS_RING}`}
      >
        <Icon name={route.icon} size={21} />
        <span className="max-[640px]:hidden">{t(route.labelKey)}</span>
        <span className="hidden text-10 max-[640px]:block">{t(route.shortKey)}</span>
      </a>
    </li>
  );
}

/** `current`: the id of the route on screen (null when none is). */
export function Sidebar({ perms, current }) {
  const { t } = useI18n();
  const { main, bottom } = navRoutes(perms);
  return (
    <nav aria-label={t("shell.rail")} className="z-30 flex min-h-0 flex-col gap-[3px] overflow-y-auto border-r border-line bg-rail px-2 py-2.5 max-[640px]:px-1">
      <div className="mb-1.5 border-b border-line pb-3 pt-1">
        <a href={`#${homePath(perms)}`} className={`flex flex-col items-center gap-[5px] rounded-box ${FOCUS_RING}`}>
          <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-ctl bg-ink font-display text-20 font-bold text-app">h</span>
          <small className="font-display text-10 font-bold text-mute max-[640px]:hidden">homunculus</small>
          <span className="sr-only">{t("shell.home")}</span>
        </a>
      </div>
      <ul className="m-0 flex list-none flex-col gap-[3px] p-0">
        {main.map((route) => <RailLink key={route.id} route={route} current={current} />)}
      </ul>
      <div className="flex-1" />
      <ul className="m-0 flex list-none flex-col gap-[3px] p-0">
        {bottom.map((route) => <RailLink key={route.id} route={route} current={current} />)}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 5: The top bar.** **Create** `dashboard/src/live/shell/TopBar.jsx`:

```jsx
// src/live/shell/TopBar.jsx — the prototype's .top (shell.js topHtml): where you are, the unit
// chip, the clock, then the tools — language, theme, full screen, shortcuts, the alarm bell — and
// the account menu.
//
// Not here (plan "Not in this plan"): the shift-end chip (no source in Group 1 — a user decision),
// the patient/bed search (G1-09 brings the board UI it searches), the role preview.
import React, { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { useBoard } from "../data/BoardProvider.jsx";
import { waitingAlarms } from "../data/boardStore.js";
import { CONNECTION } from "../../liveConnection.js";
import { Icon, RiskPill } from "../ui/index.js";
import { FOCUS_RING } from "../ui/focus.js";
import { MenuButton, Popover, TOOL_BUTTON } from "./Menu.jsx";
import { LanguageMenu, ThemeToggle } from "./Prefs.jsx";
import { useShell } from "./ShellContext.jsx";
import { ddmm, hhmm, weekdayKey } from "../i18n/dates.js";

export const BELL_LIST_MAX = 8;
/** The build this page came from (vite.config.js define; "" when the image was built without git). */
const BUILD_SHA = typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "";

function Clock() {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const day = `${t(weekdayKey(now))} ${ddmm(now)}`;
  return (
    <p className="m-0 hidden h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-card2 px-2.5 text-11.5 font-semibold text-mute min-[641px]:flex">
      <Icon name="clock" size={14} />
      <span className="max-[860px]:hidden">{day}</span>
      <time dateTime={new Date(now).toISOString()} className="font-data text-ink">{hhmm(now)}</time>
    </p>
  );
}

function UnitChip() {
  const { t } = useI18n();
  const { unit, setUnit, units } = useShell();
  if (units.length < 2) return null;
  return (
    <MenuButton
      label={t("shell.unitChoice")}
      buttonClassName={`hidden h-9 shrink-0 items-center gap-2 rounded-ctl border border-line bg-card2 px-2.5 text-12.5 font-semibold text-ink min-[641px]:inline-flex ${FOCUS_RING}`}
      button={(
        <>
          <Icon name="building" size={16} />
          <span className="max-w-[160px] truncate">{unit ?? t("shell.units", { count: units.length })}</span>
          <Icon name="chevD" size={14} className="text-mute" />
        </>
      )}
      items={[
        { key: "", label: t("shell.allUnits"), checked: unit === null, onSelect: () => setUnit(null) },
        "separator",
        ...units.map((u) => ({ key: u, label: <span className="font-data">{u}</span>, checked: unit === u, onSelect: () => setUnit(u) })),
      ]}
    />
  );
}

function FullscreenButton() {
  const { t } = useI18n();
  const [on, setOn] = useState(() => Boolean(document.fullscreenElement));
  useEffect(() => {
    const sync = () => setOn(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  if (typeof document.documentElement.requestFullscreen !== "function") return null;
  const label = t(on ? "shell.exitFullscreen" : "shell.fullscreen");
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={() => (on ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}
      className={`${TOOL_BUTTON} max-[1100px]:hidden`}
    >
      <Icon name="fullscreen" size={19} />
    </button>
  );
}

function Keys() {
  const { t } = useI18n();
  const rows = [["Esc", "shell.keyClose"], ["Alt L", "shell.keyLock"], ["F11", "shell.keyFull"]];
  return (
    <Popover label={t("shell.keys")} buttonClassName={`${TOOL_BUTTON} max-[640px]:hidden`} button={<Icon name="keyboard" size={19} />}>
      {() => (
        <dl className="m-0 min-w-[260px] p-1 text-13">
          {rows.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-4 py-1.5">
              <dt>{t(label)}</dt>
              <dd className="m-0"><kbd className="rounded-md border border-b-2 border-line2 bg-card2 px-1.5 py-1 font-data text-10.5 font-semibold text-mute">{key}</kbd></dd>
            </div>
          ))}
        </dl>
      )}
    </Popover>
  );
}

/** The alarms nobody has acknowledged yet, in this session's scope. Only a LIVE board may say
 *  "none"; one that stopped updating (DEGRADED) shows what it last had, marked as possibly out of
 *  date, with the dot; one that is not there says it cannot know (liveConnection.js's rule). */
function Bell() {
  const { t } = useI18n();
  const { alerts, connection } = useBoard();
  const live = connection === CONNECTION.LIVE;
  const stale = connection === CONNECTION.DEGRADED;
  const waiting = live || stale ? waitingAlarms(alerts) : [];
  let status;
  if (live) status = waiting.length ? t("shell.bellCount", { count: waiting.length }) : t("shell.bellNone");
  else if (stale) status = t("shell.bellStale", { count: waiting.length });
  else status = t(connection === CONNECTION.CONNECTING ? "shell.bellConnecting" : "shell.bellUnavailable");
  return (
    <Popover
      label={`${t("shell.bell")} · ${status}`}
      // On a phone the panel spans the screen under the top bar: hung from the bell it would run
      // off the left edge.
      panelClassName="w-[400px] p-0 max-[640px]:fixed max-[640px]:inset-x-2 max-[640px]:top-[62px] max-[640px]:w-auto"
      button={(
        <>
          <Icon name="bell" size={19} />
          {waiting.length ? (
            <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-[16px] rounded-full border-2 border-rail bg-crit px-1 font-text text-10 font-bold leading-[14px] text-oncrit">{waiting.length}</span>
          ) : null}
          {!live ? <span aria-hidden="true" className="absolute bottom-1 right-1 h-2 w-2 rounded-full border-2 border-rail bg-mid" /> : null}
        </>
      )}
    >
      {() => (
        <div>
          <div className="flex items-center gap-2 border-b border-line px-3.5 py-3">
            <h2 className="m-0 font-display text-15 font-bold">{t("shell.bell")}</h2>
          </div>
          <p className="m-0 px-3.5 py-2.5 text-12.5 text-mute">{status}</p>
          {waiting.length ? (
            <ul className="m-0 max-h-[min(460px,60vh)] list-none overflow-auto p-0">
              {waiting.slice(0, BELL_LIST_MAX).map((a) => (
                <li key={a.id} className="grid grid-cols-[auto_1fr_auto] items-start gap-2.5 border-t border-line px-3.5 py-2.5">
                  <RiskPill risk={a.severity} measured />
                  <div className="min-w-0">
                    <b className="block font-data text-13">{a.bedLabel}</b>
                    <span className="block text-12 text-mute">{a.summary ?? a.kind}</span>
                  </div>
                  <span className="whitespace-nowrap font-data text-11 font-semibold text-mute">
                    {a.firstSeenAtMs ? t("shell.bellSince", { time: hhmm(a.firstSeenAtMs) }) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {waiting.length > BELL_LIST_MAX ? (
            <p className="m-0 border-t border-line bg-card2 px-3.5 py-2.5 text-12 text-mute">{t("shell.bellMore", { count: waiting.length - BELL_LIST_MAX })}</p>
          ) : null}
        </div>
      )}
    </Popover>
  );
}

function AccountMenu() {
  const { t } = useI18n();
  const { user, store } = useSession();
  const initials = (user.fullName || user.username).split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join("");
  return (
    <MenuButton
      label={t("shell.account")}
      buttonClassName={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-pri font-text text-12 font-bold text-onpri ${FOCUS_RING}`}
      button={<span aria-hidden="true">{initials}</span>}
      header={(
        <div className="px-2.5 pb-2 pt-1.5">
          <b className="block text-14">{user.fullName}</b>
          <small className="block text-12 text-mute">{user.groups.map((g) => g.name).join(" · ") || user.username}</small>
          <small className="mt-1 block font-data text-10.5 text-mute">
            {BUILD_SHA ? t("shell.version", { sha: BUILD_SHA }) : t("shell.versionUnknown")}
          </small>
        </div>
      )}
      items={[
        "separator",
        { key: "settings", label: t("nav.settings"), icon: "gear", onSelect: () => { window.location.hash = "#/settings"; } },
        { key: "lock", label: t("shell.lock"), icon: "lock", onSelect: () => store.lock("manual") },
        { key: "out", label: t("shell.signOut"), icon: "out", onSelect: () => store.signOut() },
      ]}
    />
  );
}

/** `title`: the page's name, for the breadcrumb after the hospital's. */
export function TopBar({ title }) {
  const { user } = useSession();
  const seesBoard = user.perms.includes("board.view");
  return (
    <header className="flex h-[58px] min-w-0 items-center gap-2.5 border-b border-line bg-rail px-4 max-[640px]:gap-1.5 max-[640px]:px-2">
      <p className="m-0 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap font-display text-17 font-bold">
        <span className="truncate text-mute max-[860px]:hidden">{user.tenantName || user.tenant}</span>
        <Icon name="chevR" size={16} className="shrink-0 text-mute max-[860px]:hidden" />
        <span className="truncate">{title}</span>
      </p>
      <UnitChip />
      <span className="ml-auto" />
      <Clock />
      <div className="flex shrink-0 items-center gap-0.5 border-l border-line pl-2 max-[640px]:border-l-0 max-[640px]:pl-0">
        <LanguageMenu />
        <ThemeToggle />
        <FullscreenButton />
        <Keys />
        {seesBoard ? <Bell /> : null}
      </div>
      <AccountMenu />
    </header>
  );
}
```

- [ ] **Step 6: The frame and the router.** **Create** `dashboard/src/live/shell/Shell.jsx`:

```jsx
// src/live/shell/Shell.jsx — the signed-in frame: skip link, rail, top bar, the screen, and the
// idle lock. The prototype's .shell (shell.js renderApp).
//
// Routing is the address's hash (#/beds, #/patients/P-1): no server rule and no new dependency.
// An address the session may not open is a "no access" page, one that names nothing (or a screen
// of a later wave) is "no such page" — never a blank, never a silent jump elsewhere. The empty
// address lands on the session's home (routes.js homePath). After a move between screens — back
// to the first one too — focus goes to <main>, so a screen reader starts at the new screen.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { useIdleLock } from "../session/useIdleLock.js";
import { useBoard } from "../data/BoardProvider.jsx";
import { scopeUnits } from "../data/boardStore.js";
import { Button, Icon } from "../ui/index.js";
import { FOCUS_RING } from "../ui/focus.js";
import { canReach, homePath, matchRoute } from "./routes.js";
import { ShellProvider } from "./ShellContext.jsx";
import { Sidebar } from "./Sidebar.jsx";
import { TopBar } from "./TopBar.jsx";

const pathOf = () => window.location.hash.replace(/^#/, "");
const isEmptyPath = (path) => path === "" || path === "/";

/** Seconds before the lock at which the warning is said once more (it is said when it opens). */
export const IDLE_SPOKEN_AGAIN_AT = 10;

function useHashPath() {
  const [path, setPath] = useState(pathOf);
  useEffect(() => {
    const sync = () => setPath(pathOf());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return path;
}

function Blocked({ title, help, home }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto my-[10vh] max-w-[460px] rounded-dlg border border-line bg-card px-6 py-7 text-center">
      <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-pri-soft text-pri">
        <Icon name="shield" size={26} />
      </div>
      <h1 className="m-0 mb-1.5 font-display text-20 font-bold">{title}</h1>
      {help ? <p className="m-0 mb-4 text-mute">{help}</p> : null}
      <a href={`#${home}`} className={`inline-flex items-center gap-1.5 rounded-ctl bg-pri px-[13px] py-2 text-13 font-semibold text-onpri ${FOCUS_RING}`}>
        {t("shell.home")}
      </a>
    </div>
  );
}

/** The last minute before the idle lock. The count on screen moves every second; what a screen
 *  reader hears does not — it is said when the warning opens and once more IDLE_SPOKEN_AGAIN_AT
 *  seconds before the lock, not sixty times. */
function IdleWarning({ seconds, onStay }) {
  const { t } = useI18n();
  const opened = useRef(seconds);
  const spoken = seconds <= IDLE_SPOKEN_AGAIN_AT ? Math.min(opened.current, IDLE_SPOKEN_AGAIN_AT) : opened.current;
  return (
    <div className="fixed bottom-[22px] left-1/2 z-[200] flex -translate-x-1/2 items-center gap-3 rounded-box border border-mid bg-card px-3.5 py-3 font-text text-13 text-ink shadow-pop">
      <p role="status" className="sr-only">{t("shell.idleSpoken", { seconds: spoken })}</p>
      <Icon name="lock" size={20} className="text-mid-ink" />
      <div aria-hidden="true">
        <b className="block">{t("shell.idle")}</b>
        <small className="text-mute">{t("shell.idleWhy", { seconds })}</small>
      </div>
      <Button variant="primary" size="sm" onClick={onStay}>{t("shell.idleStay")}</Button>
    </div>
  );
}

export function Shell() {
  const { t } = useI18n();
  const { user, store } = useSession();
  const { scope } = useBoard();
  const units = useMemo(() => scopeUnits(scope), [scope]);
  const path = useHashPath();
  const home = homePath(user.perms);
  const main = useRef(null);
  const shownPath = useRef(path);

  useEffect(() => {
    if (isEmptyPath(path)) window.location.replace(`#${home}`);
  }, [path, home]);

  // Focus the new screen after every move — back to the first one too — but not when the page
  // has just loaded, nor when an empty address was sent home.
  useEffect(() => {
    const from = shownPath.current;
    if (from === path) return;
    shownPath.current = path;
    if (!isEmptyPath(from)) main.current?.focus();
  }, [path]);

  const { secondsLeft, stay } = useIdleLock({ minutes: user.lockIdleMinutes, onIdle: () => store.lock("idle") });

  useEffect(() => {
    // The key's place, not its letter: Alt+L on an Azerbaijani, Russian or Turkish layout — or a
    // Mac's Option+L, which types "¬" — is the same key.
    const onKey = (event) => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === "KeyL") {
        event.preventDefault();
        store.lock("manual");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [store]);

  const match = matchRoute(path);
  let content;
  let title;
  if (!match || !match.route.screen) {
    title = t("shell.notFound");
    content = isEmptyPath(path) ? null : <Blocked title={title} home={home} />;
  } else if (!canReach(match.route, user.perms)) {
    title = t("shell.deny");
    content = <Blocked title={title} help={t("shell.denyHelp")} home={home} />;
  } else {
    title = t(match.route.labelKey);
    const Screen = match.route.screen;
    content = <Screen params={match.params} />;
  }

  useEffect(() => {
    document.title = `${title} · Homunculus`;
  }, [title]);

  return (
    <ShellProvider units={units}>
      <div className="grid h-full grid-cols-[86px_minmax(0,1fr)] bg-page font-text text-14.5 text-ink max-[640px]:grid-cols-[62px_minmax(0,1fr)]">
        <a
          href="#main"
          onClick={(e) => { e.preventDefault(); main.current?.focus(); }}
          className={`sr-only z-[300] rounded-ctl bg-pri px-3 py-2 text-13 font-semibold text-onpri focus:not-sr-only focus:fixed focus:left-2 focus:top-2 ${FOCUS_RING}`}
        >
          {t("shell.skip")}
        </a>
        <Sidebar perms={user.perms} current={match?.route.id ?? null} />
        <div className="grid min-h-0 min-w-0 grid-rows-[58px_minmax(0,1fr)]">
          <TopBar title={title} />
          <main ref={main} id="main" tabIndex={-1} className="min-h-0 overflow-auto px-5 pb-10 pt-[18px] outline-none max-[640px]:px-3 max-[640px]:pt-3.5">
            {content}
          </main>
        </div>
        {secondsLeft !== null ? <IdleWarning seconds={secondsLeft} onStay={stay} /> : null}
      </div>
    </ShellProvider>
  );
}
```

- [ ] **Step 7: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  81 passed (81)`, `Tests  1500 passed (1500)`, `✓ built in …`.

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/shell/ShellContext.jsx dashboard/src/live/shell/Sidebar.jsx dashboard/src/live/shell/TopBar.jsx dashboard/src/live/shell/Shell.jsx dashboard/src/live/shell/Shell.test.jsx
git commit -m "feat(live-ui): the shell — permission-filtered rail, top bar, hash router, idle lock

Rail entries with their names (short on a phone, never an icon alone);
breadcrumb, unit chip from the engine's scope, clock, language, theme,
full screen, shortcuts, the bell (unacknowledged alarms; 'none' only
when LIVE, 'may be out of date' when DEGRADED, 'cannot know' otherwise),
the account menu with the build SHA. 'No such page' and 'no access'
instead of blanks; skip link; focus to <main> after every move; Alt+L
(by the key's place) and the hospital's idle time lock, the warning said
twice, not every second.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 25: The live mode's root

**Files:**
- Create: `dashboard/src/live/LiveApp.jsx`
- Test: `dashboard/src/live/LiveApp.test.jsx`, `dashboard/src/live/boundaries.test.js`

- [ ] **Step 1: Write the failing tests.** **Create** `dashboard/src/live/LiveApp.test.jsx`:

```jsx
// The live mode end to end, on a fake API: sign-in, the TOTP step, the forced password change, the
// shell, the lock, sign-out. Azerbaijani by default (roadmap D2). Synthetic accounts only.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import LiveApp from "./LiveApp.jsx";
import { fakeApi, profile, token } from "./session/testTokens.testutil.js";
import { writeLock } from "./session/browserState.js";

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,QR") } }));

const NURSE = token();
const PENDING = token({ sub: "u-kaya", groups: ["attending"], perms: ["board.view"], mfaRequired: true });
const VERIFIED = token({ sub: "u-kaya", groups: ["attending"], perms: ["board.view"], mfaRequired: true, mfaVerified: true });

// Synthetic board: two patients, one alarm nobody has acknowledged yet.
const BOARD = {
  patients: [
    { patient_id: "P-001", risk: "high", vitals: {}, alerts: [{ kind: "news2", severity: "high", summary: "NEWS2 7", first_seen_at: "2026-10-04T07:58:00Z", acknowledged: false }], identity: { bed_label: "REA-01" } },
    { patient_id: "P-002", risk: "none", vitals: {}, alerts: [] },
  ],
  scope: { unrestricted: true, unit_ids: [] },
};

/** The announced message with this text (not the toast stack's own, always-present alert region). */
async function announced(text) {
  const el = await screen.findByText(text, { exact: false });
  return el.closest("[role='alert'], [role='status']");
}

function refusal(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

function app({ access = null, board = BOARD, me = null, setup } = {}) {
  const api = fakeApi(vi, { access });
  if (me) api.me.mockResolvedValue(me);
  setup?.(api);
  if (board instanceof Error) api.boardPatients.mockRejectedValue(board);
  else api.boardPatients.mockResolvedValue(board);
  api.streamTicket.mockResolvedValue({ ticket: "t-1" });
  // A stream that opens, as EventSource does once the server answers: the board reloads, then is LIVE.
  const openStream = vi.fn((url, handlers) => {
    Promise.resolve().then(() => handlers.onopen());
    return () => {};
  });
  render(<LiveApp api={api} openStream={openStream} />);
  return api;
}

async function signIn(api, { tokens = { access_token: NURSE }, me = profile(), login = "ayse", password = "Gizli-Sifre-1" } = {}) {
  api.login.mockImplementation(async () => { api.store(tokens.access_token); return tokens; });
  api.me.mockResolvedValue(me);
  fireEvent.change(await screen.findByLabelText(/^İstifadəçi adı \*$/), { target: { value: login } });
  fireEvent.change(screen.getByLabelText(/^Şifrə \*$/), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: /Daxil ol/ }));
}

beforeEach(() => {
  window.location.hash = "";
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.title = "";
});

describe("signing in", () => {
  it("opens on the sign-in form, in Azerbaijani", async () => {
    const api = app();
    expect(await screen.findByRole("heading", { level: 1, name: "Daxil olun" })).toBeInTheDocument();
    expect(api.me).not.toHaveBeenCalled();
    expect(document.documentElement.lang).toBe("az");
  });

  it("says what is missing, on the field, before anything is sent", async () => {
    const api = app();
    fireEvent.click(await screen.findByRole("button", { name: /Daxil ol/ }));
    const login = screen.getByLabelText(/^İstifadəçi adı \*$/);
    expect(login).toHaveAttribute("aria-invalid", "true");
    expect(login).toHaveAccessibleDescription(/İstifadəçi adınızı və ya e-poçtunuzu daxil edin/);
    expect(document.activeElement).toBe(login);
    expect(api.login).not.toHaveBeenCalled();
  });

  it("lands an account straight in the product, on its home — no setup wizard", async () => {
    const api = app();
    await signIn(api);
    expect(await screen.findByRole("heading", { level: 1, name: "Ayarlar" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Əsas menyu" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent("Sentetik Hastane");
    await waitFor(() => expect(window.location.hash).toBe("#/settings"));
    expect(document.title).toBe("Ayarlar · Homunculus");
    expect(api.boardPatients).toHaveBeenCalled();
  });

  it("announces a refusal in the user's language and empties the password", async () => {
    const api = app();
    api.login.mockRejectedValue(refusal(401, "Invalid credentials"));
    fireEvent.change(await screen.findByLabelText(/^İstifadəçi adı \*$/), { target: { value: "ayse" } });
    fireEvent.change(screen.getByLabelText(/^Şifrə \*$/), { target: { value: "yanlis" } });
    fireEvent.click(screen.getByRole("button", { name: /Daxil ol/ }));
    expect(await announced("İstifadəçi adı və ya şifrə səhvdir.")).toHaveAttribute("role", "alert");
    expect(screen.getByLabelText(/^Şifrə \*$/)).toHaveValue("");
    expect(document.activeElement).toBe(screen.getByLabelText(/^Şifrə \*$/));
  });

  it("holds the button as long as a 429 says", async () => {
    const api = app();
    api.login.mockRejectedValue(refusal(429, "Çok fazla giriş denemesi; bir dakika sonra tekrar deneyin", { retryAfter: 60 }));
    fireEvent.change(await screen.findByLabelText(/^İstifadəçi adı \*$/), { target: { value: "ayse" } });
    fireEvent.change(screen.getByLabelText(/^Şifrə \*$/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Daxil ol/ }));
    expect(await screen.findByText("60 saniyədən sonra yenidən cəhd edə bilərsiniz.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Daxil ol/ })).toBeDisabled();
  });

  it("remembers the username — only it — and fills it in next time", async () => {
    const api = app();
    fireEvent.click(await screen.findByLabelText("İstifadəçi adını xatırla"));
    await signIn(api);
    await screen.findByRole("heading", { level: 1, name: "Ayarlar" });
    expect(localStorage.getItem("hmc.rememberUser")).toBe("ayse");
    expect(Object.values(localStorage).join(" ")).not.toContain("Gizli-Sifre-1");
  });

  it("says whom to ask when the password is forgotten — no SMS, no e-mail", async () => {
    app();
    const forgot = await screen.findByRole("button", { name: "Şifrəni unutmusunuz?" });
    expect(forgot).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(forgot);
    expect(screen.getByRole("note")).toHaveTextContent(/İT şöbəsinə müraciət edin/);
  });
});

describe("a page load", () => {
  it("keeps a session the server could not check, and retries on request", async () => {
    const api = app({ access: NURSE,
      setup: (a) => a.me.mockRejectedValueOnce(refusal(503, "upstream")).mockResolvedValueOnce(profile()) });
    expect(await screen.findByRole("heading", { level: 1, name: "Serverə qoşulmaq mümkün deyil" })).toBeInTheDocument();
    expect(api.logout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yenidən cəhd et" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Ayarlar" })).toBeInTheDocument();
  });
});

describe("the TOTP step and the forced password change", () => {
  it("enrols an authenticator (QR and key drawn here), then checks the code", async () => {
    const api = app();
    api.setupTotp.mockResolvedValue({ provisioning_uri: "otpauth://totp/Homunculus:dr.kaya?secret=JBSWY3DPEHPK3PXP&issuer=Homunculus" });
    await signIn(api, { tokens: { access_token: PENDING, requires_mfa: true, mfa_enrolled: false },
                        me: profile({ id: "u-kaya", full_name: "Dr. Sentetik", totp_enabled: false }) });
    expect(await screen.findByRole("heading", { level: 1, name: "Autentifikatoru quraşdırın" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "Autentifikator tətbiqi üçün QR kod" })).toBeInTheDocument();
    expect(screen.getByText("JBSW Y3DP EHPK 3PXP")).toBeInTheDocument();
    expect(screen.getByText("Addım 2/2")).toBeInTheDocument();
    expect(api.setupTotp).toHaveBeenCalledTimes(1);
    api.verifyTotp.mockImplementation(async () => { api.store(VERIFIED); return { access_token: VERIFIED }; });
    fireEvent.change(screen.getByLabelText(/6 rəqəmli kod/), { target: { value: "12a3456" } });
    fireEvent.click(screen.getByRole("button", { name: "Təsdiqlə" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Ayarlar" })).toBeInTheDocument();
    expect(api.verifyTotp).toHaveBeenCalledWith("123456");
  });

  it("shows a wrong code's refusal and stays", async () => {
    const api = app();
    await signIn(api, { tokens: { access_token: PENDING, requires_mfa: true, mfa_enrolled: true },
                        me: profile({ id: "u-kaya", totp_enabled: true }) });
    await screen.findByRole("heading", { level: 1, name: "İki addımlı doğrulama" });
    api.verifyTotp.mockRejectedValue(refusal(401, "Invalid TOTP code"));
    fireEvent.change(screen.getByLabelText(/6 rəqəmli kod/), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Təsdiqlə" }));
    expect(await announced("Kod səhvdir və ya vaxtı bitib.")).toHaveAttribute("role", "alert");
    expect(api.setupTotp).not.toHaveBeenCalled();
  });

  it("makes a temporary password be replaced before the shell opens", async () => {
    const api = app();
    await signIn(api, { tokens: { access_token: NURSE, password_change_required: true },
                        me: profile({ must_change_password: true }) });
    expect(await screen.findByRole("heading", { level: 1, name: "Yeni şifrə təyin edin" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
    fireEvent.change(screen.getByLabelText(/Sizə verilən müvəqqəti şifrə/), { target: { value: "Gecici-1" } });
    fireEvent.change(screen.getByLabelText(/^Yeni şifrə \*/), { target: { value: "Gecici-1" } });
    fireEvent.change(screen.getByLabelText(/Yeni şifrə \(təkrar\)/), { target: { value: "Gecici-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Şifrəni yadda saxla və davam et" }));
    expect(screen.getByLabelText(/^Yeni şifrə \*/)).toHaveAccessibleDescription(/Yeni şifrə cari şifrədən fərqli olmalıdır/);
    expect(api.changePassword).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^Yeni şifrə \*/), { target: { value: "Kendi-Sifrem-9" } });
    fireEvent.change(screen.getByLabelText(/Yeni şifrə \(təkrar\)/), { target: { value: "Kendi-Sifrem-9" } });
    api.changePassword.mockResolvedValue({ access_token: NURSE });
    api.me.mockResolvedValue(profile());
    fireEvent.click(screen.getByRole("button", { name: "Şifrəni yadda saxla və davam et" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Ayarlar" })).toBeInTheDocument();
    expect(api.changePassword).toHaveBeenCalledWith("Gecici-1", "Kendi-Sifrem-9");
  });
});

describe("the lock", () => {
  async function ready() {
    const api = app();
    await signIn(api);
    await screen.findByRole("heading", { level: 1, name: "Ayarlar" });
    await waitFor(() => expect(api.streamTicket).toHaveBeenCalled());
    return api;
  }

  it("replaces the whole shell — nothing of the session stays on the page — and unlocks with the password", async () => {
    const api = await ready();
    fireEvent.click(screen.getByRole("button", { name: "Hesab menyusu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Ekranı kilidlə" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Ekran kilidlənib" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("banner")).toBeNull();
    expect(document.body).not.toHaveTextContent("REA-01");
    const counts = screen.getByRole("region", { name: "Bölmələrinizdəki açıq siqnalların sayı" });
    await waitFor(() => expect(counts).toHaveTextContent("Bölmələrinizdəki açıq siqnal: 1"));
    expect(counts).toHaveTextContent("Təsdiqlənməmiş: 1");
    expect(counts).toHaveTextContent("1 yüksək");

    api.reauth.mockRejectedValueOnce(refusal(403, "Parola hatalı"));
    fireEvent.change(screen.getByLabelText("Şifrə"), { target: { value: "yanlis" } });
    fireEvent.click(screen.getByRole("button", { name: "Kilidi aç" }));
    expect(await announced("Şifrə səhvdir. Qalan cəhd: 2")).toHaveAttribute("role", "alert");
    api.reauth.mockResolvedValueOnce({ ok: true });
    fireEvent.change(screen.getByLabelText("Şifrə"), { target: { value: "Gizli-Sifre-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Kilidi aç" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Ayarlar" })).toBeInTheDocument();
    expect(api.reauth).toHaveBeenLastCalledWith("Gizli-Sifre-1");
  });

  it("lets someone else sign in instead, with no password", async () => {
    const api = await ready();
    act(() => { fireEvent.keyDown(document, { key: "l", code: "KeyL", altKey: true }); });
    fireEvent.click(await screen.findByRole("button", { name: "Başqa istifadəçi ilə giriş" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Daxil olun" })).toBeInTheDocument();
    expect(api.logout).toHaveBeenCalled();
  });

  it("opens on the lock screen after a reload when this browser is locked", async () => {
    writeLock({ user: "u-ayse", at: Date.now(), why: "idle" });
    app({ access: NURSE, me: profile() });
    expect(await screen.findByRole("heading", { level: 1, name: "Ekran kilidlənib" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("says it cannot know rather than 'no open alarms' when the board is unreachable", async () => {
    writeLock({ user: "u-ayse", at: Date.now(), why: "manual" });
    const api = app({ access: NURSE, me: profile(), board: new Error("Failed to fetch") });
    const counts = await screen.findByRole("region", { name: "Bölmələrinizdəki açıq siqnalların sayı" });
    await waitFor(() => expect(counts).toHaveTextContent("Siqnal məlumatı alına bilmir"));
    await waitFor(() => expect(api.boardPatients).toHaveBeenCalledTimes(2));        // the stream opened: reloaded
    expect(counts).toHaveTextContent("Siqnal məlumatı alına bilmir");               // and still cannot know
    expect(counts).not.toHaveTextContent("yoxdur");
  });
});

describe("signing out", () => {
  it("empties the session: the form, a notice, no board, no tokens", async () => {
    const api = app();
    await signIn(api);
    await screen.findByRole("heading", { level: 1, name: "Ayarlar" });
    fireEvent.click(screen.getByRole("button", { name: "Hesab menyusu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Çıxış" }));
    expect(await announced("Təhlükəsiz çıxış edildi.")).toHaveAttribute("role", "status");
    expect(api.logout).toHaveBeenCalled();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

describe("the bell", () => {
  it("lists the alarms nobody has acknowledged", async () => {
    const api = app();
    await signIn(api);
    const bell = await screen.findByRole("button", { name: /Cavab gözləyən siqnallar · 1 siqnal cavab gözləyir/ });
    fireEvent.click(bell);
    const panel = screen.getByRole("region", { name: /Cavab gözləyən siqnallar/ });
    expect(within(panel).getByText("REA-01")).toBeInTheDocument();
    expect(within(panel).getByText("NEWS2 7")).toBeInTheDocument();
  });

  it("never shows 'none' when it cannot know — not even once the stream opened", async () => {
    const api = app({ board: new Error("Failed to fetch") });
    await signIn(api);
    expect(await screen.findByRole("button", { name: /Siqnal məlumatı alına bilmir/ })).toBeInTheDocument();
    await waitFor(() => expect(api.boardPatients).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: /Siqnal məlumatı alına bilmir/ })).toBeInTheDocument();
  });

  it("takes the shell to the password step when the board answers that the password was reset", async () => {
    const api = app({ board: Object.assign(new Error("password_change_required"), { status: 403 }) });
    await signIn(api);
    expect(await screen.findByRole("heading", { level: 1, name: "Yeni şifrə təyin edin" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("is not there for an account that cannot see the board", async () => {
    const admin = token({ sub: "u-admin", groups: ["user_desk"], perms: ["users.manage"] });
    const api = app();
    await signIn(api, { tokens: { access_token: admin }, me: profile({ id: "u-admin" }) });
    await screen.findByRole("heading", { level: 1, name: "Ayarlar" });
    expect(screen.queryByRole("button", { name: /Cavab gözləyən siqnallar/ })).toBeNull();
    expect(api.boardPatients).not.toHaveBeenCalled();
  });
});
```

**Create** `dashboard/src/live/boundaries.test.js`:

```js
// Roadmap D1: the new shell does not rest on the demo. Nothing under src/live/ may import the old
// workspace — ClinicalDemo.jsx, clinicalDemo.js, liveStore.js (built over the simulation),
// clinicalI18n.js, ui.jsx… — so G1-16 can delete it without touching a line here. What it may use
// from outside is the framework-free client of the real API: listed below, nothing else.
// (Tests may read more — permissions.js for the catalogue — so test files are not checked.)
//
// Every way a module can pull another in is read: `import … from`, `export … from`, a bare
// `import "x"` (side effects only), each over several lines, and `import("x")`. What cannot be
// followed by reading — `import(` with anything but a quoted path, `import.meta.glob` — fails
// here outright: an import this test cannot see is an import it cannot check.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIVE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.dirname(LIVE);
const ALLOWED = new Set(["backendApi.js", "liveAuth.js", "liveAdapters.js", "liveConnection.js"]);

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(js|jsx)$/.test(entry.name) && !/\.test\.|\.testutil\./.test(entry.name) ? [full] : [];
  });
}

const STATIC = /(?:^|[;}\s])(?:import|export)(?:\s+[^;'"`]*?\bfrom\s*|\s*)["']([^"']+)["']/g;
const DYNAMIC = /\bimport\s*\(\s*(?:["']([^"']+)["']\s*\))?/g;

/** What a source imports ({specs}), and what it pulls in that reading cannot follow ({unreadable}). */
export function importsOf(text) {
  const specs = [...text.matchAll(STATIC)].map((m) => m[1]);
  const unreadable = [];
  for (const m of text.matchAll(DYNAMIC)) {
    if (m[1]) specs.push(m[1]);
    else unreadable.push(m[0].trim());
  }
  if (/\bimport\.meta\.glob/.test(text)) unreadable.push("import.meta.glob");
  return { specs, unreadable };
}

describe("reading a module's imports", () => {
  it("reads every form: from, side effects only, re-exports, several lines, import()", () => {
    const text = [
      'import React, { useState } from "react";',
      'import "./theme/assets.js";',
      "import {",
      "  liveStore,",
      "  other,",
      '} from "../liveStore.js";',
      'export { thing } from "./thing.js";',
      'export * from "../clinicalDemo.js";',
      'const Lazy = React.lazy(() => import("../ClinicalDemo.jsx"));',
      "import'./no-space.js';",
    ].join("\n");
    expect(importsOf(text)).toEqual({
      specs: ["react", "./theme/assets.js", "../liveStore.js", "./thing.js", "../clinicalDemo.js",
        "./no-space.js", "../ClinicalDemo.jsx"],
      unreadable: [],
    });
  });

  it("refuses what it cannot follow: import() of a computed path, import.meta.glob", () => {
    const text = [
      "const a = import(name);",
      "const b = import(`../${file}`);",
      'const c = import.meta.glob("../*.js");',
      "if (import.meta.env.DEV) {}",
    ].join("\n");
    expect(importsOf(text).unreadable).toEqual(["import(", "import(", "import.meta.glob"]);
  });
});

describe("src/live/ stands on its own", () => {
  const files = sources(LIVE);

  it("finds the live UI's sources", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((f) => f.endsWith("LiveApp.jsx"))).toBe(true);
  });

  it("imports nothing from the old workspace but the API client, and nothing it cannot read", () => {
    const outside = [];
    for (const file of files) {
      const name = path.relative(SRC, file).replace(/\\/g, "/");
      const { specs, unreadable } = importsOf(fs.readFileSync(file, "utf8"));
      for (const what of unreadable) outside.push(`${name} -> ${what} (cannot be checked)`);
      for (const spec of specs) {
        if (!spec.startsWith(".")) continue;                   // a package
        const target = path.resolve(path.dirname(file), spec);
        if (target.startsWith(LIVE + path.sep)) continue;
        const rel = path.relative(SRC, target).replace(/\\/g, "/");
        if (!ALLOWED.has(rel)) outside.push(`${name} -> ${rel}`);
      }
    }
    expect(outside).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/LiveApp.test.jsx src/live/boundaries.test.js 2>&1 | grep -E "Error|×|Tests "
```
Expected: `Test Files  2 failed (2)`, `Tests  1 failed | 3 passed (4)` — `LiveApp.test.jsx` fails to load (`Failed to resolve import "./LiveApp.jsx"`); `boundaries.test.js` fails "finds the live UI's sources" (`expected false to be true`: no `LiveApp.jsx`), and its two tests of `importsOf` and the import check pass — nothing under `src/live/` imports the old workspace, or anything it cannot read.

- [ ] **Step 3: Implement.** **Create** `dashboard/src/live/LiveApp.jsx`:

```jsx
// src/live/LiveApp.jsx — the live mode: the bare URL and ?live=1 (main.jsx), lazily loaded.
//
// One session store and one board store per page, both on the real API (roadmap D1: no demo store
// under them). The phase picks the screen: the session check, sign-in, the TOTP step, the forced
// password change, the shell, or the lock screen. The board runs while a session that may see it
// is open or locked (the lock screen counts its open alarms) and is emptied the moment the session
// ends; the toasts are emptied when it locks or ends. Every per-user thing the page held goes with
// the session (sessionStore.js `end`).
import "./theme/assets.js";
import React, { useEffect, useState } from "react";
import { backendApi } from "../backendApi.js";
import { ThemeProvider } from "./theme/ThemeProvider.jsx";
import { I18nProvider } from "./i18n/I18nProvider.jsx";
import { ToastProvider } from "./ui/index.js";
import { SessionProvider, useSession } from "./session/SessionProvider.jsx";
import { PHASE, createSessionStore } from "./session/sessionStore.js";
import { BoardProvider } from "./data/BoardProvider.jsx";
import { createBoardStore } from "./data/boardStore.js";
import { hasWorkRoute } from "./shell/routes.js";
import { Shell } from "./shell/Shell.jsx";
import { SignIn } from "./auth/SignIn.jsx";
import { MfaStep } from "./auth/MfaStep.jsx";
import { PasswordStep } from "./auth/PasswordStep.jsx";
import { SessionWait } from "./auth/SessionWait.jsx";
import { LockScreen } from "./auth/LockScreen.jsx";

function Phases({ board }) {
  const { phase, user, store } = useSession();
  const open = phase === PHASE.READY || phase === PHASE.LOCKED;
  const watch = open && Boolean(user?.perms.includes("board.view"));
  const owner = watch ? user.id : null;

  useEffect(() => {
    if (owner) board.start();
    else board.clear();
  }, [owner, board]);

  let screen;
  if (phase === PHASE.READY) screen = <Shell />;
  else if (phase === PHASE.LOCKED) screen = <LockScreen />;
  else if (phase === PHASE.MFA) screen = <MfaStep />;
  else if (phase === PHASE.PASSWORD) screen = <PasswordStep />;
  else if (phase === PHASE.RESTORING || phase === PHASE.UNREACHABLE) screen = <SessionWait />;
  else screen = <SignIn />;

  return (
    <ToastProvider resetKey={`${phase === PHASE.READY ? "open" : phase}:${store.epoch()}`}>
      <div className="h-full bg-page">{screen}</div>
    </ToastProvider>
  );
}

/** `api` and `openStream` are for the tests; the page uses the real ones. */
export default function LiveApp({ api = backendApi, openStream } = {}) {
  const [session] = useState(() => createSessionStore({ api, canEnter: hasWorkRoute }));
  const [board] = useState(() => createBoardStore({ api, track: session.track, openStream }));
  useEffect(() => {
    session.restore();
    return () => {
      session.dispose();
      board.clear();
    };
  }, [session, board]);
  return (
    <ThemeProvider>
      <I18nProvider>
        <SessionProvider store={session}>
          <BoardProvider store={board}>
            <Phases board={board} />
          </BoardProvider>
        </SessionProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 4: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  83 passed (83)`, `Tests  1524 passed (1524)`, `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/LiveApp.jsx dashboard/src/live/LiveApp.test.jsx dashboard/src/live/boundaries.test.js
git commit -m "feat(live-ui): LiveApp — the phase picks the screen; the board runs while a session may see it

The toasts empty when a session locks or ends; nothing under src/live/
imports the old workspace (boundaries.test.js reads every import form and
refuses import() of a computed path and import.meta.glob).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 26: The bare URL opens the new shell; `?eski=1` keeps the previous one; the dev proxy

**Files:**
- Modify: `dashboard/src/main.jsx`, `dashboard/vite.config.js`
- Test: `dashboard/src/routing.test.js` (append), create `dashboard/src/devProxy.test.js`

- [ ] **Step 1: Write the failing tests.** **Create** `dashboard/src/devProxy.test.js`:

```js
// `npm run dev` proxies the API the way nginx does in production: every path nginx sends to the API
// is in vite.config.js's proxy list. The list had fallen behind before (/admin, /scope, /scores and
// /infinity-research were missing: the new shell's screens could not reach them on a laptop).
// Both files are read as text.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VITE = fs.readFileSync(path.resolve(HERE, "../vite.config.js"), "utf8");
const NGINX = fs.readFileSync(path.resolve(HERE, "../../deploy/local/web/nginx.conf"), "utf8");

function nginxApiPaths() {
  const out = new Set();
  for (const m of NGINX.matchAll(/location ~ \^\/\(([a-z|-]+)\)/g)) {
    for (const name of m[1].split("|")) out.add(`/${name}`);
  }
  return out;
}

function viteProxyPaths() {
  const block = /proxy: Object\.fromEntries\(\[([^]*?)\]\.map/.exec(VITE);
  return new Set(block ? [...block[1].matchAll(/"(\/[a-z-]+)"/g)].map((m) => m[1]) : []);
}

describe("the dev server's proxy", () => {
  it("reads both lists", () => {
    expect(nginxApiPaths().size).toBeGreaterThan(15);
    expect(viteProxyPaths().has("/auth")).toBe(true);
  });

  it("covers every API path nginx proxies", () => {
    const vite = viteProxyPaths();
    expect([...nginxApiPaths()].filter((p) => !vite.has(p))).toEqual([]);
  });
});
```

**Append to** `dashboard/src/routing.test.js`:

```js

describe("the new live shell (G1-07) and the previous workspace (?eski=1, until G1-16)", () => {
  it("opens the new shell on the bare URL and on ?live=1", () => {
    expect(chooseMode(new URLSearchParams(""))).toBe("live");
    expect(chooseMode(new URLSearchParams("live=1"))).toBe("live");
  });

  it("keeps the previous live workspace on ?eski=1", () => {
    expect(chooseMode(new URLSearchParams("eski=1"))).toBe("eski");
  });

  it("lets an explicit ?live=1 win over ?eski=1", () => {
    expect(chooseMode(new URLSearchParams("eski=1&live=1"))).toBe("live");
  });

  it("gives the previous workspace no demo banner: it talks to the real API", () => {
    const { container } = render(createElement(AppShell, { mode: "eski" }, "x"));
    expect(container.firstChild.children).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/routing.test.js src/devProxy.test.js 2>&1 | grep -E "×|→|Tests "
```
Expected: `Tests  2 failed | 16 passed (18)` — `?eski=1` is still `live`, and the proxy lacks `[ '/admin', '/scope', '/scores', '/infinity-research' ]`.

- [ ] **Step 3: Implement**

**In** `dashboard/src/main.jsx` **replace:**

```jsx
  // The new UI's design review page (G1-05): no API, no patient data, linked from nowhere.
  if (params.get("tasarim") === "1") return "tasarim";
  return "live";
}
```
**with:**
```jsx
  // The new UI's design review page (G1-05): no API, no patient data, linked from nowhere.
  if (params.get("tasarim") === "1") return "tasarim";
  // The previous live workspace (LDAP ClinicalDemo on the real API), kept reachable as the
  // reference Wave 3 ports from; removed with the demo in G1-16.
  if (params.get("eski") === "1") return "eski";
  return "live";
}
```

**In** `dashboard/src/main.jsx` **replace:**

```jsx
function pickRoot(mode) {
  if (mode === "live") {
    const store = createLiveStore({
```
**with:**
```jsx
function pickRoot(mode) {
  // The live system: the new shell (G1-07/G1-08), on the real API and nothing simulated.
  if (mode === "live") {
    return <React.Suspense fallback={null}><LiveApp /></React.Suspense>;
  }
  if (mode === "eski") {
    const store = createLiveStore({
```

**In** `dashboard/src/main.jsx` **replace:**

```jsx
// Lazy: the gallery and its fonts load only when ?tasarim=1 asks for them.
const DesignGallery = React.lazy(() => import("./live/gallery/DesignGallery.jsx"));
```
**with:**
```jsx
// Lazy: the gallery and its fonts load only when ?tasarim=1 asks for them.
const DesignGallery = React.lazy(() => import("./live/gallery/DesignGallery.jsx"));
// Lazy too: the new live UI, its fonts and tokens load only in live mode.
const LiveApp = React.lazy(() => import("./live/LiveApp.jsx"));
```

**In** `dashboard/vite.config.js` **replace:**

```js
      "/health",
      "/view",
    ].map((path) => [path, "http://localhost:8000"])),
```
**with:**
```js
      "/health",
      "/view",
      // Behind nginx in production too (deploy/local/web/nginx.conf); missing here until G1-07.
      "/admin",
      "/scope",
      "/scores",
      "/infinity-research",
    ].map((path) => [path, "http://localhost:8000"])),
```

- [ ] **Step 4: Gate, and check the build split the live UI out**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
ls dist/assets | grep -E "^LiveApp-"
```
Expected: `Test Files  84 passed (84)`, `Tests  1530 passed (1530)`, `✓ built in …`, then `LiveApp-<hash>.js` (about 50 kB: the live UI is its own chunk).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/main.jsx dashboard/src/routing.test.js dashboard/src/devProxy.test.js dashboard/vite.config.js
git commit -m "feat(dashboard): the live mode is the new shell; ?eski=1 keeps the previous workspace until G1-16

LiveApp is lazy (its fonts and tokens load only in live mode). The dev
proxy covers every API path nginx proxies (/admin, /scope, /scores,
/infinity-research were missing).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 27: The spec, the runbook, the Turkish guide and the roadmap; final verification; the visual review

**Files:**
- Modify: `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md`, `docs/EDGE-BRIDGE-LOCAL.md`, `docs/homunculus-rehber-TR.md`, `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`

If another agent has edited one of these files since `9ec264b` and a quoted passage below no longer matches, find it by its text and make the same change.

- [ ] **Step 1: The spec records what was built**

**In** `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md` **replace:**

```markdown
| `sessions_revoked_at` | new, nullable | Set on deactivation; `/auth/refresh` refuses a refresh token issued at or before it, so reactivating an account never revives its old sessions. |
```
**with:**
```markdown
| `sessions_revoked_at` | new, nullable | Set on deactivation; `/auth/refresh` refuses a refresh token issued at or before it, so reactivating an account never revives its old sessions. |
| `must_change_password` | *As built* (migration `0011`): `BOOLEAN NOT NULL DEFAULT false` | Set when an administrator gives a LOCAL account a temporary password (`POST /admin/users`, `reset-password`); cleared by `POST /auth/password`. While set, every route but `/auth/password`, `/auth/me`, `/auth/refresh` and `/auth/totp/*` answers 403 `password_change_required` (§4). Never for an AD account. `0011` sets it on every local account that exists before it (the user's decision: each chooses its own password once after the deploy). |
```

**In** `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md` **replace:**

```markdown
account enrolled throughout (it never drops back to "not enrolled"); abandoning the replacement
fails closed.
```
**with:**
```markdown
account enrolled throughout (it never drops back to "not enrolled"); abandoning the replacement
fails closed.

*As built (plan G1 Wave 2) — the temporary password.* After the MFA gate comes a second one:
while `users.must_change_password` is set on a local account, `get_principal` (every router route)
and the board's JWT resolver answer 403 `password_change_required`; only `/auth/password` (behind
the MFA gate alone, `get_principal_pre_password`), `/auth/me`, `/auth/refresh` and `/auth/totp/*`
answer. MFA comes first, so a password reset never lets the temporary password alone choose the
next one for an account that has an authenticator. `TokenResponse.password_change_required` and
`/auth/me`'s `must_change_password` tell the client. `/auth/me` also carries `tenant_name`,
`lock_idle_minutes` (`SCREEN_LOCK_IDLE_MINUTES`, default 10, 1–60: the dashboard's idle lock) and
`lock_signout_hours` (`SCREEN_LOCK_SIGNOUT_HOURS`, default 12, 1–72: a browser locked longer
signs itself out). A personal session always locks; there is no "never".

*As built — unlocking a locked screen.* `POST /auth/reauth {password}` takes a whole session and
checks the session's own account: bcrypt for a local one (5 wrong in a row — counted with the
wrong current passwords at `/auth/password` — lock both for 15 minutes, 429; one audit row when
the lock engages), one bind for an AD one, counted in the same failure chain as its sign-ins and
exactly as a sign-in's bind is (§7 Security). A wrong password is 403 `Parola hatalı` — never
401, which the dashboard answers by refreshing and retrying. Nothing is issued and MFA is not
asked again.
```

**In** `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md` **replace:**

```markdown
a temporary password; the user must be able to replace it). For an AD user it returns 400
`Parola Active Directory tarafından yönetiliyor`.
```
**with:**
```markdown
a temporary password; the user must be able to replace it). For an AD user it returns 400
`Parola Active Directory tarafından yönetiliyor`. *As built:* a new password equal to the current
one is 400 `Yeni parola mevcut paroladan farklı olmalı`; a successful change clears
`must_change_password`.
```

**In** `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md` **replace:**

```markdown
- `POST /admin/users {username, email?, full_name, password, group_ids[]}` — a local account with
  a temporary password.
```
**with:**
```markdown
- `POST /admin/users {username, email?, full_name, password, group_ids[]}` — a local account with
  a temporary password. *As built:* it sets `must_change_password`, as `reset-password` does; the
  user list reports it.
```

**In** `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md` **replace:**

```markdown
  lockout threshold must be at least 7. This extends *Out of scope: login rate limiting* for AD
  accounts only.
```
**with:**
```markdown
  lockout threshold must be at least 7. This extends *Out of scope: login rate limiting* for AD
  accounts only. *As built (Wave 2):* an AD account's unlock of a locked screen
  (`POST /auth/reauth`) is a bind in the same chain, refused (429) without a bind when it is full:
  sign-ins and unlocks together stay within 3 + 3 per run. The price is the sign-in's (user
  decision 11 (b)): whoever knows the login can hold the clinician's locked screen at 429 too.
```

- [ ] **Step 2: The runbook**

**In** `docs/EDGE-BRIDGE-LOCAL.md` **replace:**

```markdown
  the account within the caller's rights (a refused unlock uses nothing); not for an account
  active in another hospital or a platform operator's (409). It does not unlock anything in AD
  — an AD lockout is IT's to clear.
```
**with:**
```markdown
  the account within the caller's rights (a refused unlock uses nothing); not for an account
  active in another hospital or a platform operator's (409). It does not unlock anything in AD
  — an AD lockout is IT's to clear.
- **A locked screen counts too.** The dashboard locks after `SCREEN_LOCK_IDLE_MINUTES` without
  input (default 10, `.env`; there is no "never" — a wall display is Group 2's kiosk mode), and a
  browser that stays locked `SCREEN_LOCK_SIGNOUT_HOURS` (default 12) signs itself out. Unlocking
  an AD account's screen is a bind in the same run as its sign-ins: three wrong passwords at the
  lock screen and the account's next sign-in is the 429 above — and the other way round: anyone
  who knows a clinician's login can hold her **locked screen** at 429 as well, for at least 15
  minutes after the last wrong password (user decision 11 (b); she waits, an administrator unlocks
  the run once, or a colleague signs in on the station). The dashboard itself signs out after
  three wrong unlocks, and "Başqa istifadəçi ilə giriş" signs out at once. While the domain
  controller does not answer, an AD user whose screen locked cannot unlock it (503) — accepted
  (user decision 13): sign out, and use a local account if the ward must keep working. For a
  local account, five wrong passwords at the lock screen or as the "current password" of a
  password change lock both for 15 minutes (429; one `reauth.locked` or `password.change.locked`
  audit row). A failed unlock bind leaves a `reauth.fail` row (with `user`, not `login`), as a
  sign-in leaves `login.fail` — `cancelled` and `directory_error` included —; the query before a
  restart (*A slow run is bounded too*) reads both.
```

**In** `docs/EDGE-BRIDGE-LOCAL.md` **replace:**

```markdown
  docker compose exec postgres psql -U homunculus -d homunculus -c "SELECT payload->>'login'
    AS login, count(*) FROM audit WHERE event_type = 'auth' AND subject = 'login.fail' AND
    payload->>'reason' IN ('bad_credentials', 'directory_unavailable', 'cancelled',
    'directory_error') AND ts::timestamptz > now() - interval '15 minutes' GROUP BY 1;"
```
**with:**
```markdown
  docker compose exec postgres psql -U homunculus -d homunculus -c "SELECT
    coalesce(payload->>'login', payload->>'user') AS login, count(*) FROM audit WHERE
    event_type = 'auth' AND subject IN ('login.fail', 'reauth.fail') AND payload->>'reason' IN
    ('bad_credentials', 'directory_unavailable', 'cancelled', 'directory_error') AND
    ts::timestamptz > now() - interval '15 minutes' GROUP BY 1;"
```

**In** `docs/EDGE-BRIDGE-LOCAL.md` **replace:**

```markdown
Data survives: it lives in the `pgdata` volume, not in the containers.
```
**with:**
```markdown
Data survives: it lives in the `pgdata` volume, not in the containers.

Migration `0011` (with this branch) adds `users.must_change_password`. From then on a password an
administrator sets — a new local account, or a reset — must be replaced at the next sign-in
before anything else opens (403 `password_change_required` meanwhile; the mobile app says to
change it on the dashboard). **`0011` flags every local account that exists before it** — the
seed administrator included; AD accounts are not touched: **tell the users before the deploy**
that everyone with a local account chooses a new password once, at the first sign-in after it,
with the password they have now as the "current" one. The dashboard's lock reads
`SCREEN_LOCK_IDLE_MINUTES` and `SCREEN_LOCK_SIGNOUT_HOURS` (both optional, see `.env.example`).
```

- [ ] **Step 3: The Turkish guide** (the living guide: every new term in plain words, then what Homunculus does)

**In** `docs/homunculus-rehber-TR.md` **replace:**

```markdown
**"Parolamı değiştir"**
- *Homunculus'ta:* Canlı modda kullanıcı menüsündedir. Mevcut parola, yeni parola ve tekrarı
  istenir; sunucu en az 8 karakter ister. Değişiklik diğer bütün oturumları kapatır, bu oturum
  yeni bir token çiftiyle açık kalır. Yöneticinin verdiği parola geçicidir; kullanıcı onu ilk
  girişte buradan değiştirmelidir (sistem bunu henüz zorlamıyor). Active Directory hesabı "Parola
  Active Directory tarafından yönetiliyor" yanıtını alır.
```
**with:**
```markdown
**"Parolamı değiştir" ve geçici şifre**
- *Basit:* Yöneticinin verdiği şifre geçicidir; kişi ilk girişte kendi şifresini belirler.
- *Homunculus'ta:* Yeni arayüzde Ayarlar › Güvenlik'tedir. Mevcut şifre, yeni şifre ve tekrarı
  istenir; sunucu en az 8 karakter ister ve yeni şifrenin mevcut şifreden farklı olmasını ister.
  Değişiklik diğer bütün oturumları kapatır, bu oturum yeni bir token çiftiyle açık kalır.
  Yönetici yeni bir yerel hesap açtığında ya da şifreyi sıfırladığında sistem bunu **zorlar**
  (`users.must_change_password`): kişi giriş yapınca (MFA'sı varsa önce doğrulama kodunu girer)
  "Yeni şifrə təyin edin" ekranına düşer; şifresini değiştirene kadar API bütün diğer isteklere
  403 `password_change_required` der. Mobil uygulama böyle bir hesabı içeri almaz, "önce panodan
  girip şifrenizi belirleyin" der. **Güncellemeyle gelen göç (`0011`), o gün var olan bütün yerel
  hesapları işaretler** (tohum yönetici dahil): yerel hesabı olan herkes güncellemeden sonraki ilk
  girişte bir kez kendi şifresini belirler — "mevcut şifre" bugünkü şifresidir; kullanıcılara
  önceden duyurulur. Yanlış "mevcut şifre" de kilit ekranındaki yanlış şifreyle birlikte sayılır:
  beşinde ikisi de 15 dakika kapanır. Active Directory hesabı hiç zorlanmaz: şifresi AD'dedir,
  değiştirmesi hastanenin olağan yoludur.

**Kilit ekranı**
- *Basit:* Servisteki ortak bilgisayar bir süre kullanılmayınca ekran kilitlenir; hasta bilgisi
  ekrandan kalkar, oturum kapanmaz. Kilidi şifreyle açarsınız.
- *Homunculus'ta:* Süreyi hastane belirler (`SCREEN_LOCK_IDLE_MINUTES`, varsayılan 10 dakika);
  kişisel oturum her zaman kilitlenir, "hiç kilitlenmesin" seçeneği yoktur (sürekli açık kalması
  gereken duvar ekranı Grup 2'nin kiosk modudur). Kilitlenmeden bir dakika önce geri sayımlı
  uyarı çıkar. Tuş, tıklama, dokunma ve kaydırma hareket sayılır; yalnız oynayan fare sayılmaz.
  Hesap menüsünden ya da Alt+L ile (klavye düzeni ne olursa olsun) elle de kilitlenir. Kilit
  **tarayıcı başınadır**: sayfayı yenilemek ya da yeni sekme açmak kilidi geçmez; 12 saatten
  uzun kilitli kalan tarayıcı kendiliğinden çıkış yapar (`SCREEN_LOCK_SIGNOUT_HOURS`).
  Kilitliyken ekranda yalnız kişinin birimlerindeki açık alarmların ve onaylanmamış olanların
  **sayısı** görünür (ad, yatak, değer yok). "Alarm yok" yalnız canlı bağlantı varken ve pano
  bağlantıdan sonra yeniden yüklendiyse denir; akış koptuysa sayılar "güncel olmayabilir" işaretiyle
  görünür, bağlantı hiç yoksa "bilinmiyor" der. Şifre üç kez yanlış girilirse oturum kapanır;
  "Başka kullanıcıyla giriş" şifresiz çıkış yapar. AD hesabında her yanlış şifre AD giriş
  sınırına sayılır (aşağıdaki madde): giriş adını bilen biri, girişi gibi kilitli ekranı da en az
  15 dakika 429'da tutabilir (kullanıcı kararı 11). Dizin sunucusuna ulaşılamıyorsa AD hesabının
  kilidi açılamaz (kabul edildi, karar 13).

**Yeni canlı arayüz (kabuk)**
- *Homunculus'ta:* Adres çubuğuna yalnız sunucunun adresi yazılınca yeni arayüz açılır (G1-07):
  solda kişinin yetkisinin açtığı ekranlar (telefonda kısa adlarıyla), üstte hastane adı, birim
  seçimi (kapsamı iki ya da daha çok birimle sınırlıysa), saat, dil, tema, tam ekran, kısayollar,
  yanıt bekleyen alarmların zili ve hesap menüsü (sürüm numarası dahil). Ekranlar Grup 1'in
  sonraki dalgalarında gelir; o zamana kadar herkes Ayarlar'a düşer. Yetkisi olmayan bir sayfa
  "Bu səhifəyə icazəniz yoxdur", olmayan bir sayfa "Belə səhifə yoxdur" der. Önceki arayüz G1-16'ya
  dek `?eski=1` ile açılır; o kilit ekranını bilmez.
```

- [ ] **Step 4: The roadmap.** Get the date and the commit range first:

```bash
cd /c/tmp/homunculus-g1
date +%d.%m
git log --reverse --format=%h 9ec264b..HEAD -- homunculus-engine/alembic/versions/0011_users_must_change_password.py dashboard/src/main.jsx | sed -n '1p;$p'
```
Expected: today's date and two short hashes — the Task 1 commit and the Task 26 commit. Put them where the rows below say `<tarih>`, `<ilk>`, `<son>`.

**In** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` **replace:**

```markdown
| G1-07 | Kabuk: sol menü (izinle), üst çubuk (birim çipi, saat, nöbet bitimine, dil, tema, zil, kişi menüsü); canlı mod yeni kabuğa | 5 | Orta | G1-05, G1-06 | Bekliyor |
| G1-08 | Giriş + 2FA + (D4'e göre) ilk girişte şifre, kilit ekranı | 5 | Orta | G1-07 | Bekliyor |
```
**with:**
```markdown
| G1-07 | Kabuk: sol menü (izinle), üst çubuk (birim çipi, saat, nöbet bitimine, dil, tema, zil, kişi menüsü); canlı mod yeni kabuğa · plan: [dalga 2](2026-10-04-g1-dalga2-kabuk-giris.md) (nöbet bitimine gösterilmiyor: karar 12) | 5 | Orta | G1-05, G1-06 | ✅ <tarih> · <ilk>…<son> |
| G1-08 | Giriş + 2FA + (D4'e göre) ilk girişte şifre, kilit ekranı · plan: [dalga 2](2026-10-04-g1-dalga2-kabuk-giris.md) (göç `0011` bütün yerel hesapları işaretler, `POST /auth/reauth`) | 5 | Orta | G1-07 | ✅ <tarih> · <ilk>…<son> |
```

**In** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` **replace:**

```markdown
| G1-16 | Demo ve eski modları kaldır (`ClinicalDemo.jsx`, `clinicalDemo.js`, replay, legacy board, `?demo` PWA başlangıcı) | 3 | Orta | G1-09…G1-14 | Bekliyor |
```
**with:**
```markdown
| G1-16 | Demo ve eski modları kaldır (`ClinicalDemo.jsx`, `clinicalDemo.js`, `liveStore.js`, `clinicalI18n.js`, replay, legacy board, `?eski=1` önceki canlı arayüz — kilidi bilmez, G1-15'ten önce gitmeli —, `?demo` PWA başlangıcı) | 3 | Orta | G1-09…G1-14 | Bekliyor |
```

**In** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` **replace:**

```markdown
- Arayüzde build SHA (`__BUILD_SHA__`) → G1-07
```
**with:**
```markdown
- Arayüzde build SHA (`__BUILD_SHA__`) → G1-07 ✅ hesap menüsü ve Ayarlar › Profil.
```

**In** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` **replace:**

```markdown
- admissionScreen · Daraltılmış sol menüde her madde kısa adıyla görünür, yalnız ikon kalmaz. → G1-07
```
**with:**
```markdown
- admissionScreen · Daraltılmış sol menüde her madde kısa adıyla görünür, yalnız ikon kalmaz. → G1-07 ✅ `shell/Sidebar.jsx` (`nav.*Short`), `Shell.test.jsx`.
```

**In** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` **replace:**

```markdown
giriş ekranı yine gelir. → G1-08
```
**with:**
```markdown
giriş ekranı yine gelir. → G1-08 ✅ `session/browserState.js`, `sessionStore.test.js`, `SignIn.test.jsx`.
```

**In** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` **replace:**

```markdown
cihaz sayfasına ulaşır; diğer roller de doğrudan girer. → G1-07
```
**with:**
```markdown
cihaz sayfasına ulaşır; diğer roller de doğrudan girer. → G1-07 ✅ sihirbaz yok; herkes kendi ana ekranına düşer (`shell/routes.js` `homePath`; Dalga 2'de Ayarlar), `LiveApp.test.jsx`. Sistem Ayarları ve cihaz sayfası G1-14 / Grup 4.
```

**In** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` **replace:**

```markdown
(`/clinical` ve `/alarm-quality` var; yalnız `npm run dev`'i etkiler). → G1-07
```
**with:**
```markdown
(`/clinical` ve `/alarm-quality` var; yalnız `npm run dev`'i etkiler). → G1-07 ✅ `devProxy.test.js` nginx'in her API yolunu arar.
```

**In** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` **replace:**

```markdown
- Otomatik tema (20:00–08:00) yalnız mobil prototipte vardı; web için ertelendi → G1-07 ya da sonrası.
```
**with:**
```markdown
- Otomatik tema (20:00–08:00) yalnız mobil prototipte vardı; web için ertelendi → G1-07 ya da sonrası. Dalga 2'de de yapılmadı (web prototipinde yok).
```

**In** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` **replace:**

```markdown
  bir sekmede değişince öbürü eskisinde kalır → G1-07.
```
**with:**
```markdown
  bir sekmede değişince öbürü eskisinde kalır → G1-07. ✅ `storage` olayı dinleniyor (Dalga 2).
```

**In** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` **replace:**

```markdown
  ekran okuyucu hatayı alanla birlikte okur → G1-08/G1-12 formları.
```
**with:**
```markdown
  ekran okuyucu hatayı alanla birlikte okur → G1-08/G1-12 formları. ✅ G1-08'in bütün formları böyle (giriş, kod, şifre, kilit).
```

**In** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` **replace:**

```markdown
  siler; `I18nProvider` `<html lang>`'ı bırakır → G1-07.
```
**with:**
```markdown
  siler; `I18nProvider` `<html lang>`'ı bırakır → G1-07. ✅ önceki değerler geri konuyor.
```

**In** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` **replace:**

```markdown
  (Tag/Note/StatusPill/Toast) `index.js` başlığında eşlensin. → G1-07
```
**with:**
```markdown
  (Tag/Note/StatusPill/Toast) `index.js` başlığında eşlensin. → G1-07 ✅ hepsi (Dalga 2, Görev 6; kök `ToastProvider` ve `bg-page` `LiveApp.jsx`'te).
```

**In** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` **replace:**

```markdown
- Giriş hatası için duyurulan satır içi uyarı gerekir (`Note` statik, `role="note"`). → G1-08
```
**with:**
```markdown
- Giriş hatası için duyurulan satır içi uyarı gerekir (`Note` statik, `role="note"`). → G1-08 ✅ `ui/Alert.jsx` (`role="alert"` / `"status"`).
```

**In** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` **replace:**

```markdown
  test ediliyor) ve `Empty` testinin yalnız metni denetlemesi. → G1-07
```
**with:**
```markdown
  test ediliyor) ve `Empty` testinin yalnız metni denetlemesi. → G1-07 ✅ ikisi de test edildi.
```

**In** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` **replace:**

```markdown
## Kullanıcı kararları (Dalga 0 sonrası)
```
**with:**
```markdown
## Dalga 2'den açık kalanlar

- `?eski=1` (önceki canlı arayüz) kilit ekranını bilmez: kilitli bir tarayıcıda yeni sekmede
  `?eski=1` açılırsa oturum açık görünür → G1-16 kaldırır (G1-15 deploy'undan önce).
- Sunucu tarafı çıkış yok: çıkış token'ları tarayıcıdan siler; tarayıcıdan alınmış bir yenileme
  token'ı süresi dolana (7 gün) ya da hesap değişene dek geçerli kalır → ayrı iş (Grup 4).
- Mobil uygulamada şifre değiştirme formu yok: geçici şifreli hesap mobilde girişte "önce panodan
  şifrenizi belirleyin" der → mobil işi (Grup 5).
- **G1-09 notu:** birim çipi 640 px ve altında gizli (telefonda birim seçilemez), ve seçilen birim
  her kilitte unutulur (kabuk yeniden kurulur) — G1-09 çarpayı ekranında ikisini de ele alır
  (ör. ekranın kendi birim seçimi; seçimin oturum boyunca saklanması).
- Kilit sayacı (yerel hesapta `reauth_failures`) AD sınırı gibi bellekte: yeniden başlatma
  sıfırlar, tek süreç → pilot için kabul (Dalga 1A'daki AD sınırıyla aynı karar).
- Zil: alarm ekranı (G1-10) gelince her satır hastaya/alarma bağlanır ve sol menüdeki Alarmlar
  maddesine sayaç gelir → G1-10.
- Yeni metinler (`nav`, `shell`, `auth`, `lock`, `account`, `errors`'ın çoğu) AZ/RU/EN'de anadili
  konuşan bir klinisyenin okumasını bekliyor → pilot öncesi.

## Kullanıcı kararları (Dalga 0 sonrası)
```

**In** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` **replace:**

```markdown
(G1-12) yeni kabuğa geçer; duvar monitörü, ısı haritası ve RRT Grup 2'ye (vital diyagramları) yazılır.
```
**with:**
```markdown
(G1-12) yeni kabuğa geçer; duvar monitörü, ısı haritası ve RRT Grup 2'ye (vital diyagramları) yazılır.

**Dalga 2'de kullanıcının verdiği kararlar (05.10.2026; [dalga 2 planı](2026-10-04-g1-dalga2-kabuk-giris.md)):**

12. **Nöbet bitimine (üst çubuk):** ✅ **gösterilmiyor.** Grup 1'de kaynağı yok (kişinin nöbet
    ataması `nurse_bed_assignments`'ı yazan ekran yok, hekimin ataması hiç yok; hastane çapında
    nöbet saati tanımlı değil).
13. **AD kesintisinde kilit:** ✅ **kapalı kalır (fail closed).** Dizin yanıt vermezken AD hesabının
    kilitli ekranı açılamaz (503); klinisyen çıkış yapıp yerel bir hesapla girer. Karar 11 (b)
    kilit ekranına da uzanır: bir klinisyenin AD giriş adını bilen biri, yanlış parolalarla onun
    kilitli ekranını da (girişi gibi) en az 15 dakika 429'da tutabilir — o bekler, yönetici diziyi
    bir kez açar ya da istasyonda bir meslektaşı girer (runbook, "A locked screen counts too").
14. **Kilit süresi:** ✅ **10 dakika**, `SCREEN_LOCK_IDLE_MINUTES` ile değiştirilebilir (1–60).
    Kişisel oturum her zaman kilitlenir, "hiç" yok (duvar ekranı Grup 2'nin kiosk modu); 12 saatten
    uzun kilitli kalan tarayıcı kendiliğinden çıkış yapar (`SCREEN_LOCK_SIGNOUT_HOURS`, 1–72) —
    mühendislik kararı.
15. **Şifre kuralı:** ✅ **en az 8 karakter kalır** (sunucunun kuralı; prototipin 10+ karakter,
    büyük/küçük harf, rakam, simge kuralı alınmadı).
16. **`0011` öncesi hesaplar:** ✅ **bütün yerel hesaplar işaretlenir** (`0011` içinde
    `UPDATE users SET must_change_password = true WHERE auth_source = 'local'`; AD hesapları asla;
    geri alma sütunu siler). Yerel hesabı olan herkes güncellemeden sonraki ilk girişte bir kez
    şifresini değiştirir — deploy'dan önce duyurulur (G1-15 deploy kapısı).
```

**In** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` **replace:**

```markdown
- Deploy, son 15 dakikada hatalı AD girişi yokken yapılır: yeniden başlatma Homunculus'un
  dizilerini siler, AD'nin sayacını silmez (runbook, "A slow run is bounded too").
```
**with:**
```markdown
- Deploy, son 15 dakikada hatalı AD girişi yokken yapılır: yeniden başlatma Homunculus'un
  dizilerini siler, AD'nin sayacını silmez (runbook, "A slow run is bounded too").
- **(Dalga 2)** `?eski=1` (önceki canlı arayüz) G1-16 ile kaldırıldı: kilit ekranını bilmez, kilitli
  bir tarayıcıda açık oturumu gösterir.
- **(Dalga 2)** Mobil uygulama: geçici şifreli hesap girişte "önce panodan şifrenizi belirleyin"
  der (Dalga 2, Görev 3). Cihazlarda bu sürümden eski bir uygulama varsa, işaretli hesap orada her
  istekte çıplak 403 alır — deploy'dan önce güncellenir ya da kullanıcılar şifrelerini önce
  panoda değiştirir.
- **(Dalga 2)** Göç `0011` bütün yerel hesapları işaretler (karar 16): kullanıcılara deploy'dan
  önce duyurulur — yerel hesabı olan herkes (tohum yönetici dahil) ilk girişte bugünkü şifresiyle
  girip yenisini belirler; AD hesapları etkilenmez.
```

- [ ] **Step 5: Final verification**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest -q -p no:cacheprovider 2>&1 | tail -1
cd /c/tmp/homunculus-g1/dashboard
npx vitest run src/live/ 2>&1 | tail -5
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
cd /c/tmp/homunculus-g1
git diff --stat 9ec264b..HEAD -- dashboard/src/ClinicalDemo.jsx dashboard/src/clinicalDemo.js dashboard/src/liveStore.js dashboard/src/index.css dashboard/index.html deploy/local/web/nginx.conf
grep -rnE "#[0-9a-fA-F]{3,8}\b" dashboard/src/live --include=*.jsx | grep -v "href=\|#main\|#/"
grep -rnE "\b(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\b" dashboard/src/live
```
Expected: `2255 passed, 6 skipped` (and with `$PY312`, if it exists, `2251 passed, 8 skipped`); `Test Files  40 passed (40)` / `Tests  691 passed (691)` under `src/live/`; `Test Files  84 passed (84)` / `Tests  1530 passed (1530)`; `✓ built in …`; then no output from the `git diff --stat` (the old workspace, nginx and the page are untouched) and none from either `grep`.

- [ ] **Step 6: The visual review (for the user; nothing to commit).** With the local stack up (`docs/EDGE-BRIDGE-LOCAL.md`, "Bring-up") or `npm run dev` against a running API, open the bare URL in Chrome and check, at 1440 px and in DevTools' device toolbar at 390 px, in Gece and Gün:
1. Sign-in: dark hero on the left (hidden at 390), the form on the right; `AZ ⌄` and the sun/moon in the corner; a wrong password is announced in Azerbaijani under the title; "Şifrəni unutmusunuz?" opens the IT note.
2. A local account created in the admin panel — and, after `0011`, any local account that existed before it: after sign-in (and the TOTP step for an MFA group, "Addım 2/3") comes "Yeni şifrə təyin edin"; the temporary password is refused as the new one; then the shell.
3. Shell: rail with "Ayarlar" at the foot (short names at 390, never icons alone); top bar: hospital › Ayarlar, the unit chip only for a scope of two or more units, the clock, the bell (a count when an alarm waits; a warning dot when the API is stopped), the account menu with the build SHA. No horizontal page scroll at 390.
4. Lock (Alt+L — on the Azerbaijani or Russian keyboard layout too —, or the menu, or wait the idle time with the warning a minute before): the whole shell is gone; the clock, the user, the counts of open alarms in your units and the unacknowledged ones. Stop the API's stream (or the API) while locked: the counts stay, marked "Köhnə ola bilər" with the dot — never "yoxdur". Reload: still locked. A new tab: locked. A wrong password says how many tries are left; the third signs out. "Başqa istifadəçi ilə giriş" signs out.
5. Keyboard only: the skip link is the first Tab stop; menus open with Enter/↓, move with the arrows, close with Esc back to their button.
Stop the dev server with Ctrl+C.

- [ ] **Step 7: Commit the docs**

```bash
cd /c/tmp/homunculus-g1
git add docs/superpowers/specs/2026-09-23-ldap-rbac-design.md docs/EDGE-BRIDGE-LOCAL.md docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md
git commit -m "docs: the temporary password, /auth/reauth and the lock screen in the spec, runbook and guide; G1-07/G1-08 done

Spec: must_change_password and its gate (0011 flags every local account),
/auth/reauth in the AD chain, /auth/me's new fields. Runbook: the lock
screen and the AD sign-in limit, migration 0011 and what to tell the users.
Guide: temporary password, lock screen, the new live UI.
Roadmap: G1-07/G1-08 status, the owned behaviours ticked, what Wave 2
leaves open, the five decisions the user answered (12-16), three G1-15
deploy-gate items.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage** (the brief for G1-07 + G1-08, the user's answers of 05.10 and the review of the first version):

| Requirement | Task |
|---|---|
| First-sign-in password change: a column, migration `0011` (down `0010`), set on admin create/reset of a LOCAL account, cleared by `/auth/password`, never for AD; server enforcement with the allowed routes justified; Postgres up/down tests | 1 (migration + 4 tests on the real chain, local and AD rows), 2 (rule, gate, admin, change), 3 (the board's resolver; the mobile app) — Decision 1 |
| User decision 16: `0011` flags every existing local account, never an AD one; the downgrade drops the column; runbook and guide tell the users | 1, 27 (runbook, guide, roadmap deploy gate) — Decision 1 |
| Lock screen: configurable idle time with a sane default; what locking does to live data (hidden; shared workstations); unlock re-authenticates; AD unlock through the bind throttle, not a lockout vector; someone else can sign out and in | 4 (`SCREEN_LOCK_IDLE_MINUTES`, `SCREEN_LOCK_SIGNOUT_HOURS`), 5 (`/auth/reauth`, shared chain, 403 not 401), 11, 12, 14, 21, 24, 25 — Decisions 2–4, 16, 17 |
| The AD unlock mirrors the sign-in's bind (Ticket, `pending_s`, the cancellation path, `succeeded` only for a bind that succeeded) and a cut-off bind counts | 5 (`test_an_unlock_drives_the_chain_and_the_audit_as_a_sign_in_does`, so F8's invariant model covers the unlocks; the cut-off, cancelled and fault cases) — Decision 4 |
| `/auth/password`'s wrong current passwords limited, with the unlocks; one audit row when the lock engages | 5 — Decision 4 |
| 2FA UX against `/totp/setup` + `/totp/verify`: enrolment when a group requires it, verification, errors and throttle (incl. JSON 429 + `Retry-After`) in the keyed i18n | 7 (`retryAfter`), 9 (`errors.*`), 12, 19 (held button), 20 — Decision 11 |
| No false reassurance: LIVE only after a load since the stream opened; DEGRADED never says "none" | 13, 21, 24, 25 — Decision 18 |
| Shell: rail filtered by permissions, only Group-1 screens, no dead links; top bar items; live mode in the new shell; old modes untouched; per-user data cleared on sign-out; 390/1440 px; landmarks, skip link, focus order, keyboard | 15, 23, 24, 25, 26 — Decisions 5–9, 14; shift-end not shown (user decision 12) |
| Screens G1-09…G1-14 not built; routes only where needed, clearly marked | 23 (`screen: null`, comment-placed imports) — Decision 7 |
| The roadmap's G1-07/G1-08 behaviours met or deferred with a reason | "Roadmap behaviours this wave owns"; 27 (roadmap ticks) |
| `D4` "Şifremi unuttum" = ask IT | 19 (`auth.forgotHelp`) |
| Forced MFA for the four groups not decided; `groups.mfa_required` drives it | 12, 20 (only `requires_mfa` is read) |
| No patient data in fixtures | synthetic ids (`P-001`, `REA-01`), names ("Ayşe Sentetik", "Sentetik Hastane") and summaries only |

**Placeholder scan:** every code step carries its whole file or an exact replace-this-with-that pair; every pair was applied mechanically to a clean `9ec264b` tree and the result compared with the tested one. The only fill-ins are `<tarih>`, `<ilk>`, `<son>` in Task 27 Step 4, produced by the command printed above them.

**Consistency:** `password_change_due` (2) is used by `dependencies.py`, `router.py`, `admin/router.py` (2) and mirrored in `prodserver.py` (3); `PASSWORD_CHANGE_REQUIRED` (2) in `prodserver.py` (3); `SCREEN_LOCK_IDLE_MINUTES`, `SCREEN_LOCK_SIGNOUT_HOURS` (4) on `/auth/me` and read by `sessionStore.js` (12) as `lockIdleMinutes`, `lockSignoutHours`; `REAUTH_MAX_FAILURES` / `reauth_failures` (5) by `/auth/reauth` and `/auth/password`. `TOKEN_KEYS`, `forget`, `reauth`, `retryAfter` (7) are used by `sessionStore.js` (12) and `SignIn.jsx` (19). `apiErrorKey` / `apiErrorText` (9) by the store (12) and every screen. `PHASE`, `NOTICE` (with `LOCK_EXPIRED`), `UNLOCK_ATTEMPTS` (12) by `LiveApp`, `SignIn`, `LockScreen`, `SessionWait`. `alarmCounts`, `waitingAlarms`, `scopeUnits` (13) by `LockScreen` (21), `TopBar` and `Shell` (24); `CONNECTION.LIVE` / `DEGRADED` read the same way by both. `hhmm`, `ddmm`, `ddmmyyyy`, `weekdayKey` (10) by `TopBar`, `LockScreen`. `ROUTES`, `canReach`, `hasWorkRoute`, `navRoutes`, `homePath`, `matchRoute` (23) by `Sidebar`, `Shell` (24) and `LiveApp` (25). `useShell` (24) is what G1-09 reads. `PasswordChangeRequiredError` (3) by the mobile Settings screen. Test counts add up: backend 4 + 11 + 3 + 20 + 29 = 67 (2188 → 2255 on 3.14, 2184 → 2251 on 3.12); dashboard 2 + 1 + 10 + 5 + 3 + 40 + 2 + 11 + 35 + 11 + 5 + 6 + 7 + 5 + 2 + 3 + 3 + 4 + 3 + 8 + 17 + 24 + 6 = 213 (1317 → 1530); mobile app 3 (298 → 301).

---

## User decisions (answered 05.10.2026)

1. **Shift-end chip ("Nöbet bitimine"):** not shown (roadmap decision 12).
2. **A locked screen during an AD outage:** fail closed is accepted — an AD user whose screen locked signs out and uses a local account (decision 13). Decision 11 (b) reaches the lock screen too (Decision 4).
3. **The idle-lock default:** 10 minutes, configurable (`SCREEN_LOCK_IDLE_MINUTES`, decision 14).
4. **Password policy:** 8+ characters stays (decision 15).
5. **Accounts that exist before `0011`:** every local account is flagged by the migration, AD accounts never (decision 16).

Nothing in this plan waits for the user.

## The review of the first version, and where each finding went

| Finding | Where |
|---|---|
| (Critical) An open stream turned a failed load into LIVE; a reconnect after DEGRADED was LIVE without a reload; the lock screen and the bell treated DEGRADED as known | Decision 18; Task 13 (`boardStore.js`; three new tests, the first one extended), Tasks 21, 24 (DEGRADED shown as possibly out of date, never "none"), Task 25 (`openStream` calls `onopen`; the bell after the stream opened) |
| The remembered username and the lock were changed before the sign-in was accepted | Task 12 (`signIn`; "changes nothing in this browser for a refused sign-in") |
| `/auth/password` did not limit wrong current passwords | Task 5 (shares `reauth_failures`; three tests) |
| `boundaries.test.js` missed side-effect and multi-line imports, `import()` of a computed path and `import.meta.glob` | Task 25 (`importsOf`, two tests of its own) |
| `?eski=1` bypasses the lock; the mobile app's 403 everywhere; `0011` flags every local account | Task 27 (G1-15 deploy-gate items); Task 3 (the mobile app) |
| Engineering decisions: always lock; sign out after `SCREEN_LOCK_SIGNOUT_HOURS`; 11 (b) at the lock screen | Decisions 16, 17, 4; Tasks 4, 12; Task 27 (runbook, roadmap decision 13) |
| F8 (after the review): `end` takes the ticket, `succeeded` only for a `bound` identity, every counted failure audited at once — a cancelled one too —; the invariant model must cover a new bind path | Task 5 (`_directory_reauth`; `reauth.fail` rows; the sign-in/unlock conformance test); Task 27 (the runbook's pre-restart query reads `reauth.fail`) — Decision 4 |
| The review of F8: a `FailureChain` took another chain's ticket for its own attempt of the same number | Task 5, Steps 1–3 (owner stamp; one test) |
| Alt+L by `event.code`; focus to `<main>` back on the first path too; the idle warning not every second; no suffix grammar, plural-safe English; the language button's name; the show-password toggle; the lock-screen counts' label and the unacknowledged count; a tab in the MFA/password step moves on with another tab; a tracked 403 `password_change_required` goes to the password step; one audit row per local lock; G1-09's unit-chip note | Tasks 24, 21, 15, 19, 12, 5; Task 27 ("Dalga 2'den açık kalanlar") |

## The whole-branch review of Wave 2 (`9ec264b..f7fd2f7`), and where each finding went

| Finding | Where |
|---|---|
| (Important) The previous session's history outlives it — `replaceState` cleans only the entry the page is on — so Back at the sign-in screen put A's screen in the bar and B's shell opened there (with G1-11, A's patient) | `533d405`: a shell settles its own first screen at mount, whatever the bar says (`Shell.jsx`); the Back case is tested (`LiveApp.test.jsx`) |
| (Important) No idle timeout on the step screens, and `PasswordForm` kept the typed current password after a refusal — migration `0011` puts every local account there at its first sign-in | `39e43a3`: the MFA, password and unreachable phases carry `lock_idle_minutes` and END the session ("Sessiya bağlanacaq", `session/IdleWarning.jsx`); the current-password field is emptied after every refused attempt. Spec §8 and the Turkish guide corrected to describe this |
| (Important) The manifest/service-worker change is not on the deploy gate, and a failed lazy chunk was a blank page | `ef52edf`: `LoadBoundary` (`src/LoadFailed.jsx`) shows a translated "could not be loaded / reload" instead of nothing. G1-15 gate: re-add the app on every tablet; the roadmap's and the guide's unqualified "now opens the real system" claim is qualified |
| (Minor) The lock screen was the only password surface ignoring `Retry-After` | `ef52edf`: `useRetryHold` + the once-per-hold `Announce`, as the sign-in and password forms have |
| (Minor) The runbook's pre-restart query counted `bad_credentials`, which a LOCAL wrong password writes too | `docs/EDGE-BRIDGE-LOCAL.md`: the AD-only reasons, with one sentence saying why `bad_credentials` is not among them (the rows carry no `auth_source`) |
| (Minor) Two tabs racing a wrong unlock can let a lock take 4 tries | Not fixed, recorded in `deferred.md` with the reasoning: no atomic read-modify-write over `localStorage`, and the server's own limits (5 per 15 min per account, 30/min per address) bound it |
| G1-15 gate: the VM's nginx may lack the two exact locations and the `homunculus_reauth` zone | Roadmap gate item: it degrades gracefully (the prefix block still proxies, unlimited, no JSON 429), so a one-line check before the deploy |
