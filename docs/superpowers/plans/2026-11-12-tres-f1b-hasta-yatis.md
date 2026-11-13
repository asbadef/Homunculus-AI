# TRƏS-01 · F1b Patient, Practitioner, Encounter, vital signs — the dashboard's panels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The second half of phase F1 (TRƏS-01): Yönetim › TRƏS gains the three panels of spec §8 that phase F1 owes — «Gönderimler» (the ledger, a stay found by its protocol number, «Şimdi gönder», «Önizle», «Yeniden dene», a parked feed said at the top), «Bölüm eşleme» and «Hekim kimlikleri» — and the settings form shows the automatic rounds' start (`send_from`, O15, proposed) and says the live platform is closed. Then the phase's documents (spec §14, the Turkish guide, the gates' record), the push, and the final review of the whole phase.

**Architecture:** Written against the engine of **F1a** (`docs/superpowers/plans/2026-11-12-tres-f1a-hasta-yatis.md`) **as it writes its routes** — F1b starts when F1a's Task 13 is through: `GET /admin/tres/deliveries?status=&type=&admission=&cursor=` → `{environment, session_refused_at, items: [{id, resource_type, local_id, status, reason, attempts, operation, remote_id, next_attempt_at, updated_at, admission_id, board_key}], next}`; `GET /admin/tres/admissions?key=` → `{admission_id, board_key, state, discharge_at}`; `GET /admin/tres/admissions/{id}/preview` → `{admission_id, board_key, environment, items: [{resource_type, local_id, held, reason, resource, status, last_error}]}`; `POST /admin/tres/admissions/{id}/send` and `POST /admin/tres/deliveries/{id}/retry` → `{admission_id, rows: [{resource_type, local_id, status, reason}], counts}`; `GET|PUT /admin/tres/departments` (`[{unit_id, unit_name, unit_active, code, display, updated_at}]`, PUT `{departments: [{unit_id, code, display}]}`); `GET /admin/tres/practitioners`, `PUT /admin/tres/practitioners/{user_id}` (`{user_id, full_name, fin_set, family_name, given_name, updated_at}`, PUT `{fin?, family_name, given_name}`); `GET|PUT /admin/tres/settings` with `send_from`. The refusal codes and audit labels these routes use are already mapped (F1a). New files: `screens/admin/tresWords.js` (the record types — moved from `TresTab.jsx`, which re-exports them — the ledger's statuses and the catalogue's skip reasons), `TresDeliveries.jsx`, `TresDepartments.jsx`, `TresPractitioners.jsx`; nine API calls in `backendApi.js`; the panels mounted under the settings in `TresTab.jsx`.

**Tech Stack:** React 18 + Vite + vitest + Testing Library; the shell's Tailwind tokens and `ui/` components (`Box`, `Table`, `Field`, `Input`, `Select`, `Note`, `Empty`, `Modal`, `Button`, `useToast`).

**This plan's amendments** are F1a's list (its header; spec §14 records them in Task 21). Two are this half's own:
- **§8 — the panels' form.** «Önizle» opens a dialog (the bodies are long); it says, above the bodies, that the preview holds patient data and that opening it is audited. «Şimdi gönder» is reached from a stay found by its protocol number on the «Gönderimler» panel — the engine's `GET /admin/tres/admissions?key=` (F1a amendment 20).
- **§8, D27 — the build.** F1's strings take the shared i18n chunk (`Toast-*.js`) from 504.06 kB (F0) to **523.94 kB** (measured on the scratch copy). F1 does NOT split the catalogue: that is a slice of its own, and `origin/main` has split it already (`746f30a9`, «the i18n string tables in their own two chunks, no chunk over 500 kB»), so the note goes at merge. `TresTab-*.js` grows from ≈7 kB to 21.23 kB.

**Gates (measured when the plan is carried out — every `…` replaced):** baseline (F1a's head) dashboard … files / … tests · after F1b dashboard … files / … tests (expected **+2 files, +20 tests**) · build `precache  … entries`, `TresTab-*.js` … kB, shared i18n chunk … kB (500 kB note: yes — accepted, see above) · head `<sha>` · pushed: yes/no · walk on the local stack: done (what was seen) / not done (why).

---

## Ground rules

F1a's ground rules hold here word for word (worktree, never `git stash`, explicit pathspecs, foreground runs under three minutes, the dashboard's junction never touched, synthetic data only, nothing from the reference repository, the feed closed, the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, «replace this … with this» edits that STOP when the anchor does not match, «append at the end of the file», CRLF on disk). In addition:
- **Dashboard commands** run from `/c/tmp/tres/dashboard`: `./node_modules/.bin/vitest run <paths>`; the whole suite `./node_modules/.bin/vitest run`; the build `./node_modules/.bin/vite build`. A `not wrapped in act(...)` warning is not a failure. The tests run in Azerbaijani: the texts they look for are the `az` strings.
- **Texts:** every new string in four languages (`tr` the source, `az` the default); a text whose `az` equals its `tr` is listed, reviewed, in `i18n/strings.test.js` `AZ_SAME_AS_TR`, and one with no Cyrillic in `ru` in `NEUTRAL`. The `az`, `ru` and `en` texts are the planner's: they await a native reading before a hospital opens the feed (F0's N10).
- **No raw key on screen:** a status or a reason the panel does not know is shown as the engine's code, never as a translation key (`tresWords.js`); `rawKeys.test.jsx` sweeps the tab with every status and reason stubbed (Task 19).
- **Migration numbering, the merge:** unchanged from F1a (the controller renumbers 0020 at merge — 0023 by today's queue; a test of «the head» checks ancestry, never a string).

## Changes from F1a's review rounds (amendments 23–26)

F1b's tasks below were written before F1a's review rounds; F1a's header gives each change and its reason. What F1b's tasks must account for (their code blocks are not rewritten here — the task that meets one of these adds it):
- **Two more skip reasons.** `discharge_missing` (amendment 23 (10): a finished stay with no discharge time; its Encounter is skipped) and `patient_unheld` (amendment 26 (2): in `send`, a stay whose package stopped at its Patient has its Encounter row skipped with it). Task 16 adds both to `tresWords.js` `REASONS` (`tres.reason.dischargeMissing`, `tres.reason.patientUnheld`) with their words in the four languages; Task 19's raw-key sweep lists both among the reasons it stubs.
- **Three more refusal codes**, whose words F1a already carries (`apiErrors.js` `TRES_CODE_KEYS`, `strings/tres.js` `err`): `tres_throttled` (429 to «Şimdi gönder» / «Yeniden dene»; the detail carries `retry_after`, in seconds, when the platform said one — the panel may say how long to wait), `tres_other_environment` (409: «Yeniden dene» of a row of the environment not selected — the review called it `tres_environment`, which was already the settings form's 422), `tres_send_from` (422: the cut-off before 2020-01-01 or more than 366 days after the save).
- **`send_from` carries microseconds** (the first save in `send` sets it to that very moment). The settings form sends `send_from` ONLY when the user changed it — never round-tripped through a minute-precision input, which would move the cut-off by the seconds it drops on every save.
- **The preview judges as a send** (amendment 26 (4), M5): an item may carry `yielded: true` — a Patient the person's newer stay holds on the platform, shown as that stay's (`held` true, no `resource`); the dialog says so rather than showing an empty body. A type switched off shows `reason: "type_off"` and no body. Each item's `status` and `last_error` are its own row's, found by its key. The preview route's answer (the Architecture line above) gains `yielded` on each item.
- **«Şimdi gönder» on a parked tenant** answers 409 `tres_login_refused` at once, without asking the platform (amendment 26 (4), M2): the panel's parked notice at its top stands for it.
- **The vital signs' local ids** are `hmn-v-{root admission id}-{key}-{first|last}.`, keyed by the signal's stable `id_key` (amendments 23–25) — already in §14.1 below.

---

### Task 14: Baseline — F1a's head, the dashboard's numbers

- [ ] **Step 1:** Run: `cd /c/tmp/tres && git status -sb | head -3 && git log --oneline -3` — Expected: clean; the top commit F1a's last (`feat(tres-01): F1 — the ledger's list, a stay by its key, …` or a gate fix after it).
- [ ] **Step 2:** Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run 2>&1 | tail -6` — Expected: no `failed`. Write `baseline: dashboard F/T` into the Gates block.

---

### Task 15: The API client's nine calls, and the test stand-in's

**Files:**
- Modify: `dashboard/src/backendApi.js` (after `testTres()`), `dashboard/src/live/session/testTokens.testutil.js` (after `testTres: vi.fn(),`)
- Test: `dashboard/src/backendApi.test.js` (a new `describe` at the end)

- [ ] **Step 1: The test**

Append at the end of `dashboard/src/backendApi.test.js`:
```js
// TRƏS-01 F1 — the ledger, a stay, its preview, the hand and the two maps (tres/deliveries.py, tres/maps.py)
describe("TRƏS-01 F1 calls", () => {
  it("each goes to its route with its method, its query and the session's token", async () => {
    store.set("homunculus-access-token", "acc-1");
    store.set("homunculus-refresh-token", "ref-1");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    const stay = "66666666-6666-4666-8666-666666666601";
    await api.tresDeliveries();
    await api.tresDeliveries({ status: "stuck", type: "vital", admission: stay, cursor: "abc" });
    await api.tresStay("202600000101");
    await api.tresPreview(stay);
    await api.sendTresStay(stay);
    await api.retryTresDelivery("77777777-7777-4777-8777-777777777701");
    await api.tresDepartments();
    await api.saveTresDepartments([{ unit_id: "u-1", code: "RE-01", display: "Reanimasiya" }]);
    await api.tresPractitioners();
    await api.saveTresPractitioner("88888888-8888-4888-8888-888888888801", { family_name: "Sentetikov", given_name: "Elçin" });
    expect(fetchMock.mock.calls.map(([url, init]) => [String(url), init.method])).toEqual([
      ["/admin/tres/deliveries", "GET"],
      [`/admin/tres/deliveries?status=stuck&type=vital&admission=${stay}&cursor=abc`, "GET"],
      ["/admin/tres/admissions?key=202600000101", "GET"],
      [`/admin/tres/admissions/${stay}/preview`, "GET"],
      [`/admin/tres/admissions/${stay}/send`, "POST"],
      ["/admin/tres/deliveries/77777777-7777-4777-8777-777777777701/retry", "POST"],
      ["/admin/tres/departments", "GET"],
      ["/admin/tres/departments", "PUT"],
      ["/admin/tres/practitioners", "GET"],
      ["/admin/tres/practitioners/88888888-8888-4888-8888-888888888801", "PUT"],
    ]);
    expect(JSON.parse(fetchMock.mock.calls[7][1].body)).toEqual({
      departments: [{ unit_id: "u-1", code: "RE-01", display: "Reanimasiya" }] });
    expect(JSON.parse(fetchMock.mock.calls[9][1].body)).toEqual({ family_name: "Sentetikov", given_name: "Elçin" });
    for (const [, init] of fetchMock.mock.calls) expect(init.headers.Authorization).toBe("Bearer acc-1");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/backendApi.test.js 2>&1 | tail -6`
Expected: `1 failed | 149 passed` — `TypeError: api.tresDeliveries is not a function`.

- [ ] **Step 3: The calls, and the stand-in's**

In `dashboard/src/backendApi.js` replace
```js
    testTres() { return authed("/admin/tres/test", { method: "POST" }); },
    // G3-02: Görevlerim — the task queue, its writes and the hospital's settings (homunculus/api/tasks.py).
```
with
```js
    testTres() { return authed("/admin/tres/test", { method: "POST" }); },
    // TRƏS-01 F1 — the ledger, a stay, its preview, the hand (tres/deliveries.py) and the two maps (tres/maps.py).
    /** {environment, session_refused_at, items: [{id, resource_type, local_id, status, reason, attempts, operation,
     *  remote_id, next_attempt_at, updated_at, admission_id, board_key}], next} — never the platform's words. */
    tresDeliveries({ status = null, type = null, admission = null, cursor = null } = {}) {
      const q = new URLSearchParams();
      if (status) q.set("status", status);
      if (type) q.set("type", type);
      if (admission) q.set("admission", admission);
      if (cursor) q.set("cursor", cursor);
      const s = q.toString();
      return authed(`/admin/tres/deliveries${s ? `?${s}` : ""}`);
    },
    /** {admission_id, board_key, state, discharge_at}; 404 `tres_stay_unknown`. */
    tresStay(key) { return authed(`/admin/tres/admissions?${new URLSearchParams({ key })}`); },
    /** {admission_id, board_key, environment, items: [{resource_type, local_id, held, reason, resource, status,
     *  last_error}]} — the bodies: PHI, and the read is audited (tres.preview). */
    tresPreview(admissionId) { return authed(`/admin/tres/admissions/${seg(admissionId)}/preview`); },
    /** «Şimdi gönder»: {admission_id, rows: [{resource_type, local_id, status, reason}], counts}. 409 `tres_busy`… */
    sendTresStay(admissionId) { return authed(`/admin/tres/admissions/${seg(admissionId)}/send`, { method: "POST" }); },
    /** «Yeniden dene»: as sendTresStay, the row's stay forced. */
    retryTresDelivery(id) { return authed(`/admin/tres/deliveries/${seg(id)}/retry`, { method: "POST" }); },
    /** [{unit_id, unit_name, unit_active, code, display, updated_at}] */
    tresDepartments() { return authed("/admin/tres/departments"); },
    /** The whole map: [{unit_id, code, display}] — a unit left out is unmapped. → as tresDepartments() */
    saveTresDepartments(departments) { return authed("/admin/tres/departments", { method: "PUT", body: { departments } }); },
    /** [{user_id, full_name, fin_set, family_name, given_name, updated_at}] — never a FİN. */
    tresPractitioners() { return authed("/admin/tres/practitioners"); },
    /** {fin?, family_name, given_name}: `fin` left out keeps the stored one, "" clears it. → one item as above */
    saveTresPractitioner(userId, body) {
      return authed(`/admin/tres/practitioners/${seg(userId)}`, { method: "PUT", body });
    },
    // G3-02: Görevlerim — the task queue, its writes and the hospital's settings (homunculus/api/tasks.py).
```

In `dashboard/src/live/session/testTokens.testutil.js` replace
```js
    testTres: vi.fn(),
    // G2-B1c: the patient screen's «Bakım ekibi» box and its dialog
```
with
```js
    testTres: vi.fn(),
    // TRƏS-01 F1: the panels «Gönderimler», «Bölüm eşleme», «Hekim kimlikleri» (screens/admin/Tres*.jsx)
    tresDeliveries: vi.fn(),
    tresStay: vi.fn(),
    tresPreview: vi.fn(),
    sendTresStay: vi.fn(),
    retryTresDelivery: vi.fn(),
    tresDepartments: vi.fn(),
    saveTresDepartments: vi.fn(),
    tresPractitioners: vi.fn(),
    saveTresPractitioner: vi.fn(),
    // G2-B1c: the patient screen's «Bakım ekibi» box and its dialog
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/backendApi.test.js 2>&1 | tail -4`
Expected: `150 passed`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/tres && git add dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/session/testTokens.testutil.js && git commit -m "feat(api-client): TRƏS-01 F1 — the ledger, a stay by its key, its preview, send and retry, the two maps; their mocks in the test stand-in" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: The words — `tresWords.js`, the panels' strings in four languages

The record types move from `TresTab.jsx` to `tresWords.js` (which the panels import without importing the tab); the tab re-exports them, so its tests and imports stay as they are. The statuses and skip reasons map to keys, and an unknown one shows as the engine's code.

**Files:**
- Create: `dashboard/src/live/screens/admin/tresWords.js`
- Modify: `dashboard/src/live/screens/admin/TresTab.jsx` (the import of `TYPES`), `dashboard/src/live/i18n/strings/tres.js` (a block before each language's `err: {`, and the header comment)
- Test: `dashboard/src/live/i18n/strings.test.js` (the reviewed lists)

- [ ] **Step 1: The reviewed lists first**

In `dashboard/src/live/i18n/strings.test.js` replace
```js
  "devir.fromTo", //               "{from} → {to}" — no word in it
```
with
```js
  "devir.fromTo", //               "{from} → {to}" — no word in it

  // TRƏS-01 F1 (tres) · neutral — the national identity number's own name, written FİN in every language
  "tres.practitioners.fin",
```

In `dashboard/src/live/i18n/strings.test.js` replace
```js
  "eczane.fluid.balance", //   "{value} mL" — a number and the unit symbol (as sivi.ml)

]);
```
with
```js
  "eczane.fluid.balance", //   "{value} mL" — a number and the unit symbol (as sivi.ml)

  // TRƏS-01 F1 (tres) · az = tr — the planner's reading, awaiting the native one (plan F1, N10)
  "tres.practitioners.fin", //    FİN — the identity number's own name (NEUTRAL above)
  "tres.practitioners.family", // Soyad — the same word in Azerbaijani (surname)
  "tres.practitioners.given", //  Ad — the same word in Azerbaijani (given name)
  "tres.deliveries.found", //     "Yatış {key} · {when}" — «yatış» is the word the tab uses in both languages
  "tres.status.deleted", //      Silindi — the same verb, the same past tense, in Azerbaijani

]);
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/i18n/strings.test.js 2>&1 | tail -6`
Expected: `1 failed` — `tres.practitioners.fin is listed but no longer exists`.

- [ ] **Step 3: The words**

Create `dashboard/src/live/screens/admin/tresWords.js`:
```js
// src/live/screens/admin/tresWords.js — TRƏS-01: the national feed's vocabulary as the tab says it — the eight record
// types (moved here from TresTab.jsx in phase F1, which re-exports them), the ledger's statuses and the catalogue's skip
// reasons (homunculus-engine tres/models.py STATUSES, tres/az.py and tres/mapping/*). A status or a reason the map does
// not name is shown as the engine's code, never as a raw translation key.

/** The eight record types, in the package's order (the engine's `tres/models.py` RESOURCE_TYPES), with their labels. */
export const TYPES = Object.freeze([
  ["patient", "tres.type.patient"], ["practitioner", "tres.type.practitioner"], ["encounter", "tres.type.encounter"],
  ["condition", "tres.type.condition"], ["procedure", "tres.type.procedure"], ["vital", "tres.type.vital"],
  ["lab", "tres.type.lab"], ["composition", "tres.type.composition"],
]);

/** The ledger's statuses (tres/models.py STATUSES), in its order. */
export const STATUSES = Object.freeze([
  ["pending", "tres.status.pending"], ["sent", "tres.status.sent"], ["validated", "tres.status.validated"],
  ["failed", "tres.status.failed"], ["skipped", "tres.status.skipped"], ["stuck", "tres.status.stuck"],
  ["deleted", "tres.status.deleted"],
]);

/** The catalogue's skip reasons of phase F1 (tres/az.py, tres/mapping/*, tres/package.py, tres/worker.py). */
export const REASONS = new Map([
  ["fin_missing", "tres.reason.finMissing"], ["fin_format", "tres.reason.finFormat"],
  ["name_single", "tres.reason.nameSingle"], ["father_name_missing", "tres.reason.fatherNameMissing"],
  ["sex_unmapped", "tres.reason.sexUnmapped"], ["birth_date_invalid", "tres.reason.birthDateInvalid"],
  ["identity_missing", "tres.reason.identityMissing"], ["name_missing", "tres.reason.nameMissing"],
  ["unit_unmapped", "tres.reason.unitUnmapped"], ["organization_missing", "tres.reason.organizationMissing"],
  ["timezone_unknown", "tres.reason.timezoneUnknown"], ["no_reference", "tres.reason.noReference"],
  ["type_off", "tres.reason.typeOff"],
]);

const TYPE_KEYS = new Map(TYPES);
const STATUS_KEYS = new Map(STATUSES);

export const typeLabel = (t, type) => (TYPE_KEYS.has(type) ? t(TYPE_KEYS.get(type)) : String(type ?? ""));
export const statusLabel = (t, status) => (STATUS_KEYS.has(status) ? t(STATUS_KEYS.get(status)) : String(status ?? ""));
export const reasonLabel = (t, reason) => (reason == null ? "" : REASONS.has(reason) ? t(REASONS.get(reason)) : String(reason));
```

In `dashboard/src/live/screens/admin/TresTab.jsx` replace
```jsx
import { refusedFor } from "./refusal.js";

/** The eight record types, in the package's order (the engine's `tres/models.py` RESOURCE_TYPES), with their labels. */
export const TYPES = Object.freeze([
  ["patient", "tres.type.patient"], ["practitioner", "tres.type.practitioner"], ["encounter", "tres.type.encounter"],
  ["condition", "tres.type.condition"], ["procedure", "tres.type.procedure"], ["vital", "tres.type.vital"],
  ["lab", "tres.type.lab"], ["composition", "tres.type.composition"],
]);
export const MODES = Object.freeze([["off", "tres.modeOff"], ["validate", "tres.modeValidate"], ["send", "tres.modeSend"]]);
```
with
```jsx
import { refusedFor } from "./refusal.js";
import { TYPES } from "./tresWords.js";

export { TYPES };
export const MODES = Object.freeze([["off", "tres.modeOff"], ["validate", "tres.modeValidate"], ["send", "tres.modeSend"]]);
```

In `dashboard/src/live/i18n/strings/tres.js` replace
```js
// (screens/admin/TresTab.jsx) — the two locks, the mode, the environment, the two accounts, the
// record types — and the words of the routes' coded refusals (apiErrors.js `TRES_CODE_KEYS`). Later
// phases add their panels' words here (deliveries, the department map, the practitioner identities).
//
```
with
```js
// (screens/admin/TresTab.jsx) — the two locks, the mode, the environment, the two accounts, the
// record types — and the words of the routes' coded refusals (apiErrors.js `TRES_CODE_KEYS`). Phase F1 adds
// the cut-off and the live note, the ledger's statuses and skip reasons, and its three panels' words
// («Gönderimler», «Bölüm eşleme», «Hekim kimlikleri»).
//
```

In `dashboard/src/live/i18n/strings/tres.js` replace
```js
      baseUrl: "Adres https:// ile başlamalı.",
    },
```
with
```js
      baseUrl: "Adres https:// ile başlamalı.",
    },
    sendFrom: "Otomatik gönderimin başlangıcı",
    sendFromHint: "Yalnız bu andan sonra taburcu olan yatışlar kendiliğinden gönderilir; daha öncekiler yalnız «Şimdi gönder» ile. «Gönder» ilk kez seçildiğinde o an yazılır. (Önerilen kural: sahibinin onayını bekliyor.)",
    sendFromUnset: "Henüz «Gönder» seçilmedi: otomatik gönderimin başlangıcı yok.",
    liveNote: "Canlı platforma hasta verisi gönderimi bu sürümde kapalı: canlı ortam için yalnız «Kapalı» kip kaydedilir.",
    status: {
      pending: "Bekliyor", sent: "Gönderildi", validated: "Doğrulandı", failed: "Reddedildi", skipped: "Atlandı",
      stuck: "Takıldı", deleted: "Silindi",
    },
    reason: {
      finMissing: "FİN girilmemiş", finFormat: "FİN biçimi geçersiz", nameSingle: "Ad tek sözcük (soyad ve ad ayrılamıyor)",
      fatherNameMissing: "Baba adı girilmemiş", sexUnmapped: "Cinsiyet platformun kodlarında yok",
      birthDateInvalid: "Doğum tarihi okunamıyor", identityMissing: "Hekimin TRƏS kimliği girilmemiş",
      nameMissing: "Hekimin soyadı ya da adı eksik", unitUnmapped: "Birim bir bölüme eşlenmemiş",
      organizationMissing: "Kurum kimliği girilmemiş", timezoneUnknown: "Hastanenin saat dilimi sunucuda bilinmiyor",
      noReference: "Doğrulanamadı: başvurduğu kayıt platformda yok", typeOff: "Bu kayıt türü kapalı",
    },
    deliveries: {
      title: "Gönderimler",
      sub: "Her kaynağın son durumu, en son değişen en üstte. Platformun mesajları yalnız önizlemede görünür.",
      loading: "Gönderimler yükleniyor…",
      readFailed: "Gönderimler okunamadı: {reason}",
      empty: "Bu ortamda henüz gönderim kaydı yok.",
      parked: "Platform bu hastanenin girişini reddetti ({time}): hesap düzeltilip kaydedilene ya da bağlantı sınaması başarılı olana kadar otomatik gönderim durur.",
      filterStatus: "Durum", filterType: "Kayıt türü", all: "Tümü",
      caption: "Gönderim defteri",
      when: "Değişiklik", type: "Tür", key: "Protokol no", status: "Durum", reason: "Neden", attempts: "Deneme", actions: "İşlem",
      more: "Daha fazla",
      retry: "Yeniden dene", retried: "Yeniden denendi: {count} kayıt işlendi.",
      preview: "Önizle",
      findLabel: "Protokol numarası", find: "Yatışı bul", found: "Yatış {key} · {when}", discharged: "taburcu {time}", stillAdmitted: "taburcu edilmedi",
      sendNow: "Şimdi gönder", sent: "Gönderildi: {count} kayıt işlendi.",
      previewTitle: "Gönderim önizlemesi · {key}",
      previewNote: "Önizleme hasta verisi içerir; açılması denetim kaydına yazılır.",
      held: "platformda", notHeld: "henüz platformda değil", lastError: "Platformun son mesajı: {words}",
    },
    departments: {
      title: "Bölüm eşleme",
      sub: "Her birimin platformdaki bölüm kodu ve adı (hospital-departments). Eşlenmemiş birimin yatışları gönderilmez.",
      loading: "Birimler yükleniyor…",
      readFailed: "Bölüm eşlemesi okunamadı: {reason}",
      caption: "Birim ve bölüm eşlemesi",
      unit: "Birim", code: "Bölüm kodu", display: "Bölüm adı", closed: "(kapalı)",
      invalid: "Kod ve ad birlikte yazılır ya da birlikte boş bırakılır.",
      save: "Eşlemeyi kaydet", saved: "Bölüm eşlemesi kaydedildi.",
    },
    practitioners: {
      title: "Hekim kimlikleri",
      sub: "Platform her hekimi FİN'i ve adıyla tanır. Kimliği girilmemiş hekim yatış kaydına eklenmez.",
      loading: "Hekimler yükleniyor…",
      readFailed: "Hekim kimlikleri okunamadı: {reason}",
      empty: "Bu hastanede hekim yok.",
      caption: "Hekimlerin TRƏS kimlikleri",
      name: "Hesap", fin: "FİN", finStored: "kayıtlı", finClear: "Kayıtlı FİN'i sil", family: "Soyad", given: "Ad",
      invalid: "FİN 7 Latin büyük harf ya da rakamdır; soyad ve ad gereklidir.",
      save: "Kaydet", saved: "{name}: kimlik kaydedildi.",
    },
```

In `dashboard/src/live/i18n/strings/tres.js` replace
```js
      baseUrl: "Ünvan https:// ilə başlamalıdır.",
    },
    err: {
      mode: "Rejim etibarsızdır.",
```
with
```js
      baseUrl: "Ünvan https:// ilə başlamalıdır.",
    },
    sendFrom: "Avtomatik göndərişin başlanğıcı",
    sendFromHint: "Yalnız bu andan sonra evə yazılan yatışlar avtomatik göndərilir; daha əvvəlkilər yalnız «İndi göndər» ilə. «Göndər» ilk dəfə seçiləndə o an yazılır. (Təklif olunan qayda: sahibinin təsdiqini gözləyir.)",
    sendFromUnset: "«Göndər» hələ seçilməyib: avtomatik göndərişin başlanğıcı yoxdur.",
    liveNote: "Canlı platformaya xəstə məlumatlarının göndərilməsi bu versiyada bağlıdır: canlı mühit üçün yalnız «Bağlı» rejimi yadda saxlanılır.",
    status: {
      pending: "Gözləyir", sent: "Göndərildi", validated: "Yoxlanıldı", failed: "Rədd edildi", skipped: "Ötürüldü",
      stuck: "İlişib qaldı", deleted: "Silindi",
    },
    reason: {
      finMissing: "FİN daxil edilməyib", finFormat: "FİN formatı etibarsızdır", nameSingle: "Ad bir sözdür (soyad və ad ayrılmır)",
      fatherNameMissing: "Ata adı daxil edilməyib", sexUnmapped: "Cins platformanın kodlarında yoxdur",
      birthDateInvalid: "Doğum tarixi oxunmur", identityMissing: "Həkimin TRƏS identifikasiyası daxil edilməyib",
      nameMissing: "Həkimin soyadı və ya adı yoxdur", unitUnmapped: "Bölmə şöbəyə uyğunlaşdırılmayıb",
      organizationMissing: "Müəssisənin identifikatoru daxil edilməyib", timezoneUnknown: "Xəstəxananın saat qurşağı serverdə məlum deyil",
      noReference: "Yoxlanılmadı: istinad etdiyi qeyd platformada yoxdur", typeOff: "Bu qeyd növü bağlıdır",
    },
    deliveries: {
      title: "Göndərişlər",
      sub: "Hər mənbənin son vəziyyəti, ən son dəyişən ən yuxarıda. Platformanın mesajları yalnız ilkin baxışda görünür.",
      loading: "Göndərişlər yüklənir…",
      readFailed: "Göndərişlər oxunmadı: {reason}",
      empty: "Bu mühitdə hələ göndəriş qeydi yoxdur.",
      parked: "Platforma bu xəstəxananın girişini rədd etdi ({time}): hesab düzəldilib yadda saxlanılana və ya bağlantı yoxlaması uğurlu olana qədər avtomatik göndəriş dayanır.",
      filterStatus: "Vəziyyət", filterType: "Qeyd növü", all: "Hamısı",
      caption: "Göndəriş jurnalı",
      when: "Dəyişiklik", type: "Növ", key: "Protokol №", status: "Vəziyyət", reason: "Səbəb", attempts: "Cəhd", actions: "Əməliyyat",
      more: "Daha çox",
      retry: "Yenidən cəhd et", retried: "Yenidən cəhd edildi: {count} qeyd işləndi.",
      preview: "İlkin baxış",
      findLabel: "Protokol nömrəsi", find: "Yatışı tap", found: "Yatış {key} · {when}", discharged: "evə yazılıb {time}", stillAdmitted: "evə yazılmayıb",
      sendNow: "İndi göndər", sent: "Göndərildi: {count} qeyd işləndi.",
      previewTitle: "Göndərişin ilkin baxışı · {key}",
      previewNote: "İlkin baxış xəstə məlumatlarını ehtiva edir; açılması audit jurnalına yazılır.",
      held: "platformadadır", notHeld: "hələ platformada deyil", lastError: "Platformanın son mesajı: {words}",
    },
    departments: {
      title: "Şöbə uyğunlaşdırması",
      sub: "Hər bölmənin platformadakı şöbə kodu və adı (hospital-departments). Uyğunlaşdırılmamış bölmənin yatışları göndərilmir.",
      loading: "Bölmələr yüklənir…",
      readFailed: "Şöbə uyğunlaşdırması oxunmadı: {reason}",
      caption: "Bölmə və şöbə uyğunlaşdırması",
      unit: "Bölmə", code: "Şöbə kodu", display: "Şöbənin adı", closed: "(bağlı)",
      invalid: "Kod və ad birlikdə yazılır və ya birlikdə boş saxlanılır.",
      save: "Uyğunlaşdırmanı yadda saxla", saved: "Şöbə uyğunlaşdırması yadda saxlanıldı.",
    },
    practitioners: {
      title: "Həkim identifikasiyaları",
      sub: "Platforma hər həkimi FİN-i və adı ilə tanıyır. İdentifikasiyası daxil edilməyən həkim yatış qeydinə əlavə olunmur.",
      loading: "Həkimlər yüklənir…",
      readFailed: "Həkim identifikasiyaları oxunmadı: {reason}",
      empty: "Bu xəstəxanada həkim yoxdur.",
      caption: "Həkimlərin TRƏS identifikasiyaları",
      name: "Hesab", fin: "FİN", finStored: "qeyd olunub", finClear: "Qeyd olunmuş FİN-i sil", family: "Soyad", given: "Ad",
      invalid: "FİN 7 latın böyük hərfi və ya rəqəmdir; soyad və ad tələb olunur.",
      save: "Yadda saxla", saved: "{name}: identifikasiya yadda saxlanıldı.",
    },
    err: {
      mode: "Rejim etibarsızdır.",
```

In `dashboard/src/live/i18n/strings/tres.js` replace
```js
      baseUrl: "Адрес должен начинаться с https://.",
    },
```
with
```js
      baseUrl: "Адрес должен начинаться с https://.",
    },
    sendFrom: "Начало автоматической отправки",
    sendFromHint: "Автоматически отправляются только госпитализации, выписанные после этого момента; более ранние — только кнопкой «Отправить сейчас». Записывается в момент, когда впервые выбран режим «Отправлять». (Предлагаемое правило: ждёт решения владельца.)",
    sendFromUnset: "Режим «Отправлять» ещё не выбирался: начала автоматической отправки нет.",
    liveNote: "Передача данных пациентов на рабочую платформу в этой версии закрыта: для рабочей среды сохраняется только режим «Выключено».",
    status: {
      pending: "Ожидает", sent: "Отправлено", validated: "Проверено", failed: "Отклонено", skipped: "Пропущено",
      stuck: "Застряло", deleted: "Удалено",
    },
    reason: {
      finMissing: "FİN не указан", finFormat: "Неверный формат FİN", nameSingle: "Имя из одного слова (фамилию и имя не разделить)",
      fatherNameMissing: "Отчество не указано", sexUnmapped: "Пол не входит в коды платформы",
      birthDateInvalid: "Дата рождения не читается", identityMissing: "Данные врача для TRƏS не введены",
      nameMissing: "Нет фамилии или имени врача", unitUnmapped: "Подразделение не сопоставлено с отделением",
      organizationMissing: "Идентификатор организации не указан", timezoneUnknown: "Часовой пояс больницы неизвестен серверу",
      noReference: "Не проверено: запись, на которую он ссылается, отсутствует на платформе", typeOff: "Этот вид записей выключен",
    },
    deliveries: {
      title: "Отправки",
      sub: "Последнее состояние каждого ресурса, недавно изменённые сверху. Сообщения платформы видны только в предпросмотре.",
      loading: "Отправки загружаются…",
      readFailed: "Не удалось прочитать отправки: {reason}",
      empty: "В этой среде записей об отправке пока нет.",
      parked: "Платформа отклонила вход этой больницы ({time}): автоматическая отправка остановлена, пока учётная запись не будет исправлена и сохранена или проверка соединения не пройдёт успешно.",
      filterStatus: "Состояние", filterType: "Вид записи", all: "Все",
      caption: "Журнал отправок",
      when: "Изменение", type: "Вид", key: "№ протокола", status: "Состояние", reason: "Причина", attempts: "Попытки", actions: "Действие",
      more: "Ещё",
      retry: "Повторить", retried: "Повторено: обработано записей — {count}.",
      preview: "Предпросмотр",
      findLabel: "Номер протокола", find: "Найти госпитализацию", found: "Госпитализация {key} · {when}", discharged: "выписка {time}", stillAdmitted: "не выписан",
      sendNow: "Отправить сейчас", sent: "Отправлено: обработано записей — {count}.",
      previewTitle: "Предпросмотр отправки · {key}",
      previewNote: "Предпросмотр содержит данные пациента; его открытие записывается в журнал аудита.",
      held: "на платформе", notHeld: "ещё не на платформе", lastError: "Последнее сообщение платформы: {words}",
    },
    departments: {
      title: "Сопоставление отделений",
      sub: "Код и название отделения на платформе для каждого подразделения (hospital-departments). Госпитализации несопоставленного подразделения не отправляются.",
      loading: "Подразделения загружаются…",
      readFailed: "Не удалось прочитать сопоставление отделений: {reason}",
      caption: "Сопоставление подразделений и отделений",
      unit: "Подразделение", code: "Код отделения", display: "Название отделения", closed: "(закрыто)",
      invalid: "Код и название заполняются вместе или вместе остаются пустыми.",
      save: "Сохранить сопоставление", saved: "Сопоставление отделений сохранено.",
    },
    practitioners: {
      title: "Данные врачей",
      sub: "Платформа узнаёт каждого врача по FİN и имени. Врач без введённых данных не добавляется в запись о госпитализации.",
      loading: "Врачи загружаются…",
      readFailed: "Не удалось прочитать данные врачей: {reason}",
      empty: "В этой больнице нет врачей.",
      caption: "Данные врачей для TRƏS",
      name: "Учётная запись", fin: "FİN", finStored: "сохранён", finClear: "Удалить сохранённый FİN", family: "Фамилия", given: "Имя",
      invalid: "FİN — это 7 заглавных латинских букв или цифр; фамилия и имя обязательны.",
      save: "Сохранить", saved: "{name}: данные сохранены.",
    },
```

In `dashboard/src/live/i18n/strings/tres.js` replace
```js
      baseUrl: "The address must start with https://.",
    },
    err: {
      mode: "The mode is not valid.",
```
with
```js
      baseUrl: "The address must start with https://.",
    },
    sendFrom: "Automatic sending starts at",
    sendFromHint: "Only stays discharged after this moment are sent automatically; earlier ones only with «Send now». It is set when «Send» is first chosen. (A proposed rule: awaiting the owner's word.)",
    sendFromUnset: "«Send» has not been chosen yet: automatic sending has no start.",
    liveNote: "Sending patient data to the live platform is closed in this version: for the live environment, only the mode «Off» is saved.",
    status: {
      pending: "Pending", sent: "Sent", validated: "Validated", failed: "Refused", skipped: "Skipped",
      stuck: "Stuck", deleted: "Deleted",
    },
    reason: {
      finMissing: "No FİN entered", finFormat: "The FİN's format is not valid", nameSingle: "The name is one word (family and given name cannot be told apart)",
      fatherNameMissing: "No father's name entered", sexUnmapped: "The sex has no code on the platform",
      birthDateInvalid: "The birth date cannot be read", identityMissing: "The practitioner's TRƏS identity is not entered",
      nameMissing: "The practitioner's family or given name is missing", unitUnmapped: "The unit is not mapped to a department",
      organizationMissing: "No organization id entered", timezoneUnknown: "The hospital's time zone is not known to the server",
      noReference: "Not validated: what it refers to is not on the platform", typeOff: "This record type is switched off",
    },
    deliveries: {
      title: "Deliveries",
      sub: "The latest state of each resource, the most recently changed first. The platform's messages are shown only in the preview.",
      loading: "Loading the deliveries…",
      readFailed: "The deliveries could not be read: {reason}",
      empty: "No delivery has been recorded in this environment yet.",
      parked: "The platform refused this hospital's login ({time}): automatic sending stops until the account is corrected and saved, or a connection test succeeds.",
      filterStatus: "Status", filterType: "Record type", all: "All",
      caption: "Delivery ledger",
      when: "Changed", type: "Type", key: "Protocol no", status: "Status", reason: "Reason", attempts: "Attempts", actions: "Action",
      more: "More",
      retry: "Retry", retried: "Retried: {count} records handled.",
      preview: "Preview",
      findLabel: "Protocol number", find: "Find the stay", found: "Stay {key} · {when}", discharged: "discharged {time}", stillAdmitted: "not discharged",
      sendNow: "Send now", sent: "Sent: {count} records handled.",
      previewTitle: "Send preview · {key}",
      previewNote: "The preview holds patient data; opening it is written to the audit trail.",
      held: "on the platform", notHeld: "not yet on the platform", lastError: "The platform's last message: {words}",
    },
    departments: {
      title: "Department map",
      sub: "Each unit's department code and name on the platform (hospital-departments). The stays of an unmapped unit are not sent.",
      loading: "Loading the units…",
      readFailed: "The department map could not be read: {reason}",
      caption: "Units and their departments",
      unit: "Unit", code: "Department code", display: "Department name", closed: "(closed)",
      invalid: "The code and the name are filled in together, or left empty together.",
      save: "Save the map", saved: "The department map was saved.",
    },
    practitioners: {
      title: "Practitioner identities",
      sub: "The platform knows each practitioner by FİN and name. A practitioner without an identity is not added to a stay's record.",
      loading: "Loading the practitioners…",
      readFailed: "The practitioner identities could not be read: {reason}",
      empty: "This hospital has no practitioners.",
      caption: "Practitioners' TRƏS identities",
      name: "Account", fin: "FİN", finStored: "stored", finClear: "Remove the stored FİN", family: "Family name", given: "Given name",
      invalid: "A FİN is 7 Latin capital letters or digits; the family and the given name are required.",
      save: "Save", saved: "{name}: identity saved.",
    },
    err: {
      mode: "The mode is not valid.",
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/i18n/strings.test.js src/live/screens/admin/TresTab.test.jsx 2>&1 | tail -4`
Expected: `32 passed` (the tab's 22 unchanged).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/tres && git add dashboard/src/live/screens/admin/tresWords.js dashboard/src/live/screens/admin/TresTab.jsx dashboard/src/live/i18n/strings/tres.js dashboard/src/live/i18n/strings.test.js && git commit -m "feat(i18n): TRƏS-01 F1 — the ledger's statuses and skip reasons, the cut-off, the live note and the three panels' words in four languages; the record types in tresWords.js" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: «Gönderimler» — `TresDeliveries.jsx`

**Files:**
- Create: `dashboard/src/live/screens/admin/TresDeliveries.jsx`
- Test: `dashboard/src/live/screens/admin/TresDeliveries.test.jsx`

- [ ] **Step 1: The tests**

Create `dashboard/src/live/screens/admin/TresDeliveries.test.jsx`:
```jsx
// src/live/screens/admin/TresDeliveries.test.jsx — Yönetim › TRƏS › «Gönderimler» (TRƏS-01 · F1, spec §6, D9, D21, D25;
// plan F1, N12, N15): the ledger in the catalogue's words and never the platform's; a parked feed said at the top; the
// filters and «Daha çox» read again; a stay found by its protocol number and sent now; a refusal by its code;
// «Yenidən cəhd et» only on a refused or stuck row; the preview's dialog. Synthetic stays only.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { settle, toasts } from "../kabul/kabul.testutil.js";
import { TresDeliveries } from "./TresDeliveries.jsx";

const PERMS = ["tres.manage"];
const STAY = "66666666-6666-4666-8666-666666666601";
const row = (id, over = {}) => ({ id, resource_type: "patient", local_id: `hmn-p-${id}.`, status: "sent", reason: null,
  attempts: 0, operation: "create", remote_id: "7001", next_attempt_at: null, updated_at: "2026-11-11T08:00:00Z",
  admission_id: STAY, board_key: "202600000101", ...over });
const PAGE = { environment: "test", session_refused_at: null, next: null, items: [
  row("r1"), row("r2", { resource_type: "encounter", status: "skipped", reason: "unit_unmapped" }),
  row("r3", { resource_type: "vital", status: "stuck", attempts: 5, remote_id: null })] };

async function mounted(setup) {
  const m = await mount(<TresDeliveries />, { access: token({ perms: PERMS }), me: profile({ perms: PERMS }), setup });
  await settle();
  return m;
}
const click = async (el) => {
  await act(async () => { fireEvent.click(el); });
  await settle();
};
const shown = (text) => toasts().getAllByText(text).filter((el) => el.closest("[data-toast]"));
const table = () => within(screen.getByRole("table"));

describe("TresDeliveries — the list", () => {
  it("says each row in the catalogue's words, the stay's number, and no platform words", async () => {
    const { api } = await mounted((a) => a.tresDeliveries.mockResolvedValue(PAGE));
    expect(api.tresDeliveries).toHaveBeenCalledWith({ status: null, type: null, cursor: null });
    expect(table().getAllByText("202600000101")).toHaveLength(3);
    expect(table().getByText("Bölmə şöbəyə uyğunlaşdırılmayıb")).toBeInTheDocument();
    expect(table().getByText("İlişib qaldı")).toBeInTheDocument();
    expect(table().getAllByText("Göndərildi")).toHaveLength(1);
    expect(screen.queryByText(/Platforma bu xəstəxananın girişini rədd etdi/)).toBeNull();
  });

  it("says a parked feed at the top (N15)", async () => {
    await mounted((a) => a.tresDeliveries.mockResolvedValue({ ...PAGE, session_refused_at: "2026-11-11T07:00:00Z" }));
    expect(screen.getByText(/^Platforma bu xəstəxananın girişini rədd etdi/)).toBeInTheDocument();
  });

  it("reads again on a filter, and reads the next page by its cursor", async () => {
    const { api } = await mounted((a) => a.tresDeliveries
      .mockResolvedValueOnce({ ...PAGE, next: "c-2" })
      .mockResolvedValueOnce({ ...PAGE, next: null, items: [row("r4")] })
      .mockResolvedValue({ ...PAGE, items: [row("r3", { status: "stuck" })] }));
    await click(screen.getByRole("button", { name: "Daha çox" }));
    expect(api.tresDeliveries).toHaveBeenLastCalledWith({ status: null, type: null, cursor: "c-2" });
    expect(table().getAllByRole("row")).toHaveLength(5);                       // the header and four rows
    expect(screen.queryByRole("button", { name: "Daha çox" })).toBeNull();
    await act(async () => { fireEvent.change(screen.getByLabelText(/^Vəziyyət/), { target: { value: "stuck" } }); });
    await settle();
    expect(api.tresDeliveries).toHaveBeenLastCalledWith({ status: "stuck", type: null, cursor: null });
  });

  it("says when the ledger could not be read", async () => {
    await mounted((a) => a.tresDeliveries.mockRejectedValue(refusal(503, "down")));
    expect(screen.getByText(/^Göndərişlər oxunmadı: /)).toBeInTheDocument();
  });
});

describe("TresDeliveries — the hand", () => {
  it("finds a stay by its protocol number and sends it now", async () => {
    const { api } = await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.tresStay.mockResolvedValue({ admission_id: STAY, board_key: "202600000101", state: "ACTIVE", discharge_at: null });
      a.sendTresStay.mockResolvedValue({ admission_id: STAY, counts: {}, rows: [
        { resource_type: "patient", local_id: "hmn-p-1.", status: "sent", reason: null },
        { resource_type: "encounter", local_id: "hmn-e-1.", status: "sent", reason: null }] });
    });
    fireEvent.change(screen.getByLabelText(/^Protokol nömrəsi/), { target: { value: " 202600000101 " } });
    await click(screen.getByRole("button", { name: "Yatışı tap" }));
    expect(api.tresStay).toHaveBeenCalledWith("202600000101");
    expect(screen.getByText("Yatış 202600000101 · evə yazılmayıb")).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "İndi göndər" }));
    expect(api.sendTresStay).toHaveBeenCalledWith(STAY);
    expect(shown("Göndərildi: 2 qeyd işləndi.")).toHaveLength(1);
    expect(api.tresDeliveries).toHaveBeenCalledTimes(2);                        // read again after the send
  });

  it("says a refusal by its code — a round holding the stay is «busy» (N12)", async () => {
    await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.tresStay.mockResolvedValue({ admission_id: STAY, board_key: "202600000101", state: "DISCHARGED",
        discharge_at: "2026-11-06T11:00:00Z" });
      a.sendTresStay.mockRejectedValue(refusal(409, "A round is sending this stay right now.", { apiCode: "tres_busy" }));
    });
    fireEvent.change(screen.getByLabelText(/^Protokol nömrəsi/), { target: { value: "202600000101" } });
    await click(screen.getByRole("button", { name: "Yatışı tap" }));
    await click(screen.getByRole("button", { name: "İndi göndər" }));
    expect(toasts().getAllByText(/Bu yatış hazırda avtomatik dövrədə göndərilir/).length).toBeGreaterThan(0);
  });

  it("offers «Yenidən cəhd et» on a refused or stuck row only, and retries it", async () => {
    const { api } = await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.retryTresDelivery.mockResolvedValue({ admission_id: STAY, counts: {}, rows: [] });
    });
    const retries = table().getAllByRole("button", { name: "Yenidən cəhd et" });
    expect(retries).toHaveLength(1);                                            // the stuck vital alone
    await click(retries[0]);
    expect(api.retryTresDelivery).toHaveBeenCalledWith("r3");
    expect(shown("Yenidən cəhd edildi: 0 qeyd işləndi.")).toHaveLength(1);
  });

  it("opens the preview with its note, each resource and the platform's last words", async () => {
    const { api } = await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.tresPreview.mockResolvedValue({ admission_id: STAY, board_key: "202600000101", environment: "test", items: [
        { resource_type: "patient", local_id: "hmn-p-1.", held: true, reason: null, status: "sent", last_error: null,
          resource: { resourceType: "Patient", birthDate: "1980-01-31" } },
        { resource_type: "encounter", local_id: "hmn-e-1.", held: false, reason: "unit_unmapped", status: "failed",
          last_error: "Encounter.serviceType: minimum required = 1", resource: null }] });
    });
    await click(table().getAllByRole("button", { name: "İlkin baxış" })[0]);
    expect(api.tresPreview).toHaveBeenCalledWith(STAY);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Göndərişin ilkin baxışı · 202600000101")).toBeInTheDocument();
    expect(dialog.getByText(/^İlkin baxış xəstə məlumatlarını ehtiva edir/)).toBeInTheDocument();
    expect(dialog.getByText(/"birthDate": "1980-01-31"/)).toBeInTheDocument();
    expect(dialog.getByText("Platformanın son mesajı: Encounter.serviceType: minimum required = 1")).toBeInTheDocument();
    await click(dialog.getByRole("button", { name: "Bağla" }));          // the dialog's own close
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/screens/admin/TresDeliveries.test.jsx 2>&1 | tail -6`
Expected: `Test Files  1 failed` — `Failed to resolve import "./TresDeliveries.jsx"`.

- [ ] **Step 3: The panel**

Create `dashboard/src/live/screens/admin/TresDeliveries.jsx`:
```jsx
// src/live/screens/admin/TresDeliveries.jsx — Yönetim › TRƏS › «Gönderimler» (TRƏS-01 · phase F1, spec §6, §8, D9, D21,
// D25; plan F1, N15): the ledger, a stay found by its protocol number, «Şimdi gönder», «Yeniden dene» and the preview.
//
// THE LIST carries no platform words (the engine leaves `last_error` out): a row says its type, its stay's protocol
// number, its status, its skip reason in the catalogue's words and its attempts. A PARKED feed (the platform refused the
// login) is said at the top, as on the settings above (N15). «Daha fazla» reads the next page by the answer's cursor.
//
// THE HAND. «Yatışı bul» reads one stay by its protocol number; «Şimdi gönder» sends its package now, «Önizle» shows
// what would be sent. «Yeniden dene» stands on a refused or stuck row: the engine forces its stay's package (D21). A
// refusal is said by its code (apiErrors.js `TRES_CODE_KEYS`) — `tres_busy` when a round holds the stay (N12).
//
// THE PREVIEW holds patient data (the resources themselves, and the platform's last words for each): the engine audits
// every read of it (D25), and the dialog says so.
import React, { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { dayStamp } from "../../i18n/dates.js";
import { Box, Button, Empty, Field, Input, Modal, Note, Select, Table, useToast } from "../../ui/index.js";
import { refusedFor } from "./refusal.js";
import { STATUSES, TYPES, reasonLabel, statusLabel, typeLabel } from "./tresWords.js";

/** The statuses «Yeniden dene» stands on: a refused row, and one the ledger stopped trying (D21). */
export const RETRYABLE = Object.freeze(["failed", "stuck"]);

const stamp = (iso) => dayStamp(Date.parse(iso), Date.now());

function PreviewItems({ preview }) {
  const { t } = useI18n();
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {preview.items.map((item) => (
        <li key={`${item.resource_type} ${item.local_id}`} className="rounded-ctl border border-line px-3 py-2">
          <p className="m-0 font-text text-13.5">
            <strong>{typeLabel(t, item.resource_type)}</strong> · <code className="font-data text-12">{item.local_id}</code>
            {" · "}{item.held ? t("tres.deliveries.held") : t("tres.deliveries.notHeld")}
            {item.status ? ` · ${statusLabel(t, item.status)}` : ""}
            {item.reason ? ` · ${reasonLabel(t, item.reason)}` : ""}
          </p>
          {item.last_error ? (
            <p className="m-0 mt-1 text-12 text-mute">{t("tres.deliveries.lastError", { words: item.last_error })}</p>
          ) : null}
          {item.resource ? (
            <pre className="m-0 mt-2 max-h-64 overflow-auto rounded-ctl bg-card2 p-2 font-data text-11">
              {JSON.stringify(item.resource, null, 2)}
            </pre>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function TresDeliveries() {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [filters, setFilters] = useState({ status: "", type: "" });
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [key, setKey] = useState("");
  const [stay, setStay] = useState(null);
  const [preview, setPreview] = useState(null);

  const read = useCallback(async (cursor = null) => {
    try {
      const got = await store.track(() => store.api.tresDeliveries({
        status: filters.status || null, type: filters.type || null, cursor }));
      if (!got || !Array.isArray(got.items)) throw new Error("no deliveries in the answer");
      setAnswer((before) => (cursor && before ? { ...got, items: [...before.items, ...got.items] } : got));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [store, filters]);
  useEffect(() => { read(); }, [read]);

  async function run(name, work) {
    if (busy) return;
    setBusy(name);
    try {
      await work();
    } finally {
      setBusy(null);
    }
  }

  const find = (event) => {
    event.preventDefault();
    if (!key.trim()) return;
    run("find", async () => {
      try {
        setStay(await store.track(() => store.api.tresStay(key.trim())));
      } catch (err) {
        setStay(null);
        toast(refusedFor(t, t("tres.deliveries.find"), err), "error");
      }
    });
  };
  const sendNow = () => run("send", async () => {
    try {
      const got = await store.track(() => store.api.sendTresStay(stay.admission_id));
      toast(t("tres.deliveries.sent", { count: Array.isArray(got?.rows) ? got.rows.length : 0 }));
      await read();
    } catch (err) {
      toast(refusedFor(t, t("tres.deliveries.sendNow"), err), "error");
    }
  });
  const retry = (row) => run(row.id, async () => {
    try {
      const got = await store.track(() => store.api.retryTresDelivery(row.id));
      toast(t("tres.deliveries.retried", { count: Array.isArray(got?.rows) ? got.rows.length : 0 }));
      await read();
    } catch (err) {
      toast(refusedFor(t, t("tres.deliveries.retry"), err), "error");
    }
  });
  const open = (admissionId) => run("preview", async () => {
    try {
      const got = await store.track(() => store.api.tresPreview(admissionId));
      if (!got || !Array.isArray(got.items)) throw new Error("no preview in the answer");
      setPreview(got);
    } catch (err) {
      toast(refusedFor(t, t("tres.deliveries.preview"), err), "error");
    }
  });

  const parked = typeof answer?.session_refused_at === "string" ? answer.session_refused_at : null;
  const items = answer?.items ?? [];
  return (
    <Box title={t("tres.deliveries.title")} level={2}>
      <p className="m-0 mb-3 text-13 text-mute">{t("tres.deliveries.sub")}</p>
      {parked ? <Note tone="warn" icon="alert" className="mb-3">{t("tres.deliveries.parked", { time: stamp(parked) })}</Note> : null}
      <form noValidate autoComplete="off" onSubmit={find} className="mb-2 flex flex-wrap items-end gap-2">
        <Field label={t("tres.deliveries.findLabel")}>
          <Input value={key} inputMode="numeric" maxLength={16} onChange={(e) => setKey(e.target.value)} />
        </Field>
        <Button type="submit" busy={busy === "find"}>{t("tres.deliveries.find")}</Button>
      </form>
      {stay ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 font-text text-13.5">
          <span>{t("tres.deliveries.found", { key: stay.board_key, when: stay.discharge_at
            ? t("tres.deliveries.discharged", { time: stamp(stay.discharge_at) }) : t("tres.deliveries.stillAdmitted") })}</span>
          <Button variant="primary" busy={busy === "send"} onClick={sendNow}>{t("tres.deliveries.sendNow")}</Button>
          <Button busy={busy === "preview"} onClick={() => open(stay.admission_id)}>{t("tres.deliveries.preview")}</Button>
        </div>
      ) : null}
      <div className="mb-2 flex flex-wrap gap-2">
        <Field label={t("tres.deliveries.filterStatus")}>
          <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">{t("tres.deliveries.all")}</option>
            {STATUSES.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
          </Select>
        </Field>
        <Field label={t("tres.deliveries.filterType")}>
          <Select value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}>
            <option value="">{t("tres.deliveries.all")}</option>
            {TYPES.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
          </Select>
        </Field>
      </div>
      {error ? (
        <p className="m-0 text-13 text-crit">{t("tres.deliveries.readFailed", { reason: readErrorText(t, error) })}</p>
      ) : answer === null ? (
        <p className="m-0 text-13 text-mute">{t("tres.deliveries.loading")}</p>
      ) : items.length === 0 ? (
        <Empty>{t("tres.deliveries.empty")}</Empty>
      ) : (
        <Table caption={t("tres.deliveries.caption")}>
          <thead>
            <tr>
              <th>{t("tres.deliveries.when")}</th><th>{t("tres.deliveries.type")}</th><th>{t("tres.deliveries.key")}</th>
              <th>{t("tres.deliveries.status")}</th><th>{t("tres.deliveries.reason")}</th>
              <th>{t("tres.deliveries.attempts")}</th><th>{t("tres.deliveries.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td>{stamp(row.updated_at)}</td>
                <td>{typeLabel(t, row.resource_type)}</td>
                <td className="font-data">{row.board_key ?? "—"}</td>
                <td>{statusLabel(t, row.status)}</td>
                <td>{reasonLabel(t, row.reason)}</td>
                <td className="font-data font-bold">{row.attempts}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {RETRYABLE.includes(row.status) && row.admission_id ? (
                      <Button size="sm" busy={busy === row.id} onClick={() => retry(row)}>{t("tres.deliveries.retry")}</Button>
                    ) : null}
                    {row.admission_id ? (
                      <Button size="sm" onClick={() => open(row.admission_id)}>{t("tres.deliveries.preview")}</Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {answer?.next ? (
        <Button className="mt-2" busy={busy === "more"} onClick={() => run("more", () => read(answer.next))}>
          {t("tres.deliveries.more")}
        </Button>
      ) : null}
      <Modal open={preview !== null} wide title={preview ? t("tres.deliveries.previewTitle", { key: preview.board_key }) : ""}
        onClose={() => setPreview(null)}>
        {preview ? (
          <>
            <Note tone="warn" icon="lock" className="mb-3">{t("tres.deliveries.previewNote")}</Note>
            <PreviewItems preview={preview} />
          </>
        ) : null}
      </Modal>
    </Box>
  );
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/screens/admin/TresDeliveries.test.jsx 2>&1 | tail -4`
Expected: `8 passed`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/tres && git add dashboard/src/live/screens/admin/TresDeliveries.jsx dashboard/src/live/screens/admin/TresDeliveries.test.jsx && git commit -m "feat(tres-01): F1 — «Gönderimler»: the ledger in the catalogue's words, a parked feed at the top (N15), a stay by its protocol number, send now, retry, the audited preview" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: «Bölüm eşleme» and «Hekim kimlikleri» — `TresDepartments.jsx`, `TresPractitioners.jsx`

**Files:**
- Create: `dashboard/src/live/screens/admin/TresDepartments.jsx`, `dashboard/src/live/screens/admin/TresPractitioners.jsx`
- Test: `dashboard/src/live/screens/admin/TresMaps.test.jsx`

- [ ] **Step 1: The tests**

Create `dashboard/src/live/screens/admin/TresMaps.test.jsx`:
```jsx
// src/live/screens/admin/TresMaps.test.jsx — Yönetim › TRƏS › «Bölüm eşleme» and «Hekim kimlikleri» (TRƏS-01 · F1, spec
// §6, D16, D17): the department map saved whole, a half-filled row held on the screen; a practitioner's FİN write-only —
// never shown, left out unless typed, cleared only when asked — and a malformed one held. Synthetic ward only.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { settle, toasts } from "../kabul/kabul.testutil.js";
import { TresDepartments, half, mapOf } from "./TresDepartments.jsx";
import { TresPractitioners, identityBody, wrong } from "./TresPractitioners.jsx";

const PERMS = ["tres.manage"];
const REA = "33333333-3333-4333-8333-333333333301";
const NEO = "33333333-3333-4333-8333-333333333302";
const DOCTOR = "88888888-8888-4888-8888-888888888801";
const UNITS = [{ unit_id: NEO, unit_name: "Neonatal", unit_active: false, code: null, display: null, updated_at: null },
  { unit_id: REA, unit_name: "Reanimasiya", unit_active: true, code: "RE-01", display: "Reanimasiya", updated_at: null }];
const DOCTORS = [{ user_id: DOCTOR, full_name: "Sentetik Hekim", fin_set: true, family_name: "Sentetikov",
  given_name: "Elçin", updated_at: "2026-11-11T08:00:00Z" }];

async function mounted(node, setup) {
  const m = await mount(node, { access: token({ perms: PERMS }), me: profile({ perms: PERMS }), setup });
  await settle();
  return m;
}
const click = async (el) => {
  await act(async () => { fireEvent.click(el); });
  await settle();
};
const shown = (text) => toasts().getAllByText(text).filter((el) => el.closest("[data-toast]"));

describe("TresDepartments", () => {
  it("lists every unit, closed ones said so, and saves the whole map trimmed", async () => {
    const { api } = await mounted(<TresDepartments />, (a) => {
      a.tresDepartments.mockResolvedValue(UNITS);
      a.saveTresDepartments.mockResolvedValue(UNITS.map((u) => ({ ...u, code: "X", display: "Y" })));
    });
    expect(screen.getByText("Neonatal (bağlı)")).toBeInTheDocument();
    expect(screen.getByLabelText("Şöbə kodu · Reanimasiya").value).toBe("RE-01");
    fireEvent.change(screen.getByLabelText("Şöbə kodu · Neonatal"), { target: { value: " NEO-01 " } });
    fireEvent.change(screen.getByLabelText("Şöbənin adı · Neonatal"), { target: { value: "Neonatal " } });
    await click(screen.getByRole("button", { name: "Uyğunlaşdırmanı yadda saxla" }));
    expect(api.saveTresDepartments).toHaveBeenCalledWith([
      { unit_id: NEO, code: "NEO-01", display: "Neonatal" }, { unit_id: REA, code: "RE-01", display: "Reanimasiya" }]);
    expect(shown("Şöbə uyğunlaşdırması yadda saxlanıldı.")).toHaveLength(1);
  });

  it("holds a row with a code and no name, and says a refusal by its code", async () => {
    const { api } = await mounted(<TresDepartments />, (a) => {
      a.tresDepartments.mockResolvedValue(UNITS);
      a.saveTresDepartments.mockRejectedValue(refusal(422, "x", { apiCode: "tres_unit_unknown" }));
    });
    fireEvent.change(screen.getByLabelText("Şöbə kodu · Neonatal"), { target: { value: "NEO-01" } });
    await click(screen.getByRole("button", { name: "Uyğunlaşdırmanı yadda saxla" }));
    expect(api.saveTresDepartments).not.toHaveBeenCalled();
    expect(screen.getByText("Kod və ad birlikdə yazılır və ya birlikdə boş saxlanılır.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Şöbə kodu · Neonatal"), { target: { value: "" } });
    await click(screen.getByRole("button", { name: "Uyğunlaşdırmanı yadda saxla" }));
    expect(api.saveTresDepartments).toHaveBeenCalledWith([{ unit_id: REA, code: "RE-01", display: "Reanimasiya" }]);
    expect(toasts().getAllByText(/Uyğunlaşdırmadakı bölmələrdən biri bu xəstəxanaya aid deyil/).length).toBeGreaterThan(0);
  });

  it("tells a half row and builds the map from the whole ones", () => {
    expect(half({ code: "A", display: " " })).toBe(true);
    expect(half({ code: " ", display: "" })).toBe(false);
    expect(mapOf([{ unit_id: "u", code: " A ", display: " B " }, { unit_id: "v", code: "", display: "" }]))
      .toEqual([{ unit_id: "u", code: "A", display: "B" }]);
  });
});

describe("TresPractitioners", () => {
  it("never shows a stored FİN, leaves it out untouched, and clears it only when asked", async () => {
    const { api } = await mounted(<TresPractitioners />, (a) => {
      a.tresPractitioners.mockResolvedValue(DOCTORS);
      a.saveTresPractitioner.mockResolvedValue(DOCTORS[0]);
    });
    const fin = screen.getByLabelText("FİN · Sentetik Hekim");
    expect(fin.value).toBe("");
    expect(fin.placeholder).toBe("qeyd olunub");
    fireEvent.change(screen.getByLabelText("Ad · Sentetik Hekim"), { target: { value: "Elçin Rəşad" } });
    await click(screen.getByRole("button", { name: "Yadda saxla · Sentetik Hekim" }));
    expect(api.saveTresPractitioner).toHaveBeenLastCalledWith(DOCTOR, { family_name: "Sentetikov", given_name: "Elçin Rəşad" });
    expect(shown("Sentetik Hekim: identifikasiya yadda saxlanıldı.")).toHaveLength(1);
    await click(screen.getByRole("checkbox", { name: "Qeyd olunmuş FİN-i sil" }));
    await click(screen.getByRole("button", { name: "Yadda saxla · Sentetik Hekim" }));
    expect(api.saveTresPractitioner).toHaveBeenLastCalledWith(DOCTOR, { family_name: "Sentetikov", given_name: "Elçin", fin: "" });
  });

  it("holds a FİN of another shape before anything is sent", async () => {
    const { api } = await mounted(<TresPractitioners />, (a) => a.tresPractitioners.mockResolvedValue(DOCTORS));
    fireEvent.change(screen.getByLabelText("FİN · Sentetik Hekim"), { target: { value: "ZZ99" } });
    await click(screen.getByRole("button", { name: "Yadda saxla · Sentetik Hekim" }));
    expect(api.saveTresPractitioner).not.toHaveBeenCalled();
    expect(screen.getByText(/^FİN 7 latın böyük hərfi və ya rəqəmdir/)).toBeInTheDocument();
  });

  it("says when the hospital has no physician", async () => {
    await mounted(<TresPractitioners />, (a) => a.tresPractitioners.mockResolvedValue([]));
    expect(screen.getByText("Bu xəstəxanada həkim yoxdur.")).toBeInTheDocument();
  });

  it("builds the body: the FİN only when typed, an empty one to clear", () => {
    const row = { fin: " zz99yy8 ", clearFin: false, family: " S ", given: "E" };
    expect(identityBody(row)).toEqual({ family_name: "S", given_name: "E", fin: "zz99yy8" });
    expect(identityBody({ ...row, fin: "" })).toEqual({ family_name: "S", given_name: "E" });
    expect(identityBody({ ...row, clearFin: true })).toEqual({ family_name: "S", given_name: "E", fin: "" });
    expect(wrong({ ...row, fin: "ZZ9" })).toBe(true);
    expect(wrong({ ...row, given: " " })).toBe(true);
    expect(wrong(row)).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/screens/admin/TresMaps.test.jsx 2>&1 | tail -6`
Expected: `Test Files  1 failed` — `Failed to resolve import "./TresDepartments.jsx"`.

- [ ] **Step 3: The two panels**

Create `dashboard/src/live/screens/admin/TresDepartments.jsx`:
```jsx
// src/live/screens/admin/TresDepartments.jsx — Yönetim › TRƏS › «Bölüm eşleme» (TRƏS-01 · phase F1, spec §6, §8, D17):
// each unit of the hospital with the platform's `hospital-departments` code and name it goes under. An unmapped unit's
// stays are not sent (`unit_unmapped`), never sent under a default department.
//
// The map is saved WHOLE (PUT /admin/tres/departments): a row whose code and name are both empty is unmapped; a row with
// one of the two is held on the screen before anything is sent. Closed units are listed too — a past stay may be in one.
// A refusal is said by its code; the rows keep what was typed.
import React, { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Box, Button, Input, Table, useToast } from "../../ui/index.js";
import { refusedFor } from "./refusal.js";

const rowOf = (unit) => ({ ...unit, code: unit.code ?? "", display: unit.display ?? "" });
/** A row with exactly one of its two fields: the server would refuse it. */
export const half = (row) => (row.code.trim() === "") !== (row.display.trim() === "");
/** The whole map as the server takes it: the rows with both fields, trimmed. */
export const mapOf = (rows) => rows.filter((r) => r.code.trim() && r.display.trim())
  .map((r) => ({ unit_id: r.unit_id, code: r.code.trim(), display: r.display.trim() }));

export function TresDepartments() {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    try {
      const got = await store.track(() => store.api.tresDepartments());
      if (!Array.isArray(got)) throw new Error("no units in the answer");
      setRows(got.map(rowOf));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [store]);
  useEffect(() => { read(); }, [read]);

  const edit = (unitId, patch) => setRows((all) => all.map((r) => (r.unit_id === unitId ? { ...r, ...patch } : r)));

  async function save() {
    if (busy) return;
    if (rows.some(half)) {
      setTried(true);
      return;
    }
    setBusy(true);
    try {
      const got = await store.track(() => store.api.saveTresDepartments(mapOf(rows)));
      if (Array.isArray(got)) setRows(got.map(rowOf));
      setTried(false);
      toast(t("tres.departments.saved"));
    } catch (err) {
      toast(refusedFor(t, t("tres.departments.title"), err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box title={t("tres.departments.title")} level={2}>
      <p className="m-0 mb-3 text-13 text-mute">{t("tres.departments.sub")}</p>
      {error ? (
        <p className="m-0 text-13 text-crit">{t("tres.departments.readFailed", { reason: readErrorText(t, error) })}</p>
      ) : rows === null ? (
        <p className="m-0 text-13 text-mute">{t("tres.departments.loading")}</p>
      ) : (
        <>
          <Table caption={t("tres.departments.caption")}>
            <thead>
              <tr><th>{t("tres.departments.unit")}</th><th>{t("tres.departments.code")}</th><th>{t("tres.departments.display")}</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.unit_id}>
                  <th scope="row" className="font-text text-13.5">
                    {row.unit_name}{row.unit_active ? "" : ` ${t("tres.departments.closed")}`}
                  </th>
                  <td>
                    <Input value={row.code} maxLength={32} aria-label={`${t("tres.departments.code")} · ${row.unit_name}`}
                      aria-invalid={tried && half(row) ? "true" : undefined}
                      onChange={(e) => edit(row.unit_id, { code: e.target.value })} />
                  </td>
                  <td>
                    <Input value={row.display} maxLength={200} aria-label={`${t("tres.departments.display")} · ${row.unit_name}`}
                      aria-invalid={tried && half(row) ? "true" : undefined}
                      onChange={(e) => edit(row.unit_id, { display: e.target.value })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {tried && rows.some(half) ? <p className="m-0 mt-2 text-13 text-crit">{t("tres.departments.invalid")}</p> : null}
          <Button className="mt-3" variant="primary" busy={busy} onClick={save}>{t("tres.departments.save")}</Button>
        </>
      )}
    </Box>
  );
}
```

Create `dashboard/src/live/screens/admin/TresPractitioners.jsx`:
```jsx
// src/live/screens/admin/TresPractitioners.jsx — Yönetim › TRƏS › «Hekim kimlikleri» (TRƏS-01 · phase F1, spec §6, §8,
// D16): what the platform needs of each physician and Homunculus does not hold — the FİN, the family and the given name.
// A physician without one is left out of a stay's record (`identity_missing`).
//
// THE FİN IS WRITE-ONLY, as the account's password: the server answers `fin_set` and never the FİN; the field is empty
// when the panel opens and says «kayıtlı» when one is stored. Left empty it is left OUT of the body and the stored one
// stays; «Kayıtlı FİN'i sil» sends an empty string. Each physician is saved on its own row; a FİN that is not seven
// Latin letters or digits, or a missing name, is held on the screen before anything is sent.
import React, { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Box, Button, Empty, Input, Table, useToast } from "../../ui/index.js";
import { refusedFor } from "./refusal.js";

const FIN = /^[A-Za-z0-9]{7}$/;
const rowOf = (p) => ({ ...p, fin: "", clearFin: false, family: p.family_name ?? "", given: p.given_name ?? "" });
/** Would the server refuse this row? A typed FİN of another shape, or a name part left empty. */
export const wrong = (row) => (!row.clearFin && row.fin.trim() !== "" && !FIN.test(row.fin.trim()))
  || !row.family.trim() || !row.given.trim();
/** One row as the server takes it: the FİN left out unless typed, "" to clear it. */
export function identityBody(row) {
  const body = { family_name: row.family.trim(), given_name: row.given.trim() };
  if (row.clearFin) body.fin = "";
  else if (row.fin.trim() !== "") body.fin = row.fin.trim();
  return body;
}

export function TresPractitioners() {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [tried, setTried] = useState(null);
  const [busy, setBusy] = useState(null);

  const read = useCallback(async () => {
    try {
      const got = await store.track(() => store.api.tresPractitioners());
      if (!Array.isArray(got)) throw new Error("no practitioners in the answer");
      setRows(got.map(rowOf));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [store]);
  useEffect(() => { read(); }, [read]);

  const edit = (userId, patch) => setRows((all) => all.map((r) => (r.user_id === userId ? { ...r, ...patch } : r)));

  async function save(row) {
    if (busy) return;
    if (wrong(row)) {
      setTried(row.user_id);
      return;
    }
    setBusy(row.user_id);
    try {
      const got = await store.track(() => store.api.saveTresPractitioner(row.user_id, identityBody(row)));
      if (got && got.user_id === row.user_id) setRows((all) => all.map((r) => (r.user_id === row.user_id ? rowOf(got) : r)));
      setTried(null);
      toast(t("tres.practitioners.saved", { name: row.full_name }));
    } catch (err) {
      toast(refusedFor(t, row.full_name, err), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Box title={t("tres.practitioners.title")} level={2}>
      <p className="m-0 mb-3 text-13 text-mute">{t("tres.practitioners.sub")}</p>
      {error ? (
        <p className="m-0 text-13 text-crit">{t("tres.practitioners.readFailed", { reason: readErrorText(t, error) })}</p>
      ) : rows === null ? (
        <p className="m-0 text-13 text-mute">{t("tres.practitioners.loading")}</p>
      ) : rows.length === 0 ? (
        <Empty>{t("tres.practitioners.empty")}</Empty>
      ) : (
        <Table caption={t("tres.practitioners.caption")}>
          <thead>
            <tr>
              <th>{t("tres.practitioners.name")}</th><th>{t("tres.practitioners.fin")}</th>
              <th>{t("tres.practitioners.family")}</th><th>{t("tres.practitioners.given")}</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.user_id}>
                <th scope="row" className="font-text text-13.5">{row.full_name}</th>
                <td>
                  <Input value={row.fin} maxLength={7} autoComplete="off" disabled={row.clearFin}
                    placeholder={row.fin_set ? t("tres.practitioners.finStored") : undefined}
                    aria-label={`${t("tres.practitioners.fin")} · ${row.full_name}`}
                    onChange={(e) => edit(row.user_id, { fin: e.target.value })} />
                  {row.fin_set ? (
                    <label className="mt-1 flex items-center gap-1.5 font-text text-12">
                      <input type="checkbox" checked={row.clearFin}
                        onChange={(e) => edit(row.user_id, { clearFin: e.target.checked, fin: "" })} />
                      {t("tres.practitioners.finClear")}
                    </label>
                  ) : null}
                </td>
                <td>
                  <Input value={row.family} maxLength={100} aria-label={`${t("tres.practitioners.family")} · ${row.full_name}`}
                    onChange={(e) => edit(row.user_id, { family: e.target.value })} />
                </td>
                <td>
                  <Input value={row.given} maxLength={100} aria-label={`${t("tres.practitioners.given")} · ${row.full_name}`}
                    onChange={(e) => edit(row.user_id, { given: e.target.value })} />
                </td>
                <td>
                  <Button size="sm" busy={busy === row.user_id} onClick={() => save(row)}
                    aria-label={`${t("tres.practitioners.save")} · ${row.full_name}`}>{t("tres.practitioners.save")}</Button>
                  {tried === row.user_id && wrong(row) ? (
                    <p className="m-0 mt-1 text-12 text-crit">{t("tres.practitioners.invalid")}</p>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Box>
  );
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/screens/admin/TresMaps.test.jsx 2>&1 | tail -4`
Expected: `7 passed`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/tres && git add dashboard/src/live/screens/admin/TresDepartments.jsx dashboard/src/live/screens/admin/TresPractitioners.jsx dashboard/src/live/screens/admin/TresMaps.test.jsx && git commit -m "feat(tres-01): F1 — «Bölüm eşleme» saved whole and «Hekim kimlikleri» with the FİN write-only (D16, D17)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: The tab — the automatic rounds' start, the live note, the three panels; the raw-key sweep

**Files:**
- Modify: `dashboard/src/live/screens/admin/TresTab.jsx`, `dashboard/src/live/rawKeys.test.jsx`
- Test: `dashboard/src/live/screens/admin/TresTab.test.jsx`

- [ ] **Step 1: The tests**

In `dashboard/src/live/screens/admin/TresTab.test.jsx` replace
```jsx
import { settle, toasts } from "../kabul/kabul.testutil.js";
import { TYPES, TresTab, accountBody, bodyOf, invalid } from "./TresTab.jsx";
```
with
```jsx
import { settle, toasts } from "../kabul/kabul.testutil.js";
import { TYPES, TresTab, accountBody, bodyOf, invalid, localInput } from "./TresTab.jsx";
```

Append at the end of `dashboard/src/live/screens/admin/TresTab.test.jsx`:
```jsx
// TRƏS-01 F1: the automatic rounds' start (O15, proposed), the live platform's note, the three panels under the form.
describe("TresTab — phase F1", () => {
  it("shows the stored start, sends it only when moved, and says when none is stored", async () => {
    const stored = { ...SET, mode: "send", send_from: "2026-11-01T06:00:00Z" };
    const { api } = await mounted((a) => {
      a.tresSettings.mockResolvedValue(stored);
      a.saveTresSettings.mockResolvedValue(stored);
    });
    const field = screen.getByLabelText(/^Avtomatik göndərişin başlanğıcı/);
    expect(field.value).toBe(localInput("2026-11-01T06:00:00Z"));
    await save();
    expect(api.saveTresSettings.mock.calls[0][0]).not.toHaveProperty("send_from");      // left as read: kept
    fireEvent.change(field, { target: { value: "2026-10-30T08:15" } });
    await save();
    expect(api.saveTresSettings.mock.calls[1][0].send_from).toBe(new Date("2026-10-30T08:15").toISOString());
  });

  it("says no start is stored before «Göndər» was ever chosen", async () => {
    await mounted((a) => a.tresSettings.mockResolvedValue(SET));
    expect(screen.getByText("«Göndər» hələ seçilməyib: avtomatik göndərişin başlanğıcı yoxdur.")).toBeInTheDocument();
  });

  it("says the live platform is closed when the live environment is chosen with a mode", async () => {
    await mounted((a) => a.tresSettings.mockResolvedValue(SET));
    expect(screen.queryByText(/^Canlı platformaya xəstə məlumatlarının göndərilməsi bu versiyada bağlıdır/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Mühit/), { target: { value: "live" } });
    expect(screen.getByText(/^Canlı platformaya xəstə məlumatlarının göndərilməsi bu versiyada bağlıdır/)).toBeInTheDocument();
  });

  it("draws the three panels under the settings", async () => {
    await mounted((a) => {
      a.tresSettings.mockResolvedValue(SET);
      a.tresDeliveries.mockResolvedValue({ environment: "test", session_refused_at: null, next: null, items: [] });
      a.tresDepartments.mockResolvedValue([]);
      a.tresPractitioners.mockResolvedValue([]);
    });
    for (const title of ["Göndərişlər", "Şöbə uyğunlaşdırması", "Həkim identifikasiyaları"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText("Bu mühitdə hələ göndəriş qeydi yoxdur.")).toBeInTheDocument();
  });
});
```

In `dashboard/src/live/rawKeys.test.jsx` replace
```jsx
  egress: false, updated_at: "2026-10-08T09:00:00Z" };
```
with
```jsx
  egress: false, updated_at: "2026-10-08T09:00:00Z" };
/** TRƏS-01 F1: the three panels — a parked feed, a row of every status the ledger holds with a skip reason of each
 *  kind the catalogue names, a closed unit, a practitioner with a FİN stored and one without an identity. */
const TRES_STATUS_SWEEP = ["pending", "sent", "validated", "failed", "skipped", "stuck", "deleted"];
const TRES_REASON_SWEEP = ["fin_missing", "fin_format", "name_single", "father_name_missing", "sex_unmapped",
  "birth_date_invalid", "identity_missing", "name_missing", "unit_unmapped", "organization_missing", "timezone_unknown",
  "no_reference", "type_off"];
const TRES_DELIVERIES_SWEEP = { environment: "test", session_refused_at: "2026-10-08T08:00:00Z", next: "c-2",
  items: [...TRES_STATUS_SWEEP, ...TRES_REASON_SWEEP].map((value, n) => ({
    id: `r-${n}`, resource_type: "vital", local_id: `hmn-v-${n}.`, status: TRES_STATUS_SWEEP.includes(value) ? value : "skipped",
    reason: TRES_STATUS_SWEEP.includes(value) ? null : value, attempts: n, operation: null, remote_id: null,
    next_attempt_at: null, updated_at: "2026-10-08T09:00:00Z", admission_id: "66666666-6666-4666-8666-666666666601",
    board_key: "202600000101" })) };
const TRES_DEPARTMENTS_SWEEP = [
  { unit_id: "33333333-3333-4333-8333-333333333301", unit_name: "Reanimasiya", unit_active: true, code: "RE-01",
    display: "Reanimasiya", updated_at: "2026-10-08T09:00:00Z" },
  { unit_id: "33333333-3333-4333-8333-333333333302", unit_name: "Neonatal", unit_active: false, code: null, display: null,
    updated_at: null }];
const TRES_PRACTITIONERS_SWEEP = [
  { user_id: "88888888-8888-4888-8888-888888888801", full_name: "Sentetik Hekim", fin_set: true, family_name: "Sentetikov",
    given_name: "Elçin", updated_at: "2026-10-08T09:00:00Z" },
  { user_id: "88888888-8888-4888-8888-888888888802", full_name: "Sentetik İkinci", fin_set: false, family_name: null,
    given_name: null, updated_at: null }];
```

In `dashboard/src/live/rawKeys.test.jsx` replace
```jsx
      api.tresSettings.mockResolvedValue(TRES_SETTINGS_SWEEP);
```
with
```jsx
      api.tresSettings.mockResolvedValue(TRES_SETTINGS_SWEEP);
      // TRƏS-01 F1: its three panels — unstubbed each would say only that it could not be read.
      api.tresDeliveries.mockResolvedValue(TRES_DELIVERIES_SWEEP);
      api.tresDepartments.mockResolvedValue(TRES_DEPARTMENTS_SWEEP);
      api.tresPractitioners.mockResolvedValue(TRES_PRACTITIONERS_SWEEP);
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/screens/admin/TresTab.test.jsx src/live/rawKeys.test.jsx 2>&1 | tail -6`
Expected: `4 failed | 40 passed` — the four tests of «TresTab — phase F1».

- [ ] **Step 3: The tab**

In `dashboard/src/live/screens/admin/TresTab.jsx` replace
```jsx
// lock, that nothing is sent until the account is corrected and saved or a test succeeds; a successful test lifts it.
import React, { useCallback, useEffect, useState } from "react";
```
with
```jsx
// lock, that nothing is sent until the account is corrected and saved or a test succeeds; a successful test lifts it.
//
// PHASE F1. The automatic rounds' start (`send_from`, open item O15 — a PROPOSED rule, awaiting the owner's word): shown
// and movable here; left as read it is left OUT of the body, and the server keeps it. The live platform is closed in this
// version (O5, O11): with the live environment and a mode other than «Kapalı» the form says so before the server
// refuses it. Under the settings, the three panels of F1: «Gönderimler», «Bölüm eşleme», «Hekim kimlikleri».
import React, { useCallback, useEffect, useState } from "react";
```

In `dashboard/src/live/screens/admin/TresTab.jsx` replace
```jsx
import { TYPES } from "./tresWords.js";
```
with
```jsx
import { TYPES } from "./tresWords.js";
import { TresDeliveries } from "./TresDeliveries.jsx";
import { TresDepartments } from "./TresDepartments.jsx";
import { TresPractitioners } from "./TresPractitioners.jsx";
```

In `dashboard/src/live/screens/admin/TresTab.jsx` replace
```jsx
});
const formOf = (s) => ({
```
with
```jsx
});
const pad = (n) => String(n).padStart(2, "0");
/** An instant as a `datetime-local` value in the reader's own zone ("" for none). */
export function localInput(iso) {
  const at = typeof iso === "string" ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime())) return "";
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
const formOf = (s) => ({
```

In `dashboard/src/live/screens/admin/TresTab.jsx` replace
```jsx
  test: accountForm(s?.test), live: accountForm(s?.live),
});
```
with
```jsx
  test: accountForm(s?.test), live: accountForm(s?.live),
  sendFrom: localInput(s?.send_from), sendFromRead: localInput(s?.send_from),
});
```

In `dashboard/src/live/screens/admin/TresTab.jsx` replace
```jsx
export function bodyOf(form) {
  return {
    mode: form.mode, environment: form.environment, settle_hours: Number(form.settle),
```
with
```jsx
export function bodyOf(form) {
  const body = {
    mode: form.mode, environment: form.environment, settle_hours: Number(form.settle),
```

In `dashboard/src/live/screens/admin/TresTab.jsx` replace
```jsx
  };
}
```
with
```jsx
  };
  // O15 (proposed): the cut-off goes only when moved — the server keeps the stored one otherwise.
  const moved = form.sendFrom !== undefined && form.sendFrom !== form.sendFromRead && form.sendFrom !== "";
  if (moved && !Number.isNaN(new Date(form.sendFrom).getTime())) body.send_from = new Date(form.sendFrom).toISOString();
  return body;
}
```

In `dashboard/src/live/screens/admin/TresTab.jsx` replace
```jsx
          {incomplete ? <Note tone="warn" icon="alert" className="mb-3">{t("tres.incomplete")}</Note> : null}
          <Field label={t("tres.settleHours")} hint={t("tres.settleHint")}
```
with
```jsx
          {incomplete ? <Note tone="warn" icon="alert" className="mb-3">{t("tres.incomplete")}</Note> : null}
          {form.environment === "live" && form.mode !== "off"
            ? <Note tone="warn" icon="lock" className="mb-3">{t("tres.liveNote")}</Note> : null}
          <Field label={t("tres.sendFrom")} hint={settings.send_from ? t("tres.sendFromHint") : t("tres.sendFromUnset")}>
            <Input type="datetime-local" value={form.sendFrom} onChange={(e) => set({ sendFrom: e.target.value })} />
          </Field>
          <Field label={t("tres.settleHours")} hint={t("tres.settleHint")}
```

In `dashboard/src/live/screens/admin/TresTab.jsx` replace
```jsx
      </Box>
    </div>
```
with
```jsx
      </Box>
      <TresDeliveries />
      <TresDepartments />
      <TresPractitioners />
    </div>
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/screens/admin/TresTab.test.jsx src/live/rawKeys.test.jsx 2>&1 | tail -4`
Expected: `44 passed`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/tres && git add dashboard/src/live/screens/admin/TresTab.jsx dashboard/src/live/screens/admin/TresTab.test.jsx dashboard/src/live/rawKeys.test.jsx && git commit -m "feat(tres-01): F1 — the tab shows the automatic rounds' start (O15, proposed) and the live note, and draws the three panels; the raw-key sweep meets every status and reason" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Dashboard gates and the build

- [ ] **Step 1: The whole suite** — Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run 2>&1 | tail -6`. Expected: no `failed`; against Task 14's baseline **+2 test files and +20 tests** (the client 1, the tab 4, «Gönderimler» 8, the maps 7).
- [ ] **Step 2: The build** — Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vite build 2>&1 | grep -E "precache|larger than|rror|TresTab|Toast-"`. Expected: no `error`; `assets/TresTab-*.js` ≈ 21 kB; `precache  68 entries`; the shared chunk `assets/Toast-*.js` ≈ 524 kB with Vite's `Some chunks are larger than 500 kB` note — expected and accepted (this plan's header: main has split the catalogue; it goes at merge). Then `ls -S dist/assets/*.js | head -2` — Expected: `Toast-*.js` first, `LiveApp-*.js` second; any OTHER chunk over 500 kB is a regression: STOP and tell the controller. `dist/` is git-ignored.
- [ ] **Step 3: The engine's cross-checks once more** — Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/apiErrors.test.js src/live/screens/denetim 2>&1 | tail -4` — Expected: passed (the codes and the audit labels are the engine's, read as text).

---

### Task 21: Docs — the spec's §14, the guide's §3.25, the gates' record; push

**Files:**
- Modify: `docs/superpowers/specs/2026-11-11-tres-esaglik-gonderim-design.md` (a new last section, §14, after §13.3's last line)
- Modify: `docs/homunculus-rehber-TR.md` (§3.25: its title, and the F1 block before «Kaynak»)
- Modify: `docs/superpowers/plans/2026-11-12-tres-f1a-hasta-yatis.md` and `docs/superpowers/plans/2026-11-12-tres-f1b-hasta-yatis.md` (their Gates blocks)

All four are CRLF on disk; edit them with the Edit tool.

- [ ] **Step 1: The spec's §14**

Append at the end of `docs/superpowers/specs/2026-11-11-tres-esaglik-gonderim-design.md` (a blank line after O22's last line, `  - whether it echoes the local-id extension on every entry.`, then):
```markdown
## 14. Amendments (plan F1)

Made by `docs/superpowers/plans/2026-11-12-tres-f1a-hasta-yatis.md` (the engine) and
`docs/superpowers/plans/2026-11-12-tres-f1b-hasta-yatis.md` (the panels) — phase F1, Patient, Practitioner,
Encounter, vital signs. Where a line above and a line here disagree, this section is right.

### 14.1 Decisions F1 took

- **O20 — closed: a local id ends with its only dot.** `hmn-p-{phi_digest(FİN)[:32]}.`, `hmn-pr-{user id}.`,
  `hmn-e-{root admission id}.`, `hmn-v-{root admission id}-{signal key}-{first|last}.` (the key is the signal's stable `id_key`, never its LOINC code); F2–F5's follow (`hmn-c-{row}.`,
  `hmn-l-{audit id}.`…). No id is then a proper prefix of another, in any case. Every id is a FHIR id of at most 64
  characters (`tres/ids.py` `is_local_id`). Whether the platform takes the dot is O24.
- **O14 — closed: a validate round and references.** A resource whose reference has no platform id in the ledger is
  recorded `skipped` `no_reference` (the Encounter without the Patient's id, each vital sign without the Encounter's);
  nothing that points at nothing is sent. A tenant that never sent validates its Patients and Practitioners. F6
  checks the platform's `$validate` and may relax this.
- **N2 — one trail read per stay.** A transfer moves the protocol number to the arriving row and keeps the patient row
  (admission/service.py, O8 of 2026-11-02), so every chart row of a stay is under the board key of the chain's last
  row.
- **N3 — the person from the root's patient row**, the FİN decrypted and normalised; a Patient without a usable FİN
  is skipped under the stay's placeholder `hmn-p-s-{root}.`, removed once the person's own id can be built.
- **D9 — a week's reach.** The rounds rebuild a stay for seven days after it became due (`source.REACH`); an older
  stay goes by hand, or by the nightly retry for its `stuck` rows. A DISCHARGED row without `discharge_at` is never
  due on its own.
- **O15 — PROPOSED, AWAITING THE OWNER'S WORD.** `tres_settings.send_from`: only a stay discharged at or after it is
  due automatically; set when `send` is first chosen; shown and movable on the tab («Otomatik gönderimin
  başlangıcı»). An older stay goes by hand.
- **O5, O11 — the live platform is closed in this version.** `tres.egress.LIVE_OPEN = False`: no package to the live
  environment nor to an address on `ehr.e-health.gov.az` (rounds pass over, hand routes 409, settings 422
  `tres_live_closed`). Opening it is a reviewed code change with the owner's word. O5 itself is not decided.
- **D21, O21 — closed: the nightly retry** runs at the first round after 04:00 in the tenant's zone over every stay
  with a `stuck` row, with `force`; the night is marked in `tres_settings.retried_at`. «Yeniden dene» forces the
  row's stay.
- **N12** — a person's request takes each row under `SET LOCAL lock_timeout = '2000ms'` and answers 409 `tres_busy`.
  **N15** — `park` only while `updated_at` is the version the round (or request) began on.

### 14.2 Other amendments

- **D12** — the vital signs' codes were checked on 2026-11-12 at `tx.fhir.org` (LOINC 2.83, UCUM 2.2) and are pinned
  in `tres/codes.py`: 8867-4 `/min`, 9279-1 `/min`, 2708-6 `%` (O7), 8310-5 `Cel`, 8480-6 `mm[Hg]`, 8478-0
  `mm[Hg]`, 29463-7 `kg`, 8302-2 `cm`. `code.text` is the LOINC display, not a local label; `valueQuantity.unit` is
  the UCUM code.
- **§5, D20** — `identity-document-type` `15` and `encounter-type` `1` go without a display; the blood group is not
  sent (O23).
- **D8** — F1's Practitioners are the chain's attendings (`attending_physician_id`, distinct, chain order);
  `participant` carries no `type`.
- **D17** — the Encounter's department is the last admission's unit; its period runs from the root's admission to
  the last's discharge.
- **D6** — the ledger's `admission_id` is the stay's last admission.
- **D22** — a zone the server does not know skips the Encounter (`timezone_unknown`), never guessed.
- **D24** — payloads: `tres.map` `{actor, units}`; `tres.identity` `{actor, user_id, changed}`; `tres.send`
  `{actor, admission_id, result, counts?}`; `tres.retry` `{actor, delivery_id, admission_id, result, counts?}`;
  `tres.preview` `{actor, admission_id}`; `tres.package` `{admission_id, environment, counts}` once per stay and
  environment, in `send`, at the end of the run that first gave the stay its Encounter. The row's `patient_id` is
  the board key.
- **D25** — the ledger's list carries no `last_error`; the audited preview does.
- **D16** — a practitioner's FİN is write-only at the door (`fin_set`), held to D20's rule at save.
- **§6** — `GET /admin/tres/admissions?key=` finds a stay by its board key; new refusal codes in `tres/errors.py`:
  `tres_live_closed`, `tres_unit_unknown`, `tres_department_code`, `tres_department_display`, `tres_user_unknown`,
  `tres_fin_format`, `tres_name`, `tres_filter`, `tres_cursor`, `tres_stay_unknown`, `tres_off`, `tres_busy`,
  `tres_login_refused`, `tres_platform_unavailable`.
- **§9** — the stand-in holds each profile by `meta.profile[0]` (`REQUIRED`, `ALLOWED`); the tests of §4 send
  `UNCHECKED_PROFILE`.
- **§7** — nginx's access log: the new routes with a path parameter join `deploy/local/web/nginx.conf`'s
  `map $uri $homunculus_log_uri` and its catch-all, so no id reaches the log; `?key=` is a query string, never
  logged.
- **D26** — migration 0020 now creates four tables (`tres_department_map`, `tres_practitioner_identity` added) and
  `tres_settings.send_from`, `.retried_at` (O19). At merge it is renumbered onto main's head of that moment (0023 by
  the queue of 2026-11-12).
- **§8, D27** — the panels «Gönderimler», «Bölüm eşleme», «Hekim kimlikleri»; the preview in a dialog that says it holds
  patient data. The shared i18n chunk reaches ≈524 kB; not split here (main split it at `746f30a9`).

### 14.3 Open items added by F1

- O23 The displays of `identity-document-type` `15` and `encounter-type` `1`, and the codes of
  `az:CodeSystem/blood-group` — from the ministry's CodeSystem files.
- O24 Whether the platform takes a placeholder `id` and a local id ending in `.` — F6's first POST.
- O25 A `last` vital sign withdrawn after a hand send stays on the platform until F6's deletes (D19).
- O26 The week's reach bounds how late a correction goes without a hand; F2 decides whether a later diagnosis brings a
  stay back within reach.
- O14, O20, O21 are closed above; O15 is built as proposed and awaits the owner; O5 and O11 stay open, the live
  platform closed in code until they are answered.
```

- [ ] **Step 2: The guide's §3.25**

In `docs/homunculus-rehber-TR.md` replace
```markdown
### 3.25 «TRƏS»: ulusal e-sağlık gönderimi (HBYS · TRƏS-01, aşama F0)
```
with
```markdown
### 3.25 «TRƏS»: ulusal e-sağlık gönderimi (HBYS · TRƏS-01, aşama F0–F1)
```

Then replace
```markdown
  - Gönderim ilk açıldığında geçmişte taburcu olmuş bütün yatışlar gönderilmeye hazır olur. Başka bir sistemin
    onları zaten bildirdiği bir hastanede (Bona Dea) bu, ulusal kayıtta çift kayıt demektir. Bir tarih sınırı
    önerildi (spec O15); karar sahibin.
- **Kaynak:** `docs/superpowers/specs/2026-11-11-tres-esaglik-gonderim-design.md` (§13 bu aşamanın
  değişiklikleri); plan `docs/superpowers/plans/2026-11-11-tres-f0-altyapi.md`.
```
with
```markdown
  - Gönderim ilk açıldığında geçmişte taburcu olmuş yatışlar için F1 bir tarih sınırı kurdu (yukarıda, «İlk
    açılışın sınırı»); kural öneridir, karar sahibin (spec O15).
- **Aşama F1 (hasta, hekim, yatış, vital bulgular):** artık gerçek kayıtlar kuruluyor.
  - **Ne gider:** taburcu edilmiş ve bekleme süresi (varsayılan 24 saat) dolmuş bir yatış için hasta (FİN, soyad,
    ad, baba adı, cinsiyet, doğum tarihi, telefon), yatışın sorumlu hekimleri, yatışın kendisi (başlangıç, taburcu,
    bölüm, kurum) ve her vital bulgunun (nabız, solunum sayısı, SpO2, ateş, sistolik ve ortalama arter basıncı)
    yatıştaki **ilk ve son** elle girilmiş değeri; kabuldeki kilo ve boy. Monitör örnekleri hiç gönderilmez;
    «hatalı giriş» olarak geri alınan değerler de gönderilmez.
  - **Ne zaman:** otomatik turlar bir yatışı bekleme süresi dolduktan sonra bir hafta boyunca her turda yeniden
    kurar; değişmeyen kayıt için platforma bir şey sorulmaz. Daha eski bir yatış yalnız «Şimdi gönder» ile gider.
  - **İlk açılışın sınırı (öneri — sahibinin onayını bekliyor):** «Gönder» ilk kez seçildiği an kaydedilir; ondan
    önce taburcu olan yatışlar kendiliğinden gönderilmez, yalnız elle. Sekmede «Otomatik gönderimin başlangıcı»
    olarak görünür ve değiştirilebilir.
  - **Canlı platform bu sürümde kapalı:** canlı ortama — ya da canlı sunucunun adresine — hiçbir hasta verisi
    gönderilmez; sekme canlı ortam için yalnız «Kapalı» kipi kaydeder. Yasal dayanak (O5) ve başka sistemden geçiş
    (O11) kararlarına kadar bu kodda kapalıdır; açmak sahibin sözüyle yapılan bir kod değişikliğidir. Sınama ortamı
    da bakanlığındır: oraya gerçek hasta göndermek de bir veri aktarımıdır; F6'da yalnız sentetik yatışlar kullanılır.
  - **Atlanan kayıt:** eksik bilgi tahminle doldurulmaz; kayıt «Atlandı» olur ve nedeni yazılır (FİN girilmemiş, ad
    tek sözcük, baba adı yok, cinsiyet platformun kodlarında yok, birim bir bölüme eşlenmemiş, hekimin kimliği
    girilmemiş, hastanenin saat dilimi bilinmiyor…). Bilgi tamamlanınca sonraki turda gider.
  - **Yönetim › TRƏS'in yeni panoları:**
    - **Gönderimler:** her kaydın son durumu (Bekliyor, Gönderildi, Doğrulandı, Reddedildi, Atlandı, Takıldı), nedeni,
      deneme sayısı ve yatışın protokol numarası; durum ve türe göre süzgeç. Platform girişi reddettiyse en üstte
      uyarı. Protokol numarasıyla yatış bulunur: «Şimdi gönder» ve «Önizle». Reddedilmiş ya da takılmış bir satırda
      «Yeniden dene». Bir tur o yatışı o anda gönderiyorsa «Şimdi gönder» beklemez, «şu anda gönderiliyor» der.
    - **Önizle:** gönderilecek kayıtların kendisini ve platformun son mesajını gösterir; **hasta verisi içerir** ve her
      açılışı denetim kaydına yazılır.
    - **Bölüm eşleme:** her birimin platformdaki bölüm kodu ve adı. Eşlenmemiş birimin yatışları gönderilmez.
    - **Hekim kimlikleri:** her hekimin FİN'i, soyadı ve adı. FİN parola gibi yalnız yazılır, geri gösterilmez.
  - **Gece yeniden denemesi:** «Takıldı» durumundaki kayıtlar her gece, hastanenin saatiyle 04:00'ten sonraki ilk
    turda bir kez yeniden denenir.
  - **Saat dilimi:** gönderilen her saat hastanenin saat dilimindedir (Bakü için `+04:00`). Hastanenin saat dilimi
    `Asia/Baku` olarak ayarlanmalıdır; varsayılan `UTC`'dir. Sunucunun tanımadığı bir dilimde yatış gönderilmez.
  - **Denetim:** yeni olaylar — «TRƏS bölüm eşlemesi değişti», «TRƏS hekim kimliği değişti», «TRƏS: yatış elle
    gönderildi», «TRƏS: gönderim yeniden denendi», «TRƏS: gönderim önizlemesi açıldı», «TRƏS: yatış paketi
    gönderildi» (yatış platforma ilk kez tam ulaştığında, yalnız sayılarla). Hiçbiri hasta adı ya da FİN taşımaz.
  - **Göç 0020** artık dört tablo (yeni: `tres_department_map`, `tres_practitioner_identity`) ve ayarlarda iki sütun
    (`send_from`, `retried_at`) ekler.
  - **Kodlar:** her LOINC kodu, adı ve UCUM birimi 2026-11-12'de `tx.fhir.org`'da doğrulandı. SpO2'nin kodu (O7)
    bakanlığa sorulacak. Kan grubu henüz gönderilmiyor; kimlik belgesi türü ve yatış türü kodları adsız gidiyor
    (bakanlığın kod listeleri gelince, O23).
- **Kaynak:** `docs/superpowers/specs/2026-11-11-tres-esaglik-gonderim-design.md` (§13–§14 aşamaların
  değişiklikleri); planlar `docs/superpowers/plans/2026-11-11-tres-f0-altyapi.md`,
  `docs/superpowers/plans/2026-11-12-tres-f1a-hasta-yatis.md`, `docs/superpowers/plans/2026-11-12-tres-f1b-hasta-yatis.md`.
```

- [ ] **Step 3: The gates' record** — in `docs/superpowers/plans/2026-11-12-tres-f1a-hasta-yatis.md` and `docs/superpowers/plans/2026-11-12-tres-f1b-hasta-yatis.md`, replace every `…` of the Gates block with the number seen (F1a's Task 0 and Task 13; this plan's Tasks 14 and 20), the head shas, and the walk's line (Task 22, Step 2). None left.

- [ ] **Step 4: Commit and push**

```bash
cd /c/tmp/tres && git add docs/superpowers/specs/2026-11-11-tres-esaglik-gonderim-design.md docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-11-12-tres-f1a-hasta-yatis.md docs/superpowers/plans/2026-11-12-tres-f1b-hasta-yatis.md && git commit -m "docs(tres-01): F1 — the spec's amendments (§14: decisions O14, O20, O21; O15 built as proposed; the live platform closed; O23–O26), the guide's §3.25, the gates' record" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push origin feat/tres-esaglik
```
Expected: the push succeeds (the owner allows pushing `feat/…` branches). **Nothing goes to `main` and nothing to the hospital VM**: «main'e al» and «onay» are the owner's words.

---

### Task 22: Final review and hand-over

- [ ] **Step 1: The final code review.** Dispatch the reviewer (superpowers:requesting-code-review) over `git diff f74b474a..HEAD -- homunculus-engine dashboard` with the spec (§13–§14) and both F1 plans. Ask it for these by name: (1) nothing reaches the live platform while `LIVE_OPEN` is False — rounds, hand routes, settings; (2) no response, audit payload or log line carries a FİN, a name, a password, a session id or a resource body — except the preview's answer, which is audited; (3) every `/admin/tres/*` route is `tres.manage` and the caller's tenant only (another tenant's admission, row, unit or user is a 404 or invisible); (4) every code, display and unit is `tres/codes.py`'s and its record matches (D12); (5) «Şimdi gönder» and «Yeniden dene» never wait behind a round longer than the lock timeout; (6) nothing was copied from the reference repository of spec §2. Each fix is its own commit, both suites green again.
- [ ] **Step 2: What the owner can look at on the local stack** (`docs/EDGE-BRIDGE-LOCAL.md`; synthetic accounts and stays only, the stand-in or the sandbox's host never reached — `TRES_EGRESS` unset): Yönetim › TRƏS shows the three panels; «Bölüm eşleme» lists the units and saves; «Hekim kimlikleri» saves a FİN and shows «kayıtlı», never the FİN; a synthetic stay found by its protocol number opens «Önizle» with its resources, and «Denetim bütünlüğü» shows «TRƏS: gönderim önizlemesi açıldı»; «Şimdi gönder» answers that outbound sending is closed. Write what was seen into the Gates block, or `walk: not done` and why.
- [ ] **Step 3: Hand over to the controller**, in one message: the head sha; the gate numbers; that 0020 is renumbered at merge (0023 by today's queue); the build's 524 kB note (main split the catalogue); **what needs the owner**: O15 (the cut-off rule, built as proposed), O5 and O11 (the live platform stays closed in code until then), O7 (SpO2's code, the ministry); and that F2's plan is the next document (the notes below). Nothing is merged and nothing is deployed by this plan.

---

## Spec coverage — F1b's share, and the phase

| Spec | Where | Left |
|---|---|---|
| §8 «Gönderimler» (N15 the parked tenant at its top) | Task 17 | — |
| §8 «Bölüm eşleme», «Hekim kimlikleri» (D16, D17) | Task 18 | the code list search (F2) |
| §6 deliveries, retry, send, preview, departments, practitioners — the calls | Task 15 | F2–F5's routes |
| O15 the cut-off on the form (proposed) | Task 19 | the owner's word |
| O5, O11 the live platform closed — said on the form | Task 19 | the owner's word |
| D27 four languages | Task 16 | the native reading (N10) |
| §10 F1: Patient, Practitioner, Encounter, vitals, the two mapping panels | F1a Tasks 1–12, F1b Tasks 15–19 | — |
| Spec §14, the guide | Task 21 | — |

## Notes for F2 (found while this phase was written)

- **N1 — the Encounter's second PUT (D8).** F1's `package.run` sends the Encounter once. F2 inserts the Conditions after it and sends it again with `diagnosis[]`; by D7 the second payload's digest differs, so the ledger PUTs it. Keep the Encounter's `first_complete` reading on the FIRST send.
- **N2 — reach and late records (O26).** The rounds rebuild a stay for a week (`source.REACH`). A diagnosis added later does not bring the stay back. Decide in F2 whether a newer `admission_diagnoses.recorded_at` (or `removed_at`) than the stay's Encounter row brings it back within reach — and the same for F3–F5.
- **N3 — the stand-in's next profiles.** `az-condition` (category, code from `az-icd-10`, verificationStatus, subject, encounter, the diagnosis-type extension) joins `tests/fake_tres.py` `REQUIRED` with its mapper, with a test in `test_fake_tres.py` (`_f1_resources` shows the pattern).
- **N4 — code lists (D18, O23).** F2's loader brings `hospital-departments`: «Bölüm eşleme» can then search it instead of free text (the PUT's body stays). If the ministry's files carry `identity-document-type`, `encounter-type` and `blood-group`, their displays and the blood group can be sent — each looked up, never typed.
- **N5 — local ids.** F2's Condition is `hmn-c-{row id}.` — `ids.py` gains its function; `is_local_id` and the prefix test cover it.
- **N6 — the i18n chunk.** `origin/main` split the catalogue (`746f30a9`); after the merge the 500 kB note goes. F2's strings land in `strings/tani.js` (D27).
- **N7 — O15 is a proposal.** If the owner declines it, `send_from` is dropped from the rounds' query (`source.due_stays`) and the form; the column may stay (null = no cut-off).
- **N8 — the live lock.** `egress.LIVE_OPEN` stays False through F2–F5; opening it is the owner's word after O5 and O11, with its own reviewed commit and test change.
- **N9 — the merge.** On main `quality.view` is the 29th key, so `tres.manage` becomes the 30th; the route table's count and the permission tests follow at merge. Migration 0020 → main's next free number (0023 by today's queue), its docstrings and spec §13–§14 with it.
- **N10 — timings.** The feed's Postgres files now take minutes (worker 38 tests ≈ 2 min, settings 71 in two chunks): plan F2's gates in chunks from the start (F1a, Task 13).
- **N12 — carried from F0's notes:** N16 (a search answer with `search.mode: outcome` entries; a `link` that is a dict) and N17 (an exact hit with no server id reports «a search entry carries no local id»; a `keep_held` skip still updates the row's `admission_id`) are untouched by F1.
- **N13 — one refusal's words.** `egress_off` is one code with one text, written for the connection test («…; bağlantı sınanmadı»). On «Şimdi gönder» and «Yeniden dene» its second half reads oddly. F2 may give the hand routes' refusal its own sentence (a new code, or a neutral text for the old one with its tests).
- **N11 — small readings to re-check on the sandbox (F6):** the phone's domestic `0` form (az.py); the placeholder id's dot (O24); the `participant` without `type`; `$validate` and `no_reference` (O14); `code.text` as the LOINC display.
