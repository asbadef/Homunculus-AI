"""Aşama A's read-only acceptance check (deploy/infinity/shadow_check.py), on fake answers.

It judges two readings of GET /infinity-shadow/board and GET /patients a window apart, prints counts,
ages and hashes — never a physiological value, a patient id or the token — and still prints the
board's hash when the strip's endpoint does not exist yet (the old build: D-2's "before").
Synthetic addresses (192.0.2.x) and made-up values only.
"""
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("shadow_check", ROOT / "deploy/infinity/shadow_check.py")
check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check)

SHA = "ab12cd34ef56" + "0" * 52
TOKEN = "T" * 48
UNASSIGNED = ("192.0.2.28", "192.0.2.34")
# Distinctive made-up readings: none of these numbers may appear in anything printed.
HR, SPO2 = 187, 63


def param(name, value, age):
    return {"parameter": name, "state": "value", "value": value, "unit": "bpm", "age_s": age,
            "last_at": "2026-10-20T09:00:00+00:00", "evidence": "screen_match_two_devices", "partial": False}


def board(*, sent=100, lag=(1000, 250_000, 0, 0, 0, 400, 500, 100, 0, 0), state="ok", stage="shadow",
          version=1, sha=SHA, table_status="ok", unassigned=UNASSIGNED):
    return {
        "stage": stage, "display_max_age_s": 15,
        "table": {"status": table_status, "reason": None, "version": version, "sha256": sha,
                  "approved_at": "2026-10-16", "site": "synthetic"},
        "feed": {"state": state, "last_post_age_s": 2.0, "collector_connected": True, "posts": sent,
                 "forwarder": {"interval_s": 5, "sent": sent, "failed": 0, "decoder": "x"},
                 "lag_ms": list(lag), "rejected": {"too_old": 0},
                 "devices": {"total": 4, "streaming": 2, "standby": 1, "silent": 1, "waiting": 0,
                             "unsupported": 0, "unknown": 0}, "unassigned": len(unassigned)},
        "beds": [{"bed_label": "B-1", "source": "192.0.2.10", "status": "streaming", "link": "one",
                  "patient_id": "S-SECRET-1", "parameters": [param("hr", HR, 2.4), param("spo2", SPO2, 3.1)]},
                 {"bed_label": "B-2", "source": "192.0.2.11", "status": "standby", "link": "none",
                  "patient_id": None, "parameters": []}],
        "unassigned": [{"source": s, "reason": "table_unassigned", "status": "standby", "parameters": []}
                       for s in unassigned],
    }


PATIENTS = {"patients": [{"patient_id": "S-SECRET-1", "alerts": [{"kind": "news2", "elapsed_sec": 12}],
                          "latest": {"heart_rate": 91}}], "scope": {"unrestricted": True}}

BEFORE = (board(sent=40, lag=(0, 0, 0, 0, 0, 0, 0, 0, 0, 0)), PATIENTS)
AFTER = (board(sent=100), PATIENTS)
EXPECT = {"table_version": 1, "table_sha": SHA[:12], "unassigned": UNASSIGNED}


def results(before=BEFORE, after=AFTER, window_s=300, **over):
    return {name: ok for name, ok, _ in check.evaluate(before, after, window_s=window_s, **{**EXPECT, **over})}


def test_a_good_pair_passes_every_criterion():
    rows = results()
    assert rows == {name: True for name in ("asama", "tablo", "besleme", "atanmamis", "gecikme", "gonderim")}


@pytest.mark.parametrize(("after", "over", "failed"), [
    (board(stage="off"), {}, "asama"),
    (board(version=2), {}, "tablo"),
    (board(sha="ff" * 32), {}, "tablo"),
    (board(table_status="missing"), {}, "tablo"),
    (board(), {"table_version": None}, "tablo"),
    (board(state="forwarder_silent"), {}, "besleme"),
    (board(unassigned=("192.0.2.28",)), {}, "atanmamis"),
    (board(), {"unassigned": ("192.0.2.28", "192.0.2.34", "192.0.2.38")}, "atanmamis"),
    (board(lag=(1000, 2_000_000, 0, 0, 0, 400, 500, 100, 0, 0)), {}, "gecikme"),         # mean 2000 ms
    (board(lag=(1000, 250_000, 0, 0, 0, 400, 500, 80, 0, 20)), {}, "gecikme"),           # 98 % <= 3 s
    (board(sent=60), {}, "gonderim"),                                                    # 20 < 54
    (board(sent=10), {}, "gonderim"),                                                    # a reset counter
])
def test_each_criterion_fails_on_its_own(after, over, failed):
    rows = results(after=(after, PATIENTS), **over)
    assert rows[failed] is False
    assert all(ok for name, ok in rows.items() if name != failed), rows


def test_no_reading_in_the_window_cannot_pass_the_lag_criterion():
    assert results(after=(board(lag=(0,) * 10), PATIENTS))["gecikme"] is False


def test_the_board_projection_ignores_the_ageing_keys_at_every_depth_and_key_order():
    one = {"patients": [{"b": 1, "a": {"elapsed_sec": 5, "x": [{"remaining_sec": 9, "y": 2}]}}]}
    two = {"patients": [{"a": {"x": [{"y": 2, "remaining_sec": 1}], "elapsed_sec": 99}, "b": 1}]}
    assert check.projection(one) == check.projection(two)
    assert check.projection(one) != check.projection({"patients": [{"b": 2, "a": {"x": [{"y": 2}]}}]})
    summary = check.summary(PATIENTS)
    assert set(summary) == {"sha256", "cards", "alerts"} and (summary["cards"], summary["alerts"]) == (1, 1)


def test_what_it_prints_holds_no_value_no_patient_and_no_token():
    lines = check.report(BEFORE, AFTER, window_s=300, **EXPECT)
    text = "\n".join(lines)
    assert "SONUÇ: KABUL" in text and lines[-1].startswith("PANO_OZET ")
    assert '"value"' not in text and "value" not in text.lower()
    assert set(json.loads(lines[-1].split(" ", 1)[1])) == {"sha256", "cards", "alerts"}   # a hash and two counts
    readable = "\n".join(lines[:-1])                     # the hash is hex: it may hold any two digits
    for secret in (str(HR), str(SPO2), "S-SECRET-1", "91", TOKEN):
        assert secret not in readable, secret
    assert "S-SECRET-1" not in text and TOKEN not in text
    assert "B-1" in text and "2 taze değer" in text and "en eski 3.1 sn" in text    # counts and ages only
    assert "192.0.2.28" in text and "table_unassigned" in text


def nbp(state, *, measured=None, changed=None):
    shown = state == "value"
    return {"parameter": "nbp", "state": state, "systolic": 211 if shown else None,
            "diastolic": 37 if shown else None, "mean": 95 if shown else None, "unit": "mmHg",
            "age_s": 2.0 if shown else measured, "last_at": changed, "changed_at": changed,
            "measured_age_s": measured, "evidence": "screen_match", "partial": False}


def test_the_nbp_line_counts_devices_and_the_oldest_change_and_never_prints_a_pressure():
    after = board()
    after["beds"][0]["parameters"].append(nbp("value", measured=2821.0, changed="2026-10-20T08:13:00+00:00"))
    after["beds"][1]["parameters"].append(nbp("old"))                                   # no change seen yet
    after["unassigned"][0]["parameters"].append(nbp("old", measured=9000.0, changed="2026-10-20T06:30:00+00:00"))
    lines = check.report(BEFORE, (after, PATIENTS), window_s=300, **EXPECT)
    readable = "\n".join(lines[:-1])
    assert ("nbp: 1 cihazda ölçüm saati ≤ ile gösteriliyor (en eski 48 dk önce), 1 cihazda ölçüm bekleniyor, "
            "1 cihazda gizli (eski)") in readable
    assert "3 taze değer" in readable                       # a shown NBP is a fresh cell like any other
    for secret in ("211", "37", "95"):
        assert secret not in readable, secret
    assert "nbp: 0 cihazda" in "\n".join(check.report(BEFORE, AFTER, window_s=300, **EXPECT))


def test_the_nbp_line_names_the_oldest_change_among_every_device_showing_one():
    # Three devices show NBP, the oldest change in the middle: the line names that one, not the first,
    # the last or the youngest.
    after = board()
    for card, measured in ((after["beds"][0], 300.0), (after["beds"][1], 2821.0), (after["unassigned"][0], 1200.0)):
        card["parameters"].append(nbp("value", measured=measured, changed="2026-10-20T08:13:00+00:00"))
    assert check.nbp_line(after) == ("nbp: 3 cihazda ölçüm saati ≤ ile gösteriliyor (en eski 48 dk önce), "
                                     "0 cihazda ölçüm bekleniyor, 0 cihazda gizli (eski)")


def test_a_missing_endpoint_is_stage_yok_and_the_board_hash_is_still_printed(tmp_path, capsys):
    env = tmp_path / ".env"
    env.write_text(f"TENANT_SLUG=demo\nTENANT_TOKEN={TOKEN}\n", encoding="utf-8")
    asked = []

    def get(path, token):
        asked.append((path, token == TOKEN))
        if path == "/infinity-shadow/board":
            raise check.Missing()                       # the old build: 404, or nginx's HTML page
        return PATIENTS

    assert check.main(["--window", "0"], get=get, sleep=lambda s: None, env_path=str(env)) == 0
    out = capsys.readouterr().out
    assert "aşama: yok" in out and "SONUÇ: RED" in out
    assert out.strip().splitlines()[-1].startswith("PANO_OZET ")
    assert json.loads(out.strip().splitlines()[-1].split(" ", 1)[1]) == check.summary(PATIENTS)
    assert TOKEN not in out and all(ok for _, ok in asked)
