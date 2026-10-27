# Infinity · NBP-2 — the last cuff value shown while its time is unknown — design

**Date:** 2026-10-28 · **Lane:** A · **Branch:** `feat/infinity-nbp2`, off `main` `12453ee` (Aşama B live on the VM
at the stage `rules`). **Owner decision (2026-10-28, via Lane B, verbatim):** «son degeri gostersin» — when the
cuff's measurement time is unknown, the strip shows the last NBP value anyway, marked "zamanı bilinmiyor".
Amends the NBP slice (`2026-10-22-infinity-nbp-degisim-saati-design.md`): the timed behaviour stays; a new state
is added before it. Code references read at `12453ee`.

## 1. The problem

The monitor repeats its last NBP in every packet and its own clock is not decoded, so the hub can only time an
NBP by seeing the triple change (X38, X46). After a hub start, an outage, or a gap between complete valid triples,
no change has been seen, the forwarder sends no NBP, and the strip says «— ölçüm bekleniyor» — for hours, on a
bed whose monitor plainly shows a value. On 28.10 the ward saw this on a real patient's bed. The owner wants the
value shown, with its time honestly unknown.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **The hub sends an untimed NBP:** when a device's three NBP components are present, valid and fresh (a complete valid triple as the monitor repeats it now) but no change has been seen, `thin()` sends the three readings with `changed_at: null`. A partial packet's lone newer component (X38) and anything `***` are still not sent. Once a change is seen, `changed_at` is set and the readings travel as today. | The strip can only show what the hub sends; the guard "complete valid triple only" keeps a half-updated cuff off the screen. |
| D2 | **The API accepts `changed_at: null`** on an NBP reading of schema v2 (a number as today, or null); `_judge` no longer counts it as `unknown_parameter`; `_Held.changed_at` stays `None`. | A whole body is refused on one bad reading; null must be legal before the hub sends it. |
| D3 | **A new board state `value_untimed`** from `_nbp_view`: when the three held readings are complete, valid, fresh by packet age and ALL carry `changed_at = None`: `systolic/diastolic/mean` set, `age_s`/`last_at` = the packet's, `changed_at`/`measured_age_s` = null. The 2-hour rule needs a time and does not apply; the packet-age rule (`DISPLAY_MAX_AGE_S`) and the forget rule apply as to every parameter, so a device that stops sending NBP or a stale stream hides it. A mixed triple (some timed, some not) is incomplete: «ölçüm bekleniyor» as today. | The value is the monitor's current display; its age on our side is honest (the packet's); its measurement age is unknown and is said so. |
| D4 | **The strip draws it apart from a timed reading:** «S/D (M) mmHg · ölçüm zamanı bilinmiyor» — the numbers in plain `ink` as every strip value, the note in the attention tone (`text-att-ink`) rather than `mute`, no «≤» and no age of measurement; screen-reader text says the measurement time is unknown. The moment a change is seen the cell becomes the timed form «ölçüm ≤ HH:MM (N dk)». The Settings legend and the guide say what the new form means. | Decision 14 of Aşama A: amber/attention is this interface's "cannot vouch". |
| D5 | **Never an engine input.** The rules lane (`api/infinity_rules.py` `pick`) feeds NBP only with a `changed_at` (it already skips a cell without one); a `value_untimed` cell feeds nothing. The equivalence and isolation gates stay as they are. | The owner's decision is about the strip; the shadow engine judges staleness by the measurement time, which an untimed value lacks. |
| D6 | **Deploy order: API + web first, then the hub's release R5** (drop-in `95-nbp2.conf`, the same shape as `94-nbp.conf`). An R4 hub against the new API behaves as today; an R5 hub against the old API would get its bodies refused (400) — so never the hub first. Rollback: delete the drop-in → R4 (the strip returns to «ölçüm bekleniyor» for untimed cuffs); the API/web rollback is the usual image tags. No migration. | The schema is unchanged (v2); only null becomes legal. |
| D7 | `shadow_check.py`'s `nbp:` line counts the untimed devices too («N cihazda zamanı bilinmeyen değer»). | The acceptance check must name the new state. |

## 3. Components

- `homunculus-engine/src/homunculus/edge/infinity_shadow.py` — `thin()`: an NBP entry with `changed_at` None travels
  with `"changed_at": None` when all three NBP entries of the device are `candidate` and fresh and their values are
  the held triple's (the live view exposes it: `_nbp_changed_at` returns None for a lone newer component, so the
  check is "all three present, candidate, fresh, and the device's `nbp_triple` matches their values" — expose
  `nbp_triple` in the snapshot's device dict, `None` when none held).
- `homunculus-engine/src/homunculus/edge/infinity_live.py` — the snapshot adds `"nbp_triple"` per device (the
  tuple or None). No other change.
- `homunculus-engine/src/homunculus/api/infinity_shadow.py` — `_validate` (null allowed), `_judge` (a v2 NBP
  reading without `changed_at` key is still `unknown_parameter`; with the key present and null it is held),
  `_nbp_view` (the `value_untimed` state), the `feed`/board docs; `deploy/infinity/shadow_check.py` `nbp_line`.
- `dashboard/src/live/screens/common/monitor.js` — `nbpCellOf` → `{kind: "nbp_untimed", systolic, diastolic,
  mean, ageS}`; `MonitorStrip.jsx` `NbpValue` draws it; `i18n/strings/monitor.js` `nbpUntimed`, `nbpUntimedSaid`,
  the legend sentence (four languages); `SettingsScreen` legend; tests.
- Docs: `deploy/infinity/README.md` (R5, `95-nbp2.conf`, the order), `docs/homunculus-rehber-TR.md` (the strip's
  NBP sentence), the roadmap row. The hub release R5 built by `deploy/infinity/build_transport_release.py` at the
  branch's final head; the deploy blocks (API/web D-blocks + hub H-block) in `/c/tmp/infinity-a-releases`.

## 4. Tests

- Hub: `thin()` sends an untimed complete valid triple with `changed_at: None`; not with one component `***`,
  stale or missing; not a lone newer component (X38); a timed triple unchanged; fuzz as the NBP slice did.
- API: `_validate` accepts null and refuses a non-number; `_judge` holds it; `_nbp_view` gives `value_untimed`
  with the packet's age, hides it by packet age, `old` after `FORGET_AFTER_S`; a mixed triple → waiting; the first
  timed reading switches to `value`; `board_view` passes it; `shadow_check` counts it; `pick` never feeds it.
- Dashboard: the cell kind, the strip's words in four languages, the screen-reader text, the switch to the timed
  form on the next poll, the legend; `strings.test.js` parity.
- Gates: engine no-DB, the 3.12 + 3.14 edge lane (`/c/tmp/g115-py314/Scripts/python.exe`), dashboard, `vite build`,
  the release builder.

## 5. Out of scope

Decoding the monitor's clock; feeding an untimed NBP to any rule; the 2-hour rule for untimed values (there is no
time to apply it to); any change to the worker.

## 6. Open items

- **O1** The continuity window `NBP_CONTINUITY_S = 3.0` (O30 of the NBP slice) still decides when a change counts
  as timed; the ward walk may widen it.
- **O2** A monitor that keeps showing a reading taken before the patient was admitted shows it untimed on the new
  patient's bed until the next cuff — the strip's bed-level rule (the previous patient's NBP may show for up to 2 h)
  gets a longer tail for untimed values; the «zamanı bilinmiyor» note is the warning.
