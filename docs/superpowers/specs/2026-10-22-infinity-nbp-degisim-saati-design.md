# Infinity shadow lane · NBP on the monitor strip, with the time its value last changed

**Date:** 2026-10-22 · **Status:** draft for the user's review · **Scope:** Stage A code (hub forwarder → API shadow store → monitor strip). One small slice before O17.

## 1. Why

On 2026-10-22 the user compared the ward's board with the Dräger central station: the device→bed table and every shown value matched one-to-one, but NBP was missing (bed05 showed a cuff reading on the monitor and nothing on the board). The user asked for NBP.

NBP was withheld on purpose at Stage A (`docs/INFINITY-PARAMETER-RECORDS.md` §"NBP şeritte yoktur"): the monitor repeats the **last** NBP in every packet as a valid record, and the device's own timestamp bytes are not decoded, so the strip's "N san" age would be meaningless for NBP — a value measured hours ago would read as fresh, and in a bed whose patient changed it could be the previous patient's.

**Decision (user, 2026-10-22):** show NBP with the time its value **last changed**, as observed by the hub. A change of the (systolic, diastolic, mean) triple is evidence that a measurement happened at or before that moment; the shown time is therefore an **upper bound** of the measurement time and never fresher than reality. After a hub restart nothing is known, so NBP stays hidden until the next change (user's choice: "sonraki ölçüme kadar gizle").

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | The change is tracked on the **hub** (.72), in memory, in `LiveResearchView._consume_one` (`edge/infinity_live.py`). The worker (.74) is untouched. | Decoding happens only on the hub; the journal holds encrypted bodies for 900 s and is never read back; the worker ships raw payloads. |
| D2 | A **change** is: the packet carries all three NBP records (`0x1E08` systolic, `0x1E07` diastolic, `0x1E09` mean) **valid**, and the triple differs from the last complete valid triple held for that device. Partial or invalid packets neither count nor clear the held triple. An identical re-measurement is not detected (the shown time stays older than the truth — the safe direction). | Honest bound; the records doc says components may be valid only in some message types. |
| D3 | `changed_at` is the packet's `received_at` (the worker's receipt stamp, held within 3 s of the hub clock — the same basis as every other age on the strip). | No device clock is decoded; one time basis for the whole strip. |
| D4 | After a hub start (or when a device has never shown a change since start) `changed_at` is unknown → the forwarder sends **no** NBP for that device. The strip shows the NBP cell as "— · ölçüm gözlənilir". | User's choice; never a value whose measurement time is unknown. |
| D5 | Wire: shadow schema **v2** = v1 plus an optional reading key `changed_at` (epoch seconds, float), allowed **only** on `nbp_systolic`, `nbp_diastolic`, `nbp_mean`, required on them, forbidden elsewhere. The three readings travel with the same `changed_at`. `captured_at` stays the packet time (so `too_old`/`duplicate` judging is unchanged). The API accepts v1 and v2. | The API's reading schema is closed (exact keys, numeric `value`); a separate key keeps `_judge` intact; v1 acceptance makes the API-first rollout safe. |
| D6 | The API withholds NBP when `now − changed_at > 2 h` (`NBP_MAX_MEASURED_AGE_S = 7200`): the board entry gets `state: "old"`, no numbers, `last_at = changed_at`. Otherwise `state: "value"` with `changed_at` (ISO) and `measured_age_s`. The 15 s freshness rule still applies to `captured_at` (a silent device goes `old` like any other parameter). | The threshold lives in one place (the API), as every other threshold does; the strip computes nothing. |
| D7 | The strip shows **one** NBP cell: `NBP S/D (M) mmHg · ölçüm ≤ HH:MM (N dəq)`; the three readings are folded by the API into one board parameter entry `nbp` with `systolic`, `diastolic`, `mean` (numbers) so the dashboard needs no triple logic. In the full variant the evidence line reads the records doc's "ekranla birebir" (`screen_match`). | One cell, one age, one rule; the dashboard keeps dropping unknown parameters. |
| D8 | Deploy order: **API + web first** (accept v2, render `nbp`), **then the hub** (release R4 of `run_infinity_transport`, drop-in `94-nbp.conf`). The worker is not deployed. Rollback: delete drop-in 94 → R3 (v1, no NBP); the API keeps accepting v1. | Reverse of the worker→hub rule: here the receiver must understand the new schema before the sender speaks it. |
| D9 | When device→patient links exist (Stage B), a link change resets the device's NBP (hidden until the next change). Recorded as a rule now; implemented when links come. | The previous patient's NBP must never show on the next. |

## 3. Data flow (as built)

```
monitor ─multicast─▶ worker .74 (raw payload, received_at) ─POST /v1/packets─▶ hub .72
   hub: infinity_records.parse_payload → LiveResearchView._consume_one
        DeviceState.nbp_triple = (S,D,M); DeviceState.nbp_changed_at = epoch | None        ← NEW
   forwarder (infinity_shadow.thin): readings nbp_systolic/diastolic/mean + changed_at     ← NEW (schema v2)
        ─POST /infinity-shadow/readings─▶ API shadow store (_validate v1|v2, _judge, _Held + changed_at)
   GET /infinity-shadow/board → device.parameters[…, {"parameter":"nbp", "state", "systolic","diastolic","mean",
        "unit":"mmHg", "age_s", "last_at", "changed_at", "measured_age_s", "evidence":"screen_match", "partial":false}]
   dashboard monitor.js (PARAM_ORDER + "nbp") → MonitorStrip Cell → "NBP S/D (M) mmHg · ölçüm ≤ HH:MM (N dəq)"
```

## 4. Engine changes

### 4.1 `edge/infinity_live.py`
- `DeviceState` gains `nbp_triple: tuple[float, float, float] | None` and `nbp_changed_at: float | None`.
- In `_consume_one`, after the parameters are stored: read the three decoded records from the packet; if all three are present and `valid`, build the triple; if `nbp_triple` is `None` → hold the triple, keep `nbp_changed_at = None` (first sight, unknown); else if the triple differs → hold it and set `nbp_changed_at = epoch`; identical → nothing. A packet with a missing or invalid component changes nothing.
- The snapshot's `nbp_*` parameter entries carry `changed_at` (float or `None`); `_age_ms` is unchanged.
- Tests (`tests/test_infinity_live.py`): first sight → `None`; change → the packet's epoch; identical → unchanged; partial (two of three) → unchanged; invalid component → unchanged; a change after a backlog/outage is seen on the first live packet; a dropped old packet (≥ 3 s) changes nothing.

### 4.2 `edge/infinity_shadow.py` (the forwarder)
- `SCHEMA = "homunculus.infinity-shadow.v2"`; `FORWARDED` gains the three `nbp_*` names.
- `thin()`: an `nbp_*` reading is sent only when the snapshot entry is fresh (as today) **and** `changed_at` is not `None`; it carries `"changed_at": float`. Line 34's comment is rewritten to say what is sent and why the time is a bound.
- Tests (`tests/test_infinity_shadow_forwarder.py`): `test_thin_sends_hr_and_spo2_and_never_nbp` → "sends NBP with its change time, and not before a change was seen"; the exact reading dict and the device key set updated; the end-to-end cycle test asserts the board carries `nbp`.

### 4.3 `api/infinity_shadow.py` + `api/app.py`
- `_validate`: accept schema v1 (as today) or v2; in v2 `_READING` is `{"parameter","value","unit","valid","captured_at"}` plus `changed_at` **iff** `parameter` starts with `nbp_` (required there, `float`, finite, not more than 2 s in the future, not after `captured_at`); anywhere else `changed_at` is an unknown key → `ShadowRejected`. `MAX_READINGS` stays 16 (9 + 3 = 12).
- `PARAMETERS` gains the three `nbp_*` entries (unit `mmHg`, evidence `screen_match`, partial `False`), so `_judge` no longer counts them as `unknown_parameter`. `_Held` gains `changed_at`.
- `_view`: the three held NBP readings are folded into **one** entry `{"parameter":"nbp", …}` as in §3; a device with fewer than three held NBP readings, or with `now − changed_at > NBP_MAX_MEASURED_AGE_S (7200)`, gets `state:"old"` with `last_at = changed_at` (or `null`) and no numbers. `devices()` emits `nbp` after `respiration`.
- `shadow_check.py`: a `nbp` cell counts as fresh like any `value` cell; one summary line "nbp: N cihazda ölçüm saati ≤ …" (no values).
- Tests (`test_infinity_shadow_store.py`, `test_infinity_shadow_api.py`, `test_infinity_shadow_check.py`, equivalence/isolation): v1 body still accepted; v2 with `changed_at` on NBP accepted; `changed_at` on `hr` refused; `changed_at` after `captured_at` refused; 2 h withholding; folding; the parameter-table test updated ("excludes airway respiration" only); bound test 100 × 12.

## 5. Dashboard changes
- `monitor.js`: `PARAM_ORDER` gains `"nbp"`; the `EVIDENCE`/`PARTIAL` copies gain it (`monitor.test.js` 126–137 parses the API's tables — they must agree); `cellOf` returns for `nbp` `{kind:"nbp", systolic, diastolic, mean, changedAtMs, measuredAgeS, ageS}` when `state==="value"`, else the existing `old`/`invalid` kinds. **No numeric threshold in the browser** (the 2 h rule is the API's; `monitor.test.js` 139–143 forbids `value <`/`>` comparisons).
- `MonitorStrip.jsx`: the `nbp` cell renders `S/D (M)` + unit + `t("monitor.nbpMeasured", { time: hhmm(changedAtMs), age })` as a `<small>`; `col-span-2` in the compact grid; sr text "NBP S over D, mean M, measured at or before HH:MM, N minutes ago". Withheld: dash + `monitor.nbpWaiting` ("ölçüm gözlənilir") when `last_at` is null, else the existing `old` text with the measured age.
- `SettingsScreen.jsx` legend: NBP row with evidence `screen_match`; `legendNbp` reworded (shown with the change-time bound; hidden > 2 h; hidden after a hub restart until the next measurement). `SettingsScreen.test.jsx:151–157` updated.
- Strings (`i18n/strings/monitor.js`, ×4, az default): `p.nbp` "NBP" (neutral — add to `NEUTRAL` and `AZ_SAME_AS_TR`), `nbpMeasured` az "ölçüm ≤ {time} ({age})" / tr "ölçüm ≤ {time} ({age})" / ru "измерение ≤ {time} ({age})" / en "measured ≤ {time} ({age})", `nbpWaiting` az "ölçüm gözlənilir" / tr "ölçüm bekleniyor" / ru "ожидается измерение" / en "awaiting a measurement", `legendNbp` reworded, sr sentence `nbpSaid`.
- `data/shadow.testutil.js`: `param("nbp", …)` builder; `MonitorStrip.test.jsx`: value cell, withheld cell, sr sentence, `col-span-2`; `rawKeys.test.jsx` reaches the cell through the beds board stub.

## 6. Acceptance (on the VM, with the user)
1. bed05: the board's NBP S/D (M) equals the central station's, and "ölçüm ≤ HH:MM" is **not later** than the cuff time the monitor shows; after the next cuff cycle the time advances.
2. A bed whose NBP has not changed since the hub start shows "— · ölçüm gözlənilir" (no number).
3. Two hours after the last change the cell shows a dash with "eski · 2 sa …"; the central station keeps showing the old value — the board is the stricter one, by design.
4. `shadow_check.py` KABUL with the new `nbp` line; `PANO_OZET` unchanged (NBP is not a board/alert input).
5. The engine never reads NBP from the strip (the trends/NEWS2 path is untouched): `test_infinity_shadow_isolation.py` still passes.

## 7. Not in this slice
- Decoding the device's own timestamp bytes (research; would replace the bound with the true time).
- Showing NBP on the patient screen's trend cards (the charts read the engine's clinical observations, not the strip).
- Device→patient links and the reset rule's implementation (D9 is recorded; Stage B).
- Airway RESP (layout unverified) stays withheld.

## 8. Risks and honesty
- The shown time is a **bound**, not the measurement time; the legend and the cell say "≤". A cuff cycle that repeats an identical triple makes the bound older than the truth — never newer.
- After a hub restart NBP disappears until the next measurement (minutes to an hour in ICU); the legend says so.
- The hub's clock vs the worker's receipt stamp: as today (≤ 3 s).
- Rollout: API first; a hub on R4 posting v2 to an old API would be refused whole (400) — the forwarder's `failed` counter and `shadow_check` would show it; the order in D8 prevents it.

## 9. Deploy notes (for the block file)
- API + web: bundle → build api web → up (no migration).
- Hub: `build_transport_release.py` → `transport-<hash>.tar.gz` → `/opt/homunculus-infinity/` → drop-in `94-nbp.conf` (copy of 92 with the release path) → `daemon-reload` → restart hub → `transport_check.py` + `shadow_check.py` KABUL.
- Rollback tiers: delete 94 (hub back to R3, v1); API/web by image tag as before.
