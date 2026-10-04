"""What a Docker build context leaves out, read from the `.dockerignore` files.

A `.dockerignore` pattern is matched from the root of the build context: `*.db` excludes a
`bridge-buffer.db` next to the Dockerfile and nothing deeper. The engine's context is shared by
the bridge and API images, and `scripts/run_bridge.py` and `scripts/run_nce_bridge.py` default
`--db` to a relative path — a buffer started from `scripts/` or `src/` would have been copied
into both images with the observations in it. Buffer databases (and SQLite's side files) and
bytecode are excluded at any depth (`**/`), in the repository root's context too."""
from __future__ import annotations

from pathlib import Path

import pytest

ENGINE = Path(__file__).resolve().parents[1]
REPO = ENGINE.parent
AT_ANY_DEPTH = ("**/*.db", "**/*.db-journal", "**/*.db-wal", "**/*.db-shm", "**/__pycache__/",
                "**/*.pyc")


def _patterns(path: Path) -> list[str]:
    lines = (line.strip() for line in path.read_text(encoding="utf-8").splitlines())
    return [line for line in lines if line and not line.startswith("#")]


@pytest.mark.parametrize("context", [ENGINE, REPO], ids=["homunculus-engine", "repository root"])
def test_buffer_databases_and_bytecode_are_left_out_at_any_depth(context):
    patterns = _patterns(context / ".dockerignore")
    missing = [p for p in AT_ANY_DEPTH if p not in patterns]
    assert missing == [], f"{context / '.dockerignore'} lacks {missing}"
    # Re-including any of them further down would undo it (later lines win in .dockerignore).
    assert not [p for p in patterns if p.startswith("!") and (".db" in p or "pyc" in p
                                                             or "__pycache__" in p)]
