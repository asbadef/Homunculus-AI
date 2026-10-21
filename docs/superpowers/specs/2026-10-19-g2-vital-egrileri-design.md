# Group 2 · slice 1 — Vital trend charts on the patient screen

**Date** 2026-10-19 · **Status** approved in conversation, awaiting the user's read of this file ·
**Branch** `feat/g2-vital-egrileri` (from `feat/infinity-asama-a` @ `a6aa0a2`, the build on the VM)
**Roadmap** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` (Group 2, first item)
**Prototype** `tasarim-taslaklari/app/patient.js` (`spotHtml`, `drawVital`, `openBigChart`) and
`core.js` (`H.lineChart`) on `origin/tasarim/prototip` — the visual language; its data and
thresholds are synthetic and do not carry.

## 1. What this slice delivers

The dashed "Vital eğrileri" placeholder on the patient screen becomes the real thing:

- six channel cards (pulse, respiration, SpO₂, systolic+MAP, temperature, lactate), each with the
  latest value, the change since the previous measurement, how long ago, and a 24-hour mini chart
  with threshold bands;
- a big chart per channel (6 h / 24 h / 3 days) with a readout, bands, alarm and antibiotic
  markers, and an accessible table view;
- a small "Hastanın normali" form for clinicians who may chart, writing the patient's own
  baseline ranges through the engine's existing profile endpoint;
- one new read endpoint that serves all of it, with the thresholds as data.

The browser draws. It never scores: every band, point total and "inside the patient's own normal"
flag comes from the engine. This is the rule `dashboard/src/live/screens/common/vitals.js` already
states ("NOTHING HERE IS A THRESHOLD") and the roadmap's threshold rule for Group 2: bands come only
from the device's own alarm limits (Stage B, validated), NEWS2 bands (the vault), and a
physician-entered patient normal.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Server composes, browser draws.** One endpoint returns series, bands, latest-value facts and markers. | Thresholds keep a single home (the engine). Stage B's validated monitor values enter the same series with no UI change. The two alternatives (browser-held NEWS2 constants; reading `/audit` ingest rows) were rejected: duplicated thresholds; `audit.view` that clinicians do not hold. |
| D2 | **Card frame from the engine's NEWS2 points** for that parameter: 0 → none, 1–2 → amber, 3 → red. Beside it a text badge ("NEWS2 +3"). | The user asked for the prototype's red frame; it must be the engine's number, not the browser's. |
| D3 | **Own-normal pill does not override the frame.** When the latest value sits inside the charted baseline, the pill "Hastanın normalinde" is shown next to the frame; both stay. | Wave 3 decision 5(d): both facts shown, neither silences the other. |
| D4 | **The baseline form is in this slice**, for `clinical.chart` holders, on the five channels the engine keeps baselines for (`api/clinical.py` `BASELINE_SIGNALS`: heart_rate, resp_rate, spo2, sbp, temperature). MAP and lactate are not offered. | The band is useless without a way to enter it; the backend exists. |
| D5 | **No waveforms.** The prototype's traces are synthetic and labelled "TEMSİLİ DALGA"; no ECG packet is decoded. Real numbers at 5 s live in the Stage A strip, which stays as it is. | A drawn waveform that is not a measurement is a lie on a clinical screen. |
| D6 | **Adult NEWS2 bands only**, labelled "NEWS2 · yetişkin", SpO₂ scale 1 only. | The engine computes NEWS2 for every patient (no age group exists in the profile) and scale 2 is an unsourced cell in the vault. The NICU gap is recorded in the vault, not papered over here. |
| D7 | **Stage A values are not charted.** | Stage A keeps no history by decision (120 s retention, device-keyed, unvalidated). Charting them would contradict that and bind device values to a patient before the bed↔patient binding exists. |
| D8 | **Thinning at 2 000 points per channel**, first/last/min/max of each bucket kept, flagged. | Today's spot-check data never reaches it; Stage B's 5 s data would be 51 840 points per 72 h. |
| D9 | **Device alarm limits reserved, not built.** The response leaves `bands.device: null`. | Stage B validates them; the shape should not change then. |

## 3. Screen behaviour

### 3.1 The trends box (`PatientScreen`)

Replaces the dashed placeholder (`Box title=t("patient.trends")`). Header: title "Vital eğrileri",
a note "NEWS2 · yetişkin bantları; hastanın normali hekim girdiyse" and, for `clinical.chart`
holders only, the button "Hastanın normali…".

Six cards in a grid (one column at 390 px, two at ≥ 861 px, three at ≥ 1200 px). Each card:

- channel label and unit from `vitals.js` (same names as the bed card);
- latest value in the channel's identity colour; beside it the delta since the previous
  measurement ("↑ +6", "↓ −3", "→ 0"), from the endpoint, never computed in the browser;
- "x dk önce / x sa önce" from `latest.ts` through the existing `elapsed.js`/`useNow`;
- a 24 h mini chart (46 px tall): band tints, points as dots, dashed connectors between
  measurements, no line when fewer than two points;
- frame per D2 with its text badge; the own-normal pill per D3;
- states: no measurement → "Bu kanal için ölçüm yok"; one measurement → value and "tek ölçüm";
  endpoint unreadable → the box header says "Vital eğrileri okunamıyor (son: HH:MM)" and every card
  keeps its last series (the strip's `unreadable` pattern).

Systolic and MAP share one card and one chart: two lines, two legend entries, MAP drawn in the
same `--v-map` colour at reduced opacity (they are told apart by label, as everywhere else).

Clicking a card (or Enter/Space on it — the card is a button) opens the big chart.

### 3.2 The big chart (modal)

`Modal` from the kit, wide. Header: bed label · patient name (via `nameOf`) · channel. Controls:
`Seg` 6 sa / 24 sa / 3 gün (refetches with `hours`); "Grafik | Tablo" `Seg`.

Graph view: 280 px chart with time axis labels in the hospital timezone and the user's language;
bands; points and connectors; ▲ alarm markers (`--crit`) and ◆ antibiotic markers (`--pri`) on
the time axis; a readout line above the chart: "HH:MM · <value> <unit>" plus the nearest marker's
label when within one pixel-column. Mouse hover moves the cursor; the chart is focusable and
←/→/Home/End move the cursor point by point. Legend: "NEWS2 bandı (yetişkin) · kaynak
news2-rcp-2017", "hastanın normali", "◆ antibiyotik", "▲ alarm", and "seyreltilmiş: N noktadan M"
when `thinned`.

Table view: a real `<table>` with caption, columns time · value · unit · NEWS2 band (the band's
points for that value, from the server's band list — a lookup, not a computation) · marker. The
same numbers the SVG shows, newest first.

### 3.3 The baseline form (modal)

Title "Hastanın normali". Five rows (pulse, respiration, SpO₂, systolic, temperature), each with
"alt" and "üst" numeric inputs, prefilled from `bands.own_normal` of the current response. Rules,
checked inline before sending:

- both sides or neither: one side filled → "iki sınır da gerekli";
- `low > high` → "alt sınır üst sınırdan büyük" (the engine refuses the same way);
- an empty pair is not sent — and **the engine replaces the whole baseline set with what is
  sent**, so an emptied pair deletes that baseline. The form says so under the fields: "Boş
  bırakılan aralık silinir. Komorbiditelere dokunulmaz."
- all pairs empty → the Save button is disabled (the engine refuses an empty profile; there is
  nothing to send).

Save → `PUT /clinical/{id}/profile` with `{"baselines": {...}}` only. On 200: the modal closes,
toast "Hastanın normali kaydedildi; motor yeniden değerlendirdi", the trends are refetched so the
band appears. On 400: the engine's reason under the form (it is already in the reader's words) and
a toast via `refusal.js` named after the bed label. On timeout: the may-have-landed rule — refetch
trends, tell the user to check the band. On 403 (right removed meanwhile): toast and close. The
button is not rendered without `clinical.chart` in the session's perms.

### 3.4 Who sees what

Charts: anyone who can open the patient screen (`board.view`, within scope). Form: `clinical.chart`.
Nothing here is role-specific beyond that.

## 4. The endpoint

`GET /patients/{patient_id}/trends?hours=24`

- `hours` ∈ {6, 24, 72}; anything else → 400. Default 24.
- Caller: JWT with `board.view`; `_require_patient` as for the board → 403 out of scope, 404
  unknown patient, 503 scope unreadable (the same three the board gives).
- No audit row for the read (the screen writes `view` on open already).

Response:

```json
{
  "patient_id": "…", "hours": 24,
  "since": "2026-10-18T09:00:00+00:00", "until": "2026-10-19T09:00:00+00:00",
  "generated_at": "2026-10-19T09:00:00.412+00:00",
  "bands_source": "news2-rcp-2017", "news2_scale": 1,
  "channels": [
    {
      "key": "heart_rate", "unit": "/min",
      "points": [["2026-10-18T10:12:00+00:00", 84.0], ["…", 88.0]],
      "thinned": false, "total_points": 2,
      "latest": {"ts": "…", "value": 88.0, "delta": 4.0,
                 "news2_points": 0, "within_own_normal": null},
      "bands": {
        "news2": [{"low": null, "high": 40, "points": 3}, {"low": 41, "high": 50, "points": 1},
                  {"low": 51, "high": 90, "points": 0}, {"low": 91, "high": 110, "points": 1},
                  {"low": 111, "high": 130, "points": 2}, {"low": 131, "high": null, "points": 3}],
        "own_normal": null,
        "device": null
      }
    }
  ],
  "markers": [
    {"ts": "…", "kind": "alarm", "label": "septic_shock"},
    {"ts": "…", "kind": "antibiotic", "label": "antibiotic_administered"}
  ]
}
```

Rules:

- `channels` always lists the board's seven keys (`api/board.py` `_PUBLISHED_SIGNALS`) in its
  order, even when empty (`points: []`, `latest: null`), so the screen's six cards never shift.
- `points` are `[iso_ts, value]` oldest first, from `PatientState.window(code, since, until)`.
- `latest.delta` is `value − previous value` over the whole history (not only the window), `null`
  when there is no previous one. `latest.news2_points` comes from `news2.score(state).breakdown`
  for the five NEWS2 channels, `null` otherwise (map, lactate). `latest.within_own_normal` is
  `true`/`false` when a baseline exists for the channel, `null` otherwise.
- `bands.news2` is present for the five NEWS2 channels (`resp_rate`, `spo2`, `sbp`, `heart_rate`,
  `temperature`), `null` for map and lactate. Open-ended bands carry `null` at the open side.
- `bands.own_normal` is the charted `BaselineRange` for the channel, or `null`.
- `markers.alarm` are the patient's audited `alert` events in the window (`subject` = kind);
  `markers.antibiotic` are `ANTIBIOTIC_ADMINISTERED` observations in the window.
- Thinning (D8): when a channel has more than `TRENDS_MAX_POINTS = 2000` points in the window,
  the window is cut into 500 equal buckets and each bucket keeps its first, last, minimum and
  maximum (deduplicated, in time order); `thinned: true`, `total_points` = the count before.
  As built (plan X20), the 500 slices cut the span from the window's first reading to its last,
  not the whole window: finer slices when the readings cover part of it; every guarantee holds.

## 5. Engine and API changes

1. **`rules/news2.py` — bands as data.** `NEWS2_BANDS: dict[str, tuple[Band, ...]]` for the five
   parameters, each `Band(low, high, points)` with `None` for an open side, derived from the
   same numbers the `*_points` functions use today. The functions are rewritten to look the
   value up in the table so there is one source; the existing tests pin every boundary (≤ 8 → 3,
   9–11 → 1, … for all five) so no score moves. `BANDS_SOURCE = "news2-rcp-2017"` names the vault
   source note.
2. **`state/timeline.py` — `thin(series, max_points)`**, a pure function over `[Observation]`
   returning the kept subset in time order, plus `window()` as is.
3. **`api/audit.py` / `audit_postgres.py` / `SqliteAuditLog` — `records(…, since=None)`.** A
   `ts >= since` clause. The `/audit` route does not change; only the trends endpoint passes
   `since`. (The "oldest N rows" issue noted in the roadmap for `/audit` and `/alarm-quality`
   stays a separate Group 2 item.)
4. **`api/trends.py` (new) — `patient_trends(engine, audit, patient_id, hours, now)`** builds the
   response above from the engine's state, profile, NEWS2 result and the audit; `api/app.py`
   mounts `GET /patients/{patient_id}/trends` with the board's caller and scope checks.
5. **Isolation.** The trends module imports nothing from `infinity_shadow`; the existing
   isolation test gains the assertion that the shadow store is not referenced by it.

## 6. Dashboard changes

- `src/backendApi.js`: `patientTrends(patientId, hours)` (GET, 15 s timeout, same error mapping
  as `patients()`), `putPatientProfile(patientId, body)` (PUT).
- `src/live/screens/patient/trends/`:
  - `trendGeometry.js` — pure: scales, band rectangles, path data (with gaps), tick values,
    marker positions, nearest point to an x; unit-tested without React.
  - `TrendChart.jsx` — SVG renderer for mini and big; props: channel, points, bands, markers,
    hours, height, cursor, onCursor; `role="img"` with a summarising `aria-label`.
  - `TrendCard.jsx` — the card (button) with value, delta, age, frame per D2, pill per D3.
  - `TrendsBox.jsx` — the box: fetch state, unreadable header, grid of cards, opens the modals.
  - `TrendModal.jsx` — big chart with `Seg` hours and Grafik|Tablo, keyboard cursor, readout
    (`useAnnounced` for keyboard moves only), the table view.
  - `BaselineForm.jsx` — the form per §3.3, on the kit's `Modal`, `Field`, `Button`.
  - `useTrends.js` — fetch on mount and when the patient card's `measuredAt` changes, every 60 s
    while the screen is visible and the session is READY; stops on lock/sign-out; keeps the last
    answer on failure and reports `unreadable` with the last success time.
- `src/live/theme/tokens.css`: `--band-n`, `--band-mid`, `--band-crit`, `--grid` for Gece and
  Gün (low-alpha tints; the `--v-*` lines must keep 3:1 on `card` over them — the contrast test
  gains these pairs). The header comment's "not ported yet" list drops `--band-*`/`--grid`.
- `src/live/i18n/strings/patient.js`: the keys in §9, four languages.
- `src/live/screens/patient/PatientScreen.jsx`: the dashed placeholder is replaced by
  `TrendsBox`; the `trendsSoon` key is removed. The forms seam stays visible, since forms are
  still Group 3: the existing `formsSoon` sentence moves into a one-line `Note` under the
  Sepsis/Meds row, unchanged in wording.

## 7. Accessibility and honesty

- Every chart has a text equivalent: the card's value/delta/age text and the modal's table.
- Keyboard: cards are buttons; the modal traps focus (kit); the chart takes focus and moves the
  cursor with arrows; Escape closes. As built (plan X28), the chart that takes the keys is
  `role="application"` with a localised role description, so NVDA and JAWS hand it the arrows
  (over an `img` they stay in browse mode); the card's mini chart, with no keys, stays `aria-hidden`.
- Colour is never the only carrier: bands have a written legend, markers differ in shape, the
  frame has a text badge.
- The screen reader hears the readout only on keyboard moves (`useAnnounced`), never on hover.
- Age and timestamps in the hospital's timezone (tenant), as the board does.
- 390 px: one-column cards, full-width modal, no horizontal scroll (the screen test util's
  overflow check).
- The box never draws a line between two measurements as if it were a measurement: the
  connectors are dashed and the legend says "noktalar ölçüm, kesikli çizgi aralık".

## 8. Testing

- Engine: `tests/test_news2_bands.py` (table ↔ function parity on every boundary; scale 1 only),
  `tests/test_timeline_thin.py` (≤ max, first/last/min/max of every bucket kept, order kept,
  identity below the cap), `tests/test_audit_since.py` on the real Postgres fixture and SQLite.
- API: `tests/test_trends_api.py` — shape and channel order; `hours` validation; 403/404/503
  through `_require_patient`; bands only on NEWS2 channels; `own_normal` and
  `within_own_normal` after a profile write; alarm markers from the audit within the window only;
  antibiotic markers; thinning flag and counts; no shadow reference (isolation test extended).
- Dashboard: `trendGeometry.test.js`; `TrendChart.test.jsx` (points, gaps, bands, markers,
  aria-label, cursor); `TrendCard.test.jsx` (frame and badge only from `news2_points`, pill from
  `within_own_normal`, delta text from the field — a test asserts the browser never derives
  these); `TrendModal.test.jsx` (hours refetch, Grafik|Tablo equivalence, keyboard cursor and
  announcement); `BaselineForm.test.jsx` (prefill, both-or-neither, low>high, full-set body,
  400/403/timeout paths, no button without `clinical.chart`); `useTrends.test.js` (refetch on
  `measuredAt` change, stop on lock); `rawKeys` sweep and the i18n completeness test in four
  languages; contrast test with the new tokens.
- End to end: the local stack with `scripts/replay.py` → open the patient → cards show the
  recorded observations, the modal's table matches the recording. On the VM: the user's look at
  a real patient, 390 and 1440 (values are not written down).

## 9. i18n keys (namespace `patient`)

`trends`, `trendsNote`, `trendsUnreadable` ({time}), `trendsNoData`, `trendsSingle`,
`trendsThinned` ({kept}, {total}), `trendsBandNews2`, `trendsBandOwn`, `trendsMarkerAlarm`,
`trendsMarkerAntibiotic`, `trendsLegendPoints`, `trendsOpen` ({channel}), `trendsHours6`,
`trendsHours24`, `trendsHours72`, `trendsGraph`, `trendsTable`, `trendsReadoutIdle`,
`trendsDelta` ({delta}), `trendsFrameBadge` ({points}), `trendsOwnNormalPill`,
`baselineTitle`, `baselineOpen`, `baselineLow`, `baselineHigh`, `baselineBothOrNeither`,
`baselineLowAboveHigh`, `baselineClearsNote`, `baselineSaved`, `baselineRefused` ({subject},
{reason}), `baselineMayHaveLanded`, `baselineNoRight`.

## 10. Not in this slice

Waveforms; the unit board (`grafik.js`); the wall monitor; the "next measurement due" counter
(nursing tasks, Group 3); non-antibiotic medication markers; device alarm limits (Stage B);
lactate and MAP baselines (the engine keeps none); neonatal bands; a separate "Trendler" tab;
charting Stage A values; the `/audit` oldest-N fix beyond `since`.

## 11. Risks and open points

- `PatientState._history` is an unbounded in-memory list per signal; with Stage B's continuous
  data it needs a retention cap. Not this slice; noted for Stage B's plan.
- The az and ru strings need a native reading before the VM, as with Stage A.
- The first restart after deploy rehydrates history from the audit (existing behaviour, up to
  1 000 000 rows): the charts are as complete as the audit.
- Acceptance on the VM will show sparse charts today; that is the data, not the chart.
- **Found while planning (2026-10-19; `docs/superpowers/plans/2026-10-19-g2-vital-egrileri.md`,
  "What the code says", X1–X35; X1–X19 approved by the user on 2026-10-20; the list also covers
  X20–X35, found by reviews on 2026-10-20 and 21 — X35: §3.1's delta is against the previous
  *measurement*, not the previous row, because the uplink can deliver one reading twice):** the plan departs from this spec where the code made its letter
  impossible or unsafe — 503 for an unreadable scope, checked before `_require_patient` (X1); bands
  as `low < v <= high` (X2); alarm marks from `first_seen`, one per episode, not from `alert` rows
  (X3); antibiotic marks only for doses ≥ 1 (X4); each point carries the engine's NEWS2 points
  (X5); MAP at full colour with hollow dots, because reduced opacity measured 2.17–3.34:1 (X6);
  ages through `useBoardNow` (X7); a 400 only on the toast (X8); `onlyWrite` and `formsSoon`
  reworded (X9); 390 px checked in a browser (X10); `replay.py --now` (X11); thinning slices the
  readings' span, not the window (X20, §4); alarm marks read up to 5000 episodes with
  `markers_truncated`, and a non-finite reading never drawn (X22, with the gateways refusing
  NaN/±inf — plan Task 3b); the trends hook coalesces same-key reads instead of superseding them,
  so a chart can fill at Stage B rates (X23); card values in ink, not the identity colour (X24);
  the route resolves the scope once (X25); no NEWS2 tints on a two-series mini chart (X26); the
  readout names MAP beside systolic (X27).
- The last baseline can be removed (the user's choice for O4, 2026-10-20): every row emptied over
  a charted set sends `{"baselines": {}}`, which the engine takes as clearing every range even when
  nothing else is charted, and the audit replay reads each profile row over the one before, so the
  clear survives a restart (plan X15, Task 14a).
- §3.3's save toast says the engine re-evaluated; the profile PUT re-scores nothing — the standing
  alerts are re-judged at the next reading (plan X21, O12). Every save now shows it, so the user
  decides before the VM. Recommendation (the Task 14 spec review): reword `baselineSaved` in four
  languages to what the PUT does and name the patient with `{subject}` in this slice; make the door
  re-judge the latest state when the profile changes as a follow-up.
- `PUT /clinical/{id}/profile` replaces the set with no lost-update check: two clinicians saving one
  patient's normal at once — the second wins silently. The form now notices a set that changed while
  it was open (the minute's poll) and holds Save until it is reopened (plan X34); two saves inside one
  poll still race (plan O3).
- The form is shown only to the patient it was opened for, and its title names the bed (plan X31): the
  patient screen outlives a move, so without that a form opened on one patient could write under the
  next. What Save will do is said beside Save (X32); a held submit goes to the first wrong field (X33).
- ▲ on the charts is a finding's first detection for this patient, not every episode: the engine's
  active alerts never clear a kind today (plan O17 — an engine fix, the user's choice of slice).
- The keyboard-driven big chart is `role="application"` with a role description, not §6's
  `role="img"` (plan X28): NVDA and JAWS stay in browse mode over an image, and the arrow keys
  that §7 promises would move the cursor never reach it. The table carries the legend's notes
  (X29); a MAP read beside systolic at another minute prints its own time (X30).
- Open for the user or later (plan O21–O23): the reading's NEWS2 points in the spoken readout
  (O21); two cursor stops in one minute with one value say the same words, so the second is
  silent (O22, Stage B); two tests past the size guide, to split when they next change (O23).
- Who enters the patient's normal (plan O15): the form is offered to every `clinical.chart` holder — by default nurses, charge nurses and the rapid response team as well as physicians — so §1's "physician-entered" and §3.1's "hekim girdiyse" are, as built, "hastanın normali, girildiyse". Physician-only would be a permission change, not a text; the user's decision before the VM.
- `errors.scopeUnreadable` speaks of the live stream, and the trends route's 503 carries the same
  key; no screen prints it there today (the box only marks the trends unreadable). Reword it
  route-neutrally, in four languages with a native reading, before any screen does (plan O9).
- **Deploy order (plan O24):** bridges before, or with, the hub — after Task 3b the hub answers 400
  to a non-finite FHIR value and an edge uplink keeps a refused observation at the head of its
  queue, retrying it and holding every later reading; check the bridges' buffers for non-finite
  rows before upgrading the hub. Never the dashboard alone: the clear (`{"baselines": {}}`) needs
  Task 14a's engine — an older engine refuses it ("profil boş olamaz") and its replay brings
  cleared ranges back after a restart. One branch carries both lanes, so one deploy does.
- **Acceptance, as measured.** (1) Python 3.12, 3.14 and the dashboard green, counts in the plan.
  (2) The 72 h window: p50 ≈ 4 ms over 100 requests; the max, 29–50 ms over seven runs, is one gen-2 garbage
  collection inside a request — a pause the server also pays, not a cold start — well inside the
  300 ms bound. The 5 s half (a synthetic 5 s series thins to ≤ 2 000 points) is met by
  `test_a_desaturation_survives_three_days_of_five_second_data` (Task 2): 51 840 readings thin to
  at most 2 000 and the one planted low reading stays. (3, 4) Walked on 2026-10-21 on the local stack with synthetic accounts and
  scenarios (a headless-Chrome driver): the engine's answers matched the plan line for line; six
  cards, frames equal to the engine's points, the table equal to the chart, the form writes and
  the band appears, a clear survives a restart; 390 / 1440 px, four languages, both themes, no raw
  key. Left for a person (plan O25): NVDA — focus mode on the chart, the readout once per move,
  the table in browse mode while polls insert rows; MAP's hollow ring against a dot by eye; the
  72 h time labels at `--fs` 1.12; and the by-eye choices the reviews left open (values in ink —
  X24; no tints on the two-series mini chart — X26; the 3-point band quieter than the 1–2-point
  band in Gece; the dialog's grid lines faint in Gün). (5) The VM look stays the user's.
- Additive ideas not taken in this slice: `previous_ts` beside `delta` ("since when"), and a
  severity on the alarm marks.

## 12. Acceptance (Kabul)

1. All new tests green on Python 3.12 and 3.14 and in the dashboard; counts recorded in the plan.
2. `GET /patients/{id}/trends?hours=72` answers a 72 h window of spot-check data in < 300 ms
   locally; a synthetic 5 s series thins to ≤ 2 000 points with the flag set.
3. On the local stack with a replayed scenario: six cards, the frame colour equals the engine's
   NEWS2 points for the latest value, the modal's table equals the chart, the baseline form
   writes and the band appears.
4. 390 px and 1440 px, four languages, both themes: no horizontal overflow, no raw keys, contrast
   test green.
5. On the VM (the user): the patient screen of a real patient shows the cards with the real
   spot-check history; nothing else on the screen changed; no values written down.
