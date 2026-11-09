# G2-B6 — «Alarm yoğunluğu»: the alarm heatmap on the audit page

**Date:** 2026-11-09
**Lane:** B (session homunculus-ai-3b). Assigned by Lane A after B4.
**Branch:** `feat/g2b-b4-denetim`, on top of B4. The box lives on B4's page, so it is one branch.
**Depends on:** B4 (`2026-11-09-g2b-b4-denetim-design.md`): its route, its namespace, and its decisions D1 (no load on its own) and D2 (masked patient id).

## 1. What it is

A third box on `#/denetim`, «Alarm yoğunluğu — son 7 gün». It is a table with one row per patient and one column per hour of the day (local 00–23). Each cell is the number of alarm **episodes** that began in that hour over the last seven days. It is a count only:
- no clinical threshold;
- no colour that means "too many".

The shading is relative to the table's own largest cell, and the legend says so.

Lane A's brief: «/alarm-quality verisinden yatak × saat ısı haritası (alarm yoğunluğu), salt okunur, … kaynaklı eşik yok, yalnız sayım».

## 2. Owner's decision (2026-11-09)

**D1 — where, and for whom.** The heatmap goes on the audit page, for `audit.view`. Recommended option chosen: «Denetim sayfasında».
- It keeps `/alarm-quality`'s existing rule: the whole hospital, and a unit-scoped account is refused (`errors.alarmQualityScoped`).
- The backend gains only an hourly breakdown.
- Rejected option: a separate screen under `board.view`, showing each clinician only their own unit. It needs a new endpoint and a scope filter.

## 3. Decisions taken in the spec

### D2 — the backend: one new field in the report, nothing else

`api/alarm_quality.py` `summarise` adds:

```
per_patient_hour: [{"patient_id": str, "hour": "<UTC hour start, ISO 8601>", "episodes": int}, …]
```

- **Bucketing.** Episodes are bucketed by the UTC hour in which they started (`ep.started` truncated to the hour).
- **Sort order.** Sorted by `patient_id`, then `hour`.
- **Size.** At most patients × 168 entries for the 7-day window: a pilot ward's 20–30 beds give a few thousand at most.
- **Why UTC.** Every `ts` and `at` in the trail is UTC, and the engine knows no hospital time zone. The browser turns each hour start into its local hour of day, the way `i18n/dates.js` treats every instant. Baku is UTC+4, a whole-hour offset, so a UTC hour maps onto exactly one local hour.
- **Unchanged.** No permission, query or cap changes. `per_day` and `noisiest_beds` stay as they are.

### D3 — rows are patients, not beds

- The audit trail knows patients (`patient_id`), not the bed a patient lay in at the time.
- A bed label would need the admission history at each episode's start. That history is not in the trail and is not in this slice.
- Rows are therefore patients, shown masked (B4 D2: `••••4821`).
- The box says so in one line: «Satırlar hastadır (yatak geçmişi bu tabloda yok); kimlik maskeli.»

### D4 — loaded on its button

«Haritayı göster» loads the map. Nothing loads by itself.
- **Why.** `/alarm-quality` reads up to 20 000 audit rows of the episode kinds and rebuilds every episode on the API. B4 D1 already states the page's rule: nothing heavy runs by itself.
- **Re-run.** The button stays and reads again.
- **Freshness.** The answer carries the local time it was taken («Saat 17:42 itibarıyla»).

### D5 — the table

**Selecting rows.**
- Only patients with at least one episode in the window appear.
- They are ordered by their total, highest first; a tie keeps the server's order.
- At most **30 rows**. When more exist, a note says «En çok alarmlı 30 hasta gösteriliyor ({total} hastadan).»

**Columns.**
- Patient (masked).
- 00 … 23: the local hour of the day.
- «Toplam».

**Cells.**
- The number, or empty for zero.
- A background in one of four steps of the primary colour by `count / max` (relative to this table), so the number is always readable.
- No colour means a clinical judgement.
- The legend says: «Renk tonu yalnız bu tablodaki en yüksek sayıya göredir; klinik bir eşik değildir.»

**Accessibility.**
- It is a real `<table>` inside the shared `Table`: caption, scroll region and `<th scope>`.
- Every cell's number is text, never colour alone.

### D6 — states

| Situation | What the box shows |
|---|---|
| Not loaded yet | The intro and the button only. |
| `episodes === 0` | «Son 7 günde alarm yok.» |
| `truncated: true` | A warn note: «Pencere sunucunun okuma sınırını aştı; en eski olaylar sayılmadı, sayılar eksik.» It is never shown as the whole week. |
| A refusal | The shared `readErrorText` in a crit `Alert`. A scoped account gets `errors.alarmQualityScoped`, which is already mapped. |
| An unreadable answer (no `per_patient_hour` array) | «Rapor okunamadı.» |

### D7 — strings

The box's strings go into the `denetim` namespace under `heat.*`, in tr, az, ru and en.

## 4. Tests

**Engine — `tests/test_alarm_quality.py`.**
- Episodes in two hours for one patient and one hour for another.
- Expect exactly the buckets, hour starts in UTC, sorted.
- An alert row repeated inside one episode counts once.
- The endpoint test asserts the field is in `/alarm-quality`'s body.

**Dashboard — `heat.js` (pure).**
- UTC hour start → local hour.
- Grouping into rows with 24 counts and a total.
- Ordering and the 30-row cap.
- The four shading steps (0, low, mid, high).
- An unreadable answer.

**Dashboard — `DenetimScreen.test.jsx`.**
- Nothing is called on mount.
- The button calls `alarmQuality(7)`.
- Masked rows, the hour cells and the total.
- The legend.
- The truncated note.
- The empty state.
- The scoped refusal.

**Dashboard — `rawKeys.test.jsx`.**
- The anchor also presses «Haritayı göster».

**Gates.**
- The engine's `tests/test_alarm_quality.py` and `tests/test_api_audit.py`.
- The whole dashboard suite and `vite build`.

## 5. Not in this slice

- Bed labels (needs the admission history per episode).
- A unit filter.
- A per-kind split.
- Windows other than 7 days.
- A `board.view` version for clinicians (the owner's rejected option, possible later).
