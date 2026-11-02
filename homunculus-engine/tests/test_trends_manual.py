"""G3-01 (D13, X1): the trends answer lists each channel's hand entries measured in the window, a withdrawn one
with its reason, who and when — read from the trail — while the drawn points lose the withdrawn value.
Synthetic patients and values only (CLAUDE.md rule 6).

Adapted for the branch this task was built on (feat/g3-eng2), which has Task 1 and Task 4 but neither Task 2 (the
door's `entries` answer) nor Task 5 (the withdrawal route):
  * `_chart` reads the new `chart` row's audit id from the trail instead of from the door's answer;
  * `_withdraw` writes the `chart_retract` row the route writes (`{entry, value, obs_ts, reason, retracted_by}`,
    subject the code — the payload Task 5 pins), because the route does not exist here, and so the engine's memory
    is NOT rebuilt by it. The route-level version of the points assertion runs once the branches merge:
    `client.post(f"/clinical/bed-3/entries/{wrong}/retract", json={"reason": WHY}, headers=NURSE)`, then
    `assert [p[1] for p in hr["points"]] == [82]` on the route's own answer. Until then the points half is pinned
    below at the seam, with Task 4's rebuild standing in for what the route does."""
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
    # The merged tree's door answers `entries[0]["entry"]` (Task 2). Here the id is the newest `chart` row's.
    (row,) = c.app.state.audit.records(tenant="h1", patient_id="bed-3", event_type="chart", newest=True, limit=1)
    assert row.subject == code
    return row.id


def _withdraw(c, entry, reason=WHY, by="hem.ayse") -> None:
    """The `chart_retract` row Task 5's route appends (see this file's header)."""
    audit = c.app.state.audit
    (target,) = [r for r in audit.records(tenant="h1", patient_id="bed-3", event_type="chart", limit=1000)
                 if r.id == entry]
    audit.append(AuditEvent("h1", RETRACT, "bed-3", target.subject, {
        "entry": target.id, "value": target.payload["value"], "obs_ts": target.payload["obs_ts"],
        "reason": reason, "retracted_by": by}))


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


def test_the_drawn_points_lose_a_withdrawn_value_that_manual_still_lists(client):
    """The points half of the route-level test (see the header): the engine, rebuilt without the withdrawn entry
    as Task 5's route rebuilds it, draws only the kept value; `manual` still lists both, from the trail."""
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


@pytest.mark.parametrize("limit", [1, 2, 3])
def test_a_cut_page_is_a_prefix_so_a_withdrawal_never_stands_without_its_chart_row(client, monkeypatch, limit):
    """The read is oldest-first by id and a withdrawal is written after the row it withdraws, so a page holding a
    withdrawal holds that row; what a cut can lose is the NEWEST rows — a withdrawal behind the cut — and then
    `manual_truncated` is true."""
    monkeypatch.setattr(trends, "TRENDS_MANUAL_LIMIT", limit)
    first = _chart(client, "heart_rate", 82, 30)
    second = _chart(client, "heart_rate", 84, 20)
    _withdraw(client, first)                       # trail order: first, second, withdraw(first)
    body = _trends(client)
    manual = _channel(body, "heart_rate")["manual"]
    assert [m["entry"] for m in manual] == [first, second][:limit]
    assert [m["retracted"] is not None for m in manual] == ([True, False] if limit == 3 else [False, False][:limit])
    assert body["manual_truncated"] is (limit < 3)


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
