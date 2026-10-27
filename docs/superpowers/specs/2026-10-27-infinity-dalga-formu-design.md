# Infinity dalga formu — live waveforms from the monitors (design)

**Date:** 2026-10-27 · **Lane:** C (dalga) · **Branch:** `feat/infinity-dalga` (base main `b985810`)
**Protocol:** [docs/INFINITY-DALGA-FORMU.md](../../INFINITY-DALGA-FORMU.md) — what the packets carry and how far it is validated.

## 1. Why, and what changed

The bedside monitors' multicast payload carries ECG, arterial pressure, pleth and impedance
respiration samples in every 200 ms packet. Until now Homunculus showed none of it: the packets were
undecoded, and two earlier decisions kept waveforms off the screen (G2 spec D5 "No waveforms"; Aşama A
plan: the strip "must be slow enough not to be a monitor").

On 2026-10-27 the owner decided to do it **now, inside Aşama B, by reverse engineering**, and chose:

| # | Owner decision (2026-10-27) |
|---|---|
| W1 | Shown on the **device page and the patient detail** (clinicians see it, labelled unvalidated). |
| W2 | **Live scrolling** drawing (seconds behind the monitor), not a refreshed snapshot. |
| W3 | **All four decoded waves**: the live ECG lead, ART (mmHg), pleth, respiration. |
| W4 | The owner films the **ward screen-validation** capture (§9). |
| W5 | (after spec approval) The prototype's **full-screen single-bed view** (`⤢`, black bedside look) comes back with real waves. |
| W6 | (after spec approval) The prototype's **"Duvar monitörü"** page (every bed, nurse-station TV) comes back with real waves — phase 2 (§11). |

W2 deliberately reverses the Aşama A "not a monitor" principle, and W6 goes further: a screen of
every bed is the shape of a central station. The safety rules in §5 are the price of that reversal
and are not optional. The prototype's **pulse beep and alarm tones do not come back** (§5.8).

The prototype labelled its synthetic traces "Numune / temsili dalga" (istekler #172 removed the
label). These traces are real, so "temsili" would now be false; the stamp of §5.1 replaces it.

## 2. What the data is (summary of the protocol doc)

- Every packet (5/s per bed) = 64-byte header + wave blocks; byte 29 is the message type; the 1/s
  type adds the numeric-record section after the same blocks.
- Block: `u16 rate_hz | u16 len | u16 ms | u32 device_s | u16 wave_id | u8 n | u8 0 | n×i16 BE`.
- ECG 200 Hz on `0x0102`, `0x0103`, `0x0104` (and `0x0122`, `0x0124`, never seen live). **Which
  one is live differs by bed** (BED07: `0x0103`; BED08: `0x0102`); id→lead-name is unverified, so
  the panel picks ECG rows by liveness and never prints a lead name.
- Pressure 100 Hz, **mmHg = sample/40** on both ids seen: `0x0301` (screen "ART", BED07) and
  `0x0e01` (screen "P1", BED08). A pressure row is labelled by its id (`ART` only for `0x0301`,
  `P1` for `0x0e01`); any other pressure id is drawn unlabelled as "basınç".
- `0x1916` pleth 100 Hz (relative) · `0x0201` resp 50 Hz (relative).
- A block whose samples are **all** `0x0001` means "no signal" (lead off / channel closed).
- Validated structurally and numerically on two beds, and at the one-second level against the
  BED08 screen (HR, PLS, SpO₂, resp, P1 series all match through 40 s); **not** sample-exact
  against the screen; ECG gain unknown.
- **Numeric ids `0x0101` and `0x1905` are the reverse of `infinity_records.py`'s `hr`/`pls`
  labels** (BED08, 2026-10-27). Out of this slice's scope — see the protocol doc — but the panel's
  "numbers beside the waves" are the strip's, so the strip's fix carries into the panel.

## 3. Data path

```
monitor ──multicast──▶ worker ──(already: every payload, TLS)──▶ hub
                                                                  │  NEW: decode wave blocks into a
                                                                  │  20 s in-memory ring per device
                                     API  ◀── GET /infinity-research/waves (viewer token, keep-alive)
                                      │  NEW: GET /infinity-waves/{device_id}?since=… (same gates as
                                      │  the strip; 250 ms per-device cache)
                                 browser  polls ~750 ms, draws on <canvas> ≈2–3 s behind the monitor
```

Nothing new runs on the worker: it already forwards every datagram with its payload
(`--capture-payload`). Waves are pulled **only for a bed someone is looking at**; the Aşama A
forwarder lane (5 s, ≤1 POST/s, 64 KiB) is not touched and could not carry them.

### 3.1 Hub — `edge/infinity_waves.py` (new) + two hooks

- `parse_waves(payload) -> list[WaveBlock]`: pure, never raises; returns `[]` unless the blocks
  tile from offset 64 with `len == 14 + 2n`, `n == rate/5`, `rate ∈ {50, 100, 200, 250, 500}`,
  `ms ∈ [0, 999]`. Stops at the first non-block (the record section) and keeps what came before.
- `WaveBuffer`: per device, the last **20 s** of blocks, ordered by device time
  (`device_s + ms/1000`), de-duplicated on `(device time, wave_id)`. A packet whose
  `received_at` is more than **3 s** old is not added (the same rule `LiveResearchView` uses, so a
  worker outbox replay after an outage never appears as live). A monotonic `cursor` per hub process.
  A fresh block more than **10 s** older than the monitor's newest clears that monitor's ring (its
  clock was set back; anything older than the 10 s answer window could never be served and would
  only stall the answer), and blocks received more than 20 s ago are forgotten (plan R5, amended
  2026-10-27 after the Task 2 review). Set-backs of 10 s or less are not detected; they stall
  (phase kept) or overlap the old stream (phase shifted) for at most that long and self-heal.
- Hook 1: the `/v1/packets` handler hands accepted events to `WaveBuffer.consume` next to
  `research_view.consume` (research mode with payload capture only).
- Hook 2: `GET /infinity-research/waves?device=<id>[&device=<id>…]&since=<cursor>` (viewer token;
  409 when research mode is off; 404 when a named device is unknown; at most 16 devices). The cursor
  is one counter for the whole hub, so a single `since` serves any set of devices (the wall, §11).
  Returns at most **10 s** of blocks per device after `since`; with several devices the body is
  `{"schema", "cursor", "hub_now", "devices": {"<id>": {"blocks": […]}}}`. For one device:
  ```json
  {"schema": "homunculus.infinity-waves.v1", "device_id": "…", "cursor": 1234,
   "hub_now": "…Z",
   "blocks": [{"t": 804484638.24, "recv": "…Z", "id": 259, "rate": 200,
               "samples": [12, 15, …] | null}]}
  ```
  `samples: null` = the all-`0x0001` "no signal" block. A lone `1` inside a live block is data.
- `deploy/infinity/build_transport_release.py` gains `infinity_waves` in `EDGE` (new hub release R5).
- CPU: decoding ≈65 packets/s is a few µs each; acceptance still measures the hub (§8).

### 3.2 API — `api/infinity_waves.py` (new) + one registration line in `app.py`

- Route `GET /infinity-waves/{device_id}?since=<cursor>`. Phase 2 adds `GET /infinity-waves?since=<cursor>`:
  every device the caller may see on the strip board (same gates, at most 16), in one hub request.
- **Gates — the same as `/infinity-shadow/board`:**
  - `board.view` or `devices.manage`;
  - the caller's hospital is the shadow hospital;
  - the device must be on a card that `board_view` would show this caller (same scope lambdas).
  - A device the caller may not see → 404, indistinguishable from an unknown device.
  - Off unless `INFINITY_WAVES=on` (default off; requires the shadow stage on and the existing
    `INFINITY_HUB_URL` / `INFINITY_VIEWER_TOKEN` / `INFINITY_HUB_CA_FILE`).
- One shared `httpx.AsyncClient` to the hub:
  - keep-alive (no TLS handshake per poll); 2 s timeout; 1 MiB cap;
  - no redirects or proxy; the existing CA pinning.
  - Per-device cache of 250 ms with single-flight, so several viewers of one bed cost one hub
    request.
- Response passed through an allow-list (the keys above). The API adds a `waves` catalogue:
  ```text
  {id: {kind: ecg|pressure|pleth|resp, label, rate, unit, scale, evidence}}
  ```
  `pressure` → `unit: "mmHg", scale: 1/40`, label `ART` (`0x0301`) or `P1` (`0x0e01`); `ecg` has
  no label (the screen says "EKG"); the others relative. (Amended 2026-10-27 after BED08: the
  earlier `art`/`ecg_other` kinds are superseded.)
- Nothing is written: no DB, no audit row, no log line containing samples.
- nginx API prefix list + `tests/test_nginx_routes.py` + Vite proxy gain `/infinity-waves`.

### 3.3 Dashboard

- `live/data/waveStore.js`:
  - one subscription per device, polling every 750 ms with the cursor while subscribed and the tab
    is visible; keeps 20 s of blocks;
  - maps 403/404/409/stage-off to a status, never to an empty trace.
- `live/screens/common/WavePanel.jsx`:
  - `<canvas>` with a `requestAnimationFrame` loop;
  - pure geometry in `waveGeometry.js` (testable without a canvas);
  - rows in fixed order: ECG (≤ 2, by liveness), pressure (≤ 2, ART/P1), pleth, resp — a row only
    for a wave the bed transmits; a transmitted-but-dead group still gets one "sinyal yok" row.
- Placement:
  - `DevicesScreen` card, under the full MonitorStrip;
  - `PatientScreen`, under the MonitorStrip block (only when the strip shows one linked device,
    `link === "one"`).
  - Both are one-line insertions (Lane A is editing those files — §10).
- **Full screen (W5):**
  - A `⤢` button on the panel opens `WaveFullscreen`: the same rows, filling the screen on a black
    ground, with the strip's numbers beside them as the prototype laid them out.
  - Esc or `×` closes it. The stamp stays visible at full size.
- `live/boundaries.test.js`: wave modules may not reach alarm, lock-screen or board-store code.
- Words in all dashboard languages (new `i18n/strings/waves.js`).

## 4. Drawing

- **Time base.** The panel draws device time `head − delay`. `head` is the newest block's end plus
  the time elapsed since it arrived; `delay` is **2.0 s** (absorbs worker batching ≈0.35 s,
  hub→API→browser and the 750 ms poll). The visible window is **6 s**, scrolling right to left.
  The panel says "≈ 2 sn gecikmeli".
- **Gaps.** A missing block or a `null` block breaks the path. Nothing is interpolated or
  extrapolated, ever.
- **ECG.**
  - Fixed gain, no autoscale: the row spans ±1200 counts.
  - Samples beyond the row are clipped, with a clip mark.
  - Autoscale would amplify noise into something that looks like a rhythm.
  - No mV grid or calibration bar (the gain is not known).
  - ECG rows are chosen by **liveness** (a channel whose blocks carry samples), in the order
    `0x0102`, `0x0103`, `0x0104`, `0x0122`, `0x0124`, at most two rows.
  - Every ECG row is labelled `EKG` with the note `derivasyon adı doğrulanmadı`; no lead name is
    ever printed (the id→lead mapping is unverified and the live id differs by bed).
- **Pressure (ART / P1).** Fixed axis 0–200 mmHg (extends to 250 if exceeded), faint lines at
  50/100/150. Label from the catalogue by id (`ART` = `0x0301`, `P1` = `0x0e01`). Both rows when
  both are live, after the ECG rows and before pleth.
- **Pleth, resp.** Slow autoscale over the last 10 s with a minimum span. Labelled `göreli`.

## 5. Safety rules (the price of W2)

1. **Always visible:** "Dalga · doğrulanmamış · yalnız görüntü — birincil alarm başucu monitörüdür".
2. **No signal is never a flat line.** A `null` block draws nothing and shows "sinyal yok".
   A flat ECG line reads as asystole.
3. **Stalls are loud.**
   - If the render head reaches the end of the data, the trace freezes, greys out and shows
     "akış durdu · N sn" after 1.5 s.
   - After 10 s without data the trace is cleared and the row says so.
   - Stale waves are never shown as current.
4. **No numbers from waves.** No alarm, score, notification, measurement, caliper or derived
   rate is computed or shown from the samples. The numbers stay the strip's.
5. **Patient binding only through the existing explicit link** (the strip's `link === "one"`).
   No waveform on a patient when the binding is ambiguous or absent.
6. **No storage.** Hub ring 20 s in memory, API cache 250 ms, browser 20 s. Nothing reaches the DB,
   the audit, logs, exports or screenshots made by the app. (The hub journal keeps encrypted raw
   payloads exactly as it does today; this design adds no reader for it.)
7. **Feature flag off by default.** `INFINITY_WAVES=on` is an explicit deploy step.
8. **No sound on any wave screen.** No pulse beep, no alarm tone, no audio of any kind. The
   prototype's `H.sound` does not come back. A beep from a decoded R-wave would be a number derived
   from the waves (rule 4) and turns the screen into an audible monitor imitation.
9. **The wall says what it is not.** The wall page (§11) carries the stamp in its header:
   "Duvar monitörü · doğrulanmamış — merkezi istasyonun yerine geçmez".
   - Every tile shows its own age.
   - No tile colour or border is driven by waves.
   - Its numbers are the strip's, with the strip's age and evidence words.

## 6. Out of scope

- The worker joining `224.127.2.255:2150` (bed label) or `:2000` (alarm texts). These are findings
  for Lane A (Aşama B device→bed table) and Aşama C, recorded in the protocol doc.
- Relabelling numeric ids `0x0101` / `0x1905` (HR vs PLS suspicion): a separate verification (§9 V4).
- Recording, printing, export, full disclosure, calipers, ECG gain calibration.
- The prototype's pulse beep and alarm tones (§5.8).
- The mobile app.
- More than one ECG lead beyond §4.

## 7. Tests (synthetic only — no capture bytes, no patient values in the repo)

- **Decoder.** A synthetic packet builder (header + blocks + optional record section) covers:
  - all four rates;
  - the "no signal" block;
  - a lone `1` inside a live block;
  - truncation;
  - a wrong `len`;
  - a record section after the blocks;
  - garbage;
  - an over-long `n`.
- **WaveBuffer.**
  - Ordering, de-duplication, the 20 s window and the 3 s freshness refusal (replay).
  - The cursor and the 10 s cap.
- **Hub route.** Auth (viewer only, collector refused), 409 when research is off, 404 for an
  unknown device, schema.
- **API route.**
  - Each gate (permission, hospital, scope → 404, flag off).
  - Cache and single-flight.
  - Hub timeout or 404 → a status, not a 500.
  - The allow-list and the size cap.
- **Dashboard.**
  - Geometry: time window, path breaks at gaps, ECG clipping, ART axis.
  - Store: polling only while visible, cursor, status mapping.
  - Panel:
    - the stamp is always present;
    - "sinyal yok" for `null`;
    - "akış durdu" on a stall;
    - no panel on a patient without `link === "one"`.
  - Boundary test and i18n completeness.

## 8. Acceptance

- Gates: engine and dashboard suites green; build green.
- Local replay: a fake hub fed from a **synthetic** packet stream draws all four rows.
- On the VM, with the flag on:
  - a bed's panel scrolls smoothly for 10 minutes;
  - hub CPU stays within the existing ceiling (README ≈43 % at 13 beds), measured before and
    after;
  - API latency for `/infinity-waves` p95 < 150 ms;
  - stopping the worker shows "akış durdu" within ~3 s and clears within 10 s.
- The ward check in §9 is recorded; until V1 passes, the evidence wording stays "yapısal".

## 9. Ward screen validation (the owner films; §1 W4)

Passive only: nobody touches the patient, the cables, the monitor settings or alarms.

1. Pick a bed with an arterial line, a bed with an irregular rhythm if there is one, and a bed with
   a 5-lead ECG if possible.
2. At the central station open that bed's full view (no setting changed).
3. The owner says "BEDxx başlıyor" in the session. Claude starts a 120 s passive capture on the
   worker and confirms it.
4. Film the whole screen for ≥ 90 s with the phone **fixed** (stand or leaning), the clock in frame
   if the screen shows one. If HR and PLS differ on screen, note it. If the central can print a
   "Record" strip, print one and photograph it.
5. Copy the video to `C:\Users\User\Desktop\Homunculus-Captures\`.

Checks (results go to the protocol doc, never values):

- **V1.** On-screen QRS times align uniquely with the live ECG channel's decoded R-peaks
  (sweep-head method), residual sd ≤ 20 ms. **Open (2026-10-27):** the BED08 video arrived
  WhatsApp-compressed (464×656; the trace is 3–6 px tall), so QRS cannot be separated; needs the
  phone's original file.
- **V2.** The pressure trace's beat max/min ÷40 and the screen's systolic/diastolic agree.
  **Done (BED08, P1 `0x0e01`): within 2 mmHg; P1 mean/diastolic records match the screen.**
- **V3.** The ids of the other ECG leads on a 5-lead bed. Open (BED08 showed one trace, `0x0102`).
- **V4.** Where the screen shows HR ≠ PLS, which numeric id carries which. **Done: `0x0101` =
  screen HR, `0x1905` = screen PLS — the reverse of the reader's labels (protocol doc).**
- **V5.** The pleth and resp rows match the screen's. **Done at the number level (resp and SpO₂
  series match through 40 s); the pleth row shape is pending V1's original video.**

## 10. Lanes, branches, deploy

- Lane C works on `feat/infinity-dalga`.
- Lane A (Aşama B, `feat/infinity-asama-b`) does not touch `edge/` or the hub.
- The hot spots shared with Lane A are:
  - `app.py` — one registration line, placed away from the shadow routes;
  - `PatientScreen.jsx`, `DevicesScreen.jsx` — one line each;
  - `MonitorStrip.jsx`, `shadowStore.js` — not touched.
- The two screen insertions land **after** Aşama B is on main (rebase), so there is no conflict.
- Lane A reviews the hub/edge and `app.py` hunks.
- Deploy (the owner pastes the blocks; one VM deploy at a time, after B1a/Aşama B):
  1. Hub R5 (new release dir + drop-in).
  2. API + web images.
  3. `INFINITY_WAVES=on`.
- Either order is safe: the API answers "dalga akışı yok" while the hub lacks the route.
- Rollback: the flag off, or the previous drop-in / image tags.

## 11. Phase 2 — the wall monitor (W6)

The prototype's "Duvar monitörü" (`tasarim-taslaklari/app/monitor.js`, part 3) was never carried into
the live system (G2 left it out). Phase 2 builds it on phase 1's pieces, after phase 1 is accepted.

- **Screen.**
  - New live screen `live/screens/wall/WallScreen.jsx` with a nav entry for `board.view`, scope as
    the board.
  - One tile per bed that has a monitor on the strip board.
  - Each tile shows the bed label, the patient's bed-level identity as the board shows it, the
    strip's numbers with their age, and the live ECG row plus pleth (ART when present).
  - A tile opens the patient (or the full-screen view of W5).
- **Data.**
  - One poll for the whole wall: `GET /infinity-waves?since=` every 750 ms.
  - The strip numbers come from the existing `shadowStore`.
- **Drawing budget.**
  - One `requestAnimationFrame` loop for all tiles, capped at 30 fps on the wall.
  - Tiles off screen are not drawn.
- **Safety:** §5 in full, with §5.8 (silence) and §5.9 (the wall's header) binding.
- **Acceptance (adds to §8).**
  - With 13 beds on the VM, browser CPU on the ward PC stays reasonable (measured, recorded).
  - API p95 < 150 ms at one poll per wall.
  - Hub CPU within the ceiling.
  - A stalled bed shows "akış durdu" on its own tile only.

## 12. Docs that change with this slice

`INFINITY-PARAMETER-RECORDS.md:171-173, 214-216` (and its "yatak adı yayında yok" line) ·
`INFINITY-BED09-DECODER.md:24` · `INFINITY-CONTINUOUS-RESEARCH.md:27` · `INFINITY-RESEARCH-REPLAY.md:6` ·
`INFINITY-100-DEVICE-ARCHITECTURE.md:102-104` (requirements, answered by the protocol doc) ·
G2 spec D5 (`2026-10-19-g2-vital-egrileri-design.md:37, 269`) · Aşama A plan principle (`:168`) ·
`homunculus-rehber-TR.md:967-968, 1059, 1173-1184` · code comments `edge/infinity_live.py:9`,
`edge/infinity_research.py:264`, `dashboard/src/live/i18n/strings/patient.js:3`.
