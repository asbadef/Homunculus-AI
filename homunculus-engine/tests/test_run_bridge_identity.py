"""The runner's identity wiring: a default path beside the buffer, and a counter in the report.

scripts/ is not an importable package (see tests/test_run_nce_bridge.py), and pyproject.toml's
pythonpath is ["src", "tests"] only -- a plain `import run_bridge` raises ModuleNotFoundError, not
the AttributeError a missing attribute would give. So this loads the module by file path, the same
way test_run_nce_bridge.py does for its one call site.
"""
import importlib.util
import pathlib

_spec = importlib.util.spec_from_file_location(
    "run_bridge", pathlib.Path(__file__).resolve().parents[1] / "scripts" / "run_bridge.py")
run_bridge = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(run_bridge)


def test_the_identity_database_defaults_to_a_sibling_of_the_buffer():
    args = run_bridge.build_parser().parse_args(["--db", "/data/bridge.db"])
    assert run_bridge.identity_path(args) == "/data/bridge.db.identity"


def test_an_explicit_identity_path_wins():
    args = run_bridge.build_parser().parse_args(
        ["--db", "/data/bridge.db", "--identity-db", "/data/other.db"])
    assert run_bridge.identity_path(args) == "/data/other.db"


def test_identity_can_be_switched_off_for_a_site_with_no_his():
    args = run_bridge.build_parser().parse_args(["--db", "/data/bridge.db", "--no-identity"])
    assert run_bridge.identity_path(args) is None


def test_a_mirror_that_cannot_be_opened_does_not_stop_the_bridge(tmp_path, caplog):
    """A directory where a file should be: sqlite cannot open it. The runner must carry on."""
    blocked = tmp_path / "identity.db"
    blocked.mkdir()
    with caplog.at_level("ERROR", logger="bridge"):
        assert run_bridge.open_identity_mirror(str(blocked)) is None
    assert any("aynasız devam" in r.getMessage() for r in caplog.records)


def test_no_path_means_no_mirror_and_no_noise(caplog):
    with caplog.at_level("ERROR", logger="bridge"):
        assert run_bridge.open_identity_mirror(None) is None
    assert caplog.records == []
