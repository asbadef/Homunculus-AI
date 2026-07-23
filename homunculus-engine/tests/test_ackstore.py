# tests/test_ackstore.py
from datetime import datetime, timezone

from homunculus.api.ackstore import AckStore

T0 = datetime(2026, 7, 19, 10, 0, tzinfo=timezone.utc)


def test_first_seen_is_stamped_once():
    s = AckStore()
    s.stamp_first_seen("bed-3", "septic_shock", T0)
    s.stamp_first_seen("bed-3", "septic_shock", T0.replace(minute=5))  # ignored
    assert s.first_seen[("bed-3", "septic_shock")] == T0


def test_acknowledge_records_role_and_time():
    s = AckStore()
    s.acknowledge("bed-3", "septic_shock", "nurse", T0)
    assert s.acks[("bed-3", "septic_shock")] == {"by": "nurse", "at": T0}


def test_prune_drops_entries_no_longer_live():
    s = AckStore()
    s.stamp_first_seen("bed-3", "septic_shock", T0)
    s.acknowledge("bed-3", "septic_shock", "nurse", T0)
    s.escalated.add(("bed-3", "septic_shock"))
    s.prune(live_keys=set())
    assert s.first_seen == {} and s.acks == {} and s.escalated == set()
