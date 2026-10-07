# src/homunculus/api/devserver.py
"""Local dev server: one hospital, bearer token taken from the environment.

There is NO built-in token. HOMUNCULUS_API_TOKEN must be set (>= 16 characters, not a well-known
placeholder) or the module refuses to import, so the app cannot come up on a guessable credential.
Optional: HOMUNCULUS_HOSPITAL (default HOSP1), HOMUNCULUS_AUDIT_DB (default homunculus-audit.db).
Run: HOMUNCULUS_API_TOKEN=<token> python -m uvicorn homunculus.api.devserver:app --port 8000
"""
import os

from homunculus.api.app import create_app
from homunculus.api.audit import SqliteAuditLog

_MIN_LEN = 16
_token = os.getenv("HOMUNCULUS_API_TOKEN", "").strip()
if not _token:
    raise RuntimeError("HOMUNCULUS_API_TOKEN must be set; the dev server has no default token.")
if len(_token) < _MIN_LEN:
    raise RuntimeError(f"HOMUNCULUS_API_TOKEN must be at least {_MIN_LEN} characters.")

# Audit persists to a local SQLite file (synthetic data only; the .db is gitignored, never committed).
app = create_app(
    {_token: os.getenv("HOMUNCULUS_HOSPITAL", "HOSP1")},
    audit=SqliteAuditLog(os.getenv("HOMUNCULUS_AUDIT_DB", "homunculus-audit.db")),
)
