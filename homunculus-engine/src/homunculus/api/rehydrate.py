# src/homunculus/api/rehydrate.py
"""Rehydrate engine + ack state from the audit log (event sourcing).

The append-only audit is the event log: replaying its `ingest`, `chart`, `profile`, `ack`, `rrt_call`
(G2-B5) and `first_seen` records in id order into a fresh Engine + AckStore reconstructs the runtime state a
restart would otherwise lose. `first_seen` keeps the earliest stamp per (patient, kind), so an
alert's escalation clock runs on across a restart instead of starting over. Replay calls the
engine/store directly, so it writes NO new audit records. Deliberately NOT replayed: the derived
`escalated` set and the `alert`, `escalation` and `notification` records (derived or transient).

Since G2-A1 (O17, D7) every replayed `ingest` and `chart` runs through the lifecycle hook the doors
run (api/alert_lifecycle.py): a closed episode's stamp and ack are pruned as they were live — so
the `first_seen` row of the next episode sets that episode's own stamp —, a critical nobody
acknowledged latches again, and an `ack` row for a latched alert removes it. The `alert_cleared`
rows follow from those and are not replayed — except one whose reason is `discharged` (G2-A11,
D7a), which retires the patient as the discharge did.

The escalation chain (X13) is not in the log: a replayed episode's clock (`clock_from`) is its own
`first_seen` row, and no chain of an episode that ended is remembered (`recent`). After a restart a
chain starts over — the same limitation as `paged` and `escalated`, which are not replayed either.
A call to the rapid-response team (G2-B5) rides its chain live, across a flap inside the escalation
delay; so it is bound by the same limitation: a replayed `rrt_call` row stands only while its episode
is open at that point of the log, and an episode that ended and returned replays without the call.

`alert_snooze` rows (G2-B5b) replay a snooze under the live door's rules, for an alarm firing and unanswered at
that point of the log. A later `ack` row, the episode's end, a worse reading or a discharge ends it, as live.
Whether it still runs is judged once, at the end, against the restart's `now`: a spent one ends with the clock
rule at expiry (`clock_from = until`). Limitation: a snooze the log shows ending at its `until` and the alarm
worsening after it keeps, after a restart, the clock it had before the snooze. The escalation comes sooner, never
later; `paged` is not replayed either."""
from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timedelta, timezone

from homunculus.api.ackstore import AckStore
from homunculus.api.alert_lifecycle import (
    DISCHARGED, acknowledge_latched, live_keys, retire_state, sync_alerts,
)
from homunculus.api.audit import AuditRecord
from homunculus.api.clinical import RETRACT, profile_from_payload
from homunculus.api.identity import bounded_role
from homunculus.api.readings import SOURCE_MAX   # G3-05: the column's width, which a device key is cut to
from homunculus.api.snooze import clean_reason, minutes_ok, worse   # G2-B5b
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine


def rehydrate(engine: Engine, store: AckStore, records: Iterable[AuditRecord], *,
              skip: frozenset[int] = frozenset(), skip_device: frozenset[tuple] = frozenset(),
              now: datetime | None = None) -> None:
    # Any iterable, read once, in id order (G2-A2, D12): the API hands it `audit.iter_records`,
    # which reads the log a page at a time, so no cap can drop the newest rows.
    # G3-01 (D12): `skip` is the rows a «hatalı giriş» withdrew (`retracted_entries`, read first by
    # the API): they are not replayed, so a restart scores the patient as the live rebuild did. G3-05 (D13): a
    # withdrawn row is a `chart` row or a device's `ingest` row — both are skipped — and `skip_device`
    # (`retracted_device_readings`) names the device readings withdrawn, so a second `ingest` row of the same
    # reading is skipped with the one the nurse named (`_withdrawn`).
    # G2-B5b: `now` is the restart's clock — a snooze row written later than it is passed over, and what is left
    # running is judged against it at the end.
    now = now if now is not None else datetime.now(timezone.utc)
    for rec in records:
        if rec.event_type in ("ingest", "chart") and _withdrawn(rec, skip, skip_device):
            continue
        if rec.event_type in ("ingest", "chart"):
            # `chart` is a clinician's observation and replays exactly like a device's. It has
            # to: a charted `suspected_infection` that a restart forgot would take the sepsis,
            # septic-shock and antibiotic-clock alerts down with it, silently, on a patient the
            # ward believes is being watched for exactly those.
            written = _written_at(rec)
            if _replay_ingest(engine, rec, written):
                # G2-A1 (D7): through the hook, as the door ran it. What it clears was audited
                # live (`alert_cleared`) and is not written again.
                sync_alerts(engine, store, rec.patient_id, written)
        elif rec.event_type == "profile":
            _replay_profile(engine, rec)
        elif rec.event_type == "ack":
            _replay_ack(engine, store, rec)
        elif rec.event_type == "rrt_call":
            _replay_rrt_call(engine, store, rec)
        elif rec.event_type == "alert_snooze":
            _replay_snooze(store, rec, now)                          # G2-B5b
        elif rec.event_type == "first_seen":
            key = (rec.patient_id, rec.subject)
            # G3-01 (D12): a stamp only for an alert the replay has on the board, as `_replay_ack` guards. The
            # doors stamp what is firing right after the reading that raised it, so on a consistent trail the
            # key is here; an alert only a withdrawn (skipped) value raised is not, and the live rebuild's
            # hook pruned its stamp — kept, the next real episode would inherit its first sight and clock.
            if key in store.firing or key in store.resolved:
                store.first_seen.setdefault(key, datetime.fromisoformat(rec.payload["at"]))
                store.clock_from.setdefault(key, store.first_seen[key])
        elif rec.event_type == "alert_cleared" and rec.payload.get("reason") == DISCHARGED:
            # G2-A11 (D7a): a discharge retired the patient live, at this point of the log; the
            # replay retires it here. Every other `alert_cleared` row follows from the rows the
            # replay runs through the hook and stays ignored (D7 of A1).
            retire_state(engine, store, rec.patient_id)
        # alert / escalation / notification are derived or transient — nothing to replay.
    # The hook's prunes remembered the chains of the episodes the replay saw end, but nothing replayed
    # continues one (the `first_seen` rows set their stamps directly). Carried past the restart, they
    # would continue a chain from its middle: the last replayed episode's first sight as its clock.
    store.recent.clear()
    # G2-B5b (D3): a replayed snooze whose `until` the restart has passed ended live in the escalation cycle. It ends
    # here, with the clock rule at expiry (`AckStore.expire_snoozes`), judged once at the restart's `now`.
    store.expire_snoozes(now)


def _replay_ingest(engine: Engine, rec: AuditRecord, written: datetime) -> bool:
    """Replay one observation; False when its signal is unknown or its value unreadable (`observation_of`) and
    it was skipped.

    Judged where the door judged it (G2-A2, X10b): at the reading's own stamp, never past the wall
    clock (X10), with the row's write time standing for that wall clock, to within the request.
    Judged at a stamp in the future, as the replay did, every other input was aged to it — a NEWS2
    the ward saw firing came back held, and the antibiotic anchor moved to the future stamp.

    A LINKED reading (G3-05; its `ingest` row names the `reading` it was linked from) was judged where the link
    ran, at the wall clock: back-dated up to 24 h, judged at its measurement it would have replaced an overdue
    antibiotic alert with a due one. It is replayed at the row's write time, so a restart agrees with the live
    board."""
    obs = observation_of(rec)
    if obs is None:
        return False  # unknown signal slug — skip rather than fail the whole replay
    linked = rec.event_type == "ingest" and "reading" in rec.payload
    engine.ingest(obs, now=written if linked else min(obs.timestamp, written))
    return True


def observation_of(rec: AuditRecord) -> Observation | None:
    """The observation an `ingest` or `chart` row recorded, or None for a signal this build does not know, or a
    value no float can hold. G3-01: the replay builds it so, and so does the withdrawal for the shadow lane (X5) —
    one reading equals the other, field for field."""
    try:
        code = SignalCode(rec.subject)
    except ValueError:
        return None
    p = rec.payload
    try:
        value = float(p["value"])
    except OverflowError:
        # G3-01 (review of Task 6): a whole number past the float range (`float(10**400)`) is no reading. The door
        # cannot write one (`float()` refuses it before the row exists), but the trail is what a restart must
        # survive, whoever wrote it: skipped like an unknown signal, rather than failing the replay of the whole
        # tenant — and with it every board.
        return None
    # G2-A4 review (S1, X22): a `chart` row carries `charted_by`, never a `device` — the door stamps the
    # observation "clinician" (api/clinical.py `build_entries`), and the replay must too, or after a restart
    # every hand-charted value reads as coming from "replay" (the SOFA form prints the source).
    # G3-05 (O2): an `ingest` row's device is replayed AS SENT, an empty name included — the door stamped the
    # reading with it, and a rebuilt reading must equal the live one (the shadow lane's removal and the «already»
    # repair compare them). A row with no `device` key (written before the key existed) still reads "replay".
    device = p.get("device")
    if rec.event_type == "ingest" and isinstance(device, str):
        source = device
    else:
        source = device or ("clinician" if rec.event_type == "chart" else "replay")
    return Observation(patient_id=rec.patient_id, code=code, value=value,
                       unit=p.get("unit", ""), timestamp=datetime.fromisoformat(p["obs_ts"]),
                       source_device=source)


def _written_at(rec: AuditRecord) -> datetime:
    """When the row was written — the wall clock the door's hook ran at, to within the request: a
    latched alert's `resolved_at`. A row whose time cannot be read gives its observation's."""
    try:
        return datetime.fromisoformat(rec.ts)
    except (TypeError, ValueError):
        return datetime.fromisoformat(rec.payload["obs_ts"])


def _replay_profile(engine: Engine, rec: AuditRecord) -> None:
    """Restore a clinician-charted baseline/comorbidity profile.

    Losing this on restart is not a cosmetic loss: without the profile the patient-relative
    layer stops downgrading chronic-normal values, so a patient whose atrial fibrillation lives
    at 105 bpm starts alarming on every measurement again — the exact alarm fatigue the layer
    exists to prevent, arriving quietly after a deploy.
    """
    # Read over what the replay has restored so far, as the live door read it over what was
    # charted. A row that cleared the last range is an empty profile, refused when read from
    # nothing — and the range the clinician removed would come back with the next deploy.
    try:
        engine.set_profile(profile_from_payload(rec.patient_id, rec.payload,
                                                engine.profile(rec.patient_id)))
    except (ValueError, TypeError, KeyError):
        return  # a payload we cannot read must not fail the whole replay


def _replay_ack(engine: Engine, store: AckStore, rec: AuditRecord) -> None:
    """`role` is replayed as `acknowledged_by`, bounded like the live path: rows written before
    the device role was bounded may hold anything the body sent (a dict, a page of text).

    G2-A1 (D7, D8): an `ack` row for a latched alert removed it live, and removes it here — it is
    not recorded as an acknowledgement, which a later episode of the same kind would inherit. For
    the same reason a row for a kind that is neither firing nor latched at this point of the replay
    is ignored: the live door answers 404 to it, so it acknowledges nothing, and kept, it would
    answer the next episode of that kind."""
    if (rec.patient_id, rec.subject) not in live_keys(engine, store):
        return
    if acknowledge_latched(store, rec.patient_id, rec.subject) is not None:
        return
    at = datetime.fromisoformat(rec.payload["at"])
    store.acknowledge(rec.patient_id, rec.subject, bounded_role(rec.payload.get("role")), at)


def _replay_rrt_call(engine: Engine, store: AckStore, rec: AuditRecord) -> None:
    """G2-B5 (D5): an open call to the rapid-response team survives a restart — only for an alert the replay has
    on the board and nobody had acknowledged at this point of the log, the rule the live door applies; a later
    `ack` row answers it as the live one did."""
    key = (rec.patient_id, rec.subject)
    if key not in live_keys(engine, store) or key in store.acks:
        return
    try:
        at = datetime.fromisoformat(rec.payload["at"])
    except (KeyError, TypeError, ValueError):
        return
    by = rec.payload.get("actor") or bounded_role(rec.payload.get("role"))
    store.call_rrt(rec.patient_id, rec.subject, str(by), str(rec.payload.get("reason") or ""), at)


def _replay_snooze(store: AckStore, rec: AuditRecord, now: datetime) -> None:
    """G2-B5b (D3): a snooze survives a restart under the live door's rules. It needs an alarm the replay has firing
    at this point of the log (a latched critical is never snoozed) that nobody had acknowledged, of a severity that
    may be snoozed, with minutes within its cap and a reason the door takes. A row the door could not have written
    is passed over, and does not fail the replay: so is one whose `at` has no UTC offset (it cannot be compared
    with the clock), whose `until` would be past year 9999, or whose `at` is later than the restart's `now` (a
    clock stepped back since: kept, it would run past its cap from `now`)."""
    key = (rec.patient_id, rec.subject)
    alert = store.firing.get(key)
    if alert is None or key in store.acks:
        return
    payload = rec.payload
    minutes = payload.get("minutes")
    cleaned = clean_reason(payload.get("reason"), payload.get("reason_text"))
    # Review (fix 4): the row says the severity the snooze was given at (a row from before says nothing: today's
    # rule). Its minutes are held to both caps, and the snooze to the milder severity — the replayed one, or the
    # row is passed over: an alarm worse than the one snoozed ended its snooze live, by a worse reading or by a
    # withdrawal's rebuild (plan note 1).
    recorded = payload.get("severity")
    recorded = alert.severity if recorded is None else recorded
    if cleaned is None or not minutes_ok(alert.severity, minutes) or not minutes_ok(recorded, minutes):
        return
    if worse(alert.severity, recorded):
        return
    try:
        at = datetime.fromisoformat(payload["at"])
        if at.utcoffset() is None:
            return
        at + timedelta(minutes=minutes)          # its `until`: one past year 9999 raises OverflowError here
    except (KeyError, TypeError, ValueError, OverflowError):
        return
    if at > now:
        return
    by = payload.get("actor") or bounded_role(payload.get("role"))
    store.snooze(rec.patient_id, rec.subject, by=str(by), at=at, minutes=minutes, reason=cleaned[0],
                 reason_text=cleaned[1], severity=alert.severity)      # the milder of the two (above)


#: G3-01 (D10): the kinds a patient's ENGINE state is rebuilt from — what `rehydrate` replays into the engine
#: for one patient. The ack, first-seen and clear rows are the store's, and the store is not rebuilt: an
#: alert the ward saw stays seen, and the lifecycle hook, run once after the rebuild, ends what no longer fires.
#: The replay retires a patient at the discharge `alert_cleared` row, which the rebuild never reads: the
#: withdrawal route refuses a discharged number before any rebuild, or the rebuild would bring its readings back.
REBUILD_EVENTS = frozenset({"ingest", "chart", "profile"})


def retracted_entries(records: Iterable[AuditRecord]) -> frozenset[int]:
    """The rows a `chart_retract` row withdrew (G3-01, D12) — `chart` rows and, since G3-05 (D13), a device's
    `ingest` rows — from any rows: the others are ignored, and a payload whose `entry` is not an integer
    withdraws nothing."""
    out: set[int] = set()
    for rec in records:
        if rec.event_type != RETRACT:
            continue
        entry = rec.payload.get("entry")
        if isinstance(entry, int) and not isinstance(entry, bool):
            out.add(entry)
    return frozenset(out)


def _hashable(value: object) -> object:
    """`value` itself, or its repr when it cannot be a set member: the trail is what a restart must survive,
    whoever wrote it, and a payload nobody could have written must not fail the replay of a tenant."""
    try:
        hash(value)
    except TypeError:
        return repr(value)
    return value


def device_key(patient_id: str, code: str, obs_ts: object, device: object, value: object) -> tuple:
    """One device reading as the trail names it (G3-05, D13; B4 review): the patient, the code, the instant, the
    device and the number — D14's tuple. Two `ingest` rows with one key are ONE reading written twice
    (a `seen` that failed open; data from before it existed), and a withdrawal that names either withdraws the
    reading. The instant is compared as an instant and the number as a number, so a copy that spells either
    differently is still the copy; what cannot be read is compared as it stands.

    The device is normalised as the table keeps it (`readings.device_source`: nothing is "", cut to the column's
    SOURCE_MAX), because a linked reading enters the engine under the table's name for its device and a direct
    copy under the name as sent: for a device name longer than the column they are one reading, and one key."""
    if isinstance(obs_ts, datetime):
        at: object = obs_ts
    else:
        try:
            at = datetime.fromisoformat(obs_ts)                               # type: ignore[arg-type]
        except (TypeError, ValueError):
            at = obs_ts
    try:
        number = float(value)                                                 # type: ignore[arg-type]
    except (TypeError, ValueError, OverflowError):
        number = value
    return (patient_id, code, _hashable(at), str(device or "")[:SOURCE_MAX], _hashable(number))


def device_key_of(rec: AuditRecord) -> tuple:
    """`device_key` of an `ingest` row (its subject is the code)."""
    p = rec.payload
    return device_key(rec.patient_id, rec.subject, p.get("obs_ts"), p.get("device"), p.get("value"))


def observation_key(obs: Observation) -> tuple:
    """`device_key` of a reading arriving at the door: what its `ingest` row will say, were it entered."""
    return device_key(obs.patient_id, obs.code.value, obs.timestamp, obs.source_device, obs.value)


def withdrawal_key(rec: AuditRecord) -> tuple | None:
    """`device_key` of the device reading a `chart_retract` row withdrew, or None for any other row — a hand
    entry's withdrawal names no device reading. The row carries the key's parts itself (the code as its subject,
    `value`, `obs_ts`, `device`)."""
    if rec.event_type != RETRACT or rec.payload.get("origin") != "device":
        return None
    p = rec.payload
    return device_key(rec.patient_id, rec.subject, p.get("obs_ts"), p.get("device"), p.get("value"))


def retracted_device_readings(records: Iterable[AuditRecord]) -> frozenset[tuple]:
    """The device readings (`device_key`) the `chart_retract` rows in `records` withdrew — the rows that say
    `"origin": "device"` (G3-05, D13); a hand entry's withdrawal names none. The withdrawal row carries the key's
    parts itself (code as its subject, `value`, `obs_ts`, `device`), so a restart reads only the withdrawals."""
    return frozenset(key for key in map(withdrawal_key, records) if key is not None)


def _withdrawn(rec: AuditRecord, skip: frozenset[int], skip_device: frozenset[tuple]) -> bool:
    """Whether a «hatalı giriş» took this `ingest` or `chart` row out of the patient's scores: it is named
    (`skip`), or — a device's `ingest` row only — it is another row of a device reading that was withdrawn
    (`skip_device`). A hand entry is withdrawn by its own id alone."""
    if rec.id in skip:
        return True
    return rec.event_type == "ingest" and bool(skip_device) and device_key_of(rec) in skip_device


def rebuild_patient(engine: Engine, patient_id: str, records: Iterable[AuditRecord], *,
                    skip: frozenset[int], skip_device: frozenset[tuple] = frozenset()) -> None:
    """One patient's engine state from the trail, without the rows in `skip` and the device readings in
    `skip_device` (G3-01, D10, X4; G3-05, D13: a device reading can be withdrawn too, and every `ingest` row of
    it): first everything the engine holds for the patient is dropped (`Engine.forget`), then that patient's
    `ingest`, `chart` and `profile` rows are replayed in id order with the restart's own helpers — each reading
    judged where the door judged it. Engine only: no store and no lifecycle hook; the caller runs the hook once,
    at its own instant. Rows of another patient or kind are passed over, so the caller may hand it a wider
    read."""
    engine.forget(patient_id)
    for rec in records:
        if rec.patient_id != patient_id or rec.event_type not in REBUILD_EVENTS:
            continue
        if rec.event_type == "profile":
            _replay_profile(engine, rec)
        elif not _withdrawn(rec, skip, skip_device):
            _replay_ingest(engine, rec, _written_at(rec))
