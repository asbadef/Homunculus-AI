"""The edge bridge runs from an image with the standard library and `cryptography` — nothing else.

homunculus-engine/Dockerfile installs exactly that. An import of SQLAlchemy, FastAPI or any other
API-side package reaching the bridge's chain would pass every unit test here (the dev venv has
everything) and then stop the container on the ward at startup: `ModuleNotFoundError`, no MLLP
listener, no readings. This test imports the runner the way the container does, with the
API-only packages made unimportable, so the chain is proven from the test suite.
"""
import subprocess
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_API_ONLY = ["sqlalchemy", "fastapi", "starlette", "alembic", "psycopg2", "asyncpg", "jose",
             "yaml", "bcrypt", "pyotp", "uvicorn", "pydantic"]

_PROBE = f"""
import sys
for name in {_API_ONLY!r}:
    sys.modules[name] = None            # makes `import name` raise ImportError
import runpy
sys.argv = ["run_bridge.py", "--help"]
try:
    runpy.run_path({str(_ROOT / "scripts" / "run_bridge.py")!r}, run_name="__main__")
except SystemExit as exc:               # --help exits 0 after the full import chain ran
    raise SystemExit(0 if exc.code in (0, None) else exc.code)
"""


def test_the_bridge_runner_imports_without_any_api_side_package():
    result = subprocess.run([sys.executable, "-c", _PROBE], capture_output=True, text=True,
                            cwd=_ROOT, env={"PYTHONPATH": str(_ROOT / "src"), "PATH": "",
                                            "SYSTEMROOT": "C:\\Windows"})
    assert result.returncode == 0, result.stderr[-2000:]
    assert "usage: run_bridge.py" in result.stdout


def test_the_bridge_image_installs_cryptography_and_nothing_else():
    dockerfile = (_ROOT / "Dockerfile").read_text(encoding="utf-8")
    pip_lines = [line for line in dockerfile.splitlines() if "pip install" in line]
    assert len(pip_lines) == 1 and "cryptography" in pip_lines[0], pip_lines
    for forbidden in ("sqlalchemy", "fastapi", "requirements", "pyproject"):
        assert forbidden not in pip_lines[0].lower()
