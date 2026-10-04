"""The API image's dependencies, read from the files it is built from: pyproject.toml (what the
engine needs), constraints.txt (the exact versions the image installs) and Dockerfile.api.

Two ways a rebuild broke, or could break, the API without one line of its code changing: a new
release resolved by `pip install .` — SQLAlchemy 2.1 stopped installing greenlet unless asked
(`sqlalchemy[asyncio]`), and `sqlalchemy.ext.asyncio`, the whole database layer, no longer
imported in a fresh image — and an image built later than the tests ran, with other versions
than the ones they ran against. The image installs from constraints.txt; these tests keep that
file and pyproject.toml in step.
"""
import re
import tomllib
from pathlib import Path

from packaging.requirements import Requirement

_ROOT = Path(__file__).resolve().parents[1]


def _name(value: str) -> str:
    return re.sub(r"[-_.]+", "-", value).lower()


def _requirements() -> list[Requirement]:
    project = tomllib.loads((_ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    return [Requirement(dep) for dep in project["dependencies"]]


def _pins() -> dict[str, str]:
    pins: dict[str, str] = {}
    for line in (_ROOT / "constraints.txt").read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            name, sep, version = line.partition("==")
            assert sep and version, f"not an exact pin: {line!r}"
            pins[_name(name)] = version
    return pins


def test_sqlalchemy_comes_with_its_asyncio_extra_and_below_the_next_minor():
    [sqlalchemy] = [r for r in _requirements() if _name(r.name) == "sqlalchemy"]
    assert "asyncio" in sqlalchemy.extras
    assert sqlalchemy.specifier.contains("2.1.3") and not sqlalchemy.specifier.contains("2.2.0")


def test_every_dependency_is_pinned_within_what_pyproject_allows():
    pins = _pins()
    for requirement in _requirements():
        name = _name(requirement.name)
        assert name in pins, f"{name} is not pinned in constraints.txt"
        assert requirement.specifier.contains(pins[name]), (name, pins[name])
    assert "greenlet" in pins                              # what sqlalchemy[asyncio] brings
    assert "homunculus-engine" not in pins                 # the project itself is never pinned


def test_the_api_image_installs_from_the_constraints():
    dockerfile = (_ROOT / "Dockerfile.api").read_text(encoding="utf-8")
    copies = [line for line in dockerfile.splitlines() if line.startswith("COPY")]
    pip_lines = [line for line in dockerfile.splitlines()
                 if line.startswith("RUN") and "pip install" in line]
    assert any("constraints.txt" in line for line in copies), copies
    assert len(pip_lines) == 1 and "-c constraints.txt" in pip_lines[0], pip_lines


def test_the_build_backend_is_pinned_where_pip_build_isolation_sees_it():
    """`pip install .` builds the engine in an isolated environment with whatever setuptools
    satisfies [build-system] — the newest, unless PIP_CONSTRAINT pins it (`-c` does not reach
    that environment). build-constraints.txt holds that pin, within pyproject.toml's range."""
    build = tomllib.loads((_ROOT / "pyproject.toml").read_text(encoding="utf-8"))["build-system"]
    [setuptools] = [r for r in map(Requirement, build["requires"])
                    if _name(r.name) == "setuptools"]
    lines = [line.split("#", 1)[0].strip() for line in
             (_ROOT / "build-constraints.txt").read_text(encoding="utf-8").splitlines()]
    [pin] = [line for line in lines if line]
    name, _, version = pin.partition("==")
    assert _name(name) == "setuptools" and setuptools.specifier.contains(version), pin
    dockerfile = (_ROOT / "Dockerfile.api").read_text(encoding="utf-8")
    [run] = [line for line in dockerfile.splitlines()
             if line.startswith("RUN") and "pip install" in line]
    assert "PIP_CONSTRAINT=/app/build-constraints.txt" in run
    assert any(line.startswith("COPY") and "build-constraints.txt" in line
               for line in dockerfile.splitlines())
