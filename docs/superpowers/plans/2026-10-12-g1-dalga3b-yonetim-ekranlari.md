# Group 1 · Wave 3B — the three administration screens: users and their scope (G1-12), the group × permission table (G1-13) and the login source (G1-14) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The shell gets its administration screen. One screen, three tabs, each gated on its own right. **Users:** every account in the hospital with its role, its extra duties, the groups the directory holds for it, whether it must still change its password, whether a group it is in requires two-step verification it has not set up, and when it last signed in — searchable, with a form that creates a LOCAL account and edits a name, an e-mail and a membership list; the three writes that end a person's open sessions, each confirmed and each naming the consequence; a one-off lift of the directory sign-in throttle with a written reason that goes into the audit trail; and a unit/bed scope editor that really reaches the engine, offers the keys the board actually shows, and puts the previous list back when the server refuses. **Roles:** the permission catalogue down the side — each right described in the reader's own language, with its key under it — the groups across the top with their member counts (absent, never zero, where the API did not count), a checkbox that collects a change and a Save that sends one `PATCH` per group — never an apply-on-the-click — plus creating and deleting a group with the server's three refusals shown as they arrive. **Login source:** the directory's status with the host and nothing else, a connection test whose five refusals each say what to check, a search and an import sent in chunks of two with a progress line, all seven skip reasons translated, and the AD group mapping behind a picker, read-only for any desk that does not hold every right. Nothing is enforced in the browser; no password survives its dialog; and no count, total or member number appears unless the read that produced it answered.

**Architecture:** Three components under `dashboard/src/live/screens/admin/`, mounted by the frame Wave 3's Task 19 built (`AdminScreen.jsx`, `TAB_SCREENS`). They read what the frame's loader read (`useAdminData` → `{data: {users, groups, catalogue, unassigned}, loading, error, reload}`) and reach everything else through `useSession().store.api` inside `store.track`, so a refused refresh ends the session here too. The rules are the ones already written and tested: `screens/admin/catalogue.js` (the permission keys and the default groups, mirrored from `auth/permissions.py`) and `screens/admin/rules.js` (the `/admin` payloads as the screens render them, plus the hints that decide what is offered and never what is allowed). This wave adds three shared pieces and nothing else shared: `screens/admin/refusal.js` (one copy of "a refusal names its subject, on the toast"), `screens/admin/admin.testutil.js` + `.test.js` (the synthetic `/admin`, `/admin/ldap` and `/scope` payloads the three arms' tests share, with a test that holds its permission texts to the backend's own) and `rules.canAssignScope` (the one rule the API has and no permission key reports).

**Tech Stack:** React 18.3, Vite 5.4, Tailwind 3.4, Vitest 2.1 + Testing Library on jsdom 24. **No new package** — in particular no `@testing-library/user-event` (the suite drives the DOM with `fireEvent`). Backend: Python 3.12 (the image) and 3.14 (development), FastAPI, SQLAlchemy 2.1, pytest against the test Postgres. **Tasks 0–13 change no API**; **Task 14 does, and only in four places where a screen could not otherwise tell the truth** — the rest of what those tasks found is recorded, not patched. Python otherwise appears as the sources two tests read as text (`auth/permissions.py`, and the refusal messages of `admin/*` and `scope/*`).

**Design source:** the clickable prototype, `origin/tasarim/prototip` (`8bebc67`) `tasarim-taslaklari/app/`. Administration is **`admin.js`** (2481 lines): the users tab at 712–829, `userModal` at 759–816, `resetPw` at 818–829, the roles tab at 851–883 with its permission matrix at 874–882, and the login-source box — which is a **disabled mock-up**, tagged "LDAP · ileride" — at 1290–1306. There is no `yonetim*.js`. The copy comes from **`ceviri-sozluk.js`**, a 610 kB Turkish-string → AZ/RU/EN table applied by a `MutationObserver`, so the screens have no translation keys at all: this plan mints `roles.*` and `source.*` and extends `admin.*`, taking the four-language copy from that table where it has an entry. `app.css` / `ek.css` for the class vocabulary. **What a live system must refuse** is written down in `docs/tasarim-prototipi-canli-sistem-notu.md`; four of its fourteen items are this surface's (11, 12, 13, 14) and all four are refused here, each with its reason in the file that refuses it.

**Roadmap:** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` — the G1-12 … G1-14 rows and the "Grup 1 kabul ölçütleri" for G1-12. **Spec:** `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md` §3 (the groups and the catalogue), §7 (the directory). **Brief:** `docs/superpowers/plans/2026-10-08-g1-dalga3-is-ekranlari.md` Tasks 20, 21 and 22 — specifications with their acceptance criteria, which this plan honours; where it does not, there is a Decision with the rejected alternative. **As-built contracts:** `/c/tmp/homunculus-plans/amendments.md` and `/c/tmp/homunculus-plans/deferred.md`.

---

## Read this before Task 1

**The administration foundation is NOT on the branch.** Wave 3's Tasks 16–19 — `screens/admin/catalogue.js`, `rules.js`, `useAdminData.js`, `AdminScreen.jsx`, `i18n/strings/admin.js` and the three seam edits — carry code that was written and run, but it was run in the plan author's own scratch worktree (`/c/tmp/homunculus-w3`, uncommitted) and **never committed or merged**. At `feat/canli-tasarim` `4791442` there is no `src/live/screens/admin/` at all. The brief for this wave says the foundation is "already built and merged"; it is not, and every later count in this plan assumes Task 1 lands it first.

It does land cleanly: the four files and the three seam edits were copied onto the branch and run while this plan was written, and the suite grew by **3 files / 58 tests** (98 / 2089 → 101 / 2147 on the measured base), all green, with `npx vite build` clean. The code is byte-identical to the blocks in the Wave 3 plan (checked file by file), so Task 1 is an execution of a plan that already exists rather than a rewrite of it.

**Running it then found five defects in it, and the review of the first draft a sixth**, which is why Tasks 2–4 exist and why they are sequential, before the three arms branch. Two of the five would have broken a file no arm owns, on the day the first arm merged.

---

## Size, and where a seam would be

**15 tasks. Honestly: 32–38 hours of subagent execution including review, not the 10–14 the Wave 3 plan estimated.** The estimate was made before the foundation had been run, and three things it could not have known account for the difference — and a fourth was added by three reviews of the first draft:

| | Hours | Why |
|---|---|---|
| Task 1 — the foundation lands | 1 | Code that exists; copy, run, commit. |
| Tasks 2–4 — the corrections and the seam | 5 | **Not in the estimate.** Running the foundation and reviewing it found six defects in it, two of them in files no arm owns. The seam also has to carry the shared fixtures, their test and the sweep, because three arms cannot each add to one test file. |
| Tasks 5–7 — the users arm (G1-12) | 9 | Three components, 36 tests, six dialogs, a scope editor whose keys come from the board. The largest screen in the product after the patient screen. |
| Tasks 8–9 — the roles arm (G1-13) | 6 | One table, 32 tests, and two new four-language namespaces (the copy and the twenty-one permission descriptions). |
| Tasks 10–11 — the source arm (G1-14) | 8 | Four sections, 37 tests, a new four-language namespace with seven skip reasons and five test reasons, a chunked sequential import, and six operations each with its own in-flight state. |
| Tasks 12–13 — the merge and the documents | 3 | |
| Task 14 — the backend half | 4 | **Added after the first draft, on the user's decision**, and grown by one on the review's. Four API changes, each of which stops a screen claiming something untrue, with eleven Python tests; the Python suite is about 12 minutes per interpreter, run in thirds, on two. |

**Where a seam would be, if this has to be split.** After Task 4. Tasks 0–4 are sequential and leave the branch with the foundation, its corrections, the shared helper, the shared fixtures and a seam proved by `git merge` — a tree on which the three arms can be built on three branches, in three worktrees, in any order, by three agents who never meet. The three arms are 23 hours of the 36 and they are genuinely independent: each writes its own component, its own test file and its own namespace(s), and touches **two lines** of `AdminScreen.jsx`, **two** of `i18n/catalog.js` and **two blocks** of `i18n/strings.test.js`, all six pre-placed with a blank line on either side. That is the seam the whole of Task 4 exists to make true, and it was measured with git's own merge machinery rather than argued (Task 4, Step 10a).

**Counts.** Measured at `feat/canli-tasarim` `91dbd05`: **98 files / 2089 tests**, `npx vite build` clean. `91dbd05` itself touches `docs/tasarim-prototipi-canli-sistem-notu.md` and nothing else — verified with `git diff --name-only f4d6449 91dbd05` — so the source base is `f4d6449`, where the clinical half of Decision 2 landed (one test each in `AlarmsScreen.test.jsx` and `PatientScreen.test.jsx`, in six files none of which this plan edits). **Every "Expected" count below is a delta from that base, with the absolute on it in brackets**; Task 0 prints the base you actually have, and the number to compare against is that plus the delta.

The arithmetic:

| After | Files | Tests | Δ | The file that moved |
|---|---|---|---|---|
| Task 0 (baseline) | 98 | 2089 | — | — |
| Task 1 (foundation) | 101 | 2147 | +58 | `catalogue.test.js` 9, `rules.test.js` 30, `AdminScreen.test.jsx` 19 |
| Task 2 (corrections) | 101 | 2152 | +5 | `rules.test.js` 30 → **34**, `backendApi.test.js` 92 → **93** |
| Task 3 (the refusal helper) | 102 | 2157 | +5 | `refusal.test.js` **5** |
| Task 4 (the seam) | 103 | 2163 | +6 | `rawKeys.test.jsx` 3 → **5**, `admin.testutil.test.js` **4** |
| Task 7 (users) | 104 | 2199 | +36 | `UsersTab.test.jsx` **36** |
| Task 9 (roles) | 105 | 2231 | +32 | `RolesTab.test.jsx` **32** |
| Task 11 (source) | 106 | 2268 | +37 | `SourceTab.test.jsx` **37** |
| Task 12 (merged) | 106 | 2268 | — | the three arms together: 2163 + 36 + 32 + 37 |
| Task 14 (the backend half) | 106 | **2271** | +2 | `catalogue.test.js` 9 → **10**, `rules.test.js` 34 → **35**, `UsersTab.test.jsx` 36 → **37** |

`i18n/strings.test.js` stays at **6** throughout: the three arms add entries to its two Sets, not tests, and so does Task 14 (neither of its two new texts needs a parity entry).

**Task 14 also runs the Python suite**, which no other task does, on both interpreters; its Step 18 carries the measured absolutes — **2272 → 2283 passed, 8 skipped**, on 3.12.13 and on 3.14.5, with `test_infinity_vm_pilot.py` left out of every full run (it can hang under contention) — and the delta is **+11 passed, skipped unchanged**. It needs `PYTHONPATH` set as well as `TEST_DATABASE_URL` — without the first, two tests that spawn a subprocess fail with `ModuleNotFoundError`; without the second, every database test silently **skips** — and Task 14 repeats both exports in every Python block because shell state does not survive between Bash calls.

An arm built on its own branch sees only its own file's additions, so the users arm's gate reads **104 / 2199**, the roles arm's **104 / 2195** (103 + 2163 + 32) and the source arm's **104 / 2200** — each measured on a tree replayed from this document with only that arm's tasks applied. **The number to expect on the merged branch is 106 / 2268**, and an arm that merges second or third must add its own file's count to what it finds rather than to the number printed in its own task.

## How this plan was checked, so you know what to trust

**Every code block below was run, and every "Expected" line was observed rather than worked out.** The sixteen new files and every `replace … with …` pair were written in a scratch worktree, the suite and the build were run after each task, and each "Expected" line is what the command printed — including the ones that print a failure first. The per-task figures (Tasks 1, 2, 3, 4, 7, 9, 11 and 12) were measured on trees **replayed from this document up to that task**, not on the finished tree with the later tasks subtracted.

**And then the finished document was replayed, three times.** Every byte was extracted from this file (and, for Task 1, from the committed Wave 3 plan), written onto a clean worktree at `91dbd05`, and the result diffed file by file against the tree the code had been developed in — dashboard **and** engine. Each time: **identical**, with the suite green and the build clean. The replay harness is the reviewer's `strict.py` (every anchor must occur exactly once, an absent anchor fails rather than skips, a line-prefix anchor is flagged), not the author's earlier `replay2.py`, which skipped an absent anchor silently.

The first replay found **nine** defects in this document that reading it had not, and all nine are of one kind — an instruction a human would have guessed right and a machine could not: five steps that named no anchor (`after X, insert`, `change the import to`, `uncomment …`), one anchor that was a line *prefix* and therefore matched nothing, eleven `DEFAULT_GROUPS` lines given as a list rather than as eleven replacements, one file named "And in `…`" so the pair after it landed on the previous file, and a Task 7 block that had drifted to the *post*-Task-14 version of its file. All nine are explicit `replace … with …` pairs against text that exists.

**Then three reviews of the replayed draft found what the replay could not**, and they are the reason this is the second edition. Three Criticals of one shape — the screen saying something it did not know: a member count printed as `0` for a group the API never counted, because the adapter coerced a missing field (Task 2 now fixes it, and the roles test holds the sentence that was dead); eight write-success tests that asserted the API call and never what the administrator reads (every one now asserts the confirmation **and** blank alert regions); and a mapping write that landed being reported refused when the re-read after it failed (the re-read is a read now, with its own retry). Plus two execution defects: the seam proof sat before Task 4's commit and would have reverted the task's own work (reproduced with a real repository, moved to after the commit), and the four Python exports were stated once and used eleven hundred lines later, which with a `skipif` fixture silently skips every database test. And a decision taken by the user on the review's question: the permission descriptions are the dashboard's, by key (Decision 13). Every changed block was re-run, and the whole document replayed again.

**Two things found by measuring rather than reading are recorded where they were found, and are worth reading before you trust the seam.** `AdminScreen.jsx`'s `TAB_SCREENS` had its three lines **adjacent**, although the Wave 3 plan's own ownership table said every pre-placed line has a blank line on either side: merging the second arm produced `CONFLICT (content): Merge conflict in dashboard/src/live/screens/admin/AdminScreen.jsx`, **measured with `git merge` before anything was changed**, and three arms merge clean in both orders afterwards (Decision 20, Task 4 Steps 1 and 10a). And `stubTabs` could only *assign*, never replace, so three of the frame's nineteen tests asserted things that are true only of a build with **no** tabs — all three would have broken the day the first arm merged, in a file none of the three arms owns; `onlyTabs()` is the fix and it is the same one `shell/screens.testutil.js` already carries for the routes (Decision 21, Task 4 Steps 4 and 5).

**What was NOT run**, and is on you: the "Look at it" step of Tasks 7, 9 and 11. There is no browser driver on this machine, so **no part of this wave has been seen at 390 px, at 1440 px, or in either theme.** The layout decisions — the eight-column table's scrolling region, the roles table's sticky first column, the mapping rows' long DNs, the DN picker's `<select>` — are reasoned from the components' own rules and from what the clinical screens settled, and they are the most likely place for this plan to be wrong. Do those steps; do not treat the green suite as covering them.

---

## Not in this plan

- **Pagination, filtering or searching on the server.** `GET /admin/users` has no `limit`, no `offset`, no cursor and no `q`, and the user decided deliberately to leave it that way for the pilot and add `limit`/`offset` before a second hospital (Wave 3's **Needs the user, 10**, option (a)). The users tab is written against the whole list and **says so on screen** once the list is large — see Decision 5.
- **A rename, and deleting an account.** `UserPatch` has no `username` and there is no `DELETE /admin/users`. Deactivation is what exists and is what the tab offers. The roadmap routes renaming to Group 4.
- **A migration for `kind`.** Task 14c puts `kind` on `GroupSpec`/`GroupOut` but adds no column: it is a property of the group this product *defines*, not of a tenant's copy of it, so there is nothing to backfill and no way for one hospital's `nurse` to be a duty while another's is a role. The dashboard's mirror stays as the fallback.
- **Any backend change beyond Task 14's four.** Tasks 0–13 change no API. Task 14 fixes exactly four things, each one a place where a screen could not tell the truth: `/scope/me` deciding differently from the board, the sign-in unlock discarding whether it granted anything, `GroupOut` not saying what kind of group it describes, and `/scope/unassigned` counting the administrator. Everything else the plan found is recorded in "What the API does not provide" and routed, not patched — in particular **pagination for `/admin/users`** and **a bulk scope read**, which are the two that would change a screen's shape rather than correct a claim; and the two out-of-date permission descriptions in `auth/permissions.py`, which the dashboard no longer shows but which are still the server's words.
- **A per-user MFA policy, "view as this role", invitations, quick PINs, the hospital-structure tree, integrations, cameras, notification rules, the care catalogue, the mobile modules, system settings, the audit screen, system health, the event log, data integrity, open sessions, announcements and backup.** The roadmap's own Group 2–4 lists. The prototype draws fourteen of them; a tab that cannot do anything is a tab an administrator will try during a handover.
- **Anything the prototype does that a live system must not.** The four items of `docs/tasarim-prototipi-canli-sistem-notu.md` that belong to this surface — a client-side password policy in three inconsistent versions with a browser-generated plaintext password (11), permissions in `localStorage` enforced only in the browser (12), a group × permission checkbox that applies on the click with no save and no transaction (13), and a "view as this role" switch (14) — are each refused, and the file that refuses one says why in its header.
- **The VM.** Nothing in this plan deploys, pushes, or touches `/c/Users/User/Desktop/Project/Homunculus AI`. The G1-15 gate is unchanged and gains the items in Task 13.

---

## Decisions

Each one carries the alternative it rejected. The first four are about the API's gaps, because that is where this surface's difficulty actually is.

1. **The foundation lands first, as Wave 3 wrote it, and is then corrected in three sequential tasks — not rewritten.** Tasks 16–19 of the Wave 3 plan were written and run; they are simply unmerged. Task 1 executes them verbatim and Tasks 2–4 fix what running them revealed, each fix with its own test. *Rejected:* reprinting their ~900 lines of code in this document (the committed plan is the authority, and two copies of a landed file drift — the Wave 3 plan says so itself about four of its own blocks); and *also* rejected: building the three tabs on an unmerged scratch tree (the project's own method is that each wave's plan is written against the previous wave's **merged** code, and the five defects below are exactly what merging and running finds).

2. **A refusal goes on the toast, names its subject, and is never also an inline `Alert`.** The patient arm's finding, applied to every administration write: `refusedFor(t, subject, err)` in `screens/admin/refusal.js`, one copy with a test. (The clinical half landed independently in `f4d6449` while this plan was written — the alarms and patient screens now name their refusal's subject too, so the two surfaces agree by construction rather than by coincidence.) The subject is the account's full name, the group's name, the AD group's own name or the search text — never an id. The reason is `apiErrorText`. `useToast()` **is** the function; there is no `.show` (calling one was Wave 3's Critical: a chart the server had taken told the clinician it had failed, in the literal text "toast.show is not a function"). *Rejected:* a refusal in the tab's own state (it dies with the tab, so an administrator who clicked to another tab mid-write sees no error at all and reasonably concludes the write landed); a refusal in both a toast and an `Alert` tone `crit` (both are `role="alert"`, so one refusal is announced twice); an unattributed refusal (read after moving, it says that *something* failed and not what, so she repeats the wrong action or none).

3. **A 422's field message is translated, and that needed a change to `apiErrors.js`.** `backendApi.failure()` builds a 422's `Error.message` as `"<field>: <message>"`, so the whole string matches nothing in `API_MESSAGE_KEYS` — and **every** validator refusal the administration forms can earn (`usernameRule`, `badEmail`, `mustNotBeBlank`, `badSlug`, `reasonOneLine`, `reasonNeedsText`, `badGroupDn`) was reaching the administrator as the server's raw Turkish, in all four languages, although all seven are translated. Measured, not reasoned: `apiErrorText` on a real username 422 printed `username: Kullanıcı adı 2-128 karakter olmalı; …`. Task 2 adds `fieldMessageKey` to `apiErrorKey` and exports `fieldRefusals(t, err)` → `{field: text}`, which the two forms read to put each refusal under the control it is about. *Rejected:* each form matching the messages itself (three copies of a safety mapping, which is the defect `pillRisk` was extracted to prevent); leaving `apiErrorText` alone and showing the raw text (it is Turkish, and the acceptance criterion says "in the user's language").

4. **A 422 goes on the field and NOT on the toast; everything else goes on the toast.** A form inspects the failure: if `fieldRefusals` names any field, the texts go under those controls and focus moves to the first of them — which is where an administrator can act — and nothing is toasted. Otherwise the toast carries it, named. So one refusal is announced once, and the announcement is the one that can be acted on. *Rejected:* both (two announcements of one refusal); only the toast (a 422 about the username read on a toast leaves the administrator hunting for which field it meant).

5. **The users tab loads the whole hospital, filters in the browser, renders fifty rows at a time, and says so out loud once the list is large.** `GET /admin/users` is unbounded by design for the pilot (the user's decision). Three consequences are built in rather than hoped for: the search and the role filter say **how many of how many** they are showing whenever they hide anything; the table renders `PAGE = 50` rows with a "show N more", because an AD import of several hundred accounts otherwise puts six hundred rows and five thousand cells into one commit and the slow screen arrives long before the slow request; and at `MANY = 200` accounts the tab prints one sentence saying it loaded them all and that server-side pagination will be needed. That sentence is the handover note to whoever adds it, **visible to the person who will ask for it**. *Rejected:* rendering every row (the first symptom of an unpaginated list is a screen that takes seconds to answer a keystroke, and it is the symptom an administrator reports as "the system is broken"); a client-side page control that looks like pagination (it would make the tab's search quietly wrong the day real pagination arrives, which is exactly what Wave 3's own note warned against); asking the backend for `limit`/`offset` now (the user decided otherwise, and a plan does not overrule that).

6. **The units column claims nothing it has not read.** There is **no bulk scope read**: `GET /scope/{user_id}` is per user and `GET /scope/unassigned` answers a count. So the cell reads `admin.unitsNotRead` ("Oxunmayıb") until that user's scope has actually been read, and opening the scope editor fills that row for the rest of the session. `admin.noUnits` ("no unit assigned") and `admin.allUnits` ("scope unrestricted") are shown only from a real answer, and they stay two different statements — the prototype conflated them, and they are the difference between "nobody has assigned her anything" and "she is an administrator". *Rejected:* one `GET /scope/{id}` per row (a dozen requests at a pilot, several hundred after an AD import, every one of them through the admin lane the directory calls share — the tab would deny the administrator her own next search); a dash or a zero (both read as "no units", which is a claim); hiding the column (it is one of the eight the brief and the prototype both ask for, and its absence would hide the only route to the editor).

7. **The scope editor's keys come from the board, from the user's own grants, and from a field — and it says so.** There is no endpoint that lists the units and beds a scope may name: they are the values in the site's `bed-mapping.json`, and `/tenant/*` — which does carry a tree — needs `structure.manage`, which `users.manage` does not imply, and its ids are database UUIDs that nothing forces the mapping file to use. So: the `unitId` / `bedId` of the cards on the board this session already has, plus the grants `GET /scope/{id}` reports, plus a free-text field for a key with no patient on it right now; and one line saying where the list came from and that an empty unit does not appear in it. *Rejected:* a unit × bed matrix from `/tenant/*` (wrong permission, and half of it would grant nothing — a matrix that looks complete and is wrong is worse than a list that says what it knows); free text alone (an administrator cannot be asked to remember the mapping file's spelling).

8. **`PUT /scope/{user_id}` has a rule no permission key reports, and the Save is not offered without it.** The server refuses with 403 `kapsam atamak için kapsamı sınırsız bir yönetici olmalısınız` unless the CALLER's own scope is unrestricted **by role** (`SCOPE_UNRESTRICTED_ROLES` = `HOSPITAL_ADMIN` / `PLATFORM_SUPPORT`). `users.manage` is not enough, and nothing in the token says which it is. The only honest source is the caller's own `/scope/me`, whose `reason` distinguishes `role` from `unassigned` — and `unassigned` is `unrestricted: true` **and still refused**, which is the pilot's normal state. So `rules.canAssignScope(myScope)` returns `true` only for `reason === "role"`, `false` for anything else, and **`null` while the answer has not arrived**, in which case the Save is not drawn and the screen says the right is unknown. This is also what finally gives `backendApi.myScope()` a caller. *Rejected:* offering the Save to every `users.manage` desk (it 403s, and an administrator who is refused by a button the screen offered her reads it as a fault in the system); inferring it from `users.manage` (wrong); reading the role from the token (`groups` are slugs, `SCOPE_UNRESTRICTED_ROLES` are the resolver's role names, and mapping one to the other in the browser would be the browser deciding a server rule).

9. **The scope write is a replacement, shown at once, and put back when the server refuses.** `PUT /scope/{id}` takes the WHOLE list (`ScopeAssignment`) because two administrators saving diffs would merge into the union of both — the more permissive outcome, chosen by neither. The screen shows its own list optimistically, and on a refusal restores exactly what the server last told it and says so in a **`Note`**, not an `Alert`: the refusal itself is already announced once on the toast, and the sentence explaining why the list changed back under the reader's hands is a thing to see rather than a second thing to hear. After a successful save the scope is **read back** rather than assumed, because the server normalises the keys it stores (`build_scope` casefolds them) and the answer is the scope. *Rejected:* a diff API (the union); keeping the refused list on screen (an administrator would read it as the user's access); showing the revert as an `Alert` (two `role="alert"` regions, one refusal).

10. **"Role plus extra duty" starts as the dashboard's vocabulary and ends as the API's.** Until Task 14c `GroupOut` has no `kind`, so `catalogue.js` classifies the eleven default slugs — `charge_nurse` and `rapid_response` are duties, the other nine are roles, and a group the hospital created itself is neither and appears under "Diğer gruplar". The form offers **one** role (a `<select>`), any number of duties and any number of other groups, and sends their ids as one `group_ids` list, because the API has one flat membership list. The list is checked against `auth/permissions.py` by a test, so the two cannot drift. **Task 14c then moves the classification to the backend**, where the user wanted it: `GroupSpec.kind` / `GroupOut.kind`, with the mirror kept as the fallback and its test reading the backend's own `kind` so the two cannot drift. The mirror is written first and stays, because it is what a desk that cannot read `/admin/groups` has and what a server without the field would leave the screen with. *Rejected:* inferring it from the slug or the permission set (both break the moment a hospital adds a group); doing 14c **before** the arms (they would have waited on Python for a classification that was already correct).

11. **A group a desk may not grant is shown, disabled, with its reason — never hidden.** In the user form it is a disabled checkbox or a disabled `<option>` carrying `admin.cannotGrant`; in the roles table it is a read-only column carrying the same sentence; and the system group's column carries the server's own words (`errors.systemGroupLocked`). *Rejected:* hiding it (an administrator could not tell "this hospital has no such group" from "I may not give it", which are the two answers she is choosing between); offering it and letting the server refuse (the hint exists precisely so she is not invited to press a button that cannot work).

12. **The roles table collects and saves, and the unit of saving is the GROUP, because that is the unit the API is atomic over.** A checkbox marks a pending change, the group's column says how many are pending **and differ from what the server holds**, and its Save sends one `PATCH /admin/groups/{id}` with the whole permission list in the catalogue's order. There is no endpoint that changes two groups at once, so each column has its own Save and a column that fails leaves the others as they were. A refusal **keeps the pending changes**: they are what the administrator decided, the server did not take them, and discarding them would make her reconstruct the decision from memory. *Rejected:* the prototype's instant apply to `localStorage` (one mis-click grants a right and the audit row records it as a decision somebody made — the design note's item 13); one "Save everything" button (it would promise atomicity the server cannot keep: three `PATCH`es of which the second is refused leave the hospital's permission table in a state nobody chose, with one toast to explain it); counting a checkbox clicked twice as a pending change (it would ask an administrator to save nothing). **A 409 `concurrentChange` re-reads the column and keeps the ticks.** Another administrator saved the group between our read and our write; the PATCH body is the whole list computed from what this screen last read, and the server carries no client version, so Save again on the stale base would silently overwrite what she just saved. The screen reloads, keeps the administrator's ticks — they are what she decided — and says in a `Note` that the column was re-read. *Rejected:* toasting the refusal and leaving the stale base (the first draft did exactly that, the retry then overwrote the other change, and the test pinned the loss). **And a group holding a key the catalogue does not describe is read-only, naming the key.** A Save built from the catalogue would drop it — revoke a right the screen never showed, silently. It cannot happen while `/admin/permissions` serves the whole catalogue, and nothing enforces that it always will. *Rejected:* adding the undescribed keys back into the body (the screen then sends a right it cannot show or explain).

13. **The permission descriptions are translated in the dashboard, by permission key, in four languages — the server's English is the fallback, marked as English.** `/admin/permissions` serves `{key, description}` and the descriptions are English developer prose (`auth/permissions.PERMISSIONS`: "Acknowledge or snooze an alert"). They are not the hospital's words and they are not in the reader's language, and the roles table is the screen on which an administrator decides what a nurse may do — a mis-read permission there is a misconfiguration. So `strings/perms.js` carries twenty-one short sentences keyed by the permission key itself (`perms.alerts.ack`, the key's dots as nesting), the same mechanism every other string uses; a key the server serves and this build does not know falls back to the server's own text with `lang="en"` on it, and the roles arm's test holds the file to the catalogue so the fallback is never silently the rule. The KEY is printed under the description untranslated, because it is what an administrator searches the table by and what a support call quotes — the same reason `apiErrors.js` leaves permission keys untranslated inside `errors.permissionRequired`. The two out-of-date server texts (`users.manage`, `devices.manage`) are still a backend text change, recorded in Task 13: the fallback must not paper over them. **Decided by the user after the first draft**, which showed the server's text verbatim. *Rejected:* the server's text verbatim (the first draft: English prose on an Azerbaijani screen, on the one table where a misreading changes who may do what, and a test fixture that carried Turkish the server never sends); the key alone (`care_team.claim` is not a sentence a charge nurse can act on); asking the backend to serve four languages (the dashboard is where the reader's language is known, and every other text lives there).

14. **The login-source tab draws nothing but its status when the directory is unconfigured.** `GET /admin/ldap/status` is the only route that answers then; every other one answers 409 `Dizin yapılandırılmamış`, so a search box would be offering a 409. One sentence says what that means, that only local accounts are in use, and that the configuration is the server's (`LDAP_URL`) and cannot be changed here. *Rejected:* drawing the sections and letting them fail (three 409s an administrator has to interpret); the prototype's three disabled configuration fields (they imply the host and the search root are editable here, which would be a deployment change made in a browser).

15. **The directory's status shows the host and nothing else.** `LdapStatusOut` carries `configured`, `url_host`, `last_test_at` and `last_test_ok`, by design on the server: no bind DN and no password reach the browser. The panel prints `url_host` — the host name alone, as `auth/ldap.py` reports it (`parts.hostname`): no port, no scheme — says in one line that the bind account and its password are in no response, and puts nothing in a `title`. Its own test asserts that the panel's markup contains no `CN=` / `DC=` / `ou=` at all — in that panel such a string could only be the service account's. *Rejected:* showing the bind DN "for support" (it is a credential's other half, and a screenshot of an administration screen travels further than anyone intends).

16. **"No" is not an answer an administrator can act on: each of the test's five reasons gets a sentence that says what to check.** `unreachable` → the address and the network path (firewall, 636/TCP); `timeout` → a slow or unreachable domain controller; `tls` → the certificate and its root chain, and that only LDAPS is used; `service_bind_rejected` → the service account's password may have changed, expired, or the account may be locked; `protocol` → confirm the address belongs to an LDAP server. A sixth reason a later server invents falls back to "the server gave no reason", which is at least true. A refusal of the test itself (a 503, a timeout) clears the previous result — a stale green "connected" beside a fresh refusal is two answers to one question — and the result, success or reason, is announced from the tab's one live region as well as shown in a `Note`, which is not live. *Rejected:* showing `reason` as it arrives (five English identifiers in an Azerbaijani interface); one generic failure sentence (it is the same information as the red colour); keeping the last result on screen through a refusal (the first draft did).

17. **The import is sent in chunks of `LDAP_IMPORT_CHUNK` = 2, strictly sequentially, and a failed chunk is named.** The server runs `IMPORT_LOOKUPS` directory lookups at a time across **every** request, out of `ADMIN_LANE_SLOTS`, so two concurrent imports would hold the whole admin lane and the administrator's own next search would wait a deadline and then answer 503. The chunk is one wave of lookups, about 24 s against a slow controller — and nginx's `/admin` location has no `proxy_read_timeout`, so its 60 s default would 504 a larger chunk before the server finished. Each chunk's answer is kept and added to the report, the rows a chunk imported are marked imported in the results as each answer lands so they cannot be chosen twice, a failed chunk stops the run and is named by its accounts' usernames (the table shows no index, so a range into it would name nothing), the accounts it carried stay chosen, and the import is idempotent — an account already here comes back as `skipped: "exists"` — so trying again costs nothing. A `REQUEST_TIMEOUT` is shown as `errors.requestTimeout`, which already says the operation may have happened: the right thing for an import. While an import runs the search is held and its button says busy — a new answer would drop the chosen rows out from under the import. *Rejected:* sending all fifty in one call (the API's cap is 50 and the 504 is nginx's, so the administrator would be told "no answer" about accounts that then landed); parallel chunks (it trades a slow import for an administration screen that refuses to answer the person running it); abandoning the chunks already sent (they landed, and their accounts exist).

18. **A DN is chosen from a picker, never typed, and every mapping row says its spelling may be stale.** `canonical_dn` stores and compares a DN in a canonical spelling, and a hand-typed one whose Turkish or Azerbaijani letters differ in case from AD's will not match — silently. So the DN comes from `GET /admin/ldap/groups`, which is a **search** and not a listing: `q` is required and 2–64 characters. A row stored before the canonicalisation may already be in the broken state and **cannot be told from a good one here**, so every row carries one sentence offering to delete it and choose again rather than a guess about which rows are affected. *Rejected:* a text field for the DN (the silent failure); marking only the rows this build believes are stale (the build cannot know, and a wrong mark is worse than an honest offer).

19. **Writing the mapping needs every permission, and the read-only table says the server's own reason.** `ldap_service._full_administrator`: a desk that may not regroup one nurse directly must not regroup every nurse at once through the mapping (403 `mappingAdminOnly`). `rules.canMapGroups` decides what is drawn; reading needs `users.manage` only, so the table is always there. *Rejected:* hiding the table from a desk that may not write it (it is the one place an administrator can see why a nurse keeps getting a group nobody gave her).

20. **The three tabs' seam was proved with git, and it was broken.** `AdminScreen.jsx`'s `TAB_SCREENS` had its three lines **adjacent**, although the Wave 3 plan's own ownership table said every pre-placed line has a blank line on either side: merging the second arm produced `CONFLICT (content): Merge conflict in dashboard/src/live/screens/admin/AdminScreen.jsx`, measured. `strings.test.js`'s G1-14 markers abutted the closing `]);` in both Sets, which `deferred.md` had already flagged for this plan; a branch adding under that marker and a branch appending a later wave's block conflicted, also measured. Both are fixed in Task 4 and both fixes are re-measured — three arms, both merge orders, zero conflicts. *Rejected:* trusting the ownership table (it was wrong, in the file it was describing); tidying the gaps away (they are the whole mechanism: git merges line ranges, and adjacent lines of one object conflict every time).

21. **`stubTabs` cannot say which tabs a build has, so `onlyTabs` exists.** Three of the frame's own nineteen tests asserted things that are only true of a build with NO tabs — "offers no tab this build has not built", "the seam gives the build's tabs back", "says so when this build has nothing to show" — and all three broke the moment the first tab was built, in a file none of the three arms owns. It is the same lesson `shell/screens.testutil.js` already carries for the routes, and the same fix: `onlyTabs(screens)` sets the WHOLE table, every unnamed tab to `null`, so a test that cares which tabs exist states its own build. The three tests are converted in Task 4 and one of them now reads the build's tabs rather than pinning them. *Rejected:* leaving them (the first arm to merge breaks them and the other two rebase onto a broken file); each arm fixing them (three arms editing one shared test file is the collision the seam exists to prevent).

22. **The raw-key sweep walks the tabs, and a permission key is not a translation key.** `rawKeys.test.jsx` opens every built route and sweeps it — but a tabbed screen renders one panel, so the roles and login-source namespaces would have sat outside the net while the file reported the screen covered. It now clicks every `role="tab"` and sweeps each panel; the first thing it caught was the roles table printing `board.view`, which is a **permission** key that happens to be namespace-shaped, so the exact keys of `PERMISSION_KEYS` are exempt and `board.news2` is still caught. `PERMS` becomes the catalogue itself rather than a list of five, because the mapping controls are drawn only for a desk holding **every** right and no fixed list would survive a new permission. And because a sweep can only cover what renders, Task 4 adds the systemic net `w3-fixup.md` left open: every `t("ns.key")` a live source names as a plain literal must exist in all four languages — which covers the dialogs, the error branches and everything else no fixture opens. *Rejected:* leaving the sweep at the first tab (it would have reported two whole namespaces covered); not printing the permission key (it is what the table is searched by); a sweep that opens every dialog (fragile, and the static net covers the same ground for a tenth of the code).

23. **`admin.testutil.js` is the seam's, not an arm's.** The synthetic `/admin`, `/admin/ldap` and `/scope` payloads live in one test-only module created in Task 4, for the reason `data/board.testutil.js` exists on the clinical side: three arms writing their own fixtures produce three fixtures that drift, and a field spelt `member_count` in one and `memberCount` in another makes two tabs that disagree about what the server sends, with both suites green. The builders take the **API's** shapes, snake_case, and go through `userFromApi` / `groupFromApi` / `scopeFromApi` exactly as an answer does — a builder that took the adapted shape would let a tab pass its tests against a payload the server cannot send. `group(slug, over)` and `user(id, over)` are positional and **throw** on the other shape, as the board's builders do. Synthetic staff only: "Ayşe Sentetik", "Kamran Sintetik", "Sentetik Hastane", units `REA-01` / `NICU-01`, AD objects under `DC=sentetik,DC=local`. *Rejected:* fixtures per arm (the drift); fixtures in the adapted shape (tests that cannot fail on a payload change).

24. **`canManageUser(...).unlockSignIn` allows oneself, because the server does.** `admin/service.unlock_sign_in` says so in as many words — "Oneself is allowed — an unlock hands nothing over, the next sign-in still needs the password" — and an AD administrator whose own bind chain is throttled is signed in already and is exactly the person who needs it. The hint refused it, hiding the one action the server would have taken; `admin.selfNote` never claimed otherwise, since it names the password, the authenticator and the account's active state, which ARE refused. Task 2 relaxes it and rewrites the one test that pinned the old behaviour. *Rejected:* keeping the hint conservative (hiding a working action is a different fault from offering a broken one, but it is still the screen lying about what the system does); changing it in an arm (it is a foundation file all three arms import).

25. **A busy control says which row, group or answer is in flight.** `Button` takes `busy` and never `disabled` — the native attribute drops a keyboard user's focus to `<body>` mid-write — and because a busy button reads only "unavailable" to a screen reader, the words come from an `Announce` region that names the subject: `admin.savingFor` with the account's login, the group's name, the AD group's name or the mapping row's DN — minted in Task 3, pre-seam, because all three arms read it. On the login-source tab every operation (test, search, import, group search, add, delete) has its own in-flight state, so the one region can say which; a single busy flag made the search, the add and the delete look live during an import while silently doing nothing, which is the offered-control-that-does-nothing the clinical screens refuse. *Rejected:* `disabled` (the focus); a bare "Saving…" (an administrator resetting four passwords in a row cannot tell which one is in flight); one busy slot for four operations (the first draft).

26. **Every count on these screens is absent unless the read that produced it answered.** `admin.data.unassigned` is `null` when `/scope/unassigned` was not asked or refused, and the tab then prints `admin.scopeUnassignedUnknown` rather than `0` — the difference between "nobody is unassigned" and "we do not know", on the one number that tells an administrator whether the scope matrix has ever been filled in. A group's `member_count` is the same: the roles table prints `roles.membersUnknown` rather than a zero when the API described a group without one — **and this was false in the first draft**: `groupFromApi` turned a missing count into `0`, the sentence was unreachable, and no test could tell. Task 2 makes the count `null` when it was not sent and the roles test holds the sentence. The 2FA cell is the same rule once more: for a user one of whose groups is not in the list it says "unknown", never "off". *Rejected:* zero as the fallback (two defects of exactly this shape survived three arms and two reviews on the alarms screen alone, one of them plan-verbatim).

27. **A password is never in the DOM after its dialog closes.** The temporary password is a `type="password"` field, it is cleared in the same turn the dialog closes, it is never put in a `title`, never toasted and never logged; the tab's test asserts `document.body.innerHTML` does not contain it after the write. The only rule stated to the administrator is the server's own — at least `PASSWORD_MIN` characters — and the server's 422 lands on the field. *Rejected:* the prototype's generated plaintext password with a "regenerate" button and its three mutually inconsistent policies (the design note's item 11); showing the password once after a reset "so it can be passed on" (it is then in a screenshot, a scrollback and a support ticket).

28. **While a write is in flight its dialog cannot be dismissed.** `Modal busy` already does it — Escape, the backdrop and the ✕ are inert and the ✕ keeps focus — and the three confirmations and the two forms all pass it. A refusal must land in an open form, or the administrator is told nothing about a write that did not happen. *Rejected:* closing optimistically and toasting the result (the refusal then arrives about a form she can no longer correct).

29. **Nothing is enforced in the browser.** Every hint comes from `rules.js` and every write is re-checked by the server under the tenant's lock with the caller's rights read from the database; a read-only column, a disabled checkbox and an absent button each carry the server's own reason where there is one. The roles tab says this out loud in one sentence, because the prototype's matrix did the opposite and a reader who has seen it will assume the same of this one. *Rejected:* silence (the sentence is the only thing that distinguishes this table from the one it replaces).

30. **This branch still does not go to the VM.** Nothing here deploys, pushes or touches the user's main checkout.

31. **A write that landed is never reported refused.** The mapping table is re-read after a mapping is added or deleted, and that re-read is a READ: it runs after the write's own `try`, and its failure is shown as the table's own "could not be read" with a retry — not as a refusal of a row that now exists. The same table's first read has its own error state and its own retry, so a failed read is never "loading" forever. *Rejected:* the first draft's re-read inside the write's `try` (a 503 on the re-read toasted success and refusal for one write).

32. **A success is asserted the way a refusal is.** Every write-success test on the three tabs asserts the confirmation the administrator reads **and** that every `role="alert"` region is empty — the toast's error region is mounted before the first toast, so "no alert" is "nothing in it", never "no element". A test that asserts the API call alone cannot see a success that also announces a refusal, which is the Critical the patient arm shipped. *Rejected:* asserting the call and the reload only (the first draft's eight success tests).

---

## What the API does not provide, and what this plan does about it

The most valuable thing the Wave 3 plan found was the list of things its screens needed and the API did not have. The administration surface is where those are thickest. Every row here was read in the engine's source and, where it says so, **measured by calling it**.

| What a tab needs | What the API has | This plan |
|---|---|---|
| **Read one user's scope** | `GET /scope/{user_id}` exists and needs `users.manage` — but **`backendApi` has no method for it**, and `fakeApi` no stub. `myScope()` is `/scope/me`; `setScope()` writes. `rules.scopeFromApi` was written for an answer nothing could fetch. | **Task 2 adds `userScope(id)`** and the stub. One test. |
| **Know whether this desk may assign a scope at all** | Nothing in the token. `PUT /scope/{id}` is 403 unless the CALLER's own scope is unrestricted **by role**; `users.manage` is not enough, and `unrestricted: true` with `reason: "unassigned"` — the pilot's normal state — is still refused. | **Task 2 adds `rules.canAssignScope(myScope)`**, read from `/scope/me`, three-valued (`true` / `false` / `null` while unknown). Decision 8. This is also what gives `myScope()` its first caller. |
| **A 422 in the reader's language** | `apiErrors.js` maps all seven validator texts — but `backendApi.failure()` prefixes `"<field>: "` onto the message, so `apiErrorKey` matched none of them. **Measured:** `apiErrorText(az, <a real username 422>)` printed the server's raw Turkish. | **Task 2 adds `fieldMessageKey` + `fieldRefusals`** to `apiErrors.js`. Decision 3. |
| **List every user's units** | **No bulk scope read.** `GET /scope/{user_id}` is per user; `GET /scope/unassigned` answers a count. | The column claims nothing it has not read; opening the editor fills the row. Decision 6. **Routed:** a `GET /scope?user_ids=…` would make the column real. |
| **List the units and beds a scope may name** | **No endpoint.** The keys are the site's `bed-mapping.json`; `/tenant/*` needs `structure.manage` and uses database UUIDs the mapping file need not share. | The board's own cards + the user's grants + a field, with one line saying so. Decision 7. **Routed to Group 2** with the rest of the bed-map work. |
| **Search the directory's groups for the picker** | `GET /admin/ldap/groups` requires `q`, 2–64 characters after trimming (`ldap_router.SearchQuery`) — and `backendApi.ldapGroups(query = "")` **sent no `q` at all** when called with nothing, which answers **422**, not "every group". `backendApi.test.js` asserted that call. | **Task 2 makes `q` required** in both directory searches and rewrites that assertion. |
| **Limit a directory search** | `GET /admin/ldap/search` has **no `limit` parameter**; the cap is `ldap_service.RESULT_CAP = 50`. `backendApi.ldapSearch(query, limit = 25)` sent `&limit=25`, which FastAPI ignored — so a screen could believe it had asked for ten and be handed fifty. | **Task 2 drops the parameter** and exports `LDAP_SEARCH_CAP`, `LDAP_QUERY_MIN`, `LDAP_QUERY_MAX`. The tab says what the cap is and when the answer has reached it. |
| **Say whether a sign-in unlock granted anything** | `admin/service.unlock_sign_in` returns an `Unlocked` carrying `granted` and `allowed_after`, and the route **discarded it**: `POST /admin/users/{id}/unlock-sign-in` answered `{"ok": true}`. The 409 case (`UNLOCK_COOLDOWN`) was distinguishable; "there was nothing to unlock" was not. | **Fixed in Task 14b**: the answer carries `granted`, `allowed_before` and `allowed_after`; the screen says which of the two happened, and the number of attempts it reports is the server's own difference — never a "three" the screen knows from reading the chain's source. |
| **Know whether the scope table has ever been filled in** | `GET /scope/unassigned` counted every active member with no grant — including the hospital administrator, who needs none — so on a pilot with one administrator it read "1" forever. | **Fixed in Task 14d**: `count_unassigned` leaves out the tenant's system group and platform operators; one test. |
| **Permission descriptions in the reader's language** | `/admin/permissions` carries English developer prose (`auth/permissions.PERMISSIONS`: "Acknowledge or snooze an alert"). | Translated in the dashboard by key, four languages (`strings/perms.js`); the server's text is the `lang="en"` fallback for a key this build does not know. Decision 13. |
| **Say which group is a role and which an extra duty** | `GroupOut` had no `kind`. | **Fixed in Task 14c**: `GroupSpec.kind` and `GroupOut.kind` (`"role"` / `"extra"` / `null` for a hospital's own group), no migration. The mirror stays as the fallback for a server that does not have the field, and its test now reads the backend's own `kind` so the two cannot drift. Decision 10. |
| **Rename an account, or delete one** | Neither exists (`UserPatch` has no `username`; there is no `DELETE /admin/users`). | Not drawn. The username field is `disabled` on an edit and says why. **Routed to Group 4** (renaming) and left (deletion: deactivation is the correct operation for a hospital's audit trail). |
| **A scope that agrees with the board** | `scope/router._view` called `build_scope` without `enforce_unassigned` and without the break-glass patients, so `/scope/me` could say "unassigned" where the board enforces nothing, or omit a break-glass patient the board shows. | **Fixed in Task 14a**, and the fix is held by tests written as an AGREEMENT between the route and the board's own resolver under each of the four reasons the route can produce — `role`, `assigned`, `unassigned`, `break_glass`; `ScopeReason`'s fifth, `tenant_token`, is a device token's and no user route reaches it. `ScopeView` gains `own_patients`, a count, so the break-glass half of the agreement is checkable without a patient identifier. G1-12's one otherwise-unmeetable criterion; Decision 8's hint was correct either way, which is why the arms did not have to wait for this. |
| **Change two groups' permissions in one transaction** | `PATCH /admin/groups/{id}` is atomic for one group under the tenant's lock, with a row version that answers 409 `concurrentChange`. There is no multi-group write. | The unit of saving is the group; each column has its own Save. Decision 12. Not routed: a multi-group write is a bigger promise than this screen needs. |

**Three things the API has that the Wave 3 specification did not know it had**, each of which changed a tab:

- **`GET /admin/ldap/group-mappings` is behind `configured_ldap` too**, so it answers 409 on an unconfigured deployment. The tab therefore does not ask for it at all unless `status.configured` — asserted.
- **`LdapImportIn.external_ids` are `uuid.UUID`s** (`min_length=1, max_length=50`), so a fixture may not use `"e-1"`. `admin.testutil.js` has `guid(n)`.
- **`must_change_password` on `UserOut` is `password_change_due(user)`**, not a stored flag — so it also becomes true when a password expires. The tag reads "a password is due at the next sign-in", which is true of both.

---

## The deferred admin items, decided

`deferred.md` and the Wave 3 plan's `Needs the user` left several admin-shaped items open. Each one is answered here — fixed, or routed with a reason.

| Item | Wave 3B's answer |
|---|---|
| `GET /admin/users` does not paginate, filter or search — unbounded, a tab that loads the whole hospital after an AD import | **Inherited, deliberately, and made visible.** The user chose option (a) for the pilot. The tab filters in the browser, says how many of how many it shows, renders 50 rows at a time, and prints one sentence at 200 accounts saying it loaded them all. Decision 5. |
| `GroupOut` has no `kind`, so role-versus-extra-duty is mirrored in the dashboard | **Fixed, in Task 14c.** The mirror lands first (Task 1) and stays as the fallback, with its test now reading the backend's own `kind`. Decision 10. |
| There is no `DELETE /admin/users` and no rename | **Inherited; neither is drawn.** The username field is `disabled` on an edit and says why. Renaming is Group 4's. |
| `/scope/me` passes neither `enforce_unassigned` nor break-glass to `build_scope`, so it can disagree with the board — a backend defect, and G1-12's one unmeetable criterion | **Fixed, in Task 14a**, which the user asked for after reading the first draft. Decision 8's hint was correct either way, which is why the three arms did not have to wait for it. |
| `strings.test.js`'s G1-14 marker abuts `]);` and needs a gap before three tabs branch off it | **Fixed in Task 4, and the fix measured.** The unfixed file conflicted when one branch added under the marker and another appended a later wave's block; the fixed one merged cleanly, with the right result. |
| `stubTabs` does not unwind LIFO when nested (the same note `deferred.md` made about `stubScreens`) | **Avoided, as Wave 3's Task 7 avoided it for the routes:** `onlyTabs()` sets the whole table at once, so a test that cares which tabs exist states its own build. Nothing in this plan nests. Decision 21. |
| `backendApi.myScope()` has no caller | **Fixed:** it is how the scope editor learns whether this desk may assign at all. Decision 8. |
| The permission descriptions are out of date (`users.manage`, `devices.manage`) — and English | **Translated by key in the dashboard** (`strings/perms.js`, four languages); the server's English is the `lang="en"` fallback for a key this build does not know. The two out-of-date server texts remain a text change in `auth/permissions.py`, which Task 13 records. Decision 13. |
| A mapping row stored before DNs were canonicalised may no longer match | **Answered:** every row carries one sentence offering to delete it and re-create it from the picker, because the build cannot tell a stale row from a good one. Decision 18. |
| `/notifications` has no heartbeat and only the old workspace reads it | Untouched: it is G1-16's to remove. Recorded again in Task 13. |

---

## Ground rules for every task

- Work only in your own worktree off `feat/canli-tasarim`. **Never touch `/c/Users/User/Desktop/Project/Homunculus AI`**, the user's main checkout, and never `git push`, deploy or run anything against the hospital VM. The reference worktree `/c/tmp/homunculus-g1` carries the finished clinical screens: read it, do not commit in it. **The three arms are built in three worktrees** — `/c/tmp/w3b-users`, `/c/tmp/w3b-roles`, `/c/tmp/w3b-source`, each a `git worktree add -b feat/w3b-<arm> <path> feat/w3b-yonetim` after Task 4 — because one worktree with three branches makes the "parallel" arms sequential as written.
- Dashboard commands run from `<worktree>/dashboard`. Filter tests by **folder with a trailing slash** (`npx vitest run src/live/`): Vitest filters by substring, so `src/live` alone also runs `src/liveStore.test.js` and the other old `live*` files.
- The gate at the end of every task is the whole dashboard suite plus a production build:

  ```bash
  cd <worktree>/dashboard
  npx vitest run 2>&1 | tail -5
  npx vite build 2>&1 | grep -E "built in|error"
  ```
  The build always prints `(!) Some chunks are larger than 500 kB` (the old workspace's main chunk): not a failure. Tasks 0–13 change no backend file, so the Python suite is not in their gate; Task 14 does, and its gate runs the Python suite on both interpreters — and if any other task touches a `.py` file, it is in that task's gate too.
- **Counts.** Every "Expected" count assumes the branch at `91dbd05`: **98 files / 2089 tests**, measured. Each gate is stated as a **delta** from the base with the absolute on that base in brackets, so if Task 0 prints a different base, every later expected count is what Task 0 printed plus the plan's deltas. Each gate states its own file's number as well as the suite's, so a wrong total can be traced to a file rather than hunted for; the arithmetic is written out in "Size" and in the Self-review.
- **No new package.**
- **Write and edit files with the Write/Edit tools, never with `sed`, `python` or a shell heredoc.** Two failures on this machine. Heredocs drop backslashes, so a regex or an escape goes in silently wrong; and the working tree's files are **CRLF** while every block in this document is **LF**, so a `sed`/`python` replacement that matches a plan block's text will not match the file on disk — or will match and rewrite the whole file's line endings, producing a diff of hundreds of lines in which the real change cannot be reviewed. The Edit tool handles both. **This happened again while this plan was being written:** three `python` replacements against `UsersTab.test.jsx` failed to match on the CRLF boundary and one of them silently did nothing. For the strings files, which carry Azerbaijani, Russian and Turkish text, also **check the result is UTF-8 and unmangled**: `npx vitest run src/live/i18n/strings.test.js` fails if the Russian lost its Cyrillic or the Azerbaijani its `ə`.
- No hex colour and no Tailwind palette colour in a live component: token classes only (`bg-card`, `bg-card2`, `text-ink`, `text-mute`, `border-line`…). Class names are written out whole, never assembled. No user-visible text inside a component — it comes from `t()` or from the caller.
- **No patient data, ever** (CLAUDE.md, hard rule 6). These screens show staff, not patients — but the scope editor names units and beds, and its fixtures use `REA-01` / `NICU-01` with the synthetic cards of `data/board.testutil.js`. Staff are "Ayşe Sentetik" / "Kamran Sintetik", the hospital is "Sentetik Hastane", AD objects live under `DC=sentetik,DC=local`. Nothing in `admin.testutil.js` may be replaced by anything from a real directory, a real export or a support capture, not even to reproduce a bug.
- **A password is never in the DOM after its dialog closes**, never in a `title`, never in a toast, never logged. The directory's status panel shows the host **only** — never a bind DN, never a password.
- **Nothing is enforced in the browser.** The screen hides what a session may not do and the server refuses it anyway; a read-only control carries the server's own reason.
- **Four languages**, az default, then tr, ru, en, complete for every string, UTF-8 intact. `strings.test.js` enforces parity, the placeholders, the Latin/Cyrillic scripts, and the rule that an Azerbaijani text may equal its Turkish source only where the identity was reviewed and listed.
- **D1 holds:** nothing under `src/live/` may import `liveStore.js`, `clinicalDemo.js`, `ClinicalDemo.jsx`, `clinicalI18n.js`, `permissions.js`, `liveAdmin.js` or `feedHealth.js`; `boundaries.test.js` enforces it. `backendApi.js` is one of the four allowed imports, which is why `SourceTab.jsx` may read its constants directly.
- **A test whose subject is WHICH screens or tabs exist must pin the registry** (`onlyScreens`, `onlyTabs`). A test written against the build instead breaks in a file none of the parallel branches owns, the moment one of them builds a screen — which happened to three of the frame's own tests while this plan was written (Decision 21).
- Accessibility, and **each of these is asserted, not merely intended**:
  - **One `h1` per screen**, and it is the FRAME's (`AdminScreen`). A tab's own heading is an `<h2>`; its test asserts `queryAllByRole("heading", {level: 1})` is **empty**.
  - **A list of records is a real `<table>`**: `<caption>`, `<th scope="col">` on every column header, `<th scope="row">` on the cell that identifies the row — the username, the permission, the AD account. A grid of `<div>`s with a bold first cell looks identical and is unnavigable. `ui/Table.jsx` is the component, and it already makes the frame a named, focusable `role="region"` when it overflows, so a keyboard user can scroll it.
  - **Every control reachable AND operable by keyboard.** `Button` carries `busy`, never `disabled`; each tab's test walks its buttons and asserts none has the native attribute. A cell the server refuses to change is `aria-disabled` and points at the column's reason, never natively `disabled` — a disabled checkbox is skipped in the Tab order and tells a keyboard user nothing.
  - **Something said once is said once**: `Announce` / `useAnnounced`, **never a `role="status"` born with its text**, and never a per-tick announcement. A busy control's words name their subject. And a write that SUCCEEDED is tested as the confirmation on screen **plus** every `role="alert"` region empty — the toast's error region exists before the first toast, so the assertion is on its text, never on the element count.
  - **390 px with no horizontal page scroll**, checked in a browser at 390 and 1440 px in both themes. Every arm's last task carries that step; it is not deferred to Task 12.
  - Token-only colours.
- Stage exactly the paths a task lists — never `git add -A` or `git add .` (other agents commit on this branch). **Never stage while another agent's hunks are uncommitted in a file you stage.** Before every commit run `git status --short` and `git diff --stat`; if a file the task stages shows changes that are not this task's, stop and ask instead of committing. Commit after each task. Every commit message ends with:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
  That is the line current when this plan was written. **The trailer tracks the executing session, not the plan:** `amendments.md` records it changing twice already as the model changed, and the Wave 3 plan's own blocks print an older one than the commits made from them. Use the attribution line your session is given; the ones printed in this document's commit blocks are the form, not the value.

---

## File map

**Create — `dashboard/src/live/`**

| File | Responsibility | Task |
|---|---|---|
| `screens/admin/catalogue.js` + `.test.js` | The permission keys and the default groups, mirrored from `auth/permissions.py`; which group is a role and which an extra duty. | 1 (Wave 3 Task 16); the test gains the `kind` agreement in **14** |
| `screens/admin/rules.js` + `.test.js` | The `/admin` payloads as the screens render them, and the hints those screens follow. | 1 (Wave 3 Task 17), extended in 2, `kind` in **14** |
| `screens/admin/useAdminData.js` | What the three tabs read, loaded once, asking only what the rights allow. | 1 (Wave 3 Task 18) |
| `i18n/strings/admin.js`, `screens/admin/AdminScreen.jsx` + `.test.jsx` | The frame, the three tab slots and their seam. | 1 (Wave 3 Task 19), extended in 3, 4, 5 and **14** |
| `screens/admin/refusal.js` + `.test.js` | One copy of "a refusal names its subject, on the toast" — and of "a confirmation names it too". | **3** |
| `screens/admin/admin.testutil.js` + `.test.js` | The synthetic `/admin`, `/admin/ldap` and `/scope` payloads the three arms share, and a test that holds its permission texts to the backend's own. Test-only. | **4**; `group()` gains `kind` in **14** |
| `screens/admin/UserForm.jsx` | Create a local account; edit a name, an e-mail, the active flag and the manual memberships. | **6** |
| `screens/admin/ScopeEditor.jsx` | Which units and beds one member of staff may see. | **6** |
| `screens/admin/UsersTab.jsx` + `.test.jsx` | The staff list, its six dialogs and its actions. | **7**; the unlock's sentence in **14** |
| `i18n/strings/roles.js`, `i18n/strings/perms.js`, `screens/admin/RolesTab.jsx` + `.test.jsx` | The group × permission table, collect-and-save, create and delete; the twenty-one permission descriptions by key in four languages. | **8, 9** |
| `i18n/strings/source.js`, `screens/admin/SourceTab.jsx` + `.test.jsx` | The directory: status, test, search and import, group mapping. | **10, 11** |

**Modify — dashboard**

| File | Change | Task |
|---|---|---|
| `src/backendApi.js` | `userScope(id)`; `ldapSearch(query)` loses the `limit` FastAPI ignored; `ldapGroups(query)` requires its `q`; `LDAP_SEARCH_CAP`, `LDAP_QUERY_MIN`, `LDAP_QUERY_MAX`. | 2 |
| `src/backendApi.test.js` | One new test for `userScope`; the directory-calls test rewritten. | 2 |
| `src/live/apiErrors.js` | `fieldMessageKey` inside `apiErrorKey`, and the exported `fieldRefusals(t, err)`. | 2 |
| `src/live/screens/admin/rules.js` + `.test.js` | `canAssignScope`; `unlockSignIn` allows oneself; `memberCount` is `null` when the API did not send one. **Then** `kind` from the API, the mirror as the fallback. | 2, **14** |
| `src/live/session/testTokens.testutil.js` | `fakeApi` gains `userScope`. | 2 |
| `src/live/i18n/strings/admin.js` | `refusedFor` / `doneFor` / `savingFor` (Task 3, pre-seam: all three arms read them); eight keys for the users tab (Task 5); `unlocked` with the server's number and `unlockedNothing` (Task 14). | 3, 5, **14** |
| `src/live/screens/admin/AdminScreen.jsx` | **Task 4:** a blank line on either side of each `TAB_SCREENS` line, and `onlyTabs`. **Then one line each:** `users` (7), `roles` (9), `source` (11). | 4, 7, 9, 11 |
| `src/live/screens/admin/AdminScreen.test.jsx` | Its three build-dependent tests converted to `onlyTabs`. | 4 |
| `src/live/i18n/strings.test.js` | **Task 4:** a blank line after the G1-14 marker in both Sets. **Then one block each:** `admin` shared (3), G1-13 (8), G1-14 (10). | 3, 4, 8, 10 |
| `src/live/rawKeys.test.jsx` | `PERMS` becomes the catalogue; the sweep walks every tab; the catalogue's own keys are exempt from the detector; the static "every named key exists" net. | 4 |
| `src/live/i18n/catalog.js` | **Task 1** takes the `admin` pair. Then one pair each: `roles` + `perms` on the roles arm's lines (8), `source` (10). | 1, 8, 10 |
| `src/live/shell/routes.js` | Task 1 takes the `admin` import and its `SCREENS` line (Wave 3 Task 19, Step 9). | 1 |
| `src/live/screens/admin/catalogue.test.js`, `admin.testutil.js`, `UsersTab.jsx` + `.test.jsx` | The dashboard half of Task 14, after the merge: the `kind` agreement, the derived `kind` in the fixture, the unlock's two outcomes with the server's number. | **14** |

**Modify — `homunculus-engine/`** (Task 14 only)

| File | Change | |
|---|---|---|
| `src/homunculus/scope/router.py` | `_view` passes `break_glass_patient_ids` and `enforce_unassigned` to `build_scope`, as the board does; `ScopeView.own_patients`. | 14a |
| `src/homunculus/scope/schemas.py` | `ScopeView.own_patients: int = 0` — a count, never an identifier. | 14a |
| `src/homunculus/admin/router.py` | The unlock answers `{ok, granted, allowed_before, allowed_after}`; `_group_out` sends `kind`. | 14b, 14c |
| `src/homunculus/admin/schemas.py` | `GroupOut.kind: str | None`. | 14c |
| `src/homunculus/auth/permissions.py` | `GroupSpec.kind`, `GROUP_KINDS`, the eleven tags, the import-time check. | 14c |
| `src/homunculus/scope/service.py` | `count_unassigned` leaves out the system group's members and platform operators. | 14d |
| `tests/test_scope_me_agrees_with_board.py` (new), `tests/test_admin_ldap_api.py`, `tests/test_admin_api.py` | Nine, two and one tests. | 14a–d |

**Modify — docs** (Task 13): `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, `docs/homunculus-rehber-TR.md`, `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md`, `docs/tasarim-prototipi-canli-sistem-notu.md`, and `/c/tmp/homunculus-plans/{amendments,deferred}.md`.

### Who owns which shared file

An arm may be built on its own branch. That holds only if the files two arms both touch are either pre-placed before the seam or owned outright by one arm, so this is written out rather than implied — and this time it is also **measured** (Task 4, Step 10a), because the Wave 3 plan's own version of this table was wrong about the file it was describing.

| Shared file | Owned by | The other arms |
|---|---|---|
| `screens/admin/AdminScreen.jsx` | **nobody after Task 4.** Each arm replaces its own commented import and its own `TAB_SCREENS` line | Each of the six lines has a blank line on either side and a `// G1-NN` marker of its own. **Do not tidy the gaps away**: with the lines adjacent, the second arm's merge conflicts, measured. |
| `i18n/catalog.js` | **nobody.** The `admin` pair is Task 1's; the `roles` (+ `perms`) and `source` pairs are their arms' | Same mechanism, already pre-placed by Wave 3's Task 6. The roles arm puts `perms` on its own two lines, not on new ones. |
| `i18n/strings.test.js` | **nobody.** One block per arm in `NEUTRAL` and one in `AZ_SAME_AS_TR` | The users arm's entries are **Task 1's** (Wave 3 Task 19, Step 3) and the shared `admin.refusedFor`/`doneFor` are **Task 3's**, both before the arms branch; only the G1-13 and G1-14 blocks are an arm's. The `· neutral` and `· az = tr` suffixes make each heading unique in the file. |
| `screens/admin/refusal.js`, `admin.testutil.js` + `.test.js`, `rules.js`, `catalogue.js`, `apiErrors.js`, `backendApi.js`, `rawKeys.test.jsx`, `testTokens.testutil.js` | **nobody: they are Tasks 2–4's, and sequential.** Anything two tabs both use goes here | This is the rule `screens/common/BoardState.jsx` carries on the clinical side, and it is worth stating because breaking it does not fail a test: it produces two tabs that word the same refusal differently. |
| `i18n/strings/admin.js` | **the users arm reads it; Tasks 1, 3, 5 and 14 write it** | Task 5 is the users arm's first task and the last writer before the merge; Task 14 writes two keys after it. The roles and source arms have namespaces of their own and read only `admin.savingFor`, `admin.loading` and `admin.colActions`, all minted before the seam. |
| `screens/admin/rules.js` + `.test.js`, `catalogue.test.js`, `admin.testutil.js`, `UsersTab.jsx` + `.test.jsx` | **Task 14, after the merge** | Nothing an arm wrote is invalidated; the counts that move are listed at the end of Task 14. |

---

# Wave 3B · the sequential foundation (Tasks 0–4)

### Task 0: Baseline

**Files:** none changed (this plan file is committed).

- [ ] **Step 1: Make your worktree**

```bash
git -C /c/tmp/homunculus-g1 worktree add /c/tmp/w3b-impl -b feat/w3b-yonetim feat/canli-tasarim
cd /c/tmp/w3b-impl/dashboard
cmd //c "mklink /J node_modules C:\tmp\homunculus-g1\dashboard\node_modules"
```
Never run `npm install`: the junction is the installed tree.

- [ ] **Step 2: Record the base**

```bash
cd /c/tmp/w3b-impl/dashboard
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  98 passed (98)`, `Tests  2089 passed (2089)`, `✓ built in …`.

**Write down what it actually printed.** Every "Expected" total below is a delta from this base with the absolute on `91dbd05` in brackets, so **the number to compare against is what this step printed plus the plan's deltas**, never the bracketed figure alone. If the base differs, nothing else in the plan changes: the per-file numbers are the ones that matter, and each gate states its own.

- [ ] **Step 3: Record the two files this plan changes that already exist**

```bash
npx vitest run src/backendApi.test.js 2>&1 | grep -E "Tests "
npx vitest run src/live/rawKeys.test.jsx 2>&1 | grep -E "Tests "
npx vitest run src/live/i18n/strings.test.js 2>&1 | grep -E "Tests "
ls src/live/screens/admin 2>&1 | head -2
```
Expected: `Tests  92 passed (92)`, `Tests  3 passed (3)`, `Tests  6 passed (6)`, and `ls: cannot access 'src/live/screens/admin': No such file or directory` — **the administration foundation is not on this branch**, which is what Task 1 is for.

- [ ] **Step 4: Commit the plan**

```bash
cd /c/tmp/w3b-impl
cp /c/tmp/homunculus-plans/2026-10-12-g1-dalga3b-yonetim-ekranlari.md docs/superpowers/plans/
git add docs/superpowers/plans/2026-10-12-g1-dalga3b-yonetim-ekranlari.md
git commit -m "$(cat <<'EOF'
docs(plan): Wave 3B — the three administration screens (G1-12, G1-13, G1-14)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** 98 files / 2089 tests, build clean, no `screens/admin/`.

---

### Task 1: The administration foundation lands

**Files:**
- Create: `dashboard/src/live/screens/admin/catalogue.js` + `catalogue.test.js`, `rules.js` + `rules.test.js`, `useAdminData.js`, `AdminScreen.jsx` + `AdminScreen.test.jsx`, `dashboard/src/live/i18n/strings/admin.js`
- Modify: `dashboard/src/live/i18n/catalog.js` (two lines), `dashboard/src/live/i18n/strings.test.js` (two blocks), `dashboard/src/live/shell/routes.js` (two lines)

**This task is an execution of a plan that already exists.** Tasks 16, 17, 18 and 19 of `docs/superpowers/plans/2026-10-08-g1-dalga3-is-ekranlari.md` carry the complete code for all seven files and all three seam edits, and that code was written and run — in a scratch worktree that was never committed, which is why it is not on this branch. It is reproduced there in full and is **not** reproduced here: two copies of a landed file drift, and the committed plan is the authority (the Wave 3 plan says so itself about four of its own blocks).

Read those four tasks and carry out every step **except** the ones listed under "What to skip" below. Then run this task's own gate.

- [ ] **Step 1: Wave 3 Task 16** — `screens/admin/catalogue.js` + `catalogue.test.js`, in that order (the test first, watch it fail on the missing import, then the module).

Run: `npx vitest run src/live/screens/admin/ 2>&1 | grep -E "Tests "`
Expected: `Tests  9 passed (9)`.

- [ ] **Step 2: Wave 3 Task 17** — `screens/admin/rules.js` + `rules.test.js`.

Run: `npx vitest run src/live/screens/admin/ 2>&1 | grep -E "Tests "`
Expected: `Tests  39 passed (39)` (9 + 30).

- [ ] **Step 3: Wave 3 Task 18** — `screens/admin/useAdminData.js`. No test file of its own; Task 19's test covers every branch.

Run: `npx vitest run 2>&1 | tail -3`
Expected: unchanged from Step 2's suite total — nothing imports it yet.

- [ ] **Step 4: Wave 3 Task 19** — `i18n/strings/admin.js`, the `admin` pair in `i18n/catalog.js`, the G1-12 blocks in **both** Sets of `i18n/strings.test.js`, `AdminScreen.test.jsx`, `AdminScreen.jsx`, and the `admin` import plus `SCREENS` line in `shell/routes.js`.

Run: `npx vitest run src/live/screens/admin/ src/live/i18n/strings.test.js 2>&1 | grep -E "Tests "`
Expected: `Tests  64 passed (64)` (9 + 30 + 19 + 6).

**What to skip, and why.**

- **Wave 3 Task 19, Step 9a ("Look at it")** — do it at the end of Task 7 instead, when there is a tab in the frame to look at. An empty frame at 390 px tells you nothing the frame's own test does not.
- **Every "Gate" number in those four tasks**, and **Task 19 Step 8's `Tests  56 passed (56)`**. They were written against a different base (`cced4f9`, and a predicted post-merge total of 99 files / 2097 tests), and Step 8's figure was predicted too: `src/live/screens/admin/` prints **58** there (9 + 30 + 19), measured. The real base is 98 / 2089 and the real totals are below.
- **Nothing else.** In particular do not "improve" the four files while copying them: Tasks 2 and 3 of this plan are the corrections, each with its own test, so a reviewer can see what running the foundation found.

- [ ] **Step 5: Gate**

```bash
cd /c/tmp/w3b-impl/dashboard
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  101 passed (101)`, `Tests  2147 passed (2147)` — **+3 files / +58 tests** on the base — and `✓ built in …`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/w3b-impl
git status --short
git add dashboard/src/live/screens/admin dashboard/src/live/i18n/strings/admin.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/shell/routes.js
git commit -m "$(cat <<'EOF'
feat(dashboard): the administration foundation and the frame for its three tabs

Wave 3's Tasks 16-19, executed: the permission catalogue mirrored from
auth/permissions.py with a test that reads it, the /admin payloads and the
hints the tabs follow, the loader that asks only what the session's rights
allow, and the frame whose three tab slots are a registry seam of their own.
Written and run in Wave 3 and never merged; the three tabs are built on it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** three new test files, +58 tests (`101 / 2147`), build clean. `#/admin` now reaches a frame that says "you have no access to this section" — correct, because no tab is built.

---

### Task 2: The four corrections running the foundation found

**Files:**
- Modify: `dashboard/src/live/apiErrors.js`, `dashboard/src/backendApi.js`, `dashboard/src/backendApi.test.js`, `dashboard/src/live/screens/admin/rules.js`, `dashboard/src/live/screens/admin/rules.test.js`, `dashboard/src/live/session/testTokens.testutil.js`

Four things the tabs need that the foundation does not give them, each measured rather than reasoned (Decisions 3, 8, 24, 26, and the API table above). They are **sequential, before the arms branch**, because every file here is shared.

- [ ] **Step 1: Watch the 422 defect, so you know what you are fixing**

Create `dashboard/src/live/zz-measure.test.js`:

```javascript
import { describe, it, expect } from "vitest";
import { apiErrorKey, apiErrorText } from "./apiErrors.js";
import { createTranslator } from "./i18n/translate.js";
import { DICTIONARIES } from "./i18n/catalog.js";

const az = createTranslator("az", DICTIONARIES);
const RULE = "Kullanıcı adı 2-128 karakter olmalı; yalnızca a-z, 0-9 ve . _ @ - kullanılabilir. Türkçe/Azerbaycanca harfleri Latin karşılığıyla yazın: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e.";

describe("a 422 from the user form, as backendApi builds it", () => {
  it("prints what?", () => {
    const err = Object.assign(new Error(`username: ${RULE}`), {
      status: 422, fieldErrors: [{ field: "username", type: "value_error", message: RULE }],
    });
    console.log("KEY:", JSON.stringify(apiErrorKey(err)));
    console.log("TEXT:", apiErrorText(az, err));
    expect(1).toBe(1);
  });
});
```

Run: `npx vitest run src/live/zz-measure.test.js 2>&1 | grep -E "KEY:|TEXT:"`
Expected, before the fix:
```
KEY: null
TEXT: username: Kullanıcı adı 2-128 karakter olmalı; yalnızca a-z, 0-9 ve . _ @ - kullanılabilir. Türkçe/Azerbaycanca harfleri Latin karşılığıyla yazın: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e.
```
That is the server's raw Turkish, in an Azerbaijani interface, for a refusal that is translated four times over. **Delete this file before Step 3** — it is a measurement, not a test:

```bash
rm dashboard/src/live/zz-measure.test.js
```

- [ ] **Step 2: Fix it.** In `dashboard/src/live/apiErrors.js`, replace

```javascript
/** Which `errors.*` text an API failure is — {key, vars} — or null when it is not a known one.
```

with

```javascript
/** One 422 item's own message, looked up as a message in its own right.
 *
 *  WHY THIS EXISTS. `backendApi.failure()` builds a 422's `Error.message` by joining its items as
 *  `"<field>: <message>"`, so the whole string no longer equals anything in `API_MESSAGE_KEYS` —
 *  and every validator text the administration forms can earn (`usernameRule`, `badEmail`,
 *  `mustNotBeBlank`, `badSlug`, `reasonOneLine`, `reasonNeedsText`, `badGroupDn`) was reaching the
 *  administrator as the server's raw Turkish, in all four languages, although all seven are
 *  translated. Measured, not reasoned: `apiErrorText` on a real username 422 printed
 *  `username: Kullanıcı adı 2-128 karakter olmalı; …`. The item's own `message` has no prefix, so
 *  it matches. */
function fieldMessageKey(item) {
  const key = API_MESSAGE_KEYS.get(String(item?.message ?? "").trim());
  return key ? { key: `errors.${key}`, vars: {} } : null;
}

/** Which of a form's fields a 422 is about, and what to print under it — `{field: text}`, in the
 *  reader's language. The field names are the API's (`username`, `email`, `full_name`, `password`,
 *  `slug`, `name`, `reason`, `ad_group_dn`); a form maps them to its own controls. An item whose
 *  message is not a known one keeps the server's words, which is still better under the field it is
 *  about than nowhere. Empty when the failure is not a 422 with fields. */
export function fieldRefusals(t, err) {
  const out = {};
  for (const item of Array.isArray(err?.fieldErrors) ? err.fieldErrors : []) {
    if (!item || typeof item.field !== "string" || item.field === "" || out[item.field]) continue;
    const hit = fieldErrorKey(item) || fieldMessageKey(item);
    const text = hit ? t(hit.key, hit.vars) : String(item.message ?? "").trim();
    if (text) out[item.field] = text;
  }
  return out;
}

/** Which `errors.*` text an API failure is — {key, vars} — or null when it is not a known one.
```

(The replaced line is the first line of `apiErrorKey`'s own doc comment, so the new code lands between the two functions and that comment is put back unchanged at the end of the block.)

and inside `apiErrorKey`, replace

```javascript
    const hit = err.fieldErrors.map(fieldErrorKey).find(Boolean);
```

with

```javascript
    const hit = err.fieldErrors.map(fieldErrorKey).find(Boolean)
      || err.fieldErrors.map(fieldMessageKey).find(Boolean);
```

The order matters and is not arbitrary: `fieldErrorKey` recognises a password's `string_too_long` / `string_too_short` by its **type**, which is more exact than its message, and it must keep winning.

- [ ] **Step 3: The API client's missing read and its two directory defects.** In `dashboard/src/backendApi.js`, replace

```javascript
    /** What the caller may see, and why. */
    myScope() {
      return authed("/scope/me");
    },
```

with

```javascript
    /** What the caller may see, and why. The administration screen reads it for one thing it
     *  cannot ask any other way: `PUT /scope/{id}` is refused (403) unless the CALLER's own scope
     *  is unrestricted by role (`scope/router.py put_scope`, `SCOPE_UNRESTRICTED_ROLES`), which no
     *  permission key reports — `users.manage` alone is not enough. */
    myScope() {
      return authed("/scope/me");
    },

    /** One user's scope as the administrator sees it (`GET /scope/{id}`, needs `users.manage`):
     *  `{user_id, role, unrestricted, reason, unit_ids, bed_ids, grants}`. 404 for an id that is
     *  not an active member of this hospital — the same answer as for one that does not exist. */
    userScope(userId) {
      return authed(`/scope/${encodeURIComponent(userId)}`);
    },
```

and replace the two directory searches

```javascript
    /** [LdapUserOut] for a name fragment — each says whether it is already imported. */
    ldapSearch(query, limit = 25) {
      return authed(`/admin/ldap/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`,
        { timeoutMs: ADMIN_LDAP_TIMEOUT_MS });
    },
    /** [{dn, name}] — the directory's groups, for the mapping's picker. */
    ldapGroups(query = "") {
      const q = query ? `?q=${encodeURIComponent(query)}` : "";
      return authed(`/admin/ldap/groups${q}`, { timeoutMs: ADMIN_LDAP_TIMEOUT_MS });
    },
```

with

```javascript
    /** [LdapUserOut] for a name fragment — each says whether it is already imported. `query` is
     *  REQUIRED and 2-64 characters after trimming (`ldap_router.SearchQuery`): the directory is
     *  not listed, it is searched. The server caps the answer at `LDAP_SEARCH_CAP` and takes no
     *  limit of its own — an earlier `&limit=` here was simply ignored by FastAPI, so a screen
     *  that believed it had asked for ten could be handed fifty. */
    ldapSearch(query) {
      return authed(`/admin/ldap/search?q=${encodeURIComponent(query)}`,
        { timeoutMs: ADMIN_LDAP_TIMEOUT_MS });
    },
    /** [{dn, name}] — the directory's groups, for the mapping's picker. `query` is REQUIRED on the
     *  same terms as the user search: calling it with nothing answered 422, not "every group". */
    ldapGroups(query) {
      return authed(`/admin/ldap/groups?q=${encodeURIComponent(query)}`,
        { timeoutMs: ADMIN_LDAP_TIMEOUT_MS });
    },
```

Then add the four constants the login-source tab prints. Replace

```javascript
/** The most accounts one `/admin/ldap/import` call takes (the API's own cap). */
export const LDAP_IMPORT_MAX = 50;
```

with

```javascript
/** The most accounts one `/admin/ldap/import` call takes (the API's own cap). */
export const LDAP_IMPORT_MAX = 50;
/** The most rows a directory search or a group search answers with, whatever is asked
 *  (`admin/ldap_service.RESULT_CAP`). The caller cannot ask for fewer; it can only narrow the
 *  query. A screen that shows the results says so when it has this many. */
export const LDAP_SEARCH_CAP = 50;
/** The shortest directory query the API accepts, trimmed (`ldap_router.SearchQuery`, 2-64). A
 *  screen holds its search button below this rather than earning a 422 that says it in Turkish. */
export const LDAP_QUERY_MIN = 2;
export const LDAP_QUERY_MAX = 64;
```

- [ ] **Step 3a: Prove the two directory calls were wrong, not merely odd.** `GET /admin/ldap/groups`'s `q` is `Annotated[str, Query(min_length=2, max_length=64), BeforeValidator(_trimmed)]` — a **required** query parameter — and `GET /admin/ldap/search` has no `limit` at all:

```bash
grep -n "SearchQuery = \|async def ldap_groups\|async def ldap_search\|RESULT_CAP = " \
  homunculus-engine/src/homunculus/admin/ldap_router.py homunculus-engine/src/homunculus/admin/ldap_service.py
```
Expected: `SearchQuery = Annotated[str, Query(min_length=2, max_length=64), BeforeValidator(_trimmed)]`, both route signatures taking `q: SearchQuery` and neither taking a `limit`, and `RESULT_CAP = 50`.

- [ ] **Step 4: Fix the test that pinned the broken call.** In `dashboard/src/backendApi.test.js`, replace

```javascript
    await api.ldapSearch("ayşe", 10);
    await api.ldapGroups("YB");
    await api.ldapGroups();
    await api.ldapMappings();
    expect(fetchMock.mock.calls.map(([url, init]) => `${init.method || "GET"} ${url}`)).toEqual([
      "GET /admin/ldap/status",
      "POST /admin/ldap/test",
      "GET /admin/ldap/search?q=ay%C5%9Fe&limit=10",
      "GET /admin/ldap/groups?q=YB",
      "GET /admin/ldap/groups",
      "GET /admin/ldap/group-mappings",
    ]);
  });
```

with

```javascript
    await api.ldapSearch("ayşe");
    await api.ldapGroups("YB");
    await api.ldapMappings();
    expect(fetchMock.mock.calls.map(([url, init]) => `${init.method || "GET"} ${url}`)).toEqual([
      "GET /admin/ldap/status",
      "POST /admin/ldap/test",
      // No `limit`: the route has no such parameter and FastAPI ignored the one that used to be
      // sent, so a screen could believe it had asked for ten and be handed LDAP_SEARCH_CAP.
      "GET /admin/ldap/search?q=ay%C5%9Fe",
      // `q` is REQUIRED on both searches (2-64 characters, trimmed). The group picker used to be
      // callable with nothing, which answered 422 rather than "every group".
      "GET /admin/ldap/groups?q=YB",
      "GET /admin/ldap/group-mappings",
    ]);
  });

  it("reads one user's scope, which the scope editor needs and /scope/me cannot answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ user_id: "u-1", grants: [] }));
    const api = signedIn(fetchMock);
    await api.userScope("u 1/x");
    expect(fetchMock.mock.calls[0][0]).toBe("/scope/u%201%2Fx");
    expect(fetchMock.mock.calls[0][1].method ?? "GET").toBe("GET");
  });
```

Run: `npx vitest run src/backendApi.test.js 2>&1 | grep -E "Tests "`
Expected: `Tests  93 passed (93)`.

- [ ] **Step 5: `fakeApi` gains the call.** In `dashboard/src/live/session/testTokens.testutil.js`, replace

```javascript
    myScope: vi.fn(),
    setScope: vi.fn(),
```

with

```javascript
    myScope: vi.fn(),
    userScope: vi.fn(),
    setScope: vi.fn(),
```

- [ ] **Step 6: Write the failing tests for the two rules.** In `dashboard/src/live/screens/admin/rules.test.js`, replace

```javascript
import {
  canGrant, canManageUser, canMapGroups, groupFromApi, groupRights, rightsBeyond, scopeFromApi,
  userFromApi, userRights,
} from "./rules.js";
```

with

```javascript
import {
  canAssignScope, canGrant, canManageUser, canMapGroups, groupFromApi, groupRights, rightsBeyond,
  scopeFromApi, userFromApi, userRights,
} from "./rules.js";
```

then replace

```javascript
  it("nobody resets or deactivates themselves", () => {
    const verdict = canManageUser(DESK, { ...nurse, id: "u-1" }, groups, "u-1", CATALOGUE);
    expect(verdict.edit).toBe(true);                 // a name or an e-mail, yes
    expect(verdict.resetPassword).toBe(false);
    expect(verdict.resetMfa).toBe(false);
    expect(verdict.deactivate).toBe(false);
    expect(verdict.unlockSignIn).toBe(false);
  });
```

with

```javascript
  it("nobody resets or deactivates themselves", () => {
    const verdict = canManageUser(DESK, { ...nurse, id: "u-1" }, groups, "u-1", CATALOGUE);
    expect(verdict.edit).toBe(true);                 // a name or an e-mail, yes
    expect(verdict.resetPassword).toBe(false);
    expect(verdict.resetMfa).toBe(false);
    expect(verdict.deactivate).toBe(false);
  });

  it("lifting your OWN directory throttle is allowed, as the server allows it", () => {
    // admin/service.unlock_sign_in: "Oneself is allowed — an unlock hands nothing over, the next
    // sign-in still needs the password." An AD administrator whose own bind chain is throttled is
    // signed in already and is the person who needs it; this hint used to hide the one action the
    // server would have taken.
    expect(canManageUser(DESK, { ...ad, id: "u-1" }, groups, "u-1", CATALOGUE).unlockSignIn).toBe(true);
    expect(canManageUser(DESK, { ...nurse, id: "u-1" }, groups, "u-1", CATALOGUE).unlockSignIn).toBe(false);
  });
```

replace

```javascript
  it("a member count the API did not send is none", () => {
    expect(group({ member_count: null }).memberCount).toBe(0);
    expect(groupFromApi(null).memberCount).toBe(0);
  });
```

with

```javascript
  it("a member count the API did not send is unknown, never zero", () => {
    // "0 people" is a claim about the group; "not known" is the truth of an absent field. The old
    // `Number(x) || 0` made them the same, and the roles table's own "member count unknown"
    // sentence was unreachable for it.
    expect(group({ member_count: null }).memberCount).toBeNull();
    expect(group({ member_count: undefined }).memberCount).toBeNull();
    expect(group({ member_count: "4" }).memberCount).toBeNull();
    expect(group({ member_count: 0 }).memberCount).toBe(0);           // a real zero stays a zero
    expect(groupFromApi(null).memberCount).toBeNull();
  });
```

and replace

```javascript
describe("canMapGroups", () => {
```

with

```javascript
describe("canAssignScope", () => {
  it("only a desk whose own scope is unrestricted BY ROLE — the server's own rule", () => {
    // scope/router.py put_scope: 403 unless read_role(caller) is in SCOPE_UNRESTRICTED_ROLES.
    // No permission key reports it, so the only source is the caller's own /scope/me.
    expect(canAssignScope(scopeFromApi({ unrestricted: true, reason: "role" }))).toBe(true);
    expect(canAssignScope(scopeFromApi({ unrestricted: false, reason: "assigned" }))).toBe(false);
  });

  it("a desk unrestricted only because nobody has been assigned yet may NOT assign", () => {
    // build_scope returns unrestricted: true with reason "unassigned" until the deployment flips
    // enforce_unassigned — the pilot's normal state, and the server still refuses the write.
    expect(canAssignScope(scopeFromApi({ unrestricted: true, reason: "unassigned" }))).toBe(false);
  });

  it("an answer that has not arrived is unknown, not permission", () => {
    expect(canAssignScope(null)).toBeNull();
    expect(canAssignScope(undefined)).toBeNull();
  });
});

describe("canMapGroups", () => {
```

Run: `npx vitest run src/live/screens/admin/rules.test.js 2>&1 | grep -E "Tests |canAssignScope|never zero"`
Expected: `Tests  5 failed | 29 passed (34)` — the three `canAssignScope is not a function`, the self-unlock expectation, and the member count that is still `0`.

- [ ] **Step 7: Make them pass.** In `dashboard/src/live/screens/admin/rules.js`, inside `canManageUser`'s doc comment, replace

```javascript
 *    unlockSignIn   — never on yourself, and only for a DIRECTORY account: the throttle it lifts
 *                     is the AD bind chain (`directory_binds`), which a local account has none of.
```

with

```javascript
 *    unlockSignIn   — only for a DIRECTORY account: the throttle it lifts is the AD bind chain
 *                     (`directory_binds`), which a local account has none of. ON YOURSELF TOO,
 *                     unlike the three above, because the server allows it and says why
 *                     (`admin/service.unlock_sign_in`: "Oneself is allowed — an unlock hands
 *                     nothing over, the next sign-in still needs the password"). An AD
 *                     administrator whose own bind chain is throttled is signed in already and is
 *                     exactly the person who needs it; refusing her here hid a working action,
 *                     and `admin.selfNote` does not claim otherwise — it names the password, the
 *                     authenticator and the account's active state, which ARE refused.
```

replace

```javascript
    unlockSignIn: notSelf && user.authSource === "ldap",
```

with

```javascript
    unlockSignIn: within && user.authSource === "ldap",
```

and replace

```javascript
/** May the session change the AD group mapping? The server allows it only to an administrator who
```

with

```javascript
/** May the session ASSIGN a scope at all? `PUT /scope/{user_id}` is refused with 403
 *  `kapsam atamak için kapsamı sınırsız bir yönetici olmalısınız` unless the CALLER's own scope is
 *  unrestricted BY ROLE (`scope/router.py put_scope`, `SCOPE_UNRESTRICTED_ROLES` =
 *  hospital_admin / platform_support). No permission key reports that — `users.manage` alone is
 *  not enough — so the only honest source is the caller's own `/scope/me`, whose `reason` says
 *  WHY it is unrestricted.
 *
 *  `reason === "role"` and nothing else: a desk that is unrestricted only because nobody has been
 *  assigned anything yet (`reason: "unassigned"`, which is `unrestricted: true` until the
 *  deployment flips `enforce_unassigned`) would be refused by the server, and that is the common
 *  case at a pilot. `null` means the answer has not arrived — the screen then says so rather than
 *  offering a Save that may not work, because unknown rights are never taken to be large either. */
export function canAssignScope(myScope) {
  if (!myScope || typeof myScope !== "object") return null;
  return myScope.unrestricted === true && myScope.reason === "role";
}

/** May the session change the AD group mapping? The server allows it only to an administrator who
```

(The replaced line is the first line of `canMapGroups`'s own doc comment, in both of the last two
pairs: the new code lands before it and the comment is put back unchanged at the end of the block.)

- [ ] **Step 7a: A count the API did not send is not a zero.** Decision 26's one safety rule — no count unless the read that produced it answered — was broken in the foundation itself: `Number(x) || 0` turned a missing `member_count` into `0`, which the roles table then prints as "0 people", a statement about the group that nobody made; and the table's own "member count unknown" sentence, guarded on a finite number, could never be reached. **Found after the first replay, by the review, on a finished tree where the four-language string was dead and no test could tell.** In `dashboard/src/live/screens/admin/rules.js`, replace

```javascript
    memberCount: Number(row.member_count) || 0,
```

with

```javascript
    // A count the API did not send is NOT ZERO. `Number(x) || 0` turned null, undefined and a
    // string alike into 0 — which a screen then printed as "0 people", a statement about the
    // group's membership that nobody had made — and the roles table's "member count unknown"
    // sentence, guarded on `Number.isFinite`, could never be reached. Measured on the finished
    // tree, where that four-language string was dead and no test could tell. The one safety rule
    // these screens share: no count unless the read that produced it answered.
    memberCount: typeof row.member_count === "number" && Number.isFinite(row.member_count)
      ? row.member_count
      : null,
```

- [ ] **Step 8: Run it**

```bash
npx vitest run src/live/screens/admin/ src/live/apiErrors.test.js 2>&1 | grep -E "Tests "
```
Expected: `Tests  188 passed (188)` — `catalogue` 9, `rules` **34**, `AdminScreen` 19, `apiErrors` 126.

- [ ] **Step 9: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  101 passed (101)`, `Tests  2152 passed (2152)` (+5 on the base's 2089 after Task 1's 58), build clean.

- [ ] **Step 10: Commit**

```bash
git status --short
git add dashboard/src/live/apiErrors.js dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/screens/admin/rules.js dashboard/src/live/screens/admin/rules.test.js dashboard/src/live/session/testTokens.testutil.js
git commit -m "$(cat <<'EOF'
fix(dashboard): the three things the administration tabs need and could not get

A 422's own field message is translated: backendApi joins a 422 as
"<field>: <message>", so every validator refusal the admin forms can earn was
reaching an Azerbaijani-speaking administrator as the server's raw Turkish,
measured. One user's scope can now be read at all (GET /scope/{id} had no
client method, and rules.scopeFromApi was written for an answer nothing could
fetch). And the one rule the API has that no permission key reports -- PUT
/scope needs the CALLER's own scope to be unrestricted by role -- is a hint of
its own, read from /scope/me, which finally gives myScope() a caller.

Two directory calls were also wrong: the group picker sent no q, which the
route answers 422 rather than "every group", and the user search sent a limit
FastAPI ignores. Lifting your own AD throttle is allowed, because the server
allows it and says why. And a member count the API did not send is null, not
zero: "0 people" is a statement about the group that nobody made, and the roles
table's own "count unknown" sentence was unreachable for it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** +5 tests (`rules` +4, `backendApi` +1), `101 / 2152`, build clean.

---

### Task 3: One copy of "a refusal names its subject"

**Files:**
- Create: `dashboard/src/live/screens/admin/refusal.js` + `refusal.test.js`
- Modify: `dashboard/src/live/i18n/strings/admin.js` (three keys × four languages), `dashboard/src/live/i18n/strings.test.js` (one block in each Set)

This is the administration side of the patient arm's finding, and it is one module for the reason `pillRisk` is one module: a safety-shaped mapping with three copies is three wordings of the same refusal (Decision 2).

- [ ] **Step 1: Write the failing test.** Create `dashboard/src/live/screens/admin/refusal.test.js`:

```javascript
// One copy of "a refusal names its subject", so the three tabs cannot word it three ways.
// Synthetic accounts only.
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "../../i18n/catalog.js";
import { createTranslator } from "../../i18n/translate.js";
import { doneFor, refusedFor } from "./refusal.js";

const az = createTranslator("az", DICTIONARIES);
const en = createTranslator("en", DICTIONARIES);
const refusal = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

describe("refusedFor", () => {
  it("names the account in front of the server's own reason", () => {
    const err = refusal(409, "Bu hesap başka bir kurumda da etkin; parola, MFA, e-posta, ad ve etkinlik buradan değiştirilemez, yalnızca bu kurumdaki grupları ayarlanabilir");
    const text = refusedFor(az, "Ayşe Sentetik", err);
    expect(text.startsWith("Ayşe Sentetik")).toBe(true);
    expect(text).toContain(az("errors.sharedAccount"));
  });

  it("translates a 422's own field message, which the raw message no longer matches", () => {
    // backendApi builds the Error's message as "<field>: <text>", so the whole string is in no
    // table; the item's own message is. Before this, every validator refusal in the
    // administration forms reached the administrator as the server's raw Turkish.
    const err = refusal(422, "username: Kullanıcı adı 2-128 karakter olmalı; yalnızca a-z, 0-9 ve . _ @ - kullanılabilir. Türkçe/Azerbaycanca harfleri Latin karşılığıyla yazın: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e.", {
      fieldErrors: [{ field: "username", type: "value_error", message: "Kullanıcı adı 2-128 karakter olmalı; yalnızca a-z, 0-9 ve . _ @ - kullanılabilir. Türkçe/Azerbaycanca harfleri Latin karşılığıyla yazın: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e." }],
    });
    expect(refusedFor(en, "hs.aygun", err)).toBe(en("admin.refusedFor", {
      subject: "hs.aygun", reason: en("errors.usernameRule"),
    }));
  });

  it("with no subject it is the reason alone, never an empty prefix", () => {
    const err = refusal(503, "Dizin sunucusuna ulaşılamıyor");
    expect(refusedFor(az, "", err)).toBe(az("errors.directoryUnreachable"));
    expect(refusedFor(az, null, err)).toBe(az("errors.directoryUnreachable"));
  });

  it("an unknown refusal keeps the server's words rather than inventing one", () => {
    expect(refusedFor(az, "Gecə ekibi", refusal(400, "something new"))).toContain("something new");
  });
});

describe("doneFor", () => {
  it("names the subject of a confirmation too", () => {
    expect(doneFor(az, "Ayşe Sentetik", az("admin.passwordReset")))
      .toBe(az("admin.doneFor", { subject: "Ayşe Sentetik", text: az("admin.passwordReset") }));
    expect(doneFor(az, "", "x")).toBe("x");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/live/screens/admin/refusal.test.js 2>&1 | grep -E "Failed to resolve|Tests " | head -3
```
Expected: `Failed to resolve import "./refusal.js"`.

- [ ] **Step 3: Write it.** Create `dashboard/src/live/screens/admin/refusal.js`:

```javascript
// src/live/screens/admin/refusal.js — a refused administration write, as the administrator reads
// it on the toast. ONE copy, shared by the three tabs, for the reason `BoardState.jsx` exists on
// the clinical side: three tabs with a copy each is how three screens come to word the same
// refusal three ways.
//
// TWO RULES, BOTH LEARNED ON THE CLINICAL SCREENS.
//
//   * A REFUSAL GOES ON THE TOAST, never in a screen's own state, and never ALSO as an inline
//     `Alert`. The toast's provider sits above the router (`LiveApp`), so the refusal outlives a
//     move to another tab or another screen — a refusal held in a tab's state died with the tab,
//     and an administrator who clicked away mid-write saw no error at all and would reasonably
//     believe the write had landed. And `Alert` tone `crit` is itself a `role="alert"`, as is the
//     toast's error region, so showing both announces one refusal twice.
//
//   * A REFUSAL NAMES ITS SUBJECT. "Bu hesap başka bir kurumda da etkin…" read on the users tab
//     after moving to the roles tab tells an administrator that SOMETHING was refused and not
//     what, so she repeats the wrong action or none. The subject goes first and the reason after
//     it: the account, the group, the mapping row, the directory host — whatever the write was
//     earned on.
//
// `useToast()` IS the function (`ui/Toast.jsx` `value={toasts.add}`): there is no `.show`. Calling
// one on the clinical side was a Critical — a chart the server had taken told the clinician it had
// failed, in the literal text "toast.show is not a function".
import { apiErrorText } from "../../apiErrors.js";

/**
 * The one line a refused write puts on the toast: `<subject>: <reason>`.
 *
 * @param t        the translator (`useI18n().t`)
 * @param subject  what the write was about, already in words a reader knows — a user's full name,
 *                 a group's name, an AD group's own name. Never an id, never a key; an id is not
 *                 what an administrator was looking at.
 * @param err      the failure from the API client.
 */
export function refusedFor(t, subject, err) {
  const reason = apiErrorText(t, err);
  const named = String(subject ?? "").trim();
  // No subject (a write that belongs to the whole tab — the directory test, a reload): the reason
  // alone, rather than an empty prefix and a colon.
  return named ? t("admin.refusedFor", { subject: named, reason }) : reason;
}

/**
 * The same for a write that SUCCEEDED, so the two read alike: `<subject> · <what happened>`.
 * A confirmation that does not name its subject is the milder half of the same fault — an
 * administrator resetting four passwords in a row cannot tell which one the toast is about.
 */
export function doneFor(t, subject, text) {
  const named = String(subject ?? "").trim();
  return named ? t("admin.doneFor", { subject: named, text }) : text;
}
```

- [ ] **Step 4: Add the three strings.** The first two are **identical in all four languages** on purpose — they are a colon and a middle dot — which is why the next step lists them twice. The third, `savingFor`, is minted here and not in the users arm's Task 5 because **all three arms read it** (Decision 25): on a branch that had only the roles arm, a `savingFor` minted in Task 5 does not exist, the roles tab's announcement test and the static key net both fail, and the file none of the arms owns is the one that has to change. In `dashboard/src/live/i18n/strings/admin.js`, replace

```javascript
    retry: "Yeniden dene",
```

with

```javascript
    retry: "Yeniden dene",
    // Every administration write's refusal and confirmation names its subject first
    // (screens/admin/refusal.js). Punctuation only: the words come from the two halves.
    refusedFor: "{subject}: {reason}",
    doneFor: "{subject} · {text}",
    // A busy control reads only "unavailable" to a screen reader; the words that say WHICH
    // account, group or row is in flight come from an Announce region, named after its subject.
    savingFor: "{subject} · kaydediliyor…",
```

replace

```javascript
    retry: "Yenidən cəhd et",
```

with

```javascript
    retry: "Yenidən cəhd et",
    // Every administration write's refusal and confirmation names its subject first
    // (screens/admin/refusal.js). Punctuation only: the words come from the two halves.
    refusedFor: "{subject}: {reason}",
    doneFor: "{subject} · {text}",
    // A busy control reads only "unavailable" to a screen reader; the words that say WHICH
    // account, group or row is in flight come from an Announce region, named after its subject.
    savingFor: "{subject} · yadda saxlanılır…",
```

replace

```javascript
    retry: "Повторить",
```

with

```javascript
    retry: "Повторить",
    // Every administration write's refusal and confirmation names its subject first
    // (screens/admin/refusal.js). Punctuation only: the words come from the two halves.
    refusedFor: "{subject}: {reason}",
    doneFor: "{subject} · {text}",
    // A busy control reads only "unavailable" to a screen reader; the words that say WHICH
    // account, group or row is in flight come from an Announce region, named after its subject.
    savingFor: "{subject} · сохраняется…",
```

and replace

```javascript
    retry: "Try again",
```

with

```javascript
    retry: "Try again",
    // Every administration write's refusal and confirmation names its subject first
    // (screens/admin/refusal.js). Punctuation only: the words come from the two halves.
    refusedFor: "{subject}: {reason}",
    doneFor: "{subject} · {text}",
    // A busy control reads only "unavailable" to a screen reader; the words that say WHICH
    // account, group or row is in flight come from an Announce region, named after its subject.
    savingFor: "{subject} · saving…",
```

- [ ] **Step 5: List them.** In `dashboard/src/live/i18n/strings.test.js`, replace

```javascript
  // G1-12 (admin · users) · neutral
```

with

```javascript
  // admin (the frame, shared by the three tabs) · neutral
  "admin.refusedFor", //          "{subject}: {reason}"  — punctuation; the words are the halves'
  "admin.doneFor", //             "{subject} · {text}"   — the same

  // G1-12 (admin · users) · neutral
```

and replace

```javascript
  // G1-12 (admin · users) · az = tr
```

with

```javascript
  // admin (the frame, shared by the three tabs) · az = tr
  "admin.refusedFor", //     "{subject}: {reason}" — punctuation, no words of its own
  "admin.doneFor", //        "{subject} · {text}" — the same

  // G1-12 (admin · users) · az = tr
```

Both markers appear exactly once in the file (Task 1 gave `NEUTRAL`'s headings the `· neutral` suffix and `AZ_SAME_AS_TR`'s the `· az = tr` one for exactly this reason), and the new block goes **above** G1-12's, leaving every arm's anchor untouched.

- [ ] **Step 6: Run it**

```bash
npx vitest run src/live/screens/admin/refusal.test.js src/live/i18n/strings.test.js 2>&1 | grep -E "Tests "
```
Expected: `Tests  11 passed (11)` — `refusal` 5, `strings` 6.

- [ ] **Step 7: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  102 passed (102)`, `Tests  2157 passed (2157)` (+5), build clean.

- [ ] **Step 8: Commit**

```bash
git status --short
git add dashboard/src/live/screens/admin/refusal.js dashboard/src/live/screens/admin/refusal.test.js dashboard/src/live/i18n/strings/admin.js dashboard/src/live/i18n/strings.test.js
git commit -m "$(cat <<'EOF'
feat(dashboard): an administration refusal names its subject, on the toast

One copy for the three tabs, as the clinical screens have one BoardState: a
refusal held in a tab's own state dies with the tab, so an administrator who
clicked to another tab mid-write saw no error at all and would reasonably
believe the write had landed. And an unattributed refusal read after moving
says that something failed, not what -- so she repeats the wrong action or
none. Subject first, reason after it; never also an inline Alert, because
Alert crit and the toast's error region are both role="alert".

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** one new test file, 5 tests (`102 / 2157`), build clean.

---

### Task 4: The three-tab seam, and the sweep that can see three tabs

**Files:**
- Create: `dashboard/src/live/screens/admin/admin.testutil.js` + `admin.testutil.test.js`
- Modify: `dashboard/src/live/screens/admin/AdminScreen.jsx`, `AdminScreen.test.jsx`, `dashboard/src/live/i18n/strings.test.js`, `dashboard/src/live/rawKeys.test.jsx`

Everything here is shared by all three arms, and every item was found by building the tabs rather than by reading the frame. Two of the four would have broken a file no arm owns on the day the first arm merged (Decisions 20, 21, 22, 23).

- [ ] **Step 1: Measure the conflict before you fix it.** `AdminScreen.jsx`'s `TAB_SCREENS` has its three lines adjacent, although the Wave 3 plan's ownership table says every pre-placed line has a blank line on either side. Prove it:

```bash
cd /c/tmp/w3b-impl
git checkout -b seam-before-users
```
In `dashboard/src/live/screens/admin/AdminScreen.jsx` — the file need not import anything that exists yet; this branch is thrown away — the line

```jsx
// G1-12: import { UsersTab } from "./UsersTab.jsx";
```

becomes

```jsx
import { UsersTab } from "./UsersTab.jsx";
```

and the line

```jsx
  users: null,    // G1-12
```

becomes

```jsx
  users: UsersTab,    // G1-12
```

Commit (`git add dashboard/src/live/screens/admin/AdminScreen.jsx && git commit -m seam-users`). These two edits — and the seam edits in Step 10a — are written "*the line … becomes …*" rather than "*replace … with …*" on purpose: they are made on throw-away branches, and a mechanical replay of this task must not apply them to the real one. Then:

```bash
git checkout -b seam-before-roles feat/w3b-yonetim
```
In the same file the line

```jsx
// G1-13: import { RolesTab } from "./RolesTab.jsx";
```

becomes

```jsx
import { RolesTab } from "./RolesTab.jsx";
```

and the line

```jsx
  roles: null,    // G1-13
```

becomes

```jsx
  roles: RolesTab,    // G1-13
```

Commit the same way, and merge both:

```bash
git checkout -b seam-before-merge feat/w3b-yonetim
git merge --no-edit seam-before-users
git merge --no-edit seam-before-roles
```
Expected, on the **second** merge:
```
Auto-merging dashboard/src/live/screens/admin/AdminScreen.jsx
CONFLICT (content): Merge conflict in dashboard/src/live/screens/admin/AdminScreen.jsx
Automatic merge failed; fix conflicts and then commit the result.
```
Then clean up and go back:

```bash
git merge --abort
git checkout feat/w3b-yonetim
git branch -D seam-before-users seam-before-roles seam-before-merge
```

- [ ] **Step 2: Give the three lines their gaps.** In `dashboard/src/live/screens/admin/AdminScreen.jsx`, replace

```javascript
/** The component each tab shows in THIS build — `null` until its wave sets it. THIS is the line a
 *  wave edits, and only its own; `resetTabs` puts it back whatever a test stood in for. */
const TAB_SCREENS = Object.freeze({
  users: null,    // G1-12
  roles: null,    // G1-13
  source: null,   // G1-14
});
```

with

```javascript
/** The component each tab shows in THIS build — `null` until its wave sets it. THIS is the line a
 *  wave edits, and only its own; `resetTabs` puts it back whatever a test stood in for.
 *
 *  Each line has a BLANK LINE on either side, like the import block above, `i18n/catalog.js` and
 *  `shell/routes.js`'s `SCREENS`. The gaps are the whole mechanism: git merges line ranges, so
 *  three arms editing three ADJACENT lines of one object conflict on the second merge every time —
 *  which this block did until it was measured with `git merge` itself. Do not tidy them away. */
const TAB_SCREENS = Object.freeze({
  users: null, //    G1-12

  roles: null, //    G1-13

  source: null, //   G1-14
});
```

- [ ] **Step 3: Give G1-14's two markers a line to grow into.** In `dashboard/src/live/i18n/strings.test.js`, replace

```javascript
  // G1-14 (admin · login source) · neutral
]);
```

with

```javascript
  // G1-14 (admin · login source) · neutral

]);
```

and replace

```javascript
  // G1-14 (admin · login source) · az = tr
]);
```

with

```javascript
  // G1-14 (admin · login source) · az = tr

]);
```

This is `deferred.md`'s own item for this plan. Without the blank line, a branch adding an entry under the G1-14 marker and a branch appending a later wave's block both insert between the marker and `]);` — measured as a conflict, and clean with the gap.

- [ ] **Step 4: `onlyTabs`, because `stubTabs` cannot say what a build has.** In `dashboard/src/live/screens/admin/AdminScreen.jsx`, replace

```javascript
/** TEST ONLY — stand in for the tabs a later branch will build ({tabId: Component}); returns
 *  `resetTabs`, which an `afterEach` MUST call. The parallel branches of Wave 3 do NOT call this:
 *  each edits its own line in TAB_SCREENS above. */
export function stubTabs(screens) {
  testOnly("stubTabs");
  Object.assign(BUILT, screens);
  return resetTabs;
}
```

with

```javascript
/** TEST ONLY — stand in for the tabs a later branch will build ({tabId: Component}); returns
 *  `resetTabs`, which an `afterEach` MUST call. The parallel branches of Wave 3 do NOT call this:
 *  each edits its own line in TAB_SCREENS above.
 *
 *  It ASSIGNS, so a tab it does not name keeps whatever this build has. A test whose subject is
 *  WHICH tabs exist must use `onlyTabs` instead — see there. */
export function stubTabs(screens) {
  testOnly("stubTabs");
  Object.assign(BUILT, screens);
  return resetTabs;
}

/** TEST ONLY — the tab table reduced to `screens`: every tab this call does not name has NO
 *  component, whatever this build built.
 *
 *  Why it exists, and it is the same lesson `shell/screens.testutil.js` carries for the routes.
 *  `stubTabs` only assigns, so "this build has nothing to show" and "this build has only the roles
 *  tab" could not be SAID — they could only be true by accident, of a build with no tabs. Three of
 *  the frame's own tests were written that way, and all three broke the moment the first tab was
 *  built, in a file none of the three parallel branches owns: exactly the collision the two-line
 *  seam exists to prevent, reintroduced in the tests. A test that cares which tabs exist states it;
 *  one that does not uses the build and asserts through `openTabs` / `tabScreenOf`. */
export function onlyTabs(screens = {}) {
  testOnly("onlyTabs");
  const table = {};
  for (const tab of TABS) table[tab.id] = null;
  return stubTabs({ ...table, ...screens });
}
```

- [ ] **Step 5: Convert the frame's three build-dependent tests.** In `dashboard/src/live/screens/admin/AdminScreen.test.jsx`, replace

```jsx
import { AdminScreen, TABS, openTabs, resetTabs, stubTabs, tabScreenOf } from "./AdminScreen.jsx";
```

with

```jsx
import { AdminScreen, TABS, onlyTabs, openTabs, resetTabs, tabScreenOf } from "./AdminScreen.jsx";
```

replace the stand-in helper

```jsx
/** Stand-ins for the tabs, which are built on their own branches. The registry's own seam
 *  (`stubTabs`, as `shell/routes.js` has `stubScreens`): `ids` names which of the three this
 *  test's build has. */
function tabsBuilt(ids) {
  const stubs = {};
  for (const id of ids) {
    stubs[id] = ({ admin }) => <p>{`${id}: ${admin.data.users.length} / ${admin.data.groups.length}`}</p>;
  }
  return stubTabs(stubs);
}
```

with

```jsx
/** Stand-ins for the tabs, which are built on their own branches. `onlyTabs` — not `stubTabs` —
 *  because the subject of these tests is WHICH tabs exist: `ids` names the tabs this test's build
 *  has, and every other tab has none, whatever the real build built. With `stubTabs`, which only
 *  assigns, three of the tests below passed for a build with no tabs and broke the day the first
 *  one landed, in a file none of the three parallel branches owns. */
function tabsBuilt(ids) {
  const stubs = {};
  for (const id of ids) {
    stubs[id] = ({ admin }) => <p>{`${id}: ${admin.data.users.length} / ${admin.data.groups.length}`}</p>;
  }
  return onlyTabs(stubs);
}
```

and replace the seam's own test

```jsx
  it("the seam refuses outside the test build, and gives the build's tabs back", () => {
    tabsBuilt(["users"]);
    expect(tabScreenOf(TABS[0])).toBeTypeOf("function");
    resetTabs();
    expect(tabScreenOf(TABS[0])).toBeNull();
    vi.stubEnv("MODE", "production");
    try {
      expect(() => stubTabs({ users: () => null })).toThrow(/test seam/);
      expect(() => resetTabs()).toThrow(/test seam/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
```

with

```jsx
  it("the seam refuses outside the test build, and gives the build's tabs back", () => {
    // `onlyTabs` takes every tab away but the one it names; `resetTabs` hands the BUILD's tabs
    // back — whatever this build has, which is the point: the seam is not a second source of
    // truth about what was built.
    // Read, never pinned: which tabs THIS build has is the build's business, and a branch that
    // lands one must not have to edit this file.
    const asBuilt = TABS.map(tabScreenOf);
    onlyTabs({ roles: () => null });
    expect(tabScreenOf(TABS[1])).toBeTypeOf("function");
    expect(tabScreenOf(TABS[0])).toBeNull();
    resetTabs();
    expect(TABS.map(tabScreenOf)).toEqual(asBuilt);
    vi.stubEnv("MODE", "production");
    try {
      expect(() => onlyTabs({ users: () => null })).toThrow(/test seam/);
      expect(() => resetTabs()).toThrow(/test seam/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
```

`stubTabs` is no longer imported by this file; leave it exported — `onlyTabs` is built on it, and a future test that genuinely wants to add one tab to the build has it.

Run: `npx vitest run src/live/screens/admin/AdminScreen.test.jsx 2>&1 | grep -E "Tests "`
Expected: `Tests  19 passed (19)` — the same nineteen, now true of any build.

- [ ] **Step 6: The fixtures all three arms share.** Create `dashboard/src/live/screens/admin/admin.testutil.js`:

```javascript
// Test-only: synthetic `/admin`, `/admin/ldap` and `/scope` payloads, in the shapes the API really
// sends (homunculus-engine `admin/schemas.py`, `scope/schemas.py`). The administration equivalent
// of `data/board.testutil.js`, and here for the same reason: three tabs built on three parallel
// branches would otherwise each write their own fixtures, and three fixtures drift — a field spelt
// `member_count` in one and `memberCount` in another makes two tabs that disagree about what the
// server sends, with both suites green.
//
// NO REAL ACCOUNTS AND NO PATIENT DATA, EVER (CLAUDE.md hard rule 6). Staff are "Ayşe Sentetik",
// "Kamran Sintetik"; the hospital is "Sentetik Hastane"; units are REA-01 / NICU-01; AD objects
// live under DC=sentetik,DC=local. Nothing here may be replaced by anything from a real directory,
// a real export or a support capture, not even to reproduce a bug.
//
// Shapes are the API's, snake_case: these go through `rules.userFromApi` / `groupFromApi` /
// `scopeFromApi` exactly as an answer does. A builder that took the ADAPTED shape would let a tab
// pass its tests against a payload the server cannot send.
import { PERMISSION_KEYS } from "./catalogue.js";

/** A synthetic objectGUID: the directory's own id, which `POST /admin/ldap/import` parses as a
 *  UUID (`LdapImportIn.external_ids: list[uuid.UUID]`), so a fixture may not use "e-1". */
export const guid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** One group as `GroupOut` carries it. `slug` is positional — it is what a test varies, and what
 *  `groupKind` reads to call the group a role, an extra duty or the hospital's own. */
export function group(slug = "nurse", over = {}) {
  if (typeof slug !== "string") {
    throw new TypeError("group(slug, over): the slug is a string — group('nurse', {permissions: []})");
  }
  return {
    id: `g-${slug}`,
    slug,
    name: { nurse: "Hemşire", physician: "Hekim", charge_nurse: "Sorumlu hemşire", hospital_admin: "Sistem yöneticisi" }[slug] || slug,
    description: "",
    mfa_required: false,
    is_system: false,
    permissions: ["board.view", "alerts.ack"],
    member_count: 0,
    ...over,
  };
}

/** The system group, whose permissions the API reports as the WHOLE catalogue (`_group_out`). */
export const SYSTEM_GROUP = group("hospital_admin", {
  name: "Sistem yöneticisi", mfa_required: true, is_system: true,
  permissions: [...PERMISSION_KEYS].sort(), member_count: 1,
});

/** One account as `UserOut` carries it. `id` is positional. `groups` entries are `UserGroupOut`:
 *  `{id, slug, name, source}` where `source` is "manual" or "directory" — a directory-held
 *  membership is AD's and `PUT /users/{id}/groups` leaves it alone. */
export function user(id = "u-1", over = {}) {
  if (typeof id !== "string") {
    throw new TypeError("user(id, over): the id is a string — user('u-1', {groups: [member(group())]})");
  }
  return {
    id,
    username: "hs.aygun",
    email: "hs.aygun@sentetik.local",
    full_name: "Ayşe Sentetik",
    auth_source: "local",
    is_active: true,
    totp_enabled: false,
    last_login_at: "2026-10-10T07:12:00Z",
    must_change_password: false,
    groups: [],
    ...over,
  };
}

/** A membership link, from a group fixture. */
export const member = (g, source = "manual") => ({ id: g.id, slug: g.slug, name: g.name, source });

/** The permission catalogue as `/admin/permissions` serves it — the server's OWN descriptions,
 *  word for word (`auth/permissions.PERMISSIONS`). They are English developer prose, not the
 *  hospital's words, which is why the roles tab translates them by key (`strings/perms.js`) and
 *  shows these only as the `lang="en"` fallback for a key it does not know. The fixture carries
 *  them unchanged because a fixture that carried anything else would describe a payload the
 *  server cannot send; `admin.testutil.test.js` reads the backend and fails when they drift. */
export const PERMISSION_TEXTS = Object.freeze({
  "board.view": "See the live board, patient detail and the event stream",
  "alerts.ack": "Acknowledge or snooze an alert",
  "alerts.escalate": "Create an alert manually; escalate one",
  "admissions.view": "Read admissions and patient records",
  "admissions.admit": "Create an admission",
  "admissions.sign_off": "Physician sign-off of an admission",
  "admissions.move.initiate": "Initiate a transfer or discharge",
  "admissions.transfer.confirm": "Confirm a transfer arrival",
  "admissions.discharge.confirm": "Confirm a discharge; release the bed",
  "care_team.claim": "Claim a care-team role on a patient",
  "care_team.assign": "Assign others to a patient's care team",
  "handover.sign": "Sign or countersign a handover",
  "shifts.manage": "Create shift schedules",
  "break_glass.use": "Open, extend or close a break-glass session",
  "audit.view": "Read the audit trail",
  "users.manage": "Users: create, edit, activate, reset password or MFA, unlock an AD sign-in, set groups; search and import AD accounts, read the AD group mapping (changing the mapping needs every permission)",
  "groups.manage": "Groups and their permission sets",
  "structure.manage": "Tenant, site, unit, room and bed configuration",
  "devices.manage": "Device and research endpoints",
  "clinical.chart": "Chart clinician-observed inputs (infection suspicion, pressor, fluids, GCS…) and the patient's own baseline",
  "scores.sign": "Sign a severity-score form (SOFA) with corrections",
});
export const CATALOGUE = PERMISSION_KEYS.map((key) => ({ key, description: PERMISSION_TEXTS[key] }));

/** One user's scope as `ScopeView` carries it (`GET /scope/{id}`).
 *
 *  `unit_ids` / `bed_ids` are the RESOLVED, normalised sets — `build_scope` casefolds them — while
 *  `grants` carries the keys as they were stored. The editor shows the grants, not the resolved
 *  sets, which is why a fixture must be able to differ between the two. */
export function scopeView(over = {}) {
  const grants = over.grants ?? [];
  return {
    user_id: "u-1",
    role: "NURSE",
    unrestricted: false,
    reason: "assigned",
    unit_ids: grants.filter((g) => g.unit_id).map((g) => String(g.unit_id).toLowerCase()).sort(),
    bed_ids: grants.filter((g) => g.bed_id).map((g) => String(g.bed_id).toLowerCase()).sort(),
    ...over,
    grants: grants.map((g, i) => ({
      id: `sg-${i}`, unit_id: "", bed_id: "", is_active: true, granted_by_id: "u-admin",
      created_at: "2026-10-01T09:00:00Z", revoked_at: null, ...g,
    })),
  };
}

/** The scope of a desk that MAY assign one (`reason: "role"`), and of one that may not. */
export const SCOPE_ADMIN = scopeView({ user_id: "u-admin", role: "HOSPITAL_ADMIN", unrestricted: true, reason: "role" });
export const SCOPE_UNASSIGNED = scopeView({ unrestricted: true, reason: "unassigned" });

// ---------------------------------------------------------------- the directory

export const ldapStatus = (over = {}) => ({
  // `url_host` is the HOST ONLY (`auth/ldap.py`: `parts.hostname`) — no port, no scheme, no DN.
  configured: true, url_host: "dc01.sentetik.local",
  last_test_at: "2026-10-11T06:00:00Z", last_test_ok: true, ...over,
});

/** One AD account as the search reports it (`LdapUserOut`). */
export function ldapUser(n = 1, over = {}) {
  return {
    external_id: guid(n), username: `hs.sintetik${n}`, upn: `hs.sintetik${n}@sentetik.local`,
    email: `hs.sintetik${n}@sentetik.local`, display_name: `Kamran Sintetik ${n}`,
    dn: `CN=Kamran Sintetik ${n},OU=Personel,DC=sentetik,DC=local`,
    disabled: false, already_imported: false, ...over,
  };
}

export const ldapGroup = (over = {}) => ({
  dn: "CN=YB-Hemsire,OU=Gruplar,DC=sentetik,DC=local", name: "YB-Hemsire", ...over,
});

/** One row of the AD group → our group table (`LdapMappingOut`). */
export const mapping = (over = {}) => ({
  id: "m-1", ad_group_dn: "CN=YB-Hemsire,OU=Gruplar,DC=sentetik,DC=local",
  group_id: "g-nurse", group_slug: "nurse", group_name: "Hemşire",
  created_at: "2026-10-02T10:00:00Z", ...over,
});

// ---------------------------------------------------------------- a whole desk

export const NURSE_GROUP = group("nurse", { member_count: 4 });
export const WARD_GROUP = group("gece_ekibi", { name: "Gece ekibi", permissions: ["board.view"], member_count: 2 });

/** The accounts a tab's test lists by default: a local nurse who must still change her password, a
 *  directory account, and one whose group this answer does not describe — the row whose rights are
 *  UNKNOWN, which must read as "not decided" and never as "nothing". */
export const USERS = [
  user("u-nurse", { groups: [member(NURSE_GROUP)], must_change_password: true }),
  user("u-ad", {
    username: "dr.kamran", full_name: "Kamran Sintetik", email: null, auth_source: "ldap",
    totp_enabled: true, last_login_at: null, groups: [member(NURSE_GROUP, "directory")],
  }),
  user("u-stranger", {
    username: "hs.gece", full_name: "Gecə Sintetik", groups: [{ id: "g-?", slug: "?", name: "?", source: "manual" }],
  }),
];
export const GROUPS = [SYSTEM_GROUP, NURSE_GROUP, WARD_GROUP];

/**
 * Stub every READ the three tabs make, with the fixtures above. `over` replaces any of them:
 *
 *   ADMIN_READS(api, { ldapStatus: { configured: false } })
 *
 * Writes are not stubbed: a test that expects a write states what the server answers, because what
 * a write answers is the thing it is testing.
 */
export function ADMIN_READS(api, over = {}) {
  const value = (name, fallback) => (name in over ? over[name] : fallback);
  api.adminUsers.mockResolvedValue(value("adminUsers", USERS));
  api.adminGroups.mockResolvedValue(value("adminGroups", GROUPS));
  api.adminPermissions.mockResolvedValue(value("adminPermissions", CATALOGUE));
  api.unassignedScopes.mockResolvedValue(value("unassignedScopes", { tenant: "sentetik", unassigned_users: 2 }));
  api.myScope.mockResolvedValue(value("myScope", SCOPE_ADMIN));
  api.userScope.mockResolvedValue(value("userScope", scopeView({ grants: [{ unit_id: "REA-01" }] })));
  api.ldapStatus.mockResolvedValue(value("ldapStatus", ldapStatus()));
  api.ldapMappings.mockResolvedValue(value("ldapMappings", [mapping()]));
  api.ldapSearch.mockResolvedValue(value("ldapSearch", [ldapUser(1), ldapUser(2, { disabled: true })]));
  api.ldapGroups.mockResolvedValue(value("ldapGroups", [ldapGroup()]));
  return api;
}
```

`PERMISSION_TEXTS` is the server's own ENGLISH, word for word — not a Turkish rendering of it. A fixture that carries anything but what the server sends describes a payload the server cannot send, and the roles tab's translation-by-key (Decision 13) is tested against exactly this: the screen must show the dashboard's text and not these.

- [ ] **Step 6a: Hold the fixtures to the backend.** Create `dashboard/src/live/screens/admin/admin.testutil.test.js`:

```javascript
// The fixtures are only worth having if they are the API's shapes: this holds them to the backend
// the way `catalogue.test.js` holds the permission mirror. (A test may read outside `src/live/` —
// boundaries.test.js checks the sources, not the tests.)
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERMISSION_KEYS } from "./catalogue.js";
import { CATALOGUE, PERMISSION_TEXTS, group, guid, ldapStatus, user } from "./admin.testutil.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY = fs.readFileSync(
  path.resolve(HERE, "../../../../../homunculus-engine/src/homunculus/auth/permissions.py"), "utf8",
);

/** `PERMISSIONS: dict[str, str] = { "key": "description", … }`, with Python's adjacent-string
 *  concatenation folded, so a description split over two source lines reads as one. */
function backendDescriptions() {
  const block = /PERMISSIONS: dict\[str, str\] = \{([\s\S]*?)\n\}/.exec(PY);
  expect(block, "PERMISSIONS block").not.toBeNull();
  const out = {};
  for (const m of block[1].matchAll(/^\s{4}"([\w.]+)":\s*((?:"(?:[^"\\]|\\.)*"\s*)+),/gm)) {
    out[m[1]] = [...m[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((q) => q[1]).join("");
  }
  return out;
}

describe("the administration fixtures are the API's own shapes", () => {
  it("the permission descriptions are the server's, word for word", () => {
    // A fixture that said anything else would let a tab pass its tests against a payload the
    // server cannot send. The first draft of this fixture was Turkish: every roles test passed
    // against text the server has never served.
    const backend = backendDescriptions();
    expect(Object.keys(backend).length).toBe(PERMISSION_KEYS.length);
    for (const key of PERMISSION_KEYS) expect(PERMISSION_TEXTS[key], key).toBe(backend[key]);
    expect(CATALOGUE.map((row) => row.key)).toEqual([...PERMISSION_KEYS]);
    expect(CATALOGUE.every((row) => typeof row.description === "string" && row.description.length > 0)).toBe(true);
  });

  it("the directory's status carries the host only", () => {
    // `auth/ldap.py`: `url_host` is `parts.hostname` — no scheme, no port, and never a DN.
    expect(ldapStatus().url_host).toBe("dc01.sentetik.local");
    expect(ldapStatus().url_host).not.toMatch(/:|\/|=/);
  });

  it("the builders are positional and refuse the other shape", () => {
    expect(() => group({ slug: "nurse" })).toThrow(TypeError);
    expect(() => user({ id: "u-1" })).toThrow(TypeError);
  });

  it("an external id is a UUID, as POST /admin/ldap/import requires", () => {
    expect(guid(7)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(guid(7)).not.toBe(guid(8));
  });
});
```

Run: `npx vitest run src/live/screens/admin/admin.testutil.test.js 2>&1 | grep -E "Tests "`
Expected: `Tests  4 passed (4)`. The first of the four reads `auth/permissions.py` as text, so a description changed on the server fails here and the fixture is corrected rather than drifting.

- [ ] **Step 7: Teach the raw-key sweep to see three tabs, and to know a permission key from a translation key.**

In `dashboard/src/live/rawKeys.test.jsx`, make five changes.

**(a)** The imports — `fs`/`path` for the new static net, `fireEvent` for the tab walk, the catalogue for `PERMS`, the dictionaries for the net, and the shared fixtures. Replace

```jsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, screen } from "@testing-library/react";
import { ThemeProvider } from "./theme/ThemeProvider.jsx";
import { mount } from "./session/mount.testutil.jsx";
import { profile, token } from "./session/testTokens.testutil.js";
import { NAMESPACES } from "./i18n/catalog.js";
import { ROUTES, hashPath, resetScreens, screenOf } from "./shell/routes.js";
import { Shell } from "./shell/Shell.jsx";
import { NOW, ago, alarm, board, entry, identity, news2, reading } from "./data/board.testutil.js";
```

with

```jsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { ThemeProvider } from "./theme/ThemeProvider.jsx";
import { mount } from "./session/mount.testutil.jsx";
import { profile, token } from "./session/testTokens.testutil.js";
import { DICTIONARIES, NAMESPACES } from "./i18n/catalog.js";
import { LANG_CODES } from "./i18n/langs.js";
import { ROUTES, hashPath, resetScreens, screenOf } from "./shell/routes.js";
import { Shell } from "./shell/Shell.jsx";
import { PERMISSION_KEYS } from "./screens/admin/catalogue.js";
import { NOW, ago, alarm, board, entry, identity, news2, reading } from "./data/board.testutil.js";
import { ADMIN_READS } from "./screens/admin/admin.testutil.js";

/** `src/live/` on disk. (Paths with node:path: under jsdom the global URL is jsdom's, which
 *  fileURLToPath refuses — the note apiErrors.test.js carries.) */
const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
```

**(b)** `PERMS` becomes the catalogue. Replace

```jsx
/** Every right Group 1 knows, so the sweep is not stopped at a screen by a missing permission —
 *  and so no CONTROL a right unlocks is left outside the net. `clinical.chart` was missing, so the
 *  patient screen rendered only the "you may not chart this" sentence and the five strings of the
 *  charting control itself (`patient.chartTitle|chartNote|chartYes|chartNo|chartSaving`) were
 *  never swept: a permission omitted here is a whole region of the UI this file silently does not
 *  cover, which is the opposite of what it exists for. */
const PERMS = ["board.view", "alerts.ack", "clinical.chart", "users.manage", "groups.manage"];
```

with

```jsx
/** Every right Group 1 knows — the mirrored catalogue itself, not a list written out here — so the
 *  sweep is not stopped at a screen by a missing permission, and so no CONTROL a right unlocks is
 *  left outside the net. `clinical.chart` was missing once, and the patient screen then rendered
 *  only the "you may not chart this" sentence while the five strings of the charting control
 *  (`patient.chartTitle|chartNote|chartYes|chartNo|chartSaving`) were never swept: a permission
 *  omitted here is a whole region of the UI this file silently does not cover, which is the
 *  opposite of what it exists for.
 *
 *  The administration surface made the list itself the only safe answer. Its group-mapping
 *  controls are drawn only for a desk that holds the WHOLE catalogue (the server's own rule,
 *  `admin/ldap_service._full_administrator`, 403 otherwise) — so `users.manage` and
 *  `groups.manage` are not enough, and no fixed list of three or five rights ever would be: a
 *  right added to `auth/permissions.py` would silently close the mapping panel to this sweep. */
const PERMS = [...PERMISSION_KEYS];
```

**(c)** A permission key is exempt from the detector. Replace

```jsx
/** A file this interface names is not a key, whatever its first word is (`api/board.py`). */
const A_FILE = /\.(?:js|jsx|ts|tsx|py|json|md|css|html)$/i;
```

with

```jsx
/** A file this interface names is not a key, whatever its first word is (`api/board.py`). */
const A_FILE = /\.(?:js|jsx|ts|tsx|py|json|md|css|html)$/i;
/** A PERMISSION key is not a translation key, and two of them are namespace-shaped: `board.view`
 *  and `board.py` share a first word with the `board` namespace. The roles table prints every key
 *  of the catalogue on purpose, under the server's own description — it is what an administrator
 *  searches that table by and what a support call quotes, which is why `apiErrors.js` leaves them
 *  untranslated inside `errors.permissionRequired` and `admin.beyond` too. Only the EXACT keys of
 *  the catalogue are exempt, so a real `board.news2` left raw is still caught. Found by this
 *  file's own tab-walking sweep the first time the roles tab was built. */
const PERMISSION_KEY = new Set(PERMISSION_KEYS);
```

and inside `rawKeys`, replace

```jsx
    for (const match of text.matchAll(KEY_SHAPE)) if (!A_FILE.test(match[0])) found.add(match[0]);
```

with

```jsx
    for (const match of text.matchAll(KEY_SHAPE)) {
      if (!A_FILE.test(match[0]) && !PERMISSION_KEY.has(match[0])) found.add(match[0]);
    }
```

In the detector's own test, add the roles table's cells to the fixture and the one key that must still be caught — replace

```jsx
      "<p lang=\"ru\">«alerts.ack» · 4.07 · 09:58 · мм рт. ст. · board.py</p>",
      "<button aria-label=\"board.escalated\">·</button>",
    ].join("");
    expect(rawKeys(root).sort()).toEqual(["beds.identityPending", "board.escalated", "news2.missing.spo2"]);
```

with

```jsx
      "<p lang=\"ru\">«alerts.ack» · 4.07 · 09:58 · мм рт. ст. · board.py</p>",
      // The roles table's own cells: the catalogue's keys, printed on purpose. `board.view` is
      // namespace-shaped and still not a translation key; `board.news2` is one and is caught.
      "<span>board.view</span><span>clinical.chart</span><span>board.news2</span>",
      "<button aria-label=\"board.escalated\">·</button>",
    ].join("");
    expect(rawKeys(root).sort()).toEqual([
      "beds.identityPending", "board.escalated", "board.news2", "news2.missing.spo2",
    ]);
```

(The fixture uses `<span>`s, not `<td>`s: a `<td>` outside a table is dropped by the parser and the three keys end up in **one** text node, which the detector then reports as the single string `board.viewclinical.chartboard.news2`. Measured.)

**(d)** The sweep stubs the administration reads and walks every tab. In `openAt`, replace

```jsx
    setup: (api) => {
      api.boardPatients.mockResolvedValue(PAYLOAD);
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
    },
  });
```

with

```jsx
    setup: (api) => {
      api.boardPatients.mockResolvedValue(PAYLOAD);
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      // The administration screen reads four more routes before it draws a row. Unstubbed they
      // resolve `undefined`, every list comes out empty, and the sweep walks three tabs that each
      // say only "nothing matches" — green, and covering none of the strings this file exists for.
      ADMIN_READS(api);
    },
  });
```

and in the sweep itself, after the line that collects the screen's own keys, insert the walk — replace

```jsx
      for (const key of rawKeys(document.body)) offenders.push(`${route.id} (${path}) → ${key}`);
      visited.push(route.id);
```

with

```jsx
      for (const key of rawKeys(document.body)) offenders.push(`${route.id} (${path}) → ${key}`);
      // A TABBED screen shows one panel at a time, so arriving at it sweeps the FIRST tab and
      // nothing else: the administration screen's roles and login-source tabs — two whole
      // namespaces, built on their own branches — would have sat outside this net while it
      // reported the screen covered. Every tab is clicked and its panel swept. `role="tab"` is
      // read again after each click: the list may be rebuilt.
      for (let at = 0; at < screen.queryAllByRole("tab").length; at += 1) {
        const tab = screen.queryAllByRole("tab")[at];
        const name = tab.textContent;
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { fireEvent.click(tab); await settle(); });
        for (const key of rawKeys(document.body)) offenders.push(`${route.id} (${path}) · ${name} → ${key}`);
        visited.push(`${route.id}:${at}`);
      }
      visited.push(route.id);
```

**(e)** The static net, for the text a sweep cannot reach. It goes at the very end of the file, after the closing `});` of the existing `describe` — so replace

```jsx
    act(() => { mounted.board.clear(); });
  });
});
```

with

```jsx
    act(() => { mounted.board.clear(); });
  });
});

// ── The same guarantee for the text the sweep above cannot reach ───────────────────────────────
//
// The sweep renders; it therefore covers only what a payload and a few clicks reach. A dialog's
// title, a confirmation's sentence, the words under a refused field — the administration tabs put
// a great deal of their copy exactly there, and no fixture opens every dialog of every tab. So the
// keys are checked WITHOUT rendering: every `t("ns.key")` a live source names as a plain string
// literal must exist in all four languages. It cannot see a key built at run time (`t(\`x.${y}\`)`
// — which is why the live code does not build them), and it says nothing about whether the text is
// RIGHT; it catches the whole class of "this key was renamed, moved or never written", which is
// what printed `beds.identityPending` into a clinical card twice in Wave 3.
describe("every key the live sources name exists in all four languages", () => {
  const LIVE = path.join(HERE, "live");
  /** Every `.js`/`.jsx` under src/live/ that ships — tests and test utilities excluded: a test may
   *  legitimately name a key that does not exist (this file's own detector fixture does). */
  function sources(dir) {
    const out = [];
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) out.push(...sources(full));
      else if (/\.jsx?$/.test(item.name) && !/\.test\.jsx?$/.test(item.name) && !/\.testutil\.jsx?$/.test(item.name)) out.push(full);
    }
    return out;
  }
  const FILES = sources(LIVE);
  /** `t("ns.key"` and `labelKey: "ns.key"` — the two ways this UI names a text. */
  const NAMED = /(?:\bt\(\s*|labelKey:\s*|textKey:\s*)"([a-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9_.]*)"/g;

  it("found sources to read, and the reader recognises both ways a key is named", () => {
    expect(FILES.length).toBeGreaterThan(40);
    const sample = 'const a = t("admin.title"); const b = { labelKey: "admin.tabUsers" };';
    expect([...sample.matchAll(NAMED)].map((m) => m[1])).toEqual(["admin.title", "admin.tabUsers"]);
  });

  it("names no key the dictionaries do not have", () => {
    const missing = [];
    for (const file of FILES) {
      const text = fs.readFileSync(file, "utf8");
      for (const [, key] of text.matchAll(NAMED)) {
        if (!Object.keys(NAMESPACES).includes(key.split(".")[0])) continue;  // not one of ours
        for (const lang of LANG_CODES) {
          if (!(key in DICTIONARIES[lang])) missing.push(`${path.relative(LIVE, file)} → ${lang} ${key}`);
        }
      }
    }
    expect(missing, `a live source names a key no dictionary has:\n${missing.join("\n")}`).toEqual([]);
  });
});
```

Run: `npx vitest run src/live/rawKeys.test.jsx 2>&1 | grep -E "Tests "`
Expected: `Tests  5 passed (5)`.

- [ ] **Step 7a: Prove the static net catches something.** Temporarily rename one key in `AdminScreen.jsx` — change `t("admin.noAccess")` to `t("admin.noAccessYet")` — and run the file again. Expected: **two** failures, and this in the output:

```
a live source names a key no dictionary has:
screens\admin\AdminScreen.jsx → az admin.noAccessYet
screens\admin\AdminScreen.jsx → tr admin.noAccessYet
screens\admin\AdminScreen.jsx → ru admin.noAccessYet
screens\admin\AdminScreen.jsx → en admin.noAccessYet
```
Put the key back and confirm `Tests  5 passed (5)`.

- [ ] **Step 8: Gate** (the seam proof follows the commit — see Step 10a — because it creates branches from `HEAD`, and before the commit `HEAD` is Task 3's tree: the throw-away branches would revert this task's own work and the proof would prove nothing)

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  103 passed (103)`, `Tests  2163 passed (2163)` (+6: `rawKeys` 3 → 5, `admin.testutil.test.js` 4), build clean. `admin.testutil.js` itself adds no test file — it is a `.testutil.js` and Vitest does not collect it; its test file is the one new file.

- [ ] **Step 9: Commit**

```bash
git status --short
git add dashboard/src/live/screens/admin/AdminScreen.jsx dashboard/src/live/screens/admin/AdminScreen.test.jsx dashboard/src/live/screens/admin/admin.testutil.js dashboard/src/live/screens/admin/admin.testutil.test.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/rawKeys.test.jsx
git commit -m "$(cat <<'EOF'
test(dashboard): the seam the three administration tabs branch off, measured

TAB_SCREENS had its three lines adjacent although the ownership table said
otherwise: the second arm's merge conflicted, measured with git merge, and
with a blank line either side three arms merge clean in both orders. G1-14's
markers abutted the closing ]); in both of strings.test.js's Sets, which
deferred.md had flagged for this plan -- also measured, also fixed.

stubTabs can only ASSIGN, so three of the frame's own tests asserted things
true only of a build with no tabs and broke the day the first tab landed, in a
file no arm owns: onlyTabs() sets the whole table, as screens.testutil.js
already does for the routes. And the raw-key sweep now walks every tab -- it
was covering the first panel and reporting the screen done -- with the
catalogue's own keys exempt from the detector, plus the systemic net the Wave 3
fix-up left open: every key a live source names must exist in four languages,
which covers the dialogs no fixture opens.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 10a: Prove the seam, with git, in both merge orders — AFTER the commit.** Three throw-away branches from the commit just made, each doing exactly what one arm will do to the three shared files. (In the first draft this step sat before the commit: `git checkout -b seam-users seam-base` then reverted this task's uncommitted `AdminScreen.jsx` to Task 3's version, the gapped anchors were absent, the branches committed nothing, and after the clean-up the tree had lost the gaps and `onlyTabs` while the test still imported it — reproduced with a real repository before it was moved.)

```bash
cd /c/tmp/w3b-impl
git status --short            # must be EMPTY: the seam branches start from the commit
git branch seam-base
for arm in users roles source; do git checkout -q -b "seam-$arm" seam-base; done
```
On `seam-users` (`git checkout -q seam-users`), in `dashboard/src/live/screens/admin/AdminScreen.jsx` the line

```jsx
// G1-12: import { UsersTab } from "./UsersTab.jsx";
```

becomes

```jsx
import { UsersTab } from "./UsersTab.jsx";
```

and the line

```jsx
  users: null, //    G1-12
```

becomes

```jsx
  users: UsersTab, //    G1-12
```

then `git add dashboard/src/live/screens/admin/AdminScreen.jsx && git commit -q -m seam-users`.

On `seam-roles` (`git checkout -q seam-roles`), in the same file the line

```jsx
// G1-13: import { RolesTab } from "./RolesTab.jsx";
```

becomes

```jsx
import { RolesTab } from "./RolesTab.jsx";
```

and the line

```jsx
  roles: null, //    G1-13
```

becomes

```jsx
  roles: RolesTab, //    G1-13
```

in `dashboard/src/live/i18n/catalog.js` the line

```javascript
// G1-13: import roles from "./strings/roles.js";
```

becomes

```javascript
import roles from "./strings/roles.js";
```

and the line

```javascript
  // G1-13: roles,
```

becomes

```javascript
  roles,
```

and in `dashboard/src/live/i18n/strings.test.js` the line

```javascript
  // G1-13 (admin · roles) · neutral
```

becomes

```javascript
  // G1-13 (admin · roles) · neutral
  "roles.demoNeutral",
```

and the line

```javascript
  // G1-13 (admin · roles) · az = tr
```

becomes

```javascript
  // G1-13 (admin · roles) · az = tr
  "roles.demoAz",
```

then `git add dashboard/src/live/screens/admin/AdminScreen.jsx dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js && git commit -q -m seam-roles`.

On `seam-source` (`git checkout -q seam-source`): the same six replacements with `G1-14` / `SourceTab` / `./SourceTab.jsx` / `source` / `./strings/source.js` / `source.demoNeutral` / `source.demoAz` — the lines are `// G1-14: import { SourceTab } from "./SourceTab.jsx";`, `  source: null, //   G1-14`, `// G1-14: import source from "./strings/source.js";`, `  // G1-14: source,`, `  // G1-14 (admin · login source) · neutral` and `  // G1-14 (admin · login source) · az = tr` — then add the three files and commit `seam-source`.

Then merge, both ways round:

```bash
git checkout -q -b seam-merge-a seam-base
for a in users roles source; do git merge --no-edit "seam-$a"; done
git status --short
git checkout -q -b seam-merge-b seam-base
for a in source roles users; do git merge --no-edit "seam-$a"; done
git status --short
```
Expected, for **both**: `Fast-forward`, then `Merge made by the 'ort' strategy.` twice, and an **empty** `git status --short`. Check the result:

```bash
sed -n '/^const TAB_SCREENS/,/^});/p' dashboard/src/live/screens/admin/AdminScreen.jsx
grep -c "demoNeutral\|demoAz" dashboard/src/live/i18n/strings.test.js
```
Expected: all three `TAB_SCREENS` lines set with their blank lines intact, and `4`.

Clean up, and confirm the tree is what Step 9 committed:

```bash
git checkout -q feat/w3b-yonetim
git branch -D seam-base seam-users seam-roles seam-source seam-merge-a seam-merge-b
git status --short
grep -c "onlyTabs" dashboard/src/live/screens/admin/AdminScreen.jsx
```
Expected: an empty status and `2` (the export and its own doc comment).

**Gate:** `rawKeys.test.jsx` 3 → 5, `admin.testutil.test.js` 4; `103 / 2163` (+6); build clean; the seam proved by `git merge` in both orders with an empty `git status`.

**After this task the three arms are independent.** Each is built in its own worktree off this commit — one worktree with three branches would make them sequential:

```bash
git -C /c/tmp/w3b-impl worktree add -b feat/w3b-users  /c/tmp/w3b-users  feat/w3b-yonetim   # Tasks 5-7
git -C /c/tmp/w3b-impl worktree add -b feat/w3b-roles  /c/tmp/w3b-roles  feat/w3b-yonetim   # Tasks 8-9
git -C /c/tmp/w3b-impl worktree add -b feat/w3b-source /c/tmp/w3b-source feat/w3b-yonetim   # Tasks 10-11
```
Each gets the `node_modules` junction the way Task 0 made it (`cmd //c "mklink /J node_modules C:\tmp\homunculus-g1\dashboard\node_modules"` from `<worktree>/dashboard`); never `npm install`.

---

# G1-12 · the users arm (Tasks 5–7, branch `feat/w3b-users`)

### Task 5: The eight strings the users tab needs and the frame did not have

**Files:**
- Modify: `dashboard/src/live/i18n/strings/admin.js`

Task 1 brought the `admin.*` namespace with the frame, written from the prototype's dictionary. Building the tab against the real API needed eight more, and seven of the eight exist because of Decisions 5, 6, 8 and 26 — they are the sentences that say what the screen does **not** know. (`admin.savingFor`, which every arm reads, was minted in Task 3.)

- [ ] **Step 1: Add them.** Each language's block goes immediately **before** that language's `remove:` line, which is the last key in its block. In `dashboard/src/live/i18n/strings/admin.js`, replace

```javascript
    remove: "Kaldır",
```

with

```javascript
    unitsNotRead: "Okunmadı",
    scopeUnassignedUnknown: "Hiç atama yapılmamış kullanıcı sayısı okunamadı.",
    wholeList: "Bu liste hastanedeki {count} hesabın tamamını tek istekte yükler; arama ve süzme tarayıcıda yapılır. Hesap sayısı büyüdükçe sunucu tarafında sayfalama gerekir.",
    filtered: "{total} hesabın {shown} tanesi gösteriliyor.",
    showMore: "{count} satır daha göster",
    scopeMayUnknown: "Kapsam atama yetkiniz henüz okunamadı; kaydetme sunulmuyor.",
    scopeBoardUnknown: "Pano şu anda okunamıyor; seçenekler yalnız kullanıcının mevcut atamalarından geliyor.",
    remove: "Kaldır",
```

replace

```javascript
    remove: "Götür",
```

with

```javascript
    unitsNotRead: "Oxunmayıb",
    scopeUnassignedUnknown: "Heç bir təyinatı olmayan istifadəçilərin sayı oxunmadı.",
    wholeList: "Bu siyahı xəstəxanadaki {count} hesabın hamısını bir sorğuda yükləyir; axtarış və süzgəc brauzerdə işləyir. Hesab sayı artdıqca server tərəfində səhifələmə lazım olacaq.",
    filtered: "{total} hesabdan {shown} göstərilir.",
    showMore: "{count} sətir daha göstər",
    scopeMayUnknown: "Əhatə təyin etmək səlahiyyətiniz hələ oxunmadı; yadda saxlama təklif edilmir.",
    scopeBoardUnknown: "Panel hazırda oxunmur; seçimlər yalnız istifadəçinin mövcud təyinatlarından gəlir.",
    remove: "Götür",
```

replace

```javascript
    remove: "Убрать",
```

with

```javascript
    unitsNotRead: "Не прочитано",
    scopeUnassignedUnknown: "Число пользователей без назначений прочитать не удалось.",
    wholeList: "Этот список загружает все {count} учётных записей больницы одним запросом; поиск и фильтр работают в браузере. С ростом числа записей потребуется разбивка на страницы на сервере.",
    filtered: "Показано {shown} из {total} записей.",
    showMore: "Показать ещё {count} строк",
    scopeMayUnknown: "Право назначать область пока не прочитано; сохранение не предлагается.",
    scopeBoardUnknown: "Панель сейчас недоступна; варианты взяты только из текущих назначений пользователя.",
    remove: "Убрать",
```

and replace

```javascript
    remove: "Remove",
```

with

```javascript
    unitsNotRead: "Not read",
    scopeUnassignedUnknown: "The number of users with no assignment at all could not be read.",
    wholeList: "This list loads all {count} accounts in the hospital in one request; the search and the filter run in the browser. As the number grows, pagination on the server will be needed.",
    filtered: "Showing {shown} of {total} accounts.",
    showMore: "Show {count} more rows",
    scopeMayUnknown: "Whether you may assign a scope has not been read yet; saving is not offered.",
    scopeBoardUnknown: "The board cannot be read just now; the options come only from this user's existing assignments.",
    remove: "Remove",
```

- [ ] **Step 1a: The eighth: a 2FA cell that does not know.** The row's actions already read "rights unknown" for a user one of whose groups is not in the list (`canManageUser`); the 2FA cell used to say "off" beside that — a confident claim about a rule the screen cannot see. In `dashboard/src/live/i18n/strings/admin.js`, replace

```javascript
    mfaRequired: "Zorunlu · kurulmadı",
```

with

```javascript
    mfaRequired: "Zorunlu · kurulmadı",
    mfaUnknown: "Bilinmiyor · grubu listede yok",
```

replace

```javascript
    mfaRequired: "Məcburi · qurulmayıb",
```

with

```javascript
    mfaRequired: "Məcburi · qurulmayıb",
    mfaUnknown: "Bilinmir · qrupu siyahıda yoxdur",
```

replace

```javascript
    mfaRequired: "Обязательно · не настроено",
```

with

```javascript
    mfaRequired: "Обязательно · не настроено",
    mfaUnknown: "Неизвестно · группы нет в списке",
```

and replace

```javascript
    mfaRequired: "Required · not set up",
```

with

```javascript
    mfaRequired: "Required · not set up",
    mfaUnknown: "Unknown · its group is not in the list",
```

Note what each one is for, because a reviewer will ask: `unitsNotRead` is Decision 6 (a cell that has read nothing claims nothing); `scopeUnassignedUnknown` is Decision 26 on the one number that says whether the scope matrix was ever filled in; `wholeList` is Decision 5's visible handover note; `filtered` is the search saying how much it hides; `showMore` is the 50-row bound; `scopeMayUnknown` is Decision 8's third state; `scopeBoardUnknown` is the scope editor admitting its options are short because the board could not be read; `mfaUnknown` is Decision 26 again, on the 2FA cell.

- [ ] **Step 2: Check the parity and the scripts**

```bash
npx vitest run src/live/i18n/strings.test.js 2>&1 | grep -E "Tests "
```
Expected: `Tests  6 passed (6)`. None of the eight needs a `NEUTRAL` or `AZ_SAME_AS_TR` entry: each differs between Azerbaijani and Turkish, and each Russian text carries Cyrillic.

- [ ] **Step 3: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: unchanged — `Test Files  103 passed (103)`, `Tests  2163 passed (2163)`, build clean. Nothing reads the new keys yet.

- [ ] **Step 4: Commit**

```bash
git status --short
git add dashboard/src/live/i18n/strings/admin.js
git commit -m "$(cat <<'EOF'
feat(dashboard): the eight sentences the users tab needs to say what it does not know

Seven of the eight exist because the screen cannot know something: there is no
bulk scope read, so a units cell that has read nothing says so; /scope/unassigned
may not have answered, and a zero there would be a claim; a user whose group is
not in the list has a 2FA rule the screen cannot see, so the cell says unknown
and never "off"; GET /admin/users is unbounded, so the tab says out loud that it
loaded the whole hospital.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** `103 / 2163` unchanged, `strings.test.js` green at 6.

---

### Task 6: The two dialogs the users tab opens

**Files:**
- Create: `dashboard/src/live/screens/admin/UserForm.jsx`, `dashboard/src/live/screens/admin/ScopeEditor.jsx`

No test files of their own: neither is reachable except through the tab, and a test of one in isolation would need a host component that is the tab. Task 7's test covers every branch of both — the form's five fields, its three group kinds, its disabled-and-named groups, its 422 handling and the password that must not survive; the editor's unrestricted case, its three sources of keys, its manual field, its replacement write, its rollback and its three-valued Save. They are written first because the tab imports them.

- [ ] **Step 1: Write the form.** Create `dashboard/src/live/screens/admin/UserForm.jsx`:

```jsx
// src/live/screens/admin/UserForm.jsx — the one form that creates a local account and the one that
// edits an existing one (G1-12, roadmap D3: "Rol + Ek görev + Birimler").
//
// WHAT THIS FORM DOES NOT DO, AND WHY — the prototype's own user dialog (`admin.js userModal`) is
// the specification for three things a live system must refuse:
//
//   * IT DOES NOT MAKE UP A PASSWORD. The prototype shows a plaintext one it generated
//     (`H.genPassword`) with a "regenerate" button, and keeps three mutually inconsistent password
//     policies in the browser. Here the administrator types the temporary password, the only rule
//     stated is the server's own (at least `PASSWORD_MIN` characters, `admin/schemas.py`), the
//     field is `type="password"` and it is cleared the moment the dialog closes. A password is
//     never in a title, never in a toast, never logged, and never in the DOM after the dialog has
//     gone — `UsersTab.test.jsx` asserts the last one, because it is the claim worth testing.
//
//   * IT DOES NOT POLICE THE USERNAME. The prototype enforces `^[a-z0-9._]{3,32}$` in the
//     browser, which is not the server's rule (`a-z 0-9 . _ @ -`, 2-128, after folding `İ`/`ı`):
//     it refuses addresses the API accepts. The only check here is for characters that can never
//     pass whatever the server thinks, and the server's own 422 lands on the field it is about
//     (`fieldRefusals`) in the reader's own language.
//
//   * IT DOES NOT HIDE A GROUP THE DESK MAY NOT GIVE. A group outside the session's own rights
//     (`canGrant`) is drawn, disabled, with `admin.cannotGrant` beside it. Hiding it would leave
//     an administrator unable to tell "this hospital has no such group" from "I may not give it",
//     which are the two answers she is choosing between.
//
// The memberships the DIRECTORY holds are listed read-only: `PUT /users/{id}/groups` replaces the
// MANUAL ones and leaves AD's alone (`admin/service.set_manual_groups`), so offering them would be
// offering a change the server discards.
//
// THE USERNAME CANNOT BE EDITED. `UserPatch` has no `username` and the API has no rename; the
// field is `disabled` on an edit and says so. The roadmap routes renaming to Group 4.
import React, { useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { fieldRefusals } from "../../apiErrors.js";
import { Announce, Button, Field, Input, Modal, Select } from "../../ui/index.js";
import { PASSWORD_MIN } from "../../auth/passwordRules.js";
import { groupKind } from "./catalogue.js";
import { canGrant } from "./rules.js";

/** Which of the API's field names each control shows a refusal for. */
const FIELD = { fullName: "full_name", username: "username", email: "email", password: "password" };

/** The groups a desk may choose from, split the way the form offers them (catalogue.groupKind):
 *  one role, any number of extra duties, any number of the hospital's own groups. */
export function splitGroups(groups) {
  const of = (kind) => groups.filter((g) => groupKind(g.slug) === kind);
  return { roles: of("role"), extras: of("extra"), others: of("other") };
}

/** One checkbox for a group, disabled with its reason when this desk may not give it. */
function GroupChoice({ group, checked, grantable, busy, onToggle }) {
  const { t } = useI18n();
  return (
    <label className="flex items-start gap-2 py-1 font-text text-13.5">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        disabled={!grantable || busy}
        onChange={(event) => onToggle(group.id, event.target.checked)}
      />
      <span className={grantable ? "" : "text-mute"}>
        {group.name}
        {grantable ? null : <span className="block text-11.5 text-mute">{t("admin.cannotGrant")}</span>}
      </span>
    </label>
  );
}

/**
 * `user` null: create. Otherwise edit that account.
 *
 * `submit(body)` sends the write and resolves when the server has taken it; it throws the API's
 * failure. A 422 that names fields is shown UNDER those fields and focus moves to the first of
 * them — that is where an administrator can act on it — and `onRefused` is NOT called, so one
 * refusal is announced once. Anything else goes to `onRefused`, which puts it on the toast named
 * after this account (`refusal.js`).
 */
export function UserForm({
  user = null, groups = [], catalogue = [], perms = [], submit, onSaved, onRefused, onClose,
}) {
  const { t } = useI18n();
  const isNew = user === null;
  const { roles, extras, others } = useMemo(() => splitGroups(groups), [groups]);
  const held = new Set(isNew ? [] : user.manualGroupIds);
  const [fullName, setFullName] = useState(isNew ? "" : user.fullName || "");
  const [username, setUsername] = useState(isNew ? "" : user.username || "");
  const [email, setEmail] = useState(isNew ? "" : user.email || "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(() => roles.find((g) => held.has(g.id))?.id ?? "");
  const [chosen, setChosen] = useState(() => new Set([...extras, ...others].filter((g) => held.has(g.id)).map((g) => g.id)));
  const [active, setActive] = useState(isNew ? true : user.active);
  const [refusals, setRefusals] = useState({});
  const [busy, setBusy] = useState(false);
  const fields = useRef({});
  const mounted = useRef(true);
  React.useEffect(() => () => { mounted.current = false; }, []);

  const grantable = (group) => canGrant(perms, group, catalogue);
  const directoryGroups = isNew ? [] : user.groups.filter((g) => g.source === "directory");

  const toggle = (id, on) => setChosen((was) => {
    const next = new Set(was);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });

  /** Only what can never pass, whatever the server's rule is. Everything else is the server's. */
  function problems() {
    const out = {};
    if (!fullName.trim()) out.full_name = t("errors.mustNotBeBlank");
    if (isNew && username.trim().length < 2) out.username = t("errors.usernameRule");
    if (isNew && password.length < PASSWORD_MIN) out.password = t("errors.passwordTooShort");
    return out;
  }

  // Called by the form's own submit (Enter in a field) AND by the footer's primary button, which
  // the dialog renders outside the <form>: a `type="submit" form="…"` button is not reliable in
  // every renderer this suite runs in, and one handler for both is one behaviour to test.
  async function onSubmit(event) {
    event?.preventDefault?.();
    if (busy) return;
    const mine = problems();
    if (Object.keys(mine).length > 0) {
      setRefusals(mine);
      fields.current[Object.keys(mine)[0]]?.focus();
      return;
    }
    setRefusals({});
    setBusy(true);
    const groupIds = [...(role ? [role] : []), ...chosen];
    const body = isNew
      ? { username: username.trim(), email: email.trim() || null, full_name: fullName.trim(), password, group_ids: groupIds }
      : { full_name: fullName.trim(), email: email.trim(), is_active: active, group_ids: groupIds };
    try {
      await submit(body);
      // Nothing is kept: the password leaves this component's state in the same turn the dialog
      // closes, and `onSaved` unmounts it.
      setPassword("");
      if (mounted.current) onSaved();
    } catch (err) {
      const named = fieldRefusals(t, err);
      if (!mounted.current) return;
      if (Object.keys(named).length > 0) {
        // The field has to be ENABLED before it can take focus: the controls are `disabled`
        // while busy, and `focus()` on a disabled element is a no-op in a browser (jsdom is more
        // lenient, which is how a test could pass while the screen did not). `flushSync` lands
        // the two state updates in the DOM before the focus call, instead of after this
        // handler returns.
        flushSync(() => {
          setBusy(false);
          setPassword("");
          setRefusals(named);
        });
        fields.current[Object.keys(named)[0]]?.focus();
      } else {
        setPassword("");
        onRefused(err);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const bind = (key) => ({
    ref: (el) => { fields.current[FIELD[key]] = el; },
    disabled: busy,
  });

  return (
    <Modal
      open
      title={t(isNew ? "admin.formNew" : "admin.formEdit")}
      busy={busy}
      onClose={onClose}
      actions={(
        <>
          <Button onClick={onClose} busy={busy}>{t("admin.cancel")}</Button>
          <Button variant="primary" busy={busy} onClick={onSubmit}>
            {t(isNew ? "admin.create" : "admin.save")}
          </Button>
        </>
      )}
    >
      <form noValidate onSubmit={onSubmit}>
        <Announce text={busy ? t("admin.saving") : ""} />
        <Field layout="col" required label={t("admin.fieldFullName")} error={refusals.full_name}>
          <Input {...bind("fullName")} value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
        </Field>
        <Field
          layout="col"
          required={isNew}
          label={t("admin.fieldUsername")}
          hint={t("admin.fieldUsernameHint")}
          error={refusals.username}
        >
          <Input
            {...bind("username")}
            value={username}
            disabled={busy || !isNew}
            autoComplete="off"
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Field layout="col" label={t("admin.fieldEmail")} hint={t("admin.fieldEmailHint")} error={refusals.email}>
          <Input {...bind("email")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {isNew ? (
          <Field
            layout="col"
            required
            label={t("admin.fieldPassword")}
            hint={t("admin.fieldPasswordHint")}
            error={refusals.password}
          >
            <Input
              {...bind("password")}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        ) : null}

        <Field layout="col" label={t("admin.fieldRole")} hint={t("admin.fieldRoleHint")}>
          <Select value={role} disabled={busy} onChange={(e) => setRole(e.target.value)}>
            <option value="">{t("admin.noRole")}</option>
            {roles.map((group) => (
              <option key={group.id} value={group.id} disabled={!grantable(group)}>
                {grantable(group) ? group.name : `${group.name} — ${t("admin.cannotGrant")}`}
              </option>
            ))}
          </Select>
        </Field>

        {extras.length > 0 ? (
          <fieldset className="mb-2.5 border-0 p-0">
            <legend className="mb-1 font-text text-13.5 font-semibold text-mute">{t("admin.fieldExtras")}</legend>
            {extras.map((group) => (
              <GroupChoice
                key={group.id}
                group={group}
                checked={chosen.has(group.id)}
                grantable={grantable(group)}
                busy={busy}
                onToggle={toggle}
              />
            ))}
            <p className="m-0 text-12 text-mute">{t("admin.fieldExtrasHint")}</p>
          </fieldset>
        ) : null}

        {others.length > 0 ? (
          <fieldset className="mb-2.5 border-0 p-0">
            <legend className="mb-1 font-text text-13.5 font-semibold text-mute">{t("admin.fieldOther")}</legend>
            {others.map((group) => (
              <GroupChoice
                key={group.id}
                group={group}
                checked={chosen.has(group.id)}
                grantable={grantable(group)}
                busy={busy}
                onToggle={toggle}
              />
            ))}
            <p className="m-0 text-12 text-mute">{t("admin.fieldOtherHint")}</p>
          </fieldset>
        ) : null}

        {directoryGroups.length > 0 ? (
          <p className="m-0 mb-2.5 text-12.5 text-mute">
            {t("admin.directoryGroups", { list: directoryGroups.map((g) => g.name).join(", ") })}
          </p>
        ) : null}

        {isNew ? null : (
          <label className="flex items-center gap-2 font-text text-13.5">
            <input type="checkbox" checked={active} disabled={busy} onChange={(e) => setActive(e.target.checked)} />
            {t("admin.fieldActive")}
          </label>
        )}
      </form>
    </Modal>
  );
}
```

- [ ] **Step 2: Write the scope editor.** Create `dashboard/src/live/screens/admin/ScopeEditor.jsx`:

```jsx
// src/live/screens/admin/ScopeEditor.jsx — which units and beds one member of staff may see
// (G1-12; `PUT /scope/{user_id}`).
//
// THERE IS NO ENDPOINT THAT LISTS THE UNITS AND BEDS A SCOPE MAY NAME. The keys are the values in
// the site's `bed-mapping.json` (`BED_MAPPING_PATH`, a read-only bind mount; `tenant/bedmap.py`
// `BedRef.unit_id` / `bed_id`), written by an operator from the discovery report. `/tenant/*` does
// carry a unit and bed tree, but it needs `structure.manage` — which `users.manage` does not imply
// — and its ids are database UUIDs that nothing forces the mapping file to use. So this editor
// offers three sources and says in one line which they are:
//
//   1. the `identity.unit_id` / `identity.bed_id` of the cards on the board this session already
//      has (an unrestricted administrator sees them all);
//   2. the grants this user already holds, which `GET /scope/{id}` reports;
//   3. a free-text field, for a key with no patient on it right now.
//
// An empty unit has no card, so it is not in (1) — which is why (3) exists and why the sentence
// saying so is not optional. A grant whose key matches no card is not an error either: `/patients`
// reports it under `scope.unmatched_grants` and the clinician's own board shows that sentence.
//
// THE WRITE IS A REPLACEMENT, NOT A DIFF (`scope/schemas.ScopeAssignment`): two administrators
// saving diffs would merge into the union of both, the more permissive outcome, chosen by neither.
// The screen shows its own list at once and PUTS THE PREVIOUS LIST BACK when the server refuses,
// saying so — the only optimism in this surface, and it is reversible because the list is local.
//
// ONE GRANT NAMES A UNIT OR A BED, NEVER BOTH (`ScopeGrantIn._exactly_one`, 422): a grant naming
// neither "reads as access while granting nothing", which is the dangerous half.
//
// WHO MAY SAVE AT ALL is not a permission key. `PUT /scope/{id}` is refused with 403 unless the
// CALLER's own scope is unrestricted by ROLE (`scope/router.put_scope`), so `users.manage` alone
// is not enough and nothing in the token says otherwise: the only honest source is the caller's own
// `/scope/me` (`canAssignScope`). Until that answer arrives the Save is not offered and the screen
// says the right is unknown — never a button that cannot work.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { Announce, Button, Field, Input, Modal, Note, Table } from "../../ui/index.js";
import { boardKnown } from "../common/BoardState.jsx";
import { canAssignScope } from "./rules.js";

/** The reason `/scope/{id}` gives for an UNRESTRICTED scope, as a sentence. The two the server can
 *  actually answer with here are `role` and `unassigned`; anything else (including `rules.js`'s own
 *  "we were told nothing" fallback) says the engine could not resolve it. */
const REASON_KEY = {
  role: "admin.scopeReasonRole",
  unassigned: "admin.scopeReasonUnassigned",
};
const reasonKey = (reason) => REASON_KEY[reason] || "admin.scopeReasonUnknown";

/** A grant as this editor holds it: exactly one of the two keys, trimmed. */
const asGrant = (unitId, bedId) => ({ unitId: unitId || "", bedId: bedId || "" });
const sameGrant = (a, b) => a.unitId === b.unitId && a.bedId === b.bedId;
const keyOf = (g) => `${g.unitId}|${g.bedId}`;

/** The unit and bed keys this board can offer, plus the ones the user already holds. Sorted, with
 *  duplicates removed; a card the bed table did not place carries neither and contributes nothing. */
export function offeredKeys(patients, grants) {
  const units = new Set();
  const beds = new Set();
  for (const patient of Array.isArray(patients) ? patients : []) {
    if (patient?.unitId) units.add(patient.unitId);
    if (patient?.bedId) beds.add(patient.bedId);
  }
  for (const grant of Array.isArray(grants) ? grants : []) {
    if (grant.unitId) units.add(grant.unitId);
    if (grant.bedId) beds.add(grant.bedId);
  }
  const order = (a, b) => a.localeCompare(b, "en");
  return { units: [...units].sort(order), beds: [...beds].sort(order) };
}

/**
 * `scope` is `rules.scopeFromApi(GET /scope/{id})`; `mayAssign` is `canAssignScope(myScope)` —
 * true, false, or null while the caller's own scope is still unknown. `save(grants)` sends
 * `PUT /scope/{id}` with the WHOLE list and resolves with the scope the server answered.
 */
export function ScopeEditor({ user, scope, mayAssign, save, onSaved, onRefused, onClose }) {
  const { t } = useI18n();
  const board = useBoard();
  const [grants, setGrants] = useState(() => scope.grants.map((g) => asGrant(g.unitId, g.bedId)));
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [reverted, setReverted] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const offered = useMemo(() => offeredKeys(board.patients, grants), [board.patients, grants]);
  const has = (grant) => grants.some((g) => sameGrant(g, grant));
  const known = boardKnown(board.connection);

  const toggle = (grant, on) => {
    setReverted(false);
    setGrants((was) => (on ? [...was, grant] : was.filter((g) => !sameGrant(g, grant))));
  };

  const addManual = () => {
    const key = manual.trim();
    if (!key) return;
    const grant = asGrant(key, "");
    if (!has(grant)) toggle(grant, true);
    setManual("");
  };

  async function onSave() {
    if (busy) return;
    const previous = grants;
    setBusy(true);
    setReverted(false);
    try {
      await save(previous.map((g) => (g.bedId ? { bed_id: g.bedId } : { unit_id: g.unitId })));
      if (mounted.current) onSaved();
    } catch (err) {
      if (!mounted.current) return;
      // Back to what the server last told us, and said out loud: a list left on screen that the
      // engine refused is a list an administrator would read as the user's access.
      setGrants(scope.grants.map((g) => asGrant(g.unitId, g.bedId)));
      setReverted(true);
      onRefused(err);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const title = t("admin.scopeTitle", { name: user.fullName || user.username });

  // Unrestricted: there is nothing to assign, and the reason is the whole answer.
  if (scope.unrestricted) {
    return (
      <Modal open title={title} onClose={onClose} actions={<Button onClick={onClose}>{t("admin.cancel")}</Button>}>
        <Note tone="info" icon="shield">
          {t("admin.scopeUnrestricted", { reason: t(reasonKey(scope.reason)) })}
        </Note>
      </Modal>
    );
  }

  const choices = (label, items, make) => (
    <fieldset className="mb-3 border-0 p-0">
      <legend className="mb-1 font-text text-13.5 font-semibold text-mute">{label}</legend>
      {items.length === 0 ? null : items.map((key) => {
        const grant = make(key);
        return (
          <label key={key} className="flex items-center gap-2 py-0.5 font-text text-13.5">
            <input type="checkbox" checked={has(grant)} disabled={busy} onChange={(e) => toggle(grant, e.target.checked)} />
            <span className="font-data">{key}</span>
          </label>
        );
      })}
    </fieldset>
  );

  return (
    <Modal
      open
      title={title}
      busy={busy}
      onClose={onClose}
      actions={(
        <>
          <Button onClick={onClose} busy={busy}>{t("admin.cancel")}</Button>
          {mayAssign === true
            ? <Button variant="primary" busy={busy} onClick={onSave}>{t("admin.scopeSave")}</Button>
            : null}
        </>
      )}
    >
      {mayAssign === false ? <Note tone="warn" icon="shield">{t("errors.scopeAdminOnly")}</Note> : null}
      {mayAssign === null ? <Note tone="warn" icon="shield">{t("admin.scopeMayUnknown")}</Note> : null}

      {/* Where the list comes from, and what is not in it. Not optional: an administrator who
          cannot find an empty unit in a list that looks complete concludes it does not exist. */}
      <p className="m-0 mb-2 text-12.5 text-mute">{t("admin.scopeFromBoard")}</p>
      {known ? null : <Note tone="warn" icon="plug">{t("admin.scopeBoardUnknown")}</Note>}

      {offered.units.length === 0 && offered.beds.length === 0
        ? <p className="m-0 mb-2 text-12.5 text-mute">{t("admin.scopeNoKeys")}</p>
        : (
          <>
            {choices(t("admin.scopeUnits"), offered.units, (key) => asGrant(key, ""))}
            {choices(t("admin.scopeBeds"), offered.beds, (key) => asGrant("", key))}
          </>
        )}

      <Field layout="col" label={t("admin.scopeManual")} hint={t("admin.scopeManualHint")}>
        <Input
          value={manual}
          disabled={busy}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManual(); } }}
        />
      </Field>
      <Button icon="plus" busy={busy} onClick={addManual}>{t("admin.scopeAdd")}</Button>

      <Table caption={t("admin.scopeTitle", { name: user.username })} className="mt-3">
        <thead>
          <tr>
            <th scope="col">{t("admin.scopeUnits")}</th>
            <th scope="col">{t("admin.scopeBeds")}</th>
            <th scope="col">{t("admin.colActions")}</th>
          </tr>
        </thead>
        <tbody>
          {grants.length === 0 ? (
            <tr><td colSpan={3}>{t("admin.scopeEmpty")}</td></tr>
          ) : grants.map((grant) => (
            <tr key={keyOf(grant)}>
              <th scope="row" className="font-data">{grant.unitId || "—"}</th>
              <td className="font-data">{grant.bedId || "—"}</td>
              <td>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  busy={busy}
                  label={`${t("admin.remove")}: ${grant.unitId || grant.bedId}`}
                  onClick={() => toggle(grant, false)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      {/* A `Note`, not an `Alert`: the refusal itself is already announced once, on the toast, and
          `Alert` tone `crit` is a `role="alert"` of its own — the two together would read one
          refusal twice. This sentence is the VISIBLE explanation of why the list changed back
          under the reader's hands, which is a thing to see rather than a second thing to hear. */}
      {reverted ? <Note tone="warn" icon="swap" className="mt-3">{t("admin.scopeRevert")}</Note> : null}
      {/* A busy Button reads only "unavailable" to a screen reader; the words come from here. */}
      <Announce text={busy ? t("admin.saving") : ""} />
    </Modal>
  );
}
```

- [ ] **Step 3: Confirm they compile into the build and break nothing**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: unchanged counts (nothing imports them yet) and a clean build.

**Three things a reviewer should check here rather than in Task 7**, because they are decisions and not behaviour the test can name:

- `UserForm` imports `groupKind` from **`./catalogue.js`** and `canGrant` from **`./rules.js`**. They are two modules and `groupKind` lives in the first; importing it from `rules.js` throws `groupKind is not a function` at render time — found by running, and the only failure in this wave that a type checker would have caught.
- `ScopeEditor` shows its rollback as a **`Note`**, not an `Alert`: the refusal is already announced once on the toast, and `Alert tone="crit"` is a `role="alert"` of its own (Decision 9).
- `UserForm`'s 422 handler wraps `setBusy(false)` and `setRefusals(named)` in **`flushSync`** before it calls `focus()`. The fields are `disabled` while busy, and `focus()` on a disabled element is a no-op in a browser (jsdom is more lenient, which is how a test could pass while the screen did not); `flushSync` lands the two updates in the DOM before the focus call instead of after the handler returns. Task 7's 422 test asserts `toHaveFocus()`.

- [ ] **Step 4: Commit**

```bash
git status --short
git add dashboard/src/live/screens/admin/UserForm.jsx dashboard/src/live/screens/admin/ScopeEditor.jsx
git commit -m "$(cat <<'EOF'
feat(dashboard): the user form and the scope editor (G1-12)

The form refuses three things the prototype does: it does not invent a
password, it does not police the username beyond what can never pass, and it
does not hide a group this desk may not grant -- it shows it disabled, with
the reason, because "this hospital has no such group" and "I may not give it"
are the two answers an administrator is choosing between.

The editor's unit and bed keys come from the board's own cards plus the user's
existing grants plus a field, because no endpoint lists them; the write is a
replacement, not a diff, and a refusal puts the previous list back and says so.
The Save is not drawn at all unless the caller's own scope is unrestricted by
role, which is the server's rule and which no permission key reports.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** `103 / 2163` unchanged, build clean.

---

### Task 7: The users tab (G1-12)

**Files:**
- Create: `dashboard/src/live/screens/admin/UsersTab.jsx` + `UsersTab.test.jsx`
- Modify: `dashboard/src/live/screens/admin/AdminScreen.jsx` (two lines: this arm's import and its `TAB_SCREENS` line)

**This is a long task — about four hours.** It is one task rather than four because the component is one file and a plan that showed it three times would be a plan whose three copies drift. The steps are fine-grained and each `describe` is run on its own, so a fresh agent can stop and resume between them.

- [ ] **Step 1: Write the whole failing test.** Create `dashboard/src/live/screens/admin/UsersTab.test.jsx`:

```jsx
// The users and units tab (G1-12). Synthetic accounts only (admin.testutil.js).
//
// Every refusal is asserted where a reader meets it — on the toast, named after the account — and
// every count is asserted to be absent when the read behind it did not answer. Those two are the
// rules three arms and two reviews missed on the clinical screens. And every write that SUCCEEDS
// asserts two things: the confirmation the administrator reads, and that NO alert is on screen —
// because a success that also announces a refusal is exactly the Critical the patient arm shipped
// ("toast.show is not a function"), and a test that asserts the API call alone cannot see it.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { board, entry, identity } from "../../data/board.testutil.js";
import { PERMISSION_KEYS } from "./catalogue.js";
import {
  ADMIN_READS, CATALOGUE, GROUPS, NURSE_GROUP, SYSTEM_GROUP, USERS, group, member, scopeView, user,
} from "./admin.testutil.js";
import { groupFromApi, userFromApi } from "./rules.js";
import { UsersTab, mfaState } from "./UsersTab.jsx";

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
/** A full administrator. It has to be the WHOLE catalogue by default, not a plausible three keys:
 *  `canManageUser` refuses a user whose own rights exceed the desk's, so a desk holding
 *  `users.manage` and `board.view` may not act on a nurse — the nurse holds `alerts.ack` — and
 *  every action test would have been asserting the refusal instead of the action. Narrow desks are
 *  passed explicitly by the tests that are about a refusal. */
const DESK = [...PERMISSION_KEYS];

/** The tab on its own, with the loader's answers already in `admin` — the same object
 *  `AdminScreen` hands it, in the shapes `useAdminData` produces (`userFromApi`/`groupFromApi`),
 *  so a test cannot pass this tab a payload the loader could not. `reload` is a spy: every write
 *  must call it, because the screen then shows what the server holds rather than what it hoped.
 *
 *  `patients` puts cards on the BOARD (`board.testutil.js`), which is where the scope editor's unit
 *  and bed keys come from — there is no endpoint that lists them. */
async function open({ perms = DESK, users = USERS, groups = GROUPS, catalogue = CATALOGUE,
  unassigned = 2, selfId = "u-admin", setup, patients = [] } = {}) {
  const reload = vi.fn(async () => {});
  const admin = {
    data: { users: users.map(userFromApi), groups: groups.map(groupFromApi), catalogue, unassigned },
    loading: false, error: null, reload,
  };
  const mounted = await mount(<UsersTab admin={admin} />, {
    access: token({ sub: selfId, perms }),
    me: profile({ id: selfId, perms }),
    setup: (api) => {
      ADMIN_READS(api);
      api.boardPatients.mockResolvedValue(board(patients));
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      setup?.(api);
    },
  });
  if (patients.length > 0) {
    await act(async () => { await mounted.board.start(); });
    await act(async () => { mounted.stream.open(); await settle(); });
  }
  return { ...mounted, admin, reload };
}

/** What a write that LANDED must look like to the administrator: the confirmation, and no alert.
 *  The toast's error region is mounted before the first toast (ui/Toast.jsx), so "no alert" is
 *  "every alert region is empty", never "no alert element". */
function expectConfirmed(text) {
  expect(screen.getAllByText(text).length, `confirmation ${text}`).toBeGreaterThan(0);
  expect(screen.getAllByRole("alert").map((a) => a.textContent).join("").trim()).toBe("");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the list", () => {
  it("lists the users with every column, and the username under the name", async () => {
    await open();
    const table = screen.getByRole("table", { name: "İstifadəçilər və səlahiyyətləri" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Ad", "İstifadəçi adı", "Rol", "Şöbələr", "Vəziyyət", "2FA", "Son giriş", "Əməliyyatlar",
    ]);
    const row = within(table).getByRole("rowheader", { name: /hs\.aygun/ }).closest("tr");
    expect(within(row).getByText("Ayşe Sentetik")).toBeInTheDocument();
    expect(within(row).getAllByText("hs.aygun").length).toBeGreaterThan(1);   // name cell + row header
    expect(within(row).getByText("Hemşire")).toBeInTheDocument();
  });

  it("a temporary password is a tag, not a silence; \"required · not set up\" is not \"off\"", async () => {
    await open({ groups: [SYSTEM_GROUP, group("nurse", { mfa_required: true, member_count: 4 })] });
    const nurse = screen.getByRole("rowheader", { name: /hs\.aygun/ }).closest("tr");
    expect(within(nurse).getByText("ilk girişdə şifrə")).toBeInTheDocument();
    expect(within(nurse).getByText("Məcburi · qurulmayıb")).toBeInTheDocument();
    expect(within(nurse).queryByText("Bağlı")).toBeNull();
  });

  it("the 2FA cell says \"unknown\" for the row whose group is not in the list — never \"off\"", async () => {
    // The same row's actions already read "rights unknown"; a confident "off" beside that would be
    // the screen claiming a rule it cannot see. `mfaState` is the one function behind the cell.
    await open();
    const stranger = screen.getByRole("rowheader", { name: /hs\.gece/ }).closest("tr");
    expect(within(stranger).getByText("Bilinmir · qrupu siyahıda yoxdur")).toBeInTheDocument();
    expect(within(stranger).queryByText("Bağlı")).toBeNull();
    const known = GROUPS.map(groupFromApi);
    expect(mfaState(userFromApi(USERS[2]), known)).toBe("unknown");
    expect(mfaState(userFromApi(USERS[0]), known)).toBe("off");
    expect(mfaState(userFromApi(USERS[1]), known)).toBe("on");
  });

  it("a user who has never signed in says so, and one who has gets the date", async () => {
    await open();
    const ad = screen.getByRole("rowheader", { name: /dr\.kamran/ }).closest("tr");
    expect(within(ad).getByText("Heç girməyib")).toBeInTheDocument();
    const nurse = screen.getByRole("rowheader", { name: /hs\.aygun/ }).closest("tr");
    expect(within(nurse).getByText(/10\.10\.2026/)).toBeInTheDocument();
  });

  it("claims nothing about a user's units until that user's scope has been read", async () => {
    // There is NO bulk scope read: /scope/{id} is per user and /scope/unassigned answers a count.
    // So the cell must not say "no unit assigned" — which is a statement — for a scope nobody read.
    await open();
    const nurse = screen.getByRole("rowheader", { name: /hs\.aygun/ }).closest("tr");
    expect(within(nurse).getByText("Oxunmayıb")).toBeInTheDocument();
    expect(within(nurse).queryByText("Şöbə təyin edilməyib")).toBeNull();
  });

  it("searches name and username, folding diacritics, and says how much it is hiding", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Ad və ya istifadəçi adı axtar"), { target: { value: "ayse" } });
    // The row header carries the login and, under it, where the account comes from.
    expect(screen.getAllByRole("rowheader").map((h) => h.textContent)).toEqual(["hs.aygunLokal"]);
    expect(screen.getByText("3 hesabdan 1 göstərilir.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Ad və ya istifadəçi adı axtar"), { target: { value: "gecə" } });
    expect(screen.getAllByRole("rowheader")).toHaveLength(1);
  });

  it("filters by role, read from the API's own kind", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Rol"), { target: { value: NURSE_GROUP.id } });
    expect(screen.getAllByRole("rowheader")).toHaveLength(2);         // the local nurse and the AD one
    expect(screen.queryByText("Gecə Sintetik")).toBeNull();
    // The filter offers ROLES only — `kind` as the server reports it, so a hospital-made group
    // (kind null) and a duty (charge_nurse) are not offered as a role.
    const options = [...screen.getByLabelText("Rol").querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toContain("Hemşire");
    expect(options).toContain("Sistem yöneticisi");
    expect(options).not.toContain("Gece ekibi");
  });

  it("says no user matches rather than showing an empty table", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Ad və ya istifadəçi adı axtar"), { target: { value: "zzz" } });
    expect(screen.getByText("Uyğun gələn istifadəçi yoxdur.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the count of users with no assignment, and says so when it could not be read", async () => {
    await open();
    expect(screen.getByText("Heç bir təyinatı olmayan istifadəçi: 2")).toBeInTheDocument();
    cleanup();
    await open({ unassigned: null });
    expect(screen.getByText("Heç bir təyinatı olmayan istifadəçilərin sayı oxunmadı.")).toBeInTheDocument();
    expect(screen.queryByText(/istifadəçi: 0/)).toBeNull();
  });

  it("says out loud that it loaded the whole hospital once the list is large", async () => {
    const many = Array.from({ length: 200 }, (_, i) => user(`u-${i}`, { username: `hs.s${i}`, full_name: `Sintetik ${i}` }));
    await open({ users: many });
    expect(screen.getByText(/200 hesabın hamısını bir sorğuda yükləyir/)).toBeInTheDocument();
    // 50 rows at a time, not 200: the slow commit is the first symptom of an unpaginated list.
    expect(screen.getAllByRole("rowheader")).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: "150 sətir daha göstər" }));
    expect(screen.getAllByRole("rowheader")).toHaveLength(100);
  });
});

describe("what a desk may not do", () => {
  it("draws no action the session may not take, and says why once per row", async () => {
    const admin = user("u-boss", { username: "mudur", full_name: "Müdür Sintetik", groups: [member(SYSTEM_GROUP)] });
    await open({ perms: ["users.manage"], users: [...USERS, admin] });
    const row = screen.getByRole("rowheader", { name: /mudur/ }).closest("tr");
    expect(within(row).getByText(/səlahiyyətləri sizinkini aşır/)).toBeInTheDocument();
    expect(within(row).queryAllByRole("button")).toEqual([]);
  });

  it("a user one of whose groups is unknown is not acted on, and the row says the rights are unknown", async () => {
    await open();
    const row = screen.getByRole("rowheader", { name: /hs\.gece/ }).closest("tr");
    expect(within(row).getByText(/qruplarından biri siyahıda yoxdur/)).toBeInTheDocument();
    expect(within(row).queryAllByRole("button")).toEqual([]);
  });

  it("your own account offers no password, no 2FA and no deactivation, and says why", async () => {
    const self = user("u-admin", { username: "mudur", full_name: "Müdür Sintetik", groups: [member(NURSE_GROUP)] });
    await open({ users: [self], selfId: "u-admin" });
    const row = screen.getByRole("rowheader", { name: /mudur/ }).closest("tr");
    expect(within(row).getByText(/Öz hesabınızın şifrəsini/)).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /Şifrəni sıfırla/ })).toBeNull();
    expect(within(row).queryByRole("button", { name: /2FA sıfırla/ })).toBeNull();
    expect(within(row).queryByRole("button", { name: /Passivləşdir/ })).toBeNull();
    expect(within(row).getByRole("button", { name: /Redaktə et/ })).toBeInTheDocument();
  });

  it("a directory account offers no password reset, and a local one no sign-in unlock", async () => {
    await open();
    const ad = screen.getByRole("rowheader", { name: /dr\.kamran/ }).closest("tr");
    expect(within(ad).queryByRole("button", { name: /Şifrəni sıfırla/ })).toBeNull();
    expect(within(ad).getByRole("button", { name: /Girişi aç/ })).toBeInTheDocument();
    const nurse = screen.getByRole("rowheader", { name: /hs\.aygun/ }).closest("tr");
    expect(within(nurse).getByRole("button", { name: /Şifrəni sıfırla/ })).toBeInTheDocument();
    expect(within(nurse).queryByRole("button", { name: /Girişi aç/ })).toBeNull();
  });
});

describe("the form", () => {
  const openForm = async (over) => {
    const mounted = await open(over);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni istifadəçi" })); });
    return mounted;
  };

  it("creates a local user: the body carries the name, the login, the e-mail and every group id — and the administrator reads that it landed", async () => {
    const { api, reload } = await openForm();
    api.adminCreateUser.mockResolvedValue(user("u-new"));
    fireEvent.change(screen.getByLabelText(/Ad soyad/), { target: { value: " Ayşe Sentetik " } });
    fireEvent.change(screen.getByLabelText(/İstifadəçi adı/), { target: { value: "hs.yeni" } });
    fireEvent.change(screen.getByLabelText(/E-poçt/), { target: { value: "hs.yeni@sentetik.local" } });
    fireEvent.change(screen.getByLabelText(/Müvəqqəti şifrə/), { target: { value: "gecici-1234" } });
    // Scoped to the dialog: jsdom does not implement `inert`, so the tab's own role FILTER — which
    // `admin.filterRole` names "Rol" too — is still queryable behind the open form.
    const form = within(screen.getByRole("dialog"));
    fireEvent.change(form.getByLabelText(/^Rol/), { target: { value: NURSE_GROUP.id } });
    fireEvent.click(form.getByLabelText("Gece ekibi"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "İstifadəçini yarat" })); await settle(); });
    expect(api.adminCreateUser).toHaveBeenCalledWith({
      username: "hs.yeni", email: "hs.yeni@sentetik.local", full_name: "Ayşe Sentetik",
      password: "gecici-1234", group_ids: [NURSE_GROUP.id, WARD_ID],
    });
    expectConfirmed(/İstifadəçi yaradıldı\./);
    expect(reload).toHaveBeenCalled();
  });

  it("the username cannot be edited, and the form says so", async () => {
    await open();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Redaktə et: hs\.aygun/ })[0]);
    });
    expect(screen.getByLabelText(/İstifadəçi adı/)).toBeDisabled();
    expect(screen.getByText(/sonradan dəyişdirilə bilməz/)).toBeInTheDocument();
  });

  it("a group beyond the session's rights is shown and disabled, not hidden", async () => {
    // A hospital-made group holding users.manage: a desk with board.view + users.manage may not
    // give it away, and must still be able to see that it exists.
    const strong = group("gece_yonetim", { name: "Gecə idarə", permissions: ["users.manage", "audit.view"] });
    const { api } = await openForm({ perms: ["users.manage"], groups: [...GROUPS, strong] });
    const form = within(screen.getByRole("dialog"));
    const box = form.getByLabelText(/Gecə idarə/);
    expect(box).toBeDisabled();
    // Said on the role <option> as well as under the checkbox: the group is visible in both places
    // and refused in both, which is the point — never hidden.
    expect(form.getAllByText(/səlahiyyətləri sizinkini aşır; verə bilmərsiniz/).length).toBeGreaterThan(0);
    expect(api.adminCreateUser).not.toHaveBeenCalled();
  });

  it("the directory's memberships are read-only and named", async () => {
    await open();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Redaktə et: dr\.kamran/ })[0]);
    });
    expect(screen.getByText(/AD-dən gələn qruplar burada dəyişdirilə bilməz: Hemşire/)).toBeInTheDocument();
  });

  it("a 422 on the username lands on the username field, in the reader's language, with the focus", async () => {
    const RULE = "Kullanıcı adı 2-128 karakter olmalı; yalnızca a-z, 0-9 ve . _ @ - kullanılabilir. Türkçe/Azerbaycanca harfleri Latin karşılığıyla yazın: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e.";
    const { api } = await openForm();
    api.adminCreateUser.mockRejectedValue(refusal(422, `username: ${RULE}`, {
      fieldErrors: [{ field: "username", type: "value_error", message: RULE }],
    }));
    fireEvent.change(screen.getByLabelText(/Ad soyad/), { target: { value: "Ayşe Sentetik" } });
    fireEvent.change(screen.getByLabelText(/İstifadəçi adı/), { target: { value: "hs.şə" } });
    fireEvent.change(screen.getByLabelText(/Müvəqqəti şifrə/), { target: { value: "gecici-1234" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "İstifadəçini yarat" })); await settle(); });
    expect(screen.getByText(/İstifadəçi adı 2-128 simvol olmalıdır/)).toBeInTheDocument();
    const field = screen.getByLabelText(/İstifadəçi adı/);
    expect(field).toHaveAttribute("aria-invalid", "true");
    // The field is ENABLED again and has the focus: the refusal is where the administrator can act
    // on it. (A field still `disabled` from the write cannot take focus in a browser.)
    expect(field).not.toBeDisabled();
    expect(field).toHaveFocus();
    // A 422 goes on the field and NOT on the toast — one refusal, announced once.
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join("").trim()).toBe("");
  });

  it("holds the form open while the write is in flight and keeps nothing afterwards", async () => {
    let release;
    const { api } = await openForm();
    api.adminCreateUser.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    fireEvent.change(screen.getByLabelText(/Ad soyad/), { target: { value: "Ayşe Sentetik" } });
    fireEvent.change(screen.getByLabelText(/İstifadəçi adı/), { target: { value: "hs.yeni" } });
    fireEvent.change(screen.getByLabelText(/Müvəqqəti şifrə/), { target: { value: "gecici-1234" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "İstifadəçini yarat" })); });
    // Escape and the ✕ do nothing while busy: a refusal must land in an open dialog.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => { release(user("u-new")); await settle(); });
    expect(screen.queryByRole("dialog")).toBeNull();
    // A PASSWORD IS NEVER IN THE DOM AFTER ITS DIALOG CLOSES — not in a value, not in a title.
    expect(document.body.innerHTML).not.toContain("gecici-1234");
  });
});

const WARD_ID = "g-gece_ekibi";

describe("the three confirmations and the unlock", () => {
  const press = async (name) => {
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name })[0]); });
  };

  it("resetting a password names the account and says the open sessions end — and reads as done", async () => {
    const { api, reload } = await open();
    api.adminResetPassword.mockResolvedValue({ ok: true });
    await press(/Şifrəni sıfırla: hs\.aygun/);
    expect(screen.getByText(/Ayşe Sentetik üçün yeni müvəqqəti şifrə təyin edin\. İstifadəçinin açıq sessiyaları bağlanır/))
      .toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Müvəqqəti şifrə/), { target: { value: "yeni-sifre-99" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Şifrəni sıfırla" })); await settle(); });
    expect(api.adminResetPassword).toHaveBeenCalledWith("u-nurse", "yeni-sifre-99");
    expectConfirmed(/Ayşe Sentetik · Müvəqqəti şifrə təyin edildi\./);
    expect(reload).toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain("yeni-sifre-99");
  });

  it("resetting two-step verification names the account and the consequence", async () => {
    const { api } = await open();
    api.adminResetMfa.mockResolvedValue({ ok: true });
    await press(/2FA sıfırla: hs\.aygun/);
    expect(screen.getByText(/Ayşe Sentetik istifadəçisinin iki addımlı doğrulaması sıfırlanacaq/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "2FA sıfırla" })); await settle(); });
    expect(api.adminResetMfa).toHaveBeenCalledWith("u-nurse");
    expectConfirmed(/Ayşe Sentetik · İki addımlı doğrulama sıfırlandı\./);
  });

  it("deactivating names the account and says it can no longer sign in", async () => {
    const { api } = await open();
    api.adminUpdateUser.mockResolvedValue(user("u-nurse", { is_active: false }));
    await press(/Passivləşdir: hs\.aygun/);
    expect(screen.getByText(/Ayşe Sentetik passivləşdiriləcək; açıq sessiyaları bağlanır/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Passivləşdir" })); await settle(); });
    expect(api.adminUpdateUser).toHaveBeenCalledWith("u-nurse", { is_active: false });
    expectConfirmed(/Ayşe Sentetik · Hesab passivləşdirildi\./);
  });

  it("the unlock asks for a reason, refuses an empty one before sending, and says it is audited", async () => {
    const { api } = await open();
    api.adminUnlockSignIn.mockResolvedValue({ ok: true });
    await press(/Girişi aç: dr\.kamran/);
    expect(screen.getByText(/Səbəb audit jurnalına yazılır/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Səbəb/), { target: { value: "   " } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Girişi aç" })); await settle(); });
    expect(api.adminUnlockSignIn).not.toHaveBeenCalled();
    // On the FIELD, not merely somewhere: `admin.reasonHint` carries the same phrase, so the
    // assertion is that the control is marked invalid and names the refusal first.
    const reason = screen.getByLabelText(/Səbəb/);
    expect(reason).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(reason.getAttribute("aria-describedby").split(" ")[0]).textContent)
      .toMatch(/ən azı bir hərf və ya rəqəm/);
    fireEvent.change(screen.getByLabelText(/Səbəb/), { target: { value: "telefonla kimliyi doğrulandı" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Girişi aç" })); await settle(); });
    expect(api.adminUnlockSignIn).toHaveBeenCalledWith("u-ad", "telefonla kimliyi doğrulandı");
  });

  it("a refusal is on the TOAST, names the account, and the dialog stays open", async () => {
    const { api, reload } = await open();
    api.adminResetMfa.mockRejectedValue(refusal(409, "Kendi parolanızı veya MFA'nızı buradan sıfırlayamazsınız; parola için Hesabım > Parola değiştir'i kullanın"));
    await press(/2FA sıfırla: hs\.aygun/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "2FA sıfırla" })); await settle(); });
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent).join(" ");
    expect(alerts).toContain("Ayşe Sentetik");
    expect(alerts).toContain("Öz şifrənizi");
    expect(screen.getByRole("dialog")).toBeInTheDocument();      // not dismissed on a refusal
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("the scope editor", () => {
  const openScope = async (over) => {
    const mounted = await open(over);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Şöbələr: hs\.aygun/ })[0]);
      await settle();
    });
    return mounted;
  };

  it("an unrestricted user gets no editor and the reason why", async () => {
    await openScope({ setup: (api) => api.userScope.mockResolvedValue(scopeView({ unrestricted: true, reason: "role" })) });
    expect(screen.getByText(/Bu istifadəçinin əhatəsi məhdud deyil: administrator və ya platforma operatoru/))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Əhatəni yadda saxla" })).toBeNull();
  });

  it("offers the board's own keys and the user's own grants, and says where they come from", async () => {
    await openScope({
      patients: [
        entry("S-001", [], { identity: identity({ unit_id: "REA-01", bed_id: "REA-01-2" }) }),
        entry("S-002", [], { identity: identity({ patient_id: "S-002", unit_id: "NICU-01", bed_id: "NICU-01-1" }) }),
      ],
      setup: (api) => api.userScope.mockResolvedValue(scopeView({ grants: [{ unit_id: "REA-09" }] })),
    });
    expect(screen.getByText(/Seçimlər panelin hazırkı kartlarından/)).toBeInTheDocument();
    for (const key of ["REA-01", "NICU-01", "REA-09"]) {
      expect(screen.getByRole("checkbox", { name: key })).toBeInTheDocument();
    }
    expect(screen.getByRole("checkbox", { name: "REA-09" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "NICU-01" })).not.toBeChecked();
  });

  it("a key with no card on the board can be added by hand, and the screen says what that means", async () => {
    await openScope({ setup: (api) => api.userScope.mockResolvedValue(scopeView({ grants: [] })) });
    expect(screen.getByText(/Mühərrikdə bu açarla uyğun kart yoxdursa əhatə heç nə açmır/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Şöbə və ya çarpayı açarı/), { target: { value: "REA-77" } });
    fireEvent.click(screen.getByRole("button", { name: "Əlavə et" }));
    expect(screen.getByRole("rowheader", { name: "REA-77" })).toBeInTheDocument();
  });

  it("saving sends the WHOLE list, as units and beds, reads it back, and reads as done", async () => {
    const { api } = await openScope({
      patients: [entry("S-001", [], { identity: identity({ unit_id: "REA-01", bed_id: "REA-01-2" }) })],
      setup: (api2) => api2.userScope.mockResolvedValue(scopeView({ grants: [{ unit_id: "REA-09" }] })),
    });
    api.setScope.mockResolvedValue(scopeView({ grants: [{ unit_id: "REA-09" }, { bed_id: "REA-01-2" }] }));
    fireEvent.click(screen.getByRole("checkbox", { name: "REA-01-2" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Əhatəni yadda saxla" })); await settle(); });
    expect(api.setScope).toHaveBeenCalledWith("u-nurse", [{ unit_id: "REA-09" }, { bed_id: "REA-01-2" }]);
    expect(api.userScope).toHaveBeenCalledTimes(2);                    // read back, not assumed
    expectConfirmed(/Ayşe Sentetik · Əhatə yadda saxlanıldı\./);
  });

  it("a refusal puts the previous list back, says so, and names the account on the toast", async () => {
    const { api } = await openScope({
      patients: [entry("S-001", [], { identity: identity({ unit_id: "REA-01" }) })],
      setup: (api2) => api2.userScope.mockResolvedValue(scopeView({ grants: [{ unit_id: "REA-09" }] })),
    });
    api.setScope.mockRejectedValue(refusal(403, "kapsam atamak için kapsamı sınırsız bir yönetici olmalısınız"));
    fireEvent.click(screen.getByRole("checkbox", { name: "REA-01" }));
    expect(screen.getByRole("checkbox", { name: "REA-01" })).toBeChecked();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Əhatəni yadda saxla" })); await settle(); });
    expect(screen.getByRole("checkbox", { name: "REA-01" })).not.toBeChecked();
    expect(screen.getByText("Mühərrik qəbul etmədi; ekrandakı əhatə geri alındı.")).toBeInTheDocument();
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toContain("Ayşe Sentetik");
  });

  it("offers no Save to a desk the server would refuse, and says which right is missing", async () => {
    // PUT /scope/{id} needs the CALLER's own scope to be unrestricted BY ROLE. A desk unrestricted
    // only because nobody has been assigned anything yet is refused — the pilot's normal state.
    await openScope({ setup: (api) => {
      api.myScope.mockResolvedValue(scopeView({ unrestricted: true, reason: "unassigned" }));
      api.userScope.mockResolvedValue(scopeView({ grants: [] }));
    } });
    expect(screen.queryByRole("button", { name: "Əhatəni yadda saxla" })).toBeNull();
    expect(screen.getByText(/kapsamı sınırsız bir yönetici olmalısınız|Əhatə təyin etmək üçün/)).toBeInTheDocument();
  });

  it("fills the row's units cell once that user's scope has been read", async () => {
    await openScope({ setup: (api) => api.userScope.mockResolvedValue(scopeView({ grants: [{ unit_id: "REA-01" }] })) });
    fireEvent.click(screen.getByRole("button", { name: "İmtina" }));
    const row = screen.getByRole("rowheader", { name: /hs\.aygun/ }).closest("tr");
    expect(within(row).getByText("1 şöbə")).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("the list is a table with a caption, column headers and the username as the row header", async () => {
    await open();
    const table = screen.getByRole("table", { name: "İstifadəçilər və səlahiyyətləri" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(8);
    for (const header of within(table).getAllByRole("columnheader")) {
      expect(header.getAttribute("scope")).toBe("col");
    }
    for (const header of within(table).getAllByRole("rowheader")) {
      expect(header.getAttribute("scope")).toBe("row");
    }
  });

  it("has no h1 of its own: the screen's heading is the frame's", async () => {
    await open();
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0);
  });

  it("every control the tab draws is reachable from the keyboard", async () => {
    await open();
    for (const control of screen.getAllByRole("button")) {
      expect(control.tabIndex, control.getAttribute("aria-label") || control.textContent).toBeGreaterThanOrEqual(0);
      expect(control.hasAttribute("disabled")).toBe(false);     // busy, never disabled
    }
  });

  it("says which account a write is in flight for, once", async () => {
    let release;
    const { api } = await open();
    api.adminResetMfa.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /2FA sıfırla: hs\.aygun/ })[0]); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "2FA sıfırla" })); await settle(); });
    await waitFor(() => expect(screen.getAllByRole("status").map((s) => s.textContent).join(" "))
      .toContain("hs.aygun"), { timeout: 4000 });
    await act(async () => { release({ ok: true }); await settle(); });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/live/screens/admin/UsersTab.test.jsx 2>&1 | grep -E "Failed to resolve|Tests " | head -3
```
Expected: `Failed to resolve import "./UsersTab.jsx"`.

- [ ] **Step 3: Write the tab.** Create `dashboard/src/live/screens/admin/UsersTab.jsx`:

```jsx
// src/live/screens/admin/UsersTab.jsx — the staff of this hospital, their groups and their unit
// scope (G1-12). The prototype's `admin.js` users tab, reduced to what the API can back.
//
// THE WHOLE LIST ARRIVES IN ONE ANSWER AND IS FILTERED HERE. `GET /admin/users` has no `limit`, no
// `offset`, no cursor and no `q` (`admin/router.list_users`): the answer is every account in the
// hospital. At a pilot's size that is the right trade — a dozen accounts, one request, a search
// and a sort with no round trip — and the user decided it deliberately (Needs the user, 10:
// option (a) for the pilot, `limit`/`offset` before a second hospital). What it must NOT become is
// a tab that silently depends on having the whole list, because then its search and its sort
// quietly start lying the day pagination arrives. So:
//
//   * the search and the role filter are applied to `admin.data.users` and the screen says HOW
//     MANY of how many it is showing, every time it is showing fewer;
//   * the list is capped for rendering at `PAGE` rows with a "show more", so an AD import of
//     several hundred accounts does not put six hundred rows and three thousand cells into one
//     commit — the slow screen is the first symptom, and it arrives long before the request does;
//   * and when the answer is at or over `MANY` accounts the tab says so once, in the reader's own
//     language, with the fact that it loaded them all. That line is the handover note to whoever
//     adds pagination: it is visible to the person who will ask for it.
//
// A REFUSED ACTION IS NOT DRAWN. `rules.canManageUser` decides, and where it refuses, the reason
// is in the row's own actions cell ONCE — the keys this desk lacks, or that the user's rights are
// unknown, or that this is your own account. N disabled buttons answer the same question N times,
// and a disabled button also drops a keyboard user's focus to <body> when it becomes disabled
// mid-write, which is why `Button` has `busy` and never `disabled`.
//
// THE UNITS COLUMN CANNOT BE FILLED FROM THE LIST. There is no bulk scope read: `GET /scope/{id}`
// is per user and `GET /scope/unassigned` answers a COUNT. So the cell does not claim anything it
// has not read — `admin.unitsNotRead`, not a dash and not a zero — and reading one user's scope
// (opening the editor) fills that row. Decision 6 in this wave's plan, with the fan-out of one
// request per account as the rejected alternative.
import React, { useCallback, useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { Announce, Box, Button, Empty, Field, Input, Modal, Note, Pill, Select, StatusPill, Table, Tag, useToast } from "../../ui/index.js";
import { ddmmyyyy, hhmm } from "../../i18n/dates.js";
import { norm } from "../beds/order.js";
import { canAssignScope, canManageUser, scopeFromApi } from "./rules.js";
import { doneFor, refusedFor } from "./refusal.js";
import { UserForm } from "./UserForm.jsx";
import { ScopeEditor } from "./ScopeEditor.jsx";

/** How many rows are rendered before "show more". Not a page of data — the whole list is already
 *  here — only a bound on one commit's DOM. */
export const PAGE = 50;
/** At or above this many accounts the tab says out loud that it loaded the whole hospital. */
export const MANY = 200;

/** The role this account's groups give it, and everything else it holds, split as the form does. */
export function membershipOf(user) {
  const role = user.groups.find((g) => g.kind === "role") ?? null;
  return {
    role,
    extras: user.groups.filter((g) => g.kind === "extra"),
    others: user.groups.filter((g) => g.kind === "other"),
  };
}

/** Does any group this user holds require two-step verification? The groups' own `mfa_required` is
 *  what the server reads when it decides `requires_mfa` for a token (spec §4), so a user in such a
 *  group with no authenticator is "required · not set up" and never "off": the two are a different
 *  statement about the same account, and only one of them is a thing to fix.
 *
 *  "unknown" when one of the user's groups is not in the list this screen was given: the rule
 *  may hold there and the screen cannot see it, so "off" would be a claim. The same row's actions
 *  already read "rights unknown" (`canManageUser`); the 2FA cell says the same thing for the
 *  same reason, rather than a confident "off" beside an honest "unknown". */
export function mfaState(user, groups) {
  if (user.mfa) return "on";
  const byId = new Map(groups.map((g) => [g.id, g]));
  if (user.groups.some((link) => !byId.has(link.id))) return "unknown";
  const required = user.groups.some((link) => byId.get(link.id)?.mfaRequired === true);
  return required ? "required" : "off";
}

/** One account's row against the search box: its name and its username, diacritics folded, so
 *  "aygun" finds "Ayşe Aygün" and "ayse" finds her too. `norm` is the bed board's — one copy. */
const matches = (user, query) => query === "" || norm(`${user.fullName} ${user.username}`).includes(query);

/** The sentence a row puts where its actions would be, or null when it has actions. */
function refusalKey(verdict, isSelf) {
  if (verdict.beyond === null) return { key: "admin.beyondUnknown", vars: {} };
  if (!verdict.within) return { key: "admin.beyond", vars: { keys: verdict.beyond.join(", ") } };
  if (isSelf) return { key: "admin.selfNote", vars: {} };
  return null;
}

export function UsersTab({ admin }) {
  const { t } = useI18n();
  const { user: me, store } = useSession();
  const toast = useToast();
  const api = store.api;
  const { users, groups, catalogue, unassigned } = admin.data;

  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [shown, setShown] = useState(PAGE);
  /** `{kind, user}` — which dialog is open and for whom. */
  const [open, setOpen] = useState(null);
  /** The scopes this session has actually read, by user id: nothing is claimed for a row that is
   *  not in here. */
  const [scopes, setScopes] = useState({});
  const [myScope, setMyScope] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // `kind` is the ADAPTED group's: the API's own answer when it sends one (`GroupOut.kind`), the
  // mirror's otherwise (`rules.groupFromApi`) — never the mirror directly, which would ignore
  // what the server said about a group it defines.
  const roleGroups = useMemo(() => groups.filter((g) => g.kind === "role"), [groups]);

  const picked = useMemo(() => {
    const q = norm(query);
    return users.filter((u) => matches(u, q) && (role === "" || u.groups.some((g) => g.id === role)));
  }, [users, query, role]);

  /** Every write goes through this: the session's `track` (so a refused refresh ends the session
   *  here too), the toast named after the account, and a reload — the screen then shows what the
   *  server holds rather than what it hoped. */
  const write = useCallback(async (user, run, doneText) => {
    if (busyId) return false;
    setBusyId(user.id);
    try {
      await store.track(run);
      toast(doneFor(t, user.fullName || user.username, doneText));
      await admin.reload();
      return true;
    } catch (err) {
      toast(refusedFor(t, user.fullName || user.username, err), "error");
      return false;
    } finally {
      setBusyId(null);
    }
  }, [admin, busyId, store, t, toast]);

  /** One user's scope, read when it is needed and remembered for the row. */
  const openScope = useCallback(async (user) => {
    if (busyId) return;
    setBusyId(user.id);
    try {
      const [mine, theirs] = await Promise.all([
        myScope ? Promise.resolve(myScope) : store.track(() => api.myScope()),
        store.track(() => api.userScope(user.id)),
      ]);
      const read = scopeFromApi(theirs);
      setMyScope(scopeFromApi(mine));
      setScopes((was) => ({ ...was, [user.id]: read }));
      setOpen({ kind: "scope", user, scope: read });
    } catch (err) {
      toast(refusedFor(t, user.fullName || user.username, err), "error");
    } finally {
      setBusyId(null);
    }
  }, [api, busyId, myScope, store, t, toast]);

  /** After a save, read the scope back rather than keeping the list we sent: the server's answer is
   *  the scope, and it normalises the keys it stores. A failed re-read leaves the row UNREAD
   *  (`undefined`), never an empty scope — "we did not look" is not "nothing is assigned". */
  const rereadScope = useCallback(async (user) => {
    try {
      const theirs = await store.track(() => api.userScope(user.id));
      setScopes((was) => ({ ...was, [user.id]: scopeFromApi(theirs) }));
    } catch {
      setScopes((was) => {
        const next = { ...was };
        delete next[user.id];
        return next;
      });
    }
  }, [api, store]);

  const unitsCell = (user) => {
    const scope = scopes[user.id];
    if (!scope) return <span className="text-mute">{t("admin.unitsNotRead")}</span>;
    if (scope.unrestricted) return t("admin.allUnits");
    const units = scope.grants.filter((g) => g.unitId).length;
    const beds = scope.grants.filter((g) => g.bedId).length;
    if (units === 0 && beds === 0) return t("admin.noUnits");
    return [units ? t("admin.unitCount", { count: units }) : null, beds ? t("admin.bedCount", { count: beds }) : null]
      .filter(Boolean).join(" · ");
  };

  const rows = picked.slice(0, shown);

  return (
    <div className="flex flex-col gap-3">
      {/* "Everyone sees everything because nobody has been assigned yet" and "…because that is the
          policy" are the same screen without this number — and it is shown only when the read that
          produced it answered: a count this tab cannot know is never a zero. */}
      {unassigned === null
        ? <p className="m-0 text-12.5 text-mute">{t("admin.scopeUnassignedUnknown")}</p>
        : <p className="m-0 text-12.5 text-mute">{t("admin.scopeUnassigned", { count: unassigned })}</p>}

      {users.length >= MANY ? <Note tone="info" icon="list">{t("admin.wholeList", { count: users.length })}</Note> : null}

      <div className="flex flex-wrap items-end gap-2">
        <Field layout="col" label={t("admin.search")} className="mb-0 min-w-[220px] flex-1">
          <Input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} />
        </Field>
        <Field layout="col" label={t("admin.filterRole")} className="mb-0">
          <Select value={role} onChange={(e) => { setRole(e.target.value); setShown(PAGE); }}>
            <option value="">{t("admin.filterAll")}</option>
            {roleGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        </Field>
        <Button icon="userPlus" variant="primary" onClick={() => setOpen({ kind: "new", user: null })}>
          {t("admin.newUser")}
        </Button>
      </div>

      {picked.length < users.length ? (
        <p className="m-0 text-12.5 text-mute">{t("admin.filtered", { shown: picked.length, total: users.length })}</p>
      ) : null}

      {picked.length === 0 ? <Empty icon="users">{t("admin.none")}</Empty> : (
        <Table caption={t("admin.caption")}>
          <thead>
            <tr>
              <th scope="col">{t("admin.colName")}</th>
              <th scope="col">{t("admin.colUsername")}</th>
              <th scope="col">{t("admin.colRole")}</th>
              <th scope="col">{t("admin.colUnits")}</th>
              <th scope="col">{t("admin.colState")}</th>
              <th scope="col">{t("admin.colMfa")}</th>
              <th scope="col">{t("admin.colLastLogin")}</th>
              <th scope="col">{t("admin.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => {
              const verdict = canManageUser(me.perms, user, groups, me.id, catalogue);
              const isSelf = user.id === me.id;
              const refused = refusalKey(verdict, isSelf);
              const { role: ownRole, extras, others } = membershipOf(user);
              const mfa = mfaState(user, groups);
              const busy = busyId === user.id;
              return (
                <tr key={user.id}>
                  {/* The row's own header is the USERNAME, not the display name: it is the
                      identifier the server knows, it is unique, and a screen reader repeats it
                      with every cell of the row. */}
                  <td>
                    <b>{user.fullName}</b>
                    <div className="font-data text-11.5 text-mute">{user.username}</div>
                  </td>
                  <th scope="row" className="font-data font-semibold">
                    {user.username}
                    <div className="text-11.5 font-normal text-mute">
                      {t(user.authSource === "ldap" ? "admin.sourceLdap" : "admin.sourceLocal")}
                    </div>
                  </th>
                  <td>
                    {ownRole ? ownRole.name : <span className="text-mute">{t("admin.noRole")}</span>}
                    {extras.length > 0 ? (
                      <div className="text-11.5 text-mute">{t("admin.extras", { list: extras.map((g) => g.name).join(", ") })}</div>
                    ) : null}
                    {others.length > 0 ? (
                      <div className="text-11.5 text-mute">{t("admin.otherGroups", { list: others.map((g) => g.name).join(", ") })}</div>
                    ) : null}
                  </td>
                  <td>{unitsCell(user)}</td>
                  <td>
                    {user.active
                      ? <StatusPill tone="ok">{t("admin.active")}</StatusPill>
                      : <Tag>{t("admin.inactive")}</Tag>}
                    {user.mustChangePassword ? <div className="mt-1"><Tag tone="warn">{t("admin.mustChange")}</Tag></div> : null}
                  </td>
                  <td>
                    {mfa === "on" ? <Pill icon="ok">{t("admin.mfaOn")}</Pill> : null}
                    {mfa === "required" ? <Tag tone="warn">{t("admin.mfaRequired")}</Tag> : null}
                    {mfa === "unknown" ? <Tag>{t("admin.mfaUnknown")}</Tag> : null}
                    {mfa === "off" ? <span className="text-mute">{t("admin.mfaOff")}</span> : null}
                  </td>
                  <td className="font-data text-mute">
                    {user.lastLoginAt
                      ? `${ddmmyyyy(Date.parse(user.lastLoginAt))} ${hhmm(Date.parse(user.lastLoginAt))}`
                      : t("admin.never")}
                  </td>
                  <td>
                    {refused ? <span className="text-12 text-mute">{t(refused.key, refused.vars)}</span> : null}
                    <div className="flex flex-wrap gap-1">
                      {verdict.edit ? (
                        <Button size="sm" variant="ghost" icon="edit" busy={busy}
                          label={`${t("admin.edit")}: ${user.username}`}
                          onClick={() => setOpen({ kind: "edit", user })} />
                      ) : null}
                      {verdict.within ? (
                        <Button size="sm" variant="ghost" icon="bed" busy={busy}
                          label={`${t("admin.scope")}: ${user.username}`}
                          onClick={() => openScope(user)} />
                      ) : null}
                      {verdict.resetPassword ? (
                        <Button size="sm" variant="ghost" icon="key" busy={busy}
                          label={`${t("admin.resetPassword")}: ${user.username}`}
                          onClick={() => setOpen({ kind: "password", user })} />
                      ) : null}
                      {verdict.resetMfa ? (
                        <Button size="sm" variant="ghost" icon="shield" busy={busy}
                          label={`${t("admin.resetMfa")}: ${user.username}`}
                          onClick={() => setOpen({ kind: "mfa", user })} />
                      ) : null}
                      {verdict.unlockSignIn ? (
                        <Button size="sm" variant="ghost" icon="lock" busy={busy}
                          label={`${t("admin.unlockSignIn")}: ${user.username}`}
                          onClick={() => setOpen({ kind: "unlock", user })} />
                      ) : null}
                      {verdict.deactivate ? (
                        <Button size="sm" variant="ghost" icon={user.active ? "x" : "ok"} busy={busy}
                          label={`${t(user.active ? "admin.deactivate" : "admin.activate")}: ${user.username}`}
                          onClick={() => setOpen({ kind: user.active ? "deactivate" : "activate", user })} />
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {picked.length > rows.length ? (
        <Button icon="plus" onClick={() => setShown((n) => n + PAGE)}>
          {t("admin.showMore", { count: picked.length - rows.length })}
        </Button>
      ) : null}

      {/* A busy row's Button reads only "unavailable" to a screen reader: the words come from here,
          and they name the account, so an administrator moving down a list of twelve knows which
          row is in flight. */}
      <Announce text={busyId ? t("admin.savingFor", { subject: users.find((u) => u.id === busyId)?.username ?? "" }) : ""} />

      {open?.kind === "new" || open?.kind === "edit" ? (
        <UserForm
          user={open.kind === "edit" ? open.user : null}
          groups={groups}
          catalogue={catalogue}
          perms={me.perms}
          submit={(body) => store.track(() => (open.kind === "edit"
            ? Promise.all([
              api.adminUpdateUser(open.user.id, { full_name: body.full_name, email: body.email, is_active: body.is_active }),
              api.adminSetUserGroups(open.user.id, body.group_ids),
            ])
            : api.adminCreateUser(body)))}
          onSaved={async () => {
            toast(t(open.kind === "edit" ? "admin.saved" : "admin.created"));
            setOpen(null);
            await admin.reload();
          }}
          onRefused={(err) => toast(refusedFor(t, open.user?.fullName || open.user?.username || "", err), "error")}
          onClose={() => setOpen(null)}
        />
      ) : null}

      {open?.kind === "scope" ? (
        <ScopeEditor
          user={open.user}
          scope={open.scope}
          mayAssign={canAssignScope(myScope)}
          save={(grants) => store.track(() => api.setScope(open.user.id, grants))}
          onSaved={async () => {
            toast(doneFor(t, open.user.fullName || open.user.username, t("admin.scopeSaved")));
            setOpen(null);
            await rereadScope(open.user);
          }}
          onRefused={(err) => toast(refusedFor(t, open.user.fullName || open.user.username, err), "error")}
          onClose={() => setOpen(null)}
        />
      ) : null}

      {CONFIRMATIONS[open?.kind] ? (
        <Confirm
          user={open.user}
          kind={open.kind}
          busy={busyId === open.user.id}
          onConfirm={async (reason) => {
            const done = await write(open.user, CONFIRMATIONS[open.kind].run(api, open.user, reason),
              t(CONFIRMATIONS[open.kind].done));
            if (done) setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

/** The three destructive writes and the unlock: what each one asks, what it sends and what it says
 *  afterwards. Each confirmation NAMES the account and the consequence — resetting a password or an
 *  authenticator ENDS that user's open sessions, and so does deactivating. */
const CONFIRMATIONS = {
  password: {
    title: "admin.resetPassword", body: "admin.confirmResetPassword", done: "admin.passwordReset",
    password: true,
    run: (api, user, password) => () => api.adminResetPassword(user.id, password),
  },
  mfa: {
    title: "admin.resetMfa", body: "admin.confirmResetMfa", done: "admin.mfaReset",
    run: (api, user) => () => api.adminResetMfa(user.id),
  },
  deactivate: {
    title: "admin.deactivate", body: "admin.confirmDeactivate", done: "admin.deactivated",
    run: (api, user) => () => api.adminUpdateUser(user.id, { is_active: false }),
  },
  activate: {
    title: "admin.activate", body: "admin.confirmDeactivate", done: "admin.activated",
    run: (api, user) => () => api.adminUpdateUser(user.id, { is_active: true }),
  },
  unlock: {
    title: "admin.unlockSignIn", body: "admin.confirmUnlock", done: "admin.unlocked",
    reason: true,
    run: (api, user, reason) => () => api.adminUnlockSignIn(user.id, reason),
  },
};

/** One confirmation. While the request is in flight the dialog CANNOT be dismissed (`Modal busy`):
 *  a refusal must land in an open form, or an administrator is told nothing about a write that did
 *  not happen. The unlock's reason is checked for the one thing the server will certainly refuse
 *  (nothing readable in it) before a request is sent, and the sentence says it is audited. */
function Confirm({ user, kind, busy, onConfirm, onClose }) {
  const { t } = useI18n();
  const spec = CONFIRMATIONS[kind];
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState(null);
  const name = user.fullName || user.username;

  const confirm = () => {
    if (spec.reason && !/[\p{L}\p{N}]/u.test(reason)) {
      setProblem(t("errors.reasonNeedsText"));
      return;
    }
    if (spec.password && password.length < 8) {
      setProblem(t("errors.passwordTooShort"));
      return;
    }
    setProblem(null);
    onConfirm(spec.reason ? reason.trim() : password);
  };

  return (
    <Modal
      open
      title={t(spec.title)}
      busy={busy}
      onClose={onClose}
      actions={(
        <>
          <Button onClick={onClose} busy={busy}>{t("admin.cancel")}</Button>
          <Button variant={kind === "activate" ? "primary" : "danger"} busy={busy} onClick={confirm}>
            {t(spec.title)}
          </Button>
        </>
      )}
    >
      <p className="m-0 mb-3 text-14">{t(spec.body, { name })}</p>
      {spec.password ? (
        <Field layout="col" required label={t("admin.fieldPassword")} hint={t("admin.fieldPasswordHint")} error={problem}>
          <Input type="password" autoComplete="new-password" value={password} disabled={busy}
            onChange={(e) => { setPassword(e.target.value); setProblem(null); }} />
        </Field>
      ) : null}
      {spec.reason ? (
        <Field layout="col" required label={t("admin.reasonLabel")} hint={t("admin.reasonHint")} error={problem}>
          <Input value={reason} maxLength={200} disabled={busy}
            onChange={(e) => { setReason(e.target.value); setProblem(null); }} />
        </Field>
      ) : null}
      <Announce text={busy ? t("admin.saving") : ""} />
    </Modal>
  );
}
```

- [ ] **Step 4: Run it, one group at a time**

```bash
npx vitest run src/live/screens/admin/UsersTab.test.jsx -t "the list" 2>&1 | grep -E "Tests "
npx vitest run src/live/screens/admin/UsersTab.test.jsx -t "what a desk may not do" 2>&1 | grep -E "Tests "
npx vitest run src/live/screens/admin/UsersTab.test.jsx -t "the form" 2>&1 | grep -E "Tests "
npx vitest run src/live/screens/admin/UsersTab.test.jsx -t "the three confirmations" 2>&1 | grep -E "Tests "
npx vitest run src/live/screens/admin/UsersTab.test.jsx -t "the scope editor" 2>&1 | grep -E "Tests "
npx vitest run src/live/screens/admin/UsersTab.test.jsx 2>&1 | grep -E "Tests "
```
Expected, in order:
```
Tests  11 passed | 25 skipped (36)
Tests  4 passed | 32 skipped (36)
Tests  6 passed | 30 skipped (36)
Tests  5 passed | 31 skipped (36)
Tests  7 passed | 29 skipped (36)
Tests  36 passed (36)
```
(10 + 4 + 6 + 5 + 7 = 32, plus four under `accessibility`; `-t "the list"` also matches `accessibility`'s "the list is a table with a caption…", which is why its line says 11.)

**Six things that will bite, all six met while this was written.**

1. **`DESK` has to be the whole catalogue.** `canManageUser` refuses a user whose own rights exceed the desk's, and a nurse holds `alerts.ack` — so a desk of `["users.manage", "groups.manage", "board.view"]` may not act on a nurse, and **every** action test silently asserts the refusal instead of the action. The narrow desks are passed by name, by the tests that are about a refusal.
2. **jsdom does not implement `inert`.** `Modal` sets it on every other `<body>` child, so in a browser the tab's own role filter is unreachable behind an open form — but in jsdom it is still queryable, and `admin.filterRole` and `admin.fieldRole` are both "Rol". Queries inside a dialog go through `within(screen.getByRole("dialog"))`.
3. **The row header is `hs.aygunLokal`.** The username cell carries the login and, under it, where the account comes from; `textContent` concatenates them.
4. **`cleanup()`, never `document.body.innerHTML = ""`.** The dialogs and the toast stack are React portals under `<body>`; blanking the body leaves React unmounting nodes that are no longer its children ("The node to be removed is not a child of this node").
5. **"No alert" is "every alert region is empty", never `toHaveLength(0)`.** The toast's error region is a `role="alert"` div mounted before the first toast (`ui/Toast.jsx`), so `queryAllByRole("alert")` is never empty; `expectConfirmed` joins the regions' text and asserts it is blank. A success test written with `toHaveLength(0)` fails on every success.
6. **A confirmation is found by its text, twice.** It goes to the polite region, which is an `aria-live` div with no `role`, and to the visible toast — so `getAllByText(/…/)` with a regex, never `getByText` with a string.

- [ ] **Step 5: Take this arm's two lines.** In `dashboard/src/live/screens/admin/AdminScreen.jsx`, replace

```jsx
// G1-12: import { UsersTab } from "./UsersTab.jsx";
```

with

```jsx
import { UsersTab } from "./UsersTab.jsx";
```

and replace

```jsx
  users: null, //    G1-12
```

with

```jsx
  users: UsersTab, //    G1-12
```

Leave the blank lines on either side alone (Decision 20).

- [ ] **Step 6: Run the frame and the sweep, which now have a tab to see**

```bash
npx vitest run src/live/screens/admin/ src/live/rawKeys.test.jsx 2>&1 | grep -E "Tests "
```
Expected: `Tests  112 passed (112)` — `catalogue` 9, `rules` 34, `refusal` 5, `AdminScreen` 19, `admin.testutil` 4, `UsersTab` 36; plus `rawKeys` 5, which now opens `#/admin`, clicks the one tab there is and sweeps it.

- [ ] **Step 7: Look at it** — the one check no test makes.

Run `npx vite dev`, sign in as an administrator, open `#/admin`.

Check, at **1440 px** and at **390 px**, in **both themes**:
- no horizontal **page** scroll at 390 px. The eight-column table scrolls inside its own frame, which `ui/Table.jsx` turns into a named `role="region"` with `tabindex="0"` when it overflows — confirm you can reach it with `Tab` and scroll it with the arrow keys, because that is the only way a keyboard user sees the last three columns;
- the search field, the role filter and "Yeni istifadəçi" wrap onto separate lines rather than squeezing;
- every row's action buttons are reachable with a thumb and none of them is cut off at the right edge;
- open the form: no field is clipped, the password field is a password field (dots, not letters), and the footer's two buttons stay visible while the body scrolls;
- open the scope editor on a user with no grants and on one with several; the unit and bed check lists and the manual field all fit;
- the status colours (`AKTİV`, `Passiv`, `ilk girişdə şifrə`, `Məcburi · qurulmayıb`) still clear 3:1 against `card` in daylight;
- press a destructive action and then `Escape` **while it is in flight**: the dialog must not close.

Then sign in with only `users.manage` and confirm the roles tab is absent rather than present-and-refusing.

- [ ] **Step 8: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  104 passed (104)`, `Tests  2199 passed (2199)` (+36 on Task 4's 2163), build clean. **This task's own number is 36, in `UsersTab.test.jsx`.**

- [ ] **Step 9: Commit**

```bash
git status --short
git add dashboard/src/live/screens/admin/UsersTab.jsx dashboard/src/live/screens/admin/UsersTab.test.jsx dashboard/src/live/screens/admin/AdminScreen.jsx
git commit -m "$(cat <<'EOF'
feat(dashboard): the users and units tab (G1-12)

Eight columns, a search that folds diacritics and says how much it hides, and
a list that admits it loaded the whole hospital -- GET /admin/users has no
limit and no cursor, so the tab renders fifty rows at a time and says so,
rather than quietly depending on having them all.

A refused action is not drawn and its reason is in the row once: the keys this
desk lacks, or that the user's rights are unknown, or that it is your own
account. The units column claims nothing it has not read, because there is no
bulk scope read. Every refusal is on the toast, named after the account, and
every write reloads from the server rather than trusting what it hoped.

A password is never in the DOM after its dialog closes, and a dialog cannot be
dismissed while its write is in flight.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** **36** tests in the new `UsersTab.test.jsx`; `104 / 2199`; build clean; looked at 390/1440 px in both themes, with the in-flight Escape tried.

---

# G1-13 · the roles arm (Tasks 8–9, branch `feat/w3b-roles`)

### Task 8: The roles namespace, in four languages — and the permission descriptions

**Files:**
- Create: `dashboard/src/live/i18n/strings/roles.js`, `dashboard/src/live/i18n/strings/perms.js`
- Modify: `dashboard/src/live/i18n/catalog.js` (this arm's two lines), `dashboard/src/live/i18n/strings.test.js` (this arm's two blocks)

- [ ] **Step 1: Write the namespace.** Create `dashboard/src/live/i18n/strings/roles.js`:

```javascript
// Administration · Roles and permissions (G1-13) — the group × permission table.
//
// Sources: `Roller ve yetkiler` / `Yetki` / `Rol olmayan ekler` / `kişinin rolüne yetki ekler` /
// `Varsayılana dön` / `Korunan yetki` are the prototype's own four-language dictionary entries
// (`admin.js tabRoles`). Everything about SAVING is new, because the prototype has no save: its
// checkboxes write to `localStorage` on the click (`admin.js:874-882`, and the design note's item
// 13). AZ/RU/EN await a native speaker's review before the pilot.
//
// Three of the prototype's own role-card lines are deliberately NOT here:
//   * "Hasta adını görür" — no such flag exists in the API; field-level redaction is open item E2.
//   * "Gerçek üründe → ATTENDING · ASSOCIATE · …" — the legacy role mapping was consumed by
//     migration 0010 and is gone.
//   * "kutucuklar anında uygulanır" — the exact opposite of what this tab does.
//
// No "view as this role" switch (the design note's item 14). A view that imitates a permission
// makes the audit trail unable to say who saw what; the honest version of "what does a nurse
// see" is a read-only preview computed from this table and the route table, which is Group 2's.
//
// The permission DESCRIPTIONS are not here: they are in `strings/perms.js`, by permission key,
// in four languages, because the server's own (`auth/permissions.PERMISSIONS`, served by
// `/admin/permissions`) are English developer prose and an administrator setting rights on an
// Azerbaijani screen must be able to read what she grants. The server's text is shown only as the
// `lang="en"` fallback for a key this build does not know. Two of the server's texts are out of
// date (`users.manage`, `devices.manage`) — a backend text change, recorded in the plan's
// documents task; the dashboard's own texts are written from what the permissions actually gate.
export default {
  tr: {
    title: "Roller ve yetkiler",
    sub: "Bir kutucuk değişikliği toplar; her grubun kendi «Kaydet»i o grubun yetki listesini tek istekte gönderir ve denetim kaydına yazılır. Gruplar ayrı ayrı kaydedilir.",
    caption: "Gruplar ve yetkileri",
    colPermission: "Yetki",
    members: "{count} kişi",
    membersUnknown: "Üye sayısı okunamadı",
    mfaOn: "2FA zorunlu",
    mfaOff: "2FA zorunlu değil",
    cell: "{group} · {permission}",
    pending: "{count} değişiklik bekliyor",
    save: "Kaydet",
    saving: "Kaydediliyor…",
    saved: "yetkiler kaydedildi.",
    discard: "Değişiklikleri geri al",
    systemLocked: "Sistem grubu bütün yetkilere sahiptir ve buradan değiştirilemez.",
    cannotGrant: "Bu grubun yetkileri sizinkini aşıyor; değiştiremezsiniz.",
    noCatalogue: "Yetki kataloğu okunamadı; tablo çizilemiyor. «groups.manage» yetkisi gerekir.",
    noGroups: "Hiç grup okunamadı.",
    // creating and deleting a group
    newGroup: "Yeni grup",
    formNew: "Yeni grup",
    fieldSlug: "Kısa ad",
    fieldSlugHint: "2-64 karakter, küçük harf, rakam ve _ · sonradan değiştirilemez",
    fieldName: "Görünen ad",
    fieldDescription: "Açıklama",
    fieldMfa: "Bu grup için iki adımlı doğrulama zorunlu",
    create: "Grubu oluştur",
    created: "oluşturuldu.",
    cancel: "Vazgeç",
    remove: "Grubu sil",
    confirmRemove: "{group} silinecek. Üyesi olan ya da AD eşlemesi olan bir grup silinemez; sunucu reddederse neden burada yazılır.",
    removed: "silindi.",
    // what the table is, and what it is not
    cellPending: "değişiklik bekliyor",
    catalogueUnread: "Yetki kataloğu okunamadı; tablo çizilemiyor.",
    reread: "{group}: kayıt bu arada başka biri tarafından değiştirildi; sütun sunucudan yeniden okundu. İşaretlediğiniz değişiklikler duruyor — yeni duruma göre gözden geçirip tekrar kaydedin.",
    undescribed: "Bu grup, kataloğun tanımlamadığı bir yetki taşıyor ({keys}). Buradan kaydedilseydi o yetki sessizce kaldırılırdı; bu yüzden sütun yalnız okunuyor.",
    note: "Yetki denetimi sunucuda yapılır: bu tablo neyin verildiğini gösterir, neyin görüneceğini değil. Menüden gizlemek yetki kaldırmak değildir.",
  },
  az: {
    title: "Rollar və səlahiyyətlər",
    sub: "Qeyd qutusu dəyişikliyi toplayır; hər qrupun öz «Yadda saxla»sı o qrupun səlahiyyət siyahısını bir sorğuda göndərir və audit jurnalına yazılır. Qruplar ayrı-ayrı yadda saxlanılır.",
    caption: "Qruplar və səlahiyyətləri",
    colPermission: "Səlahiyyət",
    members: "{count} nəfər",
    membersUnknown: "Üzv sayı oxunmadı",
    mfaOn: "2FA məcburi",
    mfaOff: "2FA məcburi deyil",
    cell: "{group} · {permission}",
    pending: "{count} dəyişiklik gözləyir",
    save: "Yadda saxla",
    saving: "Yadda saxlanılır…",
    saved: "səlahiyyətlər yadda saxlanıldı.",
    discard: "Dəyişiklikləri geri al",
    systemLocked: "Sistem qrupu bütün səlahiyyətlərə sahibdir və buradan dəyişdirilə bilməz.",
    cannotGrant: "Bu qrupun səlahiyyətləri sizinkini aşır; dəyişdirə bilmərsiniz.",
    noCatalogue: "Səlahiyyət kataloqu oxunmadı; cədvəl çəkilə bilmir. «groups.manage» səlahiyyəti lazımdır.",
    noGroups: "Heç bir qrup oxunmadı.",
    newGroup: "Yeni qrup",
    formNew: "Yeni qrup",
    fieldSlug: "Qısa ad",
    fieldSlugHint: "2-64 simvol, kiçik hərf, rəqəm və _ · sonradan dəyişdirilə bilməz",
    fieldName: "Görünən ad",
    fieldDescription: "Təsvir",
    fieldMfa: "Bu qrup üçün iki addımlı doğrulama məcburidir",
    create: "Qrupu yarat",
    created: "yaradıldı.",
    cancel: "İmtina",
    remove: "Qrupu sil",
    confirmRemove: "{group} silinəcək. Üzvü olan və ya AD uyğunlaşdırması olan qrup silinə bilməz; server qəbul etməzsə səbəb burada yazılır.",
    removed: "silindi.",
    cellPending: "dəyişiklik gözləyir",
    catalogueUnread: "Səlahiyyət kataloqu oxunmadı; cədvəl çəkilə bilmir.",
    reread: "{group}: qeyd bu arada başqası tərəfindən dəyişdirildi; sütun serverdən yenidən oxundu. İşarələdiyiniz dəyişikliklər qalır — yeni vəziyyətə görə nəzərdən keçirib yenidən yadda saxlayın.",
    undescribed: "Bu qrup kataloqun təsvir etmədiyi bir səlahiyyət daşıyır ({keys}). Buradan yadda saxlansaydı o səlahiyyət səssizcə götürülərdi; ona görə sütun yalnız oxunur.",
    note: "Səlahiyyət yoxlanışı serverdə aparılır: bu cədvəl nəyin verildiyini göstərir, nəyin görünəcəyini deyil. Menyudan gizlətmək səlahiyyəti götürmək deyil.",
  },
  ru: {
    title: "Роли и права",
    sub: "Флажок собирает изменение; «Сохранить» у каждой группы отправляет список её прав одним запросом и пишет в журнал аудита. Группы сохраняются по отдельности.",
    caption: "Группы и их права",
    colPermission: "Право",
    members: "Человек: {count}",
    membersUnknown: "Число участников не прочитано",
    mfaOn: "2FA обязательна",
    mfaOff: "2FA не обязательна",
    cell: "{group} · {permission}",
    pending: "Ожидают изменения: {count}",
    save: "Сохранить",
    saving: "Сохраняется…",
    saved: "права сохранены.",
    discard: "Отменить изменения",
    systemLocked: "Системная группа имеет все права, и отсюда её изменить нельзя.",
    cannotGrant: "Права этой группы превышают ваши; изменить их нельзя.",
    noCatalogue: "Каталог прав не прочитан; таблицу построить нельзя. Нужно право «groups.manage».",
    noGroups: "Ни одной группы не прочитано.",
    newGroup: "Новая группа",
    formNew: "Новая группа",
    fieldSlug: "Краткое имя",
    fieldSlugHint: "2-64 знака, строчные буквы, цифры и _ · изменить позже нельзя",
    fieldName: "Отображаемое имя",
    fieldDescription: "Описание",
    fieldMfa: "Для этой группы двухшаговая проверка обязательна",
    create: "Создать группу",
    created: "создана.",
    cancel: "Отмена",
    remove: "Удалить группу",
    confirmRemove: "{group} будет удалена. Группу с участниками или с сопоставлением AD удалить нельзя; если сервер откажет, причина будет здесь.",
    removed: "удалена.",
    cellPending: "ожидает изменения",
    catalogueUnread: "Каталог прав не прочитан; таблицу построить нельзя.",
    reread: "{group}: запись тем временем изменил кто-то другой; столбец перечитан с сервера. Отмеченные вами изменения сохранены на экране — пересмотрите их по новому состоянию и сохраните снова.",
    undescribed: "Группа держит право, которого нет в каталоге ({keys}). Сохранение отсюда молча сняло бы его, поэтому столбец только для чтения.",
    note: "Проверка прав выполняется на сервере: эта таблица показывает, что выдано, а не что будет видно. Спрятать в меню — не значит снять право.",
  },
  en: {
    title: "Roles and permissions",
    sub: "A checkbox collects a change; each group's own Save sends that group's permission list in one request and writes it to the audit trail. Groups are saved one at a time.",
    caption: "Groups and their permissions",
    colPermission: "Permission",
    members: "People: {count}",
    membersUnknown: "The member count could not be read",
    mfaOn: "Two-step verification required",
    mfaOff: "Two-step verification not required",
    cell: "{group} · {permission}",
    pending: "{count} pending changes",
    save: "Save",
    saving: "Saving…",
    saved: "the permissions were saved.",
    discard: "Discard the changes",
    systemLocked: "The system group holds every permission and cannot be changed here.",
    cannotGrant: "This group's permissions exceed your own; you cannot change them.",
    noCatalogue: "The permission catalogue could not be read, so the table cannot be drawn. It needs \"groups.manage\".",
    noGroups: "No group could be read.",
    newGroup: "New group",
    formNew: "New group",
    fieldSlug: "Short name",
    fieldSlugHint: "2-64 characters, lower-case letters, digits and _ · cannot be changed later",
    fieldName: "Display name",
    fieldDescription: "Description",
    fieldMfa: "Two-step verification is required for this group",
    create: "Create the group",
    created: "was created.",
    cancel: "Cancel",
    remove: "Delete the group",
    confirmRemove: "{group} will be deleted. A group with members, or with an AD mapping, cannot be deleted; if the server refuses, the reason appears here.",
    removed: "was deleted.",
    cellPending: "change pending",
    catalogueUnread: "The permission catalogue could not be read, so the table cannot be drawn.",
    reread: "{group}: the record was changed by somebody else meanwhile; the column was re-read from the server. The changes you ticked are still here — review them against the new state and save again.",
    undescribed: "This group holds a permission the catalogue does not describe ({keys}). Saving from here would silently revoke it, so the column is read-only.",
    note: "Permissions are checked on the server: this table shows what has been granted, not what will be visible. Hiding something in a menu is not taking a permission away.",
  },
};
```

- [ ] **Step 1a: Write the permission descriptions, by key.** `/admin/permissions` serves English developer prose and the roles table is where an administrator decides what a nurse may do (Decision 13). Create `dashboard/src/live/i18n/strings/perms.js`:

```javascript
// Administration · the permission catalogue's descriptions (G1-13), by permission key.
//
// `/admin/permissions` serves `{key, description}` and the descriptions are ENGLISH DEVELOPER
// PROSE (`auth/permissions.PERMISSIONS`: "Acknowledge or snooze an alert"). They are not the
// hospital's words and they are not in the reader's language, and the roles table is the screen
// on which an administrator decides what a nurse may do — a mis-read permission there is a
// misconfiguration. So they are translated here, in four languages, keyed by the permission key
// itself: `perms.alerts.ack`, with the key's dots as nesting. A key the server serves and this
// file does not know falls back to the server's own text, marked `lang="en"` (RolesTab.jsx), and
// the roles arm's test holds this file to the catalogue so that fallback is never silently the
// rule.
//
// Twenty-one short, static sentences keyed by a stable identifier are ordinary dashboard strings,
// not product copy: the same mechanism every other string uses. The keys are NOT translated —
// `alerts.ack` is printed beside each description, because it is what a support call quotes.
// AZ/RU/EN await a native speaker's review before the pilot.
export default {
  tr: {
    board: { view: "Canlı panoyu, hasta ayrıntısını ve olay akışını görür" },
    alerts: {
      ack: "Alarmı görüldü olarak işaretler ya da erteler",
      escalate: "Elle alarm oluşturur; alarmı yükseltir",
    },
    admissions: {
      view: "Kabul ve hasta kayıtlarını okur",
      admit: "Kabul kaydı açar",
      sign_off: "Kabulü hekim olarak onaylar",
      move: { initiate: "Transfer ya da taburcu başlatır" },
      transfer: { confirm: "Transferle gelişi onaylar" },
      discharge: { confirm: "Taburcuyu onaylar; yatağı boşaltır" },
    },
    care_team: {
      claim: "Bir hastanın bakım ekibinde rol üstlenir",
      assign: "Başkalarını bir hastanın bakım ekibine atar",
    },
    handover: { sign: "Devri imzalar ya da karşı imzalar" },
    shifts: { manage: "Nöbet çizelgesi oluşturur" },
    break_glass: { use: "Acil erişim oturumu açar, uzatır ya da kapatır" },
    audit: { view: "Denetim kaydını okur" },
    users: { manage: "Kullanıcıları yönetir: oluşturma, düzenleme, etkinleştirme, şifre ve 2FA sıfırlama, dizin girişini açma, grup atama; AD hesaplarını arayıp aktarır, AD grup eşlemesini okur (eşlemeyi değiştirmek her yetkiyi gerektirir)" },
    groups: { manage: "Grupları ve yetki kümelerini yönetir" },
    structure: { manage: "Kurum, tesis, birim, oda ve yatak yapılandırması" },
    devices: { manage: "Cihaz ve araştırma uç noktaları" },
    clinical: { chart: "Klinisyenin gözlemlediği girdileri (enfeksiyon şüphesi, vazopresör, sıvı, GKS…) ve hastanın kendi bazalını kaydeder" },
    scores: { sign: "Ağırlık skoru formunu (SOFA) düzeltmelerle imzalar" },
  },
  az: {
    board: { view: "Canlı paneli, xəstə təfərrüatını və hadisə axınını görür" },
    alerts: {
      ack: "Siqnalı görüldü kimi işarələyir və ya təxirə salır",
      escalate: "Əl ilə siqnal yaradır; siqnalı eskalasiya edir",
    },
    admissions: {
      view: "Qəbul və xəstə qeydlərini oxuyur",
      admit: "Qəbul qeydi açır",
      sign_off: "Qəbulu həkim kimi təsdiqləyir",
      move: { initiate: "Köçürmə və ya evə yazılma başladır" },
      transfer: { confirm: "Köçürmə ilə gəlişi təsdiqləyir" },
      discharge: { confirm: "Evə yazılmanı təsdiqləyir; çarpayını boşaldır" },
    },
    care_team: {
      claim: "Bir xəstənin baxım komandasında rol götürür",
      assign: "Başqalarını xəstənin baxım komandasına təyin edir",
    },
    handover: { sign: "Təhvili imzalayır və ya qarşı imzalayır" },
    shifts: { manage: "Növbə cədvəli yaradır" },
    break_glass: { use: "Təcili giriş sessiyası açır, uzadır və ya bağlayır" },
    audit: { view: "Audit jurnalını oxuyur" },
    users: { manage: "İstifadəçiləri idarə edir: yaratma, redaktə, aktivləşdirmə, şifrə və 2FA sıfırlama, kataloq girişini açma, qrup təyin etmə; AD hesablarını axtarıb idxal edir, AD qrup uyğunlaşdırmasını oxuyur (uyğunlaşdırmanı dəyişmək hər səlahiyyəti tələb edir)" },
    groups: { manage: "Qrupları və səlahiyyət dəstlərini idarə edir" },
    structure: { manage: "Təşkilat, bina, şöbə, otaq və çarpayı konfiqurasiyası" },
    devices: { manage: "Cihaz və tədqiqat uç nöqtələri" },
    clinical: { chart: "Klinisistin müşahidə etdiyi məlumatları (infeksiya şübhəsi, vazopressor, maye, QKŞ…) və xəstənin öz bazal dəyərlərini qeyd edir" },
    scores: { sign: "Ağırlıq balı formasını (SOFA) düzəlişlərlə imzalayır" },
  },
  ru: {
    board: { view: "Видит живую панель, карточку пациента и ленту событий" },
    alerts: {
      ack: "Принимает или откладывает тревогу",
      escalate: "Создаёт тревогу вручную; эскалирует её",
    },
    admissions: {
      view: "Читает госпитализации и записи пациентов",
      admit: "Создаёт госпитализацию",
      sign_off: "Подписывает госпитализацию как врач",
      move: { initiate: "Начинает перевод или выписку" },
      transfer: { confirm: "Подтверждает прибытие по переводу" },
      discharge: { confirm: "Подтверждает выписку; освобождает койку" },
    },
    care_team: {
      claim: "Берёт роль в лечебной команде пациента",
      assign: "Назначает других в лечебную команду пациента",
    },
    handover: { sign: "Подписывает или контрподписывает передачу смены" },
    shifts: { manage: "Составляет графики смен" },
    break_glass: { use: "Открывает, продлевает или закрывает сеанс экстренного доступа" },
    audit: { view: "Читает журнал аудита" },
    users: { manage: "Управляет пользователями: создание, изменение, активация, сброс пароля и 2FA, открытие входа через каталог, назначение групп; ищет и импортирует записи AD, читает сопоставление групп AD (изменение сопоставления требует всех прав)" },
    groups: { manage: "Управляет группами и их наборами прав" },
    structure: { manage: "Настройка организации, корпусов, отделений, палат и коек" },
    devices: { manage: "Устройства и исследовательские конечные точки" },
    clinical: { chart: "Вносит наблюдения клинициста (подозрение на инфекцию, вазопрессор, инфузии, ШКГ…) и собственную базовую линию пациента" },
    scores: { sign: "Подписывает форму оценки тяжести (SOFA) с исправлениями" },
  },
  en: {
    board: { view: "See the live board, a patient's detail and the event stream" },
    alerts: {
      ack: "Acknowledge or snooze an alarm",
      escalate: "Create an alarm by hand; escalate one",
    },
    admissions: {
      view: "Read admissions and patient records",
      admit: "Create an admission",
      sign_off: "Sign off an admission as a physician",
      move: { initiate: "Initiate a transfer or a discharge" },
      transfer: { confirm: "Confirm a transfer arrival" },
      discharge: { confirm: "Confirm a discharge and release the bed" },
    },
    care_team: {
      claim: "Claim a care-team role on a patient",
      assign: "Assign others to a patient's care team",
    },
    handover: { sign: "Sign or countersign a handover" },
    shifts: { manage: "Create shift schedules" },
    break_glass: { use: "Open, extend or close an emergency-access session" },
    audit: { view: "Read the audit trail" },
    users: { manage: "Manage users: create, edit, activate, reset a password or 2FA, lift a directory sign-in throttle, set groups; search and import AD accounts and read the AD group mapping (changing the mapping needs every permission)" },
    groups: { manage: "Manage groups and their permission sets" },
    structure: { manage: "Configure the tenant, sites, units, rooms and beds" },
    devices: { manage: "Device and research endpoints" },
    clinical: { chart: "Chart clinician-observed inputs (suspected infection, pressor, fluids, GCS…) and the patient's own baseline" },
    scores: { sign: "Sign a severity-score form (SOFA) with corrections" },
  },
};
```

The keys nest by the permission key's own dots (`perms.admissions.move.initiate`), which `catalog.js` flattens; the key itself is never translated. Task 9's test holds this file to every key of `PERMISSION_KEYS` in all four languages, so the server-English fallback is a fallback and not the rule.

- [ ] **Step 2: Take this arm's two lines in the catalogue.** Both namespaces go on this arm's lines — the `perms` import beside the `roles` one, and `perms` on the same `NAMESPACES` line — so the seam's gaps are untouched. In `dashboard/src/live/i18n/catalog.js`, replace

```javascript
// G1-13: import roles from "./strings/roles.js";
```

with

```javascript
import roles from "./strings/roles.js";
import perms from "./strings/perms.js";
```

and replace

```javascript
  // G1-13: roles,
```

with

```javascript
  roles, perms,
```

- [ ] **Step 3: List this arm's two reviewed identities.** In `dashboard/src/live/i18n/strings.test.js`, replace

```javascript
  // G1-13 (admin · roles) · neutral
```

with

```javascript
  // G1-13 (admin · roles) · neutral
  "roles.cell", //                "{group} · {permission}" — punctuation; the two names are the words
```

and replace

```javascript
  // G1-13 (admin · roles) · az = tr
```

with

```javascript
  // G1-13 (admin · roles) · az = tr
  "roles.cell", //           "{group} · {permission}" — punctuation, no words of its own
  "roles.removed", //        "silindi." — the same past passive in Azerbaijani (the subject is doneFor's)
```

`roles.cell` needs both entries: it is punctuation only, so it is identical in Azerbaijani and Turkish **and** carries no Cyrillic in Russian. `roles.removed` needs the second only. Nothing in `perms.js` needs an entry: all twenty-one differ between Azerbaijani and Turkish, and every Russian one carries Cyrillic.

- [ ] **Step 4: Check the parity, the placeholders and the scripts**

```bash
npx vitest run src/live/i18n/strings.test.js 2>&1 | grep -E "Tests |→"
```
Expected: `Tests  6 passed (6)`. If it reports `az roles.<key> = tr "…": review, then list it`, that key's two texts are identical and either the Azerbaijani is wrong or the identity is real and belongs in the list — **decide which, do not just add it**. The two above were decided: a middle dot is a middle dot, and "silindi" is the same word.

- [ ] **Step 5: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  103 passed (103)`, `Tests  2163 passed (2163)`, build clean — the two namespaces are loaded and nothing reads them yet.

- [ ] **Step 6: Commit**

```bash
git status --short
git add dashboard/src/live/i18n/strings/roles.js dashboard/src/live/i18n/strings/perms.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js
git commit -m "$(cat <<'EOF'
feat(dashboard): the roles-and-permissions namespace in four languages (G1-13)

Everything about SAVING is new copy, because the prototype has no save: its
matrix writes each checkbox to localStorage on the click. Three of its own
role-card lines are deliberately absent -- "sees the patient's name" (no such
flag exists), the legacy role mapping (consumed by migration 0010) and
"the boxes apply immediately", which is the opposite of what this tab does.

And the twenty-one permission descriptions, by permission key, in four
languages: the server's are English developer prose, and the roles table is
the screen on which an administrator decides what a nurse may do. The server's
text stays as the fallback for a key this build does not know, marked as
English.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** `103 / 2163` unchanged, `strings.test.js` green at 6.

---

### Task 9: The group × permission table (G1-13)

**Files:**
- Create: `dashboard/src/live/screens/admin/RolesTab.jsx` + `RolesTab.test.jsx`
- Modify: `dashboard/src/live/screens/admin/AdminScreen.jsx` (two lines)

- [ ] **Step 1: Write the whole failing test.** Create `dashboard/src/live/screens/admin/RolesTab.test.jsx`:

```jsx
// The group × permission table (G1-13). Synthetic groups only (admin.testutil.js).
//
// Every write that SUCCEEDS asserts two things: the confirmation the administrator reads, and that
// no alert region carries anything — a success that also announces a refusal is the Critical the
// patient arm shipped, and a test that asserts the API call alone cannot see it. The toast's error
// region is mounted before the first toast (ui/Toast.jsx), so "no alert" is "every alert region
// is empty", never "no alert element".
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { DICTIONARIES } from "../../i18n/catalog.js";
import { LANG_CODES } from "../../i18n/langs.js";
import { createTranslator } from "../../i18n/translate.js";
import perms from "../../i18n/strings/perms.js";
import { PERMISSION_KEYS } from "./catalogue.js";
import { ADMIN_READS, CATALOGUE, GROUPS, NURSE_GROUP, SYSTEM_GROUP, WARD_GROUP, group } from "./admin.testutil.js";
import { groupFromApi } from "./rules.js";
import {
  RolesTab, descriptionOf, isOn, listToSend, lockedBecause, pendingFor, undescribedKeys,
} from "./RolesTab.jsx";

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const DESK = [...PERMISSION_KEYS];
/** A catalogue of four rows: the table is groups × catalogue, and twenty-one rows in a test is
 *  noise. The catalogue's own descriptions are the server's ENGLISH (admin.testutil.js); what the
 *  screen shows is the dashboard's text for the key (strings/perms.js), so the names the tests
 *  look cells up by come from that dictionary, not from the fixture. */
const FOUR = CATALOGUE.filter((row) => ["board.view", "alerts.ack", "users.manage", "groups.manage"].includes(row.key));
const AZ = perms.az;
const D = { boardView: AZ.board.view, alertsAck: AZ.alerts.ack, usersManage: AZ.users.manage, groupsManage: AZ.groups.manage };
const PENDING = "dəyişiklik gözləyir";
const rx = (text) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

async function open({ perms: desk = DESK, groups = GROUPS, catalogue = FOUR, setup } = {}) {
  const reload = vi.fn(async () => {});
  const admin = {
    data: { users: [], groups: groups.map(groupFromApi), catalogue, unassigned: 0 },
    loading: false, error: null, reload,
  };
  const mounted = await mount(<RolesTab admin={admin} />, {
    access: token({ sub: "u-admin", perms: desk }),
    me: profile({ id: "u-admin", perms: desk }),
    setup: (api) => { ADMIN_READS(api); setup?.(api); },
  });
  return { ...mounted, admin, reload };
}

/** The checkbox at (group, permission), by the accessible name the cell carries — with or without
 *  the "· change pending" a changed cell appends to it. */
const cell = (groupName, description) => {
  const base = `${groupName} · ${description}`;
  return screen.getByRole("checkbox", { name: (name) => name === base || name === `${base} · ${PENDING}` });
};
const column = (name) => screen.getByRole("columnheader", { name });
const saveIn = async (col) => {
  await act(async () => { fireEvent.click(within(col).getByRole("button", { name: "Yadda saxla" })); await settle(); });
};
const alerts = () => screen.getAllByRole("alert").map((a) => a.textContent).join(" ");
const notes = () => screen.getAllByRole("note").map((n) => n.textContent).join(" ");

/** What a write that LANDED must look like to the administrator: the confirmation, and no alert. */
function expectConfirmed(text) {
  expect(screen.getAllByText(text).length, `confirmation ${text}`).toBeGreaterThan(0);
  expect(alerts().trim()).toBe("");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the pure parts", () => {
  const nurse = groupFromApi(NURSE_GROUP);

  it("a pending change wins over what the server holds, and nothing else does", () => {
    expect(isOn(nurse, "board.view", {})).toBe(true);
    expect(isOn(nurse, "users.manage", {})).toBe(false);
    expect(isOn(nurse, "board.view", { [`${nurse.id}|board.view`]: false })).toBe(false);
    expect(isOn(nurse, "users.manage", { [`${nurse.id}|users.manage`]: true })).toBe(true);
  });

  it("the list a Save sends is the catalogue's order, which makes two saves comparable", () => {
    expect(listToSend(nurse, FOUR, { [`${nurse.id}|users.manage`]: true }))
      .toEqual(["board.view", "alerts.ack", "users.manage"]);
  });

  it("a checkbox clicked twice is not a pending change", () => {
    expect(pendingFor(nurse, { [`${nurse.id}|board.view`]: false })).toBe(1);
    expect(pendingFor(nurse, { [`${nurse.id}|board.view`]: true })).toBe(0);
    expect(pendingFor(nurse, { "g-other|board.view": false })).toBe(0);
  });

  it("the system group is locked first, a group beyond the desk's rights second, and one holding a key the catalogue does not describe third", () => {
    expect(lockedBecause(groupFromApi(SYSTEM_GROUP), DESK, FOUR)).toEqual({ key: "errors.systemGroupLocked", vars: {} });
    expect(lockedBecause(nurse, ["groups.manage"], FOUR)).toEqual({ key: "roles.cannotGrant", vars: {} });
    const ghostly = groupFromApi(group("gece_ekibi", { permissions: ["board.view", "ghost.key"] }));
    expect(undescribedKeys(ghostly, FOUR)).toEqual(["ghost.key"]);
    expect(lockedBecause(ghostly, DESK, FOUR)).toEqual({ key: "roles.undescribed", vars: { keys: "ghost.key" } });
    expect(lockedBecause(nurse, DESK, FOUR)).toBeNull();
  });

  it("describes every permission the dashboard knows in all four languages; the server's English is the fallback for a key this build does not know", () => {
    for (const lang of LANG_CODES) {
      const t = createTranslator(lang, DICTIONARIES);
      for (const key of PERMISSION_KEYS) {
        const shown = descriptionOf(t, { key, description: "the server's own words" });
        expect(shown.foreign, `${lang} ${key}`).toBe(false);
        expect(shown.text, `${lang} ${key}`).not.toBe("the server's own words");
        expect(shown.text, `${lang} ${key}`).not.toBe(`perms.${key}`);
      }
      expect(descriptionOf(t, { key: "ghost.key", description: "A right this build does not know" }))
        .toEqual({ text: "A right this build does not know", foreign: true });
    }
  });
});

describe("the table", () => {
  it("has the catalogue down the side in the reader's language with the key under it, and the groups across the top", async () => {
    await open();
    const table = screen.getByRole("table", { name: "Qruplar və səlahiyyətləri" });
    expect(within(table).getAllByRole("columnheader")[0]).toHaveTextContent("Səlahiyyət");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent).join(" "))
      .toContain("Hemşire");
    const row = within(table).getByRole("rowheader", { name: rx(D.boardView) });
    expect(row).toHaveTextContent("board.view");          // the key as well as the description
    expect(within(table).getAllByRole("rowheader")).toHaveLength(FOUR.length);
    // The dashboard's own words, not the server's English — and not marked as English either.
    expect(screen.queryByText("See the live board, patient detail and the event stream")).toBeNull();
    expect(table.querySelector('[lang="en"]')).toBeNull();
  });

  it("a key this build does not know is shown in the server's own words, marked as English", async () => {
    await open({ catalogue: [...FOUR, { key: "ghost.key", description: "A right this build does not know" }] });
    const shown = screen.getByText("A right this build does not know");
    expect(shown).toHaveAttribute("lang", "en");
    expect(screen.getByRole("rowheader", { name: /A right this build does not know/ })).toHaveTextContent("ghost.key");
  });

  it("shows each group's member count and its two-step rule", async () => {
    await open();
    expect(screen.getByText("4 nəfər")).toBeInTheDocument();
    expect(screen.getAllByText("2FA məcburi").length).toBeGreaterThan(0);   // the system group
    expect(screen.getAllByText("2FA məcburi deyil").length).toBeGreaterThan(0);
  });

  it("a member count the API did not send is \"not read\", never a zero", async () => {
    // `member_count` absent is a different statement from `member_count: 0` — "nobody is in this
    // group" is a claim, and it would be false for a group the API simply did not count.
    await open({ groups: [SYSTEM_GROUP, group("nurse", { member_count: undefined }), WARD_GROUP] });
    const nurse = column(/Hemşire/);
    expect(within(nurse).getByText("Üzv sayı oxunmadı")).toBeInTheDocument();
    expect(within(nurse).queryByText(/nəfər/)).toBeNull();
    expect(within(column(/Gece ekibi/)).getByText("2 nəfər")).toBeInTheDocument();
  });

  it("a cell reads as \"<group> · <permission>\" to a screen reader", async () => {
    await open();
    expect(cell("Hemşire", D.boardView)).toBeChecked();
    expect(cell("Hemşire", D.usersManage)).not.toBeChecked();
  });

  it("the sticky rule for the first column is on the scrolling frame — the class is all jsdom can see", async () => {
    await open();
    // `Table` puts `className` on the scrolling FRAME, which is where a sticky rule has to live:
    // `position: sticky` is relative to the nearest scroll container, and the container is the
    // frame, not the <table>. jsdom does not lay out, so the assertion is on the class, not on
    // the effect; the effect is checked in a browser.
    const frame = screen.getByRole("table", { name: "Qruplar və səlahiyyətləri" }).closest("div");
    expect(frame.className).toMatch(/\[&_th:first-child\]:sticky/);
    expect(frame.className).toMatch(/\[&_td:first-child\]:sticky/);
  });

  it("without a catalogue says the read failed — and blames a missing right only on a desk that lacks it", async () => {
    // A desk WITH groups.manage reaches an empty catalogue only when the read failed: the frame's
    // own Alert carries the server's reason, and this sentence must not invent a different one.
    await open({ catalogue: [] });
    expect(screen.getByText("Səlahiyyət kataloqu oxunmadı; cədvəl çəkilə bilmir.")).toBeInTheDocument();
    expect(screen.queryByText(/groups\.manage/)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    cleanup();
    await open({ catalogue: [], perms: ["board.view"] });
    expect(screen.getByText(/«groups\.manage» səlahiyyəti lazımdır/)).toBeInTheDocument();
  });
});

describe("collect and save", () => {
  it("a checkbox collects a change and sends nothing; the column says how many are pending, and the cell says so to a screen reader", async () => {
    const { api } = await open();
    fireEvent.click(cell("Hemşire", D.usersManage));
    expect(cell("Hemşire", D.usersManage)).toBeChecked();
    expect(screen.getByText("1 dəyişiklik gözləyir")).toBeInTheDocument();
    // The only visible marker of a pending cell is a tint, and a tint is not something a reader
    // is told: the cell's own name says it.
    expect(cell("Hemşire", D.usersManage)).toHaveAccessibleName(`Hemşire · ${D.usersManage} · ${PENDING}`);
    expect(cell("Hemşire", D.boardView)).toHaveAccessibleName(`Hemşire · ${D.boardView}`);
    expect(api.adminUpdateGroup).not.toHaveBeenCalled();
  });

  it("Save sends ONE PATCH with the whole list for that group, reloads, and reads as done", async () => {
    const { api, reload } = await open();
    api.adminUpdateGroup.mockResolvedValue(NURSE_GROUP);
    fireEvent.click(cell("Hemşire", D.usersManage));
    await saveIn(column(/Hemşire/));
    expect(api.adminUpdateGroup).toHaveBeenCalledTimes(1);
    expect(api.adminUpdateGroup).toHaveBeenCalledWith(NURSE_GROUP.id, {
      permissions: ["board.view", "alerts.ack", "users.manage"],
    });
    expectConfirmed(/Hemşire · səlahiyyətlər yadda saxlanıldı\./);
    expect(screen.queryByText("1 dəyişiklik gözləyir")).toBeNull();
    expect(reload).toHaveBeenCalled();
  });

  it("each group has its own Save: there is no transaction across groups and none is implied", async () => {
    // PATCH /admin/groups/{id} is atomic for ONE group and the API has no multi-group write, so a
    // single "save everything" button would promise atomicity the server cannot keep.
    await open();
    const saves = screen.getAllByRole("button", { name: "Yadda saxla" });
    // Every group but the system one (locked) has a Save of its own.
    expect(saves).toHaveLength(GROUPS.length - 1);
    expect(screen.getByText(/Qruplar ayrı-ayrı yadda saxlanılır/)).toBeInTheDocument();
  });

  it("a 403 keeps the pending changes, names the group on the toast, and does not re-read", async () => {
    const { api, reload } = await open();
    api.adminUpdateGroup.mockRejectedValue(refusal(403, "Kendi yetkilerinizi aşan bir işlem yapılamaz: users.manage"));
    fireEvent.click(cell("Hemşire", D.usersManage));
    await saveIn(column(/Hemşire/));
    expect(alerts()).toContain("Hemşire");
    expect(alerts()).toMatch(/users\.manage/);
    // The decision survives the refusal: it is what the administrator chose, and the server did
    // not take it.
    expect(cell("Hemşire", D.usersManage)).toBeChecked();
    expect(screen.getByText("1 dəyişiklik gözləyir")).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    expect(notes()).not.toMatch(/yenidən oxundu/);
  });

  it("a 409 re-reads the column, keeps the ticks, and says so in a Note — the refusal itself is announced once", async () => {
    // Another administrator saved this group between our read and our write. The PATCH body is
    // the whole list computed from a stale read and the server carries no client version: Save
    // again on the stale base would silently overwrite what she just saved.
    const { api, reload } = await open();
    api.adminUpdateGroup.mockRejectedValue(refusal(409, "Kayıt aynı anda değiştirildi; lütfen tekrar deneyin"));
    fireEvent.click(cell("Hemşire", D.usersManage));
    await saveIn(column(/Hemşire/));
    expect(alerts()).toContain("Hemşire");
    expect(alerts()).toContain("Qeyd eyni anda dəyişdirildi");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(cell("Hemşire", D.usersManage)).toBeChecked();
    expect(screen.getByText("1 dəyişiklik gözləyir")).toBeInTheDocument();
    expect(notes()).toMatch(/Hemşire: qeyd bu arada başqası tərəfindən dəyişdirildi; sütun serverdən yenidən oxundu/);
    expect(alerts()).not.toMatch(/yenidən oxundu/);
    // Discarding the ticks also closes the Note: there is nothing left to review.
    fireEvent.click(screen.getByRole("button", { name: "Dəyişiklikləri geri al: Hemşire" }));
    expect(notes()).not.toMatch(/yenidən oxundu/);
  });

  it("the changes can be discarded without sending anything", async () => {
    const { api } = await open();
    fireEvent.click(cell("Hemşire", D.usersManage));
    fireEvent.click(screen.getByRole("button", { name: "Dəyişiklikləri geri al: Hemşire" }));
    expect(screen.queryByText("1 dəyişiklik gözləyir")).toBeNull();
    expect(cell("Hemşire", D.usersManage)).not.toBeChecked();
    expect(api.adminUpdateGroup).not.toHaveBeenCalled();
  });

  it("a second column's Save during the first's flight is a real request, and the announcement names both", async () => {
    // Each PATCH is atomic for its group and the server serialises them on the tenant lock; a
    // press that silently did nothing would be an offered control that does nothing.
    const releases = [];
    const { api } = await open();
    api.adminUpdateGroup.mockImplementation(() => new Promise((resolve) => { releases.push(resolve); }));
    await saveIn(column(/Hemşire/));
    await saveIn(column(/Gece ekibi/));
    expect(api.adminUpdateGroup).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      const said = screen.getAllByRole("status").map((s) => s.textContent).join(" ");
      expect(said).toContain("Hemşire");
      expect(said).toContain("Gece ekibi");
    }, { timeout: 4000 });
    await act(async () => { releases.forEach((release) => release(NURSE_GROUP)); await settle(); });
  });
});

describe("what cannot be edited", () => {
  it("the system group's column is read-only with the server's own reason, and its cells are reachable and say why", async () => {
    await open();
    const col = column(/Sistem yöneticisi/);
    expect(col).toHaveTextContent("Sistem qrupunun səlahiyyətləri və iki addımlı doğrulama qaydası dəyişdirilə bilməz.");
    expect(within(col).queryByRole("button", { name: "Yadda saxla" })).toBeNull();
    const box = cell("Sistem yöneticisi", D.boardView);
    // `aria-disabled`, never `disabled`: a natively disabled checkbox is skipped in the Tab order
    // and tells a keyboard user nothing; this one is reached and points at the column's reason.
    expect(box).toHaveAttribute("aria-disabled", "true");
    expect(box).not.toBeDisabled();
    expect(document.getElementById(box.getAttribute("aria-describedby")))
      .toHaveTextContent("Sistem qrupunun səlahiyyətləri");
    // And it reads as holding EVERYTHING, which is what the API reports for it whatever is stored.
    for (const row of FOUR) expect(cell("Sistem yöneticisi", AZ[row.key.split(".")[0]][row.key.split(".")[1]])).toBeChecked();
    // A click on a locked cell changes nothing and collects nothing.
    fireEvent.click(box);
    expect(box).toBeChecked();
    expect(screen.queryByText(/dəyişiklik gözləyir/)).toBeNull();
  });

  it("a group whose rights exceed the session's is read-only, with its own reason", async () => {
    const strong = group("gece_yonetim", { name: "Gecə idarə", permissions: ["users.manage"] });
    await open({ perms: ["groups.manage", "board.view"], groups: [NURSE_GROUP, strong] });
    const col = column(/Gecə idarə/);
    expect(col).toHaveTextContent("Bu qrupun səlahiyyətləri sizinkini aşır; dəyişdirə bilmərsiniz.");
    expect(within(col).queryByRole("button", { name: "Yadda saxla" })).toBeNull();
    const box = cell("Gecə idarə", D.boardView);
    expect(box).toHaveAttribute("aria-disabled", "true");
    expect(box).not.toBeDisabled();
    fireEvent.click(box);
    expect(box).not.toBeChecked();
  });

  it("a group holding a key the catalogue does not describe is read-only, and the column names the key", async () => {
    // A Save built from the catalogue would drop that key — revoke a right the screen never
    // showed, silently. It cannot happen while /admin/permissions serves the whole catalogue, and
    // nothing enforces that it always will.
    const ghostly = group("gece_ekibi", { name: "Gece ekibi", permissions: ["board.view", "ghost.key"] });
    await open({ groups: [NURSE_GROUP, ghostly] });
    const col = column(/Gece ekibi/);
    expect(col).toHaveTextContent("Bu qrup kataloqun təsvir etmədiyi bir səlahiyyət daşıyır (ghost.key)");
    expect(within(col).queryByRole("button", { name: "Yadda saxla" })).toBeNull();
    expect(cell("Gece ekibi", D.boardView)).toHaveAttribute("aria-disabled", "true");
    expect(cell("Gece ekibi", D.boardView)).toBeChecked();
    // The other column is untouched by it.
    expect(within(column(/Hemşire/)).getByRole("button", { name: "Yadda saxla" })).toBeInTheDocument();
  });
});

describe("creating and deleting a group", () => {
  it("creating sends the slug, the name, the description, the MFA rule and the permissions — and reads as done", async () => {
    const { api, reload } = await open();
    api.adminCreateGroup.mockResolvedValue(WARD_GROUP);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni qrup" })); });
    const form = within(screen.getByRole("dialog"));
    fireEvent.change(form.getByLabelText(/Qısa ad/), { target: { value: "gece_ekibi" } });
    fireEvent.change(form.getByLabelText(/Görünən ad/), { target: { value: "Gecə ekibi" } });
    fireEvent.change(form.getByLabelText(/Təsvir/), { target: { value: "Gecə növbəsi" } });
    fireEvent.click(form.getByLabelText(/iki addımlı doğrulama məcburidir/));
    fireEvent.click(form.getByRole("checkbox", { name: rx(D.boardView) }));
    await act(async () => { fireEvent.click(form.getByRole("button", { name: "Qrupu yarat" })); await settle(); });
    expect(api.adminCreateGroup).toHaveBeenCalledWith({
      slug: "gece_ekibi", name: "Gecə ekibi", description: "Gecə növbəsi",
      mfa_required: true, permissions: ["board.view"],
    });
    expectConfirmed(/Gecə ekibi · yaradıldı\./);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(reload).toHaveBeenCalled();
  });

  it("a duplicate slug's 409 lands on the slug field, with the focus, and nowhere else", async () => {
    const { api } = await open();
    api.adminCreateGroup.mockRejectedValue(refusal(409, "Bu kısa ad zaten kullanılıyor"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni qrup" })); });
    const form = within(screen.getByRole("dialog"));
    fireEvent.change(form.getByLabelText(/Qısa ad/), { target: { value: "nurse" } });
    fireEvent.change(form.getByLabelText(/Görünən ad/), { target: { value: "Hemşire" } });
    await act(async () => { fireEvent.click(form.getByRole("button", { name: "Qrupu yarat" })); await settle(); });
    const slug = form.getByLabelText(/Qısa ad/);
    expect(slug).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(slug.getAttribute("aria-describedby").split(" ")[0]).textContent)
      .toMatch(/Bu qısa ad artıq istifadə olunur/);
    // Enabled again and focused: the refusal is where the administrator can act on it. (A field
    // still `disabled` from the write cannot take focus in a browser.)
    expect(slug).not.toBeDisabled();
    expect(slug).toHaveFocus();
    expect(alerts().trim()).toBe("");                              // on the field, not on the toast
    expect(screen.getByRole("dialog")).toBeInTheDocument();      // still open, to be corrected
  });

  it("a malformed slug's 422 lands on the slug field too", async () => {
    const BAD = "slug: 2-64 characters, lower-case letters, digits and _ only";
    const { api } = await open();
    api.adminCreateGroup.mockRejectedValue(refusal(422, `slug: ${BAD}`, {
      fieldErrors: [{ field: "slug", type: "value_error", message: BAD }],
    }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni qrup" })); });
    const form = within(screen.getByRole("dialog"));
    fireEvent.change(form.getByLabelText(/Qısa ad/), { target: { value: "Gece-Ekibi" } });
    fireEvent.change(form.getByLabelText(/Görünən ad/), { target: { value: "Gecə ekibi" } });
    await act(async () => { fireEvent.click(form.getByRole("button", { name: "Qrupu yarat" })); await settle(); });
    expect(form.getByLabelText(/Qısa ad/)).toHaveAttribute("aria-invalid", "true");
    expect(form.getByLabelText(/Qısa ad/)).toHaveFocus();
  });

  it("deleting confirms first, then shows the server's own refusal for each of its three cases", async () => {
    const CASES = [
      ["Sistem grubu silinemez", /Sistem qrupu silinə bilməz/],
      ["Üyesi olan grup silinemez", /Üzvü olan qrup silinə bilməz/],
      ["AD eşlemesi olan grup silinemez", /AD uyğunlaşdırması olan qrup silinə bilməz/],
    ];
    for (const [message, shown] of CASES) {
      // eslint-disable-next-line no-await-in-loop
      const { api } = await open();
      api.adminDeleteGroup.mockRejectedValue(refusal(409, message));
      const col = column(/Hemşire/);
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { fireEvent.click(within(col).getByRole("button", { name: "Qrupu sil: Hemşire" })); });
      expect(screen.getByText(/Hemşire silinəcək/)).toBeInTheDocument();
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Qrupu sil" }));
        await settle();
      });
      expect(alerts()).toMatch(shown);
      expect(alerts()).toContain("Hemşire");
      expect(screen.getByRole("dialog")).toBeInTheDocument();      // not dismissed on a refusal
      // `cleanup()`, never `document.body.innerHTML = ""`: the dialog and the toast stack are React
      // PORTALS under <body>, and blanking the body leaves React trying to unmount nodes that are
      // no longer its children ("The node to be removed is not a child of this node").
      cleanup();
    }
  });

  it("a delete that lands says so, naming the group, closes the dialog and reloads", async () => {
    const { api, reload } = await open();
    api.adminDeleteGroup.mockResolvedValue(null);
    const col = column(/Gece ekibi/);
    await act(async () => { fireEvent.click(within(col).getByRole("button", { name: "Qrupu sil: Gece ekibi" })); });
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Qrupu sil" }));
      await settle();
    });
    expect(api.adminDeleteGroup).toHaveBeenCalledWith(WARD_GROUP.id);
    // A confirmation goes to the toast's POLITE region, which is an `aria-live` div and carries no
    // `role` — so it is found by its text, not by role. Twice on purpose: the visible toast and
    // the sr-only live region it is announced from.
    expectConfirmed(/Gece ekibi · silindi\./);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(reload).toHaveBeenCalled();
  });
});

describe("accessibility", () => {
  it("the grid is a table: a caption, scope=col per group, scope=row per permission", async () => {
    await open();
    const table = screen.getByRole("table", { name: "Qruplar və səlahiyyətləri" });
    expect(table.querySelector("caption")).toHaveTextContent("Qruplar və səlahiyyətləri");
    for (const header of within(table).getAllByRole("columnheader")) expect(header.getAttribute("scope")).toBe("col");
    for (const header of within(table).getAllByRole("rowheader")) expect(header.getAttribute("scope")).toBe("row");
  });

  it("no control is natively disabled — a locked cell is aria-disabled, so a keyboard user reaches it and hears why", async () => {
    await open();
    for (const control of [...screen.getAllByRole("button"), ...screen.getAllByRole("checkbox")]) {
      expect(control.hasAttribute("disabled"), control.getAttribute("aria-label") || control.textContent).toBe(false);
    }
    const locked = screen.getAllByRole("checkbox").filter((box) => box.getAttribute("aria-disabled") === "true");
    expect(locked).toHaveLength(FOUR.length);                     // the system group's column
    for (const box of locked) expect(document.getElementById(box.getAttribute("aria-describedby"))).not.toBeNull();
  });

  it("says which group a save is in flight for", async () => {
    let release;
    const { api } = await open();
    api.adminUpdateGroup.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    fireEvent.click(cell("Hemşire", D.usersManage));
    await saveIn(column(/Hemşire/));
    await waitFor(() => expect(screen.getAllByRole("status").map((s) => s.textContent).join(" "))
      .toContain("Hemşire"), { timeout: 4000 });
    await act(async () => { release(NURSE_GROUP); await settle(); });
  });

  it("says what the table is and is not", async () => {
    await open();
    expect(screen.getByText(/Səlahiyyət yoxlanışı serverdə aparılır/)).toBeInTheDocument();
  });

  it("has no h1 of its own: the screen's heading is the frame's", async () => {
    await open();
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 2, name: "Rollar və səlahiyyətlər" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/live/screens/admin/RolesTab.test.jsx 2>&1 | grep -E "Failed to resolve|Tests " | head -3
```
Expected: `Failed to resolve import "./RolesTab.jsx"`.

- [ ] **Step 3: Write the tab.** Create `dashboard/src/live/screens/admin/RolesTab.jsx`:

```jsx
// src/live/screens/admin/RolesTab.jsx — the group × permission table (G1-13).
//
// COLLECT AND SAVE, NOT APPLY ON THE CLICK. The prototype's matrix writes each checkbox to
// `localStorage` the moment it is pressed (`admin.js:874-882`), which in a live system would mean
// one mis-click grants a right and the audit trail records it as a decision somebody made. Here a
// checkbox collects a pending change, the group's column says how many are pending, and Save sends
// ONE `PATCH /admin/groups/{id}` with the WHOLE permission list.
//
// THE API OFFERS NO TRANSACTION ACROSS GROUPS, AND THIS SCREEN DOES NOT PRETEND OTHERWISE.
// `PATCH /admin/groups/{id}` is atomic for ONE group — the service takes the tenant's lock, checks
// the caller's rights against the group's new rights, and writes under a row version that answers
// 409 `concurrentChange` if somebody else moved it meanwhile. There is no endpoint that changes two
// groups at once. So the unit of saving here is the GROUP, not the table: each column has its own
// Save, each save is one request, and a column that fails leaves the others as they were and says
// which one failed. A single "Save everything" button would be a promise of atomicity the server
// cannot keep — three PATCHes of which the second is refused would leave the hospital's permission
// table in a state no administrator chose, with one toast to explain it.
//
// A 409 RE-READS THE COLUMN AND KEEPS THE TICKS. `concurrentChange` means another administrator
// saved this group between our read and our write. The PATCH body is the whole list, computed from
// what this screen last read, and the server carries no client-supplied version — so pressing Save
// again on the stale base would silently overwrite what the other administrator just saved, and the
// refusal's own text says "refresh the list and try again". The screen does the refresh itself, keeps
// the administrator's ticks (they are what she decided), and says in a Note that the column was
// re-read so she reviews them against the new state before saving again.
//
// WHAT IS READ-ONLY, AND WHY IT SAYS SO IN THE SERVER'S OWN WORDS.
//   * The SYSTEM group: the server refuses it (409 `Sistem grubunun izinleri ve MFA kuralı
//     değiştirilemez`) and reports its permissions as the whole catalogue whatever is stored.
//   * A group whose rights exceed the session's (`canGrant`): the server's rule is "no grant beyond
//     your own rights" (403), and the column says so rather than offering checkboxes that 403.
//   * A group holding a key this catalogue does not describe: a Save computed from the catalogue
//     would drop that key — revoke a right the screen never showed, silently — so the column is
//     read-only and names the keys. It cannot happen while `/admin/permissions` serves the whole
//     catalogue, and nothing enforces that it always will.
//   A locked cell is `aria-disabled`, not `disabled`: a keyboard user can still land on it and hear
//   the column's reason, which a natively disabled control would skip.
//
// THE DESCRIPTIONS ARE TRANSLATED BY KEY (`strings/perms.js`), with the server's own English as
// the `lang="en"` fallback for a key this build does not know. The server's descriptions are
// developer prose, not the hospital's words, and this is the screen on which an administrator
// decides what a nurse may do: a mis-read permission is a misconfiguration. The KEY is printed under
// the description untranslated — it is what a support call quotes and what the table is searched by.
//
// A CELL READS AS "<group> · <permission>" to a screen reader, and "· change pending" while it
// holds a tick the server has not taken: the only visible marker is a tint on the cell, and a tint
// is not something a reader is told.
import React, { useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { Announce, Button, Empty, Field, Input, Modal, Note, Pill, Table, Tag, useToast } from "../../ui/index.js";
import { apiErrorKey, fieldRefusals } from "../../apiErrors.js";
import { hasPerm } from "./catalogue.js";
import { canGrant } from "./rules.js";
import { doneFor, refusedFor } from "./refusal.js";

/** The key of a pending change. */
const cellKey = (groupId, permission) => `${groupId}|${permission}`;

/** Is this permission on for this group, taking any pending change into account? */
export function isOn(group, permission, pending) {
  const key = cellKey(group.id, permission);
  if (key in pending) return pending[key];
  return group.permissions.includes(permission);
}

/** The keys a group holds that `catalogue` does not describe. A Save built from the catalogue would
 *  drop them — revoke them silently — so a group with any is not saved from this screen. */
export function undescribedKeys(group, catalogue) {
  const described = new Set(catalogue.map((row) => row.key));
  return group.permissions.filter((key) => !described.has(key));
}

/** The permission list a Save would send for this group: its own, with the pending changes applied,
 *  in the catalogue's order — so the body is reproducible and a diff of two saves is readable.
 *  Only for a group every one of whose keys the catalogue describes (`undescribedKeys` empty). */
export function listToSend(group, catalogue, pending) {
  return catalogue.map((row) => row.key).filter((key) => isOn(group, key, pending));
}

/** How many of this group's cells are pending AND actually differ from what the server holds. A
 *  checkbox clicked twice is not a change, and a column that said "1 pending" for it would be
 *  asking an administrator to save nothing. */
export function pendingFor(group, pending) {
  return Object.entries(pending).filter(([key, on]) => {
    const [groupId, permission] = key.split("|");
    return groupId === group.id && on !== group.permissions.includes(permission);
  }).length;
}

/** Why a group's column cannot be edited — `{key, vars}` for `t()` — or null. The system group
 *  first: it is the stronger statement and the server's refusal for it is the more specific one. */
export function lockedBecause(group, perms, catalogue) {
  if (group.isSystem) return { key: "errors.systemGroupLocked", vars: {} };
  if (!canGrant(perms, group, catalogue)) return { key: "roles.cannotGrant", vars: {} };
  const missing = undescribedKeys(group, catalogue);
  if (missing.length > 0) return { key: "roles.undescribed", vars: { keys: missing.join(", ") } };
  return null;
}

/** A permission's description in the reader's language, or the server's own English when this
 *  build has no text for the key. Returns `{text, foreign}`; a caller that prints it marks a
 *  foreign one `lang="en"`. */
export function descriptionOf(t, row) {
  const key = `perms.${row.key}`;
  const own = t(key);
  return own === key ? { text: row.description, foreign: true } : { text: own, foreign: false };
}

export function RolesTab({ admin }) {
  const { t } = useI18n();
  const { user: me, store } = useSession();
  const toast = useToast();
  const api = store.api;
  const { groups, catalogue } = admin.data;

  /** `{"<groupId>|<permission>": boolean}` — what a Save would change, and nothing else. */
  const [pending, setPending] = useState({});
  /** The groups whose PATCH or DELETE is in flight. A Set, not one id: every column has its own
   *  Save, each PATCH is atomic for its group, and the server serialises them on the tenant lock
   *  — so a second column's Save during the first's flight is a real request, not a press that
   *  silently does nothing. */
  const [inFlight, setInFlight] = useState(() => new Set());
  /** The groups whose column was re-read after a 409, with the administrator's ticks kept. */
  const [reread, setReread] = useState(() => new Set());
  const [newGroup, setNewGroup] = useState(false);
  const [removing, setRemoving] = useState(null);

  const locks = useMemo(
    () => new Map(groups.map((g) => [g.id, lockedBecause(g, me.perms, catalogue)])),
    [groups, me.perms, catalogue],
  );
  const lockId = (group) => `roles-lock-${group.id}`;

  const toggle = (group, permission, on) => setPending((was) => ({ ...was, [cellKey(group.id, permission)]: on }));

  const dropPending = (group) => {
    setPending((was) => Object.fromEntries(Object.entries(was).filter(([key]) => key.split("|")[0] !== group.id)));
    setReread((was) => { const next = new Set(was); next.delete(group.id); return next; });
  };

  const flying = (group, on) => setInFlight((was) => {
    const next = new Set(was);
    if (on) next.add(group.id);
    else next.delete(group.id);
    return next;
  });

  async function save(group) {
    if (inFlight.has(group.id)) return;
    flying(group, true);
    try {
      await store.track(() => api.adminUpdateGroup(group.id, { permissions: listToSend(group, catalogue, pending) }));
      toast(doneFor(t, group.name, t("roles.saved")));
      dropPending(group);
      await admin.reload();
    } catch (err) {
      // The pending changes STAY: they are what the administrator decided, the server did not take
      // them, and throwing them away would make her reconstruct the decision from memory.
      toast(refusedFor(t, group.name, err), "error");
      if (apiErrorKey(err)?.key === "errors.concurrentChange") {
        // Somebody else saved this group meanwhile. Re-read, so the next Save is computed against
        // what the server holds now rather than silently overwriting their change; keep the ticks;
        // say so. The Note is not an Alert: the refusal was announced once already, on the toast.
        setReread((was) => new Set(was).add(group.id));
        await admin.reload();
      }
    } finally {
      flying(group, false);
    }
  }

  async function remove(group) {
    if (inFlight.has(group.id)) return;
    flying(group, true);
    try {
      await store.track(() => api.adminDeleteGroup(group.id));
      toast(doneFor(t, group.name, t("roles.removed")));
      setRemoving(null);
      await admin.reload();
    } catch (err) {
      toast(refusedFor(t, group.name, err), "error");
    } finally {
      flying(group, false);
    }
  }

  const inFlightNames = groups.filter((g) => inFlight.has(g.id)).map((g) => g.name).join(", ");

  // Without the catalogue there is no table to draw: its rows ARE the catalogue. Which sentence
  // depends on WHY it is empty — a desk without `groups.manage` is never asked for it (the frame
  // asks only what the rights allow), and a desk with it reaches this line only when the read
  // failed, where the frame's own Alert already carries the server's reason.
  if (catalogue.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="m-0 font-display text-17 font-bold">{t("roles.title")}</h2>
        <Empty icon="shield">{t(hasPerm(me.perms, "groups.manage") ? "roles.catalogueUnread" : "roles.noCatalogue")}</Empty>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 font-display text-17 font-bold">{t("roles.title")}</h2>
          <p className="m-0 text-13 text-mute">{t("roles.sub")}</p>
        </div>
        <Button icon="plus" variant="primary" onClick={() => setNewGroup(true)}>{t("roles.newGroup")}</Button>
      </div>

      {groups.filter((g) => reread.has(g.id)).map((g) => (
        <Note key={g.id} tone="warn" icon="swap">{t("roles.reread", { group: g.name })}</Note>
      ))}

      {groups.length === 0 ? <Empty icon="users">{t("roles.noGroups")}</Empty> : (
        <Table caption={t("roles.caption")} className="[&_td:first-child]:sticky [&_td:first-child]:left-0 [&_td:first-child]:bg-card [&_th:first-child]:sticky [&_th:first-child]:left-0 [&_th:first-child]:z-[1] [&_th:first-child]:bg-card2">
          <thead>
            <tr>
              <th scope="col">{t("roles.colPermission")}</th>
              {groups.map((group) => {
                const locked = locks.get(group.id);
                const count = pendingFor(group, pending);
                const busy = inFlight.has(group.id);
                return (
                  <th key={group.id} scope="col">
                    <div className="normal-case tracking-normal">
                      <div className="text-12 font-bold text-ink">{group.name}</div>
                      {/* A member count only when the read that produced it answered: `memberCount`
                          is null for a group the API described without one, and a zero would read
                          as "nobody is in this group" — a different and possibly false statement. */}
                      <div className="text-10.5 font-semibold text-mute">
                        {group.memberCount === null ? t("roles.membersUnknown") : t("roles.members", { count: group.memberCount })}
                      </div>
                      <div className="mt-1">
                        {group.mfaRequired ? <Tag tone="warn">{t("roles.mfaOn")}</Tag> : <Pill>{t("roles.mfaOff")}</Pill>}
                      </div>
                      {locked ? (
                        <p id={lockId(group)} className="m-0 mt-1 max-w-[190px] whitespace-normal text-10.5 font-normal text-mute">
                          {t(locked.key, locked.vars)}
                        </p>
                      ) : (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {count > 0 ? <Tag tone="warn">{t("roles.pending", { count })}</Tag> : null}
                          <Button size="sm" variant={count > 0 ? "primary" : "default"} busy={busy}
                            onClick={() => save(group)}>{t("roles.save")}</Button>
                          {count > 0 ? (
                            <Button size="sm" variant="ghost" icon="swap" busy={busy}
                              label={`${t("roles.discard")}: ${group.name}`} onClick={() => dropPending(group)} />
                          ) : null}
                          <Button size="sm" variant="ghost" icon="trash" busy={busy}
                            label={`${t("roles.remove")}: ${group.name}`} onClick={() => setRemoving(group)} />
                        </div>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {catalogue.map((row) => {
              const { text, foreign } = descriptionOf(t, row);
              return (
                <tr key={row.key}>
                  {/* The description in the reader's language — or the server's English, marked as
                      such — and the permission's own key under it: the key is what a support call
                      quotes and what this table is searched by. */}
                  <th scope="row">
                    <div className="normal-case tracking-normal">
                      <div className="text-12.5 font-semibold text-ink" lang={foreign ? "en" : undefined}>{text}</div>
                      <div className="font-data text-10.5 font-normal text-mute">{row.key}</div>
                    </div>
                  </th>
                  {groups.map((group) => {
                    const locked = locks.get(group.id);
                    const on = locked ? group.permissions.includes(row.key) || group.isSystem : isOn(group, row.key, pending);
                    const changed = !locked && on !== group.permissions.includes(row.key);
                    const name = `${t("roles.cell", { group: group.name, permission: text })}${changed ? ` · ${t("roles.cellPending")}` : ""}`;
                    return (
                      <td key={group.id} className={changed ? "bg-card2" : ""}>
                        <input
                          type="checkbox"
                          checked={on}
                          aria-label={name}
                          // A locked cell is reachable, says it is locked, and points at the column's
                          // reason — never `disabled`, which would skip it in the Tab order and tell a
                          // keyboard user nothing. It is controlled with a no-op onChange, so a click
                          // leaves it as the server reported it: React puts the prop back after the
                          // event. Not `preventDefault` on the click — a browser reverts a cancelled
                          // checkbox click AFTER React's restore, and jsdom reverts by toggling
                          // again, which would leave the cell flipped in the test and not in the field.
                          aria-disabled={locked ? "true" : undefined}
                          aria-describedby={locked ? lockId(group) : undefined}
                          onChange={locked ? () => {} : (event) => toggle(group, row.key, event.target.checked)}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <Note tone="info" icon="shield">{t("roles.note")}</Note>

      {/* A busy Button reads only "unavailable" to a screen reader; the words come from here, and
          they name the group(s) whose column is in flight. */}
      <Announce text={inFlightNames ? t("admin.savingFor", { subject: inFlightNames }) : ""} />

      {newGroup ? (
        <GroupForm
          catalogue={catalogue}
          submit={(body) => store.track(() => api.adminCreateGroup(body))}
          onSaved={async (name) => {
            toast(doneFor(t, name, t("roles.created")));
            setNewGroup(false);
            await admin.reload();
          }}
          onRefused={(err, name) => toast(refusedFor(t, name, err), "error")}
          onClose={() => setNewGroup(false)}
        />
      ) : null}

      {removing ? (
        <Modal
          open
          title={t("roles.remove")}
          busy={inFlight.has(removing.id)}
          onClose={() => setRemoving(null)}
          actions={(
            <>
              <Button onClick={() => setRemoving(null)} busy={inFlight.has(removing.id)}>{t("roles.cancel")}</Button>
              <Button variant="danger" busy={inFlight.has(removing.id)} onClick={() => remove(removing)}>
                {t("roles.remove")}
              </Button>
            </>
          )}
        >
          <p className="m-0 text-14">{t("roles.confirmRemove", { group: removing.name })}</p>
        </Modal>
      ) : null}
    </div>
  );
}

/** A new group: slug, name, description, the MFA rule and its starting permissions. The slug cannot
 *  be changed afterwards (`GroupPatch` has no `slug`), which the hint says; a duplicate answers 409
 *  `slugTaken` and a malformed one 422 `badSlug`, and both land on the slug field. */
function GroupForm({ catalogue, submit, onSaved, onRefused, onClose }) {
  const { t } = useI18n();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mfa, setMfa] = useState(false);
  const [chosen, setChosen] = useState(() => new Set());
  const [refusals, setRefusals] = useState({});
  const [busy, setBusy] = useState(false);
  const fields = useRef({});
  const mounted = useRef(true);
  React.useEffect(() => () => { mounted.current = false; }, []);

  async function onSubmit(event) {
    event?.preventDefault?.();
    if (busy) return;
    const mine = {};
    if (!slug.trim()) mine.slug = t("errors.badSlug");
    if (!name.trim()) mine.name = t("errors.mustNotBeBlank");
    if (Object.keys(mine).length > 0) {
      setRefusals(mine);
      fields.current[Object.keys(mine)[0]]?.focus();
      return;
    }
    setRefusals({});
    setBusy(true);
    try {
      await submit({
        slug: slug.trim(), name: name.trim(), description: description.trim() || null,
        mfa_required: mfa, permissions: catalogue.map((row) => row.key).filter((key) => chosen.has(key)),
      });
      if (mounted.current) onSaved(name.trim());
    } catch (err) {
      if (!mounted.current) return;
      const named = fieldRefusals(t, err);
      // A 409 on the slug has no `fieldErrors` — it is a message, not a validator — so it is put
      // on the slug field by its KEY, which is where an administrator can act on it.
      const slugTaken = apiErrorKey(err)?.key === "errors.slugTaken";
      if (Object.keys(named).length > 0 || slugTaken) {
        const shown = slugTaken ? { slug: t("errors.slugTaken"), ...named } : named;
        // Enabled before focused: the fields are `disabled` while busy, and `focus()` on a
        // disabled element is a no-op in a browser. `flushSync` lands both updates first.
        flushSync(() => {
          setBusy(false);
          setRefusals(shown);
        });
        fields.current[Object.keys(shown)[0]]?.focus();
      } else {
        onRefused(err, name.trim());
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={t("roles.formNew")}
      busy={busy}
      onClose={onClose}
      actions={(
        <>
          <Button onClick={onClose} busy={busy}>{t("roles.cancel")}</Button>
          <Button variant="primary" busy={busy} onClick={onSubmit}>{t("roles.create")}</Button>
        </>
      )}
    >
      <form noValidate onSubmit={onSubmit}>
        <Announce text={busy ? t("roles.saving") : ""} />
        <Field layout="col" required label={t("roles.fieldSlug")} hint={t("roles.fieldSlugHint")} error={refusals.slug}>
          <Input ref={(el) => { fields.current.slug = el; }} value={slug} disabled={busy} autoFocus
            onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <Field layout="col" required label={t("roles.fieldName")} error={refusals.name}>
          <Input ref={(el) => { fields.current.name = el; }} value={name} disabled={busy}
            onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field layout="col" label={t("roles.fieldDescription")} error={refusals.description}>
          <Input value={description} disabled={busy} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <label className="mb-2.5 flex items-center gap-2 font-text text-13.5">
          <input type="checkbox" checked={mfa} disabled={busy} onChange={(e) => setMfa(e.target.checked)} />
          {t("roles.fieldMfa")}
        </label>
        <fieldset className="border-0 p-0">
          <legend className="mb-1 font-text text-13.5 font-semibold text-mute">{t("roles.colPermission")}</legend>
          {catalogue.map((row) => {
            const { text, foreign } = descriptionOf(t, row);
            return (
              <label key={row.key} className="flex items-start gap-2 py-0.5 font-text text-13">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={chosen.has(row.key)}
                  disabled={busy}
                  onChange={(e) => setChosen((was) => {
                    const next = new Set(was);
                    if (e.target.checked) next.add(row.key);
                    else next.delete(row.key);
                    return next;
                  })}
                />
                <span>
                  <span lang={foreign ? "en" : undefined}>{text}</span>
                  <span className="block font-data text-10.5 text-mute">{row.key}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 4: Run it**

```bash
npx vitest run src/live/screens/admin/RolesTab.test.jsx 2>&1 | grep -E "Tests "
```
Expected: `Tests  32 passed (32)`. One line on stderr is expected and is not a failure: `[i18n] "perms.ghost.key" has no az text — showing the key.` — the test that proves the English fallback asks for a key no dictionary has, and the provider says so.

**Six things that will bite.**

1. **The sticky classes go on the FRAME, not the `<table>`.** `ui/Table.jsx` passes `className` to the scrolling `<div>`, which is where a `position: sticky` rule has to live — sticky is relative to the nearest scroll container. The test asserts it on `…getByRole("table").closest("div")`.
2. **A confirmation goes to the toast's POLITE region**, which is an `aria-live` div with **no `role`**: it is found by its text, not by `getAllByRole("status")`. Errors are the `role="alert"` region and are found by role. And a toast's text appears **twice** — the visible stack and the sr-only region — so use `getAllByText`.
3. **`cleanup()` between iterations of the delete loop**, never `document.body.innerHTML = ""`, for the portal reason in Task 7.
4. **A changed cell's accessible name grows.** It reads `<group> · <permission> · dəyişiklik gözləyir` while it holds a tick the server has not taken, so the test's `cell()` helper matches the name with or without that suffix — a string match on the bare name fails right after the click that is being tested.
5. **`describe` cannot be exported.** The function that gives a row its description is `descriptionOf`, because `describe` is the test runner's own word and a module that exports one collides with it in every test that imports both.
6. **A locked cell is controlled with a no-op `onChange`, not `preventDefault` on the click.** A browser reverts a cancelled checkbox click AFTER React has restored the prop, and jsdom reverts by toggling again — so with `preventDefault` the cell ended up flipped in the test and not in the field. The controlled pattern leaves it as the server reported it in both.

- [ ] **Step 5: Take this arm's two lines.** In `dashboard/src/live/screens/admin/AdminScreen.jsx`, replace

```jsx
// G1-13: import { RolesTab } from "./RolesTab.jsx";
```

with

```jsx
import { RolesTab } from "./RolesTab.jsx";
```

and replace

```jsx
  roles: null, //    G1-13
```

with

```jsx
  roles: RolesTab, //    G1-13
```

- [ ] **Step 6: Run the sweep, which now has a second tab to walk**

```bash
npx vitest run src/live/rawKeys.test.jsx 2>&1 | grep -E "Tests |→"
```
Expected: `Tests  5 passed (5)`. If it reports

```
admin (/admin) · Rollar və səlahiyyətlər → board.view
```

then Task 4 Step 7(c) was not done: the catalogue's own keys must be exempt from the detector, because this table prints every one of them on purpose. That is the first thing the tab walk caught when it was written.

- [ ] **Step 7: Look at it** — `npx vite dev`, `#/admin`, the roles tab.

At **1440 px** and **390 px**, both themes:
- the table scrolls inside its frame and the **page** does not; at 390 px the first column stays put while the group columns move, which is what the sticky rule is for — if it does not, the rule is on the wrong element;
- each column header's name, member count, MFA tag, pending tag and three buttons stack without overlapping;
- the system group's column shows its sentence and **no** Save;
- tick a box: the cell takes the `card2` tint and the column's "N dəyişiklik gözləyir" appears; tick it back and both go;
- `Tab` reaches every checkbox and every Save, and the focus ring is visible on the sticky first column too (a sticky cell can sit over a focus ring — check it);
- the permission descriptions and their keys are both readable, and the long ones wrap rather than widening the column.

- [ ] **Step 8: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected, **on this arm's own branch**: `Test Files  104 passed (104)`, `Tests  2195 passed (2195)` (2163 + 32). On a branch where the users arm has already merged it is `105 / 2231`; **add your own file's 32 to what you find**, do not expect this number.

- [ ] **Step 9: Commit**

```bash
git status --short
git add dashboard/src/live/screens/admin/RolesTab.jsx dashboard/src/live/screens/admin/RolesTab.test.jsx dashboard/src/live/screens/admin/AdminScreen.jsx
git commit -m "$(cat <<'EOF'
feat(dashboard): the group x permission table (G1-13)

A checkbox collects a change and the column says how many are pending; Save
sends one PATCH with the whole list. Per GROUP, not per table: the API is
atomic over one group and has no multi-group write, so a single "save
everything" button would promise atomicity the server cannot keep -- three
PATCHes of which the second is refused leave the permission table in a state
nobody chose. A refusal keeps the pending changes, because they are what the
administrator decided and the server did not take them.

A 409 means another administrator saved the group meanwhile: the column is
re-read, the ticks are kept, and a Note says so -- Save again on the stale base
would have silently overwritten her change. The system group's column is
read-only with the server's own reason, so is any group whose rights exceed the
session's, and so is a group holding a key the catalogue does not describe,
which names the key. The descriptions are in the reader's language with the
key under them, because the key is what an administrator searches the table by.
And the table says out loud that permissions are checked on the server, because
the matrix it replaces did the opposite.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** **32** tests in the new `RolesTab.test.jsx`; the suite green; build clean; looked at 390/1440 px in both themes with the sticky column checked.

---

# G1-14 · the login-source arm (Tasks 10–11, branch `feat/w3b-source`)

### Task 10: The login-source namespace, in four languages

**Files:**
- Create: `dashboard/src/live/i18n/strings/source.js`
- Modify: `dashboard/src/live/i18n/catalog.js` (this arm's two lines), `dashboard/src/live/i18n/strings.test.js` (this arm's one block)

This is the largest new namespace of the wave, and most of it exists because of one rule: **"no" is not an answer an administrator can act on** (Decision 16). Five test reasons and seven skip reasons each get a sentence that says what to do about it.

- [ ] **Step 1: Write the namespace.** Create `dashboard/src/live/i18n/strings/source.js`:

```javascript
// Administration · Login source (G1-14) — the directory: its status, a connection test, a search
// and import, and the AD group mapping.
//
// THE PROTOTYPE HAS ALMOST NOTHING TO TAKE HERE, and that is worth saying once. Its login-source
// box (`admin.js ldapBox`) is a DISABLED mock-up — three fields an operator cannot type in, with
// the tag "LDAP · ileride" ("later") — written when the directory was a plan. Two of its fields
// must never exist in a live screen: the server's host and search root are deployment
// configuration (`LDAP_URL`, `LDAP_USER_BASE`), not something an administrator edits in a browser,
// and the third ("Grup → rol eşlemesi", a free-text line) is replaced here by a picker over the
// directory's real groups, because a hand-typed DN whose non-ASCII letters differ in case from
// AD's will not match (Wave 1A's F5 note). What the prototype DOES give is the vocabulary — `box`,
// `sec`, `note i`, `pill`, `tag`, `tw table.t` — and the decisions in its own note, which this tab
// keeps: LDAPS only, a local administrator account always remains, every directory sign-in is
// audited.
//
// The status panel shows the HOST ONLY. Never a bind DN, never a password, not in the DOM and not
// in a title — the API does not send them (`LdapStatusOut`) and this screen would not print them.
//
// AZ/RU/EN await a native speaker's review before the pilot.
export default {
  tr: {
    title: "Giriş kaynağı",
    sub: "Kurumsal hesaplar (Active Directory) ve bu kurumdaki grup eşlemesi.",
    // status
    statusTitle: "Durum",
    configured: "Dizin yapılandırılmış",
    notConfigured: "Dizin yapılandırılmamış. Kurumsal hesapla giriş kapalı; yalnız yerel hesaplar kullanılıyor. Bu, sunucu yapılandırmasıdır (LDAP_URL) ve buradan değiştirilemez.",
    host: "Sunucu",
    hostNote: "Yalnız sunucu adresi gösterilir; bağlanma hesabı ve şifresi hiçbir yanıtta yer almaz.",
    lastTest: "Son bağlantı denemesi",
    lastTestNever: "Sunucu son başlatıldığından beri denenmedi",
    lastTestOk: "Başarılı",
    lastTestFail: "Başarısız",
    lastTestUnknown: "Sonucu bilinmiyor",
    test: "Bağlantıyı dene",
    testing: "Deneniyor…",
    testOk: "Dizine bağlanıldı ve servis hesabı doğrulandı.",
    // the five reasons the test can give (ldap_router: unreachable | timeout | tls |
    // service_bind_rejected | protocol). "No" is not an answer an administrator can act on.
    reasonUnreachable: "Sunucuya ulaşılamadı. Adres ve ağ yolunu (güvenlik duvarı, 636/TCP) kontrol edin.",
    reasonTimeout: "Sunucu süre içinde yanıt vermedi. Etki alanı denetleyicisi yavaş ya da erişilemez olabilir.",
    reasonTls: "Şifreli bağlantı kurulamadı. Sertifika ve kök sertifika zincirini kontrol edin; yalnız LDAPS kullanılır.",
    reasonServiceBindRejected: "Servis hesabı reddedildi. Hesabın şifresi değişmiş, süresi geçmiş ya da kilitlenmiş olabilir.",
    reasonProtocol: "Sunucu beklenmeyen bir yanıt verdi. Adresin bir LDAP sunucusuna ait olduğunu doğrulayın.",
    reasonUnknown: "Sunucu bir neden bildirmedi.",
    // search and import
    searchTitle: "Hesap ara ve içe aktar",
    searchLabel: "Ad ya da kullanıcı adı",
    searchHint: "En az 2 karakter. Dizin listelenmez, aranır; sonuç en çok {cap} satırdır.",
    search: "Ara",
    searchGroups: "Grubu ara",
    searching: "Aranıyor…",
    searchNone: "Eşleşen dizin hesabı yok.",
    searchCapped: "En çok {cap} sonuç gösterilir; aramayı daraltın.",
    colName: "Ad",
    colLogin: "Kullanıcı adı",
    colState: "Durum",
    colChoose: "Seç",
    caption: "Dizin arama sonuçları",
    alreadyImported: "Zaten aktarılmış",
    disabled: "Dizinde kapalı",
    importable: "Aktarılabilir",
    extraGroup: "Ek grup (isteğe bağlı)",
    extraGroupHint: "Aktarılan her hesaba bu grup da verilir; yalnız verebileceğiniz gruplar sunulur. AD gruplarından gelen üyelikler eşleme tablosuna göre ayrıca eklenir.",
    extraGroupNone: "Ek grup verilmesin",
    importChosen: "Seçilenleri aktar ({count})",
    importProgress: "{done} / {total} hesap gönderildi…",
    importDone: "{imported} hesap aktarıldı, {skipped} hesap atlandı.",
    importChunkFailed: "{names}: gönderilemedi; bu hesaplar hâlâ seçili. İçe aktarma yinelenebilir, tekrar denemek zararsızdır.",
    importedTitle: "Aktarılanlar",
    skippedTitle: "Atlananlar",
    // the seven skip reasons (ldap_service SKIP_*)
    skipExists: "zaten burada kayıtlı",
    skipNotFound: "dizinde bulunamadı",
    skipDisabled: "dizinde kapalı",
    skipExpired: "hesabın süresi geçmiş",
    skipLoginTaken: "bu kullanıcı adı başka bir hesapta kullanılıyor — AD'de adı değiştirin ya da buradaki hesabı pasifleştirin",
    skipNoUsername: "dizinde kullanıcı adı yok",
    skipInvalidLogin: "kullanıcı adı yerel kurala uymuyor (a-z, 0-9 ve . _ @ -); AD'deki sAMAccountName'i Latin karşılığıyla yazın: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e",
    skipUnknown: "sunucu bir neden bildirmedi",
    // the group mapping
    mapTitle: "AD grup eşlemesi",
    mapSub: "Bir AD grubunun üyeleri, sonraki girişlerinde burada seçilen grubu alır.",
    mapCaption: "AD grubu ve karşılığı",
    colAdGroup: "AD grubu",
    colOurGroup: "Buradaki grup",
    mapNone: "Henüz eşleme yok.",
    mapReadOnly: "Eşleme tablosu yalnız okunuyor.",
    mapPickGroup: "AD grubunu ara",
    mapPickHint: "En az 2 karakter. Ayırt edici ad (DN) listeden seçilir, elle yazılmaz: elle yazılan bir DN'in Türkçe/Azerbaycanca harfleri AD'deki yazımdan farklı olursa eşleşme sessizce çalışmaz.",
    mapOurGroup: "Hangi grup verilsin",
    mapAdd: "Eşlemeyi ekle",
    mapAdded: "Eşleme eklendi.",
    mapRemove: "Eşlemeyi sil",
    mapRemoved: "Eşleme silindi.",
    mapRemoveNote: "Eşleme silinince bu AD grubundan gelen üyelikler de kaldırılır.",
    mapStale: "Bu satırın DN yazımı eski olabilir: eşleşmiyorsa silip listeden yeniden seçin.",
    searchingFor: "Aranıyor: {query}…",
    searchingGroupsFor: "AD grubu aranıyor: {query}…",
    mappingsFailed: "Eşleme tablosu okunamadı",
    mappingsRetry: "Yeniden oku",
    timeoutNote: "Dizin işlemleri 30 saniyeye kadar sürebilir.",
  },
  az: {
    title: "Giriş mənbəyi",
    sub: "Korporativ hesablar (Active Directory) və bu təşkilatdaki qrup uyğunlaşdırması.",
    statusTitle: "Vəziyyət",
    configured: "Kataloq konfiqurasiya olunub",
    notConfigured: "Kataloq konfiqurasiya olunmayıb. Korporativ hesabla giriş bağlıdır; yalnız lokal hesablar istifadə olunur. Bu, server konfiqurasiyasıdır (LDAP_URL) və buradan dəyişdirilə bilməz.",
    host: "Server",
    hostNote: "Yalnız server ünvanı göstərilir; qoşulma hesabı və şifrəsi heç bir cavabda yer almır.",
    lastTest: "Son qoşulma cəhdi",
    lastTestNever: "Server son dəfə başladılandan bəri yoxlanmayıb",
    lastTestOk: "Uğurlu",
    lastTestFail: "Uğursuz",
    lastTestUnknown: "Nəticəsi bilinmir",
    test: "Qoşulmanı yoxla",
    testing: "Yoxlanılır…",
    testOk: "Kataloqa qoşuldu və xidmət hesabı doğrulandı.",
    reasonUnreachable: "Serverə çatmaq olmadı. Ünvanı və şəbəkə yolunu (firewall, 636/TCP) yoxlayın.",
    reasonTimeout: "Server vaxtında cavab vermədi. Domen kontrolleri yavaş ola və ya əlçatmaz ola bilər.",
    reasonTls: "Şifrəli qoşulma qurulmadı. Sertifikatı və kök sertifikat zəncirini yoxlayın; yalnız LDAPS istifadə olunur.",
    reasonServiceBindRejected: "Xidmət hesabı qəbul edilmədi. Hesabın şifrəsi dəyişmiş, müddəti bitmiş və ya kilidlənmiş ola bilər.",
    reasonProtocol: "Server gözlənilməyən cavab verdi. Ünvanın bir LDAP serverinə aid olduğunu doğrulayın.",
    reasonUnknown: "Server səbəb bildirmədi.",
    searchTitle: "Hesab axtar və idxal et",
    searchLabel: "Ad və ya istifadəçi adı",
    searchHint: "Ən azı 2 simvol. Kataloq siyahılanmır, axtarılır; nəticə ən çox {cap} sətirdir.",
    search: "Axtar",
    searchGroups: "Qrupu axtar",
    searching: "Axtarılır…",
    searchNone: "Uyğun gələn kataloq hesabı yoxdur.",
    searchCapped: "Ən çox {cap} nəticə göstərilir; axtarışı daraldın.",
    colName: "Ad",
    colLogin: "İstifadəçi adı",
    colState: "Vəziyyət",
    colChoose: "Seç",
    caption: "Kataloq axtarışının nəticələri",
    alreadyImported: "Artıq idxal olunub",
    disabled: "Kataloqda bağlıdır",
    importable: "İdxal edilə bilər",
    extraGroup: "Əlavə qrup (istəyə bağlı)",
    extraGroupHint: "İdxal olunan hər hesaba bu qrup da verilir; yalnız verə biləcəyiniz qruplar təklif olunur. AD qruplarından gələn üzvlüklər uyğunlaşdırma cədvəlinə görə ayrıca əlavə olunur.",
    extraGroupNone: "Əlavə qrup verilməsin",
    importChosen: "Seçilənləri idxal et ({count})",
    importProgress: "{done} / {total} hesab göndərildi…",
    importDone: "{imported} hesab idxal olundu, {skipped} hesab buraxıldı.",
    importChunkFailed: "{names}: göndərilə bilmədi; bu hesablar hələ seçilidir. İdxal təkrarlana bilər, yenidən cəhd zərərsizdir.",
    importedTitle: "İdxal olunanlar",
    skippedTitle: "Buraxılanlar",
    skipExists: "artıq burada qeydiyyatdadır",
    skipNotFound: "kataloqda tapılmadı",
    skipDisabled: "kataloqda bağlıdır",
    skipExpired: "hesabın müddəti bitmişdir",
    skipLoginTaken: "bu istifadəçi adı başqa hesabda istifadə olunur — AD-də adı dəyişin və ya buradaki hesabı passivləşdirin",
    skipNoUsername: "kataloqda istifadəçi adı yoxdur",
    skipInvalidLogin: "istifadəçi adı lokal qaydaya uyğun deyil (a-z, 0-9 və . _ @ -); AD-dəki sAMAccountName-i Latın qarşılığı ilə yazın: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e",
    skipUnknown: "server səbəb bildirmədi",
    mapTitle: "AD qrup uyğunlaşdırması",
    mapSub: "Bir AD qrupunun üzvləri, növbəti girişlərində burada seçilən qrupu alır.",
    mapCaption: "AD qrupu və qarşılığı",
    colAdGroup: "AD qrupu",
    colOurGroup: "Buradaki qrup",
    mapNone: "Hələ uyğunlaşdırma yoxdur.",
    mapReadOnly: "Uyğunlaşdırma cədvəli yalnız oxunur.",
    mapPickGroup: "AD qrupunu axtar",
    mapPickHint: "Ən azı 2 simvol. Fərqləndirici ad (DN) siyahıdan seçilir, əl ilə yazılmır: əl ilə yazılan DN-in Türk/Azərbaycan hərfləri AD-dəki yazılışdan fərqlənərsə uyğunlaşma səssizcə işləməz.",
    mapOurGroup: "Hansı qrup verilsin",
    mapAdd: "Uyğunlaşdırmanı əlavə et",
    mapAdded: "Uyğunlaşdırma əlavə edildi.",
    mapRemove: "Uyğunlaşdırmanı sil",
    mapRemoved: "Uyğunlaşdırma silindi.",
    mapRemoveNote: "Uyğunlaşdırma silinəndə bu AD qrupundan gələn üzvlüklər də götürülür.",
    mapStale: "Bu sətirin DN yazılışı köhnə ola bilər: uyğunlaşmırsa silib siyahıdan yenidən seçin.",
    searchingFor: "Axtarılır: {query}…",
    searchingGroupsFor: "AD qrupu axtarılır: {query}…",
    mappingsFailed: "Uyğunlaşdırma cədvəli oxunmadı",
    mappingsRetry: "Yenidən oxu",
    timeoutNote: "Kataloq əməliyyatları 30 saniyəyə qədər çəkə bilər.",
  },
  ru: {
    title: "Источник входа",
    sub: "Корпоративные учётные записи (Active Directory) и сопоставление групп в этой организации.",
    statusTitle: "Состояние",
    configured: "Каталог настроен",
    notConfigured: "Каталог не настроен. Вход с корпоративной записью отключён; используются только локальные записи. Это настройка сервера (LDAP_URL), и отсюда её изменить нельзя.",
    host: "Сервер",
    hostNote: "Показывается только адрес сервера; служебная запись и её пароль не входят ни в один ответ.",
    lastTest: "Последняя проверка связи",
    lastTestNever: "Не проверялась с последнего запуска сервера",
    lastTestOk: "Успешно",
    lastTestFail: "Неуспешно",
    lastTestUnknown: "Результат неизвестен",
    test: "Проверить связь",
    testing: "Проверяется…",
    testOk: "Подключение к каталогу выполнено, служебная запись принята.",
    reasonUnreachable: "Сервер недоступен. Проверьте адрес и сетевой путь (межсетевой экран, 636/TCP).",
    reasonTimeout: "Сервер не ответил за отведённое время. Контроллер домена может быть медленным или недоступным.",
    reasonTls: "Не удалось установить шифрованное соединение. Проверьте сертификат и цепочку корневых сертификатов; используется только LDAPS.",
    reasonServiceBindRejected: "Служебная запись отклонена. Её пароль мог измениться, истечь, или запись заблокирована.",
    reasonProtocol: "Сервер ответил неожиданным образом. Убедитесь, что адрес принадлежит серверу LDAP.",
    reasonUnknown: "Сервер не сообщил причину.",
    searchTitle: "Найти и импортировать запись",
    searchLabel: "Имя или логин",
    searchHint: "Не менее 2 знаков. Каталог не перечисляется, а ищется; результат — не более {cap} строк.",
    search: "Искать",
    searchGroups: "Искать группу",
    searching: "Идёт поиск…",
    searchNone: "Подходящих записей в каталоге нет.",
    searchCapped: "Показывается не более {cap} результатов; уточните запрос.",
    colName: "Имя",
    colLogin: "Логин",
    colState: "Состояние",
    colChoose: "Выбор",
    caption: "Результаты поиска в каталоге",
    alreadyImported: "Уже импортирована",
    disabled: "Отключена в каталоге",
    importable: "Можно импортировать",
    extraGroup: "Дополнительная группа (необязательно)",
    extraGroupHint: "Каждая импортированная запись получит и эту группу; предлагаются только группы, которые вы вправе выдать. Членства из групп AD добавляются отдельно, по таблице сопоставления.",
    extraGroupNone: "Без дополнительной группы",
    importChosen: "Импортировать выбранные ({count})",
    importProgress: "Отправлено {done} из {total} записей…",
    importDone: "Импортировано записей: {imported}; пропущено: {skipped}.",
    importChunkFailed: "{names}: отправить не удалось; эти записи по-прежнему выбраны. Импорт идемпотентен, повтор безопасен.",
    importedTitle: "Импортированные",
    skippedTitle: "Пропущенные",
    skipExists: "уже есть здесь",
    skipNotFound: "не найдена в каталоге",
    skipDisabled: "отключена в каталоге",
    skipExpired: "срок действия записи истёк",
    skipLoginTaken: "этот логин занят другой записью — измените имя в AD или деактивируйте запись здесь",
    skipNoUsername: "в каталоге нет логина",
    skipInvalidLogin: "логин не соответствует местному правилу (a-z, 0-9 и . _ @ -); запишите sAMAccountName латиницей: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e",
    skipUnknown: "сервер не сообщил причину",
    mapTitle: "Сопоставление групп AD",
    mapSub: "Участники группы AD при следующем входе получат выбранную здесь группу.",
    mapCaption: "Группа AD и её соответствие",
    colAdGroup: "Группа AD",
    colOurGroup: "Группа здесь",
    mapNone: "Сопоставлений пока нет.",
    mapReadOnly: "Таблица сопоставления только для чтения.",
    mapPickGroup: "Искать группу AD",
    mapPickHint: "Не менее 2 знаков. Отличительное имя (DN) выбирается из списка, а не вводится: у введённого вручную DN турецкие и азербайджанские буквы могут отличаться от написания в AD, и сопоставление молча не сработает.",
    mapOurGroup: "Какую группу выдавать",
    mapAdd: "Добавить сопоставление",
    mapAdded: "Сопоставление добавлено.",
    mapRemove: "Удалить сопоставление",
    mapRemoved: "Сопоставление удалено.",
    mapRemoveNote: "При удалении сопоставления снимаются и членства, полученные из этой группы AD.",
    mapStale: "Написание DN в этой строке может быть устаревшим: если сопоставление не работает, удалите строку и выберите группу из списка заново.",
    searchingFor: "Поиск: {query}…",
    searchingGroupsFor: "Поиск группы AD: {query}…",
    mappingsFailed: "Таблица сопоставления не прочитана",
    mappingsRetry: "Прочитать снова",
    timeoutNote: "Операции с каталогом могут занимать до 30 секунд.",
  },
  en: {
    title: "Login source",
    sub: "Corporate accounts (Active Directory) and this hospital's group mapping.",
    statusTitle: "Status",
    configured: "The directory is configured",
    notConfigured: "The directory is not configured. Signing in with a corporate account is off; only local accounts are in use. This is server configuration (LDAP_URL) and cannot be changed here.",
    host: "Server",
    hostNote: "Only the server's address is shown; the bind account and its password are in no response.",
    lastTest: "Last connection test",
    lastTestNever: "Not tested since the server last started",
    lastTestOk: "Succeeded",
    lastTestFail: "Failed",
    lastTestUnknown: "The result is not known",
    test: "Test the connection",
    testing: "Testing…",
    testOk: "The directory answered and the service account was accepted.",
    reasonUnreachable: "The server could not be reached. Check the address and the network path (firewall, 636/TCP).",
    reasonTimeout: "The server did not answer in time. The domain controller may be slow or unreachable.",
    reasonTls: "An encrypted connection could not be established. Check the certificate and its root chain; only LDAPS is used.",
    reasonServiceBindRejected: "The service account was rejected. Its password may have changed or expired, or the account may be locked.",
    reasonProtocol: "The server answered unexpectedly. Confirm the address belongs to an LDAP server.",
    reasonUnknown: "The server gave no reason.",
    searchTitle: "Find and import an account",
    searchLabel: "Name or username",
    searchHint: "At least 2 characters. The directory is searched, not listed; the answer is at most {cap} rows.",
    search: "Search",
    searchGroups: "Search for a group",
    searching: "Searching…",
    searchNone: "No matching directory account.",
    searchCapped: "At most {cap} results are shown; narrow the search.",
    colName: "Name",
    colLogin: "Username",
    colState: "State",
    colChoose: "Choose",
    caption: "Directory search results",
    alreadyImported: "Already imported",
    disabled: "Disabled in the directory",
    importable: "Can be imported",
    extraGroup: "Extra group (optional)",
    extraGroupHint: "Every imported account also gets this group; only groups you may grant are offered. Memberships from AD groups are added separately, from the mapping table.",
    extraGroupNone: "No extra group",
    importChosen: "Import the chosen ({count})",
    importProgress: "{done} of {total} accounts sent…",
    importDone: "{imported} accounts imported, {skipped} skipped.",
    importChunkFailed: "{names}: could not be sent; these accounts are still chosen. The import is idempotent, so trying again costs nothing.",
    importedTitle: "Imported",
    skippedTitle: "Skipped",
    skipExists: "already here",
    skipNotFound: "not found in the directory",
    skipDisabled: "disabled in the directory",
    skipExpired: "the account has expired",
    skipLoginTaken: "that username belongs to another account — rename it in AD, or deactivate the account here",
    skipNoUsername: "no username in the directory",
    skipInvalidLogin: "the username does not match the local rule (a-z, 0-9 and . _ @ -); write the sAMAccountName in its Latin form: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e",
    skipUnknown: "the server gave no reason",
    mapTitle: "AD group mapping",
    mapSub: "The members of an AD group get the group chosen here at their next sign-in.",
    mapCaption: "An AD group and what it grants",
    colAdGroup: "AD group",
    colOurGroup: "Group here",
    mapNone: "No mapping yet.",
    mapReadOnly: "The mapping table is read-only.",
    mapPickGroup: "Search for an AD group",
    mapPickHint: "At least 2 characters. The distinguished name (DN) is chosen from the list, never typed: a typed DN whose Turkish or Azerbaijani letters differ from AD's spelling will silently fail to match.",
    mapOurGroup: "Which group to grant",
    mapAdd: "Add the mapping",
    mapAdded: "The mapping was added.",
    mapRemove: "Delete the mapping",
    mapRemoved: "The mapping was deleted.",
    mapRemoveNote: "Deleting a mapping also removes the memberships it gave.",
    mapStale: "This row's DN spelling may be out of date: if it does not match, delete it and choose the group from the list again.",
    searchingFor: "Searching for {query}…",
    searchingGroupsFor: "Searching AD groups for {query}…",
    mappingsFailed: "The mapping table could not be read",
    mappingsRetry: "Read again",
    timeoutNote: "Directory operations can take up to 30 seconds.",
  },
};
```

- [ ] **Step 2: Take this arm's two lines in the catalogue.** In `dashboard/src/live/i18n/catalog.js`, replace

```javascript
// G1-14: import source from "./strings/source.js";
```

with

```javascript
import source from "./strings/source.js";
```

and replace

```javascript
  // G1-14: source,
```

with

```javascript
  source,
```

- [ ] **Step 3: List this arm's two reviewed identities.** In `dashboard/src/live/i18n/strings.test.js`, replace

```javascript
  // G1-14 (admin · login source) · az = tr
```

with

```javascript
  // G1-14 (admin · login source) · az = tr
  "source.colName", //       Ad — "name" in Azerbaijani too (as admin.colName)
  "source.colChoose", //     Seç — the same imperative in Azerbaijani
```

Those are the only two: everything else differs, and every Russian text in the namespace carries Cyrillic, so **`NEUTRAL` needs no entry from this arm** and its G1-14 block stays empty. (Task 4 gave that marker a blank line before `]);` so this arm and a later one do not meet there.)

- [ ] **Step 4: Check it**

```bash
npx vitest run src/live/i18n/strings.test.js 2>&1 | grep -E "Tests |→"
```
Expected: `Tests  6 passed (6)`.

If it names a key you did not expect, read the message rather than adding the key: while this was written the test caught `source.search` listed by mistake (`Ara` / `Axtar` differ, so it must **not** be listed) and then `source.colChoose`, which really is identical. The second loop of that test — "listed but az differs from tr now" — is what catches the first kind of mistake.

- [ ] **Step 5: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  103 passed (103)`, `Tests  2163 passed (2163)`, build clean.

- [ ] **Step 6: Commit**

```bash
git status --short
git add dashboard/src/live/i18n/strings/source.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js
git commit -m "$(cat <<'EOF'
feat(dashboard): the login-source namespace in four languages (G1-14)

The prototype's login-source box is a disabled mock-up with three fields an
operator cannot type in, two of which must never exist in a live screen: the
directory's host and search root are deployment configuration, not something
an administrator edits in a browser. So most of this namespace is new, and
most of it exists because "no" is not an answer: the connection test's five
reasons and the import's seven skip reasons each say what to check or what to
do, and the two skip reasons an administrator can act on say it in full.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** `103 / 2163` unchanged, `strings.test.js` green at 6.

---

### Task 11: The directory (G1-14)

**Files:**
- Create: `dashboard/src/live/screens/admin/SourceTab.jsx` + `SourceTab.test.jsx`
- Modify: `dashboard/src/live/screens/admin/AdminScreen.jsx` (two lines)

**About three hours.** Four sections, and the first one decides whether the other three exist.

- [ ] **Step 1: Write the whole failing test.** Create `dashboard/src/live/screens/admin/SourceTab.test.jsx`:

```jsx
// The login-source tab (G1-14). Synthetic directory objects only (admin.testutil.js): accounts
// under DC=sentetik,DC=local, never a real directory, a real export or a support capture.
//
// Every write that SUCCEEDS asserts the confirmation the administrator reads AND that no alert
// region carries anything. The toast's error region is mounted before the first toast
// (ui/Toast.jsx), so "no alert" is "every alert region is empty", never "no alert element".
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { LDAP_IMPORT_CHUNK, LDAP_QUERY_MAX, LDAP_SEARCH_CAP } from "../../../backendApi.js";
import { PERMISSION_KEYS } from "./catalogue.js";
import {
  ADMIN_READS, CATALOGUE, GROUPS, NURSE_GROUP, guid, ldapGroup, ldapStatus, ldapUser, mapping,
} from "./admin.testutil.js";
import { groupFromApi } from "./rules.js";
import { SourceTab, chunksOf, markImported, skipReasonKey, testReasonKey } from "./SourceTab.jsx";

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
/** A full administrator: writing the AD group mapping needs EVERY permission key (the server's own
 *  rule, 403 `mappingAdminOnly`), so a narrower desk is the read-only case and is passed by name. */
const DESK = [...PERMISSION_KEYS];
/** The host, and only the host (`LdapStatusOut.url_host`: no scheme, no port, no DN). */
const HOST = "dc01.sentetik.local";
const MAPPED_DN = "CN=YB-Hemsire,OU=Gruplar,DC=sentetik,DC=local";

async function open({ perms = DESK, groups = GROUPS, catalogue = CATALOGUE, setup } = {}) {
  const reload = vi.fn(async () => {});
  const admin = {
    data: { users: [], groups: groups.map(groupFromApi), catalogue, unassigned: 0 },
    loading: false, error: null, reload,
  };
  const mounted = await mount(<SourceTab admin={admin} />, {
    access: token({ sub: "u-admin", perms }),
    me: profile({ id: "u-admin", perms }),
    setup: (api) => { ADMIN_READS(api); setup?.(api); },
  });
  await act(async () => { await settle(); });
  return { ...mounted, admin, reload };
}

const searchFor = async (text = "sintetik") => {
  fireEvent.change(screen.getByLabelText(/Ad və ya istifadəçi adı/), { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Axtar" })); await settle(); });
};
const runTest = async () => {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Qoşulmanı yoxla" })); await settle(); });
};
/** Pick the one AD group the picker offers and the group it grants, and add the mapping. */
const addMapping = async () => {
  fireEvent.change(screen.getByLabelText(/AD qrupunu axtar/), { target: { value: "YB" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Qrupu axtar" })); await settle(); });
  fireEvent.change(screen.getByLabelText("AD qrupu"), { target: { value: ldapGroup().dn } });
  fireEvent.change(screen.getByLabelText(/Hansı qrup verilsin/), { target: { value: NURSE_GROUP.id } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Uyğunlaşdırmanı əlavə et" })); await settle(); });
};
const alerts = () => screen.getAllByRole("alert").map((a) => a.textContent).join(" ");
const notes = () => screen.queryAllByRole("note").map((n) => n.textContent).join(" ");
const statuses = () => screen.getAllByRole("status").map((s) => s.textContent).join(" ");

/** What a write that LANDED must look like to the administrator: the confirmation, and no alert. */
function expectConfirmed(text) {
  expect(screen.getAllByText(text).length, `confirmation ${text}`).toBeGreaterThan(0);
  expect(alerts().trim()).toBe("");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the pure parts", () => {
  it("names a sentence for each of the test's five reasons, and for one it has never seen", () => {
    expect(["unreachable", "timeout", "tls", "service_bind_rejected", "protocol"].map(testReasonKey)).toEqual([
      "source.reasonUnreachable", "source.reasonTimeout", "source.reasonTls",
      "source.reasonServiceBindRejected", "source.reasonProtocol",
    ]);
    expect(testReasonKey("something_new")).toBe("source.reasonUnknown");
    expect(testReasonKey(null)).toBe("source.reasonUnknown");
  });

  it("names a sentence for each of the import's seven skip reasons", () => {
    expect(["exists", "not_found", "disabled", "expired", "login_taken", "no_username", "invalid_login"]
      .map(skipReasonKey)).toEqual([
      "source.skipExists", "source.skipNotFound", "source.skipDisabled", "source.skipExpired",
      "source.skipLoginTaken", "source.skipNoUsername", "source.skipInvalidLogin",
    ]);
    expect(skipReasonKey("whatever")).toBe("source.skipUnknown");
  });

  it("cuts an import into chunks of LDAP_IMPORT_CHUNK, never larger than the API's cap", () => {
    expect(LDAP_IMPORT_CHUNK).toBe(2);
    expect(chunksOf(["a", "b", "c", "d", "e"])).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(chunksOf([])).toEqual([]);
    expect(chunksOf(["a"], 0)).toEqual([["a"]]);          // never an endless loop
    expect(chunksOf(Array.from({ length: 60 }, (_, i) => i), 100)).toHaveLength(2);  // capped at 50
  });

  it("marks as imported what the server imported — and what it skipped because it was already here", () => {
    const found = [ldapUser(1), ldapUser(2), ldapUser(3)];
    const after = markImported(found, {
      imported: [{ external_id: guid(1), id: "u-1", username: "hs.sintetik1", groups: [] }],
      skipped: [{ external_id: guid(2), reason: "exists" }, { external_id: guid(3), reason: "login_taken" }],
    });
    expect(after.map((row) => row.already_imported)).toEqual([true, true, false]);
    expect(found.map((row) => row.already_imported)).toEqual([false, false, false]);   // not in place
    expect(markImported(null, { imported: [], skipped: [] })).toEqual([]);
    expect(markImported(found, null).map((row) => row.already_imported)).toEqual([false, false, false]);
  });
});

describe("an unconfigured directory", () => {
  it("says so, and the search, the import and the mapping are not drawn", async () => {
    const { api } = await open({ setup: (a) => a.ldapStatus.mockResolvedValue({ configured: false }) });
    expect(screen.getByText(/Kataloq konfiqurasiya olunmayıb/)).toBeInTheDocument();
    expect(screen.queryByText("Hesab axtar və idxal et")).toBeNull();
    expect(screen.queryByText("AD qrup uyğunlaşdırması")).toBeNull();
    // Every other route answers 409 when the directory is off, so none of them is asked.
    expect(api.ldapMappings).not.toHaveBeenCalled();
    expect(api.ldapSearch).not.toHaveBeenCalled();
  });

  it("says the configuration is the server's and cannot be changed here", async () => {
    await open({ setup: (a) => a.ldapStatus.mockResolvedValue({ configured: false }) });
    expect(screen.getByText(/LDAP_URL/)).toBeInTheDocument();
  });
});

describe("the status", () => {
  it("says the directory is configured and shows the host only — never the bind account or its password", async () => {
    await open();
    expect(screen.getByText("Kataloq konfiqurasiya olunub")).toBeInTheDocument();
    const panel = screen.getByText(HOST).closest("div.rounded-box");
    // `LdapStatusOut` carries configured / url_host / last_test_at / last_test_ok and nothing
    // else, by design on the server. The status panel must not acquire any of the rest either —
    // and a DN in this panel could only be the SERVICE account's.
    expect(panel.innerHTML).not.toMatch(/CN=|DC=|ou=/i);
    expect(panel.textContent).not.toMatch(/:636|ldaps?:\/\//);                   // the host, not a URL
    // The panel DOES contain the word "şifrə" — in its own sentence saying the bind account and
    // its password are in no response. That sentence is the claim; what must not be there is a
    // VALUE, and `LdapStatusOut` carries none.
    expect(screen.getByText(/qoşulma hesabı və şifrəsi heç bir cavabda yer almır/)).toBeInTheDocument();
    // Nothing anywhere on the tab puts a secret or the host in a title, including the mapping rows
    // — whose DNs are the AD GROUPS', which the table shows in the open and which identify the row.
    for (const el of document.querySelectorAll("[title]")) {
      expect(el.getAttribute("title").toLowerCase()).not.toMatch(/parol|şifr|password|sentetik\.local/);
    }
  });

  it("says when the directory was last tested, and says \"not since the server last started\" when it was not", async () => {
    // The last test lives in the server's process memory: "never" would be a claim it cannot make.
    await open();
    expect(screen.getByText(/11\.10\.2026 .* · Uğurlu/)).toBeInTheDocument();
    cleanup();
    await open({ setup: (a) => a.ldapStatus.mockResolvedValue(ldapStatus({ last_test_at: null, last_test_ok: null })) });
    expect(screen.getByText("Server son dəfə başladılandan bəri yoxlanmayıb")).toBeInTheDocument();
    expect(screen.queryByText(/Hələ yoxlanmayıb/)).toBeNull();
  });

  it("a test that succeeds says the service account was accepted, with no alert, and the result is announced", async () => {
    const { api } = await open();
    api.ldapTest.mockResolvedValue({ ok: true, reason: null, checked_at: "2026-10-11T09:00:00Z" });
    await runTest();
    expect(notes()).toMatch(/xidmət hesabı doğrulandı/);
    expect(alerts().trim()).toBe("");
    // The visible result is a Note, which is not live; the one live region says it too.
    await waitFor(() => expect(statuses()).toContain("xidmət hesabı doğrulandı"), { timeout: 4000 });
    // And the status line now carries the new test's time.
    expect(screen.getByText(/11\.10\.2026 .* · Uğurlu/)).toBeInTheDocument();
  });

  it("each of the test's five refusals gets its own sentence, saying what to check", async () => {
    const CASES = [
      ["unreachable", /firewall, 636\/TCP/],
      ["timeout", /Domen kontrolleri yavaş/],
      ["tls", /yalnız LDAPS istifadə olunur/],
      ["service_bind_rejected", /Xidmət hesabı qəbul edilmədi/],
      ["protocol", /bir LDAP serverinə aid olduğunu doğrulayın/],
    ];
    for (const [reason, shown] of CASES) {
      // eslint-disable-next-line no-await-in-loop
      const { api } = await open();
      api.ldapTest.mockResolvedValue({ ok: false, reason, checked_at: "2026-10-11T09:00:00Z" });
      // eslint-disable-next-line no-await-in-loop
      await runTest();
      expect(notes(), reason).toMatch(shown);
      cleanup();
    }
  });

  it("a test the server refuses clears the previous result: no stale green beside a fresh refusal", async () => {
    const { api } = await open();
    api.ldapTest
      .mockResolvedValueOnce({ ok: true, reason: null, checked_at: "2026-10-11T09:00:00Z" })
      .mockRejectedValueOnce(refusal(503, "Dizin sunucusuna ulaşılamıyor"));
    await runTest();
    expect(notes()).toMatch(/xidmət hesabı doğrulandı/);
    await runTest();
    expect(notes()).not.toMatch(/xidmət hesabı doğrulandı/);
    expect(alerts()).toContain(HOST);                              // the refusal names the host
    expect(alerts()).toMatch(/kataloq serverinə/);
  });

  it("says directory operations can take up to thirty seconds", async () => {
    await open();
    expect(screen.getByText(/30 saniyəyə qədər/)).toBeInTheDocument();
  });
});

describe("the search", () => {
  it("says which results are already imported and which accounts are disabled", async () => {
    await open();
    await searchFor();
    const table = screen.getByRole("table", { name: "Kataloq axtarışının nəticələri" });
    const first = within(table).getByRole("rowheader", { name: "hs.sintetik1" }).closest("tr");
    expect(within(first).getByText("İdxal edilə bilər")).toBeInTheDocument();
    const second = within(table).getByRole("rowheader", { name: "hs.sintetik2" }).closest("tr");
    expect(within(second).getByText("Kataloqda bağlıdır")).toBeInTheDocument();
    expect(within(second).getByRole("checkbox", { name: "hs.sintetik2" })).toBeDisabled();
  });

  it("an already-imported account is named as such and cannot be chosen again", async () => {
    await open({ setup: (a) => a.ldapSearch.mockResolvedValue([ldapUser(3, { already_imported: true })]) });
    await searchFor();
    expect(screen.getByText("Artıq idxal olunub")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "hs.sintetik3" })).toBeDisabled();
  });

  it("sends the query with no limit of its own, says what the server's cap is, and holds the field to the server's length", async () => {
    const { api } = await open();
    await searchFor("sintetik");
    expect(api.ldapSearch).toHaveBeenCalledWith("sintetik");
    expect(screen.getByText(new RegExp(`ən çox ${LDAP_SEARCH_CAP} sətirdir`))).toBeInTheDocument();
    expect(screen.getByLabelText(/Ad və ya istifadəçi adı/)).toHaveAttribute("maxlength", String(LDAP_QUERY_MAX));
  });

  it("holds the search until the query is long enough to be accepted", async () => {
    const { api } = await open();
    fireEvent.change(screen.getByLabelText(/Ad və ya istifadəçi adı/), { target: { value: "a" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Axtar" })); await settle(); });
    expect(api.ldapSearch).not.toHaveBeenCalled();
  });

  it("says no account matched rather than showing an empty table", async () => {
    await open({ setup: (a) => a.ldapSearch.mockResolvedValue([]) });
    await searchFor();
    expect(screen.getByText("Uyğun gələn kataloq hesabı yoxdur.")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Kataloq axtarışının nəticələri" })).toBeNull();
  });

  it("says when the answer is at the server's cap, so a narrower query is the next step", async () => {
    const many = Array.from({ length: LDAP_SEARCH_CAP }, (_, i) => ldapUser(i + 10));
    await open({ setup: (a) => a.ldapSearch.mockResolvedValue(many) });
    await searchFor();
    expect(screen.getByText(new RegExp(`Ən çox ${LDAP_SEARCH_CAP} nəticə`))).toBeInTheDocument();
  });

  it("a refused search names the query on the toast and takes the old query's rows away", async () => {
    const { api } = await open();
    await searchFor("sintetik");
    expect(screen.getByRole("table", { name: "Kataloq axtarışının nəticələri" })).toBeInTheDocument();
    api.ldapSearch.mockRejectedValue(refusal(503, "Dizin sunucusuna ulaşılamıyor"));
    await searchFor("sintetik2");
    expect(alerts()).toContain("sintetik2");
    expect(alerts()).toMatch(/kataloq serverinə/);
    // The old query's rows do not stay under the new query's text.
    expect(screen.queryByRole("table", { name: "Kataloq axtarışının nəticələri" })).toBeNull();
  });
});

describe("the import", () => {
  const chooseAndImport = async (api, count = 3, between) => {
    const rows = Array.from({ length: count }, (_, i) => ldapUser(i + 1));
    api.ldapSearch.mockResolvedValue(rows);
    await searchFor();
    for (const row of rows) fireEvent.click(screen.getByRole("checkbox", { name: row.username }));
    between?.(count);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `Seçilənləri idxal et (${count})` }));
      await settle();
    });
    return rows;
  };

  it("is sent in chunks of two, strictly sequentially, with the extra group on every call — and reads as done", async () => {
    const { api, reload } = await open();
    api.ldapImport.mockResolvedValue({ imported: [], skipped: [] });
    // The extra-group choice only exists once there are results to import, so it is set inside
    // the helper's flow rather than before the search.
    await chooseAndImport(api, 3, (count) => {
      fireEvent.change(screen.getByLabelText(/Əlavə qrup/), { target: { value: NURSE_GROUP.id } });
      return count;
    });
    expect(api.ldapImport).toHaveBeenCalledTimes(2);                 // 3 accounts, chunks of 2
    expect(api.ldapImport.mock.calls[0]).toEqual([[guid(1), guid(2)], [NURSE_GROUP.id]]);
    expect(api.ldapImport.mock.calls[1]).toEqual([[guid(3)], [NURSE_GROUP.id]]);
    expectConfirmed(new RegExp(`${HOST} · 0 hesab idxal olundu, 0 hesab buraxıldı\\.`));
    expect(reload).toHaveBeenCalled();
  });

  it("offers as the extra group only one this desk may grant — a group beyond its rights would 403 the whole import", async () => {
    await open({ perms: ["users.manage", "board.view", "alerts.ack"] });
    await searchFor();
    const options = [...screen.getByLabelText(/Əlavə qrup/).querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toEqual(["Əlavə qrup verilməsin", "Hemşire", "Gece ekibi"]);
    expect(options).not.toContain("Sistem yöneticisi");
  });

  it("shows how many accounts it has sent while it is sending them, and holds the search meanwhile", async () => {
    let release;
    const { api } = await open();
    api.ldapImport.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const rows = [ldapUser(1), ldapUser(2), ldapUser(3)];
    api.ldapSearch.mockResolvedValue(rows);
    await searchFor();
    for (const row of rows) fireEvent.click(screen.getByRole("checkbox", { name: row.username }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Seçilənləri idxal et (3)" })); });
    expect(screen.getByText("0 / 3 hesab göndərildi…")).toBeInTheDocument();
    // A new search would drop the chosen rows out from under the import: its button says busy
    // (never disabled) and a press sends nothing.
    const search = screen.getByRole("button", { name: "Axtar" });
    expect(search).toHaveAttribute("aria-busy", "true");
    expect(search).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Ad və ya istifadəçi adı/), { target: { value: "başqa biri" } });
    await act(async () => { fireEvent.click(search); await settle(); });
    expect(api.ldapSearch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("checkbox", { name: "hs.sintetik3" })).toBeChecked();
    // The other operations are NOT held: one busy slot for four operations is what made them
    // look live while silently doing nothing.
    expect(screen.getByRole("button", { name: /Uyğunlaşdırmanı sil/ })).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("button", { name: "Qoşulmanı yoxla" })).not.toHaveAttribute("aria-busy");
    await act(async () => { release({ imported: [], skipped: [] }); await settle(); });
  });

  it("reports both halves of the answer, translates every skip reason, and marks the imported rows in the results", async () => {
    const { api } = await open();
    // One answer per chunk: `mockResolvedValue` would answer every chunk with the same body, and
    // the screen would correctly add two identical answers together.
    api.ldapImport
      .mockResolvedValueOnce({
        imported: [{ external_id: guid(1), id: "u-1", username: "hs.sintetik1", groups: [] }],
        skipped: [{ external_id: guid(2), reason: "login_taken" }],
      })
      .mockResolvedValueOnce({ imported: [], skipped: [{ external_id: guid(3), reason: "invalid_login" }] });
    await chooseAndImport(api, 3);
    expectConfirmed(new RegExp(`${HOST} · 1 hesab idxal olundu, 2 hesab buraxıldı\\.`));
    expect(screen.getByText("İdxal olunanlar")).toBeInTheDocument();
    expect(screen.getByText("Buraxılanlar")).toBeInTheDocument();
    // Each skip reason reads under the account it belongs to, and the two an administrator can
    // act on say what to do about them.
    const skipped = screen.getByText("Buraxılanlar").closest("div");
    expect(within(skipped).getByText("hs.sintetik2")).toBeInTheDocument();
    expect(within(skipped).getByText(/AD-də adı dəyişin və ya buradaki hesabı passivləşdirin/)).toBeInTheDocument();
    expect(within(skipped).getByText(/sAMAccountName-i Latın qarşılığı ilə yazın/)).toBeInTheDocument();
    // The imported account's row now says so and cannot be chosen again; the skipped ones can.
    const table = screen.getByRole("table", { name: "Kataloq axtarışının nəticələri" });
    const first = within(table).getByRole("rowheader", { name: "hs.sintetik1" }).closest("tr");
    expect(within(first).getByText("Artıq idxal olunub")).toBeInTheDocument();
    expect(within(first).getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "hs.sintetik2" })).not.toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "hs.sintetik2" })).not.toBeChecked();
  });

  it("a failed chunk is named by its accounts, the rest stay chosen, and the accounts already sent keep their answer", async () => {
    const { api } = await open();
    api.ldapImport
      .mockResolvedValueOnce({ imported: [{ external_id: guid(1), id: "u-1", username: "hs.sintetik1", groups: [] }], skipped: [] })
      .mockRejectedValueOnce(refusal(503, "Dizin sunucusuna ulaşılamıyor"));
    await chooseAndImport(api, 4);
    expect(api.ldapImport).toHaveBeenCalledTimes(2);                 // it stopped, it did not carry on
    // Named by the accounts, which is what the administrator sees in the table — not by an index
    // range into a column the table does not show.
    expect(alerts()).toMatch(/hs\.sintetik3, hs\.sintetik4: /);
    expect(alerts()).toMatch(/kataloq serverinə/);
    expect(notes()).toMatch(/hs\.sintetik3, hs\.sintetik4: göndərilə bilmədi; bu hesablar hələ seçilidir/);
    // The first chunk's accounts are imported now, no longer chosen; the failed chunk's still are.
    expect(screen.getByRole("checkbox", { name: "hs.sintetik1" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "hs.sintetik1" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "hs.sintetik3" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "hs.sintetik4" })).toBeChecked();
    // The first chunk's answer stands: its account is in the "imported" list as well as in the
    // search results it came from.
    const imported = screen.getByText("İdxal olunanlar").closest("div");
    expect(within(imported).getByText("hs.sintetik1")).toBeInTheDocument();
  });

  it("a timeout says the operation may have happened", async () => {
    const { api } = await open();
    api.ldapImport.mockRejectedValue(Object.assign(new Error("…"), { code: "REQUEST_TIMEOUT" }));
    await chooseAndImport(api, 2);
    expect(alerts()).toMatch(/Server cavab vermədi\. Əməliyyat yerinə yetirilmiş ola bilər/);
  });
});

describe("the group mapping", () => {
  it("lists the rows with the AD group and the group it grants", async () => {
    await open();
    const table = screen.getByRole("table", { name: "AD qrupu və qarşılığı" });
    expect(within(table).getByRole("rowheader", { name: /CN=YB-Hemsire/ })).toBeInTheDocument();
    expect(within(table).getByText("Hemşire")).toBeInTheDocument();
  });

  it("says of every row that its DN spelling may be out of date, and offers to re-create it", async () => {
    await open();
    expect(screen.getByText(/uyğunlaşmırsa silib siyahıdan yenidən seçin/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Uyğunlaşdırmanı sil: CN=YB-Hemsire/ })).toBeInTheDocument();
  });

  it("a table that could not be read says so, with the server's reason and a retry — never \"loading\" forever", async () => {
    const { api } = await open({ setup: (a) => a.ldapMappings.mockRejectedValueOnce(refusal(503, "Dizin sunucusuna ulaşılamıyor")) });
    expect(notes()).toMatch(/Uyğunlaşdırma cədvəli oxunmadı: .*kataloq serverinə/);
    expect(screen.queryByRole("table", { name: "AD qrupu və qarşılığı" })).toBeNull();
    expect(alerts().trim()).toBe("");                              // a read, not a refused write
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenidən oxu" })); await settle(); });
    expect(api.ldapMappings).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("table", { name: "AD qrupu və qarşılığı" })).toBeInTheDocument();
    expect(notes()).not.toMatch(/Uyğunlaşdırma cədvəli oxunmadı/);
  });

  it("is read-only without every permission, with the server's own reason", async () => {
    await open({ perms: ["users.manage", "board.view"] });
    expect(screen.getByText(/AD qrup uyğunlaşdırmasını yalnız bütün səlahiyyətlərə sahib/)).toBeInTheDocument();
    expect(screen.getByText("Uyğunlaşdırma cədvəli yalnız oxunur.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Uyğunlaşdırmanı sil/ })).toBeNull();
    expect(screen.queryByLabelText(/AD qrupunu axtar/)).toBeNull();
  });

  it("a DN comes from the picker, the panel says why a typed one may not match, and the add reads as done", async () => {
    const { api } = await open();
    api.ldapCreateMapping.mockResolvedValue(mapping({ id: "m-2" }));
    expect(screen.getByText(/əl ilə yazılan DN-in Türk\/Azərbaycan hərfləri/)).toBeInTheDocument();
    await addMapping();
    expect(api.ldapGroups).toHaveBeenCalledWith("YB");
    // The DN is a <select> option, never an <input> the DN can be typed into.
    expect(screen.getByLabelText("AD qrupu").tagName).toBe("SELECT");
    expect(api.ldapCreateMapping).toHaveBeenCalledWith(ldapGroup().dn, NURSE_GROUP.id);
    expectConfirmed(/YB-Hemsire · Uyğunlaşdırma əlavə edildi\./);
    expect(api.ldapMappings).toHaveBeenCalledTimes(2);                 // read back, not assumed
  });

  it("a mapping that LANDED is never reported refused: a failed re-read is the table's own failure, with a retry", async () => {
    const { api } = await open({ setup: (a) => {
      a.ldapCreateMapping.mockResolvedValue(mapping({ id: "m-2" }));
      // The read on mount answers; the re-read after the write does not.
      a.ldapMappings.mockResolvedValueOnce([mapping()]).mockRejectedValueOnce(refusal(503, "Dizin sunucusuna ulaşılamıyor"));
    } });
    await addMapping();
    expect(api.ldapCreateMapping).toHaveBeenCalledTimes(1);
    expectConfirmed(/YB-Hemsire · Uyğunlaşdırma əlavə edildi\./);   // the write's own truth, and no alert
    expect(notes()).toMatch(/Uyğunlaşdırma cədvəli oxunmadı: .*kataloq serverinə/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenidən oxu" })); await settle(); });
    expect(screen.getByRole("table", { name: "AD qrupu və qarşılığı" })).toBeInTheDocument();
  });

  it("a refused mapping names the AD group on the toast", async () => {
    const { api } = await open();
    api.ldapCreateMapping.mockRejectedValue(refusal(409, "Bu AD grubu bu gruba zaten eşlenmiş"));
    await addMapping();
    expect(alerts()).toContain("YB-Hemsire");
    expect(alerts()).toMatch(/Bu AD qrupu bu qrupa artıq uyğunlaşdırılıb/);
  });

  it("deleting a mapping says the memberships it gave are removed with it, reads as done, and re-reads the list", async () => {
    const { api } = await open();
    api.ldapDeleteMapping.mockResolvedValue(null);
    expect(screen.getByText(/üzvlüklər də götürülür/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Uyğunlaşdırmanı sil: CN=YB-Hemsire/ }));
      await settle();
    });
    expect(api.ldapDeleteMapping).toHaveBeenCalledWith("m-1");
    expectConfirmed(new RegExp(`${MAPPED_DN} · Uyğunlaşdırma silindi\\.`));
    expect(api.ldapMappings).toHaveBeenCalledTimes(2);                 // read back, not assumed
  });
});

describe("accessibility", () => {
  it("the search results and the mapping are tables with captions and row headers", async () => {
    await open();
    await searchFor();
    for (const name of ["Kataloq axtarışının nəticələri", "AD qrupu və qarşılığı"]) {
      const table = screen.getByRole("table", { name });
      expect(table.querySelector("caption")).toHaveTextContent(name);
      for (const header of within(table).getAllByRole("columnheader")) expect(header.getAttribute("scope")).toBe("col");
      for (const header of within(table).getAllByRole("rowheader")) expect(header.getAttribute("scope")).toBe("row");
    }
  });

  it("every control is busy rather than natively disabled, except a row that cannot be chosen", async () => {
    await open();
    for (const control of screen.getAllByRole("button")) {
      expect(control.hasAttribute("disabled"), control.getAttribute("aria-label") || control.textContent).toBe(false);
    }
  });

  it("says what is in flight, once, while the directory is being tested — and names the row while a mapping is being deleted", async () => {
    let release;
    const { api } = await open();
    api.ldapTest.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Qoşulmanı yoxla" })); });
    await waitFor(() => expect(statuses()).toContain("Yoxlanılır…"), { timeout: 4000 });
    expect(screen.getAllByRole("status")).toHaveLength(1);
    await act(async () => { release({ ok: true, reason: null, checked_at: "2026-10-11T09:00:00Z" }); await settle(); });

    let releaseDelete;
    api.ldapDeleteMapping.mockImplementation(() => new Promise((resolve) => { releaseDelete = resolve; }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Uyğunlaşdırmanı sil: CN=YB-Hemsire/ })); });
    await waitFor(() => expect(statuses()).toContain(`${MAPPED_DN} · yadda saxlanılır…`), { timeout: 4000 });
    await act(async () => { releaseDelete(null); await settle(); });
  });

  it("has no h1 of its own: the screen's heading is the frame's", async () => {
    await open();
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 2, name: "Giriş mənbəyi" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/live/screens/admin/SourceTab.test.jsx 2>&1 | grep -E "Failed to resolve|Tests " | head -3
```
Expected: `Failed to resolve import "./SourceTab.jsx"`.

- [ ] **Step 3: Write the tab.** Create `dashboard/src/live/screens/admin/SourceTab.jsx`:

```jsx
// src/live/screens/admin/SourceTab.jsx — the directory (G1-14): its status, a connection test, a
// search-and-import, and the AD group mapping.
//
// FOUR SECTIONS, AND THE FIRST ONE DECIDES WHETHER THE OTHER THREE EXIST. `GET /admin/ldap/status`
// is the only route that answers when the directory is off; every other one answers 409
// `Dizin yapılandırılmamış` (`ldap_router.configured_ldap`). A screen that drew a search box on an
// unconfigured deployment would be offering a 409, so when `configured` is false the other three
// sections are not drawn and one sentence says what that means and where it is configured.
//
// THE STATUS SHOWS THE HOST ONLY. `LdapStatusOut` carries `configured`, `url_host`, `last_test_at`
// and `last_test_ok` and nothing else: no bind DN, no password, by design on the server. This
// screen prints `url_host` and never puts it in a title either. The last test lives in the
// server's process memory, so "not tested" means "not since the server last started" and the
// sentence says that rather than "never".
//
// "NO" IS NOT AN ANSWER AN ADMINISTRATOR CAN ACT ON. The test's five reasons — `unreachable`,
// `timeout`, `tls`, `service_bind_rejected`, `protocol` — each get a sentence that says what to
// check. A sixth reason the server invents later falls back to "it gave no reason", which is at
// least true. A failed test clears the previous result: a stale green "connected" beside a fresh
// refusal is two answers to one question.
//
// THE IMPORT IS SENT IN CHUNKS OF `LDAP_IMPORT_CHUNK`, STRICTLY SEQUENTIALLY. The server runs
// `IMPORT_LOOKUPS` directory lookups at a time across EVERY request, out of `ADMIN_LANE_SLOTS`, so
// two concurrent imports would hold the whole admin lane and the administrator's own next search
// would wait a deadline and then answer 503. The chunk is 2, one wave of lookups, about 24 s on a
// slow controller — and nginx's `/admin` location has no `proxy_read_timeout`, so its 60 s default
// would 504 a larger chunk before the server finished. Each chunk's answer is kept, the rows it
// imported are marked imported in the results, a failed chunk is named by its accounts and leaves
// them chosen, and the import is idempotent: an account already here comes back as
// `skipped: "exists"`, so trying again costs nothing. While an import runs, the search is held —
// a new search would drop the chosen rows out from under it.
//
// A DN IS CHOSEN, NEVER TYPED. `canonical_dn` stores and compares a DN in a canonical spelling, and
// a hand-typed one whose Turkish or Azerbaijani letters differ in case from AD's will not match —
// silently, which is the worst kind (Wave 1A's F5 note). So the mapping's DN comes from a picker
// over `GET /admin/ldap/groups`, and a row stored before the canonicalisation may already be in
// that state: each row carries one sentence offering to delete it and choose again.
//
// WRITING THE MAPPING NEEDS EVERY PERMISSION. The server's own rule (403 `mappingAdminOnly`): a
// desk that may not regroup one nurse directly must not regroup every nurse at once through the
// mapping. `canMapGroups` decides what is drawn, and the sentence beside the read-only table is
// the server's own reason.
//
// A WRITE THAT LANDED IS NEVER REPORTED REFUSED. The mapping table is re-read after a write, and
// the re-read is a READ: it runs after the write's own try/catch, and its failure is shown as the
// table's own "could not be read", with a retry — not as a refusal of a mapping that now exists.
//
// EVERY OPERATION HAS ITS OWN "IN FLIGHT", AND THE ANNOUNCEMENT NAMES IT. One shared flag made the
// search, the add and the delete LOOK live during an import while silently doing nothing — a
// control that is offered and does nothing is rejected on the clinical screens in as many words.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import {
  LDAP_IMPORT_CHUNK, LDAP_IMPORT_MAX, LDAP_QUERY_MAX, LDAP_QUERY_MIN, LDAP_SEARCH_CAP,
} from "../../../backendApi.js";
import { Announce, Box, Button, Empty, Field, Input, KV, KVList, Note, Pill, Select, Table, Tag, useToast } from "../../ui/index.js";
import { ddmmyyyy, hhmm } from "../../i18n/dates.js";
import { canGrant, canMapGroups } from "./rules.js";
import { doneFor, refusedFor } from "./refusal.js";

/** The five reasons `POST /admin/ldap/test` can give, each as a sentence that says what to check. */
const TEST_REASON = {
  unreachable: "source.reasonUnreachable",
  timeout: "source.reasonTimeout",
  tls: "source.reasonTls",
  service_bind_rejected: "source.reasonServiceBindRejected",
  protocol: "source.reasonProtocol",
};
/** The seven reasons the import can skip an account (`ldap_service.SKIP_*`). */
const SKIP_REASON = {
  exists: "source.skipExists",
  not_found: "source.skipNotFound",
  disabled: "source.skipDisabled",
  expired: "source.skipExpired",
  login_taken: "source.skipLoginTaken",
  no_username: "source.skipNoUsername",
  invalid_login: "source.skipInvalidLogin",
};
export const testReasonKey = (reason) => TEST_REASON[reason] || "source.reasonUnknown";
export const skipReasonKey = (reason) => SKIP_REASON[reason] || "source.skipUnknown";

/** `[ids]` cut into chunks of `LDAP_IMPORT_CHUNK`, never more than `LDAP_IMPORT_MAX` in one call. */
export function chunksOf(ids, size = LDAP_IMPORT_CHUNK) {
  const step = Math.max(1, Math.min(size, LDAP_IMPORT_MAX));
  const out = [];
  for (let at = 0; at < ids.length; at += step) out.push(ids.slice(at, at + step));
  return out;
}

/** The search results after an import answer: every account the server says it imported, or
 *  skipped because it already existed, is now imported — so its row says so and cannot be chosen
 *  again. Pure, so a test can hold it without a directory. */
export function markImported(found, answer) {
  const done = new Set([
    ...(answer?.imported ?? []).map((row) => row.external_id),
    ...(answer?.skipped ?? []).filter((row) => row.reason === "exists").map((row) => row.external_id),
  ]);
  return (found ?? []).map((row) => (done.has(row.external_id) ? { ...row, already_imported: true } : row));
}

const stamp = (iso) => (iso ? `${ddmmyyyy(Date.parse(iso))} ${hhmm(Date.parse(iso))}` : null);

export function SourceTab({ admin }) {
  const { t } = useI18n();
  const { user: me, store } = useSession();
  const toast = useToast();
  const api = store.api;
  const { groups, catalogue } = admin.data;
  const mayMap = canMapGroups(me.perms, catalogue);

  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);

  const [query, setQuery] = useState("");
  const [found, setFound] = useState(null);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState(() => new Set());
  const [extraGroup, setExtraGroup] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [report, setReport] = useState(null);
  const [chunkFailed, setChunkFailed] = useState(null);

  const [mappings, setMappings] = useState(null);
  const [mappingsError, setMappingsError] = useState(null);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [adQuery, setAdQuery] = useState("");
  const [adGroups, setAdGroups] = useState(null);
  const [groupSearching, setGroupSearching] = useState(false);
  const [adDn, setAdDn] = useState("");
  const [ourGroup, setOurGroup] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  /** The mapping table, read on its own: a read, with its own failure and its own retry. */
  const readMappings = useCallback(async () => {
    setMappingsLoading(true);
    setMappingsError(null);
    try {
      const rows = await store.track(() => api.ldapMappings());
      if (mounted.current) setMappings(Array.isArray(rows) ? rows : []);
    } catch (err) {
      if (mounted.current) setMappingsError(err);
    } finally {
      if (mounted.current) setMappingsLoading(false);
    }
  }, [api, store]);

  const read = useCallback(async () => {
    try {
      const answer = await store.track(() => api.ldapStatus());
      if (!mounted.current) return;
      setStatus(answer);
      setStatusError(null);
      if (answer?.configured) await readMappings();
    } catch (err) {
      if (mounted.current) setStatusError(err);
    }
  }, [api, store, readMappings]);

  useEffect(() => { read(); }, [read]);

  async function runTest() {
    if (testing) return;
    setTesting(true);
    setTest(null);
    try {
      const answer = await store.track(() => api.ldapTest());
      if (!mounted.current) return;
      setTest(answer);
      setStatus((was) => (was ? { ...was, last_test_at: answer?.checked_at, last_test_ok: answer?.ok } : was));
    } catch (err) {
      // No stale result beside a refusal: the previous answer was cleared when the test began.
      toast(refusedFor(t, status?.url_host ?? "", err), "error");
    } finally {
      if (mounted.current) setTesting(false);
    }
  }

  async function runSearch(event) {
    event?.preventDefault?.();
    // Held during an import: a new answer would drop the chosen rows out from under it.
    if (searching || importing || query.trim().length < LDAP_QUERY_MIN) return;
    setSearching(true);
    setReport(null);
    setChunkFailed(null);
    try {
      const rows = await store.track(() => api.ldapSearch(query.trim()));
      if (!mounted.current) return;
      setFound(Array.isArray(rows) ? rows : []);
      setChosen(new Set());
    } catch (err) {
      if (!mounted.current) return;
      // The old query's rows do not stay under the new query's text.
      setFound(null);
      setChosen(new Set());
      toast(refusedFor(t, query.trim(), err), "error");
    } finally {
      if (mounted.current) setSearching(false);
    }
  }

  const nameOf = (id) => found?.find((row) => row.external_id === id)?.username ?? id;

  /** Strictly sequential, chunk by chunk. A failed chunk stops the run, is named by its accounts,
   *  and leaves them chosen; the chunks already sent keep their answers. */
  async function runImport() {
    const ids = [...chosen];
    if (importing || ids.length === 0) return;
    setImporting(true);
    setChunkFailed(null);
    const chunks = chunksOf(ids);
    const imported = [];
    const skipped = [];
    let done = 0;
    try {
      for (const chunk of chunks) {
        setProgress({ done, total: ids.length });
        // eslint-disable-next-line no-await-in-loop
        const answer = await store.track(() => api.ldapImport(chunk, extraGroup ? [extraGroup] : []));
        if (!mounted.current) return;
        imported.push(...(answer?.imported ?? []));
        skipped.push(...(answer?.skipped ?? []));
        done += chunk.length;
        setChosen((was) => new Set([...was].filter((id) => !chunk.includes(id))));
        setFound((was) => markImported(was, answer));
      }
      setReport({ imported, skipped });
      toast(doneFor(t, status?.url_host ?? "", t("source.importDone", { imported: imported.length, skipped: skipped.length })));
      await admin.reload();
    } catch (err) {
      if (!mounted.current) return;
      setReport({ imported, skipped });
      const names = chunks[Math.floor(done / Math.max(1, LDAP_IMPORT_CHUNK))]?.map(nameOf).join(", ") ?? "";
      setChunkFailed(names);
      toast(refusedFor(t, names, err), "error");
    } finally {
      if (mounted.current) {
        setProgress(null);
        setImporting(false);
      }
    }
  }

  async function searchAdGroups(event) {
    event?.preventDefault?.();
    if (groupSearching || adQuery.trim().length < LDAP_QUERY_MIN) return;
    setGroupSearching(true);
    try {
      const rows = await store.track(() => api.ldapGroups(adQuery.trim()));
      if (mounted.current) setAdGroups(Array.isArray(rows) ? rows : []);
    } catch (err) {
      if (!mounted.current) return;
      setAdGroups(null);
      setAdDn("");
      toast(refusedFor(t, adQuery.trim(), err), "error");
    } finally {
      if (mounted.current) setGroupSearching(false);
    }
  }

  async function addMapping() {
    if (adding || !adDn || !ourGroup) return;
    setAdding(true);
    const name = adGroups?.find((g) => g.dn === adDn)?.name ?? adDn;
    let landed = false;
    try {
      await store.track(() => api.ldapCreateMapping(adDn, ourGroup));
      landed = true;
      toast(doneFor(t, name, t("source.mapAdded")));
      setAdDn("");
      setOurGroup("");
    } catch (err) {
      toast(refusedFor(t, name, err), "error");
    } finally {
      if (mounted.current) setAdding(false);
    }
    // After the write's own try: a re-read that fails is a READ failure, shown on the table with
    // its retry — never a refusal of a row that now exists.
    if (landed && mounted.current) await readMappings();
  }

  async function removeMapping(row) {
    if (removingId) return;
    setRemovingId(row.id);
    let landed = false;
    try {
      await store.track(() => api.ldapDeleteMapping(row.id));
      landed = true;
      toast(doneFor(t, row.ad_group_dn, t("source.mapRemoved")));
    } catch (err) {
      toast(refusedFor(t, row.ad_group_dn, err), "error");
    } finally {
      if (mounted.current) setRemovingId(null);
    }
    if (landed && mounted.current) await readMappings();
  }

  /** The extra group an import may give: only a group this desk may grant (`canGrant`) — the
   *  server refuses the WHOLE import otherwise (403 `_grantable`), and offering the system group
   *  here would make that the common case. */
  const grantable = useMemo(() => groups.filter((g) => canGrant(me.perms, g, catalogue)), [groups, me.perms, catalogue]);

  const stateOf = (row) => {
    if (row.already_imported) return <Tag>{t("source.alreadyImported")}</Tag>;
    if (row.disabled) return <Tag tone="warn">{t("source.disabled")}</Tag>;
    return <Pill icon="ok">{t("source.importable")}</Pill>;
  };

  // ONE live region, and it says WHICH operation is in flight — or, once a test has answered,
  // what it answered. The visible test result is a Note, which is not live.
  const removingDn = mappings?.find((row) => row.id === removingId)?.ad_group_dn ?? "";
  const announced = testing ? t("source.testing")
    : searching ? t("source.searchingFor", { query: query.trim() })
      : importing && progress ? t("source.importProgress", progress)
        : groupSearching ? t("source.searchingGroupsFor", { query: adQuery.trim() })
          : adding ? t("admin.savingFor", { subject: adGroups?.find((g) => g.dn === adDn)?.name ?? adDn })
            : removingId ? t("admin.savingFor", { subject: removingDn })
              : test ? (test.ok ? t("source.testOk") : t(testReasonKey(test.reason)))
                : "";

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="m-0 font-display text-17 font-bold">{t("source.title")}</h2>
        <p className="m-0 text-13 text-mute">{t("source.sub")}</p>
      </div>

      <Box title={t("source.statusTitle")} icon="key" level={3}>
        {statusError ? <Note tone="warn" icon="plug">{refusedFor(t, "", statusError)}</Note> : null}
        {status === null && !statusError ? <p className="m-0 text-13 text-mute">{t("admin.loading")}</p> : null}
        {status && !status.configured ? <Note tone="info" icon="plug">{t("source.notConfigured")}</Note> : null}
        {status?.configured ? (
          <>
            <p className="m-0 mb-2"><Pill icon="ok">{t("source.configured")}</Pill></p>
            <KVList>
              <KV label={t("source.host")}>
                {/* The host, and only the host. No bind DN and no password reach this screen. */}
                <span className="font-data">{status.url_host}</span>
              </KV>
              <KV label={t("source.lastTest")}>
                {status.last_test_at
                  ? `${stamp(status.last_test_at)} · ${t(status.last_test_ok === true ? "source.lastTestOk"
                    : status.last_test_ok === false ? "source.lastTestFail" : "source.lastTestUnknown")}`
                  : t("source.lastTestNever")}
              </KV>
            </KVList>
            <p className="m-0 mt-2 text-12 text-mute">{t("source.hostNote")}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button icon="plug" busy={testing} onClick={runTest}>{t("source.test")}</Button>
              <span className="text-12 text-mute">{t("source.timeoutNote")}</span>
            </div>
            {test ? (
              test.ok
                ? <Note tone="info" icon="ok" className="mt-2">{t("source.testOk")}</Note>
                : <Note tone="warn" icon="alert" className="mt-2">{t(testReasonKey(test.reason))}</Note>
            ) : null}
          </>
        ) : null}
      </Box>

      {status?.configured ? (
        <Box title={t("source.searchTitle")} icon="search" level={3}>
          <form noValidate onSubmit={runSearch} className="flex flex-wrap items-end gap-2">
            <Field layout="col" label={t("source.searchLabel")} hint={t("source.searchHint", { cap: LDAP_SEARCH_CAP })}
              className="mb-0 min-w-[220px] flex-1">
              <Input value={query} maxLength={LDAP_QUERY_MAX} disabled={searching} onChange={(e) => setQuery(e.target.value)} />
            </Field>
            {/* Busy while an import runs too: the search is held then (see runSearch), and a button
                that looks live and does nothing is the thing the clinical screens refuse. */}
            <Button icon="search" busy={searching || importing} onClick={runSearch}>{t("source.search")}</Button>
          </form>

          {found === null ? null : found.length === 0 ? (
            <Empty icon="users" className="mt-3">{t("source.searchNone")}</Empty>
          ) : (
            <>
              {found.length >= LDAP_SEARCH_CAP ? (
                <p className="m-0 mt-2 text-12.5 text-mute">{t("source.searchCapped", { cap: LDAP_SEARCH_CAP })}</p>
              ) : null}
              <Table caption={t("source.caption")} className="mt-3">
                <thead>
                  <tr>
                    <th scope="col">{t("source.colLogin")}</th>
                    <th scope="col">{t("source.colName")}</th>
                    <th scope="col">{t("source.colState")}</th>
                    <th scope="col">{t("source.colChoose")}</th>
                  </tr>
                </thead>
                <tbody>
                  {found.map((row) => (
                    <tr key={row.external_id}>
                      <th scope="row" className="font-data font-semibold">{row.username}</th>
                      <td>{row.display_name || row.upn || "—"}</td>
                      <td>{stateOf(row)}</td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={row.username}
                          checked={chosen.has(row.external_id)}
                          disabled={row.already_imported || row.disabled || importing}
                          onChange={(e) => setChosen((was) => {
                            const next = new Set(was);
                            if (e.target.checked) next.add(row.external_id);
                            else next.delete(row.external_id);
                            return next;
                          })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>

              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Field layout="col" label={t("source.extraGroup")} hint={t("source.extraGroupHint")} className="mb-0">
                  <Select value={extraGroup} disabled={importing} onChange={(e) => setExtraGroup(e.target.value)}>
                    <option value="">{t("source.extraGroupNone")}</option>
                    {grantable.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </Select>
                </Field>
                <Button icon="userPlus" variant="primary" busy={importing} onClick={runImport}>
                  {t("source.importChosen", { count: chosen.size })}
                </Button>
              </div>
              {progress ? (
                <p className="m-0 mt-2 text-12.5 text-mute">{t("source.importProgress", progress)}</p>
              ) : null}
              {/* A Note, not an Alert: the chunk's refusal was announced once, on the toast, named
                  by its accounts; this is the visible explanation of what stays chosen and why a
                  retry is safe. */}
              {chunkFailed ? <Note tone="warn" icon="swap" className="mt-2">{t("source.importChunkFailed", { names: chunkFailed })}</Note> : null}
            </>
          )}

          {report ? (
            <div className="mt-3 flex flex-col gap-2">
              {report.imported.length > 0 ? (
                <div>
                  <h4 className="m-0 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("source.importedTitle")}</h4>
                  <ul className="m-0 mt-1 list-none p-0 text-13">
                    {report.imported.map((row) => <li key={row.external_id} className="font-data">{row.username}</li>)}
                  </ul>
                </div>
              ) : null}
              {report.skipped.length > 0 ? (
                <div>
                  <h4 className="m-0 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("source.skippedTitle")}</h4>
                  <ul className="m-0 mt-1 list-none p-0 text-13">
                    {report.skipped.map((row) => (
                      <li key={row.external_id}>
                        <span className="font-data">{nameOf(row.external_id)}</span>
                        {" — "}
                        {t(skipReasonKey(row.reason))}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </Box>
      ) : null}

      {status?.configured ? (
        <Box title={t("source.mapTitle")} icon="link" level={3}>
          <p className="m-0 mb-2 text-13 text-mute">{t("source.mapSub")}</p>
          {mayMap ? null : <Note tone="info" icon="shield">{t("errors.mappingAdminOnly")}</Note>}

          {mappingsError ? (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Note tone="warn" icon="plug">{refusedFor(t, t("source.mappingsFailed"), mappingsError)}</Note>
              <Button size="sm" icon="swap" busy={mappingsLoading} onClick={readMappings}>{t("source.mappingsRetry")}</Button>
            </div>
          ) : null}
          {mappings === null && !mappingsError ? <p className="m-0 text-13 text-mute">{t("admin.loading")}</p>
            : mappings !== null && mappings.length === 0 ? <Empty icon="link">{t("source.mapNone")}</Empty>
              : mappings !== null ? (
                <Table caption={t("source.mapCaption")}>
                  <thead>
                    <tr>
                      <th scope="col">{t("source.colAdGroup")}</th>
                      <th scope="col">{t("source.colOurGroup")}</th>
                      {mayMap ? <th scope="col">{t("admin.colActions")}</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.map((row) => (
                      <tr key={row.id}>
                        <th scope="row" className="font-data font-normal">
                          {row.ad_group_dn}
                          {/* A row stored before the DNs were canonicalised may no longer match, and
                              it cannot be told apart from a good one here — so every row carries the
                              offer rather than a guess. */}
                          <span className="mt-0.5 block font-text text-10.5 text-mute">{t("source.mapStale")}</span>
                        </th>
                        <td>{row.group_name}</td>
                        {mayMap ? (
                          <td>
                            <Button size="sm" variant="ghost" icon="trash" busy={removingId === row.id}
                              label={`${t("source.mapRemove")}: ${row.ad_group_dn}`}
                              onClick={() => removeMapping(row)} />
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : null}
          {mayMap ? null : <p className="m-0 mt-2 text-12 text-mute">{t("source.mapReadOnly")}</p>}

          {mayMap ? (
            <>
              <p className="m-0 mt-3 text-12 text-mute">{t("source.mapRemoveNote")}</p>
              <form noValidate onSubmit={searchAdGroups} className="mt-2 flex flex-wrap items-end gap-2">
                <Field layout="col" label={t("source.mapPickGroup")} hint={t("source.mapPickHint")}
                  className="mb-0 min-w-[220px] flex-1">
                  <Input value={adQuery} maxLength={LDAP_QUERY_MAX} disabled={groupSearching} onChange={(e) => setAdQuery(e.target.value)} />
                </Field>
                {/* Its own words, not "Search": two buttons named identically on one panel are two
                    buttons a screen-reader user cannot tell apart, and this panel has two
                    searches — one over accounts and one over the directory's groups. */}
                <Button icon="search" busy={groupSearching} onClick={searchAdGroups}>{t("source.searchGroups")}</Button>
              </form>
              {adGroups === null ? null : (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <Field layout="col" label={t("source.colAdGroup")} className="mb-0 min-w-[240px] flex-1">
                    <Select value={adDn} disabled={adding} onChange={(e) => setAdDn(e.target.value)}>
                      <option value="">—</option>
                      {adGroups.map((g) => <option key={g.dn} value={g.dn}>{`${g.name} — ${g.dn}`}</option>)}
                    </Select>
                  </Field>
                  <Field layout="col" label={t("source.mapOurGroup")} className="mb-0">
                    <Select value={ourGroup} disabled={adding} onChange={(e) => setOurGroup(e.target.value)}>
                      <option value="">—</option>
                      {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </Select>
                  </Field>
                  <Button icon="plus" variant="primary" busy={adding} onClick={addMapping}>
                    {t("source.mapAdd")}
                  </Button>
                </div>
              )}
            </>
          ) : null}
        </Box>
      ) : null}

      <Announce text={announced} />
    </div>
  );
}
```

- [ ] **Step 4: Run it, one group at a time**

```bash
npx vitest run src/live/screens/admin/SourceTab.test.jsx -t "the pure parts" 2>&1 | grep -E "Tests "
npx vitest run src/live/screens/admin/SourceTab.test.jsx -t "an unconfigured directory" 2>&1 | grep -E "Tests "
npx vitest run src/live/screens/admin/SourceTab.test.jsx -t "the status" 2>&1 | grep -E "Tests "
npx vitest run src/live/screens/admin/SourceTab.test.jsx -t "the search" 2>&1 | grep -E "Tests "
npx vitest run src/live/screens/admin/SourceTab.test.jsx -t "the import" 2>&1 | grep -E "Tests "
npx vitest run src/live/screens/admin/SourceTab.test.jsx -t "the group mapping" 2>&1 | grep -E "Tests "
npx vitest run src/live/screens/admin/SourceTab.test.jsx 2>&1 | grep -E "Tests "
```
Expected, in order:
```
Tests  4 passed | 33 skipped (37)
Tests  2 passed | 35 skipped (37)
Tests  6 passed | 31 skipped (37)
Tests  10 passed | 27 skipped (37)
Tests  8 passed | 29 skipped (37)
Tests  8 passed | 29 skipped (37)
Tests  37 passed (37)
```
(`-t` matches every test whose full name contains the phrase, so the lines overlap — "the search" also catches tests in the import and accessibility groups that name the search. The groups themselves hold 4 + 2 + 6 + 7 + 6 + 8, and `accessibility` 4: 37.)

**Eight things that will bite, all eight met while this was written.**

1. **Two buttons must not both be called "Search".** This panel has two searches — one over accounts, one over the directory's groups — and two identically-named buttons are two buttons a screen-reader user cannot tell apart. Hence `source.searchGroups` ("Qrupu axtar"). The test finds each by its own name; if it has to use `getAllByRole(...)[1]`, the strings are wrong, not the test.
2. **The status panel contains the word "şifrə".** In its own sentence saying the bind account and its password are in no response. The test therefore asserts no `CN=` / `DC=` / `ou=` **value** in that panel — in the status panel such a string could only be the service account's — and separately asserts the sentence is there. A word-based check fails on our own honesty.
3. **`mockResolvedValue` answers every chunk with the same body.** Three accounts are two chunks, so a mock returning two skipped rows yields **four** skipped rows — which is the screen correctly adding the chunks together, not a bug. The report test uses two accounts (one chunk); the failed-chunk test uses `mockResolvedValueOnce` then `mockRejectedValueOnce`.
4. **The extra-group `<select>` only exists once there are results.** Set it after the search, not before.
5. **`errors.directoryUnreachable` starts with "Xəstəxananın"**, so the host's own words are mid-sentence: assert `"kataloq serverinə"` in lower case, or the whole key.
6. **The test's result and the chunk's explanation are `Note`s (`role="note"`), not alerts.** Assert them through `queryAllByRole("note")`; the refusal itself is in the alert region, once.
7. **A `mockResolvedValueOnce` per chunk** when the answers must differ, and the mock queue is consumed by the read on mount: a mapping-table failure for the re-read after a write is `mockResolvedValueOnce([mapping()]).mockRejectedValueOnce(…)` set up in `open()`'s `setup`, because the first call has already happened by the time the test body runs.
8. **"No alert" is the alert regions' text being blank**, as in Task 7's fifth point: the error region exists before the first toast.

- [ ] **Step 5: Take this arm's two lines.** In `dashboard/src/live/screens/admin/AdminScreen.jsx`, replace

```jsx
// G1-14: import { SourceTab } from "./SourceTab.jsx";
```

with

```jsx
import { SourceTab } from "./SourceTab.jsx";
```

and replace

```jsx
  source: null, //   G1-14
```

with

```jsx
  source: SourceTab, //   G1-14
```

- [ ] **Step 6: Run the sweep, which now walks this tab too**

```bash
npx vitest run src/live/rawKeys.test.jsx 2>&1 | grep -E "Tests |→"
```
Expected: `Tests  5 passed (5)`. To see that the walk really reaches the **third** tab, change one `t("source.statusTitle")` to a key that does not exist and run it again: the report must name the tab —

```
admin (/admin) · Giriş mənbəyi → source.statusTitleTypo
```

— and the static net must name the file and all four languages. Put the key back.

- [ ] **Step 7: Look at it** — `npx vite dev`, `#/admin`, the login-source tab.

At **1440 px** and **390 px**, both themes:
- the host, the last test and the test button fit at 390 px without the page scrolling sideways;
- press the test against a deployment with no directory configured and confirm the tab shows only its status box and the "not configured" sentence — the search and the mapping must be **absent**, not present and failing;
- the search results table scrolls inside its frame; the four columns are reachable with `Tab` into the region;
- choose two accounts and import: the progress line appears, the chosen boxes clear chunk by chunk, and the two report lists are readable;
- the mapping table's DNs are long — confirm they wrap or scroll inside the frame rather than widening the page, and that the stale-DN sentence under each one is legible rather than a wall;
- the DN picker's `<select>` is usable with a thumb at 390 px (its options carry `name — dn`, which is long: check the native picker is still operable);
- nothing anywhere shows a bind DN or a password, in text or in a tooltip.

- [ ] **Step 8: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected, **on this arm's own branch**: `Test Files  104 passed (104)`, `Tests  2200 passed (2200)` (2163 + 37). On a branch where another arm has merged, add your own 37 to what you find.

- [ ] **Step 9: Commit**

```bash
git status --short
git add dashboard/src/live/screens/admin/SourceTab.jsx dashboard/src/live/screens/admin/SourceTab.test.jsx dashboard/src/live/screens/admin/AdminScreen.jsx
git commit -m "$(cat <<'EOF'
feat(dashboard): the login-source tab (G1-14)

Four sections, and the first decides whether the rest exist: status is the only
route that answers when the directory is off, so an unconfigured deployment
shows one sentence and no search -- a search box there would be offering a 409.
The status shows the HOST only; the bind account and its password are in no
response by design, and this screen puts neither in the DOM nor in a title.

The test's five refusals each say what to check, because "no" is not an answer
an administrator can act on. The import goes in chunks of two, strictly
sequentially -- the server's lookup lane is shared with every other request, so
two concurrent imports would 503 the administrator's own next search, and a
larger chunk would hit nginx's 60 s default before the server finished. A
failed chunk is named, its accounts stay chosen, and the chunks that landed
keep their answers. All seven skip reasons are translated and the two an
administrator can act on say what to do.

A DN comes from the picker, never typed: canonical_dn compares a canonical
spelling, and a typed DN whose Turkish letters differ in case from AD's fails
silently. A row stored before that canonicalisation cannot be told from a good
one here, so every row carries the offer to re-create it rather than a guess.

Every operation has its own in-flight state and the one live region names it;
a write that landed is never reported refused -- the mapping table's re-read is
a read, with its own failure and its own retry; and a refused connection test
clears the previous result rather than leaving a green "connected" beside it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** **37** tests in the new `SourceTab.test.jsx`; the suite green; build clean; looked at 390/1440 px in both themes, with an unconfigured directory tried.

---

# Wave 3B · closing (Tasks 12, 13) and the backend half (Task 14)

### Task 12: Merge the three arms and verify

**Files:** none changed, unless the verification finds something.

- [ ] **Step 1: Merge, in any order**

```bash
cd /c/tmp/w3b-impl
git checkout feat/w3b-yonetim
git merge --no-edit feat/w3b-users
git merge --no-edit feat/w3b-roles
git merge --no-edit feat/w3b-source
git status --short
```
Expected: three merges, **no conflict**, and an empty `git status --short`. Task 4 Step 8 proved this with throw-away branches doing exactly these six line edits; if a conflict appears here, a gap was tidied away — find the commit that did it before resolving anything by hand.

- [ ] **Step 2: The whole suite, and the counts**

```bash
cd dashboard
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  106 passed (106)`, `Tests  2268 passed (2268)` — **+8 files / +179 tests** on the base — build clean. (Task 14 then takes it to **2271**, +182.)

```bash
npx vitest run src/live/screens/admin/ 2>&1 | grep -E "✓ src|Tests "
```
Expected, each file by name (Vitest prints them in finishing order, so the order will differ):
```
✓ src/live/screens/admin/catalogue.test.js (9 tests)
✓ src/live/screens/admin/rules.test.js (34 tests)
✓ src/live/screens/admin/refusal.test.js (5 tests)
✓ src/live/screens/admin/admin.testutil.test.js (4 tests)
✓ src/live/screens/admin/AdminScreen.test.jsx (19 tests)
✓ src/live/screens/admin/RolesTab.test.jsx (32 tests)
✓ src/live/screens/admin/SourceTab.test.jsx (37 tests)
✓ src/live/screens/admin/UsersTab.test.jsx (36 tests)
      Tests  176 passed (176)
```
A file that is one or two out has lost or gained a test in the merge: compare its `it()` names against this plan before touching the number.

- [ ] **Step 3: The sweep walked three tabs, not one**

```bash
npx vitest run src/live/rawKeys.test.jsx 2>&1 | grep -E "Tests "
```
Expected: `Tests  5 passed (5)`. Then confirm it really walked three, by breaking each tab in turn: change one `t("admin.…")`, one `t("roles.…")` and one `t("source.…")` to a key that does not exist, one at a time, and check the failure names the tab —

```
admin (/admin) · İstifadəçilər → admin.<typo>
admin (/admin) · Rollar və səlahiyyətlər → roles.<typo>
admin (/admin) · Giriş mənbəyi → source.<typo>
```

— and that the static net names the file and all four languages. Put each key back. **Do not skip this**: the sweep passing proves nothing about tabs two and three unless you have seen it fail for them.

- [ ] **Step 4: Pin the registry empty and run again**, to prove no test has come to depend on which tabs are built:

```bash
npx vitest run src/live/shell/ src/live/LiveApp.test.jsx src/live/screens/admin/AdminScreen.test.jsx 2>&1 | grep -E "Tests "
```
Expected: green. `AdminScreen.test.jsx`'s own tests say which tabs their build has (`onlyTabs`), and the shell's say which screens theirs has (`onlyScreens`); a failure here is a test written against the build, which is the defect Task 4 Step 5 fixed three of.

- [ ] **Step 5: Look at the whole screen once more**, at 390 px and 1440 px in both themes, walking all three tabs with the arrow keys from the tab list. Check the three things only the merged screen can show:
- the tab list does not wrap into two rows that look like two lists at 390 px (it scrolls as a tab list — `ui/Tabs.jsx` has `overflow-x-auto`);
- moving between tabs does not change the page's scroll position in a way that hides the `h1`;
- a refusal earned on the users tab is still on screen after switching to the roles tab — that is the whole point of the toast (Decision 2), and it is the one behaviour no unit test observes across a tab change.

- [ ] **Step 6: Record what you saw**

Write the three tabs' actual on-screen strings for the five texts the pilot reading will need (Task 13 carries them into the G1-15 gate): `admin.sub`, `roles.note`, `source.notConfigured`, `source.skipInvalidLogin`, `source.mapPickHint`. These are the longest sentences in the wave and the ones most likely to need a native speaker's hand.

- [ ] **Step 7: Commit the merge** (if the merges produced merge commits, they are already committed; otherwise nothing to do). Then:

```bash
git log --oneline feat/canli-tasarim..feat/w3b-yonetim | cat
```
Expected: the thirteen task commits plus up to three merge commits.

**Gate:** `106 / 2268`, build clean, three tabs proved swept, the registry-pinned run green, and the screen looked at.

---

### Task 13: The documents

**Files:**
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, `docs/homunculus-rehber-TR.md`, `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md`, `docs/tasarim-prototipi-canli-sistem-notu.md`, `/c/tmp/homunculus-plans/amendments.md`, `/c/tmp/homunculus-plans/deferred.md`

It comes after the verification on purpose: a document written from a verification that has not happened is a document that records intentions.

- [ ] **Step 1: The roadmap.** Mark G1-12, G1-13 and G1-14 done, each with the task that met it, and write the two criteria that were **not** met with the reason:
- **G1-12 · `/scope/me` must decide as the board does** — **met, by Task 14.** `scope/router._view` now passes `enforce_unassigned` and the break-glass patients, as the board's own resolver does, and `tests/test_scope_me_agrees_with_board.py` holds the two sides to each other under all four scope reasons. The row must no longer point at Group 2: delete the deferral and name Task 14.
- **G1-12 · the scope "matrix"** — met as a list, with Decision 7's reason (no endpoint lists the units and beds a scope may name).

Add the two items the roadmap's "Dalga 3B'den açık kalanlar" still needs: **server-side pagination for `/admin/users`** before a second hospital, and **a bulk scope read** so the users tab's units column can be real. The other three that were on that list — `{granted, allowed_before, allowed_after}` on the unlock response, `kind` on `GroupOut`, and `/scope/unassigned` counting administrators — **are done in Task 14**, so they go in the "what this wave closed" column instead.

- [ ] **Step 2: The Turkish guide** (`docs/homunculus-rehber-TR.md`, the living document). Add a section for the administration screen: what each tab does, who may open it, and — in the register the rest of that guide uses — the three things an administrator will ask about and the answers are not obvious:
- a temporary password is typed by the administrator and shown nowhere afterwards;
- a permission change is saved per group and written to the audit trail, not applied on the click;
- the directory's host is configuration and is not editable in the screen.

- [ ] **Step 3: The LDAP/RBAC spec** (`docs/superpowers/specs/2026-09-23-ldap-rbac-design.md`). §3 and §7 gain the **as-built** notes this wave measured:
- `GET /admin/ldap/groups` and `/search` both **require** `q`, 2–64 characters trimmed; the cap is `RESULT_CAP = 50` and the caller cannot ask for fewer;
- `GET /admin/ldap/group-mappings` is behind `configured_ldap` too, so it answers 409 on an unconfigured deployment;
- `POST /admin/users/{id}/unlock-sign-in` answers `{"ok": true, "granted": …, "allowed_before": …, "allowed_after": …}` **as of Task 14**; it used to answer `{"ok": true}` alone, and the screen could then not tell "three more tries" from "there was nothing to clear" — and the number of tries is the server's difference, never the screen's;
- `GET /scope/unassigned` counts only members who WOULD need a grant **as of Task 14**: the tenant's system group and platform operators are left out;
- `PUT /scope/{user_id}` needs the caller's own scope to be unrestricted **by role**, which no permission key reports — and `unrestricted: true` with `reason: "unassigned"` is still refused;
- `GET /scope/me` and `GET /scope/{user_id}` decide as the board does **as of Task 14** (`enforce_unassigned`, break-glass), and `ScopeView` carries `own_patients` — a count, never an identifier; §3 gains `GroupSpec.kind` / `GroupOut.kind` with its null case, and a note that `PERMISSIONS`' descriptions are developer English which the dashboard translates by key.

- [ ] **Step 4: The design note** (`docs/tasarim-prototipi-canli-sistem-notu.md`). Items 11, 12, 13 and 14 gain one line each saying what the live screen does instead, and where. The three questions in "Sorumuz: üçü ürün müydü?" are unchanged — none of them is this surface's. **Two questions about this surface were added to that file in `91dbd05` and have already been sent to the designer** (the browser-generated plaintext password, and the "view as this role" switch — `## Needs the user`, 7): do not add them again, and do not re-ask them; add only the four "what the live screen does instead" lines.

- [ ] **Step 5: `amendments.md`** — a "From Wave 3B (as built)" section, for whoever builds on this:
- the administration foundation was **unmerged** until Wave 3B Task 1; Wave 3's Tasks 16–19 are where its code lives;
- `apiErrors.fieldRefusals(t, err)` is how a form puts a 422 under the control it is about, and `apiErrorKey` now looks a 422 item's own message up as a message;
- `refusedFor(t, subject, err)` / `doneFor(t, subject, text)` — every administration write's toast goes through them, and a success test asserts the confirmation text **and** blank alert regions (the toast's error region is mounted before the first toast);
- `rules.canAssignScope(myScope)` is three-valued, `canManageUser(...).unlockSignIn` allows oneself, and `groupFromApi(...).memberCount` is `null` for a count the API did not send — never `0`;
- the permission descriptions are `strings/perms.js`, keyed by permission key; `RolesTab.descriptionOf(t, row)` returns `{text, foreign}` and a foreign one is printed with `lang="en"`;
- `backendApi.userScope(id)`; `ldapSearch(query)` has no `limit`; `ldapGroups(query)` requires its `q`; `LDAP_SEARCH_CAP` / `LDAP_QUERY_MIN` / `LDAP_QUERY_MAX`;
- `onlyTabs()` is the tab registry's `onlyScreens`, and `stubTabs` only assigns;
- `rawKeys.test.jsx` walks every `role="tab"`, exempts the catalogue's own permission keys, and carries a static net asserting every `t("ns.key")` a live source names exists in four languages;
- `admin.testutil.js` is where a later wave's administration fixtures go; `group(slug, over)` and `user(id, over)` are positional and throw on the other shape;
- `UsersTab` renders `PAGE = 50` rows at a time and says so at `MANY = 200`;
- **from Task 14, the API's own contracts:** `GET /scope/me` and `GET /scope/{id}` pass
  `enforce_unassigned` and the break-glass patients to `build_scope`, so they agree with the board;
  `POST /admin/users/{id}/unlock-sign-in` answers `{ok, granted, allowed_before, allowed_after}`;
  `GET /scope/unassigned` leaves out members unrestricted by role; `ScopeView.own_patients` is a
  count; `GroupOut.kind`
  is `"role"` / `"extra"` / `null`, `auth/permissions.GROUP_KINDS` names the two, and
  `GroupSpec.kind` is checked at import. `rules.groupFromApi` prefers the API's `kind` and falls
  back to the mirror only when the field is ABSENT — `null` is an answer.

- [ ] **Step 6: `deferred.md`** — a "From Wave 3B, deliberately left" section:
- `GET /admin/users` is still unbounded; the tab is written not to depend on it silently, and the note is on screen;
- the units column cannot be filled without a bulk scope read;
- the two out-of-date server descriptions (`users.manage`, `devices.manage` in `auth/permissions.PERMISSIONS`) are still the server's words: the dashboard translates by key and shows them only as a fallback, so nothing on screen is wrong, but the text in the backend is;

- there is no test enforcing "no hex colour and no Tailwind palette colour in a live component" — the ground rule is reviewed, not asserted. It is the one systemic net this wave considered and did not build, and it would be about twenty lines beside the static key net in `rawKeys.test.jsx`.

- [ ] **Step 7: The G1-15 gate.** Add this wave's items to the deploy gate in the roadmap:
- an Azerbaijani-speaking administrator reads the five long sentences recorded in Task 12 Step 6 and confirms each is understood as written;
- the three tabs are opened on the VM's own data at 390 px, because the hospital's administrators use a tablet at the desk;
- the directory's connection test is run against the hospital's real controller and its answer recorded — the five reasons are the only part of this wave that cannot be exercised without it.

- [ ] **Step 8: Commit**

```bash
git status --short
git add docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/homunculus-rehber-TR.md docs/superpowers/specs/2026-09-23-ldap-rbac-design.md docs/tasarim-prototipi-canli-sistem-notu.md
git commit -m "$(cat <<'EOF'
docs: what Wave 3B built, what it found in the API, and what it left

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
`amendments.md` and `deferred.md` live outside the repository; they are edited in place and not committed.

**Gate:** the four documents updated, the two working notes updated, and the G1-15 gate carrying three new items.

---

### Task 14: The backend half — four places a screen could not tell the truth

**Files:**
- Modify: `homunculus-engine/src/homunculus/scope/router.py`, `homunculus-engine/src/homunculus/scope/schemas.py`, `homunculus-engine/src/homunculus/scope/service.py`, `homunculus-engine/src/homunculus/admin/router.py`, `homunculus-engine/src/homunculus/admin/schemas.py`, `homunculus-engine/src/homunculus/auth/permissions.py`
- Modify: `homunculus-engine/tests/test_admin_api.py`, `homunculus-engine/tests/test_admin_ldap_api.py`
- Create: `homunculus-engine/tests/test_scope_me_agrees_with_board.py`
- Modify (the dashboard's half, which the changes enable): `dashboard/src/live/screens/admin/rules.js` + `rules.test.js`, `catalogue.test.js`, `admin.testutil.js` + `admin.testutil.test.js`, `UsersTab.jsx` + `UsersTab.test.jsx`, `dashboard/src/live/i18n/strings/admin.js`

**Last, not first, and that is deliberate.** The three arms must not wait on Python, and a backend change is cleanest where the screens that read it already exist: each of the four ends with the dashboard edit it makes possible, and the screen assertions that move are listed at the end of this task so an arm is not surprised by them.

**The user decided the first three** (`## Needs the user` 1, 2 and 3, now closed); the fourth was found by the review of the first draft. All four are small, all four stop a screen from claiming something untrue, and the standing instruction is that everything is finished before anything reaches the hospital VM.

**The Python suite is in this task's gate** — it is the only task in this plan that touches a `.py` file. It is slow: about **12 minutes** per interpreter on an otherwise idle machine — run below in three thirds, because one foreground command may not run that long here — and **37 minutes** was measured for the same run with the dashboard suite and two builds competing for the CPU. Run it on **both** interpreters, because the production image is 3.12 and the development machine is 3.14 — and run nothing else while it runs: one of the engine's own tests (`test_infinity_vm_pilot.py`) spawns a PowerShell child under `subprocess.run(timeout=20)`, and under CPU contention the timeout fires, the child is killed, and the `communicate()` that follows never returns — a seven-hour hang was measured once, with a second suite running beside it. Alone, the test takes eight seconds.

```bash
# the test database this task uses, and nothing else
docker start homunculus-test-pg
docker exec homunculus-test-pg createdb -U homunculus homunculus_test_w3b
```
`createdb: error: database creation failed: ERROR:  database "homunculus_test_w3b" already exists` is fine — it means a previous run left it, and the suite drops every table itself. **Never export `DATABASE_URL`.** The suite reads `TEST_DATABASE_URL`, and `conftest.py` refuses a URL whose database name does not contain `test`.

**Every Python block below starts with the same four lines, on purpose.** Shell state does not survive from one Bash call to the next, and `requires_db` is a `skipif`, not a failure: a block run without `TEST_DATABASE_URL` does not fail — it silently **skips** every database test and reports green after a wait. If a block prints `skipped` where this plan says `passed`, that is what happened. `PYTHONPATH` is the other one a worker will otherwise chase: two tests spawn a subprocess (`sys.executable -O -c "from homunculus…"`), and a subprocess does not inherit pytest's own `pythonpath` setting, so without it they fail with `ModuleNotFoundError: No module named 'homunculus'` — a pre-existing environment fault, not a code fault.

```bash
cd /c/tmp/w3b-impl/homunculus-engine
export PY312=/c/tmp/f7-py312/venv/Scripts/python.exe            # the image's version, 3.12.13
export PY314=/c/tmp/w3b-py314/Scripts/python.exe                # the development version, 3.14.5
export PYTHONPATH="$PWD/src"
export TEST_DATABASE_URL="postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_w3b"
$PY312 -V && $PY314 -V
PY=$PY312
$PY -m pytest -q tests/rules tests/scoring tests/tenant tests/test_a*.py 2>&1 | tail -1
$PY -m pytest -q $(ls tests/test_[b-l]*.py | grep -v infinity_vm_pilot) 2>&1 | tail -1
$PY -m pytest -q tests/test_[m-z]*.py 2>&1 | tail -1
```
Expected: `Python 3.12.13`, `Python 3.14.5`, and — before any change — `988 passed`, `868 passed, 6 skipped`, `416 passed, 2 skipped`: **2272 passed, 8 skipped** (and `2 failed` more if `PYTHONPATH` was not set — those two).

**Why in thirds, and without one file.** The whole suite is about 12 minutes per interpreter, longer than one foreground command may run here; the first third alone is about 8½. And `tests/test_infinity_vm_pilot.py` is left out of every full run: it spawns a PowerShell child under `subprocess.run(timeout=20)`, and under CPU contention the timeout fires, the child is killed, and the `communicate()` that follows never returns — one full run hung for seven hours that way. It passes alone in eight seconds and this task does not touch it (recorded in `deferred.md` for Group 4). Its thirteen tests are therefore in no count below. `--ignore` does not work for it here — a file named on the command line is collected whatever `--ignore` says — which is why the second third filters the file list instead. The second third's `6 skipped` assumes the worktree's `dashboard/node_modules` junction exists: `test_infinity_transport.py` skips one test ("Node and dashboard jsdom required") without it, and that third then reads `867 passed, 7 skipped`.

If `$PY314` does not exist yet, it is two commands and it is worth it — from the **worktree**, never from the user's main checkout, whose own `.venv` is the same 3.14.5 but is not ours to import into (a Python that imports a package writes `__pycache__` beside it):

```bash
cd /c/tmp/w3b-impl/homunculus-engine
uv venv --python 3.14 /c/tmp/w3b-py314
uv pip install --python /c/tmp/w3b-py314/Scripts/python.exe -e ".[dev]"
```
The figures in this task were measured with a scratch venv built exactly that way.

**Run the two interpreters one after the other, never at the same time.** They share one database and `conftest.py` says what happens otherwise: the `db_session` fixture drops every table and the migration tests rebuild the schema, so two runs against one `TEST_DATABASE_URL` corrupt each other. Half an hour of waiting is the price of the second interpreter, and the second interpreter is the point — the image is 3.12.

---

#### 14a · `/scope/me` decides what the board decides

- [ ] **Step 1: Write the failing test.** Create `homunculus-engine/tests/test_scope_me_agrees_with_board.py`:

```python
"""`/scope/me` must decide what the BOARD decides, under every scope reason.

The route existed to answer the question a screen has to be able to ask — *why is my board this
size* — and it answered a different one. `scope/router._view` called `build_scope` with the
grants, the role and the own-patient list and **omitted both of the arguments the board's own
resolver passes** (`scope/resolver.make_scope_resolver`): `enforce_unassigned` and
`break_glass_patient_ids`. So on a deployment that had turned enforcement on, an unassigned
clinician was told "your scope is unrestricted" by this route while the board showed her nothing;
and a clinician holding an open break-glass session had its patient omitted here, which is the one
grant that is reason-bound and audited.

These tests are written as an AGREEMENT between the two, not as assertions about the route's
output: each one resolves the scope through the board's resolver and through HTTP and compares
them. That is the property that was broken, and a future change to either side that re-breaks it
fails here rather than in a hospital. Four reasons, one test each: `role`, `assigned`,
`unassigned` (both with enforcement and without) and `break_glass`.

Synthetic staff and one synthetic patient only.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admission.models import Patient
from homunculus.auth.groups import ensure_default_groups, set_manual_groups
from homunculus.auth.models import TenantMembership, User
from homunculus.auth.service import build_context, hash_password, issue_tokens
from homunculus.db import get_db
from homunculus.escalation.models import BreakGlassReason, BreakGlassSession
from homunculus.scope import service
from homunculus.scope.models import StaffScope  # noqa: F401  (staff_scopes, before create_all)
from homunculus.scope.resolver import break_glass_in_tenant
from homunculus.scope.rules import ScopeReason, build_scope
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db

pytestmark = [pytest.mark.asyncio, requires_db]


async def _make_user(db, tenant, groups, username, group_slug, **kw):
    user = User(username=username, email=f"{username}@example.com",
                full_name=username.title(), hashed_password=hash_password("Gizli-123"), **kw)
    db.add(user)
    await db.flush()
    db.add(TenantMembership(user_id=user.id, tenant_id=tenant.id))
    await db.flush()
    if group_slug:
        await set_manual_groups(db, user=user, tenant_id=tenant.id,
                               group_ids=[groups[group_slug].id], granted_by_id=None)
    return user


@pytest_asyncio.fixture
async def world(db_session):
    tenant = Tenant(name="Sentetik", slug="sentetik", country_code="AZ")
    db_session.add(tenant)
    await db_session.flush()
    groups = await ensure_default_groups(db_session, tenant.id)
    out = {
        "tenant": tenant, "groups": groups,
        "admin": await _make_user(db_session, tenant, groups, "mudur", "hospital_admin"),
        "nurse": await _make_user(db_session, tenant, groups, "aygun", "nurse"),
    }
    await db_session.commit()
    return out


@pytest_asyncio.fixture
async def client(db_session):
    from homunculus.api.app import create_app

    app = create_app({"bridge-token": "sentetik"}, run_escalation_loop=False)
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.app = app
        yield c


async def _headers(db, user):
    tokens = issue_tokens(user, await build_context(db, user), mfa_verified=True)
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def _as_the_board_sees_it(db, user, tenant, *, enforce_unassigned):
    """The scope the BOARD's resolver would build for this user, from the same four reads plus the
    two arguments the route used to omit (`scope/resolver.make_scope_resolver`)."""
    grants = await service.read_grants(db, user.id, tenant.id)
    return build_scope(
        await service.read_role(db, user.id, tenant.id),
        unit_ids=[g.unit_id for g in grants if g.unit_id],
        bed_ids=[g.bed_id for g in grants if g.bed_id],
        own_patient_ids=await service.read_own_patient_ids(db, user.id, tenant.id),
        break_glass_patient_ids=await break_glass_in_tenant(db, user.id, tenant.id),
        enforce_unassigned=enforce_unassigned,
    )


def _agree(answer: dict, scope) -> None:
    """Every field of the route's answer against the board's own scope.

    `ScopeView` carries no patient IDENTIFIER (the router's PHI rule), so the own-patient half of
    the agreement is a COUNT — `own_patients`, the figure `Scope.as_dict()` publishes on the
    board's own `scope` block. It is what makes the break-glass case checkable at all: without
    it, "the route passes the break-glass patients to `build_scope`" was a claim the test could
    not see past `reason`.
    """
    assert answer["unrestricted"] is scope.unrestricted, answer
    assert answer["reason"] == scope.reason, answer
    assert sorted(answer["unit_ids"]) == sorted(scope.unit_ids), answer
    assert sorted(answer["bed_ids"]) == sorted(scope.bed_ids), answer
    assert answer["own_patients"] == len(scope.own_patient_ids), answer


async def _me(client, db, user) -> dict:
    res = await client.get("/scope/me", headers=await _headers(db, user))
    assert res.status_code == 200, res.text
    return res.json()


# ---------------------------------------------------------------- the four reasons

async def test_an_administrator_is_unrestricted_by_role_and_both_say_so(db_session, world, client):
    answer = await _me(client, db_session, world["admin"])
    assert answer["reason"] == ScopeReason.UNRESTRICTED_ROLE
    _agree(answer, await _as_the_board_sees_it(
        db_session, world["admin"], world["tenant"], enforce_unassigned=False))


async def test_an_assigned_nurse_agrees_with_the_board(db_session, world, client):
    await service.replace_grants(db_session, tenant_id=world["tenant"].id,
                                 user_id=world["nurse"].id,
                                 grants=[("REA-01", ""), ("", "REA-01-2")], granted_by_id=None)
    await db_session.commit()
    answer = await _me(client, db_session, world["nurse"])
    assert answer["reason"] == ScopeReason.ASSIGNED
    assert answer["unrestricted"] is False
    _agree(answer, await _as_the_board_sees_it(
        db_session, world["nurse"], world["tenant"], enforce_unassigned=False))


async def test_an_unassigned_nurse_agrees_with_the_board_while_enforcement_is_off(
        db_session, world, client, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    answer = await _me(client, db_session, world["nurse"])
    # Unassigned stays unrestricted until a deployment decides otherwise — and the route says
    # WHY, which is the whole reason it reports a reason at all.
    assert (answer["unrestricted"], answer["reason"]) == (True, ScopeReason.UNASSIGNED)
    _agree(answer, await _as_the_board_sees_it(
        db_session, world["nurse"], world["tenant"], enforce_unassigned=False))


async def test_an_unassigned_nurse_agrees_with_the_board_once_enforcement_is_on(
        db_session, world, client, monkeypatch):
    # THE DEFECT. Before the fix this route answered `unrestricted: true` here — "you see
    # everything" — while the board showed this nurse nothing at all.
    monkeypatch.setenv("SCOPE_ENFORCE_UNASSIGNED", "1")
    answer = await _me(client, db_session, world["nurse"])
    assert (answer["unrestricted"], answer["reason"]) == (False, ScopeReason.UNASSIGNED)
    _agree(answer, await _as_the_board_sees_it(
        db_session, world["nurse"], world["tenant"], enforce_unassigned=True))


async def test_break_glass_is_the_reason_and_both_say_so(db_session, world, client, monkeypatch):
    # An otherwise unassigned clinician who broke glass: the emergency is the only reason she can
    # see anything, and the route used to omit it entirely.
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    patient = Patient(tenant_id=world["tenant"].id, display_name="Ayşe Sentetik",
                      date_of_birth="1980-01-01", sex="F", his_patient_reference="S-001")
    db_session.add(patient)
    await db_session.flush()
    db_session.add(BreakGlassSession(
        tenant_id=world["tenant"].id, user_id=world["nurse"].id, patient_id=patient.id,
        reason=BreakGlassReason.CARDIAC_ARREST,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    ))
    await db_session.commit()

    answer = await _me(client, db_session, world["nurse"])
    assert (answer["unrestricted"], answer["reason"]) == (False, ScopeReason.BREAK_GLASS)
    assert answer["own_patients"] == 1            # the one patient the session names, as a count
    assert "S-001" not in json.dumps(answer)      # and never as an identifier
    _agree(answer, await _as_the_board_sees_it(
        db_session, world["nurse"], world["tenant"], enforce_unassigned=False))


async def test_a_closed_break_glass_session_grants_nothing_here_either(
        db_session, world, client, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    patient = Patient(tenant_id=world["tenant"].id, display_name="Kamran Sintetik",
                      date_of_birth="1975-05-05", sex="M", his_patient_reference="S-002")
    db_session.add(patient)
    await db_session.flush()
    db_session.add(BreakGlassSession(
        tenant_id=world["tenant"].id, user_id=world["nurse"].id, patient_id=patient.id,
        reason=BreakGlassReason.RAPID_DETERIORATION,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
        closed_at=datetime.now(timezone.utc),
    ))
    await db_session.commit()
    answer = await _me(client, db_session, world["nurse"])
    # Back to plain "unassigned": the 30-minute box is the point of break-glass.
    assert answer["reason"] == ScopeReason.UNASSIGNED
    assert answer["own_patients"] == 0
    _agree(answer, await _as_the_board_sees_it(
        db_session, world["nurse"], world["tenant"], enforce_unassigned=False))


# ---------------------------------------------------------------- the administrator's counter

async def test_the_unassigned_count_leaves_out_those_who_need_no_grant(db_session, world, client):
    """`GET /scope/unassigned` is the number that says whether the scope table has ever been
    filled in. It used to count the administrator — unrestricted by role, needing no grant — so
    on a pilot with one administrator it read "1" forever: a permanent "there is work here" about
    a person for whom there is none. Only members who WOULD need a grant are counted."""
    headers = await _headers(db_session, world["admin"])
    res = await client.get("/scope/unassigned", headers=headers)
    assert res.status_code == 200, res.text
    assert res.json()["unassigned_users"] == 1          # the nurse; not the administrator

    await service.replace_grants(db_session, tenant_id=world["tenant"].id,
                                 user_id=world["nurse"].id,
                                 grants=[("REA-01", "")], granted_by_id=None)
    await db_session.commit()
    res = await client.get("/scope/unassigned", headers=headers)
    assert res.json()["unassigned_users"] == 0          # and now the table is filled in


# ---------------------------------------------------------------- the administrator's own view

async def test_the_administrator_route_decides_the_same_way(db_session, world, client, monkeypatch):
    """`GET /scope/{user_id}` shares `_view`, so it gains the same correction.

    This is what the administration screen's scope editor reads, and it is the one that would have
    told an administrator "this nurse's scope is unrestricted — nothing to assign here" about a
    nurse whose board was empty.
    """
    monkeypatch.setenv("SCOPE_ENFORCE_UNASSIGNED", "1")
    res = await client.get(f"/scope/{world['nurse'].id}",
                           headers=await _headers(db_session, world["admin"]))
    assert res.status_code == 200, res.text
    assert (res.json()["unrestricted"], res.json()["reason"]) == (False, ScopeReason.UNASSIGNED)
    _agree(res.json(), await _as_the_board_sees_it(
        db_session, world["nurse"], world["tenant"], enforce_unassigned=True))


async def test_an_unknown_user_is_still_not_found(db_session, world, client):
    res = await client.get(f"/scope/{uuid.uuid4()}",
                           headers=await _headers(db_session, world["admin"]))
    assert res.status_code == 404, res.text
```

- [ ] **Step 2: Run it and watch it fail — on a field that does not exist yet**

```bash
cd /c/tmp/w3b-impl/homunculus-engine
export PY312=/c/tmp/f7-py312/venv/Scripts/python.exe
export PYTHONPATH="$PWD/src"
export TEST_DATABASE_URL="postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_w3b"
$PY312 -m pytest -q tests/test_scope_me_agrees_with_board.py 2>&1 | grep -E "^FAILED|KeyError|passed|failed"
```
Expected: `8 failed, 1 passed` — four of the eight on `KeyError: 'own_patients'` (`ScopeView` carries no such field, so the agreement **cannot even be compared** — the route had no way to show whether a break-glass patient was in the scope at all, which is half of the defect), three on the defect itself (`assert (True, 'unassigned') == (False, 'unassigned')` twice and `== (False, 'break_glass')` once), and one on the administrator's counter (`assert 2 == 1` — 14d, held by this same file). The one that passes is the unknown user's 404. **Confirm you saw failures**: a version of this step that showed everything passing was an edit that had not landed — the file is CRLF and a `python`-scripted replacement against an `\n` pattern matches nothing and reports nothing (the Ground rules' own warning, met again here).

- [ ] **Step 3: Give the view the one field the agreement needs — a count, never an identifier.** In `homunculus-engine/src/homunculus/scope/schemas.py`, replace

```python
    bed_ids: list[str]
    grants: list[ScopeGrantOut]
```

with

```python
    bed_ids: list[str]
    grants: list[ScopeGrantOut]
    # How many patients this scope reaches by NAME rather than by unit or bed — the care-team
    # patients plus any open break-glass session's. A COUNT, not the ids: this route carries no
    # patient identifier (PHI rule in the router's docstring), and the count is what lets a reader
    # of `/scope/me` — and the test that holds it to the board — see that a break-glass grant is
    # in the scope at all. The same figure `Scope.as_dict()` publishes on the board's own `scope`.
    own_patients: int = 0
```

In `homunculus-engine/src/homunculus/scope/router.py`, replace

```python
        grants=[ScopeGrantOut.model_validate(g) for g in grants],
    )
```

with

```python
        grants=[ScopeGrantOut.model_validate(g) for g in grants],
        own_patients=len(scope.own_patient_ids),
    )
```

- [ ] **Step 4: Now the defect itself is visible**

```bash
cd /c/tmp/w3b-impl/homunculus-engine
export PY312=/c/tmp/f7-py312/venv/Scripts/python.exe
export PYTHONPATH="$PWD/src"
export TEST_DATABASE_URL="postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_w3b"
$PY312 -m pytest -q tests/test_scope_me_agrees_with_board.py 2>&1 | grep -E "^FAILED|^[0-9]+ (passed|failed)"
```
Expected:
```
FAILED tests/test_scope_me_agrees_with_board.py::test_an_unassigned_nurse_agrees_with_the_board_once_enforcement_is_on
FAILED tests/test_scope_me_agrees_with_board.py::test_break_glass_is_the_reason_and_both_say_so
FAILED tests/test_scope_me_agrees_with_board.py::test_the_unassigned_count_leaves_out_those_who_need_no_grant
FAILED tests/test_scope_me_agrees_with_board.py::test_the_administrator_route_decides_the_same_way
4 failed, 5 passed
```
Those are the route's two missing arguments (the unassigned-with-enforcement case, the break-glass case, and the administrator's route which shares `_view`) plus 14d's counter; the five that pass are the cases the defect never touched.

- [ ] **Step 5: Fix it.** In `homunculus-engine/src/homunculus/scope/router.py`, replace

```python
from homunculus.scope import service
from homunculus.scope.rules import SCOPE_UNRESTRICTED_ROLES, build_scope
```

with

```python
from homunculus.scope import service
from homunculus.scope.resolver import break_glass_in_tenant, enforce_unassigned_default
from homunculus.scope.rules import SCOPE_UNRESTRICTED_ROLES, build_scope
```

and replace

```python
async def _view(db: AsyncSession, user_id: uuid.UUID, tenant_id: uuid.UUID) -> ScopeView:
    grants = await service.read_grants(db, user_id, tenant_id)
    role = await service.read_role(db, user_id, tenant_id)
    own = await service.read_own_patient_ids(db, user_id, tenant_id)
    scope = build_scope(
        role,
        unit_ids=[g.unit_id for g in grants if g.unit_id],
        bed_ids=[g.bed_id for g in grants if g.bed_id],
        own_patient_ids=own,
    )
```

with

```python
async def _view(db: AsyncSession, user_id: uuid.UUID, tenant_id: uuid.UUID) -> ScopeView:
    """What this user's scope resolves to — decided the way the BOARD decides it.

    Both of the arguments below used to be missing, and that made this route answer a different
    question from the one every caller thinks it answers. The board's own resolver
    (`scope/resolver.make_scope_resolver`) passes `break_glass_patient_ids` and
    `enforce_unassigned`; this route passed neither, so:

      * with `SCOPE_ENFORCE_UNASSIGNED` on, a user with no assignment resolved here as
        `unrestricted: true, reason: "unassigned"` — "you see everything" — while the board showed
        that user nothing. A screen reading this route would have told an administrator the
        opposite of what the clinician was looking at, on exactly the configuration a hospital
        turns on when it starts restricting access;
      * a clinician holding an open break-glass session had its patients omitted here, so the one
        thing that is reason-bound and audited was invisible to the route that exists to explain
        why a board is the size it is.

    Nothing else about the route changes: the same four reads, the same `ScopeView`. Both
    arguments are read from the same places the board reads them, so there is one answer to
    "what may this user see" and not two.
    """
    grants = await service.read_grants(db, user_id, tenant_id)
    role = await service.read_role(db, user_id, tenant_id)
    own = await service.read_own_patient_ids(db, user_id, tenant_id)
    emergency = await break_glass_in_tenant(db, user_id, tenant_id)
    scope = build_scope(
        role,
        unit_ids=[g.unit_id for g in grants if g.unit_id],
        bed_ids=[g.bed_id for g in grants if g.bed_id],
        own_patient_ids=own,
        break_glass_patient_ids=emergency,
        enforce_unassigned=enforce_unassigned_default(),
    )
```

- [ ] **Step 6: Run it**

```bash
cd /c/tmp/w3b-impl/homunculus-engine
export PY312=/c/tmp/f7-py312/venv/Scripts/python.exe
export PYTHONPATH="$PWD/src"
export TEST_DATABASE_URL="postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_w3b"
$PY312 -m pytest -q tests/test_scope_me_agrees_with_board.py 2>&1 | grep -E "^FAILED|^[0-9]+ (passed|failed)"
```
Expected: `1 failed, 8 passed` — the one left is the administrator's counter, which 14d fixes.

**No dashboard change follows from 14a, and that is the point.** `canAssignScope` already answers `false` for `reason: "unassigned"` whether or not the flag is on (Decision 8), so the scope editor's Save behaves identically. What changes is what the editor's *unrestricted* branch is shown for: with enforcement on, an unassigned user now arrives as `unrestricted: false, reason: "unassigned"` and gets the editing UI instead of "this user's scope is unrestricted: no assignment yet" — which is the correct screen and is why the fix matters. `admin.scopeReasonUnassigned` stays reachable (enforcement off is the pilot's state) and `admin.testutil.js`'s `SCOPE_UNASSIGNED` is still a payload the server can send, so no fixture and no assertion moves. (`scopeView()` in the fixtures does not carry `own_patients`, and `scopeFromApi` does not read it: the editor shows grants, and a count of named patients is the board's business.)

**Four reasons, not five.** `ScopeReason` has a fifth value, `tenant_token`, for a device or bridge token that carries a tenant and no user; `/scope/me` and `/scope/{id}` are user routes behind `get_current_user`, so no request to them can resolve to it, and the agreement does not test a case that cannot occur.

---

#### 14b · the sign-in unlock says what it actually did

- [ ] **Step 7: Write the failing tests.** In `homunculus-engine/tests/test_admin_ldap_api.py`, replace

```python
    res = await _unlock(c, ayse_id, admin)
    assert (res.status_code, res.json()) == (200, {"ok": True})
```

with

```python
    res = await _unlock(c, ayse_id, admin)
    # `granted` and `allowed_after` are in the ANSWER, not only in the audit row. Without them a
    # screen can say no more than "the request was sent": an unlock with nothing to clear grants
    # nothing and answers 200 just the same, and the administration screen said "the throttle was
    # lifted" for both. A screen must not claim more than the server told it.
    assert (res.status_code, res.json()) == (
        200, {"ok": True, "granted": True, "allowed_before": 3, "allowed_after": 6})
```

and replace

```python
async def test_a_second_unlock_in_the_same_chain_is_refused(client, world, db_session):
```

with

```python
async def test_an_unlock_with_nothing_to_clear_says_it_granted_nothing(client, world, db_session):
    """The third outcome, and the one no screen could see before.

    An account with no failed bind in the current chain — or a LOCAL account, which has no bind
    chain at all — is not a refusal: the unlock is allowed, it is audited, and it grants nothing,
    because there was nothing to let through. It answers 200 exactly as a real unlock does, so
    `granted` is the only thing that tells the two apart, and the administration screen says which
    of them happened instead of claiming the throttle was lifted.
    """
    c, app = client
    admin = await bearer(db_session, world["admin"])
    res = await _unlock(c, world["account"].id, admin)      # never throttled
    assert res.status_code == 200, res.text
    assert res.json()["granted"] is False
    assert res.json()["allowed_before"] == res.json()["allowed_after"] == 3   # nothing let through
    [event] = audit_events(app, "admin", "user.sign_in_unlocked")
    assert event.payload["granted"] is False
    assert event.payload["reason"] == REASON                # audited whatever it granted


async def test_a_second_unlock_in_the_same_chain_is_refused(client, world, db_session):
```

```bash
cd /c/tmp/w3b-impl/homunculus-engine
export PY312=/c/tmp/f7-py312/venv/Scripts/python.exe
export PYTHONPATH="$PWD/src"
export TEST_DATABASE_URL="postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_w3b"
$PY312 -m pytest -q tests/test_admin_ldap_api.py -k unlock 2>&1 | grep -E "^FAILED|^[0-9]+ (passed|failed)"
```
Expected: `2 failed, 30 passed, 59 deselected` — `test_an_administrator_unlocks_a_throttled_ad_account` on `{"ok": True}` not matching, and `test_an_unlock_with_nothing_to_clear_says_it_granted_nothing` on `KeyError: 'granted'`.

- [ ] **Step 8: Fix it.** In `homunculus-engine/src/homunculus/admin/router.py`, replace

```python
           extra={"granted": unlocked.granted}, reason=body.reason)
    return {"ok": True}
```

with

```python
           extra={"granted": unlocked.granted}, reason=body.reason)
    # `granted` and `allowed_after` are in the ANSWER as well as in the audit row. They used not
    # to be, and the administration screen could then only say "the throttle was lifted once" for
    # a call that may have lifted nothing — an account with no failed bind in the current chain,
    # or a local account, grants nothing and the screen stated otherwise. The 409 case
    # (UNLOCK_COOLDOWN, the chain's one unlock already used) was always distinguishable; these
    # two were not. A screen must not claim more than the server told it — which is also why
    # `allowed_before` is here: the number of attempts an unlock let through is their difference,
    # and a screen that printed "three more" from its own knowledge of the chain would be stating a
    # figure it cannot verify, in the sentence that exists to stop exactly that.
    return {"ok": True, "granted": unlocked.granted,
            "allowed_before": unlocked.allowed_before, "allowed_after": unlocked.allowed_after}
```

```bash
cd /c/tmp/w3b-impl/homunculus-engine
export PY312=/c/tmp/f7-py312/venv/Scripts/python.exe
export PYTHONPATH="$PWD/src"
export TEST_DATABASE_URL="postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_w3b"
$PY312 -m pytest -q tests/test_admin_ldap_api.py -k unlock 2>&1 | grep -E "^[0-9]+ (passed|failed)"
```
Expected: `32 passed, 59 deselected`.

- [ ] **Step 9: Let the screen say it — with the server's own number.** Two strings, then three edits.

In `dashboard/src/live/i18n/strings/admin.js`, replace

```javascript
    unlocked: "Dizin girişi bir kez açıldı.",
```

with

```javascript
    unlocked: "Dizin girişi bir kez açıldı: {count} deneme daha.",
    unlockedNothing: "Bu hesapta açılacak bir sınır yoktu; hiçbir şey değişmedi. Giriş yine de denenebilir.",
```

replace

```javascript
    unlocked: "Kataloq girişi bir dəfə açıldı.",
```

with

```javascript
    unlocked: "Kataloq girişi bir dəfə açıldı: {count} cəhd daha.",
    unlockedNothing: "Bu hesabda açılacaq hədd yox idi; heç nə dəyişmədi. Giriş yenə də cəhd edilə bilər.",
```

replace

```javascript
    unlocked: "Вход через каталог открыт один раз.",
```

with

```javascript
    unlocked: "Вход через каталог открыт один раз: ещё попыток: {count}.",
    unlockedNothing: "У этой записи не было ограничения, которое можно открыть; ничего не изменилось. Войти всё равно можно.",
```

and replace

```javascript
    unlocked: "The directory sign-in was opened once.",
```

with

```javascript
    unlocked: "The directory sign-in was opened once: {count} more attempts.",
    unlockedNothing: "This account had no throttle to lift; nothing changed. Signing in can still be tried.",
```

In `dashboard/src/live/screens/admin/UsersTab.jsx`, replace

```jsx
  const write = useCallback(async (user, run, doneText) => {
    if (busyId) return false;
    setBusyId(user.id);
    try {
      await store.track(run);
      toast(doneFor(t, user.fullName || user.username, doneText));
      await admin.reload();
      return true;
    } catch (err) {
```

with

```jsx
  const write = useCallback(async (user, run, doneText) => {
    if (busyId) return false;
    setBusyId(user.id);
    try {
      const answer = await store.track(run);
      // `doneText` may be a function of the server's ANSWER rather than a fixed sentence. The
      // unlock is the one that needs it: `POST /unlock-sign-in` answers 200 whether it let three
      // more binds through or found nothing to clear, and the two are a different thing to tell
      // an administrator. A fixed sentence claimed the first for both.
      toast(doneFor(t, user.fullName || user.username,
                    typeof doneText === "function" ? doneText(answer) : doneText));
      await admin.reload();
      return true;
    } catch (err) {
```

replace

```jsx
          onConfirm={async (reason) => {
            const done = await write(open.user, CONFIRMATIONS[open.kind].run(api, open.user, reason),
              t(CONFIRMATIONS[open.kind].done));
            if (done) setOpen(null);
          }}
```

with

```jsx
          onConfirm={async (reason) => {
            const spec = CONFIRMATIONS[open.kind];
            // `done` is a key, or a function of the server's answer — `{key, vars}` — when the
            // server can answer more than one thing (the unlock).
            const said = typeof spec.done === "function"
              ? (answer) => { const { key, vars } = spec.done(answer); return t(key, vars); }
              : t(spec.done);
            const done = await write(open.user, spec.run(api, open.user, reason), said);
            if (done) setOpen(null);
          }}
```

and replace

```jsx
  unlock: {
    title: "admin.unlockSignIn", body: "admin.confirmUnlock", done: "admin.unlocked",
    reason: true,
    run: (api, user, reason) => () => api.adminUnlockSignIn(user.id, reason),
  },
```

with

```jsx
  unlock: {
    title: "admin.unlockSignIn", body: "admin.confirmUnlock",
    // The only confirmation whose sentence depends on the ANSWER. `POST /unlock-sign-in` answers
    // 200 both when it lets three more binds through and when it finds nothing to clear — an
    // account with no failed bind in the current chain, or a local account — and `granted` is
    // what tells them apart. A fixed "the throttle was lifted" claimed the first for both, which
    // is the one place in this surface a screen said more than the server had told it. And the
    // NUMBER of attempts let through is the server's too — `allowed_after - allowed_before` —
    // never a "three" the screen knows from reading the chain's source: a figure the screen cannot
    // verify in the sentence that exists to stop over-claiming would be the same fault again.
    // `granted` missing, or the two numbers missing, reads as the cautious sentence.
    done: (answer) => {
      const before = answer?.allowed_before;
      const after = answer?.allowed_after;
      if (answer?.granted === true && Number.isFinite(before) && Number.isFinite(after) && after > before) {
        return { key: "admin.unlocked", vars: { count: after - before } };
      }
      return { key: "admin.unlockedNothing", vars: {} };
    },
    reason: true,
    run: (api, user, reason) => () => api.adminUnlockSignIn(user.id, reason),
  },
```

The count is `allowed_after - allowed_before`, the server's two numbers, and nothing else: the first draft printed "three more attempts" from reading the chain's source, which is a figure the screen cannot verify in the one sentence that exists to stop over-claiming. A server that reports `granted` without the two numbers gets the cautious sentence.

- [ ] **Step 10: Test the screen.** In `dashboard/src/live/screens/admin/UsersTab.test.jsx`, replace

```jsx
  it("the unlock asks for a reason, refuses an empty one before sending, and says it is audited", async () => {
    const { api } = await open();
    api.adminUnlockSignIn.mockResolvedValue({ ok: true });
```

with

```jsx
  it("the unlock says what the server actually did, with the server's own number", async () => {
    // POST /unlock-sign-in answers 200 whether it let more binds through or found nothing to
    // clear; `granted` tells the two apart and `allowed_after - allowed_before` is how many it let
    // through. The screen used to claim "three more" for both — the one place in this surface it
    // said more than it was told.
    const { api } = await open();
    api.adminUnlockSignIn.mockResolvedValue({ ok: true, granted: true, allowed_before: 3, allowed_after: 6 });
    await press(/Girişi aç: dr\.kamran/);
    fireEvent.change(screen.getByLabelText(/Səbəb/), { target: { value: "telefonla doğrulandı" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Girişi aç" })); await settle(); });
    expectConfirmed(/Kamran Sintetik · Kataloq girişi bir dəfə açıldı: 3 cəhd daha\./);

    cleanup();
    const second = await open();
    second.api.adminUnlockSignIn.mockResolvedValue({ ok: true, granted: false, allowed_before: 3, allowed_after: 3 });
    await press(/Girişi aç: dr\.kamran/);
    fireEvent.change(screen.getByLabelText(/Səbəb/), { target: { value: "telefonla doğrulandı" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Girişi aç" })); await settle(); });
    expectConfirmed(/açılacaq hədd yox idi; heç nə dəyişmədi/);

    cleanup();
    // A server that reports `granted` without the numbers gets the cautious sentence: a count the
    // screen cannot verify is the over-claim this sentence exists to remove.
    const third = await open();
    third.api.adminUnlockSignIn.mockResolvedValue({ ok: true, granted: true });
    await press(/Girişi aç: dr\.kamran/);
    fireEvent.change(screen.getByLabelText(/Səbəb/), { target: { value: "telefonla doğrulandı" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Girişi aç" })); await settle(); });
    expectConfirmed(/açılacaq hədd yox idi; heç nə dəyişmədi/);
  });

  it("the unlock asks for a reason, refuses an empty one before sending, and says it is audited", async () => {
    const { api } = await open();
    api.adminUnlockSignIn.mockResolvedValue({ ok: true, granted: true, allowed_before: 3, allowed_after: 6 });
```

```bash
cd /c/tmp/w3b-impl/dashboard
npx vitest run src/live/screens/admin/UsersTab.test.jsx src/live/i18n/strings.test.js 2>&1 | grep -E "Tests "
```
Expected: `Tests  43 passed (43)` — `UsersTab` **37**, one more than Task 7 left, and `strings` still 6: both new texts differ in all four languages and carry Cyrillic in Russian, so neither needs a parity entry.

---

#### 14c · `kind` lives where the groups do

- [ ] **Step 11: Write the failing test.** In `homunculus-engine/tests/test_admin_api.py`, replace

```python
from homunculus.auth.permissions import ALL_PERMISSIONS
```

with

```python
from homunculus.auth.permissions import ALL_PERMISSIONS, DEFAULT_GROUPS, GROUP_KINDS
```

and replace

```python
async def test_the_system_group_reports_the_whole_catalogue_whatever_its_rows(client, world,
                                                                            db_session):
```

with

```python
async def test_a_group_says_what_kind_it_is_and_a_hospitals_own_says_nothing(client, world,
                                                                            db_session):
    """`kind` is what a group IS to a person, not what it grants (`GroupSpec.kind`).

    The administration screen's user form offers ONE role plus any number of extra duties (roadmap
    D3), and the membership table is a single flat list that says nothing about which a group is —
    so the dashboard classified these eleven slugs itself, two files away from the groups it was
    classifying. It is reported here now. A group a HOSPITAL creates is neither and `kind` is
    null: not a gap, an answer, because guessing it from a slug or a permission set is how a screen
    tells an administrator something nobody decided.
    """
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    groups = {g["slug"]: g for g in (await c.get("/admin/groups", headers=admin)).json()}
    assert groups["charge_nurse"]["kind"] == "extra"      # a nurse with more, for a while
    assert groups["rapid_response"]["kind"] == "extra"    # a duty that ends with the shift
    assert groups["nurse"]["kind"] == "role"
    assert groups["hospital_admin"]["kind"] == "role"
    # Every default group is one or the other, and only those two kinds exist.
    assert {g["kind"] for g in groups.values()} <= GROUP_KINDS
    assert all(groups[spec["slug"]]["kind"] == spec["kind"] for spec in DEFAULT_GROUPS)

    made_here = await c.post("/admin/groups", headers=admin, json={
        "slug": "gece_ekibi", "name": "Gece ekibi", "description": "",
        "mfa_required": False, "permissions": ["board.view"]})
    assert made_here.status_code == 201, made_here.text
    assert made_here.json()["kind"] is None
    listed = {g["slug"]: g for g in (await c.get("/admin/groups", headers=admin)).json()}
    assert listed["gece_ekibi"]["kind"] is None


async def test_the_system_group_reports_the_whole_catalogue_whatever_its_rows(client, world,
                                                                            db_session):
```

```bash
cd /c/tmp/w3b-impl/homunculus-engine
export PY312=/c/tmp/f7-py312/venv/Scripts/python.exe
export PYTHONPATH="$PWD/src"
export TEST_DATABASE_URL="postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_w3b"
$PY312 -m pytest -q tests/test_admin_api.py -k kind 2>&1 | grep -E "ImportError|^FAILED|^[0-9]+ (passed|failed)|Interrupted"
```
Expected: a collection error, before any test runs —
```
ImportError while importing test module '…\tests\test_admin_api.py'.
E   ImportError: cannot import name 'GROUP_KINDS' from 'homunculus.auth.permissions' (…\src\homunculus\auth\permissions.py)
!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
```
If instead you see `NameError: name 'GROUP_KINDS' is not defined`, Step 12 is half-applied — the self-check references the constant and the constant is not there.

- [ ] **Step 12: Add the field.** In `homunculus-engine/src/homunculus/auth/permissions.py`, replace

```python
class GroupSpec(TypedDict):
    slug: str
    name: str
    description: str
    mfa_required: bool
    is_system: bool
    permissions: tuple[str, ...]
```

with

```python
class GroupSpec(TypedDict):
    slug: str
    name: str
    description: str
    mfa_required: bool
    is_system: bool
    permissions: tuple[str, ...]
    # What this group IS to a person, as opposed to what it grants: a ROLE is the job someone
    # does, an EXTRA duty is added to a role for a while. A charge nurse is a nurse with more; a
    # rapid-response duty ends with the shift. The membership table is one flat list and says
    # nothing about this, so the administration screen's user form — one role, any number of
    # duties (roadmap D3) — had to classify these eleven slugs itself, two files away from the
    # groups it was classifying. It lives here now, and `GroupOut.kind` carries it.
    #
    # A group a HOSPITAL creates is neither, and `GroupOut.kind` is then null: it is not a job
    # this product knows about and not a duty either, and guessing from its slug or its
    # permission set is how a screen comes to tell an administrator something nobody decided.
    kind: str
```

replace

```python
# The SYSTEM group (`is_system`) holds the whole catalogue BY RULE at token issuance — including
```

with

```python
#: The two kinds a DEFAULT group can be. A group a hospital creates is neither, and the API sends
#: `kind: null` for it rather than a guess (`admin/router._group_out`).
GROUP_KINDS: frozenset[str] = frozenset({"role", "extra"})

# The SYSTEM group (`is_system`) holds the whole catalogue BY RULE at token issuance — including
```

and replace

```python
    if [g["slug"] for g in DEFAULT_GROUPS if g["is_system"]] != ["hospital_admin"]:
        raise RuntimeError("exactly one system group, hospital_admin, is expected")
```

with

```python
    if [g["slug"] for g in DEFAULT_GROUPS if g["is_system"]] != ["hospital_admin"]:
        raise RuntimeError("exactly one system group, hospital_admin, is expected")
    bad = [g["slug"] for g in DEFAULT_GROUPS if g["kind"] not in GROUP_KINDS]
    if bad:
        raise RuntimeError(f"DEFAULT_GROUPS: kind must be one of {sorted(GROUP_KINDS)}: {bad}")
```

- [ ] **Step 13: Tag the eleven groups.** Each `DEFAULT_GROUPS` entry gains `"kind"` immediately after its `"slug"`. **Two are `extra`** — `charge_nurse` and `rapid_response`, the duties a role is given for a while — and the other nine are `role`. Eleven one-line replacements, each written out rather than described, because a list of target lines is not something a worker (or a replay) can apply without guessing which line it replaces. In `homunculus-engine/src/homunculus/auth/permissions.py`, replace

```python
    {"slug": "hospital_admin", "name": "Sistem Yöneticisi",
```

with

```python
    {"slug": "hospital_admin", "kind": "role", "name": "Sistem Yöneticisi",
```

replace

```python
    {"slug": "attending", "name": "Sorumlu Hekim",
```

with

```python
    {"slug": "attending", "kind": "role", "name": "Sorumlu Hekim",
```

replace

```python
    {"slug": "unit_physician", "name": "Ünite Hekimi",
```

with

```python
    {"slug": "unit_physician", "kind": "role", "name": "Ünite Hekimi",
```

replace

```python
    {"slug": "physician", "name": "Hekim",
```

with

```python
    {"slug": "physician", "kind": "role", "name": "Hekim",
```

replace

```python
    {"slug": "charge_nurse", "name": "Sorumlu Hemşire",
```

with

```python
    {"slug": "charge_nurse", "kind": "extra", "name": "Sorumlu Hemşire",
```

replace

```python
    {"slug": "nurse", "name": "Hemşire",
```

with

```python
    {"slug": "nurse", "kind": "role", "name": "Hemşire",
```

replace

```python
    {"slug": "rapid_response", "name": "Hızlı Yanıt Ekibi",
```

with

```python
    {"slug": "rapid_response", "kind": "extra", "name": "Hızlı Yanıt Ekibi",
```

replace

```python
    {"slug": "auditor", "name": "Denetçi",
```

with

```python
    {"slug": "auditor", "kind": "role", "name": "Denetçi",
```

replace

```python
    {"slug": "platform_support", "name": "Üretici Destek",
```

with

```python
    {"slug": "platform_support", "kind": "role", "name": "Üretici Destek",
```

replace

```python
    {"slug": "pharmacist", "name": "Eczacı",
```

with

```python
    {"slug": "pharmacist", "kind": "role", "name": "Eczacı",
```

replace

```python
    {"slug": "biomedical", "name": "Biyomedikal Teknisyen",
```

with

```python
    {"slug": "biomedical", "kind": "role", "name": "Biyomedikal Teknisyen",
```

The import-time self-check from Step 12 refuses a twelfth group added without a `kind`, which is what makes this list maintainable rather than merely correct today.

Check it loads:

```bash
cd /c/tmp/w3b-impl/homunculus-engine
export PY312=/c/tmp/f7-py312/venv/Scripts/python.exe
$PY312 -c "import sys; sys.path.insert(0,'src'); from homunculus.auth.permissions import DEFAULT_GROUPS as G; print([(g['slug'], g['kind']) for g in G])"
```
Expected:
```
[('hospital_admin', 'role'), ('attending', 'role'), ('unit_physician', 'role'), ('physician', 'role'), ('charge_nurse', 'extra'), ('nurse', 'role'), ('rapid_response', 'extra'), ('auditor', 'role'), ('platform_support', 'role'), ('pharmacist', 'role'), ('biomedical', 'role')]
```

- [ ] **Step 14: Report it.** In `homunculus-engine/src/homunculus/admin/schemas.py`, replace

```python
    permissions: list[str]
    member_count: int
```

with

```python
    permissions: list[str]
    member_count: int
    # "role" | "extra" for one of the eleven DEFAULT groups (`auth/permissions.GroupSpec.kind`),
    # None for a group this hospital created. What the group IS to a person, as opposed to what it
    # grants: the administration screen's user form offers one role plus any number of extra
    # duties (roadmap D3), and the membership table is one flat list that says nothing about it.
    # None is an answer, not a gap: a hospital's own group is neither, and a screen must not guess
    # from the slug or the permission set.
    kind: str | None = None
```

In `homunculus-engine/src/homunculus/admin/router.py`, replace

```python
from homunculus.auth.permissions import ALL_PERMISSIONS, PERMISSIONS
```

with

```python
from homunculus.auth.permissions import ALL_PERMISSIONS, DEFAULT_GROUPS, PERMISSIONS
```

and replace

```python
def _group_out(group: Group, count: int) -> GroupOut:
    return GroupOut(id=group.id, slug=group.slug, name=group.name,
                    description=group.description, mfa_required=group.mfa_required,
                    is_system=group.is_system,
                    # A system group's rights are the whole catalogue by rule (spec §3); report
                    # that, not the rows seeded when the tenant was created.
                    permissions=sorted(ALL_PERMISSIONS) if group.is_system else group.permission_keys,
                    member_count=count)
```

with

```python
#: slug -> "role" | "extra", for the eleven groups this product defines. A hospital's own group is
#: in neither, and `_group_out` sends `kind: null` for it.
_DEFAULT_KIND: dict[str, str] = {g["slug"]: g["kind"] for g in DEFAULT_GROUPS}


def _group_out(group: Group, count: int) -> GroupOut:
    return GroupOut(id=group.id, slug=group.slug, name=group.name,
                    description=group.description, mfa_required=group.mfa_required,
                    is_system=group.is_system,
                    # A system group's rights are the whole catalogue by rule (spec §3); report
                    # that, not the rows seeded when the tenant was created.
                    permissions=sorted(ALL_PERMISSIONS) if group.is_system else group.permission_keys,
                    member_count=count,
                    # Read from the spec by slug rather than stored on the row: it is a property of
                    # the group this product DEFINES, not of the tenant's copy of it, so there is
                    # nothing for a migration to backfill and nothing for a tenant to diverge on.
                    # None for a group the hospital created — see GroupOut.kind.
                    kind=_DEFAULT_KIND.get(group.slug))
```

**No migration, and that is the design.** `kind` is a property of the group this product *defines*, not of a tenant's copy of it, so there is no column, nothing to backfill, and no way for one hospital's `nurse` to be a duty while another's is a role.

```bash
cd /c/tmp/w3b-impl/homunculus-engine
export PY312=/c/tmp/f7-py312/venv/Scripts/python.exe
export PYTHONPATH="$PWD/src"
export TEST_DATABASE_URL="postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_w3b"
$PY312 -m pytest -q tests/test_admin_api.py -k "kind or member_counts or whole_catalogue" 2>&1 | grep -E "^[0-9]+ (passed|failed)"
```
Expected: `3 passed, 56 deselected`.

- [ ] **Step 15: Let the dashboard prefer it, and keep the mirror as the fallback.** In `dashboard/src/live/screens/admin/rules.js`, replace

```javascript
    isSystem: row.is_system === true,
    kind: groupKind(row.slug),
```

with

```javascript
    isSystem: row.is_system === true,
    // The API's own answer first (`GroupOut.kind`: "role" | "extra" for one of the eleven groups
    // this product defines, null for a group the hospital created), and the mirror only when it
    // said nothing at all. `null` is an ANSWER from a server that has the field — "neither" — so
    // it must not fall through to the mirror, which would answer "other" for the same thing and
    // be right by luck; `undefined` is a server that does not have the field, which is the case
    // the mirror exists for.
    kind: row.kind === undefined ? groupKind(row.slug) : (row.kind ?? "other"),
```

In `dashboard/src/live/screens/admin/rules.test.js`, replace

```javascript
    expect(group({ member_count: 0 }).memberCount).toBe(0);           // a real zero stays a zero
    expect(groupFromApi(null).memberCount).toBeNull();
  });
```

with

```javascript
    expect(group({ member_count: 0 }).memberCount).toBe(0);           // a real zero stays a zero
    expect(groupFromApi(null).memberCount).toBeNull();
  });

  it("takes the API's own `kind`, and falls back to the mirror only when there is none", () => {
    // `GroupOut.kind` carries it now. A server that answers `null` has said "neither" about a
    // group the hospital made; a server that does not have the field at all says nothing, and
    // only then is the mirror asked.
    expect(group({ slug: "nurse", kind: "extra" }).kind).toBe("extra");       // the API wins
    expect(group({ slug: "gece_ekibi", kind: null }).kind).toBe("other");     // "neither"
    expect(groupFromApi({ slug: "charge_nurse" }).kind).toBe("extra");        // the mirror
    expect(groupFromApi({ slug: "gece_ekibi" }).kind).toBe("other");
  });
```

In `dashboard/src/live/screens/admin/catalogue.test.js`, replace

```javascript
  it("every default group is one or the other", () => {
    expect([...EXTRA_DUTY_SLUGS, ...ROLE_SLUGS].sort()).toEqual(DEFAULT_GROUPS.map((g) => g.slug).sort());
  });
```

with

```javascript
  it("every default group is one or the other", () => {
    expect([...EXTRA_DUTY_SLUGS, ...ROLE_SLUGS].sort()).toEqual(DEFAULT_GROUPS.map((g) => g.slug).sort());
  });

  it("agrees with the backend's own `kind`, which is now where the classification lives", () => {
    // The mirror used to be the ONLY place this was written down. `GroupSpec.kind` carries it now
    // and `GroupOut.kind` reports it, so the mirror is a fallback — for a group the API describes
    // without a kind, and for a desk that cannot read `/admin/groups` at all. A fallback that
    // disagreed with the thing it falls back from would be worse than none, so this reads the
    // backend and fails when the two drift.
    const kinds = new Map(
      [...PY.matchAll(/\{"slug": "(\w+)", "kind": "(\w+)"/g)].map((m) => [m[1], m[2]]),
    );
    expect(kinds.size, "GroupSpec.kind in auth/permissions.py").toBe(DEFAULT_GROUPS.length);
    for (const group of DEFAULT_GROUPS) {
      expect(kinds.get(group.slug), `${group.slug} kind`).toBe(group.kind);
    }
  });
```

In `dashboard/src/live/screens/admin/admin.testutil.js` — so a fixture cannot describe a group the server would describe differently — replace

```javascript
import { PERMISSION_KEYS } from "./catalogue.js";
```

with

```javascript
import { DEFAULT_GROUPS, PERMISSION_KEYS } from "./catalogue.js";
```

and replace

```javascript
    permissions: ["board.view", "alerts.ack"],
    member_count: 0,
    ...over,
  };
}
```

with

```javascript
    permissions: ["board.view", "alerts.ack"],
    member_count: 0,
    // `GroupOut.kind`, as the API now reports it: the spec's own kind for one of the eleven
    // default groups, and **null** for a group the hospital created — which is an answer, not a
    // gap. Derived here rather than defaulted, so a fixture cannot describe a group the server
    // would describe differently.
    kind: DEFAULT_GROUPS.find((g) => g.slug === slug)?.kind ?? null,
    ...over,
  };
}
```

In `dashboard/src/live/screens/admin/admin.testutil.test.js`, the builders' test says what the field is for — replace

```javascript
    expect(() => user({ id: "u-1" })).toThrow(TypeError);
  });
```

with

```javascript
    expect(() => user({ id: "u-1" })).toThrow(TypeError);
    expect(group("gece_ekibi").kind).toBeNull();                 // a hospital's own group
    expect(group("charge_nurse").kind).toBe("extra");
  });
```

`UsersTab.jsx` needs no edit: its role filter already reads the ADAPTED group's `kind` (`groups.filter((g) => g.kind === "role")`), which was the mirror's answer until this step and is the API's from now on.

```bash
cd /c/tmp/w3b-impl/dashboard
npx vitest run src/live/screens/admin/ 2>&1 | grep -E "Tests "
```
Expected: `Tests  179 passed (179)` — `catalogue` **10**, `rules` **35**, `refusal` 5, `admin.testutil` 4, `AdminScreen` 19, `UsersTab` **37**, `RolesTab` 32, `SourceTab` 37.

---

#### 14d · the unassigned counter counts only those who would need a grant

`GET /scope/unassigned` is the one number on the users tab that says whether the scope table has ever been filled in (Decision 26). It counted every active member with no grant — the hospital administrator included, whose scope is unrestricted by role and who needs none — so on a pilot with one administrator it read "1" forever: a permanent "there is work here" about a person for whom there is none. The test is already in the file from Step 1 (`test_the_unassigned_count_leaves_out_those_who_need_no_grant`) and has been the one failure since Step 6.

- [ ] **Step 16: Fix it.** In `homunculus-engine/src/homunculus/scope/service.py`, replace

```python
from homunculus.auth.models import TenantMembership, User
```

with

```python
from homunculus.auth.models import Group, TenantMembership, User, UserGroup
```

replace

```python
async def count_unassigned(db: AsyncSession, tenant_id: uuid.UUID) -> int:
    """How many active members of this tenant hold no scope at all.

    The number the administrator's screen needs in order to know there is work here. Without it,
    "everyone sees everything because nobody has been assigned" is indistinguishable from
    "everyone sees everything because that is the policy".
    """
    members = await db.execute(
```

with

```python
async def count_unassigned(db: AsyncSession, tenant_id: uuid.UUID) -> int:
    """How many active members of this tenant hold no scope at all — AND would need one.

    The number the administrator's screen needs in order to know there is work here. Without it,
    "everyone sees everything because nobody has been assigned" is indistinguishable from
    "everyone sees everything because that is the policy".

    A member whose scope is unrestricted BY ROLE is not counted: a hospital administrator (the
    tenant's system group) or a platform operator needs no grant and `build_scope` gives them the
    whole board before it looks at grants (`SCOPE_UNRESTRICTED_ROLES`). Counting them made this
    number read "1" forever on a pilot with one administrator — a permanent "there is work here"
    about a person for whom there is none, on the one figure that exists to say whether the scope
    table has ever been filled in.
    """
    unrestricted = (
        select(UserGroup.user_id)
        .join(Group, UserGroup.group_id == Group.id)
        .where(Group.tenant_id == tenant_id, Group.is_system == True)  # noqa: E712
    )
    members = await db.execute(
```

and replace

```python
            User.is_active == True,  # noqa: E712
        )
    )
    member_ids = {row[0] for row in members.all()}
```

with

```python
            User.is_active == True,  # noqa: E712
            User.is_platform_support == False,  # noqa: E712
            TenantMembership.user_id.not_in(unrestricted),
        )
    )
    member_ids = {row[0] for row in members.all()}
```

- [ ] **Step 17: Run the whole agreement file**

```bash
cd /c/tmp/w3b-impl/homunculus-engine
export PY312=/c/tmp/f7-py312/venv/Scripts/python.exe
export PYTHONPATH="$PWD/src"
export TEST_DATABASE_URL="postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_w3b"
$PY312 -m pytest -q tests/test_scope_me_agrees_with_board.py 2>&1 | grep -E "^FAILED|^[0-9]+ (passed|failed)"
```
Expected: `9 passed`.

**No dashboard change follows from 14d.** The users tab prints whatever `/scope/unassigned` answers and says so when it did not answer; what changes is that the number is now about the people it was meant to be about.

---

- [ ] **Step 18: Gate — both suites, and the Python one on both interpreters**

Run the suite and the build as **two** commands, and the two interpreters **one after the other** with nothing else running:

```bash
cd /c/tmp/w3b-impl/dashboard
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
```bash
cd /c/tmp/w3b-impl/homunculus-engine
export PY312=/c/tmp/f7-py312/venv/Scripts/python.exe
export PY314=/c/tmp/w3b-py314/Scripts/python.exe
export PYTHONPATH="$PWD/src"
export TEST_DATABASE_URL="postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_w3b"
PY=$PY312
$PY -m pytest -q tests/rules tests/scoring tests/tenant tests/test_a*.py 2>&1 | tail -1
$PY -m pytest -q $(ls tests/test_[b-l]*.py | grep -v infinity_vm_pilot) 2>&1 | tail -1
$PY -m pytest -q tests/test_[m-z]*.py 2>&1 | tail -1
```
```bash
cd /c/tmp/w3b-impl/homunculus-engine
export PY312=/c/tmp/f7-py312/venv/Scripts/python.exe
export PY314=/c/tmp/w3b-py314/Scripts/python.exe
export PYTHONPATH="$PWD/src"
export TEST_DATABASE_URL="postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_w3b"
PY=$PY314
$PY -m pytest -q tests/rules tests/scoring tests/tenant tests/test_a*.py 2>&1 | tail -1
$PY -m pytest -q $(ls tests/test_[b-l]*.py | grep -v infinity_vm_pilot) 2>&1 | tail -1
$PY -m pytest -q tests/test_[m-z]*.py 2>&1 | tail -1
```
Each third is its own command — the first alone is about 8½ minutes — and the second interpreter starts only when the first has finished.

Expected, measured at `91dbd05` (base **98 / 2089** JS; Python **2272 passed, 8 skipped** on both interpreters, with `test_infinity_vm_pilot.py` left out as above):

| | Files | Tests |
|---|---|---|
| dashboard | **106** (+8) | **2271** (+182) |
| Python, 3.12.13 (the image's version) | — | `990 passed` · `868 passed, 6 skipped` · `425 passed, 2 skipped` = **2283 passed, 8 skipped** (+11) |
| Python, 3.14.5 (the development version) | — | the same three lines: **2283 passed, 8 skipped** (+11) |

Eleven new Python tests — 9 in `test_scope_me_agrees_with_board.py` (the last third), 1 for the unlock's second outcome and 1 for `kind` (both in the first) — one rewritten assertion (the unlock's answer), and three new dashboard tests. Collected: 2291 → 2302 on both interpreters, 13 of them `test_infinity_vm_pilot.py`'s.

**One flake to know about rather than chase.** `LiveApp.test.jsx > "lands an account straight in the product, on its home — no setup wizard"` failed **twice**, both times on a run that had `npx vite build` queued behind it in the same command, and passed every time the suite ran alone — including on consecutive full runs and on the replayed tree. It is timing-sensitive under CPU contention, it is not this wave's test and this wave does not touch it. **Run the suite and the build as two commands**, and if you see this one fail, re-run before investigating.

- [ ] **Step 19: Drop the database**

```bash
docker exec homunculus-test-pg dropdb -U homunculus homunculus_test_w3b
```
Leave `homunculus_test` alone.

- [ ] **Step 20: Commit**

```bash
git status --short
git add homunculus-engine/src/homunculus/scope/router.py homunculus-engine/src/homunculus/scope/schemas.py homunculus-engine/src/homunculus/scope/service.py homunculus-engine/src/homunculus/admin/router.py homunculus-engine/src/homunculus/admin/schemas.py homunculus-engine/src/homunculus/auth/permissions.py homunculus-engine/tests/test_scope_me_agrees_with_board.py homunculus-engine/tests/test_admin_api.py homunculus-engine/tests/test_admin_ldap_api.py
git add dashboard/src/live/screens/admin/rules.js dashboard/src/live/screens/admin/rules.test.js dashboard/src/live/screens/admin/catalogue.test.js dashboard/src/live/screens/admin/admin.testutil.js dashboard/src/live/screens/admin/admin.testutil.test.js dashboard/src/live/screens/admin/UsersTab.jsx dashboard/src/live/screens/admin/UsersTab.test.jsx dashboard/src/live/i18n/strings/admin.js
git commit -m "$(cat <<'EOF'
fix(engine): four places an administration screen could not tell the truth

/scope/me called build_scope without enforce_unassigned and without the
break-glass patients, while the board's own resolver passes both. With
enforcement on it answered "your scope is unrestricted" about a clinician whose
board was empty -- the opposite of what she was looking at, on exactly the
configuration a hospital turns on when it starts restricting access -- and it
omitted the one grant that is reason-bound and audited. The new tests are
written as an AGREEMENT between the route and the resolver under each of the
four reasons a user route can produce, and ScopeView carries own_patients (a
count, never an identifier) so the break-glass half is checkable. G1-12's one
otherwise-unmeetable acceptance criterion.

POST /unlock-sign-in put Unlocked.granted in the audit row and threw it away in
the answer, so three outcomes reached the administrator identically and the
screen said "the throttle was lifted" for a call that may have lifted nothing.
granted, allowed_before and allowed_after are in the response now, and the
screen says which happened with the server's own number.

GroupSpec/GroupOut carry `kind`: role or extra duty for the eleven groups this
product defines, null for one a hospital created. The dashboard had to classify
those slugs itself, two files from the groups it was classifying; the mirror
stays as the fallback and its test now reads the backend's own kind, so the two
cannot drift. No migration: it is a property of the group this product defines,
not of a tenant's copy of it.

GET /scope/unassigned counted the hospital administrator, who needs no grant,
so the one number that says whether the scope table was ever filled in read "1"
forever on a pilot with one administrator. Only members who would need a grant
are counted.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** dashboard `106 / 2271` (+182), build clean; Python **2283 passed, 8 skipped** (+11, skipped unchanged) on 3.12 **and** on 3.14, `test_infinity_vm_pilot.py` left out; `homunculus_test_w3b` dropped.

### Which screen assertions move once this lands

Four files, and nothing an arm wrote is invalidated — each is a count going up by one or a fixture gaining a field the server now sends:

| File | Was | Becomes | Why |
|---|---|---|---|
| `screens/admin/catalogue.test.js` | 9 | **10** | the mirror is now checked against `GroupSpec.kind` as well as against the slugs and the flags |
| `screens/admin/rules.test.js` | 34 | **35** | `groupFromApi` prefers `GroupOut.kind` and falls back to the mirror |
| `screens/admin/UsersTab.test.jsx` | 36 | **37** | the unlock's outcomes, with the server's number |
| `screens/admin/admin.testutil.js` + `.test.js` | 4 | 4 | `group()` gains `kind`, derived; its builders' test asserts the two kinds — two assertions, no new test |
| `i18n/strings.test.js` | 6 | **6** | two new texts, both differing in all four languages: no parity entry |
| whole suite | 2268 | **2271** | |

**And one behaviour changes without any assertion moving**, which is worth knowing before the first VM deploy: with `SCOPE_ENFORCE_UNASSIGNED` on, the scope editor stops showing "this user's scope is unrestricted — nothing to assign here" for an unassigned user and shows the editor instead. That is the correct screen and it is the whole point of 14a; the pilot runs with the flag off, so nothing changes until the hospital decides to turn it on, which is exactly the decision the flag exists to make deliberate.

---

## Self-review

Run against the brief — Tasks 20, 21 and 22 of the Wave 3 plan — with fresh eyes.

**1. Spec coverage.** Every acceptance criterion in those three specifications, and the task that meets it.

**Task 20, the users tab** (21 criteria):

| Criterion | Where | |
|---|---|---|
| lists the users with every column, and the username under the name | T7, "lists the users with every column…" | ✓ |
| a temporary password is a tag, not a silence; "required · not set up" is not "off"; a user who has never signed in says so | T7, two tests | ✓ |
| tells "no unit assigned" from "scope unrestricted" | T7, "claims nothing about a user's units until that user's scope has been read" + "fills the row's units cell once that user's scope has been read" | ✓ **changed**: the list cannot say either until it has read that user's scope (Decision 6, no bulk read). The two statements stay distinct in the editor and in the filled cell. |
| searches name and username, folding diacritics; filters by role | T7, two tests | ✓ |
| draws no action the session may not take, and says why once per row | T7, three tests | ✓ |
| creates a local user: full name, username, e-mail, password, group ids of role + duties + others | T7, "creates a local user…" | ✓ |
| the username cannot be edited, and the form says so | T7 | ✓ |
| a group beyond the session's rights is shown and disabled, not hidden | T7 | ✓ |
| the directory's memberships are read-only and named | T7 | ✓ |
| a 422 on the username lands on the username field, in the user's language | T7 + **T2** | ✓ — and it did not work until Task 2 (Decision 3) |
| resetting a password, resetting MFA and deactivating each confirm first and name the consequence | T7, three tests | ✓ |
| the unlock asks for a reason, refuses an empty one before sending, and says the reason is audited | T7 | ✓ |
| while a write is in flight its dialog cannot be dismissed, and a refusal is shown in the still-open dialog | T7, two tests | ✓ |
| a password is never in the DOM after the dialog closes | T7, two tests | ✓ |
| after every write the list is reloaded from the server | T7 (`reload` is a spy in every write test) | ✓ |
| an unrestricted user gets no scope editor and the reason why | T7 | ✓ |
| the scope options come from the board's cards and the user's own grants, and the screen says so | T7 | ✓ |
| a key with no card on the board can be added by hand, and the screen says what that means | T7 | ✓ |
| the list is a `<table>` with a caption, `<th scope="col">` per column and `<th scope="row">` on the username; at 390 px it scrolls inside a named region and the page does not | T7, "accessibility" + Step 7 | ✓ (the 390 px half is the browser step) |
| saving sends the whole list; a refusal puts the previous list back and says so | T7, two tests | ✓ |
| the count of users with no assignment at all is on the screen | T7 — **and absent, with its own sentence, when the read did not answer** (Decision 26) | ✓ |

**Task 21, the roles tab** (10 criteria): the catalogue down the side with each permission described — in the reader's language by key, the server's English as the marked fallback (Decision 13, decided after the first draft) — and the groups across the top with member counts ✓ (T9, three tests, and the count is absent when unknown — which the first draft claimed and did not do, see Decision 26); a cell reads as "<group>, <permission>", a caption, a sticky first column ✓ (T9, three tests); a checkbox collects and nothing is sent, the column says how many are pending ✓; Save sends one PATCH per group with the whole list, reloads, and reads as done with no alert ✓; a 409 re-reads the column and keeps the ticks ✓; the system group's column read-only with the server's reason, its cells reachable and `aria-disabled` ✓; a group beyond the session's rights read-only ✓; a group holding a key the catalogue does not describe read-only, naming it ✓; creating sends slug/name/description/MFA/permissions, and a duplicate slug's 409 is on the slug field ✓ (plus a 422 on the slug, which the brief did not ask for and Task 2 made possible); deleting shows the server's refusal for all three cases ✓; a session without `groups.manage` never reaches the tab ✓ (the frame's own test, T1); the grid is a real table ✓.

**Task 22, the login-source tab** (10 criteria): an unconfigured directory says so and the other three sections are not drawn ✓ (T11, two tests); the status shows the host only ✓; the test's five reasons each get a sentence ✓; the search says which results are already imported and which are disabled ✓; **the import is sent in chunks of ten** → ✗ **changed to two, with its reason** — `LDAP_IMPORT_CHUNK` was reduced to 2 by the Wave 3 review (one wave of `IMPORT_LOOKUPS`, and nginx's 60 s default would 504 a chunk of ten), and `amendments.md` carries that as a contract; the criterion's intent (chunked, with a progress line, a failed chunk named by its accounts, the rest still offered, the imported rows marked, the search held meanwhile) is met in full ✓; a mapping that landed is never reported refused, and a failed table read has a retry ✓; all seven skip reasons translated, `login_taken` and `invalid_login` saying what to do ✓; the mapping read-only without every right, with the server's reason ✓; a DN from the picker, with the sentence saying why a typed one may not match ✓; a timeout says the operation may have happened ✓; the two tables have captions and row headers ✓.

**The three requirements that applied to all three tabs**: a list of records is a real `<table>` — ✓, asserted per tab; every task carries a 390 px check of its own — ✓, Tasks 7, 9 and 11 Step 7; every refusal has a text — ✓, and the one that did **not** (every 422) is Task 2.

**Gaps, stated rather than hidden.** Three criteria are met differently and none is unmet:
- the units column (Decision 6) — differently, because there is no bulk scope read (**Needs the user, 5**);
- the scope "matrix" (Decision 7) — a list, because nothing lists the keys;
- the import's chunk size — two, not ten, by a later contract;
- **`/scope/me` agreeing with the board** — **met, by Task 14a**, which was added after the first draft on the user's decision. It was the one criterion no screen could meet.

**2. Placeholder scan.** No "TBD", no "add appropriate error handling", no "similar to Task N", no step that describes a change without showing it. Every code step carries the code, and every code block in this document was taken from a tree where it ran. Two steps deliberately point at another document instead of repeating it — Task 1, at Wave 3's Tasks 16–19 — and that is an execution instruction for committed code, with the four skips named.

**3. Type consistency.** Checked across the tasks: `refusedFor(t, subject, err)` and `doneFor(t, subject, text)` (T3) are called with exactly those arguments in T7, T9 and T11; `fieldRefusals(t, err)` (T2) returns `{field: text}` keyed by the **API's** field names, which `UserForm`'s `FIELD` map and `GroupForm`'s own keys both use; `canAssignScope(myScope)` (T2) is three-valued and `ScopeEditor`'s `mayAssign` prop handles all three; `scopeFromApi(...).grants` is `[{unitId, bedId}]` (camelCase, adapted) while `setScope(id, grants)` sends `[{unit_id} | {bed_id}]` (snake_case, the API's) — the editor converts at the call and its test asserts the sent shape; `admin.testutil.js`'s builders are the **API's** shapes and every test passes them through `userFromApi` / `groupFromApi` / `scopeFromApi`; `onlyTabs(screens)` returns `resetTabs`, as `stubTabs` does; `chunksOf(ids, size)` and `testReasonKey` / `skipReasonKey` are exported from `SourceTab.jsx` and tested there; `isOn` / `listToSend` / `pendingFor` / `undescribedKeys` / `lockedBecause` (→ `{key, vars}` or `null`) / `descriptionOf` (→ `{text, foreign}`) are exported from `RolesTab.jsx` and tested there; `markImported(found, answer)` from `SourceTab.jsx`; `membershipOf` / `mfaState` / `PAGE` / `MANY` from `UsersTab.jsx`; `offeredKeys` from `ScopeEditor.jsx`; `splitGroups` from `UserForm.jsx`.

**4. The counts add up.** 2089 + 58 (T1) + 5 (T2) + 5 (T3) + 6 (T4) + 36 (T7) + 32 (T9) + 37 (T11) = **2268** (+179), and 98 + 3 + 1 + 1 + 1 + 1 + 1 = **106** files. Both were measured on the finished tree, and the per-task figures on trees replayed from this document up to each task. **Task 14** then adds 3 dashboard tests (**2271**, +182) and 11 Python tests, taking the Python suite from **2272** to **2283 passed, 8 skipped** on both interpreters (+11; `test_infinity_vm_pilot.py` left out) — measured on each, in thirds.

**5. Task 14's own coverage.** Four changes, four groups of tests, and each was watched failing first: 14a's nine, of which four failed before the fix (three on the route's two missing arguments, one — the unassigned counter — on 14d, which the same file holds; the other five are the cases the defect never touched); 14b's two, which failed on `{"ok": True}` and on `KeyError: 'granted'`; 14c's one, which failed at collection on `cannot import name 'GROUP_KINDS'`; 14d's one, which failed on `2 == 1`. The dashboard's three were run after each. The one negative check that initially *passed* — 14a's, when a scripted edit silently failed to land against a CRLF file — is called out in Task 14 Step 2, because a worker who sees every test pass there has not tested anything.

---

## Needs the user

**Three of the seven were answered while this plan was being written, and the answers are Task 14.** They are kept here, closed, because a reader of the roadmap will come looking for them.

**1. `/scope/me` deciding differently from the board — ANSWERED and DONE (Task 14a).** The route called `build_scope` without `enforce_unassigned` and without the break-glass patients, while the board's own resolver passes both: with enforcement on it answered "your scope is unrestricted" about a clinician whose board was empty, and it omitted the one grant that is reason-bound and audited. The user chose option (a) — fix it in this wave's backend half — and it is fixed, with eight tests written as an **agreement** between the route and the resolver under each of the four scope reasons, so a future change to either side fails here rather than in a hospital. G1-12's one otherwise-unmeetable acceptance criterion is met, and Task 13 takes the roadmap row off Group 2.

**2. `GroupOut` saying what kind of group it is — ANSWERED and DONE (Task 14c).** `GroupSpec.kind` and `GroupOut.kind`: `"role"` / `"extra"` for the eleven groups this product defines, `null` for a group a hospital created. **No migration** — it is a property of the group this product defines, not of a tenant's copy of it. The dashboard's mirror is kept as the fallback for a server that does not have the field, and its test now reads the backend's own `kind`, so the fallback cannot disagree with the thing it falls back from. `null` is handled as an answer ("neither") and not as a missing field.

**3. The sign-in unlock over-claiming — ANSWERED and DONE (Task 14b).** `POST /unlock-sign-in` put `Unlocked.granted` in the audit row and threw it away in the answer, so three outcomes reached the administrator identically and the screen said "the throttle was lifted" for a call that may have lifted nothing. The response carries `granted`, `allowed_before` and `allowed_after` now, and the screen says which happened with the server's own number — two strings in four languages, one new test. **And a fourth, found by the review — Task 14d:** `GET /scope/unassigned` counted the administrator, so the one figure that says whether the scope table was ever filled in read "1" forever on a pilot with one administrator.

---

**The four that remain.**

**4. `GET /admin/users` stays unbounded for the pilot — confirm the trigger.** The user chose option (a) with the note (Wave 3's **Needs the user, 10**), and this plan implements it with the note **on screen** at 200 accounts (Decision 5). What is not decided is who acts on that note.
 *Options:* **(a)** it is a roadmap row for "before the second hospital"; **(b)** it is a number — a monitoring alert when `/admin/users` returns more than N; **(c)** nothing until someone complains.
 *Recommendation:* (a), written into the roadmap by Task 13, which is what Task 13 does. Raised only so the sentence on screen has an owner.

**5. A bulk scope read, so the users tab's units column can be real.** There is no endpoint that reports more than one user's scope: `GET /scope/{user_id}` is per user and `GET /scope/unassigned` answers a count. So the column claims nothing it has not read (Decision 6) and fills a row only when that row's editor has been opened. It is honest and it is not what an administrator wants to look at.
 *Options:* **(a)** leave it; **(b)** `GET /scope?user_ids=…` — one query, the same `ScopeView` per id, about thirty lines beside the route that already exists; **(c)** put a `units`/`beds` summary on `UserOut`, which is cheaper to read and couples two concerns.
 *Recommendation:* **(b)**, with the tab's cell then filled from the list read. It is the one API gap in this wave that changes what a screen can *show* rather than what it can *claim*, which is why it was not folded into Task 14.

**6. The five long sentences want a native speaker before the pilot.** `admin.sub`, `roles.note`, `source.notConfigured`, `source.skipInvalidLogin` and `source.mapPickHint` are the longest texts this wave writes and the four languages were written by a machine. They are not clinical prose — nothing here is a clinical claim — but `source.skipInvalidLogin` carries a transliteration rule an administrator has to **act on**, and if its Azerbaijani is clumsy she will act on it wrongly. Task 12 Step 6 records what is actually on screen and Task 13 carries it into the G1-15 gate, where it joins the Azerbaijani reading of the engine's clinical prose that is already there.
 *Recommendation:* read them in that same sitting.

**7. Two things about the prototype — ASKED.** Both are in this surface and both are refused here (the design note's items 11–14 cover them), and both have now gone to the designer as questions rather than as refusals, because one of them may have been meant as product:
- the **temporary password the browser generates and displays**, with a "regenerate" button. Refused: the administrator types it, it is never shown afterwards, and the only rule stated is the server's. If the intent was "the administrator should not have to invent a password", that is a real need and the answer is a server-side generated password returned once by `POST /admin/users` — which the API does not do and which would be a deliberate decision about where a plaintext password may exist.
- the **"view as this role" switch**. Refused outright: a view that imitates a permission makes the audit trail unable to say who saw what. If the intent was "let an administrator check what a nurse sees", the honest version is a read-only permission *preview* — the list of screens a group's rights open — which is computable from `catalogue.js` and `routes.js` and would be a small Group 2 panel.
 *Status:* sent. Nothing in this plan waits on the answers; if either comes back as product, it is a Group 2 item with a source.

**8. The still-open roadmap decisions this wave touches and changes neither.** **(3)** forced MFA for the four groups: nothing in this wave names a group — the roles table shows each group's `mfa_required` as the server reports it and the users tab reads it to tell "required · not set up" from "off", so whichever way the user decides, no screen changes. It should still be answered before G1-15, because it decides who has to enrol an authenticator on the morning of the deploy. **(6)** whether `platform_support` sees the research window and the full audit trail: unchanged, and visible here only as a slug in the roles table.
