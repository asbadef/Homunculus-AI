# G2-B5b — «Ertele»: snoozing an alarm on the live system

**Date:** 2026-11-10 · **Lane:** B (session homunculus-ai-3b), assigned by Lane A · **Branch:** `feat/g2b-b5b-ertele`,
cut from `abe8b2e7` (`feat/g2-borclar`, which touches the same engine files)

**Origin:** B5's owner decision D2 put snooze in its own slice. The B5 spec (`2026-11-09-g2b-b5-rrt-design.md` §1)
describes the two escalation systems. This slice builds on the live one (`api/ackstore.py`, `api/escalation.py`,
`_escalation_cycle`), as B5 did.

## 1. Owner's decision (2026-11-10)

**D1 — the rules already in the code** (Postgres `escalation/service.py` `snooze_alert`, §6.2), applied to the live
system. This was the recommended option.

- **Critical:** cannot be snoozed.
- **High:** at most 30 minutes.
- **Moderate:** at most 120 minutes.
- **Low and info:** no snooze. They make no sound, so there is nothing to silence.
- **Reason:** mandatory, from a fixed list: `CLINICAL_DECISION_MADE`, `ARTEFACT_OR_SIGNAL_NOISE`,
  `PROCEDURE_IN_PROGRESS`, `PATIENT_BASELINE`, `OTHER`. `OTHER` needs at least 15 characters of free text.
- **Who:** anyone who may acknowledge an alarm (`alerts.ack`), nurses included.

## 2. What a snooze does

A snooze applies to one alarm episode, `(patient_id, kind)`, until its `until`.

While snoozed, the alarm:
- makes no sound;
- is out of the waiting queue: not in `needsAnswer`, the bell, the rail badge, or the RRT screen's «yoldaki» list;
- does not escalate. If it was already escalated, it leaves the escalated set; the doctor's page stays sent;
- stays on the board and the alarm screen, marked «Ertelendi · hh:mm'e kadar · {by} · {reason}».

At `until`, the alarm waits for an answer again: it sounds and counts again.
- Its escalation clock starts again from `until` (`clock_from = until`), as the Postgres rule re-fired with a new
  `fired_at`.
- Its page is cleared too (`paged`). If it then goes unanswered for the escalation window, it escalates and pages
  the doctor again. The snooze was a person's decision for a bounded time; silence after it is a new failure to
  answer. Snoozes are capped and named, so this cannot become a paging storm.
- The client compares `snooze.until` with its own clock, and the server's escalation cycle drops expired snoozes and
  republishes the card. Either way, nothing has to wait for a server push before the alarm sounds again.

What ends a snooze early:
- **An acknowledgement.**
- **The episode ending** (`prune`). A snooze does NOT ride an X13 chain: an alarm that returns after a clear is a new
  alarm and sounds.
- **A discharge** (`forget_patient`).
- **Snoozing again** within the cap. The new snooze replaces the old one, with its own `until`; the Postgres rule
  deactivated the previous snooze the same way.

## 3. Decisions taken in the spec

- **D2 — the route: `POST /alerts/snooze`**, body `{patient_id, kind, minutes, reason, reason_text?}`.
  - **Who:** `alerts.ack`. A device is refused with 403: a snooze is a person's act, named in the trail.
  - **Refusals:**
    - 404: not active (neither firing nor latched).
    - 409 `snooze_not_allowed`: a latched critical. It is critical, and its rule has stopped.
    - 409: already acknowledged.
    - 409 `snooze_not_allowed`: critical, low or info.
    - 422: `minutes` outside `1..cap`.
    - 422: an unknown reason, `OTHER` under 15 characters, or text over 500 characters.
  - **Order:** the trail is written before memory, as `/ack` and `/alerts/rrt-call` do.
  - **Audit row:** `alert_snooze` with `{actor, role, via, groups, minutes, until, reason, reason_text?, at}`.
  - **Access log:** one nginx access-log map line in the «No parameter» block, before the `/alerts/:key` catch-all.
- **D3 — state, card and replay.**
  - **State:** `AckStore.snoozes[key] = {by, at, until, minutes, reason, reason_text}`.
  - **Card:** the alert gains `snooze: {by, at, until, minutes, reason, reason_text} | null`, in both the firing and
    the latched shape. A latched critical never has one.
  - **Replay:** `rehydrate` replays `alert_snooze` rows under the live door's rules, only for an alert that is on the
    board and unacknowledged at that point.
    - A snooze whose `until` has already passed has no effect.
    - The escalation clock rule at expiry applies.
- **D4 — the dashboard.**
  - **Alarm screen:** «Ertele» for `alerts.ack` holders, on an unacknowledged high or moderate alarm.
    - It is hidden for critical alarms. For those, the screen says «Kritik alarm ertelenemez» once, near the button area.
    - The dialog offers durations within the cap (high 5/10/15/30; moderate 15/30/60/120) and the reason list in the
      four languages. It shows the `OTHER` text box (at least 15 characters) and notes that the alarm sounds again
      at hh:mm.
    - Refusals are handled as in the RRT call dialog, `mayHaveLanded` included.
    - Snoozed alarms move to an «Ertelenenler» group, showing their `until`.
  - **Board store:** `needsAnswer` excludes an alarm whose `snooze.until` is in the future, by the board's clock.
    - This also covers the bell, the rail badge, `AlarmSignals` and the RRT waiting list.
    - When the time passes, the alarm comes back without a server round trip; the existing board clock ticks the
      re-render.
  - **Audit page:** labels for `alert_snooze`.
- **D5 — not in this slice:**
  - per-unit snooze policies;
  - snoozing a critical alarm by any role;
  - snoozing from the patient screen. Only the alarm screen gets the button; the patient screen may show an
    «Ertelendi» note if its alarm row already shows status;
  - a report of snooze use;
  - the Postgres `escalation/` module, which stays untouched.

## 4. Tests

- **Engine** (`tests/test_alert_snooze.py`):
  - the rules: every severity, the caps, the reasons, `OTHER`;
  - the refusals: device, permission, 404/409;
  - trail before memory, including a failing append;
  - the card field;
  - no escalation while snoozed; a fresh clock at `until`, then escalation;
  - an acknowledgement, a prune or a discharge ends the snooze;
  - no X13 carry;
  - snoozing again replaces the snooze;
  - replay;
  - the route tables: board permissions, tenant isolation, nginx routes, access-log redaction.
- **Dashboard:**
  - the needsAnswer/expiry rule, with a fixed clock;
  - the alarm screen's button visibility, dialog and groups;
  - the signals do not sound while snoozed, and sound after;
  - the RRT list and the badge;
  - rawKeys;
  - the denetim label.
- **Gates:** the engine's no-DB suite, the whole dashboard suite, and `vite build`.
