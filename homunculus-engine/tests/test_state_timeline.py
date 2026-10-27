# tests/test_state_timeline.py
from datetime import datetime, timezone, timedelta
from homunculus.canonical import Observation, SignalCode
from homunculus.state.timeline import PatientState

T0 = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)


def _obs(code, value, minutes=0):
    return Observation("bed-3", code, value, "u", T0 + timedelta(minutes=minutes), "dev")


def test_latest_returns_most_recent_value():
    st = PatientState("bed-3")
    st.ingest(_obs(SignalCode.MAP, 70, minutes=0))
    st.ingest(_obs(SignalCode.MAP, 62, minutes=5))
    assert st.latest(SignalCode.MAP).value == 62


def test_latest_is_none_when_never_seen():
    st = PatientState("bed-3")
    assert st.latest(SignalCode.LACTATE) is None


def test_age_reports_staleness_against_a_reference_time():
    st = PatientState("bed-3")
    st.ingest(_obs(SignalCode.LACTATE, 3.1, minutes=0))
    now = T0 + timedelta(hours=4)
    assert st.age(SignalCode.LACTATE, now) == timedelta(hours=4)


def test_age_is_none_when_never_seen():
    st = PatientState("bed-3")
    assert st.age(SignalCode.LACTATE, T0) is None


def test_history_preserves_order():
    st = PatientState("bed-3")
    st.ingest(_obs(SignalCode.NOREPINEPHRINE_RATE, 0.05, minutes=0))
    st.ingest(_obs(SignalCode.NOREPINEPHRINE_RATE, 0.10, minutes=30))
    st.ingest(_obs(SignalCode.NOREPINEPHRINE_RATE, 0.20, minutes=60))
    values = [o.value for o in st.history(SignalCode.NOREPINEPHRINE_RATE)]
    assert values == [0.05, 0.10, 0.20]


def test_ingest_orders_by_stamp_and_an_equal_stamp_goes_after_the_ones_already_held():
    # Pinned against the old append + stable sort (Aşama B re-review: ingest is now a binary
    # insertion): out-of-order arrivals take their place by timestamp, and a reading stamped like
    # one already held goes after it — so `latest()` is the last of equal stamps to arrive.
    st = PatientState("bed-3")
    arrivals = [(70, 10), (60, 0), (65, 5), (66, 5), (71, 10), (55, -5), (67, 5), (80, 20), (61, 0)]
    for value, minutes in arrivals:
        st.ingest(_obs(SignalCode.MAP, value, minutes=minutes))
    assert [o.value for o in st.history(SignalCode.MAP)] == [55, 60, 61, 65, 66, 67, 70, 71, 80]
    assert st.latest(SignalCode.MAP).value == 80
    st.ingest(_obs(SignalCode.MAP, 81, minutes=20))
    assert st.latest(SignalCode.MAP).value == 81


def test_sum_since_adds_values_within_window():
    st = PatientState("bed-3")
    st.ingest(_obs(SignalCode.CRYSTALLOID_BOLUS_ML, 500, minutes=0))
    st.ingest(_obs(SignalCode.CRYSTALLOID_BOLUS_ML, 1000, minutes=30))
    st.ingest(_obs(SignalCode.CRYSTALLOID_BOLUS_ML, 1000, minutes=90))
    now = T0 + timedelta(minutes=120)
    # last 3 hours: all three -> 2500
    assert st.sum_since(SignalCode.CRYSTALLOID_BOLUS_ML, now - timedelta(hours=3)) == 2500
    # last 60 min: only the 90-min one is within [60min, 120min] -> 1000
    assert st.sum_since(SignalCode.CRYSTALLOID_BOLUS_ML, now - timedelta(minutes=60)) == 1000


# append to tests/test_state_timeline.py
from homunculus.state.repository import InMemoryPatientRepository


def test_repository_creates_state_on_first_access():
    repo = InMemoryPatientRepository()
    st = repo.get_or_create("bed-9")
    assert st.patient_id == "bed-9"
    # same object on second access
    assert repo.get_or_create("bed-9") is st


def test_repository_lists_known_patients():
    repo = InMemoryPatientRepository()
    repo.get_or_create("bed-1")
    repo.get_or_create("bed-2")
    assert set(repo.patient_ids()) == {"bed-1", "bed-2"}
