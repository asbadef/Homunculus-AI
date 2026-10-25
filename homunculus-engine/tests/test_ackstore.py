# tests/test_ackstore.py
from datetime import datetime, timedelta, timezone

from homunculus.api.ackstore import AckStore, Chain

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


# --- G2-A1, X13: the escalation chain ------------------------------------------------------------
#
# Consecutive episodes of one (patient, kind) whose gap — from the clear to the next first sight —
# is at most the escalation delay share one escalation clock and one page to the doctor.

GAP = timedelta(minutes=5)
NEWS2 = ("bed-3", "news2")


def _minutes(m):
    return T0 + timedelta(minutes=m)


def test_a_first_stamp_starts_the_escalation_chain_at_the_first_sight():
    s = AckStore()
    assert s.stamp_first_seen("bed-3", "news2", T0, chain_gap=GAP) is True
    assert s.first_seen[NEWS2] == s.clock_from[NEWS2] == T0
    assert s.stamp_first_seen("bed-3", "news2", _minutes(1), chain_gap=GAP) is False
    assert s.clock_from[NEWS2] == T0


def test_a_cleared_episode_is_remembered_as_its_chain_and_its_state_is_pruned():
    s = AckStore()
    s.stamp_first_seen("bed-3", "news2", T0, chain_gap=GAP)
    s.paged.add(NEWS2)
    s.prune(live_keys=set(), firing_keys=set(), now=_minutes(2))
    assert NEWS2 not in s.first_seen and NEWS2 not in s.clock_from and NEWS2 not in s.paged
    assert s.recent[NEWS2] == Chain(clock_from=T0, cleared_at=_minutes(2), paged=True)


def test_an_acknowledged_episode_that_leaves_the_board_leaves_no_chain():
    # X13 review: an answer ends the chain. Only an episode that ended unanswered is remembered.
    s = AckStore()
    s.stamp_first_seen("bed-3", "news2", T0, chain_gap=GAP)
    s.paged.add(NEWS2)
    s.acknowledge("bed-3", "news2", "nurse", _minutes(1))
    s.prune(live_keys=set(), firing_keys=set(), now=_minutes(2))
    assert s.recent == {}
    assert NEWS2 not in s.acks and NEWS2 not in s.clock_from and NEWS2 not in s.paged
    s.stamp_first_seen("bed-3", "news2", _minutes(3), chain_gap=GAP)
    assert s.clock_from[NEWS2] == _minutes(3) and NEWS2 not in s.paged


def test_a_live_key_keeps_its_chain_clock_and_is_not_remembered():
    s = AckStore()
    s.stamp_first_seen("bed-3", "news2", T0, chain_gap=GAP)
    s.prune(live_keys={NEWS2}, firing_keys=set(), now=_minutes(2))   # latched: still on the board
    assert s.clock_from[NEWS2] == T0 and s.recent == {}


def test_an_episode_that_returns_within_the_gap_continues_its_chain_and_its_page():
    s = AckStore()
    s.stamp_first_seen("bed-3", "news2", T0, chain_gap=GAP)
    s.paged.add(NEWS2)
    s.prune(live_keys=set(), firing_keys=set(), now=_minutes(2))
    assert s.stamp_first_seen("bed-3", "news2", _minutes(7), chain_gap=GAP) is True   # a gap of exactly 5
    assert s.first_seen[NEWS2] == _minutes(7), "a new episode: its own first sight"
    assert s.clock_from[NEWS2] == T0, "the chain's escalation clock goes on"
    assert NEWS2 in s.paged, "the doctor was paged for this chain already"
    assert s.recent == {}


def test_a_return_after_more_than_the_gap_starts_a_new_chain():
    s = AckStore()
    s.stamp_first_seen("bed-3", "news2", T0, chain_gap=GAP)
    s.paged.add(NEWS2)
    s.prune(live_keys=set(), firing_keys=set(), now=_minutes(2))
    late = _minutes(7) + timedelta(seconds=1)
    s.stamp_first_seen("bed-3", "news2", late, chain_gap=GAP)
    assert s.clock_from[NEWS2] == late and NEWS2 not in s.paged and s.recent == {}


def test_a_remembered_chain_is_forgotten_once_its_gap_has_passed():
    s = AckStore()
    s.stamp_first_seen("bed-3", "news2", T0, chain_gap=GAP)
    s.prune(live_keys=set(), firing_keys=set(), now=_minutes(1))
    s.stamp_first_seen("bed-4", "news2", _minutes(5), chain_gap=GAP)    # 4 min after the clear
    assert NEWS2 in s.recent
    s.stamp_first_seen("bed-5", "news2", _minutes(7), chain_gap=GAP)    # 6 min after it
    assert NEWS2 not in s.recent, "past the gap: dropped on the next stamp, not kept forever"


def test_without_a_gap_or_a_clear_time_every_episode_has_its_own_clock():
    """The pre-X13 calls: a prune that is not told when it ran remembers nothing, and a stamp that is
    not told the gap continues no chain."""
    s = AckStore()
    s.stamp_first_seen("bed-3", "news2", T0)
    s.prune(live_keys=set())
    assert s.recent == {} and s.clock_from == {}
    s.stamp_first_seen("bed-3", "news2", _minutes(1), chain_gap=GAP)
    s.prune(live_keys=set(), now=_minutes(2))
    s.stamp_first_seen("bed-3", "news2", _minutes(3))
    assert s.clock_from[NEWS2] == _minutes(3)
