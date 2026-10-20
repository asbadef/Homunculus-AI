"""The patient's own normal, and what happens when it is there.

`rules/patient_relative.py` was written, tested, and never once ran on a real patient: nothing
outside the test suite called `Engine.set_profile`. So every patient was scored against the
population threshold, and the clinician's own example — chronic atrial fibrillation living at
105 bpm — alarmed on every single measurement. That is the alarm fatigue the layer exists to
prevent, and it was switched off for want of a door.

These tests hold the door open, and hold shut the two ways it could quietly close again: a
restart forgetting the profile, and a boundary the system invented rather than a clinician
charting it.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.clinical import profile_from_payload, profile_to_payload
from homunculus.canonical import SignalCode

TOKEN = "tok"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
WHEN = datetime(2026, 9, 8, 9, 0, tzinfo=timezone.utc)

# A patient whose atrial fibrillation lives at 100–115. On the population scale a pulse of 108
# scores 1 and a pulse of 132 scores 3; for this person the first is Tuesday.
CHRONIC_AF = {"comorbidities": ["chronic_af"],
              "baselines": {"heart_rate": {"low": 100, "high": 115}}}


@pytest.fixture()
def client():
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False)
    with TestClient(app) as c:
        yield c


def _observe(client, patient_id: str, code: str, value: float, at: datetime = WHEN):
    """Chart a value through the clinical door (the only writable one in a test)."""
    return client.post(f"/clinical/{patient_id}",
                       json={"entries": [{"code": code, "value": value}],
                             "recorded_at": at.isoformat()}, headers=AUTH)


def _profile(client, patient_id: str, body: dict):
    return client.put(f"/clinical/{patient_id}/profile", json=body, headers=AUTH)


class TestTheDoorOpens:
    def test_a_profile_is_accepted_and_echoed_back(self, client):
        r = _profile(client, "bed-3", CHRONIC_AF)
        assert r.status_code == 200
        assert r.json()["comorbidities"] == ["chronic_af"]
        assert r.json()["baselines"]["heart_rate"] == {"low": 100.0, "high": 115.0}

    def test_it_is_audited_with_who_charted_it(self, client):
        _profile(client, "bed-3", CHRONIC_AF)
        records = client.get("/audit", headers=AUTH).json()["records"]
        rows = [r for r in records if r["event_type"] == "profile"]
        assert rows and rows[0]["payload"]["charted_by"] == "tenant-token"

    def test_comorbidities_alone_are_enough(self, client):
        assert _profile(client, "bed-3", {"comorbidities": ["copd"]}).status_code == 200

    def test_free_text_the_rules_cannot_act_on_is_still_recorded(self, client):
        """The admission form takes "DM, HT, KOAH". Only some of that maps to a rule; dropping
        the rest would discard what a clinician took the trouble to write."""
        r = _profile(client, "bed-3", {"comorbidities": ["DM", "HT", " Kronik AF "]})
        assert r.json()["comorbidities"] == ["dm", "ht", "kronik_af"]


class TestItActuallyQuietensTheChronicPatient:
    """The reason the layer exists."""

    def test_without_a_profile_a_chronic_af_pulse_is_scored_like_anyone_elses(self, client):
        _observe(client, "bed-3", "gcs", 15)          # create the patient
        board = client.get("/patients", headers=AUTH).json()["patients"][0]
        assert board["latest"]["news2"] is not None

    def test_with_a_profile_the_engine_holds_it(self, client):
        _observe(client, "bed-3", "gcs", 15)
        _profile(client, "bed-3", CHRONIC_AF)
        # The board still publishes; the profile's effect is on alert severity, which the
        # patient-relative layer applies inside the engine.
        assert client.get("/patients", headers=AUTH).json()["patients"][0]["patient_id"] == "bed-3"

    def test_a_baseline_for_a_vital_we_do_not_track_is_refused_by_name(self, client):
        r = _profile(client, "bed-3", {"baselines": {"lactate": {"low": 1, "high": 2}}})
        assert r.status_code == 400
        assert "heart_rate" in r.json()["detail"]   # the message lists what IS kept


class TestBoundariesAreCharted_NotInvented:
    def test_an_inverted_range_is_refused_rather_than_silently_swapped(self):
        """Swapping them would hide a typo behind a range that looks deliberate, and the layer
        would then downgrade on a boundary nobody chose."""
        with pytest.raises(Exception, match="alt sınır"):
            profile_from_payload("bed-3", {"baselines": {"heart_rate": {"low": 115, "high": 100}}})

    def test_a_non_numeric_bound_is_refused(self):
        with pytest.raises(Exception, match="sayı olmalı"):
            profile_from_payload("bed-3", {"baselines": {"heart_rate": {"low": "hızlı", "high": 115}}})

    def test_an_empty_profile_is_refused_rather_than_stored_as_nothing(self):
        with pytest.raises(Exception, match="boş olamaz"):
            profile_from_payload("bed-3", {})

    def test_the_round_trip_is_lossless(self):
        profile = profile_from_payload("bed-3", CHRONIC_AF)
        assert profile_to_payload(profile) == {
            "comorbidities": ["chronic_af"],
            "baselines": {"heart_rate": {"low": 100.0, "high": 115.0}},
            # Carried explicitly even when unset: the audit replay reads this payload back, and a
            # key that vanishes when it is None cannot be told from a key nobody ever wrote.
            "baseline_sofa": None,
        }
        assert profile.baselines[SignalCode.HEART_RATE].contains(108) is True
        assert profile.baselines[SignalCode.HEART_RATE].contains(132) is False


class TestARestartDoesNotForget:
    """A profile a deploy lost would restart the alarms it was written to quieten, quietly."""

    def test_a_charted_profile_survives_a_restart(self, client):
        _profile(client, "bed-3", CHRONIC_AF)
        records = client.get("/audit", headers=AUTH).json()["records"]

        from homunculus.api.ackstore import AckStore
        from homunculus.api.audit import AuditRecord
        from homunculus.api.rehydrate import rehydrate
        from homunculus.pipeline import Engine

        fresh = Engine()
        rehydrate(fresh, AckStore(), [AuditRecord(**r) for r in records])
        restored = fresh._profiles.get("bed-3")
        assert restored is not None
        assert restored.comorbidities == frozenset({"chronic_af"})
        assert restored.baselines[SignalCode.HEART_RATE].high == 115.0

    def test_a_charted_clinical_fact_survives_a_restart_too(self, client):
        """The bug this closes: `rehydrate` replayed `ingest` and not `chart`, so a charted
        suspected_infection would vanish on restart and take the sepsis branch with it."""
        _observe(client, "bed-3", "suspected_infection", 1)
        _observe(client, "bed-3", "platelets", 80)
        records = client.get("/audit", headers=AUTH).json()["records"]

        from homunculus.api.ackstore import AckStore
        from homunculus.api.audit import AuditRecord
        from homunculus.api.rehydrate import rehydrate
        from homunculus.pipeline import Engine

        fresh = Engine()
        rehydrate(fresh, AckStore(), [AuditRecord(**r) for r in records])
        state = fresh.state("bed-3")
        assert state.latest(SignalCode.SUSPECTED_INFECTION).value == 1.0
        assert {a.kind for a in fresh.active_alerts("bed-3")} & {"sepsis"}

    def test_an_unreadable_profile_record_does_not_fail_the_whole_replay(self):
        from homunculus.api.ackstore import AckStore
        from homunculus.api.audit import AuditRecord
        from homunculus.api.rehydrate import rehydrate
        from homunculus.pipeline import Engine

        bad = AuditRecord(id=1, ts=WHEN.isoformat(), tenant="h1", event_type="profile",
                          patient_id="bed-3", subject="", payload={"baselines": "nonsense"})
        fresh = Engine()
        rehydrate(fresh, AckStore(), [bad])   # must not raise
        assert fresh._profiles == {}


# --- Baseline SOFA: the number that raises the sepsis bar (K1) -----------------------------------
# A charted baseline SOFA makes the sepsis alert harder to trigger. That is the whole point — and
# it is also why it has to be validated hard and survive a restart: an over-stated baseline
# silences the alert on a patient who is genuinely deteriorating.

def test_baseline_sofa_round_trips_through_the_payload():
    prof = profile_from_payload("bed-9", {"baseline_sofa": 3})
    assert prof.baseline_sofa == 3
    assert profile_to_payload(prof)["baseline_sofa"] == 3


def test_baseline_sofa_alone_is_a_valid_profile():
    """A patient may have a chronic organ baseline without any charted vital range."""
    prof = profile_from_payload("bed-9", {"baseline_sofa": 2})
    assert prof.comorbidities == frozenset() and prof.baselines == {}


def test_profile_with_nothing_at_all_is_still_rejected():
    with pytest.raises(Exception) as exc:
        profile_from_payload("bed-9", {})
    assert "bazal SOFA" in str(exc.value)


def test_absent_baseline_sofa_is_none_not_zero():
    """None means 'nobody charted one' and Sepsis-3's assumption applies. Zero means a clinician
    asserted this patient has no preexisting organ dysfunction. The rule says the same thing
    either way today, but conflating them would lose the clinician's assertion."""
    prof = profile_from_payload("bed-9", CHRONIC_AF)
    assert prof.baseline_sofa is None
    assert profile_from_payload("bed-9", {"baseline_sofa": 0}).baseline_sofa == 0


@pytest.mark.parametrize("bad", [-1, 25, 2.5, "abc", True])
def test_implausible_baseline_sofa_is_refused(bad):
    with pytest.raises(Exception):
        profile_from_payload("bed-9", {"baseline_sofa": bad})


def test_baseline_sofa_survives_the_api_and_reaches_the_rule(client):
    """The whole chain: PUT the profile, chart a chronic creatinine, suspect infection — and the
    sepsis alert must NOT fire, because the organ dysfunction is this patient's baseline."""
    r = client.put("/clinical/bed-9/profile", json={"baseline_sofa": 3}, headers=AUTH)
    assert r.status_code == 200, r.text
    _observe(client, "bed-9", "creatinine", 3.5)
    r = _observe(client, "bed-9", "suspected_infection", 1.0)
    assert r.status_code == 200, r.text
    kinds = {a["kind"] for a in r.json().get("alerts", [])}
    assert "sepsis" not in kinds, f"chronic baseline should absorb this; got {kinds}"


# --- The profile door is shared, so writing to it must not erase the other writer -----------------

def test_charting_a_baseline_sofa_does_not_erase_comorbidities(client):
    """The admission form sends comorbidities; the sepsis panel sends a baseline SOFA. Under
    replace semantics whichever was used second silently wiped the first — and nothing on any
    screen would have shown that a charted chronic condition had disappeared."""
    r = client.put("/clinical/bed-7/profile", json=CHRONIC_AF, headers=AUTH)
    assert r.status_code == 200, r.text

    r = client.put("/clinical/bed-7/profile", json={"baseline_sofa": 2}, headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["baseline_sofa"] == 2
    assert body["comorbidities"] == ["chronic_af"]
    assert body["baselines"]["heart_rate"] == {"low": 100.0, "high": 115.0}


def test_charting_comorbidities_does_not_erase_a_baseline_sofa(client):
    client.put("/clinical/bed-7/profile", json={"baseline_sofa": 2}, headers=AUTH)
    r = client.put("/clinical/bed-7/profile", json={"comorbidities": ["ckd"]}, headers=AUTH)
    assert r.json()["baseline_sofa"] == 2


def test_an_explicitly_empty_list_still_clears(client):
    """Absent means 'unchanged'; empty means a clinician cleared it. The two must stay distinct,
    or a physician could never remove something charted in error."""
    client.put("/clinical/bed-7/profile", json=CHRONIC_AF, headers=AUTH)
    r = client.put("/clinical/bed-7/profile",
                   json={"comorbidities": [], "baseline_sofa": 1}, headers=AUTH)
    assert r.json()["comorbidities"] == []


# --- Clearing the patient's own normal (G2 slice 1, O4) -------------------------------------------
# The trend screen's form writes the whole baseline set. A range charted in error keeps quietening
# this patient's alarms until someone takes it away — so it must be removable even when it is the
# last thing charted: `{"baselines": {}}` over a charted profile clears every range. From nothing
# there is nothing to clear, and an empty profile is still refused.

BASELINES_ONLY = {"baselines": {"heart_rate": {"low": 125, "high": 140}}}


def test_an_empty_baseline_set_over_a_charted_profile_clears_every_range():
    base = profile_from_payload("bed-7", BASELINES_ONLY)
    cleared = profile_from_payload("bed-7", {"baselines": {}}, base)
    assert cleared.baselines == {}
    assert cleared.comorbidities == frozenset() and cleared.baseline_sofa is None


def test_clearing_the_ranges_keeps_the_comorbidities_and_the_baseline_sofa():
    base = profile_from_payload("bed-7", {**CHRONIC_AF, "baseline_sofa": 2})
    cleared = profile_from_payload("bed-7", {"baselines": {}}, base)
    assert cleared.baselines == {}
    assert cleared.comorbidities == frozenset({"chronic_af"})
    assert cleared.baseline_sofa == 2


def test_from_nothing_an_empty_baseline_set_is_still_refused():
    with pytest.raises(Exception, match="boş olamaz"):
        profile_from_payload("bed-7", {"baselines": {}})


def test_without_a_baselines_key_a_payload_still_cannot_empty_a_profile():
    base = profile_from_payload("bed-7", {"comorbidities": ["copd"]})
    with pytest.raises(Exception, match="boş olamaz"):
        profile_from_payload("bed-7", {"comorbidities": []}, base)


def test_the_door_clears_the_last_range_and_audits_it(client):
    assert _profile(client, "bed-7", BASELINES_ONLY).status_code == 200
    r = _profile(client, "bed-7", {"baselines": {}})
    assert r.status_code == 200, r.text
    assert r.json() == {"patient_id": "bed-7", "comorbidities": [], "baselines": {}, "baseline_sofa": None}
    rows = [x for x in client.get("/audit", headers=AUTH).json()["records"] if x["event_type"] == "profile"]
    assert [row["payload"]["baselines"] for row in rows] == [{"heart_rate": {"low": 125.0, "high": 140.0}}, {}]
    assert rows[-1]["payload"]["charted_by"] == "tenant-token"


def test_once_cleared_the_next_pulse_is_judged_like_anyone_elses():
    """The point of clearing: the range stops quietening the alarm. The PUT itself re-scores
    nothing — the alerts standing are the last reading's — so it is the NEXT reading that the
    engine judges without the range."""
    from datetime import timedelta
    from homunculus.canonical import Observation
    from homunculus.pipeline import Engine

    engine = Engine()
    engine.set_profile(profile_from_payload("bed-7", BASELINES_ONLY))
    first = Observation("bed-7", SignalCode.HEART_RATE, 132, "/min", WHEN, "dev")
    assert {a.kind: a for a in engine.ingest(first, now=WHEN)}["news2"].downgraded is True

    engine.set_profile(profile_from_payload("bed-7", {"baselines": {}}, engine.profile("bed-7")))
    later = WHEN + timedelta(minutes=5)
    second = Observation("bed-7", SignalCode.HEART_RATE, 132, "/min", later, "dev")
    news2 = {a.kind: a for a in engine.ingest(second, now=later)}["news2"]
    assert news2.downgraded is False
    assert news2.urgency == "soon"


def test_a_cleared_set_stays_cleared_after_a_restart(client):
    """The replay reads the profile rows in order. The clearing row is an empty profile: read
    from nothing it would be refused and skipped — and the range the clinician removed would
    come back with the next deploy, quietening alarms nobody asked to quieten."""
    from homunculus.api.ackstore import AckStore
    from homunculus.api.audit import AuditRecord
    from homunculus.api.rehydrate import rehydrate
    from homunculus.pipeline import Engine

    _profile(client, "bed-7", BASELINES_ONLY)
    assert _profile(client, "bed-7", {"baselines": {}}).status_code == 200
    records = client.get("/audit", headers=AUTH).json()["records"]
    fresh = Engine()
    rehydrate(fresh, AckStore(), [AuditRecord(**r) for r in records])
    assert fresh.profile("bed-7") is not None
    assert fresh.profile("bed-7").baselines == {}


@pytest.mark.parametrize("bad", ["nan", "inf", "-inf", float("nan"), float("inf")])
def test_a_bound_that_is_not_a_finite_number_is_refused(bad):
    """float() reads "nan" and "inf", and `low > high` is False with a NaN — so a NaN bound slipped
    past both checks, reached every trends read for this patient (JSON refuses NaN: a 500) and came
    back with every replay of the audit. Refused as `_value` refuses a charted one."""
    with pytest.raises(Exception, match="geçersiz sayı"):
        profile_from_payload("bed-7", {"baselines": {"heart_rate": {"low": bad, "high": 115}}})
    with pytest.raises(Exception, match="geçersiz sayı"):
        profile_from_payload("bed-7", {"baselines": {"heart_rate": {"low": 100, "high": bad}}})


@pytest.mark.parametrize("side", ["low", "high"])
@pytest.mark.parametrize("bad", [True, False])
def test_a_boolean_bound_is_refused(side, bad):
    """A bool is an int in Python, so `{"low": true, "high": 140}` charted a 1–140 range nobody
    typed — inside which the patient-relative layer would downgrade heart-rate findings. Refused as
    `_baseline_sofa` refuses a bool."""
    span = {"low": 100, "high": 140, side: bad}
    with pytest.raises(Exception, match="low ve high sayı olmalı"):
        profile_from_payload("bed-7", {"baselines": {"heart_rate": span}})


def test_the_door_refuses_a_boolean_bound_and_charts_nothing(client):
    r = _profile(client, "bed-7", {"baselines": {"heart_rate": {"low": True, "high": 140}}})
    assert r.status_code == 400
    assert "sayı olmalı" in r.json()["detail"]
    rows = [x for x in client.get("/audit", headers=AUTH).json()["records"] if x["event_type"] == "profile"]
    assert rows == []


def test_clearing_the_ranges_and_the_comorbidities_together_may_empty_the_profile():
    """The clear is explicit, and nothing says it may not be the whole profile: a COPD-only profile
    with no range, sent `comorbidities: []` and `baselines: {}`, is accepted and comes out empty."""
    base = profile_from_payload("bed-7", {"comorbidities": ["copd"]})
    emptied = profile_from_payload("bed-7", {"comorbidities": [], "baselines": {}}, base)
    assert emptied.comorbidities == frozenset()
    assert emptied.baselines == {}
    assert emptied.baseline_sofa is None


def test_clearing_a_profile_that_has_no_ranges_is_accepted_and_changes_nothing(client):
    """A repeated PUT is idempotent: the result is the same, and each PUT is one more audit row."""
    assert _profile(client, "bed-7", {"comorbidities": ["copd"]}).status_code == 200
    first = _profile(client, "bed-7", {"baselines": {}})
    second = _profile(client, "bed-7", {"baselines": {}})
    assert first.status_code == second.status_code == 200
    expected = {"patient_id": "bed-7", "comorbidities": ["copd"], "baselines": {}, "baseline_sofa": None}
    assert first.json() == second.json() == expected
    rows = [x for x in client.get("/audit", headers=AUTH).json()["records"] if x["event_type"] == "profile"]
    assert [row["payload"]["comorbidities"] for row in rows] == [["copd"], ["copd"], ["copd"]]
    assert [row["payload"]["baselines"] for row in rows] == [{}, {}, {}]


def test_a_null_baseline_set_over_a_charted_profile_clears_like_an_empty_one():
    """The contract is: an absent `baselines` key keeps the ranges, a null or empty one clears them
    (the merge already read null as empty, so it cleared whenever anything else was charted — and was
    refused as 'empty' only when the ranges were the last thing charted)."""
    base = profile_from_payload("bed-7", BASELINES_ONLY)
    cleared = profile_from_payload("bed-7", {"baselines": None}, base)
    assert cleared.baselines == {}
    assert cleared.comorbidities == frozenset() and cleared.baseline_sofa is None


def test_from_nothing_a_null_baseline_set_is_still_refused():
    with pytest.raises(Exception, match="boş olamaz"):
        profile_from_payload("bed-7", {"baselines": None})


def test_the_door_reads_a_null_baseline_set_as_a_clear(client):
    assert _profile(client, "bed-7", BASELINES_ONLY).status_code == 200
    r = _profile(client, "bed-7", {"baselines": None})
    assert r.status_code == 200, r.text
    assert r.json() == {"patient_id": "bed-7", "comorbidities": [], "baselines": {}, "baseline_sofa": None}


# Only null and {} clear. A clinical range must not be taken away by junk: any other value that is
# not an object — `[]`, `""`, `0`, `false` — used to read as "empty" through `or {}`, and so cleared.

@pytest.mark.parametrize("junk", [[], "", 0, False])
def test_a_baseline_set_that_is_not_an_object_is_refused_and_clears_nothing(junk):
    base = profile_from_payload("bed-7", {**CHRONIC_AF, "baseline_sofa": 2})
    with pytest.raises(Exception, match="baselines bir nesne olmalı"):
        profile_from_payload("bed-7", {"baselines": junk}, base)
    with pytest.raises(Exception, match="baselines bir nesne olmalı"):
        profile_from_payload("bed-7", {"baselines": junk})


@pytest.mark.parametrize("empty", [None, {}])
def test_null_and_an_empty_object_still_clear(empty):
    base = profile_from_payload("bed-7", BASELINES_ONLY)
    assert profile_from_payload("bed-7", {"baselines": empty}, base).baselines == {}


def test_the_door_refuses_a_baseline_set_that_is_not_an_object_and_keeps_the_ranges(client):
    assert _profile(client, "bed-7", BASELINES_ONLY).status_code == 200
    r = _profile(client, "bed-7", {"baselines": []})
    assert r.status_code == 400
    assert "baselines bir nesne olmalı" in r.json()["detail"]
    rows = [x for x in client.get("/audit", headers=AUTH).json()["records"] if x["event_type"] == "profile"]
    assert [row["payload"]["baselines"] for row in rows] == [{"heart_rate": {"low": 125.0, "high": 140.0}}]
