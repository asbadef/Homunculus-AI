# homunculus-engine/tests/test_api_board_isolation.py
"""G4-05 «Enfeksiyon kontrol» (spec D8 as §5 S2 amends it): the board card's `isolation` block — each of the four
flags three-valued (null: never charted; else its latest value ≥ 1), `types` the ones in place in the one order,
`state` the server's word, `charted_at` the newest of the four latest times — and NO person: who charted it is in the
`chart` rows (/denetim). An identity-only card carries `isolation: null`. A restart restores the flags from the trail
through the existing chart replay. Synthetic patients only (CLAUDE.md rule 6)."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore

TOKEN = "tok"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
#: A flag is a clinician's record: the device token's chart of one is refused (test_isolation_chart.py), so the
#: flags are charted by a nurse; the board is read with the device token, as the wall board reads it.
NURSE = {"Authorization": "Bearer nurse-jwt"}
PEOPLE = {"nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                              perms=frozenset({"board.view", "clinical.chart"}))}
FLAGS = ("contact", "droplet", "airborne", "protective")
UNRECORDED = {"contact": None, "droplet": None, "airborne": None, "protective": None, "types": [],
              "state": "unrecorded", "charted_at": None}


async def _resolve(credential: str):
    return PEOPLE.get(credential)


def _app(audit=None, identities=None):
    return create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve,
                      audit=audit if audit is not None else InMemoryAuditLog(), identities=identities)


def _at(minutes_ago: float) -> datetime:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).replace(microsecond=0)


def _chart(client, flags: dict, at: datetime, pid="S-101"):
    """The flags named, in the order given, at one time — as the box saves them (it sends all four)."""
    entries = [{"code": f"isolation_{name}", "value": value} for name, value in flags.items()]
    r = client.post(f"/clinical/{pid}", json={"entries": entries, "recorded_at": at.isoformat()}, headers=NURSE)
    assert r.status_code == 200, r.text


def _card(client, pid="S-101"):
    return next(p for p in client.get("/patients", headers=AUTH).json()["patients"] if p["patient_id"] == pid)


def _admitted() -> InMemoryIdentityStore:
    """S-102 admitted (a name from the HIS) and never measured: an identity-only card."""
    identities = InMemoryIdentityStore()
    identities.apply("h1", IdentityRecord(patient_id="S-102", given="Ayşe", family="Sentetik", unit="YB", room="1",
                                          bed="2", source="comed", updated_at=datetime(2026, 11, 12, tzinfo=timezone.utc)))
    return identities


class TestTheBlock:
    def test_a_measured_patient_nobody_charted_is_unrecorded(self):
        with TestClient(_app()) as client:
            assert client.post("/clinical/S-101", json={"entries": [{"code": "weight_kg", "value": 70}]},
                               headers=AUTH).status_code == 200
            assert _card(client)["isolation"] == UNRECORDED

    def test_each_flag_is_three_valued_and_the_types_follow_the_one_order(self):
        at = _at(10)
        with TestClient(_app()) as client:
            _chart(client, {"droplet": 1, "contact": 1, "airborne": 0}, at)          # charted out of order
            assert _card(client)["isolation"] == {
                "contact": True, "droplet": True, "airborne": False, "protective": None,
                "types": ["contact", "droplet"], "state": "isolated", "charted_at": at.isoformat()}

    def test_four_zeros_are_no_isolation_on_record_not_unrecorded(self):
        at = _at(10)
        with TestClient(_app()) as client:
            _chart(client, dict.fromkeys(FLAGS, 0), at)
            block = _card(client)["isolation"]
        assert (block["state"], block["types"], block["charted_at"]) == ("not_isolated", [], at.isoformat())
        assert [block[name] for name in FLAGS] == [False] * 4

    def test_each_flag_reads_its_own_latest_value_and_charted_at_is_the_newest(self):
        first, second = _at(60), _at(5)
        with TestClient(_app()) as client:
            _chart(client, {"contact": 1, "droplet": 1, "airborne": 0, "protective": 0}, first)
            _chart(client, {"droplet": 0}, second)                                  # one flag alone, later
            block = _card(client)["isolation"]
        assert (block["contact"], block["droplet"]) == (True, False)
        assert (block["types"], block["state"], block["charted_at"]) == (["contact"], "isolated", second.isoformat())

    def test_a_backdated_flag_older_than_the_latest_does_not_move_it(self):
        latest, older = _at(5), _at(120)
        with TestClient(_app()) as client:
            _chart(client, {"airborne": 1}, latest)
            _chart(client, {"airborne": 0}, older)
            block = _card(client)["isolation"]
        assert (block["airborne"], block["state"], block["charted_at"]) == (True, "isolated", latest.isoformat())

    def test_the_block_names_nobody(self):
        """§5 S2: who charted it is the `chart` rows' (/denetim); the card carries the time only."""
        with TestClient(_app()) as client:
            _chart(client, {"contact": 1}, _at(5))
            block = _card(client)["isolation"]
        assert set(block) == {*FLAGS, "types", "state", "charted_at"}


class TestTheIdentityOnlyCard:
    def test_it_carries_null(self):
        with TestClient(_app(identities=_admitted())) as client:
            card = _card(client, "S-102")
        assert card["isolation"] is None

    def test_a_flag_charted_on_it_makes_a_card_that_still_reads_unmeasured(self):
        """Spec D7: as a suspected-infection mark today — the engine state is created, `measuredAt` stays empty."""
        with TestClient(_app(identities=_admitted())) as client:
            _chart(client, {"contact": 1}, _at(5), pid="S-102")
            card = _card(client, "S-102")
        assert card["isolation"]["state"] == "isolated" and card["identity"]["display_name"]
        assert all(at is None for at in card["latest"]["at"].values())


class TestTheTrail:
    def test_a_restart_restores_the_flags_through_the_chart_replay(self):
        audit, at = InMemoryAuditLog(), _at(15)
        with TestClient(_app(audit)) as client:
            _chart(client, {"contact": 1, "droplet": 0, "airborne": 0, "protective": 1}, at)
            before = _card(client)["isolation"]
        with TestClient(_app(audit)) as client:
            after = _card(client)["isolation"]
        assert after == before
        assert (after["types"], after["charted_at"]) == (["contact", "protective"], at.isoformat())

    def test_a_chart_row_of_a_flag_this_build_does_not_know_is_skipped(self):
        """`rehydrate.observation_of` skips an unknown slug (as an older api skips these four): the rest replays."""
        audit, at = InMemoryAuditLog(), _at(30)
        for subject in ("isolation_quarantine", "isolation_contact"):
            audit.append(AuditEvent("h1", "chart", "S-101", subject, {
                "value": 1.0, "unit": "bool", "obs_ts": at.isoformat(), "charted_by": "hem.ayse"}))
        with TestClient(_app(audit)) as client:
            block = _card(client)["isolation"]
        assert (block["types"], block["charted_at"]) == (["contact"], at.isoformat())


def test_the_three_state_words_are_defined_once():
    """Review M3 (2026-11-13): the card's three isolation words are api/clinical.py's — the module of the four flags —
    and the card's writer (board.py) and its reader (infection.py) import them; neither spells one as a value (a field
    NAMED `isolated` — a count, a list — is a key, not the word, and is left alone)."""
    from homunculus.api import clinical
    assert (clinical.ISOLATED, clinical.NOT_ISOLATED, clinical.UNRECORDED) == ("isolated", "not_isolated", "unrecorded")
    api = Path(__file__).resolve().parents[1] / "src" / "homunculus" / "api"
    for name in ("board.py", "infection.py"):
        text = (api / name).read_text(encoding="utf-8")
        assert re.findall(r'"(?:isolated|not_isolated|unrecorded)"(?!\s*:)', text) == [], name
