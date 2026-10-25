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


def test_prune_with_the_firing_keys_unlatches_a_refired_alert_and_keeps_only_firing_escalations():
    # G2-A1: a latched (resolved) key is live but not firing — it keeps its first-seen and loses
    # its escalation; a latched key that fires again is no longer latched.
    s = AckStore()
    latched, refired = ("bed-3", "septic_shock"), ("bed-4", "septic_shock")
    for key in (latched, refired):
        s.first_seen[key] = T0
        s.escalated.add(key)
        s.resolved[key] = {"alert": {"severity": "critical"}, "resolved_at": T0}
    s.prune(live_keys={latched, refired}, firing_keys={refired})
    assert set(s.first_seen) == {latched, refired}
    assert s.escalated == {refired}
    assert set(s.resolved) == {latched}


def test_prune_forgets_a_page_with_its_episode_and_keeps_it_while_the_alert_is_live():
    # G2-A1 final review: `paged` is scoped to the episode like first_seen. A key still on the board
    # (firing, or latched) keeps it — a flap inside one episode must not page twice — and a key that
    # left the board loses it, so the next episode can page.
    s = AckStore()
    latched, gone = ("bed-3", "septic_shock"), ("bed-4", "septic_shock")
    s.paged |= {latched, gone}
    s.prune(live_keys={latched}, firing_keys=set())
    assert s.paged == {latched}
    s.prune(live_keys=set())
    assert s.paged == set()
