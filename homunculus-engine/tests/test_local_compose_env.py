"""Every setting the API reads for a hospital decision must reach the API's container.

`deploy/local/docker-compose.yml` hands the API an explicit `environment:` list; `.env` is only
what compose interpolates into it. A name the engine reads but compose does not pass is a switch
that does nothing: an administrator sets it in `.env`, restarts, and the API never sees it. That
is how `SCOPE_ENFORCE_UNASSIGNED` shipped (G1-15, F1): read by `scope/resolver.py`, absent from
the compose file and from `.env.example`.

These tests read the modules' source, not a hand-written list, so the next name added to them
fails here until compose passes it and `.env.example` explains it. A name is an upper-case
string literal handed to a call (`os.getenv("X")`, `os.environ.get("X")`, or a helper such as
`session_policy._whole_number(env, "X", ...)`) or used as `os.environ["X"]`.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

import yaml

_REPO = Path(__file__).resolve().parents[2]
_SRC = _REPO / "homunculus-engine" / "src" / "homunculus"
_COMPOSE = _REPO / "deploy" / "local" / "docker-compose.yml"
_ENV_EXAMPLE = _REPO / "deploy" / "local" / ".env.example"

# The modules whose settings are a hospital's decision, set in the VM's .env.
_MODULES = [
    _SRC / "scope" / "resolver.py",
    _SRC / "auth" / "session_policy.py",
    _SRC / "api" / "infinity_shadow.py",
    _SRC / "api" / "infinity_rules.py",
    _SRC / "api" / "infinity_waves.py",
]
# What the scan must find at least, so a scanner that goes blind cannot pass vacuously.
_KNOWN = {"SCOPE_ENFORCE_UNASSIGNED", "SCREEN_LOCK_IDLE_MINUTES", "SCREEN_LOCK_SIGNOUT_HOURS",
          "INFINITY_CLINICAL_STAGE", "INFINITY_RULES_PARAMETERS", "INFINITY_WAVES"}

_ENV_NAME = re.compile(r"[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+")

# `api/prodserver.py` is the composition root: it reads the wiring (the database, the keys) as well as
# the switches a hospital sets, and a switch added there must reach the container like any other
# (G3-05 B5 review: READINGS_UNKNOWN_KEY was read there and passed nowhere). It is scanned the same way;
# the names below are the wiring the local stack deliberately does not pass or does not list in
# `.env.example`, each with its reason, so that a NEW name fails until it is passed and explained.
_PRODSERVER = _SRC / "api" / "prodserver.py"
_NOT_PASSED = {
    "AUDIT_DB_PATH": "the SQLite audit file of a development start; the stack runs Postgres",
    "IDENTITY_DB_PATH": "the SQLite identity file of a development start; the stack runs Postgres",
    "DATABASE_SSL": "deliberately unset: the database is on the same host (compose says so above DATABASE_URL)",
}
_NOT_EXPLAINED = {
    **_NOT_PASSED,
    "DATABASE_URL": "compose builds it from POSTGRES_PASSWORD, which .env.example does explain",
    "BED_MAPPING_PATH": "compose pins it to the mounted bed-mapping.json (a volume, not a setting)",
}


def _is_os_environ(node: ast.AST) -> bool:
    return (isinstance(node, ast.Attribute) and node.attr == "environ"
            and isinstance(node.value, ast.Name) and node.value.id == "os")


def _env_names(path: Path) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"), filename=str(path))):
        candidates: list[ast.AST] = []
        if isinstance(node, ast.Call):
            candidates = list(node.args)
        elif isinstance(node, ast.Subscript) and _is_os_environ(node.value):
            candidates = [node.slice]
        for arg in candidates:
            if (isinstance(arg, ast.Constant) and isinstance(arg.value, str)
                    and _ENV_NAME.fullmatch(arg.value)):
                names.add(arg.value)
    return names


def _read_names() -> dict[str, set[str]]:
    return {path.relative_to(_SRC).as_posix(): _env_names(path) for path in _MODULES}


def _api_environment_keys() -> set[str]:
    environment = yaml.safe_load(_COMPOSE.read_text(encoding="utf-8"))["services"]["api"]["environment"]
    if isinstance(environment, dict):
        return set(environment)
    return {entry.split("=", 1)[0] for entry in environment}


def test_the_scan_finds_the_settings_it_is_meant_to_guard():
    found = set().union(*_read_names().values())
    assert _KNOWN <= found, f"the scan missed {sorted(_KNOWN - found)}"
    assert all(_read_names().values()), "a module yielded no setting at all"


def test_compose_passes_every_setting_the_modules_read_to_the_api():
    keys = _api_environment_keys()
    missing = {module: sorted(names - keys) for module, names in _read_names().items()
               if names - keys}
    assert not missing, (
        f"read by the engine but not in deploy/local/docker-compose.yml's api.environment, so "
        f"setting them in .env does nothing: {missing}")


def test_env_example_explains_every_setting_the_modules_read():
    text = _ENV_EXAMPLE.read_text(encoding="utf-8")
    undocumented = sorted(name for names in _read_names().values() for name in names
                          if not re.search(rf"^#?{name}=", text, re.M))
    assert not undocumented, f"no line (commented or not) in deploy/local/.env.example: {undocumented}"


def test_the_scan_finds_the_production_servers_settings():
    found = _env_names(_PRODSERVER)
    assert {"READINGS_UNKNOWN_KEY", "DATABASE_URL", "PHI_ENCRYPTION_KEY"} <= found, sorted(found)
    assert set(_NOT_EXPLAINED) <= found, f"an exemption that no longer applies: {sorted(set(_NOT_EXPLAINED) - found)}"


def test_compose_passes_every_setting_the_production_server_reads_to_the_api():
    missing = sorted(_env_names(_PRODSERVER) - _api_environment_keys() - set(_NOT_PASSED))
    assert not missing, (
        f"read by api/prodserver.py but not in deploy/local/docker-compose.yml's api.environment, so "
        f"setting them in .env does nothing: {missing}")


def test_env_example_explains_every_setting_the_production_server_reads():
    text = _ENV_EXAMPLE.read_text(encoding="utf-8")
    undocumented = sorted(name for name in _env_names(_PRODSERVER) - set(_NOT_EXPLAINED)
                          if not re.search(rf"^#?{name}=", text, re.M))
    assert not undocumented, f"no line (commented or not) in deploy/local/.env.example: {undocumented}"
