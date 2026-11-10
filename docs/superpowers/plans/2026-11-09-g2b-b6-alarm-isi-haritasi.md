# G2-B6 «Alarm yoğunluğu» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an alarm heatmap box to `#/denetim`. It shows, per patient and per hour of day, how many alarm episodes started in the last 7 days. The patient is masked, and the box loads only when its button is pressed.

**Architecture:**
- **Engine.** `api/alarm_quality.py` `summarise` gains one field, `per_patient_hour`. It counts episodes per patient per UTC hour start. Nothing else in the route changes.
- **Dashboard rules.** A pure module `screens/denetim/heat.js` groups the field into rows, each holding 24 local-hour counts and a total. It also orders the rows, caps them at 30, and sets the shading steps.
- **Dashboard screen.** `HeatBox.jsx` is the box. It sits on `DenetimScreen` between the verification box and the events box.
- **Strings.** They go into the `denetim` namespace under `heat.*`.

**Spec:** `docs/superpowers/specs/2026-11-09-g2b-b6-alarm-isi-haritasi-design.md` (D1–D7).

**Prerequisite:** B4 Tasks 1–4 are committed on this branch (`docs/superpowers/plans/2026-11-09-g2b-b4-denetim.md`).

**Rules:** the same as B4's plan header, plus:
- Engine tests run from `C:\tmp\g2b-b4-denetim\homunculus-engine` with
  `"/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest <paths> -q -p no:cacheprovider`.
  The worktree's `src` wins through pyproject's `pythonpath`.
- Never set `DATABASE_URL`. These tests need none.
- Never run `tests/test_infinity_vm_pilot.py`.

---

### Task 6: The engine's hourly breakdown

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/alarm_quality.py`. Add the `AlarmQuality` field and fill it in `summarise`.
- Test: `homunculus-engine/tests/test_alarm_quality.py`. Add a new class, plus one endpoint test in `TestTheEndpoint`.

- [ ] **Step 1: Write the failing tests.** Append this class to `tests/test_alarm_quality.py`, after the class that holds `test_the_noisiest_bed_is_named`:

```python
class TestTheHourlyBreakdown:
    """G2-B6 (spec D2): the heatmap's buckets — episodes by patient and the UTC hour they began in."""

    def test_episodes_are_counted_by_patient_and_the_utc_hour_they_began(self):
        records = [
            rec("first_seen", "bed-1", "news2", 5),
            rec("alert", "bed-1", "news2", 6),          # a repeat inside the episode: not another one
            rec("first_seen", "bed-1", "news2", 20),    # the same kind stamped again: a second episode
            rec("first_seen", "bed-1", "spo2_low", 70),
            rec("first_seen", "bed-2", "news2", 0),
        ]
        report = alarm_quality(records, _now(600))
        assert report.per_patient_hour == [
            {"patient_id": "bed-1", "hour": "2026-09-08T09:00:00+00:00", "episodes": 2},
            {"patient_id": "bed-1", "hour": "2026-09-08T10:00:00+00:00", "episodes": 1},
            {"patient_id": "bed-2", "hour": "2026-09-08T09:00:00+00:00", "episodes": 1},
        ]
        assert sum(c["episodes"] for c in report.per_patient_hour) == report.episodes

    def test_no_episodes_gives_an_empty_breakdown(self):
        assert alarm_quality([], _now(0)).per_patient_hour == []
        assert alarm_quality([], _now(0)).as_dict()["per_patient_hour"] == []
```

Add this method to `class TestTheEndpoint`, after `test_a_live_ward_reports_its_own_alarm_load`:

```python
    def test_the_report_carries_its_hourly_breakdown(self, client):   # G2-B6 (spec D2)
        client.post("/clinical/bed-1", json={"entries": [
            {"code": "suspected_infection", "value": 1},
            {"code": "platelets", "value": 80},
            {"code": "creatinine", "value": 3.5},
        ]}, headers=AUTH)
        body = client.get("/alarm-quality", headers=AUTH).json()
        cells = body["per_patient_hour"]
        assert cells and {c["patient_id"] for c in cells} == {"bed-1"}
        assert sum(c["episodes"] for c in cells) == body["episodes"]
        assert all(c["hour"].endswith(":00:00+00:00") for c in cells)
```

Run `"$V" -m pytest tests/test_alarm_quality.py -q -p no:cacheprovider`, where `V` is the venv python above. Expected: FAIL with `AttributeError ... per_patient_hour` / `KeyError`.

- [ ] **Step 2: Implement.** Make three changes in `alarm_quality.py`.

  1. In `class AlarmQuality`, after `noisiest_beds: list[dict] = field(default_factory=list)`, add:
     ```python
         # G2-B6 (spec D2): the heatmap's buckets — episodes by patient and the UTC hour they began in, sorted by
         # patient then hour. UTC because every `ts`/`at` in the trail is UTC and the engine knows no hospital time
         # zone: the browser turns each hour start into its own local hour of the day.
         per_patient_hour: list[dict] = field(default_factory=list)
     ```
  2. In `summarise`, next to `per_bed: dict[str, int] = {}`, add `per_hour: dict[tuple[str, str], int] = {}`. Inside the `for ep in episodes:` loop, after the `per_bed[...]` line, add:
     ```python
             hour = ep.started.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0).isoformat()
             per_hour[(ep.patient_id, hour)] = per_hour.get((ep.patient_id, hour), 0) + 1
     ```
  3. After the `report.noisiest_beds = …` statement, add:
     ```python
         report.per_patient_hour = [{"patient_id": p, "hour": h, "episodes": n}
                                    for (p, h), n in sorted(per_hour.items())]
     ```

  `timezone` is already imported in this module.

- [ ] **Step 3: Run the tests.**
  - Run `"$V" -m pytest tests/test_alarm_quality.py tests/test_api_audit.py -q -p no:cacheprovider`.
  - Expected: PASS. Before this change the two files had 26 tests and the audit file's count. Now there are 3 more.

- [ ] **Step 4: Commit.**
  ```bash
  git commit -m "feat(alarm-quality): per_patient_hour — episodes by patient and UTC hour start, for the heatmap (G2-B6, D2)" -- homunculus-engine/src/homunculus/api/alarm_quality.py homunculus-engine/tests/test_alarm_quality.py
  ```
  End the message with the `Co-Authored-By` trailer from the plan's rules.

---

### Task 7: The heatmap box

**Files:**
- Create: `dashboard/src/live/screens/denetim/heat.js`, `heat.test.js`, `HeatBox.jsx`, `HeatBox.test.jsx`
- Modify:
  - `dashboard/src/live/i18n/strings/denetim.js`: add a `heat: {…}` block in every language;
  - `dashboard/src/live/screens/denetim/DenetimScreen.jsx`: import `HeatBox` and render it between `<VerifyBox />` and `<EventsBox />`;
  - `DenetimScreen.test.jsx`: one assertion;
  - `dashboard/src/live/rawKeys.test.jsx`: the stub and the anchor.

- [ ] **Step 1: Write the failing rule tests.** Create `heat.test.js`:

```js
// heat.test.js — the «Alarm yoğunluğu» box's rules (G2-B6, spec 2026-11-09): UTC hour starts to local hours (D2),
// rows of masked patients with 24 counts and a total, ordered and capped (D5), the four shading steps. Synthetic ids.
import { describe, it, expect } from "vitest";
import { HEAT_DAYS, HEAT_ROWS, HOURS, heatRows, heatStep, localHour } from "./heat.js";

const at = (h) => `2026-11-09T${String(h).padStart(2, "0")}:00:00+00:00`;

describe("the local hour of a UTC hour start", () => {
  it("is the browser's own hour of that instant, or null", () => {
    expect(localHour(at(10))).toBe(new Date(Date.UTC(2026, 10, 9, 10)).getHours());
    expect(localHour("not a time")).toBeNull();
    expect(localHour(undefined)).toBeNull();
    expect(HOURS).toEqual(Array.from({ length: 24 }, (_, h) => h));
    expect(HEAT_DAYS).toBe(7);
  });
});

describe("the rows (D5)", () => {
  it("sums each patient's cells into 24 local hours and a total, highest total first, masked", () => {
    const heat = heatRows({ per_patient_hour: [
      { patient_id: "260109001111", hour: at(9), episodes: 1 },
      { patient_id: "260109004821", hour: at(10), episodes: 2 },
      { patient_id: "260109004821", hour: at(11), episodes: 1 },
    ] });
    expect(heat.rows.map((r) => r.label)).toEqual(["••••4821", "••••1111"]);
    expect(heat.rows[0].counts).toHaveLength(24);
    expect(heat.rows[0].counts[localHour(at(10))]).toBe(2);
    expect(heat.rows[0].counts[localHour(at(11))]).toBe(1);
    expect(heat.rows[0].total).toBe(3);
    expect(heat.rows[0].counts.reduce((a, b) => a + b, 0)).toBe(3);
    expect(heat).toMatchObject({ total: 2, max: 2 });
  });

  it("keeps the server's order on a tie, and skips zero and malformed cells", () => {
    const heat = heatRows({ per_patient_hour: [
      { patient_id: "260109002222", hour: at(1), episodes: 1 },
      { patient_id: "260109003333", hour: at(2), episodes: 1 },
      { patient_id: "260109004444", hour: at(3), episodes: 0 },
      { patient_id: "260109005555", hour: "garbage", episodes: 4 },
      { patient_id: "260109006666", hour: at(4), episodes: "x" },
    ] });
    expect(heat.rows.map((r) => r.label)).toEqual(["••••2222", "••••3333"]);
    expect(heat.total).toBe(2);
  });

  it("shows at most 30 patients and says how many had any", () => {
    const cells = Array.from({ length: 31 }, (_, i) => ({
      patient_id: `SYN-${String(i).padStart(4, "0")}`, hour: at(i % 24), episodes: 1 + (i === 0 ? 5 : 0),
    }));
    const heat = heatRows({ per_patient_hour: cells });
    expect(HEAT_ROWS).toBe(30);
    expect(heat.rows).toHaveLength(30);
    expect(heat.total).toBe(31);
    expect(heat.rows[0].label).toBe("••••0000");
    expect(heat.max).toBe(6);
  });

  it("reads an answer without the breakdown as unreadable, and an empty one as no rows", () => {
    expect(heatRows(undefined)).toBeNull();
    expect(heatRows({ episodes: 3 })).toBeNull();
    expect(heatRows({ per_patient_hour: [] })).toEqual({ rows: [], total: 0, max: 0 });
  });
});

describe("the shading (D5)", () => {
  it("is four steps relative to the table's largest cell, never a threshold of its own", () => {
    expect(heatStep(0, 9)).toBe(0);
    expect(heatStep(3, 9)).toBe(1);
    expect(heatStep(4, 9)).toBe(2);
    expect(heatStep(7, 9)).toBe(3);
    expect(heatStep(9, 9)).toBe(3);
    expect(heatStep(1, 0)).toBe(0);
  });
});
```

Run `npx vitest run src/live/screens/denetim/heat.test.js`. Expected: FAIL, because the module is missing.

- [ ] **Step 2: Create `heat.js`.**

```js
// src/live/screens/denetim/heat.js — the «Alarm yoğunluğu» box's rules, apart from React (G2-B6, spec
// docs/superpowers/specs/2026-11-09-g2b-b6-alarm-isi-haritasi-design.md): the report's UTC hour starts to local
// hours of the day (D2), rows of masked patients with 24 counts and a total, ordered and capped (D5), and the four
// shading steps — relative to the table, never a clinical threshold.
import { maskPatient } from "./denetim.js";

export const HEAT_DAYS = 7;
export const HEAT_ROWS = 30;
export const HOURS = Object.freeze(Array.from({ length: 24 }, (_, h) => h));

/** The local hour of the day (0–23) a UTC hour start falls in, in the browser's zone (the hospital's on the
 *  ward PCs, as i18n/dates.js); null for one that does not parse. */
export function localHour(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).getHours() : null;
}

/** D5: the report's `per_patient_hour` as rows — {patient, label, counts[24], total} — for the patients with at
 *  least one episode, the highest total first (a tie keeps the server's order), at most HEAT_ROWS; with `total`
 *  (how many patients had any) and `max` (the largest shown cell: the shading's only reference). null for an
 *  answer without a `per_patient_hour` array (D6). */
export function heatRows(report) {
  const cells = report?.per_patient_hour;
  if (!Array.isArray(cells)) return null;
  const byPatient = new Map();
  for (const cell of cells) {
    const n = Number(cell?.episodes);
    const hour = localHour(cell?.hour);
    if (!Number.isFinite(n) || n <= 0 || hour === null) continue;
    const id = typeof cell?.patient_id === "string" ? cell.patient_id : "";
    if (!byPatient.has(id)) {
      byPatient.set(id, { patient: id, label: maskPatient(id), counts: new Array(24).fill(0), total: 0 });
    }
    const row = byPatient.get(id);
    row.counts[hour] += n;
    row.total += n;
  }
  const all = [...byPatient.values()].sort((a, b) => b.total - a.total);   // stable: a tie keeps the server's order
  const rows = all.slice(0, HEAT_ROWS);
  const max = rows.reduce((m, r) => Math.max(m, ...r.counts), 0);
  return { rows, total: all.length, max };
}

/** D5: one cell's shading step — 0 for none, then 1–3 by its share of the table's largest cell. */
export function heatStep(count, max) {
  if (!(count > 0) || !(max > 0)) return 0;
  const share = count / max;
  if (share > 2 / 3) return 3;
  if (share > 1 / 3) return 2;
  return 1;
}
```

Run `npx vitest run src/live/screens/denetim/heat.test.js`. Expected: PASS.

- [ ] **Step 3: Add the strings.** In `strings/denetim.js`, add a `heat` block to each language object, after its `type: {…}` block.

**tr:**
```js
    heat: {
      title: "Alarm yoğunluğu — son {days} gün",
      intro: "Her hücre, o saatte başlayan alarm olaylarının sayısıdır (son {days} gün, yerel saat). Satırlar hastadır (yatak geçmişi bu tabloda yok); kimlik maskeli. Rapor sunucuda bütün haftayı yeniden kurar, bu yüzden yalnız düğmeyle gelir.",
      show: "Haritayı göster",
      caption: "Alarm olayları, hasta ve günün saatine göre, son {days} gün",
      colPatient: "Hasta",
      colTotal: "Toplam",
      legend: "Renk tonu yalnız bu tablodaki en yüksek sayıya göredir; klinik bir eşik değildir.",
      none: "Son {days} günde alarm yok.",
      capped: "En çok alarmlı {shown} hasta gösteriliyor ({total} hastadan).",
      truncated: "Pencere sunucunun okuma sınırını aştı; en eski olaylar sayılmadı, sayılar eksik.",
      unreadable: "Rapor okunamadı.",
      failed: "Rapor alınamadı: {reason}",
      asOf: "Saat {time} itibarıyla",
    },
```

**az:**
```js
    heat: {
      title: "Siqnal sıxlığı — son {days} gün",
      intro: "Hər xana həmin saatda başlayan siqnal hadisələrinin sayıdır (son {days} gün, yerli vaxt). Sətirlər xəstələrdir (çarpayı tarixçəsi bu cədvəldə yoxdur); identifikator maskalanıb. Hesabat serverdə bütün həftəni yenidən qurur, buna görə yalnız düymə ilə gəlir.",
      show: "Xəritəni göstər",
      caption: "Siqnal hadisələri, xəstə və günün saatına görə, son {days} gün",
      colPatient: "Xəstə",
      colTotal: "Cəmi",
      legend: "Rəng tonu yalnız bu cədvəldəki ən böyük saya görədir; klinik hədd deyil.",
      none: "Son {days} gündə siqnal olmayıb.",
      capped: "Ən çox siqnallı {shown} xəstə göstərilir ({total} xəstədən).",
      truncated: "Pəncərə serverin oxuma həddini aşdı; ən köhnə hadisələr sayılmadı, rəqəmlər natamamdır.",
      unreadable: "Hesabat oxunmadı.",
      failed: "Hesabat alınmadı: {reason}",
      asOf: "Saat {time} vəziyyətinə",
    },
```

**ru:**
```js
    heat: {
      title: "Плотность тревог — последние {days} дн.",
      intro: "Каждая ячейка — число эпизодов тревог, начавшихся в этот час (последние {days} дн., местное время). Строки — пациенты (история коек в этой таблице не хранится); идентификатор скрыт. Отчёт заново строит всю неделю на сервере, поэтому загружается только кнопкой.",
      show: "Показать карту",
      caption: "Эпизоды тревог по пациентам и часам суток, последние {days} дн.",
      colPatient: "Пациент",
      colTotal: "Всего",
      legend: "Оттенок цвета задан только наибольшим числом в этой таблице; это не клинический порог.",
      none: "За последние {days} дн. тревог не было.",
      capped: "Показаны {shown} пациентов с наибольшим числом тревог (из {total}).",
      truncated: "Окно превысило предел чтения сервера; самые старые события не учтены, числа неполные.",
      unreadable: "Не удалось прочитать отчёт.",
      failed: "Не удалось получить отчёт: {reason}",
      asOf: "По состоянию на {time}",
    },
```

**en:**
```js
    heat: {
      title: "Alarm density — last {days} days",
      intro: "Each cell is the number of alarm episodes that began in that hour (last {days} days, local time). Rows are patients (the bed history is not in this table); ids are masked. The report rebuilds the whole week on the server, so it loads only on the button.",
      show: "Show the map",
      caption: "Alarm episodes by patient and hour of day, last {days} days",
      colPatient: "Patient",
      colTotal: "Total",
      legend: "The shade follows only the largest number in this table; it is not a clinical threshold.",
      none: "No alarms in the last {days} days.",
      capped: "Showing the {shown} patients with the most alarms (of {total}).",
      truncated: "The window exceeded the server's read limit; the oldest events were not counted, so the numbers are incomplete.",
      unreadable: "The report could not be read.",
      failed: "The report could not be fetched: {reason}",
      asOf: "As of {time}",
    },
```

- [ ] **Step 4: Write the failing box tests.** Create `HeatBox.test.jsx`:

```jsx
// HeatBox.test.jsx — «Siqnal sıxlığı» (G2-B6): loaded on its button only (D4), masked patients by local hour with a
// total (D3, D5), the relative legend, the truncated / empty / unreadable / refused states (D6). Synthetic ids.
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { localHour } from "./heat.js";
import { HeatBox } from "./HeatBox.jsx";

const AUDITOR = ["board.view", "audit.view"];
const H10 = "2026-11-09T10:00:00+00:00";
const H11 = "2026-11-09T11:00:00+00:00";
const REPORT = { episodes: 4, truncated: false, days: 7, per_patient_hour: [
  { patient_id: "260109004821", hour: H10, episodes: 3 },
  { patient_id: "260109007777", hour: H11, episodes: 1 },
] };

const settle = () => act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
async function open(setup) {
  const mounted = await mount(<HeatBox />, {
    access: token({ perms: AUDITOR }), me: profile({ perms: AUDITOR }), setup,
  });
  await settle();
  return mounted;
}
const show = async () => { fireEvent.click(screen.getByRole("button", { name: "Xəritəni göstər" })); await settle(); };
// The mount harness's ToastProvider keeps an always-mounted, empty sr-only role="alert" live region: the page's own
// alerts are the others (the same helper as DenetimScreen.test.jsx).
const pageAlerts = () => screen.queryAllByRole("alert").filter((el) => !el.classList.contains("sr-only"));
const theAlert = () => {
  const found = pageAlerts();
  expect(found).toHaveLength(1);
  return found[0];
};

afterEach(() => { cleanup(); });

describe("the alarm heatmap box", () => {
  it("loads nothing on its own; the button asks for seven days", async () => {
    const { api } = await open((a) => a.alarmQuality.mockResolvedValue(REPORT));
    expect(api.alarmQuality).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).toBeNull();
    await show();
    expect(api.alarmQuality).toHaveBeenCalledWith(7);
    expect(screen.getByText(/^Saat \d\d:\d\d vəziyyətinə$/)).toBeInTheDocument();
  });

  it("shows masked patients, highest total first, each count in its local hour, the total and the relative legend", async () => {
    await open((a) => a.alarmQuality.mockResolvedValue(REPORT));
    await show();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("••••4821");
    expect(rows[1]).toHaveTextContent("••••7777");
    const first = rows[0].querySelectorAll("td");
    expect(first).toHaveLength(25);
    expect(first[localHour(H10)].textContent).toBe("3");
    expect(first[localHour(H10)].getAttribute("data-step")).toBe("3");
    expect(first[24].textContent).toBe("3");
    expect(rows[1].querySelectorAll("td")[localHour(H11)].getAttribute("data-step")).toBe("1");
    expect(screen.getByText("Rəng tonu yalnız bu cədvəldəki ən böyük saya görədir; klinik hədd deyil.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("260109004821");
  });

  it("says a truncated window is incomplete", async () => {
    await open((a) => a.alarmQuality.mockResolvedValue({ ...REPORT, truncated: true }));
    await show();
    expect(screen.getByText(/rəqəmlər natamamdır/)).toBeInTheDocument();
  });

  it("says when the window had no alarms, and when the report cannot be read", async () => {
    const { api } = await open((a) => a.alarmQuality
      .mockResolvedValueOnce({ episodes: 0, truncated: false, per_patient_hour: [] })
      .mockResolvedValueOnce(undefined));
    await show();
    expect(screen.getByText("Son 7 gündə siqnal olmayıb.")).toBeInTheDocument();
    await show();
    expect(api.alarmQuality).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Hesabat oxunmadı.")).toBeInTheDocument();
    expect(screen.queryByText("Son 7 gündə siqnal olmayıb.")).toBeNull();
  });

  it("names the cap when more than 30 patients had alarms", async () => {
    const cells = Array.from({ length: 31 }, (_, i) => ({ patient_id: `SYN-${String(i).padStart(4, "0")}`, hour: H10, episodes: 1 }));
    await open((a) => a.alarmQuality.mockResolvedValue({ episodes: 31, truncated: false, per_patient_hour: cells }));
    await show();
    expect(screen.getByText("Ən çox siqnallı 30 xəstə göstərilir (31 xəstədən).")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(31);   // header + 30
  });

  it("tells a unit-scoped account the whole report is outside its scope", async () => {
    await open((a) => a.alarmQuality.mockRejectedValue(refusal(403, "alarm kalitesi raporunun tamamı kapsam dışı")));
    await show();
    expect(theAlert()).toHaveTextContent("Siqnal keyfiyyəti hesabatının hamısı əhatənizdən kənardır.");
  });
});
```

Run `npx vitest run src/live/screens/denetim/HeatBox.test.jsx`. Expected: FAIL, because the module is missing.

- [ ] **Step 5: Create `HeatBox.jsx`.**

```jsx
// src/live/screens/denetim/HeatBox.jsx — «Alarm yoğunluğu — son 7 gün» (G2-B6, spec
// docs/superpowers/specs/2026-11-09-g2b-b6-alarm-isi-haritasi-design.md), on the audit page (owner D1). Patients
// (masked, B4 D2) by the local hour of the day; each cell the alarm episodes that began in that hour over the
// window — a count, shaded relative to this table's largest cell, never a clinical threshold. Loaded on its button
// only (D4): `/alarm-quality` rebuilds every episode of the window on the API.
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { hhmm, pad2 } from "../../i18n/dates.js";
import { Alert, Box, Button, Note, Table } from "../../ui/index.js";
import { HEAT_DAYS, HOURS, heatRows, heatStep } from "./heat.js";

/** The four steps' backgrounds — the primary colour at rising strength; the number is always the cell's text. */
const SHADE = [
  "",
  "color-mix(in srgb, var(--pri) 14%, transparent)",
  "color-mix(in srgb, var(--pri) 30%, transparent)",
  "color-mix(in srgb, var(--pri) 50%, transparent)",
];

function HeatTable({ heat }) {
  const { t } = useI18n();
  return (
    <Table caption={t("denetim.heat.caption", { days: HEAT_DAYS })}>
      <thead>
        <tr>
          <th scope="col">{t("denetim.heat.colPatient")}</th>
          {HOURS.map((h) => <th key={h} scope="col" className="font-data">{pad2(h)}</th>)}
          <th scope="col">{t("denetim.heat.colTotal")}</th>
        </tr>
      </thead>
      <tbody>
        {heat.rows.map((row) => (
          <tr key={row.patient}>
            <th scope="row" className="font-data">{row.label}</th>
            {row.counts.map((n, h) => {
              const step = heatStep(n, heat.max);
              return (
                <td key={h} data-step={step} className="text-center font-data"
                  style={step ? { backgroundColor: SHADE[step] } : undefined}>
                  {n > 0 ? n : ""}
                </td>
              );
            })}
            <td className="font-data font-bold">{row.total}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function HeatBox() {
  const { t } = useI18n();
  const { store } = useSession();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);       // { report, heat, at } | { error }
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const run = async () => {
    setBusy(true);
    try {
      const report = await store.track(() => store.api.alarmQuality(HEAT_DAYS));
      if (alive.current) setResult({ report, heat: heatRows(report), at: Date.now() });
    } catch (error) {
      if (alive.current) setResult({ error });
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  let body = null;
  if (result?.error) {
    body = (
      <Alert tone="crit">
        <p className="m-0">{t("denetim.heat.failed", { reason: readErrorText(t, result.error) })}</p>
      </Alert>
    );
  } else if (result && result.heat === null) {
    body = <Note tone="warn">{t("denetim.heat.unreadable")}</Note>;
  } else if (result) {
    const { heat, report } = result;
    body = (
      <>
        {report?.truncated === true ? <Note tone="warn">{t("denetim.heat.truncated")}</Note> : null}
        {heat.rows.length === 0 ? (
          <Note tone="info">{t("denetim.heat.none", { days: HEAT_DAYS })}</Note>
        ) : (
          <>
            {heat.total > heat.rows.length ? (
              <Note tone="info">{t("denetim.heat.capped", { shown: heat.rows.length, total: heat.total })}</Note>
            ) : null}
            <HeatTable heat={heat} />
            <p className="m-0 text-12 text-mute">{t("denetim.heat.legend")}</p>
          </>
        )}
        <p className="m-0 text-12 text-mute">{t("denetim.heat.asOf", { time: hhmm(result.at) })}</p>
      </>
    );
  }

  return (
    <Box title={t("denetim.heat.title", { days: HEAT_DAYS })} icon="chart" level={2}
      right={<Button size="sm" busy={busy} onClick={run}>{t("denetim.heat.show")}</Button>}>
      <div className="flex flex-col gap-2">
        <p className="m-0 text-13 text-mute">{t("denetim.heat.intro", { days: HEAT_DAYS })}</p>
        {body}
      </div>
    </Box>
  );
}
```

Run `npx vitest run src/live/screens/denetim`. Expected: PASS.

- [ ] **Step 6: Put the box on the page.**
  - In `DenetimScreen.jsx`:
    - add `import { HeatBox } from "./HeatBox.jsx";` after the `./denetim.js` import;
    - render `<HeatBox />` between `<VerifyBox />` and `<EventsBox />`. The long events table stays last.
    - update the header comment's box list: «Three boxes … the alarm heatmap (G2-B6), on its button».
  - In `DenetimScreen.test.jsx`, first test, after `expect(api.verifyAudit).not.toHaveBeenCalled();`, add:
    ```js
        expect(api.alarmQuality).not.toHaveBeenCalled();                  // G2-B6 D4: the heatmap waits for its button
    ```
  - In `rawKeys.test.jsx`:
    - next to `BROKEN_CHAIN`, add:
      ```js
      const HEAT_REPORT = { episodes: 2, truncated: true, days: 7, per_patient_hour: [
        { patient_id: "260109004821", hour: "2026-11-09T10:00:00+00:00", episodes: 2 },
      ] };
      ```
    - in `openAt`'s G2-B4 stub group, add `api.alarmQuality.mockResolvedValue(HEAT_REPORT);   // G2-B6`;
    - in the G2-B4 anchor test, before `expect(rawKeys(document.body)).toEqual([]);`, add:
      ```js
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Xəritəni göstər" })); await settle(); });
        expect(screen.getByText(/klinik hədd deyil/)).toBeInTheDocument();                              // denetim.heat.legend
        expect(screen.getByText(/rəqəmlər natamamdır/)).toBeInTheDocument();                            // denetim.heat.truncated
      ```
  - Run `npx vitest run src/live/screens/denetim src/live/rawKeys.test.jsx src/live/i18n`. Expected: PASS.

- [ ] **Step 7: Commit.**
  ```bash
  git add dashboard/src/live/screens/denetim/heat.js dashboard/src/live/screens/denetim/heat.test.js dashboard/src/live/screens/denetim/HeatBox.jsx dashboard/src/live/screens/denetim/HeatBox.test.jsx
  git commit -m "feat(denetim): «Alarm yoğunluğu» — masked patients by local hour, on its button, relative shading (G2-B6, D1–D7)" -- dashboard/src/live/screens/denetim dashboard/src/live/i18n/strings/denetim.js dashboard/src/live/rawKeys.test.jsx
  ```

---

### Task 8: Gates and the guide

- [ ] **Step 1: Run the gates.**
  - Engine: `"$V" -m pytest tests/test_alarm_quality.py tests/test_api_audit.py -q -p no:cacheprovider`.
  - Dashboard: `npx vitest run`, then `npx vite build`.
  - Record the counts.
- [ ] **Step 2: Update the guide.** In `docs/homunculus-rehber-TR.md` §3.13, add one bullet before the «Kaynak» line:

```markdown
- **Alarm yoğunluğu (B6):** aynı sayfada üçüncü kutu, «Haritayı göster» düğmesiyle gelir.
  - Son 7 günde her hastanın hangi saatte kaç alarm olayı yaşadığını gösterir: satırlar hasta (maskeli), sütunlar
    günün saatleri (00–23, yerel saat), en sonda toplam.
  - Renk tonu yalnız tablodaki en yüksek sayıya göredir; klinik bir eşik değildir.
  - En çok alarmlı 30 hasta gösterilir. Satırlar yatak değil hastadır: denetim kaydı o anki yatağı tutmaz.
  - Kaynak: `docs/superpowers/specs/2026-11-09-g2b-b6-alarm-isi-haritasi-design.md`.
```

- [ ] **Step 3: Commit.**
  ```bash
  git commit -m "docs(rehber): §3.13 — «Alarm yoğunluğu» (G2-B6)" -- docs/homunculus-rehber-TR.md
  ```
