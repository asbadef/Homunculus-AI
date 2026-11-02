# G3-01 · Bedside vitals («Yatak başı ölçüm») — design

**Date:** 2026-11-02 · **Lane:** A · **Branch:** `feat/g3-yatak-basi-olcum` (from main `2afa6f2`)
**Status:** design approved section by section by the user (2026-11-01/02: Q1–Q5, approach 1, sections
1–4). Implementation plan next.

## 1. Why

The real engine receives no vitals today. The ward's HL7 feed has been silent since 2026-09-05, and the
Infinity monitors feed only the shadow engine (Aşama B). The real NEWS2 therefore scores nothing, and
the SOFA form's MAP is never measured. The chart door (`POST /clinical/{id}`) accepts bilinç (ACVPU), ek
oksijen and the SOFA labs, but it refuses the five vitals and MAP by design, because "a monitor produces
them". This slice lets a nurse enter the bedside set by hand, from a tablet or from the patient screen,
into the real engine, and lets a wrong entry be withdrawn as «hatalı giriş».

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Hand-entered vitals feed the REAL engine** (user Q1, 2026-11-01). Each value keeps the provenance the door already stamps (`source_device` "clinician"), and the screen prints «elle» beside it in the vital cards, the chart and the table. | The HIS feed used to carry nurse-entered vitals into the engine; this door replaces it. Provenance is never lost (`api/clinical.py` `build_entries`). |
| D2 | **The set is NEWS2's seven plus MAP** (user Q2): solunum sayısı, SpO₂, ek oksijen, sistolik tansiyon, nabız, bilinç (ACVPU), ateş, and MAP (optional). Diastolic pressure is **not** in the form; the prototype computed MAP from it, and here MAP is entered as read (an arterial line, or the monitor's NBP mean). | NEWS2 Scale 1 is what `rules/news2.py` scores; MAP is the SOFA cardiovascular input (`rules/sofa.py`). |
| D3 | **Two entry points, one form** (user Q3). (a) A new page «Yatak başı ölçüm» (route `olcum`, path `/olcum`, `perms: ["clinical.chart"]`, main nav), built for tablets and phones in three steps: choose the patient (the caller's in-scope board list: bed, name, age, time of the last hand entry), confirm identity («Ad soyad ve doğum yılı hastayla eşleşiyor mu?»; «Hayır» cancels the choice and says «sorumlu hemşireye bildirin»), then the form. (b) An «Ölçüm gir» button beside the patient screen's vital cards, opening the same form in a dialog with no identity step (the header already names the patient). | The prototype's tablet flow (`tasarim-taslaklari/app/nursing.js` `bedside`) for rounds; the button for whoever is already on the patient. The prototype's "portable device" step is left out: that data comes through B1d's bridge path (Connex Spot). |
| D4 | **At least one value** (user Q5). An empty box is «ölçülmedi», never 0. The preview says the NEWS2 is partial and names what is missing («NEWS2 kısmi: solunum, bilinç girilmedi»). | Forcing all seven would push nurses to retype stale values, which the engine would take as fresh. The engine already reports a partial NEWS2 honestly (`rules/news2.py` header). |
| D5 | **The existing chart door is extended** (approach 1). `CHARTABLE` gains `resp_rate`, `spo2`, `sbp`, `map`, `heart_rate` and `temperature`, with fixed units: the device path's (`/min`, `%`, `mmHg`, `mmHg`, `bpm`, `C` as in `edge/infinity_records.py` `UNITS`; the plan confirms them against the HL7 adapter before Task 1). One form's values go in ONE request with one `recorded_at`. Everything the door does today follows: the audit `chart` row per value, the lifecycle hook, the nurse's notification, the escalation clock, the shadow mirror, the card republish. | One door: alerts, audit and shadow behave as for every other charted value. A second door would duplicate the alert loop and drift (rejected approach 2). |
| D6 | **Slip bounds, not clinical thresholds** (section 3): solunum 0–80 /dk, SpO₂ 0–100 %, sistolik 0–300 mmHg, MAP 0–300 mmHg, nabız 0–300 /dk (whole numbers), ateş 25–45 °C (one decimal; «36,8» accepted by the form). When MAP and sistolik come in the same request, MAP must be below it. Refusals are 400 with one Turkish sentence, as `GCS_NOT_WHOLE`. | `PLAUSIBLE`'s rule (`api/clinical.py`): catch a slipped digit or unit, never argue with a plausible number. |
| D7 | **Measurement time:** default now; at most 24 h back; not in the future (2 min tolerance for clock skew). The door enforces it for the six new codes; the form enforces it for all eight. ACVPU and ek oksijen keep today's door rule. | The new codes have no callers yet, so a server-side bound breaks nothing. Existing callers and tests chart those two at fixed past times. |
| D8 | **Preview** is its own route, `POST /clinical/{id}/preview`, with the chart door's body. It parses with the same rules (same refusals), adds the values to a COPY of the patient's state (`PatientState.copy`), and answers the board's NEWS2 shape for that copy at the request instant: total, `partial`, points per parameter, missing parameters. It writes nothing: no audit row, no engine change, no frame. | The nurse sees what saving would score before saving. The answer equals the card's NEWS2 after the same values are saved (a parity test pins it). |
| D9 | **Alerting is today's** (section 2). A NEWS2 above a band raises the engine's alert, which reaches the Alarmlar screen, notifies the nurse and, unacknowledged, escalates to the doctor after the escalation delay. The patient's charted normal (profile) still downgrades a chronic-normal value (`rules/patient_relative.py`). No new channel and no new alert kind. | This is the behaviour designed for device vitals. It was silent only because no vitals arrived. It is new for the ward, so the deploy says so (§7). |
| D10 | **«Hatalı giriş»** (user Q4). `POST /clinical/{id}/entries/{entry}/retract`, body `{"reason": "…"}`, reason at least 10 characters after trim. `entry` is the id of the value's `chart` audit row; the door's answer now lists them (`entries: [{code, entry}]`). The route: (1) writes a `chart_retract` audit row `{entry, code, value, obs_ts, reason, retracted_by}` (subject = code); (2) rebuilds that patient's engine state from the trail without retracted entries, using the restart's own replay helpers (`api/rehydrate.py` `_replay_ingest`, `_replay_profile`), engine only, with no lifecycle during the replay; (3) runs the lifecycle hook once at the request instant (an alert that no longer fires clears; an unacknowledged critical stays latched, G2-A1 D3), prunes the notifier, republishes the card; (4) mirrors the withdrawal to the shadow engine (`mirror_retract`: remove that observation from the shadow patient's state and re-judge; approximate, the shadow lane is not clinical). Sends no notification. | A wrong SpO₂ can raise NEWS2, notify and page. A wrong MAP can turn on sepsis and start the antibiotic clock, and removing the value alone would not stop that clock (`pipeline.py` anchor rules). A rebuild makes every score as if the value had never been entered. The audit row stays, so the chain is untouched. |
| D11 | **Refusals for a withdrawal:** 403 without `clinical.chart`; 404 out of scope (`_require_patient`), for an unknown entry, an entry of another patient, or a row that is not a `chart` row (a device's value cannot be withdrawn); 409 already withdrawn; 409 for a discharged number (tombstone); 400 for a short reason. No time limit while the patient is admitted (section 3). | Withdrawal is a clinical-record act on hand-entered values only. Every attempt is audited by the route's own rows. |
| D12 | **Restart:** `rehydrate` first reads the `chart_retract` rows (one query by event type) and collects the withdrawn entries; the main pass skips those `chart` rows. A latch that a withdrawn value created does not survive a restart: the value never fires in the replay. The alert's own rows (`alert`, `first_seen`, any `ack`) stay in the trail. | Same result as the live rebuild, at one extra small query. Re-creating a latch from history would need its own replay rules; a withdrawn value is by definition an error. |
| D13 | **Trends show hand entries and withdrawals.** Each channel of `GET /patients/{id}/trends` gains `manual: [{entry, at, value, by, retracted}]` for the window: every `chart` row of that code, withdrawn ones included, with `retracted: null | {reason, by, at}`. The API keeps an in-memory index per hospital and patient (built by the door, the withdrawal and `rehydrate`), so a trends read touches no trail. `points` is unchanged (the engine's values, withdrawn ones gone). The chart draws a withdrawn value dimmed and crossed. The table prints «elle» on hand rows, strikes a withdrawn row through with its reason, name and time, and offers «Hatalı giriş» on a non-withdrawn hand row (for `clinical.chart` holders). The «Kaydedildi» step offers it too, for each value just saved. | One place to see and correct what was entered; the engine's series stays the truth for scores. |
| D14 | **Permissions:** `clinical.chart` for the page, the form, the preview and the withdrawal; scope as every single-patient route. No new permission. | Today's chartists (nurses, doctors) are the people who measure. |
| D15 | **Out of this slice:** diastolic pressure (D2); the portable device (B1d's path); «vital zamanı / gecikti» reminders (Görevlerim); NEWS2's age and pregnancy limits (no vault source; open item O1); a «protokole göre önerilen yanıt» text (no vault source); any new notification channel. | No clinical claim without a source (CLAUDE.md hard rule 1); scope kept to one slice. |
| D16 | **Rollback:** api + web only, no migration (`chart_retract` is a new event type in the existing `audit` table). The old API ignores `chart_retract`, so under the old images a withdrawn value counts again. The rollback block first prints how many withdrawals exist. Hand-entered vitals themselves replay correctly under the old code: the six codes already exist in `canonical.py`. | Honest rollback: what it restores and what it brings back. |

## 3. API

**`POST /clinical/{id}`** (extended). The body is unchanged: `{"recorded_at": iso?, "entries": [{"code", "value"}]}`.
The answer adds `entries: [{"code", "entry"}]`, the audit id of each value's `chart` row, in request order.
The new refusals are D6 and D7. A discharged number keeps today's answer (`dropped`).

**`POST /clinical/{id}/preview`** takes the same body and writes nothing:
```json
{"preview": true, "at": "…", "news2": {"total": 5, "partial": true,
 "points": {"respiration_rate": 2, "spo2": 0, "air_or_oxygen": 0, "systolic_bp": 1, "pulse": 2,
            "consciousness": null, "temperature": 0},
 "missing": ["consciousness"]}}
```
The plan aligns the field names with `api/board.py` `_news2` and reuses that function's shape.

**`POST /clinical/{id}/entries/{entry}/retract`** takes `{"reason": "yazım hatası — 89 değil 98"}` and answers
`{"retracted": entry, "code", "alerts": [kinds active after the rebuild]}`. Its refusals are listed in D11.

**`GET /patients/{id}/trends`** adds `manual` per channel (D13) and nothing else.

## 4. Engine and API changes (by file)

- `api/clinical.py`:
  - `CHARTABLE` and `PLAUSIBLE` gain the six codes (D5, D6);
  - the whole-number rule for the five integer vitals;
  - the MAP < sistolik check within one request;
  - the time bound for the six (D7);
  - `chart_observations` returns each chart row's id;
  - a `retract_entry(...)` function next to it that holds steps 1–4 of D10, so the door module keeps the
    loop's rules in one place.
- `api/rehydrate.py`:
  - a per-patient `rebuild_patient(engine, records, skip)` that uses the same helpers as `rehydrate`,
    engine only, with no lifecycle;
  - `rehydrate` collects `chart_retract` entries first and skips them (D12).
- `pipeline.py`: no rule changes. `Engine.forget` + replay is the rebuild. The plan checks that every
  per-patient memory (`_PER_PATIENT`) is cleared by `forget` and rebuilt by the replay.
- `api/app.py`:
  - the preview route and the withdrawal route;
  - the hand-entry index (D13);
  - the shadow `mirror_retract` hook beside `shadow_mirror`.
- `api/trends.py`: `manual` per channel.
- `api/audit*.py`: no schema change. The rebuild reads one patient's rows with `records(tenant=…,
  patient_id=…)` under the audit read bound (30 s, `SET LOCAL`). O3 covers the missing index.
- `api/infinity_rules.py` (shadow lane): `retract(hospital, obs)`, guarded like `mirror`, never raising.

## 5. Dashboard

- `shell/routes.js`: route `olcum` (D3), label key `nav.bedside`.
- `screens/bedside/`, new:
  - `BedsideScreen.jsx`: list, identity and the three steps;
  - `VitalsForm.jsx`: the shared form;
  - `PreviewPanel.jsx`;
  - `SavedStep.jsx`: «Kaydedildi · {saat}», the summary, «Sıradaki hasta», «Hasta ekranı», and a
    «Hatalı giriş» per value just saved.
- `screens/patient/`:
  - an «Ölçüm gir» button by the vital cards, opening `VitalsForm` in a dialog;
  - `trends/` table and chart for D13;
  - `RetractDialog.jsx`: the reason box, 10-character minimum, the confirm button inert for 600 ms as in
    A4 and ESLEME.
- `live/data`: store calls `chartVitals`, `previewVitals`, `retractEntry`. The trends reader keeps
  `manual`.
- `i18n/strings/`: tr, az, ru, en. The form's units are printed beside each box. Every box is a −/+
  stepper with an input, and the field has a label and a unit for screen readers.
- Phone and tablet first: 390 px, the prototype's large buttons. Both themes.

## 6. Testing

**Engine (no DB, and Postgres where the trail is read):**
- **The door:** the six codes with their units, bounds, whole numbers, MAP < sistolik, the D7 time bound,
  one `recorded_at` for a form, the answer's `entries`.
- **Preview:** writes no row, no frame and no engine change. Its NEWS2 equals the card's after the same
  values are saved (parity). It refuses what the door refuses.
- **Withdrawal, the core property:** chart X then withdraw X, and the engine's NEWS2, SOFA (form and
  alerting), NEWS2 hold, antibiotic anchor and active alerts equal those of never charting X. This runs
  for a NEWS2 case and for a MAP that turned sepsis on.
- **Withdrawal, the rest:**
  - an unacknowledged critical stays latched, and an acknowledged alert simply clears;
  - no new notification;
  - restart: `rehydrate` with a `chart_retract` row gives the same engine as the live rebuild;
  - the shadow lane drops the value and never raises;
  - the D11 refusals;
  - a device value cannot be withdrawn;
  - the reason trimmed to under 10 characters is refused;
  - Postgres: the per-patient read stays under the bound.
- **Trends:** `manual` lists hand rows and withdrawals in the window, and `points` loses the withdrawn
  value.

**Dashboard:**
- The page: scope list, identity yes/no, form, empty boxes, preview (partial and complete), save, the
  saved step, withdrawal from the saved step.
- The patient-screen button opens the same form.
- The trends table: «elle», a struck-through row with reason, the button only for `clinical.chart`.
- The raw-key sweep, four languages, two themes, 390 and 1440 px.

**Local walk (synthetic patient, local stack):**
1. Enter a set that scores NEWS2 ≥ 5. The alert appears and the nurse's notification fires.
2. Withdraw the value that drove it. The alert clears, or stays latched if critical and unacknowledged.
3. Restart the API. The withdrawn value stays out; trends show it struck through.
4. Enter a MAP that turns sepsis on (with infection charted), then withdraw it. No antibiotic clock
   remains.

## 7. Deploy

- api + web, after B1d's deploy (one deploy at a time). No migration, and the hub is untouched. The blocks
  follow `G2B-ESLEME-bloklari.txt`: rollback tags, C-0/C-1 shadow checks, a probe that the preview route
  answers 401 without auth (with a JSON body), and the web asset grep.
- **The ward is told beforehand:** a hand-entered NEWS2 now alerts and escalates (D9). The screen check
  uses a synthetic patient only if the user says so in that block; otherwise it is the form opening and
  the preview, with nothing saved.
- **Rollback:** previous images. D16's notice: count the `chart_retract` rows before rolling back.

## 8. Open items

- **O1.** NEWS2's age (adults) and pregnancy limits: no source in the vault. Ingest the RCP scope statement
  first, then a rule in its own slice. The pilot unit is an adult ICU.
- **O2.** Units: confirm the six against the HL7 adapter (`gateway/hl7.py`), which carries ward vitals when
  the HIS feed returns. The plan does this before Task 1.
- **O3.** The rebuild reads one patient's rows without an index on `audit.patient_id` (1 166 rows on the VM
  today, milliseconds). When the HIS feed returns and the trail grows, add an index in its own migration.
- **O4.** A latch created by a withdrawn value does not survive a restart (D12). Revisit if the ward asks
  for it.
- **O5.** az/ru/en strings for the page are read by a native reader after the deploy, as for ESLEME (O62
  there).
