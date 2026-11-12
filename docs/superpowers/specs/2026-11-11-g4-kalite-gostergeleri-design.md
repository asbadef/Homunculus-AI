# G4-03 — «Kalite göstergeleri»: care-process quality per unit, from what the system really records

**Date:** 2026-11-11 · **Lane:** B (session homunculus-ai-c4) · **Branch:** `feat/g4-kalite`, cut from main `b360369b`
· **Guide section:** §3.25 · **Migration:** one, `0020` (see D7 for its parent)

**Origin.** The design prototype's «Kalite göstergeleri» screen (`origin/tasarim/prototip`,
`tasarim-taslaklari/app/screens.js` 2836–2860, perm `quality`, roles «yönetici» and «kalite») shows cards, a «Güvenlik
olayları» box, a units table and «İncelenecek olaylar» — all seeded example numbers. The rule
(`docs/tasarim-prototipi-canli-sistem-notu.md`): «ekran sayabilir ama uyduramaz». G4-02's spec D6 deferred
per-unit alarm quality and this screen to this slice; the roadmap lists «kalite» in Group 4.

## 1. What the system really has (exploration, 2026-11-11)

| Need | Source | Per unit? |
|---|---|---|
| Alarm episodes | `api/alarm_quality.py` `build_episodes` over the audit trail's `first_seen`, `alert`, `ack`, `escalation`, `alert_cleared` rows; key = (patient key, alert kind); `answered_at`, `escalated`, `resolved_at` | Not by itself: no row carries a bed or a unit |
| Patient key → unit | the board key is the **protocol number** (admissions since 0015) or the legacy **H-number** (`admission/boardkey.py`); `admissions.admitting_unit_id` is always the bed's unit (`router.py` refuses a mismatch); an admission's bed never changes; transfers are closed (A-37) | Yes, for patients admitted in this system; the key→unit map is time-invariant while transfers stay closed |
| HIS-fed and monitor-only patients | `patient_identity` keeps only the current state (HIS rows deleted 24 h after discharge); monitor-only ids are tied to nothing | No history: cannot be placed in a past unit |
| Snoozes | `alert_snooze` rows: who, minutes, until, reason (5 codes), severity, at | Through the key → unit map |
| RRT calls | `rrt_call` rows: who, reason (free text), at | Through the key → unit map |
| Handovers | `handovers` table: `unit_id`, `bridge_opened_at`, `bridge_expires_at` (30 min), `outgoing_signed_at`, `incoming_signed_at`, `status` | Yes, natively (the unit is the beds' since G4-02's A1; older rows keep the body's unit) |

**The audit store is not joinable in SQL on every backend** (Postgres in production, a separate SQLite file in dev, in
memory in tests), so the key → unit map is built in Python from the admissions table.

**No source:** «3 dk içinde yanıtlanan» (no threshold), «Hatalı / artefakt olarak kapatılan» (`/ack` takes no reason),
«hemşirelik değerlendirmesi zamanında», «Güvenlik olayları» (falls, pressure ulcers), «İncelenecek olaylar» (no review
workflow), «cihaz kesintisi» (no device-silence history), «devirlerin %… 30 dk içinde karşı imzası» (no countersign
deadline exists), «Rapor al».

## 2. Owner's decisions (2026-11-11)

- **D1 — scope: «Alarm + devir + ertele/RRT».** Per unit, over 1, 7 or 30 days: alarm response (median, p90), the
  answered rate, escalations, unanswered alarms with the self-resolved ones counted apart; handover countersignature
  times; snooze use and its reasons; RRT calls. Not in it: hand-task timeliness and vital charting frequency.
- **D2 — who sees it: «Yeni yetki, denetçi de».** A new key `quality.view`. `hospital_admin` holds it by rule; the
  default `auditor` group («Denetçi») gets it through a migration. Any other group can be given it on the Roles screen.

## 3. Decisions taken in the spec

### D3 — the key and the route

**`quality.view`** («Kalite göstergelerini görür»):
- engine `PERMISSIONS`, appended after the last key; text: `"Open the Kalite göstergeleri page and read per-unit
  care-process indicators (GET /quality), as counts and times only"`;
- mirrored in `catalogue.js` `PERMISSION_KEYS`, `admin.testutil.js` `PERMISSION_TEXTS` and the four-language `perms.js`
  (tr «Kalite göstergelerini görür»);
- default: `auditor` only (D7); `hospital_admin` by rule.

**The route:**
```js
{ id: "kalite", path: "/kalite", icon: <an existing icon chosen by the plan>, labelKey: "kalite.nav",
  shortKey: "kalite.navShort", perms: ["quality.view"], work: true, nav: "main" }
```
- After `ozet`, before `settings`. With the pharmacy slice: devir → eczane → ozet → kalite → settings.
- `work: true`: a group given only `quality.view` (a hospital's own «Kalite birimi») can sign in with it. Existing
  groups' homes do not move (the route sits late in the table).

### D4 — engine: `GET /quality?days=1|7|30`

Guard `quality.view`. `days` is one of 1, 7, 30 (422 otherwise). `days=1` is the last 24 hours, as in `/alarm-quality`.

**Reading:**
1. The audit trail of the caller's hospital since `now − days`, the newest rows first, capped as `/alarm-quality` is
   (`ALARM_QUALITY_LIMIT_MAX`), for the event types `EPISODE_READ_KINDS ∪ {alert_snooze, rrt_call}` — the episode
   kinds but `alert` (A2); `truncated` when the cap was hit.
2. Episodes with the existing `build_episodes` (no change to its rules).
3. **The key → unit map** (`quality.units_of_keys`): for the keys seen, the caller tenant's admissions whose
   `protocol_no` is the key, or (legacy) whose patient's `patient_number` is the key and whose `protocol_no` is null;
   each key → `admitting_unit_id`. A key that maps to two different units is **ambiguous** and is not placed. A key
   with no admission is not placed. Unplaced items go to `unplaced`.
4. Handovers from the `handovers` table whose `bridge_opened_at` is in the window, by `unit_id`, in the caller's
   tenant.

**Answer** (counts, times, unit ids and names; no patient key, no person, no free text):
```
{ days, generated_at, window_from, truncated,
  coverage: { episodes, placed, unplaced },                       # how many alarm episodes could be tied to a unit
  units: [ { unit_id, unit_name, alarms, snoozes, rrt, handovers } ],   # by unit name; every open unit reached (A3)
  unplaced: { alarms, snoozes, rrt } | null,                       # only for an unrestricted caller
  hospital: { alarms, snoozes, rrt, handovers } }                  # the sum the caller may see
```
- **`alarms`**: `episodes`, `answered`, `answered_rate` (null when nothing settled), `median_response_sec`,
  `p90_response_sec`, `escalated`, `unanswered`, **`unanswered_resolved`** (settled unanswered episodes whose rule
  stopped by itself: an `alert_cleared` row with reason `resolved`, never answered — a subset of `unanswered`, new and
  additive; A1), `pending`, `per_kind`
  (kind → episodes, answered, escalated, unanswered, median). Same rules as `/alarm-quality`'s `summarise`; computed per
  group.
- **`snoozes`**: `count`, `by_reason` (the five codes → count), `by_severity` (high, moderate → count),
  `median_minutes`.
- **`rrt`**: `count`. (The free-text reason is never sent.)
- **`handovers`**: `opened`, `countersigned`, `waiting` (outgoing signed, not countersigned), `expired` (open past its
  30-minute bridge without the outgoing signature), `median_countersign_sec` and `p90_countersign_sec` (outgoing
  signature → countersignature, over the countersigned ones). No «within 30 min» share: the countersignature has no
  deadline in the system. Handovers have no `unplaced` (every one has a unit).

**Scope:**
- An unrestricted caller gets every unit and `unplaced`.
- A scoped caller gets only the units in their **unit** grants (`unitscope.unit_clause`'s rule: a bed grant names a
  bed, not its unit); no `unplaced` row; `hospital` sums only what they got; `coverage` counts only their units' and
  says so through a `scoped: true` flag.
- A caller who reaches nothing gets empty `units`, and `hospital` with zeros, `scoped: true` — the page says
  «kapsamınızda birim yok». A scope that cannot be read is a 503, never an empty reach (A4).

**Change to `/alarm-quality`:** its `summarise` also returns `unanswered_resolved`; it no longer reads `alert` rows and
no longer sends `repeats`, top level or per kind (A2). No other field changes.

**Route tables:** `test_route_permissions` EXPECTED + 1; the tenant-isolation rule; nginx access-log map
`~^/quality$ $uri;` if needed by the map's rules, and the proxied paths list (`quality` prefix).

### D5 — the page `/kalite` «Kalite göstergeleri»

Read-only; no patient name, key or id anywhere; no person's name.

1. **Header:** «Kalite göstergeleri», the line «Süreç ölçülür, kişi değil», the period switch «Bugün» (son 24 saat) ·
   «7 gün» · «30 gün», «HH:MM itibarıyla», «Yenile».
2. **Coverage line** (shown under the header whenever there is an answer and the reach is not empty — §5 A5): «Bu dönemde {episodes} alarmın {placed}'i bir birime
   bağlanabildi. Birime bağlanamayanlar: bu sistemde kabul kaydı olmayan (HBYS'den gelen ya da kimliği olmayan monitör)
   hastalar.» A scoped caller reads «yalnız kapsamınızdaki birimler». When `truncated`: «yalnız en yeni kayıtlar okundu;
   dönem {window_from} ile başlıyor».
3. **Hospital cards:** median response · answered rate · escalated · unanswered (with «{n}'i kendiliğinden düzeldi») ·
   snoozes · RRT calls · median countersignature time.
4. **Units table:** one row per unit in the answer, then «Birimi belli olmayan» (unrestricted only), then «Toplam».
   Columns: Alarm (episodes) · Yanıt medyanı · p90 · Yanıtlanan % · Eskale · Yanıtsız (kendiliğinden düzelen) · Ertele ·
   RRT · Devir (açılan / karşı imzalı / bekleyen) · Karşı imza medyanı.
5. **Snooze reasons:** a small table, reason × count, hospital-wide and for the selected unit (a row click selects a
   unit; no navigation).
6. **Per-kind alarms** for the selected unit (or the hospital): kind, episodes, answered, escalated, unanswered, median.

**Every number is real or says why not** (Decision 18): loading, failed, refused and malformed answers show «—» with a
reason, never 0; a null rate shows «henüz yerleşen yok»; a median over nothing shows «—».

**Reading:** on open, on a period change and on «Yenile»; never on a timer; the newest request wins.

### D6 — not in this slice

Hand-task timeliness, vital charting frequency and past vital-task lateness; «3 dk», «Hatalı», «Güvenlik olayları»,
«İncelenecek olaylar», device outage; export and «Rapor al»; placing HIS-fed patients (needs a location history);
transfers (if reopened, the key → unit map must become time-bound: an admission's start and end per unit).

### D7 — the migration

`0020_quality_view`: inserts `quality.view` for the default `auditor` group of every tenant (0017's pattern;
downgrade deletes it). Its `down_revision` is the head of main when it lands: `0018` today; **if the pharmacy slice's
`0019` lands first, it becomes `0019`** (one line; whoever merges second makes it). No other schema change.

## 4. Tests

**Engine:**
- `units_of_keys`: protocol number, legacy H-number, a key with two units (ambiguous → unplaced), unknown key, another
  tenant's admission never matched.
- `GET /quality`: permission (403 without the key); `days` validation; per-unit alarms against a fixed trail (median,
  p90, rate, escalated, unanswered and `unanswered_resolved`, pending, per_kind); snoozes by reason and severity; RRT
  count; handovers per unit (opened, countersigned, waiting, expired, median and p90 countersign); unplaced only for an
  unrestricted caller; scoped caller sees only unit-granted units, `hospital` sums them; truncated; no patient key, no
  person, no free text anywhere in the answer; tenant isolation.
- `/alarm-quality` gains `unanswered_resolved`; its existing fields unchanged.
- The migration up/down on a throwaway Postgres; the auditor group holds the key after upgrade.
- Route tables, nginx map, access-log redaction; `quality.view` in the catalogue.

**Dashboard:**
- pure `kalite.js`: the view model (cards, rows, the unplaced and total rows, coverage text inputs, Decision 18
  reasons, null medians and rates);
- `KaliteScreen`: period switch, newest-wins, «Yenile», truncated, scoped caller, empty reach, 403, malformed answer,
  unit selection;
- `routes.test.js` (the pinned tail), `rawKeys`, `strings` (four languages), the catalogue drift tests, `engineTypes`
  unaffected (no new audit type).

**Gates:** the engine's no-DB suite; the DB tests that touch quality, handovers, admissions and the migration, on a
throwaway Postgres on 127.0.0.1:5644x; the whole dashboard suite; `vite build`.

## 5. Amendments (review, 2026-11-11)

- **A1 — `unanswered_resolved` is the alarms whose rule stopped, nothing else.** It counts the settled unanswered
  episodes that an `alert_cleared` row with reason `resolved` closed (`Episode.self_resolved`). A discharge or an
  «entered in error» («hatalı giriş») close also sets `resolved_at` and is not counted: the patient left, or the value
  was withdrawn — the alarm did not clear by itself. A latched critical nobody answered does count: its rule stopped.
  A pending episode is not counted. Owner's decision: «Yalnız kural durduysa». D4's bullet says so.
- **A2 — neither `/quality` nor `/alarm-quality` reads `alert` rows; `repeats` is gone.** The engine writes an `alert`
  row for every active alert on every ingest. Read, they filled the 20 000-row cap within hours: «7 gün» and «30 gün»
  came back truncated to the last hours, and an episode whose `first_seen` fell past the cut vanished from the counts.
  All they fed was `repeats`, which no screen shows. Both routes read `EPISODE_READ_KINDS` (`EPISODE_KINDS` but
  `alert`); `build_episodes` still accepts `alert` rows (as repeats, never as episodes). `/alarm-quality` no longer
  sends `repeats`, top level or per kind — it would always be 0. `/quality` never sent it.
- **A3 — every open unit the caller reaches is a row.** All of the tenant's active units for an unrestricted caller,
  her unit-granted ones for a scoped caller, each with real zeros when nothing happened in it in the window. A closed
  unit (`is_active` false) is a row only when something happened in it in the window. So `units: []` means the caller
  reaches no open unit (a scoped caller whose only granted unit is closed and quiet gets `[]` too), and «kapsamınızda
  birim yok» is never said of open units that were merely quiet.
- **A4 — a scope that cannot be read is a 503.** As on `/alarm-quality` (G2-A2, D13): `/quality` answers 503 «kapsam
  şu anda okunamıyor» when the caller's scope cannot be read, never an empty reach the page would word as «kapsamınızda
  birim yok». The order stays: 403 without `quality.view`, then 422 for another `days`, then the 503s.
- **A5 — the page, after review.** The coverage line, «Erteleme nedenleri» and «Türe göre alarmlar» are drawn only
  with an answer whose reach is not empty; an empty reach says «Kapsamınızda birim yok» once. A period with no alarm
  episode says so in words («Bu dönemde alarm olayı yok.», a scoped variant) instead of «0 … 0 tanesi». With no
  answer the cards take a neutral heading («Göstergeler · son 7 gün»), never «Hastane geneli» for a scoped caller.
  The unplaced row's handover cells show «—».
- **A6 — a whole percent never says more than the counts.** `wholePercent` (ozet.js, shared with «Yönetici özeti»)
  rounds answered ÷ settled from the counts when known, and says 100 only when every settled episode was answered
  and 0 only when none was (299 of 300 → 99, 1 of 300 → 1).
- **A7 — a stricter shape check.** An answer for another period than the switch shows (`days`), a scoped answer with
  an unplaced row, or `unanswered_resolved` above `unanswered` is a failed read. The shared `usePeriodRead` keeps the
  period each answer was read for, so a period change shows «okunuyor…» at once, never the other period's numbers.
