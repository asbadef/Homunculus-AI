"""`rebased()`: a scenario moved in time, for a replay the trend charts can draw.

The scenarios are written at fixed dates (2026-07-14, 2026-09-08) and the charts' window ends at the
server's now, so an unmoved replay into a local stack draws an empty chart. Moved, every gap between
two events is kept, only the dates change. Also `scripts/replay.py`, which does the moving: its token
comes from the environment, never its command line. Synthetic data only, like the scenarios themselves.
"""
from __future__ import annotations

import email.message
import importlib.util
import io
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import pytest

import homunculus.scenarios
from homunculus.scenarios.loader import load_scenario, rebased

SCEN = Path(homunculus.scenarios.__file__).parent
SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "replay.py"
END = datetime(2026, 10, 19, 9, 0, tzinfo=timezone.utc)
TOKEN_VAR = "REPLAY_TEST_TOKEN"
SECRET = "synthetic-secret-value"


def gaps(events):
    ordered = sorted(ts for ts, _ in events)
    return [b - a for a, b in zip(ordered, ordered[1:])]


def test_the_last_event_lands_at_the_end_and_every_gap_is_kept():
    events = load_scenario(SCEN / "news2_deterioration.yaml")
    moved = rebased(events, END)
    assert moved[-1][0] == END
    assert [b[0] - a[0] for a, b in zip(moved, moved[1:])] == [b[0] - a[0] for a, b in zip(events, events[1:])]


def test_every_resource_carries_its_moved_instant_and_the_original_is_untouched():
    events = load_scenario(SCEN / "septic_shock.yaml")
    before = [resource["effectiveDateTime"] for _, resource in events]
    moved = rebased(events, END)
    assert all(resource["effectiveDateTime"] == ts.isoformat() for ts, resource in moved)
    assert [resource["effectiveDateTime"] for _, resource in events] == before
    assert moved[0][1]["valueQuantity"] == events[0][1]["valueQuantity"]


def test_the_copy_is_deep_so_changing_a_moved_reading_leaves_the_original_alone():
    events = load_scenario(SCEN / "septic_shock.yaml")
    value = events[0][1]["valueQuantity"]["value"]
    code = events[0][1]["code"]["coding"][0]["code"]
    moved = rebased(events, END)
    moved[0][1]["valueQuantity"]["value"] = -1.0
    moved[0][1]["code"]["coding"][0]["code"] = "changed"
    assert events[0][1]["valueQuantity"]["value"] == value
    assert events[0][1]["code"]["coding"][0]["code"] == code


def test_the_latest_event_is_the_one_anchored_even_when_the_events_arrive_unsorted():
    events = load_scenario(SCEN / "news2_deterioration.yaml")
    moved = rebased(list(reversed(events)), END)
    assert max(ts for ts, _ in moved) == END
    assert moved[0][0] == END
    assert gaps(moved) == gaps(events)


def test_a_naive_timestamp_is_read_as_utc_like_the_gateways_do():
    events = load_scenario(SCEN / "news2_deterioration.yaml")
    naive = [(ts.replace(tzinfo=None), resource) for ts, resource in events]
    moved = rebased(naive, END)
    assert moved[-1][0] == END
    assert all(ts.tzinfo is not None for ts, _ in moved)
    assert gaps(moved) == gaps(events)


def test_an_empty_scenario_stays_empty_and_a_zone_less_end_is_refused():
    assert rebased([], END) == []
    with pytest.raises(ValueError, match="time zone"):
        rebased(load_scenario(SCEN / "stable_control.yaml"), datetime(2026, 10, 19, 9, 0))


# --- scripts/replay.py -------------------------------------------------------------------------------

def replay_main():
    spec = importlib.util.spec_from_file_location("replay_script", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.main


@pytest.fixture
def sent(monkeypatch):
    """Every request the script makes, and the timeout it made it with; no network, no sleeping."""
    calls = []

    class Answer:
        def read(self):
            return b""

    def fake_urlopen(req, timeout=None):
        calls.append((req, timeout))
        return Answer()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr("time.sleep", lambda seconds: None)
    return calls


def test_a_token_on_the_command_line_is_refused_not_taken_for_an_abbreviation_of_token_env(sent, capsys):
    """argparse would read `--token SECRET` as `--token-env SECRET`: the secret becomes a variable name
    that is not set, the script falls back to the dev token and the server answers 401 without a hint."""
    main = replay_main()
    with pytest.raises(SystemExit) as refused:
        main(["--token", "x"])
    assert refused.value.code == 2
    assert "unrecognized arguments" in capsys.readouterr().err
    assert sent == []


def test_the_token_comes_from_the_variable_named_and_is_printed_nowhere(sent, monkeypatch, capsys):
    monkeypatch.setenv(TOKEN_VAR, SECRET)
    replay_main()(["stable_control.yaml", "0", "--url", "http://stack.invalid:18080/", "--token-env", TOKEN_VAR])
    shown = capsys.readouterr()
    assert len(sent) == 7
    assert {req.get_header("Authorization") for req, _ in sent} == {f"Bearer {SECRET}"}
    assert {req.full_url for req, _ in sent} == {"http://stack.invalid:18080/ingest"}
    assert SECRET not in shown.out + shown.err
    assert "note:" not in shown.err


def test_with_the_variable_unset_the_dev_token_is_used_and_one_note_names_the_variable(sent, monkeypatch, capsys):
    monkeypatch.delenv(TOKEN_VAR, raising=False)
    replay_main()(["stable_control.yaml", "0", "--token-env", TOKEN_VAR])
    shown = capsys.readouterr()
    assert {req.get_header("Authorization") for req, _ in sent} == {"Bearer dev-token"}
    assert shown.err.count(f"note: {TOKEN_VAR} is not set; using the dev token") == 1
    assert shown.err.count("note:") == 1


def test_every_request_has_a_timeout_so_a_dead_stack_cannot_hang_the_replay(sent):
    replay_main()(["stable_control.yaml", "0"])
    assert {timeout for _, timeout in sent} == {15}


def test_now_sends_the_moved_instants_and_without_it_the_scenario_keeps_its_own_dates(sent, capsys):
    main = replay_main()
    main(["stable_control.yaml", "0", "--now"])
    moved = [json.loads(req.data)["effectiveDateTime"] for req, _ in sent]
    assert datetime.fromisoformat(moved[-1]) > datetime(2026, 10, 1, tzinfo=timezone.utc)
    sent.clear()
    main(["stable_control.yaml", "0"])
    kept = [json.loads(req.data)["effectiveDateTime"] for req, _ in sent]
    assert kept == [resource["effectiveDateTime"] for _, resource in load_scenario(SCEN / "stable_control.yaml")]


@pytest.mark.parametrize("body, said", [
    (b'{"detail": "bad device token"}', "bad device token"),
    (b"<html>gateway</html>", "no detail"),
])
def test_a_refusal_stops_the_replay_and_says_what_the_server_said_never_a_header(monkeypatch, capsys, body, said):
    headers = email.message.Message()
    headers["Authorization"] = f"Bearer {SECRET}"

    def refuse(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", headers, io.BytesIO(body))

    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    monkeypatch.setattr("time.sleep", lambda seconds: None)
    monkeypatch.setenv(TOKEN_VAR, SECRET)
    with pytest.raises(SystemExit) as stopped:
        replay_main()(["stable_control.yaml", "0", "--token-env", TOKEN_VAR])
    shown = capsys.readouterr()
    assert stopped.value.code == 1
    assert "401" in shown.err and said in shown.err
    assert SECRET not in shown.out + shown.err
