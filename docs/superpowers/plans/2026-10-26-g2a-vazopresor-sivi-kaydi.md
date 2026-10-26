# G2-A3 Vazopresör/sıvı kaydı — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `clinical.chart` holder charts the septic-shock inputs — four vasopressor/inotrope rates, a crystalloid bolus, the weight, "antibiotic given" — from the patient screen's Meds box, with a time up to 24 h back; the card shows each running pressor with its time, "stopped" for a 0, and the last ten charted entries.

**Architecture:** The engine's `/clinical` door, units, bounds and audit already exist; the engine only adds two keys to the card's `meds` block (`pressors_at`, `charted`). The dashboard adds a modal form (`MedsChartForm`, the `BaselineForm` pattern), a `MedsBox` that owns the Meds section, one table of the six chartable fields (`medsFields.js`), a `recordedAt` argument on the store's `chart()`, and four-language strings.

**Tech Stack:** Python 3.12 / FastAPI / pytest (engine); React 18, Vite, Vitest + Testing Library (dashboard). Spec: `docs/superpowers/specs/2026-10-26-g2a-vazopresor-sivi-kaydi-design.md` (b2f272e; D4 amended by X1 below: the form is a Modal, as `BaselineForm`).

---

## Ground rules (every task)

- Worktree `/c/tmp/g2a-a3`, branch `feat/g2a-a3` off `main` `411d89c`. Never touch `c:\Users\User\Desktop\Project\Homunculus AI`. Never `git stash`. `dashboard/node_modules` is a junction to the shared install — never delete or reinstall it.
- Every source file is CRLF in the working tree (`git ls-files --eol` → `w/crlf`); new files are created CRLF too. Verify each touched file: `python -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'),b.count(b'\n'))" <file>` — equal numbers.
- Engine tests from `/c/tmp/g2a-a3/homunculus-engine`: `PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files>`; never `tests/test_infinity_vm_pilot.py`; no `DATABASE_URL`. Dashboard tests from `/c/tmp/g2a-a3/dashboard`: `npx vitest run <files>`; the whole suite `npx vitest run` (expect 89 files / 2441 tests at `411d89c`, 0 failed); build `npx vite build`.
- Synthetic names only (`Ayşe Sentetik`, `S-001`), made-up values. No clinical arithmetic in the browser (Decision 1). Strings in four languages (az default, tr, ru, en) with the Turkish source's placeholders; an az text equal to its tr text must be listed in `AZ_SAME_AS_TR` in `live/i18n/strings.test.js` only when reviewed — prefer a genuinely Azerbaijani wording.
- Tests assert the Azerbaijani (default) texts, as the existing patient-screen tests do.
- Commit with an explicit pathspec, message `feat(...)`/`test(...)`/`docs(...)` + ` (G2-A3)`, body says what and why, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Comments explain why, in the register of the file (read `BaselineForm.jsx`'s header before writing a component). Tag new lines `G2-A3` with the decision (`D1`…`D9`).
- Report back: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED, the commit sha, the test counts, deviations.

## File map

| File | Change |
|---|---|
| `homunculus-engine/src/homunculus/api/board.py` | `_meds`: `pressors_at`, `charted`, `MEDS_HISTORY = 10` (Task 1) |
| `homunculus-engine/tests/test_api_board_meds.py` | the new keys (Task 1) |
| `dashboard/src/live/data/boardStore.js`, `boardStore.test.js` | `chart(patientId, entries, recordedAt)` (Task 2) |
| `dashboard/src/live/i18n/strings/patient.js`, `strings.test.js` | the new keys, four languages (Task 3) |
| `dashboard/src/live/screens/patient/meds/medsFields.js` | the six fields: code, bounds, step, label/unit keys (Task 4) |
| `dashboard/src/live/screens/patient/meds/MedsChartForm.jsx`, `.test.jsx` | the modal form (Task 4) |
| `dashboard/src/live/screens/patient/meds/MedsBox.jsx`, `.test.jsx` | the Meds section: running pressors with times, history, the button (Task 5) |
| `dashboard/src/live/screens/patient/PatientScreen.jsx`, `.test.jsx` | renders `MedsBox`; `Meds` removed (Task 5) |
| `docs/homunculus-rehber-TR.md`, roadmap | docs (Task 6) |

---

### Task 1: The card's meds block carries times and a short history

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/board.py` (`_PRESSORS` ~line 125, `_meds` ~133–175)
- Modify: `homunculus-engine/tests/test_api_board_meds.py` (append a class)

- [ ] **Step 1: Failing tests** (append; the file's helpers `_chart(client, pid, entries, at)` and `_bed(client, pid)` exist, `T0` is `2026-09-08 09:00 UTC`)

```python
class TestChartedHistory:
    """G2-A3 (D5): the card says WHEN each pressor was last charted, that 0 means stopped, and what the
    last ten charted entries were — the Meds box reads these, no audit permission needed."""

    def test_each_pressor_carries_the_time_of_its_latest_entry(self, client):
        _chart(client, "bed-1", [{"code": "norepinephrine_rate", "value": 0.12}], T0)
        _chart(client, "bed-1", [{"code": "norepinephrine_rate", "value": 0.2}], T0 + timedelta(minutes=30))
        meds = _bed(client, "bed-1")["meds"]
        assert meds["pressors"]["norepinephrine"] == 0.2
        assert meds["pressors_at"]["norepinephrine"] == (T0 + timedelta(minutes=30)).isoformat()
        assert meds["pressors_at"]["dopamine"] is None

    def test_a_zero_rate_is_published_as_stopped_with_its_time(self, client):
        _chart(client, "bed-1", [{"code": "dopamine_rate", "value": 5}], T0)
        _chart(client, "bed-1", [{"code": "dopamine_rate", "value": 0}], T0 + timedelta(hours=1))
        meds = _bed(client, "bed-1")["meds"]
        assert meds["pressors"]["dopamine"] == 0 and meds["on_pressor"] is False
        assert meds["pressors_at"]["dopamine"] == (T0 + timedelta(hours=1)).isoformat()

    def test_the_history_is_newest_first_across_codes_with_the_doors_units(self, client):
        _chart(client, "bed-1", [{"code": "weight_kg", "value": 80}], T0)
        _chart(client, "bed-1", [{"code": "crystalloid_bolus_ml", "value": 500}], T0 + timedelta(minutes=10))
        _chart(client, "bed-1", [{"code": "norepinephrine_rate", "value": 0.1},
                                 {"code": "antibiotic_administered", "value": 1}], T0 + timedelta(minutes=20))
        charted = _bed(client, "bed-1")["meds"]["charted"]
        assert {c["code"] for c in charted[:2]} == {"antibiotic_administered", "norepinephrine_rate"}
        assert [c["code"] for c in charted[2:]] == ["crystalloid_bolus_ml", "weight_kg"]
        nor = next(c for c in charted if c["code"] == "norepinephrine_rate")
        assert nor == {"code": "norepinephrine_rate", "value": 0.1, "unit": "ug/kg/min",
                       "ts": (T0 + timedelta(minutes=20)).isoformat()}
        assert charted[2]["unit"] == "mL" and charted[3]["unit"] == "kg"

    def test_the_history_keeps_the_newest_ten(self, client):
        for i in range(12):
            _chart(client, "bed-1", [{"code": "crystalloid_bolus_ml", "value": 100 + i}], T0 + timedelta(minutes=i))
        charted = _bed(client, "bed-1")["meds"]["charted"]
        assert len(charted) == 10 and charted[0]["value"] == 111 and charted[-1]["value"] == 102

    def test_nothing_charted_means_an_empty_history_and_no_times(self, client):
        _chart(client, "bed-1", [{"code": "lactate", "value": 1.2}])
        meds = _bed(client, "bed-1")["meds"]
        assert meds["charted"] == [] and all(v is None for v in meds["pressors_at"].values())
```

- [ ] **Step 2: Run** `tests/test_api_board_meds.py` → the five fail with `KeyError`.

- [ ] **Step 3: Implement** — in `board.py`, beside `_PRESSORS`:

```python
#: The card's medication history: the newest charted entries of the inputs a clinician charts from
#: the Meds box (G2-A3, D5). Ten is a round's worth; the audit keeps everything.
MEDS_HISTORY = 10
_CHARTED_CODES = (SignalCode.NOREPINEPHRINE_RATE, SignalCode.EPINEPHRINE_RATE,
                  SignalCode.DOPAMINE_RATE, SignalCode.DOBUTAMINE_RATE,
                  SignalCode.CRYSTALLOID_BOLUS_ML, SignalCode.WEIGHT_KG,
                  SignalCode.ANTIBIOTIC_ADMINISTERED)


def _charted_history(state) -> list[dict]:
    """The last MEDS_HISTORY observations of the chartable medication inputs, newest first, in the
    door's units (G2-A3, D5). Read from the state, not the audit: the box must not need `audit.view`
    to show a nurse what she charted ten minutes ago. Equal stamps keep their charting order."""
    rows = [obs for code in _CHARTED_CODES for obs in state.history(code)]
    rows.sort(key=lambda obs: obs.timestamp, reverse=True)
    return [{"code": obs.code.value, "value": obs.value, "unit": obs.unit,
             "ts": obs.timestamp.isoformat()} for obs in rows[:MEDS_HISTORY]]
```

and in `_meds`'s returned dict, after `"on_pressor"`:

```python
        # G2-A3 (D5): when each pressor was last charted — a rate without its time cannot say
        # whether the infusion is current — and the short history the Meds box lists.
        "pressors_at": {name: (state.latest(code).timestamp.isoformat()
                               if state.latest(code) is not None else None)
                        for name, code in _PRESSORS.items()},
        "charted": _charted_history(state),
```

(`obs.unit` for a charted observation is the door's unit, `api/clinical.py` `CHARTABLE`.) Check `state.history` returns observations oldest-first (`state/timeline.py:27`) and that `Observation` has `.code`, `.unit`, `.timestamp` (`canonical.py`).

- [ ] **Step 4: Run** `tests/test_api_board_meds.py tests/test_api_board_sepsis.py tests/test_api_board_identity.py tests/test_api_clinical.py tests/test_api_discharge.py tests/test_rehydrate.py` → green. **Step 5: Commit** — `feat(api): the card's meds block carries each pressor's time and the last ten charted entries (G2-A3 D5)`.

---

### Task 2: The store's `chart()` takes the charted time

**Files:**
- Modify: `dashboard/src/live/data/boardStore.js` (`chart(patientId, entries)` ~line 362)
- Modify: `dashboard/src/live/data/boardStore.test.js` (find the existing `chart` tests: `grep -n "chart" boardStore.test.js`)

- [ ] **Step 1: Failing test** (in the existing describe for `chart`; mirror its setup)

```js
it("passes the charted time through to the API as recorded_at, and sends none when not given", async () => {
  // ...the file's own harness: a store over a mocked api with `api.chart` resolving {patient_id, charted: 1, alerts: []}
  await store.chart("S-001", [{ code: "weight_kg", value: 80 }], "2026-10-26T05:00:00.000Z");
  expect(api.chart).toHaveBeenLastCalledWith("S-001", [{ code: "weight_kg", value: 80 }], "2026-10-26T05:00:00.000Z");
  await store.chart("S-001", [{ code: "weight_kg", value: 81 }]);
  expect(api.chart).toHaveBeenLastCalledWith("S-001", [{ code: "weight_kg", value: 81 }], null);
});
```

- [ ] **Step 2: Run** `npx vitest run src/live/data/boardStore.test.js` → the new test fails (`api.chart` called with two arguments).

- [ ] **Step 3: Implement** — `async chart(patientId, entries, recordedAt = null)` and `api.chart(patientId, entries, recordedAt)`; extend the docstring: "`recordedAt`, an ISO-8601 instant with a zone, is the time the clinician says the observation was made (G2-A3, D3); the engine judges it no later than its own clock." `backendApi.chart` already forwards it (`backendApi.js:701`).

- [ ] **Step 4: Run** the file → green. **Step 5: Commit** — `feat(dashboard): store.chart passes the charted time to the API (G2-A3 D3)`.

---

### Task 3: Strings, four languages

**Files:**
- Modify: `dashboard/src/live/i18n/strings/patient.js` (add to each of `tr`, `az`, `ru`, `en` — the file's order; keep the keys together under a `// G2-A3 · ilaç/sıvı kaydı` comment in each language block)
- Modify: `dashboard/src/live/i18n/strings.test.js` only if an az text must equal tr (avoid)

- [ ] **Step 1: Add the keys** (Turkish source; translate az/ru/en yourself in the register of the neighbouring strings — az must differ from tr in wording where the sentence allows; the four drug names are the pharmacological names: tr/az `noradrenalin, adrenalin, dopamin, dobutamin`; ru `норадреналин, адреналин, допамин, добутамин`; en `norepinephrine, epinephrine, dopamine, dobutamine`):

```js
    // G2-A3 · ilaç/sıvı kaydı (Meds box → MedsChartForm)
    medsChartOpen: "Kayıt ekle",
    medsChartTitle: "İlaç / sıvı kaydı",
    medsChartIntro: "Girdiğin değerler motora gider; septik şok kuralı ve antibiyotik saati bunları okur. Boş bıraktığın alan gönderilmez.",
    medsPressor: "Vazopressör / inotrop",
    medsPressorNone: "Seçilmedi",
    medsRate: "Hız",
    medsRateUnit: "µg/kg/dk",
    medsRateHint: "Şu anki infüzyon hızı. Durdurmak için 0 yaz.",
    medsBolus: "Kristaloid bolus",
    medsBolusUnit: "mL",
    medsBolusHint: "Verilen tek bolus. Yanlış girilen bolus bu sürümde geri alınamaz; kural 3 saatlik toplamı sayar.",
    medsWeight: "Kilo",
    medsWeightUnit: "kg",
    medsWeightHint: "30 mL/kg hedefi için gerekli.",
    medsAntibiotic: "Antibiyotik verildi",
    medsAntibioticHint: "İşaretlersen kayıt saatinde verildi diye yazılır.",
    medsAt: "Kayıt saati",
    medsAtHint: "En çok 24 saat geriye; ileri saat kabul edilmez.",
    medsEmpty: "En az bir alan doldurulmalı.",
    medsRateNeedsPressor: "Hız için ilacı seç.",
    medsPressorNeedsRate: "Seçilen ilaç için hız yaz (durdurmak için 0).",
    medsNotNumber: "Düz bir ondalık sayı olmalı.",
    medsOutOfRange: "Beklenen aralığın ({low}–{high}) dışında — birim veya ondalık hatası olabilir.",
    medsAtFuture: "Kayıt saati ileride olamaz.",
    medsAtTooOld: "Kayıt saati 24 saatten eski olamaz.",
    medsSaving: "Kaydediliyor…",
    medsSaved: "Kaydedildi: {subject}. Motor bu hastayı yeniden değerlendirdi.",
    medsRefused: "{subject} için kayıt reddedildi: {reason}",
    medsNoRight: "Bu hesabın kayıt yetkisi yok.",
    medsDropped: "{subject} taburcu edilmiş; kayıt alınmadı.",
    medsMayHaveLanded: "{subject} için kayıt yanıt alamadı; kart yeniden okunuyor — İlaçlar kutusuna bak.",
    medsRunning: "{drug} {rate} µg/kg/dk · {time}",
    medsStopped: "{drug} durduruldu · {time}",
    medsHistoryTitle: "Son kayıtlar",
    medsHistoryNone: "Henüz kayıt yok.",
    medsHistoryAntibiotic: "antibiyotik verildi",
    medsDrugNorepinephrine: "noradrenalin",
    medsDrugEpinephrine: "adrenalin",
    medsDrugDopamine: "dopamin",
    medsDrugDobutamine: "dobutamin",
```

- [ ] **Step 2: Run** `npx vitest run src/live/i18n/strings.test.js` → green (four languages, placeholders, az≠tr). **Step 3: Commit** — `feat(i18n): the Meds box's charting strings in four languages (G2-A3 D7)`.

---

### Task 4: `medsFields.js` and the modal form

**Files:**
- Create: `dashboard/src/live/screens/patient/meds/medsFields.js`
- Create: `dashboard/src/live/screens/patient/meds/MedsChartForm.jsx`
- Create: `dashboard/src/live/screens/patient/meds/MedsChartForm.test.jsx`

Read first: `trends/BaselineForm.jsx` (whole — the house pattern: `Modal`, `Field`, `Input`, `Announce`, `useToast`, `mayHaveLanded`, `store.track`, `store.epoch`, `sending`/`mounted` refs, `flushSync` focus on the first error, the footer sentence), `trends/BaselineForm.test.jsx` (the harness: `mount` from `session/mount.testutil.jsx`, `token`/`profile`, `api.*` mocks), `ui/index.js` exports (is there a `Select`/`Checkbox`? if not, a native `<select>`/`<input type=checkbox>` inside `Field` with the house classes — look at `admin/` forms for the pattern), `i18n/dates.js` for a local-time ↔ ISO helper (if none, `toLocalInput`/`fromLocalInput` below live in `medsFields.js`).

- [ ] **Step 1: `medsFields.js`**

```js
// src/live/screens/patient/meds/medsFields.js — the inputs the Meds box charts (G2-A3, D1, D6):
// the engine's codes, the door's bounds (api/clinical.py PLAUSIBLE, mirrored here only as input
// min/max/step — the server stays authoritative) and the strings each reads.
export const PRESSORS = Object.freeze([
  { key: "norepinephrine", code: "norepinephrine_rate", labelKey: "patient.medsDrugNorepinephrine", min: 0, max: 20 },
  { key: "epinephrine", code: "epinephrine_rate", labelKey: "patient.medsDrugEpinephrine", min: 0, max: 20 },
  { key: "dopamine", code: "dopamine_rate", labelKey: "patient.medsDrugDopamine", min: 0, max: 100 },
  { key: "dobutamine", code: "dobutamine_rate", labelKey: "patient.medsDrugDobutamine", min: 0, max: 100 },
]);
export const RATE_STEP = 0.01;
export const BOLUS = Object.freeze({ code: "crystalloid_bolus_ml", min: 0, max: 10000, step: 1 });
export const WEIGHT = Object.freeze({ code: "weight_kg", min: 0.3, max: 400, step: 0.1 });
export const ANTIBIOTIC = Object.freeze({ code: "antibiotic_administered" });
export const BACKDATE_MS = 24 * 60 * 60 * 1000;

/** A typed number: "" when empty, its number (a decimal comma read as a point), NaN when not a plain
 *  finite non-negative decimal — the BaselineForm rule, without the sign (no dose is negative). */
export function number(raw) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (s === "") return "";
  if (!/^\d+(\.\d+)?$/.test(s)) return Number.NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** What the form would send and each field's problem `{ key, params? }` by field name (D6). `now` is
 *  the browser's clock in ms. `draft`: { pressor: key|"", rate, bolus, weight, antibiotic: bool,
 *  at: "YYYY-MM-DDTHH:MM" }. */
export function checkDraft(draft, now) {
  const errors = {};
  const entries = [];
  const pressor = PRESSORS.find((p) => p.key === draft.pressor) ?? null;
  const rate = number(draft.rate);
  if (pressor && rate === "") errors.rate = { key: "patient.medsPressorNeedsRate" };
  else if (!pressor && rate !== "") errors.pressor = { key: "patient.medsRateNeedsPressor" };
  else if (pressor && Number.isNaN(rate)) errors.rate = { key: "patient.medsNotNumber" };
  else if (pressor && (rate < pressor.min || rate > pressor.max)) errors.rate = { key: "patient.medsOutOfRange", params: { low: pressor.min, high: pressor.max } };
  else if (pressor) entries.push({ code: pressor.code, value: rate });
  for (const [field, spec] of [["bolus", BOLUS], ["weight", WEIGHT]]) {
    const n = number(draft[field]);
    if (n === "") continue;
    if (Number.isNaN(n)) errors[field] = { key: "patient.medsNotNumber" };
    else if (n < spec.min || n > spec.max) errors[field] = { key: "patient.medsOutOfRange", params: { low: spec.min, high: spec.max } };
    else entries.push({ code: spec.code, value: n });
  }
  if (draft.antibiotic) entries.push({ code: ANTIBIOTIC.code, value: 1 });
  const at = fromLocalInput(draft.at);
  if (!Number.isFinite(at)) errors.at = { key: "patient.medsNotNumber" };
  else if (at > now + 60_000) errors.at = { key: "patient.medsAtFuture" };       // a minute of skew is not "the future"
  else if (at < now - BACKDATE_MS) errors.at = { key: "patient.medsAtTooOld" };
  const empty = entries.length === 0 && Object.keys(errors).length === 0;
  return { errors, entries, empty, recordedAt: Number.isFinite(at) ? new Date(at).toISOString() : null };
}

/** `datetime-local` ↔ instant, in the browser's zone. The ISO sent is UTC ("Z"), which carries a zone
 *  (the door refuses a stamp without one). */
export function toLocalInput(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value ?? ""))) return Number.NaN;
  return new Date(value).getTime();          // parsed as local time by the browser
}
```

- [ ] **Step 2: Failing tests** for `checkDraft`/`toLocalInput`/`fromLocalInput` first (pure functions), then the component:

```js
// MedsChartForm.test.jsx — the form holds back what the engine would refuse, sends exactly what was
// filled with the charted time, and tells the clinician what happened — on the toast, named after the bed.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { MedsChartForm } from "./MedsChartForm.jsx";
import { checkDraft, fromLocalInput, toLocalInput } from "./medsFields.js";

const NOW = Date.parse("2026-10-26T09:00:00+04:00");
const CHARTABLE = ["board.view", "alerts.ack", "clinical.chart"];
const PATIENT = { patient_id: "S-001", display_name: "Ayşe Sentetik", measuredAt: {} };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const draft = (over = {}) => ({ pressor: "", rate: "", bolus: "", weight: "", antibiotic: false, at: toLocalInput(NOW), ...over });

describe("checkDraft", () => {
  it("sends exactly the fields filled, with the charted time as an ISO instant", () => {
    const r = checkDraft(draft({ pressor: "norepinephrine", rate: "0,12", bolus: "500", antibiotic: true }), NOW);
    expect(r.errors).toEqual({});
    expect(r.entries).toEqual([{ code: "norepinephrine_rate", value: 0.12 }, { code: "crystalloid_bolus_ml", value: 500 }, { code: "antibiotic_administered", value: 1 }]);
    expect(Date.parse(r.recordedAt)).toBe(NOW);
  });
  it("a rate of 0 is an entry (stopped), an empty form is empty, a rate without a drug is held", () => {
    expect(checkDraft(draft({ pressor: "dopamine", rate: "0" }), NOW).entries).toEqual([{ code: "dopamine_rate", value: 0 }]);
    expect(checkDraft(draft(), NOW).empty).toBe(true);
    expect(checkDraft(draft({ rate: "0.1" }), NOW).errors.pressor.key).toBe("patient.medsRateNeedsPressor");
    expect(checkDraft(draft({ pressor: "dopamine" }), NOW).errors.rate.key).toBe("patient.medsPressorNeedsRate");
  });
  it("holds a slipped decimal before it is sent, with the door's bounds", () => {
    expect(checkDraft(draft({ pressor: "norepinephrine", rate: "25" }), NOW).errors.rate).toEqual({ key: "patient.medsOutOfRange", params: { low: 0, high: 20 } });
    expect(checkDraft(draft({ weight: "0.1" }), NOW).errors.weight.key).toBe("patient.medsOutOfRange");
    expect(checkDraft(draft({ bolus: "1e3" }), NOW).errors.bolus.key).toBe("patient.medsNotNumber");
  });
  it("refuses a future time and one older than 24 h, and tolerates a minute of skew", () => {
    expect(checkDraft(draft({ weight: "80", at: toLocalInput(NOW + 10 * 60_000) }), NOW).errors.at.key).toBe("patient.medsAtFuture");
    expect(checkDraft(draft({ weight: "80", at: toLocalInput(NOW - 25 * 3600_000) }), NOW).errors.at.key).toBe("patient.medsAtTooOld");
    expect(checkDraft(draft({ weight: "80", at: toLocalInput(NOW + 30_000) }), NOW).errors).toEqual({});
    expect(fromLocalInput("2026-10-26T09:00")).toBe(new Date("2026-10-26T09:00").getTime());
  });
});

describe("the form", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  async function open({ answer } = {}) {
    vi.setSystemTime(NOW);
    const onClose = vi.fn(); const onSaved = vi.fn();
    let api;
    const mounted = await mount(
      <MedsChartForm patient={PATIENT} bed="REA-01 · 2" onChart={(entries, at) => api.chart("S-001", entries, at)} onClose={onClose} onSaved={onSaved} />,
      { access: token({ perms: CHARTABLE }), me: profile({ perms: CHARTABLE }),
        setup: (a) => { api = a; a.chart.mockImplementation(answer ?? (() => Promise.resolve({ patient_id: "S-001", charted: 1, alerts: [] }))); } });
    return { ...mounted, api, onClose, onSaved };
  }
  const dialog = () => screen.getByRole("dialog", { name: /Dərman \/ maye qeydi/ });
  const save = () => act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name: "Yadda saxla" })); await settle(); });

  it("sends the filled entries and the time, says so on the toast, and closes", async () => {
    const { api, onClose, onSaved } = await open();
    fireEvent.change(within(dialog()).getByLabelText(/Çəki/), { target: { value: "80" } });
    await save();
    expect(api.chart).toHaveBeenCalledWith("S-001", [{ code: "weight_kg", value: 80 }], new Date(NOW).toISOString());
    expect(document.body.textContent).toMatch(/REA-01 · 2/);
    expect(onSaved).toHaveBeenCalled(); expect(onClose).toHaveBeenCalled();
  });
  it("an empty form sends nothing and says so; a held field keeps the draft and gets the focus", async () => {
    const { api } = await open();
    await save();
    expect(api.chart).not.toHaveBeenCalled();
    fireEvent.change(within(dialog()).getByLabelText(/Sürət/), { target: { value: "0.1" } });
    await save();
    expect(api.chart).not.toHaveBeenCalled();
    expect(within(dialog()).getByText(/dərmanı seç/i)).toBeInTheDocument();
  });
  it("a refusal goes to the toast with the server's sentence and the draft stays", async () => {
    const { api } = await open({ answer: () => Promise.reject(Object.assign(new Error("weight_kg: 900 beklenen aralığın dışında"), { status: 400 })) });
    fireEvent.change(within(dialog()).getByLabelText(/Çəki/), { target: { value: "80" } });
    await save();
    expect(document.body.textContent).toMatch(/beklenen aralığın dışında/);
    expect(within(dialog()).getByLabelText(/Çəki/)).toHaveValue("80");
  });
  it("a discharged number's answer (200 dropped) is not a save", async () => {
    await open({ answer: () => Promise.resolve({ patient_id: "S-001", dropped: "discharged" }) });
    fireEvent.change(within(dialog()).getByLabelText(/Çəki/), { target: { value: "80" } });
    await save();
    expect(document.body.textContent).toMatch(/tərxis/i);   // patient.medsDropped (az)
  });
});
```

Adjust the Azerbaijani label regexes (`Çəki`, `Sürət`, `Dərman / maye qeydi`, `tərxis`, `dərmanı seç`) to the texts you wrote in Task 3. If `mount`'s `setup` receives the api differently, read `session/mount.testutil.jsx` and adapt the harness; the point is that `onChart` calls the mocked `api.chart`.

- [ ] **Step 3: `MedsChartForm.jsx`** — a `Modal` titled `${t("patient.medsChartTitle")} · ${bed}`, intro `Note` (`patient.medsChartIntro`), fields in this order: weight (hint), pressor `<select>` (`patient.medsPressorNone` + the four from `PRESSORS`), rate (`inputMode="decimal"`, hint, unit in the label), bolus (hint with the limitation), antibiotic checkbox (hint), time (`<input type="datetime-local" max={toLocalInput(now)} min={toLocalInput(now - BACKDATE_MS)}>`), footer sentence + Cancel + Save (`type="submit" form=…`), `Announce` for busy/held. Draft state as `checkDraft` expects; `tried` shows errors; first error gets focus (`flushSync`). Save: `sending`/`busy` guards; `const { entries, recordedAt, empty, errors } = checkDraft(draft, Date.now())`; empty → footer says `patient.medsEmpty`, nothing sent; `const answer = await onChart(entries, recordedAt)` (the box hands in `board.store.chart`, which reloads the board, Task 2); `answer?.dropped` → toast `patient.medsDropped` (warn) + close; else toast `patient.medsSaved` (`subject: bed`) + `onSaved()` + close; errors as `BaselineForm`: 403 → `medsNoRight`, `mayHaveLanded` → `medsMayHaveLanded` + close, else `medsRefused` with `apiErrorText(t, err)` and the draft stays. Props: `patient, bed, onChart, onClose, onSaved`. Keep the component under ~220 lines; the file header explains the decisions (D2 current rate / 0 stopped, D3 24 h, D6 server authoritative, X1 Modal).

- [ ] **Step 4: Run** `npx vitest run src/live/screens/patient/meds/` → green. **Step 5: Commit** — `feat(dashboard): the Meds charting form — pressor rate, bolus, weight, antibiotic, with a time up to 24 h back (G2-A3 D2, D3, D4, D6)`.

---

### Task 5: `MedsBox` and the patient screen

**Files:**
- Create: `dashboard/src/live/screens/patient/meds/MedsBox.jsx`, `MedsBox.test.jsx`
- Modify: `dashboard/src/live/screens/patient/PatientScreen.jsx` (remove `Meds`, render `<MedsBox meds={patient?.meds} bed={bed} canChart={canChart} onChart={(entries, at) => board.store.chart(id, entries, at)} />` where `Meds` was; drop the now-unused imports), `PatientScreen.test.jsx` (the Meds assertions, if any, move to `MedsBox.test.jsx`; add one test: with `clinical.chart` the box offers the «Kayıt ekle» button (az text) and the modal opens; without it, no button)

- [ ] **Step 1: Failing tests** (`MedsBox.test.jsx`; render through `mount` with a `meds` payload):

```js
const MEDS = {
  pressors: { norepinephrine: 0.12, epinephrine: null, dopamine: 0, dobutamine: null },
  pressors_at: { norepinephrine: "2026-10-26T04:50:00+00:00", epinephrine: null, dopamine: "2026-10-26T04:30:00+00:00", dobutamine: null },
  on_pressor: true, antibiotic_given: null, antibiotic_at: null, antibiotic_clock: null, creatinine: null, weight_kg: 80,
  charted: [
    { code: "norepinephrine_rate", value: 0.12, unit: "ug/kg/min", ts: "2026-10-26T04:50:00+00:00" },
    { code: "dopamine_rate", value: 0, unit: "ug/kg/min", ts: "2026-10-26T04:30:00+00:00" },
    { code: "crystalloid_bolus_ml", value: 500, unit: "mL", ts: "2026-10-26T04:10:00+00:00" },
    { code: "antibiotic_administered", value: 1, unit: "bool", ts: "2026-10-26T04:00:00+00:00" },
  ],
};
it("lists each running pressor with its time and says a 0 is stopped", …)   // "noradrenalin 0.12 µg/kg/dq · <hhmm>" and "dopamin dayandırıldı · <hhmm>" — use hhmm(Date.parse(ts)) in the expectation (the browser's zone)
it("lists the last entries newest first, antibiotic as a sentence", …)
it("offers the charting button only with clinical.chart, and the dialog opens on it", …)
it("the antibiotic line is unchanged: unknown / given at / pending / overdue", …)   // move the existing PatientScreen expectations here if they exist (grep "antibiotic" in PatientScreen.test.jsx)
```

- [ ] **Step 2: `MedsBox.jsx`** — the `Meds` function body moved from `PatientScreen.jsx` (keep its comments), plus: the pressor lines from `pressors` + `pressors_at` (`patient.medsRunning` / `patient.medsStopped` with `drug` = `t(labelKey)` from `PRESSORS`, `rate`, `time` = `hhmm(Date.parse(ts))`), the history `<ul>` (`patient.medsHistoryTitle`; each `<li>`: `hhmm · drug/entry name · value unit`; antibiotic as `patient.medsHistoryAntibiotic`; empty → `patient.medsHistoryNone`), the `Box`'s `right` slot holding the «Kayıt ekle» `Button` when `canChart` (hidden otherwise — never a disabled button), `open` state → `<MedsChartForm patient bed onChart onClose onSaved />`. `onSaved` does nothing extra (the store's `chart` already reloads the board). A `meds` of `null` keeps today's "no meds" sentence and still offers the button when `canChart` (a patient nobody charted anything for is exactly who needs it).

- [ ] **Step 3: Run** `npx vitest run src/live/screens/patient/` → green; then the whole suite `npx vitest run` (89+ files, 0 failed) and `npx vite build`. **Step 4: Commit** — `feat(dashboard): the Meds box shows each pressor with its time, the last charted entries, and opens the charting form (G2-A3 D4, D5)`.

---

### Task 6: Docs

- `docs/homunculus-rehber-TR.md`: in the patient-screen section (grep `İlaçlar` / `G1-11` / `patient.meds`), a short clinician paragraph: how to chart a pressor (current rate, 0 = stopped), a bolus, the weight and the antibiotic from the Meds box; the time can be up to 24 h back; a wrong rate is corrected with a new entry; a wrong bolus cannot be undone in this version; what the card shows (rate · time, stopped, last ten entries). CRLF.
- The roadmap row `G2-A3` after `G2-A11` in `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, the table's style: slice, branch `feat/g2a-a3` (main `411d89c`), spec, plan, status «kodda, main'e alınmadı; VM: yok», X/O items.
- Commit — `docs: G2-A3 vazopresör/sıvı kaydı in the Turkish guide and the roadmap`.

### Task 7: Final review and fold (controller)

- Final whole-branch review (opus): spec D1–D9, Decision 1 (no arithmetic in the browser), a11y, four languages, CRLF, no PHI; engine + dashboard gates; `vite build`.
- Plan fold; push `feat/g2a-a3`; the merge waits for the user's word; VM deploy with the next deploy.

## Done on the branch (fold, 2026-10-26)

The plan is the branch `feat/g2a-a3` at `9138977`, off `main` `411d89c`.

| Task | Commit | What it pinned |
|---|---|---|
| 1 | `326c6f0` | `_meds.pressors_at`, `charted`, `MEDS_HISTORY = 10`; 5 tests |
| 2 | `ad3b98d`, `3b2a950` | `store.chart(patientId, entries, recordedAt)`; the sepsis box's two assertions take the third argument |
| 3 | `ca71fa0` | 40 `patient.meds*` keys in four languages; six reviewed az = tr entries (units, drug names) |
| 4 | `40f97b8` | `medsFields.js` (`checkDraft`, `toLocalInput`/`fromLocalInput`), `MedsChartForm.jsx` (Modal, X1); 8 tests |
| 5 | `9a469da` | `MedsBox.jsx` (pressor lines with time, "stopped", history, the button, the form keyed by patient), `PatientScreen` wiring, `onlyWrite` → three things; 4 + 1 tests |
| 6 | `d355255` | the Turkish guide's «Vazopressör / sıvı kaydı» bullet, the roadmap row |
| fix | `efbb169` | `apiErrors` mapping for A-11's `kabul` detail (the dashboard suite was red on `main` since `411d89c`), az `medsWeightUnit` = kq |
| review | `76ef7c5`, `9138977` | the final review's fixes (X2–X8 below) |

**Final review (opus, at `efbb169`): FIX FIRST → fixed.** Held: a form cannot follow the clinician to another patient (the form is keyed by patient, an in-flight save keeps its patient); units are the door's; a `dropped` answer is never a save; a refusal is never a save and a save never a refusal; a may-have-landed answer closes and discards the draft, so a bolus is not re-sent. Found and fixed: (I1) a same-minute correction showed below the wrong value in the card's history while `latest()` read the correction → X2; (I2) the record time was fixed at the form's opening → X3; (I3) weak tests (title matched instead of the toast, draft "kept" by the harness, focus not asserted; 403, may-have-landed, double press, patient switch untested) → tests added; (M1) times without a date mislead with 24-h back-dating → X4; (M3) a bad time said "not a number" → X5; (M4/M5) az units mixed kq/kg, ru "час антибиотика", tr informal register, "İlaçlar kutusu" vs the box's title → wording fixed; (M7/M8) dead `step` constants and a stale `patient` prop → removed; (M9) the may-have-landed sentence promised a re-read nothing does → reworded; (M2) a correction dated earlier than the wrong entry never becomes current — by design, said in the guide; (M6) a `null` answer (board restarted mid-write) counts as saved, as the sepsis box does → X6.

**Counts.** At `411d89c`: engine 2413/655, dashboard 89 files / 2441. At `9138977`: engine **2420 passed / 654 skipped / 0 failed** (a first run showed one failure that a rerun did not reproduce — a flake, test not identified; noted as O8), dashboard **91 files / 2466 tests / 0 failed**, `vite build` ok; the tests pass under UTC, Europe/London, America/New_York, Asia/Kolkata and Pacific/Chatham (no zone dependence). CRLF on every touched file; no PHI.

## Departures

| # | Where | What | Why |
|---|---|---|---|
| X1 | Task 4 | The form is a `Modal` opened from the Meds box, not an inline form inside the box (spec D4) | the house pattern (`BaselineForm`): focus, phone layout, Escape, one live region |
| X2 | `76ef7c5` | `_charted_history` builds each code's rows newest-charted-first before the stable sort: equal stamps of one code list the later-charted first (what `latest()` and the rule read); across codes, the table's order | review I1: the correction flow (D3) often reuses the same minute |
| X3 | `9138977` | The record time follows the clock until the clinician touches the field (`useNow(60_000)`), and an untouched field is stamped at the moment Save is pressed | review I2: a form opened at 14:00 and saved at 15:30 charted at 14:00 — a rate could land older than another desk's entry, a bolus left the 3-h window early |
| X4 | `9138977` | Card times carry `dd.MM` when the stamp's local date is not today (`ddmm` + `hhmm`); `MedsBox` takes `nowMs` from the screen | review M1: with 24-h back-dating, "· 09:30" could be yesterday's |
| X5 | `9138977` | `patient.medsAtInvalid` (four languages) for a time that does not parse; spec §6 named no key | review M3 |
| X6 | Task 4 | The form treats any answer that is not `dropped` — including `null` from a board restart mid-write — as saved; the store is unchanged (spec §5 put the `dropped` detection in the store) | the door answers only the two shapes; the sepsis box does the same with `null`; the write did land |
| X7 | Task 4 | `dropped`, 403 and may-have-landed close the form (spec §4 said the form keeps its values); the server's refusal appears on the toast only (D8 said "in text as well") | the house rule (`refusal.js`): a refusal is named after the bed on the toast, never also inline; only a 400 keeps the draft |
| X8 | Task 1 | Seven codes in the history, not six: `antibiotic_administered` is listed (as a sentence when 1) | the antibiotic is charted from the same form and belongs in the same round's list |

## Open items

- O1–O4: see the spec §8.
- **O5** `charted_by` is not on the card (O3) and the history prints the engine's code for an unknown code or an antibiotic 0 — fine until a second feed charts these codes.
- **O6** A native Azerbaijani reader reviews the new az strings (units "mkq/kq/dəq", the formal register) with the rest of the pilot's az texts.
- **O7** The az/tr/ru values print with a decimal point ("0.12") while the form accepts a comma — as elsewhere in the dashboard; one rule for the whole dashboard later.
- **O8** One engine test failed once in the full no-DB gate at `9138977` and passed on the rerun (2420/654); the id was not captured — run the gate with `-rf` next time and pin the flake.
