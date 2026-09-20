"""Does anyone act on our alarms? (E4)

The product's entire premise is that it reduces alarm fatigue, and nothing in it measured whether
it was creating some. These tests hold the shape of that measurement — and, more importantly, the
three ways it could flatter itself: counting repeat emissions as separate disturbances, counting an
alarm raised forty seconds ago as ignored, and reporting "0% answered" when the honest answer is
"nothing has settled yet".
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.alarm_quality import alarm_quality, build_episodes
from homunculus.api.app import create_app
from homunculus.api.audit import AuditRecord

T0 = datetime(2026, 9, 8, 9, 0, tzinfo=timezone.utc)
TOKEN = "tok"
AUTH = {"Authorization": f"Bearer {TOKEN}"}

_next_id = iter(range(1, 10_000))


def rec(event_type, patient_id, subject, minute, **payload):
    when = (T0 + timedelta(minutes=minute)).isoformat()
    return AuditRecord(id=next(_next_id), ts=when, tenant="h1", event_type=event_type,
                       patient_id=patient_id, subject=subject,
                       payload={"at": when, **payload})


def _now(minute):
    return T0 + timedelta(minutes=minute)


class TestTheUnitIsTheEpisode:
    def test_repeat_emissions_are_not_counted_as_separate_disturbances(self):
        """While an alert is active the engine re-emits it on every ingest. Counting `alert` rows
        would measure how often the monitor sampled, not how often the ward was disturbed."""
        records = [rec("first_seen", "bed-1", "sepsis", 0)]
        records += [rec("alert", "bed-1", "sepsis", m) for m in range(1, 30)]
        report = alarm_quality(records, _now(60))
        assert report.episodes == 1
        assert report.repeats == 29     # the noise is still reported, just not as episodes

    def test_an_alert_that_clears_and_returns_is_two_episodes(self):
        records = [rec("first_seen", "bed-1", "sepsis", 0), rec("ack", "bed-1", "sepsis", 2),
                   rec("first_seen", "bed-1", "sepsis", 90), rec("ack", "bed-1", "sepsis", 93)]
        assert alarm_quality(records, _now(200)).episodes == 2

    def test_an_ack_for_an_episode_outside_the_window_is_dropped_not_invented(self):
        """Its `first_seen` belongs to the previous window; opening an episode for it here would
        double-count the same disturbance in two reports."""
        assert build_episodes([rec("ack", "bed-1", "sepsis", 5)]) == []


class TestAnsweredAndIgnored:
    def test_an_answered_alarm_records_who_and_how_fast(self):
        records = [rec("first_seen", "bed-1", "sepsis", 0),
                   rec("ack", "bed-1", "sepsis", 3, role="NURSE")]
        report = alarm_quality(records, _now(60))
        assert report.answered == 1 and report.unanswered == 0
        assert report.median_response_sec == 180.0
        assert report.answered_rate == 1.0

    def test_a_second_ack_does_not_slow_the_recorded_response(self):
        """The second clinician arriving is not a slower response."""
        records = [rec("first_seen", "bed-1", "sepsis", 0),
                   rec("ack", "bed-1", "sepsis", 1, role="NURSE"),
                   rec("ack", "bed-1", "sepsis", 20, role="ATTENDING")]
        assert alarm_quality(records, _now(60)).median_response_sec == 60.0

    def test_an_alarm_nobody_ever_answered_counts_against_us(self):
        report = alarm_quality([rec("first_seen", "bed-1", "sepsis", 0)], _now(600))
        assert report.unanswered == 1 and report.answered == 0
        assert report.answered_rate == 0.0

    def test_escalation_is_reported_alongside_the_answer(self):
        records = [rec("first_seen", "bed-1", "sepsis", 0),
                   rec("escalation", "bed-1", "sepsis", 5),
                   rec("ack", "bed-1", "sepsis", 7, role="ATTENDING")]
        report = alarm_quality(records, _now(60))
        assert report.escalated == 1 and report.answered == 1


class TestItDoesNotFlatterOrSlanderItself:
    def test_an_alarm_still_in_flight_is_pending_not_ignored(self):
        """A nurse walking to the bed is not a failure. Counting it as one would make the report
        look worse the sooner after a shift it is run."""
        report = alarm_quality([rec("first_seen", "bed-1", "sepsis", 0)], _now(1))
        assert report.pending == 1 and report.unanswered == 0
        assert report.answered_rate is None     # nothing has settled — unknown, not 0%

    def test_no_episodes_reports_an_unknown_rate_rather_than_zero_percent(self):
        report = alarm_quality([], _now(60))
        assert report.episodes == 0 and report.answered_rate is None

    def test_pending_episodes_are_excluded_from_the_rate_not_counted_as_answered(self):
        records = [rec("first_seen", "bed-1", "sepsis", 0), rec("ack", "bed-1", "sepsis", 1),
                   rec("first_seen", "bed-2", "news2", 59)]     # raised a minute ago
        report = alarm_quality(records, _now(60))
        assert report.pending == 1
        assert report.answered_rate == 1.0      # 1 answered of 1 settled, not 0.5 of 2


class TestTheBreakdown:
    def test_kinds_are_ranked_by_how_often_they_disturb_the_ward(self):
        records = []
        for i in range(5):
            records.append(rec("first_seen", f"bed-{i}", "news2", i))
        records.append(rec("first_seen", "bed-9", "sepsis", 10))
        report = alarm_quality(records, _now(600))
        assert [k.kind for k in report.per_kind] == ["news2", "sepsis"]
        assert report.per_kind[0].episodes == 5

    def test_the_noisiest_bed_is_named(self):
        records = [rec("first_seen", "bed-1", "news2", m) for m in (0, 100, 200)]
        records += [rec("first_seen", "bed-2", "news2", 0)]
        report = alarm_quality(records, _now(600))
        assert report.noisiest_beds[0] == {"patient_id": "bed-1", "episodes": 3}


class TestTheEndpoint:
    @pytest.fixture()
    def client(self):
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False)
        with TestClient(app) as c:
            yield c

    def test_a_live_ward_reports_its_own_alarm_load(self, client):
        # Chart enough to raise something real, then acknowledge it.
        client.post("/clinical/bed-1", json={"entries": [
            {"code": "suspected_infection", "value": 1},
            {"code": "platelets", "value": 80},
            {"code": "creatinine", "value": 3.5},
        ]}, headers=AUTH)
        body = client.get("/alarm-quality", headers=AUTH).json()
        assert body["days"] == 7
        assert body["episodes"] >= 1
        # Nothing acknowledged yet and it just happened: pending, and the rate is unknown.
        assert body["pending"] >= 1
        assert body["answered_rate"] is None    # unknown, not 0%


class TestChartingRaisesRealEpisodes:
    """The gap this work uncovered.

    `/ingest` stamped first-seen AND audited it; `/clinical` only stamped it. Two things were lost:
    an alert raised from a clinician's own charting was invisible to this report, and — the serious
    half — `rehydrate` had no row to replay, so a restart handed that alert a fresh escalation
    clock. An alarm ignored for four minutes started its five-minute grace over again after a
    deploy, and nothing looked broken.
    """

    @pytest.fixture()
    def client(self):
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False)
        with TestClient(app) as c:
            yield c

    def _raise_sepsis(self, client, bed="bed-1"):
        return client.post(f"/clinical/{bed}", json={"entries": [
            {"code": "suspected_infection", "value": 1},
            {"code": "platelets", "value": 80},
            {"code": "creatinine", "value": 3.5},
        ]}, headers=AUTH)

    def test_charting_an_alert_writes_a_first_seen_row(self, client):
        self._raise_sepsis(client)
        rows = client.get("/audit", headers=AUTH).json()["records"]
        assert any(r["event_type"] == "first_seen" and r["subject"] == "sepsis" for r in rows)

    def test_it_is_stamped_once_not_on_every_chart(self, client):
        self._raise_sepsis(client)
        client.post("/clinical/bed-1", json={"entries": [{"code": "lactate", "value": 3.0}]},
                    headers=AUTH)
        rows = client.get("/audit", headers=AUTH).json()["records"]
        stamps = [r for r in rows if r["event_type"] == "first_seen" and r["subject"] == "sepsis"]
        assert len(stamps) == 1

    def test_the_escalation_clock_survives_a_restart(self, client):
        """The bug with teeth: without a replayed first_seen, a deploy resets the timer on an
        alarm nobody answered."""
        self._raise_sepsis(client)
        records = client.get("/audit", headers=AUTH).json()["records"]

        from homunculus.api.ackstore import AckStore
        from homunculus.api.rehydrate import rehydrate
        from homunculus.pipeline import Engine

        store = AckStore()
        rehydrate(Engine(), store, [AuditRecord(**r) for r in records])
        assert ("bed-1", "sepsis") in store.first_seen

    def test_the_alarm_quality_report_now_sees_it(self, client):
        self._raise_sepsis(client)
        body = client.get("/alarm-quality", headers=AUTH).json()
        assert body["episodes"] >= 1
        assert any(k["kind"] == "sepsis" for k in body["per_kind"])

    def test_acknowledging_it_shows_up_as_an_answered_alarm(self, client):
        self._raise_sepsis(client)
        r = client.post("/ack", json={"patient_id": "bed-1", "kind": "sepsis", "role": "NURSE"},
                        headers=AUTH)
        assert r.status_code == 200, r.text
        body = client.get("/alarm-quality", headers=AUTH).json()
        assert body["answered"] >= 1
        assert body["answered_rate"] == 1.0
