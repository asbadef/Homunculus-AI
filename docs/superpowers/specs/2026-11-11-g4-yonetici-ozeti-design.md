# G4-02 — «Yönetici özeti»: the hospital at a glance, from real data only

**Date:** 2026-11-11 · **Lane:** B (session homunculus-ai-c4), assigned by Lane A · **Branch:** `feat/g4-yonetici-ozeti`,
cut from `e0850fb1` (G4-01, on top of main `b6d2c1b2`) · **Guide section:** §3.24

**Origin.** The design prototype's «summary» screen (`origin/tasarim/prototip`, `tasarim-taslaklari/app/screens.js`
2773–2792, perm `summary`, role «Başhekim / yönetici») shows four «Unutulan işler» cards, a daily alarm count, an
alarm-quality box over «Bugün / 7 gün / 30 gün», and a units table. Every one of its numbers is written by hand.
`docs/tasarim-prototipi-canli-sistem-notu.md` sets the rule: «ekran sayabilir ama uyduramaz». The roadmap
(`docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md:20`) lists «yönetici özeti» first in Group 4.

## 1. What the system really has

| Need | Source today | Per unit? |
|---|---|---|
| Alarm quality over a period | `GET /alarm-quality?days` (`audit.view`, unrestricted scope only): episodes, answered, `answered_rate` (null when nothing settled), median and p90 response, escalated, unanswered (never answered and at least `DEFAULT_SETTLE` = 10 min old), pending, `per_kind`, `per_day`, `truncated` | No: episodes are keyed by patient and kind, and the trail has no bed |
| Alarms waiting now | the live board (`/patients`, SSE), `needsAnswer` | Yes, by `identity.unit_id`, while the board is LIVE |
| Overdue tasks now | `GET /tasks`: items marked `late` by the server; the vital task's `late` state | Not by itself: the route's top-level `unit_id` reads a field the card does not carry, so it is always null |
| Handovers waiting for a countersignature | none: `GET /handovers` is per person | No |
| Occupancy now | `GET /tenant/structure`: unit → room → bed with `state` | Yes |
| Silent monitors now | the shadow board (G4-01): `silent_for_s`, `vanished`, card `unit_id` | Yes |

The prototype has three numbers with no source: «3 dk içinde yanıt», «Hatalı olarak işaretlenen», «1 saatten uzun sessiz».

## 2. Owner's decisions (2026-11-11)

**D1 — scope.** The recommended option:
- the units table as of now;
- «Unutulan işler» cards above it;
- hospital-wide alarm quality over 1, 7 or 30 days;
- the handovers waiting for a countersignature, which needs a small engine addition.

There is no migration. Alarm quality per unit is a later slice.

**D2 — who sees it.** Only the system administrator, the recommended option.
- A new permission key, `summary.view`, is added.
- `hospital_admin` holds every key by rule, so no migration is needed.
- Another group, such as a chief physician's, can be given the key later on the Roles screen, without code.

## 3. Decisions taken in the spec

### D3 — the permission and the route

**`summary.view`** («Yönetici özetini görür»):
- It is added to `PERMISSIONS`, with no default group.
- It is mirrored in `dashboard/src/live/screens/admin/catalogue.js` and in the four-language `perms.js`.

**The route:**
```js
{ id: "ozet", path: "/ozet", icon: <an existing icon chosen by the plan>, labelKey: "ozet.nav",
  shortKey: "ozet.navShort", perms: ["summary.view"], work: false, nav: "main" }
```
- It goes after `devir`, so nobody's home moves.
- `hospital_admin`'s home stays «Yataklar».

### D4 — engine: two small changes

**`GET /handovers/pending`** (`summary.view`). For each unit, the handovers that are signed by the outgoing nurse and
wait for the countersignature (`OUTGOING_SIGNED`):
- `[{unit_id, unit_name, pending, oldest_outgoing_signed_at}]`, then `generated_at`;
- units with none are left out;
- the scope is the caller's units (`reach_clause`), even though today only an unrestricted admin holds the key;
- the answer carries counts and times only: no patient, no note, no person;
- `OUTGOING_SIGNED` never expires (`service.py`), so the oldest one can be days old, and the page says so.

**`GET /tasks` unit bug.** The route's per-card `unit_id` and `bed_key` are read from where the card keeps them
(`identity`), not from a top-level field that does not exist. This is a fix, with a test.

**Route tables:**
- `test_route_permissions` gains `/handovers/pending`: 73.
- `test_tenant_isolation` follows its rule.
- nginx's access-log map gets `~^/handovers/pending$ $uri;` before the `/handovers` catch-all.

### D5 — the page `/ozet` «Yönetici özeti»

The page is read-only and shows no patient names or ids anywhere.

**1. Header.**
- «Yönetici özeti».
- The time of the last full read: «HH:MM itibarıyla».
- A «Yenile» button.

**2. «Unutulan işler».** Four cards. Each has a count, one line saying what is counted, and its source time.
- **«Yanıtsız kalan alarm · {dönem}».** `unanswered` from `/alarm-quality` for the chosen period: episodes never
  answered and at least 10 minutes old. The 10 minutes is the engine's reporting boundary (`DEFAULT_SETTLE`, twice the
  5-minute escalation), and the card says so.
- **«Karşı imzası bekleyen devir».** The total from `/handovers/pending`, then «en eskisi {n} saat/gün önce».
- **«Geciken iş».** Now: hand tasks the server marks `late`, plus vital-measurement tasks in state `late`, from
  `/tasks` over the current shift.
- **«Sessiz monitör».** Now: silent, unknown and vanished monitors from the shadow board, then «en uzunu {n} dk».
  There is no «1 saatten uzun» threshold, because it has no source.

**3. «Alarm kalitesi».**
- A period switch: «Bugün» (1 gün) · «7 gün» · «30 gün». It drives this box and card 1.
- **Figures:**
  - episodes;
  - answered, with `answered_rate`, or «henüz yerleşen yok» when it is null;
  - median and p90 response time;
  - escalated;
  - unanswered;
  - pending.
- **«Günlük alarm sayısı».** One bar per day from `per_day`, with dates. There is no «geçen haftaya göre» trend.
- **`per_kind`.** A small table: kind, episodes, answered, escalated, median.
- **A truncated read.** When `truncated` is set, the box says «yalnız en yeni {n} kayıt okundu; dönem {from}'dan
  başlıyor», as the heatmap does.
- **What is left out:** «3 dk içinde yanıt» and «Hatalı olarak işaretlenen», which have no source.
- **Loading.** The box loads when the page opens and when the period changes, never on a timer.

**4. «Birimler».** One row per unit of the hospital's structure, as of now.

| Column | Source | Shown as |
|---|---|---|
| Birim | `/tenant/structure` | name |
| Doluluk | `/tenant/structure` bed states | occupied/total, plus «{n} rezerve», «{n} kapalı» when above zero |
| Yanıt bekleyen alarm | live board, `needsAnswer` by `identity.unit_id` | count, with critical and high in brackets |
| Geciken iş | `/tasks` by card unit (D4 fix) | count |
| Karşı imzası bekleyen devir | `/handovers/pending` | count, plus the oldest's age |
| Sessiz monitör | shadow board by card `unit_id` | count |

Rows without a unit (a patient or a monitor with no bed) are gathered in a last row, «Birimi belli olmayan».

**Every number is either real or says why it is missing.**
- A source that has not answered, failed, or is not fresh shows «—» in its column or card, with a short reason
  («okunamadı», «pano güncel değil», «yetki yok»). It never shows 0.
- **Decision 18:** a zero is shown only from a fresh answer.
- **The live board and the shadow board** are already kept by the app's stores, and the page reads them.
- **`/tasks`, `/tenant/structure` and `/handovers/pending`** are read when the page opens, on «Yenile», and every
  60 s while the page is visible (constant `SUMMARY_POLL_MS`).
- **`/alarm-quality`** follows the rule of section 3.

**If someone holds `summary.view` but not a source's permission** (a group granted the key later), that column or card
says «yetki yok» instead of a number.

### D6 — not in this slice

- Alarm quality per unit, which would mean tying past alarms to units through admission and bed.
- «Rapor al» or an export, and the «Günlük özet hazır» notification.
- History: device silence before `watching_since`, and past vital-task lateness, which is not stored.
- The prototype's «3 dk», «Hatalı olarak işaretlenen» and «1 saat» numbers.
- Default access for charge nurses, auditors or a chief-physician group, which would need a migration.
- The companion «Kalite göstergeleri» screen.

## 4. Tests

**Engine:**
- `/handovers/pending`:
  - permission;
  - per-unit counts and oldest time;
  - OPEN, COMPLETED and EXPIRED excluded;
  - scope;
  - no patient, note or person in the answer;
  - tenant isolation.
- The `/tasks` unit fix.
- The route tables, the nginx map and access-log redaction.
- `summary.view` in the catalogue, the hospital_admin rule, and no default group.

**Dashboard:**
- the pure `ozet.js`, with a fixed clock:
  - the per-unit join of every source;
  - the «Birimi belli olmayan» row;
  - «—» with a reason for a missing, failed or stale source, never 0;
  - the oldest-handover age;
  - the cards;
- `OzetScreen`:
  - the period switch;
  - a truncated read;
  - a null `answered_rate`;
  - «yetki yok»;
  - Decision 18;
- `routes.test.js`, `rawKeys`, `strings`, the admin catalogue drift test.

**Gates:** the engine's no-DB suite; the DB tests that touch handovers and tasks, on a throwaway Postgres on
127.0.0.1:5644x; the whole dashboard suite; `vite build`.
