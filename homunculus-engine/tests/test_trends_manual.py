"""G3-01 (D13, X1): the trends answer lists each channel's hand entries measured in the window, a withdrawn one
with its reason, who and when — read from the trail — while the drawn points lose the withdrawn value.
Synthetic patients and values only (CLAUDE.md rule 6).

Written on a branch (feat/g3-eng2) that had neither Task 2 (the door's `entries` answer) nor Task 5 (the
withdrawal route); after the merge:
  * `_chart` takes the door's answer and checks it against the trail's newest `chart` row;
  * `_withdraw` still writes the `chart_retract` row the route writes (`{entry, value, obs_ts, reason,
    retracted_by}`, subject the code — the payload Task 5 pins) straight into the trail, so most tests here read
    `manual` without the route's rebuild; the engine's memory is NOT rebuilt by it;
  * the points half runs twice: through the route itself (`_withdraw_by_route`), and at the seam, with Task 4's
    rebuild standing in for what the route does."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api import trends
from homunculus.api.app import create_app
from homunculus.api.audit import AuditEvent, iter_records_of
from homunculus.api.clinical import RETRACT
from homunculus.api.identity import Caller
from homunculus.api.rehydrate import REBUILD_EVENTS, rebuild_patient, retracted_entries
from homunculus.pipeline import Engine

TOKEN = "tok"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
PEOPLE = {"nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                              perms=frozenset({"board.view", "clinical.chart"}))}
WHY = "yanlış hasta seçilmişti"


async def _resolve(credential: str):
    return PEOPLE.get(credential)


@pytest.fixture()
def client():
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve)
    with TestClient(app) as c:
        yield c


def _ago(minutes: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def _chart(c, code, value, minutes_ago, at=None) -> int:
    r = c.post("/clinical/bed-3", json={"entries": [{"code": code, "value": value}],
                                        "recorded_at": at or _ago(minutes_ago)}, headers=NURSE)
    assert r.status_code == 200, r.text
    (answered,) = r.json()["entries"]                                  # the door's answer (Task 2)
    (row,) = c.app.state.audit.records(tenant="h1", patient_id="bed-3", event_type="chart", newest=True, limit=1)
    assert (answered["code"], answered["entry"], row.subject) == (code, row.id, code)
    return row.id


def _withdraw(c, entry, reason=WHY, by="hem.ayse") -> None:
    """The `chart_retract` row Task 5's route appends (see this file's header)."""
    audit = c.app.state.audit
    (target,) = [r for r in audit.records(tenant="h1", patient_id="bed-3", event_type="chart", limit=1000)
                 if r.id == entry]
    audit.append(AuditEvent("h1", RETRACT, "bed-3", target.subject, {
        "entry": target.id, "value": target.payload["value"], "obs_ts": target.payload["obs_ts"],
        "reason": reason, "retracted_by": by}))


def _withdraw_by_route(c, entry, reason=WHY) -> None:
    """Task 5's route: the trail row, then the engine rebuilt without the entry."""
    r = c.post(f"/clinical/bed-3/entries/{entry}/retract", json={"reason": reason}, headers=NURSE)
    assert r.status_code == 200, r.text


def _trends(c, hours=6):
    r = c.get(f"/patients/bed-3/trends?hours={hours}", headers=AUTH)
    assert r.status_code == 200, r.text
    return r.json()


def _channel(body, key):
    return next(ch for ch in body["channels"] if ch["key"] == key)


def test_a_hand_entry_and_its_withdrawal_are_listed(client):
    keep = _chart(client, "heart_rate", 82, 30)
    wrong = _chart(client, "heart_rate", 182, 20)
    _withdraw(client, wrong)
    body = _trends(client)
    hr = _channel(body, "heart_rate")
    assert [(m["entry"], m["value"], m["by"]) for m in hr["manual"]] == [(keep, 82, "hem.ayse"), (wrong, 182, "hem.ayse")]
    assert hr["manual"][0]["retracted"] is None
    assert (hr["manual"][1]["retracted"]["reason"], hr["manual"][1]["retracted"]["by"]) == (WHY, "hem.ayse")
    assert hr["manual"][1]["retracted"]["at"]
    assert body["manual_truncated"] is False


def test_a_value_withdrawn_by_the_route_leaves_the_drawn_points_and_stays_listed(client):
    keep = _chart(client, "heart_rate", 82, 30)
    wrong = _chart(client, "heart_rate", 182, 20)
    _withdraw_by_route(client, wrong)
    hr = _channel(_trends(client), "heart_rate")
    assert [p[1] for p in hr["points"]] == [82]
    assert [(m["entry"], m["value"], m["retracted"] is not None) for m in hr["manual"]] == [
        (keep, 82, False), (wrong, 182, True)]
    assert (hr["manual"][1]["retracted"]["reason"], hr["manual"][1]["retracted"]["by"]) == (WHY, "hem.ayse")


def test_the_drawn_points_lose_a_withdrawn_value_that_manual_still_lists(client):
    """The points half at the seam (see the header): the engine, rebuilt without the withdrawn entry as Task 5's
    route rebuilds it, draws only the kept value; `manual` still lists both, from the trail."""
    keep = _chart(client, "heart_rate", 82, 30)
    wrong = _chart(client, "heart_rate", 182, 20)
    _withdraw(client, wrong)
    audit = client.app.state.audit
    rows = list(iter_records_of(audit, tenant="h1", event_types=REBUILD_EVENTS | {RETRACT}, page=100,
                                patient_id="bed-3"))
    engine = Engine()
    rebuild_patient(engine, "bed-3", rows, skip=retracted_entries(rows))
    hr = _channel(trends.patient_trends(engine, audit, hospital="h1", patient_id="bed-3", hours=6,
                                        now=datetime.now(timezone.utc)), "heart_rate")
    assert [p[1] for p in hr["points"]] == [82]
    assert [(m["entry"], m["value"], m["retracted"] is not None) for m in hr["manual"]] == [
        (keep, 82, False), (wrong, 182, True)]


def test_the_other_channels_list_no_hand_entry(client):
    _chart(client, "heart_rate", 82, 30)
    body = _trends(client)
    assert all(ch["manual"] == [] for ch in body["channels"] if ch["key"] != "heart_rate")


def test_an_entry_measured_before_the_window_is_not_listed(client):
    _chart(client, "heart_rate", 82, 7 * 60)
    assert _channel(_trends(client, hours=6), "heart_rate")["manual"] == []
    assert len(_channel(_trends(client, hours=24), "heart_rate")["manual"]) == 1


def test_a_charted_code_with_no_channel_is_not_listed(client):
    r = client.post("/clinical/bed-3", json={"entries": [{"code": "platelets", "value": 120}]}, headers=NURSE)
    assert r.status_code == 200, r.text
    assert all(ch["manual"] == [] for ch in _trends(client)["channels"])


def test_a_read_that_had_to_cut_says_so(client, monkeypatch):
    monkeypatch.setattr(trends, "TRENDS_MANUAL_LIMIT", 1)
    _chart(client, "heart_rate", 82, 30)
    _chart(client, "heart_rate", 84, 20)
    assert _trends(client)["manual_truncated"] is True


def test_a_read_that_just_fits_does_not_say_it_cut(client, monkeypatch):
    monkeypatch.setattr(trends, "TRENDS_MANUAL_LIMIT", 2)
    _chart(client, "heart_rate", 82, 30)
    _chart(client, "heart_rate", 84, 20)
    body = _trends(client)
    assert body["manual_truncated"] is False
    assert len(_channel(body, "heart_rate")["manual"]) == 2


def test_a_cut_keeps_the_newest_rows_so_a_kept_entry_keeps_its_withdrawal(client, monkeypatch):
    """Review of Task 6: the read keeps the NEWEST rows. A withdrawal is written after the row it withdraws, so
    any chart row on the page has its withdrawal on it too; a cut loses only the oldest entries. Kept the other
    way round, the withdrawal fell behind the cut: the engine had dropped the value, the list showed it as
    not withdrawn, and the dashboard offered a «hatalı giriş» button the engine answers 409."""
    monkeypatch.setattr(trends, "TRENDS_MANUAL_LIMIT", 2)
    _chart(client, "heart_rate", 82, 30)
    wrong = _chart(client, "heart_rate", 182, 20)
    _withdraw(client, wrong)                       # trail order: first, wrong, withdraw(wrong)
    body = _trends(client)
    manual = _channel(body, "heart_rate")["manual"]
    assert [(m["entry"], m["value"]) for m in manual] == [(wrong, 182)]
    assert manual[0]["retracted"]["reason"] == WHY
    assert body["manual_truncated"] is True


@pytest.mark.parametrize("limit, listed, withdrawn, cut", [
    (3, ["first", "second"], [True, False], False),    # everything fits: write order, first withdrawn
    (2, ["second"], [False], True),                    # the oldest chart row went; its withdrawal stays unmatched
    (1, [], [], True),                                 # only the withdrawal is left, and it names no listed row
])
def test_a_cut_loses_the_oldest_entries_and_lists_the_rest_in_write_order(client, monkeypatch, limit, listed,
                                                                           withdrawn, cut):
    monkeypatch.setattr(trends, "TRENDS_MANUAL_LIMIT", limit)
    ids = {"first": _chart(client, "heart_rate", 82, 30), "second": _chart(client, "heart_rate", 84, 20)}
    _withdraw(client, ids["first"])                # trail order: first, second, withdraw(first)
    body = _trends(client)
    manual = _channel(body, "heart_rate")["manual"]
    assert [m["entry"] for m in manual] == [ids[name] for name in listed]
    assert [m["retracted"] is not None for m in manual] == withdrawn
    assert body["manual_truncated"] is cut


def test_a_bedside_value_dated_just_ahead_and_written_before_the_window_start_is_listed(client):
    """The sliver of X1: the door lets a bedside time run up to BEDSIDE_SKEW (2 min) ahead of the write, so the
    row's write time can be earlier than the window start while the time it records is inside the window. The
    trail is read from `since - BEDSIDE_SKEW`; the exact bound is kept by the time filter."""
    ahead = datetime.now(timezone.utc) + timedelta(minutes=1)
    entry = _chart(client, "heart_rate", 82, 0, at=ahead.isoformat())
    (row,) = client.app.state.audit.records(tenant="h1", patient_id="bed-3", event_type="chart", limit=10)
    written = datetime.fromisoformat(row.ts)
    # A window that starts 30 s after the write and 30 s before the value's own time.
    now = written + timedelta(hours=6, seconds=30)
    assert datetime.fromisoformat(row.payload["obs_ts"]) > written + timedelta(seconds=30)
    body = trends.patient_trends(Engine(), client.app.state.audit, hospital="h1", patient_id="bed-3", hours=6,
                                 now=now)
    assert [m["entry"] for m in _channel(body, "heart_rate")["manual"]] == [entry]


def test_a_value_the_trail_cannot_read_is_left_out_not_shown_as_zero(client):
    good = _chart(client, "heart_rate", 82, 30)
    audit = client.app.state.audit
    stamp = _ago(10)
    for payload in ({"value": "abc", "obs_ts": stamp}, {"value": True, "obs_ts": stamp},
                    {"value": None, "obs_ts": stamp}, {"obs_ts": stamp},
                    {"value": 90, "obs_ts": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()},
                    {"value": 90, "obs_ts": "not a time"}, {"value": 90}, {"value": 90, "obs_ts": None}):
        audit.append(AuditEvent("h1", "chart", "bed-3", "heart_rate", {**payload, "charted_by": "hem.ayse"}))
    assert [m["entry"] for m in _channel(_trends(client), "heart_rate")["manual"]] == [good]


def test_at_is_a_utc_instant_and_the_same_instant_as_the_point(client):
    """The point is stamped as the sender wrote the time (`o.timestamp.isoformat()`), the hand entry in UTC
    (`astimezone(utc).isoformat()`): one reading, one instant, whatever offset the sender used."""
    utc_stamp = _ago(30)
    _chart(client, "heart_rate", 82, 30, at=utc_stamp)
    plus4 = (datetime.now(timezone.utc) - timedelta(minutes=20)).astimezone(timezone(timedelta(hours=4))).isoformat()
    _chart(client, "heart_rate", 84, 20, at=plus4)
    hr = _channel(_trends(client), "heart_rate")
    assert [m["at"].endswith("+00:00") for m in hr["manual"]] == [True, True]
    assert [datetime.fromisoformat(m["at"]) for m in hr["manual"]] == [datetime.fromisoformat(p[0]) for p in hr["points"]]
    assert hr["manual"][0]["at"] == hr["points"][0][0]                 # a UTC sender: the very same text
    assert hr["points"][1][0].endswith("+04:00")                       # the point keeps the sender's offset


def _plant(c, value, obs_ts, tenant="h1", subject="heart_rate") -> int:
    """A `chart` row written straight into the trail, as an older build or another door could have left it."""
    return c.app.state.audit.append(AuditEvent(tenant, "chart", "bed-3", subject, {
        "value": value, "unit": "/min", "obs_ts": obs_ts, "charted_by": "hem.ayse"})).id


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")], ids=["nan", "inf", "minus-inf"])
def test_a_value_that_is_not_a_finite_number_is_left_out_and_the_route_answers_200(client, value):
    good = _chart(client, "heart_rate", 82, 30)
    _plant(client, value, _ago(10))
    assert [m["entry"] for m in _channel(_trends(client), "heart_rate")["manual"]] == [good]   # _trends asserts 200


@pytest.mark.parametrize("value", [10**400, -(10**400)], ids=["huge", "minus-huge"])
def test_an_integer_too_large_for_a_float_is_left_out_not_a_500(client, value):
    """`math.isfinite(10**400)` raises OverflowError: the read would answer 500 for as long as the row sat in the
    window. A whole number the trail can hold as a float (the door writes floats; an older row may hold an int)
    still lists.

    The door charts first, so the tenant's engine is built before the row is planted: a restart's replay
    (`rehydrate.observation_of`, `float(p["value"])`) would meet the same OverflowError on such a row, which is
    that module's to guard, not this read's."""
    door = _chart(client, "heart_rate", 82, 40)
    small = _plant(client, 82, _ago(30))
    _plant(client, value, _ago(10))
    assert [(m["entry"], m["value"]) for m in _channel(_trends(client), "heart_rate")["manual"]] == [
        (door, 82), (small, 82)]


def test_a_hand_value_is_the_point_value_on_a_decimal_channel(client):
    _chart(client, "temperature", 36.6, 15)
    t = _channel(_trends(client), "temperature")
    assert [m["value"] for m in t["manual"]] == [36.6]
    assert [p[1] for p in t["points"]] == [36.6]


def test_a_withdrawals_time_is_a_utc_instant_from_the_moment_it_was_written(client):
    wrong = _chart(client, "heart_rate", 182, 20)
    before = datetime.now(timezone.utc)
    _withdraw(client, wrong)
    after = datetime.now(timezone.utc)
    at = _channel(_trends(client), "heart_rate")["manual"][0]["retracted"]["at"]
    assert at.endswith("+00:00")
    assert before <= datetime.fromisoformat(at) <= after


def test_the_window_bounds_are_the_exact_instants_both_inclusive(client):
    """The time filter is on the time the value records: `since` and `until` themselves are in; a second outside
    either is out."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=6)
    second = timedelta(seconds=1)
    planted = {name: _plant(client, 80 + n, stamp.isoformat()) for n, (name, stamp) in enumerate([
        ("at_until", now), ("after_until", now + second), ("at_since", since), ("before_since", since - second)])}
    body = trends.patient_trends(Engine(), client.app.state.audit, hospital="h1", patient_id="bed-3", hours=6,
                                 now=now)
    assert sorted(m["entry"] for m in _channel(body, "heart_rate")["manual"]) == sorted(
        [planted["at_until"], planted["at_since"]])


def test_another_hospitals_rows_are_never_listed(client):
    mine = _chart(client, "heart_rate", 82, 30)
    stamp = _ago(10)
    _plant(client, 99, stamp, tenant="h2")                               # same patient id, another tenant
    client.app.state.audit.append(AuditEvent("h2", RETRACT, "bed-3", "heart_rate", {
        "entry": mine, "value": 82, "obs_ts": stamp, "reason": WHY, "retracted_by": "dr.elif"}))
    hr = _channel(_trends(client), "heart_rate")
    assert [(m["entry"], m["retracted"]) for m in hr["manual"]] == [(mine, None)]
