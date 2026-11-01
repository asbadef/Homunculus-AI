# homunculus-engine/tests/test_esleme_ozet.py
"""deploy/infinity/esleme_ozet.py (spec §7.2): the summary of the strip the blocks print before and
after, and the comparison of two. Fixed synthetic boards; no network, no database."""
from __future__ import annotations

import ast
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "deploy" / "infinity" / "esleme_ozet.py"


def _load():
    spec = importlib.util.spec_from_file_location("esleme_ozet", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BOARD = {
    "stage": "rules",
    "table": {"status": "ok", "version": 13, "sha256": "e470d3342025100ad3dce0e6e42606aa37051d18f4bcac8f02a5abfa3b3b79af"},
    "feed": {"devices": {"total": 3}},
    "beds": [{"source": "10.10.203.24", "bed_id": "ec5a3244-426b-4877-af3c-bb2bb829ce1f", "bed_label": "BED11",
              "link": "one", "patient_id": "H2600042", "parameters": [{"parameter": "hr", "value": 72}]},
             {"source": "10.10.203.23", "bed_id": "ccbcafd3-0e2c-4c20-8960-e260cf02f3af", "bed_label": "BED05",
              "link": "none", "patient_id": None, "parameters": []}],
    "unassigned": [{"source": "10.10.203.40", "reason": "not_in_table"}],
}


def test_the_summary_holds_beds_unassigned_links_and_the_table_and_no_patient_or_value():
    summary = _load().summary(BOARD)
    assert summary == {
        "beds": [["10.10.203.23", "ccbcafd3-0e2c-4c20-8960-e260cf02f3af", "BED05"],
                 ["10.10.203.24", "ec5a3244-426b-4877-af3c-bb2bb829ce1f", "BED11"]],
        "unassigned": [["10.10.203.40", "not_in_table"]], "link_one": 1, "devices_total": 3,
        "table": {"status": "ok", "version": 13, "sha12": "e470d3342025"}, "stage": "rules"}
    text = json.dumps(summary)
    assert "H2600042" not in text and "72" not in text.replace("e470d3342025", "")


def test_main_prints_one_labelled_line_and_never_the_token(tmp_path, capsys):
    env = tmp_path / ".env"
    env.write_text("TENANT_TOKEN='gizli-sentetik-token'\n", encoding="utf-8")
    seen = []

    def get(path, token):
        seen.append((path, token))
        return BOARD

    assert _load().main(["--etiket", "ONCE"], get=get, env_path=str(env)) == 0
    out = capsys.readouterr().out.strip()
    assert out.startswith("ESLEME_OZET_ONCE {") and "gizli" not in out
    assert seen == [("/infinity-shadow/board", "gizli-sentetik-token")]


def test_the_comparison_names_what_differs(tmp_path, capsys):
    module = _load()
    before = module.summary(BOARD)
    after = json.loads(json.dumps(before))
    after["beds"][0][2] = "bed05"
    once, sonra = tmp_path / "once.txt", tmp_path / "sonra.txt"
    once.write_text("ESLEME_OZET_ONCE " + json.dumps(before) + "\n", encoding="utf-8")
    sonra.write_text("ESLEME_OZET_SONRA " + json.dumps(after) + "\n", encoding="utf-8")
    assert module.main(["--karsilastir", str(once), str(once)]) == 0
    assert "AYNI" in capsys.readouterr().out
    assert module.main(["--karsilastir", str(once), str(sonra)]) == 1
    assert "FARKLI: beds" in capsys.readouterr().out


# ---- departures (E41 ...): the cases the blocks will actually meet -------------------------------------


def _env(tmp_path, text="TENANT_TOKEN='gizli-sentetik-token'\n"):
    path = tmp_path / ".env"
    path.write_text(text, encoding="utf-8")
    return str(path)


def _saved(tmp_path, name, label, summary, *, before="", bom=False):
    path = tmp_path / name
    text = before + f"ESLEME_OZET_{label} " + json.dumps(summary) + "\n"
    path.write_bytes((b"\xef\xbb\xbf" if bom else b"") + text.encode("utf-8"))
    return str(path)


def test_the_line_has_exactly_the_summary_keys_and_no_patient_value_note_or_unit(tmp_path, capsys):
    board = json.loads(json.dumps(BOARD))
    board["beds"][0]["parameters"] = [{"parameter": "hr", "value": 7351.9, "state": "value", "age_s": 0.4}]
    board["beds"][0]["unit_id"] = "5b0d6c1e-0000-4000-8000-000000000001"
    board["unassigned"][0]["note"] = "Sentetik not metni"
    board["unassigned"][0]["parameters"] = [{"parameter": "spo2", "value": 9418.2}]
    assert _load().main(["--etiket", "ONCE"], get=lambda p, t: board, env_path=_env(tmp_path)) == 0
    out = capsys.readouterr().out.strip()
    label, body = out.split(" ", 1)
    assert label == "ESLEME_OZET_ONCE"
    assert set(json.loads(body)) == {"beds", "unassigned", "link_one", "devices_total", "table", "stage"}
    for leak in ("H2600042", "7351", "9418", "Sentetik", "5b0d6c1e", "gizli"):
        assert leak not in out


def test_a_label_only_row_a_failed_table_and_an_empty_board_do_not_break_the_summary():
    module = _load()
    board = {"table": {"status": "invalid", "version": None, "sha256": None},
             "beds": [{"source": "10.10.203.25", "bed_id": None, "bed_label": "BED01", "link": "none"},
                      {"source": "10.10.203.9", "bed_id": "ccbcafd3-0e2c-4c20-8960-e260cf02f3af", "bed_label": "BED05",
                       "link": "hidden"},
                      {"source": None, "bed_id": None, "bed_label": None}],
             "unassigned": []}
    summary = module.summary(board)
    assert summary["beds"] == [[None, None, None],
                               ["10.10.203.25", None, "BED01"],
                               ["10.10.203.9", "ccbcafd3-0e2c-4c20-8960-e260cf02f3af", "BED05"]]
    assert summary["link_one"] == 0 and summary["devices_total"] is None
    assert summary["table"] == {"status": "invalid", "version": None, "sha12": ""}
    assert module.summary({}) == {"beds": [], "unassigned": [], "link_one": 0, "devices_total": None,
                                  "table": {"status": None, "version": None, "sha12": ""}, "stage": None}


@pytest.mark.parametrize("text", ["OTHER=1\n", "TENANT_TOKEN=\n", "TENANT_TOKEN=''\r\n"])
def test_a_missing_or_blank_token_exits_2_and_asks_nothing(tmp_path, capsys, text):
    def get(path, token):
        raise AssertionError("the board must not be asked without a token")

    assert _load().main(["--etiket", "ONCE"], get=get, env_path=_env(tmp_path, text)) == 2
    captured = capsys.readouterr()
    assert captured.out == "" and "TENANT_TOKEN" in captured.err


def test_a_missing_env_file_exits_2(tmp_path, capsys):
    assert _load().main(["--etiket", "ONCE"], get=lambda p, t: BOARD, env_path=str(tmp_path / "yok.env")) == 2
    captured = capsys.readouterr()
    assert captured.out == "" and ".env" in captured.err


def test_the_token_forms_of_an_env_file_all_read(tmp_path):
    module = _load()
    assert module._token(_env(tmp_path, "A=1\nTENANT_TOKEN=abc\r\nB=2\n")) == "abc"
    assert module._token(_env(tmp_path, 'TENANT_TOKEN="abc"\n')) == "abc"
    assert module._token(_env(tmp_path, "TENANT_TOKEN='a=b'\n")) == "a=b"


class _Refused(Exception):
    code = 503


@pytest.mark.parametrize("raised, named", [(RuntimeError("Bearer gizli-sentetik-token"), "RuntimeError"),
                                           (_Refused("Bearer gizli-sentetik-token"), "503")])
def test_a_failed_read_exits_2_names_the_failure_and_never_prints_the_token(tmp_path, capsys, raised, named):
    def get(path, token):
        raise raised

    assert _load().main(["--etiket", "ONCE"], get=get, env_path=_env(tmp_path)) == 2
    captured = capsys.readouterr()
    assert captured.out == "" and named in captured.err and "gizli" not in captured.err


def test_a_board_that_is_not_an_object_exits_2_and_prints_none_of_it(tmp_path, capsys):
    assert _load().main(["--etiket", "ONCE"], get=lambda p, t: ["H2600042"], env_path=_env(tmp_path)) == 2
    captured = capsys.readouterr()
    assert captured.out == "" and "H2600042" not in captured.err


def test_the_label_is_one_word(capsys):
    with pytest.raises(SystemExit) as stopped:
        _load().main(["--etiket", "ON CE"], get=lambda p, t: BOARD, env_path="x")
    assert stopped.value.code == 2
    assert "etiket" in capsys.readouterr().err


def test_the_comparison_reads_the_labelled_line_among_others_and_past_a_bom(tmp_path, capsys):
    module = _load()
    summary = module.summary(BOARD)
    plain = _saved(tmp_path, "a.txt", "ONCE", summary)
    noisy = _saved(tmp_path, "b.txt", "SONRA", summary, before="Warning: Permanently added a host\n", bom=True)
    assert module.main(["--karsilastir", plain, noisy]) == 0
    assert "AYNI" in capsys.readouterr().out


def test_a_saved_file_without_the_line_or_with_a_broken_one_exits_2(tmp_path, capsys):
    module = _load()
    good = _saved(tmp_path, "good.txt", "ONCE", module.summary(BOARD))
    empty = tmp_path / "empty.txt"
    empty.write_text("durdum\n", encoding="utf-8")
    broken = tmp_path / "broken.txt"
    broken.write_text("ESLEME_OZET_SONRA {not json\n", encoding="utf-8")
    for bad in (str(empty), str(broken), str(tmp_path / "yok.txt")):
        assert module.main(["--karsilastir", good, bad]) == 2
        captured = capsys.readouterr()
        assert "AYNI" not in captured.out and "FARKLI" not in captured.out
        assert captured.err.strip()


def test_every_differing_part_is_named_and_the_table_is_shown_not_judged(tmp_path, capsys):
    module = _load()
    before = module.summary(BOARD)
    after = json.loads(json.dumps(before))
    after["unassigned"] = []
    after["link_one"] = 0
    once, sonra = (_saved(tmp_path, "once.txt", "ONCE", before), _saved(tmp_path, "sonra.txt", "SONRA", after))
    assert module.main(["--karsilastir", once, sonra]) == 1
    assert "FARKLI: unassigned, link_one" in capsys.readouterr().out

    # The table is not compared (spec §7.2: it changes at the switch, A-9 item 4), but both readings are shown.
    before["table"] = {"status": "ok", "version": 2, "sha12": "84ac1760d59f"}
    once = _saved(tmp_path, "once2.txt", "ONCE", before)
    sonra = _saved(tmp_path, "sonra2.txt", "SONRA", module.summary(BOARD))
    assert module.main(["--karsilastir", once, sonra]) == 0
    out = capsys.readouterr().out
    assert "AYNI" in out and "84ac1760d59f" in out and "e470d3342025" in out
    assert out.isascii()


def test_the_script_imports_only_the_standard_library():
    tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported |= {alias.name.split(".")[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.level == 0:
            imported.add((node.module or "").split(".")[0])
    assert imported and imported <= set(sys.stdlib_module_names)


def test_it_runs_from_stdin_as_the_blocks_pipe_it(tmp_path):
    """`... show <commit>:deploy/infinity/esleme_ozet.py | ssh ... 'python3 - --etiket ONCE'`: the script is the
    program's stdin, isolated mode, nothing of the project on the path."""
    module = _load()
    saved = _saved(tmp_path, "once.txt", "ONCE", module.summary(BOARD))
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    for args, wanted in ((["--help"], "usage: esleme_ozet.py"), (["--karsilastir", saved, saved], "AYNI")):
        done = subprocess.run([sys.executable, "-I", "-", *args], input=SCRIPT.read_bytes(), capture_output=True,
                              timeout=60, env=env, cwd=str(tmp_path))
        assert done.returncode == 0, done.stderr.decode("utf-8", "replace")
        assert wanted in done.stdout.decode("utf-8", "replace")
