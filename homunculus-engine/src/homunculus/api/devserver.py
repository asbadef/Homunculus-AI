# src/homunculus/api/devserver.py
"""Local dev server: one tenant, token 'dev-token'. NEVER use these credentials in production.
Run: homunculus-engine/.venv/Scripts/python.exe -m uvicorn homunculus.api.devserver:app --port 8000
"""
from homunculus.api.app import create_app
from homunculus.api.audit import SqliteAuditLog
from homunculus.api.patient_identity import SqliteIdentityStore

# Audit persists to a local SQLite file (synthetic data only; the .db is gitignored, never committed).
app = create_app({"dev-token": "HOSP1"}, audit=SqliteAuditLog("homunculus-audit.db"),
                 identities=SqliteIdentityStore("homunculus-identity.db"))
