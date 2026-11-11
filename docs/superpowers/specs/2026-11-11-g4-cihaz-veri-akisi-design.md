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
- `last_packet_at`: the report's time minus its `packet_age_ms`; a report with no packet age leaves it unchanged
  (plan N5: the hub sends no age only when it has never had a packet from that monitor);
- `last_report_at`.

**Per device and channel:** `last_value_at`, the last time the channel carried a valid value (`state: value`).

**Bounds:**
- A device that the hub has stopped reporting stays in the ledger for 24 h after its last report, then is dropped.
- At most `MAX_DEVICES` devices, the existing bound.
- Only the channels the board already knows.
- `watching_since` is when the store started. A restart empties the ledger, and the page says so.

**Amendment (2026-11-11, code review): eviction.** The ledger holds only devices the store holds. When the hub starts
reporting more than `MAX_DEVICES` sources, the least recently reported devices are dropped first, from the store and the
ledger alike, the vanished ones included.

**Amendment (2026-11-11, code review): channel times.** A channel's `last_value_at` is the time of the last valid
reading the store took. That includes a reading the collector's clock put up to `ARRIVAL_MAX_AHEAD_S` (2 s) ahead,
which the strip withholds until the API's clock reaches it. For NBP it is the time the hub saw the value change, an
upper bound of the cuff measurement. An untimed NBP (NBP-2) has only its packet's time. After the wall clock steps
back, a channel time or `last_packet_at` more than `ARRIVAL_MAX_AHEAD_S` ahead is dropped and reads as unknown, as the
store forgets such readings.

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
- A device is **silent** when its status is `silent`, i.e. the hub has had no packet from it for 3 s or more. The hub's
  live view marks a device `stale` once `packet_age >= STALE_AFTER_MS` (3000 ms, `edge/infinity_live.py`
  `LiveResearchView.snapshot`); the forwarder sends that word unchanged (`edge/infinity_shadow.py` `thin`), and the store
  shows it as `silent` (`SHOWN_STATUS`). *Corrected 2026-11-11 (review): this line first said «no packet for over 5 s»,
  which is the hub's own `/v1/status` page (`age > 5`, `edge/infinity_hub.py`); the shadow lane does not read it.*
- A device is **unknown** when the hub has not reported it for 15 s (`SILENT_AFTER_S`).

A channel is **stale** when its `last_value_at` is more than `DISPLAY_MAX_AGE_S` (15 s) old while its device still sends.
The page lists a stale channel after **60 s** (constant `STALE_LIST_AFTER_S`, on the server). Every momentary gap is
already shown on the strip.

**NBP is never stale.** It is intermittent, measured when the cuff runs. The page shows its last time only.

**Standby counts as neither.** A device in `standby` (no parameters: the monitor is on but measures nothing) is not silent
and has no stale channels. The page counts it separately.

**Amendment (2026-11-11, plan review): an hour, then one count line.** A channel is listed only while its silence lasts
from `STALE_LIST_AFTER_S` (60 s) up to `STALE_LIST_UNTIL_S` (3600 s, a new server constant beside it, sent on the board
as `stale_list_until_s`): 60 s and 3599 s are listed, 59 s and 3600 s are not. Past an hour it drops out of the list — a
channel silent that long has more likely been removed on purpose (an arterial line taken out) than lost. It is not
deleted from the ledger or from `channels_seen`. Instead the section ends with one count line, printed only when the
count is above zero: «{n} kanal 1 saatten uzun süredir değer göndermiyor (çıkarılmış olabilir)».

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

## 5. Review amendments (2026-11-11)

The code review of both lanes, folded into the code before the gates. D2's two amendments («eviction», «channel times»)
come from the same review; they are referred to here, not repeated.

**Engine.**
- **GET containment.** The ledger is display memory: a failure in it may cost the board only its G4-01 fields.
  `GET /infinity-shadow/board` reads `FeedLedger.view()` inside a guard, and `board_view` builds every shown card's
  ledger fields before it lays any on, so no card is half-worded. A failure is logged, and the nurses' strip, the device
  page and `/infinity-waves` get the board as it was before G4-01. The page reads such an answer as one without a
  ledger («Unknown, never empty» below).
- **The clock-step drop** (D2, «channel times»). After the wall clock steps back (an NTP step, a VM restore), a channel
  time or `last_packet_at` more than `ARRIVAL_MAX_AHEAD_S` (2 s) ahead is dropped, in `observe` and in `view`, and reads
  as unknown. Kept, the newest-wins rule would freeze a live channel and hide a stopped one until the clock caught up.
  `first_seen_at` and `last_report_at` keep what the clock said then.
- **The collector's lead, counted via `valid_at`.** The ledger no longer reads the board's entries (D2's «`state:
  value`»). The store hands it, per channel, when the reading it holds carried a valid value (`DeviceView.valid_at`,
  built by `ShadowStore._valid_at`; `board_view` never copies it and the shadow engine never reads it). A valid reading
  counts as soon as the store takes it, so one the collector's clock put up to 2 s ahead, which the strip withholds as
  `old` that long, never freezes a live channel.
- **NBP at the cuff time.** NBP is one channel, seen on `_nbp_view`'s own condition (three valid parts with one change
  time) at that change time: when the hub saw the value change, an upper bound of the cuff's measurement. An untimed
  NBP (NBP-2) has its packet's time. NBP stays out of the page's lists (D4).
- **One `devices()` per POST.** An accepted shadow body builds the store's devices once, at one `now`, for the ledger
  and Aşama B's sampling pass alike: same instant, same picture. If they cannot be built, the failure is logged, the
  ledger misses that body, and the pass builds its own inside its guard as before.

**Dashboard.**
- **A board that is not fresh is frozen at its last answer.** «Not fresh» is Decision 18's: the last poll failed, or the
  answer it holds is older than the display limit (15 s). Every section is then measured at that answer's own
  `generated_at` (`deviceFeed.js` `measuredAtMs`), not at the browser's now: a stall of 5 or 70 min, a failed poll, or a
  hidden tab shown again before its poll lands lists no stale channel, count or minute the answer did not carry. The
  chain's ages stay as the answer gave them. A fresh answer still ticks between polls (D5, «Durations»).
- **Not fresh leads with the stale line, in the past tense.** Section 1 opens with «Pano güncel değil · son yanıt
  {HH:MM}» and gives the last verdict in the past tense («Son yanıtta veri akıyordu · {streaming}/{total} monitör veri
  gönderiyordu»; every verdict has its past twin, in four languages). The chain's links keep their last values with the
  state word «bilinmiyor»: a link that was up then is not known to be up now. Sections 2–4 keep the mark «Pano güncel
  değil · {HH:MM}». A board that is not fresh never reads as today's «all fine».
- **New verdicts.** «Veri akıyor · {streaming}/{total} monitör veri gönderiyor» only while at least one monitor sends.
  Otherwise a working chain says:
  - none sending: «Zincir çalışıyor, ama hiçbir monitör veri göndermiyor» (sections 2 and 3 list; the counts follow);
  - no monitor in the answer (`total` 0: the hub reports none, or a scoped caller has none on its beds; the board has
    no hub-wide count to tell them apart): «Bu görünümde monitör yok»;
  - counts the answer does not carry, or not as whole numbers (`chipCounts` null): «Zincir çalışıyor; monitör sayıları
    okunamıyor». A count it was not told is no count, never a zero.

  Counts follow only «Veri akıyor» and the none-sending verdict. A feed state this build does not know stays «Veri
  akışının durumu okunamıyor».
- **Unknown, never empty.** When sections 2 and 3 cannot list, they say why and never «yok» (`listingOf`):
  - a broken chain: «Veri zinciri kesik: monitörler tek tek listelenmiyor» (as in D5);
  - an unknown feed state or unread counts: «Veri akışının durumu bilinmiyor: monitörler tek tek değerlendirilemiyor»;
  - no monitors: «Bu görünümde monitör olmadığı için değerlendirilemiyor»;
  - an answer without the ledger (an API before G4-01, or the GET containment above): «Bu sürüm «ne zamandan beri»
    bilgisini vermiyor». Section 2 still lists the silent and unknown cards by their status, without a time; section 3
    lists nothing;
  - an answer without `generated_at`: «Yanıtın zamanı yok: süreler hesaplanamıyor».

  Only a fresh answer whose monitors are listed one by one may say «Sessiz monitör yok» or «Eskiyen kanal yok».
- **A live region.** A visually hidden polite status (`role="status"`) holds the verdict with no minute and no count
  (the forwarder's silence without its minutes, «Veri akıyor» without its counts) and, for a board that is not fresh,
  «Pano güncel değil» before it. It is mounted empty and filled a moment later (`useAnnounced`), so a screen reader
  hears it when the state changes, not every minute.
- **A session with `devices.map_beds` only.** It reaches the page and the editor (the route takes either key) but may
  not read the strip (`board.view` or `devices.manage`: `shadowStore.mayReadShadow`). Sections 1–4 are replaced by one
  note, «Veri akışı bölümleri cihaz yönetimi ya da pano görüntüleme yetkisi ister»; section 5 is shown.
- **Section 5's states.** It is the editor's list, not the strip's, so it answers whatever the strip does: off, not yet
  read, unreadable, or not this session's hospital. It says «Eşleme listesi yükleniyor…» while the list loads; «Tabloda
  olup hiç görülmeyen monitör yok» only from a list that answered; and a list that fails, a lane that is off (409
  `monitor_lane_off`) included, keeps its last rows with «Eşleme listesi okunamadı; birazdan yeniden denenecek.». With
  the strip off or never read, sections 1–4 are not drawn.
- **Wording rules.**
  - No Turkish or Azerbaijani suffix is glued to a time, since it would have to follow the time's last syllable
    («10:42'den», «10:40'tan»). The watching line becomes «İzleme başlangıcı {HH:MM} · sistem yeniden başlayınca
    sıfırlanır», replacing D5's «İzleme {HH:MM}'den beri; …».
  - English counts follow their label («Stale channels: {n}»), as the Russian ones do.
  - The refused-values line never prints a raw placeholder: a reason the answer lacks reads 0, and the reasons this
    build does not know are summed as «diğer {n}», so a «dikkat» always has its reason in the text.
  - The Russian rail's short word, on a phone, is «Устр.»; the full label stays «Устройства» (D5, «Names»).
  - AZ, RU and EN still await a native speaker's reading before the pilot.
