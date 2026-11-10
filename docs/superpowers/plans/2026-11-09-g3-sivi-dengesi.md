# G3-03 «Sıvı dengesi» (Fluid balance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The nurse's intake/output ledger on the patient screen — every volume a `/clinical` chart observation, every sum done by the server (`GET /patients/{id}/fluids`), a «Sıvı» box with totals, shift subtotals, the last complete day, an hourly chart, an entry dialog and «hatalı giriş».

**Architecture:** Spec `docs/superpowers/specs/2026-11-09-g3-sivi-dengesi-design.md` (35c2f780). Engine: five new signal codes at G3-01's door; a pure module `homunculus/api/fluids.py` reads the patient's `chart`/`chart_retract` audit rows of the last 48 h (as `api/trends.py` `_manual` does) and computes the windows; one read route beside `/trends`. The fluid day comes from Görevlerim's task settings (`tasks` store in `create_app`). Dashboard: `screens/patient/fluids/` (box, chart, dialog, codes, hook), one line in `PatientScreen.jsx`, the `sivi` i18n namespace. No migration.

**Tech Stack:** Python 3.12 / FastAPI / pytest; React 18 / vitest / Testing Library.

---

## Ground rules

Same as `docs/superpowers/plans/2026-11-09-g3-gorevlerim.md` «Ground rules» (read it): worktree commands, foreground test runs only, never the whole suite from a subagent (the controller runs it), never `DATABASE_URL`, never `tests/test_infinity_vm_pilot.py`, never `git stash`, pathspec commits, commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Engine worktree `/c/tmp/g3-sivi` (branch `feat/g3-sivi`); dashboard worktree `/c/tmp/g3-sivi-web` (branch `feat/g3-sivi-web`, merged back with `--no-ff` by the controller). Untracked `homunculus-engine/alembic/versions/0016_bed_occupancy.py` may exist; never add it.

---

### Task E1: The codes at the door

**Files:** `homunculus-engine/src/homunculus/canonical.py`, `homunculus-engine/src/homunculus/api/clinical.py`; test `homunculus-engine/tests/test_fluids_door.py`.

- [ ] **Step 1: Failing tests**

```python
# homunculus-engine/tests/test_fluids_door.py
"""G3-03 (spec D2–D4): the fluid codes at /clinical — accepted, bounded, time-ruled, withdrawable."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.clinical import FLUID_CODES, RETRACTABLE_CODES
from homunculus.api.identity import Caller

TOKEN = "tok"
NURSE = {"Authorization": "Bearer nurse-jwt"}
PEOPLE = {"nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                              perms=frozenset({"board.view", "clinical.chart"}))}
NEW = ["iv_fluid_ml", "enteral_ml", "blood_product_ml", "other_intake_ml", "drain_output_ml", "other_output_ml"]


async def _resolve(credential):
    return PEOPLE.get(credential)


@pytest.fixture()
def client():
    with TestClient(create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve)) as c:
        yield c


def _chart(client, entries, at=None):
    body = {"entries": entries}
    if at is not None:
        body["recorded_at"] = at.isoformat()
    return client.post("/clinical/S-001", json=body, headers=NURSE)


def test_the_eight_fluid_codes_and_their_withdrawal():
    assert FLUID_CODES == frozenset(NEW + ["crystalloid_bolus_ml", "urine_output_ml"])
    assert FLUID_CODES <= RETRACTABLE_CODES


@pytest.mark.parametrize("code", NEW)
def test_a_new_code_is_accepted_and_bounded(client, code):
    assert _chart(client, [{"code": code, "value": 250}]).status_code == 200
    assert _chart(client, [{"code": code, "value": 5001}]).status_code == 422
    assert _chart(client, [{"code": code, "value": -1}]).status_code == 422


def test_the_time_rule_covers_fluids(client):
    now = datetime.now(timezone.utc)
    assert _chart(client, [{"code": "urine_output_ml", "value": 100}], now - timedelta(hours=25)).status_code == 422
    assert _chart(client, [{"code": "urine_output_ml", "value": 100}], now + timedelta(minutes=10)).status_code == 422
    assert _chart(client, [{"code": "urine_output_ml", "value": 100}], now - timedelta(hours=23)).status_code == 200


def test_a_fluid_entry_and_a_bolus_can_be_withdrawn(client):
    saved = _chart(client, [{"code": "drain_output_ml", "value": 80}, {"code": "crystalloid_bolus_ml", "value": 500}]).json()
    for item in saved["entries"]:
        r = client.post(f"/clinical/S-001/entries/{item['entry']}/retract", json={"reason": "yanlış hastaya girildi"}, headers=NURSE)
        assert r.status_code == 200, r.text
```
Read `tests/test_bedside_retract.py` and `tests/test_bedside_preview.py` first: if the door answers a refusal with another status than 422 (e.g. 400), use what they assert.

- [ ] **Step 2: Run, see it fail** — `… -m pytest -p no:cacheprovider -q tests/test_fluids_door.py 2>&1 | tail -3` → ImportError `FLUID_CODES`.

- [ ] **Step 3: Implement**

`canonical.py`, after `CRYSTALLOID_BOLUS_ML`:
```python
    # G3-03 Sıvı dengesi: the nurse's fluid ledger, mL per entry (spec D2). No rule reads them.
    IV_FLUID_ML = "iv_fluid_ml"                   # IV fluid / infusion volume since the last entry
    ENTERAL_ML = "enteral_ml"                     # enteral or oral intake
    BLOOD_PRODUCT_ML = "blood_product_ml"         # blood product given
    OTHER_INTAKE_ML = "other_intake_ml"
    DRAIN_OUTPUT_ML = "drain_output_ml"
    OTHER_OUTPUT_ML = "other_output_ml"           # NG, vomit, stool estimate
```
`clinical.py`: in `CHARTABLE` add the six `"mL"` units; in the bounds dict add `(0.0, 5000.0)` for each; then, above `RETRACTABLE_CODES`:
```python
#: G3-03 (spec D2): the fluid ledger's eight codes — five new, the meds chart's bolus and the urine output.
FLUID_CODES = frozenset(code.value for code in (
    SignalCode.IV_FLUID_ML, SignalCode.CRYSTALLOID_BOLUS_ML, SignalCode.ENTERAL_ML, SignalCode.BLOOD_PRODUCT_ML,
    SignalCode.OTHER_INTAKE_ML, SignalCode.URINE_OUTPUT_ML, SignalCode.DRAIN_OUTPUT_ML, SignalCode.OTHER_OUTPUT_ML))
```
Change `RETRACTABLE_CODES` to `frozenset(...) | FLUID_CODES` and extend its comment: «G3-03 (D4): the fluid ledger's volumes too — a volume is corrected by withdrawal, not by a new entry; a departure from X22 for the bolus». In `_check_bedside`, bound the time when `codes & (BEDSIDE_VITALS | _FLUID_SIGNALS)` with `_FLUID_SIGNALS = frozenset(SignalCode(c) for c in FLUID_CODES)`. If `RETRACT_NOT_BEDSIDE`'s sentence names only the bedside set, extend it to «yalnız yatak başı ölçümü ve sıvı girişi hatalı giriş olarak işaretlenebilir» and report the change (the dashboard maps that sentence in `apiErrors.js`).

- [ ] **Step 4: Run** `tests/test_fluids_door.py tests/test_bedside_retract.py tests/test_bedside_preview.py` plus any `tests/test_meds*.py` → PASS.
- [ ] **Step 5: Commit** `feat(fluids): the fluid ledger's codes at the door — bounds, 24-h time rule, withdrawal (G3-03 D2–D4)`.

---

### Task E2: `api/fluids.py` — the pure computation

**Files:** create `homunculus-engine/src/homunculus/api/fluids.py`; test `homunculus-engine/tests/test_fluids.py`.

- [ ] **Step 1: Failing tests** — `tests/test_fluids.py` builds `FluidEntry` lists by hand (fixed offset `BAKU = timezone(timedelta(hours=4))`) and checks:
  - `fluid_day(now, BAKU, 8, 20)` with now 14:00 Baku → day 08:00→08:00 next, last day the 24 h before, shift A 08–20, shift B 20–08; now 03:30 Baku → the day started yesterday 08:00; exactly 08:00 → a new day.
  - `totals(entries, since, until)` sums intake and output codes separately; `balance = in − out`; withdrawn entries excluded; `by_code` holds only charted codes.
  - `hourly(entries, day_start)` → 24 rows; an entry at 09:59 lands in row 1; `balance_cum` accumulates.
  - `urine_rate(entries, 70, now)` → sum of urine in (now−6 h, now] / 6 / 70, rounded to 2; None without weight; None without urine entries in the window.
  - `hours_with(entries, "urine_output_ml", since)` counts distinct hours of the 24 from `since` that carry a non-withdrawn urine entry.
  - `patient_fluids(...)` end-to-end with an `InMemoryAuditLog` holding `chart` and `chart_retract` rows written the way `api/clinical.py` writes them (`AuditEvent(hospital, "chart", pid, code, {"value", "unit", "obs_ts", "charted_by"})`; retract `{"entry": id, "reason", "retracted_by"}`) → the §3 keys of the spec: `patient_id, now, day, last_day, shifts, codes, hours, totals{today,shift_a,shift_b,last_day}, urine_last_day_ml, hours_with_urine_last_day, weight_kg, urine_ml_kg_h_last_6h, sofa_renal_reference, entries`.

- [ ] **Step 2: Run, see it fail.**

- [ ] **Step 3: Implement**

```python
# homunculus-engine/src/homunculus/api/fluids.py
"""Sıvı dengesi (G3-03): the patient's intake/output ledger, summed by the server (spec D6, D7).

Every volume is a `chart` row G3-01's door wrote (`api/clinical.py` FLUID_CODES); a `chart_retract` row withdraws
one. This module reads the last 48 h of those rows for one patient — as `api/trends.py` `_manual` reads the hand
entries — and computes the fluid day (from Görevlerim's first shift start, in the tenant's zone), the shift
subtotals, the hourly ledger, the last complete day, the urine rate. No rule reads any of it; the only sourced
numbers are the SOFA renal bands of Sepsis-3 (sepsis-3-jama-2016), returned as static reference text."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from homunculus.api.audit import AuditLog
from homunculus.api.clinical import BEDSIDE_SKEW, RETRACT

INTAKE: tuple[str, ...] = ("iv_fluid_ml", "crystalloid_bolus_ml", "enteral_ml", "blood_product_ml", "other_intake_ml")
OUTPUT: tuple[str, ...] = ("urine_output_ml", "drain_output_ml", "other_output_ml")
URINE = "urine_output_ml"
READ_LIMIT = 5000
SOFA_RENAL_REFERENCE = {"source": "sepsis-3-jama-2016",
                        "bands": [{"below_ml_day": 500, "points": 3}, {"below_ml_day": 200, "points": 4}]}
HOUR = timedelta(hours=1)


@dataclass(frozen=True)
class FluidEntry:
    entry: int
    code: str
    value: float
    at: datetime
    by: str
    retracted: dict | None = None


def _iso(at):
    return None if at is None else at.astimezone(timezone.utc).isoformat()


def _instant(raw):
    if not isinstance(raw, str):
        return None
    try:
        at = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return at if at.tzinfo is not None else at.replace(tzinfo=timezone.utc)


def read_entries(audit: AuditLog, hospital: str, patient_id: str, *, since: datetime, until: datetime) -> list[FluidEntry]:
    rows = audit.records(tenant=hospital, patient_id=patient_id, event_types={"chart", RETRACT},
                         since=since - BEDSIDE_SKEW, limit=READ_LIMIT, newest=True)
    withdrawn = {}
    for rec in rows:
        entry = rec.payload.get("entry")
        if rec.event_type == RETRACT and isinstance(entry, int) and not isinstance(entry, bool):
            withdrawn[entry] = {"reason": str(rec.payload.get("reason") or ""),
                                "by": str(rec.payload.get("retracted_by") or ""), "at": _iso(_instant(rec.ts))}
    out = []
    for rec in rows:
        if rec.event_type != "chart" or rec.subject not in INTAKE + OUTPUT:
            continue
        at, value = _instant(rec.payload.get("obs_ts")), rec.payload.get("value")
        if at is None or not isinstance(value, (int, float)) or isinstance(value, bool) or not since <= at <= until:
            continue
        out.append(FluidEntry(rec.id, rec.subject, float(value), at, str(rec.payload.get("charted_by") or ""),
                              withdrawn.get(rec.id)))
    return sorted(out, key=lambda e: (e.at, e.entry))


def fluid_day(now: datetime, zone, start_a: int, start_b: int) -> dict:
    local = now.astimezone(zone)
    today = datetime(local.year, local.month, local.day, start_a, 0, tzinfo=zone)
    start = today if today <= local else today - timedelta(days=1)
    split = start + timedelta(hours=(start_b - start_a) % 24)
    end = start + timedelta(hours=24)
    return {"day": (start, end), "last_day": (start - timedelta(hours=24), start),
            "shift_a": (start, split), "shift_b": (split, end)}


def totals(entries: list[FluidEntry], since: datetime, until: datetime) -> dict:
    by_code: dict[str, float] = {}
    for e in entries:
        if e.retracted is None and since <= e.at < until:
            by_code[e.code] = by_code.get(e.code, 0.0) + e.value
    tin = sum(v for k, v in by_code.items() if k in INTAKE)
    tout = sum(v for k, v in by_code.items() if k in OUTPUT)
    return {"in": tin, "out": tout, "balance": tin - tout, "by_code": by_code}


def hourly(entries: list[FluidEntry], start: datetime) -> list[dict]:
    rows, cum = [], 0.0
    for h in range(24):
        a, b = start + h * HOUR, start + (h + 1) * HOUR
        t = totals(entries, a, b)
        cum += t["balance"]
        rows.append({"start": _iso(a), "in": {k: v for k, v in t["by_code"].items() if k in INTAKE},
                     "out": {k: v for k, v in t["by_code"].items() if k in OUTPUT}, "balance_cum": cum})
    return rows


def hours_with(entries: list[FluidEntry], code: str, since: datetime) -> int:
    return len({int((e.at - since) // HOUR) for e in entries
                if e.code == code and e.retracted is None and since <= e.at < since + 24 * HOUR})


def urine_rate(entries: list[FluidEntry], weight_kg: float | None, now: datetime) -> float | None:
    if not weight_kg:
        return None
    window = [e.value for e in entries if e.code == URINE and e.retracted is None and now - 6 * HOUR < e.at <= now]
    return round(sum(window) / 6 / weight_kg, 2) if window else None


def patient_fluids(audit: AuditLog, *, hospital: str, patient_id: str, now: datetime, zone, start_a: int,
                   start_b: int, weight_kg: float | None) -> dict:
    w = fluid_day(now, zone, start_a, start_b)
    entries = read_entries(audit, hospital, patient_id, since=w["last_day"][0], until=now + BEDSIDE_SKEW)
    day_start, last = w["day"][0], w["last_day"]
    last_totals = totals(entries, *last)
    return {
        "patient_id": patient_id, "now": _iso(now),
        "day": {"start": _iso(w["day"][0]), "end": _iso(w["day"][1])},
        "last_day": {"start": _iso(last[0]), "end": _iso(last[1])},
        "shifts": [{"start": _iso(w["shift_a"][0]), "end": _iso(w["shift_a"][1])},
                   {"start": _iso(w["shift_b"][0]), "end": _iso(w["shift_b"][1])}],
        "codes": {"intake": list(INTAKE), "output": list(OUTPUT)},
        "hours": hourly(entries, day_start),
        "totals": {"today": totals(entries, day_start, now + BEDSIDE_SKEW),
                   "shift_a": totals(entries, *w["shift_a"]), "shift_b": totals(entries, *w["shift_b"]),
                   "last_day": last_totals},
        "urine_last_day_ml": last_totals["by_code"].get(URINE, 0.0),
        "hours_with_urine_last_day": hours_with(entries, URINE, last[0]),
        "weight_kg": weight_kg, "urine_ml_kg_h_last_6h": urine_rate(entries, weight_kg, now),
        "sofa_renal_reference": SOFA_RENAL_REFERENCE,
        "entries": [{"entry": e.entry, "code": e.code, "value": e.value, "at": _iso(e.at), "by": e.by,
                     "retracted": e.retracted} for e in sorted(entries, key=lambda e: (e.at, e.entry), reverse=True)],
    }
```

- [ ] **Step 4: Run** `tests/test_fluids.py` → PASS. **Step 5: Commit** `feat(fluids): api/fluids.py — fluid day, shift and day totals, hourly ledger, urine rate (G3-03 D5–D9)`.

---

### Task E3: `GET /patients/{id}/fluids`

**Files:** `homunculus-engine/src/homunculus/api/app.py` (beside `/patients/{patient_id}/trends`); test `homunculus-engine/tests/test_fluids_api.py`; drift guards (`tests/test_route_inventory.py`, `tests/test_tenant_isolation.py`, `tests/test_access_log_redaction.py` + `deploy/local/web/nginx.conf` access-log map) only if they fail — read the failure; `/patients` is already proxied.

- [ ] **Step 1: Failing tests** — `test_fluids_api.py` (E1's fixture style plus a `VIEWER` without `board.view` and `tasks=InMemoryTaskStore(zones={"h1": "UTC"})`): 403 without `board.view`; 404 for an unknown patient; after charting `iv_fluid_ml 500` and `urine_output_ml 300` now, `totals.today` has `in 500, out 300, balance 200`; a withdrawn urine entry leaves the sum and stays in `entries` with `retracted`; `weight_kg` is the last charted `weight_kg` (chart 70 through the door) and `urine_ml_kg_h_last_6h == round(300/6/70, 2)`; `sofa_renal_reference.source == "sepsis-3-jama-2016"`; with task settings saved as start 7 / 19 (`store.save_settings`) the `day.start` is at 07:00 UTC; withdrawing a bolus answers 200 with the retract answer's `alerts` list (the rebuild ran).
- [ ] **Step 2: Run, see it fail.**
- [ ] **Step 3: Implement** after the trends route:

```python
    @app.get("/patients/{patient_id}/fluids")
    async def fluids(patient_id: str, authorization: str | None = Header(default=None)):
        """G3-03: the patient's fluid ledger, summed here (api/fluids.py). Read-only, not audited (as trends).
        The fluid day starts at Görevlerim's first shift start in the tenant's zone (spec D5)."""
        caller = await _caller(authorization)
        _require(caller, BOARD_VIEW)
        scope = await _scope(authorization)
        await _require_patient(caller, authorization, patient_id, scope=scope)
        state = _score_state(caller.hospital, patient_id)     # 404 for an id neither measured nor admitted
        settings = tasks.settings(caller.hospital) or DEFAULT_TASK_SETTINGS
        weight = state.latest(SignalCode.WEIGHT_KG) if state is not None else None
        return patient_fluids(audit, hospital=caller.hospital, patient_id=patient_id,
                              now=datetime.now(timezone.utc), zone=zone_of(tasks.timezone(caller.hospital)),
                              start_a=settings.shift_start_a, start_b=settings.shift_start_b,
                              weight_kg=None if weight is None else weight.value)
```
Imports: `from homunculus.api.fluids import patient_fluids`; `from homunculus.api.tasks import DEFAULT_SETTINGS as DEFAULT_TASK_SETTINGS, zone_of`. Read what `_score_state` returns and how `api/board.py` reads `weight_kg`; adapt these two lines to the real API.
- [ ] **Step 4: Run** `tests/test_fluids_api.py tests/test_fluids.py tests/test_fluids_door.py tests/test_route_inventory.py tests/test_tenant_isolation.py tests/test_access_log_redaction.py tests/test_nginx_routes.py tests/test_bedside_preview.py` → PASS.
- [ ] **Step 5: Commit** `feat(fluids): GET /patients/{id}/fluids — the ledger for the patient screen (G3-03 D6, D7)`; push `feat/g3-sivi`.

---

### Task W1: client, fake API, i18n

**Files:** `dashboard/src/backendApi.js` (after `patientTrends`), `dashboard/src/live/session/testTokens.testutil.js` (one block after G3-02's), `dashboard/src/live/i18n/strings/sivi.js` (new), `dashboard/src/live/i18n/catalog.js` (import + NAMESPACES line after `gorevler`); tests: `backendApi.test.js` (append one case: `patientFluids("S-001")` → `GET /patients/S-001/fluids`), the `src/live/i18n` suite.

- `patientFluids(patientId) { return authed(\`/patients/${seg(patientId)}/fluids\`); }` and `patientFluids: vi.fn(),`.
- `sivi.js` keys (TR source; AZ/RU/EN with the same keys and placeholders; strings.test rules as in G3-02 Task 10): `title` «Sıvı», `intro` «Aldığı ve çıkardığı; toplamları sunucu hesaplar.», `add` «Giriş/çıkış ekle», `addTitle` «Giriş/çıkış · {bed}», `intake` «Aldığı», `output` «Çıkardığı», `balance` «Denge», `today` «Bugün ({start}'dan beri)», `shift` «{start}–{end} nöbeti», `lastDay` «Son tamamlanan 24 saat», `urineLastDay` «24 saatlik idrar: {ml} mL», `urineHours` «24 saatin {n}'inde idrar kaydı var», `sofaRef` «Sepsis-3 SOFA böbrek satırı: <500 mL/gün 3 puan, <200 mL/gün 4 puan. Sistem puan vermez; eksik kayıt toplamı düşük gösterir.», `rate` «İdrar {rate} mL/kg/sa (son 6 saat)», `rateNone` «mL/kg/sa: kilo ya da son 6 saatte idrar kaydı yok», the eight category labels under `code.`: `iv_fluid_ml` «IV sıvı / infüzyon», `crystalloid_bolus_ml` «Kristaloid bolus (İlaçlar kutusundakiyle aynı kayıt)», `enteral_ml` «Enteral / oral», `blood_product_ml` «Kan ürünü», `other_intake_ml` «Diğer giriş», `urine_output_ml` «İdrar», `drain_output_ml` «Dren», `other_output_ml` «Diğer çıkış (NG, kusma)»; `fieldCode` «Tür», `fieldMl` «mL», `fieldAt` «Saat», `addRow` «Satır ekle», `removeRow` «Satırı sil», `save` «Kaydet», `cancel` «Vazgeç», `saved` «{n} giriş kaydedildi.», `refused` «Kaydedilmedi: {reason}», `entries` «Bugünkü girişler», `entriesEmpty` «Bugün giriş yok.», `withdrawn` «hatalı giriş», `retract` «Hatalı giriş», `readFailed` «Sıvı defteri okunamadı: {reason}», `chartLabel` «Saatlik giriş/çıkış ve kümülatif denge», `invalidMl` «0–{max} mL arası bir sayı girin.», `invalidAt` «Saat en çok 24 saat geri olabilir, ileri olamaz.».
- Commit `feat(dashboard): sıvı i18n namespace, patientFluids call (G3-03 D13)`.

### Task W2: `fluidCodes.js`, `useFluids.js`, `FluidChart.jsx`, `FluidsBox.jsx` (read side)

**Files:** `dashboard/src/live/screens/patient/fluids/` new files + tests; `PatientScreen.jsx` one line after the Sepsis/Meds grid `</div>`: `<FluidsBox patientId={id} bed={bed} nowMs={nowMs} canChart={canChart} />` (blank lines either side); `rawKeys.test.jsx` `openAt`: `api.patientFluids.mockResolvedValue(FLUIDS_SWEEP)` with a fixture of the §3 shape; `PatientScreen.test.jsx`: stub `api.patientFluids` where the screen is mounted if unstubbed calls break it.

- `fluidCodes.js`: `INTAKE`, `OUTPUT` arrays (the server's order), `boundOf(code) = code === "crystalloid_bolus_ml" ? 10000 : 5000`, `labelKey(code) = \`sivi.code.${code}\``.
- `useFluids(patientId)`: `useSession().store`: `store.track(() => store.api.patientFluids(id))` on mount, every 60 s, and on `refresh()`; keep the last data on error and expose `error`; a sequence ref drops stale answers; reset when `patientId` changes.
- `FluidChart.jsx`: SVG, 24 columns; intake bar up, output bar down from a midline, a polyline of `balance_cum`; `<title>` per column «HH:00 · aldığı N mL · çıkardığı M mL · denge K mL»; `role="img"` with `aria-label={t("sivi.chartLabel")}`; no colour thresholds.
- `FluidsBox.jsx`: `Box title={t("sivi.title")}` (`level` as the other boxes on the patient screen); big numbers for today (`in`, `out`, signed `balance`); shift A/B subtotals with their `hhmm` times; the last day's in/out/balance and `urineLastDay` + `urineHours` + `sofaRef` (text, no colour); `rate`/`rateNone`; the chart; the entries list (W3 adds actions); «Giriş/çıkış ekle» only with `canChart`; failed read → `Alert` with `readFailed`. Every number comes from the answer; the browser adds nothing.
- Tests (`FluidsBox.test.jsx`, `mount` + `token({perms})` as G3-02's screen tests; az texts): the three numbers and the signed balance; shift subtotals; the SOFA reference sentence and the hours-covered sentence from `hours_with_urine_last_day`; the mL/kg/h element carries no `text-crit`/`text-att` class; no «ekle» without `clinical.chart`; a failed read keeps the last numbers and shows the alert.
- Commit `feat(dashboard): Sıvı box — totals, shifts, last day with the SOFA renal reference, hourly chart (G3-03 D7–D10, D12)`.

### Task W3: entry dialog, entries list, «hatalı giriş»

- `FluidEntryDialog.jsx`: rows `{code, ml, at}`; default one row `{code: "urine_output_ml", ml: "", at: toLocalInput(nowMs)}`; «Satır ekle»/«Satırı sil»; validates each row (a number with at most one decimal, 0–`boundOf`; time within 24 h back, not ahead — `fromLocalInput`, `BACKDATE_MS` from `patient/meds/medsFields.js`); rows with the same time go in ONE `board.store.chart(patientId, entries, atIso)` call; rows with different times go one call per distinct time, in order, stopping at the first refusal and saying which rows were saved; toast `saved`; `refused` with `apiErrorText`; then `refresh()`.
- Entries list in `FluidsBox`: today's entries newest first (time, category label, mL, by); withdrawn ones struck through with «hatalı giriş»; a «Hatalı giriş» button (only `canChart`, only not withdrawn) opens `common/RetractDialog.jsx` with `what = { label: t(labelKey(code)), value: \`${value} mL\`, time }` and `onRetract={(reason) => board.store.retract(patientId, entry, reason)}`; after it, `refresh()`.
- Tests: the dialog sends one `chart` call with both same-time rows; a 5001 mL row shows `invalidMl` and sends nothing; withdrawal calls `retractEntry` with the entry id and refreshes; a withdrawn entry has no button.
- Commit `feat(dashboard): fluid entry dialog and «hatalı giriş» on the ledger (G3-03 D10, D11)`; push `feat/g3-sivi-web`.

---

### Task F: merge, gates, docs (controller)

Merge `feat/g3-sivi-web` into `feat/g3-sivi` (`--no-ff`); whole engine no-DB suite, whole dashboard suite, build; spec §9 amendments if any; roadmap row `G3-03` under `G3-02`; rehber §3.15 «Sıvı dengesi»; push; one reviewer per side → fixes → report to the owner.
