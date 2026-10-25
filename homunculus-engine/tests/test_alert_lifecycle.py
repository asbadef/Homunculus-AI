# tests/test_alert_lifecycle.py
"""G2-A1 (O17): what happens to an alert when its rule stops firing (api/alert_lifecycle.py).

A critical alert nobody acknowledged latches until someone does; every other alert, and an
acknowledged critical, leaves with its rule and takes its episode's state with it. Synthetic beds
and made-up values only (CLAUDE.md rule 6)."""
from datetime import datetime, timedelta, timezone

from homunculus.api.ackstore import AckStore, Chain
from homunculus.api.alert_lifecycle import (
    ACKED_AFTER_RESOLVE, RESOLVED, Cleared, acknowledge_latched, live_keys, sync_alerts,
)
from homunculus.api.notify import Notifier
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine

T0 = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)      # the readings' own time
WALL = datetime(2026, 10, 25, 9, 0, tzinfo=timezone.utc)    # the API's wall clock
SHOCK_KEY = ("bed-3", "septic_shock")

# Suspected infection, 100 kg, 30 mL/kg given, MAP 60 on noradrenaline 0.12, lactate 3.1: septic
# shock (CRITICAL), sepsis (HIGH) and the antibiotic clock (antibiotic_due, HIGH).
SHOCK = [(SignalCode.SUSPECTED_INFECTION, 1.0), (SignalCode.WEIGHT_KG, 100),
         (SignalCode.CRYSTALLOID_BOLUS_ML, 3000), (SignalCode.MAP, 60),
         (SignalCode.NOREPINEPHRINE_RATE, 0.12), (SignalCode.LACTATE, 3.1)]


def _evaluate(engine, store, code, value, minute, patient="bed-3"):
    """One reading through the engine and the hook, as the doors run them."""
    o = Observation(patient, code, value, "u", T0 + timedelta(minutes=minute), "dev")
    engine.ingest(o, now=o.timestamp)
    return sync_alerts(engine, store, patient, WALL + timedelta(minutes=minute))


def _stamp(engine, store, minute=0, patient="bed-3"):
    """What the doors do after the hook: a first-seen stamp for every firing kind."""
    for a in engine.active_alerts(patient):
        store.stamp_first_seen(patient, a.kind, WALL + timedelta(minutes=minute))


def _shock():
    engine, store = Engine(), AckStore()
    for code, value in SHOCK:
        assert _evaluate(engine, store, code, value, minute=0) == []
    _stamp(engine, store)
    assert {a.kind for a in engine.active_alerts("bed-3")} == {"septic_shock", "sepsis", "antibiotic_due"}
    return engine, store


def test_a_critical_alert_nobody_acknowledged_latches_when_its_rule_stops():
    engine, store = _shock()
    cleared = _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)    # lactate back under 2
    assert cleared == [Cleared("bed-3", "septic_shock", "critical", WALL, RESOLVED)]
    assert "septic_shock" not in {a.kind for a in engine.active_alerts("bed-3")}
    latched = store.resolved[SHOCK_KEY]
    assert latched["resolved_at"] == WALL + timedelta(minutes=1)
    assert latched["alert"]["summary"] == "Septic shock criteria met"
    assert SHOCK_KEY in live_keys(engine, store), "still on the board, as resolved and unacknowledged"
    assert store.first_seen[SHOCK_KEY] == WALL, "the latch keeps its episode's first-seen"


def test_high_alerts_do_not_latch_and_their_episode_state_is_pruned():
    engine, store = _shock()
    store.acknowledge("bed-3", "sepsis", "ayse", WALL)
    store.escalated.add(("bed-3", "antibiotic_due"))
    cleared = _evaluate(engine, store, SignalCode.SUSPECTED_INFECTION, 0.0, minute=2)  # "no infection"
    assert {(c.kind, c.severity, c.reason) for c in cleared} == {
        ("septic_shock", "critical", RESOLVED), ("sepsis", "high", RESOLVED),
        ("antibiotic_due", "high", RESOLVED)}
    assert set(store.resolved) == {SHOCK_KEY}, "only the unacknowledged critical latches"
    assert store.acks == {} and store.escalated == set()
    assert set(store.first_seen) == {SHOCK_KEY}


def test_a_moderate_alert_leaves_on_the_first_normal_reading():
    engine, store = Engine(), AckStore()
    _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=0)
    _stamp(engine, store)
    cleared = _evaluate(engine, store, SignalCode.HEART_RATE, 80, minute=1)
    assert cleared == [Cleared("bed-3", "news2", "moderate", WALL, RESOLVED)]
    assert store.resolved == {} and store.first_seen == {} and live_keys(engine, store) == set()


def test_an_acknowledged_critical_leaves_with_its_rule():
    engine, store = _shock()
    store.acknowledge("bed-3", "septic_shock", "ayse", WALL + timedelta(seconds=30))
    cleared = _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)
    assert cleared == [Cleared("bed-3", "septic_shock", "critical", WALL, RESOLVED)]
    assert store.resolved == {}
    assert SHOCK_KEY not in store.acks and SHOCK_KEY not in store.first_seen
    assert SHOCK_KEY not in live_keys(engine, store)


def test_acknowledging_a_latched_alert_removes_it_and_ends_its_episode():
    engine, store = _shock()
    store.escalated.add(SHOCK_KEY)
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)
    assert SHOCK_KEY not in store.escalated, "a latched alert is no longer escalated (D8)"
    assert acknowledge_latched(store, "bed-3", "septic_shock") == Cleared(
        "bed-3", "septic_shock", "critical", WALL, ACKED_AFTER_RESOLVE)
    assert store.resolved == {} and SHOCK_KEY not in store.first_seen
    assert SHOCK_KEY not in live_keys(engine, store)
    assert acknowledge_latched(store, "bed-3", "septic_shock") is None, "gone: nothing to remove twice"
    assert acknowledge_latched(store, "bed-3", "sepsis") is None, "a firing alert is not latched"


def test_a_kind_that_fires_again_after_clearing_is_a_new_episode():
    engine, store = Engine(), AckStore()
    _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=0)
    _stamp(engine, store, minute=0)
    store.acknowledge("bed-3", "news2", "ayse", WALL)
    _evaluate(engine, store, SignalCode.HEART_RATE, 80, minute=1)
    assert _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=2) == []
    _stamp(engine, store, minute=2)
    assert store.first_seen[("bed-3", "news2")] == WALL + timedelta(minutes=2), "its own first-seen"
    assert ("bed-3", "news2") not in store.acks, "the old answer belongs to the old episode"


def test_a_latched_kind_that_fires_again_replaces_the_latch_without_a_cleared_row():
    engine, store = _shock()
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)
    assert _evaluate(engine, store, SignalCode.LACTATE, 3.4, minute=2) == []
    assert store.resolved == {}
    assert "septic_shock" in {a.kind for a in engine.active_alerts("bed-3")}
    assert store.first_seen[SHOCK_KEY] == WALL, "the episode goes on: its first-seen is still its own"


def test_a_critical_that_fires_again_while_latched_keeps_its_episode_and_a_fresh_clock_follows_only_an_acknowledgement():
    """O5: nobody has answered the first firing, so the second is the same episode — the clock that
    escalates it keeps running from the first sight. Only an acknowledgement ends the episode."""
    engine, store = _shock()                                                      # first seen at WALL
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)                   # latched
    assert _evaluate(engine, store, SignalCode.LACTATE, 3.4, minute=2) == []      # firing again
    _stamp(engine, store, minute=2)                                               # the door's stamp
    assert store.first_seen[SHOCK_KEY] == WALL, "unacknowledged: still the first episode"
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=3)                   # latched again
    assert store.first_seen[SHOCK_KEY] == WALL
    acknowledge_latched(store, "bed-3", "septic_shock")                           # answered: it ends
    _evaluate(engine, store, SignalCode.LACTATE, 3.4, minute=4)
    _stamp(engine, store, minute=4)
    assert store.first_seen[SHOCK_KEY] == WALL + timedelta(minutes=4), "now a new episode, a new clock"


def test_the_page_belongs_to_the_episode_a_latch_keeps_it_and_an_ending_takes_it():
    """The doctor is paged once per episode (final review): the record of it lives and dies with the
    episode's first-seen — kept through a latch and a return, gone with an acknowledgement or with
    a rule that ended for good."""
    engine, store = _shock()
    store.paged.update({SHOCK_KEY, ("bed-3", "sepsis")})
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)                   # latched
    assert SHOCK_KEY in store.paged and ("bed-3", "sepsis") in store.paged
    _evaluate(engine, store, SignalCode.LACTATE, 3.4, minute=2)                   # the same episode
    assert SHOCK_KEY in store.paged, "a return is not a new episode: it is not paged again"
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=3)                   # latched again
    _evaluate(engine, store, SignalCode.SUSPECTED_INFECTION, 0.0, minute=4)       # sepsis ends for good
    assert ("bed-3", "sepsis") not in store.paged
    assert SHOCK_KEY in store.paged, "a latch is still the episode"
    acknowledge_latched(store, "bed-3", "septic_shock")
    assert SHOCK_KEY not in store.paged, "answered: the next episode can page"


def test_a_latch_carries_its_episodes_first_seen_to_the_cleared_record_of_its_acknowledgement():
    engine, store = _shock()
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)
    assert store.resolved[SHOCK_KEY]["first_seen"] == WALL
    del store.first_seen[SHOCK_KEY]                       # the stamp is gone, the latch still has it
    assert acknowledge_latched(store, "bed-3", "septic_shock") == Cleared(
        "bed-3", "septic_shock", "critical", WALL, ACKED_AFTER_RESOLVE)


def test_a_latch_of_an_alert_that_was_never_stamped_has_no_first_seen_to_carry():
    """Fired and ended inside one /clinical request: no door stamped it."""
    engine, store = Engine(), AckStore()
    for code, value in SHOCK:
        _evaluate(engine, store, code, value, minute=0)
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)
    assert store.resolved[SHOCK_KEY]["first_seen"] is None
    assert acknowledge_latched(store, "bed-3", "septic_shock") == Cleared(
        "bed-3", "septic_shock", "critical", None, ACKED_AFTER_RESOLVE)


def test_an_acknowledged_latch_does_not_come_back_on_the_next_normal_reading():
    engine, store = _shock()
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)
    acknowledge_latched(store, "bed-3", "septic_shock")
    assert _evaluate(engine, store, SignalCode.LACTATE, 1.4, minute=2) == []
    assert store.resolved == {}


def test_the_hook_leaves_another_patient_alone():
    engine, store = Engine(), AckStore()
    _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=0, patient="bed-4")
    _stamp(engine, store, patient="bed-4")
    store.acknowledge("bed-4", "news2", "ayse", WALL)
    _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=1)
    _evaluate(engine, store, SignalCode.HEART_RATE, 80, minute=2)
    assert ("bed-4", "news2") in store.acks and ("bed-4", "news2") in store.first_seen


def test_another_patients_reading_neither_clears_nor_unlatches_a_critical():
    engine, store = Engine(), AckStore()
    for code, value in SHOCK:
        _evaluate(engine, store, code, value, minute=0, patient="bed-4")
    _stamp(engine, store, patient="bed-4")
    assert _evaluate(engine, store, SignalCode.HEART_RATE, 80, minute=1) == []
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=2, patient="bed-4")
    assert ("bed-4", "septic_shock") in store.resolved


def test_the_notifier_pruned_with_the_live_keys_tells_a_nurse_again_only_for_a_new_episode():
    engine, store, notifier = Engine(), AckStore(), Notifier()
    for code, value in SHOCK:
        _evaluate(engine, store, code, value, minute=0)
    assert [n.kind for n in notifier.for_new("H", engine.active_alerts("bed-3"))] == ["septic_shock"]
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)      # latched: still live
    notifier.prune("H", live_keys(engine, store))
    _evaluate(engine, store, SignalCode.LACTATE, 3.4, minute=2)      # the same episode, firing again
    assert notifier.for_new("H", engine.active_alerts("bed-3")) == []
    store.acknowledge("bed-3", "septic_shock", "ayse", WALL)
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=3)      # acknowledged: it leaves
    notifier.prune("H", live_keys(engine, store))
    _evaluate(engine, store, SignalCode.LACTATE, 3.4, minute=4)      # a new episode
    assert [n.kind for n in notifier.for_new("H", engine.active_alerts("bed-3"))] == ["septic_shock"]


def test_a_cleared_row_says_when_the_episode_began_and_why_it_ended():
    at = WALL + timedelta(minutes=5)
    assert Cleared("bed-3", "news2", "moderate", WALL, RESOLVED).payload(at) == {
        "first_seen": WALL.isoformat(), "at": at.isoformat(), "reason": "resolved",
        "severity": "moderate"}
    assert Cleared("bed-3", "septic_shock", "critical", None, ACKED_AFTER_RESOLVE).payload(at)[
        "first_seen"] is None


# --- G2-A1, X13: an episode that returns within the escalation delay continues its chain ---------

GAP = timedelta(minutes=5)
NEWS2_KEY = ("bed-3", "news2")


def _stamp_chained(engine, store, minute, patient="bed-3"):
    """The doors' stamp since X13: told the escalation delay, so a return can continue its chain."""
    for a in engine.active_alerts(patient):
        store.stamp_first_seen(patient, a.kind, WALL + timedelta(minutes=minute), chain_gap=GAP)


def test_the_hook_remembers_a_cleared_episodes_chain_at_the_time_it_ran():
    engine, store = Engine(), AckStore()
    _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=0)
    _stamp_chained(engine, store, minute=0)
    _evaluate(engine, store, SignalCode.HEART_RATE, 80, minute=1)
    assert store.recent[NEWS2_KEY] == Chain(clock_from=WALL, cleared_at=WALL + timedelta(minutes=1),
                                            paged=False)
    assert NEWS2_KEY not in store.clock_from


def test_a_return_within_the_delay_is_a_new_episode_on_its_chains_escalation_clock():
    engine, store = Engine(), AckStore()
    _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=0)
    _stamp_chained(engine, store, minute=0)
    _evaluate(engine, store, SignalCode.HEART_RATE, 80, minute=1)                 # cleared, unanswered
    _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=3)
    _stamp_chained(engine, store, minute=3)
    assert store.first_seen[NEWS2_KEY] == WALL + timedelta(minutes=3), "a new episode (D5)"
    assert store.clock_from[NEWS2_KEY] == WALL, "two minutes off the board: the chain's clock goes on"


def test_an_acknowledged_episode_that_clears_leaves_no_chain_and_its_return_starts_a_new_clock():
    """An answer ends the chain (X13 review): only an episode that ended unanswered leaves one. Its
    answered minutes are not a return's unanswered ones, and a return's page is its own."""
    engine, store = Engine(), AckStore()
    _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=0)
    _stamp_chained(engine, store, minute=0)
    store.paged.add(NEWS2_KEY)
    store.acknowledge("bed-3", "news2", "ayse", WALL + timedelta(minutes=1))
    _evaluate(engine, store, SignalCode.HEART_RATE, 80, minute=2)                 # cleared, answered
    assert store.recent == {}, "an answered episode leaves no chain"
    _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=3)
    _stamp_chained(engine, store, minute=3)
    assert store.first_seen[NEWS2_KEY] == store.clock_from[NEWS2_KEY] == WALL + timedelta(minutes=3)
    assert NEWS2_KEY not in store.acks, "the old answer belongs to the old episode"
    assert NEWS2_KEY not in store.paged, "a new chain: the doctor can be paged for it"


def test_an_acknowledged_latch_leaves_no_chain_and_its_return_starts_a_new_clock():
    """The acknowledgement that removes a latch ends its episode, and — an answer — its chain too. The
    replay's call (api/rehydrate.py) is the same one: a restart rebuilds no chain."""
    engine, store = _shock()
    store.paged.add(SHOCK_KEY)
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)                   # latched
    assert SHOCK_KEY not in store.recent, "still on the board: the chain is live"
    assert store.clock_from[SHOCK_KEY] == WALL
    acknowledge_latched(store, "bed-3", "septic_shock")
    assert store.recent == {}, "answered: no chain is left behind"
    assert SHOCK_KEY not in store.clock_from and SHOCK_KEY not in store.paged
    _evaluate(engine, store, SignalCode.LACTATE, 3.4, minute=4)
    _stamp_chained(engine, store, minute=4)
    assert store.first_seen[SHOCK_KEY] == WALL + timedelta(minutes=4), "a new episode"
    assert store.clock_from[SHOCK_KEY] == WALL + timedelta(minutes=4) and SHOCK_KEY not in store.paged, \
        "two minutes after the acknowledgement, and a new chain: its own clock, its own page"
