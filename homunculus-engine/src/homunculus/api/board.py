# src/homunculus/api/board.py
"""Pure builders that turn an Engine's state (+ ack/escalation store) into the dashboard's board JSON."""
from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone

from homunculus.api.ackstore import AckStore
from homunculus.api.patient_identity import IdentityRecord, IdentityStore, is_tombstone
from homunculus.canonical import SignalCode
from homunculus.pipeline import Engine
from homunculus.reco.engine import Alert
from homunculus.rules.antibiotic_clock import WINDOW as ANTIBIOTIC_WINDOW
from homunculus.rules.news2 import score as news2_score
from homunculus.rules.sofa import total_sofa
from homunculus.tenant.bedmap import BedMap, normalise_key

_SEVERITY_ORDER = ["info", "low", "moderate", "high", "critical"]

# The measured channels the board publishes, and the key each travels under. One table so a
# value and its timestamp can never drift apart.
_PUBLISHED_SIGNALS = {
    "heart_rate": SignalCode.HEART_RATE,
    "map": SignalCode.MAP,
    "sbp": SignalCode.SBP,
    "spo2": SignalCode.SPO2,
    "temperature": SignalCode.TEMPERATURE,
    "resp_rate": SignalCode.RESP_RATE,
    "lactate": SignalCode.LACTATE,
}


def _risk(alerts: list[Alert]) -> str:
    if not alerts:
        return "none"
    return max((a.severity for a in alerts), key=_SEVERITY_ORDER.index)


def _latest(state, code: SignalCode):
    obs = state.latest(code)
    return None if obs is None else obs.value


def _latest_at(state) -> dict:
    """When each published signal was last observed, ISO-8601, or None if never.

    The engine has always known this — `stale_inputs` is built from it — but the board only
    ever carried values, so no screen could tell a live feed from one that stopped an hour ago.
    On an on-prem deployment nobody can look at the bridge from here, which makes "how old is
    this number" the difference between a quiet ward and a dead feed that looks like one.
    """
    out: dict[str, str | None] = {}
    for key, code in _PUBLISHED_SIGNALS.items():
        obs = state.latest(code)
        out[key] = obs.timestamp.isoformat() if obs is not None else None
    return out


def _iso(at: datetime | None) -> str | None:
    return None if at is None else at.isoformat()


#: ACVPU's letters, by the ordinal the engine records (canonical.py: 0 = Alert … 4 = Unresponsive).
_ACVPU_LETTERS = "ACVPU"


def _last_charted(state) -> dict:
    """What the two charted NEWS2 inputs last read, whatever its age; None if never charted
    (G2-A2, X11). An expired chart is scored as air or Alert and named in `assumed`; the card then
    says what it last read, so «assumed: room air» does not hide that the patient was charted on
    oxygen. Oxygen as charted — 1 on oxygen, 0 room air, as the score reads it; consciousness as
    its ACVPU letter (an ordinal that is not a whole 0–4, which the door allows, as its number)."""
    oxygen = state.latest(SignalCode.SUPPLEMENTAL_OXYGEN)
    acvpu = state.latest(SignalCode.ACVPU)
    letter = None
    if acvpu is not None:
        v = acvpu.value
        letter = _ACVPU_LETTERS[int(v)] if v.is_integer() and 0 <= v <= 4 else f"{v:g}"
    return {"air_or_oxygen": None if oxygen is None else int(oxygen.value >= 1.0),
            "consciousness": letter}


def _news2(state, now: datetime) -> dict:
    """The engine's NEWS2, in the shape the board carries it.

    `total` is always a number — NEWS2 scores a missing parameter as 0 — so `partial` and
    `missing` are what tell a reader whether that number is the whole story.

    G2-A2. Judged at `now` (D3): a vital past its window is out of the total and named in `stale`
    (D1); `assumed` names the inputs scored as air and Alert because nothing current is charted
    (D7). `measured_at` and `fresh_until` carry each of the seven inputs' last reading and the end
    of its window, ISO-8601 or None (D4). The API sends the stamp, never an age — an age baked into
    a payload is wrong a minute after it was published — and "too old" is `stale`, never a
    comparison the screen makes with `fresh_until`. `last_charted` is what the two charted inputs
    last read (X11), for the card to name beside an expired chart.
    """
    result = news2_score(state, now)
    return {
        "total": result.total,
        "partial": result.partial,
        "missing": list(result.missing),
        "red_param": result.red_param,
        "breakdown": dict(result.breakdown),
        "stale": list(result.stale),
        "assumed": list(result.assumed),
        "measured_at": {name: _iso(at) for name, at in result.measured_at.items()},
        "fresh_until": {name: _iso(at) for name, at in result.fresh_until.items()},
        "last_charted": _last_charted(state),
    }


def freshness_turned(state, since: datetime, until: datetime) -> bool:
    """Whether one of this patient's NEWS2 inputs stopped counting in [since, until) — fresh at
    `since`, stale at `until`: a reading's window closed, or a charted value expired (G2-A2, D5).
    The rule counts an age equal to the window as fresh, so a window ending at `at` is stale only
    after `at`; the spec's "(since, now]" had that end wrong (Task 2 review). Consecutive cycles'
    intervals [t0, t1), [t1, t2) leave no gap and no overlap: each window end is pushed once.
    Pure: the escalation cycle asks it of every measured patient and republishes the board when
    the answer is yes, because nothing else would — a feed that stops is exactly when no further
    frame arrives."""
    return any(at is not None and since <= at < until
               for at in news2_score(state).fresh_until.values())


_PRESSORS = {
    "norepinephrine": SignalCode.NOREPINEPHRINE_RATE,
    "epinephrine": SignalCode.EPINEPHRINE_RATE,
    "dopamine": SignalCode.DOPAMINE_RATE,
    "dobutamine": SignalCode.DOBUTAMINE_RATE,
}


def _meds(engine: Engine, state, patient_id: str, now: datetime | None = None) -> dict:
    """The medication picture, and the antibiotic clock behind it.

    Written for the pharmacist, who until now could reach no screen this system did not also show
    to everyone else. The one clinical rule in this engine that is squarely a pharmacist's business
    is the 1-hour antibiotic window after sepsis recognition — and it was reachable only as an
    alert that had already fired, which is exactly too late to be useful to the person who could
    have prevented it firing.

    `antibiotic_given` is deliberately three-valued. `None` means nobody has charted an
    administration either way; rendering that as "not given" would accuse a ward of missing a
    deadline it may well have met and simply not recorded here.
    """
    recognized = engine.recognized_at(patient_id)
    given_at = None
    for obs in state.history(SignalCode.ANTIBIOTIC_ADMINISTERED):
        if obs.value >= 1.0 and (recognized is None or obs.timestamp >= recognized):
            given_at = obs.timestamp
            break
    charted_any = state.latest(SignalCode.ANTIBIOTIC_ADMINISTERED) is not None

    clock = None
    if recognized is not None:
        deadline = recognized + ANTIBIOTIC_WINDOW
        reference = given_at or now or datetime.now(timezone.utc)
        clock = {
            "recognized_at": recognized.isoformat(),
            "deadline": deadline.isoformat(),
            "remaining_sec": None if given_at is not None
                             else round((deadline - reference).total_seconds()),
            "elapsed_sec": round((reference - recognized).total_seconds()),
            "met": None if given_at is None else given_at <= deadline,
        }

    return {
        "pressors": {name: _latest(state, code) for name, code in _PRESSORS.items()},
        "on_pressor": any((_latest(state, code) or 0) > 0 for code in _PRESSORS.values()),
        "antibiotic_given": (True if given_at is not None
                             else (False if charted_any else None)),
        "antibiotic_at": given_at.isoformat() if given_at is not None else None,
        "antibiotic_clock": clock,
        "creatinine": _latest(state, SignalCode.CREATININE),
        "weight_kg": _latest(state, SignalCode.WEIGHT_KG),
    }


def _sepsis_context(engine: Engine, state, patient_id: str) -> dict:
    """What the Sepsis-3 criterion is actually being judged against on this patient.

    Both of these were invisible to the ward. `suspected_infection` is the gate the entire sepsis
    branch sits behind — `septic_shock.evaluate` returns at its first line until a clinician
    charts it — so a bed with no sepsis alert may simply be a bed nobody has charted. And
    `baseline_sofa` is the number the total is compared against: a rise of 2 is the criterion, so
    without the baseline the physician cannot tell an alert that means something from one that is
    just this patient's chronic kidneys.

    Publishing them turns "no alert" from silence into a statement the bedside can check.
    """
    profile = engine.profile(patient_id)
    baseline = profile.baseline_sofa if profile is not None else None
    suspected = _latest(state, SignalCode.SUSPECTED_INFECTION)
    sofa = total_sofa(state)
    return {
        # None is not False: "nobody has charted this" and "the physician charted no infection"
        # are different clinical situations and the card must be able to say which.
        "suspected_infection": None if suspected is None else suspected >= 1.0,
        "sofa": sofa,
        "baseline_sofa": baseline,
        "baseline_assumed": baseline is None,
        "rise": sofa - (baseline or 0),
    }


def _merge_alert(patient_id: str, alert: Alert, store: AckStore) -> dict:
    key = (patient_id, alert.kind)
    ack = store.acks.get(key)
    seen = store.first_seen.get(key)
    return {
        **asdict(alert),
        "acknowledged": ack is not None,
        "acknowledged_by": ack["by"] if ack else None,
        "acknowledged_at": ack["at"].isoformat() if ack else None,
        "first_seen_at": seen.isoformat() if seen is not None else None,
        "escalated": key in store.escalated,
        # G2-A1 (D10): when its rule stopped firing; None while it fires.
        "resolved_at": None,
    }


def _latched_alerts(patient_id: str, firing: list[Alert], store: AckStore) -> list[dict]:
    """G2-A1 (O17), D2 and D10: this patient's critical alerts whose rule stopped firing while
    nobody had acknowledged them, oldest resolution first, in the firing alerts' shape. Never
    acknowledged and never escalated, by construction: an acknowledgement removes one (`/ack`), and
    only a firing alert escalates. A kind that fires again is listed once, as firing."""
    kinds = {a.kind for a in firing}
    latched = sorted(((key, entry) for key, entry in store.resolved.items()
                      if key[0] == patient_id and key[1] not in kinds),
                     key=lambda item: (item[1]["resolved_at"], item[0][1]))
    out = []
    for key, entry in latched:
        seen = store.first_seen.get(key)
        out.append({
            **entry["alert"],
            "acknowledged": False,
            "acknowledged_by": None,
            "acknowledged_at": None,
            "first_seen_at": seen.isoformat() if seen is not None else None,
            "escalated": False,
            "resolved_at": entry["resolved_at"].isoformat(),
        })
    return out


def _bed_resolution(record: IdentityRecord | None, bedmap: BedMap | None) -> dict:
    """How the HIS location this record names lines up with a bed we know.

    Always four keys, so a consumer never branches on presence:

    * `bed_id`      our bed, or None when the table does not cover this location
    * `unit_id`     the unit that bed belongs to, as the mapping table names it. The bed map has
                    always carried it (`BedRef.unit_id`) and the board never published it, which
                    left scope — "this nurse covers this unit" — with nothing to match against:
                    no consumer could tell which unit a card was on without re-reading the table.
    * `bed_matched` False also when there is no table at all — an unwritten table and an
                    unknown bed are the same situation from the ward's point of view
    * `bed_key`     the normalised HIS location, which is exactly the line an operator adds
                    to the table. Surfacing it is what turns "this patient is not on a bed"
                    into a fixable instruction.

    The patient is never withheld for want of a match; the card still carries the HIS bed text.
    """
    if record is not None and record.bed_id:      # G2-B1a: placed by an admission here
        return _own_bed(record)
    if record is None:
        return {"bed_id": None, "unit_id": None, "bed_matched": False, "bed_key": None}
    key = normalise_key(record.unit, record.room, record.bed)
    if bedmap is None:
        return {"bed_id": None, "unit_id": None, "bed_matched": False, "bed_key": key}
    resolution = bedmap.resolve(record.unit, record.room, record.bed)
    return {
        "bed_id": resolution.ref.bed_id if resolution.ref else None,
        # Empty string and None are not the same thing here: the table may name a bed without
        # naming its unit, and that bed is then reachable by a bed grant but by no unit grant.
        "unit_id": (resolution.ref.unit_id or None) if resolution.ref else None,
        "bed_matched": resolution.matched,
        "bed_key": resolution.key,
    }


# ---------------------------------------------------------------- G2-B1a (Hasta Kabul)
def _own_bed(record: IdentityRecord) -> dict:
    """The bed an admission made HERE placed the patient in: the record's own ids — no bed map,
    nothing to match. A discharged record's ids are its last place, not its bed: it sits on no
    bed (and a `kabul` one is not on the board at all, `patient_identity.is_tombstone`)."""
    if record.state != "admitted":
        return {"bed_id": None, "unit_id": None, "bed_matched": False, "bed_key": None}
    return {"bed_id": record.bed_id, "unit_id": record.unit_id or None, "bed_matched": True,
            "bed_key": None}


def _tombstone_board(record: IdentityRecord) -> dict:
    """What a tombstone's patient is on the board: a removal. It carries the last bed and unit
    and no name, so a scoped screen of that unit is told too (`scope.sees_patient` reads them)."""
    return {**identity_only_board(record), "removed": True,
            "identity": {"bed_id": record.bed_id or None, "unit_id": record.unit_id or None}}


def identity_only_board(record: IdentityRecord, bedmap: BedMap | None = None) -> dict:
    """Admissions have a card before the first reading, without creating engine state."""
    return {
        "patient_id": record.patient_id, "risk": "none", "alerts": [],
        # Same keys as patient_board so a consumer never has to branch on which kind of card it
        # got. `news2` is None rather than a zero-score object: nothing has been measured, and a
        # card that has never had an observation must not read as "NEWS2 0".
        "latest": {
            **{key: None for key in _PUBLISHED_SIGNALS},
            "sofa": None,
            "at": {key: None for key in _PUBLISHED_SIGNALS},
            "news2": None,
        },
        "identity": {**record.as_board(), **_bed_resolution(record, bedmap)},
    }


def patient_board(engine: Engine, patient_id: str, store: AckStore,
                  identity: IdentityRecord | None = None,
                  bedmap: BedMap | None = None, now: datetime | None = None) -> dict:
    if is_tombstone(identity):                    # G2-B1a: the patient left; a removal
        return _tombstone_board(identity)
    alerts = engine.active_alerts(patient_id)
    state = engine.state(patient_id)
    # One instant for the whole card (G2-A2, D3, X2): NEWS2's freshness and the antibiotic clock
    # are judged at the wall clock unless the caller names a moment (the escalation cycle, tests).
    # Never `obs.timestamp`: that is the rule's own time at ingest, and a board judged at it would
    # never age.
    now = now or datetime.now(timezone.utc)
    return {
        "patient_id": patient_id,
        "identity": ({**identity.as_board(), **_bed_resolution(identity, bedmap)}
                     if identity is not None else None),
        # What is happening NOW (G2-A1, D10): the firing alerts only. A latched one — listed after
        # them — is a to-do, not a risk.
        "risk": _risk(alerts),
        "alerts": ([_merge_alert(patient_id, a, store) for a in alerts]
                   + _latched_alerts(patient_id, alerts, store)),
        "latest": {
            # Systolic is what NEWS2 actually scores. It was missing here, so the dashboard could
            # not compute the real score even if it wanted to, and substituted mean arterial
            # pressure with bands of its own invention.
            **{key: _latest(state, code) for key, code in _PUBLISHED_SIGNALS.items()},
            "sofa": total_sofa(state),
            # When each of the above was last measured. A value with no age cannot be told from
            # a value that stopped arriving.
            "at": _latest_at(state),
            # The engine's own NEWS2, published so there is ONE score with that name. A clinical
            # product cannot show two different numbers under one label; the dashboard reads this
            # instead of scoring again. `partial` and `missing` travel with it because a score
            # computed from four of five vitals can only understate, and saying so is the point.
            "news2": _news2(state, now),
        },
        # Outside `latest` on purpose: these are not measurements, they are the clinical context
        # a measurement is scored in.
        "sepsis": _sepsis_context(engine, state, patient_id),
        # Infusions, the antibiotic clock, and the two numbers a pharmacist reads them against.
        "meds": _meds(engine, state, patient_id, now),
    }


def board_snapshot(engine: Engine, store: AckStore,
                   identities: IdentityStore | None = None, hospital: str = "",
                   bedmap: BedMap | None = None, now: datetime | None = None) -> list[dict]:
    measured = engine.patient_ids()
    now = now or datetime.now(timezone.utc)      # every card judged at one instant (G2-A2, D3)
    boards = [patient_board(engine, pid, store,
                            identity=identities.get(hospital, pid) if identities else None,
                            bedmap=bedmap, now=now)
              for pid in measured]
    boards = [b for b in boards if not b.get("removed")]     # G2-B1a: tombstones are not shown
    if identities is not None:
        seen = set(measured)
        # Keep discharged admissions visible until the store's 24-hour retention expires.
        for pid in identities.patient_ids(hospital):
            if pid not in seen:
                record = identities.get(hospital, pid)
                if record is not None and not is_tombstone(record):      # G2-B1a
                    boards.append(identity_only_board(record, bedmap))
    return boards
