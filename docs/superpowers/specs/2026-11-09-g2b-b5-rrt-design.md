# G2-B5 — the RRT screen and «RRT çağır»

**Date:** 2026-11-09 · **Lane:** B (session homunculus-ai-3b), assigned by Lane A · **Branch:**
`feat/g2b-b5-rrt`, cut from `1c03557a` (= main after B4/B6) · **Roadmap («Main'den gelen», `2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` 661–663):**
- «rrtPage · RRT ekranı menüdedir: hızlı yanıt ekibi ve yönetici görür, hemşire görmez»
- «… kendisine eskale edilen alarmları (elle çağrıldıysa yazılı) ve yoldaki cevapsız alarmları ayrı gösterir; liste boşsa boş durumu, 3. kademe kapalıysa bunu açıkça yazar»
- «Menü rozeti cevapsız eskalasyon sayısını gösterir; cevaplanan alarm rozetten düşer»

## 1. What exists: two escalation systems, one of them dead

**(A) Live, in memory.** `api/ackstore.py`, `api/escalation.py` and `_escalation_cycle` in `api/app.py`.
- It is keyed by `(patient_id, kind)` and has one step.
- An alarm of urgency `immediate` that nobody acknowledged becomes `escalated` after `escalate_after`. The default is 5 min, and `prodserver.py` does not override it.
- Escalation pages the `doctor` audience once per chain.
- The card carries a boolean `escalated`.
- `POST /ack` is the alarm screen's only write.

**(B) Postgres, `escalation/`.** The tables `alerts` and `escalation_events`, three tiers (charge nurse 3 min → physician 5 min → RRT 10 min), and snooze rules.
- Nothing schedules it, and engine alerts are never written to its tables. The B1a spec and the HBYS roadmap input already say its tables are never written on the VM.
- Its `/alerts/{uuid}/snooze|escalate` routes need a UUID that no live alarm has.

**Reconciliation:** build on (A). (B) stays as it is, not called and not deleted. Retiring it is a separate clean-up.

## 2. Owner's decisions (2026-11-09)

- **D1 — the RRT comes only when called by hand** (the recommended option).
  - «RRT çağır», with a reason, comes to the alarm screen.
  - The RRT screen lists the called alarms and, separately, the unanswered urgent alarms on their way.
  - The screen states plainly that the automatic RRT step is off. The old pilot decision said the same: two steps, no automatic RRT.
- **D2 — snooze is its own slice.** It silences an alarm, so it gets its own careful spec and tests. This slice adds no snooze.

## 3. Decisions taken in the spec

- **D3 — the call: `POST /alerts/rrt-call`, body `{patient_id, kind, reason}`.**
  - **Routing.** The prefix `alerts` is already proxied by nginx and vite, so no proxy line changes. nginx's access-log map lists it among the routes logged as they are (one line in the «No parameter» block, before the `/alerts/:key` catch-all; `tests/test_access_log_redaction.py` holds the two together). No patient id is in the path; it travels in the body, as with `/ack`.
  - **Permission.** `alerts.escalate`, held by charge nurses, physicians, the rapid-response team and the hospital administrator, but not nurses. A device token is refused (403): the RRT is called by a person, named in the trail.
  - **Refusals:**
    - 400 when the reason, after trimming, is shorter than 3 or longer than 500 characters;
    - 404 when the alert is not active (firing, or latched: a critical whose rule stopped before anyone answered);
    - 409 when the alert is already acknowledged («alarm zaten yanıtlandı»): nobody is waiting for help on an answered alarm.
  - **Repeat calls.** A second call for an alert that already has one answers the card and writes nothing. The first call stands.
  - **Write order.** The trail is written before memory, as `/ack` does: an audit row `rrt_call` with `{actor, role, via, groups, reason, at}`.
- **D4 — state.**
  - **Store.** `AckStore.rrt_calls[(patient_id, kind)] = {"by", "at", "reason"}`, where `by` is the caller's username.
  - **Card.** Each alert, firing or latched, carries `rrt_call: {by, at, reason} | null`.
  - **An answer ends the call.**
    - An acknowledgement (`/ack`) by anyone holding `alerts.ack` removes it. RRT members hold that permission.
    - So does the acknowledgement of a latched alert.
  - **The call ends with its episode.** It leaves the board with its episode (`prune`), and a discharge forgets it (`forget_patient`).
- **D5 — a restart.** `rehydrate` replays `rrt_call` rows, for an alert that is on the board at that point of the log and not yet acknowledged, the same rule as the live door. A later `ack` row answers it as live. Without this a deploy would silently drop an open call from the RRT screen.
- **D6 — the screen `/rrt`.**
  - **Route:**
    ```js
    { id: "rrt", path: "/rrt", icon: "zap", labelKey: "rrt.nav", shortKey: "rrt.navShort",
      perms: ["alerts.escalate"], work: true, nav: "main" }
    ```
    It sits after `denetim` and before `settings`, so nobody's home moves. Nurses do not see it (roadmap); charge nurses and physicians do, because they may call.
  - **Data.** Both lists come from the board. They live-update over the stream and follow the board's scope; RRT members are normally unassigned, so unrestricted.
  - **«RRT çağrıları».**
    - Contents: alarms with an open call and no acknowledgement, oldest call first.
    - Each row shows the bed and patient as on the alarm screen, the summary and severity, «Elle çağrıldı · {by}», the reason, and how long ago.
    - A holder of `alerts.ack` gets «Gördüm». It is the same `/ack`, which answers and removes the call.
  - **«Yoldaki cevapsız alarmlar».**
    - Contents: alarms waiting for an answer (`needsAnswer`) with urgency `immediate` and no call, in the alarm queue's order.
    - Each row shows «Hekime eskale oldu» when escalated, otherwise «{n} dk'dır cevapsız».
  - **Fixed note:** «Otomatik RRT kademesi kapalı: cevapsız acil alarm 5 dk sonra hekime eskale olur; RRT yalnız elle çağrılınca gelir.»
  - **Empty states.** Each list has its own empty state.
  - **Connection.** A board that is not LIVE shows the alarm screen's connection note. Counts are never shown as if current (Decision 18).
- **D7 — the rail badge.**
  - `rrt` shows the number of open calls with the alarms badge's LIVE/stale rule: a number when LIVE, a dot when stale, nothing when unknown.
  - An answered call drops out.
  - Its accessible text is its own (`rrt.badgeCount`, `rrt.badgeStale`).
- **D8 — the alarm screen.**
  - A holder of `alerts.escalate` gets «RRT çağır» on an alarm that waits for an answer and has no call.
  - The button opens a dialog with a required reason (3–500 characters).
  - On success the board takes the returned card. A refusal is shown and the list is unchanged, as with acknowledgement.
  - An alarm with a call shows «RRT çağrıldı · {by} · {time}».
- **D9 — the audit page.** `rrt_call` gets a label in B4's `EVENT_TYPES`: «RRT çağrıldı».
- **D10 — not in this slice:**
  - snooze (D2);
  - a push notification to RRT devices (the live dashboard does not subscribe to `/notifications`; the RRT sees the badge and the screen);
  - an automatic RRT step (D1);
  - the Postgres `escalation/` module, which stays untouched;
  - per-unit RRT teams.

## 4. Tests

**Engine: `tests/test_rrt_call.py`.**
- A call puts `rrt_call` on the card and writes one `rrt_call` row before memory. A repeat call writes nothing.
- Refusals:
  - 403 for a nurse (no `alerts.escalate`);
  - 403 for a device token;
  - 400 for an empty or short reason;
  - 404 for an unknown alert;
  - 409 for an acknowledged alert.
- A latched alert can be called.
- `/ack` removes the call, for a firing alert and for a latched one.
- An episode that clears takes the call with it, and a discharge forgets it.
- Restart:
  - an open call comes back;
  - a call answered before the restart does not;
  - a row for an alert that was not on the board at that point is ignored.

**Dashboard:**
- `rrt.js` (pure): the two lists, their order, and `known`/`stale`.
- `liveAdapters` maps `rrt_call`.
- `RrtScreen.test.jsx`: the lists, the empty states, the note, and «Gördüm».
- The alarm screen's call dialog: the reason rule, success, refusal, and no button without the permission.
- The rail badge.
- `routes.test.js`: the route's shape, and that a nurse cannot reach it.
- `rawKeys.test.jsx`.
- The denetim label.

**Gates:**
- Engine: the new file plus `tests/test_ack*`, `tests/test_rehydrate*` and `tests/test_alarm_quality.py`.
- Dashboard: the whole suite and `vite build`.

## 5. Review amendments (2026-11-10; commits 9e4e6f6c, 600f8264, 1a7333e2, 4ccb9dcb, 216760c0)

- **D4: a call rides its X13 chain.** Without this, a flap (NEWS2 7 / 4 / 7 inside `escalate_after`) kept the
  escalation clock and the doctor's page, but silently dropped the RRT call from the list and the badge.
  - `Chain` now carries the call. A return that continues the chain gets the call back, and no second row is written.
  - A return after the delay starts a new episode with no call.
  - An acknowledged call is never carried.
  - Restarts: chains are not replayed (the existing X13 limitation). After a restart, a call therefore does not cross
    an episode that ended. A test names this as a limitation.
- **Trail before memory is tested.** A failed `rrt_call` append answers 500 and leaves no call. The retry is the call,
  with exactly one row.
- **Replay cases are tested.** A latched call followed by a latched ack, a call followed by a discharge, and an episode
  that ends.
- **Audit comments.** They now say honestly that the trail carries no demographics, but an `rrt_call` row carries the
  caller's free-text reason. The dialog's hint asks the caller not to write names or ID numbers.
- **The nginx access-log map** lists `/alerts/rrt-call` among the routes logged as they are. It comes before the
  `/alerts/:key` catch-all, as the drift guard requires.
- **Route tables.** The board permission table and the tenant-isolation route list name the new route. A device is
  refused (tested).
- **A write with no answer is not a refusal.** A timeout, a 502/504 or a dropped connection (`mayHaveLanded`) gives a
  warn toast: «yanıt gelmedi — RRT çağrılmış olabilir; yeniden çağırmak zararsızdır». It mirrors `RetractDialog`.
- **A short reason moves focus to the reason field.**
- **An earlier call by someone else is reported** («RRT zaten çağrılmış ({by}); gerekçeniz eklenmedi»), so a caller is
  not told their reason was recorded when it was not.
- **Copy.** The second list's empty text says «çağrısız» (it lists alarms without a call). The intro no longer
  addresses the viewer as the called team.
- **Accepted, not changed:**
  - The tier-off sentence says «5 dk», the default `escalate_after`, which `prodserver.py` does not override.
  - A new call raises no sound or push for the team (D10). The rail badge is the signal.
  - Focus after a successful call falls to the page, as after «Gördüm» today.
