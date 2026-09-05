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
