# G2-B4 follow-up — «Denetim bütünlüğü»: names instead of user ids, a label for every event type

**Date:** 2026-11-11 · **Lane:** B (session homunculus-ai-c4) · **Branch:** `fix/g2b-b4-denetim-adlar`, cut from main
`e0850fb1` · **Parent spec:** `docs/superpowers/specs/2026-11-09-g2b-b4-denetim-design.md` (D2 masking, D6 who did it, §4
event types).

**Origin.** B1d's local walk of B1c (2026-11-11, synthetic data) found two things on `/denetim` that B1c did not cause:
1. «Kapsam ataması» (`scope`) rows show who did it and whose access changed as raw user UUIDs, in all four languages,
   e.g. `Scope assignment 1694d21f-… — 32678df2-…`.
2. `structure.create` shows as its raw code: the page names only the types in `EVENT_TYPES`.

## 1. Why

- `scope/router.py` writes the row as `AuditEvent(slug, "scope", "", str(user_id), {"by": str(admin.id), "before",
  "after"})`: the subject is the target user's id and the only actor key is `by`, an id. Every other writer puts a
  username in `actor` (`tenant/router.py` `_audit`, `api/app.py` `scope_denied`, …).
- `denetim.js` `actorOf` returns the first non-empty `ACTOR_KEYS` value as it is, and `DenetimScreen.jsx` prints
  `rec.subject` as it is.
- `EVENT_TYPES` was written for B4's list. Types added since (or missed) show as codes and are not in the filter.

## 2. Owner's decision (2026-11-11)

**«Ad yaz, eskiyi maskele».**
- From now on the engine writes names on a scope row: who made the change and whose access changed.
- Rows already written keep what they hold (the audit chain is never rewritten). The page masks a user id it finds
  there, the way it masks a patient id (owner D2 of the parent spec): «kullanıcı ••••1a2b».

## 3. Design

### D1 — engine: the scope row carries names
`PUT /scope/{user_id}` (the route that writes the `scope` row) adds, beside the existing keys:
- `"actor"`: the administrator's `username` (read first by the page's `ACTOR_KEYS`);
- `"user"`: the target user's `username` (read from `User` by `user_id`, in the caller's tenant; the route already
  checks membership).

`by` (the administrator's id), the row's `subject` (the target's id), `before` and `after` stay as they are: the row's
shape only grows, so nothing that reads it breaks, and the id remains for an investigator. No migration.

### D2 — page: no raw user id is printed
- **Who did it** (`actorOf`): a value that is a UUID is shown masked, «kullanıcı ••••» + its last four characters
  (four languages; the mask is `MASK`). A username is shown as now. Because `actor` is read before `by`, new scope rows
  show the administrator's name and old ones the mask.
- **Subject**: for a `scope` row, the page shows the payload's `user` when it is a non-empty text, else the subject
  masked the same way. For every other type, a subject that is a UUID is masked the same way; any other subject is
  shown as now.
- **No other change** to the patient mask (D2 of the parent spec), the filter or the verdicts.
- **As built (2026-11-11, deviation).** «kullanıcı» is said only where the id is known to be a person's: a scope
  row's subject and the actor keys that name a person. A UUID subject of any other type — a task's id on the
  `task_*` rows — and a UUID under the actor key `device` (a monitor) are masked as an id, without the word:
  `••••a5b9`. Calling a task or a monitor «kullanıcı» would be false.

### D3 — a label for every event type the engine writes
- Inventory every `event_type` the engine writes (`trail.record`, `append_audit`, `AuditEvent(…)` and any helper that
  wraps them; `_audit` in `tenant/router.py` writes `structure.create|rename|close|reopen`), and every one that is not
  in `EVENT_TYPES` gets an entry and a label in four languages (`denetim.js` strings). Codes stay codes in storage.
- A test pins the inventory: it reads the engine's sources (as `apiErrors.test.js` and the catalogue drift tests do)
  and fails when the engine writes a type the page does not name, so the next new type cannot slip through.
  As built (`engineTypes.test.js`, after review): it reads every `AuditEvent(…)` and every call of a declared wrapper,
  by the function each sits in; a type argument it cannot read — a parameter of an undeclared function, a nested
  conditional, a loop or unpacked variable — fails the test rather than being skipped; and in the two modules whose
  types come through a variable, every `structure.` / `device_bed.` literal must be a named type.
- The table's rule for an unknown code (show the code) stays, for rows written by older versions.

### D4 — out of scope
Resolving old rows' ids to names (the owner chose masking), editing the audit chain, the parent spec's other rules.

## 4. Tests
- Engine (DB-backed, throwaway Postgres): the scope row's payload has `actor` = the admin's username and `user` = the
  target's username, and keeps `by`, `before`, `after` and the subject.
- Dashboard: `actorOf` masks a UUID and keeps a username; the subject cell for an old scope row (ids only) shows two
  masks, for a new one two names; a UUID subject on another type is masked; every engine-written type has a label (the
  drift test); four languages; `rawKeys` and `strings` rules.
- Gates: the engine tests that touch scope and audit; the whole dashboard suite; `vite build`.

## 5. Guide
The «Denetim bütünlüğü» section of `docs/homunculus-rehber-TR.md` gains two lines: names on scope rows from this
version, «kullanıcı ••••1a2b» on older ones; every event type has a label.
