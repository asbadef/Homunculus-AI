# G4-01 — «Cihaz & Veri Akışı»: is data arriving?

**Date:** 2026-11-11 · **Lane:** B (session homunculus-ai-3b), assigned by Lane A · **Branch:** `feat/g4-cihaz-akis`,
cut from `83b0fdbb` (G2-B5b «Ertele», on top of the G2 debts) · **Guide section:** §3.22

**Origin.** The design-integration roadmap (`docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`)
lists two rows under «Main'den gelen». Each one is a behaviour that a test deleted at the G1-02 merge used to protect:
- line 655: biomedical and the hospital admin reach the page; physicians and nurses do not;
- line 656: «Cihaz sayfası önce "veri geliyor mu" sorusunu yanıtlar (sessiz yatak, bayat kanal, veri akışı), sonra cihaz
  envanterini gösterir».

Line 618 («InfinityBeds + cihaz sağlığı (`feedHealth`)») points at the same question.

## 1. What exists

The live «Monitörler» screen (`/devices`, `devices.manage` or `devices.map_beds`) shows:
- every monitor the hub forwards, with its values and their ages;
- its bed, from the approved device→bed table;
- the mapping editor;
- the feed counters.

Its feed chip reads «{streaming}/{total} veri gönderiyor · {n} susuyor». No patient is shown.

The data comes from `GET /infinity-shadow/board`, polled every 5 s. The board holds:
- per device: `status`, `status_age_s`, `packet_age_ms`, and per channel `{state value|invalid|old, age_s, last_at}`;
- `feed`, with these fields:
  - `state` (never | forwarder_silent | collector_disconnected | ok);
  - `last_post_age_s`;
  - `collector_age_s` and `collector_connected`;
  - the forwarder's `sent`/`failed`;
  - the `rejected` counters;
  - `lag_ms`.

`GET /infinity-shadow/device-beds` lists the table's rows, including rows whose monitor was never seen (`status: null`).

The screen cannot answer three questions:
- **Since when?** A channel that has sent nothing valid for 120 s is deleted (`FORGET_AFTER_S`), so it disappears instead of
  reading as stale, and «since when» is lost. A device's silence has no start either; there is only the current age.
- **Which beds first?** Silent monitors are not gathered or ordered. You find them by scanning the cards.
- **Is the chain whole?** The collector and forwarder state are a chip and two counter lines below the title, not an
  answer.

The HL7/NCE file feed has been stopped on purpose since 2026-09-04. On the VM, monitor data reaches the system through
the shadow lane, which is what this page reads.

## 2. Owner's decision (2026-11-11)

**D1 — «veri geliyor mu» first** (the recommended option). The page answers "is data arriving?" before anything else:
- silent monitors, with how long they have been silent;
- stale channels, with since when;
- the state of the data chain;
- table rows whose monitor has never been seen.

The existing strip and the mapping editor follow below. Device inventory and maintenance (type, serial number,
maintenance, calibration, faults) and the alarm-quality panel are later slices. No patient data, no migration, no change
to the hub.

## 3. Decisions taken in the spec

### D2 — the server remembers when it last saw each device and channel

`ShadowStore` (`api/infinity_shadow.py`) gains a small ledger, memory only, beside the readings it already keeps. The
readings, their 120-s forgetting, and everything the shadow engine reads stay exactly as they are.

**Per device (`source`):**
- `first_seen_at`;
- `last_packet_at`: the report's time minus its `packet_age_ms`, or the report's time when the age is absent;
- `last_report_at`.

**Per device and channel:** `last_value_at`, the last time the channel carried a valid value (`state: value`).

**Bounds:**
- A device that the hub has stopped reporting stays in the ledger for 24 h after its last report, then is dropped.
- At most `MAX_DEVICES` devices, the existing bound.
- Only the channels the board already knows.
- `watching_since` is when the store started. A restart empties the ledger, and the page says so.

### D3 — the board carries it, additively

`GET /infinity-shadow/board` keeps every field it has and adds:

| Where | Field | Meaning |
|---|---|---|
| top level | `watching_since` | ISO time the ledger started (the API's start) |
| each device card | `last_packet_at` | ISO or null |
| each device card | `silent_for_s` | whole seconds since `last_packet_at`, when the device is `silent` or `unknown`; otherwise null |
| each device card | `channels_seen` | `[{parameter, last_value_at}]`: every channel that carried a valid value since `watching_since`, the forgotten ones included |
| top level | `vanished` | `[{source, bed_label, last_packet_at, last_report_at}]`: devices in the ledger that the hub no longer reports, within the 24 h |

Scope applies as it does to cards:
- a `devices.manage` caller sees all of them;
- a scoped `board.view` caller sees only devices whose bed its scope reaches;
- `vanished` follows the same rule, through the approved table's bed.

None of these fields names a patient.

### D4 — what counts as silent and stale

The server's existing words are kept:
- A device is **silent** when its status is `silent`, i.e. the hub says no packet for over 5 s.
- A device is **unknown** when the hub has not reported it for 15 s (`SILENT_AFTER_S`).

A channel is **stale** when its `last_value_at` is more than `DISPLAY_MAX_AGE_S` (15 s) old while its device still sends.
The page lists a stale channel after **60 s** (constant `STALE_LIST_AFTER_S`, on the server). Every momentary gap is
already shown on the strip.

**NBP is never stale.** It is intermittent, measured when the cuff runs. The page shows its last time only.

**Standby counts as neither.** A device in `standby` (no parameters: the monitor is on but measures nothing) is not silent
and has no stale channels. The page counts it separately.

### D5 — the page `/devices` «Cihaz & Veri Akışı»

**Route.** It keeps its id, path, icon and permissions. Line 655's access rule is already met: biomedical
(`devices.manage`) has the page as home, and the hospital admin holds every right. The charge nurse keeps reaching it
through `devices.map_beds`, as decided for the mapping editor. The guide's §3 sentences that say a biomedical account
cannot enter («Cihaz sayfası Grup 4'te gelecek») are corrected.

**Names.**
- The heading becomes «Cihaz & Veri Akışı».
- The nav label becomes «Cihazlar» (az «Cihazlar», ru «Устройства», en «Devices»), because the rail needs a short word.

**Order, top to bottom:**

1. **«Veri geliyor mu?»** One verdict line, then counts.
   - The chain comes first: when `feed.state` is not `ok`, the verdict is the chain's. Examples: «Veri gelmiyor:
     aktarıcı 4 dk'dır sessiz» (`forwarder_silent`), «Veri gelmiyor: toplayıcı bağlı değil» (`collector_disconnected`),
     «Henüz hiç veri gelmedi» (`never`). Every monitor is then silent for the same reason, and the page says so instead of
     listing them as faults.
   - Otherwise: «Veri akıyor · {streaming}/{total} monitör veri gönderiyor», followed by the counts: silent, stale
     channel, standby, waiting, unassigned.
   - Below the verdict: «İzleme {HH:MM}'den beri; sistem yeniden başlayınca sıfırlanır».
2. **«Sessiz monitörler».**
   - Silent, unknown and vanished devices, the longest silence first.
   - Each row shows the bed label, or the device address when unassigned, then «{n} dk'dır veri yok · son veri {HH:MM}».
   - A vanished device says «hub artık bildirmiyor».
   - With none, the section says «Sessiz monitör yok» — only while the board is fresh (Decision 18: only a LIVE answer may
     say empty).
3. **«Eskiyen kanallar».**
   - Per device, the channels listed by D4, each «{kanal} · {n} dk'dır değer yok», oldest first.
   - With none, «Eskiyen kanal yok», on the same rule.
4. **«Veri zinciri».** Collector (connected, last heartbeat age), forwarder (last post age, sent/failed), the hub's
   accepted and old/duplicate packets, and the rejected counters by reason. Each line has its state word.
5. **«Tabloda var, hiç görülmedi».** Rows of the approved table whose monitor the hub has never reported, from
   `/infinity-shadow/device-beds` (`status: null`), with bed label and device address.
6. **Then, unchanged:** the mapping editor (when the user may see it) and the strip cards, which are the inventory of
   what the hub sees.

**Durations.** The client computes them from the server's ISO times and the board's skew-corrected clock, so they tick
between polls. A minute is the unit; under a minute shows «<1 dk». When the board is not fresh, the sections keep their
last answer, marked «Pano güncel değil · {HH:MM}», and say nothing is empty.

### D6 — not in this slice

- Device inventory, maintenance, calibration, fault records, battery (the prototype's tabs).
- The alarm-quality panel.
- Silence history across restarts, and any table or migration.
- Notifications or a rail badge for a silent monitor, and the clinical-board freshness (`feedHealth`) for biomedical.
- Hub or collector changes: queue depth and per-device packet counters stay on the hub's own page.
- The tenant binding of `/infinity-research/state`.

## 4. Tests

**Engine** (`tests/test_infinity_shadow_ledger.py`, plus the existing shadow tests):
- `last_packet_at` and `last_report_at` follow reports, with `packet_age_ms` subtracted.
- `last_value_at` survives the 120-s forgetting.
- A vanished device is listed for 24 h, then dropped.
- `MAX_DEVICES` bounds the ledger.
- `silent_for_s` is set only for silent and unknown devices.
- `channels_seen` includes forgotten channels.
- Scope: a scoped viewer gets only its beds' devices and vanished rows; `devices.manage` gets all, with no patient field.
- Readings and the shadow engine's input are unchanged: the existing shadow tests stay green.
- The route tables are unchanged (no new route).

**Dashboard:**
- the pure `deviceFeed.js` with a fixed clock:
  - the verdict per `feed.state`;
  - silent ordering;
  - stale at 60 s;
  - NBP and standby excluded;
  - vanished;
  - never-seen rows;
- `DevicesScreen` with each section, and Decision 18's empty rule;
- the nav label and heading;
- `rawKeys`, `strings`, `routes.test.js` (label key unchanged).

**Gates:** the engine's no-DB suite, the whole dashboard suite, `vite build`.
