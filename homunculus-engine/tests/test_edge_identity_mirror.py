"""The bridge's local mirror: the only thing that can answer a device query in milliseconds.

Names here are synthetic. The mirror exists because the device waits: NCE gives the host ten
seconds, and a round trip to the cloud on every patient lookup would be a bet on the uplink.
"""
from datetime import datetime, timedelta, timezone

from homunculus.crypto import decrypt_phi
from homunculus.edge.adt import PatientIdentity
from homunculus.edge.identity import IdentityMirror

WHEN = datetime(2026, 9, 4, 14, 30, tzinfo=timezone.utc)


def record(**over) -> PatientIdentity:
    base = dict(patient_id="20239121", family="YILMAZ", given="AYSE", birth_date="1980-01-15",
                sex="female", unit="YB", room="304", bed="2", state="admitted", at=WHEN)
    return PatientIdentity(**{**base, **over})


def test_an_identity_written_can_be_read_back(tmp_path):
    mirror = IdentityMirror(tmp_path / "identity.db")
    mirror.upsert(record())
    got = mirror.get("20239121")
    assert (got.family, got.given, got.birth_date, got.sex) == ("YILMAZ", "AYSE", "1980-01-15", "female")
    assert mirror.get("nobody") is None
    mirror.close()


def test_the_name_is_encrypted_on_disk(tmp_path):
    """A grep of the file must not turn up a patient. The engine's PHI helper does the work."""
    path = tmp_path / "identity.db"
    mirror = IdentityMirror(path)
    mirror.upsert(record())
    mirror.close()
    blob = path.read_bytes()
    assert b"YILMAZ" not in blob and b"AYSE" not in blob
    assert b"20239121" in blob            # the key itself is not encrypted: it is the lookup


def test_an_older_message_does_not_overwrite_a_newer_record(tmp_path):
    mirror = IdentityMirror(tmp_path / "identity.db")
    mirror.upsert(record(family="YENI", at=WHEN))
    mirror.upsert(record(family="ESKI", at=WHEN - timedelta(minutes=5)))
    assert mirror.get("20239121").family == "YENI"
    mirror.close()


def test_a_repeated_message_is_harmless(tmp_path):
    mirror = IdentityMirror(tmp_path / "identity.db")
    mirror.upsert(record())
    mirror.upsert(record())
    assert mirror.count() == 1
    mirror.close()


def test_a_discharged_record_survives_24_hours_then_is_pruned(tmp_path):
    mirror = IdentityMirror(tmp_path / "identity.db")
    mirror.upsert(record(state="discharged"))
    assert mirror.prune(now=WHEN + timedelta(hours=23)) == 0
    assert mirror.get("20239121") is not None
    assert mirror.prune(now=WHEN + timedelta(hours=25)) == 1
    assert mirror.get("20239121") is None
    mirror.close()


def test_an_admitted_record_is_never_pruned(tmp_path):
    mirror = IdentityMirror(tmp_path / "identity.db")
    mirror.upsert(record())
    assert mirror.prune(now=WHEN + timedelta(days=30)) == 0
    mirror.close()


def test_the_record_survives_a_restart(tmp_path):
    path = tmp_path / "identity.db"
    first = IdentityMirror(path)
    first.upsert(record())
    first.close()
    second = IdentityMirror(path)
    assert second.get("20239121").given == "AYSE"
    second.close()


def test_decryption_round_trips_through_the_engine_helper(tmp_path):
    """Pinned so a change of crypto helper cannot silently write plaintext."""
    mirror = IdentityMirror(tmp_path / "identity.db")
    mirror.upsert(record())
    row = mirror._conn.execute("SELECT family FROM identity").fetchone()
    assert decrypt_phi(row[0]) == "YILMAZ"
    mirror.close()
