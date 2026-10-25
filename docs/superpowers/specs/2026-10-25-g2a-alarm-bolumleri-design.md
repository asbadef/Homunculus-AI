# G2-A1 · Alerts clear when their rule stops firing (O17) — design

**Date:** 2026-10-25 · **Lane:** A (patient & engine) · **Branch:** `feat/g2a-o17` off `origin/main` 03daac4
**Open item:** O17 (Task 4 quality review of G2-01, 2026-10-20). **Decided with the user 2026-10-25:**
(1) critical alerts latch until acknowledged, every other severity clears when its rule stops firing;
(2) clearing is immediate — the first evaluation that does not produce the kind ends the episode.

## 1. The problem

`pipeline.py:91–96` keeps "the latest alert per kind" in a per-patient bucket and never removes a
kind whose rule has stopped firing; `active_alerts()` (`:98–99`) returns every kind ever raised. So a
finding that has resolved stays on the board until the same kind fires again; `first_seen` is stamped
once per (patient, kind) ever, so the ▲ marks on the trend charts mean "first time ever", not an
episode; escalation clocks never reset; `alarm_quality` counts episodes that never close; the
notification dedup never re-arms. `AckStore.prune` (`api/ackstore.py:28–33`) and `Notifier.prune`
(`api/notify.py:51–54`) were written for exactly this and are called on every `/ingest`
(`api/app.py:703`, `:712`) — but with a bucket that never shrinks they are no-ops. `/clinical`
(`api/app.py:585–616`) never prunes at all.

Everything downstream keys an alert by `(patient_id, kind)`: acks, first_seen, escalated
(`ackstore.py`), notifications (`notify.py:37–56`), the board merge (`board.py:156–167`), the dashboard
id `pid::kind` (`dashboard/src/liveAdapters.js:180`). The `Alert` dataclass (`reco/engine.py:70–84`) is
frozen, has no id and no timestamp, and is rebuilt on every ingest.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **The engine's bucket is rebuilt from each evaluation.** After `ingest`, `active_alerts(pid)` is exactly the kinds the rules produced for that reading; a kind that was not produced is gone. No quiet time, no hysteresis (user decision 2). | The engine answers one question — what fires now — and nothing else. Every reader of the board already assumes it. |
| D2 | **A critical alert latches.** When a kind with `severity == "critical"` leaves the firing set and is **not acknowledged**, the API keeps it as *resolved, unacknowledged* (`resolved_at` set) until a clinician acknowledges it; the acknowledgement removes it. A critical that was already acknowledged leaves with its rule. HIGH, MODERATE and LOW never latch. (User decision 1.) | A transient critical event must not vanish before anyone saw it; lower severities may. Monitor practice: high-priority alarms latch, the rest reset. |
| D3 | **The latch lives in the API's per-tenant `AckStore`, not in the engine.** `AckStore.resolved: dict[(pid, kind) → {alert: dict, resolved_at: datetime}]`. The engine stays pure. | Acks are tenant state the engine does not know; rehydration already rebuilds the `AckStore`. |
| D4 | **One lifecycle hook,** `sync_alerts(engine, store, pid, now) -> Cleared`, runs after every evaluation on `/ingest`, `/clinical` and in rehydrate: computes the firing set, moves unacked criticals that dropped out into `resolved`, drops acked ones, prunes `acks`/`first_seen`/`escalated` and the notifier's dedup for cleared kinds, and returns what was cleared so the caller can audit it. `_live_keys` becomes firing ∪ resolved. | `/clinical` and `/ingest` must behave alike; today they do not (first_seen yes, prune no). |
| D5 | **A re-fire is a new episode.** Because D4 pruned the kind's ack, first_seen, escalated flag and notification dedup, the next firing stamps a new `first_seen`, starts a new escalation clock and (for immediate urgency) sends a new nurse notification. | The old answer belongs to the old episode. |
| D6 | **New audit event `alert_cleared`** (subject = kind): `{"first_seen": iso|null, "at": iso, "reason": "resolved" | "acked_after_resolve", "severity": str}`. Written by the hook (`reason: resolved`, also for a critical entering the latch — the *rule* resolved) and by `/ack` when it removes a latched alert (`acked_after_resolve`). `AuditEvent.event_type` gains the name. | `alarm_quality` and Lane B's heat map need the close of an episode, not only its open. |
| D7 | **Rehydrate replays through the same hook.** `rehydrate()` calls `engine.ingest` then `sync_alerts(…, audit=False)` for `ingest`/`chart` rows; `first_seen` rows still set the stamp (`setdefault`, which works again because the hook pruned the closed episode's key); `ack` rows acknowledge and, if the key is latched, remove it. `alert_cleared` rows are derived and not replayed. | Without this a restart hands a new episode the old ack and the old clock (the code map's question 1). |
| D8 | **Escalation stops at resolve.** `escalate()` receives the firing set only; a latched alert cannot escalate further and its `escalated` flag is dropped by the prune. `/ack` on a latched key: `store.acknowledge` is not needed — the alert is removed (`resolved` entry deleted, `alert_cleared` audited), the board republished. The 404 for an unknown key is unchanged. | The clock measures an unanswered *active* finding. |
| D9 | **Sepsis recognition resets with its episode.** When `"sepsis"` leaves the firing set, `Engine._recognized_at[pid]` is deleted, so `antibiotic_due`/`antibiotic_overdue` stop and a later sepsis episode starts its own antibiotic clock. | A second episode is a second recognition. |
| D10 | **Board payload:** each alert dict gains `resolved_at` (`null` while firing). Latched alerts are listed after the firing ones with `acknowledged: false`, `escalated: false`. `risk` (`board.py:33–36`) is computed from firing alerts only. | The card's risk reflects what is happening now; the latch is a to-do, not a risk. |
| D11 | **Dashboard:** `liveAdapters.js` maps `resolved_at` → status `RESOLVED` (between FIRED and ACKNOWLEDGED); the alarm row shows the badge **«geçti · onaylanmadı»** (az «keçdi · təsdiqlənməyib», ru «прошло · не подтверждено», en «resolved · unacknowledged») and keeps the acknowledge action; `needsAnswer` counts RESOLVED; sound and vibration stop at resolve, the visual stays; the notification tag becomes `pid::kind::firstSeenAt` so a new episode is a new OS notification. No SSE change: the board replace already drops a cleared alert (`boardStore.js:58–64`). | What the clinician needs is the to-do, not the siren. |
| D12 | **Trend ▲ marks and the alarm-quality report** become per-episode by construction (one `first_seen` row per episode). The G2-01 legend text "▲ ilk tespit" is reworded to "▲ uyarının başladığı an" ×4; `alarm_quality.build_episodes` closes an episode at its `alert_cleared` row. | The marks finally mean what the legend said. |
| D13 | **Not built, recorded as open items:** a notification cool-down for flapping values (user chose immediate clearing knowing a 140→80→140 heart rate yields a new episode and a new nurse notification each time); an alert-level SSE `cleared` frame (Lane B asked; the whole-board replace suffices today); time-based re-evaluation without new data (rules run only on ingest — an alert whose rule would stop purely by time passing clears on the next observation). | Scope. |

## 3. Data flow

```
observation ──► Engine.ingest ──► findings → alerts (firing set, replaces the bucket; "sepsis" gone → _recognized_at reset)
                                      │
                      sync_alerts(engine, store, pid, now)
                         firing ∪ resolved = live keys
                         dropped & critical & not acked → store.resolved[key] = {alert, resolved_at: now}
                         dropped otherwise               → nothing kept
                         prune acks / first_seen / escalated / notifier dedup to live keys
                         returns Cleared[(key, first_seen, reason)]
                                      │
                      audit: alert rows (firing), first_seen (new episodes), alert_cleared (dropped)
                      board republished; notifier.for_new(firing) → nurse notification for new immediate episodes
/ack on a latched key ──► store.resolved.pop(key); alert_cleared(reason=acked_after_resolve); republish
restart ──► rehydrate: ingest/chart → engine.ingest + sync_alerts(audit=False); first_seen setdefault; ack → acknowledge or pop latched
```

## 4. Files

**Engine** — `homunculus-engine/src/homunculus/pipeline.py`: the bucket assignment (`:91–96`) becomes
`self._alerts[pid] = {a.kind: a for a in alerts}`; `_recognized_at` reset when `"sepsis"` is absent
from `alerts` and was present before (`:64–67` is where it is set).

**API** — `api/ackstore.py`: `resolved` mapping, `prune(live_keys)` also prunes `resolved` keys that
are firing again (a re-fire while latched replaces the latch: the kind is active again, no
`alert_cleared` row); new module `api/alert_lifecycle.py` with `sync_alerts` and the `Cleared`
record. `api/app.py`: `/ingest` (`:689–713`) and `/clinical` (`:585–616`) call the hook and audit
its result; `_live_keys` (`:258–259`) = firing ∪ `store.resolved`; `_escalation_cycle` (`:261–282`)
passes the firing set; `/ack` (`:729–`) handles a latched key. `api/board.py:156–167`: `resolved_at`,
latched alerts appended; `:33–36` risk from firing only. `api/audit.py:50`: event type list.
`api/rehydrate.py`: D7. `api/alarm_quality.py:117–152`: close on `alert_cleared`.

**Dashboard** — `dashboard/src/liveAdapters.js` (`:180`, `:202`, `:209`): `resolvedAtMs`, status
RESOLVED, episode id; `dashboard/src/live/screens/alarms/AlarmsScreen.jsx` badge + ack kept;
`dashboard/src/live/signals/AlarmSignals.jsx` (`:32`, `:245–247`): sound stops at resolve, tag per
episode; `dashboard/src/live/boardStore.js:466` `needsAnswer`; `dashboard/src/live/i18n/strings/…`
four strings ×4 languages (`alarmResolvedUnacked`, legend rewording). Lane-marked block `// G2-A1`.

**Docs** — `docs/homunculus-rehber-TR.md:935–937` (the O17 note becomes the rule), the G2-01 plan's
O17 lines (`docs/superpowers/plans/2026-10-19-g2-vital-egrileri.md:23`, `:1442`) get a "resolved by
G2-A1" note, the roadmap row G2-A1, `Homunculus/wiki` untouched (no clinical claim changes).

## 5. Tests (TDD, red first)

- `tests/test_pipeline.py`: fire → stop → `active_alerts` empty; re-fire → present; sepsis stop →
  antibiotic kinds gone and `_recognized_at` reset; the existing presence-after-replay assertions
  (`test_scenarios_e2e.py:25,35,43,55`, `test_scenarios_hl7_parity.py:36,57`, `test_pipeline_model.py:31,41`,
  `test_api_patient_profile.py:159`, `test_rehydrate.py:23–27`, `test_alarm_quality.py:175–181`) are
  re-read: those whose kind stops before the last reading are updated to the new truth, with the
  scenario's clinical story in the assertion message.
- `tests/test_alert_lifecycle.py` (new): critical latches, HIGH does not; acked critical leaves;
  latched → ack removes; prune of acks/first_seen/escalated/dedup; `Cleared` rows; re-fire while
  latched replaces the latch without a cleared row.
- `test_api_ack.py`: ack on a latched key → 200, alert gone, `alert_cleared(acked_after_resolve)`;
  ack on a cleared non-critical → 404. `test_api_ingest*`/`test_api_clinical*`: both doors prune.
- `test_notify.py`: re-fire after clear → a second `new` notification. `test_escalation*`: a
  latched alert never escalates; a re-fire restarts the clock.
- `test_rehydrate.py`: fire, clear, re-fire, ack — replay gives the same board as live (one
  episode acked, the earlier one gone); an `ack` row for a latched key removes it on replay.
- `test_alarm_quality.py`: two episodes of one kind count as two, with closes.
- Dashboard: `liveAdapters.test.js` status mapping; `AlarmsScreen.test.jsx` badge + ack; `AlarmSignals`
  sound stops at resolve, new tag per episode; `strings.test.js` placeholder parity ×4.
- Gates: engine no-DB suite, dashboard suite, build; counts recorded in the plan.

## 6. Acceptance (on the VM, later, with the user)

1. A moderate alert on a synthetic patient (local stack) disappears on the first normal reading.
2. A critical alert on the same patient stays as «geçti · onaylanmadı» after the condition clears,
   its sound stopped; acknowledging it removes it; the audit shows `first_seen`, `alert_cleared
   (resolved)`, `ack`, `alert_cleared (acked_after_resolve)` in that order.
3. Restart the API: the latched alert is still there; after ack and a new episode the ▲ mark and
   the escalation clock are the new episode's.
4. `alarm_quality` counts two episodes for a 140→80→140→80 heart-rate story.

## 7. Out of scope

Notification cool-down (D13), SSE alert-level frames (D13), the RRT page and the heat map (Lane B,
depend on D6), `board.py` NEWS2 freshness and the other A2 engine-debt items (next Lane A slice).
