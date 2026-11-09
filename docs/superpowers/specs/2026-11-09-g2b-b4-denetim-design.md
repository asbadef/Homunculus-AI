# G2-B4 — «Denetim bütünlüğü»: the audit trail's integrity page

**Date:** 2026-11-09 · **Lane:** B (session homunculus-ai-3b), assigned by Lane A (coordinator) on the
owner's word «basdan sona 2-3 saat icinde butun grouplarin islerin bitir» · **Branch:** `feat/g2b-b4-denetim`,
cut from main `8260d0cb` · **Roadmap:** the «Main'den gelen» list of
`2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` says «Denetim bütünlüğü + motor denetim sayfası
(`refreshAudit`/`verifyAudit`) → Grup 2». G1-16 removed the old workspace that had that page, and the
new shell has had no audit page since.

## 1. What it is

A read-only screen at `#/denetim` for whoever holds `audit.view`: the `auditor` group,
`platform_support`, and the hospital administrator (`hospital_admin` holds every permission). It has
two boxes under one `<h1>`:

1. **Zincir doğrulaması**: has this hospital's audit log been altered? The engine's
   `GET /audit/verify` recomputes every seal from the genesis hash forward (`api/audit.py`
   `verify_chain`) and names the first record that fails.
2. **Son olaylar**: the newest audit events (`GET /audit`), newest first, with a type filter.

Nothing on the page writes. There is no migration and no backend change:
- `backendApi.js` already has `audit()` and `verifyAudit()`;
- nginx and the vite proxy already carry `/audit`, which covers `/audit/verify`.

## 2. Owner's decisions (2026-11-09, one question to close the brainstorm)

- **D1 — verification runs only when the button is pressed, never on its own.**
  - Why: a verification reads up to 50 000 records and re-hashes them on the API's event loop. The
    VM's capacity work (dalga-perf-2) is why that load has to be asked for.
  - The page opens with the events only. The «Zinciri doğrula» button runs the verification.
  - The result stays on the page with the local time it was taken («Son doğrulama 17:42»).
  - It is not kept when you navigate away (component state). An old verdict shown as current is the
    one thing this page must never do.
- **D2 — the patient id is masked.**
  - An id longer than four characters shows four dots and its last four characters (`••••4821`).
  - An id of four characters or fewer shows the dots only.
  - No id shows `—`.
  - Rows stay distinguishable, and a passer-by at the screen cannot read a number. Lane A proposed
    this; the owner chose it.

## 3. Decisions taken in the spec

- **D3 — route.**
  ```js
  { id: "denetim", path: "/denetim", icon: "file", labelKey: "denetim.nav", shortKey: "denetim.navShort",
    perms: ["audit.view"], work: true, nav: "main" }
  ```
  - It goes before `settings`, after every existing main entry, so nobody's home moves.
  - `work: true`: an account that holds only `audit.view` now has a screen to sign in to.
    routes.test.js already marked this page as Group 2 work («the audit page: Group 2»).
  - `platform_support` (audit.view + devices.manage) keeps `/devices` as its home and gets this
    entry second on the rail.
- **D4 — the verification call** is `verifyAudit(50000)`. That is the server's own cap
  (`AUDIT_VERIFY_LIMIT_MAX`), so the button asks for the most one call can check. The answer is
  `{ok, checked, unsealed, broken_at, reason, records, complete}`, and the page shows one verdict:
  - `records === 0` (neutral): «Denetim kaydında henüz kayıt yok.»
  - `ok && complete` (ok tone): «Zincir sağlam — {checked} kayıt doğrulandı.»
  - `ok && !complete` (warn tone): «İlk {records} kayıtta zincir sağlam; kayıt daha uzun — sonrası bu
    doğrulamaya girmedi.» A partial check is never shown as a whole one; this is the route's own rule.
  - `!ok` (crit tone, `role="alert"`): «Zincir kırık — ilk kırık halka: kayıt #{id}.» followed by the
    reason.
    - The engine's two reasons are fixed Turkish sentences (`audit.py:107, 112`). The page maps them to
      its own keys: «önceki kayıt silinmiş olabilir» and «kayıt sonradan değiştirilmiş».
    - Any other text maps to a neutral «neden bildirilmedi». The page never shows the server's raw
      text, because that text exists only in Turkish and the page has four languages.
  - `unsealed > 0` (with any verdict) adds a note: «{unsealed} kayıt mühürden önce yazılmış;
    doğrulanamaz, kırık sayılmaz.»
  - A refusal shows the shared `readErrorText` in a crit `Alert`. The button stays, so the user can try
    again.
- **D5 — the events.**
  - The page calls `audit({ limit: 200, eventType })` on open and on «Yenile». There is no polling,
    for D1's reason.
  - The server returns the newest rows oldest-first; the page reverses them.
  - Columns:
    - **No**: `#id`
    - **Zaman**: `ddmmhhmm`, local time
    - **Tür**: the type's label, or its code when the page has no label for it
    - **Kim**: see D6
    - **Hasta**: masked, see D2
    - **Konu**: `subject`
  - The payload and the hashes are not shown. The payload may name other people's ids, and D2 would be
    pointless next to it.
- **D6 — who did it («Kim»).** The engine has no single actor column. The page takes the first
  non-empty string from these payload keys, in this order: `actor`, `charted_by`, `read_by`,
  `signed_by`, `retracted_by`, `by`, `user`, `device`, `login`. If none is set, it shows `—`. The keys
  come from the engine's writers:
  - alarm and ack: `actor`
  - chart and profile: `charted_by`
  - SOFA: `read_by`, `signed_by`
  - «hatalı giriş»: `retracted_by`
  - scope: `by`
  - auth: `user`
  - ingest: `device`
  - a failed sign-in: `login`, the attempted name
- **D7 — the filter.** A `Select` named «Tür» offers «Tümü» and the fixed list of types in §4. Choosing
  a type asks the server (`event_type=`). Filtering on the client would not work: among the newest 200
  rows of every type, ingests would hide a rare type.
- **D8 — scope.**
  - `GET /audit` without a patient refuses a unit-scoped account with 403 (`errors.auditScoped`,
    already mapped). The events box shows that refusal.
  - The verification box still works for that account. `/audit/verify` has no scope rule because it
    reveals no patient.
- **D9 — states.**
  - Loading: a muted line.
  - An empty answer or an unset stub (`undefined`): «Bu süzgeçle kayıt yok.»
  - A refusal: a crit `Alert` with «Yeniden dene».

## 4. Event types with a label

These types have a label and appear in the filter:

- `auth`, `admin`, `scope`, `scope_denied`
- `ack`, `view`
- `chart`, `chart_retract`, `profile`
- `score`, `score_signed`
- `alert`, `first_seen`, `alert_cleared`, `escalation`, `notification`
- `identity`, `ingest`, `reading_dropped_discharged`
- `shadow_alert`, `shadow_alert_cleared`
- `admission.admit`, `admission.sign_off`, `admission.discharge_start`, `admission.discharge_confirm`
- `bed.release`, `device_bed.bind`, `device_bed.unbind`
- `protocol.settings`

These types show their code in the table and are not in the filter: `structure.*`,
`device_bed.relabel`, `device_bed.import`, `admission.label_print`, `admission.discharge_board_retry`.

## 5. Strings

A new namespace, `denetim`. Turkish is the source; az, ru and en are written alongside it and await a
native reading, like the others. It is registered in `i18n/catalog.js` with its own import line and its
own entry, each with a blank line on either side.

## 6. Tests

- **`denetim.js` helpers:**
  - masking: an empty id, an id of four characters or fewer, a long id;
  - the actor key order;
  - the verdict for every D4 case;
  - the reason mapping;
  - the type label lookup.
- **`DenetimScreen.test.jsx`:**
  - exactly one h1;
  - events newest first, with the masked id, the actor, and either the label or the raw code;
  - the filter asks the server with the type's code;
  - a scoped refusal shows its text;
  - an `undefined` answer does not break the screen;
  - the button calls `verifyAudit(50000)` only when pressed, never on mount;
  - each verdict shows its text;
  - a refusal can be retried.
- **`routes.test.js`:**
  - the route's shape;
  - `hasWorkRoute(["audit.view"])` becomes true;
  - `platform_support`'s main entries become `["devices", "denetim"]`, and its home is still `/devices`.
- **`rawKeys.test.jsx`:**
  - stubs for `audit` and `verifyAudit` in the sweep;
  - an anchor test that opens `/denetim`, presses the button on a broken chain, and finds no raw key.
- **Gates:** the whole dashboard suite (`npx vitest run`) and `npx vite build`.

## 7. Not in this slice

- export;
- a per-patient search;
- the payload;
- a server-side «last verified» record;
- a newest-first verification. The route checks the OLDEST 50 000 records; a trail longer than that is
  reported as partial (D4).

B6 (the bed × hour alarm heatmap) is its own slice. `/alarm-quality` has no per-hour or per-bed
breakdown today, only `per_day` and the top ten patient ids, so B6 needs a backend field first.
